//! Head office charging a unit a management fee.
//!
//! Owner decision, 25 Sep (FINANCE-CONNECT-BRIEF.md): the fee is head office's
//! income and the unit's cost, and because the two live in different books it
//! crosses on Lain-lain (1059, two-way). The document is head office's:
//!
//!   unit   Dr 7032 Biaya Management Fee   / Cr 1059 Piutang Affiliasi Lain-lain
//!   HO     Dr 1059 Piutang Affiliasi …    / Cr 4016 Management Fee
//!
//! The two unit lines are the poster's balancer at work — the rule writes the
//! expense at the unit and the income at head office, and `kind_for_source`
//! classes this kind as Lain-lain, which is what picks 1059 on both sides.

use super::poster::{post, PostingIntent, PostingLine, HEAD_OFFICE_SITE};
use crate::cloud::application::AppError;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

pub struct ManagementFee {
    pub entry_id: Uuid,
    pub entry_number: String,
    pub total_minor: i64,
}

/// Post one management fee against a unit.
pub async fn management_fee_post(
    pool: &PgPool,
    unit_site_id: &str,
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
    if unit_site_id == HEAD_OFFICE_SITE {
        return Err(AppError::Validation(
            "a management fee charges a unit, not head office".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let intent = PostingIntent {
        posting_date: effective_date,
        source_kind: "MANAGEMENT_FEE".into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: "management_fee/1".into(),
        currency: "IDR".into(),
        memo: memo.map(str::to_string),
        lines: vec![
            PostingLine::debit("management_fee_expense", unit_site_id, amount_minor),
            PostingLine::credit("management_fee_income", HEAD_OFFICE_SITE, amount_minor),
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
