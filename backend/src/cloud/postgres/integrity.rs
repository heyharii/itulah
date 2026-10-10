//! The ten control equations, the registry that holds them, and the run that
//! asks them all.
//!
//! `poster.rs` guarantees that no single journal entry is unbalanced. Nothing
//! guaranteed that the estate reconciles: the Payment Ledger can drift from the
//! control account it is mapped to, a shop can hold funds head office has no
//! record of sending, and every entry in the system can be perfectly balanced
//! while both are true. This module asks the questions that would notice.
//!
//! # Three ledgers, and everything else
//!
//! The architecture is frozen at three ledgers — **General**, **Payment**,
//! **Stock**. Bank, asset, giro, tax, payroll, remittance, fund allocation and
//! sales reconciliation are registers and projections over those three, not
//! ledgers of their own. So the equations below are not "each subledger against
//! its control account". They are ten named statements, and the registry is the
//! list of them:
//!
//!  1. The General Ledger balances, per entry and per unit.
//!  2. Payment Ledger outstanding per control account equals that account's
//!     General Ledger balance.
//!  3. Funds sent by head office equal settled payments plus approved direct
//!     expenses plus returns plus outstanding Piutang Kepala Toko.
//!  4. Open fund allocations equal the Payment Ledger outstanding for Piutang
//!     Kepala Toko, which equals its General Ledger balance.
//!  5. Open acquirer receivables in the Payment Ledger equal the General Ledger
//!     acquirer receivable control balance, per acquirer and unit.
//!  6. Stock quantity equals the position inside the reconciliation boundary.
//!  7. Stock Ledger value equals the General Ledger inventory control account.
//!  8. Reconciled sales proceeds equal executed remittance plus held proceeds.
//!  9. Book bank transactions reconcile to external statements.
//! 10. Inter-unit balances agree bilaterally and net to zero.
//!
//! One and two are foundations rather than findings: see
//! [`crate::cloud::domain::classify_foundation`] for why they answer Blocked
//! where the others answer Exception.
//!
//! # A registry, not a report
//!
//! Every equation is an [`IntegrityCheck`], and [`integrity_registry`] is the
//! built-in ten plus whatever [`register_integrity_check`] was handed at
//! start-up. That second half is the door other lanes use: a lane that owns a
//! ledger writes the equation over its own tables — where the column names are
//! known and the SQL can be tested beside the schema — and registers it. It
//! does not have to be edited into this file, and a registration whose key
//! matches a built-in **replaces** that built-in, so a placeholder that says
//! "waiting on the Stock Ledger" becomes the real check the day the Stock
//! Ledger lane hands one over.
//!
//! Until they land, those equations are in the registry anyway, answering
//! [`CheckState::Pending`] with the table they will read. A missing check is
//! invisible; a check that says "waiting on `store_fund_transfer`" is a gap
//! somebody can see on the screen.
//!
//! # This module writes nothing to the journal
//!
//! It reads the three ledgers and the registers around them, and it writes only
//! its own two tables and its notifications. An engine that could post its own
//! corrections would be a second writer with its own idea of what balances, and
//! the whole point of a check is that it is not the thing being checked.
//! Everything it wants done arrives as a [`SuggestedAction`] for a person.
//!
//! # How a result becomes work
//!
//! A result carries suggested actions, and each action becomes one row in
//! `attention_item`, keyed on (check, scope, target). The same unmatched bank
//! line found on forty-two consecutive nights is one row that is forty-two days
//! old, which is the number that makes a queue readable. A run that no longer
//! raises an item resolves it: the books agree now, and nobody had to say so.
//!
//! One rule is worth naming because other lanes will rely on it. **An action
//! whose `target_kind` is `site` routes its item to that location** — that is
//! how a group-wide check produces work in a shop's own feed, without the check
//! needing an instance per shop. Its twin is for the books: **an action whose
//! `target_kind` is `unit` routes its item to every premises that unit owns**.
//! The books are a unit's (0605) and a feed is a place's, so a store whose books
//! do not balance hears about it in its shop, and head office's in the Gudang's
//! feed as well as its own — with no unit id ever written where a site id
//! belongs.

use super::ledger::{trial_balance, TrialBalanceScope};
use super::period_close::CloseCheck;
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    classify, classify_foundation, classify_in_flight, classify_oldest, minor, ActionVerb,
    Audience, CheckOutcome, CheckPointer, CheckResult, CheckState, ClosePeriod, DetailRow, Details,
    Scope, SuggestedAction, Tolerance,
};
use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, Row};
use std::sync::{OnceLock, RwLock};
use uuid::Uuid;

/// How many offending rows one check will name.
///
/// A check that found nine hundred unmatched lines has said everything useful
/// by the twentieth: the state is Exception, the total is the total, and the
/// remaining eight hundred and eighty are the same sentence again. The summary
/// says how many were held back, so the cap is visible rather than a quiet
/// truncation.
const MAX_ACTIONS: usize = 20;

/// Who is told when a check crosses into trouble.
///
/// The same two roles the finance surface is readable by. A cashier cannot open
/// the trial balance, so telling one that it does not balance would be telling
/// them about a screen they cannot reach.
const NOTIFY_ROLES: &[&str] = &["ADMIN", "SUPERVISOR"];

/// The actor a run writes when it resolves something by finding it fixed.
pub const INTEGRITY_ACTOR: &str = "system:integrity";

// ---------------------------------------------------------------------------
// The trait other lanes implement
// ---------------------------------------------------------------------------

/// One control equation.
///
/// Three methods are yours to write; the other three have defaults that are
/// right for most checks. A new equation is a unit struct, an `impl`, and one
/// call to [`register_integrity_check`] at start-up.
///
/// `evaluate` takes the pool read-only. Posting a correction is never a check's
/// business — say what should be done in [`CheckResult::suggested_actions`] and
/// let a person do it.
#[async_trait]
pub trait IntegrityCheck: Send + Sync {
    /// Stable and dotted: `area.equation`. It is the primary key of this
    /// check's whole history, so renaming one starts its history again — and
    /// registering one that matches a built-in replaces that built-in, which is
    /// how a placeholder is retired.
    fn key(&self) -> &str;

    /// Which books the answer is about. `Group` for a company-wide equation.
    ///
    /// This is the check's declared scope, used when a result does not name one
    /// of its own. A check that answers per location returns `Group` here and
    /// puts the locations in its actions — see the routing rule in the header.
    fn scope(&self) -> Scope;

    /// Ask the question. Errors are for a check that could not run at all;
    /// a check that ran and found something missing returns
    /// [`CheckState::Blocked`], which is a finding rather than a failure.
    async fn evaluate(&self, pool: &PgPool, as_of: NaiveDate) -> Result<CheckResult, AppError>;

    /// The sentence at the top of the card. Defaults to the key, which is
    /// readable but not English.
    fn title(&self) -> &str {
        self.key()
    }

    /// Which group of the feed it belongs under.
    fn area(&self) -> &str {
        "General Ledger"
    }

    /// Who can act on it. Head office unless a shop genuinely can.
    fn audience(&self) -> Audience {
        Audience::Ho
    }
}

/// The ten equations this engine ships with.
///
/// A `const` list rather than something assembled at start-up: the frozen
/// architecture has exactly ten control equations, and a set that could be
/// built differently in two processes would be one where an equation could
/// quietly not run in production.
const BUILT_IN: &[&dyn IntegrityCheck] = &[
    &GeneralLedgerBalances,
    &PaymentLedgerControlAccounts,
    &OperatingFundsSentEqualsUsed,
    &FundAllocationsEqualOutstanding,
    &AcquirerReceivablesControl,
    &StockQuantityPosition,
    &StockValueVersusLedger,
    &ProceedsReconciledEqualsRemitted,
    &BankReconcilesToStatement,
    &InterUnitBilateralAndNetsToZero,
];

/// Equations added by other lanes, in this process.
static REGISTERED: OnceLock<RwLock<Vec<&'static dyn IntegrityCheck>>> = OnceLock::new();

fn registered() -> &'static RwLock<Vec<&'static dyn IntegrityCheck>> {
    REGISTERED.get_or_init(|| RwLock::new(Vec::new()))
}

/// Add an equation this module does not own, or replace one it does.
///
/// **Call it at start-up, before the first run.** A check registered halfway
/// through the night would appear in one run and not the one before it, and the
/// history of a control equation is the thing this engine exists to keep
/// readable.
///
/// A key that matches an existing entry replaces it, and that is the intended
/// use rather than an accident: the Stock Ledger's two equations ship here as
/// placeholders that say what they are waiting for, and the lane that builds
/// the Stock Ledger retires them by registering the real ones under the same
/// keys. Nothing in this file changes.
///
/// Registering the same key twice is a programming error and says so, rather
/// than silently keeping whichever won the race.
pub fn register_integrity_check(check: &'static dyn IntegrityCheck) -> Result<(), AppError> {
    let key = check.key();
    if !key.contains('.') || key.chars().any(char::is_whitespace) {
        return Err(AppError::Configuration(format!(
            "an integrity check's key reads area.equation and carries no spaces; {key:?} does not"
        )));
    }
    let mut extra = registered()
        .write()
        .map_err(|_| AppError::Configuration("the integrity registry is poisoned".into()))?;
    if extra.iter().any(|existing| existing.key() == key) {
        return Err(AppError::Configuration(format!(
            "{key} is registered twice; two checks answering to one name would file their \
             answers under the same key and make each other's history unreadable"
        )));
    }
    extra.push(check);
    Ok(())
}

/// Every equation this system knows how to ask, built-ins first.
///
/// A registered check whose key matches a built-in takes its place; anything
/// else is appended. Lane F's period-close checklist reads this to know what a
/// close is waiting on, and [`integrity_run_now`] evaluates exactly this list.
pub fn integrity_registry() -> Vec<&'static dyn IntegrityCheck> {
    let extra = match registered().read() {
        Ok(guard) => guard.clone(),
        // A poisoned lock means a panic while somebody was registering. The
        // built-ins are still the truth and running them beats running nothing.
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    let mut all: Vec<&'static dyn IntegrityCheck> = BUILT_IN
        .iter()
        .map(|built_in| {
            extra
                .iter()
                .find(|replacement| replacement.key() == built_in.key())
                .copied()
                .unwrap_or(*built_in)
        })
        .collect();
    all.extend(extra.iter().filter(|check| {
        !BUILT_IN
            .iter()
            .any(|built_in| built_in.key() == check.key())
    }));
    all
}

/// The registry as data, so a screen can list what is being checked — including
/// the equations that are only waiting — without running anything.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IntegrityCheckDoc {
    pub key: String,
    pub title: String,
    pub area: String,
    pub scope: Scope,
    pub audience: String,
}

pub fn integrity_catalogue() -> Vec<IntegrityCheckDoc> {
    integrity_registry()
        .iter()
        .map(|check| IntegrityCheckDoc {
            key: check.key().to_string(),
            title: check.title().to_string(),
            area: check.area().to_string(),
            scope: check.scope(),
            audience: check.audience().as_str().to_string(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

/// Whether a table or view another lane owns has landed, and carries the
/// columns this engine would read from it.
///
/// Both halves matter. A relation that exists under the expected name with
/// different columns would make a check fail with a SQL error at three in the
/// morning; asking `information_schema` first turns that into a Pending answer
/// naming what was looked for. An empty `columns` asks only whether the
/// relation is there at all, which is what a placeholder wants to know.
async fn relation_ready(pool: &PgPool, relation: &str, columns: &[&str]) -> Result<bool, AppError> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables
                         WHERE table_schema = 'public' AND table_name = $1)",
    )
    .bind(relation)
    .fetch_one(pool)
    .await?;
    if !exists || columns.is_empty() {
        return Ok(exists);
    }
    let wanted: Vec<String> = columns.iter().map(|name| (*name).to_owned()).collect();
    let present: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2)",
    )
    .bind(relation)
    .bind(&wanted)
    .fetch_one(pool)
    .await?;
    Ok(present as usize == columns.len())
}

/// Whether a function another lane owns has landed.
///
/// The Payment Ledger publishes its integrity query as a function rather than a
/// view, so this is the probe that keeps a run from erroring out on a database
/// where that migration has not been applied yet.
async fn function_ready(pool: &PgPool, name: &str) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
             SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = $1)",
    )
    .bind(name)
    .fetch_one(pool)
    .await?)
}

/// Whole days from a posting date to the date the run is asking about.
fn age_days(as_of: NaiveDate, when: NaiveDate) -> i64 {
    (as_of - when).num_days()
}

/// Cap a list of actions, and say in the summary that it was capped.
fn capped(mut actions: Vec<SuggestedAction>, summary: String) -> (Vec<SuggestedAction>, String) {
    if actions.len() <= MAX_ACTIONS {
        return (actions, summary);
    }
    let held = actions.len() - MAX_ACTIONS;
    actions.truncate(MAX_ACTIONS);
    (
        actions,
        format!("{summary} The {MAX_ACTIONS} oldest are listed; {held} more are not."),
    )
}

/// The sentence a check writes when the ledger it reads has not landed.
///
/// Always names the relation. A run of Pendings that each say what they are
/// waiting for is a roadmap; one that says "not implemented" ten times is a
/// shrug, and nobody can tell from it which lane is late.
fn waiting_on(key: &str, relation: &str, sentence: &str) -> CheckResult {
    CheckResult::awaiting(key, format!("{sentence} Waiting on `{relation}`."))
}

// ---------------------------------------------------------------------------
// (1) The General Ledger against itself
// ---------------------------------------------------------------------------

/// Total debit equals total credit — for the group, for every entry, and in
/// every unit's books.
///
/// The first foundation. A deferred constraint trigger already refuses an
/// unbalanced entry at COMMIT, so the per-entry half should never find
/// anything — and that is exactly why it is worth asking. The trigger guards
/// the front door; a restored backup, a hand-run migration or a superuser with
/// `session_replication_role = replica` all go round it, and this is the only
/// thing that would notice.
///
/// The per-unit half is guarded only per entry (0605's deferred trigger), so
/// it is the one that fires when something went round it. The client keeps a
/// profit and loss per unit, so a unit whose debits and credits disagree is a
/// unit whose statements cannot be produced. It happens when value moves
/// between two units without the inter-unit pair: money left head office and
/// arrived at a store, and nothing recorded that one now owes the other.
struct GeneralLedgerBalances;

#[async_trait]
impl IntegrityCheck for GeneralLedgerBalances {
    fn key(&self) -> &str {
        "gl.debits_equal_credits"
    }

    fn title(&self) -> &str {
        "The General Ledger balances, per entry and per unit"
    }

    fn scope(&self) -> Scope {
        Scope::Group
    }

    /// Both, and the per-unit items route to the unit's shop: a manager whose
    /// books do not balance is the person who will be asked what happened, even
    /// though head office is who posts the correction.
    fn audience(&self) -> Audience {
        Audience::Both
    }

    async fn evaluate(&self, pool: &PgPool, as_of: NaiveDate) -> Result<CheckResult, AppError> {
        // The group figure comes from the same function the Trial Balance
        // screen reads. If that screen says balanced, this must agree with it —
        // a second implementation of one total is how two screens start
        // disagreeing about a month end.
        let group = trial_balance(
            pool,
            TrialBalanceScope {
                as_of: Some(as_of),
                // Only the two totals are read below, and those are over the
                // whole ledger by construction. A default page would fetch two
                // hundred rows for this check to throw away.
                limit: Some(1),
                ..Default::default()
            },
        )
        .await?;

        let unbalanced_entries = sqlx::query(
            "SELECT e.entry_id, e.entry_number,
                    (SUM(l.debit_minor) - SUM(l.credit_minor))::bigint AS difference
               FROM journal_entry e JOIN journal_line l USING (entry_id)
              WHERE e.posting_date <= $1
              GROUP BY e.entry_id, e.entry_number
             HAVING SUM(l.debit_minor) <> SUM(l.credit_minor)
              ORDER BY e.entry_number",
        )
        .bind(as_of)
        .fetch_all(pool)
        .await?;

        let unbalanced_units = sqlx::query(
            "SELECT l.unit_id,
                    COALESCE(SUM(l.debit_minor), 0)::bigint  AS debit,
                    COALESCE(SUM(l.credit_minor), 0)::bigint AS credit
               FROM journal_line l JOIN journal_entry e USING (entry_id)
              WHERE e.posting_date <= $1
              GROUP BY l.unit_id
             HAVING SUM(l.debit_minor) <> SUM(l.credit_minor)
              ORDER BY l.unit_id",
        )
        .bind(as_of)
        .fetch_all(pool)
        .await?;

        if unbalanced_entries.is_empty() && unbalanced_units.is_empty() {
            return Ok(CheckResult::compared(
                self.key(),
                group.total_debit_minor,
                group.total_credit_minor,
                None,
                Tolerance::EXACT,
                Details::say(format!(
                    "As at {as_of} the books hold {} in debits against the same in credits, \
                     every entry balances, and so does every unit's books on their own.",
                    minor(group.total_debit_minor)
                )),
            ));
        }

        // Whether the fix for a unit imbalance is even available. The
        // inter-unit accounts are what a correction would be posted to, and
        // until somebody has mapped them the only honest next act is to go and
        // map them.
        let inter_unit_mapped: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM account_resolution
                             WHERE role IN ('affiliate_receivable', 'affiliate_payable'))",
        )
        .fetch_one(pool)
        .await?;

        let mut detail_rows = Vec::new();
        let mut actions = Vec::new();
        for row in &unbalanced_entries {
            let number: String = row.try_get("entry_number")?;
            let entry_id: Uuid = row.try_get("entry_id")?;
            let difference: i64 = row.try_get("difference")?;
            detail_rows.push(DetailRow::new(format!("entry {number}"), difference, 0));
            actions.push(SuggestedAction::new(
                ActionVerb::Reverse,
                "journal_entry",
                entry_id.to_string(),
                format!(
                    "{number} is out by {}. Nothing that went through the poster can be, so it \
                     arrived some other way — reverse it and post it again.",
                    minor(difference)
                ),
            ));
        }
        for row in &unbalanced_units {
            let unit: String = row.try_get("unit_id")?;
            let debit: i64 = row.try_get("debit")?;
            let credit: i64 = row.try_get("credit")?;
            detail_rows.push(DetailRow::new(format!("unit {unit}"), debit, credit));
            let out_by = minor(debit - credit);
            actions.push(SuggestedAction::new(
                if inter_unit_mapped {
                    ActionVerb::Reclassify
                } else {
                    ActionVerb::Investigate
                },
                "unit",
                unit.clone(),
                if inter_unit_mapped {
                    format!(
                        "The books of {unit} are out by {out_by}. Post the inter-unit pair for \
                         whatever moved in or out without one."
                    )
                } else {
                    format!(
                        "The books of {unit} are out by {out_by}, and no account is mapped for \
                         affiliate_receivable or affiliate_payable — until they are, there is \
                         nowhere to post the correction."
                    )
                },
            ));
        }

        let mut told = Vec::new();
        if !unbalanced_entries.is_empty() {
            told.push(format!(
                "{} journal entries do not balance",
                unbalanced_entries.len()
            ));
        }
        if !unbalanced_units.is_empty() {
            told.push(format!(
                "{} units' books do not balance on their own",
                unbalanced_units.len()
            ));
        }
        let (actions, summary) = capped(
            actions,
            format!(
                "{} as at {as_of}. Nothing else in tonight's run can be trusted until this is \
                 fixed: every other equation is arithmetic over these accounts.",
                told.join(" and ")
            ),
        );
        Ok(CheckResult::compared(
            self.key(),
            group.total_debit_minor,
            group.total_credit_minor,
            None,
            Tolerance::EXACT,
            Details::say(summary).with_rows(detail_rows),
        )
        // Blocked and not Exception even when the group total happens to agree,
        // because an entry or a unit that does not balance is a foundation
        // failing. See `domain::classify_foundation`.
        .in_state(CheckState::Blocked)
        .with_actions(actions))
    }
}

// ---------------------------------------------------------------------------
// (2) The Payment Ledger against the General Ledger
// ---------------------------------------------------------------------------

/// The Payment Ledger's outstanding equals the General Ledger balance of the
/// control account it is mapped to.
///
/// The second foundation, and the one query in this module written by somebody
/// else. `payment_ledger_integrity(as_of, unit)` is shipped by the Payment
/// Ledger's own migration, per `(account_key, qualifier, unit_id)` and signed to
/// the ledger's own side. Calling it rather than writing the same comparison
/// here is deliberate: two implementations of one control total is exactly how
/// two screens start disagreeing about a month end, and the half that would
/// drift is the half that knows how the Payment Ledger stores a cancellation.
///
/// A row whose control account is not mapped is Blocked rather than Exception.
/// There is no difference to report — there is nothing to compare against, and
/// a check that called that "balanced" would be green because it looked at
/// nothing.
struct PaymentLedgerControlAccounts;

#[async_trait]
impl IntegrityCheck for PaymentLedgerControlAccounts {
    fn key(&self) -> &str {
        "payment_ledger.control_accounts"
    }

    fn title(&self) -> &str {
        "The Payment Ledger ties to its control accounts"
    }

    fn area(&self) -> &str {
        "Payment Ledger"
    }

    fn scope(&self) -> Scope {
        Scope::Group
    }

    async fn evaluate(&self, pool: &PgPool, as_of: NaiveDate) -> Result<CheckResult, AppError> {
        if !function_ready(pool, "payment_ledger_integrity").await? {
            return Ok(waiting_on(
                self.key(),
                "payment_ledger_entry",
                "The Payment Ledger publishes this comparison itself, as \
                 payment_ledger_integrity(date, text). It is not in this database yet, so \
                 there is nothing to ask.",
            ));
        }
        let rows = payment_ledger_integrity_rows(pool, as_of).await?;
        if rows.is_empty() {
            return Ok(CheckResult::compared(
                self.key(),
                0,
                0,
                None,
                Tolerance::EXACT,
                Details::say(format!(
                    "The Payment Ledger holds no open item posted on or before {as_of}, so \
                     there is no control balance for it to disagree with."
                )),
            ));
        }
        Ok(summarise_control_rows(
            self.key(),
            self.title(),
            as_of,
            &rows,
            "the Payment Ledger",
            true,
        ))
    }
}

/// One `(account_key, qualifier, unit)` triple as the Payment Ledger reports it.
struct ControlRow {
    account_key: String,
    qualifier: String,
    /// The books the items sit in (0608).
    unit_id: String,
    account_code: Option<String>,
    open_items: i64,
    ledger_outstanding_minor: i64,
    gl_balance_minor: i64,
    difference_minor: i64,
}

impl ControlRow {
    /// How the triple reads on a screen: `acquirer_receivable:BCA at store-01`.
    fn label(&self) -> String {
        let qualified = if self.qualifier.is_empty() {
            self.account_key.clone()
        } else {
            format!("{}:{}", self.account_key, self.qualifier)
        };
        format!("{qualified} at {}", self.unit_id)
    }
}

async fn payment_ledger_integrity_rows(
    pool: &PgPool,
    as_of: NaiveDate,
) -> Result<Vec<ControlRow>, AppError> {
    let rows = sqlx::query(
        "SELECT account_key, qualifier, unit_id, account_code, open_items,
                ledger_outstanding_minor, gl_balance_minor, difference_minor
           FROM payment_ledger_integrity($1::date, NULL::text)",
    )
    .bind(as_of)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ControlRow {
                account_key: row.try_get("account_key")?,
                qualifier: row.try_get("qualifier")?,
                unit_id: row.try_get("unit_id")?,
                account_code: row.try_get("account_code")?,
                open_items: row.try_get("open_items")?,
                ledger_outstanding_minor: row.try_get("ledger_outstanding_minor")?,
                gl_balance_minor: row.try_get("gl_balance_minor")?,
                difference_minor: row.try_get("difference_minor")?,
            })
        })
        .collect()
}

/// Turn control rows into one answer, with a suggestion per disagreeing triple.
///
/// `foundation` says which reading a failure gets: equations two and four are
/// foundations and answer Blocked, equation five is ordinary work and answers
/// Exception. The arithmetic is identical, which is the point of having it in
/// one place.
fn summarise_control_rows(
    key: &str,
    title: &str,
    as_of: NaiveDate,
    rows: &[ControlRow],
    ledger: &str,
    foundation: bool,
) -> CheckResult {
    let mut expected = 0i64;
    let mut actual = 0i64;
    let mut detail_rows = Vec::with_capacity(rows.len());
    let mut actions = Vec::new();
    let mut unmapped = 0usize;
    let mut states = Vec::with_capacity(rows.len());

    for row in rows {
        expected += row.ledger_outstanding_minor;
        actual += row.gl_balance_minor;
        detail_rows.push(DetailRow::new(
            row.label(),
            row.ledger_outstanding_minor,
            row.gl_balance_minor,
        ));
        match &row.account_code {
            None => {
                unmapped += 1;
                states.push(CheckState::Blocked);
                actions.push(SuggestedAction::new(
                    ActionVerb::CreateDocument,
                    "account_link",
                    format!("{}|{}|{}", row.account_key, row.unit_id, row.qualifier),
                    format!(
                        "{} holds {} across {} open items and no account is mapped to it. \
                         Nothing can be compared until somebody links one on the Account Links \
                         screen.",
                        row.label(),
                        minor(row.ledger_outstanding_minor),
                        row.open_items
                    ),
                ));
            }
            Some(code) => {
                let state = if foundation {
                    classify_foundation(
                        row.ledger_outstanding_minor,
                        row.gl_balance_minor,
                        None,
                        Tolerance::EXACT,
                    )
                } else {
                    classify(
                        row.ledger_outstanding_minor,
                        row.gl_balance_minor,
                        None,
                        Tolerance::EXACT,
                    )
                };
                states.push(state);
                if state.is_open() {
                    actions.push(SuggestedAction::new(
                        ActionVerb::Investigate,
                        "account_link",
                        format!("{}|{}|{}", row.account_key, row.unit_id, row.qualifier),
                        format!(
                            "{} says {} is outstanding across {} open items; account {code} \
                             holds {}. They are {} apart, and one of the two is wrong.",
                            ledger,
                            minor(row.ledger_outstanding_minor),
                            row.open_items,
                            minor(row.gl_balance_minor),
                            minor(row.difference_minor.abs())
                        ),
                    ));
                }
            }
        }
    }

    let state = CheckState::worst(states);
    let summary = if state == CheckState::Balanced {
        format!(
            "As at {as_of}, {ledger} and the accounts mapped to it agree on all {} control \
             triples, at {}.",
            rows.len(),
            minor(expected)
        )
    } else {
        let disagreeing = rows.len() - unmapped;
        format!(
            "As at {as_of}, {ledger} holds {} against {} in the accounts mapped to it, across \
             {disagreeing} control triples{}. {title}.",
            minor(expected),
            minor(actual),
            if unmapped == 0 {
                String::new()
            } else {
                format!(" — and {unmapped} more that no account is mapped to")
            }
        )
    };
    let (actions, summary) = capped(actions, summary);
    CheckResult::compared(
        key,
        expected,
        actual,
        None,
        Tolerance::EXACT,
        Details::say(summary).with_rows(detail_rows),
    )
    .in_state(state)
    .with_actions(actions)
}

// ---------------------------------------------------------------------------
// (5) The acquirers
// ---------------------------------------------------------------------------

/// What each acquirer still owes us, against the receivable account that says
/// so, per acquirer and per unit.
///
/// Narrower than equation two and asking a different question. Equation two
/// proves the Payment Ledger and the books agree; this one is about ageing —
/// a card settlement is genuinely outstanding for two days and nothing is
/// wrong, and the same batch a week later is money an acquirer has not paid.
/// So the same rows are read twice with two tolerances, which is the whole
/// reason [`CheckState::Pending`] exists.
struct AcquirerReceivablesControl;

#[async_trait]
impl IntegrityCheck for AcquirerReceivablesControl {
    fn key(&self) -> &str {
        "acquirer.receivables_control"
    }

    fn title(&self) -> &str {
        "Open acquirer receivables equal the acquirer control account"
    }

    fn area(&self) -> &str {
        "Receivables"
    }

    fn scope(&self) -> Scope {
        Scope::Group
    }

    async fn evaluate(&self, pool: &PgPool, as_of: NaiveDate) -> Result<CheckResult, AppError> {
        if !function_ready(pool, "payment_ledger_as_of").await? {
            return Ok(waiting_on(
                self.key(),
                "payment_ledger_entry",
                "A card sale opens a receivable on the acquirer and a settlement closes it. \
                 This reads the open ones from payment_ledger_as_of(date) and compares them \
                 with the mapped control account, per acquirer and unit.",
            ));
        }

        // Which control meanings the acquirers actually sit on, taken from the
        // data rather than from a hard-coded vocabulary here. A list of account
        // keys written into this file would be a second place to update the day
        // somebody adds a scheme.
        let open = sqlx::query(
            "SELECT i.account_key, i.qualifier, i.unit_id, i.party_id, i.party_name,
                    COUNT(*)::bigint AS items,
                    COALESCE(SUM(i.outstanding_minor), 0)::bigint AS outstanding,
                    MAX(i.age_days)::int AS oldest_days
               FROM payment_ledger_as_of($1::date) i
              WHERE i.party_type = 'ACQUIRER' AND i.outstanding_minor <> 0
              GROUP BY i.account_key, i.qualifier, i.unit_id, i.party_id, i.party_name
              ORDER BY MAX(i.age_days) DESC",
        )
        .bind(as_of)
        .fetch_all(pool)
        .await?;

        if open.is_empty() {
            return Ok(CheckResult::compared(
                self.key(),
                0,
                0,
                None,
                Tolerance::CARD_SETTLEMENT,
                Details::say(format!(
                    "No acquirer owed anything as at {as_of}: every card batch raised on or \
                     before that date has been settled."
                )),
            ));
        }

        // The control comparison, from the Payment Ledger's own query, narrowed
        // to the account keys the acquirer items actually sit on.
        let acquirer_keys: Vec<String> = open
            .iter()
            .map(|row| row.try_get::<String, _>("account_key"))
            .collect::<Result<Vec<_>, _>>()?;
        let control: Vec<ControlRow> = if function_ready(pool, "payment_ledger_integrity").await? {
            payment_ledger_integrity_rows(pool, as_of)
                .await?
                .into_iter()
                .filter(|row| acquirer_keys.contains(&row.account_key))
                .collect()
        } else {
            Vec::new()
        };

        let mut ages = Vec::with_capacity(open.len());
        let mut detail_rows = Vec::with_capacity(open.len());
        let mut actions = Vec::new();
        let mut outstanding_total = 0i64;
        for row in &open {
            let unit: String = row.try_get("unit_id")?;
            let party_id: String = row.try_get("party_id")?;
            let party_name: Option<String> = row.try_get("party_name")?;
            let items: i64 = row.try_get("items")?;
            let outstanding: i64 = row.try_get("outstanding")?;
            let oldest: i32 = row.try_get("oldest_days")?;
            let acquirer = party_name.unwrap_or_else(|| party_id.clone());
            outstanding_total += outstanding;
            ages.push(i64::from(oldest));
            detail_rows.push(DetailRow::new(
                format!("{acquirer} at {unit}"),
                outstanding,
                0,
            ));
            if classify_in_flight(i64::from(oldest), Tolerance::CARD_SETTLEMENT).is_open() {
                actions.push(SuggestedAction::new(
                    ActionVerb::Investigate,
                    "acquirer",
                    format!("{party_id}|{unit}"),
                    format!(
                        "{acquirer} owes {unit} {} across {items} batches, the oldest {oldest} \
                         days old against a T+{} settlement. Chase the payout, or match the \
                         one that arrived and was never allocated.",
                        minor(outstanding),
                        Tolerance::CARD_SETTLEMENT.settles_within_days
                    ),
                ));
            }
        }

        // Two readings of the same money, and the worse one wins: an acquirer
        // that is late AND a control account that disagrees is not less wrong
        // than either on its own.
        let ageing_state = classify_oldest(&ages, Tolerance::CARD_SETTLEMENT);
        let mut control_total = 0i64;
        for row in &control {
            control_total += row.gl_balance_minor;
            if row.difference_minor != 0 || row.account_code.is_none() {
                detail_rows.push(DetailRow::new(
                    format!("control {}", row.label()),
                    row.ledger_outstanding_minor,
                    row.gl_balance_minor,
                ));
                actions.push(SuggestedAction::new(
                    ActionVerb::Investigate,
                    "account_link",
                    format!("{}|{}|{}", row.account_key, row.unit_id, row.qualifier),
                    match &row.account_code {
                        Some(code) => format!(
                            "{} is out by {}: the Payment Ledger says {} and account {code} \
                             holds {}.",
                            row.label(),
                            minor(row.difference_minor.abs()),
                            minor(row.ledger_outstanding_minor),
                            minor(row.gl_balance_minor)
                        ),
                        None => format!(
                            "{} has no account mapped to it, so the card receivable cannot be \
                             checked against the books at all.",
                            row.label()
                        ),
                    },
                ));
            }
        }
        let control_state = if control.is_empty() {
            CheckState::Balanced
        } else {
            CheckState::worst(control.iter().map(|row| match row.account_code {
                None => CheckState::Blocked,
                Some(_) => classify(
                    row.ledger_outstanding_minor,
                    row.gl_balance_minor,
                    None,
                    Tolerance::EXACT,
                ),
            }))
        };

        let oldest = ages.iter().copied().max().unwrap_or(0);
        let (actions, summary) = capped(
            actions,
            format!(
                "{} is outstanding with acquirers across {} acquirer-and-unit pairs as at \
                 {as_of}; the oldest batch is {oldest} days old against a T+{} settlement.{}",
                minor(outstanding_total),
                open.len(),
                Tolerance::CARD_SETTLEMENT.settles_within_days,
                if control.is_empty() {
                    " The control accounts could not be read, so only the ageing is proved here."
                        .to_string()
                } else {
                    format!(
                        " The mapped control accounts hold {}.",
                        minor(control_total)
                    )
                }
            ),
        );
        Ok(CheckResult::compared(
            self.key(),
            outstanding_total,
            control_total,
            Some(oldest),
            Tolerance::CARD_SETTLEMENT,
            Details::say(summary).with_rows(detail_rows),
        )
        .in_state(ageing_state.max(control_state))
        .with_actions(actions))
    }
}

// ---------------------------------------------------------------------------
// (9) The bank against the books
// ---------------------------------------------------------------------------

/// Book transactions reconcile to the statement, with timing told apart from
/// fault.
///
/// Two halves of one sentence, which is why they are one equation. A line the
/// bank reported this morning has not been booked yet and nothing is wrong; the
/// same line four days later is money moving through an account with no record
/// of why. And once the lines still in transit are allowed for, the statement's
/// closing balance and the book balance must agree — when they do not, matching
/// more lines will never close it.
///
/// The window is the same three days `bank_match::Ruleset` scores dates over,
/// deliberately: a line the matcher would still consider a candidate is a line
/// this engine should still be calling timing.
struct BankReconcilesToStatement;

#[async_trait]
impl IntegrityCheck for BankReconcilesToStatement {
    fn key(&self) -> &str {
        "bank.reconciles_to_statement"
    }

    fn title(&self) -> &str {
        "The bank statements reconcile to the books"
    }

    fn area(&self) -> &str {
        "Cash & bank"
    }

    fn scope(&self) -> Scope {
        Scope::Group
    }

    async fn evaluate(&self, pool: &PgPool, as_of: NaiveDate) -> Result<CheckResult, AppError> {
        let statements = sqlx::query(
            // The newest statement per account, because that is the one whose
            // closing balance is current. An older statement's closing figure
            // has already been superseded, and comparing it would report last
            // month's reconciliation forever.
            "SELECT DISTINCT ON (s.account_code, s.unit_id)
                    s.statement_id, s.account_code, s.unit_id, s.period_end, s.closing_minor
               FROM bank_statement s
              WHERE s.period_end <= $1
              ORDER BY s.account_code, s.unit_id, s.period_end DESC, s.imported_at DESC",
        )
        .bind(as_of)
        .fetch_all(pool)
        .await?;

        if statements.is_empty() {
            return Ok(waiting_on(
                self.key(),
                "bank_statement",
                "No statement has been imported, so there is nothing to agree the cash \
                 accounts with. Import one on the Bank reconciliation screen.",
            ));
        }

        // Half one: lines the books do not claim.
        let unmatched = sqlx::query(
            "SELECT l.line_id, l.value_date, l.description, l.debit_minor, l.credit_minor,
                    s.account_code, s.unit_id,
                    ($1::date - l.value_date)::int AS age_days
               FROM bank_statement_line l
               JOIN bank_statement s ON s.statement_id = l.statement_id
              WHERE l.value_date <= $1
                AND NOT EXISTS (SELECT 1 FROM bank_line_match m WHERE m.line_id = l.line_id)
              ORDER BY l.value_date, l.line_number",
        )
        .bind(as_of)
        .fetch_all(pool)
        .await?;

        let mut ages = Vec::with_capacity(unmatched.len());
        let mut detail_rows = Vec::new();
        let mut actions = Vec::new();
        let mut in_transit = 0i64;
        for row in &unmatched {
            let line_id: Uuid = row.try_get("line_id")?;
            let value_date: NaiveDate = row.try_get("value_date")?;
            let description: String = row.try_get("description")?;
            let account: String = row.try_get("account_code")?;
            let debit: i64 = row.try_get("debit_minor")?;
            let credit: i64 = row.try_get("credit_minor")?;
            let age: i32 = row.try_get("age_days")?;
            // A credit on the bank's statement is money arriving. Signed the
            // way our own books would move if the line were booked, so the
            // total is directly comparable with a ledger balance.
            let signed = credit - debit;
            in_transit += signed;
            ages.push(i64::from(age));
            detail_rows.push(DetailRow::new(
                format!("{account} {value_date} {description}"),
                signed,
                0,
            ));
            // Only the old ones become work. Listing every line still inside
            // the clearing window would put several hundred rows a day in front
            // of somebody, none of which they should touch.
            if classify_in_flight(i64::from(age), Tolerance::BANK_CLEARING).is_open() {
                actions.push(SuggestedAction::new(
                    ActionVerb::Match,
                    "bank_statement_line",
                    line_id.to_string(),
                    format!(
                        "{value_date} on {account}, {} {}, {age} days old and matching nothing \
                         in the books: {description}. Match it to a journal line, or write the \
                         entry it is missing.",
                        minor(signed.abs()),
                        if signed >= 0 { "in" } else { "out" },
                    ),
                ));
            }
        }
        let matching_state = classify_oldest(&ages, Tolerance::BANK_CLEARING);

        // Half two: the closing balances, once those lines are allowed for.
        let mut closing_total = 0i64;
        let mut reconciled_total = 0i64;
        let mut closing_states = Vec::with_capacity(statements.len());
        for row in &statements {
            let statement_id: Uuid = row.try_get("statement_id")?;
            let account: String = row.try_get("account_code")?;
            let unit: String = row.try_get("unit_id")?;
            let period_end: NaiveDate = row.try_get("period_end")?;
            let closing: i64 = row.try_get("closing_minor")?;

            let book: i64 = sqlx::query_scalar(
                "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint
                   FROM journal_line l JOIN journal_entry e USING (entry_id)
                  WHERE l.account_code = $1 AND l.unit_id = $2 AND e.posting_date <= $3",
            )
            .bind(&account)
            .bind(&unit)
            .bind(period_end)
            .fetch_one(pool)
            .await?;

            let outstanding: i64 = sqlx::query_scalar(
                "SELECT COALESCE(SUM(l.credit_minor - l.debit_minor), 0)::bigint
                   FROM bank_statement_line l
                   JOIN bank_statement s ON s.statement_id = l.statement_id
                  WHERE s.account_code = $1 AND s.unit_id = $2 AND l.value_date <= $3
                    AND NOT EXISTS (SELECT 1 FROM bank_line_match m WHERE m.line_id = l.line_id)",
            )
            .bind(&account)
            .bind(&unit)
            .bind(period_end)
            .fetch_one(pool)
            .await?;

            let reconciled = book + outstanding;
            closing_total += closing;
            reconciled_total += reconciled;
            detail_rows.push(DetailRow::new(
                format!("{account} at {unit} to {period_end}"),
                closing,
                reconciled,
            ));
            let state = classify(
                closing,
                reconciled,
                Some(age_days(as_of, period_end)),
                Tolerance::BANK_CLEARING,
            );
            closing_states.push(state);
            if state.is_open() {
                actions.push(SuggestedAction::new(
                    ActionVerb::Investigate,
                    "bank_statement",
                    statement_id.to_string(),
                    format!(
                        "{account} at {unit} closes at {} on the statement and at {} in the \
                         books once the {} still in transit is allowed for — {} unaccounted \
                         for. Matching more lines will not close this.",
                        minor(closing),
                        minor(reconciled),
                        minor(outstanding),
                        minor(closing - reconciled)
                    ),
                ));
            }
        }

        let oldest = ages.iter().copied().max().unwrap_or(0);
        let state = matching_state.max(CheckState::worst(closing_states));
        let (actions, summary) = capped(
            actions,
            format!(
                "Across {} bank accounts the statements close at {} and the books, with items \
                 in transit allowed for, at {}. {} statement lines worth {} on balance are \
                 matched to nothing; the oldest is {oldest} days old against a {} day clearing \
                 window.",
                statements.len(),
                minor(closing_total),
                minor(reconciled_total),
                unmatched.len(),
                minor(in_transit),
                Tolerance::BANK_CLEARING.settles_within_days
            ),
        );
        Ok(CheckResult::compared(
            self.key(),
            closing_total,
            reconciled_total,
            Some(oldest),
            Tolerance::EXACT,
            Details::say(summary).with_rows(detail_rows),
        )
        .in_state(state)
        .with_actions(actions))
    }
}

// ---------------------------------------------------------------------------
// (10) The units against each other
// ---------------------------------------------------------------------------

/// The affiliate accounts in each unit's books, read from the links exactly as
/// the Inter-unit screen reads them.
///
/// A link names only the family (`PEMBIAYAAN`, `BARANG`, `LAIN`); the other
/// unit is on the journal line as `counter_unit_id`, so the pair is read off
/// the line and the link only says which accounts are affiliate accounts.
/// DISTINCT because a unit's receivable and payable roles land on the same
/// hutang leaf (I7), and summing that leaf once per role would count every
/// line twice. Re-deriving it here rather than importing that module keeps
/// this engine able to run on a database where that lane's code is not
/// present — the view is the contract.
const AFFILIATE: &str = "SELECT DISTINCT r.unit_id, r.account_code
       FROM account_resolution r
      WHERE r.role IN ('affiliate_receivable', 'affiliate_payable')
        AND r.source_type = 'COMPANY'";

/// What one unit says another owes it equals what that one says it owes, and
/// the whole set nets to zero.
///
/// Two statements, and both have to hold. A pair that agrees bilaterally can
/// still be wrong in the same direction on both sides; a set that nets to zero
/// can hide two pairs that are wrong in opposite directions. Netting to zero is
/// the one that decides whether a consolidation is publishable, so a failure
/// there is what the summary leads with.
struct InterUnitBilateralAndNetsToZero;

#[async_trait]
impl IntegrityCheck for InterUnitBilateralAndNetsToZero {
    fn key(&self) -> &str {
        "interunit.bilateral_and_nets_to_zero"
    }

    fn title(&self) -> &str {
        "Inter-unit balances agree both ways and net to zero"
    }

    fn area(&self) -> &str {
        "Inter-unit"
    }

    fn scope(&self) -> Scope {
        Scope::Group
    }

    /// Both. A store's affiliate balance is the store's own to explain, even
    /// though head office posts whatever correction is agreed.
    fn audience(&self) -> Audience {
        Audience::Both
    }

    async fn evaluate(&self, pool: &PgPool, as_of: NaiveDate) -> Result<CheckResult, AppError> {
        let linked: bool =
            sqlx::query_scalar(&format!("SELECT EXISTS (SELECT 1 FROM ({AFFILIATE}) a)"))
                .fetch_one(pool)
                .await?;
        if !linked {
            return Ok(waiting_on(
                self.key(),
                "account_link",
                "No account is linked to affiliate_receivable or affiliate_payable, so no unit \
                 has anywhere to record what another owes it.",
            ));
        }

        // One row per (unit, counterparty): debits less credits over every
        // affiliate account in the unit's books, for the lines that name that
        // counterparty. Debit-positive is "owed to this unit" on both sides —
        // head office's piutang is a debit balance, a unit's hutang a credit
        // one — so a pair that agrees sums to zero, which is what the whole
        // equation is: the same money seen from two sides.
        let sides = sqlx::query(&format!(
            "WITH affiliate AS ({AFFILIATE})
             SELECT a.unit_id, l.counter_unit_id,
                    COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS net_minor
               FROM affiliate a
               JOIN journal_line l
                 ON l.account_code = a.account_code AND l.unit_id = a.unit_id
               JOIN journal_entry e ON e.entry_id = l.entry_id
              WHERE l.counter_unit_id IS NOT NULL
                AND e.posting_date <= $1
              GROUP BY a.unit_id, l.counter_unit_id
              ORDER BY a.unit_id, l.counter_unit_id"
        ))
        .bind(as_of)
        .fetch_all(pool)
        .await?;

        let mut pairs: Vec<(String, String, i64)> = Vec::new();
        for row in &sides {
            pairs.push((
                row.try_get("unit_id")?,
                row.try_get("counter_unit_id")?,
                row.try_get("net_minor")?,
            ));
        }

        let mut detail_rows = Vec::new();
        let mut actions = Vec::new();
        let mut states = Vec::new();
        let mut seen: Vec<(String, String)> = Vec::new();
        let mut group_net = 0i64;
        for (unit, counter, receivable) in &pairs {
            group_net += receivable;
            // Each unordered pair once. A and B is the same relationship as B
            // and A, and reporting it twice would double every difference on a
            // consolidation screen.
            if seen.iter().any(|(left, right)| {
                (left == unit && right == counter) || (left == counter && right == unit)
            }) {
                continue;
            }
            seen.push((unit.clone(), counter.clone()));
            let mirror = pairs
                .iter()
                .find(|(left, right, _)| left == counter && right == unit);
            let (theirs, mirrored) = match mirror {
                // What B says it owes A. Signed to A's side, so agreement is
                // equality rather than a sum somebody has to reason about.
                Some((_, _, their_net)) => (-their_net, true),
                None => (0, false),
            };
            detail_rows.push(DetailRow::new(
                format!("{unit} and {counter}"),
                *receivable,
                theirs,
            ));
            let state = classify(*receivable, theirs, None, Tolerance::EXACT);
            states.push(state);
            // One side with lines that net to nothing and no lines on the other
            // is not a difference: there is nothing either side is owed.
            let unanswered = !mirrored && *receivable != 0;
            if state.is_open() || unanswered {
                actions.push(SuggestedAction::new(
                    ActionVerb::Reclassify,
                    "unit",
                    unit.clone(),
                    if mirrored {
                        format!(
                            "{unit} says {counter} owes it {}; {counter}'s books say {}. They \
                             are {} apart, and only one of the two entries was ever posted in \
                             full.",
                            minor(*receivable),
                            minor(theirs),
                            minor((receivable - theirs).abs())
                        )
                    } else {
                        format!(
                            "{unit} carries {} against {counter}, and {counter} has nothing \
                             on its affiliate accounts against {unit}. The other half of every \
                             one of those movements is unrecorded.",
                            minor(*receivable)
                        )
                    },
                ));
                if unanswered {
                    states.push(CheckState::Exception);
                }
            }
        }

        let consolidation = classify(group_net, 0, None, Tolerance::EXACT);
        states.push(consolidation);
        if consolidation.is_open() {
            actions.push(SuggestedAction::new(
                ActionVerb::Investigate,
                "consolidation",
                "GROUP",
                format!(
                    "The inter-unit accounts net to {} across the group as at {as_of} rather \
                     than to nothing. A consolidation published on these figures would carry \
                     that as a real asset or a real debt, and it is neither.",
                    minor(group_net)
                ),
            ));
        }

        let state = CheckState::worst(states);
        let summary = if state == CheckState::Balanced {
            format!(
                "As at {as_of} all {} inter-unit pairs agree from both sides, and the set nets \
                 to nothing.",
                seen.len()
            )
        } else {
            format!(
                "As at {as_of} the inter-unit accounts net to {} across {} pairs rather than to \
                 nothing. Each difference is one movement posted in one unit's books and not \
                 the other's.",
                minor(group_net),
                seen.len()
            )
        };
        let (actions, summary) = capped(actions, summary);
        Ok(CheckResult::compared(
            self.key(),
            group_net,
            0,
            None,
            Tolerance::EXACT,
            Details::say(summary).with_rows(detail_rows),
        )
        .in_state(state)
        .with_actions(actions))
    }
}

// ---------------------------------------------------------------------------
// (3, 4, 6, 7, 8) The equations whose other half is still being built
// ---------------------------------------------------------------------------
//
// Each of these is in the registry on purpose. A control equation that is not
// listed is one nobody knows is missing; one that is listed and names the table
// it is waiting for is a gap on the screen with an owner. They answer Pending,
// never Balanced — an equation nobody could compute did not hold.
//
// Three of them belong to the store-money lane and two to the Stock Ledger
// lane. Neither has to be edited into this file when it lands: the lane writes
// the equation over its own tables, where the columns are known and the SQL can
// be tested beside the schema, and calls `register_integrity_check` with the
// same key. See that function.

macro_rules! placeholder_check {
    (
        $name:ident,
        key = $key:literal,
        title = $title:literal,
        area = $area:literal,
        audience = $audience:expr,
        relation = $relation:literal,
        waiting = $waiting:literal
    ) => {
        struct $name;

        #[async_trait]
        impl IntegrityCheck for $name {
            fn key(&self) -> &str {
                $key
            }
            fn title(&self) -> &str {
                $title
            }
            fn area(&self) -> &str {
                $area
            }
            fn audience(&self) -> Audience {
                $audience
            }
            fn scope(&self) -> Scope {
                Scope::Group
            }
            async fn evaluate(
                &self,
                pool: &PgPool,
                _as_of: NaiveDate,
            ) -> Result<CheckResult, AppError> {
                // Two different Pendings, because they mean different things to
                // whoever is reading the screen. "The table does not exist" is
                // a lane that has not started; "the table exists and nothing
                // asks anything of it" is a lane one registration away.
                if relation_ready(pool, $relation, &[]).await? {
                    return Ok(CheckResult::awaiting(
                        $key,
                        concat!(
                            "`",
                            $relation,
                            "` is in this database now, and no equation is \
                             registered over it. The lane that owns that table writes the \
                             check — where the columns are known and the SQL can be tested \
                             beside the schema — and calls `register_integrity_check` with \
                             this key, which retires this placeholder. "
                        )
                        .to_string()
                            + $waiting,
                    ));
                }
                Ok(waiting_on($key, $relation, $waiting))
            }
        }
    };
}

placeholder_check!(
    OperatingFundsSentEqualsUsed,
    key = "operating_funds.sent_equals_used",
    title = "Funds sent to a shop equal what the shop did with them",
    area = "Store money",
    audience = Audience::Both,
    relation = "store_fund_transfer",
    waiting = "Head office sends a store manager money to run the shop with, and it comes back \
               as settled payments, approved direct expenses, cash returned, or an outstanding \
               Piutang Kepala Toko. Today the sending is a journal entry and nothing follows \
               the four ways it is used, so a manager's float can only ever be reconciled by \
               hand."
);

placeholder_check!(
    FundAllocationsEqualOutstanding,
    key = "fund_allocation.open_equals_outstanding",
    title = "Open fund allocations equal Piutang Kepala Toko",
    area = "Store money",
    audience = Audience::Ho,
    relation = "fund_allocation",
    waiting = "An allocation is money earmarked for a purpose and not yet spent. The sum of \
               the open ones should equal the Payment Ledger's outstanding on Piutang Kepala \
               Toko, which should equal that account's General Ledger balance — three figures \
               that have to agree, of which only the last two exist."
);

placeholder_check!(
    StockQuantityPosition,
    key = "stock.quantity_position",
    title = "Stock quantity equals the position inside the boundary",
    area = "Stock",
    audience = Audience::Both,
    relation = "stock_ledger_entry",
    waiting = "Every unit's movements should sum to the position the boundary says it holds — \
               a shop's own count for a counted pool, and the system position for one nobody \
               has counted. The Stock Ledger lane owns both halves and will register this \
               equation over its own tables."
);

placeholder_check!(
    StockValueVersusLedger,
    key = "stock.value_vs_gl",
    title = "Stock Ledger value equals the inventory control account",
    area = "Stock",
    audience = Audience::Ho,
    relation = "stock_ledger_entry",
    waiting = "Stock is counted in pieces and, until the Stock Ledger lands, carries no money: \
               the inventory account is only ever moved by supplier bills, and nothing proves \
               it matches what is on the floor. Subject to posting timing, because a receipt \
               costed today may be journalled tomorrow."
);

placeholder_check!(
    ProceedsReconciledEqualsRemitted,
    key = "proceeds.reconciled_equals_remitted",
    title = "Reconciled takings equal what was remitted plus what is held",
    area = "Store money",
    audience = Audience::Both,
    relation = "store_remittance",
    waiting = "A shift closes, the drawer is counted, and nothing in the cloud records the \
               journey from the drawer to the bank. Reconciled proceeds should equal executed \
               or settled remittance plus proceeds still authorised and held, per shop per \
               day."
);

// ---------------------------------------------------------------------------
// Turning results into work
// ---------------------------------------------------------------------------

/// One row the run wants in somebody's queue.
struct AttentionDraft {
    source_kind: String,
    source_id: String,
    scope: Scope,
    audience: Audience,
    severity: CheckState,
    title: String,
    body: String,
    amount_minor: Option<i64>,
    actions: Vec<SuggestedAction>,
}

/// How a result becomes work.
///
/// One item per suggested action, because the action is the unit somebody
/// clears: fifty unmatched lines are fifty things to do, and one row saying
/// "fifty lines unmatched" is a row that can never be finished.
///
/// The routing rule is the one other lanes should know about: **an action whose
/// `target_kind` is `site` belongs to that location**, so a group-wide check can
/// put work in a shop's feed without needing an instance per shop. **An action
/// whose `target_kind` is `unit` belongs to every premises that unit owns**
/// (`premises`, read once per run): a finding about a unit's books lands in the
/// feeds of its places, since `attention_item` is keyed by site and a unit id
/// is not one. A unit with no premises keeps the result's own scope, and so
/// does everything else.
///
/// A result with no actions at all still raises one item when it is open — a
/// Blocked check has nothing to point at and is precisely the thing somebody
/// most needs to be told.
fn attention_drafts(
    check: &dyn IntegrityCheck,
    result: &CheckResult,
    premises: &[(String, String)],
) -> Vec<AttentionDraft> {
    if !result.state.is_open() {
        return Vec::new();
    }
    if result.suggested_actions.is_empty() {
        return vec![AttentionDraft {
            source_kind: result.key.clone(),
            source_id: result.scope.as_key().to_string(),
            scope: result.scope.clone(),
            audience: check.audience(),
            severity: result.state,
            title: check.title().to_string(),
            body: result.details.summary.clone(),
            amount_minor: Some(result.difference_minor),
            actions: Vec::new(),
        }];
    }
    result
        .suggested_actions
        .iter()
        .flat_map(|action| {
            let scopes: Vec<Scope> = match action.target_kind.as_str() {
                "site" => vec![Scope::site(action.target_id.clone())],
                "unit" => {
                    let places: Vec<Scope> = premises
                        .iter()
                        .filter(|(unit, _)| unit == &action.target_id)
                        .map(|(_, site)| Scope::site(site.clone()))
                        .collect();
                    if places.is_empty() {
                        vec![result.scope.clone()]
                    } else {
                        places
                    }
                }
                _ => vec![result.scope.clone()],
            };
            scopes.into_iter().map(move |scope| AttentionDraft {
                source_kind: result.key.clone(),
                source_id: action.target_id.clone(),
                scope,
                audience: check.audience(),
                severity: result.state,
                title: check.title().to_string(),
                body: action.label.clone(),
                amount_minor: None,
                actions: vec![action.clone()],
            })
        })
        .collect()
}

/// Every premises with the unit that owns it, as `(unit, site)`: what
/// [`attention_drafts`] routes a finding about a unit's books by. Read once
/// per run rather than once per action.
async fn premises_by_unit(pool: &PgPool) -> Result<Vec<(String, String)>, AppError> {
    let rows = sqlx::query("SELECT unit_id, id FROM site ORDER BY unit_id, id")
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| Ok((row.try_get("unit_id")?, row.try_get("id")?)))
        .collect()
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IntegrityResultRow {
    pub key: String,
    pub title: String,
    pub area: String,
    pub scope: String,
    pub state: String,
    pub expected_minor: i64,
    pub actual_minor: i64,
    pub difference_minor: i64,
    /// The stored answer, read back as the type it was written as. The columns
    /// are jsonb because a result's shape is the engine's business and not the
    /// database's; the browser still gets a type rather than `unknown`.
    pub details: Details,
    pub suggested_actions: Vec<SuggestedAction>,
    pub evaluated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IntegrityRunSummary {
    pub run_id: Uuid,
    pub as_of: NaiveDate,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub trigger: String,
    pub started_by: String,
    /// The worst state anything reached. `BALANCED` when everything agreed.
    pub worst_state: Option<String>,
    pub failure: Option<String>,
    pub results: Vec<IntegrityResultRow>,
    /// How many items this run left open, so a screen can say "nine to do"
    /// without a second request.
    pub open_items: i64,
}

/// Ask every equation, write down what they said, and turn the open ones into
/// work.
///
/// Each check is evaluated in its own read, and a check that fails is recorded
/// as Blocked with its own error rather than ending the run: one bad equation
/// must not cost the other nine their answers, which is exactly what happens
/// the first time somebody registers a check with a typo in its SQL.
pub async fn integrity_run_now(
    pool: &PgPool,
    as_of: NaiveDate,
    trigger: &str,
    actor: &str,
) -> Result<IntegrityRunSummary, AppError> {
    if trigger != "MANUAL" && trigger != "SCHEDULED" {
        return Err(AppError::Validation(
            "a run is either MANUAL or SCHEDULED".into(),
        ));
    }
    let run_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO integrity_run (run_id, as_of, trigger, started_by) VALUES ($1,$2,$3,$4)",
    )
    .bind(run_id)
    .bind(as_of)
    .bind(trigger)
    .bind(actor)
    .execute(pool)
    .await?;

    // What the last finished run said, so a check crossing INTO trouble can be
    // told apart from one that has been there for a fortnight. Only the
    // crossing is news; the standing state is the attention queue's job.
    let previous = previous_states(pool, run_id).await?;
    let premises = premises_by_unit(pool).await?;

    let mut worst = CheckState::Balanced;
    for check in integrity_registry() {
        let result = match check.evaluate(pool, as_of).await {
            Ok(result) => result,
            Err(error) => CheckResult::blocked(
                check.key(),
                format!(
                    "This check could not be evaluated: {error}. That is a fault in the check \
                     itself, not a finding about the books."
                ),
            )
            .at(check.scope()),
        };
        worst = worst.max(result.state);
        write_result(pool, run_id, &result).await?;

        let drafts = attention_drafts(check, &result, &premises);
        let mut raised: Vec<(String, String)> = Vec::with_capacity(drafts.len());
        for draft in &drafts {
            upsert_attention(pool, draft).await?;
            raised.push((draft.scope.as_key().to_string(), draft.source_id.clone()));
        }
        resolve_unseen(pool, check.key(), &raised).await?;

        let was_open = previous
            .iter()
            .find(|(key, scope, _)| key == check.key() && scope == result.scope.as_key())
            .map(|(_, _, state)| *state)
            .is_some_and(CheckState::is_open);
        if result.state.is_open() && !was_open {
            notify_transition(pool, check, &result).await?;
        }
    }

    sqlx::query("UPDATE integrity_run SET finished_at = now(), worst_state = $2 WHERE run_id = $1")
        .bind(run_id)
        .bind(worst.as_str())
        .execute(pool)
        .await?;

    integrity_run(pool, run_id).await
}

/// The state each equation was in as of the last run before this one.
async fn previous_states(
    pool: &PgPool,
    excluding: Uuid,
) -> Result<Vec<(String, String, CheckState)>, AppError> {
    let rows = sqlx::query(
        "SELECT r.key, r.scope, r.state
           FROM integrity_result r
          WHERE r.run_id = (
              SELECT run_id FROM integrity_run
               WHERE finished_at IS NOT NULL AND run_id <> $1
               ORDER BY started_at DESC LIMIT 1)",
    )
    .bind(excluding)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let state: String = row.try_get("state")?;
            Ok((
                row.try_get("key")?,
                row.try_get("scope")?,
                match state.as_str() {
                    "BALANCED" => CheckState::Balanced,
                    "PENDING" => CheckState::Pending,
                    "EXCEPTION" => CheckState::Exception,
                    _ => CheckState::Blocked,
                },
            ))
        })
        .collect()
}

async fn write_result(pool: &PgPool, run_id: Uuid, result: &CheckResult) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO integrity_result
           (result_id, run_id, key, scope, state, expected_minor, actual_minor,
            difference_minor, details, suggested_actions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(Uuid::new_v4())
    .bind(run_id)
    .bind(&result.key)
    .bind(result.scope.as_key())
    .bind(result.state.as_str())
    .bind(result.expected_minor)
    .bind(result.actual_minor)
    .bind(result.difference_minor)
    .bind(serde_json::to_value(&result.details)?)
    .bind(serde_json::to_value(&result.suggested_actions)?)
    .execute(pool)
    .await?;
    Ok(())
}

/// Raise it, or note that it is still there.
///
/// `opened_at` is never touched on the update. It is the one number that makes
/// a queue readable, and a run that refreshed it every night would turn a
/// six-week-old exception into one that is always new.
async fn upsert_attention(pool: &PgPool, draft: &AttentionDraft) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO attention_item
           (item_id, source_kind, source_id, scope, site_id, audience, severity,
            title, body, suggested_actions, amount_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (source_kind, scope, source_id) WHERE resolved_at IS NULL
         DO UPDATE SET severity = EXCLUDED.severity,
                       audience = EXCLUDED.audience,
                       title = EXCLUDED.title,
                       body = EXCLUDED.body,
                       suggested_actions = EXCLUDED.suggested_actions,
                       amount_minor = EXCLUDED.amount_minor,
                       last_seen_at = now()",
    )
    .bind(Uuid::new_v4())
    .bind(&draft.source_kind)
    .bind(&draft.source_id)
    .bind(draft.scope.as_key())
    .bind(draft.scope.site_id())
    .bind(draft.audience.as_str())
    .bind(draft.severity.as_str())
    .bind(&draft.title)
    .bind(&draft.body)
    .bind(serde_json::to_value(&draft.actions)?)
    .bind(draft.amount_minor)
    .execute(pool)
    .await?;
    Ok(())
}

/// Close what this run no longer finds.
///
/// This is what makes the queue self-clearing: an unmatched line somebody
/// matched this morning is gone from tonight's answer, so tonight's run resolves
/// it. Nobody has to remember to tick anything off, which is the difference
/// between a queue people work and a queue people abandon.
async fn resolve_unseen(
    pool: &PgPool,
    key: &str,
    raised: &[(String, String)],
) -> Result<u64, AppError> {
    let scopes: Vec<String> = raised.iter().map(|(scope, _)| scope.clone()).collect();
    let targets: Vec<String> = raised.iter().map(|(_, target)| target.clone()).collect();
    Ok(sqlx::query(
        "UPDATE attention_item a
            SET resolved_at = now(), resolved_by = $4
          WHERE a.resolved_at IS NULL
            AND a.source_kind = $1
            AND NOT EXISTS (
                SELECT 1 FROM unnest($2::text[], $3::text[]) AS still(scope, source_id)
                 WHERE still.scope = a.scope AND still.source_id = a.source_id)",
    )
    .bind(key)
    .bind(&scopes)
    .bind(&targets)
    .bind(INTEGRITY_ACTOR)
    .execute(pool)
    .await?
    .rows_affected())
}

/// Tell the people who can act, once, on the night it goes wrong.
///
/// The hook is here rather than in the HTTP layer because a scheduled run has
/// no request behind it, and an exception found at three in the morning is
/// exactly the one somebody should find waiting when they arrive.
///
/// Only on the crossing, never on the nights a check merely stays wrong. An
/// unmatched line open for six weeks is a real problem and it is not six weeks
/// of news; the standing state lives in `attention_item`, which is a queue and
/// does not expire.
async fn notify_transition(
    pool: &PgPool,
    check: &dyn IntegrityCheck,
    result: &CheckResult,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let recipients = super::notifications::recipients_with_role(&mut tx, NOTIFY_ROLES).await?;
    super::notifications::raise_notification(
        &mut tx,
        super::notifications::NewNotification {
            kind: "finance.integrity.exception",
            title: format!(
                "{} — {}",
                check.title(),
                result.state.as_str().to_lowercase()
            ),
            body: result.details.summary.clone(),
            subject: Some(("integrity_check", result.key.clone())),
            origin_id: None,
            payload: json!({
                "key": result.key,
                "scope": result.scope.as_key(),
                "state": result.state.as_str(),
                "expected_minor": result.expected_minor,
                "actual_minor": result.actual_minor,
                "difference_minor": result.difference_minor,
            }),
        },
        &recipients,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const RUN_COLUMNS: &str = "r.run_id, r.as_of, r.started_at, r.finished_at, r.trigger,
     r.started_by, r.worst_state, r.failure";

async fn hydrate_run(
    pool: &PgPool,
    row: &sqlx::postgres::PgRow,
) -> Result<IntegrityRunSummary, AppError> {
    let run_id: Uuid = row.try_get("run_id")?;
    let results = sqlx::query(
        "SELECT key, scope, state, expected_minor, actual_minor, difference_minor,
                details, suggested_actions, evaluated_at
           FROM integrity_result WHERE run_id = $1 ORDER BY key, scope",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    let open_items: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM attention_item WHERE resolved_at IS NULL")
            .fetch_one(pool)
            .await?;
    Ok(IntegrityRunSummary {
        run_id,
        as_of: row.try_get("as_of")?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
        trigger: row.try_get("trigger")?,
        started_by: row.try_get("started_by")?,
        worst_state: row.try_get("worst_state")?,
        failure: row.try_get("failure")?,
        results: results
            .iter()
            .map(to_result_row)
            .collect::<Result<Vec<_>, _>>()?,
        open_items,
    })
}

/// The title and area come from the registry rather than from the row.
///
/// Deliberately: the wording of a check is code, and a stored copy would be the
/// wording of whichever night it first ran. What is stored is the answer.
fn to_result_row(row: &sqlx::postgres::PgRow) -> Result<IntegrityResultRow, AppError> {
    let key: String = row.try_get("key")?;
    let registry = integrity_registry();
    let doc = registry.iter().find(|check| check.key() == key);
    Ok(IntegrityResultRow {
        title: doc.map_or_else(|| key.clone(), |check| check.title().to_string()),
        area: doc.map_or_else(|| "Retired".to_string(), |check| check.area().to_string()),
        key,
        scope: row.try_get("scope")?,
        state: row.try_get("state")?,
        expected_minor: row.try_get("expected_minor")?,
        actual_minor: row.try_get("actual_minor")?,
        difference_minor: row.try_get("difference_minor")?,
        details: serde_json::from_value(row.try_get("details")?)?,
        suggested_actions: serde_json::from_value(row.try_get("suggested_actions")?)?,
        evaluated_at: row.try_get("evaluated_at")?,
    })
}

pub async fn integrity_run(pool: &PgPool, run_id: Uuid) -> Result<IntegrityRunSummary, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {RUN_COLUMNS} FROM integrity_run r WHERE r.run_id = $1"
    ))
    .bind(run_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("integrity run".into()))?;
    hydrate_run(pool, &row).await
}

/// The newest finished run, with every check's answer.
///
/// `NotFound` when the engine has never run, rather than an empty run — a
/// screen that showed ten balanced checks because nothing had been asked would
/// be the exact lie this module exists to prevent.
pub async fn integrity_latest(pool: &PgPool) -> Result<IntegrityRunSummary, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {RUN_COLUMNS} FROM integrity_run r
          WHERE r.finished_at IS NOT NULL
          ORDER BY r.started_at DESC LIMIT 1"
    ))
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(
            "no integrity run has finished yet; POST /api/v1/finance/integrity/run".into(),
        )
    })?;
    hydrate_run(pool, &row).await
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IntegrityHistoryPoint {
    pub run_id: Uuid,
    pub as_of: NaiveDate,
    pub scope: String,
    pub state: String,
    pub expected_minor: i64,
    pub actual_minor: i64,
    pub difference_minor: i64,
    pub details: Details,
    pub evaluated_at: DateTime<Utc>,
}

/// One equation over time — the question a control screen is actually opened
/// to answer, which is never "what does it say now" but "when did this start".
pub async fn integrity_history(
    pool: &PgPool,
    key: &str,
    limit: i64,
) -> Result<Vec<IntegrityHistoryPoint>, AppError> {
    let rows = sqlx::query(
        "SELECT r.run_id, u.as_of, r.scope, r.state, r.expected_minor, r.actual_minor,
                r.difference_minor, r.details, r.evaluated_at
           FROM integrity_result r JOIN integrity_run u USING (run_id)
          WHERE r.key = $1
          ORDER BY u.started_at DESC, r.scope
          LIMIT $2",
    )
    .bind(key)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(IntegrityHistoryPoint {
                run_id: row.try_get("run_id")?,
                as_of: row.try_get("as_of")?,
                scope: row.try_get("scope")?,
                state: row.try_get("state")?,
                expected_minor: row.try_get("expected_minor")?,
                actual_minor: row.try_get("actual_minor")?,
                difference_minor: row.try_get("difference_minor")?,
                details: serde_json::from_value(row.try_get("details")?)?,
                evaluated_at: row.try_get("evaluated_at")?,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AttentionItemRow {
    pub item_id: Uuid,
    pub source_kind: String,
    pub source_id: String,
    pub scope: String,
    pub site_id: Option<String>,
    pub audience: String,
    pub severity: String,
    pub title: String,
    pub body: String,
    pub suggested_actions: Vec<SuggestedAction>,
    pub amount_minor: Option<i64>,
    pub opened_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    /// How long it has been open. Derived on read; a stored age would be wrong
    /// by morning.
    pub open_days: i32,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolved_by: Option<String>,
    pub resolved_reason: Option<String>,
}

/// Open items under one heading, so a feed reads as areas rather than as one
/// long list somebody has to sort in their head.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AttentionGroup {
    pub area: String,
    pub items: Vec<AttentionItemRow>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AttentionFeed {
    /// `HO`, or the site id of a shop's feed.
    pub audience: String,
    pub open_count: i64,
    pub blocked_count: i64,
    pub groups: Vec<AttentionGroup>,
}

const ATTENTION_COLUMNS: &str = "a.item_id, a.source_kind, a.source_id, a.scope, a.site_id,
     a.audience, a.severity, a.title, a.body, a.suggested_actions, a.amount_minor,
     a.opened_at, a.last_seen_at, a.resolved_at, a.resolved_by, a.resolved_reason,
     GREATEST((CURRENT_DATE - a.opened_at::date), 0)::int AS open_days";

fn to_attention(row: &sqlx::postgres::PgRow) -> Result<AttentionItemRow, AppError> {
    Ok(AttentionItemRow {
        item_id: row.try_get("item_id")?,
        source_kind: row.try_get("source_kind")?,
        source_id: row.try_get("source_id")?,
        scope: row.try_get("scope")?,
        site_id: row.try_get("site_id")?,
        audience: row.try_get("audience")?,
        severity: row.try_get("severity")?,
        title: row.try_get("title")?,
        body: row.try_get("body")?,
        suggested_actions: serde_json::from_value(row.try_get("suggested_actions")?)?,
        amount_minor: row.try_get("amount_minor")?,
        opened_at: row.try_get("opened_at")?,
        last_seen_at: row.try_get("last_seen_at")?,
        open_days: row.try_get("open_days")?,
        resolved_at: row.try_get("resolved_at")?,
        resolved_by: row.try_get("resolved_by")?,
        resolved_reason: row.try_get("resolved_reason")?,
    })
}

/// Group by the area the check belongs to, worst and oldest first inside each.
fn into_feed(audience: String, items: Vec<AttentionItemRow>) -> AttentionFeed {
    let open_count = items.len() as i64;
    let blocked_count = items
        .iter()
        .filter(|item| item.severity == "BLOCKED")
        .count() as i64;
    let registry = integrity_registry();
    let mut groups: Vec<AttentionGroup> = Vec::new();
    for item in items {
        let area = registry
            .iter()
            .find(|check| check.key() == item.source_kind)
            .map_or_else(|| "Retired".to_string(), |check| check.area().to_string());
        match groups.iter_mut().find(|group| group.area == area) {
            Some(group) => group.items.push(item),
            None => groups.push(AttentionGroup {
                area,
                items: vec![item],
            }),
        }
    }
    groups.sort_by(|left, right| left.area.cmp(&right.area));
    AttentionFeed {
        audience,
        open_count,
        blocked_count,
        groups,
    }
}

/// Head office's feed: everything open that head office can act on.
pub async fn attention_list(pool: &PgPool, limit: i64) -> Result<AttentionFeed, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {ATTENTION_COLUMNS} FROM attention_item a
          WHERE a.resolved_at IS NULL AND a.audience IN ('HO', 'BOTH')
          ORDER BY (a.severity = 'BLOCKED') DESC, a.opened_at
          LIMIT $1"
    ))
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    Ok(into_feed(
        "HO".into(),
        rows.iter()
            .map(to_attention)
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

/// One shop's feed: its own work, and nothing else.
///
/// Two filters and both are load-bearing. `site_id` keeps one shop out of
/// another's queue; `audience` keeps head office's work out of every shop's.
/// Dropping either would put rows in front of somebody who is not allowed to
/// act on them — a General Ledger mismatch in a shop's feed is not information,
/// it is noise a shop cannot clear, and that is how a feed becomes something
/// people scroll past.
pub async fn attention_for_store(
    pool: &PgPool,
    site_id: &str,
    limit: i64,
) -> Result<AttentionFeed, AppError> {
    let known: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
        .bind(site_id)
        .fetch_one(pool)
        .await?;
    if !known {
        return Err(AppError::NotFound(format!("site {site_id}")));
    }
    let rows = sqlx::query(&format!(
        "SELECT {ATTENTION_COLUMNS} FROM attention_item a
          WHERE a.resolved_at IS NULL
            AND a.site_id = $1
            AND a.audience IN ('STORE', 'BOTH')
          ORDER BY (a.severity = 'BLOCKED') DESC, a.opened_at
          LIMIT $2"
    ))
    .bind(site_id)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    Ok(into_feed(
        site_id.to_string(),
        rows.iter()
            .map(to_attention)
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

/// Close one by hand, with a reason.
///
/// The reason is required and it is not ceremony: a run resolves what it can
/// see is fixed, so anything a person closes is something the engine still
/// thinks is wrong. "I looked at it and it is fine" is a claim somebody may
/// have to answer for, and an unexplained one is worth nothing at an audit.
///
/// Nothing stops the next run raising it again, and nothing should: if the
/// books still disagree tomorrow night, they still disagree.
pub async fn attention_resolve(
    pool: &PgPool,
    item_id: Uuid,
    reason: &str,
    actor: &str,
) -> Result<AttentionItemRow, AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "closing an exception by hand needs a reason; it is the only record of why the \
             books were left disagreeing"
                .into(),
        ));
    }
    let updated = sqlx::query(
        "UPDATE attention_item
            SET resolved_at = now(), resolved_by = $2, resolved_reason = $3
          WHERE item_id = $1 AND resolved_at IS NULL",
    )
    .bind(item_id)
    .bind(actor)
    .bind(reason)
    .execute(pool)
    .await?
    .rows_affected();

    let row = sqlx::query(&format!(
        "SELECT {ATTENTION_COLUMNS} FROM attention_item a WHERE a.item_id = $1"
    ))
    .bind(item_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("attention item".into()))?;
    if updated == 0 {
        return Err(AppError::Conflict(
            "that item is already resolved; a later run will raise it again if the books \
             still disagree"
                .into(),
        ));
    }
    to_attention(&row)
}

/// Hand the period close the answer to "do the ten equations balance?".
///
/// Lane F's checklist ships `integrity.equations` as a critical placeholder that
/// answers Pending and says what it is waiting for — this engine. Registering
/// here, under the same key, replaces that placeholder; `period_close.rs` needs
/// no edit, which is the whole point of a registry keyed on a name.
///
/// The body is the adapter written out in that placeholder's doc comment.
///
/// **Call it at start-up, before anything asks for the checklist**, for the
/// reason [`register_integrity_check`] gives: a checklist that depended on which
/// request arrived first would be a close nobody could reproduce. It is
/// idempotent — `period_close_register` replaces by key — so calling it twice is
/// harmless, and a test that installs its own stand-in under this key still
/// wins, because it registers later.
pub fn integrity_install_close_check() {
    /// The last day of the month, because an equation asked `as_of` today would
    /// answer a question about today.
    async fn equations(pool: &PgPool, period: ClosePeriod) -> Result<CheckOutcome, AppError> {
        let as_of = NaiveDate::from_ymd_opt(period.year, period.month, period.last_day())
            .ok_or_else(|| AppError::Validation("not a month".into()))?;
        let mut failed = Vec::new();
        let mut blocked = Vec::new();
        let mut waiting = Vec::new();
        for check in integrity_registry() {
            let result = check.evaluate(pool, as_of).await?;
            match result.state {
                CheckState::Balanced => {}
                CheckState::Pending => waiting.push(check.key().to_string()),
                CheckState::Exception => failed.push(CheckPointer::new(
                    "integrity_check",
                    check.key(),
                    check.title(),
                )),
                CheckState::Blocked => blocked.push(check.key().to_string()),
            }
        }
        if !blocked.is_empty() {
            return Ok(CheckOutcome::blocked(format!(
                "the books do not add up: {}",
                blocked.join(", ")
            )));
        }
        if !waiting.is_empty() {
            return Ok(CheckOutcome::pending(format!(
                "could not be evaluated: {}",
                waiting.join(", ")
            )));
        }
        let count = i64::try_from(failed.len()).unwrap_or(i64::MAX);
        failed.truncate(super::period_close::POINTER_CAP as usize);
        Ok(CheckOutcome::from_exceptions(count, failed))
    }

    super::period_close::period_close_register(CloseCheck {
        key: "integrity.equations",
        title: "Every integrity equation balances",
        critical: true,
        evaluate: |pool, period| Box::pin(equations(pool, period)),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two checks answering to one name would file their answers under the same
    /// key and make each other's history unreadable — and the unique index on
    /// (run, key, scope) would refuse the second one at three in the morning.
    #[test]
    fn every_registered_check_has_its_own_key() {
        let registry = integrity_registry();
        let mut seen: Vec<&str> = registry.iter().map(|check| check.key()).collect();
        let before = seen.len();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(
            before,
            seen.len(),
            "two checks claim the same key: {seen:?}"
        );
    }

    /// The architecture froze at ten control equations. A registry that shipped
    /// nine would be one where somebody has to remember which is missing.
    #[test]
    fn the_registry_is_the_ten_equations() {
        assert_eq!(BUILT_IN.len(), 10, "there are ten control equations");
    }

    /// The key is the primary key of a check's whole history and half of an
    /// attention item's identity. A blank one, or one with a space in it, is a
    /// row somebody has to unpick by hand later.
    #[test]
    fn a_key_is_dotted_and_has_no_spaces() {
        for check in integrity_registry() {
            let key = check.key();
            assert!(key.contains('.'), "{key} should read area.equation");
            assert!(
                !key.chars().any(char::is_whitespace),
                "{key} has whitespace in it"
            );
            assert!(!check.title().trim().is_empty(), "{key} has no title");
        }
    }

    /// A shop is shown its own shifts, remittances, expenses and counts, and
    /// never a General Ledger mismatch it has no way to post a correction for.
    #[test]
    fn no_shop_is_shown_the_payment_ledger_or_the_acquirers() {
        for check in integrity_registry() {
            if matches!(
                check.key(),
                "payment_ledger.control_accounts"
                    | "acquirer.receivables_control"
                    | "bank.reconciles_to_statement"
                    | "fund_allocation.open_equals_outstanding"
                    | "stock.value_vs_gl"
            ) {
                assert!(
                    !check.audience().reaches_store(),
                    "{} is head-office work and must not reach a shop's feed",
                    check.key()
                );
            }
        }
    }
}
