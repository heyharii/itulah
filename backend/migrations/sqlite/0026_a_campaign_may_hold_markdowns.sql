-- 0026: The shop's half — a campaign that may hold price drops, not only rules.
--
-- Mirrors postgres 0087. See that migration for why a markdown's campaign gate
-- is the opposite way round from a rule's: a rule under a missing campaign
-- fails closed and the shopper pays list, which is safe; a markdown that failed
-- closed would charge more than the ticket on the garment, at the counter, at
-- the shop furthest behind on sync.
ALTER TABLE commercial_campaign ADD COLUMN image_url TEXT;
ALTER TABLE commercial_campaign ADD COLUMN headline TEXT;
ALTER TABLE commercial_campaign ADD COLUMN terms TEXT;

ALTER TABLE commercial_markdown ADD COLUMN campaign_id TEXT;

CREATE INDEX IF NOT EXISTS ix_markdown_campaign
    ON commercial_markdown (campaign_id) WHERE campaign_id IS NOT NULL;
