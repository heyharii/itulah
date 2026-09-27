-- id: commercial.voucher_holds_within_balance
-- severity: high
-- rule: the live holds on a voucher never add up to more than its balance, so every hold can still be committed
-- enforced: Rust authorize_voucher (available = balance − holds, under FOR UPDATE); NOT redeem_voucher, which checks the balance alone and can spend money a checkout is holding
-- requires: voucher, voucher_authorization
-- mutate: UPDATE voucher_authorization SET amount_minor = amount_minor + 100000000, status = 'AUTHORIZED', expires_at = now() + interval '1 day' WHERE authorization_id = (SELECT authorization_id FROM voucher_authorization ORDER BY authorization_id LIMIT 1)
SELECT v.voucher_id, v.code, v.balance_minor, SUM(a.amount_minor) AS held, COUNT(*) AS holds
  FROM voucher_authorization a
  JOIN voucher v ON v.voucher_id = a.voucher_id
 WHERE a.status = 'AUTHORIZED' AND a.expires_at > now()
 GROUP BY v.voucher_id, v.code, v.balance_minor
HAVING SUM(a.amount_minor) > v.balance_minor
