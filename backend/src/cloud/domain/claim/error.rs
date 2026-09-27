//! What the claims kernel refuses, and the names it refuses them by.

use chrono::NaiveDate;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum ClaimError {
    #[error("{field} is not a usable identifier")]
    InvalidId { field: &'static str },
    #[error("{field} must be positive")]
    NotPositive { field: &'static str },
    #[error("a claim line needs a description; a number with nothing behind it is a number nobody can answer for")]
    DescriptionRequired,
    #[error("{code} is not a claim type anybody has defined")]
    UnknownClaimType { code: String },
    #[error("{code} is already a claim type")]
    DuplicateClaimType { code: String },
    #[error("{code} was retired on {retired_at} and takes no new claims")]
    ClaimTypeRetired { code: String, retired_at: NaiveDate },
    #[error("a claim needs at least one line; an empty claim asks for nothing")]
    NoLines,
    #[error("action `{action_key}` does not authorize filing an expense claim")]
    ActionForbidsFiling { action_key: String },
    #[error("action `{action_key}` does not authorize a claim decision")]
    ActionForbidsDecision { action_key: String },
    #[error("action `{action_key}` does not authorize paying a claim")]
    ActionForbidsPayout { action_key: String },
    #[error("the claim is {state} and only a draft claim can be submitted")]
    ClaimNotDraft { state: &'static str },
    #[error("the claim is {state} and only a submitted claim can be decided")]
    ClaimNotSubmitted { state: &'static str },
    #[error("the claim is {state} and only a submitted claim can be withdrawn")]
    ClaimNotWithdrawable { state: &'static str },
    #[error("the claim is {state} and only an approved claim can be paid")]
    ClaimNotPayable { state: &'static str },
    #[error("only the person who filed a claim may submit it")]
    SubmissionNotByFiler,
    #[error("only the person who filed a claim may withdraw it")]
    WithdrawalNotByFiler,
    #[error("{actor} filed this claim and may not decide their own")]
    SameActorFiledAndDecided { actor: String },
    #[error("the decision sanctions every line, and line {line_number} was left out")]
    SanctionMissingLine { line_number: i32 },
    #[error("the decision sanctions nothing; return or reject the claim instead, by name")]
    SanctionNothing,
    #[error("the header total {stored_minor} disagrees with the lines' sanctioned {lines_minor}; a claim decided twice by an edit is a claim decided by nobody")]
    SanctionTotalDisagrees { stored_minor: i64, lines_minor: i64 },
    #[error("line {line_number} was sanctioned {sanctioned_minor} against {claimed_minor} claimed; a sanction above the claim is an approval of something nobody asked for")]
    SanctionAboveClaim {
        line_number: i32,
        sanctioned_minor: i64,
        claimed_minor: i64,
    },
    #[error("an approved claim must carry the entry that sanctioned it")]
    ApprovalWithoutPosting,
    #[error("a paid claim must carry the payout entry that settled it")]
    PayoutWithoutPosting,
}
