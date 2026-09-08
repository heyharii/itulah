-- 0160: One asset is paid for more than once.
--
-- # The case, in the client's own words
--
-- They sent a BKK for an air conditioner at C004 and then explained it:
--
--     102150600204 – FFE Toko dan Gudang C004   AC C4   Rp 25.000.000
--     102150600204 – FFE Toko dan Gudang C004   AC C4   Rp  1.390.000
--     601031000404 – Biaya Bank C004            ADM     Rp      5.000
--
--     "asset itu pengakuannya sekaligus (tidak bisa dicicil) sementara
--      pembayaran ke suppliernya dipisah antara harga unit dan biaya
--      pemasangan, (untuk biaya pemasangan dikapitalisir sebagai penambah
--      harga perolehan)"
--
--     "ada pembayaran untuk unit yang sama di awal Juni 7 juta"
--
-- So one air conditioner: 25,000,000 for the unit, 1,390,000 to install it,
-- 7,000,000 paid earlier in the same month — 33,390,000 of acquisition cost
-- across three payment lines, and ONE asset. The bank charge of 5,000 in the
-- same document is not part of it and goes to expense, which is why the split
-- cannot be inferred from the document total either.
--
-- The recognition is single and the payments are several. That sentence is the
-- whole migration.
--
-- # What each half of the repository did with it
--
-- 0099 gave `fixed_asset` one `acquired_via_line_id` and checked that the
-- line's amount EQUALS the capitalised cost. That refuses this asset outright:
-- pointed at the 25,000,000 line and capitalised at 33,390,000, the check
-- reports a difference of 8,390,000 and declines. Correct arithmetic, wrong
-- question.
--
-- `0137` on the finance lane put `asset_class_code` on the bill line so that
-- posting a bill MINTS an asset in that class. Also right, and also one to one:
-- three lines mint three air conditioners, and the register then holds three
-- things where the shop has one.
--
-- Neither is a bug in the other. Both assumed a purchase is a line, because
-- until the client showed us this document there was no reason to think
-- otherwise.
--
-- # The direction the link goes, and why it is not a join table
--
-- `asset_id` on the LINE, not a table of pairs. Three reasons, in order of
-- weight:
--
-- 1. A line buys at most one asset, so the relation is many-to-one and a join
--    table would be modelling a many-to-many that cannot occur. The table
--    would need a unique index on the line to say so, which is a column
--    wearing a costume.
-- 2. `0137` already puts `asset_id` on `journal_line` for exactly this
--    purpose — a sub-ledger dimension on the line, nullable because most
--    lines are about nothing of the sort. Two lanes reaching for the same
--    idiom in the same week is the idiom being right.
-- 3. It composes with `asset_class_code` instead of competing: the class says
--    "this line buys a NEW asset, mint one", the asset id says "this line
--    buys THAT asset, add to it". The first line of the BKK mints the air
--    conditioner; the second and third name it.
--
-- # What the check becomes
--
-- Not "this line is the cost" but "the lines that name this asset SUM to the
-- cost". The property 0099 wanted is unchanged and its argument still holds
-- verbatim: capitalised at more than the books paid means the difference is
-- somewhere else and `fixed_asset` will not empty on disposal. Only the
-- arithmetic widens from one term to several.
--
-- # `acquired_via_line_id` stays, and is now a cache
--
-- It is on screens, in `acquisition_gap`, and in another lane's uncommitted
-- work. Dropping it here would break all three to save a column that costs
-- nothing, so it stays and is DEFINED: the first line that named this asset,
-- kept for display. The trigger below is what stops it becoming a second
-- truth — it may not point at a line that belongs to a different asset, which
-- is the only way the two could ever disagree.
--
-- Whichever lane merges second should retire it, once the screens read the
-- lines instead.

ALTER TABLE supplier_invoice_expense_line
    ADD COLUMN asset_id uuid REFERENCES fixed_asset(asset_id);

COMMENT ON COLUMN supplier_invoice_expense_line.asset_id IS
    'The asset this line helped buy, when it bought one. Several lines may name the same asset: the client pays for the unit and its installation separately and capitalises both. The lines naming an asset must sum to its capitalised cost — checked in Rust, because a constraint spanning the bill and the register would have to be a trigger on both.';

-- The hot read is "what did the books pay for this asset", asked on the asset
-- screen and by the acquisition-gap report.
CREATE INDEX ix_supplier_invoice_expense_line_asset
    ON supplier_invoice_expense_line (asset_id)
    WHERE asset_id IS NOT NULL;

-- Every asset that already pointed at a line now has that line pointing back.
-- One statement, before the trigger exists, because the backfill is the state
-- the trigger is there to preserve.
UPDATE supplier_invoice_expense_line l
   SET asset_id = a.asset_id
  FROM fixed_asset a
 WHERE a.acquired_via_line_id = l.line_id
   AND l.asset_id IS NULL;

-- ---------------------------------------------------------------------------
-- The cache may not lie
-- ---------------------------------------------------------------------------
--
-- `fixed_asset.acquired_via_line_id` is now a convenience pointer at one of
-- the asset's lines. The one way it could become a second truth is by naming a
-- line that belongs to some other asset, so that is the one thing refused.
--
-- A line with no `asset_id` yet is fine and ordinary: the pointer is set at
-- registration, and the line learns its asset in the same transaction a moment
-- later.
CREATE OR REPLACE FUNCTION asset_pointer_matches_its_line() RETURNS trigger AS $$
DECLARE
    owner uuid;
BEGIN
    IF NEW.acquired_via_line_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT asset_id INTO owner
      FROM supplier_invoice_expense_line
     WHERE line_id = NEW.acquired_via_line_id;
    IF owner IS NOT NULL AND owner <> NEW.asset_id THEN
        RAISE EXCEPTION
            'bill line % was bought for asset %, so % cannot claim it',
            NEW.acquired_via_line_id, owner, NEW.asset_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fixed_asset_pointer_matches_its_line
    BEFORE INSERT OR UPDATE OF acquired_via_line_id ON fixed_asset
    FOR EACH ROW EXECUTE FUNCTION asset_pointer_matches_its_line();
