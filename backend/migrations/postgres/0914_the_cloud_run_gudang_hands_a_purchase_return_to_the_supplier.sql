-- The Gudang the cloud runs hands a purchase return to the supplier
-- (DC-CLOUD-NATIVE.md, src/cloud/dc/returns.rs).
--
-- With a DC server, the hand-over was the server's movement out of
-- Unidentified, and its fact closed the return here (0710). The cloud-run
-- Gudang writes that movement itself and closes the return in the same
-- transaction. Two things the server kept that `purchase_return` has no
-- column for: who took the goods for the supplier (a driver's name, for the
-- record), and the key the bay pressed the button with, so pressing it twice
-- is one hand-over.

CREATE TABLE IF NOT EXISTS dc_purchase_return_handover (
    return_id         uuid PRIMARY KEY REFERENCES purchase_return (return_id),
    idempotency_key   text NOT NULL UNIQUE,
    handed_over_to    text,
    handed_over_by    text NOT NULL CHECK (btrim(handed_over_by) <> ''),
    handed_over_at    timestamptz NOT NULL,
    movement_group_id uuid NOT NULL
);

COMMENT ON TABLE dc_purchase_return_handover IS
    'A purchase return handed to the supplier by the cloud-run Gudang (0914): who took it, and the key it was done under.';
