//! The two statements, built from the journal and nothing else.
//!
//! No stored totals, no monthly snapshot table: a balance sheet is a query over
//! `journal_line` and a profit and loss is the same query with a date range, so
//! neither can drift from the ledger they claim to summarise. The cost is a
//! scan; the benefit is that "why does the report say that" always has the same
//! answer — because the journal says it.
//!
//! # Where the sections come from
//!
//! Every ledger account carries its own `statement_section`. Income can live
//! below an expense heading and non-operating headings can mix income and cost,
//! so a statement cannot classify an account by the first digit of its code.
//!
//! The profit and loss reads in the client's layers (0379): penjualan bersih,
//! beban pokok penjualan, laba kotor, beban usaha, GOP, beban usaha lainnya
//! (OTHER_OPERATING_EXPENSE), NOP, non-operating (OTHER_INCOME, OTHER_EXPENSE,
//! OTHER_NET), NPBT, pajak penghasilan (INCOME_TAX), NPAT.
//!
//! # The profit that has to appear twice
//!
//! A balance sheet drawn before the books are closed does not balance unless
//! the year's profit is on it, and the client's chart carries
//! `3013001003 Laba (Rugi) bulan berjalan` for exactly that. So the statement
//! computes the result of the period from every profit-and-loss section and
//! shows it as a line in equity. If somebody has ALSO posted a closing entry
//! into that account, the two would double — which is why the line is
//! labelled as computed and the posted balance is shown beside it rather than
//! added.

use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FinancialStatementLine {
    pub account_code: String,
    pub account_name: String,
    /// The account's parent heading in the client's tree (0348), so a screen
    /// can group lines the way the client's own report does — BIAYA SEWA,
    /// BIAYA DEPRESIASI DAN AMORTISASI, BIAYA USAHA LAINNYA under 7000.
    pub group_code: Option<String>,
    pub group_name: Option<String>,
    /// The section assigned to the account in the chart.
    pub section: String,
    /// Signed the way the section reads: an asset is positive when it is a
    /// debit balance, a liability when it is a credit one; a cost is positive
    /// when it is a debit, an income when it is a credit.
    pub amount_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BalanceSheet {
    pub as_of: NaiveDate,
    /// One unit's books (0605), or the company's when absent.
    pub unit_id: Option<String>,
    pub assets_minor: i64,
    pub liabilities_minor: i64,
    pub equity_minor: i64,
    /// The period's result, computed from every profit-and-loss section and
    /// shown inside equity.
    pub result_minor: i64,
    /// Assets less liabilities and equity. Zero on a ledger that balances.
    pub difference_minor: i64,
    pub balanced: bool,
    pub lines: Vec<FinancialStatementLine>,
}

/// The client's P&L, layer by layer (owner decision, 25 Sep 2026).
///
/// ```text
/// PENJUALAN (net of the 4011 discount/return group)   revenue
/// BEBAN POKOK PENJUALAN                               cost_of_sales
/// = LABA (RUGI) USAHA KOTOR                           gross_profit
/// BEBAN USAHA (6xxx)                                  operating_expenses
/// = GROSS OPERATING PROFIT                            gross_operating_profit
/// BEBAN USAHA LAINNYA (7xxx)                          other_operating_expenses
/// = NET OPERATING PROFIT                              net_operating_profit
/// PENDAPATAN (BIAYA) NON OPERASI (signed)             non_operating
/// = NET PROFIT BEFORE TAX                             profit_before_tax
/// PAJAK PENGHASILAN                                   income_tax
/// = NET PROFIT AFTER TAX                              net_profit
/// ```
///
/// Costs are positive numbers and are subtracted; `non_operating` is signed —
/// income positive, cost negative — because the client's block mixes both.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProfitAndLoss {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// One unit's books (0605), or the company's when absent.
    pub unit_id: Option<String>,
    pub revenue_minor: i64,
    pub cost_of_sales_minor: i64,
    pub gross_profit_minor: i64,
    pub operating_expenses_minor: i64,
    pub gross_operating_profit_minor: i64,
    pub other_operating_expenses_minor: i64,
    pub net_operating_profit_minor: i64,
    /// Signed: OTHER_INCOME − OTHER_EXPENSE + OTHER_NET.
    pub non_operating_minor: i64,
    pub profit_before_tax_minor: i64,
    pub income_tax_minor: i64,
    pub net_profit_minor: i64,
    pub lines: Vec<FinancialStatementLine>,
}

/// Every section a profit and loss reads, in the order the layers use them.
const RESULT_SECTIONS: [&str; 8] = [
    "REVENUE",
    "COST_OF_SALES",
    "OPERATING_EXPENSE",
    "OTHER_OPERATING_EXPENSE",
    "OTHER_INCOME",
    "OTHER_EXPENSE",
    "OTHER_NET",
    "INCOME_TAX",
];

/// Sections that read debit-positive. Everything else — liabilities, equity,
/// income and the signed OTHER_NET — reads credit-positive.
fn is_debit_normal(section: &str) -> bool {
    matches!(
        section,
        "ASSET"
            | "COST_OF_SALES"
            | "OPERATING_EXPENSE"
            | "OTHER_OPERATING_EXPENSE"
            | "OTHER_EXPENSE"
            | "INCOME_TAX"
    )
}

/// A ledger movement (debit − credit) signed the way its section reads.
fn presented(section: &str, movement: i64) -> i64 {
    if is_debit_normal(section) {
        movement
    } else {
        -movement
    }
}

/// The layered subtotals, from the per-section amounts as presented.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Layers {
    revenue: i64,
    cost_of_sales: i64,
    gross_profit: i64,
    operating_expenses: i64,
    gross_operating_profit: i64,
    other_operating_expenses: i64,
    net_operating_profit: i64,
    non_operating: i64,
    profit_before_tax: i64,
    income_tax: i64,
    net_profit: i64,
}

impl Layers {
    fn from_sections(amount: impl Fn(&str) -> i64) -> Self {
        let revenue = amount("REVENUE");
        let cost_of_sales = amount("COST_OF_SALES");
        let gross_profit = revenue - cost_of_sales;
        let operating_expenses = amount("OPERATING_EXPENSE");
        let gross_operating_profit = gross_profit - operating_expenses;
        let other_operating_expenses = amount("OTHER_OPERATING_EXPENSE");
        let net_operating_profit = gross_operating_profit - other_operating_expenses;
        let non_operating = amount("OTHER_INCOME") - amount("OTHER_EXPENSE") + amount("OTHER_NET");
        let profit_before_tax = net_operating_profit + non_operating;
        let income_tax = amount("INCOME_TAX");
        Self {
            revenue,
            cost_of_sales,
            gross_profit,
            operating_expenses,
            gross_operating_profit,
            other_operating_expenses,
            net_operating_profit,
            non_operating,
            profit_before_tax,
            income_tax,
            net_profit: profit_before_tax - income_tax,
        }
    }
}

/// Every account with a movement, signed for its section.
async fn statement_lines(
    pool: &PgPool,
    from: Option<NaiveDate>,
    to: NaiveDate,
    unit_id: Option<&str>,
    sections: &[&str],
    with_closing: bool,
) -> Result<Vec<FinancialStatementLine>, AppError> {
    let owned: Vec<String> = sections
        .iter()
        .map(|section| (*section).to_string())
        .collect();
    let rows = sqlx::query(
        "SELECT l.account_code, a.name AS account_name, a.statement_section,
                a.parent_code AS group_code, parent.name AS group_name,
                SUM(l.debit_minor - l.credit_minor)::bigint AS movement
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
           JOIN ledger_account a ON a.account_code = l.account_code
           LEFT JOIN ledger_account parent ON parent.account_code = a.parent_code
          WHERE a.statement_section = ANY($1)
            AND e.posting_date <= $2
            AND ($3::date IS NULL OR e.posting_date >= $3)
            AND ($4::text IS NULL OR l.unit_id = $4)
            AND ($5 OR NOT journal_entry_closes_books(e.source_kind, e.reversal_of))
          GROUP BY l.account_code, a.name, a.statement_section, a.parent_code, parent.name
         HAVING SUM(l.debit_minor - l.credit_minor) <> 0
          ORDER BY l.account_code",
    )
    .bind(&owned)
    .bind(to)
    .bind(from)
    .bind(unit_id)
    .bind(with_closing)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let section: String = row.try_get("statement_section")?;
            let movement: i64 = row.try_get("movement")?;
            Ok(FinancialStatementLine {
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                group_code: row.try_get("group_code")?,
                group_name: row.try_get("group_name")?,
                amount_minor: presented(&section, movement),
                section,
            })
        })
        .collect()
}

/// What the company owns and owes, at a date.
pub async fn balance_sheet(
    pool: &PgPool,
    as_of: NaiveDate,
    unit_id: Option<&str>,
) -> Result<BalanceSheet, AppError> {
    let lines = statement_lines(
        pool,
        None,
        as_of,
        unit_id,
        &["ASSET", "LIABILITY", "EQUITY"],
        true,
    )
    .await?;
    // With the closing vouchers: a closed period's profit is already in
    // retained earnings, and counting it here as well would count it twice.
    let result_lines = statement_lines(pool, None, as_of, unit_id, &RESULT_SECTIONS, true).await?;

    let assets: i64 = lines
        .iter()
        .filter(|line| line.section == "ASSET")
        .map(|line| line.amount_minor)
        .sum();
    let liabilities: i64 = lines
        .iter()
        .filter(|line| line.section == "LIABILITY")
        .map(|line| line.amount_minor)
        .sum();
    let equity: i64 = lines
        .iter()
        .filter(|line| line.section == "EQUITY")
        .map(|line| line.amount_minor)
        .sum();
    // Income sections are credit-positive and cost sections — including beban
    // usaha lainnya and income tax — debit-positive. OTHER_NET carries the
    // signed net of accounts such as rounding.
    let result: i64 = result_lines
        .iter()
        .map(|line| {
            if is_debit_normal(&line.section) {
                -line.amount_minor
            } else {
                line.amount_minor
            }
        })
        .sum();

    let difference = assets - liabilities - equity - result;
    Ok(BalanceSheet {
        as_of,
        unit_id: unit_id.map(str::to_string),
        assets_minor: assets,
        liabilities_minor: liabilities,
        equity_minor: equity,
        result_minor: result,
        difference_minor: difference,
        balanced: difference == 0,
        lines,
    })
}

/// What the period earned, from the ledger, in the client's layers.
pub async fn profit_and_loss(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
    unit_id: Option<&str>,
) -> Result<ProfitAndLoss, AppError> {
    // Without the closing vouchers (0464): a closed period still reports what
    // it earned, as ERPNext's P&L does.
    let lines = statement_lines(pool, Some(from), to, unit_id, &RESULT_SECTIONS, false).await?;
    let layers = Layers::from_sections(|section| {
        lines
            .iter()
            .filter(|line| line.section == section)
            .map(|line| line.amount_minor)
            .sum()
    });
    Ok(ProfitAndLoss {
        from,
        to,
        unit_id: unit_id.map(str::to_string),
        revenue_minor: layers.revenue,
        cost_of_sales_minor: layers.cost_of_sales,
        gross_profit_minor: layers.gross_profit,
        operating_expenses_minor: layers.operating_expenses,
        gross_operating_profit_minor: layers.gross_operating_profit,
        other_operating_expenses_minor: layers.other_operating_expenses,
        net_operating_profit_minor: layers.net_operating_profit,
        non_operating_minor: layers.non_operating,
        profit_before_tax_minor: layers.profit_before_tax,
        income_tax_minor: layers.income_tax,
        net_profit_minor: layers.net_profit,
        lines,
    })
}

/// One unit's P&L, in the same layers as [`ProfitAndLoss`].
///
/// A unit — head office or a store — and not a premises (0605): head
/// office's result is one row however many sites it keeps, and it is found by
/// the unit, never by a site id.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnitResult {
    pub unit_id: String,
    /// The client's code (`HO`, `C004`) and the unit's name, so a screen shows
    /// what people read and never the internal id.
    pub unit_code: String,
    pub unit_name: String,
    pub revenue_minor: i64,
    pub cost_of_sales_minor: i64,
    pub gross_profit_minor: i64,
    pub operating_expenses_minor: i64,
    pub gross_operating_profit_minor: i64,
    pub other_operating_expenses_minor: i64,
    pub net_operating_profit_minor: i64,
    /// Signed: OTHER_INCOME − OTHER_EXPENSE + OTHER_NET.
    pub non_operating_minor: i64,
    pub profit_before_tax_minor: i64,
    pub income_tax_minor: i64,
    pub net_profit_minor: i64,
}

impl UnitResult {
    fn new(unit_id: String, unit_code: String, unit_name: String, layers: Layers) -> Self {
        Self {
            unit_id,
            unit_code,
            unit_name,
            revenue_minor: layers.revenue,
            cost_of_sales_minor: layers.cost_of_sales,
            gross_profit_minor: layers.gross_profit,
            operating_expenses_minor: layers.operating_expenses,
            gross_operating_profit_minor: layers.gross_operating_profit,
            other_operating_expenses_minor: layers.other_operating_expenses,
            net_operating_profit_minor: layers.net_operating_profit,
            non_operating_minor: layers.non_operating,
            profit_before_tax_minor: layers.profit_before_tax,
            income_tax_minor: layers.income_tax,
            net_profit_minor: layers.net_profit,
        }
    }
}

/// One row per unit, and the consolidated total is their sum — which is the
/// property that makes unit reporting and consolidated reporting reconcile.
pub async fn unit_results(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<UnitResult>, AppError> {
    let owned: Vec<String> = RESULT_SECTIONS.iter().map(|s| (*s).to_string()).collect();
    let rows = sqlx::query(
        "SELECT l.unit_id, u.code AS unit_code, u.name AS unit_name, a.statement_section,
                SUM(l.debit_minor - l.credit_minor)::bigint AS movement
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
           JOIN ledger_account a ON a.account_code = l.account_code
           JOIN unit u ON u.id = l.unit_id
          WHERE a.statement_section = ANY($3)
            AND e.posting_date BETWEEN $1 AND $2
            AND NOT journal_entry_closes_books(e.source_kind, e.reversal_of)
          GROUP BY l.unit_id, u.code, u.name, u.kind, a.statement_section
          ORDER BY (u.kind <> 'HO'), u.code",
    )
    .bind(from)
    .bind(to)
    .bind(&owned)
    .fetch_all(pool)
    .await?;

    // (unit, section, presented amount), folded per unit in first-seen order —
    // head office first, then the stores by code.
    type Folded = (String, String, String, Vec<(String, i64)>);
    let mut units: Vec<Folded> = Vec::new();
    for row in &rows {
        let unit: String = row.try_get("unit_id")?;
        let section: String = row.try_get("statement_section")?;
        let movement: i64 = row.try_get("movement")?;
        let amount = presented(&section, movement);
        match units.iter_mut().find(|(id, _, _, _)| *id == unit) {
            Some((_, _, _, sections)) => sections.push((section, amount)),
            None => units.push((
                unit,
                row.try_get("unit_code")?,
                row.try_get("unit_name")?,
                vec![(section, amount)],
            )),
        }
    }
    Ok(units
        .into_iter()
        .map(|(unit, code, name, sections)| {
            let layers = Layers::from_sections(|wanted| {
                sections
                    .iter()
                    .filter(|(section, _)| section == wanted)
                    .map(|(_, amount)| *amount)
                    .sum()
            });
            UnitResult::new(unit, code, name, layers)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_layers_follow_the_clients_report() {
        let layers = Layers::from_sections(|section| match section {
            "REVENUE" => 1_000,
            "COST_OF_SALES" => 600,
            "OPERATING_EXPENSE" => 200,
            "OTHER_OPERATING_EXPENSE" => 90,
            "OTHER_INCOME" => 5,
            "OTHER_EXPENSE" => 8,
            "OTHER_NET" => -1,
            "INCOME_TAX" => 30,
            _ => 0,
        });
        assert_eq!(layers.gross_profit, 400);
        assert_eq!(layers.gross_operating_profit, 200);
        assert_eq!(layers.net_operating_profit, 110);
        assert_eq!(layers.non_operating, -4);
        assert_eq!(layers.profit_before_tax, 106);
        assert_eq!(layers.net_profit, 76);
    }

    #[test]
    fn beban_usaha_lainnya_and_tax_read_debit_positive() {
        assert_eq!(presented("OTHER_OPERATING_EXPENSE", 50), 50);
        assert_eq!(presented("INCOME_TAX", 50), 50);
        assert_eq!(presented("OTHER_NET", 50), -50);
        assert_eq!(presented("REVENUE", -50), 50);
    }
}

/// One value of a dimension's P&L, in the same layers as [`ProfitAndLoss`]
/// (0470). Lines that carry no value for the dimension are one row with no
/// value, so the rows still add up to the whole.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DimensionResult {
    pub value_code: Option<String>,
    pub revenue_minor: i64,
    pub gross_profit_minor: i64,
    pub net_operating_profit_minor: i64,
    pub net_profit_minor: i64,
}

/// The profit and loss cut by one accounting dimension — per division, per
/// cost center, per project — over a date range, closing vouchers left out.
pub async fn dimension_results(
    pool: &PgPool,
    dimension: &str,
    from: NaiveDate,
    to: NaiveDate,
    unit_id: Option<&str>,
) -> Result<Vec<DimensionResult>, AppError> {
    let owned: Vec<String> = RESULT_SECTIONS.iter().map(|s| (*s).to_string()).collect();
    let rows = sqlx::query(
        "SELECT d.value_code, a.statement_section,
                SUM(l.debit_minor - l.credit_minor)::bigint AS movement
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
           JOIN ledger_account a ON a.account_code = l.account_code
           LEFT JOIN journal_line_dimension d
                  ON d.line_id = l.line_id AND d.dimension_code = $3
          WHERE a.statement_section = ANY($4)
            AND e.posting_date BETWEEN $1 AND $2
            AND ($5::text IS NULL OR l.unit_id = $5)
            AND NOT journal_entry_closes_books(e.source_kind, e.reversal_of)
          GROUP BY d.value_code, a.statement_section
          ORDER BY d.value_code NULLS LAST",
    )
    .bind(from)
    .bind(to)
    .bind(dimension.trim().to_ascii_uppercase())
    .bind(&owned)
    .bind(unit_id)
    .fetch_all(pool)
    .await?;

    let mut values: Vec<(Option<String>, Vec<(String, i64)>)> = Vec::new();
    for row in &rows {
        let value: Option<String> = row.try_get("value_code")?;
        let section: String = row.try_get("statement_section")?;
        let amount = presented(&section, row.try_get("movement")?);
        match values.iter_mut().find(|(code, _)| *code == value) {
            Some((_, sections)) => sections.push((section, amount)),
            None => values.push((value, vec![(section, amount)])),
        }
    }
    Ok(values
        .into_iter()
        .map(|(value_code, sections)| {
            let layers = Layers::from_sections(|wanted| {
                sections
                    .iter()
                    .filter(|(section, _)| section == wanted)
                    .map(|(_, amount)| *amount)
                    .sum()
            });
            DimensionResult {
                value_code,
                revenue_minor: layers.revenue,
                gross_profit_minor: layers.gross_profit,
                net_operating_profit_minor: layers.net_operating_profit,
                net_profit_minor: layers.net_profit,
            }
        })
        .collect())
}
