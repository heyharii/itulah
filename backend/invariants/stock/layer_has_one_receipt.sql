-- id: stock.layer_has_one_receipt
-- severity: high
-- rule: every cost layer entered the stock ledger exactly once, as a RECEIPT of its own quantity and opening cost
-- enforced: Rust stock_ledger::cost_layer_create (the only layer writer)
-- requires: cost_layer, stock_ledger_entry
-- mutate: DELETE FROM stock_ledger_entry WHERE entry_id = (SELECT entry_id FROM stock_ledger_entry WHERE event_kind = 'RECEIPT' ORDER BY fact_sequence LIMIT 1)
SELECT l.layer_id, l.article_id, l.site_id, l.quantity, l.opening_cost_minor,
       COUNT(e.entry_id) AS receipts, SUM(e.quantity) AS received, SUM(e.stock_value_difference_minor) AS valued
  FROM cost_layer l
  LEFT JOIN stock_ledger_entry e ON e.cost_layer_id = l.layer_id AND e.event_kind = 'RECEIPT'
 GROUP BY l.layer_id
HAVING COUNT(e.entry_id) <> 1
    OR SUM(e.quantity) <> l.quantity
    OR SUM(e.stock_value_difference_minor) <> l.opening_cost_minor
