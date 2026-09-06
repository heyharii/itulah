//! What a shop's money must add up to.
//!
//! Four arithmetics live here and nothing else does. No database, no clock, no
//! calendar type — every fact arrives as an argument, which is what lets the
//! cashier equation be checked exhaustively in microseconds and what stops the
//! same drawer giving two answers depending on when somebody asked.
//!
//! `tests/kernel_purity.rs` enforces that. Dates reach this module as plain
//! integers when they reach it at all; see the note there about `chrono`.
//!
//! # The four
//!
//! **The cashier equation.** `opening float + cash sales + authorised cash
//! movements = expected closing cash`. The shop computes it at the counter and
//! the centre computes it again from the synced facts, and the two have to
//! agree — if they do not, either the till is on an old build or somebody
//! edited a row, and both are worth knowing.
//!
//! **Fund accountability.** `sent = settled + direct expenses + returned +
//! outstanding`. The one equation that says whether a store manager's float is
//! understood.
//!
//! **The remittance projection.** An order's progress, read from what has been
//! linked to its lines. Deliberately not stored; see 0112.
//!
//! **The approval limit.** Which rung of the company may approve a store
//! expense of a given size.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

/// One movement of cash in or out of a drawer for a reason other than a sale.
///
/// `amount_minor` is signed, exactly as the edge stores it: into the drawer is
/// positive, out is negative. A magnitude beside a direction is the same number
/// written twice, and the two part company the first time somebody keys a
/// negative correction.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct DrawerMovement {
    pub amount_minor: i64,
    /// Whether this movement is allowed to count toward what the drawer should
    /// hold.
    ///
    /// A payout needs a second pair of eyes; a safe drop does not. An
    /// unauthorised payout is a fact about the evening — it happened, the money
    /// is gone — and it is NOT an authorised movement, so the expected figure
    /// does not absorb it and the shortfall shows up as a variance. That is the
    /// whole point: a till that quietly counted every payout somebody typed
    /// would never be short.
    pub authorised: bool,
}

/// What a drawer should hold, and how far off it was.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashierEquation {
    pub opening_float_minor: i64,
    pub cash_sales_minor: i64,
    /// The authorised movements, netted. Negative when more went out than in.
    pub authorised_movements_minor: i64,
    /// Movements nobody signed for. Not part of the expectation — reported so
    /// that a variance can be explained rather than absorbed.
    pub unauthorised_movements_minor: i64,
    pub expected_cash_minor: i64,
    /// What the cashier counted, when they have. `None` on an open shift.
    pub declared_cash_minor: Option<i64>,
    /// Positive is over, negative is short. `None` until it has been counted.
    pub variance_minor: Option<i64>,
}

/// Work out what a drawer should hold.
///
/// The opening float is included rather than netted off, because it is money in
/// the drawer at the moment somebody counts it. A shop that returns its float
/// to the safe before counting is a shop that records a PICKUP, and the
/// movement carries it.
pub fn cashier_equation(
    opening_float_minor: i64,
    cash_sales_minor: i64,
    movements: &[DrawerMovement],
    declared_cash_minor: Option<i64>,
) -> CashierEquation {
    let mut authorised: i64 = 0;
    let mut unauthorised: i64 = 0;
    for movement in movements {
        // Saturating rather than wrapping. A drawer cannot hold i64::MAX
        // rupiah, so an overflow here is corrupt input, and the honest response
        // is a figure that is visibly absurd rather than one that has silently
        // wrapped to a plausible-looking negative.
        if movement.authorised {
            authorised = authorised.saturating_add(movement.amount_minor);
        } else {
            unauthorised = unauthorised.saturating_add(movement.amount_minor);
        }
    }
    let expected = opening_float_minor
        .saturating_add(cash_sales_minor)
        .saturating_add(authorised);
    CashierEquation {
        opening_float_minor,
        cash_sales_minor,
        authorised_movements_minor: authorised,
        unauthorised_movements_minor: unauthorised,
        expected_cash_minor: expected,
        declared_cash_minor,
        variance_minor: declared_cash_minor.map(|declared| declared.saturating_sub(expected)),
    }
}

// ---------------------------------------------------------------------------
// The manager's float
// ---------------------------------------------------------------------------

/// What has become of the money head office sent a custodian.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FundAccountability {
    pub sent_minor: i64,
    /// Bills and wages the custodian paid on head office's behalf.
    pub settled_payments_minor: i64,
    /// Costs approved without a bill behind them.
    pub direct_expenses_minor: i64,
    pub returned_minor: i64,
    /// What is still owed an accounting. Never negative: over-accounting is a
    /// refusal at the database, not a negative balance on a report.
    pub outstanding_minor: i64,
    /// Whether the four parts add back to what was sent. False means somebody
    /// has accounted for more than they were given, which the schema refuses —
    /// so a false here in production means a row was written around the
    /// constraint, and the screen says so rather than showing a tidy number.
    pub balances: bool,
}

pub fn fund_accountability(
    sent_minor: i64,
    settled_payments_minor: i64,
    direct_expenses_minor: i64,
    returned_minor: i64,
) -> FundAccountability {
    let accounted = settled_payments_minor
        .saturating_add(direct_expenses_minor)
        .saturating_add(returned_minor);
    FundAccountability {
        sent_minor,
        settled_payments_minor,
        direct_expenses_minor,
        returned_minor,
        outstanding_minor: sent_minor.saturating_sub(accounted).max(0),
        balances: accounted <= sent_minor,
    }
}

// ---------------------------------------------------------------------------
// The remittance projection
// ---------------------------------------------------------------------------

/// How far along the document that carries out an order line has got.
///
/// Two rungs, not three. `Recorded` covers everything short of certainty — a
/// deposit handed to a courier, a payment still in draft, a document whose kind
/// this build cannot read. `Confirmed` is only ever asserted by the executing
/// document itself.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum ExecutionState {
    Recorded,
    Confirmed,
}

/// One execution linked to a line: how much, and how sure we are of it.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct LineExecution {
    pub amount_minor: i64,
    pub state: ExecutionState,
}

/// One line of an order and what has been linked to it.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LineProgress {
    pub authorised_minor: i64,
    pub executions: Vec<LineExecution>,
}

/// Where an order stands, as read from its executions.
///
/// Never stored. See the header of migration 0112 for the argument: the states
/// below are facts about deposits and cash documents that have their own
/// lifecycles and their own reversals, and a column here would be a stale copy
/// of theirs the first time one was unmatched from a bank line.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum RemittanceProgress {
    /// Money with no order over it. Not a state of an order — a state of the
    /// shop, returned by the cash position when reconciled proceeds have no
    /// disposition.
    Pending,
    /// An order exists and nothing has been executed against it.
    Ordered,
    /// Some but not all of it has been carried out.
    PartlyExecuted,
    /// Every line is covered by linked executions.
    Executed,
    /// Every one of those executions is itself confirmed.
    Confirmed,
    /// Withdrawn.
    Cancelled,
}

impl RemittanceProgress {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Ordered => "ORDERED",
            Self::PartlyExecuted => "PARTLY_EXECUTED",
            Self::Executed => "EXECUTED",
            Self::Confirmed => "CONFIRMED",
            Self::Cancelled => "CANCELLED",
        }
    }
}

/// What an order has left to be carried out, and how far along it is.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RemittanceStanding {
    pub progress: RemittanceProgress,
    pub authorised_minor: i64,
    pub executed_minor: i64,
    pub confirmed_minor: i64,
    /// What may still be paid against this order. Zero on a cancelled one.
    pub unexecuted_minor: i64,
}

/// Read an order's standing off its lines.
///
/// `cancelled` is passed rather than inferred, because a cancelled order with
/// executions already against it is a real and awkward thing — somebody paid
/// and then head office withdrew — and it must read as cancelled with the
/// executions still visible, not as executed.
pub fn remittance_standing(cancelled: bool, lines: &[LineProgress]) -> RemittanceStanding {
    let mut authorised: i64 = 0;
    let mut executed: i64 = 0;
    let mut confirmed: i64 = 0;
    // Whether EVERY line is fully covered, and whether every line is fully
    // confirmed. Per line rather than in total, on purpose: an order whose
    // first line was overpaid and whose second was untouched would look
    // executed in aggregate, and it is not.
    let mut all_executed = true;
    let mut all_confirmed = true;

    for line in lines {
        authorised = authorised.saturating_add(line.authorised_minor);
        let mut line_executed: i64 = 0;
        let mut line_confirmed: i64 = 0;
        for execution in &line.executions {
            line_executed = line_executed.saturating_add(execution.amount_minor);
            if execution.state == ExecutionState::Confirmed {
                line_confirmed = line_confirmed.saturating_add(execution.amount_minor);
            }
        }
        executed = executed.saturating_add(line_executed);
        confirmed = confirmed.saturating_add(line_confirmed);
        if line_executed < line.authorised_minor {
            all_executed = false;
        }
        if line_confirmed < line.authorised_minor {
            all_confirmed = false;
        }
    }

    // An order with no lines authorises nothing, so it cannot be "executed" by
    // vacuous truth. The database refuses to issue one; this refuses to
    // flatter it if one arrives.
    if lines.is_empty() {
        all_executed = false;
        all_confirmed = false;
    }

    let progress = if cancelled {
        RemittanceProgress::Cancelled
    } else if all_confirmed {
        RemittanceProgress::Confirmed
    } else if all_executed {
        RemittanceProgress::Executed
    } else if executed > 0 {
        RemittanceProgress::PartlyExecuted
    } else {
        RemittanceProgress::Ordered
    };

    RemittanceStanding {
        progress,
        authorised_minor: authorised,
        executed_minor: executed,
        confirmed_minor: confirmed,
        unexecuted_minor: if cancelled {
            0
        } else {
            authorised.saturating_sub(executed).max(0)
        },
    }
}

// ---------------------------------------------------------------------------
// Who may approve a store expense
// ---------------------------------------------------------------------------

/// Up to this, the shop's own manager approves. Above it, head office does.
///
/// Five hundred thousand rupiah. A constant rather than a settings column,
/// because it is a company policy and not a per-shop preference, and a settings
/// table nobody has a screen for is a number nobody can change anyway. When
/// there is a screen for it, this becomes its default.
pub const STORE_EXPENSE_MANAGER_LIMIT_MINOR: i64 = 500_000_00;

/// Which rung has to say yes.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum ApprovalLevel {
    /// The store manager, on the spot.
    Supervisor,
    /// Head office finance.
    Admin,
}

impl ApprovalLevel {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Supervisor => "SUPERVISOR",
            Self::Admin => "ADMIN",
        }
    }
}

/// The lowest rung that may approve an expense of this size.
pub const fn approval_level_for(amount_minor: i64) -> ApprovalLevel {
    if amount_minor <= STORE_EXPENSE_MANAGER_LIMIT_MINOR {
        ApprovalLevel::Supervisor
    } else {
        ApprovalLevel::Admin
    }
}

/// Whether a rung is high enough for an amount.
///
/// Head office may approve anything a store manager may; the reverse is the
/// whole control.
pub const fn approval_is_sufficient(level: ApprovalLevel, amount_minor: i64) -> bool {
    match level {
        ApprovalLevel::Admin => true,
        ApprovalLevel::Supervisor => amount_minor <= STORE_EXPENSE_MANAGER_LIMIT_MINOR,
    }
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn authorised(amount: i64) -> DrawerMovement {
        DrawerMovement {
            amount_minor: amount,
            authorised: true,
        }
    }

    fn unauthorised(amount: i64) -> DrawerMovement {
        DrawerMovement {
            amount_minor: amount,
            authorised: false,
        }
    }

    #[test]
    fn a_drawer_with_nothing_in_it_expects_its_float_back() {
        let equation = cashier_equation(500_000, 0, &[], Some(500_000));
        assert_eq!(equation.expected_cash_minor, 500_000);
        assert_eq!(equation.variance_minor, Some(0));
    }

    #[test]
    fn the_equation_is_float_plus_sales_plus_movements() {
        // 500,000 float, 3,250,000 cash taken, 2,000,000 dropped to the safe.
        let equation = cashier_equation(
            500_000,
            3_250_000,
            &[authorised(-2_000_000), authorised(100_000)],
            Some(1_850_000),
        );
        assert_eq!(equation.authorised_movements_minor, -1_900_000);
        assert_eq!(equation.expected_cash_minor, 1_850_000);
        assert_eq!(equation.variance_minor, Some(0));
    }

    #[test]
    fn a_short_drawer_is_negative_and_an_over_one_is_positive() {
        assert_eq!(
            cashier_equation(0, 1_000_000, &[], Some(990_000)).variance_minor,
            Some(-10_000)
        );
        assert_eq!(
            cashier_equation(0, 1_000_000, &[], Some(1_010_000)).variance_minor,
            Some(10_000)
        );
    }

    #[test]
    fn an_unsigned_payout_does_not_excuse_itself() {
        // The money left, nobody approved it. The expectation does not absorb
        // it, so the drawer reads short by exactly that amount — which is the
        // point.
        let equation = cashier_equation(0, 1_000_000, &[unauthorised(-40_000)], Some(960_000));
        assert_eq!(equation.expected_cash_minor, 1_000_000);
        assert_eq!(equation.unauthorised_movements_minor, -40_000);
        assert_eq!(equation.variance_minor, Some(-40_000));
    }

    #[test]
    fn an_open_shift_has_no_variance() {
        let equation = cashier_equation(500_000, 250_000, &[], None);
        assert_eq!(equation.expected_cash_minor, 750_000);
        assert_eq!(equation.variance_minor, None);
    }

    #[test]
    fn a_fund_closes_over_its_four_parts() {
        let f = fund_accountability(10_000_000, 6_000_000, 1_500_000, 500_000);
        assert_eq!(f.outstanding_minor, 2_000_000);
        assert!(f.balances);
    }

    #[test]
    fn a_fully_accounted_fund_owes_nothing() {
        let f = fund_accountability(10_000_000, 9_000_000, 0, 1_000_000);
        assert_eq!(f.outstanding_minor, 0);
        assert!(f.balances);
    }

    #[test]
    fn over_accounting_is_visible_rather_than_negative() {
        let f = fund_accountability(1_000_000, 900_000, 200_000, 0);
        assert_eq!(f.outstanding_minor, 0);
        assert!(!f.balances);
    }

    fn line(authorised: i64, executions: &[(i64, ExecutionState)]) -> LineProgress {
        LineProgress {
            authorised_minor: authorised,
            executions: executions
                .iter()
                .map(|(amount, state)| LineExecution {
                    amount_minor: *amount,
                    state: *state,
                })
                .collect(),
        }
    }

    #[test]
    fn an_order_nobody_has_acted_on_is_ordered() {
        let standing = remittance_standing(false, &[line(5_000_000, &[])]);
        assert_eq!(standing.progress, RemittanceProgress::Ordered);
        assert_eq!(standing.unexecuted_minor, 5_000_000);
    }

    #[test]
    fn a_transfer_and_a_payment_together_execute_an_order() {
        // The case from the brief: a REM with two lines, one carried out by a
        // TF to a head office bank and one by a PMT to a supplier.
        let standing = remittance_standing(
            false,
            &[
                line(4_000_000, &[(4_000_000, ExecutionState::Confirmed)]),
                line(1_000_000, &[(1_000_000, ExecutionState::Recorded)]),
            ],
        );
        assert_eq!(standing.progress, RemittanceProgress::Executed);
        assert_eq!(standing.executed_minor, 5_000_000);
        assert_eq!(standing.confirmed_minor, 4_000_000);
        assert_eq!(standing.unexecuted_minor, 0);
    }

    #[test]
    fn an_order_is_confirmed_only_when_every_execution_is() {
        let standing = remittance_standing(
            false,
            &[
                line(4_000_000, &[(4_000_000, ExecutionState::Confirmed)]),
                line(1_000_000, &[(1_000_000, ExecutionState::Confirmed)]),
            ],
        );
        assert_eq!(standing.progress, RemittanceProgress::Confirmed);
    }

    #[test]
    fn one_line_covered_and_one_untouched_is_not_executed() {
        // The aggregate would say 5,000,000 of 5,000,000. Per line, it does not.
        let standing = remittance_standing(
            false,
            &[
                line(1_000_000, &[(5_000_000, ExecutionState::Confirmed)]),
                line(4_000_000, &[]),
            ],
        );
        assert_eq!(standing.progress, RemittanceProgress::PartlyExecuted);
    }

    #[test]
    fn a_cancelled_order_authorises_nothing_more() {
        let standing =
            remittance_standing(true, &[line(5_000_000, &[(5_000_000, ExecutionState::Confirmed)])]);
        assert_eq!(standing.progress, RemittanceProgress::Cancelled);
        assert_eq!(standing.unexecuted_minor, 0);
        // The execution is still visible: somebody did pay.
        assert_eq!(standing.executed_minor, 5_000_000);
    }

    #[test]
    fn an_order_with_no_lines_is_not_executed_by_vacuous_truth() {
        let standing = remittance_standing(false, &[]);
        assert_eq!(standing.progress, RemittanceProgress::Ordered);
        assert_eq!(standing.authorised_minor, 0);
    }

    #[test]
    fn the_limit_decides_which_rung_approves() {
        assert_eq!(approval_level_for(1), ApprovalLevel::Supervisor);
        assert_eq!(
            approval_level_for(STORE_EXPENSE_MANAGER_LIMIT_MINOR),
            ApprovalLevel::Supervisor
        );
        assert_eq!(
            approval_level_for(STORE_EXPENSE_MANAGER_LIMIT_MINOR + 1),
            ApprovalLevel::Admin
        );
        assert!(approval_is_sufficient(
            ApprovalLevel::Admin,
            STORE_EXPENSE_MANAGER_LIMIT_MINOR * 100
        ));
        assert!(!approval_is_sufficient(
            ApprovalLevel::Supervisor,
            STORE_EXPENSE_MANAGER_LIMIT_MINOR + 1
        ));
    }
}
