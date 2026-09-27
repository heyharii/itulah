-- id: finance.no_postings_on_retired_accounts
-- severity: high
-- rule: a retired account takes no new activity — nothing in a month that is still open sits on an inactive or heading account (older months keep their history)
-- enforced: heading by CHECK + FK; retired only by Rust assert_postable (poster.rs), which reversals and any second writer skip
-- requires: journal_entry, journal_line, ledger_account, fiscal_period
-- mutate: UPDATE ledger_account SET is_active = false WHERE account_code = (SELECT l.account_code FROM journal_line l JOIN journal_entry e USING (entry_id) JOIN fiscal_period p ON p.year = EXTRACT(YEAR FROM e.posting_date) AND p.month = EXTRACT(MONTH FROM e.posting_date) WHERE p.status = 'OPEN' AND e.source_kind <> 'REVERSAL' ORDER BY l.line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, e.posting_date, l.line_number, l.account_code, a.name,
       CASE WHEN a.is_group THEN 'heading' ELSE 'retired' END AS problem
  FROM journal_line l
  JOIN journal_entry e ON e.entry_id = l.entry_id
  JOIN ledger_account a ON a.account_code = l.account_code
  JOIN fiscal_period p
    ON p.year = EXTRACT(YEAR FROM e.posting_date) AND p.month = EXTRACT(MONTH FROM e.posting_date)
 WHERE p.status = 'OPEN'
   AND (a.is_group OR NOT a.is_active)
   AND e.source_kind <> 'REVERSAL'
