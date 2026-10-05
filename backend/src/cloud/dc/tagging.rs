//! The Gudang in the cloud: tagging and label printing (DC-CLOUD-NATIVE.md).
//!
//! The same routes and JSON as a DC server's (`edge::http`, `edge::printing`,
//! `edge::contracts`), against the cloud's own tables:
//!
//! - the print list is `tagging_job` itself, with each line's EPCs derived
//!   from the serial range the centre minted (0023), by the centre's codec;
//! - a print run is `dc_print_session` / `dc_print_item` (0903), claimed a
//!   chunk at a time, rendered by the DC server's own ZPL/TSPL code
//!   (`edge::zpl`) and handed to the warehouse printer through
//!   [`print_bridge::deliver`];
//! - the goods become units when the job is issued
//!   ([`stock_issued_job_tx`], called from `postgres::tagging`), exactly when
//!   a DC server made them units — when the job arrived there;
//! - confirming the labels are on the goods goes through the applier the DC
//!   server's `tagging.completed` fact went through, and resumes the order's
//!   flow the same way.

use super::{common, print_bridge};
use crate::cloud::domain::encode_epc_range;
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use crate::edge::contracts::{
    EdgeError, TaggingConfirmRequest, TaggingConfirmResult, TaggingWorkJob, TaggingWorkLine,
};
use crate::edge::domain::inventory::{
    InventoryState, MovementCause, MovementCommand, MovementGroupId, MovementLine,
    OperationalPool, Place, SiteId, SubjectId, SystemPlace,
};
use crate::edge::printing::{
    self as edge_printing, ClaimedLabel, LabelPreview, LabelPreviewRequest,
    OpenPrintSessionRequest, PrintChunkReport, PrintOutcomeRecord, PrintSessionSummary,
    PrinterProbe, RepointPrinterRequest, ReprintRequest, DEFAULT_CHUNK_SIZE, LABEL_BRAND,
};
use crate::edge::zpl::{
    machine_prelude, preview_label, render_label_in, LabelBrand, LabelData, LabelSize,
    PrinterLanguage,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgConnection, PgPool, Postgres, Row, Transaction};
use std::time::Instant;
use uuid::Uuid;

/// A label claimed this long ago and never reported belongs to a run that
/// died with the process (a restart mid-chunk). It is offered again rather
/// than left claimed for ever. Long enough that no live chunk is mistaken
/// for a dead one: a thousand labels through the bridge finish well inside.
const STALE_CLAIM: &str = "30 minutes";

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/dc/tagging-jobs", get(open_tagging_jobs))
        .route("/api/v1/dc/tagging-confirmations", post(confirm_tagging))
        .route(
            "/api/v1/dc/tagging-jobs/{job_id}/print-session",
            get(job_print_session),
        )
        .route(
            "/api/v1/dc/tagging-jobs/{job_id}/label-preview",
            post(preview_job_label),
        )
        .route("/api/v1/dc/print-sessions", post(open_print_session))
        .route("/api/v1/dc/print-sessions/{session_id}", get(print_session))
        .route(
            "/api/v1/dc/print-sessions/{session_id}/run",
            post(run_print_chunk),
        )
        .route(
            "/api/v1/dc/print-sessions/{session_id}/printer",
            post(repoint_print_session),
        )
        .route(
            "/api/v1/dc/print-sessions/{session_id}/reprint",
            post(reprint_labels),
        )
        .route("/api/v1/dc/printer/test", post(test_printer))
}

// ---- small translations ---------------------------------------------------

/// The DC server's printing code speaks `EdgeError`; the routes speak
/// `AppError`. Same meanings, same status codes.
fn edge_error(error: EdgeError) -> AppError {
    match error {
        EdgeError::Validation(message) => AppError::Validation(message),
        EdgeError::NotFound(message) => AppError::NotFound(message),
        EdgeError::Conflict(message) => AppError::Conflict(message),
        EdgeError::Forbidden(message) => AppError::Forbidden(message),
        EdgeError::Unauthorized(message) => AppError::Unauthorized(message),
        EdgeError::Configuration(message)
        | EdgeError::Upstream(message)
        | EdgeError::Persistence(message) => AppError::Configuration(message),
    }
}

/// What went wrong, as a sentence for the label's `last_error` — without the
/// "conflict: " a status code would add.
fn said(error: AppError) -> String {
    match error {
        AppError::Configuration(message)
        | AppError::Validation(message)
        | AppError::Unprocessable(message)
        | AppError::NotFound(message)
        | AppError::Conflict(message)
        | AppError::Forbidden(message)
        | AppError::Unauthorized(message) => message,
        other => other.to_string(),
    }
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(db) if db.code().as_deref() == Some("23505"))
}

fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// A print request as the type its handler expects. A body that does not fit
/// is the caller's mistake, said so.
fn print_request<T: serde::de::DeserializeOwned>(body: Value) -> Result<T, AppError> {
    serde_json::from_value(body)
        .map_err(|error| AppError::Validation(format!("invalid print request: {error}")))
}

/// A print request may name a printer from the device register instead of
/// typing its address (the DC server's `printer_id`). Here the register is
/// the cloud's `device` (0604): a network printer's host and port are in its
/// `config`.
async fn with_recorded_printer(db: &PgPool, mut body: Value) -> Result<Value, AppError> {
    let printer_id = body
        .get("printer_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned);
    let Some(printer_id) = printer_id else {
        return Ok(body);
    };
    let row = sqlx::query(
        "SELECT label, status, config->>'host' AS host, config->>'port' AS port
           FROM device WHERE device_id = $1 AND kind = 'PRINTER'",
    )
    .bind(&printer_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("printer {printer_id}")))?;
    let label: String = row.get("label");
    let status: String = row.get("status");
    if status != "ACTIVE" {
        return Err(AppError::Conflict(format!(
            "{label} is {}; choose another printer",
            status.to_ascii_lowercase()
        )));
    }
    let host: String = row
        .get::<Option<String>, _>("host")
        .filter(|host| !host.trim().is_empty())
        .ok_or_else(|| AppError::Conflict(format!("{label} has no address on record")))?;
    let port: u16 = row
        .get::<Option<String>, _>("port")
        .and_then(|port| port.trim().parse().ok())
        .unwrap_or(9100);
    if let Value::Object(fields) = &mut body {
        fields.insert("printer_host".into(), Value::String(host));
        fields.insert("printer_port".into(), Value::from(port));
    }
    Ok(body)
}

/// A printer the cloud would open directly must resolve, and not to an
/// address a printer is never at — link-local is where cloud metadata lives,
/// and this address is typed by an operator. The DC server's own guard. A
/// bridge address is a name, not a socket, and passes.
async fn check_printer_address(host: &str, port: u16) -> Result<(), AppError> {
    let host = host.trim().to_owned();
    if host.is_empty() {
        return Err(AppError::Validation("printer host is required".into()));
    }
    if print_bridge::bridge_name(&host).is_some() {
        return Ok(());
    }
    tokio::task::spawn_blocking(move || {
        edge_printing::resolve_printer(&host, port).map(|_| ())
    })
    .await
    .map_err(|error| AppError::Configuration(format!("printer check stopped: {error}")))?
    .map_err(edge_error)
}

// ---- the job as the Gudang reads it -----------------------------------------

struct JobLine {
    sku_code: String,
    colour_label: String,
    size_label: String,
    quantity: i64,
    qr_payload: String,
    barcode_payload: String,
    base_price_minor: i64,
    /// Lowest serial first, which for one SKU is also string order.
    epcs: Vec<String>,
}

/// The EPCs of one line: derived from the range the centre minted, by the
/// centre's codec. Never stored, never computed any other way (0023).
fn line_epcs(sku_code: &str, serial_from: i64, quantity: i64) -> Result<Vec<String>, AppError> {
    let start = u64::try_from(serial_from)
        .map_err(|_| AppError::Validation(format!("line {sku_code} has a negative serial")))?;
    let count = u64::try_from(quantity)
        .map_err(|_| AppError::Validation(format!("line {sku_code} has a negative quantity")))?;
    let mut epcs = encode_epc_range(sku_code, start, count).map_err(AppError::Validation)?;
    epcs.sort();
    Ok(epcs)
}

async fn job_lines(conn: &mut PgConnection, job_id: Uuid) -> Result<Vec<JobLine>, AppError> {
    let rows = sqlx::query(
        "SELECT sku_code, colour_label, size_label, quantity, serial_from, qr_payload,
                barcode_payload, base_price_minor
           FROM tagging_job_line WHERE job_id = $1 ORDER BY sku_code",
    )
    .bind(job_id)
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            let sku_code = row.get::<String, _>("sku_code").trim().to_owned();
            let quantity: i64 = row.get("quantity");
            let epcs = line_epcs(&sku_code, row.get("serial_from"), quantity)?;
            Ok(JobLine {
                colour_label: row.get("colour_label"),
                size_label: row.get("size_label"),
                quantity,
                qr_payload: row.get("qr_payload"),
                barcode_payload: row.get("barcode_payload"),
                base_price_minor: row.get("base_price_minor"),
                epcs,
                sku_code,
            })
        })
        .collect()
}

/// The print queue: jobs issued for the Gudang and not yet confirmed, each
/// line carrying its finished EPC strings.
async fn open_tagging_jobs(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let mut conn = state.db.acquire().await?;
    let headers = sqlx::query(
        "SELECT j.job_id, j.article_code, j.article_name, j.image_url, j.total_quantity,
                j.issued_at, o.po_number, o.supplier_name, gl.counted_at
           FROM tagging_job j
           LEFT JOIN article_setup_session s ON s.session_id = j.session_id
           LEFT JOIN goods_receipt_line gl ON gl.receipt_line_id = s.receipt_line_id
           LEFT JOIN purchase_order_line pl ON pl.po_line_id = gl.po_line_id
           LEFT JOIN purchase_order o ON o.purchase_order_id = pl.purchase_order_id
          WHERE j.status = 'ISSUED' AND j.site_id = $1
          ORDER BY j.issued_at",
    )
    .bind(&site)
    .fetch_all(&mut *conn)
    .await?;

    let mut jobs = Vec::with_capacity(headers.len());
    for row in headers {
        let job_id: Uuid = row.get("job_id");
        let lines = job_lines(&mut conn, job_id)
            .await?
            .into_iter()
            .map(|line| TaggingWorkLine {
                sku_code: line.sku_code,
                colour_label: line.colour_label,
                size_label: line.size_label,
                quantity: line.quantity,
                qr_payload: line.qr_payload,
                barcode_payload: line.barcode_payload,
                epcs: line.epcs,
            })
            .collect();
        jobs.push(TaggingWorkJob {
            job_id,
            article_code: row.get("article_code"),
            article_name: row.get("article_name"),
            image_url: row.get("image_url"),
            total_quantity: row.get("total_quantity"),
            issued_at: stamp(row.get("issued_at")),
            po_number: row.get("po_number"),
            supplier_name: row.get("supplier_name"),
            delivered_at: row
                .get::<Option<DateTime<Utc>>, _>("counted_at")
                .map(stamp),
            lines,
        });
    }
    Ok(Json(json!({ "items": jobs })))
}

// ---- the goods become units -------------------------------------------------

/// The job's goods become units on the Gudang's racks: the accepted delivery
/// leaves Unidentified as one anonymous quantity and comes back as one unit
/// per minted EPC, balanced through `system/identification` — what a DC
/// server does when a job arrives (`edge::sync::apply_tagging_job`; owner,
/// 28 Sep 2026: the units are in the warehouse from then, and confirming the
/// labels moves nothing).
///
/// Called when a job is issued while the cloud runs the Gudang
/// (`postgres::tagging::issue_setup_session`), and again by the confirmation
/// in case a job was issued before. Booked once: the movement group's
/// idempotency key is the job, and a second call answers with the first
/// group. Returns that group.
///
/// The delivery is found through the movement that put it in Unidentified
/// when its count was accepted (`goods_receipt_line.movement_group_id`, or the
/// Gudang's own `dc_receiving_count`, 0900) — never by matching the article,
/// so two deliveries of one article cannot be confused.
pub(crate) async fn stock_issued_job_tx(
    tx: &mut Transaction<'_, Postgres>,
    job_id: Uuid,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<Uuid, AppError> {
    let key = format!("{}:tagging-job:{job_id}", common::CLOUD_DC_ORIGIN);
    let booked: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM movement_group WHERE idempotency_key = $1")
            .bind(&key)
            .fetch_optional(&mut **tx)
            .await?;
    if let Some(group) = booked {
        return Ok(group);
    }

    let gudang = common::gudang_site_tx(tx).await?;
    let job = sqlx::query(
        "SELECT j.site_id, j.article_code, j.total_quantity, s.receipt_line_id
           FROM tagging_job j
           JOIN article_setup_session s ON s.session_id = j.session_id
          WHERE j.job_id = $1",
    )
    .bind(job_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no tagging job {job_id}")))?;
    let job_site: String = job.get("site_id");
    let article_code: String = job.get("article_code");
    let total_quantity: i64 = job.get("total_quantity");
    let receipt_line_id: Uuid = job.get("receipt_line_id");
    if job_site != gudang {
        return Err(AppError::Validation(format!(
            "tagging job {job_id} is for site '{job_site}', but the Gudang the cloud runs is \
             '{gudang}'; tagging happens at the Gudang"
        )));
    }

    let site = SiteId::new(gudang.as_str())
        .map_err(|error| AppError::Configuration(format!("head-office site id: {error}")))?;
    let unidentified = Place::Operational {
        pool: OperationalPool::DcPendingUnidentified {
            dc_id: site.clone(),
        },
        state: InventoryState::Normal,
    };
    let racks = Place::Operational {
        pool: OperationalPool::Stockroom { site_id: site },
        state: InventoryState::Normal,
    };
    let identification = Place::System {
        place: SystemPlace::Identification,
    };

    let lot: Uuid = sqlx::query_scalar(
        "SELECT m.subject_id FROM movement m
          WHERE m.to_place_id = $2
            AND m.movement_group_id IN (
                SELECT movement_group_id FROM goods_receipt_line
                 WHERE receipt_line_id = $1
                UNION
                SELECT movement_group_id FROM dc_receiving_count
                 WHERE receipt_line_id = $1 AND movement_group_id IS NOT NULL)
          ORDER BY m.fact_sequence
          LIMIT 1",
    )
    .bind(receipt_line_id)
    .bind(unidentified.id())
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        AppError::Conflict(format!(
            "the Gudang holds no accepted delivery line {receipt_line_id} in Unidentified; \
             it cannot tag goods it never received"
        ))
    })?;

    // What is actually still unidentified. A job for LESS is sound — a count
    // over the order leaves the excess here until the buyer decides on it —
    // a job for more would take stock the Gudang does not have.
    let on_hand: i64 = sqlx::query_scalar(
        "SELECT quantity FROM inventory_projection WHERE subject_id = $1 AND place_id = $2",
    )
    .bind(lot)
    .bind(unidentified.id())
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or(0);
    if total_quantity > on_hand {
        return Err(AppError::Conflict(format!(
            "tagging job {job_id} accounts for {total_quantity} units but only {on_hand} of \
             delivery line {receipt_line_id} are unidentified"
        )));
    }

    let lines = job_lines(&mut **tx, job_id).await?;
    let mut unit_ids = Vec::new();
    let mut unit_skus = Vec::new();
    let mut unit_epcs = Vec::new();
    let mut unit_barcodes = Vec::new();
    for line in &lines {
        if i64::try_from(line.epcs.len()).ok() != Some(line.quantity) {
            return Err(AppError::Validation(format!(
                "tagging job {job_id} line {} is for {} units but carries {} EPCs",
                line.sku_code,
                line.quantity,
                line.epcs.len()
            )));
        }
        let sku_id: Uuid = sqlx::query_scalar("SELECT id FROM sku WHERE sku_code = $1")
            .bind(&line.sku_code)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("sku {}", line.sku_code)))?;
        for epc in &line.epcs {
            unit_ids.push(Uuid::new_v4());
            unit_skus.push(sku_id);
            unit_epcs.push(epc.clone());
            unit_barcodes.push(line.barcode_payload.clone());
        }
    }
    if i64::try_from(unit_ids.len()).ok() != Some(total_quantity) {
        return Err(AppError::Validation(format!(
            "tagging job {job_id} is for {total_quantity} units but its lines carry {}",
            unit_ids.len()
        )));
    }

    // Each label is a unit from the start: it is what the Gudang picks,
    // packs and a store counts in.
    sqlx::query(
        "INSERT INTO inventory_subject (id, subject_type, sku_id, epc, barcode, quantity, uom,
                                        created_at)
         SELECT unit.id, 'UNIT', unit.sku_id, unit.epc, unit.barcode, 1, 'EA', $5
           FROM UNNEST($1::uuid[], $2::uuid[], $3::text[], $4::text[])
                AS unit (id, sku_id, epc, barcode)",
    )
    .bind(&unit_ids)
    .bind(&unit_skus)
    .bind(&unit_epcs)
    .bind(&unit_barcodes)
    .bind(at)
    .execute(&mut **tx)
    .await
    .map_err(|error| {
        if is_unique_violation(&error) {
            AppError::Conflict(format!(
                "an EPC of tagging job {job_id} already belongs to another unit"
            ))
        } else {
            AppError::from(error)
        }
    })?;

    let mut movement_lines = Vec::with_capacity(unit_ids.len() + 1);
    movement_lines.push(MovementLine {
        subject_id: SubjectId(lot),
        quantity: total_quantity,
        from: unidentified,
        to: identification.clone(),
    });
    for unit in &unit_ids {
        movement_lines.push(MovementLine {
            subject_id: SubjectId(*unit),
            quantity: 1,
            from: identification.clone(),
            to: racks.clone(),
        });
    }
    let command = MovementCommand {
        movement_group_id: MovementGroupId::new(),
        lines: movement_lines,
        cause: MovementCause::Identification,
        reference_type: Some("TAGGING_JOB".into()),
        reference_id: Some(job_id.to_string()),
        reason: format!(
            "Identifikasi {article_code} menjadi {} varian, masuk gudang",
            lines.len()
        ),
        actor_id: actor.to_owned(),
        occurred_at: at,
    };
    // A node's transition rules, not the centre's: the centre's refuse
    // IDENTIFICATION because until now only a node wrote one. The cloud is
    // the Gudang's node here.
    crate::edge::domain::inventory::validate_command(&command)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let digest = crate::cloud::postgres::payload_digest(&command)?;
    crate::cloud::postgres::insert_group(tx, &command, &key, &digest).await?;
    crate::cloud::postgres::apply_lines(tx, &command, &key, &digest).await?;
    Ok(command.movement_group_id.0)
}

// ---- the labels are on the goods ------------------------------------------

/// One confirmation for the whole job, by the person who attached the tags.
/// What the cloud did when a DC server's `tagging.completed` arrived: the
/// same applier, then the order's flow moves its Tagging stage.
async fn confirm_tagging(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(mut request): Json<TaggingConfirmRequest>,
) -> Result<(StatusCode, Json<TaggingConfirmResult>), AppError> {
    common::require_hosted()?;
    request.actor_id = principal.username.clone();
    if request.actor_id.trim().is_empty() {
        return Err(AppError::Validation(
            "a tagging confirmation must name who gave it".into(),
        ));
    }
    common::ensure_origin(&state.db).await?;

    let digest = crate::cloud::postgres::payload_digest(&request)?;
    let mut tx = state.db.begin().await?;
    if let Some(response) = crate::cloud::postgres::begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "DC_TAGGING_CONFIRM",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        let result: TaggingConfirmResult = serde_json::from_value(response)?;
        return Ok((StatusCode::CREATED, Json(result)));
    }

    let job_id = request.job_id;
    let gudang = common::gudang_site_tx(&mut tx).await?;
    let job = sqlx::query(
        "SELECT session_id, site_id, status FROM tagging_job WHERE job_id = $1 FOR UPDATE",
    )
    .bind(job_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no tagging job {job_id}")))?;
    let session_id: Uuid = job.get("session_id");
    let site: String = job.get("site_id");
    let status: String = job.get("status");
    if site != gudang {
        return Err(AppError::NotFound(format!(
            "no tagging job {job_id} at this Gudang"
        )));
    }
    match status.as_str() {
        "ISSUED" => {}
        "TAGGED" => {
            return Err(AppError::Conflict(format!(
                "tagging job {job_id} was already confirmed"
            )))
        }
        other => {
            return Err(AppError::Conflict(format!(
                "tagging job {job_id} is {}",
                other.to_ascii_lowercase()
            )))
        }
    }

    let lines: Vec<(String, i64)> = sqlx::query(
        "SELECT sku_code, quantity FROM tagging_job_line WHERE job_id = $1 ORDER BY sku_code",
    )
    .bind(job_id)
    .fetch_all(&mut *tx)
    .await?
    .iter()
    .map(|row| (row.get::<String, _>("sku_code").trim().to_owned(), row.get("quantity")))
    .collect();
    if lines.is_empty() {
        return Err(AppError::Conflict(format!(
            "tagging job {job_id} has no lines"
        )));
    }

    let confirmed_at = state.clock.now();
    // The units went onto the racks when the job was issued; this finds that
    // movement (or books it, for a job issued before the cloud ran the
    // Gudang). Never twice.
    let movement_group_id =
        stock_issued_job_tx(&mut tx, job_id, &request.actor_id, confirmed_at).await?;
    let tagged_units: i64 = lines.iter().map(|(_, quantity)| quantity).sum();

    let done = crate::cloud::domain::TaggingCompletedPayload {
        job_id,
        session_id,
        movement_group_id,
        confirmed_by: request.actor_id.clone(),
        confirmed_at,
        lines: lines
            .iter()
            .map(|(sku_code, quantity)| crate::cloud::domain::TaggingCompletedLine {
                sku_code: sku_code.clone(),
                quantity: *quantity,
            })
            .collect(),
    };
    crate::cloud::postgres::apply_tagging_completed(&mut tx, &done).await?;
    // The order the goods were bought on moves its flow's Tagging. The fact
    // is keyed as a DC server's was — its id is the job — under the cloud-run
    // Gudang's own origin.
    let fact = crate::cloud::postgres::flow_stages::NodeFact {
        origin_id: common::CLOUD_DC_ORIGIN,
        event_type: crate::cloud::domain::FACT_TAGGING_COMPLETED,
        event_id: job_id,
        stage: crate::cloud::domain::flow::StageKind::Tagging,
        actor_id: Some(request.actor_id.as_str()),
    };
    crate::cloud::postgres::flow_stages::resume_tagging_job_tx(
        &mut tx,
        job_id,
        &fact,
        confirmed_at,
    )
    .await?;

    let result = TaggingConfirmResult {
        job_id,
        movement_group_id,
        tagged_units,
        confirmed_by: request.actor_id.clone(),
        confirmed_at,
    };
    crate::cloud::postgres::complete_idempotent(
        &mut tx,
        &request.idempotency_key,
        &serde_json::to_value(&result)?,
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(result)))
}

// ---- print runs ---------------------------------------------------------------

async fn summarise(
    conn: &mut PgConnection,
    session_id: Uuid,
) -> Result<PrintSessionSummary, AppError> {
    let row = sqlx::query(
        "SELECT s.session_id, s.job_id, s.status, s.printer_host, s.printer_port, s.chunk_size,
                s.label_width_mm, s.label_height_mm, s.total_items, s.printed_count,
                s.failed_count,
                (SELECT COUNT(*) FROM dc_print_item i
                  WHERE i.session_id = s.session_id
                    AND i.status IN ('PENDING', 'CLAIMED', 'FAILED')) AS pending
           FROM dc_print_session s WHERE s.session_id = $1",
    )
    .bind(session_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("print session {session_id}")))?;
    Ok(PrintSessionSummary {
        session_id: row.get::<Uuid, _>("session_id").to_string(),
        job_id: row.get::<Uuid, _>("job_id").to_string(),
        status: row.get("status"),
        printer_host: row.get("printer_host"),
        printer_port: u16::try_from(row.get::<i64, _>("printer_port")).unwrap_or(9100),
        chunk_size: row.get("chunk_size"),
        label_width_mm: row.get("label_width_mm"),
        label_height_mm: row.get("label_height_mm"),
        total_items: row.get("total_items"),
        printed_count: row.get("printed_count"),
        failed_count: row.get("failed_count"),
        pending_count: row.get("pending"),
    })
}

/// Counters and status back in line with the items, in one statement — the
/// DC server's `recompute`.
async fn recompute(conn: &mut PgConnection, session_id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE dc_print_session AS s SET
             printed_count = counted.printed,
             failed_count  = counted.failed,
             status = CASE
                 WHEN counted.printed = s.total_items THEN 'COMPLETED'
                 WHEN counted.printed + counted.failed = s.total_items THEN 'PARTIAL'
                 ELSE 'PRINTING'
             END,
             closed_at = CASE
                 WHEN counted.printed + counted.failed = s.total_items THEN now()
                 ELSE NULL
             END,
             updated_at = now()
           FROM (SELECT COUNT(*) FILTER (WHERE status = 'PRINTED') AS printed,
                        COUNT(*) FILTER (WHERE status = 'FAILED') AS failed
                   FROM dc_print_item WHERE session_id = $1) AS counted
          WHERE s.session_id = $1 AND s.status <> 'CANCELLED'",
    )
    .bind(session_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Queue the labels for a tagging job, one per EPC, their words snapshotted
/// now. One run per job; reprints happen inside it.
async fn open_print_session(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<PrintSessionSummary>), AppError> {
    common::require_hosted()?;
    let body = with_recorded_printer(&state.db, body).await?;
    let mut request: OpenPrintSessionRequest = print_request(body)?;
    request.actor_id = principal.username.clone();

    let chunk_size = request.chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE);
    if !(1..=1000).contains(&chunk_size) {
        return Err(AppError::Validation(
            "chunk size must be between 1 and 1000".into(),
        ));
    }
    edge_printing::validate_label_size(request.label_width_mm, request.label_height_mm)
        .map_err(edge_error)?;
    let host = request.printer_host.trim().to_owned();
    check_printer_address(&host, request.printer_port).await?;
    let job_id = Uuid::parse_str(request.job_id.trim())
        .map_err(|_| AppError::NotFound(format!("tagging job {}", request.job_id)))?;

    let gudang = common::gudang_site(&state.db).await?;
    let mut tx = state.db.begin().await?;
    // Locked, so two benches opening the same job at once queue behind each
    // other and the second is told the run exists.
    let job = sqlx::query("SELECT article_name, site_id FROM tagging_job WHERE job_id = $1 FOR UPDATE")
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await?
        .filter(|row| row.get::<String, _>("site_id") == gudang)
        .ok_or_else(|| AppError::NotFound(format!("tagging job {job_id}")))?;
    let article_name: String = job.get("article_name");

    let existing: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM dc_print_session WHERE job_id = $1)")
            .bind(job_id)
            .fetch_one(&mut *tx)
            .await?;
    if existing {
        // A second run would mean two tags carrying one identity.
        return Err(AppError::Conflict(format!(
            "tagging job {job_id} already has a print session"
        )));
    }

    // Ordered by SKU then EPC, so `seq` is stable and "it stopped at 340"
    // means the same label every time. The barcode carries the bare SKU: the
    // scanners on the shop floor are calibrated to it.
    let lines = job_lines(&mut tx, job_id).await?;
    let mut seqs = Vec::new();
    let mut epcs = Vec::new();
    let mut skus = Vec::new();
    let mut colours = Vec::new();
    let mut sizes = Vec::new();
    let mut prices = Vec::new();
    for line in &lines {
        for epc in &line.epcs {
            seqs.push(i64::try_from(seqs.len() + 1).unwrap_or(i64::MAX));
            epcs.push(epc.clone());
            skus.push(line.sku_code.clone());
            colours.push(line.colour_label.clone());
            sizes.push(line.size_label.clone());
            prices.push(line.base_price_minor);
        }
    }
    if epcs.is_empty() {
        return Err(AppError::Validation(format!(
            "tagging job {job_id} has no EPCs to print"
        )));
    }

    let session_id = Uuid::new_v4();
    let (darkness, speed_ips) = request.machine();
    sqlx::query(
        "INSERT INTO dc_print_session
             (session_id, job_id, printer_host, printer_port, lang, label_width_mm,
              label_height_mm, label_offset_mm, chunk_size, total_items, status, created_by,
              darkness, speed_ips)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OPEN',$11,$12,$13)",
    )
    .bind(session_id)
    .bind(job_id)
    .bind(&host)
    .bind(i64::from(request.printer_port))
    .bind(
        request
            .language
            .unwrap_or_else(PrinterLanguage::from_env)
            .as_str(),
    )
    .bind(request.label_width_mm)
    .bind(request.label_height_mm)
    .bind(request.label_offset_mm)
    .bind(chunk_size)
    .bind(i64::try_from(epcs.len()).unwrap_or(i64::MAX))
    .bind(&request.actor_id)
    .bind(darkness)
    .bind(speed_ips)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO dc_print_item
             (session_id, seq, epc, sku_code, article_name, colour_label, size_label,
              barcode_payload, price_minor)
         SELECT $1, item.seq, item.epc, item.sku, $2, item.colour, item.size, item.sku,
                item.price
           FROM UNNEST($3::bigint[], $4::text[], $5::text[], $6::text[], $7::text[],
                       $8::bigint[]) AS item (seq, epc, sku, colour, size, price)",
    )
    .bind(session_id)
    .bind(&article_name)
    .bind(&seqs)
    .bind(&epcs)
    .bind(&skus)
    .bind(&colours)
    .bind(&sizes)
    .bind(&prices)
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        if is_unique_violation(&error) {
            AppError::Conflict(format!(
                "an EPC of tagging job {job_id} is already queued in another print run"
            ))
        } else {
            AppError::from(error)
        }
    })?;
    tx.commit().await?;

    let mut conn = state.db.acquire().await?;
    let summary = summarise(&mut conn, session_id).await?;
    Ok((StatusCode::CREATED, Json(summary)))
}

async fn print_session(
    State(state): State<AppState>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<PrintSessionSummary>, AppError> {
    common::require_hosted()?;
    let mut conn = state.db.acquire().await?;
    Ok(Json(summarise(&mut conn, session_id).await?))
}

/// The run this job already has, or `null` — so every bench arrives at the
/// same run.
async fn job_print_session(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let mut conn = state.db.acquire().await?;
    let session_id: Option<Uuid> =
        sqlx::query_scalar("SELECT session_id FROM dc_print_session WHERE job_id = $1")
            .bind(job_id)
            .fetch_optional(&mut *conn)
            .await?;
    let session = match session_id {
        Some(session_id) => Some(summarise(&mut conn, session_id).await?),
        None => None,
    };
    Ok(Json(json!({ "session": session })))
}

/// One label as a run snapshotted it, or as a job would be snapshotted.
struct QueuedItem {
    epc: String,
    sku_code: String,
    article_name: String,
    colour_label: String,
    size_label: String,
    barcode_payload: String,
    price_minor: i64,
}

/// Draw one of a job's labels without printing it: from the run's snapshot
/// when there is a run, else from the job mapped exactly as a run would
/// snapshot it (`edge::printing::preview_job_label`).
async fn preview_job_label(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    Json(request): Json<LabelPreviewRequest>,
) -> Result<Json<LabelPreview>, AppError> {
    common::require_hosted()?;
    let mut conn = state.db.acquire().await?;
    let run = sqlx::query(
        "SELECT session_id, label_width_mm, label_height_mm, lang, label_offset_mm
           FROM dc_print_session WHERE job_id = $1",
    )
    .bind(job_id)
    .fetch_optional(&mut *conn)
    .await?;

    let (fallback_width, fallback_height, fallback_offset, run_language) = match &run {
        Some(row) => (
            row.get::<i64, _>("label_width_mm"),
            row.get::<i64, _>("label_height_mm"),
            row.get::<i64, _>("label_offset_mm"),
            Some(PrinterLanguage::parse(&row.get::<String, _>("lang"))),
        ),
        None => (
            edge_printing::default_label_width(),
            edge_printing::default_label_height(),
            edge_printing::default_label_offset(),
            None,
        ),
    };
    let language = request
        .language
        .or(run_language)
        .unwrap_or_else(PrinterLanguage::from_env);
    let width_mm = request.label_width_mm.unwrap_or(fallback_width);
    let height_mm = request.label_height_mm.unwrap_or(fallback_height);
    let offset_mm = request.label_offset_mm.unwrap_or(fallback_offset);
    edge_printing::validate_label_size(width_mm, height_mm).map_err(edge_error)?;
    let sku_code = request
        .sku_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);

    let (item, source) = match &run {
        Some(row) => {
            let session_id: Uuid = row.get("session_id");
            let found = sqlx::query(
                "SELECT epc, sku_code, article_name, colour_label, size_label, barcode_payload,
                        price_minor
                   FROM dc_print_item
                  WHERE session_id = $1 AND ($2::text IS NULL OR sku_code = $2)
                  ORDER BY CASE WHEN status IN ('PENDING', 'FAILED') THEN 0 ELSE 1 END, seq
                  LIMIT 1",
            )
            .bind(session_id)
            .bind(&sku_code)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| match &sku_code {
                Some(sku) => AppError::NotFound(format!("no label for {sku} in this run")),
                None => AppError::NotFound(format!("print session {session_id} has no labels")),
            })?;
            (
                QueuedItem {
                    epc: found.get("epc"),
                    sku_code: found.get("sku_code"),
                    article_name: found.get("article_name"),
                    colour_label: found.get::<Option<String>, _>("colour_label").unwrap_or_default(),
                    size_label: found.get::<Option<String>, _>("size_label").unwrap_or_default(),
                    barcode_payload: found.get("barcode_payload"),
                    price_minor: found.get("price_minor"),
                },
                "SESSION",
            )
        }
        None => {
            let found = sqlx::query(
                "SELECT l.sku_code, j.article_name, l.colour_label, l.size_label,
                        l.base_price_minor, l.serial_from
                   FROM tagging_job_line l
                   JOIN tagging_job j ON j.job_id = l.job_id
                  WHERE l.job_id = $1 AND ($2::text IS NULL OR l.sku_code = $2)
                  ORDER BY l.sku_code
                  LIMIT 1",
            )
            .bind(job_id)
            .bind(&sku_code)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| match &sku_code {
                Some(sku) => AppError::NotFound(format!("tagging job {job_id} has no line {sku}")),
                None => AppError::NotFound(format!("tagging job {job_id}")),
            })?;
            let sku = found.get::<String, _>("sku_code").trim().to_owned();
            // The first label the run would produce: the line's lowest serial.
            let epc = line_epcs(&sku, found.get("serial_from"), 1)?
                .into_iter()
                .next()
                .unwrap_or_default();
            (
                QueuedItem {
                    epc,
                    article_name: found.get("article_name"),
                    colour_label: found.get("colour_label"),
                    size_label: found.get("size_label"),
                    barcode_payload: sku.clone(),
                    price_minor: found.get("base_price_minor"),
                    sku_code: sku,
                },
                "JOB",
            )
        }
    };

    let size = LabelSize {
        width_mm: width_mm as f64,
        height_mm: height_mm as f64,
        left_offset_mm: offset_mm as f64,
    };
    let data = LabelData {
        sku_code: &item.sku_code,
        article_name: &item.article_name,
        colour_label: &item.colour_label,
        size_label: &item.size_label,
        barcode_payload: &item.barcode_payload,
        price_minor: item.price_minor,
        epc: &item.epc,
        copies: 1,
    };
    Ok(Json(LabelPreview {
        zpl: render_label_in(&data, size, LabelBrand(LABEL_BRAND), language),
        svg: preview_label(&data, size, LabelBrand(LABEL_BRAND)),
        sku_code: item.sku_code.clone(),
        article_name: item.article_name.clone(),
        colour_label: item.colour_label.clone(),
        size_label: item.size_label.clone(),
        barcode_payload: item.barcode_payload.clone(),
        price_minor: item.price_minor,
        epc: item.epc.clone(),
        label_width_mm: width_mm,
        label_height_mm: height_mm,
        source: source.to_string(),
    }))
}

/// A chunk claimed for the printer, with where it goes.
struct Claimed {
    host: String,
    port: u16,
    prelude: String,
    labels: Vec<ClaimedLabel>,
}

/// Print the next chunk. Called again until nothing is pending; a label the
/// printer refused comes back around on a later call.
///
/// The work runs in its own task, so it finishes — and records what the
/// printer did — even if the screen that asked goes away mid-chunk: a
/// dropped request would otherwise leave its labels claimed and unreported.
async fn run_print_chunk(
    State(state): State<AppState>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<PrintChunkReport>, AppError> {
    common::require_hosted()?;
    let db = state.db.clone();
    tokio::spawn(async move { run_chunk(db, session_id).await })
        .await
        .map_err(|error| AppError::Configuration(format!("the print run stopped: {error}")))?
        .map(Json)
}

async fn run_chunk(db: PgPool, session_id: Uuid) -> Result<PrintChunkReport, AppError> {
    let chunk = claim_chunk(&db, session_id).await?;
    if chunk.labels.is_empty() {
        let mut conn = db.acquire().await?;
        return Ok(PrintChunkReport {
            attempted: 0,
            printed: 0,
            failed: 0,
            session: summarise(&mut conn, session_id).await?,
        });
    }
    let (outcomes, unsent) = dispatch(&chunk).await;
    let printed = outcomes.iter().filter(|o| o.error.is_none()).count();
    let session = record_outcomes(&db, session_id, &outcomes, &unsent).await?;
    Ok(PrintChunkReport {
        attempted: outcomes.len(),
        printed,
        failed: outcomes.len() - printed,
        session,
    })
}

/// Hand out the next chunk, already rendered, in the run's own language.
/// Failed labels come back around: a jam costs four reprints, not four
/// hundred.
async fn claim_chunk(db: &PgPool, session_id: Uuid) -> Result<Claimed, AppError> {
    let mut tx = db.begin().await?;
    // The session row is the claim's lock: two runs of one session take
    // turns, and the second never hands out what the first already holds.
    let session = sqlx::query(
        "SELECT chunk_size, label_width_mm, label_height_mm, printer_host, printer_port, lang,
                label_offset_mm, darkness, speed_ips
           FROM dc_print_session WHERE session_id = $1 FOR UPDATE",
    )
    .bind(session_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("print session {session_id}")))?;
    let chunk_size: i64 = session.get("chunk_size");
    let language = PrinterLanguage::parse(&session.get::<String, _>("lang"));
    let size = LabelSize {
        width_mm: session.get::<i64, _>("label_width_mm") as f64,
        height_mm: session.get::<i64, _>("label_height_mm") as f64,
        left_offset_mm: session.get::<i64, _>("label_offset_mm") as f64,
    };

    let rows = sqlx::query(&format!(
        "SELECT epc, seq, sku_code, article_name, colour_label, size_label, barcode_payload,
                price_minor, attempts
           FROM dc_print_item
          WHERE session_id = $1
            AND (status IN ('PENDING', 'FAILED')
                 OR (status = 'CLAIMED' AND claimed_at < now() - interval '{STALE_CLAIM}'))
          ORDER BY seq
          LIMIT $2"
    ))
    .bind(session_id)
    .bind(chunk_size)
    .fetch_all(&mut *tx)
    .await?;

    let mut labels = Vec::with_capacity(rows.len());
    let mut seqs = Vec::with_capacity(rows.len());
    for row in &rows {
        let item = QueuedItem {
            epc: row.get("epc"),
            sku_code: row.get("sku_code"),
            article_name: row.get("article_name"),
            colour_label: row.get::<Option<String>, _>("colour_label").unwrap_or_default(),
            size_label: row.get::<Option<String>, _>("size_label").unwrap_or_default(),
            barcode_payload: row.get("barcode_payload"),
            price_minor: row.get("price_minor"),
        };
        let seq: i64 = row.get("seq");
        let zpl = render_label_in(
            &LabelData {
                sku_code: &item.sku_code,
                article_name: &item.article_name,
                colour_label: &item.colour_label,
                size_label: &item.size_label,
                barcode_payload: &item.barcode_payload,
                price_minor: item.price_minor,
                epc: &item.epc,
                copies: 1,
            },
            size,
            LabelBrand(LABEL_BRAND),
            language,
        );
        seqs.push(seq);
        labels.push(ClaimedLabel {
            epc: item.epc,
            seq,
            sku_code: item.sku_code,
            attempts: row.get::<i64, _>("attempts") + 1,
            zpl,
        });
    }

    if !labels.is_empty() {
        // The attempt is counted here, where the label leaves for the
        // printer: counting on the way back would lose every label nobody
        // heard back about.
        sqlx::query(
            "UPDATE dc_print_item
                SET status = 'CLAIMED', attempts = attempts + 1, claimed_at = now()
              WHERE session_id = $1 AND seq = ANY($2)",
        )
        .bind(session_id)
        .bind(&seqs)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE dc_print_session SET status = 'PRINTING', updated_at = now()
              WHERE session_id = $1 AND status = 'OPEN'",
        )
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(Claimed {
        host: session.get("printer_host"),
        port: u16::try_from(session.get::<i64, _>("printer_port")).unwrap_or(9100),
        prelude: machine_prelude(
            language,
            session.get::<Option<i64>, _>("darkness"),
            session.get::<Option<i64>, _>("speed_ips"),
        ),
        labels,
    })
}

/// Hand a chunk to the printer, one label per delivery, so every label has
/// its own answer (`edge::printing::dispatch_chunk`). Never fails: a printer
/// that is off is an ordinary day, and its labels come back as FAILED rows.
///
/// Two differences from the DC server, both because a label through the
/// bridge waits up to 45 seconds for an answer: a printer that is not there
/// at all fails the whole chunk at once, and the first refused label stops
/// the chunk — the rest were never sent and go back to waiting, uncounted.
/// The bench's loop stops on a pass that printed nothing.
async fn dispatch(chunk: &Claimed) -> (Vec<PrintOutcomeRecord>, Vec<String>) {
    if let Err(message) = print_bridge::reachable(&chunk.host, chunk.port).await {
        let outcomes = chunk
            .labels
            .iter()
            .map(|label| PrintOutcomeRecord {
                epc: label.epc.clone(),
                error: Some(message.clone()),
            })
            .collect();
        return (outcomes, Vec::new());
    }
    // The machine settings go first, once; a printer that would not take
    // them still prints, so their failure is not a label's.
    if !chunk.prelude.is_empty() {
        let _ = print_bridge::deliver(&chunk.host, chunk.port, chunk.prelude.as_bytes()).await;
    }
    let mut outcomes = Vec::with_capacity(chunk.labels.len());
    let mut unsent = Vec::new();
    let mut stopped = false;
    for label in &chunk.labels {
        if stopped {
            unsent.push(label.epc.clone());
            continue;
        }
        let error = match print_bridge::deliver(&chunk.host, chunk.port, label.zpl.as_bytes()).await
        {
            Ok(()) => None,
            Err(error) => {
                stopped = true;
                let message = said(error);
                Some(if message.trim().is_empty() {
                    "printer reported an unspecified failure".to_owned()
                } else {
                    message
                })
            }
        };
        outcomes.push(PrintOutcomeRecord {
            epc: label.epc.clone(),
            error,
        });
    }
    (outcomes, unsent)
}

/// Record what the printer did, and put back what never left.
async fn record_outcomes(
    db: &PgPool,
    session_id: Uuid,
    outcomes: &[PrintOutcomeRecord],
    unsent: &[String],
) -> Result<PrintSessionSummary, AppError> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT 1 FROM dc_print_session WHERE session_id = $1 FOR UPDATE")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
    let printed: Vec<String> = outcomes
        .iter()
        .filter(|outcome| outcome.error.is_none())
        .map(|outcome| outcome.epc.clone())
        .collect();
    if !printed.is_empty() {
        sqlx::query(
            "UPDATE dc_print_item
                SET status = 'PRINTED', printed_at = now(), last_error = NULL
              WHERE session_id = $1 AND epc = ANY($2)",
        )
        .bind(session_id)
        .bind(&printed)
        .execute(&mut *tx)
        .await?;
    }
    for outcome in outcomes {
        if let Some(message) = &outcome.error {
            sqlx::query(
                "UPDATE dc_print_item
                    SET status = 'FAILED', last_error = $3, printed_at = NULL
                  WHERE session_id = $1 AND epc = $2",
            )
            .bind(session_id)
            .bind(&outcome.epc)
            .bind(message)
            .execute(&mut *tx)
            .await?;
        }
    }
    if !unsent.is_empty() {
        sqlx::query(
            "UPDATE dc_print_item
                SET status = 'PENDING', attempts = GREATEST(attempts - 1, 0), claimed_at = NULL
              WHERE session_id = $1 AND epc = ANY($2) AND status = 'CLAIMED'",
        )
        .bind(session_id)
        .bind(unsent)
        .execute(&mut *tx)
        .await?;
    }
    recompute(&mut tx, session_id).await?;
    tx.commit().await?;
    let mut conn = db.acquire().await?;
    summarise(&mut conn, session_id).await
}

/// Move an open run to the printer in front of whoever picked it up — an
/// explicit act, never inferred from the caller (`edge::printing::repoint`).
async fn repoint_print_session(
    State(state): State<AppState>,
    Path(session_id): Path<Uuid>,
    Json(body): Json<Value>,
) -> Result<Json<PrintSessionSummary>, AppError> {
    common::require_hosted()?;
    let body = with_recorded_printer(&state.db, body).await?;
    let request: RepointPrinterRequest = print_request(body)?;
    let host = request.printer_host.trim().to_owned();
    if let Some(chunk_size) = request.chunk_size {
        if !(1..=1000).contains(&chunk_size) {
            return Err(AppError::Validation(
                "chunk size must be between 1 and 1000".into(),
            ));
        }
    }
    // One axis at a time: a bench that changed only its width need not
    // restate its height.
    if let Some(width_mm) = request.label_width_mm {
        edge_printing::validate_label_size(width_mm, edge_printing::MIN_LABEL_MM)
            .map_err(edge_error)?;
    }
    if let Some(height_mm) = request.label_height_mm {
        edge_printing::validate_label_size(edge_printing::MIN_LABEL_MM, height_mm)
            .map_err(edge_error)?;
    }
    check_printer_address(&host, request.printer_port).await?;

    let mut conn = state.db.acquire().await?;
    let status: String =
        sqlx::query_scalar("SELECT status FROM dc_print_session WHERE session_id = $1")
            .bind(session_id)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("print session {session_id}")))?;
    // A finished run has nothing left to send anywhere.
    if status == "COMPLETED" || status == "CANCELLED" {
        return Err(AppError::Validation(format!(
            "print session {session_id} is {}",
            status.to_lowercase()
        )));
    }
    sqlx::query(
        "UPDATE dc_print_session
            SET printer_host = $2,
                printer_port = $3,
                chunk_size = COALESCE($4, chunk_size),
                label_width_mm = COALESCE($5, label_width_mm),
                label_height_mm = COALESCE($6, label_height_mm),
                label_offset_mm = COALESCE($7, label_offset_mm),
                lang = COALESCE($8, lang),
                updated_at = now()
          WHERE session_id = $1",
    )
    .bind(session_id)
    .bind(&host)
    .bind(i64::from(request.printer_port))
    .bind(request.chunk_size)
    .bind(request.label_width_mm)
    .bind(request.label_height_mm)
    .bind(request.label_offset_mm)
    .bind(request.language.map(PrinterLanguage::as_str))
    .execute(&mut *conn)
    .await?;
    Ok(Json(summarise(&mut conn, session_id).await?))
}

/// Put labels that already printed back in the queue — the same EPCs, never
/// fresh ones (`edge::printing::reprint`).
async fn reprint_labels(
    State(state): State<AppState>,
    Path(session_id): Path<Uuid>,
    Json(request): Json<ReprintRequest>,
) -> Result<Json<PrintSessionSummary>, AppError> {
    common::require_hosted()?;
    let range = match (request.from_seq, request.to_seq) {
        (None, None) => None,
        (Some(from), Some(to)) if from <= to && from > 0 => Some((from, to)),
        _ => {
            return Err(AppError::Validation(
                "a range needs both ends, lowest first, counting from 1".into(),
            ))
        }
    };
    let epcs: Vec<String> = request
        .epcs
        .iter()
        .map(|epc| epc.trim().to_ascii_uppercase())
        .filter(|epc| !epc.is_empty())
        .collect();
    if epcs.is_empty() && range.is_none() {
        return Err(AppError::Validation(
            "name the labels to reprint, by EPC or by position".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    let status: String = sqlx::query_scalar(
        "SELECT status FROM dc_print_session WHERE session_id = $1 FOR UPDATE",
    )
    .bind(session_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("print session {session_id}")))?;
    if status == "CANCELLED" {
        return Err(AppError::Validation(format!(
            "print session {session_id} is cancelled"
        )));
    }

    let mut requeued = 0u64;
    for epc in &epcs {
        let known: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM dc_print_item
                             WHERE session_id = $1 AND upper(epc) = $2)",
        )
        .bind(session_id)
        .bind(epc)
        .fetch_one(&mut *tx)
        .await?;
        if !known {
            return Err(AppError::NotFound(format!(
                "label {epc} is not part of print session {session_id}"
            )));
        }
        // Only what printed comes back; one already waiting is left alone.
        // `attempts` stays: it is what this label has already cost.
        requeued += sqlx::query(
            "UPDATE dc_print_item
                SET status = 'PENDING', printed_at = NULL, last_error = NULL
              WHERE session_id = $1 AND upper(epc) = $2 AND status = 'PRINTED'",
        )
        .bind(session_id)
        .bind(epc)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    }
    if let Some((from, to)) = range {
        requeued += sqlx::query(
            "UPDATE dc_print_item
                SET status = 'PENDING', printed_at = NULL, last_error = NULL
              WHERE session_id = $1 AND seq BETWEEN $2 AND $3 AND status = 'PRINTED'",
        )
        .bind(session_id)
        .bind(from)
        .bind(to)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    }
    if requeued == 0 {
        return Err(AppError::Validation(
            "none of those labels have printed, so they are already waiting".into(),
        ));
    }
    recompute(&mut tx, session_id).await?;
    tx.commit().await?;
    let mut conn = state.db.acquire().await?;
    Ok(Json(summarise(&mut conn, session_id).await?))
}

#[derive(Deserialize)]
struct TestPrinterRequest {
    printer_host: String,
    #[serde(default = "crate::edge::printing::default_printer_port")]
    printer_port: u16,
}

/// Ask whether the printer the bench is pointed at is there. Prints nothing.
/// A bridge is there when it has asked for work in the last minute; a printer
/// the cloud opens directly gets the DC server's own probe.
async fn test_printer(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<PrinterProbe>, AppError> {
    common::require_hosted()?;
    let body = with_recorded_printer(&state.db, body).await?;
    let request: TestPrinterRequest = print_request(body)?;
    let host = request.printer_host.trim().to_owned();
    let port = request.printer_port;
    if print_bridge::bridge_name(&host).is_some() {
        let started = Instant::now();
        let outcome = print_bridge::reachable(&host, port).await;
        return Ok(Json(PrinterProbe {
            address: host,
            reachable: outcome.is_ok(),
            took_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            identity: None,
            speaks: None,
            error: outcome.err(),
        }));
    }
    let probe = tokio::task::spawn_blocking(move || edge_printing::probe_printer(&host, port))
        .await
        .map_err(|error| AppError::Configuration(format!("printer test stopped: {error}")))?
        .map_err(edge_error)?;
    Ok(Json(probe))
}
