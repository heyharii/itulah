-- 0037: A shop holds what a started promotion covers.
--
-- A till decides whether a promotion applies to a garment by matching the
-- rule's selector — `Tag = Denim` — against the tags in its own copy of the
-- catalogue, on every basket. So a merchandiser tagging an article at head
-- office on Tuesday changed what a promotion that started on Monday gave away,
-- in every shop, with nothing saying so.
--
-- The centre now resolves a rule's products once, when its window opens
-- (Postgres `0175`), and sends the answer down the same lane the usage counts
-- and campaign switches travel — `commercial.eligibility.v1`. This is where a
-- shop keeps it.
--
-- It does not replace the rule. `commercial_rule.definition_json` stays exactly
-- as it was published; the frozen set is applied over a copy of it while the
-- pricing snapshot is being built, the way `caps` already absorbs usage counts
-- at the same moment. A rule with no row here is a rule the centre has not
-- frozen — one that has not started — and its selector is still read.

CREATE TABLE IF NOT EXISTS commercial_rule_eligibility (
    rule_id     TEXT PRIMARY KEY,
    -- The centre's clock at the moment it resolved, carried so a shop can say
    -- WHEN the offer was fixed rather than only that it was.
    resolved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commercial_rule_eligibility_sku (
    rule_id  TEXT NOT NULL REFERENCES commercial_rule_eligibility(rule_id) ON DELETE CASCADE,
    sku_code TEXT NOT NULL,
    -- Which half of the rule's scope: APPLIES_TO is what the offer reads,
    -- EFFECT_ON is where the discount lands when that is somewhere else. A
    -- till that folded the two together would make every shirt in "buy a suit,
    -- get 50% off a shirt" a buyer.
    role     TEXT NOT NULL DEFAULT 'APPLIES_TO'
             CHECK (role IN ('APPLIES_TO', 'EFFECT_ON')),
    PRIMARY KEY (rule_id, sku_code, role)
);

CREATE INDEX IF NOT EXISTS ix_rule_eligibility_rule
    ON commercial_rule_eligibility_sku (rule_id);
