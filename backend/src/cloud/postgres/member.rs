//! Enrolment, the pairing code a cashier reads out, and the member's session.
//!
//! # What this proves, and why it is not an OTP
//!
//! One question: is the person looking at the screen the holder of that card?
//!
//! The three implementations this was written against — `cloud/customer` in Go,
//! `final-product/.../cloud-customer` in Rust, `fresh/crates/member-domain` —
//! all answer it with a one-time code sent to a phone. That proves control of a
//! *number*, and in this market a number is the least durable thing about a
//! person: prepaid numbers are changed often and operators recycle them after
//! roughly 60–90 days of inactivity, so whoever is issued a recycled number
//! would inherit the previous holder's purchase history. It is also the only
//! answer that needs a paid provider and a live data connection at the moment
//! somebody is trying to sign in.
//!
//! A code read out by a cashier proves what we actually care about: the card is
//! in the person's hand, in the shop, checked by an employee. It costs nothing,
//! survives a dead connection, and every issuance carries the name of the
//! cashier who made it — which is the only defence against the single attack
//! this scheme has, a dishonest cashier pairing their own phone to somebody
//! else's card. A phone OTP can name nobody.
//!
//! # And now a WhatsApp code as well
//!
//! The owner chose the code anyway (25 Oct 2026): a till registers a new
//! member, and the app signs a shopper in or up, once the shopper reads back
//! six digits sent to that number's WhatsApp — see `member_otp.rs`. The
//! pairing code stays for a card with no phone behind it.
//!
//! # Nothing here is a shortcut into the operator session
//!
//! A member session lives in its own table with its own cookie and carries no
//! `Role`. It can read one member's own sales and nothing else. That separation
//! is the point: a shopper's proof that they hold a loyalty card must never be
//! able to become an operator's authority by accident.

use crate::cloud::application::AppError;
use crate::security;
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// How long a pairing code lives.
///
/// Long enough to survive a queue and a shopper fishing their phone out of a
/// bag, short enough that a code read aloud at a counter is not still valid
/// when the next customer is served.
pub const PAIRING_CODE_TTL_MINUTES: i64 = 10;

/// Guesses allowed against one code before it is burned.
///
/// Five, against six digits: an attacker who knows a card number gets five
/// tries in ten minutes at one of a million codes, and then the code is gone
/// rather than merely wrong. The Go reference counted attempts in a
/// process-local map and the Rust port counted them nowhere at all.
pub const PAIRING_CODE_MAX_ATTEMPTS: i32 = 5;

/// How long a paired device stays paired.
///
/// Ninety days, not the operator session's hours. A member is not signing in to
/// do work; they are checking their points on their own phone, and asking them
/// back to a counter every fortnight would make the app not worth opening.
pub const MEMBER_SESSION_TTL_DAYS: i64 = 90;

/// A member, as the app is told about themselves.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MemberIdentity {
    pub member_id: String,
    pub display_name: Option<String>,
    pub joined_on: NaiveDate,
}

/// A code, the once it is knowable.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IssuedPairingCode {
    pub member_id: String,
    /// The six digits, in the clear, exactly once — this response is where the
    /// cashier reads them from. Nothing stores them; the table keeps only a
    /// hash.
    pub code: String,
    pub expires_at: DateTime<Utc>,
}

/// A member session, before its token has been handed to the browser.
pub struct IssuedMemberSession {
    pub token: String,
    pub csrf_token: String,
    pub expires_at: DateTime<Utc>,
    pub member: MemberIdentity,
}

/// Who a member request is from. No role, on purpose.
#[derive(Clone, Debug)]
pub struct MemberPrincipal {
    pub session_id: Uuid,
    pub member_id: String,
    pub csrf_token_sha256: String,
}

/// Enrol a card.
///
/// Idempotent on the member id, because the id is the number printed on a card
/// somebody is already holding: a cashier who enrols the same card twice has
/// made no mistake worth an error, and refusing would leave the second one
/// unable to pair.
pub async fn enrol_member(
    pool: &PgPool,
    member_id: &str,
    display_name: Option<&str>,
) -> Result<MemberIdentity, AppError> {
    let member_id = normalise_member_id(member_id)?;
    let display_name = display_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned);
    let row = sqlx::query(
        "INSERT INTO member (member_id, display_name)
         VALUES ($1, $2)
         ON CONFLICT (member_id) DO UPDATE
            SET display_name = COALESCE(EXCLUDED.display_name, member.display_name)
         RETURNING member_id, display_name, joined_on",
    )
    .bind(&member_id)
    .bind(display_name)
    .fetch_one(pool)
    .await?;
    Ok(MemberIdentity {
        member_id: row.get("member_id"),
        display_name: row.get("display_name"),
        joined_on: row.get("joined_on"),
    })
}

/// What a till registers beside a member's number and name (client, 23 Oct
/// 2026). `None` leaves a field as it is.
#[derive(Clone, Debug, Default)]
pub struct MemberProfile {
    /// `L` or `P`.
    pub gender: Option<String>,
    pub birth_place: Option<String>,
    pub birth_date: Option<chrono::NaiveDate>,
    pub address: Option<String>,
    pub email: Option<String>,
}

/// Write a member's registration details (postgres 0988).
pub async fn record_member_profile(
    pool: &PgPool,
    member_id: &str,
    profile: &MemberProfile,
) -> Result<(), AppError> {
    let member_id = normalise_member_id(member_id)?;
    sqlx::query(
        "UPDATE member
            SET gender = COALESCE($2, gender),
                birth_place = COALESCE($3, birth_place),
                birth_date = COALESCE($4, birth_date),
                address = COALESCE($5, address),
                email = COALESCE($6, email)
          WHERE member_id = $1",
    )
    .bind(&member_id)
    .bind(profile.gender.as_deref())
    .bind(profile.birth_place.as_deref())
    .bind(profile.birth_date)
    .bind(profile.address.as_deref())
    .bind(profile.email.as_deref())
    .execute(pool)
    .await?;
    Ok(())
}

/// A new member as a till or the member app registers one (client, 23 Oct
/// 2026): the phone is the member id, and a name, gender, birth place and
/// birth date are required.
#[derive(Clone, Debug)]
pub struct NewMember {
    pub member_id: String,
    pub display_name: String,
    pub profile: MemberProfile,
}

impl NewMember {
    /// The registration rules, said once for the till and the app.
    pub fn checked(
        member_id: &str,
        display_name: Option<&str>,
        gender: Option<&str>,
        birth_place: Option<&str>,
        birth_date: Option<NaiveDate>,
        address: Option<&str>,
        email: Option<&str>,
    ) -> Result<Self, AppError> {
        let member_id = member_id.trim().to_string();
        if !member_id.chars().all(|c| c.is_ascii_digit()) || !(10..=13).contains(&member_id.len()) {
            return Err(AppError::Validation(
                "a new member is registered by a phone number of 10 to 13 digits".into(),
            ));
        }
        let filled = |value: Option<&str>| {
            value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        let display_name = filled(display_name)
            .ok_or_else(|| AppError::Validation("a new member needs a name".into()))?;
        let gender = filled(gender)
            .map(|gender| gender.to_ascii_uppercase())
            .filter(|gender| gender == "L" || gender == "P")
            .ok_or_else(|| AppError::Validation("a new member needs a gender, L or P".into()))?;
        let birth_place = filled(birth_place)
            .ok_or_else(|| AppError::Validation("a new member needs a birth place".into()))?;
        let birth_date = birth_date
            .ok_or_else(|| AppError::Validation("a new member needs a birth date".into()))?;
        let email = filled(email);
        if email.as_deref().is_some_and(|email| !email.contains('@')) {
            return Err(AppError::Validation("that email has no @".into()));
        }
        Ok(Self {
            member_id,
            display_name,
            profile: MemberProfile {
                gender: Some(gender),
                birth_place: Some(birth_place),
                birth_date: Some(birth_date),
                address: filled(address),
                email,
            },
        })
    }
}

/// Register a new member. A number that is already a member is refused by
/// name rather than renamed — whoever is registering is told who holds it.
pub async fn register_member(pool: &PgPool, new: &NewMember) -> Result<MemberIdentity, AppError> {
    let existing: Option<Option<String>> =
        sqlx::query_scalar("SELECT display_name FROM member WHERE member_id = $1")
            .bind(&new.member_id)
            .fetch_optional(pool)
            .await?;
    if let Some(name) = existing {
        return Err(AppError::Conflict(format!(
            "{} already has the number {}",
            name.as_deref().unwrap_or("someone"),
            new.member_id
        )));
    }
    let member = enrol_member(pool, &new.member_id, Some(&new.display_name)).await?;
    record_member_profile(pool, &new.member_id, &new.profile).await?;
    Ok(member)
}

/// A session for a shopper who has just read back a WhatsApp code
/// (`member_otp.rs`): the pairing code's session, opened by the phone rather
/// than by a cashier. `paired_by` says `WHATSAPP` for the same reason it names
/// a cashier there — "who let this phone in" has an answer.
pub async fn open_member_session(
    pool: &PgPool,
    member_id: &str,
    site_id: Option<&str>,
) -> Result<IssuedMemberSession, AppError> {
    let member_id = normalise_member_id(member_id)?;
    ensure_member_is_live(pool, &member_id).await?;
    let token = security::random_token();
    let csrf_token = security::random_token();
    let expires_at = Utc::now() + Duration::days(MEMBER_SESSION_TTL_DAYS);
    sqlx::query(
        "INSERT INTO member_session
             (session_id, token_sha256, csrf_token_sha256, member_id,
              paired_at_site, paired_by, expires_at)
         VALUES ($1,$2,$3,$4,$5,'WHATSAPP',$6)",
    )
    .bind(Uuid::new_v4())
    .bind(security::sha256_hex(&token))
    .bind(security::sha256_hex(&csrf_token))
    .bind(&member_id)
    .bind(site_id)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(IssuedMemberSession {
        token,
        csrf_token,
        expires_at,
        member: member_identity(pool, &member_id).await?,
    })
}

/// Whether `member_id` is a member at all.
pub async fn member_exists(pool: &PgPool, member_id: &str) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, i32>("SELECT 1 FROM member WHERE member_id = $1")
            .bind(member_id.trim())
            .fetch_optional(pool)
            .await?
            .is_some(),
    )
}

/// Issue the code a cashier reads out.
///
/// Replaces any code already live for this member rather than adding a second:
/// two live codes for one card is a state where "I asked again and the old one
/// still worked" is true, and that is exactly the state a short-lived code
/// exists to avoid.
pub async fn issue_pairing_code(
    pool: &PgPool,
    member_id: &str,
    issued_by: &str,
) -> Result<IssuedPairingCode, AppError> {
    let member_id = normalise_member_id(member_id)?;
    ensure_member_is_live(pool, &member_id).await?;

    let code = security::random_digits(6);
    let expires_at = Utc::now() + Duration::minutes(PAIRING_CODE_TTL_MINUTES);
    sqlx::query(
        "INSERT INTO member_pairing_code
             (member_id, code_sha256, issued_by, issued_at, expires_at, attempts, consumed_at)
         VALUES ($1, $2, $3, now(), $4, 0, NULL)
         ON CONFLICT (member_id) DO UPDATE
            SET code_sha256 = EXCLUDED.code_sha256,
                issued_by   = EXCLUDED.issued_by,
                issued_at   = now(),
                expires_at  = EXCLUDED.expires_at,
                attempts    = 0,
                consumed_at = NULL",
    )
    .bind(&member_id)
    .bind(security::sha256_hex(&code))
    .bind(issued_by)
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(IssuedPairingCode {
        member_id,
        code,
        expires_at,
    })
}

/// Trade a card number and a code for a session.
///
/// Every failure answers the same way — see [`pairing_refused`] — so this
/// cannot be used to find out which card numbers exist.
pub async fn redeem_pairing_code(
    pool: &PgPool,
    member_id: &str,
    code: &str,
    site_id: Option<&str>,
) -> Result<IssuedMemberSession, AppError> {
    let member_id = normalise_member_id(member_id).map_err(|_| pairing_refused())?;
    let code = code.trim();
    // Shape-checked before it reaches the database: a malformed code cannot be
    // right, and spending a precious attempt on it would let somebody burn a
    // member's code with garbage.
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(pairing_refused());
    }

    let mut tx = pool.begin().await?;

    // `FOR UPDATE` because the attempt counter is the whole defence: two
    // requests reading `attempts` at once would each see the same number and
    // the limit would be worth double.
    let Some(row) = sqlx::query(
        "SELECT c.code_sha256, c.expires_at, c.attempts, c.consumed_at,
                c.issued_by, m.display_name, m.joined_on, m.blocked_at
           FROM member_pairing_code c
           JOIN member m ON m.member_id = c.member_id
          WHERE c.member_id = $1
          FOR UPDATE OF c",
    )
    .bind(&member_id)
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Err(pairing_refused());
    };

    let blocked_at: Option<DateTime<Utc>> = row.get("blocked_at");
    let consumed_at: Option<DateTime<Utc>> = row.get("consumed_at");
    let expires_at: DateTime<Utc> = row.get("expires_at");
    let attempts: i32 = row.get("attempts");
    let stored: String = row.get("code_sha256");

    if blocked_at.is_some()
        || consumed_at.is_some()
        || expires_at <= Utc::now()
        || attempts >= PAIRING_CODE_MAX_ATTEMPTS
    {
        return Err(pairing_refused());
    }

    if !security::constant_time_eq(&security::sha256_hex(code), &stored) {
        // The wrong guess is recorded and committed. Returning early without
        // committing would make the counter a suggestion.
        sqlx::query("UPDATE member_pairing_code SET attempts = attempts + 1 WHERE member_id = $1")
            .bind(&member_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Err(pairing_refused());
    }

    // Right. Burn the code — a pairing code is worth exactly one device.
    sqlx::query("UPDATE member_pairing_code SET consumed_at = now() WHERE member_id = $1")
        .bind(&member_id)
        .execute(&mut *tx)
        .await?;

    let token = security::random_token();
    let csrf_token = security::random_token();
    let expires_at = Utc::now() + Duration::days(MEMBER_SESSION_TTL_DAYS);
    let issued_by: String = row.get("issued_by");
    sqlx::query(
        "INSERT INTO member_session
             (session_id, token_sha256, csrf_token_sha256, member_id,
              paired_at_site, paired_by, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(Uuid::new_v4())
    .bind(security::sha256_hex(&token))
    .bind(security::sha256_hex(&csrf_token))
    .bind(&member_id)
    .bind(site_id)
    .bind(&issued_by)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(IssuedMemberSession {
        token,
        csrf_token,
        expires_at,
        member: MemberIdentity {
            member_id,
            display_name: row.get("display_name"),
            joined_on: row.get("joined_on"),
        },
    })
}

/// Resolve a member session token.
///
/// Blocking a member takes effect here rather than only at the next pairing:
/// a membership stopped at the counter has to stop the phone already in the
/// customer's pocket, not merely the next one.
pub async fn authenticate_member_session(
    pool: &PgPool,
    token: &str,
) -> Result<MemberPrincipal, AppError> {
    let row = sqlx::query(
        "UPDATE member_session s
            SET last_seen_at = now()
           FROM member m
          WHERE m.member_id = s.member_id
            AND s.token_sha256 = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
            AND m.blocked_at IS NULL
      RETURNING s.session_id, s.member_id, s.csrf_token_sha256",
    )
    .bind(security::sha256_hex(token))
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Unauthorized("member session is not valid".into()))?;

    Ok(MemberPrincipal {
        session_id: row.get("session_id"),
        member_id: row.get("member_id"),
        csrf_token_sha256: row.get("csrf_token_sha256"),
    })
}

pub async fn revoke_member_session(pool: &PgPool, session_id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE member_session SET revoked_at = now()
          WHERE session_id = $1 AND revoked_at IS NULL",
    )
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn member_identity(pool: &PgPool, member_id: &str) -> Result<MemberIdentity, AppError> {
    let row =
        sqlx::query("SELECT member_id, display_name, joined_on FROM member WHERE member_id = $1")
            .bind(member_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("member".into()))?;
    Ok(MemberIdentity {
        member_id: row.get("member_id"),
        display_name: row.get("display_name"),
        joined_on: row.get("joined_on"),
    })
}

/// The one answer every pairing failure gives.
///
/// Unknown card, no code issued, wrong code, expired code, already-used code,
/// too many guesses and a blocked membership are one sentence and one status.
/// All three reference implementations distinguish these — "customer not found"
/// against "invalid or expired OTP" — which turns the sign-in form into a
/// service for discovering which numbers are members.
fn pairing_refused() -> AppError {
    // English, like every other message this API writes. The shopper never
    // reads this: `frontend-customer/src/components/states.tsx` turns the
    // status into an Indonesian sentence, because the people who read server
    // wording are the ones running the system and the people reading this
    // screen are buying trousers.
    AppError::Unauthorized("member number or code does not match, or the code has expired".into())
}

fn normalise_member_id(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("member_id is required".into()));
    }
    if trimmed.chars().count() > 64 {
        return Err(AppError::Validation("member_id is longer than 64".into()));
    }
    Ok(trimmed.to_owned())
}

async fn ensure_member_is_live(pool: &PgPool, member_id: &str) -> Result<(), AppError> {
    let blocked: Option<Option<DateTime<Utc>>> =
        sqlx::query_scalar("SELECT blocked_at FROM member WHERE member_id = $1")
            .bind(member_id)
            .fetch_optional(pool)
            .await?;
    match blocked {
        None => Err(AppError::NotFound("member".into())),
        Some(Some(_)) => Err(AppError::Conflict("this membership is blocked".into())),
        Some(None) => Ok(()),
    }
}
