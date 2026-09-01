-- 0071: Bank reconciliation — the bank's account of events, beside ours.
--
-- Ported in shape from `~/Documents/retail/final-product/backend`
-- (`banking-domain`, `cloud-banking`), whose invariants B1–B11 are the best
-- statement of this problem in any of the three generations. What is kept, and
-- the two things done differently.
--
-- # Kept: a line is deduplicated by fingerprint, not by trust
--
-- The same statement gets imported twice — a person re-uploads, a job retries,
-- a month overlaps a month. A deterministic fingerprint over the fields the
-- bank actually gives us makes the second import a no-op instead of doubling
-- every figure. The fingerprint is stored, not recomputed on read, because the
-- normalisation that produced it is part of the evidence.
--
-- # Kept: matching is amount-anchored, and only a unique winner auto-matches
--
-- Two candidates tying at the top is precisely the case a person must look at,
-- so a tie auto-matches nothing. That is B6, and it is the rule that decides
-- whether this feature is trusted after the first bad month.
--
-- # Kept: one line, one match
--
-- A statement line settles one ledger line and vice versa. Enforced here by two
-- unique indexes rather than by the code that writes them.
--
-- # Changed: the candidates are our own ledger, not other statement lines
--
-- The reference implementation matched a statement line against *other
-- unmatched statement lines*, because its AR/AP authority had not landed yet
-- and it needed something to score against. We have a general ledger, so a
-- candidate is a `journal_line` on the same bank account. That is what bank
-- reconciliation is actually for: proving the bank and the books agree.
--
-- # Changed: reconciling posts nothing
--
-- Matching records agreement. It does not write a journal, and it must not:
-- a matched line means we already booked it and the bank has now confirmed it.
-- An UNMATCHED bank line is the interesting one — either it is timing, or we
-- have not recorded something — and turning it into a journal is a separate,
-- deliberate act with its own actor. Conflating the two makes "reconcile" a
-- button that silently invents entries.

CREATE TABLE bank_statement (
    statement_id  uuid PRIMARY KEY,
    -- The client account this statement belongs to: one of the leaves under
    -- `1011002` (giro) or `1011003` (tabungan). A foreign key to the chart, so
    -- a statement cannot be imported against an account nobody keeps.
    account_code  text NOT NULL,
    is_group      boolean NOT NULL DEFAULT false CHECK (is_group = false),
    site_id       text NOT NULL REFERENCES site(id),

    period_start  date NOT NULL,
    period_end    date NOT NULL,
    -- What the bank says the account held at each end of the window. The whole
    -- point of the exercise: our ledger has to arrive at `closing_minor` from
    -- `opening_minor` through the lines below, and when it does not, the
    -- difference is the unreconciled remainder.
    opening_minor bigint NOT NULL,
    closing_minor bigint NOT NULL,

    source_name   text,
    imported_by   text NOT NULL,
    imported_at   timestamptz NOT NULL DEFAULT now(),

    CHECK (period_end >= period_start),
    FOREIGN KEY (account_code, is_group)
        REFERENCES ledger_account (account_code, is_group),
    -- Referenced by the lines, so a line's copy of the account cannot drift
    -- from its statement's. See the note on `bank_statement_line.account_code`.
    UNIQUE (statement_id, account_code)
);
CREATE INDEX ix_bank_statement_account ON bank_statement (account_code, period_start DESC);

CREATE TABLE bank_statement_line (
    line_id       uuid PRIMARY KEY,
    statement_id  uuid NOT NULL REFERENCES bank_statement(statement_id) ON DELETE CASCADE,
    line_number   integer NOT NULL CHECK (line_number > 0),

    value_date    date NOT NULL,
    description   text NOT NULL,
    reference     text,
    -- Exactly one side, and never zero — the same rule the journal keeps, for
    -- the same reason: a line with both is a mistake and a line with neither is
    -- noise.
    debit_minor   bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
    credit_minor  bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),

    -- Deterministic over (account, value date, amount, reference, description).
    -- Unique per bank account rather than globally: two accounts can genuinely
    -- receive the same amount on the same day with the same narration.
    fingerprint   text NOT NULL,

    -- The statement's account, copied down.
    --
    -- A copy, and normally this repository refuses those. It is here because
    -- the dedupe index has to be `(account, fingerprint)` and Postgres will not
    -- accept a subquery in an index expression — the alternative is a trigger,
    -- which is a copy too, only an invisible one. The composite foreign key
    -- below makes the copy unable to disagree: a line can only name the account
    -- its own statement names.
    account_code  text NOT NULL,

    UNIQUE (statement_id, line_number),
    CHECK ((debit_minor = 0) <> (credit_minor = 0)),
    FOREIGN KEY (statement_id, account_code)
        REFERENCES bank_statement (statement_id, account_code)
);
CREATE INDEX ix_bank_statement_line_statement ON bank_statement_line (statement_id, line_number);
CREATE INDEX ix_bank_statement_line_date ON bank_statement_line (value_date);

-- A re-import of the same statement is a no-op, not a doubling.
CREATE UNIQUE INDEX ux_bank_statement_line_fingerprint
    ON bank_statement_line (account_code, fingerprint);

-- The bank's line and ours, agreed to be the same event.
CREATE TABLE bank_line_match (
    match_id        uuid PRIMARY KEY,
    line_id         uuid NOT NULL REFERENCES bank_statement_line(line_id) ON DELETE CASCADE,
    journal_line_id uuid NOT NULL REFERENCES journal_line(line_id),

    -- MANUAL   a person said so
    -- AUTO     a unique top suggestion at or above the threshold
    decided_by_kind text NOT NULL CHECK (decided_by_kind IN ('MANUAL', 'AUTO')),
    -- What the matcher thought, kept even on a manual match: an auto-match that
    -- a person later undoes is the evidence that the threshold is wrong.
    score           integer,
    -- Why, in words the person who has to check it can read. Not a 0-100
    -- number on its own — a score explains nothing about which field agreed.
    reasons         text[] NOT NULL DEFAULT '{}',

    matched_by      text NOT NULL,
    matched_at      timestamptz NOT NULL DEFAULT now(),

    -- One line, one match, both ways. B7, enforced by the database rather than
    -- by the code that writes it.
    UNIQUE (line_id),
    UNIQUE (journal_line_id)
);
CREATE INDEX ix_bank_line_match_journal ON bank_line_match (journal_line_id);

COMMENT ON TABLE bank_statement_line IS
    'What the bank says happened. Deduplicated by a deterministic fingerprint per account, so re-importing a statement is a no-op.';
COMMENT ON TABLE bank_line_match IS
    'An agreement that one bank line and one journal line are the same event. Records agreement; posts nothing.';
