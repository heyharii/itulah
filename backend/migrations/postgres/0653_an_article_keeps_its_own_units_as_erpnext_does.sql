-- An article keeps its own units, as ERPNext does.
--
-- 0652 made conversion a global master. The owner then asked (2026-09-28) to
-- follow ERPNext's model whole, which has three layers:
--
-- 1. The unit (ERPNext `UOM`) belongs to a CATEGORY — count, mass, volume,
--    length, area — and says whether a quantity in it MUST BE A WHOLE NUMBER.
--    A global conversion (`UOM Conversion Factor`) only joins two units of
--    one category: kg to gram, never kg to pieces.
--
-- 2. The item (ERPNext `Item`) has a STOCK UNIT, a default PURCHASE unit and
--    a default SALES unit, plus its own list of units with a factor each
--    (`UOM Conversion Detail`): one CARTON of this shirt is 24, of those
--    socks 36; one BOTOL of this soap is 250 ML. The list is prefilled from
--    the global table and may differ from it — the only way a bottle or a
--    carton, whose size is the item's own, can be said at all. It lives on
--    the ARTICLE, never on a supplier's catalogue row: the same goods bought
--    from two suppliers are the same number of pieces a carton.
--
-- 3. Every document line snapshots the unit, the quantity in it and the
--    factor (`purchase_order_line.order_unit_*`, 0399), and keeps the stock
--    quantity beside it.
--
-- Lookup order, ERPNext's `get_conversion_factor`: the article's own row,
-- else the global chain from the unit to the article's stock unit. Goods not
-- yet set up as an article (a purchase line before Article Setup) have only
-- the global chain to the base unit.
--
-- # What stays ours
--
-- The stock ledger counts in whole numbers (`movement.quantity bigint`), and
-- that is not loosened here. So an article's stock unit must be a unit marked
-- whole — PCS, or GRAM, CM, ML for goods kept by weight, length or volume —
-- and a quantity of KG or METER is converted into it on the way in. ERPNext
-- stores stock in floats; we would rather keep grams whole than a kilogram
-- that drifts in the fourth decimal.

-- ---------------------------------------------------------------------------
-- 1. Category and whole-number on the unit
-- ---------------------------------------------------------------------------

ALTER TABLE unit_of_measure
    ADD COLUMN category text NOT NULL DEFAULT 'COUNT'
        CONSTRAINT unit_of_measure_category_known
        CHECK (category IN ('COUNT', 'MASS', 'VOLUME', 'LENGTH', 'AREA')),
    -- ERPNext's `must_be_whole_number`: a quantity in this unit is whole.
    -- PCS yes; LUSIN no (9.5 KODI is 190 pieces and a DC may count that way).
    ADD COLUMN whole_number boolean NOT NULL DEFAULT false;

UPDATE unit_of_measure SET whole_number = true WHERE is_base;

-- A conversion joins two units of one category. Held here as well as by the
-- write path, because a unit's category can change after its conversions
-- exist and the write path for that is a different one.
CREATE FUNCTION unit_conversion_same_category() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT category FROM unit_of_measure WHERE code = NEW.from_unit)
       IS DISTINCT FROM
       (SELECT category FROM unit_of_measure WHERE code = NEW.to_unit) THEN
        RAISE EXCEPTION 'unit_conversion_same_category: % and % are different kinds of unit',
            NEW.from_unit, NEW.to_unit
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER unit_conversion_same_category
    BEFORE INSERT OR UPDATE OF from_unit, to_unit ON unit_conversion
    FOR EACH ROW EXECUTE FUNCTION unit_conversion_same_category();

-- The units ERPNext ships and a clothing company meets: the gross, and the
-- metric trio for goods kept by weight, length or volume (fabric, supplies).
-- The small unit of each is whole, so it can be a stock unit.
INSERT INTO unit_of_measure (code, label, category, whole_number, created_by, updated_by)
SELECT code, label, category, whole_number, 'migration:0653', 'migration:0653'
  FROM (VALUES
        ('GROSS', 'Gross',     'COUNT',  false),
        ('KG',    'Kilogram',  'MASS',   false),
        ('GRAM',  'Gram',      'MASS',   true),
        ('LITER', 'Liter',     'VOLUME', false),
        ('ML',    'Mililiter', 'VOLUME', true),
        ('METER', 'Meter',     'LENGTH', false),
        ('CM',    'Sentimeter','LENGTH', true),
        ('YARD',  'Yard',      'LENGTH', false)
       ) AS seed (code, label, category, whole_number)
 WHERE NOT EXISTS (SELECT 1 FROM unit_of_measure u WHERE u.code = seed.code);

INSERT INTO unit_conversion (conversion_id, from_unit, to_unit, factor, note, created_by, updated_by)
SELECT gen_random_uuid(), from_unit, to_unit, factor, note, 'migration:0653', 'migration:0653'
  FROM (VALUES
        ('GROSS', 'PCS',  144::numeric, '1 gross = 144 pcs'),
        ('KG',    'GRAM', 1000,         '1 kg = 1000 gram'),
        ('LITER', 'ML',   1000,         '1 liter = 1000 ml'),
        ('METER', 'CM',   100,          '1 meter = 100 cm'),
        ('YARD',  'CM',   91.44,        '1 yard = 91,44 cm')
       ) AS seed (from_unit, to_unit, factor, note)
 WHERE EXISTS (SELECT 1 FROM unit_of_measure WHERE code = seed.from_unit)
   AND EXISTS (SELECT 1 FROM unit_of_measure WHERE code = seed.to_unit)
   AND NOT EXISTS (SELECT 1 FROM unit_conversion c
                    WHERE c.from_unit = seed.from_unit AND c.to_unit = seed.to_unit);

INSERT INTO unit_alias (alias, unit_code, created_by)
SELECT alias, unit_code, 'migration:0653'
  FROM (VALUES
        ('grs', 'GROSS'),
        ('kilo', 'KG'), ('kilogram', 'KG'), ('kgs', 'KG'),
        ('g', 'GRAM'), ('gr', 'GRAM'), ('grm', 'GRAM'),
        ('l', 'LITER'), ('lt', 'LITER'), ('ltr', 'LITER'), ('litre', 'LITER'),
        ('mililiter', 'ML'), ('millilitre', 'ML'),
        ('m', 'METER'), ('mtr', 'METER'), ('metre', 'METER'),
        ('sentimeter', 'CM'), ('centimeter', 'CM'),
        ('yd', 'YARD'), ('yds', 'YARD')
       ) AS seed (alias, unit_code)
 WHERE EXISTS (SELECT 1 FROM unit_of_measure u WHERE u.code = seed.unit_code)
   AND NOT EXISTS (SELECT 1 FROM unit_alias a WHERE a.alias = seed.alias);

-- ---------------------------------------------------------------------------
-- The global walk, between any two units
-- ---------------------------------------------------------------------------

-- How many `p_to` one `p_from` is, walking active conversions either way and
-- as far as they chain. NULL when no chain joins them (which a category
-- mismatch guarantees). 0652's `unit_pieces_per` becomes the case p_to = the
-- base unit.
CREATE FUNCTION unit_factor(p_from text, p_to text) RETURNS numeric
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE walk (unit, per, path) AS (
        SELECT code, 1::numeric, ARRAY[code]
          FROM unit_of_measure
         WHERE code = upper(btrim(p_to))
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
    SELECT NULLIF(round(per, 6), 0)
      FROM walk
     WHERE unit = upper(btrim(p_from))
     ORDER BY array_length(path, 1)
     LIMIT 1
$$;

CREATE OR REPLACE FUNCTION unit_pieces_per(p_unit text) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT round(unit_factor(p_unit, code), 4)
      FROM unit_of_measure
     WHERE is_base
$$;

-- ---------------------------------------------------------------------------
-- 2. The article's units
-- ---------------------------------------------------------------------------

ALTER TABLE article
    -- ERPNext `stock_uom`. What every quantity of this article's stock is
    -- counted in. Fixed once stock exists (see `update_article`).
    ADD COLUMN stock_unit_code    text NOT NULL DEFAULT 'PCS'
        REFERENCES unit_of_measure (code),
    -- ERPNext `purchase_uom` / `sales_uom`: what a new order line or a sale
    -- starts in. A default only; the line can still be changed.
    ADD COLUMN purchase_unit_code text REFERENCES unit_of_measure (code),
    ADD COLUMN sales_unit_code    text REFERENCES unit_of_measure (code);

-- ERPNext `UOM Conversion Detail`: one row per unit this article is also
-- dealt in, with how many of its stock unit one of it is.
CREATE TABLE article_unit (
    article_id uuid NOT NULL REFERENCES article (id) ON DELETE CASCADE,
    unit_code  text NOT NULL REFERENCES unit_of_measure (code),
    factor     numeric(12, 4) NOT NULL CHECK (factor > 0),
    PRIMARY KEY (article_id, unit_code)
);

-- How many of the article's stock unit one `p_unit` is: 1 for the stock unit
-- itself, the article's own row, else the global chain. For a code that is
-- no article yet — a purchase line before Article Setup — the global chain
-- to the base unit.
CREATE FUNCTION article_unit_factor(p_article_code text, p_unit text) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN a.id IS NULL THEN unit_pieces_per(p_unit)
        WHEN upper(btrim(p_unit)) = a.stock_unit_code THEN 1::numeric
        ELSE COALESCE(
            (SELECT au.factor FROM article_unit au
              WHERE au.article_id = a.id AND au.unit_code = upper(btrim(p_unit))),
            round(unit_factor(p_unit, a.stock_unit_code), 4)
        )
    END
      FROM (SELECT 1) one
      LEFT JOIN article a ON a.article_code = btrim(p_article_code)
$$;
