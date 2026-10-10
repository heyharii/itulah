//! Sales per division at average cost — the client's 7Soft report
//! "SUMMARY PENJUALAN per DIVISI By HPP rata2", read from the centre's own
//! sales.
//!
//! One row per division: quantity, gross, discount, returns, net and the cost
//! of what was sold. Gross profit, margin, mark-up and each division's share
//! of the net are arithmetic over these figures and are left to the screen, so
//! there is one place that rounds them.
//!
//! **The Sales menu's breakdowns** (`sales_breakdown`: by tag, by division,
//! by store) are the same figures per group, with each shop's stock beside
//! them and the window in steps for a chart. By tag they read the tags each
//! article carried when it sold (not retroactive: see `SalesBreakdown`). A
//! tag is not a partition — an article carries any number of them — so its
//! rows overlap and every total is read on its own, every line once.
//!
//! # Where each figure comes from
//!
//! * **Sales** are the shops' tills (`edge_sale` / `edge_sale_line`) plus
//!   anything rung up centrally (`sale` / `sale_line`), dated by the day the
//!   sale was completed in the selling site's own business timezone
//!   (`site_local_date`, WIB for every site today) — the same day the sales
//!   posting books it on.
//! * **Gross** is quantity × the unit price the till charged. A clearance
//!   markdown is already inside that price, as it was in 7Soft's selling
//!   price, so it is not a discount here. **Discount** is gross less what the
//!   line was finally charged (`line_total_minor`): promotions and the
//!   basket discount apportioned onto the line. Amounts are what the customer
//!   paid, tax included, as the tills and 7Soft show them.
//! * **Returns** are `sale_return_line.refund_minor`, dated by the day the
//!   goods came back, whatever day they were sold on.
//! * **Voided sales** (7Soft's PEMBATALAN PENJUALAN) are kept out of every row
//!   and counted on their own line, as the sales posting keeps them out of the
//!   day.
//!
//! # The cost: HPP rata-rata
//!
//! Each unit sold is costed at its article's average receipt cost as it stood
//! on the day of the sale: the cost layers the goods receipts opened for that
//! article on or before that day (`cost_layer`, plus the live non-opening
//! `cost_layer_adjustment`s — the same `effective_cost_minor` the
//! `cost_layer_remaining` view reads), total value over total quantity. An
//! article with no layer by then (sold before its receipt was verified) takes
//! the average of the layers it has since, which is where the "cost pending"
//! true-up leaves the ledger; one never received costs nothing.
//!
//! Those are the layers the sales posting's COGS entry (`COGS_DAY`, "HPP
//! {site} {date}") consumes, so where an article carries one receipt cost —
//! the norm, since every new item gets its own SKU (stage 5 owner decision 1)
//! — this is exactly the value the ledger's Beban Pokok Penjualan takes. Where
//! an article has several costs the ledger takes FIFO and this report takes
//! the average, which is what 7Soft's "HPP rata-rata" means.
//!
//! The report prices sales rather than reading the posted consumption back
//! from `stock_ledger_entry` on purpose: a day not yet posted must still have
//! a cost, and a figure read back from the ledger can only be as complete as
//! the posting that wrote it.
//!
//! Cost comes off for returned goods put back on the shelf (`restock`), as the
//! COGS posting nets them; a return that was not restocked keeps its cost,
//! because those goods did not come back into stock.

use crate::cloud::application::AppError;
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};

/// One division's sales for the period.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DivisionSalesRow {
    /// The division master's code. Empty for articles with no division, and
    /// for sold SKUs the catalogue no longer knows.
    pub division_code: String,
    pub division_name: String,
    /// Pieces sold, less pieces returned.
    pub quantity: i64,
    /// Quantity × the price the till charged, markdowns already applied.
    pub gross_minor: i64,
    /// Promotions and basket discounts.
    pub discount_minor: i64,
    /// Refunds for goods brought back in the period.
    pub returns_minor: i64,
    /// Gross − discount − returns.
    pub net_minor: i64,
    /// Cost of what was sold, at the article's average receipt cost (HPP
    /// rata-rata), less the cost of goods returned to stock.
    pub cost_minor: i64,
}

/// The same figures, for every division together.
#[derive(Clone, Debug, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DivisionSalesTotal {
    pub quantity: i64,
    pub gross_minor: i64,
    pub discount_minor: i64,
    pub returns_minor: i64,
    pub net_minor: i64,
    pub cost_minor: i64,
}

/// Sales taken back at the till, kept out of the rows (PEMBATALAN PENJUALAN).
#[derive(Clone, Debug, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoidedSales {
    pub count: i64,
    /// What the voided sales had charged, under the same filters as the rows.
    pub gross_minor: i64,
}

/// The report: one row per division, their total, and the voids.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SalesByDivision {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// A unit id; absent means every unit (7Soft's "Semua Cabang").
    pub unit: Option<String>,
    /// An article tag code (the article master's category); absent means all.
    pub category: Option<String>,
    pub rows: Vec<DivisionSalesRow>,
    pub total: DivisionSalesTotal,
    pub voided: VoidedSales,
}

/// Every sold line in the window, completed or voided, with its article and
/// the day it counts on. `$1`/`$2` are the dates, `$3` the unit, `$4` a tag (as
/// the article carries it now, for the 7Soft report) and `$5` a division (as
/// the article was when it sold, for the breakdowns). The time bounds are a day wider than the dates on either
/// side so the index on the sale time does the work before `site_local_date`
/// decides.
const SOLD_LINES: &str = "
    sold AS (
        SELECT e.sale_id, e.status, e.site_id, sk.article_id,
               -- The shift's day (0714), not the clock's.
               e.business_date AS day,
               e.occurred_at AS sold_at,
               el.quantity,
               (el.quantity * el.unit_price_minor)::bigint AS gross_minor,
               COALESCE(el.line_total_minor, el.quantity * el.unit_price_minor)::bigint
                   AS charged_minor,
               -- What the breakdowns read off the line as it was rung up.
               'edge'::text AS origin, el.subject_id, el.epc, el.sku_code,
               el.publication_version, e.shift_id
          FROM edge_sale e
          JOIN edge_sale_line el ON el.sale_id = e.sale_id
          LEFT JOIN sku sk ON sk.sku_code = el.sku_code
         WHERE e.occurred_at >= ($1::date - 1)::timestamptz
           AND e.occurred_at <  ($2::date + 2)::timestamptz
        UNION ALL
        SELECT s.id, s.status, s.site_id, sk.article_id,
               site_local_date(s.completed_at, s.site_id),
               s.completed_at,
               sl.quantity,
               sl.total_minor,
               sl.total_minor,
               'centre', sl.subject_id, su.epc, sk.sku_code, NULL::bigint, NULL::uuid
          FROM sale s
          JOIN sale_line sl ON sl.sale_id = s.id
          JOIN sku sk ON sk.id = sl.sku_id
          LEFT JOIN inventory_subject su ON su.id = sl.subject_id
         WHERE s.status IN ('COMPLETED', 'VOIDED')
           AND s.completed_at IS NOT NULL
           AND s.completed_at >= ($1::date - 1)::timestamptz
           AND s.completed_at <  ($2::date + 2)::timestamptz
    ),
    scoped AS (
        SELECT so.*
          FROM sold so
         WHERE so.day BETWEEN $1 AND $2
           AND ($3::text IS NULL OR unit_of_site(so.site_id) = $3)
           AND ($4::text IS NULL OR EXISTS (
                   SELECT 1 FROM article_tag t
                    WHERE t.article_id = so.article_id AND t.tag_code = $4))
           AND ($5::text IS NULL OR EXISTS (
                   SELECT 1 FROM article_division_period dp
                    WHERE dp.article_id = so.article_id AND dp.division_code = $5
                      AND dp.valid_from <= so.sold_at
                      AND (dp.valid_to IS NULL OR so.sold_at < dp.valid_to)))
    )";

/// Every sale and return in scope as one signed movement per line, costed at
/// HPP rata-rata. Follows `SOLD_LINES` in the same `WITH`, and takes the same
/// five parameters.
const MOVEMENT: &str = "
         returned AS (
             SELECT r.site_id, sk.article_id,
                    site_local_date(r.created_at, r.site_id) AS day,
                    r.created_at AS sold_at,
                    rl.quantity, rl.refund_minor, rl.restock,
                    r.id AS return_id, rl.subject_id, su.epc, sk.sku_code
               FROM sale_return r
               JOIN sale_return_line rl ON rl.return_id = r.id
               JOIN sku sk ON sk.id = rl.sku_id
               LEFT JOIN inventory_subject su ON su.id = rl.subject_id
              WHERE r.created_at >= ($1::date - 1)::timestamptz
                AND r.created_at <  ($2::date + 2)::timestamptz
         ),
         returned_scoped AS (
             SELECT rt.*
               FROM returned rt
              WHERE rt.day BETWEEN $1 AND $2
                AND ($3::text IS NULL OR unit_of_site(rt.site_id) = $3)
                AND ($4::text IS NULL OR EXISTS (
                        SELECT 1 FROM article_tag t
                         WHERE t.article_id = rt.article_id AND t.tag_code = $4))
                AND ($5::text IS NULL OR EXISTS (
                        SELECT 1 FROM article_division_period dp
                         WHERE dp.article_id = rt.article_id AND dp.division_code = $5
                           AND dp.valid_from <= rt.sold_at
                           AND (dp.valid_to IS NULL OR rt.sold_at < dp.valid_to)))
         ),
         -- HPP rata-rata: one average per article and day, over the layers
         -- the receipts opened by then (see the module comment).
         costed AS (
             SELECT k.article_id, k.day,
                    COALESCE(c.value_then / NULLIF(c.qty_then, 0),
                             c.value_all / NULLIF(c.qty_all, 0),
                             0) AS unit_cost
               FROM (SELECT article_id, day FROM scoped
                      WHERE status = 'COMPLETED' AND article_id IS NOT NULL
                     UNION
                     SELECT article_id, day FROM returned_scoped WHERE restock) k
               LEFT JOIN LATERAL (
                   SELECT SUM(l.quantity) FILTER (WHERE l.economic_date <= k.day)::numeric
                              AS qty_then,
                          SUM(l.opening_cost_minor + COALESCE(adj.total, 0))
                              FILTER (WHERE l.economic_date <= k.day)::numeric AS value_then,
                          SUM(l.quantity)::numeric AS qty_all,
                          SUM(l.opening_cost_minor + COALESCE(adj.total, 0))::numeric
                              AS value_all
                     FROM cost_layer l
                     LEFT JOIN LATERAL (
                         SELECT SUM(a.amount_minor) AS total
                           FROM cost_layer_adjustment a
                           JOIN cost_component_type t ON t.component_type = a.component_type
                          WHERE a.layer_id = l.layer_id
                            AND a.superseded_by IS NULL
                            AND NOT t.is_opening
                     ) adj ON true
                    WHERE l.article_id = k.article_id
               ) c ON true
         ),
         movement AS (
             SELECT sc.article_id, sc.site_id, sc.day, sc.sold_at,
                    sc.quantity AS sold_qty,
                    sc.gross_minor,
                    sc.gross_minor - sc.charged_minor AS discount_minor,
                    0::bigint AS returned_qty,
                    0::bigint AS refund_minor,
                    sc.quantity * COALESCE(co.unit_cost, 0) AS cost,
                    sc.origin, sc.sale_id, NULL::uuid AS return_id, sc.subject_id,
                    sc.epc, sc.sku_code, sc.publication_version, sc.shift_id
               FROM scoped sc
               LEFT JOIN costed co ON co.article_id = sc.article_id AND co.day = sc.day
              WHERE sc.status = 'COMPLETED'
             UNION ALL
             SELECT rs.article_id, rs.site_id, rs.day, rs.sold_at, 0, 0, 0,
                    rs.quantity,
                    rs.refund_minor,
                    CASE WHEN rs.restock THEN -rs.quantity * COALESCE(co.unit_cost, 0)
                         ELSE 0 END,
                    'centre', NULL::uuid, rs.return_id, rs.subject_id,
                    rs.epc, rs.sku_code, NULL::bigint, NULL::uuid
               FROM returned_scoped rs
               LEFT JOIN costed co ON co.article_id = rs.article_id AND co.day = rs.day
         )";

/// Read the report.
pub async fn sales_by_division(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
    unit: Option<&str>,
    category: Option<&str>,
) -> Result<SalesByDivision, AppError> {
    if to < from {
        return Err(AppError::Validation(
            "the period ends before it starts".into(),
        ));
    }
    let unit = unit.map(str::trim).filter(|u| !u.is_empty());
    let category = category.map(str::trim).filter(|c| !c.is_empty());

    let sql = format!(
        "WITH {SOLD_LINES}, {MOVEMENT}
         SELECT COALESCE(a.division_code, '') AS division_code,
                COALESCE(d.label, a.division_code, 'Unclassified') AS division_name,
                (SUM(m.sold_qty) - SUM(m.returned_qty))::bigint AS quantity,
                SUM(m.gross_minor)::bigint AS gross_minor,
                SUM(m.discount_minor)::bigint AS discount_minor,
                SUM(m.refund_minor)::bigint AS returns_minor,
                ROUND(SUM(m.cost))::bigint AS cost_minor
           FROM movement m
           LEFT JOIN article a ON a.id = m.article_id
           LEFT JOIN division d ON d.code = a.division_code
          GROUP BY 1, 2, d.display_order
          ORDER BY (COALESCE(a.division_code, '') = ''), d.display_order NULLS LAST, 1"
    );

    let rows = sqlx::query(&sql)
        .bind(from)
        .bind(to)
        .bind(unit)
        .bind(category)
        .bind(None::<&str>)
        .fetch_all(pool)
        .await?;

    let mut total = DivisionSalesTotal::default();
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let gross_minor: i64 = row.try_get("gross_minor")?;
        let discount_minor: i64 = row.try_get("discount_minor")?;
        let returns_minor: i64 = row.try_get("returns_minor")?;
        let division = DivisionSalesRow {
            division_code: row.try_get("division_code")?,
            division_name: row.try_get("division_name")?,
            quantity: row.try_get("quantity")?,
            gross_minor,
            discount_minor,
            returns_minor,
            net_minor: gross_minor - discount_minor - returns_minor,
            cost_minor: row.try_get("cost_minor")?,
        };
        total.quantity += division.quantity;
        total.gross_minor += division.gross_minor;
        total.discount_minor += division.discount_minor;
        total.returns_minor += division.returns_minor;
        total.net_minor += division.net_minor;
        total.cost_minor += division.cost_minor;
        out.push(division);
    }

    Ok(SalesByDivision {
        from,
        to,
        unit: unit.map(str::to_string),
        category: category.map(str::to_string),
        rows: out,
        total,
        voided: voided_sales(pool, from, to, unit, category, None).await?,
    })
}

/// The voids under the same filters as the rows, kept out of them.
async fn voided_sales(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
    unit: Option<&str>,
    tag: Option<&str>,
    division: Option<&str>,
) -> Result<VoidedSales, AppError> {
    // Straight to the voided sales (a partial index, 0930) rather than every
    // line of the window: voids are a few in a hundred.
    let voided = sqlx::query(
        "WITH voided AS (
             SELECT e.sale_id, e.site_id, e.occurred_at AS sold_at, sk.article_id,
                    COALESCE(el.line_total_minor, el.quantity * el.unit_price_minor)::bigint
                        AS charged_minor
               FROM edge_sale e
               JOIN edge_sale_line el ON el.sale_id = e.sale_id
               LEFT JOIN sku sk ON sk.sku_code = el.sku_code
              WHERE e.status = 'VOIDED' AND e.business_date BETWEEN $1 AND $2
             UNION ALL
             SELECT s.id, s.site_id, s.completed_at, sk.article_id, sl.total_minor
               FROM sale s
               JOIN sale_line sl ON sl.sale_id = s.id
               JOIN sku sk ON sk.id = sl.sku_id
              WHERE s.status = 'VOIDED' AND s.completed_at IS NOT NULL
                AND s.completed_at >= ($1::date - 1)::timestamptz
                AND s.completed_at <  ($2::date + 2)::timestamptz
                AND site_local_date(s.completed_at, s.site_id) BETWEEN $1 AND $2
         )
         SELECT COUNT(DISTINCT v.sale_id)::bigint AS count,
                COALESCE(SUM(v.charged_minor), 0)::bigint AS gross_minor
           FROM voided v
          WHERE ($3::text IS NULL OR unit_of_site(v.site_id) = $3)
            AND ($4::text IS NULL OR EXISTS (
                    SELECT 1 FROM article_tag t
                     WHERE t.article_id = v.article_id AND t.tag_code = $4))
            AND ($5::text IS NULL OR EXISTS (
                    SELECT 1 FROM article_division_period dp
                     WHERE dp.article_id = v.article_id AND dp.division_code = $5
                       AND dp.valid_from <= v.sold_at
                       AND (dp.valid_to IS NULL OR v.sold_at < dp.valid_to)))",
    )
    .bind(from)
    .bind(to)
    .bind(unit)
    .bind(tag)
    .bind(division)
    .fetch_one(pool)
    .await?;
    Ok(VoidedSales {
        count: voided.try_get("count")?,
        gross_minor: voided.try_get("gross_minor")?,
    })
}

// ---------------------------------------------------------------------------
// Sales by tag, by store, by division
// ---------------------------------------------------------------------------

/// What a breakdown groups by. Every one reads what was true when the line
/// was rung up (owner, 30 Sep 2026: "semuanya tidak ada yg berlaku surut").
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BreakdownBy {
    /// The tags each article carried when it sold (`article_tag_period`).
    /// Overlapping: an article under two tags is in both rows.
    Tag,
    /// The division each article was in when it sold
    /// (`article_division_period`).
    Division,
    /// The shop that made the sale.
    Store,
    /// The article: an identity, which nothing re-files.
    Article,
    /// The SKU as the till rang it up.
    Sku,
    /// The purchase order the very piece came in on, read off its EPC
    /// (`po_line_of_epc`). A piece with no EPC of ours has no order.
    Po,
    /// That order's supplier, as the order named it.
    Supplier,
    /// The campaigns whose promotions or markdowns the till applied to the
    /// line, named as the publication it sold under named them. Overlapping,
    /// like tags; a line no campaign touched is "No campaign".
    Campaign,
    /// How the sale was paid, each line split across the sale's tenders in
    /// proportion (change off the cash). Returns by how they were refunded.
    Payment,
    /// The cashier's session (`cash_shift`) the sale was rung on: one person
    /// at one seat, from opening the drawer to counting it. A sale rung with
    /// no shift open, a central sale and a return have none.
    Session,
}

/// How one grouping reads over the sold lines (`movement m`) or the stock
/// on hand (`on_hand x`): extra CTEs, the code and name, the joins, and the
/// share of a line that falls in the group (below 1 only when paid by
/// several tenders).
struct Grouping {
    ctes: &'static str,
    code: &'static str,
    name: &'static str,
    joins: &'static str,
    weight: &'static str,
}

impl Grouping {
    const fn plain(code: &'static str, name: &'static str, joins: &'static str) -> Self {
        Self {
            ctes: "",
            code,
            name,
            joins,
            weight: "1",
        }
    }
}

/// The piece's order, for by PO and by supplier. `{row}` is `m` or `x`.
macro_rules! order_of {
    ($row:literal) => {
        concat!(
            "LEFT JOIN purchase_order_line pol ON pol.po_line_id = po_line_of_epc(",
            $row,
            ".epc)
             LEFT JOIN purchase_order po ON po.purchase_order_id = pol.purchase_order_id"
        )
    };
}

/// The SKU's article, colour and size, for by SKU. `{row}` is `m` or `x`.
macro_rules! sku_of {
    ($row:literal) => {
        concat!(
            "LEFT JOIN sku k ON k.sku_code = ",
            $row,
            ".sku_code
             LEFT JOIN article a ON a.id = k.article_id
             LEFT JOIN article_colour ac
                    ON ac.article_id = a.id AND ac.colour_digit = k.colour_digit
             LEFT JOIN size_code sz ON sz.code = k.size_code"
        )
    };
}

/// The order an article came in on, for the summary's rows `r`.
const ORDER_OF_ARTICLE: &str = "LEFT JOIN article_purchase_line apl ON apl.article_id = r.article_id
     LEFT JOIN purchase_order_line pol ON pol.po_line_id = apl.po_line_id
     LEFT JOIN purchase_order po ON po.purchase_order_id = pol.purchase_order_id";

/// The summary's rows in the window: `$1`/`$2` the dates, `$3` a unit, `$4` a
/// division as sold.
const ROLLUP_ROWS: &str = "
    r AS (
        SELECT d.*
          FROM sales_sku_day d
         WHERE d.business_date BETWEEN $1 AND $2
           AND ($3::text IS NULL OR unit_of_site(d.site_id) = $3)
           AND ($4::text IS NULL OR d.division_code = $4)
    )";

const PO_CODE: &str = "COALESCE(po.po_number, '')";
const PO_NAME: &str = "COALESCE(po.po_number
                    || COALESCE(' · ' || COALESCE(po.supplier_name_snapshot, po.supplier_name), ''),
                    'No PO')";
const SUPPLIER_CODE: &str = "COALESCE(po.supplier_code_snapshot, po.supplier_id, '')";
const SUPPLIER_NAME: &str =
    "COALESCE(po.supplier_name_snapshot, po.supplier_name, po.supplier_id, 'No supplier')";
const ARTICLE_NAME: &str = "COALESCE(a.article_code || ' · ' || a.name, 'Unknown article')";
/// "20114300101 · Kemeja Oxford · Navy / M". `{row}` is `m` or `x`.
macro_rules! sku_name {
    ($row:literal) => {
        concat!(
            "concat_ws(' · ', ",
            $row,
            ".sku_code, a.name, NULLIF(concat_ws(' / ', ac.label, sz.label), ''))"
        )
    };
}

/// The campaigns that touched each edge line: a promotion rule's, and a
/// markdown's as the line's publication froze it.
const PROMOTED: &str = ",
    promoted AS (
        SELECT m.sale_id, m.subject_id, p.campaign_id
          FROM movement m
          JOIN edge_sale_promotion_line pl
            ON pl.sale_id = m.sale_id AND pl.subject_id = m.subject_id
          JOIN edge_sale_promotion p ON p.sale_id = pl.sale_id AND p.rule_id = pl.rule_id
         WHERE m.origin = 'edge' AND p.campaign_id IS NOT NULL
        UNION
        SELECT m.sale_id, m.subject_id, md.campaign_id
          FROM movement m
          JOIN edge_sale_line el ON el.sale_id = m.sale_id AND el.subject_id = m.subject_id
          JOIN commercial_publication pub ON pub.version = el.publication_version
          JOIN commercial_markdown md
            ON md.publication_id = pub.id AND md.markdown_id = el.markdown_id
         WHERE m.origin = 'edge' AND md.campaign_id IS NOT NULL
    )";

/// Each sale's (and return's) tenders as shares of what it was paid with.
/// Change is given back in cash, so it comes off the cash tender first.
const TENDERED: &str = ",
    tender AS (
        SELECT t.sale_id AS doc, t.method, t.card_kind, t.acquirer,
               t.amount_minor::numeric AS amount
          FROM edge_sale_tender t
         WHERE t.sale_id IN (SELECT sale_id FROM movement WHERE origin = 'edge')
        UNION ALL
        SELECT e.sale_id, 'CASH', NULL, NULL, -e.change_minor::numeric
          FROM edge_sale e
         WHERE e.change_minor > 0
           AND e.sale_id IN (SELECT sale_id FROM movement WHERE origin = 'edge')
        UNION ALL
        SELECT p.sale_id, p.method, p.card_kind, p.acquirer, p.amount_minor::numeric
          FROM sale_payment p
         WHERE p.sale_id IN (SELECT sale_id FROM movement WHERE origin = 'centre')
        UNION ALL
        SELECT s.id, 'CASH', NULL, NULL, -s.change_minor::numeric
          FROM sale s
         WHERE s.change_minor > 0
           AND s.id IN (SELECT sale_id FROM movement WHERE origin = 'centre')
        UNION ALL
        SELECT p.return_id, p.method, p.card_kind, p.acquirer, p.amount_minor::numeric
          FROM sale_return_payment p
         WHERE p.return_id IN (SELECT return_id FROM movement)
    ),
    tender_way AS (
        SELECT tt.doc,
               COALESCE(pm.code, tt.method || COALESCE('_' || tt.card_kind, '')) AS code,
               COALESCE(pm.name, initcap(tt.method) || COALESCE(' ' || lower(tt.card_kind), ''))
                   AS name,
               SUM(tt.amount) AS amount
          FROM tender tt
          LEFT JOIN payment_method pm
                 ON pm.bank_code = COALESCE(tt.acquirer, '')
                AND pm.tender_type = CASE
                        WHEN tt.method = 'CARD' AND tt.card_kind = 'CREDIT' THEN 'CREDIT_CARD'
                        WHEN tt.method = 'CARD' THEN 'DEBIT_CARD'
                        ELSE tt.method END
         GROUP BY 1, 2, 3
    ),
    tender_share AS (
        SELECT doc, code, name,
               amount / NULLIF(SUM(amount) OVER (PARTITION BY doc), 0) AS weight
          FROM tender_way
         WHERE amount > 0
    )";

impl BreakdownBy {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "tag" => Ok(Self::Tag),
            "division" => Ok(Self::Division),
            "store" => Ok(Self::Store),
            "article" => Ok(Self::Article),
            "sku" => Ok(Self::Sku),
            "po" => Ok(Self::Po),
            "supplier" => Ok(Self::Supplier),
            "campaign" => Ok(Self::Campaign),
            "payment" => Ok(Self::Payment),
            "session" => Ok(Self::Session),
            other => Err(AppError::Validation(format!(
                "a breakdown is by tag, division, store, article, sku, po, supplier, \
                 campaign, payment or session, not {other:?}"
            ))),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Tag => "tag",
            Self::Division => "division",
            Self::Store => "store",
            Self::Article => "article",
            Self::Sku => "sku",
            Self::Po => "po",
            Self::Supplier => "supplier",
            Self::Campaign => "campaign",
            Self::Payment => "payment",
            Self::Session => "session",
        }
    }

    /// Groupings with more groups than a person reads: the report keeps the
    /// top `ROW_LIMIT` and says how many there were.
    fn is_long(self) -> bool {
        matches!(self, Self::Article | Self::Sku | Self::Po | Self::Session)
    }

    /// The grouping over the sold lines, `movement m`.
    fn over_sales(self) -> Grouping {
        match self {
            // Not retroactive: the tag periods the sale (or the return) falls
            // in, not the tags the article has now.
            Self::Tag => Grouping::plain(
                "COALESCE(p.tag_code, '')",
                "COALESCE(t.label, p.tag_code, 'Untagged')",
                "LEFT JOIN article_tag_period p
                        ON p.article_id = m.article_id
                       AND p.valid_from <= m.sold_at
                       AND (p.valid_to IS NULL OR m.sold_at < p.valid_to)
                 LEFT JOIN tag t ON t.code = p.tag_code",
            ),
            Self::Division => Grouping::plain(
                "COALESCE(dp.division_code, '')",
                "COALESCE(d.label, dp.division_code, 'Unclassified')",
                "LEFT JOIN article_division_period dp
                        ON dp.article_id = m.article_id
                       AND dp.valid_from <= m.sold_at
                       AND (dp.valid_to IS NULL OR m.sold_at < dp.valid_to)
                 LEFT JOIN division d ON d.code = dp.division_code",
            ),
            Self::Store => Grouping::plain(
                "m.site_id",
                "COALESCE(st.name, m.site_id)",
                "LEFT JOIN site st ON st.id = m.site_id",
            ),
            Self::Article => Grouping::plain(
                "COALESCE(a.article_code, '')",
                ARTICLE_NAME,
                "LEFT JOIN article a ON a.id = m.article_id",
            ),
            Self::Sku => Grouping::plain(
                "COALESCE(m.sku_code, '')",
                sku_name!("m"),
                sku_of!("m"),
            ),
            Self::Po => Grouping::plain(PO_CODE, PO_NAME, order_of!("m")),
            Self::Supplier => Grouping::plain(SUPPLIER_CODE, SUPPLIER_NAME, order_of!("m")),
            Self::Campaign => Grouping {
                ctes: PROMOTED,
                code: "COALESCE(pr.campaign_id, '')",
                // As the publication the line sold under named it; a line
                // from before versions were recorded takes the newest name.
                name: "COALESCE((SELECT c.name
                                   FROM commercial_campaign c
                                   JOIN commercial_publication pub ON pub.id = c.publication_id
                                  WHERE c.campaign_id = pr.campaign_id
                                  ORDER BY (pub.version = m.publication_version) DESC NULLS LAST,
                                           pub.version DESC
                                  LIMIT 1),
                                pr.campaign_id, 'No campaign')",
                joins: "LEFT JOIN promoted pr
                               ON pr.sale_id = m.sale_id AND pr.subject_id = m.subject_id",
                weight: "1",
            },
            Self::Payment => Grouping {
                ctes: TENDERED,
                code: "COALESCE(ts.code, '')",
                name: "COALESCE(ts.name, 'Not recorded')",
                joins: "LEFT JOIN tender_share ts ON ts.doc = COALESCE(m.sale_id, m.return_id)",
                weight: "COALESCE(ts.weight, 1)",
            },
            // "Toko 01 · Kasir 2 · Rina · 30 Sep 08:02–16:10", in the shop's
            // own clock.
            Self::Session => Grouping::plain(
                "COALESCE(cs.shift_id::text, '')",
                "COALESCE(concat_ws(' · ', st.name, cs.terminal_id,
                                    COALESCE(u.display_name, cs.opened_by),
                                    to_char(cs.opened_at AT TIME ZONE site_business_timezone(cs.site_id), 'DD Mon HH24:MI')
                                    || COALESCE(to_char(cs.closed_at AT TIME ZONE site_business_timezone(cs.site_id),
                                                        '–HH24:MI'), '')),
                          'No session')",
                "LEFT JOIN cash_shift cs ON cs.shift_id = m.shift_id
                 LEFT JOIN site st ON st.id = cs.site_id
                 LEFT JOIN app_user u ON u.username = cs.opened_by",
            ),
        }
    }

    /// The same over the store-day summary `r` (`sales_sku_day`, 0930), for
    /// every grouping the summary carries: it already holds the division and
    /// tags as sold, and the order is the article's (one article, one order).
    /// Campaign, payment and session need the line or the receipt, and read
    /// the raw lines.
    fn over_rollup(self) -> Option<Grouping> {
        Some(match self {
            Self::Tag => Grouping::plain(
                "tc.code",
                "COALESCE(t.label, NULLIF(tc.code, ''), 'Untagged')",
                "CROSS JOIN LATERAL unnest(CASE WHEN cardinality(r.tag_codes) = 0
                                                THEN ARRAY['']::text[]
                                                ELSE r.tag_codes END) AS tc(code)
                 LEFT JOIN tag t ON t.code = tc.code",
            ),
            Self::Division => Grouping::plain(
                "r.division_code",
                "COALESCE(d.label, NULLIF(r.division_code, ''), 'Unclassified')",
                "LEFT JOIN division d ON d.code = r.division_code",
            ),
            Self::Store => Grouping::plain(
                "r.site_id",
                "COALESCE(st.name, r.site_id)",
                "LEFT JOIN site st ON st.id = r.site_id",
            ),
            Self::Article => Grouping::plain(
                "COALESCE(a.article_code, '')",
                ARTICLE_NAME,
                "LEFT JOIN article a ON a.id = r.article_id",
            ),
            Self::Sku => Grouping::plain("r.sku_code", sku_name!("r"), sku_of!("r")),
            Self::Po => Grouping::plain(PO_CODE, PO_NAME, ORDER_OF_ARTICLE),
            Self::Supplier => Grouping::plain(SUPPLIER_CODE, SUPPLIER_NAME, ORDER_OF_ARTICLE),
            Self::Campaign | Self::Payment | Self::Session => return None,
        })
    }

    /// The same over stock on hand `x`, where the grouping has a stock at
    /// all: stock is now, so it is grouped by what the articles are now, and
    /// a piece by the order its EPC came in on. A campaign or a way of paying
    /// holds no stock.
    fn over_stock(self) -> Option<Grouping> {
        Some(match self {
            Self::Tag => Grouping::plain(
                "COALESCE(p.tag_code, '')",
                "COALESCE(t.label, p.tag_code, 'Untagged')",
                "LEFT JOIN article_tag p ON p.article_id = x.article_id
                 LEFT JOIN tag t ON t.code = p.tag_code",
            ),
            Self::Division => Grouping::plain(
                "COALESCE(a.division_code, '')",
                "COALESCE(d.label, a.division_code, 'Unclassified')",
                "LEFT JOIN article a ON a.id = x.article_id
                 LEFT JOIN division d ON d.code = a.division_code",
            ),
            Self::Store => Grouping::plain(
                "x.site_id",
                "COALESCE(st.name, x.site_id)",
                "LEFT JOIN site st ON st.id = x.site_id",
            ),
            Self::Article => Grouping::plain(
                "COALESCE(a.article_code, '')",
                ARTICLE_NAME,
                "LEFT JOIN article a ON a.id = x.article_id",
            ),
            Self::Sku => Grouping::plain("COALESCE(x.sku_code, '')", sku_name!("x"), sku_of!("x")),
            Self::Po => Grouping::plain(PO_CODE, PO_NAME, order_of!("x")),
            Self::Supplier => Grouping::plain(SUPPLIER_CODE, SUPPLIER_NAME, order_of!("x")),
            Self::Campaign | Self::Payment | Self::Session => return None,
        })
    }
}

/// Rows a long grouping (article, SKU, PO, session) keeps, biggest net first.
const ROW_LIMIT: usize = 500;

/// A shop the breakdown has a column for.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BreakdownSite {
    pub site_id: String,
    pub name: String,
}

/// One group's figures over the window, and the stock it holds now.
#[derive(Clone, Debug, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BreakdownRow {
    /// The tag, division or site id. Empty for the untagged/unclassified row.
    pub code: String,
    pub name: String,
    /// Distinct articles that sold or came back in the group.
    pub articles: i64,
    /// Pieces sold, less pieces returned.
    pub quantity: i64,
    pub gross_minor: i64,
    pub discount_minor: i64,
    pub returns_minor: i64,
    /// Gross − discount − returns.
    pub net_minor: i64,
    /// HPP rata-rata, as in the division report.
    pub cost_minor: i64,
    /// Pieces on hand at the shops now.
    pub stock: i64,
}

/// One group at one shop. `code` is empty on `site_totals`.
#[derive(Clone, Debug, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BreakdownCell {
    pub code: String,
    pub site_id: String,
    pub quantity: i64,
    pub net_minor: i64,
    pub stock: i64,
}

/// Every line and every piece once, whatever group it falls in.
#[derive(Clone, Debug, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BreakdownTotal {
    pub quantity: i64,
    pub gross_minor: i64,
    pub discount_minor: i64,
    pub returns_minor: i64,
    pub net_minor: i64,
    pub cost_minor: i64,
    pub stock: i64,
}

/// One group's net in one step of the window, for the chart's scrubber.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BreakdownStep {
    /// The step's first day: the day, the Monday or the 1st, and never
    /// before the window's own `from`.
    pub starts: NaiveDate,
    pub code: String,
    pub net_minor: i64,
}

/// Every line's net in one step, counted once.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SalesStepTotal {
    pub starts: NaiveDate,
    pub net_minor: i64,
}

/// The Sales menu's breakdowns — by tag, division, store, article, SKU, PO,
/// supplier, campaign, payment or cashier session (`BreakdownBy`): the division report's
/// figures per group, the stock each group holds now, the same per shop for
/// the per-store table, and the window in steps for the chart.
///
/// **By tag and by campaign the rows overlap.** An article carries any number
/// of tags, and a line can be touched by two campaigns, so such a sale is in
/// both rows and the rows do NOT add up to `total`, which counts every line
/// once (and `site_totals` likewise). By payment a line is split across its
/// sale's tenders, so pieces there are apportioned too.
///
/// **Nothing is retroactive** (owner, 30 Sep 2026): a sale counts under what
/// was true when it was rung up — the tags and division its article had then
/// (`article_tag_period`, `article_division_period`, migration 0715), the
/// order its piece came in on, the campaign names of the publication it sold
/// under, the tenders it was paid with. A return counts under what was true
/// when it came back. Stock is now, so it is grouped by what things are now.
///
/// **Stock** is pieces on hand in the shops' NORMAL places — floor,
/// warehouse, reject — read from the node's positions for a shop whose node
/// has reported and from the centre's ledger otherwise, the ownership rule
/// the fleet stock screen follows. Missing pieces are not stock; the
/// distribution centre is not a shop and is left out.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SalesBreakdown {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// The grouping, as `BreakdownBy` spells it: "tag", "division", "store",
    /// "article", "sku", "po", "supplier", "campaign", "payment" or "session".
    pub by: String,
    /// A unit id; absent means every unit.
    pub unit: Option<String>,
    /// A division code; absent means every division.
    pub division: Option<String>,
    /// The shops in scope, the per-store table's column groups.
    pub sites: Vec<BreakdownSite>,
    /// Biggest net first, the untagged/unclassified row last. A group with
    /// stock and no sales is still a row. By article, SKU and PO only the
    /// first 500; `rows_total` says how many there were.
    pub rows: Vec<BreakdownRow>,
    pub rows_total: i64,
    /// False by campaign, payment and session, which hold no stock: every `stock`
    /// is then 0 and means nothing.
    pub has_stock: bool,
    /// Each group at each shop, where it sold or holds stock.
    pub cells: Vec<BreakdownCell>,
    pub total: BreakdownTotal,
    /// Each shop's total, every line and piece once.
    pub site_totals: Vec<BreakdownCell>,
    pub voided: VoidedSales,
    /// "day", "week" or "month": how finely `steps` cut the window, chosen
    /// from its length so a scrubber has a legible number of stops.
    pub step: String,
    /// Each group's net per step, only where it sold; the chart adds them up.
    pub steps: Vec<BreakdownStep>,
    /// The window's net per step, one line once.
    pub step_totals: Vec<SalesStepTotal>,
}

/// A month or less steps by day, four months by week, anything longer by
/// month.
fn step_of(from: NaiveDate, to: NaiveDate) -> &'static str {
    match (to - from).num_days() + 1 {
        days if days <= 31 => "day",
        days if days <= 124 => "week",
        _ => "month",
    }
}

/// Pieces on hand now at the shops, per position: shop, article, SKU and the
/// EPC where the piece has one. `$1` a unit, `$2` a division.
const ON_HAND: &str = "
    edge_owned AS (
        SELECT c.origin_id, c.site_id
          FROM sync_origin_credential c
          JOIN sync_applied_watermark w
            ON w.origin_id = c.origin_id AND w.generation = c.active_generation
         WHERE c.inventory_enabled
    ),
    held AS (
        SELECT op.site_id, k.article_id, k.sku_code, su.epc,
               pr.quantity::bigint AS quantity
          FROM inventory_projection pr
          JOIN inventory_place pl ON pl.id = pr.place_id
          JOIN operational_pool op ON op.id = pl.pool_id
          JOIN inventory_subject su ON su.id = pr.subject_id
          JOIN sku k ON k.id = su.sku_id
         WHERE pl.kind = 'OPERATIONAL' AND pl.state = 'NORMAL'
           AND op.site_id NOT IN (SELECT site_id FROM edge_owned)
        UNION ALL
        SELECT e.site_id, k.article_id, fp.sku_code, fp.epc, fp.quantity::bigint
          FROM edge_inventory_fact_position fp
          JOIN edge_owned e ON e.origin_id = fp.origin_id
          JOIN sku k ON k.sku_code = fp.sku_code
         WHERE fp.place_id LIKE '%:on_hand'
    ),
    on_hand AS (
        SELECT h.site_id, h.article_id, h.sku_code, h.epc, h.quantity
          FROM held h
          JOIN site s ON s.id = h.site_id AND s.kind = 'STORE'
         WHERE ($1::text IS NULL OR s.unit_id = $1)
           AND ($2::text IS NULL OR EXISTS (
                   SELECT 1 FROM article a2
                    WHERE a2.id = h.article_id AND a2.division_code = $2))
    )";

/// Read a breakdown: the window's sales by `by`, narrowed by unit and
/// division, with the shops' stock beside them.
pub async fn sales_breakdown(
    pool: &PgPool,
    by: BreakdownBy,
    from: NaiveDate,
    to: NaiveDate,
    unit: Option<&str>,
    division: Option<&str>,
) -> Result<SalesBreakdown, AppError> {
    if to < from {
        return Err(AppError::Validation(
            "the period ends before it starts".into(),
        ));
    }
    let unit = unit.map(str::trim).filter(|u| !u.is_empty());
    let division = division.map(str::trim).filter(|d| !d.is_empty());
    let step = step_of(from, to);

    let sites = sqlx::query(
        "SELECT id, name FROM site
          WHERE kind = 'STORE' AND ($1::text IS NULL OR unit_id = $1)
          ORDER BY code NULLS LAST, name",
    )
    .bind(unit)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(BreakdownSite {
            site_id: row.try_get("id")?,
            name: row.try_get("name")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    // One pass for the three cuts: per step (the chart), per shop (the
    // per-store table) and over the window (the rows, whose article count is
    // distinct over the window and cannot be added up from the other two).
    const CUTS: &str = "
         SELECT starts, code, name, site_id,
                GROUPING(starts) = 0 AS per_step,
                GROUPING(site_id) = 0 AS per_site,
                COUNT(DISTINCT article_id)::bigint AS articles,
                ROUND(SUM((sold_qty - returned_qty) * weight))::bigint AS quantity,
                ROUND(SUM(gross_minor * weight))::bigint AS gross_minor,
                ROUND(SUM(discount_minor * weight))::bigint AS discount_minor,
                ROUND(SUM(refund_minor * weight))::bigint AS returns_minor,
                ROUND(SUM(cost * weight))::bigint AS cost_minor
           FROM keyed
          GROUP BY GROUPING SETS ((starts, code, name), (code, name, site_id), (code, name))
          ORDER BY starts NULLS FIRST, code";
    let summed = by.over_rollup();
    if summed.is_some() {
        super::sales_rollup_catch_up(pool, from, to, 60).await?;
    }
    let sold = if let Some(Grouping {
        code, name, joins, ..
    }) = &summed
    {
        sqlx::query(&format!(
            "WITH {ROLLUP_ROWS},
             keyed AS (
                 SELECT GREATEST(date_trunc($5, r.business_date::timestamp)::date, $1::date)
                            AS starts,
                        {code} AS code, {name} AS name, 1::numeric AS weight,
                        r.site_id, r.article_id, r.sold_qty, r.returned_qty,
                        r.gross_minor, r.gross_minor - r.net_minor AS discount_minor,
                        r.refund_minor, r.cost_minor AS cost
                   FROM r
                   {joins}
             ){CUTS}"
        ))
        .bind(from)
        .bind(to)
        .bind(unit)
        .bind(division)
        .bind(step)
        .fetch_all(pool)
        .await?
    } else {
        let Grouping {
            ctes,
            code,
            name,
            joins,
            weight,
        } = by.over_sales();
        sqlx::query(&format!(
            "WITH {SOLD_LINES}, {MOVEMENT}{ctes},
             keyed AS (
                 SELECT GREATEST(date_trunc($6, m.day::timestamp)::date, $1::date) AS starts,
                        {code} AS code, {name} AS name, ({weight})::numeric AS weight,
                        m.site_id, m.article_id, m.sold_qty, m.returned_qty,
                        m.gross_minor, m.discount_minor, m.refund_minor, m.cost
                   FROM movement m
                   {joins}
             ){CUTS}"
        ))
        .bind(from)
        .bind(to)
        .bind(unit)
        .bind(None::<&str>)
        .bind(division)
        .bind(step)
        .fetch_all(pool)
        .await?
    };

    let mut rows = std::collections::BTreeMap::<String, BreakdownRow>::new();
    let mut cells = std::collections::BTreeMap::<(String, String), BreakdownCell>::new();
    let mut steps = Vec::new();
    for row in &sold {
        let code: String = row.try_get("code")?;
        let gross_minor: i64 = row.try_get("gross_minor")?;
        let discount_minor: i64 = row.try_get("discount_minor")?;
        let returns_minor: i64 = row.try_get("returns_minor")?;
        let net_minor = gross_minor - discount_minor - returns_minor;
        if row.try_get::<bool, _>("per_step")? {
            steps.push(BreakdownStep {
                starts: row.try_get("starts")?,
                code,
                net_minor,
            });
        } else if row.try_get::<bool, _>("per_site")? {
            let site_id: String = row.try_get("site_id")?;
            cells.insert(
                (code.clone(), site_id.clone()),
                BreakdownCell {
                    code,
                    site_id,
                    quantity: row.try_get("quantity")?,
                    net_minor,
                    stock: 0,
                },
            );
        } else {
            rows.insert(
                code.clone(),
                BreakdownRow {
                    code,
                    name: row.try_get("name")?,
                    articles: row.try_get("articles")?,
                    quantity: row.try_get("quantity")?,
                    gross_minor,
                    discount_minor,
                    returns_minor,
                    net_minor,
                    cost_minor: row.try_get("cost_minor")?,
                    stock: 0,
                },
            );
        }
    }

    // The stock, per group and shop, and per group over every shop.
    let stocked = by.over_stock();
    if let Some(Grouping {
        ctes,
        code,
        name,
        joins,
        ..
    }) = &stocked
    {
        let held = sqlx::query(&format!(
            "WITH {ON_HAND}{ctes},
             keyed AS (
                 SELECT {code} AS code, {name} AS name, x.site_id, x.quantity
                   FROM on_hand x
                   {joins}
             )
             SELECT code, name, site_id,
                    GROUPING(site_id) = 0 AS per_site,
                    SUM(quantity)::bigint AS stock
               FROM keyed
              GROUP BY GROUPING SETS ((code, name, site_id), (code, name))"
        ))
        .bind(unit)
        .bind(division)
        .fetch_all(pool)
        .await?;
        for row in &held {
            let code: String = row.try_get("code")?;
            let stock: i64 = row.try_get("stock")?;
            if row.try_get::<bool, _>("per_site")? {
                let site_id: String = row.try_get("site_id")?;
                cells
                    .entry((code.clone(), site_id.clone()))
                    .or_insert_with(|| BreakdownCell {
                        code,
                        site_id,
                        ..BreakdownCell::default()
                    })
                    .stock = stock;
            } else {
                let name: String = row.try_get("name")?;
                rows.entry(code.clone())
                    .or_insert_with(|| BreakdownRow {
                        code,
                        name,
                        ..BreakdownRow::default()
                    })
                    .stock = stock;
            }
        }
    }

    let mut rows: Vec<BreakdownRow> = rows.into_values().collect();
    rows.sort_by(|a, b| {
        (
            a.code.is_empty(),
            std::cmp::Reverse(a.net_minor),
            std::cmp::Reverse(a.stock),
            &a.name,
        )
            .cmp(&(
                b.code.is_empty(),
                std::cmp::Reverse(b.net_minor),
                std::cmp::Reverse(b.stock),
                &b.name,
            ))
    });
    let rows_total = i64::try_from(rows.len()).unwrap_or(i64::MAX);
    let mut cells: Vec<BreakdownCell> = cells.into_values().collect();
    if by.is_long() && rows.len() > ROW_LIMIT {
        rows.truncate(ROW_LIMIT);
        let kept: std::collections::BTreeSet<&str> =
            rows.iter().map(|row| row.code.as_str()).collect();
        cells.retain(|cell| kept.contains(cell.code.as_str()));
        steps.retain(|step| kept.contains(step.code.as_str()));
    }

    // Totals are read on their own, every line and piece once — by tag and
    // by campaign the rows overlap — per step, per shop and over the window.
    const SUMS: &str = "
         SELECT starts, site_id,
                GROUPING(starts) = 0 AS per_step,
                GROUPING(site_id) = 0 AS per_site,
                COALESCE(SUM(sold_qty) - SUM(returned_qty), 0)::bigint AS quantity,
                COALESCE(SUM(gross_minor), 0)::bigint AS gross_minor,
                COALESCE(SUM(discount_minor), 0)::bigint AS discount_minor,
                COALESCE(SUM(refund_minor), 0)::bigint AS returns_minor,
                COALESCE(ROUND(SUM(cost)), 0)::bigint AS cost_minor
           FROM m
          GROUP BY GROUPING SETS ((starts), (site_id), ())
          ORDER BY starts NULLS FIRST, site_id";
    let sums = if summed.is_some() {
        sqlx::query(&format!(
            "WITH {ROLLUP_ROWS},
             m AS (
                 SELECT GREATEST(date_trunc($5, r.business_date::timestamp)::date, $1::date)
                            AS starts,
                        r.site_id, r.sold_qty, r.returned_qty, r.gross_minor,
                        r.gross_minor - r.net_minor AS discount_minor, r.refund_minor,
                        r.cost_minor AS cost
                   FROM r
             ){SUMS}"
        ))
        .bind(from)
        .bind(to)
        .bind(unit)
        .bind(division)
        .bind(step)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(&format!(
            "WITH {SOLD_LINES}, {MOVEMENT},
             m AS (
                 SELECT GREATEST(date_trunc($6, m.day::timestamp)::date, $1::date) AS starts,
                        m.*
                   FROM movement m
             ){SUMS}"
        ))
        .bind(from)
        .bind(to)
        .bind(unit)
        .bind(None::<&str>)
        .bind(division)
        .bind(step)
        .fetch_all(pool)
        .await?
    };

    let mut total = BreakdownTotal::default();
    let mut site_totals = std::collections::BTreeMap::<String, BreakdownCell>::new();
    let mut step_totals = Vec::new();
    for sum in &sums {
        let gross_minor: i64 = sum.try_get("gross_minor")?;
        let discount_minor: i64 = sum.try_get("discount_minor")?;
        let returns_minor: i64 = sum.try_get("returns_minor")?;
        let net_minor = gross_minor - discount_minor - returns_minor;
        if sum.try_get::<bool, _>("per_step")? {
            step_totals.push(SalesStepTotal {
                starts: sum.try_get("starts")?,
                net_minor,
            });
        } else if sum.try_get::<bool, _>("per_site")? {
            let site_id: String = sum.try_get("site_id")?;
            site_totals.insert(
                site_id.clone(),
                BreakdownCell {
                    code: String::new(),
                    site_id,
                    quantity: sum.try_get("quantity")?,
                    net_minor,
                    stock: 0,
                },
            );
        } else {
            total = BreakdownTotal {
                quantity: sum.try_get("quantity")?,
                gross_minor,
                discount_minor,
                returns_minor,
                net_minor,
                cost_minor: sum.try_get("cost_minor")?,
                stock: 0,
            };
        }
    }

    if stocked.is_some() {
        let stock = sqlx::query(&format!(
            "WITH {ON_HAND}
             SELECT site_id, SUM(quantity)::bigint AS stock
               FROM on_hand
              GROUP BY site_id"
        ))
        .bind(unit)
        .bind(division)
        .fetch_all(pool)
        .await?;
        for row in &stock {
            let site_id: String = row.try_get("site_id")?;
            let pieces: i64 = row.try_get("stock")?;
            total.stock += pieces;
            site_totals
                .entry(site_id.clone())
                .or_insert_with(|| BreakdownCell {
                    site_id,
                    ..BreakdownCell::default()
                })
                .stock = pieces;
        }
    }

    Ok(SalesBreakdown {
        from,
        to,
        by: by.as_str().to_string(),
        unit: unit.map(str::to_string),
        division: division.map(str::to_string),
        sites,
        rows,
        rows_total,
        has_stock: stocked.is_some(),
        cells,
        total,
        site_totals: site_totals.into_values().collect(),
        voided: voided_sales(pool, from, to, unit, None, division).await?,
        step: step.to_string(),
        steps,
        step_totals,
    })
}

#[cfg(test)]
mod tests {
    use super::{step_of, BreakdownBy};
    use chrono::NaiveDate;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap_or_else(|| panic!("date"))
    }

    #[test]
    fn a_window_steps_finer_the_shorter_it_is() {
        assert_eq!(step_of(d(2026, 9, 1), d(2026, 9, 30)), "day");
        assert_eq!(step_of(d(2026, 7, 1), d(2026, 9, 30)), "week");
        assert_eq!(step_of(d(2026, 1, 1), d(2026, 9, 30)), "month");
    }

    #[test]
    fn a_breakdown_names_what_it_is_by() {
        for by in [
            "tag", "division", "store", "article", "sku", "po", "supplier", "campaign", "payment",
            "session",
        ] {
            let parsed = BreakdownBy::parse(by).unwrap_or_else(|_| panic!("{by}"));
            assert_eq!(parsed.as_str(), by);
        }
        assert!(BreakdownBy::parse("colour").is_err());
    }
}
