-- 0076: Which promotions came off a particular sale.
--
-- A shop already sends this. Every completed sale carries the promotions that
-- actually applied — the rule, the campaign it sat in, the code that unlocked
-- it, and what each was worth — and the centre reads that list once, adds it to
-- the running totals in `commercial_usage`, and throws it away.
--
-- So the aggregate question has an answer and the particular one does not.
-- "What has the Lebaran promo cost us" is answerable; "why was this customer
-- charged this" is not. All that survives on the sale is one
-- `discount_total_minor`, which says a discount happened and nothing about
-- which. That is the question people actually ask — at a counter, with a
-- customer waiting — and it is the one we were discarding the answer to.
--
-- These are FACTS about a sale that has already happened, not decisions: the
-- rule that applied may since have been superseded, its campaign may have
-- ended, and the coupon may have been spent. Nothing here is a foreign key into
-- the commercial tables for exactly that reason — a receipt has to stay
-- readable after the promotion it names is gone, the same way `edge_sale_line`
-- keeps the sku_code and not a join.

CREATE TABLE edge_sale_promotion (
    sale_id       uuid NOT NULL REFERENCES edge_sale(sale_id) ON DELETE CASCADE,
    -- As the shop reported them, and as `commercial_usage` is keyed.
    rule_id       text NOT NULL CHECK (btrim(rule_id) <> ''),
    campaign_id   text,
    -- Present only when a code unlocked this promotion. A code typed and
    -- refused never reaches here, so this column can never overstate a
    -- redemption.
    coupon_code   text,
    -- What it took off, in the sale's own currency's minor unit.
    benefit_minor bigint NOT NULL CHECK (benefit_minor >= 0),
    PRIMARY KEY (sale_id, rule_id)
);

-- "Which sales did this promotion touch" — the question a merchandiser asks
-- after seeing a number they did not expect on the usage screen.
CREATE INDEX ix_sale_promotion_rule ON edge_sale_promotion (rule_id);
CREATE INDEX ix_sale_promotion_campaign ON edge_sale_promotion (campaign_id)
    WHERE campaign_id IS NOT NULL;
CREATE INDEX ix_sale_promotion_coupon ON edge_sale_promotion (coupon_code)
    WHERE coupon_code IS NOT NULL;

COMMENT ON TABLE edge_sale_promotion IS
    'What each promotion took off one sale. Written from the same accepted fact '
    'that increments commercial_usage, so the total and the detail cannot '
    'disagree; kept as text rather than keys so a receipt outlives the '
    'promotion it names.';
