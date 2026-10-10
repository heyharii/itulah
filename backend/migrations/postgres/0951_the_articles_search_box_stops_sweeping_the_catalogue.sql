-- The Articles screen searches one box against six identifiers at once:
-- the article's code and name, the SKU's code and QR payload, and the
-- supplier's own item code. Each is a contains-match, ILIKE '%q%', and a
-- contains-match is the one shape a b-tree cannot answer, so every
-- keystroke swept the catalogue to answer it: the page query and the
-- facet recount each walked all 192 000 SKUs and every supplier item,
-- testing two ILIKEs a row, twice over. A search that found nothing
-- took over a second on the load estate, and the search that finds
-- nothing is the common one — it is typed on the way to the search that
-- finds something.
--
-- pg_trgm is already how this server finds a document by its filename
-- (0075), a purchase order by its number (0725) and a supplier by its
-- code (0820): a GIN index over a column's trigrams answers a
-- contains-match from the index. The five columns q is tried against get
-- one each. A needle of three characters or more — every code, name
-- fragment and payload this box exists for — is a lookup; a needle too
-- short to hold a trigram keeps the sweep it has today, because the
-- planner prices the index above it and declines. Nothing in the
-- statements changes, so the matches, the counts and the order are what
-- they were; only the walk to them is cheaper.
--
-- The estate pays for the lookup where it always paid for reads: article
-- names are editable and SKUs are minted by setup sessions, and both now
-- maintain a trigram index beside the row.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_article_code_trgm
    ON article USING gin (article_code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_article_name_trgm
    ON article USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_sku_code_trgm
    ON sku USING gin (sku_code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_sku_qr_trgm
    ON sku USING gin (qr_payload gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_supplier_item_code_trgm
    ON supplier_item USING gin (supplier_item_code gin_trgm_ops);
