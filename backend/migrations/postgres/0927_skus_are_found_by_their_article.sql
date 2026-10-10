-- Every article row the master list draws counts its SKUs, their price range
-- and their sizes with `WHERE s.article_id = a.id`. The only index that starts
-- with article_id is partial (`WHERE colour_digit IS NOT NULL`), which that
-- predicate does not imply, so each row of a page scanned the whole `sku`
-- table: 200 rows × 600 000 SKUs was 6.5 s for one page of Articles.
CREATE INDEX IF NOT EXISTS ix_sku_article ON sku (article_id);

-- The master's default order (newest first) as an index, so the first page is
-- read off it instead of sorting every article.
CREATE INDEX IF NOT EXISTS ix_article_created ON article (created_at DESC, article_code DESC);
