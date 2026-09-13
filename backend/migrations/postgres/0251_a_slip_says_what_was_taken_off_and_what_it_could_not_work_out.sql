-- 0251: A slip says what was taken off, and what it could not work out.
--
-- `0105` gave `payroll_slip` a base, the standing allowances, a statutory base
-- and three fact counters, and wrote in its own comment: *"**No deduction is
-- computed**: the columns for them do not exist, so nothing can quietly
-- acquire a zero that reads as 'nothing was owed'."*
--
-- That was the right shape while nothing could compute a deduction. `0250`
-- gives an operator a way to state one, so the columns arrive — and the
-- sentence above is honoured rather than reversed: **they are nullable, and a
-- slip that could not work a figure out says which component it could not
-- work it out from.**
--
-- # Absence is not nought, in three columns
--
--   * `gross_minor` is NOT NULL, because it is a sum of figures that are all
--     on the slip: the statutory base it already copied, plus the earning
--     lines below. It is never a guess.
--   * `deduction_total_minor` is NULL when any DEDUCTION component in force
--     has no ratified rate. Not nought — nought is what a system reports when
--     somebody has looked and found nothing owed, and nobody has looked.
--   * `net_minor` is NULL when **anything** was unworkable, earning or
--     deduction: a net computed from a short gross is a number somebody would
--     pay from.
--
-- `components_incomplete_because` carries the sentence, naming the components.
-- The same discipline `CloseReadiness`'s `Option<u32>` and
-- `payroll_run.incomplete_because` already follow, one level down.
--
-- # A line is a snapshot, not a pointer
--
-- `payroll_slip_line` stores the amount as computed **and every input it was
-- computed from** — the base it was a share of, the basis points, the cap, the
-- divisor, the multiplier, the unit, the count and the per-unit rate. So a
-- rate ratified next January cannot change what December's slip said, and an
-- auditor can reproduce any line from the line alone without joining to
-- anything that may since have moved. That is the same reason the slip copies
-- the pay agreement rather than joining `employee_pay`.
--
-- It is also the answer to a fault this estate has already had: a computation
-- that derives more than it keeps leaves a figure nobody can explain. Every
-- intermediate this engine forms is a column below.
--
-- # What the handover to Finance crosses, now that something can be valued
--
-- `0231` set `payroll_handover.gross_minor` to the statutory base and said
-- why: *"no rate for either exists anywhere in this estate, so neither becomes
-- money here."* One now can, so the crossing reads `payroll_slip.gross_minor`
-- — still gross, still nothing statutory netted off, but including valued
-- overtime and the incentives the place filed. The column's comment is
-- corrected at the foot of this file rather than left to contradict the code.
--
-- Handovers already written do not move. Their lines were copied at the moment
-- they crossed, which is `0231`'s own design.

-- ---------------------------------------------------------------------------
-- The three totals
-- ---------------------------------------------------------------------------

ALTER TABLE payroll_slip
    ADD COLUMN gross_minor bigint,
    ADD COLUMN deduction_total_minor bigint,
    ADD COLUMN net_minor bigint,
    ADD COLUMN components_incomplete_because text;

-- Every slip that already exists was built with no component engine at all, so
-- its gross is what it always was and its deductions were never assessed.
-- Back-filling a nought here would be the exact mistake this file exists to
-- refuse — and it would be worse than a live one, because nobody would be
-- looking at a closed month.
UPDATE payroll_slip
   SET gross_minor = statutory_base_minor,
       components_incomplete_because =
           'this slip was built before any payroll component existed, so no '
           'deduction was assessed on it and none was found to be nil'
 WHERE gross_minor IS NULL;

ALTER TABLE payroll_slip
    ALTER COLUMN gross_minor SET NOT NULL,
    ADD CONSTRAINT payroll_slip_gross_is_not_negative
        CHECK (gross_minor >= 0),
    ADD CONSTRAINT payroll_slip_deductions_are_not_negative
        CHECK (deduction_total_minor IS NULL OR deduction_total_minor >= 0),
    -- A net figure exists exactly when nothing was left unworked out, and the
    -- sentence exists exactly when something was. One fact, so it cannot be
    -- recorded two ways.
    ADD CONSTRAINT payroll_slip_net_is_known_only_when_everything_was
        CHECK ((net_minor IS NULL) = (components_incomplete_because IS NOT NULL)),
    -- Unknown deductions leave no net. The converse does not hold: an
    -- unratified EARNING leaves the deduction total perfectly knowable and the
    -- net not, because the gross it would be subtracted from is short.
    ADD CONSTRAINT payroll_slip_unknown_deductions_leave_no_net
        CHECK (deduction_total_minor IS NOT NULL OR net_minor IS NULL),
    -- net = gross − deductions, in the database as well as in the code. The
    -- arithmetic is not hard; what this refuses is the row where one of the
    -- three was written from a later state than the other two.
    ADD CONSTRAINT payroll_slip_net_is_gross_less_deductions
        CHECK (net_minor IS NULL
               OR net_minor = gross_minor - deduction_total_minor);

-- ---------------------------------------------------------------------------
-- The lines
-- ---------------------------------------------------------------------------

CREATE TABLE payroll_slip_line (
    run_id         text NOT NULL,
    employee_id    text NOT NULL,
    -- Presentation order, and the only thing on this row that is not evidence:
    -- earnings before deductions, each by code, so two runs of the same month
    -- produce the same slip in the same order.
    line_no        integer NOT NULL CHECK (line_no > 0),
    kind           text NOT NULL CHECK (kind IN ('EARNING', 'DEDUCTION')),
    component_code text NOT NULL REFERENCES pay_component(code),
    -- Copied, not joined. Renaming a component must not rewrite a slip.
    label          text NOT NULL CHECK (btrim(label) <> ''),
    basis          text NOT NULL CHECK (basis IN (
                       'FIXED_AMOUNT',
                       'SHARE_OF_BASE',
                       'RATE_PER_UNIT',
                       'FRACTION_OF_BASE_PER_UNIT',
                       'PER_OCCASION')),
    -- ── every input, as it stood ────────────────────────────────────────
    base_ref       text CHECK (base_ref IN ('BASE', 'STATUTORY_BASE')),
    -- The figure that base actually held on this slip — after any cap. So
    -- `base_of_minor × rate_bp / 10000 = amount_minor` reproduces a capped
    -- BPJS line from the line alone, which is what an auditor asks of it.
    base_of_minor  bigint CHECK (base_of_minor >= 0),
    rate_bp        integer CHECK (rate_bp > 0),
    cap_minor      bigint CHECK (cap_minor > 0),
    hours_divisor  integer CHECK (hours_divisor > 0),
    multiplier_bp  integer CHECK (multiplier_bp > 0),
    unit           text,
    -- How many of them, in the thing the unit counts: whole minutes for the
    -- overtime bands, whole days for the rest. `pay_component.unit` records
    -- which, and 0250's comment says why the bands are not decimal hours.
    --
    -- **Zero is a real count** and is written rather than omitted: a per-day
    -- allowance produces nothing for somebody nobody rostered, and a line
    -- saying "26 days at nil" versus "nil days at 20.000" are two different
    -- explanations of the same missing money. `RunReconciliation` counts these
    -- so head office sees them before approving.
    units          integer CHECK (units >= 0),
    -- The per-unit figure actually used: the money per day for a
    -- `RATE_PER_UNIT`, and the **hourly wage** for a
    -- `FRACTION_OF_BASE_PER_UNIT` — which is the figure an Indonesian payslip
    -- prints and the one a person checks by hand. With `units` beside it,
    -- `rate_minor * units / 60` reproduces an overtime line exactly, and
    -- `rate_minor * units` a per-day one.
    rate_minor     bigint CHECK (rate_minor >= 0),
    -- What it came to. Non-negative on both kinds: which way it points is
    -- `kind`, so nothing here can be negated by a typo.
    amount_minor   bigint NOT NULL CHECK (amount_minor >= 0),
    PRIMARY KEY (run_id, employee_id, line_no),
    -- The slip owns its lines. It is rebuilt whenever a draft run is rebuilt,
    -- and it goes when the run goes, for the reason `0105` lets a slip cascade
    -- from a run: a slip is a working figure until somebody signs for it. What
    -- crossed to Finance is a separate snapshot and does not cascade.
    FOREIGN KEY (run_id, employee_id)
        REFERENCES payroll_slip (run_id, employee_id) ON DELETE CASCADE,
    -- One line per component per person. Two would leave the totals right and
    -- the breakdown nonsense — and it is also what makes "which of these two
    -- won" a question nobody can ask (0250's header).
    CONSTRAINT payroll_slip_line_one_per_component
        UNIQUE (run_id, employee_id, component_code),
    -- A line carries the inputs its own basis needs, and none it does not.
    -- Same shape as `pay_component_rate`'s check, one step downstream, and it
    -- is worth repeating here because this row outlives the rate it was
    -- computed from.
    CONSTRAINT payroll_slip_line_states_exactly_its_basis CHECK (
        CASE basis
            WHEN 'FIXED_AMOUNT' THEN
                base_ref IS NULL AND base_of_minor IS NULL AND rate_bp IS NULL
                AND cap_minor IS NULL AND hours_divisor IS NULL
                AND multiplier_bp IS NULL AND unit IS NULL AND units IS NULL
                AND rate_minor IS NULL
            WHEN 'PER_OCCASION' THEN
                base_ref IS NULL AND base_of_minor IS NULL AND rate_bp IS NULL
                AND cap_minor IS NULL AND hours_divisor IS NULL
                AND multiplier_bp IS NULL AND unit IS NULL AND units IS NULL
                AND rate_minor IS NULL
            WHEN 'SHARE_OF_BASE' THEN
                base_ref IS NOT NULL AND base_of_minor IS NOT NULL
                AND rate_bp IS NOT NULL AND hours_divisor IS NULL
                AND multiplier_bp IS NULL AND unit IS NULL AND units IS NULL
                AND rate_minor IS NULL
            WHEN 'RATE_PER_UNIT' THEN
                unit IS NOT NULL AND units IS NOT NULL
                AND rate_minor IS NOT NULL AND base_ref IS NULL
                AND base_of_minor IS NULL AND rate_bp IS NULL
                AND cap_minor IS NULL AND hours_divisor IS NULL
                AND multiplier_bp IS NULL
            WHEN 'FRACTION_OF_BASE_PER_UNIT' THEN
                base_ref IS NOT NULL AND base_of_minor IS NOT NULL
                AND hours_divisor IS NOT NULL AND multiplier_bp IS NOT NULL
                AND unit IS NOT NULL AND units IS NOT NULL
                AND rate_minor IS NOT NULL
                AND rate_bp IS NULL AND cap_minor IS NULL
        END
    )
);

-- The payslip read: every line of one slip, in order.
CREATE INDEX ix_payroll_slip_line_slip
    ON payroll_slip_line (run_id, employee_id, line_no);

COMMENT ON COLUMN payroll_slip.gross_minor IS
    'The statutory base plus every EARNING line. A real sum of figures that '
    'are all on this slip, which is why it is NOT NULL where the two below '
    'are not.';
COMMENT ON COLUMN payroll_slip.deduction_total_minor IS
    'NULL when a DEDUCTION component in force has no ratified rate. Not '
    'nought: nought is what somebody reports after looking, and nobody has.';
COMMENT ON COLUMN payroll_slip.net_minor IS
    'gross - deductions, and NULL whenever anything on this slip could not be '
    'worked out. See components_incomplete_because for which.';
COMMENT ON TABLE payroll_slip_line IS
    'One computed line, with every input it was computed from, snapshotted. A '
    'rate ratified next year cannot change what this slip said, and any line '
    'can be reproduced from itself without joining to anything (0251).';

-- 0231 said gross was base plus standing allowances because nothing in the
-- estate could value a minute of overtime. 0250 lets an operator ratify the
-- rate that does, so this corrects the promise rather than leaving the comment
-- to disagree with the query behind it.
COMMENT ON COLUMN payroll_handover.gross_minor IS
    'The slips'' own gross: base, standing allowances, valued overtime and the '
    'one-off earnings the place filed. Still gross — nothing statutory is '
    'netted off, because nothing here computes PPh 21 or BPJS for the '
    'authorities and a figure this backend invented is one somebody would '
    'file with them (0231, corrected by 0251).';
