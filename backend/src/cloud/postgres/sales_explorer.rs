//! The Sales Explorer: one screen that reads the sales summary any way a
//! person asks (owner, 8 Oct 2026).
//!
//! Filter decides which data, the grouping decides the rows, the metrics are
//! the numbers, and the screen decides how to show them (a table, the stores
//! side by side, a heatmap). Everything here is one read of `sales_sku_day`
//! (0930) and `store_stock_sku` (0931) — the shelves already summed per
//! article by 0936 wherever the question is the article's, and per colour
//! and size by 0943 when nothing narrows the articles; nothing touches a
//! till line.
//!
//! The rows are what was true when each piece sold: the division and tags an
//! article carried at that moment. Stock is now, so it is grouped by what
//! things are now. Colour and size never change; the order is the article's
//! (one article, one order).

use crate::cloud::AppError;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, QueryBuilder, Row};

/// What the rows are.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExplorerGroup {
    Article,
    Sku,
    Division,
    Tag,
    Supplier,
    Po,
    Colour,
    Size,
    Store,
    Day,
    Week,
    Month,
    /// A cashier's session at one till (read off the sessions' own summary).
    Session,
    /// A way of paying (read off the payments' own summary).
    Payment,
}

impl ExplorerGroup {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        Ok(match value {
            "article" => Self::Article,
            "sku" => Self::Sku,
            "division" => Self::Division,
            "tag" => Self::Tag,
            "supplier" => Self::Supplier,
            "po" => Self::Po,
            "colour" | "color" => Self::Colour,
            "size" => Self::Size,
            "store" => Self::Store,
            "day" => Self::Day,
            "week" => Self::Week,
            "month" => Self::Month,
            "session" => Self::Session,
            "payment" => Self::Payment,
            other => {
                return Err(AppError::Validation(format!(
                    "sales can be grouped by article, sku, division, tag, supplier, po, \
                     colour, size, store, day, week, month, session or payment, not {other:?}"
                )))
            }
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Article => "article",
            Self::Sku => "sku",
            Self::Division => "division",
            Self::Tag => "tag",
            Self::Supplier => "supplier",
            Self::Po => "po",
            Self::Colour => "colour",
            Self::Size => "size",
            Self::Store => "store",
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
            Self::Session => "session",
            Self::Payment => "payment",
        }
    }

    /// Time has no stock: what is on the shelves is now, not on a day.
    fn has_stock(self) -> bool {
        !matches!(
            self,
            Self::Day | Self::Week | Self::Month | Self::Session | Self::Payment
        )
    }

    /// What the first pass groups on besides the article, read straight off
    /// a summary row `w` with no conversion per row, and the joins it needs
    /// there (colour and size are the SKU's). The key is made from it on the
    /// much smaller first pass.
    fn base(self) -> &'static str {
        match self {
            // The article is the first pass's own column.
            Self::Article | Self::Supplier | Self::Po => "NULL::text",
            Self::Sku => "w.sku_code",
            Self::Colour => "acb.colour_code",
            Self::Size => "kb.size_code",
            Self::Division => "w.division_code",
            // Grouped as the whole list and unnested afterwards, so the first
            // pass still holds every piece once.
            Self::Tag => "w.tag_codes",
            Self::Store => "w.site_id",
            Self::Day => "w.day",
            Self::Week => "date_trunc('week', w.day::timestamp)::date",
            Self::Month => "date_trunc('month', w.day::timestamp)::date",
            Self::Session | Self::Payment => "NULL::text",
        }
    }

    fn base_join(self) -> &'static str {
        match self {
            Self::Colour => {
                "LEFT JOIN sku kb ON kb.sku_code = w.sku_code
                 LEFT JOIN article_colour acb
                        ON acb.article_id = kb.article_id AND acb.colour_digit = kb.colour_digit"
            }
            Self::Size => "LEFT JOIN sku kb ON kb.sku_code = w.sku_code",
            _ => "",
        }
    }

    /// Whether the first pass keeps the article: to count articles in a
    /// group, or because the article is what the group is made from. A SKU,
    /// a colour, a size and a day need none — kept, a year by colour would be
    /// every article at every store again.
    fn keeps_article(self) -> bool {
        !matches!(
            self,
            Self::Sku
                | Self::Colour
                | Self::Size
                | Self::Day
                | Self::Week
                | Self::Month
                | Self::Session
                | Self::Payment
        )
    }

    /// Whether whole months can be read from a month summary: every
    /// grouping that does not need the day. The article summary (0932)
    /// answers the groupings that need no SKU; the SKU summary (0937)
    /// answers the SKU, colour and size keys.
    fn reads_months(self) -> bool {
        matches!(
            self,
            Self::Article | Self::Division | Self::Tag | Self::Supplier | Self::Po | Self::Store
                | Self::Month
                | Self::Sku
                | Self::Colour
                | Self::Size
        )
    }

    /// From a first-pass row `s1` to the row key.
    fn key(self) -> (&'static str, &'static str) {
        match self {
            Self::Article => ("COALESCE(s1.article_id::text, '')", ""),
            Self::Supplier => (
                "COALESCE(po.supplier_id, '')",
                "LEFT JOIN article_purchase_line apl ON apl.article_id = s1.article_id
                 LEFT JOIN purchase_order_line pol ON pol.po_line_id = apl.po_line_id
                 LEFT JOIN purchase_order po ON po.purchase_order_id = pol.purchase_order_id",
            ),
            Self::Po => (
                "COALESCE(po.po_number, '')",
                "LEFT JOIN article_purchase_line apl ON apl.article_id = s1.article_id
                 LEFT JOIN purchase_order_line pol ON pol.po_line_id = apl.po_line_id
                 LEFT JOIN purchase_order po ON po.purchase_order_id = pol.purchase_order_id",
            ),
            Self::Tag => (
                "tc.code",
                "CROSS JOIN LATERAL unnest(CASE WHEN cardinality(s1.base) = 0
                                                THEN ARRAY['']::text[]
                                                ELSE s1.base END) AS tc(code)",
            ),
            _ => ("COALESCE(s1.base::text, '')", ""),
        }
    }

    /// The same key over stock on hand `x` (a store and SKU, now), grouped
    /// by what things are now.
    fn stock_key(self) -> (&'static str, &'static str) {
        match self {
            Self::Article => ("x.article_id::text", ""),
            Self::Sku => ("x.sku_code", ""),
            Self::Division => (
                "COALESCE(a.division_code, '')",
                "LEFT JOIN article a ON a.id = x.article_id",
            ),
            Self::Tag => (
                "COALESCE(t.tag_code, '')",
                "LEFT JOIN article_tag t ON t.article_id = x.article_id",
            ),
            Self::Supplier | Self::Po => (
                if matches!(self, Self::Supplier) {
                    "COALESCE(po.supplier_id, '')"
                } else {
                    "COALESCE(po.po_number, '')"
                },
                "LEFT JOIN article_purchase_line apl ON apl.article_id = x.article_id
                 LEFT JOIN purchase_order_line pol ON pol.po_line_id = apl.po_line_id
                 LEFT JOIN purchase_order po ON po.purchase_order_id = pol.purchase_order_id",
            ),
            Self::Colour => (
                "COALESCE(ac.colour_code, '')",
                "LEFT JOIN article_colour ac
                        ON ac.article_id = x.article_id AND ac.colour_digit = x.colour_digit",
            ),
            Self::Size => ("COALESCE(x.size_code::text, '')", ""),
            Self::Store => ("x.site_id", ""),
            Self::Day | Self::Week | Self::Month | Self::Session | Self::Payment => ("''", ""),
        }
    }

    /// Whether the group's stock key is the article's: such stock is read
    /// off the article rollup (0936) rather than the shelves.
    fn reads_article_stock(self) -> bool {
        matches!(
            self,
            Self::Article
                | Self::Division
                | Self::Tag
                | Self::Supplier
                | Self::Po
                | Self::Store
        )
    }

    /// The same key over an article-stock row `a` (0936), and the joins it
    /// needs there. A tag repeats an article's stock under each of its
    /// tags, exactly as the shelf reading does.
    fn article_stock_key(self) -> (&'static str, &'static str) {
        match self {
            Self::Article => ("a.article_id::text", ""),
            Self::Division => (
                "COALESCE(ar.division_code, '')",
                "LEFT JOIN article ar ON ar.id = a.article_id",
            ),
            Self::Tag => (
                "COALESCE(t.tag_code, '')",
                "LEFT JOIN article_tag t ON t.article_id = a.article_id",
            ),
            Self::Supplier | Self::Po => (
                if matches!(self, Self::Supplier) {
                    "COALESCE(po.supplier_id, '')"
                } else {
                    "COALESCE(po.po_number, '')"
                },
                "LEFT JOIN article_purchase_line apl ON apl.article_id = a.article_id
                 LEFT JOIN purchase_order_line pol ON pol.po_line_id = apl.po_line_id
                 LEFT JOIN purchase_order po ON po.purchase_order_id = pol.purchase_order_id",
            ),
            Self::Store => ("a.site_id", ""),
            _ => ("''", ""),
        }
    }

    /// The row's name, a second line, and a picture, from its key `p.key`.
    fn label(self) -> (&'static str, &'static str, &'static str, &'static str) {
        match self {
            Self::Article => (
                "COALESCE(a.article_code || ' · ' || a.name, 'Unknown article')",
                // The division and the tags it carries now.
                "NULLIF(concat_ws(' · ', COALESCE(dv.label, a.division_code),
                                  (SELECT string_agg(tg2.label, ', ' ORDER BY tg2.label)
                                     FROM article_tag at2
                                     JOIN tag tg2 ON tg2.code = at2.tag_code
                                    WHERE at2.article_id = a.id)), '')",
                "a.image_url",
                "LEFT JOIN article a ON a.id = NULLIF(p.p_key, '')::uuid
                 LEFT JOIN division dv ON dv.code = a.division_code",
            ),
            Self::Sku => (
                // The piece's name with its colour and size, then the SKU code.
                "COALESCE(a.name || COALESCE(' · ' || NULLIF(concat_ws(' / ',
                              COALESCE(c.label, ac.label), sz.label), ''), ''), p.p_key)",
                "p.p_key",
                "a.image_url",
                "LEFT JOIN sku k ON k.sku_code = p.p_key
                 LEFT JOIN article a ON a.id = k.article_id
                 LEFT JOIN article_colour ac
                        ON ac.article_id = k.article_id AND ac.colour_digit = k.colour_digit
                 LEFT JOIN colour c ON c.code = ac.colour_code
                 LEFT JOIN size_code sz ON sz.code = k.size_code",
            ),
            Self::Division => (
                "COALESCE(dv.label, NULLIF(p.p_key, ''), 'Unclassified')",
                "NULL::text",
                "NULL::text",
                "LEFT JOIN division dv ON dv.code = p.p_key",
            ),
            Self::Tag => (
                "COALESCE(tg.label, NULLIF(p.p_key, ''), 'Untagged')",
                "NULL::text",
                "NULL::text",
                "LEFT JOIN tag tg ON tg.code = p.p_key",
            ),
            Self::Supplier => (
                "COALESCE((SELECT COALESCE(po.supplier_name_snapshot, po.supplier_name)
                             FROM purchase_order po WHERE po.supplier_id = p.p_key
                            ORDER BY po.created_at DESC LIMIT 1),
                          NULLIF(p.p_key, ''), 'No supplier')",
                "NULL::text",
                "NULL::text",
                "",
            ),
            Self::Po => (
                "COALESCE(NULLIF(p.p_key, ''), 'No PO')",
                "(SELECT COALESCE(po.supplier_name_snapshot, po.supplier_name)
                    FROM purchase_order po WHERE po.po_number = p.p_key LIMIT 1)",
                "NULL::text",
                "",
            ),
            Self::Colour => (
                "COALESCE(c.label, NULLIF(p.p_key, ''), 'No colour')",
                "NULL::text",
                "NULL::text",
                "LEFT JOIN colour c ON c.code = p.p_key",
            ),
            Self::Size => (
                "COALESCE(sz.label, NULLIF(p.p_key, ''), 'No size')",
                "NULL::text",
                "NULL::text",
                "LEFT JOIN size_code sz ON sz.code = p.p_key",
            ),
            Self::Store => (
                "COALESCE(st.name, p.p_key)",
                "st.code",
                "NULL::text",
                "LEFT JOIN site st ON st.id = p.p_key",
            ),
            Self::Day | Self::Week | Self::Month | Self::Session | Self::Payment => {
                ("p.p_key", "NULL::text", "NULL::text", "")
            }
        }
    }

    /// Time reads oldest first; everything else biggest first.
    fn default_sort(self) -> (&'static str, bool) {
        match self {
            Self::Day | Self::Week | Self::Month => ("key", false),
            Self::Session => ("key", true),
            _ => ("sales", true),
        }
    }
}

/// The question, as the screen's query string asks it. Lists are comma
/// separated; an absent list means all.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct ExplorerQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub group: Option<String>,
    pub stores: Option<String>,
    pub divisions: Option<String>,
    pub tags: Option<String>,
    pub suppliers: Option<String>,
    pub colours: Option<String>,
    pub sizes: Option<String>,
    /// Article code or name, or a SKU code.
    pub q: Option<String>,
    /// A metric key (`sales`, `qty`, `discount`, `discount_rate`, `profit`,
    /// `margin`, `stock`, `stock_value`, `sell_through`, `articles`, `key`)
    /// and `asc` / `desc`.
    pub sort: Option<String>,
    pub dir: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    /// `false` on the pages after the first: their totals, stores and
    /// freshness are never read, so they are not computed.
    pub totals: Option<bool>,
    /// `previous` (the same length just before) or `year` (a year earlier).
    pub compare: Option<String>,
    /// Each row at each store, for the store matrix and the heatmap.
    pub matrix: Option<bool>,
    /// Stock on hand now, beside the sales.
    pub stock: Option<bool>,
    /// Only rows that hold stock and sold nothing in the window.
    pub unsold: Option<bool>,
    /// Count the distinct articles in each row. Asked for only when shown:
    /// by division or store over a year it is a pass over every article.
    pub articles: Option<bool>,
}

/// One group's (or one store's) numbers.
#[derive(Clone, Debug, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExplorerFigures {
    /// Distinct articles that sold or came back.
    pub articles: i64,
    /// Pieces sold, less pieces brought back.
    pub qty: i64,
    pub sold_qty: i64,
    pub returned_qty: i64,
    /// What the pieces would have fetched at their list price.
    pub list_minor: i64,
    /// What was charged, before returns.
    pub charged_minor: i64,
    pub returns_minor: i64,
    /// Net sales: charged less refunds.
    pub sales_minor: i64,
    /// List less charged: markdowns, promotions and bill discounts together.
    pub discount_minor: i64,
    pub full_qty: i64,
    pub full_minor: i64,
    pub discounted_qty: i64,
    pub discounted_minor: i64,
    /// HPP of what sold, less what came back to the shelf. Absent for those
    /// who may not see cost.
    pub cost_minor: Option<i64>,
    /// Net sales of the costed pieces less their cost; absent when no piece
    /// had a cost (then there is no profit to speak of, not a 100 % margin).
    pub profit_minor: Option<i64>,
    /// Pieces sold before their article had a cost, and what they fetched;
    /// never priced at zero. Profit and margin leave them out.
    pub uncosted_qty: i64,
    pub uncosted_minor: i64,
    /// Pieces on hand now, and their cost (absent without the right).
    pub stock: Option<i64>,
    pub stock_cost_minor: Option<i64>,
    /// Receipts completed and voided, and what the voided ones had charged.
    /// Only on the totals (all stores and each store), and only when nothing
    /// narrows the items: a receipt is not a sum of the rows it holds.
    pub receipts: Option<i64>,
    pub voided_receipts: Option<i64>,
    pub voided_minor: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExplorerCell {
    pub site_id: String,
    pub figures: ExplorerFigures,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExplorerRow {
    pub key: String,
    pub label: String,
    pub detail: Option<String>,
    pub image_url: Option<String>,
    pub figures: ExplorerFigures,
    pub compare: Option<ExplorerFigures>,
    /// Per store, only when the matrix was asked for and only where it sold
    /// or holds stock.
    pub cells: Vec<ExplorerCell>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExplorerStore {
    pub site_id: String,
    pub code: Option<String>,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SalesExplorer {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub compare_from: Option<NaiveDate>,
    pub compare_to: Option<NaiveDate>,
    pub group: String,
    pub sort: String,
    pub dir: String,
    /// The stores in scope: the matrix's columns.
    pub stores: Vec<ExplorerStore>,
    pub rows: Vec<ExplorerRow>,
    /// How many rows there are in all (the page is `rows`).
    pub rows_total: i64,
    /// Every piece once, whatever rows it falls in (by tag the rows overlap).
    pub total: ExplorerFigures,
    pub total_compare: Option<ExplorerFigures>,
    pub store_totals: Vec<ExplorerCell>,
    pub can_see_cost: bool,
    /// The newest and oldest business days the summary holds.
    pub latest_day: Option<NaiveDate>,
    pub earliest_day: Option<NaiveDate>,
    /// Store days still being summed; their figures may move.
    pub pending_days: i64,
    pub stock_as_of: Option<DateTime<Utc>>,
}

fn list(value: &Option<String>) -> Vec<String> {
    value
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

/// The figures' sums over a set of summary rows `w` (or first-pass rows).
const SUMS: &str = "
    SUM(sold_qty)::bigint AS sold_qty, SUM(returned_qty)::bigint AS returned_qty,
    SUM(list_minor)::bigint AS list_minor, SUM(net_minor)::bigint AS charged_minor,
    SUM(refund_minor)::bigint AS returns_minor,
    SUM(full_qty)::bigint AS full_qty, SUM(full_minor)::bigint AS full_minor,
    SUM(discounted_qty)::bigint AS discounted_qty,
    SUM(discounted_minor)::bigint AS discounted_minor,
    SUM(cost_minor)::bigint AS cost_minor, SUM(uncosted_qty)::bigint AS uncosted_qty,
    SUM(uncosted_minor)::bigint AS uncosted_minor";

const SUMS_OF_SUMS: &str = "
    SUM(sold_qty)::bigint AS sold_qty, SUM(returned_qty)::bigint AS returned_qty,
    SUM(list_minor)::bigint AS list_minor, SUM(charged_minor)::bigint AS charged_minor,
    SUM(returns_minor)::bigint AS returns_minor,
    SUM(full_qty)::bigint AS full_qty, SUM(full_minor)::bigint AS full_minor,
    SUM(discounted_qty)::bigint AS discounted_qty,
    SUM(discounted_minor)::bigint AS discounted_minor,
    SUM(cost_minor)::bigint AS cost_minor, SUM(uncosted_qty)::bigint AS uncosted_qty,
    SUM(uncosted_minor)::bigint AS uncosted_minor";

/// The sort expression over a totals row `t` (with stock `sk`).
fn sort_expr(sort: &str, can_see_cost: bool) -> Result<&'static str, AppError> {
    Ok(match sort {
        "sales" => "COALESCE(t.charged_minor - t.returns_minor, 0)",
        "qty" => "COALESCE(t.sold_qty - t.returned_qty, 0)",
        "sold" => "COALESCE(t.sold_qty, 0)",
        "returns" => "COALESCE(t.returns_minor, 0)",
        "discount" => "COALESCE(t.list_minor - t.charged_minor, 0)",
        "discount_rate" => {
            "COALESCE((t.list_minor - t.charged_minor)::numeric / NULLIF(t.list_minor, 0), 0)"
        }
        "discounted_share" => {
            "COALESCE(t.discounted_minor::numeric / NULLIF(t.charged_minor, 0), 0)"
        }
        "articles" => "COALESCE(t.articles, 0)",
        "stock" => "COALESCE(sk.on_hand, 0)",
        "sell_through" => {
            "COALESCE(t.sold_qty, 0)::numeric
             / NULLIF(COALESCE(t.sold_qty, 0) + COALESCE(sk.on_hand, 0), 0)"
        }
        "key" => "k.p_key",
        "profit" | "margin" | "stock_value" if !can_see_cost => {
            return Err(AppError::Forbidden(
                "cost, profit and margin are not shown to this role".into(),
            ))
        }
        "profit" => {
            "COALESCE(t.charged_minor - t.returns_minor - t.uncosted_minor - t.cost_minor, 0)"
        }
        "margin" => {
            "COALESCE((t.charged_minor - t.returns_minor - t.uncosted_minor - t.cost_minor)::numeric
                      / NULLIF(t.charged_minor - t.returns_minor - t.uncosted_minor, 0), 0)"
        }
        "stock_value" => "COALESCE(sk.stock_cost, 0)",
        other => {
            return Err(AppError::Validation(format!(
                "cannot sort sales by {other:?}"
            )))
        }
    })
}

/// The window a comparison reads.
fn compare_window(
    compare: Option<&str>,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Option<(NaiveDate, NaiveDate)>, AppError> {
    match compare.map(str::trim).filter(|c| !c.is_empty()) {
        None | Some("none") => Ok(None),
        Some("previous") => {
            let days = (to - from).num_days() + 1;
            Ok(Some((from - Duration::days(days), from - Duration::days(1))))
        }
        Some("year") => {
            let back = |d: NaiveDate| {
                d.with_year(d.year() - 1)
                    .or_else(|| (d - Duration::days(1)).with_year(d.year() - 1))
                    .unwrap_or(d - Duration::days(365))
            };
            Ok(Some((back(from), back(to))))
        }
        Some(other) => Err(AppError::Validation(format!(
            "compare with previous or year, not {other:?}"
        ))),
    }
}

/// A window as the whole months inside it (first and last month, as their
/// first days) and the days around them.
fn split_months(
    from: NaiveDate,
    to: NaiveDate,
) -> (Vec<(NaiveDate, NaiveDate)>, Option<(NaiveDate, NaiveDate)>) {
    let first_of = |d: NaiveDate| d.with_day(1).unwrap_or(d);
    let next_month = |d: NaiveDate| {
        let first = first_of(d);
        if first.month() == 12 {
            NaiveDate::from_ymd_opt(first.year() + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(first.year(), first.month() + 1, 1)
        }
        .unwrap_or(first)
    };
    let first_whole = if from.day() == 1 { from } else { next_month(from) };
    let after_to = to + Duration::days(1);
    let last_whole = if after_to.day() == 1 {
        first_of(to)
    } else {
        first_of(to) - Duration::days(1)
    };
    let last_whole = first_of(last_whole);
    if first_whole > to || last_whole < first_whole || next_month(last_whole) > after_to {
        return (vec![(from, to)], None);
    }
    let mut days = Vec::new();
    if from < first_whole {
        days.push((from, first_whole - Duration::days(1)));
    }
    let end_whole = next_month(last_whole);
    if end_whole <= to {
        days.push((end_whole, to));
    }
    (days, Some((first_whole, last_whole)))
}

/// Which month summary a window's whole months are read from, if any.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Months {
    None,
    /// `sales_article_month` (0932): the groupings that need no SKU.
    Article,
    /// `sales_sku_month` (0937): the SKU, colour and size keys.
    Sku,
}

/// Bind the filters every pass shares. `$1..$2` the window, `$3..$4` the
/// comparison (or nulls), then the lists and the search.
struct Filters {
    from: NaiveDate,
    to: NaiveDate,
    cmp: Option<(NaiveDate, NaiveDate)>,
    stores: Vec<String>,
    divisions: Vec<String>,
    tags: Vec<String>,
    suppliers: Vec<String>,
    colours: Vec<String>,
    sizes: Vec<String>,
    q: Option<String>,
}

impl Filters {
    /// Summary rows `w` in either window, with `period` 0 (the window) or 1
    /// (the comparison): whole months from a month summary — the article's
    /// (0932) or the SKU's (0937) — and the days around them (or every
    /// day) from the day summary.
    fn push_window(&self, b: &mut QueryBuilder<'_, Postgres>, months: Months) {
        b.push("win AS NOT MATERIALIZED (");
        let mut first = true;
        let mut windows = vec![(0, self.from, self.to)];
        if let Some((cf, ct)) = self.cmp {
            windows.push((1, cf, ct));
        }
        for (period, from, to) in windows {
            let (days, whole) = if months == Months::None {
                (vec![(from, to)], None)
            } else {
                split_months(from, to)
            };
            for (df, dt) in days {
                if !first {
                    b.push(" UNION ALL ");
                }
                first = false;
                b.push(format!(
                    "SELECT d.business_date AS day, d.site_id, d.sku_code, d.article_id,
                            d.division_code, d.tag_codes,
                            d.sold_qty, d.returned_qty, d.list_minor, d.net_minor,
                            d.refund_minor, d.full_qty, d.full_minor, d.discounted_qty,
                            d.discounted_minor, d.cost_minor, d.uncosted_qty, d.uncosted_minor,
                            {period} AS period
                       FROM sales_sku_day d
                      WHERE d.business_date BETWEEN "
                ));
                b.push_bind(df).push(" AND ").push_bind(dt);
                self.push_row_filters(b, "d", true);
            }
            if let Some((mf, ml)) = whole {
                if !first {
                    b.push(" UNION ALL ");
                }
                first = false;
                b.push(format!(
                    "SELECT m.month AS day, m.site_id, {month_sku} AS sku_code, m.article_id,
                            m.division_code, m.tag_codes,
                            m.sold_qty, m.returned_qty, m.list_minor, m.net_minor,
                            m.refund_minor, m.full_qty, m.full_minor, m.discounted_qty,
                            m.discounted_minor, m.cost_minor, m.uncosted_qty, m.uncosted_minor,
                            {period} AS period
                       FROM {month_table} m
                      WHERE m.month BETWEEN ",
                    month_sku = if months == Months::Sku {
                        "m.sku_code"
                    } else {
                        "NULL::text"
                    },
                    month_table = if months == Months::Sku {
                        "sales_sku_month"
                    } else {
                        "sales_article_month"
                    },
                ));
                b.push_bind(mf).push(" AND ").push_bind(ml);
                self.push_row_filters(b, "m", months == Months::Sku);
            }
        }
        b.push(")");
    }

    /// The filters on one summary's rows `{t}`.
    fn push_row_filters(&self, b: &mut QueryBuilder<'_, Postgres>, t: &str, has_sku: bool) {
        if !self.stores.is_empty() {
            b.push(format!(" AND {t}.site_id = ANY("))
                .push_bind(self.stores.clone())
                .push(")");
        }
        if !self.divisions.is_empty() {
            b.push(format!(" AND {t}.division_code = ANY("))
                .push_bind(self.divisions.clone())
                .push(")");
        }
        if !self.tags.is_empty() {
            b.push(format!(" AND {t}.tag_codes && "))
                .push_bind(self.tags.clone())
                .push("::text[]");
        }
        let sku = format!("{t}.sku_code");
        self.push_item_filters(b, &format!("{t}.article_id"), has_sku.then_some(sku.as_str()));
    }

    /// Filters on what an article or SKU is (supplier, colour, size, search):
    /// fixed facts, so stock and sales read them the same way. A search finds
    /// articles — by code, by name, or by one of their SKU codes.
    fn push_item_filters(
        &self,
        b: &mut QueryBuilder<'_, Postgres>,
        article: &str,
        sku: Option<&str>,
    ) {
        if !self.suppliers.is_empty() {
            b.push(format!(
                " AND {article} IN (SELECT apl.article_id FROM article_purchase_line apl
                     JOIN purchase_order_line pol ON pol.po_line_id = apl.po_line_id
                     JOIN purchase_order po ON po.purchase_order_id = pol.purchase_order_id
                    WHERE po.supplier_id = ANY("
            ))
            .push_bind(self.suppliers.clone())
            .push("))");
        }
        if let Some(sku) = sku {
            if !self.colours.is_empty() || !self.sizes.is_empty() {
                b.push(format!(
                    " AND {sku} IN (SELECT k.sku_code FROM sku k
                         LEFT JOIN article_colour ac
                                ON ac.article_id = k.article_id AND ac.colour_digit = k.colour_digit
                        WHERE true"
                ));
                if !self.colours.is_empty() {
                    b.push(" AND ac.colour_code = ANY(")
                        .push_bind(self.colours.clone())
                        .push(")");
                }
                if !self.sizes.is_empty() {
                    b.push(" AND k.size_code::text = ANY(")
                        .push_bind(self.sizes.clone())
                        .push(")");
                }
                b.push(")");
            }
        }
        if let Some(q) = &self.q {
            let pattern = format!(
                "%{}%",
                q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
            );
            b.push(format!(
                " AND {article} IN (SELECT a.id FROM article a
                                     WHERE a.article_code ILIKE "
            ))
            .push_bind(pattern.clone())
            .push(" OR a.name ILIKE ")
            .push_bind(pattern.clone())
            .push(" UNION SELECT k.article_id FROM sku k WHERE k.sku_code ILIKE ")
            .push_bind(pattern)
            .push(")");
        }
    }

    /// Stock on hand now `x`, under the same filters read as of now: the
    /// division and tags the article carries today.
    fn push_stock(&self, b: &mut QueryBuilder<'_, Postgres>) {
        b.push(
            "stk AS NOT MATERIALIZED (
                SELECT x.site_id, x.sku_code, k.article_id, k.colour_digit, k.size_code,
                       x.on_hand
                  FROM store_stock_sku x
                  JOIN sku k ON k.sku_code = x.sku_code
                 WHERE true",
        );
        if !self.stores.is_empty() {
            b.push(" AND x.site_id = ANY(").push_bind(self.stores.clone()).push(")");
        }
        if !self.divisions.is_empty() {
            b.push(" AND k.article_id IN (SELECT a.id FROM article a WHERE a.division_code = ANY(")
                .push_bind(self.divisions.clone())
                .push("))");
        }
        if !self.tags.is_empty() {
            b.push(" AND k.article_id IN (SELECT t.article_id FROM article_tag t WHERE t.tag_code = ANY(")
                .push_bind(self.tags.clone())
                .push("))");
        }
        self.push_item_filters(b, "k.article_id", Some("x.sku_code"));
        b.push(")");
    }

    /// Article-grain stock `astk` (0936): what each store holds per article,
    /// its value already summed by the refresh that keeps it. The filters
    /// are the article-level ones, as subqueries, so no row is counted
    /// twice.
    fn push_article_stock(&self, b: &mut QueryBuilder<'_, Postgres>) {
        b.push(
            "astk AS (
                SELECT a.article_id, a.site_id, a.on_hand,
                       a.stock_cost_minor AS stock_cost
                  FROM store_stock_article a
                 WHERE true",
        );
        if !self.stores.is_empty() {
            b.push(" AND a.site_id = ANY(")
                .push_bind(self.stores.clone())
                .push(")");
        }
        if !self.divisions.is_empty() {
            b.push(
                " AND a.article_id IN (SELECT ar.id FROM article ar
                      WHERE ar.division_code = ANY(",
            )
            .push_bind(self.divisions.clone())
            .push("))");
        }
        if !self.tags.is_empty() {
            b.push(
                " AND a.article_id IN (SELECT t.article_id FROM article_tag t
                      WHERE t.tag_code = ANY(",
            )
            .push_bind(self.tags.clone())
            .push("))");
        }
        self.push_item_filters(b, "a.article_id", None);
        b.push(")");
    }

    /// Colour- or size-grain stock `cstk` (0943): what each store holds
    /// under one colour, or one size, its value already summed by the
    /// refresh that keeps it. Reached only when nothing narrows the
    /// articles, so the key's own filter and the stores are all that
    /// filter it.
    fn push_key_stock(&self, b: &mut QueryBuilder<'_, Postgres>, group: ExplorerGroup) {
        let (table, key, keys): (&str, &str, &[String]) = match group {
            ExplorerGroup::Colour => ("store_stock_colour", "c.colour_code", &self.colours),
            ExplorerGroup::Size => ("store_stock_size", "c.size_code::text", &self.sizes),
            // Only the two keys their own rollup answers ever arrive here.
            _ => return,
        };
        b.push(format!(
            "cstk AS (
                SELECT {key} AS p_key, c.site_id, c.on_hand,
                       c.stock_cost_minor AS stock_cost
                  FROM {table} c
                 WHERE true"
        ));
        if !keys.is_empty() {
            b.push(format!(" AND {key} = ANY("))
                .push_bind(keys.to_vec())
                .push(")");
        }
        if !self.stores.is_empty() {
            b.push(" AND c.site_id = ANY(")
                .push_bind(self.stores.clone())
                .push(")");
        }
        b.push(")");
    }
}

/// Read the explorer.
pub async fn sales_explorer(
    pool: &PgPool,
    query: &ExplorerQuery,
    can_see_cost: bool,
) -> Result<SalesExplorer, AppError> {
    let group = ExplorerGroup::parse(query.group.as_deref().unwrap_or("article"))?;
    if matches!(group, ExplorerGroup::Session | ExplorerGroup::Payment) {
        return transaction_groups(pool, query, group, can_see_cost).await;
    }
    sales_explorer_items(pool, query, can_see_cost).await
}

/// What a way of paying (or a cashier's session) took, in the figures the
/// screen already reads. Money collected is what the tills took, PPN included;
/// the number of receipts is the receipts paid that way.
fn paid_figures(receipts: i64, amount_minor: i64, sold_qty: i64) -> ExplorerFigures {
    ExplorerFigures {
        qty: sold_qty,
        sold_qty,
        charged_minor: amount_minor,
        sales_minor: amount_minor,
        receipts: Some(receipts),
        ..ExplorerFigures::default()
    }
}

fn method_label(method: &str) -> String {
    match method {
        "CASH" => "Cash".into(),
        "CARD" => "Card".into(),
        "CARD_DEBIT" => "Debit card".into(),
        "CARD_CREDIT" => "Credit card".into(),
        "QRIS" => "QRIS".into(),
        other => {
            let lower = other.replace('_', " ").to_lowercase();
            let mut chars = lower.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        }
    }
}

/// The groupings that are about receipts rather than items — a way of paying,
/// a cashier's session — read off their own per-store-day summaries (0934).
/// An item filter cannot narrow them (a receipt is not an item), so the
/// filters here are the period and the stores; the totals, the stores and the
/// stock come from the store reading under those same two.
async fn transaction_groups(
    pool: &PgPool,
    query: &ExplorerQuery,
    group: ExplorerGroup,
    can_see_cost: bool,
) -> Result<SalesExplorer, AppError> {
    let mut base = query.clone();
    base.group = Some("store".into());
    base.divisions = None;
    base.tags = None;
    base.suppliers = None;
    base.colours = None;
    base.sizes = None;
    base.q = None;
    base.matrix = Some(false);
    base.unsold = None;
    base.articles = None;
    base.sort = None;
    base.dir = None;
    base.limit = Some(1);
    base.offset = None;
    let mut out = sales_explorer_items(pool, &base, can_see_cost).await?;

    let stores = list(&query.stores);
    let limit = query.limit.unwrap_or(100).clamp(1, 1000);
    let offset = query.offset.unwrap_or(0).max(0);
    let sort = query
        .sort
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(if group == ExplorerGroup::Session { "key" } else { "sales" })
        .to_string();
    let by_sales = matches!(sort.as_str(), "sales" | "qty" | "sold");
    let desc = !matches!(query.dir.as_deref(), Some("asc"));

    if group == ExplorerGroup::Payment {
        let window = |from: NaiveDate, to: NaiveDate| {
            let stores = stores.clone();
            async move {
                sqlx::query(
                    "SELECT method, site_id, SUM(receipts)::bigint AS receipts,
                            SUM(amount_minor)::bigint AS amount
                       FROM sales_payment_day
                      WHERE business_date BETWEEN $1 AND $2
                        AND (cardinality($3::text[]) = 0 OR site_id = ANY($3))
                      GROUP BY method, site_id",
                )
                .bind(from)
                .bind(to)
                .bind(&stores)
                .fetch_all(pool)
                .await
            }
        };
        let mut figures = std::collections::BTreeMap::<String, (i64, i64)>::new();
        let mut cells = std::collections::BTreeMap::<String, Vec<ExplorerCell>>::new();
        for row in window(query.from, query.to).await? {
            let method: String = row.try_get("method")?;
            let site_id: String = row.try_get("site_id")?;
            let receipts: i64 = row.try_get("receipts")?;
            let amount: i64 = row.try_get("amount")?;
            let entry = figures.entry(method.clone()).or_default();
            entry.0 += receipts;
            entry.1 += amount;
            cells.entry(method).or_default().push(ExplorerCell {
                site_id,
                figures: paid_figures(receipts, amount, 0),
            });
        }
        let mut compare = std::collections::BTreeMap::<String, (i64, i64)>::new();
        if let Some((cf, ct)) = compare_window(query.compare.as_deref(), query.from, query.to)? {
            for row in window(cf, ct).await? {
                let entry = compare.entry(row.try_get::<String, _>("method")?).or_default();
                entry.0 += row.try_get::<i64, _>("receipts")?;
                entry.1 += row.try_get::<i64, _>("amount")?;
            }
        }
        let mut rows: Vec<ExplorerRow> = figures
            .into_iter()
            .map(|(method, (receipts, amount))| ExplorerRow {
                label: method_label(&method),
                detail: None,
                image_url: None,
                figures: paid_figures(receipts, amount, 0),
                compare: compare.get(&method).map(|(r, a)| paid_figures(*r, *a, 0)),
                cells: cells.remove(&method).unwrap_or_default(),
                key: method,
            })
            .collect();
        rows.sort_by(|a, b| {
            let order = if sort == "receipts" {
                a.figures.receipts.cmp(&b.figures.receipts)
            } else if by_sales {
                a.figures.sales_minor.cmp(&b.figures.sales_minor)
            } else {
                a.label.cmp(&b.label)
            };
            if desc && sort != "key" { order.reverse() } else { order }
        });
        out.rows_total = i64::try_from(rows.len()).unwrap_or(0);
        out.rows = rows;
    } else {
        let order = if by_sales {
            "s.net_minor DESC, s.business_date DESC, s.site_id"
        } else if desc {
            "s.business_date DESC, st.code NULLS LAST, s.first_sale_at DESC NULLS LAST, s.shift_key"
        } else {
            "s.business_date ASC, st.code NULLS LAST, s.first_sale_at ASC NULLS LAST, s.shift_key"
        };
        let pattern = query
            .q
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .map(|q| {
                format!(
                    "%{}%",
                    q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
                )
            });
        let rows = sqlx::query(&format!(
            "SELECT s.shift_key, s.business_date, s.site_id, s.receipts, s.voided_receipts,
                    s.sold_qty, s.net_minor, st.code AS store_code, cs.terminal_id,
                    COALESCE(u.display_name, cs.opened_by) AS cashier,
                    to_char(cs.opened_at AT TIME ZONE site_business_timezone(s.site_id), 'HH24:MI')
                        AS opened,
                    to_char(cs.closed_at AT TIME ZONE site_business_timezone(s.site_id), 'HH24:MI')
                        AS closed,
                    COUNT(*) OVER () AS total
               FROM sales_shift_day s
               LEFT JOIN site st ON st.id = s.site_id
               LEFT JOIN cash_shift cs ON cs.shift_id = NULLIF(s.shift_key, '')::uuid
               LEFT JOIN app_user u ON u.username = cs.opened_by
              WHERE s.business_date BETWEEN $1 AND $2
                AND (cardinality($3::text[]) = 0 OR s.site_id = ANY($3))
                AND ($4::text IS NULL OR st.code ILIKE $4 OR st.name ILIKE $4
                     OR cs.opened_by ILIKE $4 OR u.display_name ILIKE $4
                     OR cs.terminal_id ILIKE $4)
              ORDER BY {order}
              LIMIT $5 OFFSET $6"
        ))
        .bind(query.from)
        .bind(query.to)
        .bind(&stores)
        .bind(pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
        let mut total = 0_i64;
        let mut items = Vec::with_capacity(rows.len());
        for row in &rows {
            total = row.try_get("total")?;
            let key: String = row.try_get("shift_key")?;
            let day: NaiveDate = row.try_get("business_date")?;
            let site_id: String = row.try_get("site_id")?;
            let store: Option<String> = row.try_get("store_code")?;
            let terminal: Option<String> = row.try_get("terminal_id")?;
            let cashier: Option<String> = row.try_get("cashier")?;
            let opened: Option<String> = row.try_get("opened")?;
            let closed: Option<String> = row.try_get("closed")?;
            let receipts: i64 = row.try_get("receipts")?;
            let sold: i64 = row.try_get("sold_qty")?;
            let net: i64 = row.try_get("net_minor")?;
            let mut figures = paid_figures(receipts, net, sold);
            figures.voided_receipts = Some(row.try_get("voided_receipts")?);
            let label = format!(
                "{} · {} · {}",
                store.clone().unwrap_or_else(|| site_id.clone()),
                if key.is_empty() { "No session".to_string() } else { terminal.unwrap_or_else(|| "Till".into()) },
                day.format("%-d %b %Y")
            );
            let detail = if key.is_empty() {
                None
            } else {
                let span = match (opened, closed) {
                    (Some(o), Some(c)) => Some(format!("{o}–{c}")),
                    (Some(o), None) => Some(format!("{o}–open")),
                    _ => None,
                };
                let text = [cashier, span].into_iter().flatten().collect::<Vec<_>>().join(" · ");
                (!text.is_empty()).then_some(text)
            };
            items.push(ExplorerRow {
                key: if key.is_empty() { format!("{day}|{site_id}|") } else { key },
                label,
                detail,
                image_url: None,
                cells: vec![ExplorerCell {
                    site_id,
                    figures: figures.clone(),
                }],
                figures,
                compare: None,
            });
        }
        out.rows_total = total;
        out.rows = items;
    }
    out.group = group.as_str().to_string();
    out.sort = sort;
    out.dir = if desc { "desc" } else { "asc" }.to_string();
    Ok(out)
}

/// The rows that are made of items: the article, the SKU, a division, a tag,
/// a supplier, a store, a month …
async fn sales_explorer_items(
    pool: &PgPool,
    query: &ExplorerQuery,
    can_see_cost: bool,
) -> Result<SalesExplorer, AppError> {
    if query.to < query.from {
        return Err(AppError::Validation("the period ends before it starts".into()));
    }
    if (query.to - query.from).num_days() > 3 * 366 {
        return Err(AppError::Validation("a period is at most three years".into()));
    }
    let group = ExplorerGroup::parse(query.group.as_deref().unwrap_or("article"))?;
    let (default_sort, default_desc) = group.default_sort();
    let sort = query.sort.as_deref().filter(|s| !s.is_empty()).unwrap_or(default_sort);
    let desc = match query.dir.as_deref() {
        Some("asc") => false,
        Some("desc") => true,
        _ => default_desc,
    };
    let order = sort_expr(sort, can_see_cost)?;
    let limit = query.limit.unwrap_or(100).clamp(1, 1000);
    let offset = query.offset.unwrap_or(0).max(0);
    let cmp = compare_window(query.compare.as_deref(), query.from, query.to)?;
    let want_stock = query.stock.unwrap_or(false) || query.unsold.unwrap_or(false) || matches!(sort, "stock" | "stock_value" | "sell_through");
    let with_stock = want_stock && group.has_stock();
    let matrix = query.matrix.unwrap_or(false);
    let head = query.totals.unwrap_or(true);
    let filters = Filters {
        from: query.from,
        to: query.to,
        cmp,
        stores: list(&query.stores),
        divisions: list(&query.divisions),
        tags: list(&query.tags),
        suppliers: list(&query.suppliers),
        colours: list(&query.colours),
        sizes: list(&query.sizes),
        q: query
            .q
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .map(str::to_string),
    };

    super::sales_rollup_catch_up(pool, filters.from, filters.to, 60).await?;
    if let Some((cf, ct)) = filters.cmp {
        super::sales_rollup_catch_up(pool, cf, ct, 60).await?;
    }


    // One statement: the window once, then the rows, the page's cells and
    // the totals as kinds of one result.
    let base = group.base();
    let base_join = group.base_join();
    let (key, key_joins) = group.key();
    let (stock_key, stock_joins) = group.stock_key();
    let (label, detail, image, label_joins) = group.label();

    // The first pass keeps the store only where something reads per store:
    // the matrix, its totals, or the stores themselves as rows.
    let per_store = matrix || group == ExplorerGroup::Store;
    let months = if group.reads_months() {
        if !filters.colours.is_empty()
            || !filters.sizes.is_empty()
            || matches!(group, ExplorerGroup::Sku | ExplorerGroup::Colour | ExplorerGroup::Size)
        {
            Months::Sku
        } else {
            Months::Article
        }
    } else {
        Months::None
    };
    // The article stays in the first pass when the key is made from it
    // (article, supplier, PO) or its count was asked for.
    let wants_articles = query.articles.unwrap_or(false) || sort == "articles";
    let keeps_article = matches!(
        group,
        ExplorerGroup::Article | ExplorerGroup::Supplier | ExplorerGroup::Po
    ) || (wants_articles && group.keeps_article());
    let mut b = QueryBuilder::<Postgres>::new("WITH ");
    filters.push_window(&mut b, months);
    b.push(format!(
        ", s1 AS MATERIALIZED (
             SELECT {base} AS base, {article} AS article_id, {site} AS site_id, w.period, {SUMS}
               FROM win w {base_join}
              GROUP BY 1, 2, 3, 4
         ), keyed AS MATERIALIZED (
             SELECT {key} AS p_key, s1.*
               FROM s1 {key_joins}
         ), sums AS (
             SELECT p_key, period, {SUMS_OF_SUMS}
               FROM keyed GROUP BY p_key, period
         ), arts AS (
             SELECT p_key, period, count(*)::bigint AS articles
               FROM (SELECT DISTINCT p_key, period, article_id FROM keyed
                      WHERE {count_articles} AND article_id IS NOT NULL) x
              GROUP BY p_key, period
         ), tot AS (
             SELECT s.*, {articles} AS articles
               FROM sums s
               LEFT JOIN arts a ON a.p_key = s.p_key AND a.period = s.period
         )",
        article = if keeps_article { "w.article_id" } else { "NULL::uuid" },
        count_articles = if keeps_article && wants_articles { "true" } else { "false" },
        site = if per_store { "w.site_id" } else { "NULL::text" },
        articles = match group {
            ExplorerGroup::Article => "1::bigint",
            ExplorerGroup::Sku => "1::bigint",
            _ if keeps_article && wants_articles => "COALESCE(a.articles, 0)",
            _ => "0::bigint",
        },
    ));
    // The rows are what sold in the window, with their stock beside them.
    // What only holds stock joins them when the question is about stock:
    // slow movers, or sorting by stock, its value or sell-through — the only
    // questions that need every group's stock at ranking time. Anything
    // else is ranked on sales alone and reads the stock of the page's rows.
    let unsold = query.unsold.unwrap_or(false) && with_stock;
    let stock_rows =
        with_stock && (unsold || matches!(sort, "stock" | "stock_value" | "sell_through"));
    // The article rollup (0936) answers the stock of every group whose key
    // is the article's, and the estate's stock under article-level filters.
    // The colour and size rollups (0943) answer those two keys whenever
    // nothing narrows the articles — the key's own filter is then only a
    // key filter on the rollup. The other key's filter narrows within each
    // row, which a rollup summed over the whole key cannot answer, so that
    // question, like one that narrows the articles or the SKU key (the
    // SKU's own shelves), stays on the shelves.
    let shelves_only = !filters.colours.is_empty() || !filters.sizes.is_empty();
    let article_stock = with_stock && group.reads_article_stock() && !shelves_only;
    let colour_size_stock = with_stock
        && matches!(group, ExplorerGroup::Colour | ExplorerGroup::Size)
        && filters.divisions.is_empty()
        && filters.tags.is_empty()
        && filters.suppliers.is_empty()
        && filters.q.is_none()
        && if group == ExplorerGroup::Colour {
            filters.sizes.is_empty()
        } else {
            filters.colours.is_empty()
        };
    if with_stock {
        let materialized = if stock_rows || matrix {
            "MATERIALIZED"
        } else {
            "NOT MATERIALIZED"
        };
        let full_sk = if stock_rows {
            ", sk AS (
                 SELECT p_key, SUM(on_hand)::bigint AS on_hand,
                        SUM(stock_cost)::bigint AS stock_cost
                   FROM stk_keyed GROUP BY p_key
             )"
        } else {
            ""
        };
        if !shelves_only && !colour_size_stock {
            b.push(", ");
            filters.push_article_stock(&mut b);
        }
        if colour_size_stock {
            b.push(", ");
            filters.push_key_stock(&mut b, group);
            b.push(format!(
                ", stk_keyed AS {materialized} (
                     SELECT c.p_key, c.site_id, c.on_hand, c.stock_cost
                       FROM cstk c
                 ){full_sk}"
            ));
        } else if article_stock {
            let (article_key, article_joins) = group.article_stock_key();
            b.push(format!(
                ", stk_keyed AS {materialized} (
                     SELECT {article_key} AS p_key, a.site_id, a.on_hand, a.stock_cost
                       FROM astk a {article_joins}
                 ){full_sk}"
            ));
        } else if stock_rows {
            b.push(", ");
            filters.push_stock(&mut b);
            b.push(format!(
                ", stk_keyed AS {materialized} (
                     SELECT {stock_key} AS p_key, x.site_id, x.on_hand,
                            ROUND(x.on_hand * COALESCE(ucost.unit_cost, 0))::bigint AS stock_cost
                       FROM stk x
                       LEFT JOIN article_cost ucost ON ucost.article_id = x.article_id
                     {stock_joins}
                 ){full_sk}"
            ));
        } else if group != ExplorerGroup::Sku {
            // Keep the prior shared keyed-stock stage for dimension groups.
            // Their page may contain nearly every colour/size key, so a
            // page-key join can force a poor plan without narrowing the shelf
            // scan. Matrix cells and page stock share this materialized CTE.
            b.push(", ");
            filters.push_stock(&mut b);
            b.push(format!(
                ", stk_keyed AS {materialized} (
                     SELECT {stock_key} AS p_key, x.site_id, x.on_hand,
                            ROUND(x.on_hand * COALESCE(ucost.unit_cost, 0))::bigint AS stock_cost
                       FROM stk x
                       LEFT JOIN article_cost ucost ON ucost.article_id = x.article_id
                     {stock_joins}
                 )"
            ));
        }
    } else {
        b.push(
            ", stk_keyed AS (SELECT NULL::text AS p_key, NULL::text AS site_id,
                                    NULL::bigint AS on_hand, NULL::bigint AS stock_cost WHERE false),
               sk AS (SELECT NULL::text AS p_key, NULL::bigint AS on_hand,
                             NULL::bigint AS stock_cost WHERE false)",
        );
    }
    b.push(format!(
        ", keys AS (
             SELECT p_key FROM tot WHERE period = 0
             {more_keys}
         ), ranked AS (
             SELECT k.p_key, {order} AS sort_value,
                    COUNT(*) OVER () AS rows_total
               FROM keys k
               LEFT JOIN tot t ON t.p_key = k.p_key AND t.period = 0
               {sk_join}
              {unsold_where}
              ORDER BY 2 {dir} NULLS LAST, k.p_key
              LIMIT ",
        more_keys = if stock_rows {
            "UNION SELECT p_key FROM sk"
        } else {
            ""
        },
        sk_join = if stock_rows
            || (!with_stock && matches!(sort, "stock" | "stock_value" | "sell_through"))
        {
            // A stock sort over a grouping that holds none (day, week,
            // month) still joins the empty stub: it reads nulls, as before.
            "LEFT JOIN sk ON sk.p_key = k.p_key"
        } else {
            ""
        },
        unsold_where = if unsold {
            "WHERE COALESCE(t.sold_qty, 0) = 0 AND COALESCE(sk.on_hand, 0) > 0"
        } else {
            ""
        },
        dir = if desc { "DESC" } else { "ASC" },
    ));
    b.push_bind(limit).push(" OFFSET ").push_bind(offset);
    // The first character closes `ranked`, which the LIMIT/OFFSET above is
    // the end of; without it every question was a syntax error.
    b.push(
        "), page AS (
             SELECT r.*, ROW_NUMBER() OVER () AS rank FROM ranked r
         )",
    );
    // SKU codes are selective enough for the page keys to bound stock access.
    // Dimension groups keep the shared keyed-stock stage above because their
    // page can contain most of the available colour or size keys.
    if with_stock && !stock_rows && !article_stock && group == ExplorerGroup::Sku {
        b.push(", ");
        filters.push_stock(&mut b);
        b.push(format!(
            ", stk_keyed AS MATERIALIZED (
                 SELECT {stock_key} AS p_key, x.site_id, x.on_hand,
                        ROUND(x.on_hand * COALESCE(ucost.unit_cost, 0))::bigint AS stock_cost
                   FROM stk x
                   {stock_joins}
                   JOIN page page_key ON {stock_key} = page_key.p_key
                   LEFT JOIN article_cost ucost ON ucost.article_id = x.article_id
             ), sk AS (
                 SELECT p_key, SUM(on_hand)::bigint AS on_hand,
                        SUM(stock_cost)::bigint AS stock_cost
                   FROM stk_keyed GROUP BY p_key
             )"
        ));
    } else if with_stock && !stock_rows {
        // The article-stock rollup is already much smaller than the SKU
        // shelves; keep its page-filtered aggregate shared by rows and cells.
        b.push(
            ", sk AS (
                 SELECT p_key, SUM(on_hand)::bigint AS on_hand,
                        SUM(stock_cost)::bigint AS stock_cost
                   FROM stk_keyed
                  WHERE p_key IN (SELECT p_key FROM page)
                  GROUP BY p_key
             )",
        );
    }
    b.push(format!(
        " SELECT 'row' AS kind, p.rank, p.rows_total, p.p_key AS key, NULL::text AS site_id,
                0 AS period,
                {label} AS label, {detail} AS detail, {image} AS image_url,
                t.articles, t.sold_qty, t.returned_qty, t.list_minor, t.charged_minor,
                t.returns_minor, t.full_qty, t.full_minor, t.discounted_qty,
                t.discounted_minor, t.cost_minor, t.uncosted_qty, t.uncosted_minor,
                sk.on_hand, sk.stock_cost
           FROM page p
           LEFT JOIN tot t ON t.p_key = p.p_key AND t.period = 0
           LEFT JOIN sk ON sk.p_key = p.p_key
           {label_joins}
         UNION ALL
         SELECT 'compare', p.rank, NULL, p.p_key, NULL, 1, NULL, NULL, NULL,
                t.articles, t.sold_qty, t.returned_qty, t.list_minor, t.charged_minor,
                t.returns_minor, t.full_qty, t.full_minor, t.discounted_qty,
                t.discounted_minor, t.cost_minor, t.uncosted_qty, t.uncosted_minor, NULL, NULL
           FROM page p
           JOIN tot t ON t.p_key = p.p_key AND t.period = 1"
    ));
    if matrix {
        // Sales and stock per store for the page's rows, added up as one
        // list rather than joined: no sort, one hash.
        b.push(format!(
            " UNION ALL
             SELECT 'cell', NULL, NULL, c.p_key, c.site_id, 0, NULL, NULL, NULL,
                    0::bigint, {SUMS_OF_SUMS},
                    SUM(c.on_hand)::bigint, SUM(c.stock_cost)::bigint
               FROM (SELECT p_key, site_id, sold_qty, returned_qty, list_minor, charged_minor,
                            returns_minor, full_qty, full_minor, discounted_qty,
                            discounted_minor, cost_minor, uncosted_qty, uncosted_minor,
                            NULL::bigint AS on_hand, NULL::bigint AS stock_cost
                       FROM keyed
                      WHERE period = 0 AND p_key IN (SELECT p_key FROM page)
                     UNION ALL
                     SELECT p_key, site_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                            on_hand, stock_cost
                       FROM stk_keyed
                      WHERE p_key IN (SELECT p_key FROM page)) c
              GROUP BY c.p_key, c.site_id"
        ));
    }
    // Totals: every piece once, whatever the rows (by tag the rows overlap,
    // but the first pass holds each piece once with its whole tag list).
    // The pages after the first never read them.
    if head {
        b.push(format!(
            " UNION ALL
             SELECT 'total', NULL, NULL, NULL, NULL, w.period, NULL, NULL, NULL,
                    (SELECT count(*) FROM (SELECT DISTINCT x.article_id FROM s1 x
                                            WHERE {count_total} AND x.period = w.period
                                              AND x.article_id IS NOT NULL) d)::bigint,
                    {SUMS_OF_SUMS}, NULL, NULL
               FROM s1 w
              GROUP BY w.period",
            count_total = if keeps_article { "true" } else { "false" },
        ));
    }
    if per_store && head {
        b.push(format!(
            " UNION ALL
             SELECT 'store_total', NULL, NULL, NULL, w.site_id, w.period, NULL, NULL, NULL,
                    0::bigint, {SUMS_OF_SUMS}, NULL, NULL
               FROM s1 w
              WHERE w.period = 0
              GROUP BY w.site_id, w.period"
        ));
    }
    if with_stock && head {
        // The estate's stock under the filters: off whichever rollup the
        // question allows — the article's (0936), or the colour's or the
        // size's (0943) when the key is what the question is about; only
        // a colour or a size that narrows the shelves themselves reads
        // them.
        if colour_size_stock {
            b.push(
                " UNION ALL
                 SELECT CASE WHEN GROUPING(a.site_id) = 0 THEN 'store_stock' ELSE 'stock' END,
                        NULL, NULL, NULL, a.site_id, 0, NULL, NULL, NULL,
                        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                        SUM(a.on_hand)::bigint, SUM(a.stock_cost)::bigint
                   FROM cstk a
                  GROUP BY GROUPING SETS ((), (a.site_id))",
            );
        } else if !shelves_only {
            b.push(
                " UNION ALL
                 SELECT CASE WHEN GROUPING(a.site_id) = 0 THEN 'store_stock' ELSE 'stock' END,
                        NULL, NULL, NULL, a.site_id, 0, NULL, NULL, NULL,
                        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                        SUM(a.on_hand)::bigint, SUM(a.stock_cost)::bigint
                   FROM astk a
                  GROUP BY GROUPING SETS ((), (a.site_id))",
            );
        } else {
            b.push(
                " UNION ALL
                 SELECT CASE WHEN GROUPING(x.site_id) = 0 THEN 'store_stock' ELSE 'stock' END,
                        NULL, NULL, NULL, x.site_id, 0, NULL, NULL, NULL,
                        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                        SUM(x.on_hand)::bigint,
                        SUM(ROUND(x.on_hand * COALESCE(ucost.unit_cost, 0)))::bigint
                   FROM stk x
                   LEFT JOIN article_cost ucost ON ucost.article_id = x.article_id
                  GROUP BY GROUPING SETS ((), (x.site_id))",
            );
        }
    }

    // A year of a large estate is a few million summary rows: give the one
    // statement room to hash them in memory instead of sorting on disk.
    // No JIT: compiling the plan costs more than these few-second reads gain.
    // The summaries are read from memory, not from a spinning disk: an index
    // range over a few weeks beats scanning the year. One statement sets all
    // of it. A long window shares the read between cores on both levels now:
    // the day summary earned two workers first, and a whole year off the
    // months hashes millions of rows — a few weeks, or anything the months
    // answer in one small slice, still runs on one.
    let mut tx = pool.begin().await?;
    let parallel = if (query.to - query.from).num_days() > 62 {
        ", set_config('max_parallel_workers_per_gather', '2', true)"
    } else {
        ""
    };
    // PostgreSQL may switch a frequently reused prepared statement to a
    // generic plan after five executions. Date-span selectivity varies, so
    // plan this read from its current binds; LOCAL resets when the transaction
    // commits and keeps the pool session's setting unchanged.
    sqlx::query(&format!(
        "SELECT set_config('work_mem', '192MB', true),
                set_config('jit', 'off', true),
                set_config('random_page_cost', '1.1', true),
                set_config('plan_cache_mode', 'force_custom_plan', true){parallel}"
    ))
    .execute(&mut *tx)
    .await?;

    // The reads the answer needs beside the statement are asked together —
    // but only once the transaction has let its connection go: under load a
    // request must never hold the pool hostage while waiting for the pool.
    let rows = b.build().fetch_all(&mut *tx).await?;
    tx.commit().await?;

    let whole_sales = filters.divisions.is_empty()
        && filters.tags.is_empty()
        && filters.suppliers.is_empty()
        && filters.colours.is_empty()
        && filters.sizes.is_empty()
        && filters.q.is_none();
    let stores_read = async {
        if head {
            sqlx::query(
                "SELECT id, code, name FROM site
                  WHERE kind = 'STORE' AND (cardinality($1::text[]) = 0 OR id = ANY($1))
                  ORDER BY code NULLS LAST, name",
            )
            .bind(&filters.stores)
            .fetch_all(pool)
            .await
        } else {
            Ok(Vec::new())
        }
    };
    let days_read = async {
        if head {
            sqlx::query_as::<_, (Option<NaiveDate>, Option<NaiveDate>)>(
                "SELECT (SELECT max(business_date) FROM sales_sku_day),
                        (SELECT min(business_date) FROM sales_sku_day)",
            )
            .fetch_one(pool)
            .await
        } else {
            Ok((None, None))
        }
    };
    let pending_read = async {
        if head {
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sales_rollup_dirty")
                .fetch_one(pool)
                .await
        } else {
            Ok(0)
        }
    };
    let stock_as_of_read = async {
        if with_stock && head {
            sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
                "SELECT refreshed_at FROM store_stock_refresh",
            )
            .fetch_optional(pool)
            .await
        } else {
            Ok::<_, sqlx::Error>(None)
        }
    };
    let receipts_read = async {
        if !whole_sales || !head {
            return Ok::<_, sqlx::Error>(Vec::new());
        }
        let mut windows = vec![(0_i32, filters.from, filters.to)];
        if let Some((cf, ct)) = filters.cmp {
            windows.push((1, cf, ct));
        }
        let mut counted = Vec::new();
        for (period, from, to) in windows {
            counted.push((
                period,
                sqlx::query(
                    "SELECT site_id, GROUPING(site_id) = 1 AS overall,
                            SUM(receipts)::bigint AS receipts,
                            SUM(voided_receipts)::bigint AS voided_receipts,
                            SUM(voided_minor)::bigint AS voided_minor
                       FROM sales_store_day
                      WHERE business_date BETWEEN $1 AND $2
                        AND (cardinality($3::text[]) = 0 OR site_id = ANY($3))
                      GROUP BY GROUPING SETS ((), (site_id))",
                )
                .bind(from)
                .bind(to)
                .bind(&filters.stores)
                .fetch_all(pool)
                .await?,
            ));
        }
        Ok(counted)
    };
    let (stores_read, days_read, pending_read, stock_as_of_read, receipts_read) = tokio::join!(
        stores_read,
        days_read,
        pending_read,
        stock_as_of_read,
        receipts_read
    );
    let stores: Vec<ExplorerStore> = stores_read?
        .iter()
        .map(|row| {
            Ok(ExplorerStore {
                site_id: row.try_get("id")?,
                code: row.try_get("code")?,
                name: row.try_get("name")?,
            })
        })
        .collect::<Result<_, AppError>>()?;
    let (latest_day, earliest_day): (Option<NaiveDate>, Option<NaiveDate>) = days_read?;
    let pending_days: i64 = pending_read?;
    let stock_as_of: Option<DateTime<Utc>> = stock_as_of_read?.flatten();
    let receipts = receipts_read?;

    let figures = |row: &sqlx::postgres::PgRow| -> Result<ExplorerFigures, AppError> {
        let get = |name: &str| -> Result<i64, AppError> {
            Ok(row.try_get::<Option<i64>, _>(name)?.unwrap_or(0))
        };
        let sold_qty = get("sold_qty")?;
        let returned_qty = get("returned_qty")?;
        let list_minor = get("list_minor")?;
        let charged_minor = get("charged_minor")?;
        let returns_minor = get("returns_minor")?;
        let sales_minor = charged_minor - returns_minor;
        let cost: Option<i64> = row.try_get("cost_minor")?;
        let uncosted_qty = get("uncosted_qty")?;
        let uncosted_minor = get("uncosted_minor")?;
        let stock: Option<i64> = row.try_get("on_hand")?;
        let stock_cost: Option<i64> = row.try_get("stock_cost")?;
        Ok(ExplorerFigures {
            articles: get("articles")?,
            qty: sold_qty - returned_qty,
            sold_qty,
            returned_qty,
            list_minor,
            charged_minor,
            returns_minor,
            sales_minor,
            discount_minor: list_minor - charged_minor,
            full_qty: get("full_qty")?,
            full_minor: get("full_minor")?,
            discounted_qty: get("discounted_qty")?,
            discounted_minor: get("discounted_minor")?,
            cost_minor: can_see_cost.then(|| cost.unwrap_or(0)),
            profit_minor: (can_see_cost && uncosted_qty < sold_qty)
                .then(|| sales_minor - uncosted_minor - cost.unwrap_or(0)),
            uncosted_qty,
            uncosted_minor,
            stock: with_stock.then(|| stock.unwrap_or(0)),
            stock_cost_minor: (with_stock && can_see_cost).then(|| stock_cost.unwrap_or(0)),
            receipts: None,
            voided_receipts: None,
            voided_minor: None,
        })
    };

    let mut page: Vec<(i64, ExplorerRow)> = Vec::new();
    let mut compare = std::collections::HashMap::<String, ExplorerFigures>::new();
    let mut cells = std::collections::HashMap::<String, Vec<ExplorerCell>>::new();
    let mut total = ExplorerFigures {
        stock: with_stock.then_some(0),
        stock_cost_minor: (with_stock && can_see_cost).then_some(0),
        cost_minor: can_see_cost.then_some(0),
        ..ExplorerFigures::default()
    };
    let mut total_compare: Option<ExplorerFigures> = None;
    let mut store_totals = std::collections::BTreeMap::<String, ExplorerFigures>::new();
    let mut store_stock = std::collections::HashMap::<String, (i64, i64)>::new();
    let mut stock_total: Option<(i64, i64)> = None;
    let mut rows_total = 0_i64;
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let period: i32 = row.try_get("period")?;
        match kind.as_str() {
            "row" => {
                rows_total = row.try_get::<Option<i64>, _>("rows_total")?.unwrap_or(0);
                page.push((
                    row.try_get::<Option<i64>, _>("rank")?.unwrap_or(0),
                    ExplorerRow {
                        key: row.try_get::<Option<String>, _>("key")?.unwrap_or_default(),
                        label: row.try_get::<Option<String>, _>("label")?.unwrap_or_default(),
                        detail: row.try_get("detail")?,
                        image_url: row.try_get("image_url")?,
                        figures: figures(row)?,
                        compare: None,
                        cells: Vec::new(),
                    },
                ));
            }
            "compare" => {
                let key: String = row.try_get::<Option<String>, _>("key")?.unwrap_or_default();
                compare.insert(key, figures(row)?);
            }
            "cell" => {
                let key: String = row.try_get::<Option<String>, _>("key")?.unwrap_or_default();
                let site_id: String =
                    row.try_get::<Option<String>, _>("site_id")?.unwrap_or_default();
                cells.entry(key).or_default().push(ExplorerCell {
                    site_id,
                    figures: figures(row)?,
                });
            }
            "total" => {
                let mut f = figures(row)?;
                if period == 0 {
                    f.stock = total.stock;
                    f.stock_cost_minor = total.stock_cost_minor;
                    total = f;
                } else {
                    f.stock = None;
                    f.stock_cost_minor = None;
                    total_compare = Some(f);
                }
            }
            "store_total" if period == 0 => {
                let site_id: String =
                    row.try_get::<Option<String>, _>("site_id")?.unwrap_or_default();
                store_totals.insert(site_id, figures(row)?);
            }
            "stock" => {
                stock_total = Some((
                    row.try_get::<Option<i64>, _>("on_hand")?.unwrap_or(0),
                    row.try_get::<Option<i64>, _>("stock_cost")?.unwrap_or(0),
                ));
            }
            "store_stock" => {
                let site_id: String =
                    row.try_get::<Option<String>, _>("site_id")?.unwrap_or_default();
                store_stock.insert(
                    site_id,
                    (
                        row.try_get::<Option<i64>, _>("on_hand")?.unwrap_or(0),
                        row.try_get::<Option<i64>, _>("stock_cost")?.unwrap_or(0),
                    ),
                );
            }
            _ => {}
        }
    }
    if let Some((on_hand, cost)) = stock_total {
        total.stock = Some(on_hand);
        total.stock_cost_minor = can_see_cost.then_some(cost);
    }
    if with_stock {
        for store in &stores {
            let (on_hand, cost) = store_stock.get(&store.site_id).copied().unwrap_or((0, 0));
            let entry = store_totals.entry(store.site_id.clone()).or_insert_with(|| {
                ExplorerFigures {
                    cost_minor: can_see_cost.then_some(0),
                    ..ExplorerFigures::default()
                }
            });
            entry.stock = Some(on_hand);
            entry.stock_cost_minor = can_see_cost.then_some(cost);
        }
    }
    // Receipts, from the store-day count (0934), when the question is about
    // whole sales: by period and store only.
    if whole_sales {
        for (period, counted) in &receipts {
            for row in counted {
                let receipts: Option<i64> = row.try_get("receipts")?;
                let voided: Option<i64> = row.try_get("voided_receipts")?;
                let voided_minor: Option<i64> = row.try_get("voided_minor")?;
                let target = if row.try_get::<bool, _>("overall")? {
                    if *period == 0 {
                        Some(&mut total)
                    } else {
                        total_compare.as_mut()
                    }
                } else if *period == 0 {
                    let site_id: Option<String> = row.try_get("site_id")?;
                    site_id.and_then(|site| store_totals.get_mut(&site))
                } else {
                    None
                };
                if let Some(figures) = target {
                    figures.receipts = Some(receipts.unwrap_or(0));
                    figures.voided_receipts = Some(voided.unwrap_or(0));
                    figures.voided_minor = Some(voided_minor.unwrap_or(0));
                }
            }
        }
        // A window with no sales at all still counts zero receipts.
        total.receipts.get_or_insert(0);
        total.voided_receipts.get_or_insert(0);
        total.voided_minor.get_or_insert(0);
    }

    page.sort_by_key(|(rank, _)| *rank);
    let rows: Vec<ExplorerRow> = page
        .into_iter()
        .map(|(_, mut row)| {
            row.compare = compare.remove(&row.key);
            row.cells = cells.remove(&row.key).unwrap_or_default();
            if group == ExplorerGroup::Store {
                if let Some(counted) = store_totals.get(&row.key) {
                    row.figures.receipts = counted.receipts;
                    row.figures.voided_receipts = counted.voided_receipts;
                    row.figures.voided_minor = counted.voided_minor;
                }
            }
            row
        })
        .collect();


    Ok(SalesExplorer {
        from: query.from,
        to: query.to,
        compare_from: cmp.map(|(f, _)| f),
        compare_to: cmp.map(|(_, t)| t),
        group: group.as_str().to_string(),
        sort: sort.to_string(),
        dir: if desc { "desc" } else { "asc" }.to_string(),
        stores,
        rows,
        rows_total,
        total,
        total_compare,
        store_totals: store_totals
            .into_iter()
            .map(|(site_id, figures)| ExplorerCell { site_id, figures })
            .collect(),
        can_see_cost,
        latest_day,
        earliest_day,
        pending_days,
        stock_as_of,
    })
}

/// Keep `store_stock_sku` current: rewrites what moved, when anything did.
pub async fn store_stock_refresh(pool: &PgPool) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar("SELECT store_stock_refresh()")
        .fetch_one(pool)
        .await?)
}

/// The choices the filters offer: stores, divisions, tags, suppliers,
/// colours and sizes that exist.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExplorerOption {
    pub code: String,
    pub label: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExplorerOptions {
    pub stores: Vec<ExplorerOption>,
    pub divisions: Vec<ExplorerOption>,
    pub tags: Vec<ExplorerOption>,
    pub suppliers: Vec<ExplorerOption>,
    pub colours: Vec<ExplorerOption>,
    pub sizes: Vec<ExplorerOption>,
    pub latest_day: Option<NaiveDate>,
    pub earliest_day: Option<NaiveDate>,
    pub can_see_cost: bool,
}

pub async fn sales_explorer_options(
    pool: &PgPool,
    can_see_cost: bool,
) -> Result<ExplorerOptions, AppError> {
    async fn options(pool: &PgPool, sql: &str) -> Result<Vec<ExplorerOption>, AppError> {
        Ok(sqlx::query_as::<_, (String, String)>(sql)
            .fetch_all(pool)
            .await?
            .into_iter()
            .map(|(code, label)| ExplorerOption { code, label })
            .collect())
    }
    let (latest_day, earliest_day): (Option<NaiveDate>, Option<NaiveDate>) = sqlx::query_as(
        "SELECT (SELECT max(business_date) FROM sales_sku_day),
                (SELECT min(business_date) FROM sales_sku_day)",
    )
    .fetch_one(pool)
    .await?;
    Ok(ExplorerOptions {
        stores: options(
            pool,
            "SELECT id, COALESCE(name, id) FROM site WHERE kind = 'STORE' ORDER BY code NULLS LAST, name",
        )
        .await?,
        divisions: options(
            pool,
            "SELECT code, label FROM division ORDER BY display_order NULLS LAST, label",
        )
        .await?,
        tags: options(pool, "SELECT code, label FROM tag ORDER BY display_order NULLS LAST, label")
            .await?,
        suppliers: options(
            pool,
            "SELECT DISTINCT ON (supplier_id) supplier_id,
                    COALESCE(supplier_name_snapshot, supplier_name, supplier_id)
               FROM purchase_order WHERE supplier_id IS NOT NULL
              ORDER BY supplier_id, created_at DESC",
        )
        .await?,
        colours: options(
            pool,
            "SELECT code, label FROM colour ORDER BY display_order NULLS LAST, label",
        )
        .await?,
        sizes: options(
            pool,
            "SELECT code::text, label FROM size_code ORDER BY display_order NULLS LAST, label",
        )
        .await?,
        latest_day,
        earliest_day,
        can_see_cost,
    })
}
