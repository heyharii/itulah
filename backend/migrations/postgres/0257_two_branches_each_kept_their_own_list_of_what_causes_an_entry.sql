-- Two branches each kept their own list of what causes an entry.
--
-- # What went wrong
--
-- `journal_entry_source_kind_check` is a DROP-and-ADD constraint: every
-- migration that widens it restates the whole list. That is safe while one
-- lane is filing migrations and silently destructive the moment two are,
-- because the list is not merged — the highest-numbered file simply wins.
--
-- The finance lane filed `0107` on its own branch and took the vocabulary from
-- eleven kinds to thirty-one, then to thirty-two at `0158`. On this branch,
-- which had never seen any of that, `0216`, `0241` and `0242` each widened the
-- ELEVEN they knew about — to twelve, thirteen, fourteen. When the two were
-- merged the numbers interleaved, `0242` ran last, and its fourteen became the
-- rule. Twenty-one kinds the finance code writes were locked out.
--
-- Nothing was retired on purpose. Compare the sets: `0216` "removes" exactly
-- the twenty kinds `0107` had added and nothing else, which is not a decision,
-- it is a file written in ignorance of another branch. Fifteen of the lost
-- kinds are assigned by name in `PostingIntent` construction today
-- (`ACQ_SETTLEMENT`, `CASH_DOC`, `GIRO`, `CREDIT_NOTE`, `RECLASS`,
-- `STORE_EXPENSE` and the rest) and five more come out of `stock_ledger`'s
-- match on movement kind (`ADJUSTMENT`, `COGS_DAY`, `WRITE_OFF`) or
-- `interunit` (`REMITTANCE`) and `opening` (`OPENING`).
--
-- This restores the union of every kind either branch ever allowed: 35.
-- Widening a CHECK cannot fail on existing rows, so no database needs
-- rebuilding for it.
--
-- `INTERUNIT_SETTLE` is in the list and is written by nothing yet. It is kept
-- because the finance lane declared it and a permitted value nobody uses costs
-- nothing, where a missing one costs a refused posting.
--
-- # Why this is a migration and not an edit to 0242
--
-- `0242` is applied in databases already. Editing it would change its checksum
-- and every one of them would refuse to start.

ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        -- the eleven this branch started with
        'DEPRECIATION', 'MANUAL', 'PAYMENT', 'REVERSAL', 'SALE_DAY',
        'STOCK_COUNT', 'SUPPLIER_INVOICE', 'TRANSFER', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER',
        -- and the three it added while the finance lane was away
        'CASH_COUNT', 'DEPOSIT', 'ASSET_CAPITALIZATION',
        -- twenty from the finance lane's 0107
        'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'ASSET_RESERVE', 'CASH_DOC',
        'CASH_SHIFT', 'COGS_DAY', 'CREDIT_NOTE', 'GIRO', 'GOODS_RECEIPT',
        'INTERUNIT_SETTLE', 'LANDED_COST', 'PETTY_REPLENISH', 'RECLASS',
        'REMITTANCE', 'RETENDER', 'STORE_DEPOSIT', 'STORE_EXPENSE',
        'SUPPLIER_ADVANCE', 'WRITE_OFF',
        -- and the one its 0158 added
        'OPENING'
    ));

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. The list is the union of what two branches allowed
     before they were merged — see 0257 for why it had to be restated. Widen it
     in a NEW migration, never by editing an applied one.';
