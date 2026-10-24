-- 0992: A till hands its float back without closing.
--
-- Client, 24 Oct 2026 (POS port, B2): "Setor modal" on the Tutup kasir panel.
-- The cashier gives the float to the Kepala toko — his finger, a slip
-- SM-0001 with both names — and the drawer stays open; the closing paper then
-- prints "Modal Disetor Rp … · NAME". On the till it is its own cash movement
-- kind, `FLOAT_RETURN`, money out of the drawer and signed negative like a
-- drop (`edge::till::record_cash_movement`).
--
-- It arrives here on `till.shift.recorded` with the shift's other movements,
-- and `cash_movement.kind` (0110) did not allow the word — a shift carrying one
-- would be refused at the boundary and stop that store's sales lane. Widened,
-- nothing else: like a drop and a pickup it moves custody inside one shop's
-- cash and posts nothing.

ALTER TABLE cash_movement DROP CONSTRAINT IF EXISTS cash_movement_kind_check;
ALTER TABLE cash_movement ADD CONSTRAINT cash_movement_kind_check
    CHECK (kind IN ('OPENING_FLOAT', 'DROP', 'PICKUP', 'PAYOUT', 'CORRECTION', 'FLOAT_RETURN'));
