-- A letter need not be about a record.
--
-- 0200 gave the company two letters, and both are drawn from something the
-- database already holds: a delivery it counted, an allotment it is sending.
-- That is right for those two and wrong as a rule, which the owner said in one
-- sentence the first time he opened the screen: "lah harusnya bisa new surat
-- dong ya? bukan yg tiba2 langsung jadi draft?"
--
-- Most of a company's letters are not about a row. A covering note that goes
-- with a return, a letter appointing somebody to collect goods, a note to a
-- landlord — all of them are numbered, filed and signed exactly like the other
-- two, and none of them has a record to be drawn from.
--
-- # Why this is a KIND and not a flag
--
-- A blank letter differs from the other two in what fills it in, and in
-- nothing else: same register, same series arithmetic, same draft → issued →
-- void, same numbering. So it is a third `kind` with its own prefix (`SRT`),
-- and every rule written for the first two applies to it unchanged.
--
-- # What it points at
--
-- `subject_kind`/`subject_id` are NOT NULL and the live-letter index is built
-- on them, so a letter about nothing still has to name something. It names
-- ITSELF — `('letter', <its own id>)` — which is true, is unique by
-- construction, and therefore can never collide with another letter on the
-- index that stops one delivery having two goods receipt notes.

ALTER TABLE letter DROP CONSTRAINT letter_kind_check;
ALTER TABLE letter ADD CONSTRAINT letter_kind_check
    CHECK (kind IN ('GOODS_RECEIPT', 'DELIVERY_NOTE', 'GENERAL'));

COMMENT ON COLUMN letter.subject_id IS
    'The record the letter was drawn from. A GENERAL letter is drawn from '
    'nothing and names itself, so the live-letter index cannot collide.';
