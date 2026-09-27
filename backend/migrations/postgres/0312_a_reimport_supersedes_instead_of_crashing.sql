-- A re-import of the same period is a supersede, and a supersede cannot land.
--
-- # What was wrong
--
-- `import_statement` inserts the replacing statement first and only then
-- marks the replaced one `superseded_by` -- the unique index that keeps one
-- statement in force per account and period saw both rows live at once and
-- fired: every re-import of a period the ledger already held died as
-- SQLSTATE 23505 -- "database operation failed", naming neither the month
-- nor the statement it replaced. A bank that reissues a statement, a first
-- upload cut short, a correction: all refused, all without a sentence.
--
-- # The shape
--
-- Two moves, one intent: the import now marks its predecessor superseded
-- BEFORE inserting the replacement (the code's order, changed), and the
-- `superseded_by` foreign key becomes DEFERRABLE so that marking can happen
-- while the replacement is not yet on the page. The reference is checked at
-- COMMIT instead of at the statement, by which time both rows exist and the
-- order the import had to use stops mattering.
--
-- The index keeps its rule, immediate as ever: at most one statement in
-- force -- `superseded_by IS NULL` -- per account and period. Nothing else
-- writes `bank_statement`, and no other path marks a supersede, so the
-- deferral is exercised by exactly the flow that needs it.

ALTER TABLE bank_statement
    DROP CONSTRAINT bank_statement_superseded_by_fkey;

ALTER TABLE bank_statement
    ADD CONSTRAINT bank_statement_superseded_by_fkey
    FOREIGN KEY (superseded_by)
    REFERENCES bank_statement (statement_id)
    DEFERRABLE INITIALLY DEFERRED;
