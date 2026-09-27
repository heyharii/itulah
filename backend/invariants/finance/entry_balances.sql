-- id: finance.entry_balances
-- severity: critical
-- rule: every journal entry has lines, its debits equal its credits, and its header total equals them (I3)
-- enforced: DB — deferred constraint triggers journal_entry_balances / journal_line_balances (0051); Rust poster::check_balanced
-- requires: journal_entry, journal_line
-- mutate: UPDATE journal_line SET debit_minor = debit_minor + 1 WHERE line_id = (SELECT line_id FROM journal_line WHERE debit_minor > 0 ORDER BY line_id LIMIT 1)
SELECT e.entry_id, e.entry_number, e.source_kind, e.total_minor,
       COALESCE(SUM(l.debit_minor), 0)  AS debits,
       COALESCE(SUM(l.credit_minor), 0) AS credits,
       COUNT(l.line_id)                 AS lines
  FROM journal_entry e
  LEFT JOIN journal_line l ON l.entry_id = e.entry_id
 GROUP BY e.entry_id
HAVING COUNT(l.line_id) = 0
    OR COALESCE(SUM(l.debit_minor), 0) <> COALESCE(SUM(l.credit_minor), 0)
    OR COALESCE(SUM(l.debit_minor), 0) <> e.total_minor
