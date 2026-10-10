-- A variant on an order line may carry photographs of its own.
--
-- The owner's rule of 2026-10-10: a buyer who wants to be specific about one
-- SKU — the khaki in XXL — attaches photographs to it; optional, and as many
-- as the buyer wants (up to twelve). Most variants carry none and are shown
-- with the item's own picture. They are links to objects already stored (the
-- browser PUTs each one straight to the bucket before the order is sent), in
-- the order they were added. Article setup offers the first photograph of a
-- colour as that colourway's photograph, imagery being kept per colourway.
--
-- On the variant row itself rather than a table of their own: a line's
-- variants are rewritten whole whenever the line is edited, and the
-- photographs travel with them.
ALTER TABLE purchase_order_line_variant
    ADD COLUMN image_urls text[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(image_urls) <= 12);
