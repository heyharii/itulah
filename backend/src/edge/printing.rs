//! The label print queue: turning a tagging job into labels a printer can be
//! handed a chunk at a time.
//!
//! The centre decides WHAT to print and sends it down as a tagging job. The DC
//! decides WHEN, because the DC is the only party on the same LAN as the
//! printer. Printing never goes cloud to printer: a cloud that dispatched
//! labels directly could not print with the line down, and that is precisely
//! the hour a warehouse most needs its labels.
//!
//! Work is claimed in chunks rather than streamed. A printer handed four
//! thousand labels in one socket write holds them in a buffer nobody can see
//! into, so a jam at label nine hundred is discovered as a silence. A chunk
//! that was claimed and never reported is visible, and can be tried again.
//!
//! Lives beside `sqlite.rs` rather than inside it: these functions take a
//! connection and nothing else, which keeps them testable and keeps this
//! feature out of a file several other workstreams are editing.

use std::io::Write;
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::contracts::EdgeError;
use super::zpl::{
    preview_label, render_label_in, LabelBrand, LabelData, LabelSize, PrinterLanguage,
};

/// The name printed on the top line of every tag.
///
/// The legacy lineage disagreed with itself — the Go renderer printed the
/// operating company's name, a tag recovered from the field printed a trading
/// name — and neither is what the shop is called to a customer. This is the
/// customer-facing name, set in capitals because that is the wordmark, and it
/// is the one thing on the tag a shopper recognises before reading anything.
pub const LABEL_BRAND: &str = "CENTRAL";

/// How many labels one claim hands out when the session does not say.
pub const DEFAULT_CHUNK_SIZE: i64 = 100;

/// How long to wait for a printer that is powered off, jammed, or simply not
/// at the address someone typed. Short enough that an operator learns quickly.
const PRINTER_TIMEOUT: Duration = Duration::from_secs(5);

/// What a print run needs to know before it starts.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenPrintSessionRequest {
    pub job_id: String,
    pub printer_host: String,
    #[serde(default = "default_printer_port")]
    pub printer_port: u16,
    #[serde(default = "default_label_width")]
    pub label_width_mm: i64,
    #[serde(default = "default_label_height")]
    pub label_height_mm: i64,
    pub chunk_size: Option<i64>,
    #[serde(default)]
    pub actor_id: String,
}

const fn default_printer_port() -> u16 {
    9100
}
const fn default_label_width() -> i64 {
    58
}
const fn default_label_height() -> i64 {
    40
}

/// Move an open run to the printer in front of whoever is now holding it.
///
/// The printer is a fact about a bench, and a run that was opened at one bench
/// is regularly finished at another — the first printer jammed, the shift
/// changed, somebody carried the handheld. Without this the labels keep coming
/// out where the run started, which is discovered by walking there.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RepointPrinterRequest {
    pub printer_host: String,
    #[serde(default = "default_printer_port")]
    pub printer_port: u16,
    pub chunk_size: Option<i64>,
    /// The stock now in the machine, if it is not the stock the run was opened
    /// on. Benches do not all hold the same tag, so a run carried to another
    /// one is exactly when this changes — and until it could be said here, the
    /// screen offered a tag size that silently stopped meaning anything the
    /// moment the run existed.
    ///
    /// Left out, the run keeps the geometry it has. Repointing to another
    /// printer is not a reason to redraw the label.
    pub label_width_mm: Option<i64>,
    pub label_height_mm: Option<i64>,
}

/// Which labels to put back in the queue.
///
/// Two ways to name them, because the tag is in two states when this is
/// needed. A tag whose print smeared still reads: the chip is fine, so the
/// reader gives the EPC and that is the exact label to redo. A tag the jam
/// destroyed reads nothing, and all anybody has is where it was in the run —
/// "it ate three hundred and thirty-eight to three hundred and forty-one".
#[derive(Debug, Default, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReprintRequest {
    /// Named by the tag itself. Matched case-insensitively against the stored
    /// form: an operator reading a chip should not have to care.
    #[serde(default)]
    pub epcs: Vec<String>,
    /// Named by position in the run, inclusive at both ends.
    pub from_seq: Option<i64>,
    pub to_seq: Option<i64>,
}

/// What to draw, and on what stock.
#[derive(Debug, Default, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LabelPreviewRequest {
    /// The tag in the machine right now. Left out, the run's own geometry is
    /// used, or the house default for a job nobody has queued yet.
    pub label_width_mm: Option<i64>,
    pub label_height_mm: Option<i64>,
    /// Which line of the job to draw. One job is one article in several
    /// colours and sizes, and they do not print alike — the price differs, and
    /// so does the one line a rail is shopped by. Left out, the first line is
    /// drawn, which is also the first label the run will produce.
    pub sku_code: Option<String>,
}

/// One label, drawn both ways.
///
/// Both come out of a single layout pass, so the picture and the job are the
/// same label described twice rather than two labels that happen to agree.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LabelPreview {
    pub sku_code: String,
    pub article_name: String,
    pub colour_label: String,
    pub size_label: String,
    pub barcode_payload: String,
    pub price_minor: i64,
    /// The EPC the printer would write. Empty when there is no tag to draw
    /// from — a job the centre has not sent EPCs for yet.
    pub epc: String,
    pub label_width_mm: i64,
    pub label_height_mm: i64,
    /// Where the words came from: `SESSION` for a run's own snapshot, `JOB`
    /// for the job as it stands today.
    ///
    /// Worth saying out loud. A run's labels were frozen when it was queued,
    /// and a garment does not get renamed when the master data does — so a
    /// preview drawn from a live job is a picture of what WOULD be queued, and
    /// one drawn from a run is a picture of what WILL come out. Those are
    /// different claims and the screen should not have to guess which it holds.
    pub source: String,
    /// What the printer would be sent, verbatim. On the screen because a
    /// jammed run is debugged by reading it, and until now the only way to see
    /// it was to put a packet capture on the label printer.
    pub zpl: String,
    /// The same label as a standalone SVG document, sized by its `viewBox` so
    /// whatever shows it decides how big the picture is.
    pub svg: String,
}

/// Where a run has got to. Counts come from the items, never from a tally kept
/// in parallel with them.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrintSessionSummary {
    pub session_id: String,
    pub job_id: String,
    pub status: String,
    /// Which bench this run belongs to.
    ///
    /// On the summary because a run outlives the screen that opened it. Whoever
    /// picks it up must be able to see where its labels come out before they
    /// press print, or a second operator quietly feeds a printer in another
    /// room.
    pub printer_host: String,
    pub printer_port: u16,
    /// How many labels one pass hands over. The run's own value, which is not
    /// necessarily what the device that resumed it has stored.
    pub chunk_size: i64,
    /// The stock this run is drawn for, on the summary for the same reason the
    /// printer is: it belongs to the run, not to the device that opened it,
    /// and whoever picks the run up has to be able to see it before they load
    /// a reel.
    pub label_width_mm: i64,
    pub label_height_mm: i64,
    pub total_items: i64,
    pub printed_count: i64,
    pub failed_count: i64,
    pub pending_count: i64,
}

/// What one pass at the printer achieved.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrintChunkReport {
    pub attempted: usize,
    pub printed: usize,
    pub failed: usize,
    pub session: PrintSessionSummary,
}

/// A chunk of labels, with the printer they belong to. The printer travels
/// with them so the caller can release the database lock before opening a
/// socket — a jammed printer must not hold up every other request on the node.
#[derive(Debug)]
pub struct ClaimedChunk {
    pub printer_host: String,
    pub printer_port: u16,
    pub labels: Vec<ClaimedLabel>,
}

/// One label, rendered and ready for the socket.
#[derive(Debug, Serialize)]
pub struct ClaimedLabel {
    pub epc: String,
    pub seq: i64,
    pub sku_code: String,
    pub attempts: i64,
    pub zpl: String,
}

/// One queued label as the run snapshotted it, on its way to being rendered.
///
/// A struct rather than the tuple this used to be: the row is nine columns
/// wide now, and a tuple that long is one reordered field away from printing
/// the colour where the size belongs.
struct QueuedItem {
    epc: String,
    seq: i64,
    sku_code: String,
    article_name: String,
    colour_label: String,
    size_label: String,
    barcode_payload: String,
    price_minor: i64,
    attempts: i64,
}

/// What the dispatcher saw when it handed a label to the printer.
#[derive(Debug, Deserialize, Serialize)]
pub struct PrintOutcomeRecord {
    pub epc: String,
    /// `None` is success. A message here marks the label failed and keeps it
    /// reprintable on its own.
    #[serde(default)]
    pub error: Option<String>,
}

/// The stock a tag can be cut from, in millimetres.
///
/// Not the printer's limit — a T6204e will take a 104 mm web — but a typo
/// limit. `0` was already refused, by the database, with a sentence about a
/// CHECK constraint that means nothing to the person who typed it; `580`
/// was accepted, and prints one label spread across seven tags.
const MIN_LABEL_MM: i64 = 10;
const MAX_LABEL_MM: i64 = 200;

fn validate_label_size(width_mm: i64, height_mm: i64) -> Result<(), EdgeError> {
    for (axis, value) in [("width", width_mm), ("height", height_mm)] {
        if !(MIN_LABEL_MM..=MAX_LABEL_MM).contains(&value) {
            return Err(EdgeError::Validation(format!(
                "label {axis} must be between {MIN_LABEL_MM} and {MAX_LABEL_MM} mm, not {value}"
            )));
        }
    }
    Ok(())
}

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Configuration(format!("sqlite: {error}"))
}

fn now_text() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// Open a print run for a tagging job, queueing one label per EPC.
///
/// The label content is snapshotted here rather than joined at print time: a
/// reprint six weeks from now must reproduce the label that was printed, and
/// the garment on the rail did not get renamed when the master data did.
pub fn open_session(
    connection: &mut Connection,
    request: OpenPrintSessionRequest,
) -> Result<PrintSessionSummary, EdgeError> {
    let chunk_size = request.chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE);
    if !(1..=1000).contains(&chunk_size) {
        return Err(EdgeError::Validation(
            "chunk size must be between 1 and 1000".into(),
        ));
    }
    validate_label_size(request.label_width_mm, request.label_height_mm)?;

    let transaction = connection.transaction().map_err(db)?;

    let article_name: String = transaction
        .query_row(
            "SELECT article_name FROM tagging_job WHERE job_id = ?1",
            params![&request.job_id],
            |row| row.get(0),
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                EdgeError::NotFound(format!("tagging job {}", request.job_id))
            }
            other => db(other),
        })?;

    let existing: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM print_session WHERE job_id = ?1",
            params![&request.job_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if existing > 0 {
        // Not an error to retry a print — but a second SESSION would mean two
        // tags carrying one identity, and the second is indistinguishable from
        // a stolen garment. Reprints happen inside the existing session.
        return Err(EdgeError::Conflict(format!(
            "tagging job {} already has a print session",
            request.job_id
        )));
    }

    // One row per EPC, ordered so that `seq` is stable across reopenings and an
    // operator saying "it stopped at 340" means the same label every time.
    //
    // The barcode carries the bare SKU, not `barcode_payload`: the scanners
    // already on the shop floor are calibrated to the eleven-digit code.
    let mut select = transaction
        .prepare(
            "SELECT e.epc, l.sku_code, l.colour_label, l.size_label, l.base_price_minor
               FROM tagging_job_epc e
               JOIN tagging_job_line l
                 ON l.job_id = e.job_id AND l.sku_code = e.sku_code
              WHERE e.job_id = ?1
              ORDER BY l.sku_code, e.epc",
        )
        .map_err(db)?;
    let queued: Vec<(String, String, String, String, i64)> = select
        .query_map(params![&request.job_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(select);

    if queued.is_empty() {
        return Err(EdgeError::Validation(format!(
            "tagging job {} has no EPCs to print",
            request.job_id
        )));
    }

    let session_id = Uuid::new_v4().to_string();
    let now = now_text();
    let total = i64::try_from(queued.len()).unwrap_or(i64::MAX);

    transaction
        .execute(
            "INSERT INTO print_session
                 (session_id,job_id,printer_host,printer_port,lang,
                  label_width_mm,label_height_mm,chunk_size,total_items,
                  status,created_by,created_at,updated_at)
             VALUES(?1,?2,?3,?4,'ZPL',?5,?6,?7,?8,'OPEN',?9,?10,?10)",
            params![
                session_id,
                &request.job_id,
                request.printer_host,
                i64::from(request.printer_port),
                request.label_width_mm,
                request.label_height_mm,
                chunk_size,
                total,
                request.actor_id,
                now,
            ],
        )
        .map_err(db)?;

    {
        let mut insert = transaction
            .prepare(
                "INSERT INTO print_item
                     (epc,session_id,seq,sku_code,article_name,colour_label,size_label,
                      barcode_payload,price_minor)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            )
            .map_err(db)?;
        for (index, (epc, sku_code, colour_label, size_label, price_minor)) in
            queued.iter().enumerate()
        {
            let seq = i64::try_from(index + 1).unwrap_or(i64::MAX);
            insert
                .execute(params![
                    epc,
                    session_id,
                    seq,
                    sku_code,
                    article_name,
                    colour_label,
                    size_label,
                    sku_code,
                    price_minor,
                ])
                .map_err(db)?;
        }
    }

    transaction.commit().map_err(db)?;
    summarise(connection, &session_id)
}

/// Draw one of this job's labels without printing anything.
///
/// Until this existed the first time anybody saw a hang tag was when it came
/// off the printer, on stock somebody had already loaded — so a tag size was a
/// number typed into a box and confirmed by walking to the machine. The
/// picture and the ZPL both come from one layout pass in `zpl.rs`, so what is
/// shown here is not a second rendering that has to be kept in step; it is the
/// same label, described twice.
///
/// Which label gets drawn follows what the job actually is. A job with a run
/// is drawn from the run's own snapshot — those words were frozen when it was
/// queued and a reprint six weeks from now must reproduce them, not today's
/// catalogue. A job nobody has queued is drawn from the job, mapped exactly
/// the way `open_session` will snapshot it, barcode payload included.
pub fn preview_job_label(
    connection: &Connection,
    job_id: &str,
    request: &LabelPreviewRequest,
) -> Result<LabelPreview, EdgeError> {
    let run: Option<(String, i64, i64)> = connection
        .query_row(
            "SELECT session_id,label_width_mm,label_height_mm
               FROM print_session WHERE job_id = ?1",
            params![job_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db)?;

    // An open run has already been told what stock it is on, so that is what
    // an unqualified preview draws. Asking for a size is how somebody tries a
    // different reel before committing a bench to it.
    let (fallback_width, fallback_height) = run
        .as_ref()
        .map(|(_, width, height)| (*width, *height))
        .unwrap_or_else(|| (default_label_width(), default_label_height()));
    let width_mm = request.label_width_mm.unwrap_or(fallback_width);
    let height_mm = request.label_height_mm.unwrap_or(fallback_height);
    validate_label_size(width_mm, height_mm)?;

    let sku_code = request
        .sku_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let (item, source) = match run.as_ref() {
        Some((session_id, _, _)) => (queued_label(connection, session_id, sku_code)?, "SESSION"),
        None => (job_label(connection, job_id, sku_code)?, "JOB"),
    };

    let size = LabelSize {
        width_mm: width_mm as f64,
        height_mm: height_mm as f64,
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

    Ok(LabelPreview {
        // The bench is shown what its own printer will be handed, not what a
        // Zebra would have been: a preview in the wrong language is a preview
        // of somebody else's tag.
        zpl: render_label_in(&data, size, LabelBrand(LABEL_BRAND), PrinterLanguage::from_env()),
        svg: preview_label(&data, size, LabelBrand(LABEL_BRAND)),
        sku_code: item.sku_code,
        article_name: item.article_name,
        colour_label: item.colour_label,
        size_label: item.size_label,
        barcode_payload: item.barcode_payload,
        price_minor: item.price_minor,
        epc: item.epc,
        label_width_mm: width_mm,
        label_height_mm: height_mm,
        source: source.to_string(),
    })
}

/// The next label this run will produce — or, when nothing is left to print,
/// the first one it produced. A finished run still has to be able to show what
/// came out of it.
fn queued_label(
    connection: &Connection,
    session_id: &str,
    sku_code: Option<&str>,
) -> Result<QueuedItem, EdgeError> {
    connection
        .query_row(
            "SELECT epc,seq,sku_code,article_name,colour_label,size_label,
                    barcode_payload,price_minor,attempts
               FROM print_item
              WHERE session_id = ?1 AND (?2 IS NULL OR sku_code = ?2)
              ORDER BY CASE WHEN status IN ('PENDING','FAILED') THEN 0 ELSE 1 END, seq
              LIMIT 1",
            params![session_id, sku_code],
            |row| {
                Ok(QueuedItem {
                    epc: row.get(0)?,
                    seq: row.get(1)?,
                    sku_code: row.get(2)?,
                    article_name: row.get(3)?,
                    colour_label: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    size_label: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    barcode_payload: row.get(6)?,
                    price_minor: row.get(7)?,
                    attempts: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(db)?
        .ok_or_else(|| match sku_code {
            Some(sku) => EdgeError::NotFound(format!("no label for {sku} in this run")),
            None => EdgeError::NotFound(format!("print session {session_id} has no labels")),
        })
}

/// A label of a job nobody has queued yet.
///
/// Mapped exactly the way `open_session` will snapshot it and not merely
/// similarly: the barcode carries the bare SKU rather than the line's
/// `barcode_payload`, because that is what the scanners on the shop floor are
/// calibrated to, and the article name comes from the job rather than the
/// line. A preview that read either of those differently would be a picture of
/// a label the run is never going to print.
fn job_label(
    connection: &Connection,
    job_id: &str,
    sku_code: Option<&str>,
) -> Result<QueuedItem, EdgeError> {
    connection
        .query_row(
            "SELECT (SELECT e.epc FROM tagging_job_epc e
                      WHERE e.job_id = l.job_id AND e.sku_code = l.sku_code
                      ORDER BY e.epc LIMIT 1),
                    l.sku_code, j.article_name, l.colour_label, l.size_label,
                    l.base_price_minor
               FROM tagging_job_line l
               JOIN tagging_job j ON j.job_id = l.job_id
              WHERE l.job_id = ?1 AND (?2 IS NULL OR l.sku_code = ?2)
              ORDER BY l.sku_code
              LIMIT 1",
            params![job_id, sku_code],
            |row| {
                let sku: String = row.get(1)?;
                Ok(QueuedItem {
                    // Blank when the centre has not sent the tags yet. The
                    // renderer takes that as "no RFID write", which is what a
                    // job in that state would actually print.
                    epc: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    seq: 1,
                    article_name: row.get(2)?,
                    colour_label: row.get(3)?,
                    size_label: row.get(4)?,
                    barcode_payload: sku.clone(),
                    sku_code: sku,
                    price_minor: row.get(5)?,
                    attempts: 0,
                })
            },
        )
        .optional()
        .map_err(db)?
        .ok_or_else(|| match sku_code {
            Some(sku) => EdgeError::NotFound(format!("tagging job {job_id} has no line {sku}")),
            None => EdgeError::NotFound(format!("tagging job {job_id}")),
        })
}

/// Hand out the next chunk of labels, already rendered.
///
/// Failed labels come back around: a run that lost four tags to a jam reprints
/// four, not four hundred.
pub fn claim_chunk(
    connection: &mut Connection,
    session_id: &str,
) -> Result<ClaimedChunk, EdgeError> {
    let transaction = connection.transaction().map_err(db)?;

    let (chunk_size, width_mm, height_mm, printer_host, printer_port): (
        i64,
        i64,
        i64,
        String,
        i64,
    ) = transaction
        .query_row(
            "SELECT chunk_size,label_width_mm,label_height_mm,printer_host,printer_port
               FROM print_session WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                EdgeError::NotFound(format!("print session {session_id}"))
            }
            other => db(other),
        })?;

    let mut select = transaction
        .prepare(
            "SELECT epc,seq,sku_code,article_name,colour_label,size_label,
                    barcode_payload,price_minor,attempts
               FROM print_item
              WHERE session_id = ?1 AND status IN ('PENDING','FAILED')
              ORDER BY seq
              LIMIT ?2",
        )
        .map_err(db)?;
    let rows: Vec<QueuedItem> = select
        .query_map(params![session_id, chunk_size], |row| {
            Ok(QueuedItem {
                epc: row.get(0)?,
                seq: row.get(1)?,
                sku_code: row.get(2)?,
                article_name: row.get(3)?,
                // Null for labels queued before the tag carried these, which
                // the renderer takes as "this tag does not say".
                colour_label: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                size_label: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                barcode_payload: row.get(6)?,
                price_minor: row.get(7)?,
                attempts: row.get(8)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(select);

    let size = LabelSize {
        width_mm: width_mm as f64,
        height_mm: height_mm as f64,
    };
    // Read once for the chunk rather than per label: the printer at a bench
    // does not change language between two tags of the same run.
    let language = PrinterLanguage::from_env();
    let now = now_text();
    let mut claimed = Vec::with_capacity(rows.len());

    for item in rows {
        // The attempt is counted here, where the label leaves for the printer.
        // Counting it on the way back would lose every label the dispatcher
        // never got an answer about, which is exactly the interesting case.
        transaction
            .execute(
                "UPDATE print_item
                    SET status='CLAIMED', attempts = attempts + 1, claimed_at = ?2
                  WHERE epc = ?1",
                params![item.epc, now],
            )
            .map_err(db)?;

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

        claimed.push(ClaimedLabel {
            epc: item.epc,
            seq: item.seq,
            sku_code: item.sku_code,
            attempts: item.attempts + 1,
            zpl,
        });
    }

    if !claimed.is_empty() {
        transaction
            .execute(
                "UPDATE print_session
                    SET status = 'PRINTING', updated_at = ?2
                  WHERE session_id = ?1 AND status = 'OPEN'",
                params![session_id, now],
            )
            .map_err(db)?;
    }

    transaction.commit().map_err(db)?;
    Ok(ClaimedChunk {
        printer_host,
        printer_port: u16::try_from(printer_port).unwrap_or(9100),
        labels: claimed,
    })
}

/// Record what the printer did with a claimed chunk.
pub fn record_outcomes(
    connection: &mut Connection,
    session_id: &str,
    outcomes: &[PrintOutcomeRecord],
) -> Result<PrintSessionSummary, EdgeError> {
    let transaction = connection.transaction().map_err(db)?;
    let now = now_text();

    for outcome in outcomes {
        let changed = match outcome.error.as_deref() {
            None => transaction
                .execute(
                    "UPDATE print_item
                        SET status='PRINTED', printed_at = ?3, last_error = NULL
                      WHERE epc = ?1 AND session_id = ?2",
                    params![&outcome.epc, session_id, now],
                )
                .map_err(db)?,
            Some(message) => {
                let message = if message.trim().is_empty() {
                    "printer reported an unspecified failure"
                } else {
                    message
                };
                transaction
                    .execute(
                        "UPDATE print_item
                            SET status='FAILED', last_error = ?3, printed_at = NULL
                          WHERE epc = ?1 AND session_id = ?2",
                        params![&outcome.epc, session_id, message],
                    )
                    .map_err(db)?
            }
        };
        if changed == 0 {
            return Err(EdgeError::NotFound(format!(
                "label {} is not part of print session {session_id}",
                outcome.epc
            )));
        }
    }

    recompute(&transaction, session_id, &now)?;
    transaction.commit().map_err(db)?;
    summarise(connection, session_id)
}

/// Bring a session's counters and status back in line with its items.
///
/// Counters and status are recomputed from the items, so they cannot drift
/// away from what the queue actually holds. Shared by everything that moves an
/// item between states: two copies of this arithmetic would be two answers to
/// "is this run finished", and the schema's own CHECKs would start refusing
/// perfectly ordinary work.
fn recompute(transaction: &Transaction<'_>, session_id: &str, now: &str) -> Result<(), EdgeError> {
    // Counts and status move in ONE statement, because SQLite checks its
    // CHECKs after each one. Writing the counters first and the status second
    // is a moment where a run that has just had a label put back for reprint
    // still calls itself COMPLETED while its printed count has already
    // dropped — which the schema refuses, and rightly.
    transaction
        .execute(
            "UPDATE print_session AS s SET
                 printed_count = counted.printed,
                 failed_count  = counted.failed,
                 status = CASE
                     WHEN counted.printed = s.total_items THEN 'COMPLETED'
                     WHEN counted.printed + counted.failed = s.total_items THEN 'PARTIAL'
                     ELSE 'PRINTING'
                 END,
                 closed_at = CASE
                     WHEN counted.printed + counted.failed = s.total_items THEN ?2
                     ELSE NULL
                 END,
                 updated_at = ?2
               FROM (SELECT COALESCE(SUM(status = 'PRINTED'), 0) AS printed,
                            COALESCE(SUM(status = 'FAILED'), 0) AS failed
                       FROM print_item WHERE session_id = ?1) AS counted
              WHERE s.session_id = ?1 AND s.status <> 'CANCELLED'",
            params![session_id, now],
        )
        .map_err(db)?;

    Ok(())
}

pub fn summarise(
    connection: &Connection,
    session_id: &str,
) -> Result<PrintSessionSummary, EdgeError> {
    connection
        .query_row(
            "SELECT s.session_id,s.job_id,s.status,
                    s.printer_host,s.printer_port,s.chunk_size,
                    s.label_width_mm,s.label_height_mm,
                    s.total_items,s.printed_count,s.failed_count,
                    (SELECT COUNT(*) FROM print_item
                      WHERE session_id = s.session_id AND status IN ('PENDING','CLAIMED','FAILED'))
               FROM print_session s WHERE s.session_id = ?1",
            params![session_id],
            |row| {
                Ok(PrintSessionSummary {
                    session_id: row.get(0)?,
                    job_id: row.get(1)?,
                    status: row.get(2)?,
                    printer_host: row.get(3)?,
                    printer_port: u16::try_from(row.get::<_, i64>(4)?).unwrap_or(9100),
                    chunk_size: row.get(5)?,
                    label_width_mm: row.get(6)?,
                    label_height_mm: row.get(7)?,
                    total_items: row.get(8)?,
                    printed_count: row.get(9)?,
                    failed_count: row.get(10)?,
                    pending_count: row.get(11)?,
                })
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                EdgeError::NotFound(format!("print session {session_id}"))
            }
            other => db(other),
        })
}

/// The run a tagging job already has, if anybody ever opened one.
///
/// A print run outlives the screen that started it: a handheld sleeps, a tab
/// reloads, an operator walks away mid-batch. While the session id lived only
/// in the browser, losing it meant a job that could never be finished — a
/// second `open_session` is refused, and rightly so, because two sessions
/// would be two tags carrying one identity.
pub fn session_for_job(
    connection: &Connection,
    job_id: &str,
) -> Result<Option<PrintSessionSummary>, EdgeError> {
    let session_id: Option<String> = connection
        .query_row(
            "SELECT session_id FROM print_session WHERE job_id = ?1",
            params![job_id],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(db(other)),
        })?;

    match session_id {
        None => Ok(None),
        Some(session_id) => summarise(connection, &session_id).map(Some),
    }
}

/// Point an open run at a different printer.
///
/// Deliberately an explicit act rather than something `run_print_chunk` infers
/// from whoever called it: a resumed run silently following the caller's own
/// printer setting is how one operator's labels appear on another operator's
/// bench, and nobody would know which of the two started it.
pub fn repoint(
    connection: &mut Connection,
    session_id: &str,
    request: RepointPrinterRequest,
) -> Result<PrintSessionSummary, EdgeError> {
    let host = request.printer_host.trim().to_string();
    if host.is_empty() {
        return Err(EdgeError::Validation("printer host is required".into()));
    }
    if let Some(chunk_size) = request.chunk_size {
        if !(1..=1000).contains(&chunk_size) {
            return Err(EdgeError::Validation(
                "chunk size must be between 1 and 1000".into(),
            ));
        }
    }
    // Checked one axis at a time: a bench that changed only its width should
    // not have to restate its height to be believed.
    if let Some(width_mm) = request.label_width_mm {
        validate_label_size(width_mm, MIN_LABEL_MM)?;
    }
    if let Some(height_mm) = request.label_height_mm {
        validate_label_size(MIN_LABEL_MM, height_mm)?;
    }

    let status: String = connection
        .query_row(
            "SELECT status FROM print_session WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                EdgeError::NotFound(format!("print session {session_id}"))
            }
            other => db(other),
        })?;
    // A finished run has nothing left to send anywhere. Moving it would look
    // like it did something.
    if status == "COMPLETED" || status == "CANCELLED" {
        return Err(EdgeError::Validation(format!(
            "print session {session_id} is {}",
            status.to_lowercase()
        )));
    }

    connection
        .execute(
            "UPDATE print_session
                SET printer_host = ?2,
                    printer_port = ?3,
                    chunk_size = COALESCE(?4, chunk_size),
                    label_width_mm = COALESCE(?5, label_width_mm),
                    label_height_mm = COALESCE(?6, label_height_mm),
                    updated_at = ?7
              WHERE session_id = ?1",
            params![
                session_id,
                host,
                i64::from(request.printer_port),
                request.chunk_size,
                request.label_width_mm,
                request.label_height_mm,
                now_text(),
            ],
        )
        .map_err(db)?;

    summarise(connection, session_id)
}

/// Put labels that have already printed back in the queue.
///
/// The queue's own retry only brings back what the printer refused, which is
/// the common case and not the expensive one. The expensive one is a tag that
/// printed perfectly and was then lost — a jam that cooked the next four, a
/// strip nobody can scan, a garment that came back from the floor with its tag
/// torn off. Until this existed the only way to recover those was to edit the
/// database by hand, and the temptation instead was to mint fresh EPCs.
///
/// So: the same EPC is reprinted, never a new one. The unit's identity is
/// already in the ledger and already on the shop floor; a second EPC for one
/// garment is the same corruption as printing a job twice.
pub fn reprint(
    connection: &mut Connection,
    session_id: &str,
    request: ReprintRequest,
) -> Result<PrintSessionSummary, EdgeError> {
    let range = match (request.from_seq, request.to_seq) {
        (None, None) => None,
        (Some(from), Some(to)) if from <= to && from > 0 => Some((from, to)),
        _ => {
            return Err(EdgeError::Validation(
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
        return Err(EdgeError::Validation(
            "name the labels to reprint, by EPC or by position".into(),
        ));
    }

    let transaction = connection.transaction().map_err(db)?;

    let status: String = transaction
        .query_row(
            "SELECT status FROM print_session WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                EdgeError::NotFound(format!("print session {session_id}"))
            }
            other => db(other),
        })?;
    if status == "CANCELLED" {
        return Err(EdgeError::Validation(format!(
            "print session {session_id} is cancelled"
        )));
    }

    let now = now_text();
    let mut requeued = 0usize;

    // A label the operator named must exist in this run. Naming one from
    // another run is a mistake worth stopping, not a no-op worth hiding.
    for epc in &epcs {
        let known: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM print_item
                  WHERE session_id = ?1 AND upper(epc) = ?2",
                params![session_id, epc],
                |row| row.get(0),
            )
            .map_err(db)?;
        if known == 0 {
            return Err(EdgeError::NotFound(format!(
                "label {epc} is not part of print session {session_id}"
            )));
        }
        // Only what actually printed comes back. One already waiting its turn
        // is left alone: an operator naming a mixed handful means all of them
        // to be printed, not an error.
        requeued += transaction
            .execute(
                // `attempts` and `claimed_at` are left where they are: they
                // record what this label has already cost, and an operator
                // deciding whether the printer is misbehaving needs to see
                // that this is its fourth pass, not its first.
                "UPDATE print_item
                    SET status='PENDING', printed_at = NULL, last_error = NULL
                  WHERE session_id = ?1 AND upper(epc) = ?2 AND status = 'PRINTED'",
                params![session_id, epc],
            )
            .map_err(db)?;
    }

    if let Some((from, to)) = range {
        requeued += transaction
            .execute(
                "UPDATE print_item
                    SET status='PENDING', printed_at = NULL, last_error = NULL
                  WHERE session_id = ?1 AND seq BETWEEN ?2 AND ?3
                    AND status = 'PRINTED'",
                params![session_id, from, to],
            )
            .map_err(db)?;
    }

    if requeued == 0 {
        return Err(EdgeError::Validation(
            "none of those labels have printed, so they are already waiting".into(),
        ));
    }

    recompute(&transaction, session_id, &now)?;
    transaction.commit().map_err(db)?;
    summarise(connection, session_id)
}

/// Hand a claimed chunk to the printer, one label per connection.
///
/// Per label rather than per chunk: a single socket carrying four hundred
/// labels that dies halfway leaves nobody able to say which ones landed, and
/// the whole point of the queue is to reprint four tags instead of four
/// hundred. A connection per label costs milliseconds and buys attribution.
///
/// Never returns an error. A printer that is off, jammed, or absent is an
/// ordinary Tuesday, and every label it did not take must come back as a
/// FAILED row that can be retried — not as a request that blew up.
pub fn dispatch_chunk(host: &str, port: u16, labels: &[ClaimedLabel]) -> Vec<PrintOutcomeRecord> {
    let addresses = match resolve_printer(host, port) {
        Ok(addresses) => addresses,
        Err(error) => {
            let message = error.to_string();
            return labels
                .iter()
                .map(|label| PrintOutcomeRecord {
                    epc: label.epc.clone(),
                    error: Some(message.clone()),
                })
                .collect();
        }
    };

    labels
        .iter()
        .map(|label| PrintOutcomeRecord {
            epc: label.epc.clone(),
            error: send_one(&addresses, label.zpl.as_bytes()),
        })
        .collect()
}

/// Send one already-rendered job to a printer. Used for stickers and other
/// one-off documents that have no queue behind them: there is nothing to
/// chunk, retry or resume, so wrapping them in a session would be ceremony.
pub fn send_document(host: &str, port: u16, payload: &str) -> Result<(), EdgeError> {
    let addresses = resolve_printer(host, port)?;
    match send_one(&addresses, payload.as_bytes()) {
        None => Ok(()),
        Some(message) => Err(EdgeError::Persistence(message)),
    }
}

/// Resolve the printer and refuse the addresses a printer is never at.
///
/// An operator types this address, so it is the way an internal HTTP service
/// could be made to receive a socket full of ZPL. Link-local is refused because
/// that is where cloud metadata endpoints live; unspecified and multicast
/// because no printer answers there. Private ranges and loopback stay allowed:
/// the printer IS on the LAN, and the test harness is on loopback.
fn resolve_printer(host: &str, port: u16) -> Result<Vec<SocketAddr>, EdgeError> {
    let host = host.trim();
    if host.is_empty() {
        return Err(EdgeError::Validation("printer host is required".into()));
    }
    let addresses: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|error| {
            EdgeError::Validation(format!("cannot resolve printer host {host}: {error}"))
        })?
        .collect();
    if addresses.is_empty() {
        return Err(EdgeError::Validation(format!(
            "printer host {host} resolved to no address"
        )));
    }
    for address in &addresses {
        if is_disallowed(address.ip()) {
            return Err(EdgeError::Validation(format!(
                "printer host {host} resolves to a disallowed address {}",
                address.ip()
            )));
        }
    }
    Ok(addresses)
}

fn is_disallowed(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_unspecified() || v4.is_link_local() || v4.is_multicast(),
        IpAddr::V6(v6) => {
            v6.is_unspecified() || v6.is_multicast() || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

/// `None` on success; a message describing what the printer did otherwise.
fn send_one(addresses: &[SocketAddr], payload: &[u8]) -> Option<String> {
    let mut last = "printer had no reachable address".to_string();
    for address in addresses {
        match TcpStream::connect_timeout(address, PRINTER_TIMEOUT) {
            Ok(mut stream) => {
                if let Err(error) = stream.set_write_timeout(Some(PRINTER_TIMEOUT)) {
                    last = format!("cannot set write timeout for {address}: {error}");
                    continue;
                }
                return match stream.write_all(payload).and_then(|()| stream.flush()) {
                    Ok(()) => None,
                    Err(error) => Some(format!("write to {address} failed: {error}")),
                };
            }
            Err(error) => last = format!("connect to {address} failed: {error}"),
        }
    }
    Some(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TAGGING_SCHEMA: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/migrations/sqlite/0006_edge_tagging.sql"
    ));
    const PRINTING_SCHEMA: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/migrations/sqlite/0008_edge_printing.sql"
    ));
    const LABEL_COLOUR_SIZE_SCHEMA: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/migrations/sqlite/0020_print_item_colour_and_size.sql"
    ));

    /// A tagging job for one SKU with `count` EPCs, exactly as the cloud sends
    /// it down: ranges expanded to one row per label.
    fn job_with(count: usize) -> Connection {
        let connection = match Connection::open_in_memory() {
            Ok(connection) => connection,
            Err(error) => panic!("open: {error}"),
        };
        for schema in [TAGGING_SCHEMA, PRINTING_SCHEMA, LABEL_COLOUR_SIZE_SCHEMA] {
            if let Err(error) = connection.execute_batch(schema) {
                panic!("schema: {error}");
            }
        }
        let statements = [
            "INSERT INTO tagging_job
                 (job_id,session_id,article_code,article_name,total_quantity,
                  status,issued_at,received_at)
             VALUES('job-1','sess-1','12345678','Kemeja katun',9,'OPEN','t0','t0')"
                .to_string(),
            "INSERT INTO tagging_job_line
                 (job_id,sku_code,colour_digit,colour_label,size_code,size_label,
                  quantity,qr_payload,barcode_payload,base_price_minor)
             VALUES('job-1','12345678123','1','Biru','23','M',9,
                    'R1:12345678123','812345678123',89000)"
                .to_string(),
        ];
        for statement in statements {
            if let Err(error) = connection.execute(&statement, []) {
                panic!("seed: {error}");
            }
        }
        for index in 0..count {
            let epc = format!("A0123456781230000000{index:04}");
            if let Err(error) = connection.execute(
                "INSERT INTO tagging_job_epc(epc,job_id,sku_code)
                 VALUES(?1,'job-1','12345678123')",
                params![epc],
            ) {
                panic!("seed epc: {error}");
            }
        }
        connection
    }

    /// A job carrying two SKUs of one article — the ordinary case, since an
    /// article is tagged in every colourway and size at once.
    fn job_with_two_skus() -> Connection {
        let connection = job_with(0);
        let statements = [
            "INSERT INTO tagging_job_line
                 (job_id,sku_code,colour_digit,colour_label,size_code,size_label,
                  quantity,qr_payload,barcode_payload,base_price_minor)
             VALUES('job-1','12345678207','2','Merah','07','XXL',1,
                    'R1:12345678207','812345678207',129000)",
            "INSERT INTO tagging_job_epc(epc,job_id,sku_code)
             VALUES('A01234567812300000000001','job-1','12345678123')",
            "INSERT INTO tagging_job_epc(epc,job_id,sku_code)
             VALUES('A01234567820700000000002','job-1','12345678207')",
        ];
        for statement in statements {
            if let Err(error) = connection.execute(statement, []) {
                panic!("seed: {error}");
            }
        }
        connection
    }

    #[test]
    fn every_label_carries_its_own_skus_colour_size_and_price() {
        // The tag is not a template with the article stamped on it: colour,
        // size and price are per SKU, and a run that rendered the first line's
        // values onto every label would put a red XXL price on a blue M
        // garment — a mispriced item that reads correctly to a scanner.
        let mut connection = job_with_two_skus();
        let summary = open(&mut connection);
        let labels = claim(&mut connection, &summary.session_id);
        assert_eq!(labels.len(), 2);

        let blue = labels
            .iter()
            .find(|label| label.sku_code == "12345678123")
            .unwrap_or_else(|| panic!("no label for the blue M"));
        assert!(blue.zpl.contains("^FDM^FS"), "{}", blue.zpl);
        assert!(blue.zpl.contains("^FDBiru^FS"), "{}", blue.zpl);
        assert!(blue.zpl.contains("^FDRp 89.000^FS"), "{}", blue.zpl);
        assert!(blue.zpl.contains("^FD12345678123^FS"), "{}", blue.zpl);

        let red = labels
            .iter()
            .find(|label| label.sku_code == "12345678207")
            .unwrap_or_else(|| panic!("no label for the red XXL"));
        assert!(red.zpl.contains("^FDXXL^FS"), "{}", red.zpl);
        assert!(red.zpl.contains("^FDMerah^FS"), "{}", red.zpl);
        assert!(red.zpl.contains("^FDRp 129.000^FS"), "{}", red.zpl);
        assert!(red.zpl.contains("^FD12345678207^FS"), "{}", red.zpl);

        // And the EPC is per unit, not per SKU: no two labels in a run may
        // carry the same one.
        assert_ne!(blue.epc, red.epc);
    }

    fn request() -> OpenPrintSessionRequest {
        OpenPrintSessionRequest {
            job_id: "job-1".into(),
            printer_host: "10.0.0.9".into(),
            printer_port: 9100,
            label_width_mm: 58,
            label_height_mm: 40,
            chunk_size: Some(4),
            actor_id: "operator-1".into(),
        }
    }

    fn open(connection: &mut Connection) -> PrintSessionSummary {
        match open_session(connection, request()) {
            Ok(summary) => summary,
            Err(error) => panic!("open_session: {error}"),
        }
    }

    fn claim(connection: &mut Connection, session_id: &str) -> Vec<ClaimedLabel> {
        match claim_chunk(connection, session_id) {
            Ok(chunk) => chunk.labels,
            Err(error) => panic!("claim_chunk: {error}"),
        }
    }

    fn ok(label: &ClaimedLabel) -> PrintOutcomeRecord {
        PrintOutcomeRecord {
            epc: label.epc.clone(),
            error: None,
        }
    }

    #[test]
    fn a_tagging_job_becomes_one_label_per_epc() {
        let mut connection = job_with(9);
        let summary = open(&mut connection);
        assert_eq!(summary.total_items, 9);
        assert_eq!(summary.pending_count, 9);
        assert_eq!(summary.status, "OPEN");
    }

    #[test]
    fn a_job_is_never_queued_twice() {
        let mut connection = job_with(3);
        open(&mut connection);
        match open_session(&mut connection, request()) {
            Err(EdgeError::Conflict(_)) => {}
            other => panic!("expected a conflict, got {other:?}"),
        }
    }

    #[test]
    fn labels_are_handed_out_a_chunk_at_a_time() {
        let mut connection = job_with(9);
        let summary = open(&mut connection);
        let first = claim(&mut connection, &summary.session_id);
        assert_eq!(first.len(), 4, "chunk size governs the hand-out");
        assert_eq!(first[0].seq, 1);

        // A claimed label is not offered again while it is out at the printer.
        let second = claim(&mut connection, &summary.session_id);
        assert_eq!(second.len(), 4);
        assert_eq!(second[0].seq, 5);
    }

    #[test]
    fn a_claimed_label_carries_zpl_that_writes_its_own_epc() {
        let mut connection = job_with(1);
        let summary = open(&mut connection);
        let labels = claim(&mut connection, &summary.session_id);
        let label = match labels.first() {
            Some(label) => label,
            None => panic!("expected one label"),
        };
        assert!(
            label
                .zpl
                .contains(&format!("^RFW,H,1,12,1^FD{}^FS", label.epc)),
            "{}",
            label.zpl
        );
        // The scanners on the floor read the eleven-digit SKU, not `8{sku}`.
        assert!(label.zpl.contains("^FD12345678123^FS"), "{}", label.zpl);
        assert!(!label.zpl.contains("812345678123"), "{}", label.zpl);
        assert!(label.zpl.contains("^FDCENTRAL^FS"), "{}", label.zpl);
    }

    #[test]
    fn only_the_failed_labels_come_back_around() {
        let mut connection = job_with(4);
        let summary = open(&mut connection);
        let labels = claim(&mut connection, &summary.session_id);
        assert_eq!(labels.len(), 4);

        let outcomes = vec![
            ok(&labels[0]),
            ok(&labels[1]),
            PrintOutcomeRecord {
                epc: labels[2].epc.clone(),
                error: Some("media out".into()),
            },
            ok(&labels[3]),
        ];
        let after = match record_outcomes(&mut connection, &summary.session_id, &outcomes) {
            Ok(after) => after,
            Err(error) => panic!("record: {error}"),
        };
        assert_eq!(after.printed_count, 3);
        assert_eq!(after.failed_count, 1);
        assert_eq!(after.status, "PARTIAL", "one label still owed");

        let retry = claim(&mut connection, &summary.session_id);
        assert_eq!(retry.len(), 1, "only the jammed label reprints");
        assert_eq!(retry[0].epc, labels[2].epc);
        assert_eq!(retry[0].attempts, 2, "the second attempt is counted");
    }

    #[test]
    fn a_run_is_complete_only_when_every_label_printed() {
        let mut connection = job_with(2);
        let summary = open(&mut connection);
        let labels = claim(&mut connection, &summary.session_id);
        let outcomes: Vec<PrintOutcomeRecord> = labels.iter().map(ok).collect();
        let after = match record_outcomes(&mut connection, &summary.session_id, &outcomes) {
            Ok(after) => after,
            Err(error) => panic!("record: {error}"),
        };
        assert_eq!(after.status, "COMPLETED");
        assert_eq!(after.pending_count, 0);
    }

    #[test]
    fn a_label_from_another_run_is_refused() {
        let mut connection = job_with(2);
        let summary = open(&mut connection);
        let outcomes = [PrintOutcomeRecord {
            epc: "A0999999999990000000009".into(),
            error: None,
        }];
        match record_outcomes(&mut connection, &summary.session_id, &outcomes) {
            Err(EdgeError::NotFound(_)) => {}
            other => panic!("expected not found, got {other:?}"),
        }
    }

    #[test]
    fn a_printer_address_that_is_really_a_metadata_endpoint_is_refused() {
        // 169.254.169.254 is where cloud metadata answers, not where tags print.
        match resolve_printer("169.254.169.254", 9100) {
            Err(EdgeError::Validation(message)) => {
                assert!(message.contains("disallowed"), "{message}");
            }
            other => panic!("expected the address to be refused, got {other:?}"),
        }
    }

    #[test]
    fn an_unreachable_printer_fails_every_label_instead_of_the_request() {
        let labels = [ClaimedLabel {
            epc: "A01234567812300000000064".into(),
            seq: 1,
            sku_code: "12345678123".into(),
            attempts: 1,
            zpl: "^XA^XZ\n".into(),
        }];
        let outcomes = dispatch_chunk("169.254.169.254", 9100, &labels);
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].error.is_some(), "{outcomes:?}");
        assert_eq!(outcomes[0].epc, labels[0].epc);
    }

    #[test]
    fn a_job_the_node_never_received_cannot_be_printed() {
        let mut connection = job_with(1);
        let mut missing = request();
        missing.job_id = "job-absent".into();
        match open_session(&mut connection, missing) {
            Err(EdgeError::NotFound(_)) => {}
            other => panic!("expected not found, got {other:?}"),
        }
    }

    #[test]
    fn a_run_can_be_found_again_from_the_job_alone() {
        let mut connection = job_with(9);
        let opened = open(&mut connection);

        // This is the reload: nothing is remembered but the job.
        let found = match session_for_job(&connection, "job-1") {
            Ok(Some(found)) => found,
            other => panic!("expected the open run, got {other:?}"),
        };
        assert_eq!(found.session_id, opened.session_id);
        assert_eq!(found.pending_count, 9);
        // And it says which bench it belongs to, so whoever resumed it can see
        // where the labels will come out.
        assert_eq!(found.printer_host, "10.0.0.9");
        assert_eq!(found.chunk_size, 4);
    }

    #[test]
    fn a_job_nobody_has_queued_has_no_run() {
        let connection = job_with(1);
        match session_for_job(&connection, "job-1") {
            Ok(None) => {}
            other => panic!("expected no run, got {other:?}"),
        }
    }

    #[test]
    fn a_run_follows_the_bench_that_picked_it_up() {
        let mut connection = job_with(9);
        let opened = open(&mut connection);

        let moved = match repoint(
            &mut connection,
            &opened.session_id,
            RepointPrinterRequest {
                printer_host: "  10.0.0.22  ".into(),
                printer_port: 9101,
                chunk_size: Some(2),
                label_width_mm: None,
                label_height_mm: None,
            },
        ) {
            Ok(moved) => moved,
            Err(error) => panic!("repoint: {error}"),
        };
        assert_eq!(moved.printer_host, "10.0.0.22");
        assert_eq!(moved.printer_port, 9101);

        // The next chunk goes to the new bench, and is the new size.
        let chunk = match claim_chunk(&mut connection, &opened.session_id) {
            Ok(chunk) => chunk,
            Err(error) => panic!("claim_chunk: {error}"),
        };
        assert_eq!(chunk.printer_host, "10.0.0.22");
        assert_eq!(chunk.printer_port, 9101);
        assert_eq!(chunk.labels.len(), 2);
    }

    #[test]
    fn a_bench_holding_other_stock_can_say_so_when_it_takes_a_run_over() {
        let mut connection = job_with(2);
        let opened = open(&mut connection);
        assert_eq!(opened.label_width_mm, 58);
        assert_eq!(opened.label_height_mm, 40);

        let moved = match repoint(
            &mut connection,
            &opened.session_id,
            RepointPrinterRequest {
                printer_host: "10.0.0.22".into(),
                printer_port: 9100,
                chunk_size: None,
                label_width_mm: Some(40),
                label_height_mm: Some(30),
            },
        ) {
            Ok(moved) => moved,
            Err(error) => panic!("repoint: {error}"),
        };
        assert_eq!(moved.label_width_mm, 40);
        assert_eq!(moved.label_height_mm, 30);

        // And the labels that come out afterwards are drawn for it. Before
        // this, the geometry was frozen at the moment the run was opened and
        // the number on the screen quietly stopped meaning anything.
        let labels = claim(&mut connection, &opened.session_id);
        assert!(labels[0].zpl.contains("^PW320\n"), "{}", labels[0].zpl);
        assert!(labels[0].zpl.contains("^LL240\n"), "{}", labels[0].zpl);
    }

    #[test]
    fn moving_a_run_to_another_printer_does_not_redraw_its_labels() {
        let mut connection = job_with(2);
        let opened = open(&mut connection);
        let moved = match repoint(
            &mut connection,
            &opened.session_id,
            RepointPrinterRequest {
                printer_host: "10.0.0.22".into(),
                printer_port: 9100,
                chunk_size: None,
                label_width_mm: None,
                label_height_mm: None,
            },
        ) {
            Ok(moved) => moved,
            Err(error) => panic!("repoint: {error}"),
        };
        assert_eq!(moved.label_width_mm, 58);
        assert_eq!(moved.label_height_mm, 40);
    }

    #[test]
    fn a_tag_size_nobody_could_have_meant_is_refused_with_a_sentence() {
        let mut connection = job_with(1);
        let mut opening = request();
        opening.label_width_mm = 580;
        match open_session(&mut connection, opening) {
            Err(EdgeError::Validation(message)) => {
                assert!(message.contains("580"), "{message}");
                assert!(message.contains("mm"), "{message}");
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
    }

    // -----------------------------------------------------------------------
    // Seeing the label before the ribbon runs
    // -----------------------------------------------------------------------

    #[test]
    fn a_preview_of_an_unqueued_job_is_the_label_the_run_will_actually_print() {
        // The strongest thing this can assert, and the only one worth
        // asserting: draw the job, then queue it and claim the first label for
        // real, and require the two to be the same bytes. A preview that is
        // merely similar is the bug this exists to prevent.
        let mut connection = job_with(3);
        let drawn = match preview_job_label(&connection, "job-1", &LabelPreviewRequest::default()) {
            Ok(drawn) => drawn,
            Err(error) => panic!("preview: {error}"),
        };
        assert_eq!(drawn.source, "JOB");

        let opened = open(&mut connection);
        let labels = claim(&mut connection, &opened.session_id);
        assert_eq!(drawn.zpl, labels[0].zpl);
        assert_eq!(drawn.epc, labels[0].epc);
    }

    #[test]
    fn a_preview_draws_the_next_label_a_run_has_left_to_print() {
        // Nine labels against a chunk of four, so one pass leaves five still
        // to come. A run that finished in a single pass would prove nothing
        // here: with nothing pending the preview falls back to the first
        // label, which is the other half of what this behaviour is.
        let mut connection = job_with(9);
        let opened = open(&mut connection);
        let first = claim(&mut connection, &opened.session_id);
        let outcomes: Vec<PrintOutcomeRecord> = first.iter().map(ok).collect();
        if let Err(error) = record_outcomes(&mut connection, &opened.session_id, &outcomes) {
            panic!("record: {error}");
        }

        let drawn = match preview_job_label(&connection, "job-1", &LabelPreviewRequest::default()) {
            Ok(drawn) => drawn,
            Err(error) => panic!("preview: {error}"),
        };
        assert_eq!(drawn.source, "SESSION");
        // Not one of the labels already on a garment.
        assert!(
            !first.iter().any(|label| label.epc == drawn.epc),
            "preview showed a tag that has already printed: {}",
            drawn.epc
        );
    }

    #[test]
    fn a_finished_run_can_still_show_what_came_out_of_it() {
        let mut connection = job_with(3);
        let opened = open(&mut connection);
        print_everything(&mut connection, &opened.session_id);

        let drawn = match preview_job_label(&connection, "job-1", &LabelPreviewRequest::default()) {
            Ok(drawn) => drawn,
            Err(error) => panic!("preview: {error}"),
        };
        // Its first label, not an error. Somebody holding a printed tag and
        // asking "is this what we sent?" is exactly who needs this.
        assert_eq!(drawn.source, "SESSION");
        assert_eq!(drawn.epc, "A0123456781230000000".to_string() + "0000");
    }

    #[test]
    fn a_preview_uses_the_stock_the_run_was_opened_on_unless_asked_otherwise() {
        let mut connection = job_with(2);
        let mut opening = request();
        opening.label_width_mm = 40;
        opening.label_height_mm = 30;
        if let Err(error) = open_session(&mut connection, opening) {
            panic!("open: {error}");
        }

        let drawn = match preview_job_label(&connection, "job-1", &LabelPreviewRequest::default()) {
            Ok(drawn) => drawn,
            Err(error) => panic!("preview: {error}"),
        };
        assert_eq!((drawn.label_width_mm, drawn.label_height_mm), (40, 30));
        assert!(drawn.zpl.contains("^PW320\n"), "{}", drawn.zpl);

        // Trying a different reel draws it without touching the run.
        let tried = match preview_job_label(
            &connection,
            "job-1",
            &LabelPreviewRequest {
                label_width_mm: Some(58),
                label_height_mm: Some(40),
                sku_code: None,
            },
        ) {
            Ok(tried) => tried,
            Err(error) => panic!("preview: {error}"),
        };
        assert!(tried.zpl.contains("^PW464\n"), "{}", tried.zpl);
        let after = summarise_job(&connection);
        assert_eq!((after.label_width_mm, after.label_height_mm), (40, 30));
    }

    /// The run this job has, for a test that only cares that it is unchanged.
    fn summarise_job(connection: &Connection) -> PrintSessionSummary {
        match session_for_job(connection, "job-1") {
            Ok(Some(summary)) => summary,
            Ok(None) => panic!("job-1 has no run"),
            Err(error) => panic!("session_for_job: {error}"),
        }
    }

    #[test]
    fn a_preview_can_be_asked_for_one_colourway_of_a_job() {
        let connection = job_with_two_skus();
        let red = match preview_job_label(
            &connection,
            "job-1",
            &LabelPreviewRequest {
                label_width_mm: None,
                label_height_mm: None,
                sku_code: Some("  12345678207  ".into()),
            },
        ) {
            Ok(red) => red,
            Err(error) => panic!("preview: {error}"),
        };
        assert_eq!(red.sku_code, "12345678207");
        assert_eq!(red.colour_label, "Merah");
        assert_eq!(red.size_label, "XXL");
        assert_eq!(red.price_minor, 129_000);
        assert!(red.svg.contains("Merah"), "{}", red.svg);
    }

    #[test]
    fn a_preview_of_a_job_this_node_never_received_says_so() {
        let connection = job_with(1);
        match preview_job_label(&connection, "job-404", &LabelPreviewRequest::default()) {
            Err(EdgeError::NotFound(message)) => assert!(message.contains("job-404"), "{message}"),
            other => panic!("expected a not-found, got {other:?}"),
        }
    }

    #[test]
    fn a_preview_never_opens_a_socket_or_claims_a_label() {
        // The address is the one `a_printer_address_that_is_really_a_metadata
        // _endpoint_is_refused` uses, so anything that tried to print would
        // fail loudly rather than quietly succeed.
        let mut connection = job_with(2);
        let opened = open(&mut connection);
        for _ in 0..3 {
            if let Err(error) =
                preview_job_label(&connection, "job-1", &LabelPreviewRequest::default())
            {
                panic!("preview: {error}");
            }
        }
        let after = match summarise(&connection, &opened.session_id) {
            Ok(after) => after,
            Err(error) => panic!("summarise: {error}"),
        };
        assert_eq!(after.pending_count, 2);
        assert_eq!(after.printed_count, 0);
        assert_eq!(after.status, "OPEN");
    }

    #[test]
    fn a_run_cannot_be_moved_nowhere() {
        let mut connection = job_with(1);
        let opened = open(&mut connection);
        match repoint(
            &mut connection,
            &opened.session_id,
            RepointPrinterRequest {
                printer_host: "   ".into(),
                printer_port: 9100,
                chunk_size: None,
                label_width_mm: None,
                label_height_mm: None,
            },
        ) {
            Err(EdgeError::Validation(_)) => {}
            other => panic!("expected the empty host to be refused, got {other:?}"),
        }
    }

    /// Print the whole run and report every label as landed.
    fn print_everything(connection: &mut Connection, session_id: &str) {
        loop {
            let labels = claim(connection, session_id);
            if labels.is_empty() {
                return;
            }
            let outcomes: Vec<PrintOutcomeRecord> = labels.iter().map(ok).collect();
            if let Err(error) = record_outcomes(connection, session_id, &outcomes) {
                panic!("record_outcomes: {error}");
            }
        }
    }

    #[test]
    fn a_tag_that_printed_and_was_then_destroyed_can_be_done_again() {
        let mut connection = job_with(9);
        let opened = open(&mut connection);
        print_everything(&mut connection, &opened.session_id);

        let again = match reprint(
            &mut connection,
            &opened.session_id,
            ReprintRequest {
                // Lower case, as a reader hands it over.
                epcs: vec!["a0123456781230000000".to_string() + "0003"],
                ..ReprintRequest::default()
            },
        ) {
            Ok(again) => again,
            Err(error) => panic!("reprint: {error}"),
        };

        assert_eq!(again.pending_count, 1);
        assert_eq!(again.printed_count, 8);
        // The run is open again, which is what a run with work left must say.
        assert_eq!(again.status, "PRINTING");

        // And it is the same EPC that goes back on the printer, not a new one.
        let labels = claim(&mut connection, &opened.session_id);
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].epc, "A01234567812300000000003");
        assert!(labels[0]
            .zpl
            .contains("^RFW,H,1,12,1^FDA01234567812300000000003"));
        // Its history follows it: this is the label's second pass.
        assert_eq!(labels[0].attempts, 2);
    }

    #[test]
    fn a_jam_is_undone_by_the_range_it_ate() {
        let mut connection = job_with(9);
        let opened = open(&mut connection);
        print_everything(&mut connection, &opened.session_id);

        let again = match reprint(
            &mut connection,
            &opened.session_id,
            ReprintRequest {
                epcs: Vec::new(),
                from_seq: Some(4),
                to_seq: Some(7),
            },
        ) {
            Ok(again) => again,
            Err(error) => panic!("reprint: {error}"),
        };
        assert_eq!(again.pending_count, 4);

        let labels = claim(&mut connection, &opened.session_id);
        let seqs: Vec<i64> = labels.iter().map(|label| label.seq).collect();
        assert_eq!(seqs, vec![4, 5, 6, 7]);
    }

    #[test]
    fn a_label_from_another_run_is_not_reprinted_here() {
        let mut connection = job_with(2);
        let opened = open(&mut connection);
        print_everything(&mut connection, &opened.session_id);

        match reprint(
            &mut connection,
            &opened.session_id,
            ReprintRequest {
                epcs: vec!["A0999999999990000000001".into()],
                ..ReprintRequest::default()
            },
        ) {
            Err(EdgeError::NotFound(_)) => {}
            other => panic!("expected a stranger's label to be refused, got {other:?}"),
        }
    }

    #[test]
    fn a_reprint_that_names_nothing_printed_is_refused() {
        let mut connection = job_with(4);
        let opened = open(&mut connection);

        // Nothing has printed yet, so these four are already waiting.
        match reprint(
            &mut connection,
            &opened.session_id,
            ReprintRequest {
                epcs: Vec::new(),
                from_seq: Some(1),
                to_seq: Some(4),
            },
        ) {
            Err(EdgeError::Validation(message)) => {
                assert!(message.contains("already waiting"), "{message}");
            }
            other => panic!("expected the reprint to be refused, got {other:?}"),
        }

        // As is a request that names nothing at all.
        match reprint(
            &mut connection,
            &opened.session_id,
            ReprintRequest::default(),
        ) {
            Err(EdgeError::Validation(_)) => {}
            other => panic!("expected an empty reprint to be refused, got {other:?}"),
        }
    }

    #[test]
    fn a_finished_run_is_not_moved_anywhere() {
        let mut connection = job_with(1);
        let opened = open(&mut connection);
        let labels = claim(&mut connection, &opened.session_id);
        let outcomes: Vec<PrintOutcomeRecord> = labels.iter().map(ok).collect();
        let done = match record_outcomes(&mut connection, &opened.session_id, &outcomes) {
            Ok(done) => done,
            Err(error) => panic!("record_outcomes: {error}"),
        };
        assert_eq!(done.status, "COMPLETED");

        match repoint(
            &mut connection,
            &opened.session_id,
            RepointPrinterRequest {
                printer_host: "10.0.0.22".into(),
                printer_port: 9100,
                chunk_size: None,
                label_width_mm: None,
                label_height_mm: None,
            },
        ) {
            Err(EdgeError::Validation(message)) => {
                assert!(message.contains("completed"), "{message}")
            }
            other => panic!("expected a finished run to be refused, got {other:?}"),
        }
    }
}
