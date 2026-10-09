-- A quantity check carries the article, colour and size combinations head office had
-- chosen in the New articles form when it asked, as [{article, colour, size}]. The
-- warehouse sheet opens with one row per combination and the counter types the
-- quantity of each. Head office does not know how many of each came, so no
-- quantity is stored here; the answer is still `lines`.

ALTER TABLE quantity_check
    ADD COLUMN IF NOT EXISTS expected jsonb NOT NULL DEFAULT '[]';
