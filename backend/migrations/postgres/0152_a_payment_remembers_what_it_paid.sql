-- 0152: A payment remembers what it was paid to, not where to look it up.
--
-- # The failure this prevents
--
-- A supplier changes bank in November. Somebody opens the destination and
-- edits it — one row, one screen, thirty seconds. Every payment ever made to
-- that supplier now claims to have gone to the new account, because every one
-- of them held a `destination_id` and nothing else.
--
-- In March the auditor asks which account September's four hundred million
-- went to. The system answers with an account that did not exist in September.
-- Nothing was tampered with, nothing failed, no error was raised, and the
-- payment history is wrong. This is the ordinary shape of the mistake: not
-- fraud, just a foreign key pointing at mutable data across time.
--
-- # The rule
--
-- A payment stores a frozen copy of the destination AS EXECUTED — bank, masked
-- number, holder, and the verification status at that moment — beside the
-- destination's id. The id still exists, because "which destination is this"
-- is a real question; but no read that answers "what was paid to" follows it.
--
-- The verification status is part of the copy and is the field people forget.
-- "Was this account verified when we paid it" is the question an audit asks
-- after money goes to the wrong place, and it cannot be answered by reading a
-- status that has been VERIFIED since the week after.
--
-- # Why a table and not four columns on each payment
--
-- Because there is more than one shape of payment — a cash document, a batch
-- item, and whatever the next pattern is — and the rule has to be the same for
-- all of them. Four columns copied three times is three chances to leave one
-- out; and the immutability trigger below would have to be written three times
-- too.
--
-- `(payment_kind, payment_id)` is text-and-text for the reason
-- `payment_ledger_entry.voucher_id` is: the documents that pay are not all
-- keyed the same way, and a uuid column would have refused the first one that
-- was not.
--
-- # Why it is immutable rather than versioned
--
-- A snapshot that could be corrected is not a snapshot. If the copy was taken
-- wrong, the payment was made wrong, and the answer is to reverse the payment —
-- which leaves both the original and the reversal visible — not to edit the
-- record of where the money went.

CREATE TABLE payment_destination_snapshot (
    snapshot_id     uuid PRIMARY KEY,

    -- Which payment this belongs to. `CASH_DOC`, `BATCH_ITEM`,
    -- `SUPPLIER_PAYMENT` — the kind names the table, the id names the row, and
    -- neither is a foreign key because the tables are owned by different lanes
    -- and one of them will always be the last to land.
    payment_kind    text NOT NULL CHECK (btrim(payment_kind) <> ''),
    payment_id      text NOT NULL CHECK (btrim(payment_id) <> ''),

    -- The destination this was copied from. Kept so that "which destination"
    -- can be asked; never followed to answer "what was paid to".
    destination_id  uuid REFERENCES payment_destination(destination_id),

    -- The copy. Every field a person needs to recognise the account on a bank
    -- statement, and no field that would let one be reconstructed: the number
    -- is the mask, not the number. A payment history does not need to be able
    -- to pay again.
    bank_name       text NOT NULL CHECK (btrim(bank_name) <> ''),
    bank_code       text,
    account_number_mask text NOT NULL CHECK (btrim(account_number_mask) <> ''),
    account_holder  text NOT NULL CHECK (btrim(account_holder) <> ''),
    -- What it was at the moment the money moved. See the header.
    verification_status text NOT NULL
                        CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
    verified_by     text,
    verified_at     timestamptz,

    -- The party as the payment named it, which is not always the party the
    -- destination names today either.
    party_type      text NOT NULL CHECK (party_type IN ('SUPPLIER', 'EMPLOYEE', 'OTHER')),
    party_id        text NOT NULL CHECK (btrim(party_id) <> ''),
    party_name      text NOT NULL CHECK (btrim(party_name) <> ''),

    taken_at        timestamptz NOT NULL DEFAULT now(),
    taken_by        text NOT NULL CHECK (btrim(taken_by) <> ''),

    -- One payment, one destination. A payment that genuinely went to two
    -- accounts is two payments, and the batch in 0153 is exactly that.
    UNIQUE (payment_kind, payment_id)
);

CREATE INDEX ix_payment_snapshot_destination
    ON payment_destination_snapshot (destination_id);
CREATE INDEX ix_payment_snapshot_party
    ON payment_destination_snapshot (party_type, party_id, taken_at DESC);

-- ---------------------------------------------------------------------------
-- Invariant: a snapshot is what happened
-- ---------------------------------------------------------------------------
--
-- Same argument as `protect_posted_cash_document` in 0115 and
-- `protect_posted_supplier_payment` in 0084, applied to the one row those two
-- cannot protect: the record of where their money went.
--
-- Deletion is refused as well as update. A payment whose snapshot could be
-- deleted would fall back to reading the destination, which is exactly the
-- failure this table exists to prevent, and it would do it silently.

CREATE OR REPLACE FUNCTION protect_payment_destination_snapshot() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'the record of what payment % % was paid to cannot be deleted; reverse the payment instead, which leaves both it and the reversal visible',
            OLD.payment_kind, OLD.payment_id;
    END IF;
    RAISE EXCEPTION
        'what payment % % was paid to is a copy of the account as it was when the money moved, and cannot be edited. Editing the destination is how the account changes for the NEXT payment; this one already happened',
        OLD.payment_kind, OLD.payment_id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_destination_snapshot_is_what_happened
    BEFORE UPDATE OR DELETE ON payment_destination_snapshot
    FOR EACH ROW EXECUTE FUNCTION protect_payment_destination_snapshot();

COMMENT ON TABLE payment_destination_snapshot IS
    'A frozen copy of the destination as executed, per payment. Editing a destination changes where the NEXT payment goes and never rewrites where an old one went — no read that answers "what was paid to" follows destination_id.';
COMMENT ON COLUMN payment_destination_snapshot.verification_status IS
    'The status at the moment the money moved. "Was this account verified when we paid it" is the question an audit asks, and the live row cannot answer it.';
