//! A code on WhatsApp that proves the shopper holds the phone (owner, 25 Oct
//! 2026: "register jg pake otp ya").
//!
//! Two uses. A till registering a new member sends the code to the number
//! the shopper gave and types back what they read out (`REGISTER`). The member
//! app signs a member in with it (`SIGN_IN`); nobody signs up there — members
//! are registered at a till and only there (owner, 25 Oct 2026). Points use their own code on their own request
//! (`loyalty.rs`, `member_redeem_request`), because a redemption already has
//! a row that the code belongs to.
//!
//! This is the scheme `postgres/member.rs` argued against — a recycled prepaid
//! number inherits the previous holder's history — and the owner chose it
//! anyway: the code is what a shopper understands, and WhatsApp is what they
//! have. Six digits, five minutes, five guesses, five codes an hour per number.

use crate::cloud::application::AppError;
use crate::cloud::whatsapp;
use crate::security;
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// How long a code lives.
pub const OTP_TTL_MINUTES: i64 = 5;

/// Guesses against one code before it is burned.
pub const OTP_MAX_ATTEMPTS: i32 = 5;

/// Codes one number may be sent in an hour — what stops a till or a stranger
/// on the app from flooding somebody's WhatsApp, and head office's number
/// from being reported for it.
pub const OTP_MAX_PER_HOUR: i64 = 5;

/// What a code is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OtpPurpose {
    Register,
    SignIn,
}

impl OtpPurpose {
    fn as_str(self) -> &'static str {
        match self {
            Self::Register => "REGISTER",
            Self::SignIn => "SIGN_IN",
        }
    }
}

/// A code on its way: never the code itself, which only WhatsApp carries.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct SentOtp {
    pub challenge_id: Uuid,
    pub expires_at: DateTime<Utc>,
    /// `0812****7890`: the number the code went to, for saying it back.
    pub sent_to: String,
}

/// The number as a member id: digits, `0` in front, the way a till keys it.
/// `None` for what is not an Indonesian mobile number.
pub fn member_phone(raw: &str) -> Option<String> {
    let international = whatsapp::wa_number(raw)?;
    Some(format!("0{}", &international[2..]))
}

/// Send a fresh code to `phone`'s WhatsApp.
///
/// The row is written before the message goes and deleted again if WhatsApp
/// refuses it, so a code nobody received never counts against the hour.
pub async fn send_member_otp(
    pool: &PgPool,
    purpose: OtpPurpose,
    phone: &str,
    origin_id: Option<&str>,
    asked_by: Option<&str>,
) -> Result<SentOtp, AppError> {
    let phone = member_phone(phone).ok_or_else(|| {
        AppError::Validation("a code is sent to a mobile number, 08…".into())
    })?;
    let recent: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM member_otp
          WHERE phone = $1 AND requested_at > now() - interval '1 hour'",
    )
    .bind(&phone)
    .fetch_one(pool)
    .await?;
    if recent >= OTP_MAX_PER_HOUR {
        return Err(AppError::Conflict(format!(
            "{} has been sent {OTP_MAX_PER_HOUR} codes this hour: try again later",
            whatsapp::masked(&phone)
        )));
    }

    let code = security::random_digits(6);
    let challenge_id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::minutes(OTP_TTL_MINUTES);
    sqlx::query(
        "INSERT INTO member_otp
             (challenge_id, purpose, phone, code_sha256, expires_at, origin_id, asked_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(challenge_id)
    .bind(purpose.as_str())
    .bind(&phone)
    .bind(security::sha256_hex(&code))
    .bind(expires_at)
    .bind(origin_id)
    .bind(asked_by)
    .execute(pool)
    .await?;

    let text = match purpose {
        OtpPurpose::Register => format!(
            "Kode pendaftaran member: {code}\nBerlaku {OTP_TTL_MINUTES} menit. \
             Berikan hanya kepada kasir yang sedang melayani Anda."
        ),
        OtpPurpose::SignIn => format!(
            "Kode masuk app member: {code}\nBerlaku {OTP_TTL_MINUTES} menit. \
             Jangan berikan kode ini kepada siapa pun."
        ),
    };
    match whatsapp::send(&phone, &text).await {
        Ok(message_id) => {
            sqlx::query("UPDATE member_otp SET message_id = $2 WHERE challenge_id = $1")
                .bind(challenge_id)
                .bind(message_id)
                .execute(pool)
                .await?;
        }
        Err(error) => {
            sqlx::query("DELETE FROM member_otp WHERE challenge_id = $1")
                .bind(challenge_id)
                .execute(pool)
                .await?;
            return Err(error);
        }
    }

    Ok(SentOtp {
        challenge_id,
        expires_at,
        sent_to: whatsapp::masked(&phone),
    })
}

/// The one answer every failed check gives: wrong code, expired, burned,
/// used, another number's — the pairing code's reasoning (`pairing_refused`).
fn otp_refused() -> AppError {
    AppError::Unauthorized("that code does not match, or it has expired".into())
}

/// Check a code read back against its challenge, for `phone` and `purpose`.
///
/// A wrong guess is counted and committed before the refusal, as every code
/// here is. A right one marks the challenge verified and leaves it unused, so
/// the call that registers or signs in can mark it used once it has.
pub async fn verify_member_otp(
    pool: &PgPool,
    challenge_id: Uuid,
    purpose: OtpPurpose,
    phone: &str,
    code: &str,
) -> Result<(), AppError> {
    let phone = member_phone(phone).ok_or_else(otp_refused)?;
    let code = code.trim();
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(otp_refused());
    }
    let mut tx = pool.begin().await?;
    let Some(row) = sqlx::query(
        "SELECT purpose, phone, code_sha256, expires_at, attempts, used_at
           FROM member_otp
          WHERE challenge_id = $1
          FOR UPDATE",
    )
    .bind(challenge_id)
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Err(otp_refused());
    };
    let used_at: Option<DateTime<Utc>> = row.get("used_at");
    let expires_at: DateTime<Utc> = row.get("expires_at");
    let attempts: i32 = row.get("attempts");
    let stored: String = row.get("code_sha256");
    let theirs: String = row.get("phone");
    let for_what: String = row.get("purpose");
    if used_at.is_some()
        || expires_at <= Utc::now()
        || attempts >= OTP_MAX_ATTEMPTS
        || theirs != phone
        || for_what != purpose.as_str()
    {
        return Err(otp_refused());
    }
    if !security::constant_time_eq(&security::sha256_hex(code), &stored) {
        sqlx::query("UPDATE member_otp SET attempts = attempts + 1 WHERE challenge_id = $1")
            .bind(challenge_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Err(otp_refused());
    }
    sqlx::query(
        "UPDATE member_otp SET verified_at = COALESCE(verified_at, now())
          WHERE challenge_id = $1",
    )
    .bind(challenge_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// The code has done its work: a member registered, a shopper signed in.
pub async fn use_member_otp(pool: &PgPool, challenge_id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE member_otp SET used_at = now() WHERE challenge_id = $1 AND used_at IS NULL")
        .bind(challenge_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_member_number_is_the_local_form() {
        assert_eq!(member_phone("6281234567890").as_deref(), Some("081234567890"));
        assert_eq!(member_phone("0812 3456 7890").as_deref(), Some("081234567890"));
        assert_eq!(member_phone("+62 812-3456-7890").as_deref(), Some("081234567890"));
        assert_eq!(member_phone("12345"), None);
    }
}
