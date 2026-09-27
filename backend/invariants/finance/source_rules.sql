-- id: finance.source_rules
-- severity: high
-- rule: an account with an ALLOW list takes only those document kinds, and never a DENY kind — Modal Kasir 1004 pays for nothing (I6), 1110 only by hand (I12), Prive 3004 (P21), 1402×PPH29, 1610, 7101
-- enforced: Rust validate_account_posting reading account_source_rule; no DB trigger reads the table. Reversals are exempt (they undo what was allowed then).
-- requires: journal_entry, journal_line, account_source_rule
-- mutate: UPDATE journal_line SET account_code = '1004' WHERE line_id = (SELECT l.line_id FROM journal_line l JOIN journal_entry e USING (entry_id) WHERE e.source_kind NOT IN ('CASH_SHIFT', 'OPENING', 'REVERSAL') AND l.account_code IN ('1002', '1003') ORDER BY l.line_id LIMIT 1)
WITH rules AS (
    SELECT l.line_id,
           ARRAY_AGG(r.source_kind) FILTER (WHERE r.effect = 'ALLOW') AS allowed,
           ARRAY_AGG(r.source_kind) FILTER (WHERE r.effect = 'DENY')  AS denied
      FROM journal_line l
      JOIN account_source_rule r
        ON r.account_code = l.account_code
       AND (r.category_code IS NULL OR r.category_code = l.category_code)
     GROUP BY l.line_id
)
SELECT l.entry_id, e.entry_number, e.source_kind, l.line_number, l.account_code, l.category_code, l.site_id,
       r.allowed, r.denied
  FROM rules r
  JOIN journal_line l ON l.line_id = r.line_id
  JOIN journal_entry e ON e.entry_id = l.entry_id
 WHERE e.source_kind <> 'REVERSAL'
   AND (e.source_kind = ANY (COALESCE(r.denied, '{}'))
        OR (r.allowed IS NOT NULL AND NOT e.source_kind = ANY (r.allowed)))
