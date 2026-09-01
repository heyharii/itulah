//! Outbound containment: koli, shipment, dispatch, and the sessions that
//! produce them.
//!
//! The question this module answers is "what is inside what". Where a unit sits
//! physically is the ledger's job; how far along it is falls out of containment
//! and is never stored:
//!
//! | state                            | reads as   |
//! |----------------------------------|------------|
//! | koli.shipment_id IS NULL         | PACKED     |
//! | shipment.dispatch_id IS NULL     | SHIPMENT   |
//! | dispatch.departed_at IS NULL     | LOADED     |
//! | dispatch.departed_at IS NOT NULL | IN_TRANSIT |
//!
//! Two shapes live here and they are deliberately not alike. A *session* is
//! work a person performs over time — it has an actor, a start, an end, and it
//! produces things. A *grouping* is an act of selection: no duration and no
//! worker on duty, it only gathers what already exists. Picking and packing are
//! sessions; shipment and dispatch are groupings.

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

use super::contracts::EdgeError;
use super::printing::LABEL_BRAND;
use super::zpl::{render_koli_label, KoliLabelData, LabelBrand, LabelSize};
use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};

/// Which counter to draw from. Numbers are minted here at the DC; the site
/// inside each one is what keeps them unique across the fleet without a
/// central allocator handing them out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NumberKind {
    Koli,
    Shipment,
    Dispatch,
}

impl NumberKind {
    const fn key(self) -> &'static str {
        match self {
            Self::Koli => "KOLI",
            Self::Shipment => "SHIPMENT",
            Self::Dispatch => "DISPATCH",
        }
    }

    const fn prefix(self) -> &'static str {
        match self {
            Self::Koli => "KOLI",
            // The surat jalan number: it is what a store signs against.
            Self::Shipment => "SJ",
            Self::Dispatch => "DSP",
        }
    }
}

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Configuration(format!("sqlite: {error}"))
}

fn now_text() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// Take the next number of its kind, bumping the counter in the same
/// transaction that writes the row it belongs to. Two boxes sealed at the same
/// instant get adjacent numbers, never equal ones.
pub fn next_number(
    tx: &Transaction<'_>,
    kind: NumberKind,
    site_id: &str,
) -> Result<String, EdgeError> {
    tx.execute(
        "UPDATE outbound_number_counter SET last_number = last_number + 1 WHERE kind = ?1",
        params![kind.key()],
    )
    .map_err(db)?;
    let last: i64 = tx
        .query_row(
            "SELECT last_number FROM outbound_number_counter WHERE kind = ?1",
            params![kind.key()],
            |row| row.get(0),
        )
        .map_err(db)?;
    Ok(format!("{}-{}-{:06}", kind.prefix(), site_id, last))
}

/// Render a payload as an inline SVG QR code.
///
/// Generated here at the server, never in the browser, for the same reason the
/// centre computes every EPC string rather than letting the edge do it: one
/// encoder, in one place. A second implementation that drifts by a module
/// produces a code that scans everywhere except the one warehouse that has the
/// other version.
///
/// Error correction level Q, not the usual M. Q tolerates about a quarter of
/// the symbol being unreadable against M's fifteen percent, and these are stuck
/// to cardboard that gets scuffed, taped over, and rained on between the DC
/// door and the shop floor. The payloads are short, so the extra redundancy
/// costs nothing that matters.
pub fn qr_svg(payload: &str) -> Result<String, EdgeError> {
    let code = QrCode::with_error_correction_level(payload, EcLevel::Q)
        .map_err(|error| EdgeError::Configuration(format!("cannot encode QR: {error}")))?;
    Ok(code
        .render()
        .min_dimensions(140, 140)
        .quiet_zone(true)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Session {
    pub session_id: String,
    pub actor_id: String,
    pub started_at: String,
    pub closed_at: Option<String>,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenSessionRequest {
    #[serde(default)]
    pub actor_id: String,
    pub note: Option<String>,
}

/// Which of the two session tables to act on. They have the same shape and
/// different meanings, so they get one code path and two names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionKind {
    Pick,
    Packing,
}

impl SessionKind {
    const fn table(self) -> &'static str {
        match self {
            Self::Pick => "pick_session",
            Self::Packing => "packing_session",
        }
    }

    const fn actor_column(self) -> &'static str {
        match self {
            Self::Pick => "picker_id",
            Self::Packing => "packer_id",
        }
    }
}

pub fn open_session(
    connection: &mut Connection,
    kind: SessionKind,
    request: OpenSessionRequest,
) -> Result<Session, EdgeError> {
    if request.actor_id.trim().is_empty() {
        return Err(EdgeError::Validation("actor is required".into()));
    }
    let session_id = Uuid::new_v4().to_string();
    let now = now_text();
    connection
        .execute(
            &format!(
                "INSERT INTO {} (session_id,{},started_at,status,note)
                 VALUES(?1,?2,?3,'OPEN',?4)",
                kind.table(),
                kind.actor_column()
            ),
            params![session_id, request.actor_id.trim(), now, request.note],
        )
        .map_err(db)?;
    load_session(connection, kind, &session_id)
}

pub fn close_session(
    connection: &mut Connection,
    kind: SessionKind,
    session_id: &str,
) -> Result<Session, EdgeError> {
    let now = now_text();
    let changed = connection
        .execute(
            &format!(
                "UPDATE {} SET status='CLOSED', closed_at=?2
                  WHERE session_id=?1 AND status='OPEN'",
                kind.table()
            ),
            params![session_id, now],
        )
        // The trigger that refuses to close a packing session holding an
        // unsealed koli surfaces here, and it is a conflict rather than a bug.
        .map_err(|error| match error {
            rusqlite::Error::SqliteFailure(_, Some(ref message))
                if message.contains("unsealed koli") =>
            {
                EdgeError::Conflict(message.clone())
            }
            other => db(other),
        })?;
    if changed == 0 {
        // Either it does not exist or it was already closed; load says which.
        let existing = load_session(connection, kind, session_id)?;
        return Err(EdgeError::Conflict(format!(
            "session {session_id} is already {}",
            existing.status
        )));
    }
    load_session(connection, kind, session_id)
}

pub fn load_session(
    connection: &Connection,
    kind: SessionKind,
    session_id: &str,
) -> Result<Session, EdgeError> {
    connection
        .query_row(
            &format!(
                "SELECT session_id,{},started_at,closed_at,status FROM {} WHERE session_id=?1",
                kind.actor_column(),
                kind.table()
            ),
            params![session_id],
            |row| {
                Ok(Session {
                    session_id: row.get(0)?,
                    actor_id: row.get(1)?,
                    started_at: row.get(2)?,
                    closed_at: row.get(3)?,
                    status: row.get(4)?,
                })
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                EdgeError::NotFound(format!("session {session_id}"))
            }
            other => db(other),
        })
}

// ---------------------------------------------------------------------------
// Koli
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Koli {
    pub koli_id: String,
    pub koli_number: String,
    pub destination_store_id: String,
    pub packing_session_id: Option<String>,
    pub shipment_id: Option<String>,
    pub sealed_at: Option<String>,
    pub sealed_by: Option<String>,
    /// Derived, never stored.
    pub position: String,
    pub unit_count: i64,
}

/// What is in the box, and what the label on it should say.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct KoliManifest {
    pub koli: Koli,
    /// The QR carried on the sticker, following the house convention that the
    /// SKU QR already uses: a short prefix, then the number.
    pub qr_payload: String,
    /// The same payload as a scannable QR, rendered server-side as inline SVG
    /// for the packing list. The sticker's Code 128 is what a laser scanner
    /// reads; this is what a phone camera reads.
    pub qr_svg: String,
    /// The sticker for the outside of the box, ready for the label printer.
    /// Carried with the manifest so a caller never has to render it twice and
    /// risk the two disagreeing.
    pub label_zpl: String,
    pub lines: Vec<ManifestLine>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ManifestLine {
    pub sku_code: String,
    pub allotment_id: String,
    pub allotment_line_id: String,
    pub quantity: i64,
}

/// Put a box under the run that produced it.
pub fn assign_koli_to_session(
    connection: &mut Connection,
    koli_id: &str,
    packing_session_id: &str,
) -> Result<Koli, EdgeError> {
    let open: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM packing_session WHERE session_id=?1 AND status='OPEN'",
            params![packing_session_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if open == 0 {
        return Err(EdgeError::Conflict(format!(
            "packing session {packing_session_id} is not open"
        )));
    }
    let changed = connection
        .execute(
            "UPDATE koli SET packing_session_id=?2, updated_at=?3
              WHERE koli_id=?1 AND sealed_at IS NULL",
            params![koli_id, packing_session_id, now_text()],
        )
        .map_err(db)?;
    if changed == 0 {
        return Err(EdgeError::Conflict(format!(
            "koli {koli_id} is missing or already sealed"
        )));
    }
    load_koli(connection, koli_id)
}

/// Close the box. From here its contents are final, which is what makes a
/// printed packing list worth trusting.
pub fn seal_koli(
    connection: &mut Connection,
    koli_id: &str,
    sealed_by: &str,
) -> Result<KoliManifest, EdgeError> {
    if sealed_by.trim().is_empty() {
        return Err(EdgeError::Validation("sealer is required".into()));
    }
    let units: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM koli_unit WHERE koli_id=?1",
            params![koli_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if units == 0 {
        // An empty sealed box is a packing list describing nothing, and a
        // number that will be looked for on arrival and never explained.
        return Err(EdgeError::Validation(format!(
            "koli {koli_id} is empty; nothing to seal"
        )));
    }
    let now = now_text();
    let changed = connection
        .execute(
            "UPDATE koli SET sealed_at=?2, sealed_by=?3, updated_at=?2
              WHERE koli_id=?1 AND sealed_at IS NULL",
            params![koli_id, now, sealed_by.trim()],
        )
        .map_err(db)?;
    if changed == 0 {
        return Err(EdgeError::Conflict(format!(
            "koli {koli_id} is missing or already sealed"
        )));
    }
    koli_manifest(connection, koli_id)
}

pub fn load_koli(connection: &Connection, koli_id: &str) -> Result<Koli, EdgeError> {
    connection
        .query_row(
            "SELECT k.koli_id,k.koli_number,k.destination_store_id,k.packing_session_id,
                    k.shipment_id,k.sealed_at,k.sealed_by,
                    (SELECT COUNT(*) FROM koli_unit WHERE koli_id=k.koli_id),
                    CASE
                        WHEN k.shipment_id IS NULL THEN 'PACKED'
                        WHEN s.dispatch_id IS NULL THEN 'SHIPMENT'
                        WHEN d.departed_at IS NULL THEN 'LOADED'
                        ELSE 'IN_TRANSIT'
                    END
               FROM koli k
               LEFT JOIN shipment s ON s.shipment_id = k.shipment_id
               LEFT JOIN dispatch d ON d.dispatch_id = s.dispatch_id
              WHERE k.koli_id=?1",
            params![koli_id],
            |row| {
                Ok(Koli {
                    koli_id: row.get(0)?,
                    koli_number: row.get(1)?,
                    destination_store_id: row.get(2)?,
                    packing_session_id: row.get(3)?,
                    shipment_id: row.get(4)?,
                    sealed_at: row.get(5)?,
                    sealed_by: row.get(6)?,
                    unit_count: row.get(7)?,
                    position: row.get(8)?,
                })
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => EdgeError::NotFound(format!("koli {koli_id}")),
            other => db(other),
        })
}

pub fn koli_manifest(connection: &Connection, koli_id: &str) -> Result<KoliManifest, EdgeError> {
    let koli = load_koli(connection, koli_id)?;
    let mut statement = connection
        .prepare(
            "SELECT sku_code,allotment_id,allotment_line_id,COUNT(*)
               FROM koli_unit WHERE koli_id=?1
              GROUP BY sku_code,allotment_id,allotment_line_id
              ORDER BY sku_code",
        )
        .map_err(db)?;
    let lines = statement
        .query_map(params![koli_id], |row| {
            Ok(ManifestLine {
                sku_code: row.get(0)?,
                allotment_id: row.get(1)?,
                allotment_line_id: row.get(2)?,
                quantity: row.get(3)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let qr_payload = format!("K1:{}", koli.koli_number);
    let label_zpl = render_koli_label(
        &KoliLabelData {
            koli_number: &koli.koli_number,
            destination_store_id: &koli.destination_store_id,
            unit_count: koli.unit_count,
            sealed_at: koli.sealed_at.as_deref(),
        },
        LabelSize::default(),
        LabelBrand(LABEL_BRAND),
    );
    let qr_svg = qr_svg(&qr_payload)?;
    Ok(KoliManifest {
        koli,
        qr_payload,
        qr_svg,
        label_zpl,
        lines,
    })
}

// ---------------------------------------------------------------------------
// Groupings
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Shipment {
    pub shipment_id: String,
    pub shipment_number: String,
    pub destination_store_id: String,
    pub dispatch_id: Option<String>,
    pub koli_count: i64,
    pub unit_count: i64,
    pub position: String,
}

/// Where to send a koli sticker.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrintKoliLabelRequest {
    pub printer_host: String,
    #[serde(default = "default_printer_port")]
    pub printer_port: u16,
}

const fn default_printer_port() -> u16 {
    9100
}

/// Render this box's sticker and put it on the printer.
pub fn print_koli_label(
    connection: &Connection,
    koli_id: &str,
    request: &PrintKoliLabelRequest,
) -> Result<KoliManifest, EdgeError> {
    let manifest = koli_manifest(connection, koli_id)?;
    super::printing::send_document(
        &request.printer_host,
        request.printer_port,
        &manifest.label_zpl,
    )?;
    Ok(manifest)
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateShipmentRequest {
    pub koli_ids: Vec<String>,
    #[serde(default)]
    pub actor_id: String,
}

/// Gather sealed koli into one consignment. Every box must be going to the same
/// store: a surat jalan is signed by one store, so it can only describe one.
pub fn create_shipment(
    connection: &mut Connection,
    site_id: &str,
    request: CreateShipmentRequest,
) -> Result<Shipment, EdgeError> {
    if request.koli_ids.is_empty() {
        return Err(EdgeError::Validation(
            "a shipment needs at least one koli".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(EdgeError::Validation("actor is required".into()));
    }

    let tx = connection.transaction().map_err(db)?;
    let mut destination: Option<String> = None;
    for koli_id in &request.koli_ids {
        let row: Option<(String, Option<String>, Option<String>)> = tx
            .query_row(
                "SELECT destination_store_id,sealed_at,shipment_id FROM koli WHERE koli_id=?1",
                params![koli_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db)?;
        let (store, sealed_at, existing) =
            row.ok_or_else(|| EdgeError::NotFound(format!("koli {koli_id}")))?;
        if sealed_at.is_none() {
            return Err(EdgeError::Conflict(format!(
                "koli {koli_id} is not sealed yet"
            )));
        }
        if let Some(existing) = existing {
            return Err(EdgeError::Conflict(format!(
                "koli {koli_id} already belongs to shipment {existing}"
            )));
        }
        match &destination {
            None => destination = Some(store),
            Some(first) if first != &store => {
                return Err(EdgeError::Validation(format!(
                    "koli in one shipment must share a destination: {first} and {store}"
                )));
            }
            Some(_) => {}
        }
    }
    let destination = destination.unwrap_or_default();

    let shipment_id = Uuid::new_v4().to_string();
    let number = next_number(&tx, NumberKind::Shipment, site_id)?;
    let now = now_text();
    tx.execute(
        "INSERT INTO shipment
             (shipment_id,shipment_number,destination_store_id,created_by,created_at)
         VALUES(?1,?2,?3,?4,?5)",
        params![
            shipment_id,
            number,
            destination,
            request.actor_id.trim(),
            now
        ],
    )
    .map_err(db)?;
    for koli_id in &request.koli_ids {
        tx.execute(
            "UPDATE koli SET shipment_id=?2, updated_at=?3 WHERE koli_id=?1",
            params![koli_id, shipment_id, now],
        )
        .map_err(db)?;
    }
    tx.commit().map_err(db)?;
    load_shipment(connection, &shipment_id)
}

pub fn load_shipment(connection: &Connection, shipment_id: &str) -> Result<Shipment, EdgeError> {
    connection
        .query_row(
            "SELECT s.shipment_id,s.shipment_number,s.destination_store_id,s.dispatch_id,
                    (SELECT COUNT(*) FROM koli WHERE shipment_id=s.shipment_id),
                    (SELECT COUNT(*) FROM koli_unit u JOIN koli k ON k.koli_id=u.koli_id
                      WHERE k.shipment_id=s.shipment_id),
                    CASE
                        WHEN s.dispatch_id IS NULL THEN 'SHIPMENT'
                        WHEN d.departed_at IS NULL THEN 'LOADED'
                        ELSE 'IN_TRANSIT'
                    END
               FROM shipment s
               LEFT JOIN dispatch d ON d.dispatch_id = s.dispatch_id
              WHERE s.shipment_id=?1",
            params![shipment_id],
            |row| {
                Ok(Shipment {
                    shipment_id: row.get(0)?,
                    shipment_number: row.get(1)?,
                    destination_store_id: row.get(2)?,
                    dispatch_id: row.get(3)?,
                    koli_count: row.get(4)?,
                    unit_count: row.get(5)?,
                    position: row.get(6)?,
                })
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                EdgeError::NotFound(format!("shipment {shipment_id}"))
            }
            other => db(other),
        })
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Dispatch {
    pub dispatch_id: String,
    pub dispatch_number: String,
    pub carrier: Option<String>,
    pub vehicle_plate: Option<String>,
    pub driver_name: Option<String>,
    pub departed_at: Option<String>,
    pub shipment_count: i64,
    pub koli_count: i64,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateDispatchRequest {
    pub shipment_ids: Vec<String>,
    pub carrier: Option<String>,
    pub vehicle_plate: Option<String>,
    pub driver_name: Option<String>,
    #[serde(default)]
    pub actor_id: String,
}

/// Load consignments onto one truck run. Unlike a shipment, a dispatch may
/// serve many stores — that is the whole point of a truck.
pub fn create_dispatch(
    connection: &mut Connection,
    site_id: &str,
    request: CreateDispatchRequest,
) -> Result<Dispatch, EdgeError> {
    if request.shipment_ids.is_empty() {
        return Err(EdgeError::Validation(
            "a dispatch needs at least one shipment".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(EdgeError::Validation("actor is required".into()));
    }

    let tx = connection.transaction().map_err(db)?;
    for shipment_id in &request.shipment_ids {
        let existing: Option<Option<String>> = tx
            .query_row(
                "SELECT dispatch_id FROM shipment WHERE shipment_id=?1",
                params![shipment_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db)?;
        let existing =
            existing.ok_or_else(|| EdgeError::NotFound(format!("shipment {shipment_id}")))?;
        if let Some(existing) = existing {
            return Err(EdgeError::Conflict(format!(
                "shipment {shipment_id} is already on dispatch {existing}"
            )));
        }
    }

    let dispatch_id = Uuid::new_v4().to_string();
    let number = next_number(&tx, NumberKind::Dispatch, site_id)?;
    let now = now_text();
    tx.execute(
        "INSERT INTO dispatch
             (dispatch_id,dispatch_number,carrier,vehicle_plate,driver_name,created_by,created_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            dispatch_id,
            number,
            request.carrier,
            request.vehicle_plate,
            request.driver_name,
            request.actor_id.trim(),
            now
        ],
    )
    .map_err(db)?;
    for shipment_id in &request.shipment_ids {
        tx.execute(
            "UPDATE shipment SET dispatch_id=?2 WHERE shipment_id=?1",
            params![shipment_id, dispatch_id],
        )
        .map_err(db)?;
    }
    tx.commit().map_err(db)?;
    load_dispatch(connection, &dispatch_id)
}

/// The truck leaves. This is the one stage change in the whole outbound flow
/// that corresponds to goods moving in the physical world.
pub fn depart_dispatch(
    connection: &mut Connection,
    dispatch_id: &str,
) -> Result<Dispatch, EdgeError> {
    let shipments: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM shipment WHERE dispatch_id=?1",
            params![dispatch_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if shipments == 0 {
        return Err(EdgeError::Validation(format!(
            "dispatch {dispatch_id} carries nothing"
        )));
    }
    let changed = connection
        .execute(
            "UPDATE dispatch SET departed_at=?2 WHERE dispatch_id=?1 AND departed_at IS NULL",
            params![dispatch_id, now_text()],
        )
        .map_err(db)?;
    if changed == 0 {
        return Err(EdgeError::Conflict(format!(
            "dispatch {dispatch_id} is missing or has already departed"
        )));
    }
    load_dispatch(connection, dispatch_id)
}

pub fn load_dispatch(connection: &Connection, dispatch_id: &str) -> Result<Dispatch, EdgeError> {
    connection
        .query_row(
            "SELECT d.dispatch_id,d.dispatch_number,d.carrier,d.vehicle_plate,d.driver_name,
                    d.departed_at,
                    (SELECT COUNT(*) FROM shipment WHERE dispatch_id=d.dispatch_id),
                    (SELECT COUNT(*) FROM koli k JOIN shipment s ON s.shipment_id=k.shipment_id
                      WHERE s.dispatch_id=d.dispatch_id)
               FROM dispatch d WHERE d.dispatch_id=?1",
            params![dispatch_id],
            |row| {
                Ok(Dispatch {
                    dispatch_id: row.get(0)?,
                    dispatch_number: row.get(1)?,
                    carrier: row.get(2)?,
                    vehicle_plate: row.get(3)?,
                    driver_name: row.get(4)?,
                    departed_at: row.get(5)?,
                    shipment_count: row.get(6)?,
                    koli_count: row.get(7)?,
                })
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                EdgeError::NotFound(format!("dispatch {dispatch_id}"))
            }
            other => db(other),
        })
}

// ---------------------------------------------------------------------------
// The questions this was all for
// ---------------------------------------------------------------------------

/// How far along one allotment line is, counted from containment rather than
/// read off a tally kept beside it.
#[derive(Debug, Serialize, Default, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LinePosition {
    pub packed: i64,
    pub in_shipment: i64,
    /// On the truck, still on the yard. Named for what happened rather than
    /// for the entity that happened to it: "dispatched" reads as gone, and
    /// these have not gone.
    pub loaded: i64,
    pub in_transit: i64,
}

pub fn allotment_line_position(
    connection: &Connection,
    allotment_line_id: &str,
) -> Result<LinePosition, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT CASE
                        WHEN k.shipment_id IS NULL THEN 'PACKED'
                        WHEN s.dispatch_id IS NULL THEN 'SHIPMENT'
                        WHEN d.departed_at IS NULL THEN 'LOADED'
                        ELSE 'IN_TRANSIT'
                    END AS position,
                    COUNT(*)
               FROM koli_unit u
               JOIN koli k ON k.koli_id = u.koli_id
               LEFT JOIN shipment s ON s.shipment_id = k.shipment_id
               LEFT JOIN dispatch d ON d.dispatch_id = s.dispatch_id
              WHERE u.allotment_line_id = ?1
              GROUP BY position",
        )
        .map_err(db)?;
    let rows = statement
        .query_map(params![allotment_line_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;

    let mut position = LinePosition::default();
    for (bucket, count) in rows {
        match bucket.as_str() {
            "PACKED" => position.packed = count,
            "SHIPMENT" => position.in_shipment = count,
            "LOADED" => position.loaded = count,
            "IN_TRANSIT" => position.in_transit = count,
            _ => {}
        }
    }
    Ok(position)
}

/// One SKU as it came off its rack, and how many trips it took.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PickedLine {
    pub sku_code: String,
    pub picked: i64,
    /// More than one when a picker came back to the same rack — a rack that
    /// keeps needing second trips is a rack in the wrong place.
    pub events: i64,
}

/// "This trip round the racks, what came back?"
///
/// A picker does not walk out for one SKU. They take the sheet of everything
/// still owed, walk the aisles once, and confirm each SKU as it comes off its
/// rack. The event stays per SKU because that is the unit of what happens at a
/// rack; this is what gathers them into the round they belonged to.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PickSessionSummary {
    pub session: Session,
    pub sku_count: i64,
    pub total_picked: i64,
    pub lines: Vec<PickedLine>,
}

pub fn pick_session_summary(
    connection: &Connection,
    session_id: &str,
) -> Result<PickSessionSummary, EdgeError> {
    let session = load_session(connection, SessionKind::Pick, session_id)?;
    let mut statement = connection
        .prepare(
            "SELECT sku_code, SUM(quantity), COUNT(*)
               FROM dc_pick_event
              WHERE pick_session_id = ?1
              GROUP BY sku_code
              ORDER BY sku_code",
        )
        .map_err(db)?;
    let lines = statement
        .query_map(params![session_id], |row| {
            Ok(PickedLine {
                sku_code: row.get(0)?,
                picked: row.get(1)?,
                events: row.get(2)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    Ok(PickSessionSummary {
        session,
        sku_count: i64::try_from(lines.len()).unwrap_or(i64::MAX),
        total_picked: lines.iter().map(|line| line.picked).sum(),
        lines,
    })
}

/// "These 200 pieces became how many boxes, and what is in each?"
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PackingSessionSummary {
    pub session: Session,
    pub koli_count: i64,
    pub unit_count: i64,
    pub unsealed_count: i64,
    pub koli: Vec<Koli>,
}

pub fn packing_session_summary(
    connection: &Connection,
    session_id: &str,
) -> Result<PackingSessionSummary, EdgeError> {
    let session = load_session(connection, SessionKind::Packing, session_id)?;
    let mut statement = connection
        .prepare("SELECT koli_id FROM koli WHERE packing_session_id=?1 ORDER BY koli_number")
        .map_err(db)?;
    let ids = statement
        .query_map(params![session_id], |row| row.get::<_, String>(0))
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(statement);

    let mut koli = Vec::with_capacity(ids.len());
    for id in ids {
        koli.push(load_koli(connection, &id)?);
    }
    let unit_count = koli.iter().map(|k| k.unit_count).sum();
    let unsealed_count = koli.iter().filter(|k| k.sealed_at.is_none()).count();
    Ok(PackingSessionSummary {
        session,
        koli_count: i64::try_from(koli.len()).unwrap_or(i64::MAX),
        unit_count,
        unsealed_count: i64::try_from(unsealed_count).unwrap_or(i64::MAX),
        koli,
    })
}

// ---------------------------------------------------------------------------
// What the printed documents are made of
// ---------------------------------------------------------------------------

/// One line of a picklist: fetch this much of this SKU.
///
/// No destination. Which store each piece serves is decided when it goes into
/// a box, so a picker walks the racks with a SKU and a number and nothing else
/// to get wrong.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PicklistLine {
    pub sku_code: String,
    pub outstanding: i64,
    /// How many allotment lines are waiting on this SKU. Shown so a picker who
    /// comes back short knows the shortfall lands on more than one store.
    pub allotment_lines: i64,
}

/// Everything still owed across open allotments, added up by SKU.
pub fn picklist(connection: &Connection) -> Result<Vec<PicklistLine>, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT sku_code,
                    SUM(accepted_quantity - picked_quantity - cancelled_quantity) AS outstanding,
                    COUNT(*)
               FROM dc_allotment_work_line
              WHERE accepted_quantity - picked_quantity - cancelled_quantity > 0
              GROUP BY sku_code
              ORDER BY outstanding DESC, sku_code",
        )
        .map_err(db)?;
    let lines = statement
        .query_map([], |row| {
            Ok(PicklistLine {
                sku_code: row.get(0)?,
                outstanding: row.get(1)?,
                allotment_lines: row.get(2)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    Ok(lines)
}

/// The surat jalan: one consignment, the boxes in it, and what is in them.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ShipmentDetail {
    pub shipment: Shipment,
    /// Scanned at the store to open the whole consignment at once, rather than
    /// one box at a time.
    pub qr_payload: String,
    pub qr_svg: String,
    pub koli: Vec<KoliManifest>,
}

pub fn shipment_detail(
    connection: &Connection,
    shipment_id: &str,
) -> Result<ShipmentDetail, EdgeError> {
    let shipment = load_shipment(connection, shipment_id)?;
    let mut statement = connection
        .prepare("SELECT koli_id FROM koli WHERE shipment_id=?1 ORDER BY koli_number")
        .map_err(db)?;
    let ids = statement
        .query_map(params![shipment_id], |row| row.get::<_, String>(0))
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(statement);
    let mut koli = Vec::with_capacity(ids.len());
    for id in ids {
        koli.push(koli_manifest(connection, &id)?);
    }
    let qr_payload = format!("S1:{}", shipment.shipment_number);
    let qr_svg = qr_svg(&qr_payload)?;
    Ok(ShipmentDetail {
        shipment,
        qr_payload,
        qr_svg,
        koli,
    })
}

/// The loading manifest: one truck run and every consignment on it.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DispatchDetail {
    pub dispatch: Dispatch,
    pub shipments: Vec<Shipment>,
}

pub fn dispatch_detail(
    connection: &Connection,
    dispatch_id: &str,
) -> Result<DispatchDetail, EdgeError> {
    let dispatch = load_dispatch(connection, dispatch_id)?;
    let mut statement = connection
        .prepare("SELECT shipment_id FROM shipment WHERE dispatch_id=?1 ORDER BY shipment_number")
        .map_err(db)?;
    let ids = statement
        .query_map(params![dispatch_id], |row| row.get::<_, String>(0))
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(statement);
    let mut shipments = Vec::with_capacity(ids.len());
    for id in ids {
        shipments.push(load_shipment(connection, &id)?);
    }
    Ok(DispatchDetail {
        dispatch,
        shipments,
    })
}

// ---------------------------------------------------------------------------
// Packing a box: the target, the sweep, and the agreement between them
// ---------------------------------------------------------------------------

/// What is still picked and unpacked for a destination — the list a packer is
/// offered when opening a box.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OutstandingLine {
    pub sku_code: String,
    /// What this store still has coming, across all its open allotment lines.
    pub wanted: i64,
    /// What is actually off the racks and standing in the outbound area — for
    /// nobody in particular, since picking commits to no destination.
    pub available: i64,
    /// What can honestly go in a box right now: the smaller of the two.
    pub outstanding: i64,
}

/// What can go in a box for this store right now.
///
/// Two independent facts, deliberately kept apart until the last moment. What
/// the store still has coming lives on its allotment lines. What is physically
/// off the racks lives in the ledger, in the picking area, belonging to nobody
/// — picking commits to no destination.
///
/// A box can only hold the smaller of the two, and showing both is what lets a
/// packer tell "the store does not want more" apart from "nobody has fetched
/// it yet". Those call for very different next actions.
pub fn outstanding_for_destination(
    connection: &Connection,
    site_id: &str,
    destination_store_id: &str,
) -> Result<Vec<OutstandingLine>, EdgeError> {
    let picking = format!("{site_id}.outbound.picking:on_hand");
    let mut statement = connection
        .prepare(
            "SELECT want.sku_code, want.wanted, COALESCE(have.available, 0)
               FROM (SELECT sku_code,
                            SUM(accepted_quantity - packed_quantity - cancelled_quantity) AS wanted
                       FROM dc_allotment_work_line
                      WHERE destination_type = 'STORE' AND destination_id = ?1
                        AND accepted_quantity - packed_quantity - cancelled_quantity > 0
                      GROUP BY sku_code) want
               LEFT JOIN (SELECT subject.sku_code, SUM(projection.quantity) AS available
                            FROM inventory_projection projection
                            JOIN inventory_subject subject ON subject.id = projection.subject_id
                           WHERE projection.place_id = ?2 AND projection.quantity > 0
                           GROUP BY subject.sku_code) have
                 ON have.sku_code = want.sku_code
              ORDER BY want.sku_code",
        )
        .map_err(db)?;
    let lines = statement
        .query_map(params![destination_store_id, picking], |row| {
            let wanted: i64 = row.get(1)?;
            let available: i64 = row.get(2)?;
            Ok(OutstandingLine {
                sku_code: row.get(0)?,
                wanted,
                available,
                outstanding: wanted.min(available),
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    Ok(lines)
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenPackingBoxRequest {
    pub destination_store_id: String,
    /// What this box is meant to hold. Fixed when the session opens: a target
    /// edited to match the sweep is not a target.
    pub target: Vec<TargetLine>,
    #[serde(default)]
    pub actor_id: String,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TargetLine {
    pub sku_code: String,
    pub target_qty: i64,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PackingBox {
    pub session: Session,
    pub destination_store_id: String,
    pub koli_id: Option<String>,
    pub koli_number: Option<String>,
    pub target: Vec<TargetLine>,
    /// Set once a sweep has agreed with the target. Until then the box is
    /// still being filled and nothing may be printed from it.
    pub ready: bool,
}

pub fn open_packing_box(
    connection: &mut Connection,
    request: OpenPackingBoxRequest,
) -> Result<PackingBox, EdgeError> {
    if request.actor_id.trim().is_empty() {
        return Err(EdgeError::Validation("packer is required".into()));
    }
    if request.destination_store_id.trim().is_empty() {
        return Err(EdgeError::Validation("destination is required".into()));
    }
    if request.target.is_empty() {
        return Err(EdgeError::Validation(
            "a box needs a target; packing towards nothing cannot be checked".into(),
        ));
    }
    for line in &request.target {
        if line.target_qty <= 0 {
            return Err(EdgeError::Validation(format!(
                "target for {} must be positive",
                line.sku_code
            )));
        }
    }

    let session_id = Uuid::new_v4().to_string();
    let now = now_text();
    let tx = connection.transaction().map_err(db)?;
    tx.execute(
        "INSERT INTO packing_session
             (session_id,packer_id,started_at,status,note,destination_store_id)
         VALUES(?1,?2,?3,'OPEN',?4,?5)",
        params![
            session_id,
            request.actor_id.trim(),
            now,
            request.note,
            request.destination_store_id.trim()
        ],
    )
    .map_err(db)?;
    for line in &request.target {
        tx.execute(
            "INSERT INTO packing_session_target(session_id,sku_code,target_qty)
             VALUES(?1,?2,?3)",
            params![session_id, line.sku_code, line.target_qty],
        )
        .map_err(db)?;
    }
    tx.commit().map_err(db)?;
    load_packing_box(connection, &session_id)
}

pub fn load_packing_box(
    connection: &Connection,
    session_id: &str,
) -> Result<PackingBox, EdgeError> {
    let session = load_session(connection, SessionKind::Packing, session_id)?;
    let (destination, koli_id): (String, Option<String>) = connection
        .query_row(
            "SELECT COALESCE(destination_store_id,''),koli_id
               FROM packing_session WHERE session_id=?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(db)?;

    let mut statement = connection
        .prepare(
            "SELECT sku_code,target_qty FROM packing_session_target
              WHERE session_id=?1 ORDER BY sku_code",
        )
        .map_err(db)?;
    let target = statement
        .query_map(params![session_id], |row| {
            Ok(TargetLine {
                sku_code: row.get(0)?,
                target_qty: row.get(1)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(statement);

    let koli_number = match koli_id.as_deref() {
        Some(id) => Some(load_koli(connection, id)?.koli_number),
        None => None,
    };
    Ok(PackingBox {
        session,
        destination_store_id: destination,
        ready: koli_id.is_some(),
        koli_id,
        koli_number,
        target,
    })
}

/// One SKU as the target asked for it and the sweep found it.
#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CaptureLine {
    pub sku_code: String,
    pub target_qty: i64,
    pub scanned_qty: i64,
}

impl CaptureLine {
    const fn agrees(&self) -> bool {
        self.target_qty == self.scanned_qty
    }
}

/// What one sweep of a box found, set against what the box was meant to hold.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CaptureOutcome {
    pub capture_id: String,
    pub session_id: String,
    pub reader_session_id: String,
    /// True only when every line agrees and the sweep found nothing else.
    pub matched: bool,
    pub lines: Vec<CaptureLine>,
    /// Swept, ours, but not on this box's list. Wrong goods, caught before the
    /// lid closes rather than at the shop door.
    pub unexpected: Vec<CaptureLine>,
    /// Swept, but this DC has never heard of the tag.
    pub unknown_epcs: Vec<String>,
    /// The EPCs the sweep accounted for, in the order the box will record them.
    pub epcs: Vec<String>,
}

/// Compare a sweep against a box's target and write down what was found.
///
/// This only reads and records. Whether the box is then filled and frozen is
/// the caller's business, because filling it needs the allotment attribution
/// that only the pick path knows.
pub fn capture_box(
    connection: &mut Connection,
    session_id: &str,
    reader_session_id: &str,
) -> Result<CaptureOutcome, EdgeError> {
    let reader_session_id = reader_session_id.trim();
    if reader_session_id.is_empty() {
        return Err(EdgeError::Validation("reader session is required".into()));
    }
    let (status, koli_id): (String, Option<String>) = connection
        .query_row(
            "SELECT status,koli_id FROM packing_session WHERE session_id=?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("packing session {session_id}")))?;
    if status != "OPEN" {
        return Err(EdgeError::Conflict(format!(
            "packing session {session_id} is {status}"
        )));
    }
    if koli_id.is_some() {
        return Err(EdgeError::Conflict(
            "this box is already frozen; open a new session for the next one".into(),
        ));
    }

    // What the sweep saw. DISTINCT because a tag read forty times is one
    // garment, not forty.
    let mut statement = connection
        .prepare(
            "SELECT o.epc, s.sku_code
               FROM (SELECT DISTINCT epc FROM edge_observation_sighting
                      WHERE reader_session_id = ?1) o
               LEFT JOIN inventory_subject s ON s.epc = o.epc
              ORDER BY o.epc",
        )
        .map_err(db)?;
    let seen: Vec<(String, Option<String>)> = statement
        .query_map(params![reader_session_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(statement);

    if seen.is_empty() {
        return Err(EdgeError::Validation(format!(
            "reader session {reader_session_id} saw nothing"
        )));
    }

    let mut scanned: BTreeMap<String, i64> = BTreeMap::new();
    let mut unknown_epcs = Vec::new();
    let mut epcs = Vec::new();
    for (epc, sku_code) in seen {
        match sku_code {
            Some(sku) => {
                *scanned.entry(sku).or_insert(0) += 1;
                epcs.push(epc);
            }
            None => unknown_epcs.push(epc),
        }
    }

    let mut targets = connection
        .prepare("SELECT sku_code,target_qty FROM packing_session_target WHERE session_id=?1")
        .map_err(db)?;
    let target: BTreeMap<String, i64> = targets
        .query_map(params![session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(db)?
        .collect::<Result<BTreeMap<_, _>, _>>()
        .map_err(db)?;
    drop(targets);

    let lines: Vec<CaptureLine> = target
        .iter()
        .map(|(sku_code, target_qty)| CaptureLine {
            sku_code: sku_code.clone(),
            target_qty: *target_qty,
            scanned_qty: scanned.get(sku_code).copied().unwrap_or(0),
        })
        .collect();
    let unexpected: Vec<CaptureLine> = scanned
        .iter()
        .filter(|(sku_code, _)| !target.contains_key(*sku_code))
        .map(|(sku_code, scanned_qty)| CaptureLine {
            sku_code: sku_code.clone(),
            target_qty: 0,
            scanned_qty: *scanned_qty,
        })
        .collect();

    let matched =
        lines.iter().all(CaptureLine::agrees) && unexpected.is_empty() && unknown_epcs.is_empty();

    let capture_id = Uuid::new_v4().to_string();
    let detail = serde_json::json!({
        "lines": lines,
        "unexpected": unexpected,
        "unknown_epcs": unknown_epcs,
    });
    let (device_id, operator_id): (Option<String>, Option<String>) = connection
        .query_row(
            "SELECT device_id,operator_id FROM edge_observation_sighting
              WHERE reader_session_id=?1 LIMIT 1",
            params![reader_session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?
        .unwrap_or((None, None));

    connection
        .execute(
            "INSERT INTO packing_capture
                 (capture_id,session_id,reader_session_id,device_id,operator_id,
                  captured_at,detail_json,matched)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                capture_id,
                session_id,
                reader_session_id,
                device_id,
                operator_id,
                now_text(),
                detail.to_string(),
                i64::from(matched)
            ],
        )
        .map_err(db)?;

    Ok(CaptureOutcome {
        capture_id,
        session_id: session_id.to_string(),
        reader_session_id: reader_session_id.to_string(),
        matched,
        lines,
        unexpected,
        unknown_epcs,
        epcs,
    })
}

/// Bind the box a matching sweep produced to its session, and freeze it.
pub fn freeze_box(
    connection: &mut Connection,
    session_id: &str,
    koli_id: &str,
    capture_id: &str,
) -> Result<(), EdgeError> {
    let now = now_text();
    let tx = connection.transaction().map_err(db)?;
    tx.execute(
        "UPDATE packing_session SET koli_id=?2 WHERE session_id=?1",
        params![session_id, koli_id],
    )
    .map_err(db)?;
    tx.execute(
        "UPDATE koli SET sealed_by_capture_id=?2, updated_at=?3 WHERE koli_id=?1",
        params![koli_id, capture_id, now],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Listings — what a person needs to choose from
// ---------------------------------------------------------------------------

/// Narrow a listing to the rows a particular decision cares about. A supervisor
/// building a shipment wants sealed boxes nobody has claimed, not every box the
/// DC has ever packed.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
pub struct ListFilter {
    /// Only rows that have not yet been gathered into their parent.
    #[serde(default)]
    pub unassigned: bool,
    /// Only sealed koli / only open sessions / only dispatches still here.
    #[serde(default)]
    pub ready: bool,
}

pub fn list_koli(connection: &Connection, filter: ListFilter) -> Result<Vec<Koli>, EdgeError> {
    let mut sql = String::from("SELECT koli_id FROM koli WHERE 1=1");
    if filter.unassigned {
        sql.push_str(" AND shipment_id IS NULL");
    }
    if filter.ready {
        sql.push_str(" AND sealed_at IS NOT NULL");
    }
    sql.push_str(" ORDER BY koli_number");
    let ids = collect_ids(connection, &sql)?;
    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        rows.push(load_koli(connection, &id)?);
    }
    Ok(rows)
}

pub fn list_shipments(
    connection: &Connection,
    filter: ListFilter,
) -> Result<Vec<Shipment>, EdgeError> {
    let mut sql = String::from("SELECT shipment_id FROM shipment WHERE 1=1");
    if filter.unassigned {
        sql.push_str(" AND dispatch_id IS NULL");
    }
    sql.push_str(" ORDER BY shipment_number");
    let ids = collect_ids(connection, &sql)?;
    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        rows.push(load_shipment(connection, &id)?);
    }
    Ok(rows)
}

pub fn list_dispatches(
    connection: &Connection,
    filter: ListFilter,
) -> Result<Vec<Dispatch>, EdgeError> {
    let mut sql = String::from("SELECT dispatch_id FROM dispatch WHERE 1=1");
    if filter.ready {
        // Still on the yard: a departed truck is history, not a choice.
        sql.push_str(" AND departed_at IS NULL");
    }
    sql.push_str(" ORDER BY dispatch_number DESC");
    let ids = collect_ids(connection, &sql)?;
    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        rows.push(load_dispatch(connection, &id)?);
    }
    Ok(rows)
}

pub fn list_sessions(
    connection: &Connection,
    kind: SessionKind,
    filter: ListFilter,
) -> Result<Vec<Session>, EdgeError> {
    let mut sql = format!("SELECT session_id FROM {} WHERE 1=1", kind.table());
    if filter.ready {
        sql.push_str(" AND status='OPEN'");
    }
    sql.push_str(" ORDER BY started_at DESC LIMIT 50");
    let ids = collect_ids(connection, &sql)?;
    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        rows.push(load_session(connection, kind, &id)?);
    }
    Ok(rows)
}

/// The listing queries differ only in their WHERE clause, and every one of them
/// selects a single id column. Assembled from fixed fragments above, never from
/// caller text.
fn collect_ids(connection: &Connection, sql: &str) -> Result<Vec<String>, EdgeError> {
    let mut statement = connection.prepare(sql).map_err(db)?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema(name: &str) -> String {
        let base = concat!(env!("CARGO_MANIFEST_DIR"), "/migrations/sqlite/");
        match std::fs::read_to_string(format!("{base}{name}")) {
            Ok(text) => text,
            Err(error) => panic!("read {name}: {error}"),
        }
    }

    /// A connection with just enough of the edge schema for outbound work:
    /// the ledger, the allotment work queues, then this migration on top.
    fn fixture() -> Connection {
        let connection = match Connection::open_in_memory() {
            Ok(connection) => connection,
            Err(error) => panic!("open: {error}"),
        };
        for name in [
            "0001_edge_inventory.sql",
            "0004_edge_inventory_work.sql",
            "0009_edge_outbound_containment.sql",
            "0010_edge_pick_session_link.sql",
            "0011_edge_packing_capture.sql",
            "0012_edge_pick_event_rename.sql",
            // Where a handheld's sweep lands.
            "0004_edge_auth.sql",
        ] {
            if let Err(error) = connection.execute_batch(&schema(name)) {
                panic!("{name}: {error}");
            }
        }
        connection
    }

    fn seed_allotment(connection: &Connection) {
        let statements = [
            "INSERT INTO dc_allotment_work
                 (allotment_id,command_id,allotment_number,allotment_type,source_site_id,
                  application_status,fulfillment_status,application_result_id,
                  application_fact_seq,created_by,created_at,applied_at,updated_at)
             VALUES('al-1','cmd-1','AL-1','TO_STORE','dc-01','ACCEPTED','OPEN','res-1',1,
                    'buyer','t0','t0','t0')",
            "INSERT INTO dc_allotment_work_line
                 (allotment_line_id,allotment_id,source_pool_id,destination_type,destination_id,
                  sku_id,sku_code,planned_quantity,accepted_quantity,updated_at)
             VALUES('line-1','al-1','dc-01.warehouse','STORE','toko-a','sku-1','12345678123',
                    300,300,'t0')",
        ];
        for statement in statements {
            if let Err(error) = connection.execute(statement, []) {
                panic!("seed allotment: {error}");
            }
        }
    }

    /// A box with `count` units in it, as the existing Pack flow would leave it.
    fn seed_koli(connection: &Connection, koli_id: &str, number: &str, units: usize) {
        if let Err(error) = connection.execute(
            "INSERT INTO koli
                 (koli_id,koli_number,destination_store_id,status,created_by,created_at,updated_at)
             VALUES(?1,?2,'toko-a','PACKED','packer','t0','t0')",
            params![koli_id, number],
        ) {
            panic!("seed koli: {error}");
        }
        for index in 0..units {
            let epc = format!("{koli_id}-EPC-{index:04}");
            let subject = format!("{koli_id}-subj-{index:04}");
            if let Err(error) = connection.execute(
                "INSERT INTO inventory_subject
                     (id,subject_type,epc,sku_code,quantity,unit_price_minor,created_at)
                 VALUES(?1,'UNIT',?2,'12345678123',1,189000,'t0')",
                params![subject, epc],
            ) {
                panic!("seed subject: {error}");
            }
            if let Err(error) = connection.execute(
                "INSERT INTO koli_unit
                     (koli_id,subject_id,epc,sku_code,allotment_id,allotment_line_id,
                      current_stage,stage_rank,packed_at,updated_at)
                 VALUES(?1,?2,?3,'12345678123','al-1','line-1','PACKED',2,'t0','t0')",
                params![koli_id, subject, epc],
            ) {
                panic!("seed koli unit: {error}");
            }
        }
    }

    fn seal(connection: &mut Connection, koli_id: &str) {
        if let Err(error) = seal_koli(connection, koli_id, "packer-1") {
            panic!("seal {koli_id}: {error}");
        }
    }

    #[test]
    fn numbers_are_minted_in_sequence_and_carry_their_site() {
        let mut connection = fixture();
        let tx = match connection.transaction() {
            Ok(tx) => tx,
            Err(error) => panic!("tx: {error}"),
        };
        let first = match next_number(&tx, NumberKind::Koli, "dc-01") {
            Ok(value) => value,
            Err(error) => panic!("{error}"),
        };
        let second = match next_number(&tx, NumberKind::Koli, "dc-01") {
            Ok(value) => value,
            Err(error) => panic!("{error}"),
        };
        assert_eq!(first, "KOLI-dc-01-000001");
        assert_eq!(second, "KOLI-dc-01-000002");
    }

    #[test]
    fn a_surat_jalan_is_numbered_apart_from_the_boxes() {
        let mut connection = fixture();
        let tx = match connection.transaction() {
            Ok(tx) => tx,
            Err(error) => panic!("tx: {error}"),
        };
        let koli = next_number(&tx, NumberKind::Koli, "dc-01").unwrap_or_default();
        let shipment = next_number(&tx, NumberKind::Shipment, "dc-01").unwrap_or_default();
        assert_eq!(koli, "KOLI-dc-01-000001");
        assert_eq!(
            shipment, "SJ-dc-01-000001",
            "its own counter, not a shared one"
        );
    }

    #[test]
    fn an_empty_box_cannot_be_sealed() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000001", 0);
        match seal_koli(&mut connection, "koli-1", "packer-1") {
            Err(EdgeError::Validation(message)) => assert!(message.contains("empty"), "{message}"),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn nothing_can_be_added_to_a_sealed_box() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000001", 3);
        seal(&mut connection, "koli-1");

        let outcome = connection.execute(
            "INSERT INTO koli_unit
                 (koli_id,subject_id,epc,sku_code,allotment_id,allotment_line_id,
                  current_stage,stage_rank,packed_at,updated_at)
             VALUES('koli-1','late-subject','LATE-EPC','12345678123','al-1','line-1',
                    'PACKED',2,'t1','t1')",
            [],
        );
        match outcome {
            Err(rusqlite::Error::SqliteFailure(_, Some(message))) => {
                assert!(message.contains("sealed koli"), "{message}");
            }
            other => panic!("expected the database to refuse, got {other:?}"),
        }
    }

    #[test]
    fn a_seal_cannot_be_undone() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000001", 2);
        seal(&mut connection, "koli-1");
        let outcome =
            connection.execute("UPDATE koli SET sealed_at=NULL WHERE koli_id='koli-1'", []);
        assert!(outcome.is_err(), "unsealing must be refused");
    }

    #[test]
    fn an_open_box_cannot_join_a_shipment() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000001", 2);
        match create_shipment(
            &mut connection,
            "dc-01",
            CreateShipmentRequest {
                koli_ids: vec!["koli-1".into()],
                actor_id: "supervisor".into(),
            },
        ) {
            Err(EdgeError::Conflict(message)) => {
                assert!(message.contains("not sealed"), "{message}")
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn one_surat_jalan_serves_exactly_one_store() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000001", 2);
        seed_koli(&connection, "koli-2", "KOLI-dc-01-000002", 2);
        if let Err(error) = connection.execute(
            "UPDATE koli SET destination_store_id='toko-b' WHERE koli_id='koli-2'",
            [],
        ) {
            panic!("retarget: {error}");
        }
        seal(&mut connection, "koli-1");
        seal(&mut connection, "koli-2");

        match create_shipment(
            &mut connection,
            "dc-01",
            CreateShipmentRequest {
                koli_ids: vec!["koli-1".into(), "koli-2".into()],
                actor_id: "supervisor".into(),
            },
        ) {
            Err(EdgeError::Validation(message)) => {
                assert!(message.contains("share a destination"), "{message}");
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn the_whole_chain_reads_back_from_containment_alone() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000001", 40);
        seed_koli(&connection, "koli-2", "KOLI-dc-01-000002", 35);
        seal(&mut connection, "koli-1");
        seal(&mut connection, "koli-2");

        // Packed: in boxes, no consignment yet.
        let packed = match allotment_line_position(&connection, "line-1") {
            Ok(position) => position,
            Err(error) => panic!("{error}"),
        };
        assert_eq!(packed.packed, 75);
        assert_eq!(packed.in_shipment, 0);

        let shipment = match create_shipment(
            &mut connection,
            "dc-01",
            CreateShipmentRequest {
                koli_ids: vec!["koli-1".into(), "koli-2".into()],
                actor_id: "supervisor".into(),
            },
        ) {
            Ok(shipment) => shipment,
            Err(error) => panic!("shipment: {error}"),
        };
        assert_eq!(shipment.koli_count, 2);
        assert_eq!(shipment.unit_count, 75);
        assert_eq!(shipment.position, "SHIPMENT");

        let in_shipment = allotment_line_position(&connection, "line-1").unwrap_or_default();
        assert_eq!(in_shipment.in_shipment, 75);
        assert_eq!(in_shipment.packed, 0, "they moved on, not duplicated");

        let dispatch = match create_dispatch(
            &mut connection,
            "dc-01",
            CreateDispatchRequest {
                shipment_ids: vec![shipment.shipment_id.clone()],
                carrier: Some("Kilat".into()),
                vehicle_plate: Some("B 1234 XY".into()),
                driver_name: Some("Pak Slamet".into()),
                actor_id: "supervisor".into(),
            },
        ) {
            Ok(dispatch) => dispatch,
            Err(error) => panic!("dispatch: {error}"),
        };
        assert_eq!(dispatch.shipment_count, 1);
        assert_eq!(dispatch.koli_count, 2);

        let loaded = allotment_line_position(&connection, "line-1").unwrap_or_default();
        assert_eq!(loaded.loaded, 75, "on the truck, not yet gone");

        if let Err(error) = depart_dispatch(&mut connection, &dispatch.dispatch_id) {
            panic!("depart: {error}");
        }
        let gone = allotment_line_position(&connection, "line-1").unwrap_or_default();
        assert_eq!(gone.in_transit, 75);
        assert_eq!(gone.loaded, 0);
    }

    #[test]
    fn a_departed_truck_takes_no_more_cargo() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000001", 2);
        seed_koli(&connection, "koli-2", "KOLI-dc-01-000002", 2);
        seal(&mut connection, "koli-1");
        seal(&mut connection, "koli-2");

        let first = create_shipment(
            &mut connection,
            "dc-01",
            CreateShipmentRequest {
                koli_ids: vec!["koli-1".into()],
                actor_id: "supervisor".into(),
            },
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let second = create_shipment(
            &mut connection,
            "dc-01",
            CreateShipmentRequest {
                koli_ids: vec!["koli-2".into()],
                actor_id: "supervisor".into(),
            },
        )
        .unwrap_or_else(|error| panic!("{error}"));

        let dispatch = create_dispatch(
            &mut connection,
            "dc-01",
            CreateDispatchRequest {
                shipment_ids: vec![first.shipment_id],
                carrier: None,
                vehicle_plate: None,
                driver_name: None,
                actor_id: "supervisor".into(),
            },
        )
        .unwrap_or_else(|error| panic!("{error}"));
        if let Err(error) = depart_dispatch(&mut connection, &dispatch.dispatch_id) {
            panic!("depart: {error}");
        }

        let outcome = connection.execute(
            "UPDATE shipment SET dispatch_id=?2 WHERE shipment_id=?1",
            params![second.shipment_id, dispatch.dispatch_id],
        );
        assert!(outcome.is_err(), "the truck has already gone");
    }

    #[test]
    fn a_packing_session_cannot_close_over_an_open_box() {
        let mut connection = fixture();
        seed_allotment(&connection);
        let session = match open_session(
            &mut connection,
            SessionKind::Packing,
            OpenSessionRequest {
                actor_id: "packer-1".into(),
                note: None,
            },
        ) {
            Ok(session) => session,
            Err(error) => panic!("open: {error}"),
        };
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000001", 3);
        if let Err(error) = assign_koli_to_session(&mut connection, "koli-1", &session.session_id) {
            panic!("assign: {error}");
        }

        match close_session(&mut connection, SessionKind::Packing, &session.session_id) {
            Err(EdgeError::Conflict(message)) => {
                assert!(message.contains("unsealed"), "{message}");
            }
            other => panic!("expected a refusal, got {other:?}"),
        }

        seal(&mut connection, "koli-1");
        if let Err(error) =
            close_session(&mut connection, SessionKind::Packing, &session.session_id)
        {
            panic!("close after sealing: {error}");
        }
    }

    #[test]
    fn a_session_reports_how_many_boxes_it_produced_and_what_is_in_them() {
        let mut connection = fixture();
        seed_allotment(&connection);
        let session = open_session(
            &mut connection,
            SessionKind::Packing,
            OpenSessionRequest {
                actor_id: "packer-1".into(),
                note: None,
            },
        )
        .unwrap_or_else(|error| panic!("{error}"));

        for (index, units) in [40usize, 40, 40, 40, 40].iter().enumerate() {
            let id = format!("koli-{index}");
            seed_koli(
                &connection,
                &id,
                &format!("KOLI-dc-01-00000{index}"),
                *units,
            );
            if let Err(error) = assign_koli_to_session(&mut connection, &id, &session.session_id) {
                panic!("assign: {error}");
            }
            seal(&mut connection, &id);
        }

        let summary = match packing_session_summary(&connection, &session.session_id) {
            Ok(summary) => summary,
            Err(error) => panic!("{error}"),
        };
        assert_eq!(summary.koli_count, 5, "200 pieces became five boxes");
        assert_eq!(summary.unit_count, 200);
        assert_eq!(summary.unsealed_count, 0);
    }

    #[test]
    fn a_manifest_names_the_box_and_what_came_from_which_allotment() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000123", 12);
        let manifest = match seal_koli(&mut connection, "koli-1", "packer-1") {
            Ok(manifest) => manifest,
            Err(error) => panic!("{error}"),
        };
        assert_eq!(manifest.qr_payload, "K1:KOLI-dc-01-000123");
        assert_eq!(manifest.koli.position, "PACKED");
        assert_eq!(manifest.lines.len(), 1);
        assert_eq!(manifest.lines[0].quantity, 12);
        assert_eq!(manifest.lines[0].allotment_line_id, "line-1");
    }

    #[test]
    fn a_picklist_adds_up_demand_by_sku_and_names_no_store() {
        let mut connection = fixture();
        seed_allotment(&connection);
        // A second line for the same SKU, bound for a different store.
        if let Err(error) = connection.execute(
            "INSERT INTO dc_allotment_work_line
                 (allotment_line_id,allotment_id,source_pool_id,destination_type,destination_id,
                  sku_id,sku_code,planned_quantity,accepted_quantity,updated_at)
             VALUES('line-2','al-1','dc-01.warehouse','STORE','toko-b','sku-1','12345678123',
                    120,120,'t0')",
            [],
        ) {
            panic!("seed second line: {error}");
        }
        let lines = match picklist(&connection) {
            Ok(lines) => lines,
            Err(error) => panic!("{error}"),
        };
        assert_eq!(lines.len(), 1, "one SKU, however many stores want it");
        assert_eq!(lines[0].outstanding, 420, "300 + 120, added up");
        assert_eq!(lines[0].allotment_lines, 2);
        let _ = &mut connection;
    }

    #[test]
    fn a_listing_offers_only_what_can_still_be_chosen() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000001", 2);
        seed_koli(&connection, "koli-2", "KOLI-dc-01-000002", 2);
        seal(&mut connection, "koli-1");
        // koli-2 stays open on the bench.

        let ready = match list_koli(
            &connection,
            ListFilter {
                unassigned: true,
                ready: true,
            },
        ) {
            Ok(rows) => rows,
            Err(error) => panic!("{error}"),
        };
        assert_eq!(ready.len(), 1, "only the sealed one can join a shipment");
        assert_eq!(ready[0].koli_id, "koli-1");

        let all = list_koli(&connection, ListFilter::default()).unwrap_or_default();
        assert_eq!(all.len(), 2, "without a filter, both are listed");
    }

    #[test]
    fn a_departed_truck_leaves_the_choosable_list() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000001", 2);
        seal(&mut connection, "koli-1");
        let shipment = create_shipment(
            &mut connection,
            "dc-01",
            CreateShipmentRequest {
                koli_ids: vec!["koli-1".into()],
                actor_id: "supervisor".into(),
            },
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let dispatch = create_dispatch(
            &mut connection,
            "dc-01",
            CreateDispatchRequest {
                shipment_ids: vec![shipment.shipment_id],
                carrier: None,
                vehicle_plate: None,
                driver_name: None,
                actor_id: "supervisor".into(),
            },
        )
        .unwrap_or_else(|error| panic!("{error}"));

        let waiting = list_dispatches(
            &connection,
            ListFilter {
                unassigned: false,
                ready: true,
            },
        )
        .unwrap_or_default();
        assert_eq!(waiting.len(), 1);

        if let Err(error) = depart_dispatch(&mut connection, &dispatch.dispatch_id) {
            panic!("depart: {error}");
        }
        let after = list_dispatches(
            &connection,
            ListFilter {
                unassigned: false,
                ready: true,
            },
        )
        .unwrap_or_default();
        assert!(
            after.is_empty(),
            "a departed truck is history, not a choice"
        );
    }

    /// Rasterise the QR straight from the encoder's own module grid — no SVG
    /// parsing, no image files — so a decoder can read back what was written.
    fn decode_qr(payload: &str) -> String {
        let code = match QrCode::with_error_correction_level(payload, EcLevel::Q) {
            Ok(code) => code,
            Err(error) => panic!("encode {payload:?}: {error}"),
        };
        let width = code.width();
        let scale = 4usize;
        let quiet = 4usize * scale;
        let side = width * scale + quiet * 2;
        let colors = code.to_colors();

        // White ground, dark modules painted on: exactly how it prints.
        let mut pixels = vec![255u8; side * side];
        for (index, color) in colors.iter().enumerate() {
            if *color != qrcode::Color::Dark {
                continue;
            }
            let (mx, my) = (index % width, index / width);
            for dy in 0..scale {
                for dx in 0..scale {
                    let x = quiet + mx * scale + dx;
                    let y = quiet + my * scale + dy;
                    pixels[y * side + x] = 0;
                }
            }
        }

        let mut image =
            rqrr::PreparedImage::prepare_from_greyscale(side, side, |x, y| pixels[y * side + x]);
        let grids = image.detect_grids();
        assert_eq!(
            grids.len(),
            1,
            "expected exactly one QR symbol in the image"
        );
        match grids[0].decode() {
            Ok((_, text)) => text,
            Err(error) => panic!("decode {payload:?}: {error}"),
        }
    }

    #[test]
    fn a_generated_qr_reads_back_as_what_went_in() {
        // A decoder that did not write the symbol is the only witness worth
        // having: self-consistency proves nothing about what a phone will see.
        for payload in [
            "K1:KOLI-dc-01-000901",
            "K1:KOLI-dc-01-999999",
            "S1:SJ-dc-01-000045",
            "K1:KOLI-gudang-pusat-jakarta-000001",
        ] {
            assert_eq!(
                decode_qr(payload),
                payload,
                "round trip failed for {payload}"
            );
        }
    }

    #[test]
    fn the_manifest_carries_a_qr_that_matches_its_own_payload() {
        let mut connection = fixture();
        seed_allotment(&connection);
        seed_koli(&connection, "koli-1", "KOLI-dc-01-000123", 4);
        let manifest = match seal_koli(&mut connection, "koli-1", "packer-1") {
            Ok(manifest) => manifest,
            Err(error) => panic!("{error}"),
        };
        assert_eq!(manifest.qr_payload, "K1:KOLI-dc-01-000123");
        assert!(
            manifest.qr_svg.starts_with("<?xml") || manifest.qr_svg.contains("<svg"),
            "expected inline SVG, got: {}",
            &manifest.qr_svg[..60.min(manifest.qr_svg.len())]
        );
        assert_eq!(decode_qr(&manifest.qr_payload), manifest.qr_payload);
    }

    #[test]
    fn one_round_round_the_racks_gathers_many_skus() {
        let mut connection = fixture();
        seed_allotment(&connection);
        let session = open_session(
            &mut connection,
            SessionKind::Pick,
            OpenSessionRequest {
                actor_id: "picker-1".into(),
                note: Some("ronde pagi".into()),
            },
        )
        .unwrap_or_else(|error| panic!("{error}"));

        // Three racks visited, one of them twice — as a real aisle walk goes.
        let picks = [
            ("12345678103", 40, "p1"),
            ("12345678104", 25, "p2"),
            ("12345678103", 10, "p3"),
            ("12345679201", 12, "p4"),
        ];
        for (sku, qty, id) in picks {
            if let Err(error) = connection.execute(
                "INSERT INTO dc_pick_event
                     (pick_id,source_site_id,source_pool_id,sku_code,quantity,actor_id,
                      occurred_at,allocations_json,fact_seq,pick_session_id)
                 VALUES(?1,'dc','dc.warehouse',?2,?3,'picker-1','t0','[]',
                        (SELECT COALESCE(MAX(fact_seq),0)+1 FROM dc_pick_event),?4)",
                params![id, sku, qty, session.session_id],
            ) {
                panic!("seed pick: {error}");
            }
        }

        let summary = match pick_session_summary(&connection, &session.session_id) {
            Ok(summary) => summary,
            Err(error) => panic!("{error}"),
        };
        assert_eq!(summary.sku_count, 3, "one round, three different SKUs");
        assert_eq!(summary.total_picked, 87, "40 + 25 + 10 + 12");
        let first = &summary.lines[0];
        assert_eq!(first.sku_code, "12345678103");
        assert_eq!(first.picked, 50, "both trips to that rack add up");
        assert_eq!(first.events, 2, "and it took two trips");
    }

    #[test]
    fn a_pick_belongs_to_no_round_unless_one_is_named() {
        let mut connection = fixture();
        seed_allotment(&connection);
        // A picker grabbing one thing without opening a session is ordinary.
        if let Err(error) = connection.execute(
            "INSERT INTO dc_pick_event
                 (pick_id,source_site_id,source_pool_id,sku_code,quantity,actor_id,
                  occurred_at,allocations_json,fact_seq)
             VALUES('loose','dc','dc.warehouse','12345678103',5,'picker-2','t0','[]',1)",
            [],
        ) {
            panic!("seed loose pick: {error}");
        }
        let session = open_session(
            &mut connection,
            SessionKind::Pick,
            OpenSessionRequest {
                actor_id: "picker-1".into(),
                note: None,
            },
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let summary = pick_session_summary(&connection, &session.session_id)
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(summary.total_picked, 0, "a loose pick joins no round");
    }

    /// A sweep, as the handheld uploads it: observations tagged with one
    /// reader session.
    fn sweep(connection: &Connection, reader_session: &str, epcs: &[&str]) {
        for (index, epc) in epcs.iter().enumerate() {
            if let Err(error) = connection.execute(
                "INSERT INTO edge_observation_sighting
                     (observation_id,epc,site_id,pool_id,first_seen_at,last_seen_at,
                      received_at,device_id,reader_session_id,operator_id,read_count)
                 VALUES(?1,?2,'dc','dc.outbound.picked.toko-a','t0','t0','t0',
                        'handheld-7',?3,'packer-1',9)",
                params![format!("{reader_session}-{index}"), epc, reader_session],
            ) {
                panic!("seed sweep: {error}");
            }
        }
    }

    /// Tagged stock sitting in the picked pool, ready to be boxed.
    fn seed_picked(connection: &Connection, sku: &str, epcs: &[&str]) {
        for epc in epcs {
            if let Err(error) = connection.execute(
                "INSERT INTO inventory_subject
                     (id,subject_type,epc,sku_code,quantity,unit_price_minor,created_at)
                 VALUES(?1,'UNIT',?1,?2,1,450000,'t0')",
                params![epc, sku],
            ) {
                panic!("seed subject: {error}");
            }
        }
    }

    fn open_box(connection: &mut Connection, target: Vec<TargetLine>) -> PackingBox {
        match open_packing_box(
            connection,
            OpenPackingBoxRequest {
                destination_store_id: "toko-a".into(),
                target,
                actor_id: "packer-1".into(),
                note: None,
            },
        ) {
            Ok(opened) => opened,
            Err(error) => panic!("open box: {error}"),
        }
    }

    fn line(sku: &str, qty: i64) -> TargetLine {
        TargetLine {
            sku_code: sku.into(),
            target_qty: qty,
        }
    }

    #[test]
    fn a_sweep_that_agrees_with_the_target_needs_nothing_else_decided() {
        let mut connection = fixture();
        seed_picked(&connection, "12345678103", &["E1", "E2", "E3"]);
        let opened = open_box(&mut connection, vec![line("12345678103", 3)]);
        sweep(&connection, "rs-1", &["E1", "E2", "E3"]);

        let outcome = match capture_box(&mut connection, &opened.session.session_id, "rs-1") {
            Ok(outcome) => outcome,
            Err(error) => panic!("{error}"),
        };
        assert!(outcome.matched, "{outcome:?}");
        assert_eq!(outcome.lines[0].target_qty, 3);
        assert_eq!(outcome.lines[0].scanned_qty, 3);
        assert_eq!(outcome.epcs.len(), 3);
    }

    #[test]
    fn a_short_box_names_the_sku_that_is_short() {
        let mut connection = fixture();
        seed_picked(&connection, "12345678103", &["E1", "E2", "E3"]);
        let opened = open_box(&mut connection, vec![line("12345678103", 3)]);
        sweep(&connection, "rs-1", &["E1", "E2"]);

        let outcome = capture_box(&mut connection, &opened.session.session_id, "rs-1")
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(!outcome.matched);
        assert_eq!(outcome.lines[0].scanned_qty, 2, "two of the three found");
        assert_eq!(outcome.lines[0].target_qty, 3);
    }

    #[test]
    fn goods_that_do_not_belong_in_this_box_are_named_before_the_lid_closes() {
        let mut connection = fixture();
        seed_picked(&connection, "12345678103", &["E1", "E2"]);
        seed_picked(&connection, "12345678104", &["F1"]);
        let opened = open_box(&mut connection, vec![line("12345678103", 2)]);
        sweep(&connection, "rs-1", &["E1", "E2", "F1"]);

        let outcome = capture_box(&mut connection, &opened.session.session_id, "rs-1")
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(
            !outcome.matched,
            "the target is met but a stranger is in the box"
        );
        assert_eq!(outcome.unexpected.len(), 1);
        assert_eq!(outcome.unexpected[0].sku_code, "12345678104");
        assert_eq!(outcome.unexpected[0].scanned_qty, 1);
    }

    #[test]
    fn a_tag_this_dc_has_never_heard_of_stops_the_box() {
        let mut connection = fixture();
        seed_picked(&connection, "12345678103", &["E1", "E2"]);
        let opened = open_box(&mut connection, vec![line("12345678103", 2)]);
        sweep(&connection, "rs-1", &["E1", "E2", "GHOST"]);

        let outcome = capture_box(&mut connection, &opened.session.session_id, "rs-1")
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(!outcome.matched);
        assert_eq!(outcome.unknown_epcs, vec!["GHOST".to_string()]);
    }

    #[test]
    fn a_tag_read_forty_times_is_one_garment() {
        let mut connection = fixture();
        seed_picked(&connection, "12345678103", &["E1"]);
        let opened = open_box(&mut connection, vec![line("12345678103", 1)]);
        // The same EPC seen by several antennas in one sweep.
        sweep(&connection, "rs-1", &["E1"]);
        if let Err(error) = connection.execute(
            "INSERT INTO edge_observation_sighting
                 (observation_id,epc,site_id,pool_id,first_seen_at,last_seen_at,
                  received_at,device_id,reader_session_id,operator_id,read_count)
             VALUES('again','E1','dc','dc.outbound.picked.toko-a','t0','t0','t0',
                    'handheld-7','rs-1','packer-1',31)",
            [],
        ) {
            panic!("second antenna: {error}");
        }
        let outcome = capture_box(&mut connection, &opened.session.session_id, "rs-1")
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(
            outcome.matched,
            "one garment, however many reads: {outcome:?}"
        );
        assert_eq!(outcome.lines[0].scanned_qty, 1);
    }

    #[test]
    fn a_target_cannot_be_retyped_to_match_a_disappointing_sweep() {
        let mut connection = fixture();
        seed_picked(&connection, "12345678103", &["E1", "E2"]);
        let opened = open_box(&mut connection, vec![line("12345678103", 3)]);
        sweep(&connection, "rs-1", &["E1", "E2"]);
        let outcome = capture_box(&mut connection, &opened.session.session_id, "rs-1")
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(!outcome.matched);

        let retyped = connection.execute(
            "UPDATE packing_session_target SET target_qty=2 WHERE session_id=?1",
            params![opened.session.session_id],
        );
        assert!(
            retyped.is_err(),
            "the target is a statement, not a slot to fill in"
        );
    }

    #[test]
    fn a_box_packed_towards_nothing_cannot_be_checked() {
        let mut connection = fixture();
        match open_packing_box(
            &mut connection,
            OpenPackingBoxRequest {
                destination_store_id: "toko-a".into(),
                target: vec![],
                actor_id: "packer-1".into(),
                note: None,
            },
        ) {
            Err(EdgeError::Validation(message)) => assert!(message.contains("target"), "{message}"),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    fn names_of(connection: &Connection, kind: &str, sql: &str) -> Vec<String> {
        let mut statement = match connection.prepare(sql) {
            Ok(statement) => statement,
            Err(error) => panic!("prepare {kind}: {error}"),
        };
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .and_then(Iterator::collect::<Result<Vec<_>, _>>);
        match rows {
            Ok(names) => names,
            Err(error) => panic!("read {kind}: {error}"),
        }
    }

    /// The rules a carton lives under are triggers, and triggers die with the
    /// table they sit on. SQLite cannot alter a CHECK, so changing one means
    /// rebuilding the table by hand and typing every trigger back — and a
    /// trigger silently left out fails nothing. The box still packs; it simply
    /// stops refusing what it used to refuse, and nobody learns that for
    /// months.
    ///
    /// So the set is written down here. If a rebuild drops one, this is what
    /// says so.
    #[test]
    fn every_rule_a_carton_lives_under_is_still_attached() {
        let connection = fixture();
        let present = names_of(
            &connection,
            "triggers",
            "SELECT name FROM sqlite_master WHERE type='trigger'
              AND (tbl_name IN ('koli','koli_unit','shipment','dispatch',
                                'packing_session','packing_session_target'))
             ORDER BY name",
        );
        assert_eq!(
            present,
            vec![
                "dispatch_departs_once",
                "koli_number_required_on_insert",
                "koli_number_required_on_update",
                "koli_seal_is_final",
                "koli_seal_names_its_own_capture",
                "koli_sealed_before_shipment",
                "koli_unit_not_after_seal",
                "packing_session_closes_only_when_sealed",
                "packing_target_is_fixed_once_swept",
                "packing_target_not_added_once_swept",
                "shipment_not_onto_departed_dispatch",
            ],
            "a rule went missing"
        );
    }

    /// Indexes die with their table too, and a missing one fails nothing at
    /// all — no error, no wrong answer, just a query that quietly walks the
    /// whole table. Worth pinning for exactly that reason.
    #[test]
    fn every_index_on_a_carton_is_still_there() {
        let connection = fixture();
        let present = names_of(
            &connection,
            "indexes",
            "SELECT name FROM sqlite_master WHERE type='index'
              AND tbl_name IN ('koli','koli_unit') AND name NOT LIKE 'sqlite_%'
             ORDER BY name",
        );
        assert_eq!(
            present,
            vec![
                "ix_dc_package_allotment",
                "ix_koli_packing_session",
                "ix_koli_shipment",
                "ux_dc_active_package_epc",
                "ux_dc_active_package_subject",
                "ux_koli_number",
            ],
            "an index went missing"
        );
    }

    /// Every column, in order. A rebuild retypes the whole definition, and a
    /// column dropped or reordered by accident is the kind of thing that only
    /// shows up as a puzzling NULL somewhere far away.
    #[test]
    fn a_carton_still_has_every_column_it_had() {
        let connection = fixture();
        let present = names_of(
            &connection,
            "columns",
            "SELECT name FROM pragma_table_info('koli') ORDER BY cid",
        );
        assert_eq!(
            present,
            vec![
                "koli_id",
                "destination_store_id",
                "status",
                "shipment_reference",
                "created_by",
                "created_at",
                "updated_at",
                "koli_number",
                "packing_session_id",
                "sealed_at",
                "sealed_by",
                "shipment_id",
                "sealed_by_capture_id",
            ],
            "a column went missing or moved"
        );
    }
}
