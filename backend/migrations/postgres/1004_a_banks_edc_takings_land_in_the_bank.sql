-- 1004: a bank's EDC takings land in the bank, not in Piutang.
--
-- 0722 moved every digital payment method that existed on 1 Oct 2026 to
-- DIRECT_TO_BANK, and `sales_posting` honours it by debiting the EDC bank's
-- `bank_giro` account instead of `card_receivable_*`. But two later creation
-- paths still wrote VIA_RECEIVABLE:
--
--   * Finance → "Tambah bank" created that bank's DEBIT_/QRIS_ methods with
--     the old default (0468), so a newly added bank's takings went to
--     Piutang Debit Card until somebody corrected the row by hand; and
--   * `save_payment_method` used VIA_RECEIVABLE whenever the caller did not
--     name a mode, which is what the screen sends for a new method.
--
-- The machine is the fact that decides. Every active debit, credit and QRIS
-- method for a bank this company has an active EDC for now settles straight
-- into that bank. A method with no machine is left exactly as Finance set it:
-- VIA_RECEIVABLE is still a real answer for a bank that pays us later.
UPDATE payment_method p
   SET settlement_mode = 'DIRECT_TO_BANK'
 WHERE p.tender_type IN ('DEBIT_CARD', 'CREDIT_CARD', 'QRIS')
   AND p.is_active
   AND p.settlement_mode = 'VIA_RECEIVABLE'
   AND EXISTS (
       SELECT 1 FROM edc_terminal e
        WHERE e.active
          AND upper(e.bank_code) = upper(p.bank_code)
   );

-- An e-wallet is not an EDC. 0722's UPDATE swept it in with the cards, which
-- would qualify `bank_giro` by GOPAY/OVO — a provider, not one of our bank
-- accounts — and the line would refuse or land nowhere. It goes back to the
-- provider receivable until Finance maps a real settlement account for it.
UPDATE payment_method
   SET settlement_mode = 'VIA_RECEIVABLE'
 WHERE tender_type = 'EWALLET'
   AND settlement_mode = 'DIRECT_TO_BANK';

COMMENT ON COLUMN payment_method.settlement_mode IS
    'IN_DRAWER for cash; DIRECT_TO_BANK for a card or QRIS taken on our own '
    'EDC (owner, 1 Oct 2026); VIA_RECEIVABLE only where the acquirer really '
    'pays later; NONE for voucher/points/benefit.';
