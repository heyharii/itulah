-- A month can be shut to the tills before it is shut to the accountants.
--
-- # The gap
--
-- `fiscal_period` has had two states since 0051: OPEN takes anything, CLOSED
-- takes nothing. Every real close has a week in between — the shops have
-- stopped trading into the month, the accountant is still posting accruals, the
-- depreciation run has not gone yet — and with two states the only way to have
-- that week is to leave the month wide open and hope.
--
-- SOFT_CLOSED is that week, stated: the automatic writers are shut out, the
-- adjusting ones are not.
--
--   OPEN         anything may post
--   SOFT_CLOSED  only the kinds a close is made of: ADJUSTMENT, RECLASS,
--                WRITE_OFF, DEPRECIATION, AMORTIZATION_RUN, PREPAID_ALLOCATION,
--                TAX_SETTLEMENT, PAYROLL_RUN, REVERSAL, OPENING
--   CLOSED       nothing
--
-- A day's takings, a sale, a receipt, a deposit — the things a shop does — are
-- refused in SOFT_CLOSED with a message that says which state stopped them,
-- because "period is closed" on a month somebody deliberately half-closed is
-- the kind of error that gets a period reopened for no reason.
--
-- The list is here, in the trigger, and not in Rust: `poster::post` is not the
-- only INSERT into `journal_entry` from the database's point of view, and 0051
-- put this guard where nothing can go round it.

ALTER TABLE fiscal_period DROP CONSTRAINT IF EXISTS fiscal_period_status_check;
ALTER TABLE fiscal_period ADD CONSTRAINT fiscal_period_status_check
    CHECK (status IN ('OPEN', 'SOFT_CLOSED', 'CLOSED'));

-- `closed_at` still means CLOSED and nothing else. A soft close is reversible
-- and leaves no closing stamp: it is a gate, not an event.
ALTER TABLE fiscal_period DROP CONSTRAINT IF EXISTS fiscal_period_check;
ALTER TABLE fiscal_period ADD CONSTRAINT fiscal_period_closed_has_a_stamp
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL));

ALTER TABLE fiscal_period
    ADD COLUMN IF NOT EXISTS soft_closed_at timestamptz,
    ADD COLUMN IF NOT EXISTS soft_closed_by text;

CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger AS $$
DECLARE
    y      smallint := EXTRACT(YEAR FROM NEW.posting_date)::smallint;
    m      smallint := EXTRACT(MONTH FROM NEW.posting_date)::smallint;
    state  text;
    -- What a close is made of. Everything else is ordinary trading and belongs
    -- to a month that is still open.
    closing_kinds text[] := ARRAY[
        'ADJUSTMENT', 'RECLASS', 'WRITE_OFF', 'REVERSAL', 'DEPRECIATION',
        'AMORTIZATION_RUN', 'ASSET_RESERVE', 'PREPAID_ALLOCATION',
        'TAX_SETTLEMENT', 'PAYROLL_RUN', 'OPENING'
    ];
BEGIN
    SELECT status INTO state FROM fiscal_period
        WHERE year = y AND month = m FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'no accounting period exists for %-%; open it before posting',
            y, lpad(m::text, 2, '0');
    END IF;
    IF state = 'CLOSED' THEN
        RAISE EXCEPTION 'accounting period %-% is closed',
            y, lpad(m::text, 2, '0');
    END IF;
    IF state = 'SOFT_CLOSED' AND NOT (NEW.source_kind = ANY (closing_kinds)) THEN
        RAISE EXCEPTION
            'accounting period %-% is soft-closed: it still takes the entries a close is '
            'made of (adjustments, reclasses, depreciation, allocations, tax, payroll, '
            'reversals) and no longer takes a % — post it in the open month, or ask for '
            'the period to be reopened',
            y, lpad(m::text, 2, '0'), NEW.source_kind;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN fiscal_period.status IS
    'OPEN takes anything; SOFT_CLOSED takes only the entries a close is made of;
     CLOSED takes nothing. The list lives in assert_period_open().';
