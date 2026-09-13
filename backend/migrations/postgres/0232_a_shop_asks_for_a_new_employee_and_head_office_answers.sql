-- A shop asks for a new employee, and head office answers.
--
-- *Karyawan baru.* Owner's decision, 2026-09-13. Head office could always
-- create a candidate directly — `POST /api/v1/employees`, untouched by this
-- migration — and what was missing is the other direction: a shop short a
-- cashier had no way to ask for one except a message on somebody's phone, so
-- the request, its reason, the decision and the person who took it existed
-- nowhere.
--
-- # This is not a recruitment pipeline, and the schema is the proof
--
-- The owner rejected a hiring menu on 2026-09-04 (*"kita ga perlu hiring
-- menu"*) and approved this one narrow form. So there is no applicant table,
-- no interview stage, no CV store, no shortlist, no offer letter. Two tables:
-- what was asked for, and what was decided. Recruitment stops at `CANDIDATE`,
-- exactly where `frontend-hub/PEOPLE-BRIEF.md` says it stops.
--
-- The `0100` number was taken by a proposed-hires feature the owner then
-- decided against, and is deliberately not reused (see
-- `docs/hr-port-provenance.md`). This is not that feature returning: that one
-- was a pipeline, and this is a form with three answers.
--
-- # There is no column for a NIK, and that is the decision
--
-- A proposal names the candidate and records nothing else about them. No NIK,
-- no address, no date of birth, no phone, no email — and no column for any of
-- them, so no later handler can quietly start writing one. This is a person who
-- may never be employed here; under UU 27/2022 (PDP) their identity documents
-- have no business sitting on a form that may be refused, and a table that
-- *could* hold them is a table that eventually does. Personal data starts
-- existing when somebody is actually hired, in `employee_profile`, behind
-- `people.profile.read`.
--
-- # State is a fold, as it is for employment
--
-- `state` is denormalised from `history`, deliberately and with the same guard
-- 0060 put on `employee.status`: the loader replays every recorded step and
-- refuses a row whose claimed state that history does not produce. The column
-- exists so "what is waiting on head office" is an index scan rather than a
-- fold over every proposal ever filed, and it is safe only because nothing may
-- write it except that fold.
--
-- The one rule worth naming here is the owner's: **the proposer may not decide
-- their own proposal.** It cannot be a constraint, because it compares two
-- actors recorded inside `history`, and it cannot be a rung either — every
-- store manager holds the same one, and head office's own HR holds the deciding
-- key and may also file a request. So it is enforced on the actor, in
-- `domain::hire`, on the transition *and* on the way in from storage: a row
-- edited in `psql` into an approval the proposer signed fails to hydrate rather
-- than becoming a hire nobody authorised.

-- One request for one candidate at one unit.
CREATE TABLE hire_proposal (
    id         text PRIMARY KEY CHECK (btrim(id) <> ''),
    -- The proposer's own unit, and a real foreign key. Which shop a proposal
    -- belongs to is what bounds the manager who may read or revise it, through
    -- the same `Reach` that bounds the Directory — and after 0230 the units are
    -- head office plus Store 01 to Store 13, the warehouse being a department
    -- inside the first.
    --
    -- On the proposal rather than on the version: a revision may change the pay
    -- or the start date, and a proposal that changed which shop it was for
    -- would be a different proposal.
    place_id   text NOT NULL REFERENCES org_place(id),
    -- PROPOSED, RETURNED, APPROVED, REJECTED or FILLED.
    --
    -- APPROVED is not an employee. It is permission to open an employment
    -- record — the owner's words: "Approved" is not "working here". FILLED is
    -- reached when as many records have been opened against it as it asked for.
    state      text NOT NULL CHECK (state IN (
                   'PROPOSED', 'RETURNED', 'APPROVED', 'REJECTED', 'FILLED'
               )),
    -- Append-only steps, oldest first, and the authority for `state`.
    --
    -- Each names its step, the version it is about, the authority behind it
    -- (actor, action key, instant, reason — stored whole, because the four
    -- parts are only meaningful together), and, for an OPENED step alone, the
    -- employment record it produced.
    --
    -- The version travels on every step so that a returned version and the
    -- reason it was returned stay joined after a revision has moved on.
    -- Without it, "why was this sent back" would be answerable only about the
    -- latest terms — which is exactly the question a revision exists to
    -- answer.
    history    jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_hire_proposal_place
    ON hire_proposal (place_id, created_at DESC, id);
-- The queue head office works, and the one a shop watches. A proposal nobody
-- answers is a shop running a till short while it waits.
CREATE INDEX ix_hire_proposal_awaiting
    ON hire_proposal (created_at, id) WHERE state = 'PROPOSED';

-- What was asked for, once per version.
--
-- A revision appends a row here and leaves every earlier one in place, because
-- what was asked for and refused is the point of asking again: a proposal
-- returned because the base pay was too high, revised, and approved is a
-- three-step record of a negotiation, and an in-place UPDATE would leave only
-- its last line. Nothing updates this table — the domain has no method that
-- could, and the primary key is what a re-filed version would collide with.
--
-- The version number is a column here and a *position* in the loaded domain
-- type, so the two cannot disagree: the loader orders by this column and
-- refuses a set that is not 1..n.
--
-- No `authorized` column, unlike `employee_assignment` and
-- `employee_contract`. Those tables have no event history beside them; this one
-- does, and who filed version 2 and why is the PROPOSED or REVISED step that
-- minted it. Two copies of one decision is how a screen comes to show a reason
-- that disagrees with the log.
CREATE TABLE hire_proposal_version (
    proposal_id      text NOT NULL REFERENCES hire_proposal(id) ON DELETE CASCADE,
    version          integer NOT NULL CHECK (version > 0),
    -- Free text, and the same vocabulary `employee_contract.position` uses:
    -- an organisation's own job titles are not this schema's to enumerate, and
    -- a proposal whose position could not be written onto the contract it
    -- leads to would be a proposal nobody could act on.
    position         text NOT NULL CHECK (btrim(position) <> ''),
    -- How many people. One is the normal case; a proposal for two is filled by
    -- the second employment record and not the first.
    --
    -- No ceiling, deliberately. How many people one request may reasonably ask
    -- for is head office's to judge when they read it, and a limit invented
    -- here would be a number nobody ratified — the argument `overtime_policy`
    -- makes about caps, applied to a field instead of a table.
    headcount        integer NOT NULL CHECK (headcount > 0),
    -- REPLACEMENT or ADDITION. The first thing head office asks, and the two
    -- answers mean different things to them: a replacement keeps a place's
    -- headcount and its wage bill where the budget already put them, and an
    -- addition changes both.
    --
    -- It deliberately does not name who is being replaced. That would be a
    -- second place somebody's departure is recorded, and `employee.history`
    -- already holds it with its date and its authority.
    need             text NOT NULL CHECK (need IN ('REPLACEMENT', 'ADDITION')),
    -- The one personal datum on this table. See the header.
    candidate_name   text NOT NULL CHECK (btrim(candidate_name) <> ''),
    start_on         date NOT NULL,
    -- The *proposed* kind. PKWT is fixed-term, PKWTT is permanent, and the
    -- constraint below is 0060's, restated: a proposal approved in a shape no
    -- contract could take is a proposal HR discovers is unsignable after
    -- somebody has already said yes.
    contract_kind    text NOT NULL CHECK (contract_kind IN ('PKWT', 'PKWTT')),
    contract_ends_on date,
    -- Base pay only — *gaji pokok*, in the smallest unit, integer for the
    -- reason every money column here is: a float cannot round-trip and cannot
    -- be compared. Allowances are absent on purpose: they are a standing
    -- agreement with its own effective dates (0105), and a proposal is not an
    -- agreement.
    base_pay_minor   bigint NOT NULL CHECK (base_pay_minor > 0),
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (proposal_id, version),
    -- UU 13/2003 art. 59, as 0060 states it for the contract itself: a PKWT
    -- must say when it ends and a PKWTT must not.
    CONSTRAINT hire_proposal_version_term_matches_kind CHECK (
        (contract_kind = 'PKWT'  AND contract_ends_on IS NOT NULL) OR
        (contract_kind = 'PKWTT' AND contract_ends_on IS NULL)
    ),
    CONSTRAINT hire_proposal_version_term_ends_after_it_starts CHECK (
        contract_ends_on IS NULL OR contract_ends_on >= start_on
    )
);

-- One row per line, opening with the tuple, because that is the shape the
-- guard in `tests/migration_hygiene.rs` reads the vocabulary out of — and a
-- kind it cannot see is a kind it will report as missing.
--
-- A proposal is a record somebody talks about: head office asks the shop why
-- the pay is above the band, the shop answers, and both belong on the
-- proposal rather than in a chat nobody can find afterwards. Without this row
-- every comment, tag and activity entry against one would fail its foreign
-- key on the audit log.
INSERT INTO record_kind (code, label) VALUES
    ('hire_proposal', 'Hire proposal')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE hire_proposal IS
    'A shop asks for an employee it does not have; head office approves, '
    'returns for revision, or rejects. Not a recruitment pipeline: it stops at '
    'a candidate head office accepted.';
COMMENT ON COLUMN hire_proposal.state IS
    'Denormalised from history for index scans. The fold is the authority — a '
    'row whose history does not produce this value fails to load.';
COMMENT ON COLUMN hire_proposal.history IS
    'Append-only steps with the authority behind each. The proposer may not be '
    'the decider, which is checked on the actor because a rung cannot say it.';
COMMENT ON TABLE hire_proposal_version IS
    'What was asked for, once per version. A revision appends; nothing here is '
    'ever updated, so a returned version stays readable beside the one that '
    'replaced it.';
COMMENT ON COLUMN hire_proposal_version.candidate_name IS
    'The only personal datum a proposal holds. No NIK, address, birth date or '
    'contact: this is somebody who may never be employed here.';
COMMENT ON COLUMN hire_proposal_version.base_pay_minor IS
    'Proposed gaji pokok in the smallest unit. A proposal, never an agreement — '
    'what somebody is actually on is employee_pay (0105).';
