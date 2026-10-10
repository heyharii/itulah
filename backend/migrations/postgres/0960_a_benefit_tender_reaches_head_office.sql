-- 0960: a sale settled partly from an employee's benefit balance reaches head
-- office.
--
-- 0819 named BENEFIT everywhere a tender is named, but not on
-- `edge_sale_tender`, the table a shop's synced sale lands in. Its check still
-- listed the tenders of 0090/0477, so the first sale with a BENEFIT tender was
-- refused at the door — and a refused fact holds up every later fact of that
-- shop's stream (sales, stock moves), not just the one sale.

ALTER TABLE edge_sale_tender DROP CONSTRAINT IF EXISTS edge_sale_tender_method_check;
ALTER TABLE edge_sale_tender ADD CONSTRAINT edge_sale_tender_method_check
    CHECK (method IN ('CASH', 'CARD', 'QRIS', 'VOUCHER', 'EWALLET', 'OTHER', 'BENEFIT'));
