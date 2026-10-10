//! Journal templates and repeats — ERPNext's Journal Entry Template and Auto
//! Repeat (0473).
//!
//! A template is a set of manual-journal lines Finance saves once. A repeat
//! raises a draft from it (or posts it, when `auto_post`) on its date and moves
//! the date on by its frequency; the cloud sweeps due repeats every hour.

use chrono::{DateTime, Months, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::manual_journal::{
    create_manual_journal_draft, submit_manual_journal_draft, ManualJournalDraftInput,
};
use super::poster::PostingLine;
use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalTemplate {
    pub template_id: Uuid,
    pub name: String,
    pub memo: Option<String>,
    #[cfg_attr(feature = "ts", ts(type = "Array<Record<string, unknown>>"))]
    pub lines: Vec<PostingLine>,
    pub is_active: bool,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveJournalTemplateRequest {
    /// Absent to create a template, present to change one.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub template_id: Option<Uuid>,
    pub name: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub memo: Option<String>,
    #[cfg_attr(feature = "ts", ts(type = "Array<Record<string, unknown>>"))]
    pub lines: Vec<PostingLine>,
    #[serde(default = "active")]
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalRepeat {
    pub repeat_id: Uuid,
    pub template_id: Uuid,
    pub template_name: String,
    /// `MONTHLY`, `QUARTERLY` or `YEARLY`.
    pub frequency: String,
    pub next_date: NaiveDate,
    pub end_date: Option<NaiveDate>,
    pub auto_post: bool,
    pub is_active: bool,
    pub last_run_on: Option<NaiveDate>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveJournalRepeatRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub repeat_id: Option<Uuid>,
    pub template_id: Uuid,
    pub frequency: String,
    pub next_date: NaiveDate,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub end_date: Option<NaiveDate>,
    #[serde(default)]
    pub auto_post: bool,
    #[serde(default = "active")]
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalRepeatSweep {
    pub drafted: i64,
    pub posted: i64,
    pub failed: Vec<String>,
}

fn active() -> bool {
    true
}

fn to_template(row: &sqlx::postgres::PgRow) -> Result<JournalTemplate, AppError> {
    let lines: serde_json::Value = row.try_get("lines")?;
    Ok(JournalTemplate {
        template_id: row.try_get("template_id")?,
        name: row.try_get("name")?,
        memo: row.try_get("memo")?,
        lines: serde_json::from_value(lines)?,
        is_active: row.try_get("is_active")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
    })
}

pub async fn journal_templates(pool: &PgPool) -> Result<Vec<JournalTemplate>, AppError> {
    let rows = sqlx::query(
        "SELECT template_id, name, memo, lines, is_active, created_by, created_at
           FROM journal_template ORDER BY is_active DESC, name",
    )
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_template).collect()
}

pub async fn save_journal_template(
    pool: &PgPool,
    request: &SaveJournalTemplateRequest,
    actor: &str,
) -> Result<JournalTemplate, AppError> {
    if request.name.trim().is_empty() || request.lines.is_empty() {
        return Err(AppError::Validation(
            "a template has a name and at least one line".into(),
        ));
    }
    let id = request.template_id.unwrap_or_else(Uuid::new_v4);
    let row = sqlx::query(
        "INSERT INTO journal_template (template_id, name, memo, lines, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (template_id) DO UPDATE
            SET name = EXCLUDED.name, memo = EXCLUDED.memo, lines = EXCLUDED.lines,
                is_active = EXCLUDED.is_active, updated_by = $6, updated_at = now()
         RETURNING template_id, name, memo, lines, is_active, created_by, created_at",
    )
    .bind(id)
    .bind(request.name.trim())
    .bind(request.memo.as_deref())
    .bind(serde_json::to_value(&request.lines)?)
    .bind(request.is_active)
    .bind(actor)
    .fetch_one(pool)
    .await?;
    to_template(&row)
}

fn to_repeat(row: &sqlx::postgres::PgRow) -> Result<JournalRepeat, AppError> {
    Ok(JournalRepeat {
        repeat_id: row.try_get("repeat_id")?,
        template_id: row.try_get("template_id")?,
        template_name: row.try_get("template_name")?,
        frequency: row.try_get("frequency")?,
        next_date: row.try_get("next_date")?,
        end_date: row.try_get("end_date")?,
        auto_post: row.try_get("auto_post")?,
        is_active: row.try_get("is_active")?,
        last_run_on: row.try_get("last_run_on")?,
    })
}

const REPEAT_ROWS: &str = "
    SELECT r.repeat_id, r.template_id, t.name AS template_name, r.frequency, r.next_date,
           r.end_date, r.auto_post, r.is_active, r.last_run_on
      FROM journal_repeat r JOIN journal_template t ON t.template_id = r.template_id";

pub async fn journal_repeats(pool: &PgPool) -> Result<Vec<JournalRepeat>, AppError> {
    let rows = sqlx::query(&format!(
        "{REPEAT_ROWS} ORDER BY r.is_active DESC, r.next_date"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_repeat).collect()
}

pub async fn save_journal_repeat(
    pool: &PgPool,
    request: &SaveJournalRepeatRequest,
    actor: &str,
) -> Result<JournalRepeat, AppError> {
    let frequency = request.frequency.trim().to_ascii_uppercase();
    if !matches!(frequency.as_str(), "MONTHLY" | "QUARTERLY" | "YEARLY") {
        return Err(AppError::Validation(
            "a repeat is MONTHLY, QUARTERLY or YEARLY".into(),
        ));
    }
    let id = request.repeat_id.unwrap_or_else(Uuid::new_v4);
    sqlx::query(
        "INSERT INTO journal_repeat
            (repeat_id, template_id, frequency, next_date, end_date, auto_post, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (repeat_id) DO UPDATE
            SET template_id = EXCLUDED.template_id, frequency = EXCLUDED.frequency,
                next_date = EXCLUDED.next_date, end_date = EXCLUDED.end_date,
                auto_post = EXCLUDED.auto_post, is_active = EXCLUDED.is_active",
    )
    .bind(id)
    .bind(request.template_id)
    .bind(&frequency)
    .bind(request.next_date)
    .bind(request.end_date)
    .bind(request.auto_post)
    .bind(request.is_active)
    .bind(actor)
    .execute(pool)
    .await?;
    let row = sqlx::query(&format!("{REPEAT_ROWS} WHERE r.repeat_id = $1"))
        .bind(id)
        .fetch_one(pool)
        .await?;
    to_repeat(&row)
}

fn advance(date: NaiveDate, frequency: &str) -> Option<NaiveDate> {
    let months = match frequency {
        "QUARTERLY" => 3,
        "YEARLY" => 12,
        _ => 1,
    };
    date.checked_add_months(Months::new(months))
}

/// Raise every repeat due on or before `today`: a draft, or a posted entry
/// when the repeat says so. A repeat that fails stays due and is named in the
/// answer; the others go on.
pub async fn run_journal_repeats(
    pool: &PgPool,
    today: NaiveDate,
    actor: &str,
) -> Result<JournalRepeatSweep, AppError> {
    let due = sqlx::query(
        "SELECT r.repeat_id, r.frequency, r.next_date, r.end_date, r.auto_post,
                t.name, t.memo, t.lines
           FROM journal_repeat r JOIN journal_template t ON t.template_id = r.template_id
          WHERE r.is_active AND t.is_active AND r.next_date <= $1
          ORDER BY r.next_date",
    )
    .bind(today)
    .fetch_all(pool)
    .await?;
    let mut sweep = JournalRepeatSweep {
        drafted: 0,
        posted: 0,
        failed: Vec::new(),
    };
    for row in &due {
        let repeat_id: Uuid = row.try_get("repeat_id")?;
        let on: NaiveDate = row.try_get("next_date")?;
        let name: String = row.try_get("name")?;
        let lines: Vec<PostingLine> = serde_json::from_value(row.try_get("lines")?)?;
        let auto_post: bool = row.try_get("auto_post")?;
        let draft = create_manual_journal_draft(
            pool,
            ManualJournalDraftInput {
                posting_date: on,
                currency: None,
                memo: row
                    .try_get::<Option<String>, _>("memo")?
                    .or_else(|| Some(name.clone())),
                lines,
            },
            actor,
        )
        .await;
        let outcome = match draft {
            Ok(draft) if auto_post => {
                let mut tx = pool.begin().await?;
                match submit_manual_journal_draft(&mut tx, draft.draft_id, actor).await {
                    Ok(_) => {
                        tx.commit().await?;
                        sweep.posted += 1;
                        Ok(())
                    }
                    Err(error) => Err(error),
                }
            }
            Ok(_) => {
                sweep.drafted += 1;
                Ok(())
            }
            Err(error) => Err(error),
        };
        match outcome {
            Ok(()) => {
                let frequency: String = row.try_get("frequency")?;
                let end: Option<NaiveDate> = row.try_get("end_date")?;
                let next = advance(on, &frequency);
                let still = next.is_some_and(|next| end.is_none_or(|end| next <= end));
                sqlx::query(
                    "UPDATE journal_repeat
                        SET last_run_on = $2, next_date = COALESCE($3, next_date), is_active = $4
                      WHERE repeat_id = $1",
                )
                .bind(repeat_id)
                .bind(on)
                .bind(next)
                .bind(still)
                .execute(pool)
                .await?;
            }
            Err(error) => sweep.failed.push(format!("{name} ({on}): {error}")),
        }
    }
    Ok(sweep)
}
