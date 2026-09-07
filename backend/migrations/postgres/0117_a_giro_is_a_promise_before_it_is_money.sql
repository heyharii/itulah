-- 0117: A giro is a promise before it is money.
--
-- # What was wrong, in one sentence
--
-- 0084 let a supplier payment carry method `GIRO`, and `payments.rs` credited
-- `bank_giro` when it posted. So the moment somebody wrote out a post-dated
-- giro, the books said the bank account was that much emptier — weeks before
-- the bank had heard of it. `giro_outstanding` was in `required_semantic_keys`
-- from the first day of the ledger and nothing ever wrote to it.
--
-- The consequence is not academic. The client pays most of its suppliers by
-- giro, thirty to ninety days out. Every one of those is a liability that
-- exists and a bank balance that does not move, and a system that books them as
-- gone will show a bank balance nobody can reconcile against a statement and a
-- cash position that is wrong in the direction that hurts.
--
-- # The states, and what each one costs
--
--   ISSUED     written out. `Dr payable / Cr giro_outstanding` — the debt has
--              moved from the supplier to the instrument, and no money moved.
--   DELIVERED  handed over. Nothing in the ledger changes; it is a fact about
--              where the paper is, and it is the difference between a giro we
--              can still tear up and one we cannot.
--   DUE        the date has arrived and the bank has not taken it yet. Also no
--              posting — this is a state a report derives and a person confirms,
--              and it exists so "overdue" is a thing the board can say.
--   CLEARED    the bank took it. `Dr giro_outstanding / Cr bank_giro`, and NOW
--              the bank balance moves. Driven by the statement line, which is
--              why `cleared_line_id` is here.
--   REJECTED   the bank refused it, or we stopped it. The issue posting is
--              reversed, the payable it settled reopens, and the supplier is
--              owed again.
--
-- Only CLEARED and REJECTED end it, and each does it once.
--
-- # Why the payment gets a REVERSED status
--
-- A rejected giro has to give the bill back. `supplier_payment_allocation`
-- holds the bill against `status IN ('DRAFT','POSTED')`, so as long as the
-- payment reads POSTED the bill stays fully allocated and cannot be paid
-- again — which is exactly wrong when the giro bounced.
--
-- 0084 said there would be no VOID, and gave the reason: reversing a payment
-- did not exist as an act. It does now. REVERSED is not a way to edit a posted
-- payment — the row stays frozen, the entry stays in the ledger, and a mirror
-- entry sits beside it. It is the state that says "this money did not, in the
-- end, leave", and the allocation rules already read the status, so the bill
-- reopens without another table learning about giros.

-- ---------------------------------------------------------------------------
-- A payment can be undone
-- ---------------------------------------------------------------------------

-- The three constraints 0084 wrote about status were left unnamed, and an
-- unnamed table-level CHECK gets a positional name — `supplier_payment_check1`
-- — that depends on what order they happened to be written in. Finding them by
-- what they SAY rather than by what Postgres called them is the difference
-- between a migration that works and one that drops the wrong constraint on a
-- database where somebody added a fourth.
DO $$
DECLARE victim text;
BEGIN
    FOR victim IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'supplier_payment'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%status%'
           AND (pg_get_constraintdef(oid) LIKE '%journal_entry_id%'
             OR pg_get_constraintdef(oid) LIKE '%posted_at%'
             OR pg_get_constraintdef(oid) LIKE '%DRAFT%')
    LOOP
        EXECUTE format('ALTER TABLE supplier_payment DROP CONSTRAINT %I', victim);
    END LOOP;
END $$;

-- Posted and in the ledger were the same fact; they still are through a
-- reversal, because the entry that recorded the payment is still there and the
-- mirror sits beside it.
ALTER TABLE supplier_payment
    ADD COLUMN reversal_entry_id uuid REFERENCES journal_entry(entry_id),
    ADD COLUMN reversed_by       text,
    ADD COLUMN reversed_at       timestamptz,
    ADD COLUMN reversal_reason   text,
    ADD CONSTRAINT supplier_payment_status_check
        CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
    ADD CONSTRAINT supplier_payment_is_in_the_ledger
        CHECK ((status IN ('POSTED', 'REVERSED')) = (journal_entry_id IS NOT NULL)),
    ADD CONSTRAINT supplier_payment_was_posted_by_somebody
        CHECK ((status IN ('POSTED', 'REVERSED')) = (posted_at IS NOT NULL)),
    ADD CONSTRAINT supplier_payment_reversal_is_whole
        CHECK ((status = 'REVERSED') = (reversal_entry_id IS NOT NULL)),
    ADD CONSTRAINT supplier_payment_reversal_is_signed
        CHECK ((reversed_by IS NULL) = (reversal_entry_id IS NULL));

-- 0084 froze every column of a posted payment, `status` included, so that a
-- posted payment could not be walked back to DRAFT and re-allocated. POSTED to
-- REVERSED is the one move that must be allowed, and only that one: it writes
-- a mirror entry rather than editing anything the original entry quotes.
CREATE OR REPLACE FUNCTION protect_posted_supplier_payment() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('POSTED', 'REVERSED') AND (
           NEW.total_minor       IS DISTINCT FROM OLD.total_minor
        OR NEW.site_id           IS DISTINCT FROM OLD.site_id
        OR NEW.payment_date      IS DISTINCT FROM OLD.payment_date
        OR NEW.account_key       IS DISTINCT FROM OLD.account_key
        OR NEW.account_qualifier IS DISTINCT FROM OLD.account_qualifier
        OR NEW.currency          IS DISTINCT FROM OLD.currency
        OR NEW.payment_number    IS DISTINCT FROM OLD.payment_number
        OR NEW.journal_entry_id  IS DISTINCT FROM OLD.journal_entry_id
    ) THEN
        RAISE EXCEPTION
            'payment % is posted; reverse its journal entry rather than editing what left the bank',
            OLD.payment_number;
    END IF;
    -- The one move the ladder allows, and the two it does not.
    IF OLD.status = 'POSTED' AND NEW.status NOT IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION
            'payment % is posted; the only way back is a reversal', OLD.payment_number;
    END IF;
    IF OLD.status = 'REVERSED' AND NEW.status <> 'REVERSED' THEN
        RAISE EXCEPTION
            'payment % is already reversed', OLD.payment_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- The instrument itself
-- ---------------------------------------------------------------------------

CREATE TABLE giro (
    giro_id      uuid PRIMARY KEY,

    -- OUT  we wrote it: a liability until the bank takes it.
    -- IN   a customer gave us one: an asset until it clears.
    --
    -- Both directions are modelled because the client takes giros from its
    -- wholesale accounts, and a table that only knew about the ones we write
    -- would send the other half back to being a manual journal.
    direction    text NOT NULL CHECK (direction IN ('OUT', 'IN')),

    -- The number printed on the paper. The bank's, not ours.
    number       text NOT NULL CHECK (btrim(number) <> ''),
    -- Which bank, in the same word `account_map` uses as a qualifier — `BCA`,
    -- `MANDIRI`. It is what picks the right `giro_outstanding` leaf, so it is
    -- the qualifier and not a free-text bank name.
    bank         text NOT NULL CHECK (btrim(bank) <> ''),
    site_id      text NOT NULL REFERENCES site(id),

    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency     char(3) NOT NULL DEFAULT 'IDR',

    issue_date   date NOT NULL,
    -- Post-dated is the entire point of the instrument.
    due_date     date NOT NULL,

    status       text NOT NULL DEFAULT 'ISSUED'
                 CHECK (status IN ('ISSUED', 'DELIVERED', 'DUE', 'CLEARED', 'REJECTED')),

    -- Where it came from. Exactly one: a giro is written to settle bills
    -- (a supplier payment) or to move money on its own (a cash document), and
    -- one that claimed both would have two postings behind one instrument.
    supplier_payment_id uuid REFERENCES supplier_payment(payment_id),
    cash_document_id    uuid REFERENCES cash_document(document_id),

    -- The entry that put it on `giro_outstanding`. Kept so a rejection can
    -- reverse exactly that entry rather than resolving the meanings again —
    -- `poster::reverse`'s argument, in a column.
    issue_entry_id    uuid REFERENCES journal_entry(entry_id),
    -- The entry that moved it off `giro_outstanding` and onto the bank.
    clearing_entry_id uuid REFERENCES journal_entry(entry_id),
    -- The statement line that proves the bank took it.
    cleared_line_id   uuid REFERENCES bank_statement_line(line_id),
    cleared_on        date,

    rejected_reason   text,
    rejected_on       date,

    recorded_by  text NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at  timestamptz NOT NULL DEFAULT now(),
    settled_by   text,
    settled_at   timestamptz,

    CHECK (due_date >= issue_date),
    CHECK (num_nonnulls(supplier_payment_id, cash_document_id) = 1),
    CHECK ((status = 'CLEARED') = (clearing_entry_id IS NOT NULL)),
    CHECK ((status = 'CLEARED') = (cleared_on IS NOT NULL)),
    CHECK ((status = 'REJECTED') = (rejected_on IS NOT NULL)),
    CHECK (status <> 'REJECTED' OR btrim(COALESCE(rejected_reason, '')) <> ''),
    CHECK ((status IN ('CLEARED', 'REJECTED')) = (settled_by IS NOT NULL)),
    CHECK ((settled_by IS NULL) = (settled_at IS NULL)),
    -- Two giros can carry one number at two banks; one bank cannot issue the
    -- same number twice in one direction.
    UNIQUE (bank, direction, number)
);
CREATE INDEX ix_giro_due ON giro (status, due_date)
    WHERE status IN ('ISSUED', 'DELIVERED', 'DUE');
CREATE INDEX ix_giro_bank ON giro (bank, status, due_date);
CREATE INDEX ix_giro_payment ON giro (supplier_payment_id)
    WHERE supplier_payment_id IS NOT NULL;
-- A statement line settles one giro, the same way it matches one journal line.
CREATE UNIQUE INDEX ux_giro_cleared_line ON giro (cleared_line_id)
    WHERE cleared_line_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invariant: a settled giro is settled
-- ---------------------------------------------------------------------------
--
-- The ladder runs ISSUED -> DELIVERED -> DUE -> CLEARED | REJECTED, and only
-- forwards. A cleared giro walked back to ISSUED and cleared again would post a
-- second, perfectly balanced entry moving money that moved once.

CREATE OR REPLACE FUNCTION protect_settled_giro() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('CLEARED', 'REJECTED') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION
            'giro % at % is already %; it cannot be settled twice',
            OLD.number, OLD.bank, lower(OLD.status);
    END IF;
    IF OLD.status IN ('CLEARED', 'REJECTED') AND (
           NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
        OR NEW.bank         IS DISTINCT FROM OLD.bank
        OR NEW.number       IS DISTINCT FROM OLD.number
        OR NEW.due_date     IS DISTINCT FROM OLD.due_date
    ) THEN
        RAISE EXCEPTION
            'giro % at % is %; what it was written for cannot change afterwards',
            OLD.number, OLD.bank, lower(OLD.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER giro_settled_is_settled
    BEFORE UPDATE ON giro
    FOR EACH ROW EXECUTE FUNCTION protect_settled_giro();

COMMENT ON TABLE giro IS
    'A post-dated instrument, ours or a customers. Outstanding until the bank takes it: issuing credits giro_outstanding, not the bank, and only clearing moves the bank balance.';
COMMENT ON COLUMN giro.bank IS
    'The account_map qualifier — BCA, MANDIRI — because it is what picks the giro_outstanding and bank_giro leaves, not a display name.';
COMMENT ON COLUMN supplier_payment.status IS
    'DRAFT keyed, POSTED in the ledger, REVERSED undone by a mirror entry. A reversed payment holds no bill: the allocation rules count DRAFT and POSTED only.';
