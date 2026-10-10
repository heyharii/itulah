-- The catalogue job asked "has anything changed?" every minute by reading every
-- SKU with its article and tags, building the whole catalogue in memory and
-- hashing it — 600 000 SKUs, five seconds, to learn that nothing had.
--
-- What the catalogue is made of now says when it changed: any write to `sku`,
-- `article` or `article_tag` bumps one revision number, in the writer's own
-- transaction, so a reader sees the new number exactly when it can see the new
-- rows. The job compares that number with the one its last publication was
-- built from and only builds when they differ. The hash stays as the final
-- word on whether there is anything to send.
CREATE TABLE catalog_revision (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision  bigint  NOT NULL
);
INSERT INTO catalog_revision (singleton, revision) VALUES (true, 1);

CREATE FUNCTION catalog_revision_bump() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE catalog_revision SET revision = revision + 1;
    RETURN NULL;
END
$$;

CREATE TRIGGER sku_changes_the_catalog
    AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON sku
    FOR EACH STATEMENT EXECUTE FUNCTION catalog_revision_bump();
CREATE TRIGGER article_changes_the_catalog
    AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON article
    FOR EACH STATEMENT EXECUTE FUNCTION catalog_revision_bump();
CREATE TRIGGER article_tag_changes_the_catalog
    AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON article_tag
    FOR EACH STATEMENT EXECUTE FUNCTION catalog_revision_bump();

-- The revision each publication was built from. Null for those from before
-- this column, which simply means the next pass builds once.
ALTER TABLE catalog_publication ADD COLUMN source_revision bigint;
