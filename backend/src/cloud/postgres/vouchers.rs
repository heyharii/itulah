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
use serde_json::{json, Value};
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
    pub rows: Vec<VoucherRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    ///
    /// Deliberately not an offset. Cards are issued and spent while somebody
    /// pages through them, and an offset would skip or repeat rows with nothing
    /// saying so — on a list where every row is money the shop owes.
    pub next_cursor: Option<String>,
    /// Every card the search and the filters match — not just this page.
    ///
    /// Distinct from `ledger.issued_count`, and the difference is the point:
    /// `total` describes the LIST, and the ledger describes the BOOK. A search
    /// for one customer's cards should say "3" above the rows and still say
    /// what the shop owes everybody.
    pub total: i64,
    pub facets: VoucherFacets,
    /// Over the WHOLE book, not over the page or the filter. A liability that
    /// changed because somebody typed in the search box would be a liability
    /// nobody could quote.
    pub ledger: VoucherLedger,
}

/// One value a filter can take, and how many cards would still be there.
///
/// Counted over everything the search and the holder leave, deliberately
/// ignoring which boxes are ticked — so the number beside `ACTIVE` answers "how
/// many live cards are there", which is the question somebody has while
/// deciding whether to click it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoucherFacet {
    pub value: String,
    pub count: i64,
}

/// The two things this list can be narrowed by.
///
/// The holder is not among them. `member_id` scopes WHICH BOOK is being looked
/// at rather than narrowing a list of it — the members screen opens this at one
/// customer — so the counts are taken inside that scope, exactly as the
/// workforce list counts inside a manager's reach.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoucherFacets {
    pub statuses: Vec<VoucherFacet>,
    pub kinds: Vec<VoucherFacet>,
}

/// Where the previous page stopped — as a ROW, not as a position.
#[derive(Serialize, Deserialize)]
struct VoucherCursor {
    voucher_id: Uuid,
}

/// What a caller is asking the voucher list for.
///
/// `deny_unknown_fields`, so a misspelled filter is refused rather than quietly
/// ignored: `?statuss=ACTIVE` narrows nothing and the screen shows the whole
/// book under a filter somebody believes is applied.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VoucherQuery {
    pub status: Option<String>,
    pub kind: Option<String>,
    pub member_id: Option<String>,
    /// Matches a code or a holder's name. A cashier holding a card types the
    /// code; a supervisor chasing a complaint types the name.
    pub q: Option<String>,
    /// `issued` (the default), `code`, `value`, `balance` or `expires`.
    ///
    /// Anything unrecognised falls back to `issued` rather than refusing: a
    /// sort arrives from a URL somebody may have kept from an older build, and
    /// a 400 for a stale bookmark is a worse answer than the rows in the house
    /// order.
    pub sort: Option<String>,
    /// `asc` or `desc`. Absent means each key's OWN natural direction, which is
    /// the one place this list departs from the estate's `dir=desc` convention
    /// and it is deliberate: a book of cards is read newest first, and money
    /// columns are read biggest first, while a code and an expiry date are read
    /// forwards. Making every key default to ascending would open this screen
    /// on the oldest card the shop ever issued.
    pub dir: Option<String>,
    /// The Status column's own reading: `ACTIVE`, `SPENT`, `VOIDED`, or
    /// `EXPIRED` — a live card past its date, which is the clock and not a
    /// stored status, so `status` above cannot ask for it. ANDed with `status`,
    /// exactly as the docked chip ANDs with the segment.
    pub state: Option<String>,
    /// Face value bounds, inclusive, in the same units as `issued_minor`.
    pub face_min: Option<i64>,
    pub face_max: Option<i64>,
    /// What is left on the card, inclusive bounds.
    pub balance_min: Option<i64>,
    pub balance_max: Option<i64>,
    /// Issued at or after this instant.
    pub issued_from: Option<DateTime<Utc>>,
    /// Issued strictly before this instant. Half-open, so a caller asking for
    /// one local day sends that day's midnight and the next one.
    pub issued_before: Option<DateTime<Utc>>,
    /// A `next_cursor` from the previous page, verbatim.
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// The docked filters, one per column, spelled once for the page and for the
/// count so `total` describes exactly the rows the pages add up to.
///
/// `first` is the placeholder its first bind takes; the seven follow in the
/// order of [`VoucherQuery`]: state, face min/max, balance min/max, issued
/// from/before.
fn voucher_narrowed(first: usize) -> String {
    let [state, face_min, face_max, balance_min, balance_max, from, before]: [usize; 7] =
        std::array::from_fn(|at| first + at);
    format!(
        "(${state}::text IS NULL
          OR (CASE WHEN expired THEN 'EXPIRED' ELSE status END) = ${state})
     AND (${face_min}::bigint IS NULL OR issued_minor >= ${face_min})
     AND (${face_max}::bigint IS NULL OR issued_minor <= ${face_max})
     AND (${balance_min}::bigint IS NULL OR balance_minor >= ${balance_min})
     AND (${balance_max}::bigint IS NULL OR balance_minor <= ${balance_max})
     AND (${from}::timestamptz IS NULL OR issued_at >= ${from})
     AND (${before}::timestamptz IS NULL OR issued_at < ${before})"
    )
}

/// The docked filters as they are bound — validated once, bound twice.
struct VoucherNarrowing {
    state: Option<String>,
    face_min: Option<i64>,
    face_max: Option<i64>,
    balance_min: Option<i64>,
    balance_max: Option<i64>,
    issued_from: Option<DateTime<Utc>>,
    issued_before: Option<DateTime<Utc>>,
}

impl VoucherNarrowing {
    fn of(query: &VoucherQuery) -> Result<Self, AppError> {
        let state = optional_text(query.state.as_deref()).map(|raw| raw.to_ascii_uppercase());
        if let Some(unknown) = state
            .as_deref()
            .filter(|state| !matches!(*state, "ACTIVE" | "SPENT" | "VOIDED" | "EXPIRED"))
        {
            return Err(AppError::Validation(format!(
                "state {unknown:?} is not ACTIVE, SPENT, VOIDED or EXPIRED"
            )));
        }
        Ok(Self {
            state,
            face_min: query.face_min,
            face_max: query.face_max,
            balance_min: query.balance_min,
            balance_max: query.balance_max,
            issued_from: query.issued_from,
            issued_before: query.issued_before,
        })
    }
}

/// How many cards the list returns when the caller does not say.
const DEFAULT_PAGE: i64 = 200;
/// And the most it will return however loudly a caller asks.
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

/// One listable voucher row, defined once.
///
/// Used by the page query and by the facet counts, and that is the whole reason
/// it is a constant: the facets are only honest if they count exactly what the
/// page can show. It WRAPS [`VOUCHER_COLUMNS`] rather than restating it, so what
/// a voucher row is stays written in one place — the detail route and the list
/// cannot come to disagree about whether a card is expired.
///
/// Binds: `$1` the holder, or NULL for every holder. `$2` the normalised search
/// pattern, or NULL for no search.
///
/// It stops at the HOLDER and the SEARCH. The status and kind filters are
/// applied outside it, which is what lets one definition answer two different
/// questions from the same rows: the page wants what the filters leave, while
/// the filter panel's counts want what the search alone leaves.
///
/// `expires_key` is computed here rather than only in `ORDER BY` because the
/// keyset has to COMPARE the sort value in a `WHERE`, and a sort expression
/// that is not also a column is one a `WHERE` cannot see. It is non-null for a
/// reason that is easy to miss and expensive to find: a row comparison against
/// NULL is NULL rather than true, so the first card with no expiry — which is
/// most of them — would end paging at whatever row happened to carry it,
/// silently, with the rest of the book below the fold. `9999-12-31` as a
/// sentinel VALUE rather than a `NULLS LAST` decoration, because `NULLS LAST`
/// orders a result and says nothing a keyset can seek against; it is also the
/// more useful answer, since a card that never lapses does sort after every
/// card that does.
///
/// A function rather than a `const` only because it has to splice
/// [`VOUCHER_COLUMNS`] into itself, and a `const` cannot call `format!`. Every
/// caller binds the same two parameters in the same order.
fn voucher_searched() -> String {
    format!(
        "SELECT base.*,
                COALESCE(base.expires_at, TIMESTAMPTZ '9999-12-31') AS expires_key
           FROM ({VOUCHER_COLUMNS}) base
          WHERE ($1::text IS NULL OR base.member_id = $1)
            AND ($2::text IS NULL
                 OR base.code LIKE '%' || $2 || '%'
                 OR upper(COALESCE(base.member_name, '')) LIKE '%' || $2 || '%'
                 OR upper(COALESCE(base.member_id, '')) LIKE '%' || $2 || '%')"
    )
}

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
    let narrowing = VoucherNarrowing::of(&query)?;
    // Searched against the normalised code, so somebody who types the code the
    // way it is printed — in groups, with a dash — still finds the card.
    let search = optional_text(query.q.as_deref()).map(|term| {
        let stripped: String = term
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '-')
            .collect();
        stripped.to_uppercase()
    });

    // The sort, and the tie-break that makes it total. Every order ends in the
    // voucher id, which is the primary key, so no two rows can compare equal —
    // which is what stops a keyset from repeating or losing the rows that tie.
    // The code would nearly do and the issue instant would not: two cards minted
    // in one batch share it to the microsecond.
    let (lead, natural_desc) = match query.sort.as_deref() {
        Some("code") => ("code", false),
        Some("value") => ("issued_minor", true),
        Some("balance") => ("balance_minor", true),
        Some("expires") => ("expires_key", false),
        _ => ("issued_at", true),
    };
    let desc = match query.dir.as_deref() {
        Some("asc") => false,
        Some("desc") => true,
        _ => natural_desc,
    };
    let (cols, order) = super::order_by(lead, "voucher_id", desc);
    let seek = if desc { "<" } else { ">" };

    let cursor: Option<VoucherCursor> = query
        .cursor
        .as_deref()
        .map(super::decode_cursor)
        .transpose()?;

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor: one cursor shape then serves every order, and
    // a sixth sort cannot arrive without its cursor.
    let searched = voucher_searched();
    let narrowed = voucher_narrowed(7);
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({searched}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched
              WHERE ($3::text IS NULL OR status = $3)
                AND ($4::text IS NULL OR kind = $4)
                AND {narrowed}
         )
         SELECT * FROM kept
          WHERE $5::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE voucher_id = $5)
          ORDER BY {order}
          LIMIT $6"
    );
    let page = async {
        Ok::<_, AppError>(
            sqlx::query(&sql)
                .bind(&member_id)
                .bind(&search)
                .bind(&status)
                .bind(&kind)
                .bind(cursor.as_ref().map(|c| c.voucher_id))
                .bind(limit)
                .bind(&narrowing.state)
                .bind(narrowing.face_min)
                .bind(narrowing.face_max)
                .bind(narrowing.balance_min)
                .bind(narrowing.balance_max)
                .bind(narrowing.issued_from)
                .bind(narrowing.issued_before)
                .fetch_all(pool)
                .await?,
        )
    };
    // The page, its counts and the ledger read the same table independently,
    // so they are asked together rather than one after another.
    let (rows, (total, facets), ledger) = tokio::try_join!(
        page,
        voucher_facets(
            pool,
            member_id.as_deref(),
            search.as_deref(),
            &status,
            &kind,
            &narrowing,
        ),
        voucher_ledger(pool),
    )?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer: knowing whether more
    // rows exist without asking costs a second count of the same query.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&VoucherCursor {
            voucher_id: row.try_get("voucher_id")?,
        })?),
        _ => None,
    };

    Ok(VoucherList {
        rows: rows
            .iter()
            .map(voucher_from_row)
            .collect::<Result<Vec<_>, _>>()?,
        next_cursor,
        total,
        facets,
        ledger,
    })
}

/// How many cards there are, and how they split.
///
/// Counted from the SAME [`voucher_searched`] the page is drawn from, so the
/// holder scope applies to the counts as well: a members screen opened at one
/// customer must not be told how many live cards the shop has issued to
/// everybody. The two scopes are deliberate:
///
///   per-value counts read the SEARCHED set, ignoring which boxes are ticked.
///     Counting the already-filtered set instead shows the chosen value its own
///     row count and every other one a zero.
///   the total reads the FILTERED set, because it describes the list on screen.
async fn voucher_facets(
    pool: &PgPool,
    member_id: Option<&str>,
    search: Option<&str>,
    status: &Option<String>,
    kind: &Option<String>,
    narrowing: &VoucherNarrowing,
) -> Result<(i64, VoucherFacets), AppError> {
    let searched = voucher_searched();
    // The docked filters narrow the total, like the segment does, and not the
    // per-value counts — those read `searched` for the reason above.
    let narrowed = voucher_narrowed(5);
    let sql = format!(
        "WITH searched AS ({searched}), kept AS (
             SELECT * FROM searched
              WHERE ($3::text IS NULL OR status = $3)
                AND ($4::text IS NULL OR kind = $4)
                AND {narrowed}
         )
         SELECT 'status' AS facet, status AS value, count(*)::bigint AS n
           FROM searched GROUP BY status
          UNION ALL
         SELECT 'kind', kind, count(*)::bigint FROM searched GROUP BY kind
          UNION ALL
         SELECT 'all', '', count(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(member_id)
        .bind(search)
        .bind(status)
        .bind(kind)
        .bind(&narrowing.state)
        .bind(narrowing.face_min)
        .bind(narrowing.face_max)
        .bind(narrowing.balance_min)
        .bind(narrowing.balance_max)
        .bind(narrowing.issued_from)
        .bind(narrowing.issued_before)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut statuses = Vec::new();
    let mut kinds = Vec::new();
    for row in &rows {
        let facet: String = row.try_get("facet")?;
        let one = VoucherFacet {
            value: row.try_get("value")?,
            count: row.try_get("n")?,
        };
        match facet.as_str() {
            "status" => statuses.push(one),
            "kind" => kinds.push(one),
            _ => total = one.count,
        }
    }
    // Biggest first, ties broken on the value, as every other facet panel in
    // this estate is ordered — a list that reshuffles between calls is a list
    // nobody can click.
    for list in [&mut statuses, &mut kinds] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((total, VoucherFacets { statuses, kinds }))
}

/// The book, added up. One query rather than five, because five would be five
/// scans of the same table to answer one strip of figures.
pub async fn voucher_ledger(pool: &PgPool) -> Result<VoucherLedger, AppError> {
    let row = sqlx::query(
        "SELECT h.*, moved.redeemed_minor, moved.voided_minor
           FROM (SELECT count(*)::bigint                                       AS issued_count,
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
                                   AND expires_at <= now()), 0)::bigint AS expired_minor
                   FROM voucher) h
          CROSS JOIN (
                 -- From the movements, not from the header: what came off a
                 -- card and what was written off are two different events and
                 -- the header remembers neither, only the total that is left.
                 -- One pass over the movements for both figures. Each side is
                 -- an aggregate with no GROUP BY, so each is exactly one row
                 -- even when there are no cards at all.
                SELECT COALESCE(-sum(amount_minor) FILTER (WHERE kind = 'REDEEM'), 0)::bigint
                           AS redeemed_minor,
                       COALESCE(-sum(amount_minor) FILTER (WHERE kind = 'VOID'), 0)::bigint
                           AS voided_minor
                  FROM voucher_movement) moved",
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

    // Owner decision 25 Sep (Finance Connect, stage 2 point 13): every voucher
    // is FREE. Nothing is sold, so nothing is owed when one is issued and no
    // journal is written here; the value reaches the books only when a card is
    // spent at a till, and then as a sales discount (Dr 4012) on the sales day
    // (`domain::sales_posting`). An expired card simply cannot be spent — no
    // journal either. 0298's issue posting (Dr funding / Cr voucher_liability)
    // is retired with that decision.

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
    let available = available_minor(&mut tx, voucher_id, balance).await?;
    if request.amount_minor > available {
        return Err(AppError::Conflict(format!(
            "the voucher has {available} available and the basket asked for {} \
             (balance {balance}, the difference is held by another checkout)",
            request.amount_minor,
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
) -> Result<Uuid, AppError> {
    let movement_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO voucher_movement (movement_id, voucher_id, seq, kind,
                                       amount_minor, balance_after_minor,
                                       sale_id, site_id, actor, note)
         SELECT $1, $2,
                COALESCE(max(seq) + 1, 0), $3, $4, $5, $6, $7, $8, $9
           FROM voucher_movement WHERE voucher_id = $2",
    )
    .bind(movement_id)
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
    Ok(movement_id)
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

// ── holding a card before it is spent ──────────────────────────────────────
//
// See migration 0162. A redemption is final and a checkout is not, so the till
// takes a HOLD first and the hold becomes a redemption only when the sale
// lands. The invariant every read here defends:
//
//     available = balance_minor − sum(open holds)
//
// Checking a balance is not reserving against it. Two tills reading the same
// 100.000 card both see 100.000 and both would be told yes, which is exactly
// how a voucher gets spent twice. Every path below takes `FOR UPDATE` on the
// voucher row FIRST and computes `available` inside that lock.

#[derive(Debug, Deserialize)]
pub struct AuthorizeVoucherRequest {
    /// The basket this hold belongs to. The till's own id for the sale it is
    /// building — it has no server-side row yet.
    pub checkout_id: String,
    pub amount_minor: i64,
    #[serde(default)]
    pub site_id: Option<String>,
    pub actor_id: String,
    /// How long the hold counts against the card. Absent is fifteen minutes,
    /// which is a queue and a card terminal with room to spare.
    #[serde(default)]
    pub hold_seconds: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CommitVoucherRequest {
    pub checkout_id: String,
    #[serde(default)]
    pub sale_id: Option<Uuid>,
    pub actor_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseVoucherRequest {
    pub checkout_id: String,
    pub actor_id: String,
    #[serde(default)]
    pub reason: Option<String>,
}

const DEFAULT_HOLD_SECONDS: i64 = 900;

/// What is left on a card once every open hold is taken off it.
///
/// Must be called with the voucher row already locked in `tx`, and the caller
/// must write its hold in the same transaction. Called outside a lock it is a
/// number that was true a moment ago, which is the fault this exists to stop.
async fn available_minor(
    tx: &mut Transaction<'_, Postgres>,
    voucher_id: Uuid,
    balance_minor: i64,
) -> Result<i64, AppError> {
    let held: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(amount_minor), 0)::bigint
           FROM voucher_authorization
          WHERE voucher_id = $1 AND status = 'AUTHORIZED' AND expires_at > now()",
    )
    .bind(voucher_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(balance_minor - held)
}

/// Hold an amount against a card, or hand back the hold this checkout already
/// has.
///
/// Idempotent by `(voucher_id, checkout_id)` rather than by an idempotency
/// header, and deliberately: a till that asks twice for the same basket means
/// the same question, however many times the network ate the answer. A second
/// hold for the same basket would reserve the money twice.
pub async fn authorize_voucher(
    pool: &PgPool,
    code: &str,
    request: AuthorizeVoucherRequest,
) -> Result<Value, AppError> {
    let code = normalize_code(code).map_err(|error| AppError::Validation(error.to_string()))?;
    let checkout_id = request.checkout_id.trim();
    if checkout_id.is_empty() {
        return Err(AppError::Validation(
            "a hold has to name the basket it is for".into(),
        ));
    }
    let actor = request.actor_id.trim();
    if actor.is_empty() {
        return Err(AppError::Validation(
            "a hold has to be attributable to somebody".into(),
        ));
    }
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a hold has to be for something".into(),
        ));
    }
    let seconds = request
        .hold_seconds
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_HOLD_SECONDS);

    let mut tx = pool.begin().await?;
    let (voucher_id, balance, status, expires_at, _currency) = lock_voucher(&mut tx, &code).await?;

    // The hold this basket already has, if it asked before. Returned unchanged
    // — not topped up, not replaced — because a retry is the same question.
    if let Some(row) = sqlx::query(
        "SELECT authorization_id, amount_minor, status, expires_at
           FROM voucher_authorization
          WHERE voucher_id = $1 AND checkout_id = $2",
    )
    .bind(voucher_id)
    .bind(checkout_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        let held_status: String = row.try_get("status")?;
        let held_amount: i64 = row.try_get("amount_minor")?;
        if held_status == "AUTHORIZED" && held_amount == request.amount_minor {
            let id: Uuid = row.try_get("authorization_id")?;
            let until: DateTime<Utc> = row.try_get("expires_at")?;
            tx.commit().await?;
            return Ok(json!({
                "authorization_id": id,
                "code": code,
                "amount_minor": held_amount,
                "status": held_status,
                "expires_at": until,
                "replayed": true,
            }));
        }
        return Err(AppError::Conflict(format!(
            "this basket already has a {held_status} hold on that voucher for {held_amount}"
        )));
    }

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

    // The invariant, inside the lock.
    let available = available_minor(&mut tx, voucher_id, balance).await?;
    if request.amount_minor > available {
        return Err(AppError::Conflict(format!(
            "the voucher has {available} available and the basket asked for {} \
             (balance {balance}, the difference is held by another checkout)",
            request.amount_minor
        )));
    }

    let authorization_id = Uuid::new_v4();
    let until = Utc::now() + chrono::Duration::seconds(seconds);
    sqlx::query(
        "INSERT INTO voucher_authorization
             (authorization_id, voucher_id, checkout_id, amount_minor, status,
              site_id, actor, expires_at)
         VALUES ($1, $2, $3, $4, 'AUTHORIZED', $5, $6, $7)",
    )
    .bind(authorization_id)
    .bind(voucher_id)
    .bind(checkout_id)
    .bind(request.amount_minor)
    .bind(optional_text(request.site_id.as_deref()))
    .bind(actor)
    .bind(until)
    .execute(&mut *tx)
    .await
    .map_err(map_voucher_write_error)?;
    tx.commit().await?;

    Ok(json!({
        "authorization_id": authorization_id,
        "code": code,
        "amount_minor": request.amount_minor,
        "status": "AUTHORIZED",
        "expires_at": until,
        "replayed": false,
    }))
}

/// Turn a hold into a redemption, because the sale landed.
///
/// Replaying this returns the same answer rather than taking the money twice:
/// a hold that is already COMMITTED is reported as committed and nothing moves.
pub async fn commit_voucher_hold(
    pool: &PgPool,
    code: &str,
    request: CommitVoucherRequest,
) -> Result<VoucherDetail, AppError> {
    let code = normalize_code(code).map_err(|error| AppError::Validation(error.to_string()))?;
    let checkout_id = request.checkout_id.trim();
    let actor = request.actor_id.trim();
    if checkout_id.is_empty() || actor.is_empty() {
        return Err(AppError::Validation(
            "a commit has to name the basket and who did it".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let (voucher_id, balance, _status, _expires_at, _currency) =
        lock_voucher(&mut tx, &code).await?;

    let row = sqlx::query(
        "SELECT authorization_id, amount_minor, status, expires_at, site_id, movement_id
           FROM voucher_authorization
          WHERE voucher_id = $1 AND checkout_id = $2
          FOR UPDATE",
    )
    .bind(voucher_id)
    .bind(checkout_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        AppError::Conflict(
            "that basket holds nothing against this voucher — authorize before committing".into(),
        )
    })?;

    let held_status: String = row.try_get("status")?;
    let amount: i64 = row.try_get("amount_minor")?;
    let authorization_id: Uuid = row.try_get("authorization_id")?;
    let site_id: Option<String> = row.try_get("site_id")?;
    let linked_movement: Option<Uuid> = row.try_get("movement_id")?;

    if held_status == "COMMITTED" {
        // A checkout retry is idempotent only when it names the sale that
        // originally consumed this hold. Older rows did not store the
        // movement_id, so recover the unique movement by the checkout note
        // and nullable sale id, then persist the link for the next retry.
        let movement_rows = if let Some(movement_id) = linked_movement {
            sqlx::query(
                "SELECT movement_id, voucher_id, kind, sale_id, amount_minor, site_id
                   FROM voucher_movement WHERE movement_id = $1",
            )
            .bind(movement_id)
            .fetch_all(&mut *tx)
            .await?
        } else {
            sqlx::query(
                "SELECT movement_id, voucher_id, kind, sale_id, amount_minor, site_id
                   FROM voucher_movement
                  WHERE voucher_id = $1 AND kind = 'REDEEM'
                    AND note = $2 AND sale_id IS NOT DISTINCT FROM $3",
            )
            .bind(voucher_id)
            .bind(format!("checkout {checkout_id}"))
            .bind(request.sale_id)
            .fetch_all(&mut *tx)
            .await?
        };
        if movement_rows.len() != 1 {
            return Err(AppError::Conflict(
                "that committed hold is bound to a different sale".into(),
            ));
        }
        let movement = &movement_rows[0];
        let movement_id: Uuid = movement.try_get("movement_id")?;
        let movement_voucher_id: Uuid = movement.try_get("voucher_id")?;
        let movement_kind: String = movement.try_get("kind")?;
        let movement_sale_id: Option<Uuid> = movement.try_get("sale_id")?;
        let movement_amount: i64 = movement.try_get("amount_minor")?;
        let movement_site_id: Option<String> = movement.try_get("site_id")?;
        if movement_voucher_id != voucher_id
            || movement_kind != "REDEEM"
            || movement_sale_id != request.sale_id
            || movement_amount != -amount
            || movement_site_id != site_id
        {
            return Err(AppError::Conflict(
                "that committed hold is bound to a different sale".into(),
            ));
        }
        if linked_movement.is_none() {
            sqlx::query(
                "UPDATE voucher_authorization SET movement_id = $2 WHERE authorization_id = $1",
            )
            .bind(authorization_id)
            .bind(movement_id)
            .execute(&mut *tx)
            .await?;
        }
        let detail = detail_in_transaction(&mut tx, voucher_id).await?;
        tx.commit().await?;
        return Ok(detail);
    }
    if held_status != "AUTHORIZED" {
        return Err(AppError::Conflict(format!(
            "that hold was {held_status} and cannot be committed"
        )));
    }
    // An expired hold is refused loudly rather than quietly honoured: the money
    // it was reserving has been available to other tills since it lapsed, and
    // committing it now is exactly the double spend the hold existed to stop.
    let until: DateTime<Utc> = row.try_get("expires_at")?;
    if until <= Utc::now() {
        return Err(AppError::Conflict(
            "that hold expired before the sale landed — re-authorize against what is left".into(),
        ));
    }
    if amount > balance {
        return Err(AppError::Conflict(format!(
            "the voucher has {balance} left and the hold was for {amount}"
        )));
    }

    let remaining = balance - amount;
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

    let movement_id = append_movement(
        &mut tx,
        voucher_id,
        "REDEEM",
        -amount,
        remaining,
        request.sale_id,
        site_id.as_deref(),
        actor,
        Some(&format!("checkout {checkout_id}")),
    )
    .await?;

    sqlx::query(
        "UPDATE voucher_authorization
            SET status = 'COMMITTED', settled_at = now(), movement_id = $2
          WHERE authorization_id = $1",
    )
    .bind(authorization_id)
    .bind(movement_id)
    .execute(&mut *tx)
    .await
    .map_err(map_voucher_write_error)?;

    let detail = detail_in_transaction(&mut tx, voucher_id).await?;
    tx.commit().await?;
    Ok(detail)
}
/// Commit a hold the centre granted, because the sale it was taken against has
/// landed as a fact.
///
/// Called from `apply_sale` with the fact's own transaction: the sale row and
/// the redemption commit or neither does. Unlike [`commit_voucher_hold`] this
/// identifies the hold **by id** — a fact names the hold it was taken under,
/// not the basket — and it does not refuse on expiry: the till took the money
/// while the hold was live, and a hold that lapsed between the sale and the
/// upload is a sync delay, not a reason to say a spent card was not spent.
/// What it still refuses is the one thing a fact cannot make true: more going
/// off the card than was ever on it. That refusal blocks the stream on purpose
/// — an overspent voucher means the hold system itself failed, and the dead
/// letter is where somebody finds that out.
pub async fn commit_voucher_hold_for_fact(
    tx: &mut Transaction<'_, Postgres>,
    authorization_id: Uuid,
    sale_id: Uuid,
    tender_amount_minor: i64,
    sale_site_id: &str,
    tender_code: Option<&str>,
    actor: &str,
) -> Result<(), AppError> {
    // Lock in the same order as every other path that moves voucher money:
    // voucher first, authorization second. The id lookup is deliberately
    // unlocked and only discovers the immutable parent key.
    let voucher_id: Uuid = sqlx::query_scalar(
        "SELECT voucher_id FROM voucher_authorization WHERE authorization_id = $1",
    )
    .bind(authorization_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        AppError::Conflict(format!(
            "sale {sale_id} names a voucher hold that was never granted ({authorization_id})"
        ))
    })?;
    let voucher =
        sqlx::query("SELECT code, balance_minor FROM voucher WHERE voucher_id = $1 FOR UPDATE")
            .bind(voucher_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::Conflict(format!("sale {sale_id} names a missing voucher")))?;
    let actual_code: String = voucher.try_get("code")?;
    let balance: i64 = voucher.try_get("balance_minor")?;

    let hold = sqlx::query(
        "SELECT amount_minor, status, site_id, expires_at, movement_id
           FROM voucher_authorization
          WHERE authorization_id = $1 AND voucher_id = $2
          FOR UPDATE",
    )
    .bind(authorization_id)
    .bind(voucher_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::Conflict(format!("sale {sale_id} names a changed voucher hold")))?;

    let amount: i64 = hold.try_get("amount_minor")?;
    let site_id: Option<String> = hold.try_get("site_id")?;
    let expires_at: DateTime<Utc> = hold.try_get("expires_at")?;
    if amount != tender_amount_minor {
        return Err(AppError::Conflict(format!(
            "sale {sale_id} tenders {tender_amount_minor} against a hold for exactly {amount}"
        )));
    }
    let sale_site_id = sale_site_id.trim();
    if sale_site_id.is_empty() || site_id.as_deref() != Some(sale_site_id) {
        return Err(AppError::Conflict(format!(
            "sale {sale_id} came from {sale_site_id:?}, but this voucher hold is bound to {site_id:?}"
        )));
    }
    if let Some(tender_code) = tender_code {
        if actual_code != tender_code.trim().to_ascii_uppercase() {
            return Err(AppError::Conflict(format!(
                "sale {sale_id} names voucher code {:?}, but its hold belongs to {:?}",
                tender_code, actual_code
            )));
        }
    }

    let status: String = hold.try_get("status")?;
    let linked_movement: Option<Uuid> = hold.try_get("movement_id")?;
    if status == "COMMITTED" {
        // A repeated fact is idempotent only for the sale that actually took
        // this hold. Old rows did not persist movement_id, so recover the
        // binding from their unique redemption movement and write it down.
        let movement_rows = if let Some(movement_id) = linked_movement {
            sqlx::query(
                "SELECT movement_id, voucher_id, kind, sale_id, amount_minor, site_id
                   FROM voucher_movement WHERE movement_id = $1",
            )
            .bind(movement_id)
            .fetch_all(&mut **tx)
            .await?
        } else {
            sqlx::query(
                "SELECT movement_id, voucher_id, kind, sale_id, amount_minor, site_id
                   FROM voucher_movement
                  WHERE voucher_id = $1 AND kind = 'REDEEM' AND sale_id = $2",
            )
            .bind(voucher_id)
            .bind(sale_id)
            .fetch_all(&mut **tx)
            .await?
        };
        if movement_rows.len() != 1 {
            return Err(AppError::Conflict(format!(
                "sale {sale_id} does not match the sale bound to this committed voucher hold"
            )));
        }
        let movement = &movement_rows[0];
        let movement_id: Uuid = movement.try_get("movement_id")?;
        let movement_voucher_id: Uuid = movement.try_get("voucher_id")?;
        let movement_kind: String = movement.try_get("kind")?;
        let movement_sale_id: Option<Uuid> = movement.try_get("sale_id")?;
        let movement_amount: i64 = movement.try_get("amount_minor")?;
        let movement_site_id: Option<String> = movement.try_get("site_id")?;
        if movement_voucher_id != voucher_id
            || movement_kind != "REDEEM"
            || movement_sale_id != Some(sale_id)
            || movement_amount != -amount
            || movement_site_id.as_deref() != Some(sale_site_id)
        {
            return Err(AppError::Conflict(format!(
                "sale {sale_id} does not match the redemption bound to this voucher hold"
            )));
        }
        if linked_movement.is_none() {
            sqlx::query(
                "UPDATE voucher_authorization SET movement_id = $2 WHERE authorization_id = $1",
            )
            .bind(authorization_id)
            .bind(movement_id)
            .execute(&mut **tx)
            .await?;
        }
        return Ok(());
    }
    if status != "AUTHORIZED" {
        return Err(AppError::Conflict(format!(
            "sale {sale_id} names a hold that was {status}, and only an authorized hold can settle"
        )));
    }

    // Expired sales may arrive late, but a late fact cannot spend value that
    // another live checkout has since reserved. Exclude this authorization
    // and protect all current holds before settling it.
    let held_elsewhere: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(amount_minor), 0)::bigint
           FROM voucher_authorization
          WHERE voucher_id = $1 AND authorization_id <> $2
            AND status = 'AUTHORIZED' AND expires_at > now()",
    )
    .bind(voucher_id)
    .bind(authorization_id)
    .fetch_one(&mut **tx)
    .await?;
    let available = balance - held_elsewhere;
    if amount > available {
        return Err(AppError::Conflict(format!(
            "sale {sale_id} took {amount}, but the voucher has only {available} unheld \
             (balance {balance}, {held_elsewhere} remains reserved by other checkouts)"
        )));
    }

    let remaining = balance - amount;
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
    .execute(&mut **tx)
    .await
    .map_err(map_voucher_write_error)?;

    let note = if expires_at <= Utc::now() {
        format!(
            "settled by sale {sale_id}; the hold had lapsed by the time the fact arrived, \
             which says the upload was late, not that the sale did not happen"
        )
    } else {
        format!("settled by sale {sale_id}")
    };
    let movement_id = append_movement(
        tx,
        voucher_id,
        "REDEEM",
        -amount,
        remaining,
        Some(sale_id),
        site_id.as_deref(),
        actor,
        Some(&note),
    )
    .await?;

    sqlx::query(
        "UPDATE voucher_authorization
            SET status = 'COMMITTED', settled_at = now(), movement_id = $2
          WHERE authorization_id = $1",
    )
    .bind(authorization_id)
    .bind(movement_id)
    .execute(&mut **tx)
    .await
    .map_err(map_voucher_write_error)?;
    Ok(())
}

/// Give the held amount back, because the checkout did not become a sale.
///
/// Releasing a hold that is already RELEASED is a success and not an error: a
/// till abandoning a basket twice means the basket is abandoned.
pub async fn release_voucher_hold(
    pool: &PgPool,
    code: &str,
    request: ReleaseVoucherRequest,
) -> Result<Value, AppError> {
    let code = normalize_code(code).map_err(|error| AppError::Validation(error.to_string()))?;
    let checkout_id = request.checkout_id.trim();
    if checkout_id.is_empty() || request.actor_id.trim().is_empty() {
        return Err(AppError::Validation(
            "a release has to name the basket and who did it".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let (voucher_id, _balance, _status, _expires_at, _currency) =
        lock_voucher(&mut tx, &code).await?;

    let released = sqlx::query(
        "UPDATE voucher_authorization
            SET status = 'RELEASED', settled_at = now()
          WHERE voucher_id = $1 AND checkout_id = $2 AND status = 'AUTHORIZED'",
    )
    .bind(voucher_id)
    .bind(checkout_id)
    .execute(&mut *tx)
    .await
    .map_err(map_voucher_write_error)?
    .rows_affected();

    let current: Option<String> = sqlx::query_scalar(
        "SELECT status FROM voucher_authorization
          WHERE voucher_id = $1 AND checkout_id = $2",
    )
    .bind(voucher_id)
    .bind(checkout_id)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;

    // A committed hold is NOT released. The sale happened; the money is gone.
    if current.as_deref() == Some("COMMITTED") {
        return Err(AppError::Conflict(
            "that hold was already committed to a sale and cannot be released".into(),
        ));
    }
    Ok(json!({
        "code": code,
        "checkout_id": checkout_id,
        "released": released,
        "status": current.unwrap_or_else(|| "RELEASED".to_string()),
    }))
}

/// A voucher issued inside somebody else's transaction.
///
/// [`issue_voucher`] is the front door: it opens its own transaction and takes
/// an idempotency key, because it answers an HTTP request. This is the same act
/// for a caller that is already in a transaction and must not commit
/// separately — points turning into a voucher, where a debit that lands without
/// its voucher is money taken for nothing.
///
/// It deliberately has no idempotency of its own. The caller owns that: a
/// redemption is identified by its own key, and a second key here would be a
/// second opinion about whether the same act happened twice.
pub struct IssuedVoucher<'a> {
    pub kind: &'a str,
    pub value_minor: i64,
    pub member_id: Option<&'a str>,
    pub expires_at: Option<DateTime<Utc>>,
    pub actor: &'a str,
    pub note: Option<&'a str>,
}

pub async fn issue_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    issued: IssuedVoucher<'_>,
) -> Result<(Uuid, String), AppError> {
    let kind = VoucherKind::from_str(issued.kind)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    if issued.value_minor <= 0 {
        return Err(AppError::Validation(
            "a voucher has to carry something — its value must be above zero".into(),
        ));
    }
    let voucher_id = Uuid::new_v4();
    // Minted the way `issue_voucher` mints one: twelve characters from a
    // CSPRNG, because a voucher code is a bearer token.
    let code = mint_code(
        Uuid::new_v4().as_bytes()[..12]
            .try_into()
            .expect("a uuid is sixteen bytes"),
    );
    sqlx::query(
        "INSERT INTO voucher (voucher_id, code, kind, currency, issued_minor,
                              balance_minor, status, member_id, expires_at,
                              issued_by, issued_site, note)
         VALUES ($1, $2, $3, 'IDR', $4, $4, 'ACTIVE', $5, $6, $7, NULL, $8)",
    )
    .bind(voucher_id)
    .bind(&code)
    .bind(kind.as_str())
    .bind(issued.value_minor)
    .bind(issued.member_id)
    .bind(issued.expires_at)
    .bind(issued.actor)
    .bind(issued.note)
    .execute(&mut **tx)
    .await
    .map_err(map_voucher_write_error)?;

    append_movement(
        tx,
        voucher_id,
        "ISSUE",
        issued.value_minor,
        issued.value_minor,
        None,
        None,
        issued.actor,
        issued.note,
    )
    .await?;
    Ok((voucher_id, code))
}
