//! The Gudang in the cloud: returns and counts (DC-CLOUD-NATIVE.md).
//!
//! Four pieces of work, each the DC server's own, done here against the
//! cloud's tables:
//!
//! - **a shop's return, received blind** (`/api/v1/dc/inbound*`,
//!   `returns_inbound.rs`): the manifest is the shop's own IN_TRANSIT fact,
//!   which the cloud already holds — there is no node to announce it to. The
//!   receipt books what was found into that shop's return pool here, files a
//!   RECEIVED claim per piece (which pairs with the shop's IN_TRANSIT claim
//!   and tells the shop's node to let go of it), and moves the flow;
//! - **inspection** (`/api/v1/dc/inspections`, `…/inspection`,
//!   `returns_inspect.rs`): good goods out of the return pool onto the racks,
//!   damaged ones to reject;
//! - **purchase returns** (`/api/v1/dc/purchase-returns*`,
//!   `returns_supplier.rs`): an order's excess handed to the supplier, out of
//!   the Unidentified pool, closing the return in the same transaction;
//! - **official counts** (`/api/v1/dc/official-counts*`,
//!   `returns_counts.rs`): the Gudang's counts already run in the cloud when no
//!   node owns the site; these routes show them in the DC server's shape and
//!   hand the handheld's entries and submit to the cloud's own count code.
//!
//! Everything the DC server reported as a fact is written by the applier
//! that fact reached, under [`common::CLOUD_DC_ORIGIN`].

use super::common;
use crate::cloud::domain::{validate_command, MovementCommand};
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use axum::{
    routing::{get, post},
    Router,
};
use chrono::{DateTime, SecondsFormat, Utc};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[path = "returns_counts.rs"]
mod counts;
#[path = "returns_inbound.rs"]
mod inbound;
#[path = "returns_inspect.rs"]
mod inspect;
#[path = "returns_supplier.rs"]
mod supplier;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/dc/inbound", get(inbound::list))
        .route("/api/v1/dc/inbound/{delivery_id}", get(inbound::detail))
        .route(
            "/api/v1/dc/inbound/{delivery_id}/receive",
            post(inbound::receive),
        )
        .route(
            "/api/v1/dc/inbound/{delivery_id}/receive-count",
            post(inbound::receive_count),
        )
        .route("/api/v1/dc/inspections", get(inspect::list))
        .route(
            "/api/v1/dc/inbound/{delivery_id}/inspection",
            get(inspect::detail).post(inspect::inspect),
        )
        .route("/api/v1/dc/purchase-returns", get(supplier::list))
        .route(
            "/api/v1/dc/purchase-returns/note",
            post(supplier::generate_note),
        )
        .route(
            "/api/v1/dc/purchase-returns/{return_id}/hand-over",
            post(supplier::hand_over),
        )
        .route("/api/v1/dc/official-counts", get(counts::list))
        .route("/api/v1/dc/official-counts/{count_id}", get(counts::detail))
        .route(
            "/api/v1/dc/official-counts/{count_id}/entries",
            post(counts::entries),
        )
        .route(
            "/api/v1/dc/official-counts/{count_id}/submit",
            post(counts::submit),
        )
}

// ---- shared by the four ------------------------------------------------------------

/// Who did it: the signed-in user, whatever the body said (the auth layer
/// already refuses a body naming somebody else).
fn actor_of(principal: &Principal) -> Result<String, AppError> {
    let actor = principal.username.trim();
    if actor.is_empty() {
        return Err(AppError::Unauthorized(
            "the Gudang's work is done by somebody signed in".into(),
        ));
    }
    Ok(actor.to_owned())
}

/// A request's own key, required: the bay presses buttons twice.
fn require_key(key: &str) -> Result<String, AppError> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    Ok(key.to_owned())
}

/// A tag as the ledger spells it.
fn normalized_epc(value: &str) -> Result<String, AppError> {
    let value = value.trim().to_ascii_uppercase();
    if value.is_empty() {
        return Err(AppError::Validation("EPC is required".into()));
    }
    Ok(value)
}

/// A time as the DC server wrote it into its text columns.
fn time_text(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// Serialise the Gudang's work on one document (a delivery, a return): two
/// presses of the same button wait for each other instead of both booking.
async fn lock_document(
    tx: &mut Transaction<'_, Postgres>,
    kind: &str,
    id: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("dc-{kind}:{id}"))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// One of a site's own pools by role — its stockroom, its reject — the
/// shortest id first, which is the canonical spelling where a legacy one
/// lingers (`{site}.reject` before `{site}.reject.dc`).
async fn site_pool_tx(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
    role: &str,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT id FROM operational_pool
          WHERE site_id = $1 AND role = $2 AND active AND is_placement
            AND origin_unit_id IS NULL
          ORDER BY length(id), id
          LIMIT 1",
    )
    .bind(site_id)
    .bind(role)
    .fetch_optional(&mut **tx)
    .await?)
}

/// The garment a tag names in the cloud's ledger: the subject it always had
/// when the cloud has seen it before (it left, and has come back), else a new
/// UNIT subject of its SKU. `None` when the SKU is not in the catalogue here,
/// so it cannot be booked.
async fn unit_subject_tx(
    tx: &mut Transaction<'_, Postgres>,
    epc: &str,
    sku_code: &str,
) -> Result<Option<Uuid>, AppError> {
    let known: Option<Uuid> = sqlx::query_scalar("SELECT id FROM inventory_subject WHERE epc = $1")
        .bind(epc)
        .fetch_optional(&mut **tx)
        .await?;
    if known.is_some() {
        return Ok(known);
    }
    let sku: Option<Uuid> = sqlx::query_scalar("SELECT id FROM sku WHERE upper(sku_code) = $1")
        .bind(sku_code.trim().to_ascii_uppercase())
        .fetch_optional(&mut **tx)
        .await?;
    let Some(sku) = sku else {
        return Ok(None);
    };
    sqlx::query(
        "INSERT INTO inventory_subject (id, subject_type, sku_id, epc, quantity, uom)
         VALUES ($1, 'UNIT', $2, $3, 1, 'EA')
         ON CONFLICT (epc) DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(sku)
    .bind(epc)
    .execute(&mut **tx)
    .await?;
    Ok(sqlx::query_scalar("SELECT id FROM inventory_subject WHERE epc = $1")
        .bind(epc)
        .fetch_optional(&mut **tx)
        .await?)
}

/// Write one movement group into the cloud's ledger, through the same two
/// writers every cloud movement goes through (`postgres::movements`).
/// `key` is the group's own idempotency key, unique across the ledger.
async fn write_movement(
    tx: &mut Transaction<'_, Postgres>,
    command: &MovementCommand,
    key: &str,
) -> Result<(), AppError> {
    validate_command(command).map_err(|error| AppError::Validation(error.to_string()))?;
    let digest = crate::cloud::postgres::payload_digest(&serde_json::json!({
        "key": key,
        "movement_group_id": command.movement_group_id.0,
        "cause": command.cause.as_str(),
    }))?;
    crate::cloud::postgres::insert_group(tx, command, key, &digest).await?;
    crate::cloud::postgres::apply_lines(tx, command, key, &digest).await?;
    Ok(())
}

/// Every route answers only when this cloud runs the Gudang.
fn hosted() -> Result<(), AppError> {
    common::require_hosted()
}
