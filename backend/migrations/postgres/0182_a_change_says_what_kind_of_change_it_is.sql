-- 0182: A change says what kind of change it is.
--
-- UI-001 §6 fixes the vocabulary at four — Regular Price Change, Markdown,
-- Clearance, Correction — and **only two of them can be read off the rows**.
--
-- A book carrying `commercial_price_rule` and no markdowns is a regular price
-- change, and that reading cannot be wrong. A book carrying
-- `commercial_markdown` is a markdown change. But a clearance and an
-- end-of-season markdown are the *same rows*, and a correction and a re-price
-- are the *same rows*. The difference is what the person cutting the book
-- meant, and nothing has ever recorded it.
--
-- Reading the name for the word "clearance" is not a substitute. A book called
-- "Q3 Clearance" that carries base prices is a re-price; one called "September
-- update" carrying markdowns is a clearance. The name is a label somebody
-- typed, and deriving a business classification from it would be wrong exactly
-- when it mattered.
--
-- So the intent gets a column. Not a table: a change already exists as a
-- first-class immutable versioned thing — the publication — and a second row
-- beside it claiming to describe the same event would drift the first time
-- anybody published without going through whatever wrote the other one.
--
-- # Clearance shares markdown mechanics and stays a distinct classification
--
-- This column does NOT change how anything prices. A clearance is authored as
-- `commercial_markdown` rows and resolved by the same cascade, exactly as
-- before — UI-001 §6: "Clearance bukan pricing layer tambahan." What the column
-- adds is the ability to say which business programme a set of markdowns
-- belongs to, on a screen and in a report. The engine never reads it.
--
-- # Why nullable, and why that is temporary
--
-- Twenty-six books exist and none of them was authored with a type. Backfilling
-- a guess would put a business classification into the audit trail that nobody
-- decided, and every report built on it afterwards would be built on that
-- guess. NULL says "cut before this field existed", which is true and is the
-- only honest thing a migration can say about somebody else's intent.
--
-- New publications are required to carry one. That is enforced in the
-- application rather than by `NOT NULL`, because a NOT NULL column on a table
-- with twenty-six legacy rows needs a default, and a default is the guess this
-- comment just refused to make.

ALTER TABLE commercial_publication
    ADD COLUMN IF NOT EXISTS change_type TEXT
        CHECK (change_type IN
            ('REGULAR_PRICE', 'MARKDOWN', 'CLEARANCE', 'CORRECTION'));

COMMENT ON COLUMN commercial_publication.change_type IS
    'UI-001 §6 business classification. Authored intent, never derived from the '
    'rows: a clearance and an end-of-season markdown carry identical markdown '
    'rows. NULL means the book was cut before this column existed. The pricing '
    'engine never reads it.';

-- "Show me the clearances still running" is the question this column exists to
-- answer, and it is asked against the operational list — which is filtered on
-- outstanding work, so the type comes first and the window second.
CREATE INDEX IF NOT EXISTS ix_publication_change_type
    ON commercial_publication (change_type, effective_from DESC)
    WHERE change_type IS NOT NULL;
