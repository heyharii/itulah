-- 0473: a journal can be a template and repeat, and a party group has its
-- own account.
--
-- The last ERPNext pieces of "Desain Fondasi Finance Dinamis":
--
--   * Journal Entry Template: a set of lines Finance saves once and starts a
--     manual journal from (rent accruals, the monthly management fee memo).
--   * Auto Repeat: a template that raises a draft — or posts — on a schedule,
--     swept hourly by the cloud like recurring bills.
--   * Party Group accounts: ERPNext resolves a party's account from the party,
--     then its group, then the company. A supplier's group here is its
--     `category` (MERCHANDISE, EXPENSE, AFFILIATE); a link with source
--     PARTY_GROUP and source_id `SUPPLIER:<category>` answers for every
--     supplier of that group that has no link of its own.

ALTER TABLE account_link DROP CONSTRAINT account_link_source_type_check;
ALTER TABLE account_link ADD CONSTRAINT account_link_source_type_check
    CHECK (source_type IN ('COMPANY', 'EXPENSE_CATEGORY', 'PARTY', 'PARTY_GROUP', 'PAY_COMPONENT',
                           'ASSET_CLASS', 'PAYMENT_METHOD', 'TAX_TEMPLATE', 'DIVISION'));

CREATE TABLE journal_template (
    template_id uuid PRIMARY KEY,
    name        text NOT NULL CHECK (btrim(name) <> ''),
    memo        text,
    -- The lines as a manual journal carries them (PostingLine), amounts
    -- included; a template with zero amounts is a shape filled in each time.
    lines       jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
    is_active   boolean NOT NULL DEFAULT true,
    created_by  text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text,
    updated_at  timestamptz
);

CREATE TABLE journal_repeat (
    repeat_id    uuid PRIMARY KEY,
    template_id  uuid NOT NULL REFERENCES journal_template (template_id),
    frequency    text NOT NULL CHECK (frequency IN ('MONTHLY', 'QUARTERLY', 'YEARLY')),
    next_date    date NOT NULL,
    end_date     date,
    -- Post straight away, or leave a draft for somebody to review and submit.
    auto_post    boolean NOT NULL DEFAULT false,
    is_active    boolean NOT NULL DEFAULT true,
    last_run_on  date,
    created_by   text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (end_date IS NULL OR end_date >= next_date OR NOT is_active)
);

CREATE INDEX ix_journal_repeat_due ON journal_repeat (next_date) WHERE is_active;

COMMENT ON TABLE journal_template IS 'ERPNext Journal Entry Template (0473).';
COMMENT ON TABLE journal_repeat IS 'ERPNext Auto Repeat for a journal template (0473): swept hourly by run_journal_repeat_agent.';
