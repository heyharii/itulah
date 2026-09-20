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
//! The shop's own, at `DEFAULT_UTC_OFFSET_MINUTES`. A sale rung at 23:40 in
//! Jakarta belongs to that day even though it is already tomorrow in UTC, and
//! truncating a `timestamptz` would use whatever the server's timezone happens
//! to be set to. Same reading `reports.rs` uses, deliberately: a day that
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
use crate::cloud::application::AppError;
use crate::cloud::domain::sales_posting::{
    build, classify_card, CardKind, DayFigures, LedgerSide, RecordedVat, TenderBucket,
};
use crate::reporting::DEFAULT_UTC_OFFSET_MINUTES;
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
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
    pub discount_minor: i64,
    pub returns_minor: i64,
    /// PPN taken, less PPN unwound by returns.
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
    pub discount_minor: i64,
    pub vat_minor: i64,
    pub tender_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SalesPostingDocument {
    pub posting: SalesPosting,
    pub lines: Vec<SalesPostingLine>,
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
fn day_window(business_date: NaiveDate) -> (DateTime<Utc>, DateTime<Utc>) {
    let midnight = business_date.and_time(NaiveTime::MIN);
    let start = Utc
        .from_utc_datetime(&(midnight - Duration::minutes(i64::from(DEFAULT_UTC_OFFSET_MINUTES))));
    (start, start + Duration::hours(24))
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
        "CARD" | "QRIS" | "OTHER" => acquirer
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
          WHERE site_id = $1 AND occurred_at >= $2 AND occurred_at < $3",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
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
    let (start, end) = day_window(business_date);
    let mut buckets = Buckets::default();

    // ── the fleet's own tills, synced up ────────────────────────────────────
    let synced = sqlx::query(
        "SELECT COUNT(*)::bigint AS sale_count,
                COALESCE(SUM(total_minor),0)::bigint AS gross_minor,
                COALESCE(SUM(change_minor),0)::bigint AS change_minor,
                COALESCE(SUM(discount_total_minor),0)::bigint AS discount_minor
           FROM edge_sale
          WHERE site_id = $1 AND occurred_at >= $2 AND occurred_at < $3",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;
    let mut sale_count: i64 = synced.try_get("sale_count")?;
    let mut gross: i64 = synced.try_get("gross_minor")?;
    let mut change: i64 = synced.try_get("change_minor")?;
    let discount: i64 = synced.try_get("discount_minor")?;

    let mut tendered: i64 = 0;
    let synced_tenders = sqlx::query(
        "SELECT t.method, t.acquirer, t.reference, t.card_kind,
                COALESCE(SUM(t.amount_minor),0)::bigint AS amount_minor,
                COUNT(*)::bigint AS tender_count
           FROM edge_sale_tender t
           JOIN edge_sale s ON s.sale_id = t.sale_id
          WHERE s.site_id = $1 AND s.occurred_at >= $2 AND s.occurred_at < $3
          GROUP BY t.method, t.acquirer, t.reference, t.card_kind",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;
    for row in &synced_tenders {
        let method: String = row.try_get("method")?;
        let amount: i64 = row.try_get("amount_minor")?;
        let acquirer = acquirer_of(
            &method,
            row.try_get::<Option<String>, _>("acquirer")?.as_deref(),
            row.try_get::<Option<String>, _>("reference")?.as_deref(),
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
        "SELECT p.method, p.acquirer, p.reference, p.card_kind,
                COALESCE(SUM(p.amount_minor),0)::bigint AS amount_minor,
                COUNT(*)::bigint AS tender_count
           FROM sale_payment p
           JOIN sale s ON s.id = p.sale_id
          WHERE s.site_id = $1 AND s.status = 'COMPLETED'
            AND s.completed_at >= $2 AND s.completed_at < $3
          GROUP BY p.method, p.acquirer, p.reference, p.card_kind",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;
    for row in &central_tenders {
        let method: String = row.try_get("method")?;
        let amount: i64 = row.try_get("amount_minor")?;
        let acquirer = acquirer_of(
            &method,
            row.try_get::<Option<String>, _>("acquirer")?.as_deref(),
            row.try_get::<Option<String>, _>("reference")?.as_deref(),
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
    for row in &refund_rows {
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
    let untendered = (expected - tendered).max(0);

    let recorded_vat = read_recorded_vat(pool, site_id, start, end).await?;

    Ok(DayReading {
        figures: DayFigures {
            buckets: buckets.into_vec(untendered - change)?,
            discount_minor: discount,
            returns_minor: returns,
            vat_rate_bps: day_vat_rate_bps(pool).await?,
            recorded_vat,
        },
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

    Ok(SalesPostingDocument { posting, lines })
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
    let posting = build(&reading.figures).map_err(AppError::Validation)?;

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
             SELECT site_id,
                    ((occurred_at AT TIME ZONE 'UTC') + make_interval(mins => $4))::date
                        AS business_date
               FROM edge_sale
             UNION
             SELECT site_id,
                    ((completed_at AT TIME ZONE 'UTC') + make_interval(mins => $4))::date
                        AS business_date
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
    .bind(DEFAULT_UTC_OFFSET_MINUTES)
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
async fn sales_posting_open_receivables(
    tx: &mut Transaction<'_, Postgres>,
    posting_id: Uuid,
    purpose: &str,
    site_id: &str,
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
                site = %site_id,
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
                site_id: site_id.to_string(),
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
    let built = build(&reading.figures).map_err(AppError::Validation)?;
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

    let lines: Vec<PostingLine> = built
        .sides
        .iter()
        .map(|side| {
            let mut line = if side.debit_minor > 0 {
                PostingLine::debit(
                    side.semantic_key,
                    &existing.posting.site_id,
                    side.debit_minor,
                )
            } else {
                PostingLine::credit(
                    side.semantic_key,
                    &existing.posting.site_id,
                    side.credit_minor,
                )
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
        &existing.posting.site_id,
        existing.posting.business_date,
        posted.entry_id,
        &built.sides,
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
                ((s.occurred_at AT TIME ZONE 'UTC') + make_interval(mins => $2))::date AS day,
                t.method, t.acquirer, t.reference, t.card_kind, t.amount_minor
           FROM edge_sale_tender t
           JOIN edge_sale s ON s.sale_id = t.sale_id
          WHERE t.tender_id = $1",
    )
    .bind(tender_id)
    .bind(DEFAULT_UTC_OFFSET_MINUTES)
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
                ((s.completed_at AT TIME ZONE 'UTC') + make_interval(mins => $2))::date AS day,
                p.method, p.acquirer, p.reference, p.card_kind, p.amount_minor
           FROM sale_payment p
           JOIN sale s ON s.id = p.sale_id
          WHERE p.id = $1 AND s.completed_at IS NOT NULL",
    )
    .bind(tender_id)
    .bind(DEFAULT_UTC_OFFSET_MINUTES)
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
        "CASH" | "CARD" | "QRIS" | "VOUCHER" | "OTHER"
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
                    let mut line = PostingLine::debit(to_key, &found.site_id, found.amount_minor);
                    if !to_qualifier.is_empty() {
                        line = line.with_qualifier(&to_qualifier);
                    }
                    line
                },
                {
                    let mut line =
                        PostingLine::credit(from_key, &found.site_id, found.amount_minor);
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
                    site_id: &found.site_id,
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
                    site_id: found.site_id.clone(),
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
        ("QRIS", _) => Ok(("qris_receivable", acquirer.to_string())),
        ("VOUCHER", _) => Ok(("voucher_liability", String::new())),
        // The same pairing `domain::sales_posting::meanings_for` gives it:
        // OTHER is a receivable from whoever the reference names, never a
        // refusal — a day containing one must still post.
        ("OTHER", _) => Ok(("other_receivable", acquirer.to_string())),
        (other, _) => Err(AppError::Validation(format!(
            "tender method {other:?} has no account behind it, so a posted day cannot be \
             reclassified into or out of it"
        ))),
    }
}
