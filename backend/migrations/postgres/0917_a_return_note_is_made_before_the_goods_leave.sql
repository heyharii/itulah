-- 0917: a purchase return's surat jalan is made before the goods leave.
--
-- The owner (2026-10-05): Generate Surat Jalan names the Gudang's person in
-- charge and makes the note; only then can the hand-over be confirmed. The
-- Return to supplier lists (Operations and Procurement) show who is in charge
-- and where each return stands: not generated, generated, confirmed. Both
-- facts live on the return itself, so every screen reads the same answer.

ALTER TABLE purchase_return
    ADD COLUMN IF NOT EXISTS note_pic          text,
    ADD COLUMN IF NOT EXISTS note_generated_at timestamptz,
    ADD COLUMN IF NOT EXISTS note_generated_by text;

COMMENT ON COLUMN purchase_return.note_pic IS
    'The Gudang''s person in charge of the hand-over, named when the surat jalan was generated (0917).';
