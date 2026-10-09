-- New articles: "Save as Draft" is kept on the server (10 Oct 2026).
--
-- The form was only remembered by the browser it was typed in, so a draft
-- begun at one desk could not be finished at another. One shared draft per
-- delivery line, last save wins; it is the form as the screen holds it, and
-- the server does not read it. It goes when the line is given its identity.

CREATE TABLE IF NOT EXISTS article_setup_draft (
    receipt_line_id uuid PRIMARY KEY
        REFERENCES goods_receipt_line (receipt_line_id) ON DELETE CASCADE,
    payload         jsonb NOT NULL,
    saved_by        text NOT NULL,
    saved_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS article_setup_draft_saved_idx
    ON article_setup_draft (saved_at DESC);
