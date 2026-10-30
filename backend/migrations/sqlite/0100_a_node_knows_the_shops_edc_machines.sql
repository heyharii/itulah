-- 0100: A node knows the shop's EDC machines.
--
-- Client, 28 Oct 2026: Tutup kasir must ask for a slip count on every EDC
-- machine, not only the ones that took a card in this shift. Until now the
-- node could only name machines it had seen on a tender, so a drawer that took
-- no card skipped the step altogether -- exactly the shift where a stray slip
-- is easiest to miss.
--
-- The book comes from head office's `edc_terminal` rows for this site, carried
-- in the auth policy (`edc_machines`, outside its content hash like `site`).
-- The node keeps a copy of the names; the count itself stays in
-- `cash_shift_edc_slip` (0093).
CREATE TABLE IF NOT EXISTS edge_edc_machine (
    machine_id TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
