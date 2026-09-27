-- People are posted to a unit, and `org_place` is gone.
--
-- Owner's decision, 2026-09-27: `org_place` is dropped. It was 0060's answer to
-- "where is somebody posted" at a time when head office had no row anywhere
-- else, and since 0450 it is a second copy of the unit table under a second
-- name — fourteen rows, one per unit, `ho` and the thirteen stores. Two tables
-- that must agree are two tables that will one day disagree, so one goes.
--
-- Everything that pointed at a place now points at the unit it was: postings,
-- leave, overtime, the attendance month and roster, payroll runs, handovers
-- and adjustments, hire proposals, punches and corrections, staff purchases,
-- claims, grievances, exit interviews, leaver statements, roster swaps, change
-- proposals, staffing plans and applicants. The column is renamed `unit_id`
-- in every one of them, because a column called `place_id` that references
-- `unit` is a sentence that contradicts itself — and "place" keeps exactly one
-- meaning in this schema: the address a stock movement names.
--
-- # The history is kept, and translated only if it must be
--
-- Each place maps to a unit: `ho` to the head-office unit, and a store place to
-- the unit that owns its site (`org_place.site_id` → `site.unit_id`). Because
-- 0450 keyed the units like the places, that mapping is the identity on every
-- database this was written against, and no row changes — only the foreign
-- key it hangs on. The UPDATE below exists for a database where it is not.
--
-- # It refuses rather than strips, as 0230 did
--
-- A place with no unit to go to, or two places that would land on one unit,
-- stops the migration and names them. Folding two places' rosters, payroll runs
-- or attendance months into one unit is a decision about what that history
-- means, and a migration is not the one to take it.
--
-- # The punch station is a device at a site
--
-- `attendance_terminal.place_id` does not become a unit: a terminal is a
-- machine on a wall, so it is recorded where it is installed — `site_id` —
-- and its unit is read off the site (`site.unit_id`) whenever it is needed.
-- Head office's stations were at place `ho`, which 0236 recorded as sitting at
-- site `dc`; they are now at site `dc`, the Gudang.

-- ── the mapping, and the refusal ────────────────────────────────────────

CREATE TEMPORARY TABLE place_unit ON COMMIT DROP AS
SELECT p.id      AS place_id,
       CASE WHEN p.kind = 'HO' THEN (SELECT u.id FROM unit u WHERE u.kind = 'HO')
            ELSE s.unit_id
       END       AS unit_id,
       p.site_id AS site_id
  FROM org_place p
  LEFT JOIN site s ON s.id = p.site_id;

DO $$
DECLARE
    unmapped text;
    merged   text;
BEGIN
    SELECT string_agg(place_id, ', ' ORDER BY place_id)
      INTO unmapped
      FROM place_unit
     WHERE unit_id IS NULL;

    IF unmapped IS NOT NULL THEN
        RAISE EXCEPTION
            'these places have no unit to move to: %. Give their sites a unit '
            '(site.unit_id) before dropping org_place.', unmapped;
    END IF;

    SELECT string_agg(unit_id || ' <- ' || places, '; ' ORDER BY unit_id)
      INTO merged
      FROM (SELECT unit_id, string_agg(place_id, ', ' ORDER BY place_id) AS places
              FROM place_unit
             GROUP BY unit_id
            HAVING count(*) > 1) AS doubled;

    IF merged IS NOT NULL THEN
        RAISE EXCEPTION
            'two places would become one unit: %. Their HR history would be '
            'folded together; decide what it means before running this.', merged;
    END IF;
END $$;

-- ── every HR table moves to the unit ────────────────────────────────────

DO $$
DECLARE
    moving constant text[] := ARRAY[
        'employee_assignment',
        'leave_request',
        'overtime_order',
        'attendance_period',
        'roster_day',
        'payroll_run',
        'payroll_handover',
        'hire_proposal',
        'attendance_punch',
        'attendance_correction',
        'payroll_adjustment',
        'employee_purchase',
        'expense_claim',
        'employee_grievance',
        'exit_interview',
        'full_and_final_statement',
        'roster_swap_request',
        'employee_change_proposal',
        'staffing_plan',
        'job_applicant'
    ];
    t     text;
    fkey  text;
    idx   record;
BEGIN
    FOREACH t IN ARRAY moving LOOP
        SELECT c.conname
          INTO fkey
          FROM pg_constraint c
         WHERE c.contype = 'f'
           AND c.conrelid = t::regclass
           AND c.confrelid = 'org_place'::regclass;

        IF fkey IS NULL THEN
            RAISE EXCEPTION '% was expected to reference org_place and does not', t;
        END IF;

        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, fkey);
        EXECUTE format('ALTER TABLE %I RENAME COLUMN place_id TO unit_id', t);
        EXECUTE format(
            'UPDATE %I AS x SET unit_id = m.unit_id FROM place_unit m '
            'WHERE x.unit_id = m.place_id AND m.unit_id <> m.place_id', t);
        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (unit_id) REFERENCES unit (id)',
            t, t || '_unit_id_fkey');

        -- The indexes and unique constraints keep their meaning and lose the
        -- old word: `payroll_run_one_per_place_period` becomes
        -- `payroll_run_one_per_unit_period`. Renaming the index renames the
        -- constraint it backs.
        FOR idx IN
            SELECT i.relname AS name
              FROM pg_index x
              JOIN pg_class i ON i.oid = x.indexrelid
             WHERE x.indrelid = t::regclass
               AND i.relname LIKE '%place%'
        LOOP
            EXECUTE format('ALTER INDEX %I RENAME TO %I',
                           idx.name, replace(idx.name, 'place', 'unit'));
        END LOOP;
    END LOOP;
END $$;

-- A transfer proposal names where the person goes in its `props`, and the key
-- was the column's name. It follows the column.
UPDATE employee_change_proposal
   SET props = (props - 'place_id') || jsonb_build_object('unit_id', props -> 'place_id')
 WHERE props ? 'place_id';

UPDATE employee_change_proposal AS x
   SET props = jsonb_set(x.props, '{unit_id}', to_jsonb(m.unit_id))
  FROM place_unit m
 WHERE x.props ->> 'unit_id' = m.place_id
   AND m.unit_id <> m.place_id;

-- ── the punch station moves to the site it is installed at ──────────────

ALTER TABLE attendance_terminal ADD COLUMN site_id text REFERENCES site (id);

UPDATE attendance_terminal AS t
   SET site_id = m.site_id
  FROM place_unit m
 WHERE m.place_id = t.place_id;

DO $$
DECLARE
    homeless text;
BEGIN
    SELECT string_agg(id || ' (' || place_id || ')', ', ' ORDER BY id)
      INTO homeless
      FROM attendance_terminal
     WHERE site_id IS NULL;

    IF homeless IS NOT NULL THEN
        RAISE EXCEPTION
            'these punch stations are registered at a place with no site: %. '
            'Say where each one is installed before dropping org_place.', homeless;
    END IF;
END $$;

ALTER TABLE attendance_terminal ALTER COLUMN site_id SET NOT NULL;
DROP INDEX ix_attendance_terminal_place;
ALTER TABLE attendance_terminal DROP COLUMN place_id;
CREATE INDEX ix_attendance_terminal_site ON attendance_terminal (site_id, status);

COMMENT ON TABLE attendance_terminal IS
    'The punch station installed at one site, and the attendance authority '
    'itself: a row in ACTIVE is the only thing that can attest an '
    'identification. It attests for the unit that owns its site (site.unit_id). '
    'Status is folded from the history, so a row cannot claim a state its '
    'evidence contradicts.';

-- ── and the table goes ──────────────────────────────────────────────────

-- Without CASCADE, on purpose: if anything still references it, that is a
-- table this migration did not know about, and dropping the constraint under
-- it would strip its history of the only thing that said where it happened.
DROP TABLE org_place;

COMMENT ON TABLE employee_assignment IS
    'Where somebody is posted — to a unit — over time. Not access: '
    'edge_identity_assignment says which till they may sign into, which is a '
    'different question.';
