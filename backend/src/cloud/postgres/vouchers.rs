//! Vouchers: value a customer already holds, and every time it moved.
//!
//! The screen this serves used to say the feature did not exist, and it was
//! right — `grep -ri voucher backend/` found two comments and no schema. What
//! it also said is the order the three pieces have to arrive in: somewhere to
//! hold a code and a balance, a command that issues one and books the
//! liability, and a tender at the till that redeems against it. This module is
//! the middle piece, and `0090` is the first.
//!
//! **Every write here is money.** That shapes two things a reader will notice:
//!
//!   * a redemption takes a row lock (`FOR UPDATE`) before it looks at the
//!     balance. Two tills presenting the same card at the same instant is not
//!     a theoretical race — a card lives in one wallet and is spent in one
//!     shop, but a retried request from a flaky till is exactly the same
//!     shape, and read-then-write without the lock spends the last 40,000
//!     twice;
//!   * the balance is never simply set. Every change writes a movement stating
//!     the balance it left behind, and `0090`'s deferred trigger refuses the
//!     transaction if the two disagree. So the fast column and the audit trail
//!     cannot drift, and no code path here is trusted to keep them together.

use super::{begin_idempotent, complete_idempotent};
use crate::cloud::{
    application::AppError,
    domain::{mint_code, normalize_code, VoucherKind, VoucherStatus},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

/// One voucher, as a list draws it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoucherRow {
    pub voucher_id: Uuid,
    /// What is printed on the card. The identifier everybody outside this
    /// system uses, which is why the routes are keyed on it rather than on the
    /// uuid — a shopper at a counter can read this out.
    pub code: String,
    pub kind: String,
    pub currency: String,
    /// The face value, frozen at issue.
    pub issued_minor: i64,
    /// What is left on it. The shop's liability, one card's worth.
    pub balance_minor: i64,
    /// What has come off it. Derived rather than stored, because a stored copy
    /// of `issued - balance` is a third number that can disagree with the two
    /// it came from.
    pub spent_minor: i64,
    pub status: String,
    pub member_id: Option<String>,
    /// So the list can name a holder without a second round trip per row.
    pub member_name: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    /// Past its date, with value still on it.
    ///
    /// Computed against the database's clock, not stored: a voucher does not
    /// change when it expires, the date simply passes. Storing EXPIRED would
    /// be a status that is wrong from the moment it is written until something
    /// sweeps the table.
    pub expired: bool,
    pub issued_at: DateTime<Utc>,
    pub issued_by: String,
    pub issued_site: Option<String>,
    pub note: Option<String>,
    pub version: i32,
    pub movement_count: i64,
    pub last_movement_at: Option<DateTime<Utc>>,
}

/// One change to a balance, and what caused it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoucherMovementRow {
    pub movement_id: Uuid,
    pub seq: i32,
    pub kind: String,
    /// Signed: issue adds, redeem and void subtract. So the movements sum to
    /// the balance, and anyone with psql can check the arithmetic.
    pub amount_minor: i64,
    pub balance_after_minor: i64,
    pub sale_id: Option<Uuid>,
    pub site_id: Option<String>,
    pub actor: String,
    pub occurred_at: DateTime<Utc>,
    pub note: Option<String>,
}

/// A voucher and its whole history.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoucherDetail {
    pub voucher: VoucherRow,
    pub movements: Vec<VoucherMovementRow>,
}

/// What the whole book of vouchers comes to.
///
/// `outstanding_minor` is the number a finance team asks for and the reason
/// this summary exists at all: it is what the shop owes in goods it has
/// already been paid for. A list of cards cannot be scanned for it, and a
/// screen that showed only rows would leave the one figure that matters to be
/// worked out on a calculator.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoucherLedger {
    pub issued_count: i64,
    pub issued_minor: i64,
    pub outstanding_count: i64,
    /// The liability. Every active voucher's remaining balance, expired ones
    /// included — an expired card is still money the shop is holding until
    /// somebody decides to write it off, and quietly excluding it here would
    /// be the shop marking its own homework.
    pub outstanding_minor: i64,
    pub redeemed_minor: i64,
    /// Value taken off cards that were stopped rather than spent. A write-off,
    /// kept separate from redemption because one is a customer being served
    /// and the other is a decision somebody made.
    pub voided_minor: i64,
    pub expired_count: i64,
    /// Outstanding, past its date. The number that turns into either revenue
    /// or a complaint, depending on how it is handled.
    pub expired_minor: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoucherList {
    pub vouchers: Vec<VoucherRow>,
    /// Over the WHOLE book, not over the page or the filter. A liability that
    /// changed because somebody typed in the search box would be a liability
    /// nobody could quote.
    pub ledger: VoucherLedger,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct VoucherQuery {
    pub status: Option<String>,
    pub kind: Option<String>,
    pub member_id: Option<String>,
    /// Matches a code or a holder's name. A cashier holding a card types the
    /// code; a supervisor chasing a complaint types the name.
    pub q: Option<String>,
    pub limit: Option<i64>,
}

const DEFAULT_PAGE: i64 = 200;
const MAX_PAGE: i64 = 1_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IssueVoucherRequest {
    /// Supplied only when the card already exists in the physical world —
    /// pre-printed stock with a code on the back. Left out, one is minted from
    /// an alphabet that drops the four characters people misread.
    #[serde(default)]
    pub code: Option<String>,
    pub kind: String,
    /// The face value, in minor units. Positive: a voucher for nothing is not
    /// a voucher, and a negative one is a debt the shop just handed somebody.
    pub value_minor: i64,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub member_id: Option<String>,
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RedeemVoucherRequest {
    /// How much of the card this basket took. Partial by design: a 200,000
    /// card against a 150,000 basket leaves 50,000 on the card, which is the
    /// behaviour a shopper expects and the reason a voucher is not a coupon.
    pub amount_minor: i64,
    /// Which basket it paid for. No foreign key behind it — the sale may live
    /// at an edge node the centre has not received yet, and a redemption that
    /// waited for the sale to arrive would fail at exactly the moment a queue
    /// is watching.
    #[serde(default)]
    pub sale_id: Option<Uuid>,
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoidVoucherRequest {
    /// Required, and required in words. Stopping a card with money on it is
    /// somebody taking value away from a customer; "why" is the whole record
    /// of that decision, and a nullable column here would be a blank one.
    pub reason: String,
}

/// The list projection, in one place. Two callers read it — the list and the
/// detail — and two spellings of a nine-column projection drift.
const VOUCHER_COLUMNS: &str = "
    SELECT v.voucher_id, v.code, v.kind, v.currency,
           v.issued_minor, v.balance_minor,
           (v.issued_minor - v.balance_minor) AS spent_minor,
           v.status, v.member_id, m.display_name AS member_name,
           v.expires_at,
           (v.expires_at IS NOT NULL AND v.expires_at <= now()
            AND v.status = 'ACTIVE')                       AS expired,
           v.issued_at, v.issued_by, v.issued_site, v.note, v.version,
           (SELECT count(*) FROM voucher_movement mv
             WHERE mv.voucher_id = v.voucher_id)::bigint   AS movement_count,
           (SELECT max(occurred_at) FROM voucher_movement mv
             WHERE mv.voucher_id = v.voucher_id)           AS last_movement_at
      FROM voucher v
      LEFT JOIN member m ON m.member_id = v.member_id";

fn voucher_from_row(row: &PgRow) -> Result<VoucherRow, AppError> {
    Ok(VoucherRow {
        voucher_id: row.try_get("voucher_id")?,
        code: row.try_get("code")?,
        kind: row.try_get("kind")?,
        currency: row.try_get("currency")?,
        issued_minor: row.try_get("issued_minor")?,
        balance_minor: row.try_get("balance_minor")?,
        spent_minor: row.try_get("spent_minor")?,
        status: row.try_get("status")?,
        member_id: row.try_get("member_id")?,
        member_name: row.try_get("member_name")?,
        expires_at: row.try_get("expires_at")?,
        expired: row.try_get("expired")?,
        issued_at: row.try_get("issued_at")?,
        issued_by: row.try_get("issued_by")?,
        issued_site: row.try_get("issued_site")?,
        note: row.try_get("note")?,
        version: row.try_get("version")?,
        movement_count: row.try_get("movement_count")?,
        last_movement_at: row.try_get("last_movement_at")?,
    })
}

fn movement_from_row(row: &PgRow) -> Result<VoucherMovementRow, AppError> {
    Ok(VoucherMovementRow {
        movement_id: row.try_get("movement_id")?,
        seq: row.try_get("seq")?,
        kind: row.try_get("kind")?,
        amount_minor: row.try_get("amount_minor")?,
        balance_after_minor: row.try_get("balance_after_minor")?,
        sale_id: row.try_get("sale_id")?,
        site_id: row.try_get("site_id")?,
        actor: row.try_get("actor")?,
        occurred_at: row.try_get("occurred_at")?,
        note: row.try_get("note")?,
    })
}

/// A unique violation here is one thing and one thing only, and `23505` tells
/// a cashier none of it.
fn map_voucher_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => AppError::Conflict(
                "a voucher with that code already exists — a code identifies one card".to_owned(),
            ),
            Some("23503") => AppError::Validation(
                "that member is not enrolled, so a voucher cannot be held by them".to_owned(),
            ),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

fn required_currency(raw: Option<&str>) -> Result<String, AppError> {
    // IDR by default because that is what every price in this system is in.
    // Still a column and not a constant: a gift card is denominated when it is
    // sold, and a shop that starts selling in a second currency should not
    // need a migration to say so.
    let currency = raw.unwrap_or("IDR").trim().to_ascii_uppercase();
    if currency.len() != 3 || !currency.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err(AppError::Validation(format!(
            "currency {currency:?} is not a three-letter code"
        )));
    }
    Ok(currency)
}

/// Trimmed, or absent. An empty string in a nullable column is a third state
/// nobody means: neither a note nor the absence of one.
fn optional_text(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// Every voucher, and what the book comes to.
///
/// Filters narrow the rows and never the ledger. That is deliberate: the
/// summary is the shop's liability, and a liability that shrank because
/// somebody typed in a search box is a number nobody could quote to an
/// accountant.
pub async fn list_vouchers(pool: &PgPool, query: VoucherQuery) -> Result<VoucherList, AppError> {
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let status = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(VoucherStatus::from_str)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?
        .map(|status| status.as_str().to_owned());
    let kind = query
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(VoucherKind::from_str)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?
        .map(|kind| kind.as_str().to_owned());
    let member_id = optional_text(query.member_id.as_deref());
    // Searched against the normalised code, so somebody who types the code the
    // way it is printed — in groups, with a dash — still finds the card.
    let search = optional_text(query.q.as_deref()).map(|term| {
        let stripped: String = term
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '-')
            .collect();
        stripped.to_uppercase()
    });

    let rows = sqlx::query(&format!(
        "{VOUCHER_COLUMNS}
          WHERE ($1::text IS NULL OR v.status = $1)
            AND ($2::text IS NULL OR v.kind = $2)
            AND ($3::text IS NULL OR v.member_id = $3)
            AND ($4::text IS NULL
                 OR v.code LIKE '%' || $4 || '%'
                 OR upper(COALESCE(m.display_name, '')) LIKE '%' || $4 || '%'
                 OR upper(COALESCE(v.member_id, '')) LIKE '%' || $4 || '%')
          ORDER BY v.issued_at DESC, v.code
          LIMIT $5"
    ))
    .bind(&status)
    .bind(&kind)
    .bind(&member_id)
    .bind(&search)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(VoucherList {
        vouchers: rows
            .iter()
            .map(voucher_from_row)
            .collect::<Result<Vec<_>, _>>()?,
        ledger: voucher_ledger(pool).await?,
    })
}

/// The book, added up. One query rather than five, because five would be five
/// scans of the same table to answer one strip of figures.
pub async fn voucher_ledger(pool: &PgPool) -> Result<VoucherLedger, AppError> {
    let row = sqlx::query(
        "SELECT count(*)::bigint                                       AS issued_count,
                COALESCE(sum(issued_minor), 0)::bigint                 AS issued_minor,
                count(*) FILTER (WHERE status = 'ACTIVE')::bigint      AS outstanding_count,
                COALESCE(sum(balance_minor)
                         FILTER (WHERE status = 'ACTIVE'), 0)::bigint  AS outstanding_minor,
                count(*) FILTER (WHERE status = 'ACTIVE'
                                   AND expires_at IS NOT NULL
                                   AND expires_at <= now())::bigint    AS expired_count,
                COALESCE(sum(balance_minor)
                         FILTER (WHERE status = 'ACTIVE'
                                   AND expires_at IS NOT NULL
                                   AND expires_at <= now()), 0)::bigint AS expired_minor,
                -- From the movements, not from the header: what came off a
                -- card and what was written off are two different events and
                -- the header remembers neither, only the total that is left.
                COALESCE((SELECT -sum(amount_minor) FROM voucher_movement
                           WHERE kind = 'REDEEM'), 0)::bigint          AS redeemed_minor,
                COALESCE((SELECT -sum(amount_minor) FROM voucher_movement
                           WHERE kind = 'VOID'), 0)::bigint            AS voided_minor
           FROM voucher",
    )
    .fetch_one(pool)
    .await?;

    Ok(VoucherLedger {
        issued_count: row.try_get("issued_count")?,
        issued_minor: row.try_get("issued_minor")?,
        outstanding_count: row.try_get("outstanding_count")?,
        outstanding_minor: row.try_get("outstanding_minor")?,
        redeemed_minor: row.try_get("redeemed_minor")?,
        voided_minor: row.try_get("voided_minor")?,
        expired_count: row.try_get("expired_count")?,
        expired_minor: row.try_get("expired_minor")?,
    })
}

/// One card, with everything that has happened to it.
pub async fn voucher_detail(pool: &PgPool, code: &str) -> Result<VoucherDetail, AppError> {
    let code = normalize_code(code).map_err(|error| AppError::Validation(error.to_string()))?;
    let row = sqlx::query(&format!("{VOUCHER_COLUMNS} WHERE v.code = $1"))
        .bind(&code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Voucher".to_owned()))?;
    let voucher = voucher_from_row(&row)?;
    let movements = sqlx::query(
        "SELECT movement_id, seq, kind, amount_minor, balance_after_minor,
                sale_id, site_id, actor, occurred_at, note
           FROM voucher_movement WHERE voucher_id = $1 ORDER BY seq",
    )
    .bind(voucher.voucher_id)
    .fetch_all(pool)
    .await?;
    Ok(VoucherDetail {
        voucher,
        movements: movements
            .iter()
            .map(movement_from_row)
            .collect::<Result<Vec<_>, _>>()?,
    })
}

/// Read one voucher back inside the transaction that just changed it.
///
/// Read back rather than assembled in Rust, so the row this answers with and
/// the row the next list draws cannot disagree about a default, a trigger or a
/// derived column.
async fn read_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    voucher_id: Uuid,
) -> Result<VoucherRow, AppError> {
    let row = sqlx::query(&format!("{VOUCHER_COLUMNS} WHERE v.voucher_id = $1"))
        .bind(voucher_id)
        .fetch_one(&mut **tx)
        .await?;
    voucher_from_row(&row)
}

/// Put a voucher into the world.
///
/// Idempotent like every other write here, and for a sharper reason than most:
/// a retried issue is a second gift card the shop did not sell, which is money
/// given away by a network timeout.
pub async fn issue_voucher(
    pool: &PgPool,
    request: IssueVoucherRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<VoucherRow, AppError> {
    let kind = VoucherKind::from_str(&request.kind)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    if request.value_minor <= 0 {
        return Err(AppError::Validation(
            "a voucher has to carry something — its value must be above zero".into(),
        ));
    }
    let currency = required_currency(request.currency.as_deref())?;
    let code = match optional_text(request.code.as_deref()) {
        Some(supplied) => {
            normalize_code(&supplied).map_err(|error| AppError::Validation(error.to_string()))?
        }
        // Twelve characters from `uuid`'s CSPRNG. A voucher code is a bearer
        // token — whoever reads it can spend it — so it is minted the way one
        // is, not counted up from the last card issued.
        None => mint_code(
            Uuid::new_v4().as_bytes()[..12]
                .try_into()
                .expect("a uuid is sixteen bytes"),
        ),
    };
    if let Some(expires_at) = request.expires_at {
        if expires_at <= Utc::now() {
            return Err(AppError::Validation(
                "a voucher that has already expired cannot be issued".into(),
            ));
        }
    }
    let actor = actor.trim();
    if actor.is_empty() {
        return Err(AppError::Validation(
            "issuing a voucher has to be attributable to somebody".into(),
        ));
    }
    let member_id = optional_text(request.member_id.as_deref());
    let site_id = optional_text(request.site_id.as_deref());
    let note = optional_text(request.note.as_deref());

    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, idempotency_key, "voucher.issue", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let voucher_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO voucher (voucher_id, code, kind, currency, issued_minor,
                              balance_minor, status, member_id, expires_at,
                              issued_by, issued_site, note)
         VALUES ($1, $2, $3, $4, $5, $5, 'ACTIVE', $6, $7, $8, $9, $10)",
    )
    .bind(voucher_id)
    .bind(&code)
    .bind(kind.as_str())
    .bind(&currency)
    .bind(request.value_minor)
    .bind(&member_id)
    .bind(request.expires_at)
    .bind(actor)
    .bind(&site_id)
    .bind(&note)
    .execute(&mut *tx)
    .await
    .map_err(map_voucher_write_error)?;

    // Seq 0. The issue is a movement like any other, so a card's history reads
    // from the beginning rather than starting at its first spend.
    sqlx::query(
        "INSERT INTO voucher_movement (movement_id, voucher_id, seq, kind,
                                       amount_minor, balance_after_minor,
                                       site_id, actor, note)
         VALUES ($1, $2, 0, 'ISSUE', $3, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(voucher_id)
    .bind(request.value_minor)
    .bind(&site_id)
    .bind(actor)
    .bind(&note)
    .execute(&mut *tx)
    .await
    .map_err(map_voucher_write_error)?;

    let voucher = read_in_transaction(&mut tx, voucher_id).await?;
    complete_idempotent(&mut tx, idempotency_key, &serde_json::to_value(&voucher)?).await?;
    tx.commit().await?;
    Ok(voucher)
}

/// Lock one card and say what it is worth right now.
///
/// `FOR UPDATE` before anything is read, not after. The whole point is that
/// the balance this returns cannot have changed by the time it is spent.
async fn lock_voucher(
    tx: &mut Transaction<'_, Postgres>,
    code: &str,
) -> Result<(Uuid, i64, String, Option<DateTime<Utc>>, String), AppError> {
    let row = sqlx::query(
        "SELECT voucher_id, balance_minor, status, expires_at, currency
           FROM voucher WHERE code = $1 FOR UPDATE",
    )
    .bind(code)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Voucher".to_owned()))?;
    Ok((
        row.try_get("voucher_id")?,
        row.try_get("balance_minor")?,
        row.try_get("status")?,
        row.try_get("expires_at")?,
        row.try_get("currency")?,
    ))
}

/// Spend some of a card against a basket.
///
/// Partial by design, and that is the behaviour that separates a voucher from
/// a coupon: 150,000 taken off a 200,000 card leaves 50,000 on it and nothing
/// in the shopper's hand. Change from a gift card would be the shop converting
/// its own liability into cash on the customer's behalf.
pub async fn redeem_voucher(
    pool: &PgPool,
    code: &str,
    request: RedeemVoucherRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<VoucherDetail, AppError> {
    let code = normalize_code(code).map_err(|error| AppError::Validation(error.to_string()))?;
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a redemption has to take something off the card".into(),
        ));
    }
    let actor = actor.trim();
    if actor.is_empty() {
        return Err(AppError::Validation(
            "a redemption has to be attributable to somebody".into(),
        ));
    }
    let site_id = optional_text(request.site_id.as_deref());
    let note = optional_text(request.note.as_deref());

    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, idempotency_key, "voucher.redeem", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let (voucher_id, balance, status, expires_at, _currency) = lock_voucher(&mut tx, &code).await?;

    // Each refusal says which of the four things went wrong. "Cannot redeem"
    // is the answer that sends a cashier to a supervisor and a supervisor to a
    // developer.
    match status.as_str() {
        "SPENT" => {
            return Err(AppError::Conflict(
                "that voucher has already been spent to nothing".into(),
            ));
        }
        "VOIDED" => {
            return Err(AppError::Conflict(
                "that voucher was stopped and cannot be spent".into(),
            ));
        }
        _ => {}
    }
    if let Some(expiry) = expires_at {
        if expiry <= Utc::now() {
            return Err(AppError::Conflict(format!(
                "that voucher expired on {}",
                expiry.date_naive()
            )));
        }
    }
    if request.amount_minor > balance {
        return Err(AppError::Conflict(format!(
            "the voucher has {balance} left and the basket asked for {}",
            request.amount_minor
        )));
    }

    let remaining = balance - request.amount_minor;
    let next_status = if remaining == 0 {
        VoucherStatus::Spent
    } else {
        VoucherStatus::Active
    };
    sqlx::query(
        "UPDATE voucher SET balance_minor = $2, status = $3, version = version + 1
          WHERE voucher_id = $1",
    )
    .bind(voucher_id)
    .bind(remaining)
    .bind(next_status.as_str())
    .execute(&mut *tx)
    .await
    .map_err(map_voucher_write_error)?;

    append_movement(
        &mut tx,
        voucher_id,
        "REDEEM",
        -request.amount_minor,
        remaining,
        request.sale_id,
        site_id.as_deref(),
        actor,
        note.as_deref(),
    )
    .await?;

    let detail = detail_in_transaction(&mut tx, voucher_id).await?;
    complete_idempotent(&mut tx, idempotency_key, &serde_json::to_value(&detail)?).await?;
    tx.commit().await?;
    Ok(detail)
}

/// Stop a card and write off what is left on it.
///
/// The remaining value is taken to zero by a movement rather than by setting
/// the column, so the write-off is a row somebody can find with a date, an
/// actor and a reason on it. A balance that simply became zero is the shape of
/// a bug and the shape of a fraud, and neither should be indistinguishable
/// from a decision.
pub async fn void_voucher(
    pool: &PgPool,
    code: &str,
    request: VoidVoucherRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<VoucherDetail, AppError> {
    let code = normalize_code(code).map_err(|error| AppError::Validation(error.to_string()))?;
    let reason = optional_text(Some(&request.reason)).ok_or_else(|| {
        AppError::Validation(
            "stopping a voucher takes value away from a customer, so it needs a reason".into(),
        )
    })?;
    let actor = actor.trim();
    if actor.is_empty() {
        return Err(AppError::Validation(
            "stopping a voucher has to be attributable to somebody".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, idempotency_key, "voucher.void", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let (voucher_id, balance, status, _expires_at, _currency) =
        lock_voucher(&mut tx, &code).await?;
    match status.as_str() {
        "VOIDED" => {
            return Err(AppError::Conflict(
                "that voucher was already stopped".into(),
            ));
        }
        // Nothing to stop and nothing to write off. Refused rather than
        // accepted as a no-op, because somebody reaching for this on a spent
        // card is looking for a different tool — a return, most likely.
        "SPENT" => {
            return Err(AppError::Conflict(
                "that voucher is already spent to nothing, so there is nothing to stop".into(),
            ));
        }
        _ => {}
    }

    sqlx::query(
        "UPDATE voucher SET balance_minor = 0, status = 'VOIDED', version = version + 1
          WHERE voucher_id = $1",
    )
    .bind(voucher_id)
    .execute(&mut *tx)
    .await
    .map_err(map_voucher_write_error)?;

    append_movement(
        &mut tx,
        voucher_id,
        "VOID",
        -balance,
        0,
        None,
        None,
        actor,
        Some(&reason),
    )
    .await?;

    let detail = detail_in_transaction(&mut tx, voucher_id).await?;
    complete_idempotent(&mut tx, idempotency_key, &serde_json::to_value(&detail)?).await?;
    tx.commit().await?;
    Ok(detail)
}

/// Append one movement, taking the next position from the rows already there.
///
/// The sequence is read inside the same transaction that holds the row lock,
/// so two redemptions cannot both think they are number three.
#[allow(clippy::too_many_arguments)]
async fn append_movement(
    tx: &mut Transaction<'_, Postgres>,
    voucher_id: Uuid,
    kind: &str,
    amount_minor: i64,
    balance_after_minor: i64,
    sale_id: Option<Uuid>,
    site_id: Option<&str>,
    actor: &str,
    note: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO voucher_movement (movement_id, voucher_id, seq, kind,
                                       amount_minor, balance_after_minor,
                                       sale_id, site_id, actor, note)
         SELECT $1, $2,
                COALESCE(max(seq) + 1, 0), $3, $4, $5, $6, $7, $8, $9
           FROM voucher_movement WHERE voucher_id = $2",
    )
    .bind(Uuid::new_v4())
    .bind(voucher_id)
    .bind(kind)
    .bind(amount_minor)
    .bind(balance_after_minor)
    .bind(sale_id)
    .bind(site_id)
    .bind(actor)
    .bind(note)
    .execute(&mut **tx)
    .await
    .map_err(map_voucher_write_error)?;
    Ok(())
}

async fn detail_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    voucher_id: Uuid,
) -> Result<VoucherDetail, AppError> {
    let voucher = read_in_transaction(tx, voucher_id).await?;
    let movements = sqlx::query(
        "SELECT movement_id, seq, kind, amount_minor, balance_after_minor,
                sale_id, site_id, actor, occurred_at, note
           FROM voucher_movement WHERE voucher_id = $1 ORDER BY seq",
    )
    .bind(voucher_id)
    .fetch_all(&mut **tx)
    .await?;
    Ok(VoucherDetail {
        voucher,
        movements: movements
            .iter()
            .map(movement_from_row)
            .collect::<Result<Vec<_>, _>>()?,
    })
}
