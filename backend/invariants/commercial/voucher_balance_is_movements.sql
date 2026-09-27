-- id: commercial.voucher_balance_is_movements
-- severity: critical
-- rule: a voucher's balance is the sum of its movements, and every movement's running balance adds up in sequence
-- enforced: DB deferred trigger voucher_movement_consistency (0090, on movement INSERT only — an UPDATE of voucher.balance_minor is not re-checked); Rust single writer vouchers.rs
-- requires: voucher, voucher_movement
-- mutate: UPDATE voucher SET balance_minor = balance_minor - 1 WHERE voucher_id = (SELECT voucher_id FROM voucher WHERE balance_minor > 1 ORDER BY voucher_id LIMIT 1)
SELECT v.voucher_id, v.code, v.balance_minor, t.total AS from_movements, NULL::bigint AS seq, 'balance is not the movements' AS problem
  FROM voucher v
  LEFT JOIN LATERAL (SELECT COALESCE(SUM(m.amount_minor), 0) AS total FROM voucher_movement m WHERE m.voucher_id = v.voucher_id) t ON true
 WHERE v.balance_minor <> t.total
UNION ALL
SELECT x.voucher_id, NULL, x.balance_after_minor, x.running, x.seq, 'running balance breaks'
  FROM (SELECT m.*, SUM(m.amount_minor) OVER (PARTITION BY m.voucher_id ORDER BY m.seq) AS running
          FROM voucher_movement m) x
 WHERE x.running <> x.balance_after_minor
