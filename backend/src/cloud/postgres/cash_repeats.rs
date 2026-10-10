//! BKK and BKM that repeat (0716) — Jurnal's "jadwal berulang", ERPNext's
//! Auto Repeat, for the payments that leave the bank on the same day every
//! month without a bill in front of them.
//!
//! A repeat keeps the voucher body the BKK screen sends, minus its date, and
//! the hourly sweep hands it back to [`voucher_record`] with the date filled
//! in. So a repeated BKK is exactly a BKK somebody keyed: same checks, same
//! number series, same slip — and, because `voucher_record` writes a DRAFT, the
//! same approval before any money is in the books. Nothing here posts.
//!
//! # Why only OTHER lines, and never a giro
//!
//! A bill is settled once and an advance is netted once; a repeat naming
//! either would succeed in its first month and be refused every month after,
//! which is a schedule that looks alive and does nothing. A giro carries the
//! number of one piece of paper. Both are refused when the repeat is saved,
//! not when it first fails.

use chrono::{DateTime, Months, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::voucher::{voucher_record, RecordVoucherRequest};
use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashDocumentRepeat {
    pub repeat_id: Uuid,
    pub name: String,
    /// `OUT` for a BKK, `IN` for a BKM.
    pub direction: String,
    /// The voucher as it will be raised, without its date: the same body
    /// `POST /cash-documents/voucher` takes.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub voucher: serde_json::Value,
    /// What each raised voucher comes to: the sum of its lines.
    pub amount_minor: i64,
    pub party_name: String,
    /// `MONTHLY`, `QUARTERLY` or `YEARLY`.
    pub frequency: String,
    pub next_date: NaiveDate,
    pub end_date: Option<NaiveDate>,
    pub is_active: bool,
    pub last_run_on: Option<NaiveDate>,
    pub last_document_id: Option<Uuid>,
    pub last_document_number: Option<String>,
    pub last_error: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveCashDocumentRepeatRequest {
    /// Absent to create a repeat, present to change one.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub repeat_id: Option<Uuid>,
    pub name: String,
    /// The voucher body without `doc_date`; any `doc_date` sent is ignored.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub voucher: serde_json::Value,
    pub frequency: String,
    pub next_date: NaiveDate,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub end_date: Option<NaiveDate>,
    #[serde(default = "active")]
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashDocumentRepeatSweep {
    pub drafted: i64,
    pub failed: Vec<String>,
}

fn active() -> bool {
    true
}

/// The stored body with a date put back, read as the request it was.
fn voucher_on(
    voucher: &serde_json::Value,
    on: NaiveDate,
) -> Result<RecordVoucherRequest, AppError> {
    let mut body = voucher.clone();
    let object = body
        .as_object_mut()
        .ok_or_else(|| AppError::Validation("a repeat's voucher has to be an object".into()))?;
    object.insert("doc_date".into(), serde_json::Value::String(on.to_string()));
    serde_json::from_value(body)
        .map_err(|error| AppError::Validation(format!("the voucher cannot be read: {error}")))
}

/// Everything a repeat can be refused for before it ever runs.
fn check(voucher: &RecordVoucherRequest) -> Result<String, AppError> {
    let direction = voucher.direction.trim().to_ascii_uppercase();
    if !matches!(direction.as_str(), "OUT" | "IN") {
        return Err(AppError::Validation(
            "a repeat raises a BKK (OUT) or a BKM (IN)".into(),
        ));
    }
    if voucher.method.trim().eq_ignore_ascii_case("GIRO") {
        return Err(AppError::Validation(
            "a giro is one numbered piece of paper and cannot repeat; repeat it by transfer or cash"
                .into(),
        ));
    }
    if voucher.lines.is_empty() {
        return Err(AppError::Validation(
            "a repeat needs at least one line".into(),
        ));
    }
    if let Some(line) = voucher
        .lines
        .iter()
        .find(|line| !line.kind.trim().eq_ignore_ascii_case("OTHER"))
    {
        return Err(AppError::Validation(format!(
            "a {} line settles one document once and would be refused from the second month; \
             only Other lines can repeat",
            line.kind.trim().to_lowercase()
        )));
    }
    if voucher.lines.iter().any(|line| line.amount_minor <= 0) {
        return Err(AppError::Validation(
            "every repeated line needs an amount above zero".into(),
        ));
    }
    Ok(direction)
}

fn amount_of(voucher: &serde_json::Value) -> i64 {
    voucher
        .get("lines")
        .and_then(|lines| lines.as_array())
        .map(|lines| {
            lines
                .iter()
                .filter_map(|line| line.get("amount_minor").and_then(|a| a.as_i64()))
                .sum()
        })
        .unwrap_or(0)
}

const REPEAT_ROWS: &str = "
    SELECT r.repeat_id, r.name, r.direction, r.voucher, r.frequency, r.next_date, r.end_date,
           r.is_active, r.last_run_on, r.last_document_id, d.number AS last_document_number,
           r.last_error, r.created_by, r.created_at
      FROM cash_document_repeat r
      LEFT JOIN cash_document d ON d.document_id = r.last_document_id";

fn to_repeat(row: &sqlx::postgres::PgRow) -> Result<CashDocumentRepeat, AppError> {
    let voucher: serde_json::Value = row.try_get("voucher")?;
    Ok(CashDocumentRepeat {
        repeat_id: row.try_get("repeat_id")?,
        name: row.try_get("name")?,
        direction: row.try_get("direction")?,
        amount_minor: amount_of(&voucher),
        party_name: voucher
            .get("party_name")
            .and_then(|p| p.as_str())
            .unwrap_or_default()
            .to_string(),
        voucher,
        frequency: row.try_get("frequency")?,
        next_date: row.try_get("next_date")?,
        end_date: row.try_get("end_date")?,
        is_active: row.try_get("is_active")?,
        last_run_on: row.try_get("last_run_on")?,
        last_document_id: row.try_get("last_document_id")?,
        last_document_number: row.try_get("last_document_number")?,
        last_error: row.try_get("last_error")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
    })
}

/// Every repeat, the live ones first and soonest due at the top. `direction`
/// narrows to the BKK (`OUT`) or BKM (`IN`) register.
pub async fn cash_document_repeats(
    pool: &PgPool,
    direction: Option<&str>,
) -> Result<Vec<CashDocumentRepeat>, AppError> {
    let rows = sqlx::query(&format!(
        "{REPEAT_ROWS} WHERE ($1::text IS NULL OR r.direction = $1)
          ORDER BY r.is_active DESC, r.next_date, r.name"
    ))
    .bind(direction.map(|d| d.trim().to_ascii_uppercase()))
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_repeat).collect()
}

pub async fn save_cash_document_repeat(
    pool: &PgPool,
    request: &SaveCashDocumentRepeatRequest,
    actor: &str,
) -> Result<CashDocumentRepeat, AppError> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation(
            "a repeat needs a name; it is how the list tells two standing payments apart".into(),
        ));
    }
    let frequency = request.frequency.trim().to_ascii_uppercase();
    if !matches!(frequency.as_str(), "MONTHLY" | "QUARTERLY" | "YEARLY") {
        return Err(AppError::Validation(
            "a repeat is MONTHLY, QUARTERLY or YEARLY".into(),
        ));
    }
    if request.end_date.is_some_and(|end| end < request.next_date) {
        return Err(AppError::Validation(
            "the repeat ends before its next date; it would never raise anything".into(),
        ));
    }
    // Read it as a real voucher dated on its next run, so a body that would be
    // refused then is refused now, with the same sentence.
    let direction = check(&voucher_on(&request.voucher, request.next_date)?)?;
    let mut stored = request.voucher.clone();
    if let Some(object) = stored.as_object_mut() {
        object.remove("doc_date");
    }

    let id = request.repeat_id.unwrap_or_else(Uuid::new_v4);
    sqlx::query(
        "INSERT INTO cash_document_repeat
            (repeat_id, name, direction, voucher, frequency, next_date, end_date, is_active,
             created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (repeat_id) DO UPDATE
            SET name = EXCLUDED.name, direction = EXCLUDED.direction,
                voucher = EXCLUDED.voucher, frequency = EXCLUDED.frequency,
                next_date = EXCLUDED.next_date, end_date = EXCLUDED.end_date,
                is_active = EXCLUDED.is_active, last_error = NULL",
    )
    .bind(id)
    .bind(name)
    .bind(&direction)
    .bind(&stored)
    .bind(&frequency)
    .bind(request.next_date)
    .bind(request.end_date)
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

/// Raise a draft voucher for every repeat due on or before `today`.
///
/// One voucher per due date, oldest first: a repeat the sweep missed for two
/// months raises two drafts, each dated when it was due, because those are two
/// payments and the books should see both. A repeat that fails stays due with
/// its reason kept on the row; the others go on.
pub async fn run_cash_document_repeats(
    pool: &PgPool,
    today: NaiveDate,
    actor: &str,
) -> Result<CashDocumentRepeatSweep, AppError> {
    let due = sqlx::query(
        "SELECT repeat_id, name, voucher, frequency, next_date, end_date
           FROM cash_document_repeat
          WHERE is_active AND next_date <= $1
          ORDER BY next_date",
    )
    .bind(today)
    .fetch_all(pool)
    .await?;
    let mut sweep = CashDocumentRepeatSweep {
        drafted: 0,
        failed: Vec::new(),
    };
    for row in &due {
        let repeat_id: Uuid = row.try_get("repeat_id")?;
        let name: String = row.try_get("name")?;
        let voucher: serde_json::Value = row.try_get("voucher")?;
        let frequency: String = row.try_get("frequency")?;
        let end: Option<NaiveDate> = row.try_get("end_date")?;
        let mut on: NaiveDate = row.try_get("next_date")?;
        loop {
            let raised = match voucher_on(&voucher, on) {
                Ok(request) => voucher_record(pool, &request, actor).await,
                Err(error) => Err(error),
            };
            match raised {
                Ok(document) => {
                    sweep.drafted += 1;
                    let next = advance(on, &frequency);
                    let still = next.is_some_and(|next| end.is_none_or(|end| next <= end));
                    sqlx::query(
                        "UPDATE cash_document_repeat
                            SET last_run_on = $2, last_document_id = $3, last_error = NULL,
                                next_date = COALESCE($4, next_date), is_active = $5
                          WHERE repeat_id = $1",
                    )
                    .bind(repeat_id)
                    .bind(on)
                    .bind(document.document_id)
                    .bind(next)
                    .bind(still)
                    .execute(pool)
                    .await?;
                    match next {
                        Some(next) if still && next <= today => on = next,
                        _ => break,
                    }
                }
                Err(error) => {
                    let reason = error.to_string();
                    sqlx::query(
                        "UPDATE cash_document_repeat SET last_error = $2 WHERE repeat_id = $1",
                    )
                    .bind(repeat_id)
                    .bind(&reason)
                    .execute(pool)
                    .await?;
                    sweep.failed.push(format!("{name} ({on}): {reason}"));
                    break;
                }
            }
        }
    }
    Ok(sweep)
}
