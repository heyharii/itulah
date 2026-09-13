-- 0221: A supplier has an account to be paid into.
--
-- # Why now
--
-- A bilyet giro is not a cheque: it is an order to move money **into a named
-- account**, so the paper cannot be written without the payee's bank, account
-- number and account holder. `supplier` (0032) has a name, a contact, a phone,
-- an email and an address, and nothing about where the money goes. Every giro
-- written so far was filled in from somebody's notebook.
--
-- # Why a table and not three columns
--
-- Because a supplier has more than one. The trading company banks at BCA and
-- the factory that ships for them invoices from Mandiri; a supplier moves banks
-- and the old account still has to be readable on the giro we wrote last March.
-- Three columns on `supplier` would force one to overwrite the other, which is
-- the version of this that loses the audit trail.
--
-- ERPNext reaches the same shape from the other end: its `Bank Account` doctype
-- carries `party_type` + `party` and lives beside the supplier rather than
-- inside it, with `is_default` marking the one a payment reaches for.
--
-- # The holder is its own field
--
-- A bank prints the name the account is registered under, and that is regularly
-- not the trading name on the invoice — PT and CV forms, a personal account for
-- a small maker, an old name after a merger. A giro made out to a name the bank
-- does not recognise comes back. So `account_holder` is stored, and stored
-- separately, rather than assumed to be `supplier.name`.
--
-- # Two spellings of the same number
--
-- `account_no` is what a person typed, dashes and spaces and all, and it is what
-- gets printed. `account_no_digits` is the same number with everything but the
-- digits stripped, and it is what uniqueness is judged on — otherwise
-- `123-456-789` and `123456789` are two accounts and the second one is a typo
-- nobody can see. Same reasoning as `supplier_code_normalized` in 0032.
--
-- The bank is free text, not a master. It is printed, not matched: our own five
-- banks are already `account_map` qualifiers, and a supplier may bank anywhere.
-- When something needs to group or reconcile by it, that is the day it becomes
-- a master, and `bank_name_normalized` is what that migration will key on.
--
-- # One default, enforced by the database
--
-- ERPNext clears the flag on every sibling when a default is saved — application
-- code that is correct until two requests arrive together. A partial unique
-- index says the same thing once and cannot be raced.
--
-- # Retire, never delete
--
-- An account that has been paid into is part of what a printed giro said. There
-- is no reference to it yet — the giro print step will add one — so the rule is
-- written now, while it is cheap: `retired_at` hides it from the pickers and
-- nothing removes the row.

CREATE TABLE supplier_bank_account (
    account_id            uuid PRIMARY KEY,
    supplier_id           uuid NOT NULL REFERENCES supplier(supplier_id) ON DELETE RESTRICT,

    -- What the bank is called, as it will be printed. BCA, Bank Mandiri, BRI.
    bank_name             text NOT NULL CHECK (btrim(bank_name) <> ''),
    bank_name_normalized  text NOT NULL CHECK (btrim(bank_name_normalized) <> ''),

    -- As typed, and as compared.
    account_no            text NOT NULL CHECK (btrim(account_no) <> ''),
    account_no_digits     text NOT NULL CHECK (account_no_digits ~ '^[0-9]{5,25}$'),

    -- The name the account is registered under.
    account_holder        text NOT NULL CHECK (btrim(account_holder) <> ''),

    -- Optional. Some banks want the branch on the instrument; most do not.
    branch                text CHECK (branch IS NULL OR btrim(branch) <> ''),

    is_default            boolean NOT NULL DEFAULT false,
    note                  text,

    -- Hidden from the pickers, still readable on everything it ever paid.
    retired_at            timestamptz,

    version               integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by            text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_by            text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    -- The same account cannot be entered twice for one supplier. Across
    -- suppliers it can: two of them may genuinely share a collection account.
    UNIQUE (supplier_id, bank_name_normalized, account_no_digits)
);

-- At most one default per supplier, and a retired account is never the default.
CREATE UNIQUE INDEX ux_supplier_bank_account_default
    ON supplier_bank_account (supplier_id)
    WHERE is_default AND retired_at IS NULL;

-- The list a supplier's page draws: live accounts, default first, then bank.
CREATE INDEX ix_supplier_bank_account_by_supplier
    ON supplier_bank_account (supplier_id, is_default DESC, bank_name, account_id)
    WHERE retired_at IS NULL;
