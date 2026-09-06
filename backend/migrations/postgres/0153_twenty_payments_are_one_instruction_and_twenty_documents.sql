-- 0153: Twenty payments are one instruction and twenty ordinary documents.
--
-- # What a batch is, and what it deliberately is not
--
-- A batch is orchestration. It is the list somebody works down: who is paid,
-- how much, from which of the company's accounts, what has been done and what
-- has not. It holds no accounting whatsoever.
--
-- Every executed item is ONE ORDINARY PAY — a `cash_document` of kind PAY,
-- numbered KK-YY-MM-NNNNN, posted by the poster like every other. There is no
-- batch posting rule, no batch journal entry, no "payroll payment" engine and
-- no "supplier payment" engine. That is the frozen architecture and this table
-- is where it would most easily have been broken: a `total_minor` on a batch is
-- exactly the sort of figure that grows a posting rule of its own.
--
-- So: `payment_batch.total_minor` is a checksum somebody reads before they
-- authorise, restated from the items by trigger. Nothing posts it, nothing
-- balances against it, and no journal entry names a batch.
--
-- # Why partial execution is the normal case and not the error case
--
-- Twenty transfers to twenty banks fail one at a time. The bank rejects one
-- account, one recipient's details are being chased, somebody's laptop dies
-- halfway down the list. A design that could only execute a batch whole would
-- meet this on its first real run and be worked around by keying nineteen
-- payments by hand.
--
-- So each item carries its own status and its own document, the batch's status
-- is derived from theirs, and executing is resumable: run it again and it picks
-- up the ones still PENDING. `EXECUTED` items are never touched twice, which is
-- what makes "run it again" safe rather than double payment.
--
-- # The unverified-destination policy, and why it is on the batch
--
-- An item whose destination nobody has verified is the ordinary friction of
-- paying people. There are two defensible answers and they suit different
-- money:
--
--   SKIP  pay the rest, leave that row unpaid with the reason on it. Right for
--         a supplier run: nineteen suppliers should not wait on one whose bank
--         details are being chased.
--   HOLD  execute nothing until it is fixed. Right for a payroll run: paying
--         nineteen of twenty people and telling the twentieth to wait is worse
--         than paying nobody today, and it is the kind of thing that reaches a
--         labour inspector.
--
-- The choice is per batch, required, and carries a reason, because a default
-- here is a policy nobody chose that everybody inherits. `unverified_policy`
-- and `unverified_policy_reason` are both NOT NULL for that reason: the person
-- who set it up has to have decided, and to have said why.

CREATE TABLE payment_batch (
    batch_id        uuid PRIMARY KEY,

    -- What this batch came out of. `PAYROLL_RUN`, `SUPPLIER_BILLS`,
    -- `FUND_ALLOCATION`, `AD_HOC`. Text and not an enum because the list of
    -- things that can produce a batch is exactly the list of domains that own
    -- obligations, and it grows; the payment side does not care which, which is
    -- the whole point of there being one execution layer.
    source_kind     text NOT NULL CHECK (btrim(source_kind) <> ''),
    -- The sealed run, the selection, the allocation this came from. NULL for a
    -- list somebody typed.
    source_id       text,

    -- Where the money leaves from: one of the company's own money accounts,
    -- named by meaning and resolved through `account_map` at execution time.
    -- Never an account code — see `cash_document.from_key` for the argument,
    -- which is the same one.
    from_key        text NOT NULL CHECK (btrim(from_key) <> ''),
    from_qualifier  text NOT NULL DEFAULT '',
    site_id         text NOT NULL REFERENCES site(id),

    method          text NOT NULL CHECK (method IN ('BANK_TRANSFER', 'CASH', 'GIRO')),
    doc_date        date NOT NULL,
    currency        char(3) NOT NULL DEFAULT 'IDR',

    -- Restated from the items by the trigger below. A checksum for a person to
    -- read before they authorise, and nothing else: no entry names it.
    total_minor     bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
    item_count      integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),

    unverified_policy text NOT NULL CHECK (unverified_policy IN ('SKIP', 'HOLD')),
    -- Why that policy, in the words of whoever chose it. NOT NULL: see header.
    unverified_policy_reason text NOT NULL CHECK (btrim(unverified_policy_reason) <> ''),

    -- DRAFT      being built
    -- READY      authorised, nothing executed
    -- PARTIAL    some items executed, some still pending
    -- EXECUTED   nothing left pending
    -- HELD       stopped by the HOLD policy, or by hand
    -- CANCELLED  abandoned; executed items stay executed
    status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'READY', 'PARTIAL', 'EXECUTED', 'HELD', 'CANCELLED')),
    held_reason     text,

    memo            text NOT NULL CHECK (btrim(memo) <> ''),

    created_by      text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at      timestamptz NOT NULL DEFAULT now(),
    authorised_by   text,
    authorised_at   timestamptz,
    cancelled_by    text,
    cancelled_at    timestamptz,
    cancelled_reason text,

    CHECK ((authorised_by IS NULL) = (authorised_at IS NULL)),
    CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL)),
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
    CHECK (status <> 'HELD' OR btrim(COALESCE(held_reason, '')) <> ''),
    -- Nothing may be executed out of a batch nobody authorised. The item's own
    -- trigger enforces the other half.
    CHECK (status IN ('DRAFT', 'CANCELLED') OR authorised_at IS NOT NULL)
);

CREATE INDEX ix_payment_batch_status ON payment_batch (status, doc_date DESC);
CREATE INDEX ix_payment_batch_source ON payment_batch (source_kind, source_id);

-- ---------------------------------------------------------------------------
-- The items
-- ---------------------------------------------------------------------------

CREATE TABLE payment_batch_item (
    item_id         uuid PRIMARY KEY,
    batch_id        uuid NOT NULL REFERENCES payment_batch(batch_id) ON DELETE CASCADE,
    -- What the person reads down. Stable, so "row 14 failed" means something
    -- tomorrow.
    line_number     integer NOT NULL CHECK (line_number > 0),

    party_type      text NOT NULL CHECK (party_type IN ('SUPPLIER', 'EMPLOYEE', 'OTHER')),
    party_id        text NOT NULL CHECK (btrim(party_id) <> ''),
    party_name      text NOT NULL CHECK (btrim(party_name) <> ''),

    -- The destination chosen when the batch was built. May be NULL: a row for
    -- somebody with no account on file is a row that has to EXIST, or the
    -- policy above has nothing to act on and the person is silently missing
    -- from the run.
    destination_id  uuid REFERENCES payment_destination(destination_id),
    -- The frozen copy, written at execution. See 0152. Not a copy of the
    -- columns: one row over there, one rule, one immutability trigger.
    snapshot_id     uuid REFERENCES payment_destination_snapshot(snapshot_id),

    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),

    -- What this pays. `BILL` and an invoice id, `PAYROLL_SLIP` and a slip id,
    -- or nothing at all for a payment that answers no recorded obligation.
    obligation_kind text,
    obligation_id   text,
    -- What the recipient will recognise on their statement: an invoice number,
    -- a period. Free text because it is printed, not joined on.
    obligation_reference text,

    -- PENDING   not yet done
    -- EXECUTED  a cash document exists and is posted
    -- SKIPPED   passed over by policy; `skip_reason` says why
    -- FAILED    tried and refused; `skip_reason` carries the refusal
    status          text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'EXECUTED', 'SKIPPED', 'FAILED')),
    skip_reason     text,

    -- The bank's own reference for the transfer, keyed back in from the
    -- receipt. The only thread between this row and the bank statement.
    bank_reference  text,

    -- The ordinary PAY this item produced.
    --
    -- Deliberately NOT a foreign key to `cash_document`. The money-execution
    -- layer is 0115 and lands in a different lane from this one; a foreign key
    -- would make the order the two are applied in load-bearing, and the house
    -- pattern across these lanes is that no lane's table points at another
    -- lane's. The reference is one-way and by id, which is all orchestration
    -- needs: the batch finds the document, the document knows nothing about the
    -- batch, and neither is required for the other to exist.
    cash_document_id uuid,

    executed_by     text,
    executed_at     timestamptz,

    UNIQUE (batch_id, line_number),
    CHECK ((executed_by IS NULL) = (executed_at IS NULL)),
    -- Executed means a document exists. Both halves, so neither an item that
    -- claims to be paid with nothing behind it nor a document attached to a
    -- pending row can be written.
    CHECK ((status = 'EXECUTED') = (cash_document_id IS NOT NULL)),
    CHECK ((status = 'EXECUTED') = (executed_at IS NOT NULL)),
    CHECK ((status = 'EXECUTED') = (snapshot_id IS NOT NULL)),
    -- Passing over a row and failing on one both have to say why. A blank
    -- reason on a skipped payment is the person it belonged to asking a
    -- question nobody can answer.
    CHECK (status NOT IN ('SKIPPED', 'FAILED') OR btrim(COALESCE(skip_reason, '')) <> ''),
    CHECK ((obligation_kind IS NULL) = (obligation_id IS NULL))
);

CREATE INDEX ix_payment_batch_item_batch ON payment_batch_item (batch_id, line_number);
CREATE INDEX ix_payment_batch_item_pending
    ON payment_batch_item (batch_id) WHERE status = 'PENDING';
CREATE INDEX ix_payment_batch_item_party ON payment_batch_item (party_type, party_id);
-- One document, one item. Two items claiming the same cash document would be
-- one payment counted twice in a run's total.
CREATE UNIQUE INDEX ux_payment_batch_item_document
    ON payment_batch_item (cash_document_id) WHERE cash_document_id IS NOT NULL;
-- The same obligation may not be paid twice out of live batches. Cancelled
-- batches are excluded because an abandoned plan should not block the real one.
CREATE UNIQUE INDEX ux_payment_batch_item_obligation
    ON payment_batch_item (obligation_kind, obligation_id)
    WHERE obligation_id IS NOT NULL AND status IN ('PENDING', 'EXECUTED');

-- ---------------------------------------------------------------------------
-- Invariant: an executed item is evidence, and a batch's total is its items'
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION protect_executed_batch_item() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'EXECUTED' THEN
            RAISE EXCEPTION
                'line % of this batch has been paid and cannot be removed; reverse the cash document instead',
                OLD.line_number;
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status = 'EXECUTED' AND (
           NEW.amount_minor     IS DISTINCT FROM OLD.amount_minor
        OR NEW.party_id         IS DISTINCT FROM OLD.party_id
        OR NEW.party_type       IS DISTINCT FROM OLD.party_type
        OR NEW.destination_id   IS DISTINCT FROM OLD.destination_id
        OR NEW.snapshot_id      IS DISTINCT FROM OLD.snapshot_id
        OR NEW.cash_document_id IS DISTINCT FROM OLD.cash_document_id
        OR NEW.status           IS DISTINCT FROM OLD.status
    ) THEN
        RAISE EXCEPTION
            'line % has been paid; the money is gone and the row is the record of it. Only the bank reference may still be filled in',
            OLD.line_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_batch_item_paid_is_evidence
    BEFORE UPDATE OR DELETE ON payment_batch_item
    FOR EACH ROW EXECUTE FUNCTION protect_executed_batch_item();

-- The total is re-summed, never incremented, for the reason
-- `payment_ledger_entry.settled_minor` is: a running total and the rows it
-- summarises drift, and the drift is invisible until somebody adds the column
-- up by hand.
CREATE OR REPLACE FUNCTION restate_payment_batch_total() RETURNS trigger AS $$
DECLARE
    target uuid;
BEGIN
    target := COALESCE(NEW.batch_id, OLD.batch_id);
    UPDATE payment_batch b
       SET total_minor = COALESCE((
               SELECT SUM(i.amount_minor) FROM payment_batch_item i
                WHERE i.batch_id = target AND i.status <> 'SKIPPED'), 0),
           item_count = (SELECT COUNT(*) FROM payment_batch_item i WHERE i.batch_id = target)
     WHERE b.batch_id = target;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_batch_total_follows_its_items
    AFTER INSERT OR UPDATE OR DELETE ON payment_batch_item
    FOR EACH ROW EXECUTE FUNCTION restate_payment_batch_total();

COMMENT ON TABLE payment_batch IS
    'One instruction covering many recipients. Orchestration only: total_minor is a checksum restated from the items, no journal entry names a batch, and every executed item is one ordinary PAY cash document.';
COMMENT ON COLUMN payment_batch.unverified_policy IS
    'SKIP or HOLD, per batch, required, with a reason beside it. What happens to an item whose destination nobody has verified — the two answers suit different money and a default here would be a policy nobody chose.';
COMMENT ON TABLE payment_batch_item IS
    'One recipient in a batch. Carries its own status so a run can be executed in part and resumed; EXECUTED items are never touched twice, which is what makes resumption safe rather than double payment.';
COMMENT ON COLUMN payment_batch_item.cash_document_id IS
    'The ordinary PAY this produced. No foreign key on purpose: the money-execution layer is another lane''s table and no lane here points at another''s.';
