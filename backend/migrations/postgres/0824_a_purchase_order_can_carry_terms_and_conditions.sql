-- A purchase order can carry its terms and conditions.
--
-- The owner, 2026-10-02: free text the buyer writes on the order — what the
-- supplier agrees to beyond the lines (packing, labelling, late delivery) —
-- printed with it. Optional; NULL is an order with none.

ALTER TABLE purchase_order
    ADD COLUMN IF NOT EXISTS terms_and_conditions text;

COMMENT ON COLUMN purchase_order.terms_and_conditions IS
    'Free-text terms and conditions written on the order, or NULL for none.';
