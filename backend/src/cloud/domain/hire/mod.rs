//! *Karyawan baru*: a shop asks for an employee it does not have, and head
//! office decides.
//!
//! # Two ways in, one employee record out
//!
//! Head office could always create a candidate directly, and still can:
//! `POST /api/v1/employees` is untouched by this module. What was missing is
//! the other direction — a shop that needs a cashier had no way to ask for one
//! except a WhatsApp message, so the request, the reason, the decision and the
//! person who took it existed nowhere. This module is that one form, and it
//! ends where the employment kernel begins.
//!
//! # What this is not
//!
//! **Not a recruitment pipeline.** The owner rejected a hiring menu on
//! 2026-09-04 (*"kita ga perlu hiring menu"*) and approved this narrow
//! proposal form on 2026-09-13. There are no applicants, no interview stages,
//! no CV store, no shortlist and no offer letters. Recruitment stops at
//! `CANDIDATE` — somebody head office accepted and who has not yet started —
//! exactly as `frontend-hub/PEOPLE-BRIEF.md` says it does.
//!
//! **Not a place personal data lives.** A proposal names the candidate and
//! nothing else about them: no NIK, no address, no date of birth, no phone, no
//! email, and no column for any of them. This is a person who may never be
//! employed here, and under UU PDP their identity documents have no business
//! sitting on a form that may be refused. Personal data starts existing when
//! somebody is actually hired, on the `/employees/{id}/personal-data` surface
//! that already owns it and already gates it behind its own key.
//!
//! **Not a second authority directory.** The three action keys live in
//! `domain::employment::audit` with every other HR key, and
//! `employment::required_role_for_action` stays the single mapping from a key
//! to a rung — proposing at the supervisor rung, bounded to the caller's own
//! posting by `employment::Reach`; deciding at head office's.
//!
//! # The one rule a rung cannot express
//!
//! **The proposer must not decide their own proposal**, including when the
//! proposer is head office's own HR. A rung cannot say that: every store
//! manager holds the same one, and the deciding key is held by the very people
//! who might also file a request. So the rule is on the *actor* —
//! [`HireProposal::proposed_by`] — which is why the proposing and deciding keys
//! are disjoint, exactly as `pay`'s verify and approve keys are disjoint so
//! that its two-person rule has two names to compare.
//!
//! # What approval buys
//!
//! Permission to open an employment record, and nothing more. "Approved" is not
//! "working here": the record opened against an approved proposal is a
//! `CANDIDATE`, and the `HIRE` event that makes somebody an active employee is
//! still `POST /employees/{id}/employment`, recorded on the day they actually
//! start by whoever sees them start. Nothing here invents that fact.

mod error;
mod proposal;

pub use error::HireError;
pub use proposal::{
    CandidateName, HireDecision, HireProposal, HireProposalEvent, HireProposalEventWire,
    HireProposalId, HireProposalState, HireProposalStep, HireProposalWire, HiringNeed,
    ProposedTerms, ProposedTermsWire, MAX_CANDIDATE_NAME_LEN, MAX_PROPOSAL_ID_LEN,
};

#[cfg(test)]
mod tests;
