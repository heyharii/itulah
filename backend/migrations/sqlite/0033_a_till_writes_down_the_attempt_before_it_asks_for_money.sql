-- 0033: A till writes down the attempt before it asks for money.
--
-- `sale.status` is `CHECK (status = 'COMPLETED')`, and that check is correct
-- about what a `sale` row means: a movement group, a completion time, goods out
-- of the door. It is also the reason the till has nowhere to record the seconds
-- that matter most.
--
-- The sale is written in one SQLite transaction — movement, sale, tenders,
-- lines, sync fact — so it is all there or none of it is. **The money is taken
-- outside that transaction.** A card terminal is asked for Rp500.000 and
-- answers some seconds later; the sale is written after. If the process dies in
-- that gap the shopper has been charged and the shop has no record that
-- anything happened. Not a wrong record — no record, and nothing to match the
-- customer's bank statement against when they come back.
--
-- So the attempt gets its own row, written and COMMITTED before the first
-- tender is asked for. After that every outcome is recoverable: the sale
-- commits and the checkout becomes COMPLETED in the same transaction; the
-- process dies and the checkout is still FINALIZING at the next start, naming
-- the acquirer references to go and ask about; a tender declines and the
-- checkout is FAILED with any tender that DID succeed named, so it can be
-- reversed rather than quietly kept.
--
-- A separate table rather than widening `sale`, because a FINALIZING row has no
-- movement group and no completion time, and a `sale` that has neither is not a
-- sale. SQLite cannot alter a CHECK without rebuilding the table either, and a
-- rebuild of the one table every shop's takings live in is not a price worth
-- paying to merge two things that mean different things.

CREATE TABLE IF NOT EXISTS checkout (
    id TEXT PRIMARY KEY,
    -- The same key the sale will use. A retried checkout finds its own row
    -- instead of opening a second attempt against the same basket — which is
    -- how one shopper gets charged twice.
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN
        ('FINALIZING', 'COMPLETED', 'VOIDED', 'FAILED')),
    actor_id TEXT NOT NULL,
    shift_id TEXT,
    -- What the till was about to charge. Held here as well as on the sale
    -- because during FINALIZING there is no sale to read it from, and a
    -- recovery that cannot say how much was at stake is not a recovery.
    total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
    -- Why this basket came to this number, answerable offline with the customer
    -- still at the counter.
    pricing_trace_id TEXT,
    opened_at TEXT NOT NULL,
    -- When the till stopped being able to prove no money had moved.
    finalizing_at TEXT,
    resolved_at TEXT,
    -- The sale this became. NULL until COMPLETED, and the join that lets a
    -- receipt be traced back to the attempt behind it.
    sale_id TEXT REFERENCES sale(id),
    -- What went wrong, in the acquirer's words. Kept because "it failed" is not
    -- something a person can act on and "declined: insufficient funds" is.
    last_error TEXT,

    -- The two facts that must agree, stated as a constraint rather than left to
    -- the code that writes them: a COMPLETED checkout has a sale, and anything
    -- that is not COMPLETED does not.
    CHECK (
        (status = 'COMPLETED' AND sale_id IS NOT NULL AND resolved_at IS NOT NULL)
     OR (status IN ('VOIDED', 'FAILED') AND sale_id IS NULL AND resolved_at IS NOT NULL)
     OR (status = 'FINALIZING' AND sale_id IS NULL AND resolved_at IS NULL)
    ),
    -- FINALIZING is the state that says money may have moved, so it must say
    -- when. A row that claims the state without the timestamp cannot be aged,
    -- and an unresolved checkout nobody can age is one nobody chases.
    CHECK (status <> 'FINALIZING' OR finalizing_at IS NOT NULL)
);

-- The recovery query: what is still unresolved, oldest first. Partial, because
-- the answer is almost always empty and a full index on a column that is
-- 'COMPLETED' a million times over would be read once a day.
CREATE INDEX IF NOT EXISTS ix_checkout_unresolved
    ON checkout (opened_at)
    WHERE status = 'FINALIZING';

CREATE TABLE IF NOT EXISTS checkout_tender (
    checkout_id TEXT NOT NULL REFERENCES checkout(id),
    -- Position, matching `sale_tender.tender_seq`, so an attempt and the sale
    -- it became line up tender for tender without a second identifier.
    tender_seq INTEGER NOT NULL,
    method TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    -- The shop's own reference, typed or scanned at the counter.
    reference TEXT,
    -- The same five words `sale_return_payment.status` uses (postgres 0164). A
    -- refund attempt and a payment attempt are the same shape of fact pointing
    -- opposite ways; two vocabularies for it gives two reports that cannot be
    -- joined.
    status TEXT NOT NULL CHECK (status IN
        ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    -- Retrying a declined card is ordinary. Retrying by writing a SECOND tender
    -- row is a double charge, so the attempts hang off the one row.
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    -- What the acquirer calls this, which is the only handle a shop has when it
    -- has to ring up and ask whether Rp500.000 went through.
    external_reference TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL,

    PRIMARY KEY (checkout_id, tender_seq)
);
