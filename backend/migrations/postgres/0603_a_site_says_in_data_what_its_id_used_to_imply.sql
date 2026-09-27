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
-- backfill uses the client's own branch codes (C001-C013, the same mapping
-- 0381 verified against the client's chart), written out rather than parsed
-- out of `store-NN`, and HO-GUDANG for the warehouse, found by its kind.
-- Nullable, because a site created by a test or before anybody chose a code
-- has none; the printers fall back to the id rather than refuse to print.
--
-- # 4. The external-party trigger asks the site, not the spelling
--
-- 0376 let an external-party account sit only at `'dc'`. It now asks
-- `head_office_site_id()`. Same rule, read from the row.

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

ALTER TABLE site
    ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Jakarta'
        CONSTRAINT site_timezone_is_iana CHECK (is_iana_timezone(timezone));

COMMENT ON COLUMN site.timezone IS
    'IANA time zone the site keeps its business day in (0603). Every "which day was this" at the site reads it; cloud-wide reads use head office''s.';

-- The one definition of "whose clock", for SQL: the named site's zone, else
-- head office's (a site id the centre holds no row for, or none at all),
-- else the zone every site kept before this column existed. Rust reads the
-- same function (`sites::business_utc_offset_minutes`).
CREATE FUNCTION site_business_timezone(text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT timezone FROM site WHERE id = $1),
        (SELECT timezone FROM site WHERE id = head_office_site_id()),
        'Asia/Jakarta')
$$;

COMMENT ON FUNCTION site_business_timezone(text) IS
    'The IANA zone a site cuts its day in: its own, else head office''s, else Asia/Jakarta (0603). NULL asks for head office''s.';

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

UPDATE site AS s
   SET code = v.code
  FROM (VALUES
    ('store-01', 'C001-TOKO'),
    ('store-02', 'C002-TOKO'),
    ('store-03', 'C003-TOKO'),
    ('store-04', 'C004-TOKO'),
    ('store-05', 'C005-TOKO'),
    ('store-06', 'C006-TOKO'),
    ('store-07', 'C007-TOKO'),
    ('store-08', 'C008-TOKO'),
    ('store-09', 'C009-TOKO'),
    ('store-10', 'C010-TOKO'),
    ('store-11', 'C011-TOKO'),
    ('store-12', 'C012-TOKO'),
    ('store-13', 'C013-TOKO')
  ) AS v (site_id, code)
 WHERE s.id = v.site_id
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
    IF EXISTS (SELECT 1 FROM site WHERE NOT is_iana_timezone(timezone)) THEN
        RAISE EXCEPTION '0603: a site keeps a time zone this server does not know';
    END IF;
    IF (SELECT count(*) FROM site WHERE kind = 'HO') > 1 THEN
        RAISE EXCEPTION '0603: more than one site is head office';
    END IF;
END
$$;
