-- 0136: Keep the report somebody curated from, not only what they concluded.
--
-- 0135 records a judgement: these lines, this MDR, this net. The evidence it was
-- read from is a CSV in an email, and an email is not a record this system
-- holds. So when the bank pays 40,000 less than the settlement says and
-- somebody asks whether the report itself was wrong, there is nothing to look
-- at — only the reading of it.
--
-- This keeps the reading's source beside its conclusion. Stored as the text
-- that was uploaded or pasted, verbatim, including whatever the acquirer's own
-- exporter did to it: an amount written as "1.250.000,00", a date as
-- "25/07/2026", a trailing summary row that is not a line at all. Normalising
-- on the way in would destroy the one thing this table is for, which is being
-- able to say later what actually arrived.
--
-- # Why the parse is not stored beside it
--
-- Because it is a pure function of the text. `domain::settlement_report`
-- parses the same bytes into the same rows every time, so a stored copy could
-- only ever disagree with it — and it would, the first time somebody fixes the
-- parser's handling of a thousands separator. What IS stored is `row_count`,
-- which is what the parser said the day it ran; a re-parse that now finds a
-- different number is the parser having changed its mind, and that is worth
-- seeing.
--
-- # Why the whole file and not a link to one
--
-- There is an attachment store in this system, and it is the wrong home for
-- this. An acquirer's daily settlement report is a few kilobytes of digits with
-- no viewer, no thumbnail and no reason to be fetched by a browser on its own;
-- it is read once, by the code below, at the moment of curation. A row is
-- cheaper than a file, and it cannot be orphaned by a bucket that was rotated.
-- A report large enough for that argument to fail is a report that is not a
-- daily settlement.
--
-- An email-ingest hook — a mailbox this watches, so the CSV never passes
-- through a person at all — is deliberately not here. It is a second way in,
-- with its own authentication and its own failure mode, and it should be built
-- against a curation flow that has been used rather than one that has not.

CREATE TABLE acquirer_settlement_report (
    report_id     uuid PRIMARY KEY,
    settlement_id uuid NOT NULL
                  REFERENCES acquirer_settlement(settlement_id) ON DELETE CASCADE,

    -- What it was called, when it came from a file. Null when somebody pasted.
    source_name   text,
    -- The bytes, as they arrived.
    raw           text NOT NULL,
    -- What the parser made of them at upload. Evidence about the parser, not
    -- about the report — see the header.
    row_count     integer NOT NULL CHECK (row_count >= 0),
    -- Lines the parser could not read. Zero is the normal answer and a nonzero
    -- one is a question for the person curating, which is why it is a column
    -- and not a log line.
    rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),

    uploaded_by   text NOT NULL,
    uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_acq_settlement_report_settlement
    ON acquirer_settlement_report (settlement_id);

COMMENT ON TABLE acquirer_settlement_report IS
    'The acquirer''s own report, verbatim, beside the curation read from it. Parsed on demand by domain::settlement_report; only the counts are stored.';
