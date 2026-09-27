//! Manual journal documents, which stay drafts until Finance explicitly submits.

use super::poster::{self, Posted, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
pub struct ManualJournalDraft {
    pub draft_id: Uuid,
    pub posting_date: NaiveDate,
    pub currency: String,
    pub memo: Option<String>,
    pub lines: Vec<PostingLine>,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub purpose: String,
    pub status: String,
    pub posted_entry_id: Option<Uuid>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
    pub submitted_by: Option<String>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub cancelled_by: Option<String>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancellation_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ManualJournalDraftInput {
    pub posting_date: NaiveDate,
    pub currency: Option<String>,
    pub memo: Option<String>,
    pub lines: Vec<PostingLine>,
}

fn from_row(row: &sqlx::postgres::PgRow) -> Result<ManualJournalDraft, AppError> {
    let lines: Value = row.try_get("lines")?;
    Ok(ManualJournalDraft {
        draft_id: row.try_get("draft_id")?,
        posting_date: row.try_get("posting_date")?,
        currency: row.try_get("currency")?,
        memo: row.try_get("memo")?,
        lines: serde_json::from_value(lines)?,
        source_kind: row.try_get("source_kind")?,
        source_id: row.try_get("source_id")?,
        purpose: row.try_get("purpose")?,
        status: row.try_get("status")?,
        posted_entry_id: row.try_get("posted_entry_id")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
        submitted_by: row.try_get("submitted_by")?,
        submitted_at: row.try_get("submitted_at")?,
        cancelled_by: row.try_get("cancelled_by")?,
        cancelled_at: row.try_get("cancelled_at")?,
        cancellation_reason: row.try_get("cancellation_reason")?,
    })
}

const DRAFT_COLUMNS: &str =
    "draft_id, posting_date, currency, memo, lines, source_kind, source_id, purpose, \
     status, posted_entry_id, \
     created_by, created_at, updated_by, updated_at, submitted_by, submitted_at, \
     cancelled_by, cancelled_at, cancellation_reason";

fn normalized(input: ManualJournalDraftInput) -> Result<(String, Option<String>, Value), AppError> {
    let currency = input
        .currency
        .unwrap_or_else(|| "IDR".to_string())
        .trim()
        .to_ascii_uppercase();
    if currency.len() != 3 || !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Err(AppError::Validation(
            "currency must be a three-letter code".into(),
        ));
    }
    let memo = input
        .memo
        .map(|memo| memo.trim().to_string())
        .filter(|memo| !memo.is_empty());
    Ok((currency, memo, serde_json::to_value(input.lines)?))
}

pub async fn create_manual_journal_draft(
    pool: &PgPool,
    input: ManualJournalDraftInput,
    actor: &str,
) -> Result<ManualJournalDraft, AppError> {
    let draft_id = Uuid::new_v4();
    let posting_date = input.posting_date;
    let (currency, memo, lines) = normalized(input)?;
    let query = format!(
        "INSERT INTO finance_journal_draft
            (draft_id, posting_date, currency, memo, lines, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING {DRAFT_COLUMNS}"
    );
    let row = sqlx::query(&query)
        .bind(draft_id)
        .bind(posting_date)
        .bind(currency)
        .bind(memo)
        .bind(lines)
        .bind(actor)
        .fetch_one(pool)
        .await?;
    from_row(&row)
}

/// Queue a source-owned accounting event for Finance review without writing GL.
pub async fn create_finance_journal_source_draft(
    tx: &mut Transaction<'_, Postgres>,
    source_kind: &str,
    source_id: &str,
    purpose: &str,
    input: ManualJournalDraftInput,
    actor: &str,
) -> Result<ManualJournalDraft, AppError> {
    let source_kind = source_kind.trim().to_ascii_uppercase();
    if source_kind != "PAYROLL_RUN" {
        return Err(AppError::Validation(
            "only supported source-owned Finance drafts may be queued here".into(),
        ));
    }
    let source_id = source_id.trim();
    let purpose = purpose.trim().to_ascii_uppercase();
    if source_id.is_empty() || purpose != "ACCRUAL" {
        return Err(AppError::Validation(
            "payroll Finance drafts need a run id and the ACCRUAL purpose".into(),
        ));
    }
    let draft_id = Uuid::new_v4();
    let posting_date = input.posting_date;
    let (currency, memo, lines) = normalized(input)?;
    let query = format!(
        "INSERT INTO finance_journal_draft
            (draft_id, posting_date, currency, memo, lines, source_kind, source_id,
             purpose, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING {DRAFT_COLUMNS}"
    );
    let row = sqlx::query(&query)
        .bind(draft_id)
        .bind(posting_date)
        .bind(currency)
        .bind(memo)
        .bind(lines)
        .bind(source_kind)
        .bind(source_id)
        .bind(purpose)
        .bind(actor)
        .fetch_one(&mut **tx)
        .await?;
    from_row(&row)
}

pub async fn update_manual_journal_draft(
    pool: &PgPool,
    draft_id: Uuid,
    input: ManualJournalDraftInput,
    actor: &str,
) -> Result<ManualJournalDraft, AppError> {
    let posting_date = input.posting_date;
    let (currency, memo, lines) = normalized(input)?;
    let query = format!(
        "UPDATE finance_journal_draft
            SET posting_date = $2, currency = $3, memo = $4, lines = $5,
                updated_by = $6, updated_at = now()
          WHERE draft_id = $1 AND status = 'DRAFT'
          RETURNING {DRAFT_COLUMNS}"
    );
    let row = sqlx::query(&query)
        .bind(draft_id)
        .bind(posting_date)
        .bind(currency)
        .bind(memo)
        .bind(lines)
        .bind(actor)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Conflict("only a draft journal can be edited".into()))?;
    from_row(&row)
}

pub async fn list_manual_journal_drafts(
    pool: &PgPool,
) -> Result<Vec<ManualJournalDraft>, AppError> {
    let query = format!(
        "SELECT {DRAFT_COLUMNS} FROM finance_journal_draft
          WHERE status = 'DRAFT' ORDER BY updated_at DESC, draft_id"
    );
    sqlx::query(&query)
        .fetch_all(pool)
        .await?
        .iter()
        .map(from_row)
        .collect()
}

pub async fn get_manual_journal_draft(
    pool: &PgPool,
    draft_id: Uuid,
) -> Result<ManualJournalDraft, AppError> {
    let query = format!("SELECT {DRAFT_COLUMNS} FROM finance_journal_draft WHERE draft_id = $1");
    let row = sqlx::query(&query)
        .bind(draft_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("manual journal draft {draft_id}")))?;
    from_row(&row)
}

async fn lock_draft(
    tx: &mut Transaction<'_, Postgres>,
    draft_id: Uuid,
) -> Result<ManualJournalDraft, AppError> {
    let query = format!(
        "SELECT {DRAFT_COLUMNS} FROM finance_journal_draft
          WHERE draft_id = $1 FOR UPDATE"
    );
    let row = sqlx::query(&query)
        .bind(draft_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("manual journal draft {draft_id}")))?;
    from_row(&row)
}

pub async fn submit_manual_journal_draft(
    tx: &mut Transaction<'_, Postgres>,
    draft_id: Uuid,
    actor: &str,
) -> Result<Posted, AppError> {
    let draft = lock_draft(tx, draft_id).await?;
    if draft.status == "POSTED" {
        let entry_id = draft.posted_entry_id.ok_or_else(|| {
            AppError::Conflict("posted manual journal has no linked ledger entry".into())
        })?;
        let row =
            sqlx::query("SELECT entry_number, total_minor FROM journal_entry WHERE entry_id = $1")
                .bind(entry_id)
                .fetch_one(&mut **tx)
                .await?;
        return Ok(Posted {
            entry_id,
            entry_number: row.try_get("entry_number")?,
            total_minor: row.try_get("total_minor")?,
        });
    }
    if draft.status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "manual journal is {}, so it cannot be submitted",
            draft.status.to_ascii_lowercase()
        )));
    }

    // Workflow (0472): from the amount Finance set, the person who drafted
    // an entry is not the person who posts it.
    let two_person_from: i64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT round(value_numeric)::bigint FROM finance_setting
                           WHERE setting_key = 'journal.two_person_from_minor'), 0)",
    )
    .fetch_one(&mut **tx)
    .await?;
    let total: i64 = draft.lines.iter().map(|line| line.debit_minor).sum();
    if two_person_from > 0 && total >= two_person_from && draft.created_by == actor {
        return Err(AppError::Forbidden(format!(
            "an entry of {total} is posted by somebody other than the person who drafted it \
             (from {two_person_from}, a Finance setting)"
        )));
    }

    let intent = PostingIntent {
        posting_date: draft.posting_date,
        source_kind: draft.source_kind.clone(),
        source_id: Some(
            draft
                .source_id
                .clone()
                .unwrap_or_else(|| draft_id.to_string()),
        ),
        rule_version: if draft.source_kind == "PAYROLL_RUN" {
            "payroll_run/1".into()
        } else {
            "manual/1".into()
        },
        currency: draft.currency,
        memo: draft.memo,
        lines: draft.lines,
    };
    let posted = poster::post(
        tx,
        &intent,
        (draft.purpose != "MAIN").then_some(draft.purpose.as_str()),
        actor,
    )
    .await?;
    sqlx::query(
        "UPDATE finance_journal_draft
            SET status = 'POSTED', posted_entry_id = $2,
                submitted_by = $3, submitted_at = now(),
                updated_by = $3, updated_at = now()
          WHERE draft_id = $1 AND status = 'DRAFT'",
    )
    .bind(draft_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    Ok(posted)
}

pub async fn cancel_manual_journal_draft(
    pool: &PgPool,
    draft_id: Uuid,
    reason: &str,
    actor: &str,
) -> Result<ManualJournalDraft, AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation("a cancellation needs a reason".into()));
    }
    let query = format!(
        "UPDATE finance_journal_draft
            SET status = 'CANCELLED', cancellation_reason = $2,
                cancelled_by = $3, cancelled_at = now(),
                updated_by = $3, updated_at = now()
          WHERE draft_id = $1 AND status = 'DRAFT' AND source_kind = 'MANUAL'
          RETURNING {DRAFT_COLUMNS}"
    );
    let row = sqlx::query(&query)
        .bind(draft_id)
        .bind(reason)
        .bind(actor)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Conflict("only a draft journal can be cancelled".into()))?;
    from_row(&row)
}
