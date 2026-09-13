-- What a shop is allowed to spend, out of which pot, and on whose say-so.
--
-- ── The hole ────────────────────────────────────────────────────────────────
--
-- A shop pays the neighbourhood dues, buys a ream of paper, hands an ojek
-- forty thousand rupiah to take a parcel across town. Until now this node had
-- nowhere to put any of it. Its only money movements were `cash_movement` on a
-- shift, so the only way a shop could spend anything was a PAYOUT out of the
-- drawer — and a drawer that pays for light bulbs is a drawer whose variance is
-- unreadable, because every shortfall has an explanation available.
--
-- ── Three pots, one job each ────────────────────────────────────────────────
--
--   cash on hand    what the day took. Banked daily, NEVER spent. It is head
--                   office's money in this shop's keeping.
--   petty cash      an imprest float handed over by head office as cash. This
--                   is the ONLY pot a shop spends from, and only on small
--                   daily needs.
--   modal kasir     the cashier's opening float. Fixed, from head office, and
--                   never an expense route — it is `cash_shift.
--                   opening_float_minor` and it lives in 0024.
--
-- The drawer is deliberately absent from this file. There is no column here
-- that could point at a `cash_shift`, no `shift_id`, and nothing that nets an
-- expense off the day's takings. Spending the takings is possible only under a
-- head-office remittance order, which this node does not issue and cannot
-- record.
--
-- ── Approval by size, not by seniority alone ────────────────────────────────
--
-- Up to 500,000 rupiah the shop's own manager approves. Above it, head office
-- does. The limit is a constant in `src/edge/petty.rs` rather than a column,
-- because it is company policy and not a per-shop setting, and a settings table
-- nobody has a screen for is a number nobody can change anyway.
--
-- The approver is never the claimant, at any amount. That is the same
-- maker/checker rule a PAYOUT already keeps between the cashier and whoever
-- signs for it, and it is the one control that survives a manager being the
-- only person in the building.
--
-- ── What this file does not hold ────────────────────────────────────────────
--
-- No status column, and no approval workflow. An expense reaches this table
-- already approved: a shop keys it in with the supervisor standing there, the
-- same step-up a void takes, because the money has already left the tin by the
-- time anybody types. A DRAFT row on a till would be a claim nobody can chase
-- from a building the claimant is not in.
--
-- No journal entry either. The posting — Dr <the category's meaning> [site] /
-- Cr petty_cash [site] — is the centre's job and the centre has nowhere to
-- receive this yet. See `src/edge/petty.rs` for what travels and what does not.

-- The float, as head office hands it over.
--
-- One row per handover, never a running balance column. A balance stored beside
-- the movements that make it is a second source for one number, and the one
-- nobody looks at is the one that drifts — the same argument `cash_shift`
-- settled when the opening float became a movement rather than only a column.
CREATE TABLE IF NOT EXISTS petty_cash_top_up (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    -- Positive, always. Money going the other way is head office taking the
    -- float back, which is a handover document at the centre and not a
    -- negative top-up here.
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    -- Head office's own reference for the transfer, when the shop was given
    -- one. Free text: it is a slip number, a bank reference, or a date said
    -- out loud, and demanding a shape would mean the row not being written.
    reference TEXT,
    note TEXT,
    -- Who took the money, and who counted it with them. Both, because cash
    -- changing hands with one signature on it is cash nobody can be asked
    -- about.
    received_by TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS petty_cash_top_up_when
    ON petty_cash_top_up(received_at);

-- What the shop spent, one row per receipt.
CREATE TABLE IF NOT EXISTS store_expense (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    -- What kind of cost this is, said as a meaning rather than as an account
    -- code. The centre resolves it through `account_map` like every other
    -- posting rule; nothing at a till names a client account.
    --
    -- Constrained to nine, and they are the nine the centre's own
    -- `store_expense` constrains (its migration 0114). An unconstrained column
    -- would let a shop file its electricity under stock and the entry would
    -- still balance. Adding a tenth is a line here, a line there, and a
    -- considered decision about the client's chart — which is the right amount
    -- of friction for "which account does this land in".
    category TEXT NOT NULL CHECK (category IN (
        'expense_electricity','expense_water','expense_telephone',
        'expense_household','expense_stationery','expense_repairs',
        'expense_transport','expense_cleaning','expense_misc')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    -- Who was paid. Free text on purpose: the warung on the corner is never
    -- going to become a supplier record, and forcing one would mean either a
    -- fictional master row per receipt or the expense not being recorded.
    payee TEXT NOT NULL CHECK (trim(payee) <> ''),
    reason TEXT NOT NULL CHECK (trim(reason) <> ''),
    claimed_by TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    -- Which rung actually said yes, kept because the limit may move and an
    -- audit six months later asks who was allowed to approve this, then.
    approved_role TEXT NOT NULL CHECK (approved_role IN ('SUPERVISOR','ADMIN')),
    spent_at TEXT NOT NULL,
    -- The one control that survives a manager being alone in the building.
    -- In the schema and not only in Rust, so a row written by a repair script
    -- is refused the same way a row written by the handler is.
    --
    -- Written as a TABLE constraint, at the end, because it names two columns:
    -- SQLite stops accepting column definitions the moment the first table
    -- constraint appears, so this sitting between two columns was a syntax
    -- error that no `cargo build` could see — the node simply refused to open
    -- its database.
    CHECK (approved_by <> claimed_by)
);

-- The shop's own petty cash book, newest first, which is the only way this is
-- ever read.
CREATE INDEX IF NOT EXISTS store_expense_when ON store_expense(spent_at);
-- What went on each kind of cost over a span. Read by the position and by the
-- centre's reconciliation when it finally has somewhere to put this.
CREATE INDEX IF NOT EXISTS store_expense_category
    ON store_expense(category, spent_at);
