//! A campaign as a thing that can be answered for: what it runs, where it was
//! meant to run, what it must not cross, and whether it did what it was for.
//!
//! `commercial.rs` holds the campaign as a PRICING object — a row in a
//! published book, with a window, a budget and a switch, dispatched to every
//! till. That is the half a shop needs. This is the other half, and it lives at
//! the centre and reaches no shop at all: the activities somebody planned, the
//! reach somebody declared, the lines somebody said it must not cross, and the
//! score against the campaign it was supposed to beat. Migrations 0161, 0173
//! and 0174 argue the split in full; the short form is that changing a target
//! must never reprice thirteen shops.
//!
//! ## Three rules this module keeps
//!
//! **It measures with the dashboard's own arithmetic, never its own.** Every
//! figure here comes from `performance::campaign_performance` — the same read
//! that draws the tiles. A second fold over `edge_sale_promotion` would agree
//! with the first on every ordinary day and part company from it on the day a
//! guardrail fires, which is the one day the two numbers must be the same
//! number. The cost of that is a whole-estate aggregate for a one-campaign
//! question, and it is the right trade until somebody proves otherwise with a
//! timing.
//!
//! **It divides by days as late as it possibly can.** "Per day" is how two
//! campaigns of different lengths are compared at all — the owner's point about
//! Lebaran moving eleven days a year is exactly this — but integer division
//! truncates, and a target missed by a rupiah must be missed rather than
//! rounded into success. So every COMPARISON multiplies the line by the days
//! instead of dividing the reading by them, in `i128` so nothing can overflow,
//! and the divided figure is computed once at the end for DISPLAY only.
//!
//! **It never enforces at a till.** See 0174. A guardrail is measured here from
//! the facts that have arrived here, and the only action it can take is to pull
//! the lever `commercial::switch_campaign` already provides. Everything a shop
//! knows is behind, and no amount of cleverness here changes that.

use super::performance::{campaign_performance_of, campaign_sell_through, PerformanceWindow};
use crate::cloud::application::{AppError, CampaignSwitchRequest};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{postgres::PgRow, PgPool, Row};
use uuid::Uuid;

// ── what a campaign declares ────────────────────────────────────────────────

/// One thing a campaign RUNS.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignActivityRow {
    pub activity_id: Uuid,
    pub campaign_id: String,
    /// `PROMOTION`, `MARKDOWN`, `COUPON_SET`, `PLACEMENT` or `MESSAGE`.
    pub kind: String,
    pub name: String,
    /// The rule id, markdown id or coupon code this points at, in the id space
    /// its kind names. Null for the two kinds that exist nowhere else in this
    /// database — a poster and an email are this row and nothing more.
    pub ref_id: Option<String>,
    pub status: String,
    pub starts_on: Option<NaiveDate>,
    pub ends_on: Option<NaiveDate>,
    /// What running it cost — printing, a mailing list, an agency. Never the
    /// discount it gave away: that is measured from the tills and booking the
    /// two together would make a poster and a price cut the same kind of money.
    pub cost_minor: Option<i64>,
    pub detail: Option<String>,
    /// Whether a published book agrees that this thing belongs to this
    /// campaign. `None` for the kinds no book could ever carry.
    ///
    /// The interesting value is `Some(false)`: an activity claiming a rule that
    /// the books file under another campaign or under none. That rule's takings
    /// are attributed elsewhere in every report, so a campaign that believes it
    /// owns the rule is reading somebody else's numbers.
    pub declared_in_book: Option<bool>,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
}

/// What a caller states about one activity. The id is in the path, so a second
/// PUT to it is an edit rather than a duplicate.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignActivityInput {
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub starts_on: Option<NaiveDate>,
    #[serde(default)]
    pub ends_on: Option<NaiveDate>,
    #[serde(default)]
    pub cost_minor: Option<i64>,
    #[serde(default)]
    pub detail: Option<String>,
}

/// One line of a declared reach: a dimension and one value in it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignScopeEntry {
    /// `SITE`, `CHANNEL`, `SEGMENT`, `DIVISION`, `ARTICLE` or `TAG`.
    pub dimension: String,
    pub value: String,
}

/// What the campaign says it reaches, beside what its book actually binds.
///
/// Two different kinds of fact — a decision and an enforcement — and the
/// interesting thing about them is where they disagree. Nothing here reconciles
/// them: reconciling would mean either rewriting a published book or quietly
/// rewriting what somebody decided.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignScopeView {
    pub declared: Vec<CampaignScopeEntry>,
    /// `commercial_campaign.site_ids` from the newest published book that
    /// carries this campaign. Null means the book narrows nothing, which the
    /// engine reads as every shop.
    pub binding_site_ids: Option<Vec<String>>,
    /// Declared shops the book does not bind. The campaign runs in these only
    /// because nothing stops it — or, when the book names a narrower list, does
    /// not run in them at all.
    pub declared_not_bound: Vec<String>,
    /// Shops the book binds that nobody declared. A campaign reaching a shop
    /// that was never in the plan is how a poster ends up in a window that was
    /// not part of the campaign.
    pub bound_not_declared: Vec<String>,
}

/// A line the campaign must not cross.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignGuardrailRow {
    pub guardrail_id: Uuid,
    pub campaign_id: String,
    /// `SPEND_MINOR`, `SPEND_PER_DAY_MINOR`, `DISCOUNT_RATE_BPS`,
    /// `MARGIN_BPS` or `AVERAGE_BASKET_MINOR`.
    pub measure: String,
    /// Decided by the measure and stored beside it, so a breach read months
    /// later says which way the line was crossed without a lookup in the
    /// source. The database holds the two in agreement.
    pub direction: String,
    pub threshold: i64,
    /// `WARN` or `PAUSE_CAMPAIGN`.
    pub breach_action: String,
    pub active: bool,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
}

/// A line as a caller states it. No direction: it follows from the measure, and
/// a caller who could send it could send one that contradicts the measure.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignGuardrailInput {
    pub measure: String,
    pub threshold: i64,
    /// `WARN` when absent: a rail that stops a running campaign is not the
    /// default anybody should get by omitting a field.
    #[serde(default)]
    pub breach_action: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
    #[serde(default)]
    pub note: Option<String>,
}

/// A rail, its current reading, and whether it has been crossed.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignGuardrailReading {
    pub guardrail_id: Uuid,
    pub measure: String,
    pub direction: String,
    pub threshold: i64,
    pub breach_action: String,
    pub active: bool,
    /// The measured figure, in the measure's own unit. `None` where it cannot
    /// be computed — no sale, no basket, no cost on file — and a rail with no
    /// reading is never breached.
    pub observed: Option<i64>,
    /// True only where a reading exists and is on the wrong side of the line.
    pub breached: bool,
    /// Why there is no reading, for the screen that has to say something other
    /// than a dash.
    pub note: Option<String>,
}

/// A crossing, as it was seen.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignBreachRow {
    pub breach_id: Uuid,
    pub guardrail_id: Uuid,
    pub campaign_id: String,
    pub measure: String,
    /// The line as it stood WHEN IT WAS CROSSED. A rail raised afterwards — the
    /// ordinary response to crossing one — does not rewrite this.
    pub threshold: i64,
    pub observed: i64,
    pub window_from: DateTime<Utc>,
    pub window_to: DateTime<Utc>,
    pub first_seen_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub seen_count: i32,
    /// `WARNED`, `PAUSED` or `PAUSE_FAILED`.
    pub action_taken: String,
    pub detail: Option<String>,
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub acknowledged_by: Option<String>,
}

/// Everything a campaign declares, in one read.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignPlanView {
    pub campaign_id: String,
    pub activities: Vec<CampaignActivityRow>,
    pub scope: CampaignScopeView,
    pub guardrails: Vec<CampaignGuardrailRow>,
    /// Crossings nobody has acknowledged yet, newest first.
    pub open_breaches: Vec<CampaignBreachRow>,
    /// Rules the published books file under this campaign that no activity
    /// claims. The campaign is running them either way — this is the list
    /// somebody has to look at before saying what the campaign did.
    pub undeclared_rule_ids: Vec<String>,
}

/// The declarations that are replaced whole rather than edited row by row.
///
/// Scope and guardrails are documents: six shops and two rails are one
/// decision, and PATCHing a shop out of a list is how half a decision gets
/// written. Activities are not — each has a life, an id and a status — so they
/// keep their own routes.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignPlanInput {
    pub scope: Vec<CampaignScopeEntry>,
    pub guardrails: Vec<CampaignGuardrailInput>,
}

// ── what a campaign did ─────────────────────────────────────────────────────

/// The dates a campaign is read over, and the two day counts that make two
/// campaigns comparable.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignWindowView {
    /// As the book states them. Either may be absent.
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_to: Option<DateTime<Utc>>,
    /// What was actually measured. Never later than now: a campaign that runs
    /// until December is read up to today, because reading to December would
    /// divide what has happened by days that have not.
    pub measured_from: DateTime<Utc>,
    pub measured_to: DateTime<Utc>,
    /// Days the campaign has actually had. Zero before it starts, which is why
    /// every per-day figure is optional.
    pub days_elapsed: i64,
    /// Days it was given, where both ends are stated. A screen says "day 9 of
    /// 30" from these two, and a comparison says whether it is reading a
    /// finished campaign or a running one.
    pub days_planned: Option<i64>,
    /// False when the campaign states no dates at all and the last thirty days
    /// were used — a figure over an unstated period is the kind that ends up in
    /// a slide.
    pub dated: bool,
}

/// The per-day figures, for display.
///
/// Money only. A count divided by days is nearly always nought — nineteen sales
/// over thirty days is not "0 sales a day" — so counts are reported whole
/// beside the day count and divided by nobody. No comparison in this module
/// reads these: they are the truncated end of an arithmetic that was already
/// done exactly.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignPerDayView {
    pub spend_minor: i64,
    pub benefit_minor: i64,
    pub basket_revenue_minor: i64,
}

/// What the tills say the campaign did, over the window above.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignReadingView {
    /// What its promotions discounted.
    pub benefit_minor: i64,
    /// What its markdowns gave up. A different kind of money from the line
    /// above and never added to it by the report that draws them.
    pub clearance_minor: i64,
    /// The two together: what the campaign chose not to take. This IS the sum,
    /// and it is a guardrail's business rather than a dashboard's — a rail
    /// against "how much has this cost us" has to count both or it stops
    /// watching a campaign the moment it becomes a clearance.
    pub spend_minor: i64,
    pub basket_revenue_minor: i64,
    pub sale_count: i64,
    pub units: i64,
    pub cost_minor: i64,
    /// How many of the units a purchase price was found for. Gross profit and
    /// margin are estimates in proportion to this.
    pub costed_units: i64,
    pub customer_count: i64,
    pub new_customer_count: i64,
    /// Promo sales over the baskets they came from. `None` with no basket.
    pub average_basket_minor: Option<i64>,
    /// Discount over revenue, in basis points. `None` with no revenue.
    ///
    /// The denominator is INFLUENCED revenue — the whole of every basket an
    /// offer touched, which is how this estate attributes and it overstates. So
    /// this rate reads LOWER than the discount actually given on the goods that
    /// were discounted. A rail set on it is lenient, not strict, and it stays
    /// that way until `edge_sale_promotion_line` has a reader.
    pub discount_rate_bps: Option<i64>,
    /// Revenue less cost over revenue, in basis points. `None` when no unit had
    /// a cost on file: revenue less a cost of nought is revenue, and under the
    /// word "margin" that is the most flattering figure on the page, produced
    /// by the absence of data rather than by trading.
    pub margin_bps: Option<i64>,
    pub per_day: Option<CampaignPerDayView>,
}

/// Where the campaign stands against the line it was given.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignTargetScore {
    pub objective: String,
    pub success_metric: String,
    /// `REACH`, `KEEP_BELOW`, `REACH_PER_DAY`, `BEAT_BASELINE` or `STAY_WITHIN`.
    pub target_model: String,
    pub target_direction: String,
    pub target_value: i64,
    pub target_value_upper: Option<i64>,
    /// The reading, in the unit the metric is measured in. For `REACH_PER_DAY`
    /// this is the per-day figure; for everything else it is the total.
    pub current: Option<i64>,
    /// The line the reading is judged against, in the same unit — which for
    /// `BEAT_BASELINE` is a number computed from the precedent campaign and
    /// exists nowhere in the database.
    pub line: Option<i64>,
    pub line_upper: Option<i64>,
    /// `None` for "cannot say", which a screen must draw as neither met nor
    /// missed. A campaign with nothing measured is not failing.
    pub met: Option<bool>,
    /// How far along, in basis points of the line, capped at 10000. A ceiling
    /// fills as it is CONSUMED and a floor as it is reached; the same bar reads
    /// correctly both ways only because the two are computed differently.
    pub progress_bps: Option<i64>,
    /// Why it cannot be scored, when it cannot.
    pub note: Option<String>,
    /// What somebody wrote beside the objective. Carried on the score rather
    /// than left to a second read of `campaign_intent`: the panel that draws
    /// this draws the sentence under it, and two requests for one card is the
    /// N+1 the promotions screen already documents as its worst feature.
    pub notes: Option<String>,
}

/// The campaign this one is read against, over ITS OWN dates.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignBaselineView {
    pub campaign_id: String,
    pub name: Option<String>,
    pub window: CampaignWindowView,
    pub reading: CampaignReadingView,
    /// Whether the two windows have day counts, which is what makes anything
    /// except the totals comparable.
    pub comparable: bool,
    /// Promo sales per day against the precedent's, in basis points of it.
    /// 1200 is "twelve per cent better a day". `None` where either side has no
    /// days or the precedent took nothing.
    pub revenue_per_day_bps: Option<i64>,
    /// The same for what was given away. Lower is better here, and the screen
    /// has to know that or it congratulates an overspend.
    pub spend_per_day_bps: Option<i64>,
    pub note: Option<String>,
}

/// One campaign, scored.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignOutcomeView {
    pub campaign_id: String,
    pub name: Option<String>,
    pub status: Option<String>,
    pub as_of: DateTime<Utc>,
    pub window: CampaignWindowView,
    pub reading: CampaignReadingView,
    /// `None` where nobody has stated an objective — which is the finding, not
    /// an error: it is exactly the campaign somebody should be asked to justify
    /// or delete.
    pub target: Option<CampaignTargetScore>,
    pub baseline: Option<CampaignBaselineView>,
    pub guardrails: Vec<CampaignGuardrailReading>,
    /// Stock-side reading, asked for only when the target needs it.
    pub sell_through_bps: Option<i64>,
}

/// What the model columns are set to. Nothing else on the intent row is touched
/// here — see `save_campaign_target`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignTargetInput {
    pub target_model: String,
    #[serde(default)]
    pub target_value_upper: Option<i64>,
}

/// What one run of the rails did.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GuardrailCheckReport {
    pub campaign_id: String,
    pub checked_at: DateTime<Utc>,
    pub window_from: DateTime<Utc>,
    pub window_to: DateTime<Utc>,
    pub readings: Vec<CampaignGuardrailReading>,
    /// The breaches that are open after this run, whether they were opened by
    /// it or were already standing.
    pub breaches: Vec<CampaignBreachRow>,
    /// True where a rail said `PAUSE_CAMPAIGN` and the campaign was stopped by
    /// this run. A campaign already paused is not paused again.
    pub paused: bool,
    /// What the dispatch of that pause said, reported rather than allowed to
    /// fail the check: a fleet with no shop registered is a legitimate state,
    /// and refusing to record a breach because there was nobody to tell would
    /// lose the finding as well as the instruction.
    ///
    /// `unknown` on the wire, the spelling `CollaborationEvent.payload`
    /// already uses: a dispatch report is whatever the sync layer said, so
    /// there is no one type to declare, and `unknown` makes the browser look
    /// before it reads. `any` would let a screen quietly print `undefined`.
    #[cfg_attr(feature = "ts", ts(type = "unknown"))]
    pub dispatch: Option<Value>,
}

// ── vocabulary ──────────────────────────────────────────────────────────────

const ACTIVITY_KINDS: &[&str] = &[
    "PROMOTION",
    "MARKDOWN",
    "COUPON_SET",
    "PLACEMENT",
    "MESSAGE",
];
const ACTIVITY_STATUSES: &[&str] = &["PLANNED", "LIVE", "DONE", "DROPPED"];
const SCOPE_DIMENSIONS: &[&str] = &["SITE", "CHANNEL", "SEGMENT", "DIVISION", "ARTICLE", "TAG"];
const GUARDRAIL_MEASURES: &[&str] = &[
    "SPEND_MINOR",
    "SPEND_PER_DAY_MINOR",
    "DISCOUNT_RATE_BPS",
    "MARGIN_BPS",
    "AVERAGE_BASKET_MINOR",
];
const BREACH_ACTIONS: &[&str] = &["WARN", "PAUSE_CAMPAIGN"];
const TARGET_MODELS: &[&str] = &[
    "REACH",
    "KEEP_BELOW",
    "REACH_PER_DAY",
    "BEAT_BASELINE",
    "STAY_WITHIN",
];

/// The metrics that ADD UP over days, and can therefore be divided by them.
///
/// Average basket and sell-through are already rates. "Average basket per day"
/// is not a smaller number, it is not a number — and a model that divided it
/// anyway would produce a target that falls as a campaign runs longer.
const ADDITIVE_METRICS: &[&str] = &[
    "PROMO_SALES",
    "DISCOUNT_GIVEN",
    "GROSS_PROFIT",
    "UNITS_SOLD",
    "NEW_CUSTOMERS",
];

/// One of a closed set, or a message naming what was allowed.
///
/// Checked here rather than left to the column constraint for the reason
/// `commercial.rs` gives: a constraint refused at the database is a 500 and a
/// typo in a form is a 422.
fn one_of(field: &str, value: &str, allowed: &[&str]) -> Result<String, AppError> {
    let upper = value.trim().to_ascii_uppercase();
    if allowed.contains(&upper.as_str()) {
        Ok(upper)
    } else {
        Err(AppError::Validation(format!(
            "{field} must be one of {}, not {:?}",
            allowed.join(", "),
            value
        )))
    }
}

/// Which side of a guardrail's line is the wrong side, from the measure alone.
///
/// The database holds the same rule as a CHECK. Both exist on purpose: this one
/// produces the value, and the constraint is what catches any other writer.
fn guardrail_direction(measure: &str) -> &'static str {
    match measure {
        "MARGIN_BPS" | "AVERAGE_BASKET_MINOR" => "AT_LEAST",
        _ => "AT_MOST",
    }
}

fn required(field: &str, value: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{field} is required")));
    }
    Ok(trimmed.to_string())
}

fn clean(value: Option<&String>) -> Option<String> {
    value
        .map(|one| one.trim())
        .filter(|one| !one.is_empty())
        .map(str::to_string)
}

// ── the plan: what it runs, where, and what it must not cross ───────────────

fn activity_row(row: &PgRow, declared: Option<bool>) -> CampaignActivityRow {
    CampaignActivityRow {
        activity_id: row.get("activity_id"),
        campaign_id: row.get("campaign_id"),
        kind: row.get("kind"),
        name: row.get("name"),
        ref_id: row.get("ref_id"),
        status: row.get("status"),
        starts_on: row.get("starts_on"),
        ends_on: row.get("ends_on"),
        cost_minor: row.get("cost_minor"),
        detail: row.get("detail"),
        declared_in_book: declared,
        created_at: row.get("created_at"),
        created_by: row.get("created_by"),
    }
}

fn guardrail_row(row: &PgRow) -> CampaignGuardrailRow {
    CampaignGuardrailRow {
        guardrail_id: row.get("guardrail_id"),
        campaign_id: row.get("campaign_id"),
        measure: row.get("measure"),
        direction: row.get("direction"),
        threshold: row.get("threshold"),
        breach_action: row.get("breach_action"),
        active: row.get("active"),
        note: row.get("note"),
        created_at: row.get("created_at"),
        created_by: row.get("created_by"),
    }
}

fn breach_row(row: &PgRow) -> CampaignBreachRow {
    CampaignBreachRow {
        breach_id: row.get("breach_id"),
        guardrail_id: row.get("guardrail_id"),
        campaign_id: row.get("campaign_id"),
        measure: row.get("measure"),
        threshold: row.get("threshold"),
        observed: row.get("observed"),
        window_from: row.get("window_from"),
        window_to: row.get("window_to"),
        first_seen_at: row.get("first_seen_at"),
        last_seen_at: row.get("last_seen_at"),
        seen_count: row.get("seen_count"),
        action_taken: row.get("action_taken"),
        detail: row.get("detail"),
        acknowledged_at: row.get("acknowledged_at"),
        acknowledged_by: row.get("acknowledged_by"),
    }
}

/// The rule ids the published books file under this campaign.
///
/// `DISTINCT ON` because the newest book that names a rule owns it — the same
/// rule a shop applies when it replaces on `rule_id`, and without it a rule
/// restated in three books appears three times.
async fn rules_in_books(pool: &PgPool, campaign_id: &str) -> Result<Vec<String>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT ON (r.rule_id) r.rule_id
           FROM commercial_rule r
           JOIN commercial_publication p ON p.id = r.publication_id
          WHERE p.status = 'PUBLISHED'
            AND r.definition->>'campaign_id' = $1
          ORDER BY r.rule_id, p.version DESC",
    )
    .bind(campaign_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(|row| row.get::<String, _>(0)).collect())
}

/// The markdown ids the published books file under this campaign.
async fn markdowns_in_books(pool: &PgPool, campaign_id: &str) -> Result<Vec<String>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT ON (m.markdown_id) m.markdown_id
           FROM commercial_markdown m
           JOIN commercial_publication p ON p.id = m.publication_id
          WHERE p.status = 'PUBLISHED' AND m.campaign_id = $1
          ORDER BY m.markdown_id, p.version DESC",
    )
    .bind(campaign_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(|row| row.get::<String, _>(0)).collect())
}

/// The campaign as the newest published book states it.
///
/// `None` where no published book carries it, which is a real state: a campaign
/// can be planned here before it is priced anywhere.
async fn published_campaign(pool: &PgPool, campaign_id: &str) -> Result<Option<PgRow>, AppError> {
    Ok(sqlx::query(
        "SELECT DISTINCT ON (c.campaign_id)
                c.campaign_id, c.name, c.status, c.valid_from, c.valid_to,
                c.budget_minor, c.site_ids
           FROM commercial_campaign c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED' AND c.campaign_id = $1
          ORDER BY c.campaign_id, p.version DESC",
    )
    .bind(campaign_id)
    .fetch_optional(pool)
    .await?)
}

/// Everything the campaign declares, plus the two drifts worth seeing.
pub async fn campaign_plan(pool: &PgPool, campaign_id: &str) -> Result<CampaignPlanView, AppError> {
    let campaign_id = required("campaign_id", campaign_id)?;

    // Seven reads that each need only the id, so they run together: awaited in
    // turn, the plan tab cost seven round trips back to back.
    let activities = async {
        Ok::<_, AppError>(
            sqlx::query(
                "SELECT * FROM campaign_activity
                  WHERE campaign_id = $1
                  ORDER BY COALESCE(starts_on, DATE '9999-12-31'), created_at, activity_id",
            )
            .bind(&campaign_id)
            .fetch_all(pool)
            .await?,
        )
    };
    let scope_rows = async {
        Ok::<_, AppError>(
            sqlx::query(
                "SELECT dimension, value FROM campaign_scope
                  WHERE campaign_id = $1 ORDER BY dimension, value",
            )
            .bind(&campaign_id)
            .fetch_all(pool)
            .await?,
        )
    };
    let guardrails = async {
        Ok::<_, AppError>(
            sqlx::query("SELECT * FROM campaign_guardrail WHERE campaign_id = $1 ORDER BY measure")
                .bind(&campaign_id)
                .fetch_all(pool)
                .await?,
        )
    };
    let breaches = async {
        Ok::<_, AppError>(
            sqlx::query(
                "SELECT * FROM campaign_guardrail_breach
                  WHERE campaign_id = $1 AND acknowledged_at IS NULL
                  ORDER BY first_seen_at DESC",
            )
            .bind(&campaign_id)
            .fetch_all(pool)
            .await?,
        )
    };
    let (activities, rule_ids, markdown_ids, scope_rows, published, guardrails, breaches) = tokio::try_join!(
        activities,
        rules_in_books(pool, &campaign_id),
        markdowns_in_books(pool, &campaign_id),
        scope_rows,
        published_campaign(pool, &campaign_id),
        guardrails,
        breaches,
    )?;

    let activities: Vec<CampaignActivityRow> = activities
        .iter()
        .map(|row| {
            let kind: String = row.get("kind");
            let reference: Option<String> = row.get("ref_id");
            // Only the two kinds a book can carry are answerable. A poster is
            // not "missing from the book"; there is no book it could be in.
            let declared = match (kind.as_str(), reference.as_deref()) {
                ("PROMOTION", Some(id)) => Some(rule_ids.iter().any(|one| one == id)),
                ("MARKDOWN", Some(id)) => Some(markdown_ids.iter().any(|one| one == id)),
                _ => None,
            };
            activity_row(row, declared)
        })
        .collect();

    let claimed: Vec<&str> = activities
        .iter()
        .filter(|one| one.kind == "PROMOTION")
        .filter_map(|one| one.ref_id.as_deref())
        .collect();
    let undeclared_rule_ids: Vec<String> = rule_ids
        .iter()
        .filter(|id| !claimed.contains(&id.as_str()))
        .cloned()
        .collect();

    let declared: Vec<CampaignScopeEntry> = scope_rows
        .iter()
        .map(|row| CampaignScopeEntry {
            dimension: row.get("dimension"),
            value: row.get("value"),
        })
        .collect();

    let binding_site_ids: Option<Vec<String>> =
        published.and_then(|row| row.get::<Option<Vec<String>>, _>("site_ids"));

    let declared_sites: Vec<String> = declared
        .iter()
        .filter(|one| one.dimension == "SITE")
        .map(|one| one.value.clone())
        .collect();
    // An absent or empty binding list narrows nothing, so every declared shop
    // is reached and none of them is "not bound" — the campaign is simply wider
    // than it was declared to be, which is the other list.
    let (declared_not_bound, bound_not_declared) = match binding_site_ids.as_ref() {
        Some(bound) if !bound.is_empty() => (
            declared_sites
                .iter()
                .filter(|one| !bound.contains(one))
                .cloned()
                .collect(),
            bound
                .iter()
                .filter(|one| !declared_sites.contains(one))
                .cloned()
                .collect(),
        ),
        _ => (Vec::new(), Vec::new()),
    };

    Ok(CampaignPlanView {
        campaign_id,
        activities,
        scope: CampaignScopeView {
            declared,
            binding_site_ids,
            declared_not_bound,
            bound_not_declared,
        },
        guardrails: guardrails.iter().map(guardrail_row).collect(),
        open_breaches: breaches.iter().map(breach_row).collect(),
        undeclared_rule_ids,
    })
}

/// Restate the reach and the rails, whole.
///
/// One transaction, and the old rows go first: a declaration is what somebody
/// currently says, and merging a new statement into an old one is how a shop
/// nobody meant to include survives three edits.
///
/// A guardrail that is already there keeps its id and its history — the rails
/// are matched on `(campaign_id, measure)`, which is the key the table is
/// unique on, so raising a ceiling does not orphan the breach that made
/// somebody raise it.
pub async fn save_campaign_plan(
    pool: &PgPool,
    campaign_id: &str,
    input: CampaignPlanInput,
    actor: &str,
) -> Result<CampaignPlanView, AppError> {
    let campaign_id = required("campaign_id", campaign_id)?;
    let actor = required("actor", actor)?;

    let mut scope = Vec::with_capacity(input.scope.len());
    for entry in &input.scope {
        let dimension = one_of("dimension", &entry.dimension, SCOPE_DIMENSIONS)?;
        let value = required("scope value", &entry.value)?;
        scope.push((dimension, value));
    }

    let mut rails = Vec::with_capacity(input.guardrails.len());
    for rail in &input.guardrails {
        let measure = one_of("measure", &rail.measure, GUARDRAIL_MEASURES)?;
        if rails
            .iter()
            .any(|(existing, _, _, _, _)| existing == &measure)
        {
            return Err(AppError::Validation(format!(
                "two limits on {measure} is a contradiction: decide which of the two numbers is the one"
            )));
        }
        if rail.threshold < 0 {
            return Err(AppError::Validation(
                "a limit cannot be negative".to_string(),
            ));
        }
        // A rate is basis points, and the mistake this shape invites is silent:
        // 20 typed for twenty per cent becomes 0.2%, the rail is crossed by the
        // first sale, and a campaign is paused on its first morning.
        if measure.ends_with("_BPS") && rail.threshold > 10_000 {
            return Err(AppError::Validation(format!(
                "{measure} is basis points and cannot exceed 10000 (100%)"
            )));
        }
        let action = match rail.breach_action.as_deref() {
            Some(value) => one_of("breach_action", value, BREACH_ACTIONS)?,
            None => "WARN".to_string(),
        };
        rails.push((
            measure,
            rail.threshold,
            action,
            rail.active.unwrap_or(true),
            clean(rail.note.as_ref()),
        ));
    }

    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM campaign_scope WHERE campaign_id = $1")
        .bind(&campaign_id)
        .execute(&mut *tx)
        .await?;
    for (dimension, value) in &scope {
        sqlx::query(
            "INSERT INTO campaign_scope(campaign_id, dimension, value, declared_by)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (campaign_id, dimension, value) DO NOTHING",
        )
        .bind(&campaign_id)
        .bind(dimension)
        .bind(value)
        .bind(&actor)
        .execute(&mut *tx)
        .await?;
    }

    // Rails the caller did not restate are gone, and their breaches go with
    // them: a breach is evidence about a line, and a line nobody holds any more
    // is not a thing to keep reporting against. The cascade is in 0174.
    let kept: Vec<String> = rails.iter().map(|(measure, ..)| measure.clone()).collect();
    sqlx::query(
        "DELETE FROM campaign_guardrail
          WHERE campaign_id = $1 AND NOT (measure = ANY($2))",
    )
    .bind(&campaign_id)
    .bind(&kept)
    .execute(&mut *tx)
    .await?;

    for (measure, threshold, action, active, note) in &rails {
        sqlx::query(
            "INSERT INTO campaign_guardrail
                 (guardrail_id, campaign_id, measure, direction, threshold,
                  breach_action, active, note, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (campaign_id, measure) DO UPDATE SET
                 threshold     = EXCLUDED.threshold,
                 breach_action = EXCLUDED.breach_action,
                 active        = EXCLUDED.active,
                 note          = EXCLUDED.note",
        )
        .bind(Uuid::new_v4())
        .bind(&campaign_id)
        .bind(measure)
        .bind(guardrail_direction(measure))
        .bind(threshold)
        .bind(action)
        .bind(active)
        .bind(note.as_deref())
        .bind(&actor)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    campaign_plan(pool, &campaign_id).await
}

/// Add a thing the campaign runs, or restate one.
///
/// The id comes from the caller so a retried request writes one activity rather
/// than two — the same reason every other write in this estate takes a key it
/// did not invent.
pub async fn save_campaign_activity(
    pool: &PgPool,
    campaign_id: &str,
    activity_id: Uuid,
    input: CampaignActivityInput,
    actor: &str,
) -> Result<CampaignActivityRow, AppError> {
    let campaign_id = required("campaign_id", campaign_id)?;
    let actor = required("actor", actor)?;
    let kind = one_of("kind", &input.kind, ACTIVITY_KINDS)?;
    let name = required("name", &input.name)?;
    let status = match input.status.as_deref() {
        Some(value) => one_of("status", value, ACTIVITY_STATUSES)?,
        None => "PLANNED".to_string(),
    };
    let reference = clean(input.ref_id.as_ref());
    // The two kinds that point at something have to point at it. An activity
    // that says "a promotion ran" and cannot say which one is a row that makes
    // the count of promotions right and every other question unanswerable.
    if matches!(kind.as_str(), "PROMOTION" | "MARKDOWN" | "COUPON_SET") && reference.is_none() {
        return Err(AppError::Validation(format!(
            "a {kind} activity has to name the thing it ran: ref_id is the rule id, markdown id or coupon code"
        )));
    }
    if let (Some(from), Some(to)) = (input.starts_on, input.ends_on) {
        if to < from {
            return Err(AppError::Validation(
                "an activity cannot end before it starts".to_string(),
            ));
        }
    }
    if input.cost_minor.is_some_and(|cost| cost < 0) {
        return Err(AppError::Validation(
            "cost_minor cannot be negative".to_string(),
        ));
    }
    // The same rule filed under one campaign twice is a double count in every
    // report drawn from this table, and 0174's partial index refuses it. Asked
    // here first so the answer is "activity X already runs that rule" rather
    // than a unique-violation 500 that names an index.
    if let Some(reference) = reference.as_deref() {
        let twin: Option<Uuid> = sqlx::query_scalar(
            "SELECT activity_id FROM campaign_activity
              WHERE campaign_id = $1 AND kind = $2 AND ref_id = $3 AND activity_id <> $4",
        )
        .bind(&campaign_id)
        .bind(&kind)
        .bind(reference)
        .bind(activity_id)
        .fetch_optional(pool)
        .await?;
        if let Some(twin) = twin {
            return Err(AppError::Conflict(format!(
                "{reference} is already filed under this campaign as activity {twin}"
            )));
        }
    }

    let row = sqlx::query(
        "INSERT INTO campaign_activity
             (activity_id, campaign_id, kind, name, ref_id, status,
              starts_on, ends_on, cost_minor, detail, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (activity_id) DO UPDATE SET
             kind       = EXCLUDED.kind,
             name       = EXCLUDED.name,
             ref_id     = EXCLUDED.ref_id,
             status     = EXCLUDED.status,
             starts_on  = EXCLUDED.starts_on,
             ends_on    = EXCLUDED.ends_on,
             cost_minor = EXCLUDED.cost_minor,
             detail     = EXCLUDED.detail
         WHERE campaign_activity.campaign_id = EXCLUDED.campaign_id
         RETURNING *",
    )
    .bind(activity_id)
    .bind(&campaign_id)
    .bind(&kind)
    .bind(&name)
    .bind(reference.as_deref())
    .bind(&status)
    .bind(input.starts_on)
    .bind(input.ends_on)
    .bind(input.cost_minor)
    .bind(clean(input.detail.as_ref()).as_deref())
    .bind(&actor)
    .fetch_optional(pool)
    .await?
    // The `WHERE` on the upsert is what makes this reachable: the id exists and
    // belongs to another campaign. Answering "not found" would send somebody
    // looking for a row that is there.
    .ok_or_else(|| {
        AppError::Conflict(format!(
            "activity {activity_id} already belongs to another campaign"
        ))
    })?;

    Ok(activity_row(&row, None))
}

/// Drop one.
///
/// Deleting rather than marking DROPPED, because the two mean different things:
/// DROPPED is "we planned it and did not run it", which belongs in the report,
/// and this is "it was never part of the campaign" — a typo, a wrong id, a
/// duplicate.
pub async fn delete_campaign_activity(
    pool: &PgPool,
    campaign_id: &str,
    activity_id: Uuid,
) -> Result<u64, AppError> {
    Ok(
        sqlx::query("DELETE FROM campaign_activity WHERE campaign_id = $1 AND activity_id = $2")
            .bind(campaign_id.trim())
            .bind(activity_id)
            .execute(pool)
            .await?
            .rows_affected(),
    )
}

/// Somebody has seen a crossing and taken responsibility for it.
///
/// Closing it is what lets the next one be recorded: 0174 keeps exactly one
/// open breach per rail, so an unacknowledged one hides everything after it.
pub async fn acknowledge_campaign_breach(
    pool: &PgPool,
    campaign_id: &str,
    breach_id: Uuid,
    actor: &str,
) -> Result<CampaignBreachRow, AppError> {
    let actor = required("actor", actor)?;
    let row = sqlx::query(
        "UPDATE campaign_guardrail_breach
            SET acknowledged_at = now(), acknowledged_by = $3
          WHERE campaign_id = $1 AND breach_id = $2 AND acknowledged_at IS NULL
          RETURNING *",
    )
    .bind(campaign_id.trim())
    .bind(breach_id)
    .bind(&actor)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(format!(
            "no open breach {breach_id} on campaign {campaign_id}"
        ))
    })?;
    Ok(breach_row(&row))
}

/// Set what the target line is measured against.
///
/// **This writes two columns and no others.** `objective`, `success_metric`,
/// `target_direction`, `target_value` and `baseline_campaign_id` belong to
/// `save_campaign_intent`, which has upserted the whole row since 0161. Two
/// routes upserting one row is how a target silently reverts to the value the
/// slower request happened to hold, so each column has exactly one writer.
pub async fn save_campaign_target(
    pool: &PgPool,
    campaign_id: &str,
    input: CampaignTargetInput,
) -> Result<Value, AppError> {
    let campaign_id = required("campaign_id", campaign_id)?;
    let model = one_of("target_model", &input.target_model, TARGET_MODELS)?;
    if input.target_value_upper.is_some_and(|upper| upper < 0) {
        return Err(AppError::Validation(
            "the upper end of a band cannot be negative".to_string(),
        ));
    }
    if model == "STAY_WITHIN" && input.target_value_upper.is_none() {
        return Err(AppError::Validation(
            "a band needs both ends: target_value is the floor, target_value_upper the ceiling"
                .to_string(),
        ));
    }

    // Read before writing, because three of the five models are only meaningful
    // against fields this route does not own. Refused here rather than left to
    // a CHECK constraint: the constraint would fire on the OTHER route's next
    // write — somebody clearing a baseline would get a 500 from a handler that
    // has never heard of target models.
    let stated = sqlx::query(
        "SELECT success_metric, target_value, baseline_campaign_id
           FROM campaign_intent WHERE campaign_id = $1",
    )
    .bind(&campaign_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::Conflict(format!(
            "campaign {campaign_id} has no objective yet, and a target model is how an objective's line is read. State what it is for first."
        ))
    })?;

    let metric: String = stated.get("success_metric");
    let floor: i64 = stated.get("target_value");
    let baseline: Option<String> = stated.get("baseline_campaign_id");

    if model == "REACH_PER_DAY" && !ADDITIVE_METRICS.contains(&metric.as_str()) {
        return Err(AppError::Validation(format!(
            "{metric} is already a rate, so a per-day target of it is not a smaller number — it is not a number. Use REACH, or measure something that adds up over days."
        )));
    }
    if model == "BEAT_BASELINE" && baseline.is_none() {
        return Err(AppError::Validation(
            "BEAT_BASELINE is a target relative to the campaign this one is read against, and none is named. Choose a precedent first — a per cent with nothing behind it is half a target.".to_string(),
        ));
    }
    if let (true, Some(upper)) = (model == "STAY_WITHIN", input.target_value_upper) {
        if upper <= floor {
            return Err(AppError::Validation(format!(
                "a band runs upwards: the ceiling ({upper}) has to be above the floor ({floor})"
            )));
        }
    }

    let row = sqlx::query(
        "UPDATE campaign_intent
            SET target_model = $2, target_value_upper = $3
          WHERE campaign_id = $1
          RETURNING campaign_id, target_model, target_value, target_value_upper",
    )
    .bind(&campaign_id)
    .bind(&model)
    .bind(input.target_value_upper)
    .fetch_one(pool)
    .await?;

    Ok(serde_json::json!({
        "campaign_id": row.get::<String, _>("campaign_id"),
        "target_model": row.get::<String, _>("target_model"),
        "target_value": row.get::<i64, _>("target_value"),
        "target_value_upper": row.get::<Option<i64>, _>("target_value_upper"),
    }))
}

// ── the outcome ─────────────────────────────────────────────────────────────

/// Days between two instants, never negative and never rounded up from nothing.
///
/// A campaign that started this morning has run one day, not none: dividing by
/// nought is the only outcome worse than dividing by a day that is not over.
fn days_between(from: DateTime<Utc>, to: DateTime<Utc>) -> i64 {
    if to <= from {
        return 0;
    }
    let hours = (to - from).num_hours();
    // Round to the nearest whole day rather than truncating. Twenty-three hours
    // is a day of trading, and truncation would report the campaign's first day
    // as nought days and every per-day figure on it as unreadable.
    ((hours + 12) / 24).max(1)
}

/// The dates one campaign is read over.
///
/// `valid_to` is clamped to now. A campaign that runs until December read to
/// December would divide what has happened by days that have not happened,
/// which is the arithmetic that makes every running campaign look like a
/// failure.
fn window_of(
    valid_from: Option<DateTime<Utc>>,
    valid_to: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> CampaignWindowView {
    let dated = valid_from.is_some() || valid_to.is_some();
    let measured_to = match valid_to {
        Some(to) if to < now => to,
        _ => now,
    };
    // Thirty days before the END rather than before today, for a campaign that
    // states when it finished and not when it began. Counting back from today
    // would produce a window entirely after the campaign was over and report a
    // campaign that traded well as one that did nothing.
    let measured_from = valid_from.unwrap_or(measured_to - Duration::days(30));
    let days_planned = match (valid_from, valid_to) {
        (Some(from), Some(to)) => Some(days_between(from, to)),
        _ => None,
    };
    CampaignWindowView {
        valid_from,
        valid_to,
        measured_from,
        measured_to,
        days_elapsed: days_between(measured_from, measured_to),
        days_planned,
        dated,
    }
}

fn int_of(row: &Value, key: &str) -> i64 {
    row.get(key).and_then(Value::as_i64).unwrap_or(0)
}

/// A ratio in basis points, truncated, with nothing per nothing left unsaid.
///
/// The same convention `performance::through` uses for sell-through: integer
/// arithmetic, truncating, and `None` rather than a zero that would read as a
/// measurement.
fn ratio_bps(part: i64, whole: i64) -> Option<i64> {
    if whole <= 0 {
        return None;
    }
    i64::try_from(i128::from(part) * 10_000 / i128::from(whole)).ok()
}

/// The campaign's row out of the dashboard's own aggregate.
///
/// `None` where the campaign appears in no published book and in no sale, which
/// is not the same as nought and is why the caller decides what to say about it.
fn row_for<'a>(body: &'a Value, campaign_id: &str) -> Option<&'a Value> {
    body.get("campaigns")?
        .as_array()?
        .iter()
        .find(|row| row.get("campaign_id").and_then(Value::as_str) == Some(campaign_id))
}

fn reading_of(row: Option<&Value>, days: i64) -> CampaignReadingView {
    let empty = Value::Null;
    let row = row.unwrap_or(&empty);
    let benefit = int_of(row, "benefit_minor");
    let clearance = int_of(row, "clearance_minor");
    let spend = benefit + clearance;
    let revenue = int_of(row, "basket_revenue_minor");
    let sales = int_of(row, "sale_count");
    let cost = int_of(row, "cost_minor");
    let costed = int_of(row, "costed_units");
    CampaignReadingView {
        benefit_minor: benefit,
        clearance_minor: clearance,
        spend_minor: spend,
        basket_revenue_minor: revenue,
        sale_count: sales,
        units: int_of(row, "units"),
        cost_minor: cost,
        costed_units: costed,
        customer_count: int_of(row, "customer_count"),
        new_customer_count: int_of(row, "new_customer_count"),
        average_basket_minor: if sales <= 0 {
            None
        } else {
            Some(revenue / sales)
        },
        discount_rate_bps: ratio_bps(benefit, revenue),
        // No cost on file means no margin, not a margin of one hundred per
        // cent. The `costed_units` beside it says how much of the basket the
        // estimate covers.
        margin_bps: if costed <= 0 {
            None
        } else {
            ratio_bps(revenue - cost, revenue)
        },
        per_day: if days <= 0 {
            None
        } else {
            Some(CampaignPerDayView {
                spend_minor: spend / days,
                benefit_minor: benefit / days,
                basket_revenue_minor: revenue / days,
            })
        },
    }
}

/// What a metric reads, from the two sources that between them hold all seven.
///
/// This is the ONLY place a metric name becomes a number. The browser had a
/// second copy of it — one per metric, reading the same aggregate — and a
/// dashboard that scores a target with different arithmetic from the guardrail
/// that pauses the campaign is two answers to one question. The browser keeps
/// the words; the arithmetic is here.
fn metric_reading(
    metric: &str,
    reading: &CampaignReadingView,
    sell_through_bps: Option<i64>,
) -> Option<i64> {
    match metric {
        "PROMO_SALES" => Some(reading.basket_revenue_minor),
        "DISCOUNT_GIVEN" => Some(reading.benefit_minor),
        "GROSS_PROFIT" => {
            if reading.costed_units <= 0 {
                None
            } else {
                Some(reading.basket_revenue_minor - reading.cost_minor)
            }
        }
        "UNITS_SOLD" => Some(reading.units),
        "AVERAGE_BASKET" => reading.average_basket_minor,
        "NEW_CUSTOMERS" => Some(reading.new_customer_count),
        "SELL_THROUGH" => sell_through_bps,
        _ => None,
    }
}

/// Where a reading stands against a line, as a proportion of it in basis
/// points.
fn progress_of(current: i64, line: i64) -> Option<i64> {
    if line <= 0 {
        return None;
    }
    ratio_bps(current, line).map(|share| share.clamp(0, 10_000))
}

/// One campaign's window, reading and score, with everything it was read from.
///
/// The window is the CAMPAIGN'S OWN and never the header's: "did Lebaran hit its
/// target" is asked over Lebaran's dates whatever today is, and scoring a
/// finished campaign against the last thirty days reports every past campaign
/// as a failure the month after it ended.
pub async fn campaign_outcome(
    pool: &PgPool,
    campaign_id: &str,
    site_id: Option<&str>,
) -> Result<CampaignOutcomeView, AppError> {
    let campaign_id = required("campaign_id", campaign_id)?;
    let now = Utc::now();

    let published = published_campaign(pool, &campaign_id).await?;
    let (name, status, valid_from, valid_to) = match &published {
        Some(row) => (
            Some(row.get::<String, _>("name")),
            Some(row.get::<String, _>("status")),
            row.get::<Option<DateTime<Utc>>, _>("valid_from"),
            row.get::<Option<DateTime<Utc>>, _>("valid_to"),
        ),
        None => (None, None, None, None),
    };
    let window = window_of(valid_from, valid_to, now);

    let intent = sqlx::query("SELECT * FROM campaign_intent WHERE campaign_id = $1")
        .bind(&campaign_id)
        .fetch_optional(pool)
        .await?;

    let reading = read_campaign(pool, &campaign_id, &window, site_id).await?;

    let metric: Option<String> = intent.as_ref().map(|row| row.get("success_metric"));
    // Asked only when something reads it. It joins the stock projection, which
    // every other figure here does without.
    let sell_through_bps = match metric.as_deref() {
        Some("SELL_THROUGH") if window.days_elapsed > 0 => {
            let scope = PerformanceWindow::resolve(
                Some(window.measured_from),
                Some(window.measured_to),
                site_id,
            )?;
            campaign_sell_through(pool, &campaign_id, &scope)
                .await?
                .get("sell_through_bps")
                .and_then(Value::as_i64)
        }
        _ => None,
    };

    let baseline_id: Option<String> = intent
        .as_ref()
        .and_then(|row| row.get::<Option<String>, _>("baseline_campaign_id"));
    let baseline = match baseline_id {
        Some(ref id) => Some(read_baseline(pool, id, &window, &reading, site_id).await?),
        None => None,
    };

    let target = intent.as_ref().map(|row| {
        score_target(
            stated_intent(row),
            &reading,
            &window,
            sell_through_bps,
            baseline.as_ref(),
        )
    });

    let rails =
        sqlx::query("SELECT * FROM campaign_guardrail WHERE campaign_id = $1 ORDER BY measure")
            .bind(&campaign_id)
            .fetch_all(pool)
            .await?;

    Ok(CampaignOutcomeView {
        campaign_id,
        name,
        status,
        as_of: now,
        guardrails: rails
            .iter()
            .map(|row| read_guardrail(&guardrail_row(row), &reading, &window))
            .collect(),
        window,
        reading,
        target,
        baseline,
        sell_through_bps,
    })
}

/// The tills' answer for one campaign over one window.
///
/// Through `campaign_performance` rather than a query of its own: see the
/// module note. A campaign that has not started yet is answered without asking
/// the database anything, because the window would run backwards and because
/// nought is the true answer.
async fn read_campaign(
    pool: &PgPool,
    campaign_id: &str,
    window: &CampaignWindowView,
    site_id: Option<&str>,
) -> Result<CampaignReadingView, AppError> {
    if window.days_elapsed <= 0 {
        return Ok(reading_of(None, 0));
    }
    let scope = PerformanceWindow::resolve(
        Some(window.measured_from),
        Some(window.measured_to),
        site_id,
    )?;
    let body = campaign_performance_of(pool, &scope, campaign_id).await?;
    Ok(reading_of(row_for(&body, campaign_id), window.days_elapsed))
}

/// The precedent campaign, read over ITS OWN dates.
///
/// This is the whole point of a campaign baseline rather than a period one.
/// Lebaran moves about eleven days earlier every year: the month before it is
/// ordinary trading, and the same calendar dates last year were not Lebaran.
/// Both of those comparisons are arithmetic that looks rigorous and answers
/// nothing. Which Lebaran is the precedent for this Lebaran is a judgement, and
/// it was recorded when the objective was.
async fn read_baseline(
    pool: &PgPool,
    baseline_id: &str,
    window: &CampaignWindowView,
    mine: &CampaignReadingView,
    site_id: Option<&str>,
) -> Result<CampaignBaselineView, AppError> {
    let now = Utc::now();
    let published = published_campaign(pool, baseline_id).await?;
    let (name, valid_from, valid_to) = match &published {
        Some(row) => (
            Some(row.get::<String, _>("name")),
            row.get::<Option<DateTime<Utc>>, _>("valid_from"),
            row.get::<Option<DateTime<Utc>>, _>("valid_to"),
        ),
        None => (None, None, None),
    };
    let their_window = window_of(valid_from, valid_to, now);
    let reading = read_campaign(pool, baseline_id, &their_window, site_id).await?;

    let comparable = window.days_elapsed > 0 && their_window.days_elapsed > 0;
    let note = if published.is_none() {
        Some(format!(
            "no published book carries {baseline_id} any more, so it is read over the last thirty days rather than over its own"
        ))
    } else if !comparable {
        Some("one of the two campaigns has no days to divide by yet".to_string())
    } else if reading.sale_count == 0 {
        Some(format!(
            "nothing was sold against {baseline_id} in its own window, so there is nothing to read this against"
        ))
    } else {
        None
    };

    Ok(CampaignBaselineView {
        campaign_id: baseline_id.to_string(),
        name,
        revenue_per_day_bps: per_day_change(
            mine.basket_revenue_minor,
            window.days_elapsed,
            reading.basket_revenue_minor,
            their_window.days_elapsed,
        ),
        spend_per_day_bps: per_day_change(
            mine.spend_minor,
            window.days_elapsed,
            reading.spend_minor,
            their_window.days_elapsed,
        ),
        window: their_window,
        reading,
        comparable,
        note,
    })
}

/// How much better a day than the precedent, in basis points of it.
///
/// Cross-multiplied rather than divided: `mine/my_days` against
/// `theirs/their_days` becomes `mine * their_days` against `theirs * my_days`,
/// which has no rounding in it at all. In `i128`, because the products are
/// rupiah times days times ten thousand and a campaign the size of a Lebaran
/// would overflow an `i64` in the last multiplication.
fn per_day_change(mine: i64, my_days: i64, theirs: i64, their_days: i64) -> Option<i64> {
    if my_days <= 0 || their_days <= 0 || theirs <= 0 {
        return None;
    }
    let ours = i128::from(mine) * i128::from(their_days);
    let base = i128::from(theirs) * i128::from(my_days);
    i64::try_from((ours - base) * 10_000 / base).ok()
}

/// The stated intent, off the row and into something with no database in it.
///
/// The scoring below is the only arithmetic in this module that is worth
/// locking in a test without a Postgres to hand, and a `PgRow` argument would
/// have made every one of those tests an integration test.
#[derive(Clone)]
struct StatedIntent {
    objective: String,
    metric: String,
    model: String,
    direction: String,
    value: i64,
    upper: Option<i64>,
    notes: Option<String>,
}

fn stated_intent(row: &PgRow) -> StatedIntent {
    StatedIntent {
        objective: row.get("objective"),
        metric: row.get("success_metric"),
        model: row.get("target_model"),
        direction: row.get("target_direction"),
        value: row.get("target_value"),
        upper: row.get("target_value_upper"),
        notes: row.get("notes"),
    }
}

/// Score the target the five ways it can be stated.
///
/// Every comparison here multiplies the line by the days rather than dividing
/// the reading by them. Integer division truncates, and a per-day target missed
/// by a rupiah has to be missed rather than rounded into success.
fn score_target(
    intent: StatedIntent,
    reading: &CampaignReadingView,
    window: &CampaignWindowView,
    sell_through_bps: Option<i64>,
    baseline: Option<&CampaignBaselineView>,
) -> CampaignTargetScore {
    let StatedIntent {
        objective,
        metric,
        model,
        direction,
        value,
        upper,
        notes,
    } = intent;
    let at_most = direction == "AT_MOST";

    let total = metric_reading(&metric, reading, sell_through_bps);
    let days = window.days_elapsed;

    let mut note = None;
    let (current, line, line_upper, met) = match model.as_str() {
        "REACH_PER_DAY" => match (total, days > 0) {
            (Some(total), true) => {
                let side = i128::from(total);
                let bar = i128::from(value) * i128::from(days);
                (
                    Some(total / days),
                    Some(value),
                    None,
                    Some(if at_most { side <= bar } else { side >= bar }),
                )
            }
            (Some(total), false) => {
                note = Some("the campaign has not started, so there is no day to divide by".into());
                (Some(total), Some(value), None, None)
            }
            (None, _) => (None, Some(value), None, None),
        },
        "BEAT_BASELINE" => match baseline {
            None => {
                note = Some(
                    "this target is relative to a precedent campaign and none is named".into(),
                );
                (total, None, None, None)
            }
            Some(before) => {
                score_against_baseline(&metric, total, days, before, value, at_most, &mut note)
            }
        },
        "STAY_WITHIN" => match (total, upper) {
            (Some(total), Some(upper)) if upper > value => (
                Some(total),
                Some(value),
                Some(upper),
                Some(total >= value && total <= upper),
            ),
            (total, upper) => {
                if upper.is_none() {
                    note = Some("a band needs both ends and only one is stated".into());
                }
                (total, Some(value), upper, None)
            }
        },
        // REACH and KEEP_BELOW: the line is the total, read in the direction
        // the metric decides.
        _ => (
            total,
            Some(value),
            None,
            total.map(|total| {
                if at_most {
                    total <= value
                } else {
                    total >= value
                }
            }),
        ),
    };

    if note.is_none() && current.is_none() {
        note = Some(match metric.as_str() {
            "SELL_THROUGH" => "sell-through has not been read for this campaign".into(),
            "GROSS_PROFIT" => {
                "no unit sold has a purchase price on file, so there is no margin to read".into()
            }
            _ => "nothing measured in this window yet, so the target is neither met nor missed"
                .into(),
        });
    }

    let progress_bps = match (current, line, line_upper) {
        // A band fills towards its ceiling: the floor is the sanity check and
        // the ceiling is the thing anybody watches.
        (Some(current), _, Some(upper)) => progress_of(current, upper),
        (Some(current), Some(line), None) => progress_of(current, line),
        _ => None,
    };

    CampaignTargetScore {
        objective,
        success_metric: metric,
        target_model: model,
        target_direction: direction,
        target_value: value,
        target_value_upper: upper,
        current,
        line,
        line_upper,
        met,
        progress_bps,
        note,
        notes,
    }
}

/// BEAT_BASELINE, which is two different comparisons depending on the metric.
///
/// A metric that ADDS UP is compared per day — that is the owner's rule about
/// Lebaran moving, made arithmetic. A metric that is already a rate (average
/// basket, sell-through) is compared level to level and divided by nothing: a
/// rate per day is not a smaller number, it is not a number.
fn score_against_baseline(
    metric: &str,
    mine: Option<i64>,
    my_days: i64,
    before: &CampaignBaselineView,
    bps: i64,
    at_most: bool,
    note: &mut Option<String>,
) -> (Option<i64>, Option<i64>, Option<i64>, Option<bool>) {
    let adds_up = ADDITIVE_METRICS.contains(&metric);
    // The precedent's sell-through is deliberately not read: it would need last
    // year's stock on hand, and the projection holds no history — the shelf it
    // would divide by is today's. A comparison that cannot be made honestly is
    // reported as one that cannot be made.
    let theirs = metric_reading(metric, &before.reading, None);
    let (Some(mine), Some(theirs)) = (mine, theirs) else {
        *note = Some(format!(
            "{} has no reading for one of the two campaigns",
            metric.to_ascii_lowercase().replace('_', " ")
        ));
        return (mine, None, None, None);
    };
    if theirs <= 0 {
        *note = Some("the precedent campaign took nothing, so there is no line to beat".into());
        return (Some(mine), None, None, None);
    }
    // Better means lower for a ceiling metric: "spend twenty per cent less a
    // day than last Lebaran" is the same sentence with the sign turned round,
    // and getting it wrong would congratulate an overspend.
    let factor = if at_most { 10_000 - bps } else { 10_000 + bps };
    if adds_up {
        let their_days = before.window.days_elapsed;
        if my_days <= 0 || their_days <= 0 {
            *note = Some("one of the two campaigns has no days to divide by".into());
            return (Some(mine), None, None, None);
        }
        // mine/my_days ⋛ theirs/their_days × factor/10000, with every division
        // turned into a multiplication.
        let ours = i128::from(mine) * i128::from(their_days) * 10_000;
        let bar = i128::from(theirs) * i128::from(my_days) * i128::from(factor);
        let met = if at_most { ours <= bar } else { ours >= bar };
        let line = i64::try_from(
            i128::from(theirs) * i128::from(factor) / (10_000 * i128::from(their_days)),
        )
        .ok();
        (Some(mine / my_days), line, None, Some(met))
    } else {
        let ours = i128::from(mine) * 10_000;
        let bar = i128::from(theirs) * i128::from(factor);
        let met = if at_most { ours <= bar } else { ours >= bar };
        let line = i64::try_from(bar / 10_000).ok();
        (Some(mine), line, None, Some(met))
    }
}

// ── the rails ───────────────────────────────────────────────────────────────

/// What a rail reads right now, and whether that is on the wrong side.
///
/// Every comparison is integer and exact. The rate rails cross-multiply rather
/// than compare a rounded percentage: `benefit/revenue > threshold/10000`
/// becomes `benefit × 10000 > threshold × revenue`, which cannot round a rail
/// into or out of being crossed.
fn read_guardrail(
    rail: &CampaignGuardrailRow,
    reading: &CampaignReadingView,
    window: &CampaignWindowView,
) -> CampaignGuardrailReading {
    let days = window.days_elapsed;
    let (observed, breached, note) = match rail.measure.as_str() {
        "SPEND_MINOR" => (
            Some(reading.spend_minor),
            reading.spend_minor > rail.threshold,
            None,
        ),
        "SPEND_PER_DAY_MINOR" => {
            if days <= 0 {
                (
                    None,
                    false,
                    Some("the campaign has not started".to_string()),
                )
            } else {
                let breached =
                    i128::from(reading.spend_minor) > i128::from(rail.threshold) * i128::from(days);
                (Some(reading.spend_minor / days), breached, None)
            }
        }
        "DISCOUNT_RATE_BPS" => match reading.discount_rate_bps {
            None => (
                None,
                false,
                Some("nothing has been sold against this campaign yet".to_string()),
            ),
            Some(rate) => {
                let breached = i128::from(reading.benefit_minor) * 10_000
                    > i128::from(rail.threshold) * i128::from(reading.basket_revenue_minor);
                (Some(rate), breached, None)
            }
        },
        "MARGIN_BPS" => match reading.margin_bps {
            None => (
                None,
                false,
                Some("no unit sold has a purchase price on file".to_string()),
            ),
            Some(margin) => {
                let left = i128::from(reading.basket_revenue_minor - reading.cost_minor) * 10_000;
                let bar = i128::from(rail.threshold) * i128::from(reading.basket_revenue_minor);
                (Some(margin), left < bar, None)
            }
        },
        "AVERAGE_BASKET_MINOR" => match reading.average_basket_minor {
            None => (
                None,
                false,
                Some("no basket has named this campaign yet".to_string()),
            ),
            Some(average) => {
                let breached = i128::from(reading.basket_revenue_minor)
                    < i128::from(rail.threshold) * i128::from(reading.sale_count);
                (Some(average), breached, None)
            }
        },
        other => (
            None,
            false,
            Some(format!("this build cannot measure {other}")),
        ),
    };

    CampaignGuardrailReading {
        guardrail_id: rail.guardrail_id,
        measure: rail.measure.clone(),
        direction: rail.direction.clone(),
        threshold: rail.threshold,
        breach_action: rail.breach_action.clone(),
        active: rail.active,
        observed,
        // A rail that has been switched off is still read — the figure is worth
        // seeing — and is never breached. Switching one off is how a campaign is
        // deliberately let past a line.
        breached: breached && rail.active,
        note,
    }
}

/// Measure every rail, record what has been crossed, and stop the campaign
/// where a rail says to.
///
/// "Check now" calls this, and so does the marketing scheduler
/// (`marketing_watch::guardrails`), every few minutes for every running
/// campaign with an active rail — so a rail is no longer only as fresh as the
/// last time somebody pressed a button. Said out loud because a guardrail
/// nobody runs is worse than no guardrail: it is a guardrail everybody believes
/// in.
pub async fn check_campaign_guardrails(
    pool: &PgPool,
    campaign_id: &str,
    actor: &str,
) -> Result<GuardrailCheckReport, AppError> {
    let campaign_id = required("campaign_id", campaign_id)?;
    let actor = required("actor", actor)?;
    let now = Utc::now();

    let published = published_campaign(pool, &campaign_id).await?;
    let (status, valid_from, valid_to) = match &published {
        Some(row) => (
            row.get::<String, _>("status"),
            row.get::<Option<DateTime<Utc>>, _>("valid_from"),
            row.get::<Option<DateTime<Utc>>, _>("valid_to"),
        ),
        None => {
            return Err(AppError::NotFound(format!(
                "no published book carries campaign {campaign_id}, so there is nothing running to measure"
            )))
        }
    };
    let window = window_of(valid_from, valid_to, now);
    let reading = read_campaign(pool, &campaign_id, &window, None).await?;

    let rails: Vec<CampaignGuardrailRow> =
        sqlx::query("SELECT * FROM campaign_guardrail WHERE campaign_id = $1 ORDER BY measure")
            .bind(&campaign_id)
            .fetch_all(pool)
            .await?
            .iter()
            .map(guardrail_row)
            .collect();

    let readings: Vec<CampaignGuardrailReading> = rails
        .iter()
        .map(|rail| read_guardrail(rail, &reading, &window))
        .collect();

    // Stopping it is one act however many rails went, and it is only an act at
    // all if the campaign is still running. A second PAUSE would re-dispatch to
    // thirteen shops to tell them something they were told an hour ago.
    let wants_pause = rails.iter().zip(&readings).any(|(rail, reading)| {
        reading.breached && rail.breach_action == "PAUSE_CAMPAIGN" && rail.active
    });
    let running = matches!(status.as_str(), "ACTIVE" | "SCHEDULED");
    let mut paused = false;
    let mut dispatch = None;
    let mut pause_failed: Option<String> = None;
    if wants_pause && running {
        match super::commercial::switch_campaign(
            pool,
            &campaign_id,
            CampaignSwitchRequest {
                actor_id: actor.clone(),
                status: "PAUSED".to_string(),
                valid_from: None,
                valid_to: None,
                image_url: None,
                headline: None,
                terms: None,
            },
        )
        .await
        {
            Ok(report) => {
                paused = true;
                dispatch = report.get("dispatch").cloned();
            }
            // Recorded, not raised. The breach is the finding, and losing it
            // because the instruction to stop could not be sent would lose both.
            Err(error) => pause_failed = Some(error.to_string()),
        }
    }

    for (rail, reading) in rails.iter().zip(&readings) {
        let Some(observed) = reading.observed else {
            continue;
        };
        if !reading.breached {
            continue;
        }
        let action = if rail.breach_action != "PAUSE_CAMPAIGN" {
            "WARNED"
        } else if pause_failed.is_some() {
            "PAUSE_FAILED"
        } else if paused || !running {
            "PAUSED"
        } else {
            "WARNED"
        };
        sqlx::query(
            "INSERT INTO campaign_guardrail_breach
                 (breach_id, guardrail_id, campaign_id, measure, threshold, observed,
                  window_from, window_to, action_taken, detail)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (guardrail_id) WHERE acknowledged_at IS NULL
             DO UPDATE SET
                 observed     = EXCLUDED.observed,
                 window_to    = EXCLUDED.window_to,
                 last_seen_at = now(),
                 seen_count   = campaign_guardrail_breach.seen_count + 1,
                 -- The threshold and the first sighting are NOT updated. When
                 -- it went and what the line was then is the whole value of the
                 -- record.
                 action_taken = EXCLUDED.action_taken",
        )
        .bind(Uuid::new_v4())
        .bind(rail.guardrail_id)
        .bind(&campaign_id)
        .bind(&rail.measure)
        .bind(rail.threshold)
        .bind(observed)
        .bind(window.measured_from)
        .bind(window.measured_to)
        .bind(action)
        .bind(pause_failed.as_deref())
        .execute(pool)
        .await?;
    }

    let breaches = sqlx::query(
        "SELECT * FROM campaign_guardrail_breach
          WHERE campaign_id = $1 AND acknowledged_at IS NULL
          ORDER BY first_seen_at DESC",
    )
    .bind(&campaign_id)
    .fetch_all(pool)
    .await?;

    Ok(GuardrailCheckReport {
        campaign_id,
        checked_at: now,
        window_from: window.measured_from,
        window_to: window.measured_to,
        readings,
        breaches: breaches.iter().map(breach_row).collect(),
        paused,
        dispatch,
    })
}

#[cfg(test)]
mod tests {
    //! The arithmetic, locked.
    //!
    //! Every test here is about a number that would otherwise be decided by a
    //! rounding rule nobody wrote down. None of them needs a database: the
    //! scoring and the rails take readings, and a reading is a struct.

    use super::*;

    fn at(day: u32) -> DateTime<Utc> {
        chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 4, day, 0, 0, 0)
            .single()
            .unwrap_or_else(|| panic!("2026-04-{day} is not a date"))
    }

    /// A campaign that took `revenue`, gave away `benefit`, over `sales`
    /// baskets, with nothing costed.
    fn took(revenue: i64, benefit: i64, sales: i64, days: i64) -> CampaignReadingView {
        let mut reading = reading_of(
            Some(&serde_json::json!({
                "benefit_minor": benefit,
                "basket_revenue_minor": revenue,
                "sale_count": sales,
                "units": sales * 2,
            })),
            days,
        );
        reading.spend_minor = reading.benefit_minor + reading.clearance_minor;
        reading
    }

    fn ran(days: i64) -> CampaignWindowView {
        window_of(Some(at(1)), Some(at(1) + Duration::days(days)), at(30))
    }

    fn target(model: &str, metric: &str, direction: &str, value: i64) -> StatedIntent {
        StatedIntent {
            objective: "DRIVE_SALES".into(),
            metric: metric.into(),
            model: model.into(),
            direction: direction.into(),
            value,
            upper: None,
            notes: None,
        }
    }

    fn precedent(reading: CampaignReadingView, days: i64) -> CampaignBaselineView {
        CampaignBaselineView {
            campaign_id: "lebaran-2026".into(),
            name: Some("Lebaran 2026".into()),
            window: ran(days),
            reading,
            comparable: true,
            revenue_per_day_bps: None,
            spend_per_day_bps: None,
            note: None,
        }
    }

    #[test]
    fn a_window_that_runs_into_the_future_is_measured_up_to_today() {
        // Ten days in, twenty to go. Reading to the end date would divide what
        // has happened by days that have not, and report every running campaign
        // as behind.
        // The end date is reached by adding days rather than by naming one:
        // `at()` builds an April date and April has thirty of them, so `at(31)`
        // is not a late end — it is a panic. `ran()` in this same module already
        // adds; this was the one place that did not.
        let window = window_of(Some(at(1)), Some(at(1) + Duration::days(30)), at(11));
        assert_eq!(window.days_elapsed, 10);
        assert_eq!(window.days_planned, Some(30));
        assert_eq!(window.measured_to, at(11));
    }

    #[test]
    fn a_campaign_that_has_not_started_has_no_day_to_divide_by() {
        let window = window_of(Some(at(20)), Some(at(30)), at(10));
        assert_eq!(window.days_elapsed, 0);
        assert!(took(0, 0, 0, window.days_elapsed).per_day.is_none());
    }

    #[test]
    fn a_campaign_with_no_dates_at_all_is_read_over_thirty_days_and_says_so() {
        let window = window_of(None, None, at(30));
        assert!(!window.dated);
        assert_eq!(window.days_elapsed, 30);
    }

    #[test]
    fn a_campaign_that_only_says_when_it_ended_is_read_backwards_from_that_end() {
        // Counting back from today would put the whole window after the
        // campaign was over, and report a campaign that traded as one that did
        // nothing.
        let window = window_of(None, Some(at(10)), at(30));
        assert_eq!(window.measured_to, at(10));
        assert_eq!(window.measured_from, at(10) - Duration::days(30));
    }

    #[test]
    fn a_per_day_target_is_met_by_a_reading_that_integer_division_would_have_failed() {
        // 100 a day over 3 days is 300, and the campaign took 300 exactly. The
        // truncating form — 300/3 = 100 — happens to agree here; the one that
        // does not is below.
        let reading = took(300, 0, 3, 3);
        let score = score_target(
            target("REACH_PER_DAY", "PROMO_SALES", "AT_LEAST", 100),
            &reading,
            &ran(3),
            None,
            None,
        );
        assert_eq!(score.met, Some(true));
        assert_eq!(score.current, Some(100));
    }

    #[test]
    fn a_per_day_target_missed_by_one_rupiah_is_missed_and_not_rounded_into_success() {
        // 299 over 3 days truncates to 99 a day, which is honest — but the
        // comparison is `299 >= 100 × 3`, not `99 >= 100`, and a reading of 302
        // would truncate to 100 and still be a pass. The line is multiplied,
        // never the reading divided.
        let short = score_target(
            target("REACH_PER_DAY", "PROMO_SALES", "AT_LEAST", 100),
            &took(299, 0, 3, 3),
            &ran(3),
            None,
            None,
        );
        assert_eq!(short.met, Some(false));

        let over = score_target(
            target("REACH_PER_DAY", "PROMO_SALES", "AT_LEAST", 100),
            &took(302, 0, 3, 3),
            &ran(3),
            None,
            None,
        );
        assert_eq!(over.met, Some(true));
    }

    #[test]
    fn a_longer_campaign_does_not_beat_a_shorter_one_by_being_longer() {
        // Twenty-three days at 100 a day against twenty-one days at 110. The
        // longer campaign wins on totals — 2300 against 2310 is close, and any
        // longer window would pass it — and loses per day, which is the only
        // reading that is not flattered by length.
        let mine = took(2300, 0, 23, 23);
        let before = precedent(took(2310, 0, 21, 21), 21);
        let score = score_target(
            target("BEAT_BASELINE", "PROMO_SALES", "AT_LEAST", 0),
            &mine,
            &ran(23),
            None,
            Some(&before),
        );
        assert_eq!(score.met, Some(false));
        assert_eq!(score.current, Some(100));
        assert_eq!(score.line, Some(110));
    }

    #[test]
    fn beating_a_baseline_by_twenty_per_cent_is_beating_its_daily_rate() {
        // Last Lebaran: 2,100,000 over 21 days = 100,000 a day. Twenty per cent
        // better is 120,000 a day, which over this campaign's 10 days is
        // 1,200,000 — and 1,199,999 is not it.
        let before = precedent(took(2_100_000, 0, 21, 21), 21);
        let met = score_target(
            target("BEAT_BASELINE", "PROMO_SALES", "AT_LEAST", 2000),
            &took(1_200_000, 0, 10, 10),
            &ran(10),
            None,
            Some(&before),
        );
        assert_eq!(met.met, Some(true));
        assert_eq!(met.line, Some(120_000));

        let missed = score_target(
            target("BEAT_BASELINE", "PROMO_SALES", "AT_LEAST", 2000),
            &took(1_199_999, 0, 10, 10),
            &ran(10),
            None,
            Some(&before),
        );
        assert_eq!(missed.met, Some(false));
    }

    #[test]
    fn beating_a_baseline_on_a_ceiling_metric_means_giving_away_less() {
        // "Spend twenty per cent less a day than last Lebaran" is the same
        // sentence with the sign turned round. Getting it backwards would
        // congratulate an overspend, which is the fault `target_direction`
        // exists to prevent.
        let before = precedent(took(2_100_000, 1_000_000, 21, 21), 21);
        let score = score_target(
            target("BEAT_BASELINE", "DISCOUNT_GIVEN", "AT_MOST", 2000),
            // 380,000 over 10 days is 38,000 a day against a line of
            // 1,000,000/21 × 0.8 = 38,095.
            &took(1_000_000, 380_000, 10, 10),
            &ran(10),
            None,
            Some(&before),
        );
        assert_eq!(score.met, Some(true));

        let worse = score_target(
            target("BEAT_BASELINE", "DISCOUNT_GIVEN", "AT_MOST", 2000),
            &took(1_000_000, 420_000, 10, 10),
            &ran(10),
            None,
            Some(&before),
        );
        assert_eq!(worse.met, Some(false));
    }

    #[test]
    fn an_average_basket_is_compared_to_a_baseline_level_and_divided_by_no_days() {
        // Average basket is already a rate. Dividing it by days would produce a
        // target that falls as a campaign runs longer — so the two levels are
        // compared as they stand, whatever the two windows were.
        let before = precedent(took(2_100_000, 0, 21, 21), 21);
        let score = score_target(
            target("BEAT_BASELINE", "AVERAGE_BASKET", "AT_LEAST", 1000),
            // 110,000 a basket against last time's 100,000, which is ten per
            // cent better exactly.
            &took(1_100_000, 0, 10, 10),
            &ran(10),
            None,
            Some(&before),
        );
        assert_eq!(score.met, Some(true));
        assert_eq!(score.current, Some(110_000));
        assert_eq!(score.line, Some(110_000));
    }

    #[test]
    fn a_precedent_that_took_nothing_is_not_a_line_to_beat() {
        let before = precedent(took(0, 0, 0, 21), 21);
        let score = score_target(
            target("BEAT_BASELINE", "PROMO_SALES", "AT_LEAST", 2000),
            &took(500, 0, 5, 10),
            &ran(10),
            None,
            Some(&before),
        );
        assert_eq!(score.met, None);
        assert!(score.note.is_some());
    }

    #[test]
    fn a_band_is_missed_at_both_ends_and_met_between_them() {
        let mut band = target("STAY_WITHIN", "AVERAGE_BASKET", "AT_LEAST", 100_000);
        band.upper = Some(200_000);
        let inside = score_target(
            band.clone(),
            &took(1_500_000, 0, 10, 10),
            &ran(10),
            None,
            None,
        );
        assert_eq!(inside.met, Some(true));

        let under = score_target(
            band.clone(),
            &took(900_000, 0, 10, 10),
            &ran(10),
            None,
            None,
        );
        assert_eq!(under.met, Some(false));

        let over = score_target(band, &took(2_500_000, 0, 10, 10), &ran(10), None, None);
        assert_eq!(over.met, Some(false));
    }

    #[test]
    fn a_target_with_nothing_measured_is_neither_met_nor_missed() {
        let score = score_target(
            target("REACH", "GROSS_PROFIT", "AT_LEAST", 1_000),
            // Nothing costed, so there is no margin to read — and revenue less
            // a cost of nought is the most flattering figure on the page.
            &took(5_000, 0, 2, 10),
            &ran(10),
            None,
            None,
        );
        assert_eq!(score.met, None);
        assert_eq!(score.current, None);
        assert!(score.note.is_some());
    }

    fn rail(measure: &str, threshold: i64) -> CampaignGuardrailRow {
        CampaignGuardrailRow {
            guardrail_id: Uuid::nil(),
            campaign_id: "lebaran".into(),
            measure: measure.into(),
            direction: guardrail_direction(measure).into(),
            threshold,
            breach_action: "WARN".into(),
            active: true,
            note: None,
            created_at: Utc::now(),
            created_by: "test".into(),
        }
    }

    #[test]
    fn a_rail_is_crossed_by_passing_the_line_and_not_by_reaching_it() {
        // Ten per cent of 10,000 is exactly 1,000. A rail that said "at most ten
        // per cent" has not been crossed by ten per cent.
        let exactly = read_guardrail(
            &rail("DISCOUNT_RATE_BPS", 1_000),
            &took(10_000, 1_000, 4, 10),
            &ran(10),
        );
        assert_eq!(exactly.observed, Some(1_000));
        assert!(!exactly.breached);

        let past = read_guardrail(
            &rail("DISCOUNT_RATE_BPS", 1_000),
            &took(10_000, 1_001, 4, 10),
            &ran(10),
        );
        assert!(past.breached);
    }

    #[test]
    fn a_spend_per_day_rail_multiplies_the_line_by_the_days_it_has_had() {
        let under = read_guardrail(
            &rail("SPEND_PER_DAY_MINOR", 100),
            &took(5_000, 999, 4, 10),
            &ran(10),
        );
        assert_eq!(under.observed, Some(99));
        assert!(!under.breached);

        let over = read_guardrail(
            &rail("SPEND_PER_DAY_MINOR", 100),
            &took(5_000, 1_001, 4, 10),
            &ran(10),
        );
        assert!(over.breached);
    }

    #[test]
    fn a_margin_rail_with_no_cost_on_file_reads_nothing_rather_than_one_hundred_per_cent() {
        // Revenue less a cost of nought is revenue, and under the word "margin"
        // that is a rail passing because of missing data.
        let reading = read_guardrail(
            &rail("MARGIN_BPS", 4_000),
            &took(10_000, 0, 4, 10),
            &ran(10),
        );
        assert_eq!(reading.observed, None);
        assert!(!reading.breached);
        assert!(reading.note.is_some());
    }

    #[test]
    fn a_rail_that_has_been_switched_off_is_still_read_and_never_breached() {
        let mut off = rail("SPEND_MINOR", 100);
        off.active = false;
        let reading = read_guardrail(&off, &took(10_000, 5_000, 4, 10), &ran(10));
        assert_eq!(reading.observed, Some(5_000));
        assert!(!reading.breached);
    }

    #[test]
    fn a_spend_rail_counts_the_markdowns_as_well_as_the_discounts() {
        // A campaign run as a flash sale gives away every rupiah of it through
        // prices rather than promotions. A rail that watched `benefit` alone
        // would stop watching that campaign entirely.
        let mut flash = took(10_000, 1_000, 4, 10);
        flash.clearance_minor = 4_000;
        flash.spend_minor = flash.benefit_minor + flash.clearance_minor;
        let reading = read_guardrail(&rail("SPEND_MINOR", 4_500), &flash, &ran(10));
        assert_eq!(reading.observed, Some(5_000));
        assert!(reading.breached);
    }

    #[test]
    fn the_direction_of_a_rail_follows_from_what_it_measures() {
        // The same rule the database holds as a CHECK. Two copies on purpose:
        // this one produces the value, the constraint catches any other writer.
        assert_eq!(guardrail_direction("SPEND_MINOR"), "AT_MOST");
        assert_eq!(guardrail_direction("DISCOUNT_RATE_BPS"), "AT_MOST");
        assert_eq!(guardrail_direction("MARGIN_BPS"), "AT_LEAST");
        assert_eq!(guardrail_direction("AVERAGE_BASKET_MINOR"), "AT_LEAST");
    }

    #[test]
    fn a_ceiling_target_fills_its_meter_as_it_is_consumed() {
        let score = score_target(
            target("KEEP_BELOW", "DISCOUNT_GIVEN", "AT_MOST", 1_000_000),
            &took(5_000_000, 900_000, 20, 10),
            &ran(10),
            None,
            None,
        );
        assert_eq!(score.met, Some(true));
        assert_eq!(score.progress_bps, Some(9_000));
    }
}
