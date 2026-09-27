-- A store's code is its unit's, and the site keeps no copy of it.
--
-- Two lanes wrote the client's code down in the same days. The set-up lane's
-- 0520 put it on the site — `site.client_code`, C001… for the shops and HO for
-- head office's site — because a site was all there was. The unit/site lane's
-- 0600 put it where the owner's model says it lives: on the unit
-- (`unit.code`), which owns the books and the people and is what the client's
-- code names; 0603 then gave every site a printed code of its own
-- (`C004-TOKO`, `HO-GUDANG`), and left the two copies of the client's code to
-- whichever lane landed second. This is that reconciliation. `unit.code` is
-- the one place a client code lives: the setup wizard writes it there and
-- reads it from there (`postgres/setup.rs`), and the site's copy goes.
--
-- # Checked before anything is dropped
--
-- Wherever a site carries a copy, it must be its unit's code: head office's
-- site said HO and the head-office unit is HO; a shop said C004 and belongs to
-- the store unit C004. A copy that says anything else is one store numbered
-- two ways — say a shop an earlier wizard opened as `store-14` with the code
-- C015, whose unit 0600 derived from the id as C014 — and which number is the
-- store's is the owner's to say, not a migration's. So this stops, naming
-- every such site with both codes, and keeps neither by guessing.
--
-- # What goes with it
--
-- The column's own rules: its UNIQUE constraint and the CHECK on its shape
-- (0520), found by what they govern rather than by the names Postgres gave
-- them. `unit.code` has both already — `ix_unit_code` and its CHECK (0600).
--
-- 0620's trigger, which gives a site inserted without a unit the store unit
-- of its client code, read the column through `to_jsonb` so that it would
-- keep working once the column went: it now finds no copy and falls back to
-- the id, as 0600 did, or refuses the insert by name.

DO $$
DECLARE
    disagreeing text;
BEGIN
    SELECT string_agg(
               format('%s says %s but its unit %s is %s', s.id, s.client_code, u.id, u.code),
               '; ' ORDER BY s.id)
      INTO disagreeing
      FROM site s
      JOIN unit u ON u.id = s.unit_id
     WHERE s.client_code IS NOT NULL
       AND s.client_code <> u.code;

    IF disagreeing IS NOT NULL THEN
        RAISE EXCEPTION
            '0621: a site''s client code is not its unit''s code: %. Decide which '
            'code each of these stores has — correct unit.code or site.client_code — '
            'before running this.', disagreeing;
    END IF;
END
$$;

DO $$
DECLARE
    rule record;
BEGIN
    FOR rule IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'site'::regclass
           AND contype IN ('u', 'c')
           AND pg_get_constraintdef(oid) LIKE '%client_code%'
    LOOP
        EXECUTE format('ALTER TABLE site DROP CONSTRAINT %I', rule.conname);
    END LOOP;
END
$$;

ALTER TABLE site DROP COLUMN client_code;

COMMENT ON COLUMN unit.code IS
    'The client''s code for the unit: HO, C001… (0600). The one place a client code lives since 0621 dropped site.client_code; a shop prints as its unit''s code with -TOKO (site.code, 0603).';
