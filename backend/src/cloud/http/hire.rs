//! *Karyawan baru*: a shop asks for an employee, head office answers.
//!
//! # Two gates, and the second is the one a rung cannot hold
//!
//! `required_role` says a proposal is filed at the supervisor rung and decided
//! at head office's. That is only half of it: every store manager holds the
//! supervisor rung, so the rung cannot say that store-07's manager files for
//! store-07 and not for store-03. The other half is [`reach_of`] — the same
//! `Reach`, resolved from the caller's own open posting, that bounds the
//! Directory — and it is applied to the unit named in the body. For a bounded caller the only unit that passes is their
//! own posting, so the field cannot be used to staff somebody else's shop.
//!
//! # The proposer does not decide, and that check is not here
//!
//! It is in `domain::hire`, on the actor, because that is where it can also run
//! when a stored row is decoded — and a rule only the live path enforces is a
//! rule a round trip through the database removes. What this layer contributes
//! is the actor itself: it comes from the session and never from the body, so a
//! caller cannot sign somebody else's name to their own decision.
//!
//! # One decision route, three answers
//!
//! Approve, return for revision and reject are one decision with three values,
//! and every one of them needs a reason. Three routes would be three places to
//! forget to ask for one; one route with a closed enum asks once. The shape
//! `http::overtime` uses for a consent — one route, `agreed: bool`, "there is
//! no third value" — with three values instead of two.
//!
//! # Where this hands over
//!
//! `POST /hire-proposals/{id}/employment` opens the employment record, and
//! everything it does is somebody else's code: [`Employee::register`] mints the
//! candidate, [`AssignmentSpan`] posts them to the unit that asked, and
//! `postgres::employment` writes both. Nothing here duplicates the employment
//! kernel, and nothing here makes anybody an active employee — the `HIRE` event
//! is `POST /employees/{id}/employment`, recorded on the day the person
//! actually starts by whoever sees them start.

use super::auth::Principal;
use super::employment::reach_of;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, AssignmentSpan, AssignmentTimeline,
        Authorization, CandidateName, ContractKind, Employee, EmployeeId, HireDecision,
        HireProposal, HireProposalEvent, HireProposalId, HireProposalState, HireProposalStep,
        HiringNeed, PlaceId, Position, ProposedTerms, RecordKind,
    },
    http::audit::DeclaredSubject,
    postgres::{self as infrastructure, HireProposalRecord},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

/// The rung half of "may they". The place half is [`reach_of`].
fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

/// The recorded authority for a decision the caller is about to take.
///
/// The actor and the instant come from the session and the server clock, never
/// from the request body: a handler that accepted either would let a caller
/// sign somebody else's name to their own decision. Only the reason is theirs
/// to state, and `ReasonText` refuses a blank one — which is what makes "every
/// decision carries a reason" structural rather than a habit.
fn authorize(
    principal: &Principal,
    action_key: &str,
    reason: &str,
) -> Result<Authorization, AppError> {
    Authorization::try_new(&principal.username, action_key, Utc::now(), reason).map_err(invalid)
}

// ── views ────────────────────────────────────────────────────────────────

/// One version of the terms, with the two acts that bracket it: who filed it,
/// and what head office answered.
///
/// Both are assembled from the history rather than stored beside the version,
/// so a screen showing "version 1, returned because the pay was above band"
/// reads one object. That pairing is the whole reason a revision is a version.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HireProposalVersionView {
    pub version: u32,
    pub position: String,
    pub headcount: u32,
    /// `REPLACEMENT` or `ADDITION`.
    pub need: String,
    pub candidate_name: String,
    pub start_on: NaiveDate,
    /// `PKWT` or `PKWTT`.
    pub contract_kind: String,
    /// Present for a fixed term and absent for a permanent contract — never
    /// both ways round, because the domain has nowhere to put one on a PKWTT.
    pub contract_ends_on: Option<NaiveDate>,
    pub base_pay_minor: i64,
    pub filed_by: Option<String>,
    pub filed_at: Option<DateTime<Utc>>,
    pub filed_reason: Option<String>,
    /// `APPROVED`, `RETURNED` or `REJECTED` — absent while this version is the
    /// one waiting on an answer.
    pub decision: Option<String>,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub decided_reason: Option<String>,
}

/// One recorded step, for the activity panel.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HireProposalStepView {
    /// `PROPOSED`, `REVISED`, `RETURNED`, `APPROVED`, `REJECTED` or `OPENED`.
    pub step: String,
    pub version: u32,
    /// The employment record an `OPENED` step produced, and no other step's.
    pub employee_id: Option<String>,
    pub actor: String,
    pub at: DateTime<Utc>,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HireProposalView {
    pub id: String,
    pub place_id: String,
    /// The unit's own name. Sent because a screen showing `ho` where it means
    /// "Head Office" is an identifier that has escaped into the interface.
    pub place_name: Option<String>,
    /// `PROPOSED`, `RETURNED`, `APPROVED`, `REJECTED` or `FILLED`.
    ///
    /// `APPROVED` is not an employee. It is permission to open an employment
    /// record, and a screen that renders it as "hired" would be saying
    /// something the owner explicitly did not decide.
    pub state: String,
    pub current_version: u32,
    /// How many of the people asked for still have no employment record.
    /// `0` on an approved proposal means it is `FILLED`.
    pub outstanding: u32,
    /// Who filed the version in force. The one actor who may **not** decide it,
    /// which is why the screen shows it beside the decision controls.
    pub proposed_by: String,
    /// Every version, oldest first. The returned ones are still here.
    pub versions: Vec<HireProposalVersionView>,
    pub history: Vec<HireProposalStepView>,
    /// The employment records opened against this proposal, in order.
    pub employee_ids: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn version_views(proposal: &HireProposal) -> Vec<HireProposalVersionView> {
    proposal
        .versions()
        .enumerate()
        .map(|(index, terms)| {
            let number = u32::try_from(index + 1).unwrap_or(u32::MAX);
            let about = |event: &&HireProposalEvent| event.version() == number;
            let filed = proposal
                .history()
                .iter()
                .filter(about)
                .find(|event| {
                    matches!(
                        event.step(),
                        HireProposalStep::Proposed | HireProposalStep::Revised
                    )
                })
                .map(HireProposalEvent::authorization);
            let decided = proposal.history().iter().filter(about).find(|event| {
                matches!(
                    event.step(),
                    HireProposalStep::Approved
                        | HireProposalStep::Returned
                        | HireProposalStep::Rejected
                )
            });
            HireProposalVersionView {
                version: number,
                position: terms.position().as_str().to_owned(),
                headcount: terms.headcount(),
                need: terms.need().code().to_owned(),
                candidate_name: terms.candidate().as_str().to_owned(),
                start_on: terms.start_on(),
                contract_kind: terms.contract().code().to_owned(),
                contract_ends_on: terms.contract().ends_on(),
                base_pay_minor: terms.base_pay().minor,
                filed_by: filed.map(|authority| authority.actor().to_string()),
                filed_at: filed.map(Authorization::at),
                filed_reason: filed.map(|authority| authority.reason().to_string()),
                decision: decided.map(|event| event.step().code().to_owned()),
                decided_by: decided.map(|event| event.authorization().actor().to_string()),
                decided_at: decided.map(|event| event.authorization().at()),
                decided_reason: decided.map(|event| event.authorization().reason().to_string()),
            }
        })
        .collect()
}

fn proposal_view(record: &HireProposalRecord) -> HireProposalView {
    let proposal = &record.proposal;
    HireProposalView {
        id: proposal.id().to_string(),
        place_id: proposal.place().to_string(),
        place_name: record.place_name.clone(),
        state: proposal.state().code().to_owned(),
        current_version: proposal.current_version(),
        // Asked of the domain rather than derived from the state code here. Two
        // answers to "how many are still needed" is one too many.
        outstanding: proposal.outstanding(),
        proposed_by: proposal.proposer().to_string(),
        versions: version_views(proposal),
        history: proposal
            .history()
            .iter()
            .map(|event| HireProposalStepView {
                step: event.step().code().to_owned(),
                version: event.version(),
                employee_id: event.employee().map(ToString::to_string),
                actor: event.authorization().actor().to_string(),
                at: event.authorization().at(),
                reason: event.authorization().reason().to_string(),
            })
            .collect(),
        employee_ids: proposal.opened().map(ToString::to_string).collect(),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

// ── request bodies ───────────────────────────────────────────────────────

/// The owner's field list, 2026-09-13, and nothing else.
///
/// There is no NIK, no address, no date of birth and no contact detail, and
/// adding one would have nowhere to go: `hire_proposal_version` has no column
/// for any of them. See `domain::hire` for why.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct ProposeBody {
    /// The unit this is for.
    ///
    /// Stated rather than derived, and then **fenced by the caller's reach**:
    /// for a bounded caller the only value that passes is their own posting, so
    /// it cannot name another shop. It is in the body at all because head
    /// office's HR reaches every unit and has to say which one they mean.
    pub place_id: String,
    pub position: String,
    /// One is the normal case. A proposal for two is filled by the second
    /// employment record, not the first.
    pub headcount: u32,
    /// `REPLACEMENT` or `ADDITION`.
    pub need: String,
    pub candidate_name: String,
    pub start_on: NaiveDate,
    /// `PKWT` or `PKWTT`.
    pub contract_kind: String,
    /// Required for `PKWT` and refused for `PKWTT`. UU 13/2003 art. 59: a fixed
    /// term that does not say when it ends is not a fixed term.
    #[serde(default)]
    pub contract_ends_on: Option<NaiveDate>,
    /// Proposed *gaji pokok*, in the smallest unit.
    pub base_pay_minor: i64,
    pub reason: String,
}

/// A new version of a returned proposal.
///
/// [`ProposeBody`] without the unit, because a revision may change the pay or
/// the start date and a proposal that changed shops would be a different
/// proposal. A field the server would have to ignore is a field a client will
/// eventually expect to be read.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct ReviseBody {
    pub position: String,
    pub headcount: u32,
    pub need: String,
    pub candidate_name: String,
    pub start_on: NaiveDate,
    pub contract_kind: String,
    #[serde(default)]
    pub contract_ends_on: Option<NaiveDate>,
    pub base_pay_minor: i64,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct DecisionBody {
    /// `APPROVE`, `RETURN` or `REJECT`. One field because they are one
    /// decision, and a closed set because "maybe" is the state it is in.
    pub decision: String,
    /// Required on all three, and a blank one is refused by `ReasonText` before
    /// it reaches the domain. A rejection nobody explained is a rejection
    /// somebody can later characterise however they like.
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct OpenEmploymentBody {
    /// The badge number the new record will carry.
    ///
    /// Not derived from anything: it is HR's own numbering and the employment
    /// kernel refuses a duplicate. Nothing else is taken from this body — the
    /// unit and the start date come from the *approved* version, because what
    /// was approved is what may be acted on.
    pub employee_code: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListQuery {
    /// A unit, for an unbounded caller. A bounded one may name their own or
    /// nothing; naming another is refused rather than silently re-filtered.
    #[serde(default)]
    pub place_id: Option<String>,
    /// `PROPOSED`, `RETURNED`, `APPROVED`, `REJECTED` or `FILLED`.
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

// ── reading ──────────────────────────────────────────────────────────────

/// The proposals a caller may see, newest first.
///
/// A bounded caller who names a unit they cannot reach is refused rather than
/// silently re-filtered. Quietly answering a different question than the one
/// asked is how somebody concludes store-03 has the same requests as store-07.
pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<HireProposalView>>, AppError> {
    require(&principal, actions::HIRE_PROPOSAL_READ)?;
    let reach = reach_of(&state, &principal).await?;
    if reach.is_nowhere() {
        return Err(AppError::Forbidden(format!(
            "{} has no open posting, so no unit's hiring requests are theirs to read",
            principal.username
        )));
    }
    let place_filter = match (reach.sole_place(), query.place_id.as_deref()) {
        (None, asked) => asked.map(str::to_owned),
        (Some(mine), None) => Some(mine.to_string()),
        (Some(mine), Some(asked)) if asked == mine.as_str() => Some(mine.to_string()),
        (Some(_), Some(asked)) => {
            return Err(AppError::Forbidden(format!(
                "{} is not posted to {asked}",
                principal.username
            )));
        }
    };
    let state_filter = match query.state.as_deref() {
        None => None,
        Some(raw) => Some(
            HireProposalState::parse(raw)
                .ok_or_else(|| {
                    AppError::Validation(format!(
                        "{raw:?} is not a state: expected PROPOSED, RETURNED, APPROVED, REJECTED \
                         or FILLED"
                    ))
                })?
                .code()
                .to_owned(),
        ),
    };
    let records = infrastructure::list_hire_proposals(
        &state.db,
        infrastructure::HireProposalScope {
            // The fence, beside the filter. They are the same value for a
            // bounded caller today — and the query applies both, so the day
            // somebody edits the reconciliation above without reading it, the
            // answer narrows rather than widens.
            reach_place: reach.sole_place().map(ToString::to_string),
            place_id: place_filter,
            state: state_filter,
            limit: query.limit,
        },
    )
    .await?;
    Ok(Json(records.iter().map(proposal_view).collect()))
}

/// Load a proposal the caller may reach, or refuse.
///
/// The reach check runs after the row is loaded, because the unit is a fact
/// about the row — the same reason `Access::reaches` gives. Nothing about the
/// proposal reaches the caller either way.
async fn reachable(
    state: &AppState,
    principal: &Principal,
    id: &str,
) -> Result<HireProposalRecord, AppError> {
    let record = infrastructure::load_hire_proposal(&state.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("hire proposal {id}")))?;
    let reach = reach_of(state, principal).await?;
    if !reach.covers(Some(record.proposal.place().as_str())) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username,
            record.proposal.place()
        )));
    }
    Ok(record)
}

pub async fn detail(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<HireProposalView>, AppError> {
    require(&principal, actions::HIRE_PROPOSAL_READ)?;
    Ok(Json(proposal_view(
        &reachable(&state, &principal, &id).await?,
    )))
}

// ── writing ──────────────────────────────────────────────────────────────

/// Assemble the terms, refusing every malformed shape by name.
#[allow(clippy::too_many_arguments)]
fn terms(
    position: &str,
    headcount: u32,
    need: &str,
    candidate_name: &str,
    start_on: NaiveDate,
    contract_kind: &str,
    contract_ends_on: Option<NaiveDate>,
    base_pay_minor: i64,
) -> Result<ProposedTerms, AppError> {
    // The end date lives *inside* the fixed-term variant, so this match is the
    // one place the two halves of UU 13/2003 art. 59 are checked — and once it
    // has passed, neither statutory mistake is representable downstream.
    let contract = match (contract_kind.trim(), contract_ends_on) {
        ("PKWT", Some(ends_on)) => ContractKind::Pkwt { ends_on },
        ("PKWT", None) => {
            return Err(AppError::Validation(
                "a PKWT must say when it ends: send contract_ends_on".to_owned(),
            ))
        }
        ("PKWTT", None) => ContractKind::Pkwtt,
        ("PKWTT", Some(_)) => {
            return Err(AppError::Validation(
                "a PKWTT is permanent and has no end date: leave contract_ends_on out".to_owned(),
            ))
        }
        (other, _) => {
            return Err(AppError::Validation(format!(
                "{other:?} is not a contract kind: expected PKWT or PKWTT"
            )))
        }
    };
    ProposedTerms::try_new(
        Position::try_new(position).map_err(invalid)?,
        headcount,
        HiringNeed::parse(need).ok_or_else(|| {
            AppError::Validation(format!(
                "{need:?} is not a hiring need: expected REPLACEMENT or ADDITION"
            ))
        })?,
        CandidateName::try_new(candidate_name).map_err(infrastructure::hire_error)?,
        start_on,
        contract,
        pricing_engine::Money::new(base_pay_minor),
    )
    .map_err(infrastructure::hire_error)
}

/// File a proposal for the caller's own unit.
pub async fn propose(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(body): Json<ProposeBody>,
) -> Result<Json<HireProposalView>, AppError> {
    require(&principal, actions::HIRE_PROPOSAL_PROPOSE)?;
    let place = PlaceId::try_new(&body.place_id).map_err(invalid)?;
    let reach = reach_of(&state, &principal).await?;
    // `covers` is the whole rule: everywhere for head office, exactly their own
    // posting for a place manager, and nowhere for a login with no employment
    // record behind it.
    if !reach.covers(Some(place.as_str())) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted to {place}, so no hire there is theirs to propose",
            principal.username
        )));
    }
    // Answered here rather than left to the foreign key, so an unknown unit is
    // a sentence the caller can read instead of a 500.
    if infrastructure::hire_proposal_unit(&state.db, place.as_str())
        .await?
        .is_none()
    {
        return Err(AppError::Validation(format!("{place} is not a unit")));
    }

    let terms = terms(
        &body.position,
        body.headcount,
        &body.need,
        &body.candidate_name,
        body.start_on,
        &body.contract_kind,
        body.contract_ends_on,
        body.base_pay_minor,
    )?;
    // Minted here and never taken from the caller: an id a client chooses is an
    // id that can be made to collide with somebody else's.
    let id = HireProposalId::try_new(&format!("hp_{}", Uuid::new_v4().simple()))
        .map_err(infrastructure::hire_error)?;
    let proposal = HireProposal::propose(
        id.clone(),
        place,
        terms,
        authorize(&principal, actions::HIRE_PROPOSAL_PROPOSE, &body.reason)?,
    )
    .map_err(infrastructure::hire_error)?;
    infrastructure::insert_hire_proposal(&state.db, &proposal).await?;
    acted_on.set(RecordKind::HireProposal, id.to_string());
    read_back(&state, id.as_str()).await
}

async fn read_back(state: &AppState, id: &str) -> Result<Json<HireProposalView>, AppError> {
    let record = infrastructure::load_hire_proposal(&state.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("hire proposal {id}")))?;
    Ok(Json(proposal_view(&record)))
}

/// File a new version of a proposal head office sent back.
///
/// The earlier versions stay readable. Only a returned proposal may be
/// revised — the domain refuses the rest — because revising one still awaiting
/// an answer would change the terms under the person reading them.
pub async fn revise(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<ReviseBody>,
) -> Result<Json<HireProposalView>, AppError> {
    require(&principal, actions::HIRE_PROPOSAL_PROPOSE)?;
    let mut record = reachable(&state, &principal, &id).await?;
    let was = record.proposal.state();
    let terms = terms(
        &body.position,
        body.headcount,
        &body.need,
        &body.candidate_name,
        body.start_on,
        &body.contract_kind,
        body.contract_ends_on,
        body.base_pay_minor,
    )?;
    record
        .proposal
        .revise(
            terms,
            authorize(&principal, actions::HIRE_PROPOSAL_PROPOSE, &body.reason)?,
        )
        .map_err(infrastructure::hire_error)?;
    infrastructure::save_hire_proposal(&state.db, &record.proposal, was).await?;
    read_back(&state, &id).await
}

/// Head office's answer.
///
/// No reach check: the deciding key is at the Admin rung and Admin's reach is
/// everywhere, so a bound here would refuse nobody and would read as a control.
/// The bound that matters is the one a rung cannot express — the proposer may
/// not decide their own — and it lives in the domain, on the actor.
pub async fn decide(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<DecisionBody>,
) -> Result<Json<HireProposalView>, AppError> {
    require(&principal, actions::HIRE_PROPOSAL_DECIDE)?;
    let decision = HireDecision::parse(&body.decision).ok_or_else(|| {
        AppError::Validation(format!(
            "{:?} is not a decision: expected APPROVE, RETURN or REJECT",
            body.decision
        ))
    })?;
    let mut record = infrastructure::load_hire_proposal(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("hire proposal {id}")))?;
    let was = record.proposal.state();
    record
        .proposal
        .decide(
            decision,
            authorize(&principal, actions::HIRE_PROPOSAL_DECIDE, &body.reason)?,
        )
        .map_err(infrastructure::hire_error)?;
    infrastructure::save_hire_proposal(&state.db, &record.proposal, was).await?;
    read_back(&state, &id).await
}

/// Open the employment record an approved proposal permits.
///
/// Everything this writes belongs to the employment kernel: [`Employee`] mints
/// the candidate, [`AssignmentSpan`] posts them to the unit that asked for
/// them, and both are written by `postgres::employment`. The unit and the start
/// date come from the *approved version* rather than from the body, because
/// what was approved is what may be acted on.
///
/// **The record is a `CANDIDATE`, and that is the end of this feature.** No
/// `HIRE` event is recorded here: the owner's decision is that approval does
/// not make anybody an active employee, and the day somebody actually starts is
/// a fact nobody has observed yet. `POST /employees/{id}/employment` records it
/// when they do. No contract and no pay agreement either — the proposal carries
/// a proposed kind and a proposed figure, and an agreement is a thing somebody
/// signs (0105, `employee_contract`).
///
/// # The order of the three writes, and why it is this one
///
/// `register_employee` and `replace_assignments` each open their own
/// transaction, so the three writes cannot be one. The proposal's step is
/// recorded **first**, deliberately. If a later write fails, the proposal says
/// a record was opened and names an id that does not exist — visible, and
/// fixable with the routes that already exist. The other order fails the other
/// way: the employment record exists, the proposal still says a person is
/// outstanding, and the obvious retry creates a *second* employment record for
/// one approved position. A duplicate employee is the failure this arithmetic
/// exists to prevent, so the order that cannot produce one wins.
pub async fn open_employment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(id): Path<String>,
    Json(body): Json<OpenEmploymentBody>,
) -> Result<Json<HireProposalView>, AppError> {
    // The same key that creates a candidate directly: two ways in, one employee
    // record out. See `actions::HIRE_EMPLOYING`.
    require(&principal, actions::EMPLOYEE_CREATE)?;
    let mut record = infrastructure::load_hire_proposal(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("hire proposal {id}")))?;
    let was = record.proposal.state();

    let employee_id = format!("emp_{}", Uuid::new_v4().simple());
    let employee = Employee::try_register(&employee_id, &body.employee_code).map_err(invalid)?;
    let place = record.proposal.place().clone();
    let starts_on = record.proposal.current().start_on();

    // Asked before the step is recorded, not after. `register_employee` holds
    // the authoritative check inside its own transaction, but by then the
    // proposal already says a record was opened — and a badge number somebody
    // else already has is the most ordinary mistake on this form. Answered here
    // it is a conflict the caller can fix; answered there it would leave a
    // FILLED proposal naming a record that was never written.
    if let Some(holder) =
        infrastructure::employee_code_taken_by(&state.db, employee.code().as_str()).await?
    {
        return Err(AppError::Conflict(format!(
            "employee code {} already belongs to {holder}",
            employee.code()
        )));
    }

    record
        .proposal
        .open_employment(
            EmployeeId::try_new(&employee_id).map_err(invalid)?,
            authorize(&principal, actions::EMPLOYEE_CREATE, &body.reason)?,
        )
        .map_err(infrastructure::hire_error)?;
    infrastructure::save_hire_proposal(&state.db, &record.proposal, was).await?;

    // Reported, never swallowed. The proposal already names this record, so a
    // caller who saw a bare 500 would be left with a proposal pointing at an
    // employee that does not exist and no way to tell.
    let opened = async {
        infrastructure::register_employee(&state.db, &employee).await?;
        let mut postings = AssignmentTimeline::new();
        postings
            .push(
                AssignmentSpan::try_new(
                    place,
                    starts_on,
                    None,
                    authorize(&principal, actions::ASSIGNMENT_MANAGE, &body.reason)?,
                )
                .map_err(invalid)?,
            )
            .map_err(|error| AppError::Conflict(error.to_string()))?;
        infrastructure::replace_assignments(&state.db, &employee_id, &postings).await
    }
    .await;
    if let Err(error) = opened {
        return Err(AppError::Configuration(format!(
            "hire proposal {id} records that employment record {employee_id} was opened, but it \
             could not be written: {error}. Create it in People > Directory with that code."
        )));
    }

    // Filed against the employee, not the proposal: this is the act that made
    // an employment record exist, and the Directory sheet is where somebody
    // goes looking for why one does. The proposal's own history already carries
    // the step.
    acted_on.set(RecordKind::Employee, employee_id);
    read_back(&state, &id).await
}
