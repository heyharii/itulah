-- 0083: A machine's entry says so. `DEPRECIATION` joins the source kinds.
--
-- # What was wrong
--
-- The monthly depreciation run posts through the same door as everything else,
-- and it labelled its entries `MANUAL` because when 0070 was written there was
-- no kind that meant "a rule charged this". The consequence is not cosmetic.
-- `source_kind` is what the Journal screen filters on, and MANUAL is the one
-- value that means "a person typed this, and a person can therefore have got it
-- wrong" — it is painted with a warning pill for exactly that reason. In the
-- seeded books 44 of the 58 MANUAL entries were written by the depreciation
-- run. An auditor asking the ledger for hand-keyed entries got 58 when 14
-- qualified, and no way to tell them apart short of reading `rule_version`,
-- which is not on the screen.
--
-- Worse, MANUAL is the one kind the schema excuses from carrying a `source_id`.
-- So an entry charging AST-0007 for September named the asset only inside a
-- memo string, and nothing in the database tied the charge to the thing charged.
--
-- # Why this is a widened CHECK and not a new column
--
-- Because the column already exists and already means this. A separate
-- `is_automatic` flag would be a second answer to a question `source_kind`
-- already answers, and the two would agree until somebody set one and not the
-- other.

ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION'));

-- The other CHECK on this table — non-MANUAL, non-REVERSAL entries must carry a
-- `source_id` — is deliberately left alone. DEPRECIATION now falls under it,
-- which is the point: the run has an asset to name and from 0083 it names it.

-- ---------------------------------------------------------------------------
-- The correction, and why it is allowed to happen at all
-- ---------------------------------------------------------------------------
--
-- The journal is append-only. `protect_journal` refuses every UPDATE and DELETE
-- on `journal_entry`, and that rule is the reason anybody can trust these books:
-- an amount that could be quietly edited is an amount nobody can rely on.
-- Disabling that trigger, even for one statement, deserves an argument rather
-- than a shrug.
--
-- The argument is that this changes no accounting fact. Not one debit, credit,
-- account, date, amount or entry number moves. `source_kind` records HOW an
-- entry came to be written, not what it says — it is metadata about the writer,
-- and the writer is not in dispute: `rule_version = 'depreciation/1'` was
-- stamped by the depreciation run itself, at the moment it posted, and no other
-- code path in this system ever writes that string. So the 44 rows below are
-- machine-written by their own evidence, and the label saying otherwise is a
-- defect in the record of provenance, not a restatement of the accounts.
--
-- The alternative was to leave them. That was considered and rejected: it would
-- mean the fix helps only future runs while the four months of seeded history
-- keeps lying to the same auditor, and "some of the MANUAL entries are really
-- depreciation, depending on when they were posted" is a rule nobody can apply
-- from a screen. A correction that can be stated exactly and verified exactly
-- is better than a permanent asterisk.
--
-- Bounded three ways, so it cannot reach anything else:
--   * `rule_version = 'depreciation/1'` — written by one code path only;
--   * `source_kind = 'MANUAL'` — so a re-run of this migration is a no-op;
--   * the asset id comes from `asset_depreciation_entry`, the run's own record
--     of which charge belongs to which asset, joined 1:1 on the journal entry.
--     A row whose asset cannot be found is left exactly as it is rather than
--     given an invented source; the count check below then fails loudly instead
--     of half-correcting the history.
--
-- All of it inside this migration's transaction: if the UPDATE fails, the
-- trigger is not left disabled, because the ALTER that disabled it rolls back
-- with everything else.

ALTER TABLE journal_entry DISABLE TRIGGER journal_entry_append_only;

UPDATE journal_entry e
   SET source_kind = 'DEPRECIATION',
       source_id   = d.asset_id::text
  FROM asset_depreciation_entry d
 WHERE d.journal_entry_id = e.entry_id
   AND e.rule_version = 'depreciation/1'
   AND e.source_kind = 'MANUAL';

ALTER TABLE journal_entry ENABLE TRIGGER journal_entry_append_only;

-- Nothing labelled by the old rule may be left behind, and nothing may be left
-- labelled DEPRECIATION without the asset it depreciated. Either would be a
-- half-done correction, which is worse than none: the screen would then show
-- two kinds for one act.
DO $$
DECLARE
    stragglers bigint;
    orphans    bigint;
BEGIN
    SELECT COUNT(*) INTO stragglers FROM journal_entry
     WHERE rule_version = 'depreciation/1' AND source_kind <> 'DEPRECIATION';
    IF stragglers > 0 THEN
        RAISE EXCEPTION
            '% depreciation entries could not be relabelled; they have no row in '
            'asset_depreciation_entry to name an asset from', stragglers;
    END IF;

    SELECT COUNT(*) INTO orphans FROM journal_entry
     WHERE source_kind = 'DEPRECIATION' AND source_id IS NULL;
    IF orphans > 0 THEN
        RAISE EXCEPTION '% depreciation entries carry no asset id', orphans;
    END IF;
END $$;

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. MANUAL means a person typed it and carries no document; every other kind names one in source_id — DEPRECIATION names the asset it charged.';
