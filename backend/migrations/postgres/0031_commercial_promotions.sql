-- 0031: Markdowns, promotion rules, and coupons at the centre.
--
-- These mirror what a shop holds (edge migration 0016) and travel with the
-- publication that authored them, so a promotion cannot outlive the price book
-- it was written against.
--
-- The rule is stored as the pricing engine's own document rather than a column
-- per field. A rule's shape is an enum owned by that engine and it will grow;
-- a table that mirrored it would have to be migrated in lockstep and would
-- silently drop whatever it did not yet know about. Dropping part of a
-- definition that decides prices is worse than storing it opaquely — and
-- nothing here ever queries inside a rule. The centre validates the document as
-- a rule when it is authored, which is the one place that knows what a rule is.

CREATE TABLE commercial_markdown (
    id                           uuid PRIMARY KEY,
    publication_id               uuid NOT NULL REFERENCES commercial_publication(id) ON DELETE CASCADE,
    markdown_id                  text NOT NULL,
    sku_id                       uuid REFERENCES sku(id),
    -- The code the shop floor names this product by. Carried beside the id for
    -- the same reason the price rule carries it: a shop's catalogue is keyed by
    -- code, and a clearance that arrives with only a UUID marks nothing down.
    sku_code                     text,
    article_code                 text,
    site_id                      text REFERENCES site(id),
    replacement_unit_price_minor bigint NOT NULL CHECK (replacement_unit_price_minor >= 0),
    priority                     integer NOT NULL DEFAULT 0,
    effective_from               timestamptz NOT NULL,
    effective_to                 timestamptz,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    -- A markdown naming neither is a markdown on everything.
    CONSTRAINT markdown_names_its_goods
        CHECK (sku_code IS NOT NULL OR article_code IS NOT NULL),
    CONSTRAINT markdown_window_is_ordered
        CHECK (effective_to IS NULL OR effective_to > effective_from),
    UNIQUE (publication_id, markdown_id)
);

CREATE INDEX ix_markdown_publication ON commercial_markdown (publication_id);

CREATE TABLE commercial_rule (
    id              uuid PRIMARY KEY,
    publication_id  uuid NOT NULL REFERENCES commercial_publication(id) ON DELETE CASCADE,
    rule_id         text NOT NULL CHECK (btrim(rule_id) <> ''),
    name            text NOT NULL CHECK (btrim(name) <> ''),
    definition      jsonb NOT NULL,
    status          text NOT NULL,
    priority        integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (publication_id, rule_id)
);

CREATE INDEX ix_rule_publication ON commercial_rule (publication_id);

CREATE TABLE commercial_coupon (
    id              uuid PRIMARY KEY,
    publication_id  uuid NOT NULL REFERENCES commercial_publication(id) ON DELETE CASCADE,
    code            text NOT NULL CHECK (btrim(code) <> ''),
    -- The one rule this code opens. A coupon never carries a discount of its
    -- own: one place calculates a benefit, so a code cannot disagree with the
    -- promotion it unlocks.
    rule_id         text NOT NULL CHECK (btrim(rule_id) <> ''),
    active          boolean NOT NULL DEFAULT true,
    -- NULL means bearer paper: whoever holds the code may use it.
    customer_id     text,
    valid_from      timestamptz,
    valid_to        timestamptz,
    max_uses        integer CHECK (max_uses IS NULL OR max_uses > 0),
    used            integer NOT NULL DEFAULT 0 CHECK (used >= 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT coupon_window_is_ordered
        CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
    UNIQUE (publication_id, code)
);

CREATE INDEX ix_coupon_publication ON commercial_coupon (publication_id);

COMMENT ON TABLE commercial_rule IS
    'A promotion, stored as the pricing engine''s own document. Validated as a '
    'rule when authored; never queried field by field.';
