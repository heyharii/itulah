-- A letter is issued once, and keeps its number.
--
-- The company's paperwork: a goods receipt note the warehouse signs when a
-- supplier's delivery is accepted (surat terima barang), and a delivery note
-- that travels with the goods from the DC to a shop (surat jalan). Asked for
-- by the owner on 2026-09-13: "kita mau ada menu surat, misal surat terima
-- barang, dan surat2 yg lain".
--
-- # A letter is not the record it was drawn from
--
-- Every figure on these letters already exists — `purchase_receipt` says what
-- the DC counted, `allotment_line` says what is being sent where. So the
-- obvious design is to render them on demand and store nothing.
--
-- That is wrong for one reason: a letter is signed. Somebody at a counter puts
-- their name on a piece of paper saying these boxes arrived on this date, and
-- that piece of paper then has an existence of its own. It has a number that
-- an auditor will look for, a date that is the date it was ISSUED rather than
-- the date the goods moved, and words a person wrote on it. Rendering it from
-- the record means the paper in the file and the screen disagree the moment
-- somebody adds a receipt to the same delivery — and the one everybody trusts
-- is the one with the signature on it.
--
-- So what a letter says is FROZEN into it when it is issued: `lines` and
-- `facts` are copies, not joins. The record stays the record; the letter is
-- evidence of what was said at a moment.
--
-- # Draft, issued, void — and why a number is not handed out early
--
-- A number is the scarce thing here. `STB/2609/0001` is what somebody writes
-- in a book and quotes on the telephone, so the rule is the ordinary one from
-- every office: a document gets its number when it is issued, not when
-- somebody starts typing. A draft that is abandoned costs nothing; a number
-- that is abandoned is a hole in the book that somebody has to explain.
--
-- Issuing therefore does two things in ONE transaction — take the next number
-- and stamp the letter — so a failure loses both together and the series stays
-- gapless. `letter_number_counter` is a row per (kind, period); the UPDATE
-- takes its lock, which is what serialises two people issuing at the same
-- second.
--
-- A letter is never edited after issue and never deleted. It is VOIDED, with
-- a reason, and its number stays spent: the copy that was printed is already
-- in somebody's file, and a number that quietly comes back into circulation
-- is how two different documents end up claiming to be STB/2609/0004.

CREATE TABLE letter (
    letter_id     uuid PRIMARY KEY,
    -- What kind of letter. Widened by a migration, deliberately: each kind
    -- needs a template, a number prefix and somebody who decided the wording,
    -- and none of those arrive by an INSERT nobody reviewed.
    kind          text NOT NULL CHECK (kind IN ('GOODS_RECEIPT', 'DELIVERY_NOTE')),
    status        text NOT NULL CHECK (status IN ('DRAFT', 'ISSUED', 'VOID')),
    -- `NULL` until issued. Unique per kind, and NULLs do not collide in
    -- Postgres, so drafts do not fight each other for the constraint.
    letter_number text CHECK (letter_number IS NULL OR btrim(letter_number) <> ''),
    -- `YYMM`, the series the number was drawn from. Stored rather than parsed
    -- back out of the number: the number's shape is a formatting decision and
    -- the series it belongs to is a fact.
    period        text,

    -- The record it was drawn from. `(kind, id)` in the one vocabulary — see
    -- `record_kind` — so the letter shows up in that record's own history.
    subject_kind  text NOT NULL REFERENCES record_kind(code),
    subject_id    text NOT NULL CHECK (btrim(subject_id) <> ''),

    -- What the letter SAYS, frozen at issue. `facts` is the head of the
    -- document — who it is from, who it is to, which order or allotment it
    -- answers; `lines` is the table of goods; `body` is the editor's document,
    -- which is the only part a person writes.
    facts         jsonb NOT NULL DEFAULT '{}'::jsonb,
    lines         jsonb NOT NULL DEFAULT '[]'::jsonb,
    body          jsonb NOT NULL DEFAULT '{}'::jsonb,
    title         text NOT NULL CHECK (btrim(title) <> ''),

    created_by    text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    issued_by     text,
    issued_at     timestamptz,
    voided_by     text,
    voided_at     timestamptz,
    void_reason   text,

    -- A draft has no number and no issue date; anything that has been issued
    -- has both, and keeps them after it is voided.
    CHECK (
        (status = 'DRAFT'
            AND letter_number IS NULL AND period IS NULL
            AND issued_at IS NULL AND issued_by IS NULL)
        OR (status IN ('ISSUED', 'VOID')
            AND letter_number IS NOT NULL AND period IS NOT NULL
            AND issued_at IS NOT NULL AND issued_by IS NOT NULL)
    ),
    CHECK ((status = 'VOID') = (voided_at IS NOT NULL)),
    CHECK ((voided_at IS NULL) = (voided_by IS NULL)),
    UNIQUE (kind, letter_number)
);

-- One live letter per record per kind. A delivery with two goods receipt
-- notes against it is two people having counted the same boxes, and the
-- warehouse cannot tell which one the supplier is holding. A VOIDED one does
-- not stand in the way: voiding is exactly how somebody gets to write another.
CREATE UNIQUE INDEX ux_letter_live_subject
    ON letter (kind, subject_kind, subject_id)
    WHERE status <> 'VOID';

CREATE INDEX ix_letter_issued ON letter (kind, issued_at DESC);
CREATE INDEX ix_letter_subject ON letter (subject_kind, subject_id);

COMMENT ON TABLE letter IS
    'Letters somebody signs: goods receipt notes and delivery notes. What a '
    'letter says is frozen into it at issue — `lines` and `facts` are copies '
    'of the record, not joins to it.';

-- The book of numbers. One row per series, and the row IS the lock: two
-- transactions issuing into the same month queue on it, which is what keeps
-- `STB/2609/0004` from being handed out twice.
CREATE TABLE letter_number_counter (
    kind        text NOT NULL,
    period      text NOT NULL CHECK (period ~ '^[0-9]{4}$'),
    next_number bigint NOT NULL CHECK (next_number > 0),
    PRIMARY KEY (kind, period)
);

COMMENT ON TABLE letter_number_counter IS
    'Next number per (kind, period). Allocated in the same transaction that '
    'issues the letter, so a rollback returns the number rather than burning '
    'it.';

-- The vocabulary widens by one. Written as its own statement in its own file,
-- which is the only way a kind may be added once 0190 has been applied:
-- editing a migration that has run is a checksum mismatch and a node that will
-- not start. `migration_hygiene` compares these rows against `RecordKind`.
INSERT INTO record_kind (code, label) VALUES
    ('letter', 'Letter');
