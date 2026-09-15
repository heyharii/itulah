-- A correction is a document somebody signed, not a journal somebody typed.
--
-- Until now there were exactly two ways to correct the books: reverse an entry,
-- or write a MANUAL journal. Reversal is right when an entry should never have
-- existed. A manual journal is what everything else became — moving a cost to
-- the account it should have hit, admitting a stock difference, giving up on a
-- balance — and it records the debit, the credit, and nothing at all about WHY,
-- WHO decided, or WHO agreed. Six months later the memo field is the only
-- evidence, and it says "koreksi".
--
-- So the three corrections that actually happen become documents with a
-- lifecycle, and the journal becomes their consequence rather than their
-- substitute.
--
--   RECLASS      an amount is in the wrong account; move it. Names the journal
--                line it came off, so the correction can be read against the
--                thing it corrects rather than searched for by amount.
--   ADJUSTMENT   a difference nobody is going to recover: stock short at a
--                count, cash over or short at a shift. Names the evidence.
--   WRITE_OFF    a receivable or payable balance given up on.
--
-- # Why one table and not three
--
-- 0096 warns that two documents behind one `source_kind` means an entry whose
-- source cannot be resolved without guessing which table to look in. That rule
-- is kept: each kind here maps to exactly one `source_kind`, and every one of
-- them resolves to THIS table. What the three share is the entire lifecycle —
-- draft, a second person's approval, posting, reversal — and three copies of it
-- would be three places for the maker-checker rule to drift.
--
-- # Why the approver is checked by the database
--
-- `CHECK (approved_by <> created_by)`. A control one person can complete alone
-- is a record of a signature rather than a control. The same rule the client's
-- own goods receipt keeps between `counted_by` and `verified_by`, and the same
-- one the payroll run keeps between verify and approve — written where an
-- application bug cannot get around it.
--
-- # What is NOT here
--
-- No account codes. A reclassification names a semantic key and a location and
-- lets `account_map` resolve it, exactly as a posting rule does; the account it
-- moves FROM is copied off the original journal line rather than resolved
-- afresh, for the reason `poster::reverse` gives — a map that has moved since
-- would send the correction somewhere the original never touched, and both
-- accounts would then be wrong by the same amount while the trial balance still
-- balanced.

CREATE SEQUENCE correction_document_number_seq;

CREATE TABLE correction_document (
    correction_id   uuid PRIMARY KEY,
    -- `COR-00000001`. Ours; gaps are possible and harmless, as with
    -- `journal_entry_number` and `payment_number`.
    document_number text NOT NULL UNIQUE CHECK (btrim(document_number) <> ''),

    kind            text NOT NULL CHECK (kind IN ('RECLASS', 'ADJUSTMENT', 'WRITE_OFF')),

    -- Where this correction belongs. The client keeps a profit and loss per
    -- location, so a correction with no location could not be posted at all.
    site_id         text NOT NULL REFERENCES site(id),
    -- The date it lands in the books. Gated against a closed month by the
    -- trigger at the foot of this file.
    document_date   date NOT NULL,

    currency        char(3) NOT NULL,
    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),

    -- Mandatory, and the point of the document. A correction with no reason is
    -- the manual journal this table exists to replace.
    reason          text NOT NULL CHECK (btrim(reason) <> ''),

    -- ── RECLASS ──────────────────────────────────────────────────────────
    -- The line the amount is coming off. A reference to the journal rather
    -- than a copy of its account code: the code is read at posting time from
    -- the line itself.
    source_line_id  uuid REFERENCES journal_line(line_id),
    -- Where it is going, said the only way this system says it.
    target_key       text,
    target_qualifier text NOT NULL DEFAULT '',
    target_site_id   text REFERENCES site(id),

    -- ── ADJUSTMENT ───────────────────────────────────────────────────────
    -- STOCK_LOSS       stock short against a count
    -- CASH_OVER_SHORT  a till that did not add up
    -- OTHER            anything else, and it has to be explained in `reason`
    adjustment_kind text CHECK (adjustment_kind IN ('STOCK_LOSS', 'CASH_OVER_SHORT', 'OTHER')),
    -- Which way it fell. `amount_minor` is always positive — a negative amount
    -- is a posting waiting to be made backwards — so the direction is its own
    -- word. A till 50,000 short and a till 50,000 over are the same amount and
    -- opposite entries, and a single signed column would let a typed minus sign
    -- decide which.
    direction       text CHECK (direction IN ('LOSS', 'GAIN')),
    -- What was counted or which shift. Free text with a kind beside it rather
    -- than a foreign key, because a count lives in one table and a shift in
    -- another and a nullable key to each would be two columns that must not
    -- both be set.
    evidence_kind   text CHECK (evidence_kind IN ('COUNT', 'SHIFT', 'OTHER')),
    evidence_ref    text,

    -- ── WRITE_OFF ────────────────────────────────────────────────────────
    balance_side      text CHECK (balance_side IN ('RECEIVABLE', 'PAYABLE')),
    -- Which balance, as a meaning: `trade_payable`, `card_receivable_debit`,
    -- `affiliate_receivable`.
    balance_key       text,
    balance_qualifier text NOT NULL DEFAULT '',
    -- Who owed it or was owed it, and which document. Text because the
    -- counterparty may be a supplier we know, a customer we do not, or an
    -- acquirer.
    counterparty      text,
    balance_ref       text,

    -- ── lifecycle ────────────────────────────────────────────────────────
    -- DRAFT      written, not agreed
    -- APPROVED   a second person agreed; may be posted
    -- POSTED     in the ledger
    -- REVERSED   posted, and then undone by a mirror entry
    status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'REVERSED')),

    journal_entry_id  uuid REFERENCES journal_entry(entry_id),
    reversal_entry_id uuid REFERENCES journal_entry(entry_id),

    created_by      text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at      timestamptz NOT NULL DEFAULT now(),
    approved_by     text,
    approved_at     timestamptz,
    posted_by       text,
    posted_at       timestamptz,
    reversed_by     text,
    reversed_at     timestamptz,
    note            text,

    -- Each kind carries exactly its own fields, so a WRITE_OFF cannot arrive
    -- carrying a reclassification target that the posting rule would ignore.
    CHECK ((kind = 'RECLASS') = (source_line_id IS NOT NULL)),
    CHECK ((kind = 'RECLASS') = (target_key IS NOT NULL)),
    CHECK ((kind = 'RECLASS') = (target_site_id IS NOT NULL)),
    CHECK ((kind = 'ADJUSTMENT') = (adjustment_kind IS NOT NULL)),
    CHECK ((kind = 'ADJUSTMENT') = (direction IS NOT NULL)),
    CHECK ((kind = 'WRITE_OFF') = (balance_side IS NOT NULL)),
    CHECK ((kind = 'WRITE_OFF') = (balance_key IS NOT NULL)),

    -- The control. See the header.
    CHECK (approved_by IS NULL OR approved_by <> created_by),

    CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
    CHECK ((posted_at IS NULL) = (posted_by IS NULL)),
    CHECK ((reversed_at IS NULL) = (reversed_by IS NULL)),
    -- Approved and posted and reversed are each the same fact twice, so they
    -- cannot disagree.
    CHECK ((status IN ('APPROVED', 'POSTED', 'REVERSED')) = (approved_at IS NOT NULL)),
    CHECK ((status IN ('POSTED', 'REVERSED')) = (journal_entry_id IS NOT NULL)),
    CHECK ((status IN ('POSTED', 'REVERSED')) = (posted_at IS NOT NULL)),
    CHECK ((status = 'REVERSED') = (reversal_entry_id IS NOT NULL)),
    CHECK ((status = 'REVERSED') = (reversed_at IS NOT NULL))
);

CREATE INDEX ix_correction_document_status ON correction_document (status, document_date DESC);
CREATE INDEX ix_correction_document_site ON correction_document (site_id, document_date DESC);
CREATE INDEX ix_correction_document_kind ON correction_document (kind, document_date DESC);
-- A reclassification is read from the line it corrects at least as often as
-- from its own list.
CREATE INDEX ix_correction_document_source_line ON correction_document (source_line_id)
    WHERE source_line_id IS NOT NULL;

-- A correction dated in a closed month may not enter or leave the books, for
-- the reason 0127 gives about every other dated document.
CREATE TRIGGER correction_document_period_lock
    BEFORE INSERT OR UPDATE ON correction_document
    FOR EACH ROW EXECUTE FUNCTION
        assert_period_open_on_document('document_date', 'status', 'POSTED', 'REVERSED');

COMMENT ON TABLE correction_document IS
    'Reclassifications, adjustments and write-offs as documents: reason, maker, checker, and the journal entry they caused. The alternative was a MANUAL entry whose only explanation was its memo.';
COMMENT ON COLUMN correction_document.approved_by IS
    'The second person. Constrained to differ from created_by, because a control one person completes alone is not a control.';
COMMENT ON COLUMN correction_document.source_line_id IS
    'The journal line a reclassification moves an amount off. The account it credits back is read from this line, never resolved afresh through account_map.';
