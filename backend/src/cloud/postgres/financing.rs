//! Facilities: money borrowed on terms, and repaid on a schedule.
//!
//! One instalment, one entry, two halves named separately:
//!
//!   Dr <loan principal>   what reduces the debt
//!   Dr <interest>         what the money cost this period
//!   Cr <bank>             what actually left
//!
//! The schedule is GIVEN, not computed. An amortisation formula here would be
//! this system's opinion about what the lender charges; the instalments come
//! off the contract, and the one arithmetic rule enforced is that the parts of
//! an instalment add up to what is paid.
//!
//! A facility is recorded at a site and its instalments are booked to the unit
//! that owns it (`sites::unit_of_site`, 0605) — head office's, for the Gudang.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::poster::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;

const SOURCE_KIND: &str = "PAYMENT";
const RULE_VERSION: &str = "financing_installment/1";

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FinancingFacility {
    pub facility_id: Uuid,
    pub facility_number: String,
    pub kind: String,
    pub lender_label: String,
    pub site_id: String,
    pub currency: String,
    pub principal_minor: i64,
    pub rate_bps: i32,
    pub start_date: NaiveDate,
    pub maturity_date: NaiveDate,
    pub status: String,
    /// What the schedule still has to repay, and what has been paid.
    pub scheduled_principal_minor: i64,
    pub paid_principal_minor: i64,
    pub outstanding_principal_minor: i64,
    pub paid_interest_minor: i64,
    /// Principal falling due within a year of today — the current portion the
    /// client's chart keeps at `20125*`. Derived, because the answer moves with
    /// the calendar.
    pub current_portion_minor: i64,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FinancingInstallment {
    pub installment_id: Uuid,
    pub seq: i32,
    pub due_date: NaiveDate,
    pub principal_minor: i64,
    pub interest_minor: i64,
    pub total_minor: i64,
    pub entry_id: Option<Uuid>,
    pub entry_number: Option<String>,
    pub paid_on: Option<NaiveDate>,
    pub paid_by: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FinancingFacilityDocument {
    pub facility: FinancingFacility,
    pub installments: Vec<FinancingInstallment>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ScheduledInstallment {
    pub due_date: NaiveDate,
    pub principal_minor: i64,
    pub interest_minor: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateFacilityRequest {
    /// `BANK_LOAN`, `LEASE` or `PRINCIPAL_LOAN`.
    pub kind: String,
    pub site_id: String,
    pub principal_minor: i64,
    pub start_date: NaiveDate,
    pub maturity_date: NaiveDate,
    #[serde(default)]
    pub bank_id: Option<Uuid>,
    #[serde(default)]
    pub principal_id: Option<Uuid>,
    #[serde(default)]
    pub lender_name: Option<String>,
    #[serde(default)]
    pub rate_bps: Option<i32>,
    /// Which meanings the two halves post through, and how they are narrowed.
    #[serde(default)]
    pub principal_qualifier: Option<String>,
    #[serde(default)]
    pub interest_qualifier: Option<String>,
    /// The contract's own schedule. Empty is allowed: a facility can be
    /// recorded before its schedule is typed in.
    #[serde(default)]
    pub installments: Vec<ScheduledInstallment>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayInstallmentRequest {
    pub posting_date: NaiveDate,
    pub bank_key: String,
    #[serde(default)]
    pub bank_qualifier: String,
}

const FACILITY_COLUMNS: &str = "f.facility_id, f.facility_number, f.kind, f.site_id,
     f.currency::text AS currency, f.principal_minor, f.rate_bps, f.start_date,
     f.maturity_date, f.status, f.note,
     COALESCE(b.name, p.name, f.lender_name, '—') AS lender_label,
     COALESCE(i.scheduled, 0)::bigint AS scheduled_principal_minor,
     COALESCE(i.paid_principal, 0)::bigint AS paid_principal_minor,
     COALESCE(i.paid_interest, 0)::bigint AS paid_interest_minor,
     COALESCE(i.current_portion, 0)::bigint AS current_portion_minor";

const FACILITY_FROM: &str = "FROM financing_facility f
       LEFT JOIN bank b ON b.bank_id = f.bank_id
       LEFT JOIN principal p ON p.principal_id = f.principal_id
       LEFT JOIN (
            SELECT facility_id,
                   SUM(principal_minor) AS scheduled,
                   SUM(principal_minor) FILTER (WHERE entry_id IS NOT NULL) AS paid_principal,
                   SUM(interest_minor)  FILTER (WHERE entry_id IS NOT NULL) AS paid_interest,
                   SUM(principal_minor) FILTER (
                       WHERE entry_id IS NULL AND due_date <= CURRENT_DATE + interval '1 year'
                   ) AS current_portion
              FROM financing_installment GROUP BY facility_id
       ) i ON i.facility_id = f.facility_id";

fn to_facility(row: &sqlx::postgres::PgRow) -> Result<FinancingFacility, AppError> {
    let scheduled: i64 = row.try_get("scheduled_principal_minor")?;
    let paid: i64 = row.try_get("paid_principal_minor")?;
    let borrowed: i64 = row.try_get("principal_minor")?;
    Ok(FinancingFacility {
        facility_id: row.try_get("facility_id")?,
        facility_number: row.try_get("facility_number")?,
        kind: row.try_get("kind")?,
        lender_label: row.try_get("lender_label")?,
        site_id: row.try_get("site_id")?,
        currency: row.try_get::<String, _>("currency")?.trim().to_string(),
        principal_minor: borrowed,
        rate_bps: row.try_get("rate_bps")?,
        start_date: row.try_get("start_date")?,
        maturity_date: row.try_get("maturity_date")?,
        status: row.try_get("status")?,
        scheduled_principal_minor: scheduled,
        paid_principal_minor: paid,
        // What is still owed is what was borrowed less what has been repaid —
        // the schedule is the plan, the payments are the fact.
        outstanding_principal_minor: borrowed - paid,
        paid_interest_minor: row.try_get("paid_interest_minor")?,
        current_portion_minor: row.try_get("current_portion_minor")?,
        note: row.try_get("note")?,
    })
}

pub async fn financing_facilities(
    pool: &PgPool,
    status: Option<&str>,
) -> Result<Vec<FinancingFacility>, AppError> {
    let sql = format!(
        "SELECT {FACILITY_COLUMNS} {FACILITY_FROM}
          WHERE ($1::text IS NULL OR f.status = $1)
          ORDER BY f.maturity_date, f.facility_number"
    );
    let rows = sqlx::query(&sql).bind(status).fetch_all(pool).await?;
    rows.iter().map(to_facility).collect()
}

pub async fn financing_facility_detail(
    pool: &PgPool,
    facility_id: Uuid,
) -> Result<FinancingFacilityDocument, AppError> {
    let sql = format!("SELECT {FACILITY_COLUMNS} {FACILITY_FROM} WHERE f.facility_id = $1");
    let row = sqlx::query(&sql)
        .bind(facility_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("facility {facility_id}")))?;
    let facility = to_facility(&row)?;

    let rows = sqlx::query(
        "SELECT i.installment_id, i.seq, i.due_date, i.principal_minor, i.interest_minor,
                i.entry_id, e.entry_number, i.paid_on, i.paid_by
           FROM financing_installment i
           LEFT JOIN journal_entry e ON e.entry_id = i.entry_id
          WHERE i.facility_id = $1
          ORDER BY i.seq",
    )
    .bind(facility_id)
    .fetch_all(pool)
    .await?;
    let installments = rows
        .iter()
        .map(|row| {
            let principal: i64 = row.try_get("principal_minor")?;
            let interest: i64 = row.try_get("interest_minor")?;
            Ok(FinancingInstallment {
                installment_id: row.try_get("installment_id")?,
                seq: row.try_get("seq")?,
                due_date: row.try_get("due_date")?,
                principal_minor: principal,
                interest_minor: interest,
                total_minor: principal + interest,
                entry_id: row.try_get("entry_id")?,
                entry_number: row.try_get("entry_number")?,
                paid_on: row.try_get("paid_on")?,
                paid_by: row.try_get("paid_by")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(FinancingFacilityDocument {
        facility,
        installments,
    })
}

pub async fn financing_facility_create(
    pool: &PgPool,
    request: &CreateFacilityRequest,
    actor: &str,
) -> Result<FinancingFacilityDocument, AppError> {
    if request.principal_minor <= 0 {
        return Err(AppError::Validation(
            "a facility borrows a positive amount".into(),
        ));
    }
    match request.kind.as_str() {
        "BANK_LOAN" | "LEASE" | "PRINCIPAL_LOAN" => {}
        other => {
            return Err(AppError::Validation(format!(
                "a facility is a BANK_LOAN, a LEASE or a PRINCIPAL_LOAN; {other} is none"
            )))
        }
    }
    let scheduled: i64 = request
        .installments
        .iter()
        .map(|line| line.principal_minor)
        .sum();
    if !request.installments.is_empty() && scheduled != request.principal_minor {
        return Err(AppError::Validation(format!(
            "the schedule repays {scheduled} of a facility that borrowed {}; a schedule \
             that does not repay the loan is a schedule somebody typed wrong",
            request.principal_minor
        )));
    }

    let facility_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    let number = super::number_series::next_number(
        &mut tx,
        super::number_series::FINANCING_FACILITY,
        request.start_date,
        None,
    )
    .await?;
    sqlx::query(
        "INSERT INTO financing_facility
           (facility_id, facility_number, kind, bank_id, principal_id, lender_name,
            site_id, principal_minor, rate_bps, start_date, maturity_date,
            principal_qualifier, interest_qualifier, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10,$11,
                 COALESCE($12,''),COALESCE($13,''),$14,$15)",
    )
    .bind(facility_id)
    .bind(&number)
    .bind(&request.kind)
    .bind(request.bank_id)
    .bind(request.principal_id)
    .bind(request.lender_name.as_deref())
    .bind(&request.site_id)
    .bind(request.principal_minor)
    .bind(request.rate_bps)
    .bind(request.start_date)
    .bind(request.maturity_date)
    .bind(request.principal_qualifier.as_deref())
    .bind(request.interest_qualifier.as_deref())
    .bind(request.note.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    for (index, line) in request.installments.iter().enumerate() {
        sqlx::query(
            "INSERT INTO financing_installment
               (installment_id, facility_id, seq, due_date, principal_minor, interest_minor)
             VALUES ($1,$2,$3,$4,$5,$6)",
        )
        .bind(Uuid::new_v4())
        .bind(facility_id)
        .bind(i32::try_from(index + 1).unwrap_or_default())
        .bind(line.due_date)
        .bind(line.principal_minor)
        .bind(line.interest_minor)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    financing_facility_detail(pool, facility_id).await
}

/// Pay one instalment: the debt comes down, the interest is recognised.
pub async fn financing_installment_pay(
    pool: &PgPool,
    installment_id: Uuid,
    request: &PayInstallmentRequest,
    actor: &str,
) -> Result<FinancingFacilityDocument, AppError> {
    let row = sqlx::query(
        "SELECT i.facility_id, i.seq, i.principal_minor, i.interest_minor, i.entry_id,
                f.site_id, f.currency::text AS currency, f.facility_number,
                f.principal_key, f.principal_qualifier, f.interest_key, f.interest_qualifier
           FROM financing_installment i
           JOIN financing_facility f ON f.facility_id = i.facility_id
          WHERE i.installment_id = $1",
    )
    .bind(installment_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("installment {installment_id}")))?;

    if row.try_get::<Option<Uuid>, _>("entry_id")?.is_some() {
        return Err(AppError::Conflict(
            "that instalment has already been paid".into(),
        ));
    }
    let facility_id: Uuid = row.try_get("facility_id")?;
    let site_id: String = row.try_get("site_id")?;
    let unit = super::sites::unit_of_site(pool, &site_id).await?;
    let principal: i64 = row.try_get("principal_minor")?;
    let interest: i64 = row.try_get("interest_minor")?;
    let seq: i32 = row.try_get("seq")?;
    let number: String = row.try_get("facility_number")?;
    let principal_key: String = row.try_get("principal_key")?;
    let principal_qualifier: String = row.try_get("principal_qualifier")?;
    let interest_key: String = row.try_get("interest_key")?;
    let interest_qualifier: String = row.try_get("interest_qualifier")?;

    let mut lines = Vec::with_capacity(3);
    if principal > 0 {
        lines.push(
            PostingLine::debit(&principal_key, &unit, principal)
                .with_qualifier(&principal_qualifier),
        );
    }
    if interest > 0 {
        lines.push(
            PostingLine::debit(&interest_key, &unit, interest).with_qualifier(&interest_qualifier),
        );
    }
    lines.push(
        PostingLine::credit(&request.bank_key, &unit, principal + interest)
            .with_qualifier(&request.bank_qualifier),
    );

    let mut tx = pool.begin().await?;
    let intent = PostingIntent {
        posting_date: request.posting_date,
        source_kind: SOURCE_KIND.into(),
        source_id: Some(installment_id.to_string()),
        rule_version: RULE_VERSION.into(),
        currency: row.try_get::<String, _>("currency")?.trim().to_string(),
        memo: Some(format!("{number} — angsuran {seq}")),
        lines,
    };
    let posted = post(&mut tx, &intent, Some("MAIN"), actor).await?;
    sqlx::query(
        "UPDATE financing_installment
            SET entry_id = $2, paid_on = $3, paid_by = $4
          WHERE installment_id = $1 AND entry_id IS NULL",
    )
    .bind(installment_id)
    .bind(posted.entry_id)
    .bind(request.posting_date)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    // A facility whose schedule is fully paid is closed. Nothing is inferred
    // from the balance: an instalment is paid when it carries an entry.
    sqlx::query(
        "UPDATE financing_facility f
            SET status = 'CLOSED', closed_at = now(), closed_by = $2
          WHERE f.facility_id = $1 AND f.status = 'ACTIVE'
            AND NOT EXISTS (SELECT 1 FROM financing_installment i
                             WHERE i.facility_id = f.facility_id AND i.entry_id IS NULL)
            AND EXISTS (SELECT 1 FROM financing_installment i WHERE i.facility_id = f.facility_id)",
    )
    .bind(facility_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    financing_facility_detail(pool, facility_id).await
}
