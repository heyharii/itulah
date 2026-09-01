-- 0032: The centre's side of group prices, tier prices, and campaigns.
--
-- Mirrors edge migration 0017. Two levels sit between "this one shop" and "the
-- whole company", and expressing either by writing one row per shop is how a
-- price list drifts: a shop opens, nobody remembers the list, and it quietly
-- sells at the company price.

ALTER TABLE commercial_price_rule ADD COLUMN site_ids text[];
ALTER TABLE commercial_price_rule ADD COLUMN tier text;
ALTER TABLE commercial_markdown ADD COLUMN site_ids text[];
ALTER TABLE commercial_markdown ADD COLUMN tier text;

-- Only one level per price. A row claiming to be both a shop price and a tier
-- price has no single right reading, and picking one silently is how the centre
-- and a till come to disagree about a number neither can show you.
ALTER TABLE commercial_price_rule ADD CONSTRAINT price_rule_names_one_level
    CHECK (
        (site_id IS NOT NULL)::int
      + (site_ids IS NOT NULL AND cardinality(site_ids) > 0)::int
      + (tier IS NOT NULL)::int
      <= 1
    );

ALTER TABLE commercial_markdown ADD CONSTRAINT markdown_names_one_level
    CHECK (
        (site_id IS NOT NULL)::int
      + (site_ids IS NOT NULL AND cardinality(site_ids) > 0)::int
      + (tier IS NOT NULL)::int
      <= 1
    );

-- The envelope a set of promotions shares: one window, one budget, one switch.
--
-- Its absence at a shop is not neutral. A promotion naming a campaign the shop
-- does not hold refuses to apply, so a campaign that fails to sync disables its
-- offers rather than freeing them — see the pricing engine's gate.
CREATE TABLE commercial_campaign (
    id                    uuid PRIMARY KEY,
    publication_id        uuid NOT NULL REFERENCES commercial_publication(id) ON DELETE CASCADE,
    campaign_id           text NOT NULL CHECK (btrim(campaign_id) <> ''),
    name                  text NOT NULL CHECK (btrim(name) <> ''),
    status                text NOT NULL
                          CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','PAUSED','EXPIRED','CANCELLED')),
    valid_from            timestamptz,
    valid_to              timestamptz,
    budget_minor          bigint CHECK (budget_minor IS NULL OR budget_minor >= 0),
    spent_minor           bigint NOT NULL DEFAULT 0 CHECK (spent_minor >= 0),
    max_uses              integer CHECK (max_uses IS NULL OR max_uses > 0),
    used                  integer NOT NULL DEFAULT 0 CHECK (used >= 0),
    max_uses_per_customer integer CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT campaign_window_is_ordered
        CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
    UNIQUE (publication_id, campaign_id)
);

CREATE INDEX ix_campaign_publication ON commercial_campaign (publication_id);
