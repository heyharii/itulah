-- A closed month locks more than the journal.
--
-- 0051 put a trigger on `journal_entry` that refuses an INSERT whose
-- `posting_date` lands in a closed month. That is necessary and it is not
-- enough, because the journal is not the only thing a month-end statement is
-- read from.
--
-- Consider a supplier bill dated 5 September, still DRAFT when September
-- closes, posted on 2 October with `posting_date` 2 October. The journal gate
-- is satisfied — October is open — and the entry lands in October, correctly.
-- But `payables_aging` winds both sides back to its `as_of` date and reads
-- `invoice_date`, so the aged payables report AS AT 30 SEPTEMBER now shows a
-- debt it did not show yesterday. A sealed month whose own reports still move
-- is not sealed.
--
-- So the rule this migration adds is about the DOCUMENT's date, not the entry's:
-- a document dated in a closed month may not enter the books, and may not leave
-- them either. Voiding a September bill in November restates September just as
-- surely as posting one does.
--
-- # Why a callable function and not another trigger body
--
-- `assert_period_open()` is a trigger function: it can only be reached by being
-- attached to a table, and it can only look at `NEW.posting_date`. Every other
-- module that wanted the same rule had to either copy it or do without, and
-- five of them did without. `assert_period_open_for(date)` is the same rule as
-- a predicate anything can call — a trigger, a plpgsql routine, or a query. The
-- old trigger function is rewritten to call it, so there is one message and one
-- locking discipline rather than two that agree until somebody edits one.
--
-- # Why FOR SHARE survives the refactor
--
-- 0051's comment is the load-bearing part and it moves down with the code: the
-- period row is taken FOR SHARE, so a close running at the same instant either
-- waits for this document or makes this document wait for it. Without the lock
-- there is an interleaving where the month closes and a late document slips in
-- behind it, and it is exactly the interleaving that never happens in testing.

-- ---------------------------------------------------------------------------
-- The predicate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assert_period_open_for(on_date date, what text DEFAULT NULL)
RETURNS void AS $$
DECLARE
    y     smallint := EXTRACT(YEAR FROM on_date)::smallint;
    m     smallint := EXTRACT(MONTH FROM on_date)::smallint;
    state text;
    tail  text := COALESCE(' — ' || what, '');
BEGIN
    IF on_date IS NULL THEN
        RAISE EXCEPTION 'a document with no date cannot be placed in an accounting period%', tail;
    END IF;
    -- FOR SHARE, not a plain read. See the header.
    SELECT status INTO state FROM fiscal_period
        WHERE year = y AND month = m FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'no accounting period exists for %-%; open it before posting%',
            y, lpad(m::text, 2, '0'), tail;
    END IF;
    IF state = 'CLOSED' THEN
        RAISE EXCEPTION 'accounting period %-% is closed%',
            y, lpad(m::text, 2, '0'), tail;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assert_period_open_for(date, text) IS
    'Raises unless the accounting month containing the date is open. The one place that rule is written; call it from any trigger that guards a dated document.';

-- The journal's own gate, now one line of it.
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger AS $$
BEGIN
    PERFORM assert_period_open_for(NEW.posting_date, NULL);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- The generic document lock
-- ---------------------------------------------------------------------------
--
-- One trigger function for every dated document, told at attachment time which
-- column carries the date, which carries the state, and which states mean "in
-- the books". A function per table would be eight copies of one rule.
--
-- It reads the row through `to_jsonb` rather than dynamic SQL. The alternative
-- — `EXECUTE format('SELECT ($1).%I', column) USING NEW` — is a plan cached per
-- table and a quoting mistake waiting to happen; this is one conversion and two
-- key lookups, and it cannot be made to execute anything.
--
-- It fires on ENTERING and on LEAVING a posted state, which is the asymmetry
-- worth naming: posting a September bill in a closed September is obviously
-- wrong, and un-posting one is exactly as wrong and far easier to do by
-- accident.

CREATE OR REPLACE FUNCTION assert_period_open_on_document() RETURNS trigger AS $$
DECLARE
    date_column   text   := TG_ARGV[0];
    status_column text   := TG_ARGV[1];
    posted_states text[] := TG_ARGV[2:];
    new_row  jsonb := to_jsonb(NEW);
    old_row  jsonb;
    on_date  date;
    new_state text;
    old_state text;
BEGIN
    on_date := (new_row ->> date_column)::date;
    -- No date, nothing to place in a month. An asset that has not been disposed
    -- of has a null `disposed_on`, and every ordinary edit to it arrives here.
    IF on_date IS NULL THEN
        RETURN NEW;
    END IF;

    new_state := new_row ->> status_column;

    IF TG_OP = 'UPDATE' THEN
        old_row := to_jsonb(OLD);
        old_state := old_row ->> status_column;
        -- The state did not move, so the document did not enter or leave the
        -- books. Correcting a note on a posted bill is not a posting.
        IF new_state IS NOT DISTINCT FROM old_state THEN
            RETURN NEW;
        END IF;
        IF NOT (new_state = ANY (posted_states) OR old_state = ANY (posted_states)) THEN
            RETURN NEW;
        END IF;
    ELSE
        IF NOT (new_state = ANY (posted_states)) THEN
            RETURN NEW;
        END IF;
    END IF;

    PERFORM assert_period_open_for(
        on_date,
        format('%s dated %s cannot become %s', TG_TABLE_NAME, on_date, new_state));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assert_period_open_on_document() IS
    'Generic period lock for a dated document. Arguments: date column, status column, then every state that means "in the books".';

-- ---------------------------------------------------------------------------
-- The documents that exist today
-- ---------------------------------------------------------------------------

CREATE TRIGGER supplier_invoice_period_lock
    BEFORE INSERT OR UPDATE ON supplier_invoice
    FOR EACH ROW EXECUTE FUNCTION
        assert_period_open_on_document('invoice_date', 'status', 'POSTED', 'VOID');

CREATE TRIGGER supplier_payment_period_lock
    BEFORE INSERT OR UPDATE ON supplier_payment
    FOR EACH ROW EXECUTE FUNCTION
        assert_period_open_on_document('payment_date', 'status', 'POSTED');

-- Disposal is the fixed-asset event that moves money, and `disposed_on` is the
-- date it moves at. Registration, assessment and transfer leave `disposed_on`
-- null and are waved through by the null check above.
CREATE TRIGGER fixed_asset_period_lock
    BEFORE INSERT OR UPDATE ON fixed_asset
    FOR EACH ROW EXECUTE FUNCTION
        assert_period_open_on_document('disposed_on', 'status', 'DISPOSED');

-- A depreciation charge names its own month, so it needs no state machine: the
-- month IS the period, and charging a closed one is the mistake.
CREATE OR REPLACE FUNCTION assert_period_open_on_depreciation() RETURNS trigger AS $$
BEGIN
    PERFORM assert_period_open_for(
        NEW.period_month,
        format('depreciation for asset %s', NEW.asset_id));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_depreciation_period_lock
    BEFORE INSERT ON asset_depreciation_entry
    FOR EACH ROW EXECUTE FUNCTION assert_period_open_on_depreciation();

-- ---------------------------------------------------------------------------
-- How a table opts in later
-- ---------------------------------------------------------------------------
--
-- Several money documents are being built in parallel with this migration and
-- do not exist yet. Rather than leave their period gate to be remembered, this
-- is the one call that adds it:
--
--     SELECT attach_period_lock('cash_document',
--                               ARRAY['document_date'], 'status',
--                               ARRAY['POSTED']);
--
-- It is a no-op when the table or the columns are absent, so the DO block below
-- can offer it to every table on the list and attach it to the ones that have
-- landed. A lane whose date column is named something else drops the trigger
-- and calls this again with its own column.

CREATE OR REPLACE FUNCTION attach_period_lock(
    target_table   text,
    date_columns   text[],
    status_column  text DEFAULT 'status',
    posted_states  text[] DEFAULT ARRAY['POSTED']
) RETURNS text AS $$
DECLARE
    chosen_date text;
    candidate   text;
    trigger_name text := target_table || '_period_lock';
BEGIN
    IF to_regclass(quote_ident(target_table)) IS NULL THEN
        RETURN format('%s: no such table yet', target_table);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = target_table AND column_name = status_column) THEN
        RETURN format('%s: no %I column', target_table, status_column);
    END IF;

    FOREACH candidate IN ARRAY date_columns LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = target_table AND column_name = candidate) THEN
            chosen_date := candidate;
            EXIT;
        END IF;
    END LOOP;
    IF chosen_date IS NULL THEN
        RETURN format('%s: none of %s exists', target_table, date_columns);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgname = trigger_name AND NOT tgisinternal
                  AND tgrelid = to_regclass(quote_ident(target_table))) THEN
        RETURN format('%s: already locked', target_table);
    END IF;

    EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW
           EXECUTE FUNCTION assert_period_open_on_document(%L, %L, %s)',
        trigger_name, target_table, chosen_date, status_column,
        (SELECT string_agg(quote_literal(s), ', ') FROM unnest(posted_states) s));
    RETURN format('%s: locked on %I', target_table, chosen_date);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION attach_period_lock(text, text[], text, text[]) IS
    'Attach the period lock to a dated document table, if it exists. Safe to call for a table another lane has not written yet.';

-- The money documents on the roadmap, offered the lock. Each returns a note
-- saying whether it took it; a table that has not landed yet says so and the
-- migration carries on.
DO $$
DECLARE
    candidate text;
    dates text[] := ARRAY[
        'document_date', 'posting_date', 'business_date', 'value_date',
        'settlement_date', 'deposit_date', 'expense_date', 'issued_on',
        'instructed_on', 'advanced_on', 'occurred_on'];
    note text;
BEGIN
    FOREACH candidate IN ARRAY ARRAY[
        'cash_document', 'store_deposit', 'remittance_instruction',
        'operating_advance', 'store_expense', 'sales_posting',
        'acquirer_settlement', 'giro'
    ] LOOP
        note := attach_period_lock(candidate, dates, 'status', ARRAY['POSTED']);
        RAISE NOTICE 'period lock: %', note;
    END LOOP;
END;
$$;
