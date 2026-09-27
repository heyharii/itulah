-- Parties link; the ledger already says which way.
--
-- # The link
--
-- ERPNext's answer to "this customer is also a supplier" is `Party Link`: a
-- row, not a merge. Two registers stay two registers (0212); netting and the
-- shared balance read through the link. ERPNext validates it in
-- `party_link.py` — a party appears on one side of one link, and the pair is
-- unique. Those refusals become three indexes here, because a rule a database
-- enforces cannot be raced by two requests (the same argument 0221 made about
-- `is_default`).
--
-- # The column that already existed
--
-- The plan carried a promise from ERPNext's Payment Ledger Entry:
-- `account_type`, the party's registered direction on every row. Reading our
-- own `payment_ledger_entry` (0143) before writing it: the column has been
-- here since the table was born, under its own name and its own CHECK —
--
--     side text NOT NULL CHECK (side IN ('RECEIVABLE', 'PAYABLE'))
--
-- — which is precisely ERPNext's `account_type`, filled at write time by the
-- rule that knows, exactly as ERPNext fills it from the Party Type registry.
-- Adding a second column with the same meaning would be the "two answers to
-- one question" this chain exists to refuse. So this migration adds no
-- column: the mapping for readers coming from ERPNext is
--
--     ERPNext payment_ledger_entry.account_type  ≡  our .side
--     ERPNext Party Type.account_type            ≡  our party_type.account_type
--
-- and the backfill this file once promised is zero rows by construction.
--
-- # Also not here, deliberately
--
-- A separate advance ledger: `ple_open` has carried
-- `voucher_kind = 'ADVANCE'` since 0113, and a second table would be a second
-- answer to "what has this party drawn in advance". The repost queue named in
-- the plan moves to §9 as an open decision — backdated postings that shift
-- allocations are a poster-lane question, and the poster lane has not asked.

CREATE TABLE party_link (
    link_id        uuid PRIMARY KEY,

    -- The register side a payment normally answers: SUPPLIER or CUSTOMER.
    -- ERPNext restricts the primary role to Customer|Supplier for the same
    -- reason we restrict it to the two registers every bill can name.
    primary_role   text NOT NULL
                   REFERENCES party_type (party_type)
                   CHECK (primary_role IN ('SUPPLIER', 'CUSTOMER')),
    primary_party  text NOT NULL CHECK (btrim(primary_party) <> ''),
    secondary_role text NOT NULL
                   REFERENCES party_type (party_type),
    secondary_party text NOT NULL CHECK (btrim(secondary_party) <> ''),

    created_by     text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at     timestamptz NOT NULL DEFAULT now(),

    -- One link per pair, and a party appears on ONE side of ONE link: the
    -- three refusal halves of party_link.py's validate(), each as an index.
    UNIQUE (primary_role, primary_party, secondary_party)
);

CREATE UNIQUE INDEX ux_party_link_secondary
    ON party_link (secondary_party)
    WHERE secondary_role IN ('SUPPLIER', 'CUSTOMER');

CREATE UNIQUE INDEX ux_party_link_primary
    ON party_link (primary_party)
    WHERE primary_role IN ('SUPPLIER', 'CUSTOMER');

COMMENT ON TABLE party_link IS
    'A customer that is also a supplier, and the other way — ERPNext''s Party Link. Netting and a shared balance read through this row; the registers stay separate (0212). One link per party, enforced here, not by app code.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF (SELECT count(*) FROM pg_indexes
         WHERE tablename = 'party_link'
           AND indexname IN ('ux_party_link_secondary', 'ux_party_link_primary')) <> 2 THEN
        RAISE EXCEPTION 'party_link ownership indexes are missing';
    END IF;
END $$;
