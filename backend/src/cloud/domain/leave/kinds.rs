//! The kinds of leave, and what each of them draws on.
//!
//! # One balance with a label beside it is the wrong model
//!
//! It is the obvious one, and it is wrong for most of Indonesian leave law —
//! wrong in the direction that takes days off people:
//!
//! * **Cuti sakit** is not deducted from anything. UU 13/2003 art. 93 obliges
//!   the employer to keep paying a worker who is ill and has a doctor's
//!   certificate, for as long as the certificate says. There is no annual quota
//!   to run out of, and a system that deducts sick days from the twelve annual
//!   days is taking something the law does not allow it to take.
//! * **Cuti melahirkan** is likewise an entitlement rather than a withdrawal:
//!   three months under art. 82, touching no balance.
//! * **Cuti karena alasan penting** (art. 93(4)) is a *per-occurrence*
//!   allowance — three days to marry, two when a child marries, two for a
//!   bereavement in the immediate family. Bounded per event, not per year, and
//!   it does not accumulate: a second marriage next year gets the same three
//!   days.
//! * **Cuti di luar tanggungan perusahaan** is unpaid and unbounded. What it
//!   costs is pay, not days.
//!
//! So [`LeaveBacking`] is what a kind draws on, and asking a balance of a kind
//! that has none is a malformed question rather than one whose answer is zero.
//! The difference matters, because `0` is a number somebody can refuse leave
//! with.
//!
//! # What is deliberately not compiled in
//!
//! The statutory kinds above are the floor, not the list. Employers add their
//! own — *cuti ulang tahun*, blood-donation leave, extra days after long
//! service — and a closed enum here would mean a code change and a deploy for
//! each one.
//!
//! Nor are the statutory *numbers* here. Three days for a marriage is a figure
//! from art. 93(4), and the day it is amended a constant compiled in here
//! becomes quietly wrong. The operator states the bound when they define the
//! kind.

use super::error::LeaveError;
use super::units::LeaveDays;
use serde::{Deserialize, Serialize};

pub const MAX_CODE_LEN: usize = 40;
pub const MAX_NAME_LEN: usize = 140;

fn validated(field: &'static str, raw: &str, max: usize) -> Result<String, LeaveError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return Err(LeaveError::InvalidId { field });
    }
    if trimmed.chars().count() > max {
        return Err(LeaveError::InvalidId { field });
    }
    Ok(trimmed.to_owned())
}

/// A kind of leave, by its code.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct LeaveTypeCode(String);

impl LeaveTypeCode {
    /// Uppercased on the way in, so `cuti_sakit` and `CUTI_SAKIT` are one kind
    /// rather than two that separately run out.
    pub fn try_new(raw: &str) -> Result<Self, LeaveError> {
        validated("leave_type_code", raw, MAX_CODE_LEN).map(|code| Self(code.to_uppercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for LeaveTypeCode {
    type Error = LeaveError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<LeaveTypeCode> for String {
    fn from(value: LeaveTypeCode) -> Self {
        value.0
    }
}

impl std::fmt::Display for LeaveTypeCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// What a kind of leave draws on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LeaveBacking {
    /// Drawn from a balance that accrues, carries forward and runs out —
    /// *cuti tahunan*, *cuti besar*. The only kind a ledger applies to.
    Balance,
    /// A fixed allowance **per occurrence**, not per year: three days when you
    /// marry, two for a bereavement. It does not accumulate and there is no
    /// running total to deplete.
    PerOccurrence { max_days: LeaveDays },
    /// Bounded by evidence rather than by a number: sick leave for as long as
    /// the certificate says, maternity leave for the statutory period. No
    /// balance is consulted and no cap is applied here, because the cap is not
    /// this module's to know.
    AsCertified,
}

impl LeaveBacking {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Balance => "BALANCE",
            Self::PerOccurrence { .. } => "PER_OCCURRENCE",
            Self::AsCertified => "AS_CERTIFIED",
        }
    }

    pub const fn draws_on_balance(self) -> bool {
        matches!(self, Self::Balance)
    }
}

/// How the day is paid.
///
/// A boolean would do for the two cases a payslip cares about, and sick leave
/// is neither: UU 13/2003 art. 93(2) pays it on a declining scale over four
/// quarters. That scale is statutory arithmetic and is deliberately not here —
/// this enum records only *which* rule applies, so payroll asks rather than
/// assuming full pay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LeavePayment {
    Full,
    Unpaid,
    StatutoryScale,
}

impl LeavePayment {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Full => "FULL",
            Self::Unpaid => "UNPAID",
            Self::StatutoryScale => "STATUTORY_SCALE",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "FULL" => Some(Self::Full),
            "UNPAID" => Some(Self::Unpaid),
            "STATUTORY_SCALE" => Some(Self::StatutoryScale),
            _ => None,
        }
    }
}

/// The wire shape, so decoding runs the constructor.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeaveTypeWire {
    pub code: LeaveTypeCode,
    pub name: String,
    pub backing: LeaveBacking,
    pub payment: LeavePayment,
    #[serde(default)]
    pub requires_evidence: bool,
}

/// One kind of leave, as the operator ratified it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "LeaveTypeWire")]
pub struct LeaveType {
    code: LeaveTypeCode,
    name: String,
    backing: LeaveBacking,
    payment: LeavePayment,
    requires_evidence: bool,
}

impl TryFrom<LeaveTypeWire> for LeaveType {
    type Error = LeaveError;
    fn try_from(wire: LeaveTypeWire) -> Result<Self, Self::Error> {
        Self::try_new(
            wire.code,
            &wire.name,
            wire.backing,
            wire.payment,
            wire.requires_evidence,
        )
    }
}

impl LeaveType {
    pub fn try_new(
        code: LeaveTypeCode,
        name: &str,
        backing: LeaveBacking,
        payment: LeavePayment,
        requires_evidence: bool,
    ) -> Result<Self, LeaveError> {
        if let LeaveBacking::PerOccurrence { max_days } = backing {
            // An allowance of no days is not an allowance.
            if !max_days.is_positive() {
                return Err(LeaveError::NotPositive { field: "max_days" });
            }
        }
        // "Bounded by the certificate" with no certificate required is
        // unbounded leave that nobody decided to grant.
        if matches!(backing, LeaveBacking::AsCertified) && !requires_evidence {
            return Err(LeaveError::CertifiedLeaveWithoutEvidence {
                leave_type: code.to_string(),
            });
        }
        let name = validated("leave_type_name", name, MAX_NAME_LEN)?;
        Ok(Self {
            code,
            name,
            backing,
            payment,
            requires_evidence,
        })
    }

    pub fn code(&self) -> &LeaveTypeCode {
        &self.code
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn backing(&self) -> LeaveBacking {
        self.backing
    }
    pub fn payment(&self) -> LeavePayment {
        self.payment
    }
    pub const fn requires_evidence(&self) -> bool {
        self.requires_evidence
    }
    pub const fn draws_on_balance(&self) -> bool {
        self.backing.draws_on_balance()
    }

    pub fn max_days_per_occurrence(&self) -> Option<LeaveDays> {
        match self.backing {
            LeaveBacking::PerOccurrence { max_days } => Some(max_days),
            _ => None,
        }
    }

    /// The guard every balance question passes through.
    ///
    /// Asking how many sick days are left is not a question with a small
    /// answer; it is a malformed question, and answering `0` would let a caller
    /// refuse leave the law requires on the grounds that the employee has "run
    /// out".
    pub fn require_balance_backed(&self) -> Result<(), LeaveError> {
        if self.draws_on_balance() {
            return Ok(());
        }
        Err(LeaveError::NotBalanceBacked {
            leave_type: self.code.to_string(),
        })
    }
}

/// Every kind the operator has defined, in definition order.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct LeaveTypeCatalogue {
    types: Vec<LeaveType>,
}

impl<'de> Deserialize<'de> for LeaveTypeCatalogue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let types = Vec::<LeaveType>::deserialize(deserializer)?;
        Self::try_new(types).map_err(serde::de::Error::custom)
    }
}

impl LeaveTypeCatalogue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn try_new(types: Vec<LeaveType>) -> Result<Self, LeaveError> {
        let mut catalogue = Self::default();
        for leave_type in types {
            catalogue.define(leave_type)?;
        }
        Ok(catalogue)
    }

    pub fn define(&mut self, leave_type: LeaveType) -> Result<(), LeaveError> {
        if self.get(leave_type.code()).is_some() {
            return Err(LeaveError::DuplicateLeaveType {
                leave_type: leave_type.code().to_string(),
            });
        }
        self.types.push(leave_type);
        Ok(())
    }

    pub fn get(&self, code: &LeaveTypeCode) -> Option<&LeaveType> {
        self.types.iter().find(|kind| kind.code() == code)
    }

    /// Refused rather than defaulted to annual leave, which is how somebody's
    /// balance quietly pays for their sick days.
    pub fn require(&self, code: &LeaveTypeCode) -> Result<&LeaveType, LeaveError> {
        self.get(code).ok_or_else(|| LeaveError::UnknownLeaveType {
            leave_type: code.to_string(),
        })
    }

    pub fn types(&self) -> &[LeaveType] {
        &self.types
    }

    pub fn balance_backed(&self) -> impl Iterator<Item = &LeaveType> {
        self.types.iter().filter(|kind| kind.draws_on_balance())
    }
}
