//! Takings on their way from a drawer to a bank account.
//!
//! # The gap this closes
//!
//! A deposit is three facts — notes left a drawer, a person carried them, a
//! bank credited an account — and this system used to keep the first and the
//! third and nothing in between. The Deposits screen therefore drew the middle
//! as a SUBTRACTION: our unconfirmed postings on one side, the bank's unclaimed
//! credits on the other, and a note at the foot saying a deposit slip was not a
//! document the system kept.
//!
//! A subtraction cannot be reconciled, cannot be aged, and cannot name the
//! person holding the bag. This makes it a document and makes the middle a
//! ledger position.
//!
//! # Two postings, two dates
//!
//! ```text
//!   banking  (on `banked_on`)  Dr cash_in_transit   Cr the drawer
//!   landing  (on `landed_on`)  Dr the bank          Cr cash_in_transit
//! ```
//!
//! Two entries and not one, because they happen on different days. A single
//! entry would have to pick one of the two dates and be wrong about the other,
//! which is exactly the defect this document exists to remove: the distance
//! between the two dates IS the exposure, and a document that collapses them
//! cannot report it.
//!
//! Posting into `cash_in_transit` rather than straight into the bank is the
//! other half of the same idea. Debiting the bank on the day the bag leaves
//! says the bank holds money it has never heard of, and every reconciliation
//! afterwards has to explain a credit that has not happened yet. The balance on
//! the in-transit account is one number, per unit, that somebody is answerable
//! for — which is the thing the screen could only estimate.
//!
//! # This module names no client account code
//!
//! The drawer's code and the bank's arrive from the caller, because that is how
//! every money screen in this estate addresses a place money sits — and both
//! are resolved BACK to a meaning through `account_map` before anything posts.
//! So a deposit out of an account nobody mapped is refused by name at the
//! moment somebody records it, rather than at posting time, which is the
//! arrangement `cash_counts` already makes and for the same reason.
//!
//! The third leg, `cash_in_transit`, is a meaning like any other and is unmapped
//! in the client's imported chart — their chart has no such account, and
//! `docs/coa-final.md` §8.7 names it as one of exactly two that have to be
//! added. So banking a deposit refuses, by name, until Finance points that
//! meaning at an account. Recording one still works: observing that a bag left
//! a till does not depend on knowing where to book it.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::payables::PayableFacet;
use super::poster::{post, PostingIntent, PostingLine};
use super::{decode_cursor, encode_cursor};
use crate::cloud::application::AppError;

/// The meanings a bag of notes can come OUT of. The same three
/// `cash_counts::CASH_MEANINGS` allows, because a drawer somebody can bank is a
/// drawer somebody can count.
const DRAWER_MEANINGS: [&str; 3] = ["cash", "petty_cash", "cashier_float"];

/// The meanings it can go INTO. Two, and both of them qualified — the qualifier
/// says which bank, and a deposit is into one named account at one named bank.
const BANK_MEANINGS: [&str; 2] = ["bank_giro", "bank_savings"];

/// Where the money is while it is in a bag.
const TRANSIT_MEANING: &str = "cash_in_transit";

/// One deposit, and where it has got to.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreDeposit {
    pub deposit_id: Uuid,
    pub deposit_number: String,
    /// The unit, on the row, as it is on both postings this will make.
    ///
    /// Carried as an id and never as a name: a unit is named from `org_place`
    /// through `book_locations`, which is the one place that knows head office
    /// is not spelled "DC".
    pub site_id: String,
    pub drawer_account_code: String,
    pub drawer_account_name: String,
    pub bank_account_code: String,
    pub bank_account_name: String,
    pub amount_minor: i64,
    pub currency: String,
    /// The day the bag left the drawer. Our side of the two dates.
    pub banked_on: NaiveDate,
    /// The day the bank credited the account. The bank's side, null until the
    /// bank has said so.
    pub landed_on: Option<NaiveDate>,
    /// How long the money has been in the air: to `landed_on` once it has
    /// landed, and to TODAY while it has not.
    ///
    /// Derived on read for the reason every figure in this module is: a stored
    /// age is wrong by morning.
    pub days_in_transit: i32,
    pub carried_by: String,
    pub slip_reference: String,
    pub note: String,
    /// `DRAFT`, `IN_TRANSIT` or `LANDED`.
    pub status: String,
    pub sent_entry_id: Option<Uuid>,
    pub sent_entry_number: Option<String>,
    pub landed_entry_id: Option<Uuid>,
    pub landed_entry_number: Option<String>,
    /// The statement line that agreed with it, when the reconciliation found
    /// one. Optional — a person reading a statement can confirm a deposit
    /// before the file is imported.
    pub bank_line_id: Option<Uuid>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    pub sent_by: Option<String>,
    pub landed_by: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordDepositRequest {
    pub site_id: String,
    /// The client's own account code for the drawer the notes came out of.
    pub drawer_account_code: String,
    /// And for the bank account they are going into.
    pub bank_account_code: String,
    pub amount_minor: i64,
    pub banked_on: NaiveDate,
    /// Who carried it. Not ceremony: an in-transit balance with nobody's name
    /// on it is a number nobody can be asked about.
    pub carried_by: String,
    #[serde(default)]
    pub slip_reference: String,
    #[serde(default)]
    pub note: String,
    /// Post the first leg in the same act that records it.
    ///
    /// Recording and banking are two acts for the reason a bill's are — the
    /// slip can be written before anybody decides which day it belongs to — but
    /// a shop that has already been to the bank is describing something that
    /// has happened, and making that two round trips is how a list fills with
    /// drafts nobody meant to keep.
    #[serde(default)]
    pub bank_now: bool,
}

/// The bank said it arrived.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LandDepositRequest {
    /// The bank's value date. Defaults to the day it was banked, which is what
    /// "it landed" means about a deposit paid in over the counter.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub landed_on: Option<NaiveDate>,
    /// The statement line that agreed with it, when there is one.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub bank_line_id: Option<Uuid>,
    /// What the bank stamped on the slip, when it was not known before.
    #[serde(default)]
    pub slip_reference: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DepositFacets {
    pub statuses: Vec<PayableFacet>,
}

/// A page of deposits, what they come to, and what is still in the air.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DepositPage {
    pub rows: Vec<StoreDeposit>,
    pub next_cursor: Option<String>,
    pub total: i64,
    pub total_minor: i64,
    /// What is banked and not yet confirmed, across the whole matched set.
    ///
    /// The figure the screen used to estimate by filtering a page of ledger
    /// rows in the browser. It is now the sum of the documents that say so, and
    /// it agrees with the `cash_in_transit` balance because both move only when
    /// this module posts.
    pub in_transit_minor: i64,
    pub facets: DepositFacets,
}

#[derive(Clone, Debug, Default)]
pub struct DepositScope {
    /// Free text, tried against the deposit number, the slip reference and who
    /// carried it.
    pub needle: Option<String>,
    pub statuses: Vec<String>,
    pub sites: Vec<String>,
    /// `banked`, `amount`. Anything else is the house order, most recently
    /// banked first.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Serialize, Deserialize)]
struct DepositCursor {
    deposit_id: Uuid,
}

const DEPOSIT_COLUMNS: &str = "d.deposit_id, d.deposit_number, d.site_id,
     d.drawer_account_code, da.name AS drawer_account_name,
     d.bank_account_code, ba.name AS bank_account_name,
     d.amount_minor, d.currency, d.banked_on, d.landed_on, d.carried_by,
     d.slip_reference, d.note, d.status, d.sent_entry_id, d.landed_entry_id,
     d.bank_line_id, d.recorded_by, d.recorded_at, d.sent_by, d.landed_by,
     se.entry_number AS sent_entry_number,
     le.entry_number AS landed_entry_number,
     -- To the day it landed, or to today while it has not. The second is the
     -- one somebody is answerable for, and it grows.
     (COALESCE(d.landed_on, CURRENT_DATE) - d.banked_on)::int AS days_in_transit";

const DEPOSIT_FROM: &str = "FROM store_deposit d
     JOIN ledger_account da ON da.account_code = d.drawer_account_code
     JOIN ledger_account ba ON ba.account_code = d.bank_account_code
     LEFT JOIN journal_entry se ON se.entry_id = d.sent_entry_id
     LEFT JOIN journal_entry le ON le.entry_id = d.landed_entry_id";

fn to_deposit(row: &sqlx::postgres::PgRow) -> Result<StoreDeposit, AppError> {
    Ok(StoreDeposit {
        deposit_id: row.try_get("deposit_id")?,
        deposit_number: row.try_get("deposit_number")?,
        site_id: row.try_get("site_id")?,
        drawer_account_code: row.try_get("drawer_account_code")?,
        drawer_account_name: row.try_get("drawer_account_name")?,
        bank_account_code: row.try_get("bank_account_code")?,
        bank_account_name: row.try_get("bank_account_name")?,
        amount_minor: row.try_get("amount_minor")?,
        currency: row.try_get("currency")?,
        banked_on: row.try_get("banked_on")?,
        landed_on: row.try_get("landed_on")?,
        days_in_transit: row.try_get("days_in_transit")?,
        carried_by: row.try_get("carried_by")?,
        slip_reference: row.try_get("slip_reference")?,
        note: row.try_get("note")?,
        status: row.try_get("status")?,
        sent_entry_id: row.try_get("sent_entry_id")?,
        sent_entry_number: row.try_get("sent_entry_number")?,
        landed_entry_id: row.try_get("landed_entry_id")?,
        landed_entry_number: row.try_get("landed_entry_number")?,
        bank_line_id: row.try_get("bank_line_id")?,
        recorded_by: row.try_get("recorded_by")?,
        recorded_at: row.try_get("recorded_at")?,
        sent_by: row.try_get("sent_by")?,
        landed_by: row.try_get("landed_by")?,
    })
}

/// One deposit row, defined once — the page query and the facet query both read
/// it, so the counts beside the filters count exactly what the page can show.
///
/// Binds: `$1` the search pattern, or NULL. Status and site are applied outside.
fn deposit_rows() -> String {
    format!(
        "SELECT {DEPOSIT_COLUMNS} {DEPOSIT_FROM}
          WHERE ($1::text IS NULL
                 OR d.deposit_number ILIKE $1
                 OR d.slip_reference ILIKE $1
                 OR d.carried_by ILIKE $1)"
    )
}

const DEPOSIT_FILTERS: &str = "
    ($2::text[] IS NULL OR status = ANY($2))
    AND ($3::text[] IS NULL OR site_id = ANY($3))
";

pub async fn deposit_page(pool: &PgPool, scope: DepositScope) -> Result<DepositPage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let statuses = (!scope.statuses.is_empty()).then(|| scope.statuses.clone());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());

    // Every order ends in `deposit_id`, so no two rows compare equal and the
    // keyset can neither repeat nor lose a row that ties.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("amount") => ("amount_minor", scope.desc),
        Some("banked") => ("banked_on", scope.desc),
        _ => ("banked_on", true),
    };
    let cols = format!("{lead}, deposit_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, deposit_id {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor: Option<DepositCursor> = scope.cursor.as_deref().map(decode_cursor).transpose()?;
    let limit = scope.limit.map(|value| value.clamp(1, 200));

    let rows_sql = deposit_rows();
    // `NOT MATERIALIZED` for the reason `payments::payment_page` documents: two
    // references to a CTE make PostgreSQL materialise it, which is an
    // optimisation fence the `ORDER BY … LIMIT` cannot be pushed through.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({rows_sql}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE {DEPOSIT_FILTERS}
         )
         SELECT * FROM kept
          WHERE $4::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE deposit_id = $4)
          ORDER BY {order}
          LIMIT $5"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&statuses)
        .bind(&sites)
        .bind(cursor.as_ref().map(|c| c.deposit_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match limit {
        None => None,
        Some(limit) if (rows.len() as i64) < limit => None,
        Some(_) => match rows.last() {
            Some(row) => Some(encode_cursor(&DepositCursor {
                deposit_id: row.try_get("deposit_id")?,
            })?),
            None => None,
        },
    };

    let deposits: Vec<StoreDeposit> = rows
        .iter()
        .map(to_deposit)
        .collect::<Result<_, AppError>>()?;
    let (total, total_minor, in_transit_minor, facets) =
        deposit_facets(pool, needle.as_deref(), &statuses, &sites).await?;
    Ok(DepositPage {
        rows: deposits,
        next_cursor,
        total,
        total_minor,
        in_transit_minor,
        facets,
    })
}

async fn deposit_facets(
    pool: &PgPool,
    needle: Option<&str>,
    statuses: &Option<Vec<String>>,
    sites: &Option<Vec<String>>,
) -> Result<(i64, i64, i64, DepositFacets), AppError> {
    let rows_sql = deposit_rows();
    // The in-transit sum reads the SEARCHED set rather than the filtered one,
    // and that is deliberate: it answers "what is in the air at this unit",
    // which is a fact about the place and not about which status boxes are
    // ticked. Filtering to LANDED must not make the exposure read zero.
    let sql = format!(
        "WITH searched AS ({rows_sql}), kept AS (
             SELECT * FROM searched WHERE {DEPOSIT_FILTERS}
         )
         SELECT 'status' AS kind, status AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY status
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept
          UNION ALL
         SELECT 'sum', '', COALESCE(SUM(amount_minor), 0)::bigint FROM kept
          UNION ALL
         SELECT 'transit', '', COALESCE(SUM(amount_minor), 0)::bigint
           FROM searched
          WHERE status = 'IN_TRANSIT'
            AND ($3::text[] IS NULL OR site_id = ANY($3))"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(statuses)
        .bind(sites)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut total_minor = 0i64;
    let mut in_transit_minor = 0i64;
    let mut status_facets = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "status" => status_facets.push(PayableFacet {
                value,
                label: None,
                count: n,
            }),
            "sum" => total_minor = n,
            "transit" => in_transit_minor = n,
            _ => total = n,
        }
    }
    status_facets.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    Ok((
        total,
        total_minor,
        in_transit_minor,
        DepositFacets {
            statuses: status_facets,
        },
    ))
}

pub async fn deposit(pool: &PgPool, deposit_id: Uuid) -> Result<StoreDeposit, AppError> {
    let sql = format!("SELECT {DEPOSIT_COLUMNS} {DEPOSIT_FROM} WHERE d.deposit_id = $1");
    let row = sqlx::query(&sql)
        .bind(deposit_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("deposit".into()))?;
    to_deposit(&row)
}

/// Which meaning carries this account at this unit, out of a list of meanings
/// the caller is allowed to name.
///
/// Refused rather than guessed, for the reason `cash_counts::drawer_meaning`
/// gives: a deposit out of an account nobody mapped is a deposit nothing can
/// ever be posted from, and finding that out at posting time is finding it out
/// too late.
async fn meaning_of(
    pool: &PgPool,
    account_code: &str,
    site_id: &str,
    allowed: &[&str],
    role: &str,
) -> Result<(String, String), AppError> {
    let rows = sqlx::query(
        "SELECT semantic_key, qualifier FROM account_map
          WHERE account_code = $1 AND site_id = $2 AND semantic_key = ANY($3)
          ORDER BY semantic_key, qualifier",
    )
    .bind(account_code)
    .bind(site_id)
    .bind(allowed)
    .fetch_all(pool)
    .await?;

    match rows.len() {
        0 => Err(AppError::Validation(format!(
            "{account_code} at {site_id} is not {role}: point one of {} at it on the Account Map \
             screen, or name the account that is",
            allowed.join(", ")
        ))),
        1 => Ok((
            rows[0].try_get("semantic_key")?,
            rows[0].try_get("qualifier")?,
        )),
        _ => Err(AppError::Validation(format!(
            "{account_code} at {site_id} is mapped by more than one meaning; one account carries \
             one meaning, so fix the Account Map before banking against it"
        ))),
    }
}

/// Write the slip down. Posts nothing.
///
/// Both accounts are resolved to meanings HERE even though nothing is posted
/// yet — see the note on `meaning_of`. What is deliberately NOT checked is
/// whether the drawer holds the money: a till can be banked at five and sell at
/// six, the ledger's balance at the moment somebody keys a slip is not the
/// balance on the day it posts, and refusing on it would refuse true deposits.
/// The period gate and the balance invariant apply where they belong, at
/// posting time.
pub async fn record_deposit(
    pool: &PgPool,
    request: &RecordDepositRequest,
    actor: &str,
) -> Result<StoreDeposit, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a deposit moves a positive amount; taking money OUT of a bank is a payment".into(),
        ));
    }
    if request.carried_by.trim().is_empty() {
        return Err(AppError::Validation(
            "say who carried it: an in-transit balance with nobody's name on it is a number \
             nobody can be asked about"
                .into(),
        ));
    }
    let drawer = request.drawer_account_code.trim();
    let bank = request.bank_account_code.trim();
    if drawer == bank {
        return Err(AppError::Validation(
            "the money would be going back where it came from; name the bank account it is \
             going into"
                .into(),
        ));
    }
    let site = request.site_id.trim();
    meaning_of(pool, drawer, site, &DRAWER_MEANINGS, "a cash drawer").await?;
    meaning_of(pool, bank, site, &BANK_MEANINGS, "a bank account").await?;

    let deposit_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    let number: i64 = sqlx::query("SELECT nextval('store_deposit_number_seq') AS n")
        .fetch_one(&mut *tx)
        .await?
        .try_get("n")?;
    sqlx::query(
        "INSERT INTO store_deposit
           (deposit_id, deposit_number, site_id, drawer_account_code, bank_account_code,
            amount_minor, banked_on, carried_by, slip_reference, note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(deposit_id)
    .bind(format!("DP-{number:08}"))
    .bind(site)
    .bind(drawer)
    .bind(bank)
    .bind(request.amount_minor)
    .bind(request.banked_on)
    .bind(request.carried_by.trim())
    .bind(request.slip_reference.trim())
    .bind(request.note.trim())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    if request.bank_now {
        return bank_deposit(pool, deposit_id, actor).await;
    }
    deposit(pool, deposit_id).await
}

/// The bag leaves the till: credit the drawer, debit cash in transit.
///
/// Posted on `banked_on` and not on today, because the money left the drawer on
/// the day it left the drawer — and if that month is closed the period trigger
/// refuses, which is the correct answer and the one a backdated slip should
/// get.
pub async fn bank_deposit(
    pool: &PgPool,
    deposit_id: Uuid,
    actor: &str,
) -> Result<StoreDeposit, AppError> {
    let existing = deposit(pool, deposit_id).await?;
    if existing.status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "deposit {} is {}, not waiting to leave the drawer",
            existing.deposit_number,
            existing.status.to_lowercase()
        )));
    }
    let (drawer_key, drawer_qualifier) = meaning_of(
        pool,
        &existing.drawer_account_code,
        &existing.site_id,
        &DRAWER_MEANINGS,
        "a cash drawer",
    )
    .await?;

    let intent = PostingIntent {
        posting_date: existing.banked_on,
        source_kind: "DEPOSIT".into(),
        source_id: Some(deposit_id.to_string()),
        rule_version: "store_deposit/1".into(),
        currency: existing.currency.clone(),
        memo: Some(format!(
            "{} — banked from {} by {}",
            existing.deposit_number, existing.drawer_account_name, existing.carried_by
        )),
        lines: vec![
            PostingLine::debit(TRANSIT_MEANING, &existing.site_id, existing.amount_minor),
            PostingLine::credit(&drawer_key, &existing.site_id, existing.amount_minor)
                .with_qualifier(&drawer_qualifier),
        ],
    };

    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, actor).await?;
    // Only from DRAFT: two people pressing at once means one entry, not two,
    // and the second is told the money has already left.
    let updated = sqlx::query(
        "UPDATE store_deposit
            SET status = 'IN_TRANSIT', sent_entry_id = $2, sent_by = $3
          WHERE deposit_id = $1 AND status = 'DRAFT'",
    )
    .bind(deposit_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "this deposit has already left the drawer".into(),
        ));
    }
    tx.commit().await?;

    deposit(pool, deposit_id).await
}

/// The bank credited it: debit the bank, credit cash in transit.
///
/// This is the posting a statement line agrees with, which is the point of
/// splitting the journey in two — the bank's credit now has one of OUR journal
/// lines, on the bank account, on the bank's own date, for the bank's own
/// amount, for the existing reconciliation to match against with no special
/// case for deposits anywhere in it.
pub async fn land_deposit(
    pool: &PgPool,
    deposit_id: Uuid,
    request: &LandDepositRequest,
    actor: &str,
) -> Result<StoreDeposit, AppError> {
    let existing = deposit(pool, deposit_id).await?;
    if existing.status != "IN_TRANSIT" {
        return Err(AppError::Conflict(format!(
            "deposit {} is {}; only money that has left a drawer can arrive at a bank",
            existing.deposit_number,
            existing.status.to_lowercase()
        )));
    }
    let landed_on = request.landed_on.unwrap_or(existing.banked_on);
    if landed_on < existing.banked_on {
        return Err(AppError::Validation(format!(
            "the bank credited it on {landed_on} and it left the drawer on {}; money does not \
             arrive before it is sent",
            existing.banked_on
        )));
    }
    let (bank_key, bank_qualifier) = meaning_of(
        pool,
        &existing.bank_account_code,
        &existing.site_id,
        &BANK_MEANINGS,
        "a bank account",
    )
    .await?;

    let intent = PostingIntent {
        posting_date: landed_on,
        source_kind: "DEPOSIT".into(),
        source_id: Some(deposit_id.to_string()),
        rule_version: "store_deposit/1".into(),
        currency: existing.currency.clone(),
        memo: Some(format!(
            "{} — credited to {}",
            existing.deposit_number, existing.bank_account_name
        )),
        lines: vec![
            PostingLine::debit(&bank_key, &existing.site_id, existing.amount_minor)
                .with_qualifier(&bank_qualifier),
            PostingLine::credit(TRANSIT_MEANING, &existing.site_id, existing.amount_minor),
        ],
    };

    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, actor).await?;
    let slip = request.slip_reference.trim();
    let updated = sqlx::query(
        "UPDATE store_deposit
            SET status = 'LANDED', landed_entry_id = $2, landed_on = $3, landed_by = $4,
                bank_line_id = COALESCE($5, bank_line_id),
                -- Never overwrites a reference somebody already wrote: the
                -- first account of what the bank stamped is the one worth
                -- keeping.
                slip_reference = CASE WHEN btrim(slip_reference) = '' THEN $6
                                      ELSE slip_reference END
          WHERE deposit_id = $1 AND status = 'IN_TRANSIT'",
    )
    .bind(deposit_id)
    .bind(posted.entry_id)
    .bind(landed_on)
    .bind(actor)
    .bind(request.bank_line_id)
    .bind(slip)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "this deposit has already arrived".into(),
        ));
    }
    tx.commit().await?;

    deposit(pool, deposit_id).await
}
