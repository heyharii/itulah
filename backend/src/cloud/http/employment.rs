//! Who works here, under what contract, and where they are posted.
//!
//! # Two ways in, and they are not the same way
//!
//! Every route here can be reached by an HR officer asking about somebody, and
//! most can be reached by a person asking about themselves — the employee app
//! calls `/employees/me/profile` on the screen where somebody checks their own
//! bank details are right.
//!
//! Those are different questions. Reading a stranger's NIK and home address is
//! `people.profile.read`, which sits at the top of the ladder; reading your own
//! is not a privilege at all. So [`resolve`] returns not just an id but whether
//! it is the caller's own record, and [`Access::may_read`] lets self-reads past
//! the rung check.
//!
//! # Two things called a profile, and only one of them carries a NIK
//!
//! The reference this is ported from calls personal data — NIK, address, date
//! of birth — a "profile". The employee app means something else entirely by
//! the word: employee number, job title, where you work, when you joined. Both
//! readings are reasonable and they must not share a route, because the route
//! they would share is the one carrying a national identity number.
//!
//! So personal data lives at `/personal-data` behind `people.profile.read`, and
//! `/profile` serves the employment summary behind `people.employee.read`. The
//! summary deliberately carries no NIK, no address and no contact details: a
//! supervisor reading a rota gets a name, a job and a place, and nothing that
//! belongs to the person rather than to the job.
//!
//! Writes are not softened the same way. Somebody amending their own address is
//! still an amendment to a record HR owns, and it still records who authorised
//! it — a person cannot promote themselves by asking about themselves.
//!
//! # Three questions, not two: who, what, and where
//!
//! A rung answers *what*. It does not answer *where*, and every supervisor
//! holds the same one — so until [`Reach`] arrived, a supervisor at any shop
//! could list the whole company's workforce and read any rota in it. Nobody had
//! noticed, because head office was the only caller.
//!
//! So [`Access`] now carries a reach as well as a rung, resolved once per
//! request from the caller's own open posting. A read of somebody else's record
//! passes both gates: the rung says supervisors may read a rota, the reach says
//! *this* supervisor may read *this* shop's. Self-reads bypass both, as before.
//! Admin's reach is everywhere, so nothing head office does changes.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, Address, AssignmentSpan, Authorization,
        Contact, Contract, ContractKind, Employee, EmployeeCode, EmploymentStatus,
        EmploymentTransition, FullName, Grade, Nik, Position, Posting, Profile, ProfileField,
        Reach, RecordKind, UnitId, UnitKind,
    },
    http::audit::DeclaredSubject,
    postgres::{
        self as infrastructure, AccountBinding, EmployeeList, EmployeeRecord, ExpiringContract,
    },
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The path segment that means "the caller".
const SELF: &str = "me";

/// A resolved subject, and whether the caller is asking about themselves.
///
/// Shared with the other HR surfaces — leave, and the roster and payroll that
/// follow — rather than copied into each. A second spelling of "may this caller
/// read this record" is a second answer, and the one that drifts is always the
/// one nobody is looking at.
pub(super) struct Access {
    pub(super) employee_id: String,
    pub(super) own: bool,
    pub(super) principal: Principal,
    /// The places this caller may act in, from their own open posting.
    pub(super) reach: Reach,
}

impl Access {
    /// A read the caller is entitled to.
    ///
    /// Reading your own record is not a privilege. Reading somebody else's is,
    /// and the rung comes from the action key. The *place* is a second gate —
    /// see [`Access::reaches`] — because a rung cannot tell one shop's
    /// supervisor from another's.
    pub(super) fn may_read(&self, action_key: &str) -> Result<(), AppError> {
        if self.own {
            return Ok(());
        }
        self.may(action_key)
    }

    /// A write. Never softened by asking about yourself.
    pub(super) fn may(&self, action_key: &str) -> Result<(), AppError> {
        if role_allows(required_role_for_action(action_key), self.principal.role) {
            return Ok(());
        }
        Err(AppError::Forbidden(format!(
            "{} may not {action_key}",
            self.principal.username
        )))
    }

    /// Is the subject somewhere this caller may reach?
    ///
    /// Called *after* the record is loaded, because the place is a fact about
    /// the record and asking the database twice to avoid loading a row we then
    /// discard would cost a query on every read to save one on the refusals.
    /// Nothing about the record reaches the caller either way.
    ///
    /// Self-reads bypass it for the same reason they bypass the rung: a person
    /// posted nowhere still has their own record, and refusing them their own
    /// employment history because HR has not filed their posting would break
    /// the employee app for exactly the new joiners it is most useful to.
    pub(super) fn reaches(&self, unit_id: Option<&str>) -> Result<(), AppError> {
        if self.own || self.reach.covers(unit_id) {
            return Ok(());
        }
        Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches this record",
            self.principal.username
        )))
    }

    /// The recorded authority for a decision the caller is about to take.
    ///
    /// The actor and the instant come from here, never from the request body:
    /// a handler that accepted either would let a caller sign somebody else's
    /// name to their own decision.
    pub(super) fn authorize(
        &self,
        action_key: &str,
        reason: &str,
    ) -> Result<Authorization, AppError> {
        Authorization::try_new(&self.principal.username, action_key, Utc::now(), reason)
            .map_err(|error| AppError::Validation(error.to_string()))
    }
}

/// The caller's reach, from their own open posting.
///
/// One query, on the routes that need it. Not carried in the session: a rung is
/// a property of the credential and a posting is HR data with a history, so a
/// place stamped into a session is wrong from the transfer until the next
/// sign-in — which is exactly the week it matters.
pub(super) async fn reach_of(state: &AppState, principal: &Principal) -> Result<Reach, AppError> {
    Ok(caller_and_reach(state, principal).await?.1)
}

/// The caller's own employment record, with their reach — for a decision that
/// must know both where the caller may act and *who* they are, so that nobody
/// decides a filing about themselves.
pub(super) async fn caller_and_reach(
    state: &AppState,
    principal: &Principal,
) -> Result<(Option<String>, Reach), AppError> {
    let caller = infrastructure::caller_record(&state.db, &principal.username).await?;
    let reach = reach_from(principal, &caller);
    Ok((caller.employee_id, reach))
}

/// The caller's own open posting, as the domain reads it — with whether they
/// are the PIC of that unit.
fn posting_of(caller: &infrastructure::CallerRecord) -> Option<Posting> {
    let (unit_id, kind) = caller.posting.as_ref()?;
    let posting = Posting::new(
        UnitId::try_new(unit_id).ok()?,
        // A kind this build has not been taught is not head office. It is
        // also not a reason to refuse the request: the unit is still a unit,
        // and `Only` is the conservative reading of an id we can name but
        // cannot classify.
        //
        // Said out loud, though: failing closed silently means a centre one
        // version ahead of this build quietly demotes its head office to a
        // shop for every caller of this function, and nobody ever hears. The
        // reading stays narrow; the log is what makes it visible.
        match UnitKind::parse(kind) {
            Some(kind) => kind,
            None => {
                tracing::warn!(
                    unit = %unit_id,
                    kind,
                    "unit kind is not one this build knows; read as a store's, which grants nothing"
                );
                UnitKind::Store
            }
        },
    );
    Some(if caller.in_charge {
        posting.in_charge()
    } else {
        posting
    })
}

fn reach_from(principal: &Principal, caller: &infrastructure::CallerRecord) -> Reach {
    let posting = posting_of(caller);
    // The job role's own answer to *where* (0700): head office's departments
    // reach every unit; the section gate has already said *what*.
    let reach = Reach::resolve_for(principal.role, principal.job.every_unit, posting.as_ref());
    // A call a store node relayed reaches the node's own place and nothing
    // else, whoever it was relayed for. Here, where every HR handler's reach
    // is resolved, so a list that takes no place in its query is bounded by
    // the node exactly as one that does — see `Reach::bounded_to`.
    match principal.bound_unit() {
        Some(unit) => reach.bounded_to(unit),
        None => reach,
    }
}

/// Turn a path segment into an employee id, resolving `me` from the session.
pub(super) async fn resolve(
    state: &AppState,
    principal: &Principal,
    raw: &str,
) -> Result<Access, AppError> {
    let caller = infrastructure::caller_record(&state.db, &principal.username).await?;
    let mine = caller.employee_id.clone();
    let employee_id = if raw == SELF {
        mine.clone().ok_or_else(|| {
            // Not a 404: the route exists and the session is valid. There is
            // simply no employment record behind this login yet, which is a
            // state HR has to fix, not the caller.
            AppError::NotFound(format!(
                "no employment record is bound to {}",
                principal.username
            ))
        })?
    } else {
        raw.to_owned()
    };
    Ok(Access {
        own: mine.as_deref() == Some(employee_id.as_str()),
        employee_id,
        reach: reach_from(principal, &caller),
        principal: principal.clone(),
    })
}

/// Where a record sits, for the reach check. `None` for somebody nobody has
/// posted yet.
pub(super) fn current_unit(record: &EmployeeRecord) -> Option<&str> {
    record
        .assignments
        .current()
        .map(|span| span.unit_id().as_str())
}

/// One employment record, for a sibling surface that gates on it the way
/// this one does (`http::dossier`).
pub(super) async fn load_record(
    state: &AppState,
    employee_id: &str,
) -> Result<EmployeeRecord, AppError> {
    record(state, employee_id).await
}

async fn record(state: &AppState, employee_id: &str) -> Result<EmployeeRecord, AppError> {
    infrastructure::load_employee(&state.db, employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {employee_id}")))
}

pub(super) fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

// ── views ────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssignmentView {
    pub unit_id: String,
    /// The place's own name. Sent because a screen showing `ho` where it means
    /// "Head Office" is an identifier that has escaped into the interface.
    pub unit_name: Option<String>,
    pub valid_from: NaiveDate,
    pub valid_to: Option<NaiveDate>,
    pub actor: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmploymentEventView {
    pub transition: String,
    pub from: String,
    pub to: String,
    pub effective_on: NaiveDate,
    pub actor: String,
    pub reason: String,
    pub at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeCodeCorrectionView {
    pub from: String,
    pub to: String,
    pub actor: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeView {
    pub employee_id: String,
    pub employee_code: String,
    pub status: EmploymentStatus,
    /// Whether this person may be picked for new work. Sent rather than left
    /// for the browser to derive, so nothing downstream invents its own idea of
    /// "still here" and disagrees with the domain.
    pub selectable: bool,
    pub current_unit_id: Option<String>,
    pub current_unit_name: Option<String>,
    pub assignments: Vec<AssignmentView>,
    /// The login bound to this record, when there is one.
    ///
    /// On the record rather than left to the list it was read from. The sheet
    /// used to take it from the row the table happened to be holding, so a
    /// record opened by URL — a link in a message, a bookmark, anything past
    /// the list's limit — showed "None" for somebody who had a login. A sheet
    /// that says a person cannot sign in when they can is worse than one that
    /// says nothing.
    ///
    /// Carries the username, whether it still opens anything, and who bound
    /// it. Not the rung: `people.employee.read` is a supervisor's grant and
    /// reading the account list is an administrator's, so a rota screen is not
    /// where somebody learns which of their colleagues is an admin.
    pub account: Option<AccountBinding>,
    pub history: Vec<EmploymentEventView>,
    pub code_history: Vec<EmployeeCodeCorrectionView>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Personal data. Its own view, reached by its own route, gated by its own key.
///
/// Deliberately not folded into [`EmployeeView`]. A workforce list shows
/// employees; it has no business carrying sixteen digits of national identity
/// number and a home address because somebody added a field to a struct.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PersonalDataView {
    pub employee_id: String,
    pub full_name: String,
    pub nik: String,
    pub birth_date: NaiveDate,
    pub address: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub amendments: Vec<ProfileAmendmentView>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProfileAmendmentView {
    pub field: String,
    pub actor: String,
    pub at: DateTime<Utc>,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ContractView {
    /// `PKWT` or `PKWTT`.
    pub kind: String,
    pub starts_on: NaiveDate,
    pub ends_on: Option<NaiveDate>,
    pub position: String,
    pub grade: String,
    /// Whether this is the contract in force on the date asked about.
    pub in_force: bool,
    pub actor: String,
    pub reason: String,
}

/// A run of back-to-back fixed terms. Facts only — whether it has converted to
/// permanent employment by operation of law is not ours to assert.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PkwtRunView {
    pub terms: usize,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub days: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ContractsView {
    pub employee_id: String,
    pub contracts: Vec<ContractView>,
    pub pkwt_run: Option<PkwtRunView>,
}

/// Who somebody is at work: the answer the employee app asks for on the screen
/// where a person checks their own details.
///
/// Assembled rather than stored — every field is derived from something already
/// recorded. `joined_on` in particular is read out of the employment history
/// (the first HIRE) rather than kept as a column, so it cannot drift from the
/// events that produced it.
///
/// Carries no NIK, no address and no contact details. Those are `/personal-data`
/// and a different grant; this view is reachable by anyone who may read the
/// workforce, which is a much wider audience.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmploymentProfileView {
    pub employee_id: String,
    pub employee_code: String,
    /// Absent until personal data has been enrolled — a record can exist before
    /// anybody has typed a name into it.
    pub full_name: Option<String>,
    pub status: EmploymentStatus,
    /// From the most recent contract. Absent before the first one is signed.
    pub job_title: Option<String>,
    pub grade: Option<String>,
    /// The open posting, if there is one.
    pub unit_id: Option<String>,
    pub unit_name: Option<String>,
    /// The day the first HIRE took effect. Absent for somebody still a
    /// candidate, which is the honest answer: they have not joined.
    pub joined_on: Option<NaiveDate>,
}

fn assignment_views(record: &EmployeeRecord) -> Vec<AssignmentView> {
    record
        .assignments
        .spans()
        .iter()
        .map(|span| AssignmentView {
            unit_id: span.unit_id().to_string(),
            unit_name: record.unit_names.get(span.unit_id().as_str()).cloned(),
            valid_from: span.from(),
            valid_to: span.to(),
            actor: span.authorization().actor().to_string(),
            reason: span.authorization().reason().to_string(),
        })
        .collect()
}

fn employee_view(record: &EmployeeRecord) -> EmployeeView {
    EmployeeView {
        employee_id: record.employee.id().to_string(),
        employee_code: record.employee.code().to_string(),
        status: record.employee.status(),
        selectable: record.employee.status().is_selectable(),
        current_unit_id: record
            .assignments
            .current()
            .map(|span| span.unit_id().to_string()),
        current_unit_name: record
            .assignments
            .current()
            .and_then(|span| record.unit_names.get(span.unit_id().as_str()).cloned()),
        assignments: assignment_views(record),
        account: record.account.clone(),
        history: record
            .employee
            .history()
            .iter()
            .map(|event| EmploymentEventView {
                transition: event.transition().code().to_owned(),
                from: event.from().code().to_owned(),
                to: event.to().code().to_owned(),
                effective_on: event.effective_on(),
                actor: event.authorization().actor().to_string(),
                reason: event.authorization().reason().to_string(),
                at: event.authorization().at(),
            })
            .collect(),
        code_history: record
            .employee
            .code_history()
            .iter()
            .map(|correction| EmployeeCodeCorrectionView {
                from: correction.from().to_string(),
                to: correction.to().to_string(),
                actor: correction.authorization().actor().to_string(),
                reason: correction.authorization().reason().to_string(),
            })
            .collect(),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

pub(super) fn personal_data_view(employee_id: &str, profile: &Profile) -> PersonalDataView {
    PersonalDataView {
        employee_id: employee_id.to_owned(),
        full_name: profile.name().as_str().to_owned(),
        nik: profile.nik().as_str().to_owned(),
        birth_date: profile.birth_date(),
        address: profile.address().as_str().to_owned(),
        phone: profile.phone().map(|value| value.as_str().to_owned()),
        email: profile.email().map(|value| value.as_str().to_owned()),
        amendments: profile
            .amendments()
            .iter()
            .map(|amendment| ProfileAmendmentView {
                field: amendment.change().field().to_owned(),
                actor: amendment.authorization().actor().to_string(),
                at: amendment.authorization().at(),
                reason: amendment.authorization().reason().to_string(),
            })
            .collect(),
    }
}

fn contracts_view(record: &EmployeeRecord, as_of: NaiveDate) -> ContractsView {
    ContractsView {
        employee_id: record.employee.id().to_string(),
        contracts: record
            .contracts
            .contracts()
            .iter()
            .map(|contract| ContractView {
                kind: contract.kind().code().to_owned(),
                starts_on: contract.starts_on(),
                ends_on: contract.ends_on(),
                position: contract.position().as_str().to_owned(),
                grade: contract.grade().as_str().to_owned(),
                in_force: contract.covers(as_of),
                actor: contract.authorization().actor().to_string(),
                reason: contract.authorization().reason().to_string(),
            })
            .collect(),
        pkwt_run: record.contracts.pkwt_run().map(|run| PkwtRunView {
            terms: run.terms,
            from: run.from,
            to: run.to,
            days: run.days(),
        }),
    }
}

// ── request bodies ───────────────────────────────────────────────────────

/// What the workforce list was asked for.
///
/// A typed struct where `GET /finance/money` reads `Query<Vec<(String, String)>>`,
/// and the difference is not a second convention: that route's facets are
/// multi-select, so `?pot=CASH&pot=BANK` has to survive, and a struct's
/// deserializer keeps the last value and drops the rest in silence. Nothing
/// here repeats — a status is one of four and a place is one place — so the
/// struct keeps what it is worth keeping: `deny_unknown_fields`, which refuses
/// `?statuss=ACTIVE` instead of quietly listing the whole company under a
/// filter the caller believes is applied.
///
/// That strictness is also why every new parameter below is additive. A caller
/// on the old shape sends `status`, `unit_id` and `limit`, all still here and
/// all still meaning what they did.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListQuery {
    /// Free text over the employee number and the person's name.
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    /// A place to narrow to — and, for a bounded caller, a place they must be
    /// posted to. See [`list`]: naming somebody else's shop is refused, never
    /// quietly replaced with their own.
    #[serde(default)]
    pub unit_id: Option<String>,
    /// `PKWT`, `PKWTT` or `NONE` — the latest contract's kind.
    #[serde(default)]
    pub contract_kind: Option<String>,
    /// The latest contract's position, compared whole.
    #[serde(default)]
    pub position: Option<String>,
    /// `1` for a bound login, `0` for none.
    #[serde(default)]
    pub login: Option<String>,
    /// `code`, `name`, `contract_end` or `place`. Anything else is the house
    /// order rather than a 400 — see `EmployeeScope::sort`.
    #[serde(default)]
    pub sort: Option<String>,
    /// `desc` and nothing else. Absent, empty and anything unrecognised all
    /// mean ascending, which is the direction a list is in before anybody
    /// touches it.
    #[serde(default)]
    pub dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterBody {
    pub employee_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransitionBody {
    /// `HIRE`, `SUSPEND`, `REINSTATE` or `TERMINATE`.
    pub transition: String,
    pub effective_on: NaiveDate,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CodeBody {
    pub employee_code: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssignBody {
    pub unit_id: String,
    pub valid_from: NaiveDate,
    #[serde(default)]
    pub valid_to: Option<NaiveDate>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkBody {
    pub username: String,
    /// Why this login is this person's. Required for the same reason every
    /// other employment write requires one: a binding somebody cannot explain
    /// afterwards is a binding nobody can audit.
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseBody {
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrolPersonalDataBody {
    pub full_name: String,
    pub nik: String,
    pub birth_date: NaiveDate,
    pub address: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmendPersonalDataBody {
    /// Exactly one field per amendment. Two at once would be two changes
    /// recorded as one, and the audit trail would say less than it appears to.
    pub field: String,
    /// Absent means "clear it", which only phone and email allow.
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub birth_date: Option<NaiveDate>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContractBody {
    /// `PKWT` or `PKWTT`.
    pub kind: String,
    pub starts_on: NaiveDate,
    /// Required for `PKWT`, refused for `PKWTT`. The domain says so, and so
    /// does the table.
    #[serde(default)]
    pub ends_on: Option<NaiveDate>,
    pub position: String,
    pub grade: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpiringQuery {
    /// The date to count from. Defaults to today.
    #[serde(default)]
    pub as_of: Option<NaiveDate>,
    /// How far ahead to look. Defaults to thirty days — the notice period the
    /// workforce screen's first saved view is built around.
    #[serde(default)]
    pub within_days: Option<i64>,
}

// ── handlers ─────────────────────────────────────────────────────────────

/// The workforce, as far as the caller can see it.
///
/// The reach bound is the fix for a gap nobody had noticed: this route was
/// rung-only, so a supervisor at any shop could page through every employee in
/// the company. The Directory was the only caller and only head office opened
/// it, which is how it went unremarked rather than why it was safe.
///
/// A bounded caller who names a place they cannot reach is refused rather than
/// silently re-filtered. Quietly answering a different question than the one
/// asked is how somebody concludes store-03 has the same staff as store-07.
///
/// # Why searching and sorting moved to the server
///
/// It answers with an envelope — rows, a cursor, a total and facet counts — in
/// the shape `GET /finance/money` established, because the alternative this
/// replaces was the hub fetching a thousand rows and sorting them in the
/// browser. That works until the thousand-and-first person is hired, and the
/// way it stops working is a directory that is quietly missing somebody and a
/// contract-expiry sort that only ordered the rows it happened to have. A sort
/// that lives on the server survives paging; one that lives in the browser is
/// a sort of the first page.
///
/// The reach gate below is deliberately untouched by all of that, and runs
/// before any of it. The place a bounded caller is served is still their own
/// posting, the place they may ask for is still only that one, and the refusal
/// still names the place they asked for. Two things now carry it into the
/// query — the filter and the fence — for the reason `EmployeeScope::reach_place`
/// gives.
pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ListQuery>,
) -> Result<Json<EmployeeList>, AppError> {
    if !role_allows(
        required_role_for_action(actions::EMPLOYEE_READ),
        principal.role,
    ) {
        return Err(AppError::Forbidden(format!(
            "{} may not read the workforce",
            principal.username
        )));
    }
    let reach = reach_of(&state, &principal).await?;
    if reach.is_nowhere() {
        return Err(AppError::Forbidden(format!(
            "{} has no open posting, so no unit's workforce is theirs to read",
            principal.username
        )));
    }
    let unit_filter = match (reach.sole_unit(), query.unit_id.as_deref()) {
        // Unbounded: the caller's filter, whatever it is.
        (None, asked) => asked.map(str::to_owned),
        // Bounded and asked for their own place, or asked for nothing.
        (Some(mine), None) => Some(mine.to_string()),
        (Some(mine), Some(asked)) if asked == mine.as_str() => Some(mine.to_string()),
        (Some(_), Some(asked)) => {
            return Err(AppError::Forbidden(format!(
                "{} is not posted to {asked}",
                principal.username
            )));
        }
    };
    Ok(Json(
        infrastructure::list_employees(
            &state.db,
            infrastructure::EmployeeScope {
                // The fence, beside the filter. `place_filter` is what the
                // caller asked for once it has been reconciled above; this is
                // what their own posting allows, whatever they asked. They are
                // the same value for a bounded caller today — and the query
                // applies both, so the day somebody edits the reconciliation
                // without reading it, the answer narrows rather than widens.
                reach_unit: reach.sole_unit().map(ToString::to_string),
                needle: query.q,
                status: query.status,
                unit_id: unit_filter,
                contract_kind: query.contract_kind,
                position: query.position,
                login: query.login,
                sort: query.sort,
                desc: query.dir.as_deref() == Some("desc"),
                cursor: query.cursor,
                // Clamped where it is enforced, not here: one spelling of "how
                // much of the company one request may see".
                limit: query.limit,
            },
        )
        .await?,
    ))
}

/// How far this caller reaches, and where they are posted.
///
/// One read so the head-office console can draw the right sidebar without
/// re-deriving the rule in the browser. It answers *scope*, not permission:
/// what a caller may do at the places they reach is still `required_role`'s,
/// and every route re-checks both. A screen hidden here is a convenience; a
/// route refused there is the control.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReachView {
    /// `EVERYWHERE`, `ONE_UNIT` or `NOWHERE`.
    pub scope: String,
    /// The caller's own open posting, when they have one. Present even for
    /// `EVERYWHERE`: an HR officer posted to head office is still posted
    /// somewhere, and the screen says so.
    pub unit_id: Option<String>,
    pub unit_name: Option<String>,
    /// `unit.kind`: `HO` or `STORE` (`ONLINE` once that unit is opened).
    ///
    /// Never `DC`: migration 0230 folded the distribution centre into head
    /// office — the owner's decision of 2026-09-13 — and since 0600 the
    /// warehouse is a site of the head-office unit (the Gudang), not a unit.
    /// `site.kind` is a different question: what kind of premises.
    pub unit_kind: Option<String>,
    /// Whether the caller is the PIC in force at their unit (0602).
    pub in_charge: bool,
    /// The rung the session holds. Sent here rather than left to a second call
    /// to `/auth/me`, because scope and rung are one decision on the screen
    /// that reads them and two requests would let them disagree by a refresh.
    pub role: String,
    /// Whether an employment record is bound to this login at all. `null` says
    /// "this account is nobody's" — a machine account, or a login HR has not
    /// finished the paperwork for — which is why the reach is `NOWHERE`.
    pub employee_id: Option<String>,
}

pub async fn reach(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<ReachView>, AppError> {
    let caller = infrastructure::caller_record(&state.db, &principal.username).await?;
    let reach = reach_from(&principal, &caller);
    let mut in_charge = caller.in_charge;
    let (mut unit_id, mut unit_kind) = match caller.posting {
        Some((unit_id, kind)) => (Some(unit_id), Some(kind)),
        None => (None, None),
    };
    let mut unit_name = caller.unit_name;
    // Through a store's till, the place the screen works in is the till's —
    // an Admin posted to head office reaches store-07 there, and a screen told
    // `ho` would ask for head office's roster and be refused.
    if let Some(bound) = principal.bound_unit().filter(|_| !reach.is_nowhere()) {
        if unit_id.as_deref() != Some(bound.as_str()) {
            unit_id = Some(bound.as_str().to_owned());
            unit_name = None;
            unit_kind = None;
            // In charge of their own unit, not of the one whose till this is.
            in_charge = false;
        }
    }
    Ok(Json(ReachView {
        scope: reach.code().to_owned(),
        unit_id,
        unit_name,
        unit_kind,
        in_charge,
        role: principal.role.as_str().to_owned(),
        employee_id: caller.employee_id,
    }))
}

pub async fn register(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(body): Json<RegisterBody>,
) -> Result<Json<EmployeeView>, AppError> {
    // A registration has no subject yet, so there is no place to reach into —
    // but the reach is resolved rather than stubbed, so that a later gate added
    // here asks the caller's real posting instead of a placeholder that would
    // refuse head office.
    let access = Access {
        employee_id: String::new(),
        own: false,
        reach: reach_of(&state, &principal).await?,
        principal,
    };
    access.may(actions::EMPLOYEE_CREATE)?;

    // The id is minted here and never taken from the caller: an id chosen by a
    // client is an id that can be made to collide with somebody else's.
    let employee_id = format!("emp_{}", Uuid::new_v4().simple());
    let employee = Employee::try_register(&employee_id, &body.employee_code).map_err(invalid)?;
    infrastructure::register_employee(&state.db, &employee).await?;
    acted_on.set(RecordKind::Employee, employee_id.clone());
    Ok(Json(employee_view(&record(&state, &employee_id).await?)))
}

pub async fn detail(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    let record = record(&state, &access.employee_id).await?;
    access.reaches(current_unit(&record))?;
    Ok(Json(employee_view(&record)))
}

pub async fn transition(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<TransitionBody>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::EMPLOYMENT_CHANGE)?;

    let transition = EmploymentTransition::parse(&body.transition).ok_or_else(|| {
        AppError::Validation(format!(
            "{:?} is not a transition: expected HIRE, SUSPEND, REINSTATE or TERMINATE",
            body.transition
        ))
    })?;
    // `subject` rather than `record`: the reload at the end calls the function
    // of that name, and a local would have shadowed it.
    let mut subject = record(&state, &access.employee_id).await?;
    let authorization = access.authorize(actions::EMPLOYMENT_CHANGE, &body.reason)?;
    subject
        .employee
        .apply(transition, body.effective_on, authorization)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::save_employee(&state.db, &subject.employee).await?;

    // The half of 0060's comment that was never written. See [`close_login`].
    if matches!(
        subject.employee.status(),
        EmploymentStatus::Terminated | EmploymentStatus::Suspended
    ) {
        let event = subject.employee.history().len().saturating_sub(1);
        close_login(
            &state,
            &access.principal.username,
            &access.employee_id,
            event,
        )
        .await?;
    }

    // Re-read rather than serving `subject`: the view now carries the login, and
    // the copy in hand still says it is open.
    Ok(Json(employee_view(
        &record(&state, &access.employee_id).await?,
    )))
}

/// Close the login of somebody who has just left or been suspended.
///
/// 0060 joined `app_user` to `employee` and promised this in a comment —
/// *"the account is disabled by the code that handles leaving, in daylight"* —
/// and then nobody wrote it. Terminating somebody recorded an employment event
/// and left their credential working: at the centre, and through the policy
/// snapshot (`(a.active AND u.active)`) at every till they were assigned to.
/// The record said TERMINATED and the door still opened.
///
/// Suspension closes it too. A suspension is an investigation or an unpaid
/// stand-down; somebody sent home under one who can still sign into a till has
/// been sent home from the shop and not from the system, which is the half that
/// holds the money.
///
/// **Coming back does not reopen it.** REINSTATE restores employment, not
/// credentials: the reason a suspended person's login was closed can outlive
/// the suspension, and handing a credential back is a decision with an actor
/// and a record of its own — `System › Accounts`, which already has both. The
/// employee view says the account is still shut, so nobody has to guess.
///
/// The caller's own account is left alone. `set_user_active` refuses
/// self-deactivation so a node always keeps one usable administrator, and an
/// HR officer ending their own employment must not be the exception that
/// empties the room.
///
/// `event` is the place in the employment history of the leaving this
/// answers: each is handled once (`close_login_on_leaving`), so the HR
/// scheduler does not close again a login somebody opened since. An approved
/// Separation in People › Changes comes here too (`people.rs`).
pub(super) async fn close_login(
    state: &AppState,
    actor: &str,
    employee_id: &str,
    event: usize,
) -> Result<(), AppError> {
    // Failure is reported, never swallowed. The employment change is already
    // committed, so a caller who saw a bare 500 would be left with a record
    // saying TERMINATED and a live credential, and no way to tell.
    if let Err(error) =
        infrastructure::close_login_on_leaving(&state.db, employee_id, event, actor).await
    {
        let login = infrastructure::bound_account(&state.db, employee_id)
            .await
            .ok()
            .flatten()
            .map_or_else(|| "of this person".to_owned(), |account| account.username);
        return Err(AppError::Configuration(format!(
            "the employment change is recorded, but the login {login} could not be closed: \
             {error}. Suspend it in System > Accounts.",
        )));
    }
    Ok(())
}

pub async fn correct_code(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<CodeBody>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::EMPLOYEE_CODE_CORRECT)?;

    let mut record = record(&state, &access.employee_id).await?;
    let authorization = access.authorize(actions::EMPLOYEE_CODE_CORRECT, &body.reason)?;
    let code = EmployeeCode::try_new(&body.employee_code).map_err(invalid)?;
    record
        .employee
        .correct_code(code, authorization)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::save_employee(&state.db, &record.employee).await?;
    Ok(Json(employee_view(&record)))
}

pub async fn assign(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<AssignBody>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::ASSIGNMENT_MANAGE)?;

    let mut record = record(&state, &access.employee_id).await?;
    let authorization = access.authorize(actions::ASSIGNMENT_MANAGE, &body.reason)?;
    let span = AssignmentSpan::try_new(
        UnitId::try_new(&body.unit_id).map_err(invalid)?,
        body.valid_from,
        body.valid_to,
        authorization,
    )
    .map_err(invalid)?;
    // Pushing is where the overlap rule fires, on the whole timeline rather
    // than on the row about to be written.
    record
        .assignments
        .push(span)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::replace_assignments(&state.db, &access.employee_id, &record.assignments)
        .await?;
    Ok(Json(employee_view(&record)))
}

/// Bind a login to an employment record.
///
/// The refusals are in `postgres::employment::link_account` and the reasons
/// they exist are there too. What is here is the authority: this is the one
/// employment write that used to take no reason, and therefore the one whose
/// history could not be read back. `audit_log` cannot fill the gap — 0078
/// keeps request bodies out of it deliberately, and the username being bound
/// is in the body, so the floor can say a binding happened and never to what.
pub async fn link_account(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<LinkBody>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::ACCOUNT_LINK)?;
    let authorization = access.authorize(actions::ACCOUNT_LINK, &body.reason)?;
    infrastructure::link_account(
        &state.db,
        &access.employee_id,
        &body.username,
        &authorization,
    )
    .await?;
    Ok(Json(employee_view(
        &record(&state, &access.employee_id).await?,
    )))
}

/// Unbind a login from an employment record.
///
/// The same key as binding one, deliberately. Releasing is not a lesser act:
/// deciding that a credential is not this person's after all is the same
/// decision as deciding that it is, made in the other direction, and a grant
/// that could do one and not the other would leave every mistake permanent.
pub async fn release_account(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<ReleaseBody>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::ACCOUNT_LINK)?;
    let authorization = access.authorize(actions::ACCOUNT_LINK, &body.reason)?;
    infrastructure::release_account(&state.db, &access.employee_id, &authorization).await?;
    Ok(Json(employee_view(
        &record(&state, &access.employee_id).await?,
    )))
}

/// Who somebody is at work.
///
/// The employee app calls this for its holder on the screen that shows job
/// title, place and joining date. It is `people.employee.read`, not
/// `people.profile.read`: none of it is personal data.
pub async fn employment_profile(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<EmploymentProfileView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    let record = record(&state, &access.employee_id).await?;
    access.reaches(current_unit(&record))?;

    let current = record.assignments.current();
    let unit_id = current.map(|span| span.unit_id().to_string());
    // Already loaded beside the timeline, so no second query for one word.
    let unit_name = unit_id
        .as_ref()
        .and_then(|unit_id| record.unit_names.get(unit_id).cloned());
    let latest = record.contracts.current();

    Ok(Json(EmploymentProfileView {
        employee_id: record.employee.id().to_string(),
        employee_code: record.employee.code().to_string(),
        full_name: record
            .profile
            .as_ref()
            .map(|profile| profile.name().as_str().to_owned()),
        status: record.employee.status(),
        job_title: latest.map(|contract| contract.position().as_str().to_owned()),
        grade: latest.map(|contract| contract.grade().as_str().to_owned()),
        unit_id,
        unit_name,
        // The first HIRE, read out of the history rather than stored beside it.
        joined_on: record
            .employee
            .history()
            .iter()
            .find(|event| event.transition() == EmploymentTransition::Hire)
            .map(|event| event.effective_on()),
    }))
}

pub async fn read_personal_data(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<PersonalDataView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::PROFILE_READ)?;
    let record = record(&state, &access.employee_id).await?;
    access.reaches(current_unit(&record))?;
    let profile = record.profile.ok_or_else(|| {
        AppError::NotFound(format!(
            "no personal data has been recorded for {}",
            access.employee_id
        ))
    })?;
    Ok(Json(personal_data_view(&access.employee_id, &profile)))
}

pub async fn enrol_personal_data(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<EnrolPersonalDataBody>,
) -> Result<Json<PersonalDataView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::PROFILE_CHANGE)?;

    let record = record(&state, &access.employee_id).await?;
    if record.profile.is_some() {
        // Not an overwrite: the amendment route is how a recorded value
        // changes, and it is the one that leaves a trace.
        return Err(AppError::Conflict(format!(
            "{} already has personal data; amend it rather than re-enrolling",
            access.employee_id
        )));
    }
    let profile = Profile::enrol(
        FullName::try_new(&body.full_name).map_err(invalid)?,
        Nik::try_new(&body.nik).map_err(invalid)?,
        body.birth_date,
        Address::try_new(&body.address).map_err(invalid)?,
    );
    infrastructure::upsert_profile(&state.db, &access.employee_id, &profile).await?;
    Ok(Json(personal_data_view(&access.employee_id, &profile)))
}

pub async fn amend_personal_data(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<AmendPersonalDataBody>,
) -> Result<Json<PersonalDataView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::PROFILE_CHANGE)?;

    let record = record(&state, &access.employee_id).await?;
    let mut profile = record.profile.ok_or_else(|| {
        AppError::NotFound(format!(
            "no personal data has been recorded for {}",
            access.employee_id
        ))
    })?;

    let optional_contact = |value: &Option<String>| -> Result<Option<Contact>, AppError> {
        value
            .as_deref()
            .map(|raw| Contact::try_new(raw).map_err(invalid))
            .transpose()
    };
    let required = |what: &str| -> Result<&str, AppError> {
        body.value
            .as_deref()
            .ok_or_else(|| AppError::Validation(format!("{what} cannot be cleared")))
    };

    let field = match body.field.as_str() {
        "name" => ProfileField::Name(FullName::try_new(required("name")?).map_err(invalid)?),
        "nik" => ProfileField::Nik(Nik::try_new(required("nik")?).map_err(invalid)?),
        "birth_date" => ProfileField::BirthDate(body.birth_date.ok_or_else(|| {
            AppError::Validation("amending birth_date needs a birth_date".to_owned())
        })?),
        "address" => {
            ProfileField::Address(Address::try_new(required("address")?).map_err(invalid)?)
        }
        "phone" => ProfileField::Phone(optional_contact(&body.value)?),
        "email" => ProfileField::Email(optional_contact(&body.value)?),
        other => {
            return Err(AppError::Validation(format!(
                "{other:?} is not an amendable field: expected name, nik, birth_date, \
                 address, phone or email"
            )));
        }
    };

    let authorization = access.authorize(actions::PROFILE_CHANGE, &body.reason)?;
    profile
        .amend(field, authorization)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::upsert_profile(&state.db, &access.employee_id, &profile).await?;
    Ok(Json(personal_data_view(&access.employee_id, &profile)))
}

/// Change one contact detail — phone, email or address — the way HR's own
/// edit does, signed by `authorization`. Shared with the employee's change
/// request (0816), so an approved request and HR's edit are one write.
pub(super) async fn amend_contact(
    state: &AppState,
    employee_id: &str,
    field: &str,
    value: &str,
    authorization: Authorization,
) -> Result<(), AppError> {
    let record = record(state, employee_id).await?;
    let mut profile = record.profile.ok_or_else(|| {
        AppError::Conflict(format!(
            "no personal data has been recorded for {employee_id}, so there is nothing to change"
        ))
    })?;
    let value = value.trim();
    let contact = || -> Result<Option<Contact>, AppError> {
        if value.is_empty() {
            Ok(None)
        } else {
            Contact::try_new(value).map(Some).map_err(invalid)
        }
    };
    let field = match field {
        "phone" => ProfileField::Phone(contact()?),
        "email" => ProfileField::Email(contact()?),
        "address" => ProfileField::Address(Address::try_new(value).map_err(invalid)?),
        other => {
            return Err(AppError::Validation(format!(
                "{other:?} is not a detail an employee asks to change: expected phone, email or address"
            )))
        }
    };
    profile
        .amend(field, authorization)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::upsert_profile(&state.db, employee_id, &profile).await
}

pub async fn read_contracts(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<ContractsView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    let record = record(&state, &access.employee_id).await?;
    access.reaches(current_unit(&record))?;
    Ok(Json(contracts_view(&record, Utc::now().date_naive())))
}

pub async fn add_contract(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<ContractBody>,
) -> Result<Json<ContractsView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::CONTRACT_CHANGE)?;

    // The pairing UU 13/2003 art. 59 turns on, refused here as a bad request
    // rather than passed down to become a constraint violation.
    let kind = match (body.kind.as_str(), body.ends_on) {
        ("PKWT", Some(ends_on)) => ContractKind::Pkwt { ends_on },
        ("PKWT", None) => {
            return Err(AppError::Validation(
                "a PKWT is a fixed term and must say when it ends".to_owned(),
            ));
        }
        ("PKWTT", None) => ContractKind::Pkwtt,
        ("PKWTT", Some(_)) => {
            return Err(AppError::Validation(
                "a PKWTT is permanent and cannot carry an end date".to_owned(),
            ));
        }
        (other, _) => {
            return Err(AppError::Validation(format!(
                "{other:?} is not a contract kind: expected PKWT or PKWTT"
            )));
        }
    };

    let mut record = record(&state, &access.employee_id).await?;
    let authorization = access.authorize(actions::CONTRACT_CHANGE, &body.reason)?;
    let contract = Contract::try_new(
        kind,
        body.starts_on,
        Position::try_new(&body.position).map_err(invalid)?,
        Grade::try_new(&body.grade).map_err(invalid)?,
        authorization,
    )
    .map_err(invalid)?;
    record
        .contracts
        .append(contract)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::replace_contracts(&state.db, &access.employee_id, &record.contracts).await?;
    Ok(Json(contracts_view(&record, Utc::now().date_naive())))
}

/// Which fixed terms are running out.
///
/// The report that made contracts a table rather than a JSONB column.
pub async fn expiring(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ExpiringQuery>,
) -> Result<Json<Vec<ExpiringContract>>, AppError> {
    if !role_allows(
        required_role_for_action(actions::EMPLOYEE_READ),
        principal.role,
    ) {
        return Err(AppError::Forbidden(format!(
            "{} may not read the workforce",
            principal.username
        )));
    }
    let reach = reach_of(&state, &principal).await?;
    if reach.is_nowhere() {
        return Err(AppError::Forbidden(format!(
            "{} has no open posting, so no unit's contracts are theirs to read",
            principal.username
        )));
    }
    let as_of = query.as_of.unwrap_or_else(|| Utc::now().date_naive());
    let within = query.within_days.unwrap_or(30).clamp(0, 3650);
    let before = as_of + chrono::Duration::days(within);
    Ok(Json(
        infrastructure::expiring_contracts(
            &state.db,
            as_of,
            before,
            reach.sole_unit().map(|unit| unit.as_str()),
        )
        .await?,
    ))
}

/// Which nodes this person's place is served by, and whether they already have
/// a grant at each.
///
/// Read by the form that issues a login, so head office picks a till from a
/// list rather than remembering an origin id. `people.account.provision`,
/// because it exists only to be the first half of that act.
pub async fn account_targets(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<infrastructure::EdgeTarget>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::ACCOUNT_PROVISION)?;
    Ok(Json(
        infrastructure::edge_targets(&state.db, &access.employee_id).await?,
    ))
}

/// Issue a login: create the account, set its rung, bind it to the employment
/// record, and grant a till.
///
/// See `postgres::users::provision_account` for why the four steps this
/// replaces are one call, and for which of them share a transaction.
pub async fn provision_account(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<crate::cloud::application::ProvisionAccountRequest>,
) -> Result<Json<crate::cloud::application::ProvisionedAccount>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::ACCOUNT_PROVISION)?;
    // Binding is its own recorded decision and keeps its own key, so the
    // history reads the same whether the login was issued here or bound after
    // being created somewhere else.
    let authorization = access.authorize(actions::ACCOUNT_LINK, &body.reason)?;
    Ok(Json(
        infrastructure::provision_account(&state.db, &access.employee_id, body, &authorization)
            .await?,
    ))
}
