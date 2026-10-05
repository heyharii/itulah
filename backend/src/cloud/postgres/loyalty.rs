//! A member's points: what they are owed, and how they spend it.
//!
//! Everything here is written against one rule from decision K02 — checking a
//! balance is not the same as reserving against it. Every path takes the
//! account row `FOR UPDATE` first and reads the balance inside that lock, in
//! the same transaction that writes the entry. `BEGIN`/`COMMIT` alone does not
//! give that: PostgreSQL's default isolation lets two transactions each read a
//! balance of 2.000 and each spend it.
//!
//! # Points are spent by turning them into a voucher, never at the till
//!
//! V1 has one mechanism (the locked rule): points become a voucher, and the
//! voucher is tender. So checkout has no points arithmetic at all, and the one
//! place points leave an account is [`redeem_points_to_voucher`] — which debits
//! and issues in a single transaction, because a debit whose voucher never
//! appeared is money taken from a shopper for nothing.

use crate::cloud::application::AppError;
use crate::security;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// Where an entry came from. Exactly one of these is set, and the database's
/// partial unique indexes are what stop one cause producing two entries.
#[derive(Clone, Copy, Debug)]
pub enum PointsCause {
    Sale(Uuid),
    Return(Uuid),
    Redemption(Uuid),
}

impl PointsCause {
    fn columns(self) -> (Option<Uuid>, Option<Uuid>, Option<Uuid>) {
        match self {
            Self::Sale(id) => (Some(id), None, None),
            Self::Return(id) => (None, Some(id), None),
            Self::Redemption(id) => (None, None, Some(id)),
        }
    }
}

/// Open the account if this is the first time the member has been seen, and
/// lock it.
///
/// Created on demand rather than when a member signs up, because a member who
/// has never earned or spent has nothing to hold and a row of noughts for every
/// member on the books is a table that is mostly nothing.
async fn lock_account(
    tx: &mut Transaction<'_, Postgres>,
    customer_id: &str,
) -> Result<i64, AppError> {
    sqlx::query(
        "INSERT INTO points_account (customer_id) VALUES ($1)
         ON CONFLICT (customer_id) DO NOTHING",
    )
    .bind(customer_id)
    .execute(&mut **tx)
    .await?;
    let balance: i64 = sqlx::query_scalar(
        "SELECT balance_points FROM points_account WHERE customer_id = $1 FOR UPDATE",
    )
    .bind(customer_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(balance)
}

/// Append an entry and move the cached balance with it, in one statement each.
///
/// Returns `Ok(None)` when the cause has already produced an entry of this
/// type. That is not an error: a sale delivered twice, a return retried, a
/// redemption replayed — all of them mean the same thing happened once, and the
/// unique index is what decides that rather than a prior read.
async fn append(
    tx: &mut Transaction<'_, Postgres>,
    customer_id: &str,
    entry_type: &str,
    points: i64,
    cause: PointsCause,
    actor: &str,
    reason: Option<&str>,
) -> Result<Option<Uuid>, AppError> {
    if points == 0 {
        // An entry of nought says nothing and would still consume the cause's
        // one slot, so a later real award for the same sale could never land.
        return Ok(None);
    }
    let (sale_id, return_id, redemption_id) = cause.columns();
    let entry_id = Uuid::new_v4();
    let inserted = sqlx::query(
        "INSERT INTO points_ledger
             (entry_id, customer_id, entry_type, points, sale_id, return_id,
              redemption_id, reason, actor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING",
    )
    .bind(entry_id)
    .bind(customer_id)
    .bind(entry_type)
    .bind(points)
    .bind(sale_id)
    .bind(return_id)
    .bind(redemption_id)
    .bind(reason)
    .bind(actor)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Ok(None);
    }
    sqlx::query(
        "UPDATE points_account
            SET balance_points = balance_points + $2, updated_at = now()
          WHERE customer_id = $1",
    )
    .bind(customer_id)
    .bind(points)
    .execute(&mut **tx)
    .await?;
    Ok(Some(entry_id))
}

/// Award what a completed sale earned.
///
/// Called when the centre accepts the sale, not when the till completes it: a
/// sale taken offline has not been validated yet, and points that were spendable
/// before the centre agreed are points the centre may later disagree with.
pub async fn earn_from_sale(
    tx: &mut Transaction<'_, Postgres>,
    customer_id: &str,
    sale_id: Uuid,
    points: i64,
    actor: &str,
) -> Result<Option<Uuid>, AppError> {
    if points <= 0 {
        return Ok(None);
    }
    lock_account(tx, customer_id).await?;
    append(
        tx,
        customer_id,
        "EARN",
        points,
        PointsCause::Sale(sale_id),
        actor,
        None,
    )
    .await
}

/// Take back what a returned sale had earned.
///
/// The figure comes from what was AWARDED, never from re-running today's
/// scheme against the returned goods: the rate may have changed, and a shopper
/// must not lose more points than the purchase ever gave them.
///
/// This is the entry that may drive a balance negative, and it is allowed to.
/// See the migration: the voucher the points already bought is not clawed back,
/// because it may have been spent.
pub async fn reverse_for_return(
    tx: &mut Transaction<'_, Postgres>,
    customer_id: &str,
    return_id: Uuid,
    points_awarded: i64,
    actor: &str,
) -> Result<Option<Uuid>, AppError> {
    if points_awarded <= 0 {
        return Ok(None);
    }
    lock_account(tx, customer_id).await?;
    append(
        tx,
        customer_id,
        "RETURN_REVERSAL",
        -points_awarded,
        PointsCause::Return(return_id),
        actor,
        None,
    )
    .await
}

/// Take back what a VOIDED sale had earned.
///
/// The same ruling as a return: the figure comes from what was AWARDED — read
/// off the centre's own `edge_sale` row, never recomputed — and the debit may
/// drive the balance negative, because the points may already have been spent.
/// Keyed on the sale, so a redelivered void fact takes back once: the partial
/// unique index on `(sale_id) WHERE entry_type = 'VOID_REVERSAL'` decides,
/// exactly as `ux_points_ledger_earn` decides for the award it undoes.
pub async fn reverse_for_void(
    tx: &mut Transaction<'_, Postgres>,
    customer_id: &str,
    sale_id: Uuid,
    points_awarded: i64,
    actor: &str,
) -> Result<Option<Uuid>, AppError> {
    if points_awarded <= 0 {
        return Ok(None);
    }
    lock_account(tx, customer_id).await?;
    append(
        tx,
        customer_id,
        "VOID_REVERSAL",
        -points_awarded,
        PointsCause::Sale(sale_id),
        actor,
        None,
    )
    .await
}

/// What one line of a sale was recorded as earning, at the time it was sold.
///
/// The snapshot, never a recomputation. See [`plan_return_reversal`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineAward {
    pub sale_line_id: Uuid,
    /// `None` is "never recorded", which is NOT nought — migration 0166 turns
    /// on the difference. A sale rung up before the award was stored per line,
    /// or through the centre's own path which computes no award at all, has
    /// nothing here, and nought would be a claim.
    pub points_earned: Option<i64>,
}

/// What a return takes back, and what it could not answer for.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReversalPlan {
    /// The sum of what the returned lines were recorded as earning. Never
    /// larger than that: a partial return takes back its own lines' points and
    /// no share of anybody else's.
    pub points: i64,
    /// Lines whose award was never recorded, by id. Reported rather than
    /// treated as nought, so a person can settle what arithmetic must not
    /// guess at.
    pub unrecorded: Vec<Uuid>,
}

/// Decide what a return reverses, from the snapshot and nothing else.
///
/// The whole of the rule is that this function cannot see today's scheme, the
/// basket total, or the refund. It is handed the lines coming back with the
/// award each was recorded as earning, and it adds them up. That is what makes
/// a partial return correct by construction: returning one of two shoes takes
/// back what that shoe earned, not half of 638, and not what the same shoe
/// would earn if it were sold this morning at a rate that has since doubled.
///
/// A negative recorded award counts as unrecorded rather than as a figure. An
/// award is what was GIVEN, and a negative one was never given; reversing it
/// would ADD points to the balance of somebody handing goods back, which is the
/// one direction a return must never move an account.
pub fn plan_return_reversal(lines: &[LineAward]) -> ReversalPlan {
    let mut plan = ReversalPlan::default();
    for line in lines {
        match line.points_earned {
            // Saturating rather than wrapping: a corrupt snapshot near the
            // integer ceiling should pin the figure, not roll it negative and
            // hand the shopper points for a return.
            Some(points) if points >= 0 => plan.points = plan.points.saturating_add(points),
            _ => plan.unrecorded.push(line.sale_line_id),
        }
    }
    plan
}

#[derive(Debug, Deserialize)]
pub struct RedeemPointsRequest {
    /// Filled from the URL by the handler, which is why it defaults here: a
    /// body that could name a different member than the path is a way to spend
    /// somebody else's points through an endpoint addressed to your own.
    #[serde(default)]
    pub customer_id: String,
    pub points: i64,
    /// Kept for wire compatibility and historical retries. For a new
    /// redemption it must match the server's loyalty conversion; a caller
    /// cannot choose how much money their points create.
    pub voucher_value_minor: i64,
    pub actor_id: String,
    pub idempotency_key: String,
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
}

/// The server-owned loyalty scheme: one point buys one IDR minor unit.
/// Both redemption entry points use this conversion. Historical idempotent
/// retries use their recorded value, without creating another voucher.
fn voucher_value_for_points(points: i64) -> i64 {
    points
}

/// Spend points on a voucher, both halves or neither.
///
/// The two writes that must not come apart: the debit and the issue. A debit
/// whose voucher never appeared takes points for nothing; an issue whose debit
/// never landed hands out money. They are in one transaction, and the
/// redemption row is what makes a retry answerable — the same key returns the
/// voucher already issued, rather than issuing a second one against a second
/// debit.
///
/// Online only, and that is not an implementation limit: the balance lives in
/// one place and a till cannot know what another till has just spent.
pub async fn redeem_points_to_voucher(
    pool: &PgPool,
    request: RedeemPointsRequest,
) -> Result<Value, AppError> {
    let customer_id = request.customer_id.trim();
    let actor = request.actor_id.trim();
    let key = request.idempotency_key.trim();
    if customer_id.is_empty() || actor.is_empty() || key.is_empty() {
        return Err(AppError::Validation(
            "a redemption needs a member, an actor, and an idempotency key".into(),
        ));
    }
    if request.points <= 0 || request.voucher_value_minor <= 0 {
        return Err(AppError::Validation(
            "a redemption has to spend points and be worth something".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let balance = lock_account(&mut tx, customer_id).await?;

    // The same key asked again. Answered from what was written, not recomputed:
    // the rate may have moved since, and a retry must return the voucher the
    // shopper was already given.
    if let Some(row) = sqlx::query(
        "SELECT redemption_id, points_spent, voucher_value_minor, voucher_id
           FROM loyalty_redemption
          WHERE customer_id = $1 AND idempotency_key = $2",
    )
    .bind(customer_id)
    .bind(key)
    .fetch_optional(&mut *tx)
    .await?
    {
        let stored_points: i64 = row.try_get("points_spent")?;
        let stored_value: i64 = row.try_get("voucher_value_minor")?;
        if request.points != stored_points || request.voucher_value_minor != stored_value {
            return Err(AppError::Conflict(
                "that redemption key already names a different points amount or voucher value"
                    .into(),
            ));
        }
        let voucher_id: Option<Uuid> = row.try_get("voucher_id")?;
        let code: Option<String> = match voucher_id {
            Some(id) => {
                sqlx::query_scalar("SELECT code FROM voucher WHERE voucher_id = $1")
                    .bind(id)
                    .fetch_optional(&mut *tx)
                    .await?
            }
            None => None,
        };
        tx.commit().await?;
        return Ok(json!({
            "redemption_id": row.get::<Uuid, _>("redemption_id"),
            "customer_id": customer_id,
            "points_spent": row.get::<i64, _>("points_spent"),
            "voucher_value_minor": row.get::<i64, _>("voucher_value_minor"),
            "voucher_id": voucher_id,
            "voucher_code": code,
            "balance_points": balance,
            "replayed": true,
        }));
    }

    let voucher_value_minor = voucher_value_for_points(request.points);
    if request.voucher_value_minor != voucher_value_minor {
        return Err(AppError::Validation(format!(
            "{} points buy {voucher_value_minor} IDR under the loyalty scheme; \
             the requested voucher value cannot change that rate",
            request.points,
        )));
    }

    // Enough, measured inside the lock. A negative balance from a reversal
    // blocks spending until earning brings it back — the shopper keeps the
    // voucher they already have and carries the debt.
    if balance < request.points {
        return Err(AppError::Conflict(format!(
            "that member has {balance} points and the redemption asked for {}",
            request.points
        )));
    }

    let redemption_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO loyalty_redemption
             (redemption_id, customer_id, points_spent, voucher_value_minor,
              idempotency_key, actor)
         VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(redemption_id)
    .bind(customer_id)
    .bind(request.points)
    .bind(voucher_value_minor)
    .bind(key)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    let debited = append(
        &mut tx,
        customer_id,
        "REDEEM_TO_VOUCHER",
        -request.points,
        PointsCause::Redemption(redemption_id),
        actor,
        None,
    )
    .await?;
    if debited.is_none() {
        return Err(AppError::Conflict(
            "that redemption has already debited these points".into(),
        ));
    }

    let (voucher_id, code) = super::vouchers::issue_in_transaction(
        &mut tx,
        super::vouchers::IssuedVoucher {
            kind: "GOODWILL",
            value_minor: voucher_value_minor,
            member_id: Some(customer_id),
            expires_at: request.expires_at,
            actor,
            note: Some("Points redemption"),
        },
    )
    .await?;

    sqlx::query("UPDATE loyalty_redemption SET voucher_id = $2 WHERE redemption_id = $1")
        .bind(redemption_id)
        .bind(voucher_id)
        .execute(&mut *tx)
        .await?;

    // No journal, deliberately, and the reason is a chart question rather than
    // an oversight: the client keeps a loyalty obligation on `66 Hutang
    // Lain-lain`, and 0264 left that account unresolved in the forty-account
    // shape — "it needs its own decision". Booking the promise to a
    // related-party payable would put a shopper's points among money owed to a
    // related company, wrong in a way that still balances, which is the kind
    // that survives a year. So points move in `points_ledger` and the voucher
    // they become is booked where every other voucher is; the deferred-revenue
    // side waits for the account, exactly as 0297 said it would.

    tx.commit().await?;
    Ok(json!({
        "redemption_id": redemption_id,
        "customer_id": customer_id,
        "points_spent": request.points,
        "voucher_value_minor": voucher_value_minor,
        "voucher_id": voucher_id,
        "voucher_code": code,
        "balance_points": balance - request.points,
        "replayed": false,
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// A request starts a redemption; confirming it is what finishes one.
//
// `redeem_points_to_voucher` above has always been reachable in one call by
// whoever is signed in as an operator — the rate is theirs to decide, on
// purpose (see the module doc). Nothing there could ever be reached by a
// shopper's own app, because deciding a rate is not a shopper's decision to
// make. This is the other half: a shopper asks for a number of points, a
// cashier standing at the till reads back the code and confirms, and
// confirming is what applies the rate — fixed here at 1 point = Rp 1 and
// nowhere else, the same way [`confirm_redeem_request`] says.
//
// See migration 0349 for why this is a row per request (a shopper's own
// history screen needs one) rather than the one-slot-per-member shape
// `member_pairing_code` uses.

/// How long a redeem request lives before a cashier has to ask again.
///
/// Same ten minutes as a pairing code, and the same reasoning: long enough to
/// survive a walk to the till, short enough that a code read out is not still
/// good for the next shopper in the queue.
pub const REDEEM_REQUEST_TTL_MINUTES: i64 = 10;

/// Guesses a cashier gets against one member's live request before it locks.
///
/// Same five as a pairing code, same reason — see `postgres/member.rs`.
pub const REDEEM_REQUEST_MAX_ATTEMPTS: i32 = 5;

/// Where a request is in its own life, worked out from its own timestamps and
/// attempt count rather than stored — the same reasoning `ChangeStatus`
/// (`postgres/price_changes.rs`) uses a status column would go stale the
/// instant the clock passed `expires_at` with nobody writing a row to say so.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RedeemRequestStatus {
    /// Live: not yet confirmed, not cancelled, not expired, not locked out.
    Pending,
    Confirmed,
    Cancelled,
    /// Covers both a request whose `expires_at` has passed and one that has
    /// been guessed against too many times — a shopper reading their own
    /// history has no reason to tell those two apart, and a status that split
    /// them would be a status this screen never uses.
    Expired,
}

impl RedeemRequestStatus {
    fn of(
        confirmed_at: Option<DateTime<Utc>>,
        cancelled_at: Option<DateTime<Utc>>,
        expires_at: DateTime<Utc>,
        attempts: i32,
        now: DateTime<Utc>,
    ) -> Self {
        if confirmed_at.is_some() {
            Self::Confirmed
        } else if cancelled_at.is_some() {
            Self::Cancelled
        } else if expires_at <= now || attempts >= REDEEM_REQUEST_MAX_ATTEMPTS {
            Self::Expired
        } else {
            Self::Pending
        }
    }

    fn is_live(self) -> bool {
        matches!(self, Self::Pending)
    }
}

/// A request to turn points into a voucher — reused for a shopper's own
/// history and for what a cashier's lookup answers with. Never carries the
/// code: see [`IssuedRedeemRequest`] for the one response that does.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct RedeemRequest {
    pub request_id: Uuid,
    pub points: i64,
    pub status: RedeemRequestStatus,
    pub requested_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub redemption_id: Option<Uuid>,
}

/// A request, the one moment its code is knowable.
///
/// The same shape `IssuedPairingCode` is, and for the same reason: the six
/// digits are in this response and in no table anywhere — what is stored is a
/// hash, and a code lost before it is shown to a cashier is replaced, not
/// looked up.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct IssuedRedeemRequest {
    pub request_id: Uuid,
    pub points: i64,
    pub code: String,
    pub expires_at: DateTime<Utc>,
}

/// Ask to turn `points` into a voucher.
///
/// Refuses a second live request rather than queuing one behind it — a
/// cashier reading a member's current ask must never have to choose between
/// two, and a member with one already waiting is told to use or let that one
/// lapse first, not handed a second code.
///
/// The balance is checked here so a request nobody could ever honour is never
/// shown to a shopper as "asked". It is checked again, inside a lock, at
/// confirm time — this call only says the ask was reasonable when it was
/// made, not that it still will be when a cashier gets to it.
pub async fn create_redeem_request(
    pool: &PgPool,
    member_id: &str,
    points: i64,
) -> Result<IssuedRedeemRequest, AppError> {
    let member_id = member_id.trim();
    if points <= 0 {
        return Err(AppError::Validation(
            "a redemption has to ask for at least one point".into(),
        ));
    }

    let balance: Option<i64> =
        sqlx::query_scalar("SELECT balance_points FROM points_account WHERE customer_id = $1")
            .bind(member_id)
            .fetch_optional(pool)
            .await?;
    if balance.unwrap_or(0) < points {
        return Err(AppError::Conflict(format!(
            "that member has {} points and the request asked for {points}",
            balance.unwrap_or(0)
        )));
    }

    let now = Utc::now();
    let live = sqlx::query(
        "SELECT confirmed_at, cancelled_at, expires_at, attempts
           FROM member_redeem_request
          WHERE member_id = $1
          ORDER BY requested_at DESC
          LIMIT 1",
    )
    .bind(member_id)
    .fetch_optional(pool)
    .await?
    .is_some_and(|row| {
        let status = RedeemRequestStatus::of(
            row.get("confirmed_at"),
            row.get("cancelled_at"),
            row.get("expires_at"),
            row.get("attempts"),
            now,
        );
        status.is_live()
    });
    if live {
        return Err(AppError::Conflict(
            "a redemption is already waiting to be confirmed".into(),
        ));
    }

    let request_id = Uuid::new_v4();
    let code = security::random_digits(6);
    let expires_at = now + Duration::minutes(REDEEM_REQUEST_TTL_MINUTES);
    sqlx::query(
        "INSERT INTO member_redeem_request
             (request_id, member_id, points, code_sha256, expires_at)
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(request_id)
    .bind(member_id)
    .bind(points)
    .bind(security::sha256_hex(&code))
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(IssuedRedeemRequest {
        request_id,
        points,
        code,
        expires_at,
    })
}

/// A member's own requests, newest first — the "list redeem poin mereka"
/// screen.
pub async fn list_redeem_requests(
    pool: &PgPool,
    member_id: &str,
) -> Result<Vec<RedeemRequest>, AppError> {
    let now = Utc::now();
    let rows = sqlx::query(
        "SELECT request_id, points, requested_at, expires_at, attempts,
                confirmed_at, cancelled_at, redemption_id
           FROM member_redeem_request
          WHERE member_id = $1
          ORDER BY requested_at DESC
          LIMIT 200",
    )
    .bind(member_id.trim())
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|row| {
            let confirmed_at: Option<DateTime<Utc>> = row.get("confirmed_at");
            let cancelled_at: Option<DateTime<Utc>> = row.get("cancelled_at");
            let expires_at: DateTime<Utc> = row.get("expires_at");
            let attempts: i32 = row.get("attempts");
            RedeemRequest {
                request_id: row.get("request_id"),
                points: row.get("points"),
                status: RedeemRequestStatus::of(
                    confirmed_at,
                    cancelled_at,
                    expires_at,
                    attempts,
                    now,
                ),
                requested_at: row.get("requested_at"),
                expires_at,
                redemption_id: row.get("redemption_id"),
            }
        })
        .collect())
}

/// The one answer every failed lookup gives.
///
/// Unknown member, no live request, wrong code, expired code and a locked-out
/// code are one sentence — the same reasoning `pairing_refused` in
/// `postgres/member.rs` gives: a cashier's lookup form must not become a way
/// to learn which card numbers hold a request.
fn redeem_request_refused() -> AppError {
    AppError::Unauthorized("that member has no live redemption request matching that code".into())
}

/// A cashier's guess at a shopper's code, against that member's current live
/// request — there can be at most one, by construction of
/// [`create_redeem_request`], so naming the member is enough to name the
/// request.
///
/// Mirrors `redeem_pairing_code`'s attempt counting exactly, and for the same
/// reason: a counter not written inside the same transaction as the compare
/// is a counter an attacker can race.
pub async fn lookup_redeem_request(
    pool: &PgPool,
    member_id: &str,
    code: &str,
) -> Result<RedeemRequest, AppError> {
    let member_id = member_id.trim();
    let code = code.trim();
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(redeem_request_refused());
    }

    let mut tx = pool.begin().await?;
    let Some(row) = sqlx::query(
        "SELECT request_id, points, code_sha256, requested_at, expires_at,
                attempts, confirmed_at, cancelled_at, redemption_id
           FROM member_redeem_request
          WHERE member_id = $1
          ORDER BY requested_at DESC
          LIMIT 1
          FOR UPDATE",
    )
    .bind(member_id)
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Err(redeem_request_refused());
    };

    let confirmed_at: Option<DateTime<Utc>> = row.get("confirmed_at");
    let cancelled_at: Option<DateTime<Utc>> = row.get("cancelled_at");
    let expires_at: DateTime<Utc> = row.get("expires_at");
    let attempts: i32 = row.get("attempts");
    let stored: String = row.get("code_sha256");
    let request_id: Uuid = row.get("request_id");
    let now = Utc::now();

    if !RedeemRequestStatus::of(confirmed_at, cancelled_at, expires_at, attempts, now).is_live() {
        return Err(redeem_request_refused());
    }

    if !security::constant_time_eq(&security::sha256_hex(code), &stored) {
        // Recorded and committed even on a wrong guess — returning early
        // without committing would make the counter a suggestion, exactly as
        // `redeem_pairing_code` says.
        sqlx::query(
            "UPDATE member_redeem_request SET attempts = attempts + 1 WHERE request_id = $1",
        )
        .bind(request_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Err(redeem_request_refused());
    }

    tx.commit().await?;
    Ok(RedeemRequest {
        request_id,
        points: row.get("points"),
        status: RedeemRequestStatus::Pending,
        requested_at: row.get("requested_at"),
        expires_at,
        redemption_id: row.get("redemption_id"),
    })
}

/// Turn a confirmed request into a voucher: the request's own confirmation
/// and the debit-and-issue underneath it, safe to retry as one call.
///
/// Drives [`redeem_points_to_voucher`] directly with the request's own id as
/// the idempotency key, so a relay call retried after a lost response — the
/// shop's line dropping between the cashier's tap and the till hearing back —
/// is answered from what was already written rather than issuing a second
/// voucher.
///
/// Uses the same server-owned 1:1 conversion as direct redemption.
pub async fn confirm_redeem_request(
    pool: &PgPool,
    request_id: Uuid,
    actor: &str,
) -> Result<Value, AppError> {
    let mut tx = pool.begin().await?;
    let Some(row) = sqlx::query(
        "SELECT member_id, points, expires_at, attempts, confirmed_at, cancelled_at
           FROM member_redeem_request
          WHERE request_id = $1
          FOR UPDATE",
    )
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Err(AppError::NotFound("redeem request".into()));
    };

    let confirmed_at: Option<DateTime<Utc>> = row.get("confirmed_at");
    let cancelled_at: Option<DateTime<Utc>> = row.get("cancelled_at");
    let expires_at: DateTime<Utc> = row.get("expires_at");
    let attempts: i32 = row.get("attempts");
    let member_id: String = row.get("member_id");
    let points: i64 = row.get("points");

    // Already confirmed is not refused — a retry has to land on the voucher
    // already issued, and `redeem_points_to_voucher`'s own idempotency check
    // below is what answers it correctly either way. Only a request that was
    // never confirmed can still be cancelled or expired out from under this
    // call.
    if confirmed_at.is_none() {
        if cancelled_at.is_some() {
            return Err(AppError::Conflict("that request was cancelled".into()));
        }
        if expires_at <= Utc::now() || attempts >= REDEEM_REQUEST_MAX_ATTEMPTS {
            return Err(AppError::Conflict("that request has expired".into()));
        }
    }
    tx.commit().await?;

    let outcome = redeem_points_to_voucher(
        pool,
        RedeemPointsRequest {
            customer_id: member_id,
            points,
            voucher_value_minor: voucher_value_for_points(points),
            actor_id: actor.to_string(),
            idempotency_key: request_id.to_string(),
            expires_at: None,
        },
    )
    .await?;

    let redemption_id: Uuid = outcome
        .get("redemption_id")
        .and_then(Value::as_str)
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| {
            AppError::Configuration("a redemption did not come back with its own id".into())
        })?;

    sqlx::query(
        "UPDATE member_redeem_request
            SET confirmed_at = now(), confirmed_by = $2, redemption_id = $3
          WHERE request_id = $1 AND confirmed_at IS NULL",
    )
    .bind(request_id)
    .bind(actor)
    .bind(redemption_id)
    .execute(pool)
    .await?;

    Ok(outcome)
}

/// A member's balance and the entries behind it.
///
/// The balance is read from the account row and CHECKED against the ledger sum
/// in the same read. They cannot disagree without somebody having written the
/// cache directly, and a screen that showed the cache alone would be the last
/// place anybody found out.
pub async fn points_account(pool: &PgPool, customer_id: &str) -> Result<Value, AppError> {
    let customer_id = customer_id.trim();
    let cached: Option<i64> =
        sqlx::query_scalar("SELECT balance_points FROM points_account WHERE customer_id = $1")
            .bind(customer_id)
            .fetch_optional(pool)
            .await?;
    let summed: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(points), 0)::bigint FROM points_ledger WHERE customer_id = $1",
    )
    .bind(customer_id)
    .fetch_one(pool)
    .await?;

    let entries = sqlx::query(
        "SELECT entry_id, entry_type, points, sale_id, return_id, redemption_id,
                reason, actor, created_at
           FROM points_ledger
          WHERE customer_id = $1
          ORDER BY created_at DESC, entry_id
          LIMIT 200",
    )
    .bind(customer_id)
    .fetch_all(pool)
    .await?;

    Ok(json!({
        "customer_id": customer_id,
        // `null` where the member has never earned or spent — which is not the
        // same as a balance of nought, and a screen can say so.
        "balance_points": cached,
        "ledger_sum": summed,
        // Said out loud rather than silently repaired. A mismatch is a fault to
        // investigate, and repairing it here would hide the cause.
        "reconciles": cached.unwrap_or(0) == summed,
        "entries": entries.iter().map(|row| json!({
            "entry_id": row.get::<Uuid, _>("entry_id"),
            "entry_type": row.get::<String, _>("entry_type"),
            "points": row.get::<i64, _>("points"),
            "sale_id": row.get::<Option<Uuid>, _>("sale_id"),
            "return_id": row.get::<Option<Uuid>, _>("return_id"),
            "redemption_id": row.get::<Option<Uuid>, _>("redemption_id"),
            "reason": row.get::<Option<String>, _>("reason"),
            "actor": row.get::<String, _>("actor"),
            "created_at": row.get::<DateTime<Utc>, _>("created_at"),
        })).collect::<Vec<Value>>(),
    }))
}

/// Every member who holds points, and whether the cached balance is honest.
///
/// ## Why the sum is read beside the cache rather than instead of it
///
/// `points_account.balance_points` is a cache; `points_ledger` is the record.
/// [`points_account`] already checks one member's two figures against each
/// other, and this does the same across the estate in one read — because a
/// screen that showed the cache alone would be the last place anybody found out
/// they had drifted apart, and a screen that showed only the sum would hide
/// that the cache the till reads is wrong.
///
/// A member with no entries is a real row: somebody enrolled, holding nothing.
/// It is a LEFT JOIN for that reason — an inner one would report the estate as
/// having no members the day loyalty launched.
///
/// Paged by keyset, largest balance first: `cursor` is a `next_cursor` from the
/// previous page, and `next_cursor` is present only when the page came back
/// full. The book-wide figures — how much is owed, over how many accounts, and
/// how many do not reconcile — are counted over every account on every page,
/// so the screen never has to add up the rows it happens to have loaded.
pub async fn points_accounts(
    pool: &PgPool,
    cursor: Option<&str>,
    limit: i64,
) -> Result<Value, AppError> {
    let limit = limit.clamp(1, 1000);
    let after = cursor
        .map(super::decode_cursor::<PointsAccountCursor>)
        .transpose()?;
    // The seek reads the previous row's balance from the account table rather
    // than from the cursor, as every keyset here does: a cursor carries an
    // identity, never a value somebody could edit. Both keys descend together,
    // because a row comparison has one direction.
    let rows = sqlx::query(
        "SELECT a.customer_id,
                a.balance_points,
                a.updated_at,
                m.display_name,
                COALESCE(sum(l.points), 0)::bigint AS ledger_sum,
                count(l.entry_id)::bigint          AS entries,
                max(l.created_at)                  AS last_movement
           FROM points_account a
           LEFT JOIN points_ledger l ON l.customer_id = a.customer_id
           LEFT JOIN member m        ON m.member_id   = a.customer_id
          WHERE $1::text IS NULL
             OR (a.balance_points, a.customer_id)
                < (SELECT p.balance_points, p.customer_id
                     FROM points_account p WHERE p.customer_id = $1)
          GROUP BY a.customer_id, a.balance_points, a.updated_at, m.display_name
          ORDER BY a.balance_points DESC, a.customer_id DESC
          LIMIT $2",
    )
    .bind(after.as_ref().map(|one| one.customer_id.clone()))
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            let cached: i64 = row.get("balance_points");
            let summed: i64 = row.get("ledger_sum");
            json!({
                "customer_id": row.get::<String, _>("customer_id"),
                "display_name": row.get::<Option<String>, _>("display_name"),
                "balance_points": cached,
                "ledger_sum": summed,
                // Said out loud rather than silently repaired, exactly as the
                // single-member read says it. A mismatch is a fault to
                // investigate and repairing it in a GET would hide the cause.
                "reconciles": cached == summed,
                "entries": row.get::<i64, _>("entries"),
                "last_movement": row.get::<Option<DateTime<Utc>>, _>("last_movement"),
                "updated_at": row.get::<DateTime<Utc>, _>("updated_at"),
            })
        })
        .collect();

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => {
            Some(super::encode_cursor(&PointsAccountCursor {
                customer_id: row.get("customer_id"),
            })?)
        }
        _ => None,
    };

    // The whole book, not the page. The liability is the cached balances —
    // the figure a till quotes — and the drift count compares each cache with
    // its own entries, exactly as the rows above do.
    let book = sqlx::query(
        "SELECT count(*)::bigint                                       AS accounts,
                COALESCE(sum(a.balance_points), 0)::bigint             AS outstanding,
                count(*) FILTER (WHERE a.balance_points
                                 <> COALESCE(l.summed, 0))::bigint     AS drifted
           FROM points_account a
           LEFT JOIN (SELECT customer_id, sum(points) AS summed
                        FROM points_ledger GROUP BY customer_id) l
                  ON l.customer_id = a.customer_id",
    )
    .fetch_one(pool)
    .await?;

    Ok(json!({
        "items": items,
        "next_cursor": next_cursor,
        "account_count": book.get::<i64, _>("accounts"),
        "outstanding_points": book.get::<i64, _>("outstanding"),
        "accounts_not_reconciling": book.get::<i64, _>("drifted"),
    }))
}

/// Where a page of the account book stopped — the account, not its balance.
#[derive(Serialize, Deserialize)]
struct PointsAccountCursor {
    customer_id: String,
}

/// Where a page of the points ledger stopped — the entry, not its time.
#[derive(Serialize, Deserialize)]
struct PointsEntryCursor {
    entry_id: Uuid,
}

/// Points movements across the estate, newest first.
///
/// Every entry names its cause — a sale, a return, a redemption — and exactly
/// one of those columns is set, which the database's partial unique indexes
/// enforce. They are passed through rather than flattened into one "reference"
/// so a reader can tell a reversal from an award without reading the type
/// twice.
///
/// `customer_id` narrows to one member. Absent, this is the estate's ledger,
/// which is the question "what has loyalty been doing this week" — and the one
/// [`points_account`] cannot answer, because it is asked of one member.
///
/// Paged by keyset on `(created_at, entry_id)`, both descending: `cursor` is a
/// `next_cursor` from the previous page, and one is returned only when the
/// page came back full.
pub async fn points_ledger(
    pool: &PgPool,
    customer_id: Option<&str>,
    cursor: Option<&str>,
    limit: i64,
) -> Result<Value, AppError> {
    let limit = limit.clamp(1, 1000);
    let after = cursor
        .map(super::decode_cursor::<PointsEntryCursor>)
        .transpose()?;
    let rows = sqlx::query(
        "SELECT l.entry_id, l.customer_id, m.display_name, l.entry_type, l.points,
                l.sale_id, l.return_id, l.redemption_id, l.reason, l.actor, l.created_at
           FROM points_ledger l
           LEFT JOIN member m ON m.member_id = l.customer_id
          WHERE ($1::text IS NULL OR l.customer_id = $1)
            AND ($2::uuid IS NULL
                 OR (l.created_at, l.entry_id)
                    < (SELECT p.created_at, p.entry_id
                         FROM points_ledger p WHERE p.entry_id = $2))
          ORDER BY l.created_at DESC, l.entry_id DESC
          LIMIT $3",
    )
    .bind(customer_id.map(str::trim))
    .bind(after.as_ref().map(|one| one.entry_id))
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => {
            Some(super::encode_cursor(&PointsEntryCursor {
                entry_id: row.get("entry_id"),
            })?)
        }
        _ => None,
    };

    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "entry_id": row.get::<Uuid, _>("entry_id"),
                "customer_id": row.get::<String, _>("customer_id"),
                "display_name": row.get::<Option<String>, _>("display_name"),
                "entry_type": row.get::<String, _>("entry_type"),
                "points": row.get::<i64, _>("points"),
                "sale_id": row.get::<Option<Uuid>, _>("sale_id"),
                "return_id": row.get::<Option<Uuid>, _>("return_id"),
                "redemption_id": row.get::<Option<Uuid>, _>("redemption_id"),
                "reason": row.get::<Option<String>, _>("reason"),
                "actor": row.get::<String, _>("actor"),
                "created_at": row.get::<DateTime<Utc>, _>("created_at"),
            })
        })
        .collect();

    Ok(json!({ "items": items, "next_cursor": next_cursor }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Stable ids so a failure names a line rather than a fresh uuid.
    fn line(nth: u8, points: Option<i64>) -> LineAward {
        LineAward {
            sale_line_id: Uuid::from_bytes([nth; 16]),
            points_earned: points,
        }
    }

    fn id(nth: u8) -> Uuid {
        Uuid::from_bytes([nth; 16])
    }

    /// Golden fixture G01: a basket that earned 638, allocated 438 and 200.
    #[test]
    fn a_full_return_reverses_exactly_what_the_basket_was_awarded() {
        let plan = plan_return_reversal(&[line(1, Some(438)), line(2, Some(200))]);
        assert_eq!(plan.points, 638);
        assert!(plan.unrecorded.is_empty());
    }

    /// The reason 0166 exists. Half of 638 is 319, and the shopper
    /// returning the 438 line is owed 438 back — dividing the basket total
    /// would take 119 too few, and doing it the other way round would take 119
    /// too many from the other line's owner later.
    #[test]
    fn a_partial_return_reverses_that_lines_award_and_not_a_share_of_the_basket() {
        let plan = plan_return_reversal(&[line(1, Some(438))]);
        assert_eq!(plan.points, 438);
        assert_ne!(plan.points, 638 / 2);
    }

    /// Returning the lines one at a time comes to the same as returning them
    /// together. It does for sums and does not for any scheme that divides, and
    /// that equality is the invariant the snapshot buys.
    #[test]
    fn two_partial_returns_take_back_the_same_total_as_one_full_return() {
        let basket = [line(1, Some(438)), line(2, Some(200))];
        let first = plan_return_reversal(&basket[..1]).points;
        let second = plan_return_reversal(&basket[1..]).points;
        assert_eq!(first + second, plan_return_reversal(&basket).points);
    }

    /// A line the engine awarded nothing for — a nought it actually recorded —
    /// is not the same as a line nobody recorded, and only the second is
    /// reported for a person to settle.
    #[test]
    fn a_line_recorded_as_earning_nothing_is_not_a_line_with_no_record() {
        let recorded = plan_return_reversal(&[line(1, Some(0))]);
        assert_eq!(recorded.points, 0);
        assert!(recorded.unrecorded.is_empty());

        let missing = plan_return_reversal(&[line(1, None)]);
        assert_eq!(missing.points, 0);
        assert_eq!(missing.unrecorded, vec![id(1)]);
    }

    /// The 21,829 sales already here have no award on any line. Reversing
    /// nought for them and saying nothing would look identical to a correct
    /// reversal, which is how the shortfall would go unnoticed.
    #[test]
    fn a_line_with_no_recorded_award_is_named_rather_than_counted_as_nothing() {
        let plan = plan_return_reversal(&[line(1, Some(438)), line(2, None), line(3, Some(200))]);
        assert_eq!(plan.points, 638);
        assert_eq!(plan.unrecorded, vec![id(2)]);
    }

    /// A return must never move a member's balance upward. A negative snapshot
    /// cannot be an award, so it is reported as unrecorded instead of added.
    #[test]
    fn a_negative_snapshot_credits_nobody_and_is_reported_as_unrecorded() {
        let plan = plan_return_reversal(&[line(1, Some(438)), line(2, Some(-100))]);
        assert_eq!(plan.points, 438);
        assert_eq!(plan.unrecorded, vec![id(2)]);
    }

    /// A corrupt figure at the integer ceiling pins rather than wrapping.
    /// Wrapping would make `points` negative, and `reverse_for_return` refuses
    /// anything not positive — so the reversal would silently not happen.
    #[test]
    fn an_award_at_the_integer_ceiling_pins_instead_of_wrapping_negative() {
        let plan = plan_return_reversal(&[line(1, Some(i64::MAX)), line(2, Some(1))]);
        assert_eq!(plan.points, i64::MAX);
    }

    /// Nothing returned reverses nothing, and names nobody.
    #[test]
    fn a_return_of_no_lines_reverses_nothing() {
        assert_eq!(plan_return_reversal(&[]), ReversalPlan::default());
    }
}
