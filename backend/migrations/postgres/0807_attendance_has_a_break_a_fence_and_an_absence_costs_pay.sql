-- 0807: a shift has a break, a phone punch can be fenced, and an absence
-- can cost pay.
--
-- Four of Talenta's attendance settings the owner kept on 2026-09-30.
--
-- Jam istirahat: a shift already says how long its unpaid break is; it now
-- may say when it starts, so a roster and a payslip read "break 12:00–13:00"
-- rather than "60 minutes, some time".
--
-- Setting absen mobile: whether the employee app may record a punch at all,
-- and whether it must carry where the phone was. Company-wide, one row.
--
-- Lokasi absen (geofence): a unit may draw a circle — a point and a radius —
-- and when the company requires it, a phone punch from outside the circle is
-- refused. A unit with no circle is not fenced. Every phone punch that sent
-- a location keeps it, and its distance from the fence, as evidence.
--
-- Potongan absen: a rostered working day, already past, with no punch, no
-- approved leave and no approved correction is an absence; when head office
-- turns the rule on, each one costs a day's pay — the base (or base plus fixed
-- allowances) over the month's calendar days, or over a fixed divisor such as
-- 25 working days. Off until somebody states it: a deduction nobody chose is
-- a wage nobody was paid.

ALTER TABLE attendance_shift
    ADD COLUMN break_start_minute integer CHECK (break_start_minute BETWEEN 0 AND 2879);

CREATE TABLE attendance_mobile_setting (
    singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    mobile_enabled     boolean NOT NULL DEFAULT true,
    require_location   boolean NOT NULL DEFAULT false,
    require_geofence   boolean NOT NULL DEFAULT false,
    updated            jsonb,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_mobile_fence_needs_a_location
        CHECK (NOT require_geofence OR require_location)
);

INSERT INTO attendance_mobile_setting (singleton) VALUES (true);

CREATE TABLE unit_geofence (
    unit_id    text PRIMARY KEY REFERENCES unit (id),
    latitude   double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude  double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    radius_m   integer NOT NULL CHECK (radius_m BETWEEN 10 AND 5000),
    set_by     jsonb NOT NULL,
    set_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE attendance_punch
    ADD COLUMN latitude   double precision CHECK (latitude BETWEEN -90 AND 90),
    ADD COLUMN longitude  double precision CHECK (longitude BETWEEN -180 AND 180),
    ADD COLUMN distance_m integer CHECK (distance_m >= 0),
    ADD CONSTRAINT attendance_punch_location_is_whole
        CHECK ((latitude IS NULL) = (longitude IS NULL));

CREATE TABLE absence_deduction_rule (
    effective_from  date PRIMARY KEY,
    enabled         boolean NOT NULL,
    -- BASE: the base salary; WAGE: base plus fixed allowances.
    basis           text NOT NULL CHECK (basis IN ('BASE', 'WAGE')),
    -- NULL: the month's calendar days; otherwise a fixed divisor (25, 26…).
    divisor_days    integer CHECK (divisor_days BETWEEN 1 AND 31),
    ratified        jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO absence_deduction_rule (effective_from, enabled, basis, divisor_days, ratified)
VALUES ('2020-01-01', false, 'BASE', NULL,
        '{"actor": "system", "action_key": "people.pay_component.ratify", "at": "2026-10-01T00:00:00Z", "reason": "seeded by 0807: no absence deduction until head office states one"}');

INSERT INTO pay_component (code, label, kind, basis, defined)
VALUES ('POTONGAN_ABSEN', 'Potongan absen', 'DEDUCTION', 'STATUTORY',
        '{"actor": "system", "action_key": "people.pay_component.define", "at": "2026-10-01T00:00:00Z", "reason": "absence deduction component seeded by 0807"}')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE payroll_slip
    ADD COLUMN absent_days integer CHECK (absent_days >= 0);

COMMENT ON COLUMN payroll_slip.absent_days IS
    'Rostered working days in the attendance month, already past, with no punch, no approved leave and no approved correction (0807). NULL on a slip built before it.';
