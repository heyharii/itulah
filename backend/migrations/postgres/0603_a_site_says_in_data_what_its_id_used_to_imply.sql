-- 0603: a site says in data what its id used to imply.
--
-- Owner's ruling, 2026-09-27: everything is read from data, and no code may
-- derive meaning from an id. Three things were being read off `site.id`:
--
--   * WHICH site is head office. `"dc"` was written into four Rust files
--     (`poster`, `store_money`, `claims`, `domain::ids`) and into the
--     external-party trigger of 0376. A database whose head office has any
--     other id posted every inter-unit leg to a site that does not exist.
--   * WHAT TIME it is there. Every business day was UTC+7, spelled
--     `make_interval(mins => 420)`, `'Asia/Jakarta'` or `7 * 60` wherever a
--     day was cut. A shop in Makassar (UTC+8) closed its day an hour late.
--   * WHAT TO PRINT. Koli, surat jalan and dispatch numbers carried the node's
--     site id (`KOLI-dc-01-000001`) — an internal id on paper a store signs.
--
-- Internal ids are NOT renamed. `dc` stays `dc`; it simply stops meaning
-- anything, and is never shown to a person.
--
-- # 1. Head office is the one site of kind HO
--
-- The code now finds it through one SQL function, `head_office_site_id()`,
-- which Rust reads through one function of the same name
-- (`cloud::postgres::sites`) and SQL calls inline. "The one" is this
-- index's job: two HO rows would make that lookup a guess, and a guess about
-- whose books carry every affiliate balance is not one a read may make. The
-- index cannot say "at least one"; the lookup refuses an empty answer by name.
--
-- # 2. A site keeps its own clock
--
-- `timezone` is an IANA name, because only a name knows its own offset
-- history; an offset column would be wrong the first time a zone changed.
-- Asia/Jakarta is the default because every existing site is in it. The check
-- admits exactly the names this server's tz database knows, so a typo (or an
-- abbreviation like WIB, which Postgres does not resolve) is refused where it
-- is written rather than discovered as a wrong day at month end.
--
-- # 3. A site has a display code
--
-- `code` is what paper and screens show. `name` stays the display name. The
-- backfill reads each shop's unit (0600 gave every store its client code,
-- C001-C013, the mapping 0381 verified against the client's chart) rather
-- than parsing `store-NN` or keeping a third copy of that list, and gives
-- HO-GUDANG to the warehouse, found by its kind.
-- Nullable, because a site created by a test or before anybody chose a code
-- has none; the printers fall back to the id rather than refuse to print.
--
-- # 4. The external-party trigger asks the site, not the spelling
--
-- 0376 let an external-party account sit only at `'dc'`. It now asks
-- `head_office_site_id()`. Same rule, read from the row.
--
-- # 5. A unit keeps its site's clock
--
-- HR's day — a punch, a roster day, a payroll month — belongs to a unit
-- (0600-0601), and a unit has no clock of its own: it keeps the one of the
-- premises it works from. `unit_business_timezone(unit)` says which: head
-- office's site for the head-office unit, found by its kind, and a store's
-- shop for a store. `org_place` is gone by the time this runs (0601), so
-- nothing here reads it.
--
-- # Written beside another lane's `site.timezone`
--
-- This file was written as 0474 and renumbered to 0603 when the unit/site
-- lane moved to a distant block, so on a fresh database it runs AFTER 0520
-- (the company set-up lane, written in parallel). 0520 also adds
-- `site.timezone`, spelled as Indonesia's abbreviations (WIB, WITA, WIT)
-- under a CHECK of its own, and `site.client_code` (HO, C001…). So:
--
--   * the column is added only when it is absent, and the IANA check only
--     when no other CHECK already governs it — two checks with no value in
--     common would refuse every row;
--   * every reader goes through `site_business_timezone`, which reads an
--     abbreviation as its IANA name (`iana_zone_of`), so a day is cut the same
--     way whichever lane's spelling the column holds.
--
-- Which spelling the column keeps, and whether `site.client_code` (a copy of
-- `unit.code` on each site, 0600) survives beside `site.code` (what paper
-- prints, below), is for whichever lane lands second to reconcile. Until then
-- neither lane's writes are refused by the other's rule.

-- ---------------------------------------------------------------------------
-- 1. Exactly one head office
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX site_one_head_office ON site ((kind)) WHERE kind = 'HO';

COMMENT ON INDEX site_one_head_office IS
    'At most one site of kind HO (0603): head office is found by its kind, never by its id, so two would make the lookup a guess.';

-- The one definition of "head office", for SQL and Rust alike: Rust's
-- `sites::head_office_site_id` selects this, and a query that needs head
-- office inline calls it rather than restating the WHERE. When the books move
-- from site to unit, this body is what changes.
CREATE FUNCTION head_office_site_id() RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT id FROM site WHERE kind = 'HO'
$$;

COMMENT ON FUNCTION head_office_site_id() IS
    'The id of the one site of kind HO, or NULL when there is none (0603). The only definition of head office; never compare a site id to a literal.';

-- ---------------------------------------------------------------------------
-- 2. Timezone
-- ---------------------------------------------------------------------------

-- STABLE and not IMMUTABLE: the answer depends on the server's tz database.
-- A CHECK only runs it when a row is written, which is the moment it matters.
CREATE FUNCTION is_iana_timezone(candidate text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = candidate)
$$;

COMMENT ON FUNCTION is_iana_timezone(text) IS
    'Whether a text is a time zone name this server knows (0603). Abbreviations such as WIB and POSIX offsets such as UTC+7 are not names and are refused.';

-- Absent unless 0520 (the set-up lane) already added it; see the header.
ALTER TABLE site
    ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Jakarta';

-- The IANA check, only when nothing else already rules the column: this
-- file's own check from an earlier run, or 0520's WIB/WITA/WIT one. Adding a
-- second rule with no value in common with the first would refuse every row.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'site'::regclass
                  AND contype = 'c'
                  AND pg_get_constraintdef(oid) LIKE '%timezone%') THEN
        RAISE NOTICE
            '0603: site.timezone already has a CHECK (0520''s abbreviations?); '
            'the IANA check is not added and the zone is read through iana_zone_of';
    ELSE
        ALTER TABLE site
            ADD CONSTRAINT site_timezone_is_iana CHECK (is_iana_timezone(timezone));
    END IF;
END
$$;

COMMENT ON COLUMN site.timezone IS
    'The time zone the site keeps its business day in (0603): an IANA name, or one of WIB/WITA/WIT where 0520''s rule holds the column. Read it through site_business_timezone, never raw. Cloud-wide reads use head office''s.';

-- Indonesia's three zone abbreviations, as the IANA names Postgres resolves;
-- anything else is returned as it is. IMMUTABLE: a fixed table, no lookup.
CREATE FUNCTION iana_zone_of(zone text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE zone
               WHEN 'WIB'  THEN 'Asia/Jakarta'
               WHEN 'WITA' THEN 'Asia/Makassar'
               WHEN 'WIT'  THEN 'Asia/Jayapura'
               ELSE zone
           END
$$;

COMMENT ON FUNCTION iana_zone_of(text) IS
    'WIB, WITA and WIT as Asia/Jakarta, Asia/Makassar and Asia/Jayapura; any other text unchanged (0603). Lets site.timezone hold either lane''s spelling.';

-- The one definition of "whose clock", for SQL: the named site's zone, else
-- head office's (a site id the centre holds no row for, or none at all),
-- else the zone every site kept before this column existed. Rust reads the
-- same function (`sites::business_utc_offset_minutes`).
CREATE FUNCTION site_business_timezone(text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT iana_zone_of(timezone) FROM site WHERE id = $1),
        (SELECT iana_zone_of(timezone) FROM site WHERE id = head_office_site_id()),
        'Asia/Jakarta')
$$;

COMMENT ON FUNCTION site_business_timezone(text) IS
    'The IANA zone a site cuts its day in: its own, else head office''s, else Asia/Jakarta (0603). NULL asks for head office''s.';

-- The one definition of "whose clock" for a unit: head office's site for the
-- head-office unit (by its kind, never an id), else the unit's own site — a
-- store's shop. A unit with no site, or an id no unit has, keeps head
-- office's. A store with several sites keeps the first by id; they are one
-- town's premises. Rust reads it through `sites::unit_utc_offset_minutes`.
CREATE FUNCTION unit_business_timezone(text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT site_business_timezone(
        CASE WHEN (SELECT kind FROM unit WHERE id = $1) = 'HO'
             THEN head_office_site_id()
             ELSE (SELECT s.id FROM site s WHERE s.unit_id = $1 ORDER BY s.id LIMIT 1)
        END)
$$;

COMMENT ON FUNCTION unit_business_timezone(text) IS
    'The IANA zone a unit cuts its day in: its site''s — head office''s site for the HO unit, a store''s shop for a store — else head office''s (0603).';

-- The day an instant falls on where a site is. Replaces every
-- `(x AT TIME ZONE 'UTC') + make_interval(mins => 420)` the code carried.
CREATE FUNCTION site_local_date(timestamptz, text) RETURNS date
LANGUAGE sql STABLE AS $$
    SELECT ($1 AT TIME ZONE site_business_timezone($2))::date
$$;

COMMENT ON FUNCTION site_local_date(timestamptz, text) IS
    'The calendar date of an instant in the named site''s zone (0603); NULL site means head office''s.';

-- ---------------------------------------------------------------------------
-- 3. Display code
-- ---------------------------------------------------------------------------

ALTER TABLE site ADD COLUMN code text;

ALTER TABLE site
    ADD CONSTRAINT site_code_unique UNIQUE (code),
    ADD CONSTRAINT site_code_is_printable
        CHECK (code IS NULL OR code ~ '^[A-Z0-9][A-Z0-9-]{0,31}$');

COMMENT ON COLUMN site.code IS
    'What paper and screens show for the site (0603): HO-GUDANG, C001-TOKO. The id is internal and never printed. Upper-case letters, digits and dashes, so it survives a Code 128 barcode and a document number.';

UPDATE site SET code = 'HO-GUDANG' WHERE kind = 'HO' AND code IS NULL;

-- A shop prints as its store's code (C004-TOKO): the unit is where the code
-- lives (0600), so the site's is derived from it once, here, and not again.
UPDATE site AS s
   SET code = u.code || '-TOKO'
  FROM unit u
 WHERE u.id = s.unit_id
   AND u.kind = 'STORE'
   AND s.kind = 'STORE'
   AND s.code IS NULL;

-- ---------------------------------------------------------------------------
-- 4. The external-party trigger reads the kind
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION journal_line_external_party_is_head_office()
RETURNS trigger AS $$
DECLARE
    party_kind text;
    kind_of_entry text;
BEGIN
    SELECT kind INTO party_kind
      FROM external_party_account
     WHERE account_code = NEW.account_code;

    IF party_kind IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.site_id = head_office_site_id() THEN
        RETURN NEW;
    END IF;

    SELECT source_kind INTO kind_of_entry
      FROM journal_entry WHERE entry_id = NEW.entry_id;

    IF kind_of_entry = 'OPENING' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'account % is an external-party % account; it is head office''s alone and cannot sit at shop %. The shop reaches the same result through an affiliate account (1057/1058/1059 or 2028/2029).',
        NEW.account_code, party_kind, NEW.site_id
        USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- What must now be true
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM site WHERE NOT is_iana_timezone(iana_zone_of(timezone))) THEN
        RAISE EXCEPTION '0603: a site keeps a time zone this server does not know';
    END IF;
    IF (SELECT count(*) FROM site WHERE kind = 'HO') > 1 THEN
        RAISE EXCEPTION '0603: more than one site is head office';
    END IF;
END
$$;
