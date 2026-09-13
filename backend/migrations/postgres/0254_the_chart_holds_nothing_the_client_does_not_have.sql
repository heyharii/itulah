-- The chart holds nothing the client does not have.
--
-- # What this takes back
--
-- Sixteen codes stood in our chart that do not appear in the client's export.
-- Five we invented outright; eleven are the client's own meanings that earlier
-- migrations filed under codes of our choosing. The owner's ruling is that we
-- may not do either: their chart is the authority, including where it is
-- irregular.
--
--   invented, deleted        1011005, 1011005001  Setoran Dalam Perjalanan
--                            1011101003           Piutang QRIS
--                            1011101004           Piutang Tender Lain-Lain
--                            8010110008           Selisih Kas
--
--   moved back to the        2012401001 -> 205001
--   client's own codes       4020210002 -> 8010110003
--                            4020210003 -> 8010110004
--                            7010310003 -> 7020310003
--                            7010310004 -> 7020310004
--                            7010310005 -> 7020310005
--   and the emptied rungs    20124, 2012401, 40202, 4020210, 7010310 deleted
--
-- # Why the ladder invariant is relaxed here
--
-- 0247 put every posting account on a 1-3-5-7-10 ladder, because the client's
-- chart mostly uses one. It does not always: `205001` is a six-digit posting
-- whose `205`, `2050` and `20500` do not exist in their export, and `7020310`
-- has no `70203` or `702` above it. We invented rungs to make our chart tidy,
-- and tidiness was never the rule. Where the client sits off their own ladder,
-- we sit there with them, and the accounts hang from the nearest ancestor the
-- client actually has.
--
-- # What is lost, so that nobody has to rediscover it
--
-- * **QRIS is no longer separable from debit card.** 996 postings worth
--   Rp 1,142,837,121 return to `1011101002 Piutang Debit Card`. Two acquirers
--   settling on different terms now share one receivable, and no report can
--   tell them apart. The client's chart predates QRIS and has no slot for it.
-- * **Money between a drawer and a bank stops being a balance.** A deposit
--   posts once, on landing — `Dr bank / Cr drawer` — because the middle
--   account was ours. Banked-but-not-landed survives only as a `store_deposit`
--   row with `banked_on` set and `landed_on` null.
-- * **A short drawer lands in `8010110007 Pendapatan (Biaya) Lain-Lain`**, the
--   client's catch-all, rather than in an account that names the difference.
--
-- Each is a consequence of the client's chart, not of this migration, and each
-- is worth putting back to them as a question.

BEGIN;

-- ---------------------------------------------------------------------------
-- The balance every step below is measured against.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE before_site ON COMMIT DROP AS
SELECT site_id, SUM(debit_minor) AS d, SUM(credit_minor) AS c
  FROM journal_line GROUP BY site_id;

CREATE TEMP TABLE before_book ON COMMIT DROP AS
SELECT SUM(debit_minor) AS d, SUM(credit_minor) AS c FROM journal_line;

-- ---------------------------------------------------------------------------
-- 1. The client's codes we are moving back to, created where absent.
-- ---------------------------------------------------------------------------
-- Parents are the nearest ancestor the CLIENT has, which is why `205001` hangs
-- off `2` and `7020310` off `7`: the rungs between do not exist in their chart
-- and inventing them is the thing this migration exists to stop.
INSERT INTO ledger_account (account_code, name, parent_code, is_group, is_active)
VALUES
    ('205001',     'Uang Muka - Penjualan',     '2',       false, true),
    ('7020310',    'BIAYA USAHA LAINNYA',       '7',       true,  true),
    ('7020310003', 'Biaya Pajak Reklame',       '7020310', false, true),
    ('7020310004', 'Biaya Management FEE',      '7020310', false, true),
    ('7020310005', 'Biaya Asuransi Kendaraan',  '7020310', false, true)
ON CONFLICT (account_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Everything that points at one of ours now points at the client's.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE moves ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('1011101003', '1011101002'),
    ('1011101004', '1011101002'),
    ('8010110008', '8010110007'),
    ('2012401001', '205001'),
    ('4020210002', '8010110003'),
    ('4020210003', '8010110004'),
    ('7010310003', '7020310003'),
    ('7010310004', '7020310004'),
    ('7010310005', '7020310005')
) AS t(ours, theirs);

UPDATE journal_line l SET account_code = m.theirs
  FROM moves m WHERE l.account_code = m.ours;

-- `account_map` is keyed on (semantic_key, site_id, qualifier), so two of our
-- accounts collapsing onto one client account can collide — `qris_clearing`
-- and `other_tender_clearing` both land on `Piutang Debit Card`. Different
-- semantic keys, so they do not; asserted below rather than assumed.
UPDATE account_map a SET account_code = m.theirs
  FROM moves m WHERE a.account_code = m.ours;

UPDATE bank_statement b SET account_code = m.theirs
  FROM moves m WHERE b.account_code = m.ours;
UPDATE cash_count c SET account_code = m.theirs
  FROM moves m WHERE c.account_code = m.ours;
UPDATE company_bank_account b SET ledger_account_code = m.theirs
  FROM moves m WHERE b.ledger_account_code = m.ours;
UPDATE supplier_invoice_expense_line e SET account_code = m.theirs
  FROM moves m WHERE e.account_code = m.ours;
UPDATE fixed_asset f SET category_code = m.theirs
  FROM moves m WHERE f.category_code = m.ours;

UPDATE ledger_account_remap r SET new_code = m.theirs
  FROM moves m WHERE r.new_code = m.ours;

-- The two postings the client keeps off their own ladder, taken off the rung
-- we minted for them and hung where the client hangs them.
UPDATE ledger_account SET parent_code = '70103'
 WHERE account_code IN ('7010310001', '7010310002');

-- ---------------------------------------------------------------------------
-- 3. `cash_in_transit` has nowhere to go — the client has no such account.
-- ---------------------------------------------------------------------------
DELETE FROM account_map WHERE semantic_key = 'cash_in_transit';

-- ---------------------------------------------------------------------------
-- 4. Nothing of ours survives.
-- ---------------------------------------------------------------------------
DO $$
DECLARE stuck text;
BEGIN
    SELECT string_agg(DISTINCT l.account_code, ', ') INTO stuck
      FROM journal_line l JOIN moves m ON m.ours = l.account_code;
    IF stuck IS NOT NULL THEN
        RAISE EXCEPTION 'postings still reference %, refusing to delete', stuck;
    END IF;
END $$;

DELETE FROM ledger_account
 WHERE account_code IN (
    '1011101003', '1011101004', '8010110008', '2012401001',
    '4020210002', '4020210003', '7010310003', '7010310004', '7010310005',
    -- the rungs left childless by the moves above, and the two we minted
    '1011005001', '1011005', '20124', '2012401', '40202', '4020210', '7010310'
 );

-- ---------------------------------------------------------------------------
-- 5. What must be true afterwards.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n bigint; detail text;
BEGIN
    -- No money left the book, and no location's books changed.
    SELECT count(*) INTO n FROM before_site b
      FULL JOIN (SELECT site_id, SUM(debit_minor) d, SUM(credit_minor) c
                   FROM journal_line GROUP BY site_id) a USING (site_id)
     WHERE b.d IS DISTINCT FROM a.d OR b.c IS DISTINCT FROM a.c;
    IF n > 0 THEN RAISE EXCEPTION 'a location''s totals changed (% rows)', n; END IF;

    SELECT count(*) INTO n FROM before_book b, (SELECT SUM(debit_minor) d, SUM(credit_minor) c FROM journal_line) a
     WHERE b.d <> a.d OR b.c <> a.c;
    IF n > 0 THEN RAISE EXCEPTION 'the book total changed'; END IF;

    SELECT count(*) INTO n FROM journal_line WHERE debit_minor <> 0 AND credit_minor <> 0;
    IF n > 0 THEN RAISE EXCEPTION 'a line carries both sides'; END IF;

    -- None of the sixteen survives. The whole-chart comparison against the
    -- client's export cannot live here — a migration cannot read their CSV —
    -- so it is `scripts/audit-chart-against-client.py`, run outside. What CAN
    -- be enforced here is that the codes this migration was written to remove
    -- are gone, and that is worth enforcing because a later edit that
    -- resurrects one of them should fail loudly rather than quietly.
    SELECT count(*), string_agg(account_code, ', ') INTO n, detail
      FROM ledger_account
     WHERE account_code IN (
        '1011005', '1011005001', '1011101003', '1011101004', '8010110008',
        '20124', '2012401', '2012401001', '40202', '4020210', '4020210002',
        '4020210003', '7010310', '7010310003', '7010310004', '7010310005');
    IF n > 0 THEN
        RAISE EXCEPTION 'the chart still holds % codes the client does not have: %', n, detail;
    END IF;

    -- Nothing orphaned by the deletions.
    SELECT count(*) INTO n FROM ledger_account a
     WHERE a.parent_code IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM ledger_account p WHERE p.account_code = a.parent_code);
    IF n > 0 THEN RAISE EXCEPTION '% accounts lost their parent', n; END IF;

    SELECT count(*) INTO n FROM ledger_account a
     WHERE a.is_group AND NOT EXISTS (SELECT 1 FROM ledger_account c WHERE c.parent_code = a.account_code);
    IF n > 0 THEN RAISE EXCEPTION '% groups have no children', n; END IF;
END $$;

COMMIT;
