-- Every part of a store keeps ninety days of colour.
--
-- The fleet status page (owner's decision of 28 Sep 2026) is one row per
-- store and one for the gudang, coloured by the worst of its parts, and each
-- part has a ninety-day history — the strip of daily bars a status page
-- shows. The parts are the store server, connection and sync, each device
-- (tills, printers, readers and handhelds, EDC, the attendance terminal), the
-- desk reader on a till, the gudang's label printer, the daily backup, the
-- server version, and power and disk. Head office has a row of its own: the
-- cloud API and database, and its background jobs.
--
-- # Why not one row a minute
--
-- `node_health_sample` (0463) keeps a judgement per heartbeat and throws it
-- away after thirty days. Ten parts across fourteen sites a minute for ninety
-- days is eighteen million rows to say, almost always, "still green". So a
-- part keeps SPANS instead: one row from the moment it turned a colour until
-- the moment it stopped, with `seen_at` moved forward each minute the colour
-- was confirmed. A part that stays green for ninety days is one row.
--
-- The gap between one span's `seen_at` and the next span's `started_at` is
-- time nobody looked — head office itself was down. For a store's parts that
-- is "no data", not an outage of the store; for head office's own API it IS
-- the outage, and the reader counts it so.
--
--   fleet_component       each part as it is now: its colour, the sentence
--                         that explains it, and since when;
--   fleet_component_span  its history, pruned after `fleet_setting.history_days`
--                         by the same minute's sweep.
--
-- `subject` is the site the part belongs to (`site.id`), or `HO` for head
-- office's own parts. Not a foreign key: head office is not a site here, and
-- a site's history outlives the day it is closed.
--
-- # The four colours
--
-- OK green, WARN yellow, BAD red, UNKNOWN grey — grey when the part cannot be
-- judged: its server is silent, it has never reported, or it is switched off.
-- Uptime counts OK and WARN as up, BAD as down, and leaves UNKNOWN out.

CREATE TABLE fleet_component (
    subject    text NOT NULL CHECK (btrim(subject) <> ''),
    -- Stable within its subject: `server`, `sync`, `backup`, `version`,
    -- `power`, `disk`, `device:<device_id>`, `desk_reader:<till id>`,
    -- `ho.api`, `ho.sync_apply`, `ho.postings`, `ho.notifications`,
    -- `ho.brief`.
    component  text NOT NULL CHECK (btrim(component) <> ''),
    kind       text NOT NULL CHECK (kind IN (
                   'SERVER', 'SYNC', 'DEVICE', 'DESK_READER', 'BACKUP', 'VERSION',
                   'POWER', 'DISK', 'HO_API', 'HO_JOB'
               )),
    -- The device kind for a DEVICE part (TILL, PRINTER, HANDHELD, ...).
    device_kind text,
    label      text NOT NULL CHECK (btrim(label) <> ''),
    origin_id  text,
    state      text NOT NULL CHECK (state IN ('OK', 'WARN', 'BAD', 'UNKNOWN')),
    -- Stable, for filters and alerts: `OK`, `OFFLINE`, `SILENT`, `FAULT`, ...
    code       text NOT NULL CHECK (btrim(code) <> ''),
    sentence   text NOT NULL CHECK (btrim(sentence) <> ''),
    -- When this colour began.
    since      timestamptz NOT NULL,
    checked_at timestamptz NOT NULL,
    -- The figures behind the sentence, for the page to show.
    detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (subject, component)
);

CREATE TABLE fleet_component_span (
    subject    text NOT NULL,
    component  text NOT NULL,
    state      text NOT NULL CHECK (state IN ('OK', 'WARN', 'BAD', 'UNKNOWN')),
    started_at timestamptz NOT NULL,
    -- The last minute this colour was confirmed. Moved forward by the sweep.
    seen_at    timestamptz NOT NULL,
    PRIMARY KEY (subject, component, started_at),
    CONSTRAINT fleet_component_span_runs_forward CHECK (seen_at >= started_at)
);

-- The ninety-day read goes by part and time; the prune by time alone.
CREATE INDEX ix_fleet_component_span_seen ON fleet_component_span (seen_at);

COMMENT ON TABLE fleet_component IS
    'Each part of each store, the gudang and head office as the fleet sweep last judged it (0638): colour, code, sentence, since when.';
COMMENT ON TABLE fleet_component_span IS
    'A part''s colour history as spans, one row per colour change, seen_at moved forward each minute it held (0638). Kept fleet_setting.history_days.';
