-- A recurring bill is a promise about being charged, and it raises itself.
--
-- Electricity, water, internet, rent, security: the client is invoiced for the
-- same things every month, by the same parties, at roughly the same figures.
-- Today each one waits for a person to type it. The waiting has a cost the
-- depreciation agent already documented: a month nobody types looks exactly
-- like a month in which nothing was owed, and the ageing quietly loses a
-- row that was never wrong.
--
-- # The shape
--
-- One `bill_template` per recurring charge: who invoices, where the cost
-- lands (account + category, as an expense bill's own line), what figure to
-- expect and how far the real bill may sit from it before a person has to
-- look, which day of the month the invoice usually arrives.
--
-- The agent raises a DRAFT expense bill from the template once per period --
-- `bill_template_run` is the once-guard, keyed (template, period) -- and the
-- draft is a placeholder awaiting the real paper: a person matches, adjusts
-- or deletes it. The template never posts and never pays; those remain the
-- two-handed acts they already are.

CREATE TABLE bill_template (
    template_id   uuid PRIMARY KEY,

    -- Who invoices us. A supplier, as the bill lane already knows one.
    supplier_id   text NOT NULL,
    supplier_name text,

    -- Where the bill is filed and where the cost lands. One template, one
    -- place: a head-office invoice for four shops is four templates, which is
    -- also four promises about four figures rather than one about an average.
    site_id       text NOT NULL REFERENCES site(id),

    -- The expense, as an expense bill's own line names it: an account and,
    -- where the account declares a family, the category that narrows it.
    expense_account_code text NOT NULL,
    expense_category_code text,
    expense_site_id text NOT NULL REFERENCES site(id),

    -- The figure we expect, before tax. The draft carries it; the real bill
    -- is matched against it with the tolerance, and a gap wider than the
    -- tolerance is a person's question, not a rounding.
    expected_subtotal_minor bigint NOT NULL CHECK (expected_subtotal_minor > 0),
    expected_tax_minor      bigint NOT NULL DEFAULT 0 CHECK (expected_tax_minor >= 0),
    tolerance_bps           integer NOT NULL DEFAULT 500
                            CHECK (tolerance_bps BETWEEN 0 AND 10000),

    -- Which day of the month the invoice usually arrives. 28..31 are clamped
    -- to the month's own end by the sweep, because February is not a promise
    -- anybody can make about the 30th.
    due_day       integer NOT NULL CHECK (due_day BETWEEN 1 AND 31),

    label         text NOT NULL CHECK (btrim(label) <> ''),
    note          text,

    active        boolean NOT NULL DEFAULT true,
    created_by    text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at    timestamptz NOT NULL DEFAULT now(),
    retired_by    text,
    retired_at    timestamptz,

    -- The expense the template names must be a postable leaf, and the
    -- category — when there is one — must belong to it. A CHECK cannot hold a
    -- subquery, so both are asserted where the template is written, by the
    -- same `assert_postable` / `assert_category_for_account` the bill lane
    -- runs on a typed line; the foreign key below only keeps the code honest
    -- about existing.
    FOREIGN KEY (expense_account_code)
        REFERENCES ledger_account (account_code)
);

-- The once-guard: one draft per template per period, however often the sweep
-- runs or the node restarts.
CREATE TABLE bill_template_run (
    template_id   uuid NOT NULL REFERENCES bill_template(template_id),
    period        date NOT NULL CHECK ((period = date_trunc('month', period)::date)),
    invoice_id    uuid NOT NULL REFERENCES supplier_invoice(invoice_id),
    raised_by     text NOT NULL,
    raised_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (template_id, period)
);

COMMENT ON TABLE bill_template IS
    'A recurring charge (listrik, sewa, internet): the agent raises a DRAFT bill from it once per period; matching, adjusting and posting stay with a person.';
