-- 0076: a count says which pieces are not what the order asked for.
--
-- The checker counts what physically came; some of it is not the article the
-- line names — the supplier's picker put another colour, model or article in
-- the carton. That is physical truth like any other, written down where the
-- count is taken and never trimmed to fit the order.
--
-- `wrong_quantity` is a part of `counted_quantity`, not a second count: the
-- pieces came on the same lorry and stand in the same Unidentified pile. At
-- acceptance only the pieces that DO match the order can be matched against
-- it (`matched = min(counted − wrong, outstanding)`), so the wrong pieces
-- land in `excess_quantity` with everything else beyond the order and leave
-- on a purchase return (0710). The column is what makes the count honest and
-- the return's reason readable, not a separate pile.

ALTER TABLE receiving_count ADD COLUMN wrong_quantity INTEGER NOT NULL DEFAULT 0
    CHECK (wrong_quantity >= 0 AND wrong_quantity <= counted_quantity);
