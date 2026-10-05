-- 0916: the names a new article is offered as it is typed.
--
-- The owner (2026-10-05): the Name box of New articles suggests from a master
-- of its own — Kemeja, Kaos, Celana — kept in the Master menu, and not from the
-- articles that already exist. A suggestion is only ever a shortcut: the box
-- stays free text, and nothing points at a row here, so a suggestion can be
-- renamed, retired or deleted without touching one article.

CREATE TABLE IF NOT EXISTS article_name_suggestion (
    suggestion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL CHECK (btrim(name) <> ''),
    active        boolean NOT NULL DEFAULT true,
    created_by    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per name however it is cased or spaced: "Kemeja" and "kemeja " are
-- the same suggestion.
CREATE UNIQUE INDEX IF NOT EXISTS article_name_suggestion_name_key
    ON article_name_suggestion (lower(btrim(name)));

COMMENT ON TABLE article_name_suggestion IS
    'The master of names New articles suggests as a name is typed (0916). Free text stays free; nothing references a row.';
