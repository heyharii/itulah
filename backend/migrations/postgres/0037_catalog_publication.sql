-- 0037: What product list the centre last sent, and when.
--
-- `publish_catalog` has existed for a long time and nothing has ever called it:
-- no route, no agent. So shops learned about new products only when somebody
-- ran it by hand, which in practice was never — a garment could be tagged,
-- shipped, received and sold while the shop's own product list had never heard
-- of it.
--
-- Two things were missing before it could run on its own. A generation number
-- that only ever goes up, because an edge treats a lower one as stale and
-- ignores it. And a record of what was last sent, so the agent can tell a real
-- change from another tick of the clock — publishing an identical catalogue
-- every few minutes would flood every shop's command lane with a list it
-- already has.

CREATE TABLE catalog_publication (
    generation   bigint PRIMARY KEY CHECK (generation > 0),
    snapshot_id  uuid NOT NULL,
    -- The hash of the whole list. Comparing it is how the agent decides
    -- whether anything actually changed.
    content_hash text NOT NULL,
    item_count   bigint NOT NULL CHECK (item_count >= 0),
    published_by text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE catalog_publication IS
    'Each product list the centre has sent to the fleet. The newest row is what '
    'shops should be holding; its hash is what tells the publisher whether '
    'there is anything new to send.';
