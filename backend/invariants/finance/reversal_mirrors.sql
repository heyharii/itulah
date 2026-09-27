-- id: finance.reversal_mirrors
-- severity: critical
-- rule: a REVERSAL entry is the exact mirror of the entry it reverses — same accounts, sites, counter sites and categories, debit and credit swapped
-- enforced: Rust poster::reverse copies the lines; DB only guarantees one reversal per entry (UNIQUE reversal_of)
-- requires: journal_entry, journal_line
-- mutate: UPDATE journal_line SET account_code = CASE WHEN account_code = '1002' THEN '1003' ELSE '1002' END WHERE line_id = (SELECT l.line_id FROM journal_line l JOIN journal_entry e ON e.entry_id = l.entry_id WHERE e.source_kind = 'REVERSAL' ORDER BY l.line_id LIMIT 1)
WITH pairs AS (
    SELECT r.entry_id AS reversal_id, r.entry_number, r.reversal_of AS original_id
      FROM journal_entry r
     WHERE r.reversal_of IS NOT NULL
), expected AS (
    SELECT p.reversal_id, l.account_code, l.site_id, l.counter_site_id, l.category_code,
           l.credit_minor AS debit_minor, l.debit_minor AS credit_minor
      FROM pairs p JOIN journal_line l ON l.entry_id = p.original_id
), actual AS (
    SELECT p.reversal_id, l.account_code, l.site_id, l.counter_site_id, l.category_code,
           l.debit_minor, l.credit_minor
      FROM pairs p JOIN journal_line l ON l.entry_id = p.reversal_id
), diff AS (
    (SELECT 'missing from the reversal' AS problem, * FROM (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual) a)
    UNION ALL
    (SELECT 'not in the original' AS problem, * FROM (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected) b)
)
SELECT p.entry_number, d.*
  FROM diff d JOIN pairs p ON p.reversal_id = d.reversal_id
