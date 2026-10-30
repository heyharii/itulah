-- 0103: a sale keeps which of its goods never come back, as the policy said
-- the moment it was sold (Hari, 29 Oct 2026).
--
-- `sale.return_by` (0101) froze the LAST DAY on the paper. Whether a piece may
-- come back at all was still asked of today's policy at the counter, so a
-- policy written after the sale ("Pakaian dalam: Never") refused goods whose
-- struk said "Bisa ditukar s/d …", and the other way round. The paper is the
-- promise: one row per sku of the sale, `refused_by` the name of the policy
-- that keeps it (NULL: it may come back). A sale with no rows here is from
-- before 0103 and is still asked of today's policy.
CREATE TABLE IF NOT EXISTS sale_line_promise (
    sale_id    TEXT NOT NULL,
    sku_code   TEXT NOT NULL,
    refused_by TEXT,
    PRIMARY KEY (sale_id, sku_code)
);
