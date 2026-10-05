-- id: finance.unit_balances
-- severity: critical
-- rule: an entry balances inside every unit it touches, so each unit's own books balance (I3)
-- enforced: DB — deferred constraint trigger journal_line_balances_per_unit (0605; per site from 0120, INSERT only); Rust poster::balanced_per_site
-- requires: journal_entry, journal_line
-- mutate: UPDATE journal_line SET unit_id = (SELECT id FROM unit WHERE id <> journal_line.unit_id ORDER BY id LIMIT 1) WHERE line_id = (SELECT line_id FROM journal_line ORDER BY line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, l.unit_id,
       SUM(l.debit_minor - l.credit_minor) AS out_by
  FROM journal_line l
  JOIN journal_entry e ON e.entry_id = l.entry_id
 GROUP BY l.entry_id, e.entry_number, e.source_kind, l.unit_id
HAVING SUM(l.debit_minor - l.credit_minor) <> 0
