-- id: finance.affiliate_counter_site
-- severity: high
-- rule: an inter-unit line names the other side, and the other side is always head office ↔ a unit: a unit line's counter is dc, a dc line's counter is a unit, never the line's own site (I7, I8)
-- enforced: presence only — Rust validate_account_posting (requires_counter_site); direction is only what the balancer happens to emit (interunit::balancing_legs); DB has just the FK to site
-- requires: journal_entry, journal_line
-- mutate: UPDATE journal_line SET counter_site_id = site_id WHERE line_id = (SELECT line_id FROM journal_line WHERE account_code IN ('1057', '1058', '1059', '2028', '2029', '2030') ORDER BY line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, l.line_number, l.account_code, l.site_id, l.counter_site_id,
       CASE WHEN l.counter_site_id IS NULL THEN 'names no counter site'
            WHEN l.counter_site_id = l.site_id THEN 'its counter site is itself'
            WHEN l.site_id <> 'dc' AND l.counter_site_id <> 'dc' THEN 'unit to unit, not through head office'
            ELSE 'head office line whose counter is head office' END AS problem
  FROM journal_line l
  JOIN journal_entry e ON e.entry_id = l.entry_id
 WHERE l.account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')
   AND e.source_kind <> 'OPENING'
   AND (l.counter_site_id IS NULL
        OR l.counter_site_id = l.site_id
        OR (l.site_id <> 'dc' AND l.counter_site_id <> 'dc'))
