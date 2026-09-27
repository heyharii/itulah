-- A till knows its status, its peripherals, and how it joined.
--
-- `edge_terminal` (0039) had one switch, `active`, and nothing else about the
-- machine. The device registry (`sync/device.rs`) needs three more things from
-- it, and each is a column here:
--
-- * **status** — ACTIVE, SUSPENDED or REVOKED, the registry's words. `active`
--   stays and stays authoritative for signing (`verify_terminal` reads it), and
--   every write keeps the two in step: active = 1 exactly when ACTIVE. REVOKED
--   is terminal; a replaced or stolen till is never switched back on.
-- * **how it joined** — the join request that created it, the till it
--   replaced, and what the machine said about itself. A replacement keeps the
--   old row, revoked, so "which machine was Kasir 2 in March" has an answer.
-- * **peripherals** — the customer display, the USB desk reader, the drawer,
--   the scanner, the USB printer. Not devices of their own (CONTEXT.md,
--   "Peripheral"): configuration of this one till, reported by the till itself
--   and carried to head office in the registry's `config`.
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so this file is applied once,
-- guarded in `edge/sqlite.rs` by the presence of `status`, and inside one
-- transaction so a run that dies half way leaves nothing half-added.

BEGIN;

ALTER TABLE edge_terminal ADD COLUMN kind TEXT NOT NULL DEFAULT 'TILL';
ALTER TABLE edge_terminal ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED'));
ALTER TABLE edge_terminal ADD COLUMN status_changed_at TEXT;
ALTER TABLE edge_terminal ADD COLUMN status_changed_by TEXT;
ALTER TABLE edge_terminal ADD COLUMN status_reason TEXT;
ALTER TABLE edge_terminal ADD COLUMN join_id TEXT;
ALTER TABLE edge_terminal ADD COLUMN replaces_terminal_id TEXT;
ALTER TABLE edge_terminal ADD COLUMN machine_json TEXT;
ALTER TABLE edge_terminal ADD COLUMN peripherals_json TEXT NOT NULL DEFAULT '{}';

-- A till switched off before this existed was switched off, not destroyed:
-- SUSPENDED, which can be undone, rather than a guess at REVOKED.
UPDATE edge_terminal SET status = 'SUSPENDED' WHERE active = 0;

COMMIT;
