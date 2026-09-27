//! Party links — the same party in two registers (ERPNext Party Link).
//!
//! The party's own ACCOUNT (ERPNext Party Account, 0301) became source `PARTY`
//! of `account_link` in 0465; the poster asks it before the company's default.

use uuid::Uuid;

use crate::cloud::application::AppError;
use serde::Serialize;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PartyLinkRow {
    pub link_id: Uuid,
    pub primary_role: String,
    pub primary_party: String,
    pub secondary_role: String,
    pub secondary_party: String,
    pub created_by: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_party_links(pool: &sqlx::PgPool) -> Result<Vec<PartyLinkRow>, AppError> {
    let rows = sqlx::query_as(
        "SELECT link_id, primary_role, primary_party, secondary_role, secondary_party,
                created_by, created_at
           FROM party_link
          ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Link a customer to a supplier. The secondary register is derived — ERPNext's
/// `create_party_link` derives it the same way — and the three ownership
/// refusals of `party_link.py` are the table's own partial unique indexes;
/// this maps whichever tripped onto one sentence.
pub async fn create_party_link(
    pool: &sqlx::PgPool,
    primary_role: &str,
    primary_party: &str,
    secondary_party: &str,
    created_by: &str,
) -> Result<PartyLinkRow, AppError> {
    if primary_role != "SUPPLIER" && primary_role != "CUSTOMER" {
        return Err(AppError::Validation(format!(
            "primary role must be SUPPLIER or CUSTOMER, not {primary_role:?}"
        )));
    }
    let secondary_role = if primary_role == "SUPPLIER" {
        "CUSTOMER"
    } else {
        "SUPPLIER"
    };

    let known: Option<String> =
        sqlx::query_scalar("SELECT party_type FROM party_type WHERE party_type = $1")
            .bind(secondary_role)
            .fetch_optional(pool)
            .await?;
    if known.is_none() {
        return Err(AppError::Validation(
            "the party_type registry has no secondary role row".into(),
        ));
    }

    let result = sqlx::query(
        "INSERT INTO party_link
           (link_id, primary_role, primary_party, secondary_role, secondary_party, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(Uuid::new_v4())
    .bind(primary_role)
    .bind(primary_party.trim())
    .bind(secondary_role)
    .bind(secondary_party.trim())
    .bind(created_by)
    .execute(pool)
    .await;

    if let Err(sqlx::Error::Database(db)) = &result {
        if db
            .constraint()
            .is_some_and(|name| name.contains("party_link"))
        {
            return Err(AppError::Conflict(format!(
                "{primary_role} {primary_party} is already linked, or one side is the primary of \
                 another link — one link per party"
            )));
        }
    }
    result?;

    let rows = sqlx::query_as(
        "SELECT link_id, primary_role, primary_party, secondary_role, secondary_party,
                created_by, created_at
           FROM party_link
          WHERE primary_role = $1 AND primary_party = $2
          ORDER BY created_at DESC LIMIT 1",
    )
    .bind(primary_role)
    .bind(primary_party.trim())
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("the party link just written".into()))
}
