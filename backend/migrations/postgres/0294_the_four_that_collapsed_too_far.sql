-- The four that collapsed too far.
--
-- 0289 asked one question of every account — "is this a line on a statement?"
-- — and forty answered yes. Running the estate against the result found four
-- places where the answer was right and the consequence was not: an account
-- that is genuinely one statement line, but whose former members the system
-- still has to tell apart for a reason that has nothing to do with statements.
--
-- Each is fixed the same way, which is the way the whole design says to fix it:
-- the distinction becomes a category, not an account.
--
-- # 1. `7101` lost the split between wearing out and being replaced
--
-- `7010212 BIAYA DEPRESIASI` and `7010215 BIAYA REPLACEMENT OPERATING EQUIPMENT`
-- both landed on `7101`. On the balance sheet the two survive — accumulated
-- depreciation is `1609`, the replacement reserve is `1610` — but on the profit
-- and loss they became one number, and 0159 exists precisely because the client
-- treats operating equipment differently from everything else: a rack is not
-- depreciated, it is charged against a reserve and replaced.
--
-- So `7101` takes a `depreciation_kind`. Three values, and the asset register
-- already knows which one applies from `asset_class.kind`.
--
-- # 2. Capitalising work in progress was a self-cancelling entry
--
-- `1031803 Contract In Progress` and the fixed-asset families both landed on
-- `1601`. Capitalisation moves cost out of the first and into the second, so
-- with one account it debited and credited `1601` for the same asset — a
-- journal that says nothing, and a balance sheet on which unfinished work
-- cannot be separated from finished. Worse, the guard in `assets.rs` that
-- refuses to capitalise when there is nothing in progress sums the whole
-- account at the site, so any other asset there defeats it.
--
-- `1601` takes an `asset_stage`. Two values. The capitalisation becomes a real
-- move again, and "aset dalam penyelesaian" is still its own line on the
-- balance sheet — read off the category instead of off the account code, which
-- is the whole argument of this chart.
--
-- # 3. Four owner decisions about which documents may reach an account
--
-- `account_source_rule` carries four rows somebody decided deliberately, each
-- with its reason written down (0139, 0267, 0268). All four sit on accounts
-- 0290 retired, and 0291's header claimed they were "already on the new codes".
-- They were not. Four decisions had quietly stopped applying.
--
-- Moving them is not a rename, because the table is keyed on the account alone
-- and three of the four were decisions about something narrower than an
-- account. `1011302003 Prepaid PPh 29` allows OPENING and nothing else; on
-- `1402` that same rule would freeze input VAT and the PPh 25 instalment too.
-- So the table gains a category, NULL meaning "the whole account", exactly as
-- `account_category_policy` does.
--
-- # 4. A deposit could no longer say which pot it left
--
-- `store_deposit` records the drawer account and the bank account. Both are now
-- shared — `1101 Kas` carries the drawer, petty cash and the till float; `1102
-- Bank` carries fourteen accounts — and `deposits::meaning_of` works BACKWARDS
-- from the account to the meaning, so it began refusing every deposit with
-- "mapped by more than one meaning". The document has to say which pot, and now
-- it can.

-- ---------------------------------------------------------------------------
-- 1 and 2: two more families, and the accounts that declare them
-- ---------------------------------------------------------------------------

INSERT INTO line_category (category_code, family, name, name_en, sort_order, legacy_code) VALUES
    ('DEPRECIATION', 'depreciation_kind', 'Biaya Depresiasi',   'Depreciation',  0, NULL),
    ('AMORTISATION', 'depreciation_kind', 'Biaya Amortisasi',   'Amortisation',  1, NULL),
    ('REPLACEMENT',  'depreciation_kind', 'Biaya Replacement Operating Equipment',
                                                               'OE replacement', 2, NULL),
    ('IN_SERVICE',   'asset_stage', 'Aset Digunakan',          'In service',     0, NULL),
    ('IN_PROGRESS',  'asset_stage', 'Aset Dalam Penyelesaian', 'Work in progress', 1, NULL);

UPDATE ledger_account SET category_family = 'depreciation_kind' WHERE account_code = '7101';
UPDATE ledger_account SET category_family = 'asset_stage'       WHERE account_code = '1601';

-- The three retired accounts that stood for a depreciation kind, and the two
-- that stood for a stage, can now say so — which is what makes the legacy
-- bridge answer for them instead of returning NULL.
UPDATE ledger_account_remap SET category_code = 'DEPRECIATION'
 WHERE new_code = '7101' AND legacy_code LIKE '70102%'
   AND legacy_code NOT LIKE '7010215%' AND legacy_code NOT LIKE '7010216%';
UPDATE ledger_account_remap SET category_code = 'REPLACEMENT'
 WHERE new_code = '7101' AND legacy_code LIKE '7010215%';
UPDATE ledger_account_remap SET category_code = 'AMORTISATION'
 WHERE new_code = '7101' AND legacy_code LIKE '7010216%';
UPDATE ledger_account_remap SET category_code = 'IN_PROGRESS'
 WHERE new_code = '1601' AND legacy_code LIKE '1031803%';
UPDATE ledger_account_remap SET category_code = 'IN_SERVICE'
 WHERE new_code = '1601' AND category_code IS NULL;

-- ---------------------------------------------------------------------------
-- 3: the four decisions, moved with the grain they were made at
-- ---------------------------------------------------------------------------

ALTER TABLE account_source_rule ADD COLUMN category_code TEXT
    REFERENCES line_category (category_code);

COMMENT ON COLUMN account_source_rule.category_code IS
    'Narrows the rule to one category on the account. NULL means the rule is '
    'about the whole account, which is what every rule written before 0294 meant.';

-- A primary key cannot hold a NULL, and NULL is the value that means "the
-- whole account" — which is what every rule written before today means. So the
-- key becomes a unique index over the coalesced category instead. Plain
-- `UNIQUE (account_code, source_kind, category_code)` would not do: SQL counts
-- two NULLs as different, so the same account could take two contradictory
-- whole-account rules for one source kind and nothing would object.
ALTER TABLE account_source_rule DROP CONSTRAINT account_source_rule_pkey;
CREATE UNIQUE INDEX account_source_rule_key
    ON account_source_rule (account_code, source_kind, COALESCE(category_code, ''));

-- The reserve's is genuinely about the whole account: `1610` holds nothing but
-- the replacement reserve, so "formation undecided" is true of all of it.
UPDATE account_source_rule SET account_code = '1610'
 WHERE account_code = '1021607001';

-- The other three are narrower than their new account, and would have frozen
-- their neighbours if moved as they stood.
UPDATE account_source_rule
   SET account_code = '1402', category_code = 'PPH29',
       note = note || ' (0294: moved to 1402 x PPH29; at account grain this '
                   || 'would have frozen input VAT and the PPh 25 instalment too)'
 WHERE account_code = '1011302003';

UPDATE account_source_rule
   SET account_code = '7101', category_code = 'AMORTISATION',
       note = note || ' (0294: moved to 7101 x AMORTISATION; at account grain '
                   || 'this would have frozen every depreciation run)'
 WHERE account_code = '7010216002';

-- ---------------------------------------------------------------------------
-- 4: a deposit says which pot
-- ---------------------------------------------------------------------------

ALTER TABLE store_deposit
    ADD COLUMN drawer_category_code TEXT REFERENCES line_category (category_code),
    ADD COLUMN bank_category_code   TEXT REFERENCES line_category (category_code);

COMMENT ON COLUMN store_deposit.drawer_category_code IS
    'Which pot the money left: DRAWER, PETTY or FLOAT. `1101 Kas` carries all '
    'three, so without this a deposit cannot be read back to a meaning.';

UPDATE store_deposit SET drawer_category_code = 'DRAWER'
 WHERE drawer_account_code = '1101' AND drawer_category_code IS NULL;

DO $$
DECLARE
    stranded INTEGER;
    families INTEGER;
BEGIN
    SELECT count(*) INTO stranded
      FROM account_source_rule r JOIN ledger_account a USING (account_code)
     WHERE NOT a.is_active;
    IF stranded <> 0 THEN
        RAISE EXCEPTION '% source rules still sit on a retired account', stranded;
    END IF;

    -- A rule narrowed to a category must name one the account accepts.
    PERFORM assert_category_fits(r.account_code, r.category_code,
                format('the source rule %L', r.source_kind))
       FROM account_source_rule r WHERE r.category_code IS NOT NULL;

    SELECT count(DISTINCT family) INTO families FROM line_category;
    IF families <> 18 THEN RAISE EXCEPTION 'expected 18 families, got %', families; END IF;

    IF EXISTS (SELECT 1 FROM ledger_account_remap WHERE new_code IN ('1601', '7101')
                AND category_code IS NULL) THEN
        RAISE EXCEPTION 'an asset or depreciation account still has no category to read back to';
    END IF;
END $$;
