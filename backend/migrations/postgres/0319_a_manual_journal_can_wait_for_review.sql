-- A Finance journal is a document before it is a ledger entry.
--
-- Finance can save and review manual entries and source-owned accounting
-- events first. Only the explicit Submit action calls the single journal
-- poster; the source id makes source-driven submit idempotent.
CREATE TABLE finance_journal_draft (
    draft_id        uuid PRIMARY KEY,
    posting_date    date NOT NULL,
    currency        text NOT NULL DEFAULT 'IDR' CHECK (currency ~ '^[A-Z]{3}$'),
    memo            text,
    lines           jsonb NOT NULL DEFAULT '[]'::jsonb
                    CHECK (jsonb_typeof(lines) = 'array'),
    source_kind     text NOT NULL DEFAULT 'MANUAL'
                    CHECK (source_kind IN ('MANUAL', 'PAYROLL_RUN')),
    source_id       text,
    purpose         text NOT NULL DEFAULT 'MAIN'
                    CHECK (purpose ~ '^[A-Z][A-Z0-9_]*$'),
    status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
    posted_entry_id uuid UNIQUE REFERENCES journal_entry(entry_id),
    created_by      text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    submitted_by    text,
    submitted_at    timestamptz,
    cancelled_by    text,
    cancelled_at    timestamptz,
    cancellation_reason text,
    CHECK ((source_kind = 'MANUAL') = (source_id IS NULL)),
    CHECK ((status = 'POSTED') = (posted_entry_id IS NOT NULL)),
    CHECK ((status = 'POSTED') = (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
    CHECK ((status = 'CANCELLED') = (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)),
    CHECK ((status = 'CANCELLED') = (cancellation_reason IS NOT NULL))
);

CREATE INDEX ix_finance_journal_draft_status_updated
    ON finance_journal_draft (status, updated_at DESC);

CREATE UNIQUE INDEX ux_finance_journal_draft_source
    ON finance_journal_draft (source_kind, source_id, purpose)
    WHERE source_id IS NOT NULL;

COMMENT ON TABLE finance_journal_draft IS
    'Reviewable Finance journal document, including manual entries and payroll accruals. A draft has no general-ledger effect; Submit posts through poster::post in the same transaction that marks this row POSTED.';
