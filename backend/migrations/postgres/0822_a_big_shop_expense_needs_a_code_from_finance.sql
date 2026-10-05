-- 0822: a big shop expense needs a one-time code from Finance.
--
-- Owner, 2026-10-02: a shop records a petty cash expense on its own; nobody
-- else signs. Above a line (a Finance setting, Rp 500.000 to start) the shop
-- types a code Finance issued at head office for that shop, up to an amount,
-- good until a time. The shop's node checks it here and uses it up: right
-- shop, not used, not cancelled, not expired, amount within the ceiling.

INSERT INTO finance_setting (setting_key, value_numeric, unit, note, set_by) VALUES
    ('store_expense.code_above_minor', 500000, 'IDR',
     'A shop expense above this needs a one-time approval code from Finance.',
     'migration:0822')
ON CONFLICT (setting_key) DO NOTHING;

CREATE TABLE store_expense_code (
    id                uuid PRIMARY KEY,
    -- Six digits a cashier can key in. Unique only while live (below).
    code              text NOT NULL CHECK (code ~ '^[0-9]{6}$'),
    unit_id           text NOT NULL REFERENCES unit (id),
    ceiling_minor     bigint NOT NULL CHECK (ceiling_minor > 0),
    expires_at        timestamptz NOT NULL,
    note              text,
    issued_by         text NOT NULL CHECK (btrim(issued_by) <> ''),
    issued_at         timestamptz NOT NULL DEFAULT now(),
    cancelled_at      timestamptz,
    cancelled_by      text,
    -- Filled together when the shop uses it.
    used_at           timestamptz,
    used_amount_minor bigint,
    used_by           text,
    -- The shop's expense idempotency key: a retry of the same expense is
    -- answered as already used by it, not refused.
    used_for          text,
    CONSTRAINT store_expense_code_use_is_whole CHECK (
        (used_at IS NULL) = (used_for IS NULL)
        AND (used_at IS NULL) = (used_amount_minor IS NULL)),
    CONSTRAINT store_expense_code_use_within_ceiling CHECK (
        used_amount_minor IS NULL OR used_amount_minor <= ceiling_minor)
);

-- One live code with these digits at a time.
CREATE UNIQUE INDEX ux_store_expense_code_live
    ON store_expense_code (code) WHERE used_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX ix_store_expense_code_unit
    ON store_expense_code (unit_id, issued_at DESC);
