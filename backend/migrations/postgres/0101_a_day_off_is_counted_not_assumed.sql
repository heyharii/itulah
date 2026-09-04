-- 0101: A day off is counted, not assumed.
--
-- Ported from the reference HR backend's `040_holiday_calendar_v1.sql` and
-- `043_leave_v1.sql`. `docs/hr-port-provenance.md` records what changed.
--
-- Two halves of one question. The calendar says which days are red for
-- everybody; the leave tables say which days one person has taken and what
-- they have left. They arrive together because neither is usable alone: a
-- leave request spanning Idul Fitri has to know not to charge it, and a
-- calendar nobody counts leave against is a list of dates.
--
-- # The one number that is not stored
--
-- There is no `balance` column anywhere below, deliberately. A stored balance
-- beside the entries is a second answer to "how many days are left", and
-- nothing forces the two to agree — a crash between two statements is enough
-- to part them, silently, for ever. The balance is the fold over
-- `leave_ledger_entry` and there is no setter.
--
-- # The invariant this schema exists to hold
--
-- **An approval and its deduction happen together, or neither happens.** In
-- the implementation the reference replaced these were two writes with nothing
-- binding them: a crash between them left a request saying APPROVED against a
-- balance that never moved. Nobody notices, because both rows look fine on
-- their own — the employee takes the leave, the balance still shows it
-- available, so they take it again.
--
-- Here it is refused three times over: the type carries the ledger entry into
-- the APPROVED state so the pair cannot be built apart, the write does both in
-- one transaction, and `leave_request_deduction_only_when_approved` below
-- refuses the halfway row outright. The third exists because the first two are
-- code, and code can be wrong.

-- Which days are red, for a year.
--
-- Not compiled in, and not derived. Indonesian public holidays are fixed each
-- year by a Surat Keputusan Bersama of three ministries; several follow the
-- Hijri calendar and are confirmed only weeks ahead, and *cuti bersama* is
-- routinely added, removed or moved after the year has started. A table in a
-- binary would need a release every time the government changed its mind, and
-- by then somebody has already been marked absent.
CREATE TABLE holiday_calendar (
    -- Also the identity: one calendar per year, because "the 2026 calendar"
    -- has to name one thing.
    year       integer PRIMARY KEY CHECK (year BETWEEN 1900 AND 9999),
    -- The set **as published**. Not the current set: that is this plus the
    -- amendments, replayed. Storing both would mean the same facts twice, and
    -- the copy that drifts is the one queries read.
    --
    -- Decoding goes through the domain's constructor, so a regional day naming
    -- no places, or a national one narrowed to some, fails to load rather than
    -- becoming a holiday nobody approved as such.
    holidays   jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Who published it, under what authority, when, and why. NOT
    -- `authorization`: that is a reserved word in PostgreSQL, and a column
    -- named it fails the CREATE TABLE outright — see `employee_assignment`.
    published  jsonb NOT NULL,
    -- Append-only, each with its own authority. Replaying only the amendments
    -- that had happened by a given instant is what makes "the calendar March
    -- payroll was settled under" answerable in June.
    amendments jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- The kinds of leave, as the operator ratified them.
--
-- `backing` is what makes this a table worth having, and modelling it as one
-- balance with a label beside it is wrong for most of Indonesian leave law —
-- wrong in the direction that takes days off people:
--
--   * **Cuti sakit** is not deducted from anything. UU 13/2003 art. 93 obliges
--     the employer to keep paying an ill worker with a certificate, for as
--     long as the certificate says. There is no annual quota to run out of,
--     and a system that deducts sick days from the twelve annual days is
--     taking something the law does not allow it to take.
--   * **Cuti melahirkan** is likewise an entitlement, not a withdrawal.
--   * **Cuti karena alasan penting** (art. 93(4)) is bounded *per occurrence*
--     — three days to marry, two for a bereavement — not per year, and it does
--     not accumulate.
--   * **Cuti di luar tanggungan** costs pay, not days.
--
-- The statutory kinds are the floor, not the list: employers add their own,
-- and a closed enum here would mean a deploy for each one.
CREATE TABLE leave_type (
    code              text PRIMARY KEY CHECK (btrim(code) <> ''),
    name              text NOT NULL CHECK (btrim(name) <> ''),
    backing           text NOT NULL CHECK (
                          backing IN ('BALANCE', 'PER_OCCURRENCE', 'AS_CERTIFIED')
                      ),
    -- The per-occurrence bound, in hundredths of a day. Stated by the operator
    -- and never compiled in: three days for a marriage is a figure from
    -- art. 93(4) that can be amended, and a constant here would be quietly
    -- wrong from the day it was.
    max_centidays     integer,
    -- FULL, UNPAID, or the declining scale of art. 93(2). The last records
    -- only that the scale applies, so payroll asks rather than assuming full
    -- pay; the arithmetic is statutory and is deliberately not here.
    payment           text NOT NULL CHECK (
                          payment IN ('FULL', 'UNPAID', 'STATUTORY_SCALE')
                      ),
    requires_evidence boolean NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT leave_type_bound_matches_backing CHECK (
        (backing =  'PER_OCCURRENCE' AND max_centidays IS NOT NULL AND max_centidays > 0) OR
        (backing <> 'PER_OCCURRENCE' AND max_centidays IS NULL)
    ),
    -- "Bounded by the certificate" with no certificate required is unbounded
    -- leave nobody decided to grant.
    CONSTRAINT leave_type_certified_needs_evidence CHECK (
        backing <> 'AS_CERTIFIED' OR requires_evidence
    )
);

-- The rules a balance folds under, as generations.
--
-- Generations rather than edits: a policy change adds a row, and last month's
-- balance still folds under last month's rules. Two generations effective on
-- one day would make "which rules applied" depend on row order, which the
-- domain refuses and this unique key refuses again.
--
-- Stored as one JSONB value because the domain refuses to build a policy with
-- any of its four open questions unanswered — how much carry-forward may cross
-- a year, when it expires, whether encashment needs a second approver, whether
-- protected leave keeps accruing. Splitting it into nullable columns would
-- reintroduce exactly the unanswered state that refusal exists to prevent.
CREATE TABLE leave_policy (
    version          integer PRIMARY KEY CHECK (version > 0),
    effective_from   date NOT NULL UNIQUE,
    -- Duplicated out of `policy` for the one query that asks it without
    -- decoding: "what is this year's entitlement". The domain writes both from
    -- one value, so they cannot disagree.
    annual_centidays integer NOT NULL CHECK (annual_centidays > 0),
    policy           jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- Every movement of every balance. The only place days come from or go to.
--
-- Append-only: nothing here has an UPDATE or a DELETE path, and a correction
-- is an ADJUSTMENT row signed by its own amount rather than an edit to the row
-- that was wrong.
CREATE TABLE leave_ledger_entry (
    id          text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    leave_type  text NOT NULL REFERENCES leave_type(code),
    -- The day the movement belongs to, which is what orders the fold. Not the
    -- instant it was recorded: a January accrual entered in March is January's.
    on_date     date NOT NULL,
    -- The reference leaves this unconstrained; it is spelled out here for the
    -- same reason every other vocabulary in this schema is. A new kind of
    -- movement is a policy change and should be a visible edit, not a free
    -- string that lets operations invent categories the reports cannot see.
    event       text NOT NULL CHECK (event IN (
                    'ALLOCATION', 'ACCRUAL', 'CARRY_FORWARD', 'EXPIRY',
                    'USAGE', 'ENCASHMENT', 'COMPENSATORY', 'ADJUSTMENT'
                )),
    -- Hundredths of a day, for the same reason money is an integer of the
    -- smallest unit: a half day is 50, never 0.5. `0.1 + 0.2 <> 0.3`, and a
    -- balance off by 2^-52 fails an equality check nobody can explain —
    -- worse, it fails it only sometimes.
    centidays   integer NOT NULL,
    -- Whose movement this was. A ledger entry nobody is attached to cannot be
    -- disputed.
    by_actor    text NOT NULL CHECK (btrim(by_actor) <> ''),
    -- Set on CARRY_FORWARD entries: the day the carried days lapse.
    expires_on  date,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Exactly the order the fold is loaded in, so the domain's "entries never go
-- backwards" rule holds on the way in without a sort.
CREATE INDEX ix_leave_ledger_fold
    ON leave_ledger_entry (employee_id, leave_type, on_date, id);

-- Somebody asking for days off, and what was decided.
CREATE TABLE leave_request (
    id              text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id     text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    -- The reference has no place table to point at; we do, so this is a real
    -- foreign key. Which shop a request belongs to is what bounds the manager
    -- who may decide it.
    place_id        text NOT NULL REFERENCES org_place(id),
    leave_type      text NOT NULL REFERENCES leave_type(code),
    from_date       date NOT NULL,
    to_date         date NOT NULL,
    -- The dates actually charged, as settled on the day it was filed. Stored
    -- rather than recomputed, because the calendar can be amended afterwards:
    -- a cuti bersama added in June must not change what an April request cost.
    chargeable      jsonb NOT NULL,
    evidence        text,
    requested       jsonb NOT NULL,
    state           text NOT NULL CHECK (
                        state IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')
                    ),
    decision        jsonb,
    -- The row this approval deducted. **This is the invariant.**
    ledger_entry_id text REFERENCES leave_ledger_entry(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT leave_request_decision_matches_state CHECK (
        (state =  'PENDING' AND decision IS NULL) OR
        (state <> 'PENDING' AND decision IS NOT NULL)
    ),
    -- A ledger entry may only be named by an APPROVED request. The reverse
    -- half — that an approval of *balance-backed* leave must name one — needs
    -- the `leave_type.backing` join and lives in the domain, which re-runs it
    -- on every decode.
    CONSTRAINT leave_request_deduction_only_when_approved CHECK (
        ledger_entry_id IS NULL OR state = 'APPROVED'
    ),
    CONSTRAINT leave_request_ends_after_it_starts CHECK (to_date >= from_date)
);

CREATE INDEX ix_leave_request_employee
    ON leave_request (employee_id, from_date DESC);
-- The manager's queue: what is waiting on a decision at one place. Partial,
-- because an answered request is not in anybody's way.
CREATE INDEX ix_leave_request_pending
    ON leave_request (place_id, from_date) WHERE state = 'PENDING';

COMMENT ON TABLE holiday_calendar IS
    'Which days are red, per year: the published set plus append-only '
    'amendments. The current set is replayed, never stored — a second answer '
    'to "is this a holiday" is a second answer that can disagree.';
COMMENT ON COLUMN leave_type.backing IS
    'BALANCE draws on a ledger; PER_OCCURRENCE is bounded per event; '
    'AS_CERTIFIED is bounded by evidence and deducts from nothing.';
COMMENT ON TABLE leave_ledger_entry IS
    'Every movement of every balance. There is no balance column anywhere: '
    'the balance is the fold, and there is no setter.';
COMMENT ON COLUMN leave_request.ledger_entry_id IS
    'The deduction this approval made. NULL on an approved request means the '
    'kind draws on no balance, which is correct rather than missing.';
