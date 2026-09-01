//! What "late" means, and who gets to say so.
//!
//! Reading the policy is not a privilege: somebody clocking in is entitled to
//! know the tolerance they are being measured against, and a rule kept from the
//! people it governs is not a rule, it is a trap. So the read is open to any
//! signed-in caller.
//!
//! Writing it is head office's, and every version records who decided it and
//! why — the same authority trail employment changes carry, for the same
//! reason: this is the number that decides whether a month of arrivals were
//! late.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, AttendancePolicy, Authorization, Minutes,
        PolicyId, PolicyLimits, PolicySchedule, PolicyVersion,
    },
    postgres as infrastructure,
};
use axum::{
    extract::{Query, State},
    Extension, Json,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// One version, as a screen reads it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PolicyVersionView {
    pub policy_id: String,
    pub version: u32,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
    pub late_grace_minutes: u32,
    pub early_leave_grace_minutes: u32,
    pub overtime_minimum_minutes: u32,
    pub duplicate_punch_window_minutes: u32,
    /// Whether this is the version in force on the date asked about.
    pub in_force: bool,
}

/// The schedule, and what it says about one particular day.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PolicyScheduleView {
    pub versions: Vec<PolicyVersionView>,
    /// The date the `in_force` flags were computed against.
    pub as_of: NaiveDate,
    /// True when `as_of` falls in a gap, or before the first version.
    ///
    /// Sent rather than left for the browser to work out from the flags,
    /// because "no version is in force" is the state that matters and a screen
    /// deriving it from an absence would report it as a loading glitch.
    pub uncovered: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AsOfQuery {
    #[serde(default)]
    pub as_of: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewPolicyBody {
    /// Defaults to `standard`. Present so a second named policy is possible
    /// later without a migration.
    #[serde(default)]
    pub policy_id: Option<String>,
    /// The first day the new tolerances apply. The version currently open is
    /// closed the day before.
    pub effective_from: NaiveDate,
    pub late_grace_minutes: u32,
    pub early_leave_grace_minutes: u32,
    pub overtime_minimum_minutes: u32,
    pub duplicate_punch_window_minutes: u32,
    pub reason: String,
}

const DEFAULT_POLICY_ID: &str = "standard";

fn view(schedule: &PolicySchedule, as_of: NaiveDate) -> PolicyScheduleView {
    let versions: Vec<PolicyVersionView> = schedule
        .versions()
        .iter()
        .map(|policy| {
            let limits = policy.limits();
            PolicyVersionView {
                policy_id: policy.id().to_string(),
                version: policy.version().get(),
                effective_from: policy.effective_from(),
                effective_to: policy.effective_to(),
                late_grace_minutes: limits.late_grace.get(),
                early_leave_grace_minutes: limits.early_leave_grace.get(),
                overtime_minimum_minutes: limits.overtime_minimum.get(),
                duplicate_punch_window_minutes: limits.duplicate_punch_window.get(),
                in_force: policy.covers(as_of),
            }
        })
        .collect();
    PolicyScheduleView {
        uncovered: !versions.iter().any(|version| version.in_force),
        versions,
        as_of,
    }
}

/// The schedule. Empty until somebody writes one, and that is not an error.
pub async fn read_policy(
    State(state): State<AppState>,
    Extension(_principal): Extension<Principal>,
    Query(query): Query<AsOfQuery>,
) -> Result<Json<PolicyScheduleView>, AppError> {
    let as_of = query.as_of.unwrap_or_else(|| Utc::now().date_naive());
    match infrastructure::load_attendance_policy(&state.db).await? {
        Some(schedule) => Ok(Json(view(&schedule, as_of))),
        // Not a 404. The route exists, the operator simply has not decided yet,
        // and an empty list says so more usefully than an error a screen has to
        // special-case.
        None => Ok(Json(PolicyScheduleView {
            versions: Vec::new(),
            as_of,
            uncovered: true,
        })),
    }
}

/// Write a new version, closing the one it supersedes.
pub async fn set_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<NewPolicyBody>,
) -> Result<Json<PolicyScheduleView>, AppError> {
    // Deciding what counts as late is the same rung as changing somebody's
    // employment: it is a head-office decision that reaches everybody's pay.
    if !role_allows(
        required_role_for_action(actions::ATTENDANCE_POLICY_SET),
        principal.role,
    ) {
        return Err(AppError::Forbidden(format!(
            "{} may not set the attendance policy",
            principal.username
        )));
    }

    let authorization = Authorization::try_new(
        &principal.username,
        actions::ATTENDANCE_POLICY_SET,
        Utc::now(),
        &body.reason,
    )
    .map_err(|error| AppError::Validation(error.to_string()))?;

    let version = PolicyVersion::try_new(infrastructure::next_policy_version(&state.db).await?)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let policy = AttendancePolicy::try_new(
        PolicyId::try_new(body.policy_id.as_deref().unwrap_or(DEFAULT_POLICY_ID))
            .map_err(|error| AppError::Validation(error.to_string()))?,
        version,
        body.effective_from,
        // Always open-ended: a new version is "and from now on". Closing it is
        // what the next version does, in the same transaction that adds itself.
        None,
        PolicyLimits {
            late_grace: Minutes::new(body.late_grace_minutes),
            early_leave_grace: Minutes::new(body.early_leave_grace_minutes),
            overtime_minimum: Minutes::new(body.overtime_minimum_minutes),
            duplicate_punch_window: Minutes::new(body.duplicate_punch_window_minutes),
        },
    )
    .map_err(|error| AppError::Validation(error.to_string()))?;

    // The schedule as it will be, checked before it is written. Without this a
    // version starting before the open one would be accepted here and refuse to
    // load afterwards — the rules unreadable until somebody edited SQL.
    if let Some(existing) = infrastructure::load_attendance_policy(&state.db).await? {
        if existing
            .versions()
            .iter()
            .any(|version| version.effective_from() >= policy.effective_from())
        {
            return Err(AppError::Conflict(format!(
                "a policy version already starts on or after {}; a new version \
                 supersedes the current one and cannot be slipped in behind it",
                policy.effective_from()
            )));
        }
    }

    infrastructure::append_policy_version(&state.db, &policy, &authorization).await?;

    let as_of = Utc::now().date_naive();
    let schedule = infrastructure::load_attendance_policy(&state.db)
        .await?
        .ok_or_else(|| {
            AppError::Configuration("the policy just written is not there".to_owned())
        })?;
    Ok(Json(view(&schedule, as_of)))
}
