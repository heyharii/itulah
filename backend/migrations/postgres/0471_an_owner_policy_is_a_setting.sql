-- 0471: an owner policy is a setting.
--
-- Stage 5 of "Desain Fondasi Finance Dinamis". The owner's policies about
-- accounts were written into migrations: which documents may reach an account
-- (0261, 0376, 0380), which accounts belong to head office only (0376, 0380),
-- which accounts must name the unit on the other side (a CHECK listing
-- seventeen account codes), and whether automatic posting runs per document
-- kind. The mechanisms stay — they are what makes the books safe — and their
-- contents become Finance's to edit from the screen (finance_policies.rs).
--
-- New here, from ERPNext: an account can be frozen. A frozen account takes no
-- new line except the ones that close or open the books and the reversal of
-- an entry already on it.

-- Which accounts must name the counterparty unit is a flag Finance sets per
-- account, not a list of codes in a CHECK.
ALTER TABLE ledger_account DROP CONSTRAINT ledger_account_counterparty_is_rare;

ALTER TABLE ledger_account ADD COLUMN is_frozen boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN ledger_account.is_frozen IS
    'ERPNext freeze_account (0471): the account takes no new line except period closing, opening and reversals.';

CREATE FUNCTION refuse_line_on_frozen_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    kind text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ledger_account WHERE account_code = NEW.account_code AND is_frozen) THEN
        RETURN NEW;
    END IF;
    SELECT source_kind INTO kind FROM journal_entry WHERE entry_id = NEW.entry_id;
    IF kind IN ('PERIOD_CLOSING', 'OPENING', 'REVERSAL') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'account % is frozen; Finance unfreezes it on the chart of accounts before anything posts to it',
        NEW.account_code
        USING ERRCODE = 'P0001';
END
$$;

CREATE TRIGGER journal_line_account_not_frozen
    BEFORE INSERT ON journal_line
    FOR EACH ROW EXECUTE FUNCTION refuse_line_on_frozen_account();

-- The posting switch covers Finance's own flows too, not only sales and stock.
ALTER TABLE finance_posting_source_policy DROP CONSTRAINT IF EXISTS finance_posting_source_policy_module_check;
ALTER TABLE finance_posting_source_policy
    ADD CONSTRAINT finance_posting_source_policy_module_check
        CHECK (module IN ('SALES', 'INVENTORY', 'FINANCE', 'PAYROLL', 'ASSETS', 'PURCHASING'));

-- The chart's history shows the two new flags too.
CREATE OR REPLACE FUNCTION ledger_account_visible(a ledger_account) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'name', a.name,
        'parent_code', a.parent_code,
        'is_group', a.is_group,
        'is_active', a.is_active,
        'root_type', a.root_type,
        'account_type', a.account_type,
        'statement_section', a.statement_section,
        'normal_balance', a.normal_balance,
        'dimension', a.dimension,
        'is_frozen', a.is_frozen,
        'requires_counter_site', a.requires_counter_site)
$$;
