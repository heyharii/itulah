-- An e-wallet is a tender everywhere a tender is named.
--
-- 0474 let a shop take EWALLET and taught the day posting its bucket, but only
-- widened `edge_sale_tender`. Every other table that spells the tender
-- vocabulary out in a CHECK still refused it, and the first one to matter is
-- `sales_posting_line`: a day with one GoPay sale could not post at all.
--
-- Each constraint is dropped by what it says rather than by name, like 0474,
-- so this converges whatever an earlier migration called it.

DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT c.conrelid::regclass AS tbl, c.conname
          FROM pg_constraint c
         WHERE c.contype = 'c'
           AND c.conrelid IN ('sale_payment'::regclass,
                              'sale_return_payment'::regclass,
                              'sales_posting_line'::regclass,
                              'tender_reconciliation'::regclass,
                              'acquirer_settlement_line'::regclass)
           AND pg_get_constraintdef(c.oid) ILIKE '%QRIS%'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', target.tbl, target.conname);
    END LOOP;
END
$$;

ALTER TABLE sale_payment ADD CONSTRAINT sale_payment_method_check
    CHECK (method IN ('CASH', 'CARD', 'QRIS', 'EWALLET', 'OTHER', 'VOUCHER'));

ALTER TABLE sale_return_payment ADD CONSTRAINT sale_return_payment_method_check
    CHECK (method IN ('CASH', 'CARD', 'QRIS', 'EWALLET', 'OTHER', 'VOUCHER'));

ALTER TABLE sales_posting_line ADD CONSTRAINT sales_posting_line_method_check
    CHECK (method IN ('CASH', 'CARD', 'QRIS', 'EWALLET', 'OTHER', 'VOUCHER', 'RETURN'));

-- The takings a shop proves: an e-wallet settles through a provider like QRIS
-- does, and a wallet's merchant device is a terminal the same way an EDC is.
ALTER TABLE tender_reconciliation ADD CONSTRAINT tender_reconciliation_tender_kind_check
    CHECK (tender_kind IN ('CASH', 'CARD', 'QRIS', 'EWALLET', 'VOUCHER'));

ALTER TABLE tender_reconciliation ADD CONSTRAINT tender_reconciliation_terminal_check
    CHECK (terminal_id IS NULL OR tender_kind IN ('CARD', 'QRIS', 'EWALLET'));

-- A wallet provider's settlement report is keyed like an acquirer's.
ALTER TABLE acquirer_settlement_line ADD CONSTRAINT acquirer_settlement_line_tender_kind_check
    CHECK (tender_kind IN ('CARD_DEBIT', 'CARD_CREDIT', 'QRIS', 'EWALLET'));
