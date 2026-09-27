-- 0065: A node remembers how its last backup went, and when it lost the
-- internet but kept selling.
--
-- Two things the fleet status page asks of a node (owner's decision of
-- 28 Sep 2026) that it only ever wrote to its log:
--
-- * **The daily backup's result.** The newest backup file says when the last
--   one succeeded; nothing said that last night's attempt failed, so a disk
--   that refused every copy for a week looked like a node with a week-old
--   backup and no reason. `edge_backup_run` is the last attempt, one row.
--
-- * **An internet outage the shop sold through.** When head office goes
--   quiet, the Fleet page cannot tell a shop whose line is down from a shop
--   whose server is off. The server that stayed up knows: when head office
--   answers again after a silence, it writes the spell down here with how
--   many facts, and how many sales, it wrote meanwhile, and reports the last
--   day of them in its heartbeat. A server that was switched off says so
--   differently — its journal's `Started` — so this table is only ever the
--   internet.
--
-- Creates only, so it runs on every open.

CREATE TABLE IF NOT EXISTS edge_backup_run (
    singleton       INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_attempt_at TEXT NOT NULL,
    last_ok_at      TEXT,
    -- Set when the last attempt failed; cleared by the next success.
    last_error      TEXT,
    last_bytes      INTEGER CHECK (last_bytes IS NULL OR last_bytes >= 0)
);

CREATE TABLE IF NOT EXISTS edge_link_outage (
    from_at       TEXT NOT NULL PRIMARY KEY,
    to_at         TEXT NOT NULL,
    facts_written INTEGER NOT NULL DEFAULT 0 CHECK (facts_written >= 0),
    sales_written INTEGER NOT NULL DEFAULT 0 CHECK (sales_written >= 0),
    CHECK (to_at >= from_at)
);
