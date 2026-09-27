-- 0302: A supplier is a party — with people, a tax number, and terms.
--
-- # Why now
--
-- Three questions the New supplier form could not ask, and all three are asked
-- of every supplier on the day an order is raised.
--
-- 1. **Who do I call?** `supplier` (0032) carries `contact_name`, `phone` and
--    `email` — one person, on the party's own row. Every real supplier has
--    more than one: the sales rep who quotes, the admin who sends the invoice,
--    the driver's number somebody wrote on the delivery note. Three columns
--    force one to overwrite the next, which is the version that loses the
--    person who answered last time.
--
-- 2. **What is their NPWP, and are they PKP?** A bill from a PKP supplier
--    carries PPN and a faktur pajak number; a bill from one who is not, does
--    not. Finance decides how to post a bill from the answer, and until today
--    the answer lived in somebody's memory.
--
-- 3. **What terms did we agree?** 0201 made payment terms a master and the PO
--    composer offers them per order. But the terms are the SUPPLIER's — "30
--    hari" is a standing arrangement with that company, not a decision retaken
--    on every order — so the order should arrive with them already filled in.
--
-- # Why a contacts table, and what happens to the three columns
--
-- The same argument 0221 made for bank accounts: a party has several, they
-- change, and what a document said last March must still be readable. ERPNext
-- reaches the same shape — a `Contact` doctype linked to the party, with a
-- primary flag — for the same reason.
--
-- The three columns on `supplier` are NOT dropped here. Nine screens read
-- `supplier.phone` today, and a migration that both moves the data and breaks
-- every reader is two migrations pretending to be one. What happens instead:
-- every supplier with anything in those columns gets a `supplier_contact` row
-- marked primary, carrying exactly what was there. The columns stay as the
-- primary contact's shadow until the last reader is moved, and the day that is
-- done is the day they are dropped.
--
-- # The tax number is a column, not a table
--
-- Unlike contacts and accounts, a company has ONE NPWP. It changes about never,
-- and when it does the new one replaces the old one — there is no "which NPWP
-- did we use in March", because the faktur carries its own copy. So: a column.
--
-- `is_pkp` is a separate boolean rather than "has an NPWP", because the two are
-- genuinely different facts: a supplier can hold an NPWP and not be a taxable
-- enterprise, and a form that infers one from the other cannot record that.
--
-- # Terms are a reference, not a copy
--
-- `default_payment_terms_code` points at `payment_terms_template`. ON DELETE
-- RESTRICT rather than SET NULL: a template somebody deleted while suppliers
-- still defaulted to it is a silent change to what those orders will be raised
-- with, and 0201 already retires templates rather than deleting them.
--
-- It is a DEFAULT, and only that. The PO composer copies it onto the order the
-- moment a supplier is chosen; from there it is the order's own schedule and
-- editing one changes nothing about the other.

-- ---------------------------------------------------------------------------
-- The people.

CREATE TABLE supplier_contact (
    contact_id      uuid PRIMARY KEY,
    supplier_id     uuid NOT NULL REFERENCES supplier(supplier_id) ON DELETE RESTRICT,

    -- Who they are, and what they are for. `role` is free text: "Sales",
    -- "Admin", "Gudang" — it is read, not matched, and a master for it would
    -- be four rows nobody maintains.
    name            text NOT NULL CHECK (btrim(name) <> ''),
    name_normalized text NOT NULL CHECK (btrim(name_normalized) <> ''),
    role            text CHECK (role IS NULL OR btrim(role) <> ''),

    -- Both optional, and at least one required by the CHECK below: a contact
    -- with a name and no way to reach them is a note, not a contact.
    phone           text CHECK (phone IS NULL OR btrim(phone) <> ''),
    email           text CHECK (email IS NULL OR btrim(email) <> ''),
    note            text,

    -- The one a screen shows when it has room for exactly one.
    is_primary      boolean NOT NULL DEFAULT false,

    -- Hidden from the pickers, still readable on everything it ever appeared
    -- on. Same rule as 0221, for the same reason.
    retired_at      timestamptz,

    version         integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by      text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT supplier_contact_reachable
        CHECK (phone IS NOT NULL OR email IS NOT NULL),

    -- The same person cannot be entered twice for one supplier. Across
    -- suppliers they can: one agent genuinely represents two factories.
    UNIQUE (supplier_id, name_normalized)
);

-- At most one primary per supplier, and a retired contact is never it.
CREATE UNIQUE INDEX ux_supplier_contact_primary
    ON supplier_contact (supplier_id)
    WHERE is_primary AND retired_at IS NULL;

-- The list a supplier's page draws: live contacts, primary first, then name.
CREATE INDEX ix_supplier_contact_by_supplier
    ON supplier_contact (supplier_id, is_primary DESC, name, contact_id)
    WHERE retired_at IS NULL;

COMMENT ON TABLE supplier_contact IS
    'The people at a supplier. The primary one shadows supplier.contact_name/phone/email until the last reader of those columns is moved.';

-- What was on the supplier row becomes that supplier's primary contact.
--
-- Only where there is something to move: a supplier with a blank contact_name
-- and no phone or email has no contact, and inventing one called '—' would put
-- a row in every picker for the rest of the company's life.
--
-- The name falls back to the supplier's own when only a number was recorded,
-- because `name` is NOT NULL and "the company" is a truer answer than a blank.
INSERT INTO supplier_contact (
    contact_id, supplier_id, name, name_normalized, phone, email,
    is_primary, created_by, updated_by
)
SELECT gen_random_uuid(),
       s.supplier_id,
       COALESCE(NULLIF(btrim(s.contact_name), ''), s.name),
       upper(regexp_replace(
           COALESCE(NULLIF(btrim(s.contact_name), ''), s.name),
           '[^A-Za-z0-9]', '', 'g')),
       NULLIF(btrim(s.phone), ''),
       NULLIF(btrim(s.email), ''),
       true,
       'migration:0302',
       'migration:0302'
  FROM supplier s
 WHERE NULLIF(btrim(s.contact_name), '') IS NOT NULL
    OR NULLIF(btrim(s.phone), '') IS NOT NULL
    OR NULLIF(btrim(s.email), '') IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The tax identity, and the standing terms.

ALTER TABLE supplier
    -- As printed on the faktur, punctuation and all: 01.234.567.8-901.000.
    -- Stored as typed because it is copied onto documents, not matched on.
    ADD COLUMN IF NOT EXISTS npwp text
        CHECK (npwp IS NULL OR btrim(npwp) <> ''),
    -- Pengusaha Kena Pajak. False is the safe default: a bill from a supplier
    -- nobody has confirmed is PKP should not be posted as if it carried PPN.
    ADD COLUMN IF NOT EXISTS is_pkp boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS default_payment_terms_code text
        REFERENCES payment_terms_template(code) ON DELETE RESTRICT;

COMMENT ON COLUMN supplier.npwp IS
    'Nomor Pokok Wajib Pajak, as printed. One per company, replaced rather than versioned.';
COMMENT ON COLUMN supplier.is_pkp IS
    'Whether this supplier is a Pengusaha Kena Pajak, and so whether their bills carry PPN.';
COMMENT ON COLUMN supplier.default_payment_terms_code IS
    'The terms an order to this supplier is raised with unless the buyer says otherwise. A default, not a constraint.';

-- The suppliers a payables screen groups by terms.
CREATE INDEX IF NOT EXISTS ix_supplier_default_payment_terms
    ON supplier (default_payment_terms_code)
    WHERE default_payment_terms_code IS NOT NULL;

-- The migration did what it said: every supplier that had a contact on its row
-- now has one in the table. A wrong turn in the INSERT above would otherwise
-- be invisible until somebody noticed a supplier with no phone number.
DO $$
DECLARE
    had integer;
    got integer;
BEGIN
    SELECT count(*) INTO had FROM supplier s
     WHERE NULLIF(btrim(s.contact_name), '') IS NOT NULL
        OR NULLIF(btrim(s.phone), '') IS NOT NULL
        OR NULLIF(btrim(s.email), '') IS NOT NULL;
    SELECT count(*) INTO got FROM supplier_contact WHERE created_by = 'migration:0302';
    IF had <> got THEN
        RAISE EXCEPTION 'every supplier with a contact on its row must have one in the table: % had, % moved', had, got;
    END IF;
END $$;
