-- 0919: a quantity check — a count asked of the warehouse, kept as a reference.
--
-- The owner (2026-10-06): while a delivery line is being given its identity in
-- New articles, head office may ask the warehouse how many of each colour and
-- size actually arrived. The warehouse answers with a flat list — a colour, a
-- size, a quantity — and does not touch the name. The answer is only something
-- to look at while naming: nothing waits for it, nothing is checked against it,
-- and the delivery's own count stays what it was.
--
-- Asking again ("Recount") is a new check, not an edit of the old one; the
-- earlier answers stay as they were said.

CREATE TABLE IF NOT EXISTS quantity_check (
    check_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_line_id uuid NOT NULL
        REFERENCES goods_receipt_line (receipt_line_id) ON DELETE CASCADE,
    -- The name as head office had it when it asked: shown to the warehouse,
    -- never changed by it.
    article_name    text NOT NULL CHECK (btrim(article_name) <> ''),
    status          text NOT NULL DEFAULT 'REQUESTED'
        CHECK (status IN ('REQUESTED', 'COUNTED')),
    requested_by    text NOT NULL,
    requested_at    timestamptz NOT NULL DEFAULT now(),
    counted_by      text,
    counted_at      timestamptz,
    -- [{"colour": "Navy", "size": "M", "quantity": 12}, ...]
    lines           jsonb NOT NULL DEFAULT '[]'::jsonb,
    CHECK ((status = 'COUNTED') = (counted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS quantity_check_line_idx
    ON quantity_check (receipt_line_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS quantity_check_open_idx
    ON quantity_check (requested_at) WHERE status = 'REQUESTED';

COMMENT ON TABLE quantity_check IS
    'A count of a delivery line by colour and size, asked of the warehouse and kept as a reference (0919). Nothing waits for it or is checked against it.';
