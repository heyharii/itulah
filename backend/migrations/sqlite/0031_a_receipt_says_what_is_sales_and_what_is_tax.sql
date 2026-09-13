-- 0031: A receipt says what is sales and what is tax.
--
-- The engine has always carried a `tax_category` per line and computed nothing
-- with it. A sale stored one figure — what the shopper paid — and a report that
-- called that "sales" was counting money collected for the state as revenue.
--
-- Three figures, because they answer three questions that are routinely
-- confused:
--
--     net_ex_tax_minor   the goods. THIS is Net Sales.
--     tax_minor          money held for somebody else.
--     unit_price_minor   what the shopper paid. Already here.
--
-- Under the tax-inclusive pricing Indonesian retail quotes, the third is the
-- sum of the first two and the shopper's total does not move. Under exclusive
-- pricing the tax is added on top. Either way the split is recorded rather than
-- recomputed later, because the rate that applied is the rate in the book that
-- priced the sale, not the rate in force when somebody runs the report.
--
-- Nullable, and that is the point: a sale taken before this column existed has
-- no split, and a nought would claim it was all goods. Null says "not recorded",
-- which a report can exclude or fall back on honestly.
ALTER TABLE sale_line ADD COLUMN net_ex_tax_minor INTEGER;
ALTER TABLE sale_line ADD COLUMN tax_minor INTEGER;

ALTER TABLE sale ADD COLUMN net_ex_tax_minor INTEGER;
ALTER TABLE sale ADD COLUMN tax_total_minor INTEGER;
