-- A sale the shop took back has to be a state the centre can see.
--
-- Until now a void travelled upstream only as the stock movement it causes
-- (the unit walks back to the floor, reference `SALE_VOID`). The `edge_sale`
-- row kept its money as if the sale stood, the campaign and coupon counters
-- kept what the basket burned, and a member kept the points the sale had
-- earned. Every one of those is "gross given at the counter" and stays that
-- way by ruling — but the VOIDED state itself, and the points, were not a
-- ruling, they were an absence. Reports could not exclude a voided sale
-- because nothing marked it, and the award stood even though the sale it was
-- earned on did not.
--
-- # What this migration carries
--
-- `edge_sale.status` (`COMPLETED` by default, `VOIDED` when the shop's own
-- fact says so) and `voided_at` for the audit stamp. Reports that mean money
-- filter on it; the campaign counters deliberately do not — a budget is a
-- brake on giving, and the giving happened.
--
-- And the ledger's one-slot-per-cause rule for the void reversal: a sale's
-- points may be taken back exactly once, decided by a partial unique index —
-- the same shape 0165 gave returns (`ux_points_ledger_reversal`), keyed here
-- on the sale the award came from.
ALTER TABLE edge_sale
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE edge_sale
    ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

-- The ledger's vocabulary of entries grows by one word. The check is
-- recreated whole: dropping and re-adding in one transaction, so no row in
-- flight can be un-policed.
ALTER TABLE points_ledger DROP CONSTRAINT points_ledger_entry_type_check;
ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_entry_type_check
    CHECK (entry_type = ANY (ARRAY[
        'OPENING'::text,
        'EARN'::text,
        'RETURN_REVERSAL'::text,
        'VOID_REVERSAL'::text,
        'REDEEM_TO_VOUCHER'::text,
        'ADJUSTMENT'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS ux_points_ledger_void_reversal
    ON points_ledger (sale_id) WHERE entry_type = 'VOID_REVERSAL';
