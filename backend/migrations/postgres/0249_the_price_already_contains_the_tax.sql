-- 0249: The price already contains the tax, and the book stops pretending it
--       is all ours.
--
-- # What was wrong
--
-- `sale_day` credits the day's GROSS to revenue and posts no tax line at all:
--
--     Dr  1011001001  Kas di Tangan                802,001
--     Dr  1011101002  Piutang Kartu Debit        4,806,553
--     Cr  4010110001  Penjualan Barang Dagangan              5,608,554
--
-- Indonesian retail prices are tax-INCLUSIVE. The shelf says Rp 5,608,554 and
-- the PPN is INSIDE it, which is why every sale in this database satisfies
-- `total_minor = net_minor + tax_minor` exactly — the till has been recording
-- the split since the pricing engine started quoting, on `sale.tax_minor`, and
-- `reports::sales_window` has been reporting it all along. Only the ledger
-- never heard.
--
-- So the books recognise more revenue than the till's own net, by exactly the
-- tax, and the tax office's share is not a liability anywhere. Over the 1,248
-- days posted in this database that is Rp 326,748,855 of PPN inside
-- Rp 3,297,168,037 of takings: income overstated by 11%, and a Hutang PPN
-- Keluaran of nil against a real one.
--
-- # Nothing was missing from either chart
--
-- The client keeps `2012101003 Hutang  VAT PPN Keluaran` — their spelling,
-- their double space — and has for as long as we have had their export; 0243
-- carried the same code into the collapsed chart. Two charts, both with
-- somewhere to put it, and no MEANING pointing at either. That is the whole of
-- the defect and the whole of this migration: a semantic key, so that
-- `sale_day` can name it the way it names every other account it never sees
-- the code of.
--
-- **Nothing here mints an account and nothing here renames one.** Under the
-- rule the owner set on 2026-09-14 that is the point worth saying: this file
-- inserts rows into `account_map` and touches `ledger_account` not at all. The
-- chart currently shows this account as `Hutang PPN Keluaran`, which is one of
-- the 139 renames that audit found; reversing those is the owner's own
-- programme and doing one of them here would be a 140th unilateral decision
-- rather than the fix for it.
--
-- The Rust half is `required_semantic_keys()` — which is what makes the
-- Account Map ask for it, and is the lesson 0238 wrote down about
-- `cash_variance`: an unmapped meaning is a gap somebody can see, an
-- UNDECLARED one is not — and the split itself in `postgres::sale_day`, whose
-- rule version goes to `sale_day/2` so the entries the old rule wrote can be
-- told from the ones the new one does.
--
-- # Where it is seeded, and where it deliberately is not
--
-- At every unit that already has `revenue` bound, and nowhere else.
--
-- Not at every unit in `site`: on a database where nobody has set up a chart
-- at all — every `#[sqlx::test]` database, for one — an Account Map with one
-- meaning filled in and thirty-nine blank is noise, and no day can post there
-- anyway. `revenue` is the exact condition, because `output_tax` is the other
-- half of the same credit: the two are set together or the day is a lie either
-- way. A unit that gains `revenue` later gets this from the Account Map screen
-- like any other meaning.
--
-- `set_by` is the migration rather than a person because nobody chose it on a
-- screen. The Account Map shows that, and a real decision overwrites it.

INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by, note)
SELECT DISTINCT 'output_tax', m.site_id, '', '2012101003', 'migration:0249',
       'the PPN already inside the shelf price, taken out of the day''s takings '
       'rather than added to them'
  FROM account_map m
 WHERE m.semantic_key = 'revenue'
   AND EXISTS (SELECT 1 FROM ledger_account
                WHERE account_code = '2012101003'
                  AND is_group = false AND is_active)
    ON CONFLICT (semantic_key, site_id, qualifier) DO NOTHING;
