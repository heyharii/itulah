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
//! `ledger_account.root_class`, which is generated from the first digit of the
//! client's own code: 1 aset, 2 kewajiban, 3 modal, 4 pendapatan, 5 beban
//! pokok, 6 beban usaha, 7 beban usaha lainnya, 8 non-operasional. Nothing here
//! classifies accounts on its own.
//!
//! # The profit that has to appear twice
//!
//! A balance sheet drawn before the books are closed does not balance unless
//! the year's profit is on it, and the client's chart carries
//! `3013001003 Laba (Rugi) bulan berjalan` for exactly that. So the statement
//! computes the result of the period from classes 4-8 and shows it as a line in
//! equity. If somebody has ALSO posted a closing entry into that account, the
//! two would double — which is why the line is labelled as computed and the
//! posted balance is shown beside it rather than added.

use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FinancialStatementLine {
    pub account_code: String,
    pub account_name: String,
    /// The section this line belongs to: `ASSET`, `LIABILITY`, `EQUITY`,
    /// `REVENUE`, `COST_OF_SALES`, `EXPENSE`, `OTHER`.
    pub section: String,
    /// Signed the way the section reads: an asset is positive when it is a
    /// debit balance, a liability when it is a credit one.
    pub amount_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BalanceSheet {
    pub as_of: NaiveDate,
    pub site_id: Option<String>,
    pub assets_minor: i64,
    pub liabilities_minor: i64,
    pub equity_minor: i64,
    /// The period's result, computed from classes 4-8 and shown inside equity.
    pub result_minor: i64,
    /// Assets less liabilities and equity. Zero on a ledger that balances.
    pub difference_minor: i64,
    pub balanced: bool,
    pub lines: Vec<FinancialStatementLine>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProfitAndLoss {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub site_id: Option<String>,
    pub revenue_minor: i64,
    pub cost_of_sales_minor: i64,
    pub gross_profit_minor: i64,
    pub expenses_minor: i64,
    pub other_minor: i64,
    pub net_minor: i64,
    pub lines: Vec<FinancialStatementLine>,
}

fn section_of(root_class: &str) -> &'static str {
    match root_class {
        "1" => "ASSET",
        "2" => "LIABILITY",
        "3" => "EQUITY",
        "4" => "REVENUE",
        "5" => "COST_OF_SALES",
        "6" | "7" => "EXPENSE",
        _ => "OTHER",
    }
}

/// Every account with a movement, signed for its section.
async fn statement_lines(
    pool: &PgPool,
    from: Option<NaiveDate>,
    to: NaiveDate,
    site_id: Option<&str>,
    classes: &[&str],
) -> Result<Vec<FinancialStatementLine>, AppError> {
    let owned: Vec<String> = classes.iter().map(|class| (*class).to_string()).collect();
    let rows = sqlx::query(
        "SELECT l.account_code, a.name AS account_name, a.root_class::text AS root_class,
                SUM(l.debit_minor - l.credit_minor)::bigint AS movement
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
           JOIN ledger_account a ON a.account_code = l.account_code
          WHERE a.root_class::text = ANY($1)
            AND e.posting_date <= $2
            AND ($3::date IS NULL OR e.posting_date >= $3)
            AND ($4::text IS NULL OR l.site_id = $4)
          GROUP BY l.account_code, a.name, a.root_class
         HAVING SUM(l.debit_minor - l.credit_minor) <> 0
          ORDER BY l.account_code",
    )
    .bind(&owned)
    .bind(to)
    .bind(from)
    .bind(site_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let class: String = row.try_get("root_class")?;
            let movement: i64 = row.try_get("movement")?;
            let section = section_of(&class);
            // Debit-natured sections read positive on a debit balance; the rest
            // read positive on a credit one. Doing it here means no reader has
            // to remember which way round a liability goes.
            let amount = match section {
                "ASSET" | "COST_OF_SALES" | "EXPENSE" => movement,
                _ => -movement,
            };
            Ok(FinancialStatementLine {
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                section: section.to_string(),
                amount_minor: amount,
            })
        })
        .collect()
}

/// What the company owns and owes, at a date.
pub async fn balance_sheet(
    pool: &PgPool,
    as_of: NaiveDate,
    site_id: Option<&str>,
) -> Result<BalanceSheet, AppError> {
    let lines = statement_lines(pool, None, as_of, site_id, &["1", "2", "3"]).await?;
    let result_lines = statement_lines(
        pool,
        None,
        as_of,
        site_id,
        &["4", "5", "6", "7", "8"],
    )
    .await?;

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
    // Revenue positive, costs negative: the result is what the period earned.
    let result: i64 = result_lines
        .iter()
        .map(|line| match line.section.as_str() {
            "REVENUE" | "OTHER" => line.amount_minor,
            _ => -line.amount_minor,
        })
        .sum();

    let difference = assets - liabilities - equity - result;
    Ok(BalanceSheet {
        as_of,
        site_id: site_id.map(str::to_string),
        assets_minor: assets,
        liabilities_minor: liabilities,
        equity_minor: equity,
        result_minor: result,
        difference_minor: difference,
        balanced: difference == 0,
        lines,
    })
}

/// What the period earned, from the ledger.
pub async fn profit_and_loss(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
    site_id: Option<&str>,
) -> Result<ProfitAndLoss, AppError> {
    let lines =
        statement_lines(pool, Some(from), to, site_id, &["4", "5", "6", "7", "8"]).await?;
    let sum = |section: &str| -> i64 {
        lines
            .iter()
            .filter(|line| line.section == section)
            .map(|line| line.amount_minor)
            .sum()
    };
    let revenue = sum("REVENUE");
    let cost = sum("COST_OF_SALES");
    let expenses = sum("EXPENSE");
    let other = sum("OTHER");
    Ok(ProfitAndLoss {
        from,
        to,
        site_id: site_id.map(str::to_string),
        revenue_minor: revenue,
        cost_of_sales_minor: cost,
        gross_profit_minor: revenue - cost,
        expenses_minor: expenses,
        other_minor: other,
        net_minor: revenue - cost - expenses + other,
        lines,
    })
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnitResult {
    pub site_id: String,
    pub revenue_minor: i64,
    pub cost_of_sales_minor: i64,
    pub expenses_minor: i64,
    pub other_minor: i64,
    pub net_minor: i64,
}

/// One row per unit, and the consolidated total is their sum — which is the
/// property that makes unit reporting and consolidated reporting reconcile.
pub async fn unit_results(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<UnitResult>, AppError> {
    let rows = sqlx::query(
        "SELECT l.site_id, a.root_class::text AS root_class,
                SUM(l.credit_minor - l.debit_minor)::bigint AS credit_side
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
           JOIN ledger_account a ON a.account_code = l.account_code
          WHERE a.root_class::text IN ('4','5','6','7','8')
            AND e.posting_date BETWEEN $1 AND $2
          GROUP BY l.site_id, a.root_class
          ORDER BY l.site_id",
    )
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;

    let mut out: Vec<UnitResult> = Vec::new();
    for row in &rows {
        let site: String = row.try_get("site_id")?;
        let class: String = row.try_get("root_class")?;
        let credit_side: i64 = row.try_get("credit_side")?;
        let slot = match out.iter_mut().find(|unit| unit.site_id == site) {
            Some(found) => found,
            None => {
                out.push(UnitResult {
                    site_id: site.clone(),
                    revenue_minor: 0,
                    cost_of_sales_minor: 0,
                    expenses_minor: 0,
                    other_minor: 0,
                    net_minor: 0,
                });
                out.last_mut().unwrap_or_else(|| unreachable!())
            }
        };
        match class.as_str() {
            "4" => slot.revenue_minor += credit_side,
            "5" => slot.cost_of_sales_minor += -credit_side,
            "6" | "7" => slot.expenses_minor += -credit_side,
            _ => slot.other_minor += credit_side,
        }
    }
    for unit in &mut out {
        unit.net_minor =
            unit.revenue_minor - unit.cost_of_sales_minor - unit.expenses_minor + unit.other_minor;
    }
    Ok(out)
}
