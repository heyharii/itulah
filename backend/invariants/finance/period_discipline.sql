-- id: finance.period_discipline
-- severity: high
-- rule: nothing is posted into a month that has no period, and nothing but the correction kinds lands in a month after it was soft-closed or closed
-- enforced: DB — trigger journal_entry_period_open, function assert_period_open (latest 0283)
-- requires: journal_entry, fiscal_period
-- mutate: UPDATE journal_entry SET posting_date = DATE '1999-01-15' WHERE entry_id = (SELECT entry_id FROM journal_entry ORDER BY entry_id LIMIT 1)
SELECT e.entry_id, e.entry_number, e.source_kind, e.posting_date, e.posted_at,
       p.status, p.closed_at, p.soft_closed_at,
       CASE WHEN p.year IS NULL THEN 'no period for this month'
            ELSE 'posted after the month was ' || lower(p.status) END AS problem
  FROM journal_entry e
  LEFT JOIN fiscal_period p
         ON p.year = EXTRACT(YEAR FROM e.posting_date)
        AND p.month = EXTRACT(MONTH FROM e.posting_date)
 WHERE p.year IS NULL
    OR (p.status = 'CLOSED' AND p.closed_at IS NOT NULL AND e.posted_at > p.closed_at)
    OR (p.status IN ('SOFT_CLOSED', 'CLOSED')
        AND COALESCE(p.soft_closed_at, p.closed_at) IS NOT NULL
        AND e.posted_at > COALESCE(p.soft_closed_at, p.closed_at)
        AND e.source_kind NOT IN ('ADJUSTMENT', 'RECLASS', 'WRITE_OFF', 'REVERSAL', 'DEPRECIATION',
                                  'AMORTIZATION_RUN', 'ASSET_RESERVE', 'PREPAID_ALLOCATION',
                                  'TAX_SETTLEMENT', 'PAYROLL_RUN', 'OPENING'))
