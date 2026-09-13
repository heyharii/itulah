-- 0163: A receipt says what is sales and what is tax.
--
-- The centre's copy of the till's split. See the SQLite migration `0031` for
-- why the three figures are kept apart; the reason they are stored rather than
-- derived is the same one every snapshot in this schema exists for: the rate
-- that applied is the rate in the book that priced the sale, and a report run
-- next year must not reach for today's rate.
--
-- This is what makes Net Sales sayable. Until now `edge_sale.total_minor` was
-- the only figure, and every campaign, margin and finance number that called it
-- sales was counting PPN as revenue.
--
-- Nullable for the sales already here: null is "not recorded", which a report
-- can exclude. Nought would claim the sale was all goods and no tax, which is
-- a different and false statement.
ALTER TABLE edge_sale_line ADD COLUMN net_ex_tax_minor BIGINT;
ALTER TABLE edge_sale_line ADD COLUMN tax_minor BIGINT;

ALTER TABLE edge_sale ADD COLUMN net_ex_tax_minor BIGINT;
ALTER TABLE edge_sale ADD COLUMN tax_total_minor BIGINT;
