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
//! everything below reads.
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
    sale_count: i64,
    basket_revenue_minor: i64,
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
            sale_count: 0,
            basket_revenue_minor: 0,
            customer_count: 0,
            new_customer_count: 0,
            previous: json!({
                "benefit_minor": 0,
                "sale_count": 0,
                "basket_revenue_minor": 0,
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
        object.insert("sale_count".into(), json!(self.sale_count));
        object.insert(
            "basket_revenue_minor".into(),
            json!(self.basket_revenue_minor),
        );
        object.insert("customer_count".into(), json!(self.customer_count));
        object.insert("new_customer_count".into(), json!(self.new_customer_count));
        object.insert("previous".into(), self.previous);
        object.insert("series".into(), self.series);
        Value::Object(object)
    }
}

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
    let sql = format!(
        "WITH scoped AS (
             SELECT p.{column} AS key, p.sale_id, s.occurred_at, s.total_minor, s.customer_id,
                    sum(p.benefit_minor)::bigint AS benefit_minor
               FROM edge_sale_promotion p
               JOIN edge_sale s ON s.sale_id = p.sale_id
              WHERE p.{column} IS NOT NULL
                AND s.occurred_at >= $1 AND s.occurred_at < $3
                AND ($4::text IS NULL OR s.site_id = $4)
              GROUP BY p.{column}, p.sale_id, s.occurred_at, s.total_minor, s.customer_id
         ), first_sale AS (
             -- A shopper's first purchase anywhere, ever. Not filtered by site
             -- or by window on purpose: somebody who has shopped with us for
             -- years is not a new customer because this is their first visit to
             -- this branch.
             SELECT customer_id, min(occurred_at) AS first_at
               FROM edge_sale WHERE customer_id IS NOT NULL GROUP BY customer_id
         ), marked AS (
             SELECT scoped.*, (f.first_at >= $2 AND f.first_at < $3) AS new_now,
                    (f.first_at >= $1 AND f.first_at < $2) AS new_before
               FROM scoped LEFT JOIN first_sale f ON f.customer_id = scoped.customer_id
         ), points AS (
             SELECT key, (occurred_at AT TIME ZONE 'UTC')::date AS day,
                    sum(benefit_minor)::bigint AS benefit_minor,
                    count(*)::bigint           AS sale_count,
                    sum(total_minor)::bigint   AS basket_revenue_minor
               FROM scoped WHERE occurred_at >= $2
              GROUP BY key, (occurred_at AT TIME ZONE 'UTC')::date
         ), series AS (
             SELECT key, jsonb_agg(jsonb_build_object(
                        'day', day::text,
                        'benefit_minor', benefit_minor,
                        'sale_count', sale_count,
                        'basket_revenue_minor', basket_revenue_minor
                    ) ORDER BY day) AS series
               FROM points GROUP BY key
         ), totals AS (
             SELECT m.key,
                    COALESCE(sum(m.benefit_minor) FILTER (WHERE m.occurred_at >= $2), 0)::bigint AS benefit_minor,
                    count(*) FILTER (WHERE m.occurred_at >= $2)                        AS sale_count,
                    COALESCE(sum(m.total_minor) FILTER (WHERE m.occurred_at >= $2), 0)::bigint AS basket_revenue_minor,
                    count(DISTINCT m.customer_id) FILTER (WHERE m.occurred_at >= $2)   AS customer_count,
                    count(DISTINCT m.customer_id) FILTER (WHERE m.occurred_at >= $2 AND m.new_now) AS new_customer_count,
                    COALESCE(sum(m.benefit_minor) FILTER (WHERE m.occurred_at < $2), 0)::bigint AS prev_benefit_minor,
                    count(*) FILTER (WHERE m.occurred_at < $2)                         AS prev_sale_count,
                    COALESCE(sum(m.total_minor) FILTER (WHERE m.occurred_at < $2), 0)::bigint AS prev_basket_revenue_minor,
                    count(DISTINCT m.customer_id) FILTER (WHERE m.occurred_at < $2)    AS prev_customer_count,
                    count(DISTINCT m.customer_id) FILTER (WHERE m.occurred_at < $2 AND m.new_before) AS prev_new_customer_count
               FROM marked m GROUP BY m.key
         )
         SELECT t.*, COALESCE(x.series, '[]'::jsonb) AS series
           FROM totals t LEFT JOIN series x ON x.key = t.key
          ORDER BY t.benefit_minor DESC, t.key"
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
            sale_count: row.get("sale_count"),
            basket_revenue_minor: row.get("basket_revenue_minor"),
            customer_count: row.get("customer_count"),
            new_customer_count: row.get("new_customer_count"),
            previous: json!({
                "benefit_minor": row.get::<i64, _>("prev_benefit_minor"),
                "sale_count": row.get::<i64, _>("prev_sale_count"),
                "basket_revenue_minor": row.get::<i64, _>("prev_basket_revenue_minor"),
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
        by_sku
            .entry(row.get("sku_code"))
            .or_default()
            .push(json!({
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
        object.insert("article_code".into(), json!(article.get::<String, _>("article_code")));
        object.insert("article_name".into(), json!(article.get::<String, _>("name")));
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
            json!(cost.as_ref().map(|row| row.get::<i64, _>("unit_price_minor"))),
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
            json!(items.iter().filter_map(|i| i["units"].as_i64()).sum::<i64>()),
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
            json!(items.iter().filter_map(|i| i["on_hand"].as_i64()).sum::<i64>()),
        );
        object.insert("skus".into(), Value::Array(items));
    }
    Ok(body)
}
