-- A shop asks head office to pay something, and the ask has a life of its own.
--
-- Spending is centralised (owner, 2026-09-07) and the shop's own pot is small:
-- petty cash covers a light bulb, not the landlord, not PLN, not the man who
-- rebuilt the shopfront. `edge/petty.rs` already meets that moment and refuses
-- the expense with "send this to head office to pay by transfer" — and until
-- now that sentence was a dead end, because there was nowhere to send it. This
-- is the somewhere.
--
-- # It posts nothing, and that is the property worth protecting
--
-- ERPNext is explicit that creating a Payment Request writes no GL entry: the
-- accounting happens only when a Payment Entry is made from it. Ours keeps
-- that exactly. There is no `journal_entry_id` on this table and no posting
-- rule anywhere for it — the money moves in the BILL and the PAYMENT it
-- becomes, both of which already have their rules, their period gate and their
-- account map. A document with a lifecycle and no accounting consequence is a
-- document that can be added without touching the ledger's guarantees at all.
--
-- The two ids at the foot are therefore evidence and not accounting:
-- `bill_id` and `payment_id` say what the ask turned into, which is what makes
-- PAID a fact about money rather than a button somebody pressed.
--
-- # Where this parts company with ERPNext, and why it has to
--
-- Theirs starts at an invoice; ours starts at a shop with a bill in its hand.
--
--  1. `reference_doctype`/`reference_name` are the spine of a Payment Request —
--     it is always raised FROM a submitted order or invoice and the amount is
--     fetched from it. A shop asking for the landlord to be paid has no such
--     document, so `bill_id` is NULLABLE, and its absence is what makes head
--     office key the bill as part of saying yes.
--  2. Their `party` is a master row chosen before the document can be saved.
--     Ours arrives as free text, for the same reason `store_expense.payee` is
--     free text: the warung on the corner will never be a supplier record, and
--     forcing one at the counter means either a fictional row per ask or the
--     ask not being made. So `payee` is text and NOT NULL, `supplier_id` is
--     nullable, and resolving the one into the other is a step in ACCEPTING
--     the instruction — see the CHECK on APPROVED below.
--  3. Their `payment_request_type` is Inward or Outward. A shop never asks head
--     office to collect, so that field does not exist here rather than existing
--     with one value.
--
-- Dropped outright, because we do not have them: payment gateways,
-- `payment_url`, the emailed payment link, subscription plans, the currency
-- picker, and `Partially Paid` — an instruction names one amount and is
-- settled by one payment; a thing that can be part-paid is a bill, and bills
-- already exist.
--
-- # The ladder
--
-- DRAFT → REQUESTED → APPROVED → PAID, with REFUSED off REQUESTED and
-- WITHDRAWN off either of the first two.
--
-- REFUSED is ours and is not ERPNext's `Cancelled`: a refusal is a decision
-- head office made and has to give a reason for, where a withdrawal is the
-- shop taking its own ask back. They are two different events and one status
-- could not tell them apart afterwards.
--
-- The rung the screen drew and this does NOT have is "In a payment run"
-- (ERPNext's Payment Order). It is left out deliberately: a payment run is a
-- second document — one person selects the batch, another releases it at the
-- bank — and until that document exists the state would be a click rather than
-- a fact. An unreachable state in a CHECK is a lie the next reader has to
-- discover. When the run is built it is one value here and one route.

CREATE SEQUENCE payment_instruction_number_seq;

CREATE TABLE payment_instruction (
    instruction_id     uuid PRIMARY KEY,
    -- PI-00000001. Minted when the row is written, not when it is submitted:
    -- a shop ringing head office about an ask needs something to say down the
    -- phone, and a draft nobody can name is a draft nobody can be helped with.
    instruction_number text NOT NULL UNIQUE CHECK (btrim(instruction_number) <> ''),

    -- Which place is asking. Not a field a person picks — it is the node the
    -- ask was raised on, and it is the dimension every posting that follows
    -- will carry. The unit is never part of an account code here.
    site_id            text NOT NULL REFERENCES site(id),

    -- The landlord, PLN, the man who fixed the roller shutter.
    payee              text NOT NULL CHECK (btrim(payee) <> ''),
    -- The payee resolved into a vendor, once head office has done it. Text and
    -- not a foreign key, because it is the same spelling `supplier_invoice`
    -- carries for the same party — a bill's supplier is `text` there too, and
    -- two different types for one idea is how the bill this becomes fails to
    -- join to the ask it came from.
    supplier_id        text,
    -- The vendor's name as it was when head office resolved it, kept beside
    -- the id exactly as `supplier_invoice` keeps it and for the same reason: a
    -- list has to print a party without a join, and the bill this becomes will
    -- carry both columns anyway.
    supplier_name      text,

    -- A sentence somebody at head office can decide on without ringing back.
    -- The one field that makes this document worth having.
    purpose            text NOT NULL CHECK (btrim(purpose) <> ''),

    -- Which kind of cost the shop says this is. The same nine
    -- `edge/petty.rs::EXPENSE_CATEGORIES` constrains, named identically, so the
    -- two routes to one cost do not disagree about what kind of thing it was.
    --
    -- It resolves to no account in this branch and is not meant to: the
    -- `store_expense` posting rule that maps these to the chart lives on the
    -- unmerged `feat/finance-control` branch. This is the shop's word about
    -- what the cost is; the account is chosen on the bill head office keys.
    category           text NOT NULL CHECK (category IN (
                           'expense_electricity', 'expense_water',
                           'expense_telephone', 'expense_household',
                           'expense_stationery', 'expense_repairs',
                           'expense_transport', 'expense_cleaning',
                           'expense_misc')),

    -- What is being asked for. One amount: see the note on Partially Paid.
    amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
    currency           text NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),

    -- When it has to be paid. What sorts head office's queue, and the only
    -- thing that makes an unanswered ask visibly late.
    needed_by          date,

    -- A bill, when one already exists. Usually absent — see #1 above.
    bill_id            uuid REFERENCES supplier_invoice(invoice_id),
    -- The payment that settled it. Nullable until PAID, and the reason PAID is
    -- a fact rather than a click.
    payment_id         uuid REFERENCES supplier_payment(payment_id),

    status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                           'DRAFT', 'REQUESTED', 'APPROVED', 'REFUSED',
                           'PAID', 'WITHDRAWN')),

    raised_by          text NOT NULL CHECK (btrim(raised_by) <> ''),
    raised_at          timestamptz NOT NULL DEFAULT now(),
    -- When the shop actually sent it. Separate from `raised_at`, because a
    -- draft written on Friday and sent on Monday is late by one measure and
    -- not by the other, and the queue is answered from this one.
    submitted_at       timestamptz,

    -- Who answered and what they said.
    decided_by         text,
    decided_at         timestamptz,
    -- Required on a refusal, optional on an approval. A no the shop cannot
    -- read is a no they will ask about twice. Enforced below.
    decision_reason    text NOT NULL DEFAULT '',

    settled_by         text,
    settled_at         timestamptz,

    note               text NOT NULL DEFAULT '',

    -- Every state that is a decision carries who made it.
    CHECK (status NOT IN ('APPROVED', 'REFUSED', 'PAID')
           OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
    -- A refusal without a reason is the defect this document exists to avoid.
    CHECK (status <> 'REFUSED' OR btrim(decision_reason) <> ''),
    -- Nothing is APPROVED or PAID until the payee is a vendor. This is the
    -- rule that makes resolving free text into a supplier part of saying yes
    -- rather than a tidy-up somebody does later: until it is filled the ask
    -- cannot become a payable anybody can age.
    CHECK (status NOT IN ('APPROVED', 'PAID') OR btrim(COALESCE(supplier_id, '')) <> ''),
    -- PAID means a payment names it, both ways round. A payment id on a
    -- document that is not paid, or a paid document with nothing behind it,
    -- are both states nobody could explain afterwards.
    CHECK ((status = 'PAID') = (payment_id IS NOT NULL)),
    CHECK ((status = 'PAID') = (settled_at IS NOT NULL)),
    -- Everything past DRAFT has been sent.
    CHECK (submitted_at IS NULL OR status <> 'DRAFT')
);

-- The queue, as head office reads it: what is waiting, oldest need first.
CREATE INDEX ix_payment_instruction_queue
    ON payment_instruction (status, needed_by NULLS LAST, raised_at);
-- And as a shop reads it: mine, newest first.
CREATE INDEX ix_payment_instruction_place
    ON payment_instruction (site_id, raised_at DESC);
CREATE INDEX ix_payment_instruction_supplier
    ON payment_instruction (supplier_id) WHERE supplier_id IS NOT NULL;

COMMENT ON TABLE payment_instruction IS
    'A shop asking head office to pay something. Posts NOTHING to the general '
    'ledger, deliberately and permanently: the accounting is in the bill and '
    'the payment it becomes. ERPNext Payment Request is the reference.';

COMMENT ON COLUMN payment_instruction.payee IS
    'Free text, like store_expense.payee: the warung on the corner will never '
    'be a supplier record. supplier_id is where head office resolves it.';

-- The ask is a record somebody argues about, so it gets to be one.
--
-- This is what gives an instruction a comment thread and an activity history
-- without a column for either — and it is also where the EVIDENCE lives. The
-- screen asks for "the quotation, the demand, the photograph of the meter";
-- that is a document linked to this record through `document_link`, which
-- already exists and already takes a (kind, id) pair. A second file column
-- here would be a second answer to a question the Files vault answers.
--
-- The HireProposal precedent is the same situation stated once already: while
-- an ask is being negotiated there is nothing else to file the conversation
-- against, and most of them never become the thing they were asking for.
INSERT INTO record_kind (code, label) VALUES
    ('payment_instruction', 'Payment instruction')
ON CONFLICT (code) DO NOTHING;
