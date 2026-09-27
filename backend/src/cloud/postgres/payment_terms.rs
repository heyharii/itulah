//! The arrangements a buyer can agree, and what each instalment is counted
//! from.
//!
//! `0201` gives the company a place to keep its payment terms; this gives the
//! screens a way to read them and the master screen a way to keep them. The
//! owner moved the choosing of an arrangement off the supplier form and the
//! order composer — Finance handles payment — so the templates are maintained
//! here, as master data, and nowhere else.
//!
//! # The lifecycle
//!
//! The master lifecycle of `docs/product-master.md` and 0167: a term or a
//! template is RETIRED, never deleted. There is no delete endpoint at all —
//! a bill copies its schedule when it is raised (0202), but a supplier's
//! standing arrangement points at a template by code, and a code that vanished
//! would be an arrangement nobody can read back. `ever_used` is set on a term
//! the moment a template line names it, and never cleared.
//!
//! # Why the whole book in one answer
//!
//! A template is unreadable without its terms: "40% advance, 60% before
//! dispatch" is four words until you know that *before dispatch* means thirty
//! days after the bill. Every caller that shows a template therefore needs the
//! terms too, and the two lists together are a few dozen rows that change
//! about once a quarter. Two endpoints would mean two round trips and a state
//! where a screen holds templates it cannot explain.

use super::{begin_idempotent, complete_idempotent};
use crate::cloud::application::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgConnection, PgPool, Row};

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
    /// The spelling the `CHECK` in 0201 accepts — the one direction `parse`
    /// does not cover.
    fn as_str(self) -> &'static str {
        match self {
            Self::DaysAfterBill => "DAYS_AFTER_BILL",
            Self::DaysAfterBillMonthEnd => "DAYS_AFTER_BILL_MONTH_END",
            Self::MonthsAfterBillMonthEnd => "MONTHS_AFTER_BILL_MONTH_END",
        }
    }

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

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/// A new named arrangement.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreatePaymentTermRequest {
    /// Upper-snake, like every other master code here — `NET_60`, not
    /// `net 60`. Never editable afterwards: template lines hold it.
    pub code: String,
    pub label: String,
    pub basis: PaymentTermBasis,
    /// Days for the two `DAYS_*` bases, months for the third. Zero is "on the
    /// day itself".
    pub offset_value: i32,
    /// Absent puts the new term at the end of the list.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub display_order: Option<i32>,
}

/// Rename, re-time, reorder, retire or reactivate a term.
///
/// The code is not among the fields, for the reason it is not on a colour:
/// it is what the template lines point at. Changing the basis or the offset is
/// allowed even on a term in use — a bill copies its own schedule when it is
/// raised (0202), so what changes is every bill raised from here on, which is
/// what correcting a term means.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdatePaymentTermRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub label: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub basis: Option<PaymentTermBasis>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub offset_value: Option<i32>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub display_order: Option<i32>,
    /// `false` retires, `true` brings it back. Retiring a term that an active
    /// template still schedules is refused: the template would then name
    /// something no picker offers.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub active: Option<bool>,
}

/// One instalment as a writer sends it: which term, and how much of the bill.
///
/// No `seq`: the lines are numbered in the order they arrive, because a number
/// the caller chose is a number the caller can get wrong (two 2s, a gap).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentTermsTemplateLineInput {
    pub term_code: String,
    /// Basis points of the bill; the lines together must be exactly 10000.
    pub portion_bps: i32,
}

/// A new template, with its instalments, in one transaction.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreatePaymentTermsTemplateRequest {
    pub code: String,
    pub label: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub display_order: Option<i32>,
    pub lines: Vec<PaymentTermsTemplateLineInput>,
}

/// Rename, reorder, retire or reactivate a template, and optionally replace
/// its instalments whole.
///
/// Whole, never line by line: the invariant is on the SET of lines (they add
/// to the bill), so a patch that moves one line is a template that briefly
/// schedules 140% — and a caller that sends the full list cannot get into
/// that state.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdatePaymentTermsTemplateRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub label: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub display_order: Option<i32>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub active: Option<bool>,
    #[serde(default)]
    // Plain `optional` rather than a spelled-out type: ts-rs only writes the
    // import for a type it resolved itself.
    #[cfg_attr(feature = "ts", ts(optional))]
    pub lines: Option<Vec<PaymentTermsTemplateLineInput>>,
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const TERM_COLUMNS: &str =
    "code, label, basis, offset_value, display_order, active, ever_used, version";

fn term_from_row(row: &PgRow) -> Result<PaymentTermRow, AppError> {
    let basis: String = row.try_get("basis")?;
    Ok(PaymentTermRow {
        code: row.try_get("code")?,
        label: row.try_get("label")?,
        basis: PaymentTermBasis::parse(&basis)?,
        offset_value: row.try_get("offset_value")?,
        display_order: row.try_get("display_order")?,
        active: row.try_get("active")?,
        ever_used: row.try_get("ever_used")?,
        version: row.try_get("version")?,
    })
}

/// Every template, or the one named, with its lines — grouped here.
///
/// One query for every line of every template, joined to its term. A query
/// per template would be a few dozen round trips to assemble a list that is
/// read on the way into one form.
async fn read_templates(
    connection: &mut PgConnection,
    only: Option<&str>,
) -> Result<Vec<PaymentTermsTemplateRow>, AppError> {
    let line_rows = sqlx::query(
        "SELECT t.code AS template_code, t.label AS template_label, t.display_order,
                t.active, t.ever_used, t.version,
                l.seq, l.portion_bps,
                m.code AS term_code, m.label AS term_label, m.basis, m.offset_value
           FROM payment_terms_template t
           LEFT JOIN payment_terms_template_line l ON l.template_code = t.code
           LEFT JOIN payment_term m ON m.code = l.term_code
          WHERE ($1::text IS NULL OR t.code = $1)
          ORDER BY t.display_order, t.label, t.code, l.seq",
    )
    .bind(only)
    .fetch_all(&mut *connection)
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
        let Some(seq) = row.try_get::<Option<i32>, _>("seq")? else {
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
    Ok(templates)
}

async fn read_term(connection: &mut PgConnection, code: &str) -> Result<PaymentTermRow, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {TERM_COLUMNS} FROM payment_term WHERE code = $1"
    ))
    .bind(code)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| AppError::NotFound("Payment term".to_owned()))?;
    term_from_row(&row)
}

async fn read_template(
    connection: &mut PgConnection,
    code: &str,
) -> Result<PaymentTermsTemplateRow, AppError> {
    read_templates(connection, Some(code))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("Payment terms template".to_owned()))
}

/// The terms and the templates, in the order they are meant to be read.
///
/// Named for what it answers rather than generically. `postgres::*` is one
/// namespace — every module's public names land in it — so a function called
/// `list` or `terms` here would collide with another module's, and the error
/// when it does names the import rather than the clash.
pub async fn payment_terms_book(pool: &PgPool) -> Result<PaymentTermsBook, AppError> {
    let mut connection = pool.acquire().await?;
    let term_rows = sqlx::query(&format!(
        "SELECT {TERM_COLUMNS} FROM payment_term ORDER BY display_order, label, code"
    ))
    .fetch_all(&mut *connection)
    .await?;
    let terms = term_rows
        .iter()
        .map(term_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    let templates = read_templates(&mut connection, None).await?;
    Ok(PaymentTermsBook { terms, templates })
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// The code as the master stores it: upper-snake and nothing else, so `net
/// 60`, `Net-60` and `NET_60` cannot become three rows.
fn normalize_payment_code(raw: &str, what: &str) -> Result<String, AppError> {
    let code = raw.trim().to_uppercase().replace([' ', '-'], "_");
    if code.is_empty() {
        return Err(AppError::Validation(format!("{what} code cannot be blank")));
    }
    if !code
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(AppError::Validation(format!(
            "{what} code {raw:?} must be letters, digits and underscores, for example NET_60"
        )));
    }
    Ok(code)
}

fn required_label(raw: &str, what: &str) -> Result<String, AppError> {
    let label = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if label.is_empty() {
        return Err(AppError::Validation(format!("a {what} needs a name")));
    }
    Ok(label)
}

fn valid_offset(offset: i32) -> Result<i32, AppError> {
    if offset < 0 {
        return Err(AppError::Validation(
            "a payment term's offset cannot be negative; zero means on the day itself".into(),
        ));
    }
    Ok(offset)
}

/// The instalments, checked before the database sees them.
///
/// The deferred trigger in 0201 is the authority on the sum and would refuse
/// the same thing; this says it first, per line, in words a person can act on.
/// Returns the normalised term codes in order.
fn checked_lines(lines: &[PaymentTermsTemplateLineInput]) -> Result<Vec<(String, i32)>, AppError> {
    if lines.is_empty() {
        return Err(AppError::Validation(
            "a template needs at least one instalment".into(),
        ));
    }
    let mut checked: Vec<(String, i32)> = Vec::with_capacity(lines.len());
    let mut total: i64 = 0;
    for (index, line) in lines.iter().enumerate() {
        let code = normalize_payment_code(&line.term_code, "payment term")?;
        if !(1..=10_000).contains(&line.portion_bps) {
            return Err(AppError::Validation(format!(
                "instalment {} must be more than 0% and at most 100% of the bill",
                index + 1
            )));
        }
        if checked.iter().any(|(seen, _)| *seen == code) {
            return Err(AppError::Validation(format!(
                "{code} appears twice; one term is one instalment — add the portions together"
            )));
        }
        total += i64::from(line.portion_bps);
        checked.push((code, line.portion_bps));
    }
    if total != 10_000 {
        return Err(AppError::Validation(format!(
            "the instalments add up to {}% of the bill; they have to add up to 100%",
            percent(total)
        )));
    }
    Ok(checked)
}

/// Basis points as a person reads them: 4000 → "40", 3333 → "33.33".
fn percent(bps: i64) -> String {
    let whole = bps / 100;
    let fraction = (bps % 100).abs();
    if fraction == 0 {
        whole.to_string()
    } else {
        format!("{whole}.{fraction:02}")
            .trim_end_matches('0')
            .to_owned()
    }
}

/// Say which constraint refused, in the words of the person who tripped it.
///
/// P0001 is `assert_template_whole` (0201). `AppError::into_response` would
/// already pass it through as a 409; mapping it here makes that a
/// `Conflict` the handler can see rather than a database error that happens
/// to render as one.
fn map_payment_terms_write_error(error: sqlx::Error, what: &str) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("P0001") => AppError::Conflict(database.message().to_owned()),
            Some("23505") => AppError::Conflict(format!("a {what} with that code already exists")),
            Some("23503") => AppError::Validation(
                "an instalment names a payment term that does not exist".into(),
            ),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

/// Every term the lines name exists and is live, and is marked used from now
/// on.
///
/// A retired term is refused on a template for the reason retiring one is
/// refused while a template holds it: the template would schedule something
/// the pickers no longer offer.
async fn claim_terms(connection: &mut PgConnection, codes: &[String]) -> Result<(), AppError> {
    let found =
        sqlx::query("SELECT code, active FROM payment_term WHERE code = ANY($1) FOR UPDATE")
            .bind(codes)
            .fetch_all(&mut *connection)
            .await?;
    for code in codes {
        let row = found
            .iter()
            .find(|row| row.try_get::<String, _>("code").ok().as_deref() == Some(code.as_str()));
        match row {
            None => {
                return Err(AppError::Validation(format!(
                    "payment term {code} does not exist"
                )))
            }
            Some(row) if !row.try_get::<bool, _>("active")? => {
                return Err(AppError::Conflict(format!(
                    "payment term {code} is retired; reactivate it before scheduling with it"
                )))
            }
            Some(_) => {}
        }
    }
    // Set once, never cleared — 0167. Guarded so an already-marked term does
    // not take a pointless row version.
    sqlx::query("UPDATE payment_term SET ever_used = true WHERE code = ANY($1) AND NOT ever_used")
        .bind(codes)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

async fn write_lines(
    connection: &mut PgConnection,
    template_code: &str,
    lines: &[(String, i32)],
) -> Result<(), AppError> {
    for (index, (term_code, portion_bps)) in lines.iter().enumerate() {
        let seq = i32::try_from(index + 1)
            .map_err(|_| AppError::Validation("a template has too many instalments".into()))?;
        sqlx::query(
            "INSERT INTO payment_terms_template_line (template_code, seq, term_code, portion_bps)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(template_code)
        .bind(seq)
        .bind(term_code)
        .bind(portion_bps)
        .execute(&mut *connection)
        .await
        .map_err(|error| map_payment_terms_write_error(error, "payment terms template"))?;
    }
    Ok(())
}

/// Run the deferred "a template is the whole bill" check now, inside the
/// statement stream, rather than at `COMMIT`.
///
/// At commit the refusal would arrive after the idempotency record had been
/// written and from `commit()` — correct, since the whole transaction rolls
/// back, but it is clearer for the answer to come from the step that caused
/// it.
async fn check_templates_whole(connection: &mut PgConnection) -> Result<(), AppError> {
    sqlx::query(
        "SET CONSTRAINTS assert_template_whole_on_header, assert_template_whole_on_line IMMEDIATE",
    )
    .execute(&mut *connection)
    .await
    .map_err(|error| map_payment_terms_write_error(error, "payment terms template"))?;
    Ok(())
}

fn positive_version(expected_version: i32) -> Result<(), AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Writes: terms
// ---------------------------------------------------------------------------

/// Add a term to the master.
pub async fn create_payment_term(
    pool: &PgPool,
    request: CreatePaymentTermRequest,
    idempotency_key: &str,
    digest: &str,
) -> Result<PaymentTermRow, AppError> {
    let code = normalize_payment_code(&request.code, "payment term")?;
    let label = required_label(&request.label, "payment term")?;
    let offset = valid_offset(request.offset_value)?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "payment_term.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    sqlx::query(
        "INSERT INTO payment_term (code, label, basis, offset_value, display_order)
         VALUES ($1, $2, $3, $4,
                 COALESCE($5, (SELECT COALESCE(max(display_order), 0) + 10 FROM payment_term)))",
    )
    .bind(&code)
    .bind(&label)
    .bind(request.basis.as_str())
    .bind(offset)
    .bind(request.display_order)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_payment_terms_write_error(error, "payment term"))?;

    let term = read_term(&mut transaction, &code).await?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&term)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(term)
}

/// Rename, re-time, reorder, retire or reactivate a term.
pub async fn update_payment_term(
    pool: &PgPool,
    code: &str,
    expected_version: i32,
    request: UpdatePaymentTermRequest,
    idempotency_key: &str,
    digest: &str,
) -> Result<PaymentTermRow, AppError> {
    positive_version(expected_version)?;
    let code = normalize_payment_code(code, "payment term")?;
    if request.label.is_none()
        && request.basis.is_none()
        && request.offset_value.is_none()
        && request.display_order.is_none()
        && request.active.is_none()
    {
        return Err(AppError::Validation(
            "Payment term update must contain at least one field".into(),
        ));
    }
    let label = request
        .label
        .as_deref()
        .map(|raw| required_label(raw, "payment term"))
        .transpose()?;
    let offset = request.offset_value.map(valid_offset).transpose()?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "payment_term.update",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let actual: i32 =
        sqlx::query_scalar("SELECT version FROM payment_term WHERE code = $1 FOR UPDATE")
            .bind(&code)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or_else(|| AppError::NotFound("Payment term".to_owned()))?;
    if actual != expected_version {
        return Err(AppError::Conflict(format!(
            "Payment term has moved on: If-Match said {expected_version}, it is now {actual}"
        )));
    }

    if request.active == Some(false) {
        let holders: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT t.label
               FROM payment_terms_template_line l
               JOIN payment_terms_template t ON t.code = l.template_code
              WHERE l.term_code = $1 AND t.active
              ORDER BY t.label",
        )
        .bind(&code)
        .fetch_all(&mut *transaction)
        .await?;
        if !holders.is_empty() {
            return Err(AppError::Conflict(format!(
                "this term is an instalment of {}; retire those templates or change their \
                 instalments first",
                holders.join(", ")
            )));
        }
    }

    sqlx::query(
        "UPDATE payment_term SET
             label         = COALESCE($2, label),
             basis         = COALESCE($3, basis),
             offset_value  = COALESCE($4, offset_value),
             display_order = COALESCE($5, display_order),
             active        = COALESCE($6, active),
             version       = version + 1
         WHERE code = $1",
    )
    .bind(&code)
    .bind(&label)
    .bind(request.basis.map(PaymentTermBasis::as_str))
    .bind(offset)
    .bind(request.display_order)
    .bind(request.active)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_payment_terms_write_error(error, "payment term"))?;

    let term = read_term(&mut transaction, &code).await?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&term)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(term)
}

// ---------------------------------------------------------------------------
// Writes: templates
// ---------------------------------------------------------------------------

/// Add a template and its instalments, together or not at all.
pub async fn create_payment_terms_template(
    pool: &PgPool,
    request: CreatePaymentTermsTemplateRequest,
    idempotency_key: &str,
    digest: &str,
) -> Result<PaymentTermsTemplateRow, AppError> {
    let code = normalize_payment_code(&request.code, "payment terms template")?;
    let label = required_label(&request.label, "payment terms template")?;
    let lines = checked_lines(&request.lines)?;
    let term_codes: Vec<String> = lines.iter().map(|(term, _)| term.clone()).collect();

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "payment_terms_template.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    claim_terms(&mut transaction, &term_codes).await?;
    sqlx::query(
        "INSERT INTO payment_terms_template (code, label, display_order)
         VALUES ($1, $2,
                 COALESCE($3, (SELECT COALESCE(max(display_order), 0) + 10
                                 FROM payment_terms_template)))",
    )
    .bind(&code)
    .bind(&label)
    .bind(request.display_order)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_payment_terms_write_error(error, "payment terms template"))?;
    write_lines(&mut transaction, &code, &lines).await?;
    check_templates_whole(&mut transaction).await?;

    let template = read_template(&mut transaction, &code).await?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&template)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(template)
}

/// Rename, reorder, retire or reactivate a template, and optionally replace
/// its instalments whole.
pub async fn update_payment_terms_template(
    pool: &PgPool,
    code: &str,
    expected_version: i32,
    request: UpdatePaymentTermsTemplateRequest,
    idempotency_key: &str,
    digest: &str,
) -> Result<PaymentTermsTemplateRow, AppError> {
    positive_version(expected_version)?;
    let code = normalize_payment_code(code, "payment terms template")?;
    if request.label.is_none()
        && request.display_order.is_none()
        && request.active.is_none()
        && request.lines.is_none()
    {
        return Err(AppError::Validation(
            "Payment terms template update must contain at least one field".into(),
        ));
    }
    let label = request
        .label
        .as_deref()
        .map(|raw| required_label(raw, "payment terms template"))
        .transpose()?;
    let lines = request.lines.as_deref().map(checked_lines).transpose()?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "payment_terms_template.update",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let current = sqlx::query(
        "SELECT version, active FROM payment_terms_template WHERE code = $1 FOR UPDATE",
    )
    .bind(&code)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Payment terms template".to_owned()))?;
    let actual: i32 = current.try_get("version")?;
    let was_active: bool = current.try_get("active")?;
    if actual != expected_version {
        return Err(AppError::Conflict(format!(
            "Payment terms template has moved on: If-Match said {expected_version}, it is now \
             {actual}"
        )));
    }

    if let Some(lines) = &lines {
        let term_codes: Vec<String> = lines.iter().map(|(term, _)| term.clone()).collect();
        claim_terms(&mut transaction, &term_codes).await?;
        sqlx::query("DELETE FROM payment_terms_template_line WHERE template_code = $1")
            .bind(&code)
            .execute(&mut *transaction)
            .await?;
        write_lines(&mut transaction, &code, lines).await?;
    } else if request.active == Some(true) && !was_active {
        // Bringing a template back with the instalments it already has: each
        // of them has to be a term the pickers still offer.
        let retired: Vec<String> = sqlx::query_scalar(
            "SELECT m.label
               FROM payment_terms_template_line l
               JOIN payment_term m ON m.code = l.term_code
              WHERE l.template_code = $1 AND NOT m.active
              ORDER BY l.seq",
        )
        .bind(&code)
        .fetch_all(&mut *transaction)
        .await?;
        if !retired.is_empty() {
            return Err(AppError::Conflict(format!(
                "this template schedules {}, which {} retired; reactivate {} or change the \
                 instalments",
                retired.join(", "),
                if retired.len() == 1 { "is" } else { "are" },
                if retired.len() == 1 { "it" } else { "them" },
            )));
        }
    }

    sqlx::query(
        "UPDATE payment_terms_template SET
             label         = COALESCE($2, label),
             display_order = COALESCE($3, display_order),
             active        = COALESCE($4, active),
             version       = version + 1
         WHERE code = $1",
    )
    .bind(&code)
    .bind(&label)
    .bind(request.display_order)
    .bind(request.active)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_payment_terms_write_error(error, "payment terms template"))?;
    check_templates_whole(&mut transaction).await?;

    let template = read_template(&mut transaction, &code).await?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&template)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(template)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(term: &str, bps: i32) -> PaymentTermsTemplateLineInput {
        PaymentTermsTemplateLineInput {
            term_code: term.to_owned(),
            portion_bps: bps,
        }
    }

    #[test]
    fn instalments_must_close_on_the_whole_bill() {
        assert!(checked_lines(&[line("ADVANCE", 4000), line("NET_30", 6000)]).is_ok());
        assert!(checked_lines(&[]).is_err());
        assert!(checked_lines(&[line("ADVANCE", 4000), line("NET_30", 5000)]).is_err());
        assert!(checked_lines(&[line("ADVANCE", 0), line("NET_30", 10000)]).is_err());
        assert!(checked_lines(&[line("NET_30", 5000), line("net 30", 5000)]).is_err());
    }

    #[test]
    fn percent_reads_like_a_person_wrote_it() {
        assert_eq!(percent(4000), "40");
        assert_eq!(percent(3333), "33.33");
        assert_eq!(percent(9050), "90.5");
    }

    #[test]
    fn codes_are_upper_snake() {
        assert_eq!(
            normalize_payment_code(" net 60 ", "payment term")
                .ok()
                .as_deref(),
            Some("NET_60")
        );
        assert!(normalize_payment_code("net/60", "payment term").is_err());
    }
}
