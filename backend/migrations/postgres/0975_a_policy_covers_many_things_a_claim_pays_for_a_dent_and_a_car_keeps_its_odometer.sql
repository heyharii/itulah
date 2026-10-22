-- 0975 — one policy covers many things, a claim under it pays for a dent, and
-- a car keeps its odometer readings.
--
-- # One policy, many things (owner, 17 Oct 2026)
--
-- An insurance policy, the PDF of it, and the things it protects are three
-- facts. One fleet policy protects six vans; one property policy protects the
-- ACs and the genset of a store. `ga_contract.asset_id` held ONE asset, so the
-- second van had nowhere to go. The roster is a table now: a row per asset a
-- contract covers, from the day it joined the roster to the day it left. A
-- contract for a whole site does not put every asset at the site on its roster
-- by itself; somebody adds them, because "is the genset on the policy" is a
-- question the insurer answers, not the site.
CREATE TABLE ga_contract_asset (
    cover_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id    uuid NOT NULL REFERENCES ga_contract (contract_id) ON DELETE RESTRICT,
    asset_id       uuid NOT NULL REFERENCES fixed_asset (asset_id) ON DELETE RESTRICT,
    -- The day it joined the roster, and the last day it was on it. Kept, not
    -- deleted, when it leaves: a claim for a dent last March asks whether the
    -- van was covered last March.
    covered_from   date NOT NULL,
    covered_until  date,
    added_by       TEXT NOT NULL CHECK (btrim(added_by) <> ''),
    added_at       timestamptz NOT NULL DEFAULT now(),
    removed_by     TEXT,
    removed_at     timestamptz,
    CONSTRAINT ga_contract_asset_window
        CHECK (covered_until IS NULL OR covered_until >= covered_from),
    CONSTRAINT ga_contract_asset_removal_says_who
        CHECK ((covered_until IS NULL) = (removed_by IS NULL))
);

-- On the roster once at a time; a van taken off and put back is two rows.
CREATE UNIQUE INDEX ux_ga_contract_asset_on_roster
    ON ga_contract_asset (contract_id, asset_id) WHERE covered_until IS NULL;
-- The asset sheet's question: which contracts cover this thing.
CREATE INDEX ix_ga_contract_asset_asset ON ga_contract_asset (asset_id, contract_id);

COMMENT ON TABLE ga_contract_asset IS
    'The assets a contract covers (0975): a policy over a fleet, a maintenance contract over a store''s ACs. One row per stay on the roster; covered_until closes it.';

-- The one asset a contract named before, as the first row of its roster, from
-- the day the deal started.
INSERT INTO ga_contract_asset (contract_id, asset_id, covered_from, added_by, added_at)
SELECT contract_id, asset_id, starts_on, created_by, created_at
  FROM ga_contract
 WHERE asset_id IS NOT NULL;

-- And the column goes: two places that say what a contract covers would
-- disagree the first time somebody edited one of them.
DROP INDEX IF EXISTS ix_ga_contract_asset;
ALTER TABLE ga_contract DROP COLUMN asset_id;

-- # A claim pays for a dent (owner, 17 Oct 2026)
--
-- Damage to an insured thing, claimed under its policy: reported, submitted to
-- the insurer, surveyed, approved or rejected, and paid. The repair it pays
-- for is a repair like any other (`ga_repair`), named here; finishing the
-- repair, the insurer approving the claim and the insurer's money arriving are
-- three different events, so they are three different columns, not one status.
CREATE TABLE ga_insurance_claim (
    claim_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The policy: a vehicle or a property insurance contract.
    contract_id          uuid NOT NULL REFERENCES ga_contract (contract_id),
    -- The damaged thing, on the policy's roster on the day it happened. Empty
    -- for damage to the place itself (a flooded store under its property
    -- policy).
    asset_id             uuid REFERENCES fixed_asset (asset_id),
    site_id              TEXT NOT NULL REFERENCES site (id),
    incident_on          date NOT NULL,
    description          TEXT NOT NULL CHECK (btrim(description) <> ''),
    estimated_loss_minor bigint CHECK (estimated_loss_minor IS NULL OR estimated_loss_minor >= 0),
    status               TEXT NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN ('DRAFT', 'SUBMITTED', 'SURVEYED',
                                               'APPROVED', 'PAID', 'REJECTED')),
    -- The insurer's own number, from the day it was submitted.
    insurer_claim_number TEXT,
    submitted_on         date,
    surveyed_on          date,
    surveyor             TEXT,
    -- The insurer's decision: what it will pay, what we pay ourselves.
    decided_on           date,
    approved_minor       bigint CHECK (approved_minor IS NULL OR approved_minor >= 0),
    deductible_minor     bigint CHECK (deductible_minor IS NULL OR deductible_minor >= 0),
    rejected_reason      TEXT,
    -- The repair the claim pays for. One claim pays for one repair.
    repair_id            uuid REFERENCES ga_repair (repair_id),
    -- The insurer's money, when it arrived; and the BKM Finance booked it on,
    -- when GA knows it. Finance's receipt stays Finance's record.
    paid_on              date,
    paid_minor           bigint CHECK (paid_minor IS NULL OR paid_minor >= 0),
    cash_document_id     uuid REFERENCES cash_document (document_id),
    notes                TEXT,
    created_by           TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_by           TEXT,
    updated_at           timestamptz,
    version              integer NOT NULL DEFAULT 1,
    CONSTRAINT ga_insurance_claim_submitted_has_a_day
        CHECK (status = 'DRAFT' OR submitted_on IS NOT NULL),
    CONSTRAINT ga_insurance_claim_surveyed_has_a_day
        CHECK (status NOT IN ('SURVEYED', 'APPROVED', 'PAID') OR surveyed_on IS NOT NULL),
    CONSTRAINT ga_insurance_claim_approved_has_an_amount
        CHECK (status NOT IN ('APPROVED', 'PAID')
               OR (approved_minor IS NOT NULL AND decided_on IS NOT NULL)),
    CONSTRAINT ga_insurance_claim_paid_has_a_day
        CHECK (status <> 'PAID' OR (paid_on IS NOT NULL AND paid_minor IS NOT NULL)),
    CONSTRAINT ga_insurance_claim_rejected_says_why
        CHECK (status <> 'REJECTED'
               OR (btrim(coalesce(rejected_reason, '')) <> '' AND decided_on IS NOT NULL))
);

CREATE INDEX ix_ga_insurance_claim_contract ON ga_insurance_claim (contract_id, incident_on DESC);
CREATE INDEX ix_ga_insurance_claim_asset ON ga_insurance_claim (asset_id, incident_on DESC)
    WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX ux_ga_insurance_claim_repair ON ga_insurance_claim (repair_id)
    WHERE repair_id IS NOT NULL;
-- One BKM answers one claim, as one bill answers one expense.
CREATE UNIQUE INDEX ux_ga_insurance_claim_cash ON ga_insurance_claim (cash_document_id)
    WHERE cash_document_id IS NOT NULL;

COMMENT ON TABLE ga_insurance_claim IS
    'Damage claimed under a vehicle or property policy (0975): Draft → Submitted → Surveyed → Approved → Paid, or Rejected. Names the repair it pays for.';

-- Photos, the police report and the survey letter attach through
-- document_link like any other paper.
INSERT INTO record_kind (code, label) VALUES
    ('insurance_claim', 'Insurance claim')
ON CONFLICT (code) DO NOTHING;

-- # A car keeps its odometer (owner, 17 Oct 2026)
--
-- A vehicle's readings over time: typed by GA, written down at a fill-up, read
-- at a service. Every reading is a row with the day it was read and where it
-- came from, so "48.210 km" on the sheet can say since when, and a service due
-- "at 50.000 km" is measured against the latest one. A reading written with a
-- fuel receipt belongs to that receipt and goes when the receipt is cancelled.
CREATE TABLE ga_odometer_reading (
    reading_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id      uuid NOT NULL REFERENCES fixed_asset (asset_id),
    read_on       date NOT NULL,
    odometer_km   integer NOT NULL CHECK (odometer_km >= 0),
    -- READING: typed on its own. EXPENSE: written with a fuel or parts
    -- receipt. SERVICE: read when a scheduled service was done.
    source        TEXT NOT NULL CHECK (source IN ('READING', 'EXPENSE', 'SERVICE')),
    expense_id    uuid UNIQUE REFERENCES ga_operating_expense (expense_id) ON DELETE CASCADE,
    inspection_id uuid REFERENCES ga_inspection (inspection_id),
    note          TEXT,
    recorded_by   TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ga_odometer_reading_expense_source
        CHECK ((source = 'EXPENSE') = (expense_id IS NOT NULL)),
    CONSTRAINT ga_odometer_reading_service_source
        CHECK (source <> 'SERVICE' OR inspection_id IS NOT NULL)
);

CREATE INDEX ix_ga_odometer_reading_asset
    ON ga_odometer_reading (asset_id, read_on DESC, odometer_km DESC);

COMMENT ON TABLE ga_odometer_reading IS
    'A vehicle''s odometer over time (0975): typed, from a fuel receipt, or read at a service. Runs forward; the latest drives km-based service.';

-- The readings GA already has, from the receipts that carried one.
INSERT INTO ga_odometer_reading
    (asset_id, read_on, odometer_km, source, expense_id, recorded_by, recorded_at)
SELECT e.asset_id, e.spent_on, e.odometer_km, 'EXPENSE', e.expense_id, e.created_by, e.created_at
  FROM ga_operating_expense e
  JOIN fixed_asset a ON a.asset_id = e.asset_id
  JOIN asset_class c ON c.class_code = a.category_code
 WHERE e.odometer_km IS NOT NULL
   AND e.status <> 'CANCELLED'
   AND c.build = 'VEHICLE';

-- # A km service knows the km it is due at
--
-- "Every 10.000 km" has no date, so `next_due` stays empty for it; the reading
-- it falls due at is its own column. Recording the service moves it on from
-- the odometer at that service, as a dated task moves on from the day.
ALTER TABLE ga_maintenance_task
    ADD COLUMN next_due_km integer CHECK (next_due_km IS NULL OR next_due_km > 0);
ALTER TABLE ga_maintenance_task
    ADD CONSTRAINT ga_maintenance_task_km_due_is_km
        CHECK (interval_kind = 'KM' OR next_due_km IS NULL);

COMMENT ON COLUMN ga_maintenance_task.next_due_km IS
    'For a KM task: the odometer reading the next service is due at (0975). Moved on from the reading at each service.';

-- Today's km tasks are due at the first multiple of their interval past the
-- latest reading, which is what their sheet already showed.
UPDATE ga_maintenance_task t
   SET next_due_km = (r.top / t.interval_value + 1) * t.interval_value
  FROM (SELECT asset_id, max(odometer_km) AS top
          FROM ga_odometer_reading GROUP BY asset_id) r
 WHERE t.interval_kind = 'KM'
   AND t.asset_id = r.asset_id;
