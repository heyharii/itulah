-- 0145: Reading the Payment Ledger as at a date, and checking it against the
-- books.
--
-- # Why "as at" is a function and not four copies of a WHERE clause
--
-- Winding an open-item ledger back to a date is more delicate than it looks and
-- gets asked for by four different readers — the open-item list, the ageing
-- report, one party's statement, and the integrity check below. Both sides have
-- to move: an item raised after the date is not yet a debt, a settlement made
-- after it has not yet happened, and a cancellation posted after it had not yet
-- cancelled anything. Write that four times and the four will agree until
-- somebody fixes one of them.
--
-- So it is written once, here, and every reader selects from it. Rust included:
-- `ple_open_items`, `payment_ledger_aging` and `ple_outstanding` are all
-- `SELECT ... FROM payment_ledger_as_of($1)` with a different WHERE. The
-- function is a plain SQL one so the planner inlines it and those predicates
-- push down into the scan rather than materialising the whole ledger first.
--
-- The fast path for "now" is not this function: it is the stored
-- `outstanding_minor` and the partial index on it in 0143. Asking what is open
-- today is the question a screen asks on every load, and it should not pay for
-- a subquery per row.
--
-- # The equation this lane exists to make checkable
--
-- For every control account triple, the Payment Ledger's outstanding total and
-- the General Ledger's balance on the account that triple maps to must be the
-- same number. That is the whole claim of an open-item ledger: it does not
-- replace the books, it explains a line of them.
--
-- The difference is reported rather than asserted, and reported per triple, so
-- a disagreement names the account and the location instead of saying that
-- something, somewhere, is out. Three ordinary causes, all worth telling apart:
--
--   * `account_code` NULL — the map does not point anywhere yet, so the books
--     have no line to compare and the whole outstanding shows as the difference.
--   * A posting rule opened an item and posted a journal that did not touch the
--     mapped account, or touched it for a different amount.
--   * A reversal was posted into a later month than the entry it reverses, so
--     between the two dates the ledger has dropped a balance the books still
--     carry. Real, temporary, and exactly the kind of thing a month end wants
--     to see rather than have smoothed away.
--
-- One assumption, stated because it is one: two different triples mapped to the
-- SAME client account would each be compared against that account's whole
-- balance and both would look wrong. Finance maps one meaning to one account
-- per location, and the day they do not, this report is where it shows.

-- Every item as at a date, with what is still open on it and how old it is.
--
-- `p_` on the parameters because `site` and `as_of` are both column names in
-- this schema and a silently shadowed reference is a wrong answer, not an error.
CREATE FUNCTION payment_ledger_as_of(p_as_of date)
RETURNS TABLE (
    entry_id             uuid,
    account_key          text,
    qualifier            text,
    site_id              text,
    side                 text,
    party_type           text,
    party_id             text,
    party_name           text,
    voucher_kind         text,
    voucher_id           text,
    against_voucher_kind text,
    against_voucher_id   text,
    journal_entry_id     uuid,
    currency             char(3),
    amount_minor         bigint,
    settled_minor        bigint,
    outstanding_minor    bigint,
    due_date             date,
    posting_date         date,
    age_days             integer,
    delinked             boolean,
    created_at           timestamptz,
    created_by           text
)
LANGUAGE sql
STABLE
AS $$
    SELECT e.entry_id,
           e.account_key,
           e.qualifier,
           e.site_id,
           e.side,
           e.party_type,
           e.party_id,
           e.party_name,
           e.voucher_kind,
           e.voucher_id,
           e.against_voucher_kind,
           e.against_voucher_id,
           e.journal_entry_id,
           e.currency,
           e.amount_minor,
           settled.amount AS settled_minor,
           CASE WHEN e.delinked AND e.delinked_on <= p_as_of THEN 0
                ELSE e.amount_minor - settled.amount
           END AS outstanding_minor,
           e.due_date,
           e.posting_date,
           -- Aged from the due date when anybody agreed one, and from the
           -- posting date when nobody did. The alternative — calling an
           -- undated balance "not due" forever — hides the oldest debts in the
           -- one bucket nobody chases. `payables_aging` makes the same choice.
           (p_as_of - COALESCE(e.due_date, e.posting_date))::int AS age_days,
           (e.delinked AND e.delinked_on <= p_as_of) AS delinked,
           e.created_at,
           e.created_by
      FROM payment_ledger_entry e
      CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(s.amount_minor), 0)::bigint AS amount
            FROM payment_ledger_settlement s
           WHERE s.entry_id = e.entry_id
             AND s.posting_date <= p_as_of
             AND (NOT s.delinked OR s.delinked_on > p_as_of)
      ) settled
     WHERE e.posting_date <= p_as_of;
$$;

COMMENT ON FUNCTION payment_ledger_as_of(date) IS
    'The Payment Ledger wound back to a date: items raised by then, less settlements made by then, with cancellations that had not yet been posted still counting. The single implementation of "as at" — the list, the ageing, a party statement and the integrity check all select from it.';

-- What the Payment Ledger says is outstanding, against what the books say, per
-- control account triple.
CREATE FUNCTION payment_ledger_integrity(p_as_of date, p_site text DEFAULT NULL)
RETURNS TABLE (
    account_key              text,
    qualifier                text,
    site_id                  text,
    side                     text,
    account_code             text,
    account_name             text,
    open_items               bigint,
    ledger_outstanding_minor bigint,
    gl_balance_minor         bigint,
    difference_minor         bigint
)
LANGUAGE sql
STABLE
AS $$
    WITH ledger AS (
        SELECT i.account_key,
               i.qualifier,
               i.site_id,
               i.side,
               COUNT(*) FILTER (WHERE i.outstanding_minor <> 0)::bigint AS open_items,
               COALESCE(SUM(i.outstanding_minor), 0)::bigint AS outstanding_minor
          FROM payment_ledger_as_of(p_as_of) i
         WHERE p_site IS NULL OR i.site_id = p_site
         GROUP BY i.account_key, i.qualifier, i.site_id, i.side
    )
    SELECT l.account_key,
           l.qualifier,
           l.site_id,
           l.side,
           m.account_code,
           a.name AS account_name,
           l.open_items,
           l.outstanding_minor AS ledger_outstanding_minor,
           COALESCE(gl.balance, 0)::bigint AS gl_balance_minor,
           (l.outstanding_minor - COALESCE(gl.balance, 0))::bigint AS difference_minor
      FROM ledger l
      LEFT JOIN account_map m
             ON m.semantic_key = l.account_key
            AND m.site_id = l.site_id
            AND m.qualifier = l.qualifier
      LEFT JOIN ledger_account a ON a.account_code = m.account_code
      LEFT JOIN LATERAL (
          -- Signed to the ledger's own side, so a payable of 8,600,000 is
          -- +8,600,000 on both sides of the comparison and the difference is a
          -- difference rather than a sum. `account_balance` deliberately does
          -- not flip liabilities — a report decides how to present a balance —
          -- and this is that report deciding.
          SELECT CASE WHEN l.side = 'RECEIVABLE'
                      THEN COALESCE(SUM(jl.debit_minor), 0) - COALESCE(SUM(jl.credit_minor), 0)
                      ELSE COALESCE(SUM(jl.credit_minor), 0) - COALESCE(SUM(jl.debit_minor), 0)
                 END AS balance
            FROM journal_line jl
            JOIN journal_entry je USING (entry_id)
           WHERE jl.account_code = m.account_code
             AND jl.site_id = l.site_id
             AND je.posting_date <= p_as_of
      ) gl ON true
     ORDER BY l.account_key, l.site_id, l.qualifier;
$$;

COMMENT ON FUNCTION payment_ledger_integrity(date, text) IS
    'Payment Ledger outstanding against the General Ledger balance of the mapped control account, per (account_key, qualifier, site_id) and signed to the ledger side. The difference is reported, never corrected — a sub-ledger that quietly agreed with the books would be no check at all.';

-- The same question, today, for anybody holding a psql prompt rather than a
-- Rust caller.
CREATE VIEW payment_ledger_integrity_now AS
    SELECT * FROM payment_ledger_integrity(CURRENT_DATE, NULL);

COMMENT ON VIEW payment_ledger_integrity_now IS
    'payment_ledger_integrity as at today. A row whose difference_minor is not zero is a sub-ledger and a general ledger disagreeing about the same money.';
