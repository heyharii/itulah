-- What makes a freshly migrated Cloud database a company that has nothing yet.
--
-- One file, two readers: `scripts/blank-tenant.sh` runs it on a database
-- somebody names, and the sandbox gateway (`cloud::tenancy`) runs it once on
-- the template every new sandbox business is cloned from. What goes and what
-- stays, and why, is written at the top of the script.

BEGIN;

-- Demo stock and the catalogue it was counted against. The cascade reaches
-- only rows that hang off these; the same list `demo-seed.sh` clears.
TRUNCATE movement, movement_group, inventory_subject, inventory_projection,
         observation_sighting, count_entry, count_snapshot, official_count,
         sku, article, commercial_price_rule, commercial_assortment_rule
  CASCADE;

-- The 7Soft crosswalk: the client's own account codes, per store.
DELETE FROM ledger_account_source_code;
DELETE FROM ledger_account_remap;
DELETE FROM legacy_code_span;

-- The client's bank-statement rules, and the proposals made from them.
DELETE FROM bank_rule_proposal;
DELETE FROM bank_rule;

-- The premises: what each shop's tills showed, the pools and their places
-- (the external and system places stay — they are not anybody's site), and
-- the sites themselves.
DELETE FROM payment_method_publication;
DELETE FROM payment_method_site;
DELETE FROM inventory_place WHERE pool_id IS NOT NULL;
DELETE FROM operational_pool;
DELETE FROM site;

-- The client's stores. Head office's unit stays: the wizard gives it a site
-- again, and head office's own account links name it.
DELETE FROM unit WHERE kind <> 'HO';

-- Whose company this was. With these gone the setup reads as unfinished and
-- the wizard stands in front of the hub.
DELETE FROM setup_books;
DELETE FROM company_profile;
DELETE FROM company_letterhead;

COMMIT;
