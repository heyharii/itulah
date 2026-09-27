//! Short-lived, one-time Cloud-to-Edge sign-in tickets.
//!
//! Cloud holds an Ed25519 private seed. Its public key is carried to an Edge
//! inside the already signed auth-policy command. The ticket itself is sent
//! only in a POST body and never contains a role: the Edge derives the role
//! from its current local Cloud-user projection.

use ring::signature::{Ed25519KeyPair, KeyPair, UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};

const SIGNING_CONTEXT: &[u8] = b"ITULAH-EDGE-SSO-V1\0";
const MAX_TICKET_BYTES: usize = 4096;
const MAX_PAYLOAD_BYTES: usize = 2048;

/// Identity and destination covered by a Cloud signature.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct TicketClaims {
    pub sub: String,
    pub aud: String,
    pub origin_id: String,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
}

/// Read the Cloud-only private key from a 32-byte hex seed.
///
/// The seed must be generated once and kept stable across Cloud restarts. Its
/// corresponding public key is published to each Edge by the auth-policy
/// projection, which is signed by the existing Cloud-to-Edge command lane.
pub fn signing_seed_from_env() -> Result<Option<[u8; 32]>, String> {
    match std::env::var("INVENTORY_SSO_SIGNING_KEY_HEX") {
        Ok(value) => decode_seed(&value).map(Some),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(format!(
            "could not read INVENTORY_SSO_SIGNING_KEY_HEX: {error}"
        )),
    }
}

pub fn public_key_from_seed(seed: &[u8; 32]) -> Result<String, String> {
    let key = Ed25519KeyPair::from_seed_unchecked(seed)
        .map_err(|error| format!("invalid Cloud SSO signing seed: {error}"))?;
    Ok(hex::encode(key.public_key().as_ref()))
}

pub fn public_key_from_env() -> Result<Option<String>, String> {
    signing_seed_from_env()?
        .as_ref()
        .map(public_key_from_seed)
        .transpose()
}

pub fn issue_ticket(claims: &TicketClaims, seed: &[u8; 32]) -> Result<String, String> {
    let key = Ed25519KeyPair::from_seed_unchecked(seed)
        .map_err(|error| format!("invalid Cloud SSO signing seed: {error}"))?;
    let payload = serde_json::to_vec(claims)
        .map_err(|error| format!("could not encode Cloud SSO ticket: {error}"))?;
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err("Cloud SSO ticket claims are too large".into());
    }
    let mut message = Vec::with_capacity(SIGNING_CONTEXT.len() + payload.len());
    message.extend_from_slice(SIGNING_CONTEXT);
    message.extend_from_slice(&payload);
    let signature = key.sign(&message);
    Ok(format!(
        "v1.{}.{}",
        hex::encode(payload),
        hex::encode(signature.as_ref())
    ))
}

pub fn verify_ticket(ticket: &str, public_key_hex: &str) -> Result<TicketClaims, String> {
    if ticket.len() > MAX_TICKET_BYTES {
        return Err("Cloud SSO ticket is too large".into());
    }
    let mut parts = ticket.split('.');
    if parts.next() != Some("v1") {
        return Err("unsupported Cloud SSO ticket version".into());
    }
    let payload_hex = parts
        .next()
        .ok_or_else(|| "malformed Cloud SSO ticket".to_string())?;
    let signature_hex = parts
        .next()
        .ok_or_else(|| "malformed Cloud SSO ticket".to_string())?;
    if parts.next().is_some() || payload_hex.len() > MAX_PAYLOAD_BYTES * 2 {
        return Err("malformed Cloud SSO ticket".into());
    }
    let payload = hex::decode(payload_hex).map_err(|_| "malformed Cloud SSO ticket".to_string())?;
    let signature =
        hex::decode(signature_hex).map_err(|_| "malformed Cloud SSO ticket".to_string())?;
    let public_key =
        hex::decode(public_key_hex).map_err(|_| "invalid Cloud SSO public key".to_string())?;
    if public_key.len() != 32 || signature.len() != 64 {
        return Err("invalid Cloud SSO key or signature length".into());
    }
    let mut message = Vec::with_capacity(SIGNING_CONTEXT.len() + payload.len());
    message.extend_from_slice(SIGNING_CONTEXT);
    message.extend_from_slice(&payload);
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(&message, &signature)
        .map_err(|_| "invalid Cloud SSO ticket signature".to_string())?;
    serde_json::from_slice(&payload).map_err(|_| "malformed Cloud SSO ticket claims".into())
}

fn decode_seed(value: &str) -> Result<[u8; 32], String> {
    let bytes = hex::decode(value.trim()).map_err(|_| {
        "INVENTORY_SSO_SIGNING_KEY_HEX must be 64 hexadecimal characters".to_string()
    })?;
    bytes
        .try_into()
        .map_err(|_| "INVENTORY_SSO_SIGNING_KEY_HEX must encode exactly 32 bytes".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_claims() -> TicketClaims {
        TicketClaims {
            sub: "eebd840b-a57a-4e88-b82d-4a247936df7f".into(),
            aud: "dc-01".into(),
            origin_id: "dc-01".into(),
            iat: 1_800_000_000,
            exp: 1_800_000_060,
            jti: "91c13b51-bb7e-40fa-bfe9-62d5b831a14b".into(),
        }
    }

    #[test]
    fn signed_ticket_round_trips_and_tampering_is_refused() {
        let seed = [17u8; 32];
        let public_key = public_key_from_seed(&seed).unwrap_or_else(|error| panic!("key: {error}"));
        let ticket =
            issue_ticket(&sample_claims(), &seed).unwrap_or_else(|error| panic!("ticket: {error}"));
        assert_eq!(verify_ticket(&ticket, &public_key), Ok(sample_claims()));

        let mut bytes = ticket.into_bytes();
        let index = bytes.iter().position(|byte| *byte == b'.').unwrap_or(0) + 3;
        if let Some(byte) = bytes.get_mut(index) {
            *byte = if *byte == b'0' { b'1' } else { b'0' };
        }
        let tampered = String::from_utf8(bytes).unwrap_or_default();
        assert!(verify_ticket(&tampered, &public_key).is_err());
        assert!(verify_ticket(
            &issue_ticket(&sample_claims(), &seed).unwrap_or_default(),
            &public_key_from_seed(&[18u8; 32]).unwrap_or_default()
        )
        .is_err());
    }

    #[test]
    fn signing_seed_requires_exactly_32_hex_bytes() {
        assert!(decode_seed(&"ab".repeat(32)).is_ok());
        assert!(decode_seed("abc").is_err());
        assert!(decode_seed(&"ab".repeat(31)).is_err());
    }
}
