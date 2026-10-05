-- id: finance.counter_unit_named
-- severity: high
-- rule: a line on an account that requires a counter site names the unit on the other side
-- enforced: Rust validate_account_posting (requires_counter_site); no DB check on the line
-- requires: journal_entry, journal_line, ledger_account
-- mutate: UPDATE journal_line SET counter_unit_id = NULL WHERE line_id = (SELECT l.line_id FROM journal_line l JOIN ledger_account a USING (account_code) WHERE a.requires_counter_site AND l.counter_unit_id IS NOT NULL ORDER BY l.line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, l.line_number, l.account_code, a.name, l.unit_id
  FROM journal_line l
  JOIN ledger_account a ON a.account_code = l.account_code
  JOIN journal_entry e ON e.entry_id = l.entry_id
 WHERE a.requires_counter_site
   AND l.counter_unit_id IS NULL
   AND e.source_kind NOT IN ('OPENING', 'REVERSAL')
