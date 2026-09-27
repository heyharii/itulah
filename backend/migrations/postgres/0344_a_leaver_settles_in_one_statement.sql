-- A leaver settles in one statement, once.
--
-- # Aggregated, not re-entered
--
-- HRMS's Full & Final statement, fed by tables this estate already has. The
-- receivables and payables are READS of live tables — the finance lane's
-- `advance` (0280) for what the leaver still holds, `expense_claim` (0341)
-- APPROVED and unpaid for what the company still owes — plus manual
-- asset-recovery rows for the laptop that never came back. The statement
-- copies the totals in at creation (the handover-snapshot rule: the statement
-- is what Finance settles against, so it stops moving) and SETTLE re-reads
-- the same sources and REFUSES on drift, naming what moved. There is no
-- `as_of` watermark to maintain and no second copy of the sources' rules:
-- one read, written twice, compared.
--
-- # The one journal, and where each leg lives
--
-- SETTLE posts `('FULL_AND_FINAL', fnf_id, 'MAIN')` — a single entry for the
-- net, never one journal per source, because the settlement is one act: the
-- company and the person closing their books against each other. The net is
--
--     claim_payable + final_pay − advance_outstanding − asset_recovery
--
-- and the two legs are placed by the answer to "where does money cross?":
-- the settlement happens at head office, for a person of a place. The
-- person-side line posts at the LEAVER'S PLACE (the `employee_claim_payable`
-- meaning, party = the leaver), and the cash side posts at
-- HEAD_OFFICE_SITE (`petty_cash` at `dc`, the same constant `poster` keeps).
-- Two sites, so `poster::post` adds the affiliate legs itself — the same
-- machinery every inter-unit entry leans on — and this module writes no leg
-- of its own and refuses nothing about the placement, because the balancer
-- either expresses it or refuses by name through an unmapped meaning.
-- (Recorded placement decision; the spec left the counter-leg open.)
--
-- A net of exactly zero posts nothing: `poster` refuses an empty entry, and
-- a settlement of nothing has nothing to say — the refusal names the
-- arithmetic rather than writing a zero journal to satisfy a column.
--
-- # Idempotent by the poster's own key
--
-- `(source_kind, source_id, purpose)` is unique (0140), so a double-clicked
-- settle is a 409 from the database and not from a status check two racing
-- requests can both pass. The state move is a conditional UPDATE on DRAFT for
-- the same reason the claims lane gives: the loser's transaction — posting
-- included — rolls back whole.

CREATE TABLE full_and_final_statement (
    fnf_id        uuid PRIMARY KEY,
    employee_id   text NOT NULL REFERENCES employee(id),
    place_id      text NOT NULL REFERENCES org_place(id),
    transaction_on date NOT NULL,
    state         text NOT NULL DEFAULT 'DRAFT'
                    CHECK (state IN ('DRAFT','SETTLED','CANCELLED')),
    -- The aggregated reads, frozen at CREATION (the draft is the statement;
    -- settle compares against these and refuses on drift).
    advance_outstanding_minor  bigint NOT NULL DEFAULT 0
                               CHECK (advance_outstanding_minor >= 0),
    claim_payable_minor        bigint NOT NULL DEFAULT 0
                               CHECK (claim_payable_minor >= 0),
    asset_recovery_minor       bigint NOT NULL DEFAULT 0
                               CHECK (asset_recovery_minor >= 0),
    final_pay_minor            bigint NOT NULL DEFAULT 0
                               CHECK (final_pay_minor >= 0),
    settled_entry_id uuid REFERENCES journal_entry(entry_id),
    settled_by text, settled_at timestamptz,
    cancelled_by text, cancel_reason text,
    -- CREATED, SETTLED, CANCELLED — the trail the Exits screen renders.
    history        jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by  text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'SETTLED') = (settled_entry_id IS NOT NULL)),
    CHECK ((settled_entry_id IS NULL) = (settled_by IS NULL)),
    CHECK ((state = 'CANCELLED') = (cancelled_by IS NOT NULL)),
    UNIQUE (employee_id, transaction_on)
);

COMMENT ON COLUMN full_and_final_statement.advance_outstanding_minor IS
    'What the leaver still holds of the company''s money, read from the
     finance lane''s `advance` (0280): EMPLOYEE-party rows PAID or
     PARTIALLY_SETTLED, minus their settlements, summed. Frozen here at
     creation; settle re-reads and refuses on drift.';

COMMENT ON COLUMN full_and_final_statement.claim_payable_minor IS
    'What the company still owes the leaver on sanctioned claims (0341):
     APPROVED and never paid, summed. Frozen here at creation; settle
     re-reads and refuses on drift.';

COMMENT ON COLUMN full_and_final_statement.final_pay_minor IS
    'The last run''s gross, or a stated figure — the operator types what the
     final pay is; this backend computes no wages. Deductions belong in the
     advance and asset columns, which is why the CHECK floors it at zero.';

COMMENT ON COLUMN full_and_final_statement.history IS
    'Append-only jsonb events (actor, action, reason, at, detail?): CREATED,
     SETTLED (detail carries the journal number and id), CANCELLED.';

CREATE INDEX ix_fnf_employee ON full_and_final_statement (employee_id, transaction_on DESC);
CREATE INDEX ix_fnf_open ON full_and_final_statement (created_at DESC) WHERE state = 'DRAFT';

CREATE TABLE full_and_final_asset (
    row_id   uuid PRIMARY KEY,
    fnf_id   uuid NOT NULL REFERENCES full_and_final_statement(fnf_id) ON DELETE CASCADE,
    -- The assets module's asset id — `fixed_asset(asset_id)`, typed so a typo
    -- is a foreign-key refusal and not a recovery against nothing.
    asset_id uuid NOT NULL REFERENCES fixed_asset(asset_id),
    note     text NOT NULL CHECK (btrim(note) <> ''),
    recovery_minor bigint NOT NULL CHECK (recovery_minor >= 0)
);

COMMENT ON TABLE full_and_final_asset IS
    'The manual rows of a Full & Final statement: which asset left with the
     leaver, what recovering it is worth, and the note that says which it
     was. The statement''s asset_recovery_minor is their sum, and settle
     refuses a draft whose rows and total disagree.';

DO $$
BEGIN
    ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
    ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
        CHECK (source_kind IN (
            -- the list as 0342 left it
            'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'AMORTIZATION_RUN',
            'ASSET_CAPITALIZATION', 'ASSET_DISPOSAL', 'ASSET_RESERVE',
            'ASSET_TRANSFER', 'BANK_STATEMENT', 'CASH_COUNT', 'CASH_DOC',
            'CASH_SHIFT', 'COGS_DAY', 'CREDIT_NOTE', 'DEPRECIATION',
            'EQUITY_MOVEMENT', 'EXPENSE_CLAIM', 'EXPENSE_CLAIM_PAYOUT', 'GIRO',
            'GOODS_RECEIPT', 'INTERUNIT_SETTLE',
            'LANDED_COST', 'MANUAL', 'OPENING', 'PAYMENT', 'PAYROLL_RUN',
            'PETTY_REPLENISH', 'PREPAID_ALLOCATION', 'RECLASS', 'REMITTANCE',
            'RETENDER', 'REVERSAL', 'SALE_DAY', 'STOCK_COUNT', 'STORE_DEPOSIT',
            'STORE_EXPENSE', 'SUPPLIER_ADVANCE', 'SUPPLIER_INVOICE',
            'TAX_SETTLEMENT', 'TRANSFER', 'VOUCHER_ISSUE', 'WRITE_OFF',
            -- this migration
            'FULL_AND_FINAL'
        ));
END $$;

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. FULL_AND_FINAL is the settlement of a leaver''s
     statement — the one journal the Full & Final posts, for the net of what
     the company owes and what the leaver returns. See 0344.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'journal_entry_source_kind_check'
                      AND pg_get_constraintdef(oid) LIKE '%FULL_AND_FINAL%') THEN
        RAISE EXCEPTION 'FULL_AND_FINAL is not allowed as a source kind';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'full_and_final_statement_employee_id_transaction_on_key') THEN
        RAISE EXCEPTION 'full_and_final_statement installed without its one-per-day UNIQUE';
    END IF;
END $$;
