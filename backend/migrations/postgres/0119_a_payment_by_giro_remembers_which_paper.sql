-- 0119: A payment by giro remembers which piece of paper it was.
--
-- 0084 gave `supplier_payment` a `method` column with GIRO among its five
-- values and nowhere to put the two things that make a giro a giro: the number
-- printed on it and the date on its face. So a giro payment was recorded as a
-- transfer with a different word next to it, and 0117's `giro` table — which
-- keys on (bank, direction, number) — had nothing to build a row from.
--
-- # Why not `reference`
--
-- `reference` already exists and is free text: a transfer confirmation code, a
-- cheque stub, a note somebody wrote to themselves. A giro number is not that.
-- It is a key — it identifies the paper, it is unique per bank, and the giro
-- row's own uniqueness rests on it — and storing a key in a field whose other
-- users are prose means the first time somebody types "giro BCA 1234 (ganti)"
-- the instrument becomes unfindable.
--
-- # Why the columns live here and not only on `giro`
--
-- Because the giro row is created when the payment POSTS, and the number is
-- known when it is RECORDED. Between those two acts somebody checks the
-- payment, and what they are checking is the paper. Carrying it on the payment
-- is what lets the checker see it; the giro row is what the board counts.

ALTER TABLE supplier_payment
    ADD COLUMN giro_number   text,
    ADD COLUMN giro_due_date date,
    -- A number and a date, or neither. Half of a giro is not a giro.
    ADD CONSTRAINT supplier_payment_giro_is_whole
        CHECK ((giro_number IS NULL) = (giro_due_date IS NULL)),
    -- Only a giro payment carries them. A TRANSFER with a due date on it would
    -- be a payment claiming to be an instrument, and `post_payment` reads the
    -- method to decide which account to credit.
    ADD CONSTRAINT supplier_payment_giro_belongs_to_a_giro
        CHECK (giro_number IS NULL OR method = 'GIRO'),
    ADD CONSTRAINT supplier_payment_giro_number_is_written
        CHECK (giro_number IS NULL OR btrim(giro_number) <> ''),
    -- Post-dated, or at worst dated today. The whole instrument is a promise
    -- about a later date.
    ADD CONSTRAINT supplier_payment_giro_falls_due_after_it_is_written
        CHECK (giro_due_date IS NULL OR giro_due_date >= payment_date);

COMMENT ON COLUMN supplier_payment.giro_number IS
    'The number printed on the giro. A key, not prose: giro rows are unique per (bank, direction, number), which is why this is not folded into reference.';
COMMENT ON COLUMN supplier_payment.giro_due_date IS
    'The date on the face of the paper. Until it arrives the money is on giro_outstanding and the bank balance has not moved.';

-- ---------------------------------------------------------------------------
-- The payments already recorded the old way
-- ---------------------------------------------------------------------------
--
-- Every GIRO payment posted before 0117 credited `bank_giro` — that is the bug
-- those migrations exist to stop repeating. This migration does NOT go back and
-- re-post them, and the reason is worth stating: re-posting would rewrite
-- history in a ledger whose whole discipline is that entries are evidence, and
-- it would do it for a set of payments where nobody now knows which giros
-- actually cleared and which are still out.
--
-- The honest fix is a person: list the GIRO payments that are posted and have
-- no giro row, decide which are still outstanding, and raise a reclassification
-- for those. This view is that list.

CREATE VIEW giro_payment_without_paper AS
SELECT p.payment_id,
       p.payment_number,
       p.site_id,
       p.payment_date,
       p.account_qualifier AS bank,
       p.total_minor,
       p.reference,
       p.status
  FROM supplier_payment p
 WHERE p.method = 'GIRO'
   AND p.giro_number IS NULL
   AND NOT EXISTS (SELECT 1 FROM giro g WHERE g.supplier_payment_id = p.payment_id);

COMMENT ON VIEW giro_payment_without_paper IS
    'GIRO payments with no instrument recorded — the ones booked before 0117 credited the bank directly. Not migrated automatically: which of them are still outstanding is a question for a person, not a guess.';
