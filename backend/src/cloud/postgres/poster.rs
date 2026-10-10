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
//! # And why a line now carries a category as well
//!
//! The chart went from 190 postable accounts to 40, and what left the account
//! code did not leave the ledger: which bank, which rack, which PPh article,
//! electricity or water are all still recorded — as keys on the line rather
//! than as digits in a code. Most of those keys were already here. The one that
//! was not is `category_code`, and it arrives the same way the account does:
//! from `account_map` when the line names a meaning, from the person when they
//! name a code. Nothing in this module works it out, because working it out
//! would be a second opinion about a fact the map already holds.
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
    assert_postable, resolve_account_from, resolve_linked, validate_account_posting, Intent,
    PostingFacts, Resolved,
};
use crate::cloud::application::AppError;
use crate::cloud::domain::{balancing_legs, first_unbalanced_unit, kind_for_source, UnitMovement};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

// The unit whose books carry every inter-unit receivable is head office, read
// from data on every posting (`sites::head_office_unit_id`: the one unit of
// kind HO, 0605) — never a constant here. The kernel still takes it as an
// argument, which is what keeps the kernel testable without a database.
//
// # A line is in a unit's books
//
// Since 0605 `journal_line.unit_id` names the unit — head office or a store —
// whose books the line is in, and every entry balances per unit (I3). A rule
// that knows a unit (payroll, a claim, store money) names it; a rule that
// knows a site (a receipt at the Gudang, a sale at a shop) asks
// `sites::unit_of_site` first. Nothing here takes a site.

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
///
/// # Where the category comes from, and why only on one of the two
///
/// With forty accounts the code no longer says what a line was about — `6301`
/// is every general and administrative expense in the company, and the
/// `line_category` on the line is what separates the electricity bill from the
/// cleaner. A `Meaning` never carries one, because the map already decided:
/// `expense_electricity` resolves to `6301` AND to the electricity category, in
/// one row, set once by somebody who knew. A rule that could override that
/// would be a second opinion about a fact there is only one of.
///
/// An `Account` carries one because the person choosing the code is also the
/// person choosing what it was for, and nothing else in the entry knows.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LineAccount {
    /// Resolved through `account_link` for this line's unit: the role, and
    /// where the decision is kept — the company's defaults (`COMPANY`, with the
    /// bank, pay class or asset class as `qualifier`), or a master record
    /// (`EXPENSE_CATEGORY`, `PAY_COMPONENT`, `PAYMENT_METHOD`, …) named by
    /// `qualifier` (0460, 0465).
    Meaning {
        semantic_key: String,
        /// Which one of the source's records. Empty when the role needs no
        /// narrowing.
        #[serde(default)]
        qualifier: String,
        #[serde(default = "company_source")]
        source_type: String,
    },
    /// A client account code, chosen deliberately by a person.
    Account {
        account_code: String,
        /// Required when the account declares a category family, refused when
        /// it does not. `validate_account_posting` says which, and names the
        /// codes that would have worked.
        #[serde(default)]
        category_code: Option<String>,
    },
}

// A meaning, spelled the way a posting rule spells it.
//
// `PostingLine::debit` used to take a `&str` and build the `Meaning` itself,
// which is why a hundred and seventy call sites read `PostingLine::debit("cash",
// …)`. They still do: the conversion is what keeps that spelling working now
// that the constructors take either kind of account. Three impls rather than
// one because a generic parameter does not deref-coerce — `&String` is not
// `&str` when the function is `impl Into<LineAccount>` — and the alternative is
// a `.as_str()` on every rule that built its key at runtime.

fn company_source() -> String {
    "COMPANY".to_string()
}

impl From<&str> for LineAccount {
    fn from(semantic_key: &str) -> Self {
        LineAccount::Meaning {
            semantic_key: semantic_key.to_string(),
            qualifier: String::new(),
            source_type: company_source(),
        }
    }
}

impl From<&String> for LineAccount {
    fn from(semantic_key: &String) -> Self {
        LineAccount::from(semantic_key.as_str())
    }
}

impl From<String> for LineAccount {
    fn from(semantic_key: String) -> Self {
        LineAccount::Meaning {
            semantic_key,
            qualifier: String::new(),
            source_type: company_source(),
        }
    }
}

/// One side of one posting.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PostingLine {
    pub account: LineAccount,
    /// Whose books the line is in: a unit id, never a site's (0605).
    pub unit_id: String,
    /// The unit on the other side, on an inter-unit line and nowhere else.
    ///
    /// A rule never sets this. It is written by the balancer below onto the
    /// affiliate legs it adds, so a shop's ledger can say who a balance is with
    /// instead of leaving somebody to decode a twelve-digit account code.
    #[serde(default)]
    pub counter_unit_id: Option<String>,
    pub debit_minor: i64,
    pub credit_minor: i64,
    /// Which party this line is against, from the party_type registry (0299), and
    /// who exactly. Written by the rule that KNOWS, like asset_id and
    /// bank_account_id; the 0300 guard enforces the pair on control accounts.
    pub party_type: Option<String>,
    pub party_id: Option<String>,
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
    /// it is settling came from a statement of one account. A leg built from a
    /// meaning does not have to: `bank_giro` qualified BCA has already named the
    /// bank and the product, and the validator reads the pair off the map. It
    /// refuses rather than guess when even that leaves two — which is the day we
    /// hold two BCA giro accounts, and the day a document has to say which.
    #[serde(default)]
    pub bank_account_id: Option<Uuid>,
    pub memo: Option<String>,
    /// Accounting dimension values (0470, ERPNext Accounting Dimension): the
    /// division, cost center or project a line belongs to, as
    /// (dimension code, value code). Written beside the line; a dimension
    /// Finance made mandatory is checked when the entry commits.
    #[serde(default)]
    pub dimensions: Vec<(String, String)>,
}

impl PostingLine {
    /// One side of an entry, named by meaning or by code.
    ///
    /// A bare `&str` is a meaning — `PostingLine::debit("cash", …)` reads the
    /// way it always did — and a `LineAccount` is whatever the caller built.
    /// Widened from `&str` when the chart shrank to forty: a person writing a
    /// journal entry now chooses an account AND a category, and a constructor
    /// that only spoke meanings meant every such caller assembling the struct
    /// by hand, field by field, with the next new field silently missing from
    /// all of them.
    pub fn debit(account: impl Into<LineAccount>, unit_id: &str, amount_minor: i64) -> Self {
        Self {
            account: account.into(),
            unit_id: unit_id.to_string(),
            counter_unit_id: None,
            debit_minor: amount_minor,
            credit_minor: 0,
            party_type: None,
            party_id: None,
            asset_id: None,
            bank_account_id: None,
            memo: None,
            dimensions: Vec::new(),
        }
    }

    pub fn credit(account: impl Into<LineAccount>, unit_id: &str, amount_minor: i64) -> Self {
        Self {
            account: account.into(),
            unit_id: unit_id.to_string(),
            counter_unit_id: None,
            debit_minor: 0,
            credit_minor: amount_minor,
            party_type: None,
            party_id: None,
            asset_id: None,
            bank_account_id: None,
            memo: None,
            dimensions: Vec::new(),
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

    /// Resolve a role from a master record rather than the company's
    /// defaults: `from_source("EXPENSE_CATEGORY", "expense_electricity")`.
    pub fn from_source(mut self, source_type: &str, source_id: &str) -> Self {
        if let LineAccount::Meaning {
            qualifier,
            source_type: slot,
            ..
        } = &mut self.account
        {
            *slot = source_type.to_string();
            *qualifier = source_id.to_string();
        }
        self
    }

    /// Say what a line named by CODE was for.
    ///
    /// The counterpart of `with_qualifier`, and deliberately its mirror: that
    /// one narrows a meaning and does nothing to a code, this one narrows a
    /// code and does nothing to a meaning. A meaning's category comes from the
    /// map with its account, and a setter that could override it would let a
    /// rule book electricity as rent while the map said otherwise — two
    /// answers to a question that has one.
    pub fn with_category(mut self, category_code: &str) -> Self {
        if let LineAccount::Account {
            category_code: slot,
            ..
        } = &mut self.account
        {
            *slot = Some(category_code.to_string());
        }
        self
    }

    /// Say which unit is on the other side of an affiliate line.
    ///
    /// The balancer sets this on the legs it adds, and a rule that posts an
    /// affiliate line itself — the store's half of a remittance, head office's
    /// half of receiving it — has to set it too, because the account guard
    /// (`requires_counter_site`) refuses an inter-unit balance that names only
    /// its own side. A rule that knows says so; nothing infers it.
    /// Tag the line with an accounting dimension value (0470).
    pub fn with_dimension(mut self, dimension: &str, value: &str) -> Self {
        self.dimensions.retain(|(code, _)| code != dimension);
        self.dimensions
            .push((dimension.to_string(), value.to_string()));
        self
    }

    /// The unit on the other side of an affiliate line this rule posts itself
    /// — head office on a store's leg, the store on head office's (I8).
    pub fn with_counter_unit(mut self, counter_unit_id: &str) -> Self {
        self.counter_unit_id = Some(counter_unit_id.to_string());
        self
    }

    pub fn for_supplier(mut self, supplier_id: &str) -> Self {
        self.party_type = Some("SUPPLIER".to_string());
        self.party_id = Some(supplier_id.to_string());
        self
    }

    /// Say which employee this line is against — the mirror of
    /// `for_supplier`, and the party the 0300 guard and the payment surfaces
    /// read. An expense claim's payable carries it (the debt is owed TO one
    /// person); the expense side does not, for the same reason a supplier
    /// bill's expense lines name no supplier: the cost is not owed BY the
    /// person it is about.
    pub fn for_employee(mut self, employee_id: &str) -> Self {
        self.party_type = Some("EMPLOYEE".to_string());
        self.party_id = Some(employee_id.to_string());
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
fn balanced_per_unit(
    intent: &PostingIntent,
    head_office: &str,
) -> Result<(Vec<PostingLine>, i64), AppError> {
    let total = check_balanced(&intent.lines)?;

    let movements: Vec<UnitMovement> = intent
        .lines
        .iter()
        .map(|line| UnitMovement::new(&line.unit_id, line.debit_minor, line.credit_minor))
        .collect();
    let kind = kind_for_source(&intent.source_kind).map_err(AppError::Validation)?;
    let legs = balancing_legs(&movements, kind, head_office);
    if legs.is_empty() {
        return Ok((intent.lines.clone(), total));
    }

    let mut lines = intent.lines.clone();
    for leg in legs {
        lines.push(PostingLine {
            dimensions: Vec::new(),
            account: LineAccount::Meaning {
                semantic_key: leg.semantic_key.to_string(),
                qualifier: leg.qualifier,
                source_type: company_source(),
            },
            unit_id: leg.unit_id,
            counter_unit_id: Some(leg.counter_unit_id),
            debit_minor: leg.debit_minor,
            credit_minor: leg.credit_minor,
            party_type: None,
            party_id: None,
            // An affiliate leg is about a unit, never about a machine.
            asset_id: None,
            bank_account_id: None,
            // No category here either, and nothing is missing: the leg names a
            // MEANING, so `1501`'s `interunit_reason` comes off the map row
            // with the account — FINANCING or GOODS, chosen once by whoever
            // mapped it, for the same qualifier `domain::interunit` picked.
            // Setting it here would be this file deciding a second time.
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
    let after: Vec<UnitMovement> = lines
        .iter()
        .map(|line| UnitMovement::new(&line.unit_id, line.debit_minor, line.credit_minor))
        .collect();
    if let Some((unit, out_by)) = first_unbalanced_unit(&after) {
        return Err(AppError::Validation(format!(
            "balancing a {} entry left unit {unit} out by {out_by}; this is a fault in the \
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
    // One common door for document-driven posting. Finance can keep the global
    // switch off while explicitly allowing a reviewed set of source kinds; the
    // database trigger enforces the same decision at the journal boundary.
    // A closing voucher is a Finance person's act like a manual journal (0464).
    if !matches!(intent.source_kind.as_str(), "MANUAL" | "PERIOD_CLOSING") {
        let automatic_posting_enabled = sqlx::query_scalar::<_, bool>(
            "SELECT control.automatic_posting_enabled
                    OR EXISTS (
                        SELECT 1
                          FROM finance_posting_source_policy policy
                         WHERE policy.source_kind = $1
                           AND policy.enabled
                    )
               FROM finance_posting_control control
              WHERE control.singleton = true
              FOR SHARE",
        )
        .bind(&intent.source_kind)
        .fetch_optional(&mut **tx)
        .await?
        .unwrap_or(false);

        if !automatic_posting_enabled {
            return Err(AppError::Conflict(
                format!("automatic posting is paused for source kind {}; Finance has not allowed this posting flow", intent.source_kind),
            ));
        }
    }

    let purpose = purpose
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .unwrap_or(MAIN);
    let head_office = super::sites::head_office_unit_id(&mut **tx).await?;
    let (lines, total) = balanced_per_unit(intent, &head_office)?;

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
        // Account and category together, from whichever of the two doors this
        // line came through. Never one from each: a code that resolved from the
        // map with a category, then given a different category by the caller,
        // would be a line whose two halves disagree about what it was for.
        // The meaning is kept beside the resolution, not consumed by it. The
        // validator reads it for one thing only: a bank leg built from
        // `bank_giro` qualified BCA has already said which bank, and since
        // fourteen accounts share `1102` that sentence is the only thing left
        // that can tell them apart without the document naming an account.
        let (meaning, meaning_qualifier) = match &line.account {
            LineAccount::Meaning {
                semantic_key,
                qualifier,
                ..
            } => (Some(semantic_key.as_str()), Some(qualifier.as_str())),
            LineAccount::Account { .. } => (None, None),
        };
        let Resolved {
            account_code: code,
            category_code: category,
        } = match &line.account {
            LineAccount::Meaning {
                semantic_key,
                qualifier,
                source_type,
            } => {
                // ERPNext's get_party_account: a line against a party first asks
                // whether that party has its own account for the role, then
                // falls back to the company's default (0465).
                let party = match (&line.party_type, &line.party_id) {
                    (Some(kind), Some(id)) if source_type == "COMPANY" => {
                        match resolve_linked(
                            &mut **tx,
                            semantic_key,
                            &line.unit_id,
                            "PARTY",
                            &format!("{kind}:{id}"),
                        )
                        .await?
                        {
                            Some(own) => Some(own),
                            // Then the party's group (ERPNext Supplier Group):
                            // a supplier's group is its category.
                            None if kind == "SUPPLIER" => {
                                let group: Option<String> = sqlx::query_scalar(
                                    "SELECT category FROM supplier WHERE supplier_id::text = $1",
                                )
                                .bind(id)
                                .fetch_optional(&mut **tx)
                                .await?;
                                match group {
                                    Some(group) => {
                                        resolve_linked(
                                            &mut **tx,
                                            semantic_key,
                                            &line.unit_id,
                                            "PARTY_GROUP",
                                            &format!("SUPPLIER:{group}"),
                                        )
                                        .await?
                                    }
                                    None => None,
                                }
                            }
                            None => None,
                        }
                    }
                    _ => None,
                };
                match party {
                    Some(found) => found,
                    None => {
                        resolve_account_from(
                            &mut **tx,
                            semantic_key,
                            &line.unit_id,
                            source_type,
                            qualifier,
                        )
                        .await?
                    }
                }
            }
            LineAccount::Account {
                account_code,
                category_code,
            } => Resolved {
                account_code: account_code.trim().to_string(),
                category_code: category_code
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| value.to_string()),
            },
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
                unit_id: &line.unit_id,
                counter_unit_id: line.counter_unit_id.as_deref(),
                category_code: category.as_deref(),
                bank_account_id: line.bank_account_id,
                semantic_key: meaning,
                qualifier: meaning_qualifier,
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
        // moved: the one the line named, or the only one still answering to
        // what the map declared. `None` where the chart knows of none, which is
        // every line in the estate until the client's accounts are registered.
        resolved.push((code, category, bank_account_id));
    }

    // The budget reads last, with every line's account and category resolved:
    // a promise about spending is checked against the posting as it will be,
    // not as the rule guessed it (0305).
    enforce_budgets(&mut **tx, intent.posting_date, &lines, &resolved).await?;

    let entry_id = Uuid::new_v4();
    let entry_number = super::number_series::next_number(
        &mut **tx,
        super::number_series::JOURNAL_ENTRY,
        intent.posting_date,
        None,
    )
    .await?;

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

    for (index, (line, (account_code, category_code, bank_account_id))) in
        lines.iter().zip(&resolved).enumerate()
    {
        let line_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, category_code, unit_id,
                counter_unit_id, debit_minor, credit_minor, party_type, party_id, asset_id, memo,
                bank_account_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        )
        .bind(line_id)
        .bind(entry_id)
        .bind(index as i32 + 1)
        .bind(account_code)
        // The fifth key on the line, beside the unit, the counter-unit, the
        // supplier, the asset and the bank account. It is written from the
        // resolution above and never worked out here: the account map and the
        // person writing the entry are the only two things that know, and both
        // have already said.
        .bind(category_code.as_deref())
        .bind(&line.unit_id)
        .bind(line.counter_unit_id.as_deref())
        .bind(line.debit_minor)
        .bind(line.credit_minor)
        .bind(line.party_type.as_deref())
        .bind(line.party_id.as_deref())
        .bind(line.asset_id)
        .bind(line.memo.as_deref())
        .bind(*bank_account_id)
        .execute(&mut **tx)
        .await?;
        for (dimension, value) in &line.dimensions {
            sqlx::query(
                "INSERT INTO journal_line_dimension (line_id, dimension_code, value_code)
                 VALUES ($1, $2, $3)",
            )
            .bind(line_id)
            .bind(dimension)
            .bind(value)
            .execute(&mut **tx)
            .await
            .map_err(|error| match &error {
                sqlx::Error::Database(db) if db.code().as_deref() == Some("23503") => {
                    AppError::Validation(format!(
                        "line {}: {value} is not a value of dimension {dimension}",
                        index + 1
                    ))
                }
                _ => error.into(),
            })?;
        }
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
/// The affiliate legs are copied with everything else, `counter_unit_id` and
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
        "SELECT line_id, line_number, account_code, category_code, unit_id, counter_unit_id,
                debit_minor, credit_minor, party_type, party_id, asset_id, memo, bank_account_id
           FROM journal_line WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(entry_id)
    .fetch_all(&mut **tx)
    .await?;

    let reversal_id = Uuid::new_v4();
    let entry_number = super::number_series::next_number(
        &mut **tx,
        super::number_series::JOURNAL_ENTRY,
        posting_date,
        None,
    )
    .await?;

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
    // `reversal_of` is UNIQUE: the database refuses the second reversal, and
    // the refusal must name the act rather than arrive as SQLSTATE 23505.
    .execute(&mut **tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.constraint() == Some("journal_entry_reversal_of_key") => {
            AppError::Conflict(format!(
                "{original_number} has already been reversed; a reversal is one mirror, \
                 never two -- reverse the reversal instead"
            ))
        }
        _ => AppError::from(error),
    })?;

    for row in &lines {
        let debit: i64 = row.try_get("debit_minor")?;
        let credit: i64 = row.try_get("credit_minor")?;
        let mirror_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, category_code, unit_id,
                counter_unit_id, debit_minor, credit_minor, party_type, party_id, asset_id, memo,
                bank_account_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        )
        .bind(mirror_id)
        .bind(reversal_id)
        .bind(row.try_get::<i32, _>("line_number")?)
        .bind(row.try_get::<String, _>("account_code")?)
        // Carried, exactly like the account code above it and for exactly the
        // same reason. If the map has been repointed since — the electricity
        // category retired, the meaning moved to another one — resolving afresh
        // would credit one category and debit another, and the pair would look
        // settled while both were wrong. A reversal undoes what was posted, not
        // what the rule would post today.
        .bind(row.try_get::<Option<String>, _>("category_code")?)
        .bind(row.try_get::<String, _>("unit_id")?)
        // Carried, not recomputed: the reversal of an inter-unit leg is with
        // the same unit the original was with.
        .bind(row.try_get::<Option<String>, _>("counter_unit_id")?)
        // The mirror: what was debited is credited.
        .bind(credit)
        .bind(debit)
        // Carried, not re-resolved: the mirror is against the same party the
        // original was against, or the sub-ledgers that read the pair (the
        // Payment Ledger, the ageing) would show a debt coming back to nobody
        // while a stranger received it. The SELECT above fetches the pair; the
        // trigger `journal_line_names_its_party` (0300) states when it is due.
        .bind(row.try_get::<Option<String>, _>("party_type")?)
        .bind(row.try_get::<Option<String>, _>("party_id")?)
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
        // The mirror carries the original's dimensions, so a division's or a
        // project's figures net back to nothing when the entry is undone.
        sqlx::query(
            "INSERT INTO journal_line_dimension (line_id, dimension_code, value_code)
             SELECT $1, dimension_code, value_code FROM journal_line_dimension WHERE line_id = $2",
        )
        .bind(mirror_id)
        .bind(row.try_get::<Uuid, _>("line_id")?)
        .execute(&mut **tx)
        .await?;
    }

    Ok(Posted {
        entry_id: reversal_id,
        entry_number,
        total_minor: total,
    })
}

// ---------------------------------------------------------------------------
// Budgets: a promise the poster reads (0305)
// ---------------------------------------------------------------------------

/// STOP budgets this posting runs into, refusing with the numbers.
///
/// WARN budgets never arrive here — a note is not a refusal, and the screen
/// reads them from the table directly. Only STOP crosses the door, and only
/// when the month's spend would cross the promise: the promise is read once,
/// the month's spend once, and the posting's own share is added before the
/// comparison, because the entry in hand is part of what would break it.
/// OPENING is exempt the same way the party guard is: history arriving is not
/// the month choosing to spend.
async fn enforce_budgets(
    tx: &mut sqlx::PgConnection,
    posting_date: NaiveDate,
    lines: &[PostingLine],
    resolved: &[(String, Option<String>, Option<Uuid>)],
) -> Result<(), AppError> {
    let budgets = sqlx::query(
        "SELECT unit_id, account_code, category_code, amount_minor, period_start, period_end
           FROM budget
          WHERE superseded_by IS NULL
            AND on_exceed = 'STOP'
            AND period_start <= $1 AND period_end >= $1",
    )
    .bind(posting_date)
    .fetch_all(&mut *tx)
    .await?;
    if budgets.is_empty() {
        return Ok(());
    }

    let spenders: Vec<(&str, &str, Option<&str>, i64)> = lines
        .iter()
        .zip(resolved.iter())
        .filter(|(line, _)| line.debit_minor > 0)
        .map(|(line, (account_code, category_code, _))| {
            (
                line.unit_id.as_str(),
                account_code.as_str(),
                category_code.as_deref(),
                line.debit_minor,
            )
        })
        .collect();
    if spenders.is_empty() {
        return Ok(());
    }

    for budget in &budgets {
        let unit_id: String = budget.try_get("unit_id")?;
        let account_code: Option<String> = budget.try_get("account_code")?;
        let category_code: Option<String> = budget.try_get("category_code")?;
        let amount_minor: i64 = budget.try_get("amount_minor")?;
        let period_start: NaiveDate = budget.try_get("period_start")?;
        let period_end: NaiveDate = budget.try_get("period_end")?;

        let mut adds: i64 = 0;
        let mut hits_unit = false;
        for (unit, account, category, debit) in &spenders {
            let hit = match (&account_code, &category_code) {
                (Some(wanted), _) => *account == wanted.as_str(),
                (None, Some(wanted)) => *category == Some(wanted.as_str()),
                (None, None) => false,
            };
            if hit && *unit == unit_id {
                adds += debit;
                hits_unit = true;
            }
        }
        if !hits_unit {
            continue;
        }

        let spent: i64 = sqlx::query_scalar(
            // `::bigint`: SUM over bigint is numeric in Postgres, and numeric
            // does not decode into i64 — without the cast every posting that
            // met a STOP budget failed as "database operation failed".
            "SELECT COALESCE(SUM(jl.debit_minor - jl.credit_minor), 0)::bigint
               FROM journal_line jl
               JOIN journal_entry je ON je.entry_id = jl.entry_id
              WHERE jl.unit_id = $1
                AND je.posting_date BETWEEN $2 AND $3
                AND je.source_kind <> 'OPENING'
                AND ($4::text IS NULL OR jl.account_code = $4)
                AND ($5::text IS NULL OR jl.category_code = $5)",
        )
        .bind(&unit_id)
        .bind(period_start)
        .bind(period_end)
        .bind(&account_code)
        .bind(&category_code)
        .fetch_one(&mut *tx)
        .await?;

        if spent + adds > amount_minor {
            return Err(AppError::Validation(format!(
                "budget STOP at {unit_id} for {} ({}..{}): promised {amount_minor}, the month \
                 already spent {spent}, and this entry adds {adds} — move the posting or raise \
                 the promise",
                account_code.as_deref().unwrap_or("its category"),
                period_start,
                period_end
            )));
        }
    }
    Ok(())
}
