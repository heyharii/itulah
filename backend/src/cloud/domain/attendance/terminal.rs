//! Attendance authority: the registered punch station.
//!
//! # The rule this module makes structural
//!
//! **Only a registered, active terminal at a place can create a punch there.**
//! A phone cannot. The employee app cannot. A browser session at head office
//! cannot. Nothing that is not a device standing in a unit can.
//!
//! In the implementation the reference replaced, the punch endpoint took
//! `source` as free text from the request body and *defaulted it to
//! `"fingerprint"`* when absent — so any authenticated caller could mint a
//! punch that looked biometric, at any place, for any employee, at a
//! client-supplied timestamp. That is not a policy gap; it is the absence of an
//! authority model.
//!
//! Here the authority is a type. [`super::Punch`] cannot be built from raw
//! fields at all: it needs a [`TerminalAttestation`], whose fields are private,
//! which has no public constructor, no `Deserialize` and exactly one production
//! path — [`AttendanceTerminal::attest`], on a terminal whose status is
//! [`TerminalStatus::Active`]. No amount of caller creativity produces one from
//! a request body, because there is no function that does it.
//!
//! # Registering one is an audited act, not an insert
//!
//! A row here in `ACTIVE` *is* attendance authority. Creating it is therefore at
//! least as consequential as withdrawing it, so registration takes an
//! [`Authorization`] carrying `people.attendance_terminal.manage` and is
//! head office's. A place that could register its own terminal could register a
//! second one in the stockroom.
//!
//! # Fail closed, at every level
//!
//! The owner's rule is that a reader which is not working, or a template set
//! that failed to load, refuses rather than admits. That rule is enforced in
//! three places and this is the outermost: a suspended or revoked terminal
//! attests nothing, so no punch it sends can be recorded whatever the device
//! believes about itself. The device boundary holds the same property in mock
//! mode — it never fabricates a match — and the edge holds it by refusing a
//! terminal its projection does not list as active.

use super::error::AttendanceError;
use super::ids::TerminalId;
use crate::cloud::domain::employment::{Authorization, EmployeeId, PlaceId};
use serde::{Deserialize, Serialize};
use std::fmt;

/// How an identification was performed at the terminal.
///
/// One value, and it is a decision rather than a placeholder: the owner was
/// asked twice — worn prints in retail and the warehouse, and the people who
/// cannot enrol at all becoming a daily manual correction — and reaffirmed that
/// fingerprint is the only way in. No PIN, no card, no exception.
///
/// It is an enum anyway, so that adding a second method later is a *typed*
/// decision with a wire code and a migration, rather than a string that appears
/// in a database column one afternoon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IdentificationMethod {
    /// 1:N fingerprint identification performed on the terminal itself.
    Fingerprint,
}

impl IdentificationMethod {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Fingerprint => "FINGERPRINT",
        }
    }

    /// An error rather than an `Option`, because every caller is about to
    /// decide whether a stored punch's provenance holds, and a method this
    /// build cannot read must fail the row rather than pass it.
    pub fn parse(code: &str) -> Result<Self, AttendanceError> {
        match code {
            "FINGERPRINT" => Ok(Self::Fingerprint),
            _ => Err(AttendanceError::PunchProvenanceMismatch { field: "method" }),
        }
    }
}

impl fmt::Display for IdentificationMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// How much a terminal is trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TerminalStatus {
    /// Registered and trusted: may attest identifications.
    Active,
    /// Temporarily untrusted — moved, under repair, or sending traffic nobody
    /// can explain. Reversible.
    Suspended,
    /// Permanently untrusted. **Terminal**, with no transition back, because the
    /// physical device the identity named is gone. A row edited from REVOKED to
    /// ACTIVE would resurrect an identity somebody decided to destroy.
    Revoked,
}

impl TerminalStatus {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Suspended => "SUSPENDED",
            Self::Revoked => "REVOKED",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "ACTIVE" => Some(Self::Active),
            "SUSPENDED" => Some(Self::Suspended),
            "REVOKED" => Some(Self::Revoked),
            _ => None,
        }
    }
}

impl fmt::Display for TerminalStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// One recorded change of trust, with the authority behind it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminalEvent {
    to: TerminalStatus,
    authorization: Authorization,
}

impl TerminalEvent {
    pub const fn to(&self) -> TerminalStatus {
        self.to
    }
    pub const fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// The stored shape. The status is recomputed from the history on the way in.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttendanceTerminalWire {
    pub id: TerminalId,
    pub place: PlaceId,
    pub name: String,
    pub status: TerminalStatus,
    pub method: IdentificationMethod,
    pub registered: Authorization,
    #[serde(default)]
    pub history: Vec<TerminalEvent>,
}

/// A punch station registered to exactly one place.
///
/// Not a nullable "current location": a device whose place can be blank is a
/// device that can punch anywhere.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AttendanceTerminal {
    id: TerminalId,
    place: PlaceId,
    name: String,
    status: TerminalStatus,
    method: IdentificationMethod,
    registered: Authorization,
    history: Vec<TerminalEvent>,
}

impl<'de> Deserialize<'de> for AttendanceTerminal {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = AttendanceTerminalWire::deserialize(deserializer)?;
        Self::try_new(
            wire.id,
            wire.place,
            &wire.name,
            wire.status,
            wire.method,
            wire.registered,
            wire.history,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl AttendanceTerminal {
    /// Register a terminal at a place. It starts [`TerminalStatus::Active`] and
    /// can therefore attest immediately.
    ///
    /// Registration *creates* attendance authority where there was none, so it
    /// cannot be the one terminal operation that needs no actor, no key and no
    /// reason on the record.
    pub fn register(
        id: TerminalId,
        place: PlaceId,
        name: &str,
        method: IdentificationMethod,
        authorization: Authorization,
    ) -> Result<Self, AttendanceError> {
        Self::try_new(
            id,
            place,
            name,
            TerminalStatus::Active,
            method,
            authorization,
            Vec::new(),
        )
    }

    /// Rebuild from storage, re-running the whole trust machine.
    ///
    /// Refuses a registration or a transition authorized by a key that may not
    /// administer a terminal, an illegal transition, and a claimed status the
    /// history does not produce — so a row cannot say ACTIVE when its last
    /// recorded event revoked it.
    pub fn try_new(
        id: TerminalId,
        place: PlaceId,
        name: &str,
        status: TerminalStatus,
        method: IdentificationMethod,
        registered: Authorization,
        history: Vec<TerminalEvent>,
    ) -> Result<Self, AttendanceError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AttendanceError::Required {
                field: "terminal name",
            });
        }
        Self::require_administering(&registered)?;
        let mut folded = TerminalStatus::Active;
        for event in &history {
            Self::require_administering(&event.authorization)?;
            folded = Self::advance(folded, event.to)?;
        }
        if folded != status {
            return Err(AttendanceError::TerminalStatusContradictsHistory);
        }
        Ok(Self {
            id,
            place,
            name: name.to_owned(),
            status,
            method,
            registered,
            history,
        })
    }

    fn require_administering(authorization: &Authorization) -> Result<(), AttendanceError> {
        if authorization.authorizes_terminal_administration() {
            return Ok(());
        }
        Err(AttendanceError::ActionForbidsTerminalAdministration {
            action_key: authorization.action_key().to_owned(),
        })
    }

    /// The trust machine, in one function so there is one place to read it.
    ///
    /// `REVOKED` has no outgoing edge, which is the whole reason this is a
    /// function rather than an assignment.
    fn advance(
        from: TerminalStatus,
        to: TerminalStatus,
    ) -> Result<TerminalStatus, AttendanceError> {
        let permitted = matches!(
            (from, to),
            (TerminalStatus::Active, TerminalStatus::Suspended)
                | (TerminalStatus::Active, TerminalStatus::Revoked)
                | (TerminalStatus::Suspended, TerminalStatus::Active)
                | (TerminalStatus::Suspended, TerminalStatus::Revoked)
        );
        if !permitted {
            return Err(AttendanceError::IllegalTerminalTransition {
                from: from.code(),
                to: to.code(),
            });
        }
        Ok(to)
    }

    pub fn id(&self) -> &TerminalId {
        &self.id
    }
    /// The place the terminal is bound to. It attests for this place only.
    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub const fn status(&self) -> TerminalStatus {
        self.status
    }
    pub const fn method(&self) -> IdentificationMethod {
        self.method
    }
    pub const fn registered(&self) -> &Authorization {
        &self.registered
    }
    pub fn history(&self) -> &[TerminalEvent] {
        &self.history
    }
    pub const fn is_active(&self) -> bool {
        matches!(self.status, TerminalStatus::Active)
    }

    /// Suspend, reactivate or revoke, recording who decided it and why.
    pub fn transition(
        &mut self,
        to: TerminalStatus,
        authorization: Authorization,
    ) -> Result<(), AttendanceError> {
        Self::require_administering(&authorization)?;
        self.status = Self::advance(self.status, to)?;
        self.history.push(TerminalEvent {
            to,
            authorization,
        });
        Ok(())
    }

    /// Attest that this terminal identified `employee` at its own place.
    ///
    /// The **only** way to obtain a [`TerminalAttestation`], and therefore the
    /// only way any punch is ever created. Refused unless the terminal is
    /// active — which is what makes "suspend the device in the stockroom" an
    /// effective act rather than a label.
    pub fn attest(&self, employee: EmployeeId) -> Result<TerminalAttestation, AttendanceError> {
        if !self.is_active() {
            return Err(AttendanceError::TerminalNotActive {
                status: self.status.code(),
            });
        }
        Ok(TerminalAttestation {
            terminal: self.id.clone(),
            place: self.place.clone(),
            employee,
            method: self.method,
        })
    }

    /// Revalidate the provenance a persisted punch claims against this record.
    ///
    /// Deliberately `pub(super)`: it is reachable only through
    /// [`super::Punch::rehydrate`], so it can never be used to mint an
    /// attestation out of nothing. It answers exactly one question — "is this
    /// stored punch still explained by a registered terminal?" — and it does
    /// **not** consult [`AttendanceTerminal::status`], because a punch taken
    /// before the device was suspended or revoked still happened. Revoking a
    /// terminal is not a way to delete history. Trust for *new* attendance is
    /// [`AttendanceTerminal::attest`]'s business, and that one does check.
    pub(super) fn require_persisted_provenance(
        &self,
        terminal: &TerminalId,
        place: &PlaceId,
        method: IdentificationMethod,
    ) -> Result<(), AttendanceError> {
        if &self.id != terminal {
            return Err(AttendanceError::PunchProvenanceMismatch { field: "terminal" });
        }
        if &self.place != place {
            return Err(AttendanceError::PunchProvenanceMismatch { field: "place" });
        }
        if self.method != method {
            return Err(AttendanceError::PunchProvenanceMismatch { field: "method" });
        }
        Ok(())
    }
}

/// Proof that a registered, active terminal identified an employee.
///
/// Private fields, no public constructor, no `Deserialize`, no `Default`: an
/// attestation can only come from [`AttendanceTerminal::attest`]. This is the
/// capability token that makes "attendance authority belongs to a device in a
/// unit" a compile-time fact rather than a runtime check somebody can forget.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TerminalAttestation {
    terminal: TerminalId,
    place: PlaceId,
    employee: EmployeeId,
    method: IdentificationMethod,
}

impl TerminalAttestation {
    pub fn terminal(&self) -> &TerminalId {
        &self.terminal
    }
    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub const fn method(&self) -> IdentificationMethod {
        self.method
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::employment::actions;
    use chrono::{TimeZone, Utc};

    fn authority(action_key: &str) -> Authorization {
        Authorization::try_new(
            "hr.officer",
            action_key,
            Utc.with_ymd_and_hms(2026, 9, 13, 8, 0, 0).unwrap(),
            "registering the entrance terminal",
        )
        .expect("authorization")
    }

    fn terminal() -> AttendanceTerminal {
        AttendanceTerminal::register(
            TerminalId::try_new("term-store-07").unwrap(),
            PlaceId::try_new("store-07").unwrap(),
            "Pintu belakang",
            IdentificationMethod::Fingerprint,
            authority(actions::ATTENDANCE_TERMINAL_MANAGE),
        )
        .expect("register")
    }

    fn employee() -> EmployeeId {
        EmployeeId::try_new("emp-1").expect("employee id")
    }

    /// The whole authority model in one assertion: a terminal is what produces
    /// an attestation, and an attestation is what produces a punch.
    #[test]
    fn an_active_terminal_attests_for_its_own_place() {
        let attestation = terminal().attest(employee()).expect("attest");
        assert_eq!(attestation.place().as_str(), "store-07");
        assert_eq!(attestation.terminal().as_str(), "term-store-07");
        assert_eq!(attestation.method(), IdentificationMethod::Fingerprint);
    }

    /// Fail closed: suspending the device is an act with teeth, not a label.
    #[test]
    fn a_suspended_terminal_attests_nothing() {
        let mut terminal = terminal();
        terminal
            .transition(
                TerminalStatus::Suspended,
                authority(actions::ATTENDANCE_TERMINAL_MANAGE),
            )
            .expect("suspend");
        assert!(matches!(
            terminal.attest(employee()),
            Err(AttendanceError::TerminalNotActive { .. })
        ));
        // And back, because a device under repair comes back from repair.
        terminal
            .transition(
                TerminalStatus::Active,
                authority(actions::ATTENDANCE_TERMINAL_MANAGE),
            )
            .expect("reactivate");
        assert!(terminal.attest(employee()).is_ok());
    }

    /// Revocation is terminal. The physical device the identity named is gone,
    /// and a path back would resurrect an identity somebody destroyed.
    #[test]
    fn revocation_has_no_way_back() {
        let mut terminal = terminal();
        terminal
            .transition(
                TerminalStatus::Revoked,
                authority(actions::ATTENDANCE_TERMINAL_MANAGE),
            )
            .expect("revoke");
        assert!(matches!(
            terminal.transition(
                TerminalStatus::Active,
                authority(actions::ATTENDANCE_TERMINAL_MANAGE)
            ),
            Err(AttendanceError::IllegalTerminalTransition {
                from: "REVOKED",
                to: "ACTIVE"
            })
        ));
    }

    /// Creating attendance authority needs the key for it. Without this a
    /// rota-planning grant would also be a grant to install a punch station.
    #[test]
    fn registering_needs_the_terminal_key() {
        assert!(matches!(
            AttendanceTerminal::register(
                TerminalId::try_new("term-x").unwrap(),
                PlaceId::try_new("store-07").unwrap(),
                "Depan",
                IdentificationMethod::Fingerprint,
                authority(actions::ROSTER_MANAGE),
            ),
            Err(AttendanceError::ActionForbidsTerminalAdministration { .. })
        ));
    }

    /// A row that claims a trust its own evidence contradicts must not hydrate.
    /// Editing `status` in `psql` is exactly how a revoked device comes back.
    #[test]
    fn a_stored_status_the_history_does_not_produce_is_refused() {
        let revocation = serde_json::json!({
            "id": "term-store-07",
            "place": "store-07",
            "name": "Pintu belakang",
            "status": "ACTIVE",
            "method": "FINGERPRINT",
            "registered": authority(actions::ATTENDANCE_TERMINAL_MANAGE),
            "history": [{
                "to": "REVOKED",
                "authorization": authority(actions::ATTENDANCE_TERMINAL_MANAGE),
            }],
        });
        let refused = serde_json::from_value::<AttendanceTerminal>(revocation);
        assert!(refused.is_err(), "a revoked row must not load as active");
    }

    /// The rule that is easy to lose in a round trip: a transition recorded
    /// under a key that never permitted it is not a transition.
    #[test]
    fn a_stored_transition_under_the_wrong_key_is_refused() {
        let forged = serde_json::json!({
            "id": "term-store-07",
            "place": "store-07",
            "name": "Pintu belakang",
            "status": "ACTIVE",
            "method": "FINGERPRINT",
            "registered": authority(actions::ATTENDANCE_TERMINAL_MANAGE),
            "history": [
                { "to": "SUSPENDED", "authorization": authority(actions::ATTENDANCE_TERMINAL_MANAGE) },
                { "to": "ACTIVE", "authorization": authority(actions::LEAVE_DECIDE) },
            ],
        });
        assert!(serde_json::from_value::<AttendanceTerminal>(forged).is_err());
    }
}
