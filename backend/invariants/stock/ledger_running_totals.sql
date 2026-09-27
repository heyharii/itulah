-- id: stock.ledger_running_totals
-- severity: critical
-- rule: every stock ledger row's qty_after and stock_value_after_minor are the running sum of the article's rows before it, in fact order
-- enforced: Rust — every stock_ledger writer takes lock_article_basis then running_position; sales_posting_unconsume_cost (unwind) does NOT, and derives the totals from the original row
-- requires: stock_ledger_entry
-- mutate: UPDATE stock_ledger_entry SET qty_after = qty_after + 1 WHERE entry_id = (SELECT entry_id FROM stock_ledger_entry ORDER BY fact_sequence LIMIT 1)
SELECT entry_id, article_id, fact_sequence, event_kind, source_kind,
       qty_after, running_qty, stock_value_after_minor, running_value
  FROM (
    SELECT e.*,
           SUM(qty_delta) OVER w AS running_qty,
           SUM(stock_value_difference_minor) OVER w AS running_value
      FROM stock_ledger_entry e
    WINDOW w AS (PARTITION BY article_id ORDER BY fact_sequence ROWS UNBOUNDED PRECEDING)
  ) x
 WHERE qty_after <> running_qty OR stock_value_after_minor <> running_value
