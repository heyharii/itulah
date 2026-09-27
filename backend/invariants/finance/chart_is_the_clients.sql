-- id: finance.chart_is_the_clients
-- severity: medium
-- rule: the chart is the client's 263 active posting leaves; no account appears or disappears without the owner (P1)
-- enforced: nowhere — only one-time counts inside migrations. Change the number here in the same commit as the owner's decision.
-- requires: ledger_account
-- mutate: UPDATE ledger_account SET is_active = NOT is_active WHERE account_code = (SELECT account_code FROM ledger_account WHERE NOT is_group ORDER BY account_code LIMIT 1)
SELECT COUNT(*) AS active_leaves, 263 AS expected
  FROM ledger_account
 WHERE is_active AND NOT is_group
HAVING COUNT(*) <> 263
