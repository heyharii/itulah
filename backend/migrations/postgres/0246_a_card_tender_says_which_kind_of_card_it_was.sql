-- 0246: A card tender says which kind of card it was, on every database and not
--       only on this laptop's.
--
-- # What was wrong
--
-- `sale_payment.card_kind` is on the shared dev database, `returns.rs` SELECTs
-- it, `postgres::sale_day` SELECTs it — and **nothing in `migrations/postgres`
-- creates it.** Nor `acquirer`, `terminal_id` or `batch_no` beside it.
--
-- They arrived the way `payment_ledger_entry` and `payment_ledger_settlement`
-- did (docs/finance-final.md §4.2 #16): another worktree's migration was run
-- against the shared dev database and never landed on this branch. So the dev
-- database has the column and every database built from scratch does not —
-- which means two code paths that work here fail on a fresh deployment, and on
-- every `#[sqlx::test]` database, with `column "card_kind" of relation
-- "sale_payment" does not exist`.
--
-- That is the whole reason this file exists. It is not a new capability.
--
-- # Why it matters to the books
--
-- The client keeps TWO card receivables — `1011101001 Piutang kartu Kredit` and
-- `1011101002 Piutang Debit Card` — because an acquirer settles the two
-- separately and at different rates. Without this column a day's takings cannot
-- tell them apart, and both halves of a reconciliation somebody does by hand
-- every month would land on one account.
--
-- Null stays legal, and means the till did not say. `sale_day` books an
-- unattributed card to the DEBIT receivable and reports how much it did that
-- to, so the guess is visible rather than buried — every card row in the seeded
-- books is null today.
--
-- # Why `IF NOT EXISTS` and a conditional constraint
--
-- Because on the dev database this must be a no-op and stay one: the column is
-- already there, and re-adding a CHECK that already exists fails. A migration
-- that only works on empty databases is not a migration.

ALTER TABLE sale_payment ADD COLUMN IF NOT EXISTS card_kind text;
ALTER TABLE sale_return_payment ADD COLUMN IF NOT EXISTS card_kind text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'sale_payment'::regclass
                      AND conname = 'sale_payment_card_kind_check') THEN
        ALTER TABLE sale_payment ADD CONSTRAINT sale_payment_card_kind_check
            CHECK (card_kind IN ('DEBIT', 'CREDIT'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'sale_return_payment'::regclass
                      AND conname = 'sale_return_payment_card_kind_check') THEN
        ALTER TABLE sale_return_payment ADD CONSTRAINT sale_return_payment_card_kind_check
            CHECK (card_kind IN ('DEBIT', 'CREDIT'));
    END IF;
END $$;

COMMENT ON COLUMN sale_payment.card_kind IS
    'DEBIT or CREDIT, when the till knew. Null means the tender did not say, and the day''s posting books it to the debit receivable and reports how much it did that to.';
