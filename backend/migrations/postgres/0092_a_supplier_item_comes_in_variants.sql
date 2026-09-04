-- 0092: A supplier's product comes in colours and sizes, like ours does.
--
-- `supplier_item` has carried a division and tags since 0038 — what a thing IS
-- — but nothing about what it COMES IN. Our own `article` has had both since
-- 0022: `article_colour` and the sizes its SKUs are minted across. So the two
-- catalogues a buyer compares side by side describe themselves differently,
-- and the sourcing screen could not draw the one line that says "this is the
-- tee, in five colours, S to XXL".
--
-- Two link tables rather than one variant table, and that is the same shape
-- `article` uses. A supplier quotes ONE price for a style — the tee is Rp
-- 42.000 whichever colour it is — so a row per colour×size combination would
-- be a cross product carrying no information the two lists do not already
-- carry, and would need a price column nobody would ever set differently.
-- Where a supplier really does price per variant, that is two supplier items
-- with two codes, which is how their own price list already says it.
--
-- Both borrow the masters rather than inventing vocabulary, for the reason
-- 0038 and 0081 both give: a supplier's Navy and our Navy must be one row, or
-- a colour filter finds a third of the navy garments and reports that as the
-- answer.
--
-- Both are optional and both start empty. An item nobody has broken down into
-- variants is a real state — most of a scraped supplier feed is exactly that —
-- and it is better shown as "no variants recorded" than guessed at.

CREATE TABLE supplier_item_colour (
    supplier_item_id uuid NOT NULL REFERENCES supplier_item(supplier_item_id) ON DELETE CASCADE,
    colour_code      text NOT NULL REFERENCES colour(code),
    PRIMARY KEY (supplier_item_id, colour_code)
);

-- The facet query counts items per colour across the whole catalogue, so it
-- reads this table by colour and not by item.
CREATE INDEX ix_supplier_item_colour_colour ON supplier_item_colour (colour_code);

CREATE TABLE supplier_item_size (
    supplier_item_id uuid NOT NULL REFERENCES supplier_item(supplier_item_id) ON DELETE CASCADE,
    size_code        char(2) NOT NULL REFERENCES size_code(code),
    PRIMARY KEY (supplier_item_id, size_code)
);

CREATE INDEX ix_supplier_item_size_size ON supplier_item_size (size_code);

COMMENT ON TABLE supplier_item_colour IS
    'Which colours a supplier offers this item in, named from the colour '
    'master. Empty means nobody has broken it down — a real state, not a '
    'fault.';

COMMENT ON TABLE supplier_item_size IS
    'Which sizes a supplier offers this item in, named from the size_code '
    'master so a supplier''s M and our M are one word.';
