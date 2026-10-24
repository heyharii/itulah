//! The employee benefit balance (0818): HR's hand, the employee's code, the
//! till's spend and return.

use super::auth::Principal;
use super::employment::{reach_of, resolve};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{actions, required_role_for_action, role_allows, Authorization, Reach},
    postgres::{
        self as infrastructure, BenefitAccountView, BenefitBalanceRow, BenefitCodeView,
        BenefitHolderView, BenefitKey, BenefitMovementRow, BenefitSettingView,
    },
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;

fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

fn sign(principal: &Principal, action_key: &str, reason: &str) -> Result<Authorization, AppError> {
    Authorization::try_new(&principal.username, action_key, Utc::now(), reason)
        .map_err(|error| AppError::Validation(error.to_string()))
}

// ── head office ─────────────────────────────────────────────────────────

pub async fn balances(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<BenefitBalanceRow>>, AppError> {
    require(&principal, actions::BENEFIT_MANAGE)?;
    Ok(Json(infrastructure::benefit_balances(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MovementsQuery {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub unit: Option<String>,
}

/// Every balance's movements, newest first — Benefits › History. Bounded by
/// the caller's reach like the rest of HR: a caller posted at one unit reads
/// that unit's people, and asking for another is refused.
pub async fn movements(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<MovementsQuery>,
) -> Result<Json<Vec<BenefitMovementRow>>, AppError> {
    require(&principal, actions::BENEFIT_MANAGE)?;
    let asked = query
        .unit
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty());
    let unit = match (reach_of(&state, &principal).await?, asked) {
        (Reach::Nowhere, _) => return Ok(Json(Vec::new())),
        (reach, Some(unit)) => {
            if !reach.covers(Some(unit)) {
                return Err(AppError::Forbidden(format!(
                    "{} is not posted anywhere that reaches {unit}",
                    principal.username
                )));
            }
            Some(unit.to_owned())
        }
        (Reach::Only(own), None) => Some(own.as_str().to_owned()),
        (Reach::Everywhere, None) => None,
    };
    Ok(Json(
        infrastructure::benefit_movements(&state.db, query.from, query.to, unit.as_deref()).await?,
    ))
}

/// One person's balance and its history. `me` reads one's own.
pub async fn account(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<BenefitAccountView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    if !access.own {
        require(&principal, actions::BENEFIT_MANAGE)?;
    }
    Ok(Json(
        infrastructure::benefit_account(&state.db, &access.employee_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AdjustBenefitBody {
    /// `ADD`, `REMOVE` or `RESET`.
    pub action: String,
    /// What to add or take off; for a reset, the figure it becomes.
    pub amount_minor: i64,
    /// Everybody named here, the same act for each. One id is one person.
    pub employee_ids: Vec<String>,
    pub reason: String,
}

/// Fill, take off or reset one balance or many, in one act per person.
pub async fn adjust(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<AdjustBenefitBody>,
) -> Result<Json<Vec<BenefitBalanceRow>>, AppError> {
    require(&principal, actions::BENEFIT_MANAGE)?;
    if body.employee_ids.is_empty() {
        return Err(AppError::Validation("name at least one employee".into()));
    }
    let by = sign(&principal, actions::BENEFIT_MANAGE, &body.reason)?;
    for employee_id in &body.employee_ids {
        infrastructure::adjust_benefit(
            &state.db,
            employee_id,
            body.action.trim(),
            body.amount_minor,
            &by,
        )
        .await?;
    }
    Ok(Json(infrastructure::benefit_balances(&state.db).await?))
}

pub async fn settings(
    State(state): State<AppState>,
) -> Result<Json<Vec<BenefitSettingView>>, AppError> {
    Ok(Json(infrastructure::benefit_settings(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitSettingBody {
    pub effective_from: NaiveDate,
    pub enabled: bool,
    pub code_minutes: i32,
    pub reason: String,
}

pub async fn state_settings(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<BenefitSettingBody>,
) -> Result<Json<Vec<BenefitSettingView>>, AppError> {
    require(&principal, actions::BENEFIT_MANAGE)?;
    let by = sign(&principal, actions::BENEFIT_MANAGE, &body.reason)?;
    infrastructure::state_benefit_setting(
        &state.db,
        body.effective_from,
        body.enabled,
        body.code_minutes,
        &by,
    )
    .await?;
    Ok(Json(infrastructure::benefit_settings(&state.db).await?))
}

// ── the employee ────────────────────────────────────────────────────────

/// A fresh code to show at the till — one's own, through `me`.
pub async fn code(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<BenefitCodeView>, AppError> {
    if raw != "me" {
        return Err(AppError::Forbidden(
            "a benefit code is asked for by its owner, from their own app".into(),
        ));
    }
    require(&principal, actions::BENEFIT_CODE_OWN)?;
    let access = resolve(&state, &principal, &raw).await?;
    Ok(Json(
        infrastructure::issue_benefit_code(&state.db, &access.employee_id).await?,
    ))
}

// ── the till ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitLookupBody {
    pub code: String,
}

/// Whose code this is and what is left, before the cashier decides how much
/// of the basket it pays. Does not use the code up.
pub async fn lookup(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<BenefitLookupBody>,
) -> Result<Json<BenefitHolderView>, AppError> {
    require(&principal, actions::BENEFIT_REDEEM)?;
    Ok(Json(
        infrastructure::benefit_holder(&state.db, &body.code).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitSpendBody {
    pub code: String,
    /// The till's own id for the sale; a second spend for it is refused.
    pub sale_ref: String,
    pub unit_id: String,
    pub amount_minor: i64,
    /// Whether any line of the basket is on a promotion — the benefit does
    /// not combine with one.
    #[serde(default)]
    pub basket_has_promotion: bool,
}

pub async fn spend(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<BenefitSpendBody>,
) -> Result<Json<BenefitHolderView>, AppError> {
    require(&principal, actions::BENEFIT_REDEEM)?;
    let cashier = infrastructure::caller_record(&state.db, &principal.username)
        .await?
        .employee_id;
    let by = sign(
        &principal,
        actions::BENEFIT_REDEEM,
        &format!("benefit spent on sale {}", body.sale_ref.trim()),
    )?;
    Ok(Json(
        infrastructure::spend_benefit(
            &state.db,
            BenefitKey::Code(&body.code),
            &body.sale_ref,
            body.unit_id.trim(),
            body.amount_minor,
            body.basket_has_promotion,
            cashier.as_deref(),
            &by,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BenefitReturnBody {
    pub sale_ref: String,
    pub amount_minor: i64,
    pub reason: String,
}

pub async fn give_back(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<BenefitReturnBody>,
) -> Result<Json<i64>, AppError> {
    require(&principal, actions::BENEFIT_REDEEM)?;
    let by = sign(&principal, actions::BENEFIT_REDEEM, &body.reason)?;
    Ok(Json(
        infrastructure::return_benefit(&state.db, &body.sale_ref, body.amount_minor, &by).await?,
    ))
}

// ── the till, through its own node ──────────────────────────────────────
//
// A counter has no session to hold an employee's balance against, only a
// node proving which shop it is — the same shape and the same reason as the
// voucher and points relays (`/api/v1/sync/vouchers/…`): guarded per origin
// by `x-sync-key`, the shop taken from the register, the cashier's name from
// the node that signed them in. The balance lives centrally, so a shop that
// cannot reach head office cannot spend it — the owner's rule.

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelayBenefitRequest {
    /// The origin that is asking. Proved against its own key, never trusted.
    pub origin_id: String,
    /// The shop the relay believes it is; checked against the register.
    #[serde(default)]
    pub site_id: Option<String>,
    /// The cashier, as the shop's own node signed them in.
    pub actor_id: String,
    #[serde(default)]
    pub code: Option<String>,
    /// The till's own id for the basket — the checkout the spend pays.
    #[serde(default)]
    pub sale_ref: Option<String>,
    #[serde(default)]
    pub amount_minor: Option<i64>,
    #[serde(default)]
    pub basket_has_promotion: bool,
    #[serde(default)]
    pub reason: Option<String>,
    /// Instead of a code: the login whose finger this node's till matched
    /// (client, 24 Oct 2026). The node spent its own one-shot grant for that
    /// finger before relaying; here the person is believed only if the cloud
    /// assigns them to this very node (`benefit_employee_at_origin`).
    #[serde(default)]
    pub holder: Option<String>,
}

/// The origin that is asking, proved by its key, and the shop it speaks for.
async fn relay_origin_site(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    request: &RelayBenefitRequest,
) -> Result<(String, String), AppError> {
    let origin = super::authenticate_origin(state, headers, &request.origin_id).await?;
    let stamped = request
        .site_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let site = match (origin.site_id, stamped) {
        (Some(registered), Some(claimed)) if registered != claimed => {
            return Err(AppError::Forbidden(format!(
                "origin {} speaks for {registered}, not {claimed}",
                origin.origin_id
            )))
        }
        (Some(registered), _) => registered,
        (None, Some(claimed)) => claimed.to_owned(),
        (None, None) => {
            return Err(AppError::Validation(
                "a benefit call has to say which shop it is for".into(),
            ))
        }
    };
    Ok((origin.origin_id, site))
}

/// The employee a relayed call names by finger, when it names one.
async fn relay_holder(
    state: &AppState,
    origin_id: &str,
    request: &RelayBenefitRequest,
) -> Result<Option<String>, AppError> {
    let Some(holder) = request
        .holder
        .as_deref()
        .map(str::trim)
        .filter(|holder| !holder.is_empty())
    else {
        return Ok(None);
    };
    if request
        .code
        .as_deref()
        .is_some_and(|code| !code.trim().is_empty())
    {
        return Err(AppError::Validation(
            "a benefit call names a code or a finger, not both".into(),
        ));
    }
    Ok(Some(
        infrastructure::benefit_employee_at_origin(&state.db, origin_id, holder).await?,
    ))
}

fn relay_by(request: &RelayBenefitRequest, reason: &str) -> Result<Authorization, AppError> {
    let actor = request.actor_id.trim();
    if actor.is_empty() {
        return Err(AppError::Validation(
            "a benefit call has to be attributable to a cashier".into(),
        ));
    }
    Authorization::try_new(actor, actions::BENEFIT_REDEEM, Utc::now(), reason)
        .map_err(|error| AppError::Validation(error.to_string()))
}

fn relay_code(request: &RelayBenefitRequest) -> Result<&str, AppError> {
    request
        .code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .ok_or_else(|| AppError::Validation("the employee's code is missing".into()))
}

pub async fn sync_lookup(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<RelayBenefitRequest>,
) -> Result<Json<BenefitHolderView>, AppError> {
    let (origin, _) = relay_origin_site(&state, &headers, &request).await?;
    let fingered = relay_holder(&state, &origin, &request).await?;
    let key = match fingered.as_deref() {
        Some(employee_id) => BenefitKey::Employee(employee_id),
        None => BenefitKey::Code(relay_code(&request)?),
    };
    Ok(Json(
        infrastructure::benefit_holder_by(&state.db, key).await?,
    ))
}

pub async fn sync_spend(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<RelayBenefitRequest>,
) -> Result<Json<BenefitHolderView>, AppError> {
    let (origin, site) = relay_origin_site(&state, &headers, &request).await?;
    let fingered = relay_holder(&state, &origin, &request).await?;
    let unit = infrastructure::sites::unit_of_site(&state.db, &site).await?;
    let sale_ref = request
        .sale_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Validation("a spend names the basket it pays".into()))?;
    // The cashier's own record, when their login is bound to one: nobody
    // rings up their own balance.
    let cashier: Option<String> =
        sqlx::query_scalar("SELECT employee_id FROM app_user WHERE username = $1")
            .bind(request.actor_id.trim())
            .fetch_optional(&state.db)
            .await?
            .flatten();
    let key = match fingered.as_deref() {
        Some(employee_id) => BenefitKey::Employee(employee_id),
        None => BenefitKey::Code(relay_code(&request)?),
    };
    let how = if fingered.is_some() { " by finger" } else { "" };
    let by = relay_by(&request, &format!("benefit spent on {sale_ref}{how}"))?;
    Ok(Json(
        infrastructure::spend_benefit(
            &state.db,
            key,
            sale_ref,
            &unit,
            request.amount_minor.unwrap_or(0),
            request.basket_has_promotion,
            cashier.as_deref(),
            &by,
        )
        .await?,
    ))
}

pub async fn sync_return(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<RelayBenefitRequest>,
) -> Result<Json<i64>, AppError> {
    relay_origin_site(&state, &headers, &request).await?;
    let sale_ref = request
        .sale_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Validation("a return names the basket it gives back".into()))?;
    let reason = request
        .reason
        .clone()
        .filter(|reason| !reason.trim().is_empty())
        .unwrap_or_else(|| format!("benefit given back on {sale_ref}"));
    let by = relay_by(&request, &reason)?;
    Ok(Json(
        infrastructure::return_benefit(&state.db, sale_ref, request.amount_minor.unwrap_or(0), &by)
            .await?,
    ))
}
