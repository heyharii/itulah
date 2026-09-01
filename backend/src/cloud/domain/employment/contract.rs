//! The employment contract: what kind, until when, at what position and grade.
//!
//! # The rule this module exists to make structural
//!
//! Indonesian law recognises two kinds of contract, and the difference is
//! entirely about an end date:
//!
//! * **PKWT** (*perjanjian kerja waktu tertentu*) is fixed-term. It **must**
//!   say when it ends — an open-ended PKWT is not a PKWT, and under UU 13/2003
//!   art. 59 a PKWT that fails its own requirements converts to PKWTT by
//!   operation of law.
//! * **PKWTT** (*perjanjian kerja waktu tidak tertentu*) is permanent. It
//!   **must not** carry an end date, because there is nothing for one to mean.
//!
//! In a schema where `kind` is a string and `ends_on` is a nullable column,
//! both mistakes are one typo away and neither is visible until somebody's
//! contract silently expires — or silently does not. Here [`ContractKind`]
//! *carries* the end date in the fixed-term case and has nowhere to put one in
//! the permanent case, so neither state is representable.
//!
//! # What this module does not decide
//!
//! Whether a PKWT has been renewed too often, or run too long, and has
//! therefore converted to PKWTT by law. The rules (and their post-Cipta-Kerja
//! amendments) are a statutory matter with real consequences, and guessing at
//! them silently is worse than not answering: [`ContractTimeline::pkwt_run`]
//! reports the facts — how many consecutive fixed terms, spanning what — and a
//! human or a later statutory crate draws the conclusion.

use super::audit::Authorization;
use super::error::EmployeeError;
use super::ids::validated_text;
use chrono::NaiveDate;

/// Bounded maximum length of a position or grade label.
pub const MAX_LABEL_LEN: usize = 120;

/// A job title. Free text, because an organisation's own vocabulary is not
/// this crate's to enumerate.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Position(String);

/// A pay grade or band. Also free text: what it *pays* is
/// the pay module's, and keeping the two apart is what stops a rename of
/// the band from looking like a pay change.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Grade(String);

macro_rules! label {
    ($name:ident, $field:literal) => {
        impl $name {
            /// Validate: trimmed, non-empty, printable, bounded.
            pub fn try_new(raw: &str) -> Result<Self, EmployeeError> {
                validated_text($field, raw, MAX_LABEL_LEN).map($name)
            }

            /// The label.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = EmployeeError;
            fn try_from(value: String) -> Result<Self, Self::Error> {
                $name::try_new(&value)
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> String {
                value.0
            }
        }
    };
}

label!(Position, "position");
label!(Grade, "grade");

/// Which kind of contract, and — for the only kind that has one — when it ends.
///
/// The end date lives inside the variant, not beside it. See the module docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContractKind {
    /// Fixed-term. Carries the day it ends, inclusive.
    Pkwt {
        /// The last day of the term.
        ends_on: NaiveDate,
    },
    /// Permanent. There is no end date, and no field to put one in.
    Pkwtt,
}

impl ContractKind {
    /// Stable wire code.
    pub fn code(self) -> &'static str {
        match self {
            ContractKind::Pkwt { .. } => "PKWT",
            ContractKind::Pkwtt => "PKWTT",
        }
    }

    /// The last day of the term, for a fixed-term contract.
    pub fn ends_on(self) -> Option<NaiveDate> {
        match self {
            ContractKind::Pkwt { ends_on } => Some(ends_on),
            ContractKind::Pkwtt => None,
        }
    }

    /// Is this a fixed term?
    pub fn is_fixed_term(self) -> bool {
        matches!(self, ContractKind::Pkwt { .. })
    }
}

/// One contract: its kind, its start, the position and grade it is for, and
/// the decision that created it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "ContractWire")]
pub struct Contract {
    kind: ContractKind,
    starts_on: NaiveDate,
    position: Position,
    grade: Grade,
    authorization: Authorization,
}

/// Deserialization shim, so a stored contract re-runs its own constructor.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContractWire {
    kind: ContractKind,
    starts_on: NaiveDate,
    position: Position,
    grade: Grade,
    authorization: Authorization,
}

impl TryFrom<ContractWire> for Contract {
    type Error = EmployeeError;
    fn try_from(value: ContractWire) -> Result<Self, Self::Error> {
        Contract::try_new(
            value.kind,
            value.starts_on,
            value.position,
            value.grade,
            value.authorization,
        )
    }
}

impl Contract {
    /// Build a contract, refusing a fixed term that ends before it starts and
    /// an authority that may not sign one.
    pub fn try_new(
        kind: ContractKind,
        starts_on: NaiveDate,
        position: Position,
        grade: Grade,
        authorization: Authorization,
    ) -> Result<Self, EmployeeError> {
        if !authorization.authorizes_contract_change() {
            return Err(EmployeeError::ActionForbidsContractChange {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if let ContractKind::Pkwt { ends_on } = kind {
            if ends_on < starts_on {
                return Err(EmployeeError::ContractEndsBeforeStart {
                    from: starts_on,
                    to: ends_on,
                });
            }
        }
        Ok(Contract {
            kind,
            starts_on,
            position,
            grade,
            authorization,
        })
    }

    /// The kind, carrying the end date if there is one.
    pub fn kind(&self) -> ContractKind {
        self.kind
    }
    /// The first day of the term.
    pub fn starts_on(&self) -> NaiveDate {
        self.starts_on
    }
    /// The last day of the term, for a fixed term.
    pub fn ends_on(&self) -> Option<NaiveDate> {
        self.kind.ends_on()
    }
    /// The position held under this contract.
    pub fn position(&self) -> &Position {
        &self.position
    }
    /// The grade held under this contract.
    pub fn grade(&self) -> &Grade {
        &self.grade
    }
    /// Who signed it off, and why.
    pub fn authorization(&self) -> &Authorization {
        &self.authorization
    }

    /// Is this contract in force on `date`?
    pub fn covers(&self, date: NaiveDate) -> bool {
        date >= self.starts_on && self.ends_on().is_none_or(|end| date <= end)
    }
}

/// Every contract one person has held, oldest first and non-overlapping.
///
/// Effective-dated for the same reason assignment is: "what were they on in
/// March?" must still be answerable in December, and a renewal must not erase
/// the term it renewed.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(transparent)]
pub struct ContractTimeline {
    contracts: Vec<Contract>,
}

impl<'de> serde::Deserialize<'de> for ContractTimeline {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let contracts = Vec::<Contract>::deserialize(deserializer)?;
        ContractTimeline::try_new(contracts).map_err(serde::de::Error::custom)
    }
}

impl ContractTimeline {
    /// An empty timeline.
    pub fn new() -> Self {
        ContractTimeline {
            contracts: Vec::new(),
        }
    }

    /// Rebuild a stored timeline, re-running every ordering and overlap rule.
    pub fn try_new(contracts: Vec<Contract>) -> Result<Self, EmployeeError> {
        let mut timeline = ContractTimeline::new();
        for contract in contracts {
            timeline.append(contract)?;
        }
        Ok(timeline)
    }

    /// Append a contract after every one already held.
    ///
    /// Refuses a contract that starts before the previous one ends, and one
    /// that follows a **permanent** contract at all — PKWTT is open-ended, so
    /// there is no day after it for a successor to start on. Ending a permanent
    /// contract is a termination, which is [`super::Employee`]'s business.
    pub fn append(&mut self, contract: Contract) -> Result<(), EmployeeError> {
        if let Some(previous) = self.contracts.last() {
            match previous.ends_on() {
                None => return Err(EmployeeError::ContractFollowsPermanent),
                Some(end) if contract.starts_on <= end => {
                    return Err(EmployeeError::ContractOverlaps {
                        on: contract.starts_on,
                    })
                }
                Some(_) => {}
            }
        }
        self.contracts.push(contract);
        Ok(())
    }

    /// Every contract, oldest first.
    pub fn contracts(&self) -> &[Contract] {
        &self.contracts
    }

    /// The contract in force on `date`, if any.
    ///
    /// `None` is a real answer, not a missing one: the gap between a term that
    /// ended and one that had not yet started is a period with no contract, and
    /// saying so is more useful than reaching for the nearest.
    pub fn on(&self, date: NaiveDate) -> Option<&Contract> {
        self.contracts.iter().find(|c| c.covers(date))
    }

    /// The most recent contract, in force or not.
    pub fn current(&self) -> Option<&Contract> {
        self.contracts.last()
    }

    /// The run of consecutive fixed terms ending at the latest contract:
    /// how many, and the span they cover.
    ///
    /// Reported, never judged. Whether such a run has converted to PKWTT by
    /// operation of law depends on statutory rules this module deliberately does
    /// not encode — see the module docs.
    pub fn pkwt_run(&self) -> Option<PkwtRun> {
        let last = self.contracts.last()?;
        if !last.kind.is_fixed_term() {
            return None;
        }
        let mut terms = 0usize;
        let mut first_start = last.starts_on;
        for contract in self.contracts.iter().rev() {
            if !contract.kind.is_fixed_term() {
                break;
            }
            terms += 1;
            first_start = contract.starts_on;
        }
        Some(PkwtRun {
            terms,
            from: first_start,
            to: last.ends_on()?,
        })
    }
}

/// A run of back-to-back fixed-term contracts. Facts only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PkwtRun {
    /// How many consecutive fixed terms.
    pub terms: usize,
    /// The first day of the earliest one.
    pub from: NaiveDate,
    /// The last day of the latest one.
    pub to: NaiveDate,
}

impl PkwtRun {
    /// How many days the run spans, inclusive of both ends.
    pub fn days(&self) -> i64 {
        (self.to - self.from).num_days() + 1
    }
}
