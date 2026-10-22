//! The Gudang in the cloud: packing and dispatch (DC-CLOUD-NATIVE.md).
//!
//! The DC server's outbound half — koli, surat jalan, truck runs — done
//! against the cloud's own tables, answering the DC server's paths with its
//! JSON (`edge::outbound`, `edge::contracts`) so the hub's Packing, Trucks and
//! Board screens run unchanged.
//!
//! What is inside what lives in `dc_koli`, `dc_koli_unit`, `dc_shipment` and
//! `dc_dispatch` (0908). Where the goods stand is the cloud's ledger: a koli's
//! pieces move from the Gudang's pick area through its Packed, Shipment,
//! Loaded and In Transit pools, each movement referenced to the allotment line
//! the piece answers — which is how the cloud's ledger keeps outbound goods
//! (`movements.rs`), and how picking leaves them (`execute_allotment`: one
//! piece in the pick area per line it was fetched for, so a shop's picked
//! goods are the pieces whose line is that shop's).
//!
//! Downstream readers read what a DC server's fulfillment fact left behind
//! (`sync.rs` `apply_fulfillment_progress`): the allotment line's rungs, the
//! koli mirror (`edge_koli`, letters and valuation), the stage facts, the
//! in-transit claims a shop's count is matched against, the shop's blind-count
//! announcement, and the flows. That applier cannot be called as it stands —
//! it checks the fact against a node's mirrored movement and the node's own
//! allotment projection, and a cloud-run allotment has neither — so the same
//! records are written here, in the same shape, under
//! [`common::CLOUD_DC_ORIGIN`], and the announcement goes through the
//! applier's own `announce_store_inbound_tx`. A cloud-run allotment's rungs
//! are its own `allotment_line` columns (no progress row: the commitment view
//! reads the line), so those are what move.
//!
//! When the shop counts a piece in, its claim pairs with the in-transit claim
//! written here; [`reconcile_counted_in_tx`] then does what the release
//! command does at a DC server — lets go of the piece in the Gudang's ledger —
//! and records the shop's receipt on the allotment line.

use crate::cloud::dc::{common, print_bridge};
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use crate::edge::contracts::{AdvanceKoliRequest, DispatchTripRequest, EdgeError, PackRequest};
use crate::edge::outbound::{
    Dispatch, DispatchDetail, Koli, KoliManifest, ListFilter, ManifestLine, PrintKoliLabelRequest,
    Shipment, ShipmentDetail,
};
use crate::edge::printing::LABEL_BRAND;
use crate::edge::zpl::{
    preview_koli_label, render_koli_label, KoliLabelData, LabelBrand, LabelSize,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

#[path = "packing_stages.rs"]
pub(super) mod stages;

pub(crate) use stages::{not_received_in_tx, reconcile_counted_in_tx};
// The move back (`dc/move_back.rs`) takes pieces out of a box with the same
// machinery that put them in, under the same lock.
pub(super) use stages::{lock_outbound, move_pieces, place_of_role, Piece};

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/dc/packs", post(pack))
        .route("/api/v1/dc/koli", get(list_koli))
        .route("/api/v1/dc/koli/{koli_id}", get(koli_manifest))
        .route("/api/v1/dc/koli/{koli_id}/seal", post(seal))
        .route("/api/v1/dc/koli/{koli_id}/label", post(print_label))
        .route(
            "/api/v1/dc/koli/{koli_id}/in-transit",
            post(koli_in_transit),
        )
        .route("/api/v1/dc/dispatch-trips", post(dispatch_trip))
        .route("/api/v1/dc/dispatches", get(list_dispatches))
        .route("/api/v1/dc/dispatches/{dispatch_id}", get(dispatch_detail))
        .route("/api/v1/dc/dispatches/{dispatch_id}/depart", post(depart))
        .route("/api/v1/dc/shipments", get(list_shipments))
        .route("/api/v1/dc/shipments/{shipment_id}", get(shipment_detail))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// Pack a carton from quantities (`edge::sqlite` `pack_by_quantity`): the
/// shop's picked pieces, oldest allotment first, into a new koli — sealed in
/// the same act when the bench asks.
async fn pack(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<PackRequest>,
) -> Result<(StatusCode, Json<KoliManifest>), AppError> {
    common::require_hosted()?;
    let koli_id = stages::pack(&state, &principal.username, request).await?;
    let mut connection = state.db.acquire().await?;
    let manifest = manifest(&mut connection, koli_id, LabelSize::default()).await?;
    Ok((StatusCode::CREATED, Json(manifest)))
}

async fn list_koli(
    State(state): State<AppState>,
    Query(filter): Query<ListFilter>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    // A carton a move back emptied is no carton any more.
    let mut sql = format!("{KOLI_SELECT} WHERE k.voided_at IS NULL");
    if filter.unassigned {
        sql.push_str(" AND k.shipment_id IS NULL");
    }
    if filter.ready {
        sql.push_str(" AND k.sealed_at IS NOT NULL");
    }
    sql.push_str(" ORDER BY k.koli_number");
    let rows = sqlx::query(&sql).fetch_all(&state.db).await?;
    let items = rows
        .iter()
        .map(koli_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(serde_json::json!({ "items": items })))
}

/// What is in the box, and what its sticker says.
async fn koli_manifest(
    State(state): State<AppState>,
    Path(koli_id): Path<String>,
) -> Result<Json<KoliManifest>, AppError> {
    common::require_hosted()?;
    let koli_id = parse_id(&koli_id, "koli")?;
    let mut connection = state.db.acquire().await?;
    Ok(Json(
        manifest(&mut connection, koli_id, LabelSize::default()).await?,
    ))
}

/// Close the box. From here its contents are final.
async fn seal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(koli_id): Path<String>,
) -> Result<Json<KoliManifest>, AppError> {
    common::require_hosted()?;
    let koli_id = parse_id(&koli_id, "koli")?;
    stages::seal(&state, koli_id, &principal.username).await?;
    let mut connection = state.db.acquire().await?;
    Ok(Json(
        manifest(&mut connection, koli_id, LabelSize::default()).await?,
    ))
}

/// Render the box's sticker on the stock the bench holds and put it on the
/// printer — through the warehouse's print bridge for `bridge:<name>`.
async fn print_label(
    State(state): State<AppState>,
    Path(koli_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<KoliManifest>, AppError> {
    common::require_hosted()?;
    let koli_id = parse_id(&koli_id, "koli")?;
    // A DC server can look a printer up by id in its own device list; the
    // cloud has none, so the bench names the address it prints to.
    let request: PrintKoliLabelRequest = serde_json::from_value(body).map_err(|error| {
        AppError::Validation(format!(
            "invalid print request: {error}; name the printer's address (printer_host)"
        ))
    })?;
    if request.printer_host.trim().is_empty() {
        return Err(AppError::Validation("printer host is required".into()));
    }
    let manifest = {
        let mut connection = state.db.acquire().await?;
        manifest(&mut connection, koli_id, request.label_size()).await?
    };
    print_bridge::deliver(
        &request.printer_host,
        request.printer_port,
        manifest.label_zpl.as_bytes(),
    )
    .await?;
    Ok(Json(manifest))
}

/// One koli onto the road (`edge::sqlite` `mark_fulfillment_in_transit`): the
/// step a run made the old way — loaded, then departed — still owes.
async fn koli_in_transit(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(koli_id): Path<String>,
    Json(_request): Json<AdvanceKoliRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    common::require_hosted()?;
    let koli_id = parse_id(&koli_id, "koli")?;
    let result = stages::koli_in_transit(&state, koli_id, &principal.username).await?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(result)?)))
}

/// Dispatch: sealed cartons onto one trip, in one act — one surat jalan per
/// shop, the truck run, and the goods in transit (`edge::sqlite`
/// `dispatch_trip`).
async fn dispatch_trip(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<DispatchTripRequest>,
) -> Result<(StatusCode, Json<DispatchDetail>), AppError> {
    common::require_hosted()?;
    let dispatch_id = stages::dispatch_trip(&state, &principal.username, request).await?;
    let mut connection = state.db.acquire().await?;
    Ok((
        StatusCode::CREATED,
        Json(dispatch_detail_of(&mut connection, dispatch_id).await?),
    ))
}

async fn list_dispatches(
    State(state): State<AppState>,
    Query(filter): Query<ListFilter>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let mut sql = format!("{DISPATCH_SELECT} WHERE TRUE");
    if filter.ready {
        // Still on the yard: a departed truck is history, not a choice.
        sql.push_str(" AND d.departed_at IS NULL");
    }
    sql.push_str(" ORDER BY d.dispatch_number DESC");
    let rows = sqlx::query(&sql).fetch_all(&state.db).await?;
    let items = rows
        .iter()
        .map(dispatch_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(serde_json::json!({ "items": items })))
}

/// The loading manifest: one truck run and every surat jalan on it.
async fn dispatch_detail(
    State(state): State<AppState>,
    Path(dispatch_id): Path<String>,
) -> Result<Json<DispatchDetail>, AppError> {
    common::require_hosted()?;
    let dispatch_id = parse_id(&dispatch_id, "dispatch")?;
    let mut connection = state.db.acquire().await?;
    Ok(Json(
        dispatch_detail_of(&mut connection, dispatch_id).await?,
    ))
}

/// The truck leaves (`edge::outbound` `depart_dispatch`). Once.
async fn depart(
    State(state): State<AppState>,
    Path(dispatch_id): Path<String>,
) -> Result<Json<Dispatch>, AppError> {
    common::require_hosted()?;
    let dispatch_id = parse_id(&dispatch_id, "dispatch")?;
    stages::depart(&state, dispatch_id).await?;
    let mut connection = state.db.acquire().await?;
    Ok(Json(load_dispatch(&mut connection, dispatch_id).await?))
}

async fn list_shipments(
    State(state): State<AppState>,
    Query(filter): Query<ListFilter>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let mut sql = format!("{SHIPMENT_SELECT} WHERE TRUE");
    if filter.unassigned {
        sql.push_str(" AND s.dispatch_id IS NULL");
    }
    sql.push_str(" ORDER BY s.shipment_number");
    let rows = sqlx::query(&sql).fetch_all(&state.db).await?;
    let items = rows
        .iter()
        .map(shipment_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(serde_json::json!({ "items": items })))
}

/// The surat jalan: one shop's koli, and what is in them.
async fn shipment_detail(
    State(state): State<AppState>,
    Path(shipment_id): Path<String>,
) -> Result<Json<ShipmentDetail>, AppError> {
    common::require_hosted()?;
    let shipment_id = parse_id(&shipment_id, "shipment")?;
    let mut connection = state.db.acquire().await?;
    let shipment = load_shipment(&mut connection, shipment_id).await?;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT koli_id FROM dc_koli
          WHERE shipment_id = $1 AND voided_at IS NULL
          ORDER BY koli_number",
    )
    .bind(shipment_id)
    .fetch_all(&mut *connection)
    .await?;
    let mut koli = Vec::with_capacity(ids.len());
    for id in ids {
        koli.push(manifest(&mut connection, id, LabelSize::default()).await?);
    }
    // Scanned at the shop to open the whole consignment at once.
    let qr_payload = format!("S1:{}", shipment.shipment_number);
    let qr_svg = crate::edge::outbound::qr_svg(&qr_payload).map_err(edge_error)?;
    Ok(Json(ShipmentDetail {
        shipment,
        qr_payload,
        qr_svg,
        koli,
    }))
}

// ---------------------------------------------------------------------------
// Reading what is inside what
// ---------------------------------------------------------------------------

/// A koli, its position derived from containment and never stored (the DC
/// server's `load_koli`). The shop is printed by its display code.
const KOLI_SELECT: &str = "
    SELECT k.koli_id, k.koli_number, k.destination_store_id, k.shipment_id,
           k.sealed_at, k.sealed_by,
           (SELECT count(*) FROM dc_koli_unit u WHERE u.koli_id = k.koli_id)::bigint AS unit_count,
           CASE
               WHEN k.shipment_id IS NULL THEN 'PACKED'
               WHEN s.dispatch_id IS NULL THEN 'SHIPMENT'
               WHEN d.departed_at IS NULL THEN 'LOADED'
               ELSE 'IN_TRANSIT'
           END AS position,
           COALESCE(shop.code, k.destination_store_id) AS destination_code
      FROM dc_koli k
      LEFT JOIN dc_shipment s ON s.shipment_id = k.shipment_id
      LEFT JOIN dc_dispatch d ON d.dispatch_id = s.dispatch_id
      LEFT JOIN site shop ON shop.id = k.destination_store_id";

const SHIPMENT_SELECT: &str = "
    SELECT s.shipment_id, s.shipment_number, s.destination_store_id, s.dispatch_id,
           (SELECT count(*) FROM dc_koli k
             WHERE k.shipment_id = s.shipment_id AND k.voided_at IS NULL)::bigint AS koli_count,
           (SELECT count(*) FROM dc_koli_unit u JOIN dc_koli k ON k.koli_id = u.koli_id
             WHERE k.shipment_id = s.shipment_id)::bigint AS unit_count,
           CASE
               WHEN s.dispatch_id IS NULL THEN 'SHIPMENT'
               WHEN d.departed_at IS NULL THEN 'LOADED'
               ELSE 'IN_TRANSIT'
           END AS position,
           COALESCE(shop.code, s.destination_store_id) AS destination_code
      FROM dc_shipment s
      LEFT JOIN dc_dispatch d ON d.dispatch_id = s.dispatch_id
      LEFT JOIN site shop ON shop.id = s.destination_store_id";

/// A truck run. Received is counted from the shop's matched counts (the
/// pairs `reconcile_counted_in_tx` records), as the DC server counts it from
/// the releases head office sends it.
const DISPATCH_SELECT: &str = "
    SELECT d.dispatch_id, d.dispatch_number, d.carrier, d.vehicle_plate, d.driver_name,
           d.trip_note, d.departed_at,
           (SELECT count(*) FROM dc_shipment s WHERE s.dispatch_id = d.dispatch_id)::bigint
               AS shipment_count,
           (SELECT count(*) FROM dc_koli k JOIN dc_shipment s ON s.shipment_id = k.shipment_id
             WHERE s.dispatch_id = d.dispatch_id AND k.voided_at IS NULL)::bigint AS koli_count,
           (SELECT count(*) FROM dc_koli_unit u
              JOIN dc_koli k ON k.koli_id = u.koli_id
              JOIN dc_shipment s ON s.shipment_id = k.shipment_id
             WHERE s.dispatch_id = d.dispatch_id)::bigint AS unit_count,
           (SELECT count(*) FROM dc_koli_unit u
              JOIN dc_koli k ON k.koli_id = u.koli_id
              JOIN dc_shipment s ON s.shipment_id = k.shipment_id
              JOIN edge_transfer_allotment_attribution a
                ON a.koli_id = u.koli_id AND a.epc = u.epc
             WHERE s.dispatch_id = d.dispatch_id)::bigint AS received_unit_count,
           (SELECT max(a.matched_at) FROM edge_transfer_allotment_attribution a
              JOIN dc_koli k ON k.koli_id = a.koli_id
              JOIN dc_shipment s ON s.shipment_id = k.shipment_id
             WHERE s.dispatch_id = d.dispatch_id) AS last_received_at
      FROM dc_dispatch d";

fn time_text(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn koli_from_row(row: &PgRow) -> Result<Koli, AppError> {
    Ok(Koli {
        koli_id: row.try_get::<Uuid, _>("koli_id")?.to_string(),
        koli_number: row.try_get("koli_number")?,
        destination_store_id: row.try_get("destination_store_id")?,
        destination_code: row.try_get("destination_code")?,
        packing_session_id: None,
        shipment_id: row
            .try_get::<Option<Uuid>, _>("shipment_id")?
            .map(|id| id.to_string()),
        sealed_at: row
            .try_get::<Option<DateTime<Utc>>, _>("sealed_at")?
            .map(time_text),
        sealed_by: row.try_get("sealed_by")?,
        position: row.try_get("position")?,
        unit_count: row.try_get("unit_count")?,
    })
}

fn shipment_from_row(row: &PgRow) -> Result<Shipment, AppError> {
    Ok(Shipment {
        shipment_id: row.try_get::<Uuid, _>("shipment_id")?.to_string(),
        shipment_number: row.try_get("shipment_number")?,
        destination_store_id: row.try_get("destination_store_id")?,
        destination_code: row.try_get("destination_code")?,
        dispatch_id: row
            .try_get::<Option<Uuid>, _>("dispatch_id")?
            .map(|id| id.to_string()),
        koli_count: row.try_get("koli_count")?,
        unit_count: row.try_get("unit_count")?,
        position: row.try_get("position")?,
    })
}

fn dispatch_from_row(row: &PgRow) -> Result<Dispatch, AppError> {
    let unit_count: i64 = row.try_get("unit_count")?;
    let received_unit_count: i64 = row.try_get("received_unit_count")?;
    let last_received: Option<DateTime<Utc>> = row.try_get("last_received_at")?;
    Ok(Dispatch {
        dispatch_id: row.try_get::<Uuid, _>("dispatch_id")?.to_string(),
        dispatch_number: row.try_get("dispatch_number")?,
        carrier: row.try_get("carrier")?,
        vehicle_plate: row.try_get("vehicle_plate")?,
        driver_name: row.try_get("driver_name")?,
        trip_note: row.try_get("trip_note")?,
        departed_at: row
            .try_get::<Option<DateTime<Utc>>, _>("departed_at")?
            .map(time_text),
        shipment_count: row.try_get("shipment_count")?,
        koli_count: row.try_get("koli_count")?,
        unit_count,
        received_unit_count,
        // Received once every piece has been counted in; on the road until.
        received_at: (unit_count > 0 && received_unit_count >= unit_count)
            .then_some(last_received)
            .flatten()
            .map(time_text),
    })
}

async fn load_koli(connection: &mut PgConnection, koli_id: Uuid) -> Result<Koli, AppError> {
    // A carton a move back emptied has no manifest and no label.
    let row = sqlx::query(&format!(
        "{KOLI_SELECT} WHERE k.koli_id = $1 AND k.voided_at IS NULL"
    ))
        .bind(koli_id)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("koli {koli_id}")))?;
    koli_from_row(&row)
}

async fn load_shipment(
    connection: &mut PgConnection,
    shipment_id: Uuid,
) -> Result<Shipment, AppError> {
    let row = sqlx::query(&format!("{SHIPMENT_SELECT} WHERE s.shipment_id = $1"))
        .bind(shipment_id)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("shipment {shipment_id}")))?;
    shipment_from_row(&row)
}

async fn load_dispatch(
    connection: &mut PgConnection,
    dispatch_id: Uuid,
) -> Result<Dispatch, AppError> {
    let row = sqlx::query(&format!("{DISPATCH_SELECT} WHERE d.dispatch_id = $1"))
        .bind(dispatch_id)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("dispatch {dispatch_id}")))?;
    dispatch_from_row(&row)
}

async fn dispatch_detail_of(
    connection: &mut PgConnection,
    dispatch_id: Uuid,
) -> Result<DispatchDetail, AppError> {
    let dispatch = load_dispatch(connection, dispatch_id).await?;
    let rows = sqlx::query(&format!(
        "{SHIPMENT_SELECT} WHERE s.dispatch_id = $1 ORDER BY s.shipment_number"
    ))
    .bind(dispatch_id)
    .fetch_all(&mut *connection)
    .await?;
    let shipments = rows
        .iter()
        .map(shipment_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(DispatchDetail {
        dispatch,
        shipments,
    })
}

/// What is in the box and the label for it, drawn on the stock the caller
/// says the bench holds — rendered by the DC server's own label code, so the
/// sticker is the one a DC server would print.
async fn manifest(
    connection: &mut PgConnection,
    koli_id: Uuid,
    size: LabelSize,
) -> Result<KoliManifest, AppError> {
    let koli = load_koli(connection, koli_id).await?;
    let lines = sqlx::query(
        "SELECT sku_code, allotment_id, allotment_line_id, count(*)::bigint AS quantity
           FROM dc_koli_unit WHERE koli_id = $1
          GROUP BY sku_code, allotment_id, allotment_line_id
          ORDER BY sku_code, allotment_id, allotment_line_id",
    )
    .bind(koli_id)
    .fetch_all(&mut *connection)
    .await?
    .iter()
    .map(|row| -> Result<ManifestLine, AppError> {
        Ok(ManifestLine {
            sku_code: row.try_get("sku_code")?,
            allotment_id: row.try_get::<Uuid, _>("allotment_id")?.to_string(),
            allotment_line_id: row.try_get::<Uuid, _>("allotment_line_id")?.to_string(),
            quantity: row.try_get("quantity")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let qr_payload = format!("K1:{}", koli.koli_number);
    let (label_zpl, label_svg) = {
        let label = KoliLabelData {
            koli_number: &koli.koli_number,
            destination_store_id: &koli.destination_code,
            unit_count: koli.unit_count,
            sealed_at: koli.sealed_at.as_deref(),
        };
        (
            render_koli_label(&label, size, LabelBrand(LABEL_BRAND)),
            preview_koli_label(&label, size, LabelBrand(LABEL_BRAND)),
        )
    };
    let qr_svg = crate::edge::outbound::qr_svg(&qr_payload).map_err(edge_error)?;
    Ok(KoliManifest {
        koli,
        qr_payload,
        qr_svg,
        label_zpl,
        label_svg,
        lines,
    })
}

fn parse_id(value: &str, what: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(value.trim()).map_err(|_| AppError::NotFound(format!("{what} {value}")))
}

/// The DC server's own helpers (numbering, QR) answer in its error type.
fn edge_error(error: EdgeError) -> AppError {
    match error {
        EdgeError::Validation(message) => AppError::Validation(message),
        EdgeError::NotFound(message) => AppError::NotFound(message),
        EdgeError::Conflict(message) => AppError::Conflict(message),
        other => AppError::Configuration(other.to_string()),
    }
}
