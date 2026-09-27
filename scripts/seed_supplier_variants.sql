-- Demo variants for a development catalogue. NOT a migration.
--
-- 0092 gave `supplier_item` the two link tables that say what a supplier
-- offers an item in, and every row in a development database starts empty
-- because nothing in the scraped feed carried the information. A sourcing
-- screen with two thousand cards and no swatch on any of them cannot be
-- looked at, so this fills them in.
--
-- It is deliberately a script under `scripts/` rather than a seed inside the
-- migration. What colours a supplier actually offers is a fact about that
-- supplier, and inventing it in a migration would write invented facts into
-- production on the next deploy. This is run by hand, against a database
-- somebody names:
--
--     psql -d inventory_tanstack -f scripts/seed_supplier_variants.sql
--
-- Deterministic: every choice is derived from `hashtext(supplier_item_id)`, so
-- running it twice produces the same catalogue rather than reshuffling it, and
-- `ON CONFLICT DO NOTHING` makes a second run a no-op instead of a duplicate.
--
-- Which sizes an item gets follows its division, because that is the one part
-- of this that would look obviously wrong otherwise: footwear in "M", or a
-- belt offered in six sizes.

BEGIN;

-- Colours: two to five per item, drawn from the master in its own order so a
-- card's swatches read as a range rather than as a scatter.
WITH ranked AS (
    SELECT code, row_number() OVER (ORDER BY display_order, label) - 1 AS n,
           count(*) OVER () AS total
      FROM colour WHERE active
),
picked AS (
    SELECT i.supplier_item_id,
           r.code,
           -- A per-item offset so two items do not get the same run of
           -- colours, and a per-item count of how many they take.
           abs(hashtext(i.supplier_item_id::text)) % (SELECT total FROM ranked LIMIT 1) AS offset_n,
           2 + abs(hashtext(i.supplier_item_id::text || 'n')) % 4 AS wanted,
           r.n,
           r.total
      FROM supplier_item i
      CROSS JOIN ranked r
)
INSERT INTO supplier_item_colour (supplier_item_id, colour_code)
SELECT supplier_item_id, code
  FROM picked
 WHERE (n - offset_n + total) % total < wanted
ON CONFLICT DO NOTHING;

-- Sizes: the run the division actually sells in.
INSERT INTO supplier_item_size (supplier_item_id, size_code)
SELECT i.supplier_item_id, z.code
  FROM supplier_item i
  JOIN size_code z ON z.active
 WHERE CASE
         -- Shoes come in EU sizes and nothing else.
         WHEN i.division_code = 'SANDAL_SEPATU' THEN z.code IN ('11','12','13','14','15')
         -- A belt, a bag or a hat is one size, and saying "S–XXL" of one
         -- would be the kind of wrong that makes a buyer stop trusting the
         -- column.
         WHEN i.division_code = 'AKSESORIS' THEN z.code = '08'
         -- Everything else is a garment: a run starting at XS or S and ending
         -- at L, XL or XXL, chosen per item so the catalogue is not one
         -- identical range repeated two thousand times.
         ELSE z.code BETWEEN
                CASE abs(hashtext(i.supplier_item_id::text || 'lo')) % 2
                     WHEN 0 THEN '01' ELSE '02' END
              AND
                CASE abs(hashtext(i.supplier_item_id::text || 'hi')) % 3
                     WHEN 0 THEN '04' WHEN 1 THEN '05' ELSE '06' END
       END
ON CONFLICT DO NOTHING;

COMMIT;

SELECT (SELECT count(*) FROM supplier_item_colour) AS colour_rows,
       (SELECT count(*) FROM supplier_item_size)   AS size_rows,
       (SELECT count(*) FROM supplier_item)        AS items;
