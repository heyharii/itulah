//! What the offers actually did — read from the sale facts, never from a
//! counter kept alongside them.
//!
//! `commercial_usage` already says how many times a rule fired and what it
//! spent, and it is the right thing to enforce a budget against because it is
//! incremented in the same transaction that accepts the sale. It cannot answer
//! the question a merchandiser asks, though: it has no window, no shop and no
//! basket, so "what did this campaign cost us in Bandung last week, and what
//! came back" is not a query you can put to it. That question is only
//! answerable from `edge_sale` and `edge_sale_promotion`, which is what
//! everything below reads — plus `edge_sale_line`, for the half of a campaign
//! that is not a promotion at all.
//!
//! **A campaign can cost money two ways, and they are counted separately.** Its
//! rules discount what is charged; its markdowns replace what a thing costs.
//! Both are money the business chose not to take, and only the first is a
//! discount. `benefit_minor` is what the promotions gave away and
//! `clearance_minor` is what the price drops gave up; they are never added
//! together here, because a markdown booked as a discount inflates revenue and
//! discount by the same invented amount — which is the whole reason the two are
//! different types rather than a flag.
//!
//! Before campaigns could hold markdowns this file could ignore the second
//! figure, and it did. A campaign run as a flash sale then reported nothing at
//! all: every rupiah of it sat in `edge_sale_line`, which nothing here read.
//!
//! Two properties of these numbers are worth stating once here rather than
//! being rediscovered from a chart that looks wrong.
//!
//! **Revenue is attributed per basket, not per line.** `edge_sale_promotion`
//! is keyed `(sale_id, rule_id)`; which lines the rule matched was never
//! recorded. A three-item basket where a promotion hit one item counts the
//! whole basket as that promotion's revenue. This is influenced revenue, it is
//! the standard measure, and it overstates. Every response says
//! `attribution: "BASKET"` at the top level so a screen can label it and so the
//! per-line version, when the edge starts reporting matched lines, is a visible
//! change rather than a silent one.
//!
//! **No ratio is computed here.** Revenue over discount is the number the
//! screen wants, and it is a ratio rather than money: dividing two minor-unit
//! integers server-side would either round it into a lie or return a float
//! among a page of exact integers. Both figures ship whole and the browser
//! divides.

use crate::cloud::{application::AppError, domain::SiteId};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::collections::BTreeMap;

/// The window a performance question is asked over, and the shop it is asked
/// about.
///
/// Resolved once, in one place, because all three endpoints take the same three
/// parameters and a default that differed between them would make two screens
/// disagree about what "this month" means.
#[derive(Clone, Debug)]
pub struct PerformanceWindow {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    /// The window of equal length immediately before `from`. Carried rather
    /// than recomputed so the comparison a screen draws is the one the numbers
    /// were measured over.
    pub previous_from: DateTime<Utc>,
    pub site_id: Option<SiteId>,
}

impl PerformanceWindow {
    /// Apply the defaults, then refuse the two shapes that would silently
    /// return nothing: a window that runs backwards, and a site id no origin
    /// could ever have.
    pub fn resolve(
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
        site_id: Option<&str>,
    ) -> Result<Self, AppError> {
        let to = to.unwrap_or_else(Utc::now);
        let from = from.unwrap_or(to - Duration::days(30));
        if from >= to {
            return Err(AppError::Validation(format!(
                "the window runs backwards: from {from} is not before to {to}"
            )));
        }
        // An empty `site_id=` is the query string a UI sends when its shop
        // picker is on "all shops", and it means the same thing as leaving the
        // parameter out. Anything else has to be a site the fleet could have.
        let site_id = match site_id.map(str::trim).filter(|value| !value.is_empty()) {
            Some(value) => {
                Some(SiteId::new(value).map_err(|e| AppError::Validation(e.to_string()))?)
            }
            None => None,
        };
        Ok(Self {
            previous_from: from - (to - from),
            from,
            to,
            site_id,
        })
    }

    fn site(&self) -> Option<&str> {
        self.site_id.as_ref().map(SiteId::as_str)
    }

    /// The envelope every response opens with: what was asked, and how to read
    /// the answer.
    fn envelope(&self) -> Value {
        json!({
            "attribution": "BASKET",
            "as_of": Utc::now(),
            "from": self.from,
            "to": self.to,
            "previous_from": self.previous_from,
            "site_id": self.site_id.as_ref().map(SiteId::as_str),
        })
    }
}

/// Which column of `edge_sale_promotion` a set of numbers is keyed by.
///
/// The three menus ask an identical question of an identical join and differ
/// only in what they group by, so the aggregate is written once and the key is
/// a closed set rather than a string a caller passes in — the value is
/// interpolated into SQL, and a closed set is what makes that safe to read.
#[derive(Clone, Copy, Debug)]
enum PromotionKey {
    Campaign,
    Rule,
    Coupon,
}

impl PromotionKey {
    fn column(self) -> &'static str {
        match self {
            Self::Campaign => "campaign_id",
            Self::Rule => "rule_id",
            Self::Coupon => "coupon_code",
        }
    }
}

/// One key's numbers over the window, and the same numbers over the window
/// before it.
struct Aggregate {
    key: String,
    benefit_minor: i64,
    /// What this campaign gave up by clearing prices, as distinct from what its
    /// promotions discounted. Always nought for a rule or a coupon.
    clearance_minor: i64,
    sale_count: i64,
    basket_revenue_minor: i64,
    /// Items in the baskets this key touched. Whole units, attributed per
    /// basket like the revenue beside them.
    units: i64,
    /// Those units at the last price we agreed to pay for their style, and how
    /// many of them a price was found for. Gross profit is
    /// `basket_revenue_minor - cost_minor` and is an ESTIMATE — the screen that
    /// draws it has `costed_units` to say how much of the basket it covers.
    cost_minor: i64,
    costed_units: i64,
    customer_count: i64,
    new_customer_count: i64,
    previous: Value,
    series: Value,
}

impl Aggregate {
    /// A key that appears in the published book but never in a sale. Zero
    /// rather than absent: a campaign that gave nothing away is a finding, and
    /// a row missing from a list reads as a fault in the report.
    fn empty(key: String) -> Self {
        Self {
            key,
            benefit_minor: 0,
            clearance_minor: 0,
            sale_count: 0,
            basket_revenue_minor: 0,
            units: 0,
            cost_minor: 0,
            costed_units: 0,
            customer_count: 0,
            new_customer_count: 0,
            previous: json!({
                "benefit_minor": 0,
                "clearance_minor": 0,
                "sale_count": 0,
                "basket_revenue_minor": 0,
                "units": 0,
                "cost_minor": 0,
                "costed_units": 0,
                "customer_count": 0,
                "new_customer_count": 0,
            }),
            series: json!([]),
        }
    }

    /// Fold the measured numbers into the row that describes the key.
    ///
    /// Destructured rather than borrowed through `as_object_mut`, because
    /// returning the value from the non-object arm of a `let ... else` while a
    /// mutable borrow of it is in scope is exactly the shape the borrow checker
    /// refuses. The arm is unreachable in practice — every head is built by
    /// `json!({...})` — but it has to be written in a way that compiles.
    fn merge_into(self, head: Value) -> Value {
        let mut object = match head {
            Value::Object(object) => object,
            other => return other,
        };
        object.insert("benefit_minor".into(), json!(self.benefit_minor));
        object.insert("clearance_minor".into(), json!(self.clearance_minor));
        object.insert("sale_count".into(), json!(self.sale_count));
        object.insert(
            "basket_revenue_minor".into(),
            json!(self.basket_revenue_minor),
        );
        object.insert("units".into(), json!(self.units));
        object.insert("cost_minor".into(), json!(self.cost_minor));
        object.insert("costed_units".into(), json!(self.costed_units));
        object.insert("customer_count".into(), json!(self.customer_count));
        object.insert("new_customer_count".into(), json!(self.new_customer_count));
        object.insert("previous".into(), self.previous);
        object.insert("series".into(), self.series);
        Value::Object(object)
    }
}

/// The clearance half of a campaign's cost, as a second source for `scoped`.
///
/// A markdown is a price, so nothing about it is recorded per promotion — it is
/// recorded per sold LINE: `price_source` says a clearance set the price,
/// `base_unit_price_minor` says what it replaced, and `markdown_id` says which
/// one. What it gave up is the difference, per unit, times the units.
///
/// `base_unit_price_minor IS NOT NULL` is a real filter and not defensiveness.
/// Null there means the shop had no book in force or predates the field, and a
/// null read as zero would report the whole selling price as a giveaway. A line
/// we cannot measure is left out of the sum rather than measured as free.
///
/// The join goes through `DISTINCT ON`, for the same reason
/// `load_site_pricing` does: the centre scopes a markdown per publication and
/// holds every version of it at once, so a clearance carried into a later book
/// exists here several times over. Joining on `markdown_id` alone would
/// multiply every cleared line by the number of books that mentioned it. The
/// newest published book owns the markdown, which is also the rule the shop
/// applies when it replaces on the id.
const CLEARANCE_ARM: &str = "
             UNION ALL
             SELECT m.campaign_id AS key, l.sale_id, s.occurred_at, s.total_minor,
                    s.customer_id,
                    0::bigint AS benefit_minor,
                    sum((l.base_unit_price_minor - l.unit_price_minor) * l.quantity)::bigint
                        AS clearance_minor
               FROM edge_sale_line l
               JOIN edge_sale s ON s.sale_id = l.sale_id
               JOIN (SELECT DISTINCT ON (d.markdown_id) d.markdown_id, d.campaign_id
                       FROM commercial_markdown d
                       JOIN commercial_publication b ON b.id = d.publication_id
                      WHERE b.status = 'PUBLISHED' AND d.campaign_id IS NOT NULL
                      ORDER BY d.markdown_id, b.version DESC) m
                 ON m.markdown_id = l.markdown_id
              WHERE l.markdown_id IS NOT NULL
                AND l.base_unit_price_minor IS NOT NULL
                AND s.occurred_at >= $1 AND s.occurred_at < $3
                AND ($4::text IS NULL OR s.site_id = $4)
              GROUP BY m.campaign_id, l.sale_id, s.occurred_at, s.total_minor, s.customer_id";

/// What we last agreed to pay for a style, per style.
///
/// The SAME basis the pricelist report uses — the unit price on the most recent
/// ISSUED or CLOSED purchase order — and deliberately the same SQL, because two
/// readings of "what this cost" that differ by a draft order is the kind of
/// disagreement nobody can explain months later. A draft has not been agreed
/// and a cancelled order never was, so neither is evidence of a cost.
///
/// **It is per ARTICLE, and the thing sold is a SKU.** A purchase order names a
/// style; it does not name a size. So every colourway and every size of a style
/// is costed at the style's price, and the margin below is an ESTIMATE for that
/// reason and not because the arithmetic is loose. `costed_units` beside it is
/// what keeps that honest: it says how many of the units sold a cost was
/// actually found for, so a screen can report the coverage rather than present
/// a figure drawn from a third of the basket as though it covered all of it.
const ARTICLE_COST: &str = "
         article_cost AS (
             SELECT DISTINCT ON (l.article_code) l.article_code, l.unit_price_minor
               FROM purchase_order_line l
               JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
              WHERE o.order_status IN ('ISSUED', 'CLOSED')
              ORDER BY l.article_code,
                       COALESCE(o.issued_at, o.created_at) DESC, l.line_number DESC
         ), basket AS (
             -- Per SALE, never per promotion: revenue here is attributed by
             -- basket (see the module note), so what it is measured against has
             -- to be the same basket. Costing only the discounted line against
             -- the whole basket's revenue would report a margin no accountant
             -- would recognise.
             --
             -- A line whose style was never ordered contributes its units and
             -- NOT a cost — left out of the sum rather than counted as free,
             -- which is the same rule `CLEARANCE_ARM` follows for a line with
             -- no base price.
             SELECT l.sale_id,
                    sum(l.quantity)::bigint AS units,
                    COALESCE(sum(c.unit_price_minor * l.quantity)
                        FILTER (WHERE c.unit_price_minor IS NOT NULL), 0)::bigint AS cost_minor,
                    COALESCE(sum(l.quantity)
                        FILTER (WHERE c.unit_price_minor IS NOT NULL), 0)::bigint AS costed_units
               FROM edge_sale_line l
               JOIN edge_sale s ON s.sale_id = l.sale_id
               LEFT JOIN sku k ON k.sku_code = l.sku_code
               LEFT JOIN article a ON a.id = k.article_id
               LEFT JOIN article_cost c ON c.article_code = a.article_code
              WHERE s.occurred_at >= $1 AND s.occurred_at < $3
                AND ($4::text IS NULL OR s.site_id = $4)
              GROUP BY l.sale_id
         ),";

/// The one aggregate all three promotion menus are built from.
///
/// It reads the two windows in a single pass. Written as two queries it was two
/// scans of the same join for numbers that are always drawn together, and the
/// second one could disagree with the first if a sale landed between them —
/// which is exactly the sort of one-in-a-thousand inconsistency nobody ever
/// reproduces.
///
/// The `scoped` step collapses to one row per (key, sale) before anything is
/// summed. Without it a campaign carrying two rules that both fired on one
/// basket would count that basket's revenue twice and its sale twice, and the
/// number would look like a good week.
async fn aggregate(
    pool: &PgPool,
    key: PromotionKey,
    window: &PerformanceWindow,
) -> Result<Vec<Aggregate>, AppError> {
    let column = key.column();
    // What a campaign gave up by CLEARING prices, beside what its promotions
    // discounted.
    //
    // Only campaigns, because only a campaign can hold markdowns: a rule id and
    // a coupon code name effects, and an effect has no clearance. For those two
    // this arm is absent and every number below is unchanged.
    //
    // It is a second source rather than a second column on the first, because
    // the two facts live on different rows: a promotion is recorded per sale in
    // `edge_sale_promotion`, and a clearance is recorded per LINE in
    // `edge_sale_line`. They are folded together per (campaign, sale) below.
    //
    // The two figures stay apart all the way to the screen, and that is the
    // whole point of the taxonomy: a markdown is not a discount, and adding
    // them into one "benefit" would inflate discount-given by an amount nobody
    // gave — the exact reporting error the split exists to prevent.
    let clearance = match key {
        PromotionKey::Campaign => CLEARANCE_ARM,
        PromotionKey::Rule | PromotionKey::Coupon => "",
    };
    // Always present, for all three menus: a coupon's baskets have a cost in
    // exactly the way a campaign's do.
    let cost = ARTICLE_COST;
    let sql = format!(
        "WITH {cost}
         scoped AS (
             SELECT p.{column} AS key, p.sale_id, s.occurred_at, s.total_minor, s.customer_id,
                    sum(p.benefit_minor)::bigint AS benefit_minor,
                    0::bigint                    AS clearance_minor
               FROM edge_sale_promotion p
               JOIN edge_sale s ON s.sale_id = p.sale_id
              WHERE p.{column} IS NOT NULL
                AND s.occurred_at >= $1 AND s.occurred_at < $3
                AND ($4::text IS NULL OR s.site_id = $4)
              GROUP BY p.{column}, p.sale_id, s.occurred_at, s.total_minor, s.customer_id
             {clearance}
         ), folded AS (
             -- One row per campaign per sale, however the campaign touched it.
             -- A basket that took a 20% rule AND a cleared shirt from the same
             -- Lebaran campaign is ONE sale for that campaign, not two — which
             -- is what leaving the union unfolded would have counted, inflating
             -- `sale_count` and `customer_count` for precisely the campaigns
             -- run both ways.
             SELECT key, sale_id, occurred_at, total_minor, customer_id,
                    sum(benefit_minor)::bigint   AS benefit_minor,
                    sum(clearance_minor)::bigint AS clearance_minor
               FROM scoped
              GROUP BY key, sale_id, occurred_at, total_minor, customer_id
         ), costed AS (
             -- Joined AFTER the fold, so a campaign whose rule and markdown
             -- both hit one basket counts that basket\'s units and cost once.
             -- Joined before it, the union would have doubled them for exactly
             -- the campaigns run both ways — the same trap `folded` exists for.
             SELECT f.*,
                    COALESCE(b.units, 0)        AS units,
                    COALESCE(b.cost_minor, 0)   AS cost_minor,
                    COALESCE(b.costed_units, 0) AS costed_units
               FROM folded f LEFT JOIN basket b ON b.sale_id = f.sale_id
         ), first_sale AS (
             -- A shopper's first purchase anywhere, ever. Not filtered by site
             -- or by window on purpose: somebody who has shopped with us for
             -- years is not a new customer because this is their first visit to
             -- this branch.
             SELECT customer_id, min(occurred_at) AS first_at
               FROM edge_sale WHERE customer_id IS NOT NULL GROUP BY customer_id
         ), marked AS (
             SELECT costed.*, (f.first_at >= $2 AND f.first_at < $3) AS new_now,
                    (f.first_at >= $1 AND f.first_at < $2) AS new_before
               FROM costed LEFT JOIN first_sale f ON f.customer_id = costed.customer_id
         ), points AS (
             SELECT key, (occurred_at AT TIME ZONE 'UTC')::date AS day,
                    sum(benefit_minor)::bigint   AS benefit_minor,
                    sum(clearance_minor)::bigint AS clearance_minor,
                    count(*)::bigint             AS sale_count,
                    sum(total_minor)::bigint     AS basket_revenue_minor,
                    sum(units)::bigint           AS units,
                    sum(cost_minor)::bigint      AS cost_minor,
                    sum(costed_units)::bigint    AS costed_units
               FROM costed WHERE occurred_at >= $2
              GROUP BY key, (occurred_at AT TIME ZONE 'UTC')::date
         ), series AS (
             SELECT key, jsonb_agg(jsonb_build_object(
                        'day', day::text,
                        'benefit_minor', benefit_minor,
                        'clearance_minor', clearance_minor,
                        'sale_count', sale_count,
                        'basket_revenue_minor', basket_revenue_minor,
                        'units', units,
                        'cost_minor', cost_minor,
                        'costed_units', costed_units
                    ) ORDER BY day) AS series
               FROM points GROUP BY key
         ), totals AS (
             SELECT m.key,
                    COALESCE(sum(m.benefit_minor) FILTER (WHERE m.occurred_at >= $2), 0)::bigint AS benefit_minor,
                    COALESCE(sum(m.clearance_minor) FILTER (WHERE m.occurred_at >= $2), 0)::bigint AS clearance_minor,
                    count(*) FILTER (WHERE m.occurred_at >= $2)                        AS sale_count,
                    COALESCE(sum(m.total_minor) FILTER (WHERE m.occurred_at >= $2), 0)::bigint AS basket_revenue_minor,
                    COALESCE(sum(m.units) FILTER (WHERE m.occurred_at >= $2), 0)::bigint AS units,
                    COALESCE(sum(m.cost_minor) FILTER (WHERE m.occurred_at >= $2), 0)::bigint AS cost_minor,
                    COALESCE(sum(m.costed_units) FILTER (WHERE m.occurred_at >= $2), 0)::bigint AS costed_units,
                    count(DISTINCT m.customer_id) FILTER (WHERE m.occurred_at >= $2)   AS customer_count,
                    count(DISTINCT m.customer_id) FILTER (WHERE m.occurred_at >= $2 AND m.new_now) AS new_customer_count,
                    COALESCE(sum(m.benefit_minor) FILTER (WHERE m.occurred_at < $2), 0)::bigint AS prev_benefit_minor,
                    COALESCE(sum(m.clearance_minor) FILTER (WHERE m.occurred_at < $2), 0)::bigint AS prev_clearance_minor,
                    count(*) FILTER (WHERE m.occurred_at < $2)                         AS prev_sale_count,
                    COALESCE(sum(m.total_minor) FILTER (WHERE m.occurred_at < $2), 0)::bigint AS prev_basket_revenue_minor,
                    COALESCE(sum(m.units) FILTER (WHERE m.occurred_at < $2), 0)::bigint AS prev_units,
                    COALESCE(sum(m.cost_minor) FILTER (WHERE m.occurred_at < $2), 0)::bigint AS prev_cost_minor,
                    COALESCE(sum(m.costed_units) FILTER (WHERE m.occurred_at < $2), 0)::bigint AS prev_costed_units,
                    count(DISTINCT m.customer_id) FILTER (WHERE m.occurred_at < $2)    AS prev_customer_count,
                    count(DISTINCT m.customer_id) FILTER (WHERE m.occurred_at < $2 AND m.new_before) AS prev_new_customer_count
               FROM marked m GROUP BY m.key
         )
         SELECT t.*, COALESCE(x.series, '[]'::jsonb) AS series
           FROM totals t LEFT JOIN series x ON x.key = t.key
          ORDER BY (t.benefit_minor + t.clearance_minor) DESC, t.key"
    );
    let rows = sqlx::query(&sql)
        .bind(window.previous_from)
        .bind(window.from)
        .bind(window.to)
        .bind(window.site())
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| Aggregate {
            key: row.get("key"),
            benefit_minor: row.get("benefit_minor"),
            clearance_minor: row.get("clearance_minor"),
            sale_count: row.get("sale_count"),
            basket_revenue_minor: row.get("basket_revenue_minor"),
            units: row.get("units"),
            cost_minor: row.get("cost_minor"),
            costed_units: row.get("costed_units"),
            customer_count: row.get("customer_count"),
            new_customer_count: row.get("new_customer_count"),
            previous: json!({
                "benefit_minor": row.get::<i64, _>("prev_benefit_minor"),
                "clearance_minor": row.get::<i64, _>("prev_clearance_minor"),
                "sale_count": row.get::<i64, _>("prev_sale_count"),
                "basket_revenue_minor": row.get::<i64, _>("prev_basket_revenue_minor"),
                "units": row.get::<i64, _>("prev_units"),
                "cost_minor": row.get::<i64, _>("prev_cost_minor"),
                "costed_units": row.get::<i64, _>("prev_costed_units"),
                "customer_count": row.get::<i64, _>("prev_customer_count"),
                "new_customer_count": row.get::<i64, _>("prev_new_customer_count"),
            }),
            series: row.get("series"),
        })
        .collect())
}

/// Attach each key's numbers to what the book says that key IS, and keep the
/// keys the book knows about even when no sale mentions them.
///
/// The join is done here rather than in SQL because the three menus describe
/// their key from three different tables with three different columns, and one
/// query carrying all of them would be a `CASE` per field over three outer
/// joins to read one row.
fn stitch(
    aggregates: Vec<Aggregate>,
    mut described: BTreeMap<String, Value>,
    undeclared: fn(&str) -> Value,
) -> Vec<Value> {
    let mut items = Vec::with_capacity(aggregates.len().max(described.len()));
    for aggregate in aggregates {
        // A key that took money and that no published book declares. It happens
        // — a shop still charging against a book the centre has since replaced,
        // or a rule withdrawn while a till was offline — and the sale is a fact
        // whether or not we can still name what caused it. The row is filled
        // out with nulls rather than left short, so a reader gets "we cannot
        // name this" instead of a column that is missing on some rows only.
        let head = described
            .remove(&aggregate.key)
            .unwrap_or_else(|| undeclared(&aggregate.key));
        items.push(aggregate.merge_into(head));
    }
    // Whatever the book declared and no sale used. Sorted by key rather than by
    // spend, because there is no spend to sort them by.
    for (key, head) in described {
        items.push(Aggregate::empty(key).merge_into(head));
    }
    items
}

/// A campaign id that appears in a sale and in no published book.
fn campaign_undeclared(key: &str) -> Value {
    json!({
        "key": key,
        "campaign_id": key,
        "name": Value::Null,
        "status": Value::Null,
        "budget_minor": Value::Null,
        "max_uses": Value::Null,
        "max_uses_per_customer": Value::Null,
        "valid_from": Value::Null,
        "valid_to": Value::Null,
        "publication_version": Value::Null,
    })
}

/// A rule id that appears in a sale and in no published book.
fn rule_undeclared(key: &str) -> Value {
    json!({
        "key": key,
        "rule_id": key,
        "name": Value::Null,
        "status": Value::Null,
        "priority": Value::Null,
        "campaign_id": Value::Null,
        "budget_minor": Value::Null,
        "max_uses": Value::Null,
        "publication_version": Value::Null,
    })
}

/// A coupon code that appears in a sale and in no published book.
fn coupon_undeclared(key: &str) -> Value {
    json!({
        "key": key,
        "coupon_code": key,
        "rule_id": Value::Null,
        "active": Value::Null,
        "customer_id": Value::Null,
        "valid_from": Value::Null,
        "valid_to": Value::Null,
        "max_uses": Value::Null,
        "publication_version": Value::Null,
    })
}

/// The newest published declaration of every campaign.
///
/// `DISTINCT ON … ORDER BY version DESC` for the same reason `commercial_usage`
/// uses it: a campaign is redeclared by every book that carries it, and the one
/// in force is the one in the highest-numbered published book. A budget stated
/// in an older book has been superseded like everything else in it.
async fn campaigns_described(pool: &PgPool) -> Result<BTreeMap<String, Value>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT ON (c.campaign_id)
                c.campaign_id, c.name, c.status, c.budget_minor, c.max_uses,
                c.valid_from, c.valid_to, p.version
           FROM commercial_campaign c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY c.campaign_id, p.version DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let key: String = row.get("campaign_id");
            let head = json!({
                "key": key,
                "campaign_id": key,
                "name": row.get::<String, _>("name"),
                "status": row.get::<String, _>("status"),
                "budget_minor": row.get::<Option<i64>, _>("budget_minor"),
                "max_uses": row.get::<Option<i32>, _>("max_uses"),
                // Always null since migration 0086 dropped the column. Kept on
                // the wire rather than removed: it was authorable and validated
                // for a year and no till ever enforced it, so a client that has
                // the field is answered "no such limit" instead of finding the
                // key gone and having to guess whether that means unlimited.
                "max_uses_per_customer": Value::Null,
                "valid_from": row.get::<Option<DateTime<Utc>>, _>("valid_from"),
                "valid_to": row.get::<Option<DateTime<Utc>>, _>("valid_to"),
                // Which book this description came out of, so a screen showing
                // a stale budget can be told where the number lives.
                "publication_version": row.get::<i64, _>("version"),
            });
            (key, head)
        })
        .collect())
}

/// The newest published declaration of every rule.
///
/// A rule's caps are inside its stored definition rather than in columns
/// because the shape of a rule belongs to the engine; two known fields are read
/// out of that document here, the same two and the same way `commercial_usage`
/// reads them.
async fn rules_described(pool: &PgPool) -> Result<BTreeMap<String, Value>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT ON (r.rule_id)
                r.rule_id, r.name, r.status, r.priority,
                r.definition->>'campaign_id' AS campaign_id,
                (r.definition->'caps'->'budget'->>'minor')::bigint AS budget_minor,
                (r.definition->'caps'->>'max_uses')::bigint        AS max_uses,
                p.version
           FROM commercial_rule r
           JOIN commercial_publication p ON p.id = r.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY r.rule_id, p.version DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let key: String = row.get("rule_id");
            let head = json!({
                "key": key,
                "rule_id": key,
                "name": row.get::<String, _>("name"),
                "status": row.get::<String, _>("status"),
                "priority": row.get::<i32, _>("priority"),
                // The envelope this rule belongs to, when it belongs to one. A
                // rule is live only when both it and its campaign are, so a
                // screen ranking rules by spend needs to be able to say which
                // campaign a paused one sits under.
                "campaign_id": row.get::<Option<String>, _>("campaign_id"),
                "budget_minor": row.get::<Option<i64>, _>("budget_minor"),
                "max_uses": row.get::<Option<i64>, _>("max_uses"),
                "publication_version": row.get::<i64, _>("version"),
            });
            (key, head)
        })
        .collect())
}

/// The newest published declaration of every coupon.
async fn coupons_described(pool: &PgPool) -> Result<BTreeMap<String, Value>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT ON (c.code)
                c.code, c.rule_id, c.active, c.customer_id, c.valid_from, c.valid_to,
                c.max_uses, p.version
           FROM commercial_coupon c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY c.code, p.version DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let key: String = row.get("code");
            let head = json!({
                "key": key,
                "coupon_code": key,
                // A coupon is a gate on a rule, never an offer of its own, so
                // the rule it unlocks is the first thing a reader needs.
                "rule_id": row.get::<String, _>("rule_id"),
                "active": row.get::<bool, _>("active"),
                "customer_id": row.get::<Option<String>, _>("customer_id"),
                "valid_from": row.get::<Option<DateTime<Utc>>, _>("valid_from"),
                "valid_to": row.get::<Option<DateTime<Utc>>, _>("valid_to"),
                "max_uses": row.get::<Option<i32>, _>("max_uses"),
                "publication_version": row.get::<i64, _>("version"),
            });
            (key, head)
        })
        .collect())
}

/// What each campaign cost and what came back, over a window and optionally at
/// one shop.
///
/// There is deliberately no fleet total. Summing the rows would double-count
/// every basket two campaigns both touched, and a total that is wrong in a way
/// nobody can see is worse than no total at all — the screen's own tiles are
/// per campaign anyway.
pub async fn campaign_performance(
    pool: &PgPool,
    window: &PerformanceWindow,
) -> Result<Value, AppError> {
    let rows = aggregate(pool, PromotionKey::Campaign, window).await?;
    let described = campaigns_described(pool).await?;
    let campaigns = stitch(rows, described, campaign_undeclared);
    let mut body = window.envelope();
    if let Some(object) = body.as_object_mut() {
        object.insert("campaigns".into(), Value::Array(campaigns));
    }
    Ok(body)
}

/// The same question asked of rules, and again of coupon codes.
///
/// Both in one response because they are one screen: a coupon does not discount
/// anything itself, it unlocks a rule, so a coupon's takings and its rule's
/// takings are read together or misread apart.
pub async fn rule_performance(
    pool: &PgPool,
    window: &PerformanceWindow,
) -> Result<Value, AppError> {
    let rules = stitch(
        aggregate(pool, PromotionKey::Rule, window).await?,
        rules_described(pool).await?,
        rule_undeclared,
    );
    let coupons = stitch(
        aggregate(pool, PromotionKey::Coupon, window).await?,
        coupons_described(pool).await?,
        coupon_undeclared,
    );
    let mut body = window.envelope();
    if let Some(object) = body.as_object_mut() {
        object.insert("rules".into(), Value::Array(rules));
        object.insert("coupons".into(), Value::Array(coupons));
    }
    Ok(body)
}

/// One style: what each of its products sold for, how many are left, and what
/// the last order paid for them.
///
/// Grouped by the price actually charged rather than by the price currently
/// published, because the question is what happened, not what is in force. A
/// product that sold forty at full price and sixty on clearance is two rows,
/// and collapsing them into an average would hide the only fact in the report.
///
/// Margin is not computed. The cost side is an ARTICLE-level number — a
/// purchase order names a style, not a size — so a per-size margin would be a
/// division of a real number by an assumption. The two integers ship and the
/// screen may subtract them if it says what it did.
pub async fn pricelist_performance(
    pool: &PgPool,
    article_code: &str,
    window: &PerformanceWindow,
) -> Result<Value, AppError> {
    let article_code = article_code.trim();
    if article_code.is_empty() {
        return Err(AppError::Validation(
            "article_code is required: this report is about one style".into(),
        ));
    }
    let article = sqlx::query(
        "SELECT article_code, name, division_code FROM article WHERE article_code = $1",
    )
    .bind(article_code)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no style {article_code}")))?;

    // Every product of the style, sold or not. A size with stock and no sales
    // is the row a buyer is looking for; leaving it out because nothing
    // happened would answer the opposite question.
    let skus = sqlx::query(
        "SELECT s.sku_code, s.color, s.size
           FROM sku s JOIN article a ON a.id = s.article_id
          WHERE a.article_code = $1 AND s.active
          ORDER BY s.sku_code",
    )
    .bind(article_code)
    .fetch_all(pool)
    .await?;

    let sold = sqlx::query(
        "SELECT l.sku_code, l.unit_price_minor, l.price_source, l.publication_version,
                sum(l.quantity)::bigint AS units,
                -- A line that predates `line_total_minor` still has a unit
                -- price and a quantity, and multiplying them is what the till
                -- charged. Skipping those lines would quietly under-report the
                -- oldest sales in any window that reaches back far enough.
                sum(COALESCE(l.line_total_minor, l.unit_price_minor * l.quantity))::bigint AS revenue_minor
           FROM edge_sale_line l
           JOIN edge_sale s ON s.sale_id = l.sale_id
           JOIN sku k ON k.sku_code = l.sku_code
           JOIN article a ON a.id = k.article_id
          WHERE a.article_code = $1
            AND s.occurred_at >= $2 AND s.occurred_at < $3
            AND ($4::text IS NULL OR s.site_id = $4)
          GROUP BY l.sku_code, l.unit_price_minor, l.price_source, l.publication_version
          ORDER BY l.sku_code, sum(l.quantity) DESC, l.unit_price_minor DESC",
    )
    .bind(article_code)
    .bind(window.from)
    .bind(window.to)
    .bind(window.site())
    .fetch_all(pool)
    .await?;

    // Stock as the projection holds it: operational places only, and only the
    // ones in NORMAL state — a unit sitting in a MISSING place is not on hand,
    // and counting it would make sell-through look worse than it is against
    // stock nobody can sell.
    let on_hand = sqlx::query(
        "SELECT k.sku_code, sum(pr.quantity)::bigint AS on_hand
           FROM inventory_projection pr
           JOIN inventory_place pl ON pl.id = pr.place_id
           JOIN operational_pool op ON op.id = pl.pool_id
           JOIN inventory_subject sub ON sub.id = pr.subject_id
           JOIN sku k ON k.id = sub.sku_id
           JOIN article a ON a.id = k.article_id
          WHERE a.article_code = $1
            AND pl.kind = 'OPERATIONAL' AND pl.state = 'NORMAL'
            AND ($2::text IS NULL OR op.site_id = $2)
          GROUP BY k.sku_code",
    )
    .bind(article_code)
    .bind(window.site())
    .fetch_all(pool)
    .await?;
    let on_hand: BTreeMap<String, i64> = on_hand
        .into_iter()
        .map(|row| (row.get("sku_code"), row.get("on_hand")))
        .collect();

    // What we last agreed to pay for this style. A draft order has not been
    // agreed and a cancelled one never was, so neither is evidence of a cost.
    let cost = sqlx::query(
        "SELECT l.unit_price_minor, o.po_number, COALESCE(o.issued_at, o.created_at) AS ordered_at
           FROM purchase_order_line l
           JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
          WHERE l.article_code = $1 AND o.order_status IN ('ISSUED', 'CLOSED')
          ORDER BY COALESCE(o.issued_at, o.created_at) DESC, l.line_number DESC
          LIMIT 1",
    )
    .bind(article_code)
    .fetch_optional(pool)
    .await?;

    let mut by_sku: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for row in &sold {
        by_sku.entry(row.get("sku_code")).or_default().push(json!({
            "unit_price_minor": row.get::<i64, _>("unit_price_minor"),
            // Null from a shop that sold without a book in force. Null
            // rather than "COMPANY_PRICE": "no book said so" and "the
            // company price said so" are different facts.
            "price_source": row.get::<Option<String>, _>("price_source"),
            "publication_version": row.get::<Option<i64>, _>("publication_version"),
            "units": row.get::<i64, _>("units"),
            "revenue_minor": row.get::<i64, _>("revenue_minor"),
        }));
    }

    let items: Vec<Value> = skus
        .into_iter()
        .map(|row| {
            let sku_code: String = row.get("sku_code");
            let prices = by_sku.remove(&sku_code).unwrap_or_default();
            let units: i64 = prices.iter().filter_map(|p| p["units"].as_i64()).sum();
            let revenue: i64 = prices
                .iter()
                .filter_map(|p| p["revenue_minor"].as_i64())
                .sum();
            json!({
                "sku_code": sku_code,
                "color": row.get::<Option<String>, _>("color"),
                "size": row.get::<Option<String>, _>("size"),
                "units": units,
                "revenue_minor": revenue,
                // Absent from the projection means none anywhere, which is a
                // zero rather than an unknown: the projection carries a row for
                // every place holding stock and nothing for the rest.
                "on_hand": on_hand.get(&sku_code).copied().unwrap_or(0),
                "prices": prices,
            })
        })
        .collect();

    // Products sold under a code the catalogue no longer lists as active. Kept
    // rather than dropped: the money was taken, and a report that silently
    // omits it does not add up against the day's takings.
    let retired: Vec<Value> = by_sku
        .into_iter()
        .map(|(sku_code, prices)| {
            let units: i64 = prices.iter().filter_map(|p| p["units"].as_i64()).sum();
            let revenue: i64 = prices
                .iter()
                .filter_map(|p| p["revenue_minor"].as_i64())
                .sum();
            json!({
                "sku_code": sku_code,
                "color": Value::Null,
                "size": Value::Null,
                "units": units,
                "revenue_minor": revenue,
                "on_hand": 0,
                "prices": prices,
            })
        })
        .collect();
    let items: Vec<Value> = items.into_iter().chain(retired).collect();

    let mut body = window.envelope();
    if let Some(object) = body.as_object_mut() {
        object.insert(
            "article_code".into(),
            json!(article.get::<String, _>("article_code")),
        );
        object.insert(
            "article_name".into(),
            json!(article.get::<String, _>("name")),
        );
        object.insert(
            "division_code".into(),
            json!(article.get::<Option<String>, _>("division_code")),
        );
        // Named, not implied. The cost is the last price agreed for the STYLE,
        // so a screen dividing it into a per-size price is doing something the
        // data does not support and this key is what tells it so.
        object.insert("cost_basis".into(), json!("ARTICLE_LATEST_PO"));
        object.insert(
            "cost_unit_minor".into(),
            json!(cost
                .as_ref()
                .map(|row| row.get::<i64, _>("unit_price_minor"))),
        );
        object.insert(
            "cost_source".into(),
            match &cost {
                Some(row) => json!({
                    "po_number": row.get::<String, _>("po_number"),
                    "ordered_at": row.get::<DateTime<Utc>, _>("ordered_at"),
                }),
                None => Value::Null,
            },
        );
        object.insert(
            "units".into(),
            json!(items
                .iter()
                .filter_map(|i| i["units"].as_i64())
                .sum::<i64>()),
        );
        object.insert(
            "revenue_minor".into(),
            json!(items
                .iter()
                .filter_map(|i| i["revenue_minor"].as_i64())
                .sum::<i64>()),
        );
        object.insert(
            "on_hand".into(),
            json!(items
                .iter()
                .filter_map(|i| i["on_hand"].as_i64())
                .sum::<i64>()),
        );
        object.insert("skus".into(), Value::Array(items));
    }
    Ok(body)
}

// ── sell-through, for the one objective that is about stock ────────────────
//
// Every other metric on a campaign is read from `edge_sale_promotion`: money
// the offers gave away, and the baskets that came back. "Clear seasonal
// inventory" is not that question. It does not ask what the discount cost, it
// asks whether the stock moved — and stock is not in the sale facts alone.
//
// Three properties of this number are worth stating once here rather than being
// rediscovered from a figure that looks wrong.
//
// **It counts every sale of those styles, not only the discounted ones.** A
// campaign run to clear a style succeeded if the style cleared. Half of it
// going out at full price beside the promotion is the campaign working, not a
// sale the campaign failed to touch, and narrowing this to promoted baskets
// would report a clearance as a failure precisely when it worked best.
//
// **On hand is AS OF NOW, never as of the window's end.** The projection holds
// one quantity per place and no history, so a finished campaign is scored
// against today's shelf rather than against the shelf on its closing day. For a
// running campaign — which is when somebody asks — that is exactly right. For
// one that ended last quarter it drifts, and `as_of` on the response is what
// says so.
//
// **A campaign that names no product cannot have one.** Sell-through is
// attributed to the styles the campaign's rules apply to; a whole-basket offer
// applies to everything, and "sell-through of the entire catalogue" is not a
// measure of anything. Such a campaign answers `null` with its reason rather
// than a number nobody could act on.

/// The styles a campaign's offers actually land on.
///
/// Read from each rule's own `scope.applicability`, which is the same document
/// the till applies — never re-derived from columns. A division or a tag is
/// resolved to the styles filed under it, because the stock sits on styles.
#[derive(Default)]
struct ScopedProducts {
    articles: Vec<String>,
    skus: Vec<String>,
    divisions: Vec<String>,
    tags: Vec<String>,
    /// Rules that apply to the whole basket, or to nothing in particular. They
    /// are counted rather than ignored: one of them is why a campaign has no
    /// sell-through, and the screen has to be able to say which.
    unscoped: i64,
    rules: i64,
}

fn scope_of(definition: &Value, into: &mut ScopedProducts) {
    into.rules += 1;
    let Some(on) = definition.get("scope").and_then(|s| s.get("applicability")) else {
        into.unscoped += 1;
        return;
    };
    let list = |key: &str| -> Vec<String> {
        on.get(key)
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    };
    match on.get("on").and_then(Value::as_str) {
        Some("ARTICLE") => into.articles.extend(list("article_codes")),
        Some("SKU") => into.skus.extend(list("sku_codes")),
        Some("DIVISION") => into.divisions.extend(list("divisions")),
        Some("TAG") => into.tags.extend(list("tags")),
        // `WHOLE_CART`, `null`, and anything a later build introduces that this
        // one has not been told about. Counted as unscoped rather than guessed:
        // a scope we cannot read must not quietly narrow the measure.
        _ => into.unscoped += 1,
    }
}

/// How much of what a campaign set out to shift has actually shifted.
pub async fn campaign_sell_through(
    pool: &PgPool,
    campaign_id: &str,
    window: &PerformanceWindow,
) -> Result<Value, AppError> {
    let campaign_id = campaign_id.trim();
    // The newest published book that names each rule owns it — the same rule a
    // shop applies when it replaces on `rule_id`. Without `DISTINCT ON`, a rule
    // restated three times would have its scope counted three times.
    let rules = sqlx::query(
        "SELECT DISTINCT ON (r.rule_id) r.rule_id, r.definition
           FROM commercial_rule r
           JOIN commercial_publication p ON p.id = r.publication_id
          WHERE p.status = 'PUBLISHED'
            AND r.definition->>'campaign_id' = $1
          ORDER BY r.rule_id, p.version DESC",
    )
    .bind(campaign_id)
    .fetch_all(pool)
    .await?;

    let mut scope = ScopedProducts::default();
    for row in &rules {
        scope_of(&row.get::<Value, _>("definition"), &mut scope);
    }

    let codes: Vec<String> = sqlx::query(
        "SELECT DISTINCT a.article_code
           FROM article a
           LEFT JOIN sku k ON k.article_id = a.id
           LEFT JOIN article_tag t ON t.article_id = a.id
          WHERE a.article_code = ANY($1)
             OR k.sku_code = ANY($2)
             OR a.division_code = ANY($3)
             OR t.tag_code = ANY($4)
          ORDER BY a.article_code",
    )
    .bind(&scope.articles)
    .bind(&scope.skus)
    .bind(&scope.divisions)
    .bind(&scope.tags)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| row.get::<String, _>("article_code"))
    .collect();

    let scope_note = json!({
        "rules": scope.rules,
        "unscoped_rules": scope.unscoped,
        "articles": codes.len(),
    });

    if codes.is_empty() {
        return Ok(json!({
            "campaign_id": campaign_id,
            "as_of": Utc::now(),
            "from": window.from,
            "to": window.to,
            "site_id": window.site(),
            "scope": scope_note,
            "units_sold": 0,
            "on_hand": 0,
            // Not zero per cent. Zero would read as "nothing sold", and the
            // truth is that there is nothing this campaign can be measured
            // against — which is a different thing to tell somebody.
            "sell_through_bps": Value::Null,
            "articles": [],
        }));
    }

    let rows = sqlx::query(
        "WITH scope AS (SELECT unnest($1::text[]) AS article_code),
              sold AS (
                  SELECT a.article_code, sum(l.quantity)::bigint AS units
                    FROM edge_sale_line l
                    JOIN edge_sale s ON s.sale_id = l.sale_id
                    JOIN sku k ON k.sku_code = l.sku_code
                    JOIN article a ON a.id = k.article_id
                   WHERE a.article_code = ANY($1)
                     AND s.occurred_at >= $2 AND s.occurred_at < $3
                     AND ($4::text IS NULL OR s.site_id = $4)
                   GROUP BY a.article_code
              ),
              held AS (
                  -- Stock the fleet can still sell: operational places in a
                  -- NORMAL state. A unit in a MISSING place is not on hand, and
                  -- counting it would flatter the sell-through of exactly the
                  -- styles somebody has lost track of.
                  SELECT a.article_code, sum(pr.quantity)::bigint AS on_hand
                    FROM inventory_projection pr
                    JOIN inventory_place pl ON pl.id = pr.place_id
                    JOIN operational_pool op ON op.id = pl.pool_id
                    JOIN inventory_subject sub ON sub.id = pr.subject_id
                    JOIN sku k ON k.id = sub.sku_id
                    JOIN article a ON a.id = k.article_id
                   WHERE a.article_code = ANY($1)
                     AND pl.kind = 'OPERATIONAL' AND pl.state = 'NORMAL'
                     AND ($4::text IS NULL OR op.site_id = $4)
                   GROUP BY a.article_code
              )
         SELECT sc.article_code,
                ar.name,
                COALESCE(sold.units, 0)::bigint   AS units,
                COALESCE(held.on_hand, 0)::bigint AS on_hand
           FROM scope sc
           LEFT JOIN article ar ON ar.article_code = sc.article_code
           LEFT JOIN sold ON sold.article_code = sc.article_code
           LEFT JOIN held ON held.article_code = sc.article_code
          ORDER BY sc.article_code",
    )
    .bind(&codes)
    .bind(window.from)
    .bind(window.to)
    .bind(window.site())
    .fetch_all(pool)
    .await?;

    let mut sold_total: i64 = 0;
    let mut held_total: i64 = 0;
    let articles: Vec<Value> = rows
        .iter()
        .map(|row| {
            let units: i64 = row.get("units");
            let on_hand: i64 = row.get("on_hand");
            sold_total += units;
            held_total += on_hand;
            json!({
                "article_code": row.get::<String, _>("article_code"),
                "name": row.get::<Option<String>, _>("name"),
                "units_sold": units,
                "on_hand": on_hand,
                "sell_through_bps": through(units, on_hand),
            })
        })
        .collect();

    Ok(json!({
        "campaign_id": campaign_id,
        // When the shelf was read. Not the end of the window — see the module
        // note: on hand has no history, so this is the date the denominator
        // came from.
        "as_of": Utc::now(),
        "from": window.from,
        "to": window.to,
        "site_id": window.site(),
        "scope": scope_note,
        "units_sold": sold_total,
        "on_hand": held_total,
        "sell_through_bps": through(sold_total, held_total),
        "articles": articles,
    }))
}

/// Sold over what was ever available to sell, in basis points.
///
/// `None` when the two are both nought: a style that sold nothing and holds
/// nothing was never in the campaign's way, and 0% would put it at the top of a
/// list of things that are not shifting.
fn through(sold: i64, on_hand: i64) -> Option<i64> {
    let available = sold + on_hand;
    if available <= 0 {
        return None;
    }
    Some((sold * 10_000) / available)
}
