//! The campaign routes that are not pricing.
//!
//! Everything under `/commercial/campaigns/{id}` in `mod.rs` either reads a
//! published book or pulls the one lever a published book leaves moveable.
//! These do neither: they read and write what the centre knows about a campaign
//! as a business initiative — what it runs, where it was declared to run, the
//! lines it must not cross, and how it is doing against the campaign it was
//! meant to beat. Nothing here reaches a till, and nothing here can change a
//! price.
//!
//! They fall through `required_role` to SUPERVISOR on every write and CASHIER
//! on every read, with the rest of Commercial, and that is the right rung:
//! declaring what a campaign is for is a merchandiser's act, and the one write
//! that can stop a campaign — the guardrail check — stops it through
//! `switch_campaign`, which is Supervisor already.
//!
//! The actor comes from the session on every write and is never in a body. Who
//! declared a reach and who acknowledged a breach are the two facts a
//! post-mortem turns on, and a self-reported actor is how an audit trail
//! becomes fiction.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, CampaignActivityInput, CampaignActivityRow, CampaignBreachRow,
        CampaignOutcomeView, CampaignPlanInput, CampaignPlanView, CampaignTargetInput,
        GuardrailCheckReport,
    },
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

/// What the campaign declares, and where that disagrees with its book.
pub async fn campaign_plan(
    State(state): State<AppState>,
    Path(campaign_id): Path<String>,
) -> Result<Json<CampaignPlanView>, AppError> {
    Ok(Json(
        infrastructure::campaign_plan(&state.db, &campaign_id).await?,
    ))
}

/// Restate the reach and the rails, whole.
pub async fn save_campaign_plan(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(campaign_id): Path<String>,
    Json(request): Json<CampaignPlanInput>,
) -> Result<Json<CampaignPlanView>, AppError> {
    Ok(Json(
        infrastructure::save_campaign_plan(&state.db, &campaign_id, request, &principal.username)
            .await?,
    ))
}

/// Add something the campaign runs, or restate it.
///
/// The activity id is in the path rather than minted here, so a retried request
/// writes one poster and not two.
pub async fn save_campaign_activity(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((campaign_id, activity_id)): Path<(String, Uuid)>,
    Json(request): Json<CampaignActivityInput>,
) -> Result<Json<CampaignActivityRow>, AppError> {
    Ok(Json(
        infrastructure::save_campaign_activity(
            &state.db,
            &campaign_id,
            activity_id,
            request,
            &principal.username,
        )
        .await?,
    ))
}

/// It was never part of the campaign.
///
/// Not the same act as marking it DROPPED, which says it was planned and did
/// not run — that belongs in the report and stays in the table.
pub async fn delete_campaign_activity(
    State(state): State<AppState>,
    Path((campaign_id, activity_id)): Path<(String, Uuid)>,
) -> Result<Json<Value>, AppError> {
    let gone =
        infrastructure::delete_campaign_activity(&state.db, &campaign_id, activity_id).await?;
    Ok(Json(json!({ "deleted": gone })))
}

/// Which shop the outcome is asked about, when it is asked about one.
#[derive(Debug, Deserialize)]
pub struct OutcomeQuery {
    /// Absent for the whole fleet. There is deliberately no `from` or `to`: the
    /// window of this read is the CAMPAIGN'S OWN, and a caller that could
    /// override it would be able to score Lebaran over the last thirty days —
    /// which reports every finished campaign as a failure the month after it
    /// ended.
    #[serde(default)]
    pub site_id: Option<String>,
}

/// One campaign, scored: what it did, against what it was for, against the
/// campaign it was meant to beat.
pub async fn campaign_outcome(
    State(state): State<AppState>,
    Path(campaign_id): Path<String>,
    Query(query): Query<OutcomeQuery>,
) -> Result<Json<CampaignOutcomeView>, AppError> {
    let site = query
        .site_id
        .as_deref()
        .map(str::trim)
        .filter(|one| !one.is_empty());
    Ok(Json(
        infrastructure::campaign_outcome(&state.db, &campaign_id, site).await?,
    ))
}

/// Say what the line is measured against: a total, a rate per day, a band, or
/// the campaign named as precedent.
pub async fn save_campaign_target(
    State(state): State<AppState>,
    Path(campaign_id): Path<String>,
    Json(request): Json<CampaignTargetInput>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::save_campaign_target(&state.db, &campaign_id, request).await?,
    ))
}

/// Measure every rail now, record what has been crossed, and stop the campaign
/// where a rail says to.
///
/// A POST because it writes: a breach is an observation, and observing one is
/// the act that can pause a campaign across thirteen shops.
pub async fn check_campaign_guardrails(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(campaign_id): Path<String>,
) -> Result<Json<GuardrailCheckReport>, AppError> {
    Ok(Json(
        infrastructure::check_campaign_guardrails(&state.db, &campaign_id, &principal.username)
            .await?,
    ))
}

/// Somebody has seen the crossing and taken responsibility for it.
///
/// Closing it is what lets the next one be recorded — one open breach per rail
/// is what stops an hourly check turning one event into a hundred rows.
pub async fn acknowledge_campaign_breach(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((campaign_id, breach_id)): Path<(String, Uuid)>,
) -> Result<Json<CampaignBreachRow>, AppError> {
    Ok(Json(
        infrastructure::acknowledge_campaign_breach(
            &state.db,
            &campaign_id,
            breach_id,
            &principal.username,
        )
        .await?,
    ))
}
