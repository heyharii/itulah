-- A voucher is money the shop already took, and it needs somewhere to be owed.
--
-- Same defect as 0274's, found by the same sweep: `voucher_liability` — a
-- meaning `required_semantic_keys()` demands and the day-posting authority maps
-- `VOUCHER` tenders to — points at `2012305001 Hutang Voucher`, an account that
-- has never existed. `account_map`'s composite foreign key refuses the mapping,
-- so **every trading day containing one voucher redemption is unpostable**.
--
-- Vouchers are not hypothetical here: 0090 made `VOUCHER` the fifth payment
-- method, with its own tender table and ledger, and the till accepts them.
--
-- # Why a liability, and why its own account
--
-- A gift card was paid for when it was SOLD. The shop has been holding that money
-- since, and redeeming the card settles the holding rather than bringing money in
-- today — which is exactly why `domain::sales_posting` credits `revenue_cash` for
-- the income side and debits `voucher_liability` for the tender: the customer's
-- money arrived as cash, on an earlier day.
--
-- The client's chart has `20123 Hutang Lain-lain` with three leaves — affiliate
-- financing, affiliate goods, and principal — and no obligation to a CUSTOMER
-- anywhere. Pointing vouchers at any of those three would file money owed to a
-- shopper as money owed to a related company, and the affiliate accounts are the
-- ones 0264 had to split apart precisely because four natures had been collapsed
-- into one. So: its own leaf, under its own group, on the rung its siblings use.
--
-- Third deliberate exception to 0254, after 0265 (corporate tax) and 0274 (QRIS),
-- and made the same way: the code the estate already points at, so if the client
-- issues their own the rename is one row.
--
-- # What is NOT created here, and why
--
-- The same sweep found four more meanings pointing at accounts that do not exist.
-- None is created, because none is needed to make a trading day postable and each
-- is a question for the client rather than a gap to fill:
--
--   * `giro_outstanding` at MANDIRI, BRI, BNI and DANAMON (`2012002002`-`005`).
--     The client's export has `2012002 Outstanding Giro` with **only**
--     `2012002001 Outstanding Giro Bank BCA`. Creating four siblings would be
--     inventing four accounts; what it means today is that a giro drawn on any
--     bank but BCA cannot be posted. A client question, in
--     `docs/finance-bank-audit.md`.
--   * `cash_variance` -> `8010110008 Selisih Kas`. 0254 deleted that code and
--     remapped it onto `8010110007 Pendapatan (Biaya) Lain-Lain`, which is a real
--     home. Nothing to create: the SEED points at the deleted code, and the seed
--     is what gets corrected.
--   * `cash_in_transit` -> `1011005001 Setoran Dalam Perjalanan`, deleted by 0254
--     as invented. A deposit in transit is a real state of money — it left the
--     shop and has not reached the bank — but which account the client keeps it
--     in is theirs to say, and guessing would put takings somewhere nobody agreed.

INSERT INTO ledger_account (account_code, name, parent_code, is_group, is_active, dimension)
VALUES
    ('2012305', 'Hutang Voucher', '20123', true, true, NULL),
    -- Per unit, like every other tender balance: a voucher is redeemed at a
    -- shop, and `journal_line.site_id` is where the shop goes (0243/0244).
    ('2012305001', 'Hutang Voucher', '2012305', false, true, 'unit')
ON CONFLICT (account_code) DO NOTHING;

-- `AUTO_ONLY` / `OVERRIDE`, matching the other tender balances 0268 classified: a
-- rule raises and clears it, and an approved correction may reach it.
UPDATE ledger_account
   SET posting_mode = 'AUTO_ONLY',
       manual_je_policy = 'OVERRIDE',
       posting_policy_configured = true
 WHERE account_code = '2012305001';

DO $$
DECLARE
    unclassified bigint;
BEGIN
    SELECT COUNT(*) INTO unclassified
      FROM ledger_account
     WHERE NOT is_group AND NOT posting_policy_configured;
    IF unclassified > 0 THEN
        RAISE EXCEPTION
            'this migration left % postable account(s) without a posting policy decision', unclassified;
    END IF;
END $$;
