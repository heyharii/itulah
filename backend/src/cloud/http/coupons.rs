//! The coupon routes.
//!
//! Authoring a set and minting ten thousand codes are Commercial writes and sit
//! where every other one does: `required_role` has no arm for them, so they fall
//! through to Supervisor, which is where deciding what the company gives away
//! belongs.
//!
//! The hold, the commit and the release are the three a TILL calls, and they
//! land on Supervisor too — by the same fall-through, and for no reason anybody
//! chose. That is worth naming rather than quietly working around here: the
//! voucher hold added in `0162` has exactly the same problem, and the two should
//! be fixed together in `required_role`, not patched one route at a time from
//! this file. See the note in the report that came with this module.
//!
//! No `Idempotency-Key` on any of the three. The hold is keyed by
//! `(coupon_code_id, checkout_id)` in the database, which is stronger than a
//! header: a header key makes a RETRY safe, and this makes the QUESTION safe —
//! a till asking twice for the same basket, with two different keys, still gets
//! one hold.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::RecordKind,
    http::audit::DeclaredSubject,
    postgres::{
        self as infrastructure, AuthorizeCouponRequest, CancelCouponRequest, CommitCouponRequest,
        CreateCouponSetRequest, MintCouponsRequest, ReleaseCouponRequest,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};

/// Every set, with what each one has given away.
pub async fn list_coupon_sets(
    State(state): State<AppState>,
) -> Result<Json<Vec<infrastructure::CouponSetRow>>, AppError> {
    Ok(Json(infrastructure::list_coupon_sets(&state.db).await?))
}

/// Author one.
///
/// The actor comes from the session and never from the body. Who decided to
/// give something away is the one fact about a coupon set that must not be
/// self-reported — the same rule the voucher routes apply to issuing a card.
pub async fn create_coupon_set(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<CreateCouponSetRequest>,
) -> Result<(StatusCode, Json<infrastructure::CouponSetRow>), AppError> {
    let set = infrastructure::create_coupon_set(&state.db, request, &principal.username).await?;
    acted_on.set(RecordKind::CouponSet, set.set_code.clone());
    Ok((StatusCode::CREATED, Json(set)))
}

/// One set and how it is going.
pub async fn coupon_set_detail(
    State(state): State<AppState>,
    Path(set_code): Path<String>,
) -> Result<Json<infrastructure::CouponSetRow>, AppError> {
    Ok(Json(
        infrastructure::coupon_set_detail(&state.db, &set_code).await?,
    ))
}

/// Mint the codes for a mailing.
///
/// The response carries every code, because the caller has to print or send
/// them and a mint that only reported a number would need a second endpoint
/// before it was of any use.
pub async fn mint_coupon_codes(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(set_code): Path<String>,
    Json(request): Json<MintCouponsRequest>,
) -> Result<(StatusCode, Json<infrastructure::MintedCoupons>), AppError> {
    let minted =
        infrastructure::mint_coupon_codes(&state.db, &set_code, request, &principal.username)
            .await?;
    Ok((StatusCode::CREATED, Json(minted)))
}

/// One code, its set, and every sale that used it.
pub async fn coupon_code_detail(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<infrastructure::CouponCodeDetail>, AppError> {
    Ok(Json(
        infrastructure::coupon_code_detail(&state.db, &code).await?,
    ))
}

/// Hold a use while a basket is being paid for.
pub async fn authorize_coupon(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Json(request): Json<AuthorizeCouponRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        infrastructure::authorize_coupon(&state.db, &code, request).await?,
    ))
}

/// The sale landed: turn the hold into a redemption.
pub async fn commit_coupon_hold(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Json(request): Json<CommitCouponRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        infrastructure::commit_coupon_hold(&state.db, &code, request).await?,
    ))
}

/// The checkout died: give the held use back.
pub async fn release_coupon_hold(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Json(request): Json<ReleaseCouponRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        infrastructure::release_coupon_hold(&state.db, &code, request).await?,
    ))
}

/// Stop a code.
///
/// For a SHARED set this stops the promotion, because the set's one code is the
/// promotion. Open holds are let go with it; redemptions already taken are left
/// exactly as they are.
pub async fn cancel_coupon_code(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Json(request): Json<CancelCouponRequest>,
) -> Result<Json<infrastructure::CouponCodeRow>, AppError> {
    Ok(Json(
        infrastructure::cancel_coupon_code(&state.db, &code, request, &principal.username).await?,
    ))
}

/// Write down what the clock has already made true.
///
/// Changes no decision — a lapsed hold stopped counting against availability
/// the moment it lapsed, and a code past its window is refused whether or not
/// this has run. It exists so a list of ten thousand codes can show which ones
/// died without computing it per row.
pub async fn expire_lapsed_coupons(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        infrastructure::expire_lapsed_coupons(&state.db).await?,
    ))
}
