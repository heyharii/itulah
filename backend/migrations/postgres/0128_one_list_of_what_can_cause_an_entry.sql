-- One list of what can cause a journal entry.
--
-- `journal_entry.source_kind` has been widened four times — 0083 for
-- DEPRECIATION, 0095 for BANK_STATEMENT, 0096 for the two asset events — and
-- each time by dropping the constraint and writing the whole list out again.
-- That is the right mechanic and it has a bad failure mode when several people
-- are building money documents at once: two migrations each re-state "the list
-- as I found it plus mine", the second one lands, and the first one's kind
-- disappears from the constraint without anything failing until an entry of
-- that kind is posted.
--
-- So this states the list ONCE, in full, including kinds whose documents do not
-- exist yet. A constraint that permits a value nothing writes costs nothing; a
-- constraint that forbids a value the module beside it writes costs a
-- production incident. The kinds added here that this migration's own module
-- uses are the last three of the corrections — RECLASS, ADJUSTMENT, WRITE_OFF —
-- and the rest are named so the next lane does not have to touch this file.
--
-- What each kind means, for whoever adds the next one:
--
--   RETENDER          a completed sale re-paid by another instrument
--   CASH_SHIFT        a till session's takings and its variance
--   STORE_DEPOSIT     a shop banking its cash
--   REMITTANCE        money instructed between units
--   ADVANCE           an operating float issued or settled
--   STORE_EXPENSE     a shop spending from its own float
--   PETTY_REPLENISH   topping a petty cash box back up
--   CASH_DOC          a cash voucher, in or out, with no other document
--   GIRO              a post-dated instrument issued or cleared
--   INTERUNIT_SETTLE  clearing the affiliate accounts between two units
--   RECLASS           an amount moved to the account it should have hit
--   ADJUSTMENT        a difference nobody is going to recover
--   WRITE_OFF         a balance given up on
--   ACQ_SETTLEMENT    a card acquirer paying us, net of its fee
--   GOODS_RECEIPT     stock taken in before the bill arrives
--   CREDIT_NOTE       a supplier's credit against a bill
--   SUPPLIER_ADVANCE  money paid to a supplier before the goods
--   LANDED_COST       freight and duty capitalised into stock
--   COGS_DAY          a day's cost of goods, recognised
--   ASSET_RESERVE     a provision raised or released against an asset

ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        -- as at 0096
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER',
        -- the money documents, whether or not their tables exist yet
        'RETENDER', 'CASH_SHIFT', 'STORE_DEPOSIT', 'REMITTANCE', 'ADVANCE',
        'STORE_EXPENSE', 'PETTY_REPLENISH', 'CASH_DOC', 'GIRO',
        'INTERUNIT_SETTLE', 'ACQ_SETTLEMENT',
        -- corrections, which this release brings
        'RECLASS', 'ADJUSTMENT', 'WRITE_OFF',
        -- purchasing and cost
        'GOODS_RECEIPT', 'CREDIT_NOTE', 'SUPPLIER_ADVANCE', 'LANDED_COST',
        'COGS_DAY', 'ASSET_RESERVE'));

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. The full list of kinds the system may ever post, stated once so that two modules widening it in parallel cannot delete each other''s.';
