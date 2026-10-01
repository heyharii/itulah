-- 0813: the employee app shows the modules the company turns on.
--
-- Modul ESS, kept by the owner on 2026-09-30: which parts of the employee
-- app — attendance, leave, overtime, pay, claims, attendance corrections,
-- roster swaps — the company uses. A module turned off is not offered in the
-- app. One row, the company's; every module on until somebody says otherwise.

CREATE TABLE ess_setting (
    singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    modules     text[] NOT NULL DEFAULT ARRAY['ATTENDANCE', 'LEAVE', 'OVERTIME', 'PAY',
                                              'CLAIMS', 'CORRECTION', 'SWAP']
                CHECK (modules <@ ARRAY['ATTENDANCE', 'LEAVE', 'OVERTIME', 'PAY',
                                        'CLAIMS', 'CORRECTION', 'SWAP']),
    updated     jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ess_setting (singleton) VALUES (true);
