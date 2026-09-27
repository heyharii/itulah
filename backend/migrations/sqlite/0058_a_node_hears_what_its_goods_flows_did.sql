-- 0058: A node hears what the goods flows touching its site did.
--
-- Head office runs each movement of goods as a flow document (the allotment
-- or the purchase order it runs, stage by stage: pick, pack, ship, depart,
-- receive, inspect…). A stage done on this node moves the flow through the
-- node's own facts; a stage done in the hub — an approval, a handover to a
-- supplier — and the document's status reach this node as
-- `inventory.flow.events.v1`, one command per document and batch of events.
--
-- Kept here so the node's screens can say which document a piece of work
-- belongs to and where that document stands: the shop's Send screen lists
-- the transfers and returns it has to pick for, and the Gudang sees that a
-- supplier return was approved before anybody picks it.
--
-- Nothing here moves stock. A flow's hub-done movement is head office's
-- record; this node's ledger is written by this node's own hands.
--
-- Creates only, so it runs on every open.

CREATE TABLE IF NOT EXISTS flow_notice_document (
    document_id            TEXT PRIMARY KEY,
    document_number        TEXT NOT NULL,
    template_code          TEXT NOT NULL,
    template_name          TEXT NOT NULL,
    source_kind            TEXT NOT NULL,
    source_id              TEXT NOT NULL,
    -- Our sites at either end, as this node spells them; NULL for a party.
    origin_site_id         TEXT,
    destination_site_id    TEXT,
    destination_party_kind TEXT,
    -- As of the newest event heard: REQUESTED, CONFIRMED, COMPLETED…
    status                 TEXT NOT NULL,
    -- The stage now due, when there is one.
    current_stage          TEXT,
    -- The newest event heard, so an older relay arriving late cannot turn
    -- the document back.
    last_event_id          INTEGER NOT NULL,
    updated_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS flow_notice_document_by_status
    ON flow_notice_document (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS flow_notice_event (
    -- `flow_event.id` at head office: a resend is the same row.
    event_id       INTEGER PRIMARY KEY,
    document_id    TEXT NOT NULL,
    stage_index    INTEGER,
    stage_kind     TEXT,
    event_type     TEXT NOT NULL,
    -- NODE: this node (or the other end's) wrote it; HUB: done in the hub.
    executed_at    TEXT NOT NULL,
    target_site_id TEXT,
    payload_json   TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    command_id     TEXT NOT NULL,
    received_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS flow_notice_event_by_document
    ON flow_notice_event (document_id, event_id);
