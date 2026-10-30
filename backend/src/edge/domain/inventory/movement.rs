use super::{
    ExternalPlace, InventoryState, MovementGroupId, OperationalPool, Place, PoolRole, SubjectId,
    SystemPlace,
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
    /// A store's goods booked in at the warehouse they were returned to, into
    /// that store's return pool. The half of a return the receiving site
    /// writes; the store's own half is its outbound path. Written
    /// `RETURN_TO_WAREHOUSE`; `RETURN_TO_DC`, its old spelling, still reads.
    #[serde(alias = "RETURN_TO_DC")]
    ReturnToWarehouse,
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
    /// The site the goods left lets go of them, because the site they went
    /// to has counted them in (inventory-fleet G3): out of in-transit, to
    /// `system/handed_over`. Written only on head office's word
    /// (`inventory.in_transit.release.v1`), never by a hand at the site.
    HandedOver,
    /// A replacement server booking the stock its store already holds at
    /// head office, under the subject ids head office knows (C001, 30 Oct
    /// 2026). Written once, on head office's answer, never by a hand.
    StockHandover,
}

impl MovementCause {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Opening => "OPENING",
            Self::StoreReceive => "STORE_RECEIVE",
            Self::NormalMove => "NORMAL_MOVE",
            Self::ReturnToWarehouse => "RETURN_TO_WAREHOUSE",
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
            Self::HandedOver => "HANDED_OVER",
            Self::StockHandover => "STOCK_HANDOVER",
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
            "RETURN_TO_WAREHOUSE" | "RETURN_TO_DC" => Ok(Self::ReturnToWarehouse),
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
            "HANDED_OVER" => Ok(Self::HandedOver),
            "STOCK_HANDOVER" => Ok(Self::StockHandover),
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
        // Goods from another of our sites, booked in where they arrive: a
        // shop's stockroom. The other ledger let go of them; this one picks
        // them up, and the two meet only in the claims (`sync::transfer`).
        MovementCause::StoreReceive => matches!(
            (&line.from, &line.to),
            (
                Place::System {
                    place: SystemPlace::Opening
                },
                Place::Operational {
                    pool: OperationalPool::Stockroom { .. },
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
        // The floor, or the stockroom of the same site (owner, 23 Oct 2026):
        // a tag the till reads sells from wherever this shop holds it.
        MovementCause::Sale => {
            line.from.is_sale_source()
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
                    pool: OperationalPool::StoreFloor { .. } | OperationalPool::Reject { .. },
                    state: InventoryState::Normal
                }
            )
        ),
        // The warehouse's half of a store's return: booked in, from the same
        // counterparty a shop receives from, into that store's return pool.
        // Inspection is the next movement, never this one.
        MovementCause::ReturnToWarehouse => {
            matches!(
                line.from,
                Place::System {
                    place: SystemPlace::Opening
                }
            ) && matches!(
                &line.to,
                Place::Operational {
                    pool,
                    state: InventoryState::Normal,
                } if pool.role() == PoolRole::Return
            )
        }
        // Custody passed at the other site's door: what stood in transit at
        // this one — the stage at the origin, or a legacy leaf — leaves it.
        MovementCause::HandedOver => {
            matches!(
                &line.from,
                Place::Operational {
                    pool,
                    state: InventoryState::Normal,
                } if pool.role() == PoolRole::InTransit
            ) && matches!(
                line.to,
                Place::System {
                    place: SystemPlace::HandedOver
                }
            )
        }
        // The store's stock as head office last saw it, wherever it stood —
        // shelf, pocket or Missing — booked by a server that replaced the one
        // that held it.
        MovementCause::StockHandover => {
            matches!(
                line.from,
                Place::System {
                    place: SystemPlace::Opening
                }
            ) && matches!(line.to, Place::Operational { .. })
        }
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
        //
        // Identified goods are stock at once, a unit per EPC in the warehouse
        // (owner, 28 Sep 2026). Into Untagged is how an older build
        // identified them, still read when its movements are replayed.
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
                    pool: OperationalPool::Stockroom { .. }
                        | OperationalPool::DcPendingUntagged { .. },
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
                    pool: OperationalPool::Stockroom { .. },
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

/// Which pool may follow which, by ROLE, at one site.
///
/// Every normal move stays at its site: a node owns only its own pools, and
/// goods reach another site through the outbound stages and the claims, never
/// through one movement. What the site is — a warehouse or a shop — is not
/// asked: a rule that holds only where a pool exists needs no more, and which
/// pools exist is data (postgres `0610`).
fn normal_pool_transition(from: &OperationalPool, to: &OperationalPool) -> bool {
    use PoolRole::*;
    if from.site_id() != to.site_id() {
        return false;
    }
    match (from.role(), to.role()) {
        // Receiving: identified, then tagged, then onto the racks.
        (Receiving, Receiving) => matches!(
            (from, to),
            (
                OperationalPool::DcPendingUnidentified { .. },
                OperationalPool::DcPendingUntagged { .. }
            )
        ),
        (Receiving, Stockroom) => matches!(from, OperationalPool::DcPendingUntagged { .. }),
        // Picking is a real move: a picker carries goods into the outbound
        // area. Nothing about the destination is settled by it, so it may
        // start anywhere goods rest — a shop picks a return off its floor —
        // and a pick undone goes back to the stockroom. The legacy
        // per-destination pick leaves take no new writes.
        //
        // The Gudang takes its own work back before anything leaves (a move
        // back, as `cloud::dc::move_back`): a pick undone goes back to the
        // room it was fetched from, and a carton opened again puts its pieces
        // back in the pick area. Nothing ever goes back into a legacy leaf.
        (Stockroom | Floor | Reject | Return, Picking)
        | (Picking, Stockroom | Floor | Reject | Return)
        | (Packed, Picking) => !from.is_legacy_leaf() && !to.is_legacy_leaf(),
        // Packing binds goods to a koli, and the koli to a destination.
        (_, Packed) => from.is_fulfillment_source_for(to.site_id()),
        (Packed, Shipment) | (Shipment, Loaded) | (Loaded, InTransit) => same_destination(from, to),
        // Inside a site's own rooms.
        (Stockroom, Floor) | (Floor, Stockroom) | (Stockroom, Reject) | (Floor, Reject) => true,
        // Inspection of a store's return: good goods to the racks, damaged
        // goods to reject.
        (Return, Stockroom) | (Return, Reject) => true,
        _ => false,
    }
}

/// A koli keeps its destination from stage to stage. A legacy leaf spells it
/// in the pool id, and a koli packed under an older build may go on to the
/// stage at its origin (whose destination is on the koli); nothing ever goes
/// back into a legacy leaf.
fn same_destination(from: &OperationalPool, to: &OperationalPool) -> bool {
    match (from.outbound_destination(), to.outbound_destination()) {
        (Some(from), Some(to)) => from == to,
        (_, None) => true,
        (None, Some(_)) => false,
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
