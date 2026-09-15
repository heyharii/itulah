-- 0116: A bank line that comes every month proposes what it is.
--
-- # What was missing
--
-- `Ruleset::default()` was hardcoded at `banking.rs:377` and there was no table
-- behind it. That is fine for the matcher — those are weights, and a client who
-- wants a four-day window rather than three has a different conversation — but
-- it left the OTHER half of reconciliation with nothing at all: the lines the
-- bank has and the books do not.
--
-- Those lines are not a long tail. They are the same four or five narrations
-- every month on every account: the monthly charge, the interest credited, the
-- tax withheld on that interest, the transfer fee. Somebody was booking each of
-- them by hand, choosing the same account every time, and nothing in the system
-- remembered that they had.
--
-- # A rule PROPOSES. It never posts.
--
-- This is the whole design and it is worth being blunt about it. A rule that
-- posted would be a rule that quietly invents journal entries out of text
-- matching, and the first time a bank changed a narration it would invent them
-- somewhere wrong. Nobody would notice, because a rule-posted entry looks
-- exactly like a person-posted one.
--
-- So evaluation writes `bank_rule_proposal` rows and stops. A person reads the
-- proposal — the narration, the rule that recognised it, the account it points
-- at — and accepts or ignores it. Accepting creates a cash document (0115) and
-- posts THAT, which means every rule-recognised bank line ends up with the same
-- paper behind it as one somebody typed. Ignoring records that a person looked
-- and said no, which is what stops the same line being proposed forever.
--
-- # Priority, and why first match wins
--
-- `PAJAK BUNGA` and `BUNGA` both match "PAJAK BUNGA 20%". They are different
-- accounts — one is income, the other is tax withheld on it — and the only
-- thing that can separate them is which rule is asked first. So rules carry a
-- priority, lowest first, and the first that matches wins; a rule that is a
-- prefix of another's narration has to sit above it, and the seeds below are
-- ordered that way on purpose.
--
-- Scoring them and taking the best would be worse: a score would have to be
-- invented for text matching, and two rules tying would auto-resolve by
-- whatever the database returned first — the failure `bank_match` refuses to
-- make for the same reason.

CREATE TABLE bank_rule (
    rule_id      uuid PRIMARY KEY,

    -- Lowest first. Not unique: two rules that cannot both match the same line
    -- may legitimately sit at the same rung, and forcing a total order would
    -- make adding a rule a renumbering exercise.
    priority     integer NOT NULL DEFAULT 100 CHECK (priority > 0),

    -- CONTAINS and STARTS_WITH are decided by the kernel, on text normalised
    -- the way `bank_match` normalises a reference — case and punctuation
    -- folded away, because no two banks agree about either. REGEX is decided
    -- by Postgres's own POSIX engine: this crate carries no regex engine, and
    -- inventing a dialect would mean a pattern that behaves one way on the
    -- screen and another in the query.
    match_kind   text NOT NULL CHECK (match_kind IN ('CONTAINS', 'STARTS_WITH', 'REGEX')),
    pattern      text NOT NULL CHECK (btrim(pattern) <> ''),

    -- Which way the money went, as the BANK reports it: OUT is a debit on the
    -- statement. A charge and a refund of that charge carry near-identical
    -- narrations and are not the same event.
    direction    text NOT NULL DEFAULT 'ANY' CHECK (direction IN ('IN', 'OUT', 'ANY')),

    -- Where the other side goes. A meaning and a qualifier, never a client
    -- account code — the same rule every posting rule in this system obeys.
    semantic_key text NOT NULL CHECK (btrim(semantic_key) <> ''),
    qualifier    text NOT NULL DEFAULT '',
    -- Head office by default. Bank charges are charged to the account's own
    -- location, and every bank account the client keeps is HO's.
    site_id      text NOT NULL DEFAULT 'dc' REFERENCES site(id),

    -- Who the slip should name, when the rule knows. "Bank BCA" for a charge.
    party        text,

    -- Retired rather than deleted. A proposal names the rule that made it, and
    -- a rule that could be deleted would leave accepted history unable to say
    -- why the account was chosen.
    active       boolean NOT NULL DEFAULT true,
    note         text,

    created_by   text NOT NULL DEFAULT 'migration' CHECK (btrim(created_by) <> ''),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   text,
    updated_at   timestamptz,

    -- One rule per (pattern, kind, direction). A second copy would double every
    -- proposal it makes and there would be no way to tell which was meant.
    UNIQUE (match_kind, pattern, direction)
);
CREATE INDEX ix_bank_rule_priority ON bank_rule (priority, rule_id) WHERE active;

-- What a rule thinks a line is. Not what it did — it did nothing.
CREATE TABLE bank_rule_proposal (
    proposal_id  uuid PRIMARY KEY,
    line_id      uuid NOT NULL REFERENCES bank_statement_line(line_id) ON DELETE CASCADE,
    rule_id      uuid NOT NULL REFERENCES bank_rule(rule_id),

    -- Copied from the rule at the moment it was made, not read through it.
    -- A rule that is later re-pointed must not silently re-point every
    -- proposal a person has already read and not yet acted on.
    semantic_key text NOT NULL CHECK (btrim(semantic_key) <> ''),
    qualifier    text NOT NULL DEFAULT '',
    site_id      text NOT NULL REFERENCES site(id),

    -- PROPOSED  waiting for a person
    -- ACCEPTED  a cash document exists and is posted
    -- IGNORED   a person looked and said no
    status       text NOT NULL DEFAULT 'PROPOSED'
                 CHECK (status IN ('PROPOSED', 'ACCEPTED', 'IGNORED')),

    cash_document_id uuid REFERENCES cash_document(document_id),

    proposed_at  timestamptz NOT NULL DEFAULT now(),
    decided_by   text,
    decided_at   timestamptz,
    -- Why it was ignored, when somebody says. The next evaluation will not
    -- propose it again, and this is the only record of why not.
    reason       text,

    CHECK ((status = 'ACCEPTED') = (cash_document_id IS NOT NULL)),
    CHECK ((status = 'PROPOSED') = (decided_by IS NULL)),
    CHECK ((decided_by IS NULL) = (decided_at IS NULL))
);
CREATE INDEX ix_bank_rule_proposal_status
    ON bank_rule_proposal (status, proposed_at DESC);
CREATE INDEX ix_bank_rule_proposal_rule ON bank_rule_proposal (rule_id);

-- One open proposal per line. Re-running evaluation over a statement is an
-- ordinary thing to do — a rule was added, a line arrived late — and it must
-- not stack three proposals on one line for a person to work through.
CREATE UNIQUE INDEX ux_bank_rule_proposal_open
    ON bank_rule_proposal (line_id) WHERE status = 'PROPOSED';
-- And one accepted proposal per line, forever: accepting posts money.
CREATE UNIQUE INDEX ux_bank_rule_proposal_accepted
    ON bank_rule_proposal (line_id) WHERE status = 'ACCEPTED';

-- ---------------------------------------------------------------------------
-- The three every statement carries
-- ---------------------------------------------------------------------------
--
-- Seeded rather than left for somebody to type, because these three are on
-- every account of every Indonesian bank every month, and a reconciliation
-- screen that shipped with an empty rule list would teach people that the
-- feature does nothing.
--
-- The accounts they point at are meanings, and the meanings are mapped on the
-- Account Map screen — `bank_admin_fee` to `6010310004 Biaya Bank`,
-- `interest_income` to `8010110001 Pendapatan Bunga Bank`, and
-- `tax_on_interest` to the client's own income-tax leaf. Until they are mapped,
-- a proposal can be made and not accepted, and the refusal names the key.
--
-- PAJAK BUNGA sits above BUNGA on purpose: it contains it.

INSERT INTO bank_rule (rule_id, priority, match_kind, pattern, direction,
                       semantic_key, party, note)
VALUES
    ('9e1a0e4a-6c1f-4a05-9d4b-3f3f0a2b0001', 10, 'CONTAINS', 'PAJAK BUNGA', 'OUT',
     'tax_on_interest', 'Bank',
     'PPh atas jasa giro, dipotong bank. Harus di atas BUNGA: teksnya memuat BUNGA.'),
    ('9e1a0e4a-6c1f-4a05-9d4b-3f3f0a2b0002', 20, 'CONTAINS', 'BIAYA ADM', 'OUT',
     'bank_admin_fee', 'Bank',
     'Biaya administrasi bulanan rekening.'),
    ('9e1a0e4a-6c1f-4a05-9d4b-3f3f0a2b0003', 30, 'CONTAINS', 'BUNGA', 'IN',
     'interest_income', 'Bank',
     'Jasa giro / bunga tabungan yang dikreditkan bank.');

COMMENT ON TABLE bank_rule IS
    'How to recognise a bank line nobody booked. A rule proposes an account; it never posts. Lowest priority number is asked first and the first match wins.';
COMMENT ON TABLE bank_rule_proposal IS
    'What a rule thinks one statement line is, waiting for a person. Accepting creates and posts a cash document; ignoring records that somebody looked.';
