//! The Performa tabs: three reads, one window, no writes.
//!
//! These sit apart from the rest of the commercial surface because they answer
//! a different kind of question. Everything in `commercial.rs` asks what the
//! book SAYS — what a shop will be charged, which rules are live, what a
//! campaign is allowed to spend. These ask what the tills DID, which is only
//! knowable from the sale facts, and they are read-only by construction: not
//! one of them opens a transaction.
//!
//! The window is the same three parameters everywhere — `from`, `to`,
//! `site_id`, all optional — so a screen can carry one filter bar across three
//! tabs, and so a link to a period is a link to the same period in every tab.
//! `PerformanceWindow::resolve` owns the defaults and the refusals; the
//! handlers below only hand it the query string.

use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, PerformanceWindow},
};
use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

/// The filter bar, as it arrives.
///
/// Every field is optional and the defaults are applied further down rather
/// than here, so a screen that has not decided on a window yet still gets an
/// answer — the last thirty days, which is what a merchandiser means by "how is
/// it going".
#[derive(Debug, Deserialize)]
pub struct WindowQuery {
    #[serde(default)]
    pub from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub to: Option<DateTime<Utc>>,
    #[serde(default)]
    pub site_id: Option<String>,
}

impl WindowQuery {
    fn window(&self) -> Result<PerformanceWindow, AppError> {
        PerformanceWindow::resolve(self.from, self.to, self.site_id.as_deref())
    }
}

/// How much of what one campaign set out to shift has shifted.
///
/// `Path` beside `Query` because this is the one performance read that is about
/// a single campaign: sell-through needs the styles that campaign's offers name,
/// and there is no fleet-wide version of that question.
pub async fn campaign_sell_through(
    State(state): State<AppState>,
    axum::extract::Path(campaign_id): axum::extract::Path<String>,
    Query(query): Query<WindowQuery>,
) -> Result<Json<Value>, AppError> {
    let window = query.window()?;
    Ok(Json(
        infrastructure::campaign_sell_through(&state.db, &campaign_id, &window).await?,
    ))
}

/// What each campaign gave away and what came back through the tills.
pub async fn campaign_performance(
    State(state): State<AppState>,
    Query(query): Query<WindowQuery>,
) -> Result<Json<Value>, AppError> {
    let window = query.window()?;
    Ok(Json(
        infrastructure::campaign_performance(&state.db, &window).await?,
    ))
}

/// The same, per rule, and again per coupon code.
pub async fn rule_performance(
    State(state): State<AppState>,
    Query(query): Query<WindowQuery>,
) -> Result<Json<Value>, AppError> {
    let window = query.window()?;
    Ok(Json(
        infrastructure::rule_performance(&state.db, &window).await?,
    ))
}

/// One style: what its products sold for, at which price, and what is left.
///
/// The window fields are spelled out again rather than flattened in from
/// `WindowQuery`, because `Query` decodes with `serde_urlencoded` and a
/// flattened struct is one of the shapes that format cannot read — it would
/// compile and then fail on every request with a message about invalid type.
#[derive(Debug, Deserialize)]
pub struct PricelistQuery {
    /// Required. This report is about one style, and a fleet-wide version of it
    /// would be the whole sales ledger rather than a pricing question.
    pub article_code: String,
    #[serde(default)]
    pub from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub to: Option<DateTime<Utc>>,
    #[serde(default)]
    pub site_id: Option<String>,
}

pub async fn pricelist_performance(
    State(state): State<AppState>,
    Query(query): Query<PricelistQuery>,
) -> Result<Json<Value>, AppError> {
    let window = PerformanceWindow::resolve(query.from, query.to, query.site_id.as_deref())?;
    Ok(Json(
        infrastructure::pricelist_performance(&state.db, &query.article_code, &window).await?,
    ))
}
