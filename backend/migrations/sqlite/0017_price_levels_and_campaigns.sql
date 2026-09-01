-- 0017: Prices that name a group of shops or a membership tier, and the
-- campaigns that wrap a set of promotions.
--
-- Until now a price was either one shop's or the whole company's. Two levels
-- between those turn out to matter: a group ("every Jakarta shop") and a tier
-- ("gold members"), and expressing either by writing out one row per shop is
-- how a price list drifts.
--
-- The columns are additive and nullable, so every price already resident keeps
-- meaning exactly what it meant: a site_id names one shop, and its absence
-- names the company.

PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

-- A JSON array of shop ids. Present only for a group-level price.
ALTER TABLE commercial_price_rule ADD COLUMN site_ids_json TEXT
    CHECK (site_ids_json IS NULL
           OR (json_valid(site_ids_json) AND json_type(site_ids_json) = 'array'));
-- Present only for a tier-level price.
ALTER TABLE commercial_price_rule ADD COLUMN tier TEXT;

ALTER TABLE commercial_markdown ADD COLUMN site_ids_json TEXT
    CHECK (site_ids_json IS NULL
           OR (json_valid(site_ids_json) AND json_type(site_ids_json) = 'array'));
ALTER TABLE commercial_markdown ADD COLUMN tier TEXT;

-- The envelope a set of promotions shares: one window, one budget, one switch.
--
-- Its absence is not neutral. A promotion rule that names a campaign this shop
-- does not hold refuses to apply — see the pricing engine's gate for why
-- failing closed is the only safe reading of "I belong to something you have
-- never heard of".
CREATE TABLE IF NOT EXISTS commercial_campaign (
    campaign_id    TEXT PRIMARY KEY,
    publication_id TEXT NOT NULL REFERENCES commercial_publication(id),
    name           TEXT NOT NULL CHECK (trim(name) <> ''),
    status         TEXT NOT NULL
                   CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','PAUSED','EXPIRED','CANCELLED')),
    valid_from     TEXT,
    valid_to       TEXT,
    -- Shared across every rule in the campaign. NULL is unlimited.
    budget_minor   INTEGER CHECK (budget_minor IS NULL OR budget_minor >= 0),
    spent_minor    INTEGER NOT NULL DEFAULT 0 CHECK (spent_minor >= 0),
    max_uses       INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    used           INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
    max_uses_per_customer INTEGER
                   CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0),
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);

-- A sale line records what kind of thing it was, so a carrier bag and an
-- alteration charge never land in merchandise net sales.
ALTER TABLE sale_line ADD COLUMN posting_class TEXT;

-- And the fingerprint of the pricing decision behind the sale, so a disputed
-- receipt can be reproduced rather than argued about.
ALTER TABLE sale ADD COLUMN pricing_trace_id TEXT;

COMMIT;
PRAGMA foreign_keys=ON;
