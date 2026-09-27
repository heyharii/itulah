-- A fleet incident is told once, answered by a person, and closed by the part
-- recovering.
--
-- The alerts of the fleet status page (owner's decision of 28 Sep 2026) ride
-- the existing notifications — `node.attention` when one opens or escalates,
-- `node.recovered` when it closes, the kinds 0463 added for a shop server —
-- so no new notification kind, and the hub's bell, the stream and Web Push
-- carry them as they carry everything else.
--
-- What they need that a notification does not have is memory:
--
--   * **one notification per incident, never one per heartbeat.** An
--     incident is one row per (subject, part, rule) while it is open; the
--     partial unique index below makes a second open row for the same thing
--     impossible, so a sweep that runs twice, or two cloud processes, cannot
--     tell anybody twice;
--   * **resolved when the part recovers**, by the same sweep, which then says
--     so once;
--   * **acknowledged by a person** — `POST /api/v1/fleet/incidents/{id}/
--     acknowledge` — and escalated to the owner when nobody has within
--     `fleet_setting.escalate_after_minutes`;
--   * **held through quiet hours**: filed at once, `notified_at` left NULL
--     until they end; one that recovers before then is closed without anybody
--     having been woken for it.
--
-- `opened_at` is when the condition began (a part red since 02:10 whose
-- alert fired at 02:15 opened at 02:10); `filed_at` is when this row was
-- written.

CREATE TABLE fleet_incident (
    incident_id     uuid PRIMARY KEY,
    subject         text NOT NULL CHECK (btrim(subject) <> ''),
    component       text NOT NULL CHECK (btrim(component) <> ''),
    rule            text NOT NULL CHECK (rule IN (
                        'COMPONENT_RED', 'SYNC_BEHIND', 'PRINTER_FAULT', 'BACKUP', 'READER_SILENT'
                    )),
    -- Where it is, for the recipients and the filters. NULL for head office's
    -- own parts.
    unit_id         text REFERENCES unit (id),
    site_id         text REFERENCES site (id),
    origin_id       text,
    code            text NOT NULL CHECK (btrim(code) <> ''),
    title           text NOT NULL CHECK (btrim(title) <> ''),
    body            text NOT NULL CHECK (btrim(body) <> ''),
    opened_at       timestamptz NOT NULL,
    filed_at        timestamptz NOT NULL DEFAULT now(),

    -- NULL while held by quiet hours (or when nobody could be told yet).
    notified_at     timestamptz,
    notification_id uuid REFERENCES notification (notification_id) ON DELETE SET NULL,
    notified_to     text[] NOT NULL DEFAULT '{}',

    acknowledged_at timestamptz,
    acknowledged_by text,
    acknowledged_note text CHECK (acknowledged_note IS NULL OR length(acknowledged_note) <= 500),

    escalated_at    timestamptz,
    escalation_notification_id uuid REFERENCES notification (notification_id) ON DELETE SET NULL,

    resolved_at     timestamptz,
    resolved_notification_id uuid REFERENCES notification (notification_id) ON DELETE SET NULL,

    CONSTRAINT fleet_incident_acknowledgement_is_whole
        CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
    CONSTRAINT fleet_incident_ends_after_it_opens
        CHECK (resolved_at IS NULL OR resolved_at >= opened_at)
);

-- The deduplication: one open incident per part and rule.
CREATE UNIQUE INDEX ux_fleet_incident_open
    ON fleet_incident (subject, component, rule) WHERE resolved_at IS NULL;

CREATE INDEX ix_fleet_incident_opened ON fleet_incident (opened_at DESC);
CREATE INDEX ix_fleet_incident_unit ON fleet_incident (unit_id, opened_at DESC);

COMMENT ON TABLE fleet_incident IS
    'A fleet alert (0639): one row per part and rule while open, told once, escalated to the owner when unacknowledged, closed when the part recovers. Notified as node.attention / node.recovered.';
