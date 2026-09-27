-- A printer is recorded once, and chosen by name.
--
-- Until now no printer was written down anywhere. Every print request carried
-- `printer_host` and `printer_port` (`printing.rs`, `outbound.rs`, `till.rs`),
-- typed into a bench's settings or a till's config, so the node could not say
-- which printers it has, head office could not see them, and a printer whose
-- address changed had to be retyped on every screen that used it.
--
-- A network printer is a device (CONTEXT.md, "Device"): recorded here once,
-- with its address as configuration, chosen by `printer_id` from then on, and
-- reported to head office's registry with every heartbeat. Requests that still
-- send host and port keep working — the address is only looked up when an id
-- is given. A USB printer on a till is not here: it is a peripheral of that
-- till (`edge_terminal.peripherals_json`).
--
-- Every statement is `IF NOT EXISTS`, so this runs on every open.

CREATE TABLE IF NOT EXISTS edge_printer (
    printer_id  TEXT PRIMARY KEY,
    label       TEXT NOT NULL CHECK (length(trim(label)) > 0),
    host        TEXT NOT NULL CHECK (length(trim(host)) > 0),
    port        INTEGER NOT NULL DEFAULT 9100 CHECK (port BETWEEN 1 AND 65535),
    -- What the machine speaks: ZPL or TSPL for a label printer, ESCPOS for a
    -- receipt printer. Null when nobody said, which the label path already
    -- reads as the node's default.
    language    TEXT CHECK (language IS NULL OR language IN ('ZPL', 'TSPL', 'ESCPOS')),
    purpose     TEXT NOT NULL DEFAULT 'LABEL' CHECK (purpose IN ('LABEL', 'RECEIPT')),
    status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    status_changed_at TEXT,
    status_changed_by TEXT,
    status_reason     TEXT,
    created_at  TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    -- The last time a print was sent to it by id: the nearest thing to "last
    -- seen" a one-way socket gives.
    last_used_at TEXT
);

-- One live record per address. Two names for one machine is how a bench ends
-- up printing to the wrong one; a revoked record gives its address back.
CREATE UNIQUE INDEX IF NOT EXISTS ux_edge_printer_address
    ON edge_printer (host, port) WHERE status <> 'REVOKED';
