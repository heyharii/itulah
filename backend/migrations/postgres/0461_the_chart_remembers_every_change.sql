-- 0461: the chart remembers every change made to it.
--
-- Finance edits the chart of accounts from a screen now, the way an Accounts
-- Manager does in ERPNext: add an account, rename it, move it under another
-- heading, change its type, retire it, bring it back. The change applies at
-- once; who may make it is a question of permission, not of a second person
-- (owner decision 27 Sep 2026: a small business, run like ERPNext). What it may
-- not do is happen without a trace, so every change to an account — from the
-- screen, from "Tambah bank", from a later migration — is kept here with the
-- account as it was and as it became, who did it and why.
--
-- The actor and the reason travel as transaction settings (`finance.actor`,
-- `finance.reason`), which the Rust sets before it writes; a change that sets
-- neither (a migration, a fixture) is recorded as `system`.

CREATE TABLE ledger_account_change (
    change_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_code text NOT NULL,
    action       text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DEACTIVATE', 'REACTIVATE')),
    before       jsonb,
    after        jsonb NOT NULL,
    reason       text,
    changed_by   text NOT NULL,
    changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_ledger_account_change_account ON ledger_account_change (account_code, changed_at DESC);
CREATE INDEX ix_ledger_account_change_at ON ledger_account_change (changed_at DESC);

COMMENT ON TABLE ledger_account_change IS
    'Every change to the chart of accounts, with the account before and after, who and why (0461).';

-- What a person reads when they ask "what changed": the columns a change can
-- touch, not the nested-set bookkeeping (lft/rgt/depth) the tree keeps for
-- itself.
CREATE FUNCTION ledger_account_visible(a ledger_account) RETURNS jsonb
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
        'dimension', a.dimension)
$$;

CREATE FUNCTION record_ledger_account_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    what text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        what := 'CREATE';
    ELSIF OLD.is_active AND NOT NEW.is_active THEN
        what := 'DEACTIVATE';
    ELSIF NOT OLD.is_active AND NEW.is_active THEN
        what := 'REACTIVATE';
    ELSIF ledger_account_visible(OLD) IS DISTINCT FROM ledger_account_visible(NEW) THEN
        what := 'UPDATE';
    ELSE
        RETURN NEW;
    END IF;
    INSERT INTO ledger_account_change (account_code, action, before, after, reason, changed_by)
    VALUES (NEW.account_code, what,
            CASE WHEN TG_OP = 'UPDATE' THEN ledger_account_visible(OLD) END,
            ledger_account_visible(NEW),
            NULLIF(current_setting('finance.reason', true), ''),
            COALESCE(NULLIF(current_setting('finance.actor', true), ''), 'system'));
    RETURN NEW;
END
$$;

CREATE TRIGGER ledger_account_is_remembered
    AFTER INSERT OR UPDATE ON ledger_account
    FOR EACH ROW EXECUTE FUNCTION record_ledger_account_change();
