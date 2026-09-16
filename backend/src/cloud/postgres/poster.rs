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
//!
//! # Two things this door does that its callers do not have to
//!
//! **It balances every unit.** A rule may build the entry it means — head
//! office's bank paying a shop's electricity — and this module adds the
//! affiliate legs that leave both sets of books balanced on their own, from
//! `domain::interunit`. See that module for why. A rule cannot forget to, and a
//! rule that wanted to opt out could not: migration 0120's deferred trigger
//! refuses an entry with a unit out of balance whoever wrote it.
//!
//! **It refuses a document posted twice.** `(source_kind, source_id, purpose)`
//! is unique from migration 0140. Every posting rule already guards itself with
//! a status check, and every one of those guards is read-decide-write, which
//! two requests can both pass. The index cannot be both passed.

use super::ledger::{
    assert_postable, resolve_account, validate_account_posting, Intent, PostingFacts,
};
use crate::cloud::application::AppError;
use crate::cloud::domain::{balancing_legs, first_unbalanced_site, kind_for_source, SiteMovement};
use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

/// The unit whose books carry every inter-unit receivable.
///
/// A constant and not configuration: it is the same `dc` that migration 0122
/// maps the affiliate accounts against and that `import-coa.py` files the
/// client's `00` suffix under, and a second place to say it is a second place
/// for it to be said differently. The kernel still takes it as an argument —
/// that is what keeps the kernel testable without a database.
pub const HEAD_OFFICE_SITE: &str = "dc";

/// The step a document posts for when it has only one, which is nearly always.
pub const MAIN: &str = "MAIN";

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
    /// The unit on the other side, on an inter-unit line and nowhere else.
    ///
    /// A rule never sets this. It is written by the balancer below onto the
    /// affiliate legs it adds, so a shop's ledger can say who a balance is with
    /// instead of leaving somebody to decode a twelve-digit account code.
    #[serde(default)]
    pub counter_site_id: Option<String>,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub supplier_id: Option<String>,
    /// Which asset this line is about, when it is about one.
    ///
    /// The second sub-ledger dimension, and it is set the same way the first
    /// is: by the rule that KNOWS. Depreciation, disposal, transfer and an
    /// acquisition all name one asset; a reserve charge names a class of
    /// equipment and no asset at all, and leaves this alone. Nothing infers it
    /// from the account code afterwards — a class holds many assets, so the
    /// inference would be wrong the first time a shop owned two racks.
    #[serde(default)]
    pub asset_id: Option<Uuid>,
    /// Which of our real bank accounts this line moved.
    ///
    /// The third typed sub-ledger reference, set the same way the other two are:
    /// by the rule that KNOWS. The reconciliation booking knows, because the line
    /// it is settling came from a statement of one account. Nothing else needs
    /// to: where the ledger binding has exactly one active account the validator
    /// fills it in, and where it has two it refuses rather than guess.
    #[serde(default)]
    pub bank_account_id: Option<Uuid>,
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
            counter_site_id: None,
            debit_minor: amount_minor,
            credit_minor: 0,
            supplier_id: None,
            asset_id: None,
            bank_account_id: None,
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
            counter_site_id: None,
            debit_minor: 0,
            credit_minor: amount_minor,
            supplier_id: None,
            asset_id: None,
            bank_account_id: None,
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

    /// Say which asset this line is about.
    ///
    /// The counterpart of `for_supplier`, and it earns its place for the same
    /// reason: without it "what has this machine cost us" is a question only
    /// `asset_depreciation_entry` can answer, and that table knows nothing
    /// about the disposal, the transfer or the acquisition.
    pub fn for_asset(mut self, asset_id: Uuid) -> Self {
        self.asset_id = Some(asset_id);
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
fn check_balanced(lines: &[PostingLine]) -> Result<i64, AppError> {
    if lines.is_empty() {
        return Err(AppError::Validation(
            "a journal entry needs at least one line".into(),
        ));
    }
    let mut debits: i64 = 0;
    let mut credits: i64 = 0;
    for (index, line) in lines.iter().enumerate() {
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

/// The entry's lines, plus whatever it takes to leave every unit at zero.
///
/// Runs on every posting, and on the overwhelming majority it does nothing: an
/// entry at one location has one unit, already balanced, and comes back with
/// the lines it arrived with.
///
/// The order matters and it is this way round deliberately. The kernel is only
/// correct on an entry that balances in TOTAL — otherwise it would quietly push
/// the whole difference onto head office and turn a caller's arithmetic mistake
/// into a plausible-looking inter-unit balance — so the total is checked first
/// and the legs are added second. The legs are then validated exactly like the
/// rule's own lines: they resolve through `account_map` and they must name a
/// postable account, which is why this happens before resolution and not after.
fn balanced_per_site(intent: &PostingIntent) -> Result<(Vec<PostingLine>, i64), AppError> {
    let total = check_balanced(&intent.lines)?;

    let movements: Vec<SiteMovement> = intent
        .lines
        .iter()
        .map(|line| SiteMovement::new(&line.site_id, line.debit_minor, line.credit_minor))
        .collect();
    let kind = kind_for_source(&intent.source_kind);
    let legs = balancing_legs(&movements, kind, HEAD_OFFICE_SITE);
    if legs.is_empty() {
        return Ok((intent.lines.clone(), total));
    }

    let mut lines = intent.lines.clone();
    for leg in legs {
        lines.push(PostingLine {
            account: LineAccount::Meaning {
                semantic_key: leg.semantic_key.to_string(),
                qualifier: leg.qualifier,
            },
            site_id: leg.site_id,
            counter_site_id: Some(leg.counter_site_id),
            debit_minor: leg.debit_minor,
            credit_minor: leg.credit_minor,
            supplier_id: None,
            // An affiliate leg is about a unit, never about a machine.
            asset_id: None,
            bank_account_id: None,
            // The memo says which side of which pair this is, because on a
            // shop's ledger the account name alone reads as "Hutang Affiliasi"
            // and every one of them looks the same.
            memo: Some(format!("{} — {}", kind.as_str(), intent.source_kind)),
        });
    }

    // An assertion and not a question. If a unit is still out after the legs
    // were added, this file has a bug, and the entry would otherwise reach the
    // ledger looking correct — 0120's trigger would catch it at COMMIT and name
    // a transaction rather than a rule.
    let after: Vec<SiteMovement> = lines
        .iter()
        .map(|line| SiteMovement::new(&line.site_id, line.debit_minor, line.credit_minor))
        .collect();
    if let Some((site, out_by)) = first_unbalanced_site(&after) {
        return Err(AppError::Validation(format!(
            "balancing a {} entry left {site} out by {out_by}; this is a fault in the \
             inter-unit rule and not in the entry",
            intent.source_kind
        )));
    }

    let total = check_balanced(&lines)?;
    Ok((lines, total))
}

/// Turn the idempotency index's refusal into a sentence.
///
/// It arrives as SQLSTATE 23505, which `AppError` has no reason to translate in
/// general — a duplicate key is usually a bug — and which would otherwise reach
/// a person as "database operation failed" with a 500 beside it. This one is a
/// 409 and it is the correct answer: the work was already done.
fn as_already_posted(error: sqlx::Error, intent: &PostingIntent, purpose: &str) -> AppError {
    if let sqlx::Error::Database(db) = &error {
        if db.code().as_deref() == Some("23505")
            && db.constraint() == Some("ux_journal_entry_source_purpose")
        {
            let source = intent.source_id.as_deref().unwrap_or("(none)");
            return AppError::Conflict(format!(
                "{} {source} has already been posted for {purpose}; \
                 a document posts once for each step it has",
                intent.source_kind
            ));
        }
    }
    error.into()
}

/// Write one entry. The single door.
///
/// `purpose` names WHICH posting of the document this is, and `None` means
/// [`MAIN`] — the answer for a document that posts once, which is nearly all of
/// them. A document with several moments gives each one a name: a store deposit
/// posts `DEPOSITED` when the shop hands the money over and `CONFIRMED` when
/// the bank says it arrived, and each of those posts exactly once. Migration
/// 0140 makes `(source_kind, source_id, purpose)` unique, so a resent request
/// and two that raced are refused by the database rather than by a status check
/// both callers can pass.
pub async fn post(
    tx: &mut Transaction<'_, Postgres>,
    intent: &PostingIntent,
    purpose: Option<&str>,
    actor: &str,
) -> Result<Posted, AppError> {
    let purpose = purpose
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .unwrap_or(MAIN);
    let (lines, total) = balanced_per_site(intent)?;

    // Resolved before anything is written, so an unmapped meaning fails without
    // leaving half an entry behind for the rollback to tidy up.
    //
    // And checked before anything is written, for the same reason. The
    // composite foreign key on `journal_line` already refuses a heading and an
    // unknown code — but as SQLSTATE 23503, which arrives as "database
    // operation failed" and names neither the line nor the fault. `assert_postable`
    // says which of the three things is wrong; the constraint still guarantees
    // it. Both variants are checked, not just the code a person typed: a
    // mapping made when an account was live keeps resolving after Finance
    // retires it, and `is_active` is not part of the foreign key.
    let mut resolved = Vec::with_capacity(lines.len());
    for (index, line) in lines.iter().enumerate() {
        let code = match &line.account {
            LineAccount::Meaning {
                semantic_key,
                qualifier,
            } => resolve_account(&mut **tx, semantic_key, &line.site_id, qualifier).await?,
            LineAccount::Account { account_code } => account_code.trim().to_string(),
        };
        assert_postable(&mut **tx, &code, Intent::Post)
            .await
            .map_err(|error| match error {
                // The line number matters here in a way it does not on the
                // Account Map: an entry has several, and "which one" is the
                // first thing somebody has to work out before they can fix it.
                AppError::Validation(message) => {
                    AppError::Validation(format!("line {}: {message}", index + 1))
                }
                other => other,
            })?;
        // And then what the account's own policy says. `assert_postable` asks
        // whether anything may be posted here at all; this asks whether THIS
        // may — by this kind of document, at this unit, naming this other side.
        //
        // Here rather than in the twenty-four callers because this function is
        // the only writer of `journal_entry` and `journal_line` in the estate,
        // which makes it the only place a check cannot be gone round.
        let bank_account_id = validate_account_posting(
            &mut **tx,
            &code,
            PostingFacts {
                source_kind: &intent.source_kind,
                site_id: &line.site_id,
                counter_site_id: line.counter_site_id.as_deref(),
                bank_account_id: line.bank_account_id,
            },
        )
        .await
        .map_err(|error| match error {
            AppError::Validation(message) => {
                AppError::Validation(format!("line {}: {message}", index + 1))
            }
            other => other,
        })?;
        // The validator hands back which of our real bank accounts this line
        // moved: the one the line named, or the only active one the ledger
        // binding has. `None` where the chart knows of none, which is every line
        // in the estate until the client's accounts are registered.
        resolved.push((code, bank_account_id));
    }

    let entry_id = Uuid::new_v4();
    let number: i64 = sqlx::query("SELECT nextval('journal_entry_number_seq') AS n")
        .fetch_one(&mut **tx)
        .await?
        .try_get("n")?;
    let entry_number = format!("JV-{number:08}");

    sqlx::query(
        "INSERT INTO journal_entry
           (entry_id, entry_number, posting_date, source_kind, source_id, purpose,
            rule_version, total_minor, currency, memo, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(entry_id)
    .bind(&entry_number)
    .bind(intent.posting_date)
    .bind(&intent.source_kind)
    .bind(intent.source_id.as_deref())
    .bind(purpose)
    .bind(&intent.rule_version)
    .bind(total)
    .bind(&intent.currency)
    .bind(intent.memo.as_deref())
    .bind(actor)
    .execute(&mut **tx)
    .await
    .map_err(|error| as_already_posted(error, intent, purpose))?;

    for (index, (line, (account_code, bank_account_id))) in
        lines.iter().zip(&resolved).enumerate()
    {
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, site_id, counter_site_id,
                debit_minor, credit_minor, supplier_id, asset_id, memo, bank_account_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        )
        .bind(Uuid::new_v4())
        .bind(entry_id)
        .bind(index as i32 + 1)
        .bind(account_code)
        .bind(&line.site_id)
        .bind(line.counter_site_id.as_deref())
        .bind(line.debit_minor)
        .bind(line.credit_minor)
        .bind(line.supplier_id.as_deref())
        .bind(line.asset_id)
        .bind(line.memo.as_deref())
        .bind(*bank_account_id)
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
///
/// The affiliate legs are copied with everything else, `counter_site_id` and
/// all, and are not recomputed. Two reasons, and either would be enough. The
/// stored lines already balance every unit, so mirroring them balances every
/// unit again — running the balancer over them would find nothing to do, which
/// is what `domain::interunit`'s idempotence test asserts. And a reversal has
/// to undo what was posted rather than what the rule would post today: if the
/// balance was booked as BARANG and the kinds have since been re-cut, resolving
/// afresh would credit one column and debit another, leaving both wrong and the
/// pair looking settled.
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
        "SELECT line_number, account_code, site_id, counter_site_id,
                debit_minor, credit_minor, supplier_id, asset_id, memo, bank_account_id
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
               (line_id, entry_id, line_number, account_code, site_id, counter_site_id,
                debit_minor, credit_minor, supplier_id, asset_id, memo, bank_account_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        )
        .bind(Uuid::new_v4())
        .bind(reversal_id)
        .bind(row.try_get::<i32, _>("line_number")?)
        .bind(row.try_get::<String, _>("account_code")?)
        .bind(row.try_get::<String, _>("site_id")?)
        // Carried, not recomputed: the reversal of an inter-unit leg is with
        // the same unit the original was with.
        .bind(row.try_get::<Option<String>, _>("counter_site_id")?)
        // The mirror: what was debited is credited.
        .bind(credit)
        .bind(debit)
        .bind(row.try_get::<Option<String>, _>("supplier_id")?)
        // Copied, like the account code and for the same reason: a reversal is
        // about whatever the original was about. An undone disposal that lost
        // its asset would leave the asset's own ledger showing the cost going
        // out and never coming back.
        .bind(row.try_get::<Option<Uuid>, _>("asset_id")?)
        .bind(row.try_get::<Option<String>, _>("memo")?)
        // Carried, not re-resolved: a reversal moves the same real account the
        // original moved, even if that account has since been closed or a second
        // one opened beside it.
        .bind(row.try_get::<Option<Uuid>, _>("bank_account_id")?)
        .execute(&mut **tx)
        .await?;
    }

    Ok(Posted {
        entry_id: reversal_id,
        entry_number,
        total_minor: total,
    })
}
