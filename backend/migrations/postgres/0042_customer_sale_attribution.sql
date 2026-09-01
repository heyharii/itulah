-- Whose sale it was.
--
-- The till already knew. `SalesCompletedPayload` has carried `customer_id`
-- since promotions arrived, and the centre reads it — but only to bump the
-- per-shopper counter that enforces "once per customer" (see
-- `apply_sale` in `cloud/postgres/sync.rs`). Then it threw the name away.
--
-- Which left `edge_sale.points_earned` as points credited to nobody: a number
-- the shop computed, the centre stored, and no one could ever be shown. A
-- member asking "how many points do I have" had no query that could answer,
-- because the join from person to takings did not exist.
--
-- Nullable on purpose, and most rows will stay null: an anonymous sale is the
-- ordinary case at a clothing counter, and inventing an id for the person who
-- did not give one would be worse than admitting we do not know them.
ALTER TABLE edge_sale ADD COLUMN customer_id text;

-- The one shape a member's own screen asks for: their sales, newest first.
-- Partial, because the null rows are the majority and none of them is ever
-- fetched by this path.
CREATE INDEX ix_edge_sale_customer_time
    ON edge_sale (customer_id, occurred_at DESC)
    WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN edge_sale.customer_id IS
    'The shopper the till identified, when it identified one. NULL is an '
    'anonymous sale, not a missing value. Points on a sale with no customer '
    'were earned by nobody and are credited to nobody.';
