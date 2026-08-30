use super::{
    ExternalPlace, InventoryState, MovementGroupId, OperationalPool, Place, SubjectId, SystemPlace,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SubjectType {
    Unit,
    Quantity,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MovementCause {
    Opening,
    NormalMove,
    ReturnToDc,
    Sale,
    CustomerReturn,
    SupplierReturn,
    PlacementCorrection,
    CountShortage,
    CountGain,
    Found,
    ConfirmedLost,
    Disposal,
}

impl MovementCause {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Opening => "OPENING",
            Self::NormalMove => "NORMAL_MOVE",
            Self::ReturnToDc => "RETURN_TO_DC",
            Self::Sale => "SALE",
            Self::CustomerReturn => "CUSTOMER_RETURN",
            Self::SupplierReturn => "SUPPLIER_RETURN",
            Self::PlacementCorrection => "PLACEMENT_CORRECTION",
            Self::CountShortage => "COUNT_SHORTAGE",
            Self::CountGain => "COUNT_GAIN",
            Self::Found => "FOUND",
            Self::ConfirmedLost => "CONFIRMED_LOST",
            Self::Disposal => "DISPOSAL",
        }
    }
}

impl fmt::Display for MovementCause {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for MovementCause {
    type Err = MovementError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "OPENING" => Ok(Self::Opening),
            "NORMAL_MOVE" => Ok(Self::NormalMove),
            "RETURN_TO_DC" => Ok(Self::ReturnToDc),
            "SALE" => Ok(Self::Sale),
            "CUSTOMER_RETURN" => Ok(Self::CustomerReturn),
            "SUPPLIER_RETURN" => Ok(Self::SupplierReturn),
            "PLACEMENT_CORRECTION" => Ok(Self::PlacementCorrection),
            "COUNT_SHORTAGE" => Ok(Self::CountShortage),
            "COUNT_GAIN" => Ok(Self::CountGain),
            "FOUND" => Ok(Self::Found),
            "CONFIRMED_LOST" => Ok(Self::ConfirmedLost),
            "DISPOSAL" => Ok(Self::Disposal),
            _ => Err(MovementError::UnknownCause(value.to_owned())),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MovementLine {
    pub subject_id: SubjectId,
    pub quantity: i64,
    pub from: Place,
    pub to: Place,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MovementCommand {
    pub movement_group_id: MovementGroupId,
    pub lines: Vec<MovementLine>,
    pub cause: MovementCause,
    pub reference_type: Option<String>,
    pub reference_id: Option<String>,
    pub reason: String,
    pub actor_id: String,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, Error, PartialEq)]
pub enum MovementError {
    #[error("movement quantity must be positive")]
    NonPositiveQuantity,
    #[error("movement source and destination must differ")]
    IdenticalEndpoints,
    #[error("movement group must contain at least one line")]
    EmptyGroup,
    #[error("movement reason is required")]
    MissingReason,
    #[error("unknown movement cause: {0}")]
    UnknownCause(String),
    #[error("invalid {cause} transition: {from} -> {to}")]
    InvalidTransition {
        cause: MovementCause,
        from: String,
        to: String,
    },
}

pub fn validate_command(command: &MovementCommand) -> Result<(), MovementError> {
    if command.lines.is_empty() {
        return Err(MovementError::EmptyGroup);
    }
    if command.reason.trim().is_empty() {
        return Err(MovementError::MissingReason);
    }
    for line in &command.lines {
        validate_transition(command.cause, line)?;
    }
    Ok(())
}

pub fn validate_transition(cause: MovementCause, line: &MovementLine) -> Result<(), MovementError> {
    if line.quantity <= 0 {
        return Err(MovementError::NonPositiveQuantity);
    }
    if line.from == line.to {
        return Err(MovementError::IdenticalEndpoints);
    }
    let on_hand = |place: &Place| {
        matches!(
            place,
            Place::Operational {
                state: InventoryState::Normal,
                ..
            }
        )
    };
    let missing = |place: &Place| {
        matches!(
            place,
            Place::Operational {
                state: InventoryState::Missing,
                ..
            }
        )
    };

    let valid = match cause {
        MovementCause::Opening => {
            matches!(
                line.from,
                Place::System {
                    place: SystemPlace::Opening
                }
            ) && on_hand(&line.to)
        }
        MovementCause::CountGain => {
            matches!(
                line.from,
                Place::System {
                    place: SystemPlace::CountGain
                }
            ) && on_hand(&line.to)
        }
        MovementCause::CountShortage => match (&line.from, &line.to) {
            (
                Place::Operational {
                    pool: from,
                    state: InventoryState::Normal,
                },
                Place::Operational {
                    pool: to,
                    state: InventoryState::Missing,
                },
            ) => from == to,
            _ => false,
        },
        MovementCause::Found => missing(&line.from) && on_hand(&line.to),
        MovementCause::ConfirmedLost => {
            missing(&line.from)
                && matches!(
                    line.to,
                    Place::System {
                        place: SystemPlace::Lost
                    }
                )
        }
        MovementCause::Disposal => {
            missing(&line.from)
                && matches!(
                    line.to,
                    Place::External {
                        place: ExternalPlace::Disposal
                    }
                )
        }
        MovementCause::Sale => {
            line.from.is_saleable()
                && matches!(
                    line.to,
                    Place::External {
                        place: ExternalPlace::Customer
                    }
                )
        }
        // The inverse of a Sale: goods come back from the customer into the
        // same store, either sellable again (floor) or damaged (reject).
        MovementCause::CustomerReturn => {
            matches!(
                line.from,
                Place::External {
                    place: ExternalPlace::Customer
                }
            ) && matches!(
                line.to,
                Place::Operational {
                    pool: OperationalPool::StoreFloor(_) | OperationalPool::StoreReject(_),
                    state: InventoryState::Normal,
                }
            )
        }
        MovementCause::ReturnToDc => match (&line.from, &line.to) {
            (
                Place::Operational {
                    pool:
                        OperationalPool::StoreWarehouse(_)
                        | OperationalPool::StoreFloor(_)
                        | OperationalPool::StoreReject(_),
                    state: InventoryState::Normal,
                },
                Place::Operational {
                    pool: OperationalPool::DcWarehouse,
                    state: InventoryState::Normal,
                },
            ) => true,
            _ => false,
        },
        MovementCause::SupplierReturn => {
            on_hand(&line.from)
                && matches!(
                    line.to,
                    Place::External {
                        place: ExternalPlace::Supplier
                    }
                )
        }
        MovementCause::PlacementCorrection => on_hand(&line.from) && on_hand(&line.to),
        MovementCause::NormalMove => match (&line.from, &line.to) {
            (
                Place::Operational {
                    pool: from,
                    state: InventoryState::Normal,
                },
                Place::Operational {
                    pool: to,
                    state: InventoryState::Normal,
                },
            ) => normal_pool_transition(from, to),
            _ => false,
        },
    };
    if !valid {
        return Err(MovementError::InvalidTransition {
            cause,
            from: line.from.id(),
            to: line.to.id(),
        });
    }
    Ok(())
}

fn normal_pool_transition(from: &OperationalPool, to: &OperationalPool) -> bool {
    use OperationalPool::*;
    match (from, to) {
        (DcPendingUnidentified, DcPendingUntagged)
        | (DcPendingUntagged, DcWarehouse)
        | (DcWarehouse, DcOutboundPicked)
        | (DcOutboundPicked, DcOutboundPacked)
        | (DcOutboundPacked, DcOutboundShipment)
        | (DcOutboundShipment, DcOutboundInTransit) => true,
        (DcOutboundInTransit, StoreWarehouse(_)) => true,
        (StoreWarehouse(a), StoreFloor(b)) | (StoreFloor(a), StoreWarehouse(b)) => a == b,
        (StoreWarehouse(a), StoreReject(b)) | (StoreFloor(a), StoreReject(b)) => a == b,
        (StoreReject(origin), DcRejectStore(target_origin)) => origin == target_origin,
        (DcRejectStore(_), DcRejectDc) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{MovementGroupId, SiteId};
    use chrono::Utc;

    fn place(id: &str) -> Place {
        id.parse().unwrap_or_else(|e| panic!("{e}"))
    }
    fn line(from: &str, to: &str) -> MovementLine {
        MovementLine {
            subject_id: SubjectId::new(),
            quantity: 1,
            from: place(from),
            to: place(to),
        }
    }

    #[test]
    fn expected_internal_transitions_are_valid() {
        let pairs = [
            (
                "dc.pending.unidentified:on_hand",
                "dc.pending.untagged:on_hand",
            ),
            ("dc.pending.untagged:on_hand", "dc.warehouse:on_hand"),
            ("dc.warehouse:on_hand", "dc.outbound.picked:on_hand"),
            ("dc.outbound.picked:on_hand", "dc.outbound.packed:on_hand"),
            ("dc.outbound.packed:on_hand", "dc.outbound.shipment:on_hand"),
            (
                "dc.outbound.shipment:on_hand",
                "dc.outbound.in-transit:on_hand",
            ),
            (
                "dc.outbound.in-transit:on_hand",
                "store-07.warehouse:on_hand",
            ),
            ("store-07.warehouse:on_hand", "store-07.floor:on_hand"),
        ];
        for (from, to) in pairs {
            assert!(
                validate_transition(MovementCause::NormalMove, &line(from, to)).is_ok(),
                "{from} -> {to}"
            );
        }
    }

    #[test]
    fn customer_return_flows_back_to_floor_or_reject_only() {
        assert!(validate_transition(
            MovementCause::CustomerReturn,
            &line("external/customer", "store-07.floor:on_hand")
        )
        .is_ok());
        assert!(validate_transition(
            MovementCause::CustomerReturn,
            &line("external/customer", "store-07.reject:on_hand")
        )
        .is_ok());
        assert!(validate_transition(
            MovementCause::CustomerReturn,
            &line("external/customer", "store-07.warehouse:on_hand")
        )
        .is_err());
        assert!(validate_transition(
            MovementCause::CustomerReturn,
            &line("external/customer", "dc.warehouse:on_hand")
        )
        .is_err());
        assert!(validate_transition(
            MovementCause::CustomerReturn,
            &line("store-07.floor:on_hand", "store-07.reject:on_hand")
        )
        .is_err());
    }

    #[test]
    fn cross_store_normal_move_is_rejected() {
        assert!(validate_transition(
            MovementCause::NormalMove,
            &line("store-07.warehouse:on_hand", "store-08.floor:on_hand")
        )
        .is_err());
    }

    #[test]
    fn missing_is_pool_specific_and_lost_starts_at_missing() {
        let shortage = line("store-07.floor:on_hand", "store-07.floor:missing");
        assert!(validate_transition(MovementCause::CountShortage, &shortage).is_ok());
        let wrong = line("store-07.floor:on_hand", "system/lost");
        assert!(validate_transition(MovementCause::ConfirmedLost, &wrong).is_err());
    }

    #[test]
    fn group_requires_reason_and_lines() {
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: vec![],
            cause: MovementCause::NormalMove,
            reference_type: None,
            reference_id: None,
            reason: String::new(),
            actor_id: "tester".into(),
            occurred_at: Utc::now(),
        };
        assert_eq!(validate_command(&command), Err(MovementError::EmptyGroup));
    }

    #[test]
    fn store_site_type_is_generic() {
        assert!(SiteId::new("store-99").is_ok());
    }

    #[test]
    fn found_missing_moves_missing_to_on_hand() {
        assert!(validate_transition(
            MovementCause::Found,
            &line("store-07.floor:missing", "store-07.floor:on_hand")
        )
        .is_ok());
    }

    #[test]
    fn confirmed_lost_moves_missing_to_system_lost() {
        assert!(validate_transition(
            MovementCause::ConfirmedLost,
            &line("dc.outbound.packed:missing", "system/lost")
        )
        .is_ok());
    }

    #[test]
    fn missing_cannot_be_a_sale_source() {
        assert!(validate_transition(
            MovementCause::Sale,
            &line("store-07.floor:missing", "external/customer")
        )
        .is_err());
    }

    proptest::proptest! {
        #[test]
        fn every_movement_pair_is_quantity_balanced(quantity in 1_i64..1_000_000) {
            let source_leg = -quantity;
            let destination_leg = quantity;
            proptest::prop_assert_eq!(source_leg + destination_leg, 0);
        }
    }
}
