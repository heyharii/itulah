-- 0093: A closing counts each EDC machine's slips.
--
-- Client, 25 Oct 2026: at Tutup kasir the cashier types how many slips each
-- EDC machine printed during the shift, blind — the till is never told how
-- many the node expects. A shop has one machine per bank (postgres 0989), so
-- a machine is the bank its tenders name as `acquirer`, and a bank's QRIS
-- counts on that bank's machine.
--
-- One row per machine the cashier counted. The expectation is not stored: it
-- is the shift's own card and QRIS tenders on that machine, counted when the
-- report is read (`edge::till::report`), the way the expected cash is.
--
-- `IF NOT EXISTS`: creates only, runs on every open.

CREATE TABLE IF NOT EXISTS cash_shift_edc_slip (
    shift_id   TEXT NOT NULL REFERENCES cash_shift(id) ON DELETE CASCADE,
    -- The bank, upper-cased (`BCA`).
    machine_id TEXT NOT NULL CHECK (machine_id <> ''),
    slips      INTEGER NOT NULL CHECK (slips >= 0),
    PRIMARY KEY (shift_id, machine_id)
);
