-- A node writes down what head office asked it to do, and what came of it.
--
-- A store page's Actions menu (remote actions, 28 Sep 2026) follows each
-- action until it finishes. The node's side of that is this table: a row is
-- written in the same transaction that applies the command, so an action the
-- node accepted is never lost to a restart between accepting it and carrying
-- it out — the runner (`edge/ops.rs`) picks unfinished rows up again when the
-- node starts, and a restart head office asked for is marked done by the
-- start it caused. The heartbeat carries the recent rows up
-- (`NodeStatus::action_results`), which is how head office learns the result.
--
-- `detail` is JSON: a backup's size, a sync's queue before and after, a
-- diagnosis's checks. Rows older than a week are deleted by the runner.
-- Creates only, so it runs on every open.

CREATE TABLE IF NOT EXISTS edge_node_action (
    action_id   TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    reason      TEXT,
    force       INTEGER NOT NULL DEFAULT 0 CHECK (force IN (0, 1)),
    received_at TEXT NOT NULL,
    started_at  TEXT,
    finished_at TEXT,
    state       TEXT NOT NULL DEFAULT 'QUEUED'
                CHECK (state IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
    sentence    TEXT,
    detail      TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS ix_edge_node_action_received
    ON edge_node_action (received_at);
