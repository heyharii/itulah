-- A device is enrolled to a node, and head office sees it.
--
-- The owner's model (2026-09-27, CONTEXT.md "The fleet"): a **device** is a
-- machine enrolled to a node — a till, a handheld, a network RFID reader, a
-- network printer, an EDC, an attendance terminal — and it inherits its site
-- and unit from that node. Until now head office knew some of them and not
-- others: RFID readers in `rfid_device`, EDCs in `edc_terminal` (as a bank's
-- terminal, not as a machine at a counter), attendance terminals in
-- `attendance_terminal`, and tills and printers not at all — a till lived in
-- one shop's SQLite and a printer was an address typed into each request.
--
-- `device` is the one list. It is fed by the nodes: every heartbeat carries
-- the node's devices (`sync/device.rs::DeviceReport`), and
-- `cloud/postgres/devices.rs` files them here. It holds no secret. Where a
-- kind already has a table that holds its credential or its authority, that
-- table stays and is linked by id rather than merged in:
--
--   TILL                 the key digest stays in the shop's `edge_terminal`
--   PRINTER              no secret; host and port are in `config`
--   RFID_READER/HANDHELD `rfid_device` keeps its key and its lease; linked
--   ATTENDANCE_TERMINAL  `attendance_terminal` keeps its authority; linked by
--                        id only, with no foreign key, because that table's
--                        place column is being moved in parallel
--   EDC                  `edc_terminal` (a finance table) keeps the bank;
--                        the terminal id is carried in `config`
--
-- **Whose word is the status.** For a till and a printer the node is the
-- authority — it is where a signature is checked and a print is sent — so
-- `status` is what the node last reported. Head office asking for a change
-- is `requested_*` until the node's next heartbeat says it happened; the
-- request travels as a signed `device.status.set.v1` command.
--
-- `site_id` is the node's site at the time of the report, copied from
-- `sync_origin_credential` rather than taken from anything the node says.
-- It is stored, not joined, because the hub asks "what is at this shop" and a
-- device list that moved when a node was re-enrolled elsewhere would be
-- answering a different question.

CREATE TABLE device (
    device_id          text PRIMARY KEY CHECK (btrim(device_id) <> '' AND length(device_id) <= 128),
    kind               text NOT NULL CHECK (kind IN (
                           'TILL', 'HANDHELD', 'RFID_READER', 'PRINTER', 'EDC', 'ATTENDANCE_TERMINAL'
                       )),
    origin_id          text NOT NULL REFERENCES sync_origin_credential (origin_id) ON DELETE CASCADE,
    site_id            text NOT NULL REFERENCES site (id),
    label              text NOT NULL CHECK (btrim(label) <> ''),
    status             text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    -- What head office asked for and the node has not yet confirmed.
    requested_status   text CHECK (requested_status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    requested_by       text,
    requested_at       timestamptz,
    requested_reason   text,
    requested_command_id uuid,
    -- When the node last heard from the device: a till's last signed request,
    -- a printer's last print by id, a reader's last batch.
    last_seen_at       timestamptz,
    -- Kind-specific and never secret: a printer's host and port, a till's
    -- peripherals and machine, a reader's pools, an EDC's acquirer and
    -- terminal id.
    config             jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- The device this one took over from. Not a foreign key: a node may report
    -- a replacement before head office ever heard of the machine it replaced.
    replaces_device_id text,
    rfid_device_id     text REFERENCES rfid_device (device_id) ON DELETE SET NULL,
    attendance_terminal_id text,
    registered_at      timestamptz,
    registered_by      text,
    first_reported_at  timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT device_request_is_whole CHECK (
        (requested_status IS NULL) = (requested_at IS NULL)
        AND (requested_status IS NULL) = (requested_by IS NULL)
    )
);

CREATE INDEX ix_device_site ON device (site_id, kind, status);
CREATE INDEX ix_device_origin ON device (origin_id);

-- How each device got to where it is, oldest first.
--
-- `NODE` rows are status changes a node reported — the till joined, a
-- supervisor suspended it at nine in the evening, it was replaced. `HUB` rows
-- are what head office asked for, and by whom, whether or not the node has
-- carried it out yet. The same history `attendance_terminal.history` keeps,
-- as rows so it can be read without folding a JSON array.
--
-- Never updated. A row goes only with its device (and a device only with its
-- node's registration), which is why the trigger refuses UPDATE and not
-- DELETE.
CREATE TABLE device_status_event (
    id          bigserial PRIMARY KEY,
    device_id   text NOT NULL REFERENCES device (device_id) ON DELETE CASCADE,
    source      text NOT NULL CHECK (source IN ('NODE', 'HUB')),
    from_status text CHECK (from_status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    to_status   text NOT NULL CHECK (to_status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    actor       text NOT NULL,
    reason      text,
    at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_device_status_event_device ON device_status_event (device_id, at);

CREATE OR REPLACE FUNCTION device_status_event_is_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'a device''s history is append-only; add an event saying what changed rather than editing what was written';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_status_event_append_only
    BEFORE UPDATE ON device_status_event
    FOR EACH ROW EXECUTE FUNCTION device_status_event_is_append_only();

COMMENT ON TABLE device IS
    'Every machine enrolled to a node, as the nodes report it in their heartbeats. No secrets: credentials stay in edge_terminal (at the shop), rfid_device and attendance_terminal.';
COMMENT ON COLUMN device.status IS
    'What the node last reported. requested_status is head office''s pending ask, cleared when a report agrees with it.';
