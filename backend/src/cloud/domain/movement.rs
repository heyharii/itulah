//! The movement model — one for both nodes — and the CENTRE's transition rules.
//!
//! The model (the cause, the line, the command, the error, the subject kind) is
//! the Edge's: `edge::domain::inventory::movement`, which is also where the
//! browser contract is generated from. This module used to declare a second
//! copy of every one of them beside the shared pool, and the copies had already
//! drifted by the four causes only a node writes — `STORE_RECEIVE`,
//! `IDENTIFICATION`, `TAGGING`, `HANDED_OVER` — so a movement fact naming one
//! of them could not be read by the centre's own parser while the applier
//! (which imported the other copy) read it fine. One vocabulary, re-exported.
//!
//! What stays here is the one thing that is genuinely the centre's: WHICH
//! TRANSITIONS it accepts. Both ledgers write movements, and they write
//! different journeys — a node moves goods within its own site and books an
//! arrival from another site as its own opening, while the centre holds the
//! books of every site no node owns and books a cross-site journey as one
//! movement. The node's rules are
//! `edge::domain::inventory::movement::validate_transition`, enforced by
//! `NodeContext::authorize_line`; these are the centre's, enforced by the
//! writers below.

use super::{ExternalPlace, InventoryState, OperationalPool, Place, PoolRole, SystemPlace};

pub use crate::edge::{
    MovementCause, MovementCommand, MovementError, MovementLine, SubjectType,
};

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
                &line.to,
                Place::Operational {
                    pool,
                    state: InventoryState::Normal,
                } if matches!(pool.role(), PoolRole::Floor | PoolRole::Reject)
            )
        }
        // A shop's goods at rest, straight to a warehouse's stockroom or the
        // shop's return pool there: the centre holds both ledgers of a site
        // no node owns, so it books the journey as one movement. Which site
        // is a warehouse is data, checked where the allotment was raised.
        MovementCause::ReturnToWarehouse => match (&line.from, &line.to) {
            (
                Place::Operational {
                    pool: from,
                    state: InventoryState::Normal,
                },
                Place::Operational {
                    pool: to,
                    state: InventoryState::Normal,
                },
            ) => {
                matches!(
                    from.role(),
                    PoolRole::Stockroom | PoolRole::Floor | PoolRole::Reject
                ) && to.role().is_arrival()
                    && from.site_id() != to.site_id()
            }
            // A shop's return booked in at the cloud-run Gudang
            // (`cloud::dc::returns`): the shop is a node and lets go of the
            // goods in its own ledger, so this one books them in from
            // opening, as a DC server did — into the shop's return pool, or
            // the stockroom where the shop has none.
            (
                Place::System {
                    place: SystemPlace::Opening,
                },
                Place::Operational {
                    pool: to,
                    state: InventoryState::Normal,
                },
            ) => to.role().is_arrival(),
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
        // Four causes only a NODE writes, and the centre's routes never do:
        // booking a shop's delivery in, telling an anonymous quantity apart,
        // tagging it, and letting go of goods another site counted in. They
        // are in this vocabulary because they travel (a fact carries one), and
        // they are refused here rather than given rules, because a rule the
        // centre never applies is a second answer to a question only a node
        // asks — `edge::domain::inventory::movement::validate_transition` is
        // where those live and where `NodeContext::authorize_line` reads them.
        MovementCause::StoreReceive
        | MovementCause::Identification
        | MovementCause::Tagging
        | MovementCause::HandedOver => false,
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

/// Which pool may follow which, by ROLE (postgres `0610`).
///
/// The centre's own ledger holds every site no node owns, so unlike an edge
/// node it may book an arrival across sites: out of the in-transit stage at
/// the origin into the destination's stockroom or return pool. Everything else
/// stays at its site. What a site is — a warehouse or a shop — is never asked:
/// a rule that holds only where a pool exists needs no more.
fn normal_pool_transition(from: &OperationalPool, to: &OperationalPool) -> bool {
    use PoolRole::*;
    let same_site = from.site_id() == to.site_id();
    match (from.role(), to.role()) {
        // Arrival. A legacy leaf names its destination and must be believed;
        // the stage at the origin names none, and the allotment line the
        // movement references says where it was going.
        (InTransit, Stockroom | Return) if !same_site => from
            .outbound_destination()
            .is_none_or(|destination| destination == to.site_id()),
        // A shop's reject to its own return pool at the Gudang, as 0002
        // wired it: the legacy return pool names the shop it belongs to.
        (Reject, Return) if !same_site => {
            matches!(to, OperationalPool::DcRejectStore { store_id, .. } if store_id == from.site_id())
        }
        _ if !same_site => false,
        (Receiving, Receiving) => matches!(
            (from, to),
            (
                OperationalPool::DcPendingUnidentified { .. },
                OperationalPool::DcPendingUntagged { .. }
            )
        ),
        (Receiving, Stockroom) => matches!(from, OperationalPool::DcPendingUntagged { .. }),
        // Picking is a real move and commits to nothing; packing is where a
        // carton, and therefore a destination, is chosen. The legacy
        // per-store pick leaves take no new writes, but what stands in them
        // may still be packed.
        (Stockroom | Floor | Reject | Return, Picking) | (Picking, Stockroom) => {
            !from.is_legacy_leaf() && !to.is_legacy_leaf()
        }
        (Picking, Packed) if from.is_legacy_leaf() => same_destination(from, to),
        (_, Packed) => from.is_fulfillment_source_for(to.site_id()),
        // The centre never had a LOADED stage of its own; a shipment could
        // leave straight for in-transit, and still may.
        (Packed, Shipment) | (Shipment, Loaded) | (Loaded, InTransit) | (Shipment, InTransit) => {
            same_destination(from, to)
        }
        (Stockroom, Floor) | (Floor, Stockroom) | (Stockroom, Reject) | (Floor, Reject) => true,
        // Inspection of a return: good goods to the racks, damaged to reject.
        (Return, Stockroom) | (Return, Reject) => true,
        _ => false,
    }
}

/// A koli keeps its destination from stage to stage; nothing goes back into
/// a legacy leaf once it has left one.
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
    // The ids the shared line carries: re-exported here, so the tests name them
    // the same way a caller does.
    use crate::cloud::domain::{MovementGroupId, SiteId, SubjectId};
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
            ("dc.warehouse:on_hand", "dc.outbound.picking:on_hand"),
            ("dc.outbound.picking:on_hand", "dc.outbound.packed:on_hand"),
            ("dc.outbound.packed:on_hand", "dc.outbound.shipment:on_hand"),
            ("dc.outbound.shipment:on_hand", "dc.outbound.loaded:on_hand"),
            ("dc.outbound.loaded:on_hand", "dc.outbound.in-transit:on_hand"),
            ("dc.outbound.in-transit:on_hand", "store-07.warehouse:on_hand"),
            (
                "dc.outbound.picked.store-07:on_hand",
                "dc.outbound.packed.store-07:on_hand",
            ),
            (
                "dc.outbound.packed.store-07:on_hand",
                "dc.outbound.shipment.store-07:on_hand",
            ),
            (
                "dc.outbound.shipment.store-07:on_hand",
                "dc.outbound.in-transit.store-07:on_hand",
            ),
            (
                "dc.outbound.in-transit.store-07:on_hand",
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
            &line("dc.outbound.packed.store-07:missing", "system/lost")
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
