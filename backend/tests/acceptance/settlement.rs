//! The plan rows this harness can put to the pure settlement modules.
//!
//! `inventory_backend::tender` decides whether a basket is paid for;
//! `inventory_backend::refund` decides how money goes back. Both are pure, so
//! the rows about arithmetic and coverage are reachable here even though the
//! rows about providers, retries and concurrency are not.
//!
//! G05's numbers are read from the locked fixture file rather than written
//! out, for the reason [`crate::fixtures`] gives. The engine's golden CARTS
//! are adopted rather than rebuilt — a three-rule snapshot copied into a
//! second place is a second opinion waiting to drift — but a refund split is
//! four integers in and four out, so driving it from the authority file costs
//! nothing and gains the property that a revised fixture moves the test.

use inventory_backend::refund::{allocate, Capacity, RefundError};
use inventory_backend::tender::{validate_tenders, PaymentMethod, SaleTender, SalesError};

use crate::fixtures::Fixtures;
use crate::{Check, Expect, Outcome, Owner};

pub fn checks() -> Vec<(&'static str, Check)> {
    vec![
        // --- PAY: what counts as paid for ------------------------------------
        ("PAY-001", Check::Run(pay_001)),
        ("PAY-002", Check::Run(pay_002)),
        (
            "PAY-003",
            Check::NoKernelSurface {
                note: "D12 allows a zero-due sale to complete with no tender. \
                       `tender::validate_tender` refuses a total of nought outright \
                       (`SalesError::EmptyOrZeroSale`) and `validate_tenders` refuses an \
                       empty tender list (`SalesError::NoTender`), so a basket discounted \
                       to nothing cannot be settled at all. There is no state to assert \
                       against",
            },
        ),
        ("PAY-004", Check::Run(pay_004)),
        // --- RFD: refund allocation -------------------------------------------
        (
            "RFD-001",
            Check::Adopted {
                owner: Owner::Refund,
                test: "a_partial_refund_goes_back_in_the_shape_it_arrived",
                because: "the row's own worked example — a Rp200.000 refund against a \
                          Rp100.000 voucher and a Rp400.000 card, splitting Rp40.000 and \
                          Rp160.000. Its figures are in the plan's prose and not in the \
                          fixture file, so there is nothing to drive it from",
            },
        ),
        ("RFD-002", Check::Run(rfd_002)),
        (
            "RFD-003",
            Check::Adopted {
                owner: Owner::Refund,
                test: "the_invariants_hold_across_a_sweep_of_partial_returns",
                because: "the row's staged-refund property over several tenders, with all \
                          five invariants checked at every step",
            },
        ),
        (
            "RFD-011",
            Check::NoKernelSurface {
                note: "the tender half of this row is held by \
                       `refund::refunding_everything_lands_exactly_on_what_was_paid`. The \
                       row also requires ALLOCATED CHARGES to come back, and D12's per-unit \
                       charge allocation does not exist — the engine reports charges only \
                       at header level, so there is no unit share to return. The row cannot \
                       be proven as written",
            },
        ),
        ("RFD-012", Check::Run(rfd_012)),
        // --- PRP: the refund property over many shapes --------------------------
        ("PRP-002", Check::Run(prp_002)),
        (
            "PRP-001",
            Check::OutOfReach {
                note: "the row requires INV-01 through INV-16 to hold at every step of a \
                       generated sale-and-return sequence. INV-01..06 are reachable from \
                       the kernel and are what the encoded rows here check; INV-07..16 are \
                       about voucher and points ledgers, return uniqueness, provider \
                       status and analytics replay, none of which exist outside Postgres. \
                       Writing the kernel half alone and calling the row proven would be \
                       the overstatement this harness exists to avoid",
            },
        ),
        (
            "PRP-005",
            Check::OutOfReach {
                note: "replaying a COMMAND one to ten times. Commands live in the HTTP and \
                       persistence layers with their idempotency keys; the kernel has no \
                       command to replay — `price_cart` is a pure function and repeating it \
                       is what PRP-003 already proves",
            },
        ),
        (
            "PRP-008",
            Check::OutOfReach {
                note: "needs a completed sale to return units FROM: retained merchandise \
                       and awarded net points are properties of a sale record, not of a \
                       priced basket. The monetary half — returning everything in any \
                       grouping comes back to exactly what was paid — is what RFD-012 \
                       checks here",
            },
        ),
        (
            "VCH-012",
            Check::OutOfReach {
                note: "the voucher ledger is Postgres (`voucher`, `voucher_movement`, \
                       `voucher_authorization`). There is no pure module to replay \
                       ISSUE/REDEEM/RESTORE against, and the row's whole point is that the \
                       balance survives a restart",
            },
        ),
        (
            "OFF-008",
            Check::OutOfReach {
                note: "the row compares the shared engine against the Postgres-backed and \
                       SQLite-backed paths. This harness can run the engine and only the \
                       engine, so it can prove the two adapters agree with nothing. That \
                       comparison is the row",
            },
        ),
    ]
}

// ---------------------------------------------------------------------------
// PAY
// ---------------------------------------------------------------------------

fn cash(minor: i64) -> SaleTender {
    SaleTender {
        method: PaymentMethod::Cash,
        amount_minor: minor,
        reference: None,
        voucher_authorization_id: None,
    }
}

fn card(minor: i64) -> SaleTender {
    SaleTender {
        method: PaymentMethod::Card,
        amount_minor: minor,
        reference: Some("AUTH-7781".into()),
        voucher_authorization_id: None,
    }
}

/// A voucher tender, authorised. The centre's hold id is not decoration: a
/// voucher without one is refused, which is the hole the estate closed.
fn voucher(minor: i64) -> SaleTender {
    SaleTender {
        method: PaymentMethod::Voucher,
        amount_minor: minor,
        reference: Some("VCH-0001".into()),
        voucher_authorization_id: Some("AUTHZ-1".into()),
    }
}

/// PAY-001: the four tender shapes the plan names. Applied tender comes to
/// the amount due, exactly, in every one of them.
fn pay_001(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let due = 500_000_i64;
    let shapes: [(&str, Vec<SaleTender>); 4] = [
        ("exact cash", vec![cash(due)]),
        ("exact card", vec![card(due)]),
        ("voucher and card", vec![voucher(100_000), card(400_000)]),
        (
            "voucher, card and cash",
            vec![voucher(100_000), card(300_000), cash(100_000)],
        ),
    ];
    for (name, tenders) in shapes {
        match validate_tenders(due, &tenders) {
            Ok(summary) => {
                expect.eq(
                    &format!("PAY-001 {name}: applied tender is the amount due"),
                    summary.paid_minor,
                    due,
                );
                expect.eq(
                    &format!("PAY-001 {name}: nothing is left over as change"),
                    summary.change_minor,
                    0,
                );
            }
            Err(error) => {
                expect.note(format!("PAY-001 {name} was refused: {error}"));
            }
        }
    }

    // The other half of the row: a voucher with no authorisation from the
    // centre does not settle anything, however well-formed it looks.
    let unauthorised = SaleTender {
        voucher_authorization_id: None,
        ..voucher(100_000)
    };
    expect.eq(
        "PAY-001 an unauthorised voucher cannot settle a basket",
        validate_tenders(due, &[unauthorised, card(400_000)]).err(),
        Some(SalesError::VoucherNotAuthorised),
    );
    expect.finish()
}

/// PAY-002: cash handed over is not cash applied. Change is recorded apart
/// from the tender, and change can only come out of cash.
fn pay_002(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let due = 500_000_i64;
    match validate_tenders(due, &[cash(600_000)]) {
        Ok(summary) => {
            expect.eq("PAY-002 what is owed", summary.total_minor, due);
            expect.eq("PAY-002 what was handed over", summary.paid_minor, 600_000);
            expect.eq(
                "PAY-002 and the change is held apart from it",
                summary.change_minor,
                100_000,
            );
        }
        Err(error) => expect.note(format!(
            "PAY-002 an over-tender in cash was refused: {error}"
        )),
    }

    // A card cannot overpay: the difference would have to come back out of the
    // drawer, which is how a card becomes a cash withdrawal.
    expect.eq(
        "PAY-002 a card may not be over-tendered for change",
        validate_tenders(due, &[card(600_000)]).err(),
        Some(SalesError::NonCashOverpayment {
            total: due,
            non_cash: 600_000,
        }),
    );
    expect.finish()
}

/// PAY-004: too little is not a sale, and the shortfall is not quietly turned
/// into a discount.
fn pay_004(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let due = 500_000_i64;
    expect.eq(
        "PAY-004 a short tender is refused, naming both figures",
        validate_tenders(due, &[card(499_999)]).err(),
        Some(SalesError::InsufficientPayment {
            required: due,
            paid: 499_999,
        }),
    );
    expect.eq(
        "PAY-004 a sale must say how it was paid for",
        validate_tenders(due, &[]).err(),
        Some(SalesError::NoTender),
    );
    expect.eq(
        "PAY-004 a tender of nothing is not a tender",
        validate_tenders(due, &[card(0)]).err(),
        Some(SalesError::NegativeTender),
    );
    expect.finish()
}

// ---------------------------------------------------------------------------
// RFD
// ---------------------------------------------------------------------------

fn fresh(originals: &[i64]) -> Vec<Capacity> {
    originals
        .iter()
        .map(|minor| Capacity {
            original_minor: *minor,
            committed_minor: 0,
        })
        .collect()
}

fn commit(tenders: &mut [Capacity], shares: &[i64]) {
    for (tender, share) in tenders.iter_mut().zip(shares) {
        tender.committed_minor += share;
    }
}

/// RFD-002: golden fixture G05, read from the file that locks it. Four
/// tenders, two rupiah, and largest remainder rather than "the last tender
/// takes what is left" — which here would hand a tender a negative share.
fn rfd_002(fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let originals = fixtures.list("G05.original_tenders");
    let asked = fixtures.money("G05.refund_amount");
    let locked = fixtures.list("G05.allocation");

    match allocate(&fresh(&originals), asked) {
        Ok(shares) => {
            expect.eq("RFD-002 the allocation G05 locks", shares.clone(), locked);
            expect.eq(
                "RFD-002 and it comes to exactly what was asked for",
                shares.iter().sum::<i64>(),
                asked,
            );
            expect.that(
                "RFD-002 with no negative share",
                shares.iter().all(|share| *share >= 0),
            );
        }
        Err(error) => expect.note(format!("RFD-002 G05 would not allocate: {error}")),
    }
    expect.finish()
}

/// RFD-012: the same units returned in different groupings. Intermediate
/// shares may move by a rupiah; what was paid must come back exactly.
fn rfd_012(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // Three tenders and four unit values, none of which divide cleanly. If
    // grouping changed the total, a shop could return the same goods twice in
    // a different order and owe a different amount.
    let originals = [100_000_i64, 400_000, 38_201];
    let units = [319_333_i64, 101_101, 61_234, 56_533];

    let play = |groups: &[Vec<i64>]| -> Result<Vec<i64>, RefundError> {
        let mut tenders = fresh(&originals);
        let mut given = vec![0_i64; originals.len()];
        for group in groups {
            let step: i64 = group.iter().sum();
            let shares = allocate(&tenders, step)?;
            commit(&mut tenders, &shares);
            for (total, share) in given.iter_mut().zip(&shares) {
                *total += share;
            }
        }
        Ok(given)
    };

    let one_at_a_time: Vec<Vec<i64>> = units.iter().map(|unit| vec![*unit]).collect();
    let reversed: Vec<Vec<i64>> = units.iter().rev().map(|unit| vec![*unit]).collect();
    let in_pairs = vec![vec![units[0], units[1]], vec![units[2], units[3]]];
    let all_at_once = vec![units.to_vec()];

    for (name, grouping) in [
        ("one at a time", &one_at_a_time),
        ("in the other order", &reversed),
        ("in pairs", &in_pairs),
        ("all at once", &all_at_once),
    ] {
        match play(grouping) {
            Ok(given) => expect.eq(
                &format!("RFD-012 returned {name}, the tenders come back to what they paid"),
                given,
                originals.to_vec(),
            ),
            Err(error) => {
                expect.note(format!("RFD-012 returning {name} was refused: {error}"));
            }
        }
    }
    expect.finish()
}

/// PRP-002: refunds of every size up to the whole, over one tender to ten.
/// The five invariants have to hold at every step of every shape.
fn prp_002(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // Deterministic rather than random. The plan asks for random sizes with a
    // stored seed; a fixed spread of awkward shapes is reproducible without
    // one, and the shapes are chosen to be the ones that round badly: primes,
    // a tender far smaller than the rest, and totals that do not divide.
    for count in 1..=10_usize {
        let originals: Vec<i64> = (0..count)
            .map(|index| match index % 4 {
                0 => 26_000,
                1 => 22_001,
                2 => 3,
                _ => 100_000,
            })
            .collect();
        let whole: i64 = originals.iter().sum();

        for step in [1_i64, 2, 3, 7, whole / 3, whole / 2, whole] {
            if step <= 0 {
                continue;
            }
            let mut tenders = fresh(&originals);
            let mut given = vec![0_i64; count];
            let mut taken = 0_i64;
            let label = format!("PRP-002 {count} tender(s), steps of {step}");

            while taken < whole {
                let asking = step.min(whole - taken);
                let shares = match allocate(&tenders, asking) {
                    Ok(shares) => shares,
                    Err(error) => {
                        expect.note(format!("{label}: refused at {taken} of {whole}: {error}"));
                        break;
                    }
                };
                expect.that(
                    &format!("{label}: every share is at least nought"),
                    shares.iter().all(|share| *share >= 0),
                );
                expect.eq(
                    &format!("{label}: the shares come to exactly what was asked"),
                    shares.iter().sum::<i64>(),
                    asking,
                );
                for (index, share) in shares.iter().enumerate() {
                    expect.that(
                        &format!("{label}: tender {index} gave no more than it had left"),
                        *share <= tenders[index].remaining(),
                    );
                }
                commit(&mut tenders, &shares);
                for (total, share) in given.iter_mut().zip(&shares) {
                    *total += share;
                }
                taken += asking;
            }

            expect.eq(
                &format!("{label}: refunding everything lands on the original payments"),
                given,
                originals.clone(),
            );
            // And once everything is back, there is nothing left to promise.
            expect.eq(
                &format!("{label}: a refund beyond capacity is refused, not rounded away"),
                allocate(&tenders, 1).err(),
                Some(RefundError::ExceedsCapacity {
                    capacity: 0,
                    asked: 1,
                }),
            );
        }
    }
    expect.finish()
}
