//! The voucher routes.
//!
//! Three of the four are ordinary Commercial writes and sit where every other
//! one does — Supervisor, because issuing a card creates a liability and
//! stopping one takes value away from a customer, and neither is a decision a
//! till operator makes alone.
//!
//! Redemption is the exception, and deliberately so: it happens at a counter
//! with a shopper standing there, so `required_role` puts `…/redeem` on the
//! Cashier rung. A voucher a cashier can look up and cannot spend is a card
//! that fails at exactly the moment it is presented.

use super::articles::{idempotency_key, request_digest};
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::RecordKind,
    http::audit::DeclaredSubject,
    postgres::{
        self as infrastructure, IssueVoucherRequest, RedeemVoucherRequest, VoidVoucherRequest,
        VoucherQuery,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
use serde_json::json;

/// Every voucher, and what the whole book comes to.
///
/// The filters narrow the list. They never narrow the ledger strip above it —
/// see `list_vouchers`: the outstanding balance is what the shop owes, and a
/// liability that moved because somebody typed in a search box is a figure
/// nobody could repeat to an accountant.
pub async fn list_vouchers(
    State(state): State<AppState>,
    Query(query): Query<VoucherQuery>,
) -> Result<Json<infrastructure::VoucherList>, AppError> {
    Ok(Json(infrastructure::list_vouchers(&state.db, query).await?))
}

/// One card and everything that has happened to it.
///
/// Keyed by the code rather than the uuid, because the code is what exists
/// outside this system: it is printed on the card, and somebody reading it out
/// over a telephone should be able to reach this.
pub async fn voucher_detail(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<infrastructure::VoucherDetail>, AppError> {
    Ok(Json(
        infrastructure::voucher_detail(&state.db, &code).await?,
    ))
}

/// Issue one.
///
/// The actor comes from the session and never from the body — the middleware
/// enforces that for any `actor_id` a caller sends, and this simply does not
/// offer the field. Who gave away value is the one fact about a voucher that
/// must not be self-reported.
pub async fn issue_voucher(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    headers: HeaderMap,
    Json(request): Json<IssueVoucherRequest>,
) -> Result<(StatusCode, Json<infrastructure::VoucherRow>), AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let voucher =
        infrastructure::issue_voucher(&state.db, request, &principal.username, &key, &digest)
            .await?;
    // The voucher sheet is keyed by the code a shopper reads out, not by the
    // row's uuid, so the history has to be filed under the same thing.
    acted_on.set(RecordKind::Voucher, voucher.code.clone());
    Ok((StatusCode::CREATED, Json(voucher)))
}

/// Spend some of one against a basket.
/// Hold an amount against a card while a basket is being paid for.
///
/// No `Idempotency-Key`: the hold is keyed by `(voucher, checkout)` in the
/// database, which is stronger. A header key makes a RETRY safe; this makes the
/// QUESTION safe — a till asking twice for the same basket, with two different
/// keys, still gets one hold.
pub async fn authorize_voucher(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Json(request): Json<infrastructure::AuthorizeVoucherRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        infrastructure::authorize_voucher(&state.db, &code, request).await?,
    ))
}

/// The sale landed: turn the hold into a redemption.
pub async fn commit_voucher_hold(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Json(request): Json<infrastructure::CommitVoucherRequest>,
) -> Result<Json<infrastructure::VoucherDetail>, AppError> {
    Ok(Json(
        infrastructure::commit_voucher_hold(&state.db, &code, request).await?,
    ))
}

/// The checkout died: give the held amount back.
pub async fn release_voucher_hold(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Json(request): Json<infrastructure::ReleaseVoucherRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        infrastructure::release_voucher_hold(&state.db, &code, request).await?,
    ))
}

pub async fn redeem_voucher(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    headers: HeaderMap,
    Json(request): Json<RedeemVoucherRequest>,
) -> Result<Json<infrastructure::VoucherDetail>, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "code": &code,
        "request": &request,
    }))?;
    Ok(Json(
        infrastructure::redeem_voucher(
            &state.db,
            &code,
            request,
            &principal.username,
            &key,
            &digest,
        )
        .await?,
    ))
}

/// Stop one, and write off whatever is left on it.
pub async fn void_voucher(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    headers: HeaderMap,
    Json(request): Json<VoidVoucherRequest>,
) -> Result<Json<infrastructure::VoucherDetail>, AppError> {
    let key = idempotency_key(&headers)?;
    let digest = request_digest(&json!({
        "actor": &principal.username,
        "code": &code,
        "request": &request,
    }))?;
    Ok(Json(
        infrastructure::void_voucher(
            &state.db,
            &code,
            request,
            &principal.username,
            &key,
            &digest,
        )
        .await?,
    ))
}
