-- 0365: a breakdown is a fact GA records and Finance prices.
--
-- The register answers "what do we own and where is it" (0070, 0357) and the
-- contract register answers "what have we agreed to" (0360). This migration
-- answers the question between them: WHAT HAPPENED TO A THING. A service is
-- due; somebody inspects and finds it damaged; a repair is estimated, budgeted
-- and done; a thing is too far gone and is replaced; a thing is finally let go.
--
-- Five tables, and they are one shape told five times. GA records the FACT —
-- which thing, which place, what kind of object, which supplier, what was
-- estimated and what budget was approved, by whom and when. GA never writes the
-- money: the actual cost of a repair is the sum of the POSTED bill lines that
-- point at it, and those references arrive in stage 6. Same line as everywhere
-- else in GA (brief §2.1): objects point at each other, Finance points at GA,
-- and `account_map` turns a GA classification into an account.
--
-- # The state machines are Rust, not CHECKs
--
-- A repair's ladder is OPEN -> APPROVED -> IN_PROGRESS -> COMPLETED -> CLOSED,
-- with CANCELLED off the first three rungs. A CHECK can say which states EXIST;
-- it cannot say which move is legal, because that depends on where the row has
-- been. So the ladder lives in `domain::ga::repair_may_move`, pure and tested,
-- and the writer refuses an illegal move with a sentence naming both ends
-- (`AppError::Conflict`). The column's CHECK stays as the last word on the
-- vocabulary alone (brief §3).
--
-- # maker != checker, for the three acts that commit somebody's money
--
-- Approving a repair's budget, approving a replacement and approving a disposal
-- are the acts this estate asks for TWO people: the `counted_by <> verified_by`
-- pattern. Each table carries the CHECK itself, because a constraint refuses at
-- the cheapest moment and in the one place no future writer can forget it. The
-- readable refusal, naming the maker, is in Rust.
--
-- # `ga_repair_object` is 0360's, and is referenced here
--
-- The eleven objects and the expense each resolves to were seeded beside the
-- contract vocabulary in 0360 so the two lists could not drift. This migration
-- does not create them again; it references them. (The `repair_expense`
-- `account_map` rows are 0366, the way the contract accounts were 0361.)
--
-- # fixed_asset.status gains two words, and only GA writes them
--
-- `DISPOSAL_REQUESTED` and `REPLACED` are states GA's register puts a thing in:
-- the first while Finance is being asked to let it go, the second when a
-- replacement was installed in its place. Finance never writes either — it
-- reads the register and books the disposal — so the words are added here, in
-- the migration that introduces the two acts that produce them.

-- ---------------------------------------------------------------------------
-- Maintenance tasks: the standing promise to service something
-- ---------------------------------------------------------------------------
--
-- A task is a RECURRENCE, not an act: "service the air conditioners at the DC
-- every three months", "wash the thirteen stores' AC units every month". The
-- act is an inspection below, or a repair. What this table holds is the
-- interval and the date the interval next comes due.
--
-- The interval is a NUMBER AND A UNIT, never the free text "3 bulan": a
-- sentence cannot be added to a date, and adding it to a date is the only thing
-- this row is for. `KM` is a unit without a date — it needs an odometer reading
-- this table does not hold — so `next_due_from` answers null for it and the
-- screen shows "by distance" rather than a date nobody can compute.
CREATE TABLE ga_maintenance_task (
    task_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Exactly one subject: a task is for one thing, or for one place ("cuci AC
    -- 13 toko"). A row with neither is a note; a row with both is a task that
    -- cannot say what it is about.
    asset_id      uuid REFERENCES fixed_asset (asset_id),
    site_id       TEXT REFERENCES site (id),
    title         TEXT NOT NULL CHECK (btrim(title) <> ''),
    interval_kind  TEXT NOT NULL CHECK (interval_kind IN ('DAYS', 'MONTHS', 'KM')),
    interval_value integer NOT NULL CHECK (interval_value > 0),
    -- Null for a KM task and for one nobody has scheduled a first date for.
    next_due      date,
    contract_id   uuid REFERENCES ga_contract (contract_id),
    supplier_id   uuid REFERENCES supplier (supplier_id),
    status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
    notes         TEXT,
    created_by    TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    TEXT,
    updated_at    timestamptz,
    version       integer NOT NULL DEFAULT 1,
    CONSTRAINT ga_maintenance_task_one_subject CHECK
        ((asset_id IS NULL) <> (site_id IS NULL))
);

-- The overview's question: what is due soon. Partial on the two clauses it
-- always asks with, so the index stays small as paused and KM rows accumulate.
CREATE INDEX ix_ga_maintenance_task_due
    ON ga_maintenance_task (next_due)
 WHERE status = 'ACTIVE' AND next_due IS NOT NULL;
CREATE INDEX ix_ga_maintenance_task_asset
    ON ga_maintenance_task (asset_id) WHERE asset_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Inspections: what somebody found, appended and never edited
-- ---------------------------------------------------------------------------
--
-- An inspection is EVIDENCE (brief §12): "on this day, this person looked at
-- this thing and found this". An append-only trigger refuses UPDATE and DELETE
-- below, for the same reason 0357's asset history does — an inspection that can
-- be rewritten after the fact is not evidence of anything. A typo is corrected
-- by a new inspection, and the mistake stays legible beside it.
CREATE TABLE ga_inspection (
    inspection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id      uuid NOT NULL REFERENCES fixed_asset (asset_id),
    inspected_on  date NOT NULL,
    inspected_by  TEXT NOT NULL CHECK (btrim(inspected_by) <> ''),
    result        TEXT NOT NULL CHECK (result IN ('BAIK', 'PERHATIAN', 'RUSAK')),
    findings      TEXT NOT NULL CHECK (btrim(findings) <> ''),
    -- The task this inspection answers, when it answers one. Null for a
    -- walk-round that was not on a schedule.
    task_id       uuid REFERENCES ga_maintenance_task (task_id),
    recorded_by   TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at   timestamptz NOT NULL DEFAULT now(),
    version       integer NOT NULL DEFAULT 1
);

CREATE INDEX ix_ga_inspection_asset ON ga_inspection (asset_id, inspected_on DESC);

CREATE OR REPLACE FUNCTION protect_ga_inspection() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'an inspection is appended, not %: write the correction as a new inspection and the old one stays',
        lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ga_inspection_append_only
    BEFORE UPDATE OR DELETE ON ga_inspection
    FOR EACH ROW EXECUTE FUNCTION protect_ga_inspection();

-- ---------------------------------------------------------------------------
-- Repairs: the estimate and the budget, not the money
-- ---------------------------------------------------------------------------
--
-- `site_id` is REQUIRED even for a repair with no asset ("plafon bocor" in a
-- shop) because it is the one thing that makes repair cost readable per
-- location — the report Finance will eventually ask for. `objek` is required
-- for everything, derived from the asset's class when there is an asset and
-- chosen by a person when there is not.
--
-- `estimated_cost_minor` is GA's guess; `approved_budget_minor` is the ceiling
-- somebody with authority signed off, and the two travel with WHO and WHEN.
-- The trio CHECK says they are all present or all absent: a budget nobody
-- approved is a number with no authority behind it.
CREATE TABLE ga_repair (
    repair_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id          TEXT NOT NULL REFERENCES site (id),
    asset_id         uuid REFERENCES fixed_asset (asset_id),
    -- Diturunkan dari kelas aset kalau ada asetnya; kalau tidak, dipilih orang.
    objek            TEXT NOT NULL REFERENCES ga_repair_object (code),
    title            TEXT NOT NULL CHECK (btrim(title) <> ''),
    supplier_id      uuid NOT NULL REFERENCES supplier (supplier_id),
    contract_id      uuid REFERENCES ga_contract (contract_id),
    task_id          uuid REFERENCES ga_maintenance_task (task_id),
    inspection_id    uuid REFERENCES ga_inspection (inspection_id),
    estimated_cost_minor  bigint CHECK (estimated_cost_minor IS NULL
                                     OR estimated_cost_minor >= 0),
    approved_budget_minor bigint CHECK (approved_budget_minor IS NULL
                                     OR approved_budget_minor >= 0),
    approved_by      TEXT,
    approved_at      timestamptz,
    failure_at       date NOT NULL,
    completed_at     date,
    status           TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED')),
    notes            TEXT,
    created_by       TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       TEXT,
    updated_at       timestamptz,
    version          integer NOT NULL DEFAULT 1,

    -- Budget, approver and moment arrive together or not at all.
    CONSTRAINT ga_repair_budget_is_approved_together CHECK
        ((approved_budget_minor IS NULL) = (approved_by IS NULL)
         AND (approved_budget_minor IS NULL) = (approved_at IS NULL)),
    -- maker != checker, the estate's `counted_by <> verified_by` pattern.
    CONSTRAINT ga_repair_approver_is_not_maker CHECK
        (approved_by IS NULL OR approved_by <> created_by),
    -- A repair does not finish before it failed.
    CONSTRAINT ga_repair_completes_after_failure CHECK
        (completed_at IS NULL OR completed_at >= failure_at)
);

CREATE INDEX ix_ga_repair_site ON ga_repair (site_id, status);
CREATE INDEX ix_ga_repair_asset ON ga_repair (asset_id) WHERE asset_id IS NOT NULL;
-- The overview's "still open" list, partial on the three live states.
CREATE INDEX ix_ga_repair_open ON ga_repair (failure_at)
 WHERE status IN ('OPEN', 'APPROVED', 'IN_PROGRESS');

-- ---------------------------------------------------------------------------
-- Replacements: a thing too far gone is swapped, and the swap is recorded
-- ---------------------------------------------------------------------------
--
-- Unlike a repair, a replacement ends with a NEW ASSET: moving to INSTALLED
-- copies the old row's identity into a fresh one and marks the old REPLACED,
-- in one transaction (the Rust writer). `new_asset_id` may already be known if
-- the new thing was registered first; otherwise it is minted at install.
CREATE TABLE ga_replacement (
    replacement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    old_asset_id   uuid NOT NULL REFERENCES fixed_asset (asset_id),
    new_asset_id   uuid REFERENCES fixed_asset (asset_id),
    repair_id      uuid REFERENCES ga_repair (repair_id),
    reason         TEXT NOT NULL CHECK (btrim(reason) <> ''),
    supplier_id    uuid REFERENCES supplier (supplier_id),
    status         TEXT NOT NULL DEFAULT 'PROPOSED'
        CHECK (status IN ('PROPOSED', 'APPROVED', 'PURCHASED', 'INSTALLED', 'CLOSED')),
    proposed_on    date NOT NULL,
    approved_by    TEXT,
    approved_at    timestamptz,
    -- Who moved it past PROPOSED. maker != checker, below.
    decided_by     TEXT,
    created_by     TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     TEXT,
    updated_at     timestamptz,
    version        integer NOT NULL DEFAULT 1,

    CONSTRAINT ga_replacement_new_is_not_old CHECK
        (new_asset_id IS NULL OR new_asset_id <> old_asset_id),
    CONSTRAINT ga_replacement_decider_is_not_maker CHECK
        (decided_by IS NULL OR decided_by <> created_by)
);

CREATE INDEX ix_ga_replacement_old ON ga_replacement (old_asset_id);
CREATE INDEX ix_ga_replacement_open ON ga_replacement (proposed_on)
 WHERE status <> 'CLOSED';

-- ---------------------------------------------------------------------------
-- Disposals: the request to let a thing go, and Finance's answer
-- ---------------------------------------------------------------------------
--
-- GA asks; Finance posts. The proceeds only make sense for something SOLD,
-- which is the CHECK below. Closing the row is Finance's act —
-- `ga_disposal_close` — because a disposal is not final until it is in the
-- books, and GA does not write the books.
CREATE TABLE ga_disposal (
    disposal_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id       uuid NOT NULL REFERENCES fixed_asset (asset_id),
    method         TEXT NOT NULL CHECK (method IN ('SOLD', 'SCRAPPED', 'DONATED', 'LOST')),
    proceeds_minor bigint CHECK (proceeds_minor IS NULL OR proceeds_minor >= 0),
    reason         TEXT NOT NULL CHECK (btrim(reason) <> ''),
    requested_on   date NOT NULL,
    status         TEXT NOT NULL DEFAULT 'REQUESTED'
        CHECK (status IN ('REQUESTED', 'APPROVED', 'POSTED', 'REJECTED')),
    -- Why Finance answered as it did, appended when the decision is made.
    notes          TEXT,
    approved_by    TEXT,
    approved_at    timestamptz,
    -- Finance, saat membukukan.
    closed_by      TEXT,
    closed_at      timestamptz,
    created_by     TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     TEXT,
    updated_at     timestamptz,
    version        integer NOT NULL DEFAULT 1,

    -- Hasil penjualan hanya masuk akal untuk yang dijual.
    CONSTRAINT ga_disposal_proceeds_only_when_sold CHECK
        (method = 'SOLD' OR proceeds_minor IS NULL OR proceeds_minor = 0),
    CONSTRAINT ga_disposal_approver_is_not_maker CHECK
        (approved_by IS NULL OR approved_by <> created_by)
);

CREATE INDEX ix_ga_disposal_asset ON ga_disposal (asset_id);

-- ---------------------------------------------------------------------------
-- fixed_asset.status: the two words GA needs and Finance never writes
-- ---------------------------------------------------------------------------
--
-- 0215 last set the list. The full list is repeated rather than inherited
-- because a CHECK cannot add to a predecessor: the two new words are
-- DISPOSAL_REQUESTED (GA asked; Finance has not booked it yet) and REPLACED
-- (a swap installed a new thing in this one's place). Finance reads both and
-- writes neither — its own side of an asset is `asset_capitalization`, which
-- is a separate fact and a separate table.
ALTER TABLE fixed_asset DROP CONSTRAINT fixed_asset_status_check;
ALTER TABLE fixed_asset ADD CONSTRAINT fixed_asset_status_check
    CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'REGISTERED', 'IN_SERVICE',
                      'DISPOSAL_REQUESTED', 'DISPOSED', 'REPLACED'));

-- ---------------------------------------------------------------------------
-- The record kinds, so every new object can carry files and history
-- ---------------------------------------------------------------------------
INSERT INTO record_kind (code, label) VALUES
    ('maintenance_task', 'Maintenance task'),
    ('inspection', 'Inspection'),
    ('repair', 'Repair'),
    ('replacement', 'Replacement'),
    ('disposal', 'Disposal')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verified, not assumed
-- ---------------------------------------------------------------------------
--
-- Deliberately silent about the global posting switch: 0364 turned it back ON
-- by owner decision, so asserting it is off here would be asserting yesterday's
-- rule. What this block proves is that the five tables, the trigger and the two
-- status words are really in place.
DO $$
DECLARE
    absent  text;
    probe   text;
    probe_id uuid;
    refused text;
    definition text;
BEGIN
    SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO absent
      FROM unnest(ARRAY['ga_maintenance_task', 'ga_inspection', 'ga_repair',
                        'ga_replacement', 'ga_disposal']) t(name)
     WHERE NOT EXISTS (
           SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t.name);
    IF absent IS NOT NULL THEN
        RAISE EXCEPTION '0365 left these tables out: %', absent;
    END IF;

    -- The one-subject rule for a task, refused by the database so a writer that
    -- forgot cannot slip a subjectless row in.
    BEGIN
        INSERT INTO ga_maintenance_task (title, interval_kind, interval_value, created_by)
        VALUES ('tanpa subjek', 'MONTHS', 3, 'migrasi');
        RAISE EXCEPTION '0365 did not refuse a maintenance task with no subject';
    EXCEPTION WHEN check_violation THEN
        refused := 'subject'; NULL;
    END;

    IF refused <> 'subject' THEN
        RAISE EXCEPTION '0365 did not verify the task subject rule';
    END IF;

    -- The append-only trigger on an inspection, proven the way 0357 proves
    -- its own: a live UPDATE and a live DELETE, each expected to come back as
    -- the trigger's own sentence. The probe rows go with the subtransaction.
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'ga_inspection'::regclass
           AND tgname  = 'ga_inspection_append_only'
           AND NOT tgisinternal)
    THEN
        RAISE EXCEPTION '0365 did not install the append-only trigger on ga_inspection';
    END IF;

    FOREACH probe IN ARRAY ARRAY['UPDATE', 'DELETE'] LOOP
        probe_id := gen_random_uuid();
        refused  := NULL;
        BEGIN
            INSERT INTO fixed_asset
                (asset_id, asset_number, name, category_code, site_id, acquired_on, registered_by)
            VALUES (probe_id, 'PROBE-0365-' || probe, '0365 probe', 'AIR_CONDITIONER',
                    'dc', current_date, 'probe');
            INSERT INTO ga_inspection
                (asset_id, inspected_on, inspected_by, result, findings, recorded_by)
            VALUES (probe_id, current_date, 'probe', 'BAIK', '0365 probe', 'probe');
            IF probe = 'UPDATE' THEN
                UPDATE ga_inspection SET findings = 'diubah' WHERE asset_id = probe_id;
            ELSE
                DELETE FROM ga_inspection WHERE asset_id = probe_id;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            refused := SQLERRM;
        END;

        IF refused IS NULL THEN
            RAISE EXCEPTION '0365: the append-only trigger allowed a % on ga_inspection', probe;
        END IF;
        IF refused NOT LIKE '%appended, not%' THEN
            RAISE EXCEPTION '0365: the % probe failed for another reason: %', probe, refused;
        END IF;
    END LOOP;

    -- The two status words, read off the live constraint rather than a probe
    -- row — a probe would have to invent an asset and then live in the register.
    SELECT pg_get_constraintdef(oid) INTO definition
      FROM pg_constraint
     WHERE conrelid = 'fixed_asset'::regclass
       AND conname  = 'fixed_asset_status_check';
    IF definition IS NULL
       OR definition NOT LIKE '%DISPOSAL_REQUESTED%'
       OR definition NOT LIKE '%REPLACED%'
    THEN
        RAISE EXCEPTION '0365 did not extend fixed_asset.status: %', definition;
    END IF;

    IF (SELECT count(*) FROM record_kind
         WHERE code IN ('maintenance_task', 'inspection', 'repair',
                        'replacement', 'disposal')) <> 5 THEN
        RAISE EXCEPTION '0365 did not install all five record kinds';
    END IF;
END;
$$;
