-- 0802: a salary structure is a named set of fixed allowances.
--
-- Talenta's "Payroll component" settings and ERPNext's Salary Structure are
-- one idea: the standing shape of somebody's pay — a base and the fixed
-- allowances that ride on it (tunjangan jabatan, makan, transport) — named
-- once and applied to many people. The owner put it in scope on 2026-09-30.
--
-- `pay_structure` (0359) is not reused: it names component codes with no
-- amounts, was seeded as read-only guidance and dropped with the grade
-- masters, and a structure that cannot say what an allowance is worth cannot
-- fill anybody's agreement. It stays as it was.
--
-- A structure is a template, not a link: applying one copies its base and
-- allowances into the employee's own dated pay agreement (0105), so changing
-- the structure later never rewrites what somebody was agreed.

CREATE TABLE salary_structure (
    code        text PRIMARY KEY CHECK (btrim(code) <> '' AND code = upper(code)),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    -- A suggested base, or NULL when the structure only carries allowances.
    base_minor  bigint CHECK (base_minor > 0),
    -- [{"code": "JABATAN", "minor": 500000}, …] — the same shape as
    -- employee_pay.fixed_allowances.
    allowances  jsonb NOT NULL DEFAULT '[]'::jsonb
                CHECK (jsonb_typeof(allowances) = 'array'),
    defined     jsonb NOT NULL,
    retired_at  timestamptz,
    retired     jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT salary_structure_retirement_is_signed
        CHECK ((retired_at IS NULL) = (retired IS NULL))
);

COMMENT ON TABLE salary_structure IS
    'A named base and set of fixed allowances (0802), applied to a pay agreement by copying — never linked, so a later change rewrites nobody''s agreement.';
