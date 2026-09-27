-- id: finance.affiliate_side
-- severity: high
-- rule: head office is always the piutang side (1057/1058/1059) and a unit always the hutang side (2028/2029/2030), whichever way value moved (I7)
-- enforced: data only — the affiliate links resolve by kind of site (0460); nothing refuses a line that names the account directly
-- requires: journal_entry, journal_line
-- mutate: UPDATE journal_line SET site_id = 'dc' WHERE line_id = (SELECT line_id FROM journal_line WHERE account_code IN ('2028', '2029', '2030') ORDER BY line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, l.line_number, l.account_code, l.site_id, l.counter_site_id,
       CASE WHEN l.site_id = 'dc' THEN 'a unit''s hutang account at head office'
            ELSE 'head office''s piutang account at a unit' END AS problem
  FROM journal_line l
  JOIN journal_entry e ON e.entry_id = l.entry_id
 WHERE (l.account_code IN ('1057', '1058', '1059') AND l.site_id <> 'dc')
    OR (l.account_code IN ('2028', '2029', '2030') AND l.site_id = 'dc')
