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
use serde::{Deserialize, Serialize};
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
    let locations: Vec<String> = sqlx::query("SELECT id FROM site ORDER BY (kind <> 'HO'), id")
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
         -- The date belongs INSIDE the joined set, not on the join.
         --
         -- This used to read `LEFT JOIN journal_entry e ON e.entry_id =
         -- l.entry_id AND e.posting_date <= $2`, which never eliminated
         -- anything: a line whose entry is dated after `as_of` still joined —
         -- with `e` null — and the SUM is over `l`, so it counted anyway. The
         -- endpoint echoed the date back and answered with the whole ledger at
         -- every date it was asked about. Narrowing the line set first makes
         -- the filter real, and the outer LEFT JOIN still keeps a sub-account
         -- nothing has posted to, which is the reason it is an outer join.
         SELECT c.account_code, c.name, l.site_id,
                COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS balance
           FROM child c
           LEFT JOIN (
                SELECT jl.account_code, jl.site_id, jl.debit_minor, jl.credit_minor
                  FROM journal_line jl
                  JOIN journal_entry je ON je.entry_id = jl.entry_id
                 WHERE je.posting_date <= $2
           ) l ON l.account_code LIKE c.account_code || '%'
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
    /// `BALANCE_SHEET`, `PROFIT_LOSS` or `CASH_FLOW`.
    ///
    /// On a CASH_FLOW every `amount_minor` below is the CASH effect of that
    /// account — positive means cash came in — and not the account's own
    /// balance movement. It is the one place in this module where the ledger's
    /// "debits positive" convention is deliberately inverted, because a cash
    /// flow statement is read as inflows and outflows and a revenue line
    /// showing negative would be the report arguing with its own title.
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
    ///
    /// **On a cash flow** it is `opening_cash + result - closing_cash`, and
    /// zero means the three sections account for every rupiah that moved
    /// through the cash accounts in the window. Non-zero is a real finding and
    /// not a rounding: see [`cash_flow`].
    pub out_of_balance_minor: i64,
    /// What the cash accounts held the day before `from`. CASH_FLOW only;
    /// null on the other two, which have no such thing.
    pub opening_cash_minor: Option<i64>,
    /// And at the end of `to`. CASH_FLOW only.
    pub closing_cash_minor: Option<i64>,
    /// The accounts this report treated AS cash, in the client's own codes.
    ///
    /// Sent because it is the first question to ask of any cash flow statement
    /// and the one a reader cannot otherwise answer: a figure built over a set
    /// of accounts nobody can see is a figure nobody can check. Empty on the
    /// other two statements, and empty on a cash flow means the account map
    /// names no money account for this unit — which is why the report is
    /// empty, and is fixed on the Account Map screen.
    pub cash_accounts: Vec<String>,
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
        // A different report entirely — built over the cash accounts rather
        // than over the chart's root classes — so it is its own function and
        // not a third set of classes here.
        "CASH_FLOW" => {
            let from = from.ok_or_else(|| {
                AppError::Validation("a cash flow needs a window to report; send `from`".into())
            })?;
            return cash_flow(pool, from, to, site_id).await;
        }
        other => {
            return Err(AppError::Validation(format!(
                "unknown statement {other}; expected BALANCE_SHEET, PROFIT_LOSS or CASH_FLOW"
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
        opening_cash_minor: None,
        closing_cash_minor: None,
        cash_accounts: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// The cash flow
// ---------------------------------------------------------------------------

/// The meanings that ARE cash, for the purposes of this statement.
///
/// A subset of `MONEY_KEYS` below, and the difference is the point.
/// `giro_outstanding` is a liability — money promised and not yet taken — and
/// the card receivables are owed by a scheme on a timetable. Neither is cash,
/// and counting either would make the closing figure disagree with what is in
/// the drawers and at the banks.
const CASH_KEYS: [&str; 5] = [
    "cash",
    "petty_cash",
    "cashier_float",
    "bank_giro",
    "bank_savings",
];

/// Which of the three activities a movement of cash belongs to.
///
/// # What ERPNext has that we do not
///
/// ERPNext builds its cash flow from a per-account classification: `Account`
/// carries `account_type`, and a `Cash Flow Mapping` doctype names, per
/// account, which section it falls in and whether it is added or subtracted.
/// It is the INDIRECT method — start at net profit, add back the non-cash
/// charges, adjust for working capital — and every one of those steps needs
/// that per-account data.
///
/// `ledger_account` has `root_class` and `is_group` and nothing else. Nobody
/// has classified 7,528 accounts and asking them to before the screen works
/// would be a screen that never works. Adding an unfilled `cash_flow_section`
/// column would be worse: a report whose every line reads "unclassified" while
/// looking like it has a classification.
///
/// So this is the DIRECT method, and it is honest about being that: the cash
/// accounts are read from the account map, every entry that touched one in the
/// window is opened, and the cash is attributed to the OTHER side of that
/// entry — which is what the cash was actually for. Nothing is added back and
/// nothing is inferred from profit; every figure is a movement that happened.
///
/// The section then comes from where the contra account sits in the client's
/// own chart, which is data we do have:
///
///   * classes 4–8 — revenue, cost of sales, operating and other expense — are
///     OPERATING. Tax and interest are in class 8 and stay operating, which
///     IAS 7 permits and which is what the client's own P&L already groups.
///   * `101` CURRENT ASSET and `201` HUTANG JANGKA PENDEK are OPERATING:
///     inventory, trade receivables, trade payables, accruals — working
///     capital, all of it.
///   * `102` NON CURRENT ASSET and `103` OTHER ASSETS are INVESTING. That is
///     the fixed asset register and what is spent on it.
///   * `202` PINJAMAN JANGKA PANJANG and class `3` MODAL are FINANCING:
///     long-term borrowing and the owners' money.
///
/// Two limits, said here rather than discovered:
///
///   * a SHORT-TERM bank loan lives under `201` and is read as operating. The
///     client's chart does not separate it and guessing from an account's name
///     would be a rule that breaks the first time somebody renames one.
///   * with a `site` filter, a transfer from a shop's drawer to head office's
///     bank is a real flow FOR THAT SHOP and its contra is the HO bank
///     account, under `101` — so it reads as operating. Without the filter
///     both sides are cash and it correctly contributes nothing.
fn cash_flow_section(account_code: &str) -> &'static str {
    match account_code.chars().next() {
        Some('4') | Some('5') | Some('6') | Some('7') | Some('8') => "OPERATING",
        Some('3') => "FINANCING",
        Some('1') => match &account_code[..account_code.len().min(3)] {
            "101" => "OPERATING",
            "102" | "103" => "INVESTING",
            _ => "UNCLASSIFIED",
        },
        Some('2') => match &account_code[..account_code.len().min(3)] {
            "201" => "OPERATING",
            "202" => "FINANCING",
            _ => "UNCLASSIFIED",
        },
        _ => "UNCLASSIFIED",
    }
}

/// The four sections, in the order a cash flow statement is read in.
///
/// `UNCLASSIFIED` is last and is deliberately a section rather than a silent
/// drop: an account the rule above cannot place is money that moved, and a
/// report that quietly left it out would still add up and would be wrong.
const CASH_FLOW_SECTIONS: [(&str, &str); 4] = [
    ("OPERATING", "Operating activities"),
    ("INVESTING", "Investing activities"),
    ("FINANCING", "Financing activities"),
    ("UNCLASSIFIED", "Not classified"),
];

/// Where the cash came from and where it went, over a window.
///
/// The direct method — see [`cash_flow_section`] for why, and for how a
/// movement is placed. The arithmetic:
///
///   every entry that touched a cash account in the window is opened, and each
///   of its NON-cash lines is credited with `credit - debit`, which is that
///   line's share of the cash that moved. An entry balances, so those shares
///   sum to exactly the entry's net cash movement — the decomposition is an
///   identity, not an estimate.
///
/// A transfer between two cash accounts therefore contributes nothing, which
/// is correct: moving money from a drawer to a bank is not a cash flow.
///
/// `out_of_balance_minor` is the check and it is a real one:
/// `opening + result - closing`, where opening and closing are summed straight
/// off the cash accounts and `result` is the decomposition above. Non-zero
/// means cash moved in a way the sections do not explain — the case it catches
/// is a `site`-filtered report whose entries have their other side at another
/// unit, which is the inter-unit gap this module already knows it has.
pub async fn cash_flow(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
    site_id: Option<&str>,
) -> Result<Statement, AppError> {
    if to < from {
        return Err(AppError::Validation(format!(
            "the window ends before it starts: {from} to {to}"
        )));
    }

    // What counts as cash, read from the account map for the same reason
    // `money_overview` is: the answer is whatever Finance has SAID carries
    // money, and walking the chart instead would list leaves no posting rule
    // can reach and miss one somebody mapped somewhere unexpected.
    let cash_accounts: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT m.account_code
           FROM account_map m
          WHERE m.semantic_key = ANY($1)
            AND ($2::text IS NULL OR m.site_id = $2)
          ORDER BY 1",
    )
    .bind(&CASH_KEYS[..])
    .bind(site_id)
    .fetch_all(pool)
    .await?;

    // The cash SET is (account, unit) pairs and not codes alone: the same code
    // is mapped at several units, and a `site`-filtered report must not count
    // another unit's drawer as its own.
    const CASH_SET: &str = "
        SELECT m.account_code, m.site_id
          FROM account_map m
         WHERE m.semantic_key = ANY($1)
           AND ($2::text IS NULL OR m.site_id = $2)
    ";

    // What the cash accounts held on either side of the window. Two reads of
    // one shape: `< from` is the opening, `<= to` the closing — the same
    // half-open convention every dated read in this module uses, so `to` is
    // inclusive as a date.
    const HELD: &str = "
        SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS held
          FROM journal_line l
          JOIN journal_entry e USING (entry_id)
          JOIN cash c ON c.account_code = l.account_code AND c.site_id = l.site_id
         WHERE e.posting_date
    ";
    let opening: i64 = sqlx::query_scalar(&format!("WITH cash AS ({CASH_SET}) {HELD} < $3"))
        .bind(&CASH_KEYS[..])
        .bind(site_id)
        .bind(from)
        .fetch_one(pool)
        .await?;
    let closing: i64 = sqlx::query_scalar(&format!("WITH cash AS ({CASH_SET}) {HELD} <= $3"))
        .bind(&CASH_KEYS[..])
        .bind(site_id)
        .bind(to)
        .fetch_one(pool)
        .await?;

    let rows = sqlx::query(&format!(
        "WITH cash AS ({CASH_SET}),
              touched AS (
                SELECT DISTINCT l.entry_id
                  FROM journal_line l
                  JOIN journal_entry e USING (entry_id)
                  JOIN cash c ON c.account_code = l.account_code
                             AND c.site_id = l.site_id
                 WHERE e.posting_date >= $3 AND e.posting_date <= $4
              )
         SELECT l.account_code,
                COALESCE(a.name, l.account_code) AS name,
                length(l.account_code)::int AS depth,
                COALESCE(SUM(l.credit_minor - l.debit_minor), 0)::bigint AS cash_effect
           FROM journal_line l
           JOIN touched t ON t.entry_id = l.entry_id
           LEFT JOIN ledger_account a ON a.account_code = l.account_code
          WHERE NOT EXISTS (
                    SELECT 1 FROM cash c
                     WHERE c.account_code = l.account_code
                       AND c.site_id = l.site_id)
          GROUP BY l.account_code, a.name
          ORDER BY l.account_code"
    ))
    .bind(&CASH_KEYS[..])
    .bind(site_id)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;

    let mut sections: Vec<StatementSection> = CASH_FLOW_SECTIONS
        .iter()
        .map(|(key, title)| StatementSection {
            root_class: (*key).to_string(),
            title: (*title).to_string(),
            lines: Vec::new(),
            total_minor: 0,
        })
        .collect();
    let mut result = 0i64;
    for row in &rows {
        let code: String = row.try_get("account_code")?;
        let amount: i64 = row.try_get("cash_effect")?;
        // An account both debited and credited inside the window can net to
        // nothing. Silence is not information, exactly as on the other two.
        if amount == 0 {
            continue;
        }
        let key = cash_flow_section(&code);
        let line = StatementLine {
            name: row.try_get("name")?,
            depth: row.try_get("depth")?,
            // Every line here is a leaf a posting landed on; a heading cannot
            // be posted to at all (`journal_line.is_group` is pinned false).
            is_group: false,
            amount_minor: amount,
            account_code: code,
        };
        if let Some(section) = sections.iter_mut().find(|s| s.root_class == key) {
            section.total_minor += amount;
            section.lines.push(line);
        }
        result += amount;
    }
    // A section nothing moved through says only that the chart is large.
    sections.retain(|section| !section.lines.is_empty());

    Ok(Statement {
        kind: "CASH_FLOW".into(),
        from: Some(from),
        to,
        site_id: site_id.map(str::to_string),
        sections,
        result_minor: result,
        out_of_balance_minor: opening + result - closing,
        opening_cash_minor: Some(opening),
        closing_cash_minor: Some(closing),
        cash_accounts,
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
    /// Which pot this account is, decided HERE rather than by the reader.
    ///
    /// Every client of this endpoint has to group these rows — a treasurer
    /// counts pots, not semantic keys — and a screen that worked it out from
    /// the key by substring would get `card_receivable_credit` wrong the first
    /// time somebody wrote `if key.contains("cash")`. It is also what the
    /// facet counts below are grouped by, and a facet the server counts one
    /// way while the client labels another is a filter that lies about how
    /// many rows it will leave.
    pub pot: MoneyPot,
    /// Which bank, which scheme. Empty when the meaning needs no narrowing.
    pub qualifier: String,
    pub site_id: String,
    pub account_code: String,
    /// The client's own name, never translated and never trimmed.
    ///
    /// This is the string a bookkeeper matches against their own reports, so
    /// it stays exactly as the chart spells it. The client's chart is mostly
    /// Indonesian — 4,129 of its 7,476 accounts, against 154 in English, and
    /// not one containing the word "receivable" — so translating `Piutang
    /// Kartu Kredit` to `Credit card receivable` would put a name on screen
    /// that appears in none of their reports and none of their conversations.
    ///
    /// A trimmed twin was tried alongside it on 2026-09-10 and removed the
    /// same day: the chart ends every account with its unit (`… C001`), and
    /// dropping that left every row on a single-kind list reading `Cash on
    /// Hand`. A column whose every cell says the same word says nothing, and
    /// the repetition it was removing was the lesser fault — `C001` is the
    /// CLIENT's name for the shop, and the location column is ours.
    pub account_name: String,
    /// What the site is called, rather than what this system files it under.
    ///
    /// `site_id` is ours — `store-01`, `dc` — and it appears on no document
    /// anybody outside this system holds. Worse, on the head-office rows it
    /// contradicts the account's own name: the chart says `HO` and the id says
    /// `dc`, because head office and the distribution centre share a building
    /// and this system files them under one site.
    pub site_name: String,
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

/// Which pot a money account belongs to.
///
/// Five, and the grouping is by HOW THE MONEY IS GOVERNED rather than by where
/// it physically is. Cash in a drawer and a cashier's float are the same notes
/// in the same till and are opposite kinds of money: one must be banked every
/// day, the other must never be spent. A screen that showed them as one pot is
/// a screen that lets a shop spend its float and call it takings.
///
/// `giro_outstanding` sits with the banks because it is the other half of a
/// giro — money promised and not yet taken — and it is exactly the figure that
/// explains a bank balance the books and the statement disagree about. Card
/// receivables are their own pot because they are not held at all: they are
/// owed by a scheme, on a timetable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum MoneyPot {
    Cash,
    PettyCash,
    CashierFloat,
    Bank,
    CardReceivable,
}

impl MoneyPot {
    /// The wire spelling, which is also what a facet filter sends back.
    fn as_str(self) -> &'static str {
        match self {
            Self::Cash => "CASH",
            Self::PettyCash => "PETTY_CASH",
            Self::CashierFloat => "CASHIER_FLOAT",
            Self::Bank => "BANK",
            Self::CardReceivable => "CARD_RECEIVABLE",
        }
    }

    fn from_wire(raw: &str) -> Option<Self> {
        Some(match raw {
            "CASH" => Self::Cash,
            "PETTY_CASH" => Self::PettyCash,
            "CASHIER_FLOAT" => Self::CashierFloat,
            "BANK" => Self::Bank,
            "CARD_RECEIVABLE" => Self::CardReceivable,
            _ => return None,
        })
    }
}

/// One value a filter can take, and how many rows would still be there.
///
/// The count is what makes a filter panel usable rather than a guessing game:
/// a value that would leave nothing is a value nobody should have to click to
/// find out about. Counted over everything the SEARCH matches, deliberately
/// ignoring which facets are currently ticked — so the number reads as "how
/// many of these there are", which is the question somebody has while choosing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoneyFacet {
    /// What to send back as the filter. The client's own vocabulary for the
    /// thing — a site id, a pot name — never a display string.
    pub value: String,
    /// What to draw, when it differs from the value.
    ///
    /// Absent for a pot, whose words belong to the screen ("Cash in hand" is
    /// ours, not the server's). Present for a site, because `store-01` is an
    /// id this system files it under and the list beside the filter shows
    /// `Store 01` — one panel naming things one way and the column beside it
    /// another is the reader's problem, not the schema's.
    pub label: Option<String>,
    pub count: i64,
}

/// The three things this list can be narrowed by.
///
/// `flags` is not a property of an account, it is a property of its STATE
/// today — and it is the one somebody opening this screen actually came for.
/// "Show me what disagrees with the bank" is the question; scrolling 139 rows
/// looking for red is the workaround it replaces.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoneyFacets {
    pub pots: Vec<MoneyFacet>,
    pub sites: Vec<MoneyFacet>,
    pub flags: Vec<MoneyFacet>,
}

/// Where the money is, and whether the bank agrees.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoneyOverview {
    pub as_of: NaiveDate,
    pub site_id: Option<String>,
    pub rows: Vec<MoneyAccountRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    ///
    /// Deliberately not an offset. Rows here are keyed on the account map,
    /// which somebody may be editing on the next screen while a treasurer
    /// scrolls — and an offset would then skip or repeat rows without anything
    /// saying so.
    ///
    /// **Always absent when the caller sent no `limit`.** Paging is opt-in for
    /// exactly one reason: this endpoint already has a caller that asks for the
    /// whole list and sums it, and quietly starting to answer that caller with
    /// the first fifty rows would be a silent wrong total in a finance screen.
    pub next_cursor: Option<String>,
    /// Every row the search and filters match, not just this page. Without it a
    /// screen can only say "50 accounts", which is a statement about the page
    /// size rather than about the business.
    pub total: i64,
    /// What those rows come to, added HERE.
    ///
    /// Only the server has every row. A paged list summed in the browser gives
    /// a figure that grows while somebody reads, and on a finance screen a
    /// total that changes as you scroll is worse than no total at all.
    ///
    /// Summed in each account's own sign, unflipped, exactly as
    /// `per_books_minor` is — so a `giro_outstanding` subtracts, which is what
    /// a liability does to the money on hand.
    pub total_minor: i64,
    pub facets: MoneyFacets,
}

/// What a caller is asking the money list for.
#[derive(Clone, Debug, Default)]
pub struct MoneyScope {
    pub as_of: Option<NaiveDate>,
    /// Free text, tried against the account's name, its code and its location.
    pub needle: Option<String>,
    /// Pots to keep. Empty means every pot — an empty filter and no filter are
    /// the same request, and treating them differently is how a screen ends up
    /// showing nothing the moment somebody unticks the last box.
    pub pots: Vec<String>,
    pub sites: Vec<String>,
    /// State to narrow by: `DIFFERS`, `NO_STATEMENT`, `UNMATCHED`, `NEGATIVE`.
    pub flags: Vec<String>,
    /// `default`, `balance` or `name`. Anything else falls back to `default`
    /// rather than refusing: a sort arrives from a URL somebody may have kept
    /// from an older build, and a 400 for a stale bookmark is a worse answer
    /// than the rows in the house order.
    pub sort: Option<String>,
    /// `true` for descending. Only read for `balance` and `name`; the default
    /// order is the client's own chart order and reversing it means nothing.
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent asks for everything, unpaged. See `next_cursor`.
    pub limit: Option<i64>,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// It carries the natural key of `account_map` (semantic key, qualifier,
/// site) and nothing else, whatever the list is sorted by. The seek re-reads
/// that row's own sort value in SQL, so one cursor shape serves every order.
///
/// The alternative — encoding the sort value into the cursor — needs a
/// different cursor per sort, and the version where somebody adds a fourth
/// sort and forgets the fourth cursor is the version that silently repeats
/// rows. The cost here is one extra row lookup per page, which is nothing
/// against a query that already scans the map.
#[derive(Serialize, Deserialize)]
struct MoneyCursor {
    semantic_key: String,
    qualifier: String,
    site_id: String,
}

impl MoneyCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// One money row, defined once.
///
/// Used by the page query and by the facet query, and that is the whole reason
/// it is a constant: the facets are only honest if they count exactly what the
/// page can show. Two copies of this would agree on every ordinary day and part
/// company the moment somebody adds a ninth money key.
///
/// Binds: `$1` as_of, `$2` the money keys, `$3` the search pattern or NULL.
///
/// It stops at the SEARCH. The facet filters are applied outside it, by each
/// caller, and that is what lets one definition answer two different questions
/// from the same rows: the page wants what the search AND the filters leave,
/// while the filter panel's counts want what the search alone leaves — because
/// "Bank 69" has to mean "there are 69 banks", not "there are 69 banks among
/// the ones you have already narrowed to banks".
///
/// `ord` and `dc_last` are computed here rather than only in `ORDER BY`
/// because the keyset in the page query has to compare against them, and a
/// sort expression that is not also a column is one a `WHERE` cannot see.
const MONEY_ROWS: &str = "
    SELECT *,
           -- Derived once, here, because three different places ask about
           -- them: the flag facet counts them, the filter narrows by them and
           -- the sort orders by one of them. Three spellings of \"is this
           -- account in disagreement\" is three chances to disagree.
           (closing_minor IS NOT NULL) AS has_statement,
           (per_books - closing_minor) AS difference
      FROM (
    SELECT m.semantic_key, m.qualifier, m.site_id, m.account_code,
           a.name AS account_name,
           CASE m.semantic_key
               WHEN 'cash' THEN 'CASH'
               WHEN 'petty_cash' THEN 'PETTY_CASH'
               WHEN 'cashier_float' THEN 'CASHIER_FLOAT'
               WHEN 'bank_giro' THEN 'BANK'
               WHEN 'bank_savings' THEN 'BANK'
               WHEN 'giro_outstanding' THEN 'BANK'
               ELSE 'CARD_RECEIVABLE'
           END AS pot,
           array_position($2::text[], m.semantic_key) AS ord,
           (st.kind <> 'HO') AS dc_last,
           COALESCE((SELECT SUM(l.debit_minor - l.credit_minor)
                       FROM journal_line l JOIN journal_entry e USING (entry_id)
                      WHERE l.account_code = m.account_code
                        AND l.site_id = m.site_id
                        AND e.posting_date <= $1), 0)::bigint AS per_books,
           st.name AS site_name,
           s.statement_id, s.period_end, s.closing_minor, s.unmatched
      FROM account_map m
      JOIN ledger_account a ON a.account_code = m.account_code
      JOIN site st ON st.id = m.site_id
      -- The latest statement for this account at this location, and how much
      -- of it is still unexplained. A lateral join rather than a window, so
      -- the planner stops at the first row per account.
      --
      -- \"The later upload is the one in force\" used to be this join's own
      -- opinion, expressed as a tie-break on the import date. Since 0245 it is
      -- the database's rule — at most one statement per account, unit and
      -- period has `superseded_by IS NULL` — so the filter says it directly
      -- and the tie-break stays only to order periods.
      LEFT JOIN LATERAL (
          SELECT b.statement_id, b.period_end, b.closing_minor,
                 -- Not merely unclaimed: not yet FULLY claimed. Since 0213 a
                 -- line may hold several claims, and a half-allocated line is
                 -- still a line somebody has to finish.
                 (SELECT COUNT(*)::bigint FROM bank_statement_line bl
                   WHERE bl.statement_id = b.statement_id
                     AND COALESCE((SELECT SUM(bm.allocated_minor)
                                     FROM bank_line_match bm
                                    WHERE bm.line_id = bl.line_id), 0)
                         < GREATEST(bl.debit_minor, bl.credit_minor)) AS unmatched
            FROM bank_statement b
           WHERE b.account_code = m.account_code
             AND b.site_id = m.site_id
             AND b.superseded_by IS NULL
             AND b.period_end <= $1
           ORDER BY b.period_end DESC, b.imported_at DESC
           LIMIT 1
      ) s ON true
     WHERE m.semantic_key = ANY($2)
       -- Name, code and location. Three fields because those are the three
       -- things somebody actually has in front of them: the name off a
       -- statement, the code off a journal, the shop off a phone call.
       AND ($3::text IS NULL
            OR a.name ILIKE $3 OR m.account_code ILIKE $3 OR m.site_id ILIKE $3)
    ) base
";

/// One row's flags, as SQL. Written against the columns `MONEY_ROWS` exposes.
///
/// A row can carry more than one, so this is a set rather than a category —
/// which is why the facet counts here can add up to more than the total, and
/// why that is correct rather than a bug.
const FLAG_CLAUSE: &str = "
    CASE WHEN difference IS NOT NULL AND difference <> 0 THEN 'DIFFERS' END,
    CASE WHEN pot = 'BANK' AND NOT has_statement THEN 'NO_STATEMENT' END,
    CASE WHEN unmatched > 0 THEN 'UNMATCHED' END,
    CASE WHEN per_books < 0 THEN 'NEGATIVE' END
";

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
pub async fn money_overview(pool: &PgPool, scope: MoneyScope) -> Result<MoneyOverview, AppError> {
    let as_of = scope
        .as_of
        .unwrap_or_else(|| chrono::Utc::now().date_naive());
    // A blank search is not a search. `Some("")` would compile to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));

    // An unknown value is dropped rather than refused, for the reason given on
    // `MoneyScope::sort`. Empty means "no filter", never "nothing passes" —
    // otherwise a screen shows nothing the moment somebody unticks the last
    // box, which reads as broken rather than as unfiltered.
    let pots = keep_known(&scope.pots, |raw| MoneyPot::from_wire(raw).is_some());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let flags = keep_known(&scope.flags, |raw| {
        matches!(raw, "DIFFERS" | "NO_STATEMENT" | "UNMATCHED" | "NEGATIVE")
    });

    // The sort, and the tie-break that makes it total. Every order ends in the
    // natural key of `account_map`, so no two rows can ever compare equal —
    // which is what stops a keyset from repeating or losing the rows that tie.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not. Writing
    // `(a ASC, b) > (…)` is a syntax error, and it is one the compiler cannot
    // catch because the whole clause is a string.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("balance") => ("per_books", scope.desc),
        Some("name") => ("account_name", scope.desc),
        // The house order: the client's own chart order, then head office
        // before the shops. Reversing it would mean nothing, so `dir` is not
        // read here.
        _ => ("ord, dc_last", false),
    };
    let cols = format!("{lead}, semantic_key, qualifier, site_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!(
        "{} {dir}, semantic_key {dir}, qualifier {dir}, site_id {dir}",
        lead.replace(", ", &format!(" {dir}, "))
    );
    // Which way the seek points follows the direction, or paging a descending
    // list walks back up it.
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(MoneyCursor::decode)
        .transpose()?;
    // 200 whatever a caller asks for: a page is something a person scrolls, and
    // a client asking for ten thousand has decided this is a bulk export. It is
    // not one.
    let limit = scope.limit.map(|value| value.clamp(1, 200));

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor — see `MoneyCursor`.
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({MONEY_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched
              WHERE ($4::text[] IS NULL OR pot = ANY($4))
                AND ($5::text[] IS NULL OR site_id = ANY($5))
                AND ($6::text[] IS NULL OR ARRAY[{FLAG_CLAUSE}] && $6)
         )
         SELECT * FROM kept
          WHERE $7::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept
                                  WHERE semantic_key = $7 AND qualifier = $8
                                    AND site_id = $9)
          ORDER BY {order}
          LIMIT $10"
    );
    let rows = sqlx::query(&sql)
        .bind(as_of)
        .bind(&MONEY_KEYS[..])
        .bind(&needle)
        .bind(&pots)
        .bind(&sites)
        .bind(&flags)
        .bind(cursor.as_ref().map(|c| c.semantic_key.clone()))
        .bind(cursor.as_ref().map(|c| c.qualifier.clone()))
        .bind(cursor.as_ref().map(|c| c.site_id.clone()))
        // No limit means no limit. `NULL` is how Postgres spells that in
        // `LIMIT`, which is why this is an Option rather than a large number
        // standing in for one.
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match limit {
        // Unpaged: there is no next page by construction, and issuing a cursor
        // would invite a caller to page through an answer it already has.
        None => None,
        Some(limit) if (rows.len() as i64) < limit => None,
        Some(_) => match rows.last() {
            Some(row) => Some(
                MoneyCursor {
                    semantic_key: row.try_get("semantic_key")?,
                    qualifier: row.try_get("qualifier")?,
                    site_id: row.try_get("site_id")?,
                }
                .encode()?,
            ),
            None => None,
        },
    };

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(money_row_from(row)?);
    }

    let (total, total_minor, facets) =
        money_facets(pool, as_of, needle.as_deref(), &pots, &sites, &flags).await?;
    Ok(MoneyOverview {
        as_of,
        // What the caller narrowed to, echoed back — and only meaningful when
        // they named exactly one. A list of three sites has no single answer
        // and must not pretend to.
        site_id: match scope.sites.as_slice() {
            [only] => Some(only.clone()),
            _ => None,
        },
        rows: out,
        next_cursor,
        total,
        total_minor,
        facets,
    })
}

/// The values this server recognises, and nothing else.
///
/// `None` for an empty result, which every caller reads as "no filter". A
/// filter naming only values this build has never heard of is the same request
/// as no filter — and answering it with an empty list would blame the reader
/// for a URL that went stale.
fn keep_known(raw: &[String], known: impl Fn(&str) -> bool) -> Option<Vec<String>> {
    let kept: Vec<String> = raw.iter().filter(|value| known(value)).cloned().collect();
    (!kept.is_empty()).then_some(kept)
}

/// One row of `MONEY_ROWS`, as the type a screen reads.
fn money_row_from(row: &sqlx::postgres::PgRow) -> Result<MoneyAccountRow, AppError> {
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
    let pot_wire: String = row.try_get("pot")?;
    Ok(MoneyAccountRow {
        semantic_key: row.try_get("semantic_key")?,
        // The CASE in `MONEY_ROWS` covers every key in `MONEY_KEYS`, and the
        // WHERE restricts to those, so this cannot miss. Falling back rather
        // than erroring keeps a new key from taking the whole screen down: it
        // will appear in the wrong pot, visibly, which is a bug somebody
        // reports rather than a 500 nobody can act on.
        pot: MoneyPot::from_wire(&pot_wire).unwrap_or(MoneyPot::Cash),
        qualifier: row.try_get("qualifier")?,
        site_id: row.try_get("site_id")?,
        account_code: row.try_get("account_code")?,
        account_name: row.try_get("account_name")?,
        site_name: row.try_get("site_name")?,
        per_books_minor: per_books,
        difference_minor: statement
            .as_ref()
            .map(|statement| per_books - statement.closing_minor),
        last_statement: statement,
    })
}

/// How many rows there are, what they come to, and how they split.
///
/// Counted from the SAME `MONEY_ROWS` the page is drawn from. Two copies of
/// the row definition would agree on every ordinary day and part company the
/// moment somebody adds a ninth money key — and the symptom would be a filter
/// promising eleven rows and delivering nine.
///
/// The two scopes here are deliberate and were once wrongly the same number:
///
///   per-value counts read the SEARCHED set, ignoring what is ticked. The
///     number beside `Bank` answers "how many banks are there", which is the
///     question somebody has while deciding whether to tick it. Counting the
///     already-filtered set instead shows every ticked box its own row count
///     and every unticked one a zero.
///   the total and the sum read the FILTERED set, because they describe the
///     list on screen. When these were one number the page showed 69 rows
///     under a heading that said 139.
async fn money_facets(
    pool: &PgPool,
    as_of: NaiveDate,
    needle: Option<&str>,
    pots: &Option<Vec<String>>,
    sites: &Option<Vec<String>>,
    flags: &Option<Vec<String>>,
) -> Result<(i64, i64, MoneyFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({MONEY_ROWS}), kept AS (
             SELECT * FROM searched
              WHERE ($4::text[] IS NULL OR pot = ANY($4))
                AND ($5::text[] IS NULL OR site_id = ANY($5))
                AND ($6::text[] IS NULL OR ARRAY[{FLAG_CLAUSE}] && $6)
         )
         SELECT 'pot' AS kind, pot AS value, NULL::text AS label, COUNT(*)::bigint AS n
           FROM searched GROUP BY pot
          UNION ALL
         SELECT 'site', site_id, site_name, COUNT(*)::bigint FROM searched GROUP BY site_id, site_name
          UNION ALL
         -- A row can carry several flags, so these counts can add up to more
         -- than the total. That is the shape of the question, not an error.
         SELECT 'flag', flag, NULL::text, COUNT(*)::bigint
           FROM searched, unnest(ARRAY[{FLAG_CLAUSE}]) AS flag
          WHERE flag IS NOT NULL GROUP BY flag
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept
          UNION ALL
         SELECT 'sum', '', NULL::text, COALESCE(SUM(per_books), 0)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(as_of)
        .bind(&MONEY_KEYS[..])
        .bind(needle)
        .bind(pots)
        .bind(sites)
        .bind(flags)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut total_minor = 0i64;
    let mut pots_out = Vec::new();
    let mut sites_out = Vec::new();
    let mut flags_out = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "pot" => pots_out.push(MoneyFacet {
                value,
                label,
                count: n,
            }),
            "site" => sites_out.push(MoneyFacet {
                value,
                label,
                count: n,
            }),
            "flag" => flags_out.push(MoneyFacet {
                value,
                label,
                count: n,
            }),
            "sum" => total_minor = n,
            _ => total = n,
        }
    }
    // Biggest first: a filter list is read top-down and the value somebody is
    // most likely to want is the one with the most behind it. Ties break on the
    // name so the order is stable between calls — a list that reshuffles under
    // the cursor is a list nobody can click.
    for list in [&mut pots_out, &mut sites_out, &mut flags_out] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((
        total,
        total_minor,
        MoneyFacets {
            pots: pots_out,
            sites: sites_out,
            flags: flags_out,
        },
    ))
}
