-- A purchase is valued by one rule, and its discount is shared over its lines.
--
-- The owner, 2026-10-02:
--
--   * Quantities on an order are pieces. The price is kept in the unit it was
--     agreed in (per lusin, per kodi, per piece) and is the source of truth.
--   * What a number of pieces is worth is pieces × price ÷ pieces-per-unit,
--     in integers, rounded half up ONCE, to the rupiah: 240 pcs at Rp 400.000
--     a lusin is 8.000.000 exactly; 13 pcs is 433.333. A rounded price per
--     piece is never multiplied. The order, receiving, payables, valuation
--     and the three-way match all read `purchase_value` below (its Rust twin
--     is `units::purchase_value`), so they cannot disagree.
--   * A discount is a percentage of the whole order with two decimals
--     (`discount_bps`, hundredths of a percent). The amount is the subtotal
--     × that percentage, rounded once. Every piece carries the same discount:
--     a line's share is discount × its pieces ÷ the order's pieces, by largest
--     remainder in whole rupiah (ties to the earlier line), so the shares add
--     up to the order's discount exactly (`purchase_order_line.discount_minor`).
--     A receipt takes its line's share by the pieces it matched.
--
-- Additive: two columns, two functions, and a backfill of what the old
-- rounding (to even, per order unit) or an earlier approval left behind.

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

-- `p_unit_price_minor` / `p_unit_factor`: the price per order unit and the
-- pieces in one, when the line was priced that way (0656); null otherwise, and
-- the value is pieces × the price per piece. A factor has at most four
-- decimals, so factor × 10000 is whole and `div` is exact integer division.
CREATE FUNCTION purchase_value(
    p_pieces bigint,
    p_piece_price_minor bigint,
    p_unit_price_minor bigint,
    p_unit_factor numeric
) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_unit_price_minor IS NULL OR p_unit_factor IS NULL OR p_unit_factor <= 0
            THEN (p_pieces::numeric * p_piece_price_minor)::bigint
        ELSE (sign(p_pieces::numeric * p_unit_price_minor)
              * div(abs(p_pieces::numeric * p_unit_price_minor) * 20000
                        + round(p_unit_factor * 10000),
                    round(p_unit_factor * 10000) * 2))::bigint
    END
$$;

COMMENT ON FUNCTION purchase_value(bigint, bigint, bigint, numeric) IS
    'Pieces at a purchase line''s agreed price, in whole rupiah: pieces × price ÷ pieces-per-unit, rounded half up once. The one valuation rule for orders, receipts, bills and stock (0823).';

-- What an accepted delivery line is worth. The price the DC wrote on the
-- acceptance (`goods_receipt_line.agreed_unit_price_minor`, per piece) is the
-- line's own price unless an approved amendment had changed it; while it is
-- the line's, the line's agreed unit price is used and nothing is rounded
-- twice.
CREATE FUNCTION purchase_receipt_value(
    p_pieces bigint,
    p_agreed_piece_price_minor bigint,
    p_line_piece_price_minor bigint,
    p_unit_price_minor bigint,
    p_unit_factor numeric
) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_agreed_piece_price_minor IS NULL
          OR p_agreed_piece_price_minor = p_line_piece_price_minor
            THEN purchase_value(p_pieces, p_line_piece_price_minor,
                                p_unit_price_minor, p_unit_factor)
        ELSE purchase_value(p_pieces, p_agreed_piece_price_minor, NULL, NULL)
    END
$$;

COMMENT ON FUNCTION purchase_receipt_value(bigint, bigint, bigint, bigint, numeric) IS
    'An accepted delivery line at the price that applied when it was accepted, by purchase_value (0823).';

-- ---------------------------------------------------------------------------
-- The discount, as agreed and as shared
-- ---------------------------------------------------------------------------

ALTER TABLE purchase_order
    ADD COLUMN discount_bps integer
        CHECK (discount_bps IS NULL OR discount_bps BETWEEN 0 AND 10000);

COMMENT ON COLUMN purchase_order.discount_bps IS
    'The discount as agreed, in hundredths of a percent (1250 = 12,50%). NULL when it was given as an amount. discount_minor is what it came to.';

ALTER TABLE purchase_order_line
    ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0);

COMMENT ON COLUMN purchase_order_line.discount_minor IS
    'This line''s share of the order discount, by pieces (every piece the same), largest remainder: the shares of one order add up to purchase_order.discount_minor exactly (0823).';

-- ---------------------------------------------------------------------------
-- What earlier code left behind
-- ---------------------------------------------------------------------------

-- An approval that repriced the rest of a line (scope REMAINING) wrote a new
-- price per piece and left the old price per order unit standing beside it.
-- The piece price is the agreement now.
UPDATE purchase_order_line l
   SET order_unit_price_minor = NULL
 WHERE l.order_unit_price_minor IS NOT NULL
   AND EXISTS (SELECT 1 FROM purchase_price_amendment a
                WHERE a.po_line_id = l.po_line_id
                  AND a.status = 'APPROVED' AND a.scope = 'REMAINING');

-- Lines priced per order unit, totalled by the rule (the old code rounded to
-- even; the two differ only on an exact half).
UPDATE purchase_order_line
   SET line_amount_minor = purchase_value(ordered_quantity, unit_price_minor,
                                          order_unit_price_minor, unit_factor)
 WHERE order_unit_price_minor IS NOT NULL
   AND line_amount_minor IS DISTINCT FROM
       purchase_value(ordered_quantity, unit_price_minor, order_unit_price_minor, unit_factor);

-- Every discounted order's discount, shared over its lines.
WITH weighted AS (
    SELECT l.po_line_id, l.purchase_order_id, l.line_number,
           o.discount_minor::numeric AS total,
           l.ordered_quantity::numeric AS weight,
           sum(l.ordered_quantity) OVER (PARTITION BY l.purchase_order_id)::numeric AS weights
      FROM purchase_order_line l
      JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
     WHERE o.discount_minor > 0
), floored AS (
    SELECT po_line_id, purchase_order_id, line_number, total, weights,
           CASE WHEN weights > 0 THEN div(total * weight, weights) ELSE 0 END AS share,
           CASE WHEN weights > 0 THEN mod(total * weight, weights) ELSE 0 END AS rest
      FROM weighted
), ranked AS (
    SELECT po_line_id, share, weights,
           row_number() OVER (PARTITION BY purchase_order_id
                              ORDER BY rest DESC, line_number) AS place,
           total - sum(share) OVER (PARTITION BY purchase_order_id) AS left_over
      FROM floored
)
UPDATE purchase_order_line l
   SET discount_minor = (r.share
                         + CASE WHEN r.weights > 0 AND r.place <= r.left_over THEN 1 ELSE 0 END
                        )::bigint
  FROM ranked r
 WHERE r.po_line_id = l.po_line_id;
