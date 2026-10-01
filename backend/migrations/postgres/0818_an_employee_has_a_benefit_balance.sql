-- 0818: an employee has a benefit balance, spent at the till.
--
-- The owner's employee discount (1 Oct 2026): a rupiah balance per employee,
-- like a voucher. HR fills it, takes some off, or resets it to a figure — by
-- hand, no second approver, each act with a reason. Unused balance carries
-- over without limit. At the till the employee shows a short-lived code from
-- their own app (a fingerprint later; the code is only how they are found),
-- and the cashier spends part of the basket from the balance while the shop
-- is online; the rest is paid as usual. It is not combined with a promotion,
-- and a return gives the spent part back. Finance books what the balance paid
-- as a sales discount, not as a welfare expense, and it is not PPh 21 natura.
--
-- One ledger, append-only: every movement carries the balance after it, so
-- "what does she have" is the last row and "why" is the rows before it.

CREATE TABLE benefit_entry (
    id             text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id    text NOT NULL REFERENCES employee (id),
    kind           text NOT NULL CHECK (kind IN ('ADD', 'REMOVE', 'RESET', 'SPEND', 'RETURN')),
    -- Signed: what this movement did to the balance. A reset to the figure
    -- already there moves nothing and is still recorded.
    delta_minor    bigint NOT NULL,
    balance_after  bigint NOT NULL CHECK (balance_after >= 0),
    reason         text NOT NULL CHECK (btrim(reason) <> ''),
    -- The till's side: where and against which sale it was spent or returned.
    unit_id        text REFERENCES unit (id),
    sale_ref       text,
    by_actor       jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT benefit_entry_moves_unless_reset CHECK (kind = 'RESET' OR delta_minor <> 0),
    CONSTRAINT benefit_entry_direction CHECK (
        (kind IN ('ADD', 'RETURN') AND delta_minor > 0)
        OR (kind IN ('REMOVE', 'SPEND') AND delta_minor < 0)
        OR kind = 'RESET'),
    CONSTRAINT benefit_entry_till_names_its_sale CHECK (
        (kind IN ('SPEND', 'RETURN')) = (sale_ref IS NOT NULL AND unit_id IS NOT NULL))
);

CREATE INDEX ix_benefit_entry_employee ON benefit_entry (employee_id, created_at DESC);
-- One spend per sale: a retried till call cannot take the balance twice.
CREATE UNIQUE INDEX ux_benefit_entry_one_spend_per_sale
    ON benefit_entry (sale_ref) WHERE kind = 'SPEND';

-- The code the employee shows at the till: random, short-lived, used once.
CREATE TABLE benefit_code (
    code         text PRIMARY KEY CHECK (code ~ '^[0-9]{6}$'),
    employee_id  text NOT NULL REFERENCES employee (id),
    expires_at   timestamptz NOT NULL,
    used_at      timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_benefit_code_employee ON benefit_code (employee_id, created_at DESC);

-- Head office's settings, as dated versions like every other HR setting.
CREATE TABLE benefit_setting (
    effective_from  date PRIMARY KEY,
    enabled         boolean NOT NULL,
    -- How long a code from the app stays good at the till.
    code_minutes    integer NOT NULL CHECK (code_minutes BETWEEN 1 AND 60),
    set_by          jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
