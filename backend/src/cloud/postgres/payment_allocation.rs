//! One place that presents allocation, for every pattern that allocates.
//!
//! # Allocation is the Payment Ledger's, and this is the surface over it
//!
//! The Payment Ledger holds the open items and does the bookkeeping —
//! `ple_open` raises a balance, `ple_settle` allocates against it, `ple_delink`
//! cancels one. None of that is repeated here and none of it may be: a second
//! place that wrote settlements would be a second answer to "what is still
//! open", and the two would agree until somebody reversed something.
//!
//! What this module owns is the SURFACE: the one shape a screen reads to offer
//! allocation, and the one shape it posts back. Six things have to be possible
//! on it, and they are listed here because a surface that supports five is a
//! surface somebody works around:
//!
//!   full          the payment answers one obligation exactly
//!   partial       it answers part of one
//!   several       it answers some of each of several
//!   remainder     it deliberately leaves money unallocated — an advance, a
//!                 round figure paid ahead of the bills. Permitted only when
//!                 the caller says so in as many words, because an accidental
//!                 remainder is the ordinary way a payment ends up answering
//!                 nothing
//!   reversal      the payment is undone, and its allocations with it
//!   unmatch       one allocation is taken back, leaving the payment and the
//!                 obligation both open again
//!
//! Rematch is unmatch followed by allocate, deliberately not a third verb: a
//! single "move this allocation" call would have to decide what happens if the
//! second half fails, and the honest answer is "the first half already
//! happened".
//!
//! # Why the arithmetic is here and the bookkeeping is not
//!
//! Working out that four allocations of 2,500,000 against a payment of
//! 9,000,000 leave 1,000,000 unallocated is arithmetic, and it belongs where
//! the refusal is written so the refusal can be a sentence. Writing those four
//! rows is bookkeeping, and it belongs in the ledger that owns the invariant
//! that they never exceed what is open.

use super::destinations::payment_destination_snapshot_for;
use crate::cloud::application::AppError;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// One obligation a payment could answer, as the screen offers it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllocationCandidate {
    pub obligation_kind: String,
    pub obligation_id: String,
    pub reference: String,
    pub due_date: Option<NaiveDate>,
    pub outstanding_minor: i64,
    /// What this payment has already put against it.
    pub allocated_minor: i64,
}

/// The whole allocation surface for one payment.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentAllocationSurface {
    /// `CASH_DOC`, `BATCH_ITEM`, `SUPPLIER_PAYMENT`.
    pub payment_kind: String,
    pub payment_id: String,
    pub party_type: Option<String>,
    pub party_id: Option<String>,
    pub party_name: Option<String>,
    /// What was paid, in total.
    pub amount_minor: i64,
    /// What is already pointed at something.
    pub allocated_minor: i64,
    /// What is not. Positive is money answering nothing; it is only allowed to
    /// stay that way when somebody says it is an advance.
    pub unallocated_minor: i64,
    /// Whether a remainder has been accepted deliberately.
    pub remainder_permitted: bool,
    pub remainder_reason: Option<String>,
    /// What is still open for this party.
    pub candidates: Vec<AllocationCandidate>,
    /// What was paid to, frozen. Shown on the same screen because "did this go
    /// to the right account" and "did it answer the right bill" are asked
    /// together.
    pub paid_to_bank: Option<String>,
    pub paid_to_account_mask: Option<String>,
    pub paid_to_verification_status: Option<String>,
    /// Set when the Payment Ledger is not in this build. The surface still
    /// reads; nothing may be written through it.
    pub ledger_available: bool,
    pub notes: Vec<String>,
}

/// One line of what somebody wants allocated.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllocationLine {
    pub obligation_kind: String,
    pub obligation_id: String,
    pub amount_minor: i64,
}

/// What somebody wants done to a payment's allocations.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentAllocationRequest {
    /// `ALLOCATE`, `UNMATCH` or `REVERSE`.
    pub action: String,
    /// The lines to allocate, for ALLOCATE. For UNMATCH, the ones to take back
    /// — the amount is ignored and the whole allocation against that obligation
    /// goes.
    #[serde(default)]
    pub lines: Vec<AllocationLine>,
    /// Say so, and say why, to leave money answering nothing.
    #[serde(default)]
    pub permit_remainder: bool,
    pub remainder_reason: Option<String>,
    /// Required for REVERSE.
    pub reason: Option<String>,
}

/// Whether the Payment Ledger is in this database.
async fn ledger_present(pool: &PgPool) -> bool {
    let found: Result<Option<String>, _> =
        sqlx::query_scalar("SELECT to_regclass('public.payment_ledger_entry')::text")
            .fetch_one(pool)
            .await;
    matches!(found, Ok(Some(_)))
}

/// What a payment was and what it has answered so far.
async fn payment_facts(
    pool: &PgPool,
    payment_kind: &str,
    payment_id: &str,
) -> Result<(i64, Option<String>, Option<String>, Option<String>), AppError> {
    match payment_kind {
        "BATCH_ITEM" => {
            let id = Uuid::parse_str(payment_id)
                .map_err(|_| AppError::Validation(format!("'{payment_id}' is not an item's id")))?;
            let row = sqlx::query(
                "SELECT amount_minor, party_type, party_id, party_name
                   FROM payment_batch_item WHERE item_id = $1",
            )
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("payment batch item".into()))?;
            Ok((
                row.try_get("amount_minor")?,
                row.try_get("party_type")?,
                row.try_get("party_id")?,
                row.try_get("party_name")?,
            ))
        }
        "SUPPLIER_PAYMENT" => {
            let id = Uuid::parse_str(payment_id).map_err(|_| {
                AppError::Validation(format!("'{payment_id}' is not a payment's id"))
            })?;
            let row = sqlx::query(
                "SELECT amount_minor, supplier_id FROM supplier_payment WHERE payment_id = $1",
            )
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("supplier payment".into()))?;
            let supplier: String = row.try_get("supplier_id")?;
            Ok((
                row.try_get("amount_minor")?,
                Some("SUPPLIER".into()),
                Some(supplier.clone()),
                Some(supplier),
            ))
        }
        // A cash document is the third shape, and it lands with the money
        // layer. Reading it here would be reading another lane's table for a
        // figure it has not agreed to publish yet.
        other => Err(AppError::Validation(format!(
            "'{other}' is not a payment this surface knows how to read; expected BATCH_ITEM or \
             SUPPLIER_PAYMENT"
        ))),
    }
}

/// What has already been put against bills by this payment.
///
/// Reads `supplier_payment_allocation`, which is where allocation lives in this
/// build. When the Payment Ledger lands this becomes a read of
/// `payment_ledger_settlement` keyed on `(against_voucher_kind,
/// against_voucher_id)` — the same question, asked of the ledger that will own
/// the answer for every party type rather than only for suppliers.
async fn allocated_so_far(
    pool: &PgPool,
    payment_kind: &str,
    payment_id: &str,
) -> Result<Vec<(String, i64)>, AppError> {
    if payment_kind != "SUPPLIER_PAYMENT" {
        return Ok(Vec::new());
    }
    let Ok(id) = Uuid::parse_str(payment_id) else {
        return Ok(Vec::new());
    };
    let rows = sqlx::query(
        "SELECT invoice_id, SUM(amount_minor)::bigint AS allocated
           FROM supplier_payment_allocation WHERE payment_id = $1
          GROUP BY invoice_id",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let invoice: Uuid = row.try_get("invoice_id")?;
            Ok((invoice.to_string(), row.try_get("allocated")?))
        })
        .collect()
}

/// The whole surface for one payment.
pub async fn payment_allocation_surface(
    pool: &PgPool,
    payment_kind: &str,
    payment_id: &str,
) -> Result<PaymentAllocationSurface, AppError> {
    let kind = payment_kind.trim().to_ascii_uppercase();
    let (amount_minor, party_type, party_id, party_name) =
        payment_facts(pool, &kind, payment_id).await?;

    let already = allocated_so_far(pool, &kind, payment_id).await?;
    let allocated_minor: i64 = already.iter().map(|(_, amount)| *amount).sum();

    let mut candidates = Vec::new();
    if party_type.as_deref() == Some("SUPPLIER") {
        if let Some(supplier) = party_id.as_deref() {
            for obligation in super::payment_context::payment_context_open_bills(pool, supplier)
                .await?
                .into_iter()
            {
                let allocated = already
                    .iter()
                    .find(|(id, _)| id == &obligation.id)
                    .map_or(0, |(_, amount)| *amount);
                candidates.push(AllocationCandidate {
                    obligation_kind: obligation.kind,
                    obligation_id: obligation.id,
                    reference: obligation.reference,
                    due_date: obligation.due_date,
                    outstanding_minor: obligation.outstanding_minor,
                    allocated_minor: allocated,
                });
            }
        }
    }

    let snapshot = payment_destination_snapshot_for(pool, &kind, payment_id).await?;
    let ledger_available = ledger_present(pool).await;
    let mut notes = Vec::new();
    if !ledger_available {
        notes.push(
            "The Payment Ledger is not in this build, so this surface reads and does not write. \
             Allocation is that ledger's bookkeeping and is not repeated here"
                .into(),
        );
    }
    if candidates.is_empty() && amount_minor > allocated_minor {
        notes.push(
            "There is nothing open for this party, so anything unallocated here is an advance — \
             money out ahead of a bill. That is a real thing to record and it has to be said \
             deliberately"
                .into(),
        );
    }

    Ok(PaymentAllocationSurface {
        payment_kind: kind,
        payment_id: payment_id.to_string(),
        party_type,
        party_id,
        party_name,
        amount_minor,
        allocated_minor,
        unallocated_minor: amount_minor - allocated_minor,
        remainder_permitted: false,
        remainder_reason: None,
        candidates,
        paid_to_bank: snapshot.as_ref().map(|s| s.bank_name.clone()),
        paid_to_account_mask: snapshot.as_ref().map(|s| s.account_number_mask.clone()),
        paid_to_verification_status: snapshot.map(|s| s.verification_status),
        ledger_available,
        notes,
    })
}

/// Check what somebody asked for, then hand it to the ledger that owns it.
///
/// Everything before the last call is arithmetic and refusals — the part that
/// has to say a sentence when it says no. The last call is the bookkeeping, and
/// it is one line on purpose.
pub async fn payment_allocation_apply(
    pool: &PgPool,
    payment_kind: &str,
    payment_id: &str,
    request: &PaymentAllocationRequest,
    actor: &str,
) -> Result<PaymentAllocationSurface, AppError> {
    let surface = payment_allocation_surface(pool, payment_kind, payment_id).await?;
    let action = request.action.trim().to_ascii_uppercase();

    match action.as_str() {
        "ALLOCATE" => {
            if request.lines.is_empty() {
                return Err(AppError::Validation(
                    "an allocation has to say what it answers".into(),
                ));
            }
            let mut asked = 0i64;
            for line in &request.lines {
                if line.amount_minor <= 0 {
                    return Err(AppError::Validation(format!(
                        "{} is not an amount to allocate; take the line out rather than \
                         allocating nothing to it",
                        line.amount_minor
                    )));
                }
                let candidate = surface
                    .candidates
                    .iter()
                    .find(|c| c.obligation_id == line.obligation_id)
                    .ok_or_else(|| {
                        AppError::Validation(format!(
                            "{} is not open for this party, so this payment cannot answer it",
                            line.obligation_id
                        ))
                    })?;
                if line.amount_minor > candidate.outstanding_minor {
                    return Err(AppError::Validation(format!(
                        "{} has {} outstanding and this would put {} against it. Over-settling \
                         turns a bill into a balance the supplier owes us, which is a credit \
                         note and not a payment",
                        candidate.reference, candidate.outstanding_minor, line.amount_minor
                    )));
                }
                asked += line.amount_minor;
            }
            if asked > surface.unallocated_minor {
                return Err(AppError::Validation(format!(
                    "this payment has {} left to allocate and these lines come to {}",
                    surface.unallocated_minor, asked
                )));
            }
            let remainder = surface.unallocated_minor - asked;
            if remainder > 0 && !request.permit_remainder {
                return Err(AppError::Validation(format!(
                    "{remainder} would be left answering nothing. That is a real thing — money \
                     out ahead of a bill — but it has to be said deliberately, because an \
                     accidental remainder is how a payment ends up settling nothing and the \
                     ageing goes on showing the debt"
                )));
            }
            if remainder > 0
                && request
                    .remainder_reason
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty()
            {
                return Err(AppError::Validation(
                    "say why money is being left unallocated; it is the only record of what the \
                     advance was for"
                        .into(),
                ));
            }
            settle_through_payment_ledger(pool, &surface, request, actor).await?;
        }
        "UNMATCH" => {
            if request.lines.is_empty() {
                return Err(AppError::Validation(
                    "say which allocation is being taken back".into(),
                ));
            }
            settle_through_payment_ledger(pool, &surface, request, actor).await?;
        }
        "REVERSE" => {
            if request
                .reason
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
            {
                return Err(AppError::Validation(
                    "a reversal needs a reason; it is the only record of why".into(),
                ));
            }
            settle_through_payment_ledger(pool, &surface, request, actor).await?;
        }
        other => {
            return Err(AppError::Validation(format!(
                "'{other}' is not something to do to an allocation; expected ALLOCATE, UNMATCH \
                 or REVERSE. Rematching is an UNMATCH and then an ALLOCATE, so that a failure \
                 halfway says which half happened"
            )))
        }
    }

    payment_allocation_surface(pool, payment_kind, payment_id).await
}

/// The one call into the ledger that owns allocation.
///
/// # The seam
///
/// The Payment Ledger lands in a sibling lane. When the two are in one tree,
/// this becomes three lines and nothing above it changes:
///
/// ```text
/// "ALLOCATE" => ple_settle(&mut tx, &SettlementIntent { .. }, actor).await?,
/// "UNMATCH"  => ple_settle(&mut tx, &SettlementIntent { negative lines }, actor).await?,
/// "REVERSE"  => ple_delink(&mut tx, entry_id, reason, actor).await?,
/// ```
///
/// with `against_voucher_kind` = this payment's kind and `against_voucher_id`
/// its id. The refusals above stay where they are: `ple_settle` refuses
/// over-settlement as an invariant, and this refuses it as a sentence somebody
/// can act on, which is the same arrangement `poster::check_balanced` has with
/// the deferred balance trigger.
async fn settle_through_payment_ledger(
    pool: &PgPool,
    surface: &PaymentAllocationSurface,
    _request: &PaymentAllocationRequest,
    _actor: &str,
) -> Result<(), AppError> {
    if !ledger_present(pool).await {
        return Err(AppError::Configuration(format!(
            "this node has no Payment Ledger, so nothing can be allocated against {} {}. \
             Allocation is that ledger's bookkeeping and this surface will not write a second \
             copy of it",
            surface.payment_kind, surface.payment_id
        )));
    }
    Err(AppError::Configuration(
        "the Payment Ledger is present but this build has not been rebuilt against it; \
         allocation writes go through ple_settle and ple_delink and through nothing else"
            .into(),
    ))
}
