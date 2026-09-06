-- 0135: The other half of a card sale — the day the money actually turns up.
--
-- # What a card sale leaves behind
--
-- A shop swipes a card and hands over a shirt. The stock has gone and the money
-- has not arrived: the acquirer has it, and will send it on — tomorrow, usually
-- — minus its cut. Until then the company holds a receivable against BCA or
-- MANDIRI, which is what `card_receivable_debit`, `card_receivable_credit` and
-- `qris_receivable` are for.
--
-- Nothing in this system has ever cleared one. The receivable would be raised
-- and would sit there forever, growing by a day's card takings every day,
-- because the act that discharges it did not exist. This is that act.
--
-- # Why it is curated and not imported
--
-- The acquirer's report is not a fact this system can accept unread. It arrives
-- as a CSV or a PDF or the body of an email; it covers whichever trading days
-- the acquirer felt like batching; its MDR is stated per line, or per report,
-- or not at all. Somebody at head office reads it, decides which of our own
-- receipts it settles, and takes responsibility for that reading — which is
-- what `curated_by` records.
--
-- So there are two amounts and they are different questions:
--
--   `gross_minor` / `mdr_minor` / `net_minor`   what the acquirer says
--   `expected_net_minor`                        what our own receipts say
--
-- and a third, `difference_minor`, once the bank statement has had its say.
-- Collapsing any two of them would remove the only evidence that something went
-- wrong.
--
-- # Why MDR is recorded here and not on the sale
--
-- Because it is not known at the sale. A till knows the amount swiped; the rate
-- the acquirer charges is a contract term applied at settlement, and it varies
-- by card scheme, by promotion, and by whatever the acquirer decides that
-- month. Booking an estimate at the till and correcting it here would put a
-- guess in the books every day and a correction beside it — two entries where
-- the honest answer is one, posted when the number is known.
--
-- # The four states
--
--   DRAFT      keyed, or uploaded, and nobody has stood behind it
--   CURATED    somebody has, and the journal is posted: the receivable is
--              discharged, the MDR is an expense, the bank is debited
--   MATCHED    the bank statement line has been found and agrees
--   EXCEPTION  the bank paid something else, and the difference has a document
--
-- CURATED posts and MATCHED does not, which is the same division 0071 drew and
-- for the same reason: agreeing that two records describe one event records
-- nothing new. What CURATED asserts is that the money is on its way and the
-- receivable is gone; the statement only confirms it landed.

-- ---------------------------------------------------------------------------
-- The source kind
-- ---------------------------------------------------------------------------
--
-- The list below is deliberately wider than this migration needs. Several lanes
-- are building the rest of the money story at the same time — a day's sales, a
-- cash shift, a store deposit, an inter-unit settlement — and each of them has
-- to widen this same CHECK. Whichever lands first, every one of them is already
-- named here, so the second and the third do not have to drop and recreate a
-- constraint whose current contents they would have to go and read.
--
-- A kind nobody posts yet costs nothing: `source_kind` is what the Journal
-- screen filters on, and a filter value with no entries behind it is an empty
-- list. A kind that is MISSING costs an entry that cannot be written at all.
--
-- ACQ_SETTLEMENT is this migration's own. Not PAYMENT — that is money we sent a
-- supplier — and not BANK_STATEMENT, which is a line we booked because the bank
-- had it and we did not. This is a document of our own, curated by a person,
-- and `source_id` is its `settlement_id`.

-- `IF EXISTS` because several lanes recreate this same constraint by name and
-- none of them knows which will land first. Whichever runs last wins, and the
-- list below is byte-identical to 0107's for exactly that reason: two lanes
-- widening one CHECK must not narrow it past each other.
ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        -- everything 0096 allowed
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER',
        -- the money story, across the lanes building it
        'RETENDER', 'CASH_SHIFT', 'STORE_DEPOSIT', 'REMITTANCE', 'ADVANCE',
        'STORE_EXPENSE', 'PETTY_REPLENISH', 'CASH_DOC', 'GIRO',
        'INTERUNIT_SETTLE', 'RECLASS', 'ADJUSTMENT', 'WRITE_OFF',
        'ACQ_SETTLEMENT', 'GOODS_RECEIPT', 'CREDIT_NOTE', 'SUPPLIER_ADVANCE',
        'LANDED_COST', 'COGS_DAY', 'ASSET_RESERVE'));

-- ---------------------------------------------------------------------------
-- The settlement
-- ---------------------------------------------------------------------------

CREATE TABLE acquirer_settlement (
    settlement_id   uuid PRIMARY KEY,

    -- BCA, MANDIRI, a QRIS provider. The same string the posting rules pass as
    -- a qualifier and the same string a shop writes on a batch slip in 0134.
    acquirer        text NOT NULL,
    -- The day the acquirer says it paid.
    settlement_date date NOT NULL,
    -- The trading days it covers. A range and not a day: acquirers batch a
    -- weekend into Monday, and a settlement that could only name one day would
    -- force somebody to split it into three that never existed.
    business_from   date NOT NULL,
    business_to     date NOT NULL,

    -- What the acquirer's own report says. Net is derived and stored anyway, so
    -- that a report whose own arithmetic does not add up is refused at the door
    -- rather than discovered in the journal.
    gross_minor     bigint NOT NULL CHECK (gross_minor > 0),
    mdr_minor       bigint NOT NULL DEFAULT 0 CHECK (mdr_minor >= 0),
    net_minor       bigint NOT NULL,

    -- What our own till receipts say should have arrived, from the lines below.
    -- Null until somebody has attached them.
    expected_net_minor bigint,

    -- The bank line this money arrived on. Set at MATCHED.
    bank_statement_line_id uuid REFERENCES bank_statement_line(line_id),

    status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','CURATED','MATCHED','EXCEPTION')),

    -- Net against what the bank actually credited. Positive means the bank paid
    -- less than the acquirer promised.
    difference_minor bigint,
    explanation     text,

    journal_entry_id uuid REFERENCES journal_entry(entry_id),

    curated_by      text,
    curated_at      timestamptz,
    created_by      text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CHECK (business_to >= business_from),
    CHECK (net_minor = gross_minor - mdr_minor),
    -- Curated, posted and signed are one fact, so they cannot disagree. The
    -- shape `supplier_invoice` uses for POSTED and `fixed_asset` for disposal.
    CHECK ((status = 'DRAFT') = (curated_at IS NULL)),
    CHECK ((curated_at IS NULL) = (curated_by IS NULL)),
    CHECK ((curated_at IS NULL) = (journal_entry_id IS NULL)),
    -- A match names a line; an exception names a reason. Neither is optional in
    -- the state that claims it.
    CHECK (status <> 'MATCHED' OR bank_statement_line_id IS NOT NULL),
    CHECK (status <> 'EXCEPTION' OR explanation IS NOT NULL)
);

-- One bank credit settles one settlement. The same both-ways uniqueness
-- `bank_line_match` keeps, for the same reason: a line claimed twice is money
-- counted twice.
CREATE UNIQUE INDEX ux_acq_settlement_bank_line
    ON acquirer_settlement (bank_statement_line_id)
    WHERE bank_statement_line_id IS NOT NULL;
CREATE INDEX ix_acq_settlement_acquirer
    ON acquirer_settlement (acquirer, settlement_date DESC);
CREATE INDEX ix_acq_settlement_status ON acquirer_settlement (status);

COMMENT ON TABLE acquirer_settlement IS
    'One payment an acquirer says it made, curated by a person at head office. CURATED posts and discharges the receivable; MATCHED only agrees with the bank.';

-- ---------------------------------------------------------------------------
-- What it settles
-- ---------------------------------------------------------------------------
--
-- One row per receipt the report pays for. This is where the posting learns
-- which SHOP's receivable to discharge — the money lands in one head-office
-- bank account and the debt was owed to thirteen different sets of books.

CREATE TABLE acquirer_settlement_line (
    settlement_line_id uuid PRIMARY KEY,
    settlement_id   uuid NOT NULL
                    REFERENCES acquirer_settlement(settlement_id) ON DELETE CASCADE,

    -- The till receipt. Nullable, and that is the important part: a report line
    -- our own records cannot account for is exactly the exception this screen
    -- exists to surface, and dropping it would hide it behind a total that
    -- still balanced.
    sale_id         uuid,
    tender_seq      integer,

    -- Whose books carry the receivable. Copied rather than joined through the
    -- sale, because a line with no sale still has to post somewhere, and the
    -- person curating knows which shop it is from the report.
    site_id         text NOT NULL REFERENCES site(id),

    -- Which receivable. Three meanings, three accounts, and the acquirer's
    -- report distinguishes them because the rates differ.
    tender_kind     text NOT NULL
                    CHECK (tender_kind IN ('CARD_DEBIT','CARD_CREDIT','QRIS')),

    auth_code       text,
    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
    mdr_minor       bigint NOT NULL DEFAULT 0 CHECK (mdr_minor >= 0),

    FOREIGN KEY (sale_id, tender_seq)
        REFERENCES edge_sale_tender (sale_id, tender_seq) ON DELETE CASCADE,
    CHECK ((sale_id IS NULL) = (tender_seq IS NULL)),
    CHECK (mdr_minor <= amount_minor)
);

-- One receipt is settled once. A second settlement claiming the same tender is
-- the acquirer paying twice or the curator reading the same report twice, and
-- both are worth a refusal rather than a duplicate discharge.
CREATE UNIQUE INDEX ux_acq_settlement_line_receipt
    ON acquirer_settlement_line (sale_id, tender_seq)
    WHERE sale_id IS NOT NULL;
CREATE INDEX ix_acq_settlement_line_settlement
    ON acquirer_settlement_line (settlement_id);

COMMENT ON TABLE acquirer_settlement_line IS
    'One till receipt an acquirer''s report pays for, with the shop whose receivable it discharges. A null sale_id is a report line we cannot account for.';

-- ---------------------------------------------------------------------------
-- When the bank disagrees
-- ---------------------------------------------------------------------------
--
-- The acquirer promised net; the bank credited something else. That difference
-- always has a cause and the causes are few: a fee the report did not state, a
-- chargeback clawed back, or a slice that settled on another day's payment.
--
-- Each is a document with an author, because "the difference is a fee" is a
-- judgement somebody made and may have made wrongly. FEE and CHARGEBACK post
-- the residual; OTHER_DAY and OPEN post nothing, because nothing has been lost
-- — the first is timing and the second is an admission that nobody knows yet.

CREATE TABLE acquirer_settlement_exception (
    exception_id    uuid PRIMARY KEY,
    settlement_id   uuid NOT NULL
                    REFERENCES acquirer_settlement(settlement_id) ON DELETE CASCADE,

    kind            text NOT NULL CHECK (kind IN ('FEE','CHARGEBACK','OTHER_DAY','OPEN')),
    -- Signed. A fee is money we did not get; a refund of one is money we got
    -- back, and forcing both through a positive column would need a second
    -- kind that means the same thing backwards.
    amount_minor    bigint NOT NULL,
    explanation     text NOT NULL,

    journal_entry_id uuid REFERENCES journal_entry(entry_id),

    explained_by    text NOT NULL,
    explained_at    timestamptz NOT NULL DEFAULT now(),

    -- The two kinds that move money are the two that carry an entry. Written as
    -- an equality rather than two one-way checks, so neither an unposted fee
    -- nor a posted guess can exist.
    CHECK ((kind IN ('FEE','CHARGEBACK')) = (journal_entry_id IS NOT NULL))
);
CREATE INDEX ix_acq_settlement_exception_settlement
    ON acquirer_settlement_exception (settlement_id);

COMMENT ON TABLE acquirer_settlement_exception IS
    'Why the bank credited something other than the acquirer promised. FEE and CHARGEBACK post the residual; OTHER_DAY and OPEN record that nobody is claiming to know yet.';
