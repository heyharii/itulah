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

use super::payables::PayableFacet;
use super::poster::{post, PostingIntent, PostingLine};
use super::{decode_cursor, encode_cursor};
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
    /// `TRANSFER`, `CASH`, `GIRO` or `OTHER`.
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

// ---------------------------------------------------------------------------
// The payment register: searched, filtered, sorted and paged
// ---------------------------------------------------------------------------
//
// The same envelope the bill list answers in, which is the one `money_overview`
// established. Three lists, one shape, one hook in the browser — see the note
// above `PayableFacet` in `payables`.

/// The two things a payment register is narrowed by that are worth counting.
///
/// Method as well as status, because they answer different questions and both
/// get asked: status is "what still has to be booked", method is "what left by
/// giro this month". Neither list runs past six values, which is what makes
/// them facets rather than search boxes — `supplier` is a filter here too and
/// is deliberately not counted.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentFacets {
    pub statuses: Vec<PayableFacet>,
    pub methods: Vec<PayableFacet>,
}

/// A page of supplier payments, and what the whole matched set comes to.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentPage {
    /// This page, each row with its allocations attached — one extra query for
    /// the page rather than one per row.
    pub rows: Vec<SupplierPayment>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one, and always absent when the caller sent no `limit`.
    /// See `BillPage::next_cursor`, which makes the argument in full.
    pub next_cursor: Option<String>,
    /// Every payment the search and filters match, not just this page.
    pub total: i64,
    /// What those payments come to, added HERE and not in the browser: a paged
    /// list summed on the client gives a figure that grows while somebody
    /// scrolls.
    ///
    /// The sum is over the payments, not over their allocations. A payment
    /// filtered to one supplier is still counted at its full value, because
    /// what left the bank is what left the bank — a bank line settling two
    /// suppliers does not become two smaller bank lines because a reader
    /// narrowed to one of them.
    pub total_minor: i64,
    pub facets: PaymentFacets,
}

/// What a caller is asking the payment register for.
#[derive(Clone, Debug, Default)]
pub struct PaymentScope {
    /// Free text, tried against the payment number and the reference — the
    /// number this system gave it, and the number the bank did. Somebody
    /// holding a bank statement has the second and not the first.
    pub needle: Option<String>,
    /// Empty means every status. Passed through unvalidated, for the reason
    /// given on `BillScope::statuses`.
    pub statuses: Vec<String>,
    pub sites: Vec<String>,
    /// Who was paid. It lives on the allocations, not on the payment: one bank
    /// line settling two suppliers is an ordinary Friday, so a payment has no
    /// supplier of its own and this is an EXISTS rather than a column.
    pub suppliers: Vec<String>,
    /// `date`, `total` or `number`. Anything else — including nothing — is the
    /// house order, newest first. A closed set named here rather than a column
    /// name taken from the caller; see `BillScope::sort`.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent asks for everything, unpaged.
    pub limit: Option<i64>,
}

/// Where the previous page stopped — as a ROW, not as a position. The
/// payment's own id, whatever the list is sorted by; see `BillCursor`.
#[derive(Serialize, Deserialize)]
struct PaymentCursor {
    payment_id: Uuid,
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

/// One payment row, defined once — the page query and the facet query both
/// read it, so the counts beside the filters count exactly what the page can
/// show. See `payables::bill_rows`, which explains the arrangement at length.
///
/// Binds: `$1` the search pattern, or NULL for no search.
///
/// It stops at the SEARCH. Status, site and supplier are applied outside it.
fn payment_rows() -> String {
    format!(
        "SELECT {PAYMENT_COLUMNS} {PAYMENT_FROM}
          -- Our number and the bank's. `reference` is what somebody holding a
          -- statement actually has in front of them, and it is the reason this
          -- search exists at all.
          WHERE ($1::text IS NULL
                 OR p.payment_number ILIKE $1
                 OR p.reference ILIKE $1)"
    )
}

/// The status, site and supplier filters, written once for both queries.
///
/// The supplier clause is an EXISTS over the allocations rather than a column
/// comparison, because a payment has no supplier of its own — see
/// `PaymentScope::suppliers`. It reads `payment_id` off the searched row
/// rather than off `supplier_payment`, because by the time this clause runs
/// the table is no longer in scope.
const PAYMENT_FILTERS: &str = "
    ($2::text[] IS NULL OR status = ANY($2))
    AND ($3::text[] IS NULL OR site_id = ANY($3))
    AND ($4::text[] IS NULL OR EXISTS (
            SELECT 1 FROM supplier_payment_allocation al
              JOIN supplier_invoice i USING (invoice_id)
             WHERE al.payment_id = searched.payment_id
               AND i.supplier_id = ANY($4)))
";

/// Supplier payments: a page of them, how many there are, and what they come
/// to.
///
/// The shape is `payables::bill_page`'s, which is `money_overview`'s. What
/// differs is only what a payment is: the search is over the two numbers, and
/// the facets count the method as well as the status.
pub async fn payment_page(pool: &PgPool, scope: PaymentScope) -> Result<PaymentPage, AppError> {
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let statuses = (!scope.statuses.is_empty()).then(|| scope.statuses.clone());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let suppliers = (!scope.suppliers.is_empty()).then(|| scope.suppliers.clone());

    // Every order ends in `payment_id`, so no two rows compare equal and the
    // keyset can neither repeat nor lose a row that ties. `ORDER BY` takes
    // directions and a row expression does not, which is why the same order is
    // spelled twice below.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("date") => ("payment_date, payment_number", scope.desc),
        Some("total") => ("total_minor", scope.desc),
        Some("number") => ("payment_number", scope.desc),
        // The house order, and the one this endpoint has always answered in:
        // the most recent payment first. `dir` is not read here.
        _ => ("payment_date, payment_number", true),
    };
    let cols = format!("{lead}, payment_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!(
        "{} {dir}, payment_id {dir}",
        lead.replace(", ", &format!(" {dir}, "))
    );
    let seek = if descending { "<" } else { ">" };

    let cursor: Option<PaymentCursor> = scope.cursor.as_deref().map(decode_cursor).transpose()?;
    // 200 whatever a caller asks for; a client asking for ten thousand has
    // decided this is a bulk export, and it is not one.
    let limit = scope.limit.map(|value| value.clamp(1, 200));

    let rows_sql = payment_rows();
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({rows_sql}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE {PAYMENT_FILTERS}
         )
         SELECT * FROM kept
          WHERE $5::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE payment_id = $5)
          ORDER BY {order}
          LIMIT $6"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&statuses)
        .bind(&sites)
        .bind(&suppliers)
        .bind(cursor.as_ref().map(|c| c.payment_id))
        // No limit means no limit, which is what `NULL` means to `LIMIT`.
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match limit {
        // Unpaged: there is no next page by construction.
        None => None,
        Some(limit) if (rows.len() as i64) < limit => None,
        Some(_) => match rows.last() {
            Some(row) => Some(encode_cursor(&PaymentCursor {
                payment_id: row.try_get("payment_id")?,
            })?),
            None => None,
        },
    };

    let mut payments: Vec<SupplierPayment> = rows
        .iter()
        .map(to_payment)
        .collect::<Result<_, AppError>>()?;
    attach_allocations(pool, &mut payments).await?;

    let (total, total_minor, facets) =
        payment_facets(pool, needle.as_deref(), &statuses, &sites, &suppliers).await?;
    Ok(PaymentPage {
        rows: payments,
        next_cursor,
        total,
        total_minor,
        facets,
    })
}

/// How many payments there are, what they come to, and how they split.
///
/// Two scopes, deliberately: the per-value counts read the SEARCHED set so
/// that "GIRO 14" means "there are 14 giro payments" rather than "14 of the
/// ones you already narrowed to giro", while the total and the sum read the
/// FILTERED set because they describe the list on screen. One number serving
/// both is how a page of 20 rows ends up under a heading that says 96.
async fn payment_facets(
    pool: &PgPool,
    needle: Option<&str>,
    statuses: &Option<Vec<String>>,
    sites: &Option<Vec<String>>,
    suppliers: &Option<Vec<String>>,
) -> Result<(i64, i64, PaymentFacets), AppError> {
    let rows_sql = payment_rows();
    let sql = format!(
        "WITH searched AS ({rows_sql}), kept AS (
             SELECT * FROM searched WHERE {PAYMENT_FILTERS}
         )
         SELECT 'status' AS kind, status AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY status
          UNION ALL
         SELECT 'method', method, COUNT(*)::bigint FROM searched GROUP BY method
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept
          UNION ALL
         SELECT 'sum', '', COALESCE(SUM(total_minor), 0)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(statuses)
        .bind(sites)
        .bind(suppliers)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut total_minor = 0i64;
    let mut status_facets = Vec::new();
    let mut method_facets = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "status" => status_facets.push(PayableFacet {
                value,
                label: None,
                count: n,
            }),
            "method" => method_facets.push(PayableFacet {
                value,
                label: None,
                count: n,
            }),
            "sum" => total_minor = n,
            _ => total = n,
        }
    }
    // Biggest first, ties on the name so the panel does not reshuffle between
    // calls under somebody's cursor.
    for list in [&mut status_facets, &mut method_facets] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((
        total,
        total_minor,
        PaymentFacets {
            statuses: status_facets,
            methods: method_facets,
        },
    ))
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

/// The meanings money is allowed to leave BY. Only ever a credit: this document
/// settles bills, so `post_payment` credits the account named here and debits
/// the payables. Nothing on it can put money into an account.
///
/// `cashier_float` is absent deliberately, and the omission is worth a sentence
/// because it looks like a gap. Modal Kasir is the change in the drawer — a
/// fixed sum head office sends so a cashier can break a note — and the owner's
/// rule is that it pays for nothing. Adding it here would not let head office
/// fund it, because there is no direction on this document that could; it would
/// only let somebody settle the electricity out of the change float, which is
/// the single thing that must never happen to it. `supplier_payment.account_key`
/// in 0084 pins the same four in a CHECK for the same reason, so widening this
/// list on its own would trade a sentence naming the four for SQLSTATE 23514
/// arriving as "database operation failed".
///
/// Funding the float, and taking it back, is a movement between two pots at one
/// site with no supplier in it. That document does not exist yet; until it does
/// the act is a manual journal entry, which names account codes directly and so
/// is not bounded by this list.
const MONEY_KEYS: [&str; 4] = ["bank_giro", "bank_savings", "cash", "petty_cash"];
/// Four, not five: 0220 dropped CHEQUE. The client's chart has no cheque
/// account anywhere in it, and the two words do not mean the same thing — a cek
/// is payable the day it is presented, a bilyet giro not before its effective
/// date. Leaving a value that can only be picked by mistake, next to a GIRO that
/// is about to carry a lifecycle, is how the wrong instrument gets recorded.
const METHODS: [&str; 4] = ["TRANSFER", "CASH", "GIRO", "OTHER"];

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
    let posted = post(&mut tx, &intent, actor).await?;
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
