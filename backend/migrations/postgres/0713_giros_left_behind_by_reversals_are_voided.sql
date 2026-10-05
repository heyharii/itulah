-- 0713: Giros left on the board by reversals made before 0712 are voided.
--
-- Until 0712 a reversed BKK/BKM paid by giro left its giro ISSUED, DELIVERED
-- or DUE, although the reversal had already taken the amount off
-- `giro_outstanding`. Those rows are voided here exactly as 0712 now voids
-- them at the moment of reversal: dated the day the document was reversed,
-- with the reason saying so. No entry is written — the reversal's mirror
-- already did the books' half.

UPDATE giro g
   SET status        = 'VOIDED',
       voided_on     = COALESCE(e.posting_date, CURRENT_DATE),
       voided_reason = 'cash document ' || COALESCE(d.number, d.document_id::text)
                       || ' was reversed before this giro cleared (repaired by 0713)',
       settled_by    = 'system',
       settled_at    = now()
  FROM cash_document d
  LEFT JOIN journal_entry e ON e.entry_id = d.reversal_entry_id
 WHERE g.cash_document_id = d.document_id
   AND d.status = 'REVERSED'
   AND g.status IN ('ISSUED', 'DELIVERED', 'DUE');
