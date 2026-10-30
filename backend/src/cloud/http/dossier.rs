//! A person's papers (1001): the detail set and the scans on file, keyed in by
//! a store and taken by head office (owner, 2026-10-25: "create karyawan
//! profile, approve by HO", "ngedit data bisa toko, approval HO").
//!
//! # Two ways in, one record out
//!
//! Head office writes a person's file directly — `PUT …/details`, `POST
//! …/documents` — under `PROFILE_CHANGE`. A store keys in the same things as a
//! filing: a new hire's dossier on their proposal (`PUT
//! /hire-proposals/{id}/dossier`), or a change to an existing employee (`POST
//! /employees/{id}/data-updates`), each under `PROFILE_PROPOSE` and bounded by
//! `Reach`. Head office takes a change through the same kernel its own edit
//! uses, signed by the approver; the hire dossier is applied when the
//! employment record is opened (`http::hire::open_employment`).
//!
//! # Reading
//!
//! The file — personal data, the detail set, the papers, what waits — is one
//! read, `GET /employees/{id}/dossier`, for head office and for the place
//! manager of the person's own place: a form that edits what it may not show
//! is a form filled in blind. The bytes of a paper are their own route, and the
//! store node's relay does not carry them; a till files scans, it does not
//! browse them.

use super::auth::Principal;
use super::employment::{
    current_unit, load_record, personal_data_view, reach_of, resolve, PersonalDataView,
};
use super::files::download_response;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, missing_documents, required_role_for_action, role_allows, Address, Authorization,
        Contact, DocumentKind, EmployeeDetails, EmployeeError, FullName, HireProposalState, Nik,
        Profile, ProfileField, RecordKind,
    },
    http::audit::DeclaredSubject,
    postgres::{
        self as infrastructure, DataUpdateFiling, DocumentOwner, EmployeeDataUpdateView,
        EmployeeDetailsView, EmployeeDocumentView, HireDossierPersonal, PersonalChanges,
    },
};
use axum::{
    extract::{Path, Query, State},
    response::Response,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

fn holds(principal: &Principal, action_key: &str) -> bool {
    role_allows(required_role_for_action(action_key), principal.role)
}

fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if holds(principal, action_key) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

fn sign(principal: &Principal, action_key: &str, reason: &str) -> Result<Authorization, AppError> {
    Authorization::try_new(&principal.username, action_key, Utc::now(), reason).map_err(invalid)
}

/// Head office's read, or the place manager's of their own place.
fn may_read_papers(principal: &Principal) -> Result<(), AppError> {
    if holds(principal, actions::PROFILE_READ) || holds(principal, actions::PROFILE_PROPOSE) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not read a person's papers",
        principal.username
    )))
}

fn kinds_of(documents: &[EmployeeDocumentView]) -> Vec<DocumentKind> {
    documents
        .iter()
        .filter(|document| document.state == "ACTIVE")
        .filter_map(|document| DocumentKind::parse(&document.kind))
        .collect()
}

/// A paper named in a filing: the stored file it is, and what it is.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DocumentFiling {
    /// `PHOTO`, `KTP`, `KK`, `SKCK`, `CONTRACT`, `NPWP`, `BPJS` or `OTHER`.
    pub kind: String,
    /// What `POST /files` answered.
    pub file_id: Uuid,
}

/// Every paper of a filing, checked before anything is written: a kind this
/// build knows, bytes the caller uploaded themselves, and a type the kind
/// takes. A paper filed on somebody else's upload is somebody else's paper.
async fn checked_papers(
    state: &AppState,
    principal: &Principal,
    papers: &[DocumentFiling],
) -> Result<Vec<(DocumentKind, Uuid)>, AppError> {
    let mut checked = Vec::with_capacity(papers.len());
    for paper in papers {
        let kind = DocumentKind::parse(&paper.kind).ok_or_else(|| {
            AppError::Validation(format!(
                "{:?} is not a paper: expected PHOTO, KTP, KK, SKCK, CONTRACT, NPWP, BPJS or OTHER",
                paper.kind
            ))
        })?;
        let (content_type, uploaded_by) =
            infrastructure::stored_file_origin(&state.db, paper.file_id)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("file {}", paper.file_id)))?;
        if uploaded_by != principal.username {
            return Err(AppError::Forbidden(format!(
                "file {} was uploaded by somebody else; upload the scan again",
                paper.file_id
            )));
        }
        if !kind.accepts(&content_type) {
            return Err(AppError::Validation(format!(
                "a {} is {}, and this file is {content_type}",
                kind.code(),
                if kind == DocumentKind::Photo {
                    "an image"
                } else {
                    "an image or a PDF"
                }
            )));
        }
        checked.push((kind, paper.file_id));
    }
    Ok(checked)
}

// ── a person's file ────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeDossierView {
    pub employee_id: String,
    pub employee_code: String,
    /// `None` until somebody has recorded it.
    pub personal: Option<PersonalDataView>,
    pub details: Option<EmployeeDetailsView>,
    /// In force, and waiting with a change.
    pub documents: Vec<EmployeeDocumentView>,
    /// Required papers the file does not have in force: `KTP`, `KK`.
    pub missing: Vec<String>,
    /// The store's changes, newest first. At most one waits.
    pub updates: Vec<EmployeeDataUpdateView>,
}

async fn dossier_of(state: &AppState, employee_id: &str) -> Result<EmployeeDossierView, AppError> {
    let record = load_record(state, employee_id).await?;
    let documents = infrastructure::employee_documents_of(&state.db, employee_id).await?;
    Ok(EmployeeDossierView {
        employee_id: employee_id.to_owned(),
        employee_code: record.employee.code().to_string(),
        personal: record
            .profile
            .as_ref()
            .map(|profile| personal_data_view(employee_id, profile)),
        details: infrastructure::employee_details(&state.db, employee_id).await?,
        missing: missing_documents(&kinds_of(&documents))
            .into_iter()
            .map(str::to_owned)
            .collect(),
        documents,
        updates: infrastructure::data_updates_of(&state.db, employee_id).await?,
    })
}

/// Resolve the subject and pass both gates: the rung, then the place.
async fn reached(
    state: &AppState,
    principal: &Principal,
    raw: &str,
) -> Result<super::employment::Access, AppError> {
    let access = resolve(state, principal, raw).await?;
    let record = load_record(state, &access.employee_id).await?;
    access.reaches(current_unit(&record))?;
    Ok(access)
}

pub async fn read_dossier(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<EmployeeDossierView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    if !access.own {
        may_read_papers(&principal)?;
    }
    let record = load_record(&state, &access.employee_id).await?;
    access.reaches(current_unit(&record))?;
    Ok(Json(dossier_of(&state, &access.employee_id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveDetailsBody {
    pub details: EmployeeDetails,
    pub reason: String,
}

/// Head office writes the detail set directly, as a new revision.
pub async fn save_details(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<SaveDetailsBody>,
) -> Result<Json<EmployeeDossierView>, AppError> {
    require(&principal, actions::PROFILE_CHANGE)?;
    let access = reached(&state, &principal, &raw).await?;
    let details = body.details.validated().map_err(invalid)?;
    let saved = sign(&principal, actions::PROFILE_CHANGE, &body.reason)?;
    infrastructure::save_employee_details(&state.db, &access.employee_id, &details, &saved).await?;
    Ok(Json(dossier_of(&state, &access.employee_id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FileDocumentsBody {
    pub documents: Vec<DocumentFiling>,
    pub reason: String,
}

/// Head office puts papers straight onto a file; each replaces the one of its
/// kind in force.
pub async fn file_documents(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<FileDocumentsBody>,
) -> Result<Json<EmployeeDossierView>, AppError> {
    require(&principal, actions::PROFILE_CHANGE)?;
    let access = reached(&state, &principal, &raw).await?;
    if body.documents.is_empty() {
        return Err(AppError::Validation("name at least one paper".into()));
    }
    let papers = checked_papers(&state, &principal, &body.documents).await?;
    let filed = sign(&principal, actions::PROFILE_CHANGE, &body.reason)?;
    for (kind, file_id) in papers {
        infrastructure::file_employee_document(
            &state.db,
            DocumentOwner::Employee(&access.employee_id),
            kind,
            file_id,
            &filed,
        )
        .await?;
    }
    Ok(Json(dossier_of(&state, &access.employee_id).await?))
}

// ── a store's change ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FileDataUpdateBody {
    /// Only the fields that change. An empty phone or email clears it.
    #[serde(default)]
    pub personal: PersonalChanges,
    /// The whole new detail set, when it changes.
    #[serde(default)]
    pub details: Option<EmployeeDetails>,
    /// Scans to put on the file when head office takes the change.
    #[serde(default)]
    pub documents: Vec<DocumentFiling>,
    pub reason: String,
}

/// The personal fields, each through the kernel's own check, with every field
/// that already says what it is asked to say dropped. Returns the change and
/// what the record said before it.
fn checked_personal(
    asked: &PersonalChanges,
    profile: Option<&Profile>,
) -> Result<(PersonalChanges, PersonalChanges), AppError> {
    let mut change = PersonalChanges::default();
    let mut before = PersonalChanges::default();
    if let Some(raw) = &asked.full_name {
        let name = FullName::try_new(raw).map_err(invalid)?;
        let was = profile.map(|profile| profile.name().as_str().to_owned());
        if was.as_deref() != Some(name.as_str()) {
            change.full_name = Some(name.as_str().to_owned());
            before.full_name = was;
        }
    }
    if let Some(raw) = &asked.nik {
        let nik = Nik::try_new(raw).map_err(invalid)?;
        let was = profile.map(|profile| profile.nik().as_str().to_owned());
        if was.as_deref() != Some(nik.as_str()) {
            change.nik = Some(nik.as_str().to_owned());
            before.nik = was;
        }
    }
    if let Some(date) = asked.birth_date {
        let was = profile.map(Profile::birth_date);
        if was != Some(date) {
            change.birth_date = Some(date);
            before.birth_date = was;
        }
    }
    if let Some(raw) = &asked.address {
        let address = Address::try_new(raw).map_err(invalid)?;
        let was = profile.map(|profile| profile.address().as_str().to_owned());
        if was.as_deref() != Some(address.as_str()) {
            change.address = Some(address.as_str().to_owned());
            before.address = was;
        }
    }
    let contact = |raw: &str| -> Result<String, AppError> {
        let raw = raw.trim();
        if raw.is_empty() {
            Ok(String::new())
        } else {
            Contact::try_new(raw)
                .map(|contact| contact.as_str().to_owned())
                .map_err(invalid)
        }
    };
    if let Some(raw) = &asked.phone {
        let phone = contact(raw)?;
        let was = profile
            .and_then(Profile::phone)
            .map(|contact| contact.as_str().to_owned())
            .unwrap_or_default();
        if was != phone {
            change.phone = Some(phone);
            before.phone = Some(was);
        }
    }
    if let Some(raw) = &asked.email {
        let email = contact(raw)?;
        let was = profile
            .and_then(Profile::email)
            .map(|contact| contact.as_str().to_owned())
            .unwrap_or_default();
        if was != email {
            change.email = Some(email);
            before.email = Some(was);
        }
    }
    // Somebody with no personal data yet is recorded whole or not at all: the
    // kernel has no profile without a name, a NIK, a birth date and an address.
    if profile.is_none()
        && !change.is_empty()
        && (change.full_name.is_none()
            || change.nik.is_none()
            || change.birth_date.is_none()
            || change.address.is_none())
    {
        return Err(AppError::Validation(
            "this person has no personal data yet: give the name, NIK, date of birth and address \
             together"
                .into(),
        ));
    }
    Ok((change, before))
}

/// A store keys in a change to an existing employee's data, for head office
/// to take or refuse.
pub async fn file_data_update(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<FileDataUpdateBody>,
) -> Result<Json<EmployeeDataUpdateView>, AppError> {
    require(&principal, actions::PROFILE_PROPOSE)?;
    let access = resolve(&state, &principal, &raw).await?;
    let record = load_record(&state, &access.employee_id).await?;
    access.reaches(current_unit(&record))?;

    let (personal, before_personal) = checked_personal(&body.personal, record.profile.as_ref())?;
    let current = infrastructure::employee_details(&state.db, &access.employee_id).await?;
    let details = body
        .details
        .map(EmployeeDetails::validated)
        .transpose()
        .map_err(invalid)?
        .filter(|details| current.as_ref().map(|view| &view.details) != Some(details));
    let papers = checked_papers(&state, &principal, &body.documents).await?;
    if personal.is_empty() && details.is_none() && papers.is_empty() {
        return Err(AppError::Validation(
            "this changes nothing: every field already says that, and no scan is attached".into(),
        ));
    }

    let filed = sign(&principal, actions::PROFILE_PROPOSE, &body.reason)?;
    let before_details = details
        .as_ref()
        .and(current.as_ref())
        .map(|view| view.details.clone());
    let id = infrastructure::file_data_update(
        &state.db,
        DataUpdateFiling {
            employee_id: &access.employee_id,
            personal: &personal,
            before_personal: &before_personal,
            details: details.as_ref(),
            before_details: before_details.as_ref(),
        },
        &filed,
    )
    .await?;
    for (kind, file_id) in papers {
        infrastructure::file_employee_document(
            &state.db,
            DocumentOwner::Update {
                employee_id: &access.employee_id,
                update_id: &id,
            },
            kind,
            file_id,
            &filed,
        )
        .await?;
    }
    infrastructure::data_update(&state.db, &id)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("change {id}")))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueueQuery {
    /// Decided changes too, not only those waiting.
    #[serde(default)]
    pub all: bool,
}

/// Head office's queue of store changes, within the caller's reach.
pub async fn data_update_queue(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<QueueQuery>,
) -> Result<Json<Vec<EmployeeDataUpdateView>>, AppError> {
    require(&principal, actions::PROFILE_CHANGE)?;
    let reach = reach_of(&state, &principal).await?;
    let rows = infrastructure::data_updates(&state.db, query.all).await?;
    Ok(Json(
        rows.into_iter()
            .filter(|row| reach.covers(row.unit_id.as_deref()))
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DecideDataUpdateBody {
    pub approve: bool,
    pub reason: String,
}

/// The profile a taken change leaves, through the profile kernel and signed by
/// the approver; `None` when it touches no personal field. Every field was
/// checked when the change was filed; it is checked again here, because the
/// record may have moved since.
async fn changed_profile(
    state: &AppState,
    change: &EmployeeDataUpdateView,
    signed: &Authorization,
) -> Result<Option<Profile>, AppError> {
    let personal = &change.personal;
    if personal.is_empty() {
        return Ok(None);
    }
    let record = load_record(state, &change.employee_id).await?;
    let contact = |raw: &str| -> Result<Option<Contact>, AppError> {
        if raw.trim().is_empty() {
            Ok(None)
        } else {
            Contact::try_new(raw).map(Some).map_err(invalid)
        }
    };
    let profile = match record.profile {
        Some(mut profile) => {
            let mut fields = Vec::new();
            if let Some(raw) = &personal.full_name {
                fields.push(ProfileField::Name(FullName::try_new(raw).map_err(invalid)?));
            }
            if let Some(raw) = &personal.nik {
                fields.push(ProfileField::Nik(Nik::try_new(raw).map_err(invalid)?));
            }
            if let Some(date) = personal.birth_date {
                fields.push(ProfileField::BirthDate(date));
            }
            if let Some(raw) = &personal.address {
                fields.push(ProfileField::Address(
                    Address::try_new(raw).map_err(invalid)?,
                ));
            }
            if let Some(raw) = &personal.phone {
                fields.push(ProfileField::Phone(contact(raw)?));
            }
            if let Some(raw) = &personal.email {
                fields.push(ProfileField::Email(contact(raw)?));
            }
            for field in fields {
                // A field somebody else already set to the same value is
                // not a conflict worth refusing the rest of the change for.
                match profile.amend(field, signed.clone()) {
                    Ok(_) => {}
                    Err(EmployeeError::ProfileAmendmentChangesNothing { .. }) => {}
                    Err(error) => return Err(AppError::Conflict(error.to_string())),
                }
            }
            profile
        }
        None => {
            let required = |value: &Option<String>, what: &str| {
                value.clone().ok_or_else(|| {
                    AppError::Validation(format!(
                        "this person has no personal data yet, and the change gives no {what}"
                    ))
                })
            };
            Profile::try_new(
                FullName::try_new(&required(&personal.full_name, "name")?).map_err(invalid)?,
                Nik::try_new(&required(&personal.nik, "NIK")?).map_err(invalid)?,
                personal.birth_date.ok_or_else(|| {
                    AppError::Validation(
                        "this person has no personal data yet, and the change gives no \
                             date of birth"
                            .into(),
                    )
                })?,
                Address::try_new(&required(&personal.address, "address")?).map_err(invalid)?,
                match &personal.phone {
                    Some(raw) => contact(raw)?,
                    None => None,
                },
                match &personal.email {
                    Some(raw) => contact(raw)?,
                    None => None,
                },
                Vec::new(),
            )
            .map_err(invalid)?
        }
    };
    Ok(Some(profile))
}

/// Take a store's change — the record changes, signed by the approver — or
/// refuse it. Nobody decides a change they filed.
pub async fn decide_data_update(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(id): Path<String>,
    Json(body): Json<DecideDataUpdateBody>,
) -> Result<Json<EmployeeDataUpdateView>, AppError> {
    require(&principal, actions::PROFILE_CHANGE)?;
    let change = infrastructure::data_update(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("change {id}")))?;
    if change.filed_by == principal.username {
        return Err(AppError::Forbidden(
            "a change you filed is somebody else's to take".into(),
        ));
    }
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(change.unit_id.as_deref()) {
        return Err(AppError::Forbidden(format!(
            "{} does not reach where {} works",
            principal.username, change.employee_code
        )));
    }
    if change.state != "PENDING" {
        return Err(AppError::Conflict(format!(
            "change {id} is already {}",
            change.state
        )));
    }
    let decided = sign(&principal, actions::PROFILE_CHANGE, &body.reason)?;
    let taken = if body.approve {
        let signed = sign(
            &principal,
            actions::PROFILE_CHANGE,
            &format!(
                "on {}'s change for {}: {}",
                change.filed_by, change.employee_code, change.reason
            ),
        )?;
        let profile = changed_profile(&state, &change, &signed).await?;
        Some((profile, signed))
    } else {
        None
    };
    // One transaction, the claim first: of two approvers only the one whose
    // claim lands writes the change, and a write that fails leaves it waiting.
    let mut tx = state.db.begin().await?;
    infrastructure::close_data_update_in(
        &mut tx,
        &id,
        if body.approve { "APPROVED" } else { "REJECTED" },
        &decided,
    )
    .await?;
    if let Some((profile, signed)) = &taken {
        if let Some(profile) = profile {
            infrastructure::upsert_profile_in(&mut tx, &change.employee_id, profile).await?;
        }
        if let Some(details) = &change.details {
            infrastructure::save_details_in(&mut tx, &change.employee_id, details, signed).await?;
        }
    }
    tx.commit().await?;
    acted_on.set(RecordKind::Employee, change.employee_id.clone());
    infrastructure::data_update(&state.db, &id)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("change {id}")))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct WithdrawDataUpdateBody {
    pub reason: String,
}

/// The filer takes their change back while it waits; its scans go with it.
pub async fn withdraw_data_update(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(id): Path<String>,
    Json(body): Json<WithdrawDataUpdateBody>,
) -> Result<Json<EmployeeDataUpdateView>, AppError> {
    let change = infrastructure::data_update(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("change {id}")))?;
    if change.filed_by != principal.username {
        return Err(AppError::Forbidden(
            "only the person who filed a change takes it back".into(),
        ));
    }
    let by = sign(&principal, actions::PROFILE_PROPOSE, &body.reason)?;
    infrastructure::close_data_update(&state.db, &id, "WITHDRAWN", &by).await?;
    acted_on.set(RecordKind::Employee, change.employee_id.clone());
    infrastructure::data_update(&state.db, &id)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("change {id}")))
}

// ── a new hire's dossier ───────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HireDossierView {
    pub proposal_id: String,
    pub candidate_name: String,
    /// `None` until the store has keyed it in.
    pub personal: Option<HireDossierPersonal>,
    pub details: Option<EmployeeDetails>,
    /// What the family reads as, once the details are in.
    pub ptkp_hint: Option<String>,
    pub documents: Vec<EmployeeDocumentView>,
    /// Required papers the dossier does not have: `KTP`, `KK`.
    pub missing: Vec<String>,
    pub saved_by: Option<String>,
    pub saved_at: Option<DateTime<Utc>>,
}

/// A proposal's dossier as anybody who may read the proposal reads it.
pub(super) async fn hire_dossier_view(
    state: &AppState,
    proposal_id: &str,
    candidate_name: &str,
) -> Result<HireDossierView, AppError> {
    let dossier = infrastructure::hire_dossier(&state.db, proposal_id).await?;
    let documents = infrastructure::proposal_documents(&state.db, proposal_id).await?;
    let have: Vec<DocumentKind> = documents
        .iter()
        .filter_map(|document| DocumentKind::parse(&document.kind))
        .collect();
    Ok(HireDossierView {
        proposal_id: proposal_id.to_owned(),
        candidate_name: candidate_name.to_owned(),
        ptkp_hint: dossier.as_ref().map(|row| row.details.ptkp_hint()),
        saved_by: dossier.as_ref().map(|row| row.saved_by.clone()),
        saved_at: dossier.as_ref().map(|row| row.saved_at),
        personal: dossier.as_ref().map(|row| row.personal.clone()),
        details: dossier.map(|row| row.details),
        missing: missing_documents(&have)
            .into_iter()
            .map(str::to_owned)
            .collect(),
        documents,
    })
}

/// The proposal, if the caller reaches its unit.
async fn reachable_proposal(
    state: &AppState,
    principal: &Principal,
    id: &str,
) -> Result<infrastructure::HireProposalRecord, AppError> {
    let record = infrastructure::load_hire_proposal(&state.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("hire proposal {id}")))?;
    let reach = reach_of(state, principal).await?;
    if !reach.covers(Some(record.proposal.unit().as_str())) {
        return Err(AppError::Forbidden(format!(
            "{} does not reach {}",
            principal.username,
            record.proposal.unit()
        )));
    }
    Ok(record)
}

pub async fn read_hire_dossier(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<HireDossierView>, AppError> {
    require(&principal, actions::HIRE_PROPOSAL_READ)?;
    let record = reachable_proposal(&state, &principal, &id).await?;
    let candidate = record.proposal.current().candidate().as_str().to_owned();
    Ok(Json(hire_dossier_view(&state, &id, &candidate).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveHireDossierBody {
    pub nik: String,
    pub birth_date: chrono::NaiveDate,
    /// The address as the KTP prints it.
    pub address: String,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    pub details: EmployeeDetails,
    /// Scans to add; each replaces the one of its kind already on the dossier.
    #[serde(default)]
    pub documents: Vec<DocumentFiling>,
    pub reason: String,
}

/// The store keys in the new hire's personal data and scans, while head office
/// has not answered yet (proposed, or returned for revision).
pub async fn save_hire_dossier(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<SaveHireDossierBody>,
) -> Result<Json<HireDossierView>, AppError> {
    require(&principal, actions::PROFILE_PROPOSE)?;
    let record = reachable_proposal(&state, &principal, &id).await?;
    let open = matches!(
        record.proposal.state(),
        HireProposalState::Proposed | HireProposalState::Returned
    );
    if !open {
        return Err(AppError::Conflict(format!(
            "hire proposal {id} is {}; its dossier is head office's now",
            record.proposal.state().code()
        )));
    }
    let optional = |raw: &Option<String>| -> Result<Option<String>, AppError> {
        match raw.as_deref().map(str::trim) {
            None | Some("") => Ok(None),
            Some(raw) => Contact::try_new(raw)
                .map(|contact| Some(contact.as_str().to_owned()))
                .map_err(invalid),
        }
    };
    let personal = HireDossierPersonal {
        nik: Nik::try_new(&body.nik)
            .map_err(invalid)?
            .as_str()
            .to_owned(),
        birth_date: body.birth_date,
        address: Address::try_new(&body.address)
            .map_err(invalid)?
            .as_str()
            .to_owned(),
        phone: optional(&body.phone)?,
        email: optional(&body.email)?,
    };
    let details = body.details.validated().map_err(invalid)?;
    let papers = checked_papers(&state, &principal, &body.documents).await?;
    let saved = sign(&principal, actions::PROFILE_PROPOSE, &body.reason)?;
    infrastructure::save_hire_dossier(&state.db, &id, &personal, &details, &saved).await?;
    for (kind, file_id) in papers {
        infrastructure::file_employee_document(
            &state.db,
            DocumentOwner::Proposal(&id),
            kind,
            file_id,
            &saved,
        )
        .await?;
    }
    let candidate = record.proposal.current().candidate().as_str().to_owned();
    Ok(Json(hire_dossier_view(&state, &id, &candidate).await?))
}

// ── a paper's bytes, and taking one back ───────────────────────────────────

/// The scan itself, for whoever may read the file it is on. Not relayed to a
/// till.
pub async fn document_content(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let place = infrastructure::document_place(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("paper {id}")))?;
    match (&place.employee_id, &place.hire_proposal_id) {
        (Some(employee_id), _) => {
            let access = resolve(&state, &principal, employee_id).await?;
            if !access.own {
                may_read_papers(&principal)?;
            }
            let record = load_record(&state, employee_id).await?;
            access.reaches(current_unit(&record))?;
        }
        (None, Some(proposal_id)) => {
            require(&principal, actions::HIRE_PROPOSAL_READ)?;
            reachable_proposal(&state, &principal, proposal_id).await?;
        }
        (None, None) => return Err(AppError::NotFound(format!("paper {id}"))),
    }
    let content = infrastructure::read_file(&state, place.file_id).await?;
    Ok(download_response(content))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RemoveDocumentBody {
    pub reason: String,
}

/// Take back a scan still waiting with a proposal or a change — the filer's,
/// or head office's. Answers with what still waits beside it.
pub async fn remove_document(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(id): Path<String>,
    Json(body): Json<RemoveDocumentBody>,
) -> Result<Json<Vec<EmployeeDocumentView>>, AppError> {
    let place = infrastructure::document_place(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("paper {id}")))?;
    if place.state != "PENDING" {
        return Err(AppError::Conflict(format!(
            "paper {id} is on the file; file a new one to replace it"
        )));
    }
    if place.filed_by == principal.username {
        require(&principal, actions::PROFILE_PROPOSE)?;
    } else {
        require(&principal, actions::PROFILE_CHANGE)?;
    }
    match (&place.employee_id, &place.hire_proposal_id) {
        (Some(employee_id), _) => {
            reached(&state, &principal, employee_id).await?;
        }
        (None, Some(proposal_id)) => {
            // Once head office has answered, the dossier is what it answered
            // on: a KTP taken back after approval would open a file without one.
            let record = reachable_proposal(&state, &principal, proposal_id).await?;
            let open = matches!(
                record.proposal.state(),
                HireProposalState::Proposed | HireProposalState::Returned
            );
            if !open {
                return Err(AppError::Conflict(format!(
                    "hire proposal {proposal_id} is {}; its dossier is head office's now",
                    record.proposal.state().code()
                )));
            }
        }
        (None, None) => return Err(AppError::NotFound(format!("paper {id}"))),
    }
    // Signed, though nothing keeps the row: a reason is still asked, so a
    // scan taken back is a decision somebody explained.
    sign(&principal, actions::PROFILE_PROPOSE, &body.reason)?;
    infrastructure::remove_pending_document(&state.db, &id).await?;
    match (&place.employee_id, &place.hire_proposal_id) {
        (Some(employee_id), _) => acted_on.set(RecordKind::Employee, employee_id.clone()),
        (None, Some(proposal_id)) => acted_on.set(RecordKind::HireProposal, proposal_id.clone()),
        (None, None) => {}
    }
    match (&place.data_update_id, &place.hire_proposal_id) {
        (Some(update_id), _) => Ok(Json(
            infrastructure::update_documents(&state.db, update_id).await?,
        )),
        (None, Some(proposal_id)) => Ok(Json(
            infrastructure::proposal_documents(&state.db, proposal_id).await?,
        )),
        (None, None) => Ok(Json(Vec::new())),
    }
}
