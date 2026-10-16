//! The master product, read whole for the first time.
//!
//! `article` and `sku` have existed since `0001` and been minted by setup
//! sessions since `0022`, but nothing has ever listed them. Every screen that
//! needed to know what the company sells reached for the supplier catalogue
//! instead — which is what somebody OFFERS us, not what we sell — or for a
//! price book, which only names the articles somebody happened to price. This
//! module is the missing read.
//!
//! # What this module may and may not do
//!
//! It edits attributes: a name, a division, tags, a picture, which colours the
//! colour digits stand for. It never mints an identity. Article codes and SKU
//! codes come from the centre through an article setup session and nowhere
//! else (`tagging.rs`), because thirty shops each coining their own code for
//! one shirt is thirty products in every report and no later cleanup recovers
//! what the codes were supposed to mean.
//!
//! # Why the search takes six shapes of input
//!
//! One box, and whatever is in front of the person using it goes into it: the
//! article code from a spreadsheet, the SKU off a picking list, the name, the
//! QR under the barcode, an EPC read off a tag by a handheld, or the code the
//! supplier prints on the carton. Making somebody first classify what they are
//! holding, and then choose the matching field, is a step that exists only
//! because the server could not be bothered to try all six.

use super::{begin_idempotent, complete_idempotent, FacetCount, NullablePatch};
use crate::cloud::{
    application::AppError,
    domain::{decode_epc, normalize_tag_codes, uom::ItemUnit},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Postgres, Row, Transaction};
use std::collections::HashMap;
use uuid::Uuid;

/// One of an article's ten colour slots, resolved through the master.
///
/// `colour_digit` is article-scoped and `colour_code` is not: digit 3 is this
/// article's third colourway, while `NAVY` is navy everywhere in the company.
/// Both are on the wire because both are needed — the digit is what the SKU
/// string carries, the code is what a filter can address.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleColourway {
    pub colour_digit: String,
    pub colour_code: String,
    pub label: String,
    pub hex_code: Option<String>,
}

/// An article as a list shows it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleRow {
    pub article_code: String,
    pub name: String,
    pub active: bool,
    pub division_code: Option<String>,
    pub image_url: Option<String>,
    /// What the article is described as (0968): from the supplier item it was
    /// first bought as, unless head office changed it during setup or since.
    #[serde(default)]
    pub description: Option<String>,
    /// Tag codes, not labels. A screen renders them through the catalogue
    /// vocabulary; sending labels would put a word in a filter that changes
    /// the moment somebody edits it.
    pub tags: Vec<String>,
    /// At most ten, ordered by digit. The cap is the SKU string's, not a
    /// policy: colour is one character of eleven.
    pub colours: Vec<ArticleColourway>,
    /// Distinct across this article's SKUs, in the order the business reads
    /// sizes rather than alphabetically — `size_code.display_order` puts XS
    /// before S before M, which sorting on the code very nearly does and gets
    /// wrong the moment a size is inserted between two others.
    pub size_codes: Vec<String>,
    pub sku_count: i64,
    /// Pieces on hand across every place, as the article's sheet counts them
    /// per SKU (`skus_for`). Filled on the list (owner, 2026-10-15: "ada stock
    /// kali ya, tapi hapus sku di table"); absent where a read does not count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub stock_qty: Option<i64>,
    /// The spread of the SETUP prices, which is the floor under a SKU rather
    /// than what a shop is charging today. Commercial publication overrides it
    /// per site, channel and period, so a list showing these is showing what
    /// the article was minted at — deliberately, because it is the one price
    /// that exists for every SKU whether or not a price book mentions it.
    pub base_price_min_minor: Option<i64>,
    pub base_price_max_minor: Option<i64>,
    pub currency: Option<String>,
    /// What this article's stock is counted in (ERPNext `stock_uom`): PCS
    /// for clothing, GRAM or CM for goods kept by weight or length.
    pub stock_unit_code: String,
    /// What a new order line starts in (ERPNext `purchase_uom`).
    pub purchase_unit_code: Option<String>,
    /// What a sale starts in (ERPNext `sales_uom`).
    pub sales_unit_code: Option<String>,
    /// What a PATCH must quote in `If-Match`.
    pub version: i32,
    pub created_at: DateTime<Utc>,
}

/// What the whole search contains, beside the page of it being shown.
///
/// Counted over everything `q` and `active` match, NOT over the facets already
/// chosen — the same rule `search_supplier_items` follows and for the same
/// reason. Picking a division must not make the other divisions read zero: a
/// facet list is how somebody sees what else is there, and one that only
/// describes what they have already picked cannot answer "what if I looked at
/// Kids instead".
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleFacets {
    pub divisions: Vec<FacetCount>,
    pub tags: Vec<FacetCount>,
    /// Sizes and colours count ARTICLES having at least one SKU that way, not
    /// SKUs. That is what the matching filter narrows to, and a facet counting
    /// something the filter does not is a number that shrinks to nothing when
    /// you click it.
    pub sizes: Vec<FacetCount>,
    pub colours: Vec<FacetCount>,
}

/// One page of the master, and enough about the rest to describe it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticlePage {
    pub items: Vec<ArticleRow>,
    /// Opaque. Pass it back for the next page; absent means this was the last.
    /// Not an offset: articles are minted and retired while somebody scrolls,
    /// and an offset skips or repeats rows when they are.
    pub next_cursor: Option<String>,
    /// Every article the search matches, not just this page.
    pub total: i64,
    pub facets: ArticleFacets,
}

/// One SKU of an article, with its colour resolved through the master.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleSku {
    pub sku_id: Uuid,
    pub sku_code: String,
    /// Null on the SKUs that predate `0022`, which carried a free-text colour
    /// and no digit at all. Shown as unknown rather than guessed: those rows
    /// are real stock and inventing a colourway for them would file goods
    /// under a colour nobody chose.
    pub colour_digit: Option<String>,
    pub colour_code: Option<String>,
    pub colour_label: Option<String>,
    pub size_code: Option<String>,
    pub size_label: Option<String>,
    pub base_price_minor: Option<i64>,
    pub currency: Option<String>,
    pub qr_payload: Option<String>,
    pub active: bool,
    /// Pieces of this SKU held right now, in every place we hold stock — the
    /// DC, the shops and what is on the road. Whole-company on hand, not one
    /// pool's: the article sheet answers "how many do we have", and the pools
    /// answer "where". Zero for a SKU nothing has been received for.
    #[serde(default)]
    pub stock_qty: i64,
}

/// Who sells us this article, and for how much.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleSupplierItem {
    pub supplier_item_id: Uuid,
    pub supplier_id: Uuid,
    pub supplier_name: String,
    /// The supplier's own string for the goods, from `supplier_item_code`. It
    /// is never an identity — two suppliers use the same string for different
    /// things and one supplier changes theirs between shipments — but it is
    /// what is printed on the carton, so it is what somebody has in front of
    /// them when they come here looking.
    pub supplier_article_code: String,
    pub unit_price_minor: Option<i64>,
    pub currency: Option<String>,
}

/// One article, whole.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleDetail {
    /// A named field rather than `#[serde(flatten)]`, for the reason
    /// `JournalEntryDetail` gives: ts-rs does not render a flattened struct
    /// faithfully, and a wire type the generator cannot describe is exactly
    /// the hand-mirroring this contract exists to avoid.
    pub article: ArticleRow,
    pub skus: Vec<ArticleSku>,
    /// Which setup session first gave this article an identity, so a reader
    /// can get from a product back to the delivery that prompted it.
    pub created_by_session_id: Option<Uuid>,
    pub supplier_items: Vec<ArticleSupplierItem>,
    /// The other units this article is dealt in, each with how many of its
    /// stock unit one is (ERPNext's UOM Conversion Detail): CARTON 24.
    pub units: Vec<ItemUnit>,
}

/// Which way the master is read.
///
/// **Newest is ordered by `created_at`, not by the code.** The first draft of
/// this ordered by `article_code DESC`, on the reasoning that codes come from
/// `article_code_seq` so a higher code is a later article. That is true of
/// every code this server has ever minted and false of the catalogue actually
/// in the database: seeded and legacy articles carry hand-written codes —
/// `ART-0001`, `ART-TSHIRT` — and every one of them sorts above `00000001`,
/// so "newest" put the oldest rows in the company at the top. Caught by
/// reading the answer rather than the reasoning.
///
/// `created_at` is the thing actually being asked about, and the code rides
/// along only to break ties, which is what keeps the keyset exact.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ArticleOrder {
    /// Lowest code first: the master in the order it was built up. The order
    /// this endpoint answered in until the owner asked for the other one.
    Oldest,
    /// Newest first, and the default since the owner asked for it across every
    /// list in the console.
    ///
    /// The argument for `Oldest` was that a catalogue somebody is searching
    /// should not reshuffle itself. True, and outweighed: a master of five
    /// hundred rows is not read from the top, it is searched — while the rows
    /// somebody wants to SEE without searching are always the ones just
    /// minted. Defaulting to oldest meant every article a delivery created
    /// landed on page eleven, which is where they were found during testing.
    #[default]
    Newest,
}

impl ArticleOrder {
    /// The parameter as it arrives, or `None` for a word this server does not
    /// answer to — the caller is told rather than quietly given the default,
    /// because a sort that silently does nothing is worse than a refusal.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "oldest" => Some(Self::Oldest),
            "newest" => Some(Self::Newest),
            _ => None,
        }
    }
}

/// Where the previous page stopped.
///
/// Reading oldest-first the sort is `article_code`, which is unique, so the
/// cursor needs nothing else to be exact. A keyset on a non-unique key loses
/// or repeats the rows that tie, which is why `SourcingCursor` next door
/// carries four fields — it sorts on a name.
///
/// Reading newest-first the sort is `created_at`, which is NOT unique — two
/// articles minted by one setup session share a timestamp to the microsecond —
/// so the code comes along as the tie-break and both travel in the cursor.
///
/// `created_at` is optional so a cursor issued before this existed still
/// decodes; it is only ever read in the order that wrote it.
#[derive(Serialize, Deserialize)]
struct ArticleCursor {
    article_code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    created_at: Option<DateTime<Utc>>,
}

impl ArticleCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// What a caller is asking the master for.
#[derive(Clone, Debug, Default)]
pub struct ArticleScope {
    pub needle: Option<String>,
    pub division_codes: Vec<String>,
    pub tag_codes: Vec<String>,
    /// Both of these filter SKUs while the list is articles, so they mean
    /// "articles having at least one SKU in this size/colour". They narrow
    /// which rows appear; they do not hide the other variants inside a row,
    /// because an article is one product however many ways it was made.
    pub size_codes: Vec<String>,
    pub colour_codes: Vec<String>,
    pub active: Option<bool>,
    /// `Some(false)`: sold out — nothing on hand anywhere (owner, 2026-10-15,
    /// the Sold out tab). `Some(true)`: something on hand. Selling out never
    /// retires an article; this only narrows the list.
    pub in_stock: Option<bool>,
    pub order: ArticleOrder,
    pub cursor: Option<String>,
    pub limit: i64,
}

/// The six things `q` is tried against, written once.
///
/// Kept as one string constant rather than written into both the page query
/// and the facet query, because the facets are only honest if they count
/// exactly what the page matches. Two copies of this clause would agree on
/// every ordinary day and part company the moment somebody adds a seventh
/// thing to search.
const MATCH_CLAUSE: &str = "
    ($3::bool IS NULL OR a.active = $3)
    AND ($1::text IS NULL
         OR a.article_code ILIKE '%' || $1 || '%'
         OR a.name ILIKE '%' || $1 || '%'
         OR EXISTS (SELECT 1 FROM sku s
                     WHERE s.article_id = a.id
                       AND (s.sku_code ILIKE '%' || $1 || '%'
                            OR s.qr_payload ILIKE '%' || $1 || '%'
                            -- The SKU an EPC decoded to. Matched exactly: a
                            -- decoded SKU is a fact, not a guess, and a
                            -- substring match on it would pull in siblings.
                            OR ($2::text IS NOT NULL AND s.sku_code = $2)))
         OR EXISTS (SELECT 1 FROM supplier_item si
                     WHERE si.internal_article_code = a.article_code
                       AND si.supplier_item_code ILIKE '%' || $1 || '%'))
";

/// Whether an article has anything on hand, for `in_stock`. The places are
/// the ones `stock_by_article` and the sheet sum; `$S` is the parameter's
/// number in the statement it is put into.
const IN_STOCK_CLAUSE: &str = "
    ($S::bool IS NULL OR $S = (COALESCE((
        SELECT sum(h.q) FROM (
            SELECT pr.quantity::bigint AS q
              FROM inventory_projection pr
              JOIN inventory_place pl ON pl.id = pr.place_id
              JOIN operational_pool op ON op.id = pl.pool_id
              JOIN inventory_subject su ON su.id = pr.subject_id
              JOIN sku k ON k.id = su.sku_id
             WHERE k.article_id = a.id
               AND pl.kind = 'OPERATIONAL' AND pl.state = 'NORMAL'
               AND op.site_id NOT IN (
                   SELECT c.site_id FROM sync_origin_credential c
                     JOIN sync_applied_watermark w
                       ON w.origin_id = c.origin_id AND w.generation = c.active_generation
                    WHERE c.inventory_enabled)
            UNION ALL
            SELECT fp.quantity::bigint
              FROM edge_inventory_fact_position fp
              JOIN sku k ON k.sku_code = fp.sku_code
             WHERE k.article_id = a.id AND fp.place_id LIKE '%:on_hand'
               AND fp.origin_id IN (
                   SELECT c.origin_id FROM sync_origin_credential c
                     JOIN sync_applied_watermark w
                       ON w.origin_id = c.origin_id AND w.generation = c.active_generation
                    WHERE c.inventory_enabled)
        ) h), 0) > 0))
";

fn in_stock_clause(param: u8) -> String {
    IN_STOCK_CLAUSE.replace("$S", &format!("${param}"))
}

fn article_row_from(row: &PgRow) -> Result<ArticleRow, AppError> {
    Ok(ArticleRow {
        article_code: row.try_get("article_code")?,
        name: row.try_get("name")?,
        active: row.try_get("active")?,
        division_code: row.try_get("division_code")?,
        image_url: row.try_get("image_url")?,
        description: row.try_get("description")?,
        tags: row.try_get("tags")?,
        colours: serde_json::from_value(row.try_get("colours")?)?,
        size_codes: row.try_get("size_codes")?,
        sku_count: row.try_get("sku_count")?,
        stock_qty: None,
        base_price_min_minor: row.try_get("base_price_min_minor")?,
        base_price_max_minor: row.try_get("base_price_max_minor")?,
        currency: row.try_get("currency")?,
        stock_unit_code: row.try_get("stock_unit_code")?,
        purchase_unit_code: row.try_get("purchase_unit_code")?,
        sales_unit_code: row.try_get("sales_unit_code")?,
        version: row.try_get("version")?,
        created_at: row.try_get("created_at")?,
    })
}

/// Everything the article row needs that does not live on `article`.
///
/// Written once and interpolated into both the list and the detail query, so a
/// row cannot mean one thing in a list and another in a sheet — which is the
/// bug that makes somebody open a record to check a figure and see a different
/// one.
const ROW_COLUMNS: &str = "
    a.id, a.article_code, a.name, a.active, a.division_code, a.image_url,
    a.description, a.version, a.created_at, a.created_by_session_id,
    a.stock_unit_code, a.purchase_unit_code, a.sales_unit_code,
    COALESCE((SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                FROM article_tag t WHERE t.article_id = a.id), '{}') AS tags,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'colour_digit', ac.colour_digit,
                         'colour_code',  ac.colour_code,
                         'label',        c.label,
                         'hex_code',     c.hex_code)
                     ORDER BY ac.colour_digit)
                FROM article_colour ac
                JOIN colour c ON c.code = ac.colour_code
               WHERE ac.article_id = a.id), '[]'::jsonb) AS colours,
    COALESCE((SELECT array_agg(z.size_code ORDER BY z.display_order, z.size_code)
                FROM (SELECT DISTINCT s.size_code, sc.display_order
                        FROM sku s
                        JOIN size_code sc ON sc.code = s.size_code
                       WHERE s.article_id = a.id) z), '{}') AS size_codes,
    stats.sku_count, stats.base_price_min_minor, stats.base_price_max_minor,
    stats.currency
";

/// The per-article figures, as one LATERAL rather than four correlated
/// subqueries so the planner walks `sku` once per article instead of four
/// times.
const ROW_STATS_JOIN: &str = "
    LEFT JOIN LATERAL (
        SELECT count(*) AS sku_count,
               min(s.base_price_minor) AS base_price_min_minor,
               max(s.base_price_minor) AS base_price_max_minor,
               -- One currency per article in practice; `min` picks one rather
               -- than returning a set, because a range quoted in two
               -- currencies is not a range.
               min(s.currency) AS currency
          FROM sku s WHERE s.article_id = a.id
    ) stats ON true
";

/// The master, a page at a time, with what the rest of it contains.
///
/// `q` is tried against six things at once — article code, SKU code, name, QR
/// payload, a decoded EPC, and the supplier's own code — because those are the
/// six identifiers that exist for one garment and the person searching has
/// exactly one of them in front of them. An EPC that does not decode is not an
/// error: it only means the text somebody pasted was not an EPC, and it is
/// still tried as everything else.
pub async fn search_articles(pool: &PgPool, scope: ArticleScope) -> Result<ArticlePage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    // A handheld reads EPCs, not SKUs. Decoding here rather than asking the
    // browser to do it keeps the one implementation of the EPC codec on the
    // side that owns it — `encode_epc_range` writes them, this reads them, and
    // a second decoder in TypeScript would drift the day the header byte does.
    let epc_sku = needle
        .as_deref()
        .and_then(|value| decode_epc(value).ok())
        .map(|(sku, _serial)| sku);
    let divisions = (!scope.division_codes.is_empty()).then_some(scope.division_codes);
    let tags = (!scope.tag_codes.is_empty()).then_some(scope.tag_codes);
    let sizes = (!scope.size_codes.is_empty()).then_some(scope.size_codes);
    let colours = (!scope.colour_codes.is_empty()).then_some(scope.colour_codes);
    let cursor = scope
        .cursor
        .as_deref()
        .map(ArticleCursor::decode)
        .transpose()?;
    let limit = scope.limit.clamp(1, 200);

    let sql = format!(
        "SELECT {ROW_COLUMNS}
           FROM article a
           {ROW_STATS_JOIN}
          WHERE {MATCH_CLAUSE}
            AND {stock}
            AND ($4::text[] IS NULL OR a.division_code = ANY($4))
            AND ($5::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM article_tag t
                     WHERE t.article_id = a.id AND t.tag_code = ANY($5)))
            AND ($6::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM sku s
                     WHERE s.article_id = a.id AND s.size_code::text = ANY($6)))
            AND ($7::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM sku s
                      JOIN article_colour ac
                        ON ac.article_id = s.article_id
                       AND ac.colour_digit = s.colour_digit
                     WHERE s.article_id = a.id AND ac.colour_code = ANY($7)))
            {keyset}
          ORDER BY {order}
          LIMIT {limit_param}",
        // The comparison has to agree with the order or the second page
        // repeats the first. Newest compares the pair, because the timestamp
        // alone ties and the code alone is not the sort.
        keyset = match scope.order {
            ArticleOrder::Oldest => "AND ($8::text IS NULL OR a.article_code > $8)",
            ArticleOrder::Newest =>
                "AND ($8::text IS NULL
                      OR (a.created_at, a.article_code) < ($9::timestamptz, $8))",
        },
        order = match scope.order {
            ArticleOrder::Oldest => "a.article_code ASC",
            ArticleOrder::Newest => "a.created_at DESC, a.article_code DESC",
        },
        limit_param = match scope.order {
            ArticleOrder::Oldest => "$9",
            ArticleOrder::Newest => "$10",
        },
        // After the limit, whichever number that took.
        stock = in_stock_clause(match scope.order {
            ArticleOrder::Oldest => 10,
            ArticleOrder::Newest => 11,
        }),
    );
    let mut query = sqlx::query(&sql)
        .bind(&needle)
        .bind(&epc_sku)
        .bind(scope.active)
        .bind(&divisions)
        .bind(&tags)
        .bind(&sizes)
        .bind(&colours)
        .bind(cursor.as_ref().map(|c| c.article_code.clone()));
    // Bound only where the SQL names it: Postgres refuses a statement handed
    // more parameters than it mentions.
    if scope.order == ArticleOrder::Newest {
        query = query.bind(cursor.as_ref().and_then(|c| c.created_at));
    }
    let rows = query
        .bind(limit)
        .bind(scope.in_stock)
        .fetch_all(pool)
        .await?;

    let next_cursor = if (rows.len() as i64) < limit {
        None
    } else {
        match rows.last() {
            Some(row) => Some(
                ArticleCursor {
                    article_code: row.try_get("article_code")?,
                    created_at: match scope.order {
                        ArticleOrder::Oldest => None,
                        ArticleOrder::Newest => Some(row.try_get("created_at")?),
                    },
                }
                .encode()?,
            ),
            None => None,
        }
    };
    let mut items = rows
        .iter()
        .map(article_row_from)
        .collect::<Result<Vec<_>, _>>()?;
    let ids = rows
        .iter()
        .map(|row| row.try_get::<Uuid, _>("id"))
        .collect::<Result<Vec<_>, _>>()?;
    let stock = stock_by_article(pool, &ids).await?;
    for (item, id) in items.iter_mut().zip(&ids) {
        item.stock_qty = Some(stock.get(id).copied().unwrap_or(0));
    }

    let (total, facets) =
        article_facets(
            pool,
            needle.as_deref(),
            epc_sku.as_deref(),
            scope.active,
            scope.in_stock,
        )
        .await?;
    Ok(ArticlePage {
        items,
        next_cursor,
        total,
        facets,
    })
}

/// What the whole search contains, by division, tag, size and colour.
///
/// One round trip for all four: a screen cannot draw its filter column before
/// it has them, so splitting them would only buy three more waits.
async fn article_facets(
    pool: &PgPool,
    needle: Option<&str>,
    epc_sku: Option<&str>,
    active: Option<bool>,
    in_stock: Option<bool>,
) -> Result<(i64, ArticleFacets), AppError> {
    let stock = in_stock_clause(4);
    let sql = format!(
        "WITH base AS (
             SELECT a.id, a.division_code FROM article a
              WHERE {MATCH_CLAUSE} AND {stock}
         )
         SELECT
             (SELECT count(*) FROM base) AS total,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY count DESC, value)
                         FROM (SELECT COALESCE(division_code, 'Unclassified') AS value,
                                      count(*) AS count
                                 FROM base GROUP BY 1) d), '[]'::jsonb) AS divisions,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY count DESC, value)
                         FROM (SELECT t.tag_code AS value, count(*) AS count
                                 FROM base b
                                 JOIN article_tag t ON t.article_id = b.id
                                GROUP BY 1) g), '[]'::jsonb) AS tags,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY count DESC, value)
                         -- Pairs first, then counted: `count(DISTINCT …)` sorts
                         -- every SKU of the book inside each group, which at
                         -- 600 000 SKUs was most of this query.
                         FROM (SELECT value, count(*) AS count
                                 FROM (SELECT DISTINCT s.size_code::text AS value, b.id
                                         FROM base b
                                         JOIN sku s ON s.article_id = b.id
                                        WHERE s.size_code IS NOT NULL) p
                                GROUP BY 1) z), '[]'::jsonb) AS sizes,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY count DESC, value)
                         -- Read off the colourways, each kept only when a SKU
                         -- stands behind it. A colour is named once per article
                         -- (article_colour_colour_unique), so a row is one
                         -- article — the count the SKU join used to reach by
                         -- de-duplicating every SKU.
                         FROM (SELECT ac.colour_code AS value, count(*) AS count
                                 FROM base b
                                 JOIN article_colour ac ON ac.article_id = b.id
                                WHERE EXISTS (SELECT 1 FROM sku s
                                               WHERE s.article_id = ac.article_id
                                                 AND s.colour_digit = ac.colour_digit)
                                GROUP BY 1) k), '[]'::jsonb) AS colours"
    );
    let row = sqlx::query(&sql)
        .bind(needle)
        .bind(epc_sku)
        .bind(active)
        .bind(in_stock)
        .fetch_one(pool)
        .await?;
    Ok((
        row.try_get("total")?,
        ArticleFacets {
            divisions: serde_json::from_value(row.try_get("divisions")?)?,
            tags: serde_json::from_value(row.try_get("tags")?)?,
            sizes: serde_json::from_value(row.try_get("sizes")?)?,
            colours: serde_json::from_value(row.try_get("colours")?)?,
        },
    ))
}

/// One article and everything hanging off it.
/// Each SKU's pieces on hand, everywhere.
///
/// Read the way the shops' stock is read for the sales breakdowns: a site the
/// centre owns answers from the maintained balance (`inventory_projection`),
/// and a site an edge node owns from the positions that node has synced — the
/// two never both, or a shelf would be counted twice. Only places in the
/// NORMAL state count: a piece sitting in a MISSING place is not on hand.
async fn with_stock(
    connection: &mut sqlx::PgConnection,
    article_id: Uuid,
    mut skus: Vec<ArticleSku>,
) -> Result<Vec<ArticleSku>, AppError> {
    if skus.is_empty() {
        return Ok(skus);
    }
    let held: HashMap<String, i64> = sqlx::query(
        "WITH edge_owned AS (
             SELECT c.origin_id, c.site_id
               FROM sync_origin_credential c
               JOIN sync_applied_watermark w
                 ON w.origin_id = c.origin_id AND w.generation = c.active_generation
              WHERE c.inventory_enabled
         ),
         held AS (
             SELECT k.sku_code, pr.quantity::bigint AS quantity
               FROM inventory_projection pr
               JOIN inventory_place pl ON pl.id = pr.place_id
               JOIN operational_pool op ON op.id = pl.pool_id
               JOIN inventory_subject su ON su.id = pr.subject_id
               JOIN sku k ON k.id = su.sku_id
              WHERE k.article_id = $1
                AND pl.kind = 'OPERATIONAL' AND pl.state = 'NORMAL'
                AND op.site_id NOT IN (SELECT site_id FROM edge_owned)
             UNION ALL
             SELECT fp.sku_code, fp.quantity::bigint
               FROM edge_inventory_fact_position fp
               JOIN edge_owned e ON e.origin_id = fp.origin_id
               JOIN sku k ON k.sku_code = fp.sku_code
              WHERE k.article_id = $1 AND fp.place_id LIKE '%:on_hand'
         )
         SELECT sku_code, sum(quantity)::bigint AS on_hand FROM held GROUP BY sku_code",
    )
    .bind(article_id)
    .fetch_all(&mut *connection)
    .await?
    .into_iter()
    .map(|row| Ok((row.try_get("sku_code")?, row.try_get("on_hand")?)))
    .collect::<Result<_, AppError>>()?;
    for sku in &mut skus {
        sku.stock_qty = held.get(&sku.sku_code).copied().unwrap_or(0);
    }
    Ok(skus)
}

/// Pieces on hand per article, for one page of the list. The same places the
/// article's sheet sums per SKU (`skus_for`): the cloud's own operational
/// pools, and each inventory server's on-hand positions for the sites it owns.
async fn stock_by_article(pool: &PgPool, ids: &[Uuid]) -> Result<HashMap<Uuid, i64>, AppError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    sqlx::query(
        "WITH edge_owned AS (
             SELECT c.origin_id, c.site_id
               FROM sync_origin_credential c
               JOIN sync_applied_watermark w
                 ON w.origin_id = c.origin_id AND w.generation = c.active_generation
              WHERE c.inventory_enabled
         ),
         held AS (
             SELECT k.article_id, pr.quantity::bigint AS quantity
               FROM inventory_projection pr
               JOIN inventory_place pl ON pl.id = pr.place_id
               JOIN operational_pool op ON op.id = pl.pool_id
               JOIN inventory_subject su ON su.id = pr.subject_id
               JOIN sku k ON k.id = su.sku_id
              WHERE k.article_id = ANY($1)
                AND pl.kind = 'OPERATIONAL' AND pl.state = 'NORMAL'
                AND op.site_id NOT IN (SELECT site_id FROM edge_owned)
             UNION ALL
             SELECT k.article_id, fp.quantity::bigint
               FROM edge_inventory_fact_position fp
               JOIN edge_owned e ON e.origin_id = fp.origin_id
               JOIN sku k ON k.sku_code = fp.sku_code
              WHERE k.article_id = ANY($1) AND fp.place_id LIKE '%:on_hand'
         )
         SELECT article_id, sum(quantity)::bigint AS on_hand FROM held GROUP BY article_id",
    )
    .bind(ids)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| Ok((row.try_get("article_id")?, row.try_get("on_hand")?)))
    .collect()
}

pub async fn article_detail(pool: &PgPool, article_code: &str) -> Result<ArticleDetail, AppError> {
    let mut connection = pool.acquire().await?;
    read_article_detail(&mut connection, article_code).await
}

/// The detail read, against a connection rather than the pool.
///
/// Taken this way so a PATCH can read its own answer back INSIDE the
/// transaction that wrote it. Reading afterwards through the pool would let
/// another writer land between the two, and the editor would be shown a
/// version of the record that is not the one their edit produced.
async fn read_article_detail(
    connection: &mut sqlx::PgConnection,
    article_code: &str,
) -> Result<ArticleDetail, AppError> {
    let sql =
        format!("SELECT {ROW_COLUMNS} FROM article a {ROW_STATS_JOIN} WHERE a.article_code = $1");
    let row = sqlx::query(&sql)
        .bind(article_code.trim())
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| AppError::NotFound("Article".to_owned()))?;
    let article_id: Uuid = row.try_get("id")?;
    let created_by_session_id: Option<Uuid> = row.try_get("created_by_session_id")?;
    let article = article_row_from(&row)?;

    // The colour is joined through `article_colour` rather than read off the
    // SKU, because the SKU only carries the digit. A SKU minted before 0022
    // has neither, and comes back with all three colour fields null — the
    // honest answer for a row that never recorded one.
    let skus = sqlx::query(
        "SELECT s.id AS sku_id, s.sku_code, s.colour_digit, ac.colour_code,
                c.label AS colour_label, s.size_code, sc.label AS size_label,
                s.base_price_minor, s.currency, s.qr_payload, s.active
           FROM sku s
           LEFT JOIN article_colour ac
                  ON ac.article_id = s.article_id AND ac.colour_digit = s.colour_digit
           LEFT JOIN colour c ON c.code = ac.colour_code
           LEFT JOIN size_code sc ON sc.code = s.size_code
          WHERE s.article_id = $1
          ORDER BY s.sku_code",
    )
    .bind(article_id)
    .fetch_all(&mut *connection)
    .await?
    .into_iter()
    .map(|row| {
        Ok(ArticleSku {
            sku_id: row.try_get("sku_id")?,
            sku_code: row.try_get("sku_code")?,
            colour_digit: row.try_get("colour_digit")?,
            colour_code: row.try_get("colour_code")?,
            colour_label: row.try_get("colour_label")?,
            size_code: row.try_get("size_code")?,
            size_label: row.try_get("size_label")?,
            base_price_minor: row.try_get("base_price_minor")?,
            currency: row.try_get("currency")?,
            qr_payload: row.try_get("qr_payload")?,
            active: row.try_get("active")?,
            stock_qty: 0,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let skus = with_stock(&mut *connection, article_id, skus).await?;

    let supplier_items = sqlx::query(
        "SELECT si.supplier_item_id, si.supplier_id, sp.name AS supplier_name,
                si.supplier_item_code, si.unit_price_minor, si.currency
           FROM supplier_item si
           JOIN supplier sp ON sp.supplier_id = si.supplier_id
          WHERE si.internal_article_code = $1
          ORDER BY sp.name, si.supplier_item_code",
    )
    .bind(&article.article_code)
    .fetch_all(&mut *connection)
    .await?
    .into_iter()
    .map(|row| {
        Ok(ArticleSupplierItem {
            supplier_item_id: row.try_get("supplier_item_id")?,
            supplier_id: row.try_get("supplier_id")?,
            supplier_name: row.try_get("supplier_name")?,
            supplier_article_code: row.try_get("supplier_item_code")?,
            unit_price_minor: row.try_get("unit_price_minor")?,
            currency: row.try_get("currency")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    let units = sqlx::query(
        "SELECT unit_code, trim_scale(factor)::text AS factor
           FROM article_unit WHERE article_id = $1 ORDER BY factor, unit_code",
    )
    .bind(article_id)
    .fetch_all(&mut *connection)
    .await?
    .into_iter()
    .map(|row| {
        Ok(ItemUnit {
            unit_code: row.try_get("unit_code")?,
            factor: row.try_get("factor")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    Ok(ArticleDetail {
        article,
        skus,
        created_by_session_id,
        supplier_items,
        units,
    })
}

/// Which colour a digit stands for on this article.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleColourwayInput {
    pub colour_digit: String,
    pub colour_code: String,
}

/// What an Articles screen may change about an article.
///
/// Notice what is not here: `article_code` and every `sku_code`. They are
/// minted by the centre through a setup session and are the one thing a node
/// must never be able to edit — a code that can be corrected is a code that
/// means something different before and after the correction, and every
/// document that quoted it is now wrong.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateArticleRequest {
    #[serde(default)]
    pub name: Option<String>,
    /// Absent leaves it; `null` clears it back to unclassified, which is a
    /// real state something may legitimately be returned to.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub division_code: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub image_url: NullablePatch<String>,
    /// Absent leaves it; `null` or blank clears it (0968).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub description: NullablePatch<String>,
    /// Absent leaves tags alone; present REPLACES them. An empty list is
    /// therefore "remove every tag", which is a thing somebody may want to
    /// say — and is why this is not merged into the existing set.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub active: Option<bool>,
    /// Absent leaves the colourways alone; present REPLACES the mapping.
    #[serde(default)]
    pub colours: Option<Vec<ArticleColourwayInput>>,
    /// A whole-number unit. Refused once the article has stock, as ERPNext
    /// refuses a stock UOM change after transactions: every quantity already
    /// counted would silently change meaning.
    #[serde(default)]
    pub stock_unit_code: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub purchase_unit_code: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub sales_unit_code: NullablePatch<String>,
    /// Absent leaves them; present REPLACES the article's own units. A row
    /// with no factor takes the global one, as ERPNext prefills it.
    #[serde(default)]
    pub units: Option<Vec<ArticleUnitInput>>,
}

/// One of an article's own units, as a form sends it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleUnitInput {
    pub unit_code: String,
    /// Stock units in one. Absent or blank takes the global conversion.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub factor: Option<String>,
}

fn map_article_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23503") => AppError::Validation(
                "that division, tag or colour is not in the vocabulary".to_owned(),
            ),
            Some("23505") => AppError::Conflict(database.message().to_owned()),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

/// Edit an article's attributes.
///
/// Guarded twice over, because the two guards answer different questions.
/// `Idempotency-Key` answers "did this request already happen" — a browser
/// that retried a slow PATCH must not apply it twice. `If-Match` answers "is
/// the version I edited still the current one" — two people editing one
/// article in two tabs must not both succeed, with the second silently
/// discarding the first's work.
pub async fn update_article(
    pool: &PgPool,
    article_code: &str,
    expected_version: i32,
    request: UpdateArticleRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<ArticleDetail, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let article_code = article_code.trim().to_owned();
    let changes_name = request.name.is_some();
    let changes_division = !matches!(request.division_code, NullablePatch::Missing);
    let changes_image = !matches!(request.image_url, NullablePatch::Missing);
    let changes_description = !matches!(request.description, NullablePatch::Missing);
    let changes_active = request.active.is_some();
    let changes_purchase_unit = !matches!(request.purchase_unit_code, NullablePatch::Missing);
    let changes_sales_unit = !matches!(request.sales_unit_code, NullablePatch::Missing);
    if !(changes_name
        || changes_division
        || changes_image
        || changes_description
        || changes_active
        || request.tags.is_some()
        || request.colours.is_some()
        || request.stock_unit_code.is_some()
        || changes_purchase_unit
        || changes_sales_unit
        || request.units.is_some())
    {
        return Err(AppError::Validation(
            "Article update must contain at least one field".into(),
        ));
    }
    let name = match request.name.as_deref().map(str::trim) {
        Some("") => {
            return Err(AppError::Validation(
                "an article needs a name a human can read on a picking list".into(),
            ));
        }
        other => other.map(str::to_owned),
    };
    let division_code = match &request.division_code {
        NullablePatch::Value(value) => Some(value.trim().to_uppercase()).filter(|v| !v.is_empty()),
        NullablePatch::Missing | NullablePatch::Null => None,
    };
    let image_url = match &request.image_url {
        NullablePatch::Value(value) => Some(value.trim().to_owned()).filter(|v| !v.is_empty()),
        NullablePatch::Missing | NullablePatch::Null => None,
    };
    let description = match &request.description {
        NullablePatch::Value(value) => Some(value.trim().to_owned()).filter(|v| !v.is_empty()),
        NullablePatch::Missing | NullablePatch::Null => None,
    };
    let tags = request
        .tags
        .map(normalize_tag_codes)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let colours = request.colours.map(validate_colourways).transpose()?;

    let mut transaction = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut transaction, idempotency_key, "article.update", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let updated = sqlx::query(
        "UPDATE article SET
             name          = CASE WHEN $3 THEN $4 ELSE name END,
             division_code = CASE WHEN $5 THEN $6 ELSE division_code END,
             image_url     = CASE WHEN $7 THEN $8 ELSE image_url END,
             active        = CASE WHEN $9 THEN $10 ELSE active END,
             description   = CASE WHEN $12 THEN $13 ELSE description END,
             version = version + 1, updated_by = $11, updated_at = now()
         WHERE article_code = $1 AND version = $2
         RETURNING id",
    )
    .bind(&article_code)
    .bind(expected_version)
    .bind(changes_name)
    .bind(&name)
    .bind(changes_division)
    .bind(&division_code)
    .bind(changes_image)
    .bind(&image_url)
    .bind(changes_active)
    .bind(request.active)
    .bind(actor.trim())
    .bind(changes_description)
    .bind(&description)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_article_write_error)?;
    let Some(row) = updated else {
        return Err(stale_article_error(&mut transaction, &article_code, expected_version).await);
    };
    let article_id: Uuid = row.try_get("id")?;

    if let Some(tags) = tags.as_deref() {
        replace_article_tags(&mut transaction, article_id, tags).await?;
    }
    if let Some(colours) = colours.as_deref() {
        replace_article_colourways(&mut transaction, article_id, &article_code, colours).await?;
    }
    if request.stock_unit_code.is_some()
        || changes_purchase_unit
        || changes_sales_unit
        || request.units.is_some()
    {
        update_article_units(
            &mut transaction,
            article_id,
            request.stock_unit_code.as_deref(),
            &request.purchase_unit_code,
            &request.sales_unit_code,
            request.units.as_deref(),
        )
        .await?;
    }
    // Read back through the same query the list and the sheet use, so what the
    // editor sees after saving is what everybody else will see.
    let detail = read_article_detail(&mut transaction, &article_code).await?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&detail)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(detail)
}

/// Everything that can be decided about a colourway list without asking the
/// database, decided before the transaction opens.
fn validate_colourways(
    colours: Vec<ArticleColourwayInput>,
) -> Result<Vec<ArticleColourwayInput>, AppError> {
    // Ten is not a soft limit. Colour is one character of an 11-digit SKU, so
    // an eleventh colourway cannot be expressed at all — there is no eleventh
    // value of one digit.
    if colours.len() > 10 {
        return Err(AppError::Validation(format!(
            "an article has ten colour digits and this names {}; \
             colour is one character of the SKU, so there is no eleventh",
            colours.len()
        )));
    }
    let mut cleaned: Vec<ArticleColourwayInput> = Vec::with_capacity(colours.len());
    for colour in colours {
        let digit = colour.colour_digit.trim().to_owned();
        if digit.len() != 1 || !digit.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::Validation(format!(
                "colour digit {digit:?} is not one digit 0-9; it is one character of the SKU"
            )));
        }
        let code = colour.colour_code.trim().to_uppercase();
        if code.is_empty() {
            return Err(AppError::Validation(format!(
                "colour digit {digit} names no colour; colours are picked from the master, not typed"
            )));
        }
        if cleaned.iter().any(|other| other.colour_digit == digit) {
            return Err(AppError::Validation(format!(
                "colour digit {digit} is listed twice"
            )));
        }
        if cleaned.iter().any(|other| other.colour_code == code) {
            return Err(AppError::Validation(format!(
                "colour {code} is used under two digits on one article; \
                 that is two SKUs no picker can tell apart"
            )));
        }
        cleaned.push(ArticleColourwayInput {
            colour_digit: digit,
            colour_code: code,
        });
    }
    Ok(cleaned)
}

fn unit_code_of(value: &str) -> Option<String> {
    Some(value.trim().to_uppercase()).filter(|code| !code.is_empty())
}

/// The article's units, ERPNext's way: a stock unit, default purchase and
/// sales units, and its own list of other units with a factor each.
async fn update_article_units(
    transaction: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
    stock_unit_code: Option<&str>,
    purchase_unit_code: &NullablePatch<String>,
    sales_unit_code: &NullablePatch<String>,
    units: Option<&[ArticleUnitInput]>,
) -> Result<(), AppError> {
    let current: String = sqlx::query_scalar("SELECT stock_unit_code FROM article WHERE id = $1")
        .bind(article_id)
        .fetch_one(&mut **transaction)
        .await?;
    let stock_unit = match stock_unit_code.and_then(unit_code_of) {
        Some(code) if code != current => {
            let whole: Option<bool> =
                sqlx::query_scalar("SELECT whole_number FROM unit_of_measure WHERE code = $1")
                    .bind(&code)
                    .fetch_optional(&mut **transaction)
                    .await?;
            match whole {
                None => {
                    return Err(AppError::Validation(format!(
                        "{code} is not in the units master"
                    )))
                }
                Some(false) => {
                    return Err(AppError::Validation(format!(
                        "{code} is not counted in whole numbers, and stock is; \
                         keep stock in its smallest unit (GRAM, CM, ML) and buy in {code}"
                    )))
                }
                Some(true) => {}
            }
            let stocked: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM inventory_subject s
                                  JOIN sku ON sku.id = s.sku_id
                                 WHERE sku.article_id = $1)",
            )
            .bind(article_id)
            .fetch_one(&mut **transaction)
            .await?;
            if stocked {
                return Err(AppError::Validation(format!(
                    "this article already has stock counted in {current}; \
                     its stock unit cannot change under it"
                )));
            }
            sqlx::query("UPDATE article SET stock_unit_code = $2 WHERE id = $1")
                .bind(article_id)
                .bind(&code)
                .execute(&mut **transaction)
                .await?;
            code
        }
        _ => current,
    };

    if let Some(units) = units {
        sqlx::query("DELETE FROM article_unit WHERE article_id = $1")
            .bind(article_id)
            .execute(&mut **transaction)
            .await?;
        for unit in units {
            let Some(code) = unit_code_of(&unit.unit_code) else {
                continue;
            };
            if code == stock_unit {
                continue;
            }
            let typed = unit
                .factor
                .as_deref()
                .map(|text| text.trim().replace(',', "."))
                .filter(|text| !text.is_empty());
            let factor: rust_decimal::Decimal = match typed {
                Some(text) => text.parse().map_err(|_| {
                    AppError::Validation(format!("{text:?} is not a number of {stock_unit}"))
                })?,
                None => sqlx::query_scalar::<_, Option<rust_decimal::Decimal>>(
                    "SELECT round(unit_factor($1, $2), 4)",
                )
                .bind(&code)
                .bind(&stock_unit)
                .fetch_one(&mut **transaction)
                .await?
                .ok_or_else(|| {
                    AppError::Validation(format!(
                        "{code} has no global conversion to {stock_unit}; say how many {stock_unit} one {code} is"
                    ))
                })?,
            };
            if factor <= rust_decimal::Decimal::ZERO || factor.normalize().scale() > 4 {
                return Err(AppError::Validation(format!(
                    "one {code} must be a positive number of {stock_unit}, at most four decimals"
                )));
            }
            sqlx::query(
                "INSERT INTO article_unit (article_id, unit_code, factor) VALUES ($1, $2, $3)
                 ON CONFLICT (article_id, unit_code) DO UPDATE SET factor = EXCLUDED.factor",
            )
            .bind(article_id)
            .bind(&code)
            .bind(factor)
            .execute(&mut **transaction)
            .await
            .map_err(|_| AppError::Validation(format!("{code} is not in the units master")))?;
        }
    }

    // A default unit must be one this article can actually be said in.
    for (column, patch) in [
        ("purchase_unit_code", purchase_unit_code),
        ("sales_unit_code", sales_unit_code),
    ] {
        let code = match patch {
            NullablePatch::Missing => continue,
            NullablePatch::Null => None,
            NullablePatch::Value(value) => unit_code_of(value),
        };
        if let Some(code) = &code {
            let known: Option<rust_decimal::Decimal> = sqlx::query_scalar(
                "SELECT article_unit_factor(article_code, $2) FROM article WHERE id = $1",
            )
            .bind(article_id)
            .bind(code)
            .fetch_one(&mut **transaction)
            .await?;
            if known.is_none() {
                return Err(AppError::Validation(format!(
                    "{code} does not convert to {stock_unit} for this article; add it to its units first"
                )));
            }
        }
        sqlx::query(&format!("UPDATE article SET {column} = $2 WHERE id = $1"))
            .bind(article_id)
            .bind(&code)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

async fn replace_article_tags(
    transaction: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
    tags: &[String],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM article_tag WHERE article_id = $1")
        .bind(article_id)
        .execute(&mut **transaction)
        .await?;
    if tags.is_empty() {
        return Ok(());
    }
    // Named rather than left to the foreign key, for the same reason the
    // supplier catalogue names them: a tag that silently disappears is a
    // filter that silently misses rows, and "insert or update violates
    // foreign key constraint" tells nobody which word was wrong.
    let known: Vec<String> = sqlx::query_scalar("SELECT code FROM tag WHERE code = ANY($1)")
        .bind(tags)
        .fetch_all(&mut **transaction)
        .await?;
    let unknown: Vec<&str> = tags
        .iter()
        .filter(|tag| !known.contains(tag))
        .map(String::as_str)
        .collect();
    if !unknown.is_empty() {
        return Err(AppError::Validation(format!(
            "unknown tag codes: {}",
            unknown.join(", ")
        )));
    }
    sqlx::query(
        "INSERT INTO article_tag (article_id, tag_code)
         SELECT $1, code FROM unnest($2::text[]) AS code",
    )
    .bind(article_id)
    .bind(tags)
    .execute(&mut **transaction)
    .await
    .map_err(map_article_write_error)?;
    Ok(())
}

/// Point the article's colour digits at colours, and refuse the two ways of
/// doing that which quietly rewrite goods already on a shelf.
///
/// A digit with SKUs minted against it is not a mapping any more; it is the
/// meaning of every tag printed for those SKUs and every EPC encoded from
/// them. Repointing it renames merchandise that is already in a shop, and
/// nothing downstream would notice — the SKU string does not change, so no
/// count, no label and no receipt would look any different. Removing such a
/// digit is the same failure with the rename left out.
async fn replace_article_colourways(
    transaction: &mut Transaction<'_, Postgres>,
    article_id: Uuid,
    article_code: &str,
    colours: &[ArticleColourwayInput],
) -> Result<(), AppError> {
    let existing = sqlx::query(
        "SELECT ac.colour_digit, ac.colour_code,
                EXISTS (SELECT 1 FROM sku s
                         WHERE s.article_id = ac.article_id
                           AND s.colour_digit = ac.colour_digit) AS minted
           FROM article_colour ac
          WHERE ac.article_id = $1
          ORDER BY ac.colour_digit",
    )
    .bind(article_id)
    .fetch_all(&mut **transaction)
    .await?;

    let mut pinned: Vec<(String, String)> = Vec::new();
    for row in &existing {
        let digit: String = row.try_get("colour_digit")?;
        let code: String = row.try_get("colour_code")?;
        if row.try_get::<bool, _>("minted")? {
            pinned.push((digit, code));
        }
    }
    for (digit, code) in &pinned {
        match colours
            .iter()
            .find(|colour| &colour.colour_digit == digit)
            .map(|colour| &colour.colour_code)
        {
            Some(wanted) if wanted == code => {}
            Some(wanted) => {
                return Err(AppError::Validation(format!(
                    "colour digit {digit} of article {article_code} already has SKUs minted as \
                     {code} and cannot be repointed to {wanted}: the goods are tagged, printed \
                     and on a shelf, and their SKU codes would not change. Give the new colour \
                     a free digit instead."
                )));
            }
            None => {
                return Err(AppError::Validation(format!(
                    "colour digit {digit} of article {article_code} has SKUs minted against it \
                     and cannot be removed; retire the SKUs instead."
                )));
            }
        }
    }

    let unknown: Vec<String> = {
        let wanted: Vec<String> = colours
            .iter()
            .map(|colour| colour.colour_code.clone())
            .collect();
        let known: Vec<String> =
            sqlx::query_scalar("SELECT code FROM colour WHERE code = ANY($1) AND active")
                .bind(&wanted)
                .fetch_all(&mut **transaction)
                .await?;
        wanted
            .into_iter()
            .filter(|code| !known.contains(code))
            // A pinned colour keeps its digit even if the master has since
            // retired it: the shirts are still that colour. Only colours being
            // newly mapped have to still be on offer.
            .filter(|code| !pinned.iter().any(|(_, pinned_code)| pinned_code == code))
            .collect()
    };
    if !unknown.is_empty() {
        return Err(AppError::Validation(format!(
            "these colours are not in the master, or have been retired: {}",
            unknown.join(", ")
        )));
    }

    // The unpinned rows go first, so a mapping that swaps two digits does not
    // trip `article_colour_colour_unique` halfway through. The pinned ones are
    // left exactly where they are — they were proved identical above.
    let keep: Vec<String> = pinned.iter().map(|(digit, _)| digit.clone()).collect();
    sqlx::query(
        "DELETE FROM article_colour
          WHERE article_id = $1 AND colour_digit <> ALL($2::text[])",
    )
    .bind(article_id)
    .bind(&keep)
    .execute(&mut **transaction)
    .await
    .map_err(map_article_write_error)?;

    for colour in colours {
        if keep.contains(&colour.colour_digit) {
            continue;
        }
        sqlx::query(
            "INSERT INTO article_colour (article_id, colour_digit, colour_code)
             VALUES ($1, $2, $3)",
        )
        .bind(article_id)
        .bind(&colour.colour_digit)
        .bind(&colour.colour_code)
        .execute(&mut **transaction)
        .await
        .map_err(map_article_write_error)?;
    }
    Ok(())
}

async fn stale_article_error(
    transaction: &mut Transaction<'_, Postgres>,
    article_code: &str,
    expected_version: i32,
) -> AppError {
    match sqlx::query_scalar::<_, i32>("SELECT version FROM article WHERE article_code = $1")
        .bind(article_code)
        .fetch_optional(&mut **transaction)
        .await
    {
        Ok(Some(actual)) => AppError::Conflict(format!(
            "Article version is {actual}, not expected version {expected_version}"
        )),
        Ok(None) => AppError::NotFound("Article".to_owned()),
        Err(error) => AppError::Database(error),
    }
}
