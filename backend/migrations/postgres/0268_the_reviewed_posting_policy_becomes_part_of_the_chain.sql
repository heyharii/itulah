-- The reviewed posting policy becomes part of the chain.
--
-- 0261-0267 built the kernel and left a hole in the deployment story. Only SEVEN
-- accounts got their policy from a migration — 0267, the ones the workbook had no
-- opinion about. The other 179 got theirs from `scripts/seed-posting-profile.py`,
-- which is a manual per-environment step. So a freshly migrated database had 179
-- postable accounts sitting on the permissive default, unprotected, until somebody
-- remembered to run a script with a spreadsheet to hand.
--
-- Accounting policy in production must not depend on that. This migration is the
-- reviewed result of that script for the chart as it stands, written out account
-- by account, so the chain alone is enough.
--
-- # Provenance, and why the migration does not read the workbook
--
-- Source: `Retail_OS_COA_v1_162_Merged_Master.xlsx`, sheet `COA 162 Config`,
-- bridged 162 -> legacy -> our chart by `scripts/seed-posting-profile.py`. What is
-- written here is not a second derivation of that bridge: it is the OBSERVED
-- outcome of running the script against this chain, read back out of
-- `ledger_account` and emitted, then reviewed group by group.
--
-- The migration deliberately cannot read the workbook. A deployment that needed a
-- spreadsheet present is a deployment that can fail for a reason with nothing to
-- do with the database, and the same chain would produce different policy
-- depending on which copy of the file was to hand. The workbook stays the
-- AUTHORING source. This is the reviewed snapshot, and from here on the script's
-- job is to report the difference between the two, not to create it.
--
-- Only codes that exist in the chart are listed. The script addresses 408
-- ten-digit codes because the client's legacy chart had far more leaves than ours
-- keeps; the rest match no row and their UPDATE is a no-op. Carrying 229 dead
-- codes into a migration would make it unreadable, and would hide the day one of
-- them stopped being dead.
--
-- # What this does not touch
--
-- The seven accounts 0267 decided. Those are owner decisions, they are newer than
-- the workbook, and for three of them the workbook's own answer is `MANUAL` /
-- `YES` — which is also the column default. A generated statement that widened a
-- decision somebody made on purpose would be the wrong precedence, so the seven
-- are excluded from the policy updates by name, exactly as `OWNER_DECIDED`
-- excludes them in the script. They still get the marker below, because they are
-- the most deliberately classified accounts in the chart.
--
-- The affiliate corrections (0264), the counter-site rename (0262), and the
-- migration-only source rules (0267) all stay as they are.

ALTER TABLE ledger_account
    ADD COLUMN posting_policy_configured boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ledger_account.posting_policy_configured IS
    'True when somebody decided this account''s posting policy on purpose. A separate column because `MANUAL` / `YES` is both the column default AND a legitimate deliberate answer -- three accounts carry it by owner decision -- so the policy values themselves cannot tell an unreviewed account from a reviewed one. Headings do not need it: nothing posts to a group.';

-- ---------------------------------------------------------------------------
-- The reviewed policy: 179 accounts, five groups
-- ---------------------------------------------------------------------------

-- AUTO_ONLY / NO — 62 accounts
--
-- Only a rule, and no hand-written entry at all. Control balances a document
-- owns: the receivables a settlement clears, the payables a bill raises, the
-- inventory and tax figures a posting run moves. A person keying one of these
-- directly is a person going around the document that should have moved it.
UPDATE ledger_account
   SET posting_mode = 'AUTO_ONLY',
       manual_je_policy = 'NO',
       posting_policy_configured = true
 WHERE account_code IN (
        '1011101001', '1011101002', '1011201001', '1011202001', '1011203001', '1011204001',
        '1011302004', '1021401001', '1021402001', '1021403001', '1021501001', '1021501002',
        '1021502001', '1021503001', '1021504001', '1021505001', '1021506001', '1021507001',
        '1021601002', '1021602001', '1021603001', '1021604001', '1021605001', '1021606001',
        '1021607001', '1021701001', '1021702001', '1031802002', '2012001001', '2012001002',
        '2012001003', '2012201001', '2012201003', '2012301001', '2012302001', '2012501001',
        '2012502001', '2022401001', '2022402001', '205001', '3013001002', '4010110001',
        '4010111001', '4010111002', '4010111003', '4010111004', '4010112001', '4010112002',
        '4010113001', '4010113002', '4010213001', '4010214001', '5010110001', '7010110002',
        '7010210001', '7010211001', '7010212001', '7010213001', '7010214001', '7010216001',
        '8010110002', '8010110003'
 );

-- AUTO_ONLY / OVERRIDE — 16 accounts
--
-- Only a rule, but an approved correction may reach it. The same kind of control
-- balance, for the accounts where the workbook admits that a signed correction is
-- sometimes the only way to fix a figure a document got wrong.
UPDATE ledger_account
   SET posting_mode = 'AUTO_ONLY',
       manual_je_policy = 'OVERRIDE',
       posting_policy_configured = true
 WHERE account_code IN (
        '6010210001', '6010210002', '6010210003', '6010210004', '6010210005', '6010210006',
        '6010210007', '6010210008', '6010210009', '6010210010', '6010210011', '6010210012',
        '6010210013', '8010110001', '8010110006', '8020111001'
 );

-- SEMI_AUTO / NO — 1 account
--
-- A rule ordinarily, and never by hand. One account: `1011001003 Modal Kasir`,
-- the cashier's fixed float. It moves when head office moves it and not
-- otherwise, which is exactly the store-cash policy the owner set.
UPDATE ledger_account
   SET posting_mode = 'SEMI_AUTO',
       manual_je_policy = 'NO',
       posting_policy_configured = true
 WHERE account_code IN (
        '1011001003'
 );

-- SEMI_AUTO / OVERRIDE — 55 accounts
--
-- A rule ordinarily, a correction where needed. The cash, bank and prepaid
-- surface — accounts a document normally moves, where a mistake still has to be
-- correctable by somebody with the authority to sign for it.
UPDATE ledger_account
   SET posting_mode = 'SEMI_AUTO',
       manual_je_policy = 'OVERRIDE',
       posting_policy_configured = true
 WHERE account_code IN (
        '1011001001', '1011001002', '1011002001', '1011002002', '1011002003', '1011002004',
        '1011002005', '1011003001', '1011003002', '1011003003', '1011003004', '1011003005',
        '1011004001', '1011004002', '1011004003', '1011004004', '1011102001', '1011102002',
        '1011102003', '1011103001', '1011299001', '1011301001', '1011301002', '1011301005',
        '1011301007', '1011301008', '1011301009', '1011302001', '1011302002', '1011302005',
        '1011302006', '1011303001', '1011303002', '1011303003', '1011303004', '1031801001',
        '1031802001', '1031803001', '2012002001', '2012101001', '2012101002', '2012101003',
        '2012101004', '2012101005', '2012101006', '2012201006', '2012201009', '2012303001',
        '4020110001', '7010110001', '7010110003', '7010110004', '7010215001', '8020111002',
        '8030112001'
 );

-- SEMI_AUTO / YES — 45 accounts
--
-- A rule ordinarily, a person freely. The ordinary running expenses, where
-- somebody keying the bill IS the document and no separate approval adds anything.
UPDATE ledger_account
   SET posting_mode = 'SEMI_AUTO',
       manual_je_policy = 'YES',
       posting_policy_configured = true
 WHERE account_code IN (
        '6010110001', '6010110002', '6010110003', '6010110004', '6010110005', '6010110006',
        '6010110007', '6010110008', '6010310001', '6010310002', '6010310003', '6010310004',
        '6010310005', '6010310006', '6010310007', '6010310008', '6010310009', '6010310010',
        '6010310011', '6010310012', '6010310013', '6010310014', '6010310015', '6010310016',
        '6010310017', '6010310021', '6010310022', '6010310023', '6010310024', '6010310099',
        '6010410001', '6010410002', '6010410003', '6010410004', '6010410005', '6010410006',
        '6010410007', '6010410008', '6010410010', '7010310001', '7010310002', '7020310003',
        '7020310004', '7020310005', '8010110004'
 );
-- ---------------------------------------------------------------------------
-- The seven the owner decided (0267) — marker only
-- ---------------------------------------------------------------------------
--
-- Their mode and policy are left exactly as 0267 set them. Named here rather than
-- swept in with a blanket `WHERE NOT is_group`, so that the coverage invariant
-- proves something: an account nobody classified stays unmarked and the gate
-- catches it.
UPDATE ledger_account
   SET posting_policy_configured = true
 WHERE account_code IN (
        '1011302003', '3013001001', '3013001003', '3013001004', '6010310018', '7010216002',
        '8010110007'
 );

-- ---------------------------------------------------------------------------
-- The one source rule the script was carrying
-- ---------------------------------------------------------------------------
--
-- `1021607001 Reserve Replacement Operating Equipment` — the owner ruled the
-- formation of the reserve undecided and its draw-down approved, and those two
-- differ only by source kind. The row lived in the seed script, which means a
-- database that skipped the script had the reserve wide open to the very posting
-- the owner had not decided. Account-level `BLOCKED` is the wrong instrument here:
-- it would take the approved draw-down down with it.
INSERT INTO account_source_rule (account_code, source_kind, effect, set_by, note)
VALUES ('1021607001', 'ASSET_RESERVE', 'DENY', '0268',
        'formation undecided (0139); the draw-down is approved, so the refusal is per source kind and not per account')
ON CONFLICT (account_code, source_kind) DO NOTHING;

-- ---------------------------------------------------------------------------
-- And the count this chain owes
-- ---------------------------------------------------------------------------
--
-- 186 postable accounts, 186 classified, 0 left on an accidental default:
-- 179 from the reviewed workbook policy above and seven from 0267.
-- `tests/posting_policy_coverage.rs` refuses a chain where any postable account
-- carries `posting_policy_configured = false`, so a future migration that adds a
-- postable account has to decide its policy in the same change.
DO $$
DECLARE
    unclassified bigint;
BEGIN
    SELECT COUNT(*) INTO unclassified
      FROM ledger_account
     WHERE NOT is_group AND NOT posting_policy_configured;
    IF unclassified > 0 THEN
        RAISE EXCEPTION
            'this migration left % postable account(s) without a posting policy decision', unclassified;
    END IF;
END $$;
