-- id: finance.affiliate_side
-- severity: high
-- rule: head office is always the piutang side (1057/1058/1059) and a unit always the hutang side (2028/2029/2030), whichever way value moved (I7)
-- enforced: data only — the affiliate links resolve by kind of unit (0460); nothing refuses a line that names the account directly
-- requires: journal_entry, journal_line, unit
-- mutate: UPDATE journal_line SET unit_id = head_office_unit_id() WHERE line_id = (SELECT line_id FROM journal_line WHERE account_code IN ('2028', '2029', '2030') ORDER BY line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, l.line_number, l.account_code, l.unit_id, l.counter_unit_id,
       CASE WHEN l.unit_id = head_office_unit_id() THEN 'a unit''s hutang account at head office'
            ELSE 'head office''s piutang account at a unit' END AS problem
  FROM journal_line l
  JOIN journal_entry e ON e.entry_id = l.entry_id
 WHERE (l.account_code IN ('1057', '1058', '1059')
        AND l.unit_id IS DISTINCT FROM head_office_unit_id())
    OR (l.account_code IN ('2028', '2029', '2030')
        AND l.unit_id = head_office_unit_id())
