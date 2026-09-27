-- An account can be chosen by the party.
--
-- # What ERPNext does, and what we take from it
--
-- ERPNext binds a party to its control account through a child table --
-- `Party Account` (company, account, advance_account) -- on the Customer or
-- Supplier, and resolves it in `party.py get_party_account`: the party's own
-- row first, then the party GROUP's row, then the Party Type's default on the
-- Company, and it refuses rather than invent. The binding is configuration:
-- no schema change and no code change is needed to re-point a party at
-- another account, which is the whole of what "extensible" means here.
--
-- Ours is the same shape resolved per SITE (the axis `account_map` already
-- speaks), with the group rung left out -- our supplier carries categories
-- (0212), not groups with accounts of their own. If a group rung is ever
-- wanted it is one table beside this one, not a rewrite.
--
-- `party.rs` (this migration's companion in Rust) resolves, in order:
--
--   1. a `party_account` row for (party_type, party_id, site);
--   2. the semantic key the party_type's account_type names -- `trade_payable`
--      for PAYABLE, `receivable` for RECEIVABLE -- through `account_map` for
--      that site;
--   3. nothing. It refuses, naming the key and the site, exactly as
--      finance.md §3 says a resolution refuses: an account that is invented
--      is an error that balances.
--
-- MEMBER and OTHER carry NULL account_type in the registry, so they have no
-- rung 2: they name an account explicitly or they do not resolve.

CREATE TABLE party_account (
    party_type           text NOT NULL REFERENCES party_type (party_type),
    party_id             text NOT NULL CHECK (btrim(party_id) <> ''),
    site_id              text NOT NULL REFERENCES site (id),
    account_code         text NOT NULL,
    -- Where advances for this party land, when they land somewhere of their
    -- own. ERPNext carries the same optional column on the child table.
    advance_account_code text,
    set_by               text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at               timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (party_type, party_id, site_id)
);

-- The account must be a real, postable leaf of the client's own chart, and it
-- must be at the site the binding is for -- the same composite discipline
-- 0272 used on `journal_line.bank_account_id`, so a binding can never point
-- at a leaf that does not exist at this place.
ALTER TABLE party_account
    ADD COLUMN is_group boolean NOT NULL DEFAULT false CHECK (is_group = false);

ALTER TABLE party_account
    ADD CONSTRAINT party_account_names_a_real_leaf
    FOREIGN KEY (account_code, is_group)
    REFERENCES ledger_account (account_code, is_group);

ALTER TABLE party_account
    ADD CONSTRAINT party_account_leaf_is_postable
    CHECK (is_group = false);

CREATE INDEX ix_party_account_party ON party_account (party_type, party_id);

COMMENT ON TABLE party_account IS
    'The control account a specific party resolves to at a specific site -- ERPNext''s Party Account child table, per site instead of per company. Configuration, not code: re-pointing a party touches this table and nothing else. The resolution order lives in party.rs: this table, then the account_type''s semantic key through account_map, then a refusal that names the key.';

COMMENT ON COLUMN party_account.advance_account_code IS
    'Where an advance for this party lands, when it has a leaf of its own -- the same optional column ERPNext carries on Party Account.';
