-- A quantity check also carries the division and the tags head office had in the
-- New articles form when it asked, as catalogue codes, so the warehouse sheet can
-- say what the goods are beside the picture, the supplier and the counted pieces.
-- Both are only for reading: older checks have no division and no tags.

ALTER TABLE quantity_check
    ADD COLUMN IF NOT EXISTS division_code text,
    ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]';
