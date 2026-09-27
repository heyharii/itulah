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
//!
//! # The register, and why there is no DELETE
//!
//! The asset routes below are GA's half of `fixed_asset` — where a thing is,
//! who holds it, what condition it is in, what happened to it. There is no
//! route that removes one: an asset the books bought is taken off the register
//! by DISPOSING of it, which is a Finance act with a date, a reason and an
//! entry, and an asset nobody ever bought is corrected in the database by an
//! operator looking at it. A delete route would be the one way a thing could
//! leave the register with no record of having been there (brief §12).

use super::auth::Principal;
use super::{facet_values, limit_value, refuse_unknown_parameters, single_value};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, GaBuildSchema, Role},
    postgres::{
        self as infrastructure, AccountSuggestion, ApproveGaRepairRequest, ArchiveGaContractRequest,
        DecideGaDisposalRequest, GaAssetEvent, GaAssetHub, GaAssetPage, GaAssetRow, GaAssetScope,
        GaContractHub, GaContractPage, GaContractRow, GaContractType, GaDisposalPage, GaDisposalRow,
        GaInspectionPage, GaInspectionRow, GaLocationHub, GaLocationRow, GaMaintenanceTaskPage,
        GaMaintenanceTaskRow, GaMeterReading, GaOverview, GaRepairObject, GaRepairPage, GaRepairRow,
        GaReplacementPage, GaReplacementRow, GaSupplyCategory, GaSupplyRequestRow, GaSupplyScope,
        LineRefs, MoveGaRepairRequest, MoveGaReplacementRequest, MoveGaSupplyRequestRequest,
        NoteGaAssetRequest, RecordBillLine, RecordBillRequest, RecordGaContractRequest,
        RecordGaInspectionRequest, RecordGaRepairRequest, RecordGaReplacementRequest,
        RecordGaSupplyRequestRequest, RecordGaTaskRequest, RecordMeterReadingRequest,
        RegisterGaAssetRequest, RequestGaDisposalRequest, TransferGaAssetRequest,
        UpdateGaAssetRequest, UpdateGaContractRequest, UpdateGaLocationRequest, UpdateGaRepairRequest,
        UpdateGaTaskRequest, DEFAULT_GA_ASSET_LIMIT, DEFAULT_GA_CONTRACT_LIMIT,
        DEFAULT_GA_MAINTENANCE_LIMIT, DEFAULT_GA_SUPPLY_LIMIT,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, patch, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
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

/// The register as GA reads it: searched, filtered, and counted.
///
/// # Query parameters
///
/// `q` searches the asset number, its name and its serial — the last matters,
/// because somebody standing in front of a machine has the plate in their hand
/// and nothing else. `site`, `class`, `build`, `condition` and `status` filter,
/// each repeatable or comma-separated. `draft=true` keeps only the assets a bill
/// minted and nobody has walked the floor for; `draft=false` drops them.
/// `limit` is the page size and `cursor` the previous page's `next_cursor`.
///
/// Every one of these is a facet the same answer carries, so a filter panel can
/// be drawn from the reply rather than from a second request that might
/// disagree with it.
pub async fn assets(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<GaAssetPage>, AppError> {
    allowed(&principal, Role::Supervisor, "read the asset register")?;
    refuse_unknown_parameters(
        &params,
        &[
            "q",
            "site",
            "class",
            "build",
            "condition",
            "status",
            "draft",
            "cursor",
            "limit",
        ],
    )?;
    // `draft` is a tri-state and not a boolean, because "only the drafts" and
    // "everything except the drafts" are different questions and neither is the
    // default. Sending neither asks for both.
    let draft_only = match single_value(&params, "draft").as_deref() {
        None => None,
        Some("true") => Some(true),
        Some("false") => Some(false),
        Some(other) => {
            return Err(AppError::Validation(format!(
                "draft {other:?} is not an answer; send true or false"
            )))
        }
    };
    let mut page = infrastructure::ga_asset_page(
        &state.db,
        GaAssetScope {
            needle: single_value(&params, "q"),
            sites: principal.site_filter(facet_values(&params, "site"))?,
            classes: facet_values(&params, "class"),
            builds: facet_values(&params, "build"),
            conditions: facet_values(&params, "condition"),
            statuses: facet_values(&params, "status"),
            draft_only,
            cursor: single_value(&params, "cursor"),
            limit: limit_value(&params)?.unwrap_or(DEFAULT_GA_ASSET_LIMIT),
        },
    )
    .await?;
    if let Some(site) = principal.bound_site() {
        // The facets count the SEARCHED set, ignoring the site filter — every
        // shop's assets. A shop's till gets its own site's facet and nothing
        // counted across the estate.
        page.facets.sites.retain(|facet| facet.value == site);
        page.facets.classes.clear();
        page.facets.builds.clear();
        page.facets.conditions.clear();
        page.facets.statuses.clear();
    }
    Ok(Json(page))
}

/// The eleven forms, each with its fields and the classes filed on it.
///
/// One request rather than two, and that is the reason the route exists: the
/// fields are the same table the server validates against, so a form drawn from
/// this answer cannot offer a field [`infrastructure::ga_asset_register`] would
/// refuse — or hide one it would have taken. The classes come with them because
/// four classes are one form, and a class picker that did not know which is
/// which would offer a lift on a vehicle form.
pub async fn asset_builds(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<GaBuildSchema>, AppError> {
    allowed(&principal, Role::Supervisor, "read the asset forms")?;
    Ok(Json(infrastructure::ga_build_schema(&state.db).await?))
}

/// Put a thing in the register.
///
/// The class's form is checked before the row is written, so a wrong key comes
/// back as a sentence naming the field rather than as a constraint name
/// somebody has to look up.
pub async fn register_asset(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RegisterGaAssetRequest>,
) -> Result<Json<GaAssetRow>, AppError> {
    allowed(&principal, Role::Supervisor, "register an asset")?;
    Ok(Json(
        infrastructure::ga_asset_register(&state.db, &request, &principal.username).await?,
    ))
}

/// One thing, its history and the papers filed against it.
///
/// The hub and not just the row, because there is one route and the screen it
/// serves is the one somebody opens after clicking a register row: what the
/// thing is, what has happened to it, and which documents belong to it.
pub async fn asset(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(asset_id): Path<Uuid>,
) -> Result<Json<GaAssetHub>, AppError> {
    allowed(&principal, Role::Supervisor, "read an asset")?;
    let hub = infrastructure::ga_asset_hub(&state.db, asset_id).await?;
    principal.may_touch_site(Some(&hub.asset.site_id), "asset")?;
    Ok(Json(hub))
}

/// Correct what GA knows about a thing.
///
/// A condition that changed and a holder that changed each write their own
/// history row. Moving the thing is NOT this route — see
/// [`transfer_asset`] — and asking to is refused with a sentence saying so.
pub async fn update_asset(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(asset_id): Path<Uuid>,
    Json(request): Json<UpdateGaAssetRequest>,
) -> Result<Json<GaAssetRow>, AppError> {
    allowed(&principal, Role::Supervisor, "correct an asset")?;
    Ok(Json(
        infrastructure::ga_asset_update(&state.db, asset_id, &request, &principal.username).await?,
    ))
}

/// Move a thing: site, sub-location and holder, with the row that says it moved.
pub async fn transfer_asset(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(asset_id): Path<Uuid>,
    Json(request): Json<TransferGaAssetRequest>,
) -> Result<Json<GaAssetRow>, AppError> {
    allowed(&principal, Role::Supervisor, "transfer an asset")?;
    Ok(Json(
        infrastructure::ga_asset_transfer(&state.db, asset_id, &request, &principal.username)
            .await?,
    ))
}

/// Write something down about a thing that changes nothing else.
///
/// `occurred_on` is optional and defaults to the business clock's today: a note
/// is usually written the day the thing happened, and asking for the date every
/// time is how a form filled in tomorrow carries yesterday's date.
pub async fn note_asset(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(asset_id): Path<Uuid>,
    Json(request): Json<NoteGaAssetRequest>,
) -> Result<Json<GaAssetEvent>, AppError> {
    allowed(&principal, Role::Supervisor, "write a note on an asset")?;
    if principal.bound_site().is_some() {
        let asset = infrastructure::ga_asset(&state.db, asset_id).await?;
        principal.may_touch_site(Some(&asset.site_id), "asset")?;
    }
    let occurred_on = request
        .occurred_on
        .unwrap_or_else(|| state.clock.now().date_naive());
    Ok(Json(
        infrastructure::ga_asset_note(
            &state.db,
            asset_id,
            &request.reason,
            occurred_on,
            &principal.username,
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// Contracts — the deals with a window
// ---------------------------------------------------------------------------

/// The register of deals, searched, filtered and counted.
///
/// `q` searches the paper number, the counterparty, the customer number and
/// the supplier's name. `type`, `group`, `site` and `standing` filter, each
/// repeatable or comma-separated; `standing` is the server's own word
/// (BELUM_MULAI, AKTIF, SEGERA_HABIS, HABIS, DIHENTIKAN, DRAFT), because a
/// standing the client computed is a standing that can disagree with the
/// list it filters. `archived` is a tri-state like the register's `draft`:
/// `true` only archived, `false` none, absent both. `limit` caps the answer.
pub async fn contracts(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<GaContractPage>, AppError> {
    allowed(&principal, Role::Supervisor, "read the contract register")?;
    refuse_unknown_parameters(
        &params,
        &["q", "type", "group", "site", "standing", "archived", "limit"],
    )?;
    let archived = match single_value(&params, "archived").as_deref() {
        None => None,
        Some("true") => Some(true),
        Some("false") => Some(false),
        Some(other) => {
            return Err(AppError::Validation(format!(
                "archived {other:?} is not an answer; send true or false"
            )))
        }
    };
    Ok(Json(
        infrastructure::ga_contract_page(
            &state.db,
            infrastructure::GaContractScope {
                needle: single_value(&params, "q"),
                types: facet_values(&params, "type"),
                groups: facet_values(&params, "group"),
                sites: facet_values(&params, "site"),
                standings: facet_values(&params, "standing"),
                archived,
                today: state.clock.now().date_naive(),
                limit: limit_value(&params)?.unwrap_or(DEFAULT_GA_CONTRACT_LIMIT),
            },
        )
        .await?,
    ))
}

/// The seventeen types, with the accounts each resolves to at one site —
/// `?site=` names it, defaulting to the DC, because the account map is per
/// site and a code without a place is a guess.
pub async fn contract_types(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Vec<GaContractType>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the contract types")?;
    refuse_unknown_parameters(&params, &["site"])?;
    // Through a shop's till the accounts are the shop's: its own site, never
    // the DC's default and never another shop's.
    let asked: Vec<String> = single_value(&params, "site").into_iter().collect();
    let site = principal
        .site_filter(asked)?
        .into_iter()
        .next()
        .unwrap_or_else(|| "dc".into());
    Ok(Json(infrastructure::ga_contract_types(&state.db, &site).await?))
}

/// Put a deal in the register. Starts DRAFT; a deal is ACTIVE when somebody
/// says the paper is signed and running.
pub async fn record_contract(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordGaContractRequest>,
) -> Result<Json<GaContractRow>, AppError> {
    allowed(&principal, Role::Supervisor, "record a contract")?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::ga_contract_record(&state.db, &request, &principal.username, today)
            .await?,
    ))
}

/// One contract, everything filed against it, and the money that points at it.
pub async fn contract(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(contract_id): Path<Uuid>,
) -> Result<Json<GaContractHub>, AppError> {
    allowed(&principal, Role::Supervisor, "read a contract")?;
    let today = state.clock.now().date_naive();
    let hub = infrastructure::ga_contract_hub_on(&state.db, contract_id, today).await?;
    // The shop's own lease, or the cleaning contract that covers every store —
    // the same contracts `/ga/locations/{its site}` already lists for it.
    principal.may_touch_coverage(
        hub.contract.site_id.as_deref(),
        hub.contract.site_scope.as_deref(),
        "contract",
    )?;
    Ok(Json(hub))
}

/// Correct what GA knows about a deal. The window moves one way: DRAFT to
/// ACTIVE to TERMINATED.
pub async fn update_contract(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(contract_id): Path<Uuid>,
    Json(request): Json<UpdateGaContractRequest>,
) -> Result<Json<GaContractRow>, AppError> {
    allowed(&principal, Role::Supervisor, "correct a contract")?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::ga_contract_update(&state.db, contract_id, &request, &principal.username, today)
            .await?,
    ))
}

/// Archive a deal, or bring it back, with the reason the notes will carry.
/// There is no DELETE (brief §12): a contract a bill pointed at stays
/// findable.
pub async fn archive_contract(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(contract_id): Path<Uuid>,
    Json(request): Json<ArchiveGaContractRequest>,
) -> Result<Json<GaContractRow>, AppError> {
    allowed(&principal, Role::Supervisor, "archive a contract")?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::ga_contract_archive(&state.db, contract_id, &request, &principal.username, today)
            .await?,
    ))
}

/// The contract's meter history, newest month first.
pub async fn meter_readings(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(contract_id): Path<Uuid>,
) -> Result<Json<Vec<GaMeterReading>>, AppError> {
    allowed(&principal, Role::Supervisor, "read a contract's meter history")?;
    Ok(Json(
        infrastructure::ga_contract_meter_readings(&state.db, contract_id).await?,
    ))
}

/// Record one month's meter — or correct one that was mis-typed: the same
/// month twice is ONE reading with a truer number, not a second row.
pub async fn record_meter_reading(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(contract_id): Path<Uuid>,
    Json(request): Json<RecordMeterReadingRequest>,
) -> Result<Json<GaMeterReading>, AppError> {
    allowed(&principal, Role::Supervisor, "record a meter reading")?;
    Ok(Json(
        infrastructure::ga_meter_reading_record(&state.db, contract_id, &request, &principal.username)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// Maintenance: the schedule, the walk-round, the repair, the swap, the disposal
// ---------------------------------------------------------------------------

/// One upkeep list's scope from the query string: `site` (one; a shop's till
/// is held to its own), `cursor` and `limit`.
///
/// The site narrows in the query rather than after it, so a shop's till
/// reads its own rows a page at a time, and every facet and count is over the
/// same rows — the rule `/ga/locations/{site}` shows as the place's strip.
fn maintenance_scope(
    principal: &Principal,
    params: &[(String, String)],
) -> Result<infrastructure::GaMaintenanceScope, AppError> {
    Ok(infrastructure::GaMaintenanceScope {
        site_id: principal
            .site_filter(facet_values(params, "site"))?
            .into_iter()
            .next(),
        cursor: single_value(params, "cursor"),
        limit: limit_value(params)?.unwrap_or(DEFAULT_GA_MAINTENANCE_LIMIT),
    })
}

/// The schedule of standing services, a page at a time.
pub async fn maintenance_tasks(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<GaMaintenanceTaskPage>, AppError> {
    allowed(&principal, Role::Supervisor, "read the maintenance schedule")?;
    refuse_unknown_parameters(&params, &["limit", "cursor", "site"])?;
    let scope = maintenance_scope(&principal, &params)?;
    let mut page = infrastructure::ga_maintenance_task_page(&state.db, scope).await?;
    if let Some(site) = principal.bound_site() {
        // The counts are already the site's own; the site facet says so.
        page.facets.sites.retain(|facet| facet.value == site);
    }
    Ok(Json(page))
}

/// Put a standing service promise on the schedule. The first due date is
/// computed from the interval and the business day when none is given.
pub async fn record_maintenance_task(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordGaTaskRequest>,
) -> Result<Json<GaMaintenanceTaskRow>, AppError> {
    allowed(&principal, Role::Supervisor, "record a maintenance task")?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::ga_maintenance_task_record(&state.db, &request, &principal.username, today)
            .await?,
    ))
}

/// Correct a task, or pause and resume it.
pub async fn update_maintenance_task(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(task_id): Path<Uuid>,
    Json(request): Json<UpdateGaTaskRequest>,
) -> Result<Json<GaMaintenanceTaskRow>, AppError> {
    allowed(&principal, Role::Supervisor, "correct a maintenance task")?;
    Ok(Json(
        infrastructure::ga_maintenance_task_update(&state.db, task_id, &request, &principal.username)
            .await?,
    ))
}

/// The walk-round list, newest inspection first.
pub async fn inspections(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<GaInspectionPage>, AppError> {
    allowed(&principal, Role::Supervisor, "read the inspection list")?;
    refuse_unknown_parameters(&params, &["limit", "cursor"])?;
    Ok(Json(
        infrastructure::ga_inspection_page(&state.db, maintenance_scope(&principal, &params)?)
            .await?,
    ))
}

/// Write down what somebody found. Append-only: there is no update.
pub async fn record_inspection(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordGaInspectionRequest>,
) -> Result<Json<GaInspectionRow>, AppError> {
    allowed(&principal, Role::Supervisor, "record an inspection")?;
    Ok(Json(
        infrastructure::ga_inspection_record(&state.db, &request, &principal.username).await?,
    ))
}

/// The repair list, most recent failure first.
pub async fn repairs(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<GaRepairPage>, AppError> {
    allowed(&principal, Role::Supervisor, "read the repair list")?;
    refuse_unknown_parameters(&params, &["limit", "cursor", "site"])?;
    let scope = maintenance_scope(&principal, &params)?;
    let today = state.clock.now().date_naive();
    let mut page = infrastructure::ga_repair_page(&state.db, scope, today).await?;
    if let Some(site) = principal.bound_site() {
        // The counts are already the site's own; the site facet says so.
        page.facets.sites.retain(|facet| facet.value == site);
    }
    Ok(Json(page))
}

/// Record a breakdown. The object is derived from the asset's class when it is
/// not given.
pub async fn record_repair(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordGaRepairRequest>,
) -> Result<Json<GaRepairRow>, AppError> {
    allowed(&principal, Role::Supervisor, "record a repair")?;
    // Through a shop's till: its own site, its own thing, and a contract that
    // is its own or covers it — a repair may not be filed against another
    // shop's air conditioner by naming this shop on the form.
    if principal.bound_site().is_some() {
        principal.may_touch_site(Some(request.site_id.trim()), "repair")?;
        if let Some(asset_id) = request.asset_id {
            let asset = infrastructure::ga_asset(&state.db, asset_id).await?;
            principal.may_touch_site(Some(&asset.site_id), "asset")?;
        }
        if let Some(contract_id) = request.contract_id {
            let today = state.clock.now().date_naive();
            let contract = infrastructure::ga_contract_on(&state.db, contract_id, today).await?;
            principal.may_touch_coverage(
                contract.site_id.as_deref(),
                contract.site_scope.as_deref(),
                "contract",
            )?;
        }
    }
    Ok(Json(
        infrastructure::ga_repair_record(&state.db, &request, &principal.username).await?,
    ))
}

/// One repair, with the object's name and Finance's billed total.
pub async fn repair(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(repair_id): Path<Uuid>,
) -> Result<Json<GaRepairRow>, AppError> {
    allowed(&principal, Role::Supervisor, "read a repair")?;
    Ok(Json(infrastructure::ga_repair(&state.db, repair_id).await?))
}

/// Correct what GA knows about a breakdown.
pub async fn update_repair(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(repair_id): Path<Uuid>,
    Json(request): Json<UpdateGaRepairRequest>,
) -> Result<Json<GaRepairRow>, AppError> {
    allowed(&principal, Role::Supervisor, "correct a repair")?;
    Ok(Json(
        infrastructure::ga_repair_update(&state.db, repair_id, &request, &principal.username)
            .await?,
    ))
}

/// Move a repair one rung up its ladder, or off it.
pub async fn move_repair(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(repair_id): Path<Uuid>,
    Json(request): Json<MoveGaRepairRequest>,
) -> Result<Json<GaRepairRow>, AppError> {
    allowed(&principal, Role::Supervisor, "move a repair")?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::ga_repair_move(&state.db, repair_id, &request, &principal.username, today)
            .await?,
    ))
}

/// Approve the ceiling somebody may spend on a repair.
pub async fn approve_repair_budget(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(repair_id): Path<Uuid>,
    Json(request): Json<ApproveGaRepairRequest>,
) -> Result<Json<GaRepairRow>, AppError> {
    allowed(&principal, Role::Supervisor, "approve a repair's budget")?;
    Ok(Json(
        infrastructure::ga_repair_approve_budget(&state.db, repair_id, &request, &principal.username)
            .await?,
    ))
}

/// The replacement list, newest proposal first.
pub async fn replacements(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<GaReplacementPage>, AppError> {
    allowed(&principal, Role::Supervisor, "read the replacement list")?;
    refuse_unknown_parameters(&params, &["limit", "cursor"])?;
    Ok(Json(
        infrastructure::ga_replacement_page(&state.db, maintenance_scope(&principal, &params)?)
            .await?,
    ))
}

/// One replacement, for the record the list opens.
pub async fn replacement(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(replacement_id): Path<Uuid>,
) -> Result<Json<GaReplacementRow>, AppError> {
    allowed(&principal, Role::Supervisor, "read a replacement")?;
    Ok(Json(
        infrastructure::ga_replacement(&state.db, replacement_id).await?,
    ))
}

/// Propose a replacement.
pub async fn record_replacement(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordGaReplacementRequest>,
) -> Result<Json<GaReplacementRow>, AppError> {
    allowed(&principal, Role::Supervisor, "propose a replacement")?;
    Ok(Json(
        infrastructure::ga_replacement_record(&state.db, &request, &principal.username).await?,
    ))
}

/// Move a replacement one rung up its ladder. `INSTALLED` makes the new asset.
pub async fn move_replacement(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(replacement_id): Path<Uuid>,
    Json(request): Json<MoveGaReplacementRequest>,
) -> Result<Json<GaReplacementRow>, AppError> {
    allowed(&principal, Role::Supervisor, "move a replacement")?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::ga_replacement_move(
            &state.db,
            replacement_id,
            &request,
            &principal.username,
            today,
        )
        .await?,
    ))
}

/// The disposal list, newest request first.
pub async fn disposals(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<GaDisposalPage>, AppError> {
    allowed(&principal, Role::Supervisor, "read the disposal list")?;
    refuse_unknown_parameters(&params, &["limit"])?;
    Ok(Json(
        infrastructure::ga_disposal_page(
            &state.db,
            limit_value(&params)?.unwrap_or(DEFAULT_GA_MAINTENANCE_LIMIT),
        )
        .await?,
    ))
}

/// One disposal, for the record the list opens.
pub async fn disposal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(disposal_id): Path<Uuid>,
) -> Result<Json<GaDisposalRow>, AppError> {
    allowed(&principal, Role::Supervisor, "read a disposal")?;
    Ok(Json(infrastructure::ga_disposal(&state.db, disposal_id).await?))
}

/// Ask to let a thing go; the asset is marked DISPOSAL_REQUESTED.
pub async fn request_disposal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RequestGaDisposalRequest>,
) -> Result<Json<GaDisposalRow>, AppError> {
    allowed(&principal, Role::Supervisor, "request a disposal")?;
    Ok(Json(
        infrastructure::ga_disposal_request(&state.db, &request, &principal.username).await?,
    ))
}

/// Finance's answer to a disposal request.
pub async fn decide_disposal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(disposal_id): Path<Uuid>,
    Json(request): Json<DecideGaDisposalRequest>,
) -> Result<Json<GaDisposalRow>, AppError> {
    allowed(&principal, Role::Supervisor, "decide a disposal")?;
    Ok(Json(
        infrastructure::ga_disposal_decide(&state.db, disposal_id, &request, &principal.username)
            .await?,
    ))
}

/// Finance closes a disposal it has booked. It changes the disposal's state
/// and nothing else: GA posts no journal.
pub async fn close_disposal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(disposal_id): Path<Uuid>,
) -> Result<Json<GaDisposalRow>, AppError> {
    allowed(&principal, Role::Supervisor, "close a disposal")?;
    Ok(Json(
        infrastructure::ga_disposal_close(&state.db, disposal_id, &principal.username).await?,
    ))
}

/// The eleven repair objects, their client names and their accounts. The object
/// picker draws itself from this, so it cannot offer one the server refuses.
pub async fn repair_objects(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<GaRepairObject>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the repair objects")?;
    Ok(Json(infrastructure::ga_repair_objects(&state.db).await?))
}

// ---------------------------------------------------------------------------
// Locations and supplies — the place, and what it asks for
// ---------------------------------------------------------------------------

/// The places: the register's own list, decorated with GA's detail.
///
/// `q` free-texts the site id, its name and the address. A site with no
/// `ga_location_detail` still appears — this is the list of PLACES, not the
/// list of details that happen to exist — and [`location`] is where the
/// missing detail is filled in.
pub async fn locations(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Vec<GaLocationRow>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the locations")?;
    refuse_unknown_parameters(&params, &["q"])?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::ga_locations(&state.db, single_value(&params, "q").as_deref(), today)
            .await?,
    ))
}

/// One place, everything that points at it, and its utilities.
pub async fn location(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(site_id): Path<String>,
) -> Result<Json<GaLocationHub>, AppError> {
    allowed(&principal, Role::Supervisor, "read a location")?;
    principal.may_touch_site(Some(&site_id), "place")?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::ga_location(&state.db, &site_id, today).await?,
    ))
}

/// Correct GA's own detail of a place. It never creates a site: the upsert
/// writes a `ga_location_detail` row, and the site itself is some other
/// flow's.
pub async fn update_location(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(site_id): Path<String>,
    Json(request): Json<UpdateGaLocationRequest>,
) -> Result<Json<GaLocationRow>, AppError> {
    allowed(&principal, Role::Supervisor, "correct a location")?;
    let today = state.clock.now().date_naive();
    Ok(Json(
        infrastructure::ga_location_update(&state.db, &site_id, &request, &principal.username, today)
            .await?,
    ))
}

/// The seven supply categories, with the account each one's bills propose.
/// One list, read by the screen and by the writer that validates against it.
pub async fn supply_categories(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<GaSupplyCategory>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the supply categories")?;
    Ok(Json(infrastructure::ga_supply_categories(&state.db).await?))
}

/// The supply register: newest ask first, filtered by place and stage.
pub async fn supplies(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Vec<GaSupplyRequestRow>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the supply register")?;
    refuse_unknown_parameters(&params, &["site", "status", "q", "limit"])?;
    Ok(Json(
        infrastructure::ga_supply_requests(
            &state.db,
            GaSupplyScope {
                site_id: principal
                    .site_filter(single_value(&params, "site").into_iter().collect())?
                    .into_iter()
                    .next(),
                statuses: facet_values(&params, "status"),
                needle: single_value(&params, "q"),
                limit: limit_value(&params)?.unwrap_or(DEFAULT_GA_SUPPLY_LIMIT),
            },
        )
        .await?,
    ))
}

/// The supply register a page at a time, for the screen that walks it.
///
/// The same scope as [`supplies`] plus `cursor`, answered as a page with the
/// total and the stage counts. `/supplies` stays the plain array a shop's
/// till and the site hub read; this is the register's own reading of it.
pub async fn supply_book(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<infrastructure::GaSupplyPage>, AppError> {
    allowed(&principal, Role::Supervisor, "read the supply register")?;
    refuse_unknown_parameters(&params, &["site", "status", "q", "cursor", "limit"])?;
    Ok(Json(
        infrastructure::ga_supply_page(
            &state.db,
            GaSupplyScope {
                site_id: principal
                    .site_filter(single_value(&params, "site").into_iter().collect())?
                    .into_iter()
                    .next(),
                statuses: facet_values(&params, "status"),
                needle: single_value(&params, "q"),
                limit: limit_value(&params)?.unwrap_or(DEFAULT_GA_SUPPLY_LIMIT),
            },
            single_value(&params, "cursor").as_deref(),
        )
        .await?,
    ))
}

/// One supply request — what the request sheet opens, wherever in the
/// register it sits. A shop's till reads only its own site's.
pub async fn supply(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(request_id): Path<Uuid>,
) -> Result<Json<GaSupplyRequestRow>, AppError> {
    allowed(&principal, Role::Supervisor, "read a supply request")?;
    let row = infrastructure::ga_supply_request(&state.db, request_id).await?;
    principal.may_touch_site(Some(&row.site_id), "supply request")?;
    Ok(Json(row))
}

/// File an ask. Brief §11: a shop files for its own site. A call relayed by a
/// shop's own node carries that site (`Principal::bound_site`), so it is
/// refused here in words for any other and handed to the domain guard as well;
/// head office's own sessions carry none, and the guard refuses nothing for
/// them.
pub async fn record_supply(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<RecordGaSupplyRequestRequest>,
) -> Result<Json<GaSupplyRequestRow>, AppError> {
    allowed(&principal, Role::Supervisor, "file a supply request")?;
    principal.may_touch_site(Some(request.site_id.trim()), "supply request")?;
    Ok(Json(
        infrastructure::ga_supply_record(
            &state.db,
            &request,
            &principal.username,
            principal.bound_site(),
        )
        .await?,
    ))
}

/// Move an ask one rung up its ladder, or off it.
pub async fn move_supply(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(request_id): Path<Uuid>,
    Json(request): Json<MoveGaSupplyRequestRequest>,
) -> Result<Json<GaSupplyRequestRow>, AppError> {
    allowed(&principal, Role::Supervisor, "move a supply request")?;
    Ok(Json(
        infrastructure::ga_supply_move(&state.db, request_id, &request, &principal.username, None)
            .await?,
    ))
}

/// The account a line would propose, and why (brief §8.2).
///
/// Used by the GA form while it is being filled and by Finance while it checks
/// the draft. `site` defaults to the DC because the map is per site and a code
/// without a place is a guess; `supplier` is optional and only needed when no
/// reference is given, because step five of the rule is the vendor's default
/// account.
pub async fn account_suggestion(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<AccountSuggestion>, AppError> {
    allowed(&principal, Role::Supervisor, "read an account suggestion")?;
    refuse_unknown_parameters(
        &params,
        &[
            "site",
            "asset_class",
            "repair_id",
            "contract_id",
            "supply_request_id",
            "prepaid",
            "supplier",
        ],
    )?;
    let site = single_value(&params, "site").unwrap_or_else(|| "dc".into());
    let prepaid = matches!(
        single_value(&params, "prepaid").as_deref(),
        Some("true") | Some("1")
    );
    let repair_id = uuid_param(&params, "repair_id")?;
    let contract_id = uuid_param(&params, "contract_id")?;
    let supply_request_id = uuid_param(&params, "supply_request_id")?;
    let supplier = single_value(&params, "supplier");
    Ok(Json(
        infrastructure::suggest_for_line(
            &state.db,
            &site,
            single_value(&params, "asset_class").as_deref(),
            repair_id,
            contract_id,
            supply_request_id,
            prepaid,
            supplier.as_deref(),
        )
        .await?,
    ))
}

/// One line of a draft GA files, with the account optional.
///
/// Leaving `account_code` out asks the server to SUGGEST one (brief §8.2);
/// giving one is a deliberate choice and marks the line `account_overridden`,
/// which is what Finance reads to see what GA changed.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaBillLineRequest {
    pub site_id: String,
    #[serde(default)]
    pub account_code: Option<String>,
    pub amount_minor: i64,
    #[serde(default)]
    pub category_code: Option<String>,
    #[serde(default)]
    pub asset_id: Option<Uuid>,
    #[serde(default)]
    pub contract_id: Option<Uuid>,
    #[serde(default)]
    pub repair_id: Option<Uuid>,
    #[serde(default)]
    pub replacement_id: Option<Uuid>,
    #[serde(default)]
    pub supply_request_id: Option<Uuid>,
    #[serde(default)]
    pub service_period_start: Option<NaiveDate>,
    #[serde(default)]
    pub service_period_end: Option<NaiveDate>,
    #[serde(default)]
    pub memo: Option<String>,
}

/// A draft bill GA files from a GA record (brief §8.3).
///
/// The document is a `supplier_invoice` with status DRAFT and
/// `submitted_by_domain = 'GA'` — NOT AP. Finance sees it in the Inbox, can
/// return it or post it, and the id is the same throughout.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaBillRequest {
    pub supplier_id: String,
    #[serde(default)]
    pub supplier_name: Option<String>,
    pub invoice_number: String,
    pub invoice_date: NaiveDate,
    #[serde(default)]
    pub due_date: Option<NaiveDate>,
    pub subtotal_minor: i64,
    #[serde(default)]
    pub tax_minor: i64,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub document_ref: Option<String>,
    pub lines: Vec<GaBillLineRequest>,
}

fn uuid_param(params: &[(String, String)], key: &str) -> Result<Option<Uuid>, AppError> {
    single_value(params, key)
        .map(|raw| {
            Uuid::parse_str(raw.trim())
                .map_err(|_| AppError::Validation(format!("{key} {raw:?} is not an id")))
        })
        .transpose()
}

/// File a draft from GA. It goes through `record_bill`'s own writer — there is
/// no second INSERT — but under the DRAFT policy, so it is not posted here: GA
/// does not post, Finance does (brief §4).
pub async fn record_bill_request(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<GaBillRequest>,
) -> Result<Json<infrastructure::SupplierBill>, AppError> {
    allowed(&principal, Role::Supervisor, "file a bill request")?;
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "a bill request says what it was for; add at least one line".into(),
        ));
    }

    let mut lines = Vec::with_capacity(request.lines.len());
    for (index, line) in request.lines.iter().enumerate() {
        let site_id = line.site_id.trim().to_string();
        if site_id.is_empty() {
            return Err(AppError::Validation(format!(
                "line {} must say which location the cost belongs to",
                index + 1
            )));
        }
        let chosen = line
            .account_code
            .as_deref()
            .map(str::trim)
            .filter(|code| !code.is_empty());
        let (account_code, account_overridden) = match chosen {
            Some(code) => (code.to_string(), true),
            None => {
                let suggestion = infrastructure::suggest_account(
                    &state.db,
                    &site_id,
                    &LineRefs {
                        asset_class_code: None,
                        repair_id: line.repair_id,
                        contract_id: line.contract_id,
                        supply_request_id: line.supply_request_id,
                        prepaid: false,
                        supplier_id: Some(request.supplier_id.trim().to_string()),
                    },
                )
                .await?;
                let Some(code) = suggestion.account_code else {
                    return Err(AppError::Validation(format!(
                        "line {} has no account: {}",
                        index + 1,
                        suggestion
                            .missing
                            .unwrap_or_else(|| "Finance has not mapped one".into())
                    )));
                };
                (code, false)
            }
        };
        lines.push(RecordBillLine {
            account_code,
            site_id,
            amount_minor: line.amount_minor,
            category_code: line.category_code.clone(),
            asset_class_code: None,
            draws_reserve: false,
            asset_id: line.asset_id,
            contract_id: line.contract_id,
            repair_id: line.repair_id,
            replacement_id: line.replacement_id,
            supply_request_id: line.supply_request_id,
            service_period_start: line.service_period_start,
            service_period_end: line.service_period_end,
            account_overridden,
            memo: line.memo.clone(),
        });
    }

    let bill = RecordBillRequest {
        invoice_number: request.invoice_number.clone(),
        supplier_id: request.supplier_id.clone(),
        supplier_name: request.supplier_name.clone(),
        site_id: lines
            .first()
            .map(|line| line.site_id.clone())
            .unwrap_or_default(),
        invoice_date: request.invoice_date,
        due_date: request.due_date,
        subtotal_minor: request.subtotal_minor,
        tax_minor: request.tax_minor,
        discount_minor: 0,
        note: request.note.clone(),
        kind: Some("EXPENSE".into()),
        lines: Some(lines),
        receipt_ids: None,
        matching: None,
        withholding_code: None,
        // The mark that puts this in Finance's GA inbox.
        submitted_by_domain: Some("GA".into()),
        document_ref: request.document_ref.clone(),
    };
    // `record_bill_draft` is `record_bill`'s own writer with posting switched
    // off — the same INSERT, not a second one. Posting stays a person's act in
    // Finance, so a GA request is always a DRAFT.
    Ok(Json(
        infrastructure::record_bill_draft(&state.db, &bill, &principal.username).await?,
    ))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/ga/overview", get(overview))
        // The account a line would propose, read while a form is filled. Before
        // the registers in reading order because it is about the same objects
        // but belongs to no one of them.
        .route("/api/v1/ga/account-suggestion", get(account_suggestion))
        .route("/api/v1/ga/bill-requests", post(record_bill_request))
        // The forms, before `/assets/{asset_id}` in reading order rather than in
        // matching order — the two paths cannot collide, and this one is what a
        // client fetches first.
        .route("/api/v1/ga/asset-builds", get(asset_builds))
        .route("/api/v1/ga/assets", get(assets).post(register_asset))
        .route("/api/v1/ga/assets/{asset_id}", get(asset).patch(update_asset))
        .route(
            "/api/v1/ga/assets/{asset_id}/transfer",
            post(transfer_asset),
        )
        .route("/api/v1/ga/assets/{asset_id}/notes", post(note_asset))
        // The contracts. `contract-types` before `/{contract_id}` in reading
        // order, as with the builds above — a register and its vocabulary
        // arrive together.
        .route("/api/v1/ga/contract-types", get(contract_types))
        .route(
            "/api/v1/ga/contracts",
            get(contracts).post(record_contract),
        )
        .route(
            "/api/v1/ga/contracts/{contract_id}",
            get(contract).patch(update_contract),
        )
        .route(
            "/api/v1/ga/contracts/{contract_id}/archive",
            post(archive_contract),
        )
        .route(
            "/api/v1/ga/contracts/{contract_id}/meter-readings",
            get(meter_readings).post(record_meter_reading),
        )
        // The upkeep: the schedule, the walk-round, the repair ladder, the swap
        // and the disposal. `repair-objects` before `repairs` in reading order,
        // as the builds and contract-types above — a register and its
        // vocabulary arrive together.
        .route("/api/v1/ga/repair-objects", get(repair_objects))
        .route(
            "/api/v1/ga/maintenance-tasks",
            get(maintenance_tasks).post(record_maintenance_task),
        )
        .route(
            "/api/v1/ga/maintenance-tasks/{task_id}",
            patch(update_maintenance_task),
        )
        .route(
            "/api/v1/ga/inspections",
            get(inspections).post(record_inspection),
        )
        .route("/api/v1/ga/repairs", get(repairs).post(record_repair))
        .route(
            "/api/v1/ga/repairs/{repair_id}",
            get(repair).patch(update_repair),
        )
        .route("/api/v1/ga/repairs/{repair_id}/move", post(move_repair))
        .route(
            "/api/v1/ga/repairs/{repair_id}/approve-budget",
            post(approve_repair_budget),
        )
        .route(
            "/api/v1/ga/replacements",
            get(replacements).post(record_replacement),
        )
        .route("/api/v1/ga/replacements/{replacement_id}", get(replacement))
        .route(
            "/api/v1/ga/replacements/{replacement_id}/move",
            post(move_replacement),
        )
        .route(
            "/api/v1/ga/disposals",
            get(disposals).post(request_disposal),
        )
        .route("/api/v1/ga/disposals/{disposal_id}", get(disposal))
        .route(
            "/api/v1/ga/disposals/{disposal_id}/decide",
            post(decide_disposal),
        )
        .route(
            "/api/v1/ga/disposals/{disposal_id}/close",
            post(close_disposal),
        )
        // The places and the supplies. `supply-categories` before `supplies`
        // in reading order, as the builds and contract-types above — a
        // register and its vocabulary arrive together.
        .route("/api/v1/ga/locations", get(locations))
        .route(
            "/api/v1/ga/locations/{site_id}",
            get(location).patch(update_location),
        )
        .route("/api/v1/ga/supply-categories", get(supply_categories))
        .route("/api/v1/ga/supplies", get(supplies).post(record_supply))
        .route("/api/v1/ga/supply-book", get(supply_book))
        .route("/api/v1/ga/supplies/{request_id}", get(supply))
        .route("/api/v1/ga/supplies/{request_id}/move", post(move_supply))
}