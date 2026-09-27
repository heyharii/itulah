-- 0466: a pay component says where it lands.
--
-- Stage 3 of "Desain Fondasi Finance Dinamis". Payroll used to guess a
-- component's account from words in its code — "LEMBUR" was overtime, "THR"
-- was drawn from the accrual, "PPH" was a tax the company bears, and a word it
-- did not know was salary. As ERPNext's Salary Component carries its accounts,
-- a component here is linked to its accounts (source PAY_COMPONENT), and the
-- two things the words used to decide are the component's own facts:
--
--   * `employer_borne`: a deduction the company pays on the employee's behalf
--     (PPh 21 under owner decision 25 Sep) — an expense of the company, not a
--     cut from the employee's net pay;
--   * `paid_from_accrual`: an earning paid out of what the monthly accrual has
--     already set aside (THR) rather than expensed again.
--
-- Roles: an earning debits `payroll_expense` from its component; a deduction
-- credits `payroll_deduction` from its component (2011 PPh 21, 2021 BPJS,
-- 1022 a loan instalment, …). Base pay, which is not a component, is the
-- company's `payroll_expense` / SALARY link; the THR accrual is the company's
-- `payroll_expense` / THR link against `thr_payable`, at the rate
-- `payroll.thr_accrual_months` (0 turns it off).

ALTER TABLE pay_component
    ADD COLUMN employer_borne    boolean NOT NULL DEFAULT false,
    ADD COLUMN paid_from_accrual boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT pay_component_employer_borne_is_a_deduction
        CHECK (NOT employer_borne OR kind = 'DEDUCTION'),
    ADD CONSTRAINT pay_component_accrual_is_an_earning
        CHECK (NOT paid_from_accrual OR kind = 'EARNING');

COMMENT ON COLUMN pay_component.employer_borne IS
    'A deduction the company bears (0466): posted Dr the component''s payroll_expense / Cr its payroll_deduction, and not taken from net pay.';
COMMENT ON COLUMN pay_component.paid_from_accrual IS
    'An earning paid from the monthly accrual (THR, 0466): posted Dr thr_payable rather than expensed again.';

-- The pay classes the word search produced are gone; base pay and the THR
-- accrual keep the company's links.
DELETE FROM account_link
 WHERE role = 'payroll_expense' AND source_type = 'COMPANY'
   AND source_id NOT IN ('SALARY', 'THR');

INSERT INTO posting_role (role, allowed_account_types, note)
VALUES ('payroll_deduction',
        ARRAY['TAX', 'ACCRUED_LIABILITY', 'PAYABLE', 'OTHER_LIABILITY', 'RECEIVABLE', 'PREPAID'],
        'where a deduction from pay is owed or recovered (0466)')
ON CONFLICT (role) DO NOTHING;

-- A setting key is now named for the module that reads it
-- (`payroll.thr_accrual_months`; `sales.`, `store_expense.`, `journal.` and
-- `sync.` keys follow in 0468–0474). 0373 allowed one bare word, which
-- refused the very insert below, so this migration could never apply. The
-- shape is kept — lowercase words of letters, digits and underscores — and
-- the words may now be joined by dots.
ALTER TABLE finance_setting
    DROP CONSTRAINT IF EXISTS finance_setting_setting_key_check,
    ADD CONSTRAINT finance_setting_setting_key_check
        CHECK (setting_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$');

INSERT INTO finance_setting (setting_key, value_numeric, unit, note, set_by)
VALUES ('payroll.thr_accrual_months', 12, 'months',
        'THR is accrued as base pay divided by this many months on every slip; 0 turns the accrual off.',
        'migration:0466')
ON CONFLICT (setting_key) DO NOTHING;
