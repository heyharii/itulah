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
//! # What the procurement journals do
//!
//! Accepting a delivery first debits inventory and credits trade payable at
//! the ordered price. A successful three-way match then clears that receipt
//! payable, records invoice VAT and any price variance, and updates the amount
//! owed. Coded expense bills post when recorded; recurring-bill forecasts stay
//! drafts until the real invoice arrives.
//!
//! `unbilled_receipts` still reports accepted deliveries whose supplier bill
//! has not arrived; their inventory and receipt payable are already in the
//! books.
//!
//! # Why the bill is a row before it is a journal
//!
//! Because a bill has to be findable while it awaits coding or matching. A
//! complete coded expense bill or a successful three-way merchandise match
//! posts automatically; an incomplete or refused bill remains visible for
//! correction. Once posted, the amounts are frozen by a trigger alongside the
//! journal that quotes them.

use super::asset_classes::assert_asset_class;
use super::assets::{asset_cost_accounts, asset_drafts_for_bill, is_asset_account};
use super::ledger::{assert_category_for_account, assert_postable, Intent};
use super::poster::{post, LineAccount, PostingIntent, PostingLine};
use super::{decode_cursor, encode_cursor};
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
    ///
    /// Counted from `next_due_date`, not from `due_date`.
    pub days_overdue: i32,
    /// The earliest instalment this bill has not paid for — what must be paid
    /// NEXT, which is a different question from `due_date`.
    ///
    /// `due_date` is the date on the paper and stays what it always was. This
    /// is derived from the schedule and from what has been settled, and it is
    /// `None` once nothing is owed. A bill with no schedule answers with its
    /// own `due_date`, which is every bill raised before 0202.
    ///
    /// Deliberately NOT ERPNext's reading. It sets the header date to
    /// `max(payment_schedule.due_date)` — the day a bill is finally settled.
    /// An AP office asks the other question every morning.
    pub next_due_date: Option<NaiveDate>,
    /// `UNPAID`, `PARTIALLY_PAID` or `PAID`. Separate from `status`, which
    /// says where the DOCUMENT stands: `POSTED` means the ledger has the bill,
    /// which is true whether or not a rupiah has moved.
    pub payment_state: String,
    /// Late. Its own flag rather than a fourth payment state, because a bill
    /// can be partly paid AND late at once — which ERPNext's single Select
    /// cannot express.
    pub overdue: bool,
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
    /// What the bill charges for its deliveries, minus what those deliveries
    /// were valued at when they arrived. Signed: positive is a debit to
    /// purchase price variance and negative a credit. Zero on a bill that
    /// answers no delivery, and decided at matching rather than at posting —
    /// the journal quotes it and the journal cannot move.
    pub price_variance_minor: i64,
    /// Who tied this bill to its deliveries, and when. `None` until somebody
    /// has, which for a service bill is forever.
    pub matched_by: Option<String>,
    pub matched_at: Option<DateTime<Utc>>,
    /// Which income tax is kept back when this bill is paid. See
    /// `RecordBillRequest::withholding_code`.
    pub withholding_code: Option<String>,
    /// Held so that nothing pays it (brief §8.4). A held bill is still a real
    /// document — posting one is allowed, paying one is not — which is why it
    /// is a flag and not a status: DRAFT/POSTED says where the paper is, this
    /// says whether Finance wants money to move yet.
    pub on_hold: bool,
    /// Why. Required while `on_hold`, by a CHECK and by the writer, because a
    /// bill that vanished from the ready-to-pay list with no reason is the
    /// thing the column exists to prevent.
    pub hold_reason: Option<String>,
    /// The day somebody plans to lift the hold; `None` means "until somebody
    /// decides", which is a real answer.
    pub release_date: Option<NaiveDate>,
    /// Where the draft came from: `GA` (brief §8.3) or `PAYMENT_REQUEST`
    /// (brief §8.4). `None` for a bill Finance keyed itself.
    pub submitted_by_domain: Option<String>,
    /// Why Finance sent the draft back to GA (§8.3). The id and this mark stay
    /// put, so GA reads the sentence on the same bill it will file again.
    pub returned_reason: Option<String>,
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
    /// What kind of cost this is, on the accounts that are kept by kind.
    ///
    /// The half of the coding a four-digit chart no longer carries: every
    /// general and administrative expense the company pays is `6301`, and a
    /// bill whose four lines all read `6301` is a bill nobody can read.
    pub category_code: Option<String>,
    /// The client's own word for that kind, joined here rather than looked up
    /// in the browser — the same bargain `account_name` beside it already
    /// struck, and for a stronger reason: there are a hundred and forty
    /// categories, and a screen that resolved this itself would hold the whole
    /// list to render one cell.
    pub category_name: Option<String>,
    /// Set when this line buys a fixed asset. Posting the bill mints a DRAFT
    /// asset in that class pointing back at the line — the acquisition link
    /// 0099 left to somebody noticing.
    pub asset_class_code: Option<String>,
    /// Set when this line replaces something the company has been reserving
    /// for. It debits the replacement reserve for its class instead of the
    /// account named on the line, and mints no asset.
    pub draws_reserve: bool,
    /// The asset this line helped buy or spend on (0160). The five GA
    /// references live on the LINE and not the header (brief §8.1), and this is
    /// one of them.
    pub asset_id: Option<Uuid>,
    pub contract_id: Option<Uuid>,
    pub repair_id: Option<Uuid>,
    pub replacement_id: Option<Uuid>,
    pub supply_request_id: Option<Uuid>,
    /// The period the cost covers, when the line has one. A prepaid schedule
    /// reads THIS and not the contract's window (§8.2).
    pub service_period_start: Option<NaiveDate>,
    pub service_period_end: Option<NaiveDate>,
    /// True when a person chose the account instead of taking the suggestion.
    /// Finance reads it to tell the two apart.
    pub account_overridden: bool,
    /// Where the account came from, in words: "objek perbaikan · AC &
    /// refrigerator", "akun default vendor", ...
    ///
    /// Computed at READ time by `ga_accounts::suggest_account` and not stored.
    /// WHY: the source is a label for the object the line already names, and
    /// the refs beside it are the fact. A stored string would be a second copy
    /// of a sentence derivable from them, free to drift the day a class is
    /// renamed; computing it keeps the label and the object it describes in one
    /// place. The cost is a handful of small lookups on a detail read, which
    /// already fetches lines one query at a time and never runs for a list.
    pub source: Option<String>,
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
    /// What kind of cost this is. Required when the account declares a family,
    /// which every expense account on the forty-account chart does — so on an
    /// ordinary expense bill this is not optional in practice, only in shape.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub category_code: Option<String>,
    /// The asset class this line buys, when it buys one: an
    /// `asset_class.class_code` — a building, a machine, one of the thirty-six
    /// operating-equipment classes.
    ///
    /// Said here, by the person holding the paper, because that is the only
    /// moment anybody knows. Everything downstream — the register row, the
    /// depreciation, the disposal — follows from it, and none of it can be
    /// reconstructed later from an account code that fourteen shops share.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub asset_class_code: Option<String>,
    /// This purchase replaces something the company reserves for. Requires
    /// `asset_class_code`, which then says which reserve it comes out of.
    #[serde(default)]
    pub draws_reserve: bool,
    /// The five GA references (brief §8.1). At most ONE may be set on a line:
    /// a line is for one object, and `record_bill` refuses two with an example.
    /// `asset_id` names an asset this line helped buy or spend on; the other
    /// four name the GA record the cost belongs to.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub asset_id: Option<Uuid>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub contract_id: Option<Uuid>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub repair_id: Option<Uuid>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub replacement_id: Option<Uuid>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub supply_request_id: Option<Uuid>,
    /// The period this cost covers. A prepaid schedule reads the LINE's own
    /// period, not the contract's window (brief §8.2).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub service_period_start: Option<NaiveDate>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub service_period_end: Option<NaiveDate>,
    /// True when the caller is choosing the account itself rather than taking
    /// the suggestion. Finance reads this to see what GA changed.
    #[serde(default)]
    pub account_overridden: bool,
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
    /// The deliveries this bill pays for.
    ///
    /// Optional, because a bill can arrive before anybody ties it to anything
    /// and a person should still be able to write it down. Naming them here is
    /// what takes those deliveries off `unbilled_receipts` — until 0052's join
    /// table has a row, a receipt is unbilled forever, however many bills have
    /// been posted for it.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub receipt_ids: Option<Vec<Uuid>>,
    /// Which deliveries this bill answers, and what it charges for each of
    /// them. `None` on a service bill, a freight charge or an expense, which
    /// answer no delivery and post by 0094's path.
    ///
    /// Optional, and not merely for the sake of the callers written before it.
    /// Matching is a decision with an actor and a possible variance to accept,
    /// and it can be made by somebody other than whoever keyed the paper, on
    /// another day. So it is also its own endpoint. Recording and matching in
    /// one call is the case where the same person does both at once, which is
    /// most of them: a clerk with the delivery note and the invoice side by
    /// side should not have to make two requests to say so.
    ///
    /// Handed to `payables_flow::bill_match` unchanged. When it is present the
    /// bill comes back MATCHED, and when the deliveries disagree with it the
    /// whole call fails and no bill is recorded — a DRAFT left behind by a
    /// refused match is a row somebody has to find and delete.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub matching: Option<super::payables_flow::BillMatchRequest>,
    /// Which income tax is kept back when this bill is paid, or `None` for
    /// none — which is the ordinary case, because goods for resale are not
    /// subject to PPh 23.
    ///
    /// A property of what was bought and therefore of the bill, not of the
    /// payment: the rate follows from whether this was a service, a hire, a
    /// royalty or the rent of a building. `domain::withholding` holds the codes
    /// and 0133's CHECK holds the same list.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub withholding_code: Option<String>,
    /// Who filed the draft: `GA` (brief §8.3) or `PAYMENT_REQUEST` (§8.4).
    /// `None` for a bill Finance keyed itself, which is the ordinary case.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub submitted_by_domain: Option<String>,
    /// Where the scan lives — a reference, not the bytes (0052's
    /// `document_ref`). Kept on the request so the GA "ajukan tagihan" form can
    /// say which paper it is holding.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub document_ref: Option<String>,
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
    /// The CENTRE's name for the unit — `dc`, `store-07` — which is the
    /// spelling every other finance read answers in and the one the unit
    /// pickers and `site` are keyed on.
    pub site_id: String,
    /// What the node that minted this receipt calls itself — `dc-01` at the
    /// distribution centre, and the same as `site_id` everywhere else. It is
    /// inside `receipt_number`, so it is what somebody reads off the paper.
    pub origin_site_id: String,
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

// ---------------------------------------------------------------------------
// The bill list: searched, filtered, sorted and paged
// ---------------------------------------------------------------------------
//
// The shape here is `money_overview`'s, copied deliberately and not adapted.
// That endpoint is the one list in this codebase that pages on a keyset,
// searches and sorts on the server and answers in an envelope, and a second
// list with its own spelling of the same four ideas would mean the browser
// needs a second hook to draw a table — which is how two tables end up
// disagreeing about what "50 of 1,284" means.

/// One value a filter can take, and how many rows would still be there.
///
/// Shared with `payments`: bills and the payments that settle them are two
/// halves of one document flow, their filter panels are drawn by the same
/// component, and a second structurally identical type would only give the
/// browser two names for one shape.
///
/// The count is what makes a filter panel usable rather than a guessing game:
/// a value that would leave nothing is a value nobody should have to click to
/// find out about. Counted over everything the SEARCH matches, deliberately
/// ignoring which facets are currently ticked — so the number reads as "how
/// many of these there are", which is the question somebody has while
/// choosing, rather than "how many are left after what you already ticked",
/// which reads as every unticked box showing a zero.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayableFacet {
    /// What to send back as the filter — the server's own word for the thing,
    /// never a display string.
    pub value: String,
    /// What to draw, when it differs from the value.
    ///
    /// Always absent on both of these lists today: a status and a payment
    /// method are wire words the screen has its own English for, and a server
    /// that shipped "Posted" would be deciding the client's vocabulary from
    /// here. It is in the shape because one component draws every facet panel,
    /// and the money list's site facet genuinely needs it — `store-01` is an
    /// id this system files a shop under and the panel beside it says
    /// `Store 01`.
    pub label: Option<String>,
    pub count: i64,
}

/// The one thing a bill list is narrowed by that is worth counting.
///
/// Status and not supplier: a status has six values and a reader wants to see
/// all six with their counts, while suppliers run to hundreds and a panel
/// listing them is a search box, not a facet. `supplier` is still a filter —
/// it is simply not a list anybody browses.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BillFacets {
    pub statuses: Vec<PayableFacet>,
}

/// A page of supplier bills, and what the whole matched set comes to.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BillPage {
    /// This page, in the order asked for. Every row carries `lines: null` —
    /// see `SupplierBill::lines`.
    pub rows: Vec<SupplierBill>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    ///
    /// Deliberately not an offset: bills are recorded all day, and a page two
    /// asked by position after somebody keyed three invoices would skip three
    /// bills with nothing saying so.
    ///
    /// **Always absent when the caller sent no `limit`.** Paging is opt-in for
    /// the reason `MoneyOverview::next_cursor` gives at length: this endpoint
    /// already has callers that ask for the whole list and add it up, and
    /// quietly answering them with the first fifty rows would be a silent
    /// wrong total on a finance screen.
    pub next_cursor: Option<String>,
    /// Every bill the search and filters match, not just this page. Without it
    /// a screen can only say "200 bills", which is a statement about the page
    /// size rather than about the business.
    pub total: i64,
    /// What those bills come to, added HERE.
    ///
    /// Only the server has every row. A paged list summed in the browser gives
    /// a figure that grows while somebody scrolls, and on a finance screen a
    /// total that changes as you read is worse than no total at all.
    pub total_minor: i64,
    /// What is still owed on them: the same set, net of what posted payments
    /// have taken. The figure somebody filtering to `POSTED` and one supplier
    /// actually came for.
    pub outstanding_minor: i64,
    pub facets: BillFacets,
}

/// What a caller is asking the bill list for.
#[derive(Clone, Debug, Default)]
pub struct BillScope {
    /// Free text, tried against the invoice number and the supplier's name —
    /// the two things somebody has in front of them when they go looking for a
    /// bill: the number off the paper, or who sent it.
    pub needle: Option<String>,
    /// Statuses to keep. Empty means every status; an empty filter and no
    /// filter are the same request, and treating them differently is how a
    /// screen shows nothing the moment somebody unticks the last box.
    ///
    /// Unknown values are passed through rather than dropped, which is where
    /// this departs from `MoneyScope::pots` — and deliberately. The status
    /// vocabulary lives in 0094's CHECK constraint, not in this file, and a
    /// second copy of it here would be the thing that goes stale. A status
    /// nobody uses matches nothing, which is also what the old `status=`
    /// parameter did.
    pub statuses: Vec<String>,
    /// Supplier ids. On a bill this is the supplier's own column: a bill has
    /// exactly one, unlike a payment.
    pub suppliers: Vec<String>,
    pub sites: Vec<String>,
    /// `date`, `due`, `supplier`, `total` or `outstanding`. Anything else —
    /// including nothing — is the house order, newest first.
    ///
    /// A closed set named here rather than a column name taken from the
    /// caller: the sort is spliced into SQL, and a list endpoint that accepts
    /// arbitrary column names is a list endpoint that accepts arbitrary SQL.
    /// An unrecognised value falls back rather than refusing, because a sort
    /// arrives from a URL somebody may have kept from an older build and a 400
    /// for a stale bookmark is a worse answer than the rows in the house
    /// order.
    pub sort: Option<String>,
    /// `true` for descending. Not read for the house order, which is already
    /// newest-first and means nothing reversed.
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent asks for everything, unpaged. See `BillPage::next_cursor`.
    pub limit: Option<i64>,
    /// `submitted_by_domain` to keep, e.g. `GA` for the inbox of drafts GA
    /// filed (brief §8.3). `None` means every origin. It narrows the
    /// population, so it is applied in SQL and not by the browser.
    pub draft_from: Option<String>,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// It carries the bill's own id and nothing else, whatever the list is sorted
/// by. The seek re-reads that row's sort value in SQL, so one cursor shape
/// serves every order; encoding the sort value instead needs a different
/// cursor per sort, and the version where somebody adds a sixth sort and
/// forgets the sixth cursor is the version that silently repeats rows. The
/// cost is one extra row lookup per page, against a query that already scans
/// the bills.
#[derive(Serialize, Deserialize)]
struct BillCursor {
    invoice_id: Uuid,
}

/// The join every bill reading needs beside `i`.
///
/// `supplier_invoice_standing` (0202) answers what is outstanding, what falls
/// due next, whether the bill is late, and which of `UNPAID`,
/// `PARTIALLY_PAID`, `PAID` it is. `CROSS JOIN LATERAL` rather than a plain
/// join because the view is keyed on the invoice and always returns exactly
/// one row for it.
const BILL_STANDING: &str = "JOIN supplier_invoice_standing st ON st.invoice_id = i.invoice_id";

const BILL_COLUMNS: &str = "i.invoice_id, i.invoice_number, i.supplier_id, i.supplier_name,
     i.site_id, i.invoice_date, i.due_date, i.currency, i.subtotal_minor, i.tax_minor,
     i.discount_minor, i.total_minor, i.status, i.journal_entry_id, i.recorded_by,
     i.recorded_at, i.posted_by, i.note, i.kind,
     i.price_variance_minor, i.matched_by, i.matched_at, i.withholding_code,
     i.on_hold, i.hold_reason, i.release_date, i.submitted_by_domain, i.returned_reason,
     (SELECT e.entry_number FROM journal_entry e WHERE e.entry_id = i.journal_entry_id) AS entry_number,
     -- Age off what falls due NEXT, not off the single date on the paper.
     -- A bill 40% paid whose second instalment falls next month is not late,
     -- and `i.due_date` cannot say so — see `supplier_invoice_standing` (0202).
     -- A bill with no schedule falls back to `i.due_date` inside the view, so
     -- every bill that existed before instalments ages exactly as it did.
     COALESCE((CURRENT_DATE - st.next_due_date), 0)::int AS days_overdue,
     st.next_due_date,
     st.payment_state,
     st.overdue,
     st.paid_minor,
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
        next_due_date: row.try_get("next_due_date")?,
        payment_state: row.try_get("payment_state")?,
        overdue: row.try_get("overdue")?,
        kind: row.try_get("kind")?,
        price_variance_minor: row.try_get("price_variance_minor")?,
        matched_by: row.try_get("matched_by")?,
        matched_at: row.try_get("matched_at")?,
        withholding_code: row.try_get("withholding_code")?,
        on_hold: row.try_get("on_hold")?,
        hold_reason: row.try_get("hold_reason")?,
        release_date: row.try_get("release_date")?,
        submitted_by_domain: row.try_get("submitted_by_domain")?,
        returned_reason: row.try_get("returned_reason")?,
        lines: None,
    })
}

/// What an expense bill was for, in the order it was keyed.
///
/// `source` is computed here rather than stored: see `SupplierBillLine::source`
/// for why. The supplier comes along for step five of the suggestion, which is
/// "the vendor's default account" and cannot be answered without it.
async fn bill_lines(pool: &PgPool, invoice_id: Uuid) -> Result<Vec<SupplierBillLine>, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, l.line_number, l.account_code, a.name AS account_name,
                l.site_id, l.amount_minor, l.category_code, k.name AS category_name,
                l.asset_class_code, l.draws_reserve, l.memo,
                l.asset_id, l.contract_id, l.repair_id, l.replacement_id,
                l.supply_request_id, l.service_period_start, l.service_period_end,
                l.account_overridden,
                (SELECT i.supplier_id FROM supplier_invoice i
                  WHERE i.invoice_id = l.invoice_id) AS supplier_id
           FROM supplier_invoice_expense_line l
           JOIN ledger_account a ON a.account_code = l.account_code
           LEFT JOIN line_category k ON k.category_code = l.category_code
          WHERE l.invoice_id = $1
          ORDER BY l.line_number",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let site_id: String = row.try_get("site_id")?;
        let supplier_id: Option<String> = row.try_get("supplier_id")?;
        let refs = super::ga_accounts::LineRefs {
            asset_class_code: row.try_get("asset_class_code")?,
            repair_id: row.try_get("repair_id")?,
            contract_id: row.try_get("contract_id")?,
            supply_request_id: row.try_get("supply_request_id")?,
            prepaid: false,
            supplier_id,
        };
        // A failed suggestion must not fail the READ: the line already holds
        // its account and its refs, and the label is a convenience. `None` is
        // the honest answer when the object it named has since gone.
        let source = super::ga_accounts::suggest_account(pool, &site_id, &refs)
            .await
            .ok()
            .map(|suggestion| suggestion.source);
        out.push(SupplierBillLine {
            line_id: row.try_get("line_id")?,
            line_number: row.try_get("line_number")?,
            account_code: row.try_get("account_code")?,
            account_name: row.try_get("account_name")?,
            site_id,
            amount_minor: row.try_get("amount_minor")?,
            category_code: row.try_get("category_code")?,
            category_name: row.try_get("category_name")?,
            asset_class_code: row.try_get("asset_class_code")?,
            draws_reserve: row.try_get("draws_reserve")?,
            asset_id: row.try_get("asset_id")?,
            contract_id: row.try_get("contract_id")?,
            repair_id: row.try_get("repair_id")?,
            replacement_id: row.try_get("replacement_id")?,
            supply_request_id: row.try_get("supply_request_id")?,
            service_period_start: row.try_get("service_period_start")?,
            service_period_end: row.try_get("service_period_end")?,
            account_overridden: row.try_get("account_overridden")?,
            source,
            memo: row.try_get("memo")?,
        });
    }
    Ok(out)
}

/// One bill row, defined once.
///
/// Used by the page query and by the facet query, and that is the whole reason
/// it exists as a string: the facets are only honest if they count exactly what
/// the page can show. Two copies of this would agree on every ordinary day and
/// part company the moment somebody adds a column to `BILL_COLUMNS` — and the
/// symptom would be a filter promising eleven bills and delivering nine.
///
/// Binds: `$1` the search pattern, or NULL for no search.
///
/// It stops at the SEARCH. The status, supplier and site filters are applied
/// outside it by each caller, and that is what lets one definition answer two
/// different questions from the same rows: the page wants what the search AND
/// the filters leave, while the panel's counts want what the search alone
/// leaves — because "Posted 69" has to mean "there are 69 posted bills", not
/// "there are 69 posted bills among the ones you have already narrowed to
/// posted".
///
/// A function rather than a `const` only because it splices `BILL_COLUMNS`,
/// which a `const` cannot do.
fn bill_rows() -> String {
    format!(
        "SELECT *,
                -- Derived out here because the inner SELECT cannot see its own
                -- aliases, and because the keyset sorts by it.
                (total_minor - paid_minor) AS outstanding
           FROM (
         SELECT {BILL_COLUMNS},
                -- The two nullable sort columns, made non-null HERE.
                --
                -- A NULL anywhere inside a row comparison makes the whole
                -- comparison NULL, and the keyset below compares rows. Sorting
                -- by a raw date would therefore drop every bill with no due
                -- date the moment somebody paged — silently, and only past the
                -- first page. A bill with nothing left to pay sorts last,
                -- which is also how somebody chasing what is overdue would
                -- file it.
                --
                -- `next_due_date`, not `i.due_date`: what a list of payables
                -- is sorted by is what has to be paid next, and a bill whose
                -- advance is settled belongs where its balance falls due.
                COALESCE(st.next_due_date, DATE '9999-12-31') AS due_sort,
                -- Falling back to the id rather than to an empty string: a
                -- supplier whose name was never keyed still belongs beside its
                -- own bills rather than at the top of the list.
                COALESCE(i.supplier_name, i.supplier_id) AS supplier_sort
           FROM supplier_invoice i
          {BILL_STANDING}
          -- The number off the paper, or who sent it. Not the note and not the
          -- amount: a free-text box that also matched notes would answer a
          -- search for PLN with every bill anybody ever mentioned it on.
          WHERE ($1::text IS NULL
                 OR i.invoice_number ILIKE $1
                 OR i.supplier_name ILIKE $1)
       ) base"
    )
}

/// The status, supplier and site filters, written once for both queries.
///
/// Text arrays rather than single values so a panel with three statuses ticked
/// is one request. `NULL` means "no filter" — see `BillScope::statuses`.
const BILL_FILTERS: &str = "
    ($2::text[] IS NULL OR status = ANY($2))
    AND ($3::text[] IS NULL OR supplier_id = ANY($3))
    AND ($4::text[] IS NULL OR site_id = ANY($4))
    AND ($5::text IS NULL OR submitted_by_domain = $5)
";

/// Supplier bills: a page of them, how many there are, and what they come to.
///
/// The shape is `money_overview`'s, down to the opt-in paging and the two
/// counting scopes — see `BillPage`. What differs is only what a bill is: the
/// search is over the number and the supplier, and the sorts are the columns
/// somebody chasing money actually orders by.
pub async fn bill_page(pool: &PgPool, scope: BillScope) -> Result<BillPage, AppError> {
    // A blank search is not a search. `Some("")` would compile to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let statuses = (!scope.statuses.is_empty()).then(|| scope.statuses.clone());
    let suppliers = (!scope.suppliers.is_empty()).then(|| scope.suppliers.clone());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let draft_from = scope
        .draft_from
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);

    // The sort, and the tie-break that makes it total. Every order ends in
    // `invoice_id`, so no two rows can ever compare equal — which is what stops
    // a keyset from repeating or losing the rows that tie.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not. Writing
    // `(a ASC, b) > (…)` is a syntax error, and it is one the compiler cannot
    // catch because the whole clause is a string.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("date") => ("invoice_date, invoice_number", scope.desc),
        Some("due") => ("due_sort", scope.desc),
        Some("supplier") => ("supplier_sort, invoice_date", scope.desc),
        Some("total") => ("total_minor", scope.desc),
        Some("outstanding") => ("outstanding", scope.desc),
        // The house order, and the one this endpoint has always answered in:
        // the newest bill first. `dir` is not read here — a default order that
        // reverses is not a default.
        _ => ("invoice_date, invoice_number", true),
    };
    let cols = format!("{lead}, invoice_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!(
        "{} {dir}, invoice_id {dir}",
        lead.replace(", ", &format!(" {dir}, "))
    );
    // Which way the seek points follows the direction, or paging a descending
    // list walks back up it.
    let seek = if descending { "<" } else { ">" };

    let cursor: Option<BillCursor> = scope.cursor.as_deref().map(decode_cursor).transpose()?;
    // 200 whatever a caller asks for: a page is something a person scrolls, and
    // a client asking for ten thousand has decided this is a bulk export. It is
    // not one. The old ceiling here was 500 and nothing ever asked for it.
    let limit = scope.limit.map(|value| value.clamp(1, 200));

    let rows_sql = bill_rows();
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({rows_sql}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE {BILL_FILTERS}
         )
         SELECT * FROM kept
          WHERE $6::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE invoice_id = $6)
          ORDER BY {order}
          LIMIT $7"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&statuses)
        .bind(&suppliers)
        .bind(&sites)
        .bind(&draft_from)
        .bind(cursor.as_ref().map(|c| c.invoice_id))
        // No limit means no limit. `NULL` is how Postgres spells that in
        // `LIMIT`, which is why this is an Option rather than a large number
        // standing in for one.
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match limit {
        // Unpaged: there is no next page by construction, and issuing a cursor
        // would invite a caller to page through an answer it already has.
        None => None,
        Some(limit) if (rows.len() as i64) < limit => None,
        Some(_) => match rows.last() {
            Some(row) => Some(encode_cursor(&BillCursor {
                invoice_id: row.try_get("invoice_id")?,
            })?),
            None => None,
        },
    };

    let out = rows.iter().map(to_bill).collect::<Result<Vec<_>, _>>()?;
    let (total, total_minor, outstanding_minor, statuses) =
        bill_facets(pool, needle.as_deref(), &statuses, &suppliers, &sites, &draft_from).await?;
    Ok(BillPage {
        rows: out,
        next_cursor,
        total,
        total_minor,
        outstanding_minor,
        facets: BillFacets { statuses },
    })
}

/// How many bills there are, what they come to, and how they split by status.
///
/// Counted from the SAME `bill_rows` the page is drawn from, for the reason
/// given there. The two scopes are deliberate and are the mistake this shape
/// exists to prevent:
///
///   the per-status counts read the SEARCHED set, ignoring what is ticked, so
///     the number beside `POSTED` answers "how many posted bills are there",
///     which is the question somebody has while deciding whether to tick it.
///   the total and the sums read the FILTERED set, because they describe the
///     list on screen. One number serving both is how a page of 69 rows ends
///     up under a heading that says 139.
async fn bill_facets(
    pool: &PgPool,
    needle: Option<&str>,
    statuses: &Option<Vec<String>>,
    suppliers: &Option<Vec<String>>,
    sites: &Option<Vec<String>>,
    draft_from: &Option<String>,
) -> Result<(i64, i64, i64, Vec<PayableFacet>), AppError> {
    let rows_sql = bill_rows();
    let sql = format!(
        "WITH searched AS ({rows_sql}), kept AS (
             SELECT * FROM searched WHERE {BILL_FILTERS}
         )
         SELECT 'status' AS kind, status AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY status
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept
          UNION ALL
         SELECT 'sum', '', COALESCE(SUM(total_minor), 0)::bigint FROM kept
          UNION ALL
         SELECT 'owed', '', COALESCE(SUM(outstanding), 0)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(statuses)
        .bind(suppliers)
        .bind(sites)
        .bind(draft_from)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut total_minor = 0i64;
    let mut outstanding_minor = 0i64;
    let mut facets = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "status" => facets.push(PayableFacet {
                value,
                label: None,
                count: n,
            }),
            "sum" => total_minor = n,
            "owed" => outstanding_minor = n,
            _ => total = n,
        }
    }
    // Biggest first: a filter list is read top-down and the value somebody is
    // most likely to want is the one with the most behind it. Ties break on the
    // name so the order is stable between calls — a list that reshuffles under
    // the cursor is a list nobody can click.
    facets.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    Ok((total, total_minor, outstanding_minor, facets))
}

/// One bill, with what it was for.
///
/// The lines are fetched here and not in `bill_page`: a list draws a hundred
/// rows and a hundred and one queries to draw one screen is how a list gets
/// slow without anybody being able to point at the reason.
pub async fn bill(pool: &PgPool, invoice_id: Uuid) -> Result<SupplierBill, AppError> {
    let sql = format!(
        "SELECT {BILL_COLUMNS} FROM supplier_invoice i {BILL_STANDING} WHERE i.invoice_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(invoice_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("supplier bill".into()))?;
    let mut bill = to_bill(&row)?;
    bill.lines = Some(bill_lines(pool, invoice_id).await?);
    Ok(bill)
}

/// Hold a bill so nothing pays it, with the reason it is held.
///
/// Holding a POSTED bill is allowed, and that is the point: the ledger already
/// has it, but Finance does not want money moving yet. Releasing clears the
/// reason and the planned date with the flag, so "released" and "held with a
/// blank reason" cannot both be true.
pub async fn hold_bill(
    pool: &PgPool,
    invoice_id: Uuid,
    reason: &str,
    release_date: Option<NaiveDate>,
    _actor: &str,
) -> Result<SupplierBill, AppError> {
    if reason.trim().is_empty() {
        return Err(AppError::Validation(
            "say why the bill is held; a bill that leaves the ready-to-pay list with no reason \
             is one nobody can release"
                .into(),
        ));
    }
    let updated = sqlx::query(
        "UPDATE supplier_invoice
            SET on_hold = true, hold_reason = $2, release_date = $3
          WHERE invoice_id = $1",
    )
    .bind(invoice_id)
    .bind(reason.trim())
    .bind(release_date)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("supplier bill".into()));
    }
    bill(pool, invoice_id).await
}

/// Release a held bill. The reason and the planned date go with the flag.
pub async fn release_bill(pool: &PgPool, invoice_id: Uuid) -> Result<SupplierBill, AppError> {
    let updated = sqlx::query(
        "UPDATE supplier_invoice
            SET on_hold = false, hold_reason = NULL, release_date = NULL
          WHERE invoice_id = $1",
    )
    .bind(invoice_id)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("supplier bill".into()));
    }
    bill(pool, invoice_id).await
}

/// Return a draft to the domain that filed it, with the reason.
///
/// A return is not a delete: the bill keeps its id and its origin mark and
/// stays a DRAFT, so GA can fix it and file it again (§8.3). The id is the same
/// document all the way to POSTED, which is the whole reason a return exists
/// rather than a delete-and-retype.
pub async fn return_bill(
    pool: &PgPool,
    invoice_id: Uuid,
    reason: &str,
    _actor: &str,
) -> Result<SupplierBill, AppError> {
    if reason.trim().is_empty() {
        return Err(AppError::Validation(
            "say why the draft is coming back; a returned draft with no reason is one GA cannot \
             act on"
                .into(),
        ));
    }
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM supplier_invoice WHERE invoice_id = $1")
            .bind(invoice_id)
            .fetch_optional(pool)
            .await?;
    match status.as_deref() {
        None => return Err(AppError::NotFound("supplier bill".into())),
        Some("DRAFT") => {}
        Some(other) => {
            return Err(AppError::Conflict(format!(
                "bill is {other}, not a draft waiting to be returned; a return is for a document \
                 nobody has posted yet"
            )))
        }
    }
    // The origin mark and the id stay put, deliberately (brief §8.3): a
    // returned draft is still the same document, and GA files it again rather
    // than raising a second one. Only the reason moves.
    sqlx::query("UPDATE supplier_invoice SET returned_reason = $2 WHERE invoice_id = $1")
        .bind(invoice_id)
        .bind(reason.trim())
        .execute(pool)
        .await?;
    bill(pool, invoice_id).await
}

/// Record a bill. It is not in the books yet — posting is a separate act.
///
/// Every refusal below is also enforced by the database — 0094's foreign keys,
/// CHECKs and deferred trigger are the guarantee. These are the explanations,
/// checked first so the sentence names the line somebody just typed rather than
/// arriving at COMMIT naming a transaction. The same arrangement
/// `poster::check_balanced` has with the journal's balance trigger.

/// A bare 23505 from this table says nothing a person can act on.
///
/// `(supplier_id, invoice_number)` is unique, which is the rule that stops the
/// same invoice being recorded twice — a real protection, and the one somebody
/// meets when they re-run a seed or key a bill in twice. Left as
/// `AppError::Database` it reached the caller as `500 database operation
/// failed`, which reads as "the system is broken" rather than "you already
/// have this bill". A whole afternoon went into chasing that message once.
fn map_bill_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => AppError::Conflict(
                "this supplier already has an invoice with that number".to_owned(),
            ),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

/// The table each bill-line reference points at, so a missing object is named
/// in words rather than by a constraint.
async fn assert_bill_line_ref(pool: &PgPool, column: &str, id: Uuid) -> Result<(), AppError> {
    let (table, pk, label) = match column {
        "asset_id" => ("fixed_asset", "asset_id", "asset"),
        "contract_id" => ("ga_contract", "contract_id", "contract"),
        "repair_id" => ("ga_repair", "repair_id", "repair"),
        "replacement_id" => ("ga_replacement", "replacement_id", "replacement"),
        "supply_request_id" => ("ga_supply_request", "request_id", "supply request"),
        _ => {
            return Err(AppError::Validation(format!(
                "'{column}' is not a bill-line reference"
            )))
        }
    };
    let sql = format!("SELECT EXISTS (SELECT 1 FROM {table} WHERE {pk} = $1)");
    let exists: bool = sqlx::query_scalar(&sql).bind(id).fetch_one(pool).await?;
    if !exists {
        return Err(AppError::Validation(format!(
            "there is no {label} {id} in the register to point this line at"
        )));
    }
    Ok(())
}

pub async fn record_bill(
    pool: &PgPool,
    request: &RecordBillRequest,
    actor: &str,
) -> Result<SupplierBill, AppError> {
    record_bill_with_policy(pool, request, actor, true).await
}

/// Raise a forecast bill without posting it. Recurring-bill templates are
/// placeholders for an invoice that has not arrived yet, so they must remain
/// drafts until somebody records the real document.
pub async fn record_bill_draft(
    pool: &PgPool,
    request: &RecordBillRequest,
    actor: &str,
) -> Result<SupplierBill, AppError> {
    record_bill_with_policy(pool, request, actor, false).await
}

/// The validated shape of a bill, before anything is written.
///
/// Split out from the writer so the payment-request path can put the bill and
/// the instruction's APPROVED status in ONE transaction without a second
/// INSERT: `decide_instruction` validates with this and then calls
/// [`insert_bill`] inside its own transaction.
pub(super) struct ValidatedBill {
    pub(super) kind: String,
    pub(super) total: i64,
    pub(super) withholding_code: Option<String>,
}

pub(super) async fn validate_bill(
    pool: &PgPool,
    request: &RecordBillRequest,
) -> Result<ValidatedBill, AppError> {
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

    // The supplier's own number, normalised. `INV/1`, `inv / 1` and `INV  1`
    // are ONE number, and the database's unique index only catches the exact
    // spelling — so the same invoice keyed with a stray space is a second bill
    // and twice the payable. Normalising here (spaces removed, letters
    // upper-cased) is the same expression the index would use, and it lets the
    // refusal NAME the number already on file, which a bare 23505 cannot.
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT invoice_number FROM supplier_invoice
          WHERE supplier_id = $1
            AND upper(regexp_replace(invoice_number, '\\s+', '', 'g'))
              = upper(regexp_replace($2, '\\s+', '', 'g'))",
    )
    .bind(request.supplier_id.trim())
    .bind(request.invoice_number.trim())
    .fetch_optional(pool)
    .await?;
    if let Some(existing) = existing {
        return Err(AppError::Conflict(format!(
            "this supplier already has an invoice with this number: {existing} — the number is \
             compared with spaces removed and letters upper-cased, so {existing} and {} are the \
             same bill",
            request.invoice_number.trim()
        )));
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
            // One line, one object (brief §8.1). Two references on one line is
            // how a mixed bill becomes a bill nobody can count: the sums that
            // read these columns — a contract's billed total, a repair's actual
            // cost — would each take the whole line and charge both objects.
            // The refusal shows the split somebody should make instead.
            let refs = [
                ("asset_id", line.asset_id),
                ("contract_id", line.contract_id),
                ("repair_id", line.repair_id),
                ("replacement_id", line.replacement_id),
                ("supply_request_id", line.supply_request_id),
            ];
            let named: Vec<&str> = refs
                .iter()
                .filter_map(|(name, id)| id.map(|_| *name))
                .collect();
            if named.len() > 1 {
                return Err(AppError::Validation(format!(
                    "line {} names {} objects at once; one line is for one object. A bill for an \
                     AC repair at store-01 and a month's rent at store-04 is TWO lines — put \
                     repair_id on the first and contract_id on the second — not one line that \
                     names both",
                    index + 1,
                    named.join(" and ")
                )));
            }
            // Every reference must EXIST, checked here rather than left to the
            // foreign key: a 23503 reaches a person as "database operation
            // failed", naming neither the line nor the object that is missing.
            for (name, id) in refs.iter() {
                if let Some(id) = id {
                    assert_bill_line_ref(pool, name, *id)
                        .await
                        .map_err(|error| match error {
                            AppError::Validation(message) => {
                                AppError::Validation(format!("line {}: {message}", index + 1))
                            }
                            other => other,
                        })?;
                }
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
            // And what kind of cost it is, on the accounts that are kept by
            // kind. Checked beside the account, because the two are one
            // decision: a person who chose `6301` has not finished coding the
            // line until they have said which kind of `6301` it is.
            assert_category_for_account(
                pool,
                line.account_code.trim(),
                line.category_code
                    .as_deref()
                    .map(str::trim)
                    .filter(|code| !code.is_empty()),
                Intent::Post,
            )
            .await
            .map_err(|error| match error {
                AppError::Validation(message) => {
                    AppError::Validation(format!("line {}: {message}", index + 1))
                }
                other => other,
            })?;
            // What the line says it is buying, checked while the person who
            // wrote it is still on the screen. The alternative is a refusal at
            // the moment somebody posts the bill, days later, naming a class
            // they did not choose.
            if let Some(class) = line.asset_class_code.as_deref().map(str::trim) {
                assert_asset_class(pool, class)
                    .await
                    .map_err(|error| match error {
                        AppError::Validation(message) => {
                            AppError::Validation(format!("line {}: {message}", index + 1))
                        }
                        other => other,
                    })?;
                // A line that MINTS an asset has to be coded to an account an
                // asset's cost sits in too, because that debit is the cost the
                // register will carry. A line that DRAWS the reserve is the
                // opposite: its account is whatever the person chose and the
                // posting rule ignores it, so nothing is asked of it here.
                if !line.draws_reserve {
                    let cost_accounts = asset_cost_accounts(pool).await?;
                    if !is_asset_account(&cost_accounts, line.account_code.trim()) {
                        return Err(AppError::Validation(format!(
                            "line {} buys a {class} but is coded to {}; a capital purchase is \
                             coded to the account its cost lands in, one of {}",
                            index + 1,
                            line.account_code.trim(),
                            cost_accounts.join(", ")
                        )));
                    }
                }
            } else if line.draws_reserve {
                return Err(AppError::Validation(format!(
                    "line {} draws the replacement reserve without saying which one; name the \
                     asset class it replaces",
                    index + 1
                )));
            }
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

    // Checked against `domain::withholding` and not only against 0133's CHECK,
    // for `assert_postable`'s reason: the constraint reaches a person as
    // "database operation failed" and names neither the column nor the codes
    // that would have worked. A bill naming a tax this system cannot compute
    // is a bill whose payment would refuse months later, at the bank.
    let withholding_code = match request.withholding_code.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(code) => {
            let active: Vec<String> = sqlx::query_scalar(
                "SELECT code FROM tax_template WHERE is_active AND kind = 'WITHHOLDING' ORDER BY code",
            )
            .fetch_all(pool)
            .await?;
            if !active.iter().any(|known| known == code) {
                return Err(AppError::Validation(format!(
                    "'{code}' is not a withholding Finance keeps; it keeps {}",
                    active.join(", ")
                )));
            }
            Some(code.to_string())
        }
    };

    Ok(ValidatedBill {
        kind,
        total,
        withholding_code,
    })
}

/// Write a validated bill's header, its lines and its delivery links.
///
/// Takes a transaction it did not open so the caller can put the bill and
/// something else in one write: `record_bill_with_policy` commits it alone,
/// and `decide_instruction` commits it beside the APPROVED status that made
/// it. The rest of the function body is unchanged.
pub(super) async fn insert_bill(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &RecordBillRequest,
    actor: &str,
    kind: &str,
    total: i64,
    withholding_code: Option<&str>,
) -> Result<Uuid, AppError> {
    let tx = &mut **tx;
    let lines = request.lines.as_deref().unwrap_or(&[]);
    let invoice_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO supplier_invoice
           (invoice_id, invoice_number, supplier_id, supplier_name, site_id, invoice_date,
            due_date, currency, subtotal_minor, tax_minor, discount_minor, total_minor,
            recorded_by, note, kind, withholding_code, submitted_by_domain, document_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'IDR',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
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
    .bind(kind)
    .bind(withholding_code)
    .bind(
        request
            .submitted_by_domain
            .as_deref()
            .map(str::trim)
            .filter(|domain| !domain.is_empty()),
    )
    .bind(
        request
            .document_ref
            .as_deref()
            .map(str::trim)
            .filter(|reference| !reference.is_empty()),
    )
    .execute(&mut *tx)
    .await
    .map_err(map_bill_write_error)?;

    for (index, line) in lines.iter().enumerate() {
        sqlx::query(
            "INSERT INTO supplier_invoice_expense_line
               (line_id, invoice_id, line_number, account_code, site_id, amount_minor,
                category_code, asset_class_code, draws_reserve, memo,
                asset_id, contract_id, repair_id, replacement_id, supply_request_id,
                service_period_start, service_period_end, account_overridden)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
        )
        .bind(Uuid::new_v4())
        .bind(invoice_id)
        .bind(index as i32 + 1)
        .bind(line.account_code.trim())
        .bind(line.site_id.trim())
        .bind(line.amount_minor)
        .bind(
            line.category_code
                .as_deref()
                .map(str::trim)
                .filter(|code| !code.is_empty()),
        )
        .bind(
            line.asset_class_code
                .as_deref()
                .map(str::trim)
                .filter(|class| !class.is_empty()),
        )
        .bind(line.draws_reserve)
        .bind(line.memo.as_deref())
        .bind(line.asset_id)
        .bind(line.contract_id)
        .bind(line.repair_id)
        .bind(line.replacement_id)
        .bind(line.supply_request_id)
        .bind(line.service_period_start)
        .bind(line.service_period_end)
        .bind(line.account_overridden)
        .execute(&mut *tx)
        .await?;
    }
    // The deliveries this bill pays for, and what the two of them disagree
    // about. Same transaction as the header on purpose: a bill that exists
    // without its link is a delivery that stays on the unbilled list forever,
    // and nobody would know to go back and add it.
    let receipts = request.receipt_ids.as_deref().unwrap_or(&[]);
    if !receipts.is_empty() {
        if kind == EXPENSE {
            return Err(AppError::Validation(
                "an expense bill does not pay for a delivery: electricity and rent arrive as \
                 costs, not as goods. Record the goods as a MERCHANDISE bill."
                    .into(),
            ));
        }
        let mut ordered_value: i64 = 0;
        for receipt_id in receipts {
            // FOR UPDATE rather than a unique index, because 0052 keyed the
            // join table on (invoice_id, receipt_id) — which permits the same
            // delivery on two bills, and paying for one lorry twice is the
            // error this screen exists to prevent. Locking the delivery makes
            // two bills claiming it serialise, so the second reads the first
            // one's link and is refused.
            let row = sqlx::query(
                // The value is a scalar subquery rather than a GROUP BY:
                // Postgres refuses FOR UPDATE on a grouped query, and the lock
                // on the receipt row is the whole point.
                "SELECT r.supplier_id,
                        (SELECT COALESCE(SUM(rl.quantity * pl.unit_price_minor), 0)::bigint
                           FROM goods_receipt_line rl
                           LEFT JOIN purchase_order_line pl ON pl.po_line_id = rl.po_line_id
                          WHERE rl.receipt_id = r.receipt_id) AS ordered
                   FROM goods_receipt r
                  WHERE r.receipt_id = $1
                    FOR UPDATE OF r",
            )
            .bind(receipt_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Validation(format!("no delivery {receipt_id} to bill for")))?;
            let receipt_supplier: String = row.get("supplier_id");
            if receipt_supplier.trim() != request.supplier_id.trim() {
                return Err(AppError::Validation(format!(
                    "delivery {receipt_id} came from {receipt_supplier} and this bill is from \
                     {}; a bill pays one supplier for their own goods",
                    request.supplier_id.trim()
                )));
            }
            let already: Option<String> = sqlx::query_scalar(
                "SELECT i.invoice_number FROM supplier_invoice_receipt sir
                   JOIN supplier_invoice i ON i.invoice_id = sir.invoice_id
                  WHERE sir.receipt_id = $1",
            )
            .bind(receipt_id)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(number) = already {
                return Err(AppError::Validation(format!(
                    "delivery {receipt_id} is already on bill {number}"
                )));
            }
            sqlx::query(
                "INSERT INTO supplier_invoice_receipt
                   (invoice_id, receipt_id, matched_by, matched_at)
                 VALUES ($1,$2,$3,now())",
            )
            .bind(invoice_id)
            .bind(receipt_id)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
            ordered_value = ordered_value
                .checked_add(row.get::<i64, _>("ordered"))
                .ok_or_else(|| AppError::Validation("the matched value overflows".into()))?;
        }
        // What the supplier is charging, against what the order said the goods
        // cost. Before tax on both sides: the order carries no VAT, so
        // comparing the bill's total to it would call the tax a variance.
        sqlx::query(
            "UPDATE supplier_invoice
                SET matched_by = $2, matched_at = now(), price_variance_minor = $3
              WHERE invoice_id = $1",
        )
        .bind(invoice_id)
        .bind(actor)
        .bind(request.subtotal_minor - request.discount_minor - ordered_value)
        .execute(&mut *tx)
        .await?;
    }

    Ok(invoice_id)
}

/// Record a bill under the ordinary policy: an EXPENSE bill posts as part of
/// recording it, a MERCHANDISE bill waits for its match.
async fn record_bill_with_policy(
    pool: &PgPool,
    request: &RecordBillRequest,
    actor: &str,
    auto_post_expense: bool,
) -> Result<SupplierBill, AppError> {
    let validated = validate_bill(pool, request).await?;
    // The header and its lines in one transaction, because 0094's deferred
    // trigger checks them together at COMMIT: an expense bill without its lines
    // is not a state that ever exists.
    let mut tx = pool.begin().await?;
    let invoice_id = insert_bill(
        &mut tx,
        request,
        actor,
        &validated.kind,
        validated.total,
        validated.withholding_code.as_deref(),
    )
    .await?;
    tx.commit().await?;

    // Matching is the same person's second sentence, not a second request. It
    // runs after the commit because it is its own transaction with its own
    // actor and its own refusals — but a refusal must not leave a DRAFT bill
    // behind for somebody to find and delete, so a failed match takes the bill
    // with it. Deleted rather than voided: nothing has referenced it, it has
    // existed for a few milliseconds, and there is no ledger entry to explain.
    if let Some(matching) = &request.matching {
        if let Err(error) =
            super::payables_flow::bill_match(pool, invoice_id, matching, actor).await
        {
            sqlx::query("DELETE FROM supplier_invoice WHERE invoice_id = $1 AND status = 'DRAFT'")
                .bind(invoice_id)
                .execute(pool)
                .await?;
            return Err(error);
        }
    }

    if auto_post_expense && validated.kind == EXPENSE {
        // A completed expense bill already carries its deliberate account and
        // category coding. The journal is part of recording it; an unresolved
        // account/map/period refusal leaves the bill visible as a draft.
        post_bill(pool, invoice_id, None, actor).await
    } else {
        bill(pool, invoice_id).await
    }
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
    // # The one thing that blocks posting
    //
    // Brief §8.4, and the decision most easily broken by a later "add a
    // validation here": the six warnings are WARNINGS and do not stop a post,
    // and the ONLY state that does is a hold. Do not add a warning to this
    // list: `post_bill` refuses an on_hold bill and nothing else, so a person
    // can post with a duplicate number or an over-budget line after reading it.
    if existing.on_hold {
        return Err(AppError::Conflict(format!(
            "bill {} is on hold ({}); release the hold before posting",
            existing.invoice_number,
            existing.hold_reason.as_deref().unwrap_or("no reason given")
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
    // The line's account is named directly rather than through `account_resolution`,
    // and that is not the rule breaking 0050's "nothing in Rust names a client
    // account code". Nothing here names one: the code comes off the document,
    // chosen by the person who read the paper, exactly as it does on a manual
    // journal entry. `LineAccount::Account` is the same door that entry uses.
    //
    // A cost line lands where the cost belongs and the payable lands at the
    // bill's own location, so an expense bill spanning four shops posts four
    // costs and one payable. That does not balance per location on its own, and
    // it does not have to: 0121 relaxed 0098's "a line sits where its bill
    // does", and `poster::post` adds the affiliate legs that leave each shop
    // and head office at zero — which is the only way this can be read against
    // the client's own per-location trial balance.
    //
    // Two exceptions to "debit whatever the person wrote down", and both are
    // the register speaking rather than the document:
    //
    //   * a line that says it buys an asset gets that asset as its dimension,
    //     so the ledger can be asked what one machine has cost. The asset is
    //     minted first, below, inside the same transaction — a draft asset with
    //     no posted bill behind it is a state nobody could explain.
    //   * a line that says it DRAWS the replacement reserve debits the reserve
    //     for its class instead of the account named on it. The expense was
    //     already taken, month by month, while the reserve was being built;
    //     charging it again would put one rack through the profit and loss
    //     twice.
    let mut tx = pool.begin().await?;
    let minted = if expense {
        asset_drafts_for_bill(&mut tx, invoice_id, actor).await?
    } else {
        std::collections::HashMap::new()
    };

    let mut lines: Vec<PostingLine> = if expense {
        existing
            .lines
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(|line| {
                let mut posting = match (line.draws_reserve, line.asset_class_code.as_deref()) {
                    (true, Some(class)) => {
                        PostingLine::debit("replacement_reserve", &line.site_id, line.amount_minor)
                            .with_qualifier(class)
                    }
                    _ => PostingLine {
                        dimensions: Vec::new(),
                        account: LineAccount::Account {
                            account_code: line.account_code.clone(),
                            // The person's own coding, carried from the line
                            // they keyed. Not re-derived: a bill posted today
                            // and reversed in March has to land in the same
                            // place both times.
                            category_code: line.category_code.clone(),
                        },
                        site_id: line.site_id.clone(),
                        // Nothing to say: where a cost line sits somewhere else
                        // the balancer works the counterparty out and adds the
                        // affiliate legs itself.
                        counter_site_id: None,
                        debit_minor: line.amount_minor,
                        credit_minor: 0,
                        party_type: None,
                        party_id: None,
                        asset_id: None,
                        bank_account_id: None,
                        memo: line.memo.clone(),
                    },
                };
                posting.memo = line.memo.clone();
                posting.asset_id = minted.get(&line.line_id).copied();
                posting
            })
            .collect()
    } else {
        // MERCHANDISE — a receipt already debited inventory and credited the
        // supplier payable. A matched invoice clears that receipt liability,
        // recognizes its actual invoice amount, and records any price variance.
        // An unmatched invoice still debits inventory directly.
        super::payables_flow::merchandise_debit_lines(
            pool,
            invoice_id,
            &existing.site_id,
            &existing.supplier_id,
            existing.subtotal_minor,
            existing.price_variance_minor,
        )
        .await?
    };
    // A merchandise invoice whose matched price differs from the receipt's:
    // fold the difference into the layer (inventory while on hand, cost of sales
    // once sold) instead of booking it to 8004. Journal-less — this bill already
    // credits the payable for the invoice, so the correction contributes only
    // the split and the Atas Barang legs.
    if !expense && existing.price_variance_minor != 0 {
        super::payables_flow::append_price_correction(
            &mut tx,
            &mut lines,
            invoice_id,
            existing.invoice_date,
            existing.price_variance_minor,
            actor,
        )
        .await?;
    }
    // PPN is ignored for now (owner decision, 25 Sep) and 0377 removes the
    // `vat_in` map. A bill that carries tax is refused rather than posted with
    // the tax folded somewhere it does not belong: if the client is chargeable
    // this needs a decision, and a silent guess is the one thing that is worse.
    if existing.tax_minor > 0 {
        return Err(AppError::Validation(format!(
            "bill {} carries {} tax and PPN is ignored for now: record it at the net amount, or \
             confirm whether this client is chargeable",
            existing.invoice_number, existing.tax_minor
        )));
    }
    // The supplier is head office's counterparty, never a shop's (owner rule,
    // 25 Sep). The cost lines keep the site they were keyed at; the payable
    // lands at dc and the poster's balancer closes the shop's side through the
    // affiliate accounts, so a shop's electricity bill reads
    // shop Dr 6045 / Cr 2028, head office Dr 1057 / Cr 2004.
    let head_office = super::sites::head_office_site_id(&mut *tx).await?;
    lines.push(
        PostingLine::credit(
            if expense {
                "non_merchandise_payable"
            } else {
                "trade_payable"
            },
            &head_office,
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

    // The transaction was opened above, so the assets this bill mints and the
    // entry that pays for them are one write.
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
    // A posted bill is a debt to a named supplier, due on a named date. In the
    // same transaction as the entry that raised it: a payable item without its
    // journal entry is a figure nobody can trace.
    if expense {
        super::payables_flow::payable_opened(
            &mut tx,
            super::payables_flow::payable_key(true),
            "SUPPLIER_INVOICE",
            &existing.site_id,
            &existing.supplier_id,
            existing.supplier_name.as_deref(),
            invoice_id,
            existing.total_minor,
            existing.due_date,
            intent.posting_date,
            posted.entry_id,
            actor,
        )
        .await?;
    } else {
        super::payables_flow::invoice_payable_replaces_receipts(
            &mut tx,
            invoice_id,
            &existing.site_id,
            &existing.supplier_id,
            existing.supplier_name.as_deref(),
            existing.total_minor,
            existing.due_date,
            intent.posting_date,
            posted.entry_id,
            actor,
        )
        .await?;
    }
    tx.commit().await?;

    bill(pool, invoice_id).await
}

/// Deliveries with no bill against them, and what they are worth.
///
/// Valued at the ordered price times the accepted quantity, because that is
/// what the supplier has agreed to charge. It is an estimate of an exposure,
/// not a balance, and it is labelled as one wherever it is shown.
///
/// # The unit is respelled into the centre's own name
///
/// A goods receipt is minted at the DC and carries the DC's name for ITSELF —
/// `dc-01`, because the Edge parameterises its ids by the site it runs as,
/// while the centre has exactly one distribution centre and spells it `dc`
/// (see `sync::pool_id_for_site`, which closes the same gap for pool ids).
/// Every other finance read answers in the centre's spelling, so this one
/// answered in a vocabulary the unit pickers and the name lookups do not
/// have — and the screens fell back to printing the raw id.
///
/// The edge's own spelling is not thrown away: it comes back as
/// `origin_site_id`, because it is what is printed on the receipt number and
/// what somebody standing in the warehouse will quote.
pub async fn unbilled_receipts(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<UnbilledReceipt>, AppError> {
    let rows = sqlx::query(
        "SELECT r.receipt_id, r.receipt_number, r.supplier_id, r.arrived_at,
                r.site_id AS origin_site_id,
                COALESCE(
                    -- Already the centre's name for it: every store spells
                    -- itself the same on both sides, so this is the whole
                    -- fleet bar the DC and costs one index probe.
                    (SELECT s.id FROM site s WHERE s.id = r.site_id),
                    -- A DC node calling itself something else — which is now
                    -- every DC node, because 0256 folded the warehouse into
                    -- head office and the centre's row for it is `ho` while
                    -- the box in the building still runs as `dc` or `dc-01`.
                    -- The node ROLE is still `DC`; the site KIND is `HO`.
                    -- The centre has one such building; `LIMIT 1` says so
                    -- rather than multiplying the row if that ever changes.
                    CASE WHEN o.node_role = 'DC'
                         THEN (SELECT s.id FROM site s WHERE s.kind = 'HO'
                                ORDER BY s.id LIMIT 1) END,
                    -- Nothing we can resolve. The raw id, which is at least
                    -- the truth about what arrived.
                    r.site_id
                ) AS site_id,
                r.invoice_number, r.invoice_total_minor,
                COALESCE(SUM(rl.quantity * pl.unit_price_minor), 0)::bigint AS value_at_order_price,
                COUNT(rl.receipt_line_id)::bigint AS line_count,
                (CURRENT_DATE - r.arrived_at::date)::int AS days_waiting
           FROM goods_receipt r
           LEFT JOIN sync_origin_credential o ON o.origin_id = r.origin_id
           LEFT JOIN goods_receipt_line rl ON rl.receipt_id = r.receipt_id
           LEFT JOIN purchase_order_line pl ON pl.po_line_id = rl.po_line_id
          WHERE NOT EXISTS (
                    SELECT 1 FROM supplier_invoice_receipt sir
                     WHERE sir.receipt_id = r.receipt_id)
          GROUP BY r.receipt_id, o.node_role
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
                origin_site_id: row.try_get("origin_site_id")?,
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
    /// How many open items are behind these figures: invoices and unbilled
    /// goods receipts.
    pub open_document_count: i64,
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
    /// How many POSTED bills in this scope are held, and what they come to.
    ///
    /// Counted and summed SEPARATELY rather than folded into the buckets: a
    /// held bill is still owed — it is real money against a real supplier — but
    /// it cannot be paid until somebody releases it, so a ready-to-pay screen
    /// has to be able to say "n ditahan" rather than silently hide it.
    pub on_hold_count: i64,
    pub on_hold_minor: i64,
    /// The general ledger's own answer: the balance of every account mapped to
    /// `trade_payable` or `non_merchandise_payable`, as at `as_of`, in this
    /// scope, as a positive debt.
    ///
    /// Resolved through `account_resolution` here rather than by an account code in
    /// the screen: the screen used to ask for a client code (`2012001`) that
    /// the chart in use does not have, got a ledger of nothing back, and
    /// reported the whole ageing as a difference "against the books".
    pub books_minor: i64,
}

/// Ageing over posted supplier invoices and unbilled goods receipts, as at a date.
///
/// # Why this is not summed from `journal_line`
///
/// Every other balance in this module is, and deliberately. This one is not,
/// because ageing is a question about DOCUMENTS: which invoice or goods
/// receipt, dated when, due when. The ledger carries a supplier on the line and
/// no due date at all, so a journal-derived ageing would have to guess terms
/// from the posting date. Unbilled receipts age from their posting date (the
/// arrival date by default); invoices age from their terms.
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
             -- Not `supplier_invoice_standing`, deliberately. That view answers
             -- as at TODAY, and this report answers as at `$1` — both sides
             -- wound back. The logic below is the view's, with the date it
             -- counts from and the payments it counts made into parameters.
             SELECT i.supplier_id,
                    i.supplier_name,
                    ($1::date - COALESCE(upcoming.due_date, i.due_date, i.invoice_date))::int
                        AS age_days,
                    (i.total_minor - settled.paid_minor) AS outstanding_minor
               FROM supplier_invoice i
               -- Payments AND advances set against the bill: an applied
               -- advance posts `Dr trade_payable` and settles the payment-
               -- ledger item, so leaving it out owed it twice (0391). Wound
               -- back by the application's own posting date.
               CROSS JOIN LATERAL (
                   SELECT (COALESCE((SELECT SUM(al.amount_minor)
                                       FROM supplier_payment_allocation al
                                       JOIN supplier_payment p USING (payment_id)
                                      WHERE al.invoice_id = i.invoice_id
                                        AND p.status = 'POSTED'
                                        AND p.payment_date <= $1), 0)
                           + COALESCE((SELECT SUM(ap.amount_minor)
                                         FROM supplier_advance_application ap
                                         JOIN journal_entry e ON e.entry_id = ap.journal_entry_id
                                        WHERE ap.invoice_id = i.invoice_id
                                          AND e.posting_date <= $1), 0))::bigint AS paid_minor
               ) settled
               -- The earliest instalment the payments made by `$1` have not
               -- covered. A bill whose advance was settled ages from its
               -- balance, not from the advance it no longer owes — which is
               -- the whole difference this report used to be unable to draw.
               LEFT JOIN LATERAL (
                   SELECT t.due_date
                     FROM (SELECT due_date,
                                  SUM(amount_minor) OVER (ORDER BY due_date, seq) AS through
                             FROM supplier_invoice_payment_term
                            WHERE invoice_id = i.invoice_id) t
                    WHERE t.through > settled.paid_minor
                    ORDER BY t.due_date
                    LIMIT 1
               ) upcoming ON true
              WHERE i.status = 'POSTED'
                AND i.invoice_date <= $1
                -- Held bills are excluded from the buckets and counted on
                -- their own, below — see `PayablesAging::on_hold_count`.
                AND NOT i.on_hold
                AND ($2::text IS NULL OR i.site_id = $2)
         ), open_receipt AS (
             -- Before its invoice arrives, the receipt itself is the open
             -- supplier debt. The Payment Ledger carries its receipt date and
             -- the same supplier/location dimensions as the eventual bill.
             -- The name from the supplier register when the item does not carry
             -- one: receipts valued before 0390 were filed without it, and a
             -- supplier code in the ageing is a row nobody recognises.
             SELECT i.party_id AS supplier_id,
                    COALESCE(i.party_name,
                             (SELECT s.name FROM supplier s WHERE s.supplier_code = i.party_id),
                             i.party_id) AS supplier_name,
                    i.age_days,
                    i.outstanding_minor
               FROM payment_ledger_as_of($1) i
              WHERE i.account_key = 'trade_payable'
                AND i.party_type = 'SUPPLIER'
                AND i.side = 'PAYABLE'
                AND i.voucher_kind = 'GOODS_RECEIPT'
                AND i.outstanding_minor > 0
                AND ($2::text IS NULL OR i.site_id = $2)
         ), open_item AS (
             SELECT supplier_id, supplier_name, age_days, outstanding_minor
               FROM open_bill
              WHERE outstanding_minor > 0
             UNION ALL
             SELECT supplier_id, supplier_name, age_days, outstanding_minor
               FROM open_receipt
         )
         SELECT supplier_id,
                MAX(supplier_name) AS supplier_name,
                COUNT(*)::bigint AS open_document_count,
                MAX(age_days)::int AS oldest_days,
                SUM(outstanding_minor) FILTER (WHERE age_days <= 0)::bigint AS not_due,
                SUM(outstanding_minor) FILTER (WHERE age_days BETWEEN 1 AND 30)::bigint AS d1_30,
                SUM(outstanding_minor) FILTER (WHERE age_days BETWEEN 31 AND 60)::bigint AS d31_60,
                SUM(outstanding_minor) FILTER (WHERE age_days BETWEEN 61 AND 90)::bigint AS d61_90,
                SUM(outstanding_minor) FILTER (WHERE age_days > 90)::bigint AS d90_plus,
                SUM(outstanding_minor)::bigint AS total
           FROM open_item
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
            open_document_count: row.try_get("open_document_count")?,
            oldest_days: row.try_get("oldest_days")?,
            buckets,
        });
    }

    // The held bills, counted and summed on their own. POSTED only, wound back
    // to `as_of` the same way the buckets are: a bill that was not yet a debt
    // on that date is not a held debt then either.
    let held = sqlx::query(
        "SELECT COUNT(*)::bigint AS n, COALESCE(SUM(i.total_minor), 0)::bigint AS total
           FROM supplier_invoice i
          WHERE i.status = 'POSTED'
            AND i.on_hold
            AND i.invoice_date <= $1
            AND ($2::text IS NULL OR i.site_id = $2)",
    )
    .bind(as_of)
    .bind(site_id)
    .fetch_one(pool)
    .await?;

    // The books, for the reconciliation beside the ageing. By POSTING date,
    // which is the ledger's calendar; the ageing counts a bill from its
    // invoice date, and a difference between the two is that statement.
    let books_minor: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.credit_minor - l.debit_minor), 0)::bigint
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
          WHERE l.account_code IN (
                SELECT m.account_code FROM account_resolution m
                 WHERE m.role IN ('trade_payable', 'non_merchandise_payable'))
            AND e.posting_date <= $1
            AND ($2::text IS NULL OR l.site_id = $2)",
    )
    .bind(as_of)
    .bind(site_id)
    .fetch_one(pool)
    .await?;

    Ok(PayablesAging {
        as_of,
        site_id: site_id.map(str::to_string),
        suppliers,
        total,
        on_hold_count: held.try_get("n")?,
        on_hold_minor: held.try_get("total")?,
        books_minor,
    })
}

// ---------------------------------------------------------------------------
// Warnings before posting (brief §8.4)
// ---------------------------------------------------------------------------

/// One thing worth telling a person BEFORE they post a bill.
///
/// A warning is not a block. `post_bill` refuses a held bill and nothing else,
/// and that is deliberate (brief §8.4): the reader is told what is odd and
/// decides. A refactor that "adds a validation" on one of these codes is a bug,
/// not a hardening.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BillWarning {
    /// `DUPLICATE_NUMBER`, `OVER_CONTRACT`, `OVER_BUDGET`, `ROUTINE_VARIANCE`,
    /// `PERIOD_OUTSIDE_CONTRACT`, `VENDOR_MISMATCH`.
    pub code: String,
    /// The sentence a person reads.
    pub message: String,
    /// The document or figure behind it, when there is one to name.
    pub detail: Option<String>,
}

fn warning(code: &str, message: String, detail: Option<String>) -> BillWarning {
    BillWarning {
        code: code.into(),
        message,
        detail,
    }
}

/// The six checks, each on its own so one cannot hide another.
///
/// All six run and all six come back; there is no early return, because a bill
/// with a duplicate number AND an over-budget line is exactly the bill somebody
/// most needs the whole list for. Nothing here writes and nothing here refuses.
pub async fn bill_warnings(
    pool: &PgPool,
    invoice_id: Uuid,
) -> Result<Vec<BillWarning>, AppError> {
    let header = sqlx::query(
        "SELECT invoice_number, supplier_id, supplier_name FROM supplier_invoice
          WHERE invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("supplier bill".into()))?;
    let invoice_number: String = header.try_get("invoice_number")?;
    let supplier_id: String = header.try_get("supplier_id")?;

    let mut out = Vec::new();

    // 1. The same number, normalised, on another bill of this supplier.
    let duplicate: Option<String> = sqlx::query_scalar(
        "SELECT invoice_number FROM supplier_invoice
          WHERE supplier_id = $1 AND invoice_id <> $2
            AND upper(regexp_replace(invoice_number, '\\s+', '', 'g'))
              = upper(regexp_replace($3, '\\s+', '', 'g'))
          ORDER BY invoice_date
          LIMIT 1",
    )
    .bind(&supplier_id)
    .bind(invoice_id)
    .bind(&invoice_number)
    .fetch_optional(pool)
    .await?;

    // 2. More than what is left on a contract this bill points at.
    let contracts = sqlx::query(
        "SELECT c.contract_id, c.contract_number, c.contract_value_minor,
                (SELECT COALESCE(SUM(bl.amount_minor), 0)::bigint
                   FROM supplier_invoice_expense_line bl
                   JOIN supplier_invoice si ON si.invoice_id = bl.invoice_id
                  WHERE bl.contract_id = c.contract_id AND si.status = 'POSTED'
                    AND si.invoice_id <> $1) AS posted,
                (SELECT COALESCE(SUM(bl.amount_minor), 0)::bigint
                   FROM supplier_invoice_expense_line bl
                  WHERE bl.contract_id = c.contract_id AND bl.invoice_id = $1) AS mine
           FROM ga_contract c
          WHERE c.contract_id IN (
                SELECT contract_id FROM supplier_invoice_expense_line
                 WHERE invoice_id = $1 AND contract_id IS NOT NULL)",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await?;

    // 3. More than the ceiling somebody approved (or estimated) for a repair.
    let repairs = sqlx::query(
        "SELECT r.repair_id, r.title, r.approved_budget_minor, r.estimated_cost_minor,
                (SELECT COALESCE(SUM(bl.amount_minor), 0)::bigint
                   FROM supplier_invoice_expense_line bl
                  WHERE bl.repair_id = r.repair_id AND bl.invoice_id = $1) AS mine
           FROM ga_repair r
          WHERE r.repair_id IN (
                SELECT repair_id FROM supplier_invoice_expense_line
                 WHERE invoice_id = $1 AND repair_id IS NOT NULL)",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await?;

    // 4. A bill a recurring promise raised, reading away from the promised
    //    figure by more than the promise's own tolerance.
    let routine = sqlx::query(
        "SELECT t.label, t.expected_subtotal_minor, t.tolerance_bps,
                (SELECT COALESCE(SUM(bl.amount_minor), 0)::bigint
                   FROM supplier_invoice_expense_line bl
                  WHERE bl.invoice_id = $1) AS mine
           FROM bill_template_run r
           JOIN bill_template t ON t.template_id = r.template_id
          WHERE r.invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await?;

    // 5. A service period that leaves the window of the contract it names.
    let periods = sqlx::query(
        "SELECT c.contract_number, l.line_number, l.service_period_start,
                l.service_period_end, c.starts_on, c.ends_on
           FROM supplier_invoice_expense_line l
           JOIN ga_contract c ON c.contract_id = l.contract_id
          WHERE l.invoice_id = $1 AND l.contract_id IS NOT NULL
            AND ((l.service_period_start IS NOT NULL AND l.service_period_start < c.starts_on)
              OR (l.service_period_end IS NOT NULL AND c.ends_on IS NOT NULL
                  AND l.service_period_end > c.ends_on))",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await?;

    // 6. The bill's vendor against the party the contract names.
    let mismatches = sqlx::query(
        "SELECT DISTINCT c.contract_id, c.contract_number, c.supplier_id::text AS supplier_id,
                c.counterparty_name
           FROM supplier_invoice_expense_line l
           JOIN ga_contract c ON c.contract_id = l.contract_id
          WHERE l.invoice_id = $1 AND c.contract_id IS NOT NULL
            AND c.supplier_id::text IS DISTINCT FROM $2",
    )
    .bind(invoice_id)
    .bind(&supplier_id)
    .fetch_all(pool)
    .await?;

    if let Some(existing) = duplicate {
        out.push(warning(
            "DUPLICATE_NUMBER",
            format!(
                "this supplier already has an invoice numbered {existing}; {} and {existing} are \
                 the same number once spaces are removed",
                invoice_number.trim()
            ),
            Some(existing),
        ));
    }

    for row in &contracts {
        let value: Option<i64> = row.try_get("contract_value_minor")?;
        let posted: i64 = row.try_get("posted")?;
        let mine: i64 = row.try_get("mine")?;
        if let Some(value) = value {
            let remaining = value - posted;
            if mine > remaining {
                let number: Option<String> = row.try_get("contract_number")?;
                out.push(warning(
                    "OVER_CONTRACT",
                    format!(
                        "this contract's lines bill {mine} against {remaining} left of a {value} \
                         contract"
                    ),
                    Some(number.unwrap_or_else(|| {
                        row.try_get::<Uuid, _>("contract_id")
                            .map(|id| id.to_string())
                            .unwrap_or_default()
                    })),
                ));
            }
        }
    }

    for row in &repairs {
        let ceiling = row
            .try_get::<Option<i64>, _>("approved_budget_minor")?
            .or(row.try_get::<Option<i64>, _>("estimated_cost_minor")?);
        let mine: i64 = row.try_get("mine")?;
        if let Some(ceiling) = ceiling {
            if mine > ceiling {
                let title: String = row.try_get("title")?;
                out.push(warning(
                    "OVER_BUDGET",
                    format!("this repair's lines bill {mine} against a ceiling of {ceiling}"),
                    Some(title),
                ));
            }
        }
    }

    for row in &routine {
        let expected: i64 = row.try_get("expected_subtotal_minor")?;
        let tolerance_bps: i32 = row.try_get("tolerance_bps")?;
        let mine: i64 = row.try_get("mine")?;
        let allowed = expected.saturating_mul(i64::from(tolerance_bps)) / 10_000;
        let difference = (mine - expected).abs();
        if difference > allowed {
            let label: String = row.try_get("label")?;
            out.push(warning(
                "ROUTINE_VARIANCE",
                format!(
                    "the recurring bill “{label}” expects {expected} and this bill says {mine}, \
                     more than the {tolerance_bps} basis-point tolerance"
                ),
                Some(label),
            ));
        }
    }

    for row in &periods {
        let line_number: i32 = row.try_get("line_number")?;
        let contract_number: Option<String> = row.try_get("contract_number")?;
        out.push(warning(
            "PERIOD_OUTSIDE_CONTRACT",
            format!(
                "line {line_number}'s service period falls outside the contract's own window"
            ),
            Some(
                contract_number
                    .unwrap_or_else(|| format!("contract {}", row.try_get::<Uuid, _>("contract_id").map(|id| id.to_string()).unwrap_or_default())),
            ),
        ));
    }

    for row in &mismatches {
        let counterparty: Option<String> = row.try_get("counterparty_name")?;
        let contract_supplier: Option<String> = row.try_get("supplier_id")?;
        let number: Option<String> = row.try_get("contract_number")?;
        out.push(warning(
            "VENDOR_MISMATCH",
            if let Some(counterparty) = counterparty {
                format!(
                    "this bill is from {supplier_id} and the contract's other party is \
                     {counterparty}, who is not a vendor"
                )
            } else {
                format!(
                    "this bill is from {supplier_id} and the contract's other party is {}",
                    contract_supplier.as_deref().unwrap_or("another vendor")
                )
            },
            number.or_else(|| contract_supplier),
        ));
    }

    Ok(out)
}
