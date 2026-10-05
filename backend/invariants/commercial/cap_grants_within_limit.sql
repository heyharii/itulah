-- id: commercial.cap_grants_within_limit
-- severity: high
-- rule: the per-shop split of a promotion limit never hands out more than the limit (0387)
-- enforced: Rust cap_allocation::rebalance_allocations locks the policy in a transaction before reading and atomically writing all grants, including retired origins in pool accounting; DB stops grants shrinking. A lowered limit takes nothing back, so a finding after a limit change is expected.
-- requires: commercial_cap_allocation
-- mutate: UPDATE commercial_cap_allocation SET granted = granted + limit_value + 1 WHERE (kind, key, measure, origin_id) = (SELECT kind, key, measure, origin_id FROM commercial_cap_allocation ORDER BY 1, 2, 3, 4 LIMIT 1)
SELECT kind, key, measure, SUM(granted) AS granted, MAX(limit_value) AS limit_value, COUNT(*) AS shops
  FROM commercial_cap_allocation
 GROUP BY kind, key, measure
HAVING SUM(granted) > MAX(limit_value)
