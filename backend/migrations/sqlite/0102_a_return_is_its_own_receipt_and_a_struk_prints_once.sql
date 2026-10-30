-- 0102: a return is its own receipt, and a struk prints once.
--
-- The till's POS decisions of 28–29 Oct 2026 (Hari, pos-classic-prototype):
--
-- `return_receipt` — every return is a receipt of its own: the pieces that
-- came back (−) and the replacements that went out (+), "Return dari" the
-- struk they were sold on. With replacements the receipt IS the replacement
-- sale's (its 7-letter number, `replacement_sale_id`); with none there is no
-- sale to number, so the return takes the next number at its seat itself
-- (`terminal_id`, `n`) from the same run as the sales, and the two never
-- clash. Money is never paid out: what the returned pieces were worth beyond
-- the replacement is `forfeited_minor` ("selisih tidak diuangkan"), and a
-- dearer replacement's difference is `paid_minor`. A receipt that is a
-- replacement sale can never be returned itself.
--
-- `receipt_print` — no reprint anywhere (no Cetak ulang, Cetak salinan,
-- Ctrl+P): a struk's number is written here the first time it is printed or
-- rendered for a printer, and a second time is refused.
--
-- `IF NOT EXISTS`: creates only, runs on every open; after `sale_return`
-- (`0024`) and `sale_receipt` (`0085`).

CREATE TABLE IF NOT EXISTS return_receipt (
    return_id           TEXT PRIMARY KEY REFERENCES sale_return(id),
    receipt_no          TEXT NOT NULL UNIQUE,
    -- Set only when the return numbered itself (no replacement).
    terminal_id         TEXT,
    n                   INTEGER CHECK (n IS NULL OR n > 0),
    from_sale_id        TEXT NOT NULL REFERENCES sale(id),
    replacement_sale_id TEXT REFERENCES sale(id),
    back_minor          INTEGER NOT NULL CHECK (back_minor >= 0),
    replacement_minor   INTEGER NOT NULL CHECK (replacement_minor >= 0),
    paid_minor          INTEGER NOT NULL CHECK (paid_minor >= 0),
    forfeited_minor     INTEGER NOT NULL CHECK (forfeited_minor >= 0),
    created_at          TEXT NOT NULL,
    UNIQUE (terminal_id, n)
);

CREATE INDEX IF NOT EXISTS return_receipt_from ON return_receipt (from_sale_id);
CREATE UNIQUE INDEX IF NOT EXISTS return_receipt_replacement
    ON return_receipt (replacement_sale_id)
    WHERE replacement_sale_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS receipt_print (
    receipt_no TEXT PRIMARY KEY,
    printed_at TEXT NOT NULL,
    printed_by TEXT NOT NULL
);
