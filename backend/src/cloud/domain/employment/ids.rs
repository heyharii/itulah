//! Opaque identifiers for the employment kernel.
//!
//! The newtypes decode through `try_from` rather than `#[serde(transparent)]`,
//! and the difference is not style. A transparent newtype decodes straight from
//! the inner `String` and skips validation for anything arriving from the wire
//! or from a stored row, so an invalid value survives a round trip through the
//! database and comes back as authority.

use super::error::EmployeeError;
use core::fmt;

pub const MAX_ID_LEN: usize = 64;
pub const MAX_REASON_LEN: usize = 500;

/// Trim, reject empty, reject control characters, bound the length.
///
/// Shared with the profile and contract modules, which validate the same way:
/// one rule for "is this a usable piece of text", stated once.
pub fn validated_text(field: &'static str, raw: &str, max: usize) -> Result<String, EmployeeError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(EmployeeError::Required { field });
    }
    if trimmed.chars().count() > max {
        return Err(EmployeeError::TooLong { field, max });
    }
    if trimmed.chars().any(|ch| ch.is_control()) {
        return Err(EmployeeError::NotPrintable { field });
    }
    Ok(trimmed.to_string())
}

macro_rules! opaque_id {
    ($name:ident, $field:literal, $doc:literal) => {
        #[doc = $doc]
        #[derive(
            Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
        )]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            pub fn try_new(raw: &str) -> Result<Self, EmployeeError> {
                validated_text($field, raw, MAX_ID_LEN).map($name)
            }

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

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

opaque_id!(
    EmployeeId,
    "employee id",
    "The immutable, never-recycled identity of one person's employment record."
);
opaque_id!(
    EmployeeCode,
    "employee code",
    "The human-facing employee code (NIP/badge). A *code*, never the identity: \
     it may be reissued or corrected, so nothing may key on it."
);
opaque_id!(
    PlaceId,
    "place id",
    "A row of `org_place` — a store, the DC, or head office. This module does \
     not own the place tree and never interprets the value."
);
opaque_id!(
    ActorId,
    "actor id",
    "Who acted: an `app_user.username`. \
     \
     Named `ActorId` rather than the reference's `SubjectId` because a subject \
     here is already a piece of merchandise — one tagged garment. Two meanings \
     of one word in one domain is how a person ends up joined to a shirt. \
     \
     The username rather than the uuid, because a recorded decision is read by \
     people, and a name that was true when the decision was taken stays legible \
     after the account is gone."
);

/// Why a decision was taken. The one part of an [`super::Authorization`] that
/// is genuinely the caller's to state.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ReasonText(String);

impl ReasonText {
    pub fn try_new(raw: &str) -> Result<Self, EmployeeError> {
        validated_text("reason", raw, MAX_REASON_LEN).map(ReasonText)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ReasonText {
    type Error = EmployeeError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        ReasonText::try_new(&value)
    }
}

impl From<ReasonText> for String {
    fn from(value: ReasonText) -> String {
        value.0
    }
}

impl fmt::Display for ReasonText {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
