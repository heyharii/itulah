-- 0096: An asset leaves the books, or moves between them.
--
-- # What was missing
--
-- 0070 registered an asset, 0070 and 0083 depreciated it, and there it stayed.
-- An asset could go on the register and be charged every month for the rest of
-- the company's life; nothing could take it off. The register therefore grew
-- monotonically, exactly the way payables did before 0084, and for the same
-- reason: half a lifecycle had been written.
--
-- Two acts are missing, and they are different acts:
--
--   * DISPOSAL. The thing is gone — sold, scrapped, stolen. Its cost and its
--     accumulated depreciation both come out of the books, whatever it fetched
--     comes in, and the difference between the two is a gain or a loss that has
--     to land somewhere. Four accounts in one entry, and it is the only entry
--     in this module that can produce a number nobody chose.
--   * TRANSFER. The thing is fine and it is somewhere else. Nothing enters or
--     leaves the company; a cost and an accumulation move from one location's
--     books to another's. It matters because the client keeps a profit and loss
--     per location: a display unit that spent two years at store 03 and is now
--     at store 11 must stop charging store 03 and start charging store 11, and
--     the accumulated depreciation has to follow the cost or both locations'
--     balance sheets are wrong by the same amount in opposite directions.
--
-- `status` already admits DISPOSED, and `disposed_on` already exists with a
-- CHECK tying the two together — 0070 wrote the shape and left the act unbuilt.
-- What is added below is the money and the evidence.

-- ---------------------------------------------------------------------------
-- Two more source kinds
-- ---------------------------------------------------------------------------
--
-- Same argument as 0083 and 0095: an entry's kind says how it came to be
-- written, MANUAL is reserved for the entries a person typed from nothing, and
-- both of these have a document behind them.
--
-- TRANSFER, which already exists, is not reused for the asset move. It is the
-- stock transfer's kind, and its `source_id` will one day be a stock transfer
-- document. Two different documents behind one kind means an entry whose source
-- cannot be resolved without first guessing which table to look in.

ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER'));

-- ---------------------------------------------------------------------------
-- Disposal
-- ---------------------------------------------------------------------------

ALTER TABLE fixed_asset
    -- SOLD          somebody paid for it; `disposal_proceeds_minor` may be
    --               anything from zero upwards
    -- WRITTEN_OFF   scrapped, lost or stolen; proceeds are zero by definition,
    --               and the whole remaining book value is a loss
    ADD COLUMN disposal_method text
        CHECK (disposal_method IS NULL OR disposal_method IN ('SOLD', 'WRITTEN_OFF')),
    -- What it fetched, in the currency the books are kept in. Zero is a real
    -- answer and not an absent one: a machine given away for nothing was
    -- disposed of for nothing, which is different from an asset nobody has
    -- disposed of.
    ADD COLUMN disposal_proceeds_minor bigint,
    ADD COLUMN disposal_journal_entry_id uuid REFERENCES journal_entry(entry_id);

-- Disposed and out of the books are the same fact, so they cannot disagree.
-- The same shape `supplier_invoice` uses for POSTED and `supplier_payment` for
-- its entry: one status column and one entry id, tied by a CHECK rather than by
-- a convention somebody has to keep.
ALTER TABLE fixed_asset
    ADD CONSTRAINT fixed_asset_disposal_is_complete CHECK (
        (status = 'DISPOSED') = (disposal_journal_entry_id IS NOT NULL)
        AND (status = 'DISPOSED') = (disposal_method IS NOT NULL)
        AND (status = 'DISPOSED') = (disposal_proceeds_minor IS NOT NULL)
    ),
    ADD CONSTRAINT fixed_asset_proceeds_are_not_negative
        CHECK (disposal_proceeds_minor IS NULL OR disposal_proceeds_minor >= 0),
    -- A write-off that fetched money was a sale. Naming it a write-off would
    -- put the proceeds in the books and the reason for them outside.
    ADD CONSTRAINT fixed_asset_a_write_off_fetches_nothing
        CHECK (disposal_method IS DISTINCT FROM 'WRITTEN_OFF'
               OR disposal_proceeds_minor = 0);

COMMENT ON COLUMN fixed_asset.disposal_journal_entry_id IS
    'The entry that took cost and accumulated depreciation out of the books. Present exactly when status is DISPOSED.';

-- ---------------------------------------------------------------------------
-- Transfer
-- ---------------------------------------------------------------------------
--
-- A row per move, and not a column on the asset. `site_id` says where the thing
-- is now; this says how it got there, and an asset that has been to three
-- shops has three rows rather than one overwritten field. The same reason
-- `asset_capitalization` is appended: the history IS the audit trail.

CREATE TABLE asset_transfer (
    transfer_id  uuid PRIMARY KEY,
    asset_id     uuid NOT NULL REFERENCES fixed_asset(asset_id),

    from_site    text NOT NULL REFERENCES site(id),
    to_site      text NOT NULL REFERENCES site(id),
    moved_on     date NOT NULL,

    -- Nullable, and the one nullable entry id in this module.
    --
    -- An asset Finance decided to EXPENSE carries no cost in the books at all,
    -- so there is nothing for a journal to move: the entry would be for zero
    -- and the poster refuses those, correctly. Its location still matters —
    -- somebody has to find the thing — so the move is recorded and books
    -- nothing, and this column says which of the two happened rather than
    -- leaving a reader to infer it from the absence of an entry.
    journal_entry_id uuid REFERENCES journal_entry(entry_id),

    memo         text,
    recorded_by  text NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at  timestamptz NOT NULL DEFAULT now(),

    -- A move to where it already is is not a move. Refused here rather than in
    -- Rust because the entry it would produce debits and credits the same
    -- account at the same location: perfectly balanced, and a lie.
    CHECK (from_site <> to_site)
);
CREATE INDEX ix_asset_transfer_asset ON asset_transfer (asset_id, moved_on DESC);
CREATE INDEX ix_asset_transfer_sites ON asset_transfer (from_site, to_site, moved_on DESC);

COMMENT ON TABLE asset_transfer IS
    'One move of one asset between locations. Carries the entry that moved its cost and accumulated depreciation, or no entry when Finance had expensed the asset and there was nothing in the books to move.';

-- A transfer is a fact with a journal behind it, so it is appended like every
-- other fact in this module. Correcting one means transferring the asset back.
CREATE OR REPLACE FUNCTION protect_asset_transfer() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'a transfer is a record of a move, not %: move the asset back if it should not have gone',
        lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_transfer_append_only
    BEFORE UPDATE OR DELETE ON asset_transfer
    FOR EACH ROW EXECUTE FUNCTION protect_asset_transfer();

-- ---------------------------------------------------------------------------
-- A disposed asset stops moving
-- ---------------------------------------------------------------------------
--
-- Everything about the asset that the disposal entry quotes — its cost family,
-- its location, its status and the entry itself — is frozen once it is gone.
-- Without this, a disposed asset could be transferred to another location, and
-- the transfer entry would credit a `fixed_asset` balance that the disposal had
-- already emptied: two locations, one carrying a negative cost, and a trial
-- balance that still balances.
--
-- Notes and a serial number are deliberately left editable. They are
-- Operations' description of a thing, not Finance's record of a number, and
-- correcting the serial on a machine sold last year hurts nobody.

CREATE OR REPLACE FUNCTION protect_disposed_asset() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'DISPOSED' AND (
           NEW.status                    IS DISTINCT FROM OLD.status
        OR NEW.site_id                   IS DISTINCT FROM OLD.site_id
        OR NEW.category_code             IS DISTINCT FROM OLD.category_code
        OR NEW.disposed_on               IS DISTINCT FROM OLD.disposed_on
        OR NEW.disposal_method           IS DISTINCT FROM OLD.disposal_method
        OR NEW.disposal_proceeds_minor   IS DISTINCT FROM OLD.disposal_proceeds_minor
        OR NEW.disposal_journal_entry_id IS DISTINCT FROM OLD.disposal_journal_entry_id
    ) THEN
        RAISE EXCEPTION
            'asset % was disposed of on %; reverse its disposal entry rather than editing what left the books',
            OLD.asset_number, OLD.disposed_on;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fixed_asset_disposed_is_evidence
    BEFORE UPDATE ON fixed_asset
    FOR EACH ROW EXECUTE FUNCTION protect_disposed_asset();
