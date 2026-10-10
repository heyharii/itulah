-- 0963: a line ordered in variants is counted per variant.
--
-- The owner (2026-10-10): when a purchase order line is split into colours and
-- sizes (0398), the bay counts each variant on its own — "Linen Shirt Black
-- XL", "Linen Shirt Black M" — and whoever raised the order reviews the count
-- per variant, ordered beside counted. Still blind: the bay is shown the
-- variants, never how many of each were ordered.
--
-- A BREAKDOWN, not a second count. The line has one purchase price, and its
-- receipt (matched / excess / wrong, valuation, payables, stock) stays per
-- line exactly as before: `dc_receiving_count.counted_quantity` is still the
-- line's count, and its right pieces (`counted_quantity - wrong_quantity`)
-- are the sum of the rows here. Pieces that match no ordered variant are not
-- a variant row: they are the delivery's "Not as Ordered", as always.
--
-- Keyed by colour and size, not by `purchase_order_line_variant.variant_id`:
-- a line's variants are rewritten whole whenever the line is edited (0961), so
-- the id a count was taken against may not exist the next day; the colour and
-- the size do. A count taken as a whole (an older count, a DC server's count)
-- simply has no rows here.

CREATE TABLE IF NOT EXISTS dc_receiving_count_variant (
    count_id         uuid NOT NULL REFERENCES dc_receiving_count (count_id) ON DELETE CASCADE,
    colour_code      text REFERENCES colour (code),
    size_code        char(2) REFERENCES size_code (code),
    -- 0 is a statement, as on the line (0918): this variant did not come.
    counted_quantity bigint NOT NULL CHECK (counted_quantity >= 0),
    CHECK (colour_code IS NOT NULL OR size_code IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_dc_receiving_count_variant
    ON dc_receiving_count_variant (count_id, COALESCE(colour_code, ''), COALESCE(size_code, ''));

COMMENT ON TABLE dc_receiving_count_variant IS
    'Per-variant breakdown of a blind count of a line ordered in variants (0963). The line''s right pieces are their sum; the receipt stays per line.';

-- One count, variant by variant, as the reviewer compares it: every variant
-- the line was ordered in and every variant the count named, with what was
-- ordered, what is still owed of it after earlier ACCEPTED counts' own
-- breakdowns, and what this count found (0 where it named none). No rows when
-- the count was taken as a whole — there is nothing to break down.
CREATE OR REPLACE FUNCTION dc_receiving_count_breakdown(p_count_id uuid)
RETURNS TABLE (
    colour_code          text,
    size_code            text,
    ordered_quantity     bigint,
    outstanding_quantity bigint,
    counted_quantity     bigint,
    image_urls           text[]
)
LANGUAGE sql STABLE AS $$
    WITH this AS (
        SELECT k.po_line_id FROM dc_receiving_count k WHERE k.count_id = p_count_id
    ),
    ordered AS (
        SELECT v.colour_code AS colour, v.size_code::text AS size, v.quantity AS pieces,
               v.image_urls AS photos
          FROM purchase_order_line_variant v
          JOIN this ON this.po_line_id = v.po_line_id
    ),
    counted AS (
        SELECT x.colour_code AS colour, x.size_code::text AS size, x.counted_quantity AS pieces
          FROM dc_receiving_count_variant x
         WHERE x.count_id = p_count_id
    ),
    before AS (
        SELECT x.colour_code AS colour, x.size_code::text AS size,
               sum(x.counted_quantity)::bigint AS pieces
          FROM dc_receiving_count_variant x
          JOIN dc_receiving_count k ON k.count_id = x.count_id
          JOIN this ON this.po_line_id = k.po_line_id
         WHERE k.status = 'ACCEPTED' AND k.count_id <> p_count_id
         GROUP BY x.colour_code, x.size_code
    )
    SELECT COALESCE(o.colour, n.colour),
           COALESCE(o.size, n.size),
           COALESCE(o.pieces, 0)::bigint,
           GREATEST(COALESCE(o.pieces, 0) - COALESCE(b.pieces, 0), 0)::bigint,
           COALESCE(n.pieces, 0)::bigint,
           COALESCE(o.photos, '{}'::text[])
      FROM ordered o
      FULL JOIN counted n
        ON COALESCE(o.colour, '') = COALESCE(n.colour, '')
       AND COALESCE(o.size, '') = COALESCE(n.size, '')
      LEFT JOIN before b
        ON COALESCE(b.colour, '') = COALESCE(o.colour, n.colour, '')
       AND COALESCE(b.size, '') = COALESCE(o.size, n.size, '')
     WHERE EXISTS (SELECT 1 FROM counted)
$$;
