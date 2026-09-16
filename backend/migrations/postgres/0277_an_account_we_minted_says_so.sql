-- An account we minted says so, and the money in transit gets one back.
--
-- Phase 2C, accounting closure. Three things, none of which changes how a
-- single existing posting is computed.
--
-- # 1. Six accounts stand outside the client's chart and nothing says so
--
-- 0253/0254 made the rule: the client's chart is the authority, and codes we
-- invented were deleted. Three later migrations made deliberate exceptions to
-- it, each with a reason written in its own header:
--
--   1011101003  Piutang QRIS                 0274  QRIS money is owed by a
--   4010114001  Penjualan QRIS               0274  provider, and sharing the
--   4010114     (its group)                  0274  debit-card receivable makes
--                                                  acquirer reconciliation net
--                                                  two acquirers against each
--                                                  other with no way back
--   2012305001  Hutang Voucher               0275  a voucher is money already
--   2012305     (its group)                  0275  taken; without it every day
--                                                  holding a redemption is
--                                                  unpostable
--   2012101006  Hutang Pajak PPh Pasal 29    0265  corporate tax has to be owed
--                                                  somewhere
--
-- The reasons are sound and they are also invisible: `ledger_account` says
-- nothing about where a code came from, so the only way to know these six are
-- ours is to diff the whole chart against the client's export — which is what
-- `audit-chart-against-client.py` does, and why it has read FAILED ever since.
-- A permanent red audit is an audit nobody reads.
--
-- So provenance becomes a column. `CLIENT` is what 310 of the 316 rows are;
-- `PENDING_CLIENT_CODE` is a code and a name WE chose, carried deliberately,
-- awaiting the client's own. It changes no behaviour: nothing posts differently
-- and nothing is mapped differently. It makes the question answerable in SQL
-- and it lets the audit report six known exceptions instead of a failure.
--
-- Renaming one of these later is one UPDATE and one row of `ledger_account_remap`.
--
-- # 2. `cash_in_transit` has no account, and two live documents need one
--
-- 0254 deleted `1011005001 Setoran Dalam Perjalanan` as ours, and recorded the
-- cost in its own words: "Money between a drawer and a bank stops being a
-- balance." The code did not follow. Both deposit modules still post through
-- the meaning today:
--
--   store_money.rs  hand over  Dr cash_in_transit [shop]  Cr cash [shop]
--                   confirm    Dr bank [ho]               Cr cash_in_transit [shop]
--   deposits.rs     banking    Dr cash_in_transit         Cr the drawer
--                   landing    Dr the bank                Cr cash_in_transit
--
-- and `store_money.rs` reports its balance beside the drawers as
-- `cash_in_transit_minor`. `required_semantic_keys()` lists it. Four tests in
-- `store_documents_integration` assert on account 1011005001 by name.
--
-- None of that can work: the account does not exist, `account_map` has a
-- composite foreign key to `ledger_account`, and the mapping is refused
-- outright. So a shop can record a deposit and never bank it, and the estate
-- has a required meaning that cannot be satisfied in any database.
--
-- The client's chart has no account for it — searched: they have
-- `1011203`/`1011204 Barang Dalam Perjalanan` for GOODS and nothing for money.
-- This is not an account minted to satisfy a map: it is a real business event
-- (a bag that has left a drawer and not reached a bank) with a real journal
-- flow that two modules post and one screen reads. So it comes back under the
-- code and the name 0243 gave it, marked `PENDING_CLIENT_CODE` exactly like the
-- six above, and the map is written here rather than left to a seed script —
-- for the reason 0268 gave: policy a production database needs must not depend
-- on somebody remembering to run something.
--
-- Its policy matches its siblings in `10110`: a debit-normal asset, per unit
-- (the credit leg is the SHOP's), written by rules, reachable by an approved
-- correction and not by a hand-keyed journal.
--
-- # 3. Four affiliate leaves lost a word the rest of the chart keeps
--
-- 0264 created `1021402001`, `1021403001`, `2012301001` and `2012302001` with
-- the family's name and no unit token, while `1021401001` — and `1011203001`,
-- `1011204001`, `2012303001`, every other collapsed leaf in this chart — carries
-- the client's own ten-digit name, `HEAD OFFICE` included. Two spellings of one
-- idea is the thing that makes somebody ask which is right.
--
-- The rule chosen is the one already in force everywhere else: **a ten-digit
-- leaf takes the client's own name for that code, verbatim**. It is 0253's rule
-- ("do not change the WORDS") applied without an exception, it makes the four
-- agree with the one, and `Affiliasi` — their spelling, not `Afiliasi` — is
-- preserved.
--
-- The alternative was to strip `HEAD OFFICE` from all five, on the grounds that
-- our rows carry no unit. It was rejected: it would put our chart's names out of
-- step with the client's on every other collapsed leaf too, and the unit a
-- posting belongs to is on `journal_line.site_id`, where a reader already looks.
--
-- Nothing about the nature, dimension, policy or mapping of these four changes.
--
-- Idempotent throughout.

-- ---------------------------------------------------------------------------
-- 1. Provenance
-- ---------------------------------------------------------------------------

ALTER TABLE ledger_account
    ADD COLUMN IF NOT EXISTS code_provenance text NOT NULL DEFAULT 'CLIENT';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ledger_account_code_provenance_known'
    ) THEN
        ALTER TABLE ledger_account
            ADD CONSTRAINT ledger_account_code_provenance_known
            CHECK (code_provenance IN ('CLIENT', 'PENDING_CLIENT_CODE'));
    END IF;
END $$;

COMMENT ON COLUMN ledger_account.code_provenance IS
    'CLIENT: the code and the name are theirs. PENDING_CLIENT_CODE: ours, '
    'carried deliberately because the meaning is real and their chart has no '
    'slot for it, until they issue one.';

UPDATE ledger_account
   SET code_provenance = 'PENDING_CLIENT_CODE'
 WHERE account_code IN (
           '1011101003',  -- Piutang QRIS                (0274)
           '4010114',     -- Penjualan QRIS, the group    (0274)
           '4010114001',  -- Penjualan QRIS               (0274)
           '2012305',     -- Hutang Voucher, the group    (0275)
           '2012305001',  -- Hutang Voucher               (0275)
           '2012101006'   -- Hutang Pajak PPh Pasal 29    (0265)
       )
   AND code_provenance <> 'PENDING_CLIENT_CODE';

-- ---------------------------------------------------------------------------
-- 2. Money in transit
-- ---------------------------------------------------------------------------

INSERT INTO ledger_account
    (account_code, name, parent_code, is_group, is_active, code_provenance)
VALUES
    ('1011005', 'Setoran Dalam Perjalanan', '10110', true, true, 'PENDING_CLIENT_CODE')
ON CONFLICT (account_code) DO NOTHING;

INSERT INTO ledger_account
    (account_code, name, parent_code, is_group, is_active, normal_balance,
     dimension, posting_mode, manual_je_policy, posting_policy_configured,
     code_provenance)
VALUES
    ('1011005001', 'Setoran Dalam Perjalanan', '1011005', false, true, 'D',
     'unit', 'SEMI_AUTO', 'OVERRIDE', true, 'PENDING_CLIENT_CODE')
ON CONFLICT (account_code) DO NOTHING;

-- The map, for every place that keeps a drawer. Unqualified: a bag is in
-- transit to one place at a time and the unit is already on the line.
INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by, note)
SELECT 'cash_in_transit', s.id, '', '1011005001', 'migration 0277',
       'restored by 0277; awaiting the client''s own code'
  FROM site s
 WHERE NOT EXISTS (
           SELECT 1 FROM account_map m
            WHERE m.semantic_key = 'cash_in_transit' AND m.site_id = s.id AND m.qualifier = ''
       );

-- ---------------------------------------------------------------------------
-- 3. The four affiliate names
-- ---------------------------------------------------------------------------

UPDATE ledger_account SET name = 'Piutang Affiliasi Atas Barang HEAD OFFICE'
 WHERE account_code = '1021402001' AND name <> 'Piutang Affiliasi Atas Barang HEAD OFFICE';
UPDATE ledger_account SET name = 'Piutang Affiliasi Lain-lain HEAD OFFICE'
 WHERE account_code = '1021403001' AND name <> 'Piutang Affiliasi Lain-lain HEAD OFFICE';
UPDATE ledger_account SET name = 'Hutang Affiliasi Pembiayaan HEAD OFFICE'
 WHERE account_code = '2012301001' AND name <> 'Hutang Affiliasi Pembiayaan HEAD OFFICE';
UPDATE ledger_account SET name = 'Hutang Affiliasi Atas Barang HEAD OFFICE'
 WHERE account_code = '2012302001' AND name <> 'Hutang Affiliasi Atas Barang HEAD OFFICE';

-- ---------------------------------------------------------------------------
-- What this migration promises
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    marked int;
    unclassified int;
    unmapped int;
BEGIN
    SELECT count(*) INTO marked FROM ledger_account
     WHERE code_provenance = 'PENDING_CLIENT_CODE';
    IF marked <> 8 THEN
        RAISE EXCEPTION 'expected eight accounts outside the client chart, found %', marked;
    END IF;

    -- Every posting account still carries a decided policy. The one added above
    -- is configured on the way in; this is what would catch it if it were not.
    SELECT count(*) INTO unclassified FROM ledger_account
     WHERE NOT is_group AND NOT posting_policy_configured;
    IF unclassified <> 0 THEN
        RAISE EXCEPTION '% postable accounts carry no posting policy', unclassified;
    END IF;

    SELECT count(*) INTO unmapped FROM site s
     WHERE NOT EXISTS (
               SELECT 1 FROM account_map m
                WHERE m.semantic_key = 'cash_in_transit' AND m.site_id = s.id
           );
    IF unmapped <> 0 THEN
        RAISE EXCEPTION '% places still have nowhere to put money in transit', unmapped;
    END IF;
END $$;
