//! How a document's number is spelled — a pattern Finance edits, not a
//! `format!` a developer edits.
//!
//! # Why this is data
//!
//! Every document used to carry its number format in code: `KK-26-09-00001`
//! in `cash_document`, `JV-00000042` in the poster, `PV-`, `CN-`, `AV-` and a
//! dozen more each in their own module. The client's books spell theirs
//! `C006-BKK-26-07-00046` — unit, kind, year, month, sequence — and moving
//! from one to the other was a deploy. ERPNext's Naming Series and 7Soft's
//! "Kode No Transaksi" both make it a setting, and so does this.
//!
//! # The vocabulary
//!
//! A pattern is literal text with these tokens in it:
//!
//! | token      | renders                                   |
//! |------------|-------------------------------------------|
//! | `{UNIT}`   | the unit's client code — `HO`, `C006`     |
//! | `{YYYY}`   | four-digit year of the document's date    |
//! | `{YY}`     | two-digit year                            |
//! | `{MM}`     | two-digit month                           |
//! | `{#…#}`    | the sequence, zero-padded to that width   |
//!
//! Exactly one sequence token, of 1 to 12 `#`. The reset says when the
//! sequence starts again at 1, and a pattern must print whatever the reset
//! turns on — a monthly series without `{MM}` would print the same number in
//! January and February.
//!
//! # Pure
//!
//! No clock and no database: the date and the unit arrive as arguments, the
//! counter's value arrives as an argument, and the same inputs spell the same
//! number forever. `kernel_purity` holds it to that.

use std::fmt;

/// When the sequence starts again at 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reset {
    Monthly,
    Yearly,
    Never,
}

impl Reset {
    pub const ALL: [Reset; 3] = [Reset::Monthly, Reset::Yearly, Reset::Never];

    pub const fn code(self) -> &'static str {
        match self {
            Self::Monthly => "MONTHLY",
            Self::Yearly => "YEARLY",
            Self::Never => "NEVER",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|reset| reset.code().eq_ignore_ascii_case(code.trim()))
    }

    /// The counter's period key for a document dated in this year and month.
    /// A counter row exists per key, so this is what makes the reset happen.
    pub fn period_key(self, year: i32, month: u32) -> String {
        match self {
            Self::Monthly => format!("{year:04}-{:02}", month.clamp(1, 12)),
            Self::Yearly => format!("{year:04}"),
            Self::Never => String::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Part {
    Literal(String),
    Unit,
    Year4,
    Year2,
    Month,
    Sequence(usize),
}

/// A parsed pattern.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pattern {
    parts: Vec<Part>,
}

/// Why a pattern was refused, in a sentence Finance can act on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PatternError(pub String);

impl fmt::Display for PatternError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for PatternError {}

const MAX_PATTERN: usize = 48;
const MAX_WIDTH: usize = 12;

fn refuse(message: impl Into<String>) -> PatternError {
    PatternError(message.into())
}

impl Pattern {
    /// Read a pattern, refusing anything this vocabulary cannot print.
    pub fn parse(raw: &str) -> Result<Self, PatternError> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err(refuse("a number pattern cannot be empty"));
        }
        if raw.chars().count() > MAX_PATTERN {
            return Err(refuse(format!(
                "a number pattern is at most {MAX_PATTERN} characters"
            )));
        }
        let mut parts = Vec::new();
        let mut literal = String::new();
        let mut chars = raw.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '{' => {
                    let mut token = String::new();
                    let mut closed = false;
                    for next in chars.by_ref() {
                        if next == '}' {
                            closed = true;
                            break;
                        }
                        token.push(next);
                    }
                    if !closed {
                        return Err(refuse(format!("{{{token} is never closed with }}")));
                    }
                    if !literal.is_empty() {
                        parts.push(Part::Literal(std::mem::take(&mut literal)));
                    }
                    parts.push(match token.as_str() {
                        "UNIT" => Part::Unit,
                        "YYYY" => Part::Year4,
                        "YY" => Part::Year2,
                        "MM" => Part::Month,
                        hashes if !hashes.is_empty() && hashes.chars().all(|c| c == '#') => {
                            if hashes.len() > MAX_WIDTH {
                                return Err(refuse(format!(
                                    "the sequence is at most {MAX_WIDTH} digits"
                                )));
                            }
                            Part::Sequence(hashes.len())
                        }
                        other => {
                            return Err(refuse(format!(
                                "{{{other}}} is not a token; the tokens are {{UNIT}}, {{YYYY}}, \
                                 {{YY}}, {{MM}} and {{###}}"
                            )))
                        }
                    });
                }
                '}' => return Err(refuse("a } with no { before it")),
                c if c.is_ascii_alphanumeric() || matches!(c, '-' | '/' | '.' | '_') => {
                    literal.push(c);
                }
                other => {
                    return Err(refuse(format!(
                        "'{other}' cannot appear in a document number; use letters, digits, \
                         - / . or _"
                    )))
                }
            }
        }
        if !literal.is_empty() {
            parts.push(Part::Literal(literal));
        }
        let sequences = parts
            .iter()
            .filter(|part| matches!(part, Part::Sequence(_)))
            .count();
        if sequences != 1 {
            return Err(refuse(
                "a number pattern needs exactly one sequence, written {#####}",
            ));
        }
        Ok(Self { parts })
    }

    /// Does this pattern print the unit — so the counter runs per unit?
    pub fn has_unit(&self) -> bool {
        self.parts.iter().any(|part| *part == Part::Unit)
    }

    fn has_year(&self) -> bool {
        self.parts
            .iter()
            .any(|part| matches!(part, Part::Year2 | Part::Year4))
    }

    fn has_month(&self) -> bool {
        self.parts.iter().any(|part| *part == Part::Month)
    }

    /// Refuse a pattern that cannot tell apart the periods its reset restarts
    /// in: two documents would be given the same number.
    pub fn check_reset(&self, reset: Reset) -> Result<(), PatternError> {
        match reset {
            Reset::Monthly if !(self.has_year() && self.has_month()) => Err(refuse(
                "a series that restarts every month must print the year and the month — \
                 {YY} or {YYYY}, and {MM}",
            )),
            Reset::Yearly if !self.has_year() => Err(refuse(
                "a series that restarts every year must print the year — {YY} or {YYYY}",
            )),
            _ => Ok(()),
        }
    }

    /// Spell one number.
    ///
    /// `unit_code` is required exactly when the pattern prints the unit. A
    /// sequence wider than its padding prints every digit rather than wrap.
    pub fn render(
        &self,
        unit_code: Option<&str>,
        year: i32,
        month: u32,
        sequence: i64,
    ) -> Result<String, PatternError> {
        let mut out = String::new();
        for part in &self.parts {
            match part {
                Part::Literal(text) => out.push_str(text),
                Part::Unit => match unit_code {
                    Some(code) if !code.trim().is_empty() => out.push_str(code.trim()),
                    _ => {
                        return Err(refuse(
                            "this series is numbered per unit and the document names no unit",
                        ))
                    }
                },
                Part::Year4 => out.push_str(&format!("{year:04}")),
                Part::Year2 => out.push_str(&format!("{:02}", year.rem_euclid(100))),
                Part::Month => out.push_str(&format!("{:02}", month.clamp(1, 12))),
                Part::Sequence(width) => {
                    out.push_str(&format!("{:0width$}", sequence.max(0), width = *width))
                }
            }
        }
        Ok(out)
    }
}

