-- 0085: Which line a promotion came off, not just which sale.
--
-- `edge_sale_promotion` records (sale, rule, benefit). So a basket of three
-- shirts where a promotion touched one is a basket entirely attributed to that
-- promotion, and every report reading it says the whole 550,000 was
-- promotional. That figure has a name in the trade — influenced revenue — and
-- it is a legitimate thing to report. It is not the only thing worth reporting,
-- and it was the only one obtainable.
--
-- The apportionment is not new work. A flat "Rp 50,000 off the basket" has to
-- be split across the matched lines before it can be applied at all, or fifty
-- thousand comes off every line instead of off the basket once. The engine
-- computed that split and summed it away three lines later. This keeps it.
--
-- Keyed by the sold line rather than by sku: a basket can hold the same product
-- twice and a promotion may have matched only one of them.
CREATE TABLE edge_sale_promotion_line (
    sale_id       uuid NOT NULL REFERENCES edge_sale(sale_id) ON DELETE CASCADE,
    rule_id       text NOT NULL CHECK (btrim(rule_id) <> ''),
    -- The unit this came off. `edge_sale_line` is keyed by it, and it is what
    -- the shop scanned, so the two join without a positional assumption
    -- travelling over the wire.
    subject_id    uuid NOT NULL,
    benefit_minor bigint NOT NULL CHECK (benefit_minor >= 0),
    PRIMARY KEY (sale_id, rule_id, subject_id)
);

-- "What did this promotion attributably cost, by product" — the question this
-- table exists for, and the one the sale-level total cannot answer.
CREATE INDEX ix_sale_promotion_line_rule ON edge_sale_promotion_line (rule_id);

COMMENT ON TABLE edge_sale_promotion_line IS
    'What one promotion took off one sold unit. The parts sum to the figure in '
    'edge_sale_promotion for the same (sale, rule) — attributed revenue beside '
    'the influenced revenue that row already gives.';
