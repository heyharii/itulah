//! General Affairs' surface.
//!
//! # Why its own prefix and not more of `/api/v1/finance`
//!
//! Because the two answer different people. `/api/v1/finance` is the books:
//! what is owed, what it cost, what a month closed at. This is the register and
//! the upkeep — where the air conditioner is, who holds the laptop, when the
//! shop's lease runs out, which repair is waiting on a budget. The owner drew
//! that line when he moved Vendors out of Finance ("vendor registrasi di ga
//! bukan?"), and a GA screen that wrote through a Finance path would put every
//! act of the department behind `ADMIN`.
//!
//! # The role, and why it is one rung rather than two
//!
//! `required_role` gives `/api/v1/ga` SUPERVISOR for reads and writes alike.
//! That is not a shortcut around a maker/checker split — the two acts that need
//! one have it in the domain rather than in the ladder: approving a repair's
//! budget, a replacement or a disposal is refused when the approver is the
//! person who raised it, the `counted_by <> verified_by` pattern this estate
//! already uses. A shop manager filing a repair is doing their job; requiring
//! head office for that would mean every broken door waited for a signature.
//!
//! Nothing here posts. GA names the kind of thing that happened and Finance's
//! `account_map` turns it into an account.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{self as infrastructure, GaOverview},
};
use axum::{extract::State, routing::get, Extension, Json, Router};

fn allowed(principal: &Principal, needed: Role, act: &str) -> Result<(), AppError> {
    if role_allows(needed, principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {act}",
        principal.username
    )))
}

/// What GA wants somebody to look at, as of the business clock's today.
///
/// The thresholds are the server's and not the screen's, deliberately: a
/// contract carries its own `reminder_days` and "expires soon" is a business
/// rule, not a rendering choice. A screen that decided it would answer
/// differently on the day somebody's laptop was set to another timezone.
pub async fn overview(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<GaOverview>, AppError> {
    allowed(&principal, Role::Supervisor, "read the GA overview")?;
    let today = state.clock.now().date_naive();
    Ok(Json(infrastructure::ga_overview(&state.db, today).await?))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router.route("/api/v1/ga/overview", get(overview))
}
