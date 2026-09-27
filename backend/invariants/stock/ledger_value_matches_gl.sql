-- id: stock.ledger_value_matches_gl
-- severity: medium
-- rule: company-wide, the value the stock ledger holds equals the balance of the inventory control account(s) in the general ledger. Company-wide on purpose: the FIFO queue is the company's, and nothing moves value between the sites' inventory leaves on a transfer (see stock_ledger_integrity). A receipt whose bill has not arrived is a legitimate, temporary difference — so this is a lead to chase, not proof of a fault.
-- enforced: checker only — stock_ledger::stock_ledger_integrity over HTTP; the integrity registry's stock.value_vs_gl is a placeholder that is never registered
-- requires: stock_ledger_entry, journal_line, account_link
-- mutate: UPDATE stock_ledger_entry SET stock_value_difference_minor = stock_value_difference_minor + 100 WHERE entry_id = (SELECT entry_id FROM stock_ledger_entry ORDER BY fact_sequence LIMIT 1)
WITH stock AS (
    SELECT COALESCE(SUM(stock_value_difference_minor), 0)::bigint AS value FROM stock_ledger_entry
), gl AS (
    SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS value
      FROM journal_line l
     WHERE l.account_code IN (SELECT DISTINCT account_code FROM account_link WHERE role = 'inventory')
)
SELECT s.value AS stock_ledger, g.value AS general_ledger, g.value - s.value AS books_minus_goods,
       CASE WHEN g.value > s.value THEN 'a bill debited inventory for goods no cost layer was opened for'
            ELSE 'a cost layer was opened for goods whose bill has not been posted' END AS usual_reason
  FROM stock s, gl g
 WHERE s.value <> g.value
