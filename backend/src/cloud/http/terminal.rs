//! Punch stations, enrolment, and the two routes a unit's node calls.
//!
//! # Two kinds of caller, and they authenticate differently
//!
//! **A person, in a browser.** Registering a terminal, suspending one,
//! enrolling a fingerprint, withdrawing one: a session, a rung, and an action
//! key, exactly like the rest of the People module.
//!
//! **A unit's node.** Collecting its templates, and delivering its punches.
//! These authenticate with the node's own `x-sync-key` — the credential the
//! edge→cloud sync already uses — and are in the pre-session public list
//! alongside `/sync/ingest`. That is not a shortcut; it is the enforcement of
//! the owner's fifth decision.
//!
//! Because no session reaches these two routes, **there is no session in the
//! system that can ask for a template.** The path gate makes every `GET` a
//! Cashier read, so a template endpoint inside the session-authenticated space
//! would have been readable by every till in the company. Putting it outside
//! that space entirely, behind a per-origin key, is what makes "nothing serves
//! a template to a browser" a property of the routing table rather than a
//! sentence in a review.
//!
//! # The node's own unit is derived, never claimed
//!
//! A node presents its `origin_id`; the unit is resolved
//! `sync_origin_credential.site_id` → `site.unit_id`. It is never the
//! origin id compared to a unit id, because those two vocabularies are known
//! to disagree in this deployment — the cloud spells the warehouse `dc` and the
//! edge spells its node `dc-01` — and a string comparison would either refuse
//! every DC punch or, worse, match the wrong unit somewhere else.

use super::auth::Principal;
use super::employment::{current_unit, reach_of, resolve};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, AttendanceTerminal, ClockQuality,
        DayOffset, EnrolmentRecord, Finger, IdentificationMethod, MinuteOfDay, Punch, PunchContext,
        PunchDirection, PunchId, PunchTime, Reach, TemplateFormat, TerminalId, TerminalStatus,
        UnitId,
    },
    postgres::{self as infrastructure, EnrolmentEventRow, EnrolmentRow, TerminalRow},
};
use crate::security;
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

// ── terminals ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnitQuery {
    #[serde(default)]
    pub unit: Option<String>,
}

/// Every registered station a caller may see.
///
/// Reading needs no key beyond a session, for the reason the attendance
/// policy's read needs none: somebody whose only way through the door is a
/// reader is entitled to know which reader that is and whether anybody has
/// suspended it. The *reach* still bounds it — a store manager sees their own
/// unit's stations and not store-03's — because which devices a shop runs is
/// that shop's business rather than everybody's.
pub async fn list_terminals(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<UnitQuery>,
) -> Result<Json<Vec<TerminalRow>>, AppError> {
    let reach = reach_of(&state, &principal).await?;
    if reach.is_nowhere() {
        // Not an empty list. An empty list says "there are no stations"; this
        // caller simply has no posting behind their login, so we do not know
        // whose stations are theirs.
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere, so no punch station is theirs to see",
            principal.username
        )));
    }
    let unit = match (&query.unit, &reach) {
        (Some(asked), _) if !reach.covers(Some(asked)) => {
            return Err(AppError::Forbidden(format!(
                "{} is not posted anywhere that reaches {asked}",
                principal.username
            )))
        }
        (Some(asked), _) => Some(asked.clone()),
        (None, Reach::Only(mine)) => Some(mine.as_str().to_owned()),
        (None, _) => None,
    };
    Ok(Json(
        infrastructure::list_attendance_terminals(&state.db, unit.as_deref()).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterTerminalBody {
    /// Chosen when the device is installed, and never changed: it is what every
    /// punch the station takes names as its provenance.
    pub terminal_id: String,
    /// Where it is installed. A station is a machine on a wall, so it is
    /// registered at a site; the unit it attests for is the site's.
    pub site_id: String,
    pub name: String,
    pub reason: String,
}

/// Register a station. Head office's, and it creates attendance authority.
pub async fn register_terminal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<RegisterTerminalBody>,
) -> Result<Json<Vec<TerminalRow>>, AppError> {
    require(&principal, actions::ATTENDANCE_TERMINAL_MANAGE)?;
    let authorization = crate::cloud::domain::Authorization::try_new(
        &principal.username,
        actions::ATTENDANCE_TERMINAL_MANAGE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    let unit = infrastructure::unit_of_site(&state.db, &body.site_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("site {}", body.site_id)))?;
    let terminal = AttendanceTerminal::register(
        TerminalId::try_new(&body.terminal_id).map_err(invalid)?,
        unit.clone(),
        &body.name,
        // One method, and the decision behind it is recorded in
        // `domain::attendance::terminal`. Not a body field: a caller who could
        // name the method could name one the device does not perform, and every
        // punch it sent would then fail provenance on the way back in.
        IdentificationMethod::Fingerprint,
        authorization,
    )
    .map_err(infrastructure::attendance_error)?;
    infrastructure::insert_attendance_terminal(&state.db, &terminal, &body.site_id).await?;
    Ok(Json(
        infrastructure::list_attendance_terminals(&state.db, Some(unit.as_str())).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminalStatusBody {
    /// `ACTIVE`, `SUSPENDED` or `REVOKED`. `REVOKED` is permanent.
    pub status: String,
    pub reason: String,
}

/// Suspend a station, bring it back, or revoke it for good.
pub async fn set_terminal_status(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<TerminalStatusBody>,
) -> Result<Json<Vec<TerminalRow>>, AppError> {
    require(&principal, actions::ATTENDANCE_TERMINAL_MANAGE)?;
    let status = TerminalStatus::parse(&body.status).ok_or_else(|| {
        AppError::Validation(format!(
            "`{}` is not a terminal status; expected ACTIVE, SUSPENDED or REVOKED",
            body.status
        ))
    })?;
    let mut terminal = infrastructure::load_attendance_terminal(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
    let authorization = crate::cloud::domain::Authorization::try_new(
        &principal.username,
        actions::ATTENDANCE_TERMINAL_MANAGE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    terminal
        .transition(status, authorization)
        .map_err(infrastructure::attendance_error)?;
    infrastructure::save_attendance_terminal(&state.db, &terminal).await?;
    Ok(Json(
        infrastructure::list_attendance_terminals(&state.db, Some(terminal.unit().as_str()))
            .await?,
    ))
}

// ── enrolment ────────────────────────────────────────────────────────────

/// Somebody's enrolled fingers and the log of what happened to them.
///
/// Carries no template, and could not: the bytes live in a type with no
/// `Serialize`.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EnrolmentView {
    pub employee_id: String,
    pub fingers: Vec<EnrolmentRow>,
    pub history: Vec<EnrolmentEventRow>,
    /// `false` when nobody has enrolled a finger for this person.
    ///
    /// Sent explicitly rather than left for the browser to infer from an empty
    /// list, because it is the state that matters: fingerprint is the only way
    /// in, so somebody with no enrolled finger cannot clock in at all, and that
    /// reads very differently from a screen that is still loading.
    pub can_clock_in: bool,
}

/// Read somebody's enrolment. Their own, or anybody's if the caller may.
///
/// Behind `people.employee.read` rather than `people.fingerprint.enrol`: which
/// fingers somebody has enrolled is roster-grade information — a manager
/// needs it to know why a person keeps appearing as absent — while *changing*
/// it is HR's. Bounded by reach, like the rest of the Directory.
pub async fn read_enrolment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<EnrolmentView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    access.reaches(current_unit(&record))?;

    let fingers = infrastructure::list_enrolments(&state.db, &access.employee_id).await?;
    let history = infrastructure::list_enrolment_events(&state.db, &access.employee_id).await?;
    Ok(Json(EnrolmentView {
        employee_id: access.employee_id,
        can_clock_in: !fingers.is_empty(),
        fingers,
        history,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrolBody {
    /// `RIGHT_INDEX`, `LEFT_THUMB`, and the other eight.
    pub finger: String,
    /// The station that captured it.
    pub terminal_id: String,
    /// The vendor feature vector, hex-encoded. **Never an image** — there is no
    /// field here one would fit in, and the format says what the bytes are.
    pub template_hex: String,
    /// The vendor's score for the capture, when the sidecar reported one.
    /// Omitted rather than sent as zero when it did not.
    #[serde(default)]
    pub quality: Option<u8>,
    pub reason: String,
}

/// Enrol a finger, or replace what was enrolled for it.
///
/// HR's, at the ADMIN rung, even though the capture happens at a store: the
/// finger is on the reader in the shop and the decision to bind a biometric to
/// an employment record is head office's. The terminal must be registered, at
/// a place the person is currently posted to — so a station cannot enrol
/// somebody else's staff.
pub async fn enrol_finger(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<EnrolBody>,
) -> Result<Json<EnrolmentView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    // `may`, not `may_read`: enrolling your own finger is not softened by it
    // being yours. A cashier who could enrol themselves could enrol themselves
    // a second time from home.
    access.may(actions::FINGERPRINT_ENROL)?;

    let finger = Finger::parse(&body.finger).map_err(invalid)?;
    let plaintext = hex::decode(body.template_hex.trim()).map_err(|_| {
        AppError::Validation("template_hex is not hex-encoded vendor template bytes".to_owned())
    })?;

    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    let unit = current_unit(&record).ok_or_else(|| {
        // Nowhere to enrol from, and it is not the terminal's fault. Somebody
        // with no posting has no unit whose station could capture them, and the
        // fix is HR's paperwork rather than a retry.
        AppError::Conflict(format!(
            "{} is not posted anywhere, so no station is theirs to enrol at",
            access.employee_id
        ))
    })?;
    let terminal = infrastructure::load_attendance_terminal(&state.db, &body.terminal_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("terminal {}", body.terminal_id)))?;
    // HR's desk at head office enrols anybody: HR enrols a person's fingers
    // when it registers them (owner, 24 Oct 2026), and the templates follow
    // them to every POS they sign in at (`sync_pos_fingers`). A shop's
    // station enrols only its own people.
    let at_head_office: bool = sqlx::query_scalar("SELECT kind = 'HO' FROM unit WHERE id = $1")
        .bind(terminal.unit().as_str())
        .fetch_optional(&state.db)
        .await?
        .unwrap_or(false);
    if terminal.unit().as_str() != unit && !at_head_office {
        return Err(AppError::Conflict(format!(
            "terminal {} is at {}, and {} is posted to {unit}",
            body.terminal_id,
            terminal.unit(),
            access.employee_id
        )));
    }
    if !terminal.is_active() {
        return Err(AppError::Conflict(format!(
            "terminal {} is {} and cannot capture an enrolment",
            body.terminal_id,
            terminal.status()
        )));
    }

    let authorization = access.authorize(actions::FINGERPRINT_ENROL, &body.reason)?;
    let existing = infrastructure::list_enrolments(&state.db, &access.employee_id).await?;
    let revision = existing
        .iter()
        .find(|row| row.finger == finger.code())
        .map_or(1, |row| u32::try_from(row.revision).unwrap_or(1) + 1);
    let enrolment = EnrolmentRecord::try_new(
        record.employee.id().clone(),
        finger,
        TemplateFormat::ZkfingerV10,
        body.quality,
        terminal.id().clone(),
        authorization,
        revision,
    )
    .map_err(infrastructure::attendance_error)?;

    infrastructure::store_fingerprint_template(&state.db, &enrolment, plaintext).await?;

    let fingers = infrastructure::list_enrolments(&state.db, &access.employee_id).await?;
    let history = infrastructure::list_enrolment_events(&state.db, &access.employee_id).await?;
    Ok(Json(EnrolmentView {
        employee_id: access.employee_id,
        can_clock_in: !fingers.is_empty(),
        fingers,
        history,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WithdrawFingerBody {
    pub reason: String,
}

/// Withdraw one enrolled finger while the person is still employed.
///
/// The row is deleted, not flagged: a retired-but-present biometric is
/// regulated data still being held without a purpose. The event survives, so
/// the disposal is auditable.
pub async fn withdraw_finger(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((raw, finger)): Path<(String, String)>,
    Json(body): Json<WithdrawFingerBody>,
) -> Result<Json<EnrolmentView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::FINGERPRINT_ENROL)?;
    let finger = Finger::parse(&finger).map_err(invalid)?;
    let authorization = access.authorize(actions::FINGERPRINT_ENROL, &body.reason)?;
    let removed = infrastructure::withdraw_fingerprint_template(
        &state.db,
        &access.employee_id,
        finger,
        &authorization,
    )
    .await?;
    if !removed {
        return Err(AppError::NotFound(format!(
            "{} has no {finger} enrolled",
            access.employee_id
        )));
    }
    let fingers = infrastructure::list_enrolments(&state.db, &access.employee_id).await?;
    let history = infrastructure::list_enrolment_events(&state.db, &access.employee_id).await?;
    Ok(Json(EnrolmentView {
        employee_id: access.employee_id,
        can_clock_in: !fingers.is_empty(),
        fingers,
        history,
    }))
}

// ── publishing the book a station runs on ────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublishBookBody {
    pub unit_id: String,
}

/// What was published, and to whom.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BookPublished {
    pub unit_id: String,
    /// The nodes it was delivered to. Usually one.
    pub origins: Vec<String>,
    pub employees: usize,
    pub rostered_days: usize,
    pub terminals: usize,
    pub published_at: DateTime<Utc>,
}

/// Publish the employee and roster slice to a unit's node.
///
/// # Why this is the roster key rather than a terminal one
///
/// What it sends down is the plan: who is posted here and what each of them is
/// on. The manager who built next week's roster is the person who wants it on
/// the reader, and they already hold `people.roster.manage`, bounded by their
/// own posting. The employee list and the station list travel with it, and both
/// are things that grant already reads.
///
/// # Explicit, not automatic
///
/// A scheduler could do this, and one probably should. It is a route first
/// because "the station is running last week's roster" must be fixable by
/// somebody clicking a button while a person stands at the reader — and because
/// a push that only ever happened on a timer is a push nobody can prove
/// happened.
///
/// Delivery rides the ordered command lane, so it is atomic at the far end: the
/// node either keeps its last-known-good book or activates this whole one, and
/// never observes a half-updated roster.
pub async fn publish_book(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<PublishBookBody>,
) -> Result<Json<BookPublished>, AppError> {
    require(&principal, actions::ROSTER_MANAGE)?;
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(&body.unit_id)) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username, body.unit_id
        )));
    }
    let unit = UnitId::try_new(&body.unit_id).map_err(invalid)?;
    let origins = infrastructure::origins_of_unit(&state.db, &unit).await?;
    if origins.is_empty() {
        // A named refusal rather than a silent success. "We published the book"
        // and "there was nowhere to publish it to" must not look the same, and
        // head office genuinely has no node — which is the usual way to reach
        // this message.
        return Err(AppError::Conflict(format!(
            "{unit} has no syncing node, so there is no station to publish a book to"
        )));
    }
    let book =
        infrastructure::attendance_book_for_unit(&state.db, &unit, Utc::now().date_naive()).await?;
    let payload = serde_json::to_value(&book)?;
    infrastructure::issue_command(
        &state.db,
        crate::cloud::domain::COMMAND_ATTENDANCE_BOOK_REPLACE,
        &payload,
        &principal.username,
        None,
        &origins,
    )
    .await?;
    Ok(Json(BookPublished {
        unit_id: body.unit_id,
        origins,
        employees: book.employees.len(),
        rostered_days: book.roster.len(),
        terminals: book.terminals.len(),
        published_at: book.published_at,
    }))
}

// ── the two node-authenticated routes ────────────────────────────────────

/// Resolve and authenticate a node by the credential it presents.
///
/// The same per-origin key `/sync/ingest` takes: a registered origin is
/// accepted **only** with its own key, so no unit can collect another unit's
/// templates or upload punches claiming another unit's place.
///
/// Returns the `unit` the origin's site is, because that — and never the
/// origin id spelled as a place — is what binds a node to a unit.
async fn node_unit(
    state: &AppState,
    headers: &HeaderMap,
    origin_id: &str,
) -> Result<UnitId, AppError> {
    let presented = headers
        .get("x-sync-key")
        .and_then(|value| value.to_str().ok());
    match infrastructure::origin_credential_digest(&state.db, origin_id).await? {
        Some(digest) => {
            let authorized =
                presented.is_some_and(|key| infrastructure::ingest_key_matches(&digest, key));
            if !authorized {
                return Err(AppError::Forbidden(
                    "invalid or missing x-sync-key for this origin".into(),
                ));
            }
        }
        None => {
            // An authenticated cloud refuses an unregistered origin outright:
            // the master key is a provisioning credential, never an identity a
            // punch may arrive under. Auth-disabled development keeps the
            // explicit master-key fallback, exactly as `/sync/ingest` does.
            if state.config.jwt_secret.is_some() {
                return Err(AppError::Forbidden(
                    "invalid or missing x-sync-key for this origin".into(),
                ));
            }
            if let Some(expected) = &state.config.sync_ingest_key {
                if !presented.is_some_and(|value| security::constant_time_eq(value, expected)) {
                    return Err(AppError::Forbidden("invalid or missing x-sync-key".into()));
                }
            }
        }
    }
    infrastructure::unit_of_origin(&state.db, origin_id)
        .await?
        .ok_or_else(|| {
            AppError::Conflict(format!(
                "origin {origin_id} is registered but is not bound to a site, so there is no \
                 unit whose people it could be asking about"
            ))
        })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PosFingerSyncBody {
    pub origin_id: String,
}

/// What a store server's POS may match against. Not a view type, and not
/// exported to the browser, for the reason `TemplateBundle` is not.
#[derive(Debug, Serialize)]
pub struct PosFingerBundle {
    pub origin_id: String,
    pub generated_at: DateTime<Utc>,
    pub fingers: Vec<infrastructure::PosFinger>,
}

/// `POST /api/v1/sync/pos-fingers`: the fingers HR enrolled for everybody who
/// signs in at this store server (24 Oct 2026). The server asks every few
/// minutes and replaces what it holds from head office with the answer
/// (`edge::fingerprint::replace_from_head_office`), so a leaver's finger stops
/// opening its tills at the next ask. Authenticated by the server's own
/// `x-sync-key`, like the attendance stations' sync; no session reaches it.
pub async fn sync_pos_fingers(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PosFingerSyncBody>,
) -> Result<Json<PosFingerBundle>, AppError> {
    node_unit(&state, &headers, &body.origin_id).await?;
    let fingers = infrastructure::pos_fingers_for_origin(&state.db, &body.origin_id).await?;
    Ok(Json(PosFingerBundle {
        origin_id: body.origin_id,
        generated_at: Utc::now(),
        fingers,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateSyncBody {
    pub origin_id: String,
    /// Which station is asking. Checked against the registry, so a revoked
    /// device collects nothing — the fail-closed rule, one layer further out
    /// than the matcher.
    pub terminal_id: String,
}

/// One unit's templates, for one of its stations.
///
/// Deliberately **not** a view type and deliberately not `ts-rs` exported:
/// nothing in `frontend-contract` should have a name for this shape, because no
/// browser is ever going to receive it.
#[derive(Debug, Serialize)]
pub struct TemplateBundle {
    /// Sent as `place_id`, the key the stations' hardware agents already read.
    /// They run on shop machines and are not updated with the cloud; the value
    /// is the unit id, which is the same string the place id was.
    #[serde(rename = "place_id")]
    pub unit_id: String,
    pub terminal_id: String,
    pub generated_at: DateTime<Utc>,
    pub entries: Vec<infrastructure::TemplateBundleEntry>,
}

/// Hand a station the templates of the people posted to its unit.
///
/// # Why the whole set every time
///
/// It is a replacement, not a delta, and the hardware agent's contract is the
/// same: `templates.replace` takes the set the device should hold. A delta
/// protocol would need a way to say "and forget this one", and a forgotten
/// deletion is somebody who left the company still able to clock in. Replacing
/// wholesale makes a withdrawal propagate by construction.
///
/// The bundle is bounded by the **open** posting, so a transfer needs no
/// re-enrolment: the person appears in the new unit's bundle on the next sync
/// and is gone from the old one.
pub async fn sync_templates(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TemplateSyncBody>,
) -> Result<Json<TemplateBundle>, AppError> {
    let unit = node_unit(&state, &headers, &body.origin_id).await?;
    let terminal = infrastructure::load_attendance_terminal(&state.db, &body.terminal_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("terminal {}", body.terminal_id)))?;
    if terminal.unit() != &unit {
        return Err(AppError::Forbidden(format!(
            "terminal {} is registered at {} and this node is {unit}",
            body.terminal_id,
            terminal.unit()
        )));
    }
    if !terminal.is_active() {
        // Fail closed. A suspended station is handed nothing, so it admits
        // nobody, which is the point of suspending it.
        return Err(AppError::Forbidden(format!(
            "terminal {} is {} and is not entitled to templates",
            body.terminal_id,
            terminal.status()
        )));
    }
    let entries = infrastructure::template_bundle_for_unit(&state.db, unit.as_str()).await?;
    infrastructure::touch_terminal_sync(&state.db, &body.terminal_id).await?;
    Ok(Json(TemplateBundle {
        unit_id: unit.as_str().to_owned(),
        terminal_id: body.terminal_id,
        generated_at: Utc::now(),
        entries,
    }))
}

/// One punch as a node delivers it.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IncomingPunch {
    /// Minted at the edge. Redelivery is free because of this field.
    pub punch_id: String,
    pub employee_id: String,
    pub terminal_id: String,
    /// `IN` or `OUT`.
    pub direction: String,
    /// The roster day this punch answers — for an overnight shift, the day the
    /// shift started.
    pub business_date: NaiveDate,
    /// 0, or 1 when the reading falls after midnight on the same shift.
    #[serde(default)]
    pub day_offset: u8,
    /// Place-local minutes since midnight, 0..=1439.
    pub minute: u16,
    /// What the device's clock said. No rule reads it.
    pub recorded_at: DateTime<Utc>,
    /// `OK`, `DRIFT` or `UNKNOWN`.
    pub clock_quality: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PunchIngestBody {
    pub origin_id: String,
    pub punches: Vec<IncomingPunch>,
}

/// What the cloud would not take, and why.
#[derive(Debug, Serialize)]
pub struct RefusedPunch {
    pub punch_id: String,
    pub reason: String,
}

/// The answer a node acts on.
#[derive(Debug, Serialize)]
pub struct PunchIngestResult {
    /// Newly recorded.
    pub accepted: usize,
    /// Already recorded — the ordinary outcome of a redelivery, not a problem.
    pub duplicate: usize,
    /// Refused, each with the reason. **A node must not retry these**, and the
    /// reason is what tells a person which ones need a correction instead.
    pub refused: Vec<RefusedPunch>,
}

/// Take a batch of punches from a unit's node.
///
/// # Every punch goes through the kernel
///
/// For each one: load the terminal, check it belongs to this node's place,
/// `attest` (which refuses a suspended or revoked station), load the employment
/// record and the posting timeline, load the period, and call `Punch::record`.
/// A punch that fails any of those is **refused with a reason** rather than
/// dropped or stored — the node stops retrying it, and the reason is what a
/// person reads when they wonder why a day looks absent.
///
/// A partial batch is a real outcome and is reported as one: eleven punches
/// accepted and one refused because the month closed while a unit was offline
/// is exactly what happens, and answering with a single failure would make the
/// node redeliver the eleven for ever.
pub async fn ingest_punches(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PunchIngestBody>,
) -> Result<Json<PunchIngestResult>, AppError> {
    let unit = node_unit(&state, &headers, &body.origin_id).await?;
    let mut result = PunchIngestResult {
        accepted: 0,
        duplicate: 0,
        refused: Vec::new(),
    };

    for incoming in &body.punches {
        match record_one(&state, &unit, incoming).await {
            Ok(true) => result.accepted += 1,
            Ok(false) => result.duplicate += 1,
            Err(error) => result.refused.push(RefusedPunch {
                punch_id: incoming.punch_id.clone(),
                reason: error.to_string(),
            }),
        }
    }
    Ok(Json(result))
}

/// One punch, all the way through the kernel. `Ok(false)` means it was already
/// recorded.
async fn record_one(
    state: &AppState,
    unit: &UnitId,
    incoming: &IncomingPunch,
) -> Result<bool, AppError> {
    let terminal = infrastructure::load_attendance_terminal(&state.db, &incoming.terminal_id)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "terminal {} is not registered",
                incoming.terminal_id
            ))
        })?;
    if terminal.unit() != unit {
        return Err(AppError::Forbidden(format!(
            "terminal {} is registered at {} and this node is {unit}",
            incoming.terminal_id,
            terminal.unit()
        )));
    }
    let record = infrastructure::load_employee(&state.db, &incoming.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", incoming.employee_id)))?;

    let at = PunchTime::new(
        incoming.business_date,
        DayOffset::try_new(incoming.day_offset).map_err(invalid)?,
        MinuteOfDay::try_new(incoming.minute).map_err(invalid)?,
    );
    let period = infrastructure::period_for(&state.db, unit, incoming.business_date).await?;
    // `attest` is the only way to get an attestation, and it refuses unless the
    // station is ACTIVE. That is the fail-closed rule at its outermost layer: a
    // device somebody suspended cannot produce attendance whatever it believes
    // about itself.
    let attestation = terminal
        .attest(record.employee.id().clone())
        .map_err(infrastructure::attendance_error)?;
    let punch = Punch::record(
        PunchId::try_new(&incoming.punch_id).map_err(invalid)?,
        &attestation,
        PunchDirection::parse(&incoming.direction).map_err(invalid)?,
        at,
        incoming.recorded_at,
        ClockQuality::parse(&incoming.clock_quality).map_err(invalid)?,
        PunchContext {
            employee: &record.employee,
            assignment: &record.assignments,
            period: &period,
        },
    )
    .map_err(infrastructure::attendance_error)?;
    infrastructure::insert_punch(&state.db, &punch).await
}
