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
/// The longest EPC a tag can carry: Gen2 allows 496 bits, which is 124 hex
/// digits. Ours are 96 (24 digits), and so are the foreign tags a sweep meets.
pub const MAX_RFID_EPC_HEX_LEN: usize = 124;
/// An antenna is a port's name ("A1"), never prose.
pub const MAX_RFID_ANTENNA_LEN: usize = 64;

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
    #[error(
        "RFID sighting EPC {0} is not an even number of hex digits, at most \
         {MAX_RFID_EPC_HEX_LEN} long"
    )]
    MalformedEpc(String),
    #[error("RFID sighting antenna must be at most {MAX_RFID_ANTENNA_LEN} characters")]
    AntennaTooLong,
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

    /// What a reader can actually have read: every EPC an even number of hex
    /// digits no longer than a Gen2 tag holds, every antenna a short name.
    ///
    /// Without it one sighting could carry an "EPC" of a megabyte, and the
    /// fact that carried it was larger than any upload the cloud accepts: the
    /// node resent it on every cycle, and its whole stream — sales, movements,
    /// and the commands that ride the answer — stopped behind it. A foreign
    /// tag passes: twenty-four hex digits we did not mint are still a real
    /// garment on the rail.
    ///
    /// Checked where evidence enters — the node filing a batch, and the
    /// cloud's ingest — and deliberately not inside [`Self::validate`], which
    /// the cloud runs again when it applies: a batch accepted before this
    /// check existed must still land there, not stop its stream.
    pub fn validate_reads(&self) -> Result<(), RfidObservationValidationError> {
        for sighting in &self.sightings {
            validate_epc(&sighting.epc)?;
            if sighting
                .antenna
                .as_deref()
                .is_some_and(|antenna| antenna.chars().count() > MAX_RFID_ANTENNA_LEN)
            {
                return Err(RfidObservationValidationError::AntennaTooLong);
            }
        }
        Ok(())
    }
}

/// One EPC as a reader reports it: hex digits, an even number of them (a tag
/// holds whole 16-bit words), at most [`MAX_RFID_EPC_HEX_LEN`]. Either case:
/// the node uppercases before it stores.
pub fn validate_epc(epc: &str) -> Result<(), RfidObservationValidationError> {
    // Length first, so a megabyte of digits is refused without being read.
    let well_formed = !epc.is_empty()
        && epc.len() <= MAX_RFID_EPC_HEX_LEN
        && epc.len().is_multiple_of(2)
        && epc.bytes().all(|byte| byte.is_ascii_hexdigit());
    if well_formed {
        return Ok(());
    }
    // Named in the refusal, but never whole: the refusal is logged, stored as
    // a rejection reason and sent back, and the value is what was too big.
    let shown: String = epc.chars().take(32).collect();
    let preview = if shown.len() < epc.len() {
        format!("{shown:?}… ({} bytes)", epc.len())
    } else {
        format!("{shown:?}")
    };
    Err(RfidObservationValidationError::MalformedEpc(preview))
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

    /// Only what a tag can hold. A foreign tag — twenty-four hex digits this
    /// estate never minted — is a real garment and passes; a megabyte "EPC"
    /// is refused, and the refusal does not repeat the megabyte.
    #[test]
    fn an_epc_is_hex_digits_a_tag_can_hold() {
        let longest = "F".repeat(MAX_RFID_EPC_HEX_LEN);
        let too_long = "F".repeat(MAX_RFID_EPC_HEX_LEN + 2);
        for good in [
            "A11234567812300000000064",
            "e2801160600002084f1c5a2b",
            longest.as_str(),
        ] {
            validate_epc(good).unwrap_or_else(|error| panic!("{good}: {error}"));
        }
        for bad in ["", "EPC00000001", "A1123", "A1 23456", too_long.as_str()] {
            assert!(
                matches!(
                    validate_epc(bad),
                    Err(RfidObservationValidationError::MalformedEpc(_))
                ),
                "{bad:?} must be refused"
            );
        }
        let huge = "0".repeat(1_048_577);
        let refusal = validate_epc(&huge)
            .err()
            .unwrap_or_else(|| panic!("a megabyte is not an EPC"))
            .to_string();
        assert!(refusal.len() < 200, "{refusal}");
    }

    #[test]
    fn a_batch_names_real_tags_and_short_antennas() {
        let mut payload = payload();
        payload.sightings[0].epc = "A11234567812300000000064".into();
        payload
            .validate_reads()
            .unwrap_or_else(|error| panic!("reads: {error}"));

        payload.sightings[0].antenna = Some("A".repeat(MAX_RFID_ANTENNA_LEN + 1));
        assert_eq!(
            payload.validate_reads(),
            Err(RfidObservationValidationError::AntennaTooLong)
        );

        payload.sightings[0].antenna = None;
        payload.sightings[0].epc = "EPC001".into();
        assert!(matches!(
            payload.validate_reads(),
            Err(RfidObservationValidationError::MalformedEpc(_))
        ));
    }
}
