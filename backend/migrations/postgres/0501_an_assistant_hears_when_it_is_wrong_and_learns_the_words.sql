-- 0501: an assistant hears when it is wrong, and learns the business's words.
--
-- Two things the owner needs in order to trust a smaller model than the one
-- the assistant was built on (0500 moved it to Gemma 4), both data rather than
-- code:
--
--   * A verdict on an answer: up or down, and on a down a line saying what was
--     wrong. Kept on the answer itself and given only by the person the
--     conversation belongs to. A figure somebody bothered to flag is the most
--     useful case `scripts/assistant-check.mjs` can be handed, and the count
--     of downs is the plainest measure of whether a change of model or prompt
--     made things better.
--   * A glossary: the words this business uses and what they mean here — that
--     C003 is Purbalingga, that omzet includes PPN, that a kodi is twenty
--     pieces. It is put in front of the model with every question, so a
--     question is read the way the person asking it meant it. Head office
--     keeps it from the hub; the writes are ADMIN as `role_permission` rows
--     (0472), which can be changed like any other permission.

ALTER TABLE assistant_message
    ADD COLUMN verdict      text CHECK (verdict IN ('UP', 'DOWN')),
    ADD COLUMN verdict_note text CHECK (verdict_note IS NULL OR btrim(verdict_note) <> ''),
    ADD COLUMN verdict_at   timestamptz,
    ADD CONSTRAINT assistant_message_verdict_is_on_an_answer
        CHECK (verdict IS NULL OR role = 'assistant'),
    ADD CONSTRAINT assistant_message_note_needs_a_verdict
        CHECK (verdict_note IS NULL OR verdict IS NOT NULL),
    ADD CONSTRAINT assistant_message_verdict_is_dated
        CHECK ((verdict IS NULL) = (verdict_at IS NULL));

-- The answers somebody judged, newest first — what a review of the downs
-- reads, and nothing else does.
CREATE INDEX assistant_message_judged
    ON assistant_message (verdict_at DESC)
    WHERE verdict IS NOT NULL;

CREATE TABLE assistant_glossary (
    id      uuid PRIMARY KEY,
    -- As the business writes it: `C003`, `omzet`, `kodi`.
    term    text NOT NULL CHECK (btrim(term) <> '' AND char_length(term) <= 80),
    -- What it means here, in a sentence. Short because every entry is sent
    -- with every question.
    meaning text NOT NULL CHECK (btrim(meaning) <> '' AND char_length(meaning) <= 400),
    set_by  text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE assistant_glossary IS
    'The business''s own words and what they mean here, put in front of the assistant''s model with every question (0501).';

-- One meaning per word, however it is capitalised: `Omzet` and `omzet` are
-- the same question.
CREATE UNIQUE INDEX assistant_glossary_term
    ON assistant_glossary (lower(btrim(term)));

INSERT INTO role_permission (method, path_prefix, min_role, note, set_by) VALUES
    ('POST', '/api/v1/assistant/glossary', 'ADMIN',
     'The glossary is read with every question anybody asks, so head office keeps it.',
     'migration:0501'),
    ('PATCH', '/api/v1/assistant/glossary', 'ADMIN',
     'The glossary is read with every question anybody asks, so head office keeps it.',
     'migration:0501'),
    ('DELETE', '/api/v1/assistant/glossary', 'ADMIN',
     'The glossary is read with every question anybody asks, so head office keeps it.',
     'migration:0501')
ON CONFLICT (method, path_prefix) DO NOTHING;
