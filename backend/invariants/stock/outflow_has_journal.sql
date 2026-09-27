-- id: stock.outflow_has_journal
-- severity: high
-- rule: a stock outflow that moved value has a journal entry, and a receipt or custody transfer has none (the receipt's journal belongs to the bill)
-- enforced: Rust stock_ledger — the journal is posted before the rows are inserted; no DB check
-- requires: stock_ledger_entry
-- mutate: UPDATE stock_ledger_entry SET journal_entry_id = NULL WHERE entry_id = (SELECT entry_id FROM stock_ledger_entry WHERE journal_entry_id IS NOT NULL ORDER BY fact_sequence LIMIT 1)
SELECT entry_id, article_id, site_id, fact_sequence, event_kind, source_kind, source_id,
       stock_value_difference_minor, journal_entry_id,
       CASE WHEN journal_entry_id IS NULL THEN 'value left stock with no journal'
            ELSE 'a receipt or transfer carries a journal' END AS problem
  FROM stock_ledger_entry
 WHERE (event_kind IN ('SALE', 'LOSS', 'WRITE_OFF', 'DISPOSAL', 'SUPPLIER_RETURN')
        AND stock_value_difference_minor <> 0 AND journal_entry_id IS NULL
        AND source_kind <> 'COGS_DAY_UNWIND')
    OR (event_kind IN ('RECEIPT', 'TRANSFER') AND journal_entry_id IS NOT NULL)
