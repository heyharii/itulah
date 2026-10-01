-- 0800: a slip works out what the state takes and what the company adds.
--
-- Until now payroll computed nothing statutory: `0105` held that a figure
-- computed here is one somebody files with the tax office, so PPh 21 and BPJS
-- were worked out outside and entered by Finance. The owner reversed that on
-- 2026-09-30 ("harusnya sesuai Talenta, PPh 21 otomatis"), with three choices
-- made the same day:
--
--   * who bears PPh 21 is chosen **per employee** — withheld (GROSS), grossed
--     up with a tunjangan (GROSS_UP), or borne by the company (NETTO);
--   * the first phase is the core — PPh 21 (TER, and the year settled in its
--     last month), BPJS, prorata — with THR and the 1721-A1 form after it;
--   * JKK at 0,24 %, the very-low risk class, for every unit.
--
-- Law and rates are kept apart. The TER tables, Pasal 17, PTKP and biaya
-- jabatan are constants in `domain::pay::statutory` — regulation, pinned by
-- tests. The BPJS rates and wage caps move every March, so they are data here:
-- `statutory_rate`, effective-dated and ratified by head office like a
-- component's rate.
--
-- How the arithmetic reaches a slip: as ordinary slip lines on system
-- components of a sixth basis, STATUTORY. A STATUTORY component carries no
-- rate row — the kernel works its amount out — and nobody may define one
-- through the API; the eleven below are the whole set. The company's share of
-- BPJS and a tax the company bears are DEDUCTION components marked
-- `employer_borne` (0466): the accrual already posts those as the company's
-- cost and not the employee's, and from this migration the slip agrees — they
-- are shown on it and are not taken from net pay.

-- ── BPJS rates, effective-dated ─────────────────────────────────────────────

CREATE TABLE statutory_rate (
    effective_from         date PRIMARY KEY,
    kesehatan_company_bp   integer NOT NULL CHECK (kesehatan_company_bp  BETWEEN 0 AND 10000),
    kesehatan_employee_bp  integer NOT NULL CHECK (kesehatan_employee_bp BETWEEN 0 AND 10000),
    kesehatan_cap_minor    bigint  NOT NULL CHECK (kesehatan_cap_minor > 0),
    jht_company_bp         integer NOT NULL CHECK (jht_company_bp  BETWEEN 0 AND 10000),
    jht_employee_bp        integer NOT NULL CHECK (jht_employee_bp BETWEEN 0 AND 10000),
    jp_company_bp          integer NOT NULL CHECK (jp_company_bp  BETWEEN 0 AND 10000),
    jp_employee_bp         integer NOT NULL CHECK (jp_employee_bp BETWEEN 0 AND 10000),
    jp_cap_minor           bigint  NOT NULL CHECK (jp_cap_minor > 0),
    jkk_bp                 integer NOT NULL CHECK (jkk_bp BETWEEN 0 AND 10000),
    jkm_bp                 integer NOT NULL CHECK (jkm_bp BETWEEN 0 AND 10000),
    ratified               jsonb   NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE statutory_rate IS
    'BPJS rates and wage caps from a date (0800). Rates in hundredths of a percent; caps in rupiah. The row in force for a month is the latest effective_from on or before its first day.';

-- Kesehatan 4 % + 1 % on at most Rp12.000.000 (Perpres 64/2020); JHT 3,7 % +
-- 2 %; JP 2 % + 1 % on at most the cap BPJS Ketenagakerjaan publishes each
-- March (Rp10.547.400 from March 2025, Rp11.086.300 from March 2026); JKK
-- 0,24 %; JKM 0,3 %.
INSERT INTO statutory_rate
    (effective_from, kesehatan_company_bp, kesehatan_employee_bp, kesehatan_cap_minor,
     jht_company_bp, jht_employee_bp, jp_company_bp, jp_employee_bp, jp_cap_minor,
     jkk_bp, jkm_bp, ratified)
VALUES
    ('2025-03-01', 400, 100, 12000000, 370, 200, 200, 100, 10547400, 24, 30,
     '{"actor": "system", "action_key": "people.pay_component.ratify", "at": "2026-09-30T00:00:00Z", "reason": "seeded by 0800: JP cap from March 2025"}'),
    ('2026-03-01', 400, 100, 12000000, 370, 200, 200, 100, 11086300, 24, 30,
     '{"actor": "system", "action_key": "people.pay_component.ratify", "at": "2026-09-30T00:00:00Z", "reason": "seeded by 0800: JP cap from March 2026"}');

-- ── who bears the tax ───────────────────────────────────────────────────────

ALTER TABLE payroll_identity
    ADD COLUMN tax_method text NOT NULL DEFAULT 'GROSS'
        CHECK (tax_method IN ('GROSS', 'GROSS_UP', 'NETTO'));

COMMENT ON COLUMN payroll_identity.tax_method IS
    'Who bears PPh 21 (0800): GROSS withheld from pay, GROSS_UP a tunjangan PPh 21 that pays the tax on itself, NETTO borne by the company. A projection of the amendments, like ptkp.';

-- ── a sixth basis ───────────────────────────────────────────────────────────

ALTER TABLE pay_component DROP CONSTRAINT pay_component_basis_check;
ALTER TABLE pay_component ADD CONSTRAINT pay_component_basis_check
    CHECK (basis IN ('FIXED_AMOUNT', 'SHARE_OF_BASE', 'RATE_PER_UNIT',
                     'FRACTION_OF_BASE_PER_UNIT', 'PER_OCCASION', 'STATUTORY'));

ALTER TABLE pay_component DROP CONSTRAINT pay_component_shape_is_whole;
ALTER TABLE pay_component ADD CONSTRAINT pay_component_shape_is_whole CHECK (
    CASE basis
        WHEN 'FIXED_AMOUNT' THEN base_ref IS NULL AND unit IS NULL
        WHEN 'PER_OCCASION' THEN base_ref IS NULL AND unit IS NULL
        WHEN 'STATUTORY' THEN base_ref IS NULL AND unit IS NULL
        WHEN 'SHARE_OF_BASE' THEN base_ref IS NOT NULL AND unit IS NULL
        WHEN 'RATE_PER_UNIT' THEN base_ref IS NULL AND unit IS NOT NULL
        WHEN 'FRACTION_OF_BASE_PER_UNIT' THEN
            base_ref IS NOT NULL
            AND unit IN ('OVERTIME_WORKDAY_FIRST_HOUR',
                         'OVERTIME_WORKDAY_LATER',
                         'OVERTIME_REST_DAY',
                         'OVERTIME_HOLIDAY')
    END
);

ALTER TABLE payroll_slip_line DROP CONSTRAINT payroll_slip_line_basis_check;
ALTER TABLE payroll_slip_line ADD CONSTRAINT payroll_slip_line_basis_check
    CHECK (basis IN ('FIXED_AMOUNT', 'SHARE_OF_BASE', 'RATE_PER_UNIT',
                     'FRACTION_OF_BASE_PER_UNIT', 'PER_OCCASION', 'STATUTORY'));

-- A TER rate of 0 % is a real rate: the first row of every table.
ALTER TABLE payroll_slip_line DROP CONSTRAINT payroll_slip_line_rate_bp_check;
ALTER TABLE payroll_slip_line ADD CONSTRAINT payroll_slip_line_rate_bp_check
    CHECK (rate_bp >= 0);

ALTER TABLE payroll_slip_line DROP CONSTRAINT payroll_slip_line_states_exactly_its_basis;
ALTER TABLE payroll_slip_line ADD CONSTRAINT payroll_slip_line_states_exactly_its_basis CHECK (
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
        -- What it was levied on and at what rate, when there is one (a TER
        -- rate, a BPJS share); nothing a component's rate row would hold.
        WHEN 'STATUTORY' THEN
            base_ref IS NULL AND cap_minor IS NULL AND hours_divisor IS NULL
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
);

-- A line says whether the company bears it, as it was when the slip was
-- built: a slip is a snapshot, and the component's flag may change later.
ALTER TABLE payroll_slip_line
    ADD COLUMN employer_borne boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT payroll_slip_line_borne_is_a_deduction
        CHECK (NOT employer_borne OR kind = 'DEDUCTION');

-- ── what a slip records about the month and the tax ─────────────────────────

ALTER TABLE payroll_slip
    ADD COLUMN days_paid                  integer CHECK (days_paid >= 0),
    ADD COLUMN days_in_month              integer CHECK (days_in_month BETWEEN 28 AND 31),
    ADD COLUMN tax_method                 text CHECK (tax_method IN ('GROSS', 'GROSS_UP', 'NETTO')),
    ADD COLUMN ptkp                       text,
    ADD COLUMN ter_category               text CHECK (ter_category IN ('A', 'B', 'C')),
    ADD COLUMN taxable_gross_minor        bigint CHECK (taxable_gross_minor >= 0),
    ADD COLUMN pph21_minor                bigint,
    ADD COLUMN pension_contribution_minor bigint CHECK (pension_contribution_minor >= 0),
    ADD COLUMN final_tax_month            boolean,
    ADD COLUMN company_borne_minor        bigint CHECK (company_borne_minor >= 0),
    ADD CONSTRAINT payroll_slip_days_paid_fit_the_month
        CHECK (days_paid IS NULL OR days_in_month IS NULL OR days_paid <= days_in_month);

COMMENT ON COLUMN payroll_slip.days_paid IS
    'Calendar days of the month the employee was posted here and on an agreement (0800); base and fixed allowances are prorated by days_paid / days_in_month.';
COMMENT ON COLUMN payroll_slip.taxable_gross_minor IS
    'The gross PPh 21 was levied on (0800): cash earnings plus the company''s BPJS Kesehatan, JKK and JKM, a gross-up tunjangan included. The year''s tax in its last month is read from these.';
COMMENT ON COLUMN payroll_slip.pph21_minor IS
    'PPh 21 of the month, withheld or borne (0800). Negative only in a last month that gives back what the year over-withheld. NULL when it could not be worked out (no PTKP).';

CREATE INDEX ix_payroll_slip_employee_year ON payroll_slip (employee_id);

-- ── the system components ───────────────────────────────────────────────────

INSERT INTO pay_component (code, label, kind, basis, defined, employer_borne)
SELECT code, label, kind, 'STATUTORY',
       jsonb_build_object(
           'actor', 'system',
           'action_key', 'people.pay_component.define',
           'at', '2026-09-30T00:00:00Z',
           'reason', 'statutory component seeded by 0800'),
       borne
  FROM (VALUES
    ('BPJS_KES',        'BPJS Kesehatan',                          'DEDUCTION', false),
    ('BPJS_JHT',        'BPJS JHT',                                'DEDUCTION', false),
    ('BPJS_JP',         'BPJS Jaminan Pensiun',                    'DEDUCTION', false),
    ('PPH21',           'PPh 21',                                  'DEDUCTION', false),
    ('BPJS_KES_CO',     'BPJS Kesehatan (perusahaan)',             'DEDUCTION', true),
    ('BPJS_JHT_CO',     'BPJS JHT (perusahaan)',                   'DEDUCTION', true),
    ('BPJS_JP_CO',      'BPJS Jaminan Pensiun (perusahaan)',       'DEDUCTION', true),
    ('BPJS_JKK_CO',     'BPJS JKK (perusahaan)',                   'DEDUCTION', true),
    ('BPJS_JKM_CO',     'BPJS JKM (perusahaan)',                   'DEDUCTION', true),
    ('PPH21_CO',        'PPh 21 ditanggung perusahaan',            'DEDUCTION', true),
    ('TUNJ_PPH21',      'Tunjangan PPh 21',                        'EARNING',   false),
    ('PPH21_RETURN',    'Pengembalian kelebihan PPh 21',           'EARNING',   false)
  ) AS seed (code, label, kind, borne)
ON CONFLICT (code) DO NOTHING;

-- ── where they land ─────────────────────────────────────────────────────────
--
-- A deduction credits its `payroll_deduction` link: PPh 21 is owed to the tax
-- office (2011), BPJS to BPJS (2021). The company's share and a tax it bears
-- are also its cost: BPJS on the insurance expense (6017 at a shop, 6031 at
-- head office — the leaves `finance_connect_integration` already posts
-- employer BPJS to), a borne tax and the gross-up tunjangan on salary (6012,
-- 6026). What the last month gives back (PPH21_RETURN) is not an expense at
-- all: it reduces the PPh 21 owed, and the accrual debits `pph21_payable`
-- for it directly — `payroll_expense` may only name an expense account, and
-- the link guard says so.

INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_unit_kind, account_code, set_by, note)
SELECT role, 'PAY_COMPONENT', code, scope, kind, account, 'system', 'seeded by 0800'
  FROM (VALUES
    ('payroll_deduction', 'PPH21',        'ALL',       NULL,     '2011'),
    ('payroll_deduction', 'PPH21_CO',     'ALL',       NULL,     '2011'),
    ('payroll_deduction', 'BPJS_KES',     'ALL',       NULL,     '2021'),
    ('payroll_deduction', 'BPJS_JHT',     'ALL',       NULL,     '2021'),
    ('payroll_deduction', 'BPJS_JP',      'ALL',       NULL,     '2021'),
    ('payroll_deduction', 'BPJS_KES_CO',  'ALL',       NULL,     '2021'),
    ('payroll_deduction', 'BPJS_JHT_CO',  'ALL',       NULL,     '2021'),
    ('payroll_deduction', 'BPJS_JP_CO',   'ALL',       NULL,     '2021'),
    ('payroll_deduction', 'BPJS_JKK_CO',  'ALL',       NULL,     '2021'),
    ('payroll_deduction', 'BPJS_JKM_CO',  'ALL',       NULL,     '2021'),
    ('payroll_expense',   'BPJS_KES_CO',  'UNIT_KIND', 'STORE',  '6017'),
    ('payroll_expense',   'BPJS_KES_CO',  'UNIT_KIND', 'ONLINE', '6017'),
    ('payroll_expense',   'BPJS_KES_CO',  'UNIT_KIND', 'HO',     '6031'),
    ('payroll_expense',   'BPJS_JHT_CO',  'UNIT_KIND', 'STORE',  '6017'),
    ('payroll_expense',   'BPJS_JHT_CO',  'UNIT_KIND', 'ONLINE', '6017'),
    ('payroll_expense',   'BPJS_JHT_CO',  'UNIT_KIND', 'HO',     '6031'),
    ('payroll_expense',   'BPJS_JP_CO',   'UNIT_KIND', 'STORE',  '6017'),
    ('payroll_expense',   'BPJS_JP_CO',   'UNIT_KIND', 'ONLINE', '6017'),
    ('payroll_expense',   'BPJS_JP_CO',   'UNIT_KIND', 'HO',     '6031'),
    ('payroll_expense',   'BPJS_JKK_CO',  'UNIT_KIND', 'STORE',  '6017'),
    ('payroll_expense',   'BPJS_JKK_CO',  'UNIT_KIND', 'ONLINE', '6017'),
    ('payroll_expense',   'BPJS_JKK_CO',  'UNIT_KIND', 'HO',     '6031'),
    ('payroll_expense',   'BPJS_JKM_CO',  'UNIT_KIND', 'STORE',  '6017'),
    ('payroll_expense',   'BPJS_JKM_CO',  'UNIT_KIND', 'ONLINE', '6017'),
    ('payroll_expense',   'BPJS_JKM_CO',  'UNIT_KIND', 'HO',     '6031'),
    ('payroll_expense',   'PPH21_CO',     'UNIT_KIND', 'STORE',  '6012'),
    ('payroll_expense',   'PPH21_CO',     'UNIT_KIND', 'ONLINE', '6012'),
    ('payroll_expense',   'PPH21_CO',     'UNIT_KIND', 'HO',     '6026'),
    ('payroll_expense',   'TUNJ_PPH21',   'UNIT_KIND', 'STORE',  '6012'),
    ('payroll_expense',   'TUNJ_PPH21',   'UNIT_KIND', 'ONLINE', '6012'),
    ('payroll_expense',   'TUNJ_PPH21',   'UNIT_KIND', 'HO',     '6026')
  ) AS seed (role, code, scope, kind, account)
 WHERE EXISTS (SELECT 1 FROM ledger_account a WHERE a.account_code = seed.account);
