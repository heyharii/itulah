-- 0087: A node knows what head office stopped on its POS.
--
-- Head office stops a whole store or one person on the POS, and removes a
-- store that closed for good (postgres 0990; the client's review of 23 Oct
-- 2026). The node hears it in its auth policy (`pos_stops`) and keeps the
-- latest word here, replaced whole by every policy that carries it
-- (`edge::pos_stop::replace`). A till is not here: it is a device, and its
-- stop is `edge_terminal.status` (SUSPENDED, REVOKED).
--
-- Stopped means no selling and no new shift (`edge::till`); a drawer already
-- open can still be counted and closed. A sale rung before the stop — waiting
-- in a till's outbox while the line was down — still lands: the stop is
-- compared with when the sale happened, so `stopped_at` is head office's own
-- time of the decision.
--
-- Creates only.

CREATE TABLE IF NOT EXISTS edge_pos_stop (
    -- `STORE`: this node's store, with `subject` empty. `PERSON`: one person,
    -- `subject` their user id (`edge_user.id`).
    scope TEXT NOT NULL CHECK (scope IN ('STORE', 'PERSON')),
    subject TEXT NOT NULL,
    stopped_at TEXT NOT NULL,
    stopped_by TEXT NOT NULL,
    -- Shown on the till. Empty only for a store head office closed without
    -- stopping it first.
    reason TEXT NOT NULL,
    -- A store only: when head office removed it for good.
    removed_at TEXT,
    policy_version INTEGER NOT NULL,
    PRIMARY KEY (scope, subject),
    CHECK ((scope = 'STORE') = (subject = '')),
    CHECK (scope = 'STORE' OR removed_at IS NULL)
);
