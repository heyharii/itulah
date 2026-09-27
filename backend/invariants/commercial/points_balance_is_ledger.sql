-- id: commercial.points_balance_is_ledger
-- severity: critical
-- rule: a member's points balance is the sum of their points ledger
-- enforced: Rust single writer loyalty::append under lock_account (atomic UPDATE balance = balance + n); checkers loyalty::points_account / points_accounts; no DB check
-- requires: points_account, points_ledger
-- mutate: UPDATE points_account SET balance_points = balance_points + 1 WHERE customer_id = (SELECT customer_id FROM points_account ORDER BY customer_id LIMIT 1)
SELECT a.customer_id, a.balance_points, COALESCE(SUM(l.points), 0) AS from_ledger
  FROM points_account a
  LEFT JOIN points_ledger l ON l.customer_id = a.customer_id
 GROUP BY a.customer_id, a.balance_points
HAVING a.balance_points <> COALESCE(SUM(l.points), 0)
UNION ALL
SELECT l.customer_id, NULL, SUM(l.points)
  FROM points_ledger l
 WHERE NOT EXISTS (SELECT 1 FROM points_account a WHERE a.customer_id = l.customer_id)
 GROUP BY l.customer_id
