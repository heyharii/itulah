//! The cutover: bringing a client's books, their shelves and their open items
//! across from the system they used before this one.
//!
//! Three imports and a report. Each import reads a sheet, rehearses it, and —
//! only if asked a second time — commits it. The arithmetic all lives in
//! `domain::opening`; what is here is the part that needs a database: resolving
//! the client's account codes against the chart, posting through the one door,
//! creating the cost layers FIFO will start from, and asking each equation
//! whether it agrees.
//!
//! # Why this exists at all rather than as a page of journal entries
//!
//! Two of the three could be typed by hand. The trial balance is one entry per
//! unit and somebody with the Journal screen could key it. The open items are a
//! list. The stock cannot be, and that is the reason for the lane: the frozen
//! costing policy is FIFO over cost layers, a layer exists only because
//! something created it, and Seventhsoft is periodic — it expensed the
//! purchases and counted the shelf, so there are no layers to bring across.
//! Somebody has to price the opening stock once, and after the first sale on
//! the first morning it is too late: the queue will have started without a
//! beginning and every margin after it is wrong by an amount nobody can name.
//!
//! # The rehearsal is the run
//!
//! `commit` defaults to false and a rehearsal is not a second code path. It
//! does the whole import inside a transaction — parses, resolves, posts,
//! creates the layers, opens the sub-ledger items, asks the equations — and
//! then rolls back instead of committing. A rehearsal that predicted the run
//! from a parallel implementation would be a rehearsal that can disagree with
//! it, and the one thing this lane cannot afford is being told the import would
//! be fine by something that is not the import.
//!
//! It costs one thing, and it is worth naming: `journal_entry_number_seq` is a
//! sequence, so a rehearsal consumes entry numbers that the rolled-back
//! transaction never uses. Journal numbering has always had that property —
//! every failed posting anywhere in the system does the same — and the
//! alternative is a rehearsal that does not exercise the poster.
//!
//! # The shapes these imports read
//!
//! All three are CSV with a header row. Column ORDER does not matter and
//! unknown columns are ignored, because these files are exported out of
//! somebody else's software and then edited in a spreadsheet. Money is written
//! however the exporting locale wrote it — see `parse_opening_amount` — and
//! dates are `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY`.
//!
//! ## 1. The opening trial balance — `opening_import_balances`
//!
//! ```text
//! unit_id,account_code,category_code,counter_unit_id,debit,credit,document_no,memo
//! ho,1301,MERCHANDISE,,4750000000,,TB-2026-08,Persediaan per 31 Agustus
//! ho,2101,,,,4750000000,TB-2026-08,Hutang dagang
//! store-01,1501,FINANCING,ho,,910000000,TB-2026-08,Posisi toko terhadap HO
//! ```
//!
//! * `unit_id` — ours (head office's, `store-01` …), not theirs. Which set of
//!   books: an opening balance is a unit's balance on the cutover day (0608),
//!   and each unit's lines post as one entry that balances on its own.
//! * `account_code` — OURS now, one of the forty (0289), not the twelve-digit
//!   code the trial balance was printed in. Their code is still how the file
//!   arrives, so whoever prepares it translates once, with
//!   `ledger_account_remap` and `docs/finance-legacy-codes.md` to hand.
//!   Refused if the chart does not carry it, if it is a heading, or if it has
//!   been retired — and all 190 of their codes are now retired, so pasting one
//!   in stops with a message rather than landing somewhere plausible.
//! * `category_code` — required when the account declares a category family,
//!   forbidden when it does not. `1301 Persediaan` wants an `item_class`;
//!   `2101 Hutang usaha` wants nothing, because which supplier is a column.
//!   An opening balance is the one import where getting this wrong is
//!   expensive: every later report reads off it.
//! * `counter_unit_id` — which unit is on the other side, required on the two
//!   accounts that are a balance BETWEEN units (`1501` and `1302`) and empty on
//!   the other thirty-eight. A store's position is always with head office and
//!   head office's is with a store (I8), so on a store's line it is head
//!   office's unit — whichever unit is of kind `HO` — and nothing else.
//!
//!   It is what lets a shop's sheet balance at all. A shop's books close on a
//!   net position against head office, and there is exactly one account in the
//!   forty that can carry it: retained earnings `3201` is `company`-dimension
//!   and refuses `store-01`, so the figure belongs on `1501 Rekening koran
//!   antar-unit` — which `requires_counter_site` and is refused without one.
//!   Before this column a shop's trial balance could not be imported at all:
//!   its own side was fine and the balancing figure had nowhere to go.
//! * `debit` / `credit` — one of the two per row, the other empty.
//! * `document_no` — their reference for the report this came off, kept
//!   because their auditors will ask for it by that number.
//! * `memo` — optional, per line.
//!
//! ## 2. The opening stock sheet — `opening_import_stock`
//!
//! ```text
//! site_id,article_code,pool_id,quantity,last_purchase_cost,stated_cost,document_no
//! dc,ART-001,dc.warehouse,120,125000,,SO-2026-08
//! dc,ART-002,dc.warehouse,40,,90000,SO-2026-08
//! ```
//!
//! * `site_id` — a PREMISES, not a book: stock is counted in a place. Its value
//!   is reconciled against the inventory account of the unit that owns the
//!   place (`unit_of_site`), all of a unit's places together.
//! * `last_purchase_cost` — per piece, out of the client's own purchase
//!   history. The only basis that is not a compromise, and preferred whenever
//!   the cell is filled.
//! * `stated_cost` — per piece, what somebody decided when the history had
//!   nothing. Both may be empty only if this system already holds layers for
//!   the article, which is the phased-cutover case; otherwise the line is
//!   refused rather than opened at zero.
//! * There is no `system_average` column, deliberately: it is a fact this
//!   database holds and not one the sheet gets to assert.
//!
//! ## 3. The open items — `opening_import_subledger`
//!
//! ```text
//! unit_id,account_key,qualifier,party_type,party_id,party_name,side,voucher_kind,voucher_id,amount,document_date,due_date
//! ho,trade_payable,,SUPPLIER,SUP-01,PT Kain Jaya,PAYABLE,INVOICE,INV-8891,180000000,2026-08-02,2026-09-30
//! store-01,card_receivable_debit,BCA,ACQUIRER,BCA,Bank BCA,RECEIVABLE,BATCH,BCA-0831,4200000,2026-08-31,
//! ```
//!
//! * `unit_id` — the books the item sits in, the same key the Payment Ledger
//!   is reconciled against them by (0608).
//! * `account_key` — the SEMANTIC key of the control account, not a code. It
//!   is what the Payment Ledger identifies itself by and what
//!   `payment_ledger_integrity` compares against the map, so a code here would
//!   be a second answer to a question 0145 already answers.
//! * `document_date` — theirs, and the date the item is aged from. Not the
//!   cutover date: every open item at a cutover is older than the cutover, and
//!   half of them are already overdue.

use super::ledger::{assert_category_for_account, assert_postable, resolve_account_code, Intent};
use super::payment_ledger::{
    ple_open, PaymentLedgerItem, PaymentLedgerPartyType, PaymentLedgerSide,
};
use super::poster::{post, LineAccount, PostingIntent, PostingLine};
use super::sites::{head_office_unit_id, unit_exists, unit_of_site};
use super::stock_ledger::{cost_layer_create, NewCostLayer};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    opening_unit_totals, parse_csv, parse_opening_amount, price_opening_stock, reconcile_opening,
    CsvRow, OpeningAmount, OpeningReconciliation, OpeningStockFacts, OpeningUnitTotal,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// The one `source_kind` whose entries describe events that happened in another
/// company's software. Added to `journal_entry`'s CHECK by 0158.
pub const OPENING_SOURCE_KIND: &str = "OPENING";

/// Which rule built the entry. Bumped if the shape of an opening entry ever
/// changes, which is how the entries the old shape produced stay identifiable.
pub const OPENING_RULE_VERSION: &str = "opening/1";

/// Everything in these books is Rupiah, and the cutover does not change that.
const CURRENCY: &str = "IDR";

// ---------------------------------------------------------------------------
// What an import is asked to do
// ---------------------------------------------------------------------------

/// One import, rehearsed or run.
#[derive(Clone, Debug, Deserialize)]
pub struct OpeningImportRequest {
    /// The last day of the old system. Every figure in the sheet is "as at"
    /// this, and it is what the whole import is idempotent on.
    pub cutover_date: NaiveDate,
    /// The sheet itself, as text.
    pub csv: String,
    /// **Defaults to false, which is a rehearsal.** Posting the opening
    /// balances is the most destructive single act available in this system and
    /// the default for it is to not do it. Somebody has to say so twice.
    #[serde(default)]
    pub commit: bool,
}

/// What a run did, or what a rehearsal would have done.
///
/// One shape for both, because they are the same import — the only difference
/// is whether the transaction was committed — and two shapes would let a screen
/// present a rehearsal as something other than what will happen.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningBalanceOutcome {
    pub cutover_date: NaiveDate,
    /// False when this was a rehearsal, and every figure below is what the run
    /// would produce rather than what it produced.
    pub committed: bool,
    pub lines: i64,
    /// One per unit, in the order the file names them.
    pub units: Vec<OpeningUnitTotal>,
    pub entries: Vec<OpeningPostedEntry>,
    /// The client's own references, so a person can see at a glance which of
    /// their reports this came off.
    pub document_numbers: Vec<String>,
    /// What the equations say as at the cutover date, computed inside the same
    /// transaction — so a rehearsal reports the state the run would leave.
    pub equations: Vec<OpeningEquation>,
}

/// One unit's opening entry.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningPostedEntry {
    pub unit_id: String,
    pub entry_number: String,
    pub total_minor: i64,
    pub lines: i64,
}

/// One control equation, as at the cutover date.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningEquation {
    /// Dotted, and the same keys the integrity engine uses where there is one.
    pub key: String,
    pub title: String,
    /// The books the equation is asked of. Every one of them is about a
    /// unit's books — the ledger, the open items, the inventory account.
    pub unit_id: Option<String>,
    pub left_minor: i64,
    pub right_minor: i64,
    pub difference_minor: i64,
    pub agrees: bool,
    /// What the two sides are, in a sentence, because "difference 250,000" on
    /// its own does not say between what.
    pub detail: String,
}

/// What the stock import did, or would.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningStockOutcome {
    pub cutover_date: NaiveDate,
    pub committed: bool,
    pub lines: i64,
    pub layers: i64,
    pub units: Vec<OpeningStockUnit>,
    /// Every line whose price was not a real purchase price. **This is the list
    /// somebody has to read before agreeing to the cutover**, which is why it
    /// is carried in full and not counted.
    pub fallbacks: Vec<OpeningFallback>,
    pub equations: Vec<OpeningEquation>,
}

/// One unit's opening stock, against the account that is supposed to explain it.
///
/// Per unit and not per place, because the inventory account is a unit's:
/// the stock of every premises a unit owns is explained by the one balance in
/// its books, so it is only the sum over those premises that can agree with it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningStockUnit {
    pub unit_id: String,
    pub articles: i64,
    pub quantity: i64,
    pub value_minor: i64,
    /// The client's inventory account in this unit's books, as the map resolves it.
    pub inventory_account: String,
    pub reconciliation: OpeningReconciliation,
}

/// One piece of stock priced by something other than what was paid for it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningFallback {
    pub site_id: String,
    pub article_code: String,
    pub quantity: i64,
    pub unit_cost_minor: i64,
    pub value_minor: i64,
    pub basis: String,
    pub note: String,
}

/// What the open-items import did, or would.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningSubledgerOutcome {
    pub cutover_date: NaiveDate,
    pub committed: bool,
    pub lines: i64,
    pub payable_minor: i64,
    pub receivable_minor: i64,
    pub parties: i64,
    pub equations: Vec<OpeningEquation>,
}

// ---------------------------------------------------------------------------
// Small readers the three imports share
// ---------------------------------------------------------------------------

/// Turn a kernel refusal into the error a caller sees, with the sheet named.
fn refuse(message: impl Into<String>) -> AppError {
    AppError::Validation(message.into())
}

/// Read a cell as money, saying which cell when it is not.
fn money(row: &CsvRow, column: &str) -> Result<i64, AppError> {
    parse_opening_amount(row.field(column)).map_err(|refusal| {
        refuse(format!(
            "line {}, column `{column}`: {}",
            row.line_number,
            refusal.message()
        ))
    })
}

/// Read a cell as a date, in whichever of the three ways it was written.
///
/// Three formats and not one, because these files are exported by somebody
/// else's software and then opened in a spreadsheet, which rewrites dates in
/// the machine's locale on the way back out.
fn date(row: &CsvRow, column: &str) -> Result<Option<NaiveDate>, AppError> {
    let raw = row.field(column);
    if raw.is_empty() {
        return Ok(None);
    }
    for format in ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"] {
        if let Ok(parsed) = NaiveDate::parse_from_str(raw, format) {
            return Ok(Some(parsed));
        }
    }
    Err(refuse(format!(
        "line {}, column `{column}`: `{raw}` is not a date this import can read; write it as \
         2026-08-31, 31/08/2026 or 31-08-2026",
        row.line_number
    )))
}

/// Read a cell that has to be filled in.
fn required(row: &CsvRow, column: &str) -> Result<String, AppError> {
    let value = row.field(column);
    if value.is_empty() {
        return Err(refuse(format!(
            "line {}: `{column}` is empty, and this import has no default for it",
            row.line_number
        )));
    }
    Ok(value.to_string())
}

/// Parse the file and insist on the columns this import needs.
fn sheet(csv: &str, columns: &[&str]) -> Result<Vec<CsvRow>, AppError> {
    let rows = parse_csv(csv).map_err(|refusal| refuse(refusal.message()))?;
    crate::cloud::domain::require_columns(&rows, columns)
        .map_err(|refusal| refuse(refusal.message()))?;
    Ok(rows)
}

/// Refuse a cutover dated inside a month somebody has already signed off.
///
/// The guarantee is elsewhere and in two places — 0051's trigger on the journal
/// entry, and 0158's lock on the evidence row's journal link — and both are
/// `RAISE EXCEPTION`, which reaches a caller as SQLSTATE P0001 and reads
/// "database operation failed" anywhere the HTTP layer is not there to
/// translate it. This is the explanation, checked first so the sentence names
/// the month, exactly as `poster::check_balanced` sits in front of the deferred
/// balance trigger.
///
/// `FOR SHARE`, inside the caller's transaction, so a close running at the same
/// moment either waits for this or makes this wait for it.
async fn assert_cutover_month_open(
    tx: &mut Transaction<'_, Postgres>,
    cutover_date: NaiveDate,
) -> Result<(), AppError> {
    use chrono::Datelike;
    let status: Option<String> =
        sqlx::query("SELECT status FROM fiscal_period WHERE year = $1 AND month = $2 FOR SHARE")
            .bind(cutover_date.year() as i16)
            .bind(cutover_date.month() as i16)
            .fetch_optional(&mut **tx)
            .await?
            .map(|row| row.get("status"));

    match status.as_deref() {
        Some("CLOSED") => Err(AppError::Conflict(format!(
            "the cutover is dated {cutover_date}, which falls inside accounting period {}, and \
             that period is closed. A closed month is never rewritten — least of all to put a \
             beginning into it, which would move every balance in the books after somebody had \
             already signed for them",
            cutover_date.format("%Y-%m")
        ))),
        Some(_) => Ok(()),
        None => Err(AppError::Conflict(format!(
            "no accounting period exists for {}; open it before importing a cutover dated \
             {cutover_date}",
            cutover_date.format("%Y-%m")
        ))),
    }
}

/// Refuse every unit the file names that this system does not keep, at once.
///
/// All of them together rather than the first: a cutover file is prepared by
/// somebody who has to go back to a spreadsheet and fix it, and telling them
/// about one typo per round trip is how a cutover takes a week. The refusal
/// lists the units there are, read from the `unit` table, because the file's
/// author is holding the client's branch codes and needs ours.
async fn assert_units_exist(
    tx: &mut Transaction<'_, Postgres>,
    units: &[String],
) -> Result<(), AppError> {
    let mut unknown: Vec<&str> = Vec::new();
    for unit in units {
        if !unit_exists(&mut **tx, unit).await? && !unknown.contains(&unit.as_str()) {
            unknown.push(unit);
        }
    }
    if unknown.is_empty() {
        return Ok(());
    }
    let known: Option<String> =
        sqlx::query_scalar("SELECT string_agg(id, ', ' ORDER BY id) FROM unit")
            .fetch_one(&mut **tx)
            .await?;
    Err(refuse(format!(
        "the sheet names {} this system does not keep: {}. A cutover file names OUR units — \
         {} — and not the client's own branch codes",
        if unknown.len() == 1 {
            "a unit"
        } else {
            "units"
        },
        unknown.join(", "),
        known.as_deref().unwrap_or("none are set up yet")
    )))
}

/// Refuse every site the stock sheet names that this system does not keep, at
/// once, for the same reason as [`assert_units_exist`]. Stock is counted in a
/// place, so the stock sheet names premises and not books.
async fn assert_sites_exist(
    tx: &mut Transaction<'_, Postgres>,
    sites: &[String],
) -> Result<(), AppError> {
    let mut unknown: Vec<&str> = Vec::new();
    for site in sites {
        let found: Option<String> = sqlx::query("SELECT id FROM site WHERE id = $1")
            .bind(site)
            .fetch_optional(&mut **tx)
            .await?
            .map(|row| row.get("id"));
        if found.is_none() && !unknown.contains(&site.as_str()) {
            unknown.push(site);
        }
    }
    if unknown.is_empty() {
        return Ok(());
    }
    Err(refuse(format!(
        "the sheet names {} this system does not keep: {}. A stock sheet names OUR places — \
         the site ids this system holds — and not the client's own branch codes",
        if unknown.len() == 1 {
            "a place"
        } else {
            "places"
        },
        unknown.join(", ")
    )))
}

/// What one account has on it, in one unit's books, as at a date.
///
/// Inside the caller's transaction on purpose: a rehearsal has to be able to
/// see what it has just posted and is about to roll back.
async fn account_balance_at(
    tx: &mut Transaction<'_, Postgres>,
    account_code: &str,
    unit_id: &str,
    as_of: NaiveDate,
) -> Result<i64, AppError> {
    Ok(sqlx::query(
        "SELECT COALESCE(SUM(jl.debit_minor - jl.credit_minor), 0)::bigint AS balance
           FROM journal_line jl
           JOIN journal_entry je USING (entry_id)
          WHERE jl.account_code = $1 AND jl.unit_id = $2 AND je.posting_date <= $3",
    )
    .bind(account_code)
    .bind(unit_id)
    .bind(as_of)
    .fetch_one(&mut **tx)
    .await?
    .try_get("balance")?)
}

/// Whether the books themselves balance as at a date, per unit.
///
/// The first equation of the ten, asked inside the transaction. 0120's deferred
/// trigger already guarantees each ENTRY balances per unit; this asks the
/// weaker, more useful question about the whole ledger, which is what a person
/// signing a cutover off actually wants to know.
async fn journal_equations(
    tx: &mut Transaction<'_, Postgres>,
    as_of: NaiveDate,
) -> Result<Vec<OpeningEquation>, AppError> {
    let rows = sqlx::query(
        "SELECT jl.unit_id,
                COALESCE(SUM(jl.debit_minor), 0)::bigint AS debits,
                COALESCE(SUM(jl.credit_minor), 0)::bigint AS credits
           FROM journal_line jl
           JOIN journal_entry je USING (entry_id)
          WHERE je.posting_date <= $1
          GROUP BY jl.unit_id
          ORDER BY jl.unit_id",
    )
    .bind(as_of)
    .fetch_all(&mut **tx)
    .await?;

    rows.iter()
        .map(|row| {
            let unit: String = row.try_get("unit_id")?;
            let debits: i64 = row.try_get("debits")?;
            let credits: i64 = row.try_get("credits")?;
            Ok(OpeningEquation {
                key: "ledger.balanced".to_string(),
                title: "The books balance".to_string(),
                unit_id: Some(unit.clone()),
                left_minor: debits,
                right_minor: credits,
                difference_minor: debits - credits,
                agrees: debits == credits,
                detail: format!("{unit} as at {as_of}: debits {debits} against credits {credits}"),
            })
        })
        .collect()
}

/// What the Payment Ledger and the books say about each control account.
///
/// The same 0145 function the integrity engine calls, run inside the
/// transaction so a rehearsal sees the items it is about to roll back.
async fn payment_ledger_equations(
    tx: &mut Transaction<'_, Postgres>,
    as_of: NaiveDate,
) -> Result<Vec<OpeningEquation>, AppError> {
    let rows = sqlx::query("SELECT * FROM payment_ledger_integrity($1, NULL)")
        .bind(as_of)
        .fetch_all(&mut **tx)
        .await?;

    rows.iter()
        .map(|row| {
            let key: String = row.try_get("account_key")?;
            let unit: String = row.try_get("unit_id")?;
            let qualifier: String = row.try_get("qualifier")?;
            let side: String = row.try_get("side")?;
            let code: Option<String> = row.try_get("account_code")?;
            let ledger: i64 = row.try_get("ledger_outstanding_minor")?;
            let gl: i64 = row.try_get("gl_balance_minor")?;
            let difference: i64 = row.try_get("difference_minor")?;
            Ok(OpeningEquation {
                key: "payment_ledger.control_accounts".to_string(),
                title: "The open items and the books agree".to_string(),
                unit_id: Some(unit.clone()),
                left_minor: ledger,
                right_minor: gl,
                difference_minor: difference,
                agrees: difference == 0,
                detail: format!(
                    "{key}{} in {unit}'s books ({side}): the sub-ledger has {ledger} open against {} \
                     carrying {gl}",
                    if qualifier.is_empty() {
                        String::new()
                    } else {
                        format!(" ({qualifier})")
                    },
                    code.as_deref().unwrap_or("no mapped account")
                ),
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 1. The opening trial balance
// ---------------------------------------------------------------------------

/// One row of the trial balance, read.
struct BalanceLine {
    line_number: usize,
    /// Whose books: head office's or a store's (0608).
    unit_id: String,
    account_code: String,
    /// What kind of thing the figure is, where the account is kept by kind.
    ///
    /// A column on the sheet, because only the client's accountant knows. The
    /// forty-account chart is the reason it exists: their closing trial balance
    /// has one line per kind of prepayment and one per cash pot, and all of
    /// them arrive here as `1401` and `1101`. Without the category the opening
    /// balance would land as one undifferentiated figure per account — and the
    /// detail, which they have, would be lost at the one moment it is cheapest
    /// to keep.
    category_code: Option<String>,
    /// The unit on the other side, on an inter-unit line and nowhere else.
    ///
    /// The one field on this row that a posting rule would normally supply
    /// rather than a sheet: the poster's balancer writes it onto the legs it
    /// adds. An opening balance adds none — every figure on the sheet is
    /// stated, not derived — so the only thing that can know which unit a
    /// `1501` position is with is the accountant who printed it.
    counter_unit_id: Option<String>,
    debit_minor: i64,
    credit_minor: i64,
    document_no: String,
    memo: Option<String>,
}

/// Bring the client's closing trial balance in as this ledger's opening one.
///
/// One balanced entry per unit, `source_kind = 'OPENING'`, dated the cutover.
/// Idempotent per `(unit, cutover date)` twice over: the unique key on
/// `opening_balance_line`, and — the one that actually holds under a race —
/// 0140's unique index on `(source_kind, source_id, purpose)`.
///
/// It refuses five things, and each refusal names what is wrong rather than
/// dropping it:
///
/// * a closed period, through the poster's own trigger;
/// * a sheet whose debits and credits disagree, naming the unit and the signed
///   difference;
/// * an account the chart does not carry, is a heading, or has retired, and a
///   category that does not belong to the account it is beside —
///   **all of them at once**, because the person fixing it is in a spreadsheet;
/// * a unit, on either end of a line, that is not one of ours, and a counter
///   unit that is not the one on the other side of a position (I8): a store's
///   is head office, found by its kind, and nobody names their own books;
/// * a cutover already posted.
pub async fn opening_import_balances(
    pool: &PgPool,
    request: &OpeningImportRequest,
    actor: &str,
) -> Result<OpeningBalanceOutcome, AppError> {
    // `category_code` and `counter_unit_id` are deliberately NOT required here.
    // A sheet that has the column uses it; a sheet that does not gets a refusal
    // per line naming the account and, for a category, the codes that would
    // have worked — which is the message that tells somebody what to add.
    // Requiring the header would refuse the whole import with one sentence
    // about a column, and both are needed on a handful of the forty rather than
    // on all of them.
    let rows = sheet(
        &request.csv,
        &["unit_id", "account_code", "debit", "credit", "document_no"],
    )?;

    let mut lines: Vec<BalanceLine> = Vec::with_capacity(rows.len());
    for row in &rows {
        let debit = money(row, "debit")?;
        let credit = money(row, "credit")?;
        if debit < 0 || credit < 0 {
            return Err(refuse(format!(
                "line {}: a trial balance line is a debit or a credit and both are positive \
                 figures; put {} on the other side instead",
                row.line_number,
                if debit < 0 { "the debit" } else { "the credit" }
            )));
        }
        if (debit == 0) == (credit == 0) {
            return Err(refuse(format!(
                "line {}: this row is {}. A trial balance line is one or the other",
                row.line_number,
                if debit == 0 {
                    "neither a debit nor a credit"
                } else {
                    "both a debit and a credit"
                }
            )));
        }
        let memo = row.field("memo");
        // Optional in the SHEET and not in the rule: a column nobody filled in
        // is a column an old export did not have, and the refusal below names
        // the account and the codes that would have worked — which is a better
        // answer than "missing column".
        let category = row.field("category_code").trim().to_string();
        // Optional in the sheet for the same reason, and refused by the poster
        // by name on the two accounts that need it: "1501 is a balance between
        // two units and the line names only store-01".
        let counter = row.field("counter_unit_id").trim().to_string();
        lines.push(BalanceLine {
            line_number: row.line_number,
            unit_id: required(row, "unit_id")?,
            account_code: required(row, "account_code")?,
            category_code: (!category.is_empty()).then_some(category),
            counter_unit_id: (!counter.is_empty()).then_some(counter),
            debit_minor: debit,
            credit_minor: credit,
            document_no: required(row, "document_no")?,
            memo: (!memo.is_empty()).then(|| memo.to_string()),
        });
    }

    // Agreed before anything is looked up. A sheet that does not balance is
    // wrong in a way no amount of account resolution will fix, and saying so
    // first is what stops a person chasing a mapping that was never the fault.
    let amounts: Vec<OpeningAmount> = lines
        .iter()
        .map(|line| OpeningAmount {
            unit_id: line.unit_id.clone(),
            debit_minor: line.debit_minor,
            credit_minor: line.credit_minor,
        })
        .collect();
    let totals = opening_unit_totals(&amounts);
    if let Some(out) = totals.iter().find(|total| !total.agrees()) {
        return Err(refuse(format!(
            "the opening trial balance in the books of {} does not agree: debits {}, credits \
             {}, a difference of {} ({} by {}). An opening balance that does not balance would \
             put the difference somewhere nobody chose",
            out.unit_id,
            out.debit_minor,
            out.credit_minor,
            out.difference_minor,
            if out.difference_minor > 0 {
                "debits exceed credits"
            } else {
                "credits exceed debits"
            },
            out.difference_minor.abs()
        )));
    }

    let mut tx = pool.begin().await?;

    assert_cutover_month_open(&mut tx, request.cutover_date).await?;

    // Both ends of every line, because a counter-unit nobody has heard of
    // arrives from the poster as a foreign-key violation naming a constraint,
    // and from here as the misspelled store it is.
    let mut units: Vec<String> = totals.iter().map(|total| total.unit_id.clone()).collect();
    for line in &lines {
        if let Some(counter) = &line.counter_unit_id {
            if !units.contains(counter) {
                units.push(counter.clone());
            }
        }
    }
    assert_units_exist(&mut tx, &units).await?;

    // And the other side of every position is the one it can be (I8): a
    // store's books hold a balance with head office and nobody else, so a
    // store-to-store position is two positions through head office, and no
    // unit is on the other side of its own books. Head office is whichever
    // unit is of kind `HO`; all of them named together, for the spreadsheet.
    let head_office = head_office_unit_id(&mut *tx).await?;
    let mut crossed: Vec<String> = Vec::new();
    for line in &lines {
        let Some(counter) = &line.counter_unit_id else {
            continue;
        };
        if counter == &line.unit_id {
            crossed.push(format!(
                "line {}: {} names its own books as the other side",
                line.line_number, line.unit_id
            ));
        } else if line.unit_id != head_office && counter != &head_office {
            crossed.push(format!(
                "line {}: {} holds a position with {counter}, and a store's position is with \
                 head office ({head_office}) alone — a balance between two stores is two, each \
                 against head office",
                line.line_number, line.unit_id
            ));
        }
    }
    if !crossed.is_empty() {
        return Err(refuse(format!(
            "the sheet names the wrong unit on the other side of {}:\n  {}",
            if crossed.len() == 1 {
                "a position".to_string()
            } else {
                format!("{} positions", crossed.len())
            },
            crossed.join("\n  ")
        )));
    }

    // Every unknown account named together. `poster::post` would refuse the
    // first one it reached, one round trip at a time.
    let mut unmapped: Vec<String> = Vec::new();
    for line in &lines {
        if let Err(AppError::Validation(why)) =
            assert_postable(&mut *tx, &line.account_code, Intent::Post).await
        {
            unmapped.push(format!("line {}: {why}", line.line_number));
            continue;
        }
        // The category, gathered into the same list for the same reason: the
        // person fixing this is in a spreadsheet, and being told about one bad
        // row at a time is being told to import six times.
        if let Err(AppError::Validation(why)) = assert_category_for_account(
            &mut *tx,
            &line.account_code,
            line.category_code.as_deref(),
            Intent::Post,
        )
        .await
        {
            unmapped.push(format!("line {}: {why}", line.line_number));
        }
    }
    if !unmapped.is_empty() {
        return Err(refuse(format!(
            "{} the chart cannot take a posting, and an opening balance is not allowed to drop \
             one — every figure on the sheet has to land somewhere a person chose:\n  {}",
            if unmapped.len() == 1 {
                "one account on the sheet is one".to_string()
            } else {
                format!("{} accounts on the sheet are ones", unmapped.len())
            },
            unmapped.join("\n  ")
        )));
    }

    // Refused here as well as by the unique index, because the index's message
    // names a constraint and this one names the act.
    let already: Option<String> = sqlx::query(
        "SELECT je.entry_number FROM opening_balance_line l
           JOIN journal_entry je ON je.entry_id = l.journal_entry_id
          WHERE l.cutover_date = $1 LIMIT 1",
    )
    .bind(request.cutover_date)
    .fetch_optional(&mut *tx)
    .await?
    .map(|row| row.get("entry_number"));
    if let Some(number) = already {
        return Err(AppError::Conflict(format!(
            "the opening balances as at {} have already been posted, starting at {number}. A \
             ledger begins once; if the figures were wrong, reverse the opening entries and \
             post a correction rather than importing a second beginning",
            request.cutover_date
        )));
    }

    let mut entries: Vec<OpeningPostedEntry> = Vec::new();
    let mut document_numbers: Vec<String> = Vec::new();
    for total in &totals {
        let of_unit: Vec<&BalanceLine> = lines
            .iter()
            .filter(|line| line.unit_id == total.unit_id)
            .collect();

        let intent = PostingIntent {
            posting_date: request.cutover_date,
            source_kind: OPENING_SOURCE_KIND.to_string(),
            source_id: Some(format!("{}|{}", request.cutover_date, total.unit_id)),
            rule_version: OPENING_RULE_VERSION.to_string(),
            currency: CURRENCY.to_string(),
            memo: Some(format!(
                "Saldo awal {} per {}",
                total.unit_id, request.cutover_date
            )),
            lines: of_unit
                .iter()
                .map(|line| PostingLine {
                    dimensions: Vec::new(),
                    // A code and not a meaning, and this is the one caller in
                    // the system entitled to say so: an opening balance names
                    // prepaid rent, a director's loan and accumulated
                    // depreciation, and the map has no meaning for any of them.
                    account: LineAccount::Account {
                        account_code: line.account_code.clone(),
                        category_code: line.category_code.clone(),
                    },
                    unit_id: line.unit_id.clone(),
                    // Stated on the sheet rather than inferred. `1501` is one
                    // account for fourteen positions and the poster refuses it
                    // without a counter-unit, which is how a store's own
                    // balancing figure reaches the ledger as a position with
                    // somebody named on the other side rather than as a number.
                    counter_unit_id: line.counter_unit_id.clone(),
                    debit_minor: line.debit_minor,
                    credit_minor: line.credit_minor,
                    party_type: None,
                    party_id: None,
                    asset_id: None,
                    bank_account_id: None,
                    memo: line
                        .memo
                        .clone()
                        .or_else(|| Some(format!("{} (saldo awal)", line.document_no))),
                })
                .collect(),
        };
        let posted = post(&mut tx, &intent, None, actor).await?;

        for line in &of_unit {
            // The counter-unit too: it is part of the line's key (0295), so
            // a store's two `1501` positions are two lines and not a repeat.
            sqlx::query(
                "INSERT INTO opening_balance_line
                   (line_id, cutover_date, unit_id, account_code, category_code,
                    counter_unit_id, debit_minor, credit_minor,
                    document_no, memo, journal_entry_id, imported_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            )
            .bind(Uuid::new_v4())
            .bind(request.cutover_date)
            .bind(&line.unit_id)
            .bind(&line.account_code)
            .bind(line.category_code.as_deref())
            .bind(line.counter_unit_id.as_deref())
            .bind(line.debit_minor)
            .bind(line.credit_minor)
            .bind(&line.document_no)
            .bind(line.memo.as_deref())
            .bind(posted.entry_id)
            .bind(actor)
            .execute(&mut *tx)
            .await
            .map_err(|error| duplicate_line(error, "opening_balance_line", line.line_number))?;
            if !document_numbers.contains(&line.document_no) {
                document_numbers.push(line.document_no.clone());
            }
        }

        entries.push(OpeningPostedEntry {
            unit_id: total.unit_id.clone(),
            entry_number: posted.entry_number,
            total_minor: posted.total_minor,
            lines: of_unit.len() as i64,
        });
    }

    let equations = journal_equations(&mut tx, request.cutover_date).await?;

    if request.commit {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
    }

    Ok(OpeningBalanceOutcome {
        cutover_date: request.cutover_date,
        committed: request.commit,
        lines: lines.len() as i64,
        units: totals,
        entries,
        document_numbers,
        equations,
    })
}

/// Say what a unique-key violation on an evidence row actually means.
///
/// It arrives as SQLSTATE 23505 and would otherwise reach a person as "database
/// operation failed" with a 500 beside it, when the truth is that their sheet
/// names the same thing twice.
fn duplicate_line(error: sqlx::Error, table: &str, line_number: usize) -> AppError {
    if let sqlx::Error::Database(db) = &error {
        if db.code().as_deref() == Some("23505") {
            return AppError::Conflict(format!(
                "line {line_number} repeats something the sheet has already said. A trial \
                 balance that names one account in one unit's books twice is two trial \
                 balances, and a stock sheet that counts one article at one shop twice is two \
                 counts ({table})"
            ));
        }
    }
    error.into()
}

// ---------------------------------------------------------------------------
// 2. The opening stock
// ---------------------------------------------------------------------------

struct StockLine {
    line_number: usize,
    site_id: String,
    article_code: String,
    article_id: Uuid,
    pool_id: String,
    quantity: i64,
    last_purchase_minor: Option<i64>,
    stated_minor: Option<i64>,
    document_no: String,
}

/// Price the shelf, and give FIFO a beginning.
///
/// Creates one cost layer per article per place, dated the cutover, through
/// `cost_layer_create` — the same door a goods receipt uses, so the queue this
/// starts is the queue the rest of the system already knows how to consume.
/// Those layers post NO journal, which is right: the debit to inventory has an
/// owner already, in the opening trial balance.
///
/// Which is also why the import refuses when the two disagree. **That
/// reconciliation is the whole point of this import.** A stock sheet totalling
/// more than the inventory account means the cutover would begin with goods
/// nobody has accounted for, and totalling less means it would begin with an
/// asset that has nothing behind it; either way the first stock count of the
/// new system finds a difference that has been there since day one and reads
/// like an operational loss.
pub async fn opening_import_stock(
    pool: &PgPool,
    request: &OpeningImportRequest,
    actor: &str,
) -> Result<OpeningStockOutcome, AppError> {
    let rows = sheet(
        &request.csv,
        &[
            "site_id",
            "article_code",
            "pool_id",
            "quantity",
            "document_no",
        ],
    )?;

    let mut tx = pool.begin().await?;

    let mut lines: Vec<StockLine> = Vec::with_capacity(rows.len());
    let mut unknown_articles: Vec<String> = Vec::new();
    for row in &rows {
        let article_code = required(row, "article_code")?;
        let article: Option<Uuid> = sqlx::query("SELECT id FROM article WHERE article_code = $1")
            .bind(&article_code)
            .fetch_optional(&mut *tx)
            .await?
            .map(|found| found.get("id"));
        let Some(article_id) = article else {
            unknown_articles.push(format!("line {}: {article_code}", row.line_number));
            continue;
        };
        let quantity = money(row, "quantity")?;
        lines.push(StockLine {
            line_number: row.line_number,
            site_id: required(row, "site_id")?,
            article_code,
            article_id,
            pool_id: required(row, "pool_id")?,
            quantity,
            last_purchase_minor: optional_money(row, "last_purchase_cost")?,
            stated_minor: optional_money(row, "stated_cost")?,
            document_no: required(row, "document_no")?,
        });
    }
    if !unknown_articles.is_empty() {
        return Err(refuse(format!(
            "the stock sheet names {} this catalogue does not carry:\n  {}\nAn article that is \
             not in the catalogue cannot hold a cost layer, and dropping the line would be \
             opening with stock nobody can sell",
            if unknown_articles.len() == 1 {
                "an article".to_string()
            } else {
                format!("{} articles", unknown_articles.len())
            },
            unknown_articles.join("\n  ")
        )));
    }

    let sites: Vec<String> = {
        let mut seen: Vec<String> = Vec::new();
        for line in &lines {
            if !seen.contains(&line.site_id) {
                seen.push(line.site_id.clone());
            }
        }
        seen
    };
    assert_sites_exist(&mut tx, &sites).await?;

    // Whose books each place's stock is explained by: the unit that owns it
    // (`unit_of_site`, 0605). Looked up once per place, not once per line.
    let mut unit_of: Vec<(String, String)> = Vec::with_capacity(sites.len());
    for site in &sites {
        let unit = unit_of_site(&mut *tx, site).await?;
        unit_of.push((site.clone(), unit));
    }

    let already: Option<Uuid> = sqlx::query(
        "SELECT cost_layer_id FROM opening_stock_line
          WHERE cutover_date = $1 AND cost_layer_id IS NOT NULL LIMIT 1",
    )
    .bind(request.cutover_date)
    .fetch_optional(&mut *tx)
    .await?
    .map(|row| row.get("cost_layer_id"));
    if already.is_some() {
        return Err(AppError::Conflict(format!(
            "the opening stock as at {} has already been priced and its cost layers exist. \
             Pricing it twice would double the shelf",
            request.cutover_date
        )));
    }

    let mut fallbacks: Vec<OpeningFallback> = Vec::new();
    let mut layers = 0_i64;
    let mut per_unit: Vec<OpeningStockUnit> = Vec::new();
    for line in &lines {
        // The one fact the sheet does not get to assert, because this database
        // holds it: what the article is already costing here. Only ever
        // non-null in a phased cutover, where part of the estate went live
        // early enough to have a queue.
        let average: Option<i64> = sqlx::query(
            "SELECT (SUM(remaining_value_minor) / NULLIF(SUM(remaining_quantity), 0))::bigint
                      AS average
               FROM cost_layer_remaining WHERE article_id = $1",
        )
        .bind(line.article_id)
        .fetch_one(&mut *tx)
        .await?
        .try_get("average")?;

        let price = price_opening_stock(&OpeningStockFacts {
            quantity: line.quantity,
            last_purchase_minor: line.last_purchase_minor,
            system_average_minor: average,
            stated_minor: line.stated_minor,
        })
        .map_err(|refusal| {
            refuse(format!(
                "line {} ({} at {}): {}",
                line.line_number,
                line.article_code,
                line.site_id,
                refusal.message()
            ))
        })?;

        let value = line
            .quantity
            .checked_mul(price.unit_cost_minor)
            .ok_or_else(|| {
                refuse(format!(
                    "line {}: {} pieces at {} each overflows this ledger's arithmetic",
                    line.line_number, line.quantity, price.unit_cost_minor
                ))
            })?;

        let layer = cost_layer_create(
            &mut tx,
            &NewCostLayer {
                article_id: line.article_id,
                quantity: line.quantity,
                // The gross is the value and there is no discount: whatever
                // discount the client took, they took it before the cutover and
                // what came across is what the goods are carried at now.
                gross_cost_minor: value,
                discount_minor: 0,
                economic_date: request.cutover_date,
                site_id: line.site_id.clone(),
                to_pool_id: line.pool_id.clone(),
                receipt_id: None,
                receipt_line_id: None,
                source_reference: Some(line.document_no.clone()),
                supplier_id: None,
                source_kind: OPENING_SOURCE_KIND.to_string(),
                // The site is in the key because two shops holding the same
                // count of the same article would otherwise be one layer:
                // `cost_layer_create` is idempotent on
                // (source_kind, source_id, article, quantity).
                source_id: format!("{}|{}", request.cutover_date, line.site_id),
            },
            actor,
        )
        .await?;
        layers += 1;

        sqlx::query(
            "INSERT INTO opening_stock_line
               (line_id, cutover_date, site_id, article_id, pool_id, quantity, unit_cost_minor,
                pricing_basis, basis_note, document_no, cost_layer_id, imported_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        )
        .bind(Uuid::new_v4())
        .bind(request.cutover_date)
        .bind(&line.site_id)
        .bind(line.article_id)
        .bind(&line.pool_id)
        .bind(line.quantity)
        .bind(price.unit_cost_minor)
        .bind(price.basis.as_str())
        .bind(&price.note)
        .bind(&line.document_no)
        .bind(layer.layer_id)
        .bind(actor)
        .execute(&mut *tx)
        .await
        .map_err(|error| duplicate_line(error, "opening_stock_line", line.line_number))?;

        if price.basis.is_fallback() {
            fallbacks.push(OpeningFallback {
                site_id: line.site_id.clone(),
                article_code: line.article_code.clone(),
                quantity: line.quantity,
                unit_cost_minor: price.unit_cost_minor,
                value_minor: value,
                basis: price.basis.as_str().to_string(),
                note: price.note.clone(),
            });
        }

        // Every place is in `unit_of` by construction: it was built from these
        // lines. Summed per unit, since that is what the books can agree with.
        let unit_id = unit_of
            .iter()
            .find(|(site, _)| site == &line.site_id)
            .map(|(_, unit)| unit.clone())
            .ok_or_else(|| AppError::NotFound(format!("site {}", line.site_id)))?;
        match per_unit.iter_mut().find(|unit| unit.unit_id == unit_id) {
            Some(unit) => {
                unit.articles += 1;
                unit.quantity += line.quantity;
                unit.value_minor += value;
            }
            None => per_unit.push(OpeningStockUnit {
                unit_id,
                articles: 1,
                quantity: line.quantity,
                value_minor: value,
                inventory_account: String::new(),
                reconciliation: reconcile_opening(0, 0),
            }),
        }
    }

    // The reconciliation, per unit, against the account the opening trial
    // balance put the money in: every place a unit owns, together, against the
    // one inventory balance in its books.
    let mut equations: Vec<OpeningEquation> = Vec::new();
    let mut disagrees: Vec<String> = Vec::new();
    for unit in &mut per_unit {
        let code = resolve_account_code(&mut *tx, "inventory", &unit.unit_id, "").await?;
        let ledger =
            account_balance_at(&mut tx, &code, &unit.unit_id, request.cutover_date).await?;
        unit.inventory_account = code.clone();
        unit.reconciliation = reconcile_opening(unit.value_minor, ledger);
        equations.push(OpeningEquation {
            key: "stock.value_vs_gl".to_string(),
            title: "The shelf and the inventory account agree".to_string(),
            unit_id: Some(unit.unit_id.clone()),
            left_minor: unit.value_minor,
            right_minor: ledger,
            difference_minor: unit.reconciliation.difference_minor,
            agrees: unit.reconciliation.agrees,
            detail: format!(
                "{}: opening layers total {} against {code} carrying {ledger}",
                unit.unit_id, unit.value_minor
            ),
        });
        if !unit.reconciliation.agrees {
            disagrees.push(format!(
                "{}: the sheet prices the stock at {} and {code} carries {ledger}, a difference \
                 of {}",
                unit.unit_id, unit.value_minor, unit.reconciliation.difference_minor
            ));
        }
    }
    if !disagrees.is_empty() {
        return Err(refuse(format!(
            "the opening stock does not reconcile to the opening inventory balance, and that \
             reconciliation is the point of this import — a cutover that begins out of \
             agreement begins with a stock difference that has been there since day one and \
             will read like an operational loss:\n  {}",
            disagrees.join("\n  ")
        )));
    }

    if request.commit {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
    }

    Ok(OpeningStockOutcome {
        cutover_date: request.cutover_date,
        committed: request.commit,
        lines: lines.len() as i64,
        layers,
        units: per_unit,
        fallbacks,
        equations,
    })
}

/// A money cell that is allowed to be empty, where empty means "not given"
/// rather than zero.
///
/// The distinction carries the whole of `price_opening_stock`'s refusal: an
/// empty purchase price is a price nobody knows, and a zero is free goods.
fn optional_money(row: &CsvRow, column: &str) -> Result<Option<i64>, AppError> {
    if !row.has_column(column) || row.field(column).is_empty() {
        return Ok(None);
    }
    money(row, column).map(Some)
}

// ---------------------------------------------------------------------------
// 3. The open items
// ---------------------------------------------------------------------------

/// Open the unpaid bills and the outstanding acquirer receivables.
///
/// Each becomes one Payment Ledger item through `ple_open`, against the opening
/// journal entry for its unit, with the client's own document number as the
/// voucher — so a supplier ringing up on the second day and quoting an invoice
/// number from before the cutover can be answered.
///
/// The equation each control account is measured by is reported before the
/// transaction ends. It has to agree: the sum of the items in a unit's books is
/// what the opening trial balance credited to that unit's payable, and if the two
/// disagree the sub-ledger and the books have started life apart.
pub async fn opening_import_subledger(
    pool: &PgPool,
    request: &OpeningImportRequest,
    actor: &str,
) -> Result<OpeningSubledgerOutcome, AppError> {
    let rows = sheet(
        &request.csv,
        &[
            "unit_id",
            "account_key",
            "party_type",
            "party_id",
            "side",
            "voucher_kind",
            "voucher_id",
            "amount",
            "document_date",
        ],
    )?;

    let mut tx = pool.begin().await?;

    let mut payable = 0_i64;
    let mut receivable = 0_i64;
    let mut parties: Vec<String> = Vec::new();
    let mut count = 0_i64;

    // The opening entry a unit's items hang off, looked up once per unit.
    // They must hang off one: an open item is a balance the general ledger has
    // already recognised, and `payment_ledger_entry.journal_entry_id` is the
    // link that makes the equation checkable at all.
    let mut anchors: Vec<(String, Uuid)> = Vec::new();

    for row in &rows {
        let unit_id = required(row, "unit_id")?;
        let amount = money(row, "amount")?;
        if amount <= 0 {
            return Err(refuse(format!(
                "line {}: an open balance of {amount} is not an open balance. The side says \
                 which way it faces, so the amount is always positive",
                row.line_number
            )));
        }
        let side = PaymentLedgerSide::parse(&required(row, "side")?)?;
        let party_type = PaymentLedgerPartyType::parse(&required(row, "party_type")?)?;
        let document_date = date(row, "document_date")?.ok_or_else(|| {
            refuse(format!(
                "line {}: `document_date` is empty. It is the day the client's own document was \
                 raised and it is what the balance is aged from; a cutover that lost it would \
                 open every overdue bill as brand new",
                row.line_number
            ))
        })?;
        if document_date > request.cutover_date {
            return Err(refuse(format!(
                "line {}: the document is dated {document_date}, after the cutover on {}. An \
                 opening item is something that was already outstanding",
                row.line_number, request.cutover_date
            )));
        }
        let due_date = date(row, "due_date")?;

        // Found through the trial balance's own evidence rows, which carry the
        // unit (0608), rather than by the entry's `source_id`: an entry posted
        // before the books moved to units spells head office's by its old
        // premises, and the evidence row was re-keyed with the ledger.
        let anchor = match anchors.iter().find(|(unit, _)| unit == &unit_id) {
            Some((_, id)) => *id,
            None => {
                let found: Option<Uuid> = sqlx::query(
                    "SELECT journal_entry_id FROM opening_balance_line
                      WHERE cutover_date = $1 AND unit_id = $2
                        AND journal_entry_id IS NOT NULL
                      LIMIT 1",
                )
                .bind(request.cutover_date)
                .bind(&unit_id)
                .fetch_optional(&mut *tx)
                .await?
                .map(|entry| entry.get("journal_entry_id"));
                let id = found.ok_or_else(|| {
                    refuse(format!(
                        "there is no opening journal entry in the books of {unit_id} as at {}. \
                         The open items are what explains a control account's opening \
                         balance, so the balances have to be imported before the items that \
                         make them up",
                        request.cutover_date
                    ))
                })?;
                anchors.push((unit_id.clone(), id));
                id
            }
        };

        let account_key = required(row, "account_key")?;
        let party_id = required(row, "party_id")?;
        let party_name = row.field("party_name");
        let voucher_kind = required(row, "voucher_kind")?;
        let voucher_id = required(row, "voucher_id")?;

        let entry_id = ple_open(
            &mut tx,
            &PaymentLedgerItem {
                account_key: account_key.clone(),
                qualifier: row.field("qualifier").to_string(),
                unit_id: unit_id.clone(),
                party_type,
                party_id: party_id.clone(),
                party_name: (!party_name.is_empty()).then(|| party_name.to_string()),
                voucher_kind: voucher_kind.clone(),
                voucher_id: voucher_id.clone(),
                journal_entry_id: anchor,
                side,
                amount_minor: amount,
                currency: CURRENCY.to_string(),
                due_date,
                // Theirs, not the cutover's. See the module header.
                posting_date: document_date,
            },
            actor,
        )
        .await?;

        sqlx::query(
            "INSERT INTO opening_subledger_line
               (line_id, cutover_date, unit_id, account_key, qualifier, party_type, party_id,
                party_name, side, voucher_kind, voucher_id, amount_minor, document_date,
                due_date, payment_ledger_entry_id, imported_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        )
        .bind(Uuid::new_v4())
        .bind(request.cutover_date)
        .bind(&unit_id)
        .bind(account_key.trim().to_ascii_lowercase())
        .bind(row.field("qualifier"))
        .bind(party_type.as_str())
        .bind(&party_id)
        .bind((!party_name.is_empty()).then_some(party_name))
        .bind(side.as_str())
        .bind(&voucher_kind)
        .bind(&voucher_id)
        .bind(amount)
        .bind(document_date)
        .bind(due_date)
        .bind(entry_id)
        .bind(actor)
        .execute(&mut *tx)
        .await
        .map_err(|error| duplicate_line(error, "opening_subledger_line", row.line_number))?;

        match side {
            PaymentLedgerSide::Payable => payable += amount,
            PaymentLedgerSide::Receivable => receivable += amount,
        }
        let party = format!("{}|{party_id}", party_type.as_str());
        if !parties.contains(&party) {
            parties.push(party);
        }
        count += 1;
    }

    let equations = payment_ledger_equations(&mut tx, request.cutover_date).await?;
    let out: Vec<&OpeningEquation> = equations.iter().filter(|eq| !eq.agrees).collect();
    if !out.is_empty() {
        return Err(refuse(format!(
            "the open items and the general ledger would not agree as at {}, and a sub-ledger \
             that starts life out of agreement with the books never catches up:\n  {}",
            request.cutover_date,
            out.iter()
                .map(|eq| eq.detail.clone())
                .collect::<Vec<_>>()
                .join("\n  ")
        )));
    }

    if request.commit {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
    }

    Ok(OpeningSubledgerOutcome {
        cutover_date: request.cutover_date,
        committed: request.commit,
        lines: count,
        payable_minor: payable,
        receivable_minor: receivable,
        parties: parties.len() as i64,
        equations,
    })
}

// ---------------------------------------------------------------------------
// The cutover report
// ---------------------------------------------------------------------------

/// One page: is it balanced, what did not map, and what did we make up.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningCutoverReport {
    pub cutover_date: NaiveDate,
    /// The one-line answer. True only when every equation below agrees, nothing
    /// is unmapped, and the stock reconciles in every unit.
    pub sound: bool,
    pub equations: Vec<OpeningEquation>,
    /// Trial balance lines that were imported and never posted, with the reason
    /// the chart gave. Empty after a successful run, by construction — the
    /// import refuses rather than dropping — and the reason it is reported
    /// anyway is the run that was interrupted.
    pub unmapped: Vec<OpeningUnmapped>,
    /// Every piece of opening stock priced by something other than what was
    /// paid for it, worst first by value.
    pub fallbacks: Vec<OpeningFallback>,
    pub fallback_value_minor: i64,
    pub stock_value_minor: i64,
    /// Their own references, so the report can be put beside their reports.
    pub document_numbers: Vec<String>,
    pub entries: Vec<OpeningPostedEntry>,
    pub payable_minor: i64,
    pub receivable_minor: i64,
}

/// A figure that was handed over and has nowhere to land.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpeningUnmapped {
    /// The books the figure was meant for.
    pub unit_id: String,
    /// The client's account code, or — for an open item, which names its
    /// control account by meaning — the semantic key that resolved to nothing.
    pub account_code: String,
    pub amount_minor: i64,
    pub why: String,
}

/// The page somebody signs the cutover off from.
///
/// Reads only, and it reads the same equations the imports rehearsed — so the
/// morning after, it answers the question the rehearsal answered the night
/// before, and any difference between the two is a thing that happened in
/// between.
pub async fn opening_cutover_report(
    pool: &PgPool,
    cutover_date: NaiveDate,
) -> Result<OpeningCutoverReport, AppError> {
    let mut tx = pool.begin().await?;

    let mut equations = journal_equations(&mut tx, cutover_date).await?;
    equations.extend(payment_ledger_equations(&mut tx, cutover_date).await?);

    // Stock against inventory, per unit that has opening stock: every place a
    // unit owns, together, against the one inventory balance in its books.
    let stock_rows = sqlx::query(
        "SELECT unit_of_site(site_id) AS unit_id,
                SUM(quantity * unit_cost_minor)::bigint AS value_minor
           FROM opening_stock_line
          WHERE cutover_date = $1 AND cost_layer_id IS NOT NULL
          GROUP BY 1 ORDER BY 1",
    )
    .bind(cutover_date)
    .fetch_all(&mut *tx)
    .await?;
    let mut stock_value = 0_i64;
    for row in &stock_rows {
        let unit: String = row.try_get("unit_id")?;
        let value: i64 = row.try_get("value_minor")?;
        stock_value += value;
        let code = resolve_account_code(&mut *tx, "inventory", &unit, "").await?;
        let ledger = account_balance_at(&mut tx, &code, &unit, cutover_date).await?;
        let reconciliation = reconcile_opening(value, ledger);
        equations.push(OpeningEquation {
            key: "stock.value_vs_gl".to_string(),
            title: "The shelf and the inventory account agree".to_string(),
            unit_id: Some(unit.clone()),
            left_minor: value,
            right_minor: ledger,
            difference_minor: reconciliation.difference_minor,
            agrees: reconciliation.agrees,
            detail: format!(
                "{unit}: opening layers total {value} against {code} carrying {ledger}"
            ),
        });
    }

    let unmapped_rows = sqlx::query(
        "SELECT unit_id, account_code, debit_minor, credit_minor
           FROM opening_balance_line
          WHERE cutover_date = $1 AND journal_entry_id IS NULL
          ORDER BY unit_id, account_code",
    )
    .bind(cutover_date)
    .fetch_all(&mut *tx)
    .await?;
    let mut unmapped: Vec<OpeningUnmapped> = Vec::new();
    for row in &unmapped_rows {
        let code: String = row.try_get("account_code")?;
        let debit: i64 = row.try_get("debit_minor")?;
        let credit: i64 = row.try_get("credit_minor")?;
        let why = match assert_postable(&mut *tx, &code, Intent::Post).await {
            Ok(()) => "the line was imported but never posted".to_string(),
            Err(AppError::Validation(message)) => message,
            Err(other) => return Err(other),
        };
        unmapped.push(OpeningUnmapped {
            unit_id: row.try_get("unit_id")?,
            account_code: code,
            amount_minor: debit - credit,
            why,
        });
    }

    // A control account whose meaning resolves to nothing. The equations
    // already show it as a difference — an open balance against a general
    // ledger of zero — but a difference does not say "there is no account", and
    // that is a mapping to go and set rather than a figure to go and find.
    let unmapped_controls = sqlx::query(
        "SELECT i.unit_id, i.account_key, i.qualifier, i.ledger_outstanding_minor
           FROM payment_ledger_integrity($1, NULL) i
          WHERE i.account_code IS NULL
          ORDER BY i.account_key, i.unit_id",
    )
    .bind(cutover_date)
    .fetch_all(&mut *tx)
    .await?;
    for row in &unmapped_controls {
        let key: String = row.try_get("account_key")?;
        let qualifier: String = row.try_get("qualifier")?;
        unmapped.push(OpeningUnmapped {
            unit_id: row.try_get("unit_id")?,
            account_code: key.clone(),
            amount_minor: row.try_get("ledger_outstanding_minor")?,
            why: format!(
                "no account is mapped for '{key}'{} in this unit, so the open items against \
                 it have no line in the books to be compared with; link it on the Account Links screen",
                if qualifier.is_empty() {
                    String::new()
                } else {
                    format!(" ({qualifier})")
                }
            ),
        });
    }

    let fallback_rows = sqlx::query(
        "SELECT l.site_id, a.article_code, l.quantity, l.unit_cost_minor, l.pricing_basis,
                l.basis_note
           FROM opening_stock_line l
           JOIN article a ON a.id = l.article_id
          WHERE l.cutover_date = $1 AND l.pricing_basis <> 'LAST_PURCHASE'
          ORDER BY l.quantity * l.unit_cost_minor DESC",
    )
    .bind(cutover_date)
    .fetch_all(&mut *tx)
    .await?;
    let mut fallbacks: Vec<OpeningFallback> = Vec::new();
    let mut fallback_value = 0_i64;
    for row in &fallback_rows {
        let quantity: i64 = row.try_get("quantity")?;
        let unit: i64 = row.try_get("unit_cost_minor")?;
        fallback_value += quantity * unit;
        fallbacks.push(OpeningFallback {
            site_id: row.try_get("site_id")?,
            article_code: row.try_get("article_code")?,
            quantity,
            unit_cost_minor: unit,
            value_minor: quantity * unit,
            basis: row.try_get("pricing_basis")?,
            note: row.try_get("basis_note")?,
        });
    }

    let entry_rows = sqlx::query(
        "SELECT l.unit_id, je.entry_number, je.total_minor, COUNT(*)::bigint AS lines
           FROM opening_balance_line l
           JOIN journal_entry je ON je.entry_id = l.journal_entry_id
          WHERE l.cutover_date = $1
          GROUP BY l.unit_id, je.entry_number, je.total_minor
          ORDER BY l.unit_id",
    )
    .bind(cutover_date)
    .fetch_all(&mut *tx)
    .await?;
    let entries: Vec<OpeningPostedEntry> = entry_rows
        .iter()
        .map(|row| {
            Ok(OpeningPostedEntry {
                unit_id: row.try_get("unit_id")?,
                entry_number: row.try_get("entry_number")?,
                total_minor: row.try_get("total_minor")?,
                lines: row.try_get("lines")?,
            })
        })
        .collect::<Result<_, AppError>>()?;

    let documents = sqlx::query(
        "SELECT DISTINCT document_no FROM opening_balance_line WHERE cutover_date = $1
         UNION
         SELECT DISTINCT document_no FROM opening_stock_line WHERE cutover_date = $1
         ORDER BY 1",
    )
    .bind(cutover_date)
    .fetch_all(&mut *tx)
    .await?;
    let document_numbers: Vec<String> = documents
        .iter()
        .map(|row| Ok(row.try_get("document_no")?))
        .collect::<Result<_, AppError>>()?;

    let open = sqlx::query(
        "SELECT COALESCE(SUM(amount_minor) FILTER (WHERE side = 'PAYABLE'), 0)::bigint AS payable,
                COALESCE(SUM(amount_minor) FILTER (WHERE side = 'RECEIVABLE'), 0)::bigint
                  AS receivable
           FROM opening_subledger_line WHERE cutover_date = $1",
    )
    .bind(cutover_date)
    .fetch_one(&mut *tx)
    .await?;

    tx.rollback().await?;

    Ok(OpeningCutoverReport {
        cutover_date,
        sound: equations.iter().all(|eq| eq.agrees) && unmapped.is_empty(),
        equations,
        unmapped,
        fallbacks,
        fallback_value_minor: fallback_value,
        stock_value_minor: stock_value,
        document_numbers,
        entries,
        payable_minor: open.try_get("payable")?,
        receivable_minor: open.try_get("receivable")?,
    })
}
