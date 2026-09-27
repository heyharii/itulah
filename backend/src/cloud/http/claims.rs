//! Filing an expense claim, sanctioning it, and paying it — the two-actor
//! money lane.
//!
//! # Three ways in, and they are not the same way
//!
//! An employee files their own claim under `people.claim.request_own`, which
//! everybody signed in holds and which reaches nothing but their own
//! spending. A place manager may file on a colleague's behalf under
//! `people.claim.file`, bounded by their posting. Deciding is
//! `people.claim.decide` — also bounded, deliberately disjoint from both
//! filing keys, and the domain refuses the filer deciding their own claim no
//! matter which key it arrived under: asking for money back is not granting
//! it. Paying is `people.claim.pay`, and it is the act that opens the
//! imprest, which is why it is its own key rather than a mode of deciding.
//!
//! # The catalogue reads for free
//!
//! Like the leave types and the attendance policy: somebody filing a claim
//! has to know which types exist before they can ask, and the list names no
//! employee and holds nothing personal. Defining and retiring are head
//! office's.
//!
//! # Every mutation answers with the whole view
//!
//! Lines embedded, history folded: the decide sheet renders the claim it just
//! changed, not a bare id, and the timeline is the reason a RETURNED decision
//! — which rests in no state — is still visible to the person it happened to.

use super::auth::Principal;
use super::employment::{current_unit, invalid, reach_of, resolve};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, Authorization, ClaimId, ClaimLine,
        ClaimLineId, ClaimType, ClaimTypeCatalogue, ClaimTypeCode, EmployeeId, ExpenseClaim,
        UnitId,
    },
    postgres::{self as infrastructure, ClaimView},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

// ── the catalogue ────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ClaimTypeView {
    pub code: String,
    pub name: String,
    pub retired_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

fn type_view(claim_type: &ClaimType) -> ClaimTypeView {
    ClaimTypeView {
        code: claim_type.code().to_string(),
        name: claim_type.name().to_owned(),
        retired_at: claim_type.retired_at(),
        created_at: claim_type.created_at(),
    }
}

/// The kinds of claim that exist, retired included — a claim filed under a
/// retired type keeps reading back with its name.
pub async fn list_types(
    State(state): State<AppState>,
) -> Result<Json<Vec<ClaimTypeView>>, AppError> {
    let catalogue = infrastructure::load_type_catalogue(&state.db).await?;
    Ok(Json(catalogue.types().iter().map(type_view).collect()))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DefineTypeBody {
    pub code: String,
    pub name: String,
    /// The expense category the type is filed under (0465): its links say
    /// which account the cost lands on and which liability it is owed on.
    pub expense_category: String,
}

/// Ratify a type. Head office's, and the weight is the reason: the code
/// becomes the qualifier every one of the type's postings carries, and the
/// map rows that say where those postings go are minted beside it.
pub async fn define_type(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<DefineTypeBody>,
) -> Result<Json<Vec<ClaimTypeView>>, AppError> {
    require(&principal, actions::CLAIM_TYPE_SET)?;
    let claim_type = ClaimType::try_new(
        ClaimTypeCode::try_new(&body.code).map_err(invalid)?,
        &body.name,
        Utc::now(),
    )
    .map_err(infrastructure::claim_error)?;
    infrastructure::define_claim_type(
        &state.db,
        &claim_type,
        &body.expense_category,
        &principal.username,
    )
    .await?;
    let catalogue = infrastructure::load_type_catalogue(&state.db).await?;
    Ok(Json(catalogue.types().iter().map(type_view).collect()))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetireTypeBody {
    pub reason: String,
}

/// Retire a type, never delete: every claim filed under it keeps resolving.
pub async fn retire_type(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Json(body): Json<RetireTypeBody>,
) -> Result<Json<Vec<ClaimTypeView>>, AppError> {
    require(&principal, actions::CLAIM_TYPE_SET)?;
    if body.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "retiring a claim type needs a reason; the claims already filed under it have to be \
             answerable"
                .into(),
        ));
    }
    let code = ClaimTypeCode::try_new(&code).map_err(invalid)?;
    infrastructure::retire_claim_type(&state.db, &code, body.reason.trim(), Utc::now()).await?;
    let catalogue = infrastructure::load_type_catalogue(&state.db).await?;
    Ok(Json(catalogue.types().iter().map(type_view).collect()))
}

// ── filing ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileLineBody {
    pub type_code: String,
    pub description: String,
    pub spent_on: NaiveDate,
    pub claimed_minor: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileBody {
    /// The person the claim is about. Absent or `me` when the caller files
    /// their own; a manager filing on behalf names the colleague and files
    /// under `people.claim.file`.
    #[serde(default)]
    pub employee_id: Option<String>,
    pub lines: Vec<FileLineBody>,
    pub reason: String,
    /// The date the claim is dated. Defaults to today, the day it was asked
    /// for — a backdated claim is a fact somebody states, not a default.
    #[serde(default)]
    pub posted_on: Option<NaiveDate>,
}

/// File a claim.
///
/// The key the claim is recorded under is the one that actually applied —
/// `request_own` for somebody filing their own spending, `file` for a manager
/// filing on a colleague's behalf — so a stored claim says which authority it
/// rested on rather than which one the handler happened to check first.
pub async fn file(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<FileBody>,
) -> Result<Json<ClaimView>, AppError> {
    let subject = body.employee_id.as_deref().unwrap_or("me");
    let access = resolve(&state, &principal, subject).await?;
    let action_key = if access.own {
        actions::CLAIM_REQUEST_OWN
    } else {
        actions::CLAIM_FILE
    };
    access.may(action_key)?;

    // Where the person is posted, which is where the claim belongs and which
    // manager it lands in front of. Read from the employment record rather
    // than taken from the body: a body that named its own place would be a
    // claim that chose its own approver.
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    access.reaches(current_unit(&record))?;
    let unit = current_unit(&record).ok_or_else(|| {
        AppError::Conflict(format!(
            "{} is not posted anywhere, so there is nobody to decide their claim",
            access.employee_id
        ))
    })?;

    let catalogue = infrastructure::load_type_catalogue(&state.db).await?;
    let mut lines = Vec::with_capacity(body.lines.len());
    for (index, line) in body.lines.iter().enumerate() {
        lines.push(
            ClaimLine::try_new(
                ClaimLineId::try_new(&Uuid::new_v4().to_string()).map_err(invalid)?,
                ClaimTypeCode::try_new(&line.type_code).map_err(invalid)?,
                line.description.clone(),
                line.spent_on,
                line.claimed_minor,
                index as i32 + 1,
            )
            .map_err(infrastructure::claim_error)?,
        );
    }

    let claim_id = Uuid::new_v4();
    let claim = ExpenseClaim::file(
        ClaimId::try_new(&claim_id.to_string()).map_err(invalid)?,
        // Minted by the insert, inside its transaction: a document number
        // chosen anywhere else is a second authority.
        String::new(),
        UnitId::try_new(unit).map_err(invalid)?,
        EmployeeId::try_new(&access.employee_id).map_err(invalid)?,
        body.posted_on.unwrap_or_else(crate::reporting::local_today),
        lines,
        &catalogue,
        access.authorize(action_key, &body.reason)?,
    )
    .map_err(infrastructure::claim_error)?;

    infrastructure::insert_claim(&state.db, &claim).await?;
    read_back(&state, &catalogue, claim_id).await.map(Json)
}

async fn read_back(
    state: &AppState,
    catalogue: &ClaimTypeCatalogue,
    claim_id: Uuid,
) -> Result<ClaimView, AppError> {
    let record = infrastructure::load_claim(&state.db, claim_id, catalogue)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("expense claim {claim_id}")))?;
    infrastructure::claim_view(&record, catalogue)
}

// ── the queue and the list ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaimQuery {
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub employee: Option<String>,
}

/// The queue and the list, bounded by the caller's reach.
///
/// One list rather than one screen per state: a manager has five minutes and
/// a filter, not four tasks. A bounded caller's reach is ANDed into the
/// query, so a shop's manager asking for another shop's claims by name gets
/// an empty list, not another shop's claims.
pub async fn list_claims(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ClaimQuery>,
) -> Result<Json<Vec<ClaimView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let reach = reach_of(&state, &principal).await?;
    if reach.is_nowhere() {
        return Err(AppError::Forbidden(format!(
            "{} has no open posting, so no unit's claims are theirs to read",
            principal.username
        )));
    }
    let catalogue = infrastructure::load_type_catalogue(&state.db).await?;
    let records = infrastructure::list_claims(
        &state.db,
        &catalogue,
        query.unit.as_deref(),
        query.state.as_deref(),
        query.employee.as_deref(),
        reach.sole_unit().map(|unit| unit.as_str()),
    )
    .await?;
    records
        .iter()
        .map(|record| infrastructure::claim_view(record, &catalogue))
        .collect::<Result<Vec<ClaimView>, AppError>>()
        .map(Json)
}

/// One person's claims — the Directory sheet, and the employee app's own
/// view of what it asked for and what came back.
pub async fn list_of_employee(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<ClaimView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    if !access.own {
        let record = infrastructure::load_employee(&state.db, &access.employee_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
        access.reaches(current_unit(&record))?;
    }
    let catalogue = infrastructure::load_type_catalogue(&state.db).await?;
    let records = infrastructure::list_claims(
        &state.db,
        &catalogue,
        None,
        None,
        Some(&access.employee_id),
        None,
    )
    .await?;
    records
        .iter()
        .map(|record| infrastructure::claim_view(record, &catalogue))
        .collect::<Result<Vec<ClaimView>, AppError>>()
        .map(Json)
}

// ── the transitions ──────────────────────────────────────────────────────

/// The claim to act on, and whether the caller may.
///
/// The filing key is chosen the same way filing chose it: the caller's own
/// claim answers to `request_own`, a colleague's to `file` — and either way
/// the claim's filer must be the caller, which the domain re-checks. A claim
/// that names nobody the caller filed is simply not found: it belongs to
/// somebody else's lane and saying so would be a directory leak.
///
/// The key comes back with the claim, because the withdrawal and the
/// submission are recorded under the authority that actually applied — the
/// same discipline filing follows.
async fn filer_claim(
    state: &AppState,
    principal: &Principal,
    claim_id: Uuid,
) -> Result<(ExpenseClaim, ClaimTypeCatalogue, &'static str), AppError> {
    let catalogue = infrastructure::load_type_catalogue(&state.db).await?;
    let record = infrastructure::load_claim(&state.db, claim_id, &catalogue)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("expense claim {claim_id}")))?;
    let caller = infrastructure::caller_record(&state.db, &principal.username).await?;
    let own_employee = caller
        .employee_id
        .as_deref()
        .is_some_and(|mine| mine == record.claim.employee().as_str());
    let action_key = if own_employee {
        actions::CLAIM_REQUEST_OWN
    } else {
        actions::CLAIM_FILE
    };
    if !role_allows(required_role_for_action(action_key), principal.role) {
        return Err(AppError::Forbidden(format!(
            "{} may not {action_key}",
            principal.username
        )));
    }
    if !own_employee {
        // A supervisor act on a colleague's claim is bounded by the caller's
        // own posting, like every other place-scoped write.
        let reach = reach_of(state, principal).await?;
        if !reach.covers(Some(record.claim.unit().as_str())) {
            return Err(AppError::Forbidden(format!(
                "{} is not posted anywhere that reaches {}",
                principal.username,
                record.claim.unit()
            )));
        }
    }
    if record.claim.claimed_by() != principal.username {
        return Err(AppError::NotFound(format!("expense claim {claim_id}")));
    }
    Ok((record.claim, catalogue, action_key))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReasonBody {
    pub reason: String,
}

/// The filer sends it up. DRAFT → SUBMITTED, once.
pub async fn submit(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<ClaimView>, AppError> {
    let (mut claim, catalogue, action_key) = filer_claim(&state, &principal, claim_id).await?;
    let authorization =
        Authorization::try_new(&principal.username, action_key, Utc::now(), &body.reason)
            .map_err(invalid)?;
    infrastructure::record_submission(&state.db, &mut claim, authorization).await?;
    read_back(&state, &catalogue, claim_id).await.map(Json)
}

/// Take it back. The filer's, from DRAFT or SUBMITTED; anyone else who wants
/// a submitted claim gone must decide it, which records their name.
pub async fn withdraw(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<ClaimView>, AppError> {
    let (mut claim, catalogue, action_key) = filer_claim(&state, &principal, claim_id).await?;
    let authorization =
        Authorization::try_new(&principal.username, action_key, Utc::now(), &body.reason)
            .map_err(invalid)?;
    infrastructure::record_withdrawal(&state.db, &mut claim, authorization).await?;
    read_back(&state, &catalogue, claim_id).await.map(Json)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SanctionLineBody {
    pub line_id: Uuid,
    pub sanctioned_minor: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionBody {
    pub approve: bool,
    pub reason: String,
    /// A figure per line, when approving. The domain requires every line
    /// named, each figure positive and not above what was claimed; a claim
    /// worth sanctioning nothing is returned or rejected instead, by name.
    #[serde(default)]
    pub lines: Vec<SanctionLineBody>,
}

/// Sanction it — approve with figures, or reject by name.
///
/// The decision and its posting share one transaction, so there is no instant
/// at which a claim says APPROVED and the books have not heard of it. The
/// two-actor rule is the domain's, and it compares actors rather than keys.
pub async fn decide(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(body): Json<DecisionBody>,
) -> Result<Json<ClaimView>, AppError> {
    require(&principal, actions::CLAIM_DECIDE)?;
    let catalogue = infrastructure::load_type_catalogue(&state.db).await?;
    let record = infrastructure::load_claim(&state.db, claim_id, &catalogue)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("expense claim {claim_id}")))?;
    let mut claim = record.claim;
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(claim.unit().as_str())) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username,
            claim.unit()
        )));
    }
    let authorization = Authorization::try_new(
        &principal.username,
        actions::CLAIM_DECIDE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    let sanctions = body
        .lines
        .iter()
        .map(|line| {
            Ok((
                ClaimLineId::try_new(&line.line_id.to_string()).map_err(invalid)?,
                line.sanctioned_minor,
            ))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    infrastructure::decide_claim(
        &state.db,
        &mut claim,
        body.approve,
        &sanctions,
        authorization,
    )
    .await?;
    read_back(&state, &catalogue, claim_id).await.map(Json)
}

/// Send it back to DRAFT, with a reason. The one decision that rests nowhere:
/// the history keeps the only record it happened.
pub async fn returnal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<ClaimView>, AppError> {
    require(&principal, actions::CLAIM_DECIDE)?;
    let catalogue = infrastructure::load_type_catalogue(&state.db).await?;
    let record = infrastructure::load_claim(&state.db, claim_id, &catalogue)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("expense claim {claim_id}")))?;
    let mut claim = record.claim;
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(claim.unit().as_str())) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username,
            claim.unit()
        )));
    }
    let authorization = Authorization::try_new(
        &principal.username,
        actions::CLAIM_DECIDE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    infrastructure::record_returnal(&state.db, &mut claim, authorization).await?;
    read_back(&state, &catalogue, claim_id).await.map(Json)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayoutBody {
    /// The date the money left the imprest. Defaults to today.
    #[serde(default)]
    pub paid_on: Option<NaiveDate>,
}

/// Pay an approved claim from the place's petty cash.
///
/// `Dr employee_claim_payable` the claim sanctioned, `Cr petty_cash` — the
/// money leaving the imprest, visible to the cash-position fold with no new
/// table. The payout lands once: the source key is the claim, and a second
/// attempt is a 409 from the database, not from a status check.
pub async fn payout(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(claim_id): Path<Uuid>,
    Json(body): Json<PayoutBody>,
) -> Result<Json<ClaimView>, AppError> {
    require(&principal, actions::CLAIM_PAY)?;
    let catalogue = infrastructure::load_type_catalogue(&state.db).await?;
    let record = infrastructure::load_claim(&state.db, claim_id, &catalogue)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("expense claim {claim_id}")))?;
    let mut claim = record.claim;
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(claim.unit().as_str())) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username,
            claim.unit()
        )));
    }
    let authorization = Authorization::try_new(
        &principal.username,
        actions::CLAIM_PAY,
        Utc::now(),
        &format!("payout of {}", claim.claim_number()),
    )
    .map_err(invalid)?;
    infrastructure::pay_claim(
        &state.db,
        &mut claim,
        authorization,
        body.paid_on.unwrap_or_else(crate::reporting::local_today),
    )
    .await?;
    read_back(&state, &catalogue, claim_id).await.map(Json)
}

// ── the advance surface (read-only) ─────────────────────────────────────

/// One person's advances from the finance lane — read-only.
///
/// `advance` and its settlements are the finance lane's (0280): People
/// surfaces them so the place manager sees who is holding company money, and
/// touches nothing else about them. Every mutation stays behind the finance
/// routes.
pub async fn list_advances(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<infrastructure::EmployeeAdvanceView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    if !access.own {
        let record = infrastructure::load_employee(&state.db, &access.employee_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
        access.reaches(current_unit(&record))?;
    }
    Ok(Json(
        infrastructure::advances_of_employee(&state.db, &access.employee_id).await?,
    ))
}
