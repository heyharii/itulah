//! The one place fulfillment arithmetic lives.
//!
//! Before this module the fleet held **six** independent spellings of "how much
//! is still committed" — four in read paths and two in the write guards that
//! decide whether an allotment may be raised at all. All six released at pick,
//! which stopped being what the warehouse does when picking became
//! destination-less: a picker fetches a SKU and a number, and which piece
//! serves which shop is settled at the packing bench.
//!
//! Everything — pool balances, availability, dashboards, sync, the status on
//! the allotment itself — reads this module or the view built on it. A screen
//! that does the subtraction itself is the bug this exists to prevent.
//!
//! The model is frozen in `docs/allotment-v1.md` — that document owns the
//! business semantics, `DISTRIBUTION-V1-FREEZE.md` owns execution semantics,
//! and this module is the implementation. **Where they disagree, work stops
//! and the difference is reconciled**: a business rule does not change because
//! the code currently does something else.
//!
//! # Seven stages, and one thing that is not a stage
//!
//! ```text
//! TO_PACK · AT_PACKED · AT_SHIPMENT · AT_LOADED · AT_IN_TRANSIT   still owed
//! RECEIVED · CLOSED_SHORT                                          terminal
//! ```
//!
//! Every event moves pieces from one place to another, so the places always add
//! up to what MD promised. But **not every piece that is still owed sits at a
//! stage**, and that is the one rule people get wrong:
//!
//! ```text
//! Shipment handed over 100, the shop finds 98
//!
//! INVENTORY                      ALLOTMENT
//! Store Warehouse                Received            98
//!   Normal   98                  Receiving gap        2
//!   Missing   2                  To Receive           2
//! ```
//!
//! Custody passed at the door, so the journey is over and `At In Transit` is
//! nought. The two shirts are not received either. They are a **receiving
//! gap**: the allotment's reference to an open Inventory case at the
//! destination, counted in the arithmetic because `To Receive` would otherwise
//! have no explanation — and never called a fulfillment stage, because it is
//! not a leg of the journey.
//!
//! # Counters rise; nothing is ever edited down
//!
//! Each counter is an append-only total — `packed_total` is everything ever
//! packed against this line, not what is sitting in cartons now. A correction
//! is its own counter (`unpacked_total` against `packed_total`) rather than a
//! decrement, because a decrement erases the fact that the reversal happened,
//! and two different histories can then satisfy the same row.
//!
//! # Loss is not fulfillment, and it is Inventory's word
//!
//! A loss is settled by **Inventory**, not by MD, and it returns the demand to
//! `TO_PACK` — the shop is still owed those pieces, so by default Distribution
//! packs replacements. MD's only say is to give up instead: Close Short, and
//! only ever out of `TO_PACK`.
//!
//! Which is why `closed_short_total + packed_total <= original_alloted` is not
//! an invariant: 100 packed, 2 lost and 2 replaced is 102 against 100, and it
//! is an ordinary ending. What holds is that no place may go negative.
//!
//! # What this module does not know
//!
//! Where the goods are now, and what condition they are in. `Received 100` is a
//! statement about the past — a hundred pieces reached the shop — not a claim
//! that a hundred normal pieces are on its shelves today. Damaged stock sits in
//! the `Store Reject` pool and is Inventory's to read; this module has no
//! reject counter and never reopens a finished allotment because one appeared.

use super::AllotmentStatus;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Everything that has ever happened to one allotment line, as totals that
/// only rise.
///
/// One line is the grain. A store, a SKU, a pool, a site and the whole fleet
/// are each a SUM over these, never a formula of their own.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub struct FulfillmentCounters {
    /// What MD decided. Fixed when the allotment goes ACTIVE; never moves.
    pub original_alloted: i64,
    /// Pieces bound to the destination store by going into a carton. This is
    /// the only point at which a physical unit acquires a destination.
    pub packed_total: i64,
    /// Pieces taken back out of a carton and returned to the picking area.
    pub unpacked_total: i64,
    pub shipment_total: i64,
    /// Cartons pulled back out of a shipment.
    pub unshipped_total: i64,
    pub loaded_total: i64,
    /// Taken off the vehicle again, which is only possible before it leaves.
    pub unloaded_total: i64,
    pub in_transit_total: i64,
    /// Custody actually passed to the shop at the door.
    ///
    /// Derived from the koli genuinely put on the shop's floor, **never from
    /// the manifest**: nine koli unloaded and a tenth still on the lorry means
    /// the tenth never changed hands and is still the DC's problem.
    pub handed_over_total: i64,
    /// Pieces the shop actually found. Damaged goods count — they arrived; the
    /// `Store Reject` pool is where their condition is recorded, and that is
    /// Inventory's ledger, not this one.
    ///
    /// Two things raise it and only two: the shop's `Confirm Receive`, and
    /// Inventory's `Found` when it settles a receiving gap. The second is not
    /// a second receipt — custody passed at the door, and what was missing was
    /// the proof, so the shop is not asked to confirm the same goods twice. A
    /// `Found` against any other Missing settles stock and leaves this alone.
    pub received_total: i64,
    /// Settled by Inventory as gone while bound to a store inside the DC.
    pub lost_packed_total: i64,
    /// Settled by Inventory as gone on the road, never handed over.
    pub lost_in_transit_total: i64,
    /// Settled by Inventory as gone at the destination: a receiving gap that
    /// will not be found.
    pub lost_at_store_total: i64,
    /// Demand MD gave up on. Moves no stock, and only ever comes out of
    /// `TO_PACK`.
    pub closed_short_total: i64,
}

impl FulfillmentCounters {
    /// Sum two lines' counters, so a store, a SKU or the fleet is the same
    /// arithmetic as one line rather than a second implementation of it.
    pub fn merge(self, other: Self) -> Self {
        Self {
            original_alloted: self.original_alloted + other.original_alloted,
            packed_total: self.packed_total + other.packed_total,
            unpacked_total: self.unpacked_total + other.unpacked_total,
            shipment_total: self.shipment_total + other.shipment_total,
            unshipped_total: self.unshipped_total + other.unshipped_total,
            loaded_total: self.loaded_total + other.loaded_total,
            unloaded_total: self.unloaded_total + other.unloaded_total,
            in_transit_total: self.in_transit_total + other.in_transit_total,
            handed_over_total: self.handed_over_total + other.handed_over_total,
            received_total: self.received_total + other.received_total,
            lost_packed_total: self.lost_packed_total + other.lost_packed_total,
            lost_in_transit_total: self.lost_in_transit_total + other.lost_in_transit_total,
            lost_at_store_total: self.lost_at_store_total + other.lost_at_store_total,
            closed_short_total: self.closed_short_total + other.closed_short_total,
        }
    }
}

/// The three states an allotment can be in, and the only three.
///
/// `IN_PROGRESS`, `DC_COMPLETED`, `CANCELLED` and `REJECTED` are legacy rows.
/// They are mapped on the way out of the database and never written again:
/// three of them said something about the DC's progress rather than about
/// whether the shop got its goods, and a status that goes terminal at dispatch
/// is a status that lies for the length of a journey.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FulfillmentStatus {
    Active,
    Completed,
    Closed,
}

impl FulfillmentStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Completed => "COMPLETED",
            Self::Closed => "CLOSED",
        }
    }

    /// What a row written before this module means now.
    ///
    /// Everything that was not terminal, and everything that was terminal only
    /// from the DC's point of view, is simply live work; the counters decide
    /// the rest, so this is a floor rather than an answer.
    pub fn from_legacy(stored: &str) -> Self {
        match stored {
            "COMPLETED" => Self::Completed,
            "CANCELLED" | "REJECTED" | "CLOSED" => Self::Closed,
            _ => Self::Active,
        }
    }
}

impl From<FulfillmentStatus> for AllotmentStatus {
    fn from(value: FulfillmentStatus) -> Self {
        match value {
            FulfillmentStatus::Active => Self::Active,
            FulfillmentStatus::Completed => Self::Completed,
            // The legacy enum has no CLOSED; `Cancelled` is the nearest rung
            // it owns. Callers that matter read `FulfillmentStatus`.
            FulfillmentStatus::Closed => Self::Cancelled,
        }
    }
}

/// Where the pieces are now, computed once from the counters.
///
/// The eight fields are a partition: each piece MD promised is counted in
/// exactly one of them, and they sum to `original_alloted`. Seven are
/// fulfillment stages; `receiving_gap_qty` is not one, and is documented at
/// the field.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Fulfillment {
    /// Not yet bound to a store through packing, and not given up on. This is
    /// the bench's work list and the only figure that blocks source stock.
    pub to_pack_qty: i64,
    pub at_packed: i64,
    pub at_shipment: i64,
    pub at_loaded: i64,
    pub at_in_transit: i64,
    /// Handed over at the shop's door and not found there. **Not a stage** —
    /// the journey is over and the goods are the shop's custody — but still
    /// owed, and still the shop's to receive if Inventory finds them.
    ///
    /// The shop shows this as `Missing`; the allotment shows it as a receiving
    /// difference. Never shown to anybody as `unaccounted`.
    pub receiving_gap_qty: i64,
    pub received: i64,
    pub closed_short: i64,
    /// Not yet in the shop's hands, and not given up on. MD's number, and the
    /// sum of the six live figures above.
    pub to_receive_qty: i64,
    pub status: FulfillmentStatus,
}

impl Fulfillment {
    /// What MD is shown in place of Shipment and Loaded.
    ///
    /// `Loaded` is real in the domain and Operations reads it on its own, but
    /// to a merchandiser "sealed in the DC" and "on the lorry that has not
    /// left" are the same answer. Folded rather than dropped, so the row still
    /// adds up to `to_receive_qty`.
    pub const fn md_shipment(&self) -> i64 {
        self.at_shipment + self.at_loaded
    }

    /// Whether the DC has nothing left to do for this line. A milestone, never
    /// a status.
    ///
    /// Stated over the stages rather than over `in_transit_total`, which a
    /// loss pushes past `original_alloted`: the moment Inventory settles a
    /// loss, the cumulative figure still reads "all of it departed" while the
    /// bench has just been handed two more to pack.
    pub const fn dc_fulfilled(&self) -> bool {
        self.to_pack_qty == 0 && self.at_packed == 0 && self.at_shipment == 0 && self.at_loaded == 0
    }

    /// Project the counters, refusing to answer rather than answering wrongly.
    ///
    /// Every place is checked for going negative, and the conservation
    /// identity is asserted for real — not behind `debug_assert!`, which is
    /// compiled out of exactly the build that serves the shops.
    pub fn project(counters: FulfillmentCounters) -> Result<Self, FulfillmentError> {
        let FulfillmentCounters {
            original_alloted,
            packed_total,
            unpacked_total,
            shipment_total,
            unshipped_total,
            loaded_total,
            unloaded_total,
            in_transit_total,
            handed_over_total,
            received_total,
            lost_packed_total,
            lost_in_transit_total,
            lost_at_store_total,
            closed_short_total,
        } = counters;

        for (name, value) in [
            ("original_alloted", original_alloted),
            ("packed_total", packed_total),
            ("unpacked_total", unpacked_total),
            ("shipment_total", shipment_total),
            ("unshipped_total", unshipped_total),
            ("loaded_total", loaded_total),
            ("unloaded_total", unloaded_total),
            ("in_transit_total", in_transit_total),
            ("handed_over_total", handed_over_total),
            ("received_total", received_total),
            ("lost_packed_total", lost_packed_total),
            ("lost_in_transit_total", lost_in_transit_total),
            ("lost_at_store_total", lost_at_store_total),
            ("closed_short_total", closed_short_total),
        ] {
            if value < 0 {
                return Err(FulfillmentError::NegativeCounter(name));
            }
        }

        // Each place is everything that ever entered it less everything that
        // ever left it, in both directions. Written out rather than derived
        // from a ladder inequality, because with reversal, loss and a custody
        // handover in the model there is no single ordering to subtract along.
        let lost_total = lost_packed_total + lost_in_transit_total + lost_at_store_total;
        let owed_to_the_bench = original_alloted + unpacked_total + lost_total;
        let packable = owed_to_the_bench - packed_total;
        if packable < 0 {
            return Err(FulfillmentError::PlaceWentNegative {
                place: "to_pack",
                value: packable - closed_short_total,
            });
        }
        // Not `original - packed - closed_short`: a replacement is packed
        // against demand a loss returned, so packed and closed short may
        // exceed what was allotted between them. What actually holds is that
        // MD cannot give up what the bench is not holding.
        if closed_short_total > packable {
            return Err(FulfillmentError::ClosedShortExceedsToPack {
                closed: closed_short_total,
                open: packable,
            });
        }

        let result = Self {
            to_pack_qty: packable - closed_short_total,
            at_packed: packed_total + unshipped_total
                - unpacked_total
                - shipment_total
                - lost_packed_total,
            at_shipment: shipment_total + unloaded_total - unshipped_total - loaded_total,
            at_loaded: loaded_total - unloaded_total - in_transit_total,
            at_in_transit: in_transit_total - handed_over_total - lost_in_transit_total,
            receiving_gap_qty: handed_over_total - received_total - lost_at_store_total,
            received: received_total,
            closed_short: closed_short_total,
            // The shop's number, and deliberately not a sum of the places:
            // stated independently, it is what the identity below checks the
            // places against.
            to_receive_qty: original_alloted - received_total - closed_short_total,
            status: FulfillmentStatus::Active,
        };

        for (place, value) in [
            ("at_packed", result.at_packed),
            ("at_shipment", result.at_shipment),
            ("at_loaded", result.at_loaded),
            ("at_in_transit", result.at_in_transit),
            ("receiving_gap", result.receiving_gap_qty),
        ] {
            if value < 0 {
                return Err(FulfillmentError::PlaceWentNegative { place, value });
            }
        }

        let parts = result.to_pack_qty
            + result.at_packed
            + result.at_shipment
            + result.at_loaded
            + result.at_in_transit
            + result.receiving_gap_qty
            + result.received
            + result.closed_short;
        if parts != original_alloted {
            return Err(FulfillmentError::Unbalanced {
                parts,
                original: original_alloted,
            });
        }

        Ok(Self {
            status: status_of(result.to_receive_qty, closed_short_total),
            ..result
        })
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum FulfillmentError {
    #[error("fulfillment counters cannot be negative: {0}")]
    NegativeCounter(&'static str),
    #[error("more has left {place} than ever entered it: {value}")]
    PlaceWentNegative { place: &'static str, value: i64 },
    #[error("closed short ({closed}) exceeds what is still to pack ({open})")]
    ClosedShortExceedsToPack { closed: i64, open: i64 },
    #[error("fulfillment arithmetic does not balance: {parts} against {original}")]
    Unbalanced { parts: i64, original: i64 },
}

/// Where an allotment stands, from the counters alone.
///
/// Store receipt and Close Short are the only two endings, so the whole of the
/// question is whether anything is still owed. An unresolved receiving gap
/// needs no arm of its own: it is part of `to_receive_qty` by construction, so
/// a line waiting on Inventory is ACTIVE without being asked.
const fn status_of(to_receive_qty: i64, closed_short_total: i64) -> FulfillmentStatus {
    if to_receive_qty > 0 {
        FulfillmentStatus::Active
    } else if closed_short_total > 0 {
        FulfillmentStatus::Closed
    } else {
        FulfillmentStatus::Completed
    }
}

/// What a shelf can still promise, and what it has promised past its means.
///
/// **Both sides must be measured over the same scope** — one site and one SKU,
/// with the supply being every pool the commitment can be served out of. A
/// commitment raised against the warehouse is served from the warehouse *or*
/// from the picking area, because a picker moving goods between the two
/// settles nothing about who they are for. Subtracting a site-wide commitment
/// from one shelf's stock reports a shortage the moment the pickers do their
/// job, and subtracting the same commitment from each of three pools reports
/// it three times.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Availability {
    pub eligible_supply: i64,
    pub blocking_commitment: i64,
    pub available_qty: i64,
    pub shortfall_qty: i64,
}

impl Availability {
    /// `blocking_commitment` is **`to_pack_qty`**, never `to_receive_qty`:
    /// goods already packed have physically left the supply, so subtracting
    /// what is merely unreceived counts them twice.
    ///
    /// A replacement for a loss is blocking again, and correctly so — it has
    /// to be picked out of this pool a second time, and the lost pieces are
    /// not coming back.
    pub fn project(eligible_supply: i64, to_pack_qty: i64) -> Self {
        Self {
            eligible_supply,
            blocking_commitment: to_pack_qty,
            available_qty: (eligible_supply - to_pack_qty).max(0),
            shortfall_qty: (to_pack_qty - eligible_supply).max(0),
        }
    }
}

/// How much of one SKU can honestly go into cartons right now.
///
/// Taken over the SKU, never per store and added up: the picking area is
/// shared, so ten shirts wanted by two shops are ten shirts, and
/// `Σ min(want, supply)` would report twenty. Shown against a single store this
/// figure is what is available at that instant — a hint, not a reservation,
/// because V1 has no claim of any kind.
pub fn can_pack_now(total_to_pack_for_sku: i64, usable_pick_area_for_sku: i64) -> i64 {
    total_to_pack_for_sku.min(usable_pick_area_for_sku).max(0)
}

/// What the pickers are still owed for one SKU. Guidance, and nothing else:
/// it reserves nothing, and it is recomputed after every confirmed pick.
pub fn pick_need(total_to_pack_for_sku: i64, usable_pick_area_for_sku: i64) -> i64 {
    (total_to_pack_for_sku - usable_pick_area_for_sku).max(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn line(original: i64) -> FulfillmentCounters {
        FulfillmentCounters {
            original_alloted: original,
            ..FulfillmentCounters::default()
        }
    }

    fn project(counters: FulfillmentCounters) -> Fulfillment {
        Fulfillment::project(counters).unwrap_or_else(|error| panic!("{counters:?}: {error}"))
    }

    /// The places, in the order a person reads them, so an assertion can name
    /// the whole shape of a line in one line of test.
    fn shape(f: &Fulfillment) -> [i64; 8] {
        [
            f.to_pack_qty,
            f.at_packed,
            f.at_shipment,
            f.at_loaded,
            f.at_in_transit,
            f.receiving_gap_qty,
            f.received,
            f.closed_short,
        ]
    }

    #[test]
    fn a_fresh_allotment_is_all_still_to_pack() {
        let f = project(line(100));
        assert_eq!(shape(&f), [100, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(f.to_receive_qty, 100);
        assert_eq!(f.status, FulfillmentStatus::Active);
    }

    #[test]
    fn picking_is_absent_from_this_arithmetic_entirely() {
        // There is no pick counter to set. A warehouse can move every piece it
        // holds into the picking area and the commitment is untouched, which is
        // the whole of what "picking commits to nobody" means.
        assert_eq!(project(line(100)).to_pack_qty, 100);
    }

    /// Worked example 1 — 100 promised, 100 received.
    #[test]
    fn normal_fulfillment_ends_completed() {
        let mut c = line(100);
        c.packed_total = 100;
        let f = project(c);
        assert_eq!(shape(&f), [0, 100, 0, 0, 0, 0, 0, 0]);
        assert_eq!(f.to_receive_qty, 100, "packing is not delivery");

        c.shipment_total = 100;
        assert_eq!(shape(&project(c)), [0, 0, 100, 0, 0, 0, 0, 0]);
        c.loaded_total = 100;
        assert_eq!(shape(&project(c)), [0, 0, 0, 100, 0, 0, 0, 0]);
        c.in_transit_total = 100;
        let f = project(c);
        assert_eq!(shape(&f), [0, 0, 0, 0, 100, 0, 0, 0]);
        assert!(f.dc_fulfilled(), "the DC has finished its half");
        assert_eq!(f.to_receive_qty, 100, "dispatch completes nothing");

        c.handed_over_total = 100;
        c.received_total = 100;
        let f = project(c);
        assert_eq!(shape(&f), [0, 0, 0, 0, 0, 0, 100, 0]);
        assert_eq!(f.status, FulfillmentStatus::Completed);
    }

    #[test]
    fn one_line_stands_in_several_places_at_once() {
        let c = FulfillmentCounters {
            original_alloted: 180,
            packed_total: 120,
            shipment_total: 95,
            loaded_total: 75,
            in_transit_total: 60,
            handed_over_total: 30,
            received_total: 30,
            ..FulfillmentCounters::default()
        };
        let f = project(c);
        assert_eq!(shape(&f), [60, 25, 20, 15, 30, 0, 30, 0]);
        assert_eq!(f.to_receive_qty, 150);
        assert_eq!(f.md_shipment(), 35, "Shipment and Loaded folded for MD");
        assert_eq!(
            f.to_pack_qty + f.at_packed + f.md_shipment() + f.at_in_transit + f.receiving_gap_qty,
            f.to_receive_qty,
            "the MD row still reconciles once Loaded is folded in"
        );
    }

    /// Worked example 2 — the lorry arrives, two shirts do not turn up, and
    /// Inventory finds them.
    #[test]
    fn a_receiving_gap_waits_for_inventory_and_can_end_found() {
        let mut c = line(100);
        c.packed_total = 100;
        c.shipment_total = 100;
        c.loaded_total = 100;
        c.in_transit_total = 100;
        c.handed_over_total = 100;
        c.received_total = 98;

        let f = project(c);
        assert_eq!(shape(&f), [0, 0, 0, 0, 0, 2, 98, 0]);
        assert_eq!(
            f.at_in_transit, 0,
            "custody passed at the door; nothing is still travelling"
        );
        assert_eq!(f.receiving_gap_qty, 2, "the shop's Missing, seen from here");
        assert_eq!(f.to_receive_qty, 2);
        assert_eq!(f.status, FulfillmentStatus::Active);

        // Found: the shop confirms receipt of the two it had not found.
        c.received_total = 100;
        let f = project(c);
        assert_eq!(shape(&f), [0, 0, 0, 0, 0, 0, 100, 0]);
        assert_eq!(f.status, FulfillmentStatus::Completed);
    }

    /// Worked example 3 — the same gap, settled as Lost, then replaced.
    #[test]
    fn a_loss_returns_the_demand_to_the_bench_and_can_end_completed() {
        let mut c = line(100);
        c.packed_total = 100;
        c.shipment_total = 100;
        c.loaded_total = 100;
        c.in_transit_total = 100;
        c.handed_over_total = 100;
        c.received_total = 98;
        c.lost_at_store_total = 2;

        let f = project(c);
        assert_eq!(shape(&f), [2, 0, 0, 0, 0, 0, 98, 0]);
        assert_eq!(f.to_pack_qty, 2, "Distribution has two more to pack");
        assert_eq!(f.to_receive_qty, 2);
        assert!(!f.dc_fulfilled(), "the DC's half is open again");

        c.packed_total = 102;
        c.shipment_total = 102;
        c.loaded_total = 102;
        c.in_transit_total = 102;
        c.handed_over_total = 102;
        c.received_total = 100;
        let f = project(c);
        assert_eq!(shape(&f), [0, 0, 0, 0, 0, 0, 100, 0]);
        assert_eq!(f.status, FulfillmentStatus::Completed);
        assert!(
            c.packed_total + c.closed_short_total > c.original_alloted,
            "102 against 100, and the line is correct"
        );
    }

    /// Worked example 4 — the same loss, given up on instead.
    #[test]
    fn md_may_give_up_what_the_bench_is_holding() {
        let mut c = line(100);
        c.packed_total = 100;
        c.shipment_total = 100;
        c.loaded_total = 100;
        c.in_transit_total = 100;
        c.handed_over_total = 100;
        c.received_total = 98;
        c.lost_at_store_total = 2;
        c.closed_short_total = 2;

        let f = project(c);
        assert_eq!(shape(&f), [0, 0, 0, 0, 0, 0, 98, 2]);
        assert_eq!(f.to_receive_qty, 0);
        assert_eq!(f.status, FulfillmentStatus::Closed);
    }

    /// Worked example 5 — a finished allotment stays finished.
    #[test]
    fn a_count_the_next_day_does_not_reopen_anything() {
        let c = FulfillmentCounters {
            original_alloted: 100,
            packed_total: 100,
            shipment_total: 100,
            loaded_total: 100,
            in_transit_total: 100,
            handed_over_total: 100,
            received_total: 100,
            ..FulfillmentCounters::default()
        };
        let f = project(c);
        assert_eq!(f.status, FulfillmentStatus::Completed);
        // A shop that counts short tomorrow has an inventory problem, not a
        // fulfillment one: there is no counter here for it to move, and the
        // line has nothing left that could go backwards.
        assert_eq!(f.to_receive_qty, 0);
        assert_eq!(shape(&f)[..6], [0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn damaged_goods_arrived_so_they_are_received() {
        // 98 normal and 2 unfit for sale. Both were found; the allotment is
        // finished, and the two sit in the Store Reject pool, which is
        // Inventory's ledger and has no counter here.
        let c = FulfillmentCounters {
            original_alloted: 100,
            packed_total: 100,
            shipment_total: 100,
            loaded_total: 100,
            in_transit_total: 100,
            handed_over_total: 100,
            received_total: 100,
            ..FulfillmentCounters::default()
        };
        let f = project(c);
        assert_eq!(f.received, 100);
        assert_eq!(f.status, FulfillmentStatus::Completed);
    }

    #[test]
    fn the_wrong_sku_does_not_fulfil_the_line_it_was_sent_against() {
        // The koli for this line was handed over claiming a hundred; two of
        // the units inside were something else. Those two are an inventory
        // discrepancy, and this line is still two short.
        let c = FulfillmentCounters {
            original_alloted: 100,
            packed_total: 100,
            shipment_total: 100,
            loaded_total: 100,
            in_transit_total: 100,
            handed_over_total: 100,
            received_total: 98,
            ..FulfillmentCounters::default()
        };
        let f = project(c);
        assert_eq!(f.receiving_gap_qty, 2);
        assert_eq!(f.to_receive_qty, 2);
    }

    #[test]
    fn what_the_driver_takes_back_never_changed_hands() {
        // Nine koli of ten unloaded. The tenth is still the DC's problem, and
        // it is emphatically not a receiving gap.
        let c = FulfillmentCounters {
            original_alloted: 100,
            packed_total: 100,
            shipment_total: 100,
            loaded_total: 100,
            in_transit_total: 100,
            handed_over_total: 90,
            received_total: 90,
            ..FulfillmentCounters::default()
        };
        let f = project(c);
        assert_eq!(shape(&f), [0, 0, 0, 0, 10, 0, 90, 0]);
        assert_eq!(f.receiving_gap_qty, 0);
    }

    #[test]
    fn a_lorry_that_never_arrived_owes_the_bench_again() {
        let mut c = line(100);
        c.packed_total = 100;
        c.shipment_total = 100;
        c.loaded_total = 100;
        c.in_transit_total = 100;
        c.lost_in_transit_total = 100;
        let f = project(c);
        assert_eq!(shape(&f), [100, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(f.to_receive_qty, 100);
        assert_eq!(f.status, FulfillmentStatus::Active);
    }

    #[test]
    fn a_loss_inside_the_dc_owes_the_bench_again() {
        let mut c = line(50);
        c.packed_total = 50;
        c.lost_packed_total = 3;
        let f = project(c);
        assert_eq!(shape(&f), [3, 47, 0, 0, 0, 0, 0, 0]);
        assert_eq!(f.to_receive_qty, 50, "the shop is still owed all fifty");
    }

    #[test]
    fn reversal_lowers_a_place_without_erasing_the_fact() {
        let mut c = line(100);
        c.packed_total = 100;
        c.shipment_total = 80;
        c.loaded_total = 60;
        c.unloaded_total = 60;
        c.unshipped_total = 20;
        c.unpacked_total = 10;

        let f = project(c);
        assert_eq!(shape(&f), [10, 30, 60, 0, 0, 0, 0, 0]);
        assert_eq!(c.packed_total, 100, "the pack still happened");
        assert_eq!(f.to_pack_qty, 10, "the ten opened cartons are owed again");
    }

    #[test]
    fn the_owners_first_worked_example_still_holds() {
        // 100 allotted, 80 packed, 20 given up on before they were ever packed.
        let mut c = line(100);
        c.packed_total = 80;
        c.closed_short_total = 20;
        let f = project(c);
        assert_eq!(shape(&f), [0, 80, 0, 0, 0, 0, 0, 20]);
        assert_eq!(f.to_receive_qty, 80);
        assert_eq!(f.status, FulfillmentStatus::Active);

        c.shipment_total = 80;
        c.loaded_total = 80;
        c.in_transit_total = 80;
        c.handed_over_total = 80;
        c.received_total = 80;
        let f = project(c);
        assert_eq!(f.to_receive_qty, 0);
        assert_eq!(f.status, FulfillmentStatus::Closed);
    }

    #[test]
    fn md_cannot_give_up_what_inventory_has_not_settled() {
        let mut c = line(100);
        c.packed_total = 100;
        c.shipment_total = 100;
        c.loaded_total = 100;
        c.in_transit_total = 100;
        c.handed_over_total = 100;
        c.received_total = 98;
        // The two are a receiving gap, not the bench's work. Close Short comes
        // out of To Pack alone, so this has to wait on Inventory.
        c.closed_short_total = 2;
        assert_eq!(
            Fulfillment::project(c),
            Err(FulfillmentError::ClosedShortExceedsToPack { closed: 2, open: 0 })
        );
    }

    #[test]
    fn a_shop_cannot_receive_more_than_it_was_handed() {
        let mut c = line(100);
        c.packed_total = 100;
        c.shipment_total = 100;
        c.loaded_total = 100;
        c.in_transit_total = 100;
        c.handed_over_total = 98;
        c.received_total = 100;
        assert_eq!(
            Fulfillment::project(c),
            Err(FulfillmentError::PlaceWentNegative {
                place: "receiving_gap",
                value: -2,
            })
        );
    }

    #[test]
    fn more_cannot_be_handed_over_than_departed() {
        let mut c = line(100);
        c.packed_total = 100;
        c.shipment_total = 100;
        c.loaded_total = 100;
        c.in_transit_total = 98;
        c.handed_over_total = 100;
        assert_eq!(
            Fulfillment::project(c),
            Err(FulfillmentError::PlaceWentNegative {
                place: "at_in_transit",
                value: -2,
            })
        );
    }

    #[test]
    fn a_reversal_cannot_undo_more_than_happened() {
        let mut c = line(100);
        c.packed_total = 10;
        c.unpacked_total = 11;
        assert_eq!(
            Fulfillment::project(c),
            Err(FulfillmentError::PlaceWentNegative {
                place: "at_packed",
                value: -1,
            })
        );
    }

    /// Every state the events can actually reach, and the identity in each.
    ///
    /// Exhaustive by construction rather than by enumerating counter tuples:
    /// it walks the event graph from a fresh line, so nothing unreachable is
    /// asserted about and nothing reachable is missed. The bound keeps it
    /// finite in the presence of pack/unpack cycles.
    #[test]
    fn every_reachable_state_balances() {
        const CEILING: i64 = 4;
        let start = line(3);
        let mut seen: HashSet<FulfillmentCounters> = HashSet::new();
        let mut frontier = vec![start];
        seen.insert(start);

        let moves: [(&str, fn(&mut FulfillmentCounters)); 13] = [
            ("pack", |c| c.packed_total += 1),
            ("unpack", |c| c.unpacked_total += 1),
            ("ship", |c| c.shipment_total += 1),
            ("unship", |c| c.unshipped_total += 1),
            ("load", |c| c.loaded_total += 1),
            ("unload", |c| c.unloaded_total += 1),
            ("depart", |c| c.in_transit_total += 1),
            ("hand over", |c| c.handed_over_total += 1),
            ("receive", |c| c.received_total += 1),
            ("lose at dc", |c| c.lost_packed_total += 1),
            ("lose on the road", |c| c.lost_in_transit_total += 1),
            ("lose at the shop", |c| c.lost_at_store_total += 1),
            ("close short", |c| c.closed_short_total += 1),
        ];

        let mut states = 0usize;
        while let Some(current) = frontier.pop() {
            states += 1;
            let here = project(current);
            assert_eq!(
                shape(&here).iter().sum::<i64>(),
                current.original_alloted,
                "{current:?} does not balance"
            );
            assert_eq!(
                here.to_receive_qty,
                here.to_pack_qty
                    + here.at_packed
                    + here.at_shipment
                    + here.at_loaded
                    + here.at_in_transit
                    + here.receiving_gap_qty,
                "{current:?}: to_receive is not the six live figures"
            );

            for (_name, apply) in moves {
                let mut next = current;
                apply(&mut next);
                let over = [
                    next.packed_total,
                    next.unpacked_total,
                    next.shipment_total,
                    next.unshipped_total,
                    next.loaded_total,
                    next.unloaded_total,
                    next.in_transit_total,
                    next.handed_over_total,
                    next.received_total,
                    next.lost_packed_total,
                    next.lost_in_transit_total,
                    next.lost_at_store_total,
                    next.closed_short_total,
                ]
                .iter()
                .any(|value| *value > CEILING);
                // An illegal move is exactly one the projection refuses, which
                // is the other half of the claim: the guard is the model.
                if over || Fulfillment::project(next).is_err() || !seen.insert(next) {
                    continue;
                }
                frontier.push(next);
            }
        }
        assert!(states > 1_000, "only {states} states explored");
    }

    #[test]
    fn merge_is_the_same_arithmetic_as_one_line() {
        let mut a = line(60);
        a.packed_total = 20;
        let mut b = line(40);
        b.packed_total = 10;
        let folded = project(a.merge(b));
        assert_eq!(
            folded.to_pack_qty,
            project(a).to_pack_qty + project(b).to_pack_qty
        );
        assert_eq!(folded.to_pack_qty, 70);
    }

    #[test]
    fn availability_subtracts_what_still_has_to_leave_the_shelf() {
        // 10,000 on the shelf, 1,500 promised, 500 of them already in cartons.
        // The 500 have physically gone, so the shelf holds 9,500 and owes
        // 1,000 — using what is merely unreceived would count them twice and
        // report 8,000.
        let a = Availability::project(9_500, 1_000);
        assert_eq!(a.available_qty, 8_500);
        assert_eq!(a.shortfall_qty, 0);
    }

    #[test]
    fn availability_never_goes_negative() {
        let a = Availability::project(100, 250);
        assert_eq!(a.available_qty, 0);
        assert_eq!(a.shortfall_qty, 150);
    }

    #[test]
    fn a_replacement_blocks_the_shelf_again_and_only_once() {
        // 100 allotted out of 1,000, all packed and gone: the shelf is down to
        // 900 and owes nothing. Two are lost at the shop, so the shelf owes two
        // and shows 898 — not 898 twice over.
        let mut c = line(100);
        c.packed_total = 100;
        c.shipment_total = 100;
        c.loaded_total = 100;
        c.in_transit_total = 100;
        c.handed_over_total = 100;
        c.received_total = 98;
        c.lost_at_store_total = 2;
        let f = project(c);
        let a = Availability::project(900, f.to_pack_qty);
        assert_eq!(a.available_qty, 898);
        assert_eq!(a.shortfall_qty, 0);
    }

    #[test]
    fn a_shared_picking_area_is_not_promised_to_everybody_at_once() {
        // Ten shirts, two shops wanting ten each. The fleet can pack ten.
        let per_store: i64 = can_pack_now(10, 10) + can_pack_now(10, 10);
        assert_eq!(per_store, 20, "which is why this shape is never summed");
        assert_eq!(can_pack_now(20, 10), 10);
        assert_eq!(pick_need(20, 10), 10);
    }
}
