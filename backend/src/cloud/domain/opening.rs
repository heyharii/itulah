//! The arithmetic of a cutover: reading the sheet, agreeing the totals, and
//! deciding what a piece of opening stock is worth.
//!
//! Everything here is a decision somebody will be asked to defend a year from
//! now, in front of an auditor holding a printout from the software the client
//! used before this one. So none of it is allowed to depend on when it was run,
//! on what the database happened to hold, or on which way somebody scrolled a
//! screen. Every fact arrives as an argument, and a rehearsal computes exactly
//! the numbers the real import will post — which is the only reason a rehearsal
//! is worth doing.
//!
//! # Three decisions, and why each is here rather than beside the SQL
//!
//! **Reading the sheet.** A CSV parser is not usually interesting, and this one
//! is, for one reason: the client's account names contain commas. "Piutang
//! Affiliasi Pembiayaan CIKUPA, C005" splits into two fields under the obvious
//! `line.split(',')`, and the row after it is off by one, and the balance still
//! ties because the misread column was a name. So the parser handles quoting,
//! and it is here where it can be checked exhaustively rather than through a
//! database.
//!
//! **Agreeing the totals.** An opening trial balance either balances or it does
//! not, per unit, and the difference is the number a person needs. Doing this in
//! SQL would put the most important refusal in the system inside a query plan.
//!
//! **Pricing the stock.** The sharpest one. FIFO needs a layer and a layer needs
//! a price, and the client's own system is periodic — it expensed the purchases
//! and counted the shelf, so there are no layers to bring across. Somebody has
//! to decide what the goods on hand cost. This module decides it from the facts
//! it is handed and, crucially, SAYS WHICH RULE IT USED. A fallback that looked
//! like a real purchase price would be the worst outcome available: every figure
//! plausible, half of them invented, and nothing on the record saying which.
//!
//! # Money and dates
//!
//! Amounts are whole minor units, like everywhere else in this crate. Dates do
//! not appear at all — a kernel that can name a date is one line from asking for
//! today's, and nothing here needs one.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Reading the sheet
// ---------------------------------------------------------------------------

/// A row of an import file, with the line number it came from.
///
/// The line number is carried rather than recomputed because it is the only
/// thing that makes a refusal actionable: "row 412 names an account that is a
/// heading" sends somebody to a line in a file, and "an account is a heading"
/// sends them to read eight hundred of them.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CsvRow {
    /// One-based, counting the header as line 1, so it matches what a
    /// spreadsheet shows in the margin.
    pub line_number: usize,
    fields: Vec<String>,
    /// Shared with the table; duplicated per row so a row can be handed around
    /// on its own and still answer `field`.
    headers: Vec<String>,
}

impl CsvRow {
    /// The value under a named column, trimmed. Absent and empty are the same
    /// answer deliberately: a spreadsheet writes a missing optional column as
    /// an empty cell, and a caller that had to tell those apart would be
    /// writing the same `unwrap_or_default` at every call site.
    pub fn field(&self, name: &str) -> &str {
        match self.headers.iter().position(|header| header == name) {
            Some(index) => self.fields.get(index).map(String::as_str).unwrap_or(""),
            None => "",
        }
    }

    /// Whether the file carried this column at all, which is a different
    /// question from whether this row filled it in.
    pub fn has_column(&self, name: &str) -> bool {
        self.headers.iter().any(|header| header == name)
    }
}

/// What is wrong with the file, said in terms of the file.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CsvRefusal {
    /// No rows: an empty file, or a header with nothing under it.
    Empty,
    /// A header the import needs is not in the file.
    MissingColumn { column: String },
    /// The same header twice. Refused rather than resolved, because either
    /// choice would silently discard a column somebody filled in.
    DuplicateColumn { column: String },
    /// A row with more or fewer fields than the header promised. Almost always
    /// an unquoted comma, which is why the message says so.
    WrongFieldCount {
        line_number: usize,
        expected: usize,
        found: usize,
    },
    /// A quoted field that never closes, so everything after it is inside it.
    UnterminatedQuote { line_number: usize },
}

impl CsvRefusal {
    pub fn message(&self) -> String {
        match self {
            Self::Empty => {
                "the import file carries no rows — it is either empty or a header with nothing \
                 under it; a cutover with nothing in it is not a cutover"
                    .to_string()
            }
            Self::MissingColumn { column } => format!(
                "the file has no `{column}` column. The header row names the columns and the \
                 order does not matter, but a column this import needs cannot be inferred"
            ),
            Self::DuplicateColumn { column } => format!(
                "`{column}` appears twice in the header row. Which one was meant is not \
                 something this import is willing to guess at, because guessing wrong would \
                 quietly drop whichever column somebody actually filled in"
            ),
            Self::WrongFieldCount {
                line_number,
                expected,
                found,
            } => format!(
                "line {line_number} has {found} fields and the header promised {expected}. The \
                 usual cause is a comma inside a value that was not quoted — the client's own \
                 account names contain them"
            ),
            Self::UnterminatedQuote { line_number } => format!(
                "a quoted value starting on line {line_number} is never closed, so everything \
                 after it has been read as part of it"
            ),
        }
    }
}

/// Split a CSV field-by-field, honouring quotes.
///
/// `"` opens and closes a field; `""` inside one is a literal quote. Anything
/// outside quotes is taken literally, including stray quotes in the middle of a
/// word, because a file written by hand out of a spreadsheet has them and
/// refusing would help nobody.
///
/// Returns the fields and how many physical lines were consumed — a quoted
/// value may legitimately contain a newline.
fn split_record(text: &[char], from: usize) -> Result<(Vec<String>, usize, usize), usize> {
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut index = from;
    let mut lines_consumed = 0usize;
    let mut in_quotes = false;

    while index < text.len() {
        let ch = text[index];
        if in_quotes {
            if ch == '"' {
                if text.get(index + 1) == Some(&'"') {
                    field.push('"');
                    index += 2;
                    continue;
                }
                in_quotes = false;
                index += 1;
                continue;
            }
            if ch == '\n' {
                lines_consumed += 1;
            }
            field.push(ch);
            index += 1;
            continue;
        }
        match ch {
            '"' if field.trim().is_empty() => {
                field.clear();
                in_quotes = true;
                index += 1;
            }
            ',' => {
                fields.push(field.trim().to_string());
                field = String::new();
                index += 1;
            }
            '\r' => index += 1,
            '\n' => {
                index += 1;
                lines_consumed += 1;
                fields.push(field.trim().to_string());
                return Ok((fields, index, lines_consumed));
            }
            other => {
                field.push(other);
                index += 1;
            }
        }
    }
    if in_quotes {
        return Err(lines_consumed);
    }
    fields.push(field.trim().to_string());
    Ok((fields, index, lines_consumed + 1))
}

/// Parse a whole file into rows keyed by the header names.
///
/// Blank lines are skipped wherever they appear: a file exported from a
/// spreadsheet ends with a few, and a trailing empty row that refused the whole
/// import would be a bad first experience of the most careful endpoint in the
/// system.
pub fn parse_csv(text: &str) -> Result<Vec<CsvRow>, CsvRefusal> {
    let chars: Vec<char> = text.chars().collect();
    let mut cursor = 0usize;
    let mut line_number = 1usize;
    let mut headers: Option<Vec<String>> = None;
    let mut rows = Vec::new();

    while cursor < chars.len() {
        let record_line = line_number;
        let (fields, next, consumed) =
            split_record(&chars, cursor).map_err(|_| CsvRefusal::UnterminatedQuote {
                line_number: record_line,
            })?;
        cursor = next;
        line_number += consumed;

        if fields.iter().all(|field| field.is_empty()) {
            continue;
        }

        match &headers {
            None => {
                for (index, header) in fields.iter().enumerate() {
                    if fields[index + 1..].contains(header) {
                        return Err(CsvRefusal::DuplicateColumn {
                            column: header.clone(),
                        });
                    }
                }
                headers = Some(fields);
            }
            Some(names) => {
                if fields.len() != names.len() {
                    return Err(CsvRefusal::WrongFieldCount {
                        line_number: record_line,
                        expected: names.len(),
                        found: fields.len(),
                    });
                }
                rows.push(CsvRow {
                    line_number: record_line,
                    fields,
                    headers: names.clone(),
                });
            }
        }
    }

    if headers.is_none() || rows.is_empty() {
        return Err(CsvRefusal::Empty);
    }
    Ok(rows)
}

/// Refuse a file that does not carry every column the import needs.
///
/// Checked once, up front, rather than discovered on row one: a file missing a
/// column is a file somebody exported wrongly, and telling them after four
/// hundred rows of other findings buries the one thing they have to fix.
pub fn require_columns(rows: &[CsvRow], required: &[&str]) -> Result<(), CsvRefusal> {
    let Some(first) = rows.first() else {
        return Err(CsvRefusal::Empty);
    };
    for column in required {
        if !first.has_column(column) {
            return Err(CsvRefusal::MissingColumn {
                column: (*column).to_string(),
            });
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Reading a figure a person typed
// ---------------------------------------------------------------------------

/// Why a cell that should hold money does not.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AmountRefusal {
    /// Something that is not a number at all.
    NotANumber { value: String },
    /// A fraction of a rupiah. This ledger keeps whole rupiah everywhere, so a
    /// figure with real decimals cannot be carried across without somebody
    /// deciding how to round it — and that decision is not this parser's.
    HasFraction { value: String },
    /// Digits grouped in a way that is not thousands, so which separator is the
    /// decimal point is genuinely ambiguous.
    AmbiguousGrouping { value: String },
    /// A figure too large for the ledger's own arithmetic.
    TooLarge { value: String },
}

impl AmountRefusal {
    pub fn message(&self) -> String {
        match self {
            Self::NotANumber { value } => {
                format!("`{value}` is not an amount")
            }
            Self::HasFraction { value } => format!(
                "`{value}` has a fraction of a rupiah in it. This ledger keeps whole rupiah \
                 throughout, so rounding it is a decision somebody has to make on the sheet \
                 rather than one this import will make quietly on their behalf"
            ),
            Self::AmbiguousGrouping { value } => format!(
                "`{value}` groups its digits in a way that is not thousands, so there is no \
                 telling whether the separator is a thousands mark or a decimal point. Write \
                 it as plain digits"
            ),
            Self::TooLarge { value } => {
                format!("`{value}` is larger than this ledger can hold")
            }
        }
    }
}

/// Read money out of a cell, in whichever of the two conventions it was written.
///
/// This is more careful than a `parse::<i64>()` for a reason worth stating. The
/// client's reports come out of Seventhsoft in Indonesian convention —
/// `1.250.000` — and a spreadsheet that has been round-tripped through an
/// English locale writes the same figure `1,250,000`. Both are seven-digit
/// numbers, and both are a completely different number if the separator is read
/// as a decimal point. An opening balance that is out by a factor of a thousand
/// on one line still balances if the same line was misread on both sides, and
/// nobody finds it until a year later.
///
/// So: the LAST separator decides. Three digits behind it and it is a thousands
/// mark; anything else and it is a decimal point, which is then required to be
/// zero — `1.250.000,-` and `1,250,000.00` both mean the same whole rupiah, and
/// `1250000.50` is refused rather than rounded. Every remaining group must be
/// exactly three digits, so a figure that is grouped like neither convention is
/// refused instead of being silently concatenated.
///
/// An empty cell is zero. A trial balance writes one of its two money columns
/// empty on every single row, and making the caller special-case that would put
/// the same `unwrap_or(0)` at four call sites.
pub fn parse_opening_amount(raw: &str) -> Result<i64, AmountRefusal> {
    let refuse = |kind: fn(String) -> AmountRefusal| kind(raw.trim().to_string());
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(0);
    }

    // Accountants write a negative in brackets, and a trial balance exported
    // out of anything will have some.
    let (body, negative) = match trimmed.strip_prefix('(').and_then(|r| r.strip_suffix(')')) {
        Some(inner) => (inner.trim(), true),
        None => match trimmed.strip_prefix('-') {
            Some(inner) => (inner.trim(), true),
            None => (trimmed.strip_prefix('+').unwrap_or(trimmed).trim(), false),
        },
    };
    let body: String = body
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '\u{a0}')
        .collect();
    // `-` on its own is how a nil is written on an Indonesian ledger, and it is
    // written a great deal.
    if body.is_empty() || body == "-" {
        return Ok(0);
    }

    let mut digits = String::new();
    let mut groups: Vec<String> = vec![String::new()];
    for character in body.chars() {
        match character {
            '0'..='9' => {
                let last = groups.len() - 1;
                groups[last].push(character);
            }
            '.' | ',' => groups.push(String::new()),
            '-' if groups.len() > 1 && groups.last().is_some_and(String::is_empty) => {
                // The `,-` that ends an Indonesian figure: a decimal point with
                // a dash where the zeroes would be.
                let last = groups.len() - 1;
                groups[last].push('0');
            }
            _ => return Err(refuse(|value| AmountRefusal::NotANumber { value })),
        }
    }

    // With separators present, the last group decides what they were. Three
    // digits and every separator was a thousands mark; anything else and the
    // last one was a decimal point.
    if groups.len() > 1 {
        let last = groups.last().cloned().unwrap_or_default();
        if last.len() != 3 {
            if !last.chars().all(|c| c == '0') {
                return Err(refuse(|value| AmountRefusal::HasFraction { value }));
            }
            groups.pop();
        }
    }
    if groups.is_empty() || groups.iter().any(String::is_empty) {
        return Err(refuse(|value| AmountRefusal::NotANumber { value }));
    }
    if groups.len() > 1 {
        if groups[0].len() > 3 {
            return Err(refuse(|value| AmountRefusal::AmbiguousGrouping { value }));
        }
        if groups[1..].iter().any(|group| group.len() != 3) {
            return Err(refuse(|value| AmountRefusal::AmbiguousGrouping { value }));
        }
    }
    for group in &groups {
        digits.push_str(group);
    }

    let magnitude: i64 = digits
        .parse()
        .map_err(|_| refuse(|value| AmountRefusal::TooLarge { value }))?;
    Ok(if negative { -magnitude } else { magnitude })
}

// ---------------------------------------------------------------------------
// Agreeing the totals
// ---------------------------------------------------------------------------

/// One imported trial balance row, as arithmetic sees it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OpeningAmount {
    /// The unit whose books the row is in (0608).
    pub unit_id: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
}

/// What one unit's opening balance adds up to.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningUnitTotal {
    pub unit_id: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    /// Debits less credits. Signed, and not an absolute value: which way a
    /// trial balance is out is half of finding out why.
    pub difference_minor: i64,
    pub lines: i64,
}

impl OpeningUnitTotal {
    pub const fn agrees(&self) -> bool {
        self.difference_minor == 0
    }
}

/// Sum the sheet, one total per unit, units in the order they first appear.
///
/// First-appearance order and not sorted, because the file's own order is what
/// a person is looking at while they read the report.
pub fn opening_unit_totals(rows: &[OpeningAmount]) -> Vec<OpeningUnitTotal> {
    let mut totals: Vec<OpeningUnitTotal> = Vec::new();
    for row in rows {
        match totals.iter_mut().find(|total| total.unit_id == row.unit_id) {
            Some(total) => {
                total.debit_minor += row.debit_minor;
                total.credit_minor += row.credit_minor;
                total.difference_minor = total.debit_minor - total.credit_minor;
                total.lines += 1;
            }
            None => totals.push(OpeningUnitTotal {
                unit_id: row.unit_id.clone(),
                debit_minor: row.debit_minor,
                credit_minor: row.credit_minor,
                difference_minor: row.debit_minor - row.credit_minor,
                lines: 1,
            }),
        }
    }
    totals
}

// ---------------------------------------------------------------------------
// Pricing the stock
// ---------------------------------------------------------------------------

/// How a piece of opening stock got the price it got.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum OpeningPriceBasis {
    /// What the client last actually paid a supplier for it, off their own
    /// purchase history. The only basis on this list that is not a compromise,
    /// and the one the import prefers whenever the data gives it.
    LastPurchase,
    /// What this article is already costing in this system, averaged over the
    /// queue. Only reachable in a phased cutover, where part of the estate has
    /// been live long enough to have layers.
    SystemAverage,
    /// A figure a person typed into the sheet because neither of the above
    /// existed. Real money, decided by somebody, and recorded as their decision
    /// rather than as a fact.
    StatedFallback,
}

impl OpeningPriceBasis {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LastPurchase => "LAST_PURCHASE",
            Self::SystemAverage => "SYSTEM_AVERAGE",
            Self::StatedFallback => "STATED_FALLBACK",
        }
    }

    /// Whether this price came from something the client actually paid.
    ///
    /// The question the cutover report asks of every line, and the reason the
    /// basis is stored at all.
    pub const fn is_fallback(self) -> bool {
        !matches!(self, Self::LastPurchase)
    }
}

/// Everything known about one line of the stock sheet before it is priced.
///
/// All three prices are optional and all three are handed in by the caller. The
/// kernel does not go looking for any of them, which is what lets a rehearsal
/// and the real run be guaranteed to price identically: they are handed the
/// same facts and there is nowhere else for the answer to come from.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OpeningStockFacts {
    pub quantity: i64,
    /// What the client's own records say they last paid, per piece.
    pub last_purchase_minor: Option<i64>,
    /// What this system already carries this article at, per piece, averaged
    /// over whatever is left in its queue.
    pub system_average_minor: Option<i64>,
    /// What somebody wrote in the sheet's fallback column.
    pub stated_minor: Option<i64>,
}

/// A price, and the record of how it was chosen.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OpeningPrice {
    pub unit_cost_minor: i64,
    pub basis: OpeningPriceBasis,
    /// A sentence for the record, so the stock sheet can be read by somebody
    /// who was not in the room. Stored on the row, not recomputed.
    pub note: String,
}

/// A stock line that cannot be priced.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OpeningPriceRefusal {
    /// A holding of nothing, or of less than nothing.
    QuantityNotPositive,
    /// A price below zero. Goods the supplier paid us to take are a credit
    /// note, not an opening balance.
    PriceIsNegative,
    /// Nothing to price it with. **This is the refusal this module exists for.**
    NoBasis,
}

impl OpeningPriceRefusal {
    pub const fn message(self) -> &'static str {
        match self {
            Self::QuantityNotPositive => {
                "an opening stock line has to hold something: a quantity of zero creates a cost \
                 layer nothing can ever be taken from, and a negative one is a position this \
                 ledger has no way to represent"
            }
            Self::PriceIsNegative => {
                "an opening unit cost cannot be negative; goods worth less than nothing are a \
                 supplier credit, which is a different document"
            }
            Self::NoBasis => {
                "there is no price for this article and no fallback was given, so this line \
                 cannot be valued. It is deliberately refused rather than opened at zero: a \
                 layer costing nothing would sell at a hundred per cent margin, quietly, and \
                 the first person to notice would be looking at a year of gross profit that \
                 never existed"
            }
        }
    }
}

/// Decide what a line of the opening stock sheet is worth, and say why.
///
/// The order is the whole rule and it is deliberate: what the client actually
/// paid, then what this system already believes, then what a person decided.
/// Each step down is a step further from evidence, and each is recorded as such.
///
/// A price of exactly zero from a real purchase is accepted — free goods happen,
/// and refusing them would be refusing a fact. A price of zero because nobody
/// gave one is refused, which is the distinction the whole function is for.
pub fn price_opening_stock(facts: &OpeningStockFacts) -> Result<OpeningPrice, OpeningPriceRefusal> {
    if facts.quantity <= 0 {
        return Err(OpeningPriceRefusal::QuantityNotPositive);
    }
    for candidate in [
        facts.last_purchase_minor,
        facts.system_average_minor,
        facts.stated_minor,
    ]
    .into_iter()
    .flatten()
    {
        if candidate < 0 {
            return Err(OpeningPriceRefusal::PriceIsNegative);
        }
    }

    if let Some(unit) = facts.last_purchase_minor {
        return Ok(OpeningPrice {
            unit_cost_minor: unit,
            basis: OpeningPriceBasis::LastPurchase,
            note: format!("The client's own last purchase price, {unit} per piece"),
        });
    }
    if let Some(unit) = facts.system_average_minor {
        return Ok(OpeningPrice {
            unit_cost_minor: unit,
            basis: OpeningPriceBasis::SystemAverage,
            note: format!(
                "No purchase price was carried over, so this line took the average of what \
                 this system already holds the article at, {unit} per piece"
            ),
        });
    }
    if let Some(unit) = facts.stated_minor {
        return Ok(OpeningPrice {
            unit_cost_minor: unit,
            basis: OpeningPriceBasis::StatedFallback,
            note: format!(
                "Neither a purchase price nor an existing layer was available; {unit} per \
                 piece was stated on the sheet by whoever prepared it"
            ),
        });
    }
    Err(OpeningPriceRefusal::NoBasis)
}

// ---------------------------------------------------------------------------
// Making the two sides agree
// ---------------------------------------------------------------------------

/// One control total, and whether the two ways of computing it agree.
///
/// Used for both reconciliations this lane performs — opening cost layers
/// against the inventory account, and opening sub-ledger items against their
/// control account — because they are the same question asked about different
/// numbers, and a second struct would be a second place to get the sign wrong.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningReconciliation {
    /// What the document being imported adds up to.
    pub imported_minor: i64,
    /// What the general ledger says, as at the cutover date, on the account
    /// that document is supposed to be explaining.
    pub ledger_minor: i64,
    /// Imported less ledger. Signed: too much stock and too little are
    /// different mistakes with different causes.
    pub difference_minor: i64,
    pub agrees: bool,
}

/// Compare a sub-ledger total with the account it explains.
pub const fn reconcile_opening(imported_minor: i64, ledger_minor: i64) -> OpeningReconciliation {
    let difference = imported_minor - ledger_minor;
    OpeningReconciliation {
        imported_minor,
        ledger_minor,
        difference_minor: difference,
        agrees: difference == 0,
    }
}

/// Sign a general ledger balance to the side an open-item ledger faces.
///
/// The same convention `payment_ledger_integrity` uses in 0145, restated here
/// because the import has to predict what that check will say BEFORE it posts
/// anything. Two places computing this is a risk; two places computing it
/// differently is the bug, and this is the one of the two that can be tested
/// without a database.
pub const fn signed_to_side(debits_minor: i64, credits_minor: i64, receivable: bool) -> i64 {
    if receivable {
        debits_minor - credits_minor
    } else {
        credits_minor - debits_minor
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(unit: &str, debit: i64, credit: i64) -> OpeningAmount {
        OpeningAmount {
            unit_id: unit.to_string(),
            debit_minor: debit,
            credit_minor: credit,
        }
    }

    #[test]
    fn a_quoted_comma_stays_inside_its_field() {
        let rows = parse_csv(
            "account_code,name\n101100100100,\"Piutang Affiliasi Pembiayaan CIKUPA, C005\"\n",
        )
        .unwrap_or_else(|refusal| panic!("{}", refusal.message()));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].field("account_code"), "101100100100");
        assert_eq!(
            rows[0].field("name"),
            "Piutang Affiliasi Pembiayaan CIKUPA, C005",
            "the comma in the client's own account name is part of the name"
        );
    }

    #[test]
    fn a_doubled_quote_is_one_quote() {
        let rows = parse_csv("a,b\n1,\"say \"\"hello\"\"\"\n")
            .unwrap_or_else(|refusal| panic!("{}", refusal.message()));
        assert_eq!(rows[0].field("b"), "say \"hello\"");
    }

    #[test]
    fn an_unquoted_comma_is_named_by_line_and_not_absorbed() {
        let refusal = parse_csv("a,b\n1,two,three\n").expect_err("three fields into two columns");
        assert_eq!(
            refusal,
            CsvRefusal::WrongFieldCount {
                line_number: 2,
                expected: 2,
                found: 3
            }
        );
        assert!(refusal.message().contains("line 2"));
    }

    #[test]
    fn blank_lines_anywhere_are_skipped() {
        let rows = parse_csv("a\n\n1\n\n\n2\n\n")
            .unwrap_or_else(|refusal| panic!("{}", refusal.message()));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].field("a"), "1");
        assert_eq!(rows[1].field("a"), "2");
    }

    #[test]
    fn the_line_number_is_the_one_a_spreadsheet_shows() {
        let rows = parse_csv("a\n1\n2\n").unwrap_or_else(|refusal| panic!("{}", refusal.message()));
        assert_eq!(rows[0].line_number, 2, "the header is line 1");
        assert_eq!(rows[1].line_number, 3);
    }

    #[test]
    fn a_header_named_twice_is_refused_rather_than_resolved() {
        let refusal = parse_csv("a,b,a\n1,2,3\n").expect_err("two columns called a");
        assert_eq!(
            refusal,
            CsvRefusal::DuplicateColumn {
                column: "a".to_string()
            }
        );
    }

    #[test]
    fn an_unterminated_quote_names_where_it_opened() {
        let refusal = parse_csv("a\n\"never closed\n").expect_err("the quote never closes");
        assert_eq!(refusal, CsvRefusal::UnterminatedQuote { line_number: 2 });
    }

    #[test]
    fn a_missing_column_is_named() {
        let rows = parse_csv("a\n1\n").unwrap_or_else(|refusal| panic!("{}", refusal.message()));
        let refusal = require_columns(&rows, &["a", "quantity"]).expect_err("no quantity column");
        assert_eq!(
            refusal,
            CsvRefusal::MissingColumn {
                column: "quantity".to_string()
            }
        );
    }

    #[test]
    fn the_same_figure_in_two_conventions_is_the_same_figure() {
        for written in [
            "1250000",
            "1.250.000",
            "1,250,000",
            "1.250.000,-",
            "1,250,000.00",
        ] {
            assert_eq!(
                parse_opening_amount(written),
                Ok(1_250_000),
                "{written} is one and a quarter million rupiah however it is punctuated"
            );
        }
    }

    #[test]
    fn an_empty_cell_and_a_dash_are_both_nil() {
        assert_eq!(parse_opening_amount(""), Ok(0));
        assert_eq!(parse_opening_amount("   "), Ok(0));
        assert_eq!(parse_opening_amount("-"), Ok(0));
        assert_eq!(parse_opening_amount("0"), Ok(0));
    }

    #[test]
    fn a_bracketed_figure_is_negative_and_so_is_a_signed_one() {
        assert_eq!(parse_opening_amount("(1.250.000)"), Ok(-1_250_000));
        assert_eq!(parse_opening_amount("-1,250,000"), Ok(-1_250_000));
        assert_eq!(parse_opening_amount("+750"), Ok(750));
    }

    #[test]
    fn a_real_fraction_is_refused_rather_than_rounded() {
        assert_eq!(
            parse_opening_amount("1250000.50"),
            Err(AmountRefusal::HasFraction {
                value: "1250000.50".to_string()
            }),
            "half a rupiah is a decision for whoever prepared the sheet, not for this parser"
        );
    }

    #[test]
    fn digits_grouped_like_neither_convention_are_refused_and_not_concatenated() {
        // The failure this parser exists for: `12.50` read as 1,250 is a
        // hundredfold error that still balances if both sides carry it.
        assert!(matches!(
            parse_opening_amount("1.25.000"),
            Err(AmountRefusal::AmbiguousGrouping { .. })
        ));
        assert!(matches!(
            parse_opening_amount("12345.678.9"),
            Err(AmountRefusal::HasFraction { .. } | AmountRefusal::AmbiguousGrouping { .. })
        ));
    }

    #[test]
    fn something_that_is_not_a_number_says_so_and_quotes_itself() {
        let refusal = parse_opening_amount("n/a").expect_err("not a number");
        assert_eq!(
            refusal,
            AmountRefusal::NotANumber {
                value: "n/a".to_string()
            }
        );
        assert!(refusal.message().contains("n/a"));
    }

    #[test]
    fn a_sheet_that_agrees_shows_no_difference_in_any_unit() {
        let totals = opening_unit_totals(&[
            row("unit-a", 500, 0),
            row("unit-a", 0, 500),
            row("store-01", 300, 0),
            row("store-01", 0, 300),
        ]);
        assert_eq!(totals.len(), 2);
        assert!(totals.iter().all(OpeningUnitTotal::agrees));
        assert_eq!(
            totals[0].unit_id, "unit-a",
            "units keep the file's own order"
        );
        assert_eq!(totals[0].lines, 2);
    }

    #[test]
    fn a_difference_is_signed_so_it_says_which_way() {
        let totals = opening_unit_totals(&[row("unit-a", 500, 0), row("unit-a", 0, 300)]);
        assert_eq!(totals[0].difference_minor, 200);
        assert!(!totals[0].agrees());

        let other = opening_unit_totals(&[row("unit-a", 300, 0), row("unit-a", 0, 500)]);
        assert_eq!(other[0].difference_minor, -200);
    }

    #[test]
    fn one_unit_out_does_not_hide_behind_another_being_over() {
        // The trap the per-unit total exists for: the sheet balances in total
        // and neither unit's books do.
        let totals = opening_unit_totals(&[
            row("unit-a", 700, 0),
            row("unit-a", 0, 500),
            row("store-01", 300, 0),
            row("store-01", 0, 500),
        ]);
        assert_eq!(totals[0].difference_minor, 200);
        assert_eq!(totals[1].difference_minor, -200);
        assert!(totals.iter().any(|total| !total.agrees()));
    }

    fn facts(last: Option<i64>, average: Option<i64>, stated: Option<i64>) -> OpeningStockFacts {
        OpeningStockFacts {
            quantity: 10,
            last_purchase_minor: last,
            system_average_minor: average,
            stated_minor: stated,
        }
    }

    #[test]
    fn a_real_purchase_price_wins_over_everything_offered_beside_it() {
        let price = price_opening_stock(&facts(Some(125_000), Some(99_000), Some(1)))
            .unwrap_or_else(|refusal| panic!("{}", refusal.message()));
        assert_eq!(price.unit_cost_minor, 125_000);
        assert_eq!(price.basis, OpeningPriceBasis::LastPurchase);
        assert!(!price.basis.is_fallback());
    }

    #[test]
    fn the_system_average_is_second_and_says_so() {
        let price = price_opening_stock(&facts(None, Some(99_000), Some(1)))
            .unwrap_or_else(|refusal| panic!("{}", refusal.message()));
        assert_eq!(price.unit_cost_minor, 99_000);
        assert_eq!(price.basis, OpeningPriceBasis::SystemAverage);
        assert!(price.basis.is_fallback());
    }

    #[test]
    fn a_stated_price_is_last_and_is_marked_as_a_fallback() {
        let price = price_opening_stock(&facts(None, None, Some(80_000)))
            .unwrap_or_else(|refusal| panic!("{}", refusal.message()));
        assert_eq!(price.basis, OpeningPriceBasis::StatedFallback);
        assert!(price.basis.is_fallback());
        assert!(price.note.contains("80000"));
    }

    #[test]
    fn nothing_to_price_it_with_is_a_refusal_and_never_a_zero() {
        assert_eq!(
            price_opening_stock(&facts(None, None, None)),
            Err(OpeningPriceRefusal::NoBasis)
        );
    }

    #[test]
    fn free_goods_are_a_fact_and_a_missing_price_is_not() {
        // The distinction the refusal above exists to preserve: zero from a
        // real purchase is accepted, zero from nowhere is not.
        let price = price_opening_stock(&facts(Some(0), None, None))
            .unwrap_or_else(|refusal| panic!("{}", refusal.message()));
        assert_eq!(price.unit_cost_minor, 0);
        assert_eq!(price.basis, OpeningPriceBasis::LastPurchase);
    }

    #[test]
    fn a_holding_of_nothing_and_a_negative_price_are_both_refused() {
        let mut none = facts(Some(1), None, None);
        none.quantity = 0;
        assert_eq!(
            price_opening_stock(&none),
            Err(OpeningPriceRefusal::QuantityNotPositive)
        );
        assert_eq!(
            price_opening_stock(&facts(Some(-1), None, None)),
            Err(OpeningPriceRefusal::PriceIsNegative)
        );
    }

    #[test]
    fn a_reconciliation_is_signed_and_says_whether_it_agrees() {
        assert!(reconcile_opening(500, 500).agrees);
        let out = reconcile_opening(500, 300);
        assert_eq!(out.difference_minor, 200);
        assert!(!out.agrees);
    }

    #[test]
    fn a_payable_is_positive_on_both_sides_of_its_own_comparison() {
        // 0145 signs the general ledger to the sub-ledger's side so that a
        // payable of 8,600,000 is +8,600,000 in both columns and a difference
        // is a difference rather than a sum.
        assert_eq!(signed_to_side(0, 8_600_000, false), 8_600_000);
        assert_eq!(signed_to_side(2_400_000, 0, true), 2_400_000);
    }
}
