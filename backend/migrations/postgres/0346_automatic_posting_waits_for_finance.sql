-- 0346: pause document-driven journal posting while Finance establishes its
-- client chart and manual journal workflow. Manual Finance journals remain
-- submit-able; source modules must not create new ledger entries yet.

CREATE TABLE finance_posting_control (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    automatic_posting_enabled boolean NOT NULL DEFAULT false,
    changed_by text NOT NULL DEFAULT 'migration/0346',
    changed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO finance_posting_control (singleton, automatic_posting_enabled)
VALUES (true, false);

COMMENT ON TABLE finance_posting_control IS
    'Global gate for source-driven journal posting. Manual Finance journals remain available while the chart and posting maps are under review.';
COMMENT ON COLUMN finance_posting_control.automatic_posting_enabled IS
    'False until Finance completes the client chart and reviews every source posting map. Re-enable only as an explicit Finance decision.';
