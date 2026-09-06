//! Settling what a card sale left behind: the shop's proof, and head office's.
//!
//! Two exercises, deliberately kept apart, because they are done by different
//! people with different evidence on different days.
//!
//! **The shop, that evening.** Its till receipts against the EDC batch slip in
//! its hand, per terminal. It is the only moment anybody can still say why a
//! payment is on one list and not the other, and the only place the wrong-EDC
//! mistake is visible at all.
//!
//! **Head office, the next day.** The acquirer's settlement report against the
//! bank statement. This is where MDR is finally known, where the receivable is
//! discharged, and where a difference between what was promised and what
//! arrived becomes somebody's explanation rather than a rounding error.
//!
//! # What posts, and what only records
//!
//! The store reconciliation posts nothing. It is 0071's argument again: a shop
//! agreeing that its receipt and its slip describe one payment has recorded no
//! new fact about money. Only CURATED posts, and only from head office, because
//! only there is the MDR known.
//!
//! Everything that writes a journal goes through `poster::post` inside the
//! caller's transaction, so the document and its entry either both exist or
//! neither does.
//!
//! # Cross-site lines are posted as written
//!
//! A settlement debits a bank account at `dc` and credits thirteen shops'
//! receivables. The entry balances in total and does not balance per site, and
//! that is correct: the money genuinely moved between two sets of books. The
//! inter-unit legs that square each location are the poster's business, not
//! this module's — writing them here would be a second implementation of a rule
//! that has one home.

use super::ledger::resolve_account;
use super::payables::AgingBuckets;
use super::poster::{post, Posted, PostingIntent, PostingLine};
use super::sales_posting::{RetenderOutcome, RetenderRequest};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    parse_settlement_report, suggest_tender_decisions, BatchApproval, ReceiptTender,
    TenderSuggestions,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// The business day is UTC+7, so an evening's takings are dated by the shop's
/// own calendar and not by London's. The same shift `reports.rs` applies, and
/// the same reason: dating by UTC moves everything rung after five in the
/// afternoon into tomorrow.
const BUSINESS_DAY_MINUTES: i64 = 420;

/// A sale's trading day, in SQL, from `edge_sale e`.
const SALE_BUSINESS_DATE: &str =
    "((e.occurred_at AT TIME ZONE 'UTC') + make_interval(mins => 420))::date";

// ---------------------------------------------------------------------------
// The shop's evening
// ---------------------------------------------------------------------------

/// One tender reconciliation, as a screen reads it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderReconciliationRow {
    pub recon_id: Uuid,
    pub site_id: String,
    pub business_date: NaiveDate,
    /// `CASH`, `CARD`, `QRIS` or `VOUCHER`.
    pub tender_kind: String,
    pub terminal_id: Option<String>,
    /// `OPEN` or `CLOSED`.
    pub status: String,
    pub counted_cash_minor: Option<i64>,
    /// What the till took for this tender that day, across the shop.
    pub receipts_minor: i64,
    pub receipt_count: i64,
    /// What this terminal's slip says it approved.
    pub batch_minor: i64,
    pub batch_line_count: i64,
    /// How many receipts and approvals still have nobody's answer against them.
    /// The closing gate, shown before somebody presses it.
    pub undecided_receipts: i64,
    pub undecided_batch_lines: i64,
    pub opened_by: String,
    pub opened_at: DateTime<Utc>,
    pub closed_by: Option<String>,
    pub closed_at: Option<DateTime<Utc>>,
}

/// One approval on a slip.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderBatchLineRow {
    pub batch_line_id: Uuid,
    pub terminal_id: String,
    pub batch_no: String,
    pub auth_code: String,
    pub acquirer: String,
    pub amount_minor: i64,
    pub decision: Option<String>,
}

/// One receipt tender the till recorded.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderReceiptRow {
    pub sale_id: Uuid,
    pub tender_seq: i32,
    pub amount_minor: i64,
    /// What the till wrote in the tender's reference. Empty when it recorded
    /// none, which the suggestion kernel reads as "unknown", not as "wrong".
    pub acquirer: String,
    pub occurred_at: DateTime<Utc>,
    pub decision: Option<String>,
}

/// One answer somebody gave.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderDecisionRow {
    pub decision_id: Uuid,
    pub recon_id: Uuid,
    pub sale_id: Option<Uuid>,
    pub tender_seq: Option<i32>,
    pub batch_line_id: Option<Uuid>,
    pub decision: String,
    pub from_acquirer: Option<String>,
    pub to_acquirer: Option<String>,
    pub note: Option<String>,
    pub decided_by: String,
    pub decided_at: DateTime<Utc>,
}

/// What the comparison proposes, as a screen reads it.
///
/// The kernel's own answer, retyped. `domain::tender_recon` carries no serde
/// and no `Uuid` — it compares two lists of strings and integers, which is what
/// lets it be tested exhaustively without a database — so the identities go out
/// as the text they came in as and the shape gains the derives a response
/// needs. Lane-A's kernel is kept clean the same way, for the same reason.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderSuggestionRow {
    pub sale_id: String,
    pub tender_seq: i32,
    pub batch_line_id: String,
    /// `MATCHED` or `RETENDER`. The two a comparison of two lists can reach on
    /// the evidence in front of it; the other three answers say something about
    /// a day the kernel was not given.
    pub decision: String,
    /// Where the books say the money is owed. Set for a retender only.
    pub from_acquirer: Option<String>,
    /// Where it is actually owed.
    pub to_acquirer: Option<String>,
    /// In words, because a person has to accept this and a score would tell
    /// them nothing about which field agreed.
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnexplainedReceiptRow {
    pub sale_id: String,
    pub tender_seq: i32,
    pub amount_minor: i64,
    pub acquirer: String,
}

/// Everything the comparison found, including what it could not explain.
///
/// The leftovers are the working list, not an afterthought: a shop accepts the
/// suggestions in a moment and then spends its evening on these.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderSuggestionsView {
    pub suggestions: Vec<TenderSuggestionRow>,
    pub receipts_without_approval: Vec<UnexplainedReceiptRow>,
    /// Approvals on the slip that no receipt accounts for, by id.
    pub approvals_without_receipt: Vec<String>,
}

impl From<TenderSuggestions> for TenderSuggestionsView {
    fn from(found: TenderSuggestions) -> Self {
        Self {
            suggestions: found
                .suggestions
                .into_iter()
                .map(|one| TenderSuggestionRow {
                    sale_id: one.sale_id,
                    tender_seq: one.tender_seq,
                    batch_line_id: one.batch_line_id,
                    decision: one.decision.as_str().to_string(),
                    from_acquirer: one.from_acquirer,
                    to_acquirer: one.to_acquirer,
                    reason: one.reason,
                })
                .collect(),
            receipts_without_approval: found
                .receipts_without_approval
                .into_iter()
                .map(|one| UnexplainedReceiptRow {
                    sale_id: one.sale_id,
                    tender_seq: one.tender_seq,
                    amount_minor: one.amount_minor,
                    acquirer: one.acquirer,
                })
                .collect(),
            approvals_without_receipt: found.approvals_without_receipt,
        }
    }
}

/// An answer, and what recording it did to the books.
///
/// Only RETENDER carries anything: it is the one decision of the five that
/// moves money, and the screen has to be able to say so. The other four record
/// what the shop found and change nothing, which is 0071's argument — agreeing
/// that two records describe one payment records no new fact.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderDecisionOutcome {
    pub decision: TenderDecisionRow,
    /// What `sales_posting::retender_tender` did — the row it moved, and the
    /// reclassifying entry when the day was already posted.
    pub retender: Option<RetenderOutcome>,
}

/// A reconciliation with both lists and every answer given so far.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderReconDetail {
    pub reconciliation: TenderReconciliationRow,
    pub receipts: Vec<TenderReceiptRow>,
    pub batch_lines: Vec<TenderBatchLineRow>,
    pub decisions: Vec<TenderDecisionRow>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenTenderReconRequest {
    pub tender_kind: String,
    /// Required for CARD and QRIS, refused for the other two — a shop
    /// reconciles a machine, and cash passes through none.
    pub terminal_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderBatchLineInput {
    pub batch_no: String,
    pub auth_code: String,
    pub acquirer: String,
    pub amount_minor: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordTenderBatchRequest {
    pub lines: Vec<TenderBatchLineInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordTenderDecisionRequest {
    pub sale_id: Option<Uuid>,
    pub tender_seq: Option<i32>,
    pub batch_line_id: Option<Uuid>,
    /// One of MATCHED, NO_SETTLEMENT, OTHER_DAY, RETURNED, RETENDER.
    pub decision: String,
    pub from_acquirer: Option<String>,
    pub to_acquirer: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CloseTenderReconRequest {
    /// What the drawer held. Required to close a cash reconciliation while
    /// there is no `cash_shift` to read it from — see `tender_recon_close`.
    pub counted_cash_minor: Option<i64>,
}

const TENDER_KINDS: [&str; 4] = ["CASH", "CARD", "QRIS", "VOUCHER"];
const TENDER_DECISIONS: [&str; 5] = [
    "MATCHED",
    "NO_SETTLEMENT",
    "OTHER_DAY",
    "RETURNED",
    "RETENDER",
];

/// Open a shop's reconciliation for one tender on one day.
///
/// Idempotent by the unique indexes in 0134: opening the same one twice hands
/// back the row that exists rather than refusing, because "open today's card
/// reconciliation" is what a screen does every time it loads.
pub async fn tender_recon_open(
    pool: &PgPool,
    site_id: &str,
    business_date: NaiveDate,
    request: &OpenTenderReconRequest,
    actor: &str,
) -> Result<TenderReconciliationRow, AppError> {
    let kind = request.tender_kind.trim().to_uppercase();
    if !TENDER_KINDS.contains(&kind.as_str()) {
        return Err(AppError::Validation(format!(
            "'{kind}' is not a tender anybody reconciles; expected one of {}",
            TENDER_KINDS.join(", ")
        )));
    }
    let terminal = request
        .terminal_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let carries_terminal = matches!(kind.as_str(), "CARD" | "QRIS");
    if carries_terminal && terminal.is_none() {
        return Err(AppError::Validation(format!(
            "a {kind} reconciliation is per EDC terminal; name the one whose batch slip is in \
             your hand, or the wrong-machine mistake this exists to find is invisible"
        )));
    }
    if !carries_terminal && terminal.is_some() {
        return Err(AppError::Validation(format!(
            "{kind} passes through no terminal"
        )));
    }

    // ON CONFLICT cannot name a partial index's predicate without repeating it,
    // and there are two of them. A read first, then an insert, is honest about
    // what this is: the unique indexes remain the guarantee, and a race loses
    // the insert and re-reads.
    if let Some(existing) = tender_recon_find(pool, site_id, business_date, &kind, terminal).await?
    {
        return Ok(existing);
    }
    let recon_id = Uuid::new_v4();
    let inserted = sqlx::query(
        "INSERT INTO tender_reconciliation
           (recon_id, site_id, business_date, tender_kind, terminal_id, opened_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING",
    )
    .bind(recon_id)
    .bind(site_id)
    .bind(business_date)
    .bind(&kind)
    .bind(terminal)
    .bind(actor)
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return tender_recon_find(pool, site_id, business_date, &kind, terminal)
            .await?
            .ok_or_else(|| AppError::Conflict("this reconciliation is being opened".into()));
    }
    tender_recon_row(pool, recon_id).await
}

async fn tender_recon_find(
    pool: &PgPool,
    site_id: &str,
    business_date: NaiveDate,
    kind: &str,
    terminal: Option<&str>,
) -> Result<Option<TenderReconciliationRow>, AppError> {
    let found = sqlx::query(
        "SELECT recon_id FROM tender_reconciliation
          WHERE site_id = $1 AND business_date = $2 AND tender_kind = $3
            AND terminal_id IS NOT DISTINCT FROM $4",
    )
    .bind(site_id)
    .bind(business_date)
    .bind(kind)
    .bind(terminal)
    .fetch_optional(pool)
    .await?;
    match found {
        Some(row) => Ok(Some(
            tender_recon_row(pool, row.try_get("recon_id")?).await?,
        )),
        None => Ok(None),
    }
}

/// The counts a screen shows and the closing gate reads, in one query.
///
/// The receipt figures are scoped to (shop, day, tender) and NOT to the
/// terminal, because a till receipt does not know which machine took it. A shop
/// with three EDCs is reconciling one day's card takings across three slips,
/// and a receipt is decided against whichever slip turns out to hold it — so
/// "everything is answered" is a question about the day, not about one machine.
const RECON_COLUMNS: &str = "
    r.recon_id, r.site_id, r.business_date, r.tender_kind, r.terminal_id,
    r.status, r.counted_cash_minor, r.opened_by, r.opened_at, r.closed_by, r.closed_at,
    COALESCE(t.receipts_minor, 0)::bigint AS receipts_minor,
    COALESCE(t.receipt_count, 0)::bigint AS receipt_count,
    COALESCE(t.undecided_receipts, 0)::bigint AS undecided_receipts,
    COALESCE(b.batch_minor, 0)::bigint AS batch_minor,
    COALESCE(b.batch_line_count, 0)::bigint AS batch_line_count,
    COALESCE(b.undecided_batch_lines, 0)::bigint AS undecided_batch_lines";

/// The joins behind [`RECON_COLUMNS`].
///
/// `decided` is every answer given anywhere in this shop's day for this tender,
/// across every terminal's reconciliation — see the note above.
const RECON_FROM: &str = "
    FROM tender_reconciliation r
    LEFT JOIN LATERAL (
        SELECT SUM(st.amount_minor)::bigint AS receipts_minor,
               COUNT(*)::bigint AS receipt_count,
               COUNT(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM tender_reconciliation_decision d
                    WHERE d.sale_id = st.sale_id AND d.tender_seq = st.tender_seq
               ))::bigint AS undecided_receipts
          FROM edge_sale_tender st
          JOIN edge_sale e USING (sale_id)
         WHERE e.site_id = r.site_id
           AND st.method = r.tender_kind
           AND ((e.occurred_at AT TIME ZONE 'UTC') + make_interval(mins => 420))::date
               = r.business_date
    ) t ON true
    LEFT JOIN LATERAL (
        SELECT SUM(l.amount_minor)::bigint AS batch_minor,
               COUNT(*)::bigint AS batch_line_count,
               COUNT(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM tender_reconciliation_decision d
                    WHERE d.batch_line_id = l.batch_line_id
               ))::bigint AS undecided_batch_lines
          FROM tender_batch_line l
         WHERE l.recon_id = r.recon_id
    ) b ON true";

fn to_recon_row(row: &sqlx::postgres::PgRow) -> Result<TenderReconciliationRow, AppError> {
    Ok(TenderReconciliationRow {
        recon_id: row.try_get("recon_id")?,
        site_id: row.try_get("site_id")?,
        business_date: row.try_get("business_date")?,
        tender_kind: row.try_get("tender_kind")?,
        terminal_id: row.try_get("terminal_id")?,
        status: row.try_get("status")?,
        counted_cash_minor: row.try_get("counted_cash_minor")?,
        receipts_minor: row.try_get("receipts_minor")?,
        receipt_count: row.try_get("receipt_count")?,
        batch_minor: row.try_get("batch_minor")?,
        batch_line_count: row.try_get("batch_line_count")?,
        undecided_receipts: row.try_get("undecided_receipts")?,
        undecided_batch_lines: row.try_get("undecided_batch_lines")?,
        opened_by: row.try_get("opened_by")?,
        opened_at: row.try_get("opened_at")?,
        closed_by: row.try_get("closed_by")?,
        closed_at: row.try_get("closed_at")?,
    })
}

async fn tender_recon_row(
    pool: &PgPool,
    recon_id: Uuid,
) -> Result<TenderReconciliationRow, AppError> {
    let sql = format!("SELECT {RECON_COLUMNS} {RECON_FROM} WHERE r.recon_id = $1");
    let row = sqlx::query(&sql)
        .bind(recon_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("tender reconciliation".into()))?;
    to_recon_row(&row)
}

/// Every reconciliation a shop has open or closed for one day.
pub async fn tender_recon_list(
    pool: &PgPool,
    site_id: &str,
    business_date: NaiveDate,
) -> Result<Vec<TenderReconciliationRow>, AppError> {
    let sql = format!(
        "SELECT {RECON_COLUMNS} {RECON_FROM}
          WHERE r.site_id = $1 AND r.business_date = $2
          ORDER BY r.tender_kind, r.terminal_id NULLS FIRST"
    );
    let rows = sqlx::query(&sql)
        .bind(site_id)
        .bind(business_date)
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_recon_row).collect()
}

/// The site and day a reconciliation belongs to, and whether it is still open.
async fn recon_scope(
    pool: &PgPool,
    recon_id: Uuid,
) -> Result<(String, NaiveDate, String, String), AppError> {
    let row = sqlx::query(
        "SELECT site_id, business_date, tender_kind, status
           FROM tender_reconciliation WHERE recon_id = $1",
    )
    .bind(recon_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("tender reconciliation".into()))?;
    Ok((
        row.try_get("site_id")?,
        row.try_get("business_date")?,
        row.try_get("tender_kind")?,
        row.try_get("status")?,
    ))
}

/// Everything on both lists, with whatever has been said about each.
pub async fn tender_recon_detail(
    pool: &PgPool,
    recon_id: Uuid,
) -> Result<TenderReconDetail, AppError> {
    let reconciliation = tender_recon_row(pool, recon_id).await?;
    let receipts = tender_recon_receipt_rows(
        pool,
        &reconciliation.site_id,
        reconciliation.business_date,
        &reconciliation.tender_kind,
    )
    .await?;

    let batch_rows = sqlx::query(
        "SELECT l.batch_line_id, l.terminal_id, l.batch_no, l.auth_code, l.acquirer,
                l.amount_minor,
                (SELECT d.decision FROM tender_reconciliation_decision d
                  WHERE d.batch_line_id = l.batch_line_id) AS decision
           FROM tender_batch_line l
          WHERE l.recon_id = $1
          ORDER BY l.batch_no, l.auth_code",
    )
    .bind(recon_id)
    .fetch_all(pool)
    .await?;
    let mut batch_lines = Vec::with_capacity(batch_rows.len());
    for row in &batch_rows {
        batch_lines.push(TenderBatchLineRow {
            batch_line_id: row.try_get("batch_line_id")?,
            terminal_id: row.try_get("terminal_id")?,
            batch_no: row.try_get("batch_no")?,
            auth_code: row.try_get("auth_code")?,
            acquirer: row.try_get("acquirer")?,
            amount_minor: row.try_get("amount_minor")?,
            decision: row.try_get("decision")?,
        });
    }

    let decision_rows = sqlx::query(
        "SELECT decision_id, recon_id, sale_id, tender_seq, batch_line_id, decision,
                from_acquirer, to_acquirer, note, decided_by, decided_at
           FROM tender_reconciliation_decision
          WHERE recon_id = $1 ORDER BY decided_at",
    )
    .bind(recon_id)
    .fetch_all(pool)
    .await?;
    let mut decisions = Vec::with_capacity(decision_rows.len());
    for row in &decision_rows {
        decisions.push(TenderDecisionRow {
            decision_id: row.try_get("decision_id")?,
            recon_id: row.try_get("recon_id")?,
            sale_id: row.try_get("sale_id")?,
            tender_seq: row.try_get("tender_seq")?,
            batch_line_id: row.try_get("batch_line_id")?,
            decision: row.try_get("decision")?,
            from_acquirer: row.try_get("from_acquirer")?,
            to_acquirer: row.try_get("to_acquirer")?,
            note: row.try_get("note")?,
            decided_by: row.try_get("decided_by")?,
            decided_at: row.try_get("decided_at")?,
        });
    }

    Ok(TenderReconDetail {
        reconciliation,
        receipts,
        batch_lines,
        decisions,
    })
}

async fn tender_recon_receipt_rows(
    pool: &PgPool,
    site_id: &str,
    business_date: NaiveDate,
    tender_kind: &str,
) -> Result<Vec<TenderReceiptRow>, AppError> {
    let sql = format!(
        // The acquirer the way `sales_posting::acquirer_of` reads it: the
        // column 0106 added, falling back to the free-text reference for
        // tenders a shop synced before that column existed. Reading only one of
        // the two would make a shop's suggestion disagree with the ledger about
        // who took the money, which is the single thing this screen is for.
        "SELECT st.sale_id, st.tender_seq, st.amount_minor,
                COALESCE(
                    UPPER(NULLIF(TRIM(st.acquirer), '')),
                    UPPER(NULLIF(TRIM(st.reference), '')),
                    '') AS acquirer,
                e.occurred_at,
                (SELECT d.decision FROM tender_reconciliation_decision d
                  WHERE d.sale_id = st.sale_id AND d.tender_seq = st.tender_seq) AS decision
           FROM edge_sale_tender st
           JOIN edge_sale e USING (sale_id)
          WHERE e.site_id = $1 AND st.method = $3
            AND {SALE_BUSINESS_DATE} = $2
          ORDER BY e.occurred_at, st.tender_seq"
    );
    let rows = sqlx::query(&sql)
        .bind(site_id)
        .bind(business_date)
        .bind(tender_kind)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            Ok(TenderReceiptRow {
                sale_id: row.try_get("sale_id")?,
                tender_seq: row.try_get("tender_seq")?,
                amount_minor: row.try_get("amount_minor")?,
                acquirer: row.try_get("acquirer")?,
                occurred_at: row.try_get("occurred_at")?,
                decision: row.try_get("decision")?,
            })
        })
        .collect()
}

/// Key in one terminal's batch slip.
///
/// Re-keying the same slip is a no-op rather than a doubling: the unique index
/// in 0134 stands in for `bank_statement_line`'s fingerprint, using the
/// acquirer's own three identifiers.
pub async fn tender_recon_record_batch(
    pool: &PgPool,
    recon_id: Uuid,
    request: &RecordTenderBatchRequest,
    actor: &str,
) -> Result<i64, AppError> {
    let (_, _, kind, status) = recon_scope(pool, recon_id).await?;
    if status != "OPEN" {
        return Err(AppError::Conflict(
            "this reconciliation is closed; reopening it is a decision somebody has to make \
             deliberately"
                .into(),
        ));
    }
    if !matches!(kind.as_str(), "CARD" | "QRIS") {
        return Err(AppError::Validation(format!("{kind} has no batch slip")));
    }
    let terminal: String =
        sqlx::query("SELECT terminal_id FROM tender_reconciliation WHERE recon_id = $1")
            .bind(recon_id)
            .fetch_one(pool)
            .await?
            .try_get::<Option<String>, _>("terminal_id")?
            .ok_or_else(|| AppError::Validation("this reconciliation names no terminal".into()))?;

    let mut written = 0i64;
    let mut tx = pool.begin().await?;
    for (index, line) in request.lines.iter().enumerate() {
        if line.amount_minor <= 0 {
            return Err(AppError::Validation(format!(
                "line {}: an approval is for a positive amount",
                index + 1
            )));
        }
        let auth_code = line.auth_code.trim();
        let acquirer = line.acquirer.trim().to_uppercase();
        if auth_code.is_empty() || acquirer.is_empty() {
            return Err(AppError::Validation(format!(
                "line {}: an approval needs its code and whose machine took it — without both \
                 it cannot be followed to the money",
                index + 1
            )));
        }
        let outcome = sqlx::query(
            "INSERT INTO tender_batch_line
               (batch_line_id, recon_id, terminal_id, batch_no, auth_code, acquirer,
                amount_minor, entered_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (recon_id, terminal_id, batch_no, auth_code) DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(recon_id)
        .bind(&terminal)
        .bind(line.batch_no.trim())
        .bind(auth_code)
        .bind(&acquirer)
        .bind(line.amount_minor)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        written += outcome.rows_affected() as i64;
    }
    tx.commit().await?;
    Ok(written)
}

/// What the two lists suggest about each other.
///
/// The kernel does the deciding; this only fetches its arguments. Approvals
/// come from every terminal the shop reconciled that day, not only this one's,
/// because a retender is by definition an approval on another machine.
pub async fn tender_recon_suggest(
    pool: &PgPool,
    recon_id: Uuid,
) -> Result<TenderSuggestionsView, AppError> {
    let (site_id, business_date, kind, _) = recon_scope(pool, recon_id).await?;
    let receipts = tender_recon_receipt_rows(pool, &site_id, business_date, &kind).await?;
    let day = business_date.num_days_from_ce();

    let undecided: Vec<ReceiptTender> = receipts
        .iter()
        .filter(|receipt| receipt.decision.is_none())
        .map(|receipt| ReceiptTender {
            sale_id: receipt.sale_id.to_string(),
            tender_seq: receipt.tender_seq,
            day,
            acquirer: receipt.acquirer.clone(),
            amount_minor: receipt.amount_minor,
        })
        .collect();

    let rows = sqlx::query(
        "SELECT l.batch_line_id, l.terminal_id, l.acquirer, l.amount_minor
           FROM tender_batch_line l
           JOIN tender_reconciliation r USING (recon_id)
          WHERE r.site_id = $1 AND r.business_date = $2 AND r.tender_kind = $3
            AND NOT EXISTS (
                SELECT 1 FROM tender_reconciliation_decision d
                 WHERE d.batch_line_id = l.batch_line_id)
          ORDER BY l.terminal_id, l.batch_no, l.auth_code",
    )
    .bind(&site_id)
    .bind(business_date)
    .bind(&kind)
    .fetch_all(pool)
    .await?;
    let mut approvals = Vec::with_capacity(rows.len());
    for row in &rows {
        approvals.push(BatchApproval {
            batch_line_id: row.try_get::<Uuid, _>("batch_line_id")?.to_string(),
            terminal_id: row.try_get("terminal_id")?,
            acquirer: row.try_get("acquirer")?,
            day,
            amount_minor: row.try_get("amount_minor")?,
        });
    }

    Ok(suggest_tender_decisions(&undecided, &approvals).into())
}

/// The retender a RETENDER decision hands on.
///
/// # Why this module does not write the journal
///
/// A card rung on the wrong EDC leaves the books owing the money to the wrong
/// acquirer. Putting that right is a journal — debit the receivable that should
/// have had it, credit the one that did — and that journal belongs to whoever
/// raised the receivable in the first place. `sales_posting::retender_tender`
/// is it: it moves the tender row in whichever population it lives in, writes
/// the reclassification under `RETENDER` when the day is already posted, and
/// leaves a row in `sale_tender_retender` either way. Writing a second version
/// here would be a second rule about one event, which is the failure this whole
/// module exists to prevent.
///
/// So the shop says what happened and this carries the fact one function along.
/// What it adds is the reason — a reconciliation's own words, naming the two
/// acquirers and the evening it was decided — because `retender_tender` demands
/// one and "the acquirer's own file will not explain it" is exactly right about
/// a correction made on a counter at nine in the evening.
#[derive(Clone, Debug)]
pub struct AcquirerRetender {
    pub sale_id: Uuid,
    pub tender_seq: i32,
    pub site_id: String,
    pub business_date: NaiveDate,
    pub from_acquirer: String,
    pub to_acquirer: String,
    pub decided_by: String,
    pub note: Option<String>,
}

impl AcquirerRetender {
    /// Hand the retender to the module that owns the receivable.
    ///
    /// The tender is named to `retender_tender` by its surrogate id, which is
    /// what a retender is performed on; a reconciliation knows it by `(sale_id,
    /// tender_seq)`, so the id is read back here. A receipt this
    /// reconciliation is showing but `edge_sale_tender` no longer holds is a
    /// contradiction the foreign key already forbids, so a miss is a genuine
    /// NotFound rather than a case to paper over.
    ///
    /// The method does not move. A retender between acquirers is a card that
    /// stayed a card and went through a different machine; changing CARD to
    /// QRIS as well would be two corrections wearing one decision's clothes,
    /// and the till screen has its own route for that.
    async fn hand_on(&self, pool: &PgPool) -> Result<RetenderOutcome, AppError> {
        let row = sqlx::query(
            "SELECT t.tender_id, t.method, t.card_kind
               FROM edge_sale_tender t
              WHERE t.sale_id = $1 AND t.tender_seq = $2",
        )
        .bind(self.sale_id)
        .bind(self.tender_seq)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "tender {} of sale {}",
                self.tender_seq, self.sale_id
            ))
        })?;
        let tender_id: Uuid = row.try_get("tender_id")?;
        let method: String = row.try_get("method")?;
        let card_kind: Option<String> = row.try_get("card_kind")?;

        let reason = match self
            .note
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty())
        {
            Some(note) => format!(
                "{} reconciliation {}: the receipt says {} and {} approved it — {note}",
                self.site_id, self.business_date, self.from_acquirer, self.to_acquirer
            ),
            None => format!(
                "{} reconciliation {}: the receipt says {} and {} approved it",
                self.site_id, self.business_date, self.from_acquirer, self.to_acquirer
            ),
        };
        super::sales_posting::retender_tender(
            pool,
            tender_id,
            &RetenderRequest {
                to_method: method,
                to_acquirer: self.to_acquirer.clone(),
                to_card_kind: card_kind,
                reason,
            },
            &self.decided_by,
        )
        .await
    }
}

/// Record one answer.
pub async fn tender_recon_decide(
    pool: &PgPool,
    recon_id: Uuid,
    request: &RecordTenderDecisionRequest,
    actor: &str,
) -> Result<TenderDecisionOutcome, AppError> {
    let (site_id, business_date, _, status) = recon_scope(pool, recon_id).await?;
    if status != "OPEN" {
        return Err(AppError::Conflict(
            "this reconciliation is closed; its answers are the ones it closed with".into(),
        ));
    }
    let decision = request.decision.trim().to_uppercase();
    if !TENDER_DECISIONS.contains(&decision.as_str()) {
        return Err(AppError::Validation(format!(
            "'{decision}' is not one of the answers; expected one of {}",
            TENDER_DECISIONS.join(", ")
        )));
    }
    if request.sale_id.is_none() && request.batch_line_id.is_none() {
        return Err(AppError::Validation(
            "a decision has to be about a receipt, an approval, or the pair".into(),
        ));
    }
    if request.sale_id.is_some() != request.tender_seq.is_some() {
        return Err(AppError::Validation(
            "a receipt is a sale and which of its payments; name both or neither".into(),
        ));
    }
    if decision == "MATCHED" && (request.sale_id.is_none() || request.batch_line_id.is_none()) {
        return Err(AppError::Validation(
            "a match names a receipt and an approval; with one side it asserts nothing".into(),
        ));
    }
    let from_acquirer = trimmed_upper(request.from_acquirer.as_deref());
    let to_acquirer = trimmed_upper(request.to_acquirer.as_deref());
    if decision == "RETENDER" && (from_acquirer.is_none() || to_acquirer.is_none()) {
        return Err(AppError::Validation(
            "a retender says which acquirer the books name and which one actually took it".into(),
        ));
    }
    if decision != "RETENDER" && (from_acquirer.is_some() || to_acquirer.is_some()) {
        return Err(AppError::Validation(
            "only a retender moves money between acquirers".into(),
        ));
    }

    // The move happens before the answer is recorded, and that order is the
    // point. `retender_tender` refuses a move that changes nothing and a
    // receivable whose acquirer has no account mapped, and either refusal has
    // to reach the person deciding rather than land behind a row that already
    // claims the money was moved. A decision saying RETENDER with no retender
    // behind it is the one state nobody could explain afterwards.
    let mut retender = None;
    if decision == "RETENDER" {
        let (Some(sale_id), Some(tender_seq), Some(from), Some(to)) = (
            request.sale_id,
            request.tender_seq,
            from_acquirer.as_deref(),
            to_acquirer.as_deref(),
        ) else {
            return Err(AppError::Validation(
                "a retender moves one receipt's money; name the sale and which of its \
                 payments, and the two acquirers"
                    .into(),
            ));
        };
        retender = Some(
            AcquirerRetender {
                sale_id,
                tender_seq,
                site_id: site_id.clone(),
                business_date,
                from_acquirer: from.to_string(),
                to_acquirer: to.to_string(),
                decided_by: actor.to_string(),
                note: request.note.clone(),
            }
            .hand_on(pool)
            .await?,
        );
    }

    let decision_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO tender_reconciliation_decision
           (decision_id, recon_id, sale_id, tender_seq, batch_line_id, decision,
            from_acquirer, to_acquirer, note, decided_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(decision_id)
    .bind(recon_id)
    .bind(request.sale_id)
    .bind(request.tender_seq)
    .bind(request.batch_line_id)
    .bind(&decision)
    .bind(from_acquirer.as_deref())
    .bind(to_acquirer.as_deref())
    .bind(
        request
            .note
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty()),
    )
    .bind(actor)
    .execute(pool)
    .await?;

    let row = sqlx::query(
        "SELECT decision_id, recon_id, sale_id, tender_seq, batch_line_id, decision,
                from_acquirer, to_acquirer, note, decided_by, decided_at
           FROM tender_reconciliation_decision WHERE decision_id = $1",
    )
    .bind(decision_id)
    .fetch_one(pool)
    .await?;
    Ok(TenderDecisionOutcome {
        decision: TenderDecisionRow {
            decision_id: row.try_get("decision_id")?,
            recon_id: row.try_get("recon_id")?,
            sale_id: row.try_get("sale_id")?,
            tender_seq: row.try_get("tender_seq")?,
            batch_line_id: row.try_get("batch_line_id")?,
            decision: row.try_get("decision")?,
            from_acquirer: row.try_get("from_acquirer")?,
            to_acquirer: row.try_get("to_acquirer")?,
            note: row.try_get("note")?,
            decided_by: row.try_get("decided_by")?,
            decided_at: row.try_get("decided_at")?,
        },
        retender,
    })
}

/// Close a shop's reconciliation.
///
/// # The gate
///
/// Every receipt and every approval must have an answer. Not "the totals
/// agree": two lists can add to the same number while naming different
/// payments, and a reconciliation that closed on a matching total would be
/// exactly as wrong as no reconciliation at all, while looking finished.
///
/// # Cash
///
/// A cash reconciliation has no slip to compare against; its evidence is a
/// counted drawer, and the approval of the variance belongs to a shift. There
/// is no `cash_shift` table in this schema yet, so the counted figure is
/// recorded here instead — required, because a cash tender that closed with
/// nothing counted would be a shop asserting it balanced without looking. When
/// that table arrives, this reads the figure and its approval from there and
/// the column on the reconciliation goes; see 0134.
pub async fn tender_recon_close(
    pool: &PgPool,
    recon_id: Uuid,
    request: &CloseTenderReconRequest,
    actor: &str,
) -> Result<TenderReconciliationRow, AppError> {
    let current = tender_recon_row(pool, recon_id).await?;
    if current.status == "CLOSED" {
        return Err(AppError::Conflict(
            "this reconciliation is already closed".into(),
        ));
    }

    let counted =
        if current.tender_kind == "CASH" {
            let counted = request.counted_cash_minor.or(current.counted_cash_minor);
            match counted {
                Some(value) if value >= 0 => Some(value),
                Some(_) => {
                    return Err(AppError::Validation(
                        "a drawer cannot hold less than nothing".into(),
                    ))
                }
                None => return Err(AppError::Validation(
                    "count the drawer before closing a cash reconciliation; a cash tender closes \
                     on a counted figure and its variance, not on the till's own arithmetic"
                        .into(),
                )),
            }
        } else {
            None
        };

    if current.undecided_receipts > 0 || current.undecided_batch_lines > 0 {
        return Err(AppError::Conflict(format!(
            "{} receipt(s) and {} approval(s) have no answer yet; a reconciliation closes when \
             everything on both lists has one, not when the totals happen to agree",
            current.undecided_receipts, current.undecided_batch_lines
        )));
    }

    sqlx::query(
        "UPDATE tender_reconciliation
            SET status = 'CLOSED', closed_by = $2, closed_at = now(),
                counted_cash_minor = COALESCE($3, counted_cash_minor)
          WHERE recon_id = $1 AND status = 'OPEN'",
    )
    .bind(recon_id)
    .bind(actor)
    .bind(counted)
    .execute(pool)
    .await?;
    tender_recon_row(pool, recon_id).await
}

fn trimmed_upper(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_uppercase)
}

// ---------------------------------------------------------------------------
// Head office's next day
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcquirerSettlementRow {
    pub settlement_id: Uuid,
    pub acquirer: String,
    pub settlement_date: NaiveDate,
    pub business_from: NaiveDate,
    pub business_to: NaiveDate,
    pub gross_minor: i64,
    pub mdr_minor: i64,
    pub net_minor: i64,
    /// What our own receipts account for. Below net when the acquirer has paid
    /// for something the till has no record of.
    pub expected_net_minor: Option<i64>,
    pub bank_statement_line_id: Option<Uuid>,
    /// `DRAFT`, `CURATED`, `MATCHED` or `EXCEPTION`.
    pub status: String,
    pub difference_minor: Option<i64>,
    pub explanation: Option<String>,
    pub journal_entry_id: Option<Uuid>,
    pub line_count: i64,
    pub curated_by: Option<String>,
    pub curated_at: Option<DateTime<Utc>>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcquirerSettlementLineRow {
    pub settlement_line_id: Uuid,
    pub sale_id: Option<Uuid>,
    pub tender_seq: Option<i32>,
    pub site_id: String,
    /// `CARD_DEBIT`, `CARD_CREDIT` or `QRIS`.
    pub tender_kind: String,
    pub auth_code: Option<String>,
    pub amount_minor: i64,
    pub mdr_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcquirerSettlementExceptionRow {
    pub exception_id: Uuid,
    pub kind: String,
    pub amount_minor: i64,
    pub explanation: String,
    pub journal_entry_id: Option<Uuid>,
    pub explained_by: String,
    pub explained_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcquirerSettlementDetail {
    pub settlement: AcquirerSettlementRow,
    pub lines: Vec<AcquirerSettlementLineRow>,
    pub exceptions: Vec<AcquirerSettlementExceptionRow>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcquirerSettlementLineInput {
    pub sale_id: Option<Uuid>,
    pub tender_seq: Option<i32>,
    pub site_id: String,
    pub tender_kind: String,
    pub auth_code: Option<String>,
    pub amount_minor: i64,
    #[serde(default)]
    pub mdr_minor: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateAcquirerSettlementRequest {
    pub acquirer: String,
    pub settlement_date: NaiveDate,
    pub business_from: NaiveDate,
    pub business_to: NaiveDate,
    pub gross_minor: i64,
    #[serde(default)]
    pub mdr_minor: i64,
    #[serde(default)]
    pub lines: Vec<AcquirerSettlementLineInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UploadSettlementReportRequest {
    pub source_name: Option<String>,
    /// The report, as it arrived. Pasted or read from a file; either way it is
    /// kept verbatim — see 0136.
    pub raw: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SettlementReportOutcome {
    pub report_id: Uuid,
    pub row_count: i64,
    pub rejected_count: i64,
    pub gross_minor: i64,
    pub mdr_minor: i64,
    /// Every line the parser could not read, whole, so the person curating sees
    /// what it choked on rather than a total that is quietly short.
    pub rejected: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CurateSettlementRequest {
    /// Which meaning the money lands in: `bank_giro` or `bank_savings`.
    pub bank_key: String,
    /// Which bank. The qualifier the account map resolves against.
    pub bank_qualifier: String,
    /// The day the entry is dated. The settlement date unless somebody says
    /// otherwise.
    pub posting_date: Option<NaiveDate>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MatchSettlementRequest {
    pub bank_statement_line_id: Uuid,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExplainSettlementRequest {
    /// `FEE`, `CHARGEBACK`, `OTHER_DAY` or `OPEN`.
    pub kind: String,
    pub explanation: String,
    /// Which site carries the residual, when one is posted. The shop whose sale
    /// it came from; head office when it is a charge on the account itself.
    pub site_id: Option<String>,
}

const BANK_KEYS: [&str; 2] = ["bank_giro", "bank_savings"];
const SETTLEMENT_TENDERS: [&str; 3] = ["CARD_DEBIT", "CARD_CREDIT", "QRIS"];
const EXCEPTION_KINDS: [&str; 4] = ["FEE", "CHARGEBACK", "OTHER_DAY", "OPEN"];

/// Which receivable a settlement line discharges.
const fn receivable_key(tender_kind: &str) -> &'static str {
    match tender_kind.as_bytes() {
        b"CARD_DEBIT" => "card_receivable_debit",
        b"QRIS" => "qris_receivable",
        _ => "card_receivable_credit",
    }
}

/// Where the acquirer's cut lands: `card_fee`, whatever the tender was.
///
/// An earlier draft gave QRIS its own key, on the argument that a QRIS fee and
/// a card fee are different costs with different rates. They are — but the
/// client's chart keeps exactly one account for both, `6010110002 Biaya Credit
/// Card`, and there is no free code beside it that means "QRIS fee". Inventing
/// one would put a leaf in their books that their own accountant did not ask
/// for, which is the mistake lane-A caught itself making when a code it had
/// proposed as free turned out to be `Penjualan Online Sendiri`.
///
/// Nothing is lost. Every fee line is qualified by the acquirer, so "what did
/// QRIS cost us this quarter" is a filter on the qualifier — the same way the
/// one receivable account answers "what does BCA owe us". The day the client
/// opens a QRIS fee account, this becomes a mapping and not a code change.
const fn fee_key(_tender_kind: &str) -> &'static str {
    "card_fee"
}

/// Key a settlement, or the shape of one, before anybody stands behind it.
pub async fn acq_settlement_create(
    pool: &PgPool,
    request: &CreateAcquirerSettlementRequest,
    actor: &str,
) -> Result<AcquirerSettlementRow, AppError> {
    let acquirer = request.acquirer.trim().to_uppercase();
    if acquirer.is_empty() {
        return Err(AppError::Validation(
            "a settlement is somebody's; name the acquirer".into(),
        ));
    }
    if request.business_to < request.business_from {
        return Err(AppError::Validation(
            "the trading days a settlement covers run forwards".into(),
        ));
    }
    if request.gross_minor <= 0 {
        return Err(AppError::Validation(
            "a settlement pays something; gross is above zero".into(),
        ));
    }
    if request.mdr_minor < 0 || request.mdr_minor > request.gross_minor {
        return Err(AppError::Validation(
            "the fee is between nothing and the whole of it".into(),
        ));
    }

    let settlement_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO acquirer_settlement
           (settlement_id, acquirer, settlement_date, business_from, business_to,
            gross_minor, mdr_minor, net_minor, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(settlement_id)
    .bind(&acquirer)
    .bind(request.settlement_date)
    .bind(request.business_from)
    .bind(request.business_to)
    .bind(request.gross_minor)
    .bind(request.mdr_minor)
    .bind(request.gross_minor - request.mdr_minor)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    for (index, line) in request.lines.iter().enumerate() {
        insert_settlement_line(&mut tx, settlement_id, line, index).await?;
    }
    refresh_expected_net(&mut tx, settlement_id).await?;
    tx.commit().await?;
    acq_settlement_row(pool, settlement_id).await
}

async fn insert_settlement_line(
    tx: &mut Transaction<'_, Postgres>,
    settlement_id: Uuid,
    line: &AcquirerSettlementLineInput,
    index: usize,
) -> Result<(), AppError> {
    let kind = line.tender_kind.trim().to_uppercase();
    if !SETTLEMENT_TENDERS.contains(&kind.as_str()) {
        return Err(AppError::Validation(format!(
            "line {}: '{kind}' is not a settled tender; expected one of {}",
            index + 1,
            SETTLEMENT_TENDERS.join(", ")
        )));
    }
    if line.amount_minor <= 0 {
        return Err(AppError::Validation(format!(
            "line {}: a settled receipt is for a positive amount",
            index + 1
        )));
    }
    if line.mdr_minor < 0 || line.mdr_minor > line.amount_minor {
        return Err(AppError::Validation(format!(
            "line {}: the fee is between nothing and the whole of the receipt",
            index + 1
        )));
    }
    if line.sale_id.is_some() != line.tender_seq.is_some() {
        return Err(AppError::Validation(format!(
            "line {}: a receipt is a sale and which of its payments; name both or neither",
            index + 1
        )));
    }
    sqlx::query(
        "INSERT INTO acquirer_settlement_line
           (settlement_line_id, settlement_id, sale_id, tender_seq, site_id,
            tender_kind, auth_code, amount_minor, mdr_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(Uuid::new_v4())
    .bind(settlement_id)
    .bind(line.sale_id)
    .bind(line.tender_seq)
    .bind(line.site_id.trim())
    .bind(&kind)
    .bind(
        line.auth_code
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty()),
    )
    .bind(line.amount_minor)
    .bind(line.mdr_minor)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// What our own receipts account for, recomputed from the lines.
///
/// Only the lines that actually name a receipt count. A report line the till
/// has no record of is real money the acquirer paid and is NOT evidence about
/// what we expected, so including it would make the two figures agree by
/// construction and hide the one thing their difference is for.
async fn refresh_expected_net(
    tx: &mut Transaction<'_, Postgres>,
    settlement_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE acquirer_settlement s
            SET expected_net_minor = (
                SELECT COALESCE(SUM(l.amount_minor - l.mdr_minor), 0)::bigint
                  FROM acquirer_settlement_line l
                 WHERE l.settlement_id = s.settlement_id AND l.sale_id IS NOT NULL)
          WHERE s.settlement_id = $1",
    )
    .bind(settlement_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

const SETTLEMENT_COLUMNS: &str = "
    s.settlement_id, s.acquirer, s.settlement_date, s.business_from, s.business_to,
    s.gross_minor, s.mdr_minor, s.net_minor, s.expected_net_minor,
    s.bank_statement_line_id, s.status, s.difference_minor, s.explanation,
    s.journal_entry_id, s.curated_by, s.curated_at, s.created_by, s.created_at,
    (SELECT COUNT(*) FROM acquirer_settlement_line l
      WHERE l.settlement_id = s.settlement_id)::bigint AS line_count";

fn to_settlement_row(row: &sqlx::postgres::PgRow) -> Result<AcquirerSettlementRow, AppError> {
    Ok(AcquirerSettlementRow {
        settlement_id: row.try_get("settlement_id")?,
        acquirer: row.try_get("acquirer")?,
        settlement_date: row.try_get("settlement_date")?,
        business_from: row.try_get("business_from")?,
        business_to: row.try_get("business_to")?,
        gross_minor: row.try_get("gross_minor")?,
        mdr_minor: row.try_get("mdr_minor")?,
        net_minor: row.try_get("net_minor")?,
        expected_net_minor: row.try_get("expected_net_minor")?,
        bank_statement_line_id: row.try_get("bank_statement_line_id")?,
        status: row.try_get("status")?,
        difference_minor: row.try_get("difference_minor")?,
        explanation: row.try_get("explanation")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        line_count: row.try_get("line_count")?,
        curated_by: row.try_get("curated_by")?,
        curated_at: row.try_get("curated_at")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
    })
}

async fn acq_settlement_row(
    pool: &PgPool,
    settlement_id: Uuid,
) -> Result<AcquirerSettlementRow, AppError> {
    let sql = format!(
        "SELECT {SETTLEMENT_COLUMNS} FROM acquirer_settlement s WHERE s.settlement_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(settlement_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("acquirer settlement".into()))?;
    to_settlement_row(&row)
}

pub async fn acq_settlement_list(
    pool: &PgPool,
    acquirer: Option<&str>,
    status: Option<&str>,
    limit: i64,
) -> Result<Vec<AcquirerSettlementRow>, AppError> {
    let sql = format!(
        "SELECT {SETTLEMENT_COLUMNS} FROM acquirer_settlement s
          WHERE ($1::text IS NULL OR s.acquirer = UPPER($1))
            AND ($2::text IS NULL OR s.status = UPPER($2))
          ORDER BY s.settlement_date DESC, s.created_at DESC
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(acquirer)
        .bind(status)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_settlement_row).collect()
}

pub async fn acq_settlement_detail(
    pool: &PgPool,
    settlement_id: Uuid,
) -> Result<AcquirerSettlementDetail, AppError> {
    let settlement = acq_settlement_row(pool, settlement_id).await?;
    let line_rows = sqlx::query(
        "SELECT settlement_line_id, sale_id, tender_seq, site_id, tender_kind,
                auth_code, amount_minor, mdr_minor
           FROM acquirer_settlement_line
          WHERE settlement_id = $1 ORDER BY site_id, auth_code",
    )
    .bind(settlement_id)
    .fetch_all(pool)
    .await?;
    let mut lines = Vec::with_capacity(line_rows.len());
    for row in &line_rows {
        lines.push(AcquirerSettlementLineRow {
            settlement_line_id: row.try_get("settlement_line_id")?,
            sale_id: row.try_get("sale_id")?,
            tender_seq: row.try_get("tender_seq")?,
            site_id: row.try_get("site_id")?,
            tender_kind: row.try_get("tender_kind")?,
            auth_code: row.try_get("auth_code")?,
            amount_minor: row.try_get("amount_minor")?,
            mdr_minor: row.try_get("mdr_minor")?,
        });
    }
    let exception_rows = sqlx::query(
        "SELECT exception_id, kind, amount_minor, explanation, journal_entry_id,
                explained_by, explained_at
           FROM acquirer_settlement_exception
          WHERE settlement_id = $1 ORDER BY explained_at",
    )
    .bind(settlement_id)
    .fetch_all(pool)
    .await?;
    let mut exceptions = Vec::with_capacity(exception_rows.len());
    for row in &exception_rows {
        exceptions.push(AcquirerSettlementExceptionRow {
            exception_id: row.try_get("exception_id")?,
            kind: row.try_get("kind")?,
            amount_minor: row.try_get("amount_minor")?,
            explanation: row.try_get("explanation")?,
            journal_entry_id: row.try_get("journal_entry_id")?,
            explained_by: row.try_get("explained_by")?,
            explained_at: row.try_get("explained_at")?,
        });
    }
    Ok(AcquirerSettlementDetail {
        settlement,
        lines,
        exceptions,
    })
}

/// Take in the acquirer's own report and say what it contains.
///
/// The rows are not turned into settlement lines here. Reading the file and
/// deciding which of our receipts each row settles are two acts, and the second
/// is the one somebody signs their name to — so this returns what the file says
/// and leaves the attribution to the screen.
pub async fn acq_settlement_upload_report(
    pool: &PgPool,
    settlement_id: Uuid,
    request: &UploadSettlementReportRequest,
    actor: &str,
) -> Result<SettlementReportOutcome, AppError> {
    let existing = acq_settlement_row(pool, settlement_id).await?;
    if existing.status != "DRAFT" {
        return Err(AppError::Conflict(
            "this settlement has already been curated; a new report is a new settlement".into(),
        ));
    }
    if request.raw.trim().is_empty() {
        return Err(AppError::Validation("the report is empty".into()));
    }
    let parsed = parse_settlement_report(&request.raw);

    let report_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO acquirer_settlement_report
           (report_id, settlement_id, source_name, raw, row_count, rejected_count, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(report_id)
    .bind(settlement_id)
    .bind(
        request
            .source_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty()),
    )
    .bind(&request.raw)
    .bind(parsed.rows.len() as i32)
    .bind(parsed.rejected.len() as i32)
    .bind(actor)
    .execute(pool)
    .await?;

    Ok(SettlementReportOutcome {
        report_id,
        row_count: parsed.rows.len() as i64,
        rejected_count: parsed.rejected.len() as i64,
        gross_minor: parsed.gross_minor,
        mdr_minor: parsed.mdr_minor,
        rejected: parsed
            .rejected
            .iter()
            .map(|row| format!("line {}: {} — {}", row.line_number, row.reason, row.text))
            .collect(),
    })
}

/// Close the Payment Ledger items this settlement discharges.
///
/// TODO(lane-P): replace the body with a call to `payment_ledger::ple_settle`
/// for each receivable below, once Lane P merges. One settle per (shop,
/// receivable) the entry credited, shaped:
///
/// ```text
///   account_key  = receivable_key(tender_kind)  (card_receivable_debit | ..._credit | qris_receivable)
///   qualifier    = settlement.acquirer
///   site         = site_id
///   party_type   = ACQUIRER
///   party        = settlement.acquirer
///   voucher_kind = "ACQ_SETTLEMENT"
///   voucher_id   = settlement_id
///   side         = RECEIVABLE
///   amount       = gross_minor        (what the receivable was, not the net)
/// ```
///
/// `amount` is gross and not net, which is the one thing easy to get wrong
/// here. The item was opened at what the customer paid; the MDR is a cost we
/// bore, not a discount the acquirer negotiated off a debt. Settling at net
/// would leave every item short by its own fee and an ageing built from open
/// items would slowly fill with residues nothing can ever close.
///
/// The mirror of `sales_posting_open_receivables`, which opens these items when
/// the day's takings post — same key, same qualifier, same party — so the pair
/// is one item's life rather than two modules' guesses about the same debt.
///
/// It takes the transaction that wrote the journal because the two have to be
/// one act, for the reason lane-A's opener gives: a discharged receivable with
/// its item still open is a debt the ledger chases and the books do not carry.
///
/// Until then this is a no-op that still walks the same rows, so the day it is
/// filled in the only question is what to write — not which receivables, in
/// what order, with which arguments.
#[allow(unused_variables)]
async fn acq_settlement_settle_ledger_items(
    tx: &mut Transaction<'_, Postgres>,
    settlement_id: Uuid,
    acquirer: &str,
    discharged: &[(String, String, i64)],
    actor: &str,
) -> Result<(), AppError> {
    for (site_id, tender_kind, gross_minor) in discharged {
        // payment_ledger::ple_settle(tx, &PaymentLedgerSettle { .. }, actor).await?;
        let _ = (receivable_key(tender_kind), site_id, acquirer, gross_minor);
    }
    Ok(())
}

/// Stand behind the reading, and post it.
///
/// The entry, in the client's own terms:
///
/// ```text
///   Dr  bank_giro / bank_savings   at dc,            qualified by the bank
///   Dr  card_fee / qris_fee        at the sale's shop, qualified by the acquirer
///   Cr  card_receivable_*          at the sale's shop, qualified by the acquirer
/// ```
///
/// The bank leg is one line at head office; the other two are one pair per
/// shop, because the receivable was raised in thirteen sets of books and has to
/// be discharged in the same thirteen. The entry balances in total and not per
/// location, which is correct and is the poster's problem — see the header.
pub async fn acq_settlement_curate(
    pool: &PgPool,
    settlement_id: Uuid,
    request: &CurateSettlementRequest,
    actor: &str,
) -> Result<AcquirerSettlementRow, AppError> {
    let settlement = acq_settlement_row(pool, settlement_id).await?;
    if settlement.status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "this settlement is {}; only a draft is curated",
            settlement.status
        )));
    }
    let bank_key = request.bank_key.trim();
    if !BANK_KEYS.contains(&bank_key) {
        return Err(AppError::Validation(format!(
            "'{bank_key}' is not a bank meaning; expected {}",
            BANK_KEYS.join(" or ")
        )));
    }
    let bank_qualifier = request.bank_qualifier.trim().to_uppercase();
    if bank_qualifier.is_empty() {
        return Err(AppError::Validation(
            "which bank the money lands in is the qualifier the account map resolves; name it"
                .into(),
        ));
    }

    let lines = sqlx::query(
        "SELECT site_id, tender_kind,
                SUM(amount_minor)::bigint AS amount_minor,
                SUM(mdr_minor)::bigint AS mdr_minor
           FROM acquirer_settlement_line
          WHERE settlement_id = $1
          GROUP BY site_id, tender_kind
          ORDER BY site_id, tender_kind",
    )
    .bind(settlement_id)
    .fetch_all(pool)
    .await?;
    if lines.is_empty() {
        return Err(AppError::Validation(
            "a settlement with no lines discharges nothing; attach what it pays for first".into(),
        ));
    }

    let mut gross = 0i64;
    let mut fees = 0i64;
    // What each shop's receivable is being cleared of, kept for the Payment
    // Ledger below. Gathered here rather than re-queried: the posting and the
    // items have to describe the same rows or they describe different debts.
    let mut discharged: Vec<(String, String, i64)> = Vec::with_capacity(lines.len());
    let mut posting_lines =
        vec![PostingLine::debit(bank_key, "dc", settlement.net_minor)
            .with_qualifier(&bank_qualifier)];
    for row in &lines {
        let site_id: String = row.try_get("site_id")?;
        let tender_kind: String = row.try_get("tender_kind")?;
        let amount: i64 = row.try_get("amount_minor")?;
        let mdr: i64 = row.try_get("mdr_minor")?;
        gross += amount;
        fees += mdr;
        discharged.push((site_id.clone(), tender_kind.clone(), amount));
        if mdr > 0 {
            posting_lines.push(
                PostingLine::debit(fee_key(&tender_kind), &site_id, mdr)
                    .with_qualifier(&settlement.acquirer),
            );
        }
        posting_lines.push(
            PostingLine::credit(receivable_key(&tender_kind), &site_id, amount)
                .with_qualifier(&settlement.acquirer),
        );
    }

    // Checked here rather than left to the poster's balance test, because the
    // poster can only say "debits and credits differ by 40,000" and this can say
    // which of the two numbers is the one somebody has to go and look at.
    if gross != settlement.gross_minor {
        return Err(AppError::Validation(format!(
            "the lines add to {gross} and the settlement says {}; every row of the acquirer's \
             report has to be attributed to a shop before this can post",
            settlement.gross_minor
        )));
    }
    if fees != settlement.mdr_minor {
        return Err(AppError::Validation(format!(
            "the lines' fees add to {fees} and the settlement says {}",
            settlement.mdr_minor
        )));
    }

    let intent = PostingIntent {
        posting_date: request.posting_date.unwrap_or(settlement.settlement_date),
        source_kind: "ACQ_SETTLEMENT".into(),
        source_id: Some(settlement_id.to_string()),
        rule_version: "acquirer_settlement/1".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "{} settlement {} — gross {}, MDR {}, net {}",
            settlement.acquirer,
            settlement.settlement_date,
            settlement.gross_minor,
            settlement.mdr_minor,
            settlement.net_minor
        )),
        lines: posting_lines,
    };

    let mut tx = pool.begin().await?;
    let posted: Posted = post(&mut tx, &intent, actor).await?;
    // One statement, so the CHECK tying CURATED to its author and its entry is
    // satisfied by the row as a whole rather than failing on the first column.
    let updated = sqlx::query(
        "UPDATE acquirer_settlement
            SET status = 'CURATED', curated_by = $2, curated_at = now(), journal_entry_id = $3
          WHERE settlement_id = $1 AND status = 'DRAFT'",
    )
    .bind(settlement_id)
    .bind(actor)
    .bind(posted.entry_id)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "this settlement was curated while you were curating it".into(),
        ));
    }
    // The acquirers' items, closed by the same act that discharged the ledger
    // balance. A no-op until Lane P lands; in this transaction so the two can
    // never disagree.
    acq_settlement_settle_ledger_items(
        &mut tx,
        settlement_id,
        &settlement.acquirer,
        &discharged,
        actor,
    )
    .await?;
    refresh_expected_net(&mut tx, settlement_id).await?;
    tx.commit().await?;
    acq_settlement_row(pool, settlement_id).await
}

/// Agree that the bank credit and this settlement are the same money.
///
/// Reuses `bank_line_match` through `banking::confirm_match` rather than
/// keeping a second record of the same agreement: the bank line is matched
/// against the settlement entry's own bank leg, which is line 1 of the entry —
/// the same convention `book_bank_line` established, and for the same reason.
///
/// When the bank credited something else, the settlement becomes an EXCEPTION
/// carrying the difference and no match is written. A match asserts the two are
/// the same event, and at a different amount they demonstrably are not.
pub async fn acq_settlement_match(
    pool: &PgPool,
    settlement_id: Uuid,
    request: &MatchSettlementRequest,
    actor: &str,
) -> Result<AcquirerSettlementRow, AppError> {
    let settlement = acq_settlement_row(pool, settlement_id).await?;
    if settlement.status == "DRAFT" {
        return Err(AppError::Conflict(
            "curate this settlement before matching it; there is no entry to agree with yet".into(),
        ));
    }
    let line =
        sqlx::query("SELECT debit_minor, credit_minor FROM bank_statement_line WHERE line_id = $1")
            .bind(request.bank_statement_line_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("bank statement line".into()))?;
    let debit: i64 = line.try_get("debit_minor")?;
    let credit: i64 = line.try_get("credit_minor")?;
    if credit == 0 {
        return Err(AppError::Validation(
            "a settlement is money arriving; this line is money leaving the account".into(),
        ));
    }
    let arrived = credit.max(debit);
    let difference = settlement.net_minor - arrived;

    if difference != 0 {
        sqlx::query(
            "UPDATE acquirer_settlement
                SET status = 'EXCEPTION', bank_statement_line_id = $2, difference_minor = $3,
                    explanation = COALESCE(explanation, $4)
              WHERE settlement_id = $1",
        )
        .bind(settlement_id)
        .bind(request.bank_statement_line_id)
        .bind(difference)
        .bind(format!(
            "the acquirer promised {} and the bank credited {arrived}",
            settlement.net_minor
        ))
        .execute(pool)
        .await?;
        return acq_settlement_row(pool, settlement_id).await;
    }

    // The bank leg is line 1 — see the doc comment.
    let bank_leg: Option<Uuid> = sqlx::query(
        "SELECT line_id FROM journal_line
          WHERE entry_id = $1 AND line_number = 1",
    )
    .bind(settlement.journal_entry_id)
    .fetch_optional(pool)
    .await?
    .map(|row| row.try_get("line_id"))
    .transpose()?;

    if let Some(journal_line_id) = bank_leg {
        super::banking::confirm_match(
            pool,
            request.bank_statement_line_id,
            &super::banking::ConfirmMatchRequest {
                journal_line_id,
                score: None,
                reasons: vec![format!(
                    "{} settlement {} — net {} agrees with the credit",
                    settlement.acquirer, settlement.settlement_date, settlement.net_minor
                )],
                automatic: false,
            },
            actor,
        )
        .await?;
    }

    sqlx::query(
        "UPDATE acquirer_settlement
            SET status = 'MATCHED', bank_statement_line_id = $2, difference_minor = 0
          WHERE settlement_id = $1",
    )
    .bind(settlement_id)
    .bind(request.bank_statement_line_id)
    .execute(pool)
    .await?;
    acq_settlement_row(pool, settlement_id).await
}

/// Say why the bank paid something else, and book it when it is a cost.
///
/// FEE and CHARGEBACK move money and post; OTHER_DAY and OPEN do not. That is
/// not a shortcut — an amount that settled on another day is not lost, and an
/// unexplained difference is not a cost until somebody has decided it is one.
/// Booking either would put a number in the books whose only evidence is that
/// nobody had time to chase it.
pub async fn acq_settlement_explain(
    pool: &PgPool,
    settlement_id: Uuid,
    request: &ExplainSettlementRequest,
    actor: &str,
) -> Result<AcquirerSettlementRow, AppError> {
    let settlement = acq_settlement_row(pool, settlement_id).await?;
    if settlement.status != "EXCEPTION" {
        return Err(AppError::Conflict(
            "there is nothing to explain until the bank has disagreed with this settlement".into(),
        ));
    }
    let kind = request.kind.trim().to_uppercase();
    if !EXCEPTION_KINDS.contains(&kind.as_str()) {
        return Err(AppError::Validation(format!(
            "'{kind}' is not a reason; expected one of {}",
            EXCEPTION_KINDS.join(", ")
        )));
    }
    let explanation = request.explanation.trim();
    if explanation.is_empty() {
        return Err(AppError::Validation(
            "an exception is a judgement; the explanation is the only record of it".into(),
        ));
    }
    let difference = settlement.difference_minor.unwrap_or_default();
    if difference == 0 {
        return Err(AppError::Validation(
            "this settlement agrees with the bank; there is no residual to explain".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let entry_id = if matches!(kind.as_str(), "FEE" | "CHARGEBACK") {
        // The site the residual belongs to. Head office by default: a charge on
        // the bank account itself is head office's, and a caller that knows
        // better names the shop.
        let site_id = request
            .site_id
            .as_deref()
            .map(str::trim)
            .filter(|site| !site.is_empty())
            .unwrap_or("dc")
            .to_string();
        // Two meanings the client's chart already has. A FEE is the acquirer
        // charging more than its report stated, which is the same cost as MDR
        // and belongs in the same account. A CHARGEBACK is a sale the issuer
        // reversed, and `sales_return` is `4010214001 Retur Penjualan` — what
        // the client calls exactly that.
        //
        // The chargeback entry does not unwind the VAT or the stock, and that
        // is deliberate rather than forgotten: the goods do not come back in a
        // chargeback, and a residual small enough to be settled this way is not
        // a return to be restated. A dispute large enough to matter is a credit
        // note, which has its own document and its own source kind.
        let key = if kind == "FEE" {
            "card_fee"
        } else {
            "sales_return"
        };
        // A positive difference is money we expected and did not get, so the
        // cost is a debit and the bank is short by the same. A negative one is
        // the bank paying MORE than promised, and the mirror of the same pair.
        let amount = difference.abs();
        let (charge, bank) = if difference > 0 {
            (
                PostingLine::debit(key, &site_id, amount).with_qualifier(&settlement.acquirer),
                PostingLine::credit("bank_giro", "dc", amount),
            )
        } else {
            (
                PostingLine::credit(key, &site_id, amount).with_qualifier(&settlement.acquirer),
                PostingLine::debit("bank_giro", "dc", amount),
            )
        };
        // The bank leg has to name the same account the curation debited, or
        // the two would net against different banks. Read it back from the
        // entry rather than asking the caller to repeat it.
        let bank = match settlement_bank_qualifier(pool, &settlement).await? {
            Some((bank_key, qualifier)) => {
                let mut leg = bank;
                leg.account = crate::cloud::postgres::poster::LineAccount::Meaning {
                    semantic_key: bank_key,
                    qualifier,
                };
                leg
            }
            None => bank,
        };
        let intent = PostingIntent {
            posting_date: settlement.settlement_date,
            source_kind: "ACQ_SETTLEMENT".into(),
            source_id: Some(settlement_id.to_string()),
            rule_version: "acquirer_settlement_exception/1".into(),
            currency: "IDR".into(),
            memo: Some(format!(
                "{} settlement {} — {} {}: {explanation}",
                settlement.acquirer,
                settlement.settlement_date,
                kind.to_lowercase(),
                amount
            )),
            lines: vec![charge, bank],
        };
        Some(post(&mut tx, &intent, actor).await?.entry_id)
    } else {
        None
    };

    sqlx::query(
        "INSERT INTO acquirer_settlement_exception
           (exception_id, settlement_id, kind, amount_minor, explanation,
            journal_entry_id, explained_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(Uuid::new_v4())
    .bind(settlement_id)
    .bind(&kind)
    .bind(difference)
    .bind(explanation)
    .bind(entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE acquirer_settlement SET explanation = $2 WHERE settlement_id = $1")
        .bind(settlement_id)
        .bind(explanation)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    acq_settlement_row(pool, settlement_id).await
}

/// Which bank meaning and qualifier the curation debited, read back from the
/// entry it posted.
async fn settlement_bank_qualifier(
    pool: &PgPool,
    settlement: &AcquirerSettlementRow,
) -> Result<Option<(String, String)>, AppError> {
    let Some(entry_id) = settlement.journal_entry_id else {
        return Ok(None);
    };
    let account: Option<String> = sqlx::query(
        "SELECT account_code FROM journal_line WHERE entry_id = $1 AND line_number = 1",
    )
    .bind(entry_id)
    .fetch_optional(pool)
    .await?
    .map(|row| row.try_get("account_code"))
    .transpose()?;
    let Some(account) = account else {
        return Ok(None);
    };
    let mapped = sqlx::query(
        "SELECT semantic_key, qualifier FROM account_map
          WHERE account_code = $1 AND semantic_key = ANY($2) LIMIT 1",
    )
    .bind(&account)
    .bind(&BANK_KEYS[..])
    .fetch_optional(pool)
    .await?;
    match mapped {
        Some(row) => Ok(Some((
            row.try_get("semantic_key")?,
            row.try_get("qualifier")?,
        ))),
        None => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// What the acquirers still owe
// ---------------------------------------------------------------------------

/// One outstanding receivable balance at one shop, and whose it is.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcquirerAgingRow {
    /// The acquirer, when the ledger can name one: exactly one qualifier is
    /// mapped to this account at this shop. Empty when several share it — see
    /// [`AcquirerAgingRow::acquirers`], and the note on `acq_receivable_aging`.
    pub acquirer: String,
    /// Every acquirer mapped to this account at this shop. One name in the
    /// ordinary case; several when the client's chart keeps one leaf for all of
    /// them, which is exactly what `1011101002 Piutang Debit Card` is.
    pub acquirers: Vec<String>,
    pub site_id: String,
    /// Which receivable: `card_receivable_debit`, `card_receivable_credit` or
    /// `qris_receivable`.
    pub semantic_key: String,
    pub account_code: String,
    pub buckets: AgingBuckets,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcquirerReceivableAging {
    pub as_of: NaiveDate,
    pub rows: Vec<AcquirerAgingRow>,
    pub total: AgingBuckets,
}

const RECEIVABLE_KEYS: [&str; 3] = [
    "card_receivable_debit",
    "card_receivable_credit",
    "qris_receivable",
];

/// What is still owed on cards at each shop, by how long it has been owed.
///
/// Computed from the journal and not from a settlement table, which is the
/// whole point: the receivable is raised by whatever posts the day's sales and
/// discharged by the curation above, and an ageing built from either one alone
/// would be blind to the other. Reading the ledger means this is right on the
/// day a sale posts, without a line changing here.
///
/// The join is `account_map` — semantic key and qualifier to a client account,
/// per shop — because that is the only place a meaning becomes a code. An
/// acquirer with no mapping simply has no row, which is the honest answer:
/// nothing has been posted for it.
///
/// # Why a row is not always one acquirer
///
/// `journal_line` records the account a posting resolved to, not the meaning
/// and qualifier it resolved FROM. Where each acquirer has its own leaf, the
/// two are the same thing and every row names one acquirer. Where they share a
/// leaf — and the client's chart does exactly that, one `Piutang Debit Card`
/// for every bank — the ledger genuinely cannot tell BCA's balance from
/// MANDIRI's, and no query over it can.
///
/// So the grouping is by ACCOUNT and the qualifiers that reach it are listed.
/// The first version grouped by qualifier instead, and reported the same
/// 1,000,000 twice, once against each bank that shared the leaf: a total of
/// two million owed on one sale, from a query that looked right. Counting each
/// line once and admitting the split is unavailable is the honest answer, and
/// the fix is in the chart or in a qualifier on `journal_line` — not here.
///
/// `acquirer` therefore filters on whether that acquirer is mapped to the
/// account, not on the row's own name; asking for BCA at a shared leaf returns
/// the shared balance, labelled with everyone who shares it.
pub async fn acq_receivable_aging(
    pool: &PgPool,
    as_of: NaiveDate,
    acquirer: Option<&str>,
    site_id: Option<&str>,
) -> Result<AcquirerReceivableAging, AppError> {
    let rows = sqlx::query(
        // `leaf` collapses the map to one row per account before anything is
        // joined to the journal. That collapse is the whole correction: joining
        // `account_map` straight onto `journal_line` multiplies every line by
        // the number of acquirers mapped to its account.
        "WITH leaf AS (
             SELECT m.site_id, m.semantic_key, m.account_code,
                    ARRAY_AGG(DISTINCT m.qualifier ORDER BY m.qualifier) AS acquirers
               FROM account_map m
              WHERE m.semantic_key = ANY($2)
                AND m.qualifier <> ''
                AND ($4::text IS NULL OR m.site_id = $4)
              GROUP BY m.site_id, m.semantic_key, m.account_code
         ),
         wanted AS (
             SELECT * FROM leaf
              WHERE $3::text IS NULL OR UPPER($3) = ANY(acquirers)
         ),
         receivable AS (
             SELECT w.site_id, w.semantic_key, w.account_code, w.acquirers,
                    ($1::date - e.posting_date)::int AS age_days,
                    (l.debit_minor - l.credit_minor)::bigint AS balance_minor
               FROM wanted w
               JOIN journal_line l
                 ON l.account_code = w.account_code AND l.site_id = w.site_id
               JOIN journal_entry e ON e.entry_id = l.entry_id
              WHERE e.posting_date <= $1
         )
         SELECT site_id, semantic_key, account_code, acquirers,
                SUM(balance_minor) FILTER (WHERE age_days <= 0)::bigint AS not_due,
                SUM(balance_minor) FILTER (WHERE age_days BETWEEN 1 AND 30)::bigint AS d1_30,
                SUM(balance_minor) FILTER (WHERE age_days BETWEEN 31 AND 60)::bigint AS d31_60,
                SUM(balance_minor) FILTER (WHERE age_days BETWEEN 61 AND 90)::bigint AS d61_90,
                SUM(balance_minor) FILTER (WHERE age_days > 90)::bigint AS d90_plus,
                SUM(balance_minor)::bigint AS total
           FROM receivable
          GROUP BY site_id, semantic_key, account_code, acquirers
         HAVING SUM(balance_minor) <> 0
          ORDER BY site_id, semantic_key, account_code",
    )
    .bind(as_of)
    .bind(&RECEIVABLE_KEYS[..])
    .bind(acquirer)
    .bind(site_id)
    .fetch_all(pool)
    .await?;

    let mut total = AgingBuckets::default();
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        // A FILTER over no rows is NULL, and an empty bucket and a missing one
        // are the same thing to whoever reads the report. Zero, not a gap.
        let buckets = AgingBuckets {
            not_due_minor: row
                .try_get::<Option<i64>, _>("not_due")?
                .unwrap_or_default(),
            days_1_30_minor: row.try_get::<Option<i64>, _>("d1_30")?.unwrap_or_default(),
            days_31_60_minor: row.try_get::<Option<i64>, _>("d31_60")?.unwrap_or_default(),
            days_61_90_minor: row.try_get::<Option<i64>, _>("d61_90")?.unwrap_or_default(),
            days_over_90_minor: row
                .try_get::<Option<i64>, _>("d90_plus")?
                .unwrap_or_default(),
            total_minor: row.try_get::<Option<i64>, _>("total")?.unwrap_or_default(),
        };
        total.not_due_minor += buckets.not_due_minor;
        total.days_1_30_minor += buckets.days_1_30_minor;
        total.days_31_60_minor += buckets.days_31_60_minor;
        total.days_61_90_minor += buckets.days_61_90_minor;
        total.days_over_90_minor += buckets.days_over_90_minor;
        total.total_minor += buckets.total_minor;
        let acquirers: Vec<String> = row.try_get("acquirers")?;
        out.push(AcquirerAgingRow {
            // Named only when the ledger can name it. A leaf two banks share
            // labelled with either one would be a figure somebody chases the
            // wrong bank for.
            acquirer: match acquirers.as_slice() {
                [only] => only.clone(),
                _ => String::new(),
            },
            acquirers,
            site_id: row.try_get("site_id")?,
            semantic_key: row.try_get("semantic_key")?,
            account_code: row.try_get("account_code")?,
            buckets,
        });
    }
    Ok(AcquirerReceivableAging {
        as_of,
        rows: out,
        total,
    })
}

/// Is a meaning mapped for this acquirer at this shop?
///
/// Offered so a screen can say "BCA has no fee account at C003" before somebody
/// curates a settlement and is refused by the poster with the same news.
pub async fn acq_settlement_unmapped_keys(
    pool: &PgPool,
    settlement_id: Uuid,
) -> Result<Vec<String>, AppError> {
    let settlement = acq_settlement_row(pool, settlement_id).await?;
    let lines = sqlx::query(
        "SELECT DISTINCT site_id, tender_kind FROM acquirer_settlement_line
          WHERE settlement_id = $1",
    )
    .bind(settlement_id)
    .fetch_all(pool)
    .await?;
    let mut missing = Vec::new();
    for row in &lines {
        let site_id: String = row.try_get("site_id")?;
        let tender_kind: String = row.try_get("tender_kind")?;
        for key in [receivable_key(&tender_kind), fee_key(&tender_kind)] {
            if resolve_account(pool, key, &site_id, &settlement.acquirer)
                .await
                .is_err()
            {
                missing.push(format!("{key} at {site_id} ({})", settlement.acquirer));
            }
        }
    }
    missing.sort();
    missing.dedup();
    Ok(missing)
}

/// The business day of an instant, in the shop's own calendar.
///
/// Exposed because the tests and any caller turning a timestamp into a trading
/// day must use the same 420 minutes the SQL above does; two answers to "which
/// day was this" is how a reconciliation comes to be missing one receipt.
pub fn acquirer_business_date(at: DateTime<Utc>) -> NaiveDate {
    (at + chrono::Duration::minutes(BUSINESS_DAY_MINUTES)).date_naive()
}
