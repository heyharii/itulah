-- 0607: store money is kept by the unit.
--
-- The glossary (`CONTEXT.md`, "The organisation") gives a unit its store
-- money, and 0605 gave it the books. What was left keyed by premises is the
-- store-money lane of 0110-0114: where a store's takings are banked, the bag
-- that carries them, head office's standing order for the proceeds, the float
-- sent to a manager, the petty cash a shop spends and its top-ups. Every one of
-- them posts to a unit's books and answers to that unit's PIC, and none of
-- them is about which building the money was in — a store's shop is where it
-- happens, the store is whose money it is.
--
-- # Decided table by table
--
--   * `store_bank_destination` — where a store banks: the store's decision,
--     keyed by the unit (it was keyed by the site).
--   * `store_deposit` — takings on their way to a bank: the unit's.
--   * `store_remittance_default`, `remittance_order` — head office's standing
--     order for a store's proceeds, and each order: the unit's.
--   * `operating_fund` — money head office sends a manager: held for the
--     unit, drawn from a bank account in `bank_unit_id`'s books (0605 put bank
--     accounts in units).
--   * `custodian_handover` — a float changing hands: the unit's.
--   * `store_expense`, `petty_cash_replenishment` — petty cash spent and
--     topped up: the unit's.
--   * `store_ledger_shim` — the placeholder 0113 wrote before the Payment
--     Ledger existed. Nothing reads it; it is re-keyed so that nothing in the
--     schema still says a store's money is a site's.
--   * `store_document_counter` — numbering, not money. Its scopes are strings;
--     the two that carried a site (`KK:<site>`, a petty-cash voucher, and
--     `KKC:<site>`, a claim paid from petty cash) now carry the unit, so a
--     store keeps its sequence (its unit is keyed like its shop, 0600) and
--     head office's continues under its unit.
--
-- None of them keeps a `site_id` beside the unit. A store's money happens at
-- its shop, and the shop is read off the unit whenever somebody needs the
-- address; no screen, report or rule asks which premises a deposit left from.

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

-- Two keyed-by-site tables would fold two sites into one row if a unit had
-- two; that is a decision about a store's banking, not a migration's.
DO $$
DECLARE
    doubled text;
BEGIN
    SELECT string_agg(unit_id, ', ')
      INTO doubled
      FROM (SELECT s.unit_id FROM store_bank_destination d JOIN site s ON s.id = d.site_id
             GROUP BY s.unit_id HAVING count(*) > 1
            UNION
            SELECT s.unit_id FROM store_remittance_default d JOIN site s ON s.id = d.site_id
             GROUP BY s.unit_id HAVING count(*) > 1) AS twice;
    IF doubled IS NOT NULL THEN
        RAISE EXCEPTION
            '0607: two sites of unit % each have their own banking or remittance default; keep one before running this',
            doubled;
    END IF;
END
$$;

SELECT pg_temp.move_column_to_unit('store_bank_destination', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('store_deposit', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('store_remittance_default', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('remittance_order', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('operating_fund', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('operating_fund', 'bank_site_id', 'bank_unit_id');
SELECT pg_temp.move_column_to_unit('custodian_handover', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('store_expense', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('petty_cash_replenishment', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('store_ledger_shim', 'site_id', 'unit_id');

-- A petty-cash voucher (KK) and a claim payout (KKC) are numbered per unit
-- from here on. A store's scope does not change (its unit is keyed like its
-- shop); head office's moves from its Gudang's id to its unit's, and carries
-- its last number with it.
UPDATE store_document_counter c
   SET scope = p.prefix || ':' || s.unit_id
  FROM site s
 CROSS JOIN (VALUES ('KK'), ('KKC')) AS p (prefix)
 WHERE c.scope = p.prefix || ':' || s.id
   AND s.unit_id <> s.id;

-- The fund an expense is drawn on is held by the same unit that spends it.
CREATE OR REPLACE FUNCTION store_expense_allocation_is_usable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    fund_unit     text;
    fund_status   text;
    earmark       bigint;
    earmark_state text;
    already_spent bigint;
BEGIN
    IF NEW.allocation_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT f.unit_id, f.status, a.amount_minor, a.status
      INTO fund_unit, fund_status, earmark, earmark_state
      FROM fund_allocation a
      JOIN operating_fund f ON f.fund_id = a.fund_id
     WHERE a.allocation_id = NEW.allocation_id
       FOR UPDATE OF a, f;

    IF earmark IS NULL THEN
        RAISE EXCEPTION 'there is no fund allocation %', NEW.allocation_id;
    END IF;
    IF fund_status = 'CLOSED' OR earmark_state = 'CLOSED' THEN
        RAISE EXCEPTION
            'fund allocation % is closed and cannot be spent against',
            NEW.allocation_id;
    END IF;
    IF fund_unit <> NEW.unit_id THEN
        RAISE EXCEPTION
            'fund allocation % is held by % and cannot be spent by %',
            NEW.allocation_id, fund_unit, NEW.unit_id;
    END IF;

    SELECT COALESCE(SUM(e.amount_minor), 0) INTO already_spent
      FROM store_expense e
     WHERE e.allocation_id = NEW.allocation_id
       AND e.status IN ('APPROVED', 'POSTED')
       AND e.expense_id <> NEW.expense_id;

    IF NEW.status IN ('APPROVED', 'POSTED')
       AND already_spent + NEW.amount_minor > earmark THEN
        RAISE EXCEPTION
            'fund allocation % has % left; this claim of % would overdraw it',
            NEW.allocation_id, earmark - already_spent, NEW.amount_minor;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON COLUMN store_bank_destination.unit_id IS
    'The store whose takings bank here (0607; keyed by its shop before).';
COMMENT ON COLUMN store_deposit.unit_id IS
    'Whose takings these are (0607). The deposit posts to this unit''s books.';
COMMENT ON COLUMN operating_fund.unit_id IS
    'The unit the fund is held for (0607).';
COMMENT ON COLUMN operating_fund.bank_unit_id IS
    'Whose books the bank account the fund left is kept in (0607): head office''s, as a rule.';
COMMENT ON COLUMN store_expense.unit_id IS
    'The unit whose petty cash paid (0607).';
