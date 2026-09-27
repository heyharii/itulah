-- id: commercial.redemption_matches_points
-- severity: high
-- rule: every points redemption took exactly the points it says it spent, once
-- enforced: DB partial unique indexes on points_ledger (0165) and loyalty_redemption (customer, key); Rust loyalty::redeem_points_to_voucher in one transaction
-- requires: loyalty_redemption, points_ledger
-- mutate: UPDATE loyalty_redemption SET points_spent = points_spent + 1 WHERE redemption_id = (SELECT redemption_id FROM loyalty_redemption ORDER BY redemption_id LIMIT 1)
SELECT r.redemption_id, r.customer_id, r.points_spent, -COALESCE(SUM(l.points), 0) AS taken, COUNT(l.entry_id) AS ledger_rows
  FROM loyalty_redemption r
  LEFT JOIN points_ledger l ON l.redemption_id = r.redemption_id AND l.entry_type = 'REDEEM_TO_VOUCHER'
 GROUP BY r.redemption_id, r.customer_id, r.points_spent
HAVING COUNT(l.entry_id) <> 1 OR -COALESCE(SUM(l.points), 0) <> r.points_spent
