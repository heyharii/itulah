//! Transaction categories, and the three doors out of a bank statement line.
//!
//! # Why a person is never shown an account code
//!
//! The client keeps 7,528 accounts. Asking whoever reads the statement which of
//! them the PLN autodebit belongs to is asking a question they cannot answer,
//! and the answers they give under pressure are the ones a trial balance cannot
//! see: an expense in the right family and the wrong leaf still balances.
//!
//! So they pick a category — a word about the business — and
//! `transaction_category` plus `account_resolution` plus the location turn it into the
//! twelve-digit code. Two lookups, both of them somebody else's decision made
//! once. The code appears on the journal line and nowhere on the screen.
//!
//! # The three doors, and why the order is load-bearing
//!
//! [`bank_line_options`] returns matches, then documents that could be created,
//! then categories. `domain::DOOR_ORDER` says the same thing where it can be
//! asserted on, and the reason is in that module's header: categorising is the
//! fastest of the three and always available, so a screen that offered it first
//! would get it used on lines whose payment was sitting one door away. Every
//! such line becomes an expense recognised twice, in books that still balance.
//!
//! # Nothing here writes a journal
//!
//! [`bank_line_categorise`] creates a cash document and posts THAT, through
//! `banking::bank_line_to_document`, which is the same door `book_bank_line`
//! and `bank_proposal_accept` go through. There is no path from a statement
//! line to a raw journal entry in this module, and that is structural: this
//! file never builds a `PostingIntent`.

use super::banking::{bank_line_to_document, OtherSide};
use super::cash::{cash_document_read, CashDocumentRow};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    missing_before_posting, offered_for_line, refuse_from_bank_line, resolve, suggest,
    BankLine as KernelBankLine, CategoryDirection, CategoryFacts, Ruleset, DOOR_ORDER,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// The master
// ---------------------------------------------------------------------------

/// One category, as a screen reads it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TransactionCategoryRow {
    pub code: String,
    pub display_name: String,
    pub family: String,
    /// `OUTFLOW`, `INFLOW` or `BOTH`.
    pub direction: String,
    pub semantic_key: String,
    pub qualifier: String,
    /// True when the meaning covers several accounts and only the caller knows
    /// which — which bank, which unit.
    pub qualifier_asked: bool,
    /// `DIRECT_EXPENSE`, `RECEIPT`, `TRANSFER`, or the document a person should
    /// go and find instead.
    pub source_document: String,
    pub requires_party: bool,
    pub requires_reference: bool,
    pub requires_approval: bool,
    pub domains: Vec<String>,
    pub bank_postable: bool,
    pub refusal: Option<String>,
    /// The account this is expected to be, read through `ledger_account_remap`
    /// so what the screen offers is one somebody can actually map a meaning to.
    /// A suggestion for whoever maps the key, exactly as
    /// `required_semantic_keys` is; never applied.
    pub expects_account_code: Option<String>,
    /// And what the client calls the thing, quoted from their chart by 0155 and
    /// left as they wrote it. Not the new account's name: `Biaya Bank HO` is
    /// what somebody mapping a meaning is looking for, and `Beban umum &
    /// administrasi` is the statement line it rolls up into.
    pub expects_account_name: Option<String>,
    /// And which category on it, where the remap knew. Half of the old code
    /// became the account and half became this; offering the account alone
    /// would be offering one row of `6301` for forty-eight kinds of expense.
    pub expects_category_code: Option<String>,
    /// What the meaning resolves to at the location asked about, today. Read
    /// through the map on every read rather than remembered, so it follows a
    /// remapping instead of recording where the account used to be. `None` when
    /// nobody has mapped the key yet — which is the honest answer and the one
    /// that has to be visible.
    pub account_code: Option<String>,
    /// And which category the map chose with it, which on `6301` is most of
    /// what the reader is looking at: forty-eight expenses share that account
    /// and the code alone no longer says which one this category books to.
    pub category_code: Option<String>,
    pub account_name: Option<String>,
    pub active: bool,
    pub note: Option<String>,
    pub sort_order: i32,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

/// Which location the resolved account is read for.
///
/// A category means the same thing everywhere and lands on a different leaf at
/// every one of the client's fourteen: `ops_cleaning` at store C003 is
/// `601031000103` and at head office `601031000100`. So the row a screen reads
/// is a category AND a place, and the place has to be said.
const CATEGORY_COLUMNS: &str = "c.code, c.display_name, c.family, c.direction,
     c.semantic_key, c.qualifier, c.qualifier_asked, c.source_document,
     c.requires_party, c.requires_reference, c.requires_approval,
     c.domains, c.bank_postable, c.refusal,
     -- The expectation, as an account somebody can actually map a meaning to.
     --
     -- 0155 wrote these as the client's ten-digit templates and quoted their
     -- own names beside them — `6010310004 Biaya Bank HO`. All 190 of
     -- those are retired, so the CODE on the screen was one nobody can map
     -- anything to and, since 0290, the last dead code showing anywhere in the
     -- estate. `ledger_account_remap` is the record of what each became, and
     -- reading it through that is the same act 0291 performed on every stored
     -- account code — done here rather than by an UPDATE because the stored
     -- value is a quotation from the client's chart, and their chart has not
     -- changed.
     --
     -- The NAME is deliberately not remapped with it. `6010310004` became
     -- `6301 Beban umum & administrasi`, and what somebody mapping a meaning
     -- needs to recognise is `Biaya Bank HO` — the thing, not the
     -- statement line it now rolls up into. So the pair on the screen is our
     -- code and their words, which is what the pair always meant.
     COALESCE(rm.new_code, c.expects_account_code) AS expects_account_code,
     c.expects_account_name,
     -- And the half of the old code that is no longer an account at all. A
     -- suggestion of `6301` without `BIAYA_BANK_HO` is a suggestion to map
     -- forty-eight expenses to one place.
     rm.category_code AS expects_category_code,
     c.active, c.note, c.sort_order, c.created_by, c.created_at,
     m.account_code, m.category_code, a.name AS account_name";

/// LEFT, and for the reason `bank_rules.rs` gives about its own: a category
/// whose meaning nobody has mapped is exactly the one somebody has to see.
const CATEGORY_FROM: &str = "FROM transaction_category c
     LEFT JOIN account_resolution m ON m.role = c.semantic_key
                                   AND m.source_type = 'COMPANY'
                                   AND m.source_id = c.qualifier
                                   AND m.site_id = $1
     LEFT JOIN ledger_account a ON a.account_code = m.account_code
     -- What the quoted client code became, when it became one of the forty.
     -- LEFT, because an expectation naming an account the remap has no row for
     -- is answered honestly with the code as written rather than with nothing.
     LEFT JOIN ledger_account_remap rm ON rm.legacy_code = c.expects_account_code";

fn to_category(row: &sqlx::postgres::PgRow) -> Result<TransactionCategoryRow, AppError> {
    Ok(TransactionCategoryRow {
        code: row.try_get("code")?,
        display_name: row.try_get("display_name")?,
        family: row.try_get("family")?,
        direction: row.try_get("direction")?,
        semantic_key: row.try_get("semantic_key")?,
        qualifier: row.try_get("qualifier")?,
        qualifier_asked: row.try_get("qualifier_asked")?,
        source_document: row.try_get("source_document")?,
        requires_party: row.try_get("requires_party")?,
        requires_reference: row.try_get("requires_reference")?,
        requires_approval: row.try_get("requires_approval")?,
        domains: row.try_get("domains")?,
        bank_postable: row.try_get("bank_postable")?,
        refusal: row.try_get("refusal")?,
        expects_account_code: row.try_get("expects_account_code")?,
        expects_account_name: row.try_get("expects_account_name")?,
        expects_category_code: row.try_get("expects_category_code")?,
        account_code: row.try_get("account_code")?,
        category_code: row.try_get("category_code")?,
        account_name: row.try_get("account_name")?,
        active: row.try_get("active")?,
        note: row.try_get("note")?,
        sort_order: row.try_get("sort_order")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
    })
}

/// The default location. Head office keeps the bank accounts, so a category
/// asked about with no place named is asked about there — the same default
/// `bank_rule` takes, and for the same reason.
const HEAD_OFFICE: &str = "dc";

fn facts_of(row: &TransactionCategoryRow) -> CategoryFacts<'_> {
    CategoryFacts {
        code: &row.code,
        display_name: &row.display_name,
        // A stored direction that will not parse is a row somebody wrote by
        // hand against the CHECK. Treating it as BOTH would offer it
        // everywhere; OUTFLOW is the conservative half and the list is the
        // wrong place to discover it.
        direction: CategoryDirection::parse(&row.direction).unwrap_or(CategoryDirection::Outflow),
        source_document: &row.source_document,
        bank_postable: row.bank_postable,
        refusal: row.refusal.as_deref(),
        active: row.active,
        requires_party: row.requires_party,
        requires_reference: row.requires_reference,
        requires_approval: row.requires_approval,
        qualifier_asked: row.qualifier_asked,
    }
}

/// Every category, narrowed the way a screen narrows them.
///
/// `direction` accepts `OUTFLOW` or `INFLOW` and returns the categories that
/// can explain money going that way — which includes every `BOTH`. That is the
/// filter and not a display hint: a choice that can only ever be wrong is
/// worse than a shorter list.
pub async fn transaction_category_list(
    pool: &PgPool,
    site_id: Option<&str>,
    direction: Option<&str>,
    family: Option<&str>,
    domain: Option<&str>,
    include_retired: bool,
) -> Result<Vec<TransactionCategoryRow>, AppError> {
    let wanted = match direction.map(str::trim).filter(|d| !d.is_empty()) {
        Some(value) => Some(CategoryDirection::parse(value).ok_or_else(|| {
            AppError::Validation(format!(
                "'{value}' is not a direction; money either goes OUTFLOW or comes INFLOW"
            ))
        })?),
        None => None,
    };
    // OUTFLOW asks for OUTFLOW and BOTH, INFLOW for INFLOW and BOTH. Expressed
    // as the stored words rather than through the kernel because it is a WHERE
    // clause; the kernel makes the same decision over a row, and the
    // integration test checks the two agree.
    let directions: Option<Vec<String>> = wanted.map(|d| match d {
        CategoryDirection::Outflow => vec!["OUTFLOW".into(), "BOTH".into()],
        CategoryDirection::Inflow => vec!["INFLOW".into(), "BOTH".into()],
        CategoryDirection::Both => vec!["OUTFLOW".into(), "INFLOW".into(), "BOTH".into()],
    });

    let sql = format!(
        "SELECT {CATEGORY_COLUMNS} {CATEGORY_FROM}
          WHERE ($2 OR c.active)
            AND ($3::text[] IS NULL OR c.direction = ANY($3))
            AND ($4::text IS NULL OR c.family = $4)
            AND ($5::text IS NULL OR $5 = ANY(c.domains))
          ORDER BY c.family, c.sort_order, c.code"
    );
    let rows = sqlx::query(&sql)
        .bind(site_id.unwrap_or(HEAD_OFFICE))
        .bind(include_retired)
        .bind(directions.as_deref())
        .bind(family.map(str::trim).filter(|f| !f.is_empty()))
        .bind(domain.map(str::trim).filter(|d| !d.is_empty()))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_category).collect()
}

pub async fn transaction_category_read(
    pool: &PgPool,
    code: &str,
    site_id: Option<&str>,
) -> Result<TransactionCategoryRow, AppError> {
    let sql = format!("SELECT {CATEGORY_COLUMNS} {CATEGORY_FROM} WHERE c.code = $2");
    let row = sqlx::query(&sql)
        .bind(site_id.unwrap_or(HEAD_OFFICE))
        .bind(code.trim())
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("category '{}'", code.trim())))?;
    to_category(&row)
}

/// What the client's chart is expected to carry for each category, and what it
/// carries here today.
///
/// Not a second copy of `required_semantic_keys`: that list is what the posting
/// RULES need and this is what the category list needs, and they overlap
/// without being the same question. A category pointing at a key nobody has
/// mapped is a category that lists fine and refuses when chosen, and this is
/// how somebody finds out before a person on a statement screen does.
pub async fn transaction_category_unmapped(
    pool: &PgPool,
    site_id: Option<&str>,
) -> Result<Vec<TransactionCategoryRow>, AppError> {
    let sql = format!(
        "SELECT {CATEGORY_COLUMNS} {CATEGORY_FROM}
          WHERE c.active AND m.account_code IS NULL
          ORDER BY c.family, c.sort_order, c.code"
    );
    let rows = sqlx::query(&sql)
        .bind(site_id.unwrap_or(HEAD_OFFICE))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_category).collect()
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordTransactionCategoryRequest {
    pub code: String,
    pub display_name: String,
    pub family: String,
    pub direction: String,
    pub semantic_key: String,
    #[serde(default)]
    pub qualifier: String,
    #[serde(default)]
    pub qualifier_asked: bool,
    pub source_document: String,
    #[serde(default)]
    pub requires_party: bool,
    #[serde(default)]
    pub requires_reference: bool,
    #[serde(default)]
    pub requires_approval: bool,
    #[serde(default)]
    pub domains: Vec<String>,
    #[serde(default)]
    pub bank_postable: bool,
    /// Required exactly when `bank_postable` is false. The database says the
    /// same thing; this is the sentence that explains it.
    pub refusal: Option<String>,
    pub expects_account_code: Option<String>,
    pub expects_account_name: Option<String>,
    pub note: Option<String>,
    pub sort_order: Option<i32>,
}

/// Add one. Refused before it is written when the shape is wrong, so the
/// message names the field rather than the constraint.
pub async fn transaction_category_record(
    pool: &PgPool,
    request: &RecordTransactionCategoryRequest,
    actor: &str,
) -> Result<TransactionCategoryRow, AppError> {
    let code = request.code.trim().to_ascii_lowercase();
    if code.is_empty() {
        return Err(AppError::Validation(
            "a category needs a code; it is what a rule and a posted document name it by".into(),
        ));
    }
    let direction = request.direction.trim().to_ascii_uppercase();
    if CategoryDirection::parse(&direction).is_none() {
        return Err(AppError::Validation(format!(
            "'{direction}' is not a direction; expected OUTFLOW, INFLOW or BOTH"
        )));
    }
    let source_document = request.source_document.trim().to_ascii_uppercase();
    let refusal = request
        .refusal
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    // Checked here rather than left to the CHECK, because this is the one a
    // person writing a category gets wrong and the constraint's message names
    // no field.
    if request.bank_postable == refusal.is_some() {
        return Err(AppError::Validation(
            "a category is either postable from a bank line, or it carries a sentence saying \
             what to do instead — never both and never neither. A refusal with no sentence is a \
             dead end for whoever hits it"
                .into(),
        ));
    }
    if request.bank_postable && request.requires_approval {
        return Err(AppError::Validation(
            "approval is a second person and categorising a bank line is one person's single \
             act; a category that needs a signature cannot be posted off a statement"
                .into(),
        ));
    }

    sqlx::query(
        "INSERT INTO transaction_category
           (code, display_name, family, direction, semantic_key, qualifier, qualifier_asked,
            source_document, requires_party, requires_reference, requires_approval,
            domains, bank_postable, refusal, expects_account_code, expects_account_name,
            note, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",
    )
    .bind(&code)
    .bind(request.display_name.trim())
    .bind(request.family.trim().to_ascii_uppercase())
    .bind(&direction)
    .bind(request.semantic_key.trim().to_ascii_lowercase())
    .bind(request.qualifier.trim())
    .bind(request.qualifier_asked)
    .bind(&source_document)
    .bind(request.requires_party)
    .bind(request.requires_reference)
    .bind(request.requires_approval)
    .bind(&request.domains)
    .bind(request.bank_postable)
    .bind(refusal)
    .bind(request.expects_account_code.as_deref())
    .bind(request.expects_account_name.as_deref())
    .bind(request.note.as_deref())
    .bind(request.sort_order.unwrap_or(100))
    .bind(actor)
    .execute(pool)
    .await?;
    transaction_category_read(pool, &code, None).await
}

/// Retire one rather than delete it.
///
/// A cash document names the category it was explained by and a rule names the
/// category it proposes. A category that could be deleted would leave posted
/// history unable to say what it meant — the same argument `bank_rule_retire`
/// makes, and the foreign keys make it non-negotiable anyway.
pub async fn transaction_category_deactivate(
    pool: &PgPool,
    code: &str,
    actor: &str,
) -> Result<TransactionCategoryRow, AppError> {
    let code = code.trim();
    let done = sqlx::query(
        "UPDATE transaction_category
            SET active = false, updated_by = $2, updated_at = now()
          WHERE code = $1",
    )
    .bind(code)
    .bind(actor)
    .execute(pool)
    .await?
    .rows_affected();
    if done == 0 {
        return Err(AppError::NotFound(format!("category '{code}'")));
    }
    transaction_category_read(pool, code, None).await
}

// ---------------------------------------------------------------------------
// The doors
// ---------------------------------------------------------------------------

/// Door one: an entry already in the books that is this line.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankLineMatchOption {
    /// Always `MATCH`. Stamped rather than implied, so a screen that flattens
    /// the three blocks still knows which door it is looking at.
    pub door: String,
    pub journal_line_id: Uuid,
    pub entry_number: String,
    /// What made the entry: `PAYMENT`, `CASH_DOC`, `SALE_DAY`, `PAYROLL`…
    /// This is what turns "a journal line for 1.250.000" into "the payment to
    /// Bank BCA", which is the difference between a match somebody can check
    /// and one they accept because the number agrees.
    pub source_kind: String,
    pub posting_date: NaiveDate,
    pub memo: String,
    pub score: i32,
    /// Which fields agreed, in words. The score only orders them.
    pub reasons: Vec<String>,
    /// True when the matcher would have taken this unaided.
    pub auto_match: bool,
}

/// Door two: the document that should have existed, and does not.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreatableDocumentOption {
    /// Always `CREATE`.
    pub door: String,
    /// `SUPPLIER_PAYMENT`, `PAYROLL_RUN`, `ACQUIRER_SETTLEMENT`…
    pub document_type: String,
    /// What to go and do, in the words of the categories that point at it.
    pub instruction: String,
    /// The categories a person might have reached for that lead here. Shown
    /// because "create a supplier payment" means nothing until it sits beside
    /// "you were looking for Hutang Supplier".
    pub reached_by: Vec<String>,
}

/// Door three: a category, and whether it may actually be taken.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CategoryOption {
    /// Always `CATEGORISE`.
    pub door: String,
    pub category: TransactionCategoryRow,
    /// False when this may not be posted from a bank line. It is still listed,
    /// because a person looking for "Gaji" has to find it and be told where to
    /// go — a list that simply omitted it would teach them to pick the nearest
    /// wrong thing.
    pub available: bool,
    /// Why not, when it may not.
    pub refusal: Option<String>,
    /// True when a rule proposed this. A suggestion a person accepts, never a
    /// decision already taken: `bank_rule_evaluate` writes proposals and stops.
    pub suggested: bool,
    /// The open proposal this suggestion came from, so accepting it can be
    /// recorded against the rule that made it.
    pub proposal_id: Option<Uuid>,
}

/// What can be done with one bank line, in the order it should be tried.
///
/// The field order IS the door order and the integration test asserts on it in
/// the serialised JSON, because that is what a screen sees. `door_order` says
/// the same thing as data for anything that walks the blocks generically.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankLineOptions {
    pub line_id: Uuid,
    pub value_date: NaiveDate,
    pub description: String,
    pub reference: Option<String>,
    pub debit_minor: i64,
    pub credit_minor: i64,
    /// True when the bank debited us: money leaving. Every direction decision
    /// downstream reads this and nothing re-derives it.
    pub outgoing: bool,
    pub statement_account_code: String,
    pub site_id: String,
    /// Set when this line is already agreed with an entry, or already became a
    /// document. All three blocks come back empty then: there is nothing left
    /// to decide, and offering the doors anyway would offer a second one.
    pub settled: Option<String>,

    pub matches: Vec<BankLineMatchOption>,
    pub creatable: Vec<CreatableDocumentOption>,
    pub categories: Vec<CategoryOption>,

    /// `["MATCH", "CREATE", "CATEGORISE"]`.
    pub door_order: Vec<String>,
}

/// Everything about the line itself, read once.
struct LineContext {
    statement_id: Uuid,
    value_date: NaiveDate,
    description: String,
    reference: Option<String>,
    debit_minor: i64,
    credit_minor: i64,
    account_code: String,
    site_id: String,
    settled: Option<String>,
}

async fn line_context(pool: &PgPool, line_id: Uuid) -> Result<LineContext, AppError> {
    let row = sqlx::query(
        "SELECT l.statement_id, l.value_date, l.description, l.reference,
                l.debit_minor, l.credit_minor, l.account_code, s.site_id,
                (SELECT e.entry_number FROM bank_line_match m
                   JOIN journal_line jl ON jl.line_id = m.journal_line_id
                   JOIN journal_entry e ON e.entry_id = jl.entry_id
                  WHERE m.line_id = l.line_id) AS matched_entry,
                (SELECT d.number FROM cash_document d WHERE d.statement_line_id = l.line_id)
                    AS became
           FROM bank_statement_line l
           JOIN bank_statement s USING (statement_id)
          WHERE l.line_id = $1",
    )
    .bind(line_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("bank statement line".into()))?;

    let matched: Option<String> = row.try_get("matched_entry")?;
    let became: Option<String> = row.try_get("became")?;
    // The document is named first when there is one: it is the thing a person
    // would go and look at, and its entry is what the match points to anyway.
    let settled = became
        .map(|number| format!("already booked as {number}"))
        .or_else(|| matched.map(|entry| format!("already agreed with entry {entry}")));

    Ok(LineContext {
        statement_id: row.try_get("statement_id")?,
        value_date: row.try_get("value_date")?,
        description: row.try_get("description")?,
        reference: row.try_get("reference")?,
        debit_minor: row.try_get("debit_minor")?,
        credit_minor: row.try_get("credit_minor")?,
        account_code: row.try_get("account_code")?,
        site_id: row.try_get("site_id")?,
        settled,
    })
}

/// The ledger rows on this account near this line that nothing has claimed, as
/// the matcher wants them.
///
/// A near-copy of `banking::candidates_for`, and deliberately not a call to it:
/// that one is private and returns the kernel's `Candidate`, which carries no
/// entry number, no source kind and no date. Door one is unusable without those
/// — "a journal line for 1.250.000" is not something a person can check — so
/// this reads the same rows and keeps what the screen needs beside what the
/// matcher needs. The two agree about which rows exist because they ask the
/// same question: on this account, in this window, not already matched.
struct LedgerRow {
    journal_line_id: Uuid,
    entry_number: String,
    source_kind: String,
    posting_date: NaiveDate,
    memo: String,
    debit_minor: i64,
    credit_minor: i64,
}

async fn open_ledger_rows(
    pool: &PgPool,
    account_code: &str,
    from: NaiveDate,
    to: NaiveDate,
    slack_days: i64,
) -> Result<Vec<LedgerRow>, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, e.entry_number, e.source_kind, e.posting_date,
                l.debit_minor, l.credit_minor,
                COALESCE(l.memo, e.memo, '') AS memo
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE l.account_code = $1
            AND e.posting_date BETWEEN ($2::date - $4::int) AND ($3::date + $4::int)
            AND NOT EXISTS (SELECT 1 FROM bank_line_match m WHERE m.journal_line_id = l.line_id)
          ORDER BY e.posting_date, l.line_id",
    )
    .bind(account_code)
    .bind(from)
    .bind(to)
    .bind(slack_days as i32)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(LedgerRow {
                journal_line_id: row.try_get("line_id")?,
                entry_number: row.try_get("entry_number")?,
                source_kind: row.try_get("source_kind")?,
                posting_date: row.try_get("posting_date")?,
                memo: row.try_get("memo")?,
                debit_minor: row.try_get("debit_minor")?,
                credit_minor: row.try_get("credit_minor")?,
            })
        })
        .collect()
}

/// Every open line of the statement, so the plan is made across all of them.
///
/// Scoring this line alone would offer a candidate that another line has a
/// better claim on, and the database would then refuse the match the screen
/// offered — `suggest_matches` says the same thing at length and this obeys it.
async fn open_lines_of(pool: &PgPool, statement_id: Uuid) -> Result<Vec<KernelBankLine>, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, l.value_date, l.description, l.reference,
                l.debit_minor, l.credit_minor
           FROM bank_statement_line l
          WHERE l.statement_id = $1
            AND NOT EXISTS (SELECT 1 FROM bank_line_match m WHERE m.line_id = l.line_id)
          ORDER BY l.line_number",
    )
    .bind(statement_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let line_id: Uuid = row.try_get("line_id")?;
            let value_date: NaiveDate = row.try_get("value_date")?;
            let debit: i64 = row.try_get("debit_minor")?;
            let credit: i64 = row.try_get("credit_minor")?;
            Ok(KernelBankLine {
                line_id: line_id.to_string(),
                day: i64::from(value_date.num_days_from_ce()),
                amount_minor: debit.max(credit),
                // A debit on the bank's statement is money leaving the account.
                outgoing: debit > 0,
                reference: row
                    .try_get::<Option<String>, _>("reference")?
                    .unwrap_or_default(),
                description: row.try_get("description")?,
            })
        })
        .collect()
}

/// The open rule proposal for this line, if a rule made one.
async fn open_proposal(
    pool: &PgPool,
    line_id: Uuid,
) -> Result<Option<(Uuid, Option<String>)>, AppError> {
    let row = sqlx::query(
        "SELECT proposal_id, category_code FROM bank_rule_proposal
          WHERE line_id = $1 AND status = 'PROPOSED'",
    )
    .bind(line_id)
    .fetch_optional(pool)
    .await?;
    match row {
        Some(row) => Ok(Some((
            row.try_get("proposal_id")?,
            row.try_get("category_code")?,
        ))),
        None => Ok(None),
    }
}

/// What can be done with one bank line, matches first.
///
/// See the module header for why the order is not cosmetic.
pub async fn bank_line_options(pool: &PgPool, line_id: Uuid) -> Result<BankLineOptions, AppError> {
    let context = line_context(pool, line_id).await?;
    let outgoing = context.debit_minor > 0;
    let door_order = DOOR_ORDER.iter().map(|d| (*d).to_string()).collect();

    if context.settled.is_some() {
        return Ok(BankLineOptions {
            line_id,
            value_date: context.value_date,
            description: context.description,
            reference: context.reference,
            debit_minor: context.debit_minor,
            credit_minor: context.credit_minor,
            outgoing,
            statement_account_code: context.account_code,
            site_id: context.site_id,
            settled: context.settled,
            matches: Vec::new(),
            creatable: Vec::new(),
            categories: Vec::new(),
            door_order,
        });
    }

    // ── door one ────────────────────────────────────────────────────────
    let rules = Ruleset::default();
    let open = open_lines_of(pool, context.statement_id).await?;
    let this = open
        .iter()
        .find(|line| line.line_id == line_id.to_string())
        .cloned()
        // Unreachable in practice: `settled` above is exactly the condition
        // that keeps a line out of `open`. Handled rather than unwrapped
        // because "unreachable" and "cannot happen" are different words.
        .ok_or_else(|| {
            AppError::Conflict("this line is no longer open for reconciliation".into())
        })?;

    let window = open_ledger_rows(
        pool,
        &context.account_code,
        open.iter()
            .map(|l| l.day)
            .min()
            .map(days_to_date)
            .unwrap_or(context.value_date),
        open.iter()
            .map(|l| l.day)
            .max()
            .map(days_to_date)
            .unwrap_or(context.value_date),
        rules.date_window_days,
    )
    .await?;

    let candidates: Vec<crate::cloud::domain::Candidate> = window
        .iter()
        .map(|row| crate::cloud::domain::Candidate {
            journal_line_id: row.journal_line_id.to_string(),
            day: i64::from(row.posting_date.num_days_from_ce()),
            amount_minor: row.debit_minor.max(row.credit_minor),
            // A credit on our own bank account is money leaving it, which the
            // bank reports as a debit. The translation happens here and in
            // `banking::candidates_for` and nowhere else.
            outgoing: row.credit_minor > 0,
            reference: row.entry_number.clone(),
            memo: row.memo.clone(),
        })
        .collect();

    let plan = resolve(&open, &candidates, &rules);
    let spoken_for: std::collections::HashMap<&str, &str> = plan
        .iter()
        .map(|a| (a.journal_line_id.as_str(), a.line_id.as_str()))
        .collect();

    let mut matches = Vec::new();
    for suggestion in suggest(&this, &candidates, &rules) {
        // A row the plan promised to a different line is not offered: the
        // database would refuse the match, and a button that cannot work is
        // worse than no button.
        match spoken_for.get(suggestion.journal_line_id.as_str()) {
            Some(&owner) if owner != this.line_id => continue,
            _ => {}
        }
        let Some(row) = window
            .iter()
            .find(|row| row.journal_line_id.to_string() == suggestion.journal_line_id)
        else {
            continue;
        };
        matches.push(BankLineMatchOption {
            door: DOOR_ORDER[0].to_string(),
            journal_line_id: row.journal_line_id,
            entry_number: row.entry_number.clone(),
            source_kind: row.source_kind.clone(),
            posting_date: row.posting_date,
            memo: row.memo.clone(),
            score: suggestion.score,
            reasons: suggestion.reasons,
            auto_match: spoken_for
                .get(suggestion.journal_line_id.as_str())
                .is_some(),
        });
    }

    // ── doors two and three ─────────────────────────────────────────────
    //
    // One read of the category master, split by whether the category makes its
    // own paper. Two queries would be two chances for them to disagree about
    // which categories exist.
    let all = transaction_category_list(
        pool,
        Some(&context.site_id),
        Some(if outgoing { "OUTFLOW" } else { "INFLOW" }),
        None,
        Some("BANK"),
        false,
    )
    .await?;

    let proposal = open_proposal(pool, line_id).await?;
    let suggested_code = proposal.as_ref().and_then(|(_, code)| code.clone());
    let proposal_id = proposal.as_ref().map(|(id, _)| *id);

    let mut creatable: Vec<CreatableDocumentOption> = Vec::new();
    let mut categories: Vec<CategoryOption> = Vec::new();
    for row in all {
        let facts = facts_of(&row);
        if !offered_for_line(&facts, outgoing) {
            continue;
        }
        if crate::cloud::domain::makes_its_own_document(&row.source_document) {
            let refusal = refuse_from_bank_line(&facts);
            let suggested = suggested_code.as_deref() == Some(row.code.as_str());
            categories.push(CategoryOption {
                door: DOOR_ORDER[2].to_string(),
                available: refusal.is_none(),
                refusal,
                suggested,
                proposal_id: if suggested { proposal_id } else { None },
                category: row,
            });
            continue;
        }
        // A category pointing at somebody else's document IS door two: it is
        // how a person who went looking for "Hutang Supplier" is told to make
        // a supplier payment. Grouped by the document, because five payroll
        // categories are one instruction.
        let instruction = refuse_from_bank_line(&facts).unwrap_or_else(|| {
            format!(
                "create the {}",
                row.source_document.to_lowercase().replace('_', " ")
            )
        });
        match creatable
            .iter_mut()
            .find(|option| option.document_type == row.source_document)
        {
            Some(existing) => existing.reached_by.push(row.display_name.clone()),
            None => creatable.push(CreatableDocumentOption {
                door: DOOR_ORDER[1].to_string(),
                document_type: row.source_document.clone(),
                instruction,
                reached_by: vec![row.display_name.clone()],
            }),
        }
    }

    // A rule's suggestion first among the categories, because it is the answer
    // somebody is most likely to agree with — and only among them, so it can
    // never jump ahead of a match.
    categories.sort_by_key(|option| !option.suggested);

    Ok(BankLineOptions {
        line_id,
        value_date: context.value_date,
        description: context.description,
        reference: context.reference,
        debit_minor: context.debit_minor,
        credit_minor: context.credit_minor,
        outgoing,
        statement_account_code: context.account_code,
        site_id: context.site_id,
        settled: None,
        matches,
        creatable,
        categories,
        door_order,
    })
}

/// Days since the common era, back to a date.
///
/// The kernel counts in days because a kernel that could name a date is one
/// line from asking for today's; this is the caller's half of that bargain.
/// The fallback is the CE epoch, which is a date the statement window will
/// never contain — a window that started there would simply be wide.
fn days_to_date(days: i64) -> NaiveDate {
    i32::try_from(days)
        .ok()
        .and_then(NaiveDate::from_num_days_from_ce_opt)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(1, 1, 1).unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Door three, taken
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CategoriseBankLineRequest {
    pub category_code: String,
    /// Which of the meaning's accounts, when the category asks. Ignored when
    /// it does not: the category's own qualifier is the answer then, and
    /// letting a caller override it would let them repoint one posting.
    pub qualifier: Option<String>,
    /// Who the slip names. Defaults to the bank, which is what most of these
    /// are.
    pub party_name: Option<String>,
    /// The paper behind it — a policy number, an NTPN, a subscriber number.
    /// The line's own reference counts when it has one.
    pub reference: Option<String>,
    /// Why this line is this category. Required, the same way a reversal's
    /// reason is: it is the only record of the judgement somebody made.
    pub memo: String,
    /// The rule proposal being accepted, when this came from one. Recorded so
    /// a rule that keeps being agreed with can be told from one that never is.
    pub proposal_id: Option<Uuid>,
}

/// Explain a bank line with a category, and book it.
///
/// This is the third door and the last one. It creates a cash document and
/// posts that — never a journal entry from a statement line — and it refuses
/// every category that belongs to a document some other screen owns, naming
/// that document.
pub async fn bank_line_categorise(
    pool: &PgPool,
    line_id: Uuid,
    request: &CategoriseBankLineRequest,
    actor: &str,
) -> Result<CashDocumentRow, AppError> {
    let context = line_context(pool, line_id).await?;
    if let Some(settled) = context.settled {
        return Err(AppError::Conflict(format!(
            "this line is {settled}; unmatch it or reverse that document if it is wrong"
        )));
    }
    let category =
        transaction_category_read(pool, request.category_code.trim(), Some(&context.site_id))
            .await?;
    let facts = facts_of(&category);
    let outgoing = context.debit_minor > 0;

    // Direction first, because it is the refusal that says the most: a person
    // who reached for interest income on a debit has misread the line, not
    // chosen a category they were not allowed.
    if !facts.direction.fits(outgoing) {
        return Err(AppError::Validation(format!(
            "'{}' explains money {}, and this line is money {}",
            category.display_name,
            if outgoing { "coming in" } else { "going out" },
            if outgoing { "going out" } else { "coming in" }
        )));
    }
    // Where the category is allowed to be used at all. Checked here and not
    // only in the list, because the list is a screen's convenience and this is
    // the gate: a caller that never opened the list can still send a code, and
    // `ops_miscellaneous` is deliberately not something a statement line may
    // become however it is reached.
    if !category.domains.iter().any(|domain| domain == "BANK") {
        return Err(AppError::Validation(format!(
            "'{}' is not something a bank line can be; it is used {}",
            category.display_name,
            if category.domains.is_empty() {
                "nowhere — it exists so that a refusal can name it".to_string()
            } else {
                format!(
                    "on a {} document",
                    category
                        .domains
                        .join(" or ")
                        .to_lowercase()
                        .replace('_', " ")
                )
            }
        )));
    }
    if let Some(refusal) = refuse_from_bank_line(&facts) {
        return Err(AppError::Validation(refusal));
    }

    // The line's own reference counts: a person should not have to retype what
    // the bank already told us.
    let reference = request
        .reference
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(context.reference.as_deref());
    let qualifier = if category.qualifier_asked {
        request
            .qualifier
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .to_string()
    } else {
        category.qualifier.clone()
    };
    if let Some(missing) = missing_before_posting(
        &facts,
        Some(&qualifier),
        request.party_name.as_deref(),
        reference,
    ) {
        return Err(AppError::Validation(missing));
    }

    let memo = request.memo.trim();
    if memo.is_empty() {
        return Err(AppError::Validation(
            "say what this line was; the category says which account, and the note is the only \
             record of why this line is that category"
                .into(),
        ));
    }
    // The reference joins the note rather than getting a column of its own: it
    // is what the slip prints under the reason, and `cash_document` already
    // has exactly one line for that.
    let memo = match reference {
        Some(reference) => format!("{memo} ({reference})"),
        None => memo.to_string(),
    };

    let mut tx = pool.begin().await?;
    let booked = bank_line_to_document(
        &mut tx,
        line_id,
        &OtherSide::Meaning {
            semantic_key: category.semantic_key.clone(),
            qualifier,
            // The category means the same thing everywhere; which leaf it lands
            // on is the statement's own location. A category posted at head
            // office for a charge on a shop's account would be filed in the
            // wrong book and still balance.
            site_id: context.site_id.clone(),
        },
        request.party_name.as_deref().unwrap_or("Bank"),
        &memo,
        &format!(
            "categorised as {} ({})",
            category.display_name, category.code
        ),
        actor,
    )
    .await?;

    // The label, beside the accounts. Not part of `bank_line_to_document`
    // because that door is also used by the person who chose a raw account
    // code, and there is no category to record then.
    sqlx::query("UPDATE cash_document SET category_code = $2 WHERE document_id = $1")
        .bind(booked.document_id)
        .bind(&category.code)
        .execute(&mut *tx)
        .await?;

    if let Some(proposal_id) = request.proposal_id {
        let done = sqlx::query(
            "UPDATE bank_rule_proposal
                SET status='ACCEPTED', cash_document_id=$2, decided_by=$3, decided_at=now()
              WHERE proposal_id=$1 AND line_id=$4 AND status='PROPOSED'",
        )
        .bind(proposal_id)
        .bind(booked.document_id)
        .bind(actor)
        .bind(line_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if done == 0 {
            return Err(AppError::Conflict(
                "that proposal is not open on this line; it has been decided already, or it \
                 belongs to another line"
                    .into(),
            ));
        }
    }
    tx.commit().await?;

    cash_document_read(pool, booked.document_id).await
}
