-- A COA heading is not a financial statement classification.
--
-- The supplied chart has income accounts nested below expense headings, and
-- both income and expense under non-operating headings. Reports therefore
-- need a reviewed classification on each account instead of deriving it from
-- the first digit of its account code.

ALTER TABLE ledger_account
    ADD COLUMN statement_section TEXT;

UPDATE ledger_account
   SET statement_section = CASE root_class::text
       WHEN '1' THEN 'ASSET'
       WHEN '2' THEN 'LIABILITY'
       WHEN '3' THEN 'EQUITY'
       WHEN '4' THEN 'REVENUE'
       WHEN '5' THEN 'COST_OF_SALES'
       WHEN '6' THEN 'OPERATING_EXPENSE'
       WHEN '7' THEN 'OTHER_EXPENSE'
       ELSE 'OTHER_NET'
   END;

UPDATE ledger_account
   SET statement_section = 'OTHER_EXPENSE'
 WHERE account_code IN ('8101', '8201');

ALTER TABLE ledger_account
    ALTER COLUMN statement_section SET NOT NULL,
    ADD CONSTRAINT ledger_account_statement_section_known
        CHECK (statement_section IN (
            'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST_OF_SALES',
            'OPERATING_EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE', 'OTHER_NET'
        ));

CREATE INDEX ix_ledger_account_statement_section
    ON ledger_account (statement_section, account_code);

COMMENT ON COLUMN ledger_account.statement_section IS
    'The account''s financial statement section, set independently of its COA parent. Needed when a COA heading mixes income and expense or its account hierarchy is for management reporting.';
