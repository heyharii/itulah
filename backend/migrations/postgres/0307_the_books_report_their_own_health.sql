-- The books report their own health.
--
-- Every checker this estate already runs already writes its answer down:
-- `payment_ledger_integrity_now` (0145) computes the Payment-Ledger-vs-books
-- agreement live, and `integrity_run`/`integrity_result` (0123) hold the
-- scheduled runs' verdicts. What was missing is not a seventh checker — it is
-- one place where a person can see all of them without knowing they exist.
-- ERPNext reached the same conclusion in v16 with `Ledger Health` and
-- `Ledger Health Monitor`; ours composes what already exists, adds no table,
-- and recomputes nothing — if a check is wrong, fix the check, not this view.
--
-- The shape is deliberately flat, one row per thing a person might owe a
-- look: (check_kind, subject, subject_scope, detail, unhealthy, checked_at).
-- The screen over it is the remaining Fase 3 task; this view is its contract.

CREATE OR REPLACE VIEW ledger_health AS
-- 1. Sub-ledger against books, live, per control-account reading that has a
--    difference. Zero-difference rows are health, not news.
SELECT
    'payment_ledger_vs_books'::text  AS check_kind,
    i.account_key
      || COALESCE('/' || NULLIF(i.qualifier, ''), '')
      || ' @ ' || i.site_id          AS subject,
    i.site_id                        AS subject_scope,
    format(
      '%s %s: sub-ledger %s, books %s, difference %s (side %s)',
      i.account_name, i.account_code,
      i.ledger_outstanding_minor, i.gl_balance_minor,
      i.difference_minor, i.side)     AS detail,
    (i.difference_minor <> 0)         AS unhealthy,
    now()                             AS checked_at
  FROM payment_ledger_integrity_now i
 WHERE i.difference_minor <> 0
 UNION ALL
-- 2. The most recent finished run's non-balanced answers. The runs are the
--    history; health is only their tail. A run that itself failed (engine,
--    not books) is one row of its own — a broken engine reported as a clean
--    set of books would be the worst kind of health.
SELECT
    'integrity_run'::text            AS check_kind,
    res.key                          AS subject,
    res.scope                        AS subject_scope,
    COALESCE(res.details ->> 'summary',
             format('expected %s, actual %s (difference %s)',
                    res.expected_minor, res.actual_minor, res.difference_minor))
                                     AS detail,
    true                             AS unhealthy,
    r.finished_at                    AS checked_at
  FROM integrity_run r
  JOIN integrity_result res ON res.run_id = r.run_id
 WHERE r.finished_at IS NOT NULL
   AND r.finished_at = (SELECT max(r2.finished_at)
                          FROM integrity_run r2
                         WHERE r2.finished_at IS NOT NULL)
   AND res.state <> 'BALANCED'
 UNION ALL
SELECT
    'integrity_engine'::text         AS check_kind,
    'run ' || r.run_id::text         AS subject,
    'system'                         AS subject_scope,
    r.failure                        AS detail,
    true                             AS unhealthy,
    r.finished_at                    AS checked_at
  FROM integrity_run r
 WHERE r.finished_at IS NOT NULL
   AND r.failure IS NOT NULL
   AND r.finished_at = (SELECT max(r2.finished_at)
                          FROM integrity_run r2
                         WHERE r2.finished_at IS NOT NULL
                           AND r2.failure IS NOT NULL);

COMMENT ON VIEW ledger_health IS
    'One place for every answer the books already compute about themselves: the live Payment-Ledger-vs-books differences per control account (0145), and the non-balanced results — plus any engine failure — of the most recent finished integrity run (0123). Adds no checker and no table; if a check is wrong, fix the check, not this view.';
