-- id: finance.interunit_nets_to_zero
-- severity: medium
-- rule: inside one company the inter-unit balances eliminate: per unit and family, the unit's hutang and head office's piutang cancel (I7). A pair can sit one-sided for a day — a remittance head office has not confirmed yet (P3) — so a finding is a pair to chase, and only a closed month must be clean.
-- enforced: close readiness only — finance_control.rs INTERUNIT_NETS (company-wide total, a BLOCKER on close); nothing at write time
-- requires: journal_entry, journal_line, fiscal_period, unit
-- mutate: DELETE FROM journal_line WHERE line_id = (SELECT line_id FROM journal_line WHERE account_code IN ('1057', '1058', '1059') AND counter_unit_id IS NOT NULL ORDER BY line_id LIMIT 1)
WITH legs AS (
    SELECT CASE WHEN l.unit_id = head_office_unit_id() THEN l.counter_unit_id ELSE l.unit_id END AS unit,
           CASE WHEN l.account_code IN ('1057', '2028') THEN 'PEMBIAYAAN'
                WHEN l.account_code IN ('1058', '2029') THEN 'BARANG'
                ELSE 'LAIN' END AS family,
           e.posting_date,
           l.debit_minor - l.credit_minor AS signed
      FROM journal_line l
      JOIN journal_entry e ON e.entry_id = l.entry_id
     WHERE l.account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')
       AND l.counter_unit_id IS NOT NULL
)
SELECT unit, family,
       SUM(signed) AS out_by_all_time,
       SUM(signed) FILTER (WHERE EXISTS (
           SELECT 1 FROM fiscal_period p
            WHERE p.status = 'CLOSED'
              AND make_date(p.year, p.month, 1) = date_trunc('month', legs.posting_date)::date)) AS out_by_in_closed_months
  FROM legs
 GROUP BY unit, family
HAVING SUM(signed) <> 0
