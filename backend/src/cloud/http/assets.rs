//! The register's own endpoints: the month that charges itself, and the
//! replacement reserve.
//!
//! Everything here sits under `/api/v1/finance`, which is what decides who may
//! call it: `domain::auth::required_role` makes every read of that prefix
//! SUPERVISOR and every write ADMIN, because a till operator has no business
//! reading the general ledger and posting a month is not a shop-floor act.
//! There is no second gate in this file, deliberately — a route that guarded
//! itself would be a second answer to a question one function already answers,
//! and the day the two disagree is the day somebody reaches something they
//! should not.
//!
//! # Why the month is a query parameter and not a body
//!
//! Because these are the endpoints a schedule and a checklist call, and both of
//! them build a URL. `POST …/depreciation/run?period=2026-09` can be re-issued
//! from a log line; a JSON body cannot. The older
//! `POST /finance/depreciation/run` keeps its body and its behaviour — it is
//! what the Assets screen already posts — and this one adds the run log around
//! the same work.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, AssetDepreciationStatus, AssetReplacementRate, AssetReserveClass,
        DepreciationRun, ReserveRun, ReserveStatus, SetReplacementRateRequest,
    },
};
use axum::{
    extract::{Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{Datelike, Months, Utc};
use serde::Deserialize;

/// `?period=2026-09`.
#[derive(Debug, Deserialize)]
pub struct PeriodQuery {
    pub period: Option<String>,
}

/// The month asked for, or the one that just ended.
///
/// Defaulting to the previous month rather than to this one is the whole point:
/// a month is charged after it has finished, and a scheduled run with no
/// argument that charged the month still in progress would post a full month's
/// depreciation on the 3rd.
fn month_of(query: &PeriodQuery) -> Result<(i32, u32), AppError> {
    let Some(raw) = query.period.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        let previous = Utc::now()
            .date_naive()
            .checked_sub_months(Months::new(1))
            .ok_or_else(|| AppError::Validation("cannot work out last month".into()))?;
        return Ok((previous.year(), previous.month()));
    };
    let (year, month) = raw
        .split_once('-')
        .ok_or_else(|| AppError::Validation(format!("'{raw}' is not a month; expected 2026-09")))?;
    let year: i32 = year
        .parse()
        .map_err(|_| AppError::Validation(format!("'{raw}' is not a month; expected 2026-09")))?;
    let month: u32 = month
        .parse()
        .map_err(|_| AppError::Validation(format!("'{raw}' is not a month; expected 2026-09")))?;
    if !(1..=12).contains(&month) {
        return Err(AppError::Validation("month must be 1..12".into()));
    }
    Ok((year, month))
}

/// Charge a month, and record that it was charged.
///
/// Safe to run twice, three times, or once a night: the unique index on (asset,
/// period) refuses a second entry, so a repeat posts nothing and reports every
/// asset as already done. What a repeat DOES add is another row in the run log,
/// which is correct — an attempt is a fact.
pub async fn asset_depreciation_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<PeriodQuery>,
) -> Result<Json<DepreciationRun>, AppError> {
    let (year, month) = month_of(&query)?;
    // The same pre-flight the older endpoint makes. Without it a run against an
    // unmapped category refuses asset by asset, and the person reading the
    // answer has to work out that eleven identical refusals are one missing
    // mapping.
    let missing = infrastructure::unmapped_categories(&state.db).await?;
    if !missing.is_empty() {
        return Err(AppError::Validation(format!(
            "map these before running depreciation, or the run refuses asset by asset: {}",
            missing.join("; ")
        )));
    }
    Ok(Json(
        infrastructure::asset_depreciation_run_month(
            &state.db,
            year,
            month,
            &principal.username,
        )
        .await?,
    ))
}

/// Whether a month's depreciation is actually complete.
///
/// The endpoint a period-close checklist reads. It answers from the register
/// and not from the run log, because a month run correctly on the 1st can be
/// incomplete on the 5th: an asset capitalised in between now owes a charge it
/// did not owe then, and a "completed" flag would say otherwise.
pub async fn asset_depreciation_status(
    State(state): State<AppState>,
    Query(query): Query<PeriodQuery>,
) -> Result<Json<AssetDepreciationStatus>, AppError> {
    let (year, month) = month_of(&query)?;
    Ok(Json(
        infrastructure::asset_depreciation_status(&state.db, year, month).await?,
    ))
}

/// The classes the company reserves against rather than depreciates.
pub async fn asset_reserve_classes(
    State(state): State<AppState>,
) -> Result<Json<Vec<AssetReserveClass>>, AppError> {
    Ok(Json(
        infrastructure::asset_reserve_classes(&state.db).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct RateQuery {
    pub site: Option<String>,
    pub class: Option<String>,
}

/// Every rate ever set, not only the one in force.
pub async fn asset_replacement_rates(
    State(state): State<AppState>,
    Query(query): Query<RateQuery>,
) -> Result<Json<Vec<AssetReplacementRate>>, AppError> {
    Ok(Json(
        infrastructure::asset_replacement_rates(
            &state.db,
            query.site.as_deref(),
            query.class.as_deref(),
        )
        .await?,
    ))
}

/// Set what one location puts aside for one class, from one month on.
pub async fn asset_set_replacement_rate(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SetReplacementRateRequest>,
) -> Result<Json<AssetReplacementRate>, AppError> {
    Ok(Json(
        infrastructure::set_asset_replacement_rate(&state.db, &request, &principal.username)
            .await?,
    ))
}

/// Charge one month of replacement reserve across every rated class.
pub async fn asset_reserve_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<PeriodQuery>,
) -> Result<Json<ReserveRun>, AppError> {
    let (year, month) = month_of(&query)?;
    Ok(Json(
        infrastructure::asset_reserve_charge(&state.db, year, month, &principal.username).await?,
    ))
}

/// What a month's reserve still owes.
pub async fn asset_reserve_status(
    State(state): State<AppState>,
    Query(query): Query<PeriodQuery>,
) -> Result<Json<ReserveStatus>, AppError> {
    let (year, month) = month_of(&query)?;
    Ok(Json(
        infrastructure::asset_reserve_status(&state.db, year, month).await?,
    ))
}

/// Every route this lane owns, merged into the main router by one line.
///
/// All of them sit below `/api/v1/finance/assets/…` with two static segments
/// where the existing routes have `{id}` and one — axum ranks a static segment
/// above a dynamic one, so `depreciation` is never read as an asset id, the
/// same way `assets/unbacked` has never been.
pub fn lane_j_routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route(
            "/api/v1/finance/assets/depreciation/run",
            post(asset_depreciation_run),
        )
        .route(
            "/api/v1/finance/assets/depreciation/status",
            get(asset_depreciation_status),
        )
        // The client's seventh asset family is not depreciated at all: racks,
        // mannequins and hangers are reserved for, month by month, and a
        // replacement comes out of the reserve. Their chart has carried the
        // three parallel blocks of accounts for it since before this system
        // existed.
        .route(
            "/api/v1/finance/assets/reserve/classes",
            get(asset_reserve_classes),
        )
        .route(
            "/api/v1/finance/assets/reserve/rates",
            get(asset_replacement_rates).post(asset_set_replacement_rate),
        )
        .route(
            "/api/v1/finance/assets/reserve/run",
            post(asset_reserve_run),
        )
        .route(
            "/api/v1/finance/assets/reserve/status",
            get(asset_reserve_status),
        )
}
