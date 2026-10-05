-- A unit is worth the same for every item.
--
-- 0399 let an item carry its own pack sizes (`supplier_item_unit`) that beat
-- the global table: a carton of one item 24, of another 36. The owner has
-- since ruled (2026-09-28) that conversion is a master and nothing else — one
-- LUSIN is twelve pieces of anything, the way 7Soft's "Konversi Item" reads.
-- So the per-item table goes, and `unit_pieces_per` stops taking an item.
--
-- Orders already placed are untouched: every line snapshotted the factor it
-- was raised with (`purchase_order_line.unit_factor`), and that is what
-- receiving, stock and money read.
--
-- Two things arrive with it.
--
-- * The walk is chained. With KOLI = 10 LUSIN and LUSIN = 12 PCS, one KOLI is
--   120 pieces without anybody typing KOLI = 120 PCS as well. A conversion
--   may be read either way (PCS -> LUSIN 0.0833 works as well as LUSIN ->
--   PCS 12), and the shortest path to the base wins.
--
-- * Aliases. A supplier's sheet says "lsn", "dz", "ptg", "buah"; the master
--   says LUSIN and PCS. `unit_alias` is the list of spellings that mean a
--   unit, so an imported line can be matched to the master rather than kept
--   as loose text. A unit's own code always matches and is not listed.

DROP FUNCTION unit_pieces_per(uuid, text);
DROP TABLE supplier_item_unit;

-- Pieces in one of a unit, walking active conversions from the base unit
-- outwards. NULL when no chain reaches it. Rounded to the four places a
-- line's `unit_factor` snapshot holds.
CREATE FUNCTION unit_pieces_per(p_unit text) RETURNS numeric
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE walk (unit, per, path) AS (
        SELECT code, 1::numeric, ARRAY[code]
          FROM unit_of_measure
         WHERE is_base
        UNION ALL
        SELECT CASE WHEN c.to_unit = walk.unit THEN c.from_unit ELSE c.to_unit END,
               CASE WHEN c.to_unit = walk.unit THEN walk.per * c.factor
                    ELSE walk.per / c.factor END,
               walk.path || CASE WHEN c.to_unit = walk.unit THEN c.from_unit ELSE c.to_unit END
          FROM walk
          JOIN unit_conversion c
            ON c.active AND walk.unit IN (c.from_unit, c.to_unit)
         WHERE CASE WHEN c.to_unit = walk.unit THEN c.from_unit ELSE c.to_unit END
               <> ALL (walk.path)
    )
    SELECT NULLIF(round(per, 4), 0)
      FROM walk
     WHERE unit = upper(btrim(p_unit))
     ORDER BY array_length(path, 1)
     LIMIT 1
$$;

CREATE TABLE unit_alias (
    -- Lower case, trimmed, single-spaced: how a spelling is looked up.
    alias      text PRIMARY KEY
                   CHECK (alias = lower(alias) AND alias = btrim(alias) AND alias <> ''),
    unit_code  text NOT NULL REFERENCES unit_of_measure (code),
    created_by text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX unit_alias_unit ON unit_alias (unit_code);

-- The spellings the owner's suppliers print, for the three 0394 seeded.
INSERT INTO unit_alias (alias, unit_code, created_by)
SELECT alias, unit_code, 'migration:0652'
  FROM (VALUES
        ('pc', 'PCS'), ('pce', 'PCS'), ('piece', 'PCS'), ('pieces', 'PCS'),
        ('potong', 'PCS'), ('ptg', 'PCS'), ('buah', 'PCS'), ('bh', 'PCS'),
        ('biji', 'PCS'), ('unit', 'PCS'), ('ea', 'PCS'),
        ('lsn', 'LUSIN'), ('ls', 'LUSIN'), ('dz', 'LUSIN'), ('dzn', 'LUSIN'),
        ('doz', 'LUSIN'), ('dozen', 'LUSIN'),
        ('kd', 'KODI'), ('kds', 'KODI')
       ) AS seed (alias, unit_code)
 WHERE EXISTS (SELECT 1 FROM unit_of_measure u WHERE u.code = seed.unit_code);
