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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum MovementCause {
    Opening,
    StoreReceive,
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
    /// Head office settled what a delivery actually is: one anonymous
    /// quantity becomes several SKUs, and the goods stop being unidentified.
    Identification,
    /// Labels went onto the goods: a quantity of a SKU becomes that many
    /// individually tracked units, each with its own EPC.
    Tagging,
}

impl MovementCause {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Opening => "OPENING",
            Self::StoreReceive => "STORE_RECEIVE",
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
            Self::Identification => "IDENTIFICATION",
            Self::Tagging => "TAGGING",
        }
    }
}

impl fmt::Display for MovementCause {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for MovementCause {
    type Err = MovementError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "OPENING" => Ok(Self::Opening),
            "STORE_RECEIVE" => Ok(Self::StoreReceive),
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
            "IDENTIFICATION" => Ok(Self::Identification),
            "TAGGING" => Ok(Self::Tagging),
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
        MovementCause::Opening => matches!(
            (&line.from, &line.to),
            (
                Place::System {
                    place: SystemPlace::Opening
                },
                Place::Operational {
                    pool: OperationalPool::DcPendingUnidentified { .. },
                    state: InventoryState::Normal
                }
            )
        ),
        MovementCause::StoreReceive => matches!(
            (&line.from, &line.to),
            (
                Place::System {
                    place: SystemPlace::Opening
                },
                Place::Operational {
                    pool: OperationalPool::StoreWarehouse { .. },
                    state: InventoryState::Normal
                }
            )
        ),
        MovementCause::CountGain => {
            matches!(
                line.from,
                Place::System {
                    place: SystemPlace::CountGain
                }
            ) && on_hand(&line.to)
        }
        MovementCause::CountShortage => matches!(
            (&line.from, &line.to),
            (
                Place::Operational { pool: from, state: InventoryState::Normal },
                Place::Operational { pool: to, state: InventoryState::Missing }
            ) if from == to
        ),
        MovementCause::Found => matches!(
            (&line.from, &line.to),
            (
                Place::Operational { pool: from, state: InventoryState::Missing },
                Place::Operational { pool: to, state: InventoryState::Normal }
            ) if from == to
        ),
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
        MovementCause::CustomerReturn => matches!(
            (&line.from, &line.to),
            (
                Place::External {
                    place: ExternalPlace::Customer
                },
                Place::Operational {
                    pool: OperationalPool::StoreFloor { .. } | OperationalPool::StoreReject { .. },
                    state: InventoryState::Normal
                }
            )
        ),
        MovementCause::ReturnToDc => false,
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
        // A transformation, not a journey. The goods do not go anywhere; what
        // changes is what the system believes they are. Each half names a
        // different subject, so the two are joined through the identification
        // place rather than to each other.
        MovementCause::Identification => matches!(
            (&line.from, &line.to),
            (
                Place::Operational {
                    pool: OperationalPool::DcPendingUnidentified { .. },
                    state: InventoryState::Normal
                },
                Place::System {
                    place: SystemPlace::Identification
                }
            ) | (
                Place::System {
                    place: SystemPlace::Identification
                },
                Place::Operational {
                    pool: OperationalPool::DcPendingUntagged { .. },
                    state: InventoryState::Normal
                }
            )
        ),
        // The same shape one step later: a counted quantity becomes that many
        // individually tracked units, because each now carries a tag that
        // tells it apart from its neighbours.
        MovementCause::Tagging => matches!(
            (&line.from, &line.to),
            (
                Place::Operational {
                    pool: OperationalPool::DcPendingUntagged { .. },
                    state: InventoryState::Normal
                },
                Place::System {
                    place: SystemPlace::Identification
                }
            ) | (
                Place::System {
                    place: SystemPlace::Identification
                },
                Place::Operational {
                    pool: OperationalPool::DcWarehouse { .. },
                    state: InventoryState::Normal
                }
            )
        ),
    };
    if valid {
        Ok(())
    } else {
        Err(MovementError::InvalidTransition {
            cause,
            from: line.from.id(),
            to: line.to.id(),
        })
    }
}

fn normal_pool_transition(from: &OperationalPool, to: &OperationalPool) -> bool {
    use OperationalPool::*;
    match (from, to) {
        (DcPendingUnidentified { dc_id: a }, DcPendingUntagged { dc_id: b })
        | (DcPendingUntagged { dc_id: a }, DcWarehouse { dc_id: b })
        // Picking is a real move: a picker carries goods off the racks into
        // the outbound area. Nothing about the destination is settled by it.
        | (DcWarehouse { dc_id: a }, DcOutboundPicking { dc_id: b })
        // And goods can go back on the shelf when a pick is undone.
        | (DcOutboundPicking { dc_id: a }, DcWarehouse { dc_id: b }) => a == b,
        (
            source,
            DcOutboundPacked {
                dc_id: destination_dc,
                ..
            },
        ) if source.is_dc_fulfillment_source_for(destination_dc) => true,
        (
            DcOutboundPacked {
                dc_id: a,
                store_id: store_a,
            },
            DcOutboundShipment {
                dc_id: b,
                store_id: store_b,
            },
        )
        | (
            DcOutboundShipment {
                dc_id: a,
                store_id: store_a,
            },
            DcOutboundLoaded {
                dc_id: b,
                store_id: store_b,
            },
        )
        | (
            DcOutboundLoaded {
                dc_id: a,
                store_id: store_a,
            },
            DcOutboundInTransit {
                dc_id: b,
                store_id: store_b,
            },
        ) => a == b && store_a == store_b,
        (StoreWarehouse { store_id: a }, StoreFloor { store_id: b })
        | (StoreFloor { store_id: a }, StoreWarehouse { store_id: b })
        | (StoreWarehouse { store_id: a }, StoreReject { store_id: b })
        | (StoreFloor { store_id: a }, StoreReject { store_id: b }) => a == b,
        (DcRejectStore { dc_id: a, .. }, DcRejectDc { dc_id: b }) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(from: &str, to: &str) -> MovementLine {
        MovementLine {
            subject_id: SubjectId::new(),
            quantity: 1,
            from: from.parse().unwrap_or_else(|error| panic!("{error}")),
            to: to.parse().unwrap_or_else(|error| panic!("{error}")),
        }
    }

    #[test]
    fn dc_flow_dispatches_before_in_transit() {
        for (from, to) in [
            (
                "dc-01.pending.unidentified:on_hand",
                "dc-01.pending.untagged:on_hand",
            ),
            ("dc-01.pending.untagged:on_hand", "dc-01.warehouse:on_hand"),
            (
                "dc-01.warehouse:on_hand",
                "dc-01.outbound.packed.store-07:on_hand",
            ),
            (
                "dc-01.outbound.packed.store-07:on_hand",
                "dc-01.outbound.shipment.store-07:on_hand",
            ),
            (
                "dc-01.outbound.shipment.store-07:on_hand",
                "dc-01.outbound.loaded.store-07:on_hand",
            ),
            (
                "dc-01.outbound.loaded.store-07:on_hand",
                "dc-01.outbound.in-transit.store-07:on_hand",
            ),
        ] {
            assert!(
                validate_transition(MovementCause::NormalMove, &line(from, to)).is_ok(),
                "{from} -> {to}"
            );
        }
    }

    #[test]
    fn store_receives_directly_then_sells_offline() {
        assert!(validate_transition(
            MovementCause::StoreReceive,
            &line("system/opening", "store-07.warehouse:on_hand")
        )
        .is_ok());
        assert!(validate_transition(
            MovementCause::NormalMove,
            &line("store-07.warehouse:on_hand", "store-07.floor:on_hand")
        )
        .is_ok());
        assert!(validate_transition(
            MovementCause::Sale,
            &line("store-07.floor:on_hand", "external/customer")
        )
        .is_ok());
    }

    #[test]
    fn cross_dc_and_cross_store_transitions_are_rejected() {
        assert!(validate_transition(
            MovementCause::NormalMove,
            &line(
                "dc-01.warehouse:on_hand",
                "dc-02.outbound.picked.store-07:on_hand"
            )
        )
        .is_err());
        assert!(validate_transition(
            MovementCause::NormalMove,
            &line(
                "dc-01.outbound.shipment.store-07:on_hand",
                "dc-01.outbound.loaded.store-08:on_hand"
            )
        )
        .is_err());
    }
}
