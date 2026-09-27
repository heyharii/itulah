-- id: finance.map_points_at_live_leaves
-- severity: high
-- rule: every account link points at an active posting leaf, so no writer is ever sent to a retired or heading account (I9)
-- enforced: group by FK (account_code, is_group); retiring a linked account is refused by the chart editor (chart_changes::apply), but a direct UPDATE is not stopped
-- requires: account_link, ledger_account
-- mutate: UPDATE ledger_account SET is_active = false WHERE account_code = (SELECT account_code FROM account_link ORDER BY account_code LIMIT 1)
SELECT l.link_id, l.role, l.source_id, l.scope_type, l.scope_key, l.account_code, a.name,
       CASE WHEN a.account_code IS NULL THEN 'no such account'
            WHEN a.is_group THEN 'a heading, not a leaf'
            ELSE 'retired' END AS problem
  FROM account_link l
  LEFT JOIN ledger_account a ON a.account_code = l.account_code
 WHERE a.account_code IS NULL OR a.is_group OR NOT a.is_active
