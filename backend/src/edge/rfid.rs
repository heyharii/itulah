//! Local, offline-capable RFID evidence ingestion.
//!
//! A reader proves possession of its one-time enrolment key by signing the
//! exact request body plus a timestamp and monotonic sequence. The Edge
//! authenticates and scopes the device locally, stores the evidence, and
//! appends the same batch to its durable ordered sync log in one transaction.

use crate::{
    edge::{consolidate_reads, EdgeError, NodeContext, OperationalPool, RfidRead},
    security,
    sync::{
        RfidObservationBatchPayload, RfidObservationSighting, INVENTORY_RFID_OBSERVATION_BATCH_V1,
        RFID_OBSERVATION_SCHEMA_VERSION,
    },
};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    str::FromStr,
    sync::{Arc, Mutex, MutexGuard},
};
use uuid::Uuid;

pub const RFID_OBSERVATION_PATH: &str = "/api/v1/rfid/observations";
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
    node: NodeContext,
}

impl EdgeRfid {
    pub fn new(connection: Arc<Mutex<Connection>>, node: NodeContext) -> Self {
        Self { connection, node }
    }

    pub fn node(&self) -> &NodeContext {
        &self.node
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, EdgeError> {
        self.connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge RFID connection is poisoned".into()))
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
        let connection = self.lock()?;

        let (tag_count, sighting_count, first, last): (i64, i64, Option<String>, Option<String>) =
            connection
                .query_row(
                    "SELECT COUNT(DISTINCT epc), COUNT(*), MIN(first_seen_at), MAX(last_seen_at)
                     FROM edge_observation_sighting WHERE reader_session_id=?1",
                    params![id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
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
        let now = Utc::now();
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let device: Option<(String, i64, String, i64)> = tx
            .query_row(
                "SELECT auth_key_sha256,active,valid_until,last_sequence
                 FROM edge_rfid_device WHERE device_id=?1",
                params![device_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(db)?;
        let Some((signing_key, active, valid_until, last_sequence)) = device else {
            return Err(EdgeError::Unauthorized("unknown RFID device".into()));
        };
        if active != 1 {
            return Err(EdgeError::Unauthorized("RFID device is disabled".into()));
        }
        let valid_until = parse_time(&valid_until)?;
        if valid_until <= now {
            return Err(EdgeError::Unauthorized(
                "RFID device offline lease has expired; reconnect this Edge to Cloud".into(),
            ));
        }
        let expected_signature = sign_rfid_request(
            &signing_key,
            &device_id,
            proof.timestamp,
            proof.sequence,
            &request_digest,
        );
        if !security::constant_time_eq(&proof.signature.to_ascii_lowercase(), &expected_signature) {
            return Err(EdgeError::Unauthorized(
                "invalid RFID device signature".into(),
            ));
        }

        let request: EdgeRfidObservationRequest = serde_json::from_slice(raw_body)
            .map_err(|error| EdgeError::Validation(format!("invalid RFID JSON: {error}")))?;
        validate_request(&self.node, &request, now)?;

        let prior: Option<(String, i64, String, String)> = tx
            .query_row(
                "SELECT device_id,sequence,request_digest,response_json
                 FROM edge_rfid_batch_receipt WHERE idempotency_key=?1",
                params![request.idempotency_key],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(db)?;
        if let Some((prior_device, prior_sequence, prior_digest, response_json)) = prior {
            if prior_device != device_id
                || prior_sequence != proof.sequence
                || prior_digest != request_digest
            {
                return Err(EdgeError::Conflict(
                    "idempotency key was already used for another RFID request".into(),
                ));
            }
            let response = serde_json::from_str(&response_json).map_err(|error| {
                EdgeError::Persistence(format!("stored RFID response is invalid: {error}"))
            })?;
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        let clock_delta = now.timestamp().abs_diff(proof.timestamp);
        if clock_delta > RFID_SIGNATURE_MAX_SKEW_SECONDS {
            return Err(EdgeError::Unauthorized(format!(
                "RFID request timestamp is outside the {RFID_SIGNATURE_MAX_SKEW_SECONDS}-second window"
            )));
        }
        if proof.sequence <= last_sequence {
            return Err(EdgeError::Conflict(format!(
                "RFID device sequence replayed; last accepted sequence is {last_sequence}"
            )));
        }
        let allowed: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM edge_rfid_device_pool
                               WHERE device_id=?1 AND pool_id=?2)",
                params![device_id, request.pool],
                |row| row.get(0),
            )
            .map_err(db)?;
        if !allowed {
            return Err(EdgeError::Forbidden(format!(
                "RFID device is not assigned to pool {}",
                request.pool
            )));
        }

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
        let received_at = now;
        let batch_id = Uuid::new_v4();
        let mut sightings = Vec::with_capacity(consolidated.len());
        for read in consolidated {
            let observation_id = Uuid::new_v4();
            tx.execute(
                "INSERT INTO edge_observation_sighting
                     (observation_id,epc,site_id,pool_id,first_seen_at,last_seen_at,
                      received_at,device_id,reader_session_id,operator_id,read_count,
                      best_rssi,antenna)
                 VALUES(?1,?2,?3,?4,?5,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    observation_id.to_string(),
                    read.epc,
                    request.site_id,
                    request.pool,
                    time_text(request.observed_at),
                    time_text(received_at),
                    device_id,
                    request.reader_session_id,
                    operator_id,
                    read.read_count,
                    read.best_rssi,
                    read.antenna,
                ],
            )
            .map_err(db)?;
            sightings.push(RfidObservationSighting {
                observation_id,
                epc: read.epc,
                read_count: read.read_count,
                best_rssi: read.best_rssi,
                antenna: read.antenna,
            });
        }
        let payload = RfidObservationBatchPayload {
            schema_version: RFID_OBSERVATION_SCHEMA_VERSION,
            batch_id,
            idempotency_key: request.idempotency_key.clone(),
            site_id: request.site_id.clone(),
            pool_id: request.pool.clone(),
            device_id: device_id.clone(),
            operator_id,
            reader_session_id: request.reader_session_id.clone(),
            observed_at: request.observed_at,
            received_at,
            device_sequence: proof.sequence,
            sightings,
        };
        payload
            .validate()
            .map_err(|error| EdgeError::Validation(error.to_string()))?;
        let sync_sequence = crate::edge::sync::enqueue_fact(
            &tx,
            batch_id,
            INVENTORY_RFID_OBSERVATION_BATCH_V1,
            &payload,
        )
        .map_err(db)?;
        let response = json!({
            "batch_id":batch_id,
            "idempotency_key":request.idempotency_key,
            "device_id":device_id,
            "device_sequence":proof.sequence,
            "raw_read_count":request.observations.iter()
                .map(|read| i64::from(read.read_count.max(1))).sum::<i64>(),
            "consolidated_sighting_count":payload.sightings.len(),
            "observation_ids":payload.sightings.iter()
                .map(|sighting| sighting.observation_id).collect::<Vec<_>>(),
            "observed_at":request.observed_at,
            "received_at":received_at,
            "sync":{"queued":sync_sequence.is_some(),"sequence":sync_sequence},
            "inventory_effect":{"movement_count":0,"missing_created":0},
        });
        let response_json = serde_json::to_string(&response)
            .map_err(|error| EdgeError::Persistence(format!("serialize RFID response: {error}")))?;
        tx.execute(
            "INSERT INTO edge_rfid_batch_receipt
                 (idempotency_key,device_id,sequence,request_digest,response_json,created_at)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                request.idempotency_key,
                device_id,
                proof.sequence,
                request_digest,
                response_json,
                time_text(now),
            ],
        )
        .map_err(map_receipt_error)?;
        tx.execute(
            "UPDATE edge_rfid_device
             SET last_sequence=?2,last_request_digest=?3,last_seen_at=?4
             WHERE device_id=?1",
            params![device_id, proof.sequence, request_digest, time_text(now)],
        )
        .map_err(db)?;
        tx.commit().map_err(db)?;
        Ok(response)
    }
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
    let canonical = format!(
        "POST\n{RFID_OBSERVATION_PATH}\n{device_id}\n{timestamp}\n{sequence}\n{body_sha256}"
    );
    security::hmac_sha256_hex(signing_key_sha256.as_bytes(), canonical.as_bytes())
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

    fn setup() -> (SqliteEdge, EdgeRfid, String) {
        let site = SiteId::new("store-07").unwrap_or_else(|error| panic!("site: {error}"));
        let node = NodeContext::new("store-07-edge", EdgeRole::Store, site)
            .unwrap_or_else(|error| panic!("node: {error}"));
        let edge = SqliteEdge::open_in_memory(node.clone())
            .unwrap_or_else(|error| panic!("edge: {error}"));
        let raw_key = "reader-enrolment-key";
        let signing_key = derive_rfid_signing_key(raw_key);
        {
            let shared_connection = edge.connection();
            let connection = shared_connection
                .lock()
                .unwrap_or_else(|error| panic!("connection: {error}"));
            connection
                .execute(
                    "INSERT INTO edge_rfid_device
                         (device_id,label,auth_key_sha256,active,valid_until,last_sequence,
                          policy_version,updated_at)
                     VALUES('RFID-01','Test reader',?1,1,?2,0,1,?3)",
                    params![
                        signing_key,
                        time_text(Utc::now() + Duration::days(1)),
                        time_text(Utc::now()),
                    ],
                )
                .unwrap_or_else(|error| panic!("device: {error}"));
            connection
                .execute(
                    "INSERT INTO edge_rfid_device_pool(device_id,pool_id)
                     VALUES('RFID-01','store-07.floor')",
                    [],
                )
                .unwrap_or_else(|error| panic!("scope: {error}"));
        }
        let service = EdgeRfid::new(edge.connection(), node);
        (edge, service, signing_key)
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
                    epc: "epc001".into(),
                    antenna: Some("A1".into()),
                    rssi: Some(-54.0),
                    phase: None,
                    frequency: None,
                    read_count: 2,
                },
                RfidRead {
                    epc: "EPC001".into(),
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
                .execute(
                    "INSERT INTO edge_rfid_device
                         (device_id,label,auth_key_sha256,active,valid_until,last_sequence,
                          policy_version,updated_at)
                     VALUES('RFID-02','Second reader',?1,1,?2,0,1,?3)",
                    params![
                        signing_key,
                        time_text(Utc::now() + Duration::days(1)),
                        time_text(Utc::now()),
                    ],
                )
                .unwrap_or_else(|error| panic!("second device: {error}"));
            connection
                .execute(
                    "INSERT INTO edge_rfid_device_pool(device_id,pool_id)
                     VALUES('RFID-02','store-07.floor')",
                    [],
                )
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

        // One reader takes the left of the aisle, the other the right, and they
        // meet in the middle over EPCB.
        let first = serde_json::to_vec(&sweep("batch-a", &["EPCA", "EPCB"]))
            .unwrap_or_else(|error| panic!("first body: {error}"));
        service
            .ingest(proof_for("RFID-01", &signing_key, &first, 1), &first, None)
            .unwrap_or_else(|error| panic!("first ingest: {error}"));

        let second = serde_json::to_vec(&sweep("batch-b", &["EPCB", "EPCC"]))
            .unwrap_or_else(|error| panic!("second body: {error}"));
        service
            .ingest(proof_for("RFID-02", &signing_key, &second, 1), &second, None)
            .unwrap_or_else(|error| panic!("second ingest: {error}"));

        let summary = service
            .session("S-SHARED")
            .unwrap_or_else(|error| panic!("session: {error}"));
        assert_eq!(summary.tag_count, 3, "EPCB was seen twice but is one garment");
        assert_eq!(summary.sighting_count, 4, "every filing is still on record");
        assert_eq!(summary.devices.len(), 2);
        assert_eq!(summary.epcs, vec!["EPCA", "EPCB", "EPCC"]);
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

        let shared_connection = edge.connection();
        let connection = shared_connection
            .lock()
            .unwrap_or_else(|error| panic!("connection: {error}"));
        let observations: i64 = connection
            .query_row(
                "SELECT count(*) FROM edge_observation_sighting",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|error| panic!("observations: {error}"));
        assert_eq!(observations, 1);
        let facts: i64 = connection
            .query_row(
                "SELECT count(*) FROM sync_fact_log
                 WHERE event_type=?1",
                params![INVENTORY_RFID_OBSERVATION_BATCH_V1],
                |row| row.get(0),
            )
            .unwrap_or_else(|error| panic!("facts: {error}"));
        assert_eq!(facts, 1);
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
        changed.observations[0].epc = "EPC999".into();
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
}
