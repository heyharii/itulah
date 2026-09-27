//! What the hire-proposal kernel refuses.
//!
//! The tests worth reading twice are the last three. Two of them edit a stored
//! proposal the way somebody would in `psql` — a state that its history does
//! not produce, and an approval signed by the person who asked — and assert
//! that it then refuses to load rather than becoming the answer. A fold nobody
//! re-runs is just a column.

use super::*;
use crate::cloud::domain::employment::{
    actions, ActorId, Authorization, ContractKind, EmployeeId, Position, UnitId,
};
use chrono::{DateTime, NaiveDate, Utc};
use pricing_engine::Money;

fn at(offset: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_789_000_000 + offset, 0).unwrap_or_else(|| panic!("instant"))
}

fn authority(actor: &str, action_key: &str, offset: i64) -> Authorization {
    Authorization::try_new(actor, action_key, at(offset), "alasan yang dicatat")
        .unwrap_or_else(|error| panic!("authorization: {error}"))
}

fn proposing(actor: &str, offset: i64) -> Authorization {
    authority(actor, actions::HIRE_PROPOSAL_PROPOSE, offset)
}

fn deciding(actor: &str, offset: i64) -> Authorization {
    authority(actor, actions::HIRE_PROPOSAL_DECIDE, offset)
}

fn employing(actor: &str, offset: i64) -> Authorization {
    authority(actor, actions::EMPLOYEE_CREATE, offset)
}

fn day(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, day).unwrap_or_else(|| panic!("date"))
}

fn terms(headcount: u32) -> ProposedTerms {
    ProposedTerms::try_new(
        Position::try_new("Kasir").unwrap_or_else(|error| panic!("position: {error}")),
        headcount,
        HiringNeed::Replacement,
        CandidateName::try_new("Siti Rahayu").unwrap_or_else(|error| panic!("name: {error}")),
        day(1),
        ContractKind::Pkwt {
            ends_on: day(1) + chrono::Duration::days(365),
        },
        Money::new(3_500_000_00),
    )
    .unwrap_or_else(|error| panic!("terms: {error}"))
}

fn unit() -> UnitId {
    UnitId::try_new("store-07").unwrap_or_else(|error| panic!("unit: {error}"))
}

fn identifier() -> HireProposalId {
    HireProposalId::try_new("hp_one").unwrap_or_else(|error| panic!("id: {error}"))
}

fn filed(headcount: u32) -> HireProposal {
    HireProposal::propose(
        identifier(),
        unit(),
        terms(headcount),
        proposing("store07.manager", 0),
    )
    .unwrap_or_else(|error| panic!("propose: {error}"))
}

fn actor(name: &str) -> ActorId {
    ActorId::try_new(name).unwrap_or_else(|error| panic!("actor: {error}"))
}

// ── the terms ────────────────────────────────────────────────────────────

/// A request to hire nought people has no outcome head office could approve.
#[test]
fn a_proposal_must_ask_for_at_least_one_person() {
    let refused = ProposedTerms::try_new(
        Position::try_new("Kasir").unwrap_or_else(|error| panic!("position: {error}")),
        0,
        HiringNeed::Addition,
        CandidateName::try_new("Siti").unwrap_or_else(|error| panic!("name: {error}")),
        day(1),
        ContractKind::Pkwtt,
        Money::new(3_500_000_00),
    );
    assert_eq!(refused, Err(HireError::HeadcountNotPositive));
}

/// Zero as well as negative. A proposal offering nothing is not something
/// anybody can agree to, and approving one would put a zero into the pay
/// agreement somebody signs from it.
#[test]
fn a_proposal_that_offers_nothing_is_not_a_proposal() {
    for minor in [0, -1] {
        let refused = ProposedTerms::try_new(
            Position::try_new("Kasir").unwrap_or_else(|error| panic!("position: {error}")),
            1,
            HiringNeed::Addition,
            CandidateName::try_new("Siti").unwrap_or_else(|error| panic!("name: {error}")),
            day(1),
            ContractKind::Pkwtt,
            Money::new(minor),
        );
        assert_eq!(refused, Err(HireError::BasePayNotPositive), "{minor}");
    }
}

/// UU 13/2003 art. 59 on the proposal as well as on the contract. A term that
/// ends before it starts would survive approval and be found only when HR tried
/// to sign it.
#[test]
fn a_proposed_fixed_term_cannot_end_before_it_starts() {
    let refused = ProposedTerms::try_new(
        Position::try_new("Kasir").unwrap_or_else(|error| panic!("position: {error}")),
        1,
        HiringNeed::Addition,
        CandidateName::try_new("Siti").unwrap_or_else(|error| panic!("name: {error}")),
        day(10),
        ContractKind::Pkwt { ends_on: day(1) },
        Money::new(3_500_000_00),
    );
    assert_eq!(
        refused,
        Err(HireError::TermEndsBeforeItStarts {
            starts_on: day(10),
            ends_on: day(1),
        })
    );
    // And a permanent contract has nowhere to put an end date at all, which is
    // the mistake the employment kernel's type already makes unrepresentable.
    assert_eq!(ContractKind::Pkwtt.ends_on(), None);
}

/// A candidate is named, and nothing else about them is recorded. There is no
/// field for a NIK here to fail on — the proof is that the type has seven
/// members and none of them is one.
#[test]
fn the_only_personal_datum_a_proposal_holds_is_a_name() {
    let terms = terms(1);
    assert_eq!(terms.candidate().as_str(), "Siti Rahayu");
    assert!(CandidateName::try_new("   ").is_err(), "a blank name");
    assert!(
        CandidateName::try_new(&"x".repeat(MAX_CANDIDATE_NAME_LEN + 1)).is_err(),
        "a name longer than the employment record could hold"
    );
}

// ── the machine ──────────────────────────────────────────────────────────

#[test]
fn a_filed_proposal_waits_on_head_office() {
    let proposal = filed(1);
    assert_eq!(proposal.state(), HireProposalState::Proposed);
    assert!(proposal.state().awaits_a_decision());
    assert!(!proposal.state().admits_employment());
    assert_eq!(proposal.current_version(), 1);
    assert_eq!(proposal.versions().count(), 1);
    assert_eq!(proposal.outstanding(), 1);
}

/// The owner's rule, 2026-09-13. Head office is a place and not a pass, so the
/// person who asked may not be the person who granted — even holding the rung.
#[test]
fn the_proposer_may_not_decide_their_own_proposal() {
    let mut proposal = filed(1);
    let refused = proposal.decide(HireDecision::Approve, deciding("store07.manager", 10));
    assert_eq!(
        refused,
        Err(HireError::ProposerDecidedTheirOwnProposal {
            actor: "store07.manager".to_owned(),
        })
    );
    assert!(refused.unwrap_err().is_forbidden(), "not a bad request");
    // Nothing moved.
    assert_eq!(proposal.state(), HireProposalState::Proposed);
}

/// The loophole a per-version rule would have left: file version 1, have a
/// colleague revise it, then decide version 2 yourself.
#[test]
fn a_colleagues_revision_does_not_let_the_first_proposer_decide() {
    let mut proposal = filed(1);
    proposal
        .decide(HireDecision::Return, deciding("hr.dewi", 10))
        .unwrap_or_else(|error| panic!("return: {error}"));
    proposal
        .revise(terms(1), proposing("store07.deputy", 20))
        .unwrap_or_else(|error| panic!("revise: {error}"));

    // The version in force is the deputy's, and the screen says so.
    assert_eq!(proposal.proposer(), &actor("store07.deputy"));
    // But the manager who filed version 1 still may not decide version 2.
    assert_eq!(
        proposal.decide(HireDecision::Approve, deciding("store07.manager", 30)),
        Err(HireError::ProposerDecidedTheirOwnProposal {
            actor: "store07.manager".to_owned(),
        })
    );
    assert!(proposal.proposed_by(&actor("store07.manager")));
    assert!(proposal.proposed_by(&actor("store07.deputy")));
    assert!(!proposal.proposed_by(&actor("hr.dewi")));
}

/// A revision is a new version, and the returned one stays readable. That is
/// the whole point: a proposal returned because the pay was too high, revised,
/// and then approved is a three-step record of a negotiation.
#[test]
fn a_revision_adds_a_version_and_keeps_the_one_before_it() {
    let mut proposal = filed(1);
    proposal
        .decide(HireDecision::Return, deciding("hr.dewi", 10))
        .unwrap_or_else(|error| panic!("return: {error}"));
    assert_eq!(proposal.state(), HireProposalState::Returned);

    let cheaper = ProposedTerms::try_new(
        Position::try_new("Kasir").unwrap_or_else(|error| panic!("position: {error}")),
        1,
        HiringNeed::Replacement,
        CandidateName::try_new("Siti Rahayu").unwrap_or_else(|error| panic!("name: {error}")),
        day(1),
        ContractKind::Pkwt {
            ends_on: day(1) + chrono::Duration::days(365),
        },
        Money::new(3_200_000_00),
    )
    .unwrap_or_else(|error| panic!("terms: {error}"));
    proposal
        .revise(cheaper, proposing("store07.manager", 20))
        .unwrap_or_else(|error| panic!("revise: {error}"));

    assert_eq!(proposal.state(), HireProposalState::Proposed);
    assert_eq!(proposal.current_version(), 2);
    assert_eq!(proposal.current().base_pay(), Money::new(3_200_000_00));
    let asked: Vec<i64> = proposal
        .versions()
        .map(|version| version.base_pay().minor)
        .collect();
    assert_eq!(
        asked,
        vec![3_500_000_00, 3_200_000_00],
        "the first version is still readable"
    );
    // And the decision that sent version 1 back is still joined to version 1.
    let returned = proposal
        .history()
        .iter()
        .find(|event| event.step() == HireProposalStep::Returned)
        .unwrap_or_else(|| panic!("the return is recorded"));
    assert_eq!(returned.version(), 1);
}

/// Only a returned proposal may be revised. Revising one still awaiting an
/// answer would change the terms under the person reading them.
#[test]
fn a_proposal_awaiting_an_answer_cannot_be_revised() {
    let mut proposal = filed(1);
    let refused = proposal.revise(terms(1), proposing("store07.manager", 20));
    assert_eq!(
        refused,
        Err(HireError::NotInState {
            state: "PROPOSED",
            step: "revised",
        })
    );
    assert!(refused.unwrap_err().is_conflict());
}

/// Terminal means terminal. A refusal a sufficiently senior person can reverse
/// is not a refusal; asking again is a new proposal with its own reasons.
#[test]
fn a_rejection_has_no_way_out_of_it() {
    let mut proposal = filed(1);
    proposal
        .decide(HireDecision::Reject, deciding("hr.dewi", 10))
        .unwrap_or_else(|error| panic!("reject: {error}"));
    assert_eq!(proposal.state(), HireProposalState::Rejected);
    assert!(proposal.state().is_terminal());

    assert!(proposal
        .revise(terms(1), proposing("store07.manager", 20))
        .is_err());
    assert!(proposal
        .decide(HireDecision::Approve, deciding("hr.budi", 30))
        .is_err());
    assert!(proposal
        .open_employment(
            EmployeeId::try_new("emp_1").unwrap_or_else(|error| panic!("id: {error}")),
            employing("hr.dewi", 40)
        )
        .is_err());
}

/// "Approved" is not "working here". What approval buys is permission to open
/// an employment record — and the record it opens is a candidate.
#[test]
fn approval_permits_an_employment_record_and_does_not_open_one() {
    let mut proposal = filed(1);
    proposal
        .decide(HireDecision::Approve, deciding("hr.dewi", 10))
        .unwrap_or_else(|error| panic!("approve: {error}"));
    assert_eq!(proposal.state(), HireProposalState::Approved);
    assert!(proposal.state().admits_employment());
    assert_eq!(proposal.opened().count(), 0, "nobody is employed yet");
    assert_eq!(proposal.outstanding(), 1);
}

/// A proposal for two is filled by the second record, not the first.
#[test]
fn a_proposal_for_two_stays_open_until_both_records_exist() {
    let mut proposal = filed(2);
    proposal
        .decide(HireDecision::Approve, deciding("hr.dewi", 10))
        .unwrap_or_else(|error| panic!("approve: {error}"));

    proposal
        .open_employment(
            EmployeeId::try_new("emp_1").unwrap_or_else(|error| panic!("id: {error}")),
            employing("hr.dewi", 20),
        )
        .unwrap_or_else(|error| panic!("open: {error}"));
    assert_eq!(proposal.state(), HireProposalState::Approved);
    assert_eq!(proposal.outstanding(), 1);

    proposal
        .open_employment(
            EmployeeId::try_new("emp_2").unwrap_or_else(|error| panic!("id: {error}")),
            employing("hr.dewi", 30),
        )
        .unwrap_or_else(|error| panic!("open: {error}"));
    assert_eq!(proposal.state(), HireProposalState::Filled);
    assert_eq!(proposal.outstanding(), 0);
    let opened: Vec<String> = proposal.opened().map(ToString::to_string).collect();
    assert_eq!(opened, vec!["emp_1".to_owned(), "emp_2".to_owned()]);

    // And a third is refused: an approval for two cannot be stretched.
    assert_eq!(
        proposal.open_employment(
            EmployeeId::try_new("emp_3").unwrap_or_else(|error| panic!("id: {error}")),
            employing("hr.dewi", 40)
        ),
        Err(HireError::NotInState {
            state: "FILLED",
            step: "opened against",
        })
    );
}

/// The three key sets are disjoint, and every act checks its own. A decision
/// recorded under the proposing key would be the shop approving its own
/// request.
#[test]
fn each_act_refuses_the_other_acts_key() {
    let mut proposal = filed(1);
    assert_eq!(
        proposal.decide(HireDecision::Approve, proposing("hr.dewi", 10)),
        Err(HireError::ActionForbidsDecision {
            action_key: actions::HIRE_PROPOSAL_PROPOSE.to_owned(),
        })
    );
    proposal
        .decide(HireDecision::Return, deciding("hr.dewi", 20))
        .unwrap_or_else(|error| panic!("return: {error}"));
    assert_eq!(
        proposal.revise(terms(1), deciding("store07.manager", 30)),
        Err(HireError::ActionForbidsProposal {
            action_key: actions::HIRE_PROPOSAL_DECIDE.to_owned(),
        })
    );

    let mut approved = filed(1);
    approved
        .decide(HireDecision::Approve, deciding("hr.dewi", 40))
        .unwrap_or_else(|error| panic!("approve: {error}"));
    assert_eq!(
        approved.open_employment(
            EmployeeId::try_new("emp_1").unwrap_or_else(|error| panic!("id: {error}")),
            deciding("hr.dewi", 50)
        ),
        Err(HireError::ActionForbidsEmployment {
            action_key: actions::HIRE_PROPOSAL_DECIDE.to_owned(),
        })
    );
}

/// Every decision carries a reason, because `Authorization` cannot be built
/// without one. The route asks for it; this is why a route that forgot could
/// not store the answer anyway.
#[test]
fn a_decision_with_a_blank_reason_cannot_be_built_at_all() {
    assert!(
        Authorization::try_new("hr.dewi", actions::HIRE_PROPOSAL_DECIDE, at(0), "   ").is_err()
    );
}

// ── what a stored row cannot claim ───────────────────────────────────────

/// The round trip, and the shape the storage layer rebuilds.
#[test]
fn a_stored_proposal_rebuilds_into_what_was_filed() {
    let mut proposal = filed(1);
    proposal
        .decide(HireDecision::Approve, deciding("hr.dewi", 10))
        .unwrap_or_else(|error| panic!("approve: {error}"));

    let rebuilt = HireProposal::try_new(HireProposalWire {
        id: proposal.id().clone(),
        unit: proposal.unit().clone(),
        state: proposal.state(),
        versions: proposal.versions().cloned().collect(),
        history: proposal.history().to_vec(),
    })
    .unwrap_or_else(|error| panic!("rebuild: {error}"));
    assert_eq!(rebuilt, proposal);
}

/// The guarantee this module exists for, and the one `Employee` gives for
/// status: a row edited by hand into a state its history does not produce fails
/// to hydrate rather than quietly becoming the answer.
#[test]
fn a_state_the_history_does_not_produce_fails_to_load() {
    let proposal = filed(1);
    let refused = HireProposal::try_new(HireProposalWire {
        id: proposal.id().clone(),
        unit: proposal.unit().clone(),
        // Nobody approved it. There is no APPROVED step in the history.
        state: HireProposalState::Approved,
        versions: proposal.versions().cloned().collect(),
        history: proposal.history().to_vec(),
    });
    assert_eq!(
        refused,
        Err(HireError::StateDoesNotFollowHistory {
            claimed: "APPROVED",
            folded: "PROPOSED",
        })
    );
}

/// The owner's rule survives a round trip through the database. A rule only the
/// live path enforces is a rule a round trip removes.
#[test]
fn an_approval_signed_by_the_proposer_fails_to_load() {
    let proposal = filed(1);
    let mut history = proposal.history().to_vec();
    history.push(
        HireProposalEvent::try_new(
            HireProposalStep::Approved,
            1,
            None,
            // The same actor who filed it, which the live path refuses and
            // which a hand-written INSERT could otherwise smuggle in.
            deciding("store07.manager", 10),
        )
        .unwrap_or_else(|error| panic!("event: {error}")),
    );
    let refused = HireProposal::try_new(HireProposalWire {
        id: proposal.id().clone(),
        unit: proposal.unit().clone(),
        state: HireProposalState::Approved,
        versions: proposal.versions().cloned().collect(),
        history,
    });
    assert_eq!(
        refused,
        Err(HireError::ProposerDecidedTheirOwnProposal {
            actor: "store07.manager".to_owned(),
        })
    );
}

/// A version row nobody minted, or an event minting a version no row holds.
/// Either is a hand edit and there is no way to tell which, so neither becomes
/// the answer.
#[test]
fn the_versions_and_the_history_have_to_agree_about_how_many_there_are() {
    let proposal = filed(1);
    let refused = HireProposal::try_new(HireProposalWire {
        id: proposal.id().clone(),
        unit: proposal.unit().clone(),
        state: HireProposalState::Proposed,
        versions: vec![terms(1), terms(2)],
        history: proposal.history().to_vec(),
    });
    assert_eq!(
        refused,
        Err(HireError::VersionCountDisagreesWithHistory {
            minted: 1,
            stored: 2,
        })
    );

    // And the other direction: no history at all produces no state.
    assert_eq!(
        HireProposal::try_new(HireProposalWire {
            id: proposal.id().clone(),
            unit: proposal.unit().clone(),
            state: HireProposalState::Proposed,
            versions: vec![terms(1)],
            history: Vec::new(),
        }),
        Err(HireError::NothingWasProposed)
    );
}

/// An `OPENED` step names the employment record it produced; no other step
/// names one. A rejection that somehow hired somebody is not storable.
#[test]
fn only_the_step_that_opened_a_record_may_name_one() {
    assert_eq!(
        HireProposalEvent::try_new(
            HireProposalStep::Rejected,
            1,
            Some(EmployeeId::try_new("emp_1").unwrap_or_else(|error| panic!("id: {error}"))),
            deciding("hr.dewi", 0),
        ),
        Err(HireError::EmploymentNamedWrongly {
            step: "REJECTED",
            expectation: "not",
        })
    );
    assert_eq!(
        HireProposalEvent::try_new(HireProposalStep::Opened, 1, None, employing("hr.dewi", 0)),
        Err(HireError::EmploymentNamedWrongly {
            step: "OPENED",
            expectation: "",
        })
    );
}

/// A decision recorded against a version that is not the one in force would put
/// the answer on the wrong terms, and a screen would show the wrong pay refused.
#[test]
fn a_decision_must_name_the_version_in_force() {
    let mut proposal = filed(1);
    proposal
        .decide(HireDecision::Return, deciding("hr.dewi", 10))
        .unwrap_or_else(|error| panic!("return: {error}"));
    proposal
        .revise(terms(1), proposing("store07.manager", 20))
        .unwrap_or_else(|error| panic!("revise: {error}"));

    let mut history = proposal.history().to_vec();
    history.push(
        HireProposalEvent::try_new(
            HireProposalStep::Approved,
            // Version 1 was returned; version 2 is the one in force.
            1,
            None,
            deciding("hr.budi", 30),
        )
        .unwrap_or_else(|error| panic!("event: {error}")),
    );
    let refused = HireProposal::try_new(HireProposalWire {
        id: proposal.id().clone(),
        unit: proposal.unit().clone(),
        state: HireProposalState::Approved,
        versions: proposal.versions().cloned().collect(),
        history,
    });
    assert_eq!(
        refused,
        Err(HireError::DecisionNamesAnotherVersion {
            expected: 2,
            found: 1,
        })
    );
}

/// More employment records than the proposal asked for, smuggled in past the
/// live path. Approving one person and opening two is the one arithmetic error
/// an approval could be stretched by.
#[test]
fn more_records_than_were_asked_for_fails_to_load() {
    let mut proposal = filed(1);
    proposal
        .decide(HireDecision::Approve, deciding("hr.dewi", 10))
        .unwrap_or_else(|error| panic!("approve: {error}"));
    let mut history = proposal.history().to_vec();
    for (index, offset) in [(1, 20), (2, 30)] {
        history.push(
            HireProposalEvent::try_new(
                HireProposalStep::Opened,
                1,
                Some(
                    EmployeeId::try_new(&format!("emp_{index}"))
                        .unwrap_or_else(|error| panic!("id: {error}")),
                ),
                employing("hr.dewi", offset),
            )
            .unwrap_or_else(|error| panic!("event: {error}")),
        );
    }
    let refused = HireProposal::try_new(HireProposalWire {
        id: proposal.id().clone(),
        unit: proposal.unit().clone(),
        state: HireProposalState::Filled,
        versions: proposal.versions().cloned().collect(),
        history,
    });
    assert!(
        matches!(refused, Err(HireError::NotInState { .. })),
        "the second OPENED step has nothing to follow: {refused:?}"
    );
}
