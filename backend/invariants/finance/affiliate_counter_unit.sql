-- id: finance.affiliate_counter_unit
-- severity: high
-- rule: an inter-unit line names the other side, and the other side is always head office ↔ a unit: a unit line's counter is head office, head office's counter is a unit, never the line's own unit (I7, I8)
-- enforced: presence only — Rust validate_account_posting (requires_counter_site); direction is only what the balancer happens to emit (interunit::balancing_legs); DB has just the FK to unit
-- requires: journal_entry, journal_line, unit
-- mutate: UPDATE journal_line SET counter_unit_id = unit_id WHERE line_id = (SELECT line_id FROM journal_line WHERE account_code IN ('1057', '1058', '1059', '2028', '2029', '2030') ORDER BY line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, l.line_number, l.account_code, l.unit_id, l.counter_unit_id,
       CASE WHEN l.counter_unit_id IS NULL THEN 'names no counter unit'
            WHEN l.counter_unit_id = l.unit_id THEN 'its counter unit is itself'
            WHEN l.unit_id <> head_office_unit_id() AND l.counter_unit_id <> head_office_unit_id()
                 THEN 'unit to unit, not through head office'
            ELSE 'head office line whose counter is head office' END AS problem
  FROM journal_line l
  JOIN journal_entry e ON e.entry_id = l.entry_id
 WHERE l.account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')
   AND e.source_kind <> 'OPENING'
   AND (l.counter_unit_id IS NULL
        OR l.counter_unit_id = l.unit_id
        OR (l.unit_id <> head_office_unit_id() AND l.counter_unit_id <> head_office_unit_id()))
