-- 0075: A drawer for documents, modelled on midday's Vault.
--
-- # Why this is not `stored_file`
--
-- 0040 gave us attachments: bytes reached only through the conversation or
-- post that carries them, deliberately with no id anyone can link to, so that
-- a link cannot leave the room it was posted in. That is the right model for
-- correspondence and the wrong one for a filing cabinet.
--
-- A document is the opposite by design: it is a thing in its own right, filed,
-- searched, tagged and pointed at. So this does not replace `stored_file` —
-- it sits on top of it. The bytes, the hash, the OBJECT/DATABASE split and the
-- `available` flag all stay where they are and keep working for chat; a
-- document adds the filing to a file that has one.

CREATE TABLE document (
    document_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The bytes. RESTRICT rather than CASCADE: deleting the file out from
    -- under a filed document should be refused, not silently take the filing
    -- with it.
    file_id      uuid NOT NULL REFERENCES stored_file(file_id) ON DELETE RESTRICT,

    name         text NOT NULL CHECK (btrim(name) <> ''),
    title        text,
    -- Midday's `pathTokens`: the folder path as an array rather than a string,
    -- so a query can match a prefix without parsing separators, and a folder
    -- whose name contains a slash is not a bug waiting to happen.
    path_tokens  text[] NOT NULL DEFAULT '{}',
    parent_id    uuid REFERENCES document(document_id) ON DELETE SET NULL,

    -- Filled by the extraction agent, not by the uploader.
    summary      text,
    content      text,
    doc_date     date,
    language     text NOT NULL DEFAULT 'indonesian'
                 CHECK (language IN ('indonesian', 'english', 'simple')),
    processing_status text NOT NULL DEFAULT 'PENDING'
                 CHECK (processing_status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),

    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    uploaded_by  text NOT NULL CHECK (btrim(uploaded_by) <> ''),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    -- Two configurations, both always populated. NOT one column switched by
    -- `language`: a generated column may not read another column to choose its
    -- own text search configuration, because `to_tsvector` is only immutable
    -- when that configuration is a literal. Midday carries three columns for
    -- the same reason.
    --
    -- Weights say what a match is worth: the title is what somebody named the
    -- thing, the body is what happened to be inside it.
    fts_id tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('indonesian', coalesce(title, name)), 'A') ||
        setweight(to_tsvector('indonesian', coalesce(summary, '')), 'C') ||
        setweight(to_tsvector('indonesian', coalesce(content, '')), 'D')
    ) STORED,
    fts_en tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, name)), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'D')
    ) STORED
);

CREATE INDEX ix_document_fts_id ON document USING gin (fts_id);
CREATE INDEX ix_document_fts_en ON document USING gin (fts_en);
CREATE INDEX ix_document_created ON document (created_at DESC);
CREATE INDEX ix_document_date ON document (doc_date);
CREATE INDEX ix_document_path ON document USING gin (path_tokens);
-- Fuzzy on the name, for the half-remembered filename. `pg_trgm` is already
-- available on this server; the extension is created here rather than assumed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ix_document_name_trgm ON document USING gin (name gin_trgm_ops);

-- # Tags
--
-- Midday keeps a per-team tag table. We already have a company-wide vocabulary
-- in `tag` (0027, extended 0041) and the garment tags a buyer filters the
-- catalogue by. Reusing it means a supplier's invoice and the items it invoices
-- are findable by the same word, which is the whole point of having a
-- vocabulary rather than free text.
CREATE TABLE document_tag (
    document_id uuid NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
    tag_code    text NOT NULL REFERENCES tag(code) ON DELETE RESTRICT,
    PRIMARY KEY (document_id, tag_code)
);
CREATE INDEX ix_document_tag_code ON document_tag (tag_code);

-- # What a document is about
--
-- Midday's Vault has no equivalent, and it is the part worth more to us than
-- anything else here: an invoice that knows which order it belongs to. One row
-- per link, so a delivery note may name both the order and the receipt.
CREATE TABLE document_link (
    document_id uuid NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
    -- What kind of thing, and which one. Not a foreign key per subject type:
    -- that would need a nullable column per kind and a check constraint that
    -- grows every time something new becomes attachable.
    subject_kind text NOT NULL CHECK (subject_kind IN
        ('PURCHASE_ORDER','SUPPLIER','GOODS_RECEIPT','ARTICLE','SUPPLIER_ITEM')),
    subject_id   text NOT NULL CHECK (btrim(subject_id) <> ''),
    PRIMARY KEY (document_id, subject_kind, subject_id)
);
CREATE INDEX ix_document_link_subject ON document_link (subject_kind, subject_id);
