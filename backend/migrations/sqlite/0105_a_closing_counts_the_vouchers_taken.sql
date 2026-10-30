-- 0105: Tutup kasir counts the paper vouchers the shoppers paid with
-- (Hari, 30 Oct 2026): sheets off the drawer, like the EDC slips (0093),
-- blind — the till is never told how many it took.
--
-- One row per shift, written with the close or the count; none on a shift
-- closed before 0105 or by a till that does not ask.
--
-- `IF NOT EXISTS`: creates only, runs on every open.
CREATE TABLE IF NOT EXISTS cash_shift_voucher_count (
    shift_id TEXT PRIMARY KEY REFERENCES cash_shift(id) ON DELETE CASCADE,
    vouchers INTEGER NOT NULL CHECK (vouchers >= 0)
);
