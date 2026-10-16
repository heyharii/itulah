-- A delivery note's item can carry a few words of its own (owner, 2026-10-16:
-- "Item | Notes | Quantity", notes per article, not required). Written when
-- the note is generated, keyed by the article's code; the pieces nobody can
-- name share one note under "*".
ALTER TABLE purchase_return
    ADD COLUMN IF NOT EXISTS note_line_notes jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN purchase_return.note_line_notes IS
    'Per-item notes on the surat jalan retur, by article code ("*" for the not-as-ordered pieces); written when the note is generated.';
