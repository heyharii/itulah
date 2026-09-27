-- id: stock.cost_layers_hold
-- severity: critical
-- rule: a cost layer never gives out more than it received, never goes below zero in value, and an empty layer holds no value
-- enforced: Rust stock_ledger::read_queue (layers FOR UPDATE + advisory lock) and costing::consume_fifo; no DB check — cost_layer_remaining is a view
-- requires: cost_layer_remaining, stock_ledger_entry, cost_layer
-- mutate: INSERT INTO stock_ledger_entry (entry_id, posting_group_id, line_number, article_id, sku_id, epc, lot_reference, from_pool_id, to_pool_id, site_id, quantity, qty_delta, qty_after, cost_layer_id, incoming_rate_minor, valuation_rate_minor, stock_value_difference_minor, stock_value_after_minor, costing_method, event_kind, source_kind, source_id, economic_date, journal_entry_id, idempotency_key, actor, recorded_at) SELECT gen_random_uuid(), posting_group_id, line_number + 1000, article_id, sku_id, epc, lot_reference, from_pool_id, to_pool_id, site_id, quantity * 1000, qty_delta * 1000, qty_after, cost_layer_id, incoming_rate_minor, valuation_rate_minor, stock_value_difference_minor, stock_value_after_minor, costing_method, event_kind, source_kind, source_id, economic_date, journal_entry_id, idempotency_key || ':mutated', actor, recorded_at FROM stock_ledger_entry WHERE cost_layer_id IS NOT NULL AND event_kind = 'SALE' ORDER BY fact_sequence LIMIT 1
SELECT layer_id, article_id, site_id, received_quantity, remaining_quantity, remaining_value_minor,
       CASE WHEN remaining_quantity < 0 THEN 'gave out more than it received'
            WHEN remaining_quantity > received_quantity THEN 'holds more than it received'
            WHEN remaining_value_minor < 0 THEN 'value below zero'
            ELSE 'empty but still holds value' END AS problem
  FROM cost_layer_remaining
 WHERE remaining_quantity < 0
    OR remaining_quantity > received_quantity
    OR remaining_value_minor < 0
    OR (remaining_quantity = 0 AND remaining_value_minor <> 0)
