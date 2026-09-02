-- 0079: What clearance cost, on the line it cost it on.
--
-- A sold line already records `price_source`, so the centre can say a markdown
-- set this price. It could not say what the markdown was WORTH, because the
-- number it replaced was computed at the shop and dropped at the wire.
--
-- The asymmetry that makes this worth a column: every rupiah a PROMOTION gives
-- away is recorded per rule in `edge_sale_promotion`, so "what did the Lebaran
-- offer cost us" has an exact answer. "What did the end-of-season cost us" had
-- none — and for a fashion retailer clearance is usually the larger of the two.
--
-- Null is a real answer and not a gap: a shop with no price book in force never
-- quoted a list price, and a build older than this field never sent one. Null
-- rather than a copy of the charged price, because "nothing was marked down"
-- and "we do not know" must not add up to the same figure in a margin report.
ALTER TABLE edge_sale_line
    ADD COLUMN base_unit_price_minor bigint
        CHECK (base_unit_price_minor IS NULL OR base_unit_price_minor >= 0);

COMMENT ON COLUMN edge_sale_line.base_unit_price_minor IS
    'What one unit would have cost before a clearance replaced the price. NULL '
    'means no book was in force, or the shop predates this field — never zero.';

-- And which clearance it was.
--
-- `price_source` says a markdown won; `base_unit_price_minor` says what it was
-- worth; this says which one. Without it, "what did the end-of-season cost us"
-- means joining a sold line back to `commercial_markdown` by sku, publication
-- version and date, and hoping exactly one candidate covered that instant. That
-- is a reconstruction, and it stops being reliable in precisely the case worth
-- reporting on: two overlapping clearances, where the engine picked one by
-- priority and the join cannot tell which.
--
-- Text and not a foreign key, for the reason `edge_sale_promotion` gives: a
-- receipt has to stay readable after the promotion it names is gone.
ALTER TABLE edge_sale_line ADD COLUMN markdown_id text;

CREATE INDEX ix_edge_sale_line_markdown ON edge_sale_line (markdown_id)
    WHERE markdown_id IS NOT NULL;

COMMENT ON COLUMN edge_sale_line.markdown_id IS
    'Which clearance set this price. NULL when none did. Text rather than a key '
    'so a sold line outlives the markdown it names.';
