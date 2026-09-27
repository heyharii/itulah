-- 0064: A reader says it is alive even when it reads nothing.
--
-- Until now the node knew a handheld or a fixed reader only by its batches
-- (`edge_rfid_device.last_seen_at`, `edge_observation_sighting`). That cannot
-- tell a reader that is switched off from one that is on and reading nothing
-- — the second is the one head office wants to hear about: a portal over the
-- stockroom door that has been silent all afternoon is a reader somebody
-- knocked out of alignment, not a quiet afternoon (fleet status, owner's
-- decision of 28 Sep 2026).
--
-- So a reader may ping (`POST /api/v1/rfid/ping`, signed like a batch), and
-- a batch or a ping may carry what a handheld knows about itself: battery,
-- app version, when its trigger was last pulled. Every field is optional —
-- a handheld on an older app sends none, and loses nothing.
--
-- One row per device, replaced on every report. Creates only, so it runs on
-- every open.

CREATE TABLE IF NOT EXISTS edge_rfid_device_health (
    device_id       TEXT PRIMARY KEY,
    -- When the device last proved itself, by ping or by batch.
    pinged_at       TEXT NOT NULL,
    battery_percent INTEGER CHECK (battery_percent IS NULL OR battery_percent BETWEEN 0 AND 100),
    app_version     TEXT CHECK (app_version IS NULL OR length(app_version) <= 64),
    last_scan_at    TEXT,
    updated_at      TEXT NOT NULL
);

-- The activity summary reads a reader's recent sightings by device and time.
CREATE INDEX IF NOT EXISTS edge_observation_device_seen_idx
    ON edge_observation_sighting (device_id, last_seen_at);
