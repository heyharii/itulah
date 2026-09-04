-- The till's day: a shift that opens and closes, a sale that can be undone,
-- and a receipt the customer walks out with.
--
-- Until now `sale.status` was `CHECK (status = 'COMPLETED')`. A sale in this
-- shop could not be anything else — not voided, not returned against — so the
-- two things a counter does most after taking money were shut at the schema.
-- SQLite cannot alter a CHECK, so the table is rebuilt; the rows are copied
-- unchanged and every one of them keeps the status it already had.

-- ── The drawer ──────────────────────────────────────────────────────────────
--
-- A shift is what makes a till auditable. Without one there is no answer to
-- "how much should be in this drawer right now", and every cash difference is
-- discovered as a mystery weeks later instead of at the counter that evening.

CREATE TABLE IF NOT EXISTS cash_shift (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    -- One terminal, one drawer. Two shifts open on the same till would each
    -- believe the other's cash was theirs.
    terminal_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED')),
    opened_by TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    opening_float_minor INTEGER NOT NULL CHECK (opening_float_minor >= 0),
    closed_by TEXT,
    closed_at TEXT,
    -- What the cashier counted, before being shown what was expected.
    --
    -- Blind on purpose: a cashier who can see the expected figure counts
    -- toward it. The variance is computed at close and stored beside the
    -- declaration, so the two numbers can never be reconciled after the fact
    -- into agreeing.
    declared_cash_minor INTEGER CHECK (declared_cash_minor >= 0),
    expected_cash_minor INTEGER,
    variance_minor INTEGER,
    close_note TEXT,
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

-- At most one open shift per terminal, enforced by the database rather than by
-- whoever remembers to check.
CREATE UNIQUE INDEX IF NOT EXISTS cash_shift_one_open_per_terminal
    ON cash_shift(terminal_id) WHERE status = 'OPEN';

-- Cash that moved for a reason other than a sale: the opening float, a safe
-- drop, a payout, a correction. Signed, so the expected drawer is one SUM.
CREATE TABLE IF NOT EXISTS cash_movement (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    shift_id TEXT NOT NULL REFERENCES cash_shift(id),
    kind TEXT NOT NULL CHECK (kind IN ('OPENING_FLOAT','DROP','PAYOUT','PICKUP','CORRECTION')),
    -- Signed: money into the drawer is positive, out is negative. A magnitude
    -- plus a direction column is the same number written twice, and the two
    -- disagree the first time somebody writes a negative payout.
    amount_minor INTEGER NOT NULL,
    reason TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    -- A payout needs a second pair of eyes; a safe drop does not.
    approved_by TEXT,
    occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS cash_movement_shift ON cash_movement(shift_id, occurred_at);

CREATE TABLE sale_rebuilt (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    -- VOIDED is the whole point of this migration. A void is not a delete:
    -- the row stays, the goods come back on a movement of their own, and the
    -- Z report still counts the sale that was rung.
    status TEXT NOT NULL CHECK (status IN ('COMPLETED','VOIDED')),
    total_minor INTEGER NOT NULL CHECK (total_minor > 0),
    paid_minor INTEGER NOT NULL CHECK (paid_minor >= total_minor),
    change_minor INTEGER NOT NULL CHECK (change_minor >= 0),
    movement_group_id TEXT NOT NULL REFERENCES movement_group(id),
    actor_id TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    pricing_trace_id TEXT,
    -- Which shift took this money. Nullable because sales predate shifts and
    -- backfilling one would be inventing a fact; a till that has opened a
    -- shift stamps every sale from then on.
    shift_id TEXT REFERENCES cash_shift(id),
    voided_at TEXT,
    voided_by TEXT,
    void_reason TEXT,
    -- The supervisor who authorised it. A void nobody signed is a void nobody
    -- can be asked about.
    void_approved_by TEXT,
    CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL))
);

INSERT INTO sale_rebuilt(
    id, idempotency_key, status, total_minor, paid_minor, change_minor,
    movement_group_id, actor_id, completed_at, pricing_trace_id
)
SELECT id, idempotency_key, status, total_minor, paid_minor, change_minor,
       movement_group_id, actor_id, completed_at, pricing_trace_id
FROM sale;

DROP TABLE sale;
ALTER TABLE sale_rebuilt RENAME TO sale;

CREATE INDEX IF NOT EXISTS sale_completed_at ON sale(completed_at);
CREATE INDEX IF NOT EXISTS sale_shift ON sale(shift_id, completed_at);

-- ── Taking it back ──────────────────────────────────────────────────────────
--
-- A return is a reversal, never an edit. The original sale keeps its total and
-- its lines; what changed is that some of the goods came back and some of the
-- money went out. Both facts are written here, and the movement lane carries
-- the garments home on `CUSTOMER_RETURN`.

CREATE TABLE IF NOT EXISTS sale_return (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    sale_id TEXT NOT NULL REFERENCES sale(id),
    -- What the shop paid back, and how. A refund tendered differently from the
    -- sale is ordinary — a card sale refunded in cash happens every day — so
    -- the method is recorded rather than assumed from the original.
    refund_minor INTEGER NOT NULL CHECK (refund_minor >= 0),
    refund_method TEXT NOT NULL CHECK (refund_method IN ('CASH','CARD','QRIS','OTHER')),
    refund_reference TEXT,
    reason TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    shift_id TEXT REFERENCES cash_shift(id),
    movement_group_id TEXT NOT NULL REFERENCES movement_group(id),
    occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sale_return_sale ON sale_return(sale_id);
CREATE INDEX IF NOT EXISTS sale_return_time ON sale_return(occurred_at);

CREATE TABLE IF NOT EXISTS sale_return_line (
    return_id TEXT NOT NULL REFERENCES sale_return(id),
    sale_id TEXT NOT NULL REFERENCES sale(id),
    subject_id TEXT NOT NULL REFERENCES inventory_subject(id),
    epc TEXT NOT NULL,
    sku_code TEXT NOT NULL,
    -- What this unit was actually charged on the day, not today's price. A
    -- return refunded at the current price is how a clearance turns into free
    -- money for whoever noticed.
    refund_minor INTEGER NOT NULL CHECK (refund_minor >= 0),
    -- Where the garment goes back to. Saleable returns to the floor; anything
    -- else must not be sold again by accident.
    disposition TEXT NOT NULL CHECK (disposition IN ('RESALEABLE','DAMAGED')),
    PRIMARY KEY (return_id, subject_id)
);

-- One unit cannot be returned twice. The line above is keyed by return, so
-- without this a second return of the same garment is two refunds for one
-- shirt and the shop has bought it back at retail twice.
CREATE UNIQUE INDEX IF NOT EXISTS sale_return_line_once_per_unit
    ON sale_return_line(sale_id, subject_id);

-- ── What the line would have cost ───────────────────────────────────────────
--
-- The engine computes it, the fact carries it to the centre, and the shop's
-- own copy threw it away. So the receipt could say what was charged and never
-- what the markdown was worth — and "why is this cheaper than the tag" is a
-- question asked at the counter, with the customer still standing there.
--
-- Nullable: a shop with no price book was never quoted a list price, and
-- backfilling one would be inventing a number.
ALTER TABLE sale_line ADD COLUMN base_unit_price_minor INTEGER;
