-- A return is not a discount, and a point is a promise.
--
-- # Two accounts where 0289 had one
--
-- 0289 folded the client's `Discount / Potongan Penjualan` and `Retur
-- Penjualan` into one contra-revenue account with a category to tell them
-- apart, on the argument that both reduce sales. They do, and that is the
-- least interesting thing about either of them.
--
-- A discount is a pricing decision made while selling: the goods leave, and
-- revenue is smaller. A return is the reversal of a sale: the goods come BACK,
-- cost of goods reverses, inventory rises, and the VAT that was charged is
-- refunded — the case Phase 2B handled on its own. Different event, different
-- legs, different tax, different question for the person reading the number
-- (a rising discount rate is a promotion policy; a rising return rate is a
-- sizing or quality problem). The client keeps them as two accounts and a
-- retail profit and loss shows them on two lines. The authority that posts
-- them, `sales_posting`, already names two meanings. One account was the
-- only place they had been merged, and it was the one place it did not help.
--
-- So `4201` becomes `Potongan Penjualan` alone, `4202 Retur Penjualan` is
-- added, and `deduction_kind` retires: each account now means one thing and
-- needs no category to say which.
--
-- # An account that exists but may not yet be posted to
--
-- Member points accrue today and are redeemed nowhere; there has never been a
-- journal for them and there is nothing to post until redemption exists. But
-- when it does, the right treatment is settled — PSAK 72: a point is a
-- separate performance obligation, part of the sale that earned it is deferred
-- when the point is granted, and recognised when it is redeemed or lapses. That
-- needs a liability account, and it needs two numbers from the client that no
-- code can supply: what a point is worth, and how many are expected to lapse.
--
-- `2402 Kewajiban Poin Member` is created now and BLOCKED, the posting mode
-- 0263 defined for exactly this: nothing may move it — not a rule, not a
-- person, not an approved correction — because what may move it has not been
-- decided. An account that exists and is shut costs nothing. An account that is
-- needed and missing costs a migration and a remap on the day somebody builds
-- redemption, which is the day nobody will want to think about a chart.
-- `docs/finance-client-decisions.md` §18 carries the two numbers it waits on.

-- The retur account, before anything is moved onto it.
INSERT INTO ledger_account (account_code, name, name_en, parent_code, is_group, is_active,
                            dimension, normal_balance, is_contra, category_family,
                            requires_counter_site, posting_mode, manual_je_policy,
                            posting_policy_configured, code_provenance)
SELECT '4202', 'Retur Penjualan', 'Sales returns', '4', FALSE, TRUE,
       'unit', 'D', TRUE, NULL,
       FALSE, a.posting_mode, a.manual_je_policy, TRUE, 'PENDING_CLIENT_CODE'
  FROM ledger_account a WHERE a.account_code = '4201';

-- Then the discount account stops carrying a family, so the map rows below
-- may drop their categories without the trigger objecting.
UPDATE ledger_account
   SET name = 'Potongan Penjualan', name_en = 'Sales discounts', category_family = NULL
 WHERE account_code = '4201';

UPDATE account_map SET account_code = '4202', category_code = NULL
 WHERE semantic_key = 'sales_return';
UPDATE account_map SET category_code = NULL
 WHERE semantic_key = 'sales_discount';

UPDATE ledger_account_remap SET new_code = '4202', category_code = NULL
 WHERE legacy_code = '4010214001';
UPDATE ledger_account_remap SET category_code = NULL
 WHERE legacy_code = '4010213001';

-- Retired, not deleted: lines already posted under them keep reading back.
UPDATE line_category SET is_active = FALSE WHERE family = 'deduction_kind';

-- The promise.
INSERT INTO ledger_account (account_code, name, name_en, parent_code, is_group, is_active,
                            dimension, normal_balance, is_contra, category_family,
                            requires_counter_site, posting_mode, manual_je_policy,
                            posting_policy_configured, code_provenance)
VALUES ('2402', 'Kewajiban Poin Member', 'Member points liability', '2', FALSE, TRUE,
        'company', 'C', FALSE, NULL,
        FALSE, 'BLOCKED', 'NO', TRUE, 'PENDING_CLIENT_CODE');

DO $$
DECLARE
    live INTEGER;
BEGIN
    SELECT count(*) INTO live FROM ledger_account WHERE NOT is_group AND is_active;
    IF live <> 43 THEN RAISE EXCEPTION 'expected 43 live accounts, got %', live; END IF;

    IF EXISTS (SELECT 1 FROM account_map WHERE semantic_key = 'sales_return' AND account_code <> '4202')
    OR EXISTS (SELECT 1 FROM account_map WHERE semantic_key = 'sales_discount' AND account_code <> '4201') THEN
        RAISE EXCEPTION 'the two sales deductions are not on their own accounts';
    END IF;

    IF legacy_account_code('4202') IS DISTINCT FROM '4010214001'
    OR legacy_account_code('4201') IS DISTINCT FROM '4010213001' THEN
        RAISE EXCEPTION 'a sales deduction does not read back to the client''s account';
    END IF;

    IF (SELECT posting_mode FROM ledger_account WHERE account_code = '2402') <> 'BLOCKED' THEN
        RAISE EXCEPTION '2402 must be BLOCKED until the client supplies a point value';
    END IF;
END $$;
