-- Global search, first record kind: the purchase order.
--
-- The palette used to find an order by filtering the page of the order book it
-- had already loaded, so an order three months back was "not found" until
-- somebody scrolled to it. This asks the database instead.
--
-- # Why a view and not an index table
--
-- A `search_entry` table copied out of every record kind would have to be kept
-- in step by triggers and backfilled whenever a kind is added, and the day it
-- drifted nobody could say whether the order or its index row was right. A
-- view per kind reads the record itself, so it cannot disagree with it; the
-- trigram indexes below are what make that fast. The next kind (supplier,
-- article, bill…) adds its own view and one more `UNION ALL` leg.
--
-- # What matches
--
-- The PO number (the thing people type: `PO-20261001-003`, `-003`, `1001-3`),
-- then the supplier's name and code. Order of preference: exact number, number
-- prefix, number contains, then supplier. Dashes and case do not matter.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The number with everything but letters and digits dropped, so `po 1001 003`
-- and `PO-1001-003` are the same search. Immutable so an index can hold it.
CREATE OR REPLACE FUNCTION search_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT lower(regexp_replace(coalesce(value, ''), '[^[:alnum:]]+', '', 'g')) $$;

CREATE INDEX IF NOT EXISTS ix_po_number_search_trgm
    ON purchase_order USING gin (search_key(po_number) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_po_supplier_search_trgm
    ON purchase_order USING gin (
        search_key(coalesce(supplier_name_snapshot, supplier_name,
                             supplier_code_snapshot)) gin_trgm_ops
    );

CREATE OR REPLACE VIEW search_purchase_order AS
SELECT
    'purchase_order'::text                              AS kind,
    o.purchase_order_id::text                           AS record_id,
    o.po_number                                         AS title,
    concat_ws(' · ',
              coalesce(o.supplier_name_snapshot, o.supplier_name),
              initcap(lower(o.order_status)))           AS subtitle,
    search_key(o.po_number)                             AS number_key,
    search_key(coalesce(o.supplier_name_snapshot, o.supplier_name,
                        o.supplier_code_snapshot))      AS supplier_key,
    o.created_at                                        AS happened_at
FROM purchase_order o;

-- global_search(q, max_rows): one ranked list across every kind. `rank` is
-- lower-is-better: 0 exact number, 1 number starts with, 2 number contains,
-- 3 supplier matches. Newest first within a rank.
CREATE OR REPLACE FUNCTION global_search(q text, max_rows integer DEFAULT 20)
RETURNS TABLE (
    kind text, record_id text, title text, subtitle text,
    rank integer, happened_at timestamptz
)
LANGUAGE sql STABLE AS
$$
    WITH needle AS (SELECT search_key(q) AS k)
    SELECT s.kind, s.record_id, s.title, s.subtitle,
           CASE
               WHEN s.number_key = n.k                 THEN 0
               WHEN s.number_key LIKE n.k || '%'       THEN 1
               WHEN s.number_key LIKE '%' || n.k || '%' THEN 2
               ELSE 3
           END AS rank,
           s.happened_at
    FROM search_purchase_order s, needle n
    -- Two characters is the least that is a question rather than a keystroke.
    WHERE length(n.k) >= 2
      AND (s.number_key LIKE '%' || n.k || '%'
           OR s.supplier_key LIKE '%' || n.k || '%')
    ORDER BY rank, s.happened_at DESC
    LIMIT least(greatest(max_rows, 1), 50)
$$;
