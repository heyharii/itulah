//! Bank statements, and agreeing them with the ledger.
//!
//! The scoring is `domain::bank_match` and is pure. This module supplies the
//! two sides — the bank's lines and our journal lines on the same account —
//! and records what was agreed.
//!
//! # Reconciling posts nothing
//!
//! A match says "we booked this and the bank has now confirmed it". It writes
//! no journal, because there is nothing new to record. The interesting rows are
//! the ones that do NOT match: either the money is in transit, or we have not
//! booked something the bank has. Turning an unmatched bank line into a journal
//! is a separate, deliberate act — conflating it with matching would make
//! "reconcile" a button that quietly invents entries.
//!
//! # A re-import is a no-op
//!
//! Somebody re-uploads the same statement; a month overlaps the month before.
//! Each line carries a deterministic fingerprint over the fields the bank
//! actually gave us, unique per account, so the second import inserts nothing
//! rather than doubling every figure on the screen.

use super::cash::{
    cash_document_approve_in, cash_document_insert, cash_document_post_in, side_from_account,
    side_from_meaning, CashDraft,
};
use super::ledger::{assert_postable, resolve_account, Intent};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    cash_direction, resolve, suggest, BankLine, Candidate, Ruleset, Suggestion,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankStatementRow {
    pub statement_id: Uuid,
    pub account_code: String,
    pub account_name: String,
    pub site_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub opening_minor: i64,
    pub closing_minor: i64,
    pub imported_by: String,
    pub imported_at: DateTime<Utc>,
    pub line_count: i64,
    pub matched_count: i64,
    /// The later import that replaced this one, when there is one (0245).
    ///
    /// Non-null means this statement is HISTORY: it is what the bank said at
    /// the time and it is kept, but it is no longer the month's statement and
    /// nothing should add it to anything. Null is the ordinary state.
    pub superseded_by: Option<Uuid>,
}

/// One line the bank reported, with whatever we have agreed about it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankStatementLineRow {
    pub line_id: Uuid,
    pub line_number: i32,
    pub value_date: NaiveDate,
    pub description: String,
    pub reference: Option<String>,
    pub debit_minor: i64,
    pub credit_minor: i64,
    /// Who the other side was, as far as anybody has said (0214). `counterparty_kind`
    /// null means nobody has looked yet; `OTHER` means somebody looked and
    /// decided it is nobody we keep a register of.
    pub counterparty_kind: Option<String>,
    pub counterparty_id: Option<String>,
    pub counterparty_name: String,
    /// What the BANK called them. Never overwritten by the field above.
    pub bank_said: String,
    pub note: String,
    /// Set only when ONE voucher has claimed the WHOLE line.
    ///
    /// Kept beside `allocations` rather than replaced by it because a screen
    /// asking "is this line done?" was reading this field before a line could
    /// be split, and a partially allocated line must not answer that question
    /// with yes. Two vouchers, or one that covers part of the line, leave it
    /// null and the reader has to look at `allocations` — which is the honest
    /// shape of the thing.
    pub matched_journal_line_id: Option<Uuid>,
    pub matched_entry_number: Option<String>,
    pub match_reasons: Vec<String>,
    /// Every claim on this line, oldest first.
    pub allocations: Vec<LineAllocation>,
    /// What the claims add up to, and what is left of the line after them.
    /// `unallocated_minor` is the figure the reconciliation screen shows and
    /// the amount the matcher scores the next candidate against.
    pub allocated_minor: i64,
    pub unallocated_minor: i64,
}

/// One voucher's claim on one bank line.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LineAllocation {
    pub match_id: Uuid,
    pub journal_line_id: Uuid,
    pub entry_number: Option<String>,
    pub allocated_minor: i64,
    /// Which fields agreed, in the matcher's words, or why a person booked it.
    pub reasons: Vec<String>,
    /// `MANUAL` or `AUTO`.
    pub decided_by_kind: String,
    pub matched_by: String,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ImportStatementLine {
    pub value_date: NaiveDate,
    pub description: String,
    pub reference: Option<String>,
    #[serde(default)]
    pub debit_minor: i64,
    #[serde(default)]
    pub credit_minor: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ImportStatementRequest {
    pub account_code: String,
    pub site_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub opening_minor: i64,
    pub closing_minor: i64,
    pub source_name: Option<String>,
    pub lines: Vec<ImportStatementLine>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ImportOutcome {
    pub statement_id: Uuid,
    pub inserted: i64,
    /// Lines already present under this account, by fingerprint. Reported
    /// rather than silently dropped: a re-import that says "0 new" is the
    /// system confirming it did the right thing.
    pub duplicates: i64,
    /// The import this one replaced, when the same account, unit and period
    /// had already been loaded.
    ///
    /// Reported for the same reason `duplicates` is: an upload that quietly
    /// displaced last week's is one nobody can account for afterwards. Null is
    /// the ordinary case — nothing was in force for that month yet.
    pub superseded: Option<Uuid>,
}

/// A deterministic fingerprint over what the bank actually gave us.
///
/// Normalised so that whitespace and case in a narration do not create a second
/// copy of the same line, and length-prefixed so that two fields cannot be
/// slid into one another — "AB" + "C" must not collide with "A" + "BC".
fn fingerprint(
    account_code: &str,
    value_date: NaiveDate,
    debit: i64,
    credit: i64,
    reference: &str,
    description: &str,
) -> String {
    let normalise = |text: &str| -> String {
        text.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_uppercase()
    };
    let mut hasher = Sha256::new();
    for field in [
        account_code.as_bytes(),
        value_date.to_string().as_bytes(),
        debit.to_string().as_bytes(),
        credit.to_string().as_bytes(),
        normalise(reference).as_bytes(),
        normalise(description).as_bytes(),
    ] {
        hasher.update((field.len() as u64).to_be_bytes());
        hasher.update(field);
    }
    hex::encode(hasher.finalize())
}

pub async fn import_statement(
    pool: &PgPool,
    request: &ImportStatementRequest,
    actor: &str,
) -> Result<ImportOutcome, AppError> {
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "a statement with no lines says nothing".into(),
        ));
    }
    let account = request.account_code.trim();
    let statement_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;

    // At most one statement per account, unit and period is IN FORCE (0245).
    // A second import of the same month replaces the first rather than joining
    // it — a bank reissues a statement, a first upload is cut short, a
    // correction arrives, and before this both sat there and anything that
    // added them up counted the month twice.
    //
    // The old row is not deleted: what the bank said, and when, is evidence.
    // It is marked as replaced by this import, which is the fact worth keeping.
    // `FOR UPDATE` so two uploads racing each other cannot both find nothing in
    // force and both insert — the partial unique index would then refuse the
    // second, which is correct but arrives as a constraint violation rather
    // than as a supersede.
    let superseded: Option<Uuid> = sqlx::query_scalar(
        "SELECT statement_id FROM bank_statement
          WHERE account_code = $1 AND site_id = $2
            AND period_start = $3 AND period_end = $4
            AND superseded_by IS NULL
          FOR UPDATE",
    )
    .bind(account)
    .bind(&request.site_id)
    .bind(request.period_start)
    .bind(request.period_end)
    .fetch_optional(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO bank_statement
           (statement_id, account_code, site_id, period_start, period_end,
            opening_minor, closing_minor, source_name, imported_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(statement_id)
    .bind(account)
    .bind(&request.site_id)
    .bind(request.period_start)
    .bind(request.period_end)
    .bind(request.opening_minor)
    .bind(request.closing_minor)
    .bind(request.source_name.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    let mut inserted = 0i64;
    let mut duplicates = 0i64;
    for (index, line) in request.lines.iter().enumerate() {
        if (line.debit_minor == 0) == (line.credit_minor == 0) {
            return Err(AppError::Validation(format!(
                "line {} must be either a debit or a credit, and not zero",
                index + 1
            )));
        }
        let print = fingerprint(
            account,
            line.value_date,
            line.debit_minor,
            line.credit_minor,
            line.reference.as_deref().unwrap_or(""),
            &line.description,
        );
        // ON CONFLICT on the per-account fingerprint index: the second import of
        // a line is a no-op, not an error, because re-uploading a statement is
        // an ordinary thing to do and should not need explaining.
        let done = sqlx::query(
            "INSERT INTO bank_statement_line
               (line_id, statement_id, line_number, value_date, description, reference,
                debit_minor, credit_minor, fingerprint, account_code)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (account_code, fingerprint) DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(statement_id)
        .bind(index as i32 + 1)
        .bind(line.value_date)
        .bind(&line.description)
        .bind(line.reference.as_deref())
        .bind(line.debit_minor)
        .bind(line.credit_minor)
        .bind(&print)
        .bind(account)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if done == 1 {
            inserted += 1;
        } else {
            duplicates += 1;
        }
    }

    // After the new row exists, so the foreign key has something to point at.
    if let Some(replaced) = superseded {
        sqlx::query("UPDATE bank_statement SET superseded_by = $2 WHERE statement_id = $1")
            .bind(replaced)
            .bind(statement_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    Ok(ImportOutcome {
        statement_id,
        inserted,
        duplicates,
        superseded,
    })
}

// ── the statement list ───────────────────────────────────────────────────
//
// The same envelope as every other list here — rows, a cursor, a total, facet
// counts — so one hook in the browser draws all of them.

/// How many statements the list returns when the caller does not say.
const DEFAULT_STATEMENT_LIMIT: i64 = 100;
/// And the most it will return however loudly a caller asks.
const MAX_STATEMENT_LIMIT: i64 = 500;

/// What a caller is asking the statement list for.
#[derive(Clone, Debug, Default)]
pub struct BankStatementScope {
    /// Free text, tried against the account's code, the client's name for it
    /// and the person who uploaded the file.
    pub needle: Option<String>,
    /// Locations to keep. Empty means every location.
    pub sites: Vec<String>,
    /// Account codes to keep — which bank, spelled as the client spells it.
    pub accounts: Vec<String>,
    /// `RECONCILED`, `PARTIAL`, `UNTOUCHED` — how far through agreeing this
    /// statement somebody got.
    ///
    /// Derived on read from the lines and the matches, never stored: a stored
    /// progress column and the matches it summarises drift, and when they do
    /// nobody can say which to believe.
    pub states: Vec<String>,
    /// `imported`, `account` or `unmatched`. Anything else is the house order,
    /// most recent period first — see [`bank_statement_page`].
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_STATEMENT_LIMIT`], not "everything".
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many statements would still be there.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankStatementFacet {
    pub value: String,
    /// The client's own name for an account, the site's name for a location;
    /// absent for a state, whose words belong to the screen.
    pub label: Option<String>,
    pub count: i64,
}

/// The three things the statement list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankStatementFacets {
    pub sites: Vec<BankStatementFacet>,
    pub accounts: Vec<BankStatementFacet>,
    pub states: Vec<BankStatementFacet>,
}

/// A page of the statement list, and the shape of everything it was drawn
/// from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankStatementPage {
    pub rows: Vec<BankStatementRow>,
    pub next_cursor: Option<String>,
    /// Every statement the search and the filters match, not just this page.
    pub total: i64,
    /// How many lines across the matched statements nobody has agreed yet,
    /// added HERE rather than in the browser.
    ///
    /// The one number this screen exists for: reconciliation is not done until
    /// it is zero, and a browser summing a page would report it done while a
    /// second page of unmatched lines waited below.
    pub total_unmatched: i64,
    pub facets: BankStatementFacets,
}

/// Where the previous page stopped — as a ROW, not as a position.
#[derive(Serialize, Deserialize)]
struct StatementCursor {
    statement_id: Uuid,
}

impl StatementCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// One statement row, defined once, so the facets count exactly what the page
/// can show.
///
/// Binds: `$1` the search pattern or NULL.
///
/// `state` and `unmatched` are computed here rather than in three places
/// because three spellings of "how far through this are we" is three chances
/// to disagree — the filter narrows by it, the facet counts it and the total
/// sums it.
const STATEMENT_ROWS: &str = "
    SELECT s.statement_id, s.account_code, a.name AS account_name, s.site_id,
           s.period_start, s.period_end, s.opening_minor, s.closing_minor,
           s.imported_by, s.imported_at, s.superseded_by,
           counts.line_count, counts.matched_count,
           (counts.line_count - counts.matched_count) AS unmatched,
           CASE
               WHEN counts.line_count = 0 THEN 'UNTOUCHED'
               WHEN counts.matched_count = 0 THEN 'UNTOUCHED'
               WHEN counts.matched_count < counts.line_count THEN 'PARTIAL'
               ELSE 'RECONCILED'
           END AS state
      FROM bank_statement s
      JOIN ledger_account a ON a.account_code = s.account_code
      JOIN LATERAL (
           -- Counted per LINE and not per claim, and a line counts as agreed
           -- only once its claims cover it: since 0213 one line may hold
           -- several, and counting claims would report a statement as more
           -- than done.
           SELECT COUNT(*)::bigint AS line_count,
                  COUNT(*) FILTER (
                      WHERE COALESCE(taken.allocated, 0)
                            >= GREATEST(l.debit_minor, l.credit_minor)
                  )::bigint AS matched_count
             FROM bank_statement_line l
             LEFT JOIN LATERAL (
                  SELECT SUM(m.allocated_minor) AS allocated
                    FROM bank_line_match m
                   WHERE m.line_id = l.line_id
             ) taken ON TRUE
            WHERE l.statement_id = s.statement_id
      ) counts ON TRUE
     WHERE $1::text IS NULL
        OR s.account_code ILIKE $1
        OR a.name ILIKE $1
        OR s.imported_by ILIKE $1
";

fn to_statement(row: &sqlx::postgres::PgRow) -> Result<BankStatementRow, AppError> {
    Ok(BankStatementRow {
        statement_id: row.try_get("statement_id")?,
        account_code: row.try_get("account_code")?,
        account_name: row.try_get("account_name")?,
        site_id: row.try_get("site_id")?,
        period_start: row.try_get("period_start")?,
        period_end: row.try_get("period_end")?,
        opening_minor: row.try_get("opening_minor")?,
        closing_minor: row.try_get("closing_minor")?,
        imported_by: row.try_get("imported_by")?,
        imported_at: row.try_get("imported_at")?,
        line_count: row.try_get("line_count")?,
        matched_count: row.try_get("matched_count")?,
        superseded_by: row.try_get("superseded_by")?,
    })
}

/// What the bank has told us, one page at a time.
pub async fn bank_statement_page(
    pool: &PgPool,
    scope: BankStatementScope,
) -> Result<BankStatementPage, AppError> {
    // A blank search is not a search.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let accounts = (!scope.accounts.is_empty()).then(|| scope.accounts.clone());
    let states = (!scope.states.is_empty()).then(|| scope.states.clone());

    // The sort, and the tie-break that makes it total. Every order ends in the
    // statement id, which is the primary key.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("imported") => ("imported_at", scope.desc),
        Some("account") => ("account_code", scope.desc),
        // What is still owed to this screen. The order somebody works in.
        Some("unmatched") => ("unmatched", scope.desc),
        // The house order, and the one this endpoint has always answered in:
        // the most recent period first, then the most recent upload. `dir` is
        // not read — a default order that reverses is not a default.
        _ => ("period_start, imported_at", true),
    };
    let cols = format!("{lead}, statement_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!(
        "{} {dir}, statement_id {dir}",
        lead.replace(", ", &format!(" {dir}, "))
    );
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(StatementCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(DEFAULT_STATEMENT_LIMIT)
        .clamp(1, MAX_STATEMENT_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({STATEMENT_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched
              WHERE ($2::text[] IS NULL OR site_id = ANY($2))
                AND ($3::text[] IS NULL OR account_code = ANY($3))
                AND ($4::text[] IS NULL OR state = ANY($4))
         )
         SELECT * FROM kept
          WHERE $5::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE statement_id = $5)
          ORDER BY {order}
          LIMIT $6"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&sites)
        .bind(&accounts)
        .bind(&states)
        .bind(cursor.as_ref().map(|c| c.statement_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            StatementCursor {
                statement_id: row.try_get("statement_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows
        .iter()
        .map(to_statement)
        .collect::<Result<Vec<_>, _>>()?;
    let (total, total_unmatched, facets) =
        statement_facets(pool, &scope, needle.as_deref()).await?;
    Ok(BankStatementPage {
        rows: out,
        next_cursor,
        total,
        total_unmatched,
        facets,
    })
}

/// How many statements there are, how much is still unagreed, and how they
/// split.
///
/// Per-value counts read the SEARCHED set and the totals read the FILTERED
/// one, for the reason every other facet query here gives.
async fn statement_facets(
    pool: &PgPool,
    scope: &BankStatementScope,
    needle: Option<&str>,
) -> Result<(i64, i64, BankStatementFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({STATEMENT_ROWS}), kept AS (
             SELECT * FROM searched
              WHERE ($2::text[] IS NULL OR site_id = ANY($2))
                AND ($3::text[] IS NULL OR account_code = ANY($3))
                AND ($4::text[] IS NULL OR state = ANY($4))
         )
         SELECT 'site' AS kind, s.site_id AS value,
                (SELECT p.name FROM site p WHERE p.id = s.site_id) AS label,
                COUNT(*)::bigint AS n, 0::bigint AS unmatched
           FROM searched s GROUP BY s.site_id
          UNION ALL
         SELECT 'account', s.account_code, MIN(s.account_name),
                COUNT(*)::bigint, 0::bigint
           FROM searched s GROUP BY s.account_code
          UNION ALL
         SELECT 'state', s.state, NULL::text, COUNT(*)::bigint, 0::bigint
           FROM searched s GROUP BY s.state
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint,
                -- Only what is IN FORCE. A superseded import's lines are still
                -- rows and are still listed on their own statement, but they
                -- are not work anybody has to finish — counting them would put
                -- last month's replaced upload into \"how much is left to
                -- reconcile\" and leave that number never reaching zero.
                COALESCE(SUM(unmatched) FILTER (WHERE superseded_by IS NULL), 0)::bigint
           FROM kept"
    );
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let accounts = (!scope.accounts.is_empty()).then(|| scope.accounts.clone());
    let states = (!scope.states.is_empty()).then(|| scope.states.clone());
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&sites)
        .bind(&accounts)
        .bind(&states)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut unmatched = 0i64;
    let mut facets = BankStatementFacets {
        sites: Vec::new(),
        accounts: Vec::new(),
        states: Vec::new(),
    };
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let n: i64 = row.try_get("n")?;
        let facet = BankStatementFacet {
            value,
            label,
            count: n,
        };
        match kind.as_str() {
            "site" => facets.sites.push(facet),
            "account" => facets.accounts.push(facet),
            "state" => facets.states.push(facet),
            _ => {
                total = n;
                unmatched = row.try_get("unmatched")?;
            }
        }
    }
    for list in [&mut facets.sites, &mut facets.accounts, &mut facets.states] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((total, unmatched, facets))
}

pub async fn statement_lines(
    pool: &PgPool,
    statement_id: Uuid,
) -> Result<Vec<BankStatementLineRow>, AppError> {
    // One row per CLAIM, not per line — a line with two vouchers comes back
    // twice and is folded below. Ordered by the claim's own time so the screen
    // lists them in the order somebody made them.
    let rows = sqlx::query(
        "SELECT l.line_id, l.line_number, l.value_date, l.description, l.reference,
                l.debit_minor, l.credit_minor,
                l.counterparty_kind, l.counterparty_id, l.counterparty_name, l.bank_said, l.note,
                m.match_id, m.journal_line_id, m.allocated_minor, m.reasons,
                m.decided_by_kind, m.matched_by,
                (SELECT e.entry_number FROM journal_line jl
                   JOIN journal_entry e USING (entry_id)
                  WHERE jl.line_id = m.journal_line_id) AS entry_number
           FROM bank_statement_line l
           LEFT JOIN bank_line_match m ON m.line_id = l.line_id
          WHERE l.statement_id = $1
          ORDER BY l.line_number, m.matched_at",
    )
    .bind(statement_id)
    .fetch_all(pool)
    .await?;

    let mut lines: Vec<BankStatementLineRow> = Vec::new();
    for row in &rows {
        let line_id: Uuid = row.try_get("line_id")?;
        if lines.last().map(|last| last.line_id) != Some(line_id) {
            let debit: i64 = row.try_get("debit_minor")?;
            let credit: i64 = row.try_get("credit_minor")?;
            lines.push(BankStatementLineRow {
                line_id,
                line_number: row.try_get("line_number")?,
                value_date: row.try_get("value_date")?,
                description: row.try_get("description")?,
                reference: row.try_get("reference")?,
                debit_minor: debit,
                credit_minor: credit,
                counterparty_kind: row.try_get("counterparty_kind")?,
                counterparty_id: row.try_get("counterparty_id")?,
                counterparty_name: row.try_get("counterparty_name")?,
                bank_said: row.try_get("bank_said")?,
                note: row.try_get("note")?,
                matched_journal_line_id: None,
                matched_entry_number: None,
                match_reasons: Vec::new(),
                allocations: Vec::new(),
                allocated_minor: 0,
                // Replaced below once the claims are known. Starting from the
                // line's own magnitude means a line nobody claimed is already
                // right without a second pass.
                unallocated_minor: debit.max(credit),
            });
        }
        let Some(match_id) = row.try_get::<Option<Uuid>, _>("match_id")? else {
            continue;
        };
        let line = lines
            .last_mut()
            .expect("a line was pushed for this row above");
        let allocated: i64 = row.try_get("allocated_minor")?;
        line.allocations.push(LineAllocation {
            match_id,
            journal_line_id: row.try_get("journal_line_id")?,
            entry_number: row.try_get("entry_number")?,
            allocated_minor: allocated,
            reasons: row
                .try_get::<Option<Vec<String>>, _>("reasons")?
                .unwrap_or_default(),
            decided_by_kind: row.try_get("decided_by_kind")?,
            matched_by: row.try_get("matched_by")?,
        });
        line.allocated_minor += allocated;
        line.unallocated_minor = line.debit_minor.max(line.credit_minor) - line.allocated_minor;
    }

    // The legacy answer, filled only where it is still true: one voucher, whole
    // line. See the note on the field.
    for line in &mut lines {
        if line.unallocated_minor == 0 && line.allocations.len() == 1 {
            let only = &line.allocations[0];
            line.matched_journal_line_id = Some(only.journal_line_id);
            line.matched_entry_number = only.entry_number.clone();
            line.match_reasons = only.reasons.clone();
        }
    }
    Ok(lines)
}

/// What the ledger has on this account near this date that nothing has claimed.
///
/// Deliberately our own journal, not other statement lines. Reconciliation is
/// the question "do the bank and the books agree", and it can only be answered
/// against the books.
async fn candidates_for(
    pool: &PgPool,
    account_code: &str,
    from: NaiveDate,
    to: NaiveDate,
    slack_days: i64,
) -> Result<Vec<Candidate>, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, e.posting_date, l.debit_minor, l.credit_minor,
                e.entry_number, COALESCE(l.memo, e.memo, '') AS memo
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE l.account_code = $1
            AND e.posting_date BETWEEN ($2::date - $4::int) AND ($3::date + $4::int)
            AND NOT EXISTS (SELECT 1 FROM bank_line_match m WHERE m.journal_line_id = l.line_id)",
    )
    .bind(account_code)
    .bind(from)
    .bind(to)
    .bind(slack_days as i32)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let line_id: Uuid = row.try_get("line_id")?;
            let date: NaiveDate = row.try_get("posting_date")?;
            let debit: i64 = row.try_get("debit_minor")?;
            let credit: i64 = row.try_get("credit_minor")?;
            Ok(Candidate {
                journal_line_id: line_id.to_string(),
                day: i64::from(date.num_days_from_ce()),
                // A credit on our bank account is money leaving it, which the
                // bank reports as a debit on its own statement. The matcher
                // compares magnitudes and directions, so the translation
                // happens exactly here and nowhere else.
                amount_minor: debit.max(credit),
                outgoing: credit > 0,
                reference: row.try_get("entry_number")?,
                memo: row.try_get("memo")?,
            })
        })
        .collect()
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LineSuggestions {
    pub line_id: Uuid,
    pub suggestions: Vec<Suggestion>,
}

/// Score every unmatched line of a statement against the ledger, as one plan.
///
/// The candidates are fetched once for the whole statement rather than per
/// line, because the assignment has to be made across all of them together: two
/// lines can each pick the same ledger row as their unique best, and only a plan
/// that sees both can refuse the second. Per-line scoring would offer an
/// "Accept" button that the database then rejects — correct data, and a screen
/// that lied.
/// `exact` is ERPNext's *exact match* switch, and it changes what is OFFERED,
/// never what is taken automatically.
///
/// On, a candidate has to clear `min_to_suggest`, which in practice means the
/// amount agrees. Off, everything on the account inside the date window comes
/// back in score order — which is the only way to settle the FIRST half of a
/// split line: a transfer of 9.950.000 paying two bills equals neither of them,
/// so nothing scores, so a screen that only ever showed scored candidates could
/// never start the split. The automatic plan below is unaffected: it still
/// takes a lone leader at or above `auto_match_at` and nothing else.
pub async fn suggest_matches(
    pool: &PgPool,
    statement_id: Uuid,
    exact: bool,
) -> Result<Vec<LineSuggestions>, AppError> {
    let row = sqlx::query(
        "SELECT account_code, period_start, period_end FROM bank_statement WHERE statement_id = $1",
    )
    .bind(statement_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("statement".into()))?;
    let account: String = row.try_get("account_code")?;
    let start: NaiveDate = row.try_get("period_start")?;
    let end: NaiveDate = row.try_get("period_end")?;

    let mut rules = Ruleset::default();
    if !exact {
        rules.min_to_suggest = 0;
        rules.allow_partial = true;
    }
    let lines = statement_lines(pool, statement_id).await?;
    // Anything with room left, not merely anything unclaimed: half a line is
    // still a question, and the half that is left is what the next candidate
    // has to match.
    let open: Vec<&BankStatementLineRow> = lines
        .iter()
        .filter(|line| line.unallocated_minor > 0)
        .collect();
    if open.is_empty() {
        return Ok(Vec::new());
    }

    // One window covering the whole statement plus the matcher's date slack, so
    // every line is scored against the same candidate set. Scoring line by line
    // against different sets would make the plan depend on which line was asked
    // about first.
    let candidates = candidates_for(pool, &account, start, end, rules.date_window_days).await?;

    let bank: Vec<BankLine> = open
        .iter()
        .map(|line| BankLine {
            line_id: line.line_id.to_string(),
            day: i64::from(line.value_date.num_days_from_ce()),
            // The REMAINDER, so the second voucher of a split line is scored
            // against what is actually still owed on it rather than against the
            // whole transfer, which nothing will ever equal again.
            amount_minor: line.unallocated_minor,
            // A debit on the bank's statement is money leaving the account.
            outgoing: line.debit_minor > 0,
            reference: line.reference.clone().unwrap_or_default(),
            description: line.description.clone(),
        })
        .collect();

    let plan = resolve(&bank, &candidates, &rules);
    // Which line the plan gave each ledger row to. A row promised to somebody
    // else is not offered here at all — the alternative is a button that cannot
    // work, and a person who has to discover that by clicking it.
    let spoken_for: std::collections::HashMap<&str, &str> = plan
        .iter()
        .map(|a| (a.journal_line_id.as_str(), a.line_id.as_str()))
        .collect();

    Ok(bank
        .iter()
        .map(|line| LineSuggestions {
            line_id: line.line_id.parse().unwrap_or_default(),
            suggestions: suggest(line, &candidates, &rules)
                .into_iter()
                .filter_map(|mut suggestion| {
                    match spoken_for.get(suggestion.journal_line_id.as_str()) {
                        // Planned for a different line: not shown.
                        Some(&owner) if owner != line.line_id => None,
                        // Planned for this one: the plan decides, not the score.
                        Some(_) => {
                            suggestion.auto_match = true;
                            Some(suggestion)
                        }
                        // Nobody's: offer it, but never as an automatic match —
                        // if it were good enough for that the plan would have
                        // taken it.
                        None => {
                            suggestion.auto_match = false;
                            Some(suggestion)
                        }
                    }
                })
                .collect(),
        })
        .collect())
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ConfirmMatchRequest {
    pub journal_line_id: Uuid,
    pub score: Option<i32>,
    #[serde(default)]
    pub reasons: Vec<String>,
    /// True when the matcher chose it unaided. Recorded so that an auto-match a
    /// person later undoes is evidence the threshold is wrong.
    #[serde(default)]
    pub automatic: bool,
    /// How much of the bank line this voucher claims.
    ///
    /// Absent means all that is left of it, which is what every caller meant
    /// before a line could be split and what a caller settling a line in one
    /// go still means. Present is the Friday case: one transfer, two suppliers.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub allocated_minor: Option<i64>,
}

/// What a person concluded about a bank line. ERPNext's *Update Bank
/// Transaction*, with one deliberate narrowing — and with their word `party`
/// spelled the way this codebase spells it: **counterparty**.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateBankLineRequest {
    /// `SUPPLIER`, `CUSTOMER`, `MEMBER`, `STAFF` or `OTHER`. Null clears it.
    pub counterparty_kind: Option<String>,
    pub counterparty_id: Option<String>,
    #[serde(default)]
    pub counterparty_name: String,
    #[serde(default)]
    pub note: String,
}

/// Record who the other side was.
///
/// # What this deliberately cannot do
///
/// ERPNext lets the same dialog edit the transaction's reference number and
/// description, because its import sometimes lands without them. Ours will not:
/// those fields came out of the bank's file, the dedupe fingerprint is computed
/// over them, and a line whose narration can be retyped is no longer the
/// evidence the reconciliation is being checked against. Our reading of the
/// evidence goes in its own columns, beside it.
pub async fn update_line(
    pool: &PgPool,
    line_id: Uuid,
    request: &UpdateBankLineRequest,
    actor: &str,
) -> Result<BankStatementLineRow, AppError> {
    const KINDS: [&str; 5] = ["SUPPLIER", "CUSTOMER", "MEMBER", "STAFF", "OTHER"];
    if let Some(kind) = request.counterparty_kind.as_deref() {
        if !KINDS.contains(&kind) {
            return Err(AppError::Validation(format!(
                "counterparty kind {kind:?} is not one of {}",
                KINDS.join(", ")
            )));
        }
    }
    if request.counterparty_kind.is_none() && request.counterparty_id.is_some() {
        return Err(AppError::Validation(
            "a counterparty id without a kind says nothing".into(),
        ));
    }

    let statement_id: Option<Uuid> = sqlx::query(
        "UPDATE bank_statement_line
            SET counterparty_kind = $2, counterparty_id = $3, counterparty_name = $4, note = $5,
                counterparty_set_by = $6, counterparty_set_at = now()
          WHERE line_id = $1
      RETURNING statement_id",
    )
    .bind(line_id)
    .bind(request.counterparty_kind.as_deref())
    .bind(request.counterparty_id.as_deref())
    .bind(request.counterparty_name.trim())
    .bind(request.note.trim())
    .bind(actor)
    .fetch_optional(pool)
    .await?
    .map(|row| row.try_get("statement_id"))
    .transpose()?;

    let statement_id = statement_id.ok_or_else(|| AppError::NotFound("bank line".into()))?;
    statement_lines(pool, statement_id)
        .await?
        .into_iter()
        .find(|row| row.line_id == line_id)
        .ok_or_else(|| AppError::NotFound("bank line".into()))
}

/// What is left of a bank line after everything already claimed against it.
///
/// Read inside the same transaction as the write that follows it, so two people
/// agreeing the last of a line at once cannot both be told there is room: the
/// row is locked here, and the second waits and then sees the truth. The
/// database trigger from 0213 is still the backstop — this exists so the caller
/// gets a sentence rather than a constraint name.
async fn remaining_on(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    line_id: Uuid,
) -> Result<i64, AppError> {
    let row = sqlx::query(
        // `SUM()` over a bigint is NUMERIC in Postgres, and a numeric read as
        // an i64 is a decode error that surfaces as "database operation
        // failed" — a 500 with nothing to act on. The cast is not decoration.
        "SELECT (GREATEST(l.debit_minor, l.credit_minor)
                 - COALESCE((SELECT SUM(m.allocated_minor)
                               FROM bank_line_match m
                              WHERE m.line_id = l.line_id), 0))::bigint AS remaining
           FROM bank_statement_line l
          WHERE l.line_id = $1
          FOR UPDATE",
    )
    .bind(line_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("bank line".into()))?;
    Ok(row.try_get("remaining")?)
}

/// Agree that a bank line and a journal line are the same event.
///
/// Writes no journal. `UNIQUE (journal_line_id)` still does half the work — a
/// voucher claimed twice is refused by the database rather than by a check
/// somebody could forget — and since 0213 the other half is an amount: several
/// vouchers may claim one line, and together they may not claim more than it
/// holds.
pub async fn confirm_match(
    pool: &PgPool,
    line_id: Uuid,
    request: &ConfirmMatchRequest,
    actor: &str,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let remaining = remaining_on(&mut tx, line_id).await?;
    if remaining <= 0 {
        return Err(AppError::Validation(
            "this bank line is already fully allocated".into(),
        ));
    }
    // Absent means "the rest of it", which is what settling a line in one go
    // has always meant.
    let allocated = request.allocated_minor.unwrap_or(remaining);
    if allocated <= 0 {
        return Err(AppError::Validation(
            "an allocation must be more than nothing".into(),
        ));
    }
    if allocated > remaining {
        return Err(AppError::Validation(format!(
            "only {remaining} is left of this bank line, and {allocated} was allocated"
        )));
    }

    sqlx::query(
        "INSERT INTO bank_line_match
           (match_id, line_id, journal_line_id, decided_by_kind, score, reasons,
            matched_by, allocated_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(Uuid::new_v4())
    .bind(line_id)
    .bind(request.journal_line_id)
    .bind(if request.automatic { "AUTO" } else { "MANUAL" })
    .bind(request.score)
    .bind(&request.reasons)
    .bind(actor)
    .bind(allocated)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Take an agreement back — one voucher's claim, or every claim on the line.
///
/// `journal_line_id` absent still means "all of them", which is what this did
/// before a line could be split. Naming one is how a person undoes the second
/// of two allocations without losing the first.
pub async fn unmatch(
    pool: &PgPool,
    line_id: Uuid,
    journal_line_id: Option<Uuid>,
) -> Result<(), AppError> {
    match journal_line_id {
        Some(journal_line_id) => {
            sqlx::query(
                "DELETE FROM bank_line_match
                  WHERE line_id = $1 AND journal_line_id = $2",
            )
            .bind(line_id)
            .bind(journal_line_id)
            .execute(pool)
            .await?;
        }
        None => {
            sqlx::query("DELETE FROM bank_line_match WHERE line_id = $1")
                .bind(line_id)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Booking a line nobody booked
// ---------------------------------------------------------------------------
//
// The act 0071 named and left unbuilt. Matching says "we booked this and the
// bank has confirmed it"; this says "the bank did something we never recorded,
// and here is where it goes" — a monthly account charge, interest credited, a
// customer's transfer that arrived without a document.
//
// It is one act and not two. Creating the document, posting it and agreeing it
// with the line are one decision, and splitting them leaves a window in which
// an entry exists and nothing points at the line that caused it — which is
// exactly the state a reconciliation is supposed to eliminate. Every write is
// in one transaction, so the line reads as agreed the moment the entry exists.
//
// # What changed, and why the raw journal went away
//
// This used to write a journal entry directly, with source kind
// BANK_STATEMENT, and stop. It balanced and it was traceable, and it was still
// the only place in the system where money moved with no document behind it:
// nothing to print, nothing to approve, nothing to reverse as a unit, and no
// number a person could file the bank's own advice slip under.
//
// So it now creates a cash document (0115) and posts THAT. The line becomes a
// KM when the bank credited us and a KK when it charged us, it carries a number
// in the client's own format, and it prints. `BANK_STATEMENT` stays a legal
// source kind because entries booked the old way still exist and still name
// their line; nothing new is written with it.

/// The meanings a statement can be imported against.
///
/// A statement is normally a bank's, but `bank_statement` is bounded only by
/// the chart, and a treasurer reconciling a cash box against a count sheet is
/// the same exercise. Every meaning that holds money is admitted; a mapping to
/// anything else is refused below by simply not being found.
///
/// One list, shared with the cash document, because "does this account hold
/// money" has to have one answer: a statement imported against an account the
/// cash document did not think held money would produce a document whose
/// direction was decided the other way round.
use crate::cloud::domain::MONEY_MEANINGS as STATEMENT_MEANINGS;

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BookBankLineRequest {
    /// Where the other side of this goes: a bank charge to the bank-charges
    /// account, interest to interest income. A postable, active account, chosen
    /// by the person reading the statement.
    pub account_code: String,
    /// Why this line is that account. Required, and for the same reason a
    /// reversal's reason is: it is the only record of the judgement somebody
    /// made, and a bank line booked with no explanation is the entry an auditor
    /// asks about first.
    pub memo: String,
    /// Who the slip names. The bank, usually — most of these are the bank's own
    /// charges — so it is optional and defaults to that.
    pub party_name: Option<String>,
}

/// Which meaning carries this account here, so the entry posts through the map.
///
/// The statement stores a client account code, not a meaning. Resolving it back
/// to a key is not ceremony: it posts the bank leg through the same door every
/// other rule uses, and it refuses a statement imported against an account
/// nobody mapped — which is a real gap, because such an account has no payment,
/// no sale and no rule that could ever have put a candidate on it to match.
///
/// Two mappings pointing at one account at one location is ambiguous and is
/// refused rather than guessed. It is a genuine mistake on the Account Map —
/// the same account cannot be both the BCA giro and the Mandiri one — and
/// picking either would post correctly today and wrongly the day one of them
/// moves.
pub(super) async fn statement_meaning(
    executor: impl sqlx::PgExecutor<'_>,
    account_code: &str,
    site_id: &str,
) -> Result<(String, String), AppError> {
    let rows = sqlx::query(
        "SELECT semantic_key, qualifier FROM account_map
          WHERE account_code = $1 AND site_id = $2 AND semantic_key = ANY($3)
          ORDER BY semantic_key, qualifier",
    )
    .bind(account_code)
    .bind(site_id)
    .bind(&STATEMENT_MEANINGS[..])
    .fetch_all(executor)
    .await?;

    match rows.len() {
        0 => Err(AppError::Validation(format!(
            "no money account is mapped to {account_code} at {site_id}; point one of {} at it on \
             the Account Map screen before booking anything against this statement",
            STATEMENT_MEANINGS.join(", ")
        ))),
        1 => Ok((
            rows[0].try_get("semantic_key")?,
            rows[0].try_get("qualifier")?,
        )),
        _ => Err(AppError::Validation(format!(
            "{account_code} at {site_id} is mapped by more than one meaning; one account carries \
             one meaning, so fix the Account Map before booking against it"
        ))),
    }
}

/// What booking one line produced.
pub struct BookedBankLine {
    pub document_id: Uuid,
    /// `KM-26-09-00013`. What the bank's own advice slip gets filed under.
    pub number: String,
    pub entry_id: Uuid,
    pub entry_number: String,
    pub journal_line_id: Uuid,
    pub total_minor: i64,
}

/// Where the other side of a bank line goes.
///
/// Either a meaning — which is what a rule proposes — or a client account code,
/// which is what a person reading a statement chooses. The two callers differ
/// in exactly this and in nothing else, which is why they share everything
/// below rather than each growing their own copy of it.
pub(super) enum OtherSide {
    Meaning {
        semantic_key: String,
        qualifier: String,
        site_id: String,
    },
    Account {
        account_code: String,
    },
}

/// Turn an unmatched statement line into a cash document, post it, and agree
/// the line with it. One transaction, three writes, one decision.
///
/// # The two legs
///
/// One on the statement's own account, resolved through `account_map` from the
/// code the statement carries; one on the account the caller chose. The
/// direction follows the bank's line and nothing else: a DEBIT on the bank's
/// statement is money leaving the account, so our books CREDIT the bank and
/// debit the other side. That is the same translation `candidates_for` makes
/// when it scores a journal line against a bank line, and it has to be, or a
/// line booked here would never match a line imported there.
pub(super) async fn bank_line_to_document(
    tx: &mut Transaction<'_, Postgres>,
    line_id: Uuid,
    other: &OtherSide,
    party_name: &str,
    memo: &str,
    match_reason: &str,
    actor: &str,
) -> Result<BookedBankLine, AppError> {
    let memo = memo.trim();
    if memo.is_empty() {
        return Err(AppError::Validation(
            "booking a bank line needs a note saying what it was; it is the only record of why \
             this account was chosen"
                .into(),
        ));
    }

    let line = sqlx::query(
        "SELECT l.value_date, l.description, l.debit_minor, l.credit_minor,
                l.account_code, s.site_id,
                EXISTS (SELECT 1 FROM bank_line_match m WHERE m.line_id = l.line_id) AS matched
           FROM bank_statement_line l
           JOIN bank_statement s USING (statement_id)
          WHERE l.line_id = $1
          FOR UPDATE OF l",
    )
    .bind(line_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("bank statement line".into()))?;

    // Refused here so the message says what happened. The unique index on
    // `bank_line_match (line_id)` is the guarantee, and it arrives as an opaque
    // 23505 that names neither the line nor the reason.
    if line.try_get::<bool, _>("matched")? {
        return Err(AppError::Conflict(
            "this line is already agreed with a journal line; unmatch it first if the entry \
             behind it is wrong"
                .into(),
        ));
    }

    let bank_account: String = line.try_get("account_code")?;
    let site_id: String = line.try_get("site_id")?;
    let value_date: NaiveDate = line.try_get("value_date")?;
    let description: String = line.try_get("description")?;
    let debit: i64 = line.try_get("debit_minor")?;
    let credit: i64 = line.try_get("credit_minor")?;

    let (key, qualifier) = statement_meaning(&mut **tx, &bank_account, &site_id).await?;
    let money = side_from_meaning(&key, &qualifier, &site_id, bank_account.clone());

    let chosen = match other {
        OtherSide::Account { account_code } => {
            let code = account_code.trim();
            if code == bank_account {
                return Err(AppError::Validation(format!(
                    "{code} is the account this statement is for; the other side of a bank line \
                     has to be somewhere else"
                )));
            }
            // Checked before anything is written, so the refusal names the
            // fault rather than arriving from the poster with a line number
            // attached. The composite foreign key on `journal_line` remains the
            // guarantee.
            assert_postable(&mut **tx, code, Intent::Post).await?;
            side_from_account(code, &site_id)
        }
        OtherSide::Meaning {
            semantic_key,
            qualifier,
            site_id: other_site,
        } => {
            let code = resolve_account(&mut **tx, semantic_key, other_site, qualifier).await?;
            assert_postable(&mut **tx, &code, Intent::Post).await?;
            side_from_meaning(semantic_key, qualifier, other_site, code)
        }
    };

    // A debit on the bank's statement is money leaving the account.
    let outgoing = debit > 0;
    let amount = debit.max(credit);
    let (from, to) = if outgoing {
        (money, chosen)
    } else {
        (chosen, money)
    };
    let direction = cash_direction(from.money, to.money).ok_or_else(|| {
        AppError::Validation(format!(
            "neither side of this line holds money, which cannot be true of a bank line; \
             {bank_account} is mapped to no money meaning at {site_id}"
        ))
    })?;

    let draft = CashDraft {
        doc_date: value_date,
        from,
        to,
        direction,
        amount_minor: amount,
        party_kind: "OTHER".into(),
        supplier_id: None,
        employee_id: None,
        // The bank, unless the caller knows better. Never blank: it is a line
        // printed on a slip.
        party_name: {
            let named = party_name.trim();
            if named.is_empty() {
                "Bank".to_string()
            } else {
                named.to_string()
            }
        },
        // The bank's own narration first, then the person's. Both, because the
        // narration is what a reconciler recognises and the note is what
        // explains the account they picked.
        memo: format!("{description} — {memo}"),
        attachment_file_id: None,
        statement_line_id: Some(line_id),
    };

    let document_id = cash_document_insert(tx, &draft, actor).await?;
    let number = cash_document_approve_in(tx, document_id, actor).await?;
    let posted = cash_document_post_in(tx, document_id, Some(value_date), actor).await?;

    // The bank leg, found by the account it landed on rather than by its
    // position in the entry. Position depends on which side of the document the
    // money was, and a rule that depended on that would break the first time a
    // bank line was booked as a transfer between two of our own accounts.
    let journal_line_id: Uuid = sqlx::query(
        "SELECT line_id FROM journal_line
          WHERE entry_id = $1 AND account_code = $2 AND site_id = $3",
    )
    .bind(posted.entry_id)
    .bind(&bank_account)
    .bind(&site_id)
    .fetch_one(&mut **tx)
    .await?
    .try_get("line_id")?;

    // What the entry above was posted for is exactly what was left of the line,
    // so the claim is that remainder and the line ends up fully agreed.
    let remaining = remaining_on(tx, line_id).await?;
    sqlx::query(
        "INSERT INTO bank_line_match
           (match_id, line_id, journal_line_id, decided_by_kind, score, reasons,
            matched_by, allocated_minor)
         VALUES ($1,$2,$3,'MANUAL',NULL,$4,$5,$6)",
    )
    .bind(Uuid::new_v4())
    .bind(line_id)
    .bind(journal_line_id)
    // MANUAL, because a person decided it — either by choosing the account or
    // by accepting a rule's proposal. The reason says which document it became.
    .bind(vec![match_reason.to_string()])
    .bind(actor)
    .bind(remaining)
    .execute(&mut **tx)
    .await?;

    Ok(BookedBankLine {
        document_id,
        number,
        entry_id: posted.entry_id,
        entry_number: posted.entry_number,
        journal_line_id,
        total_minor: posted.total_minor,
    })
}

/// The route a person reading a statement uses: they choose the account.
pub async fn book_bank_line(
    pool: &PgPool,
    line_id: Uuid,
    request: &BookBankLineRequest,
    actor: &str,
) -> Result<BookedBankLine, AppError> {
    let chosen = request.account_code.trim().to_string();
    let memo = request.memo.trim().to_string();
    let mut tx = pool.begin().await?;
    let booked = bank_line_to_document(
        &mut tx,
        line_id,
        &OtherSide::Account {
            account_code: chosen.clone(),
        },
        request.party_name.as_deref().unwrap_or(""),
        &memo,
        &format!("booked as {chosen}: {memo}"),
        actor,
    )
    .await?;
    tx.commit().await?;
    Ok(booked)
}
