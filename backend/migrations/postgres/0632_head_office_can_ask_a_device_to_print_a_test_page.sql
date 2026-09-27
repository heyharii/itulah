-- Head office can ask a device to print a test page, and sees how it went.
--
-- Before a store opens, head office wants to know the paper comes out: the
-- receipt printer on each till, and any network printer the store's node has
-- recorded (`store-opening-flow.html`, steps 4.3 and 6.1). The person at the
-- shop can press "test print" on the till; head office can now ask for the
-- same from the hub.
--
-- The ask travels as a signed command to the device's node,
-- `device.test_print.v1` (`sync::device`), and only to a node whose heartbeat
-- says it takes one — an older build blocks its whole command stream on a type
-- it does not know. A network printer is printed to by its node; a till's
-- request waits at the node until the till asks for its work, prints on the
-- printer it was set up with, and reports back. The node carries the outcome
-- in the heartbeat's device list, which is where the result lands here:
--
--   last_test_print_at / _ok / _error   the newest test page any device
--                                       printed, however it was asked for —
--                                       the till's own "test print" button
--                                       reports the same way;
--   test_print_requested_*               head office's ask still in flight,
--                                       cleared when a result newer than it
--                                       arrives. The request id is the
--                                       command's.
--
-- The register view (0624) gains the six columns at its end, so every reader
-- of it keeps reading what it read. A terminal head office registers itself
-- (a punch station, an EDC) prints nothing and carries NULLs.

ALTER TABLE device
    ADD COLUMN last_test_print_at      timestamptz,
    ADD COLUMN last_test_print_ok      boolean,
    ADD COLUMN last_test_print_error   text,
    ADD COLUMN test_print_requested_at timestamptz,
    ADD COLUMN test_print_requested_by text,
    ADD COLUMN test_print_request_id   uuid,
    ADD CONSTRAINT device_test_print_is_whole
        CHECK ((last_test_print_at IS NULL) = (last_test_print_ok IS NULL)),
    ADD CONSTRAINT device_test_print_request_is_whole
        CHECK ((test_print_requested_at IS NULL) = (test_print_request_id IS NULL)
               AND (test_print_requested_at IS NULL) = (test_print_requested_by IS NULL));

COMMENT ON COLUMN device.last_test_print_at IS
    'When this device last printed a test page, as its node reported it (0632). With last_test_print_ok and, on a failure, last_test_print_error.';
COMMENT ON COLUMN device.test_print_request_id IS
    'Head office''s test-print ask still in flight: the device.test_print.v1 command''s id (0632). Cleared when the node reports a test print at or after test_print_requested_at.';

CREATE OR REPLACE VIEW device_register AS
SELECT d.device_id,
       d.kind,
       d.origin_id,
       d.site_id,
       d.label,
       d.status,
       d.requested_status,
       d.requested_by,
       d.requested_at,
       d.requested_reason,
       d.last_seen_at,
       d.config,
       d.replaces_device_id,
       d.rfid_device_id,
       d.attendance_terminal_id,
       d.registered_at,
       d.registered_by,
       d.first_reported_at,
       d.updated_at,
       'NODE'::text AS source,
       d.last_test_print_at,
       d.last_test_print_ok,
       d.last_test_print_error,
       d.test_print_requested_at,
       d.test_print_requested_by,
       d.test_print_request_id
  FROM device d
UNION ALL
SELECT 'attendance:' || t.id,
       'ATTENDANCE_TERMINAL',
       n.origin_id,
       t.site_id,
       t.name,
       t.status,
       NULL,
       NULL,
       NULL,
       NULL,
       GREATEST(t.synced_at, t.punched_at),
       jsonb_build_object(
           'method', t.method,
           'synced_at', t.synced_at,
           'punched_at', t.punched_at
       ),
       NULL,
       NULL,
       t.id,
       t.created_at,
       t.registered ->> 'actor',
       t.created_at,
       t.updated_at,
       'ATTENDANCE_TERMINAL',
       NULL::timestamptz,
       NULL::boolean,
       NULL::text,
       NULL::timestamptz,
       NULL::text,
       NULL::uuid
  FROM attendance_terminal t
  LEFT JOIN site_node n ON n.site_id = t.site_id
UNION ALL
SELECT 'edc:' || e.site_id || ':' || e.terminal_id,
       'EDC',
       n.origin_id,
       e.site_id,
       COALESCE(NULLIF(btrim(e.label), ''), e.bank_code || ' ' || e.terminal_id),
       CASE WHEN e.active THEN 'ACTIVE' ELSE 'SUSPENDED' END,
       NULL,
       NULL,
       NULL,
       NULL,
       NULL,
       jsonb_build_object('terminal_id', e.terminal_id, 'bank_code', e.bank_code),
       NULL,
       NULL,
       NULL,
       e.created_at,
       e.created_by,
       e.created_at,
       e.created_at,
       'EDC_TERMINAL',
       NULL::timestamptz,
       NULL::boolean,
       NULL::text,
       NULL::timestamptz,
       NULL::text,
       NULL::uuid
  FROM edc_terminal e
  LEFT JOIN site_node n ON n.site_id = e.site_id;

COMMENT ON VIEW device_register IS
    'Every device head office knows: what the nodes report (device, source NODE) and the terminals it registers at a site itself (attendance_terminal, edc_terminal), linked to their site''s node when they are read. Since 0632 also each device''s last test print and head office''s ask for one.';
