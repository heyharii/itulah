//! The integrity engine's surface: what the equations said, and what to do
//! about the ones that failed.
//!
//! Two questions and two shapes. `/integrity` is the engine's own answer — ten
//! equations, each Balanced, Pending, an Exception or Blocked — and it is read
//! by whoever is proving the books. `/attention` is the queue that falls out of
//! it, and it is read by whoever has to clear something.
//!
//! They are separate because their audiences are. A run has a scope of ten rows
//! whatever happens; a queue has as many rows as there are things to do, keeps
//! its age across runs, and self-clears. A screen built on the run alone could
//! never say "this has been open since the third", and one built on the queue
//! alone could never say "everything else balances".
//!
//! # Two feeds, and the rule between them
//!
//! `/attention` is head office's. `/attention/store/{site}` is one shop's, and
//! it holds only what a shop can act on: its own shifts, remittances, expenses
//! and counts. A General Ledger mismatch never appears there. That is not
//! politeness — a shop cannot post a correcting journal, so an item it cannot
//! clear is an item that sits at the top of its list forever, and a list like
//! that stops being read.
//!
//! # Nothing here posts
//!
//! Every route is a read except two: starting a run, and closing an item by
//! hand. Neither writes a journal line. The engine reads the books and says
//! what it found; the corrections are posted through the ordinary finance
//! screens by somebody who decided to.

use super::auth::Principal;
use super::scope::Scope;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, AttentionFeed, AttentionItemRow, IntegrityCheckDoc,
        IntegrityHistoryPoint, IntegrityRunSummary,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Lane E's routes, in one place.
///
/// One call line in `router()` rather than six, because six lines in a file
/// eight hundred routes long is six chances for a merge to drop one.
pub fn lane_e_routes(router: Router<AppState>) -> Router<AppState> {
    router
        // `run` before `{key}` by convention only — the router prefers the
        // static segment either way — but written in the order somebody
        // reading it would expect to find them.
        .route("/api/v1/finance/integrity/run", post(integrity_run))
        .route("/api/v1/finance/integrity", get(integrity_latest))
        .route("/api/v1/finance/integrity/{key}", get(integrity_check))
        // `/items`, and not the bare `/finance/attention`, because that path
        // was already taken by a different question. This lane answers "which
        // items are waiting"; the one in `finance::attention` answers "how
        // many, this month" and is what every console's badge reads. Two
        // branches named one path for two shapes and axum refuses to start on
        // the overlap — the collision is why this suffix exists.
        .route("/api/v1/finance/attention/items", get(attention))
        .route(
            "/api/v1/finance/attention/store/{site_id}",
            get(attention_for_store),
        )
        .route(
            "/api/v1/finance/attention/{id}/resolve",
            post(resolve_attention),
        )
}

#[derive(Debug, Deserialize)]
pub struct RunRequest {
    /// The date the equations are asked about, which is not today by default
    /// only because a month end is closed on the third of the next month. Left
    /// out, it is today.
    pub as_of: Option<NaiveDate>,
}

/// Ask every equation now.
///
/// Synchronous on purpose. Ten equations over a year of postings is a few
/// seconds, and somebody who pressed the button because they are closing a
/// month wants the answer, not a job id and a screen to refresh.
pub async fn integrity_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RunRequest>,
) -> Result<Json<IntegrityRunSummary>, AppError> {
    let as_of = request.as_of.unwrap_or_else(|| Utc::now().date_naive());
    Ok(Json(
        infrastructure::integrity_run_now(&state.db, as_of, "MANUAL", &principal.username).await?,
    ))
}

/// What the engine says, with the catalogue beside it.
///
/// The catalogue is sent even though every check in it appears in `run.results`,
/// because the two disagree in the one case that matters: a run recorded before
/// an equation was added has no row for it, and a screen showing only the run
/// would quietly not mention the new equation until the next night. The
/// catalogue is what is being checked; the run is what it said.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IntegrityOverview {
    pub run: IntegrityRunSummary,
    pub catalogue: Vec<IntegrityCheckDoc>,
}

pub async fn integrity_latest(
    State(state): State<AppState>,
) -> Result<Json<IntegrityOverview>, AppError> {
    Ok(Json(IntegrityOverview {
        run: infrastructure::integrity_latest(&state.db).await?,
        catalogue: infrastructure::integrity_catalogue(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub limit: Option<i64>,
}

/// One equation over time.
///
/// The question a control screen is actually opened to answer, which is never
/// "what does it say now" but "when did this start".
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IntegrityCheckHistory {
    pub check: IntegrityCheckDoc,
    pub points: Vec<IntegrityHistoryPoint>,
}

pub async fn integrity_check(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<IntegrityCheckHistory>, AppError> {
    let check = infrastructure::integrity_catalogue()
        .into_iter()
        .find(|doc| doc.key == key)
        // NotFound rather than an empty history, because a mistyped key and an
        // equation that has never been out of balance would otherwise look the
        // same, and one of them is a bug.
        .ok_or_else(|| AppError::NotFound(format!("no control equation is keyed {key}")))?;
    Ok(Json(IntegrityCheckHistory {
        points: infrastructure::integrity_history(&state.db, &key, query.limit.unwrap_or(60))
            .await?,
        check,
    }))
}

#[derive(Debug, Deserialize)]
pub struct FeedQuery {
    pub limit: Option<i64>,
}

/// Head office's queue, grouped by area.
pub async fn attention(
    State(state): State<AppState>,
    scope: Scope,
    Query(query): Query<FeedQuery>,
) -> Result<Json<AttentionFeed>, AppError> {
    // The whole fleet's queue is head office's. A caller bounded to one unit
    // reads their own shop's queue at `/attention/store/{site}`.
    if !scope.is_everywhere() {
        return Err(AppError::Forbidden(
            "the fleet's attention queue is head office's; read your own store's queue instead"
                .into(),
        ));
    }
    Ok(Json(
        infrastructure::attention_list(&state.db, query.limit.unwrap_or(200)).await?,
    ))
}

/// One shop's queue: only what that shop can act on.
pub async fn attention_for_store(
    State(state): State<AppState>,
    scope: Scope,
    Path(site_id): Path<String>,
    Query(query): Query<FeedQuery>,
) -> Result<Json<AttentionFeed>, AppError> {
    scope.require_site(&state, &site_id).await?;
    Ok(Json(
        infrastructure::attention_for_store(&state.db, &site_id, query.limit.unwrap_or(200))
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ResolveRequest {
    /// Why it is being closed while the engine still thinks it is wrong.
    pub reason: String,
}

/// Close one by hand.
///
/// A run resolves what it can see is fixed, so anything reaching this route is
/// something the engine still disagrees with — which is why the reason is
/// required rather than optional.
pub async fn resolve_attention(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<ResolveRequest>,
) -> Result<Json<AttentionItemRow>, AppError> {
    Ok(Json(
        infrastructure::attention_resolve(&state.db, id, &request.reason, &principal.username)
            .await?,
    ))
}
