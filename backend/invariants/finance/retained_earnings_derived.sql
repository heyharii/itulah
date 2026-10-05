-- id: finance.retained_earnings_derived
-- severity: high
-- rule: current-period profit is derived; no automatic document writes retained earnings 3003 — only Finance HO by hand, or the opening import (I10)
-- enforced: nowhere at write time — close_period / period_close only seal the month; 3003 is MANUAL/YES with no source rule
-- requires: journal_entry, journal_line
-- mutate: UPDATE journal_line SET account_code = '3003' WHERE line_id = (SELECT l.line_id FROM journal_line l JOIN journal_entry e USING (entry_id) WHERE e.source_kind NOT IN ('MANUAL', 'RECLASS', 'ADJUSTMENT', 'WRITE_OFF', 'OPENING', 'REVERSAL', 'EQUITY_MOVEMENT') ORDER BY l.line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, e.posting_date, l.line_number, l.unit_id,
       l.debit_minor, l.credit_minor
  FROM journal_line l
  JOIN journal_entry e ON e.entry_id = l.entry_id
 WHERE l.account_code = '3003'
   AND e.source_kind NOT IN ('MANUAL', 'RECLASS', 'ADJUSTMENT', 'WRITE_OFF', 'OPENING', 'REVERSAL', 'EQUITY_MOVEMENT')
