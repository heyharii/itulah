-- 0827: Payment terms are a number of days, and an order says how it is paid.
--
-- The owner (2026-10-03): terms are "30 days", "60 days" and so on, not a
-- schedule of instalments, and the way a purchase order is paid defaults to
-- giro. Payables follow the order on both.
--
-- Terms stay `payment_terms_template` rows with one line at 100% — nothing that
-- points at a template changes. What changes is what is offered: one template
-- per whole number of days, plus cash on delivery. The instalment templates
-- seeded in 0201 are retired, not deleted: suppliers and orders reference them
-- (ON DELETE RESTRICT), and an order keeps showing what it was raised on.

INSERT INTO payment_term (code, label, basis, offset_value, display_order, ever_used) VALUES
    ('NET_7',  '7 days',  'DAYS_AFTER_BILL',  7, 41, true),
    ('NET_14', '14 days', 'DAYS_AFTER_BILL', 14, 42, true),
    ('NET_60', '60 days', 'DAYS_AFTER_BILL', 60, 51, true),
    ('NET_90', '90 days', 'DAYS_AFTER_BILL', 90, 52, true)
ON CONFLICT (code) DO NOTHING;

UPDATE payment_term SET label = '30 days', ever_used = true WHERE code = 'NET_30';
UPDATE payment_term SET label = '45 days', ever_used = true WHERE code = 'NET_45';

INSERT INTO payment_terms_template (code, label, display_order, ever_used) VALUES
    ('NET_7',  '7 days',  10, true),
    ('NET_14', '14 days', 20, true),
    ('NET_60', '60 days', 50, true),
    ('NET_90', '90 days', 60, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO payment_terms_template_line (template_code, seq, term_code, portion_bps) VALUES
    ('NET_7',  1, 'NET_7',  10000),
    ('NET_14', 1, 'NET_14', 10000),
    ('NET_60', 1, 'NET_60', 10000),
    ('NET_90', 1, 'NET_90', 10000)
ON CONFLICT DO NOTHING;

UPDATE payment_terms_template SET label = '30 days', display_order = 30, ever_used = true WHERE code = 'NET_30';
UPDATE payment_terms_template SET label = '45 days', display_order = 40, ever_used = true WHERE code = 'NET_45';
UPDATE payment_terms_template SET display_order = 70 WHERE code = 'COD';

-- Retire every template that is not a plain number of days or cash on delivery.
UPDATE payment_terms_template SET active = false
 WHERE code NOT IN ('NET_7', 'NET_14', 'NET_30', 'NET_45', 'NET_60', 'NET_90', 'COD')
   AND active;

-- How the order is paid. The same words as `supplier_payment.method` (0084), of
-- which an order offers the three a retailer uses with a supplier.
ALTER TABLE purchase_order
    ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'GIRO'
        CHECK (payment_method IN ('GIRO', 'TRANSFER', 'CASH'));

COMMENT ON COLUMN purchase_order.payment_method IS
    'How this order is paid: GIRO (default), TRANSFER or CASH. Payables open the payment on it.';
