-- id: finance.bank_charge_is_not_interest
-- severity: medium
-- rule: bank charge and bank interest are two events — an entry never nets them as Dr 6043 / Cr 8002 (I11)
-- enforced: nowhere (documentation, 0376)
-- requires: journal_entry, journal_line
-- mutate: UPDATE journal_line SET account_code = CASE WHEN debit_minor > 0 THEN '6043' ELSE '8002' END WHERE entry_id = (SELECT entry_id FROM journal_line GROUP BY entry_id HAVING COUNT(*) = 2 ORDER BY entry_id LIMIT 1)
SELECT e.entry_id, e.entry_number, e.source_kind, e.posting_date
  FROM journal_entry e
 WHERE EXISTS (SELECT 1 FROM journal_line l WHERE l.entry_id = e.entry_id AND l.account_code = '6043' AND l.debit_minor > 0)
   AND EXISTS (SELECT 1 FROM journal_line l WHERE l.entry_id = e.entry_id AND l.account_code = '8002' AND l.credit_minor > 0)
