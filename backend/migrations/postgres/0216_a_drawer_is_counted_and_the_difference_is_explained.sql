-- A drawer is counted, and the difference is explained.
--
-- Cash has no bank statement. The only thing that can contradict the ledger is
-- a person standing at the till with the notes in their hand, so the document
-- this lane needs is not a reconciliation — it is a count, and the number it
-- produces is compared with the books on that date.
--
-- # Why this is not shaped like a bank statement
--
-- A statement arrives from outside, covers a period, and carries an opening and
-- a closing balance; its lines are matched one by one. A count is one moment,
-- one figure, and the only question it raises is why that figure differs from
-- the books. So: one row per count, an optional breakdown by denomination, and
-- a difference that is DERIVED and never stored — `counted_minor` minus the
-- ledger at `counted_on` is a subtraction, and a stored copy of it is a second
-- number that will disagree with the first the day an entry is backdated.

ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER', 'CASH_COUNT'));

CREATE TABLE cash_count (
    count_id        uuid PRIMARY KEY,

    -- The drawer, exactly as every other money screen addresses one: the
    -- client's own account code at one place. A count belongs to a place money
    -- sits, not to a person and not to a shift.
    account_code    text NOT NULL,
    is_group        boolean NOT NULL DEFAULT false CHECK (is_group = false),
    site_id         text NOT NULL REFERENCES site(id),

    counted_on      date NOT NULL,
    -- Who counted, and who watched. The second is not ceremony: a count with
    -- nobody beside it is one person's word about their own drawer, and the
    -- difference it reports is the figure somebody will later be asked about.
    counted_by      text NOT NULL CHECK (btrim(counted_by) <> ''),
    witnessed_by    text NOT NULL DEFAULT '',

    -- What was in the drawer.
    counted_minor   bigint NOT NULL CHECK (counted_minor >= 0),
    -- What the books said at `counted_on`, as at the moment of counting.
    --
    -- Stored, and this is the one copy that earns its place: the ledger keeps
    -- moving, and "the books said 750.000 when we counted" is a fact about that
    -- afternoon that a later backdated entry must not be able to rewrite. The
    -- difference is still derived from the two, never stored.
    per_books_minor bigint NOT NULL,

    -- Why the drawer and the books disagree. Empty is allowed while a count is
    -- being written down; posting the difference without it is not.
    reason          text NOT NULL DEFAULT '',

    -- The entry that put the difference in the books, once somebody posts it.
    -- Null means the count exists and the difference is still an observation.
    entry_id        uuid REFERENCES journal_entry(entry_id),

    created_at      timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (account_code, is_group)
        REFERENCES ledger_account (account_code, is_group),

    -- One count per drawer per day. Counting twice in an afternoon is really a
    -- correction, and a correction that hides the first count is how a shortage
    -- disappears.
    UNIQUE (account_code, site_id, counted_on)
);

-- The breakdown, when somebody wrote one down.
--
-- Optional on purpose: a supervisor who counts a float and writes "500.000" has
-- made a count, and refusing it until every denomination is keyed is how a
-- control stops being used. When the breakdown IS given it has to add up, and
-- that is enforced below rather than trusted.
CREATE TABLE cash_count_note (
    count_id           uuid NOT NULL REFERENCES cash_count(count_id) ON DELETE CASCADE,
    -- 100000, 50000, … 100. Stored as the value of ONE note or coin rather than
    -- as a label, so arithmetic never depends on parsing "Rp 50.000".
    denomination_minor bigint NOT NULL CHECK (denomination_minor > 0),
    quantity           integer NOT NULL CHECK (quantity >= 0),
    PRIMARY KEY (count_id, denomination_minor)
);

CREATE OR REPLACE FUNCTION cash_count_breakdown_adds_up() RETURNS trigger AS $$
DECLARE
    target  bigint;
    counted bigint;
BEGIN
    SELECT c.counted_minor INTO target
      FROM cash_count c
     WHERE c.count_id = COALESCE(NEW.count_id, OLD.count_id);

    -- The parent is gone: this is a cascade, and there is nothing left to
    -- disagree with.
    IF target IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM(n.denomination_minor * n.quantity), 0)
      INTO counted
      FROM cash_count_note n
     WHERE n.count_id = COALESCE(NEW.count_id, OLD.count_id);

    IF counted <> 0 AND counted <> target THEN
        RAISE EXCEPTION
            'the breakdown adds up to % and the count says %',
            counted, target
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- DEFERRED, unlike 0213's: the rows arrive one denomination at a time, so a
-- breakdown is only ever whole at the end of the transaction that writes it.
CREATE CONSTRAINT TRIGGER cash_count_breakdown_adds_up
    AFTER INSERT OR UPDATE OR DELETE ON cash_count_note
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION cash_count_breakdown_adds_up();

CREATE INDEX ix_cash_count_place ON cash_count (account_code, site_id, counted_on DESC);

COMMENT ON TABLE cash_count IS
    'One physical count of one drawer on one day. The difference between '
    'counted_minor and per_books_minor is never stored: it is the subtraction, '
    'and a stored copy would be a second answer.';
