//! The arrangements a buyer can agree, and what each instalment is counted
//! from.
//!
//! Read-only for now, and deliberately so. `0201` gives the company a place to
//! keep its payment terms; this gives the screens a way to read them, which is
//! what lets `composer.tsx` stop carrying four arrangements in a `const`.
//! Editing them is a master screen and comes next — see
//! `PAYMENT-TERMS-PLAN.md`.
//!
//! # Why the whole book in one answer
//!
//! A template is unreadable without its terms: "40% advance, 60% before
//! dispatch" is four words until you know that *before dispatch* means thirty
//! days after the bill. Every caller that shows a template therefore needs the
//! terms too, and the two lists together are a few dozen rows that change
//! about once a quarter. Two endpoints would mean two round trips and a state
//! where a screen holds templates it cannot explain.

use crate::cloud::application::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

/// What an instalment's offset is counted from.
///
/// ERPNext's `Payment Term.due_date_based_on`, which has exactly these three,
/// spelled our way. There are three rather than one because "net 30 from the
/// end of the month" is ordinary in Indonesian trade and is not expressible as
/// a number of days from anything the order knows.
///
/// All three count from the BILL. A purchase order raised today whose invoice
/// arrives in six weeks must not carry a due date computed from today, which
/// is why ERPNext recomputes the schedule when the invoice is made and why the
/// plan has the bill own the authoritative dates.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaymentTermBasis {
    DaysAfterBill,
    DaysAfterBillMonthEnd,
    MonthsAfterBillMonthEnd,
}

impl PaymentTermBasis {
    /// What the database stores, as the database stores it.
    ///
    /// The `CHECK` in 0201 pins the same three strings. Anything else means
    /// the column and this enum have parted company, and answering with a
    /// guess would put a due date on a bill that nobody agreed — so it is an
    /// error, loudly, naming the value.
    fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "DAYS_AFTER_BILL" => Ok(Self::DaysAfterBill),
            "DAYS_AFTER_BILL_MONTH_END" => Ok(Self::DaysAfterBillMonthEnd),
            "MONTHS_AFTER_BILL_MONTH_END" => Ok(Self::MonthsAfterBillMonthEnd),
            // `Configuration`, not `Validation`: nothing the caller sent is
            // wrong. The database holds a basis this build has never heard of,
            // which means the column and this enum were deployed out of step.
            other => Err(AppError::Configuration(format!(
                "payment term basis '{other}' is not one this build knows; the \
                 column and `PaymentTermBasis` have parted company"
            ))),
        }
    }
}

/// One named arrangement: what it is called, and when it falls due.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentTermRow {
    pub code: String,
    pub label: String,
    pub basis: PaymentTermBasis,
    /// Days for the two `DAYS_*` bases, months for the third. One field
    /// because exactly one of ERPNext's `credit_days` / `credit_months` is
    /// ever populated, and the basis already says which unit this is.
    pub offset_value: i32,
    pub display_order: i32,
    /// Retired terms are still returned. A picker filters them out; a master
    /// screen has to see them, because a retirement nobody can find is a
    /// retirement nobody can undo — the rule `MasterTerm` follows.
    pub active: bool,
    /// Whether anything has EVER pointed at this term. Set once, never
    /// cleared: see 0167.
    pub ever_used: bool,
    /// What a PATCH must quote in `If-Match`.
    pub version: i32,
}

/// One instalment of a template, with its term spelled out.
///
/// The term's label, basis and offset are carried here rather than left to the
/// caller to join: a line that says `term_code: "NET_45"` and nothing else is
/// a line every screen has to resolve, and the resolution is the same every
/// time.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentTermsTemplateLine {
    /// Presentation and ordering only. Nothing points AT a line by its number:
    /// correct a two-line schedule into three and every reference to "2" would
    /// silently mean something else.
    pub seq: i32,
    pub term_code: String,
    pub term_label: String,
    pub basis: PaymentTermBasis,
    pub offset_value: i32,
    /// Basis points of the bill. The lines of a template add to exactly 10000
    /// — a deferred trigger in 0201 refuses anything else — so a caller may
    /// divide by 100 for display without wondering whether it closes.
    pub portion_bps: i32,
}

/// A whole arrangement, as a buyer picks it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentTermsTemplateRow {
    pub code: String,
    pub label: String,
    pub display_order: i32,
    pub active: bool,
    pub ever_used: bool,
    pub version: i32,
    pub lines: Vec<PaymentTermsTemplateLine>,
}

/// Everything the company has agreed it can agree.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentTermsBook {
    pub terms: Vec<PaymentTermRow>,
    pub templates: Vec<PaymentTermsTemplateRow>,
}

/// The terms and the templates, in the order they are meant to be read.
///
/// Named for what it answers rather than generically. `postgres::*` is one
/// namespace — every module's public names land in it — so a function called
/// `list` or `terms` here would collide with another module's, and the error
/// when it does names the import rather than the clash.
pub async fn payment_terms_book(pool: &PgPool) -> Result<PaymentTermsBook, AppError> {
    let term_rows = sqlx::query(
        "SELECT code, label, basis, offset_value, display_order, active, ever_used, version
           FROM payment_term
          ORDER BY display_order, label, code",
    )
    .fetch_all(pool)
    .await?;

    let mut terms = Vec::with_capacity(term_rows.len());
    for row in &term_rows {
        let basis: String = row.try_get("basis")?;
        terms.push(PaymentTermRow {
            code: row.try_get("code")?,
            label: row.try_get("label")?,
            basis: PaymentTermBasis::parse(&basis)?,
            offset_value: row.try_get("offset_value")?,
            display_order: row.try_get("display_order")?,
            active: row.try_get("active")?,
            ever_used: row.try_get("ever_used")?,
            version: row.try_get("version")?,
        });
    }

    // One query for every line of every template, joined to its term, then
    // grouped here. A query per template would be a few dozen round trips to
    // assemble a list that is read on the way into one form.
    let line_rows = sqlx::query(
        "SELECT t.code AS template_code, t.label AS template_label, t.display_order,
                t.active, t.ever_used, t.version,
                l.seq, l.portion_bps,
                m.code AS term_code, m.label AS term_label, m.basis, m.offset_value
           FROM payment_terms_template t
           LEFT JOIN payment_terms_template_line l ON l.template_code = t.code
           LEFT JOIN payment_term m ON m.code = l.term_code
          ORDER BY t.display_order, t.label, t.code, l.seq",
    )
    .fetch_all(pool)
    .await?;

    let mut templates: Vec<PaymentTermsTemplateRow> = Vec::new();
    for row in &line_rows {
        let code: String = row.try_get("template_code")?;
        if templates.last().map(|one| one.code.as_str()) != Some(code.as_str()) {
            templates.push(PaymentTermsTemplateRow {
                code: code.clone(),
                label: row.try_get("template_label")?,
                display_order: row.try_get("display_order")?,
                active: row.try_get("active")?,
                ever_used: row.try_get("ever_used")?,
                version: row.try_get("version")?,
                lines: Vec::new(),
            });
        }

        // `LEFT JOIN`, so a template whose lines were somehow all removed
        // still appears — with none. The trigger in 0201 makes that state
        // unreachable through this application, and an INNER JOIN would hide
        // it rather than show it if anything ever reached the table another
        // way.
        let Ok(seq) = row.try_get::<i32, _>("seq") else {
            continue;
        };
        let basis: String = row.try_get("basis")?;
        if let Some(template) = templates.last_mut() {
            template.lines.push(PaymentTermsTemplateLine {
                seq,
                term_code: row.try_get("term_code")?,
                term_label: row.try_get("term_label")?,
                basis: PaymentTermBasis::parse(&basis)?,
                offset_value: row.try_get("offset_value")?,
                portion_bps: row.try_get("portion_bps")?,
            });
        }
    }

    Ok(PaymentTermsBook { terms, templates })
}
