-- 0033: What a sale was charged, and on whose authority.
--
-- The centre held a sale's total and its lines, and the lines carried the price
-- stamped on each unit when the shop received it. That was the same number as
-- the price charged right up until a published price book reached a shop, and
-- then it was not — the arithmetic check at ingest would have refused every
-- sale from that shop, which is invisible revenue rather than a visible error.
--
-- These columns record what was actually charged and where the number came
-- from, so a line-level revenue figure exists and reconciles.

ALTER TABLE edge_sale_line ADD COLUMN line_total_minor bigint;
ALTER TABLE edge_sale_line ADD COLUMN price_source text;
ALTER TABLE edge_sale_line ADD COLUMN publication_version bigint;

ALTER TABLE edge_sale ADD COLUMN discount_total_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE edge_sale ADD COLUMN points_earned bigint NOT NULL DEFAULT 0;
-- The fingerprint of the pricing decision. A disputed receipt can be
-- reproduced against the same price book instead of argued about.
ALTER TABLE edge_sale ADD COLUMN pricing_trace_id text;

COMMENT ON COLUMN edge_sale_line.line_total_minor IS
    'What the line was charged. Not always unit_price_minor times quantity: a '
    'promotion acts on the line, and an apportioned flat discount does not '
    'divide evenly. NULL for sales recorded before this column existed.';
