-- 0367: a place keeps what the register does not.
--
-- `site` is the estate's own table — it has an id, a name, a kind and a syncing
-- edge node — and it answers "which site is this", not "how do I send a
-- technician there". The address, the floor area, the person to phone and the
-- free-text kind of building are what the person sending a courier or a repair
-- crew actually reads, and none of them belongs on the row every allotment,
-- ledger code and sync credential already points at.
--
-- So this is one side table, one row per site, keyed by the site's own id. It
-- is a 1:1 because a place has one address; a second row would be a second
-- answer to the same question, and the foreign key says which row wins.
--
-- # Nothing here creates a site, and there is no second HO
--
-- The list of places is the REGISTER's list (`site`), and this table only
-- decorates it: a site GA has never written a detail for still appears in every
-- list, with its address blank rather than absent. That is the whole reason the
-- reader LEFT JOINs this table instead of inner-joining it — "Locations" is a
-- list of places, not a list of places somebody happened to fill in.
--
-- Company policy (owner's ruling, 2026-09-13, made by 0353) is that the
-- distribution centre IS head office: `dc` is the one `site` row of kind `HO`,
-- and the office and the warehouse are told apart by SUB-LOCATION, not by a
-- second site. This migration therefore seeds no site at all, and the block at
-- the bottom fails loudly if a database is ever left with two HO sites — two
-- head offices is a bug, not a configuration, and every query that asks "the
-- HO site" would silently pick one of them.
--
-- # `kind` is free text on purpose
--
-- "Toko", "Gudang", "Kantor", "Mess" — the kinds of place a business owns are
-- not a list that can be closed without the next opening being filed under
-- "other". The column exists so the hub can say what kind of place it is; the
-- vocabulary is the client's, and a CHECK would freeze it in a migration.

CREATE TABLE ga_location_detail (
    site_id        TEXT PRIMARY KEY REFERENCES site (id),
    -- Alamat lengkap. `site` tidak punya satu; yang menanyakannya adalah orang
    -- yang mengirim barang atau teknisi.
    address        TEXT,
    -- Toko, gudang, kantor, mess. Kata bebas, karena jenis tempat yang
    -- dimiliki sebuah usaha bukan daftar yang bisa ditutup.
    kind           TEXT,
    floor_area_sqm integer CHECK (floor_area_sqm IS NULL OR floor_area_sqm > 0),
    contact_name   TEXT,
    contact_phone  TEXT,
    notes          TEXT,
    created_by     TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     TEXT,
    updated_at     timestamptz,
    version        integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- Verified, not assumed
-- ---------------------------------------------------------------------------
--
-- Two facts that a later migration or a careless seed could break, checked
-- against the live database rather than promised in a comment.
DO $$
DECLARE
    orphan text;
    ho_count integer;
BEGIN
    -- A detail whose site is gone is a row nothing can ever open. The foreign
    -- key refuses it; this proves the key is really there, because dropping it
    -- in some future migration would otherwise go unnoticed until the reader
    -- silently returned a place that does not exist.
    SELECT string_agg(d.site_id, ', ') INTO orphan
      FROM ga_location_detail d
     WHERE NOT EXISTS (SELECT 1 FROM site s WHERE s.id = d.site_id);
    IF orphan IS NOT NULL THEN
        RAISE EXCEPTION '0367 left location details whose site does not exist: %', orphan;
    END IF;

    -- Exactly one head office. 0353 made `dc` the one HO; the office and the
    -- warehouse share it and are told apart by sub-location. A second HO is the
    -- bug this asserts against, not a configuration this permits.
    SELECT count(*) INTO ho_count FROM site WHERE kind = 'HO';
    IF ho_count <> 1 THEN
        RAISE EXCEPTION '0367 expected exactly one HO site, found %', ho_count;
    END IF;
END;
$$;
