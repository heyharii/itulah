-- 0223: A company account is a real account at a real bank.
--
-- # What was missing
--
-- Our own bank accounts exist only as a binding: a row in `account_map` saying
-- that at store-03 the meaning `bank_giro` qualified "BCA" is account code
-- 101100200103. That is enough to post and nothing else. Nobody can say what
-- the number is, whose name it is in, which branch opened it, or which account
-- a location pays out of by default — and every one of those is needed the
-- moment a giro is written or a statement has to be filed against the right
-- account.
--
-- The bank name is worse than missing: it is `account_map.qualifier`, free text
-- retyped on every mapping row, with nothing stopping "BCA", "Bca" and
-- "BCA KCP Cihampelas" from being three banks.
--
-- # Why this is not a master of banks
--
-- 0221 took the other half of this problem — where a SUPPLIER's money goes —
-- and modelled the bank as a name on the account, normalised for comparison.
-- Following that rather than inventing a `bank` table keeps one shape for both
-- halves, and the Banks screen becomes what it should have been: the
-- institutions gathered from the accounts that name them, ours and theirs
-- together, rather than a list somebody has to maintain by hand.
--
-- # Why this does not replace the account map
--
-- The map still decides where a posting lands. This describes the account the
-- map points at. Keeping them apart is what lets a bank account be renumbered,
-- moved to another branch or retired without touching a single posting rule.

CREATE TABLE company_bank_account (
    account_id            uuid PRIMARY KEY,

    -- The ledger account this describes, at one place. The same composite key
    -- every money screen addresses an account by.
    ledger_account_code   text NOT NULL,
    is_group              boolean NOT NULL DEFAULT false CHECK (is_group = false),
    site_id               text NOT NULL REFERENCES site(id),

    -- As it will be printed, and as it is compared. Same pair as 0221.
    bank_name             text NOT NULL CHECK (btrim(bank_name) <> ''),
    bank_name_normalized  text NOT NULL CHECK (btrim(bank_name_normalized) <> ''),

    account_no            text NOT NULL CHECK (btrim(account_no) <> ''),
    account_no_digits     text NOT NULL CHECK (account_no_digits ~ '^[0-9]{5,25}$'),

    -- The name the account is registered under. Ours is usually the company's
    -- legal name, and a shop's operating account is regularly not.
    account_holder        text NOT NULL CHECK (btrim(account_holder) <> ''),
    branch                text CHECK (branch IS NULL OR btrim(branch) <> ''),

    -- Two kinds and no more: the client's chart has exactly two homes for bank
    -- money, `1011002 CASH IN BANK GIRO` and `1011003` savings. IBAN, SWIFT and
    -- account subtypes are ERPNext's international problem, not ours.
    kind                  text NOT NULL CHECK (kind IN ('GIRO', 'SAVINGS')),

    -- The account this location pays out of and is paid into unless somebody
    -- says otherwise. ERPNext's `is_default`, per place rather than per company
    -- because ours is a chain of shops that each bank locally.
    is_primary            boolean NOT NULL DEFAULT false,

    note                  text,

    -- Hidden from the pickers, still readable on everything it ever paid. Same
    -- reasoning as 0221: an account that closed last March still has to be
    -- legible on the statements it produced.
    retired_at            timestamptz,

    version               integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by            text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_by            text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (ledger_account_code, is_group)
        REFERENCES ledger_account (account_code, is_group),

    -- One description per ledger binding. Two rows describing one account at
    -- one place is two answers to "what is the number", and a giro printed from
    -- the wrong one comes back.
    UNIQUE (ledger_account_code, site_id)
);

-- At most one primary account per place, among the live ones. A retired
-- account keeps its flag — it WAS the primary — and does not block the one
-- that replaced it.
CREATE UNIQUE INDEX ux_company_bank_account_primary
    ON company_bank_account (site_id)
    WHERE is_primary AND retired_at IS NULL;

CREATE INDEX ix_company_bank_account_bank
    ON company_bank_account (bank_name_normalized)
    WHERE retired_at IS NULL;

COMMENT ON TABLE company_bank_account IS
    'What our own bank accounts actually are. The account map still decides '
    'where a posting lands; this describes the account it points at, so the '
    'number can change without touching a posting rule.';
