//! Finance Connect routes: EDC terminals and the shops' EDC machines, MDR
//! rates, Finance settings, "Tambah bank", the sale-day exception queue and
//! the MDR variance review.
//!
//! All of it is Finance head-office work, so every route asks for ADMIN.

use super::auth::Principal;
use crate::cloud::postgres::number_series::{NumberSeries, NumberSeriesList, NumberSeriesPatch};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, AcquirerFeeRate, AcquirerSettlementRow, AddBankOutcome,
        AddBankRequest, EdcMachine, EdcMachineBook, EdcTerminal, FinanceSetting,
        ResolveSalesExceptionRequest, SalesPostingDocument, SaveEdcMachineRequest,
        SetAcquirerFeeRateRequest, SetFinanceSettingRequest, SetShopOtherMethodsRequest,
        SitePaymentMethod, UpsertEdcTerminalRequest,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
    Extension, Json, Router,
};
use uuid::Uuid;

fn allowed(principal: &Principal, act: &str) -> Result<(), AppError> {
    if role_allows(Role::Admin, principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {act}: it is Finance head-office setup",
        principal.username
    )))
}

pub async fn edc_terminals(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<EdcTerminal>>, AppError> {
    allowed(&principal, "read the EDC terminals")?;
    Ok(Json(infrastructure::edc_terminals(&state.db).await?))
}

pub async fn upsert_edc_terminal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<UpsertEdcTerminalRequest>,
) -> Result<Json<EdcTerminal>, AppError> {
    allowed(&principal, "register an EDC terminal")?;
    Ok(Json(
        infrastructure::upsert_edc_terminal(&state.db, &request, &principal.username).await?,
    ))
}

/// Every shop's EDC machines, the banks one can be of, and the accounts one
/// can settle to (0989).
pub async fn edc_machine_book(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<EdcMachineBook>, AppError> {
    allowed(&principal, "read the shops' EDC machines")?;
    Ok(Json(infrastructure::edc_machine_book(&state.db).await?))
}

pub async fn save_edc_machine(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((site, bank)): Path<(String, String)>,
    Json(request): Json<SaveEdcMachineRequest>,
) -> Result<Json<EdcMachine>, AppError> {
    allowed(&principal, "set a shop's EDC machine")?;
    Ok(Json(
        infrastructure::save_edc_machine(&state.db, &site, &bank, &request, &principal.username)
            .await?,
    ))
}

pub async fn remove_edc_machine(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((site, bank)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    allowed(&principal, "remove a shop's EDC machine")?;
    infrastructure::remove_edc_machine(&state.db, &site, &bank, &principal.username).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn set_shop_other_methods(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(site): Path<String>,
    Json(request): Json<SetShopOtherMethodsRequest>,
) -> Result<Json<Vec<SitePaymentMethod>>, AppError> {
    allowed(&principal, "set a shop's payment methods")?;
    Ok(Json(
        infrastructure::set_shop_other_methods(&state.db, &site, &request, &principal.username)
            .await?,
    ))
}

pub async fn acquirer_fee_rates(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<AcquirerFeeRate>>, AppError> {
    allowed(&principal, "read the MDR rates")?;
    Ok(Json(infrastructure::acquirer_fee_rates(&state.db).await?))
}

pub async fn set_acquirer_fee_rate(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SetAcquirerFeeRateRequest>,
) -> Result<Json<AcquirerFeeRate>, AppError> {
    allowed(&principal, "set an MDR rate")?;
    Ok(Json(
        infrastructure::set_acquirer_fee_rate(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn finance_settings(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<FinanceSetting>>, AppError> {
    allowed(&principal, "read the Finance settings")?;
    Ok(Json(infrastructure::finance_settings(&state.db).await?))
}

pub async fn set_finance_setting(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(key): Path<String>,
    Json(request): Json<SetFinanceSettingRequest>,
) -> Result<Json<FinanceSetting>, AppError> {
    allowed(&principal, "change a Finance setting")?;
    Ok(Json(
        infrastructure::set_finance_setting(&state.db, &key, &request, &principal.username).await?,
    ))
}

pub async fn add_bank(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<AddBankRequest>,
) -> Result<Json<AddBankOutcome>, AppError> {
    allowed(&principal, "add a bank")?;
    Ok(Json(
        infrastructure::add_bank(&state.db, &request, &principal.username).await?,
    ))
}

pub async fn resolve_sales_exception(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(exception_id): Path<Uuid>,
    Json(request): Json<ResolveSalesExceptionRequest>,
) -> Result<Json<SalesPostingDocument>, AppError> {
    allowed(&principal, "resolve a sale-day exception")?;
    Ok(Json(
        infrastructure::sales_posting_exception_resolve(
            &state.db,
            exception_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

pub async fn accept_mdr_variance(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(settlement_id): Path<Uuid>,
) -> Result<Json<AcquirerSettlementRow>, AppError> {
    allowed(&principal, "accept an MDR variance")?;
    Ok(Json(
        infrastructure::acq_settlement_accept_mdr_variance(
            &state.db,
            settlement_id,
            &principal.username,
        )
        .await?,
    ))
}

pub async fn post_stock_transfers(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<serde_json::Value>, AppError> {
    allowed(&principal, "book allotment transfers")?;
    let booked =
        infrastructure::stock_transfer_post_pending(&state.db, &principal.username).await?;
    Ok(Json(serde_json::json!({ "booked": booked })))
}

/// How every kind of document is numbered (0701).
pub async fn number_series(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<NumberSeriesList>, AppError> {
    allowed(&principal, "read the number series")?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::number_series::list_number_series(&state.db, today).await?,
    ))
}

/// Change how one kind is numbered, from its next document on. Numbers already
/// issued never change.
pub async fn set_number_series(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(kind): Path<String>,
    Json(patch): Json<NumberSeriesPatch>,
) -> Result<Json<NumberSeries>, AppError> {
    allowed(&principal, "change how documents are numbered")?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::number_series::put_number_series(
            &state.db,
            &kind,
            patch,
            &principal.username,
            today,
        )
        .await?,
    ))
}

pub fn finance_setup_routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route(
            "/api/v1/finance/edc-terminals",
            get(edc_terminals).post(upsert_edc_terminal),
        )
        .route("/api/v1/finance/edc-machines", get(edc_machine_book))
        .route(
            "/api/v1/finance/sites/{site}/edc-machines/{bank}",
            put(save_edc_machine).delete(remove_edc_machine),
        )
        .route(
            "/api/v1/finance/sites/{site}/other-methods",
            put(set_shop_other_methods),
        )
        .route(
            "/api/v1/finance/acquirer-fee-rates",
            get(acquirer_fee_rates).post(set_acquirer_fee_rate),
        )
        .route("/api/v1/finance/settings", get(finance_settings))
        .route("/api/v1/finance/settings/{key}", put(set_finance_setting))
        .route("/api/v1/finance/banks/add", post(add_bank))
        .route(
            "/api/v1/finance/sales-posting-exceptions/{id}/resolve",
            post(resolve_sales_exception),
        )
        .route(
            "/api/v1/finance/acquirer-settlements/{id}/accept-mdr-variance",
            post(accept_mdr_variance),
        )
        .route(
            "/api/v1/finance/stock-transfers/post",
            post(post_stock_transfers),
        )
        .route("/api/v1/finance/number-series", get(number_series))
        .route(
            "/api/v1/finance/number-series/{kind}",
            put(set_number_series),
        )
}
