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
use chrono::NaiveDate;
use serde_json::Value;

/// What every one of these lists takes, beside its own filters.
const PAGING: [&str; 5] = ["q", "sort", "dir", "cursor", "limit"];

/// The filters `GET /commercial/rules` takes.
const RULE_FILTERS: [&str; 7] = [
    "status",
    "campaign",
    "phase",
    "used_min",
    "used_max",
    "stores_min",
    "stores_max",
];

/// The filters `GET /commercial/campaigns` takes.
const CAMPAIGN_FILTERS: [&str; 10] = [
    "status",
    "phase",
    "objective",
    "offers_min",
    "offers_max",
    "stores_min",
    "stores_max",
    "ends_from",
    "ends_to",
    "ends",
];

/// `ends=open` keeps the open-ended campaigns, `ends=set` the ones with an end.
/// Anything else is refused rather than read as no filter — see
/// [`whole_value`].
fn ends_value(params: &[(String, String)]) -> Result<Option<bool>, AppError> {
    match single_value(params, "ends").as_deref() {
        None => Ok(None),
        Some("open") => Ok(Some(true)),
        Some("set") => Ok(Some(false)),
        Some(other) => Err(AppError::Validation(format!(
            "ends {other:?} is not open or set"
        ))),
    }
}

/// A whole-number bound, parsed rather than ignored.
///
/// `limit_value`'s reasoning: a caller that sent `used_max=none` believes it
/// narrowed the list, and answering with every row looks like the server
/// working.
fn whole_value(params: &[(String, String)], key: &str) -> Result<Option<i64>, AppError> {
    match single_value(params, key) {
        Some(raw) => raw
            .parse::<i64>()
            .map(Some)
            .map_err(|_| AppError::Validation(format!("{key} {raw:?} is not a whole number"))),
        None => Ok(None),
    }
}

/// A calendar day, `YYYY-MM-DD`, parsed rather than ignored.
fn day_value(params: &[(String, String)], key: &str) -> Result<Option<NaiveDate>, AppError> {
    match single_value(params, key) {
        Some(raw) => raw
            .parse::<NaiveDate>()
            .map(Some)
            .map_err(|_| AppError::Validation(format!("{key} {raw:?} is not a YYYY-MM-DD day"))),
        None => Ok(None),
    }
}

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
/// `status`, `campaign` and `phase` filter, and each of them repeats or takes a
/// comma list; `phase` is `ACTIVE`, `PAUSED`, `SCHEDULED` or `ENDED`, read at
/// the business clock. `used_min`/`used_max` bound how many times it has been
/// used and `stores_min`/`stores_max` how many shops carry its book, both
/// inclusive. `sort` is one of `rule_id`, `name`, `status`, `priority`,
/// `campaign`, `book`, `usage`, `stores`, `starts`, `ends`, with `dir=desc`;
/// anything else is the house order, by rule id. `cursor` and `limit` page.
pub async fn commercial_rules(
    State(s): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<PromotionPage>, AppError> {
    refuse_unknown_parameters(&params, &[&PAGING[..], &RULE_FILTERS[..]].concat())?;
    Ok(Json(
        infrastructure::commercial_rules(
            &s.db,
            infrastructure::PromotionScope {
                needle: single_value(&params, "q"),
                statuses: facet_values(&params, "status"),
                campaigns: facet_values(&params, "campaign"),
                phases: facet_values(&params, "phase"),
                // The business clock, so a promotion ends on the day the rest
                // of the business thinks it is.
                now: s.clock.now(),
                used_min: whole_value(&params, "used_min")?,
                used_max: whole_value(&params, "used_max")?,
                stores_min: whole_value(&params, "stores_min")?,
                stores_max: whole_value(&params, "stores_max")?,
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
/// `q` searches the campaign id and its name. `status`, `phase` and
/// `objective` filter, repeating or as a comma list: `phase` is a status code
/// read against the dates at the business clock, `objective` an objective code
/// or `none` / `stated`. `offers_min`/`offers_max` and `stores_min`/`stores_max`
/// are inclusive bounds; `ends_from`/`ends_to` bound the Jakarta day the
/// window ends (`YYYY-MM-DD`, inclusive), and `ends` is `open` or `set`.
/// `sort` is one of `campaign_id`, `name`, `status`, `starts`, `ends`,
/// `budget`, `budget_used`, `offers`, `stores`, `book`, with `dir=desc`;
/// anything else is the house order, by campaign id. `cursor` and `limit` page.
pub async fn commercial_campaigns(
    State(s): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<CampaignPage>, AppError> {
    refuse_unknown_parameters(&params, &[&PAGING[..], &CAMPAIGN_FILTERS[..]].concat())?;
    Ok(Json(
        infrastructure::commercial_campaigns(
            &s.db,
            infrastructure::CampaignScope {
                needle: single_value(&params, "q"),
                statuses: facet_values(&params, "status"),
                phases: facet_values(&params, "phase"),
                now: s.clock.now(),
                objectives: facet_values(&params, "objective"),
                offers_min: whole_value(&params, "offers_min")?,
                offers_max: whole_value(&params, "offers_max")?,
                stores_min: whole_value(&params, "stores_min")?,
                stores_max: whole_value(&params, "stores_max")?,
                ends_from: day_value(&params, "ends_from")?,
                ends_to: day_value(&params, "ends_to")?,
                ends_open: ends_value(&params)?,
                sort: single_value(&params, "sort"),
                desc: single_value(&params, "dir").as_deref() == Some("desc"),
                cursor: single_value(&params, "cursor"),
                limit: limit_value(&params)?,
            },
        )
        .await?,
    ))
}
