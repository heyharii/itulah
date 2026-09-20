mod accounts;
mod acquirer;
mod allotments;
mod articles;
mod asset_classes;
mod assets;
mod assistant;
mod attendance;
mod audit;
mod auth_policy;
mod bank_rules;
mod banking;
mod basket;
mod batches;
mod campaigns;
mod cash;
mod cash_counts;
mod catalogue;
mod chat;
/// Money a shop took without producing a sale — the queue head office works,
/// because the shop's own Z report balances and nothing looks wrong there.
mod checkout_exceptions;
mod colours;
mod commercial;
mod company_banks;
/// The payroll component catalogue, its ratified rates, and the one-off
/// figures a place files. See `domain::component`.
mod components;
mod control;
mod corrections;
mod counts;
mod coupons;
mod customer;
mod deposits;
mod destinations;
mod discussion;
mod documents;
mod eligibility;
mod employment;
mod enrolment;
mod files;
mod giro;
mod giro_print;
/// A shop asks for an employee it does not have; head office approves, returns
/// it for revision, or rejects. Not a recruitment pipeline — see `domain::hire`.
mod hire;
mod holiday;
mod integrity;
mod interunit;
mod journal;
mod leave;
mod ledger;
mod letters;
mod line_categories;
mod loyalty;
mod member;
mod membership;
mod movements;
mod notifications;
mod observations;
mod opening;
mod overtime;
mod pay;
mod payables;
mod payables_flow;
mod payment_allocation;
mod payment_context;
mod payment_execution;
mod payment_instructions;
mod payment_ledger;
mod payment_terms;
mod payments;
mod performance;
mod period_close;
mod poster;
/// What a shop has charged for one product and when it changed — replayed
/// through the engine's own ranking rather than read off the rows.
/// Pricing changes still scheduled or running — one row per publication,
/// projected from the books themselves rather than stored a second time.
mod price_changes;
mod price_history;
mod pricing;
mod punch;
mod queries;
mod receipts;
mod records;
mod reports;
mod reserves;
mod returns;
/// How far one price book has reached each shop — told, in service, or failed
/// with the shop's own account of why. The three-state evidence 0179 made of
/// the activation table.
mod rollout;
mod roster;
/// A day's takings, carried into the general ledger — the one `source_kind`
/// the schema has always allowed and nothing ever wrote.
mod sale_day;
mod sales;
// lane-A
mod advance;
mod finance_control;
mod financial_statements;
mod financing;
mod prepaid;
mod principal;
mod sales_posting;
mod saved_reports;
mod segments;
mod statement_intake;
mod statements;
mod stock_ledger;
mod store_money;
mod supplier_banks;
mod suppliers;
mod sync;
mod sync_generation;
mod sync_health;
mod tagging;
mod tax;
mod time_machine;
mod transaction_categories;
mod users;
mod vocabulary;
mod vouchers;

pub use accounts::*;
pub use acquirer::*;
pub use allotments::*;
pub use articles::*;
pub use asset_classes::*;
pub use assets::*;
pub use assistant::*;
pub use attendance::*;
pub use audit::*;
pub use auth_policy::*;
pub use bank_rules::*;
pub use banking::*;
pub use basket::*;
pub use batches::*;
pub use campaigns::*;
pub use cash::*;
pub use cash_counts::*;
pub use catalogue::*;
pub use chat::*;
pub use checkout_exceptions::*;
pub use colours::*;
pub use commercial::*;
pub use company_banks::*;
pub use components::*;
pub use control::*;
pub use corrections::*;
pub use counts::*;
pub use coupons::*;
pub use customer::*;
pub use deposits::*;
pub use destinations::*;
pub use discussion::*;
pub use documents::*;
pub use eligibility::*;
pub use employment::*;
pub use enrolment::*;
pub use files::*;
pub use giro::*;
pub use giro_print::*;
pub use hire::*;
pub use holiday::*;
pub use integrity::*;
pub use interunit::*;
pub use journal::*;
pub use leave::*;
pub use ledger::*;
pub use letters::*;
pub use line_categories::*;
pub use loyalty::*;
pub use member::*;
pub use membership::*;
pub use movements::*;
pub use notifications::*;
pub use observations::*;
pub use opening::*;
pub use overtime::*;
pub use pay::*;
pub use payables::*;
pub use payables_flow::*;
pub use payment_allocation::*;
pub use payment_context::*;
pub use payment_instructions::*;
pub use payment_ledger::*;
pub use payment_terms::*;
pub use payments::*;
pub use performance::*;
pub use period_close::*;
pub use poster::*;
pub use price_changes::*;
pub use price_history::*;
pub use pricing::*;
pub use punch::*;
pub use queries::*;
pub use receipts::*;
pub use records::*;
pub use reports::*;
pub use reserves::*;
pub use returns::*;
pub use rollout::*;
pub use roster::*;
pub use sale_day::*;
pub use sales::*;
// lane-A
pub use advance::*;
pub use finance_control::*;
pub use financial_statements::*;
pub use financing::*;
pub use prepaid::*;
pub use principal::*;
pub use sales_posting::*;
pub use saved_reports::*;
pub use segments::*;
pub use statement_intake::*;
pub use statements::*;
pub use stock_ledger::*;
pub use store_money::*;
pub use supplier_banks::*;
pub use suppliers::*;
pub use sync::*;
pub use sync_generation::*;
pub use sync_health::*;
pub use tagging::*;
pub use tax::*;
pub use time_machine::*;
pub use transaction_categories::*;
pub use users::*;
pub use vocabulary::*;
pub use vouchers::*;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/postgres");

use crate::cloud::application::AppError;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

/// A keyset cursor, as the wire carries it: opaque, and issued only here.
///
/// Every paged list in this crate encodes WHERE THE LAST PAGE STOPPED — the
/// natural key of the final row — rather than how far into the answer it got.
/// An offset is a position in a list that is still being edited while somebody
/// reads it, and paging by one silently skips and repeats rows with nothing
/// saying so.
///
/// Hex over JSON, and opaque on purpose. A caller that can read a cursor is a
/// caller that will eventually construct one, and then the shape of the seek
/// is a published interface that cannot be changed without breaking somebody.
/// It survives a URL, a log line and a copy-paste out of an address bar with
/// nothing having to remember to escape it, which base64 does not.
///
/// `money_overview` predates this helper and carries its own copy; the two
/// agree byte for byte, and the older one is left alone rather than edited
/// from here while another lane has that file open.
pub(super) fn encode_cursor<T: Serialize>(value: &T) -> Result<String, AppError> {
    Ok(hex::encode(serde_json::to_vec(value)?))
}

/// The other half. Both failures answer the same sentence deliberately: a
/// cursor that does not decode and a cursor that decodes to the wrong shape
/// are the same mistake from the caller's side — it did not come from here —
/// and naming the internals in the message would only invite somebody to fix
/// their forgery.
pub(super) fn decode_cursor<T: DeserializeOwned>(raw: &str) -> Result<T, AppError> {
    let bytes = hex::decode(raw)
        .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
}

/// A keyset's two spellings of one order: the row expression and the `ORDER BY`.
///
/// They are not interchangeable — `ORDER BY` takes directions and a row
/// expression does not, so `(a ASC, b) > (…)` is a syntax error — and getting
/// them out of step is a class of bug the compiler cannot see, because both are
/// strings spliced into SQL. One function, so a new sort key cannot arrive with
/// only half of it written.
///
/// `tie` is the unique column every order ends in. Without it two rows that
/// compare equal on the lead can repeat or vanish across a page boundary, which
/// is the failure a keyset exists to prevent. When the lead IS the tie-break it
/// is not repeated: `(rule_id, rule_id)` is legal and pointless, and the reader
/// deserves the shorter clause.
///
/// `lead` is a column name this server chose from a closed set, never one a
/// caller sent — every list that calls this matches the caller's `sort` against
/// its own `match` arms first, because a list endpoint that accepts arbitrary
/// column names is a list endpoint that accepts arbitrary SQL.
pub(super) fn order_by(lead: &str, tie: &str, desc: bool) -> (String, String) {
    let dir = if desc { "DESC" } else { "ASC" };
    if lead == tie {
        return (tie.to_owned(), format!("{tie} {dir}"));
    }
    (
        format!("{lead}, {tie}"),
        format!("{lead} {dir}, {tie} {dir}"),
    )
}

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

#[cfg(test)]
mod tests {
    use super::order_by;

    /// The keyset's two clauses, which are not the same string.
    ///
    /// The case worth writing down is the third: when the lead is already the
    /// tie-break, naming it twice is legal SQL that reads as a mistake.
    #[test]
    fn an_order_is_written_once_and_spelled_twice() {
        assert_eq!(
            order_by("name_key", "id", false),
            ("name_key, id".to_owned(), "name_key ASC, id ASC".to_owned())
        );
        assert_eq!(
            order_by("version", "rule_id", true),
            (
                "version, rule_id".to_owned(),
                "version DESC, rule_id DESC".to_owned()
            )
        );
        assert_eq!(
            order_by("rule_id", "rule_id", true),
            ("rule_id".to_owned(), "rule_id DESC".to_owned())
        );
    }
}
