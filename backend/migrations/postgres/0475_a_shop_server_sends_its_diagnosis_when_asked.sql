-- A shop server sends its diagnosis when head office asks (`node.diagnose`,
-- `sync/node_ops.rs`). The report is the one `store diagnose` writes on the
-- machine, secrets already removed there; kept here so a developer reads it
-- without anybody at the shop copying a file. Ten per node are plenty.
CREATE TABLE node_diagnostic (
    diagnostic_id uuid PRIMARY KEY,
    origin_id     text NOT NULL REFERENCES sync_origin_credential(origin_id) ON DELETE CASCADE,
    received_at   timestamptz NOT NULL DEFAULT now(),
    verdict       text NOT NULL CHECK (verdict IN ('OK', 'WARN', 'FAIL')),
    report        jsonb NOT NULL
);
CREATE INDEX ix_node_diagnostic_origin ON node_diagnostic (origin_id, received_at DESC);
