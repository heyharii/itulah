-- 0134: What a shop proves at the end of the day, against the slip in its hand.
--
-- # The act this records
--
-- A store closes. The till knows what it took: a row in `edge_sale_tender` per
-- payment, with a method and an amount. The EDC terminal beside the till knows
-- something else: its own batch slip, printed at settlement, one line per
-- approval with a batch number, an auth code and an amount.
--
-- Those two lists should be the same list. When they are not, somebody standing
-- in the shop is the only person who can say why — and they can only say it
-- that evening, while the customer is still remembered and the slip is still on
-- the counter. A week later, at head office, the same difference is unanswerable.
--
-- So this is the shop's reconciliation, and it is deliberately NOT the bank's.
-- The owner was explicit: the store reconciles receipts against the EDC batch
-- slip PER TERMINAL. It does not reconcile against the acquirer's email, which
-- arrives the next day and belongs to the people in 0135.
--
-- # Why the terminal is part of the identity
--
-- A shop with three EDC machines settles three batches, and a receipt belongs
-- to exactly one of them. Reconciling all three together would hide the one
-- mistake this exercise exists to catch: a card swiped on the wrong machine.
-- That mistake shows up as an amount missing from one terminal's batch and
-- present in another's, and it is invisible the moment the batches are pooled.
--
-- Cash and vouchers have no terminal, and their row carries none. The CHECK
-- below says so rather than leaving a column that means nothing for two of the
-- four kinds.
--
-- # Why the batch lines are a table and not a column
--
-- A decision needs something to be a decision ABOUT. A batch line that nobody
-- has ruled on is the whole point of the closing gate — "you have not said what
-- this approval was" — and a line that only existed inside a decision row could
-- not be undecided. So the slip is keyed in first, and the decisions point at
-- it.

CREATE TABLE tender_reconciliation (
    recon_id      uuid PRIMARY KEY,
    site_id       text NOT NULL REFERENCES site(id),
    -- The trading day, not the timestamp. A sale rung at 23:58 and its
    -- settlement at 00:03 belong to one day's takings, and the till already
    -- decides which day that is.
    business_date date NOT NULL,
    -- The four things a shop can be handed. Same vocabulary as
    -- `edge_sale_tender.method` minus OTHER, which is not a thing anybody
    -- reconciles — it is the bucket a till uses when it does not know.
    tender_kind   text NOT NULL CHECK (tender_kind IN ('CASH','CARD','QRIS','VOUCHER')),
    -- Which EDC machine. Free text because it is what is printed on the slip
    -- and stuck to the machine, and this system does not own that numbering.
    terminal_id   text,

    status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),

    -- What the drawer actually held, for the cash row.
    --
    -- This is the shift variance, recorded here because there is no
    -- `cash_shift` table in this schema yet. When one arrives, the cash row
    -- should read its counted figure and its approval from there and this
    -- column should go: two places recording how much cash was in a drawer is
    -- two answers to one question, which is the failure this whole module is
    -- about. Until then, a cash reconciliation that closed with no counted
    -- figure would be a shop asserting it balanced without counting.
    counted_cash_minor bigint,

    opened_by     text NOT NULL,
    opened_at     timestamptz NOT NULL DEFAULT now(),
    closed_by     text,
    closed_at     timestamptz,

    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
    -- A terminal is a card-reading machine. Cash and vouchers pass through none.
    CHECK (terminal_id IS NULL OR tender_kind IN ('CARD','QRIS')),
    CHECK (counted_cash_minor IS NULL OR (tender_kind = 'CASH' AND counted_cash_minor >= 0))
);

-- One reconciliation per shop per day per kind per terminal, and no second one.
--
-- Two indexes rather than one UNIQUE constraint, because NULL does not equal
-- NULL: a plain `UNIQUE (site_id, business_date, tender_kind, terminal_id)`
-- would happily accept five cash rows for one day, since each has a NULL
-- terminal and therefore collides with nothing.
CREATE UNIQUE INDEX ux_tender_recon_terminal
    ON tender_reconciliation (site_id, business_date, tender_kind, terminal_id)
    WHERE terminal_id IS NOT NULL;
CREATE UNIQUE INDEX ux_tender_recon_untermined
    ON tender_reconciliation (site_id, business_date, tender_kind)
    WHERE terminal_id IS NULL;

CREATE INDEX ix_tender_recon_day ON tender_reconciliation (site_id, business_date);

COMMENT ON TABLE tender_reconciliation IS
    'One shop''s proof of one day''s takings for one tender, per EDC terminal. Against the batch slip in the shop, never against the bank — that is 0135.';

-- ---------------------------------------------------------------------------
-- The slip
-- ---------------------------------------------------------------------------
--
-- Keyed in from the printed batch, or one day read off the terminal. Either
-- way it is the acquirer's account of the same evening, and the only account
-- available before the settlement report arrives.

CREATE TABLE tender_batch_line (
    batch_line_id uuid PRIMARY KEY,
    recon_id      uuid NOT NULL REFERENCES tender_reconciliation(recon_id) ON DELETE CASCADE,

    terminal_id   text NOT NULL,
    batch_no      text NOT NULL,
    -- The approval code. This is the join to the acquirer's settlement report
    -- the next day, which is why it is NOT NULL: a line without one cannot be
    -- followed to the money.
    auth_code     text NOT NULL,
    -- Whose machine it is: BCA, MANDIRI, a QRIS provider. The same string the
    -- posting rules pass as a qualifier, so a shop and the ledger name the
    -- acquirer the same way.
    acquirer      text NOT NULL,
    amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
    captured_at   timestamptz,

    entered_by    text NOT NULL,
    entered_at    timestamptz NOT NULL DEFAULT now(),

    -- Keying the same slip twice is a no-op, not a doubling. The same argument
    -- `bank_statement_line`'s fingerprint makes, with the acquirer's own three
    -- identifiers standing in for a hash.
    UNIQUE (recon_id, terminal_id, batch_no, auth_code)
);
CREATE INDEX ix_tender_batch_line_recon ON tender_batch_line (recon_id);
-- "Was this amount approved on any other machine today?" — the retender
-- question, asked across terminals.
CREATE INDEX ix_tender_batch_line_amount ON tender_batch_line (amount_minor);

COMMENT ON TABLE tender_batch_line IS
    'One approval on one EDC batch slip. The shop''s copy of what the acquirer thinks it took, hours before the settlement report says so.';

-- ---------------------------------------------------------------------------
-- The decisions
-- ---------------------------------------------------------------------------
--
-- Five answers, and they are the owner's own words for what goes wrong:
--
--   MATCHED         a receipt and an approval are the same payment
--   NO_SETTLEMENT   the till took it and the terminal never settled it
--   OTHER_DAY       it settled, on a different day's batch
--   RETURNED        it went back to the bank — reversed, voided at the machine
--   RETENDER        it was rung on the wrong EDC, so it is owed by a different
--                   acquirer than the receipt says
--
-- A decision names a receipt, an approval, or both. Both is what MATCHED means
-- and the CHECK insists on it: a match with one side is an assertion about
-- nothing. The other four are one-sided by nature — NO_SETTLEMENT is a receipt
-- with no approval, and an approval with no receipt is a shop being asked what
-- it sold.

CREATE TABLE tender_reconciliation_decision (
    decision_id   uuid PRIMARY KEY,
    recon_id      uuid NOT NULL REFERENCES tender_reconciliation(recon_id) ON DELETE CASCADE,

    -- The till's side: which sale, and which of its tenders. Position is the
    -- tender's identity — see 0077 — so both columns travel together.
    sale_id       uuid,
    tender_seq    integer,

    -- The slip's side.
    batch_line_id uuid REFERENCES tender_batch_line(batch_line_id) ON DELETE CASCADE,

    decision      text NOT NULL CHECK (decision IN
                      ('MATCHED','NO_SETTLEMENT','OTHER_DAY','RETURNED','RETENDER')),

    -- Where the money was taken and where it belongs. Only RETENDER has an
    -- answer to that, and only RETENDER is allowed to give one.
    from_acquirer text,
    to_acquirer   text,

    note          text,
    decided_by    text NOT NULL,
    decided_at    timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (sale_id, tender_seq)
        REFERENCES edge_sale_tender (sale_id, tender_seq) ON DELETE CASCADE,

    CHECK ((sale_id IS NULL) = (tender_seq IS NULL)),
    CHECK (sale_id IS NOT NULL OR batch_line_id IS NOT NULL),
    CHECK (decision <> 'MATCHED' OR (sale_id IS NOT NULL AND batch_line_id IS NOT NULL)),
    CHECK ((decision = 'RETENDER')
           = (from_acquirer IS NOT NULL AND to_acquirer IS NOT NULL)),
    -- Guarded on NULL, and that guard is the whole of this constraint's
    -- history. `from_acquirer IS DISTINCT FROM to_acquirer` on its own reads
    -- as "the two must differ" and is true of every pair of names — but
    -- `NULL IS DISTINCT FROM NULL` is FALSE, so the bare version refused every
    -- one of the four decisions that names no acquirer at all. A shop could
    -- record a retender and nothing else.
    CHECK (from_acquirer IS NULL OR from_acquirer <> to_acquirer)
);

-- One decision per receipt tender and one per approval. Deciding twice is two
-- answers to one question, and the closing gate counts decisions.
CREATE UNIQUE INDEX ux_tender_decision_receipt
    ON tender_reconciliation_decision (sale_id, tender_seq)
    WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX ux_tender_decision_batch_line
    ON tender_reconciliation_decision (batch_line_id)
    WHERE batch_line_id IS NOT NULL;
CREATE INDEX ix_tender_decision_recon ON tender_reconciliation_decision (recon_id);

COMMENT ON TABLE tender_reconciliation_decision IS
    'What somebody in the shop said about one receipt, one approval, or the pair. Five answers, one per row, and a reconciliation cannot close while anything is unanswered.';
