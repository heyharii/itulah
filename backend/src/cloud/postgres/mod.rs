mod allotments;
mod articles;
mod assets;
mod assistant;
mod accounts;
mod attendance;
mod audit;
mod auth_policy;
mod banking;
mod basket;
mod catalogue;
mod chat;
mod colours;
mod commercial;
mod control;
mod counts;
mod customer;
mod discussion;
mod documents;
mod employment;
mod files;
mod holiday;
mod journal;
mod leave;
mod ledger;
mod member;
mod membership;
mod movements;
mod notifications;
mod observations;
mod overtime;
mod pay;
mod payables;
mod payments;
mod performance;
mod poster;
mod pricing;
mod queries;
mod receipts;
mod reports;
mod returns;
mod roster;
mod sales;
// lane-A
mod sales_posting;
mod saved_reports;
mod segments;
mod statements;
mod suppliers;
mod sync;
mod tagging;
mod time_machine;
mod users;
mod vocabulary;
mod vouchers;

pub use allotments::*;
pub use articles::*;
pub use assets::*;
pub use assistant::*;
pub use accounts::*;
pub use attendance::*;
pub use audit::*;
pub use auth_policy::*;
pub use banking::*;
pub use basket::*;
pub use catalogue::*;
pub use chat::*;
pub use colours::*;
pub use commercial::*;
pub use control::*;
pub use counts::*;
pub use customer::*;
pub use discussion::*;
pub use documents::*;
pub use employment::*;
pub use files::*;
pub use holiday::*;
pub use journal::*;
pub use leave::*;
pub use ledger::*;
pub use member::*;
pub use membership::*;
pub use movements::*;
pub use notifications::*;
pub use observations::*;
pub use overtime::*;
pub use pay::*;
pub use payables::*;
pub use payments::*;
pub use performance::*;
pub use poster::*;
pub use pricing::*;
pub use queries::*;
pub use receipts::*;
pub use reports::*;
pub use returns::*;
pub use roster::*;
pub use sales::*;
// lane-A
pub use sales_posting::*;
pub use saved_reports::*;
pub use segments::*;
pub use statements::*;
pub use suppliers::*;
pub use sync::*;
pub use tagging::*;
pub use time_machine::*;
pub use users::*;
pub use vocabulary::*;
pub use vouchers::*;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/postgres");

use crate::cloud::application::AppError;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

pub fn payload_digest<T: Serialize>(payload: &T) -> Result<String, AppError> {
    let bytes = serde_json::to_vec(payload)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

pub(super) async fn begin_idempotent(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
    command_type: &str,
    digest: &str,
) -> Result<Option<Value>, AppError> {
    if key.trim().is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    let inserted = sqlx::query(
        "INSERT INTO command_deduplication (idempotency_key, command_type, payload_digest) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING"
    ).bind(key).bind(command_type).bind(digest).execute(&mut **tx).await?.rows_affected() == 1;
    if inserted {
        return Ok(None);
    }
    let row = sqlx::query("SELECT command_type, payload_digest, response_json FROM command_deduplication WHERE idempotency_key=$1")
        .bind(key).fetch_one(&mut **tx).await?;
    let existing_type: String = row.try_get("command_type")?;
    let existing_digest: String = row.try_get("payload_digest")?;
    if existing_type != command_type || existing_digest != digest {
        return Err(AppError::Conflict(
            "idempotency key was already used with a different command or payload".into(),
        ));
    }
    let response: Option<Value> = row.try_get("response_json")?;
    response.map(Some).ok_or_else(|| {
        AppError::Conflict("matching command is still in progress; retry shortly".into())
    })
}

pub(super) async fn complete_idempotent(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
    response: &Value,
) -> Result<(), AppError> {
    sqlx::query("UPDATE command_deduplication SET response_json=$2 WHERE idempotency_key=$1 AND response_json IS NULL")
        .bind(key).bind(response).execute(&mut **tx).await?;
    Ok(())
}

pub(super) async fn resolve_subject(
    tx: &mut Transaction<'_, Postgres>,
    subject_id: Option<Uuid>,
    epc: Option<&str>,
    lock: bool,
) -> Result<Uuid, AppError> {
    if subject_id.is_none() && epc.map(str::trim).filter(|v| !v.is_empty()).is_none() {
        return Err(AppError::Validation("subject_id or epc is required".into()));
    }
    let lock_clause = if lock { " FOR UPDATE" } else { "" };
    let row = if let Some(id) = subject_id {
        sqlx::query(&format!(
            "SELECT id FROM inventory_subject WHERE id=$1{lock_clause}"
        ))
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
    } else {
        sqlx::query(&format!(
            "SELECT id FROM inventory_subject WHERE epc=$1{lock_clause}"
        ))
        .bind(epc.unwrap_or_default().trim().to_ascii_uppercase())
        .fetch_optional(&mut **tx)
        .await?
    };
    row.map(|r| r.get::<Uuid, _>("id"))
        .ok_or_else(|| AppError::NotFound("inventory subject".into()))
}
