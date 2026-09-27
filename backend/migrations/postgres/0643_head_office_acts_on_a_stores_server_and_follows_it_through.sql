-- Head office acts on a store's server and its devices, and follows each
-- action through (owner's decision of 28 Sep 2026).
--
-- A store's page has one Actions menu: restart the server, send the initial
-- data again, back up now, diagnose, sync now, and a till's or a printer's
-- test page, suspension, reactivation or revocation. Each was already a
-- command on the signed lane (`sync/node_ops.rs`, `sync/device.rs`); what did
-- not exist is the record a person follows — who asked, when, where it got
-- to, and what came of it. That is this table: one row per action.
--
-- # State
--
--   QUEUED   recorded; its command waits for the node to fetch it
--   SENT     the node fetched the command (`commands_for`)
--   RUNNING  the node applied it and is carrying it out
--   DONE     finished, with `result_sentence` and `detail`
--   FAILED   refused or failed, with why
--   EXPIRED  the node never picked it up within `expires_at`, or came back
--            after it and skipped it
--
-- The lane moves QUEUED → SENT → RUNNING (`sync_command_cursor.acked_seq`
-- passing `command_seq`); the node's report in its heartbeat
-- (`NodeStatus::action_results`) moves RUNNING → DONE or FAILED. An action
-- with no report to wait for — a device decision — is DONE when applied.
--
-- `command_seq` is the tracked command's place in the node's stream. For
-- initial data sent again it is the marker behind the whole run, so the node
-- having applied it means the node applied everything ahead of it.
--
-- # The expiry is a setting
--
-- `fleet_setting.action_expiry_minutes` (0637's row), 30 by default: an
-- instruction that reaches a server which was off all afternoon is not the
-- instruction anybody gave.

CREATE TABLE store_action (
    action_id       uuid PRIMARY KEY,
    unit_id         text NOT NULL REFERENCES unit (id),
    site_id         text NOT NULL REFERENCES site (id),
    origin_id       text NOT NULL REFERENCES sync_origin_credential (origin_id) ON DELETE CASCADE,
    action_key      text NOT NULL CHECK (action_key IN (
                        'restart_server', 'resend_initial_data', 'back_up_now', 'diagnose',
                        'sync_now', 'test_print', 'suspend_device', 'reactivate_device',
                        'revoke_device'
                    )),
    target          text NOT NULL CHECK (target IN ('server', 'device')),
    device_id       text,
    note            text CHECK (note IS NULL OR length(note) <= 300),
    requested_by    text NOT NULL CHECK (btrim(requested_by) <> ''),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    -- The tracked command and its place in the node's stream. NULL only
    -- while initial data is still being issued.
    command_id      uuid REFERENCES sync_command (command_id),
    command_seq     bigint,
    -- A test page's ask (`device.test_print_request_id`, 0632).
    request_id      uuid,
    -- Whether the node reports a result of its own (an operation carrying
    -- this action's id); otherwise applying the command finishes it.
    reported        boolean NOT NULL DEFAULT false,
    state           text NOT NULL DEFAULT 'QUEUED'
                    CHECK (state IN ('QUEUED', 'SENT', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED')),
    sent_at         timestamptz,
    acked_at        timestamptz,
    started_at      timestamptz,
    finished_at     timestamptz,
    result_sentence text,
    detail          jsonb NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT store_action_device_is_named CHECK ((target = 'device') = (device_id IS NOT NULL)),
    CONSTRAINT store_action_finish_is_stamped CHECK (
        (state IN ('DONE', 'FAILED', 'EXPIRED')) = (finished_at IS NOT NULL)
    )
);

CREATE INDEX ix_store_action_unit ON store_action (unit_id, requested_at DESC);
-- What the lane and the heartbeat look up: a node's actions still moving.
CREATE INDEX ix_store_action_open ON store_action (origin_id, command_seq)
    WHERE state IN ('QUEUED', 'SENT', 'RUNNING');

COMMENT ON TABLE store_action IS
    'Head office acting on a store''s server or one of its devices from the store''s Actions menu (0643): who asked, the command that carries it, and where it got to — QUEUED, SENT, RUNNING, then DONE, FAILED or EXPIRED — with the node''s own sentence and numbers.';

ALTER TABLE fleet_setting
    ADD COLUMN action_expiry_minutes integer NOT NULL DEFAULT 30
        CHECK (action_expiry_minutes BETWEEN 5 AND 1440);

COMMENT ON COLUMN fleet_setting.action_expiry_minutes IS
    'How long a store action waits for its server to pick it up before it expires (0643). 30 minutes.';
