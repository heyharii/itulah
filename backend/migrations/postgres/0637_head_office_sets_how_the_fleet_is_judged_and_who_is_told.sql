-- Head office sets how its stores and gudang are judged, and who is told.
--
-- The fleet status page (owner's decision of 28 Sep 2026) colours every store
-- by the worst of its parts and shows sync as freshness and queues, never as
-- a percentage. Where each colour starts is a threshold, and the owner wants
-- the thresholds to be settings rather than constants in the code — the same
-- rule the finance lane follows (`finance_setting`, 0471): a number somebody
-- may want to move is a row, not a release.
--
-- One row, because there is one fleet. Typed columns rather than key/value
-- rows, because the API reads and writes the whole set at once and each
-- number has a range the database can hold it to.
--
-- # Sync
--
--   synced_within_seconds   "Up · synced": the oldest unsent fact is younger
--                           than this, and no command to the store has waited
--                           longer. Two minutes.
--   behind_alert_minutes    "Up · behind" turns into an alert past this. 30.
--   offline_after_seconds   No heartbeat for this long is "Offline". Two
--                           minutes, as `node_status::SILENT_AFTER_SECONDS`.
--
-- # Alerts
--
-- An alert fires when a part turns red for more than `red_after_minutes`,
-- sync is behind more than `behind_alert_minutes`, a printer faults, the
-- backup fails or is older than `backup_max_age_hours`, or a reader is alive
-- and has read nothing for `reader_silent_minutes`. Each rule may be switched
-- off. Nobody who is told acknowledges within `escalate_after_minutes`, and
-- the alert goes to `escalate_to_roles` too.
--
-- Recipients are `notify_roles` — job roles (`job_role.code`, landing with
-- 0633) where the estate has them, otherwise the Admin rung — plus the PIC of
-- the store's unit when `notify_unit_pic`.
--
-- Quiet hours are on head office's clock. An alert that fires inside them is
-- filed at once and sent when they end, if it has not recovered by then; its
-- escalation waits with it. Both NULL: no quiet hours.

CREATE TABLE fleet_setting (
    singleton               boolean PRIMARY KEY DEFAULT true CHECK (singleton),

    synced_within_seconds   integer NOT NULL DEFAULT 120 CHECK (synced_within_seconds BETWEEN 10 AND 3600),
    behind_alert_minutes    integer NOT NULL DEFAULT 30  CHECK (behind_alert_minutes BETWEEN 1 AND 1440),
    offline_after_seconds   integer NOT NULL DEFAULT 120 CHECK (offline_after_seconds BETWEEN 60 AND 3600),

    alerts_enabled          boolean NOT NULL DEFAULT true,
    alert_on_red            boolean NOT NULL DEFAULT true,
    red_after_minutes       integer NOT NULL DEFAULT 5   CHECK (red_after_minutes BETWEEN 0 AND 1440),
    alert_on_sync_behind    boolean NOT NULL DEFAULT true,
    alert_on_printer_fault  boolean NOT NULL DEFAULT true,
    alert_on_backup         boolean NOT NULL DEFAULT true,
    backup_max_age_hours    integer NOT NULL DEFAULT 26  CHECK (backup_max_age_hours BETWEEN 1 AND 720),
    alert_on_reader_silent  boolean NOT NULL DEFAULT true,
    reader_silent_minutes   integer NOT NULL DEFAULT 60  CHECK (reader_silent_minutes BETWEEN 5 AND 1440),

    escalate_after_minutes  integer NOT NULL DEFAULT 30  CHECK (escalate_after_minutes BETWEEN 1 AND 1440),
    notify_roles            text[]  NOT NULL DEFAULT ARRAY['IT', 'OWNER', 'ADMIN']
                                    CHECK (cardinality(notify_roles) BETWEEN 1 AND 16),
    notify_unit_pic         boolean NOT NULL DEFAULT true,
    escalate_to_roles       text[]  NOT NULL DEFAULT ARRAY['OWNER']
                                    CHECK (cardinality(escalate_to_roles) BETWEEN 1 AND 16),

    -- Head office's clock. Equal bounds would be a day with no hours or with
    -- every hour, and neither is what anybody means.
    quiet_from              time,
    quiet_until             time,

    -- How long the parts' histories are kept. The page shows ninety days.
    history_days            integer NOT NULL DEFAULT 100 CHECK (history_days BETWEEN 91 AND 400),

    updated_by              text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fleet_setting_quiet_hours_are_whole CHECK (
        (quiet_from IS NULL) = (quiet_until IS NULL)
        AND (quiet_from IS NULL OR quiet_from <> quiet_until)
    )
);

INSERT INTO fleet_setting (singleton, updated_by) VALUES (true, 'migration:0637')
ON CONFLICT (singleton) DO NOTHING;

COMMENT ON TABLE fleet_setting IS
    'How the fleet status page judges stores and who its alerts reach (0637): sync thresholds, alert rules, recipients, quiet hours. One row.';
