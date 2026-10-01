-- 0809: leave has blocked dates, can be paid out, and a holiday worked earns
-- a day back.
--
-- Four of Talenta's leave features the owner kept on 2026-09-30.
--
-- Blok tanggal cuti: head office closes dates to leave — the Lebaran rush,
-- stock-take week — for every unit or for one. A request whose days touch a
-- closed date is refused at filing; a block is lifted, never deleted.
--
-- Uangkan cuti: days paid out instead of taken, when the leave policy allows
-- it (`encashment.kind = ALLOWED`, up to `max_per_year`). One act, two
-- records written together: an ENCASHMENT on the leave ledger (0123 already
-- has the event) and an UANG_CUTI one-off on that month's payroll, so the
-- days leave the balance in the same transaction the money joins the pay.
--
-- Kerja di hari libur: somebody who works a public holiday or their rest day
-- earns a day of leave back (cuti pengganti) — a COMPENSATORY entry, recorded
-- with the day it was earned for, so the holiday-work report reads it back.
--
-- Cuti untuk pekerja roster needs no table: a person with a roster over the
-- span is charged only the days the roster schedules them to work.

CREATE TABLE leave_blackout (
    id          text PRIMARY KEY CHECK (btrim(id) <> ''),
    from_date   date NOT NULL,
    to_date     date NOT NULL,
    -- NULL: every unit.
    unit_id     text REFERENCES unit (id),
    reason      text NOT NULL CHECK (btrim(reason) <> ''),
    defined     jsonb NOT NULL,
    lifted_at   timestamptz,
    lifted      jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT leave_blackout_runs_forward CHECK (from_date <= to_date),
    CONSTRAINT leave_blackout_lift_is_signed CHECK ((lifted_at IS NULL) = (lifted IS NULL))
);

CREATE TABLE leave_encashment (
    id               text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id      text NOT NULL REFERENCES employee (id),
    leave_type       text NOT NULL REFERENCES leave_type (code),
    centidays        integer NOT NULL CHECK (centidays > 0),
    -- The month's wage the day was valued from, and the days it was divided by.
    wage_minor       bigint NOT NULL CHECK (wage_minor > 0),
    divisor_days     integer NOT NULL CHECK (divisor_days BETWEEN 1 AND 31),
    amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
    unit_id          text NOT NULL REFERENCES unit (id),
    period           date NOT NULL CHECK (extract(day from period) = 1),
    ledger_entry_id  text NOT NULL REFERENCES leave_ledger_entry (id),
    adjustment_id    text NOT NULL REFERENCES payroll_adjustment (id) ON DELETE CASCADE,
    encashed         jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE holiday_work (
    id               text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id      text NOT NULL REFERENCES employee (id),
    on_date          date NOT NULL,
    -- PUBLIC_HOLIDAY or REST_DAY: what kind of day it was.
    day_kind         text NOT NULL CHECK (day_kind IN ('PUBLIC_HOLIDAY', 'REST_DAY')),
    leave_type       text NOT NULL REFERENCES leave_type (code),
    centidays        integer NOT NULL CHECK (centidays > 0),
    ledger_entry_id  text NOT NULL REFERENCES leave_ledger_entry (id),
    recorded         jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (employee_id, on_date)
);

INSERT INTO pay_component (code, label, kind, basis, defined)
VALUES ('UANG_CUTI', 'Uang pengganti cuti', 'EARNING', 'PER_OCCASION',
        '{"actor": "system", "action_key": "people.pay_component.define", "at": "2026-10-01T00:00:00Z", "reason": "leave encashment component seeded by 0809"}')
ON CONFLICT (code) DO NOTHING;

INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_unit_kind, account_code, set_by, note)
SELECT 'payroll_expense', 'PAY_COMPONENT', 'UANG_CUTI', 'UNIT_KIND', kind, account, 'system',
       'seeded by 0809: paid-out leave is salary'
  FROM (VALUES ('STORE', '6012'), ('ONLINE', '6012'), ('HO', '6026')) AS seed (kind, account)
 WHERE EXISTS (SELECT 1 FROM ledger_account a WHERE a.account_code = seed.account)
ON CONFLICT DO NOTHING;
