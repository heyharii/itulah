-- An article is dealt in only its own units, as in 7Soft.
--
-- 0653 let a line for an article use any unit the global table reaches: a
-- shirt only ever bought by the piece and the carton could still be ordered
-- as "5 KODI", because KODI converts to pieces. In 7Soft an item is dealt in
-- its "Satuan utama" and the "Satuan Lain" listed on it, and nothing else;
-- ERPNext offers the same rule as a stock setting. The owner chose 7Soft's
-- way (2026-09-28).
--
-- So for an article, a unit is its stock unit or a row of `article_unit`.
-- The global chain still PREFILLS a row's factor when one is added
-- (`update_article`), and still serves goods that are no article yet — a
-- supplier item before Article Setup has no list to be held to.
--
-- Units already used on an order line for an article are written onto its
-- list at the factor they were ordered at, so nothing that worked yesterday
-- is refused today.

CREATE OR REPLACE FUNCTION article_unit_factor(p_article_code text, p_unit text) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN a.id IS NULL THEN unit_pieces_per(p_unit)
        WHEN upper(btrim(p_unit)) = a.stock_unit_code THEN 1::numeric
        ELSE (SELECT au.factor FROM article_unit au
               WHERE au.article_id = a.id AND au.unit_code = upper(btrim(p_unit)))
    END
      FROM (SELECT 1) one
      LEFT JOIN article a ON a.article_code = btrim(p_article_code)
$$;

INSERT INTO article_unit (article_id, unit_code, factor)
SELECT DISTINCT ON (a.id, l.order_unit_code) a.id, l.order_unit_code, l.unit_factor
  FROM purchase_order_line l
  -- A catalogue line names the supplier's code; its article is the one the
  -- supplier item is linked to.
  LEFT JOIN supplier_item si ON si.supplier_item_id = l.supplier_item_id
  JOIN article a ON a.article_code = COALESCE(si.internal_article_code, l.article_code)
 WHERE l.order_unit_code IS NOT NULL
   AND l.unit_factor IS NOT NULL
   AND l.order_unit_code <> a.stock_unit_code
 ORDER BY a.id, l.order_unit_code, l.po_line_id
ON CONFLICT (article_id, unit_code) DO NOTHING;
