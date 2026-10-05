-- 0829: a receipt line remembers which pieces were not what the order asked
-- for.
--
-- The checker counts what physically came and, within the count, how many
-- pieces are not the article the line names. The centre re-derives the
-- matched/excess split from its own copy of the order, and it matches against
-- `quantity − wrong_quantity`: the wrong pieces were never quantity this
-- company agreed to buy. They stay inside `excess_quantity` — the split's
-- CHECK still holds (`matched + excess = quantity`), because everything
-- beyond the order, mismatched or over-delivered, leaves on the same
-- purchase return (0710). The column is the reason on that return's paper.

ALTER TABLE goods_receipt_line ADD COLUMN wrong_quantity bigint NOT NULL DEFAULT 0;

ALTER TABLE goods_receipt_line ADD CONSTRAINT goods_receipt_line_wrong_is_of_the_excess
    CHECK (wrong_quantity >= 0 AND wrong_quantity <= excess_quantity);

COMMENT ON COLUMN goods_receipt_line.wrong_quantity IS
    'Pieces the checker counted as not matching the order. A part of '
    'excess_quantity: they were never quantity the order agreed to buy, and '
    'they go back to the supplier with the rest of the excess (0710).';
