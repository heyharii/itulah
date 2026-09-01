-- 0016: Markdowns, promotion rules, and the coupons that unlock them.
--
-- Three tables and three different shapes, on purpose:
--
--   MARKDOWN   a price source. Stable shape, worth constraining, and queried
--              by product — so it gets real columns and a real CHECK.
--   RULE       an effect. Its shape is an enum owned by the pricing engine and
--              it will grow; the edge only ever loads every rule and hands the
--              lot to that engine, never querying their internals. So the rule
--              is stored as the engine's own document. A column per field would
--              have to be migrated in lockstep with the enum and would lose
--              whatever it did not yet know about — a lossy mirror of a
--              definition that decides prices is worse than an opaque one.
--   COUPON     a gate. Simple, tabular, and looked up by code.
--
-- All three belong to a publication and travel with it, so a shop cannot end up
-- honouring a promotion from a price book it has already replaced.

PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS commercial_markdown (
    markdown_id                  TEXT PRIMARY KEY,
    publication_id               TEXT NOT NULL REFERENCES commercial_publication(id),
    -- One product, or every variant of a style. A markdown naming a SKU beats
    -- one naming its article, so a single colour can be cleared harder.
    sku_code                     TEXT,
    article_code                 TEXT,
    -- NULL means every shop.
    site_id                      TEXT,
    replacement_unit_price_minor INTEGER NOT NULL CHECK (replacement_unit_price_minor >= 0),
    priority                     INTEGER NOT NULL DEFAULT 0,
    effective_from               TEXT NOT NULL,
    effective_to                 TEXT,
    -- A markdown that names neither is a markdown on everything. Two empty
    -- fields must never become "the whole shop at this price".
    CHECK (sku_code IS NOT NULL OR article_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_markdown_sku
    ON commercial_markdown (sku_code) WHERE sku_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_markdown_article
    ON commercial_markdown (article_code) WHERE article_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS commercial_rule (
    rule_id        TEXT PRIMARY KEY,
    publication_id TEXT NOT NULL REFERENCES commercial_publication(id),
    name           TEXT NOT NULL,
    -- The engine's own serialisation of the rule, stored verbatim. Validated as
    -- JSON here; validated as a rule when it is parsed, which is the only place
    -- that knows what a rule is.
    definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
    -- Denormalised only so a shop can be asked "what promotions do you hold"
    -- without parsing every document. Never read by the pricing path.
    status         TEXT NOT NULL,
    priority       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS commercial_coupon (
    code           TEXT PRIMARY KEY,
    publication_id TEXT NOT NULL REFERENCES commercial_publication(id),
    -- The one rule this code opens. A coupon never carries a discount of its
    -- own: one place calculates a benefit, so a code cannot disagree with the
    -- promotion it unlocks.
    rule_id        TEXT NOT NULL,
    active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    -- NULL means bearer paper: whoever holds the code may use it.
    customer_id    TEXT,
    valid_from     TEXT,
    valid_to       TEXT,
    max_uses       INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    used           INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0)
);

CREATE INDEX IF NOT EXISTS ix_coupon_rule ON commercial_coupon (rule_id);

COMMIT;
PRAGMA foreign_keys=ON;
