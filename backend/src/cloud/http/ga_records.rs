//! GA's papers, originals and operating expenses over HTTP (0974), and the
//! contract roster, insurance claims and odometer readings (0975).
//!
//! Under `/api/v1/ga` like the rest of the department, so the same job
//! sections gate it. See `postgres/ga_papers.rs` and `postgres/ga_expenses.rs`
//! for the model: three objects behind one "BPKB", and an expense that GA
//! records and Finance pays; `postgres/ga_claims.rs` and
//! `postgres/ga_odometer.rs` for a claim under a policy and a car's readings.

use super::auth::Principal;
use super::{limit_value, refuse_unknown_parameters, single_value};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, AddGaContractCoverRequest, ApproveGaInsuranceClaimRequest,
        AttachGaScanRequest, CancelGaOperatingExpenseRequest, GaContractHub, GaInsuranceClaimRow,
        GaInsuranceClaimScope, GaOdometerReading, GaOperatingExpensePage, GaOperatingExpenseRow,
        GaOperatingExpenseScope, GaOriginalHub, GaOriginalRow, GaOriginalScope, GaPaper,
        LinkGaClaimRepairRequest, LinkGaOperatingExpenseRequest, PayGaInsuranceClaimRequest,
        RecordGaInsuranceClaimRequest, RecordGaOdometerReadingRequest,
        RecordGaOperatingExpenseRequest, RecordGaPaperRequest, RegisterGaOriginalRequest,
        RejectGaInsuranceClaimRequest, ReleaseGaOriginalRequest, RemoveGaContractCoverRequest,
        ReturnGaOriginalRequest, SubmitGaInsuranceClaimRequest, SubmitGaOperatingExpenseRequest,
        SurveyGaInsuranceClaimRequest, DEFAULT_GA_CLAIM_LIMIT, DEFAULT_GA_EXPENSE_LIMIT,
        DEFAULT_GA_ORIGINAL_LIMIT,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::{delete, get, post},
    Extension, Json, Router,
};
use uuid::Uuid;

fn allowed(principal: &Principal, needed: Role, act: &str) -> Result<(), AppError> {
    if role_allows(needed, principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {act}",
        principal.username
    )))
}

fn uuid_param(params: &[(String, String)], key: &str) -> Result<Option<Uuid>, AppError> {
    single_value(params, key)
        .map(|raw| {
            Uuid::parse_str(raw.trim())
                .map_err(|_| AppError::Validation(format!("{key} {raw:?} is not an id")))
        })
        .transpose()
}

/// Papers and originals are the head office's: a shop's till may read those
/// about an asset at its own site, and nothing across the estate.
async fn may_read_papers(
    state: &AppState,
    principal: &Principal,
    asset_id: Option<Uuid>,
) -> Result<(), AppError> {
    match (principal.bound_site(), asset_id) {
        (None, _) => Ok(()),
        (Some(_), Some(asset_id)) => {
            let site = infrastructure::ga_asset_site(&state.db, asset_id).await?;
            principal.may_touch_site(Some(&site), "asset")
        }
        (Some(_), None) => Err(AppError::Forbidden(
            "the papers register is kept at head office".into(),
        )),
    }
}

fn today(state: &AppState) -> chrono::NaiveDate {
    state.clock.now().date_naive()
}

// ── papers ──────────────────────────────────────────────────────────────

/// Every typed paper, scanned or not (`q` narrows), or the papers about one
/// asset (`asset`).
pub async fn papers(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Vec<GaPaper>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the papers")?;
    refuse_unknown_parameters(&params, &["q", "asset", "contract"])?;
    let asset = uuid_param(&params, "asset")?;
    may_read_papers(&state, &principal, asset).await?;
    if let Some(asset) = asset {
        return Ok(Json(
            infrastructure::ga_papers_about(&state.db, "asset", &asset.to_string(), today(&state))
                .await?,
        ));
    }
    if let Some(contract) = uuid_param(&params, "contract")? {
        return Ok(Json(
            infrastructure::ga_papers_about(
                &state.db,
                "contract",
                &contract.to_string(),
                today(&state),
            )
            .await?,
        ));
    }
    Ok(Json(
        infrastructure::ga_papers(
            &state.db,
            single_value(&params, "q").as_deref(),
            today(&state),
        )
        .await?,
    ))
}

pub async fn paper(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(document_id): Path<Uuid>,
) -> Result<Json<GaPaper>, AppError> {
    allowed(&principal, Role::Supervisor, "read a paper")?;
    may_read_papers(&state, &principal, None).await?;
    Ok(Json(
        infrastructure::ga_paper(&state.db, document_id, today(&state)).await?,
    ))
}

/// File a paper with no scan, about one or more records, with its original.
pub async fn record_paper(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordGaPaperRequest>,
) -> Result<Json<GaPaper>, AppError> {
    allowed(&principal, Role::Supervisor, "file a paper")?;
    may_read_papers(&state, &principal, None).await?;
    Ok(Json(
        infrastructure::ga_paper_record(&state.db, &request, &principal.username, today(&state))
            .await?,
    ))
}

pub async fn attach_scan(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(document_id): Path<Uuid>,
    Json(request): Json<AttachGaScanRequest>,
) -> Result<Json<GaPaper>, AppError> {
    allowed(&principal, Role::Supervisor, "attach a scan")?;
    may_read_papers(&state, &principal, None).await?;
    Ok(Json(
        infrastructure::ga_paper_attach_scan(&state.db, document_id, &request, today(&state))
            .await?,
    ))
}

// ── originals ───────────────────────────────────────────────────────────

pub async fn originals(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Vec<GaOriginalRow>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the originals")?;
    refuse_unknown_parameters(&params, &["asset", "document", "status", "limit"])?;
    let asset_id = uuid_param(&params, "asset")?;
    may_read_papers(&state, &principal, asset_id).await?;
    Ok(Json(
        infrastructure::ga_originals(
            &state.db,
            &GaOriginalScope {
                asset_id,
                document_id: uuid_param(&params, "document")?,
                status: single_value(&params, "status"),
                limit: limit_value(&params)?.unwrap_or(DEFAULT_GA_ORIGINAL_LIMIT),
            },
            today(&state),
        )
        .await?,
    ))
}

pub async fn original(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(original_id): Path<Uuid>,
) -> Result<Json<GaOriginalHub>, AppError> {
    allowed(&principal, Role::Supervisor, "read an original")?;
    may_read_papers(&state, &principal, None).await?;
    Ok(Json(
        infrastructure::ga_original_hub(&state.db, original_id, today(&state)).await?,
    ))
}

pub async fn register_original(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(document_id): Path<Uuid>,
    Json(request): Json<RegisterGaOriginalRequest>,
) -> Result<Json<GaOriginalHub>, AppError> {
    allowed(&principal, Role::Supervisor, "register an original")?;
    may_read_papers(&state, &principal, None).await?;
    Ok(Json(
        infrastructure::ga_original_register(
            &state.db,
            document_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn release_original(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(original_id): Path<Uuid>,
    Json(request): Json<ReleaseGaOriginalRequest>,
) -> Result<Json<GaOriginalHub>, AppError> {
    allowed(&principal, Role::Supervisor, "hand an original over")?;
    may_read_papers(&state, &principal, None).await?;
    Ok(Json(
        infrastructure::ga_original_release(
            &state.db,
            original_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn return_original(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(original_id): Path<Uuid>,
    Json(request): Json<ReturnGaOriginalRequest>,
) -> Result<Json<GaOriginalHub>, AppError> {
    allowed(&principal, Role::Supervisor, "take an original back")?;
    may_read_papers(&state, &principal, None).await?;
    Ok(Json(
        infrastructure::ga_original_return(
            &state.db,
            original_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

// ── operating expenses ──────────────────────────────────────────────────

pub async fn operating_expenses(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<GaOperatingExpensePage>, AppError> {
    allowed(&principal, Role::Supervisor, "read operating expenses")?;
    refuse_unknown_parameters(&params, &["site", "asset", "limit"])?;
    let asked: Vec<String> = single_value(&params, "site").into_iter().collect();
    let site_id = principal.site_filter(asked)?.into_iter().next();
    Ok(Json(
        infrastructure::ga_operating_expenses(
            &state.db,
            &GaOperatingExpenseScope {
                site_id,
                asset_id: uuid_param(&params, "asset")?,
                limit: limit_value(&params)?.unwrap_or(DEFAULT_GA_EXPENSE_LIMIT),
            },
        )
        .await?,
    ))
}

pub async fn record_operating_expense(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordGaOperatingExpenseRequest>,
) -> Result<Json<GaOperatingExpenseRow>, AppError> {
    allowed(&principal, Role::Supervisor, "record an operating expense")?;
    principal.may_touch_site(Some(request.site_id.trim()), "site")?;
    Ok(Json(
        infrastructure::ga_operating_expense_record(&state.db, &request, &principal.username)
            .await?,
    ))
}

async fn expense_at_my_site(
    state: &AppState,
    principal: &Principal,
    expense_id: Uuid,
) -> Result<(), AppError> {
    let row = infrastructure::ga_operating_expense(&state.db, expense_id).await?;
    principal.may_touch_site(Some(&row.site_id), "operating expense")
}

pub async fn submit_operating_expense(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(expense_id): Path<Uuid>,
    Json(request): Json<SubmitGaOperatingExpenseRequest>,
) -> Result<Json<GaOperatingExpenseRow>, AppError> {
    allowed(&principal, Role::Supervisor, "hand an expense to Finance")?;
    expense_at_my_site(&state, &principal, expense_id).await?;
    Ok(Json(
        infrastructure::ga_operating_expense_submit(
            &state.db,
            expense_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

pub async fn link_operating_expense(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(expense_id): Path<Uuid>,
    Json(request): Json<LinkGaOperatingExpenseRequest>,
) -> Result<Json<GaOperatingExpenseRow>, AppError> {
    allowed(&principal, Role::Supervisor, "link an expense to Finance")?;
    expense_at_my_site(&state, &principal, expense_id).await?;
    Ok(Json(
        infrastructure::ga_operating_expense_link(
            &state.db,
            expense_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

pub async fn cancel_operating_expense(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(expense_id): Path<Uuid>,
    Json(request): Json<CancelGaOperatingExpenseRequest>,
) -> Result<Json<GaOperatingExpenseRow>, AppError> {
    allowed(&principal, Role::Supervisor, "cancel an operating expense")?;
    expense_at_my_site(&state, &principal, expense_id).await?;
    Ok(Json(
        infrastructure::ga_operating_expense_cancel(
            &state.db,
            expense_id,
            &request,
            &principal.username,
        )
        .await?,
    ))
}

// ── the contract roster (0975) ──────────────────────────────────────────

/// The contract's coverage must be the caller's, and so must the asset's site.
async fn may_touch_contract(
    state: &AppState,
    principal: &Principal,
    contract_id: Uuid,
) -> Result<(), AppError> {
    let row = infrastructure::ga_contract_on(&state.db, contract_id, today(state)).await?;
    principal.may_touch_coverage(
        row.site_id.as_deref(),
        row.site_scope.as_deref(),
        "contract",
    )
}

pub async fn add_contract_cover(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(contract_id): Path<Uuid>,
    Json(request): Json<AddGaContractCoverRequest>,
) -> Result<Json<GaContractHub>, AppError> {
    allowed(&principal, Role::Supervisor, "put an asset on a contract")?;
    may_touch_contract(&state, &principal, contract_id).await?;
    let site = infrastructure::ga_asset_site(&state.db, request.asset_id).await?;
    principal.may_touch_site(Some(&site), "asset")?;
    Ok(Json(
        infrastructure::ga_contract_cover_add(
            &state.db,
            contract_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn remove_contract_cover(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((contract_id, asset_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<RemoveGaContractCoverRequest>,
) -> Result<Json<GaContractHub>, AppError> {
    allowed(&principal, Role::Supervisor, "take an asset off a contract")?;
    may_touch_contract(&state, &principal, contract_id).await?;
    Ok(Json(
        infrastructure::ga_contract_cover_remove(
            &state.db,
            contract_id,
            asset_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

// ── insurance claims (0975) ─────────────────────────────────────────────

/// The claims of a policy (`contract`), an asset (`asset`) or a site (`site`).
pub async fn claims(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Vec<GaInsuranceClaimRow>>, AppError> {
    allowed(&principal, Role::Supervisor, "read insurance claims")?;
    refuse_unknown_parameters(&params, &["contract", "asset", "site", "limit"])?;
    let asset_id = uuid_param(&params, "asset")?;
    if let Some(asset_id) = asset_id {
        let site = infrastructure::ga_asset_site(&state.db, asset_id).await?;
        principal.may_touch_site(Some(&site), "asset")?;
    }
    let asked: Vec<String> = single_value(&params, "site").into_iter().collect();
    let site_id = principal.site_filter(asked)?.into_iter().next();
    Ok(Json(
        infrastructure::ga_claims(
            &state.db,
            &GaInsuranceClaimScope {
                contract_id: uuid_param(&params, "contract")?,
                asset_id,
                site_id,
                limit: limit_value(&params)?.unwrap_or(DEFAULT_GA_CLAIM_LIMIT),
            },
        )
        .await?,
    ))
}

async fn claim_at_my_site(
    state: &AppState,
    principal: &Principal,
    claim_id: Uuid,
) -> Result<(), AppError> {
    let site = infrastructure::ga_claim_site(&state.db, claim_id).await?;
    principal.may_touch_site(Some(&site), "insurance claim")
}

pub async fn claim(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
) -> Result<Json<GaInsuranceClaimRow>, AppError> {
    allowed(&principal, Role::Supervisor, "read an insurance claim")?;
    claim_at_my_site(&state, &principal, claim_id).await?;
    Ok(Json(infrastructure::ga_claim(&state.db, claim_id).await?))
}

pub async fn record_claim(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordGaInsuranceClaimRequest>,
) -> Result<Json<GaInsuranceClaimRow>, AppError> {
    allowed(&principal, Role::Supervisor, "report an insurance claim")?;
    match request.asset_id {
        Some(asset_id) => {
            let site = infrastructure::ga_asset_site(&state.db, asset_id).await?;
            principal.may_touch_site(Some(&site), "asset")?;
        }
        None => may_touch_contract(&state, &principal, request.contract_id).await?,
    }
    let row =
        infrastructure::ga_claim_record(&state.db, &request, &principal.username, today(&state))
            .await?;
    Ok(Json(row))
}

pub async fn submit_claim(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(request): Json<SubmitGaInsuranceClaimRequest>,
) -> Result<Json<GaInsuranceClaimRow>, AppError> {
    allowed(&principal, Role::Supervisor, "submit an insurance claim")?;
    claim_at_my_site(&state, &principal, claim_id).await?;
    Ok(Json(
        infrastructure::ga_claim_submit(
            &state.db,
            claim_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn survey_claim(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(request): Json<SurveyGaInsuranceClaimRequest>,
) -> Result<Json<GaInsuranceClaimRow>, AppError> {
    allowed(&principal, Role::Supervisor, "record a claim's survey")?;
    claim_at_my_site(&state, &principal, claim_id).await?;
    Ok(Json(
        infrastructure::ga_claim_survey(
            &state.db,
            claim_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn approve_claim(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(request): Json<ApproveGaInsuranceClaimRequest>,
) -> Result<Json<GaInsuranceClaimRow>, AppError> {
    allowed(&principal, Role::Supervisor, "record a claim's approval")?;
    claim_at_my_site(&state, &principal, claim_id).await?;
    Ok(Json(
        infrastructure::ga_claim_approve(
            &state.db,
            claim_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn reject_claim(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(request): Json<RejectGaInsuranceClaimRequest>,
) -> Result<Json<GaInsuranceClaimRow>, AppError> {
    allowed(&principal, Role::Supervisor, "record a claim's rejection")?;
    claim_at_my_site(&state, &principal, claim_id).await?;
    Ok(Json(
        infrastructure::ga_claim_reject(
            &state.db,
            claim_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn pay_claim(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(request): Json<PayGaInsuranceClaimRequest>,
) -> Result<Json<GaInsuranceClaimRow>, AppError> {
    allowed(&principal, Role::Supervisor, "record a claim's payment")?;
    claim_at_my_site(&state, &principal, claim_id).await?;
    Ok(Json(
        infrastructure::ga_claim_pay(
            &state.db,
            claim_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn link_claim_repair(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(request): Json<LinkGaClaimRepairRequest>,
) -> Result<Json<GaInsuranceClaimRow>, AppError> {
    allowed(&principal, Role::Supervisor, "name a claim's repair")?;
    claim_at_my_site(&state, &principal, claim_id).await?;
    Ok(Json(
        infrastructure::ga_claim_link_repair(&state.db, claim_id, &request, &principal.username)
            .await?,
    ))
}

// ── odometer readings (0975) ────────────────────────────────────────────

pub async fn odometer_readings(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(asset_id): Path<Uuid>,
) -> Result<Json<Vec<GaOdometerReading>>, AppError> {
    allowed(&principal, Role::Supervisor, "read a vehicle's odometer")?;
    let site = infrastructure::ga_asset_site(&state.db, asset_id).await?;
    principal.may_touch_site(Some(&site), "asset")?;
    Ok(Json(
        infrastructure::ga_odometer_readings(&state.db, asset_id).await?,
    ))
}

pub async fn record_odometer_reading(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(asset_id): Path<Uuid>,
    Json(request): Json<RecordGaOdometerReadingRequest>,
) -> Result<Json<Vec<GaOdometerReading>>, AppError> {
    allowed(&principal, Role::Supervisor, "record an odometer reading")?;
    let site = infrastructure::ga_asset_site(&state.db, asset_id).await?;
    principal.may_touch_site(Some(&site), "asset")?;
    Ok(Json(
        infrastructure::ga_odometer_record(
            &state.db,
            asset_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn remove_odometer_reading(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(reading_id): Path<Uuid>,
) -> Result<Json<Vec<GaOdometerReading>>, AppError> {
    allowed(&principal, Role::Supervisor, "remove an odometer reading")?;
    let asset_id = infrastructure::ga_odometer_reading_asset(&state.db, reading_id).await?;
    let site = infrastructure::ga_asset_site(&state.db, asset_id).await?;
    principal.may_touch_site(Some(&site), "asset")?;
    Ok(Json(
        infrastructure::ga_odometer_remove(&state.db, reading_id).await?,
    ))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/ga/papers", get(papers).post(record_paper))
        .route("/api/v1/ga/papers/{document_id}", get(paper))
        .route("/api/v1/ga/papers/{document_id}/scan", post(attach_scan))
        .route(
            "/api/v1/ga/papers/{document_id}/originals",
            post(register_original),
        )
        .route("/api/v1/ga/originals", get(originals))
        .route("/api/v1/ga/originals/{original_id}", get(original))
        .route(
            "/api/v1/ga/originals/{original_id}/release",
            post(release_original),
        )
        .route(
            "/api/v1/ga/originals/{original_id}/return",
            post(return_original),
        )
        .route(
            "/api/v1/ga/operating-expenses",
            get(operating_expenses).post(record_operating_expense),
        )
        .route(
            "/api/v1/ga/operating-expenses/{expense_id}/submit",
            post(submit_operating_expense),
        )
        .route(
            "/api/v1/ga/operating-expenses/{expense_id}/link",
            post(link_operating_expense),
        )
        .route(
            "/api/v1/ga/operating-expenses/{expense_id}/cancel",
            post(cancel_operating_expense),
        )
        .route(
            "/api/v1/ga/contracts/{contract_id}/assets",
            post(add_contract_cover),
        )
        .route(
            "/api/v1/ga/contracts/{contract_id}/assets/{asset_id}/remove",
            post(remove_contract_cover),
        )
        .route("/api/v1/ga/claims", get(claims).post(record_claim))
        .route("/api/v1/ga/claims/{claim_id}", get(claim))
        .route("/api/v1/ga/claims/{claim_id}/submit", post(submit_claim))
        .route("/api/v1/ga/claims/{claim_id}/survey", post(survey_claim))
        .route("/api/v1/ga/claims/{claim_id}/approve", post(approve_claim))
        .route("/api/v1/ga/claims/{claim_id}/reject", post(reject_claim))
        .route("/api/v1/ga/claims/{claim_id}/pay", post(pay_claim))
        .route(
            "/api/v1/ga/claims/{claim_id}/repair",
            post(link_claim_repair),
        )
        .route(
            "/api/v1/ga/assets/{asset_id}/odometer",
            get(odometer_readings).post(record_odometer_reading),
        )
        .route(
            "/api/v1/ga/odometer-readings/{reading_id}",
            delete(remove_odometer_reading),
        )
}
