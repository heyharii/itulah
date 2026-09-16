-- A prepayment is used up a month at a time, and something has to hold the plan.
--
-- # What exists today, and what does not
--
-- A bill can already be FOR a prepayment: 0094 let a supplier invoice name a
-- class-1 account, and `prepaid_expense` is mapped at all fourteen places, so
-- `Dr 1011301001 Asuransi Bayar Dimuka / Cr Hutang Supplier` posts perfectly
-- well today. What does not exist is the other half — nothing ever takes it
-- back out. Insurance bought for a year sits in the asset for ever, the months
-- it belongs to carry no expense, and the only way to fix it is a hand-written
-- journal into an account whose policy is `OVERRIDE` for exactly that reason.
--
-- So the missing thing is not a posting rule, it is a SUBLEDGER: the plan, the
-- months it covers, what has been taken out so far, and what is left.
--
-- # The shape, and why it is this shape
--
-- Two tables. A schedule is the plan; an allocation is one month of it actually
-- posted, and it carries the journal entry it made. That split is what makes
-- replay safe — `UNIQUE (schedule_id, period_year, period_month)` means the
-- same month cannot be allocated twice however many times a run is repeated —
-- and it is what makes the remaining balance a FACT rather than a guess:
-- `amount_minor - sum(allocations)`, both sides in the same table.
--
-- The schedule does NOT post the opening debit. The bill already did, and one
-- economic event with two writers is the defect 0273 spent a migration undoing.
-- A schedule attaches to a source that has already posted, names it by
-- `(source_kind, source_id)` — the same pair the journal carries — and from
-- then on only ever credits what that source debited.
--
-- # What is deliberately refused
--
--   * The prepaid account must be one somebody mapped `prepaid_expense` to at
--     that place. That is the rule that keeps TAX out: `1011302*` is
--     `Prepaid - PPh/VAT/PBB`, a tax credit and not a prepayment, and it is
--     reclaimed against a tax return rather than amortised over months. Tax is
--     its own domain and mapping it here would quietly make it this one's.
--   * The expense account must be a real posting account, and not the prepaid
--     account itself.
--   * A cancelled schedule keeps every allocation it already made. Cancelling
--     is not undoing: what was consumed was consumed, and the correction for a
--     posting is a reversal, which the poster already knows how to make.
--
-- # Rounding
--
-- Deterministic and stated here rather than left to whoever writes the run:
-- the amount is divided by the number of months, and the remainder goes to the
-- EARLIEST months, one rupiah each, so the allocations sum to the amount
-- exactly and a schedule can never end owing itself a rupiah. `prepaid.rs`
-- implements it and a test asserts the total.

CREATE TABLE IF NOT EXISTS prepaid_schedule (
    schedule_id       uuid PRIMARY KEY,
    -- Human reference, minted in order. Finance reads these out loud.
    schedule_number   text NOT NULL UNIQUE CHECK (btrim(schedule_number) <> ''),

    -- Whose books. A prepayment belongs to the unit that will consume it, and
    -- both legs of every allocation land there.
    site_id           text NOT NULL REFERENCES site(id),

    -- What was debited, and where each month goes. `is_group = false` is
    -- carried in the foreign key rather than checked in Rust: a heading takes
    -- no postings and this is where the schema already says so.
    prepaid_account_code  text NOT NULL,
    prepaid_is_group      boolean NOT NULL DEFAULT false CHECK (prepaid_is_group = false),
    expense_account_code  text NOT NULL,
    expense_is_group      boolean NOT NULL DEFAULT false CHECK (expense_is_group = false),

    -- The document that put the money there, named the way the journal names
    -- it. Typed as the pair rather than as a loose note, so a schedule can be
    -- traced back to its bill and a bill forward to its schedule.
    source_kind       text NOT NULL CHECK (btrim(source_kind) <> ''),
    source_id         text NOT NULL CHECK (btrim(source_id) <> ''),

    currency          char(3) NOT NULL DEFAULT 'IDR',
    amount_minor      bigint NOT NULL CHECK (amount_minor > 0),

    -- Both are the FIRST of a month; the schedule covers every month from the
    -- first to the last inclusive. Monthly is the only frequency the client
    -- has, and the column exists so a quarterly one does not arrive as a
    -- second table.
    start_period      date NOT NULL,
    end_period        date NOT NULL,
    frequency         text NOT NULL DEFAULT 'MONTHLY' CHECK (frequency = 'MONTHLY'),

    status            text NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    memo              text,

    created_by        text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at        timestamptz NOT NULL DEFAULT now(),
    cancelled_by      text,
    cancelled_at      timestamptz,
    cancel_reason     text,

    FOREIGN KEY (prepaid_account_code, prepaid_is_group)
        REFERENCES ledger_account (account_code, is_group),
    FOREIGN KEY (expense_account_code, expense_is_group)
        REFERENCES ledger_account (account_code, is_group),
    CHECK (expense_account_code <> prepaid_account_code),
    CHECK (start_period = date_trunc('month', start_period)::date),
    CHECK (end_period = date_trunc('month', end_period)::date),
    CHECK (end_period >= start_period),
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
    CHECK (cancelled_at IS NULL OR btrim(coalesce(cancel_reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS ix_prepaid_schedule_site
    ON prepaid_schedule (site_id, status, start_period DESC);
CREATE INDEX IF NOT EXISTS ix_prepaid_schedule_source
    ON prepaid_schedule (source_kind, source_id);
CREATE INDEX IF NOT EXISTS ix_prepaid_schedule_account
    ON prepaid_schedule (prepaid_account_code);

CREATE TABLE IF NOT EXISTS prepaid_allocation (
    allocation_id  uuid PRIMARY KEY,
    schedule_id    uuid NOT NULL REFERENCES prepaid_schedule (schedule_id),
    period_year    smallint NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
    period_month   smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
    -- The entry this month made. NOT NULL: an allocation that posted nothing is
    -- a row that makes the remaining balance lie.
    entry_id       uuid NOT NULL REFERENCES journal_entry (entry_id),
    posted_by      text NOT NULL CHECK (btrim(posted_by) <> ''),
    posted_at      timestamptz NOT NULL DEFAULT now(),

    -- What makes a run replayable. Ask for March twice and the second ask finds
    -- this row and returns it.
    UNIQUE (schedule_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS ix_prepaid_allocation_entry
    ON prepaid_allocation (entry_id);

COMMENT ON TABLE prepaid_schedule IS
    'The plan for using up a prepayment. The opening debit belongs to the
     document named in (source_kind, source_id); this table only ever describes
     how it comes back out.';
COMMENT ON TABLE prepaid_allocation IS
    'One month of a schedule, actually posted, with the entry it made. Unique
     per (schedule, year, month), which is what makes a monthly run replayable.';

-- The journal has to admit what a prepaid allocation is. Restated in full
-- rather than altered, for the reason 0257 had to learn twice: a DROP-and-ADD
-- of this constraint on two branches loses whichever lane merged second.
ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'AMORTIZATION_RUN',
        'ASSET_CAPITALIZATION', 'ASSET_DISPOSAL', 'ASSET_RESERVE',
        'ASSET_TRANSFER', 'BANK_STATEMENT', 'CASH_COUNT', 'CASH_DOC',
        'CASH_SHIFT', 'COGS_DAY', 'CREDIT_NOTE', 'DEPOSIT', 'DEPRECIATION',
        'GIRO', 'GOODS_RECEIPT', 'INTERUNIT_SETTLE', 'LANDED_COST', 'MANUAL',
        'OPENING', 'PAYMENT', 'PAYROLL_RUN', 'PETTY_REPLENISH',
        -- new here
        'PREPAID_ALLOCATION',
        'RECLASS', 'REMITTANCE', 'RETENDER', 'REVERSAL', 'SALE_DAY',
        'STOCK_COUNT', 'STORE_DEPOSIT', 'STORE_EXPENSE', 'SUPPLIER_ADVANCE',
        'SUPPLIER_INVOICE', 'TAX_SETTLEMENT', 'TRANSFER', 'WRITE_OFF'
    ));

-- The human reference. A sequence and not a count, because two people writing a
-- schedule at once must not be handed the same number.
CREATE SEQUENCE IF NOT EXISTS prepaid_schedule_number_seq;
