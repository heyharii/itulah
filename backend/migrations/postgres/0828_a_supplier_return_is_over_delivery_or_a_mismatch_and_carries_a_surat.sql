-- A return to a supplier is raised for one of two reasons, and it leaves
-- behind a surat.
--
-- The owner, 2026-10-04: the return-to-supplier screen stops asking why in
-- three words (DEFECT · WRONG_ITEM · UNSOLD) and asks in two — OVER_DELIVERY
-- (more came than was ordered) and ITEM_MISMATCH (what came is not what the
-- order said). Both are "the delivery was not what we bought"; the older
-- three split a distinction Buying never used, and every old row reads as a
-- mismatch rather than dying on the new check.
--
-- The same confirm raises the paper the supplier signs: a SURAT JALAN RETUR —
-- a third letter kind, drawn from the return's allotment, numbered in its own
-- SJR series and issued the moment the return is confirmed (not drafted for
-- somebody to finish later). The kind is added here so the letters module
-- accepts it; what it draws and who signs it lives in `postgres::letters`.

-- Rows raised under the retired vocabulary read as mismatches: every one of
-- them went back because the goods were not what the order asked for.
UPDATE supplier_return SET reason = 'ITEM_MISMATCH'
 WHERE reason NOT IN ('OVER_DELIVERY', 'ITEM_MISMATCH');

ALTER TABLE supplier_return DROP CONSTRAINT supplier_return_reason_check;
ALTER TABLE supplier_return ADD CONSTRAINT supplier_return_reason_check
    CHECK (reason IN ('OVER_DELIVERY', 'ITEM_MISMATCH'));

ALTER TABLE letter DROP CONSTRAINT letter_kind_check;
ALTER TABLE letter ADD CONSTRAINT letter_kind_check
    CHECK (kind IN ('GOODS_RECEIPT', 'DELIVERY_NOTE', 'GENERAL', 'SUPPLIER_RETURN'));

ALTER TABLE letter_template DROP CONSTRAINT letter_template_kind_check;
ALTER TABLE letter_template ADD CONSTRAINT letter_template_kind_check
    CHECK (kind IN ('GOODS_RECEIPT', 'DELIVERY_NOTE', 'GENERAL', 'SUPPLIER_RETURN'));

COMMENT ON COLUMN letter.kind IS
    'What the letter is: a goods receipt note (STB), a delivery note to a '
    'shop (SJ), a blank letter (SRT), or a return delivery note to a '
    'supplier (SJR) — issued when a return to supplier is confirmed.';
