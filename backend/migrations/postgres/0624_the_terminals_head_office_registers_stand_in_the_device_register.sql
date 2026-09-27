-- The terminals head office registers stand in the device register.
--
-- 0604 made `device` the one list of machines enrolled to a node, fed by the
-- nodes' heartbeats — so it lists what a node holds: tills, printers, RFID
-- keys. Two kinds it names were never in it. An attendance terminal is
-- registered at head office against a site, and its row is the attendance
-- authority itself (`attendance_terminal`, 0233/0601). An EDC is a bank's
-- terminal that Finance records against a shop (`edc_terminal`, 0373).
--
-- # Why head office links them, and the node does not report them
--
-- Both are registered here, at a site, and everything the register shows about
-- them is already here: the name, the status, when a punch station last took
-- its templates or delivered a punch, which bank an EDC belongs to. A node
-- could only hand head office back its own rows — the attendance book it was
-- sent — or rows it was never sent at all: an EDC exists only in Finance's
-- table. And a node that reported them would leave out every terminal at a
-- site that has no node, head office's own office among them.
--
-- So the register reads them where they are, when it is read: `device_register`
-- is a view, not a copy. No trigger keeps a mirror in step, no new command
-- type goes to a node that might not know it, and nothing can drift. Each row
-- keeps its table's id inside a prefix of its own — `attendance:{id}`,
-- `edc:{site}:{terminal}` — so it can never collide with an id a node reports,
-- and says where it came from in `source`. The prefix is only a namespace:
-- what a row is, is read from `source` and `kind`, never from its spelling.
--
-- Their node is found by their site (`site_node`): the site's inventory owner,
-- or the node that has served it longest when none owns its inventory. It is
-- looked up when the register is read, so a shop server replaced or enrolled
-- again takes its site's terminals with it; a site with no node shows its
-- terminals with no node.
--
-- Their status stays where it is decided — punch stations in People, EDCs in
-- Finance (inactive is SUSPENDED: Finance can switch one back on) — and the
-- register never switches them (`sync::device::node_owns`).

-- The node that serves each site: its inventory owner when it has one
-- (`sync_origin_one_inventory_owner_per_site`), else its oldest node.
CREATE VIEW site_node AS
SELECT DISTINCT ON (c.site_id)
       c.site_id,
       c.origin_id
  FROM sync_origin_credential c
 WHERE c.site_id IS NOT NULL
 ORDER BY c.site_id, c.inventory_enabled DESC, c.created_at, c.origin_id;

COMMENT ON VIEW site_node IS
    'The node that serves each site: its inventory owner, else its oldest node. Read by device_register for the terminals head office registers at a site.';

CREATE VIEW device_register AS
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
       'NODE'::text AS source
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
       -- Heard from when it last took its templates or delivered a punch.
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
       'ATTENDANCE_TERMINAL'
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
       -- Nothing here says when a tender last named it.
       NULL,
       jsonb_build_object('terminal_id', e.terminal_id, 'bank_code', e.bank_code),
       NULL,
       NULL,
       NULL,
       e.created_at,
       e.created_by,
       e.created_at,
       e.created_at,
       'EDC_TERMINAL'
  FROM edc_terminal e
  LEFT JOIN site_node n ON n.site_id = e.site_id;

COMMENT ON VIEW device_register IS
    'Every device head office knows: what the nodes report (device, source NODE) and the terminals it registers at a site itself (attendance_terminal, edc_terminal), linked to their site''s node when they are read.';
