//! The Payment Ledger: opening a balance, settling it, and reading what is
//! left.
//!
//! # Who calls this
//!
//! Posting rules, and nothing else. There is no endpoint that opens an item and
//! none that settles one, on purpose: an open balance exists because a document
//! was posted, so the rule that posts the document is the only thing that knows
//! it should exist. A screen that could open one would be a second writer with
//! its own idea of when a balance is real — the failure `poster.rs` exists to
//! prevent on the journal side, arriving through a different door.
//!
//! Every write here therefore takes a transaction it did not open, exactly as
//! `poster::post` does, and for the same reason: the ledger entry and the
//! journal entry either both exist or neither does. A caller's shape is
//!
//! ```ignore
//! let mut tx = pool.begin().await?;
//! let posted = post(&mut tx, &intent, actor).await?;
//! ple_open(&mut tx, &PaymentLedgerItem { journal_entry_id: posted.entry_id, .. }, actor).await?;
//! tx.commit().await?;
//! ```
//!
//! # What may be opened
//!
//! Only a receivable or a payable whose outstanding balance somebody has to
//! follow over time. 0143 has the list and the argument; the short version is
//! that money moving is not sufficient reason. A bank transfer, a bank fee, a
//! cash deposit and an expense paid on the spot all post a journal entry and
//! open nothing, and a rule that called `ple_open` for one of them would be
//! putting a balance on an ageing report that nobody can ever settle.
//!
//! # Where the numbers come from
//!
//! "Now" is the stored `outstanding_minor` and its partial index. "As at a
//! date" is `payment_ledger_as_of`, the SQL function from 0145 — the single
//! implementation of winding both sides back, so the list, the ageing, one
//! party's statement and the integrity check cannot drift apart. The bucket
//! arithmetic is `domain::payment_ledger`, which is pure and knows no calendar.

use super::payables::AgingBuckets;
use crate::cloud::application::AppError;
use crate::cloud::domain::{check_allocations, AgingTotals, AllocationRefusal};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/// Which way a balance faces.
///
/// An enum and not a sign. A signed amount would make every reader decide,
/// separately and silently, whether a negative payable is a receivable or a
/// mistake, and the readers would agree right up until somebody reversed
/// something.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum PaymentLedgerSide {
    /// Somebody owes us: a card acquirer, a store manager holding a float.
    Receivable,
    /// We owe somebody: a supplier bill, wages not yet paid.
    Payable,
}

impl PaymentLedgerSide {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Receivable => "RECEIVABLE",
            Self::Payable => "PAYABLE",
        }
    }

    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value.trim().to_ascii_uppercase().as_str() {
            "RECEIVABLE" => Ok(Self::Receivable),
            "PAYABLE" => Ok(Self::Payable),
            other => Err(AppError::Validation(format!(
                "'{other}' is not a side; a payment ledger entry is RECEIVABLE or PAYABLE"
            ))),
        }
    }
}

/// Who the balance is with.
///
/// One column rather than a nullable `supplier_id` beside a nullable
/// `acquirer_id` beside a nullable `employee_id`. The first shape needs a
/// migration every time finance follows a new kind of debt; this one needs a
/// value.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum PaymentLedgerPartyType {
    Supplier,
    /// A card scheme or a wallet: BCA, Mandiri, QRIS.
    Acquirer,
    /// A store manager holding head office's money, somebody owed wages.
    Employee,
    Customer,
    Other,
}

impl PaymentLedgerPartyType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Supplier => "SUPPLIER",
            Self::Acquirer => "ACQUIRER",
            Self::Employee => "EMPLOYEE",
            Self::Customer => "CUSTOMER",
            Self::Other => "OTHER",
        }
    }

    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value.trim().to_ascii_uppercase().as_str() {
            "SUPPLIER" => Ok(Self::Supplier),
            "ACQUIRER" => Ok(Self::Acquirer),
            "EMPLOYEE" => Ok(Self::Employee),
            "CUSTOMER" => Ok(Self::Customer),
            "OTHER" => Ok(Self::Other),
            other => Err(AppError::Validation(format!(
                "'{other}' is not a party type; it is one of SUPPLIER, ACQUIRER, \
                 EMPLOYEE, CUSTOMER, OTHER"
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// What a posting rule hands over
// ---------------------------------------------------------------------------

/// One balance to follow, as the rule that posted the document describes it.
#[derive(Clone, Debug)]
pub struct PaymentLedgerItem {
    /// The semantic key of the control account — `trade_payable`,
    /// `card_receivable_debit`, `store_manager_receivable`. Lower-cased on the
    /// way in, because `account_map` stores keys lower-cased and a balance that
    /// could not be matched to its own control account would be a balance
    /// nothing can check.
    pub account_key: String,
    /// Which bank, which scheme. Empty when the meaning needs no narrowing.
    pub qualifier: String,
    /// The books the balance sits in (0608): the unit whose journal line the
    /// rule posted, since that is the key it is reconciled against.
    pub unit_id: String,
    pub party_type: PaymentLedgerPartyType,
    pub party_id: String,
    /// For reading. A list that had to join four party tables to print a name
    /// is a list that gets slow and then gets cached.
    pub party_name: Option<String>,
    /// The document that created the balance.
    pub voucher_kind: String,
    pub voucher_id: String,
    /// The GL entry the caller has already posted in this same transaction.
    pub journal_entry_id: Uuid,
    pub side: PaymentLedgerSide,
    pub amount_minor: i64,
    pub currency: String,
    pub due_date: Option<NaiveDate>,
    pub posting_date: NaiveDate,
}

/// One item a settlement puts money against.
#[derive(Clone, Copy, Debug)]
pub struct PaymentLedgerAllocation {
    pub entry_id: Uuid,
    pub amount_minor: i64,
}

// ---------------------------------------------------------------------------
// What comes back
// ---------------------------------------------------------------------------

/// One open item, as at whatever date it was asked for.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerEntry {
    pub entry_id: Uuid,
    pub account_key: String,
    pub qualifier: String,
    pub unit_id: String,
    pub side: String,
    pub party_type: String,
    pub party_id: String,
    pub party_name: Option<String>,
    pub voucher_kind: String,
    pub voucher_id: String,
    pub against_voucher_kind: Option<String>,
    pub against_voucher_id: Option<String>,
    pub journal_entry_id: Uuid,
    /// The entry number, so a list can name the journal without a second fetch.
    pub entry_number: Option<String>,
    pub currency: String,
    pub amount_minor: i64,
    pub settled_minor: i64,
    pub outstanding_minor: i64,
    pub due_date: Option<NaiveDate>,
    pub posting_date: NaiveDate,
    /// Days past due as at the reporting date, negative when it is not due yet.
    /// Aged from the due date when there is one and from the posting date when
    /// there is not.
    pub age_days: i32,
    pub delinked: bool,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
}

/// What one item is left with after a settlement.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerRemainder {
    pub entry_id: Uuid,
    /// What this settlement put against it. Zero when the allocation was
    /// already there — a retry, not a second payment.
    pub applied_minor: i64,
    pub outstanding_minor: i64,
}

/// What a settlement did.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerSettled {
    pub against_voucher_kind: String,
    pub against_voucher_id: String,
    /// What this call actually applied. Zero on a retry of a settlement that
    /// was already recorded, which is the point of saying it separately.
    pub applied_minor: i64,
    /// What the items it touched still have open between them.
    pub outstanding_minor: i64,
    pub items: Vec<PaymentLedgerRemainder>,
}

/// What a cancellation removed.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerDelinked {
    pub voucher_kind: String,
    pub voucher_id: String,
    /// Open items this voucher had raised, now stopped counting.
    pub entries_delinked: i64,
    /// Allocations this voucher had made, now stopped counting — so whatever it
    /// had settled is open again. A bounced payment.
    pub settlements_delinked: i64,
    pub reopened_minor: i64,
}

/// What one control account has open.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerOutstanding {
    pub account_key: String,
    pub unit_id: Option<String>,
    pub qualifier: Option<String>,
    pub as_of: NaiveDate,
    pub open_items: i64,
    pub outstanding_minor: i64,
}

/// Which items to look at.
#[derive(Clone, Debug, Default)]
pub struct PaymentLedgerFilter {
    pub account_key: Option<String>,
    pub qualifier: Option<String>,
    pub unit_id: Option<String>,
    pub party_type: Option<PaymentLedgerPartyType>,
    pub party_id: Option<String>,
    pub voucher_kind: Option<String>,
    pub voucher_id: Option<String>,
    pub side: Option<PaymentLedgerSide>,
    /// Only what is still open. The ordinary case, and the one the partial
    /// index in 0143 is for.
    pub open_only: bool,
    pub as_of: Option<NaiveDate>,
    pub limit: i64,
}

/// One line of an ageing report.
///
/// The same shape for a control account and for a party inside one: `party_id`
/// is `None` on the roll-up. Two shapes would mean two ways to draw the same
/// table and two places to fix a bucket.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerAgingRow {
    pub account_key: String,
    pub qualifier: String,
    pub unit_id: String,
    pub side: String,
    pub party_type: Option<String>,
    pub party_id: Option<String>,
    pub party_name: Option<String>,
    pub items: i64,
    /// The age of the oldest thing still open, in days. Negative when nothing
    /// here has fallen due yet.
    pub oldest_days: i32,
    pub buckets: AgingBuckets,
}

/// What is open, how old, and whose.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerAging {
    pub as_of: NaiveDate,
    pub unit_id: Option<String>,
    /// Per control account triple. Heaviest first: an ageing report is read to
    /// decide what to chase next.
    pub accounts: Vec<PaymentLedgerAgingRow>,
    /// Per party inside each control account.
    pub parties: Vec<PaymentLedgerAgingRow>,
    pub total: AgingBuckets,
}

/// One party's open items and what they come to.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerPartyStatement {
    pub party_type: String,
    pub party_id: String,
    pub party_name: Option<String>,
    pub as_of: NaiveDate,
    pub items: Vec<PaymentLedgerEntry>,
    pub buckets: AgingBuckets,
    pub oldest_days: i32,
}

/// One allocation, in the history of a voucher.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerSettlementRow {
    pub settlement_id: Uuid,
    pub entry_id: Uuid,
    /// `SETTLED_BY` when the voucher asked about is the one doing the settling,
    /// `SETTLED` when it is the one being settled. One query answers both
    /// questions a screen asks — "what did this payment pay for" and "what has
    /// been paid against this bill" — and this says which it answered.
    pub role: String,
    pub voucher_kind: String,
    pub voucher_id: String,
    pub against_voucher_kind: String,
    pub against_voucher_id: String,
    pub party_type: String,
    pub party_id: String,
    pub amount_minor: i64,
    pub journal_entry_id: Uuid,
    pub entry_number: Option<String>,
    pub posting_date: NaiveDate,
    pub delinked: bool,
    pub delinked_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
}

/// One control account, as the Payment Ledger has it and as the books have it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerIntegrityRow {
    pub account_key: String,
    pub qualifier: String,
    pub unit_id: String,
    pub side: String,
    /// `None` when nothing is mapped for this triple, which is a finding in
    /// itself: the balance has no line in the books to be compared with.
    pub account_code: Option<String>,
    pub account_name: Option<String>,
    pub open_items: i64,
    pub ledger_outstanding_minor: i64,
    /// Signed to the ledger's own side, so a payable is positive on both sides
    /// of the comparison and the difference is a difference.
    pub gl_balance_minor: i64,
    pub difference_minor: i64,
}

/// Whether the Payment Ledger and the General Ledger agree, account by account.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerIntegrity {
    pub as_of: NaiveDate,
    pub unit_id: Option<String>,
    pub rows: Vec<PaymentLedgerIntegrityRow>,
    /// Sent rather than left for the browser to work out, for the same reason
    /// `TrialBalance.balanced` is: a sub-ledger that does not agree with the
    /// books is the single most important thing this read can say, and it
    /// should not depend on a client-side subtraction.
    pub agrees: bool,
    pub largest_difference_minor: i64,
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

const AS_OF_COLUMNS: &str = "i.entry_id, i.account_key, i.qualifier, i.unit_id, i.side,
     i.party_type, i.party_id, i.party_name, i.voucher_kind, i.voucher_id,
     i.against_voucher_kind, i.against_voucher_id, i.journal_entry_id,
     i.currency, i.amount_minor, i.settled_minor, i.outstanding_minor,
     i.due_date, i.posting_date, i.age_days, i.delinked, i.created_at, i.created_by,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = i.journal_entry_id) AS entry_number";

fn to_entry(row: &sqlx::postgres::PgRow) -> Result<PaymentLedgerEntry, AppError> {
    Ok(PaymentLedgerEntry {
        entry_id: row.try_get("entry_id")?,
        account_key: row.try_get("account_key")?,
        qualifier: row.try_get("qualifier")?,
        unit_id: row.try_get("unit_id")?,
        side: row.try_get("side")?,
        party_type: row.try_get("party_type")?,
        party_id: row.try_get("party_id")?,
        party_name: row.try_get("party_name")?,
        voucher_kind: row.try_get("voucher_kind")?,
        voucher_id: row.try_get("voucher_id")?,
        against_voucher_kind: row.try_get("against_voucher_kind")?,
        against_voucher_id: row.try_get("against_voucher_id")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        entry_number: row.try_get("entry_number")?,
        currency: row.try_get("currency")?,
        amount_minor: row.try_get("amount_minor")?,
        settled_minor: row.try_get("settled_minor")?,
        outstanding_minor: row.try_get("outstanding_minor")?,
        due_date: row.try_get("due_date")?,
        posting_date: row.try_get("posting_date")?,
        age_days: row.try_get("age_days")?,
        delinked: row.try_get("delinked")?,
        created_at: row.try_get("created_at")?,
        created_by: row.try_get("created_by")?,
    })
}

/// Open one balance, in the caller's transaction, beside the journal entry it
/// belongs to.
///
/// Idempotent per `(voucher_kind, voucher_id, account_key, party)`, which is a
/// unique key in 0143 rather than a check here — a retried command, a replayed
/// sync batch or a double-clicked button finds the row already there and gets
/// its id back. What is refused is the same voucher opening the same balance
/// for a DIFFERENT amount: that is not a retry, it is two events wearing one
/// document number, and silently keeping the first would hide the second
/// forever.
///
/// The control account is not resolved here. The caller has already posted a
/// journal entry that resolved it, and a second lookup would only be able to
/// disagree with the first. Whether the key the rule opened matches the account
/// the rule posted to is exactly what `payment_ledger_integrity` measures, and
/// it is better measured than assumed.
pub async fn ple_open(
    tx: &mut Transaction<'_, Postgres>,
    item: &PaymentLedgerItem,
    actor: &str,
) -> Result<Uuid, AppError> {
    let account_key = item.account_key.trim().to_ascii_lowercase();
    if account_key.is_empty() {
        return Err(AppError::Validation(
            "a payment ledger entry needs the semantic key of its control account".into(),
        ));
    }
    let party_id = item.party_id.trim();
    if party_id.is_empty() {
        return Err(AppError::Validation(
            "a payment ledger entry needs a party; a balance nobody owes is not a balance".into(),
        ));
    }
    let voucher_kind = item.voucher_kind.trim();
    let voucher_id = item.voucher_id.trim();
    if voucher_kind.is_empty() || voucher_id.is_empty() {
        return Err(AppError::Validation(
            "a payment ledger entry needs the document that created it".into(),
        ));
    }
    if item.amount_minor <= 0 {
        return Err(AppError::Validation(format!(
            "an open balance of {} is not an open balance; the side says which way it \
             faces, so the amount is always positive",
            item.amount_minor
        )));
    }
    if let Some(due) = item.due_date {
        if due < item.posting_date {
            return Err(AppError::Validation(format!(
                "{voucher_kind} {voucher_id} falls due on {due}, before it was posted on {}",
                item.posting_date
            )));
        }
    }

    let entry_id = Uuid::new_v4();
    let inserted = sqlx::query(
        "INSERT INTO payment_ledger_entry
           (entry_id, account_key, qualifier, unit_id, party_type, party_id, party_name,
            voucher_kind, voucher_id, journal_entry_id, side, amount_minor, currency,
            due_date, posting_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (voucher_kind, voucher_id, account_key, party_type, party_id)
         DO NOTHING
         RETURNING entry_id",
    )
    .bind(entry_id)
    .bind(&account_key)
    .bind(item.qualifier.trim())
    .bind(&item.unit_id)
    .bind(item.party_type.as_str())
    .bind(party_id)
    .bind(item.party_name.as_deref())
    .bind(voucher_kind)
    .bind(voucher_id)
    .bind(item.journal_entry_id)
    .bind(item.side.as_str())
    .bind(item.amount_minor)
    .bind(&item.currency)
    .bind(item.due_date)
    .bind(item.posting_date)
    .bind(actor)
    .fetch_optional(&mut **tx)
    .await?;

    if let Some(row) = inserted {
        return Ok(row.try_get("entry_id")?);
    }

    let existing = sqlx::query(
        "SELECT entry_id, amount_minor FROM payment_ledger_entry
          WHERE voucher_kind=$1 AND voucher_id=$2 AND account_key=$3
            AND party_type=$4 AND party_id=$5",
    )
    .bind(voucher_kind)
    .bind(voucher_id)
    .bind(&account_key)
    .bind(item.party_type.as_str())
    .bind(party_id)
    .fetch_one(&mut **tx)
    .await?;
    let already: i64 = existing.try_get("amount_minor")?;
    if already != item.amount_minor {
        return Err(AppError::Conflict(format!(
            "{voucher_kind} {voucher_id} already opened {already} on '{account_key}' for \
             {party_id}, and this asks for {}. A document opens a balance once; a second \
             amount is a second document",
            item.amount_minor
        )));
    }
    Ok(existing.try_get("entry_id")?)
}

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

/// Turn the kernel's refusal into the sentence a person reads, naming the item
/// rather than the position in an array they never saw.
fn explain(refusal: AllocationRefusal, entries: &[Uuid]) -> AppError {
    let named = |index: usize| {
        entries
            .get(index)
            .map(|id| id.to_string())
            .unwrap_or_else(|| format!("allocation {}", index + 1))
    };
    match refusal {
        AllocationRefusal::OverSettles {
            index,
            asked_minor,
            open_minor,
        } => AppError::Conflict(format!(
            "settling {asked_minor} against {} would over-settle it; {open_minor} is open",
            named(index)
        )),
        AllocationRefusal::NotPositive {
            index,
            amount_minor,
        } => AppError::Validation(format!(
            "the allocation against {} is {amount_minor}; money coming back is a separate \
             document, not a negative settlement",
            named(index)
        )),
        other => AppError::Validation(other.to_string()),
    }
}

/// Allocate one settling document across one or more open items.
///
/// `journal_entry_id` is the entry the caller has already posted in this same
/// transaction — the money leaving the bank, or arriving from an acquirer. The
/// allocation and that entry commit together or not at all.
///
/// Over-settlement is refused three times over and that is deliberate: the
/// kernel refuses it with a sentence naming the item, the trigger in 0144
/// refuses it with a sentence naming the document, and the CHECK on the table
/// refuses it to anybody who has bypassed both. The first is the explanation;
/// the last is the guarantee.
///
/// Idempotent per `(entry_id, against_voucher_kind, against_voucher_id)`. A
/// retry of a settlement already recorded applies nothing and says so —
/// `applied_minor` comes back zero — rather than paying the same bill twice.
pub async fn ple_settle(
    tx: &mut Transaction<'_, Postgres>,
    against_voucher_kind: &str,
    against_voucher_id: &str,
    journal_entry_id: Uuid,
    posting_date: NaiveDate,
    allocations: &[PaymentLedgerAllocation],
    actor: &str,
) -> Result<PaymentLedgerSettled, AppError> {
    let kind = against_voucher_kind.trim();
    let voucher = against_voucher_id.trim();
    if kind.is_empty() || voucher.is_empty() {
        return Err(AppError::Validation(
            "a settlement needs the document doing the settling".into(),
        ));
    }
    if allocations.is_empty() {
        return Err(AppError::Validation(
            "a settlement has to name at least one open item".into(),
        ));
    }
    let mut seen = std::collections::BTreeSet::new();
    for allocation in allocations {
        if !seen.insert(allocation.entry_id) {
            return Err(AppError::Validation(format!(
                "{kind} {voucher} allocates twice against {}; add the two amounts \
                 together, because one document settles one item once",
                allocation.entry_id
            )));
        }
    }

    // Locked in one statement, in a stable order, so two settlements racing for
    // the last of a balance queue rather than deadlock against each other.
    let ids: Vec<Uuid> = allocations.iter().map(|a| a.entry_id).collect();
    let locked = sqlx::query(
        "SELECT entry_id, amount_minor, settled_minor, outstanding_minor, delinked,
                voucher_kind, voucher_id
           FROM payment_ledger_entry
          WHERE entry_id = ANY($1)
          ORDER BY entry_id
            FOR UPDATE",
    )
    .bind(&ids)
    .fetch_all(&mut **tx)
    .await?;
    if locked.len() != ids.len() {
        let found: std::collections::BTreeSet<Uuid> = locked
            .iter()
            .map(|row| row.get::<Uuid, _>("entry_id"))
            .collect();
        let missing: Vec<String> = ids
            .iter()
            .filter(|id| !found.contains(id))
            .map(Uuid::to_string)
            .collect();
        return Err(AppError::NotFound(format!(
            "payment ledger entry {}",
            missing.join(", ")
        )));
    }

    let mut open: BTreeMap<Uuid, (i64, bool)> = BTreeMap::new();
    for row in &locked {
        open.insert(
            row.try_get("entry_id")?,
            (row.try_get("outstanding_minor")?, row.try_get("delinked")?),
        );
    }

    // Allocations this document has already made, so a retry is recognised
    // rather than doubled.
    let prior = sqlx::query(
        "SELECT entry_id, amount_minor, delinked FROM payment_ledger_settlement
          WHERE entry_id = ANY($1) AND against_voucher_kind=$2 AND against_voucher_id=$3",
    )
    .bind(&ids)
    .bind(kind)
    .bind(voucher)
    .fetch_all(&mut **tx)
    .await?;
    let mut already: BTreeMap<Uuid, (i64, bool)> = BTreeMap::new();
    for row in &prior {
        already.insert(
            row.try_get("entry_id")?,
            (row.try_get("amount_minor")?, row.try_get("delinked")?),
        );
    }

    let mut fresh_ids: Vec<Uuid> = Vec::new();
    let mut fresh_open: Vec<i64> = Vec::new();
    let mut fresh_asked: Vec<i64> = Vec::new();
    for allocation in allocations {
        let (outstanding, delinked) = open
            .get(&allocation.entry_id)
            .copied()
            .unwrap_or((0, false));
        if delinked {
            return Err(AppError::Conflict(format!(
                "payment ledger entry {} was cancelled; there is nothing left to settle \
                 against it",
                allocation.entry_id
            )));
        }
        match already.get(&allocation.entry_id).copied() {
            Some((amount, false)) if amount == allocation.amount_minor => continue,
            Some((amount, false)) => {
                return Err(AppError::Conflict(format!(
                    "{kind} {voucher} already allocates {amount} against {}, and this asks \
                     for {}. Reverse the settlement and allocate again rather than editing it",
                    allocation.entry_id, allocation.amount_minor
                )));
            }
            Some((_, true)) => {
                return Err(AppError::Conflict(format!(
                    "{kind} {voucher} allocated against {} once and that allocation was \
                     reversed; settle with a new document rather than reinstating this one",
                    allocation.entry_id
                )));
            }
            None => {}
        }
        fresh_ids.push(allocation.entry_id);
        fresh_open.push(outstanding);
        fresh_asked.push(allocation.amount_minor);
    }

    let applied = if fresh_ids.is_empty() {
        0
    } else {
        let checked = check_allocations(&fresh_open, &fresh_asked)
            .map_err(|refusal| explain(refusal, &fresh_ids))?;
        for (entry_id, amount) in fresh_ids.iter().zip(&fresh_asked) {
            sqlx::query(
                "INSERT INTO payment_ledger_settlement
                   (settlement_id, entry_id, against_voucher_kind, against_voucher_id,
                    amount_minor, journal_entry_id, posting_date, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            )
            .bind(Uuid::new_v4())
            .bind(entry_id)
            .bind(kind)
            .bind(voucher)
            .bind(amount)
            .bind(journal_entry_id)
            .bind(posting_date)
            .bind(actor)
            .execute(&mut **tx)
            .await?;
        }
        checked.total_minor
    };

    let after = sqlx::query(
        "SELECT entry_id, outstanding_minor FROM payment_ledger_entry
          WHERE entry_id = ANY($1) ORDER BY entry_id",
    )
    .bind(&ids)
    .fetch_all(&mut **tx)
    .await?;
    let mut left: BTreeMap<Uuid, i64> = BTreeMap::new();
    for row in &after {
        left.insert(row.try_get("entry_id")?, row.try_get("outstanding_minor")?);
    }

    let mut items = Vec::with_capacity(allocations.len());
    let mut outstanding_total = 0_i64;
    for allocation in allocations {
        let outstanding = left.get(&allocation.entry_id).copied().unwrap_or(0);
        outstanding_total += outstanding;
        items.push(PaymentLedgerRemainder {
            entry_id: allocation.entry_id,
            applied_minor: if fresh_ids.contains(&allocation.entry_id) {
                allocation.amount_minor
            } else {
                0
            },
            outstanding_minor: outstanding,
        });
    }

    Ok(PaymentLedgerSettled {
        against_voucher_kind: kind.to_string(),
        against_voucher_id: voucher.to_string(),
        applied_minor: applied,
        outstanding_minor: outstanding_total,
        items,
    })
}

// ---------------------------------------------------------------------------
// Finding what a document answers
// ---------------------------------------------------------------------------

/// What a settling document knows about the items it is answering.
///
/// Not a [`PaymentLedgerFilter`]. That one is a screen's question — every field
/// optional, as at any date, on a pool — and this is a posting rule's. A rule
/// always knows the control account and the party, it is always asking about
/// now, and it is always inside the transaction that has just written the
/// journal entry. Keeping the two shapes apart means neither has to carry the
/// other's caveats.
#[derive(Clone, Copy, Debug)]
pub struct PaymentLedgerClaim<'a> {
    /// The semantic key of the control account, as the opener wrote it.
    pub account_key: &'a str,
    /// Which bank, which scheme. Empty when the meaning needs no narrowing —
    /// and it has to match, not be ignored, or a settlement meant for BCA would
    /// find MANDIRI's items sitting on the same account.
    pub qualifier: &'a str,
    pub unit_id: &'a str,
    pub party_type: PaymentLedgerPartyType,
    pub party_id: &'a str,
    /// The document that raised the items, when the settling one names it —
    /// "the open payable for BILL-0092 of PT Benang Emas". Left out when it
    /// genuinely does not: an acquirer's settlement answers whatever days are
    /// still open, and choosing which is the ledger's business rather than the
    /// file's.
    pub voucher_kind: Option<&'a str>,
    pub voucher_id: Option<&'a str>,
}

impl PaymentLedgerClaim<'_> {
    /// The claim as a person would say it, for the sentence a refusal prints.
    fn describe(&self) -> String {
        match (self.voucher_kind, self.voucher_id) {
            (Some(kind), Some(voucher)) => format!(
                "{kind} {voucher} on '{}' in the books of {} for {}",
                self.account_key, self.unit_id, self.party_id
            ),
            _ => format!(
                "'{}' in the books of {} for {}",
                self.account_key, self.unit_id, self.party_id
            ),
        }
    }
}

/// The open items a claim selects, inside the caller's transaction and locked.
///
/// [`ple_open_items`] takes a `&PgPool`, which is right for the ageing report
/// and the integrity check: they read as at a date and write nothing. It is
/// wrong for a posting rule. A second connection cannot see what this
/// transaction has just written — the bill posted a moment ago in the same
/// commit — and the ids it handed back would race [`ple_settle`]'s own
/// `FOR UPDATE` between the read and the write. This one reads the table
/// through the caller's own snapshot and takes that same lock as it reads, so
/// what it finds is still what it finds when the settlement lands on it.
///
/// It asks about now rather than as at a date, and reads the stored
/// `outstanding_minor` rather than `payment_ledger_as_of`: a settlement happens
/// now, and a set-returning function cannot be locked.
///
/// Oldest first — by due date where somebody agreed one, by posting date where
/// nobody did — because that is the order money is applied in when a document
/// answers more than one item and does not say how. A document that DOES say
/// how names its voucher on the claim and gets one item back.
pub async fn ple_find_open(
    tx: &mut Transaction<'_, Postgres>,
    claim: &PaymentLedgerClaim<'_>,
) -> Result<Vec<PaymentLedgerEntry>, AppError> {
    let account_key = claim.account_key.trim().to_ascii_lowercase();
    if account_key.is_empty() {
        return Err(AppError::Validation(
            "a claim on the payment ledger names the control account it is against".into(),
        ));
    }
    let party_id = claim.party_id.trim();
    if party_id.is_empty() {
        return Err(AppError::Validation(
            "a claim on the payment ledger names the party it is with".into(),
        ));
    }
    let rows = sqlx::query(
        "SELECT e.entry_id, e.account_key, e.qualifier, e.unit_id, e.side,
                e.party_type, e.party_id, e.party_name, e.voucher_kind, e.voucher_id,
                e.against_voucher_kind, e.against_voucher_id, e.journal_entry_id,
                NULL::text AS entry_number,
                e.currency, e.amount_minor, e.settled_minor, e.outstanding_minor,
                e.due_date, e.posting_date,
                (CURRENT_DATE - COALESCE(e.due_date, e.posting_date))::int AS age_days,
                e.delinked, e.created_at, e.created_by
           FROM payment_ledger_entry e
          WHERE e.account_key = $1
            AND e.qualifier = $2
            AND e.unit_id = $3
            AND e.party_type = $4
            AND e.party_id = $5
            AND ($6::text IS NULL OR e.voucher_kind = $6)
            AND ($7::text IS NULL OR e.voucher_id = $7)
            AND NOT e.delinked
            AND e.outstanding_minor <> 0
          ORDER BY COALESCE(e.due_date, e.posting_date), e.posting_date, e.entry_id
            FOR UPDATE",
    )
    .bind(&account_key)
    .bind(claim.qualifier.trim())
    .bind(claim.unit_id)
    .bind(claim.party_type.as_str())
    .bind(party_id)
    .bind(claim.voucher_kind.map(str::trim))
    .bind(claim.voucher_id.map(str::trim))
    .fetch_all(&mut **tx)
    .await?;
    rows.iter().map(to_entry).collect()
}

/// Find the items a document answers and put one amount against them.
///
/// The two calls every settling posting rule has to make, in one place. The
/// four seams this ledger was merged with unwired all knew a party, a control
/// account and an amount, and none of them knew an `entry_id`; four separate
/// oldest-first loops would be four chances to spread the same money four ways.
///
/// Two outcomes that are not errors and are worth telling apart:
///
///   * `Ok(None)` — the ledger holds nothing open for this claim. Either the
///     debt is already answered, or it predates the ledger and nothing here
///     follows it. Settling zero is then the honest act, and
///     `payment_ledger_integrity` is where the second case shows up.
///   * `Ok(Some(settled))` with `applied_minor` zero — this exact settlement is
///     already recorded. A retry, not a second payment.
///
/// What IS refused is a document settling more than the ledger has open for it:
/// `domain::spread` refuses rather than leaving a remainder, because a
/// settlement quietly short by its remainder is how a control account and its
/// sub-ledger part company.
#[allow(clippy::too_many_arguments)]
pub async fn ple_settle_claim(
    tx: &mut Transaction<'_, Postgres>,
    claim: &PaymentLedgerClaim<'_>,
    against_voucher_kind: &str,
    against_voucher_id: &str,
    journal_entry_id: Uuid,
    posting_date: NaiveDate,
    amount_minor: i64,
    actor: &str,
) -> Result<Option<PaymentLedgerSettled>, AppError> {
    if amount_minor <= 0 {
        return Ok(None);
    }
    let items = ple_find_open(tx, claim).await?;
    if items.is_empty() {
        return Ok(None);
    }
    let open: Vec<i64> = items.iter().map(|item| item.outstanding_minor).collect();
    let apportioned =
        crate::cloud::domain::spread(&open, amount_minor).map_err(|refusal| match refusal {
            AllocationRefusal::MoreThanIsOpen {
                asked_minor,
                open_minor,
            } => AppError::Conflict(format!(
                "{against_voucher_kind} {against_voucher_id} settles {asked_minor} against \
                 {}, which has {open_minor} open. A document cannot answer a debt nobody \
                 has raised",
                claim.describe()
            )),
            other => AppError::Validation(other.to_string()),
        })?;
    let allocations: Vec<PaymentLedgerAllocation> = items
        .iter()
        .zip(&apportioned)
        .filter(|(_, &amount)| amount > 0)
        .map(|(item, &amount)| PaymentLedgerAllocation {
            entry_id: item.entry_id,
            amount_minor: amount,
        })
        .collect();
    if allocations.is_empty() {
        return Ok(None);
    }
    let settled = ple_settle(
        tx,
        against_voucher_kind,
        against_voucher_id,
        journal_entry_id,
        posting_date,
        &allocations,
        actor,
    )
    .await?;
    Ok(Some(settled))
}

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

/// Take a voucher out of the ledger, both ways round.
///
/// One call, because a reversal does not know which of the two it is undoing.
/// A voucher may have OPENED balances — reversing a bill takes its payable out
/// — and it may have SETTLED them, in which case reversing it puts back
/// whatever it had closed. A bounced transfer is exactly the second, and a
/// function that only did the first would leave four bills marked paid.
///
/// The rows are kept and stop counting. Deleting them would leave the reversing
/// journal entry sitting in the books with nothing to explain it.
///
/// One limitation, stated because it is one: the cancellation is dated today
/// (`delinked_on`), not on the reversal's own posting date, because that date
/// is not on the call. A reversal posted into a month other than the current
/// one will therefore show as a difference in `payment_ledger_integrity`
/// between the two dates. That is visible and temporary, which is the right
/// kind of wrong; the fix when it matters is a posting date on this call.
pub async fn ple_delink(
    tx: &mut Transaction<'_, Postgres>,
    voucher_kind: &str,
    voucher_id: &str,
    reason: &str,
    actor: &str,
) -> Result<PaymentLedgerDelinked, AppError> {
    let kind = voucher_kind.trim();
    let voucher = voucher_id.trim();
    if kind.is_empty() || voucher.is_empty() {
        return Err(AppError::Validation(
            "delinking needs the document being taken out".into(),
        ));
    }
    let why = reason.trim();
    if why.is_empty() {
        return Err(AppError::Validation(
            "delinking needs a reason; a balance that vanished for no recorded reason is \
             the thing an audit asks about"
                .into(),
        ));
    }

    // The settlements first, so the entries this voucher settled are open again
    // before anything looks at them.
    let reopened = sqlx::query(
        "UPDATE payment_ledger_settlement
            SET delinked=true, delinked_reason=$3, delinked_by=$4,
                delinked_at=now(), delinked_on=CURRENT_DATE
          WHERE against_voucher_kind=$1 AND against_voucher_id=$2 AND NOT delinked
          RETURNING amount_minor",
    )
    .bind(kind)
    .bind(voucher)
    .bind(why)
    .bind(actor)
    .fetch_all(&mut **tx)
    .await?;
    let mut reopened_minor = 0_i64;
    for row in &reopened {
        reopened_minor += row.try_get::<i64, _>("amount_minor")?;
    }

    let entries = sqlx::query(
        "UPDATE payment_ledger_entry
            SET delinked=true, delinked_reason=$3, delinked_by=$4,
                delinked_at=now(), delinked_on=CURRENT_DATE
          WHERE voucher_kind=$1 AND voucher_id=$2 AND NOT delinked
          RETURNING entry_id",
    )
    .bind(kind)
    .bind(voucher)
    .bind(why)
    .bind(actor)
    .fetch_all(&mut **tx)
    .await?;

    Ok(PaymentLedgerDelinked {
        voucher_kind: kind.to_string(),
        voucher_id: voucher.to_string(),
        entries_delinked: entries.len() as i64,
        settlements_delinked: reopened.len() as i64,
        reopened_minor,
    })
}

/// Take ONE allocation back, leaving the payment and the obligation both open.
///
/// [`ple_delink`] is all-or-nothing for a voucher: every settlement it made
/// goes at once, which is what undoing the payment means. Unmatching is
/// smaller — one obligation was answered by mistake and the money should
/// answer something else — so this is the settlement-scoped cut of the same
/// act, keyed on the open item the settlement landed on. Rematching is an
/// unmatch and then an allocate, never a move: a failure halfway has to say
/// which half happened.
///
/// The entry's `outstanding_minor` needs no arithmetic here. It is generated
/// from the settlement rows (0143) and re-summed by trigger, so flipping
/// `delinked` IS the restore — the same reason [`ple_delink`] carries none.
pub async fn ple_unsettle(
    tx: &mut Transaction<'_, Postgres>,
    against_voucher_kind: &str,
    against_voucher_id: &str,
    entry_id: Uuid,
    reason: &str,
    actor: &str,
) -> Result<i64, AppError> {
    let kind = against_voucher_kind.trim();
    let voucher = against_voucher_id.trim();
    if kind.is_empty() || voucher.is_empty() {
        return Err(AppError::Validation(
            "unmatching needs the document whose allocation is being taken back".into(),
        ));
    }
    let why = reason.trim();
    if why.is_empty() {
        return Err(AppError::Validation(
            "unmatching needs a reason; it is the only record of why the money was pointed \
             somewhere else"
                .into(),
        ));
    }
    let row = sqlx::query(
        "UPDATE payment_ledger_settlement
            SET delinked=true, delinked_reason=$4, delinked_by=$5,
                delinked_at=now(), delinked_on=CURRENT_DATE
          WHERE against_voucher_kind=$1 AND against_voucher_id=$2
            AND entry_id=$3 AND NOT delinked
          RETURNING amount_minor",
    )
    .bind(kind)
    .bind(voucher)
    .bind(entry_id)
    .bind(why)
    .bind(actor)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(format!(
            "an open allocation by {kind} {voucher} against this obligation -- there is \
             nothing taken back to take back"
        ))
    })?;
    Ok(row.try_get("amount_minor")?)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

fn today() -> NaiveDate {
    Utc::now().date_naive()
}

/// What one control account has open, as at a date.
///
/// The number this lane exists to make comparable: it is what
/// `payment_ledger_integrity` puts beside the General Ledger balance of the
/// account the same triple maps to.
pub async fn ple_outstanding(
    pool: &PgPool,
    account_key: &str,
    unit_id: Option<&str>,
    qualifier: Option<&str>,
    as_of: Option<NaiveDate>,
) -> Result<PaymentLedgerOutstanding, AppError> {
    let when = as_of.unwrap_or_else(today);
    let key = account_key.trim().to_ascii_lowercase();
    let row = sqlx::query(
        "SELECT COUNT(*) FILTER (WHERE i.outstanding_minor <> 0)::bigint AS open_items,
                COALESCE(SUM(i.outstanding_minor), 0)::bigint AS outstanding
           FROM payment_ledger_as_of($1) i
          WHERE i.account_key = $2
            AND ($3::text IS NULL OR i.unit_id = $3)
            AND ($4::text IS NULL OR i.qualifier = $4)",
    )
    .bind(when)
    .bind(&key)
    .bind(unit_id)
    .bind(qualifier)
    .fetch_one(pool)
    .await?;
    Ok(PaymentLedgerOutstanding {
        account_key: key,
        unit_id: unit_id.map(str::to_string),
        qualifier: qualifier.map(str::to_string),
        as_of: when,
        open_items: row.try_get("open_items")?,
        outstanding_minor: row.try_get("outstanding")?,
    })
}

/// The open items a filter selects.
///
/// Ordered oldest first, which is the order somebody allocating a payment wants
/// them in and the order an ageing report reads.
pub async fn ple_open_items(
    pool: &PgPool,
    filter: &PaymentLedgerFilter,
) -> Result<Vec<PaymentLedgerEntry>, AppError> {
    let when = filter.as_of.unwrap_or_else(today);
    let sql = format!(
        "SELECT {AS_OF_COLUMNS}
           FROM payment_ledger_as_of($1) i
          WHERE ($2::text IS NULL OR i.account_key = $2)
            AND ($3::text IS NULL OR i.qualifier = $3)
            AND ($4::text IS NULL OR i.unit_id = $4)
            AND ($5::text IS NULL OR i.party_type = $5)
            AND ($6::text IS NULL OR i.party_id = $6)
            AND ($7::text IS NULL OR i.voucher_kind = $7)
            AND ($8::text IS NULL OR i.voucher_id = $8)
            AND ($9::text IS NULL OR i.side = $9)
            AND (NOT $10 OR i.outstanding_minor <> 0)
          ORDER BY i.age_days DESC, i.posting_date, i.entry_id
          LIMIT $11"
    );
    let rows = sqlx::query(&sql)
        .bind(when)
        .bind(
            filter
                .account_key
                .as_deref()
                .map(|key| key.trim().to_ascii_lowercase()),
        )
        .bind(filter.qualifier.as_deref())
        .bind(filter.unit_id.as_deref())
        .bind(filter.party_type.map(PaymentLedgerPartyType::as_str))
        .bind(filter.party_id.as_deref())
        .bind(filter.voucher_kind.as_deref())
        .bind(filter.voucher_id.as_deref())
        .bind(filter.side.map(PaymentLedgerSide::as_str))
        .bind(filter.open_only)
        .bind(filter.limit.clamp(1, 1_000))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_entry).collect()
}

fn buckets_of(totals: &AgingTotals) -> AgingBuckets {
    AgingBuckets {
        not_due_minor: totals.current_minor,
        days_1_30_minor: totals.days_1_30_minor,
        days_31_60_minor: totals.days_31_60_minor,
        days_61_90_minor: totals.days_61_90_minor,
        days_over_90_minor: totals.over_90_minor,
        total_minor: totals.total_minor,
    }
}

/// What is open, bucketed by age, per control account and per party inside it.
///
/// The rows come back one per item and the bucketing is done in Rust, by the
/// pure kernel, rather than by five `FILTER (WHERE ...)` clauses in SQL. That
/// is a deliberate trade: an open-item ledger is bounded by what has NOT been
/// settled, which is small, and the boundaries between "31–60" and "61–90" are
/// exactly the arithmetic somebody argues about at a month end — worth having
/// somewhere it can be tested exhaustively instead of read out of a query plan.
pub async fn payment_ledger_aging(
    pool: &PgPool,
    as_of: Option<NaiveDate>,
    filter: &PaymentLedgerFilter,
) -> Result<PaymentLedgerAging, AppError> {
    let when = as_of.or(filter.as_of).unwrap_or_else(today);
    let items = ple_open_items(
        pool,
        &PaymentLedgerFilter {
            as_of: Some(when),
            open_only: true,
            limit: 100_000,
            ..filter.clone()
        },
    )
    .await?;

    type Key = (String, String, String, String);
    let mut accounts: BTreeMap<Key, AgingTotals> = BTreeMap::new();
    let mut parties: BTreeMap<(Key, String, String), (Option<String>, AgingTotals)> =
        BTreeMap::new();
    let mut total = AgingTotals::default();

    for item in &items {
        let key: Key = (
            item.account_key.clone(),
            item.qualifier.clone(),
            item.unit_id.clone(),
            item.side.clone(),
        );
        let age = i64::from(item.age_days);
        accounts
            .entry(key.clone())
            .or_default()
            .add(age, item.outstanding_minor);
        let party = parties
            .entry((key, item.party_type.clone(), item.party_id.clone()))
            .or_insert_with(|| (item.party_name.clone(), AgingTotals::default()));
        if party.0.is_none() {
            party.0 = item.party_name.clone();
        }
        party.1.add(age, item.outstanding_minor);
        total.add(age, item.outstanding_minor);
    }

    let row = |key: &Key, party: Option<(&str, &str, Option<&str>)>, totals: &AgingTotals| {
        PaymentLedgerAgingRow {
            account_key: key.0.clone(),
            qualifier: key.1.clone(),
            unit_id: key.2.clone(),
            side: key.3.clone(),
            party_type: party.map(|(kind, _, _)| kind.to_string()),
            party_id: party.map(|(_, id, _)| id.to_string()),
            party_name: party.and_then(|(_, _, name)| name.map(str::to_string)),
            items: totals.items,
            oldest_days: totals.oldest_days.unwrap_or(0) as i32,
            buckets: buckets_of(totals),
        }
    };

    let mut account_rows: Vec<PaymentLedgerAgingRow> = accounts
        .iter()
        .map(|(key, totals)| row(key, None, totals))
        .collect();
    // Heaviest first: an ageing report is read to decide what to chase.
    account_rows.sort_by(|a, b| b.buckets.total_minor.cmp(&a.buckets.total_minor));

    let mut party_rows: Vec<PaymentLedgerAgingRow> = parties
        .iter()
        .map(|((key, kind, id), (name, totals))| {
            row(key, Some((kind, id, name.as_deref())), totals)
        })
        .collect();
    party_rows.sort_by(|a, b| b.buckets.total_minor.cmp(&a.buckets.total_minor));

    Ok(PaymentLedgerAging {
        as_of: when,
        unit_id: filter.unit_id.clone(),
        accounts: account_rows,
        parties: party_rows,
        total: buckets_of(&total),
    })
}

/// One party's open items and what they come to.
pub async fn payment_ledger_party(
    pool: &PgPool,
    party_type: PaymentLedgerPartyType,
    party_id: &str,
    as_of: Option<NaiveDate>,
    open_only: bool,
) -> Result<PaymentLedgerPartyStatement, AppError> {
    let when = as_of.unwrap_or_else(today);
    let items = ple_open_items(
        pool,
        &PaymentLedgerFilter {
            party_type: Some(party_type),
            party_id: Some(party_id.trim().to_string()),
            open_only,
            as_of: Some(when),
            limit: 1_000,
            ..Default::default()
        },
    )
    .await?;
    let mut totals = AgingTotals::default();
    for item in &items {
        if item.outstanding_minor != 0 {
            totals.add(i64::from(item.age_days), item.outstanding_minor);
        }
    }
    Ok(PaymentLedgerPartyStatement {
        party_type: party_type.as_str().to_string(),
        party_id: party_id.trim().to_string(),
        party_name: items.iter().find_map(|item| item.party_name.clone()),
        as_of: when,
        items,
        buckets: buckets_of(&totals),
        oldest_days: totals.oldest_days.unwrap_or(0) as i32,
    })
}

/// What a voucher settled, and what has been settled against it.
///
/// Both directions in one read, because they are the same table asked from two
/// ends and a screen showing a payment and a screen showing a bill each want
/// one of them.
pub async fn payment_ledger_settlements(
    pool: &PgPool,
    voucher_kind: &str,
    voucher_id: &str,
) -> Result<Vec<PaymentLedgerSettlementRow>, AppError> {
    let rows = sqlx::query(
        "SELECT s.settlement_id, s.entry_id,
                CASE WHEN s.against_voucher_kind = $1 AND s.against_voucher_id = $2
                     THEN 'SETTLED_BY' ELSE 'SETTLED' END AS role,
                e.voucher_kind, e.voucher_id, e.party_type, e.party_id,
                s.against_voucher_kind, s.against_voucher_id,
                s.amount_minor, s.journal_entry_id, s.posting_date,
                s.delinked, s.delinked_reason, s.created_at, s.created_by,
                (SELECT j.entry_number FROM journal_entry j WHERE j.entry_id = s.journal_entry_id)
                    AS entry_number
           FROM payment_ledger_settlement s
           JOIN payment_ledger_entry e ON e.entry_id = s.entry_id
          WHERE (s.against_voucher_kind = $1 AND s.against_voucher_id = $2)
             OR (e.voucher_kind = $1 AND e.voucher_id = $2)
          ORDER BY s.posting_date, s.created_at",
    )
    .bind(voucher_kind.trim())
    .bind(voucher_id.trim())
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(PaymentLedgerSettlementRow {
                settlement_id: row.try_get("settlement_id")?,
                entry_id: row.try_get("entry_id")?,
                role: row.try_get("role")?,
                voucher_kind: row.try_get("voucher_kind")?,
                voucher_id: row.try_get("voucher_id")?,
                against_voucher_kind: row.try_get("against_voucher_kind")?,
                against_voucher_id: row.try_get("against_voucher_id")?,
                party_type: row.try_get("party_type")?,
                party_id: row.try_get("party_id")?,
                amount_minor: row.try_get("amount_minor")?,
                journal_entry_id: row.try_get("journal_entry_id")?,
                entry_number: row.try_get("entry_number")?,
                posting_date: row.try_get("posting_date")?,
                delinked: row.try_get("delinked")?,
                delinked_reason: row.try_get("delinked_reason")?,
                created_at: row.try_get("created_at")?,
                created_by: row.try_get("created_by")?,
            })
        })
        .collect()
}

/// The Payment Ledger against the books, control account by control account.
///
/// The equation this lane exists to make checkable. It is reported and never
/// corrected: a sub-ledger that quietly adjusted itself to agree with the
/// general ledger would be no check at all, and one that adjusted the general
/// ledger would be a second writer.
pub async fn payment_ledger_integrity(
    pool: &PgPool,
    as_of: Option<NaiveDate>,
    unit_id: Option<&str>,
) -> Result<PaymentLedgerIntegrity, AppError> {
    let when = as_of.unwrap_or_else(today);
    let rows = sqlx::query("SELECT * FROM payment_ledger_integrity($1, $2)")
        .bind(when)
        .bind(unit_id)
        .fetch_all(pool)
        .await?;
    let rows: Vec<PaymentLedgerIntegrityRow> = rows
        .iter()
        .map(|row| {
            Ok(PaymentLedgerIntegrityRow {
                account_key: row.try_get("account_key")?,
                qualifier: row.try_get("qualifier")?,
                unit_id: row.try_get("unit_id")?,
                side: row.try_get("side")?,
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                open_items: row.try_get("open_items")?,
                ledger_outstanding_minor: row.try_get("ledger_outstanding_minor")?,
                gl_balance_minor: row.try_get("gl_balance_minor")?,
                difference_minor: row.try_get("difference_minor")?,
            })
        })
        .collect::<Result<_, AppError>>()?;
    let largest = rows
        .iter()
        .map(|row| row.difference_minor.abs())
        .max()
        .unwrap_or(0);
    Ok(PaymentLedgerIntegrity {
        as_of: when,
        unit_id: unit_id.map(str::to_string),
        agrees: largest == 0,
        largest_difference_minor: largest,
        rows,
    })
}


// ---------------------------------------------------------------------------
// A party's movements — 7Soft's Kartu Hutang, ERPNext's Supplier Ledger
// ---------------------------------------------------------------------------

/// One posting against a party, with the balance after it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PartyMovementRow {
    pub journal_line_id: Uuid,
    pub entry_id: Uuid,
    pub entry_number: String,
    pub posting_date: NaiveDate,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub account_code: String,
    pub account_name: String,
    pub unit_id: String,
    pub memo: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    /// What is owed to the party after this line: credits less debits, so a
    /// bill raises it and a payment or an advance lowers it.
    pub balance_minor: i64,
}

/// A party's movements over a window, opening and closing balance included.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PartyMovements {
    pub party_type: String,
    pub party_id: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub unit_id: Option<String>,
    pub opening_minor: i64,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub closing_minor: i64,
    pub rows: Vec<PartyMovementRow>,
}

/// Every journal line tagged with the party — the payable accounts and the
/// advance account alike, since an advance is money the party already holds —
/// read from the general ledger itself, so the balance here is the balance
/// the books carry and not a second opinion assembled from documents.
pub async fn party_movements(
    pool: &PgPool,
    party_type: &str,
    party_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    unit_id: Option<&str>,
) -> Result<PartyMovements, AppError> {
    if to < from {
        return Err(AppError::Validation(format!(
            "the window ends ({to}) before it starts ({from})"
        )));
    }
    let opening: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.credit_minor - l.debit_minor), 0)::bigint
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE l.party_type = $1 AND l.party_id = $2
            AND ($3::text IS NULL OR l.unit_id = $3)
            AND e.posting_date < $4",
    )
    .bind(party_type)
    .bind(party_id)
    .bind(unit_id)
    .bind(from)
    .fetch_one(pool)
    .await?;

    let lines = sqlx::query(
        "SELECT l.line_id, e.entry_id, e.entry_number, e.posting_date, e.source_kind,
                e.source_id, l.account_code, a.name AS account_name, l.unit_id,
                COALESCE(l.memo, e.memo, '') AS memo, l.debit_minor, l.credit_minor
           FROM journal_line l
           JOIN journal_entry e USING (entry_id)
           JOIN ledger_account a ON a.account_code = l.account_code
          WHERE l.party_type = $1 AND l.party_id = $2
            AND ($3::text IS NULL OR l.unit_id = $3)
            AND e.posting_date BETWEEN $4 AND $5
          ORDER BY e.posting_date, e.entry_number, l.line_number",
    )
    .bind(party_type)
    .bind(party_id)
    .bind(unit_id)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;

    let mut balance = opening;
    let mut debit_total = 0i64;
    let mut credit_total = 0i64;
    let mut rows = Vec::with_capacity(lines.len());
    for line in &lines {
        let debit: i64 = line.try_get("debit_minor")?;
        let credit: i64 = line.try_get("credit_minor")?;
        balance += credit - debit;
        debit_total += debit;
        credit_total += credit;
        rows.push(PartyMovementRow {
            journal_line_id: line.try_get("line_id")?,
            entry_id: line.try_get("entry_id")?,
            entry_number: line.try_get("entry_number")?,
            posting_date: line.try_get("posting_date")?,
            source_kind: line.try_get("source_kind")?,
            source_id: line.try_get("source_id")?,
            account_code: line.try_get("account_code")?,
            account_name: line.try_get("account_name")?,
            unit_id: line.try_get("unit_id")?,
            memo: line.try_get("memo")?,
            debit_minor: debit,
            credit_minor: credit,
            balance_minor: balance,
        });
    }
    Ok(PartyMovements {
        party_type: party_type.to_string(),
        party_id: party_id.to_string(),
        from,
        to,
        unit_id: unit_id.map(str::to_string),
        opening_minor: opening,
        debit_minor: debit_total,
        credit_minor: credit_total,
        closing_minor: balance,
        rows,
    })
}
