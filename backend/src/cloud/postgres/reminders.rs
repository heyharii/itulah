//! The reminder pass: head office is told, once, what is about to lapse.
//!
//! `domain::reminder` decides the band; this module reads the rows, claims each
//! (subject, date, band) in `scheduled_job_run` exactly as the HR nudges do
//! (`postgres::schedule`), and raises the notice. A claim that could not be
//! raised is stamped `FAILED` so the next tick tries again rather than
//! recording a notice nobody received.
//!
//! Every notice goes to head office (`ADMIN`). GA contracts, papers, supplier
//! bills and tax are head-office work; a store supervisor does not renew the
//! lease on their own shop.

use crate::cloud::application::AppError;
use crate::cloud::domain::reminder::{self, jobs, kinds, ExpiryBand};
use crate::cloud::postgres::{
    self as infrastructure, claim_run, finish_run, NewNotification, SchedulerJobResult,
};
use chrono::NaiveDate;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

/// The actor named in each notice's payload.
pub const REMINDER_ACTOR: &str = "reminder-scheduler";

/// Run every reminder job for one business day, catching each job's failure so
/// one refused query does not silence the others.
pub async fn run_reminders(pool: &PgPool, on: NaiveDate) -> Vec<SchedulerJobResult> {
    let mut results = Vec::new();
    for job in [
        jobs::GA_CONTRACT,
        jobs::DOCUMENT,
        jobs::BILL_DUE,
        jobs::TAX_DEADLINE,
    ] {
        let result = match job {
            jobs::GA_CONTRACT => run_ga_contract_reminders(pool, on).await,
            jobs::DOCUMENT => run_document_reminders(pool, on).await,
            jobs::BILL_DUE => run_bill_due_reminders(pool, on).await,
            jobs::TAX_DEADLINE => run_tax_deadline_reminders(pool, on).await,
            other => Err(AppError::Configuration(format!(
                "reminder pass has no work for job {other}"
            ))),
        };
        results.push(match result {
            Ok(detail) => SchedulerJobResult {
                job: job.to_owned(),
                status: "RAN".to_owned(),
                detail,
            },
            Err(error) => {
                tracing::error!(job, %on, %error, "reminder job failed");
                SchedulerJobResult {
                    job: job.to_owned(),
                    status: "FAILED".to_owned(),
                    detail: json!({ "error": error.to_string() }),
                }
            }
        });
    }
    results
}

// ── GA contracts ─────────────────────────────────────────────────────────

pub async fn run_ga_contract_reminders(pool: &PgPool, on: NaiveDate) -> Result<Value, AppError> {
    // The contract's own `reminder_days` is the window (0360): a permit with a
    // months-long renewal queue asks earlier than a subscription renewed by
    // phone. DRAFT and TERMINATED contracts have nothing left to lapse.
    let rows = sqlx::query(
        "SELECT c.contract_id::text AS contract_id, c.contract_number, c.ends_on,
                c.reminder_days, ct.name AS contract_type_name,
                COALESCE(sup.name, c.counterparty_name) AS party,
                COALESCE(st.name, c.site_scope, c.site_id) AS place
           FROM ga_contract c
           JOIN contract_type ct ON ct.code = c.contract_type
           LEFT JOIN supplier sup ON sup.supplier_id = c.supplier_id
           LEFT JOIN site st ON st.id = c.site_id
          WHERE c.status = 'ACTIVE' AND NOT c.archived AND c.ends_on IS NOT NULL
            AND c.ends_on >= $1::date - $2::integer
            AND c.ends_on <= $1::date + c.reminder_days
          ORDER BY c.ends_on, c.contract_id",
    )
    .bind(on)
    .bind(reminder::ENDED_GRACE_DAYS as i32)
    .fetch_all(pool)
    .await?;

    let mut raised = 0usize;
    let mut skipped = 0usize;
    for row in &rows {
        let contract_id: String = row.try_get("contract_id")?;
        let ends_on: NaiveDate = row.try_get("ends_on")?;
        let reminder_days: i32 = row.try_get("reminder_days")?;
        let Some(band) = reminder::expiry_band(ends_on, on, i64::from(reminder_days)) else {
            continue;
        };
        let run_key = format!("ga_contract:{contract_id}:{ends_on}:{}", band.as_str());
        let number: Option<String> = row.try_get("contract_number")?;
        let type_name: String = row.try_get("contract_type_name")?;
        let party: Option<String> = row.try_get("party")?;
        let place: Option<String> = row.try_get("place")?;
        let title = match band {
            ExpiryBand::Soon => "A GA contract is about to end",
            ExpiryBand::Ended => "A GA contract has ended and is still active",
        };
        let body = format!(
            "{type_name}{}{}{} — ends {ends_on} ({}). {}",
            number.map(|n| format!(" {n}")).unwrap_or_default(),
            party.map(|p| format!(" with {p}")).unwrap_or_default(),
            place.map(|p| format!(" at {p}")).unwrap_or_default(),
            days_phrase(ends_on, on),
            match band {
                ExpiryBand::Soon => "Renew it, or decide to let it end.",
                ExpiryBand::Ended => "Renew it or terminate it, so the register says which.",
            }
        );
        let detail = json!({ "contract": contract_id, "ends_on": ends_on, "band": band.as_str() });
        if raise_once(
            pool,
            jobs::GA_CONTRACT,
            &run_key,
            kinds::GA_CONTRACT,
            title,
            &body,
            Some(("ga_contract", contract_id.clone())),
            detail,
        )
        .await?
        {
            raised += 1;
        } else {
            skipped += 1;
        }
    }
    Ok(json!({ "candidates": rows.len(), "raised": raised, "already_raised": skipped }))
}

// ── papers ───────────────────────────────────────────────────────────────

pub async fn run_document_reminders(pool: &PgPool, on: NaiveDate) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT document_id::text AS document_id, name, doc_type, doc_number, issuer, expires_on
           FROM document
          WHERE expires_on IS NOT NULL
            AND expires_on >= $1::date - $2::integer
            AND expires_on <= $1::date + $3::integer
          ORDER BY expires_on, document_id",
    )
    .bind(on)
    .bind(reminder::ENDED_GRACE_DAYS as i32)
    .bind(reminder::DOCUMENT_WARN_DAYS as i32)
    .fetch_all(pool)
    .await?;

    let mut raised = 0usize;
    let mut skipped = 0usize;
    for row in &rows {
        let document_id: String = row.try_get("document_id")?;
        let expires_on: NaiveDate = row.try_get("expires_on")?;
        let Some(band) = reminder::expiry_band(expires_on, on, reminder::DOCUMENT_WARN_DAYS) else {
            continue;
        };
        let run_key = format!("document:{document_id}:{expires_on}:{}", band.as_str());
        let name: String = row.try_get("name")?;
        let doc_type: Option<String> = row.try_get("doc_type")?;
        let doc_number: Option<String> = row.try_get("doc_number")?;
        let issuer: Option<String> = row.try_get("issuer")?;
        let title = match band {
            ExpiryBand::Soon => "A filed paper is about to expire",
            ExpiryBand::Ended => "A filed paper has expired",
        };
        // The type and number are what somebody reads back over the phone;
        // the file name is the fallback when the department wrote neither.
        let label = match (doc_type, doc_number) {
            (Some(kind), Some(number)) => format!("{kind} {number}"),
            (Some(kind), None) => format!("{kind} ({name})"),
            (None, Some(number)) => format!("{number} ({name})"),
            (None, None) => name,
        };
        let body = format!(
            "{label}{} — expires {expires_on} ({}).",
            issuer
                .map(|i| format!(", issued by {i}"))
                .unwrap_or_default(),
            days_phrase(expires_on, on),
        );
        let detail =
            json!({ "document": document_id, "expires_on": expires_on, "band": band.as_str() });
        if raise_once(
            pool,
            jobs::DOCUMENT,
            &run_key,
            kinds::DOCUMENT,
            title,
            &body,
            Some(("document", document_id.clone())),
            detail,
        )
        .await?
        {
            raised += 1;
        } else {
            skipped += 1;
        }
    }
    Ok(json!({ "candidates": rows.len(), "raised": raised, "already_raised": skipped }))
}

// ── supplier bills ───────────────────────────────────────────────────────

/// How many bills a digest names before it says "and N more".
const BILL_DIGEST_LINES: usize = 10;

pub async fn run_bill_due_reminders(pool: &PgPool, on: NaiveDate) -> Result<Value, AppError> {
    // Posted, not on hold, next instalment inside the week, and not already
    // covered by a payment somebody drafted — a bill already in this week's
    // payment run is not news to the person who put it there. The due date is
    // the view's `next_due_date` (0202), so an instalment bill is announced per
    // instalment.
    let rows = sqlx::query(
        "SELECT i.invoice_id::text AS invoice_id, i.invoice_number, i.supplier_name,
                st.next_due_date, st.outstanding_minor
           FROM supplier_invoice i
           JOIN supplier_invoice_standing st ON st.invoice_id = i.invoice_id
          WHERE i.status = 'POSTED' AND NOT i.on_hold
            AND st.next_due_date >= $1::date
            AND st.next_due_date <= $1::date + $2::integer
            AND st.outstanding_minor > COALESCE((
                    SELECT SUM(al.amount_minor)
                      FROM supplier_payment_allocation al
                      JOIN supplier_payment p USING (payment_id)
                     WHERE al.invoice_id = i.invoice_id AND p.status = 'DRAFT'), 0)
          ORDER BY st.next_due_date, i.invoice_number",
    )
    .bind(on)
    .bind(reminder::BILL_WARN_DAYS as i32)
    .fetch_all(pool)
    .await?;

    // Claim each bill's due date first, then tell head office about the newly
    // claimed ones in ONE notice. A notice per bill would be twenty
    // interruptions on a Monday; a daily digest that repeated every bill still
    // due would be the same list every morning.
    let mut claimed: Vec<(String, String)> = Vec::new();
    let mut lines: Vec<String> = Vec::new();
    let mut total: i64 = 0;
    for row in &rows {
        let invoice_id: String = row.try_get("invoice_id")?;
        let due: NaiveDate = row.try_get("next_due_date")?;
        if !reminder::bill_due_soon(due, on) {
            continue;
        }
        let run_key = format!("bill:{invoice_id}:{due}");
        if !claim_run(pool, jobs::BILL_DUE, &run_key).await? {
            continue;
        }
        let number: String = row.try_get("invoice_number")?;
        let supplier: Option<String> = row.try_get("supplier_name")?;
        let outstanding: i64 = row.try_get("outstanding_minor")?;
        total += outstanding;
        lines.push(format!(
            "{due} · {} · {number} · Rp {}",
            supplier.as_deref().unwrap_or("—"),
            rupiah(outstanding)
        ));
        claimed.push((run_key, invoice_id));
    }
    if claimed.is_empty() {
        return Ok(json!({ "candidates": rows.len(), "raised": 0 }));
    }

    let count = claimed.len();
    let mut body = format!(
        "{count} posted {} fall due within {} days, Rp {} outstanding and not yet in a payment:\n",
        if count == 1 { "bill" } else { "bills" },
        reminder::BILL_WARN_DAYS,
        rupiah(total)
    );
    body.push_str(&lines[..count.min(BILL_DIGEST_LINES)].join("\n"));
    if count > BILL_DIGEST_LINES {
        body.push_str(&format!("\n… and {} more.", count - BILL_DIGEST_LINES));
    }
    let raised = raise_to_head_office(
        pool,
        kinds::BILL_DUE,
        "Supplier bills fall due this week",
        &body,
        None,
    )
    .await;
    for (run_key, invoice_id) in &claimed {
        let (outcome, detail) = match &raised {
            Ok(()) => ("RAN", json!({ "invoice": invoice_id })),
            Err(error) => (
                "FAILED",
                json!({ "invoice": invoice_id, "error": error.to_string() }),
            ),
        };
        finish_run(pool, jobs::BILL_DUE, run_key, outcome, detail).await?;
    }
    raised?;
    Ok(json!({ "candidates": rows.len(), "raised": 1, "bills": count, "outstanding_minor": total }))
}

// ── tax months ───────────────────────────────────────────────────────────

pub async fn run_tax_deadline_reminders(pool: &PgPool, on: NaiveDate) -> Result<Value, AppError> {
    // Only the periods that exist and gathered something: a tax period is
    // created by the first item recorded against it (0279), so a month with no
    // withholding has no row and nothing to remind anybody of.
    let periods = infrastructure::tax_periods(pool, None, None, 500).await?;
    let mut raised = 0usize;
    let mut skipped = 0usize;
    for period in periods {
        if period.status == "SETTLED" {
            continue;
        }
        if period.obligation_minor == 0 && period.credit_minor == 0 {
            continue;
        }
        let Ok(month) = u32::try_from(period.period_month) else {
            continue;
        };
        let Some(mut deadlines) =
            reminder::tax_deadlines(&period.tax_type_code, period.period_year, month)
        else {
            continue;
        };
        // A due date somebody recorded on the period is theirs to set; it wins
        // over the statutory default for the payment.
        if let Some(due) = period.due_date {
            deadlines.pay_by = due;
        }
        let filed = period.status == "FILED";
        let label = format!(
            "{} {:04}-{:02}",
            period.tax_type_name, period.period_year, period.period_month
        );
        for band in reminder::tax_bands(deadlines, on, period.outstanding_minor, filed) {
            let run_key = format!(
                "tax:{}:{:04}-{:02}:{}",
                period.tax_type_code,
                period.period_year,
                period.period_month,
                band.as_str()
            );
            let (title, body) = match band {
                reminder::TaxBand::PayDue => (
                    "A tax payment is due soon",
                    format!(
                        "{label}: Rp {} to pay by {}.",
                        rupiah(period.outstanding_minor),
                        deadlines.pay_by
                    ),
                ),
                reminder::TaxBand::PayLate => (
                    "A tax payment is late",
                    format!(
                        "{label}: Rp {} was due by {} and is still unpaid.",
                        rupiah(period.outstanding_minor),
                        deadlines.pay_by
                    ),
                ),
                reminder::TaxBand::FileDue => (
                    "A tax return is due soon",
                    format!("{label}: the return is due by {}.", deadlines.file_by),
                ),
                reminder::TaxBand::FileLate => (
                    "A tax return is late",
                    format!(
                        "{label}: the return was due by {} and is not recorded as filed.",
                        deadlines.file_by
                    ),
                ),
            };
            let detail = json!({
                "tax_type": period.tax_type_code,
                "period": format!("{:04}-{:02}", period.period_year, period.period_month),
                "band": band.as_str(),
            });
            if raise_once(
                pool,
                jobs::TAX_DEADLINE,
                &run_key,
                kinds::TAX_DEADLINE,
                title,
                &body,
                Some(("tax_period", period.period_id.to_string())),
                detail,
            )
            .await?
            {
                raised += 1;
            } else {
                skipped += 1;
            }
        }
    }
    Ok(json!({ "raised": raised, "already_raised": skipped }))
}

// ── shared ───────────────────────────────────────────────────────────────

/// Claim one key and raise one notice under it. `Ok(false)` means the key was
/// already worked. A raise that fails stamps the claim `FAILED`, so it is
/// retried rather than recorded as told.
#[allow(clippy::too_many_arguments)]
async fn raise_once(
    pool: &PgPool,
    job: &str,
    run_key: &str,
    kind: &str,
    title: &str,
    body: &str,
    subject: Option<(&str, String)>,
    detail: Value,
) -> Result<bool, AppError> {
    if !claim_run(pool, job, run_key).await? {
        return Ok(false);
    }
    match raise_to_head_office(pool, kind, title, body, subject).await {
        Ok(()) => {
            finish_run(pool, job, run_key, "RAN", detail).await?;
            Ok(true)
        }
        Err(error) => {
            let mut detail = detail;
            detail["error"] = json!(error.to_string());
            let _ = finish_run(pool, job, run_key, "FAILED", detail).await;
            Err(error)
        }
    }
}

async fn raise_to_head_office(
    pool: &PgPool,
    kind: &str,
    title: &str,
    body: &str,
    subject: Option<(&str, String)>,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let recipients = infrastructure::recipients_with_role(&mut tx, &["ADMIN"]).await?;
    let _: Option<uuid::Uuid> = infrastructure::raise_notification(
        &mut tx,
        NewNotification {
            kind,
            title: title.to_owned(),
            body: body.to_owned(),
            subject,
            origin_id: None,
            payload: json!({ "source": REMINDER_ACTOR }),
        },
        &recipients,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

fn days_phrase(date: NaiveDate, on: NaiveDate) -> String {
    match (date - on).num_days() {
        0 => "today".to_owned(),
        1 => "tomorrow".to_owned(),
        -1 => "yesterday".to_owned(),
        days if days < 0 => format!("{} days ago", -days),
        days => format!("in {days} days"),
    }
}

/// `1.250.000`: rupiah as head office writes it, with no minor unit.
fn rupiah(minor: i64) -> String {
    let digits = minor.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    if minor < 0 {
        out.push('-');
    }
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push('.');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rupiah_groups_in_threes() {
        assert_eq!(rupiah(0), "0");
        assert_eq!(rupiah(950), "950");
        assert_eq!(rupiah(1_250_000), "1.250.000");
        assert_eq!(rupiah(-12_000), "-12.000");
    }

    #[test]
    fn a_date_is_said_the_way_a_person_says_it() {
        let on: NaiveDate = "2026-09-25".parse().unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(days_phrase(on, on), "today");
        assert_eq!(days_phrase(on + chrono::Duration::days(1), on), "tomorrow");
        assert_eq!(days_phrase(on + chrono::Duration::days(9), on), "in 9 days");
        assert_eq!(
            days_phrase(on - chrono::Duration::days(3), on),
            "3 days ago"
        );
    }
}
