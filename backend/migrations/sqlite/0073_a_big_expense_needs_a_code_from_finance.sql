-- A shop records its own expense; a big one needs a code from Finance.
--
-- Owner, 2026-10-02: no second person signs a petty cash expense any more.
-- Whoever is signed in records it. Above a line Finance sets (default
-- Rp 500.000, the cloud's `store_expense.code_above_minor`), the shop types a
-- one-time code Finance issued at head office; the node checks and uses it up
-- at the centre before the row is written.
--
-- So `approved_by` / `approved_role` are now empty for an ordinary expense,
-- the "approver is not the claimant" CHECK goes, and the code is kept with the
-- row. SQLite cannot drop a CHECK, so the table is rebuilt. Applied only while
-- `store_expense.approval_code` is absent; see `edge::sqlite`.

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS petty_cash_policy (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    -- Above this (whole rupiah) an expense needs Finance's code. Learned from
    -- the centre whenever the shop is online; 500.000 until then.
    code_above_minor INTEGER NOT NULL CHECK (code_above_minor >= 0),
    learned_at TEXT
);
INSERT OR IGNORE INTO petty_cash_policy(singleton, code_above_minor) VALUES (1, 500000);

CREATE TABLE store_expense_rebuilt (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL CHECK (category IN (
        'expense_electricity','expense_water','expense_telephone',
        'expense_household','expense_stationery','expense_repairs',
        'expense_transport','expense_cleaning','expense_misc')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    payee TEXT NOT NULL CHECK (trim(payee) <> ''),
    reason TEXT NOT NULL CHECK (trim(reason) <> ''),
    claimed_by TEXT NOT NULL,
    -- Who issued the code (Finance), for an expense above the line; empty
    -- otherwise. Older rows keep the manager who signed for them.
    approved_by TEXT,
    approved_role TEXT CHECK (approved_role IS NULL
                              OR approved_role IN ('SUPERVISOR','ADMIN','FINANCE')),
    approval_code TEXT,
    spent_at TEXT NOT NULL
);

INSERT INTO store_expense_rebuilt(id,idempotency_key,category,amount_minor,payee,reason,
                                  claimed_by,approved_by,approved_role,spent_at)
SELECT id,idempotency_key,category,amount_minor,payee,reason,
       claimed_by,approved_by,approved_role,spent_at
  FROM store_expense;

DROP TABLE store_expense;
ALTER TABLE store_expense_rebuilt RENAME TO store_expense;

CREATE INDEX IF NOT EXISTS store_expense_when ON store_expense(spent_at);
CREATE INDEX IF NOT EXISTS store_expense_category
    ON store_expense(category, spent_at);

COMMIT;
