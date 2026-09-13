//! Enrolment: binding a fingerprint to an employment record, and keeping the
//! template somewhere a person can be moved from.
//!
//! # The owner's two decisions, and the shape they force
//!
//! **Templates live in the cloud; enrolment happens at the store.** The donor
//! leaves templates in the vendor's database on the device, which costs two
//! things the owner was not willing to pay: somebody transferred from store-03
//! to store-07 has to re-enrol, and a terminal that dies takes a unit's
//! enrolments with it. So the template is stored centrally, keyed to the
//! employment record, and a terminal pulls only the templates of people posted
//! to its own unit.
//!
//! **Fingerprint is the only way in.** No PIN, no card, no exception — asked
//! twice and reaffirmed. The consequence this module has to carry is that a
//! template is not a convenience: it is the sole credential, so losing one
//! means somebody cannot clock in at all. That is why enrolment records which
//! terminal captured it and what the vendor thought of the capture, and why
//! more than one finger may be enrolled.
//!
//! # Biometric data, and the type that keeps it out of a screen
//!
//! UU 27/2022 art. 4(2)(a) makes biometric data *data pribadi spesifik*. The
//! protection here is structural rather than procedural:
//!
//! * [`SealedTemplate`] has **no `Serialize`**. It cannot be put in a view, a
//!   JSON body, a log line or an error message, because there is no
//!   implementation that would turn it into any of those. A handler that tried
//!   would not compile.
//! * What a screen may see is [`EnrolmentRecord`] — who, when, which finger,
//!   which terminal, what the vendor scored the capture. It is a different type
//!   with different fields, not the same type with a field hidden, so nothing
//!   can reach the bytes by asking a different layer.
//! * The plaintext is the **vendor's feature vector**, never an image. There is
//!   no type here an image would fit in.
//! * Sealing and opening live in `postgres::enrolment`, beside the key, for the
//!   same reason the payroll account number is masked in the storage layer: a
//!   caller must not be able to reach the raw value by asking a lower layer.

use super::error::AttendanceError;
use super::ids::{Finger, TemplateFormat, TerminalId};
use crate::cloud::domain::employment::{Authorization, EmployeeId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

/// One sealed vendor template: the ciphertext, its nonce, and the key that
/// sealed it.
///
/// **Deliberately not `Serialize`, not `Deserialize`, and not `Debug`-revealing.**
/// The only ways to obtain one are [`SealedTemplate::new`] — called by the
/// storage layer, which holds the key — and a database read through the same
/// layer. The only way to consume one is to hand it back for opening. There is
/// no route from here to a browser, and that is checked by the compiler rather
/// than by a reviewer.
#[derive(Clone, PartialEq, Eq)]
pub struct SealedTemplate {
    sealed: Vec<u8>,
    nonce: Vec<u8>,
    key_id: String,
    format: TemplateFormat,
}

/// The nonce width every seal uses. Twelve bytes, which is what AEAD
/// constructions in this family take, and it is a fixed width rather than a
/// range so a short nonce is a refusal rather than a weaker seal.
pub const TEMPLATE_NONCE_LEN: usize = 12;

impl SealedTemplate {
    /// Assemble a sealed template from the parts the storage layer produced.
    ///
    /// Refuses empty ciphertext and a nonce of the wrong width. Both would be
    /// storable — the database's own checks say the same thing — and both mean
    /// the sealing step did not happen, which must not be mistaken for a
    /// template.
    pub fn new(
        sealed: Vec<u8>,
        nonce: Vec<u8>,
        key_id: &str,
        format: TemplateFormat,
    ) -> Result<Self, AttendanceError> {
        if sealed.is_empty() {
            return Err(AttendanceError::Required {
                field: "sealed template",
            });
        }
        if nonce.len() != TEMPLATE_NONCE_LEN {
            return Err(AttendanceError::Required {
                field: "template nonce",
            });
        }
        let key_id = key_id.trim();
        if key_id.is_empty() {
            return Err(AttendanceError::Required {
                field: "template key id",
            });
        }
        Ok(Self {
            sealed,
            nonce,
            key_id: key_id.to_owned(),
            format,
        })
    }

    pub fn sealed(&self) -> &[u8] {
        &self.sealed
    }
    pub fn nonce(&self) -> &[u8] {
        &self.nonce
    }
    pub fn key_id(&self) -> &str {
        &self.key_id
    }
    pub const fn format(&self) -> TemplateFormat {
        self.format
    }
}

/// Says how long it is and under which key, and never what it says.
///
/// A `Debug` that printed the bytes would put a biometric in a log the first
/// time somebody added a `dbg!` to a failing test — which is exactly how
/// regulated data escapes a system that was careful everywhere it was looking.
impl fmt::Debug for SealedTemplate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SealedTemplate")
            .field("bytes", &self.sealed.len())
            .field("key_id", &self.key_id)
            .field("format", &self.format)
            .finish_non_exhaustive()
    }
}

/// What a screen, an audit and an HR officer may see about an enrolment.
///
/// Everything except the template. A different type from [`SealedTemplate`]
/// rather than the same type with a skipped field, because a skipped field is
/// one `#[serde(skip)]` away from being unskipped by somebody who needed the
/// struct for something else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrolmentRecord {
    employee: EmployeeId,
    finger: Finger,
    format: TemplateFormat,
    /// The vendor's own score for the capture, 0..=100, or `None` when the
    /// device did not report one.
    ///
    /// `None` is not zero. Zero is a claim the capture was worthless; "the
    /// sidecar told us nothing" is a different fact, and on the only credential
    /// somebody has it is worth being able to tell them apart.
    quality: Option<u8>,
    /// Which terminal captured it. A run of enrolments that will not match is
    /// usually one reader, and that question is unanswerable after the fact
    /// unless it was written down at the time.
    terminal: TerminalId,
    /// Who enrolled whom, under which key, when, and why.
    enrolled: Authorization,
    /// 1 for a first enrolment, one more for each replacement.
    revision: u32,
}

impl EnrolmentRecord {
    /// Record an enrolment.
    ///
    /// Refuses an authority whose key does not permit enrolling, and a quality
    /// score outside 0..=100. The authority check runs here and again on
    /// decode: a template whose enrolment nobody was allowed to perform is
    /// regulated personal data the company cannot account for holding, which is
    /// a worse position than not holding it.
    pub fn try_new(
        employee: EmployeeId,
        finger: Finger,
        format: TemplateFormat,
        quality: Option<u8>,
        terminal: TerminalId,
        enrolled: Authorization,
        revision: u32,
    ) -> Result<Self, AttendanceError> {
        if !enrolled.authorizes_enrolment() {
            return Err(AttendanceError::ActionForbidsEnrolment {
                action_key: enrolled.action_key().to_owned(),
            });
        }
        if quality.is_some_and(|score| score > 100) {
            return Err(AttendanceError::Required {
                field: "capture quality between 0 and 100",
            });
        }
        if revision == 0 {
            return Err(AttendanceError::Required {
                field: "enrolment revision",
            });
        }
        Ok(Self {
            employee,
            finger,
            format,
            quality,
            terminal,
            enrolled,
            revision,
        })
    }

    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub const fn finger(&self) -> Finger {
        self.finger
    }
    pub const fn format(&self) -> TemplateFormat {
        self.format
    }
    pub const fn quality(&self) -> Option<u8> {
        self.quality
    }
    pub fn terminal(&self) -> &TerminalId {
        &self.terminal
    }
    pub const fn enrolled(&self) -> &Authorization {
        &self.enrolled
    }
    pub const fn revision(&self) -> u32 {
        self.revision
    }
    /// When it was enrolled, read off the authority rather than stored beside
    /// it, so the two cannot disagree.
    pub fn at(&self) -> DateTime<Utc> {
        self.enrolled.at()
    }
}

/// What happened to somebody's enrolment.
///
/// Append-only, and it outlives the template row it describes: the template is
/// deleted when employment ends, and the one thing a disposal must leave behind
/// is the evidence it happened. A store where the evidence dies with the data
/// cannot answer "was this person's fingerprint disposed of", which is exactly
/// the question a data-protection audit asks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EnrolmentKind {
    /// A finger enrolled for the first time.
    Enrolled,
    /// The same finger captured again, superseding what was there.
    Replaced,
    /// Deliberately removed while the person is still employed — a withdrawal
    /// of consent, or a finger that will not read.
    Withdrawn,
    /// Erased because employment ended.
    ///
    /// **Has no actor, and must not have one.** It follows from employment
    /// ending rather than from anybody deciding, and naming an actor would be
    /// inventing a decision somebody took. Migration `0233`'s trigger performs
    /// it, and `0233`'s check constraint refuses an authority on this kind.
    ErasedOnTermination,
}

impl EnrolmentKind {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Enrolled => "ENROLLED",
            Self::Replaced => "REPLACED",
            Self::Withdrawn => "WITHDRAWN",
            Self::ErasedOnTermination => "ERASED_ON_TERMINATION",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "ENROLLED" => Some(Self::Enrolled),
            "REPLACED" => Some(Self::Replaced),
            "WITHDRAWN" => Some(Self::Withdrawn),
            "ERASED_ON_TERMINATION" => Some(Self::ErasedOnTermination),
            _ => None,
        }
    }

    /// Whether this kind is decided by a person. The automatic erasure is not,
    /// which is what the schema's authority check enforces.
    pub const fn is_decided(self) -> bool {
        !matches!(self, Self::ErasedOnTermination)
    }
}

impl fmt::Display for EnrolmentKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::employment::actions;
    use chrono::TimeZone;

    fn authority(action_key: &str) -> Authorization {
        Authorization::try_new(
            "hr.officer",
            action_key,
            Utc.with_ymd_and_hms(2026, 9, 13, 9, 0, 0).unwrap(),
            "enrolling on the first day",
        )
        .expect("authorization")
    }

    fn record(action_key: &str, quality: Option<u8>) -> Result<EnrolmentRecord, AttendanceError> {
        EnrolmentRecord::try_new(
            EmployeeId::try_new("emp-1").unwrap(),
            Finger::RightIndex,
            TemplateFormat::ZkfingerV10,
            quality,
            TerminalId::try_new("term-07").unwrap(),
            authority(action_key),
            1,
        )
    }

    #[test]
    fn an_enrolment_needs_the_enrolment_key() {
        assert!(record(actions::FINGERPRINT_ENROL, Some(82)).is_ok());
        assert!(matches!(
            record(actions::ROSTER_MANAGE, Some(82)),
            Err(AttendanceError::ActionForbidsEnrolment { .. })
        ));
    }

    /// `None` and `Some(0)` are different facts, and on the only credential
    /// somebody has it is worth being able to tell them apart.
    #[test]
    fn an_unreported_quality_is_not_a_zero_one() {
        let unreported = record(actions::FINGERPRINT_ENROL, None).expect("record");
        assert_eq!(unreported.quality(), None);
        let worthless = record(actions::FINGERPRINT_ENROL, Some(0)).expect("record");
        assert_eq!(worthless.quality(), Some(0));
        assert_ne!(unreported.quality(), worthless.quality());
        assert!(record(actions::FINGERPRINT_ENROL, Some(101)).is_err());
    }

    /// A seal that did not happen must not be mistaken for a template.
    #[test]
    fn a_seal_needs_ciphertext_and_a_full_width_nonce() {
        assert!(SealedTemplate::new(
            vec![7; 64],
            vec![1; TEMPLATE_NONCE_LEN],
            "k1",
            TemplateFormat::ZkfingerV10
        )
        .is_ok());
        assert!(
            SealedTemplate::new(
                Vec::new(),
                vec![1; TEMPLATE_NONCE_LEN],
                "k1",
                TemplateFormat::ZkfingerV10
            )
            .is_err(),
            "empty ciphertext is not a sealed template"
        );
        assert!(
            SealedTemplate::new(vec![7; 64], vec![1; 8], "k1", TemplateFormat::ZkfingerV10)
                .is_err(),
            "a short nonce is a refusal, not a weaker seal"
        );
    }

    /// The protection that survives somebody adding a `dbg!` to a failing test.
    #[test]
    fn debugging_a_sealed_template_never_prints_it() {
        let sealed = SealedTemplate::new(
            vec![0xAB; 48],
            vec![1; TEMPLATE_NONCE_LEN],
            "k1",
            TemplateFormat::ZkfingerV10,
        )
        .expect("seal");
        let rendered = format!("{sealed:?}");
        assert!(rendered.contains("bytes: 48"));
        assert!(!rendered.contains("171"), "the bytes must not be printed");
        assert!(!rendered.contains("ab"), "nor in hex");
    }

    /// The automatic erasure is the one kind nobody decides.
    #[test]
    fn only_the_automatic_erasure_has_no_decider() {
        for kind in [
            EnrolmentKind::Enrolled,
            EnrolmentKind::Replaced,
            EnrolmentKind::Withdrawn,
        ] {
            assert!(kind.is_decided(), "{kind} is somebody's decision");
            assert_eq!(EnrolmentKind::parse(kind.code()), Some(kind));
        }
        assert!(!EnrolmentKind::ErasedOnTermination.is_decided());
    }
}
