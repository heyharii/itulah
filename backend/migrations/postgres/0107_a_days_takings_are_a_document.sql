-- 0107: A day's takings are a document before they are a journal.
--
-- # The hole this fills
--
-- `0051` listed `SALE_DAY` among the things a journal entry can come from and
-- nothing has ever written one. The books therefore contain purchases, wages,
-- depreciation and bank movements, and no revenue at all: every rupiah the
-- estate has taken since the till was built is in `edge_sale` and `sale`, and
-- none of it is in the ledger. A trial balance that balances while the income
-- statement is empty is the most convincing wrong number this system can
-- produce.
--
-- # Why a document and not a nightly job
--
-- Same argument `0052` makes for a supplier bill. A day's takings is a thing
-- somebody has to be able to find, look at, disagree with, and post
-- deliberately — not a side effect of a cron entry that either ran or did
-- not. The document also gives the entry a stable `source_id`, so an auditor
-- reading `JV-00004417` can get back to the day it summarises rather than to
-- a timestamp.
--
-- The rule is therefore: GENERATE derives, POST commits. Generating is
-- idempotent and repeatable; posting happens once. A posted day is corrected
-- the way the journal corrects everything else — reverse it, regenerate,
-- post again — never by editing what was already posted.
--
-- # Why one per (site, business_date)
--
-- Because that is the unit a shop closes and a treasury reconciles. The
-- uniqueness is a constraint rather than a convention so that two people
-- generating the same day at the same moment produce one document, and the
-- second one is refused by the database rather than by a check that ran a
-- moment before the other insert.
--
-- # What is NOT in here
--
-- Cost of goods. Nothing in this system values inventory yet — `cogs` is a
-- mapped meaning with nothing posting to it, and there is no costing method,
-- no landed cost and no valuation layer to take a figure from. Booking a
-- guess at COGS would make gross margin appear on a report and be wrong by
-- however far the guess was off, which is worse than a report that says
-- plainly it has no cost side. Revenue and VAT are recorded here; the cost
-- half waits for inventory valuation.

-- ---------------------------------------------------------------------------
-- Where the day's money came to rest
-- ---------------------------------------------------------------------------

CREATE TABLE sales_posting (
    posting_id    uuid PRIMARY KEY,

    site_id       text NOT NULL REFERENCES site(id),
    -- The shop's own day, not an instant. A sale rung at 23:40 WIB belongs to
    -- that day even though it is already tomorrow in UTC, which is why every
    -- read that builds this shifts by an offset rather than truncating a
    -- `timestamptz` and trusting the server's timezone.
    business_date date NOT NULL,

    status        text NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
    currency      char(3) NOT NULL DEFAULT 'IDR',

    -- What the customers were charged, VAT inclusive, after promotions.
    gross_minor    bigint NOT NULL CHECK (gross_minor >= 0),
    -- What the tenders actually came to, net of change given. Equal to
    -- `gross_minor` on a well-formed day; different when a sale arrived
    -- without a tender list, which the generator records rather than hides.
    settled_minor  bigint NOT NULL CHECK (settled_minor >= 0),
    -- What promotions took off before the customer paid. Contra revenue: the
    -- takings are already net of it, so the entry grosses revenue back up and
    -- debits it, rather than quietly reporting a smaller sale.
    discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
    -- What went back over the counter, VAT inclusive.
    returns_minor  bigint NOT NULL CHECK (returns_minor >= 0),
    -- PPN embedded in what was charged, less the PPN unwound by returns.
    vat_minor      bigint NOT NULL,
    -- What lands in the income accounts: takings less VAT, plus the discount
    -- that was given away, less the net of returns.
    revenue_minor  bigint NOT NULL,
    -- Takings the tenders do not account for. Treated as cash, following the
    -- backfill in `0077`, and shown here so that treating it so is visible.
    untendered_minor bigint NOT NULL DEFAULT 0 CHECK (untendered_minor >= 0),
    sale_count     bigint NOT NULL CHECK (sale_count >= 0),
    -- The rate the VAT was extracted at, frozen. A rate that changed in April
    -- must not silently rewrite what March's document said.
    vat_rate_bps   integer NOT NULL CHECK (vat_rate_bps BETWEEN 0 AND 100000),

    generated_at  timestamptz NOT NULL DEFAULT now(),
    generated_by  text NOT NULL CHECK (btrim(generated_by) <> ''),

    journal_entry_id uuid REFERENCES journal_entry(entry_id),
    posted_at     timestamptz,
    posted_by     text,

    reversal_entry_id uuid REFERENCES journal_entry(entry_id),
    reversed_at   timestamptz,
    reversed_by   text,
    reversal_reason text,

    -- One document per shop per day. The constraint, not a convention: two
    -- people generating the same day at once must not produce two.
    UNIQUE (site_id, business_date),

    -- A draft has no journal behind it, and anything else does. Stated both
    -- ways so neither half can drift.
    CONSTRAINT sales_posting_draft_has_no_entry
        CHECK (status <> 'DRAFT' OR journal_entry_id IS NULL),
    CONSTRAINT sales_posting_committed_has_an_entry
        CHECK (status = 'DRAFT' OR journal_entry_id IS NOT NULL),
    CONSTRAINT sales_posting_reversed_says_so
        CHECK ((status = 'REVERSED') = (reversal_entry_id IS NOT NULL))
);

CREATE INDEX ix_sales_posting_month ON sales_posting (site_id, business_date DESC);
CREATE INDEX ix_sales_posting_status ON sales_posting (status, business_date DESC);

COMMENT ON TABLE sales_posting IS
    'A shop''s day of takings, as a document. Generated from the synced sales '
    'and tenders, posted once, corrected by reversal and regeneration.';

-- ---------------------------------------------------------------------------
-- The same day, split the way the money settles
-- ---------------------------------------------------------------------------
--
-- One row per (method, acquirer, card kind), because that triple is what one
-- account in the client's chart corresponds to and what one acquirer's
-- settlement file covers. It is the working paper behind the entry: somebody
-- who disagrees with a journal line should be able to see which tenders made
-- it without reading SQL.

CREATE TABLE sales_posting_line (
    line_id     uuid PRIMARY KEY,
    posting_id  uuid NOT NULL REFERENCES sales_posting(posting_id) ON DELETE CASCADE,
    line_number integer NOT NULL CHECK (line_number > 0),

    method      text NOT NULL
                CHECK (method IN ('CASH', 'CARD', 'QRIS', 'OTHER', 'VOUCHER')),
    -- Empty rather than null: it is a qualifier the account map is keyed on,
    -- and that key spells "no narrowing" as the empty string.
    acquirer    text NOT NULL DEFAULT '',
    card_kind   text CHECK (card_kind IN ('DEBIT', 'CREDIT')),
    -- True when `card_kind` was inferred from the acquirer rather than
    -- captured at the till. Written down so a person can see which lines rest
    -- on a guess, and retender the ones that are wrong.
    card_kind_inferred boolean NOT NULL DEFAULT false,

    -- Money in, before refunds, net of change.
    gross_minor    bigint NOT NULL CHECK (gross_minor >= 0),
    -- Money back out through this same bucket.
    returns_minor  bigint NOT NULL DEFAULT 0 CHECK (returns_minor >= 0),
    -- This bucket's share of what promotions gave away.
    discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    -- PPN embedded in `gross_minor`.
    vat_minor      bigint NOT NULL DEFAULT 0 CHECK (vat_minor >= 0),
    tender_count   bigint NOT NULL DEFAULT 0 CHECK (tender_count >= 0),

    UNIQUE (posting_id, line_number),
    -- One row per bucket. Two rows for BCA debit would each be half an answer.
    UNIQUE (posting_id, method, acquirer, card_kind)
);

CREATE INDEX ix_sales_posting_line_posting ON sales_posting_line (posting_id);

COMMENT ON TABLE sales_posting_line IS
    'A day''s takings split by how they settle: method, acquirer and card '
    'kind. One row per account the entry will touch.';

-- ---------------------------------------------------------------------------
-- Two more source kinds, and the union every lane agreed on
-- ---------------------------------------------------------------------------
--
-- `SALE_DAY` has been in this list since `0051` with nothing writing it.
-- `RETENDER` is new and is deliberately not `MANUAL`: moving a settled tender
-- from one acquirer to another has a document behind it, and `MANUAL` is
-- reserved for entries a person typed from nothing.
--
-- The rest of the list is not needed by anything here. It is written now, in
-- full, because several modules are being built against this constraint at
-- once and each of them would otherwise drop and recreate it knowing only its
-- own additions — and whichever migration ran last would quietly delete every
-- kind the others had added. A CHECK that names every kind the system will
-- write makes the merge order stop mattering.

ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        -- what 0051, 0083, 0095 and 0096 established
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER',
        -- what the modules being built alongside this one will write
        'RETENDER', 'CASH_SHIFT', 'STORE_DEPOSIT', 'REMITTANCE', 'ADVANCE',
        'STORE_EXPENSE', 'PETTY_REPLENISH', 'CASH_DOC', 'GIRO',
        'INTERUNIT_SETTLE', 'RECLASS', 'ADJUSTMENT', 'WRITE_OFF',
        'ACQ_SETTLEMENT', 'GOODS_RECEIPT', 'CREDIT_NOTE', 'SUPPLIER_ADVANCE',
        'LANDED_COST', 'COGS_DAY', 'ASSET_RESERVE'));

COMMENT ON COLUMN journal_entry.source_kind IS
    'How the entry came to be written. Every kind has a document behind it '
    'except MANUAL, which is reserved for what a person typed from nothing.';
