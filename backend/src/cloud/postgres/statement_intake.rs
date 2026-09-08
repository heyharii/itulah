//! The rules that route an inbound file, and the record of every file that
//! arrived.
//!
//! Two tables from 0106 and nothing clever. The interesting decisions are in
//! `cloud::intake` (what to do with a file) and `cloud::domain::statement_intake`
//! (which rule wants it); this is where they are kept.
//!
//! One thing here is worth stating, because it is the difference between a
//! gateway somebody can run and one they cannot debug: **every attachment gets
//! a row, including the ones nothing wanted.** A mailbox that receives the
//! bank's mail and imports nothing looks identical, from outside, to a mailbox
//! nobody is sending to. `status = 'skipped_no_match'` is what tells the
//! difference, and it is the first thing anybody setting a rule up needs to
//! see.

use crate::cloud::application::AppError;
use crate::cloud::domain::SourceRule;
use crate::cloud::intake::parse::{Settings, StatementFormat};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// One routing rule, as a screen shows it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankStatementSourceRow {
    pub source_id: Uuid,
    pub label: String,
    pub enabled: bool,
    pub account_code: String,
    /// The client's own name for the account, so a rule reads as a sentence
    /// rather than as a code somebody has to look up.
    pub account_name: String,
    pub site_id: String,
    pub from_pattern: String,
    pub subject_pattern: String,
    pub filename_pattern: String,
    pub format: String,
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub settings: serde_json::Value,
    pub priority: i32,
    /// Whether the stored mapping is one the readers can actually use. A rule
    /// with a broken mapping is worse than a missing one: it takes the file
    /// and then cannot read it, and nothing else will pick it up.
    pub settings_error: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// When this rule last took delivery of anything, and what came of it.
    pub last_seen_at: Option<DateTime<Utc>>,
    pub last_status: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveStatementSourceRequest {
    pub label: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub account_code: String,
    pub site_id: String,
    #[serde(default)]
    pub from_pattern: String,
    #[serde(default)]
    pub subject_pattern: String,
    #[serde(default)]
    pub filename_pattern: String,
    /// `CSV`, `XLSX` or `PDF_TEXT`.
    pub format: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub settings: serde_json::Value,
    #[serde(default = "hundred")]
    pub priority: i32,
}

fn yes() -> bool {
    true
}

fn hundred() -> i32 {
    100
}

/// A rule with everything the gateway needs to act on it.
#[derive(Clone, Debug)]
pub struct ResolvedSource {
    pub rule: SourceRule,
    pub account_code: String,
    pub site_id: String,
    pub format: StatementFormat,
    pub settings: Settings,
}

/// What became of one attachment.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StatementIntakeRow {
    pub dedup_key: String,
    pub source_id: Option<Uuid>,
    pub source_label: Option<String>,
    pub message_id: String,
    pub sender: String,
    pub subject: String,
    pub filename: String,
    pub byte_count: i64,
    pub statement_id: Option<Uuid>,
    pub status: String,
    pub line_count: i32,
    pub duplicate_count: i32,
    pub detail: String,
    pub object_key: String,
    pub seen_at: DateTime<Utc>,
}

/// What the gateway writes when it has finished with an attachment.
#[derive(Clone, Debug, Default)]
pub struct IntakeRecord {
    pub dedup_key: String,
    pub source_id: Option<Uuid>,
    pub message_id: String,
    pub sender: String,
    pub subject: String,
    pub filename: String,
    pub byte_count: i64,
    pub statement_id: Option<Uuid>,
    pub status: &'static str,
    pub line_count: i32,
    pub duplicate_count: i32,
    pub detail: String,
    pub object_key: String,
}

pub async fn list_statement_sources(
    pool: &PgPool,
) -> Result<Vec<BankStatementSourceRow>, AppError> {
    let rows = sqlx::query(
        "SELECT s.source_id, s.label, s.enabled, s.account_code, a.name AS account_name,
                s.site_id, s.from_pattern, s.subject_pattern, s.filename_pattern,
                s.format, s.settings, s.priority, s.created_by, s.created_at, s.updated_at,
                last.seen_at AS last_seen_at, last.status AS last_status
           FROM bank_statement_source s
           JOIN ledger_account a ON a.account_code = s.account_code
           LEFT JOIN LATERAL (
                SELECT i.seen_at, i.status
                  FROM bank_statement_intake i
                 WHERE i.source_id = s.source_id
                 ORDER BY i.seen_at DESC
                 LIMIT 1
           ) last ON true
          ORDER BY s.priority, s.created_at",
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            let settings: serde_json::Value = row.try_get("settings")?;
            let format: String = row.try_get("format")?;
            Ok(BankStatementSourceRow {
                source_id: row.try_get("source_id")?,
                label: row.try_get("label")?,
                enabled: row.try_get("enabled")?,
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                site_id: row.try_get("site_id")?,
                from_pattern: row.try_get("from_pattern")?,
                subject_pattern: row.try_get("subject_pattern")?,
                filename_pattern: row.try_get("filename_pattern")?,
                settings_error: mapping_fault(&format, &settings),
                format,
                settings,
                priority: row.try_get("priority")?,
                created_by: row.try_get("created_by")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
                last_seen_at: row.try_get("last_seen_at")?,
                last_status: row.try_get("last_status")?,
            })
        })
        .collect()
}

/// Whether a stored mapping would survive meeting a file.
///
/// Checked on read as well as on write, because a mapping can be made invalid
/// by something other than an edit to it — the format changed, or the settings
/// were written by an older version of the screen. A rule that cannot work is
/// worth seeing in the list, greyed, rather than discovered from an intake log
/// three days later.
fn mapping_fault(format: &str, settings: &serde_json::Value) -> Option<String> {
    let Some(format) = StatementFormat::parse(format) else {
        return Some(format!("unknown format {format}"));
    };
    let settings: Settings = match serde_json::from_value(settings.clone()) {
        Ok(settings) => settings,
        Err(error) => return Some(format!("settings will not parse: {error}")),
    };
    if settings.columns.value_date.is_none() && format != StatementFormat::PdfText {
        return Some("no column is named as the value date".into());
    }
    if format == StatementFormat::PdfText && settings.line_pattern.is_none() {
        return Some("a PDF source needs a line_pattern".into());
    }
    if format != StatementFormat::PdfText
        && settings.columns.amount.is_none()
        && settings.columns.debit.is_none()
        && settings.columns.credit.is_none()
    {
        return Some("no column is named as the amount".into());
    }
    None
}

/// Every enabled rule, in the order the matcher must try them.
///
/// A rule whose settings will not parse is left out rather than allowed to take
/// a file it cannot read — and `list_statement_sources` is where the reason
/// shows up, next to the rule.
pub async fn active_statement_sources(pool: &PgPool) -> Result<Vec<ResolvedSource>, AppError> {
    let rows = sqlx::query(
        "SELECT source_id, label, account_code, site_id, from_pattern, subject_pattern,
                filename_pattern, format, settings
           FROM bank_statement_source
          WHERE enabled
          ORDER BY priority, created_at",
    )
    .fetch_all(pool)
    .await?;

    let mut sources = Vec::new();
    for row in rows {
        let source_id: Uuid = row.try_get("source_id")?;
        let label: String = row.try_get("label")?;
        let format: String = row.try_get("format")?;
        let raw: serde_json::Value = row.try_get("settings")?;
        let (Some(format), Ok(settings)) = (
            StatementFormat::parse(&format),
            serde_json::from_value::<Settings>(raw),
        ) else {
            tracing::warn!(%source_id, %label, "a statement source has a mapping that will not parse; it is taking no mail");
            continue;
        };
        sources.push(ResolvedSource {
            rule: SourceRule {
                source_id,
                label,
                from_pattern: row.try_get("from_pattern")?,
                subject_pattern: row.try_get("subject_pattern")?,
                filename_pattern: row.try_get("filename_pattern")?,
            },
            account_code: row.try_get("account_code")?,
            site_id: row.try_get("site_id")?,
            format,
            settings,
        });
    }
    Ok(sources)
}

pub async fn save_statement_source(
    pool: &PgPool,
    source_id: Option<Uuid>,
    request: &SaveStatementSourceRequest,
    actor: &str,
) -> Result<Uuid, AppError> {
    if request.label.trim().is_empty() {
        return Err(AppError::Validation("a source needs a name".into()));
    }
    if StatementFormat::parse(&request.format).is_none() {
        return Err(AppError::Validation(format!(
            "unknown format {}; expected CSV, XLSX or PDF_TEXT",
            request.format
        )));
    }
    // The mapping is checked here rather than only when a file turns up,
    // because the person who can fix it is the person on this screen now.
    if let Some(fault) = mapping_fault(&request.format, &request.settings) {
        return Err(AppError::Validation(fault));
    }

    let source_id = source_id.unwrap_or_else(Uuid::new_v4);
    sqlx::query(
        "INSERT INTO bank_statement_source
           (source_id, label, enabled, account_code, site_id, from_pattern, subject_pattern,
            filename_pattern, format, settings, priority, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (source_id) DO UPDATE SET
            label = EXCLUDED.label,
            enabled = EXCLUDED.enabled,
            account_code = EXCLUDED.account_code,
            site_id = EXCLUDED.site_id,
            from_pattern = EXCLUDED.from_pattern,
            subject_pattern = EXCLUDED.subject_pattern,
            filename_pattern = EXCLUDED.filename_pattern,
            format = EXCLUDED.format,
            settings = EXCLUDED.settings,
            priority = EXCLUDED.priority,
            updated_at = now()",
    )
    .bind(source_id)
    .bind(request.label.trim())
    .bind(request.enabled)
    .bind(request.account_code.trim())
    .bind(request.site_id.trim())
    .bind(request.from_pattern.trim())
    .bind(request.subject_pattern.trim())
    .bind(request.filename_pattern.trim())
    .bind(request.format.trim().to_uppercase())
    .bind(&request.settings)
    .bind(request.priority)
    .bind(actor)
    .execute(pool)
    .await?;
    Ok(source_id)
}

/// Retire a rule.
///
/// The intake rows it produced keep their history — 0106 nulls the reference
/// rather than cascading — so deleting a rule cannot make the same files
/// arrive again as if they never had.
pub async fn delete_statement_source(pool: &PgPool, source_id: Uuid) -> Result<(), AppError> {
    let gone = sqlx::query("DELETE FROM bank_statement_source WHERE source_id = $1")
        .bind(source_id)
        .execute(pool)
        .await?
        .rows_affected();
    if gone == 0 {
        return Err(AppError::NotFound("statement source".into()));
    }
    Ok(())
}

pub async fn statement_intake_seen(pool: &PgPool, dedup_key: &str) -> Result<bool, AppError> {
    let found: Option<i32> =
        sqlx::query_scalar("SELECT 1 FROM bank_statement_intake WHERE dedup_key = $1")
            .bind(dedup_key)
            .fetch_optional(pool)
            .await?;
    Ok(found.is_some())
}

/// Write down what happened to an attachment.
///
/// `ON CONFLICT DO NOTHING`, because two nodes polling one mailbox is a
/// supported deployment and the loser of that race has done no harm — it read
/// a file the other one had already recorded.
pub async fn record_statement_intake(pool: &PgPool, record: &IntakeRecord) -> Result<(), AppError> {
    let detail: String = record.detail.chars().take(1000).collect();
    sqlx::query(
        "INSERT INTO bank_statement_intake
           (dedup_key, source_id, message_id, sender, subject, filename, byte_count,
            statement_id, status, line_count, duplicate_count, detail, object_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (dedup_key) DO NOTHING",
    )
    .bind(&record.dedup_key)
    .bind(record.source_id)
    .bind(&record.message_id)
    .bind(&record.sender)
    .bind(&record.subject)
    .bind(&record.filename)
    .bind(record.byte_count)
    .bind(record.statement_id)
    .bind(record.status)
    .bind(record.line_count)
    .bind(record.duplicate_count)
    .bind(detail)
    .bind(&record.object_key)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn recent_statement_intake(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<StatementIntakeRow>, AppError> {
    let rows = sqlx::query(
        "SELECT i.dedup_key, i.source_id, s.label AS source_label, i.message_id, i.sender,
                i.subject, i.filename, i.byte_count, i.statement_id, i.status, i.line_count,
                i.duplicate_count, i.detail, i.object_key, i.seen_at
           FROM bank_statement_intake i
           LEFT JOIN bank_statement_source s ON s.source_id = i.source_id
          ORDER BY i.seen_at DESC
          LIMIT $1",
    )
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(StatementIntakeRow {
                dedup_key: row.try_get("dedup_key")?,
                source_id: row.try_get("source_id")?,
                source_label: row.try_get("source_label")?,
                message_id: row.try_get("message_id")?,
                sender: row.try_get("sender")?,
                subject: row.try_get("subject")?,
                filename: row.try_get("filename")?,
                byte_count: row.try_get("byte_count")?,
                statement_id: row.try_get("statement_id")?,
                status: row.try_get("status")?,
                line_count: row.try_get("line_count")?,
                duplicate_count: row.try_get("duplicate_count")?,
                detail: row.try_get("detail")?,
                object_key: row.try_get("object_key")?,
                seen_at: row.try_get("seen_at")?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_mapping_with_no_date_column_is_refused_at_the_screen() {
        let fault = mapping_fault("CSV", &json!({}));
        assert!(fault.is_some());
    }

    #[test]
    fn a_workable_csv_mapping_passes() {
        let settings = json!({
            "columns": {
                "value_date": "Tanggal",
                "description": "Keterangan",
                "debit": "Debet",
                "credit": "Kredit"
            }
        });
        assert_eq!(mapping_fault("CSV", &settings), None);
    }

    #[test]
    fn a_pdf_source_is_judged_on_its_pattern_and_not_on_columns_it_cannot_have() {
        assert!(mapping_fault("PDF_TEXT", &json!({})).is_some());
        let settings = json!({ "line_pattern": "(?<date>\\d+)" });
        assert_eq!(mapping_fault("PDF_TEXT", &settings), None);
    }

    #[test]
    fn a_format_nobody_implements_is_named_in_the_complaint() {
        let fault = mapping_fault("MT940", &json!({})).unwrap_or_default();
        assert!(fault.contains("MT940"), "{fault}");
    }
}
