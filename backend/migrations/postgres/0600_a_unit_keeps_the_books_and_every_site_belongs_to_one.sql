-- A unit keeps the books, and every site belongs to exactly one.
--
-- Owner's decisions of 2026-09-27 (`unit-site-architecture.html`, and the
-- glossary's "The organisation" in `CONTEXT.md`): the company is organised in
-- **units** — head office and each store, fourteen today and a number that is
-- data rather than code — and a unit is what owns books, people, store money
-- and an access scope. A **site** is something else: a physical premises, an
-- office, the Gudang or a shop, where goods and machines are. Until now the
-- two were blurred across `site` (the syncing premises) and `org_place` (where
-- people are posted), and head office answered to two ids, `dc` as a site and
-- `ho` as a place. This migration introduces the unit; 0601 moves the people
-- onto it and drops `org_place`; 0602 gives each unit its person in charge.
--
-- # Why the ids are reused
--
-- `unit.id` is internal and never shown — the client's code (`C004`) and the
-- name (`Bumiayu`) are what people read. So the id is chosen for one reason
-- only: that nothing already written has to be translated. Every HR row in the
-- database names its place as `ho` or `store-NN` (0060 gave each store place
-- its site's id; 0230 folded the warehouse's postings into `ho`), so a unit
-- keyed `ho` and `store-01`…`store-13` makes 0601 a change of foreign key and
-- not a rewrite of history. A new unit later takes whatever id the hub mints;
-- nothing may parse meaning out of it (the architecture's "id hanya label").
--
-- # The client's codes and names
--
-- The codes follow the client chart's ordinal rule (`docs/coa-final.md` §2.4):
-- the owner of an account is the two-digit suffix, `00` = head office, `01` =
-- C001 … `13` = C013, which is the store number. So store-0N is C00N.
-- The names are the client's own, as its chart spells the units in the BDP
-- rows 0348 carried (`BDP Barang Dagangan CIKUPA - …`), in title case. A store
-- site this migration does not know by name keeps its site's name rather than
-- being invented one; the hub can rename it.
--
-- # What this does not do
--
-- `site.kind` is left as it is (`HO` / `STORE`); the premises vocabulary
-- (`OFFICE`, `WAREHOUSE`, `SHOP`), `site.code` and `site.timezone` are another
-- lane's. No site id is renamed: `dc` stays `dc`, and is simply a site of the
-- head-office unit. The books (`journal_line.site_id`) move to units in a
-- later step, not here.

CREATE TABLE unit (
    -- Internal and stable. Never shown to anybody; see above.
    id         text PRIMARY KEY CHECK (btrim(id) <> ''),
    -- The client's code: `HO`, `C001` … `C013`. What a person types and reads.
    code       text NOT NULL CHECK (code ~ '^[A-Z0-9]+$'),
    name       text NOT NULL CHECK (btrim(name) <> ''),
    -- What kind of organisation this is, not what kind of building: that is
    -- `site.kind`. `ONLINE` is admitted now so that opening the online unit is
    -- a row somebody inserts, not a migration somebody writes.
    kind       text NOT NULL CHECK (kind IN ('HO', 'STORE', 'ONLINE')),
    -- A store that closes keeps its unit: its books, its payroll history and
    -- its leavers still name it. `DRAFT` (a store being set up from the hub)
    -- arrives with the flow that needs it.
    status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Two units cannot answer to one client code: the code is how the client's
-- chart and every report name a unit.
CREATE UNIQUE INDEX ix_unit_code ON unit (code);

-- Exactly one head office. Found by its kind, never by a hard-coded id — which
-- is only safe while "the unit of kind HO" names one row, so the database
-- says so rather than every reader hoping so.
CREATE UNIQUE INDEX ix_unit_one_head_office ON unit (kind) WHERE kind = 'HO';

-- A site this migration cannot place is refused rather than guessed at. Every
-- premises must belong to a unit (the column below is NOT NULL), and a store
-- whose id does not carry its number would get a client code somebody made up.
DO $$
DECLARE
    unplaceable text;
BEGIN
    SELECT string_agg(id || ' (' || kind || ')', ', ' ORDER BY id)
      INTO unplaceable
      FROM site
     WHERE NOT (kind = 'HO' OR (kind = 'STORE' AND id ~ '^store-[0-9]+$'));

    IF unplaceable IS NOT NULL THEN
        RAISE EXCEPTION
            'these sites belong to no unit this migration can name: %. Create '
            'their units by hand, or correct the sites, before running it.',
            unplaceable;
    END IF;
END $$;

INSERT INTO unit (id, code, name, kind)
VALUES ('ho', 'HO', 'Head Office', 'HO');

-- One unit per store site, keyed like the site.
INSERT INTO unit (id, code, name, kind)
SELECT s.id,
       'C' || lpad(ltrim(substring(s.id FROM '^store-([0-9]+)$'), '0'), 3, '0'),
       COALESCE(client.name, s.name),
       'STORE'
  FROM site s
  LEFT JOIN (VALUES
        ('store-01', 'Cikupa'),
        ('store-02', 'Muaro Bungo'),
        ('store-03', 'Purbalingga'),
        ('store-04', 'Bumiayu'),
        ('store-05', 'Jambi'),
        ('store-06', 'Wiramode'),
        ('store-07', 'Brebes'),
        ('store-08', 'Pasuruan'),
        ('store-09', 'WMJB'),
        ('store-10', 'WMBA'),
        ('store-11', 'Sipin'),
        ('store-12', 'Banjaran'),
        ('store-13', 'Wonosobo')
  ) AS client (site_id, name) ON client.site_id = s.id
 WHERE s.kind = 'STORE';

-- Every site belongs to exactly one unit. The warehouse site `dc` is head
-- office's Gudang, not a unit of its own (0230); a shop is its store's.
ALTER TABLE site ADD COLUMN unit_id text REFERENCES unit (id);

UPDATE site
   SET unit_id = CASE WHEN kind = 'HO' THEN 'ho' ELSE id END;

ALTER TABLE site ALTER COLUMN unit_id SET NOT NULL;

CREATE INDEX ix_site_unit ON site (unit_id);

COMMENT ON TABLE unit IS
    'The organisational and accounting unit: head office and each store. Owns '
    'books, people, store money and an access scope (reach). The id is internal; '
    'people read `code` (HO, C001…) and `name`. Exactly one of kind HO.';
COMMENT ON COLUMN site.unit_id IS
    'The unit that owns this premises. Goods move between sites; their value is '
    'booked to the unit that owns the site, and a move across units is inter-unit.';
