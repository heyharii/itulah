-- 0181: A frozen promotion remembers which half each product was in.
--
-- `0175` recorded the SKUs a started rule resolved to, as one set. That is
-- enough to answer "what did this promotion cover" and not enough to *price*
-- with, which is what the set is now for.
--
-- A rule has two product scopes. `scope.applicability` is what the offer reads;
-- `scope.effect_on` is where the money lands when that is somewhere else —
-- "buy a suit, get 50% off a shirt" names the suits in the first and the shirts
-- in the second. One flat set cannot tell them apart, and a shop that replaced
-- the applicability with the union would turn every shirt into a buyer.
--
-- So each frozen SKU now says which half it was in. `APPLIES_TO` is the default
-- and the only one most rules have.
--
-- Existing rows are `APPLIES_TO`: at the time this runs, the only frozen rules
-- are the ones the pass wrote since yesterday, and a rule with an `effect_on`
-- would have had both halves flattened into one set. Re-resolving them is not
-- an option — see the header of 0175 on why a frozen answer is never rewritten
-- — so any such rule keeps a union that reads as applicability, and the freeze
-- pass will never produce another.

ALTER TABLE commercial_rule_eligibility_sku
    ADD COLUMN role text NOT NULL DEFAULT 'APPLIES_TO'
        CHECK (role IN ('APPLIES_TO', 'EFFECT_ON'));

-- The primary key has to carry the role: one SKU can legitimately be in both
-- halves of the same rule — a promotion that discounts what it is triggered by
-- is the ordinary case — and (rule, sku) would have refused the second row.
ALTER TABLE commercial_rule_eligibility_sku
    DROP CONSTRAINT commercial_rule_eligibility_sku_pkey;
ALTER TABLE commercial_rule_eligibility_sku
    ADD PRIMARY KEY (rule_id, sku_code, role);

COMMENT ON COLUMN commercial_rule_eligibility_sku.role IS
    'Which half of the rule scope this product was frozen in: APPLIES_TO for '
    'scope.applicability, EFFECT_ON for scope.effect_on.';
