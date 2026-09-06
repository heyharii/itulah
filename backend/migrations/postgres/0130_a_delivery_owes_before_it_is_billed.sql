-- 0130: A delivery owes something the moment it is accepted.
--
-- # What 0052 decided, and what changed
--
-- 0052 refused a goods-received-not-invoiced account on the grounds that the
-- client's chart has none, and said so plainly: goods that have arrived and not
-- been billed are in the warehouse and not in the ledger, so at a month end
-- both inventory and payables understate by that amount.
--
-- The chart does have one. `2012001002 Hutang Supplier Barang Dagang - Suspend`
-- sits beside `2012001001 Hutang Suppliers Barang Dagangan` with a leaf for
-- every location, and it is what a suspend account is for: the liability that
-- exists because the goods are here, held apart from the liability that exists
-- because a bill has been agreed. Nothing is being invented — the account was
-- in the client's file all along and nothing has ever posted to it. The owner
-- has decided receipts land there and bills clear it.
--
-- So the entry that was missing is now written:
--
--     Dr inventory          (receiving site, accepted quantity x PO price)
--     Cr supplier_suspend   (same site, qualified by the supplier)
--
-- and 0131 clears the credit when the supplier's bill is matched to the
-- delivery. Between the two, the balance sheet finally carries stock that has
-- arrived, and `2012001002` is the number somebody can point at when they ask
-- what the warehouse owes for goods nobody has invoiced yet.
--
-- # Why the value is the PO price and not a cost
--
-- Because there are no cost layers in this system yet. Nothing anywhere records
-- what a unit cost, so there is no landed cost, no freight apportionment and no
-- weighted average to value a receipt at. The accepted quantity times the
-- ordered unit price is what the supplier has agreed to charge, which is the
-- best available number and the same one `payables::unbilled_receipts` has been
-- reporting since 0052.
--
-- Stated as a limitation rather than left to be discovered: an inventory
-- balance built this way is at ORDER price, not at cost. When landed cost
-- exists, the valuation source changes here and in `receipt_post`, the variance
-- between the two goes where 0131 sends a price variance, and nothing about the
-- shape of this table has to move.
--
-- # Why posting is a cloud act and not part of ingest
--
-- Receipts arrive from the DC through sync (`apply_goods_receipt_line`), inside
-- the batch transaction that ingests every other fact. Posting there would put
-- `assert_period_open` in that path: a delivery keyed on the 1st of a month
-- whose predecessor is closed would not merely fail to post, it would fail the
-- whole sync batch and stop every other fact behind it. A warehouse cannot be
-- blocked by an accounting calendar.
--
-- So the receipt lands unposted and finance posts it, exactly as a bill is
-- recorded and then posted. `receipts_awaiting_posting` is the queue.

-- ---------------------------------------------------------------------------
-- The kinds of entry this system can write
-- ---------------------------------------------------------------------------
--
-- Recreated whole from 0096's list plus every kind the finance lanes now write.
-- A CHECK cannot be added to; it can only be replaced, and replacing it with a
-- short list would silently outlaw the entries the other lanes post.

ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        -- 0051, 0083, 0095, 0096
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER',
        -- takings and the till
        'RETENDER', 'CASH_SHIFT', 'STORE_DEPOSIT', 'REMITTANCE', 'COGS_DAY',
        -- cash out at a location
        'ADVANCE', 'STORE_EXPENSE', 'PETTY_REPLENISH', 'CASH_DOC', 'GIRO',
        -- corrections and settlements
        'INTERUNIT_SETTLE', 'RECLASS', 'ADJUSTMENT', 'WRITE_OFF',
        'ACQ_SETTLEMENT', 'ASSET_RESERVE',
        -- payables, this lane
        'GOODS_RECEIPT', 'CREDIT_NOTE', 'SUPPLIER_ADVANCE', 'LANDED_COST'));

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. MANUAL means a person typed it and carries no document; every other kind names one in source_id — GOODS_RECEIPT names the delivery it valued, CREDIT_NOTE the note, SUPPLIER_ADVANCE the advance.';

-- ---------------------------------------------------------------------------
-- One delivery, posted once
-- ---------------------------------------------------------------------------
--
-- The receipt is the primary key, so posting the same delivery twice is refused
-- by the database and not by a check somebody could forget to write. That is
-- the whole of the idempotence: `receipt_post` reads this row first for the sake
-- of a readable message, and the unique index is what guarantees the answer.
--
-- A reversal does not delete the row. The delivery has been valued and then
-- un-valued, and both facts are evidence; a row that vanished would leave a
-- pair of journal entries nobody could tie to a document.

CREATE TABLE goods_receipt_posting (
    receipt_id        uuid PRIMARY KEY REFERENCES goods_receipt(receipt_id),

    journal_entry_id  uuid NOT NULL REFERENCES journal_entry(entry_id),
    -- What the delivery was valued at: accepted quantity x ordered unit price,
    -- summed over the lines that existed when it posted. Stored because the
    -- journal quotes it and the journal cannot move; recomputing it later from
    -- lines that have since arrived would disagree with the books.
    value_minor       bigint NOT NULL CHECK (value_minor > 0),
    posting_date      date NOT NULL,
    currency          char(3) NOT NULL,

    posted_by         text NOT NULL CHECK (btrim(posted_by) <> ''),
    posted_at         timestamptz NOT NULL DEFAULT now(),

    -- Set when the delivery is cancelled or was posted in error. The mirror
    -- entry is written by `poster::reverse`, which copies the original lines'
    -- account codes rather than resolving their meanings afresh.
    reversal_entry_id uuid UNIQUE REFERENCES journal_entry(entry_id),
    reversal_reason   text,
    reversed_by       text,
    reversed_at       timestamptz,

    CHECK ((reversal_entry_id IS NULL) = (reversed_at IS NULL)),
    CHECK ((reversed_at IS NULL) = (reversed_by IS NULL)),
    CHECK (reversal_entry_id IS NULL OR btrim(coalesce(reversal_reason, '')) <> '')
);
CREATE INDEX ix_goods_receipt_posting_entry ON goods_receipt_posting (journal_entry_id);

-- A posted receipt is evidence, exactly as a posted bill is. The amount and the
-- entry are quoted by a journal that cannot move, so they cannot move either;
-- the reversal columns are the only ones that may still be filled in.
CREATE OR REPLACE FUNCTION protect_goods_receipt_posting() RETURNS trigger AS $$
BEGIN
    IF NEW.receipt_id       IS DISTINCT FROM OLD.receipt_id
    OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
    OR NEW.value_minor      IS DISTINCT FROM OLD.value_minor
    OR NEW.posting_date     IS DISTINCT FROM OLD.posting_date
    OR NEW.currency         IS DISTINCT FROM OLD.currency
    THEN
        RAISE EXCEPTION
            'delivery % is already valued in the ledger; reverse the entry rather than editing what it was worth',
            OLD.receipt_id;
    END IF;
    IF OLD.reversal_entry_id IS NOT NULL
       AND NEW.reversal_entry_id IS DISTINCT FROM OLD.reversal_entry_id THEN
        RAISE EXCEPTION 'delivery % has already been reversed', OLD.receipt_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER goods_receipt_posting_is_evidence
    BEFORE UPDATE ON goods_receipt_posting
    FOR EACH ROW EXECUTE FUNCTION protect_goods_receipt_posting();

COMMENT ON TABLE goods_receipt_posting IS
    'Which deliveries have been valued into the ledger, and for how much. One row per receipt: posting the same delivery twice is refused by the primary key.';
COMMENT ON COLUMN goods_receipt_posting.value_minor IS
    'Accepted quantity x ordered unit price. Not a cost — there are no cost layers in this system — and the valuation source changes here when there are.';
