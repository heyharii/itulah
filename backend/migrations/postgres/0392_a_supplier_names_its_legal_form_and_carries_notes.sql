-- A supplier says what kind of company it is, and carries a note.
--
-- The legal form (PT, CV, UD) is part of how the company is named on its own
-- paperwork — "Sepatu Sejahtera, CV" — and it used to live only inside the
-- name, where the hub had to strip it back off to derive a code. It is its own
-- column now, and the screens print it after the name.
--
-- Nullable: every supplier registered before this is a name with no answer,
-- and a guessed legal form printed on a purchase order is worse than none.
--
-- `notes` is free text the buyer writes on the supplier record itself. Not a
-- comment thread: the owner asked for comments on a supplier to go, and for a
-- note at the foot of the form instead (2026-09-26).
ALTER TABLE supplier
    ADD COLUMN legal_form text
        CONSTRAINT supplier_legal_form_known CHECK (legal_form IN ('PT', 'CV', 'UD')),
    ADD COLUMN notes text;
