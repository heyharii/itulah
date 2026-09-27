//! The end of employment, on the wire: the interview at the door and the
//! statement that closes a leaver's books.
//!
//! # Two keys, and neither is the store's
//!
//! The interview is created by the machine when employment ends, and read
//! like any person-attached record — `people.employee.read` plus the
//! caller's reach, so a shop sees its own leavers and head office sees all.
//! Completing or cancelling it is `people.exit_interview.file` (ADMIN): the
//! store is a party to the exit, and does not hold the pen. The whole Full &
//! Final statement — reading, creating, settling, cancelling — is
//! `people.fnf.settle`, because the statement settles across places: an
//! advance taken at one shop, a claim sanctioned at another, one journal at
//! head office. No place-scoped grant could hold that without the settlement
//! crossing a bound the grant cannot name.
//!
//! # The settle is one transaction, or it is nothing
//!
//! Creating a statement freezes the live reads; settling re-reads the same
//! sources inside the settle's own transaction and refuses on drift, naming
//! what moved. The journal and the state flip share that transaction, so
//! there is no instant at which a statement says SETTLED and the books have
//! not heard of it. A second attempt is a 409 from the database's
//! idempotency key, not from a status check two racing requests can both
//! pass.

use super::auth::Principal;
use super::employment::{invalid, reach_of};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, Authorization, EmployeeId, EmployeeStance,
        ExitId, ExitInterview, FnfAssetRow, FnfId, FullAndFinalStatement, PlaceId,
    },
    postgres::{self as infrastructure, FnfView},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
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

// ── exit interviews ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InterviewQuery {
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub employee: Option<String>,
}

/// The interviews, bounded by the caller's reach: a shop sees its own
/// leavers, head office sees all of them.
pub async fn list_interviews(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<InterviewQuery>,
) -> Result<Json<Vec<infrastructure::ExitInterviewView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let reach = reach_of(&state, &principal).await?;
    if reach.is_nowhere() {
        return Err(AppError::Forbidden(format!(
            "{} has no open posting, so no place's exits are theirs to read",
            principal.username
        )));
    }
    Ok(Json(
        infrastructure::list_exit_interviews(
            &state.db,
            query.state.as_deref(),
            query.employee.as_deref(),
            reach.sole_place().map(|place| place.as_str()),
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateInterviewBody {
    pub employee_id: String,
    /// Only for a backfill whose person was never posted anywhere — the
    /// automatic path reads the posting history instead, because the
    /// interview belongs to the place the person worked, not to the desk
    /// that filed the paperwork.
    #[serde(default)]
    pub place_id: Option<String>,
}

/// Open the PENDING row by hand — head office's backfill for a termination
/// that predates the automatic hook. The person must have actually left: a
/// withdrawn offer is not a departure, and an interview for somebody never
/// hired is an appointment nobody can keep. The row is one per person; a
/// second attempt returns the one that is already there.
pub async fn create_interview(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<CreateInterviewBody>,
) -> Result<Json<infrastructure::ExitInterviewView>, AppError> {
    require(&principal, actions::EXIT_INTERVIEW_FILE)?;
    let record = infrastructure::load_employee(&state.db, &body.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", body.employee_id)))?;
    if !record.employee.status().is_terminal() {
        return Err(AppError::Conflict(format!(
            "{} has not left; an exit interview is for somebody who has",
            body.employee_id
        )));
    }

    let place = match body.place_id.as_deref() {
        Some(place_id) if !place_id.trim().is_empty() => Some(place_id.trim().to_owned()),
        _ => infrastructure::leaver_place_of(&state.db, &body.employee_id).await?,
    }
    .ok_or_else(|| {
        AppError::Conflict(format!(
            "{} was never posted anywhere, so there is no place their interview can sit in; \
             name one in the request",
            body.employee_id
        ))
    })?;

    let interview = ExitInterview::open(
        ExitId::try_new(&Uuid::new_v4().to_string()).map_err(invalid)?,
        EmployeeId::try_new(&body.employee_id)
            .map_err(|error| AppError::Validation(error.to_string()))?,
        PlaceId::try_new(&place).map_err(invalid)?,
    );
    infrastructure::insert_exit_interview(&state.db, &interview).await?;
    let exit_id = Uuid::parse_str(interview.id().as_str())
        .map_err(|error| AppError::Validation(format!("exit id: {error}")))?;
    // The person's own row, when the insert did nothing: idempotent, not a
    // conflict — the answer to "open it" is "it is open".
    infrastructure::load_exit_interview(&state.db, exit_id)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!("stored interview does not hydrate: {exit_id}"))
        })
        .map(Json)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletionBody {
    /// `RETAINED` or `EXIT_CONFIRMED` — the interview's one question.
    pub stance: String,
    #[serde(default)]
    pub summary: Option<String>,
}

/// Answer it. Head office's, under the interview key; the domain refuses a
/// second answer and the conditional UPDATE refuses a second racer.
pub async fn completion(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(exit_id): Path<Uuid>,
    Json(body): Json<CompletionBody>,
) -> Result<Json<infrastructure::ExitInterviewView>, AppError> {
    require(&principal, actions::EXIT_INTERVIEW_FILE)?;
    let mut interview = infrastructure::load_interview(&state.db, exit_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("exit interview {exit_id}")))?;
    let stance = EmployeeStance::parse(&body.stance).ok_or_else(|| {
        AppError::Validation(format!(
            "{:?} is not a stance: expected RETAINED or EXIT_CONFIRMED",
            body.stance
        ))
    })?;
    interview
        .complete(
            stance,
            body.summary,
            &principal.username,
            Utc::now(),
            Authorization::try_new(
                &principal.username,
                actions::EXIT_INTERVIEW_FILE,
                Utc::now(),
                "exit interview completed",
            )
            .map_err(invalid)?,
        )
        .map_err(infrastructure::exit_error)?;
    infrastructure::record_completion(&state.db, &interview).await?;
    infrastructure::load_exit_interview(&state.db, exit_id)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!("stored interview does not hydrate: {exit_id}"))
        })
        .map(Json)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InterviewCancellationBody {
    pub reason: String,
}

/// Mark it never held. The honest answer to "the person left and the
/// interview never happened": a name and a reason, never silence.
pub async fn interview_cancellation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(exit_id): Path<Uuid>,
    Json(body): Json<InterviewCancellationBody>,
) -> Result<Json<infrastructure::ExitInterviewView>, AppError> {
    require(&principal, actions::EXIT_INTERVIEW_FILE)?;
    let mut interview = infrastructure::load_interview(&state.db, exit_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("exit interview {exit_id}")))?;
    interview
        .cancel(
            &body.reason,
            &principal.username,
            Authorization::try_new(
                &principal.username,
                actions::EXIT_INTERVIEW_FILE,
                Utc::now(),
                &body.reason,
            )
            .map_err(invalid)?,
        )
        .map_err(infrastructure::exit_error)?;
    infrastructure::record_interview_cancellation(&state.db, &interview).await?;
    infrastructure::load_exit_interview(&state.db, exit_id)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!("stored interview does not hydrate: {exit_id}"))
        })
        .map(Json)
}

// ── the Full & Final statement ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FnfQuery {
    #[serde(default)]
    pub employee: Option<String>,
}

/// The statements. Head office's read, under the settle key — the whole
/// statement is, because it settles across places.
pub async fn list_statements(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<FnfQuery>,
) -> Result<Json<Vec<FnfView>>, AppError> {
    require(&principal, actions::FNF_SETTLE)?;
    let records = infrastructure::list_full_and_final(&state.db, query.employee.as_deref()).await?;
    records
        .iter()
        .map(infrastructure::fnf_view)
        .collect::<Result<Vec<FnfView>, AppError>>()
        .map(Json)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FnfAssetBody {
    pub asset_id: Uuid,
    pub note: String,
    pub recovery_minor: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateStatementBody {
    pub employee_id: String,
    pub transaction_on: NaiveDate,
    /// The last approved run's gross, or a stated figure. Absent means "the
    /// last approved run's gross" rather than zero: the figure already exists
    /// on a slip head office has signed for, so copying it is not inventing a
    /// wage. If there has never been an approved run the request is refused —
    /// a settlement over no payroll is a decision somebody has to state.
    #[serde(default)]
    pub final_pay_minor: Option<i64>,
    #[serde(default)]
    pub assets: Vec<FnfAssetBody>,
}

/// Draft the statement, freezing the live reads. Creation is the moment the
/// leaver's books stop moving for this settlement — settle compares against
/// exactly these totals and refuses on drift, naming what moved.
pub async fn create_statement(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<CreateStatementBody>,
) -> Result<Json<FnfView>, AppError> {
    require(&principal, actions::FNF_SETTLE)?;
    // Loading is the existence check; the place comes from the posting
    // history, never from the body.
    infrastructure::load_employee(&state.db, &body.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", body.employee_id)))?;
    let place = infrastructure::leaver_place_of(&state.db, &body.employee_id)
        .await?
        .ok_or_else(|| {
            AppError::Conflict(format!(
                "{} was never posted anywhere, so there is no place their statement can sit in",
                body.employee_id
            ))
        })?;

    let mut assets = Vec::with_capacity(body.assets.len());
    for row in &body.assets {
        assets.push(
            FnfAssetRow::try_new(
                Uuid::new_v4().to_string(),
                row.asset_id,
                row.note.clone(),
                row.recovery_minor,
            )
            .map_err(infrastructure::exit_error)?,
        );
    }

    // The frozen reads, at the moment of creation.
    let (advance_outstanding, claim_payable) =
        infrastructure::read_live_sources(&state.db, &body.employee_id).await?;

    // An absent figure means "copy the last approved run", which is what the
    // Exits screen has always said. A zero nobody chose is the one thing this
    // must not become.
    let final_pay_minor = match body.final_pay_minor {
        Some(stated) => stated,
        None => infrastructure::last_approved_gross_minor(&state.db, &body.employee_id)
            .await?
            .ok_or_else(|| {
                AppError::Conflict(format!(
                    "{} has no approved payroll run, so there is no last gross to copy; \
                     state the final pay explicitly",
                    body.employee_id
                ))
            })?,
    };

    let fnf_id = Uuid::new_v4();
    let statement = FullAndFinalStatement::draft(
        FnfId::try_new(&fnf_id.to_string()).map_err(invalid)?,
        EmployeeId::try_new(&body.employee_id)
            .map_err(|error| AppError::Validation(error.to_string()))?,
        PlaceId::try_new(&place).map_err(invalid)?,
        body.transaction_on,
        advance_outstanding,
        claim_payable,
        final_pay_minor,
        assets,
        Authorization::try_new(
            &principal.username,
            actions::FNF_SETTLE,
            Utc::now(),
            "full & final statement drafted",
        )
        .map_err(invalid)?,
    )
    .map_err(infrastructure::exit_error)?;

    infrastructure::insert_full_and_final(&state.db, &statement).await?;
    read_back(&state, fnf_id).await.map(Json)
}

/// Settle it. One journal, one transaction: the drift refusal, the posting
/// and the state flip live or die together. No body — the statement already
/// carries its date, and settling is not the moment to change one.
pub async fn settlement(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(fnf_id): Path<Uuid>,
) -> Result<Json<FnfView>, AppError> {
    require(&principal, actions::FNF_SETTLE)?;
    let mut statement = infrastructure::load_statement(&state.db, fnf_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("full & final statement {fnf_id}")))?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::FNF_SETTLE,
        Utc::now(),
        &format!("settlement of {fnf_id}"),
    )
    .map_err(invalid)?;
    infrastructure::settle_full_and_final(&state.db, &mut statement, authorization).await?;
    read_back(&state, fnf_id).await.map(Json)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CancellationBody {
    pub reason: String,
}

/// Cancel a draft. Only a draft: a settled statement's money has moved, and
/// only a reversal moves it back — Finance's journal, not a second answer
/// here.
pub async fn cancellation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(fnf_id): Path<Uuid>,
    Json(body): Json<CancellationBody>,
) -> Result<Json<FnfView>, AppError> {
    require(&principal, actions::FNF_SETTLE)?;
    let mut statement = infrastructure::load_statement(&state.db, fnf_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("full & final statement {fnf_id}")))?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::FNF_SETTLE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    infrastructure::cancel_full_and_final(&state.db, &mut statement, authorization).await?;
    read_back(&state, fnf_id).await.map(Json)
}

async fn read_back(state: &AppState, fnf_id: Uuid) -> Result<FnfView, AppError> {
    let record = infrastructure::load_full_and_final(&state.db, fnf_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("full & final statement {fnf_id}")))?;
    infrastructure::fnf_view(&record)
}
