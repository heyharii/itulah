-- 0036: Which shop is charging which price book, and since when.
--
-- The centre could publish prices and had no way to ask who was using them. A
-- shop whose sync had stalled looked exactly like one that was up to date, and
-- the difference between those two is whether somebody needs to drive out
-- there.
--
-- Nobody ticks a list to fill this in. A shop reports when it puts a book into
-- service, in the same transaction that puts it into service, so the two cannot
-- disagree.
--
-- The shop is not taken from the payload. Every fact is attributed to the
-- origin that signed for it, and a payload naming its own site would be a claim
-- rather than an attribution — weaker than the one the lane already makes, and
-- able to contradict it.

CREATE TABLE commercial_publication_activation (
    publication_id    uuid NOT NULL REFERENCES commercial_publication(id),
    origin_id         text NOT NULL,
    -- Resolved from the origin's credential at the moment the fact landed, so
    -- a later re-pointing of that node does not rewrite history.
    site_id           text,
    version           bigint NOT NULL,
    -- The shop's own clock: since when it has been charging these prices.
    activated_at      timestamptz NOT NULL,
    -- The centre's clock: when it found out. The gap between the two is the
    -- number worth watching.
    reported_at       timestamptz NOT NULL DEFAULT now(),
    -- How much of the book arrived, so a truncated delivery shows as a number
    -- rather than as a wrong price weeks later.
    price_rule_count  bigint NOT NULL CHECK (price_rule_count >= 0),
    PRIMARY KEY (publication_id, origin_id)
);

CREATE INDEX ix_publication_activation_site
    ON commercial_publication_activation (site_id, version DESC);

COMMENT ON TABLE commercial_publication_activation IS
    'Which shops have put which price book into service. Reported by the shop '
    'itself, in the transaction that activated it — never ticked off by hand.';
