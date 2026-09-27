-- 0379: the profit and loss reads like the client's.
--
-- Owner decision, 25 Sep 2026. The client's P&L (Central Fashion Store) is
-- layered, and every layer is a subtotal somebody reads:
--
--   PENJUALAN (4xxx, net of the 4011 discount/return group)  = Penjualan bersih
--   BEBAN POKOK PENJUALAN (5xxx)                             = Laba kotor
--   BEBAN USAHA (6xxx)                                       = GOP
--   BEBAN USAHA LAINNYA (7xxx)                               = NOP
--   PENDAPATAN (BIAYA) NON OPERASI (8000, 8009)              = NPBT
--   PAJAK PENGHASILAN (8013)                                 = NPAT
--
-- 0318 gave every account a `statement_section`, but put the whole 7000 tree,
-- the non-operating 8xxx accounts AND 8015 income tax into the "other" bucket,
-- so GOP, NOP and the before/after-tax lines could not be drawn. Two new
-- sections separate them:
--
--   OTHER_OPERATING_EXPENSE  beban usaha lainnya — sewa, depresiasi &
--                            amortisasi, biaya usaha lainnya (7000 subtree)
--   INCOME_TAX               pajak penghasilan (8013 subtree)
--
-- And one reclassification, also the owner's: 8004 Potongan Pembelian follows
-- the client and sits in the non-operating block, not in cost of sales. It is
-- signed (`purchase_price_variance` resolves to it as well as
-- `purchase_discount`), so it is OTHER_NET rather than OTHER_INCOME.

ALTER TABLE ledger_account
    DROP CONSTRAINT ledger_account_statement_section_known,
    ADD CONSTRAINT ledger_account_statement_section_known
        CHECK (statement_section IN (
            'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST_OF_SALES',
            'OPERATING_EXPENSE', 'OTHER_OPERATING_EXPENSE',
            'OTHER_INCOME', 'OTHER_EXPENSE', 'OTHER_NET', 'INCOME_TAX'
        ));

-- The 7000 tree, walked by parent rather than listed: a leaf minted under
-- 7001/7006/7028 later is in the same layer as the ones seeded in 0348.
WITH RECURSIVE subtree AS (
    SELECT account_code FROM ledger_account WHERE account_code = '7000'
    UNION ALL
    SELECT child.account_code
      FROM ledger_account child
      JOIN subtree ON child.parent_code = subtree.account_code
)
UPDATE ledger_account a
   SET statement_section = 'OTHER_OPERATING_EXPENSE'
  FROM subtree
 WHERE a.account_code = subtree.account_code;

-- Pajak penghasilan: 8013 → 8014 → 8015 Current Tax Inc/Exp PPH Pasal 25.
WITH RECURSIVE subtree AS (
    SELECT account_code FROM ledger_account WHERE account_code = '8013'
    UNION ALL
    SELECT child.account_code
      FROM ledger_account child
      JOIN subtree ON child.parent_code = subtree.account_code
)
UPDATE ledger_account a
   SET statement_section = 'INCOME_TAX'
  FROM subtree
 WHERE a.account_code = subtree.account_code;

-- Potongan Pembelian is non-operating in the client's P&L.
UPDATE ledger_account
   SET statement_section = 'OTHER_NET'
 WHERE account_code = '8004';

-- Selisih pembulatan and Pendapatan (Biaya) Lain-lain are signed, but the
-- client's report reads them credit-positive (a gain is a plus).
UPDATE ledger_account
   SET normal_balance = 'C'
 WHERE account_code IN ('8003', '8008')
   AND normal_balance IS NULL;

COMMENT ON COLUMN ledger_account.statement_section IS
    'The account''s financial statement section, set independently of its COA parent. Profit and loss layers: REVENUE, COST_OF_SALES (gross profit), OPERATING_EXPENSE (GOP), OTHER_OPERATING_EXPENSE (NOP), OTHER_INCOME/OTHER_EXPENSE/OTHER_NET (non-operating, NPBT), INCOME_TAX (NPAT).';

DO $$
DECLARE
    stray text;
BEGIN
    WITH RECURSIVE subtree AS (
        SELECT account_code FROM ledger_account WHERE account_code = '7000'
        UNION ALL
        SELECT child.account_code
          FROM ledger_account child
          JOIN subtree ON child.parent_code = subtree.account_code
    )
    SELECT string_agg(a.account_code, ', ' ORDER BY a.account_code)
      INTO stray
      FROM ledger_account a
      JOIN subtree USING (account_code)
     WHERE a.is_active
       AND NOT a.is_group
       AND a.statement_section <> 'OTHER_OPERATING_EXPENSE';
    IF stray IS NOT NULL THEN
        RAISE EXCEPTION '0379: 7000 leaves outside OTHER_OPERATING_EXPENSE: %', stray;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM ledger_account
         WHERE account_code = '8015' AND statement_section = 'INCOME_TAX'
    ) THEN
        RAISE EXCEPTION '0379: 8015 must be INCOME_TAX';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM ledger_account
         WHERE account_code = '8004' AND statement_section = 'OTHER_NET'
    ) THEN
        RAISE EXCEPTION '0379: 8004 Potongan Pembelian must be OTHER_NET';
    END IF;
END;
$$;
