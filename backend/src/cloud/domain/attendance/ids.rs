//! The identities the punch half needs, and the one enumeration that is not an
//! identity at all.
//!
//! Kept together in one small module rather than scattered across `punch.rs`,
//! `terminal.rs` and `correction.rs`, because they are all the same shape —
//! printable text, trimmed, bounded — and three copies of that validation is
//! three places for it to drift.
//!
//! [`ShiftId`](super::time::ShiftId) stays in `time.rs` where the roster half
//! put it. Moving it here would be a rename in somebody else's file for no
//! gain.

use super::error::AttendanceError;
use serde::{Deserialize, Serialize};
use std::fmt;

/// The longest any of these identities may be.
///
/// One ceiling for all of them. A punch id is minted at the edge as a uuid, a
/// terminal id is chosen by whoever installs the device, and a correction id is
/// minted by the server; none of them has a reason to be longer than this, and
/// separate ceilings would be three numbers to keep in step for no benefit.
pub const MAX_ATTENDANCE_ID_LEN: usize = 64;

/// Validate one of these identities: trimmed, non-empty, printable, bounded.
fn checked(field: &'static str, raw: &str) -> Result<String, AttendanceError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AttendanceError::Required { field });
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AttendanceError::NotPrintable { field });
    }
    if trimmed.chars().count() > MAX_ATTENDANCE_ID_LEN {
        return Err(AttendanceError::TooLong {
            field,
            max: MAX_ATTENDANCE_ID_LEN,
        });
    }
    Ok(trimmed.to_owned())
}

/// Declare a validated text identity, with its own field name in refusals.
macro_rules! text_id {
    ($name:ident, $field:literal, $doc:literal) => {
        #[doc = $doc]
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            pub fn try_new(raw: &str) -> Result<Self, AttendanceError> {
                checked($field, raw).map(Self)
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = AttendanceError;
            fn try_from(value: String) -> Result<Self, Self::Error> {
                Self::try_new(&value)
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> Self {
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

text_id!(
    TerminalId,
    "terminal id",
    "A registered punch station, by its id.\n\nThe id is chosen when the device is installed and never changes: it is what\nevery punch the station ever took names as its provenance, so a renamed\nterminal would orphan its own history."
);

text_id!(
    PunchId,
    "punch id",
    "One punch, by its id.\n\n**Minted at the edge**, not by the database, and that is what makes an\noffline terminal's retry safe: the node may deliver the same punch any number\nof times and only the first delivery lands, because the identity collides."
);

text_id!(
    CorrectionId,
    "correction id",
    "One correction request, by its id.\n\nMinted by the server, because a correction is not something a device observes\nand there is no offline path that has to invent one."
);

text_id!(
    LeaveRef,
    "leave reference",
    "An approved leave record, by its id, as this module sees it.\n\nAn opaque reference on purpose. Whether leave was owed, how many days it drew\nand who approved it are `domain::leave`'s questions, and it answers them; this\nmodule needs only the evidence that an approval exists, so a day nobody worked\nis not called an absence for a reason HR has already accepted.\n\nA newtype rather than `domain::leave`'s own id so the derivation does not link\nagainst the leave kernel to read a string. The two modules meet at the handler,\nwhich is the layer that already loads both."
);

text_id!(
    OvertimeRef,
    "overtime reference",
    "An agreed overtime order, by its id, as this module sees it.\n\nAgreed, not merely ordered — PP 35/2021 art. 26(2) wants the employer's\ninstruction *and* the worker's agreement, and `domain::overtime` is what\nproduces `Some` only in `AGREED`. By the time a reference reaches here the\nsecond consent has been given; this module never re-adjudicates it and never\ninvents one."
);

/// Which finger was enrolled.
///
/// A closed vocabulary rather than free text, and the reason is the one thing
/// an enrolment screen gets wrong: "index finger" and "telunjuk" and "R1" all
/// mean the same finger, and a store of free text is a store nobody can ask
/// "has this person enrolled a second finger" of. Ten values, because a person
/// has ten fingers.
///
/// More than one may be enrolled, deliberately. A plaster on a thumb must not
/// stop a shift — and it matters more here than it would elsewhere, because
/// fingerprint is the only way in and there is no PIN behind it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Finger {
    LeftThumb,
    LeftIndex,
    LeftMiddle,
    LeftRing,
    LeftLittle,
    RightThumb,
    RightIndex,
    RightMiddle,
    RightRing,
    RightLittle,
}

impl Finger {
    /// Every finger, in the order an enrolment screen offers them.
    pub const ALL: [Self; 10] = [
        Self::RightThumb,
        Self::RightIndex,
        Self::RightMiddle,
        Self::RightRing,
        Self::RightLittle,
        Self::LeftThumb,
        Self::LeftIndex,
        Self::LeftMiddle,
        Self::LeftRing,
        Self::LeftLittle,
    ];

    /// The stored code, exactly as `fingerprint_template.finger`'s check
    /// constraint spells it.
    pub const fn code(self) -> &'static str {
        match self {
            Self::LeftThumb => "LEFT_THUMB",
            Self::LeftIndex => "LEFT_INDEX",
            Self::LeftMiddle => "LEFT_MIDDLE",
            Self::LeftRing => "LEFT_RING",
            Self::LeftLittle => "LEFT_LITTLE",
            Self::RightThumb => "RIGHT_THUMB",
            Self::RightIndex => "RIGHT_INDEX",
            Self::RightMiddle => "RIGHT_MIDDLE",
            Self::RightRing => "RIGHT_RING",
            Self::RightLittle => "RIGHT_LITTLE",
        }
    }

    /// An error rather than an `Option`: a stored code this build cannot read
    /// is a row that must fail to load, not a finger quietly treated as some
    /// other one.
    pub fn parse(code: &str) -> Result<Self, AttendanceError> {
        Self::ALL
            .into_iter()
            .find(|finger| finger.code() == code)
            .ok_or_else(|| AttendanceError::UnknownFinger {
                code: code.to_owned(),
            })
    }
}

impl fmt::Display for Finger {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// What the vendor template in a stored row actually is.
///
/// One value today — the SDK the deployed ZKTeco readers ship with — and it is
/// recorded rather than assumed for the reason the donor's own schema comment
/// gives: a template from one SDK generation does not always match under
/// another, and a company that upgrades its scanners needs to know which
/// enrolments to redo rather than discovering it one person at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TemplateFormat {
    /// ZKFinger SDK v10 feature vector.
    ZkfingerV10,
}

impl TemplateFormat {
    pub const fn code(self) -> &'static str {
        match self {
            Self::ZkfingerV10 => "ZKFINGER_V10",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "ZKFINGER_V10" => Some(Self::ZkfingerV10),
            _ => None,
        }
    }
}

impl fmt::Display for TemplateFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_identity_is_trimmed_and_bounded() {
        assert_eq!(TerminalId::try_new("  t-01  ").unwrap().as_str(), "t-01");
        assert!(PunchId::try_new("   ").is_err());
        assert!(CorrectionId::try_new(&"x".repeat(MAX_ATTENDANCE_ID_LEN + 1)).is_err());
        assert!(TerminalId::try_new("t\u{0}01").is_err());
    }

    /// The whole point of the closed vocabulary: the codes round-trip, so a
    /// stored row and a wire payload cannot disagree about which finger it is.
    #[test]
    fn every_finger_round_trips_through_its_code() {
        for finger in Finger::ALL {
            assert_eq!(Finger::parse(finger.code()).unwrap(), finger);
        }
        assert_eq!(Finger::ALL.len(), 10, "a person has ten fingers");
    }

    /// A code this build has not been taught is a refusal, never a silent
    /// substitution: the wrong finger recorded against a template is an
    /// enrolment nobody can audit.
    #[test]
    fn an_unreadable_finger_is_refused_rather_than_guessed() {
        assert!(matches!(
            Finger::parse("telunjuk kanan"),
            Err(AttendanceError::UnknownFinger { .. })
        ));
    }
}
