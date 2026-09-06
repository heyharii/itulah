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
use uuid::Uuid;

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
    /// Classes 4 through 8 netted, in the ledger's own signs: debits positive,
    /// so a net cost is positive and a net profit is negative. The same
    /// convention `StatementLine::amount_minor` uses, and for the same reason —
    /// a report that flipped the sign of its own bottom line would be the one
    /// figure on the page that did not mean what every other figure means.
    ///
    /// **On a balance sheet** it is a reconciling item, measured inception to
    /// date. A sheet of classes 1, 2 and 3 alone does not balance, and that is
    /// not a fault: profit earned and not yet closed to equity is sitting in
    /// the income and expense classes. The client keeps a line for it,
    /// `3013001003 Laba (Rugi) bulan berjalan`, and this is that figure.
    ///
    /// **On a profit and loss** it is the report — the result of the window
    /// `from`..`to`, and therefore equal to the sum of the sections below.
    /// Deliberately redundant, in the same spirit as `journal_entry.total_minor`:
    /// it is computed from `journal_line` rather than by adding up the sections,
    /// so a bug in the tree-rolling shows up as a disagreement instead of
    /// hiding inside a figure derived from the very rows it should be checking.
    pub result_minor: i64,
    /// Assets minus liabilities, equity AND the period's result. Zero is the
    /// only correct answer, and it is computed here rather than left to the
    /// browser — a page that subtracted its own visible rows would report
    /// "balanced" about a list it had not finished loading.
    ///
    /// Always zero on a profit and loss, and that is not a stub: a P&L is one
    /// side of an entry, not both, so there is nothing for it to be out of
    /// balance AGAINST. Income and expenses balance against the assets and
    /// liabilities that moved with them, which is the balance sheet's question.
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
            )));
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

    // Both statements need the same number and mean different things by it, so
    // it is one query with one difference: the window.
    //
    // A balance sheet asks it inception to date, because the profit sitting
    // unclosed in the income and expense classes is ALL the profit ever earned
    // and not yet swept to equity — bounding that by a start date would leave
    // the sheet out by everything that happened before it. A profit and loss
    // asks it over the window it reports, because that is the report.
    //
    // `from` is already NULL for a balance sheet — `statement` forced it so
    // above — which is why the same `$4::date IS NULL OR ...` guard serves
    // both without a branch here.
    let result: i64 = sqlx::query(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS result
           FROM journal_line l JOIN journal_entry e USING (entry_id)
           JOIN ledger_account a ON a.account_code = l.account_code
          WHERE a.root_class = ANY($1)
            AND ($3::text IS NULL OR l.site_id = $3)
            AND ($4::date IS NULL OR e.posting_date >= $4)
            AND e.posting_date <= $2",
    )
    .bind(&PROFIT_LOSS[..])
    .bind(to)
    .bind(site_id)
    .bind(from)
    .fetch_one(pool)
    .await?
    .try_get("result")?;

    // Assets are debit-natured and liabilities and equity are credit-natured,
    // so in the ledger's own signs the three classes sum to zero — once the
    // period's result is counted with them. Without it the sheet is out by
    // exactly the profit, which looks alarming and is simply the year not being
    // closed yet.
    //
    // A profit and loss has no such check to make: its sections are one side of
    // every entry that touched them, and the other side is on the balance
    // sheet. Zero here is the answer, not a placeholder — see the field.
    let out_of_balance = if kind == "BALANCE_SHEET" {
        let position: i64 = sections.iter().map(|s| s.total_minor).sum();
        position + result
    } else {
        0
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

// ---------------------------------------------------------------------------
// Cash and bank, per account and per location
// ---------------------------------------------------------------------------

/// The meanings that hold money, in the order somebody reads them.
///
/// Not alphabetical, and not derived from `required_semantic_keys` either. This
/// is the order the client's own chart puts them in — the notes and coins
/// first, then the banks, then what a card scheme still owes — and it is what
/// makes the screen legible without a second sort. `giro_outstanding` sits with
/// the banks because it is the other half of a giro: money promised and not yet
/// taken, which is exactly the figure that explains a bank balance the books
/// and the statement disagree about.
///
/// `time_deposit` sits with them (// lane-C). It is money the company has and
/// cannot spend today, which is precisely the distinction a cash position is
/// for — and leaving it out would mean a treasurer reading this screen and a
/// treasurer reading the balance sheet disagreeing about how much the company
/// has, by whatever is on deposit.
///
/// Nine keys and not the whole map: these are the ones a treasurer counts.
/// Every other mapped meaning is a cost, a stock figure or a payable, and has a
/// screen of its own.
const MONEY_KEYS: [&str; 9] = [
    "cash",
    "petty_cash",
    "cashier_float",
    "bank_giro",
    "bank_savings",
    "time_deposit",
    "giro_outstanding",
    "card_receivable_credit",
    "card_receivable_debit",
];

/// The most recent statement imported against one money account.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoneyStatementRef {
    pub statement_id: Uuid,
    pub period_end: NaiveDate,
    /// What the bank said the account held at the end of that window.
    pub closing_minor: i64,
    /// Lines on that statement nobody has agreed with a journal line. The
    /// number that says whether the difference beside it is explained or not:
    /// a difference with no unmatched lines behind it is a real disagreement,
    /// and one with six is simply unfinished work.
    pub unmatched_count: i64,
}

/// One mapped money account, at one location.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoneyAccountRow {
    pub semantic_key: String,
    /// Which bank, which scheme. Empty when the meaning needs no narrowing.
    pub qualifier: String,
    pub site_id: String,
    pub account_code: String,
    /// The client's own name, never translated.
    pub account_name: String,
    /// The ledger balance as at the reporting date: debits minus credits, in
    /// the account's own sign and deliberately not flipped. `giro_outstanding`
    /// is a liability and comes back negative, which is what it is; a report
    /// decides how to present a balance, a balance does not decide for it.
    pub per_books_minor: i64,
    /// The latest statement imported for this account at this location on or
    /// before the reporting date, when there is one. Absent on cash, on a
    /// cashier float, and on any bank nobody has uploaded a statement for.
    pub last_statement: Option<MoneyStatementRef>,
    /// `per_books_minor - last_statement.closing_minor`. Absent, rather than
    /// zero, when there is no statement — "we agree" and "there is nothing to
    /// agree with" are different answers and must not render the same.
    pub difference_minor: Option<i64>,
}

/// Where the money is, and whether the bank agrees.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoneyOverview {
    pub as_of: NaiveDate,
    pub site_id: Option<String>,
    pub rows: Vec<MoneyAccountRow>,
}

/// Every mapped money account, per location, beside the last bank statement.
///
/// # Why this is driven off `account_map` and not off the chart
///
/// Because the question is "where is our money", and the answer is whatever
/// Finance has said carries it. Walking the chart under `10110` instead would
/// list every leaf the client keeps, including the ones no posting rule can
/// ever reach, and it would silently omit an account somebody mapped somewhere
/// unexpected. A key mapped nowhere produces no row, which is correct and
/// visible: the Account Map screen is where that is fixed.
///
/// # Why the balance is an exact match and not a prefix
///
/// Every other balance in this module matches by prefix, because the caller
/// picks an altitude in the client's tree. Here the account is one the map
/// points at, and `account_map` pins `is_group = false`, so it is a leaf and a
/// posting can only ever land on that exact code. A prefix would be the same
/// answer today and would quietly start summing a longer code the day the
/// client added one.
pub async fn money_overview(
    pool: &PgPool,
    as_of: NaiveDate,
    site_id: Option<&str>,
) -> Result<MoneyOverview, AppError> {
    let rows = sqlx::query(
        "SELECT m.semantic_key, m.qualifier, m.site_id, m.account_code,
                a.name AS account_name,
                COALESCE((SELECT SUM(l.debit_minor - l.credit_minor)
                            FROM journal_line l JOIN journal_entry e USING (entry_id)
                           WHERE l.account_code = m.account_code
                             AND l.site_id = m.site_id
                             AND e.posting_date <= $1), 0)::bigint AS per_books,
                s.statement_id, s.period_end, s.closing_minor, s.unmatched
           FROM account_map m
           JOIN ledger_account a ON a.account_code = m.account_code
           JOIN site st ON st.id = m.site_id
           -- The latest statement for this account at this location, and how
           -- much of it is still unexplained. A lateral join rather than a
           -- window, so the planner stops at the first row per account; the
           -- import date breaks a tie, because the same period can legitimately
           -- be uploaded twice and the later upload is the one in force.
           LEFT JOIN LATERAL (
               SELECT b.statement_id, b.period_end, b.closing_minor,
                      (SELECT COUNT(*)::bigint FROM bank_statement_line bl
                        WHERE bl.statement_id = b.statement_id
                          AND NOT EXISTS (SELECT 1 FROM bank_line_match bm
                                           WHERE bm.line_id = bl.line_id)) AS unmatched
                 FROM bank_statement b
                WHERE b.account_code = m.account_code
                  AND b.site_id = m.site_id
                  AND b.period_end <= $1
                ORDER BY b.period_end DESC, b.imported_at DESC
                LIMIT 1
           ) s ON true
          WHERE m.semantic_key = ANY($2)
            AND ($3::text IS NULL OR m.site_id = $3)
          ORDER BY array_position($2::text[], m.semantic_key), m.qualifier,
                   (st.kind <> 'DC'), m.site_id",
    )
    .bind(as_of)
    .bind(&MONEY_KEYS[..])
    .bind(site_id)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let per_books: i64 = row.try_get("per_books")?;
        let statement = match row.try_get::<Option<Uuid>, _>("statement_id")? {
            Some(statement_id) => Some(MoneyStatementRef {
                statement_id,
                period_end: row.try_get("period_end")?,
                closing_minor: row.try_get("closing_minor")?,
                unmatched_count: row.try_get("unmatched")?,
            }),
            None => None,
        };
        out.push(MoneyAccountRow {
            semantic_key: row.try_get("semantic_key")?,
            qualifier: row.try_get("qualifier")?,
            site_id: row.try_get("site_id")?,
            account_code: row.try_get("account_code")?,
            account_name: row.try_get("account_name")?,
            per_books_minor: per_books,
            difference_minor: statement.as_ref().map(|s| per_books - s.closing_minor),
            last_statement: statement,
        });
    }

    Ok(MoneyOverview {
        as_of,
        site_id: site_id.map(str::to_string),
        rows: out,
    })
}
