//! The confidential channel: what was complained about, who investigated,
//! and who decided.
//!
//! # The point of the module is where the queue lands
//!
//! A grievance against a store manager cannot be investigated by that store
//! manager, and in a thirteen-store estate the only place that is nobody's
//! posting is head office. So the queue is HO's whoever files: any employee
//! raises their own under `people.grievance.request_own` — the essential key,
//! because a complaint about your own supervisor that has to be handed to
//! your supervisor is not a confidential channel — a manager files on a
//! colleague's behalf under `people.grievance.file`, and investigating and
//! resolving are two DISJOINT ADMIN keys. Reading the queue is its own key
//! too (`people.grievance.read`): the accused supervisor holds
//! `people.employee.read` because a rota needs names, and that read must not
//! therefore open a list of who complained about whom.
//!
//! # Two actors, one rule, held twice
//!
//! Nobody investigates or resolves their own filing. Like the claims lane's
//! two-actor rule the check lives on the transition and on the way in from
//! storage — a stored grievance whose investigator and filer carry one name
//! fails to hydrate rather than becoming an inquiry one person completed —
//! and the schema holds the state-to-column pairings a third time as CHECKs.
//! One actor has two names here (the employee row is `raised_by`, the
//! signature is `file_by`): the rule compares the names the act was signed
//! with, which is the username.
//!
//! # The machine
//!
//! OPEN → INVESTIGATED → RESOLVED | INVALID, and a filer's WITHDRAWN from
//! OPEN or INVESTIGATED. Resolution requires an investigation — a queue that
//! let `decide` skip `investigate` would record verdicts with no inquiry
//! behind them, and the INVESTIGATED half would be decoration. Every method
//! takes the [`Authorization`] of the act and checks the key it was recorded
//! under, so a grievance cannot pass through a state on an authority that
//! could not have taken it there.
//!
//! [`EmployeeGrievance::try_new`] is the fold: it re-runs every rule on the
//! way in from storage, so a row edited into a shape no sequence of
//! decisions could reach fails to load rather than becoming a resolved
//! complaint.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::employment::{Authorization, EmployeeId, UnitId};

pub const MAX_SUBJECT_LEN: usize = 200;
pub const MAX_DESCRIPTION_LEN: usize = 4_000;
pub const MAX_CAUSE_LEN: usize = 4_000;
pub const MAX_NAME_LEN: usize = 140;
pub const MAX_CODE_LEN: usize = 40;
/// The id cap the employment ids keep; restated rather than re-exported, the
/// way the claims lane carries its own.
pub const MAX_GRIEVANCE_ID_LEN: usize = 64;

/// What the grievance kernel refuses, and the names it refuses them by.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum GrievanceError {
    #[error("{field} is not a usable identifier")]
    InvalidId { field: &'static str },
    #[error(
        "a grievance needs a subject; a complaint about nothing is a complaint nobody can answer"
    )]
    SubjectRequired,
    #[error("a grievance needs a description; what happened is the part nobody else knows")]
    DescriptionRequired,
    #[error("{code} is not a grievance kind anybody has defined")]
    UnknownGrievanceType { code: String },
    #[error("{code} is already a grievance kind")]
    DuplicateGrievanceType { code: String },
    #[error("{code} was retired on {retired_on} and takes no new grievances")]
    GrievanceTypeRetired { code: String, retired_on: NaiveDate },
    #[error("action `{action_key}` does not authorize filing a grievance")]
    ActionForbidsFiling { action_key: String },
    #[error("action `{action_key}` does not authorize investigating a grievance")]
    ActionForbidsInvestigation { action_key: String },
    #[error("action `{action_key}` does not authorize resolving a grievance")]
    ActionForbidsResolution { action_key: String },
    #[error(
        "the grievance is {state} and only an open grievance can be taken up for investigation"
    )]
    GrievanceNotOpen { state: &'static str },
    #[error("the grievance is {state} and only an investigated grievance can be resolved")]
    GrievanceNotInvestigated { state: &'static str },
    #[error("the grievance is {state} and can no longer be withdrawn")]
    GrievanceNotWithdrawable { state: &'static str },
    #[error("only the person who filed a grievance may withdraw it")]
    WithdrawalNotByFiler,
    #[error("{actor} filed this grievance and may not investigate their own")]
    SameActorFiledAndInvestigated { actor: String },
    #[error("{actor} filed this grievance and may not resolve their own")]
    SameActorFiledAndResolved { actor: String },
}

fn validated(field: &'static str, raw: &str, max: usize) -> Result<String, GrievanceError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) || trimmed.chars().count() > max
    {
        return Err(GrievanceError::InvalidId { field });
    }
    Ok(trimmed.to_owned())
}

/// One grievance, by its id — the uuid the handler mints, carried as text.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct GrievanceId(String);

impl GrievanceId {
    pub fn try_new(raw: &str) -> Result<Self, GrievanceError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.chars().count() > MAX_GRIEVANCE_ID_LEN {
            return Err(GrievanceError::InvalidId {
                field: "grievance_id",
            });
        }
        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for GrievanceId {
    type Error = GrievanceError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<GrievanceId> for String {
    fn from(value: GrievanceId) -> Self {
        value.0
    }
}

impl std::fmt::Display for GrievanceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One kind of grievance, by its code.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct GrievanceTypeCode(String);

impl GrievanceTypeCode {
    /// Uppercased on the way in, so `pay` and `PAY` are one kind rather than
    /// two that separately run out — the same discipline the claim catalogue
    /// keeps, for the same reason: the code is stored, and two spellings of
    /// one kind would make every total incomparable with itself.
    pub fn try_new(raw: &str) -> Result<Self, GrievanceError> {
        validated("grievance_type_code", raw, MAX_CODE_LEN).map(|code| Self(code.to_uppercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for GrievanceTypeCode {
    type Error = GrievanceError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<GrievanceTypeCode> for String {
    fn from(value: GrievanceTypeCode) -> Self {
        value.0
    }
}

impl std::fmt::Display for GrievanceTypeCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One entry of the grievance kind catalogue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GrievanceType {
    code: GrievanceTypeCode,
    name: String,
    retired_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

impl GrievanceType {
    pub fn try_new(
        code: GrievanceTypeCode,
        name: &str,
        created_at: DateTime<Utc>,
    ) -> Result<Self, GrievanceError> {
        let name = validated("grievance_type_name", name, MAX_NAME_LEN)?;
        Ok(Self {
            code,
            name,
            retired_at: None,
            created_at,
        })
    }

    /// The stored shape, so decoding re-runs the rules. A type cannot be
    /// rebuilt retired and retired at once nothing — retirement arrives
    /// through [`GrievanceType::retire`] and is dated by the server.
    pub fn try_from_parts(
        code: GrievanceTypeCode,
        name: String,
        retired_at: Option<DateTime<Utc>>,
        created_at: DateTime<Utc>,
    ) -> Result<Self, GrievanceError> {
        let name = validated("grievance_type_name", &name, MAX_NAME_LEN)?;
        Ok(Self {
            code,
            name,
            retired_at,
            created_at,
        })
    }

    /// Retire, never delete: every grievance filed under this code keeps
    /// naming a kind that exists.
    pub fn retire(&mut self, at: DateTime<Utc>) {
        self.retired_at = Some(at);
    }

    pub fn code(&self) -> &GrievanceTypeCode {
        &self.code
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn retired_at(&self) -> Option<DateTime<Utc>> {
        self.retired_at
    }
    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }
    pub fn is_retired(&self) -> bool {
        self.retired_at.is_some()
    }
}

/// Every kind the company has defined, retired ones included — a grievance
/// filed under a kind last year still reads back with its name.
#[derive(Debug, Clone, Default)]
pub struct GrievanceTypeCatalogue {
    types: Vec<GrievanceType>,
}

impl GrievanceTypeCatalogue {
    pub fn try_new(types: Vec<GrievanceType>) -> Result<Self, GrievanceError> {
        let mut seen: Vec<GrievanceTypeCode> = Vec::new();
        for grievance_type in &types {
            if seen.contains(grievance_type.code()) {
                return Err(GrievanceError::DuplicateGrievanceType {
                    code: grievance_type.code().to_string(),
                });
            }
            seen.push(grievance_type.code().clone());
        }
        Ok(Self { types })
    }

    pub fn define(&mut self, grievance_type: GrievanceType) -> Result<(), GrievanceError> {
        if self.types.iter().any(|t| t.code() == grievance_type.code()) {
            return Err(GrievanceError::DuplicateGrievanceType {
                code: grievance_type.code().to_string(),
            });
        }
        self.types.push(grievance_type);
        Ok(())
    }

    pub fn require(&self, code: &GrievanceTypeCode) -> Result<&GrievanceType, GrievanceError> {
        self.types.iter().find(|t| t.code() == code).ok_or_else(|| {
            GrievanceError::UnknownGrievanceType {
                code: code.to_string(),
            }
        })
    }

    /// The kind a new grievance may name. Retired ones stay readable and
    /// refuse new filings — the catalogue's whole retirement discipline in
    /// one gate.
    pub fn require_active(
        &self,
        code: &GrievanceTypeCode,
    ) -> Result<&GrievanceType, GrievanceError> {
        let grievance_type = self.require(code)?;
        if let Some(retired_at) = grievance_type.retired_at() {
            return Err(GrievanceError::GrievanceTypeRetired {
                code: code.to_string(),
                retired_on: retired_at.date_naive(),
            });
        }
        Ok(grievance_type)
    }

    pub fn types(&self) -> &[GrievanceType] {
        &self.types
    }
}

/// One event of the append-only trail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GrievanceEvent {
    pub actor: String,
    /// `FILED`, `INVESTIGATED`, `RESOLVED`, `INVALID` or `WITHDRAWN`.
    pub action: &'static str,
    pub reason: Option<String>,
    pub at: DateTime<Utc>,
    pub detail: Option<String>,
}

/// Where a grievance stands. The pairings the table CHECKs state are carried
/// here as fields, so the fold has to read them together. The investigation
/// note and the resolution detail are the reason of the authorization that
/// carried them — one record of what was written, not two.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GrievanceState {
    Open,
    Investigated {
        investigated: Authorization,
    },
    Resolved {
        investigated: Authorization,
        decided: Authorization,
        resolved_on: NaiveDate,
    },
    Invalid {
        investigated: Authorization,
        decided: Authorization,
    },
    Withdrawn {
        withdrawn: Authorization,
    },
}

impl GrievanceState {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Open => "OPEN",
            Self::Investigated { .. } => "INVESTIGATED",
            Self::Resolved { .. } => "RESOLVED",
            Self::Invalid { .. } => "INVALID",
            Self::Withdrawn { .. } => "WITHDRAWN",
        }
    }

    /// The investigation, when one has been taken up — the decided states
    /// keep it, because a verdict with the inquiry stripped out is a verdict
    /// nobody can audit.
    pub fn investigation(&self) -> Option<&Authorization> {
        match self {
            Self::Investigated { investigated }
            | Self::Resolved { investigated, .. }
            | Self::Invalid { investigated, .. } => Some(investigated),
            _ => None,
        }
    }

    /// Who resolved, and under what authority — `None` before the decision.
    pub fn resolution(&self) -> Option<&Authorization> {
        match self {
            Self::Resolved { decided, .. } | Self::Invalid { decided, .. } => Some(decided),
            _ => None,
        }
    }

    /// The day a RESOLVED resolution took effect, exactly when there is one.
    pub fn resolved_on(&self) -> Option<NaiveDate> {
        match self {
            Self::Resolved { resolved_on, .. } => Some(*resolved_on),
            _ => None,
        }
    }
}

/// The stored shape, so decoding re-runs every rule.
#[derive(Debug, Clone)]
pub struct EmployeeGrievanceWire {
    pub id: GrievanceId,
    pub unit: UnitId,
    pub type_code: GrievanceTypeCode,
    pub raised_by: EmployeeId,
    pub filed_by: String,
    pub against: Option<EmployeeId>,
    pub subject: String,
    pub description: String,
    pub cause: Option<String>,
    pub state: GrievanceState,
    pub history: Vec<GrievanceEvent>,
}

/// One grievance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EmployeeGrievance {
    id: GrievanceId,
    /// Where the grievance arises — the raiser's posting, read from the
    /// employment record and never taken from the body.
    unit: UnitId,
    type_code: GrievanceTypeCode,
    raised_by: EmployeeId,
    filed_by: String,
    against: Option<EmployeeId>,
    subject: String,
    description: String,
    cause: Option<String>,
    state: GrievanceState,
    history: Vec<GrievanceEvent>,
}

fn history_event(
    actor: &str,
    action: &'static str,
    reason: Option<&super::employment::ReasonText>,
    at: DateTime<Utc>,
) -> GrievanceEvent {
    GrievanceEvent {
        actor: actor.to_owned(),
        action,
        reason: reason.map(|reason| reason.to_string()),
        at,
        detail: None,
    }
}

impl EmployeeGrievance {
    /// File one. The authorization records the key that actually applied —
    /// `people.grievance.request_own` for somebody filing their own
    /// complaint, `people.grievance.file` for a manager filing on a
    /// colleague's behalf — so the stored grievance says which authority it
    /// rested on.
    pub fn file(
        id: GrievanceId,
        unit: UnitId,
        raised_by: EmployeeId,
        against: Option<EmployeeId>,
        subject: String,
        description: String,
        cause: Option<String>,
        catalogue: &GrievanceTypeCatalogue,
        type_code: &GrievanceTypeCode,
        authorization: Authorization,
    ) -> Result<Self, GrievanceError> {
        if !authorization.authorizes_grievance_filing() {
            return Err(GrievanceError::ActionForbidsFiling {
                action_key: authorization.action_key().to_owned(),
            });
        }
        let subject = {
            let trimmed = subject.trim();
            if trimmed.is_empty() || trimmed.chars().count() > MAX_SUBJECT_LEN {
                return Err(GrievanceError::SubjectRequired);
            }
            trimmed.to_owned()
        };
        let description = {
            let trimmed = description.trim();
            if trimmed.is_empty() || trimmed.chars().count() > MAX_DESCRIPTION_LEN {
                return Err(GrievanceError::DescriptionRequired);
            }
            trimmed.to_owned()
        };
        let cause = match cause {
            Some(cause) => {
                let trimmed = cause.trim();
                if trimmed.is_empty() {
                    None
                } else if trimmed.chars().count() > MAX_CAUSE_LEN {
                    return Err(GrievanceError::InvalidId { field: "cause" });
                } else {
                    Some(trimmed.to_owned())
                }
            }
            None => None,
        };
        catalogue.require_active(type_code)?;
        Ok(Self {
            id,
            unit,
            type_code: type_code.clone(),
            raised_by,
            filed_by: authorization.actor().to_string(),
            against,
            subject,
            description,
            cause,
            state: GrievanceState::Open,
            history: vec![history_event(
                authorization.actor().as_str(),
                "FILED",
                Some(authorization.reason()),
                authorization.at(),
            )],
        })
    }

    /// Rebuild from storage, re-running every rule the live path enforces.
    pub fn try_new(
        wire: EmployeeGrievanceWire,
        catalogue: &GrievanceTypeCatalogue,
    ) -> Result<Self, GrievanceError> {
        if wire.subject.trim().is_empty() || wire.subject.chars().count() > MAX_SUBJECT_LEN {
            return Err(GrievanceError::SubjectRequired);
        }
        if wire.description.trim().is_empty()
            || wire.description.chars().count() > MAX_DESCRIPTION_LEN
        {
            return Err(GrievanceError::DescriptionRequired);
        }
        catalogue.require(&wire.type_code)?;
        // The two-actor rule, on the way in from storage as well as on the
        // live path: a rule only the live path enforces is a rule a round
        // trip through the database removes.
        match &wire.state {
            GrievanceState::Investigated { investigated } => {
                check_investigation(investigated, &wire.filed_by)?;
            }
            GrievanceState::Resolved {
                investigated,
                decided,
                ..
            }
            | GrievanceState::Invalid {
                investigated,
                decided,
            } => {
                check_investigation(investigated, &wire.filed_by)?;
                check_resolution(decided, &wire.filed_by)?;
            }
            GrievanceState::Withdrawn { withdrawn } => {
                if !withdrawn.authorizes_grievance_filing() {
                    return Err(GrievanceError::ActionForbidsFiling {
                        action_key: withdrawn.action_key().to_owned(),
                    });
                }
                if withdrawn.actor().as_str() != wire.filed_by {
                    return Err(GrievanceError::WithdrawalNotByFiler);
                }
            }
            GrievanceState::Open => {}
        }
        Ok(Self {
            id: wire.id,
            unit: wire.unit,
            type_code: wire.type_code,
            raised_by: wire.raised_by,
            filed_by: wire.filed_by,
            against: wire.against,
            subject: wire.subject,
            description: wire.description,
            cause: wire.cause,
            state: wire.state,
            history: wire.history,
        })
    }

    /// Take it up for investigation. From OPEN, under the investigating key,
    /// never by the filer; the note is the act's reason, and the history
    /// keeps it beside the state.
    pub fn investigate(&mut self, authorization: Authorization) -> Result<(), GrievanceError> {
        if !matches!(self.state, GrievanceState::Open) {
            return Err(GrievanceError::GrievanceNotOpen {
                state: self.state.code(),
            });
        }
        if !authorization.authorizes_grievance_investigation() {
            return Err(GrievanceError::ActionForbidsInvestigation {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if authorization.actor().as_str() == self.filed_by {
            return Err(GrievanceError::SameActorFiledAndInvestigated {
                actor: authorization.actor().to_string(),
            });
        }
        self.history.push(history_event(
            authorization.actor().as_str(),
            "INVESTIGATED",
            Some(authorization.reason()),
            authorization.at(),
        ));
        self.state = GrievanceState::Investigated {
            investigated: authorization,
        };
        Ok(())
    }

    /// Resolve it: upheld, or refused as invalid — one decision, two
    /// answers, each with the detail the decider wrote as its reason.
    ///
    /// Only an investigated grievance resolves; a verdict ahead of its
    /// inquiry is not a shortcut this machine offers. The resolution date is
    /// the day of the act, on the server's clock, because the date a report
    /// counts is the day somebody stood behind the answer.
    pub fn decide(
        &mut self,
        valid: bool,
        authorization: Authorization,
    ) -> Result<(), GrievanceError> {
        let investigated = match &self.state {
            GrievanceState::Investigated { investigated } => investigated.clone(),
            other => {
                return Err(GrievanceError::GrievanceNotInvestigated {
                    state: other.code(),
                })
            }
        };
        if !authorization.authorizes_grievance_resolution() {
            return Err(GrievanceError::ActionForbidsResolution {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if authorization.actor().as_str() == self.filed_by {
            return Err(GrievanceError::SameActorFiledAndResolved {
                actor: authorization.actor().to_string(),
            });
        }
        self.history.push(history_event(
            authorization.actor().as_str(),
            if valid { "RESOLVED" } else { "INVALID" },
            Some(authorization.reason()),
            authorization.at(),
        ));
        self.state = if valid {
            GrievanceState::Resolved {
                investigated,
                resolved_on: authorization.at().date_naive(),
                decided: authorization,
            }
        } else {
            GrievanceState::Invalid {
                investigated,
                decided: authorization,
            }
        };
        Ok(())
    }

    /// Take it back. The filer's, from OPEN or INVESTIGATED, recorded under
    /// the filing key that applied. Anyone else who wants a grievance gone
    /// must resolve it — INVALID is a decision with a name on it, and
    /// letting a third party "withdraw" would dispose of a complaint while
    /// making it look like the filer changed their own mind.
    pub fn withdraw(&mut self, authorization: Authorization) -> Result<(), GrievanceError> {
        if !matches!(
            self.state,
            GrievanceState::Open | GrievanceState::Investigated { .. }
        ) {
            return Err(GrievanceError::GrievanceNotWithdrawable {
                state: self.state.code(),
            });
        }
        if !authorization.authorizes_grievance_filing() {
            return Err(GrievanceError::ActionForbidsFiling {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if authorization.actor().as_str() != self.filed_by {
            return Err(GrievanceError::WithdrawalNotByFiler);
        }
        self.history.push(history_event(
            authorization.actor().as_str(),
            "WITHDRAWN",
            Some(authorization.reason()),
            authorization.at(),
        ));
        self.state = GrievanceState::Withdrawn {
            withdrawn: authorization,
        };
        Ok(())
    }

    pub fn id(&self) -> &GrievanceId {
        &self.id
    }
    pub fn unit(&self) -> &UnitId {
        &self.unit
    }
    pub fn type_code(&self) -> &GrievanceTypeCode {
        &self.type_code
    }
    pub fn raised_by(&self) -> &EmployeeId {
        &self.raised_by
    }
    pub fn filed_by(&self) -> &str {
        &self.filed_by
    }
    pub fn against(&self) -> Option<&EmployeeId> {
        self.against.as_ref()
    }
    pub fn subject(&self) -> &str {
        &self.subject
    }
    pub fn description(&self) -> &str {
        &self.description
    }
    pub fn cause(&self) -> Option<&str> {
        self.cause.as_deref()
    }
    pub fn state(&self) -> &GrievanceState {
        &self.state
    }
    pub fn history(&self) -> &[GrievanceEvent] {
        &self.history
    }
}

fn check_investigation(investigated: &Authorization, filed_by: &str) -> Result<(), GrievanceError> {
    if !investigated.authorizes_grievance_investigation() {
        return Err(GrievanceError::ActionForbidsInvestigation {
            action_key: investigated.action_key().to_owned(),
        });
    }
    if investigated.actor().as_str() == filed_by {
        return Err(GrievanceError::SameActorFiledAndInvestigated {
            actor: investigated.actor().to_string(),
        });
    }
    Ok(())
}

fn check_resolution(decided: &Authorization, filed_by: &str) -> Result<(), GrievanceError> {
    if !decided.authorizes_grievance_resolution() {
        return Err(GrievanceError::ActionForbidsResolution {
            action_key: decided.action_key().to_owned(),
        });
    }
    if decided.actor().as_str() == filed_by {
        return Err(GrievanceError::SameActorFiledAndResolved {
            actor: decided.actor().to_string(),
        });
    }
    Ok(())
}
