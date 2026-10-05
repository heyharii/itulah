-- A contractor project is paid ahead, invoiced over months, and split into
-- assets when the work is done (owner, 2026-10-01: Assets › Contractor
-- projects).
--
-- The client pays a contractor an advance (1011303003 Advanced – To
-- Contractors), gathers the contractor's invoices over the months of the work
-- into Contract in Progress, and at the end divides the whole cost between the
-- fixed assets it built and whatever was only an expense. Every money step is
-- an ordinary posting:
--
--   advance   Dr advance (CONTRACTOR)          / Cr bank
--   invoice   a supplier bill whose line is CIP (Dr CIP / Cr payable), then
--             Dr payable / Cr advance for the part the advance covers
--   close     Dr each asset's cost account or the expense / Cr CIP
--
-- These tables only say which advances, bills and closing lines belong to
-- which project. Balances are summed from them and from the bills' own rows.
CREATE TABLE contractor_project (
    project_id      uuid PRIMARY KEY,
    project_number  text NOT NULL UNIQUE,
    name            text NOT NULL CHECK (btrim(name) <> ''),
    supplier_id     text NOT NULL,
    unit_id         text NOT NULL,
    note            text,
    status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    opened_by       text NOT NULL,
    opened_at       timestamptz NOT NULL DEFAULT now(),
    closed_on       date,
    closed_entry_id uuid REFERENCES journal_entry(entry_id),
    closed_by       text,
    CHECK ((status = 'CLOSED') = (closed_on IS NOT NULL))
);

CREATE TABLE contractor_project_advance (
    advance_id      uuid PRIMARY KEY,
    project_id      uuid NOT NULL REFERENCES contractor_project(project_id),
    paid_on         date NOT NULL,
    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
    account_key     text NOT NULL,
    account_qualifier text NOT NULL,
    reference       text,
    entry_id        uuid NOT NULL REFERENCES journal_entry(entry_id),
    paid_by         text NOT NULL,
    paid_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_contractor_advance_project ON contractor_project_advance (project_id);

CREATE TABLE contractor_project_invoice (
    invoice_id      uuid PRIMARY KEY REFERENCES supplier_invoice(invoice_id),
    project_id      uuid NOT NULL REFERENCES contractor_project(project_id),
    -- What the project's advance covered of this bill. The rest is owed to the
    -- contractor and paid through a BKK like any bill.
    applied_minor   bigint NOT NULL DEFAULT 0 CHECK (applied_minor >= 0),
    applied_entry_id uuid REFERENCES journal_entry(entry_id),
    CHECK ((applied_minor = 0) = (applied_entry_id IS NULL))
);
CREATE INDEX ix_contractor_invoice_project ON contractor_project_invoice (project_id);

CREATE TABLE contractor_project_split (
    project_id      uuid NOT NULL REFERENCES contractor_project(project_id),
    line_number     integer NOT NULL CHECK (line_number > 0),
    kind            text NOT NULL CHECK (kind IN ('ASSET', 'EXPENSE')),
    name            text NOT NULL,
    class_code      text,
    account_code    text NOT NULL,
    useful_life_months integer,
    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
    asset_id        uuid,
    PRIMARY KEY (project_id, line_number),
    CHECK ((kind = 'ASSET') = (class_code IS NOT NULL))
);
