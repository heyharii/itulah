-- 0115: Money moves by a document, not by a journal entry.
--
-- # What was missing
--
-- There was no cash document. Every rupiah that moved between two of the
-- client's own pots moved either as a side effect of something else — a
-- supplier payment, a sale — or as a hand-keyed journal entry with no paper
-- behind it. `book_bank_line` (0095) wrote a raw journal with source kind
-- BANK_STATEMENT and called it done; the `voucher` table 0090 added is a gift
-- card and has nothing to do with this.
--
-- That gap is the reason a shop cannot pay for a repair out of the till, a
-- cashier cannot bank the day's takings as its own act, and nobody can print
-- the slip that every Indonesian retailer's cash box runs on. It is also why
-- the only sanctioned way to move money was the one act the ledger cannot
-- check: a manual entry.
--
-- # One document, two accounts, three names
--
-- A cash document says money left one account and arrived in another, on a
-- date, for a reason, at somebody's instruction. That is the whole model. It is
-- deliberately NOT three tables — a payment table, a receipt table and a
-- transfer table — because those would be one shape with three names, three
-- number sequences to keep and three posting rules to keep in step.
--
-- The KIND is a fact about the two accounts and not an extra field somebody
-- chooses: money leaving cash or bank for somewhere else is a PAY, money
-- arriving from somewhere else is a RECEIVE, and cash and bank moving between
-- themselves is a TRANSFER. The client's own numbering says the same thing in
-- their own letters — `KK` for Kas Keluar, `KM` for Kas Masuk, `TF` for a
-- transfer — so the number is derived from the direction and cannot disagree
-- with it.
--
-- # Why the number is assigned at approval and not at keying
--
-- Because a number is what a slip is filed under, and a draft that somebody
-- abandons should not burn one. The client's format carries the month —
-- `KK-26-09-00001` — so the sequence is per kind per month, which also means a
-- gap is visible to the person who files them rather than hidden inside a
-- global counter. `cash_document_sequence` is that counter, one row per (kind,
-- month), taken under a row lock at approval time.
--
-- Numbers are not reused. An approved document that is later reversed keeps
-- its number, because the slip is already in a file with that number on it.
--
-- # Why a side may name a meaning OR an account
--
-- The same choice `poster::LineAccount` already models, and for the same
-- reason. The money side always has a meaning — `cash`, `bank_giro` — because
-- the whole point of `account_map` is that a document never names a client
-- account code. The other side often has no meaning at all: a monthly bank
-- charge lands in `Biaya Bank`, and there is no posting rule that knows about
-- it. So each side is either a meaning resolved through the map for that
-- location, or an account code a person chose, and never both.
--
-- # Maker and checker are recorded, not enforced apart
--
-- `created_by` and `approved_by` are both kept and the slip prints three
-- signature lines — dibuat, diperiksa, disetujui. They are deliberately NOT
-- constrained to be different people, the way `goods_receipt_line` constrains
-- its counter and verifier: a bank line booked while reading the statement is
-- one person's single act, and a rule that refused it would be a rule people
-- work around by sharing a login. What the paper asks for, the paper enforces.

-- ---------------------------------------------------------------------------
-- The source kinds
-- ---------------------------------------------------------------------------
--
-- Recreated once, with every kind the money lanes are adding, rather than once
-- per lane: each of these migrations otherwise drops and rebuilds the same
-- constraint, and the last one to run decides what the list is. Stating the
-- whole union here means the constraint says the same thing whichever order
-- they arrive in.
--
--   CASH_DOC        this document
--   GIRO            a giro clearing or being rejected (0117)
--   RETENDER        a sale re-tendered
--   CASH_SHIFT      a till session closed
--   STORE_DEPOSIT   a shop banking its takings
--   REMITTANCE      money sent to head office
--   ADVANCE         money out ahead of a receipt
--   STORE_EXPENSE   a shop spending out of its own till
--   PETTY_REPLENISH petty cash topped up
--   INTERUNIT_SETTLE  what one location owes another, settled
--
-- and the kinds the bill, stock and asset lanes are adding beside them —
-- RECLASS, ADJUSTMENT, WRITE_OFF, ACQ_SETTLEMENT, GOODS_RECEIPT, CREDIT_NOTE,
-- SUPPLIER_ADVANCE, LANDED_COST, COGS_DAY, ASSET_RESERVE. Named here even
-- though nothing in this migration posts them, because the alternative is one
-- lane's constraint dropping another lane's kind depending on which was
-- applied last.

ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER',
        'RETENDER', 'CASH_SHIFT', 'STORE_DEPOSIT', 'REMITTANCE', 'ADVANCE',
        'STORE_EXPENSE', 'PETTY_REPLENISH', 'CASH_DOC', 'GIRO',
        'INTERUNIT_SETTLE', 'RECLASS', 'ADJUSTMENT', 'WRITE_OFF',
        'ACQ_SETTLEMENT', 'GOODS_RECEIPT', 'CREDIT_NOTE', 'SUPPLIER_ADVANCE',
        'LANDED_COST', 'COGS_DAY', 'ASSET_RESERVE'));

-- ---------------------------------------------------------------------------
-- The counter
-- ---------------------------------------------------------------------------
--
-- Not a Postgres sequence. A sequence is global, gapless only by accident, and
-- cannot be reset per month; this counter is per (kind, month) because that is
-- what the client's number format says, and it is taken under `FOR UPDATE` so
-- two approvals in the same second cannot both read 41.

CREATE TABLE cash_document_sequence (
    kind     text    NOT NULL CHECK (kind IN ('PAY', 'RECEIVE', 'TRANSFER')),
    -- `202609`. An integer rather than two columns, because it is only ever
    -- used whole and a month is naturally ordered this way.
    yyyymm   integer NOT NULL CHECK (yyyymm BETWEEN 190001 AND 999912),
    last_no  integer NOT NULL DEFAULT 0 CHECK (last_no >= 0),
    PRIMARY KEY (kind, yyyymm)
);

COMMENT ON TABLE cash_document_sequence IS
    'The last number handed out for one kind of cash document in one month. Taken under a row lock at approval; a draft that is abandoned burns nothing.';

-- ---------------------------------------------------------------------------
-- The document
-- ---------------------------------------------------------------------------

CREATE TABLE cash_document (
    document_id     uuid PRIMARY KEY,

    -- Derived from which side holds money, never chosen. See the header.
    kind            text NOT NULL CHECK (kind IN ('PAY', 'RECEIVE', 'TRANSFER')),

    -- `KK-26-09-00001`. NULL until approved, and unique once it exists, so a
    -- draft costs nothing and two approvals cannot land on one slip.
    number          text UNIQUE CHECK (number IS NULL OR btrim(number) <> ''),

    doc_date        date NOT NULL,

    -- Where the money left. Either a meaning resolved through `account_map`
    -- for `from_site`, or an account code a person chose — never both, never
    -- neither.
    from_key        text,
    from_qualifier  text NOT NULL DEFAULT '',
    from_account_code text,
    from_site       text NOT NULL REFERENCES site(id),

    -- Where it arrived.
    to_key          text,
    to_qualifier    text NOT NULL DEFAULT '',
    to_account_code text,
    to_site         text NOT NULL REFERENCES site(id),

    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
    currency        char(3) NOT NULL DEFAULT 'IDR',

    -- Who the money is for, or from. Three shapes, because the client's slips
    -- carry all three: a registered supplier, one of their own people, or a
    -- name written on the line — the landlord, the RT, a courier.
    party_kind      text NOT NULL DEFAULT 'OTHER'
                    CHECK (party_kind IN ('SUPPLIER', 'EMPLOYEE', 'OTHER')),
    -- Text and not a foreign key, deliberately, and the same way
    -- `supplier_invoice` and `journal_line` hold it. The supplier a slip names
    -- has to be the supplier a BILL names, or "does this supplier still owe
    -- money" cannot be asked across the two; and bills carry the id the buying
    -- side gave them, which is not always a row in `supplier` yet.
    supplier_id     text,
    employee_id     text REFERENCES employee(id),
    -- Always filled, whichever shape: it is what the slip prints, and a slip
    -- that printed a uuid would be a slip nobody could file.
    party_name      text NOT NULL CHECK (btrim(party_name) <> ''),

    -- Why. Required, like a reversal's reason: it is the only record of the
    -- judgement somebody made, and it is the line the slip prints under
    -- "Untuk pembayaran".
    memo            text NOT NULL CHECK (btrim(memo) <> ''),

    -- The photographed receipt, when there is one.
    attachment_file_id uuid REFERENCES stored_file(file_id),

    -- Where this came from, when it was not typed. A bank statement line that
    -- nobody had booked becomes one of these, and the line and the document
    -- then each name the other.
    statement_line_id uuid REFERENCES bank_statement_line(line_id),

    -- Paid by giro, and the paper's own details.
    --
    -- The money side still names the bank account, because that is where the
    -- money will ultimately leave from and it is what the slip says. What
    -- changes is the POSTING: the credit goes to `giro_outstanding` for the
    -- same bank, and only clearing moves the bank balance. See 0117; a supplier
    -- payment by giro works the same way, and it has to, or the same instrument
    -- would land in two different accounts depending on which screen wrote it.
    giro_number     text,
    giro_due_date   date,

    -- DRAFT     keyed, not numbered, not in the books
    -- APPROVED  numbered and signed for, not yet posted
    -- POSTED    in the ledger
    -- REVERSED  in the ledger, and undone by a mirror entry
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

    -- One side, one way of naming an account.
    CHECK ((from_key IS NULL) <> (from_account_code IS NULL)),
    CHECK ((to_key   IS NULL) <> (to_account_code   IS NULL)),
    -- A qualifier narrows a meaning. An account code is already narrow, so a
    -- qualifier beside one is a field nothing reads.
    CHECK (from_key IS NOT NULL OR from_qualifier = ''),
    CHECK (to_key   IS NOT NULL OR to_qualifier   = ''),
    -- Money cannot arrive where it left from. Both halves, because the same
    -- account can be named one way on one side and the other way on the other.
    CHECK (from_key IS NULL OR to_key IS NULL
           OR NOT (from_key = to_key AND from_qualifier = to_qualifier
                   AND from_site = to_site)),
    CHECK (from_account_code IS NULL OR to_account_code IS NULL
           OR from_account_code <> to_account_code),

    -- A giro is a number and a date, or it is neither.
    CHECK ((giro_number IS NULL) = (giro_due_date IS NULL)),
    -- Only money going out can be promised on paper. A receipt by giro is a
    -- giro somebody gave US, which is the other direction and its own row.
    CHECK (giro_number IS NULL OR kind = 'PAY'),

    -- The party's identity matches the shape it claims.
    CHECK ((party_kind = 'SUPPLIER') = (supplier_id IS NOT NULL)),
    CHECK ((party_kind = 'EMPLOYEE') = (employee_id IS NOT NULL)),

    -- A number and an approval are the same fact.
    CHECK ((number IS NULL) = (approved_by IS NULL)),
    CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
    CHECK (status = 'DRAFT' OR number IS NOT NULL),
    -- Posted and in the ledger are the same fact, and stay so through a
    -- reversal: the entry that recorded it is still there.
    CHECK ((status IN ('POSTED', 'REVERSED')) = (journal_entry_id IS NOT NULL)),
    CHECK ((status IN ('POSTED', 'REVERSED')) = (posted_at IS NOT NULL)),
    CHECK ((posted_at IS NULL) = (posted_by IS NULL)),
    CHECK ((status = 'REVERSED') = (reversal_entry_id IS NOT NULL))
);

CREATE INDEX ix_cash_document_date ON cash_document (doc_date DESC, number);
CREATE INDEX ix_cash_document_status ON cash_document (status, doc_date DESC);
CREATE INDEX ix_cash_document_supplier ON cash_document (supplier_id, doc_date DESC)
    WHERE supplier_id IS NOT NULL;
-- The bank line and its document each find the other. One line becomes at most
-- one document, which is the same rule `bank_line_match` keeps about journals.
CREATE UNIQUE INDEX ux_cash_document_statement_line
    ON cash_document (statement_line_id) WHERE statement_line_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invariant: a posted document is evidence
-- ---------------------------------------------------------------------------
--
-- Same shape and same argument as `protect_posted_supplier_payment` in 0084.
-- The journal entry quotes these amounts and cannot move, so neither can they.
-- The guard fires on what the row WAS, so posting itself — an UPDATE from
-- APPROVED — is allowed, and so is the single move from POSTED to REVERSED.

CREATE OR REPLACE FUNCTION protect_posted_cash_document() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('POSTED', 'REVERSED') AND (
           NEW.amount_minor      IS DISTINCT FROM OLD.amount_minor
        OR NEW.kind              IS DISTINCT FROM OLD.kind
        OR NEW.number            IS DISTINCT FROM OLD.number
        OR NEW.doc_date          IS DISTINCT FROM OLD.doc_date
        OR NEW.from_key          IS DISTINCT FROM OLD.from_key
        OR NEW.from_qualifier    IS DISTINCT FROM OLD.from_qualifier
        OR NEW.from_account_code IS DISTINCT FROM OLD.from_account_code
        OR NEW.from_site         IS DISTINCT FROM OLD.from_site
        OR NEW.to_key            IS DISTINCT FROM OLD.to_key
        OR NEW.to_qualifier      IS DISTINCT FROM OLD.to_qualifier
        OR NEW.to_account_code   IS DISTINCT FROM OLD.to_account_code
        OR NEW.to_site           IS DISTINCT FROM OLD.to_site
        OR NEW.currency          IS DISTINCT FROM OLD.currency
        OR NEW.journal_entry_id  IS DISTINCT FROM OLD.journal_entry_id
    ) THEN
        RAISE EXCEPTION
            'cash document % is %; reverse it rather than editing what already moved',
            COALESCE(OLD.number, OLD.document_id::text), lower(OLD.status);
    END IF;

    -- The status ladder only goes one way. Without this a reversed document
    -- could be walked back to POSTED and reversed twice, and the second
    -- reversal would balance perfectly while doubling the money.
    IF OLD.status = 'REVERSED' AND NEW.status <> 'REVERSED' THEN
        RAISE EXCEPTION
            'cash document % is already reversed', OLD.number;
    END IF;
    IF OLD.status = 'POSTED' AND NEW.status NOT IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION
            'cash document % is posted; the only way back is a reversal', OLD.number;
    END IF;
    IF OLD.status = 'APPROVED' AND NEW.status = 'DRAFT' THEN
        RAISE EXCEPTION
            'cash document % is approved and numbered; it cannot become a draft again',
            OLD.number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cash_document_posted_is_evidence
    BEFORE UPDATE ON cash_document
    FOR EACH ROW EXECUTE FUNCTION protect_posted_cash_document();

COMMENT ON TABLE cash_document IS
    'One movement of money between two of the company own accounts, or between one of them and the outside. KK / KM / TF in the client own numbering; the kind is derived from which side holds money and is never chosen.';
COMMENT ON COLUMN cash_document.number IS
    'KK-YY-MM-NNNNN out of cash or bank, KM-YY-MM-NNNNN into it, TF-YY-MM-NNNNN between two of our own. Assigned at approval, per kind per month.';
COMMENT ON COLUMN cash_document.from_key IS
    'A semantic key resolved through account_map at posting time. Exclusive with from_account_code: the money side always has a meaning, the other side often has none.';
