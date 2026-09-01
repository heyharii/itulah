//! Positions and statements: the two shapes every remaining finance read takes.
//!
//! Almost every screen left in the module asks one of two questions, and neither
//! needs a table of its own:
//!
//! **"What is this family worth, at each location?"** — cash, banks, card
//! receivables, inter-unit balances, inventory, fixed assets, loans. One matrix
//! of sub-account by location answers all of them, which is why there is one
//! endpoint rather than fifteen.
//!
//! **"What do the books say?"** — the balance sheet and the profit and loss,
//! built from the client's own root classes rather than from a template.
//!
//! Nothing here is stored. Both are summed from `journal_line` on every read,
//! for the same reason the trial balance is: a stored figure and the rows it
//! summarises drift, and a ledger that disagrees with its own report is worse
//! than one that is slow.

use crate::cloud::application::AppError;
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};

/// One sub-account across every location.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BalanceRow {
    pub account_code: String,
    /// The client's own name, never translated.
    pub name: String,
    /// Aligned with `locations`, so the browser renders a table without
    /// matching keys. A location with nothing posted is a zero, not a gap:
    /// "no cash at store 07" and "we never asked about store 07" look the same
    /// in a sparse map and are very different things to an accountant.
    pub cells: Vec<i64>,
    pub total_minor: i64,
}

/// An account family, laid out the way the client keeps it: one row per
/// sub-account, one column per location.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BalanceMatrix {
    pub family_code: String,
    pub family_name: String,
    pub as_of: NaiveDate,
    pub locations: Vec<String>,
    pub rows: Vec<BalanceRow>,
    pub column_totals: Vec<i64>,
    pub grand_total_minor: i64,
}

/// What one family holds, per location.
///
/// `family` is any code in the chart. Asking for `1011001` gives cash on hand,
/// petty cash and the cashier float across all fourteen locations; asking for
/// `10110` gives the whole of KAS & SETARA KAS. The tree is in the codes, so
/// the caller chooses the altitude and this does not need to know which screen
/// is asking.
pub async fn balance_matrix(
    pool: &PgPool,
    family: &str,
    as_of: NaiveDate,
) -> Result<BalanceMatrix, AppError> {
    let family_name: String =
        sqlx::query("SELECT name FROM ledger_account WHERE account_code = $1")
            .bind(family)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("account {family}")))?
            .try_get("name")?;

    // The locations the books are kept for, in the same order everywhere:
    // head office first, then the shops.
    let locations: Vec<String> = sqlx::query("SELECT id FROM site ORDER BY (kind <> 'DC'), id")
        .fetch_all(pool)
        .await?
        .iter()
        .map(|row| row.try_get::<String, _>("id"))
        .collect::<Result<_, _>>()?;

    // The rows are the sub-accounts one rung below the family, which is where
    // the client puts the thing being counted — `1011001001 CASH ON HAND`
    // rather than each of its fourteen location leaves.
    let rows = sqlx::query(
        "WITH child AS (
             SELECT a.account_code, a.name
               FROM ledger_account a
              WHERE a.account_code LIKE $1 || '%'
                AND a.account_code <> $1
                AND length(a.account_code) = (
                    SELECT MIN(length(b.account_code)) FROM ledger_account b
                     WHERE b.account_code LIKE $1 || '%' AND b.account_code <> $1)
         )
         SELECT c.account_code, c.name, l.site_id,
                COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS balance
           FROM child c
           LEFT JOIN journal_line l ON l.account_code LIKE c.account_code || '%'
           LEFT JOIN journal_entry e ON e.entry_id = l.entry_id AND e.posting_date <= $2
          GROUP BY c.account_code, c.name, l.site_id
          ORDER BY c.account_code",
    )
    .bind(family)
    .bind(as_of)
    .fetch_all(pool)
    .await?;

    // Fold the (account, site) pairs into one row per account, with a cell per
    // location in the fixed order above.
    let mut order: Vec<(String, String)> = Vec::new();
    let mut cells: std::collections::HashMap<(String, String), i64> =
        std::collections::HashMap::new();
    for row in &rows {
        let code: String = row.try_get("account_code")?;
        let name: String = row.try_get("name")?;
        if !order.iter().any(|(c, _)| c == &code) {
            order.push((code.clone(), name));
        }
        // A LEFT JOIN with nothing posted gives a NULL site; there is no cell
        // to place it in, and its balance is zero anyway.
        if let Ok(site) = row.try_get::<String, _>("site_id") {
            let balance: i64 = row.try_get("balance")?;
            *cells.entry((code, site)).or_insert(0) += balance;
        }
    }

    let mut column_totals = vec![0i64; locations.len()];
    let mut grand_total = 0i64;
    let mut out = Vec::with_capacity(order.len());
    for (code, name) in order {
        let mut line = Vec::with_capacity(locations.len());
        let mut total = 0i64;
        for (index, site) in locations.iter().enumerate() {
            let value = cells
                .get(&(code.clone(), site.clone()))
                .copied()
                .unwrap_or(0);
            line.push(value);
            total += value;
            column_totals[index] += value;
        }
        grand_total += total;
        out.push(BalanceRow {
            account_code: code,
            name,
            cells: line,
            total_minor: total,
        });
    }

    Ok(BalanceMatrix {
        family_code: family.to_string(),
        family_name,
        as_of,
        locations,
        rows: out,
        column_totals,
        grand_total_minor: grand_total,
    })
}

/// One line of a statement, at whatever rung of the client's ladder it sits on.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StatementLine {
    pub account_code: String,
    pub name: String,
    /// The code's own length — 1, 3, 5 or 7 — so the browser can indent
    /// without measuring strings.
    pub depth: i32,
    pub is_group: bool,
    /// Signed as the ledger holds it: debits positive. A statement decides how
    /// to present that; a balance does not decide it for the statement.
    pub amount_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StatementSection {
    pub root_class: String,
    /// The client's own words for the class, read from their chart rather than
    /// from a translation table here.
    pub title: String,
    pub lines: Vec<StatementLine>,
    pub total_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Statement {
    /// `BALANCE_SHEET` or `PROFIT_LOSS`.
    pub kind: String,
    pub from: Option<NaiveDate>,
    pub to: NaiveDate,
    pub site_id: Option<String>,
    pub sections: Vec<StatementSection>,
    /// The period's result, on a balance sheet: income less expenses, classes
    /// 4 through 8 netted.
    ///
    /// A balance sheet of classes 1, 2 and 3 alone does not balance, and that
    /// is not a fault — profit earned and not yet closed to equity is sitting
    /// in the income and expense classes. The client keeps a line for it,
    /// `3013001003 Laba (Rugi) bulan berjalan`, and this is that figure. Zero
    /// on a profit and loss, where the result is the report rather than a
    /// reconciling item.
    pub result_minor: i64,
    /// Assets minus liabilities, equity AND the period's result. Zero is the
    /// only correct answer, and it is computed here rather than left to the
    /// browser — a page that subtracted its own visible rows would report
    /// "balanced" about a list it had not finished loading.
    pub out_of_balance_minor: i64,
}

const BALANCE_SHEET: [&str; 3] = ["1", "2", "3"];
const PROFIT_LOSS: [&str; 5] = ["4", "5", "6", "7", "8"];

/// A statement built from the client's own root classes.
///
/// # Why the two are one function
///
/// They differ in exactly two ways: which root classes they cover, and whether
/// the window has a start. A balance sheet is cumulative — everything up to a
/// date — because an asset is what you have; a profit and loss is a period,
/// because income is what happened. Everything else, including the shape of the
/// tree and the rolling up, is identical, and writing it twice is how the two
/// drift apart.
pub async fn statement(
    pool: &PgPool,
    kind: &str,
    from: Option<NaiveDate>,
    to: NaiveDate,
    site_id: Option<&str>,
) -> Result<Statement, AppError> {
    let (classes, from): (&[&str], Option<NaiveDate>) = match kind {
        "BALANCE_SHEET" => (&BALANCE_SHEET, None),
        "PROFIT_LOSS" => (&PROFIT_LOSS, from),
        other => {
            return Err(AppError::Validation(format!(
                "unknown statement {other}; expected BALANCE_SHEET or PROFIT_LOSS"
            )))
        }
    };

    // Every heading down to the family rung, with its subtree summed. Rows that
    // moved nothing are dropped after the fact rather than in SQL, so a heading
    // whose children are all zero disappears with them instead of standing
    // there empty.
    let rows = sqlx::query(
        "SELECT a.account_code, a.name, length(a.account_code)::int AS depth, a.is_group,
                COALESCE((
                    SELECT SUM(l.debit_minor - l.credit_minor)
                      FROM journal_line l JOIN journal_entry e USING (entry_id)
                     WHERE l.account_code LIKE a.account_code || '%'
                       AND ($3::text IS NULL OR l.site_id = $3)
                       AND ($4::date IS NULL OR e.posting_date >= $4)
                       AND e.posting_date <= $2
                ), 0)::bigint AS amount
           FROM ledger_account a
          WHERE a.root_class = ANY($1)
            AND length(a.account_code) <= 7
          ORDER BY a.account_code",
    )
    .bind(classes)
    .bind(to)
    .bind(site_id)
    .bind(from)
    .fetch_all(pool)
    .await?;

    let mut sections: Vec<StatementSection> = Vec::new();
    for row in &rows {
        let code: String = row.try_get("account_code")?;
        let amount: i64 = row.try_get("amount")?;
        let line = StatementLine {
            name: row.try_get("name")?,
            depth: row.try_get("depth")?,
            is_group: row.try_get("is_group")?,
            amount_minor: amount,
            account_code: code.clone(),
        };
        if line.depth == 1 {
            sections.push(StatementSection {
                root_class: code,
                title: line.name.clone(),
                lines: Vec::new(),
                total_minor: amount,
            });
            continue;
        }
        // Silence is not information: a heading nothing was posted under says
        // only that the chart is large.
        if amount == 0 {
            continue;
        }
        if let Some(section) = sections.last_mut() {
            section.lines.push(line);
        }
    }

    // Assets are debit-natured and liabilities and equity are credit-natured,
    // so in the ledger's own signs the three classes sum to zero — once the
    // period's result is counted with them. Without it the sheet is out by
    // exactly the profit, which looks alarming and is simply the year not being
    // closed yet.
    let (result, out_of_balance) = if kind == "BALANCE_SHEET" {
        let result: i64 = sqlx::query(
            "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS result
               FROM journal_line l JOIN journal_entry e USING (entry_id)
               JOIN ledger_account a ON a.account_code = l.account_code
              WHERE a.root_class = ANY($1)
                AND ($3::text IS NULL OR l.site_id = $3)
                AND e.posting_date <= $2",
        )
        .bind(&PROFIT_LOSS[..])
        .bind(to)
        .bind(site_id)
        .fetch_one(pool)
        .await?
        .try_get("result")?;
        let position: i64 = sections.iter().map(|s| s.total_minor).sum();
        (result, position + result)
    } else {
        (0, 0)
    };

    Ok(Statement {
        kind: kind.to_string(),
        from,
        to,
        site_id: site_id.map(str::to_string),
        sections,
        result_minor: result,
        out_of_balance_minor: out_of_balance,
    })
}
