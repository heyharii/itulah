//! BKK and BKM as vouchers with lines (0711).
//!
//! The client kept its cash book in SeventhSoft, where a Bukti Kas/Bank Keluar
//! is one slip that can settle several of a supplier's bills (with a POTONGAN
//! on each), pay other accounts beside them (bank charges, electricity), and
//! net off what the supplier owes back — and a Bukti Kas/Bank Masuk is its
//! mirror. The owner wants the hub to keep that document exactly
//! (2026-09-29), so the team is not surprised on the day they switch.
//!
//! A voucher is a `cash_document` with `has_lines`: its header holds the money
//! account, how it was paid and the party; its lines hold everything on the
//! other side. It is keyed, approved (the KK / KM number, 0701) and posted like
//! any cash document, and posts **one** journal entry:
//!
//! ```text
//!   BKK   Dr payable per bill settled (the whole of it, POTONGAN included)
//!         Dr each other line
//!         Cr settlement_discount          the POTONGAN
//!         Cr advance_purchase             each advance netted off
//!         Cr the cash / bank account      what left   (giro_outstanding for a giro)
//!
//!   BKM   Dr the cash / bank account      what arrived (giro_outstanding for a giro)
//!         Cr each other line
//! ```
//!
//! # Why a voucher that settles bills also writes a supplier payment
//!
//! Every screen that answers "who is owed what" — the bill list, Accounts
//! Payable, the supplier's ledger, the Payment Entry register — reads
//! `supplier_payment_allocation`, and its triggers are what refuse paying a
//! bill twice. A voucher that kept its own copy of that would be a second
//! answer to the question, and the two would drift. So posting a voucher
//! writes the payment and its allocations in the same transaction, numbered
//! as the voucher is, and an advance netted off is written where every other
//! advance application is.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use super::cash::{resolve_side, side_line, CashSide};
use super::poster::{post, PostingIntent, PostingLine, Posted};
use crate::cloud::application::AppError;

/// The money keys a supplier payment can leave from (`supplier_payment`'s own
/// CHECK). A voucher that settles bills is written as one, so it is held to it.
const PAYMENT_MONEY_KEYS: [&str; 4] = ["bank_giro", "bank_savings", "cash", "petty_cash"];

/// The two banks a giro can be drawn on or deposited into.
const GIRO_MONEY_KEYS: [&str; 2] = ["bank_giro", "bank_savings"];

/// Meanings a line on the Other tab may not name, because another tab is where
/// that money belongs: a payable is settled bill by bill, and an advance is
/// netted off by name, or the payables ledger stops agreeing with the books.
const NOT_AN_OTHER_LINE: [&str; 3] = [
    "trade_payable",
    "non_merchandise_payable",
    "advance_purchase",
];

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/// One line of a voucher, as the screen sends it.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoucherLineRequest {
    /// `SETTLE` (a bill), `OTHER` (any other account) or `OFFSET` (an advance
    /// netted off).
    pub kind: String,
    /// SETTLE: the bill.
    #[serde(default)]
    pub invoice_id: Option<Uuid>,
    /// OFFSET: the advance.
    #[serde(default)]
    pub advance_id: Option<Uuid>,
    /// OTHER: the account, named the way a cash document side names one.
    #[serde(default)]
    pub account: Option<CashSide>,
    /// SETTLE: how much of the bill this settles, POTONGAN included. OTHER:
    /// what is paid or received. OFFSET: what is netted off.
    pub amount_minor: i64,
    /// SETTLE only: the POTONGAN — part of `amount_minor` settled without money.
    #[serde(default)]
    pub discount_minor: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
}

/// A BKK (`direction: OUT`) or a BKM (`direction: IN`).
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordVoucherRequest {
    pub doc_date: NaiveDate,
    /// `OUT` for a BKK, `IN` for a BKM.
    pub direction: String,
    /// The cash or bank account, by meaning — `cash`, `petty_cash`,
    /// `bank_giro` with the bank as qualifier — in a unit's books.
    pub money: CashSide,
    /// `CASH`, `TRANSFER` or `GIRO`.
    pub method: String,
    #[serde(default)]
    pub reference: Option<String>,
    /// GIRO: the number printed on it and the date on its face, together.
    #[serde(default)]
    pub giro_number: Option<String>,
    #[serde(default)]
    pub giro_due_date: Option<NaiveDate>,
    /// GIRO on a BKM: the bank the customer's giro is drawn on.
    #[serde(default)]
    pub giro_bank: Option<String>,
    /// `SUPPLIER`, `EMPLOYEE` or `OTHER`.
    #[serde(default)]
    pub party_type: Option<String>,
    #[serde(default)]
    pub supplier_id: Option<String>,
    #[serde(default)]
    pub employee_id: Option<String>,
    /// What the slip prints on the "dibayarkan kepada / diterima dari" line.
    pub party_name: String,
    /// The note printed on the slip.
    pub memo: String,
    pub lines: Vec<VoucherLineRequest>,
}

/// A voucher line as a screen reads it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CashDocumentLineRow {
    pub line_no: i32,
    pub kind: String,
    pub invoice_id: Option<Uuid>,
    pub invoice_number: Option<String>,
    pub invoice_due_date: Option<NaiveDate>,
    pub advance_id: Option<Uuid>,
    pub advance_number: Option<String>,
    pub semantic_key: Option<String>,
    pub qualifier: String,
    pub account_code: Option<String>,
    pub category_code: Option<String>,
    pub unit_id: Option<String>,
    pub amount_minor: i64,
    pub discount_minor: i64,
    pub note: Option<String>,
}

pub(super) async fn voucher_lines(
    executor: impl sqlx::PgExecutor<'_>,
    document_id: Uuid,
) -> Result<Vec<CashDocumentLineRow>, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_no, l.kind, l.invoice_id, i.invoice_number, i.due_date AS invoice_due_date,
                l.advance_id, a.advance_number, l.semantic_key, l.qualifier, l.account_code,
                l.category_code, l.unit_id, l.amount_minor, l.discount_minor, l.note
           FROM cash_document_line l
           LEFT JOIN supplier_invoice i ON i.invoice_id = l.invoice_id
           LEFT JOIN supplier_advance a ON a.advance_id = l.advance_id
          WHERE l.document_id = $1
          ORDER BY l.line_no",
    )
    .bind(document_id)
    .fetch_all(executor)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(CashDocumentLineRow {
                line_no: row.try_get("line_no")?,
                kind: row.try_get("kind")?,
                invoice_id: row.try_get("invoice_id")?,
                invoice_number: row.try_get("invoice_number")?,
                invoice_due_date: row.try_get("invoice_due_date")?,
                advance_id: row.try_get("advance_id")?,
                advance_number: row.try_get("advance_number")?,
                semantic_key: row.try_get("semantic_key")?,
                qualifier: row.try_get("qualifier")?,
                account_code: row.try_get("account_code")?,
                category_code: row.try_get("category_code")?,
                unit_id: row.try_get("unit_id")?,
                amount_minor: row.try_get("amount_minor")?,
                discount_minor: row.try_get("discount_minor")?,
                note: row.try_get("note")?,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Keying one
// ---------------------------------------------------------------------------

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// What a supplier still owes on one posted bill, counted the way the payables
/// screens count it: the bill, less what posted payments and applied advances
/// have already answered.
async fn bill_open(
    pool: &PgPool,
    invoice_id: Uuid,
) -> Result<(String, String, String, i64), AppError> {
    let row = sqlx::query(
        "SELECT i.invoice_number, i.supplier_id, i.status,
                (i.total_minor
                  - COALESCE((SELECT SUM(al.amount_minor)
                                FROM supplier_payment_allocation al
                                JOIN supplier_payment p USING (payment_id)
                               WHERE al.invoice_id = i.invoice_id AND p.status = 'POSTED'), 0)
                  - COALESCE((SELECT SUM(ap.amount_minor)
                                FROM supplier_advance_application ap
                               WHERE ap.invoice_id = i.invoice_id), 0)
                  -- A contractor's advance set against the bill (0723).
                  - COALESCE((SELECT SUM(cpi.applied_minor)
                                FROM contractor_project_invoice cpi
                               WHERE cpi.invoice_id = i.invoice_id), 0))::bigint AS open_minor
           FROM supplier_invoice i WHERE i.invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("supplier bill".into()))?;
    Ok((
        row.try_get("invoice_number")?,
        row.try_get("supplier_id")?,
        row.try_get("status")?,
        row.try_get::<Option<i64>, _>("open_minor")?.unwrap_or(0),
    ))
}

/// What is left of one posted advance.
async fn advance_open(
    pool: &PgPool,
    advance_id: Uuid,
) -> Result<(String, String, String, i64), AppError> {
    let row = sqlx::query(
        "SELECT a.advance_number, a.supplier_id, a.status,
                (a.amount_minor - COALESCE((SELECT SUM(ap.amount_minor)
                                             FROM supplier_advance_application ap
                                            WHERE ap.advance_id = a.advance_id), 0))::bigint AS open_minor
           FROM supplier_advance a WHERE a.advance_id = $1",
    )
    .bind(advance_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("supplier advance".into()))?;
    Ok((
        row.try_get("advance_number")?,
        row.try_get("supplier_id")?,
        row.try_get("status")?,
        row.try_get::<Option<i64>, _>("open_minor")?.unwrap_or(0),
    ))
}

/// A line checked and ready to write.
struct CheckedLine {
    kind: &'static str,
    invoice_id: Option<Uuid>,
    advance_id: Option<Uuid>,
    semantic_key: Option<String>,
    qualifier: String,
    account_code: Option<String>,
    category_code: Option<String>,
    unit_id: Option<String>,
    amount_minor: i64,
    discount_minor: i64,
    note: Option<String>,
}

pub async fn voucher_record(
    pool: &PgPool,
    request: &RecordVoucherRequest,
    actor: &str,
) -> Result<super::cash::CashDocumentRow, AppError> {
    let direction = request.direction.trim().to_ascii_uppercase();
    let out = match direction.as_str() {
        "OUT" => true,
        "IN" => false,
        other => {
            return Err(AppError::Validation(format!(
                "'{other}' is not a direction; a BKK is OUT and a BKM is IN"
            )))
        }
    };
    let slip = if out { "BKK" } else { "BKM" };

    let memo = request.memo.trim();
    if memo.is_empty() {
        return Err(AppError::Validation(format!(
            "a {slip} needs a note; it is the line the slip prints and the only record of why"
        )));
    }
    let party_name = request.party_name.trim();
    if party_name.is_empty() {
        return Err(AppError::Validation(format!(
            "a {slip} names who the money is {}; the slip has a line for it",
            if out { "paid to" } else { "received from" }
        )));
    }

    // The party, in the same three shapes a cash document has.
    let party_type = request
        .party_type
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_uppercase)
        .unwrap_or_else(|| "OTHER".to_string());
    let supplier_id = trimmed(request.supplier_id.as_deref());
    let employee_id = trimmed(request.employee_id.as_deref());
    match party_type.as_str() {
        "SUPPLIER" if supplier_id.is_none() => {
            return Err(AppError::Validation(format!(
                "a {slip} to a supplier must say which supplier"
            )))
        }
        "EMPLOYEE" if employee_id.is_none() => {
            return Err(AppError::Validation(format!(
                "a {slip} to an employee must say which employee"
            )))
        }
        "SUPPLIER" | "EMPLOYEE" | "OTHER" => {}
        other => {
            return Err(AppError::Validation(format!(
                "'{other}' is not a party; expected SUPPLIER, EMPLOYEE or OTHER"
            )))
        }
    }
    let supplier_id = supplier_id.filter(|_| party_type == "SUPPLIER");
    let employee_id = employee_id.filter(|_| party_type == "EMPLOYEE");

    // The money account: one of ours, named by its meaning.
    let money = resolve_side(pool, &request.money, "cash / bank").await?;
    let money_key = match (&money.key, money.money) {
        (Some(key), true) => key.clone(),
        _ => {
            return Err(AppError::Validation(format!(
                "the cash / bank account of a {slip} must be one of our cash or bank accounts, \
                 named by its meaning (cash, petty cash, a bank)"
            )))
        }
    };

    // How it was paid, and the giro when it was one.
    let method = request.method.trim().to_ascii_uppercase();
    if !["CASH", "TRANSFER", "GIRO"].contains(&method.as_str()) {
        return Err(AppError::Validation(format!(
            "'{method}' is not a way to pay; expected CASH, TRANSFER or GIRO"
        )));
    }
    let giro_number = trimmed(request.giro_number.as_deref());
    let giro_bank = trimmed(request.giro_bank.as_deref());
    if method == "GIRO" {
        let (Some(number), Some(due)) = (giro_number.as_deref(), request.giro_due_date) else {
            return Err(AppError::Validation(
                "a giro needs the number printed on it and the date on its face, together".into(),
            ));
        };
        if due < request.doc_date {
            return Err(AppError::Validation(format!(
                "giro {number} is dated {due} and the {slip} {}; a giro falls due after it is \
                 written",
                request.doc_date
            )));
        }
        if !out && giro_bank.is_none() {
            return Err(AppError::Validation(format!(
                "which bank giro {number} is drawn on — it is how the bank will know it"
            )));
        }
        if !GIRO_MONEY_KEYS.contains(&money_key.as_str()) {
            return Err(AppError::Validation(
                "a giro is drawn on, or deposited into, a bank account; choose a bank as the \
                 cash / bank account"
                    .into(),
            ));
        }
        // The outstanding-giro account is kept per bank; an unmapped bank is
        // refused while somebody is still looking at the form.
        super::ledger::resolve_account_code(pool, "giro_outstanding", &money.unit_id, &money.qualifier)
            .await?;
    } else if giro_number.is_some() || request.giro_due_date.is_some() {
        return Err(AppError::Validation(format!(
            "a {method} {slip} carries no giro number or due date; change the method to GIRO, \
             or drop them"
        )));
    }

    if request.lines.is_empty() {
        return Err(AppError::Validation(format!(
            "a {slip} with no lines pays nothing; settle a bill or add a line"
        )));
    }

    let mut checked: Vec<CheckedLine> = Vec::with_capacity(request.lines.len());
    let mut seen_bills: Vec<Uuid> = Vec::new();
    let mut seen_advances: Vec<Uuid> = Vec::new();
    let (mut settled, mut discount, mut other, mut offset) = (0_i64, 0_i64, 0_i64, 0_i64);
    for (index, line) in request.lines.iter().enumerate() {
        let n = index + 1;
        if line.amount_minor <= 0 {
            return Err(AppError::Validation(format!(
                "line {n} has no amount; every line moves a positive amount"
            )));
        }
        let note = trimmed(line.note.as_deref());
        match line.kind.trim().to_ascii_uppercase().as_str() {
            "SETTLE" => {
                let Some(invoice_id) = line.invoice_id else {
                    return Err(AppError::Validation(format!("line {n} settles no bill")));
                };
                if !out {
                    return Err(AppError::Validation(
                        "a BKM receives money; bills are settled on a BKK".into(),
                    ));
                }
                let Some(supplier) = supplier_id.as_deref() else {
                    return Err(AppError::Validation(
                        "bills are settled for a supplier; choose the supplier first".into(),
                    ));
                };
                if seen_bills.contains(&invoice_id) {
                    return Err(AppError::Validation(format!(
                        "line {n} settles a bill that is already on this BKK; add the two \
                         amounts together instead"
                    )));
                }
                seen_bills.push(invoice_id);
                let (number, bill_supplier, status, open) = bill_open(pool, invoice_id).await?;
                if bill_supplier != supplier {
                    return Err(AppError::Validation(format!(
                        "bill {number} is {bill_supplier}'s, not {party_name}'s"
                    )));
                }
                if status != "POSTED" {
                    return Err(AppError::Validation(format!(
                        "bill {number} is {}; only a posted bill is owed",
                        status.to_lowercase()
                    )));
                }
                let disc = line.discount_minor.unwrap_or(0);
                if disc < 0 || disc > line.amount_minor {
                    return Err(AppError::Validation(format!(
                        "the discount on bill {number} is {disc}, which is not between nothing \
                         and the {} this line settles",
                        line.amount_minor
                    )));
                }
                if line.amount_minor > open {
                    return Err(AppError::Validation(format!(
                        "bill {number} has {open} still open and this line settles {}; that \
                         would pay more than is owed",
                        line.amount_minor
                    )));
                }
                settled += line.amount_minor;
                discount += disc;
                checked.push(CheckedLine {
                    kind: "SETTLE",
                    invoice_id: Some(invoice_id),
                    advance_id: None,
                    semantic_key: None,
                    qualifier: String::new(),
                    account_code: None,
                    category_code: None,
                    unit_id: None,
                    amount_minor: line.amount_minor,
                    discount_minor: disc,
                    note,
                });
            }
            "OFFSET" => {
                let Some(advance_id) = line.advance_id else {
                    return Err(AppError::Validation(format!("line {n} nets off nothing")));
                };
                if !out {
                    return Err(AppError::Validation(
                        "a BKM nets off nothing yet; an advance is netted off on a BKK".into(),
                    ));
                }
                let Some(supplier) = supplier_id.as_deref() else {
                    return Err(AppError::Validation(
                        "an advance is netted off for a supplier; choose the supplier first"
                            .into(),
                    ));
                };
                if seen_advances.contains(&advance_id) {
                    return Err(AppError::Validation(format!(
                        "line {n} nets off an advance that is already on this BKK"
                    )));
                }
                seen_advances.push(advance_id);
                let (number, advance_supplier, status, open) =
                    advance_open(pool, advance_id).await?;
                if advance_supplier != supplier {
                    return Err(AppError::Validation(format!(
                        "advance {number} was paid to {advance_supplier}, not {party_name}"
                    )));
                }
                if status != "POSTED" {
                    return Err(AppError::Validation(format!(
                        "advance {number} is {}; only an advance that was paid can be netted off",
                        status.to_lowercase()
                    )));
                }
                if line.amount_minor > open {
                    return Err(AppError::Validation(format!(
                        "advance {number} has {open} left and this line nets off {}",
                        line.amount_minor
                    )));
                }
                offset += line.amount_minor;
                checked.push(CheckedLine {
                    kind: "OFFSET",
                    invoice_id: None,
                    advance_id: Some(advance_id),
                    semantic_key: None,
                    qualifier: String::new(),
                    account_code: None,
                    category_code: None,
                    unit_id: None,
                    amount_minor: line.amount_minor,
                    discount_minor: 0,
                    note,
                });
            }
            "OTHER" => {
                let Some(account) = line.account.as_ref() else {
                    return Err(AppError::Validation(format!("line {n} names no account")));
                };
                let side = resolve_side(pool, account, &format!("line {n}")).await?;
                if side.money {
                    return Err(AppError::Validation(format!(
                        "line {n} is one of our own cash or bank accounts; moving money between \
                         two of ours is a transfer, not a {slip} line"
                    )));
                }
                if let Some(key) = side.key.as_deref() {
                    if NOT_AN_OTHER_LINE.contains(&key) {
                        return Err(AppError::Validation(format!(
                            "line {n} names '{key}'; a bill is settled on the Settle tab and an \
                             advance netted off on the Offset tab, so the payables stay in step"
                        )));
                    }
                }
                other += line.amount_minor;
                checked.push(CheckedLine {
                    kind: "OTHER",
                    invoice_id: None,
                    advance_id: None,
                    semantic_key: side.key.clone(),
                    qualifier: side.qualifier.clone(),
                    account_code: side.account_code.clone(),
                    category_code: if side.key.is_some() {
                        None
                    } else {
                        side.category_code.clone()
                    },
                    unit_id: Some(side.unit_id.clone()),
                    amount_minor: line.amount_minor,
                    discount_minor: 0,
                    note,
                });
            }
            kind => {
                return Err(AppError::Validation(format!(
                    "line {n} is a '{kind}'; a line settles a bill (SETTLE), pays or receives \
                     another account (OTHER) or nets off an advance (OFFSET)"
                )))
            }
        }
    }

    if offset > settled - discount {
        return Err(AppError::Validation(format!(
            "the advances netted off ({offset}) are more than the bills settled pay ({}); an \
             advance answers a bill, so settle the bill it is for",
            settled - discount
        )));
    }
    if settled > 0 && !PAYMENT_MONEY_KEYS.contains(&money_key.as_str()) {
        return Err(AppError::Validation(format!(
            "bills are paid from a bank, cash or petty cash; '{money_key}' cannot pay a bill"
        )));
    }
    let total = settled - discount + other - offset;
    if total <= 0 {
        return Err(AppError::Validation(format!(
            "this {slip} moves nothing: the bills settled less the discount, plus the other \
             lines, less what is netted off, comes to {total}"
        )));
    }

    let document_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    let (from_key, from_q, from_unit, to_key, to_q, to_unit) = if out {
        (
            Some(money_key.clone()),
            money.qualifier.clone(),
            money.unit_id.clone(),
            None,
            String::new(),
            money.unit_id.clone(),
        )
    } else {
        (
            None,
            String::new(),
            money.unit_id.clone(),
            Some(money_key.clone()),
            money.qualifier.clone(),
            money.unit_id.clone(),
        )
    };
    sqlx::query(
        "INSERT INTO cash_document
           (document_id, kind, doc_date,
            from_key, from_qualifier, from_unit, to_key, to_qualifier, to_unit,
            amount_minor, currency, party_type, supplier_id, employee_id, party_name,
            memo, method, reference, giro_number, giro_due_date, giro_bank, has_lines,
            created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'IDR',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                 true,$21)",
    )
    .bind(document_id)
    .bind(if out { "PAY" } else { "RECEIVE" })
    .bind(request.doc_date)
    .bind(from_key)
    .bind(from_q)
    .bind(from_unit)
    .bind(to_key)
    .bind(to_q)
    .bind(to_unit)
    .bind(total)
    .bind(&party_type)
    .bind(supplier_id.as_deref())
    .bind(employee_id.as_deref())
    .bind(party_name)
    .bind(memo)
    .bind(&method)
    .bind(trimmed(request.reference.as_deref()))
    .bind(giro_number.as_deref())
    .bind(request.giro_due_date.filter(|_| method == "GIRO"))
    .bind(giro_bank.as_deref().filter(|_| method == "GIRO"))
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    for (index, line) in checked.iter().enumerate() {
        sqlx::query(
            "INSERT INTO cash_document_line
               (document_id, line_no, kind, invoice_id, advance_id, semantic_key, qualifier,
                account_code, category_code, unit_id, amount_minor, discount_minor, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        )
        .bind(document_id)
        .bind(index as i32 + 1)
        .bind(line.kind)
        .bind(line.invoice_id)
        .bind(line.advance_id)
        .bind(line.semantic_key.as_deref())
        .bind(&line.qualifier)
        .bind(line.account_code.as_deref())
        .bind(line.category_code.as_deref())
        .bind(line.unit_id.as_deref())
        .bind(line.amount_minor)
        .bind(line.discount_minor)
        .bind(line.note.as_deref())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    super::cash::cash_document_read(pool, document_id).await
}

// ---------------------------------------------------------------------------
// Posting one
// ---------------------------------------------------------------------------

/// Which advance answers which bill, and by how much.
///
/// The advances netted off on a voucher are set against its bills in the order
/// the lines were keyed, each bill taking no more than it pays in money (its
/// settlement less its POTONGAN, so the payment written beside it can still
/// carry the POTONGAN). Deterministic from the lines alone, so a reversal
/// finds exactly what posting wrote.
fn applications(lines: &[CashDocumentLineRow]) -> Vec<(Uuid, Uuid, i64)> {
    let mut advances: Vec<(Uuid, i64)> = lines
        .iter()
        .filter(|line| line.kind == "OFFSET")
        .filter_map(|line| line.advance_id.map(|id| (id, line.amount_minor)))
        .collect();
    let mut out = Vec::new();
    for bill in lines.iter().filter(|line| line.kind == "SETTLE") {
        let Some(invoice_id) = bill.invoice_id else {
            continue;
        };
        let mut room = bill.amount_minor - bill.discount_minor;
        for advance in advances.iter_mut() {
            if room == 0 {
                break;
            }
            let take = advance.1.min(room);
            if take > 0 {
                out.push((advance.0, invoice_id, take));
                advance.1 -= take;
                room -= take;
            }
        }
    }
    out
}

/// Post an approved voucher: one entry, then the payment, the advance
/// applications, the payables ledger and the giro that follow from it.
pub(super) async fn voucher_post_in(
    tx: &mut Transaction<'_, Postgres>,
    document_id: Uuid,
    posting_date: Option<NaiveDate>,
    actor: &str,
) -> Result<Posted, AppError> {
    let row = sqlx::query(
        "SELECT kind, number, doc_date, amount_minor, currency, memo, party_name, supplier_id,
                from_key, from_qualifier, from_unit, to_key, to_qualifier, to_unit,
                method, reference, giro_number, giro_due_date
           FROM cash_document WHERE document_id = $1",
    )
    .bind(document_id)
    .fetch_one(&mut **tx)
    .await?;
    let out = row.try_get::<String, _>("kind")? == "PAY";
    let number: String = row
        .try_get::<Option<String>, _>("number")?
        .unwrap_or_else(|| document_id.to_string());
    let doc_date: NaiveDate = row.try_get("doc_date")?;
    let total: i64 = row.try_get("amount_minor")?;
    let currency: String = row.try_get("currency")?;
    let memo: String = row.try_get("memo")?;
    let party: String = row.try_get("party_name")?;
    let supplier_id: Option<String> = row.try_get("supplier_id")?;
    let method: String = row.try_get("method")?;
    let (money_key, money_q, money_unit): (String, String, String) = if out {
        (
            row.try_get::<Option<String>, _>("from_key")?.unwrap_or_default(),
            row.try_get("from_qualifier")?,
            row.try_get("from_unit")?,
        )
    } else {
        (
            row.try_get::<Option<String>, _>("to_key")?.unwrap_or_default(),
            row.try_get("to_qualifier")?,
            row.try_get("to_unit")?,
        )
    };
    let giro = method == "GIRO";
    let lines = voucher_lines(&mut **tx, document_id).await?;
    let head_office = super::sites::head_office_unit_id(&mut **tx).await?;

    let mut entry: Vec<PostingLine> = Vec::with_capacity(lines.len() + 2);
    let mut discount = 0_i64;
    for line in &lines {
        match line.kind.as_str() {
            "SETTLE" => {
                let Some(invoice_id) = line.invoice_id else {
                    continue;
                };
                let bill = sqlx::query(
                    "SELECT invoice_number, kind, supplier_id FROM supplier_invoice
                      WHERE invoice_id = $1",
                )
                .bind(invoice_id)
                .fetch_one(&mut **tx)
                .await?;
                let kind: String = bill.try_get("kind")?;
                let bill_supplier: String = bill.try_get("supplier_id")?;
                let invoice_number: String = bill.try_get("invoice_number")?;
                // In head office's books, where the bill credited the payable
                // (I4) — the same place `post_payment` clears it.
                let mut posting = PostingLine::debit(
                    super::payables_flow::payable_key(kind == "EXPENSE"),
                    &head_office,
                    line.amount_minor,
                )
                .for_supplier(&bill_supplier);
                posting.memo = Some(format!("{invoice_number} {party}"));
                entry.push(posting);
                discount += line.discount_minor;
            }
            "OTHER" => {
                let unit = line.unit_id.clone().unwrap_or_else(|| money_unit.clone());
                let note = line.note.clone().unwrap_or_else(|| memo.clone());
                entry.push(side_line(
                    line.semantic_key.as_deref(),
                    &line.qualifier,
                    line.account_code.as_deref(),
                    line.category_code.as_deref(),
                    &unit,
                    if out { line.amount_minor } else { 0 },
                    if out { 0 } else { line.amount_minor },
                    &note,
                ));
            }
            "OFFSET" => {
                let Some(advance_id) = line.advance_id else {
                    continue;
                };
                let advance = sqlx::query(
                    "SELECT advance_number, unit_id, supplier_id FROM supplier_advance
                      WHERE advance_id = $1",
                )
                .bind(advance_id)
                .fetch_one(&mut **tx)
                .await?;
                let advance_unit: String = advance.try_get("unit_id")?;
                let advance_supplier: String = advance.try_get("supplier_id")?;
                let advance_number: String = advance.try_get("advance_number")?;
                let mut posting = PostingLine::credit(
                    super::payables_flow::ADVANCE,
                    &advance_unit,
                    line.amount_minor,
                )
                .for_supplier(&advance_supplier);
                posting.memo = Some(format!("{advance_number} netted off"));
                entry.push(posting);
            }
            _ => {}
        }
    }
    if discount > 0 {
        entry.push(PostingLine::credit(
            super::payables_flow::SETTLEMENT_DISCOUNT,
            &head_office,
            discount,
        ));
    }
    // What left or arrived. A giro is not money yet: it sits on the
    // outstanding-giro account for its bank until the bank takes it.
    let money_line_key = if giro { "giro_outstanding" } else { money_key.as_str() };
    let money_line = if out {
        PostingLine::credit(money_line_key, &money_unit, total)
    } else {
        PostingLine::debit(money_line_key, &money_unit, total)
    }
    .with_qualifier(&money_q);
    entry.push(money_line);

    let intent = PostingIntent {
        posting_date: posting_date.unwrap_or(doc_date),
        source_kind: "CASH_DOC".into(),
        source_id: Some(document_id.to_string()),
        rule_version: "cash_voucher/1".into(),
        currency: currency.clone(),
        memo: Some(format!("{number} {party} — {memo}")),
        lines: entry,
    };
    let posted = post(tx, &intent, None, actor).await?;

    sqlx::query(
        "UPDATE cash_document
            SET status='POSTED', journal_entry_id=$2, posted_by=$3, posted_at=now()
          WHERE document_id=$1",
    )
    .bind(document_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    // Bills settled: the payment every payables screen reads, and the
    // payables ledger told which bills were answered.
    let applied = applications(&lines);
    let settle_lines: Vec<&CashDocumentLineRow> =
        lines.iter().filter(|line| line.kind == "SETTLE").collect();
    if let (false, Some(supplier)) = (settle_lines.is_empty(), supplier_id.as_deref()) {
        let allocations: Vec<(Uuid, i64, i64)> = settle_lines
            .iter()
            .filter_map(|line| {
                let invoice_id = line.invoice_id?;
                let by_advance: i64 = applied
                    .iter()
                    .filter(|(_, bill, _)| *bill == invoice_id)
                    .map(|(_, _, amount)| amount)
                    .sum();
                let amount = line.amount_minor - by_advance;
                (amount > 0).then_some((invoice_id, amount, line.discount_minor))
            })
            .collect();
        let payment_total: i64 = allocations.iter().map(|(_, amount, _)| amount).sum();
        if payment_total > 0 {
            let payment_id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO supplier_payment
                   (payment_id, payment_number, unit_id, payment_date, method, account_key,
                    account_qualifier, currency, total_minor, reference, note, recorded_by,
                    giro_number, giro_due_date)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
            )
            .bind(payment_id)
            .bind(&number)
            .bind(&money_unit)
            .bind(doc_date)
            .bind(&method)
            .bind(&money_key)
            .bind(&money_q)
            .bind(&currency)
            .bind(payment_total)
            .bind(row.try_get::<Option<String>, _>("reference")?)
            .bind(format!("{number} — {memo}"))
            .bind(actor)
            .bind(row.try_get::<Option<String>, _>("giro_number")?)
            .bind(row.try_get::<Option<NaiveDate>, _>("giro_due_date")?)
            .execute(&mut **tx)
            .await?;
            for (invoice_id, amount, discount) in &allocations {
                sqlx::query(
                    "INSERT INTO supplier_payment_allocation
                         (payment_id, invoice_id, amount_minor, discount_minor)
                     VALUES ($1,$2,$3,$4)",
                )
                .bind(payment_id)
                .bind(invoice_id)
                .bind(amount)
                .bind((*discount).min(*amount))
                .execute(&mut **tx)
                .await?;
            }
            sqlx::query(
                "UPDATE supplier_payment
                    SET status='POSTED', journal_entry_id=$2, posted_by=$3, posted_at=now()
                  WHERE payment_id=$1",
            )
            .bind(payment_id)
            .bind(posted.entry_id)
            .bind(actor)
            .execute(&mut **tx)
            .await?;
            sqlx::query("UPDATE cash_document SET supplier_payment_id=$2 WHERE document_id=$1")
                .bind(document_id)
                .bind(payment_id)
                .execute(&mut **tx)
                .await?;
        }
        for (advance_id, invoice_id, amount) in &applied {
            sqlx::query(
                "INSERT INTO supplier_advance_application
                   (advance_id, invoice_id, amount_minor, journal_entry_id, applied_by)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (advance_id, invoice_id) DO UPDATE
                    SET amount_minor = supplier_advance_application.amount_minor
                                       + EXCLUDED.amount_minor",
            )
            .bind(advance_id)
            .bind(invoice_id)
            .bind(amount)
            .bind(posted.entry_id)
            .bind(actor)
            .execute(&mut **tx)
            .await?;
        }
        for line in &settle_lines {
            let Some(invoice_id) = line.invoice_id else {
                continue;
            };
            let kind: String =
                sqlx::query_scalar("SELECT kind FROM supplier_invoice WHERE invoice_id = $1")
                    .bind(invoice_id)
                    .fetch_one(&mut **tx)
                    .await?;
            super::payables_flow::payable_settled(
                tx,
                super::payables_flow::payable_key(kind == "EXPENSE"),
                &head_office,
                supplier,
                invoice_id,
                "CASH_DOC",
                document_id,
                line.amount_minor,
                intent.posting_date,
                posted.entry_id,
                actor,
            )
            .await?;
        }
    }

    // The paper itself, on the board from the moment it is in the books.
    if giro {
        let giro_number: Option<String> = row.try_get("giro_number")?;
        let due: Option<NaiveDate> = row.try_get("giro_due_date")?;
        if let (Some(giro_number), Some(due)) = (giro_number, due) {
            super::giro::giro_insert(
                tx,
                &super::giro::NewGiro {
                    direction: if out { "OUT" } else { "IN" },
                    number: giro_number,
                    bank: money_q.clone(),
                    unit_id: money_unit.clone(),
                    amount_minor: total,
                    issue_date: doc_date,
                    due_date: due,
                    supplier_payment_id: None,
                    cash_document_id: Some(document_id),
                    issue_entry_id: posted.entry_id,
                },
                actor,
            )
            .await?;
        }
    }

    Ok(posted)
}

/// Take back what a voucher settled, once its entry has been mirrored: the
/// payment written beside it is reversed and the advances it netted off are
/// free again. The payables ledger is delinked by the caller, which does that
/// for every cash document.
pub(super) async fn voucher_undo_settlement(
    tx: &mut Transaction<'_, Postgres>,
    document_id: Uuid,
    mirror_entry_id: Uuid,
    reason: &str,
    actor: &str,
) -> Result<(), AppError> {
    let payment_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT supplier_payment_id FROM cash_document WHERE document_id = $1",
    )
    .bind(document_id)
    .fetch_one(&mut **tx)
    .await?;
    if let Some(payment_id) = payment_id {
        sqlx::query(
            "UPDATE supplier_payment
                SET status='REVERSED', reversal_entry_id=$2, reversed_by=$3,
                    reversed_at=now(), reversal_reason=$4
              WHERE payment_id=$1 AND status='POSTED'",
        )
        .bind(payment_id)
        .bind(mirror_entry_id)
        .bind(actor)
        .bind(reason)
        .execute(&mut **tx)
        .await?;
    }
    let lines = voucher_lines(&mut **tx, document_id).await?;
    for (advance_id, invoice_id, amount) in applications(&lines) {
        sqlx::query(
            "DELETE FROM supplier_advance_application
              WHERE advance_id = $1 AND invoice_id = $2 AND amount_minor <= $3",
        )
        .bind(advance_id)
        .bind(invoice_id)
        .bind(amount)
        .execute(&mut **tx)
        .await?;
        sqlx::query(
            "UPDATE supplier_advance_application SET amount_minor = amount_minor - $3
              WHERE advance_id = $1 AND invoice_id = $2 AND amount_minor > $3",
        )
        .bind(advance_id)
        .bind(invoice_id)
        .bind(amount)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}
