-- A purchase order can carry payment terms again.
--
-- The owner took the choice off the order on 2026-09-26 and wants it back as
-- an OPTION: an order may name a payment terms template, or none. It is the
-- order's own choice — the supplier's `default_payment_terms_code` (0302) is
-- only what the composer suggests.
--
-- Same reference as the supplier's default, for the same reason: ON DELETE
-- RESTRICT, because a template deleted under live orders would silently change
-- what they are paid on, and 0201 retires templates rather than deleting them.

ALTER TABLE purchase_order
    ADD COLUMN IF NOT EXISTS payment_terms_code text
        REFERENCES payment_terms_template(code) ON DELETE RESTRICT;

COMMENT ON COLUMN purchase_order.payment_terms_code IS
    'The payment terms template this order is raised on, or NULL for none. Optional; the supplier default is only a suggestion.';
