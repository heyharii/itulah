//! Head office charging a unit a management fee.
//!
//! Owner decision, 25 Sep (FINANCE-CONNECT-BRIEF.md): the fee is head office's
//! income and the unit's cost, and because the two live in different books it
//! crosses on Lain-lain. The document is head office's:
//!
//!   unit   Dr 7032 Biaya Management Fee   / Cr 2030 Hutang Lain-lain Principal
//!   HO     Dr 1059 Piutang Affiliasi …    / Cr 4016 Management Fee
//!
//! The two affiliate lines are the poster's balancer at work — the rule writes
//! the expense in the unit's books and the income in head office's,
//! `kind_for_source` classes this kind as Lain-lain, and the account links
//! resolve Lain-lain to 2030 at a store and 1059 at head office (owner
//! decision 25 Sep, 0380; per unit since 0606). Head office is the unit of
//! kind HO, found by its kind.

use super::poster::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

pub struct ManagementFee {
    pub entry_id: Uuid,
    pub entry_number: String,
    pub total_minor: i64,
}

/// Post one management fee against a unit (a unit id, 0605).
pub async fn management_fee_post(
    pool: &PgPool,
    unit_id: &str,
    amount_minor: i64,
    effective_date: NaiveDate,
    memo: Option<&str>,
    actor: &str,
) -> Result<ManagementFee, AppError> {
    if amount_minor <= 0 {
        return Err(AppError::Validation(
            "a management fee must be a positive amount".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let head_office = super::sites::head_office_unit_id(&mut *tx).await?;
    if unit_id == head_office {
        return Err(AppError::Validation(
            "a management fee charges a unit, not head office".into(),
        ));
    }
    if !super::sites::unit_exists(&mut *tx, unit_id).await? {
        return Err(AppError::NotFound(format!("unit {unit_id}")));
    }
    let intent = PostingIntent {
        posting_date: effective_date,
        source_kind: "MANAGEMENT_FEE".into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: "management_fee/1".into(),
        currency: "IDR".into(),
        memo: memo.map(str::to_string),
        lines: vec![
            PostingLine::debit("management_fee_expense", unit_id, amount_minor),
            PostingLine::credit("management_fee_income", &head_office, amount_minor),
        ],
    };
    let posted = post(&mut tx, &intent, None, actor).await?;
    tx.commit().await?;
    Ok(ManagementFee {
        entry_id: posted.entry_id,
        entry_number: posted.entry_number,
        total_minor: posted.total_minor,
    })
}
