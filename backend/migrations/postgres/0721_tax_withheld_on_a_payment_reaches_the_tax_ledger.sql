-- Tax withheld on a supplier payment reaches the tax ledger.
--
-- Until 1 Oct 2026 a payment that kept back PPh credited the payable account
-- (`withholding_payable`, 2012) and stopped there. The tax subledger — the
-- periods Tax Payables lists, files and settles — only heard of it when
-- somebody posted to `/finance/tax/items` by hand, so the rig's ledger said
-- Rp 5.578.000 was owed and Tax Payables said Rp 3.000, and Period Close
-- flagged the month. `post_payment` now records the obligation in the same
-- transaction (payments.rs); this migration adds the tax the final-rate
-- templates need and records what the payments already posted.

-- PPh 4(2): final tax withheld on rent of land and buildings, construction
-- and the like. A payable of its own, beside PPh 23, because it is filed on
-- its own return.
INSERT INTO tax_type (code, name, nature, semantic_key, note)
VALUES ('PPH42', 'PPh Pasal 4(2) — final', 'PAYABLE', 'pph_final_payable',
        'Withheld at a final rate on rent of land and buildings and on construction.')
ON CONFLICT (code) DO NOTHING;

-- Every posted payment that kept tax back, recorded once in the month it
-- posted: PPH42 for a final-rate template, PPH23 otherwise. Two statements,
-- because rows a CTE inserts are not visible to the same statement's joins.
CREATE TEMP VIEW withheld_0721 AS
SELECT p.payment_id, p.unit_id, p.withholding_minor, p.journal_entry_id,
       EXTRACT(YEAR FROM e.posting_date)::smallint AS y,
       EXTRACT(MONTH FROM e.posting_date)::smallint AS m,
       CASE WHEN COALESCE(t.is_final, false) THEN 'PPH42' ELSE 'PPH23' END AS tax_type_code
  FROM supplier_payment p
  JOIN journal_entry e ON e.entry_id = p.journal_entry_id
  LEFT JOIN tax_template t ON t.code = p.withholding_key
 WHERE p.status = 'POSTED' AND p.withholding_minor > 0;

INSERT INTO tax_period (period_id, tax_type_code, period_year, period_month)
SELECT gen_random_uuid(), tax_type_code, y, m
  FROM (SELECT DISTINCT tax_type_code, y, m FROM withheld_0721) w
ON CONFLICT (tax_type_code, period_year, period_month) DO NOTHING;

INSERT INTO tax_ledger_item
    (item_id, period_id, unit_id, kind, amount_minor, source_kind, source_id,
     entry_id, note, created_by)
SELECT gen_random_uuid(), tp.period_id, w.unit_id, 'OBLIGATION', w.withholding_minor,
       'PAYMENT', w.payment_id::text, w.journal_entry_id,
       'Withheld on the supplier payment', 'migration:0721'
  FROM withheld_0721 w
  JOIN tax_period tp
    ON tp.tax_type_code = w.tax_type_code AND tp.period_year = w.y AND tp.period_month = w.m
ON CONFLICT (period_id, kind, source_kind, source_id) DO NOTHING;

DROP VIEW withheld_0721;
