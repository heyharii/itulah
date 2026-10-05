//! Finance › Inventory — what the stock is worth, where it is, and whether the
//! books say the same (owner, 2026-10-01).
//!
//! # The rule
//!
//! The client never re-orders an article: one article, one purchase order. So
//! an article has one cost, the price it was received at, and its stock is
//! worth quantity × that cost wherever it sits. FIFO, moving average and
//! per-piece all give the same figure under that rule; the cost here is the
//! received cost from the cost layers, weighted by quantity, which is the
//! receipt price when there is one receipt and an honest average on the rare
//! article that arrived twice (`po_count` > 1 says so). An article with no
//! layer yet falls back to its purchase-order price.
//!
//! # Where the quantities come from
//!
//! The pieces the edges report on hand (`edge_inventory_fact_position`), not
//! the FIFO queue: the queue is the company's and does not follow a piece from
//! the DC to a shop, and the books do (the SJD transfer rule moves 1029 from
//! head office to the shop). A piece in an `IN_TRANSIT` pool is on the road and
//! is reported apart, against 1031.
//!
//! Pieces received but not yet set up (no SKU, no tag — the DC's
//! `pending.unidentified` pool) are already in head office's 1029 by the
//! goods receipt; they are valued from their receipt lines and shown as their
//! own figure, "awaiting setup", rather than as a gap.

use chrono::{NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InventoryValuationRow {
    pub unit_id: String,
    pub site_id: String,
    pub site_name: String,
    /// On the road between two sites (an `IN_TRANSIT` pool).
    pub in_transit: bool,
    pub division_code: Option<String>,
    pub article_code: String,
    pub article_name: String,
    pub quantity: i64,
    pub unit_cost_minor: i64,
    pub value_minor: i64,
    /// `RECEIPT` (the cost layers), `PO` (no receipt yet costed — the order's
    /// price), or `NONE` (no price anywhere: valued at nothing, and said).
    pub cost_source: String,
    pub po_numbers: Option<String>,
    /// More than one purchase order means the one-PO rule did not hold for
    /// this article and the cost is an average.
    pub po_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AwaitingSetupRow {
    pub unit_id: String,
    pub receipt_number: String,
    pub po_number: Option<String>,
    pub supplier_id: Option<String>,
    pub received_on: Option<NaiveDate>,
    pub lines: i64,
    pub quantity: i64,
    pub value_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InventoryValuation {
    pub as_of: NaiveDate,
    pub rows: Vec<InventoryValuationRow>,
    pub awaiting_setup: Vec<AwaitingSetupRow>,
}

/// One unit's stock against its books.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockLedgerUnitRow {
    pub unit_id: String,
    pub unit_name: String,
    /// Set-up pieces on hand at the unit's sites, at cost.
    pub on_hand_minor: i64,
    /// Received, not yet set up, at receipt cost.
    pub awaiting_setup_minor: i64,
    /// `on_hand + awaiting_setup` — what 1029 should hold.
    pub stock_minor: i64,
    /// The unit's balance on the `inventory` accounts (1029).
    pub ledger_minor: i64,
    pub difference_minor: i64,
    /// Pieces on the road from or to this unit, at cost.
    pub in_transit_stock_minor: i64,
    /// The unit's balance on `goods_in_transit` (1031). Under the SJD rule
    /// both the sender and the receiver carry it until the box is counted in.
    pub in_transit_ledger_minor: i64,
    pub in_transit_difference_minor: i64,
}

const LINES: &str = "
WITH layer AS (
    SELECT c.article_id,
           -- What the layers cost as received, not a truncated unit cost
           -- multiplied back (0823).
           SUM(c.opening_cost_minor)::bigint AS cost_total,
           SUM(c.quantity)::bigint AS cost_qty,
           string_agg(DISTINCT o.po_number, ', ') AS po_numbers,
           COUNT(DISTINCT pl.purchase_order_id)::bigint AS po_count
      FROM cost_layer c
      LEFT JOIN goods_receipt_line rl ON rl.receipt_line_id = c.receipt_line_id
      LEFT JOIN purchase_order_line pl ON pl.po_line_id = rl.po_line_id
      LEFT JOIN purchase_order o ON o.purchase_order_id = pl.purchase_order_id
     GROUP BY 1
), po AS (
    SELECT pl.article_code,
           -- The line totals as ordered (0823). Gross, like the layers: the
           -- order discount is booked to Potongan Pembelian by the bill.
           SUM(pl.line_amount_minor)::bigint AS cost_total,
           SUM(pl.ordered_quantity)::bigint AS cost_qty,
           string_agg(DISTINCT o.po_number, ', ') AS po_numbers,
           COUNT(DISTINCT pl.purchase_order_id)::bigint AS po_count
      FROM purchase_order_line pl JOIN purchase_order o USING (purchase_order_id)
     GROUP BY 1
), pos AS (
    SELECT split_part(f.place_id, ':', 1) AS pool_id, f.sku_code, SUM(f.quantity)::bigint AS qty
      FROM edge_inventory_fact_position f
     -- On hand, and Missing: a missing piece stays in the books (1029, or
     -- 1031 when it went missing on the road) until Inventory settles it as
     -- found or lost, so it is still stock to value.
     WHERE split_part(f.place_id, ':', 2) IN ('on_hand', 'missing')
       AND f.quantity > 0 AND COALESCE(f.sku_code, '') <> ''
     GROUP BY 1, 2
), priced AS (
    SELECT s.unit_id, p.site_id, s.name AS site_name,
           COALESCE(p.outbound_stage = 'IN_TRANSIT', false) AS in_transit,
           (SELECT d.unit_id FROM site d WHERE d.id = p.destination_store_id) AS destination_unit,
           a.division_code, a.article_code, a.name AS article_name,
           pos.qty,
           COALESCE(layer.cost_total / NULLIF(layer.cost_qty, 0),
                    po.cost_total / NULLIF(po.cost_qty, 0), 0)::bigint AS unit_cost,
           CASE WHEN layer.cost_qty > 0 THEN 'RECEIPT'
                WHEN po.cost_qty > 0 THEN 'PO' ELSE 'NONE' END AS cost_source,
           COALESCE(layer.po_numbers, po.po_numbers) AS po_numbers,
           GREATEST(COALESCE(layer.po_count, 0), COALESCE(po.po_count, 0))::bigint AS po_count
      FROM pos
      JOIN operational_pool p ON p.id = pos.pool_id
      JOIN site s ON s.id = p.site_id
      JOIN sku k ON k.sku_code = pos.sku_code
      JOIN article a ON a.id = k.article_id
      LEFT JOIN layer ON layer.article_id = a.id
      LEFT JOIN po ON po.article_code = a.article_code
)";

const AWAITING: &str = "
SELECT unit_of_site(gr.site_id) AS unit_id, gr.receipt_number,
       string_agg(DISTINCT o.po_number, ', ') AS po_number,
       gr.supplier_id::text AS supplier_id,
       (gr.received_at AT TIME ZONE 'Asia/Jakarta')::date AS received_on,
       COUNT(*)::bigint AS lines,
       SUM(l.matched_quantity)::bigint AS quantity,
       -- By the one rule (0823), as the receipt posted it.
       SUM(purchase_receipt_value(l.matched_quantity, l.agreed_unit_price_minor,
                                  pl.unit_price_minor, pl.order_unit_price_minor,
                                  pl.unit_factor))::bigint
           AS value_minor
  FROM goods_receipt_line l
  JOIN goods_receipt gr USING (receipt_id)
  JOIN purchase_order_line pl USING (po_line_id)
  JOIN purchase_order o ON o.purchase_order_id = pl.purchase_order_id
  JOIN goods_receipt_posting gp ON gp.posting_id = l.posting_id AND gp.reversal_entry_id IS NULL
 WHERE l.matched_quantity > 0
   AND NOT EXISTS (SELECT 1 FROM cost_layer c WHERE c.receipt_line_id = l.receipt_line_id)";

/// Every set-up piece on hand, priced, plus what is waiting to be set up.
pub async fn inventory_valuation(
    pool: &PgPool,
    unit_id: Option<&str>,
) -> Result<InventoryValuation, AppError> {
    let rows = sqlx::query(&format!(
        "{LINES}
         SELECT unit_id, site_id, site_name, in_transit, division_code, article_code,
                article_name, SUM(qty)::bigint AS quantity, unit_cost, cost_source,
                po_numbers, po_count
           FROM priced
          WHERE ($1::text IS NULL OR unit_id = $1 OR destination_unit = $1)
          GROUP BY unit_id, site_id, site_name, in_transit, division_code, article_code,
                   article_name, unit_cost, cost_source, po_numbers, po_count
          ORDER BY unit_id, in_transit, site_id, article_code"
    ))
    .bind(unit_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        let quantity: i64 = row.try_get("quantity")?;
        let unit_cost: i64 = row.try_get("unit_cost")?;
        Ok(InventoryValuationRow {
            unit_id: row.try_get("unit_id")?,
            site_id: row.try_get("site_id")?,
            site_name: row.try_get("site_name")?,
            in_transit: row.try_get("in_transit")?,
            division_code: row.try_get("division_code")?,
            article_code: row.try_get("article_code")?,
            article_name: row.try_get("article_name")?,
            quantity,
            unit_cost_minor: unit_cost,
            value_minor: quantity.saturating_mul(unit_cost),
            cost_source: row.try_get("cost_source")?,
            po_numbers: row.try_get("po_numbers")?,
            po_count: row.try_get("po_count")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    let awaiting_setup = sqlx::query(&format!(
        "SELECT * FROM ({AWAITING}
           GROUP BY gr.receipt_id, gr.receipt_number, gr.site_id, gr.supplier_id, gr.received_at
         ) a
          WHERE ($1::text IS NULL OR a.unit_id = $1)
          ORDER BY a.received_on, a.receipt_number"
    ))
    .bind(unit_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(AwaitingSetupRow {
            unit_id: row.try_get("unit_id")?,
            receipt_number: row.try_get("receipt_number")?,
            po_number: row.try_get("po_number")?,
            supplier_id: row.try_get("supplier_id")?,
            received_on: row.try_get("received_on")?,
            lines: row.try_get("lines")?,
            quantity: row.try_get("quantity")?,
            value_minor: row.try_get("value_minor")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    Ok(InventoryValuation {
        as_of: Utc::now().date_naive(),
        rows,
        awaiting_setup,
    })
}

/// Each unit's stock against 1029, and what is on the road against 1031.
///
/// Today's: the edges report where each piece is now, not where it was, so
/// both sides are read as at today.
pub async fn stock_vs_ledger(pool: &PgPool) -> Result<Vec<StockLedgerUnitRow>, AppError> {
    let rows = sqlx::query(&format!(
        "{LINES}, awaiting AS (
             SELECT unit_id, SUM(value_minor)::bigint AS value
               FROM ({AWAITING} GROUP BY gr.receipt_id, gr.site_id, gr.receipt_number,
                     gr.supplier_id, gr.received_at) a
              GROUP BY 1
         ), on_hand AS (
             SELECT unit_id, SUM(qty * unit_cost)::bigint AS value
               FROM priced WHERE NOT in_transit GROUP BY 1
         ), road AS (
             -- The sender: the pieces physically in its transit pools. The
             -- receiver: what was dispatched to it and not yet counted in
             -- (the transit pool does not say whose shop a box is bound for).
             SELECT u AS unit_id, SUM(value)::bigint AS value FROM (
                 SELECT unit_id AS u, qty * unit_cost AS value FROM priced WHERE in_transit
                 UNION ALL
                 SELECT unit_of_site(al.destination_id),
                        CASE WHEN t.stage = 'DISPATCH' THEN t.value_minor ELSE -t.value_minor END
                   FROM stock_transfer_posting t
                   JOIN allotment_line al ON al.id = t.allotment_line_id
                  WHERE t.stage IN ('DISPATCH', 'RECEIPT')
                    AND unit_of_site(al.destination_id) <> unit_of_site(al.source_site_id)
             ) r GROUP BY 1
         ), ledger AS (
             SELECT l.unit_id,
                    SUM(l.debit_minor - l.credit_minor) FILTER (
                        WHERE l.account_code IN (SELECT account_code FROM account_resolution
                                                  WHERE role = 'inventory'))::bigint AS stock,
                    SUM(l.debit_minor - l.credit_minor) FILTER (
                        WHERE l.account_code IN (SELECT account_code FROM account_resolution
                                                  WHERE role = 'goods_in_transit'
                                                    AND account_code NOT IN (
                                                        SELECT account_code FROM account_resolution
                                                         WHERE role = 'bag_in_transit'))
                    )::bigint AS road
               FROM journal_line l
              GROUP BY 1
         ), units AS (
             SELECT unit_id FROM on_hand UNION SELECT unit_id FROM awaiting
             UNION SELECT unit_id FROM road
             UNION SELECT unit_id FROM ledger WHERE COALESCE(stock, 0) <> 0 OR COALESCE(road, 0) <> 0
         )
         SELECT u.unit_id, COALESCE(un.name, u.unit_id) AS unit_name,
                COALESCE(oh.value, 0)::bigint AS on_hand,
                COALESCE(aw.value, 0)::bigint AS awaiting,
                COALESCE(lg.stock, 0)::bigint AS ledger,
                COALESCE(rd.value, 0)::bigint AS road,
                COALESCE(lg.road, 0)::bigint AS road_ledger
           FROM units u
           LEFT JOIN unit un ON un.id = u.unit_id
           LEFT JOIN on_hand oh ON oh.unit_id = u.unit_id
           LEFT JOIN awaiting aw ON aw.unit_id = u.unit_id
           LEFT JOIN road rd ON rd.unit_id = u.unit_id
           LEFT JOIN ledger lg ON lg.unit_id = u.unit_id
          ORDER BY (u.unit_id <> 'ho'), u.unit_id"
    ))
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let on_hand: i64 = row.try_get("on_hand")?;
            let awaiting: i64 = row.try_get("awaiting")?;
            let ledger: i64 = row.try_get("ledger")?;
            let road: i64 = row.try_get("road")?;
            let road_ledger: i64 = row.try_get("road_ledger")?;
            Ok(StockLedgerUnitRow {
                unit_id: row.try_get("unit_id")?,
                unit_name: row.try_get("unit_name")?,
                on_hand_minor: on_hand,
                awaiting_setup_minor: awaiting,
                stock_minor: on_hand + awaiting,
                ledger_minor: ledger,
                difference_minor: ledger - (on_hand + awaiting),
                in_transit_stock_minor: road,
                in_transit_ledger_minor: road_ledger,
                in_transit_difference_minor: road_ledger - road,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Goods in transit (BDP, 1031)
// ---------------------------------------------------------------------------

/// One allotment line still on 1031: dispatched by head office, not yet
/// counted in by the shop — or counted in short.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GoodsInTransitRow {
    pub allotment_line_id: String,
    /// The surat jalan(s) the pieces left on.
    pub shipment_reference: Option<String>,
    pub koli_number: Option<String>,
    pub destination_site_id: String,
    pub destination_name: String,
    pub destination_unit_id: String,
    pub sku_code: String,
    pub article_code: Option<String>,
    pub article_name: Option<String>,
    pub quantity: i64,
    pub value_minor: i64,
    pub dispatched_on: Option<NaiveDate>,
    pub days: i64,
    /// `ON_THE_ROAD` — the shop has not counted the surat jalan in yet;
    /// `SHORT` — it has, and these pieces were not in the box. A short piece
    /// stays on 1031 until Inventory settles it as found or lost.
    pub status: String,
}

pub async fn goods_in_transit(pool: &PgPool) -> Result<Vec<GoodsInTransitRow>, AppError> {
    let rows = sqlx::query(
        "WITH open_line AS (
             SELECT p.allotment_line_id, p.sku_code, p.destination_id,
                    (p.dispatched_quantity - p.received_quantity)::bigint AS quantity
               FROM edge_allotment_line_progress p
              WHERE p.dispatched_quantity > p.received_quantity
         ), booked AS (
             SELECT t.allotment_line_id,
                    SUM(CASE WHEN t.stage = 'DISPATCH' THEN t.value_minor
                             ELSE -t.value_minor END)::bigint AS value
               FROM stock_transfer_posting t
              WHERE t.stage IN ('DISPATCH', 'RECEIPT')
              GROUP BY 1
         ), koli AS (
             SELECT ku.allotment_line_id,
                    string_agg(DISTINCT k.shipment_reference, ', ') AS shipment_reference,
                    string_agg(DISTINCT k.koli_number, ', ') AS koli_number,
                    MIN(ku.dispatched_at) AS dispatched_at,
                    array_agg(DISTINCT k.shipment_reference) AS refs
               FROM edge_koli_unit ku JOIN edge_koli k USING (koli_id)
              WHERE ku.dispatched_at IS NOT NULL
              GROUP BY 1
         )
         SELECT o.allotment_line_id::text AS allotment_line_id, koli.shipment_reference,
                koli.koli_number, o.destination_id,
                COALESCE((SELECT un.name FROM unit un WHERE un.id = unit_of_site(o.destination_id)),
                         s.name, o.destination_id) AS destination_name,
                unit_of_site(o.destination_id) AS destination_unit, o.sku_code,
                a.article_code, a.name AS article_name, o.quantity,
                COALESCE(b.value, 0)::bigint AS value,
                (koli.dispatched_at AT TIME ZONE 'Asia/Jakarta')::date AS dispatched_on,
                COALESCE(CURRENT_DATE - (koli.dispatched_at AT TIME ZONE 'Asia/Jakarta')::date, 0)::bigint
                    AS days,
                CASE WHEN EXISTS (SELECT 1 FROM edge_goods_step g
                                   WHERE g.kind = 'RECEIVED' AND g.site_id = o.destination_id
                                     AND g.shipment_reference = ANY(koli.refs))
                     THEN 'SHORT' ELSE 'ON_THE_ROAD' END AS status
           FROM open_line o
           LEFT JOIN booked b ON b.allotment_line_id = o.allotment_line_id
           LEFT JOIN koli ON koli.allotment_line_id = o.allotment_line_id
           LEFT JOIN site s ON s.id = o.destination_id
           LEFT JOIN sku k ON k.sku_code = o.sku_code
           LEFT JOIN article a ON a.id = k.article_id
          ORDER BY dispatched_on NULLS LAST, shipment_reference, o.sku_code",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(GoodsInTransitRow {
                allotment_line_id: row.try_get("allotment_line_id")?,
                shipment_reference: row.try_get("shipment_reference")?,
                koli_number: row.try_get("koli_number")?,
                destination_site_id: row.try_get("destination_id")?,
                destination_name: row.try_get("destination_name")?,
                destination_unit_id: row.try_get("destination_unit")?,
                sku_code: row.try_get("sku_code")?,
                article_code: row.try_get("article_code")?,
                article_name: row.try_get("article_name")?,
                quantity: row.try_get("quantity")?,
                value_minor: row.try_get("value")?,
                dispatched_on: row.try_get("dispatched_on")?,
                days: row.try_get("days")?,
                status: row.try_get("status")?,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Cost of goods sold
// ---------------------------------------------------------------------------

/// One unit's month: what it sold, what that stock cost, and the margin.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CogsMonthRow {
    pub unit_id: String,
    pub unit_name: String,
    pub year: i32,
    pub month: i32,
    /// Net sales: the sales accounts of the P&L's REVENUE section (not a
    /// management fee), credit-side positive.
    pub revenue_minor: i64,
    /// The COST_OF_SALES section, debit-side positive.
    pub cogs_minor: i64,
    pub gross_margin_minor: i64,
}

pub async fn cogs_by_month(pool: &PgPool, year: i32) -> Result<Vec<CogsMonthRow>, AppError> {
    let rows = sqlx::query(
        "SELECT l.unit_id, COALESCE(u.name, l.unit_id) AS unit_name,
                EXTRACT(YEAR FROM e.posting_date)::int AS year,
                EXTRACT(MONTH FROM e.posting_date)::int AS month,
                -- Selling goods only: an inter-unit management fee is income,
                -- not a sale, and has no cost of goods against it.
                COALESCE(SUM(l.credit_minor - l.debit_minor)
                         FILTER (WHERE a.statement_section = 'REVENUE'
                                   AND l.account_code IN (
                                       SELECT account_code FROM account_resolution
                                        WHERE role IN ('revenue_cash', 'revenue_debit',
                                                       'revenue_credit', 'sales_cash',
                                                       'sales_discount', 'sales_return'))),
                         0)::bigint AS revenue,
                COALESCE(SUM(l.debit_minor - l.credit_minor)
                         FILTER (WHERE a.statement_section = 'COST_OF_SALES'), 0)::bigint AS cogs
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
           JOIN ledger_account a ON a.account_code = l.account_code
           LEFT JOIN unit u ON u.id = l.unit_id
          WHERE a.statement_section IN ('REVENUE', 'COST_OF_SALES')
            AND EXTRACT(YEAR FROM e.posting_date) = $1
          GROUP BY 1, 2, 3, 4
         HAVING COALESCE(SUM(l.debit_minor + l.credit_minor) FILTER (
                    WHERE a.statement_section = 'COST_OF_SALES'
                       OR l.account_code IN (
                          SELECT account_code FROM account_resolution
                           WHERE role IN ('revenue_cash', 'revenue_debit', 'revenue_credit',
                                          'sales_cash', 'sales_discount', 'sales_return'))), 0) > 0
          ORDER BY 3, 4, (l.unit_id <> 'ho'), 1",
    )
    .bind(year)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let revenue: i64 = row.try_get("revenue")?;
            let cogs: i64 = row.try_get("cogs")?;
            Ok(CogsMonthRow {
                unit_id: row.try_get("unit_id")?,
                unit_name: row.try_get("unit_name")?,
                year: row.try_get("year")?,
                month: row.try_get("month")?,
                revenue_minor: revenue,
                cogs_minor: cogs,
                gross_margin_minor: revenue - cogs,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Stock adjustments
// ---------------------------------------------------------------------------

/// A change to stock value that is not a purchase, a transfer or a sale:
/// counts, losses, write-offs — booked, or still waiting to be.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StockAdjustmentRow {
    /// `BOOKED` — in the ledger; `SHORT_IN_TRANSIT` — short at a store's
    /// count, still on 1031; `MISSING` — a piece in a Missing place, still on
    /// 1029. The last two are what Inventory has yet to settle as found or lost.
    pub state: String,
    pub unit_id: String,
    pub on_date: Option<NaiveDate>,
    /// The entry number for a booked one; the surat jalan or place otherwise.
    pub reference: String,
    pub kind: String,
    pub description: String,
    pub quantity: Option<i64>,
    /// Signed: negative takes value off the stock.
    pub value_minor: i64,
}

pub async fn stock_adjustments(pool: &PgPool) -> Result<Vec<StockAdjustmentRow>, AppError> {
    let mut out = Vec::new();

    // Booked: every entry that moved an inventory account for any reason other
    // than buying, moving or selling — and anything on a stock-loss account.
    let booked = sqlx::query(
        "SELECT e.entry_number, e.posting_date, l.unit_id, e.source_kind,
                COALESCE(e.memo, '') AS memo,
                SUM(CASE WHEN l.account_code IN (SELECT account_code FROM account_resolution
                                                  WHERE role IN ('inventory', 'bag_inventory'))
                         THEN l.debit_minor - l.credit_minor
                         ELSE -(l.debit_minor - l.credit_minor) END)::bigint AS value
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
          WHERE (l.account_code IN (SELECT account_code FROM account_resolution
                                     WHERE role IN ('inventory', 'bag_inventory'))
                 AND e.source_kind NOT IN ('GOODS_RECEIPT', 'TRANSFER', 'COGS_DAY',
                                           'COGS_DAY_UNWIND', 'REVERSAL', 'SALE_DAY'))
             OR l.account_code IN (SELECT account_code FROM account_resolution
                                    WHERE role = 'stock_loss')
          GROUP BY e.entry_id, e.entry_number, e.posting_date, l.unit_id, e.source_kind, e.memo
          ORDER BY e.posting_date DESC, e.entry_number DESC
          LIMIT 500",
    )
    .fetch_all(pool)
    .await?;
    for row in &booked {
        out.push(StockAdjustmentRow {
            state: "BOOKED".into(),
            unit_id: row.try_get("unit_id")?,
            on_date: row.try_get("posting_date")?,
            reference: row.try_get("entry_number")?,
            kind: row.try_get("source_kind")?,
            description: row.try_get("memo")?,
            quantity: None,
            value_minor: row.try_get("value")?,
        });
    }

    // Short at a store's count: still on 1031.
    for row in goods_in_transit(pool).await? {
        if row.status != "SHORT" {
            continue;
        }
        out.push(StockAdjustmentRow {
            state: "SHORT_IN_TRANSIT".into(),
            unit_id: row.destination_unit_id.clone(),
            on_date: row.dispatched_on,
            reference: row.shipment_reference.clone().unwrap_or_default(),
            kind: "SHORT_AT_COUNT".into(),
            description: format!(
                "{} {} not in the box at {}",
                row.sku_code,
                row.article_name.clone().unwrap_or_default(),
                row.destination_name
            ),
            quantity: Some(row.quantity),
            value_minor: -row.value_minor,
        });
    }

    // Pieces sitting in a Missing place: still on 1029.
    let missing = sqlx::query(
        "SELECT s.unit_id, split_part(f.place_id, ':', 1) AS pool_id, f.sku_code,
                a.name AS article_name, SUM(f.quantity)::bigint AS quantity,
                MIN(f.updated_at AT TIME ZONE 'Asia/Jakarta')::date AS since,
                (SUM(f.quantity) * COALESCE(
                    (SELECT SUM(c.unit_cost_minor * c.quantity) / NULLIF(SUM(c.quantity), 0)
                       FROM cost_layer c WHERE c.article_id = a.id), 0))::bigint AS value
           FROM edge_inventory_fact_position f
           JOIN operational_pool p ON p.id = split_part(f.place_id, ':', 1)
           JOIN site s ON s.id = p.site_id
           LEFT JOIN sku k ON k.sku_code = f.sku_code
           LEFT JOIN article a ON a.id = k.article_id
          WHERE f.quantity > 0 AND split_part(f.place_id, ':', 2) = 'missing'
            -- Missing on the road is already listed as short at count.
            AND COALESCE(p.outbound_stage, '') <> 'IN_TRANSIT'
          GROUP BY s.unit_id, split_part(f.place_id, ':', 1), f.sku_code, a.id, a.name",
    )
    .fetch_all(pool)
    .await?;
    for row in &missing {
        let sku: String = row.try_get::<Option<String>, _>("sku_code")?.unwrap_or_default();
        let name: Option<String> = row.try_get("article_name")?;
        let value: i64 = row.try_get("value")?;
        out.push(StockAdjustmentRow {
            state: "MISSING".into(),
            unit_id: row.try_get("unit_id")?,
            on_date: row.try_get("since")?,
            reference: row.try_get("pool_id")?,
            kind: "MISSING".into(),
            description: format!("{sku} {}", name.unwrap_or_default()),
            quantity: row.try_get("quantity")?,
            value_minor: -value,
        });
    }
    Ok(out)
}
