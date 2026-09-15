-- 0151: A recipient's bank account is not one of our accounts.
--
-- # What was missing
--
-- Nothing in this system could say where a payment was going. `cash_document`
-- (0115) names a party and prints a name on a slip; `supplier_payment` (0084)
-- names a supplier. Neither holds a bank, an account number or an account
-- holder, so every bank transfer the client makes is keyed by hand into the
-- bank's own website from a piece of paper, and the only record of which
-- account was paid is the bank's statement afterwards.
--
-- That gap is the reason a batch payout cannot exist. Twenty payments need
-- twenty places for the money to go, held once and reused, or the twenty-first
-- run will be twenty fresh chances to transpose two digits.
--
-- # This is not a ledger account, and the schema says so by having no room for
-- # one
--
-- The single most dangerous confusion in a payments module is between the
-- company's own money accounts — `cash`, `bank_giro`, resolved through
-- `account_map` to a client account code, debited and credited — and a
-- recipient's bank account, which is a fact about somebody else and appears in
-- the books only as a name on a slip.
--
-- So this table has no `account_code` column, no reference to `ledger_account`,
-- and no semantic key. It cannot be mapped, posted to, or included in a trial
-- balance, because there is nothing on the row for any of those to hold. The
-- trigger below then refuses the mistake in the other direction: somebody
-- typing one of the client's twelve-digit account codes into the account-number
-- box, which would look plausible on a screen and be a payment instruction to
-- nowhere.
--
-- # Who owns it
--
-- The domain that owns the party owns the destination, and Finance reads it.
--
--   SUPPLIER_MASTER  a supplier's account, maintained where suppliers are
--                    maintained. Finance MAY maintain one, because the client's
--                    supplier master does not carry bank details today and a
--                    payment that cannot be made is worse than a field in the
--                    wrong screen. Recorded on the row so that the day the
--                    supplier master grows the field, the ones Finance keyed
--                    can be told apart from the ones it did not.
--   HR               an employee's account. Finance reads and never writes it.
--                    An employee's bank account is personal data that HR holds
--                    a lawful basis for and Finance does not, and a Finance
--                    clerk who could edit it could redirect a salary.
--   FINANCE          a landlord, a courier, the RT — a party with no master
--                    record anywhere else. Finance owns these because nobody
--                    else does.
--
-- The rule is enforced in Rust rather than by a constraint because it is about
-- WHO is asking, and the database does not know that. What the database keeps
-- is the answer to "who is this row's owner", which is the fact the rule needs.
--
-- # Encrypted, and why the mask is stored beside it
--
-- `account_number_enc` is `pgp_sym_encrypt` under a key the application holds
-- and the database does not — pgcrypto has been installed since 0001. Every
-- read that only has to SHOW the destination reads `account_number_mask`, which
-- is a derived value and not a secret; only the act of producing a payment
-- instruction decrypts. A screen, a report, an export and a log therefore
-- cannot leak an account number by accident, because none of them is holding
-- one.
--
-- `account_number_fingerprint` is a SHA-256 of the digits. It exists so that
-- "is this the same account we already have for this party" can be answered
-- without decrypting anything, and so the uniqueness rule below can be a
-- database constraint rather than a read-then-write in Rust.

CREATE TABLE payment_destination (
    destination_id  uuid PRIMARY KEY,

    -- Who is paid. The same three shapes `cash_document.party_kind` uses, and
    -- deliberately the same words: a party is a party whichever module named
    -- it.
    party_type      text NOT NULL CHECK (party_type IN ('SUPPLIER', 'EMPLOYEE', 'OTHER')),
    -- Text and not a foreign key, the same way `supplier_invoice.supplier_id`
    -- and `cash_document.supplier_id` are, and for the same reason: a supplier
    -- a bill names is not always a row in `supplier` yet, and a destination
    -- that could not be created until it was would be a destination nobody
    -- could create when they needed it.
    party_id        text NOT NULL CHECK (btrim(party_id) <> ''),
    -- What a list prints without joining out to four party tables.
    party_name      text NOT NULL CHECK (btrim(party_name) <> ''),

    bank_name       text NOT NULL CHECK (btrim(bank_name) <> ''),
    -- The clearing code, where anybody knows it. Optional: the client's own
    -- records carry "BCA" and no code, and a NOT NULL here would have every row
    -- carrying an invented one.
    bank_code       text,

    -- The number itself, encrypted. See the header.
    account_number_enc bytea NOT NULL,
    -- What a screen may print. Derived by `domain::payment_account_mask`, which
    -- hides a short number completely rather than revealing half of it.
    account_number_mask text NOT NULL CHECK (btrim(account_number_mask) <> ''),
    -- SHA-256 of the digits, hex. Not a secret and not reversible: it answers
    -- "the same account?" and nothing else.
    account_number_fingerprint text NOT NULL CHECK (account_number_fingerprint ~ '^[0-9a-f]{64}$'),

    -- The name the bank has on the account, which is not always the party's
    -- name and is the field a transfer actually fails on.
    account_holder  text NOT NULL CHECK (btrim(account_holder) <> ''),

    -- UNVERIFIED  keyed, nobody has checked it against anything
    -- VERIFIED    somebody named below checked it and said so
    -- REJECTED    somebody named below checked it and it was wrong
    --
    -- REJECTED is kept rather than deleted, so that a wrong account somebody
    -- already tried cannot be re-keyed next month as a fresh unverified one.
    verification_status text NOT NULL DEFAULT 'UNVERIFIED'
                        CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
    verified_by     text,
    verified_at     timestamptz,
    -- How it was checked: a cancelled cheque, a bank confirmation, a one-rupiah
    -- test transfer. The only record of what "verified" meant on this row.
    verification_note text,

    active          boolean NOT NULL DEFAULT true,
    deactivated_by  text,
    deactivated_at  timestamptz,
    deactivated_reason text,

    owner_domain    text NOT NULL
                    CHECK (owner_domain IN ('SUPPLIER_MASTER', 'HR', 'FINANCE')),

    created_by      text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    -- Checked is checked, whichever way it went. UNVERIFIED is the one state
    -- with nobody's name on it.
    CHECK ((verification_status = 'UNVERIFIED') = (verified_at IS NULL)),
    CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
    CHECK (active = (deactivated_at IS NULL)),
    CHECK ((deactivated_by IS NULL) = (deactivated_at IS NULL)),
    -- An employee's account belongs to HR and to nobody else. This is the half
    -- of the ownership rule that IS a fact about the row rather than about who
    -- is asking, so it is a constraint: a Finance-owned employee destination is
    -- not a permission question, it is a row that should not exist.
    CHECK (party_type <> 'EMPLOYEE' OR owner_domain = 'HR')
);

-- One live destination per account per party. Partial, because a deactivated
-- account and a rejected one are both history and both have to be allowed to
-- sit beside the account that replaced them.
CREATE UNIQUE INDEX ux_payment_destination_live
    ON payment_destination (party_type, party_id, account_number_fingerprint)
    WHERE active;

CREATE INDEX ix_payment_destination_party
    ON payment_destination (party_type, party_id) WHERE active;
CREATE INDEX ix_payment_destination_unverified
    ON payment_destination (verification_status) WHERE active AND verification_status <> 'VERIFIED';

-- ---------------------------------------------------------------------------
-- Invariant: a destination is somebody else's account
-- ---------------------------------------------------------------------------
--
-- The structural half of the separation is that this table has no room for an
-- account code. This is the behavioural half: an account number that IS one of
-- the client's account codes, or one of the codes `account_map` points a money
-- meaning at, is refused rather than stored.
--
-- Both halves are needed. Without the columns there is nothing to post; without
-- the trigger somebody types `101100100100` into the account-number box, the
-- mask reads `••••••••0100`, it looks like every other row, and a payment
-- instruction goes out addressed to a string that means nothing at any bank.
--
-- The comparison is exact and needs no plaintext. `account_number_fingerprint`
-- is a SHA-256 of the digits keyed, and pgcrypto — installed since 0001 — can
-- take the same digest of every account code in the chart. So the trigger asks
-- "does this fingerprint match the fingerprint of one of our own codes", which
-- is a yes or a no with no false positives, rather than guessing from the
-- mask's length and tail. Four thousand of the client's 7,528 codes share a
-- last-four with something; a heuristic here would refuse real bank accounts.
--
-- `account_map` is not checked separately: every mapped code is a
-- `ledger_account` code, so the money accounts are already inside this net.

CREATE OR REPLACE FUNCTION refuse_our_own_account_as_a_destination() RETURNS trigger AS $$
DECLARE
    clash text;
BEGIN
    SELECT a.account_code INTO clash
      FROM ledger_account a
     WHERE encode(digest(a.account_code, 'sha256'), 'hex') = NEW.account_number_fingerprint
     LIMIT 1;

    IF clash IS NOT NULL THEN
        RAISE EXCEPTION
            'that is %, one of our own ledger accounts, not a bank account we are paying money to. A payment destination is somebody else''s account; the company''s own cash and bank accounts are named by meaning on the Account Map and can never be a recipient',
            clash;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_destination_is_not_one_of_ours
    BEFORE INSERT OR UPDATE ON payment_destination
    FOR EACH ROW EXECUTE FUNCTION refuse_our_own_account_as_a_destination();

COMMENT ON TABLE payment_destination IS
    'Where a payment goes: an external recipient bank account, owned by the domain that owns the party. Never a chart-of-accounts account and never a company money account — there is no column on this table that could hold one, and the trigger refuses a number shaped like one.';
COMMENT ON COLUMN payment_destination.account_number_enc IS
    'pgp_sym_encrypt under a key the application holds and the database does not. Only producing a payment instruction decrypts; every screen reads the mask.';
COMMENT ON COLUMN payment_destination.account_number_fingerprint IS
    'SHA-256 of the digits, hex. Answers "is this the same account" without decrypting, and carries the uniqueness rule.';
COMMENT ON COLUMN payment_destination.owner_domain IS
    'SUPPLIER_MASTER, HR or FINANCE. Finance reads every destination and may write a supplier or ad-hoc one; an employee destination is HR''s and the CHECK on this column says so.';
