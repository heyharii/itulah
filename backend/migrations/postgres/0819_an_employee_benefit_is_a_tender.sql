-- 0819: an employee's benefit balance (0818) is a tender at the till.
--
-- The cashier spends part of a basket from the balance the employee's code
-- shows, through the shop's node to head office (online only), and the sale
-- carries a BENEFIT tender whose reference is the basket the balance was spent
-- against. Like a free voucher no money arrives: Finance books what it paid as
-- a sales discount (owner, 1 Oct 2026). Everywhere a tender is named, BENEFIT
-- is named too — the same sweep 0477 made for the e-wallet.

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
                              'sales_posting_line'::regclass)
           AND pg_get_constraintdef(c.oid) ILIKE '%VOUCHER%'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', target.tbl, target.conname);
    END LOOP;
    -- The payment method's tender list and the rule that only stored value
    -- settles to nothing.
    FOR target IN
        SELECT c.conname
          FROM pg_constraint c
         WHERE c.contype = 'c'
           AND c.conrelid = 'payment_method'::regclass
           AND pg_get_constraintdef(c.oid) ILIKE '%VOUCHER%'
    LOOP
        EXECUTE format('ALTER TABLE payment_method DROP CONSTRAINT %I', target.conname);
    END LOOP;
    FOR target IN
        SELECT c.conname
          FROM pg_constraint c
         WHERE c.contype = 'c'
           AND c.conrelid = 'tender_reconciliation'::regclass
           AND pg_get_constraintdef(c.oid) ILIKE '%VOUCHER%'
    LOOP
        EXECUTE format('ALTER TABLE tender_reconciliation DROP CONSTRAINT %I', target.conname);
    END LOOP;
END
$$;

ALTER TABLE sale_payment ADD CONSTRAINT sale_payment_method_check
    CHECK (method IN ('CASH', 'CARD', 'QRIS', 'EWALLET', 'OTHER', 'VOUCHER', 'BENEFIT'));

ALTER TABLE sale_return_payment ADD CONSTRAINT sale_return_payment_method_check
    CHECK (method IN ('CASH', 'CARD', 'QRIS', 'EWALLET', 'OTHER', 'VOUCHER', 'BENEFIT'));

ALTER TABLE sales_posting_line ADD CONSTRAINT sales_posting_line_method_check
    CHECK (method IN ('CASH', 'CARD', 'QRIS', 'EWALLET', 'OTHER', 'VOUCHER', 'BENEFIT', 'RETURN'));

ALTER TABLE tender_reconciliation ADD CONSTRAINT tender_reconciliation_tender_kind_check
    CHECK (tender_kind IN ('CASH', 'CARD', 'QRIS', 'EWALLET', 'VOUCHER', 'BENEFIT'));

ALTER TABLE payment_method ADD CONSTRAINT payment_method_tender_type_check
    CHECK (tender_type IN
        ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'QRIS', 'EWALLET', 'VOUCHER', 'POINTS', 'BENEFIT'));

ALTER TABLE payment_method ADD CONSTRAINT payment_method_stored_value_settles_to_nothing
    CHECK ((tender_type IN ('VOUCHER', 'POINTS', 'BENEFIT')) = (settlement_mode = 'NONE'));

CREATE OR REPLACE FUNCTION payment_method_roles(p_tender_type text, p_settlement_mode text)
RETURNS SETOF text LANGUAGE sql IMMUTABLE AS $$
    SELECT unnest(CASE p_tender_type
        WHEN 'CASH'        THEN ARRAY['cash', 'revenue_cash']
        WHEN 'DEBIT_CARD'  THEN ARRAY['card_receivable_debit', 'revenue_debit', 'card_fee', 'sales_return']
        WHEN 'QRIS'        THEN ARRAY['card_receivable_debit', 'revenue_debit', 'card_fee', 'sales_return']
        WHEN 'EWALLET'     THEN ARRAY['card_receivable_debit', 'revenue_debit', 'card_fee', 'sales_return']
        WHEN 'CREDIT_CARD' THEN ARRAY['card_receivable_credit', 'revenue_credit', 'card_fee', 'sales_return']
        WHEN 'VOUCHER'     THEN ARRAY['sales_discount', 'revenue_cash']
        WHEN 'POINTS'      THEN ARRAY['loyalty_redemption', 'revenue_cash']
        WHEN 'BENEFIT'     THEN ARRAY['sales_discount', 'revenue_cash']
    END)
$$;

-- The method itself, accepted at every shop: the tile shows on the till, and
-- a spend goes through only while Settings › Benefit is turned on.
INSERT INTO payment_method (code, name, tender_type, bank_code, settlement_mode, created_by)
VALUES ('BENEFIT', 'Saldo karyawan', 'BENEFIT', '', 'NONE', 'migration:0819')
ON CONFLICT (code) DO NOTHING;

INSERT INTO payment_method_site (method_code, site_id, set_by)
SELECT 'BENEFIT', s.id, 'migration:0819'
  FROM site s
 WHERE EXISTS (SELECT 1 FROM payment_method WHERE code = 'BENEFIT')
ON CONFLICT DO NOTHING;
