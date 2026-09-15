-- 0142: A statement can arrive on its own.
--
-- # The hole
--
-- 0071 gave the books a bank statement, lines with a fingerprint, and a matcher
-- that scores each line against the ledger. 0095 gave the unmatched line a way
-- to become an entry. What none of them gave is a way for a statement to GET
-- here. `POST /api/v1/finance/bank-statements` takes JSON — an account, a
-- window, an opening and closing figure, and a list of lines — so somebody has
-- to open the file the bank sent, read it, and retype it into a shape no bank
-- has ever emitted. In practice that means the import is done once, by whoever
-- built it, and then never again.
--
-- The reference implementation in `~/Documents/retail` solved this with a mail
-- gateway: the bank emails a report to a dedicated mailbox, a poller reads the
-- mailbox, a rule says which account that sender's attachment belongs to, a
-- parser turns the attachment into lines, and a log makes sure the same
-- attachment is never ingested twice. This migration is the two tables that
-- pipeline needs. Everything else it needs already exists.
--
-- # Why the rule is a row and not a config file
--
-- Because the person who knows that BCA sends `ReportMerchant*.xlsx` from
-- `no-reply@klikbca.co.id` to the giro account ending 4471 is a finance clerk,
-- not whoever can restart the process. A rule in the environment is a rule
-- nobody can change without a deploy, and a mapping that cannot be changed is
-- a mapping that will be wrong the first time a bank renames a column.
--
-- # Why the log is keyed on a dedup key and not on the message id
--
-- Because half the ways a file reaches us have no message id. A file dropped
-- into a watched directory by a forwarding rule, a file saved out of somebody's
-- mail client, a file re-sent by the bank under a new id — all of them are the
-- same statement. So the key is the message id when there is one and the hash
-- of the bytes when there is not, and either way it is per attachment, because
-- one email routinely carries a report per account.
--
-- That is belt to `bank_statement_line`'s braces, which already refuses a
-- duplicate line by fingerprint. The two do different jobs: the fingerprint
-- stops a line being counted twice, and this stops the SAME FILE being opened,
-- parsed, archived and reported twice. Without it, every poll of a mailbox
-- that keeps its mail would report thirty new statements with nought lines in
-- them, which is technically correct and completely useless to read.

CREATE TABLE bank_statement_source (
    source_id     uuid PRIMARY KEY,
    -- What a person calls it in the list: "BCA giro — laporan harian".
    label         text NOT NULL,
    enabled       boolean NOT NULL DEFAULT true,

    -- Where an ingested statement lands. Same shape and the same composite
    -- foreign key as `bank_statement`, so a rule cannot point at an account
    -- nobody keeps, nor at a group heading.
    account_code  text NOT NULL,
    is_group      boolean NOT NULL DEFAULT false CHECK (is_group = false),
    site_id       text NOT NULL REFERENCES site(id),

    -- The three patterns, all optional, all ANDed, an empty one matching
    -- anything. A sender alone is usually enough; a filename pattern is what
    -- separates two accounts reported by one bank in one email.
    --
    -- `from_pattern` and `subject_pattern` are matched as a case-insensitive
    -- substring, `filename_pattern` as a glob, because that is how the shapes
    -- differ: a sender is a fragment of an address, a filename is a shape with
    -- a date in the middle of it.
    from_pattern     text NOT NULL DEFAULT '',
    subject_pattern  text NOT NULL DEFAULT '',
    filename_pattern text NOT NULL DEFAULT '',

    -- Which parser reads the attachment. Constrained here rather than in the
    -- application because an unknown format is not a runtime surprise worth
    -- discovering at three in the morning when the mailbox fills up.
    format        text NOT NULL CHECK (format IN ('CSV', 'XLSX', 'PDF_TEXT')),

    -- How that parser finds the columns: delimiter, header row, which column
    -- is the value date, which is the debit, how the numbers are punctuated.
    -- Free-form on purpose — the three parsers want overlapping but not
    -- identical settings, and pinning a column layout into DDL means a
    -- migration every time a bank moves a column one to the right.
    settings      jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- The first rule that matches wins, so order is a decision and not an
    -- accident of insertion. Lower sorts first.
    priority      integer NOT NULL DEFAULT 100,

    created_by    text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (account_code, is_group)
        REFERENCES ledger_account (account_code, is_group)
);
CREATE INDEX ix_bank_statement_source_live
    ON bank_statement_source (priority, created_at)
    WHERE enabled;

CREATE TABLE bank_statement_intake (
    -- The message id and filename when the message had one, otherwise a hash
    -- of the bytes and the filename. See the note at the top.
    dedup_key     text PRIMARY KEY,

    -- Null when nothing matched: the row still exists, because "an email
    -- arrived and no rule wanted it" is the single most useful thing this
    -- table can tell somebody setting a rule up.
    source_id     uuid REFERENCES bank_statement_source(source_id) ON DELETE SET NULL,

    message_id    text NOT NULL DEFAULT '',
    sender        text NOT NULL DEFAULT '',
    subject       text NOT NULL DEFAULT '',
    filename      text NOT NULL,
    byte_count    bigint NOT NULL DEFAULT 0,

    -- The statement this became, when it became one. Kept as a plain uuid
    -- rather than a cascading foreign key so that deleting a statement does
    -- not delete the record that it was once ingested — which would let the
    -- next poll ingest the very same file again.
    statement_id  uuid,

    -- ingested | skipped_no_match | unparsed | parse_error | import_error
    --
    -- `unparsed` is its own state rather than an error: a rule matched, the
    -- file was archived, and no parser could read it. That is a file worth
    -- keeping and a mapping worth fixing, not a failure to alert on.
    status        text NOT NULL CHECK (status IN (
                      'ingested', 'skipped_no_match', 'unparsed',
                      'parse_error', 'import_error')),
    line_count    integer NOT NULL DEFAULT 0,
    duplicate_count integer NOT NULL DEFAULT 0,
    -- The parser's complaint, or the importer's. Truncated by the caller;
    -- a stack of them is a log, not a column.
    detail        text NOT NULL DEFAULT '',

    -- Where the raw bytes were archived, when an attachment store is
    -- configured. The audit trail: what the bank actually sent, byte for byte,
    -- next to what we made of it.
    object_key    text NOT NULL DEFAULT '',

    seen_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_bank_statement_intake_recent ON bank_statement_intake (seen_at DESC);
CREATE INDEX ix_bank_statement_intake_source ON bank_statement_intake (source_id, seen_at DESC);
