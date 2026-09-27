//! The inter-unit check, in two shapes for two readers.
//!
//! Head office asks for the pairs and gets all thirteen shops in both columns.
//! A shop asks for itself and gets one shop in both columns, in the same shape,
//! so neither can read a differently-shaped number and reach a different
//! conclusion from it.
//!
//! Both are reads over the journal. Nothing here writes, and nothing here could:
//! an inter-unit balance is a consequence of documents, and the moment it became
//! something a person could adjust directly it would stop being evidence.
//!
//! There is no "settle" and no "agree" button, and that is the point. The two
//! sides are written by one rule in one transaction, so agreeing is not an act
//! somebody performs — it is a property somebody checks. A difference here means
//! a hand-written journal entry landed in an affiliate account, and the answer to
//! that is to look at the entry, which the movements below link to.

use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, InterunitReport},
};
use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};

/// Both sides of every pair, and the twenty most recent inter-unit lines.
pub async fn pairs(State(state): State<AppState>) -> Result<Json<InterunitReport>, AppError> {
    Ok(Json(infrastructure::interunit_pairs(&state.db).await?))
}

/// One store's balance with head office, and its own recent movements. The
/// path names the store's unit (0605): the books are the unit's, not a
/// premises'.
pub async fn store(
    State(state): State<AppState>,
    Path(unit): Path<String>,
) -> Result<Json<InterunitReport>, AppError> {
    Ok(Json(
        infrastructure::interunit_store_view(&state.db, &unit).await?,
    ))
}

/// `pairs` is above `{unit}` because the router ranks a static segment over a
/// dynamic one, so the word "pairs" here is never read as a unit id — the
/// same ordering `employees/contracts/expiring` relies on.
pub fn lane_d_routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/finance/interunit/pairs", get(pairs))
        .route("/api/v1/finance/interunit/{unit}", get(store))
}
