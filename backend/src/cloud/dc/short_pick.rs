//! The Gudang in the cloud: a picker who cannot finish a line says why
//! (docs/research/2026-10-09-outbound-cancel-edit-build.md §0 rule 6).
//!
//! What was picked goes on; the shortfall simply stays on the same picklist
//! (the same allotment × shop) — `picking::OPEN_PICK_LINES` already owes it,
//! because the accept took only what the picker found. What this adds is the
//! *why*, and a small amber **Short pick** flag on the To pick card while the
//! remainder is in doubt. Ops never sets Missing: a stock-related reason
//! raised a targeted count (the hub's pick sheet does that), and Inventory's
//! review of that count settles it.
//!
//! # A report's status is read, never stored
//!
//! Every read works it out from the line and the count as they are now:
//!
//! - `still_short` = the smaller of the pieces reported and what is still to
//!   pick of that allotment × shop × SKU (`OPEN_PICK_LINES`' arithmetic).
//! - Nothing still short: **CLOSED** when more of the line was closed short
//!   after the report than before it (MD's Close remaining, her reduction or
//!   her cancel took the remainder; `closed_short_at_report`, 0941), else
//!   **PICKED**.
//! - Still short, and MD answered **Continue** (0976): **CONTINUED** — the
//!   picker tries again; a new report on the line starts over.
//! - Still short, and the count it raised was reviewed: **LOST** when the
//!   review booked this SKU Missing (a `COUNT_SHORTAGE` movement of the
//!   count's approval), else **FOUND**.
//! - Otherwise **OPEN**.
//!
//! The flag stays while a report is OPEN or LOST; it clears by itself when
//! the count finds the pieces, the remainder is picked, MD closes it, or MD
//! says Continue.
//!
//! # MD's review (owner, 18 Oct 2026)
//!
//! Only Pick has Cannot continue — a shortage found at Pack or Dispatch goes
//! back to Pick and is picked again. A flagged report is MD's to answer:
//! **Accept short** is the existing Close short
//! (`postgres::allotment_close_short`); **Continue** is written here.

use crate::cloud::dc::common;
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};
use std::collections::BTreeMap;
use uuid::Uuid;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/dc/short-picks", get(list).post(report_short_pick))
        .route(
            "/api/v1/dc/short-picks/continue",
            post(continue_short_picks),
        )
}

/// Why the picker could not finish the line. The first three are about the
/// stock and raise a targeted count; the other two stay with Ops.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShortReason {
    /// The stock at the rack could not be confirmed.
    NotConfirmed,
    /// The item was not at the rack.
    NotFound,
    /// The item was there, damaged.
    Damaged,
    /// A label or the equipment failed.
    LabelOrEquipment,
    Other,
}

impl ShortReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotConfirmed => "NOT_CONFIRMED",
            Self::NotFound => "NOT_FOUND",
            Self::Damaged => "DAMAGED",
            Self::LabelOrEquipment => "LABEL_OR_EQUIPMENT",
            Self::Other => "OTHER",
        }
    }

    /// The column's spelling back; the table's CHECK allows nothing else.
    fn parse(text: &str) -> Result<Self, AppError> {
        match text {
            "NOT_CONFIRMED" => Ok(Self::NotConfirmed),
            "NOT_FOUND" => Ok(Self::NotFound),
            "DAMAGED" => Ok(Self::Damaged),
            "LABEL_OR_EQUIPMENT" => Ok(Self::LabelOrEquipment),
            "OTHER" => Ok(Self::Other),
            other => Err(AppError::Configuration(format!(
                "dc_short_pick holds an unknown reason {other}"
            ))),
        }
    }
}

/// Where a report stands now (see the module's notes).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShortPickStatus {
    /// Still short, and nobody has settled it.
    Open,
    /// The count found them: the remainder can be picked.
    Found,
    /// The count booked them Missing: MD closes the remainder.
    Lost,
    /// The remainder was picked after all.
    Picked,
    /// MD closed the remainder.
    Closed,
    /// MD said Continue: the picker tries again.
    Continued,
}

impl ShortPickStatus {
    /// Whether the card carries the Short pick flag.
    pub fn flagged(self) -> bool {
        matches!(self, Self::Open | Self::Lost)
    }
}

/// A picker's report, as the hub's pick sheet sends it.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ReportShortPickRequest {
    pub idempotency_key: String,
    pub allotment_id: String,
    pub destination_id: String,
    pub sku_code: String,
    /// How many the picker could not find on this pick.
    pub pieces: i64,
    pub reason: ShortReason,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub note: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub pick_session_id: Option<String>,
    /// The targeted count a stock-related reason raised.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub count_id: Option<String>,
}

/// One report, with where it stands now.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct ShortPick {
    pub id: Uuid,
    pub allotment_id: Uuid,
    pub allotment_number: String,
    pub destination_id: String,
    pub sku_code: String,
    pub article_name: String,
    /// Reported on the pick.
    pub pieces: i64,
    /// Still to pick of them now.
    pub still_short: i64,
    pub reason: ShortReason,
    pub note: Option<String>,
    pub reported_by: String,
    pub reported_at: DateTime<Utc>,
    pub count_id: Option<String>,
    pub status: ShortPickStatus,
    /// Who answered Continue in MD's review, and when.
    pub continued_by: Option<String>,
    pub continued_at: Option<DateTime<Utc>>,
}

/// MD answers Continue on the reports of one review.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Deserialize)]
pub struct ContinueShortPicksRequest {
    pub ids: Vec<Uuid>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct ShortPickList {
    /// Every report still flagged (OPEN or LOST), and the others of the last
    /// seven days; newest first.
    pub items: Vec<ShortPick>,
}

// ---------------------------------------------------------------------------
// The arithmetic, shared by the report's check and every read
// ---------------------------------------------------------------------------

/// What the pick area holds per allotment line (`dc_pick_waiting`, 0907),
/// summed once for the statement.
const WAITING_BY_LINE: &str = "SELECT allotment_line_id, SUM(quantity)::bigint AS quantity
                                 FROM dc_pick_waiting
                                GROUP BY allotment_line_id";

/// What is still to pick of one allotment line: `picking::OPEN_PICK_LINES`'
/// arithmetic, nothing at all once the allotment is no longer open. Reads the
/// aliases `line` (allotment_line), `header` (allotment), `commitment`
/// (allotment_line_commitment) and `waiting` ([`WAITING_BY_LINE`]).
const TO_PICK: &str = "CASE WHEN header.status IN ('ACTIVE', 'IN_PROGRESS')
         THEN GREATEST(0, LEAST(line.quantity - line.picked_quantity - line.cancelled_quantity,
                                commitment.to_pack_qty - COALESCE(waiting.quantity, 0)))
         ELSE 0 END";

/// Every report a read asks for, with the figures its status is worked out
/// from. `$1` (timestamptz, may be NULL): reports made since then are read
/// whatever their state. `$2` (uuid, may be NULL): only that report.
/// Without `$2`, a report on an allotment that is no longer open is read only
/// when it is recent: nothing of it can still be short (`TO_PICK` is 0), so
/// it can be neither OPEN nor LOST.
///
/// One statement for the whole board — it is polled every 30 seconds.
fn reports_sql() -> String {
    format!(
        "WITH report AS (
             SELECT sp.id, sp.allotment_id, a.allotment_number, sp.destination_id, sp.sku_code,
                    sku.id AS sku_id, article.name AS article_name, sp.pieces, sp.reason,
                    sp.note, sp.reported_by, sp.reported_at, sp.count_id,
                    sp.closed_short_at_report, sp.continued_by, sp.continued_at
               FROM dc_short_pick sp
               JOIN allotment a ON a.id = sp.allotment_id
               JOIN sku ON sku.sku_code = sp.sku_code
               JOIN article ON article.id = sku.article_id
              WHERE ($2::uuid IS NULL OR sp.id = $2)
                AND ($2 IS NOT NULL
                     OR a.status IN ('ACTIVE', 'IN_PROGRESS')
                     OR sp.reported_at >= $1::timestamptz)
         ),
         waiting AS ({WAITING_BY_LINE}),
         owed AS (
             SELECT report.id AS report_id,
                    SUM({TO_PICK})::bigint AS to_pick,
                    SUM(commitment.closed_short_total)::bigint AS closed_short
               FROM report
               JOIN allotment_line line
                 ON line.allotment_id = report.allotment_id
                AND line.destination_id = report.destination_id
                AND line.sku_id = report.sku_id
               JOIN allotment header ON header.id = line.allotment_id
               JOIN allotment_line_commitment commitment
                 ON commitment.allotment_line_id = line.id
               LEFT JOIN waiting ON waiting.allotment_line_id = line.id
              GROUP BY report.id
         ),
         outcome AS (
             SELECT report.id AS report_id,
                    counted.status = 'CLOSED' AS settled,
                    EXISTS (SELECT 1
                              FROM movement
                              JOIN inventory_subject subject ON subject.id = movement.subject_id
                             WHERE movement.movement_group_id = counted.approval_movement_group_id
                               AND movement.cause = 'COUNT_SHORTAGE'
                               AND subject.sku_id = report.sku_id) AS lost
               FROM report
               JOIN official_count counted ON counted.id::text = report.count_id
         )
         SELECT report.id, report.allotment_id, report.allotment_number, report.destination_id,
                report.sku_code, report.article_name, report.pieces, report.reason, report.note,
                report.reported_by, report.reported_at, report.count_id,
                report.continued_by, report.continued_at,
                LEAST(report.pieces, COALESCE(owed.to_pick, 0))::bigint AS still_short,
                (COALESCE(owed.closed_short, 0) - report.closed_short_at_report)::bigint
                    AS closed_since,
                COALESCE(outcome.settled, false) AS count_settled,
                COALESCE(outcome.lost, false) AS count_lost
           FROM report
           LEFT JOIN owed ON owed.report_id = report.id
           LEFT JOIN outcome ON outcome.report_id = report.id
          ORDER BY report.reported_at DESC, report.id DESC"
    )
}

/// Where a report stands, from what [`reports_sql`] read.
///
/// The order matters. Nothing left to pick wins over the count: a remainder
/// the count lost and MD then closed is CLOSED, one it lost and somebody
/// picked after all is PICKED. MD's Continue wins over the count: she has
/// answered, the picker tries again. A count's review that booked this SKU
/// Missing is LOST however many it booked — MD still decides on the
/// remainder. A review that booked nothing of it Missing found it.
fn status_of(
    still_short: i64,
    closed_since: i64,
    continued: bool,
    settled: bool,
    lost: bool,
) -> ShortPickStatus {
    if still_short <= 0 {
        if closed_since > 0 {
            ShortPickStatus::Closed
        } else {
            ShortPickStatus::Picked
        }
    } else if continued {
        ShortPickStatus::Continued
    } else if lost {
        ShortPickStatus::Lost
    } else if settled {
        ShortPickStatus::Found
    } else {
        ShortPickStatus::Open
    }
}

fn short_pick_from(row: &PgRow) -> Result<ShortPick, AppError> {
    let still_short: i64 = row.try_get("still_short")?;
    let continued_at: Option<DateTime<Utc>> = row.try_get("continued_at")?;
    let status = status_of(
        still_short,
        row.try_get("closed_since")?,
        continued_at.is_some(),
        row.try_get("count_settled")?,
        row.try_get("count_lost")?,
    );
    Ok(ShortPick {
        id: row.try_get("id")?,
        allotment_id: row.try_get("allotment_id")?,
        allotment_number: row.try_get("allotment_number")?,
        destination_id: row.try_get("destination_id")?,
        sku_code: row.try_get("sku_code")?,
        article_name: row.try_get("article_name")?,
        pieces: row.try_get("pieces")?,
        still_short,
        reason: ShortReason::parse(&row.try_get::<String, _>("reason")?)?,
        note: row.try_get("note")?,
        reported_by: row.try_get("reported_by")?,
        reported_at: row.try_get("reported_at")?,
        count_id: row.try_get("count_id")?,
        status,
        continued_by: row.try_get("continued_by")?,
        continued_at,
    })
}

/// The reports [`reports_sql`] selects, newest first.
async fn read(
    db: impl sqlx::PgExecutor<'_>,
    recent_since: Option<DateTime<Utc>>,
    only: Option<Uuid>,
) -> Result<Vec<ShortPick>, AppError> {
    sqlx::query(&reports_sql())
        .bind(recent_since)
        .bind(only)
        .fetch_all(db)
        .await?
        .iter()
        .map(short_pick_from)
        .collect()
}

/// MD accepted a Cannot pick short (owner, 19 Oct 2026): the pieces the
/// picker could not find are booked Missing from the pool they were to be
/// picked from, the moment MD gives them up — not left on the racks' books
/// until a count happens to pass. Only an OPEN report books anything: one the
/// count already settled LOST is Missing already, and one it FOUND was not
/// missing. At most the pieces closed short, and at most what the report
/// still says is short. The pieces are the SKU's units still on the pool's
/// books, the least recently touched first. Returns how many were booked.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn book_missing_on_accept(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    allotment_id: Uuid,
    allotment_line_id: Uuid,
    destination_id: &str,
    sku_code: &str,
    source_pool_id: &str,
    closed_short: i64,
    key: &str,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<i64, AppError> {
    let still_short = read(&mut **tx, None, None)
        .await?
        .into_iter()
        .filter(|report| {
            report.allotment_id == allotment_id
                && report.destination_id == destination_id
                && report.sku_code == sku_code
                && report.status == ShortPickStatus::Open
        })
        .map(|report| report.still_short)
        .max()
        .unwrap_or(0);
    let wanted = still_short.min(closed_short);
    if wanted <= 0 {
        return Ok(0);
    }
    let from = format!("{source_pool_id}:on_hand");
    let rows = sqlx::query(
        "SELECT p.subject_id, COALESCE(s.epc, '') AS epc
           FROM inventory_projection p
           JOIN inventory_subject s ON s.id = p.subject_id
           JOIN sku k ON k.id = s.sku_id
          WHERE p.place_id = $1 AND k.sku_code = $2 AND p.quantity > 0
          ORDER BY p.updated_at, p.subject_id
          LIMIT $3",
    )
    .bind(&from)
    .bind(sku_code)
    .bind(wanted)
    .fetch_all(&mut **tx)
    .await?;
    if rows.is_empty() {
        return Ok(0);
    }
    let mut pieces = Vec::with_capacity(rows.len());
    for row in &rows {
        pieces.push(super::packing::stages::Piece {
            subject_id: row.try_get("subject_id")?,
            epc: row.try_get("epc")?,
            sku_code: sku_code.to_owned(),
            allotment_id,
            allotment_line_id,
        });
    }
    let refs: Vec<&super::packing::stages::Piece> = pieces.iter().collect();
    super::packing::stages::move_pieces(
        tx,
        &refs,
        allotment_line_id,
        &from,
        &format!("{source_pool_id}:missing"),
        crate::cloud::domain::MovementCause::CountShortage,
        key,
        "Cannot pick: MD accepted short",
        actor,
        at,
    )
    .await?;
    Ok(i64::try_from(pieces.len()).unwrap_or(i64::MAX))
}

/// The lines a picker flagged that are still flagged (OPEN or LOST), by
/// allotment × shop × SKU, with the newest such report's reason: what MD's
/// Still needed list adds to the lines the racks cannot cover
/// (`postgres::list_unfilled`).
pub(crate) async fn flagged(
    db: impl sqlx::PgExecutor<'_>,
) -> Result<BTreeMap<(Uuid, String, String), ShortReason>, AppError> {
    let mut flags = BTreeMap::new();
    // Newest first, so the first report seen of a line is the one it keeps.
    for report in read(db, None, None).await? {
        if report.status.flagged() {
            flags
                .entry((report.allotment_id, report.destination_id, report.sku_code))
                .or_insert(report.reason);
        }
    }
    Ok(flags)
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

/// The Gudang's short picks: every one still flagged, and the others of the
/// last seven days (by when they were reported), newest first.
async fn list(State(state): State<AppState>) -> Result<Json<ShortPickList>, AppError> {
    common::require_hosted()?;
    let since = state.clock.now() - Duration::days(7);
    let items = read(&state.db, Some(since), None)
        .await?
        .into_iter()
        .filter(|one| one.status.flagged() || one.reported_at >= since)
        .collect();
    Ok(Json(ShortPickList { items }))
}

/// A report, checked and cleaned up.
struct Report {
    idempotency_key: String,
    allotment_id: Uuid,
    destination_id: String,
    sku_code: String,
    pieces: i64,
    reason: ShortReason,
    note: Option<String>,
    pick_session_id: Option<Uuid>,
    count_id: Option<Uuid>,
}

/// A text the hub may send as null, empty or padded: absent unless it says
/// something.
fn present(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

fn parse_id(value: &str, what: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(value).map_err(|_| AppError::Validation(format!("{value} is not {what}")))
}

fn normalise(request: ReportShortPickRequest) -> Result<Report, AppError> {
    let idempotency_key = request.idempotency_key.trim().to_owned();
    if idempotency_key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    let allotment_id = parse_id(request.allotment_id.trim(), "an allotment id")?;
    let destination_id = request.destination_id.trim().to_owned();
    if destination_id.is_empty() {
        return Err(AppError::Validation(
            "destination_id is required: a short pick is for one shop".into(),
        ));
    }
    let sku_code = request.sku_code.trim().to_ascii_uppercase();
    if sku_code.is_empty() {
        return Err(AppError::Validation("sku_code is required".into()));
    }
    if request.pieces <= 0 {
        return Err(AppError::Validation(format!(
            "pieces short of {sku_code} must be positive"
        )));
    }
    let pick_session_id = present(request.pick_session_id)
        .map(|id| parse_id(&id, "a picklist id"))
        .transpose()?;
    let count_id = present(request.count_id)
        .map(|id| parse_id(&id, "a count id"))
        .transpose()?;
    Ok(Report {
        idempotency_key,
        allotment_id,
        destination_id,
        sku_code,
        pieces: request.pieces,
        reason: request.reason,
        note: present(request.note),
        pick_session_id,
        count_id,
    })
}

/// The report an earlier delivery of the same key wrote, if any. The same key
/// with a different report is refused.
async fn replay(db: &PgPool, report: &Report) -> Result<Option<Uuid>, AppError> {
    let Some(row) = sqlx::query(
        "SELECT id, allotment_id, destination_id, sku_code, pieces, reason, note,
                pick_session_id, count_id
           FROM dc_short_pick
          WHERE idempotency_key = $1",
    )
    .bind(&report.idempotency_key)
    .fetch_optional(db)
    .await?
    else {
        return Ok(None);
    };
    let same = row.try_get::<Uuid, _>("allotment_id")? == report.allotment_id
        && row.try_get::<String, _>("destination_id")? == report.destination_id
        && row.try_get::<String, _>("sku_code")? == report.sku_code
        && row.try_get::<i64, _>("pieces")? == report.pieces
        && row.try_get::<String, _>("reason")? == report.reason.as_str()
        && row.try_get::<Option<String>, _>("note")? == report.note
        && row.try_get::<Option<Uuid>, _>("pick_session_id")? == report.pick_session_id
        && row.try_get::<Option<String>, _>("count_id")?
            == report.count_id.map(|id| id.to_string());
    if !same {
        return Err(AppError::Conflict(
            "idempotency key was already used with a different request payload".into(),
        ));
    }
    Ok(Some(row.try_get("id")?))
}

/// One report, read back the way the list reads it.
async fn one(db: &PgPool, id: Uuid) -> Result<ShortPick, AppError> {
    read(db, None, Some(id))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound(format!("short pick {id}")))
}

/// A picker reports why a line could not be finished.
///
/// Checked against the line as it stands: the allotment is the cloud-run
/// Gudang's, it allots this SKU to this shop from here, and no more pieces
/// are reported short than are still to pick. Written once per idempotency
/// key; a second delivery answers with the first report.
async fn report_short_pick(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ReportShortPickRequest>,
) -> Result<(StatusCode, Json<ShortPick>), AppError> {
    common::require_hosted()?;
    let reported_by = principal.username.trim().to_owned();
    if reported_by.is_empty() {
        return Err(AppError::Unauthorized(
            "the Gudang's work is done by somebody signed in".into(),
        ));
    }
    let report = normalise(request)?;
    // Before the checks: by the time a retry arrives the remainder may have
    // been picked, and the report it repeats is still the answer.
    if let Some(id) = replay(&state.db, &report).await? {
        return Ok((StatusCode::CREATED, Json(one(&state.db, id).await?)));
    }
    let site = common::gudang_site(&state.db).await?;

    let mut tx = state.db.begin().await?;
    let header = sqlx::query(
        "SELECT allotment_number, activation_target_origin_id FROM allotment WHERE id = $1",
    )
    .bind(report.allotment_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("allotment {}", report.allotment_id)))?;
    let allotment_number: String = header.try_get("allotment_number")?;
    if header
        .try_get::<Option<String>, _>("activation_target_origin_id")?
        .is_some()
    {
        return Err(AppError::Conflict(format!(
            "Edge-owned allotment {allotment_number}: its Gudang reports short picks on its own server"
        )));
    }
    let sku = sqlx::query("SELECT id, sku_code FROM sku WHERE sku_code = $1")
        .bind(&report.sku_code)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Validation(format!("{} is not a SKU", report.sku_code)))?;
    let sku_id: Uuid = sku.try_get("id")?;
    let sku_code: String = sku.try_get("sku_code")?;

    let figures = sqlx::query(&format!(
        "SELECT COUNT(*)::bigint AS lines,
                COALESCE(SUM({TO_PICK}), 0)::bigint AS to_pick,
                COALESCE(SUM(commitment.closed_short_total), 0)::bigint AS closed_short
           FROM allotment_line line
           JOIN allotment header ON header.id = line.allotment_id
           JOIN allotment_line_commitment commitment ON commitment.allotment_line_id = line.id
           LEFT JOIN ({WAITING_BY_LINE}) waiting ON waiting.allotment_line_id = line.id
          WHERE line.allotment_id = $1
            AND line.destination_id = $2
            AND line.sku_id = $3
            AND line.source_site_id = $4
            AND header.type = 'TO_SITE'
            AND line.destination_type = 'STORE'"
    ))
    .bind(report.allotment_id)
    .bind(&report.destination_id)
    .bind(sku_id)
    .bind(&site)
    .fetch_one(&mut *tx)
    .await?;
    if figures.try_get::<i64, _>("lines")? == 0 {
        return Err(AppError::Validation(format!(
            "{allotment_number} allots no {sku_code} to {} from this Gudang",
            report.destination_id
        )));
    }
    let to_pick: i64 = figures.try_get("to_pick")?;
    if report.pieces > to_pick {
        return Err(AppError::Conflict(format!(
            "Only {to_pick} of {sku_code} {} still to pick for {} on {allotment_number}.",
            if to_pick == 1 { "is" } else { "are" },
            report.destination_id
        )));
    }
    let closed_short: i64 = figures.try_get("closed_short")?;

    if let Some(session_id) = report.pick_session_id {
        let known: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM dc_pick_session WHERE session_id = $1)",
        )
        .bind(session_id)
        .fetch_one(&mut *tx)
        .await?;
        if !known {
            return Err(AppError::Validation(format!(
                "{session_id} is not a picklist"
            )));
        }
    }
    if let Some(count_id) = report.count_id {
        let known: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM official_count WHERE id = $1)")
                .bind(count_id)
                .fetch_one(&mut *tx)
                .await?;
        if !known {
            return Err(AppError::Validation(format!("{count_id} is not a count")));
        }
    }

    let inserted: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO dc_short_pick
             (id, allotment_id, destination_id, sku_code, pieces, reason, note,
              pick_session_id, count_id, reported_by, reported_at, idempotency_key,
              closed_short_at_report)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id",
    )
    .bind(Uuid::new_v4())
    .bind(report.allotment_id)
    .bind(&report.destination_id)
    .bind(&sku_code)
    .bind(report.pieces)
    .bind(report.reason.as_str())
    .bind(&report.note)
    .bind(report.pick_session_id)
    .bind(report.count_id.map(|id| id.to_string()))
    .bind(&reported_by)
    .bind(state.clock.now())
    .bind(&report.idempotency_key)
    .bind(closed_short.max(0))
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;

    // Lost the race to a delivery of the same key a moment earlier: that
    // one's report is the answer.
    let id = match inserted {
        Some(id) => id,
        None => replay(&state.db, &report).await?.ok_or_else(|| {
            AppError::Conflict("the short pick was written and is gone again".into())
        })?,
    };
    Ok((StatusCode::CREATED, Json(one(&state.db, id).await?)))
}

/// MD answers **Continue** on the reports of one review: the picker tries
/// again. Written once per report — a report already answered keeps its first
/// answer, so a second delivery changes nothing. A report with nothing left
/// to pick is not written: it is no longer MD's to answer (picked or closed
/// meanwhile). Answers with the reports as they stand now.
async fn continue_short_picks(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ContinueShortPicksRequest>,
) -> Result<Json<ShortPickList>, AppError> {
    common::require_hosted()?;
    let by = principal.username.trim().to_owned();
    if by.is_empty() {
        return Err(AppError::Unauthorized(
            "MD's review is answered by somebody signed in".into(),
        ));
    }
    if request.ids.is_empty() {
        return Err(AppError::Validation(
            "ids is required: the short picks MD answers".into(),
        ));
    }
    let mut items = Vec::with_capacity(request.ids.len());
    let mut tx = state.db.begin().await?;
    for id in request.ids.iter().copied() {
        let report = read(&mut *tx, None, Some(id))
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::NotFound(format!("short pick {id}")))?;
        if report.still_short > 0 && report.continued_at.is_none() {
            sqlx::query(
                "UPDATE dc_short_pick
                    SET continued_by = $2, continued_at = $3
                  WHERE id = $1 AND continued_at IS NULL",
            )
            .bind(id)
            .bind(&by)
            .bind(state.clock.now())
            .execute(&mut *tx)
            .await?;
        }
        items.push(id);
    }
    tx.commit().await?;
    let mut read_back = Vec::with_capacity(items.len());
    for id in items {
        read_back.push(one(&state.db, id).await?);
    }
    Ok(Json(ShortPickList { items: read_back }))
}

#[cfg(test)]
mod tests {
    use super::{status_of, ShortPickStatus};

    #[test]
    fn continue_answers_a_short_pick_until_nothing_is_left_to_pick() {
        assert_eq!(
            status_of(2, 0, true, false, false),
            ShortPickStatus::Continued
        );
        assert_eq!(
            status_of(2, 0, true, true, true),
            ShortPickStatus::Continued
        );
        assert_eq!(status_of(0, 0, true, false, false), ShortPickStatus::Picked);
        assert_eq!(status_of(0, 2, true, false, false), ShortPickStatus::Closed);
        assert_eq!(status_of(2, 0, false, true, true), ShortPickStatus::Lost);
        assert_eq!(status_of(2, 0, false, false, false), ShortPickStatus::Open);
        assert!(!ShortPickStatus::Continued.flagged());
    }
}
