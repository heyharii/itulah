-- 0051: The journal. The only place money is recorded, and it is append-only.
--
-- # Why a journal is not a projection
--
-- Everything else in this database follows one rule: do not store a counter,
-- derive it, and if the derivation disagrees with the facts, rebuild it. The
-- ledger looks like it breaks that rule and does not.
--
--   * A journal ENTRY is a fact, like a sale or a goods receipt. It is written
--     once and never updated. A mistake is corrected by a reversing entry, in
--     exactly the way a `sale_return` corrects a sale without editing it.
--   * Every BALANCE is a projection. Trial balance, account balance, supplier
--     ageing — all summed from `journal_line` on every read, never stored.
--     Nothing here holds a running total, for the same reason
--     `purchase_order` holds no received quantity.
--   * Entries are DERIVED from source documents by a named, versioned rule, so
--     the ledger can be rebuilt from the documents rather than repaired.
--
-- # Why the invariants are in the database
--
-- Application validation is where an invariant lives until the day somebody
-- opens psql, or a second writer appears, or a migration back-fills. A general
-- ledger that can be left unbalanced by any of those is not a ledger. So the
-- two rules that matter are enforced here, and the Rust enforces them again:
--
--   * an entry balances, and its header agrees with its lines;
--   * nothing may be posted into a closed period.
--
-- Neither can be a CHECK. The first needs the lines, which do not exist when
-- the header is inserted — so it is a DEFERRED constraint trigger that fires at
-- COMMIT. The second needs to lock the period against a concurrent close — so
-- it takes FOR SHARE, and a close and a posting can no longer both succeed.

CREATE SEQUENCE journal_entry_number_seq;

CREATE TABLE journal_entry (
    entry_id      uuid PRIMARY KEY,
    -- `JV-00000001`. Gaps are possible and are not a defect: a rolled-back
    -- transaction consumes a number, and a ledger does not require gapless
    -- numbering the way a fiscal receipt does.
    entry_number  text NOT NULL UNIQUE CHECK (btrim(entry_number) <> ''),

    -- The date the entry belongs to in the books, which is not the moment it
    -- was written. A February invoice keyed in March posts to February if
    -- February is still open, and to March if it is not.
    posting_date  date NOT NULL,

    -- What caused this. A journal line that cannot be traced back to a document
    -- is a journal line somebody will eventually have to explain from memory.
    -- MANUAL is a legitimate source and carries no document.
    source_kind   text NOT NULL CHECK (source_kind IN (
                      'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
                      'TRANSFER', 'MANUAL', 'REVERSAL')),
    source_id     text,
    -- Which version of which posting rule built these lines. When a rule is
    -- corrected, this is what says which entries were built by the old one.
    rule_version  text NOT NULL CHECK (btrim(rule_version) <> ''),

    -- The header's own total, checked against the lines at COMMIT. Redundant on
    -- purpose: a header that silently disagreed with its lines is the failure
    -- this column exists to make impossible.
    total_minor   bigint NOT NULL CHECK (total_minor > 0),
    currency      char(3) NOT NULL,
    memo          text,

    -- Set on the entry that undoes another. The reversed entry is untouched.
    reversal_of   uuid UNIQUE REFERENCES journal_entry(entry_id),

    posted_by     text NOT NULL CHECK (btrim(posted_by) <> ''),
    posted_at     timestamptz NOT NULL DEFAULT now(),

    CHECK (source_kind = 'MANUAL' OR source_kind = 'REVERSAL' OR source_id IS NOT NULL),
    CHECK ((source_kind = 'REVERSAL') = (reversal_of IS NOT NULL))
);
CREATE INDEX ix_journal_entry_date ON journal_entry (posting_date);
CREATE INDEX ix_journal_entry_source ON journal_entry (source_kind, source_id);

-- One side of one account, at one location.
--
-- `site_id` is not optional. Every posting belongs somewhere: the client keeps a
-- profit and loss per location and their chart carries the location in the
-- account code itself, so a line that could not say where it happened would be a
-- line that cannot appear in any of their reports.
CREATE TABLE journal_line (
    line_id       uuid PRIMARY KEY,
    entry_id      uuid NOT NULL REFERENCES journal_entry(entry_id),
    line_number   integer NOT NULL CHECK (line_number > 0),

    account_code  text NOT NULL,
    -- Pinned false and carried into the foreign key, so posting to a heading is
    -- refused by the database rather than by a convention.
    is_group      boolean NOT NULL DEFAULT false CHECK (is_group = false),

    site_id       text NOT NULL REFERENCES site(id),

    debit_minor   bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
    credit_minor  bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),

    -- Sub-ledger dimensions. Supplier ageing is a projection over these; there
    -- is no separate payables ledger to drift out of step with the GL.
    supplier_id   text,
    memo          text,

    UNIQUE (entry_id, line_number),
    -- Exactly one side, and never zero. A line with both is a mistake; a line
    -- with neither is noise that makes a ledger longer without saying anything.
    CHECK ((debit_minor = 0) <> (credit_minor = 0)),
    FOREIGN KEY (account_code, is_group)
        REFERENCES ledger_account (account_code, is_group)
);
CREATE INDEX ix_journal_line_entry ON journal_line (entry_id);
-- The index every balance read uses: account, then location, then time.
CREATE INDEX ix_journal_line_account ON journal_line (account_code, site_id);
CREATE INDEX ix_journal_line_supplier ON journal_line (supplier_id)
    WHERE supplier_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invariant one: an entry balances, and its header agrees with its lines.
-- ---------------------------------------------------------------------------

-- Note on error codes: these raise with plpgsql's default SQLSTATE, P0001, and
-- must keep doing so. `AppError::into_response` recognises exactly P0001 and
-- passes the message through as a 409 — so "accounting period 2026-09 is
-- closed" is what a person reads. Setting a more precise-looking ERRCODE (say
-- `check_violation`) makes the same refusal arrive as an opaque 500, because
-- that path stops matching. Same convention as `protect_commercial_rule` in 0003.

CREATE OR REPLACE FUNCTION assert_journal_balanced() RETURNS trigger AS $$
DECLARE
    lines   bigint;
    debits  bigint;
    credits bigint;
    header  bigint;
    target  uuid;
BEGIN
    -- Both tables carry `entry_id`, so one trigger function serves both.
    target := NEW.entry_id;

    SELECT COUNT(*), COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0)
      INTO lines, debits, credits
      FROM journal_line WHERE entry_id = target;

    -- The entry may have been reversed out of existence by a rollback of the
    -- header itself; there is then nothing to check.
    SELECT total_minor INTO header FROM journal_entry WHERE entry_id = target;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF lines = 0 THEN
        RAISE EXCEPTION 'journal entry % has no lines', target;
    END IF;
    IF debits <> credits THEN
        RAISE EXCEPTION 'journal entry % does not balance: debits %, credits %',
            target, debits, credits;
    END IF;
    IF debits <> header THEN
        RAISE EXCEPTION 'journal entry % header says % but its lines total %',
            target, header, debits;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Both tables, because either one alone leaves a hole: checking only the header
-- misses lines appended to an entry that already committed, and checking only
-- the lines misses an entry that never got any.
CREATE CONSTRAINT TRIGGER journal_entry_balances
    AFTER INSERT ON journal_entry
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();

CREATE CONSTRAINT TRIGGER journal_line_balances
    AFTER INSERT ON journal_line
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();

-- ---------------------------------------------------------------------------
-- Invariant two: nothing is posted into a closed period.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger AS $$
DECLARE
    y      smallint := EXTRACT(YEAR FROM NEW.posting_date)::smallint;
    m      smallint := EXTRACT(MONTH FROM NEW.posting_date)::smallint;
    state  text;
BEGIN
    -- FOR SHARE, not a plain read. A close running at the same moment must
    -- either wait for this posting or make this posting wait for it; there is
    -- no interleaving in which the period closes and a late entry slips in.
    SELECT status INTO state FROM fiscal_period
        WHERE year = y AND month = m FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'no accounting period exists for %-%; open it before posting',
            y, lpad(m::text, 2, '0');
    END IF;
    IF state = 'CLOSED' THEN
        RAISE EXCEPTION 'accounting period %-% is closed',
            y, lpad(m::text, 2, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_period_open
    BEFORE INSERT ON journal_entry
    FOR EACH ROW EXECUTE FUNCTION assert_period_open();

-- ---------------------------------------------------------------------------
-- Invariant three: the journal is append-only.
-- ---------------------------------------------------------------------------
--
-- Same shape as `protect_commercial_rule` in 0003. An UPDATE that fixed a wrong
-- amount would leave no trace that it had ever been wrong, which is the one
-- thing a ledger exists to prevent.

CREATE OR REPLACE FUNCTION protect_journal() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'the journal is append-only: correct % with a reversing entry, not a raw %',
        TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_append_only
    BEFORE UPDATE OR DELETE ON journal_entry
    FOR EACH ROW EXECUTE FUNCTION protect_journal();
CREATE TRIGGER journal_line_append_only
    BEFORE UPDATE OR DELETE ON journal_line
    FOR EACH ROW EXECUTE FUNCTION protect_journal();

COMMENT ON TABLE journal_entry IS
    'The general ledger. Append-only: corrections are reversing entries. Balances are never stored here; every balance is summed from journal_line on read.';
COMMENT ON COLUMN journal_entry.total_minor IS
    'The header total, checked against the sum of the lines by a deferred constraint trigger at COMMIT. Deliberately redundant.';
