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
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::contracts::EdgeError;
use super::zpl::{render_label, LabelBrand, LabelData, LabelSize};

/// The name printed on the top line of every tag.
///
/// Decided 2026-08-31 against the legacy lineage, which disagreed with itself:
/// the current Go renderer prints this, while a tag recovered from the field
/// printed a trading name. This is the one that ships.
pub const LABEL_BRAND: &str = "Wira Makmur";

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

/// Where a run has got to. Counts come from the items, never from a tally kept
/// in parallel with them.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrintSessionSummary {
    pub session_id: String,
    pub job_id: String,
    pub status: String,
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

/// What the dispatcher saw when it handed a label to the printer.
#[derive(Debug, Deserialize, Serialize)]
pub struct PrintOutcomeRecord {
    pub epc: String,
    /// `None` is success. A message here marks the label failed and keeps it
    /// reprintable on its own.
    #[serde(default)]
    pub error: Option<String>,
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
            "SELECT e.epc, l.sku_code, l.base_price_minor
               FROM tagging_job_epc e
               JOIN tagging_job_line l
                 ON l.job_id = e.job_id AND l.sku_code = e.sku_code
              WHERE e.job_id = ?1
              ORDER BY l.sku_code, e.epc",
        )
        .map_err(db)?;
    let queued: Vec<(String, String, i64)> = select
        .query_map(params![&request.job_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
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
                     (epc,session_id,seq,sku_code,article_name,barcode_payload,price_minor)
                 VALUES(?1,?2,?3,?4,?5,?6,?7)",
            )
            .map_err(db)?;
        for (index, (epc, sku_code, price_minor)) in queued.iter().enumerate() {
            let seq = i64::try_from(index + 1).unwrap_or(i64::MAX);
            insert
                .execute(params![
                    epc,
                    session_id,
                    seq,
                    sku_code,
                    article_name,
                    sku_code,
                    price_minor,
                ])
                .map_err(db)?;
        }
    }

    transaction.commit().map_err(db)?;
    summarise(connection, &session_id)
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
            "SELECT epc,seq,sku_code,article_name,barcode_payload,price_minor,attempts
               FROM print_item
              WHERE session_id = ?1 AND status IN ('PENDING','FAILED')
              ORDER BY seq
              LIMIT ?2",
        )
        .map_err(db)?;
    let rows: Vec<(String, i64, String, String, String, i64, i64)> = select
        .query_map(params![session_id, chunk_size], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(select);

    let size = LabelSize {
        width_mm: width_mm as f64,
        height_mm: height_mm as f64,
    };
    let now = now_text();
    let mut claimed = Vec::with_capacity(rows.len());

    for (epc, seq, sku_code, article_name, barcode_payload, price_minor, attempts) in rows {
        // The attempt is counted here, where the label leaves for the printer.
        // Counting it on the way back would lose every label the dispatcher
        // never got an answer about, which is exactly the interesting case.
        transaction
            .execute(
                "UPDATE print_item
                    SET status='CLAIMED', attempts = attempts + 1, claimed_at = ?2
                  WHERE epc = ?1",
                params![epc, now],
            )
            .map_err(db)?;

        let zpl = render_label(
            &LabelData {
                sku_code: &sku_code,
                article_name: &article_name,
                barcode_payload: &barcode_payload,
                price_minor,
                epc: &epc,
                copies: 1,
            },
            size,
            LabelBrand(LABEL_BRAND),
        );

        claimed.push(ClaimedLabel {
            epc,
            seq,
            sku_code,
            attempts: attempts + 1,
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

    // Counters and status are recomputed from the items, so they cannot drift
    // away from what the queue actually holds.
    transaction
        .execute(
            "UPDATE print_session SET
                 printed_count = (SELECT COUNT(*) FROM print_item
                                   WHERE session_id = ?1 AND status='PRINTED'),
                 failed_count  = (SELECT COUNT(*) FROM print_item
                                   WHERE session_id = ?1 AND status='FAILED'),
                 updated_at = ?2
               WHERE session_id = ?1",
            params![session_id, now],
        )
        .map_err(db)?;

    transaction
        .execute(
            "UPDATE print_session SET
                 status = CASE
                     WHEN printed_count = total_items THEN 'COMPLETED'
                     WHEN printed_count + failed_count = total_items THEN 'PARTIAL'
                     ELSE 'PRINTING'
                 END,
                 closed_at = CASE
                     WHEN printed_count + failed_count = total_items THEN ?2
                     ELSE NULL
                 END
               WHERE session_id = ?1 AND status <> 'CANCELLED'",
            params![session_id, now],
        )
        .map_err(db)?;

    transaction.commit().map_err(db)?;
    summarise(connection, session_id)
}

pub fn summarise(
    connection: &Connection,
    session_id: &str,
) -> Result<PrintSessionSummary, EdgeError> {
    connection
        .query_row(
            "SELECT s.session_id,s.job_id,s.status,s.total_items,s.printed_count,s.failed_count,
                    (SELECT COUNT(*) FROM print_item
                      WHERE session_id = s.session_id AND status IN ('PENDING','CLAIMED','FAILED'))
               FROM print_session s WHERE s.session_id = ?1",
            params![session_id],
            |row| {
                Ok(PrintSessionSummary {
                    session_id: row.get(0)?,
                    job_id: row.get(1)?,
                    status: row.get(2)?,
                    total_items: row.get(3)?,
                    printed_count: row.get(4)?,
                    failed_count: row.get(5)?,
                    pending_count: row.get(6)?,
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

    /// A tagging job for one SKU with `count` EPCs, exactly as the cloud sends
    /// it down: ranges expanded to one row per label.
    fn job_with(count: usize) -> Connection {
        let connection = match Connection::open_in_memory() {
            Ok(connection) => connection,
            Err(error) => panic!("open: {error}"),
        };
        for schema in [TAGGING_SCHEMA, PRINTING_SCHEMA] {
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
        assert!(label.zpl.contains("^FDWira Makmur^FS"), "{}", label.zpl);
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
}
