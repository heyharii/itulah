-- 0376: the finance hard rules land in the backend.
--
-- Owner decisions, 25 Sep 2026 (FINANCE-CONNECT-BRIEF.md and the review that
-- followed). Four rules the schema did not enforce yet:
--
--   1. A supplier, a service vendor, a bank, a tax office, BPJS and a lender
--      face head office and nobody else. A shop holds cash on hand (1002),
--      petty cash (1003) and its till float (1004); everything else it owes,
--      it owes to head office through the affiliate accounts. Before this
--      migration a supply bill or a goods receipt could open 2002/2004 in a
--      shop's own books, and nothing refused it.
--   2. Modal Kasir (1004) is the till float: it is a control count, never a
--      way to pay for anything.
--   3. BPJS is not salary. It gets its own meaning and its own account, so a
--      payroll run can never quietly fold it into 2017 Biaya Gaji dan Upah
--      YMHD. The account it lands on is still marked TO_CONFIRM at the map.
--   4. Bank charges and bank interest are two events, never one entry. This
--      migration only writes the sentence down; the meanings were already
--      separate (`bank_admin_fee` -> 6043, `interest_income` -> 8002).
--
-- What it does NOT do: it does not re-route the writers. A goods receipt that
-- opens a supplier payable in a shop is now REFUSED rather than re-homed
-- silently, which is the point of a guard. The writers follow in the same
-- change set where they are wrong.

-- ---------------------------------------------------------------------------
-- 1. External parties belong to head office
-- ---------------------------------------------------------------------------

-- The registry is the rule. A new external obligation is one row here; the
-- trigger and the review both read it, so the list cannot drift between the
-- database guard and the document that explains it.
CREATE TABLE external_party_account (
    account_code text PRIMARY KEY REFERENCES ledger_account (account_code),
    kind         text NOT NULL CHECK (kind IN
                     ('SUPPLIER', 'SERVICE', 'BANK', 'TAX', 'BPJS', 'LENDER', 'OTHER')),
    note         text NOT NULL,
    set_by       text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE external_party_account IS
    'Accounts whose only accounting counterparty is head office. A journal line on one of these may only sit at dc; a shop reaches the same economic result through the affiliate accounts (1057/1058/1059 and 2028/2029). Read by the trigger below and shown on the Finance account map.';

-- The unambiguous set today. Tax payable (2011-2015) and BPJS (2021) are
-- deliberately NOT here yet: a store payroll run still credits them in place,
-- and making them head-office-only is a writer change (route the withholding
-- to dc and let the balancer add the affiliate leg). They are TO_CONFIRM in
-- the brief and arrive with that writer change.
INSERT INTO external_party_account (account_code, kind, note, set_by) VALUES
    ('2002', 'SUPPLIER', 'Hutang Suppliers Barang Dagangan — supplier faces HO',  'migration:0376'),
    ('2004', 'SERVICE',  'Hutang Supplier Non Barang Dagang — vendor jasa faces HO', 'migration:0376'),
    ('2005', 'BANK',     'Outstanding Giro Bank BCA — our bank, HO only',         'migration:0376'),
    ('2006', 'BANK',     'Outstanding Giro Bank Mandiri',                         'migration:0376'),
    ('2007', 'BANK',     'Outstanding Giro Bank BRI',                             'migration:0376'),
    ('2008', 'BANK',     'Outstanding Giro Bank BNI',                             'migration:0376'),
    ('2009', 'BANK',     'Outstanding Giro Bank Danamon',                         'migration:0376'),
    ('2030', 'LENDER',   'Hutang Lain-lain Principal — owner funding',            'migration:0376'),
    ('2035', 'LENDER',   'Pinjaman Jangka Panjang Jatuh Tempo Principal',         'migration:0376'),
    ('2036', 'LENDER',   'Pinjaman Jangka Panjang Jatuh Tempo Bank BCA',          'migration:0376'),
    ('2037', 'LENDER',   'Pinjaman Jangka Panjang Jatuh Tempo Bank Mandiri',      'migration:0376'),
    ('2038', 'LENDER',   'Pinjaman Jangka Panjang Jatuh Tempo Bank BRI',          'migration:0376'),
    ('2039', 'LENDER',   'Pinjaman Jangka Panjang Jatuh Tempo Bank BNI',          'migration:0376'),
    ('2040', 'LENDER',   'Pinjaman Jangka Panjang Jatuh Tempo Bank Danamon',      'migration:0376'),
    ('2043', 'LENDER',   'Pinjaman Jangka Panjang Principal',                     'migration:0376'),
    ('2044', 'LENDER',   'Pinjaman Jangka Panjang Bank BCA',                      'migration:0376'),
    ('2045', 'LENDER',   'Pinjaman Jangka Panjang Bank Mandiri',                  'migration:0376'),
    ('2046', 'LENDER',   'Pinjaman Jangka Panjang Bank BRI',                      'migration:0376'),
    ('2047', 'LENDER',   'Pinjaman Jangka Panjang Bank BNI',                      'migration:0376'),
    ('2048', 'LENDER',   'Pinjaman Jangka Panjang Bank Danamon',                  'migration:0376')
ON CONFLICT (account_code) DO NOTHING;

-- The app guard already knows the sentence for `dimension = 'company'`
-- (ledger.rs: "belongs to the company and not to a shop"). Reusing it gives a
-- good refusal at the API with no new code; the trigger below is the second
-- lock for anything that reaches journal_line without going through the poster.
UPDATE ledger_account a
   SET dimension = 'company'
  FROM external_party_account e
 WHERE e.account_code = a.account_code
   AND a.dimension IS DISTINCT FROM 'company';

-- The database guard. A line on an external-party account at a shop is the
-- leak the review found; this refuses it where it is written, whoever writes.
-- OPENING is exempt for the same reason 0300 exempts it: opening balances are
-- history arriving, and a shop's historical supplier balance is a fact the
-- migration that carries history has to be able to state.
CREATE OR REPLACE FUNCTION journal_line_external_party_is_head_office()
RETURNS trigger AS $$
DECLARE
    party_kind text;
    kind_of_entry text;
BEGIN
    SELECT kind INTO party_kind
      FROM external_party_account
     WHERE account_code = NEW.account_code;

    IF party_kind IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.site_id = 'dc' THEN
        RETURN NEW;
    END IF;

    SELECT source_kind INTO kind_of_entry
      FROM journal_entry WHERE entry_id = NEW.entry_id;

    IF kind_of_entry = 'OPENING' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'account % is an external-party % account; it is head office''s alone and cannot sit at shop %. The shop reaches the same result through an affiliate account (1057/1058/1059 or 2028/2029).',
        NEW.account_code, party_kind, NEW.site_id
        USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_line_external_party_is_head_office
    BEFORE INSERT OR UPDATE ON journal_line
    FOR EACH ROW EXECUTE FUNCTION journal_line_external_party_is_head_office();

-- ---------------------------------------------------------------------------
-- 2. Modal Kasir (1004) pays for nothing
-- ---------------------------------------------------------------------------

-- The till float is counted, funded and reconciled; it is never a payment
-- account. A set of ALLOW rows means "these and nothing else" (0261), so no
-- writer or person can move it with an expense, a payment or a salary.
-- `account_source_rule` has a unique INDEX on (account_code, source_kind,
-- COALESCE(category_code, uniform)), not a plain key, so `ON CONFLICT` cannot
-- infer it. The guard is written out instead.
INSERT INTO account_source_rule (account_code, source_kind, effect, set_by, note)
SELECT v.account_code, v.source_kind, 'ALLOW', 'migration:0376', v.note
  FROM (VALUES
    ('1004', 'CASH_SHIFT', 'Modal Kasir moves only when the till float is set up or changed at a shift boundary.'),
    ('1004', 'OPENING',    'Opening balances are history arriving.')
  ) AS v (account_code, source_kind, note)
 WHERE NOT EXISTS (
     SELECT 1 FROM account_source_rule r
      WHERE r.account_code = v.account_code
        AND r.source_kind = v.source_kind
        AND COALESCE(r.category_code, '') = ''
 );

-- ---------------------------------------------------------------------------
-- 3. BPJS is its own meaning, and it is not salary
-- ---------------------------------------------------------------------------

-- 0371 mapped payroll but left `bpjs_payable` unmapped, so a BPJS deduction
-- fell through `deduction_meaning` to `payroll_payable` (2017) silently. That
-- is exactly the "Cr 2017 including BPJS" the owner rejected. The meaning now
-- resolves everywhere; which account is still TO_CONFIRM, and the map note
-- says so rather than pretending the question is closed.
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT 'bpjs_payable', s.id, '', '2021', NULL, 'migration:0376',
       'TO_CONFIRM: BPJS withheld and employer contribution. Owner listed BPJS as an external party owed through HO; the account (2021 Biaya Asuransi dan BPJS YMHD) is canonical until the client accountant confirms.'
  FROM site s
ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE
    SET account_code = EXCLUDED.account_code, category_code = NULL,
        set_by = EXCLUDED.set_by, set_at = now(), note = EXCLUDED.note;

DO $$
DECLARE
    bad bigint;
BEGIN
    SELECT count(*) INTO bad
      FROM account_map m
      JOIN ledger_account a USING (account_code)
     WHERE m.set_by = 'migration:0376'
       AND (NOT a.is_active OR a.is_group);
    IF bad <> 0 THEN
        RAISE EXCEPTION '0376 installed % mappings that do not resolve to active leaves', bad;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Bank charge and bank interest are two events (documentation only)
-- ---------------------------------------------------------------------------

-- `bank_admin_fee` -> 6043 Biaya Bank HO is an expense: Dr 6043 / Cr Bank.
-- `interest_income` -> 8002 Pendapatan Bunga Bank is income: Dr Bank / Cr 8002.
-- They are separate meanings and separate rules; the old one-line example
-- "Dr 6043 / Cr 8002" described one entry where there are two and is not a
-- posting any writer makes.
COMMENT ON TABLE external_party_account IS
    'Accounts whose only accounting counterparty is head office. A journal line on one of these may only sit at dc; a shop reaches the same economic result through the affiliate accounts (1057/1058/1059 and 2028/2029). Read by the trigger journal_line_external_party_is_head_office and shown on the Finance account map. Bank charges (6043) and bank interest (8002) are not in here: they are HO-only in practice but reached only by a bank rule, and one is an expense and the other income.';
