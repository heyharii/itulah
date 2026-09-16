-- QRIS is owed to us by a provider, and it needs somewhere to be owed.
--
-- # What is actually true today
--
-- Not "QRIS posts to the debit card receivable", which is what the reconciliation
-- note recorded. **QRIS cannot be posted at all.** The mapping the estate ships
-- points `qris_receivable` at `1011101003` and `revenue_qris` at `4010114001`, and
-- NEITHER ACCOUNT EXISTS: 0254 deleted `1011101003` as invented, and `4010114001`
-- was proposed and never created. `account_map` has a composite foreign key to
-- `ledger_account`, so both mappings are refused outright — which is why the
-- finance seed stops with a failure on those rows.
--
-- So a QRIS sale reaches `sales_posting`, resolves `qris_receivable`, finds no
-- mapping, and the day will not post. Every day containing one QRIS tender is
-- unpostable.
--
-- # Why a receivable and not bank or cash
--
-- Traced through the flow rather than read off the tender's name:
--
--     POS sale, method QRIS, provider recorded (GOPAY, OVO, DANA, SHOPEEPAY, BCA)
--       -> `domain::sales_posting` maps it to `qris_receivable`, qualified BY
--          PROVIDER, because the provider is who owes the money
--       -> `sales_posting_open_receivables` opens a Payment Ledger item against
--          that provider
--       -> `acquirer.rs` treats QRIS as a settlement tender: `SETTLEMENT_TENDERS`
--          is ['CARD_DEBIT', 'CARD_CREDIT', 'QRIS'], a QRIS tender is required to
--          name a terminal, and `acq_settlement_settle_ledger_items` closes the
--          item when the provider pays
--       -> the money lands in a company bank account, late and net of the fee
--
-- That is a settlement receivable in every respect a card is, and the code already
-- treats it as one in three separate modules. Posting it to Bank or Cash would
-- claim money the shop does not have until the provider sends it.
--
-- # Why a separate account, against 0254
--
-- 0254's rule is right: the client's chart is the authority, and invented codes
-- were deleted. It also recorded the cost of this particular deletion in its own
-- words — that QRIS is "no longer separable from debit card", 996 postings worth.
--
-- The separation cannot be recovered from the qualifier. A meaning plus a
-- qualifier RESOLVES to an account; the qualifier is not kept on `journal_line`.
-- So QRIS and debit card sharing `1011101002` are one balance in the ledger with
-- no way back, and acquirer reconciliation against a QRIS statement would be
-- netting against card money.
--
-- This is the second deliberate exception to 0254, after 0265 (`2012101006 Hutang
-- Pajak PPh Pasal 29`), and it is made the same way: the code and the name 0248
-- chose are reused verbatim, so if the client later issues their own code for it
-- the rename is one row rather than an archaeology.
--
-- 1011101004 Piutang Tender Lain-Lain is NOT restored. The authority refuses a
-- tender it does not recognise and offers `retender` instead, so there is no
-- unnamed-tender receivable to hold — that was `sale_day.rs`'s
-- `other_tender_clearing`, and its writer is gone (0273).

INSERT INTO ledger_account (account_code, name, parent_code, is_group, is_active, dimension)
VALUES
    -- The receivable. Under `1011101 Piutang Dagang`, beside
    -- `1011101001 Piutang Kartu Kredit` and `1011101002 Piutang Debit Card`, which
    -- is where the client keeps the other two acquirer debts.
    ('1011101003', 'Piutang QRIS', '1011101', false, true, 'unit'),
    -- The income. The client's chart has `4010110 Penjualan Tunai`,
    -- `4010111 Kartu Debit`, `4010112 Kartu Kredit` and `4010113 Online`, one
    -- group per channel, and no QRIS group at all — so the group comes with the
    -- leaf, on the same rung as its four siblings.
    ('4010114', 'Penjualan QRIS', '40101', true, true, NULL),
    ('4010114001', 'Penjualan QRIS', '4010114', false, true, 'unit')
ON CONFLICT (account_code) DO NOTHING;

-- Both are postable, and both are classified in the same change that creates
-- them: 0268's coverage gate refuses a chain where a postable account reaches a
-- migrated database with nobody having decided how it may be posted.
--
-- `AUTO_ONLY` / `OVERRIDE` for the receivable, matching `1011101001` and
-- `1011101002` exactly — a rule raises it, a settlement clears it, and an
-- approved correction may reach it. `AUTO_ONLY` / `NO` for the income, matching
-- the client's other four sales channels (0268): revenue is what the day's
-- takings say it is, never what somebody keys.
UPDATE ledger_account
   SET posting_mode = 'AUTO_ONLY',
       manual_je_policy = 'OVERRIDE',
       posting_policy_configured = true
 WHERE account_code = '1011101003';

UPDATE ledger_account
   SET posting_mode = 'AUTO_ONLY',
       manual_je_policy = 'NO',
       posting_policy_configured = true
 WHERE account_code = '4010114001';

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
