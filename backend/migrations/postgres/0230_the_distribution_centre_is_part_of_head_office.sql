-- The distribution centre is a part of head office, not a unit of its own.
--
-- Owner's decision, 2026-09-13: *"dc bagian dari ho, jadi cukup ho saja,
-- jangan ada kata dc"*. The organisation is fourteen units — head office plus
-- Store 01 to Store 13 — and the warehouse is a department inside the first,
-- not a fifteenth place.
--
-- # This is HR geography only
--
-- `site` is untouched. The DC *is* a syncing node: it receives goods, holds
-- stock, runs the handhelds, and every one of those keeps working exactly as
-- it did. What changes is only where the people who work there are *posted* —
-- which is `org_place`, a different table for exactly this reason (0060: head
-- office is not a site and has no edge node, so the organisational geography
-- could not be read off `site`).
--
-- # Why the rows move rather than the label
--
-- The alternative was to keep the row and hide it from the unit pickers. That
-- makes the picker lie: it would be a control that omits a place three people
-- are posted to. A screen that hides a unit containing employees is worse than
-- a screen that shows a unit somebody wanted renamed.
--
-- # It refuses rather than strips
--
-- Six tables point at `org_place`. On the database this was written against,
-- five of them held nothing for the DC and only the postings had to move. That
-- is a fact about today, not a guarantee about the node this runs on next: if
-- a DC roster, a DC payroll run or a decided DC leave request exists
-- somewhere, moving the postings silently would leave that history attached to
-- a place that no longer exists — or, worse, reattributed to head office
-- without anybody deciding that it should be. So the migration names what it
-- found and stops, and whoever runs it decides what that history means.

DO $$
DECLARE
    history text;
BEGIN
    SELECT string_agg(found.what || ' (' || found.rows || ')', ', ' ORDER BY found.what)
      INTO history
      FROM (
        SELECT 'leave_request' AS what, count(*) AS rows
          FROM leave_request WHERE place_id = 'dc'
        UNION ALL
        SELECT 'overtime_order', count(*) FROM overtime_order WHERE place_id = 'dc'
        UNION ALL
        SELECT 'attendance_period', count(*) FROM attendance_period WHERE place_id = 'dc'
        UNION ALL
        SELECT 'roster_day', count(*) FROM roster_day WHERE place_id = 'dc'
        UNION ALL
        SELECT 'payroll_run', count(*) FROM payroll_run WHERE place_id = 'dc'
      ) AS found
     WHERE found.rows > 0;

    IF history IS NOT NULL THEN
        RAISE EXCEPTION
            'the distribution centre still holds HR history this migration '
            'will not reattribute on its own: %. Decide what each of those '
            'means before folding the DC into head office.', history;
    END IF;
END $$;

-- The postings themselves. `ix_employee_assignment_one_open` allows one open
-- assignment per person whatever the place, so this is a move rather than a
-- second posting — nobody ends up employed in two places at once.
UPDATE employee_assignment SET place_id = 'ho' WHERE place_id = 'dc';

DELETE FROM org_place WHERE id = 'dc';

-- And it cannot come back as a posting. Narrowing the vocabulary is the only
-- part of this migration that outlives the data change: without it the next
-- DC site provisioned would quietly become a fifteenth unit again, and the
-- decision above would have to be remembered rather than enforced.
--
-- Nothing in the application writes `org_place` today — 0060's own INSERT is
-- the only writer in the repository, and its comment about site provisioning
-- describes an intention that was never implemented — so no code path loses a
-- value it was using.
ALTER TABLE org_place
    DROP CONSTRAINT org_place_kind_check,
    ADD CONSTRAINT org_place_kind_check CHECK (kind IN ('HO', 'STORE'));

COMMENT ON TABLE org_place IS
    'Where somebody is POSTED: head office, or one of the stores. Not the same '
    'question as `site`, which is the set of syncing nodes and still includes '
    'the distribution centre — the warehouse is a department of head office '
    'for employment purposes and a node of its own for stock (0230).';
