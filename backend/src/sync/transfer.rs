//! Owner-bound transfer evidence shared by independent inventory nodes.
//!
//! Claims are observations, not ledger movements. DC and Store edges append
//! them independently; Cloud reconciles only claims with the same immutable
//! physical and shipment identity.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const INVENTORY_TRANSFER_CLAIM_V1: &str = "inventory.transfer_claim.v1";
pub const TRANSFER_CLAIM_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransferClaimKind {
    InTransit,
    Received,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TransferClaimPayload {
    pub schema_version: u32,
    pub claim_kind: TransferClaimKind,
    pub source_dc_id: Option<String>,
    pub destination_store_id: String,
    pub shipment_reference: Option<String>,
    pub epc: String,
    pub quantity: i64,
    pub sku_code: String,
    pub movement_group_id: Uuid,
    pub receipt_id: Option<Uuid>,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TransferClaimValidationError {
    #[error("transfer claim schema_version must be {TRANSFER_CLAIM_SCHEMA_VERSION}")]
    UnsupportedSchemaVersion,
    #[error("transfer claim {0} is required")]
    MissingField(&'static str),
    #[error("transfer claim {0} must be trimmed")]
    UntrimmedField(&'static str),
    #[error("transfer claim {0} must be uppercase")]
    NonCanonicalField(&'static str),
    #[error("transfer claim quantity must be exactly one per EPC")]
    InvalidQuantity,
    #[error("transfer claim movement_group_id must not be nil")]
    NilMovementGroup,
    #[error("IN_TRANSIT claim requires source_dc_id and cannot contain receipt_id")]
    InvalidInTransitIdentity,
    #[error("RECEIVED claim requires receipt_id")]
    MissingReceiptId,
}

impl TransferClaimPayload {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        claim_kind: TransferClaimKind,
        source_dc_id: Option<String>,
        destination_store_id: String,
        shipment_reference: Option<String>,
        epc: String,
        sku_code: String,
        movement_group_id: Uuid,
        receipt_id: Option<Uuid>,
        occurred_at: DateTime<Utc>,
    ) -> Result<Self, TransferClaimValidationError> {
        let payload = Self {
            schema_version: TRANSFER_CLAIM_SCHEMA_VERSION,
            claim_kind,
            source_dc_id: source_dc_id.map(|value| value.trim().to_owned()),
            destination_store_id: destination_store_id.trim().to_owned(),
            shipment_reference: shipment_reference.map(|value| value.trim().to_owned()),
            epc: epc.trim().to_ascii_uppercase(),
            quantity: 1,
            sku_code: sku_code.trim().to_ascii_uppercase(),
            movement_group_id,
            receipt_id,
            occurred_at,
        };
        payload.validate()?;
        Ok(payload)
    }

    pub fn validate(&self) -> Result<(), TransferClaimValidationError> {
        if self.schema_version != TRANSFER_CLAIM_SCHEMA_VERSION {
            return Err(TransferClaimValidationError::UnsupportedSchemaVersion);
        }
        validate_required("destination_store_id", &self.destination_store_id)?;
        validate_required("epc", &self.epc)?;
        validate_required("sku_code", &self.sku_code)?;
        validate_optional("source_dc_id", self.source_dc_id.as_deref())?;
        validate_optional("shipment_reference", self.shipment_reference.as_deref())?;
        if self.epc != self.epc.to_ascii_uppercase() {
            return Err(TransferClaimValidationError::NonCanonicalField("epc"));
        }
        if self.sku_code != self.sku_code.to_ascii_uppercase() {
            return Err(TransferClaimValidationError::NonCanonicalField("sku_code"));
        }
        if self.quantity != 1 {
            return Err(TransferClaimValidationError::InvalidQuantity);
        }
        if self.movement_group_id.is_nil() {
            return Err(TransferClaimValidationError::NilMovementGroup);
        }
        match self.claim_kind {
            TransferClaimKind::InTransit
                if self.source_dc_id.is_none() || self.receipt_id.is_some() =>
            {
                Err(TransferClaimValidationError::InvalidInTransitIdentity)
            }
            TransferClaimKind::Received if self.receipt_id.is_none() => {
                Err(TransferClaimValidationError::MissingReceiptId)
            }
            _ => Ok(()),
        }
    }
}

/// Cloud → origin node: the destination counted this EPC in, so let go of it.
///
/// No movement crosses a node boundary. A koli that left the Gudang stood in
/// the Gudang's in-transit pool for ever, even after the shop had received it,
/// because the two ledgers meet only in the claims and nothing told the origin
/// when they paired (inventory-fleet G3). Head office tells it now, once per
/// matched RECEIVED claim, and the origin writes its own movement out of
/// in-transit — its ledger is its own to write, as with an official count.
///
/// Sent only to a node whose heartbeat carries
/// [`crate::sync::workflow::GOODS_ROUTES_CAPABILITY`]: an unknown command
/// blocks a node's whole stream. Deliberately no `deny_unknown_fields`.
pub const INVENTORY_IN_TRANSIT_RELEASE_V1: &str = "inventory.in_transit.release.v1";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InTransitReleasePayload {
    /// The paired RECEIVED claim's event id: one release per receipt, and the
    /// key a replay is recognised by.
    pub release_id: Uuid,
    /// The site the goods left, as the origin's own IN_TRANSIT claim spelled
    /// it — the node this is addressed to. Named for the wire, like the claim
    /// it pairs with (`TransferClaimPayload`), and it holds a site of any kind
    /// since 0611: a shop's return leaves a shop, not a Gudang (0612).
    pub source_dc_id: String,
    /// The site that counted them in, as its claim spelled it. A site of any
    /// kind, named for the wire — see `source_dc_id`.
    pub destination_store_id: String,
    pub shipment_reference: Option<String>,
    pub koli_id: Uuid,
    pub epc: String,
    pub sku_code: String,
    /// The origin's own movement that put the EPC in transit.
    pub in_transit_movement_group_id: Uuid,
    /// When the destination received it.
    pub received_at: DateTime<Utc>,
}

impl InTransitReleasePayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.release_id.is_nil()
            || self.koli_id.is_nil()
            || self.in_transit_movement_group_id.is_nil()
        {
            return Err("in-transit release ids must not be nil".into());
        }
        for (field, value) in [
            ("source_dc_id", self.source_dc_id.as_str()),
            ("destination_store_id", self.destination_store_id.as_str()),
            ("epc", self.epc.as_str()),
            ("sku_code", self.sku_code.as_str()),
        ] {
            validate_required(field, value).map_err(|error| error.to_string())?;
        }
        validate_optional("shipment_reference", self.shipment_reference.as_deref())
            .map_err(|error| error.to_string())?;
        if self.epc != self.epc.to_ascii_uppercase()
            || self.sku_code != self.sku_code.to_ascii_uppercase()
        {
            return Err("in-transit release EPC and SKU must be uppercase".into());
        }
        if self.source_dc_id == self.destination_store_id {
            return Err("in-transit release source and destination must differ".into());
        }
        Ok(())
    }
}

pub fn parse_in_transit_release(
    value: &serde_json::Value,
) -> Result<InTransitReleasePayload, String> {
    let payload: InTransitReleasePayload =
        serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
    payload.validate()?;
    Ok(payload)
}

/// Cloud → origin node: the destination counted a delivery in and this EPC was
/// not among what it found. Book it Missing where it stands in transit.
///
/// Every shortage is Missing (owner, 1 Oct 2026), and a shortage at the door
/// is no different from one at a count: the piece left, nobody has it. The
/// origin moves it from its in-transit pool's on-hand to that pool's
/// `:missing` — its ledger is its own to write — and Inventory settles it
/// there (Found or written off). If the destination finds it later, the
/// release for that EPC takes it out of Missing first.
///
/// Sent only to a node whose heartbeat carries
/// [`crate::sync::workflow::TRANSIT_SHORT_CAPABILITY`].
pub const INVENTORY_IN_TRANSIT_SHORT_V1: &str = "inventory.in_transit.short.v1";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InTransitShortPayload {
    /// The origin's IN_TRANSIT claim for this EPC: one short per piece, and
    /// the key a replay is recognised by.
    pub short_id: Uuid,
    /// The site the goods left, as the origin's own claim spelled it.
    pub source_dc_id: String,
    pub destination_store_id: String,
    pub shipment_reference: Option<String>,
    pub epc: String,
    pub sku_code: String,
    /// The destination's receipt that did not find it.
    pub receipt_id: Uuid,
    pub received_at: DateTime<Utc>,
}

impl InTransitShortPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.short_id.is_nil() || self.receipt_id.is_nil() {
            return Err("in-transit short ids must not be nil".into());
        }
        for (field, value) in [
            ("source_dc_id", self.source_dc_id.as_str()),
            ("destination_store_id", self.destination_store_id.as_str()),
            ("epc", self.epc.as_str()),
            ("sku_code", self.sku_code.as_str()),
        ] {
            validate_required(field, value).map_err(|error| error.to_string())?;
        }
        validate_optional("shipment_reference", self.shipment_reference.as_deref())
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

pub fn parse_in_transit_short(value: &serde_json::Value) -> Result<InTransitShortPayload, String> {
    let payload: InTransitShortPayload =
        serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
    payload.validate()?;
    Ok(payload)
}

fn validate_required(field: &'static str, value: &str) -> Result<(), TransferClaimValidationError> {
    if value.trim().is_empty() {
        return Err(TransferClaimValidationError::MissingField(field));
    }
    if value != value.trim() {
        return Err(TransferClaimValidationError::UntrimmedField(field));
    }
    Ok(())
}

fn validate_optional(
    field: &'static str,
    value: Option<&str>,
) -> Result<(), TransferClaimValidationError> {
    if let Some(value) = value {
        validate_required(field, value)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructor_canonicalizes_reconciliation_identity() {
        let movement_group_id = Uuid::new_v4();
        let claim = TransferClaimPayload::new(
            TransferClaimKind::InTransit,
            Some(" dc-01 ".into()),
            " store-07 ".into(),
            Some(" shipment-42 ".into()),
            " e200-abc ".into(),
            " sku-1 ".into(),
            movement_group_id,
            None,
            Utc::now(),
        )
        .unwrap_or_else(|error| panic!("claim: {error}"));
        assert_eq!(claim.source_dc_id.as_deref(), Some("dc-01"));
        assert_eq!(claim.destination_store_id, "store-07");
        assert_eq!(claim.shipment_reference.as_deref(), Some("shipment-42"));
        assert_eq!(claim.epc, "E200-ABC");
        assert_eq!(claim.sku_code, "SKU-1");
    }

    #[test]
    fn received_requires_a_receipt_identity() {
        let error = TransferClaimPayload::new(
            TransferClaimKind::Received,
            Some("dc-01".into()),
            "store-07".into(),
            Some("shipment-42".into()),
            "EPC-1".into(),
            "SKU-1".into(),
            Uuid::new_v4(),
            None,
            Utc::now(),
        )
        .err()
        .unwrap_or_else(|| panic!("receipt identity must be required"));
        assert_eq!(error, TransferClaimValidationError::MissingReceiptId);
    }
}
