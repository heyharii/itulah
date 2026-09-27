-- id: finance.site_balances
-- severity: critical
-- rule: an entry balances inside every site it touches, so each shop's own books balance (I3)
-- enforced: DB — deferred constraint trigger journal_line_balances_per_site (0120, INSERT only; rows older than 0120 were never re-validated); Rust poster::balanced_per_site
-- requires: journal_entry, journal_line
-- mutate: UPDATE journal_line SET site_id = CASE WHEN site_id = 'dc' THEN 'store-01' ELSE 'dc' END WHERE line_id = (SELECT line_id FROM journal_line ORDER BY line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, l.site_id,
       SUM(l.debit_minor - l.credit_minor) AS out_by
  FROM journal_line l
  JOIN journal_entry e ON e.entry_id = l.entry_id
 GROUP BY l.entry_id, e.entry_number, e.source_kind, l.site_id
HAVING SUM(l.debit_minor - l.credit_minor) <> 0
