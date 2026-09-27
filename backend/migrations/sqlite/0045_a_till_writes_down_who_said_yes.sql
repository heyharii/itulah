-- 0045: A till writes down who said yes, and what the drawer was counted in.
--
-- # The approvals nobody could find
--
-- A supervisor's PIN already opened a one-shot grant (`edge_supervisor_grant`),
-- and a void, a return or a payout spent it on the row it authorised. The two
-- things a counter asks a supervisor for most — taking a garment back off the
-- basket, and abandoning a basket — had no row to spend it on: the unsold
-- basket is the terminal's, so the grant was issued, the item disappeared, and
-- the grant expired unspent. "Who let that shirt come off the bill?" had an
-- answer in nobody's database.
--
-- `till_approval` is that row. The grant is spent on it inside the same
-- transaction, so an approval exists here exactly when a supervisor's
-- credential was checked by this node and used once, for this.
--
-- # The count behind the declared figure
--
-- A blind close sends one number. The sheet it was added up from — five
-- hundred-thousands, three fifties — is what an audit asks for the next
-- morning, and it was being lost at the counter. `cash_shift_count` keeps it,
-- one row per denomination, and the close refuses a sheet that does not add up
-- to the figure declared beside it.
--
-- Both are `IF NOT EXISTS`, create rather than change, and run on every open.

CREATE TABLE IF NOT EXISTS till_approval (
    id              TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    action          TEXT NOT NULL
                    CHECK (action IN ('EDIT_CART', 'CANCEL_BASKET', 'DROP_HOLD')),
    terminal_id     TEXT NOT NULL,
    actor_id        TEXT NOT NULL,
    approved_by     TEXT NOT NULL,
    detail          TEXT NOT NULL,
    reason          TEXT,
    epcs_json       TEXT NOT NULL DEFAULT '[]',
    amount_minor    INTEGER,
    recorded_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_till_approval_recorded
    ON till_approval (recorded_at);

CREATE TABLE IF NOT EXISTS cash_shift_count (
    shift_id    TEXT NOT NULL REFERENCES cash_shift(id) ON DELETE CASCADE,
    value_minor INTEGER NOT NULL CHECK (value_minor > 0),
    pieces      INTEGER NOT NULL CHECK (pieces >= 0),
    PRIMARY KEY (shift_id, value_minor)
);
