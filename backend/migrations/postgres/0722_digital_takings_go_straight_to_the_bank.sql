-- Digital takings go straight to the bank (owner, 1 Oct 2026).
--
-- A debit card, a credit card and QRIS are all paid on a shop's EDC, and the
-- owner wants the day's takings on Cash in Bank the day they are taken, not
-- on Piutang Debit Card / Piutang Kartu Kredit until a settlement file says
-- so. Cash stays in the shop's Cash on Hand. 0468 already had the switch —
-- `settlement_mode = 'DIRECT_TO_BANK'` — and the day now honours it fully:
-- the line debits `bank_giro` qualified by the EDC's bank, in head office's
-- books where the bank accounts are, and opens no acquirer receivable. The
-- MDR the bank keeps is booked on the day at `mdr_bps` when Finance sets one;
-- left at 0 it shows up on the bank reconciliation as the difference.
--
-- QRIS is not a sale of its own kind: it rides the EDC of a bank, so it lands
-- where that bank's debit cards land.

UPDATE payment_method
   SET settlement_mode = 'DIRECT_TO_BANK',
       note = COALESCE(note || ' ', '') || 'Straight to the bank from 1 Oct 2026 (0722).'
 WHERE tender_type IN ('DEBIT_CARD', 'CREDIT_CARD', 'QRIS', 'EWALLET')
   AND settlement_mode = 'VIA_RECEIVABLE';

-- The roles a method's day lines use: a method that settles straight into a
-- bank uses the bank, not a receivable.
CREATE OR REPLACE FUNCTION payment_method_roles(p_tender_type text, p_settlement_mode text)
RETURNS SETOF text LANGUAGE sql IMMUTABLE AS $$
    SELECT unnest(CASE
        WHEN p_settlement_mode = 'DIRECT_TO_BANK' AND p_tender_type = 'CREDIT_CARD'
            THEN ARRAY['bank_giro', 'revenue_credit', 'card_fee', 'sales_return']
        WHEN p_settlement_mode = 'DIRECT_TO_BANK'
            THEN ARRAY['bank_giro', 'revenue_debit', 'card_fee', 'sales_return']
        WHEN p_tender_type = 'CASH'        THEN ARRAY['cash', 'revenue_cash']
        WHEN p_tender_type = 'DEBIT_CARD'  THEN ARRAY['card_receivable_debit', 'revenue_debit', 'card_fee', 'sales_return']
        WHEN p_tender_type = 'QRIS'        THEN ARRAY['card_receivable_debit', 'revenue_debit', 'card_fee', 'sales_return']
        WHEN p_tender_type = 'EWALLET'     THEN ARRAY['card_receivable_debit', 'revenue_debit', 'card_fee', 'sales_return']
        WHEN p_tender_type = 'CREDIT_CARD' THEN ARRAY['card_receivable_credit', 'revenue_credit', 'card_fee', 'sales_return']
        WHEN p_tender_type = 'VOUCHER'     THEN ARRAY['sales_discount', 'revenue_cash']
        WHEN p_tender_type = 'POINTS'      THEN ARRAY['loyalty_redemption', 'revenue_cash']
    END)
$$;
