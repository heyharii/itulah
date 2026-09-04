-- A report is a definition, not a result.
--
-- The assistant can compose one from a sentence, but what gets kept is never
-- the rows it produced and never the SQL it implied: it is a spec naming a
-- dataset, its filters, its grouping and how it should be drawn. Rows go stale
-- by the afternoon; SQL goes wrong silently the week a column is renamed. A
-- spec is re-validated against the catalogue every time it runs, so a report
-- whose dataset moved underneath it says so instead of answering wrongly.
--
-- This is the same discipline `commercial_publication` already applies to
-- prices: publish an immutable version, let readers point at it, and keep the
-- old ones so last month's numbers can still be explained.

CREATE TABLE report (
    report_id       uuid PRIMARY KEY,
    name            text NOT NULL,
    -- Who may edit it. Sharing widens who may read it, never who may write.
    --
    -- Text rather than a foreign key to `app_user`, like `created_by`
    -- everywhere else in this schema: a report outlives the account that wrote
    -- it, and a node running without authentication has a truthful actor that
    -- is not a row in that table.
    owner_username  text NOT NULL,
    shared          boolean NOT NULL DEFAULT false,
    current_version integer NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    archived_at     timestamptz
);

CREATE INDEX report_by_owner ON report (owner_username) WHERE archived_at IS NULL;
CREATE INDEX report_shared ON report (shared) WHERE shared AND archived_at IS NULL;

-- A version is written once and never updated. Editing a report appends the
-- next one and moves `report.current_version`, which is what makes "why does
-- last month's figure differ" a question with an answer.
CREATE TABLE report_version (
    report_id         uuid NOT NULL REFERENCES report (report_id) ON DELETE CASCADE,
    version           integer NOT NULL,
    spec              jsonb NOT NULL,
    -- The catalogue this spec was validated against. A spec written for an
    -- older catalogue is not automatically wrong, but it is not automatically
    -- right either, and this is what lets the difference be noticed.
    catalogue_version integer NOT NULL,
    authored_by       text NOT NULL,
    -- How this version came to exist. The sentence somebody typed is the best
    -- explanation of what the report is *for* that will ever be written down,
    -- and it is null exactly when a human edited the spec by hand instead.
    prompt            text,
    model             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (report_id, version)
);

-- The current version must exist. Without this a report can point at a version
-- that was never written, and the failure surfaces as an empty screen rather
-- than as the broken write it actually is.
ALTER TABLE report
    ADD CONSTRAINT report_current_version_exists
    FOREIGN KEY (report_id, current_version)
    REFERENCES report_version (report_id, version)
    DEFERRABLE INITIALLY DEFERRED;
