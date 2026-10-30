-- 1009: a store prints its own picture at the top of a receipt.
--
-- The head of a receipt was the word CENTRAL, the shop's name and an address,
-- the same for every shop. The owner (30 Oct 2026) wants an image there, one
-- per store, as big as the head of the paper (the part above "No Nota" and
-- "Kasir", which stay text).
--
-- The picture is kept as the printer wants it: one bit a dot, a row after a
-- row, 1 for black, in two widths — 576 dots for 80 mm paper and 384 for
-- 58 mm — so a node needs no image library and a till prints it as it is.
-- The hub makes both from whatever the person uploads and shows the result
-- before saving.

CREATE TABLE store_receipt_header (
    site_id       text PRIMARY KEY REFERENCES site(id) ON DELETE CASCADE,
    wide_width    smallint NOT NULL DEFAULT 576 CHECK (wide_width = 576),
    wide_height   smallint NOT NULL CHECK (wide_height BETWEEN 8 AND 400),
    wide_bits     bytea    NOT NULL,
    narrow_width  smallint NOT NULL DEFAULT 384 CHECK (narrow_width = 384),
    narrow_height smallint NOT NULL CHECK (narrow_height BETWEEN 8 AND 270),
    narrow_bits   bytea    NOT NULL,
    updated_by    text NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (octet_length(wide_bits)   = (wide_width   / 8) * wide_height),
    CHECK (octet_length(narrow_bits) = (narrow_width / 8) * narrow_height)
);
