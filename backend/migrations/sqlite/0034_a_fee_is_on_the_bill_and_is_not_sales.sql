-- 0034: A fee is on the bill and is not sales.
--
-- The shop's half of postgres 0169. A delivery charge, a service charge, a gift
-- box: the shopper pays it, so it prints on the receipt and lands in the
-- drawer, and it is not merchandise.
--
-- The till needs its own copy rather than waiting for the centre for the reason
-- every other sale fact is here: a receipt has to be reprintable, and a Z
-- report has to balance, on a shop whose link is down. A drawer counted against
-- a total with no fee in it is short by the fees, every day, with no way to see
-- why.

CREATE TABLE IF NOT EXISTS sale_charge (
    sale_id TEXT NOT NULL REFERENCES sale(id),
    -- Position, matching the order the charges were put on the bill, which is
    -- the order the receipt prints them.
    charge_seq INTEGER NOT NULL,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    -- The split the engine computed. Stored rather than recomputed, because a
    -- rate can change and a receipt cannot.
    net_ex_tax_minor INTEGER,
    tax_minor INTEGER,
    tax_category TEXT NOT NULL,

    PRIMARY KEY (sale_id, charge_seq)
);

-- The fee side of the sale, beside the goods side 0031 added. Nullable and
-- unbackfilled: a sale rung up before fees existed was not a sale with no fee,
-- it was a sale nobody could put one on.
ALTER TABLE sale ADD COLUMN charge_total_minor INTEGER;
ALTER TABLE sale ADD COLUMN charge_net_ex_tax_minor INTEGER;
ALTER TABLE sale ADD COLUMN charge_tax_minor INTEGER;
