-- A ledger has to start somewhere, and somebody has to say where.
--
-- The client keeps their books in Seventhsoft today. When they move, every
-- account carries a balance across, every unpaid bill carries an amount and a
-- due date, and — the part that cannot be reconstructed afterwards — every unit
-- of stock on the shelf carries a COST.
--
-- That last one is why this migration exists at all rather than being a page of
-- manual journal entries. The frozen costing policy is FIFO over cost layers,
-- and a layer only exists because something created it. Seventhsoft is
-- periodic: purchases are expensed as they are bought and the closing stock is
-- whatever a physical count says it is, so there are no layers to bring over.
-- There is nothing to import. Somebody has to price the opening stock once,
-- and after the first sale on the first day it is too late — the queue will
-- have started without a beginning and every margin after it will be wrong by
-- an amount nobody can name.
--
-- # Three tables and not one
--
-- An opening trial balance, a stock sheet and a list of unpaid bills are three
-- documents with three shapes, three sources inside the client's own system and
-- three people who sign them off. Folding them into one `opening_line` with
-- eleven nullable columns would make every CHECK a disjunction and every read a
-- filter, and the first thing anybody would want — "show me only the stock" —
-- would be a query rather than a table.
--
-- # Why the imported rows are kept at all
--
-- Everything here also lands somewhere authoritative: the trial balance becomes
-- a journal entry, the stock becomes cost layers, the bills become Payment
-- Ledger items. These tables are the EVIDENCE, and they earn their place three
-- times over:
--
--   * The client's auditors will ask what Seventhsoft said on the cutover date.
--     The journal entry is what we posted; this is what we were given.
--   * `pricing_basis` has nowhere else to live. A cost layer records what the
--     goods cost and cannot record that the figure was a fallback rather than a
--     real purchase price — and "which of these numbers did we make up" is the
--     single most important question about an opening stock sheet.
--   * The cutover report reads them. After a successful import nothing is
--     unmapped, because the import refuses unmapped accounts; after a PARTIAL
--     one the report has to be able to say what is still missing, and it can
--     only do that against what was handed over.
--
-- # Idempotency
--
-- Each table is unique on its natural key within a cutover date, and each links
-- to what it produced. Re-running an import finds the rows already there. The
-- journal entry has a second, independent guard — 0140's unique index on
-- (source_kind, source_id, purpose) — and that one is the real one: two
-- requests that raced would both pass a read-decide-write check here and only
-- one can pass the index.

-- ---------------------------------------------------------------------------
-- What can cause an entry, plus one
-- ---------------------------------------------------------------------------
--
-- The list as 0148 left it, with OPENING added. Rewritten in full rather than
-- amended because a CHECK constraint has no ALTER; see 0128 for why this list
-- keeps being restated.

ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        -- 0051, 0083, 0095, 0096
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER',
        -- The union every lane in this round writes.
        'RETENDER', 'CASH_SHIFT', 'STORE_DEPOSIT', 'REMITTANCE', 'ADVANCE',
        'STORE_EXPENSE', 'PETTY_REPLENISH', 'CASH_DOC', 'GIRO',
        'INTERUNIT_SETTLE', 'RECLASS', 'ADJUSTMENT', 'WRITE_OFF',
        'ACQ_SETTLEMENT', 'GOODS_RECEIPT', 'CREDIT_NOTE', 'SUPPLIER_ADVANCE',
        'LANDED_COST', 'COGS_DAY', 'ASSET_RESERVE',
        -- This migration. The one kind whose entries describe events that
        -- happened in another company's software.
        'OPENING'));

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused the entry. OPENING is the carry-over from the system the client used before this one: it has no document of ours behind it, only theirs.';

-- ---------------------------------------------------------------------------
-- The opening trial balance, as it was handed over
-- ---------------------------------------------------------------------------

CREATE TABLE opening_balance_line (
    line_id       uuid PRIMARY KEY,
    -- The last day of the old system. Every figure here is "as at" this.
    cutover_date  date NOT NULL,
    site_id       text NOT NULL REFERENCES site(id),
    -- The client's own code, chosen by a person reading their own chart. Not a
    -- semantic key: an opening balance names accounts a posting rule has never
    -- heard of — prepaid rent, a director's loan, accumulated depreciation —
    -- and the map has no meaning for any of them.
    account_code  text NOT NULL,
    debit_minor   bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
    credit_minor  bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
    -- Their document number, kept because their auditors will look for it. A
    -- trial balance printed out of Seventhsoft has a reference on it and that
    -- reference is how the two systems are tied together for anybody checking.
    document_no   text NOT NULL CHECK (btrim(document_no) <> ''),
    memo          text,
    -- What this became. Null until the import is posted for real, which is what
    -- makes a rehearsal distinguishable from the thing itself.
    journal_entry_id uuid REFERENCES journal_entry(entry_id),
    imported_at   timestamptz NOT NULL DEFAULT now(),
    imported_by   text NOT NULL CHECK (btrim(imported_by) <> ''),

    -- One figure per account per place. A trial balance that named the same
    -- account twice is two trial balances.
    UNIQUE (cutover_date, site_id, account_code),
    -- A line is a debit or a credit, never both and never neither. The same
    -- rule `poster::check_balanced` applies to a posting line, applied to the
    -- document a posting line will be built from.
    CHECK ((debit_minor = 0) <> (credit_minor = 0))
);

CREATE INDEX ix_opening_balance_run ON opening_balance_line (cutover_date, site_id);

COMMENT ON TABLE opening_balance_line IS
    'The trial balance carried over from the system the client used before this one, exactly as handed over. What was posted from it is the journal entry; this is what we were given.';
COMMENT ON COLUMN opening_balance_line.document_no IS
    'The client''s own document reference. Kept so their auditors can tie our opening entry back to their closing report.';
COMMENT ON COLUMN opening_balance_line.journal_entry_id IS
    'The entry this line was posted in, or null when the import has only been rehearsed.';

-- ---------------------------------------------------------------------------
-- The opening stock sheet, and how each line got its price
-- ---------------------------------------------------------------------------

CREATE TABLE opening_stock_line (
    line_id       uuid PRIMARY KEY,
    cutover_date  date NOT NULL,
    site_id       text NOT NULL REFERENCES site(id),
    article_id    uuid NOT NULL REFERENCES article(id),
    -- Where the goods physically are. Named and not derived: a rule that put
    -- everything in `{site}.warehouse` would be a guess, and it would be wrong
    -- for every shop, whose stock is on the floor.
    pool_id       text NOT NULL REFERENCES operational_pool(id),
    quantity      bigint NOT NULL CHECK (quantity > 0),
    unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),

    -- How that unit cost was arrived at. The whole point of this column is that
    -- a fallback is VISIBLE: a stock sheet whose prices are half real and half
    -- invented, with nothing saying which, is a stock sheet that will be
    -- believed entirely.
    pricing_basis text NOT NULL CHECK (pricing_basis IN (
                      -- What the client last actually paid a supplier, off
                      -- their own purchase history. The only basis that is not
                      -- a compromise.
                      'LAST_PURCHASE',
                      -- A figure somebody typed into the sheet because the
                      -- purchase history had nothing. Real money, decided by a
                      -- person, and recorded as such.
                      'STATED_FALLBACK',
                      -- The average of what this article is already costing in
                      -- this system. Only reachable in a phased cutover, where
                      -- some of the estate has been live long enough to have a
                      -- queue.
                      'SYSTEM_AVERAGE')),
    -- Why the basis is what it is, in a sentence, so the report does not have
    -- to reconstruct the reasoning from three nullable columns.
    basis_note    text NOT NULL CHECK (btrim(basis_note) <> ''),
    document_no   text NOT NULL CHECK (btrim(document_no) <> ''),

    cost_layer_id uuid REFERENCES cost_layer(layer_id),
    imported_at   timestamptz NOT NULL DEFAULT now(),
    imported_by   text NOT NULL CHECK (btrim(imported_by) <> ''),

    -- One holding per article per place. Two rows for one article at one shop
    -- are two counts of the same shelf.
    UNIQUE (cutover_date, site_id, article_id)
);

CREATE INDEX ix_opening_stock_run ON opening_stock_line (cutover_date, site_id);
CREATE INDEX ix_opening_stock_fallback ON opening_stock_line (cutover_date)
    WHERE pricing_basis <> 'LAST_PURCHASE';

COMMENT ON TABLE opening_stock_line IS
    'What was on the shelf at cutover, per article and place, and what it was decided to be worth. The cost layers are the ledger; this records how each of their prices was chosen.';
COMMENT ON COLUMN opening_stock_line.pricing_basis IS
    'LAST_PURCHASE is the client''s own purchase price. Anything else is a fallback and shows on the cutover report as one.';

-- ---------------------------------------------------------------------------
-- The open items: what was owed, and what was owed to us
-- ---------------------------------------------------------------------------

CREATE TABLE opening_subledger_line (
    line_id       uuid PRIMARY KEY,
    cutover_date  date NOT NULL,
    site_id       text NOT NULL REFERENCES site(id),
    -- The semantic key of the control account, because this is exactly how the
    -- Payment Ledger identifies itself and the integrity equation compares
    -- (account_key, qualifier, site_id, side) against the mapped account. An
    -- account code here would be a second answer to a question 0145 already
    -- answers.
    account_key   text NOT NULL CHECK (btrim(account_key) <> ''),
    qualifier     text NOT NULL DEFAULT '',
    party_type    text NOT NULL CHECK (party_type IN
                      ('SUPPLIER', 'ACQUIRER', 'EMPLOYEE', 'CUSTOMER', 'OTHER')),
    party_id      text NOT NULL CHECK (btrim(party_id) <> ''),
    party_name    text,
    side          text NOT NULL CHECK (side IN ('RECEIVABLE', 'PAYABLE')),
    -- The client's own document: their invoice number, their settlement batch.
    -- It becomes the voucher on the Payment Ledger item, which is what lets a
    -- supplier ring up quoting an invoice number from before the cutover and be
    -- answered.
    voucher_kind  text NOT NULL CHECK (btrim(voucher_kind) <> ''),
    voucher_id    text NOT NULL CHECK (btrim(voucher_id) <> ''),
    amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
    due_date      date,

    payment_ledger_entry_id uuid REFERENCES payment_ledger_entry(entry_id),
    imported_at   timestamptz NOT NULL DEFAULT now(),
    imported_by   text NOT NULL CHECK (btrim(imported_by) <> ''),

    -- The same key `ple_open` is idempotent on, plus the date. A document opens
    -- a balance once.
    UNIQUE (cutover_date, account_key, party_type, party_id, voucher_kind, voucher_id)
);

CREATE INDEX ix_opening_subledger_run ON opening_subledger_line (cutover_date, site_id);

COMMENT ON TABLE opening_subledger_line IS
    'Unpaid bills and outstanding receivables at cutover, as handed over. Each becomes one Payment Ledger item against the opening journal entry, so the sub-ledger agrees with the opening general ledger from the first day.';

-- ---------------------------------------------------------------------------
-- A closed month refuses an opening balance too
-- ---------------------------------------------------------------------------
--
-- The poster's own trigger already refuses an entry dated in a closed month, so
-- the real import cannot get through. This puts the same rule on the evidence
-- row, which matters for the case the poster cannot see: a cutover date whose
-- month was closed AFTER the import was rehearsed and before it was run. The
-- lock fires on the transition into the books — the journal link going from
-- nothing to something — which is exactly when it should.

SELECT attach_entry_link_period_lock('opening_balance_line', 'cutover_date');
