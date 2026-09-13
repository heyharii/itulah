-- A bank statement is replaced, not imported twice.
--
-- # What was found
--
-- The dev database holds TWO imports of the same account and the same period
-- for `dc`, `store-01`, `store-02` and `store-03` — eighteen lines each,
-- different amounts, seeded two days apart. Nothing on the server prevented
-- it, nothing flagged it, and anything that adds statements up counts that
-- month twice.
--
-- The line-level guard did not catch it and could not: `bank_statement_line`
-- is unique on `(account_code, fingerprint)`, so re-uploading the SAME file is
-- already a no-op per line — which is the case it was built for, and the
-- reason `import_statement` reports duplicates rather than refusing them. Two
-- different files for one month are eighteen new fingerprints, and the header
-- that owns them had no uniqueness at all.
--
-- # Why a supersede and not a refusal
--
-- Because re-uploading is legitimate and the module already says so. The
-- lateral join in `statements.rs::MONEY_ROWS` reads the latest import for an
-- account and comments that "the same period can legitimately be uploaded
-- twice and the later upload is the one in force" — a bank reissues a
-- statement, a first upload is cut short, a correction arrives. A hard UNIQUE
-- would refuse all of that and leave the only remedy a DELETE.
--
-- So the rule that was already being applied by one read becomes the rule the
-- DATABASE holds for every read: at most one CURRENT statement per account,
-- unit and period. A second import supersedes the first rather than joining
-- it, and the superseded row stays exactly as imported — the history of what
-- the bank said, and when, is evidence and is not deleted.
--
-- # This migration deletes nothing
--
-- The four duplicate pairs are resolved by marking the OLDER import superseded
-- by the newer, which is what a re-upload means. Every row, every line and
-- every match survives. What it did is printed, per pair, so whoever runs it
-- can see which import stopped being in force.

-- # Every step here is re-runnable, and that is not decoration
--
-- The shared dev database already carries this column, this constraint and
-- both indexes, with no row for this migration in `_sqlx_migrations` — the
-- same out-of-band application that `0241`'s `store_deposit` shows there, and
-- the third instance of the pattern `finance-final.md` §4.2 #16 names. A
-- migration that cannot be applied to a database whose schema is already at
-- its destination is a migration that wedges the next person to run one, so
-- each step asks whether it has already happened.

ALTER TABLE bank_statement
    -- Null means "in force". Set to the import that replaced this one, so the
    -- chain says not merely that a statement is old but which upload took over
    -- from it.
    ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES bank_statement(statement_id);

DO $$
BEGIN
    -- `ADD CONSTRAINT` has no `IF NOT EXISTS`, so the question is asked here.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'bank_statement_supersede_is_another_import'
           AND conrelid = 'bank_statement'::regclass
    ) THEN
        ALTER TABLE bank_statement
            ADD CONSTRAINT bank_statement_supersede_is_another_import
            CHECK (superseded_by IS NULL OR superseded_by <> statement_id);
    END IF;
END $$;

-- The pairs already here. The newest import of each (account, unit, period)
-- stays in force and every earlier one points at it.
--
-- `imported_at` breaks the order and `statement_id` breaks a tie in it, so the
-- result does not depend on the order rows happen to come back in.
DO $$
DECLARE
    resolved int;
    pair     record;
BEGIN
    FOR pair IN
        SELECT s.account_code, s.site_id, s.period_start, s.period_end,
               COUNT(*) AS imports
          FROM bank_statement s
         WHERE s.superseded_by IS NULL
         GROUP BY 1, 2, 3, 4
        HAVING COUNT(*) > 1
         ORDER BY 2, 1, 3
    LOOP
        RAISE NOTICE
            'bank statement % at % for %..%: % imports; the newest stays in force',
            pair.account_code, pair.site_id, pair.period_start, pair.period_end,
            pair.imports;
    END LOOP;

    WITH ranked AS (
        SELECT statement_id,
               FIRST_VALUE(statement_id) OVER (
                   PARTITION BY account_code, site_id, period_start, period_end
                   ORDER BY imported_at DESC, statement_id DESC
               ) AS in_force
          FROM bank_statement
         WHERE superseded_by IS NULL
    )
    UPDATE bank_statement s
       SET superseded_by = r.in_force
      FROM ranked r
     WHERE r.statement_id = s.statement_id
       AND r.in_force <> s.statement_id;
    GET DIAGNOSTICS resolved = ROW_COUNT;

    IF resolved > 0 THEN
        RAISE NOTICE '% earlier import(s) marked superseded; none deleted', resolved;
    END IF;
END $$;

-- The rule itself. Partial, because it is about what is IN FORCE: any number
-- of superseded imports may sit behind one current statement, which is the
-- history this design keeps.
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_statement_current
    ON bank_statement (account_code, site_id, period_start, period_end)
    WHERE superseded_by IS NULL;

-- Reading "is this one still in force" is now something several reads do —
-- the money overview, the statement list, the import itself — and all of them
-- ask for the current row of one account.
CREATE INDEX IF NOT EXISTS ix_bank_statement_superseded
    ON bank_statement (superseded_by)
    WHERE superseded_by IS NOT NULL;
