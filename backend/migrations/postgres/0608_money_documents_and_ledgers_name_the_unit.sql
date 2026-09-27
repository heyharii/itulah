-- 0608: money documents, sub-ledgers and finance settings name the unit.
--
-- 0605 moved the journal to units, 0606 the account links and payments, 0607
-- the store-money lane. What still named a site where it meant a book is the
-- rest of Finance's own records: the documents that move money between two
-- books, the sub-ledgers that must agree with the books line for line, and
-- the settings that say how much a book may spend. Each is decided here.
--
--   * `cash_document.from_site` / `to_site` become `from_unit` / `to_unit`.
--     A cash document names the two books money leaves and enters (0115); the
--     meanings it resolves (`from_key`, `to_key`) resolve per unit since 0606.
--   * `giro.site_id` becomes `unit_id`. A giro follows the bank account it is
--     drawn on (P14), and a bank account is a unit's since 0605.
--   * `payment_ledger_entry.site_id` becomes `unit_id`. The Payment Ledger is
--     reconciled against the books balance for balance
--     (`payment_ledger_integrity`, 0145/0460), so it is kept by the same key
--     as the books. `payment_ledger_as_of` and `payment_ledger_integrity`
--     return `unit_id`; the two views read off them are re-created.
--   * `tax_ledger_item.site_id` becomes `unit_id`. Tax is kept per unit (P16).
--   * `budget.site_id` becomes `unit_id`. A budget is a promise about a book's
--     spending, and the poster checks it against the lines of that book.
--   * `opening_balance_line.site_id` / `counter_site_id` and
--     `opening_subledger_line.site_id` become units: an opening balance is a
--     book's balance on the cutover day. `opening_stock_line` keeps its site —
--     stock is counted in a place, and its value is booked to the unit that
--     owns the place when it posts.
--
-- # What stays at a site, and why
--
-- A document that happens at a premises keeps the premises and is booked to
-- its unit when it posts (`unit_of_site`): a goods receipt, a supplier bill
-- and its expense lines, a cashier's shift, a sales day and its tenders, an
-- acquirer's settlement lines, an EDC terminal, a fixed asset and where it
-- stands, a cash count, a stock movement. Which shop took the sale is a fact
-- the books do not keep and the store cannot do without.

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

-- ---------------------------------------------------------------------------
-- 1. Cash documents
-- ---------------------------------------------------------------------------

SELECT pg_temp.move_column_to_unit('cash_document', 'from_site', 'from_unit');
SELECT pg_temp.move_column_to_unit('cash_document', 'to_site', 'to_unit');

CREATE OR REPLACE FUNCTION protect_posted_cash_document() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('POSTED', 'REVERSED') AND (
           NEW.amount_minor      IS DISTINCT FROM OLD.amount_minor
        OR NEW.kind              IS DISTINCT FROM OLD.kind
        OR NEW.number            IS DISTINCT FROM OLD.number
        OR NEW.doc_date          IS DISTINCT FROM OLD.doc_date
        OR NEW.from_key          IS DISTINCT FROM OLD.from_key
        OR NEW.from_qualifier    IS DISTINCT FROM OLD.from_qualifier
        OR NEW.from_account_code IS DISTINCT FROM OLD.from_account_code
        OR NEW.from_unit         IS DISTINCT FROM OLD.from_unit
        OR NEW.to_key            IS DISTINCT FROM OLD.to_key
        OR NEW.to_qualifier      IS DISTINCT FROM OLD.to_qualifier
        OR NEW.to_account_code   IS DISTINCT FROM OLD.to_account_code
        OR NEW.to_unit           IS DISTINCT FROM OLD.to_unit
        OR NEW.currency          IS DISTINCT FROM OLD.currency
        OR NEW.journal_entry_id  IS DISTINCT FROM OLD.journal_entry_id
    ) THEN
        RAISE EXCEPTION
            'cash document % is %; reverse it rather than editing what already moved',
            COALESCE(OLD.number, OLD.document_id::text), lower(OLD.status);
    END IF;
    IF OLD.status = 'REVERSED' AND NEW.status <> 'REVERSED' THEN
        RAISE EXCEPTION
            'cash document % is already reversed', OLD.number;
    END IF;
    IF OLD.status = 'POSTED' AND NEW.status NOT IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION
            'cash document % is posted; the only way back is a reversal', OLD.number;
    END IF;
    IF OLD.status = 'APPROVED' AND NEW.status = 'DRAFT' THEN
        RAISE EXCEPTION
            'cash document % is approved and numbered; it cannot become a draft again',
            OLD.number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN cash_document.from_unit IS
    'Whose books the money leaves (0608).';
COMMENT ON COLUMN cash_document.to_unit IS
    'Whose books the money enters (0608). The poster adds the affiliate legs when the two differ.';

-- ---------------------------------------------------------------------------
-- 2. Giro, tax and budgets
-- ---------------------------------------------------------------------------

SELECT pg_temp.move_column_to_unit('giro', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('tax_ledger_item', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('budget', 'site_id', 'unit_id');

COMMENT ON COLUMN giro.unit_id IS
    'Whose books the giro is drawn in: the unit that holds the bank account (P14, 0608).';
COMMENT ON COLUMN tax_ledger_item.unit_id IS
    'The unit whose tax this is (P16, 0608).';
COMMENT ON COLUMN budget.unit_id IS
    'The book whose spending the promise is about (0608).';

-- ---------------------------------------------------------------------------
-- 3. Opening balances
-- ---------------------------------------------------------------------------

SELECT pg_temp.move_column_to_unit('opening_balance_line', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('opening_balance_line', 'counter_site_id', 'counter_unit_id');
SELECT pg_temp.move_column_to_unit('opening_subledger_line', 'site_id', 'unit_id');

COMMENT ON COLUMN opening_balance_line.unit_id IS
    'The book this opening balance is in (0608).';
COMMENT ON COLUMN opening_balance_line.counter_unit_id IS
    'On an affiliate account, the unit on the other side (0608). Head office for a store''s line, the store for head office''s.';

-- ---------------------------------------------------------------------------
-- 4. The Payment Ledger
-- ---------------------------------------------------------------------------

-- The readings return the key they are reconciled by, so they are re-created
-- rather than replaced; the two views over them go and come back.
DROP VIEW IF EXISTS ledger_health;
DROP VIEW IF EXISTS payment_ledger_integrity_now;
DROP FUNCTION payment_ledger_integrity(date, text);
DROP FUNCTION payment_ledger_as_of(date);

SELECT pg_temp.move_column_to_unit('payment_ledger_entry', 'site_id', 'unit_id');

CREATE OR REPLACE FUNCTION protect_payment_ledger_entry() RETURNS trigger AS $$
BEGIN
    IF NEW.account_key      IS DISTINCT FROM OLD.account_key
    OR NEW.qualifier        IS DISTINCT FROM OLD.qualifier
    OR NEW.unit_id          IS DISTINCT FROM OLD.unit_id
    OR NEW.party_type       IS DISTINCT FROM OLD.party_type
    OR NEW.party_id         IS DISTINCT FROM OLD.party_id
    OR NEW.voucher_kind     IS DISTINCT FROM OLD.voucher_kind
    OR NEW.voucher_id       IS DISTINCT FROM OLD.voucher_id
    OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
    OR NEW.side             IS DISTINCT FROM OLD.side
    OR NEW.amount_minor     IS DISTINCT FROM OLD.amount_minor
    OR NEW.posting_date     IS DISTINCT FROM OLD.posting_date
    THEN
        RAISE EXCEPTION
            'payment ledger entry % is in the books already; settle it or delink it, but its amount and the account it sits on cannot be edited',
            OLD.entry_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION payment_ledger_as_of(p_as_of date)
RETURNS TABLE (
    entry_id             uuid,
    account_key          text,
    qualifier            text,
    unit_id              text,
    side                 text,
    party_type           text,
    party_id             text,
    party_name           text,
    voucher_kind         text,
    voucher_id           text,
    against_voucher_kind text,
    against_voucher_id   text,
    journal_entry_id     uuid,
    currency             char(3),
    amount_minor         bigint,
    settled_minor        bigint,
    outstanding_minor    bigint,
    due_date             date,
    posting_date         date,
    age_days             integer,
    delinked             boolean,
    created_at           timestamptz,
    created_by           text
)
LANGUAGE sql
STABLE
AS $$
    SELECT e.entry_id,
           e.account_key,
           e.qualifier,
           e.unit_id,
           e.side,
           e.party_type,
           e.party_id,
           e.party_name,
           e.voucher_kind,
           e.voucher_id,
           e.against_voucher_kind,
           e.against_voucher_id,
           e.journal_entry_id,
           e.currency,
           e.amount_minor,
           settled.amount AS settled_minor,
           CASE WHEN e.delinked AND e.delinked_on <= p_as_of THEN 0
                ELSE e.amount_minor - settled.amount
           END AS outstanding_minor,
           e.due_date,
           e.posting_date,
           (p_as_of - COALESCE(e.due_date, e.posting_date))::int AS age_days,
           (e.delinked AND e.delinked_on <= p_as_of) AS delinked,
           e.created_at,
           e.created_by
      FROM payment_ledger_entry e
      CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(s.amount_minor), 0)::bigint AS amount
            FROM payment_ledger_settlement s
           WHERE s.entry_id = e.entry_id
             AND s.posting_date <= p_as_of
             AND (NOT s.delinked OR s.delinked_on > p_as_of)
      ) settled
     WHERE e.posting_date <= p_as_of;
$$;

CREATE FUNCTION payment_ledger_integrity(p_as_of date, p_unit text DEFAULT NULL::text)
 RETURNS TABLE(account_key text, qualifier text, unit_id text, side text, account_code text,
               account_name text, open_items bigint, ledger_outstanding_minor bigint,
               gl_balance_minor bigint, difference_minor bigint)
 LANGUAGE sql
 STABLE
AS $function$
    WITH ledger AS (
        SELECT i.account_key,
               i.qualifier,
               i.unit_id,
               i.side,
               COUNT(*) FILTER (WHERE i.outstanding_minor <> 0)::bigint AS open_items,
               COALESCE(SUM(i.outstanding_minor), 0)::bigint AS outstanding_minor
          FROM payment_ledger_as_of(p_as_of) i
         WHERE p_unit IS NULL OR i.unit_id = p_unit
         GROUP BY i.account_key, i.qualifier, i.unit_id, i.side
    )
    SELECT l.account_key,
           l.qualifier,
           l.unit_id,
           l.side,
           r.account_code,
           a.name AS account_name,
           l.open_items,
           l.outstanding_minor AS ledger_outstanding_minor,
           COALESCE(gl.balance, 0)::bigint AS gl_balance_minor,
           (l.outstanding_minor - COALESCE(gl.balance, 0))::bigint AS difference_minor
      FROM ledger l
      LEFT JOIN account_resolution r
             ON r.role = l.account_key
            AND r.unit_id = l.unit_id
            AND r.source_type = 'COMPANY'
            AND r.source_id = l.qualifier
      LEFT JOIN ledger_account a ON a.account_code = r.account_code
      LEFT JOIN LATERAL (
          SELECT CASE WHEN l.side = 'RECEIVABLE'
                      THEN COALESCE(SUM(jl.debit_minor), 0) - COALESCE(SUM(jl.credit_minor), 0)
                      ELSE COALESCE(SUM(jl.credit_minor), 0) - COALESCE(SUM(jl.debit_minor), 0)
                 END AS balance
            FROM journal_line jl
            JOIN journal_entry je USING (entry_id)
           WHERE jl.account_code = r.account_code
             AND jl.unit_id = l.unit_id
             AND je.posting_date <= p_as_of
      ) gl ON true
     ORDER BY l.account_key, l.unit_id, l.qualifier;
$function$;

CREATE VIEW payment_ledger_integrity_now AS
    SELECT * FROM payment_ledger_integrity(CURRENT_DATE, NULL);

COMMENT ON VIEW payment_ledger_integrity_now IS
    'payment_ledger_integrity as at today. A row whose difference_minor is not zero is a sub-ledger and a general ledger disagreeing about the same money.';

CREATE VIEW ledger_health AS
SELECT
    'payment_ledger_vs_books'::text  AS check_kind,
    i.account_key
      || COALESCE('/' || NULLIF(i.qualifier, ''), '')
      || ' @ ' || i.unit_id          AS subject,
    i.unit_id                        AS subject_scope,
    format(
      '%s %s: sub-ledger %s, books %s, difference %s (side %s)',
      i.account_name, i.account_code,
      i.ledger_outstanding_minor, i.gl_balance_minor,
      i.difference_minor, i.side)     AS detail,
    (i.difference_minor <> 0)         AS unhealthy,
    now()                             AS checked_at
  FROM payment_ledger_integrity_now i
 WHERE i.difference_minor <> 0
 UNION ALL
SELECT
    'integrity_run'::text            AS check_kind,
    res.key                          AS subject,
    res.scope                        AS subject_scope,
    COALESCE(res.details ->> 'summary',
             format('expected %s, actual %s (difference %s)',
                    res.expected_minor, res.actual_minor, res.difference_minor))
                                     AS detail,
    true                             AS unhealthy,
    r.finished_at                    AS checked_at
  FROM integrity_run r
  JOIN integrity_result res ON res.run_id = r.run_id
 WHERE r.finished_at IS NOT NULL
   AND r.finished_at = (SELECT max(r2.finished_at)
                          FROM integrity_run r2
                         WHERE r2.finished_at IS NOT NULL)
   AND res.state <> 'BALANCED'
 UNION ALL
SELECT
    'integrity_engine'::text         AS check_kind,
    'run ' || r.run_id::text         AS subject,
    'system'                         AS subject_scope,
    r.failure                        AS detail,
    true                             AS unhealthy,
    r.finished_at                    AS checked_at
  FROM integrity_run r
 WHERE r.finished_at IS NOT NULL
   AND r.failure IS NOT NULL
   AND r.finished_at = (SELECT max(r2.finished_at)
                          FROM integrity_run r2
                         WHERE r2.finished_at IS NOT NULL
                           AND r2.failure IS NOT NULL);

COMMENT ON VIEW ledger_health IS
    'One place for every answer the books already compute about themselves: the live Payment-Ledger-vs-books differences per control account and unit (0145, 0608), and the non-balanced results — plus any engine failure — of the most recent finished integrity run (0123). Adds no checker and no table; if a check is wrong, fix the check, not this view.';

COMMENT ON COLUMN payment_ledger_entry.unit_id IS
    'The books the item sits in (0608), the key it is reconciled against the ledger by.';
