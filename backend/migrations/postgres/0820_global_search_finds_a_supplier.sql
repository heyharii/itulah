-- Global search, second record kind: the supplier.
--
-- Same shape as 0718: a view that reads the record itself (so it cannot
-- disagree with it), trigram indexes to make that fast, and one more
-- `UNION ALL` leg in `global_search`. The purchase-order leg is unchanged
-- except for the numbers its ranks are written with (see below).
--
-- # What matches
--
-- A supplier by its code (`SUP-0012`, `sup12`) or its name, with the legal
-- form counted as part of the name so "sejahtera cv" finds "Sejahtera, CV".
-- Dashes, spaces and case do not matter (`search_key`).
--
-- # Rank (lower is better, newest first within a rank)
--
--   0  exact number / exact supplier code
--   1  number starts with / supplier code starts with
--   2  supplier name starts with
--   3  supplier name (or code) contains
--   4  PO number contains
--   5  a purchase order's supplier matches
--
-- A supplier whose name matches therefore comes out before the orders that
-- merely mention that supplier, while a typed PO number still wins as before.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_supplier_code_search_trgm
    ON supplier USING gin (search_key(supplier_code) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_supplier_name_search_trgm
    ON supplier USING gin (search_key(name || coalesce(legal_form, '')) gin_trgm_ops);

CREATE OR REPLACE VIEW search_supplier AS
SELECT
    'supplier'::text                                    AS kind,
    s.supplier_id::text                                 AS record_id,
    -- "Name, CV": the same way the supplier screen writes it.
    CASE WHEN nullif(btrim(s.legal_form), '') IS NULL
         THEN s.name
         ELSE s.name || ', ' || btrim(s.legal_form) END AS title,
    concat_ws(' · ',
              s.supplier_code,
              CASE s.status WHEN 'ACTIVE' THEN 'Active'
                            ELSE 'Non-active' END)      AS subtitle,
    search_key(s.supplier_code)                         AS number_key,
    search_key(s.name || coalesce(s.legal_form, ''))    AS name_key,
    s.created_at                                        AS happened_at
FROM supplier s;

CREATE OR REPLACE FUNCTION global_search(q text, max_rows integer DEFAULT 20)
RETURNS TABLE (
    kind text, record_id text, title text, subtitle text,
    rank integer, happened_at timestamptz
)
LANGUAGE sql STABLE AS
$$
    WITH needle AS (SELECT search_key(q) AS k),
    hits AS (
        SELECT s.kind, s.record_id, s.title, s.subtitle,
               CASE
                   WHEN s.number_key = n.k                  THEN 0
                   WHEN s.number_key LIKE n.k || '%'        THEN 1
                   WHEN s.number_key LIKE '%' || n.k || '%' THEN 4
                   ELSE 5
               END AS rank,
               s.happened_at
        FROM search_purchase_order s, needle n
        -- Two characters is the least that is a question rather than a keystroke.
        WHERE length(n.k) >= 2
          AND (s.number_key LIKE '%' || n.k || '%'
               OR s.supplier_key LIKE '%' || n.k || '%')
        UNION ALL
        SELECT s.kind, s.record_id, s.title, s.subtitle,
               CASE
                   WHEN s.number_key = n.k                  THEN 0
                   WHEN s.number_key LIKE n.k || '%'        THEN 1
                   WHEN s.name_key LIKE n.k || '%'          THEN 2
                   ELSE 3
               END AS rank,
               s.happened_at
        FROM search_supplier s, needle n
        WHERE length(n.k) >= 2
          AND (s.number_key LIKE '%' || n.k || '%'
               OR s.name_key LIKE '%' || n.k || '%')
    )
    SELECT h.kind, h.record_id, h.title, h.subtitle, h.rank, h.happened_at
    FROM hits h
    ORDER BY h.rank, h.happened_at DESC
    LIMIT least(greatest(max_rows, 1), 50)
$$;
