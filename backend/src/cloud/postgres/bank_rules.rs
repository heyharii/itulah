//! Rules that recognise a bank line, and the proposals they make.
//!
//! The scoring half of reconciliation — "which of our entries is this?" — is
//! `banking.rs` over the pure kernel in `domain::bank_match`. This is the other
//! half: the lines where the answer is "none of them, and it is the same four
//! narrations every month".
//!
//! # A rule proposes. Nothing here posts.
//!
//! `bank_rule_evaluate` writes `bank_rule_proposal` rows and stops. It cannot
//! post, and that is structural rather than a habit: it never opens a poster
//! transaction. Accepting is a separate act by a person, and accepting is what
//! creates a cash document — so a rule-recognised bank charge ends up with the
//! same paper behind it as one somebody keyed by hand, and can be printed,
//! reversed and filed the same way.
//!
//! # Where the regex is evaluated, and why not here
//!
//! `CONTAINS` and `STARTS_WITH` are decided by the kernel, on normalised text.
//! `REGEX` is decided by Postgres's own POSIX engine — this crate carries no
//! regex engine, and adding a dialect would mean a pattern that behaves one way
//! in a preview and another in the query that applies it. So the query computes
//! `description ~* pattern` per (line, rule) and hands the kernel the verdict,
//! which is exactly the discipline every other input to that module follows.
//!
//! A pattern that Postgres cannot compile is refused when the rule is written,
//! not when it is applied: an invalid pattern discovered during evaluation
//! would abort the whole run and leave a screen unable to say which rule did it.
//!
//! # A rule proposes a CATEGORY, and the category knows the account
//!
//! This module first carried a `semantic_key` of its own, because when it was
//! written there was nowhere else for a rule to point. There is now
//! (`transaction_category`, 0155), and meaning declared in two places is
//! meaning that can disagree: repoint the category the day PPh on jasa giro
//! moves, and a rule still holding its own key goes on proposing the old
//! account — recognising the right line and being wrong about what it means,
//! which is the worse of the two failures because the proposal still looks
//! reasonable.
//!
//! So the category is what a rule names, and the key stays as the fallback for
//! a narration no category covers yet. Where both are present the category
//! wins, in the query — `COALESCE(c.semantic_key, r.semantic_key)` — rather
//! than by a precedence rule somebody has to remember.
//!
//! Accepting is then not this module's judgement at all: it hands the line and
//! the category to `bank_line_categorise`, which is the same door a person
//! choosing a category by hand goes through. That matters more than saving the
//! code. It means a rule that proposes a category nobody may choose — somebody
//! writes one for the monthly payroll transfer so that it stops showing as
//! unrecognised — is refused on acceptance with the sentence naming the payroll
//! run, instead of quietly booking a salary expense for the second time.

use super::banking::{bank_line_to_document, OtherSide};
use super::cash::{cash_document_read, CashDocumentRow};
use super::transaction_categories::{bank_line_categorise, CategoriseBankLineRequest};
use crate::cloud::application::AppError;
use crate::cloud::domain::{recognise, BankLine, NarrationRule, RuleDirection, RuleMatch};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankRuleRow {
    pub rule_id: Uuid,
    /// Lowest first. `PAJAK BUNGA` sits above `BUNGA` because it contains it.
    pub priority: i32,
    /// `CONTAINS`, `STARTS_WITH` or `REGEX`.
    pub match_kind: String,
    pub pattern: String,
    /// `IN`, `OUT` or `ANY`, as the bank reports it.
    pub direction: String,
    /// What this rule says the line means, in the words a person uses.
    pub category_code: Option<String>,
    pub category_name: Option<String>,
    /// True when the category this rule proposes is one a person may not
    /// choose from a bank line. Not forbidden — recognising the payroll
    /// transfer so it stops looking unrecognised is a reasonable thing to want
    /// — but the rule then only ever produces refusals, and that is worth
    /// seeing beside it rather than discovering by accepting one.
    pub category_refuses: bool,
    /// A meaning named directly, for a narration no category covers yet.
    /// Ignored when `category_code` is set.
    pub semantic_key: Option<String>,
    pub qualifier: String,
    pub site_id: String,
    /// What that meaning resolves to at that location today, so a screen can
    /// show the account without a second round trip. Read through the map on
    /// every read, so it follows a remapping instead of remembering where the
    /// account used to be.
    pub account_code: Option<String>,
    pub account_name: Option<String>,
    pub party: Option<String>,
    pub active: bool,
    pub note: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    /// How many lines this rule has recognised, and how many were accepted.
    /// A rule with proposals and no acceptances is one people keep saying no
    /// to, which is worth seeing beside it.
    pub proposed_count: i64,
    pub accepted_count: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordBankRuleRequest {
    pub priority: Option<i32>,
    pub match_kind: String,
    pub pattern: String,
    pub direction: Option<String>,
    /// What the line means. Preferred, and one of this and `semantic_key` has
    /// to be given.
    pub category_code: Option<String>,
    /// A meaning named directly, for the narration no category covers yet.
    pub semantic_key: Option<String>,
    #[serde(default)]
    pub qualifier: String,
    pub site_id: Option<String>,
    pub party: Option<String>,
    pub active: Option<bool>,
    pub note: Option<String>,
}

/// The category wins where both are present, and it wins in the query rather
/// than in a branch somebody could forget: everything downstream — the account
/// shown beside the rule, the key the fallback path posts through — reads the
/// same COALESCE.
const RULE_COLUMNS: &str = "r.rule_id, r.priority, r.match_kind, r.pattern, r.direction,
     r.category_code, c.display_name AS category_name,
     COALESCE(NOT c.bank_postable, false) AS category_refuses,
     r.semantic_key, r.qualifier, r.site_id, r.party, r.active, r.note,
     r.created_by, r.created_at,
     m.account_code, a.name AS account_name,
     (SELECT COUNT(*) FROM bank_rule_proposal p WHERE p.rule_id = r.rule_id)::bigint
         AS proposed_count,
     (SELECT COUNT(*) FROM bank_rule_proposal p
       WHERE p.rule_id = r.rule_id AND p.status = 'ACCEPTED')::bigint AS accepted_count";

/// LEFT, for the same reason `supplier_payment`'s join is: a rule whose meaning
/// nobody has mapped yet is exactly the rule somebody needs to see on the
/// screen, and hiding it would hide the thing that has to be fixed.
const RULE_FROM: &str = "FROM bank_rule r
     LEFT JOIN transaction_category c ON c.code = r.category_code
     LEFT JOIN account_resolution m ON m.role = COALESCE(c.semantic_key, r.semantic_key)
                                   AND m.site_id = r.site_id
                                   AND m.source_type = 'COMPANY'
                                   AND m.source_id = COALESCE(c.qualifier, r.qualifier)
     LEFT JOIN ledger_account a ON a.account_code = m.account_code";

fn to_rule(row: &sqlx::postgres::PgRow) -> Result<BankRuleRow, AppError> {
    Ok(BankRuleRow {
        rule_id: row.try_get("rule_id")?,
        priority: row.try_get("priority")?,
        match_kind: row.try_get("match_kind")?,
        pattern: row.try_get("pattern")?,
        direction: row.try_get("direction")?,
        category_code: row.try_get("category_code")?,
        category_name: row.try_get("category_name")?,
        category_refuses: row.try_get("category_refuses")?,
        semantic_key: row.try_get("semantic_key")?,
        qualifier: row.try_get("qualifier")?,
        site_id: row.try_get("site_id")?,
        account_code: row.try_get("account_code")?,
        account_name: row.try_get("account_name")?,
        party: row.try_get("party")?,
        active: row.try_get("active")?,
        note: row.try_get("note")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        proposed_count: row.try_get("proposed_count")?,
        accepted_count: row.try_get("accepted_count")?,
    })
}

pub async fn bank_rule_list(
    pool: &PgPool,
    include_retired: bool,
) -> Result<Vec<BankRuleRow>, AppError> {
    let sql = format!(
        "SELECT {RULE_COLUMNS} {RULE_FROM}
          WHERE ($1 OR r.active)
          ORDER BY r.active DESC, r.priority, r.pattern"
    );
    let rows = sqlx::query(&sql)
        .bind(include_retired)
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_rule).collect()
}

async fn read_rule(pool: &PgPool, rule_id: Uuid) -> Result<BankRuleRow, AppError> {
    let sql = format!("SELECT {RULE_COLUMNS} {RULE_FROM} WHERE r.rule_id = $1");
    let row = sqlx::query(&sql)
        .bind(rule_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("bank rule".into()))?;
    to_rule(&row)
}

const MATCH_KINDS: [&str; 3] = ["CONTAINS", "STARTS_WITH", "REGEX"];

/// Everything about a rule that has to be true before it is written down.
struct CheckedRule {
    priority: i32,
    match_kind: String,
    pattern: String,
    direction: String,
    category_code: Option<String>,
    semantic_key: Option<String>,
    qualifier: String,
    site_id: String,
    party: Option<String>,
    active: bool,
    note: Option<String>,
}

async fn check_rule(
    pool: &PgPool,
    request: &RecordBankRuleRequest,
) -> Result<CheckedRule, AppError> {
    let match_kind = request.match_kind.trim().to_ascii_uppercase();
    if !MATCH_KINDS.contains(&match_kind.as_str()) {
        return Err(AppError::Validation(format!(
            "'{match_kind}' is not a way of matching a narration; expected one of {}",
            MATCH_KINDS.join(", ")
        )));
    }
    let pattern = request.pattern.trim().to_string();
    if pattern.is_empty() {
        return Err(AppError::Validation(
            "a rule needs something to match on; an empty pattern would claim every line".into(),
        ));
    }
    let direction = request
        .direction
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_uppercase)
        .unwrap_or_else(|| "ANY".to_string());
    if RuleDirection::parse(&direction).is_none() {
        return Err(AppError::Validation(format!(
            "'{direction}' is not a direction; expected IN, OUT or ANY"
        )));
    }
    // A category, a bare meaning, or a refusal. Never both — a rule carrying
    // two answers is a rule that will be read two ways.
    let category_code = request
        .category_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    let semantic_key = request
        .semantic_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    match (&category_code, &semantic_key) {
        (None, None) => {
            return Err(AppError::Validation(
                "a rule says what the line means; give it a category, or — for a narration no \
                 category covers yet — a meaning of its own"
                    .into(),
            ))
        }
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "a rule names a category or a meaning, never both; the category already knows \
                 which meaning it resolves through, and a second answer beside it is one that \
                 can disagree"
                    .into(),
            ))
        }
        _ => {}
    }
    // Checked before the rule is written rather than left to the foreign key,
    // so the refusal names the category instead of arriving as a 23503.
    if let Some(code) = &category_code {
        let found = sqlx::query("SELECT active FROM transaction_category WHERE code = $1")
            .bind(code)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::Validation(format!("no category '{code}'")))?;
        if !found.try_get::<bool, _>("active")? {
            return Err(AppError::Validation(format!(
                "category '{code}' has been retired; a rule proposing it would propose something \
                 nobody may accept"
            )));
        }
    }
    // No site named means head office, which keeps the bank accounts — found
    // by its kind, never spelled (0603).
    let site_id = match request
        .site_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(site) => site.to_string(),
        None => super::sites::head_office_site_id(pool).await?,
    };

    // Compiled once, here, rather than discovered during a run. Postgres
    // raises 2201B for a pattern it cannot parse, and inside `evaluate` that
    // would abort every line in the statement and name none of them.
    if match_kind == "REGEX" {
        sqlx::query("SELECT ''::text ~* $1 AS ok")
            .bind(&pattern)
            .fetch_one(pool)
            .await
            .map_err(|error| match &error {
                sqlx::Error::Database(db) if db.code().as_deref() == Some("2201B") => {
                    AppError::Validation(format!(
                        "'{pattern}' is not a pattern Postgres can read: {}",
                        db.message()
                    ))
                }
                _ => AppError::from(error),
            })?;
    }

    Ok(CheckedRule {
        priority: request.priority.unwrap_or(100).max(1),
        match_kind,
        pattern,
        direction,
        category_code,
        semantic_key,
        qualifier: request.qualifier.trim().to_string(),
        site_id,
        party: request
            .party
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        active: request.active.unwrap_or(true),
        note: request.note.clone(),
    })
}

pub async fn bank_rule_record(
    pool: &PgPool,
    request: &RecordBankRuleRequest,
    actor: &str,
) -> Result<BankRuleRow, AppError> {
    let checked = check_rule(pool, request).await?;
    let rule_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO bank_rule
           (rule_id, priority, match_kind, pattern, direction, category_code, semantic_key,
            qualifier, site_id, party, active, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    )
    .bind(rule_id)
    .bind(checked.priority)
    .bind(&checked.match_kind)
    .bind(&checked.pattern)
    .bind(&checked.direction)
    .bind(checked.category_code.as_deref())
    .bind(checked.semantic_key.as_deref())
    .bind(&checked.qualifier)
    .bind(&checked.site_id)
    .bind(checked.party.as_deref())
    .bind(checked.active)
    .bind(checked.note.as_deref())
    .bind(actor)
    .execute(pool)
    .await?;
    read_rule(pool, rule_id).await
}

pub async fn bank_rule_update(
    pool: &PgPool,
    rule_id: Uuid,
    request: &RecordBankRuleRequest,
    actor: &str,
) -> Result<BankRuleRow, AppError> {
    let checked = check_rule(pool, request).await?;
    let done = sqlx::query(
        "UPDATE bank_rule
            SET priority=$2, match_kind=$3, pattern=$4, direction=$5,
                category_code=$6, semantic_key=$7,
                qualifier=$8, site_id=$9, party=$10, active=$11, note=$12,
                updated_by=$13, updated_at=now()
          WHERE rule_id=$1",
    )
    .bind(rule_id)
    .bind(checked.priority)
    .bind(&checked.match_kind)
    .bind(&checked.pattern)
    .bind(&checked.direction)
    .bind(checked.category_code.as_deref())
    .bind(checked.semantic_key.as_deref())
    .bind(&checked.qualifier)
    .bind(&checked.site_id)
    .bind(checked.party.as_deref())
    .bind(checked.active)
    .bind(checked.note.as_deref())
    .bind(actor)
    .execute(pool)
    .await?
    .rows_affected();
    if done == 0 {
        return Err(AppError::NotFound("bank rule".into()));
    }
    read_rule(pool, rule_id).await
}

/// Retire a rule rather than delete it.
///
/// A proposal names the rule that made it, and a rule that could be deleted
/// would leave accepted history unable to say why an account was chosen.
pub async fn bank_rule_retire(
    pool: &PgPool,
    rule_id: Uuid,
    actor: &str,
) -> Result<BankRuleRow, AppError> {
    let done = sqlx::query(
        "UPDATE bank_rule SET active=false, updated_by=$2, updated_at=now() WHERE rule_id=$1",
    )
    .bind(rule_id)
    .bind(actor)
    .execute(pool)
    .await?
    .rows_affected();
    if done == 0 {
        return Err(AppError::NotFound("bank rule".into()));
    }
    read_rule(pool, rule_id).await
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankRuleProposalRow {
    pub proposal_id: Uuid,
    pub line_id: Uuid,
    pub rule_id: Uuid,
    /// The pattern that recognised it, so the screen can say why without
    /// fetching the rule.
    pub rule_pattern: String,
    /// What the rule said this line means. Frozen when the proposal was made,
    /// so a rule repointed afterwards cannot silently repoint a proposal a
    /// person has already read.
    pub category_code: Option<String>,
    pub category_name: Option<String>,
    /// The sentence a person will get if they accept it and may not. Present
    /// on the proposal rather than discovered on acceptance, because a screen
    /// that offers Accept beside a proposal that cannot be accepted is a screen
    /// that lies.
    pub category_refusal: Option<String>,
    pub semantic_key: Option<String>,
    pub qualifier: String,
    pub site_id: String,
    pub account_code: Option<String>,
    pub account_name: Option<String>,
    pub status: String,
    pub cash_document_id: Option<Uuid>,
    pub cash_document_number: Option<String>,

    /// The line itself, because a proposal read on its own is unreadable: the
    /// narration IS the evidence a person is judging.
    pub value_date: NaiveDate,
    pub description: String,
    pub reference: Option<String>,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub statement_account_code: String,
    pub statement_site_id: String,

    pub proposed_at: DateTime<Utc>,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub reason: Option<String>,
}

const PROPOSAL_COLUMNS: &str = "p.proposal_id, p.line_id, p.rule_id, r.pattern AS rule_pattern,
     p.category_code, c.display_name AS category_name, c.refusal AS category_refusal,
     p.semantic_key, p.qualifier, p.site_id, p.status, p.cash_document_id,
     d.number AS cash_document_number,
     l.value_date, l.description, l.reference, l.debit_minor, l.credit_minor,
     l.account_code AS statement_account_code, s.site_id AS statement_site_id,
     p.proposed_at, p.decided_by, p.decided_at, p.reason,
     m.account_code, a.name AS account_name";

const PROPOSAL_FROM: &str = "FROM bank_rule_proposal p
     JOIN bank_rule r USING (rule_id)
     JOIN bank_statement_line l ON l.line_id = p.line_id
     JOIN bank_statement s ON s.statement_id = l.statement_id
     LEFT JOIN cash_document d ON d.document_id = p.cash_document_id
     LEFT JOIN transaction_category c ON c.code = p.category_code
     LEFT JOIN account_resolution m ON m.role = COALESCE(c.semantic_key, p.semantic_key)
                                   AND m.site_id = p.site_id
                                   AND m.source_type = 'COMPANY'
                                   AND m.source_id = COALESCE(c.qualifier, p.qualifier)
     LEFT JOIN ledger_account a ON a.account_code = m.account_code";

fn to_proposal(row: &sqlx::postgres::PgRow) -> Result<BankRuleProposalRow, AppError> {
    Ok(BankRuleProposalRow {
        proposal_id: row.try_get("proposal_id")?,
        line_id: row.try_get("line_id")?,
        rule_id: row.try_get("rule_id")?,
        rule_pattern: row.try_get("rule_pattern")?,
        category_code: row.try_get("category_code")?,
        category_name: row.try_get("category_name")?,
        category_refusal: row.try_get("category_refusal")?,
        semantic_key: row.try_get("semantic_key")?,
        qualifier: row.try_get("qualifier")?,
        site_id: row.try_get("site_id")?,
        account_code: row.try_get("account_code")?,
        account_name: row.try_get("account_name")?,
        status: row.try_get("status")?,
        cash_document_id: row.try_get("cash_document_id")?,
        cash_document_number: row.try_get("cash_document_number")?,
        value_date: row.try_get("value_date")?,
        description: row.try_get("description")?,
        reference: row.try_get("reference")?,
        debit_minor: row.try_get("debit_minor")?,
        credit_minor: row.try_get("credit_minor")?,
        statement_account_code: row.try_get("statement_account_code")?,
        statement_site_id: row.try_get("statement_site_id")?,
        proposed_at: row.try_get("proposed_at")?,
        decided_by: row.try_get("decided_by")?,
        decided_at: row.try_get("decided_at")?,
        reason: row.try_get("reason")?,
    })
}

pub async fn bank_proposal_list(
    pool: &PgPool,
    status: Option<&str>,
    statement_id: Option<Uuid>,
    limit: i64,
) -> Result<Vec<BankRuleProposalRow>, AppError> {
    let sql = format!(
        "SELECT {PROPOSAL_COLUMNS} {PROPOSAL_FROM}
          WHERE ($1::text IS NULL OR p.status = $1)
            AND ($2::uuid IS NULL OR l.statement_id = $2)
          ORDER BY p.status <> 'PROPOSED', l.value_date, p.proposed_at
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(status)
        .bind(statement_id)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_proposal).collect()
}

async fn read_proposal(pool: &PgPool, proposal_id: Uuid) -> Result<BankRuleProposalRow, AppError> {
    let sql = format!("SELECT {PROPOSAL_COLUMNS} {PROPOSAL_FROM} WHERE p.proposal_id = $1");
    let row = sqlx::query(&sql)
        .bind(proposal_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("proposal".into()))?;
    to_proposal(&row)
}

/// What one run of the rules found.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankRuleRunOutcome {
    /// Lines looked at: unmatched, undecided, and not already a document.
    pub examined: i64,
    pub proposed: i64,
    /// Lines no active rule recognised. The number that says whether the rule
    /// list is doing anything, and it is reported rather than left to be
    /// inferred from a shorter list than expected.
    pub unrecognised: i64,
    pub proposals: Vec<BankRuleProposalRow>,
}

/// Apply every active rule to every open line, and propose. Post nothing.
///
/// One query rather than one per line: the rule list is short and the join is
/// what lets Postgres answer the REGEX question for every pair at once. The
/// alternative — a query per line — is how a statement of two hundred lines
/// becomes two hundred round trips to draw one screen.
pub async fn bank_rule_evaluate(
    pool: &PgPool,
    statement_id: Option<Uuid>,
) -> Result<BankRuleRunOutcome, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, l.value_date, l.description, l.reference,
                l.debit_minor, l.credit_minor,
                r.rule_id, r.priority, r.direction, r.match_kind, r.pattern,
                r.category_code, r.semantic_key, r.qualifier, r.site_id,
                CASE WHEN r.match_kind = 'REGEX'
                     THEN (l.description ~* r.pattern)
                     ELSE false END AS regex_hit
           FROM bank_statement_line l
           CROSS JOIN bank_rule r
          WHERE r.active
            AND ($1::uuid IS NULL OR l.statement_id = $1)
            AND NOT EXISTS (SELECT 1 FROM bank_line_match m WHERE m.line_id = l.line_id)
            AND NOT EXISTS (SELECT 1 FROM bank_rule_proposal p WHERE p.line_id = l.line_id)
            AND NOT EXISTS (SELECT 1 FROM cash_document d WHERE d.statement_line_id = l.line_id)
          ORDER BY l.value_date, l.line_id",
    )
    .bind(statement_id)
    .fetch_all(pool)
    .await?;

    // Grouped by line, in a map that keeps the order the ids sort in, so two
    // runs over the same statement do the same thing in the same order.
    /// What each rule would propose, keyed by the rule's id. Copied out of the
    /// row here so that the write below quotes what the rule said at THIS
    /// moment, rather than reading it again through the rule.
    struct Proposes {
        category_code: Option<String>,
        semantic_key: Option<String>,
        qualifier: String,
        site_id: String,
    }
    struct Open {
        line: BankLine,
        rules: Vec<NarrationRule>,
        proposal: BTreeMap<String, Proposes>,
    }
    let mut open: BTreeMap<Uuid, Open> = BTreeMap::new();
    for row in &rows {
        let line_id: Uuid = row.try_get("line_id")?;
        let debit: i64 = row.try_get("debit_minor")?;
        let credit: i64 = row.try_get("credit_minor")?;
        let description: String = row.try_get("description")?;
        let value_date: NaiveDate = row.try_get("value_date")?;
        let entry = open.entry(line_id).or_insert_with(|| Open {
            line: BankLine {
                line_id: line_id.to_string(),
                day: i64::from(value_date.num_days_from_ce()),
                amount_minor: debit.max(credit),
                // A debit on the bank's statement is money leaving.
                outgoing: debit > 0,
                reference: row
                    .try_get::<Option<String>, _>("reference")
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
                description: description.clone(),
            },
            rules: Vec::new(),
            proposal: BTreeMap::new(),
        });

        let rule_id: Uuid = row.try_get("rule_id")?;
        let match_kind: String = row.try_get("match_kind")?;
        let pattern: String = row.try_get("pattern")?;
        let direction: String = row.try_get("direction")?;
        let matcher = match match_kind.as_str() {
            "STARTS_WITH" => RuleMatch::StartsWith(pattern),
            "REGEX" => RuleMatch::Regex {
                pattern,
                matched: row.try_get("regex_hit")?,
            },
            _ => RuleMatch::Contains(pattern),
        };
        entry.rules.push(NarrationRule {
            rule_id: rule_id.to_string(),
            priority: row.try_get("priority")?,
            direction: RuleDirection::parse(&direction).unwrap_or(RuleDirection::Any),
            matcher,
        });
        entry.proposal.insert(
            rule_id.to_string(),
            Proposes {
                category_code: row.try_get("category_code")?,
                semantic_key: row.try_get("semantic_key")?,
                qualifier: row.try_get("qualifier")?,
                site_id: row.try_get("site_id")?,
            },
        );
    }

    let examined = open.len() as i64;
    let mut proposed = 0i64;
    let mut unrecognised = 0i64;
    let mut written: Vec<Uuid> = Vec::new();
    for (line_id, candidate) in &open {
        let Some(hit) = recognise(&candidate.line, &candidate.rules) else {
            unrecognised += 1;
            continue;
        };
        let Some(proposes) = candidate.proposal.get(&hit.rule_id) else {
            unrecognised += 1;
            continue;
        };
        let rule_id: Uuid = hit
            .rule_id
            .parse()
            .map_err(|_| AppError::Validation("a rule id stopped being a uuid".into()))?;
        let proposal_id = Uuid::new_v4();
        // ON CONFLICT DO NOTHING against the partial unique index, so two
        // people pressing Evaluate at the same moment produce one proposal
        // rather than one and an opaque 23505.
        let done = sqlx::query(
            "INSERT INTO bank_rule_proposal
               (proposal_id, line_id, rule_id, category_code, semantic_key, qualifier,
                site_id, reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (line_id) WHERE status = 'PROPOSED' DO NOTHING",
        )
        .bind(proposal_id)
        .bind(line_id)
        .bind(rule_id)
        .bind(proposes.category_code.as_deref())
        .bind(proposes.semantic_key.as_deref())
        .bind(&proposes.qualifier)
        .bind(&proposes.site_id)
        .bind(&hit.reason)
        .execute(pool)
        .await?
        .rows_affected();
        if done == 1 {
            proposed += 1;
            written.push(proposal_id);
        }
    }

    let mut proposals = Vec::with_capacity(written.len());
    for proposal_id in written {
        proposals.push(read_proposal(pool, proposal_id).await?);
    }
    Ok(BankRuleRunOutcome {
        examined,
        proposed,
        unrecognised,
        proposals,
    })
}

/// A person agrees. This is where money is booked, and the only place a rule
/// leads to a posting.
///
/// # Why the category path is a different function and not a branch
///
/// A proposal carrying a category is handed to `bank_line_categorise`, which is
/// the door a person choosing a category by hand goes through. That is what
/// makes a rule unable to do anything a person could not: the direction check,
/// the refusal for a category that belongs to somebody else's document, the
/// party and reference a category insists on — all of them apply, because they
/// are on the other side of one door rather than duplicated behind two.
///
/// A rule for the monthly payroll transfer is the case worth naming. Somebody
/// will write one, because a line that keeps showing as unrecognised is
/// annoying. It proposes `payroll_salary_operations`, a person presses Accept,
/// and the refusal says the salary was recognised when the run was sealed and
/// they should find the payment. Without this, the same press would book the
/// expense a second time.
pub async fn bank_proposal_accept(
    pool: &PgPool,
    proposal_id: Uuid,
    actor: &str,
) -> Result<CashDocumentRow, AppError> {
    let opening = sqlx::query(
        "SELECT p.line_id, p.status, p.category_code, p.reason, r.pattern, r.party
           FROM bank_rule_proposal p
           JOIN bank_rule r USING (rule_id)
          WHERE p.proposal_id = $1",
    )
    .bind(proposal_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("proposal".into()))?;
    let status: String = opening.try_get("status")?;
    if status != "PROPOSED" {
        return Err(AppError::Conflict(format!(
            "this proposal is already {}",
            status.to_lowercase()
        )));
    }
    if let Some(category_code) = opening.try_get::<Option<String>, _>("category_code")? {
        let line_id: Uuid = opening.try_get("line_id")?;
        let pattern: String = opening.try_get("pattern")?;
        let party: Option<String> = opening.try_get("party")?;
        let reason: Option<String> = opening.try_get("reason")?;
        return bank_line_categorise(
            pool,
            line_id,
            &CategoriseBankLineRequest {
                category_code,
                // The category's own qualifier. A rule cannot answer "which
                // bank" for a line it has never seen, so a rule proposing a
                // category that asks is a rule whose proposals refuse — which
                // is visible on the rule as `category_refuses` is.
                qualifier: None,
                party_name: party,
                reference: None,
                memo: reason.unwrap_or_else(|| format!("recognised by the rule for {pattern}")),
                // Marking the proposal accepted happens inside, in the same
                // transaction as the document. Two calls would leave a document
                // posted and a proposal still open if the second one failed.
                proposal_id: Some(proposal_id),
            },
            actor,
        )
        .await;
    }

    // ── the fallback: a rule that names a meaning directly ──────────────
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT p.line_id, p.status, p.semantic_key, p.qualifier, p.site_id, p.reason,
                r.pattern, r.party, l.description
           FROM bank_rule_proposal p
           JOIN bank_rule r USING (rule_id)
           JOIN bank_statement_line l ON l.line_id = p.line_id
          WHERE p.proposal_id = $1
          FOR UPDATE OF p",
    )
    .bind(proposal_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("proposal".into()))?;

    let status: String = row.try_get("status")?;
    if status != "PROPOSED" {
        return Err(AppError::Conflict(format!(
            "this proposal is already {}",
            status.to_lowercase()
        )));
    }
    let line_id: Uuid = row.try_get("line_id")?;
    // Not null on this path: the schema insists a proposal names a category or
    // a meaning, and the category was None a few lines above.
    let semantic_key: String = row
        .try_get::<Option<String>, _>("semantic_key")?
        .ok_or_else(|| {
            AppError::Conflict(
            "this proposal names neither a category nor a meaning; there is nothing to book it as"
                .into(),
        )
        })?;
    let qualifier: String = row.try_get("qualifier")?;
    let site_id: String = row.try_get("site_id")?;
    let pattern: String = row.try_get("pattern")?;
    let party: Option<String> = row.try_get("party")?;
    let reason: Option<String> = row.try_get("reason")?;

    let memo = reason.unwrap_or_else(|| format!("recognised by the rule for {pattern}"));
    let booked = bank_line_to_document(
        &mut tx,
        line_id,
        &OtherSide::Meaning {
            semantic_key: semantic_key.clone(),
            qualifier,
            site_id,
        },
        party.as_deref().unwrap_or("Bank"),
        &memo,
        &format!("accepted the rule for {pattern}: booked as {semantic_key}"),
        actor,
    )
    .await?;

    sqlx::query(
        "UPDATE bank_rule_proposal
            SET status='ACCEPTED', cash_document_id=$2, decided_by=$3, decided_at=now()
          WHERE proposal_id=$1",
    )
    .bind(proposal_id)
    .bind(booked.document_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    cash_document_read(pool, booked.document_id).await
}

/// A person looked and said no. Nothing is posted, and the line stops being
/// proposed — which is the point: a proposal nobody can dismiss is a list that
/// only grows.
pub async fn bank_proposal_ignore(
    pool: &PgPool,
    proposal_id: Uuid,
    reason: Option<&str>,
    actor: &str,
) -> Result<BankRuleProposalRow, AppError> {
    let done = sqlx::query(
        "UPDATE bank_rule_proposal
            SET status='IGNORED', decided_by=$3, decided_at=now(),
                reason=COALESCE($2, reason)
          WHERE proposal_id=$1 AND status='PROPOSED'",
    )
    .bind(proposal_id)
    .bind(reason.map(str::trim).filter(|value| !value.is_empty()))
    .bind(actor)
    .execute(pool)
    .await?
    .rows_affected();
    if done == 0 {
        // Either it does not exist or somebody has already decided it. Read it
        // back to say which, rather than guessing in the message.
        let existing = read_proposal(pool, proposal_id).await?;
        return Err(AppError::Conflict(format!(
            "this proposal is already {}",
            existing.status.to_lowercase()
        )));
    }
    read_proposal(pool, proposal_id).await
}
