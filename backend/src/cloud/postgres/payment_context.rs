//! What screen this payment gets, answered once, by the server.
//!
//! # The rule this endpoint exists to enforce
//!
//! The frontend must never pick a payment pattern by guessing which domain the
//! thing came from. A bill opened from Payables and the same bill opened from a
//! supplier's page have to get the same screen, and the day a fourth place
//! links to a bill it has to get that screen too without anybody remembering to
//! add a branch.
//!
//! So there is one endpoint. It is handed a source — a bill, a supplier, a
//! payroll run, a float, a bank-to-bank move, an incoming settlement, a giro —
//! and it answers with the pattern to render and everything that pattern needs
//! to render it: the party, the obligations, the accounts money may go to, the
//! ways it may be paid, the amount to put in the box and the date it is due.
//!
//! # Why the choosing is not in this file
//!
//! It is in `domain::payment`, which is pure and has no database. This module
//! reads rows and reduces them to a `PaymentSourceShape`; the kernel turns that
//! shape into a pattern. The split is what lets the whole table of cases be
//! checked exhaustively without a Postgres, and what stops the rule acquiring a
//! sixteenth special case that only one screen knows about.
//!
//! # What is here and what is a seam
//!
//! Bills, suppliers, batches, giro-on-a-bill and bank-to-bank all resolve
//! against tables this build has. A payroll run and a store manager's float
//! resolve to the right pattern with the right party and an empty obligation
//! list, because the tables that would fill it — a payroll payable, a custodian
//! receivable — are being added elsewhere. Each of those says so in `notes`,
//! which is a field the screen shows rather than a comment nobody reads.

use super::destinations::{payment_destination_list, PaymentDestinationRow};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    payment_pattern_for, PaymentDirection, PaymentPattern, PaymentSourceShape,
};
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// One thing a payment answers.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentObligation {
    /// `BILL`, `PAYROLL_SLIP`, `FUND_ALLOCATION`.
    pub kind: String,
    pub id: String,
    /// What the recipient will recognise: an invoice number, a period.
    pub reference: String,
    pub site_id: String,
    pub due_date: Option<NaiveDate>,
    pub total_minor: i64,
    pub outstanding_minor: i64,
    pub days_overdue: i32,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentContextParty {
    /// `SUPPLIER`, `EMPLOYEE` or `OTHER`.
    pub party_type: String,
    pub party_id: String,
    pub party_name: String,
}

/// Everything a payment screen needs, decided by the server.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentContext {
    pub source_kind: String,
    pub source_id: String,
    /// What to render. The frontend switches on this and on nothing else.
    pub pattern: PaymentPattern,
    /// `PAY`, `RECEIVE` or `TRANSFER` — which of the three primitives this
    /// executes as. There is no fourth, and no per-domain engine.
    pub primitive: String,
    /// Whether the allocation surface belongs on this screen.
    pub allocates: bool,
    /// What the screen is called after: the bill's number, the supplier's name.
    pub source_label: String,
    /// Whose books the payment would leave, when the source says (0606): the
    /// unit owning the bill's site, the batch's unit.
    pub unit_id: Option<String>,
    pub party: Option<PaymentContextParty>,
    pub obligations: Vec<PaymentObligation>,
    /// The accounts this party's money may go to. Empty is a real answer and
    /// the screen has to handle it: it means nobody has recorded where to pay
    /// them.
    pub recipients: Vec<PaymentDestinationRow>,
    /// `BANK_TRANSFER`, `CASH`, `GIRO`.
    pub allowed_methods: Vec<String>,
    /// What to put in the amount box.
    pub default_amount_minor: i64,
    pub due_date: Option<NaiveDate>,
    /// Sentences the screen shows. Where a pattern is right but the data behind
    /// it is not here yet, this is what says so.
    pub notes: Vec<String>,
}

/// The ways a pattern may be paid.
///
/// Not a free choice and not a per-screen list. A transfer between our own
/// accounts is never a giro — a giro is an instrument given to somebody else —
/// and a custodian float is handed over in cash as often as not.
fn methods_for(pattern: PaymentPattern) -> Vec<String> {
    match pattern {
        PaymentPattern::GiroPayment => vec!["GIRO".into()],
        PaymentPattern::MoneyTransfer => vec!["BANK_TRANSFER".into(), "CASH".into()],
        PaymentPattern::FundCustodian => vec!["BANK_TRANSFER".into(), "CASH".into()],
        PaymentPattern::ReceiveMoney => vec!["BANK_TRANSFER".into(), "CASH".into()],
        _ => vec!["BANK_TRANSFER".into(), "CASH".into(), "GIRO".into()],
    }
}

/// Every posted bill this supplier still owes on.
///
/// Counted over posted bills and posted payments, the way `payables` counts
/// them, so this screen and the ageing cannot disagree about who is owed what.
/// The cast on `outstanding_minor` below is load-bearing. `SUM(bigint)` is
/// `numeric` in Postgres, so without it the whole expression comes back numeric
/// and decoding it as an `i64` fails inside the driver — which reaches a person
/// as a flat database failure naming neither the column nor the reason.
async fn open_bills(
    pool: &PgPool,
    supplier_id: Option<&str>,
    invoice_id: Option<Uuid>,
) -> Result<Vec<PaymentObligation>, AppError> {
    let rows = sqlx::query(
        "SELECT i.invoice_id, i.invoice_number, i.site_id, i.due_date, i.total_minor,
                (i.total_minor - COALESCE((
                    SELECT SUM(al.amount_minor)
                      FROM supplier_payment_allocation al
                      JOIN supplier_payment p USING (payment_id)
                     WHERE al.invoice_id = i.invoice_id AND p.status = 'POSTED'), 0))::bigint
                    AS outstanding_minor,
                GREATEST(0, CURRENT_DATE - i.due_date)::int AS days_overdue
           FROM supplier_invoice i
          WHERE i.status = 'POSTED'
            -- A held bill is not offered for payment (brief §8.4). It is still
            -- owed, and the ageing counts it separately, but it does not belong
            -- on a screen whose whole purpose is choosing what to pay now.
            AND NOT i.on_hold
            -- A vendor whose every recorded bank account is still UNVERIFIED
            -- cannot be paid by transfer, so its bills wait until Finance
            -- verifies one. A vendor with NO bank account at all is KEPT: the
            -- pajak daerah offices send no bank channel and are paid another
            -- way, and dropping them would quietly hide a real debt.
            AND (
                NOT EXISTS (
                    SELECT 1 FROM bank_account b
                     WHERE NOT b.is_company_account
                       AND b.party_type = 'SUPPLIER'
                       AND b.party_id = i.supplier_id
                       AND b.active)
                OR EXISTS (
                    SELECT 1 FROM bank_account b
                     WHERE NOT b.is_company_account
                       AND b.party_type = 'SUPPLIER'
                       AND b.party_id = i.supplier_id
                       AND b.active
                       AND b.verification_status IS DISTINCT FROM 'UNVERIFIED')
            )
            AND ($1::text IS NULL OR i.supplier_id = $1)
            AND ($2::uuid IS NULL OR i.invoice_id = $2)
          ORDER BY i.due_date NULLS LAST, i.invoice_date",
    )
    .bind(supplier_id)
    .bind(invoice_id)
    .fetch_all(pool)
    .await?;

    let mut open = Vec::new();
    for row in &rows {
        let outstanding: i64 = row.try_get("outstanding_minor")?;
        if outstanding <= 0 {
            continue;
        }
        let id: Uuid = row.try_get("invoice_id")?;
        open.push(PaymentObligation {
            kind: "BILL".into(),
            id: id.to_string(),
            reference: row.try_get("invoice_number")?,
            site_id: row.try_get("site_id")?,
            due_date: row.try_get("due_date")?,
            total_minor: row.try_get("total_minor")?,
            outstanding_minor: outstanding,
            days_overdue: row.try_get::<Option<i32>, _>("days_overdue")?.unwrap_or(0),
        });
    }
    Ok(open)
}

/// The open bills for one party, for a caller outside this module.
///
/// The allocation surface asks the same question this module asks, and asking
/// it twice in two places is how two screens come to disagree about what is
/// still owed.
pub(super) async fn payment_context_open_bills(
    pool: &PgPool,
    supplier_id: &str,
) -> Result<Vec<PaymentObligation>, AppError> {
    open_bills(pool, Some(supplier_id), None).await
}

async fn supplier_name(pool: &PgPool, supplier_id: &str) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT supplier_name FROM supplier_invoice
          WHERE supplier_id = $1 AND supplier_name IS NOT NULL
          ORDER BY invoice_date DESC LIMIT 1",
    )
    .bind(supplier_id)
    .fetch_optional(pool)
    .await?
    .flatten();
    Ok(name.unwrap_or_else(|| supplier_id.to_string()))
}

/// The one endpoint the frontend calls.
///
/// `source_kind` is the caller's own word for what it is holding, and the list
/// is closed: an unknown kind is refused with the seven that are understood,
/// rather than falling through to a default that would be a pattern nobody
/// chose.
pub async fn payment_context_resolve(
    pool: &PgPool,
    source_kind: &str,
    source_id: &str,
) -> Result<PaymentContext, AppError> {
    let kind = source_kind.trim().to_ascii_uppercase();
    let id = source_id.trim();
    if id.is_empty() {
        return Err(AppError::Validation(
            "a payment context needs something to be about".into(),
        ));
    }

    match kind.as_str() {
        "BILL" | "GIRO" => bill_context(pool, &kind, id).await,
        "SUPPLIER" => supplier_context(pool, id).await,
        "BATCH" => batch_context(pool, id).await,
        "PAYROLL_RUN" => payroll_context(pool, id).await,
        "FUND_ALLOCATION" => fund_context(pool, id).await,
        "BANK_TRANSFER" => transfer_context(id),
        "SETTLEMENT" => settlement_context(pool, id).await,
        other => Err(AppError::Validation(format!(
            "'{other}' is not something a payment can be about. The seven are BILL, SUPPLIER, \
             BATCH, PAYROLL_RUN, FUND_ALLOCATION, BANK_TRANSFER and SETTLEMENT — and GIRO, \
             which is a bill paid on paper"
        ))),
    }
}

/// One bill, or one bill paid on paper.
async fn bill_context(pool: &PgPool, kind: &str, id: &str) -> Result<PaymentContext, AppError> {
    let invoice_id = Uuid::parse_str(id)
        .map_err(|_| AppError::Validation(format!("'{id}' is not a bill's id")))?;
    let row = sqlx::query(
        "SELECT invoice_number, supplier_id, supplier_name, site_id FROM supplier_invoice
          WHERE invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("bill".into()))?;
    let supplier_id: String = row.try_get("supplier_id")?;
    let supplier_name: Option<String> = row.try_get("supplier_name")?;
    let invoice_number: String = row.try_get("invoice_number")?;
    let site_id: String = row.try_get("site_id")?;
    let unit_id = super::sites::unit_of_site(pool, &site_id).await?;

    let obligations = open_bills(pool, None, Some(invoice_id)).await?;
    let on_instrument = kind == "GIRO";
    let shape = PaymentSourceShape {
        on_instrument,
        ..PaymentSourceShape::paying(obligations.len())
    };
    let pattern = payment_pattern_for(shape);
    let recipients =
        payment_destination_list(pool, Some("SUPPLIER"), Some(&supplier_id), false, 50).await?;

    let mut notes = Vec::new();
    if obligations.is_empty() {
        notes.push(format!(
            "{invoice_number} has nothing outstanding on it. Paying anyway records an advance, \
             which is a real thing to do and not the usual one"
        ));
    }
    if recipients.is_empty() {
        notes.push(
            "Nobody has recorded a bank account for this supplier, so this can only be paid in \
             cash until one is added and verified"
                .into(),
        );
    }

    let default_amount_minor = obligations.iter().map(|o| o.outstanding_minor).sum();
    let due_date = obligations.iter().filter_map(|o| o.due_date).min();
    Ok(PaymentContext {
        source_kind: kind.to_string(),
        source_id: id.to_string(),
        primitive: pattern.primitive().into(),
        allocates: pattern.allocates(),
        pattern,
        source_label: invoice_number,
        unit_id: Some(unit_id),
        party: Some(PaymentContextParty {
            party_type: "SUPPLIER".into(),
            party_name: supplier_name.unwrap_or_else(|| supplier_id.clone()),
            party_id: supplier_id,
        }),
        obligations,
        allowed_methods: methods_for(pattern),
        recipients,
        default_amount_minor,
        due_date,
        notes,
    })
}

/// Everything one supplier is owed.
async fn supplier_context(pool: &PgPool, supplier_id: &str) -> Result<PaymentContext, AppError> {
    let obligations = open_bills(pool, Some(supplier_id), None).await?;
    let pattern = payment_pattern_for(PaymentSourceShape::paying(obligations.len()));
    let name = supplier_name(pool, supplier_id).await?;
    let recipients =
        payment_destination_list(pool, Some("SUPPLIER"), Some(supplier_id), false, 50).await?;

    let mut notes = Vec::new();
    if obligations.is_empty() {
        notes.push(format!("{name} has no open bills."));
    }
    let default_amount_minor = obligations.iter().map(|o| o.outstanding_minor).sum();
    let due_date = obligations.iter().filter_map(|o| o.due_date).min();
    let unit_id = match obligations.first() {
        Some(first) => Some(super::sites::unit_of_site(pool, &first.site_id).await?),
        None => None,
    };
    Ok(PaymentContext {
        source_kind: "SUPPLIER".into(),
        source_id: supplier_id.to_string(),
        primitive: pattern.primitive().into(),
        allocates: pattern.allocates(),
        pattern,
        source_label: name.clone(),
        unit_id,
        party: Some(PaymentContextParty {
            party_type: "SUPPLIER".into(),
            party_id: supplier_id.to_string(),
            party_name: name,
        }),
        obligations,
        allowed_methods: methods_for(pattern),
        recipients,
        default_amount_minor,
        due_date,
        notes,
    })
}

/// A batch already built, reopened.
async fn batch_context(pool: &PgPool, id: &str) -> Result<PaymentContext, AppError> {
    let batch_id = Uuid::parse_str(id)
        .map_err(|_| AppError::Validation(format!("'{id}' is not a batch's id")))?;
    let row = sqlx::query(
        "SELECT b.memo, b.unit_id, b.method, b.total_minor, b.doc_date, b.status,
                (SELECT COUNT(DISTINCT (i.party_type, i.party_id)) FROM payment_batch_item i
                  WHERE i.batch_id = b.batch_id)::int AS recipients,
                (SELECT COUNT(*) FROM payment_batch_item i
                  WHERE i.batch_id = b.batch_id AND i.obligation_id IS NOT NULL)::int
                    AS obligations
           FROM payment_batch b WHERE b.batch_id = $1",
    )
    .bind(batch_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("payment batch".into()))?;

    let recipients: i32 = row.try_get("recipients")?;
    let obligations: i32 = row.try_get("obligations")?;
    let method: String = row.try_get("method")?;
    let shape = PaymentSourceShape {
        on_instrument: method == "GIRO",
        recipients: recipients.max(0) as usize,
        obligations: obligations.max(0) as usize,
        ..PaymentSourceShape::paying(0)
    };
    let pattern = payment_pattern_for(shape);
    Ok(PaymentContext {
        source_kind: "BATCH".into(),
        source_id: id.to_string(),
        primitive: pattern.primitive().into(),
        allocates: pattern.allocates(),
        pattern,
        source_label: row.try_get("memo")?,
        unit_id: Some(row.try_get("unit_id")?),
        party: None,
        obligations: Vec::new(),
        recipients: Vec::new(),
        allowed_methods: vec![method],
        default_amount_minor: row.try_get("total_minor")?,
        due_date: Some(row.try_get("doc_date")?),
        notes: vec![format!(
            "{recipients} recipients, {}. Each one becomes an ordinary payment document of its \
             own; the batch itself posts nothing",
            row.try_get::<String, _>("status")?.to_lowercase()
        )],
    })
}

/// A sealed payroll run, waiting to be paid.
///
/// # The seam a sealed payroll run will use
///
/// Payroll is not a consumer of this yet, and the reason is a fact about the
/// schema rather than an opinion: `payroll_slip` stores what happened — base
/// pay, fixed allowances, leave days, overtime minutes, rostered days — and no
/// net pay; payroll posts nothing to the ledger; and employees have no payment
/// destinations because HR has nowhere to put one. Three things have to arrive
/// before a run can be paid, and none of them is in this lane:
///
///   1. a net figure per slip, sealed with the run;
///   2. a payable posted for it, which is what puts it in the Payment Ledger;
///   3. an employee destination, owned by HR.
///
/// The third is nearer than it looks and worth naming: `payroll_identity`
/// (0105) already holds `bank_name`, `bank_account` and `bank_holder` for an
/// employee, whole, masked only on the way out. That is an employee payment
/// destination in everything but the table it is in — unencrypted, unverified,
/// with no history and no snapshot. Bringing those rows across into
/// `payment_destination` with `owner_domain = 'HR'` is the smallest version of
/// step three, and it is HR's task rather than this lane's because the writing
/// screen has to move with them.
///
/// When they do, this function reads the sealed run and returns one
/// `PaymentObligation` per slip with `kind = "PAYROLL_SLIP"`, and the batch is
/// built by handing those to `payment_batch_create` with `source_kind =
/// "PAYROLL_RUN"`, `source_id` = the run, `counter_key` = the payroll payable's
/// meaning and `unverified_policy = HOLD`. Nothing else changes: twenty slips
/// become twenty ordinary PAY documents, and no payroll payment engine is
/// built, because there is nothing for one to do that the batch does not.
async fn payroll_context(pool: &PgPool, id: &str) -> Result<PaymentContext, AppError> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM payroll_slip WHERE run_id::text = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .unwrap_or(0);

    let shape = PaymentSourceShape {
        recipients: (count.max(2)) as usize,
        obligations: count.max(0) as usize,
        ..PaymentSourceShape::paying(0)
    };
    let pattern = payment_pattern_for(shape);
    Ok(PaymentContext {
        source_kind: "PAYROLL_RUN".into(),
        source_id: id.to_string(),
        primitive: pattern.primitive().into(),
        allocates: pattern.allocates(),
        pattern,
        source_label: format!("payroll run {id}"),
        unit_id: None,
        party: None,
        obligations: Vec::new(),
        recipients: Vec::new(),
        allowed_methods: methods_for(pattern),
        default_amount_minor: 0,
        due_date: None,
        notes: vec![
            format!("{count} slips in this run."),
            "A payroll run cannot be paid yet: a slip records what happened and not a net \
             figure, nothing posts a payroll payable, and employees have no bank accounts on \
             file because HR has nowhere to put one. The pattern is right and the obligations \
             are empty until those three arrive"
                .into(),
        ],
    })
}

/// Money handed to somebody who will account for it later.
///
/// Head office sending a store manager a float — Piutang Kepala Toko in the
/// client's own words. It leaves the bank and stays the company's money, which
/// is why it is its own pattern and not a payment: nobody is owed anything, and
/// what comes back is an accounting rather than a settlement.
async fn fund_context(pool: &PgPool, id: &str) -> Result<PaymentContext, AppError> {
    let shape = PaymentSourceShape {
        custodial: true,
        ..PaymentSourceShape::paying(0)
    };
    let pattern = payment_pattern_for(shape);
    // `id` is the custodian: an employee, or a site whose manager holds it.
    let recipients = payment_destination_list(pool, Some("EMPLOYEE"), Some(id), false, 20).await?;
    Ok(PaymentContext {
        source_kind: "FUND_ALLOCATION".into(),
        source_id: id.to_string(),
        primitive: pattern.primitive().into(),
        allocates: pattern.allocates(),
        pattern,
        source_label: format!("float for {id}"),
        unit_id: None,
        party: None,
        obligations: Vec::new(),
        recipients,
        allowed_methods: methods_for(pattern),
        default_amount_minor: 0,
        due_date: None,
        notes: vec![
            "A float answers no debt, so there is nothing to allocate it against. What it \
             leaves behind is a balance the custodian has to account for, which the Payment \
             Ledger follows as a receivable rather than a payment"
                .into(),
        ],
    })
}

/// Between two accounts the company holds. Nobody is paid.
///
/// `id` is the unit whose books the two accounts are in (0605: a bank account
/// is a unit's).
fn transfer_context(id: &str) -> Result<PaymentContext, AppError> {
    let shape = PaymentSourceShape {
        between_own_accounts: true,
        ..PaymentSourceShape::paying(0)
    };
    let pattern = payment_pattern_for(shape);
    Ok(PaymentContext {
        source_kind: "BANK_TRANSFER".into(),
        source_id: id.to_string(),
        primitive: pattern.primitive().into(),
        allocates: pattern.allocates(),
        pattern,
        source_label: format!("transfer in the books of {id}"),
        unit_id: Some(id.to_string()),
        party: None,
        // Empty, and that is the assertion rather than an absence of data: a
        // transfer has no obligations and no recipients because nobody is owed
        // anything and nobody outside the company receives it. A screen that
        // offered allocation here would let somebody point a bank transfer at a
        // supplier's bills.
        obligations: Vec::new(),
        recipients: Vec::new(),
        allowed_methods: methods_for(pattern),
        default_amount_minor: 0,
        due_date: None,
        notes: vec![
            "Money moving between two accounts we hold. It leaves nothing open, so it writes \
             nothing to the Payment Ledger — that ledger follows balances somebody has to \
             settle, and this is not one"
                .into(),
        ],
    })
}

/// Money arriving.
async fn settlement_context(pool: &PgPool, id: &str) -> Result<PaymentContext, AppError> {
    let shape = PaymentSourceShape {
        direction: PaymentDirection::In,
        ..PaymentSourceShape::paying(0)
    };
    let pattern = payment_pattern_for(shape);
    let recipients = payment_destination_list(pool, Some("OTHER"), Some(id), false, 20).await?;
    Ok(PaymentContext {
        source_kind: "SETTLEMENT".into(),
        source_id: id.to_string(),
        primitive: pattern.primitive().into(),
        allocates: pattern.allocates(),
        pattern,
        source_label: format!("settlement {id}"),
        unit_id: None,
        party: None,
        obligations: Vec::new(),
        recipients,
        allowed_methods: methods_for(pattern),
        default_amount_minor: 0,
        due_date: None,
        notes: vec![
            "Money arriving. What it settles is a receivable in the Payment Ledger — a card \
             acquirer's, a customer's — and the allocation surface is the same one a payment \
             uses, read from the other side"
                .into(),
        ],
    })
}
