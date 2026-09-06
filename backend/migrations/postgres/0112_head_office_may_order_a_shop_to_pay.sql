-- 0112: The written order that lets a shop pay somebody out of its takings.
--
-- # The rule this enforces
--
-- Store cash is head office's money. A shop may not spend it — not on its own
-- electricity bill, not on a supplier at the door, not on anything. The only
-- two things a shop may do with its takings are bank them (0111) and pay
-- somebody head office has told it, in writing, to pay.
--
-- That second act is what this table is. `PB-26-09-00001` — perintah bayar — is
-- an instruction that exists BEFORE the money moves, names who is to be paid
-- and why, and is confirmed by head office afterwards against the shop's
-- evidence. Without the document the same act is indistinguishable from a shop
-- helping itself, and the distinction is the whole control.
--
-- # Why the ladder has five rungs and not three
--
--   ISSUED     head office has written the order
--   WAIT_CASH  the shop has not got that much; the order stands and waits
--   EXECUTED   the shop has paid, and says so with evidence
--   CONFIRMED  head office has seen the evidence; NOW it is in the books
--   CANCELLED  withdrawn before it was executed
--
-- WAIT_CASH is the rung worth defending. The alternative is to refuse to issue
-- an order a shop cannot yet afford, which sounds tidier and is worse: the
-- order is head office's decision and the shop's balance is a fact about this
-- afternoon. Refusing would mean the decision has to be re-made tomorrow by
-- somebody who has to remember to. Here it is made once and waits.
--
-- # Why nothing posts until CONFIRMED
--
-- EXECUTED is the shop's claim. It is recorded — with who paid, when, and a
-- photograph of the receipt — and it moves nothing in the ledger, because a
-- shop asserting it paid a supplier is not the same as head office knowing it
-- did. CONFIRMED is a person at head office looking at the evidence. That is
-- the maker/checker split this repository already reaches for wherever money
-- is involved, and it is the reason `confirmed_by` may not equal `executed_by`.
--
-- The entry at CONFIRMED credits the shop's cash and debits whatever the order
-- was for:
--
--   SUPPLIER      Dr trade_payable, carrying the supplier, at HO
--   EXPENSE       Dr <the expense meaning>, at whichever site bears the cost
--   BANK_ACCOUNT  Dr bank, at HO, qualified
--   OTHER_SITE    Dr cash, at the shop that received it
--
-- All but the last are cross-site, deliberately: the credit belongs where the
-- cash was and the debit belongs where the obligation was. The affiliate legs
-- that make each location balance on its own are the poster's job, not this
-- module's, so that every cross-site entry gets them and not merely the ones
-- somebody remembered to write them for.

CREATE TABLE remittance_instruction (
    instruction_id   uuid PRIMARY KEY,
    -- `PB-26-09-00001`, restarting each month. See 0110's counter table for why
    -- these are gapless and journal numbers are not.
    instruction_number text NOT NULL UNIQUE CHECK (btrim(instruction_number) <> ''),

    -- The shop being told to pay. Its cash is what will be credited.
    site_id          text NOT NULL REFERENCES site(id),
    amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
    currency         char(3) NOT NULL DEFAULT 'IDR',

    destination_kind text NOT NULL CHECK (destination_kind IN
                         ('SUPPLIER', 'BANK_ACCOUNT', 'EXPENSE', 'OTHER_SITE')),
    -- What `destination_kind` says it is: a `supplier.id`, a bank qualifier, a
    -- semantic key naming an expense, or a `site.id`. Not four nullable foreign
    -- keys, because three of them would be null on every row and the fourth
    -- would still not be checkable — a semantic key is not a table.
    --
    -- The application resolves it and refuses an unknown one before the order
    -- can be issued, so a bad reference cannot reach a posting rule.
    destination_ref  text NOT NULL CHECK (btrim(destination_ref) <> ''),
    -- Where the DEBIT lands. Head office for a supplier or a bank; the site
    -- that bears the cost for an expense; the receiving shop for a cash
    -- handover. Written down rather than derived at posting time, because the
    -- entry has to be reproducible after somebody edits a default.
    destination_site_id text NOT NULL REFERENCES site(id),
    -- Which bank meaning, when the destination is one. Null otherwise.
    bank_key         text CHECK (bank_key IS NULL OR bank_key IN ('bank_giro', 'bank_savings')),

    -- Why. Free text and mandatory: an order to hand over cash with no stated
    -- reason is the document this table exists to make impossible.
    purpose          text NOT NULL CHECK (btrim(purpose) <> ''),

    status           text NOT NULL CHECK (status IN
                         ('ISSUED', 'WAIT_CASH', 'EXECUTED', 'CONFIRMED', 'CANCELLED')),

    issued_by        text NOT NULL CHECK (btrim(issued_by) <> ''),
    issued_at        timestamptz NOT NULL DEFAULT now(),
    due_date         date,

    executed_by      text,
    executed_at      timestamptz,
    -- The shop's evidence: a signed receipt, a transfer slip.
    proof_file_id    uuid REFERENCES stored_file(file_id),
    execution_note   text,

    confirmed_by     text,
    confirmed_at     timestamptz,
    journal_entry_id uuid REFERENCES journal_entry(entry_id),

    cancelled_by     text,
    cancelled_at     timestamptz,
    cancel_reason    text,

    CHECK ((executed_by IS NULL) = (executed_at IS NULL)),
    CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
    CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL)),
    CHECK ((status IN ('EXECUTED', 'CONFIRMED')) = (executed_at IS NOT NULL)),
    CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
    CHECK ((journal_entry_id IS NOT NULL) = (status = 'CONFIRMED')),
    -- The maker is not the checker. Head office writes the order, the shop
    -- pays it, head office confirms it — and the person who says the money
    -- left may not be the person who says they believe it.
    CHECK (confirmed_by IS NULL OR confirmed_by <> executed_by),
    -- A bank destination names a bank; nothing else may.
    CHECK ((bank_key IS NOT NULL) = (destination_kind = 'BANK_ACCOUNT')),
    -- Cash to another shop goes to a different shop.
    CHECK (destination_kind <> 'OTHER_SITE' OR destination_site_id <> site_id)
);

-- The shop's own queue: what am I being asked to pay, and what am I waiting for
-- the cash to cover.
CREATE INDEX ix_remittance_site_status ON remittance_instruction (site_id, status, issued_at DESC);
-- Head office's queue: what have shops paid that nobody has confirmed.
CREATE INDEX ix_remittance_awaiting_confirmation ON remittance_instruction (executed_at)
    WHERE status = 'EXECUTED';
CREATE INDEX ix_remittance_destination ON remittance_instruction (destination_kind, destination_ref);

COMMENT ON TABLE remittance_instruction IS
    'Head office ordering a shop to pay somebody out of its takings. Nothing '
    'posts until head office confirms the shop''s evidence, and the confirmer '
    'may not be the executor.';
