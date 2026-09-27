-- A store is opened from a template, and so is the head office.
--
-- 0520 opened a store by copying the first one. That needs a first one: a
-- company with no store yet — the one the setup wizard exists for — could
-- not open any, and a company with no head office could not describe itself.
-- The owner's rule (27 Sep) is that opening a store is data, never a
-- migration; this is the data.
--
-- # What a template row is
--
-- A whole `operational_pool` or `inventory_place` row as JSON, with the
-- store's id, the store's name and the head office's id replaced by tokens:
--
--   {{store}}       store-14
--   {{store_name}}  Tegal
--   {{ho}}          dc
--
-- `postgres/setup.rs` puts the new values back and inserts the rows with
-- `jsonb_populate_record`. The rows are taken from the database as it is —
-- the first store and the head office — so the template is exactly the shape
-- the stores already have, not a second description of it that could drift.
--
-- # When a column is added
--
-- `jsonb_populate_record` fills a key the JSON lacks with NULL, not with the
-- column's default. So a migration that adds a NOT NULL column to either
-- table must also add it to these rows —
--
--   UPDATE site_template_row SET row_json = row_json || '{"new_col": …}'
--    WHERE table_name = 'operational_pool';
--
-- — and `tests/setup_integration.rs` holds a new store against the first one,
-- so forgetting fails there, not in a shop.
--
-- # Why the head office stays `dc`
--
-- `operational_pool` still checks `site_id = 'dc'` on a store's return pool
-- (0001). Ids are internal and never shown; a head office made from the
-- template is `dc` until that check reads the site's kind instead.

CREATE TABLE site_template_row (
    template   text NOT NULL CHECK (template IN ('STORE', 'HEAD_OFFICE')),
    table_name text NOT NULL CHECK (table_name IN ('operational_pool', 'inventory_place')),
    position   integer NOT NULL CHECK (position > 0),
    row_json   jsonb NOT NULL CHECK (jsonb_typeof(row_json) = 'object'),
    PRIMARY KEY (template, table_name, position)
);

COMMENT ON TABLE site_template_row IS
    'The rows a new store or head office is made of, with {{store}}, {{store_name}} and {{ho}} tokens (0521).';

-- The ids and the name, as tokens. A site id only as a whole segment of a
-- dotted id (so store-01 never matches inside store-010); a name only as a
-- whole JSON string or after the " / " the outbound leaves are labelled with.
CREATE FUNCTION pg_temp.tokenised(
    row_json jsonb, store_id text, store_name text, ho_id text
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT (
        regexp_replace(
            regexp_replace(
                replace(
                    replace(row_json::text,
                        to_json(store_name)::text, '"{{store_name}}"'),
                    ' / ' || trim(both '"' FROM to_json(store_name)::text) || '"',
                    ' / {{store_name}}"'),
                '(["./:])' || store_id || '(["./:])', '\1{{store}}\2', 'g'),
            '(["./:])' || ho_id || '(["./:])', '\1{{ho}}\2', 'g')
    )::jsonb
$$;

-- The store template: everything that belongs to the first store or names it.
WITH first_store AS (
    SELECT id, name FROM site WHERE kind = 'STORE' ORDER BY created_at, id LIMIT 1
), head_office AS (
    SELECT id FROM site WHERE kind = 'HO' ORDER BY created_at, id LIMIT 1
), pools AS (
    SELECT p.* FROM operational_pool p, first_store s
     WHERE p.site_id = s.id OR p.destination_store_id = s.id OR p.store_origin_site_id = s.id
)
INSERT INTO site_template_row (template, table_name, position, row_json)
SELECT 'STORE', 'operational_pool', row_number() OVER (ORDER BY p.id),
       pg_temp.tokenised(to_jsonb(p), s.id, s.name, h.id)
  FROM pools p, first_store s, head_office h;

WITH first_store AS (
    SELECT id, name FROM site WHERE kind = 'STORE' ORDER BY created_at, id LIMIT 1
), head_office AS (
    SELECT id FROM site WHERE kind = 'HO' ORDER BY created_at, id LIMIT 1
)
INSERT INTO site_template_row (template, table_name, position, row_json)
SELECT 'STORE', 'inventory_place', row_number() OVER (ORDER BY place.id),
       pg_temp.tokenised(to_jsonb(place), s.id, s.name, h.id)
  FROM inventory_place place
  JOIN operational_pool p ON p.id = place.pool_id
 CROSS JOIN first_store s
 CROSS JOIN head_office h
 WHERE p.site_id = s.id OR p.destination_store_id = s.id OR p.store_origin_site_id = s.id;

-- The head-office template: its own pools, not the ones that name a store.
WITH head_office AS (
    SELECT id, name FROM site WHERE kind = 'HO' ORDER BY created_at, id LIMIT 1
)
INSERT INTO site_template_row (template, table_name, position, row_json)
SELECT 'HEAD_OFFICE', 'operational_pool', row_number() OVER (ORDER BY p.id),
       pg_temp.tokenised(to_jsonb(p), 'no-store', 'no-store', h.id)
  FROM operational_pool p, head_office h
 WHERE p.site_id = h.id
   AND p.destination_store_id IS NULL
   AND p.store_origin_site_id IS NULL;

WITH head_office AS (
    SELECT id FROM site WHERE kind = 'HO' ORDER BY created_at, id LIMIT 1
)
INSERT INTO site_template_row (template, table_name, position, row_json)
SELECT 'HEAD_OFFICE', 'inventory_place', row_number() OVER (ORDER BY place.id),
       pg_temp.tokenised(to_jsonb(place), 'no-store', 'no-store', h.id)
  FROM inventory_place place
  JOIN operational_pool p ON p.id = place.pool_id
 CROSS JOIN head_office h
 WHERE p.site_id = h.id
   AND p.destination_store_id IS NULL
   AND p.store_origin_site_id IS NULL;
