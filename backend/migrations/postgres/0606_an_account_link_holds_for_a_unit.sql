-- 0606: an account link holds for a unit, and so does everything that names one.
--
-- 0460 made Finance's account decisions data: a link holds for ALL books, for
-- one KIND of site, or for ONE site, and `account_resolution` answers "which
-- account does this role land on at this site". Since 0605 the books are kept
-- per unit, so the question a posting asks is "at this UNIT", and a link's
-- scope says so: `ALL`, `UNIT_KIND` (HO or STORE — the unit's kind, 0600) or
-- `UNIT`. Head office's links were written for the Gudang's site (`dc`), which
-- is head office's books under another name; they become links for the unit
-- `ho`, found through `site.unit_id` and never by its spelling.
--
-- # What moves with it
--
--   * `account_link.scope_site_kind` / `scope_site_id` become
--     `scope_unit_kind` / `scope_unit_id`; `scope_type` SITE_KIND and SITE
--     become UNIT_KIND and UNIT. `account_link_history` says the same thing in
--     the same words, so a person reading who pointed what where reads one
--     vocabulary.
--   * `account_resolution` is one row per (role, source, UNIT).
--   * The affiliate links (I7) already held per kind: hutang for STORE, piutang
--     for HO. They now hold per kind of unit, which is what the rule always
--     meant — "a unit is always on hutang, head office always on piutang".
--   * `supplier_payment.site_id` and `supplier_advance.site_id` become
--     `unit_id`: the meaning a payment names (`bank_giro` BCA) resolves in the
--     books of the unit whose bank it leaves, and `assert_role_resolves` asks
--     the resolution for that unit. A payment leaves a bank account; which
--     premises the person pressing the button sat in is not a fact the books
--     keep.
--   * The client crosswalk (`ledger_account_source_code`, 0348/0381) names the
--     unit that owns each client code and the unit on the other side of an
--     affiliate row. The client's own two-digit suffix was always a unit
--     (`00` = HO); only our spelling of it was a site.
--
-- # Refused rather than folded
--
-- Two SITE links for two sites of one unit would become two UNIT links for the
-- same unit, and which one wins is a decision about the books, not a
-- migration's. Today head office has one site, so nothing collides; a database
-- where it would is stopped and told which links.

-- ---------------------------------------------------------------------------
-- 1. The scope of a link is a unit
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    doubled text;
BEGIN
    SELECT string_agg(format('%s/%s/%s at %s', l.role, l.source_type, l.source_id, s.unit_id), '; ')
      INTO doubled
      FROM account_link l
      JOIN site s ON s.id = l.scope_site_id
     WHERE l.scope_type = 'SITE'
     GROUP BY l.role, l.source_type, l.source_id, s.unit_id
    HAVING count(*) > 1;
    IF doubled IS NOT NULL THEN
        RAISE EXCEPTION
            '0606: two sites of one unit carry their own links for %; decide which one the unit keeps before running this',
            doubled;
    END IF;
END
$$;

-- The scope checks name the old words; they go, and come back in the new ones.
DO $$
DECLARE
    con record;
BEGIN
    FOR con IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'account_link'::regclass
           AND contype IN ('c', 'f')
           AND (pg_get_constraintdef(oid) LIKE '%scope_site%'
                OR pg_get_constraintdef(oid) LIKE '%SITE_KIND%')
    LOOP
        EXECUTE format('ALTER TABLE account_link DROP CONSTRAINT %I', con.conname);
    END LOOP;
END
$$;

ALTER TABLE account_link RENAME COLUMN scope_site_kind TO scope_unit_kind;
ALTER TABLE account_link RENAME COLUMN scope_site_id TO scope_unit_id;

-- A link keeps its account, its category and its note, so the history trigger
-- has nothing to record: this is the same decision in the new words.
UPDATE account_link l
   SET scope_type = CASE l.scope_type
                        WHEN 'SITE_KIND' THEN 'UNIT_KIND'
                        WHEN 'SITE'      THEN 'UNIT'
                        ELSE l.scope_type
                    END,
       scope_unit_id = CASE WHEN l.scope_type = 'SITE'
                            THEN (SELECT s.unit_id FROM site s WHERE s.id = l.scope_unit_id)
                            ELSE l.scope_unit_id
                       END
 WHERE l.scope_type IN ('SITE_KIND', 'SITE');

ALTER TABLE account_link
    ADD CONSTRAINT account_link_scope_type_check
        CHECK (scope_type IN ('ALL', 'UNIT_KIND', 'UNIT')),
    ADD CONSTRAINT account_link_scope_unit_kind_check
        CHECK (scope_unit_kind IN ('HO', 'STORE', 'ONLINE')),
    ADD CONSTRAINT account_link_scope_is_one_of_three
        CHECK (   (scope_type = 'ALL'       AND scope_unit_kind IS NULL     AND scope_unit_id IS NULL)
               OR (scope_type = 'UNIT_KIND' AND scope_unit_kind IS NOT NULL AND scope_unit_id IS NULL)
               OR (scope_type = 'UNIT'      AND scope_unit_kind IS NULL     AND scope_unit_id IS NOT NULL)),
    ADD CONSTRAINT account_link_scope_unit_id_fkey
        FOREIGN KEY (scope_unit_id) REFERENCES unit (id);

-- The history reads in the same words. `scope_key` is text (a site id, a
-- kind, or empty); a site id becomes its unit's.
UPDATE account_link_history h
   SET scope_type = CASE h.scope_type
                        WHEN 'SITE_KIND' THEN 'UNIT_KIND'
                        WHEN 'SITE'      THEN 'UNIT'
                        ELSE h.scope_type
                    END,
       scope_key = CASE WHEN h.scope_type = 'SITE'
                        THEN COALESCE((SELECT s.unit_id FROM site s WHERE s.id = h.scope_key), h.scope_key)
                        ELSE h.scope_key
                   END
 WHERE h.scope_type IN ('SITE_KIND', 'SITE');

COMMENT ON TABLE account_link IS
    'role x source x scope -> account (0460; per unit since 0606). Finance''s own decision about which account answers to a posting role. Resolved most-specific-first: UNIT, then UNIT_KIND, then ALL. Read through the account_resolution view.';
COMMENT ON COLUMN account_link.scope_unit_kind IS
    'HO, STORE or ONLINE: the kind of unit a UNIT_KIND link holds for (0606).';
COMMENT ON COLUMN account_link.scope_unit_id IS
    'The one unit a UNIT link holds for (0606).';

-- ---------------------------------------------------------------------------
-- 2. What a unit resolves to
-- ---------------------------------------------------------------------------

DROP VIEW account_resolution;

CREATE VIEW account_resolution AS
SELECT DISTINCT ON (l.role, l.source_type, l.source_id, u.id)
       l.role,
       l.source_type,
       l.source_id,
       u.id            AS unit_id,
       l.account_code,
       l.category_code,
       l.scope_type,
       l.link_id,
       l.set_by,
       l.set_at,
       l.note
  FROM account_link l
  JOIN unit u
    ON l.scope_type = 'ALL'
    OR (l.scope_type = 'UNIT_KIND' AND l.scope_unit_kind = u.kind)
    OR (l.scope_type = 'UNIT' AND l.scope_unit_id = u.id)
 ORDER BY l.role, l.source_type, l.source_id, u.id,
          CASE l.scope_type WHEN 'UNIT' THEN 0 WHEN 'UNIT_KIND' THEN 1 ELSE 2 END;

COMMENT ON VIEW account_resolution IS
    'The account each (role, source, unit) resolves to, most specific link first (0460; per unit since 0606). Read-only: decisions are written to account_link.';

-- The trigger names the column a row keeps its book in; the payment and the
-- advance keep a unit from here on (below).
CREATE OR REPLACE FUNCTION assert_role_resolves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    row_json  jsonb := to_jsonb(NEW);
    wanted    text := row_json ->> TG_ARGV[0];
    at_unit   text := row_json ->> TG_ARGV[1];
    source    text := COALESCE(row_json ->> TG_ARGV[2], '');
BEGIN
    IF wanted IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM account_resolution r
                    WHERE r.role = wanted AND r.unit_id = at_unit
                      AND r.source_type = 'COMPANY' AND r.source_id = source) THEN
        RAISE EXCEPTION 'no account is linked for % (%) in the books of %; link it on the Account Links screen first',
            wanted, NULLIF(source, ''), at_unit
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. A payment and an advance leave a unit's bank
-- ---------------------------------------------------------------------------

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

SELECT pg_temp.move_column_to_unit('supplier_payment', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('supplier_advance', 'site_id', 'unit_id');

DROP TRIGGER supplier_payment_role_resolves ON supplier_payment;
CREATE TRIGGER supplier_payment_role_resolves
    BEFORE INSERT OR UPDATE OF account_key, unit_id, account_qualifier ON supplier_payment
    FOR EACH ROW EXECUTE FUNCTION assert_role_resolves('account_key', 'unit_id', 'account_qualifier');

DROP TRIGGER supplier_advance_role_resolves ON supplier_advance;
CREATE TRIGGER supplier_advance_role_resolves
    BEFORE INSERT OR UPDATE OF account_key, unit_id, account_qualifier ON supplier_advance
    FOR EACH ROW EXECUTE FUNCTION assert_role_resolves('account_key', 'unit_id', 'account_qualifier');

CREATE OR REPLACE FUNCTION protect_posted_supplier_payment() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('POSTED', 'REVERSED') AND (
           NEW.total_minor       IS DISTINCT FROM OLD.total_minor
        OR NEW.unit_id           IS DISTINCT FROM OLD.unit_id
        OR NEW.payment_date      IS DISTINCT FROM OLD.payment_date
        OR NEW.account_key       IS DISTINCT FROM OLD.account_key
        OR NEW.account_qualifier IS DISTINCT FROM OLD.account_qualifier
        OR NEW.currency          IS DISTINCT FROM OLD.currency
        OR NEW.payment_number    IS DISTINCT FROM OLD.payment_number
        OR NEW.journal_entry_id  IS DISTINCT FROM OLD.journal_entry_id
    ) THEN
        RAISE EXCEPTION
            'payment % is posted; reverse its journal entry rather than editing what left the bank',
            OLD.payment_number;
    END IF;
    IF OLD.status = 'POSTED' AND NEW.status NOT IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION
            'payment % is posted; the only way back is a reversal', OLD.payment_number;
    END IF;
    IF OLD.status = 'REVERSED' AND NEW.status <> 'REVERSED' THEN
        RAISE EXCEPTION
            'payment % is already reversed', OLD.payment_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_posted_supplier_advance() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'POSTED' AND (
           NEW.amount_minor      IS DISTINCT FROM OLD.amount_minor
        OR NEW.unit_id           IS DISTINCT FROM OLD.unit_id
        OR NEW.supplier_id       IS DISTINCT FROM OLD.supplier_id
        OR NEW.advance_date      IS DISTINCT FROM OLD.advance_date
        OR NEW.account_key       IS DISTINCT FROM OLD.account_key
        OR NEW.account_qualifier IS DISTINCT FROM OLD.account_qualifier
        OR NEW.currency          IS DISTINCT FROM OLD.currency
        OR NEW.status            IS DISTINCT FROM OLD.status
        OR NEW.journal_entry_id  IS DISTINCT FROM OLD.journal_entry_id
    ) THEN
        RAISE EXCEPTION
            'advance % is posted; reverse its journal entry rather than editing what left the bank',
            OLD.advance_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A bill is received at a site and booked to the unit that owns it; an
-- advance is set against a bill in the same books.
CREATE OR REPLACE FUNCTION assert_advance_application_fits() RETURNS trigger AS $$
DECLARE
    adv       supplier_advance%ROWTYPE;
    bill      supplier_invoice%ROWTYPE;
    bill_unit text;
    applied   bigint;
BEGIN
    SELECT * INTO adv FROM supplier_advance
     WHERE advance_id = NEW.advance_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no supplier advance %', NEW.advance_id;
    END IF;
    IF adv.status <> 'POSTED' THEN
        RAISE EXCEPTION
            'advance % is %, not posted; money that has not left cannot be set against a bill',
            adv.advance_number, lower(adv.status);
    END IF;

    SELECT * INTO bill FROM supplier_invoice
     WHERE invoice_id = NEW.invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no supplier bill %', NEW.invoice_id;
    END IF;
    IF bill.status <> 'POSTED' THEN
        RAISE EXCEPTION
            'bill % is %, not posted; a bill that is not in the ledger is not yet owed',
            bill.invoice_number, lower(bill.status);
    END IF;
    IF bill.supplier_id <> adv.supplier_id THEN
        RAISE EXCEPTION
            'advance % was paid to % and bill % is from %; an advance answers its own supplier''s bill',
            adv.advance_number, adv.supplier_id, bill.invoice_number, bill.supplier_id;
    END IF;
    bill_unit := unit_of_site(bill.site_id);
    IF bill_unit IS DISTINCT FROM adv.unit_id THEN
        RAISE EXCEPTION
            'advance % is in the books of % and bill % is in the books of %; set a unit''s advance against that unit''s bill',
            adv.advance_number, adv.unit_id, bill.invoice_number, bill_unit;
    END IF;
    IF bill.currency <> adv.currency THEN
        RAISE EXCEPTION
            'advance % is in % and bill % is in %; there is no exchange rate in this ledger',
            adv.advance_number, adv.currency, bill.invoice_number, bill.currency;
    END IF;

    SELECT COALESCE(SUM(amount_minor), 0) INTO applied
      FROM supplier_advance_application
     WHERE advance_id = NEW.advance_id AND invoice_id <> NEW.invoice_id;

    IF applied + NEW.amount_minor > adv.amount_minor THEN
        RAISE EXCEPTION
            'advance % is % and % of it is already set against bills; % more would spend % that was never paid',
            adv.advance_number, adv.amount_minor, applied, NEW.amount_minor,
            applied + NEW.amount_minor - adv.amount_minor;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The list of giro payments nobody wrote paper for names the unit it left.
DROP VIEW giro_payment_without_paper;

CREATE VIEW giro_payment_without_paper AS
SELECT p.payment_id,
       p.payment_number,
       p.unit_id,
       p.payment_date,
       p.account_qualifier AS bank,
       p.total_minor,
       p.reference,
       p.status
  FROM supplier_payment p
 WHERE p.method = 'GIRO'
   AND p.giro_number IS NULL
   AND NOT EXISTS (SELECT 1 FROM giro g WHERE g.supplier_payment_id = p.payment_id);

COMMENT ON VIEW giro_payment_without_paper IS
    'GIRO payments with no instrument recorded — the ones booked before 0117 credited the bank directly. Not migrated automatically: which of them are still outstanding is a question for a person, not a guess.';

-- ---------------------------------------------------------------------------
-- 4. The client crosswalk names units
-- ---------------------------------------------------------------------------

SELECT pg_temp.move_column_to_unit('ledger_account_source_code', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('ledger_account_source_code', 'counter_site_id', 'counter_unit_id');

COMMENT ON TABLE ledger_account_source_code IS
    'Client posting codes crosswalk to the internal chart, with the owning unit (the client code''s two-digit suffix: 00 = HO) and, on an affiliate row, the unit on the other side (0381; units since 0606). Current-period profit is recorded as derived, not posted.';

-- ---------------------------------------------------------------------------
-- What must now be true
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM account_link WHERE scope_type NOT IN ('ALL', 'UNIT_KIND', 'UNIT')) THEN
        RAISE EXCEPTION '0606: a link still holds for a site';
    END IF;
    -- I7, read off the links: a store unit resolves every affiliate family to
    -- hutang, head office to piutang.
    IF EXISTS (SELECT 1 FROM account_resolution r
                 JOIN unit u ON u.id = r.unit_id
                WHERE r.role IN ('affiliate_payable', 'affiliate_receivable')
                  AND ((u.kind = 'HO' AND r.account_code NOT IN ('1057', '1058', '1059'))
                    OR (u.kind = 'STORE' AND r.account_code NOT IN ('2028', '2029', '2030')))) THEN
        RAISE NOTICE '0606: an affiliate link does not follow I7 (hutang at a store, piutang at head office); Finance has moved one by hand';
    END IF;
END
$$;
