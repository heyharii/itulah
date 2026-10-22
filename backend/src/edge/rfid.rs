//! Local, offline-capable RFID evidence ingestion.
//!
//! A reader proves possession of its one-time enrolment key by signing the
//! exact request body plus a timestamp and monotonic sequence. The Edge
//! authenticates and scopes the device locally, stores the evidence, and
//! appends the same batch to its durable ordered sync log in one transaction.

use crate::clock::ClockHandle;
use crate::{
    edge::{consolidate_reads, EdgeError, NodeContext, OperationalPool, RfidRead},
    security,
    sync::{
        RfidObservationBatchPayload, RfidObservationSighting, INVENTORY_RFID_OBSERVATION_BATCH_V1,
        RFID_OBSERVATION_SCHEMA_VERSION,
    },
};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    str::FromStr,
    sync::{Arc, Mutex, MutexGuard},
};
use uuid::Uuid;

pub const RFID_OBSERVATION_PATH: &str = "/api/v1/rfid/observations";
/// A reader saying it is alive, with or without anything to file (sqlite
/// 0064). Signed exactly as a batch is, over this path.
pub const RFID_PING_PATH: &str = "/api/v1/rfid/ping";

/// What a handheld or reader may say about itself — in a ping's body, or as
/// the `device` object of a batch. Every field is optional: an older app
/// sends none and loses nothing.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RfidDeviceReport {
    #[serde(default)]
    pub battery_percent: Option<u8>,
    #[serde(default)]
    pub app_version: Option<String>,
    /// When the operator last pulled the trigger, on the device's clock.
    #[serde(default)]
    pub last_scan_at: Option<DateTime<Utc>>,
}
pub const RFID_SIGNATURE_MAX_SKEW_SECONDS: u64 = 300;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EdgeRfidObservationRequest {
    pub site_id: String,
    pub pool: String,
    pub reader_session_id: String,
    pub observed_at: DateTime<Utc>,
    pub idempotency_key: String,
    pub observations: Vec<RfidRead>,
}

#[derive(Clone, Debug)]
pub struct DeviceProof {
    pub device_id: String,
    pub timestamp: i64,
    pub sequence: i64,
    pub signature: String,
}

#[derive(Clone)]
pub struct EdgeRfid {
    connection: Arc<Mutex<Connection>>,
    /// A READ-ONLY handle on the same file, as `SqliteEdge` keeps one for
    /// the till's reads (POS-PERFORMANCE-PLAN Phase 1).
    ///
    /// Every handheld in a shared session asks what it has found every two
    /// seconds, and each ask is four queries. On the writer mutex those
    /// queued behind a sale and a sale queued behind them; WAL lets them
    /// read the last committed state beside the writer instead. `None` for
    /// an in-memory node, whose second handle could not see the writer's
    /// schema — those read on the writer, as they always did.
    reader: Option<Arc<Mutex<Connection>>>,
    node: NodeContext,
    /// The business clock the RFID windows evaluate against. Plan §7.4: an
    /// external reader under a compressed year signs with virtual time, so
    /// the skew and future checks must answer from the same clock — while
    /// the device's offline lease stays on the wall (security time).
    clock: Arc<ClockHandle>,
}

impl EdgeRfid {
    pub fn new(
        connection: Arc<Mutex<Connection>>,
        node: NodeContext,
        clock: Arc<ClockHandle>,
    ) -> Self {
        let reader = open_reader(&connection);
        Self {
            connection,
            reader,
            node,
            clock,
        }
    }

    pub fn node(&self) -> &NodeContext {
        &self.node
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, EdgeError> {
        self.connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge RFID connection is poisoned".into()))
    }

    /// The connection a READ should use: the read-only companion when there
    /// is one, the writer otherwise.
    fn read_lock(&self) -> Result<MutexGuard<'_, Connection>, EdgeError> {
        match &self.reader {
            Some(reader) => reader
                .lock()
                .map_err(|_| EdgeError::Persistence("edge RFID reader is poisoned".into())),
            None => self.lock(),
        }
    }

    /// Sessions with recent activity, newest first.
    ///
    /// A session is not created by anyone; it begins existing the moment a
    /// reader files under its name. So this is a list of what is being worked
    /// on right now, not a registry — which is exactly what someone arriving to
    /// help needs to see before choosing whether to join at all.
    pub fn recent_sessions(&self, limit: i64) -> Result<Vec<RfidSessionBrief>, EdgeError> {
        let limit = limit.clamp(1, 100);
        let connection = self.read_lock()?;
        let mut statement = connection
            .prepare(
                "SELECT reader_session_id,
                        COUNT(DISTINCT epc),
                        COUNT(DISTINCT device_id),
                        MAX(last_seen_at) AS last_seen
                 FROM edge_observation_sighting
                 GROUP BY reader_session_id
                 ORDER BY last_seen DESC
                 LIMIT ?1",
            )
            .map_err(db)?;
        let rows = statement
            .query_map(params![limit], |row| {
                Ok(RfidSessionBrief {
                    reader_session_id: row.get(0)?,
                    tag_count: row.get(1)?,
                    device_count: row.get(2)?,
                    last_seen_at: row.get(3)?,
                })
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)
    }

    /// Read back one shared session. See [`RfidSessionSummary`].
    pub fn session(&self, reader_session_id: &str) -> Result<RfidSessionSummary, EdgeError> {
        let id = reader_session_id.trim();
        if id.is_empty() || id.len() > 128 {
            return Err(EdgeError::Validation(
                "reader_session_id must be 1-128 characters".into(),
            ));
        }
        const MAX_EPCS: usize = 2000;
        let mut reader = self.read_lock()?;
        // One snapshot for the four reads below, as the writer lock used to
        // give them: a batch landing between two of them must not leave the
        // count saying one number and the list of tags another. Read-only;
        // dropping it ends it.
        let connection = reader.transaction().map_err(db)?;

        let (tag_count, sighting_count, first, last): (i64, i64, Option<String>, Option<String>) =
            connection
                .prepare_cached(
                    "SELECT COUNT(DISTINCT epc), COUNT(*), MIN(first_seen_at), MAX(last_seen_at)
                     FROM edge_observation_sighting WHERE reader_session_id=?1",
                )
                .map_err(db)?
                .query_row(params![id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(db)?;

        let mut device_statement = connection
            .prepare(
                "SELECT device_id, COUNT(DISTINCT epc), MAX(last_seen_at)
                 FROM edge_observation_sighting WHERE reader_session_id=?1
                 GROUP BY device_id ORDER BY device_id",
            )
            .map_err(db)?;
        let devices = device_statement
            .query_map(params![id], |row| {
                Ok(RfidSessionDevice {
                    device_id: row.get(0)?,
                    tag_count: row.get(1)?,
                    last_seen_at: row.get(2)?,
                })
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        drop(device_statement);

        let mut pool_statement = connection
            .prepare(
                "SELECT DISTINCT pool_id FROM edge_observation_sighting
                 WHERE reader_session_id=?1 ORDER BY pool_id",
            )
            .map_err(db)?;
        let pools = pool_statement
            .query_map(params![id], |row| row.get::<_, String>(0))
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        drop(pool_statement);

        let mut epc_statement = connection
            .prepare(
                "SELECT DISTINCT epc FROM edge_observation_sighting
                 WHERE reader_session_id=?1 ORDER BY epc LIMIT ?2",
            )
            .map_err(db)?;
        let epcs = epc_statement
            .query_map(params![id, (MAX_EPCS + 1) as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        drop(epc_statement);
        let truncated = epcs.len() > MAX_EPCS;

        let site_id = self.node.site_id.to_string();
        Ok(RfidSessionSummary {
            reader_session_id: id.to_string(),
            site_id,
            tag_count,
            sighting_count,
            devices,
            pools,
            first_seen_at: first,
            last_seen_at: last,
            epcs: epcs.into_iter().take(MAX_EPCS).collect(),
            truncated,
        })
    }

    pub fn ingest(
        &self,
        proof: DeviceProof,
        raw_body: &[u8],
        operator_id: Option<String>,
    ) -> Result<Value, EdgeError> {
        let device_id = normalize_device_id(&proof.device_id)?;
        if proof.sequence < 1 {
            return Err(EdgeError::Unauthorized(
                "RFID device sequence must be positive".into(),
            ));
        }
        if proof.signature.len() != 64
            || !proof
                .signature
                .chars()
                .all(|value| value.is_ascii_hexdigit())
        {
            return Err(EdgeError::Unauthorized(
                "invalid RFID device signature".into(),
            ));
        }
        let request_digest = security::sha256_hex(raw_body);
        // Two instants, on purpose. The device's offline lease is security
        // time and stays on the wall clock (plan §1.1); everything that
        // reasons about readings — the skew window, the future check, the
        // receipt stamps — evaluates against the business clock, because a
        // reader under a compressed year signs with virtual time (§7.4).
        let now = Utc::now();
        let business_now = self.clock.now();

        // Who is asking, before a byte of what they sent is read. The
        // signature covers the body's digest, so it is checked without
        // parsing the body — and on the read-only companion, so a request
        // nobody signed never queues on the writer a sale is waiting for,
        // and never has its body parsed at all. It is checked again below,
        // in the transaction that claims the sequence, where a key rotated
        // or a reader disabled in the meantime is answered.
        {
            let reader = self.read_lock()?;
            authenticate_device(
                &reader,
                RFID_OBSERVATION_PATH,
                &device_id,
                &proof,
                &request_digest,
                now,
            )?;
        }

        // Then the body — parsed, checked, and the whole batch built — with
        // no lock held at all: parsing two thousand reads is the slowest
        // thing a batch does, and it used to happen holding the writer.
        // Everything the finalize below files is decided here, every check
        // the payload has to pass included, so a batch that could never be
        // filed is refused before its sequence is claimed or a sighting
        // lands, and leaves nothing behind.
        let request: EdgeRfidObservationRequest = serde_json::from_slice(raw_body)
            .map_err(|error| EdgeError::Validation(format!("invalid RFID JSON: {error}")))?;
        // Raised only after the replay check below: a retry of a batch this
        // node already accepted gets the answer it was given, even where a
        // check added since would refuse the same bytes today.
        let prepared = prepare_batch(
            &self.node,
            &request,
            &device_id,
            proof.sequence,
            operator_id,
            business_now,
            raw_body,
        );

        // The batch lands in bounded chunks (POS-PERFORMANCE-PLAN Phase 3),
        // each in a transaction of its own, and the node's write lock is let
        // go between them: the claim, every chunk and the finalize each take
        // it and give it back, so a sale waits for one chunk of sightings at
        // most, never for the whole sweep. What keeps that honest:
        //
        // - the SEQUENCE is claimed in the first transaction, so two
        //   different batches from one device can never both enqueue;
        // - each chunk writes a receipt row (key, index, digest), so a retry
        //   after a crash mid-batch skips the chunks that already landed
        //   instead of double-writing them;
        // - the batch receipt and the sync fact are still written ONCE, in a
        //   final transaction, and still answer idempotent replays exactly as
        //   before. That transaction also takes the chunk rows away, and
        //   every chunk first asks whether the batch is already filed — so an
        //   identical retry running beside this one can never land a chunk
        //   twice: whichever finishes second stops writing and answers with
        //   the first one's receipt. Sightings are evidence, never ledger
        //   quantities, so a chunk boundary between them breaks no invariant.
        const CHUNK: usize = 250;

        let prepared = {
            let mut connection = self.lock()?;
            let tx = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(db)?;
            let last_sequence = authenticate_device(
                &tx,
                RFID_OBSERVATION_PATH,
                &device_id,
                &proof,
                &request_digest,
                now,
            )?;

            let prior: Option<(String, String, String)> = tx
                .prepare_cached(
                    "SELECT device_id,request_digest,response_json
                     FROM edge_rfid_batch_receipt WHERE idempotency_key=?1",
                )
                .map_err(db)?
                .query_row(params![request.idempotency_key], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .optional()
                .map_err(db)?;
            if let Some((prior_device, prior_digest, response_json)) = prior {
                if prior_device != device_id || prior_digest != request_digest {
                    return Err(EdgeError::Conflict(
                        "idempotency key was already used for another RFID request".into(),
                    ));
                }
                // The same reader, filing the same bytes, gets the answer it
                // was already given. The sequence it signed with is
                // deliberately NOT part of that test.
                //
                // A device signs every attempt with a fresh timestamp and a
                // fresh sequence because the signature's own skew window is
                // 300 seconds either side of now: a batch that sat in an
                // outbox through an offline spell CANNOT be replayed with the
                // proof it was first signed with, because that proof is no
                // longer valid. So a handheld retrying after a lost response
                // necessarily presents a new sequence — which means comparing
                // sequences here refused the one case idempotency exists to
                // serve, and the counter that lost an answer over shop wifi
                // could never get it back.
                //
                // Anti-replay of genuinely new work is not weakened by this:
                // the claim below refuses a reused sequence for any batch that
                // is not this one. What establishes "this is the same batch
                // from the same reader" is the device and the digest over the
                // body, and those two are what is compared — the digest guard
                // lives in the receipt lookup's caller, which checked it
                // before returning.
                let response = serde_json::from_str(&response_json).map_err(|error| {
                    EdgeError::Persistence(format!("stored RFID response is invalid: {error}"))
                })?;
                tx.commit().map_err(db)?;
                return Ok(response);
            }
            let prepared = prepared?;

            let clock_delta = business_now.timestamp().abs_diff(proof.timestamp);
            if clock_delta > RFID_SIGNATURE_MAX_SKEW_SECONDS {
                return Err(EdgeError::Unauthorized(format!(
                    "RFID request timestamp is outside the {RFID_SIGNATURE_MAX_SKEW_SECONDS}-second window"
                )));
            }
            let allowed: bool = tx
                .prepare_cached(
                    "SELECT EXISTS(SELECT 1 FROM edge_rfid_device_pool
                                   WHERE device_id=?1 AND pool_id=?2)",
                )
                .map_err(db)?
                .query_row(params![device_id, request.pool], |row| row.get(0))
                .map_err(db)?;
            if !allowed {
                return Err(EdgeError::Forbidden(format!(
                    "RFID device is not assigned to pool {}",
                    request.pool
                )));
            }
            // Claim this batch's sequence now, not at the end: a second batch
            // from the same device that arrives while our chunks land is
            // refused here rather than double-enqueued. A retry of THIS batch
            // carries a fresh sequence by the protocol above, so the claim
            // costs it nothing.
            let claimed = tx
                .prepare_cached(
                    "UPDATE edge_rfid_device
                     SET last_sequence=?2 WHERE device_id=?1 AND last_sequence<?2",
                )
                .map_err(db)?
                .execute(params![device_id, proof.sequence])
                .map_err(db)?;
            if claimed == 0 {
                return Err(EdgeError::Conflict(format!(
                    "RFID device sequence replayed; last accepted sequence is {last_sequence}"
                )));
            }
            tx.commit().map_err(db)?;
            prepared
        };
        let payload = &prepared.payload;

        for (index, chunk) in payload.sightings.chunks(CHUNK).enumerate() {
            let index = i64::try_from(index).unwrap_or(i64::MAX);
            let mut connection = self.lock()?;
            let tx = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(db)?;
            // Filed already, while this run waited for the lock. Its finalize
            // took the chunk rows with it, so a chunk landed from here would
            // be landed twice: write nothing more, and let the finalize
            // answer — with that receipt when it is this batch's, as a
            // conflict when it is not.
            let filed: bool = tx
                .prepare_cached(
                    "SELECT EXISTS(SELECT 1 FROM edge_rfid_batch_receipt
                                   WHERE idempotency_key=?1)",
                )
                .map_err(db)?
                .query_row(params![payload.idempotency_key], |row| row.get(0))
                .map_err(db)?;
            if filed {
                break;
            }
            let landed: i64 = tx
                .prepare_cached(
                    "SELECT COUNT(*) FROM edge_rfid_batch_chunk
                     WHERE idempotency_key=?1 AND chunk_index=?2 AND request_digest=?3",
                )
                .map_err(db)?
                .query_row(
                    params![payload.idempotency_key, index, request_digest],
                    |row| row.get(0),
                )
                .map_err(db)?;
            if landed == 0 {
                for sighting in chunk {
                    let observation_id = Uuid::new_v4();
                    tx.prepare_cached(
                        "INSERT INTO edge_observation_sighting
                         (observation_id,epc,site_id,pool_id,first_seen_at,last_seen_at,
                          received_at,device_id,reader_session_id,operator_id,read_count,
                          best_rssi,antenna)
                     VALUES(?1,?2,?3,?4,?5,?5,?6,?7,?8,?9,?10,?11,?12)",
                    )
                    .map_err(db)?
                    .execute(params![
                        observation_id.to_string(),
                        sighting.epc,
                        payload.site_id,
                        payload.pool_id,
                        time_text(payload.observed_at),
                        time_text(payload.received_at),
                        payload.device_id,
                        payload.reader_session_id,
                        payload.operator_id,
                        sighting.read_count,
                        sighting.best_rssi,
                        sighting.antenna.clone(),
                    ])
                    .map_err(db)?;
                }
                tx.prepare_cached(
                    "INSERT INTO edge_rfid_batch_chunk
                         (idempotency_key,chunk_index,sighting_count,request_digest,created_at)
                     VALUES(?1,?2,?3,?4,?5)",
                )
                .map_err(db)?
                .execute(params![
                    payload.idempotency_key,
                    index,
                    i64::try_from(chunk.len()).unwrap_or(i64::MAX),
                    request_digest,
                    time_text(business_now),
                ])
                .map_err(db)?;
            }
            tx.commit().map_err(db)?;
        }

        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        // A racing identical retry may have finished its own finalize while
        // this batch was chunking; it wins, this one becomes a replay. Only
        // an identical one: a different body under the same key, filed while
        // this run waited for the lock, is the conflict the claim refuses —
        // and this run, which stopped at the first chunk that saw its
        // receipt, has nothing of its own to file.
        let raced: Option<(String, String, String)> = tx
            .prepare_cached(
                "SELECT device_id,request_digest,response_json
                 FROM edge_rfid_batch_receipt WHERE idempotency_key=?1",
            )
            .map_err(db)?
            .query_row(params![payload.idempotency_key], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .optional()
            .map_err(db)?;
        let response = if let Some((raced_device, raced_digest, response_json)) = raced {
            if raced_device != device_id || raced_digest != request_digest {
                return Err(EdgeError::Conflict(
                    "idempotency key was already used for another RFID request".into(),
                ));
            }
            serde_json::from_str(&response_json).map_err(|error| {
                EdgeError::Persistence(format!("stored RFID response is invalid: {error}"))
            })?
        } else {
            let sync_sequence = crate::edge::sync::enqueue_fact(
                &tx,
                payload.batch_id,
                INVENTORY_RFID_OBSERVATION_BATCH_V1,
                payload,
            )
            .map_err(db)?;
            let response = json!({
                "batch_id":payload.batch_id,
                "idempotency_key":payload.idempotency_key,
                "device_id":payload.device_id,
                "device_sequence":payload.device_sequence,
                "raw_read_count":prepared.raw_read_count,
                "consolidated_sighting_count":payload.sightings.len(),
                "observation_ids":payload.sightings.iter()
                    .map(|sighting| sighting.observation_id).collect::<Vec<_>>(),
                "observed_at":payload.observed_at,
                "received_at":payload.received_at,
                "sync":{"queued":sync_sequence.is_some(),"sequence":sync_sequence},
                "inventory_effect":{"movement_count":0,"missing_created":0},
            });
            tx.prepare_cached(
                "INSERT INTO edge_rfid_batch_receipt
                     (idempotency_key,device_id,sequence,request_digest,response_json,created_at)
                 VALUES(?1,?2,?3,?4,?5,?6)",
            )
            .map_err(db)?
            .execute(params![
                payload.idempotency_key,
                device_id,
                proof.sequence,
                request_digest,
                serde_json::to_string(&response).map_err(|error| {
                    EdgeError::Persistence(format!("serialize RFID response: {error}"))
                })?,
                time_text(business_now),
            ])
            .map_err(map_receipt_error)?;
            response
        };
        // Filed — by this run, or by an identical one that finished first —
        // and from here its receipt answers every replay (a key rotation no
        // longer takes it away, sqlite 0082). The chunk rows only ever served
        // a run that died part-way and came back to finish; nothing is left
        // to finish, and kept they would outlive every batch the node took.
        tx.prepare_cached("DELETE FROM edge_rfid_batch_chunk WHERE idempotency_key=?1")
            .map_err(db)?
            .execute(params![payload.idempotency_key])
            .map_err(db)?;
        tx.prepare_cached(
            "UPDATE edge_rfid_device
                 SET last_request_digest=?3,last_seen_at=?4
                 WHERE device_id=?1",
        )
        .map_err(db)?
        .execute(params![
            device_id,
            proof.sequence,
            request_digest,
            time_text(business_now)
        ])
        .map_err(db)?;
        record_device_health(&tx, &device_id, business_now, prepared.report.as_ref())?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    /// A reader saying it is alive (`POST /api/v1/rfid/ping`). Proven exactly
    /// as a batch is — its key, a fresh sequence, a timestamp inside the
    /// window — so a ping cannot be forged or replayed, and it moves nothing:
    /// it is how a reader that is on and reading nothing is told apart from
    /// one that is off.
    pub fn ping(&self, proof: DeviceProof, raw_body: &[u8]) -> Result<Value, EdgeError> {
        let device_id = normalize_device_id(&proof.device_id)?;
        if proof.sequence < 1 {
            return Err(EdgeError::Unauthorized(
                "RFID device sequence must be positive".into(),
            ));
        }
        if proof.signature.len() != 64
            || !proof
                .signature
                .chars()
                .all(|value| value.is_ascii_hexdigit())
        {
            return Err(EdgeError::Unauthorized(
                "invalid RFID device signature".into(),
            ));
        }
        let request_digest = security::sha256_hex(raw_body);
        let now = Utc::now();
        let business_now = self.clock.now();
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let device: Option<(String, i64, String, i64)> = tx
            .prepare_cached(
                "SELECT auth_key_sha256,active,valid_until,last_sequence
                 FROM edge_rfid_device WHERE device_id=?1",
            )
            .map_err(db)?
            .query_row(params![device_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .optional()
            .map_err(db)?;
        let Some((signing_key, active, valid_until, last_sequence)) = device else {
            return Err(EdgeError::Unauthorized("unknown RFID device".into()));
        };
        if active != 1 {
            return Err(EdgeError::Unauthorized("RFID device is disabled".into()));
        }
        if parse_time(&valid_until)? <= now {
            return Err(EdgeError::Unauthorized(
                "RFID device offline lease has expired; reconnect this Edge to Cloud".into(),
            ));
        }
        let expected = sign_rfid_request_at(
            RFID_PING_PATH,
            &signing_key,
            &device_id,
            proof.timestamp,
            proof.sequence,
            &request_digest,
        );
        if !security::constant_time_eq(&proof.signature.to_ascii_lowercase(), &expected) {
            return Err(EdgeError::Unauthorized(
                "invalid RFID device signature".into(),
            ));
        }
        if business_now.timestamp().abs_diff(proof.timestamp) > RFID_SIGNATURE_MAX_SKEW_SECONDS {
            return Err(EdgeError::Unauthorized(format!(
                "RFID request timestamp is outside the {RFID_SIGNATURE_MAX_SKEW_SECONDS}-second window"
            )));
        }
        if proof.sequence <= last_sequence {
            return Err(EdgeError::Conflict(format!(
                "RFID device sequence replayed; last accepted sequence is {last_sequence}"
            )));
        }
        let report = if raw_body.iter().all(u8::is_ascii_whitespace) {
            RfidDeviceReport::default()
        } else {
            serde_json::from_slice::<RfidDeviceReport>(raw_body)
                .map_err(|error| EdgeError::Validation(format!("invalid RFID ping: {error}")))?
        };
        if report
            .app_version
            .as_deref()
            .is_some_and(|version| version.len() > 64)
        {
            return Err(EdgeError::Validation(
                "an app version is at most 64 characters".into(),
            ));
        }
        if report.battery_percent.is_some_and(|battery| battery > 100) {
            return Err(EdgeError::Validation(
                "battery is a percentage, 0 to 100".into(),
            ));
        }
        tx.prepare_cached(
            "UPDATE edge_rfid_device
             SET last_sequence=?2,last_request_digest=?3,last_seen_at=?4
             WHERE device_id=?1",
        )
        .map_err(db)?
        .execute(params![
            device_id,
            proof.sequence,
            request_digest,
            time_text(business_now)
        ])
        .map_err(db)?;
        record_device_health(&tx, &device_id, business_now, Some(&report))?;
        tx.commit().map_err(db)?;
        Ok(json!({ "device_id": device_id, "received_at": business_now }))
    }
}

/// Write down that a reader proved itself now, with whatever it said about
/// itself. A field it did not send keeps what it said before.
fn record_device_health(
    tx: &rusqlite::Transaction<'_>,
    device_id: &str,
    at: DateTime<Utc>,
    report: Option<&RfidDeviceReport>,
) -> Result<(), EdgeError> {
    let report = report.cloned().unwrap_or_default();
    let battery = report
        .battery_percent
        .filter(|battery| *battery <= 100)
        .map(i64::from);
    let app_version = report
        .app_version
        .filter(|version| version.len() <= 64 && !version.trim().is_empty());
    tx.prepare_cached("INSERT INTO edge_rfid_device_health
             (device_id, pinged_at, battery_percent, app_version, last_scan_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?2)
         ON CONFLICT (device_id) DO UPDATE SET
             pinged_at = excluded.pinged_at,
             battery_percent = COALESCE(excluded.battery_percent, edge_rfid_device_health.battery_percent),
             app_version = COALESCE(excluded.app_version, edge_rfid_device_health.app_version),
             last_scan_at = COALESCE(excluded.last_scan_at, edge_rfid_device_health.last_scan_at),
             updated_at = excluded.updated_at"
    ).map_err(db)?.execute(
        params![
            device_id,
            time_text(at),
            battery,
            app_version,
            report.last_scan_at.map(time_text),
        ],
    )
    .map_err(db)?;
    Ok(())
}

pub fn derive_rfid_signing_key(device_key: &str) -> String {
    security::sha256_hex(device_key.trim())
}

/// What one shared reading session has found, across every handheld in it.
///
/// # Why a session is just a name
///
/// Two people counting one rack is the ordinary case, not the exotic one: a
/// mezzanine takes an hour alone and twenty minutes with three readers. They do
/// not need a coordinator, a lock, or a leader — they need to agree on a NAME,
/// and the evidence log does the rest. Each device signs its own batches under
/// its own key and files them against the shared `reader_session_id`; the union
/// is a query, not a merge.
///
/// Deduplication is by EPC and it must be: two readers sweeping the same shelf
/// see the same garment, and that is one unit, not two. Counting sightings
/// instead of tags would inflate every shared count by exactly the amount of
/// help that was offered.
#[derive(Clone, Debug, Serialize)]
pub struct RfidSessionSummary {
    pub reader_session_id: String,
    pub site_id: String,
    /// Distinct tags — the honest count of things present.
    pub tag_count: i64,
    /// Every sighting filed, including the same tag seen by several readers.
    pub sighting_count: i64,
    pub devices: Vec<RfidSessionDevice>,
    pub pools: Vec<String>,
    pub first_seen_at: Option<String>,
    pub last_seen_at: Option<String>,
    /// The tags themselves, so a handheld can show the combined sweep. Capped;
    /// `truncated` says when the caller is looking at part of it.
    pub epcs: Vec<String>,
    pub truncated: bool,
}

/// One session in the list, thin enough to render a page of them.
#[derive(Clone, Debug, Serialize)]
pub struct RfidSessionBrief {
    pub reader_session_id: String,
    pub tag_count: i64,
    pub device_count: i64,
    pub last_seen_at: Option<String>,
}

/// One reader's contribution, so the floor can see who has covered what.
#[derive(Clone, Debug, Serialize)]
pub struct RfidSessionDevice {
    pub device_id: String,
    pub tag_count: i64,
    pub last_seen_at: Option<String>,
}

pub fn sign_rfid_request(
    signing_key_sha256: &str,
    device_id: &str,
    timestamp: i64,
    sequence: i64,
    body_sha256: &str,
) -> String {
    sign_rfid_request_at(
        RFID_OBSERVATION_PATH,
        signing_key_sha256,
        device_id,
        timestamp,
        sequence,
        body_sha256,
    )
}

/// The same signature over another RFID path (the ping): the path is part of
/// the canonical, so a ping's proof never files a batch.
pub fn sign_rfid_request_at(
    path: &str,
    signing_key_sha256: &str,
    device_id: &str,
    timestamp: i64,
    sequence: i64,
    body_sha256: &str,
) -> String {
    let canonical = format!("POST\n{path}\n{device_id}\n{timestamp}\n{sequence}\n{body_sha256}");
    security::hmac_sha256_hex(signing_key_sha256.as_bytes(), canonical.as_bytes())
}

/// Prove the caller is the reader it names: a device this node knows, still
/// enabled, its offline lease still running, its signature over exactly these
/// bytes on this path made with its current key. Answers the last sequence
/// the device was accepted at.
///
/// Reads one row and computes one HMAC. Run once on the read-only companion
/// before a body is parsed, and again inside the transaction that claims the
/// sequence, which is the one that counts.
fn authenticate_device(
    connection: &Connection,
    path: &str,
    device_id: &str,
    proof: &DeviceProof,
    request_digest: &str,
    now: DateTime<Utc>,
) -> Result<i64, EdgeError> {
    let device: Option<(String, i64, String, i64)> = connection
        .prepare_cached(
            "SELECT auth_key_sha256,active,valid_until,last_sequence
             FROM edge_rfid_device WHERE device_id=?1",
        )
        .map_err(db)?
        .query_row(params![device_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .optional()
        .map_err(db)?;
    let Some((signing_key, active, valid_until, last_sequence)) = device else {
        return Err(EdgeError::Unauthorized("unknown RFID device".into()));
    };
    if active != 1 {
        return Err(EdgeError::Unauthorized("RFID device is disabled".into()));
    }
    if parse_time(&valid_until)? <= now {
        return Err(EdgeError::Unauthorized(
            "RFID device offline lease has expired; reconnect this Edge to Cloud".into(),
        ));
    }
    let expected_signature = sign_rfid_request_at(
        path,
        &signing_key,
        device_id,
        proof.timestamp,
        proof.sequence,
        request_digest,
    );
    if !security::constant_time_eq(&proof.signature.to_ascii_lowercase(), &expected_signature) {
        return Err(EdgeError::Unauthorized(
            "invalid RFID device signature".into(),
        ));
    }
    Ok(last_sequence)
}

/// One batch, checked and built whole before any of it is written.
struct PreparedBatch {
    /// Exactly what the finalize files: the sync fact's payload, its batch id
    /// and every observation id already chosen.
    payload: RfidObservationBatchPayload,
    /// Every read the reader reported, before consolidation.
    raw_read_count: i64,
    /// What the handheld said about itself, if it said anything readable.
    report: Option<RfidDeviceReport>,
}

fn prepare_batch(
    node: &NodeContext,
    request: &EdgeRfidObservationRequest,
    device_id: &str,
    device_sequence: i64,
    operator_id: Option<String>,
    received_at: DateTime<Utc>,
    raw_body: &[u8],
) -> Result<PreparedBatch, EdgeError> {
    validate_request(node, request, received_at)?;
    let consolidated = consolidate_reads(&request.observations);
    if consolidated.is_empty() {
        return Err(EdgeError::Validation(
            "RFID batch contains no valid EPC".into(),
        ));
    }
    if consolidated.len() > crate::sync::MAX_RFID_SIGHTINGS_PER_BATCH {
        return Err(EdgeError::Validation(format!(
            "RFID batch exceeds {} consolidated EPCs",
            crate::sync::MAX_RFID_SIGHTINGS_PER_BATCH
        )));
    }
    let payload = RfidObservationBatchPayload {
        schema_version: RFID_OBSERVATION_SCHEMA_VERSION,
        batch_id: Uuid::new_v4(),
        idempotency_key: request.idempotency_key.clone(),
        site_id: request.site_id.clone(),
        pool_id: request.pool.clone(),
        device_id: device_id.to_string(),
        operator_id,
        reader_session_id: request.reader_session_id.clone(),
        observed_at: request.observed_at,
        received_at,
        device_sequence,
        sightings: consolidated
            .into_iter()
            .map(|read| RfidObservationSighting {
                observation_id: Uuid::new_v4(),
                epc: read.epc,
                read_count: read.read_count,
                best_rssi: read.best_rssi,
                antenna: read.antenna,
            })
            .collect(),
    };
    // Every check the fact must pass, made before anything is claimed or
    // written: a finite RSSI here used to be found only at the finalize,
    // after the sequence was spent and every chunk had landed. And every
    // observed EPC as a tag can hold it — hex, an even number of digits, no
    // longer than Gen2 allows — because one EPC of a megabyte made a fact no
    // upload could carry, and stopped this node's whole stream behind it.
    payload
        .validate()
        .map_err(|error| EdgeError::Validation(error.to_string()))?;
    payload
        .validate_reads()
        .map_err(|error| EdgeError::Validation(error.to_string()))?;
    let raw_read_count = request
        .observations
        .iter()
        .map(|read| i64::from(read.read_count.max(1)))
        .sum::<i64>();
    // A batch is proof of life too, and may carry what the handheld knows
    // about itself. A malformed `device` block is ignored rather than
    // refusing the reads it came with.
    let report = serde_json::from_slice::<Value>(raw_body)
        .ok()
        .and_then(|body| body.get("device").cloned())
        .and_then(|device| serde_json::from_value::<RfidDeviceReport>(device).ok());
    Ok(PreparedBatch {
        payload,
        raw_read_count,
        report,
    })
}

/// A read-only companion on the writer's own file, opened the way
/// `SqliteEdge::open` opens its own. `None` for an in-memory database (the
/// path SQLite reports for one is empty) or a file that refuses a second
/// handle; the session reads then share the writer lock, as they always did,
/// and the second case says so.
fn open_reader(connection: &Arc<Mutex<Connection>>) -> Option<Arc<Mutex<Connection>>> {
    let path: String = match connection.lock() {
        Ok(writer) => writer.path().unwrap_or_default().to_owned(),
        Err(_) => return None,
    };
    if path.is_empty() {
        return None;
    }
    match Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    ) {
        Ok(reader) => {
            let _ = reader.busy_timeout(std::time::Duration::from_millis(5_000));
            Some(Arc::new(Mutex::new(reader)))
        }
        Err(error) => {
            tracing::warn!(
                %error,
                "could not open a read-only SQLite companion for RFID session reads; \
                 they will share the writer lock"
            );
            None
        }
    }
}

fn validate_request(
    node: &NodeContext,
    request: &EdgeRfidObservationRequest,
    now: DateTime<Utc>,
) -> Result<(), EdgeError> {
    if request.site_id != node.site_id.as_str() {
        return Err(EdgeError::Forbidden(format!(
            "RFID request site {} is not owned by this Edge",
            request.site_id
        )));
    }
    let pool = OperationalPool::from_str(&request.pool)
        .map_err(|error| EdgeError::Validation(error.to_string()))?;
    if !node.owns_pool(&pool) {
        return Err(EdgeError::Forbidden(format!(
            "RFID request pool {} is not owned by this Edge",
            request.pool
        )));
    }
    if request.reader_session_id.trim().is_empty() || request.reader_session_id.len() > 128 {
        return Err(EdgeError::Validation(
            "reader_session_id must be 1-128 characters".into(),
        ));
    }
    if request.idempotency_key.trim().is_empty() || request.idempotency_key.len() > 128 {
        return Err(EdgeError::Validation(
            "idempotency_key must be 1-128 characters".into(),
        ));
    }
    if request.observations.is_empty() {
        return Err(EdgeError::Validation(
            "RFID observations batch cannot be empty".into(),
        ));
    }
    if request.observed_at > now + Duration::seconds(RFID_SIGNATURE_MAX_SKEW_SECONDS as i64) {
        return Err(EdgeError::Validation(
            "observed_at is too far in the future".into(),
        ));
    }
    Ok(())
}

fn normalize_device_id(device_id: &str) -> Result<String, EdgeError> {
    let device_id = device_id.trim().to_ascii_uppercase();
    if device_id.len() < 3
        || device_id.len() > 96
        || !device_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.'))
    {
        return Err(EdgeError::Unauthorized("invalid RFID device id".into()));
    }
    Ok(device_id)
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, EdgeError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| EdgeError::Persistence(format!("invalid RFID lease timestamp: {error}")))
}

fn time_text(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

fn map_receipt_error(error: rusqlite::Error) -> EdgeError {
    match &error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            EdgeError::Conflict("RFID sequence or idempotency key was already used".into())
        }
        _ => db(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edge::{EdgeRole, SiteId, SqliteEdge};
    use crate::sync::rfid::MAX_RFID_ANTENNA_LEN;

    /// A tag as a reader reports it: 96 bits, twenty-four hex digits.
    const TAG_ONE: &str = "E28000000000000000000001";

    fn setup() -> (SqliteEdge, EdgeRfid, String) {
        let site = SiteId::new("store-07").unwrap_or_else(|error| panic!("site: {error}"));
        let node = NodeContext::new("store-07-edge", EdgeRole::Store, site)
            .unwrap_or_else(|error| panic!("node: {error}"));
        let edge = SqliteEdge::open_in_memory(node.clone())
            .unwrap_or_else(|error| panic!("edge: {error}"));
        let signing_key = enrol(&edge);
        let service = EdgeRfid::new(edge.connection(), node, edge.clock());
        (edge, service, signing_key)
    }

    /// One reader, RFID-01, on the shop floor.
    fn enrol(edge: &SqliteEdge) -> String {
        let raw_key = "reader-enrolment-key";
        let signing_key = derive_rfid_signing_key(raw_key);
        let shared_connection = edge.connection();
        let connection = shared_connection
            .lock()
            .unwrap_or_else(|error| panic!("connection: {error}"));
        connection
            .prepare_cached(
                "INSERT INTO edge_rfid_device
                     (device_id,label,auth_key_sha256,active,valid_until,last_sequence,
                      policy_version,updated_at)
                 VALUES('RFID-01','Test reader',?1,1,?2,0,1,?3)",
            )
            .unwrap_or_else(|error| panic!("prepare device: {error}"))
            .execute(params![
                signing_key,
                time_text(Utc::now() + Duration::days(1)),
                time_text(Utc::now()),
            ])
            .unwrap_or_else(|error| panic!("device: {error}"));
        connection
            .prepare_cached(
                "INSERT INTO edge_rfid_device_pool(device_id,pool_id)
                 VALUES('RFID-01','store-07.floor')",
            )
            .unwrap_or_else(|error| panic!("prepare scope: {error}"))
            .execute([])
            .unwrap_or_else(|error| panic!("scope: {error}"));
        signing_key
    }

    /// One number out of the node's database.
    fn count(edge: &SqliteEdge, sql: &str) -> i64 {
        let shared_connection = edge.connection();
        let connection = shared_connection
            .lock()
            .unwrap_or_else(|error| panic!("connection: {error}"));
        connection
            .query_row(sql, [], |row| row.get(0))
            .unwrap_or_else(|error| panic!("{sql}: {error}"))
    }

    fn request() -> EdgeRfidObservationRequest {
        EdgeRfidObservationRequest {
            site_id: "store-07".into(),
            pool: "store-07.floor".into(),
            reader_session_id: "walk-001".into(),
            observed_at: Utc::now(),
            idempotency_key: "rfid-batch-001".into(),
            observations: vec![
                RfidRead {
                    epc: TAG_ONE.to_ascii_lowercase(),
                    antenna: Some("A1".into()),
                    rssi: Some(-54.0),
                    phase: None,
                    frequency: None,
                    read_count: 2,
                },
                RfidRead {
                    epc: TAG_ONE.into(),
                    antenna: Some("A1".into()),
                    rssi: Some(-41.0),
                    phase: None,
                    frequency: None,
                    read_count: 3,
                },
            ],
        }
    }

    fn proof(signing_key: &str, body: &[u8], sequence: i64) -> DeviceProof {
        let timestamp = Utc::now().timestamp();
        DeviceProof {
            device_id: "RFID-01".into(),
            timestamp,
            sequence,
            signature: sign_rfid_request(
                signing_key,
                "RFID-01",
                timestamp,
                sequence,
                &security::sha256_hex(body),
            ),
        }
    }

    /// Two readers, one session, one overlapping garment.
    ///
    /// This is the whole promise of a shared session: help does not inflate the
    /// count. If this test ever goes green on `tag_count == 4` the floor will
    /// be told there is more stock than there is, and the difference will look
    /// exactly like a miscount nobody can explain.
    #[test]
    fn a_shared_session_counts_garments_not_sightings() {
        let (edge, service, signing_key) = setup();
        {
            let shared_connection = edge.connection();
            let connection = shared_connection
                .lock()
                .unwrap_or_else(|error| panic!("connection: {error}"));
            connection
                .prepare_cached(
                    "INSERT INTO edge_rfid_device
                         (device_id,label,auth_key_sha256,active,valid_until,last_sequence,
                          policy_version,updated_at)
                     VALUES('RFID-02','Second reader',?1,1,?2,0,1,?3)",
                )
                .unwrap_or_else(|error| panic!("prepare second device: {error}"))
                .execute(params![
                    signing_key,
                    time_text(Utc::now() + Duration::days(1)),
                    time_text(Utc::now()),
                ])
                .unwrap_or_else(|error| panic!("second device: {error}"));
            connection
                .prepare_cached(
                    "INSERT INTO edge_rfid_device_pool(device_id,pool_id)
                     VALUES('RFID-02','store-07.floor')",
                )
                .unwrap_or_else(|error| panic!("prepare second scope: {error}"))
                .execute([])
                .unwrap_or_else(|error| panic!("second scope: {error}"));
        }

        fn sweep(key: &str, epcs: &[&str]) -> EdgeRfidObservationRequest {
            EdgeRfidObservationRequest {
                site_id: "store-07".into(),
                pool: "store-07.floor".into(),
                reader_session_id: "S-SHARED".into(),
                observed_at: Utc::now(),
                idempotency_key: key.into(),
                observations: epcs
                    .iter()
                    .map(|epc| RfidRead {
                        epc: (*epc).into(),
                        antenna: None,
                        rssi: Some(-50.0),
                        phase: None,
                        frequency: None,
                        read_count: 1,
                    })
                    .collect(),
            }
        }

        fn proof_for(device: &str, signing_key: &str, body: &[u8], sequence: i64) -> DeviceProof {
            let timestamp = Utc::now().timestamp();
            DeviceProof {
                device_id: device.into(),
                timestamp,
                sequence,
                signature: sign_rfid_request(
                    signing_key,
                    device,
                    timestamp,
                    sequence,
                    &security::sha256_hex(body),
                ),
            }
        }

        const TAG_A: &str = "E2800000000000000000000A";
        const TAG_B: &str = "E2800000000000000000000B";
        const TAG_C: &str = "E2800000000000000000000C";

        // One reader takes the left of the aisle, the other the right, and they
        // meet in the middle over tag B.
        let first = serde_json::to_vec(&sweep("batch-a", &[TAG_A, TAG_B]))
            .unwrap_or_else(|error| panic!("first body: {error}"));
        service
            .ingest(proof_for("RFID-01", &signing_key, &first, 1), &first, None)
            .unwrap_or_else(|error| panic!("first ingest: {error}"));

        let second = serde_json::to_vec(&sweep("batch-b", &[TAG_B, TAG_C]))
            .unwrap_or_else(|error| panic!("second body: {error}"));
        service
            .ingest(
                proof_for("RFID-02", &signing_key, &second, 1),
                &second,
                None,
            )
            .unwrap_or_else(|error| panic!("second ingest: {error}"));

        let summary = service
            .session("S-SHARED")
            .unwrap_or_else(|error| panic!("session: {error}"));
        assert_eq!(
            summary.tag_count, 3,
            "tag B was seen twice but is one garment"
        );
        assert_eq!(summary.sighting_count, 4, "every filing is still on record");
        assert_eq!(summary.devices.len(), 2);
        assert_eq!(summary.epcs, vec![TAG_A, TAG_B, TAG_C]);
        assert!(!summary.truncated);

        // A session nobody has swept is empty, not an error: the first reader
        // to join asks before anyone has filed anything.
        let empty = service
            .session("S-NOBODY")
            .unwrap_or_else(|error| panic!("empty session: {error}"));
        assert_eq!(empty.tag_count, 0);
        assert!(empty.devices.is_empty());
    }

    #[test]
    fn authenticated_batch_is_local_and_durably_queued() {
        let (edge, service, signing_key) = setup();
        let body =
            serde_json::to_vec(&request()).unwrap_or_else(|error| panic!("request: {error}"));
        let proof = proof(&signing_key, &body, 1);
        let response = service
            .ingest(proof.clone(), &body, Some("operator-1".into()))
            .unwrap_or_else(|error| panic!("ingest: {error}"));
        assert_eq!(response["consolidated_sighting_count"], 1);
        assert_eq!(response["raw_read_count"], 5);
        assert_eq!(response["sync"]["queued"], true);

        let replay = service
            .ingest(proof, &body, Some("operator-1".into()))
            .unwrap_or_else(|error| panic!("replay: {error}"));
        assert_eq!(replay, response);

        assert_eq!(
            count(&edge, "SELECT count(*) FROM edge_observation_sighting"),
            1
        );
        assert_eq!(
            count(
                &edge,
                "SELECT count(*) FROM sync_fact_log
                 WHERE event_type='inventory.rfid_observation_batch.v1'"
            ),
            1
        );
        // Filed, so nothing is left to resume: its chunk rows went with it.
        assert_eq!(
            count(&edge, "SELECT count(*) FROM edge_rfid_batch_chunk"),
            0
        );
    }

    #[test]
    fn modified_retry_and_bad_signature_are_rejected() {
        let (_edge, service, signing_key) = setup();
        let body =
            serde_json::to_vec(&request()).unwrap_or_else(|error| panic!("request: {error}"));
        service
            .ingest(proof(&signing_key, &body, 1), &body, None)
            .unwrap_or_else(|error| panic!("ingest: {error}"));

        let mut changed = request();
        changed.observations[0].epc = "E28000000000000000000999".into();
        let changed_body =
            serde_json::to_vec(&changed).unwrap_or_else(|error| panic!("changed request: {error}"));
        assert!(matches!(
            service.ingest(proof(&signing_key, &changed_body, 1), &changed_body, None),
            Err(EdgeError::Conflict(_))
        ));

        let mut bad_proof = proof(&signing_key, &changed_body, 2);
        bad_proof.signature = "0".repeat(64);
        assert!(matches!(
            service.ingest(bad_proof, &changed_body, None),
            Err(EdgeError::Unauthorized(_))
        ));
    }

    /// The retry idempotency was written for: same batch, new signature.
    ///
    /// A reader cannot re-send the proof it signed the first time — the
    /// signature is only good for five minutes either side of its timestamp, so
    /// a batch that sat in an outbox through an offline spell, and a batch
    /// retried after the answer was lost on the way back, both arrive under a
    /// sequence this node has never seen. While the receipt check compared
    /// sequences, every one of those was refused as a conflict: the one case
    /// idempotency exists for was the one case it would not serve, and a
    /// counter that lost an answer over shop wifi had no way to get it back.
    #[test]
    fn a_retry_under_a_fresh_sequence_gets_the_stored_answer() {
        let (edge, service, signing_key) = setup();
        let body =
            serde_json::to_vec(&request()).unwrap_or_else(|error| panic!("request: {error}"));
        let first = service
            .ingest(
                proof(&signing_key, &body, 1),
                &body,
                Some("operator-1".into()),
            )
            .unwrap_or_else(|error| panic!("ingest: {error}"));

        // Same bytes, same reader, a sequence four higher — the device has
        // signed three other batches while this one waited.
        let retry = service
            .ingest(
                proof(&signing_key, &body, 5),
                &body,
                Some("operator-1".into()),
            )
            .unwrap_or_else(|error| panic!("retry: {error}"));
        assert_eq!(
            retry, first,
            "the answer it was already given, not a new one"
        );

        // And it was a retry, not a second filing: the floor is not told it has
        // twice the stock because a reply went missing.
        assert_eq!(
            count(&edge, "SELECT count(*) FROM edge_observation_sighting"),
            1
        );
    }

    /// The other half of the same test, and the reason the digest stays in it.
    ///
    /// Dropping the sequence from the receipt check must not turn an
    /// idempotency key into a licence to file anything under it. A different
    /// body under a key that is already spoken for is a client bug, and it is
    /// still a conflict whatever sequence it arrives with.
    #[test]
    fn a_different_batch_under_the_same_key_is_still_refused() {
        let (_edge, service, signing_key) = setup();
        let body =
            serde_json::to_vec(&request()).unwrap_or_else(|error| panic!("request: {error}"));
        service
            .ingest(proof(&signing_key, &body, 1), &body, None)
            .unwrap_or_else(|error| panic!("ingest: {error}"));

        let mut changed = request();
        changed.observations[0].epc = "E28000000000000000000999".into();
        let changed_body =
            serde_json::to_vec(&changed).unwrap_or_else(|error| panic!("changed request: {error}"));
        assert!(matches!(
            service.ingest(proof(&signing_key, &changed_body, 7), &changed_body, None),
            Err(EdgeError::Conflict(_))
        ));
    }

    /// Who is asking comes before what they sent. Bytes nobody signed are
    /// refused as unsigned without being read — they do not even get as far
    /// as being invalid JSON — and the same bytes, signed, are judged on what
    /// they say.
    #[test]
    fn an_unsigned_body_is_refused_before_it_is_read() {
        let (_edge, service, signing_key) = setup();
        let garbage = b"{ this is not json".to_vec();
        let mut unsigned = proof(&signing_key, &garbage, 1);
        unsigned.signature = "0".repeat(64);
        assert!(matches!(
            service.ingest(unsigned, &garbage, None),
            Err(EdgeError::Unauthorized(_))
        ));
        assert!(matches!(
            service.ingest(proof(&signing_key, &garbage, 1), &garbage, None),
            Err(EdgeError::Validation(_))
        ));
    }

    /// A batch that could never be filed leaves nothing behind: no claimed
    /// sequence, no chunk of sightings, no fact.
    ///
    /// An infinite RSSI used to be found only at the finalize, after the
    /// sequence was spent and every chunk had landed. An "EPC" no tag can hold
    /// was not found at all — and a megabyte of one made a fact larger than
    /// any upload the cloud would take, which stopped the node's whole stream.
    #[test]
    fn a_batch_that_cannot_be_filed_leaves_nothing_behind() {
        let (edge, service, signing_key) = setup();
        // Written by hand: a JSON number too large for an f32 reads as
        // infinity, and serde_json would never write one.
        let infinite_rssi = format!(
            r#"{{"site_id":"store-07","pool":"store-07.floor","reader_session_id":"walk-001","observed_at":"{}","idempotency_key":"rfid-infinite","observations":[{{"epc":"{TAG_ONE}","rssi":1e39,"read_count":1}}]}}"#,
            Utc::now().to_rfc3339()
        )
        .into_bytes();
        let mut megabyte = request();
        megabyte.idempotency_key = "rfid-megabyte".into();
        megabyte.observations[0].epc = "A".repeat(1_048_576);
        let mut not_hex = request();
        not_hex.idempotency_key = "rfid-not-hex".into();
        not_hex.observations[1].epc = "EPC00000001".into();
        let mut prose = request();
        prose.idempotency_key = "rfid-prose".into();
        prose.observations[0].antenna = Some("A".repeat(MAX_RFID_ANTENNA_LEN + 1));
        let mut bodies = vec![infinite_rssi];
        for refused in [megabyte, not_hex, prose] {
            bodies
                .push(serde_json::to_vec(&refused).unwrap_or_else(|error| panic!("body: {error}")));
        }
        for (sequence, body) in (1_i64..).zip(&bodies) {
            let refused = service.ingest(proof(&signing_key, body, sequence), body, None);
            assert!(
                matches!(refused, Err(EdgeError::Validation(_))),
                "batch {sequence} must be refused as invalid: {refused:?}"
            );
        }
        assert_eq!(
            count(
                &edge,
                "SELECT last_sequence FROM edge_rfid_device WHERE device_id='RFID-01'"
            ),
            0,
            "no sequence was spent"
        );
        for table in [
            "edge_observation_sighting",
            "edge_rfid_batch_chunk",
            "edge_rfid_batch_receipt",
            "sync_fact_log WHERE event_type='inventory.rfid_observation_batch.v1'",
        ] {
            assert_eq!(
                count(&edge, &format!("SELECT count(*) FROM {table}")),
                0,
                "{table}"
            );
        }
    }

    /// A batch whose answer was lost under one key, sent again under the next.
    ///
    /// Rotating a key starts a new sequence epoch, and used to delete the
    /// device's receipts with it: the retry was then filed a second time,
    /// under a new batch id with new observation ids, and the cloud — which
    /// deduplicates by observation id — kept both. The receipt now outlives
    /// the key (sqlite 0082), so the retry, signed with the new key, is
    /// answered from it; and the new epoch may still count from one.
    #[test]
    fn a_receipt_outlives_the_key_it_was_filed_under() {
        let (edge, service, old_key) = setup();
        let body =
            serde_json::to_vec(&request()).unwrap_or_else(|error| panic!("request: {error}"));
        let first = service
            .ingest(proof(&old_key, &body, 1), &body, None)
            .unwrap_or_else(|error| panic!("first filing: {error}"));

        // What a policy carrying a rotated key does to the device
        // (`edge::sync::apply_auth_policy`).
        let new_key = derive_rfid_signing_key("reader-enrolment-key-rotated");
        {
            let shared_connection = edge.connection();
            let connection = shared_connection
                .lock()
                .unwrap_or_else(|error| panic!("connection: {error}"));
            connection
                .execute(
                    "UPDATE edge_rfid_device
                     SET auth_key_sha256=?1,last_sequence=0,last_request_digest=NULL
                     WHERE device_id='RFID-01'",
                    params![new_key],
                )
                .unwrap_or_else(|error| panic!("rotate: {error}"));
        }

        let retry = service
            .ingest(proof(&new_key, &body, 1), &body, None)
            .unwrap_or_else(|error| panic!("retry under the new key: {error}"));
        assert_eq!(retry, first, "answered from the receipt, not filed again");
        assert_eq!(
            count(&edge, "SELECT count(*) FROM edge_observation_sighting"),
            1
        );
        assert_eq!(
            count(
                &edge,
                "SELECT count(*) FROM sync_fact_log
                 WHERE event_type='inventory.rfid_observation_batch.v1'"
            ),
            1,
            "one batch, one fact"
        );

        // The old key's sequence 1 is still on a receipt; the new epoch's
        // sequence 1 files beside it.
        let mut next = request();
        next.idempotency_key = "rfid-batch-002".into();
        let next = serde_json::to_vec(&next).unwrap_or_else(|error| panic!("next: {error}"));
        service
            .ingest(proof(&new_key, &next, 1), &next, None)
            .unwrap_or_else(|error| panic!("first batch of the new epoch: {error}"));
        assert_eq!(
            count(
                &edge,
                "SELECT count(*) FROM edge_rfid_batch_receipt WHERE device_id='RFID-01'"
            ),
            2
        );

        // And the old key no longer files anything.
        let mut stale = request();
        stale.idempotency_key = "rfid-batch-003".into();
        let stale = serde_json::to_vec(&stale).unwrap_or_else(|error| panic!("stale: {error}"));
        assert!(matches!(
            service.ingest(proof(&old_key, &stale, 2), &stale, None),
            Err(EdgeError::Unauthorized(_))
        ));
    }

    /// On a node with a database file, the session reads have a read-only
    /// handle of their own, and see what the writer committed.
    #[test]
    fn a_file_backed_node_reads_sessions_on_its_own_handle() {
        let path = std::env::temp_dir().join(format!("rfid-reader-{}.sqlite3", Uuid::new_v4()));
        let site = SiteId::new("store-07").unwrap_or_else(|error| panic!("site: {error}"));
        let node = NodeContext::new("store-07-edge", EdgeRole::Store, site)
            .unwrap_or_else(|error| panic!("node: {error}"));
        {
            let edge = SqliteEdge::open(&path, node.clone())
                .unwrap_or_else(|error| panic!("edge: {error}"));
            let signing_key = enrol(&edge);
            let service = EdgeRfid::new(edge.connection(), node, edge.clock());
            assert!(service.reader.is_some(), "a file gets its own read handle");

            let body =
                serde_json::to_vec(&request()).unwrap_or_else(|error| panic!("request: {error}"));
            service
                .ingest(proof(&signing_key, &body, 1), &body, None)
                .unwrap_or_else(|error| panic!("ingest: {error}"));
            let summary = service
                .session("walk-001")
                .unwrap_or_else(|error| panic!("session: {error}"));
            assert_eq!(summary.tag_count, 1);
            assert_eq!(summary.epcs, vec![TAG_ONE]);
            let recent = service
                .recent_sessions(10)
                .unwrap_or_else(|error| panic!("recent: {error}"));
            assert_eq!(recent.len(), 1);
        }
        for suffix in ["", "-wal", "-shm"] {
            let mut file = path.clone().into_os_string();
            file.push(suffix);
            let _ = std::fs::remove_file(file);
        }
    }
}
