-- 0085: A till numbers its own sales, keeps held baskets, and hands out slips.
--
-- Client, 23 Oct 2026 ("ikut client"):
--
-- `sale_receipt` — the 7-letter transaction number: the store's two letters,
-- the till's letter (A = KASIR-1), and the till's own running number `n`
-- scrambled into four letters (`edge::till::allocate_receipt`). One row per
-- sale, written in the sale's own transaction. A sale from before has none and
-- keeps the derived number it always printed.
--
-- `held_sale` — a basket put aside (Tunda), kept on this node so any till of
-- the store can resume it. It lives for its business day: one from an earlier
-- day is expired and never listed. A shift does not close while its seat has
-- one HELD.
--
-- `cash_slip` — the slip a PICKUP ("Tambah modal kasir", TM-0001) or a DROP
-- ("Setoran sementara", ST-0001) hands out, numbered per kind.
--
-- `IF NOT EXISTS`: creates only, runs on every open.

CREATE TABLE IF NOT EXISTS sale_receipt (
    sale_id     TEXT PRIMARY KEY REFERENCES sale(id),
    terminal_id TEXT NOT NULL,
    n           INTEGER NOT NULL CHECK (n > 0),
    receipt_no  TEXT NOT NULL UNIQUE,
    UNIQUE (terminal_id, n)
);

CREATE TABLE IF NOT EXISTS held_sale (
    id            TEXT PRIMARY KEY,
    terminal_id   TEXT,
    held_by       TEXT NOT NULL,
    held_at       TEXT NOT NULL,
    business_date TEXT NOT NULL,
    basket_json   TEXT NOT NULL,
    total_minor   INTEGER NOT NULL,
    pcs           INTEGER NOT NULL CHECK (pcs >= 0),
    status        TEXT NOT NULL DEFAULT 'HELD'
                  CHECK (status IN ('HELD', 'RESUMED', 'DROPPED')),
    closed_by     TEXT,
    closed_at     TEXT
);

CREATE INDEX IF NOT EXISTS held_sale_open
    ON held_sale (business_date, status, terminal_id);

CREATE TABLE IF NOT EXISTS cash_slip (
    movement_id TEXT PRIMARY KEY REFERENCES cash_movement(id),
    kind        TEXT NOT NULL CHECK (kind IN ('PICKUP', 'DROP')),
    seq         INTEGER NOT NULL CHECK (seq > 0),
    slip_no     TEXT NOT NULL UNIQUE,
    given_by    TEXT NOT NULL,
    received_by TEXT NOT NULL,
    UNIQUE (kind, seq)
);
