-- id: commercial.usage_matches_sale_facts
-- severity: high
-- rule: what the centre counts as a promotion's uses and spend is exactly what the accepted sale facts say (voided sales count, by design)
-- enforced: Rust single writer sync.rs apply_sale (INSERT … ON CONFLICT uses = uses + 1) behind the sale guard; write_authority.rs names it; no rebuild exists
-- requires: commercial_usage, edge_sale_promotion
-- mutate: UPDATE commercial_usage SET uses = uses + 1 WHERE (kind, key) = (SELECT kind, key FROM commercial_usage ORDER BY kind, key LIMIT 1)
WITH f AS (
    SELECT 'RULE' AS kind, rule_id::text AS key, benefit_minor FROM edge_sale_promotion
    UNION ALL
    SELECT 'CAMPAIGN', campaign_id::text, benefit_minor FROM edge_sale_promotion WHERE campaign_id IS NOT NULL
    UNION ALL
    SELECT 'COUPON', coupon_code, benefit_minor FROM edge_sale_promotion WHERE coupon_code IS NOT NULL
), counted AS (
    SELECT kind, key, COUNT(*)::bigint AS uses, SUM(benefit_minor)::bigint AS spent FROM f GROUP BY kind, key
)
SELECT COALESCE(c.kind, u.kind) AS kind, COALESCE(c.key, u.key::text) AS key,
       c.uses AS from_facts, u.uses AS counted, c.spent AS spent_from_facts, u.spent_minor AS spent_counted
  FROM counted c
  FULL JOIN commercial_usage u ON u.kind = c.kind AND u.key::text = c.key
 WHERE c.uses IS DISTINCT FROM u.uses OR c.spent IS DISTINCT FROM u.spent_minor
