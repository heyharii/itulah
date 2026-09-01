-- 0035: What a promotion has actually cost, and how often a code has been used.
--
-- The limits were put in the wrong place. A rule's budget, a campaign's budget
-- and a coupon's use count all lived INSIDE the publication that declared them
-- — a document the database holds immutable once published, and one that
-- travels to shops on the rhythm of a season. The counts they were meant to
-- carry change on the rhythm of a sale.
--
-- So nothing ever incremented them, and nothing could: there was nowhere to
-- write. A coupon marked single-use worked at every shop, forever, and a
-- campaign budget never fell by a rupiah.
--
-- The separation this table makes is the fix. A publication states the LIMIT,
-- which is a decision and belongs frozen with the price book. This table holds
-- the COUNT, which is an observation and belongs where observations go.
--
-- It is built only from sale facts that have already been accepted, so it
-- inherits their idempotency: a resent sale lands once, and counts once.

CREATE TABLE commercial_usage (
    kind        text NOT NULL CHECK (kind IN ('RULE', 'CAMPAIGN', 'COUPON')),
    -- The rule_id, campaign_id or coupon code, as the shop reported it.
    key         text NOT NULL CHECK (btrim(key) <> ''),
    uses        bigint NOT NULL DEFAULT 0 CHECK (uses >= 0),
    spent_minor bigint NOT NULL DEFAULT 0 CHECK (spent_minor >= 0),
    first_used_at timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, key)
);

-- Per-shopper counts, for the limit that says "once per customer".
CREATE TABLE commercial_usage_customer (
    kind        text NOT NULL CHECK (kind IN ('RULE', 'CAMPAIGN', 'COUPON')),
    key         text NOT NULL CHECK (btrim(key) <> ''),
    customer_id text NOT NULL CHECK (btrim(customer_id) <> ''),
    uses        bigint NOT NULL DEFAULT 0 CHECK (uses >= 0),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, key, customer_id)
);

COMMENT ON TABLE commercial_usage IS
    'Running totals of what promotions have given away. Deliberately outside '
    'commercial_publication: a limit is a decision and is frozen with the price '
    'book; a count is an observation and changes with every sale.';
