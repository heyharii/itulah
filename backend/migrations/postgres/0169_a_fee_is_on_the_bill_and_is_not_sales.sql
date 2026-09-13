-- 0169: A fee is on the bill and is not sales.
--
-- A delivery charge, a service charge, a gift box. The shopper pays it, so it
-- is on the receipt and in the takings — and it is **not merchandise**, which
-- is the whole reason it needs its own rows rather than a line on the sale.
--
-- Folded into `total_minor` it would be indistinguishable from goods, and every
-- number downstream would be wrong in a way nobody could find:
--
--   * **Net Sales** would include the courier. A shop that did Rp100 juta of
--     trade and Rp8 juta of delivery would report Rp108 juta, and its margin
--     would look eight per cent worse than it is against a cost of goods that
--     never included a motorbike.
--   * **Points** would accrue on it. The locked rule is goods after discount,
--     before tax, without charges — and a scheme that paid out on delivery
--     would pay most on the orders the shop makes least on.
--   * **A refund** would give it back. Returning a shirt does not un-deliver
--     it; the courier has been paid either way, and `sale_return` reading one
--     merged total cannot tell which rupiah is which.
--   * **Tax** would be charged at the goods rate. A fee is not always the same
--     category, and assuming it is gets the return wrong in whichever
--     direction the rates differ.
--
-- So: separate rows, their own tax split, and `amount_due` on the sale is the
-- only number that has both in it. The engine already refuses to let a
-- promotion, a minimum spend or an earn rule reach a charge — see
-- `pricing_engine::Charge` — and this is where that answer is kept.

CREATE TABLE IF NOT EXISTS edge_sale_charge (
    sale_id UUID NOT NULL REFERENCES edge_sale(sale_id) ON DELETE CASCADE,
    -- Position, so a fact delivered twice overwrites rather than bills the
    -- shopper for a second delivery.
    charge_seq INTEGER NOT NULL,
    -- The shop's own word: DELIVERY, SERVICE, PACKAGING. Not an enum, because
    -- the set is a business's to extend and a CHECK here would mean a migration
    -- every time somebody invented a fee.
    code TEXT NOT NULL,
    -- What the receipt says. Held beside the code because a line reading
    -- "SERVICE" is not one anybody wants to argue about at a counter.
    description TEXT NOT NULL,
    -- As charged, tax included where the rule says it is — read the same way a
    -- shelf price is.
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    -- The split, computed once by the engine. Stored rather than derived
    -- because the rate can change and a receipt cannot: a fee taxed at 11% in
    -- September is still a fee taxed at 11% when it is read back in March.
    net_ex_tax_minor BIGINT CHECK (net_ex_tax_minor >= 0),
    tax_minor BIGINT CHECK (tax_minor >= 0),
    tax_category TEXT NOT NULL,

    PRIMARY KEY (sale_id, charge_seq)
);

-- "What did this shop take in delivery fees last month" — the question a fee
-- exists to be asked, and the reason the code is a column rather than buried in
-- a description.
CREATE INDEX IF NOT EXISTS ix_edge_sale_charge_code
    ON edge_sale_charge (code, sale_id);

-- The fee side of the sale, beside the goods side that 0163 added.
--
-- Nullable and unbackfilled: every sale already here was rung up before fees
-- existed, and writing nought would claim the shop offered delivery and nobody
-- took it. NULL says the question was never asked, which is true.
ALTER TABLE edge_sale
    ADD COLUMN IF NOT EXISTS charge_total_minor BIGINT,
    ADD COLUMN IF NOT EXISTS charge_net_ex_tax_minor BIGINT,
    ADD COLUMN IF NOT EXISTS charge_tax_minor BIGINT;
