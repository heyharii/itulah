-- 0609: the work Finance does against a book is done for a unit.
--
-- The last of the step that moves the books from sites to units (0605-0608).
-- These are not documents a shop writes; they are Finance's own work lists
-- and instruments, each of which exists to act on one unit's books:
--
--   * `tender_reconciliation` — Finance proving a store's takings for a day
--     against what the acquirer paid. The money is the store's (the unit's);
--     the sales it reads stay at the shop where they were rung up, and are
--     gathered by `unit_of_site`, each dated by its own shop's clock. A store
--     with one shop — every store today — reconciles exactly what it did.
--     The route that opens one (`/finance/store/{unit}/tender-recon/…`) names
--     the unit.
--   * `correction_document` — a reclass, adjustment or write-off a second
--     person signs (0129). `site_id` is the book it corrects and
--     `target_site_id` the book a reclass moves to; both are units.
--   * `defer_schedule` — a prepayment spread over months (0306): the prepaid
--     sits in one book and is released there.
--   * `bank_rule` and `bank_rule_proposal` — how a line on a statement is
--     read (0116). A statement is of a unit's bank account since 0605, so the
--     meaning a rule proposes resolves in that unit. The rule's default book
--     was the literal `'dc'`; it is head office's unit, asked by its kind.
--   * `payment_batch` — head office paying many parties from one bank
--     account (0153): the account is a unit's, so the batch is.
--
-- What stays at a site is said in 0608's header, and why.

CREATE OR REPLACE FUNCTION pg_temp.move_column_to_unit(p_table regclass, p_from text, p_to text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    col  smallint;
    con  record;
    idx  record;
BEGIN
    SELECT attnum INTO col
      FROM pg_attribute
     WHERE attrelid = p_table AND attname = p_from AND NOT attisdropped;
    IF col IS NULL THEN
        RAISE EXCEPTION '%.% was expected and is not there', p_table, p_from;
    END IF;
    FOR con IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = p_table AND contype = 'f'
           AND confrelid = 'site'::regclass AND conkey = ARRAY[col]
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_table, con.conname);
    END LOOP;
    EXECUTE format('ALTER TABLE %s RENAME COLUMN %I TO %I', p_table, p_from, p_to);
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER', p_table);
    EXECUTE format(
        'UPDATE %s AS x SET %I = s.unit_id FROM site s '
        'WHERE s.id = x.%I AND s.unit_id IS DISTINCT FROM x.%I',
        p_table, p_to, p_to, p_to);
    EXECUTE format('ALTER TABLE %s ENABLE TRIGGER USER', p_table);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES unit (id)',
                   p_table, left(p_table::text || '_' || p_to || '_fkey', 63), p_to);
    FOR idx IN
        SELECT i.relname AS name
          FROM pg_index x
          JOIN pg_class i ON i.oid = x.indexrelid
         WHERE x.indrelid = p_table
           AND col = ANY (x.indkey::smallint[])
           AND i.relname LIKE '%site%'
    LOOP
        EXECUTE format('ALTER INDEX %I RENAME TO %I', idx.name, replace(idx.name, 'site', 'unit'));
    END LOOP;
END
$$;

-- A store with two shops would have had two reconciliations of one kind on
-- one day; as one unit they would be one. Refused rather than merged.
DO $$
DECLARE
    doubled text;
BEGIN
    SELECT string_agg(format('%s %s %s', s.unit_id, r.business_date, r.tender_kind), '; ')
      INTO doubled
      FROM tender_reconciliation r
      JOIN site s ON s.id = r.site_id
     GROUP BY s.unit_id, r.business_date, r.tender_kind, COALESCE(r.terminal_id, '')
    HAVING count(*) > 1;
    IF doubled IS NOT NULL THEN
        RAISE EXCEPTION
            '0609: two shops of one unit reconciled the same tender on the same day: %; merge them by hand first',
            doubled;
    END IF;
END
$$;

SELECT pg_temp.move_column_to_unit('tender_reconciliation', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('correction_document', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('correction_document', 'target_site_id', 'target_unit_id');
SELECT pg_temp.move_column_to_unit('defer_schedule', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('bank_rule', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('bank_rule_proposal', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('payment_batch', 'site_id', 'unit_id');

-- A rule that names no book reads head office's statements, found by kind.
ALTER TABLE bank_rule ALTER COLUMN unit_id SET DEFAULT head_office_unit_id();

COMMENT ON COLUMN tender_reconciliation.unit_id IS
    'Whose takings are being proved (0609). The sales are read from every shop of the unit, each dated by its own site''s clock.';
COMMENT ON COLUMN correction_document.unit_id IS
    'The book the correction is in (0609).';
COMMENT ON COLUMN correction_document.target_unit_id IS
    'On a reclass, the book the balance moves to (0609). The poster adds the affiliate legs.';
COMMENT ON COLUMN defer_schedule.unit_id IS
    'The book the prepayment sits in and is released from (0609).';
COMMENT ON COLUMN bank_rule.unit_id IS
    'The book whose statements the rule reads (0609). Head office''s by default, found by its kind.';
COMMENT ON COLUMN payment_batch.unit_id IS
    'The book whose bank account pays the batch (0609).';
