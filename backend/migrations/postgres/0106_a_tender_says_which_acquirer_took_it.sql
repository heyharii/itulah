-- 0106: A tender says which acquirer took it, and on which terminal.
--
-- # What was missing
--
-- `0077` recorded HOW a sale was settled — cash, card, QRIS — and stopped one
-- step short of WHO settled it. That step is the whole of a card
-- reconciliation. Money taken on a card does not arrive as money: it arrives
-- days later, from a named acquirer, net of that acquirer's fee, in a batch
-- their terminal closed. "We took 4,200,000 on cards on Tuesday" cannot be
-- matched against anything. "We took 2,900,000 on BCA debit, terminal
-- 21004417, batch 0143" can.
--
-- The client's own chart insists on the same distinction: they keep
-- `4010111001 Penjualan Debit BCA` beside `4010111002 Penjualan Debit
-- MANDIRI`, and `1011101001 Piutang kartu Kredit` beside `1011101002 Piutang
-- Debit Card`. A posting rule cannot choose between those from `method =
-- 'CARD'`, so until this migration the ledger could not record a card sale at
-- all without guessing.
--
-- # Why `card_kind` is a column and not read off the acquirer
--
-- Because the two are not the same fact. BCA issues debit cards and acquires
-- VISA credit transactions; a shop with one BCA terminal takes both through
-- it. Reading "BCA means debit" off the acquirer would file every credit sale
-- taken on that terminal into the debit receivable, and the trial balance
-- would still balance — which is the kind of wrong that survives a year.
--
-- It is nullable because the till has not been asked for it yet. Where it is
-- null the posting rule falls back to a named guess (a card network implies
-- credit, anything else implies debit) and records on the document that it
-- guessed. A guess written down is a guess somebody can correct; the
-- correction is `/finance/tenders/{id}/retender`.
--
-- # Why a tender gets an id
--
-- It has never needed one: `(sale_id, tender_seq)` is its identity, and that
-- is deliberate — a fact delivered twice overwrites the same row. But a
-- retender is an act performed ON one tender, so one has to be nameable in a
-- URL, and a composite key spelled into a path segment is a key somebody will
-- eventually split on the wrong character. The surrogate is additive: it
-- names the row, it does not identify it.
--
-- The default is volatile, so adding it rewrites the table and every existing
-- tender gets its own id rather than sharing one.

ALTER TABLE edge_sale_tender
    ADD COLUMN tender_id   uuid NOT NULL DEFAULT gen_random_uuid(),
    -- BCA, MANDIRI, BRI, VISA, MASTER, a QRIS provider. A name, never an
    -- instrument: the same screening `reference` gets applies here.
    ADD COLUMN acquirer    text,
    -- Which physical EDC took it. What an acquirer's settlement file is keyed
    -- by, after the merchant id.
    ADD COLUMN terminal_id text,
    -- Which batch the terminal closed it into. A card sale is reconciled
    -- against a batch, not against a day.
    ADD COLUMN batch_no    text,
    ADD COLUMN card_kind   text CHECK (card_kind IN ('DEBIT', 'CREDIT'));

CREATE UNIQUE INDEX ux_edge_sale_tender_id ON edge_sale_tender (tender_id);

-- "What did this acquirer take, and has it landed?" — the question the
-- columns exist for, asked per acquirer over a window.
CREATE INDEX ix_edge_sale_tender_acquirer ON edge_sale_tender (acquirer)
    WHERE acquirer IS NOT NULL;

COMMENT ON COLUMN edge_sale_tender.acquirer IS
    'Who settles this tender: an acquiring bank, a card network, a QRIS '
    'provider. The qualifier the posting rule resolves an account with.';
COMMENT ON COLUMN edge_sale_tender.card_kind IS
    'DEBIT or CREDIT. Null means the till did not say; the posting rule then '
    'infers it from the acquirer and records that it did.';

-- ---------------------------------------------------------------------------
-- The same three facts, on the centre's own till
-- ---------------------------------------------------------------------------
--
-- There are two populations of sale here and both are real trade: `edge_sale`
-- is what a shop synced up, `sale` is what was rung up against this node. A
-- day's takings has to include both or the books are short by whichever one
-- was left out, so `sale_payment` carries the same columns and answers the
-- same question. It already has an `id`, so it needs no surrogate.

ALTER TABLE sale_payment
    ADD COLUMN acquirer    text,
    ADD COLUMN terminal_id text,
    ADD COLUMN batch_no    text,
    ADD COLUMN card_kind   text CHECK (card_kind IN ('DEBIT', 'CREDIT'));

-- A refund goes back the way it came. Without the acquirer on the refund, a
-- card refund could only be credited to "cards", and the BCA receivable would
-- carry a balance nothing ever clears.
ALTER TABLE sale_return_payment
    ADD COLUMN acquirer  text,
    ADD COLUMN card_kind text CHECK (card_kind IN ('DEBIT', 'CREDIT'));

-- ---------------------------------------------------------------------------
-- A voucher is a tender here too
-- ---------------------------------------------------------------------------
--
-- `0090` widened `edge_sale_tender` and left the centre's two payment tables
-- on the old four values, because at the time nothing at the centre could take
-- a voucher. The posting rule below settles a voucher against a liability
-- rather than against takings, and it has to be able to see one in either
-- population. Recorded as OTHER it would be posted as takings, which is the
-- exact overstatement `0090` exists to prevent.
--
-- Dropped and recreated by name, with the full list, so this converges with
-- anything else that widens it.

ALTER TABLE sale_payment DROP CONSTRAINT IF EXISTS sale_payment_method_check;
ALTER TABLE sale_payment ADD CONSTRAINT sale_payment_method_check
    CHECK (method IN ('CASH', 'CARD', 'QRIS', 'OTHER', 'VOUCHER'));

ALTER TABLE sale_return_payment DROP CONSTRAINT IF EXISTS sale_return_payment_method_check;
ALTER TABLE sale_return_payment ADD CONSTRAINT sale_return_payment_method_check
    CHECK (method IN ('CASH', 'CARD', 'QRIS', 'OTHER', 'VOUCHER'));
