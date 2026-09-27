-- A company is set up from the hub: its name, its stores, and how its books
-- start — the three questions the hub's setup wizard asks
-- (`frontend-hub/src/screens/setup`, `http/setup.rs`).
--
-- # What this adds
--
-- * `company_profile` — the one company, as the owner described it: name,
--   legal form, head-office address, whether there is a central warehouse, and
--   the NPWP when it is known. The letterhead (0118) is kept in step with it by
--   the write, not replaced: every slip already prints from the letterhead.
-- * `setup_books` — the answer to "how do the books start": the chart it
--   started from and the first month opened.
-- * `site.client_code`, `site.city`, `site.timezone` — what a store is called
--   on paper (C001), where it is, and which clock it keeps. The code is data,
--   not read out of the id: ids are internal and the code is what people see.
--
-- # The company that already exists
--
-- The client's database was set up by migrations, not by the wizard, and must
-- not be sent through it. So both rows are written here from what is already
-- true — the letterhead for the company, the chart for the books — and the
-- setup reads as finished. The legal form is left empty rather than guessed:
-- the letterhead does not say it, and a wrong "PT" on every PO is worse than
-- none.
--
-- # What this does not do yet
--
-- A database migrated from nothing still gets the demo stores (0002) and the
-- client's chart (0348), because both are migrations. Until they leave the
-- migrations for the unit/site refactor, a "new" company is never empty and
-- the wizard's company and books steps describe what is there rather than
-- create it. Opening stores does create them: from the first store's shape,
-- see `postgres/setup.rs`.

CREATE TABLE company_profile (
    only_row      boolean PRIMARY KEY DEFAULT true CHECK (only_row),
    name          text NOT NULL CHECK (btrim(name) <> ''),
    -- NULL only on the row carried over below, where nobody has said it yet.
    legal_form    text CHECK (legal_form IN ('PT', 'CV', 'UD', 'PERORANGAN')),
    address       text NOT NULL CHECK (btrim(address) <> ''),
    has_warehouse boolean NOT NULL,
    -- PMK 112/2022: sixteen digits, no punctuation.
    tax_id        text CHECK (tax_id ~ '^[0-9]{16}$'),
    set_by        text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_profile IS
    'The one company, as its owner described it in setup (0520). The letterhead is written alongside it.';

CREATE TABLE setup_books (
    only_row         boolean PRIMARY KEY DEFAULT true CHECK (only_row),
    chart            text NOT NULL CHECK (chart IN ('STANDARD', 'IMPORTED')),
    -- The old software's chart as uploaded, for Finance to review the matching.
    imported_file_id uuid REFERENCES stored_file (file_id),
    first_period     text NOT NULL CHECK (first_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    started_by       text NOT NULL CHECK (btrim(started_by) <> ''),
    started_at       timestamptz NOT NULL DEFAULT now(),
    CHECK ((chart = 'IMPORTED') OR imported_file_id IS NULL)
);

COMMENT ON TABLE setup_books IS
    'How the books started (0520): the chart they started from and the first open month.';

ALTER TABLE site
    ADD COLUMN client_code text UNIQUE CHECK (client_code ~ '^[A-Z0-9][A-Z0-9-]*$'),
    ADD COLUMN city        text NOT NULL DEFAULT '',
    ADD COLUMN timezone    text NOT NULL DEFAULT 'WIB'
        CHECK (timezone IN ('WIB', 'WITA', 'WIT'));

-- The client's stores are C001… in the order of their ids (the crosswalk in
-- 0381: route 002 is store-01 is Cikupa is C001).
UPDATE site
   SET client_code = 'C' || lpad(substring(id FROM '^store-([0-9]+)$'), 3, '0')
 WHERE kind = 'STORE' AND id ~ '^store-[0-9]+$';

UPDATE site
   SET client_code = 'HO'
 WHERE id = (SELECT id FROM site WHERE kind = 'HO' ORDER BY created_at, id LIMIT 1);

-- The company that is already here.
INSERT INTO company_profile (name, legal_form, address, has_warehouse, set_by)
SELECT l.name,
       NULL,
       CASE WHEN btrim(l.address) = '' THEN '-' ELSE l.address END,
       EXISTS (
           SELECT 1 FROM operational_pool p JOIN site s ON s.id = p.site_id
            WHERE s.kind = 'HO' AND p.group_code = 'WAREHOUSE'
       ),
       'migration:0520'
  FROM company_letterhead l
 WHERE EXISTS (SELECT 1 FROM site WHERE kind = 'STORE');

INSERT INTO setup_books (chart, first_period, started_by)
SELECT 'IMPORTED',
       COALESCE(
           (SELECT format('%s-%s', year, lpad(month::text, 2, '0'))
              FROM fiscal_period ORDER BY year, month LIMIT 1),
           to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')
       ),
       'migration:0520'
 WHERE EXISTS (SELECT 1 FROM ledger_account)
   AND EXISTS (SELECT 1 FROM company_profile);
