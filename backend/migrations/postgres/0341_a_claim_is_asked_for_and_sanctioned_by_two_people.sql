-- An expense claim is asked for by one person and sanctioned by another.
--
-- # What this is, and what it is not
--
-- HRMS calls this an Expense Claim: an employee (or a place manager on their
-- behalf) lists what was spent, a decider sanctions each line, and — the point
-- of the module — the sanction puts money in the books. It is NOT an advance
-- (0280: money out before it is spent, finance lane) and not a store expense
-- (the imprest lane's own receipts): a claim is somebody asking the company to
-- pay them back, and the two-actor rule on the decision is what makes the
-- asking and the paying two people's acts.
--
-- # The write-once halves, same discipline as leave
--
-- A claim is submitted exactly once, decided exactly once, paid exactly once,
-- and each half is nullable together with its state — every pairing is a CHECK
-- below, so a halfway row (approved, nothing sanctioned; paid, no journal
-- behind it) fails the INSERT outright rather than waiting for a reader to
-- notice. The decider may not be the filer: that rule is also a CHECK, because
-- a rule only the live path enforces is a rule a psql session removes.
--
-- The decider's sanctions land on the LINES as well as the header, so "what
-- was allowed" survives the claim being paid and the claim itself becoming
-- evidence rather than the answer.
--
-- # History
--
-- `history` is the append-only jsonb trail every event appends to (FILED,
-- SUBMITTED, DECIDED, RETURNED, WITHDRAWN, PAID) — the payroll-run voice. A
-- RETURN does not rest anywhere: it sends a submitted claim back to DRAFT with
-- a reason, which is why RETURNED is in the state vocabulary but no column
-- pair records it — the history is the only evidence it happened, which is
-- what history is for.

CREATE TABLE expense_claim_type (
    code       text PRIMARY KEY CHECK (btrim(code) <> ''),
    name       text NOT NULL CHECK (btrim(name) <> ''),
    retired_at timestamptz,
    -- A retirement without a reason is a decision without an author; the
    -- route asks for one and the column keeps it.
    retired_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((retired_at IS NULL) = (retired_reason IS NULL))
);

COMMENT ON TABLE expense_claim_type IS
    'The company catalogue of claim types (TRAVEL, MEDICAL, SUPPLIES ...).
     Head office defines it; entries are retired, never deleted, so every
     claim line keeps naming a type that exists. The code is also the
     `employee_expense` qualifier the approval posting carries — see 0342.';

CREATE TABLE expense_claim (
    claim_id       uuid PRIMARY KEY,
    claim_number   text NOT NULL UNIQUE,     -- KLC-{place}-{yy}-{seq} via next_document_number
    place_id       text NOT NULL REFERENCES org_place(id),
    employee_id    text NOT NULL REFERENCES employee(id),
    claimed_by     text NOT NULL,            -- app_user.username; self or a manager filing on behalf
    posted_on      date NOT NULL,
    -- Sanctioned total, decided by whoever approves; NULL while undecided.
    sanctioned_minor bigint CHECK (sanctioned_minor > 0),
    state          text NOT NULL DEFAULT 'DRAFT'
                     CHECK (state IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','PAID','RETURNED','WITHDRAWN')),
    decided_by     text, decided_at timestamptz, decide_reason text,
    paid_at        timestamptz, paid_by text, paid_entry_id uuid REFERENCES journal_entry(entry_id),
    approved_entry_id uuid REFERENCES journal_entry(entry_id),
    -- The append-only trail: FILED, SUBMITTED, DECIDED, RETURNED, WITHDRAWN,
    -- PAID — each with who, when, and why. A RETURN rests nowhere else.
    history        jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- The write-once halves of the state machine, same discipline as leave:
    -- a claim is submitted exactly once, decided exactly once, paid exactly
    -- once, and each half is nullable together with its state.
    CHECK ((state IN ('APPROVED','REJECTED','PAID')) = (decided_by IS NOT NULL)),
    CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
    CHECK ((state = 'PAID') = (paid_entry_id IS NOT NULL)),
    CHECK ((state IN ('APPROVED','PAID')) = (approved_entry_id IS NOT NULL)),
    -- And the sanctioned total exists exactly when a decision sanctioned
    -- something: a REJECTED claim is decided but nothing was allowed, and a
    -- DRAFT one has not been decided at all.
    CHECK ((state IN ('APPROVED','PAID')) = (sanctioned_minor IS NOT NULL)),
    -- The two-actor rule, held by the database and not only by the handler:
    -- whoever decided was not whoever filed. A row that says otherwise is a
    -- claim one person asked for and granted.
    CHECK (state NOT IN ('APPROVED','REJECTED','PAID') OR decided_by <> claimed_by)
);

COMMENT ON COLUMN expense_claim.claimed_by IS
    'The app_user.username that filed the claim — the employee, or a place
     manager filing on their behalf under people.claim.file. The two-actor
     rule is stated against this name: the same username may not decide.';

COMMENT ON COLUMN expense_claim.history IS
    'Append-only jsonb events (actor, action, reason, at, detail?): the
     audit view folds this. RETURNED appears only here.';

CREATE INDEX ix_expense_claim_place ON expense_claim (place_id, state, posted_on DESC);
CREATE INDEX ix_expense_claim_employee ON expense_claim (employee_id, posted_on DESC);
CREATE INDEX ix_expense_claim_open ON expense_claim (place_id, posted_on DESC) WHERE state = 'SUBMITTED';

CREATE TABLE expense_claim_line (
    line_id        uuid PRIMARY KEY,
    claim_id       uuid NOT NULL REFERENCES expense_claim(claim_id) ON DELETE CASCADE,
    type_code      text NOT NULL REFERENCES expense_claim_type(code),
    description    text NOT NULL CHECK (btrim(description) <> ''),
    spent_on       date NOT NULL,
    claimed_minor  bigint NOT NULL CHECK (claimed_minor > 0),
    sanctioned_minor bigint CHECK (sanctioned_minor > 0),   -- the decider's figure
    line_number    int NOT NULL,
    UNIQUE (claim_id, line_number)
);

COMMENT ON COLUMN expense_claim_line.sanctioned_minor IS
    'What the decider allowed, written when the claim is approved. Positive
     and never zero: trimming a line to nothing is a RETURN or a REJECT,
     which are decisions with names on them.';
