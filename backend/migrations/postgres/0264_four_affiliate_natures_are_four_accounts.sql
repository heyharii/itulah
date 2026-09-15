-- Four affiliate natures are four accounts, not one netted current account.
--
-- # What was collapsed, and where
--
-- The client's export carries SIX affiliate families, each with 14 unit rows and
-- 196 pair leaves:
--
--     1021401  PIUTANG  AFFILIASI PEMBIAYAAN     receivable, financing
--     1021402  PIUTANG  AFFILIASI ATAS BARANG    receivable, goods
--     1021403  PIUTANG AFFILIASI LAIN-LAIN       receivable, other
--     2012301  HUTANG AFFILIASI PEMBIAYAAN       payable, financing
--     2012302  HUTANG AFFILIASI ATAS BARANG      payable, goods
--     2012304  HUTANG LAIN - LAIN                payable, other
--
-- 0243 designed all six away. Under a new group `10214 Rekening Antar-Unit` it
-- created exactly one posting account — line 202 of that file:
--
--     ('1021401001', 'Rekening Koran Antar-Unit', 'Inter-unit current account',
--      '10214', false, 'unit', true, 'D', false)
--
-- One bidirectional current account, `dimension = 'unit'`,
-- `requires_counter_site = true`. Taking the UNIT out of the code was right and
-- is what `site_id` and `counter_site_id` are for. Taking the NATURE and the
-- DIRECTION out with it was not: financing and goods are different economic
-- events, they reconcile against different things, and a receivable is not a
-- payable with a sign.
--
-- 0253 then made it worse in a way that is easy to miss. The owner ruled that the
-- client's own words must be kept, so it renamed the survivor back —
--
--     1021401001  Piutang Affiliasi Pembiayaan HEAD OFFICE   was Rekening Koran Antar-Unit
--
-- — which restored the client's WORDS without restoring the client's
-- DISTINCTIONS. The account now reads as one nature at one unit while carrying
-- every nature in both directions.
--
-- # The consequence is not theoretical
--
-- `seed-finance.py::seed_affiliate_map` maps the pairs the estate actually uses
-- out of the client's CSV, across four families. Four of those families have no
-- row in `ledger_account`, so those mappings cannot be written at all — the
-- foreign key refuses them. `postgres::interunit` reads `account_map` for
-- `affiliate_receivable` and `affiliate_payable` with the nature in the
-- qualifier; with one account behind every key, the matrix it builds cannot tell
-- financing from goods.
--
-- # The smallest correction
--
-- One posting account per nature per direction, at the client's own codes, with
-- the unit still on the LINE. No per-unit leaves: `…001` here is the family's
-- account, not head office's copy of it. That is four accounts and the four
-- groups they hang under.
--
-- `2012304 HUTANG LAIN - LAIN` is deliberately not included: it is the client's
-- general other-payable and the workbook files it as `2105009 Hutang Lain-lain`
-- rather than as an affiliate family. It needs its own decision.
--
-- One thing left for the owner: `1021401001` keeps the name 0253 gave it,
-- including the ` HEAD OFFICE` suffix, which is now wrong — the account serves
-- every unit. Renaming it is a change to a name the owner blessed, so it is
-- reported rather than done. The four added here carry the family's name with no
-- unit in it, which is the shape the other four should end up in.

-- ---------------------------------------------------------------------------
-- First: the constraint that made the collapse structural
-- ---------------------------------------------------------------------------
--
-- 0244 did not merely leave the four families out; it wrote the survivors into a
-- CHECK by hand:
--
--     ADD CONSTRAINT ledger_account_counterparty_is_rare
--         CHECK (requires_counterparty = false
--                OR account_code IN ('1011203001', '1011204001', '1021401001'));
--
-- Three literal codes. So the inserts below are refused by the database until it
-- is widened — which is the right way round: the constraint is doing its job,
-- and the list was simply written when there was one affiliate account.
--
-- Widened rather than dropped. The property is worth keeping: an account that
-- demands a counter unit is unusual, and a typo on any other account would
-- otherwise start silently requiring one. A hand-written code list is a poor way
-- to say "unusual" — the repository has already been bitten by restated lists
-- (see 0257) — but replacing it with a better rule is a bigger change than this
-- correction needs, and the list is at least visible.
--
-- The column is `requires_counter_site` since 0262; PostgreSQL rewrote the
-- constraint's own text when the column was renamed, so this drops it by name.
ALTER TABLE ledger_account DROP CONSTRAINT ledger_account_counterparty_is_rare;
ALTER TABLE ledger_account
    ADD CONSTRAINT ledger_account_counterparty_is_rare
        CHECK (
            requires_counter_site = false
            OR account_code IN (
                -- goods in transit, both directions (unchanged)
                '1011203001', '1011204001',
                -- the four affiliate natures, two directions each
                '1021401001', '1021402001', '1021403001',
                '2012301001', '2012302001'
            )
        );

COMMENT ON CONSTRAINT ledger_account_counterparty_is_rare ON ledger_account IS
    'Only these seven accounts may demand a counter unit: goods in transit both ways, and the four affiliate natures across two directions. Anything else asking for one is a mistake, not a policy.';

INSERT INTO ledger_account
    (account_code, name, name_en, parent_code, is_group, dimension,
     requires_counter_site, normal_balance, is_contra)
VALUES
    ('1021402',    'Piutang Affiliasi Atas Barang', 'Affiliate receivable — goods',
                   '10214',   true,  NULL,   false, NULL, false),
    ('1021402001', 'Piutang Affiliasi Atas Barang', 'Affiliate receivable — goods',
                   '1021402', false, 'unit', true,  'D',  false),
    ('1021403',    'Piutang Affiliasi Lain-lain',   'Affiliate receivable — other',
                   '10214',   true,  NULL,   false, NULL, false),
    ('1021403001', 'Piutang Affiliasi Lain-lain',   'Affiliate receivable — other',
                   '1021403', false, 'unit', true,  'D',  false),
    ('2012301',    'Hutang Affiliasi Pembiayaan',   'Affiliate payable — financing',
                   '20123',   true,  NULL,   false, NULL, false),
    ('2012301001', 'Hutang Affiliasi Pembiayaan',   'Affiliate payable — financing',
                   '2012301', false, 'unit', true,  'C',  false),
    ('2012302',    'Hutang Affiliasi Atas Barang',  'Affiliate payable — goods',
                   '20123',   true,  NULL,   false, NULL, false),
    ('2012302001', 'Hutang Affiliasi Atas Barang',  'Affiliate payable — goods',
                   '2012302', false, 'unit', true,  'C',  false)
ON CONFLICT (account_code) DO NOTHING;
