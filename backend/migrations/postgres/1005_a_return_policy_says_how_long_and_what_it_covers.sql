-- 1005: a return policy says how long, what it covers, and what a shop may
-- exchange without asking anybody.
--
-- Until this migration the only return rule in the company was one string at
-- the foot of every receipt: "Penukaran maksimal 7 hari dengan struk ini."
-- (`RECEIPT_FOOTER`, `backend/src/edge/sqlite.rs`). It was a constant because
-- no screen could change it, and it said nothing about which goods were
-- covered or what a shop could exchange.
--
-- The owner's rules (28 Oct 2026):
--
--   * how many days a return is allowed is a global setting, and a policy may
--     narrow or widen it for a division, a tag or an article;
--   * a piece may be exchanged for the SAME article even when today's selling
--     price differs from what was paid — a markdown today is not a reason to
--     refuse tomorrow — provided the article's HPP and supplier are unchanged;
--   * the receipt tells the customer the last day, and the two conditions that
--     make the piece returnable at all: the hang tag must still be attached
--     and undamaged, and the receipt must not be lost.
--
-- The setting is one row because it is the default every article falls back
-- to. A policy is the exception, and its scope is one kind with a list of
-- codes: a division, any number of tags, or any number of articles. One kind
-- per policy, because a row that mixed them would have no answer to "which
-- one matched" when two of its own targets disagreed.
--
-- The edge finds the most specific match (article beats tag beats division
-- beats the policy with no target beats the setting) and takes the LONGEST
-- window among equally specific matches: two tags are two entitlements, and
-- the shopper keeps the better one. The rule is stated here so the screen and
-- the till cannot invent two different answers.

CREATE TABLE return_policy_setting (
    singleton              smallint PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
    max_days               integer NOT NULL CHECK (max_days BETWEEN 1 AND 365),
    require_hang_tag       boolean NOT NULL DEFAULT true,
    require_receipt        boolean NOT NULL DEFAULT true,
    same_item_exchange     boolean NOT NULL DEFAULT true,
    same_item_same_cost    boolean NOT NULL DEFAULT true,
    same_item_same_supplier boolean NOT NULL DEFAULT true,
    updated_at             timestamptz NOT NULL DEFAULT now(),
    updated_by             text
);

INSERT INTO return_policy_setting (singleton, max_days)
VALUES (1, 7);

CREATE TABLE return_policy (
    policy_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL CHECK (btrim(name) <> ''),
    -- GLOBAL has no target rows: it applies everywhere. The other three name
    -- their targets in return_policy_target.
    scope_kind   text NOT NULL CHECK (scope_kind IN ('GLOBAL', 'DIVISION', 'TAG', 'ARTICLE')),
    max_days     integer NOT NULL CHECK (max_days BETWEEN 1 AND 365),
    active       boolean NOT NULL DEFAULT true,
    note         text,
    created_by   text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (policy_id, scope_kind)
);

-- One policy with no target is the fleet-wide override; a second one would be
-- two answers to the same question.
CREATE UNIQUE INDEX ux_return_policy_global
    ON return_policy (scope_kind)
    WHERE scope_kind = 'GLOBAL';

CREATE TABLE return_policy_target (
    policy_id  uuid NOT NULL,
    scope_kind text NOT NULL CHECK (scope_kind IN ('DIVISION', 'TAG', 'ARTICLE')),
    scope_code text NOT NULL CHECK (btrim(scope_code) <> ''),
    PRIMARY KEY (policy_id, scope_code),
    FOREIGN KEY (policy_id, scope_kind)
        REFERENCES return_policy (policy_id, scope_kind) ON DELETE CASCADE,
    CHECK (btrim(scope_code) = scope_code)
);

-- A division, tag or article belongs to ONE policy. Two policies naming the
-- same target would be two windows for one garment, and "most specific" would
-- stop being a rule.
CREATE UNIQUE INDEX ux_return_policy_target
    ON return_policy_target (scope_kind, scope_code);

CREATE INDEX ix_return_policy_target_policy ON return_policy_target (policy_id);

COMMENT ON TABLE return_policy IS
    'A window for a division, a tag or an article. The setting is the fallback; article beats tag beats division beats a policy with no target.';
COMMENT ON COLUMN return_policy_setting.same_item_exchange IS
    'A piece may be exchanged for the same article even when today''s price differs (owner, 28 Oct 2026).';
COMMENT ON COLUMN return_policy_setting.same_item_same_cost IS
    'The exchange is only the same item when the article''s HPP is unchanged.';
COMMENT ON COLUMN return_policy_setting.same_item_same_supplier IS
    'The exchange is only the same item when the article''s supplier is unchanged.';