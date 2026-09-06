//! Paying a supplier: recording what left, and putting it in the ledger.
//!
//! # What posting a payment actually does
//!
//! Debit the payable once per bill settled, credit the account the money left.
//! That is the whole entry. It is the mirror of `payables::post_bill`, which
//! credited the same payable when the bill arrived, and between the two a
//! supplier's balance finally rises and falls instead of only rising.
//!
//! WHICH payable follows the bill, not the payment. A merchandise bill credited
//! `trade_payable` and an expense bill credited `non_merchandise_payable`, and
//! a settlement that debited the wrong one of those would leave both accounts
//! wrong by the same amount while the trial balance still balanced — the
//! failure that survives a year. A payment that clears a truckload of stock and
//! the electricity bill in one transfer therefore posts two debit lines, one
//! against each payable, and that falls out of debiting per allocation.
//!
//! The payable is debited per allocation rather than once for the total, and
//! each line carries `supplier_id` and names the invoice in its memo. Supplier
//! ageing is a projection over `journal_line`, not a separate sub-ledger, so a
//! single lumped line would leave the general ledger unable to say which debts
//! the money answered — and the sub-ledger that could say it would be this
//! table, drifting quietly out of step with the GL it is supposed to explain.
//!
//! # Assumptions, stated because they are choices and not facts
//!
//! * **One payment, one account, one site, one date.** The site is the
//!   payment's, and the database refuses an allocation to a bill at another
//!   location. Head office paying a shop's supplier is a real thing an
//!   Indonesian retailer does, and doing it honestly needs the client's
//!   inter-unit accounts — which they keep — plus a rule about which side
//!   carries the balance. Refusing is not the final answer; it is the honest
//!   one until that rule is written down.
//! * **One payment may settle several bills, in part.** Both are ordinary: a
//!   weekly transfer clears a batch, and a disputed line gets paid short.
//! * **No foreign exchange.** Bill and payment must agree on currency. Every
//!   seeded bill is IDR and the client buys in IDR.
//! * **No withholding tax and no settlement discount.** PPh 23 on a service
//!   invoice and a `2% 10 net 30` discount would each put a third account in
//!   the entry — a tax payable, or the `Potongan Pembelian` account the bill
//!   posting already knows about. Neither is guessed at: a payment records what
//!   left the bank. Of the two, withholding is the one most likely to be wanted
//!   first — a retailer paying rent, security or freight to a domestic vendor
//!   withholds and remits it — and it is a column, a semantic key and one more
//!   posting line away.
//! * **No bank charge.** A transfer fee is the bank's charge, not the
//!   supplier's, and it belongs on the bank statement being reconciled rather
//!   than inside the settlement of a bill.
//! * **A draft reserves.** An allocation from a DRAFT payment counts against
//!   the bill's outstanding, so two drafts cannot both promise the same
//!   10,000,000. It is not yet PAID, though — `paid_minor` on a bill counts
//!   posted payments only, and `allocated_minor` is what tells a screen why a
//!   bill with an outstanding balance still will not take another allocation.

use super::poster::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// One debt this payment answered.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentAllocation {
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub invoice_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    /// What the whole bill is, so a screen can show "3,000,000 of 8,500,000"
    /// without fetching every bill again.
    pub invoice_total_minor: i64,
    pub amount_minor: i64,
    /// The bill's kind — `MERCHANDISE` or `EXPENSE`. Carried because it decides
    /// which payable this allocation debits when the payment posts, and because
    /// a screen listing what a transfer settled should be able to say that one
    /// of the four was the electricity.
    pub kind: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierPayment {
    pub payment_id: Uuid,
    pub payment_number: String,
    pub site_id: String,
    pub payment_date: NaiveDate,
    pub method: String,
    /// The meaning the money left by — `bank_giro`, `cash` — and which bank.
    /// Not a client account code: that is resolved from these through
    /// `account_map` at posting time, and storing the code here would be a
    /// second copy of the map that stops agreeing with it.
    pub account_key: String,
    pub account_qualifier: String,
    /// What that pair resolves to today, for a screen that wants to show it.
    /// Read through the map on every read, so it follows a remapping instead of
    /// remembering where the account used to be.
    pub account_code: Option<String>,
    pub account_name: Option<String>,
    pub currency: String,
    pub total_minor: i64,
    pub status: String,
    pub journal_entry_id: Option<Uuid>,
    pub entry_number: Option<String>,
    pub reference: Option<String>,
    pub note: Option<String>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    pub posted_by: Option<String>,
    pub posted_at: Option<DateTime<Utc>>,
    pub allocations: Vec<PaymentAllocation>,
}

/// One line of "what this payment is for".
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllocateToBill {
    pub invoice_id: Uuid,
    pub amount_minor: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordPaymentRequest {
    pub site_id: String,
    pub payment_date: NaiveDate,
    /// `TRANSFER`, `CASH`, `CHEQUE`, `GIRO` or `OTHER`.
    pub method: String,
    /// One of `bank_giro`, `bank_savings`, `cash`, `petty_cash`.
    pub account_key: String,
    #[serde(default)]
    pub account_qualifier: String,
    /// Optional, and checked against the allocations when given. Deliberately
    /// redundant, in the same spirit as `journal_entry.total_minor`: a client
    /// that believes it is paying 50,000,000 and has built allocations totalling
    /// 5,000,000 should hear about it here, not discover it on a bank statement.
    pub total_minor: Option<i64>,
    pub reference: Option<String>,
    pub note: Option<String>,
    pub allocations: Vec<AllocateToBill>,
}

const PAYMENT_COLUMNS: &str = "p.payment_id, p.payment_number, p.site_id, p.payment_date,
     p.method, p.account_key, p.account_qualifier, p.currency, p.total_minor, p.status,
     p.journal_entry_id, p.reference, p.note, p.recorded_by, p.recorded_at,
     p.posted_by, p.posted_at,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = p.journal_entry_id)
         AS entry_number,
     m.account_code, a.name AS account_name";

/// The map join is LEFT on purpose. The composite foreign key means the mapping
/// existed when the payment was recorded; it does not promise it still does,
/// and a payment that vanished from a list because Finance tidied the map would
/// be a worse failure than one shown without its account name.
const PAYMENT_FROM: &str = "FROM supplier_payment p
     LEFT JOIN account_map m ON m.semantic_key = p.account_key
                            AND m.site_id = p.site_id
                            AND m.qualifier = p.account_qualifier
     LEFT JOIN ledger_account a ON a.account_code = m.account_code";

fn to_payment(row: &sqlx::postgres::PgRow) -> Result<SupplierPayment, AppError> {
    Ok(SupplierPayment {
        payment_id: row.try_get("payment_id")?,
        payment_number: row.try_get("payment_number")?,
        site_id: row.try_get("site_id")?,
        payment_date: row.try_get("payment_date")?,
        method: row.try_get("method")?,
        account_key: row.try_get("account_key")?,
        account_qualifier: row.try_get("account_qualifier")?,
        account_code: row.try_get("account_code")?,
        account_name: row.try_get("account_name")?,
        currency: row.try_get("currency")?,
        total_minor: row.try_get("total_minor")?,
        status: row.try_get("status")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        entry_number: row.try_get("entry_number")?,
        reference: row.try_get("reference")?,
        note: row.try_get("note")?,
        recorded_by: row.try_get("recorded_by")?,
        recorded_at: row.try_get("recorded_at")?,
        posted_by: row.try_get("posted_by")?,
        posted_at: row.try_get("posted_at")?,
        allocations: Vec::new(),
    })
}

/// Fill in the allocations for a batch of payments in one query.
///
/// One round trip for the list rather than one per row: a month of payments is
/// a hundred rows, and a hundred and one queries to draw one screen is how a
/// list gets slow without anybody being able to point at the reason.
async fn attach_allocations(
    pool: &PgPool,
    payments: &mut [SupplierPayment],
) -> Result<(), AppError> {
    if payments.is_empty() {
        return Ok(());
    }
    let ids: Vec<Uuid> = payments.iter().map(|p| p.payment_id).collect();
    let rows = sqlx::query(
        "SELECT al.payment_id, al.invoice_id, al.amount_minor,
                i.invoice_number, i.supplier_id, i.supplier_name, i.invoice_date,
                i.due_date, i.total_minor AS invoice_total_minor, i.kind
           FROM supplier_payment_allocation al
           JOIN supplier_invoice i USING (invoice_id)
          WHERE al.payment_id = ANY($1)
          ORDER BY i.due_date NULLS LAST, i.invoice_number",
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;

    for row in &rows {
        let payment_id: Uuid = row.try_get("payment_id")?;
        let allocation = PaymentAllocation {
            invoice_id: row.try_get("invoice_id")?,
            invoice_number: row.try_get("invoice_number")?,
            supplier_id: row.try_get("supplier_id")?,
            supplier_name: row.try_get("supplier_name")?,
            invoice_date: row.try_get("invoice_date")?,
            due_date: row.try_get("due_date")?,
            invoice_total_minor: row.try_get("invoice_total_minor")?,
            amount_minor: row.try_get("amount_minor")?,
            kind: row.try_get("kind")?,
        };
        if let Some(payment) = payments.iter_mut().find(|p| p.payment_id == payment_id) {
            payment.allocations.push(allocation);
        }
    }
    Ok(())
}

/// `supplier` filters by who was paid, which lives on the allocations rather
/// than on the payment: a payment is a bank line, and one bank line settling
/// two suppliers is a thing that happens.
pub async fn list_payments(
    pool: &PgPool,
    status: Option<&str>,
    site_id: Option<&str>,
    supplier_id: Option<&str>,
    limit: i64,
) -> Result<Vec<SupplierPayment>, AppError> {
    let sql = format!(
        "SELECT {PAYMENT_COLUMNS} {PAYMENT_FROM}
          WHERE ($1::text IS NULL OR p.status = $1)
            AND ($2::text IS NULL OR p.site_id = $2)
            AND ($3::text IS NULL OR EXISTS (
                    SELECT 1 FROM supplier_payment_allocation al
                      JOIN supplier_invoice i USING (invoice_id)
                     WHERE al.payment_id = p.payment_id AND i.supplier_id = $3))
          ORDER BY p.payment_date DESC, p.payment_number DESC
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(status)
        .bind(site_id)
        .bind(supplier_id)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    let mut payments: Vec<SupplierPayment> = rows
        .iter()
        .map(to_payment)
        .collect::<Result<_, AppError>>()?;
    attach_allocations(pool, &mut payments).await?;
    Ok(payments)
}

pub async fn payment(pool: &PgPool, payment_id: Uuid) -> Result<SupplierPayment, AppError> {
    let sql = format!("SELECT {PAYMENT_COLUMNS} {PAYMENT_FROM} WHERE p.payment_id = $1");
    let row = sqlx::query(&sql)
        .bind(payment_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("supplier payment".into()))?;
    let mut one = [to_payment(&row)?];
    attach_allocations(pool, &mut one).await?;
    let [payment] = one;
    Ok(payment)
}

const MONEY_KEYS: [&str; 4] = ["bank_giro", "bank_savings", "cash", "petty_cash"];
const METHODS: [&str; 5] = ["TRANSFER", "CASH", "CHEQUE", "GIRO", "OTHER"];

/// Record a payment. It is not in the books yet — posting is a separate act,
/// for the same reason a bill's is: somebody keys it, somebody else checks it
/// against the bank, and only then does it become a journal entry.
pub async fn record_payment(
    pool: &PgPool,
    request: &RecordPaymentRequest,
    actor: &str,
) -> Result<SupplierPayment, AppError> {
    let key = request.account_key.trim().to_ascii_lowercase();
    if !MONEY_KEYS.contains(&key.as_str()) {
        return Err(AppError::Validation(format!(
            "'{key}' is not an account money leaves from; expected one of {}",
            MONEY_KEYS.join(", ")
        )));
    }
    let method = request.method.trim().to_ascii_uppercase();
    if !METHODS.contains(&method.as_str()) {
        return Err(AppError::Validation(format!(
            "'{method}' is not a payment method; expected one of {}",
            METHODS.join(", ")
        )));
    }
    if request.allocations.is_empty() {
        return Err(AppError::Validation(
            "a payment must say which bills it settles; a payment against no bill is a bank \
             line, not a payment"
                .into(),
        ));
    }

    let mut total: i64 = 0;
    let mut seen: Vec<Uuid> = Vec::with_capacity(request.allocations.len());
    for allocation in &request.allocations {
        if allocation.amount_minor <= 0 {
            return Err(AppError::Validation(
                "an allocation must be positive; a credit note is a separate document".into(),
            ));
        }
        if seen.contains(&allocation.invoice_id) {
            return Err(AppError::Validation(format!(
                "bill {} appears twice in one payment; add the two amounts together instead",
                allocation.invoice_id
            )));
        }
        seen.push(allocation.invoice_id);
        total = total
            .checked_add(allocation.amount_minor)
            .ok_or_else(|| AppError::Validation("the payment total overflows".into()))?;
    }
    if let Some(stated) = request.total_minor {
        if stated != total {
            return Err(AppError::Validation(format!(
                "the payment says {stated} but its allocations total {total}"
            )));
        }
    }

    // Checked here as well as by the composite foreign key on the table, for
    // the same reason `set_account_mapping` checks the chart: a foreign-key
    // violation is SQLSTATE 23503 and reaches a person as "database operation
    // failed". `resolve_account` names the key, the site and the qualifier —
    // which is exactly what somebody has to go and fill in.
    let qualifier = request.account_qualifier.trim();
    super::ledger::resolve_account(pool, &key, &request.site_id, qualifier).await?;

    let mut tx = pool.begin().await?;
    let payment_id = Uuid::new_v4();
    let number: i64 = sqlx::query("SELECT nextval('supplier_payment_number_seq') AS n")
        .fetch_one(&mut *tx)
        .await?
        .try_get("n")?;

    sqlx::query(
        "INSERT INTO supplier_payment
           (payment_id, payment_number, site_id, payment_date, method, account_key,
            account_qualifier, currency, total_minor, reference, note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'IDR',$8,$9,$10,$11)",
    )
    .bind(payment_id)
    .bind(format!("PV-{number:08}"))
    .bind(&request.site_id)
    .bind(request.payment_date)
    .bind(&method)
    .bind(&key)
    .bind(qualifier)
    .bind(total)
    .bind(request.reference.as_deref())
    .bind(request.note.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    for allocation in &request.allocations {
        sqlx::query(
            "INSERT INTO supplier_payment_allocation (payment_id, invoice_id, amount_minor)
             VALUES ($1,$2,$3)",
        )
        .bind(payment_id)
        .bind(allocation.invoice_id)
        .bind(allocation.amount_minor)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    payment(pool, payment_id).await
}

/// Post a recorded payment to the ledger.
///
/// The payment row and the journal are written in one transaction, which is why
/// the poster takes a transaction it did not open. A payment marked posted with
/// no entry behind it, or an entry with no payment, are both states nobody
/// could explain afterwards.
pub async fn post_payment(
    pool: &PgPool,
    payment_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<SupplierPayment, AppError> {
    let existing = payment(pool, payment_id).await?;
    if existing.status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "payment {} is {}, not waiting to be posted",
            existing.payment_number,
            existing.status.to_lowercase()
        )));
    }

    // Dr the payable, once per bill, carrying the supplier and naming the
    // invoice / Cr the account the money left, once for the total.
    //
    // WHICH payable follows the bill's own kind, because that is the account
    // the bill credited when it posted. A payment settling both kinds at once
    // therefore produces one debit line against `trade_payable` and another
    // against `non_merchandise_payable`, which is what per-allocation lines
    // give for free.
    //
    // No account code is named here. Both payable meanings and the money key
    // resolve through `account_map` for this site, so moving the BCA current
    // account is a row somebody edits on a screen rather than a release.
    let mut lines = Vec::with_capacity(existing.allocations.len() + 1);
    for allocation in &existing.allocations {
        let payable = if allocation.kind == "EXPENSE" {
            "non_merchandise_payable"
        } else {
            "trade_payable"
        };
        let mut line = PostingLine::debit(payable, &existing.site_id, allocation.amount_minor)
            .for_supplier(&allocation.supplier_id);
        line.memo = Some(format!(
            "{} {}",
            allocation.invoice_number,
            allocation
                .supplier_name
                .as_deref()
                .unwrap_or(&allocation.supplier_id)
        ));
        lines.push(line);
    }
    lines.push(
        PostingLine::credit(
            &existing.account_key,
            &existing.site_id,
            existing.total_minor,
        )
        .with_qualifier(&existing.account_qualifier),
    );

    let settled = existing
        .allocations
        .iter()
        .map(|a| a.invoice_number.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let intent = PostingIntent {
        posting_date: posting_date.unwrap_or(existing.payment_date),
        source_kind: "PAYMENT".into(),
        source_id: Some(existing.payment_id.to_string()),
        rule_version: "supplier_payment/1".into(),
        currency: existing.currency.clone(),
        memo: Some(format!("{} — {settled}", existing.payment_number)),
        lines,
    };

    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, None, actor).await?;
    sqlx::query(
        "UPDATE supplier_payment
            SET status='POSTED', journal_entry_id=$2, posted_by=$3, posted_at=now()
          WHERE payment_id=$1",
    )
    .bind(payment_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    payment(pool, payment_id).await
}
