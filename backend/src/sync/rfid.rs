//! Authenticated RFID evidence uploaded from an Edge to Cloud.
//!
//! The fact is deliberately observational: applying it never changes the
//! movement ledger. Each sighting has an Edge-assigned UUID so retries and
//! replayed sync envelopes remain idempotent at Cloud.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use thiserror::Error;
use uuid::Uuid;

pub const INVENTORY_RFID_OBSERVATION_BATCH_V1: &str = "inventory.rfid_observation_batch.v1";
pub const RFID_OBSERVATION_SCHEMA_VERSION: u32 = 1;
pub const MAX_RFID_SIGHTINGS_PER_BATCH: usize = 2_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RfidObservationSighting {
    pub observation_id: Uuid,
    pub epc: String,
    pub read_count: i64,
    pub best_rssi: Option<f32>,
    pub antenna: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RfidObservationBatchPayload {
    pub schema_version: u32,
    pub batch_id: Uuid,
    pub idempotency_key: String,
    pub site_id: String,
    pub pool_id: String,
    pub device_id: String,
    pub operator_id: Option<String>,
    pub reader_session_id: String,
    pub observed_at: DateTime<Utc>,
    pub received_at: DateTime<Utc>,
    pub device_sequence: i64,
    pub sightings: Vec<RfidObservationSighting>,
}

#[derive(Clone, Debug, Error, PartialEq)]
pub enum RfidObservationValidationError {
    #[error("RFID observation schema_version must be {RFID_OBSERVATION_SCHEMA_VERSION}")]
    UnsupportedSchemaVersion,
    #[error("RFID observation {0} is required")]
    MissingIdentity(&'static str),
    #[error("device_sequence must be positive")]
    InvalidSequence,
    #[error("RFID observation batch must contain 1-{MAX_RFID_SIGHTINGS_PER_BATCH} sightings")]
    InvalidBatchSize,
    #[error("RFID sighting EPC must already be canonical uppercase text")]
    NonCanonicalEpc,
    #[error("RFID sighting read_count must be positive")]
    InvalidReadCount,
    #[error("RFID sighting RSSI must be finite")]
    InvalidRssi,
    #[error("RFID observation contains duplicate observation_id {0}")]
    DuplicateObservation(Uuid),
    #[error("RFID observation contains duplicate EPC {0}")]
    DuplicateEpc(String),
}

impl RfidObservationBatchPayload {
    pub fn validate(&self) -> Result<(), RfidObservationValidationError> {
        if self.schema_version != RFID_OBSERVATION_SCHEMA_VERSION {
            return Err(RfidObservationValidationError::UnsupportedSchemaVersion);
        }
        for (name, value) in [
            ("idempotency_key", self.idempotency_key.as_str()),
            ("site_id", self.site_id.as_str()),
            ("pool_id", self.pool_id.as_str()),
            ("device_id", self.device_id.as_str()),
            ("reader_session_id", self.reader_session_id.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(RfidObservationValidationError::MissingIdentity(name));
            }
        }
        if self.device_sequence < 1 {
            return Err(RfidObservationValidationError::InvalidSequence);
        }
        if self.sightings.is_empty() || self.sightings.len() > MAX_RFID_SIGHTINGS_PER_BATCH {
            return Err(RfidObservationValidationError::InvalidBatchSize);
        }
        let mut ids = HashSet::with_capacity(self.sightings.len());
        let mut epcs = HashSet::with_capacity(self.sightings.len());
        for sighting in &self.sightings {
            if !ids.insert(sighting.observation_id) {
                return Err(RfidObservationValidationError::DuplicateObservation(
                    sighting.observation_id,
                ));
            }
            let canonical = sighting.epc.trim().to_ascii_uppercase();
            if canonical.is_empty() || sighting.epc != canonical {
                return Err(RfidObservationValidationError::NonCanonicalEpc);
            }
            if !epcs.insert(sighting.epc.as_str()) {
                return Err(RfidObservationValidationError::DuplicateEpc(
                    sighting.epc.clone(),
                ));
            }
            if sighting.read_count < 1 {
                return Err(RfidObservationValidationError::InvalidReadCount);
            }
            if sighting.best_rssi.is_some_and(|value| !value.is_finite()) {
                return Err(RfidObservationValidationError::InvalidRssi);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> RfidObservationBatchPayload {
        let now = Utc::now();
        RfidObservationBatchPayload {
            schema_version: RFID_OBSERVATION_SCHEMA_VERSION,
            batch_id: Uuid::new_v4(),
            idempotency_key: "rfid-1".into(),
            site_id: "store-07".into(),
            pool_id: "store-07.floor".into(),
            device_id: "RFID-01".into(),
            operator_id: None,
            reader_session_id: "walk-1".into(),
            observed_at: now,
            received_at: now,
            device_sequence: 1,
            sightings: vec![RfidObservationSighting {
                observation_id: Uuid::new_v4(),
                epc: "EPC001".into(),
                read_count: 4,
                best_rssi: Some(-42.0),
                antenna: Some("A1".into()),
            }],
        }
    }

    #[test]
    fn valid_payload_round_trips() {
        let payload = payload();
        payload
            .validate()
            .unwrap_or_else(|error| panic!("payload: {error}"));
        let encoded =
            serde_json::to_string(&payload).unwrap_or_else(|error| panic!("encode: {error}"));
        let decoded: RfidObservationBatchPayload =
            serde_json::from_str(&encoded).unwrap_or_else(|error| panic!("decode: {error}"));
        assert_eq!(decoded, payload);
    }

    #[test]
    fn duplicate_epc_is_rejected() {
        let mut payload = payload();
        let mut duplicate = payload.sightings[0].clone();
        duplicate.observation_id = Uuid::new_v4();
        payload.sightings.push(duplicate);
        assert!(matches!(
            payload.validate(),
            Err(RfidObservationValidationError::DuplicateEpc(_))
        ));
    }
}
