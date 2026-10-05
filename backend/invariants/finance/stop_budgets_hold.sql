-- id: finance.stop_budgets_hold
-- severity: high
-- rule: a live STOP budget is never overspent — what a unit spent on the account (or category) inside the budget's period stays within the promise (0305)
-- enforced: Rust poster::enforce_budgets, which sums the month with a plain read and no lock, so two postings that are each under the line can together cross it
-- requires: budget, journal_entry, journal_line
-- mutate: UPDATE budget SET amount_minor = 1, on_exceed = 'STOP', superseded_by = NULL WHERE budget_id = (SELECT budget_id FROM budget ORDER BY budget_id LIMIT 1)
SELECT b.budget_id, b.unit_id, b.account_code, b.category_code, b.period_start, b.period_end,
       b.amount_minor AS promised, s.spent
  FROM budget b
  CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS spent
        FROM journal_line l
        JOIN journal_entry e ON e.entry_id = l.entry_id
       WHERE l.unit_id = b.unit_id
         AND e.posting_date BETWEEN b.period_start AND b.period_end
         AND e.source_kind <> 'OPENING'
         AND (b.account_code IS NULL OR l.account_code = b.account_code)
         AND (b.category_code IS NULL OR l.category_code = b.category_code)
  ) s
 WHERE b.superseded_by IS NULL
   AND b.on_exceed = 'STOP'
   AND s.spent > b.amount_minor
