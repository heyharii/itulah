-- A return handed over keeps a photo of the receipt (owner, 2026-10-16:
-- "input bukti photo bukti penerima barang" on Confirm).
--
-- Confirm on a return asks for one photograph — the surat jalan signed by the
-- supplier as Penerima, or the goods in the supplier's hands — before the
-- hand-over is written. The photo is stored where every other photograph is
-- (the image bucket) and this row keeps its link, one per return; a second
-- photo for the same return replaces the first.
CREATE TABLE purchase_return_proof (
    return_id   uuid PRIMARY KEY
                REFERENCES purchase_return (return_id) ON DELETE CASCADE,
    photo_url   text NOT NULL CHECK (
                    length(photo_url) BETWEEN 10 AND 2000
                    AND photo_url ~ '^https?://'
                ),
    taken_by    text NOT NULL,
    taken_at    timestamptz NOT NULL DEFAULT now()
);
