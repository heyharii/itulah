//! What a shop has been charging for one product, and when it changed.
//!
//! The Pricelist answers "why is this shop charging 99?" — the cascade with the
//! losers in it, as of now. It cannot answer "why did it change last Tuesday?",
//! and that is the question somebody asks when a shelf edge and a customer's
//! memory disagree, or when a margin report moves and nobody knows what moved
//! it.
//!
//! The answer is already in the data and unreadable. Publications are versioned
//! and immutable — twenty-six books, each an authored statement about prices,
//! each with a name, a publisher and a window. Nothing deletes or amends them.
//! So the history exists; there has never been a way to ask it a question.
//!
//! # Why this replays the engine rather than reading the rows
//!
//! A list of every price row that ever mentioned a SKU is not a history. Most
//! of those rows were never in force: a company price published in March is
//! superseded by a shop price in April and comes back in May when the April
//! book expires, and which one won at any instant is decided by the engine —
//! newest publication first, then scope, then start date, and then a clearance
//! over the top of whichever survived. Writing a second opinion about that here
//! is the failure the estate has already had once, when a shop and the centre
//! ranked markdowns differently and quoted different prices for the same
//! shirt.
//!
//! So: collect every instant at which the answer *could* change, price a
//! one-line basket through [`pricing_engine::price_cart`] at each — the same
//! entry point a till uses — and emit a row only where the answer actually
//! moved.
//! What comes back is the sequence of prices this shop really charged, each
//! with the book that decided it and the person who published that book.
//!
//! # The cost, stated
//!
//! One price-book load per candidate instant, narrowed to the one SKU. That is
//! a handful of small queries for an ordinary product and grows with how often
//! somebody repriced it — which is the right shape: a product nobody has
//! touched costs nothing to explain.

use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use std::collections::BTreeSet;

/// One stretch of time over which a shop charged one price.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PricePeriod {
    /// When this price took over. The first period starts when the earliest
    /// book that mentions the product did.
    pub from: DateTime<Utc>,
    /// When it stopped. `None` is "still in force", which is the answer for the
    /// last period and only the last.
    pub until: Option<DateTime<Utc>>,
    pub unit_price_minor: i64,
    /// What moved it, against the period before: positive is dearer. `None` on
    /// the first period, which had nothing to move from — reported rather than
    /// rendered as a rise from nought.
    pub change_minor: Option<i64>,
    /// `COMPANY_PRICE`, `SITE_PRICE`, `MARKDOWN` — `PriceSource` as the engine
    /// spells it, so the browser reads the cascade in the vocabulary that
    /// decides it.
    pub source: String,
    /// Named when a markdown won, so the clearance behind a drop can be found.
    pub markdown_id: Option<String>,
    /// The book that decided this, and who put it out. "The price went up on
    /// the third" is a fact; "Andi published Ramadan Pricing v21 on the second"
    /// is an answer.
    pub publication_version: i64,
    pub publication_name: Option<String>,
    pub published_by: Option<String>,
    pub published_at: Option<DateTime<Utc>>,
}

/// Everything one shop has charged for one product.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PriceHistory {
    pub sku_code: String,
    pub site_id: String,
    pub channel: String,
    /// Oldest first. Reading down is reading forward, which is how somebody
    /// tracing a change reads it.
    pub periods: Vec<PricePeriod>,
    /// Instants examined. Reported because an empty history and an unpriced
    /// product are different answers, and because a reader is entitled to know
    /// how hard the question was asked.
    pub instants_examined: i64,
    /// True when no book has ever mentioned this product at this shop — which
    /// is not "it has always been free", it is "nobody has ever priced it".
    pub never_priced: bool,
}

/// Every instant at which this product's price could change at this shop.
///
/// A price changes when a book starts or ends, or when a markdown does. Nothing
/// else moves it: the cascade is a pure function of the books in force, and
/// books do not change between their own edges.
///
/// Taken from EVERY publication that mentions the product, not only the ones in
/// force now — a book that expired last month is exactly what a reader tracing
/// last month's price needs.
async fn candidate_instants(
    pool: &PgPool,
    sku_code: &str,
    site_id: &str,
    channel: &str,
) -> Result<Vec<DateTime<Utc>>, AppError> {
    let rows = sqlx::query(
        "SELECT p.effective_from AS moment
           FROM commercial_price_rule pr
           JOIN commercial_publication p ON p.id = pr.publication_id
           JOIN sku s ON s.id = pr.sku_id
          WHERE p.status = 'PUBLISHED' AND s.sku_code = $1 AND pr.channel = $2
            AND (pr.site_id IS NULL OR pr.site_id = $3)
            AND (pr.site_ids IS NULL OR $3 = ANY(pr.site_ids))
         UNION
         SELECT p.effective_to AS moment
           FROM commercial_price_rule pr
           JOIN commercial_publication p ON p.id = pr.publication_id
           JOIN sku s ON s.id = pr.sku_id
          WHERE p.status = 'PUBLISHED' AND s.sku_code = $1 AND pr.channel = $2
            AND p.effective_to IS NOT NULL
            AND (pr.site_id IS NULL OR pr.site_id = $3)
            AND (pr.site_ids IS NULL OR $3 = ANY(pr.site_ids))
         UNION
         SELECT m.effective_from AS moment
           FROM commercial_markdown m
           JOIN commercial_publication p ON p.id = m.publication_id
          WHERE p.status = 'PUBLISHED' AND m.sku_code = $1
            AND (m.site_id IS NULL OR m.site_id = $3)
            AND (m.site_ids IS NULL OR $3 = ANY(m.site_ids))
         UNION
         SELECT m.effective_to AS moment
           FROM commercial_markdown m
           JOIN commercial_publication p ON p.id = m.publication_id
          WHERE p.status = 'PUBLISHED' AND m.sku_code = $1
            AND m.effective_to IS NOT NULL
            AND (m.site_id IS NULL OR m.site_id = $3)
            AND (m.site_ids IS NULL OR $3 = ANY(m.site_ids))",
    )
    .bind(sku_code)
    .bind(channel)
    .bind(site_id)
    .fetch_all(pool)
    .await?;

    // A set, because a book and the markdown inside it usually start together
    // and asking the same instant twice produces a period of zero length.
    let mut moments: BTreeSet<DateTime<Utc>> = rows
        .iter()
        .filter_map(|row| row.try_get::<DateTime<Utc>, _>("moment").ok())
        .collect();
    // A book's `effective_to` is the instant it STOPS applying, so the answer
    // at that instant is already the next one — it is a boundary and belongs in
    // the set for exactly that reason. Nothing else is added: an instant the
    // data does not name is an instant at which nothing changed.
    let now = Utc::now();
    // Today, so a book that has expired since the last publication shows the
    // price falling back rather than the history ending at the expiry with the
    // old price still apparently in force.
    moments.insert(now);
    Ok(moments.into_iter().collect())
}

/// What this shop has charged for this product, and what changed it.
pub async fn price_history(
    pool: &PgPool,
    sku_code: &str,
    site_id: &str,
    channel: &str,
) -> Result<PriceHistory, AppError> {
    let moments = candidate_instants(pool, sku_code, site_id, channel).await?;
    let instants_examined = i64::try_from(moments.len()).unwrap_or(i64::MAX);

    let mut periods: Vec<PricePeriod> = Vec::new();
    // One read transaction for every instant, and the campaigns and tax rules
    // once for all of them: neither depends on the instant, and loading them
    // per instant made a long-lived product's history cost seven round trips
    // for every book that ever touched it.
    let mut tx = pool.begin().await?;
    let common = super::pricing::load_price_book_common(&mut tx).await?;
    for moment in &moments {
        // Narrowed to the one product: a history of one shirt has no business
        // reading forty thousand rows once per instant.
        // Resolved before the loader is called, so the transaction is borrowed
        // once rather than twice in one expression.
        let activated = super::pricing::activated_versions(&mut tx, site_id, *moment).await?;
        let pricing = super::pricing::load_site_price_book_with(
            &mut tx,
            site_id,
            channel,
            *moment,
            Some(&[sku_code.to_string()]),
            // What this shop actually had in service at that instant, not what
            // head office had decided — the same basis as the Pricing matrix.
            //
            // UI-001-07 requires the two to agree: "Klik store, article, cell,
            // SKU → navigasi dan angka konsisten pada konteks/version yang
            // sama." A history built on head office's books beside a matrix
            // built on the shop's would disagree about the same product on the
            // same screen, which is worse than either being wrong alone.
            &super::pricing::PriceBookScope::AsActivated(activated),
            &common,
        )
        .await?;

        let mut context = crate::reporting::pricing_context(site_id, channel, *moment);
        context.at = *moment;
        // Priced as a one-line basket, through the engine's own entry point,
        // rather than by asking the cascade for a base price.
        //
        // `resolve_price` answers with the price BOOK's entry and knows nothing
        // about clearances — and a clearance is what moves a shelf price most
        // often, so a history built on it would show a product at full price
        // through every sale it was ever in. `price_cart` runs the whole
        // settlement, markdowns included.
        //
        // Promotions cannot reach this either, and not by being filtered out:
        // `load_site_price_book` loads prices and markdowns and never the
        // rules, so the snapshot handed over here has none. What comes back is
        // the shelf price — which is what "what was this shop charging" means.
        // A basket discount is a property of a basket, not of a product.
        let priced = pricing_engine::price_cart(
            &pricing.snapshot,
            &context,
            &[pricing_engine::CartLine::new(sku_code.to_string(), 1)],
        );
        let Some(line) = priced
            .ok()
            .and_then(|result| result.lines.into_iter().next())
        else {
            // No price at this instant. Not an error — a product genuinely has
            // no price before the first book that names it, and saying so by
            // leaving a gap is more honest than inventing nought.
            continue;
        };

        let source = line.source.as_str().to_string();
        let unit_price_minor = line.unit_price.minor;
        let markdown_id = line.markdown_id.clone();
        let publication_version = line.publication_version;

        // A period ends where the next begins, so a moment that produces the
        // same answer as the one before it is not a change and does not earn a
        // row. Comparing the whole decision and not just the number: a price
        // that stayed at 199.000 while the reason moved from a company price to
        // a shop price IS a change, and the day it is queried is the day that
        // distinction matters.
        let same_as_before = periods.last().is_some_and(|last| {
            last.unit_price_minor == unit_price_minor
                && last.source == source
                && last.markdown_id == markdown_id
                && last.publication_version == publication_version
        });
        if same_as_before {
            continue;
        }

        let change_minor = periods
            .last()
            .map(|last| unit_price_minor - last.unit_price_minor);
        if let Some(last) = periods.last_mut() {
            last.until = Some(*moment);
        }
        periods.push(PricePeriod {
            from: *moment,
            until: None,
            unit_price_minor,
            change_minor,
            source,
            markdown_id,
            publication_version,
            publication_name: None,
            published_by: None,
            published_at: None,
        });
    }
    tx.commit().await?;

    // Who published each of those books, filled in once at the end rather than
    // per instant: the same version comes up repeatedly and the row does not
    // change between readings.
    let versions: Vec<i64> = periods
        .iter()
        .map(|period| period.publication_version)
        .collect();
    if !versions.is_empty() {
        let rows = sqlx::query(
            "SELECT version, name, published_by, published_at
               FROM commercial_publication
              WHERE version = ANY($1) AND status = 'PUBLISHED'",
        )
        .bind(&versions)
        .fetch_all(pool)
        .await?;
        for row in &rows {
            let version: i64 = row.get("version");
            let name: String = row.get("name");
            let published_by: Option<String> = row.get("published_by");
            let published_at: Option<DateTime<Utc>> = row.get("published_at");
            for period in periods
                .iter_mut()
                .filter(|period| period.publication_version == version)
            {
                period.publication_name = Some(name.clone());
                period.published_by = published_by.clone();
                period.published_at = published_at;
            }
        }
    }

    Ok(PriceHistory {
        sku_code: sku_code.to_string(),
        site_id: site_id.to_string(),
        channel: channel.to_string(),
        never_priced: periods.is_empty(),
        periods,
        instants_examined,
    })
}
