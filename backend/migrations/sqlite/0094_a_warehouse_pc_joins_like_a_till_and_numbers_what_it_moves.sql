-- 0094: A warehouse PC joins like a till, and numbers what it moves.
--
-- Central Gudang (client, 25 Oct 2026) is the POS app in a second edition, on
-- a PC in the store's back room: it receives the DC's deliveries, moves stock
-- between Gudang, Toko and Reject, and sends goods back to head office. It
-- never sells.
--
-- **It joins as a device of its own kind.** It asks its node with a code and
-- head office approves it, exactly as a till does (0050, `edge/devices.rs`),
-- but as `WAREHOUSE`: it is labelled "Gudang N", takes no till seat, and is
-- refused every selling call (`devices::warehouse_refusal`). `edge_terminal`
-- already keeps `kind` with no CHECK (0051); 0050 gave the join queue one that
-- names only `TILL`, and SQLite cannot widen a CHECK, so the queue is rebuilt
-- with the rows carried over — `head_office_error` (added by an ALTER on
-- 24 Oct, `edge/sqlite.rs`) included — and its two indexes made again.
--
-- **What it moves is a numbered document.** Riwayat lists a move as one thing
-- with a number — PB-0042, Gudang → Toko, 12 pcs, by whom — opens it, and
-- prints its surat jalan. The ledger has one movement group per line and no
-- number, so a move is written down here beside the movements it made
-- (`movement_group.reference_type = 'STOCK_MOVE'`, `reference_id` = the
-- number): a receipt of a delivery, a move between the shop's rooms, a piece
-- set aside as reject with its reason, and a send to head office.
--
-- **A cashier works at it on the Kepala toko's yes** (Hari, 25 Oct 2026). At a
-- warehouse PC a person on the cashier rung may receive and move goods
-- between Gudang and Toko; a Reject or a send to head office needs the
-- Kepala toko's finger, which the move records (`approved_by`). Which
-- sessions are at a warehouse PC is `edge_session_device`: a session the
-- machine presented in a request signed with its own key
-- (`POST /api/v1/store/warehouse/session`).
--
-- Applied once, while `edge_stock_move` is missing (`edge::sqlite` probes for
-- it), in one transaction.

BEGIN IMMEDIATE;

CREATE TABLE edge_device_join_next (
    join_id        TEXT PRIMARY KEY,
    -- A till, or a warehouse PC (Central Gudang). A handheld still takes its
    -- credential from head office's RFID policy.
    kind           TEXT NOT NULL DEFAULT 'TILL' CHECK (kind IN ('TILL', 'WAREHOUSE')),
    code           TEXT NOT NULL,
    key_sha256     TEXT NOT NULL CHECK (length(key_sha256) = 64),
    verification   TEXT NOT NULL,
    machine_json   TEXT NOT NULL DEFAULT '{}',
    issued_at      TEXT NOT NULL,
    expires_at     TEXT NOT NULL,

    outcome        TEXT CHECK (outcome IN ('APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED')),
    decided_by     TEXT,
    decided_via    TEXT CHECK (decided_via IS NULL OR decided_via IN ('GRANT', 'SESSION', 'SYSTEM')),
    decided_at     TEXT,
    terminal_id    TEXT,
    replaces_terminal_id TEXT,
    delivered_at   TEXT,
    -- Why head office's last decision could not be carried out here.
    head_office_error TEXT,

    CHECK ((outcome IS NULL) = (decided_at IS NULL)),
    CHECK ((outcome IS NULL) = (decided_by IS NULL)),
    CHECK (outcome IS NOT 'APPROVED' OR terminal_id IS NOT NULL),
    CHECK (delivered_at IS NULL OR outcome = 'APPROVED')
);

INSERT INTO edge_device_join_next
    (join_id, kind, code, key_sha256, verification, machine_json, issued_at, expires_at,
     outcome, decided_by, decided_via, decided_at, terminal_id, replaces_terminal_id,
     delivered_at, head_office_error)
SELECT join_id, kind, code, key_sha256, verification, machine_json, issued_at, expires_at,
       outcome, decided_by, decided_via, decided_at, terminal_id, replaces_terminal_id,
       delivered_at, head_office_error
  FROM edge_device_join;

DROP TABLE edge_device_join;
ALTER TABLE edge_device_join_next RENAME TO edge_device_join;

CREATE UNIQUE INDEX ux_edge_device_join_open_code
    ON edge_device_join (code) WHERE outcome IS NULL;

CREATE INDEX ix_edge_device_join_issued
    ON edge_device_join (issued_at);

-- One move as the warehouse PC made it.
CREATE TABLE edge_stock_move (
    move_id         TEXT PRIMARY KEY,
    -- PB-0042: what Riwayat lists and the surat jalan prints. Counted per
    -- node, from one.
    seq             INTEGER NOT NULL UNIQUE CHECK (seq >= 1),
    number          TEXT NOT NULL UNIQUE,
    kind            TEXT NOT NULL CHECK (kind IN ('RECEIVE', 'MOVE', 'REJECT', 'SEND_HO')),
    -- The shop's rooms as the store app names them (`warehouse` is Gudang,
    -- `floor` is Toko), and the two ends outside it.
    from_place      TEXT NOT NULL CHECK (from_place IN ('dc', 'warehouse', 'floor', 'reject')),
    to_place        TEXT NOT NULL CHECK (to_place IN ('warehouse', 'floor', 'reject', 'ho')),
    -- The surat jalan a receipt came on; the shipment a send left as.
    reference       TEXT,
    delivery_id     TEXT,
    allotment_id    TEXT,
    pieces          INTEGER NOT NULL CHECK (pieces >= 0),
    actor_id        TEXT NOT NULL,
    actor_name      TEXT,
    -- The machine it was done at, as it named itself ("Gudang 1").
    device          TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_sha256  TEXT NOT NULL,
    occurred_at     TEXT NOT NULL,
    -- A send to head office: when its shipment left. Null while the goods
    -- wait in To be returned for the return head office raises.
    sent_at         TEXT,
    -- The Kepala toko who said yes to a Reject or a send, when the person
    -- moving could not say it themselves; and when. A send's later steps
    -- (raising the return, sending it) lean on it for a quarter of an hour.
    approved_by     TEXT,
    approved_by_name TEXT,
    approved_at     TEXT,

    CHECK (kind <> 'SEND_HO' OR to_place = 'ho'),
    CHECK (kind <> 'RECEIVE' OR (from_place = 'dc' AND to_place = 'warehouse')),
    CHECK (kind <> 'REJECT' OR to_place = 'reject'),
    CHECK (sent_at IS NULL OR kind = 'SEND_HO'),
    CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);

CREATE INDEX ix_edge_stock_move_at ON edge_stock_move (occurred_at);

CREATE TABLE edge_stock_move_line (
    move_id   TEXT NOT NULL REFERENCES edge_stock_move (move_id),
    line_no   INTEGER NOT NULL CHECK (line_no >= 1),
    sku_code  TEXT NOT NULL,
    quantity  INTEGER NOT NULL CHECK (quantity >= 0),
    -- What the surat jalan said was sent, on a receipt.
    sent      INTEGER CHECK (sent IS NULL OR sent >= 0),
    -- Why a piece went to Reject, as the screen says it: one tap, never typed.
    reason    TEXT CHECK (reason IS NULL OR reason IN ('Rusak', 'Cacat', 'Kotor', 'Salah kirim')),
    PRIMARY KEY (move_id, line_no)
);

CREATE INDEX ix_edge_stock_move_line_sku ON edge_stock_move_line (sku_code);

-- The machine a session was opened at, as that machine proved: its session
-- token and its own signature in one request. One machine per session.
CREATE TABLE edge_session_device (
    session_id  TEXT PRIMARY KEY,
    terminal_id TEXT NOT NULL,
    bound_at    TEXT NOT NULL
);

-- A move is history: written once, never taken back. A send's shipment is
-- filled in when it leaves, and nothing else changes.
CREATE TRIGGER edge_stock_move_reject_delete
BEFORE DELETE ON edge_stock_move
BEGIN
    SELECT RAISE(ABORT, 'edge_stock_move is kept');
END;

CREATE TRIGGER edge_stock_move_line_reject_change
BEFORE UPDATE ON edge_stock_move_line
BEGIN
    SELECT RAISE(ABORT, 'edge_stock_move_line is append-only');
END;

CREATE TRIGGER edge_stock_move_line_reject_delete
BEFORE DELETE ON edge_stock_move_line
BEGIN
    SELECT RAISE(ABORT, 'edge_stock_move_line is append-only');
END;

COMMIT;
