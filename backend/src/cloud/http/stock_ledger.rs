//! What stock is worth, which layers a posting took, and whether the two
//! ledgers agree.
//!
//! Reads only. Nothing here consumes basis: consumption belongs to whichever
//! document caused it — a sale, a count, a supplier credit note — inside that
//! document's own transaction, so the fact and its cost commit together. An
//! endpoint that let somebody consume basis by hand would be a second writer,
//! and a fact with two writers has no authority.
//!
//! # Why these live under `/api/v1/finance`
//!
//! `required_role` in `domain::auth` makes every GET a cashier read, which is
//! right for stock and quite wrong for cost. What goods cost, what the margin
//! is, and what the company owes are not things a till operator has any
//! business reading — and the whole `/finance` surface is already Supervisor to
//! read and Admin to write for exactly that reason. Filing these there gets the
//! right answer without widening the role ladder.

use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, ArticleValuation, CostLayerView, SiteValuation,
        StockLedgerExplanation, StockLedgerIntegrity,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct ValuationQuery {
    /// One article, by the client's own code. Absent means every article
    /// holding stock.
    pub article: Option<String>,
    /// One location. Present switches the answer from the company queue to a
    /// per-place position — see `by_site` below for what that figure is.
    pub site: Option<String>,
    pub limit: Option<i64>,
}

/// Stock at cost, per article or per place.
///
/// One endpoint rather than two because they answer the same question — "what
/// is the stock worth" — and a screen that switched endpoints when somebody
/// picked a location would have two loading states for one question.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Valuation {
    /// The authority: the company's FIFO queue, article by article.
    pub articles: Vec<ArticleValuation>,
    /// Where the goods physically are, valued at the article's average rate.
    /// A presentation figure and not what the inventory account is reconciled
    /// against; the field is populated only when a location was asked for.
    pub by_site: Vec<SiteValuation>,
    pub total_quantity: i64,
    pub total_value_minor: i64,
}

pub async fn stock_ledger_valuation(
    State(state): State<AppState>,
    Query(query): Query<ValuationQuery>,
) -> Result<Json<Valuation>, AppError> {
    let articles = infrastructure::stock_ledger_valuation(
        &state.db,
        query.article.as_deref(),
        query.limit.unwrap_or(100),
    )
    .await?;
    let by_site = match query.site.as_deref() {
        Some(site) => {
            infrastructure::stock_ledger_valuation_by_site(
                &state.db,
                Some(site),
                query.limit.unwrap_or(500),
            )
            .await?
        }
        None => Vec::new(),
    };
    Ok(Json(Valuation {
        total_quantity: articles.iter().map(|a| a.quantity).sum(),
        total_value_minor: articles.iter().map(|a| a.value_minor).sum(),
        articles,
        by_site,
    }))
}

/// The FIFO queue for one article, oldest first.
///
/// The layers, not a total. "140 pieces worth 18.2m" cannot tell anybody what
/// the next sale will cost; "40 at 125k then 100 at 130k" can, and it is the
/// same information a period close has to carry forward.
pub async fn cost_layer_queue(
    State(state): State<AppState>,
    Path(article): Path<String>,
) -> Result<Json<Vec<CostLayerView>>, AppError> {
    Ok(Json(
        infrastructure::cost_layer_queue(&state.db, &article).await?,
    ))
}

/// Why one journal entry cost what it did: which layers it took, in what order,
/// and at what rate.
pub async fn stock_ledger_explain(
    State(state): State<AppState>,
    Path(entry_id): Path<Uuid>,
) -> Result<Json<StockLedgerExplanation>, AppError> {
    Ok(Json(
        infrastructure::stock_ledger_explain(&state.db, entry_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct IntegrityQuery {
    pub as_of: Option<NaiveDate>,
}

/// The stock ledger against the inventory control account.
///
/// A difference here is the one thing about stock valuation that nothing else
/// can see: every individual entry is right, every journal balances, and the
/// two ledgers are describing the same goods with different numbers.
pub async fn stock_ledger_integrity(
    State(state): State<AppState>,
    Query(query): Query<IntegrityQuery>,
) -> Result<Json<StockLedgerIntegrity>, AppError> {
    let as_of = query.as_of.unwrap_or_else(|| Utc::now().date_naive());
    Ok(Json(
        infrastructure::stock_ledger_integrity(&state.db, as_of).await?,
    ))
}

/// This lane's routes, added in one line by `router()`.
pub fn lane_i_routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/finance/valuation", get(stock_ledger_valuation))
        // Above `{article}/layers` by convention only — the router ranks a
        // static segment over a dynamic one itself.
        .route(
            "/api/v1/finance/valuation/{article}/layers",
            get(cost_layer_queue),
        )
        .route(
            "/api/v1/finance/stock-ledger/integrity",
            get(stock_ledger_integrity),
        )
        .route(
            "/api/v1/finance/stock-ledger/postings/{entry_id}",
            get(stock_ledger_explain),
        )
}
