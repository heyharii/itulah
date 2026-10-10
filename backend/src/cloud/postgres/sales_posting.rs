//! A shop's day of takings: derived into a document, then posted once.
//!
//! `0051` has listed `SALE_DAY` among the kinds of journal entry since the
//! ledger was written, and nothing has ever written one. Everything the estate
//! has sold is in `edge_sale` and `sale`; none of it is in the books. This is
//! the module that ends that.
//!
//! # Two populations, one day
//!
//! There are two places a completed sale lives, and both are real trade:
//!
//!   * `edge_sale` + `edge_sale_tender` — what a shop rang up on its own node
//!     and synced here. This is the fleet's revenue.
//!   * `sale` + `sale_payment` — what was rung up against this node directly,
//!     with `sale_return` + `sale_return_payment` behind it when something
//!     came back.
//!
//! A document reads both. Reading one would leave the books short by whichever
//! was left out, and no report would say which — the two tables never overlap,
//! so nothing would ever look wrong.
//!
//! Returns are only in the central population today: a shop records its own
//! returns in SQLite and there is no `returns` fact for them to travel on, so
//! the centre cannot see them. That is a gap in sync, not in this rule, and
//! the rule will pick them up unchanged the day the fact exists.
//!
//! # Generate, then post
//!
//! Generating derives; posting commits. Generating is idempotent and may be
//! repeated as often as anybody likes — it replaces a DRAFT in place. Posting
//! happens once, and a posted day is corrected the way this ledger corrects
//! everything: reverse the entry, generate again, post again. There is no path
//! that edits a posted document, because the journal quoting it cannot move.
//!
//! # Which day a sale belongs to
//!
//! The shop's own, by the time zone its `site` row keeps (`site_local_date`,
//! 0603). A sale rung at 23:40 in the shop belongs to that day even though it
//! is already tomorrow in UTC, and truncating a `timestamptz` would use
//! whatever the server's timezone happens to be set to. Same reading `reports.rs` uses, deliberately: a day that
//! closed on the takings report and a day that posted to the ledger have to be
//! the same day or nobody can reconcile the two.
//!
//! # No cost of goods
//!
//! Nothing here values stock. There is no costing method, no landed cost and
//! no valuation layer in this system, so a COGS figure would be invented and
//! gross margin would be confidently wrong. Revenue and VAT are recorded; the
//! cost half waits for inventory valuation. See `domain::sales_posting`.

use super::payment_ledger;
use super::poster::{post, reverse, PostingIntent, PostingLine};
use super::stock_ledger::{self, StockOutflow};
use crate::cloud::application::AppError;
use crate::cloud::domain::sales_posting::{
    build_with, classify_card, exception_reason, CardKind, DayFigures, DayRules, LedgerSide,
    RecordedVat, TenderBucket, RETURN_CREDIT,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;

/// Which rule version built an entry. Bumped when the arithmetic changes, so
/// entries produced by the old one can be found.
const RULE_VERSION: &str = "sale_day/1";
const RETENDER_RULE_VERSION: &str = "retender/1";

/// The rate to extract PPN at when the commercial books declare none.
///
/// TODO: this is a fallback, not a policy. The real rate is
/// `commercial_tax_rule.rate_bps` on the price book in force, which is what
/// `day_vat_rate_bps` reads first. This constant only applies to a node whose
/// commercial module has never been seeded — a dev database, or a shop's first
/// day — and 11% is Indonesia's standard PPN at the time of writing. A day
/// posted at this rate says so: `sales_posting.vat_rate_bps` is frozen on the
/// document.
const FALLBACK_VAT_RATE_BPS: i32 = 1_100;

// ---------------------------------------------------------------------------
// What a screen is told
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SalesPosting {
    pub posting_id: Uuid,
    pub site_id: String,
    pub business_date: NaiveDate,
    /// `DRAFT`, `POSTED` or `REVERSED`.
    pub status: String,
    pub currency: String,
    /// Charged to customers, VAT inclusive, after promotions.
    pub gross_minor: i64,
    /// What the tenders came to, net of change given.
    pub settled_minor: i64,
    /// What promotions took off, as the tills reported it. Reported only:
    /// the receipts are already net of it and that net is the revenue posted,
    /// so nothing of it reaches `sales_discount` (owner decision, 25 Sep 2026).
    pub discount_minor: i64,
    pub returns_minor: i64,
    /// PPN posted. Nought while PPN is ignored (P11); the tax the day carried
    /// is in `vat_recorded_minor` and `vat_recomputed_minor`.
    pub vat_minor: i64,
    /// What the day is worth to the income statement.
    pub revenue_minor: i64,
    /// Takings no tender accounts for, treated as cash. Zero on a well-formed
    /// day; shown because treating it as cash is an assumption.
    pub untendered_minor: i64,
    pub sale_count: i64,
    pub vat_rate_bps: i32,
    /// `RECORDED` when `vat_minor` is the tax the tills wrote on the receipts,
    /// `RATE` when no source carried one and `vat_rate_bps` stood in.
    pub vat_source: String,
    /// What the sources recorded, net of returns. Null on a `RATE` day.
    pub vat_recorded_minor: Option<i64>,
    /// What `vat_rate_bps` says the same day comes to — the validation figure,
    /// carried on every day so the two are comparable.
    pub vat_recomputed_minor: i64,
    pub generated_at: DateTime<Utc>,
    pub generated_by: String,
    pub journal_entry_id: Option<Uuid>,
    /// The entry number, so a list can name the journal without a second
    /// fetch.
    pub entry_number: Option<String>,
    pub posted_at: Option<DateTime<Utc>>,
    pub posted_by: Option<String>,
    pub reversal_entry_id: Option<Uuid>,
    pub reversed_at: Option<DateTime<Utc>>,
    pub reversed_by: Option<String>,
    pub reversal_reason: Option<String>,
}

/// The day split the way it settles: one row per account the entry touches.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SalesPostingLine {
    pub line_id: Uuid,
    pub line_number: i32,
    pub method: String,
    /// The acquiring bank, card network or QRIS provider. Empty when the
    /// method needs no narrowing.
    pub acquirer: String,
    pub card_kind: Option<String>,
    /// True when the kind was inferred from the acquirer rather than captured
    /// at the till — which is the line to check when a receivable looks wrong.
    pub card_kind_inferred: bool,
    pub gross_minor: i64,
    pub returns_minor: i64,
    /// Nought: a promotion is inside the price this line was credited with.
    pub discount_minor: i64,
    /// Nought while PPN is ignored (P11).
    pub vat_minor: i64,
    pub tender_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SalesPostingDocument {
    pub posting: SalesPosting,
    pub lines: Vec<SalesPostingLine>,
    /// Tender lines of the day that could not post, with why. The rest of the
    /// day posts without them (Finance Connect stage 2).
    pub exceptions: Vec<SalesPostingException>,
}

/// One tender line a sales day could not post: a QRIS whose EDC bank is not
/// known, or an online tender (the company does not sell online).
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SalesPostingException {
    pub exception_id: Uuid,
    pub method: String,
    pub acquirer: String,
    pub receipts_minor: i64,
    pub refunds_minor: i64,
    pub tender_count: i64,
    pub reason: String,
    pub status: String,
    pub resolved_bank: Option<String>,
    pub journal_entry_id: Option<Uuid>,
}

/// Name the bank of a QRIS exception, so it posts to that bank's debit pair.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ResolveSalesExceptionRequest {
    pub bank_code: String,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GenerateSalesPostingRequest {
    pub site_id: String,
    pub business_date: NaiveDate,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GenerateSalesDaysRequest {
    /// One shop, or every shop when absent.
    #[serde(default)]
    pub site_id: Option<String>,
    /// The span to sweep. Absent means every day that has takings and no
    /// document.
    #[serde(default)]
    pub from: Option<NaiveDate>,
    #[serde(default)]
    pub to: Option<NaiveDate>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GeneratedDay {
    pub site_id: String,
    pub business_date: NaiveDate,
    /// `GENERATED`, `ALREADY_POSTED`, or the refusal in the shop's own words.
    pub outcome: String,
    pub posting_id: Option<Uuid>,
    pub gross_minor: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReverseSalesPostingRequest {
    pub reason: String,
    /// When the reversal belongs in the books. Defaults to the day being
    /// reversed, so a correction lands in the month it corrects — unless that
    /// month is closed, which the ledger refuses on its own.
    #[serde(default)]
    pub posting_date: Option<NaiveDate>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RetenderRequest {
    pub to_method: String,
    #[serde(default)]
    pub to_acquirer: String,
    /// `DEBIT` or `CREDIT`. Absent leaves the kind to be inferred from the
    /// acquirer, the way generation does.
    #[serde(default)]
    pub to_card_kind: Option<String>,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RetenderOutcome {
    pub retender_id: Uuid,
    pub tender_id: Uuid,
    /// `EDGE` or `CENTRAL`: which population the tender lives in.
    pub tender_source: String,
    pub site_id: String,
    pub business_date: NaiveDate,
    pub amount_minor: i64,
    pub from_method: String,
    pub from_acquirer: String,
    pub to_method: String,
    pub to_acquirer: String,
    /// Set when the day was already posted and the books had to be corrected
    /// as well as the row.
    pub journal_entry_id: Option<Uuid>,
    pub entry_number: Option<String>,
    /// What a person needs to do next, in a sentence.
    pub next: String,
}

// ---------------------------------------------------------------------------
// Reading a day
// ---------------------------------------------------------------------------

/// The instants a business date covers at a shop.
/// Finance's settings that shape the day's entry (0468).
async fn day_rules(pool: &PgPool) -> Result<DayRules, AppError> {
    let discount_accounting: bool = sqlx::query_scalar(
        "SELECT COALESCE((SELECT value_numeric <> 0 FROM finance_setting
                           WHERE setting_key = 'sales.discount_accounting'), false)",
    )
    .fetch_one(pool)
    .await?;
    Ok(DayRules {
        discount_accounting,
    })
}

/// The instants a shop's day starts and ends at: its own midnights, in the
/// zone its `site` row keeps. Postgres does the arithmetic because it holds the
/// tz database.
async fn day_window(
    pool: &PgPool,
    site_id: &str,
    business_date: NaiveDate,
) -> Result<(DateTime<Utc>, DateTime<Utc>), AppError> {
    let row = sqlx::query(
        "SELECT ($1::date::timestamp AT TIME ZONE site_business_timezone($2)) AS start_at,
                (($1::date + 1)::timestamp AT TIME ZONE site_business_timezone($2)) AS end_at",
    )
    .bind(business_date)
    .bind(site_id)
    .fetch_one(pool)
    .await?;
    Ok((row.try_get("start_at")?, row.try_get("end_at")?))
}

/// How a bucket is keyed while the two populations are being merged.
type BucketKey = (String, String, Option<CardKind>);

/// The key a tender belongs under.
///
/// A card kind is only a fact about a card. Carrying one on a cash row would
/// split the drawer into two buckets the moment a stray value reached the
/// column, and the day would post two cash lines that mean the same thing.
/// The bucket a tender falls in, and whether its card kind was a guess.
///
/// The kind is SETTLED here rather than in `into_vec`, and that is the whole
/// point. A till that declares `DEBIT` and a central receipt that declares
/// nothing are the same tender to the client's chart — both are BCA debit money
/// — but keying on what was DECLARED made them two buckets that then resolved
/// to the same `(method, acquirer, card_kind)`, and `sales_posting_line` is
/// unique on exactly that triple. The day died on a unique violation rendered
/// as "database operation failed", which says nothing to anybody.
///
/// It stayed invisible while no source declared a kind. The moment one did —
/// a shop's own till, which records it — every mixed day stopped generating.
fn bucket_key(method: &str, acquirer: String, declared: Option<CardKind>) -> (BucketKey, bool) {
    if method == "CARD" {
        let (kind, inferred) = classify_card(declared, &acquirer);
        ((method.to_string(), acquirer, Some(kind)), inferred)
    } else {
        ((method.to_string(), acquirer, None), false)
    }
}

fn parse_card_kind(raw: Option<String>) -> Option<CardKind> {
    match raw.as_deref().map(str::trim) {
        Some("DEBIT") => Some(CardKind::Debit),
        Some("CREDIT") => Some(CardKind::Credit),
        _ => None,
    }
}

/// Who settles this tender.
///
/// `acquirer` when the till captured one; otherwise `reference`, which is
/// where 0077 said the acquirer or issuing bank goes and is the only thing the
/// tills send today. A reference holding an approval code instead becomes a
/// qualifier nothing is mapped for, and the posting refuses naming it — which
/// is the outcome to want: it is visible, and `retender` fixes it. Silently
/// filing it under "cards in general" would not be.
///
/// Only for the methods whose accounts are per counterparty. Cash is cash.
/// OTHER is per counterparty too — the reference is the only place a
/// marketplace or a sender's name can arrive from, and it is what the
/// receivable is qualified by.
fn acquirer_of(method: &str, acquirer: Option<&str>, reference: Option<&str>) -> String {
    match method {
        "CARD" | "QRIS" | "EWALLET" | "OTHER" => acquirer
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| reference.map(str::trim).filter(|value| !value.is_empty()))
            .map(|value| value.to_ascii_uppercase())
            .unwrap_or_default(),
        _ => String::new(),
    }
}

/// A running merge of both populations' tenders into the buckets the rule
/// posts from.
/// Which bank each EDC terminal at a shop belongs to, and which codes are banks.
struct EdcBanks {
    terminals: BTreeMap<String, String>,
    banks: Vec<String>,
}

impl EdcBanks {
    async fn load(pool: &PgPool, site_id: &str) -> Result<Self, AppError> {
        let terminals = sqlx::query(
            "SELECT terminal_id, bank_code FROM edc_terminal WHERE site_id = $1 AND active",
        )
        .bind(site_id)
        .fetch_all(pool)
        .await?
        .iter()
        .map(|row| {
            Ok((
                row.try_get::<String, _>("terminal_id")?
                    .trim()
                    .to_ascii_uppercase(),
                row.try_get::<String, _>("bank_code")?,
            ))
        })
        .collect::<Result<BTreeMap<_, _>, AppError>>()?;
        let banks = sqlx::query_scalar::<_, String>("SELECT upper(code) FROM bank WHERE active")
            .fetch_all(pool)
            .await?;
        Ok(Self { terminals, banks })
    }
}

/// The bank a QRIS tender settles through (owner decision 25 Sep: QRIS rides
/// the EDC of a bank). The acquirer the POS sent when it is a bank; otherwise
/// the bank of the terminal it was paid on; otherwise nothing, which sends the
/// bucket to the exception queue. Every other method passes through.
fn qris_bank(method: &str, acquirer: String, terminal: Option<&str>, edc: &EdcBanks) -> String {
    if method != "QRIS" {
        return acquirer;
    }
    if edc.banks.iter().any(|bank| *bank == acquirer) {
        return acquirer;
    }
    terminal
        .map(|t| t.trim().to_ascii_uppercase())
        .and_then(|t| edc.terminals.get(&t).cloned())
        .unwrap_or_default()
}

#[derive(Default)]
struct Buckets {
    receipts: BTreeMap<BucketKey, (i64, i64)>,
    refunds: BTreeMap<BucketKey, i64>,
    /// True where any leg of the bucket had its card kind guessed. Merged
    /// rather than keyed on: one declared tender does not make the guessed one
    /// beside it declared, and the working paper says so on the row.
    inferred: BTreeMap<BucketKey, bool>,
}

impl Buckets {
    fn take(&mut self, keyed: (BucketKey, bool), amount: i64, count: i64) {
        let (key, inferred) = keyed;
        *self.inferred.entry(key.clone()).or_insert(false) |= inferred;
        let slot = self.receipts.entry(key).or_insert((0, 0));
        slot.0 += amount;
        slot.1 += count;
    }

    fn give_back(&mut self, keyed: (BucketKey, bool), amount: i64) {
        let (key, inferred) = keyed;
        *self.inferred.entry(key.clone()).or_insert(false) |= inferred;
        *self.refunds.entry(key).or_insert(0) += amount;
    }

    /// Merged, with the card kinds settled and the change taken out of cash.
    fn into_vec(self, cash_adjustment: i64) -> Result<Vec<TenderBucket>, AppError> {
        let mut keys: Vec<BucketKey> = self.receipts.keys().cloned().collect();
        for key in self.refunds.keys() {
            if !self.receipts.contains_key(key) {
                keys.push(key.clone());
            }
        }
        keys.sort();
        keys.dedup();

        let mut cash_seen = false;
        let mut out = Vec::with_capacity(keys.len().max(1));
        for key in keys {
            let (method, acquirer, card_kind) = key.clone();
            let (mut receipts, count) = self.receipts.get(&key).copied().unwrap_or((0, 0));
            let refunds = self.refunds.get(&key).copied().unwrap_or(0);
            let inferred = self.inferred.get(&key).copied().unwrap_or(false);
            if method == "CASH" && !cash_seen {
                cash_seen = true;
                receipts += cash_adjustment;
                if receipts < 0 {
                    return Err(AppError::Validation(format!(
                        "that day gave out {} more in change than it took in cash; the \
                         tenders and the sales disagree and the ledger cannot say which \
                         is right",
                        -receipts
                    )));
                }
            }
            out.push(TenderBucket {
                method,
                acquirer,
                card_kind,
                card_kind_inferred: inferred,
                receipts_minor: receipts,
                refunds_minor: refunds,
                tender_count: count,
                direct_mdr_bps: None,
                direct_bank: None,
            });
        }
        // Change given, or takings no tender accounts for, with no cash bucket
        // to carry them. A day that gave change and recorded no cash tender is
        // a day whose settlement is unknown, not a day of nothing.
        if !cash_seen && cash_adjustment != 0 {
            if cash_adjustment < 0 {
                return Err(AppError::Validation(
                    "that day gave change and recorded no cash tender; the ledger cannot \
                     say what settled it"
                        .into(),
                ));
            }
            out.push(TenderBucket {
                method: "CASH".into(),
                acquirer: String::new(),
                card_kind: None,
                card_kind_inferred: false,
                receipts_minor: cash_adjustment,
                refunds_minor: 0,
                tender_count: 0,
                direct_mdr_bps: None,
                direct_bank: None,
            });
        }
        Ok(out)
    }
}

/// The rate PPN is extracted at.
///
/// The price book in force says it — `commercial_tax_rule` on the newest
/// publication. When several categories declare different rates the highest is
/// taken, because the day's totals carry no category to split them by and
/// under-declaring output VAT is the expensive direction to be wrong in.
async fn day_vat_rate_bps(pool: &PgPool) -> Result<i32, AppError> {
    let row = sqlx::query(
        "SELECT MAX(tr.rate_bps)::int AS rate
           FROM commercial_tax_rule tr
           JOIN commercial_publication p ON p.id = tr.publication_id
          WHERE p.version = (SELECT MAX(version) FROM commercial_publication)",
    )
    .fetch_optional(pool)
    .await?;
    let declared: Option<i32> = match row {
        Some(row) => row.try_get("rate")?,
        None => None,
    };
    Ok(declared.unwrap_or(FALLBACK_VAT_RATE_BPS))
}

/// The tax the day's own documents recorded, when all of them did.
///
/// Three readings, and the day is only `Some` if none of them has a hole in it:
///
///   * `sale.tax_minor` is NOT NULL and comes from `commercial_tax_rule` for
///     the product's own tax category on the publication that priced the line
///     (`sales.rs`), so a central sale always carries its tax;
///   * `edge_sale.tax_total_minor` is the till's own quote, summed per line,
///     and is NULL when the basket was priced with no book in force. NULL there
///     means UNKNOWN, not nought, which is why one such sale takes the whole
///     day back to the rate;
///   * a refund carries no tax of its own — `sale_return` has no such column —
///     so it is taken from the line the thing was SOLD on, scaled by how much
///     of that line came back. A return whose lines cannot be traced, or whose
///     lines do not add up to the refund on its head, is a hole.
///
/// Returning `None` rather than a partial figure is the point. Half the day
/// from the receipts and half from a rate is a number nobody can defend.
async fn read_recorded_vat(
    pool: &PgPool,
    site_id: &str,
    business_date: NaiveDate,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Result<Option<RecordedVat>, AppError> {
    let central = sqlx::query(
        "SELECT COALESCE(SUM(tax_minor),0)::bigint AS tax_minor
           FROM sale
          WHERE site_id = $1 AND status = 'COMPLETED'
            AND completed_at >= $2 AND completed_at < $3",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;
    let central_tax: i64 = central.try_get("tax_minor")?;

    let synced = sqlx::query(
        // `charge_tax_minor` is added because the fees it taxes are inside the
        // tenders this day is posted from: `paid - change` comes to
        // `total + charges`. Leaving it out would post the tax of the goods
        // against the takings of the goods AND the fees.
        "SELECT COUNT(*) FILTER (WHERE tax_total_minor IS NULL)::bigint AS unrecorded,
                (COALESCE(SUM(tax_total_minor),0)
                 + COALESCE(SUM(charge_tax_minor),0))::bigint AS tax_minor
           FROM edge_sale
          -- The till's day is its shift's (0714), not the clock's.
          WHERE site_id = $1 AND business_date = $2
            AND status = 'COMPLETED'",
    )
    .bind(site_id)
    .bind(business_date)
    .fetch_one(pool)
    .await?;
    let unrecorded_sales: i64 = synced.try_get("unrecorded")?;
    let synced_tax: i64 = synced.try_get("tax_minor")?;

    let returned = sqlx::query(
        "WITH returned_line AS (
             SELECT r.id AS return_id,
                    rl.refund_minor,
                    COALESCE(sl.tax_minor, esl.tax_minor) AS line_tax_minor,
                    COALESCE(sl.total_minor, esl.line_total_minor) AS line_total_minor
               FROM sale_return r
               JOIN sale_return_line rl ON rl.return_id = r.id
               LEFT JOIN sale_line sl ON sl.id = rl.sale_line_id
               LEFT JOIN edge_sale_line esl
                      ON esl.sale_id = r.sale_id AND esl.subject_id = rl.subject_id
              WHERE r.site_id = $1 AND r.created_at >= $2 AND r.created_at < $3
         ), per_return AS (
             SELECT r.id,
                    r.refund_total_minor,
                    COALESCE(SUM(l.refund_minor),0)::bigint AS lines_refund_minor,
                    COUNT(*) FILTER (
                        WHERE l.line_tax_minor IS NULL OR COALESCE(l.line_total_minor,0) <= 0
                    )::bigint AS unresolved_lines,
                    COALESCE(SUM(
                        CASE WHEN l.line_tax_minor IS NOT NULL AND l.line_total_minor > 0
                             THEN (l.line_tax_minor::numeric * l.refund_minor
                                   / l.line_total_minor)::bigint
                             ELSE 0 END
                    ),0)::bigint AS tax_minor
               FROM sale_return r
               LEFT JOIN returned_line l ON l.return_id = r.id
              WHERE r.site_id = $1 AND r.created_at >= $2 AND r.created_at < $3
              GROUP BY r.id, r.refund_total_minor
         )
         SELECT COALESCE(SUM(tax_minor),0)::bigint AS tax_minor,
                COUNT(*) FILTER (
                    WHERE unresolved_lines > 0
                       OR lines_refund_minor <> refund_total_minor
                )::bigint AS unresolved_returns
           FROM per_return",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;
    let unresolved_returns: i64 = returned.try_get("unresolved_returns")?;
    let returned_tax: i64 = returned.try_get("tax_minor")?;

    if unrecorded_sales > 0 || unresolved_returns > 0 {
        return Ok(None);
    }
    Ok(Some(RecordedVat {
        taken_minor: central_tax + synced_tax,
        returned_minor: returned_tax,
    }))
}

struct DayReading {
    figures: DayFigures,
    /// Buckets that cannot post, each with the reason; kept out of `figures`
    /// so the rest of the day posts (brief stage 2 point 1).
    exceptions: Vec<(TenderBucket, String)>,
    gross_minor: i64,
    untendered_minor: i64,
    sale_count: i64,
}

/// Everything the rule needs about one shop on one day.
async fn read_day(
    pool: &PgPool,
    site_id: &str,
    business_date: NaiveDate,
) -> Result<DayReading, AppError> {
    let (start, end) = day_window(pool, site_id, business_date).await?;
    let mut buckets = Buckets::default();

    // ── the fleet's own tills, synced up ────────────────────────────────────
    let synced = sqlx::query(
        "SELECT COUNT(*)::bigint AS sale_count,
                COALESCE(SUM(total_minor),0)::bigint AS gross_minor,
                COALESCE(SUM(change_minor),0)::bigint AS change_minor,
                COALESCE(SUM(discount_total_minor),0)::bigint AS discount_minor
           FROM edge_sale
          -- A till's sale trades for its shift's day (0714): a sale at half
          -- past midnight on a shift opened at eleven is the evening before's.
          WHERE site_id = $1 AND business_date = $2
            AND status = 'COMPLETED'",
    )
    .bind(site_id)
    .bind(business_date)
    .fetch_one(pool)
    .await?;
    let mut sale_count: i64 = synced.try_get("sale_count")?;
    let mut gross: i64 = synced.try_get("gross_minor")?;
    let mut change: i64 = synced.try_get("change_minor")?;
    let discount: i64 = synced.try_get("discount_minor")?;

    let edc = EdcBanks::load(pool, site_id).await?;
    let mut tendered: i64 = 0;
    let synced_tenders = sqlx::query(
        "SELECT t.method, t.acquirer, t.reference, t.card_kind, t.terminal_id,
                COALESCE(SUM(t.amount_minor),0)::bigint AS amount_minor,
                COUNT(*)::bigint AS tender_count
           FROM edge_sale_tender t
           JOIN edge_sale s ON s.sale_id = t.sale_id
          -- The same sales the day's totals above count: a voided sale's
          -- money went back to the customer and must not reach the day.
          WHERE s.site_id = $1 AND s.business_date = $2
            AND s.status = 'COMPLETED'
          GROUP BY t.method, t.acquirer, t.reference, t.card_kind, t.terminal_id",
    )
    .bind(site_id)
    .bind(business_date)
    .fetch_all(pool)
    .await?;
    for row in &synced_tenders {
        let method: String = row.try_get("method")?;
        let amount: i64 = row.try_get("amount_minor")?;
        let acquirer = qris_bank(
            &method,
            acquirer_of(
                &method,
                row.try_get::<Option<String>, _>("acquirer")?.as_deref(),
                row.try_get::<Option<String>, _>("reference")?.as_deref(),
            ),
            row.try_get::<Option<String>, _>("terminal_id")?.as_deref(),
            &edc,
        );
        tendered += amount;
        buckets.take(
            bucket_key(
                &method,
                acquirer,
                parse_card_kind(row.try_get("card_kind")?),
            ),
            amount,
            row.try_get("tender_count")?,
        );
    }

    // ── what was rung up against this node ──────────────────────────────────
    let central = sqlx::query(
        "SELECT COUNT(*)::bigint AS sale_count,
                COALESCE(SUM(total_minor),0)::bigint AS gross_minor,
                COALESCE(SUM(change_minor),0)::bigint AS change_minor
           FROM sale
          WHERE site_id = $1 AND status = 'COMPLETED'
            AND completed_at >= $2 AND completed_at < $3",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;
    sale_count += central.try_get::<i64, _>("sale_count")?;
    gross += central.try_get::<i64, _>("gross_minor")?;
    change += central.try_get::<i64, _>("change_minor")?;

    let central_tenders = sqlx::query(
        "SELECT p.method, p.acquirer, p.reference, p.card_kind, p.terminal_id,
                COALESCE(SUM(p.amount_minor),0)::bigint AS amount_minor,
                COUNT(*)::bigint AS tender_count
           FROM sale_payment p
           JOIN sale s ON s.id = p.sale_id
          WHERE s.site_id = $1 AND s.status = 'COMPLETED'
            AND s.completed_at >= $2 AND s.completed_at < $3
          GROUP BY p.method, p.acquirer, p.reference, p.card_kind, p.terminal_id",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;
    for row in &central_tenders {
        let method: String = row.try_get("method")?;
        let amount: i64 = row.try_get("amount_minor")?;
        let acquirer = qris_bank(
            &method,
            acquirer_of(
                &method,
                row.try_get::<Option<String>, _>("acquirer")?.as_deref(),
                row.try_get::<Option<String>, _>("reference")?.as_deref(),
            ),
            row.try_get::<Option<String>, _>("terminal_id")?.as_deref(),
            &edc,
        );
        tendered += amount;
        buckets.take(
            bucket_key(
                &method,
                acquirer,
                parse_card_kind(row.try_get("card_kind")?),
            ),
            amount,
            row.try_get("tender_count")?,
        );
    }

    // ── what went back over the counter ─────────────────────────────────────
    let returns: i64 = sqlx::query(
        "SELECT COALESCE(SUM(refund_total_minor),0)::bigint AS refunded
           FROM sale_return
          WHERE site_id = $1 AND created_at >= $2 AND created_at < $3",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?
    .try_get("refunded")?;

    let refund_rows = sqlx::query(
        "SELECT p.method, p.acquirer, p.card_kind, p.reference,
                COALESCE(SUM(p.amount_minor),0)::bigint AS amount_minor
           FROM sale_return_payment p
           JOIN sale_return r ON r.id = p.return_id
          WHERE r.site_id = $1 AND r.created_at >= $2 AND r.created_at < $3
          GROUP BY p.method, p.acquirer, p.card_kind, p.reference",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;
    let mut refunded_by_rows: i64 = 0;
    for row in &refund_rows {
        refunded_by_rows += row.try_get::<i64, _>("amount_minor")?;
        let method: String = row.try_get("method")?;
        let acquirer = acquirer_of(
            &method,
            row.try_get::<Option<String>, _>("acquirer")?.as_deref(),
            row.try_get::<Option<String>, _>("reference")?.as_deref(),
        );
        buckets.give_back(
            bucket_key(
                &method,
                acquirer,
                parse_card_kind(row.try_get("card_kind")?),
            ),
            row.try_get("amount_minor")?,
        );
    }

    // A tender list adds up to what a sale says was paid — the centre checks
    // that at ingest. So the only way a day comes up short here is a sale that
    // arrived carrying no tenders at all, which is what an older till sends.
    // `0077` and `0020` both took the same reading of that history: the till
    // could take nothing but cash, so cash is what it was. The figure is kept
    // on the document so that reading is visible rather than assumed.
    let expected = gross + change;
    let mut untendered = (expected - tendered).max(0);

    // RETURN (owner decision 11): money never leaves the till. The goods taken
    // back pay for the replacement, which therefore arrives with less tender
    // than its total. That shortfall is not cash — it is the return — so the
    // part of it the day's un-refunded returns explain becomes a RETURN bucket
    // (revenue, no asset side), and only what is left is treated as cash.
    let unrefunded_returns = (returns - refunded_by_rows).max(0);
    let returned_goods = untendered.min(unrefunded_returns);
    untendered -= returned_goods;
    if returned_goods > 0 {
        buckets.take(
            ((RETURN_CREDIT.to_string(), String::new(), None), false),
            returned_goods,
            0,
        );
    }

    let recorded_vat = read_recorded_vat(pool, site_id, business_date, start, end).await?;

    let (mut postable, exceptions): (Vec<TenderBucket>, Vec<TenderBucket>) = buckets
        .into_vec(untendered - change)?
        .into_iter()
        .partition(|bucket| exception_reason(&bucket.method, &bucket.acquirer).is_none());

    // A payment method Finance set to settle straight into the bank (0468)
    // books its MDR on the day, at the method's rate.
    let primary_bank: Option<String> = sqlx::query_scalar(
        "SELECT upper(b.code) FROM bank_account a JOIN bank b ON b.bank_id = a.bank_id
          WHERE a.is_company_account AND a.active AND a.kind = 'GIRO'
          ORDER BY a.is_primary DESC, a.created_at LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    let direct: Vec<(String, String, i32)> = sqlx::query_as(
        "SELECT tender_type, bank_code, mdr_bps FROM payment_method
          WHERE is_active AND settlement_mode = 'DIRECT_TO_BANK'",
    )
    .fetch_all(pool)
    .await?;
    for bucket in &mut postable {
        let tender = match (bucket.method.as_str(), bucket.card_kind) {
            ("CARD", Some(CardKind::Credit)) => "CREDIT_CARD",
            ("CARD", _) => "DEBIT_CARD",
            ("QRIS", _) => "QRIS",
            ("EWALLET", _) => "EWALLET",
            _ => "",
        };
        if let Some((_, _, bps)) = direct
            .iter()
            .find(|(kind, bank, _)| kind == tender && *bank == bucket.acquirer)
        {
            bucket.direct_mdr_bps = Some(*bps);
            // The bank the money lands in is the EDC's, not the card's: a
            // Mandiri card swiped on a BCA machine settles into BCA. So the
            // shop's EDC bank when the tender names it, or when the shop has
            // only one; failing that the company's primary bank account.
            let acquirer = bucket.acquirer.to_ascii_uppercase();
            let site_banks: std::collections::BTreeSet<String> = edc
                .terminals
                .values()
                .map(|bank| bank.to_ascii_uppercase())
                .collect();
            bucket.direct_bank = Some(if site_banks.contains(&acquirer) {
                acquirer
            } else if site_banks.len() == 1 {
                site_banks.into_iter().next().unwrap_or_default()
            } else {
                primary_bank.clone().ok_or_else(|| {
                    AppError::Validation(format!(
                        "{} {} settles straight to the bank, and neither the shop's EDC nor \
                         a primary bank account says which bank",
                        bucket.method, bucket.acquirer
                    ))
                })?
            });
        }
    }
    let exceptions = exceptions
        .into_iter()
        .map(|bucket| {
            let reason = exception_reason(&bucket.method, &bucket.acquirer).unwrap_or_default();
            (bucket, reason)
        })
        .collect();

    Ok(DayReading {
        figures: DayFigures {
            buckets: postable,
            discount_minor: discount,
            returns_minor: returns,
            vat_rate_bps: day_vat_rate_bps(pool).await?,
            recorded_vat,
        },
        exceptions,
        gross_minor: gross,
        untendered_minor: untendered,
        sale_count,
    })
}

// ---------------------------------------------------------------------------
// Reading the documents back
// ---------------------------------------------------------------------------

const POSTING_COLUMNS: &str = "p.posting_id, p.site_id, p.business_date, p.status,
     p.currency::text AS currency, p.gross_minor, p.settled_minor, p.discount_minor,
     p.returns_minor, p.vat_minor, p.revenue_minor, p.untendered_minor, p.sale_count,
     p.vat_rate_bps::int AS vat_rate_bps, p.vat_source, p.vat_recorded_minor,
     p.vat_recomputed_minor, p.generated_at, p.generated_by,
     p.journal_entry_id, e.entry_number, p.posted_at, p.posted_by,
     p.reversal_entry_id, p.reversed_at, p.reversed_by, p.reversal_reason";

fn to_posting(row: &sqlx::postgres::PgRow) -> Result<SalesPosting, AppError> {
    Ok(SalesPosting {
        posting_id: row.try_get("posting_id")?,
        site_id: row.try_get("site_id")?,
        business_date: row.try_get("business_date")?,
        status: row.try_get("status")?,
        currency: row.try_get::<String, _>("currency")?.trim().to_string(),
        gross_minor: row.try_get("gross_minor")?,
        settled_minor: row.try_get("settled_minor")?,
        discount_minor: row.try_get("discount_minor")?,
        returns_minor: row.try_get("returns_minor")?,
        vat_minor: row.try_get("vat_minor")?,
        revenue_minor: row.try_get("revenue_minor")?,
        untendered_minor: row.try_get("untendered_minor")?,
        sale_count: row.try_get("sale_count")?,
        vat_rate_bps: row.try_get("vat_rate_bps")?,
        vat_source: row.try_get("vat_source")?,
        vat_recorded_minor: row.try_get("vat_recorded_minor")?,
        vat_recomputed_minor: row.try_get("vat_recomputed_minor")?,
        generated_at: row.try_get("generated_at")?,
        generated_by: row.try_get("generated_by")?,
        journal_entry_id: row.try_get("journal_entry_id")?,
        entry_number: row.try_get("entry_number")?,
        posted_at: row.try_get("posted_at")?,
        posted_by: row.try_get("posted_by")?,
        reversal_entry_id: row.try_get("reversal_entry_id")?,
        reversed_at: row.try_get("reversed_at")?,
        reversed_by: row.try_get("reversed_by")?,
        reversal_reason: row.try_get("reversal_reason")?,
    })
}

/// Every day's document for a shop, newest first. A month when one is named.
pub async fn sales_postings(
    pool: &PgPool,
    site_id: Option<&str>,
    month: Option<NaiveDate>,
    limit: i64,
) -> Result<Vec<SalesPosting>, AppError> {
    let sql = format!(
        "SELECT {POSTING_COLUMNS}
           FROM sales_posting p
           LEFT JOIN journal_entry e ON e.entry_id = p.journal_entry_id
          WHERE ($1::text IS NULL OR p.site_id = $1)
            AND ($2::date IS NULL
                 OR (p.business_date >= date_trunc('month', $2::date)::date
                 AND p.business_date < (date_trunc('month', $2::date) + interval '1 month')::date))
          ORDER BY p.business_date DESC, p.site_id
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(site_id)
        .bind(month)
        .bind(limit.clamp(1, 1000))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_posting).collect()
}

pub async fn sales_posting_detail(
    pool: &PgPool,
    posting_id: Uuid,
) -> Result<SalesPostingDocument, AppError> {
    let sql = format!(
        "SELECT {POSTING_COLUMNS}
           FROM sales_posting p
           LEFT JOIN journal_entry e ON e.entry_id = p.journal_entry_id
          WHERE p.posting_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(posting_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("sales posting".into()))?;
    let posting = to_posting(&row)?;

    let lines = sqlx::query(
        "SELECT line_id, line_number::int AS line_number, method, acquirer, card_kind,
                card_kind_inferred, gross_minor, returns_minor, discount_minor,
                vat_minor, tender_count
           FROM sales_posting_line WHERE posting_id = $1 ORDER BY line_number",
    )
    .bind(posting_id)
    .fetch_all(pool)
    .await?;
    let lines = lines
        .iter()
        .map(|row| {
            Ok(SalesPostingLine {
                line_id: row.try_get("line_id")?,
                line_number: row.try_get("line_number")?,
                method: row.try_get("method")?,
                acquirer: row.try_get("acquirer")?,
                card_kind: row.try_get("card_kind")?,
                card_kind_inferred: row.try_get("card_kind_inferred")?,
                gross_minor: row.try_get("gross_minor")?,
                returns_minor: row.try_get("returns_minor")?,
                discount_minor: row.try_get("discount_minor")?,
                vat_minor: row.try_get("vat_minor")?,
                tender_count: row.try_get("tender_count")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let exceptions = sqlx::query(
        "SELECT exception_id, method, acquirer, receipts_minor, refunds_minor, tender_count,
                reason, status, resolved_bank, journal_entry_id
           FROM sales_posting_exception WHERE posting_id = $1 ORDER BY created_at, method",
    )
    .bind(posting_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(SalesPostingException {
            exception_id: row.try_get("exception_id")?,
            method: row.try_get("method")?,
            acquirer: row.try_get("acquirer")?,
            receipts_minor: row.try_get("receipts_minor")?,
            refunds_minor: row.try_get("refunds_minor")?,
            tender_count: row.try_get("tender_count")?,
            reason: row.try_get("reason")?,
            status: row.try_get("status")?,
            resolved_bank: row.try_get("resolved_bank")?,
            journal_entry_id: row.try_get("journal_entry_id")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    Ok(SalesPostingDocument {
        posting,
        lines,
        exceptions,
    })
}

// ---------------------------------------------------------------------------
// Generating
// ---------------------------------------------------------------------------

/// Derive a day into a document, replacing whatever draft was there.
///
/// Idempotent by construction: the same day gives the same figures, and the
/// unique key on (site, date) makes a second generation an update rather than
/// a second document. A POSTED day is refused, because the entry quoting it
/// cannot move — reverse it first.
pub async fn sales_posting_generate(
    pool: &PgPool,
    request: &GenerateSalesPostingRequest,
    actor: &str,
) -> Result<SalesPostingDocument, AppError> {
    let site_id = request.site_id.trim().to_ascii_lowercase();
    sqlx::query("SELECT id FROM site WHERE id = $1")
        .bind(&site_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("site {site_id}")))?;

    let existing = sqlx::query(
        "SELECT posting_id, status FROM sales_posting WHERE site_id = $1 AND business_date = $2",
    )
    .bind(&site_id)
    .bind(request.business_date)
    .fetch_optional(pool)
    .await?;
    // POSTED is the only status that refuses. DRAFT is replaced in place, and
    // so is REVERSED — regenerating a reversed day is the second half of the
    // only correction path this ledger has, and refusing it here would leave a
    // day that was posted once uncorrectable forever.
    if let Some(row) = &existing {
        let status: String = row.try_get("status")?;
        if status == "POSTED" {
            return Err(AppError::Conflict(format!(
                "{site_id} {} is already posted; a posted day is corrected by reversing \
                 it and generating again, never by regenerating over it",
                request.business_date
            )));
        }
    }

    let reading = read_day(pool, &site_id, request.business_date).await?;
    let posting =
        build_with(&reading.figures, day_rules(pool).await?).map_err(AppError::Validation)?;

    let posting_id = existing
        .as_ref()
        .map(|row| row.try_get::<Uuid, _>("posting_id"))
        .transpose()?
        .unwrap_or_else(Uuid::new_v4);

    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO sales_posting
           (posting_id, site_id, business_date, status, gross_minor, settled_minor,
            discount_minor, returns_minor, vat_minor, revenue_minor, untendered_minor,
            sale_count, vat_rate_bps, generated_by,
            vat_source, vat_recorded_minor, vat_recomputed_minor)
         VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (site_id, business_date) DO UPDATE SET
             gross_minor = EXCLUDED.gross_minor,
             settled_minor = EXCLUDED.settled_minor,
             discount_minor = EXCLUDED.discount_minor,
             returns_minor = EXCLUDED.returns_minor,
             vat_minor = EXCLUDED.vat_minor,
             revenue_minor = EXCLUDED.revenue_minor,
             untendered_minor = EXCLUDED.untendered_minor,
             sale_count = EXCLUDED.sale_count,
             vat_rate_bps = EXCLUDED.vat_rate_bps,
             vat_source = EXCLUDED.vat_source,
             vat_recorded_minor = EXCLUDED.vat_recorded_minor,
             vat_recomputed_minor = EXCLUDED.vat_recomputed_minor,
             generated_at = now(),
             generated_by = EXCLUDED.generated_by,
             -- A regenerated day is a draft again, whatever it was. On a
             -- draft these are already null; on a reversed one they have to
             -- be let go, because the table insists a draft has no journal
             -- behind it -- and it is right to. Nothing is lost doing it:
             -- both the original entry and its reversal stay in the journal
             -- carrying this document's id as their `source_id`, which is
             -- where the history of a corrected day belongs and the only
             -- place an auditor would accept it. The document is the working
             -- paper; the ledger is the record.
             status = 'DRAFT',
             journal_entry_id = NULL,
             posted_at = NULL,
             posted_by = NULL,
             reversal_entry_id = NULL,
             reversed_at = NULL,
             reversed_by = NULL,
             reversal_reason = NULL",
    )
    .bind(posting_id)
    .bind(&site_id)
    .bind(request.business_date)
    .bind(reading.gross_minor)
    .bind(posting.receipts_minor)
    .bind(reading.figures.discount_minor)
    .bind(reading.figures.returns_minor)
    .bind(posting.vat_minor)
    .bind(posting.revenue_minor)
    .bind(reading.untendered_minor)
    .bind(reading.sale_count)
    .bind(reading.figures.vat_rate_bps)
    .bind(actor)
    .bind(posting.vat_source)
    .bind(posting.vat_recorded_minor)
    .bind(posting.vat_recomputed_minor)
    .execute(&mut *tx)
    .await?;

    // The working paper is rebuilt whole rather than reconciled row by row: a
    // regeneration is a fresh reading of the day, and a line that survived
    // from a previous one would be a figure nothing derived.
    sqlx::query("DELETE FROM sales_posting_line WHERE posting_id = $1")
        .bind(posting_id)
        .execute(&mut *tx)
        .await?;
    for (index, (bucket, outcome)) in reading
        .figures
        .buckets
        .iter()
        .zip(&posting.buckets)
        .enumerate()
    {
        sqlx::query(
            "INSERT INTO sales_posting_line
               (line_id, posting_id, line_number, method, acquirer, card_kind,
                card_kind_inferred, gross_minor, returns_minor, discount_minor,
                vat_minor, tender_count)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        )
        .bind(Uuid::new_v4())
        .bind(posting_id)
        .bind(index as i32 + 1)
        .bind(&bucket.method)
        .bind(&bucket.acquirer)
        .bind(bucket.card_kind.map(CardKind::as_str))
        .bind(bucket.card_kind_inferred)
        .bind(bucket.receipts_minor)
        .bind(bucket.refunds_minor)
        .bind(outcome.discount_minor)
        .bind(outcome.vat_minor)
        .bind(bucket.tender_count)
        .execute(&mut *tx)
        .await?;
    }

    // The lines that cannot post wait beside the day. An exception already
    // resolved (posted on its own) is not raised again when the day is
    // regenerated, or the same money would be booked twice.
    sqlx::query("DELETE FROM sales_posting_exception WHERE posting_id = $1 AND status = 'OPEN'")
        .bind(posting_id)
        .execute(&mut *tx)
        .await?;
    for (bucket, reason) in &reading.exceptions {
        sqlx::query(
            "INSERT INTO sales_posting_exception
               (exception_id, posting_id, method, acquirer, receipts_minor, refunds_minor,
                tender_count, reason)
             SELECT $1, $2, $3, $4, $5, $6, $7, $8
              WHERE NOT EXISTS (
                  SELECT 1 FROM sales_posting_exception x
                   WHERE x.posting_id = $2 AND x.status = 'RESOLVED' AND x.method = $3
                     AND x.receipts_minor = $5 AND x.refunds_minor = $6)",
        )
        .bind(Uuid::new_v4())
        .bind(posting_id)
        .bind(&bucket.method)
        .bind(&bucket.acquirer)
        .bind(bucket.receipts_minor)
        .bind(bucket.refunds_minor)
        .bind(bucket.tender_count)
        .bind(reason)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    sales_posting_detail(pool, posting_id).await
}

/// Post one QRIS exception once Finance has named its bank.
///
/// The day it belongs to must already be posted — its figures are then fixed
/// and this line is the only part of the day still outside the books. The
/// entry is the same pair the day would have written: Dr the bank's debit-card
/// receivable, Cr that bank's debit-card sales with the whole net — no tax line
/// while PPN is ignored (P11). An online tender is not resolved
/// here: the company does not sell online, so it is retendered at the source.
pub async fn sales_posting_exception_resolve(
    pool: &PgPool,
    exception_id: Uuid,
    request: &ResolveSalesExceptionRequest,
    actor: &str,
) -> Result<SalesPostingDocument, AppError> {
    let bank = request.bank_code.trim().to_ascii_uppercase();
    if bank.is_empty() {
        return Err(AppError::Validation(
            "name the bank of the EDC this QRIS was paid on, or the e-wallet's provider".into(),
        ));
    }
    let row = sqlx::query(
        "SELECT x.posting_id, x.method, x.status, x.receipts_minor, x.refunds_minor,
                p.site_id, p.business_date, p.status AS day_status, p.vat_rate_bps, p.currency
           FROM sales_posting_exception x
           JOIN sales_posting p ON p.posting_id = x.posting_id
          WHERE x.exception_id = $1",
    )
    .bind(exception_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("sales posting exception".into()))?;
    let posting_id: Uuid = row.try_get("posting_id")?;
    let method: String = row.try_get("method")?;
    let status: String = row.try_get("status")?;
    let day_status: String = row.try_get("day_status")?;
    if status != "OPEN" {
        return Err(AppError::Conflict(
            "this exception is already resolved".into(),
        ));
    }
    // QRIS names the bank of its EDC; an e-wallet names its provider. Both
    // then post like the day would have (`meanings_for`).
    if !matches!(method.as_str(), "QRIS" | "EWALLET") {
        return Err(AppError::Validation(format!(
            "a {method} line is not resolved by naming a bank: the company does not sell \
             online, so retender it at the source and generate the day again"
        )));
    }
    if day_status != "POSTED" {
        return Err(AppError::Conflict(
            "post the day first; this line is resolved into a posted day".into(),
        ));
    }
    let site_id: String = row.try_get("site_id")?;
    let business_date: NaiveDate = row.try_get("business_date")?;
    let vat_rate_bps: i32 = row.try_get("vat_rate_bps")?;
    let currency: String = row.try_get("currency")?;
    let net = row.try_get::<i64, _>("receipts_minor")? - row.try_get::<i64, _>("refunds_minor")?;
    if net <= 0 {
        return Err(AppError::Validation(
            "this line nets to nothing; there is nothing to post".into(),
        ));
    }
    // PPN is ignored for now (owner decision, 25 Sep), and 0377 removes the
    // `vat_out` map: the whole net is revenue and no VAT line is built.
    let vat = 0i64;
    let _ = vat_rate_bps;
    let label = if method == "EWALLET" {
        "E-wallet"
    } else {
        "QRIS"
    };
    // The day happened at the shop; its takings are in the books of the unit
    // that owns it.
    let unit = super::sites::unit_of_site(pool, &site_id).await?;
    let memo = format!("{label} {bank} takings (exception resolved)");
    let lines = vec![
        {
            let mut line =
                PostingLine::debit("card_receivable_debit", &unit, net).with_qualifier(&bank);
            line.memo = Some(memo.clone());
            line
        },
        {
            let mut line =
                PostingLine::credit("revenue_debit", &unit, net - vat).with_qualifier(&bank);
            line.memo = Some(format!("{label} {bank} sales"));
            line
        },
    ];
    let _ = vat;
    let intent = PostingIntent {
        posting_date: business_date,
        source_kind: "SALE_DAY_EXCEPTION".into(),
        source_id: Some(exception_id.to_string()),
        rule_version: "sale_day_exception/1".into(),
        currency,
        memo: Some(format!("{memo} {site_id} {business_date}")),
        lines,
    };
    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, None, actor).await?;
    let side = LedgerSide {
        semantic_key: "card_receivable_debit",
        qualifier: bank.clone(),
        debit_minor: net,
        credit_minor: 0,
        memo,
    };
    sales_posting_open_receivables(
        &mut tx,
        posting_id,
        &format!("EXCEPTION_{exception_id}"),
        &unit,
        business_date,
        posted.entry_id,
        std::slice::from_ref(&side),
        actor,
    )
    .await?;
    sqlx::query(
        "UPDATE sales_posting_exception
            SET status = 'RESOLVED', resolved_bank = $2, journal_entry_id = $3,
                resolved_by = $4, resolved_at = now()
          WHERE exception_id = $1 AND status = 'OPEN'",
    )
    .bind(exception_id)
    .bind(&bank)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    sales_posting_detail(pool, posting_id).await
}

/// Generate for every shop and day that traded and has no document yet.
///
/// The brief for this asked for "every site and day with a closed shift".
/// Shifts are not in Postgres — the till keeps them in SQLite and nothing
/// syncs them up — so the sweep is over days that have takings instead, which
/// is the same set for every shop that closes properly and a superset for one
/// that does not. When shifts arrive, this is the query to narrow.
///
/// A day that refuses is recorded and the sweep continues. One shop with an
/// unmappable acquirer must not stop the other twelve from closing their
/// month.
pub async fn sales_posting_generate_days(
    pool: &PgPool,
    request: &GenerateSalesDaysRequest,
    actor: &str,
) -> Result<Vec<GeneratedDay>, AppError> {
    let site = request
        .site_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);

    // Both populations, shifted to the shop's own clock, so a day here is the
    // day a shop would recognise.
    let days = sqlx::query(
        "SELECT site_id, business_date FROM (
             SELECT site_id, business_date FROM edge_sale
             UNION
             SELECT site_id,
                    site_local_date(completed_at, site_id) AS business_date
               FROM sale WHERE status = 'COMPLETED'
         ) days
          WHERE ($1::text IS NULL OR site_id = $1)
            AND ($2::date IS NULL OR business_date >= $2)
            AND ($3::date IS NULL OR business_date <= $3)
          GROUP BY site_id, business_date
          ORDER BY business_date, site_id",
    )
    .bind(site.as_deref())
    .bind(request.from)
    .bind(request.to)
    .fetch_all(pool)
    .await?;

    let mut outcomes = Vec::with_capacity(days.len());
    for row in &days {
        let site_id: String = row.try_get("site_id")?;
        let business_date: NaiveDate = row.try_get("business_date")?;
        let ask = GenerateSalesPostingRequest {
            site_id: site_id.clone(),
            business_date,
        };
        match sales_posting_generate(pool, &ask, actor).await {
            Ok(document) => outcomes.push(GeneratedDay {
                site_id,
                business_date,
                outcome: "GENERATED".into(),
                posting_id: Some(document.posting.posting_id),
                gross_minor: document.posting.gross_minor,
            }),
            Err(AppError::Conflict(message)) => outcomes.push(GeneratedDay {
                site_id,
                business_date,
                outcome: message,
                posting_id: None,
                gross_minor: 0,
            }),
            Err(AppError::Validation(message)) => outcomes.push(GeneratedDay {
                site_id,
                business_date,
                outcome: message,
                posting_id: None,
                gross_minor: 0,
            }),
            Err(other) => return Err(other),
        }
    }
    Ok(outcomes)
}

// ---------------------------------------------------------------------------
// The Payment Ledger side
// ---------------------------------------------------------------------------

/// The meanings whose balance is somebody's debt rather than a total.
///
/// A general ledger account answers "how much are we owed on cards"; it cannot
/// answer "which of Tuesday's batches has BCA still not paid", because a
/// balance is a sum and the question is about items. That is what the Payment
/// Ledger is for, and these are the keys that belong in it: each one is an
/// amount a NAMED party owes, which clears when that party settles.
///
/// `voucher_liability` is deliberately absent even though it is also somebody
/// else's money. A gift card is owed to a customer who may never come back,
/// not to a counterparty who sends a settlement file, and there is no party to
/// open an item against.
const RECEIVABLE_KEYS: &[&str] = &[
    "card_receivable_debit",
    "card_receivable_credit",
    // Keep the retired key readable while legacy QRIS items remain open.
    "qris_receivable",
];

/// What a day's takings are filed under in the Payment Ledger.
const DAY_VOUCHER_KIND: &str = "SALE_DAY";
/// What moving one tender to another acquirer is filed under.
const RETENDER_VOUCHER_KIND: &str = "RETENDER";

/// How a day's takings are named in the Payment Ledger.
///
/// The posting id AND the attempt, because a day is not a document that posts
/// once: the only correction path this ledger has is to reverse a posted day,
/// generate it again over the same `posting_id` and post the new figures, so
/// one document legitimately carries several entries. 0140 named the entries
/// `ATTEMPT_n` for exactly that reason and this uses the same name, so an item
/// belongs to the entry that raised it rather than to a document that has
/// raised two. Without it a re-posted day would find its first attempt's item
/// sitting there cancelled, get it handed back by `ple_open`'s idempotence, and
/// leave the books carrying a receivable the ledger had stopped following.
fn day_voucher(posting_id: Uuid, purpose: &str) -> String {
    format!("{posting_id}/{purpose}")
}

/// Whose books a takings side posts in.
///
/// Two of the day's meanings are promises the company itself holds, not the
/// shop: output tax is owed to the tax office (`2201`), and a voucher is owed
/// to a customer (`2401`). The chart scopes both `dimension = 'company'` —
/// they post in head office's books and `balanced_per_unit` bridges the two
/// units with the affiliate accounts. Every other side posts in the books of
/// the unit that owns the shop where the day happened (`sites::unit_of_site`).
/// Placing either leg in the store's books makes the day unpostable, which is
/// the one outcome a posting rule may never cause.
fn posting_unit(day_unit: &str, semantic_key: &str, head_office: &str) -> String {
    match semantic_key {
        // The company's bank accounts are head office's; a shop's card
        // takings land there and the poster pairs the two units' books.
        "vat_out" | "voucher_liability" | "bank_giro" => head_office.to_string(),
        _ => day_unit.to_string(),
    }
}

/// Open one Payment Ledger item per acquirer receivable this day created.
///
/// One item per line whose meaning is somebody's debt, named by the acquirer
/// the line was qualified by. It takes the transaction that wrote the journal
/// because the two have to be one act: a ledger saying BCA owes 2,220,000 with
/// no open item behind it is a figure nobody can chase, and an open item with
/// no journal line behind it is a debt the books do not carry.
///
/// The mirror is `acquirer::acq_settlement_settle_ledger_items`, which closes
/// these when the acquirer pays — same key, same qualifier, same party — so the
/// pair is one item's life rather than two modules' guesses about one debt.
///
/// A card line whose acquirer nobody recorded opens nothing and says so in the
/// log. There is no party to open an item against, and inventing one would put
/// a balance on an ageing report that names nobody; the books still carry the
/// receivable, and `payment_ledger_integrity` is where the two part company
/// visibly rather than quietly.
///
/// `unit_id` is the books the receivable was raised in — the unit owning the
/// shop — because the Payment Ledger is kept by the same key as the journal
/// (0608).
async fn sales_posting_open_receivables(
    tx: &mut Transaction<'_, Postgres>,
    posting_id: Uuid,
    purpose: &str,
    unit_id: &str,
    business_date: NaiveDate,
    journal_entry_id: Uuid,
    sides: &[LedgerSide],
    actor: &str,
) -> Result<(), AppError> {
    for side in sides
        .iter()
        .filter(|side| side.debit_minor > 0 && RECEIVABLE_KEYS.contains(&side.semantic_key))
    {
        if side.qualifier.is_empty() {
            tracing::warn!(
                unit = %unit_id,
                day = %business_date,
                key = side.semantic_key,
                "a card line with no acquirer on it: posted to the books, and no open item \
                 raised because there is nobody to raise it against"
            );
            continue;
        }
        payment_ledger::ple_open(
            tx,
            &payment_ledger::PaymentLedgerItem {
                account_key: side.semantic_key.to_string(),
                qualifier: side.qualifier.clone(),
                unit_id: unit_id.to_string(),
                party_type: payment_ledger::PaymentLedgerPartyType::Acquirer,
                party_id: side.qualifier.clone(),
                party_name: Some(side.qualifier.clone()),
                voucher_kind: DAY_VOUCHER_KIND.to_string(),
                voucher_id: day_voucher(posting_id, purpose),
                journal_entry_id,
                side: payment_ledger::PaymentLedgerSide::Receivable,
                amount_minor: side.debit_minor,
                currency: "IDR".to_string(),
                // Acquirers pay on their own terms and nothing here records
                // them, so it ages from the day it was earned rather than from
                // a date nobody agreed.
                due_date: None,
                posting_date: business_date,
            },
            actor,
        )
        .await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Posting and reversing
// ---------------------------------------------------------------------------

/// Post a generated day.
///
/// The document row and the journal are written in one transaction, for the
/// same reason `post_bill` does it: a day marked posted with no entry behind
/// it, or an entry with no day, are both states nobody could explain later.

/// The cost of what left the shelves on the day being posted.
///
/// FIFO over the cost layers the receipts wrote (`lane_i_cost_layer`), in the
/// same transaction as the takings entry. Deliberately its own `COGS_DAY`
/// entry rather than lines on the sale entry: the two have different rules
/// and different reasons to be reposted, and the sales rule posts no cost on
/// purpose -- this is the second half, not an amendment.
///
/// `source_id` carries the attempt (`{posting_id}:{ATTEMPT_n}`), so a day
/// that was reversed and regenerated consumes under a new key instead of
/// being read as the same consumption twice. Net of what was restocked by
/// returns taken back the same day: those goods never left the pool the
/// queue answers for.
async fn sales_posting_consume_cost(
    tx: &mut Transaction<'_, Postgres>,
    posting_id: Uuid,
    purpose: &str,
    site_id: &str,
    business_date: NaiveDate,
    actor: &str,
) -> Result<(), AppError> {
    let cogs_source = format!("{posting_id}:{purpose}");
    let quantities = sqlx::query(
        "WITH sold AS (
             SELECT sl.sku_id, SUM(sl.quantity)::bigint AS qty
               FROM sale s JOIN sale_line sl ON sl.sale_id = s.id
              WHERE s.status = 'COMPLETED' AND s.site_id = $1
                AND site_local_date(s.completed_at, $1) = $2
              GROUP BY sl.sku_id
             UNION ALL
             SELECT sk.id, SUM(el.quantity)::bigint
               FROM edge_sale e
               JOIN edge_sale_line el ON el.sale_id = e.sale_id
               JOIN (SELECT DISTINCT ON (sku_code) sku_code, id, article_id
                       FROM sku ORDER BY sku_code, active DESC) sk
                      ON sk.sku_code = el.sku_code
              WHERE e.site_id = $1
                AND e.status = 'COMPLETED'
                AND e.business_date = $2
              GROUP BY sk.id
         ), restocked AS (
             SELECT rl.sku_id, SUM(rl.quantity)::bigint AS qty
               FROM sale_return r JOIN sale_return_line rl ON rl.return_id = r.id
              WHERE r.site_id = $1 AND rl.restock
                AND site_local_date(r.created_at, $1) = $2
              GROUP BY rl.sku_id
         ), per_sku AS (
             SELECT COALESCE(so.sku_id, rs.sku_id) AS sku_id,
                    sk.article_id,
                    COALESCE(so.qty, 0) - COALESCE(rs.qty, 0) AS qty
               FROM sold so
               FULL JOIN restocked rs ON rs.sku_id = so.sku_id
               JOIN sku sk ON sk.id = COALESCE(so.sku_id, rs.sku_id)
         )
         -- One consumption per ARTICLE: `stock_ledger_consume` keys its replay
         -- and its posting purpose on the article, so a second SKU of the same
         -- article consumed separately was taken for a replay and never
         -- costed. The SKU is kept only when the article sold in one.
         SELECT article_id,
                CASE WHEN COUNT(DISTINCT sku_id) = 1
                     THEN (array_agg(sku_id))[1] END AS sku_id,
                SUM(qty)::bigint AS qty
           FROM per_sku
          WHERE qty > 0
          GROUP BY article_id",
    )
    .bind(site_id)
    .bind(business_date)
    .fetch_all(&mut **tx)
    .await?;
    // Where the goods stood: the site's floor, falling back to its warehouse
    // for a site with no floor of its own (the DC sells out of the warehouse
    // in this estate). Trace only -- costing reads the queue, not the pool --
    // but the FK still wants a pool that exists.
    let from_pool: String = sqlx::query_scalar(
        "SELECT id FROM operational_pool
          WHERE site_id = $1 AND group_code IN ('STORE_INVENTORY', 'WAREHOUSE')
          ORDER BY (group_code = 'STORE_INVENTORY') DESC, display_order
          LIMIT 1",
    )
    .bind(site_id)
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or_else(|| format!("{site_id}.warehouse"));
    for row in &quantities {
        let sku: Option<Uuid> = row.try_get("sku_id")?;
        let article: Uuid = row.try_get("article_id")?;
        let quantity: i64 = row.try_get("qty")?;
        let consumed = stock_ledger::stock_ledger_consume(
            tx,
            &StockOutflow {
                article_id: article,
                sku_id: sku,
                epc: None,
                lot_reference: None,
                quantity,
                event_kind: "SALE".into(),
                event_id: cogs_source.clone(),
                from_pool_id: from_pool.clone(),
                site_id: site_id.to_string(),
                economic_date: business_date,
                source_id: cogs_source.clone(),
                memo: Some(format!("HPP {site_id} {business_date}")),
            },
            actor,
        )
        .await;
        // Short stock never stops the sales day (owner decision 2, stage 5):
        // the units the layers cannot answer are costed at the SKU's last
        // known receipt cost, flagged "cost pending", and trued up when the
        // receipt lands.
        match consumed {
            Ok(_) => {}
            Err(AppError::Validation(reason)) => {
                stock_ledger::cost_pending_post(
                    tx,
                    article,
                    quantity,
                    site_id,
                    business_date,
                    &format!("{cogs_source}:{article}"),
                    &reason,
                    actor,
                )
                .await?;
            }
            Err(other) => return Err(other),
        }
    }
    Ok(())
}

/// Put back what a reversed day consumed.
///
/// The journal side is the ordinary mirror. The stock side is compensating
/// `stock_ledger_entry` rows that return each allocation to the layer it came
/// from, so the FIFO queue a regenerated day draws on is the queue the
/// reversal left behind, not a shorter one.
async fn sales_posting_unconsume_cost(
    tx: &mut Transaction<'_, Postgres>,
    posting_id: Uuid,
    posting_date: NaiveDate,
    reason: &str,
    actor: &str,
) -> Result<(), AppError> {
    let sources: Vec<(Uuid, String)> = sqlx::query(
        // Only the attempts still standing: a day reversed and posted again
        // keeps its earlier attempts' COGS entries (ATTEMPT_1 …), already
        // mirrored, and a second mirror of one of them is refused.
        "SELECT j.entry_id, j.source_id FROM journal_entry j
          WHERE j.source_kind = 'COGS_DAY' AND j.source_id LIKE $1 || ':%'
            AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.reversal_of = j.entry_id)",
    )
    .bind(posting_id.to_string())
    .fetch_all(&mut **tx)
    .await?
    .iter()
    .map(|row| Ok((row.try_get("entry_id")?, row.try_get("source_id")?)))
    .collect::<Result<_, AppError>>()?;
    for (entry_id, source) in &sources {
        let reversal = reverse(tx, *entry_id, posting_date, reason, actor).await?;
        // One COGS entry per SKU, and every one of them carries the day's
        // `source_id` — so the rows to put back are the ones THIS entry
        // posted, not every row of the source. Reading by source unwound the
        // whole day once per entry and the second pass hit the unique
        // (idempotency_key, line_number): a reversal of any day with more
        // than one SKU sold failed with a 500.
        let originals = sqlx::query(
            "SELECT entry_id, article_id, sku_id, epc, lot_reference, from_pool_id,
                    site_id, quantity, cost_layer_id, valuation_rate_minor, economic_date
               FROM stock_ledger_entry
              WHERE source_kind = 'COGS_DAY' AND source_id = $1 AND journal_entry_id = $2
              ORDER BY line_number",
        )
        .bind(source)
        .bind(entry_id)
        .fetch_all(&mut **tx)
        .await?;
        let group = Uuid::new_v4();
        for (index, original) in originals.iter().enumerate() {
            let quantity: i64 = original.try_get("quantity")?;
            let rate: i64 = original.try_get("valuation_rate_minor")?;
            let value = quantity * rate;
            sqlx::query(
                "INSERT INTO stock_ledger_entry
                   (entry_id, posting_group_id, line_number, article_id, sku_id, epc,
                    lot_reference, from_pool_id, to_pool_id, site_id, quantity, qty_delta,
                    qty_after,
                    cost_layer_id, valuation_rate_minor, stock_value_difference_minor,
                    stock_value_after_minor, event_kind, source_kind, source_id,
                    economic_date, journal_entry_id, idempotency_key, actor)
                 SELECT $1, $2, $3, article_id, sku_id, epc, lot_reference, NULL,
                        from_pool_id, site_id, quantity, quantity, qty_after + quantity,
                        cost_layer_id, valuation_rate_minor, $4,
                        stock_value_after_minor + $4,
                        'SALE', 'COGS_DAY_UNWIND', source_id, $5, $6,
                        idempotency_key || ':unwind', $7
                   FROM stock_ledger_entry WHERE entry_id = $8",
            )
            .bind(Uuid::new_v4())
            .bind(group)
            .bind(index as i32 + 1)
            .bind(value)
            .bind(posting_date)
            .bind(reversal.entry_id)
            .bind(actor)
            .bind(original.try_get::<Uuid, _>("entry_id")?)
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

pub async fn sales_posting_post(
    pool: &PgPool,
    posting_id: Uuid,
    actor: &str,
) -> Result<SalesPostingDocument, AppError> {
    let existing = sales_posting_detail(pool, posting_id).await?;
    if existing.posting.status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "{} {} is already {}; correct it by reversing, not by posting twice",
            existing.posting.site_id,
            existing.posting.business_date,
            existing.posting.status.to_lowercase()
        )));
    }

    // Rebuilt from the day rather than from the document's own figures. The
    // document is a working paper; the sales are the fact. If a late sale has
    // landed since it was generated, posting the stale figures would put a
    // number in the books that no query reproduces.
    let reading = read_day(
        pool,
        &existing.posting.site_id,
        existing.posting.business_date,
    )
    .await?;
    let built =
        build_with(&reading.figures, day_rules(pool).await?).map_err(AppError::Validation)?;
    let unchanged = reading.gross_minor == existing.posting.gross_minor
        && reading.untendered_minor == existing.posting.untendered_minor
        && reading.sale_count == existing.posting.sale_count
        && reading.figures.discount_minor == existing.posting.discount_minor
        && reading.figures.returns_minor == existing.posting.returns_minor
        && reading.figures.vat_rate_bps == existing.posting.vat_rate_bps
        && built.receipts_minor == existing.posting.settled_minor
        && built.vat_minor == existing.posting.vat_minor
        && built.revenue_minor == existing.posting.revenue_minor;
    if !unchanged {
        return Err(AppError::Conflict(format!(
            "{} {} has changed since it was generated — a late sale, a return, or a \
             retender — so what would post is not what was reviewed. Generate it again.",
            existing.posting.site_id, existing.posting.business_date
        )));
    }

    // The day is a shop's; its lines are in the books of the unit owning the
    // shop, and the company's own promises in head office's (`posting_unit`).
    let head_office = super::sites::head_office_unit_id(pool).await?;
    let day_unit = super::sites::unit_of_site(pool, &existing.posting.site_id).await?;
    let lines: Vec<PostingLine> = built
        .sides
        .iter()
        .map(|side| {
            let unit = posting_unit(&day_unit, side.semantic_key, &head_office);
            let mut line = if side.debit_minor > 0 {
                PostingLine::debit(side.semantic_key, &unit, side.debit_minor)
            } else {
                PostingLine::credit(side.semantic_key, &unit, side.credit_minor)
            };
            if !side.qualifier.is_empty() {
                line = line.with_qualifier(&side.qualifier);
            }
            line.memo = Some(side.memo.clone());
            line
        })
        .collect();

    let intent = PostingIntent {
        posting_date: existing.posting.business_date,
        source_kind: "SALE_DAY".into(),
        source_id: Some(posting_id.to_string()),
        rule_version: RULE_VERSION.into(),
        currency: existing.posting.currency.clone(),
        memo: Some(format!(
            "Takings {} {}",
            existing.posting.site_id, existing.posting.business_date
        )),
        lines,
    };

    let mut tx = pool.begin().await?;
    // Which attempt this is. A day is not a document that posts once: the only
    // correction path this ledger has is to reverse a posted day, generate it
    // again over the same `posting_id`, and post the new figures — so one
    // document legitimately carries several entries and 0140 would read the
    // second as a repeat of the first.
    //
    // Counted rather than stored, because the entries ARE the record and a
    // column would be a second one to keep in step. Two callers racing both
    // read the same count and both name the same attempt; the unique index
    // refuses the loser, which is the guarantee — the count is only the name.
    let attempt: i64 = sqlx::query(
        "SELECT COUNT(*)::bigint AS n FROM journal_entry
          WHERE source_kind = 'SALE_DAY' AND source_id = $1",
    )
    .bind(posting_id.to_string())
    .fetch_one(&mut *tx)
    .await?
    .try_get("n")?;
    let purpose = format!("ATTEMPT_{}", attempt + 1);
    let posted = post(&mut tx, &intent, Some(&purpose), actor).await?;
    // What the acquirers now owe, as items rather than as a balance, in the
    // transaction that wrote the journal so the two can never disagree.
    sales_posting_open_receivables(
        &mut tx,
        posting_id,
        &purpose,
        &day_unit,
        existing.posting.business_date,
        posted.entry_id,
        &built.sides,
        actor,
    )
    .await?;
    // The cost of the day, out of the same transaction: revenue without cost
    // is half a day, and the two halves can never disagree once both are in
    // one commit.
    sales_posting_consume_cost(
        &mut tx,
        posting_id,
        &purpose,
        &existing.posting.site_id,
        existing.posting.business_date,
        actor,
    )
    .await?;
    sqlx::query(
        "UPDATE sales_posting
            SET status = 'POSTED', journal_entry_id = $2, posted_by = $3, posted_at = now()
          WHERE posting_id = $1 AND status = 'DRAFT'",
    )
    .bind(posting_id)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    sales_posting_detail(pool, posting_id).await
}

/// Unwind a posted day.
///
/// The reversal mirrors the original entry's own accounts rather than
/// resolving the meanings again — `poster::reverse` sees to that, and the
/// reason it matters here is the account map: an acquirer remapped since the
/// day was posted would otherwise send the reversal somewhere the original
/// never touched, leaving both wrong by the same amount while the trial
/// balance still balanced.
///
/// The document goes back to REVERSED, not to DRAFT. Generating over it is
/// then allowed again — the correction is a fresh document, and both entries
/// stay in the journal where an auditor can see the shop changed its mind.
pub async fn sales_posting_reverse(
    pool: &PgPool,
    posting_id: Uuid,
    request: &ReverseSalesPostingRequest,
    actor: &str,
) -> Result<SalesPostingDocument, AppError> {
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "a reversal needs a reason; it is the only record of why".into(),
        ));
    }
    let existing = sales_posting_detail(pool, posting_id).await?;
    let entry_id = match (
        existing.posting.status.as_str(),
        existing.posting.journal_entry_id,
    ) {
        ("POSTED", Some(entry_id)) => entry_id,
        (status, _) => {
            return Err(AppError::Conflict(format!(
                "{} {} is {}; only a posted day can be reversed",
                existing.posting.site_id,
                existing.posting.business_date,
                status.to_lowercase()
            )))
        }
    };

    let mut tx = pool.begin().await?;
    let reversal = reverse(
        &mut tx,
        entry_id,
        request
            .posting_date
            .unwrap_or(existing.posting.business_date),
        reason,
        actor,
    )
    .await?;
    // The items that attempt raised stop counting, in the same transaction as
    // the entry that takes them out of the books. Which attempt is read off the
    // entry being reversed rather than counted afresh: a day reversed, posted
    // again and reversed again must take out the second attempt's receivables
    // and leave the first's alone, and the entry is the only thing that knows
    // which is which.
    let purpose: String = sqlx::query("SELECT purpose FROM journal_entry WHERE entry_id = $1")
        .bind(entry_id)
        .fetch_one(&mut *tx)
        .await?
        .try_get("purpose")?;
    payment_ledger::ple_delink(
        &mut tx,
        DAY_VOUCHER_KIND,
        &day_voucher(posting_id, &purpose),
        reason,
        actor,
    )
    .await?;
    // And the cost the day took off the shelves goes back on them, the same
    // way the receivables above stop counting: in the same transaction as the
    // reversal, or the queue the regenerated day will draw on would be short
    // by exactly what this day consumed.
    sales_posting_unconsume_cost(
        &mut tx,
        posting_id,
        request
            .posting_date
            .unwrap_or(existing.posting.business_date),
        reason,
        actor,
    )
    .await?;
    sqlx::query(
        "UPDATE sales_posting
            SET status = 'REVERSED', reversal_entry_id = $2, reversed_by = $3,
                reversed_at = now(), reversal_reason = $4
          WHERE posting_id = $1 AND status = 'POSTED'",
    )
    .bind(posting_id)
    .bind(reversal.entry_id)
    .bind(actor)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    sales_posting_detail(pool, posting_id).await
}

// ---------------------------------------------------------------------------
// Retender
// ---------------------------------------------------------------------------

/// Which population a tender came from, and everything the correction needs.
struct FoundTender {
    source: &'static str,
    site_id: String,
    business_date: NaiveDate,
    method: String,
    acquirer: String,
    card_kind: Option<CardKind>,
    amount_minor: i64,
}

async fn find_tender(pool: &PgPool, tender_id: Uuid) -> Result<FoundTender, AppError> {
    let synced = sqlx::query(
        "SELECT s.site_id,
                s.business_date AS day,
                t.method, t.acquirer, t.reference, t.card_kind, t.amount_minor
           FROM edge_sale_tender t
           JOIN edge_sale s ON s.sale_id = t.sale_id
          WHERE t.tender_id = $1",
    )
    .bind(tender_id)
    .fetch_optional(pool)
    .await?;
    if let Some(row) = synced {
        let method: String = row.try_get("method")?;
        let acquirer = acquirer_of(
            &method,
            row.try_get::<Option<String>, _>("acquirer")?.as_deref(),
            row.try_get::<Option<String>, _>("reference")?.as_deref(),
        );
        return Ok(FoundTender {
            source: "EDGE",
            site_id: row.try_get("site_id")?,
            business_date: row.try_get("day")?,
            method,
            acquirer,
            card_kind: parse_card_kind(row.try_get("card_kind")?),
            amount_minor: row.try_get("amount_minor")?,
        });
    }

    let central = sqlx::query(
        "SELECT s.site_id,
                site_local_date(s.completed_at, s.site_id) AS day,
                p.method, p.acquirer, p.reference, p.card_kind, p.amount_minor
           FROM sale_payment p
           JOIN sale s ON s.id = p.sale_id
          WHERE p.id = $1 AND s.completed_at IS NOT NULL",
    )
    .bind(tender_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("tender {tender_id}")))?;
    let method: String = central.try_get("method")?;
    let acquirer = acquirer_of(
        &method,
        central.try_get::<Option<String>, _>("acquirer")?.as_deref(),
        central
            .try_get::<Option<String>, _>("reference")?
            .as_deref(),
    );
    Ok(FoundTender {
        source: "CENTRAL",
        site_id: central.try_get("site_id")?,
        business_date: central.try_get("day")?,
        method,
        acquirer,
        card_kind: parse_card_kind(central.try_get("card_kind")?),
        amount_minor: central.try_get("amount_minor")?,
    })
}

/// Move a settled tender to the acquirer or method that actually took it.
///
/// Two shapes, and which one applies is decided by one thing: whether the
/// day has been posted.
///
///   * Not posted — the tender row is corrected and the draft is regenerated.
///     Nothing in the books mentions it yet, so there is nothing to reverse.
///   * Posted — the tender row is corrected AND a reclassifying entry is
///     written, debiting the receivable that should have had it and crediting
///     the one that did. Editing alone would leave the ledger and the sale
///     disagreeing, and the journal is append-only precisely so that cannot
///     happen.
///
/// Both leave a row in `sale_tender_retender` saying who moved it and why.
pub async fn retender_tender(
    pool: &PgPool,
    tender_id: Uuid,
    request: &RetenderRequest,
    actor: &str,
) -> Result<RetenderOutcome, AppError> {
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "a retender needs a reason; the acquirer's own file will not explain it".into(),
        ));
    }
    let to_method = request.to_method.trim().to_ascii_uppercase();
    if !matches!(
        to_method.as_str(),
        "CASH" | "CARD" | "QRIS" | "EWALLET" | "VOUCHER" | "BENEFIT" | "OTHER"
    ) {
        return Err(AppError::Validation(format!(
            "{to_method:?} is not a tender method; use CASH, CARD, QRIS, VOUCHER or OTHER"
        )));
    }
    let to_acquirer = acquirer_of(&to_method, Some(request.to_acquirer.as_str()), None);
    let to_card_kind = parse_card_kind(request.to_card_kind.clone());
    if request.to_card_kind.is_some() && to_card_kind.is_none() {
        return Err(AppError::Validation(
            "a card kind is DEBIT or CREDIT, or nothing at all".into(),
        ));
    }

    let found = find_tender(pool, tender_id).await?;
    if found.method == to_method && found.acquirer == to_acquirer && found.card_kind == to_card_kind
    {
        return Err(AppError::Validation(
            "that tender is already recorded that way; a retender that moves nothing is \
             noise in the one place corrections are looked for"
                .into(),
        ));
    }

    let day = sqlx::query(
        "SELECT posting_id, status FROM sales_posting
          WHERE site_id = $1 AND business_date = $2",
    )
    .bind(&found.site_id)
    .bind(found.business_date)
    .fetch_optional(pool)
    .await?;
    let posted_day = day
        .as_ref()
        .map(|row| row.try_get::<String, _>("status"))
        .transpose()?
        .is_some_and(|status| status == "POSTED");

    let mut tx = pool.begin().await?;

    // The row moves either way. What differs is whether the books have to be
    // told as well.
    let moved = match found.source {
        "EDGE" => sqlx::query(
            "UPDATE edge_sale_tender
                SET method = $2, acquirer = NULLIF($3,''), card_kind = $4
              WHERE tender_id = $1",
        ),
        _ => sqlx::query(
            "UPDATE sale_payment
                SET method = $2, acquirer = NULLIF($3,''), card_kind = $4
              WHERE id = $1",
        ),
    }
    .bind(tender_id)
    .bind(&to_method)
    .bind(&to_acquirer)
    .bind(to_card_kind.map(CardKind::as_str))
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if moved != 1 {
        return Err(AppError::NotFound(format!("tender {tender_id}")));
    }

    // Named before the entry, because the entry's step is this move. A tender
    // can be moved again — CARD to QRIS today, QRIS to CASH tomorrow — and
    // both moves carry the tender as their source, so keyed on the document
    // alone the second would be refused as a repeat of the first. See 0140.
    let retender_id = Uuid::new_v4();
    let purpose = format!("MOVED_{}", retender_id.simple().to_string().to_uppercase());

    let mut journal_entry_id = None;
    let mut entry_number = None;
    if posted_day {
        let (from_key, from_qualifier) =
            receivable_of(&found.method, found.card_kind, &found.acquirer)?;
        let (to_key, to_qualifier) = receivable_of(&to_method, to_card_kind, &to_acquirer)?;
        // The tender was rung at a shop; the receivable it raised is in the
        // books of the unit that owns the shop, which is where it moves.
        let head_office = super::sites::head_office_unit_id(&mut *tx).await?;
        let day_unit = super::sites::unit_of_site(&mut *tx, &found.site_id).await?;
        // Only the asset side moves. The income was earned either way and the
        // VAT was charged either way; what was wrong was which counterparty
        // owes the money.
        let intent = PostingIntent {
            posting_date: found.business_date,
            source_kind: "RETENDER".into(),
            source_id: Some(tender_id.to_string()),
            rule_version: RETENDER_RULE_VERSION.into(),
            currency: "IDR".into(),
            memo: Some(format!(
                "Retender {} {} -> {} {}: {reason}",
                found.method, found.acquirer, to_method, to_acquirer
            )),
            lines: vec![
                {
                    let unit = posting_unit(&day_unit, to_key, &head_office);
                    let mut line = PostingLine::debit(to_key, &unit, found.amount_minor);
                    if !to_qualifier.is_empty() {
                        line = line.with_qualifier(&to_qualifier);
                    }
                    line
                },
                {
                    let unit = posting_unit(&day_unit, from_key, &head_office);
                    let mut line = PostingLine::credit(from_key, &unit, found.amount_minor);
                    if !from_qualifier.is_empty() {
                        line = line.with_qualifier(&from_qualifier);
                    }
                    line
                },
            ],
        };
        let posted = post(&mut tx, &intent, Some(&purpose), actor).await?;
        // The open item moves with the money, and it moves as one act. The
        // entry above debits the receivable that should have had it and credits
        // the one that did; settling the acquirer who never took it and opening
        // an item against the acquirer who did is the same pair of legs said in
        // the ledger's own words. Opening without settling would leave one
        // evening's card takings owed by two banks at once.
        if RECEIVABLE_KEYS.contains(&from_key) && !from_qualifier.is_empty() {
            payment_ledger::ple_settle_claim(
                &mut tx,
                &payment_ledger::PaymentLedgerClaim {
                    account_key: from_key,
                    qualifier: &from_qualifier,
                    unit_id: &day_unit,
                    party_type: payment_ledger::PaymentLedgerPartyType::Acquirer,
                    party_id: &from_qualifier,
                    // Whatever of that acquirer's is still open, oldest first.
                    // A tender is moved days after the evening it was rung and
                    // the day it came from may already be part settled.
                    voucher_kind: None,
                    voucher_id: None,
                },
                RETENDER_VOUCHER_KIND,
                &retender_id.to_string(),
                posted.entry_id,
                found.business_date,
                found.amount_minor,
                actor,
            )
            .await?;
        }
        if RECEIVABLE_KEYS.contains(&to_key) && !to_qualifier.is_empty() {
            payment_ledger::ple_open(
                &mut tx,
                &payment_ledger::PaymentLedgerItem {
                    account_key: to_key.to_string(),
                    qualifier: to_qualifier.clone(),
                    unit_id: day_unit.clone(),
                    party_type: payment_ledger::PaymentLedgerPartyType::Acquirer,
                    party_id: to_qualifier.clone(),
                    party_name: Some(to_qualifier.clone()),
                    voucher_kind: RETENDER_VOUCHER_KIND.to_string(),
                    voucher_id: retender_id.to_string(),
                    journal_entry_id: posted.entry_id,
                    side: payment_ledger::PaymentLedgerSide::Receivable,
                    amount_minor: found.amount_minor,
                    currency: "IDR".to_string(),
                    due_date: None,
                    // The evening it was rung, not the day somebody noticed.
                    // The debt is as old as the sale.
                    posting_date: found.business_date,
                },
                actor,
            )
            .await?;
        }
        journal_entry_id = Some(posted.entry_id);
        entry_number = Some(posted.entry_number);
    }

    sqlx::query(
        "INSERT INTO sale_tender_retender
           (retender_id, tender_id, tender_source, site_id, business_date,
            from_method, from_acquirer, from_card_kind,
            to_method, to_acquirer, to_card_kind,
            amount_minor, reason, journal_entry_id, actor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
    )
    .bind(retender_id)
    .bind(tender_id)
    .bind(found.source)
    .bind(&found.site_id)
    .bind(found.business_date)
    .bind(&found.method)
    .bind(&found.acquirer)
    .bind(found.card_kind.map(CardKind::as_str))
    .bind(&to_method)
    .bind(&to_acquirer)
    .bind(to_card_kind.map(CardKind::as_str))
    .bind(found.amount_minor)
    .bind(reason)
    .bind(journal_entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let next = if posted_day {
        "the day was already posted, so the receivable has been reclassified; the \
         document's working paper still shows the old split until it is regenerated"
            .to_string()
    } else {
        "the day is not posted; generate it again to pick this up".to_string()
    };

    Ok(RetenderOutcome {
        retender_id,
        tender_id,
        tender_source: found.source.to_string(),
        site_id: found.site_id,
        business_date: found.business_date,
        amount_minor: found.amount_minor,
        from_method: found.method,
        from_acquirer: found.acquirer,
        to_method,
        to_acquirer,
        journal_entry_id,
        entry_number,
        next,
    })
}

/// The asset a tender of this shape became, and what narrows it.
fn receivable_of(
    method: &str,
    card_kind: Option<CardKind>,
    acquirer: &str,
) -> Result<(&'static str, String), AppError> {
    let kind = if method == "CARD" {
        Some(classify_card(card_kind, acquirer).0)
    } else {
        None
    };
    match (method, kind) {
        ("CASH", _) => Ok(("cash", String::new())),
        ("CARD", Some(CardKind::Debit)) => Ok(("card_receivable_debit", acquirer.to_string())),
        ("CARD", Some(CardKind::Credit)) => Ok(("card_receivable_credit", acquirer.to_string())),
        ("QRIS" | "EWALLET", _) => Ok(("card_receivable_debit", acquirer.to_string())),
        // Free vouchers are a sales discount on the day (owner decision 13).
        ("VOUCHER", _) => Ok(("sales_discount", String::new())),
        // So is the employee benefit balance (owner, 1 Oct 2026).
        ("BENEFIT", _) => Ok(("sales_discount", String::new())),
        (other, _) => Err(AppError::Validation(format!(
            "tender method {other:?} has no account behind it, so a posted day cannot be \
             reclassified into or out of it"
        ))),
    }
}
