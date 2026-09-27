//! Flow templates and flow documents on the wire: the hub's "Alur barang".
//!
//! # Templates — Admin's
//!
//! Reading a template is anybody's: the picker is asked to follow one, and a
//! template kept from the people it governs is a trap. Writing one — a new
//! template, a new version, retiring one, choosing a route's default — is
//! head office's administrator's, at the path (`required_role`) and again
//! here, because a template decides who may send goods where.
//!
//! `POST /flow-templates/validate` answers every problem in a draft with the
//! stage row it belongs to, and writes nothing: the editor calls it as the
//! author types, so a broken invariant is shown beside the row that breaks
//! it rather than after a failed save.
//!
//! # Documents — whoever the template names
//!
//! The path lets any signed-in operator through (`required_role` answers
//! Cashier for `/api/v1/flows` writes), because who may act is not a
//! property of the path: it is the template's. Starting needs one of the
//! version's starter roles; each stage needs its performer's role. Both are
//! checked by the flow itself (`domain::flow`), against the caller's rung.
//!
//! Preview writes nothing. Confirm applies the actions for one stage once.
//! Resume finishes a parked stage by its key, `<document>:<STAGE_KIND>`.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        flow::{
            self, Actor, FlowActionInput, FlowRole, FlowTemplateDraft, PartyKind, PoolRole,
            ProofKind, RouteEnd, StageCatalogueEntry, TemplateProblem,
        },
        Role,
    },
    postgres::{
        flow_stages::{self, StageDelegate},
        flows::{
            self as store, ConfirmFlowRequest, FlowDocumentFilter, FlowDocumentSummary,
            FlowDocumentView, FlowPreviewView, FlowTemplateDetail, FlowTemplateFilter,
            FlowTemplatePatch, FlowTemplateSummary, ResumeFlowRequest, StartFlowRequest,
        },
    },
};
use crate::ids::SiteKind;
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

fn actor_of(principal: &Principal) -> Actor {
    Actor {
        id: principal.username.clone(),
        rung: principal.role,
    }
}

/// Templates are head office's to write. Checked here as well as at the
/// path, so a `role_permission` override that lowered the path's rung
/// (0472) cannot hand the template editor to a shop.
fn require_admin(principal: &Principal, what: &str) -> Result<(), AppError> {
    if principal.role >= Role::Admin {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {what}: flow templates are head office's (Admin)",
        principal.username
    )))
}

/// One choice in a closed vocabulary, as the editor offers it.
#[derive(Debug, Serialize)]
pub struct FlowChoice {
    pub code: &'static str,
    pub label: &'static str,
    /// For a role: where the person works (`HO`, `STORE`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub works_at: Option<&'static str>,
    /// For a role: the lowest rung that may act in it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_role: Option<&'static str>,
}

/// Everything the editor draws from: the stage catalogue (fixed in code),
/// where each stage's work is done today, and the closed lists a template
/// chooses among.
#[derive(Debug, Serialize)]
pub struct FlowVocabulary {
    pub stages: Vec<StageCatalogueEntry>,
    pub delegates: Vec<StageDelegate>,
    pub roles: Vec<FlowChoice>,
    pub proofs: Vec<FlowChoice>,
    pub pool_roles: Vec<FlowChoice>,
    pub route_ends: Vec<FlowChoice>,
}

pub async fn catalogue() -> Json<FlowVocabulary> {
    let route_ends = [
        RouteEnd::Site(SiteKind::HeadOffice),
        RouteEnd::Site(SiteKind::Store),
        RouteEnd::Party(PartyKind::Supplier),
        RouteEnd::Party(PartyKind::Customer),
    ];
    Json(FlowVocabulary {
        stages: flow::stage_catalogue_entries(),
        delegates: flow_stages::stage_delegates(),
        roles: FlowRole::ALL
            .into_iter()
            .map(|role| FlowChoice {
                code: role.code(),
                label: role.label(),
                works_at: Some(role.works_at().code()),
                min_role: Some(role.min_role().as_str()),
            })
            .collect(),
        proofs: ProofKind::ALL
            .into_iter()
            .map(|proof| FlowChoice {
                code: proof.code(),
                label: proof.label(),
                works_at: None,
                min_role: None,
            })
            .collect(),
        pool_roles: PoolRole::ALL
            .into_iter()
            .map(|pool| FlowChoice {
                code: pool.code(),
                label: pool.label(),
                works_at: None,
                min_role: None,
            })
            .collect(),
        route_ends: route_ends
            .into_iter()
            .map(|end| FlowChoice {
                code: end.code(),
                label: end.label(),
                works_at: None,
                min_role: None,
            })
            .collect(),
    })
}

/// Templates, by route when asked: `?origin=HO&destination=STORE`.
pub async fn list_templates(
    State(state): State<AppState>,
    Query(filter): Query<FlowTemplateFilter>,
) -> Result<Json<Vec<FlowTemplateSummary>>, AppError> {
    Ok(Json(store::list_flow_templates(&state.db, &filter).await?))
}

pub async fn template_detail(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<FlowTemplateDetail>, AppError> {
    Ok(Json(store::flow_template_detail(&state.db, id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateTemplateBody {
    pub template: FlowTemplateDraft,
    /// Make it the template its route's creation paths pick.
    #[serde(default)]
    pub make_default: bool,
}

pub async fn create_template(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<CreateTemplateBody>,
) -> Result<Json<FlowTemplateDetail>, AppError> {
    require_admin(&principal, "create a flow template")?;
    Ok(Json(
        store::create_flow_template(
            &state.db,
            &body.template,
            body.make_default,
            &principal.username,
            state.clock.now(),
        )
        .await?,
    ))
}

fn yes() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveVersionBody {
    pub template: FlowTemplateDraft,
    /// Make the new version the one documents start on. True unless the
    /// author is saving a draft to come back to.
    #[serde(default = "yes")]
    pub activate: bool,
}

pub async fn save_version(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(body): Json<SaveVersionBody>,
) -> Result<Json<FlowTemplateDetail>, AppError> {
    require_admin(&principal, "save a flow template version")?;
    Ok(Json(
        store::save_flow_template_version(
            &state.db,
            id,
            &body.template,
            body.activate,
            &principal.username,
            state.clock.now(),
        )
        .await?,
    ))
}

pub async fn update_template(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(patch): Json<FlowTemplatePatch>,
) -> Result<Json<FlowTemplateDetail>, AppError> {
    require_admin(&principal, "change a flow template")?;
    Ok(Json(
        store::update_flow_template(
            &state.db,
            id,
            &patch,
            &principal.username,
            state.clock.now(),
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ValidateBody {
    pub template: FlowTemplateDraft,
    /// The template a new version is for; absent for a new template.
    #[serde(default)]
    pub template_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct ValidateAnswer {
    pub valid: bool,
    pub problems: Vec<TemplateProblem>,
}

/// Every problem in a draft, each placed on its stage row. Writes nothing.
pub async fn validate_template(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<ValidateBody>,
) -> Result<Json<ValidateAnswer>, AppError> {
    require_admin(&principal, "check a flow template")?;
    let problems =
        store::validate_flow_template(&state.db, &body.template, body.template_id).await?;
    Ok(Json(ValidateAnswer {
        valid: problems.is_empty(),
        problems,
    }))
}

pub async fn list_documents(
    State(state): State<AppState>,
    Query(filter): Query<FlowDocumentFilter>,
) -> Result<Json<Vec<FlowDocumentSummary>>, AppError> {
    Ok(Json(store::list_flow_documents(&state.db, &filter).await?))
}

/// Start a document on a template's current version. The caller names the
/// role they start it in, which has to be one of the version's starters and
/// one their rung holds.
pub async fn start_document(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<StartFlowRequest>,
) -> Result<Json<FlowDocumentView>, AppError> {
    Ok(Json(
        store::start_flow_document(&state.db, &request, &actor_of(&principal), state.clock.now())
            .await?,
    ))
}

pub async fn document_detail(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<FlowDocumentView>, AppError> {
    Ok(Json(
        store::flow_document_detail(&state.db, id, &actor_of(&principal)).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewBody {
    pub actions: Vec<FlowActionInput>,
}

/// What these actions would do, replayed in memory. Writes nothing.
pub async fn preview_actions(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(body): Json<PreviewBody>,
) -> Result<Json<FlowPreviewView>, AppError> {
    Ok(Json(
        store::preview_flow_actions(&state.db, id, &body.actions, &actor_of(&principal)).await?,
    ))
}

/// Apply the actions for one stage, once, in one transaction.
pub async fn confirm_actions(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<ConfirmFlowRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        store::confirm_flow_actions(
            &state.db,
            id,
            &request,
            &actor_of(&principal),
            state.clock.now(),
        )
        .await?,
    ))
}

/// Finish a parked stage by its key. A stage already done answers as it
/// stands.
pub async fn resume_stage(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ResumeFlowRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        store::resume_parked_stage(&state.db, &request, &actor_of(&principal), state.clock.now())
            .await?,
    ))
}
