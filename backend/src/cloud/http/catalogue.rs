//! Three lists of what is on offer, across every published book.
//!
//! Thin by design — the whole of the thinking is the `DISTINCT ON` in
//! `postgres/catalogue.rs`, which mirrors how a shop resolves the same three
//! things.
//!
//! # Why these read the query string as PAIRS rather than into a struct
//!
//! Because the facets are multi-select. `?status=ACTIVE&status=PAUSED` is how a
//! panel with two boxes ticked spells itself, and a struct's deserializer keeps
//! the last value and drops the rest in silence — so the screen shows one
//! filter's worth of rows and blames the server. `GET /finance/money` and
//! `GET /finance/bills` read pairs for exactly this reason; `GET /employees`
//! uses a struct because nothing it takes repeats.
//!
//! The one thing a struct gives that pairs do not is `deny_unknown_fields`, and
//! it is worth having: a misspelled filter narrows nothing and looks like it
//! worked. So each handler declares the names it takes and
//! [`refuse_unknown_parameters`] turns anything else into a 400.

use super::{facet_values, limit_value, refuse_unknown_parameters, single_value};
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, CampaignPage, PromotionPage},
};
use axum::{
    extract::{Query, State},
    Json,
};
use serde_json::Value;

/// What every one of these lists takes, beside its own filters.
const PAGING: [&str; 5] = ["q", "sort", "dir", "cursor", "limit"];

/// Which promotions exist: searched, filtered, sorted and paged.
///
/// # Why this answers in an envelope rather than in an array
///
/// Because a list of rows cannot say how many rows there are, and because the
/// Promotions screen was doing the searching and the sorting in the browser
/// over everything the fleet declares. That works until the list is longer than
/// one fetch, and the way it stops working is a promotion quietly missing from
/// a search and a sort that only ordered the rows the browser happened to hold.
///
/// The shape is `GET /finance/money`'s, deliberately and not adapted — same
/// `rows`, same `next_cursor`, same `total`, same facet counts — so that one
/// hook in the browser draws all three Commercial lists.
///
/// # Query parameters
///
/// `q` searches the rule id, the promotion's name and its coupon code.
/// `status` and `campaign` filter, and each of them repeats or takes a comma
/// list. `sort` is one of `rule_id`, `name`, `status`, `priority`, `campaign`,
/// `book`, with `dir=desc`; anything else is the house order, by rule id.
/// `cursor` and `limit` page.
pub async fn commercial_rules(
    State(s): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<PromotionPage>, AppError> {
    refuse_unknown_parameters(&params, &[&PAGING[..], &["status", "campaign"]].concat())?;
    Ok(Json(
        infrastructure::commercial_rules(
            &s.db,
            infrastructure::PromotionScope {
                needle: single_value(&params, "q"),
                statuses: facet_values(&params, "status"),
                campaigns: facet_values(&params, "campaign"),
                sort: single_value(&params, "sort"),
                // `dir=desc` and nothing else. Absent, empty and anything
                // unrecognised all mean ascending, which is the direction a
                // list is in before anybody touches it.
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                // Clamped where it is enforced, not here: one spelling of how
                // much of the offer book one request may see.
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
}

/// Which coupons exist. A bare list, and the module note in
/// `postgres/catalogue.rs` says why this one keeps its shape.
pub async fn commercial_coupons(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::commercial_coupons(&s.db).await?))
}

/// Which campaigns exist: searched, filtered, sorted and paged.
///
/// The envelope and the reasoning are [`commercial_rules`]'s.
///
/// # Query parameters
///
/// `q` searches the campaign id and its name. `status` filters, repeating or as
/// a comma list. `sort` is one of `campaign_id`, `name`, `status`, `starts`,
/// `ends`, `budget`, `book`, with `dir=desc`; anything else is the house order,
/// by campaign id. `cursor` and `limit` page.
pub async fn commercial_campaigns(
    State(s): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<CampaignPage>, AppError> {
    refuse_unknown_parameters(&params, &[&PAGING[..], &["status"]].concat())?;
    Ok(Json(
        infrastructure::commercial_campaigns(
            &s.db,
            infrastructure::CampaignScope {
                needle: single_value(&params, "q"),
                statuses: facet_values(&params, "status"),
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
}
