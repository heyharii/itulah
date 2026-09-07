//! Bank statements, and agreeing them with the ledger.
//!
//! The scoring is `domain::bank_match` and is pure. This module supplies the
//! two sides — the bank's lines and our journal lines on the same account —
//! and records what was agreed.
//!
//! # Reconciling posts nothing
//!
//! A match says "we booked this and the bank has now confirmed it". It writes
//! no journal, because there is nothing new to record. The interesting rows are
//! the ones that do NOT match: either the money is in transit, or we have not
//! booked something the bank has. Turning an unmatched bank line into a journal
//! is a separate, deliberate act — conflating it with matching would make
//! "reconcile" a button that quietly invents entries.
//!
//! # A re-import is a no-op
//!
//! Somebody re-uploads the same statement; a month overlaps the month before.
//! Each line carries a deterministic fingerprint over the fields the bank
//! actually gave us, unique per account, so the second import inserts nothing
//! rather than doubling every figure on the screen.

use super::ledger::{assert_postable, Intent};
use super::poster::{post, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use crate::cloud::domain::{resolve, suggest, BankLine, Candidate, Ruleset, Suggestion};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankStatementRow {
    pub statement_id: Uuid,
    pub account_code: String,
    pub account_name: String,
    pub site_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub opening_minor: i64,
    pub closing_minor: i64,
    pub imported_by: String,
    pub imported_at: DateTime<Utc>,
    pub line_count: i64,
    pub matched_count: i64,
}

/// One line the bank reported, with whatever we have agreed about it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BankStatementLineRow {
    pub line_id: Uuid,
    pub line_number: i32,
    pub value_date: NaiveDate,
    pub description: String,
    pub reference: Option<String>,
    pub debit_minor: i64,
    pub credit_minor: i64,
    /// Set once a person or the matcher has agreed which journal line this is.
    pub matched_journal_line_id: Option<Uuid>,
    pub matched_entry_number: Option<String>,
    pub match_reasons: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ImportStatementLine {
    pub value_date: NaiveDate,
    pub description: String,
    pub reference: Option<String>,
    #[serde(default)]
    pub debit_minor: i64,
    #[serde(default)]
    pub credit_minor: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ImportStatementRequest {
    pub account_code: String,
    pub site_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub opening_minor: i64,
    pub closing_minor: i64,
    pub source_name: Option<String>,
    pub lines: Vec<ImportStatementLine>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ImportOutcome {
    pub statement_id: Uuid,
    pub inserted: i64,
    /// Lines already present under this account, by fingerprint. Reported
    /// rather than silently dropped: a re-import that says "0 new" is the
    /// system confirming it did the right thing.
    pub duplicates: i64,
}

/// A deterministic fingerprint over what the bank actually gave us.
///
/// Normalised so that whitespace and case in a narration do not create a second
/// copy of the same line, and length-prefixed so that two fields cannot be
/// slid into one another — "AB" + "C" must not collide with "A" + "BC".
fn fingerprint(
    account_code: &str,
    value_date: NaiveDate,
    debit: i64,
    credit: i64,
    reference: &str,
    description: &str,
) -> String {
    let normalise = |text: &str| -> String {
        text.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_uppercase()
    };
    let mut hasher = Sha256::new();
    for field in [
        account_code.as_bytes(),
        value_date.to_string().as_bytes(),
        debit.to_string().as_bytes(),
        credit.to_string().as_bytes(),
        normalise(reference).as_bytes(),
        normalise(description).as_bytes(),
    ] {
        hasher.update((field.len() as u64).to_be_bytes());
        hasher.update(field);
    }
    hex::encode(hasher.finalize())
}

pub async fn import_statement(
    pool: &PgPool,
    request: &ImportStatementRequest,
    actor: &str,
) -> Result<ImportOutcome, AppError> {
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "a statement with no lines says nothing".into(),
        ));
    }
    let account = request.account_code.trim();
    let statement_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO bank_statement
           (statement_id, account_code, site_id, period_start, period_end,
            opening_minor, closing_minor, source_name, imported_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(statement_id)
    .bind(account)
    .bind(&request.site_id)
    .bind(request.period_start)
    .bind(request.period_end)
    .bind(request.opening_minor)
    .bind(request.closing_minor)
    .bind(request.source_name.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    let mut inserted = 0i64;
    let mut duplicates = 0i64;
    for (index, line) in request.lines.iter().enumerate() {
        if (line.debit_minor == 0) == (line.credit_minor == 0) {
            return Err(AppError::Validation(format!(
                "line {} must be either a debit or a credit, and not zero",
                index + 1
            )));
        }
        let print = fingerprint(
            account,
            line.value_date,
            line.debit_minor,
            line.credit_minor,
            line.reference.as_deref().unwrap_or(""),
            &line.description,
        );
        // ON CONFLICT on the per-account fingerprint index: the second import of
        // a line is a no-op, not an error, because re-uploading a statement is
        // an ordinary thing to do and should not need explaining.
        let done = sqlx::query(
            "INSERT INTO bank_statement_line
               (line_id, statement_id, line_number, value_date, description, reference,
                debit_minor, credit_minor, fingerprint, account_code)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (account_code, fingerprint) DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(statement_id)
        .bind(index as i32 + 1)
        .bind(line.value_date)
        .bind(&line.description)
        .bind(line.reference.as_deref())
        .bind(line.debit_minor)
        .bind(line.credit_minor)
        .bind(&print)
        .bind(account)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if done == 1 {
            inserted += 1;
        } else {
            duplicates += 1;
        }
    }
    tx.commit().await?;

    Ok(ImportOutcome {
        statement_id,
        inserted,
        duplicates,
    })
}

pub async fn list_statements(pool: &PgPool) -> Result<Vec<BankStatementRow>, AppError> {
    let rows = sqlx::query(
        "SELECT s.statement_id, s.account_code, a.name AS account_name, s.site_id,
                s.period_start, s.period_end, s.opening_minor, s.closing_minor,
                s.imported_by, s.imported_at,
                (SELECT COUNT(*) FROM bank_statement_line l
                  WHERE l.statement_id = s.statement_id)::bigint AS line_count,
                (SELECT COUNT(*) FROM bank_statement_line l
                   JOIN bank_line_match m ON m.line_id = l.line_id
                  WHERE l.statement_id = s.statement_id)::bigint AS matched_count
           FROM bank_statement s JOIN ledger_account a ON a.account_code = s.account_code
          ORDER BY s.period_start DESC, s.imported_at DESC",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(BankStatementRow {
                statement_id: row.try_get("statement_id")?,
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                site_id: row.try_get("site_id")?,
                period_start: row.try_get("period_start")?,
                period_end: row.try_get("period_end")?,
                opening_minor: row.try_get("opening_minor")?,
                closing_minor: row.try_get("closing_minor")?,
                imported_by: row.try_get("imported_by")?,
                imported_at: row.try_get("imported_at")?,
                line_count: row.try_get("line_count")?,
                matched_count: row.try_get("matched_count")?,
            })
        })
        .collect()
}

pub async fn statement_lines(
    pool: &PgPool,
    statement_id: Uuid,
) -> Result<Vec<BankStatementLineRow>, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, l.line_number, l.value_date, l.description, l.reference,
                l.debit_minor, l.credit_minor,
                m.journal_line_id, m.reasons,
                (SELECT e.entry_number FROM journal_line jl
                   JOIN journal_entry e USING (entry_id)
                  WHERE jl.line_id = m.journal_line_id) AS entry_number
           FROM bank_statement_line l
           LEFT JOIN bank_line_match m ON m.line_id = l.line_id
          WHERE l.statement_id = $1
          ORDER BY l.line_number",
    )
    .bind(statement_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(BankStatementLineRow {
                line_id: row.try_get("line_id")?,
                line_number: row.try_get("line_number")?,
                value_date: row.try_get("value_date")?,
                description: row.try_get("description")?,
                reference: row.try_get("reference")?,
                debit_minor: row.try_get("debit_minor")?,
                credit_minor: row.try_get("credit_minor")?,
                matched_journal_line_id: row.try_get("journal_line_id")?,
                matched_entry_number: row.try_get("entry_number")?,
                match_reasons: row
                    .try_get::<Option<Vec<String>>, _>("reasons")?
                    .unwrap_or_default(),
            })
        })
        .collect()
}

/// What the ledger has on this account near this date that nothing has claimed.
///
/// Deliberately our own journal, not other statement lines. Reconciliation is
/// the question "do the bank and the books agree", and it can only be answered
/// against the books.
async fn candidates_for(
    pool: &PgPool,
    account_code: &str,
    from: NaiveDate,
    to: NaiveDate,
    slack_days: i64,
) -> Result<Vec<Candidate>, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, e.posting_date, l.debit_minor, l.credit_minor,
                e.entry_number, COALESCE(l.memo, e.memo, '') AS memo
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE l.account_code = $1
            AND e.posting_date BETWEEN ($2::date - $4::int) AND ($3::date + $4::int)
            AND NOT EXISTS (SELECT 1 FROM bank_line_match m WHERE m.journal_line_id = l.line_id)",
    )
    .bind(account_code)
    .bind(from)
    .bind(to)
    .bind(slack_days as i32)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let line_id: Uuid = row.try_get("line_id")?;
            let date: NaiveDate = row.try_get("posting_date")?;
            let debit: i64 = row.try_get("debit_minor")?;
            let credit: i64 = row.try_get("credit_minor")?;
            Ok(Candidate {
                journal_line_id: line_id.to_string(),
                day: i64::from(date.num_days_from_ce()),
                // A credit on our bank account is money leaving it, which the
                // bank reports as a debit on its own statement. The matcher
                // compares magnitudes and directions, so the translation
                // happens exactly here and nowhere else.
                amount_minor: debit.max(credit),
                outgoing: credit > 0,
                reference: row.try_get("entry_number")?,
                memo: row.try_get("memo")?,
            })
        })
        .collect()
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LineSuggestions {
    pub line_id: Uuid,
    pub suggestions: Vec<Suggestion>,
}

/// Score every unmatched line of a statement against the ledger, as one plan.
///
/// The candidates are fetched once for the whole statement rather than per
/// line, because the assignment has to be made across all of them together: two
/// lines can each pick the same ledger row as their unique best, and only a plan
/// that sees both can refuse the second. Per-line scoring would offer an
/// "Accept" button that the database then rejects — correct data, and a screen
/// that lied.
pub async fn suggest_matches(
    pool: &PgPool,
    statement_id: Uuid,
) -> Result<Vec<LineSuggestions>, AppError> {
    let row = sqlx::query(
        "SELECT account_code, period_start, period_end FROM bank_statement WHERE statement_id = $1",
    )
    .bind(statement_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("statement".into()))?;
    let account: String = row.try_get("account_code")?;
    let start: NaiveDate = row.try_get("period_start")?;
    let end: NaiveDate = row.try_get("period_end")?;

    let rules = Ruleset::default();
    let lines = statement_lines(pool, statement_id).await?;
    let open: Vec<&BankStatementLineRow> = lines
        .iter()
        .filter(|line| line.matched_journal_line_id.is_none())
        .collect();
    if open.is_empty() {
        return Ok(Vec::new());
    }

    // One window covering the whole statement plus the matcher's date slack, so
    // every line is scored against the same candidate set. Scoring line by line
    // against different sets would make the plan depend on which line was asked
    // about first.
    let candidates = candidates_for(pool, &account, start, end, rules.date_window_days).await?;

    let bank: Vec<BankLine> = open
        .iter()
        .map(|line| BankLine {
            line_id: line.line_id.to_string(),
            day: i64::from(line.value_date.num_days_from_ce()),
            amount_minor: line.debit_minor.max(line.credit_minor),
            // A debit on the bank's statement is money leaving the account.
            outgoing: line.debit_minor > 0,
            reference: line.reference.clone().unwrap_or_default(),
            description: line.description.clone(),
        })
        .collect();

    let plan = resolve(&bank, &candidates, &rules);
    // Which line the plan gave each ledger row to. A row promised to somebody
    // else is not offered here at all — the alternative is a button that cannot
    // work, and a person who has to discover that by clicking it.
    let spoken_for: std::collections::HashMap<&str, &str> = plan
        .iter()
        .map(|a| (a.journal_line_id.as_str(), a.line_id.as_str()))
        .collect();

    Ok(bank
        .iter()
        .map(|line| LineSuggestions {
            line_id: line.line_id.parse().unwrap_or_default(),
            suggestions: suggest(line, &candidates, &rules)
                .into_iter()
                .filter_map(|mut suggestion| {
                    match spoken_for.get(suggestion.journal_line_id.as_str()) {
                        // Planned for a different line: not shown.
                        Some(&owner) if owner != line.line_id => None,
                        // Planned for this one: the plan decides, not the score.
                        Some(_) => {
                            suggestion.auto_match = true;
                            Some(suggestion)
                        }
                        // Nobody's: offer it, but never as an automatic match —
                        // if it were good enough for that the plan would have
                        // taken it.
                        None => {
                            suggestion.auto_match = false;
                            Some(suggestion)
                        }
                    }
                })
                .collect(),
        })
        .collect())
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ConfirmMatchRequest {
    pub journal_line_id: Uuid,
    pub score: Option<i32>,
    #[serde(default)]
    pub reasons: Vec<String>,
    /// True when the matcher chose it unaided. Recorded so that an auto-match a
    /// person later undoes is evidence the threshold is wrong.
    #[serde(default)]
    pub automatic: bool,
}

/// Agree that a bank line and a journal line are the same event.
///
/// Writes no journal. The two unique constraints do the rest: a line already
/// matched, on either side, is refused by the database rather than by a check
/// somebody could forget.
pub async fn confirm_match(
    pool: &PgPool,
    line_id: Uuid,
    request: &ConfirmMatchRequest,
    actor: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO bank_line_match
           (match_id, line_id, journal_line_id, decided_by_kind, score, reasons, matched_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(Uuid::new_v4())
    .bind(line_id)
    .bind(request.journal_line_id)
    .bind(if request.automatic { "AUTO" } else { "MANUAL" })
    .bind(request.score)
    .bind(&request.reasons)
    .bind(actor)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn unmatch(pool: &PgPool, line_id: Uuid) -> Result<(), AppError> {
    sqlx::query("DELETE FROM bank_line_match WHERE line_id = $1")
        .bind(line_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Booking a line nobody booked
// ---------------------------------------------------------------------------
//
// The act 0071 named and left unbuilt. Matching says "we booked this and the
// bank has confirmed it"; this says "the bank did something we never recorded,
// and here is where it goes" — a monthly account charge, interest credited, a
// customer's transfer that arrived without a document.
//
// It is one act and not two. Posting the entry and then agreeing it with the
// line are the same decision, and splitting them leaves a window in which an
// entry exists and nothing points at the line that caused it — which is exactly
// the state a reconciliation is supposed to eliminate. Both writes are in one
// transaction, so the line reads as agreed the moment the entry exists.

/// The meanings a statement can be imported against.
///
/// A statement is normally a bank's, but `bank_statement` is bounded only by
/// the chart, and a treasurer reconciling a cash box against a count sheet is
/// the same exercise. All five are admitted; a mapping to anything else is
/// refused below by simply not being found.
const STATEMENT_MEANINGS: [&str; 5] = [
    "bank_giro",
    "bank_savings",
    "cash",
    "petty_cash",
    "cashier_float",
];

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BookBankLineRequest {
    /// Where the other side of this goes: a bank charge to the bank-charges
    /// account, interest to interest income. A postable, active account, chosen
    /// by the person reading the statement.
    pub account_code: String,
    /// Why this line is that account. Required, and for the same reason a
    /// reversal's reason is: it is the only record of the judgement somebody
    /// made, and a bank line booked with no explanation is the entry an auditor
    /// asks about first.
    pub memo: String,
}

/// Which meaning carries this account here, so the entry posts through the map.
///
/// The statement stores a client account code, not a meaning. Resolving it back
/// to a key is not ceremony: it posts the bank leg through the same door every
/// other rule uses, and it refuses a statement imported against an account
/// nobody mapped — which is a real gap, because such an account has no payment,
/// no sale and no rule that could ever have put a candidate on it to match.
///
/// Two mappings pointing at one account at one location is ambiguous and is
/// refused rather than guessed. It is a genuine mistake on the Account Map —
/// the same account cannot be both the BCA giro and the Mandiri one — and
/// picking either would post correctly today and wrongly the day one of them
/// moves.
async fn statement_meaning(
    executor: impl sqlx::PgExecutor<'_>,
    account_code: &str,
    site_id: &str,
) -> Result<(String, String), AppError> {
    let rows = sqlx::query(
        "SELECT semantic_key, qualifier FROM account_map
          WHERE account_code = $1 AND site_id = $2 AND semantic_key = ANY($3)
          ORDER BY semantic_key, qualifier",
    )
    .bind(account_code)
    .bind(site_id)
    .bind(&STATEMENT_MEANINGS[..])
    .fetch_all(executor)
    .await?;

    match rows.len() {
        0 => Err(AppError::Validation(format!(
            "no money account is mapped to {account_code} at {site_id}; point one of {} at it on \
             the Account Map screen before booking anything against this statement",
            STATEMENT_MEANINGS.join(", ")
        ))),
        1 => Ok((
            rows[0].try_get("semantic_key")?,
            rows[0].try_get("qualifier")?,
        )),
        _ => Err(AppError::Validation(format!(
            "{account_code} at {site_id} is mapped by more than one meaning; one account carries \
             one meaning, so fix the Account Map before booking against it"
        ))),
    }
}

/// What booking one line produced.
pub struct BookedBankLine {
    pub entry_id: Uuid,
    pub entry_number: String,
    pub journal_line_id: Uuid,
    pub total_minor: i64,
}

/// Turn an unmatched statement line into a journal entry, and agree it.
///
/// # The two legs
///
/// One on the statement's own account, resolved through `account_map` from the
/// code the statement carries; one on the account the person chose. The
/// direction follows the bank's line and nothing else: a DEBIT on the bank's
/// statement is money leaving the account, so our books CREDIT the bank and
/// debit the other side. That is the same translation `candidates_for` makes
/// when it scores a journal line against a bank line, and it has to be, or a
/// line booked here would never match a line imported there.
///
/// # Why `BANK_STATEMENT` and not `MANUAL`
///
/// 0095 makes the argument. MANUAL means "a person typed this from nothing";
/// this has the bank's own document behind it, and `source_id` names the line.
pub async fn book_bank_line(
    pool: &PgPool,
    line_id: Uuid,
    request: &BookBankLineRequest,
    actor: &str,
) -> Result<BookedBankLine, AppError> {
    let memo = request.memo.trim();
    if memo.is_empty() {
        return Err(AppError::Validation(
            "booking a bank line needs a note saying what it was; it is the only record of why \
             this account was chosen"
                .into(),
        ));
    }
    let chosen = request.account_code.trim();

    let line = sqlx::query(
        "SELECT l.value_date, l.description, l.debit_minor, l.credit_minor,
                l.account_code, s.site_id,
                EXISTS (SELECT 1 FROM bank_line_match m WHERE m.line_id = l.line_id) AS matched
           FROM bank_statement_line l
           JOIN bank_statement s USING (statement_id)
          WHERE l.line_id = $1",
    )
    .bind(line_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("bank statement line".into()))?;

    // Refused here so the message says what happened. The unique index on
    // `bank_line_match (line_id)` is the guarantee, and it arrives as an opaque
    // 23505 that names neither the line nor the reason.
    if line.try_get::<bool, _>("matched")? {
        return Err(AppError::Conflict(
            "this line is already agreed with a journal line; unmatch it first if the entry \
             behind it is wrong"
                .into(),
        ));
    }

    let bank_account: String = line.try_get("account_code")?;
    let site_id: String = line.try_get("site_id")?;
    let value_date: NaiveDate = line.try_get("value_date")?;
    let description: String = line.try_get("description")?;
    let debit: i64 = line.try_get("debit_minor")?;
    let credit: i64 = line.try_get("credit_minor")?;

    if chosen == bank_account {
        return Err(AppError::Validation(format!(
            "{chosen} is the account this statement is for; the other side of a bank line has to \
             be somewhere else"
        )));
    }
    // Checked before anything is written, so the refusal names the fault rather
    // than arriving from the poster with a line number attached. The composite
    // foreign key on `journal_line` remains the guarantee.
    assert_postable(pool, chosen, Intent::Post).await?;

    let (key, qualifier) = statement_meaning(pool, &bank_account, &site_id).await?;

    // A debit on the bank's statement is money leaving the account.
    let outgoing = debit > 0;
    let amount = debit.max(credit);
    // The bank leg first, deliberately: it is the line the match points at, and
    // line number 1 is how it is found again below without a second guess about
    // which of the two is which.
    let bank_leg = (if outgoing {
        PostingLine::credit(&key, &site_id, amount)
    } else {
        PostingLine::debit(&key, &site_id, amount)
    })
    .with_qualifier(&qualifier);
    let other_leg = PostingLine {
        account: LineAccount::Account {
            account_code: chosen.to_string(),
        },
        site_id: site_id.clone(),
        counter_site_id: None,
        debit_minor: if outgoing { amount } else { 0 },
        credit_minor: if outgoing { 0 } else { amount },
        supplier_id: None,
        memo: Some(memo.to_string()),
    };

    let intent = PostingIntent {
        posting_date: value_date,
        source_kind: "BANK_STATEMENT".into(),
        source_id: Some(line_id.to_string()),
        rule_version: "bank_line/1".into(),
        currency: "IDR".into(),
        // The bank's own narration first, then the person's. Both, because the
        // narration is what a reconciler recognises and the note is what
        // explains the account they picked.
        memo: Some(format!("{description} — {memo}")),
        lines: vec![bank_leg, other_leg],
    };

    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, None, actor).await?;
    let journal_line_id: Uuid =
        sqlx::query("SELECT line_id FROM journal_line WHERE entry_id = $1 AND line_number = 1")
            .bind(posted.entry_id)
            .fetch_one(&mut *tx)
            .await?
            .try_get("line_id")?;

    sqlx::query(
        "INSERT INTO bank_line_match
           (match_id, line_id, journal_line_id, decided_by_kind, score, reasons, matched_by)
         VALUES ($1,$2,$3,'MANUAL',NULL,$4,$5)",
    )
    .bind(Uuid::new_v4())
    .bind(line_id)
    .bind(journal_line_id)
    // MANUAL, because a person decided it. The reason says which of the two
    // manual routes it was: agreed with an entry that already existed, or
    // booked into one that did not.
    .bind(vec![format!("booked as {chosen}: {memo}")])
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(BookedBankLine {
        entry_id: posted.entry_id,
        entry_number: posted.entry_number,
        journal_line_id,
        total_minor: posted.total_minor,
    })
}
