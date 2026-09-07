//! Supplier bills: recording one, and posting it to the ledger.
//!
//! # Two kinds of bill, one document
//!
//! A MERCHANDISE bill is goods for resale. Debit inventory and input VAT,
//! credit the supplier payable — the rule knows which accounts, because there
//! is only one answer.
//!
//! An EXPENSE bill is everything else the client buys: electricity, rent,
//! security, freight, agency staff, repairs, the accountant's fee. The rule
//! CANNOT know which account, because only the person holding the paper does,
//! so the bill carries lines that name it and the rule debits what they say.
//!
//! They are one document and not two because everything around a bill is the
//! same either way — supplier, number, terms, tax, status, ageing, and the
//! payment that settles it. 0094 makes the argument at length.
//!
//! # What posting a merchandise bill actually does
//!
//! Debit inventory and input VAT, credit the supplier payable. That is the
//! whole entry, and it is worth saying what is NOT in it: nothing was posted
//! when the goods arrived. The client has no goods-received-not-invoiced
//! account, so a delivery moves stock in the warehouse and moves nothing in the
//! books, and both inventory and payables enter together here.
//!
//! The consequence is stated in 0052 and repeated because it matters at a month
//! end: stock that has arrived and not been billed is not on the balance sheet.
//! `unbilled_receipts` below is how somebody sees that exposure anyway.
//!
//! # Why the bill is a row before it is a journal
//!
//! Because a bill arrives, gets queried, gets held, and only then gets posted —
//! and during all of that it is a real document somebody has to be able to find.
//! Posting is a separate act with its own actor, and once done the amounts are
//! frozen by a trigger: the journal that quotes them cannot move, so neither can
//! they.

use super::ledger::{assert_postable, Intent};
use super::poster::{post, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Goods for resale. Debits `inventory` by rule and carries no lines.
const MERCHANDISE: &str = "MERCHANDISE";
/// Everything else. Debits the accounts its lines name.
const EXPENSE: &str = "EXPENSE";

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierBill {
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub site_id: String,
    pub invoice_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    pub currency: String,
    pub subtotal_minor: i64,
    pub tax_minor: i64,
    pub discount_minor: i64,
    pub total_minor: i64,
    pub status: String,
    pub journal_entry_id: Option<Uuid>,
    /// The entry number, so a list can name the journal without a second fetch.
    pub entry_number: Option<String>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    pub posted_by: Option<String>,
    pub note: Option<String>,
    /// Days past due, negative when it is not due yet. Derived on read: a
    /// stored age would be wrong by morning.
    pub days_overdue: i32,
    /// What has actually left the bank against this bill — allocations from
    /// POSTED payments only. Summed on read for the same reason every balance
    /// in this module is: a stored figure and the rows it summarises drift.
    pub paid_minor: i64,
    /// Still owed: `total_minor - paid_minor`.
    pub outstanding_minor: i64,
    /// What is spoken for, counting DRAFT payments as well as posted ones.
    ///
    /// The third figure exists because without it a screen cannot explain
    /// itself. The database refuses an allocation that would push this past the
    /// bill's total — a draft reserves, so two drafts cannot both promise the
    /// same 10,000,000 — and a bill showing 8,000,000 outstanding that will not
    /// take another allocation looks broken until somebody can see that a draft
    /// already has it.
    pub allocated_minor: i64,
    /// `MERCHANDISE` or `EXPENSE`. What decides which accounts the posting
    /// debits, and therefore whether `lines` means anything.
    pub kind: String,
    /// What an expense bill was for, account by account.
    ///
    /// `None` on a list read, where it is not fetched — one query per row to
    /// draw a table is how a list gets slow without anybody being able to point
    /// at the reason. `Some` on the detail read, and `Some([])` on a
    /// merchandise bill, which genuinely has none: the two absences are
    /// different and a bare empty array could not tell them apart.
    pub lines: Option<Vec<SupplierBillLine>>,
}

/// One thing an expense bill was for.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierBillLine {
    pub line_id: Uuid,
    pub line_number: i32,
    pub account_code: String,
    /// The client's own name for it, never translated, so the bill can be read
    /// without looking every code up.
    pub account_name: String,
    /// Where this cost belongs. Equal to the bill's location: 0098 forces it,
    /// because a cost at another location has no honest credit until a rule
    /// writes the client's inter-unit accounts. The column stays so that rule
    /// can be enabled by dropping a constraint rather than by a migration.
    pub site_id: String,
    pub amount_minor: i64,
    pub memo: Option<String>,
}

/// One line of "what this bill was for", as somebody keys it.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordBillLine {
    /// A postable, active account in class 6, 7, or — for a prepayment, an
    /// advance or a capital purchase — class 1. The database refuses the rest,
    /// and says why.
    pub account_code: String,
    /// Where the COST belongs, which need not be the bill's own location: one
    /// head-office invoice for four shops' electricity is four lines at four
    /// locations. See `SupplierBillLine::site_id`.
    pub site_id: String,
    pub amount_minor: i64,
    pub memo: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordBillRequest {
    pub invoice_number: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub site_id: String,
    pub invoice_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    pub subtotal_minor: i64,
    #[serde(default)]
    pub tax_minor: i64,
    #[serde(default)]
    pub discount_minor: i64,
    pub note: Option<String>,
    /// `MERCHANDISE` (the default) or `EXPENSE`.
    ///
    /// Defaulted rather than required, because every bill recorded before 0094
    /// was a merchandise bill and every caller written before it says so by
    /// saying nothing.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub kind: Option<String>,
    /// Required on an EXPENSE bill and refused on a MERCHANDISE one. The
    /// amounts must total `subtotal_minor` — tax and the bill's own total are
    /// stated separately, as they are on the paper.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub lines: Option<Vec<RecordBillLine>>,
}

/// A delivery nobody has billed for.
///
/// Not a journal and not a balance — there is no account for it. This is the
/// operational answer to "what is sitting in the warehouse that the books do
/// not know about", and it is the reason that gap is visible at all.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnbilledReceipt {
    pub receipt_id: Uuid,
    pub receipt_number: String,
    pub supplier_id: String,
    pub site_id: String,
    pub arrived_at: DateTime<Utc>,
    /// What the DC recorded off the paper that came with the goods, when it
    /// came with any. Evidence, not a bookable figure.
    pub invoice_number: Option<String>,
    pub invoice_total_minor: Option<i64>,
    /// Accepted quantity times the ordered price. What the delivery is worth if
    /// the supplier bills what was agreed.
    pub value_at_order_price_minor: i64,
    pub line_count: i64,
    pub days_waiting: i32,
}

const BILL_COLUMNS: &str = "i.invoice_id, i.invoice_number, i.supplier_id, i.supplier_name,
     i.site_id, i.invoice_date, i.due_date, i.currency, i.subtotal_minor, i.tax_minor,
     i.discount_minor, i.total_minor, i.status, i.journal_entry_id, i.recorded_by,
     i.recorded_at, i.posted_by, i.note, i.kind,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = i.journal_entry_id) AS entry_number,
     COALESCE((CURRENT_DATE - i.due_date), 0)::int AS days_overdue,
     COALESCE((SELECT SUM(al.amount_minor) FROM supplier_payment_allocation al
                 JOIN supplier_payment p USING (payment_id)
                WHERE al.invoice_id = i.invoice_id AND p.status = 'POSTED'), 0)::bigint
         AS paid_minor,
     COALESCE((SELECT SUM(al.amount_minor) FROM supplier_payment_allocation al
                 JOIN supplier_payment p USING (payment_id)
                WHERE al.invoice_id = i.invoice_id AND p.status IN ('DRAFT','POSTED')), 0)::bigint
         AS allocated_minor";

fn to_bill(row: &sqlx::postgres::PgRow) -> Result<SupplierBill, AppError> {
    let total_minor: i64 = row.try_get("total_minor")?;
    let paid_minor: i64 = row.try_get("paid_minor")?;
    Ok(SupplierBill {
        paid_minor,
        outstanding_minor: total_minor - paid_minor,
        allocated_minor: row.try_get("allocated_minor")?,
        invoice_id: row.try_get("invoice_id")?,
        invoice_number: row.try_get("invoice_number")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_name: row.try_get("supplier_name")?,
        site_id: row.try_get("site_id")?,
        invoice_date: row.try_get("invoice_date")?,
        due_date: row.try_get("due_date")?,
        currency: row.try_get("currency")?,
        subtotal_minor: row.try_get("subtotal_minor")?,
        tax_minor: row.try_get("tax_minor")?,
        discount_minor: row.try_get("discount_minor")?,
        total_minor,
        status: row.try_get("status")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        entry_number: row.try_get("entry_number")?,
        recorded_by: row.try_get("recorded_by")?,
        recorded_at: row.try_get("recorded_at")?,
        posted_by: row.try_get("posted_by")?,
        note: row.try_get("note")?,
        days_overdue: row.try_get("days_overdue")?,
        kind: row.try_get("kind")?,
        lines: None,
    })
}

/// What an expense bill was for, in the order it was keyed.
async fn bill_lines(pool: &PgPool, invoice_id: Uuid) -> Result<Vec<SupplierBillLine>, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, l.line_number, l.account_code, a.name AS account_name,
                l.site_id, l.amount_minor, l.memo
           FROM supplier_invoice_expense_line l
           JOIN ledger_account a ON a.account_code = l.account_code
          WHERE l.invoice_id = $1
          ORDER BY l.line_number",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(SupplierBillLine {
                line_id: row.try_get("line_id")?,
                line_number: row.try_get("line_number")?,
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                site_id: row.try_get("site_id")?,
                amount_minor: row.try_get("amount_minor")?,
                memo: row.try_get("memo")?,
            })
        })
        .collect()
}

pub async fn list_bills(
    pool: &PgPool,
    status: Option<&str>,
    supplier_id: Option<&str>,
    limit: i64,
) -> Result<Vec<SupplierBill>, AppError> {
    let sql = format!(
        "SELECT {BILL_COLUMNS} FROM supplier_invoice i
          WHERE ($1::text IS NULL OR i.status = $1)
            AND ($2::text IS NULL OR i.supplier_id = $2)
          ORDER BY i.invoice_date DESC, i.invoice_number DESC
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(status)
        .bind(supplier_id)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_bill).collect()
}

/// One bill, with what it was for.
///
/// The lines are fetched here and not in `list_bills`: a list draws a hundred
/// rows and a hundred and one queries to draw one screen is how a list gets
/// slow without anybody being able to point at the reason.
pub async fn bill(pool: &PgPool, invoice_id: Uuid) -> Result<SupplierBill, AppError> {
    let sql = format!("SELECT {BILL_COLUMNS} FROM supplier_invoice i WHERE i.invoice_id = $1");
    let row = sqlx::query(&sql)
        .bind(invoice_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("supplier bill".into()))?;
    let mut bill = to_bill(&row)?;
    bill.lines = Some(bill_lines(pool, invoice_id).await?);
    Ok(bill)
}

/// Record a bill. It is not in the books yet — posting is a separate act.
///
/// Every refusal below is also enforced by the database — 0094's foreign keys,
/// CHECKs and deferred trigger are the guarantee. These are the explanations,
/// checked first so the sentence names the line somebody just typed rather than
/// arriving at COMMIT naming a transaction. The same arrangement
/// `poster::check_balanced` has with the journal's balance trigger.
pub async fn record_bill(
    pool: &PgPool,
    request: &RecordBillRequest,
    actor: &str,
) -> Result<SupplierBill, AppError> {
    if request.invoice_number.trim().is_empty() {
        return Err(AppError::Validation("invoice_number is required".into()));
    }
    if request.subtotal_minor < 0 || request.tax_minor < 0 || request.discount_minor < 0 {
        return Err(AppError::Validation(
            "amounts cannot be negative; a credit is a separate document".into(),
        ));
    }
    let total = request.subtotal_minor + request.tax_minor - request.discount_minor;
    if total < 0 {
        return Err(AppError::Validation(
            "the discount is larger than the bill".into(),
        ));
    }

    let kind = request
        .kind
        .as_deref()
        .map(|raw| raw.trim().to_ascii_uppercase())
        .unwrap_or_else(|| MERCHANDISE.to_string());
    if kind != MERCHANDISE && kind != EXPENSE {
        return Err(AppError::Validation(format!(
            "'{kind}' is not a kind of bill; a bill is either {} — goods for resale — or {}",
            MERCHANDISE, EXPENSE
        )));
    }

    let lines = request.lines.as_deref().unwrap_or(&[]);
    if kind == MERCHANDISE && !lines.is_empty() {
        return Err(AppError::Validation(
            "a merchandise bill carries no lines: what it debits is decided by the posting rule, \
             not by the person keying it. Record it as an EXPENSE bill if these are costs."
                .into(),
        ));
    }
    if kind == EXPENSE {
        if lines.is_empty() {
            return Err(AppError::Validation(
                "an expense bill must say what it was for; add a line naming the account each \
                 cost belongs to"
                    .into(),
            ));
        }
        if request.discount_minor > 0 {
            return Err(AppError::Validation(
                "an expense bill cannot carry a discount: the client's only discount account is \
                 Potongan Pembelian, which is for purchases. Take the reduction off the line it \
                 belongs to instead."
                    .into(),
            ));
        }
        let mut sum: i64 = 0;
        for (index, line) in lines.iter().enumerate() {
            if line.amount_minor <= 0 {
                return Err(AppError::Validation(format!(
                    "line {} must be positive; a credit note is a separate document",
                    index + 1
                )));
            }
            if line.site_id.trim().is_empty() {
                return Err(AppError::Validation(format!(
                    "line {} must say which location the cost belongs to",
                    index + 1
                )));
            }
            // A line may sit at another location than its bill. One electricity
            // invoice at head office covering four shops is four lines at four
            // locations, which is how the client bills it and how they read it
            // back.
            //
            // This is where a refusal used to be, and the reason it could stand
            // for as long as it did: every 6* and 7* leaf in the client's chart
            // is a per-location account and their trial balance is read per
            // location, so a head-office bill carrying a store-01 line debited
            // store 01 with no credit anywhere in store 01's books. The honest
            // credit is inter-unit, nothing wrote one, and refusing was better
            // than mis-posting. `domain::interunit` writes it now — the shop's
            // cost against what it owes head office, head office's receivable
            // against the supplier it will pay — so the entry balances at every
            // location it touches and the constraint that enforced the old rule
            // came off in 0121.
            // Checked here as well as by the composite foreign key on the
            // table, for the reason `assert_postable` documents: a foreign-key
            // violation is SQLSTATE 23503 and reaches a person as "database
            // operation failed", naming neither the line nor the fault.
            assert_postable(pool, line.account_code.trim(), Intent::Post)
                .await
                .map_err(|error| match error {
                    AppError::Validation(message) => {
                        AppError::Validation(format!("line {}: {message}", index + 1))
                    }
                    other => other,
                })?;
            sum = sum
                .checked_add(line.amount_minor)
                .ok_or_else(|| AppError::Validation("the bill total overflows".into()))?;
        }
        if sum != request.subtotal_minor {
            return Err(AppError::Validation(format!(
                "the bill says {} before tax but its lines total {sum}; the difference is {}",
                request.subtotal_minor,
                (request.subtotal_minor - sum).abs()
            )));
        }
    }

    // The header and its lines in one transaction, because 0094's deferred
    // trigger checks them together at COMMIT: an expense bill without its lines
    // is not a state that ever exists.
    let mut tx = pool.begin().await?;
    let invoice_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO supplier_invoice
           (invoice_id, invoice_number, supplier_id, supplier_name, site_id, invoice_date,
            due_date, currency, subtotal_minor, tax_minor, discount_minor, total_minor,
            recorded_by, note, kind)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'IDR',$8,$9,$10,$11,$12,$13,$14)",
    )
    .bind(invoice_id)
    .bind(request.invoice_number.trim())
    .bind(request.supplier_id.trim())
    .bind(request.supplier_name.as_deref())
    .bind(&request.site_id)
    .bind(request.invoice_date)
    .bind(request.due_date)
    .bind(request.subtotal_minor)
    .bind(request.tax_minor)
    .bind(request.discount_minor)
    .bind(total)
    .bind(actor)
    .bind(request.note.as_deref())
    .bind(&kind)
    .execute(&mut *tx)
    .await?;

    for (index, line) in lines.iter().enumerate() {
        sqlx::query(
            "INSERT INTO supplier_invoice_expense_line
               (line_id, invoice_id, line_number, account_code, site_id, amount_minor, memo)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(Uuid::new_v4())
        .bind(invoice_id)
        .bind(index as i32 + 1)
        .bind(line.account_code.trim())
        .bind(line.site_id.trim())
        .bind(line.amount_minor)
        .bind(line.memo.as_deref())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    bill(pool, invoice_id).await
}

/// Post a recorded bill to the ledger.
///
/// The bill row and the journal are written in one transaction, which is why
/// the poster takes a transaction it did not open. A bill marked posted with no
/// entry behind it, or an entry with no bill, are both states nobody could
/// explain afterwards.
pub async fn post_bill(
    pool: &PgPool,
    invoice_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<SupplierBill, AppError> {
    let existing = bill(pool, invoice_id).await?;
    if existing.status != "DRAFT" && existing.status != "MATCHED" {
        return Err(AppError::Conflict(format!(
            "bill {} is {}, not waiting to be posted",
            existing.invoice_number,
            existing.status.to_lowercase()
        )));
    }

    let expense = existing.kind == EXPENSE;

    // MERCHANDISE — Dr inventory (gross) + Dr input VAT / Cr trade payable (net
    // of discount) + Cr purchase discount.
    //
    // The discount is a CREDIT to `8010110003 Potongan Pembelian`, not a
    // smaller inventory figure. That is where the client keeps it: the account
    // sits under root 8, PENDAPATAN DAN (BIAYA) LAIN - LAIN, so they treat a
    // purchase discount as other income rather than as a cheaper cost of goods.
    // Netting it off inventory instead would balance just as well, report the
    // same profit, and quietly empty an account their own statements have a
    // line for.
    //
    // Debits are subtotal + tax; credits are (subtotal + tax - discount) +
    // discount. The same total, arrived at from both sides.
    //
    // EXPENSE — Dr each line's own account, at that line's location + Dr input
    // VAT / Cr non-merchandise payable.
    //
    // The line's account is named directly rather than through `account_map`,
    // and that is not the rule breaking 0050's "nothing in Rust names a client
    // account code". Nothing here names one: the code comes off the document,
    // chosen by the person who read the paper, exactly as it does on a manual
    // journal entry. `LineAccount::Account` is the same door that entry uses.
    //
    // A cost line lands where the cost belongs and the payable lands at the
    // bill's own location, so an expense bill spanning four shops posts four
    // costs and one payable. That does not balance per location on its own, and
    // it does not have to: `poster::post` adds the affiliate legs that leave
    // each shop and head office at zero, which is the only way this can be read
    // against the client's own per-location trial balance.
    let mut lines: Vec<PostingLine> = if expense {
        existing
            .lines
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(|line| PostingLine {
                account: LineAccount::Account {
                    account_code: line.account_code.clone(),
                },
                site_id: line.site_id.clone(),
                counter_site_id: None,
                debit_minor: line.amount_minor,
                credit_minor: 0,
                supplier_id: None,
                memo: line.memo.clone(),
            })
            .collect()
    } else {
        vec![PostingLine::debit(
            "inventory",
            &existing.site_id,
            existing.subtotal_minor,
        )]
    };
    if existing.tax_minor > 0 {
        lines.push(PostingLine::debit(
            "vat_in",
            &existing.site_id,
            existing.tax_minor,
        ));
    }
    lines.push(
        PostingLine::credit(
            if expense {
                "non_merchandise_payable"
            } else {
                "trade_payable"
            },
            &existing.site_id,
            existing.total_minor,
        )
        .for_supplier(&existing.supplier_id),
    );
    if existing.discount_minor > 0 {
        lines.push(PostingLine::credit(
            "purchase_discount",
            &existing.site_id,
            existing.discount_minor,
        ));
    }

    let intent = PostingIntent {
        posting_date: posting_date.unwrap_or(existing.invoice_date),
        source_kind: "SUPPLIER_INVOICE".into(),
        source_id: Some(existing.invoice_id.to_string()),
        // A distinct version, because it is a distinct rule. When one of the
        // two is corrected, this is what says which entries the old one wrote —
        // the thing 0083 needed and had to reconstruct from a memo string.
        rule_version: if expense {
            "expense_invoice/1".into()
        } else {
            "supplier_invoice/1".into()
        },
        currency: existing.currency.clone(),
        memo: Some(format!(
            "{} {}",
            existing.invoice_number,
            existing
                .supplier_name
                .as_deref()
                .unwrap_or(&existing.supplier_id)
        )),
        lines,
    };

    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, None, actor).await?;
    sqlx::query(
        "UPDATE supplier_invoice
            SET status='POSTED', journal_entry_id=$2, posted_by=$3, posted_at=now()
          WHERE invoice_id=$1",
    )
    .bind(invoice_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    bill(pool, invoice_id).await
}

/// Deliveries with no bill against them, and what they are worth.
///
/// Valued at the ordered price times the accepted quantity, because that is
/// what the supplier has agreed to charge. It is an estimate of an exposure,
/// not a balance, and it is labelled as one wherever it is shown.
pub async fn unbilled_receipts(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<UnbilledReceipt>, AppError> {
    let rows = sqlx::query(
        "SELECT r.receipt_id, r.receipt_number, r.supplier_id, r.site_id, r.arrived_at,
                r.invoice_number, r.invoice_total_minor,
                COALESCE(SUM(rl.quantity * pl.unit_price_minor), 0)::bigint AS value_at_order_price,
                COUNT(rl.receipt_line_id)::bigint AS line_count,
                (CURRENT_DATE - r.arrived_at::date)::int AS days_waiting
           FROM goods_receipt r
           LEFT JOIN goods_receipt_line rl ON rl.receipt_id = r.receipt_id
           LEFT JOIN purchase_order_line pl ON pl.po_line_id = rl.po_line_id
          WHERE NOT EXISTS (
                    SELECT 1 FROM supplier_invoice_receipt sir
                     WHERE sir.receipt_id = r.receipt_id)
          GROUP BY r.receipt_id
          ORDER BY r.arrived_at
          LIMIT $1",
    )
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(UnbilledReceipt {
                receipt_id: row.try_get("receipt_id")?,
                receipt_number: row.try_get("receipt_number")?,
                supplier_id: row.try_get("supplier_id")?,
                site_id: row.try_get("site_id")?,
                arrived_at: row.try_get("arrived_at")?,
                invoice_number: row.try_get("invoice_number")?,
                invoice_total_minor: row.try_get("invoice_total_minor")?,
                value_at_order_price_minor: row.try_get("value_at_order_price")?,
                line_count: row.try_get("line_count")?,
                days_waiting: row.try_get("days_waiting")?,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Payables ageing
// ---------------------------------------------------------------------------

/// The five buckets, on one row.
///
/// A struct rather than five loose columns, so the same shape serves a supplier
/// and the grand total and nothing has to invent a supplier id for the footer.
#[derive(Clone, Debug, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AgingBuckets {
    /// Not yet due as at the reporting date.
    pub not_due_minor: i64,
    pub days_1_30_minor: i64,
    pub days_31_60_minor: i64,
    pub days_61_90_minor: i64,
    pub days_over_90_minor: i64,
    pub total_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayablesAgingRow {
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    /// How many bills are behind these figures — the difference between one
    /// disputed invoice and a supplier nobody has paid for a quarter.
    pub bill_count: i64,
    /// The age of the oldest thing still outstanding, in days. Negative when
    /// nothing this supplier is owed has fallen due yet.
    pub oldest_days: i32,
    pub buckets: AgingBuckets,
}

/// What is owed, to whom, and how late.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayablesAging {
    pub as_of: NaiveDate,
    pub site_id: Option<String>,
    /// Heaviest first: an ageing report is read to decide who to pay next.
    pub suppliers: Vec<PayablesAgingRow>,
    pub total: AgingBuckets,
}

/// Ageing over the bills, as at a date.
///
/// # Why this is not summed from `journal_line`
///
/// Every other balance in this module is, and deliberately. This one is not,
/// because ageing is a question about DOCUMENTS: which bill, dated when, due
/// when. The ledger carries a supplier on the line and no due date at all, so
/// a journal-derived ageing would have to guess terms from the posting date.
/// The two do not disagree — `trade_payable` totals what the outstanding
/// column below totals, because both move only when a bill or a payment posts.
///
/// # What "as at" means
///
/// Both sides are wound back: a bill invoiced after the date is not yet a debt,
/// and a payment made after it has not yet happened. Asking for last month end
/// therefore gives what last month end actually looked like, not today's
/// balances bucketed by last month's calendar.
///
/// A bill with no due date is aged from its invoice date. That is a guess and a
/// visible one: the alternative is to call an undated bill "not due" forever,
/// which hides the oldest debts in the one bucket nobody chases.
pub async fn payables_aging(
    pool: &PgPool,
    as_of: NaiveDate,
    site_id: Option<&str>,
) -> Result<PayablesAging, AppError> {
    let rows = sqlx::query(
        "WITH open_bill AS (
             SELECT i.supplier_id,
                    i.supplier_name,
                    ($1::date - COALESCE(i.due_date, i.invoice_date))::int AS age_days,
                    i.total_minor - COALESCE((
                        SELECT SUM(al.amount_minor)
                          FROM supplier_payment_allocation al
                          JOIN supplier_payment p USING (payment_id)
                         WHERE al.invoice_id = i.invoice_id
                           AND p.status = 'POSTED'
                           AND p.payment_date <= $1), 0) AS outstanding_minor
               FROM supplier_invoice i
              WHERE i.status = 'POSTED'
                AND i.invoice_date <= $1
                AND ($2::text IS NULL OR i.site_id = $2)
         )
         SELECT supplier_id,
                MAX(supplier_name) AS supplier_name,
                COUNT(*)::bigint AS bill_count,
                MAX(age_days)::int AS oldest_days,
                SUM(outstanding_minor) FILTER (WHERE age_days <= 0)::bigint AS not_due,
                SUM(outstanding_minor) FILTER (WHERE age_days BETWEEN 1 AND 30)::bigint AS d1_30,
                SUM(outstanding_minor) FILTER (WHERE age_days BETWEEN 31 AND 60)::bigint AS d31_60,
                SUM(outstanding_minor) FILTER (WHERE age_days BETWEEN 61 AND 90)::bigint AS d61_90,
                SUM(outstanding_minor) FILTER (WHERE age_days > 90)::bigint AS d90_plus,
                SUM(outstanding_minor)::bigint AS total
           FROM open_bill
          WHERE outstanding_minor > 0
          GROUP BY supplier_id
          ORDER BY SUM(outstanding_minor) DESC, supplier_id",
    )
    .bind(as_of)
    .bind(site_id)
    .fetch_all(pool)
    .await?;

    let mut suppliers = Vec::with_capacity(rows.len());
    let mut total = AgingBuckets::default();
    for row in &rows {
        // A bucket with nothing in it comes back NULL from a FILTER, and a
        // missing bucket and an empty one are the same thing to a reader of a
        // report. Zero, not a gap — the same argument `BalanceRow::cells`
        // makes about a location with nothing posted.
        let buckets = AgingBuckets {
            not_due_minor: row
                .try_get::<Option<i64>, _>("not_due")?
                .unwrap_or_default(),
            days_1_30_minor: row.try_get::<Option<i64>, _>("d1_30")?.unwrap_or_default(),
            days_31_60_minor: row.try_get::<Option<i64>, _>("d31_60")?.unwrap_or_default(),
            days_61_90_minor: row.try_get::<Option<i64>, _>("d61_90")?.unwrap_or_default(),
            days_over_90_minor: row
                .try_get::<Option<i64>, _>("d90_plus")?
                .unwrap_or_default(),
            total_minor: row.try_get::<Option<i64>, _>("total")?.unwrap_or_default(),
        };
        total.not_due_minor += buckets.not_due_minor;
        total.days_1_30_minor += buckets.days_1_30_minor;
        total.days_31_60_minor += buckets.days_31_60_minor;
        total.days_61_90_minor += buckets.days_61_90_minor;
        total.days_over_90_minor += buckets.days_over_90_minor;
        total.total_minor += buckets.total_minor;
        suppliers.push(PayablesAgingRow {
            supplier_id: row.try_get("supplier_id")?,
            supplier_name: row.try_get("supplier_name")?,
            bill_count: row.try_get("bill_count")?,
            oldest_days: row.try_get("oldest_days")?,
            buckets,
        });
    }

    Ok(PayablesAging {
        as_of,
        site_id: site_id.map(str::to_string),
        suppliers,
        total,
    })
}
