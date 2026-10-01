use super::*;
use crate::cloud::domain::employment::{actions, Authorization, UnitId};
use chrono::{DateTime, NaiveDate, Utc};
use pricing_engine::Money;

fn at() -> DateTime<Utc> {
    DateTime::from_timestamp(1_780_000_000, 0).unwrap_or_else(|| panic!("instant"))
}

fn defined() -> Authorization {
    Authorization::try_new("hr.dewi", actions::PAY_COMPONENT_DEFINE, at(), "definisi")
        .unwrap_or_else(|error| panic!("authorization: {error}"))
}

fn ratified() -> Authorization {
    Authorization::try_new("hr.budi", actions::PAY_COMPONENT_RATIFY, at(), "tarif")
        .unwrap_or_else(|error| panic!("authorization: {error}"))
}

fn filed() -> Authorization {
    Authorization::try_new(
        "bu.rina",
        actions::PAYROLL_ADJUSTMENT_FILE,
        at(),
        "insentif",
    )
    .unwrap_or_else(|error| panic!("authorization: {error}"))
}

fn code(raw: &str) -> ComponentCode {
    ComponentCode::try_new(raw).unwrap_or_else(|error| panic!("code: {error}"))
}

fn component(
    raw: &str,
    kind: ComponentKind,
    shape: ComponentShape,
    base: Option<ComponentBase>,
    unit: Option<CountedUnit>,
) -> PayComponent {
    PayComponent::define(code(raw), raw, kind, shape, base, unit, defined())
        .unwrap_or_else(|error| panic!("define {raw}: {error}"))
}

fn january() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 1, 1).unwrap_or_else(|| panic!("date"))
}

fn facts() -> SlipFacts {
    SlipFacts {
        base: Money::new(5_000_000),
        statutory_base: Money::new(5_500_000),
        // Two hours on an ordinary day: sixty minutes in the first band and
        // sixty after it.
        overtime_workday_first_hour: 60,
        overtime_workday_later: 60,
        overtime_rest_day: 0,
        overtime_holiday: 0,
        rostered_days: 26,
        leave_days_taken: 2,
        ..SlipFacts::default()
    }
}

fn in_force(component: PayComponent, basis: Option<ComponentBasis>) -> ComponentInForce {
    ComponentInForce {
        rate: basis.map(|basis| {
            ComponentRate::try_new(january(), basis, ratified())
                .unwrap_or_else(|error| panic!("rate: {error}"))
        }),
        component,
    }
}

/// A capped share is a share of the **wage up to the cap**, not of everything
/// with the answer capped. BPJS Kesehatan works the first way, and the two
/// agree for exactly one rate — which is how the wrong one hides.
#[test]
fn a_cap_bounds_the_base_and_not_the_contribution() {
    let basis = ComponentBasis::ShareOfBase {
        base: ComponentBase::StatutoryBase,
        rate_bp: 100,
        cap: Some(Money::new(4_000_000)),
    }
    .validated()
    .unwrap_or_else(|error| panic!("validated: {error}"));

    let computed = basis
        .compute("BPJS_KESEHATAN", &facts())
        .unwrap_or_else(|error| panic!("compute: {error}"));

    // 1% of 4.000.000, not 1% of 5.500.000.
    assert_eq!(computed.amount, Money::new(40_000));
    // And the line keeps the figure it was a share of, so it reproduces.
    assert_eq!(computed.base_of, Some(Money::new(4_000_000)));
}

/// Kepmenaker 102/2004 art. 8 and PP 35/2021 art. 31, with every number
/// arriving as ratified configuration.
#[test]
fn overtime_is_an_hourly_wage_the_operator_stated_times_hours_the_slip_counted() {
    let first = ComponentBasis::FractionOfBasePerUnit {
        base: ComponentBase::StatutoryBase,
        unit: CountedUnit::OvertimeWorkdayFirstHour,
        hours_divisor: 173,
        multiplier_bp: 15_000,
    }
    .validated()
    .unwrap_or_else(|error| panic!("validated: {error}"));

    let computed = first
        .compute("LEMBUR_JAM_PERTAMA", &facts())
        .unwrap_or_else(|error| panic!("compute: {error}"));

    // 5.500.000 / 173 = 31.792 (half up), x 1.5 = 47.688 per hour.
    assert_eq!(computed.unit_rate, Some(Money::new(47_688)));
    // Sixty minutes of it.
    assert_eq!(computed.units, Some(60));
    assert_eq!(computed.amount, Money::new(47_688));

    // The row reproduces itself from its own columns: rate x minutes / 60.
    let unit_rate = computed.unit_rate.unwrap_or_else(|| panic!("a rate")).minor;
    let units = computed.units.unwrap_or_else(|| panic!("units"));
    assert_eq!(unit_rate * units / 60, computed.amount.minor);
}

/// The divisor and the multipliers are not in the binary, so the same hours
/// under two ratified policies give two answers — which is the whole reason
/// they are rows.
#[test]
fn a_different_ratified_multiplier_gives_a_different_figure() {
    let later = ComponentBasis::FractionOfBasePerUnit {
        base: ComponentBase::StatutoryBase,
        unit: CountedUnit::OvertimeWorkdayLater,
        hours_divisor: 173,
        multiplier_bp: 20_000,
    };
    let computed = later
        .compute("LEMBUR_JAM_BERIKUT", &facts())
        .unwrap_or_else(|error| panic!("compute: {error}"));
    assert_eq!(computed.unit_rate, Some(Money::new(63_584)));
}

/// An hourly wage times a number of days is not a quantity.
#[test]
fn an_hourly_wage_cannot_be_multiplied_by_a_count_of_days() {
    let wrong = ComponentBasis::FractionOfBasePerUnit {
        base: ComponentBase::Base,
        unit: CountedUnit::RosteredDay,
        hours_divisor: 173,
        multiplier_bp: 15_000,
    };
    assert!(matches!(
        wrong.validated(),
        Err(ComponentError::UnitIsNotCountedInHours { .. })
    ));

    // And the definition refuses it too, before any rate exists.
    let refused = PayComponent::define(
        code("LEMBUR"),
        "Lembur",
        ComponentKind::Earning,
        ComponentShape::FractionOfBasePerUnit,
        Some(ComponentBase::Base),
        Some(CountedUnit::RosteredDay),
        defined(),
    );
    assert!(matches!(
        refused,
        Err(ComponentError::UnitIsNotCountedInHours { .. })
    ));
}

/// A shape carries the parts it needs and none it does not.
#[test]
fn a_shape_that_counts_nothing_takes_no_unit() {
    assert!(matches!(
        PayComponent::define(
            code("INSENTIF"),
            "Insentif",
            ComponentKind::Earning,
            ComponentShape::FixedAmount,
            None,
            Some(CountedUnit::RosteredDay),
            defined(),
        ),
        Err(ComponentError::ShapeTakesNoUnit { .. })
    ));
    assert!(matches!(
        PayComponent::define(
            code("BPJS"),
            "BPJS",
            ComponentKind::Deduction,
            ComponentShape::ShareOfBase,
            None,
            None,
            defined(),
        ),
        Err(ComponentError::ShapeNeedsBase { .. })
    ));
}

/// A rate of nought forbids something by arithmetic rather than by decision.
/// The argument `OvertimePolicy` makes about a cap of nought.
#[test]
fn nothing_may_be_ratified_at_nought() {
    for basis in [
        ComponentBasis::FixedAmount {
            amount: Money::ZERO,
        },
        ComponentBasis::ShareOfBase {
            base: ComponentBase::Base,
            rate_bp: 0,
            cap: None,
        },
        ComponentBasis::RatePerUnit {
            unit: CountedUnit::RosteredDay,
            rate: Money::ZERO,
        },
        ComponentBasis::FractionOfBasePerUnit {
            base: ComponentBase::Base,
            unit: CountedUnit::OvertimeRestDay,
            hours_divisor: 0,
            multiplier_bp: 20_000,
        },
    ] {
        assert!(
            matches!(basis.validated(), Err(ComponentError::NotPositive { .. })),
            "{basis:?}"
        );
    }
}

/// A slipped decimal point in a percentage is everybody's deduction at once.
#[test]
fn a_share_above_ten_thousand_per_cent_is_a_typo() {
    let basis = ComponentBasis::ShareOfBase {
        base: ComponentBase::Base,
        rate_bp: MAX_RATE_BP + 1,
        cap: None,
    };
    assert!(matches!(
        basis.validated(),
        Err(ComponentError::RateAboveCeiling { .. })
    ));
}

/// **The test this module exists for.** A component nobody has priced does not
/// deduct nought; it makes the slip say what it could not work out.
#[test]
fn a_component_with_no_ratified_rate_refuses_by_name_rather_than_computing_nought() {
    let bpjs = component(
        "BPJS_KESEHATAN",
        ComponentKind::Deduction,
        ComponentShape::ShareOfBase,
        Some(ComponentBase::StatutoryBase),
        None,
    );
    let computed = SlipComputation::compute(
        Money::new(5_500_000),
        &facts(),
        &[in_force(bpjs, None)],
        &[],
    )
    .unwrap_or_else(|error| panic!("compute: {error}"));

    assert_eq!(computed.deduction_total(), None, "not nought");
    assert_eq!(computed.net(), None);
    let because = computed
        .incomplete_because()
        .unwrap_or_else(|| panic!("a sentence"));
    assert!(because.contains("BPJS_KESEHATAN"), "{because}");
    assert!(!computed.is_complete());
    // Gross is still a real sum of what is on the slip.
    assert_eq!(computed.gross(), Money::new(5_500_000));
}

/// A deployment where nobody has configured payroll at all says so, rather
/// than reporting a full net with nothing taken off.
#[test]
fn an_empty_catalogue_is_not_a_deduction_of_nought() {
    let computed = SlipComputation::compute(Money::new(5_500_000), &facts(), &[], &[])
        .unwrap_or_else(|error| panic!("compute: {error}"));
    assert_eq!(computed.deduction_total(), None);
    assert_eq!(computed.net(), None);
    assert!(computed
        .incomplete_because()
        .unwrap_or_else(|| panic!("a sentence"))
        .contains("no payroll deduction has been defined"));
}

/// An unratified **earning** leaves the deduction total knowable and the net
/// not: the gross it would be subtracted from is short.
#[test]
fn an_unpriced_earning_leaves_the_deductions_known_and_the_net_not() {
    let kasbon = component(
        "KASBON",
        ComponentKind::Deduction,
        ComponentShape::PerOccasion,
        None,
        None,
    );
    let lembur = component(
        "LEMBUR",
        ComponentKind::Earning,
        ComponentShape::FractionOfBasePerUnit,
        Some(ComponentBase::StatutoryBase),
        Some(CountedUnit::OvertimeWorkdayFirstHour),
    );
    let computed = SlipComputation::compute(
        Money::new(5_500_000),
        &facts(),
        &[in_force(kasbon, None), in_force(lembur, None)],
        &[],
    )
    .unwrap_or_else(|error| panic!("compute: {error}"));

    // KASBON is PER_OCCASION, so it has nothing to ratify and is not a reason.
    // It is still a defined deduction, so a total of nought is reportable.
    assert_eq!(computed.deduction_total(), Some(Money::ZERO));
    assert_eq!(computed.net(), None);
    assert!(computed
        .incomplete_because()
        .unwrap_or_else(|| panic!("a sentence"))
        .contains("LEMBUR"));
}

/// Everything priced: gross, deductions and a net that is one minus the other.
#[test]
fn a_fully_ratified_catalogue_produces_a_net() {
    let lembur = in_force(
        component(
            "LEMBUR_1",
            ComponentKind::Earning,
            ComponentShape::FractionOfBasePerUnit,
            Some(ComponentBase::StatutoryBase),
            Some(CountedUnit::OvertimeWorkdayFirstHour),
        ),
        Some(ComponentBasis::FractionOfBasePerUnit {
            base: ComponentBase::StatutoryBase,
            unit: CountedUnit::OvertimeWorkdayFirstHour,
            hours_divisor: 173,
            multiplier_bp: 15_000,
        }),
    );
    let transport = in_force(
        component(
            "TRANSPORT",
            ComponentKind::Earning,
            ComponentShape::RatePerUnit,
            None,
            Some(CountedUnit::RosteredDay),
        ),
        Some(ComponentBasis::RatePerUnit {
            unit: CountedUnit::RosteredDay,
            rate: Money::new(20_000),
        }),
    );
    let bpjs = in_force(
        component(
            "BPJS_KESEHATAN",
            ComponentKind::Deduction,
            ComponentShape::ShareOfBase,
            Some(ComponentBase::StatutoryBase),
            None,
        ),
        Some(ComponentBasis::ShareOfBase {
            base: ComponentBase::StatutoryBase,
            rate_bp: 100,
            cap: None,
        }),
    );

    let computed = SlipComputation::compute(
        Money::new(5_500_000),
        &facts(),
        &[lembur, transport, bpjs],
        &[],
    )
    .unwrap_or_else(|error| panic!("compute: {error}"));

    assert_eq!(computed.incomplete_because(), None);
    // 5.500.000 + 47.688 overtime + 520.000 transport.
    assert_eq!(computed.gross(), Money::new(6_067_688));
    assert_eq!(computed.deduction_total(), Some(Money::new(55_000)));
    assert_eq!(computed.net(), Some(Money::new(6_012_688)));
    assert!(computed.is_complete());
    assert!(!computed.is_negative());

    // Earnings before deductions, each by code.
    let order: Vec<&str> = computed
        .lines()
        .iter()
        .map(|line| line.code().as_str())
        .collect();
    assert_eq!(order, vec!["LEMBUR_1", "TRANSPORT", "BPJS_KESEHATAN"]);
}

/// The one-off a place files, and the two things it may not be.
#[test]
fn a_one_off_may_only_name_a_component_with_no_standing_figure() {
    let insentif = component(
        "INSENTIF",
        ComponentKind::Earning,
        ComponentShape::PerOccasion,
        None,
        None,
    );
    let unit = UnitId::try_new("store-07").unwrap_or_else(|error| panic!("unit: {error}"));
    let adjustment = PayrollAdjustment::file(
        "adj-1",
        unit.clone(),
        "2026-04",
        "emp-1",
        &insentif,
        Money::new(300_000),
        None,
        filed(),
    )
    .unwrap_or_else(|error| panic!("file: {error}"));
    assert_eq!(adjustment.amount(), Money::new(300_000));

    // Not against a component that already has a standing figure — that would
    // be two answers to one question, which the reference resolves with an
    // "overwrite" flag and this refuses outright.
    let standing = component(
        "TRANSPORT",
        ComponentKind::Earning,
        ComponentShape::RatePerUnit,
        None,
        Some(CountedUnit::RosteredDay),
    );
    assert!(matches!(
        PayrollAdjustment::file(
            "adj-2",
            unit.clone(),
            "2026-04",
            "emp-1",
            &standing,
            Money::new(1),
            None,
            filed(),
        ),
        Err(ComponentError::AdjustmentNeedsPerOccasion { .. })
    ));

    // And not for nothing: which way it points is the component's kind.
    assert!(matches!(
        PayrollAdjustment::file(
            "adj-3",
            unit,
            "2026-04",
            "emp-1",
            &insentif,
            Money::ZERO,
            None,
            filed(),
        ),
        Err(ComponentError::NotPositive { .. })
    ));
}

/// A *kasbon* instalment is a positive figure under a deduction component, and
/// it lands on the slip as a deduction without anything having to negate it.
#[test]
fn a_one_off_deduction_comes_off_the_net() {
    let kasbon = component(
        "KASBON",
        ComponentKind::Deduction,
        ComponentShape::PerOccasion,
        None,
        None,
    );
    let unit = UnitId::try_new("store-07").unwrap_or_else(|error| panic!("unit: {error}"));
    let instalment = PayrollAdjustment::file(
        "adj-1",
        unit,
        "2026-04",
        "emp-1",
        &kasbon,
        Money::new(500_000),
        None,
        filed(),
    )
    .unwrap_or_else(|error| panic!("file: {error}"));

    let computed = SlipComputation::compute(
        Money::new(5_500_000),
        &facts(),
        &[in_force(kasbon, None)],
        &[instalment],
    )
    .unwrap_or_else(|error| panic!("compute: {error}"));

    assert_eq!(computed.deduction_total(), Some(Money::new(500_000)));
    assert_eq!(computed.net(), Some(Money::new(5_000_000)));
}

/// Every authority is re-checked on the way in, not only on the live path.
#[test]
fn an_authority_for_one_act_does_not_cover_another() {
    assert!(matches!(
        PayComponent::define(
            code("INSENTIF"),
            "Insentif",
            ComponentKind::Earning,
            ComponentShape::PerOccasion,
            None,
            None,
            ratified(),
        ),
        Err(ComponentError::ActionForbidsDefine { .. })
    ));

    let insentif = component(
        "INSENTIF",
        ComponentKind::Earning,
        ComponentShape::PerOccasion,
        None,
        None,
    );
    assert!(matches!(
        ComponentRate::try_new(
            january(),
            ComponentBasis::FixedAmount {
                amount: Money::new(1)
            },
            defined(),
        ),
        Err(ComponentError::ActionForbidsRatify { .. })
    ));
    assert!(matches!(
        PayrollAdjustment::file(
            "adj-1",
            UnitId::try_new("store-07").unwrap_or_else(|error| panic!("unit: {error}")),
            "2026-04",
            "emp-1",
            &insentif,
            Money::new(1),
            None,
            defined(),
        ),
        Err(ComponentError::ActionForbidsAdjustment { .. })
    ));
}

/// A PER_OCCASION component has nothing standing to ratify, and asking is a
/// malformed question rather than one whose answer is nought.
#[test]
fn a_per_occasion_component_has_no_standing_rate_to_ratify() {
    let insentif = component(
        "INSENTIF",
        ComponentKind::Earning,
        ComponentShape::PerOccasion,
        None,
        None,
    );
    assert!(matches!(
        ComponentRate::ratify(
            &insentif,
            january(),
            &RateNumbers {
                amount: Some(Money::new(100_000)),
                ..RateNumbers::default()
            },
            ratified(),
        ),
        Err(ComponentError::PerOccasionHasNoRate { .. })
    ));
}

/// A rate filed behind the latest would change what a closed month was
/// deducted — the defect that makes a mutable rate column unusable, arriving
/// through a different door.
#[test]
fn a_rate_cannot_be_filed_behind_the_latest() {
    let mut timeline = RateTimeline::new();
    let basis = ComponentBasis::ShareOfBase {
        base: ComponentBase::Base,
        rate_bp: 100,
        cap: None,
    };
    let march = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap_or_else(|| panic!("date"));
    timeline
        .append(
            ComponentRate::try_new(march, basis, ratified())
                .unwrap_or_else(|error| panic!("rate: {error}")),
        )
        .unwrap_or_else(|error| panic!("append: {error}"));
    assert!(matches!(
        timeline.append(
            ComponentRate::try_new(january(), basis, ratified())
                .unwrap_or_else(|error| panic!("rate: {error}"))
        ),
        Err(ComponentError::RateNotForward { .. })
    ));

    // And before the first rate there is no rate — not a rate of nought.
    assert!(timeline
        .on(NaiveDate::from_ymd_opt(2026, 2, 28).unwrap_or_else(|| panic!("date")))
        .is_none());
    assert!(timeline.on(march).is_some());
}

/// Retiring stops future lines and keeps the code readable. Deleting would
/// leave every slip that used it pointing at nothing.
#[test]
fn a_retired_component_produces_no_further_lines() {
    let mut transport = component(
        "TRANSPORT",
        ComponentKind::Earning,
        ComponentShape::RatePerUnit,
        None,
        Some(CountedUnit::RosteredDay),
    );
    transport
        .retire(defined())
        .unwrap_or_else(|error| panic!("retire: {error}"));
    assert!(matches!(
        transport.retire(defined()),
        Err(ComponentError::ComponentAlreadyRetired { .. })
    ));

    let kasbon = component(
        "KASBON",
        ComponentKind::Deduction,
        ComponentShape::PerOccasion,
        None,
        None,
    );
    let computed = SlipComputation::compute(
        Money::new(5_500_000),
        &facts(),
        &[
            in_force(
                transport,
                Some(ComponentBasis::RatePerUnit {
                    unit: CountedUnit::RosteredDay,
                    rate: Money::new(20_000),
                }),
            ),
            in_force(kasbon, None),
        ],
        &[],
    )
    .unwrap_or_else(|error| panic!("compute: {error}"));

    assert!(computed.lines().is_empty());
    assert_eq!(computed.gross(), Money::new(5_500_000));
}

/// A per-day allowance for somebody nobody rostered produces a line saying
/// "nil days", not silence. `RunReconciliation` counts these.
#[test]
fn a_line_that_counted_nothing_is_written_rather_than_omitted() {
    let transport = in_force(
        component(
            "TRANSPORT",
            ComponentKind::Earning,
            ComponentShape::RatePerUnit,
            None,
            Some(CountedUnit::RosteredDay),
        ),
        Some(ComponentBasis::RatePerUnit {
            unit: CountedUnit::RosteredDay,
            rate: Money::new(20_000),
        }),
    );
    let kasbon = in_force(
        component(
            "KASBON",
            ComponentKind::Deduction,
            ComponentShape::PerOccasion,
            None,
            None,
        ),
        None,
    );
    let nobody_rostered = SlipFacts {
        rostered_days: 0,
        ..facts()
    };
    let computed = SlipComputation::compute(
        Money::new(5_500_000),
        &nobody_rostered,
        &[transport, kasbon],
        &[],
    )
    .unwrap_or_else(|error| panic!("compute: {error}"));

    assert_eq!(computed.lines().len(), 1);
    let line = &computed.lines()[0];
    assert!(line.counted_nothing());
    assert_eq!(line.amount(), Money::ZERO);
    assert_eq!(computed.net(), Some(Money::new(5_500_000)));
}
