-- 0965: picked pieces MD no longer wants stay reserved until the Gudang
-- moves them back.
--
-- The owner (2026-10-10): stock returns only when the warehouse confirms.
-- Until now an edit or a cancel closed short every piece not packed yet —
-- picked pieces waiting in the pick area included — so they were free again
-- the moment MD pressed the button, while they still stood in the pick area.
-- Now such a reduction closes short only what nobody picked yet; the picked
-- part is written here, still counted in To Pack (and so still reserved),
-- and the Gudang's move back to the racks closes it short as it happens.
--
-- What the line still wants packed is `to_pack_qty − pick_owed_quantity`; a
-- pack never takes more (dc::packing_stages), and the pieces it may not take
-- are owed to the racks (dc::owed).

ALTER TABLE allotment_line
    ADD COLUMN IF NOT EXISTS pick_owed_quantity bigint NOT NULL DEFAULT 0
        CHECK (pick_owed_quantity >= 0);
