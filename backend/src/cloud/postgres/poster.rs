//! The only place a journal entry is written.
//!
//! Every other module posts through here, inside its own transaction, so that a
//! supplier bill and the journal that records it either both exist or neither
//! does. A second writer would be a second set of rules about what a valid entry
//! is, and the two would agree until the day they did not.
//!
//! # Why a caller's transaction, not our own
//!
//! `post` takes a `&mut Transaction` it did not open. That is deliberate: the
//! module recording a bill has to write its own row, post the journal, and — in
//! time — emit a sync command, in one commit. A poster that owned its
//! transaction would make that composition impossible, and the workaround
//! everybody reaches for is a second writer.
//!
//! # Why lines name meanings and not accounts
//!
//! A caller says `inventory` and `trade_payable`; `account_map` turns those into
//! the client's codes for that location. A caller that could name a code would
//! be a caller that has to be recompiled when Finance moves an account, and one
//! that silently posts somewhere wrong when they move it quietly.
//!
//! An unmapped meaning is refused, and the refusal names the key. It is never
//! defaulted: an invented account is a mistake that balances, which is the kind
//! that survives a year.

use super::ledger::resolve_account;
use crate::cloud::application::AppError;
use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

/// Which account a line means, and how it is allowed to say so.
///
/// Two ways, because there are genuinely two kinds of caller. A posting RULE
/// names a meaning and must never name a code — that is the whole point of
/// `account_map`. A PERSON writing a manual journal entry names the account
/// itself, because choosing it is the entry they came to make.
///
/// Modelled as a choice rather than as an optional code beside an optional key,
/// so a line cannot be built that says both or neither.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LineAccount {
    /// Resolved through `account_map` for this line's location.
    Meaning {
        semantic_key: String,
        /// Which bank, which card scheme. Empty when the meaning needs no
        /// narrowing.
        #[serde(default)]
        qualifier: String,
    },
    /// A client account code, chosen deliberately by a person.
    Account { account_code: String },
}

/// One side of one posting.
#[derive(Clone, Debug, Deserialize)]
pub struct PostingLine {
    pub account: LineAccount,
    pub site_id: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub supplier_id: Option<String>,
    pub memo: Option<String>,
}

impl PostingLine {
    pub fn debit(semantic_key: &str, site_id: &str, amount_minor: i64) -> Self {
        Self {
            account: LineAccount::Meaning {
                semantic_key: semantic_key.to_string(),
                qualifier: String::new(),
            },
            site_id: site_id.to_string(),
            debit_minor: amount_minor,
            credit_minor: 0,
            supplier_id: None,
            memo: None,
        }
    }

    pub fn credit(semantic_key: &str, site_id: &str, amount_minor: i64) -> Self {
        Self {
            account: LineAccount::Meaning {
                semantic_key: semantic_key.to_string(),
                qualifier: String::new(),
            },
            site_id: site_id.to_string(),
            debit_minor: 0,
            credit_minor: amount_minor,
            supplier_id: None,
            memo: None,
        }
    }

    pub fn with_qualifier(mut self, qualifier: &str) -> Self {
        if let LineAccount::Meaning {
            qualifier: slot, ..
        } = &mut self.account
        {
            *slot = qualifier.to_string();
        }
        self
    }

    pub fn for_supplier(mut self, supplier_id: &str) -> Self {
        self.supplier_id = Some(supplier_id.to_string());
        self
    }
}

/// What a posting rule decided, before any account has been resolved.
#[derive(Clone, Debug)]
pub struct PostingIntent {
    pub posting_date: NaiveDate,
    /// One of the `source_kind` values the schema allows.
    pub source_kind: String,
    pub source_id: Option<String>,
    /// Which rule built these lines, and which version of it. When a rule is
    /// corrected this is what identifies the entries the old one produced.
    pub rule_version: String,
    pub currency: String,
    pub memo: Option<String>,
    pub lines: Vec<PostingLine>,
}

pub struct Posted {
    pub entry_id: Uuid,
    pub entry_number: String,
    pub total_minor: i64,
}

/// Check what the database will check anyway, so the message is a good one.
///
/// The deferred constraint trigger is the guarantee; this is the explanation.
/// A caller that hears "debits 5,000, credits 4,800 — the difference is 200"
/// at the point of building the entry can fix it, where the same failure
/// arriving at COMMIT names a transaction and not a rule.
fn check_balanced(intent: &PostingIntent) -> Result<i64, AppError> {
    if intent.lines.is_empty() {
        return Err(AppError::Validation(
            "a journal entry needs at least one line".into(),
        ));
    }
    let mut debits: i64 = 0;
    let mut credits: i64 = 0;
    for (index, line) in intent.lines.iter().enumerate() {
        if line.debit_minor < 0 || line.credit_minor < 0 {
            return Err(AppError::Validation(format!(
                "line {} has a negative amount; post the other side instead",
                index + 1
            )));
        }
        if (line.debit_minor == 0) == (line.credit_minor == 0) {
            return Err(AppError::Validation(format!(
                "line {} must be either a debit or a credit, and not zero",
                index + 1
            )));
        }
        debits = debits
            .checked_add(line.debit_minor)
            .ok_or_else(|| AppError::Validation("entry total overflows".into()))?;
        credits = credits
            .checked_add(line.credit_minor)
            .ok_or_else(|| AppError::Validation("entry total overflows".into()))?;
    }
    if debits != credits {
        return Err(AppError::Validation(format!(
            "entry does not balance: debits {debits}, credits {credits}, difference {}",
            (debits - credits).abs()
        )));
    }
    Ok(debits)
}

/// Write one entry. The single door.
pub async fn post(
    tx: &mut Transaction<'_, Postgres>,
    intent: &PostingIntent,
    actor: &str,
) -> Result<Posted, AppError> {
    let total = check_balanced(intent)?;

    // Resolved before anything is written, so an unmapped meaning fails without
    // leaving half an entry behind for the rollback to tidy up.
    let mut resolved = Vec::with_capacity(intent.lines.len());
    for line in &intent.lines {
        let code = match &line.account {
            LineAccount::Meaning {
                semantic_key,
                qualifier,
            } => resolve_account(&mut **tx, semantic_key, &line.site_id, qualifier).await?,
            LineAccount::Account { account_code } => account_code.trim().to_string(),
        };
        resolved.push(code);
    }

    let entry_id = Uuid::new_v4();
    let number: i64 = sqlx::query("SELECT nextval('journal_entry_number_seq') AS n")
        .fetch_one(&mut **tx)
        .await?
        .try_get("n")?;
    let entry_number = format!("JV-{number:08}");

    sqlx::query(
        "INSERT INTO journal_entry
           (entry_id, entry_number, posting_date, source_kind, source_id,
            rule_version, total_minor, currency, memo, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(entry_id)
    .bind(&entry_number)
    .bind(intent.posting_date)
    .bind(&intent.source_kind)
    .bind(intent.source_id.as_deref())
    .bind(&intent.rule_version)
    .bind(total)
    .bind(&intent.currency)
    .bind(intent.memo.as_deref())
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    for (index, (line, account_code)) in intent.lines.iter().zip(&resolved).enumerate() {
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, site_id,
                debit_minor, credit_minor, supplier_id, memo)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(Uuid::new_v4())
        .bind(entry_id)
        .bind(index as i32 + 1)
        .bind(account_code)
        .bind(&line.site_id)
        .bind(line.debit_minor)
        .bind(line.credit_minor)
        .bind(line.supplier_id.as_deref())
        .bind(line.memo.as_deref())
        .execute(&mut **tx)
        .await?;
    }

    Ok(Posted {
        entry_id,
        entry_number,
        total_minor: total,
    })
}

/// Undo an entry by writing its mirror.
///
/// The reversal copies the ORIGINAL lines' account codes rather than resolving
/// their meanings again. If the map has moved since — a bank changed, a location
/// was remapped — resolving afresh would post the reversal somewhere the
/// original never touched, and both accounts would be wrong by the same amount
/// while the trial balance still balanced.
pub async fn reverse(
    tx: &mut Transaction<'_, Postgres>,
    entry_id: Uuid,
    posting_date: NaiveDate,
    reason: &str,
    actor: &str,
) -> Result<Posted, AppError> {
    let header = sqlx::query(
        "SELECT entry_number, currency, total_minor FROM journal_entry WHERE entry_id = $1",
    )
    .bind(entry_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("journal entry".into()))?;
    let original_number: String = header.try_get("entry_number")?;
    let currency: String = header.try_get("currency")?;
    let total: i64 = header.try_get("total_minor")?;

    // `reversal_of` is UNIQUE, so a second attempt is refused by the database
    // rather than by a check somebody could forget to write.
    let lines = sqlx::query(
        "SELECT line_number, account_code, site_id, debit_minor, credit_minor, supplier_id, memo
           FROM journal_line WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(entry_id)
    .fetch_all(&mut **tx)
    .await?;

    let reversal_id = Uuid::new_v4();
    let number: i64 = sqlx::query("SELECT nextval('journal_entry_number_seq') AS n")
        .fetch_one(&mut **tx)
        .await?
        .try_get("n")?;
    let entry_number = format!("JV-{number:08}");

    sqlx::query(
        "INSERT INTO journal_entry
           (entry_id, entry_number, posting_date, source_kind, source_id,
            rule_version, total_minor, currency, memo, reversal_of, posted_by)
         VALUES ($1,$2,$3,'REVERSAL',NULL,'reversal/1',$4,$5,$6,$7,$8)",
    )
    .bind(reversal_id)
    .bind(&entry_number)
    .bind(posting_date)
    .bind(total)
    .bind(&currency)
    .bind(format!("reverses {original_number}: {reason}"))
    .bind(entry_id)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    for row in &lines {
        let debit: i64 = row.try_get("debit_minor")?;
        let credit: i64 = row.try_get("credit_minor")?;
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, site_id,
                debit_minor, credit_minor, supplier_id, memo)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(Uuid::new_v4())
        .bind(reversal_id)
        .bind(row.try_get::<i32, _>("line_number")?)
        .bind(row.try_get::<String, _>("account_code")?)
        .bind(row.try_get::<String, _>("site_id")?)
        // The mirror: what was debited is credited.
        .bind(credit)
        .bind(debit)
        .bind(row.try_get::<Option<String>, _>("supplier_id")?)
        .bind(row.try_get::<Option<String>, _>("memo")?)
        .execute(&mut **tx)
        .await?;
    }

    Ok(Posted {
        entry_id: reversal_id,
        entry_number,
        total_minor: total,
    })
}
