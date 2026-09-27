-- A site opened without a unit is given one.
--
-- 0600 made `site.unit_id` NOT NULL: every premises belongs to a unit. Code
-- written beside the unit/site lane still inserts a site without naming its
-- unit — the setup wizard's "open a store" (`postgres/setup.rs`, 0520) and the
-- test fixtures that seed a shop. Until each of them creates the unit first
-- and says which one, this trigger does it for them, so their inserts keep
-- working instead of failing on the NOT NULL.
--
-- # What it does
--
-- Only when `unit_id` is NULL on insert; a caller that names its unit is left
-- alone.
--
-- * A site of kind `HO` belongs to head office's unit, found by its kind.
-- * A site of kind `STORE` belongs to the store unit whose code is the site's
--   client code (0520's `site.client_code`, read through `to_jsonb` so this
--   keeps working once that column is dropped for `unit.code`), or else the
--   number in a `store-NN` id, as 0600 derived it. When no unit has that code
--   yet, one is created — keyed like the site, named like it, kind `STORE`.
-- * A site whose unit cannot be named that way is refused, as 0600 refused
--   one: a made-up client code is worse than an error.
--
-- The site's display code (`site.code`, 0603) is filled the way 0603 filled
-- it — `HO-GUDANG`, `<unit code>-TOKO` — when the insert leaves it empty.
--
-- # When it goes
--
-- When every writer creates the unit first and passes `unit_id`. The setup
-- wizard reconciliation is the last known one.

CREATE FUNCTION site_resolves_its_unit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    wanted_code text;
    found_unit  text;
    found_code  text;
BEGIN
    IF NEW.unit_id IS NOT NULL THEN
        IF NEW.code IS NULL AND NEW.kind = 'STORE' THEN
            SELECT code || '-TOKO' INTO NEW.code FROM unit WHERE id = NEW.unit_id;
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.kind = 'HO' THEN
        SELECT id, code INTO found_unit, found_code FROM unit WHERE kind = 'HO';
        IF found_unit IS NULL THEN
            INSERT INTO unit (id, code, name, kind)
            VALUES ('ho', 'HO', 'Head Office', 'HO')
            RETURNING id, code INTO found_unit, found_code;
        END IF;
        NEW.unit_id := found_unit;
        IF NEW.code IS NULL THEN
            NEW.code := 'HO-GUDANG';
        END IF;
        RETURN NEW;
    END IF;

    wanted_code := NULLIF(btrim(to_jsonb(NEW) ->> 'client_code'), '');
    IF wanted_code IS NULL AND NEW.id ~ '^store-[0-9]+$' THEN
        wanted_code :=
            'C' || lpad(ltrim(substring(NEW.id FROM '^store-([0-9]+)$'), '0'), 3, '0');
    END IF;
    IF wanted_code IS NULL THEN
        RAISE EXCEPTION
            'site % (%) names no unit and carries no client code to find or '
            'make one by: create its unit first and insert the site with unit_id',
            NEW.id, NEW.kind;
    END IF;

    SELECT id, code INTO found_unit, found_code FROM unit WHERE code = wanted_code;
    IF found_unit IS NULL THEN
        INSERT INTO unit (id, code, name, kind)
        VALUES (NEW.id, wanted_code, NEW.name, 'STORE')
        RETURNING id, code INTO found_unit, found_code;
    END IF;
    NEW.unit_id := found_unit;
    IF NEW.code IS NULL THEN
        NEW.code := found_code || '-TOKO';
    END IF;
    RETURN NEW;
END
$$;

COMMENT ON FUNCTION site_resolves_its_unit() IS
    'Fills site.unit_id (and site.code) for an insert that left it empty (0620): head office''s unit by kind, or the store unit with the site''s client code, created when missing. A bridge until every writer creates the unit first.';

CREATE TRIGGER site_resolves_its_unit
    BEFORE INSERT ON site
    FOR EACH ROW EXECUTE FUNCTION site_resolves_its_unit();
