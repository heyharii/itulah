-- The warehouse is head office, and the shops carry the client's own names.
-- (Reconstructed in a scratch directory for verification only. The file this
-- copies was present in backend/migrations/postgres at the start of the
-- session and has since disappeared from the working tree.)

BEGIN;

DO $$
DECLARE t record;
BEGIN
    FOR t IN
        SELECT tgrelid::regclass::text AS tbl, tgname
          FROM pg_trigger
         WHERE NOT tgisinternal
           AND tgrelid IN (SELECT conrelid FROM pg_constraint
                            WHERE confrelid = 'site'::regclass AND contype = 'f')
    LOOP
        EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', t.tbl, t.tgname);
    END LOOP;
END $$;

ALTER TABLE site DROP CONSTRAINT IF EXISTS site_kind_check;
ALTER TABLE site ADD CONSTRAINT site_kind_check
    CHECK (kind IN ('HO', 'DC', 'STORE'));

INSERT INTO site (id, name, kind, edge_node_id)
SELECT 'ho', 'HO', 'HO', edge_node_id || '-moving' FROM site WHERE id = 'dc'
ON CONFLICT (id) DO NOTHING;

ALTER TABLE operational_pool DROP CONSTRAINT IF EXISTS operational_pool_check;

DO $$
DECLARE bad bigint;
BEGIN
    SELECT count(*) INTO bad
      FROM account_map a JOIN account_map b
        ON a.semantic_key = b.semantic_key AND a.qualifier = b.qualifier
       AND a.site_id = 'dc' AND b.site_id = 'dc-01'
       AND a.account_code <> b.account_code;
    IF bad > 0 THEN
        RAISE EXCEPTION '% meanings are bound to different accounts at dc and dc-01', bad;
    END IF;
END $$;

DELETE FROM account_map b
 WHERE b.site_id = 'dc-01'
   AND EXISTS (SELECT 1 FROM account_map a
                WHERE a.site_id = 'dc'
                  AND a.semantic_key = b.semantic_key
                  AND a.qualifier = b.qualifier);

DO $$
DECLARE col record; moved bigint; total bigint := 0;
BEGIN
    FOR col IN
        SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS colname
          FROM pg_constraint c
          JOIN unnest(c.conkey) k ON true
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
         WHERE c.confrelid = 'site'::regclass AND c.contype = 'f'
         ORDER BY 1, 2
    LOOP
        EXECUTE format('UPDATE %s SET %I = %L WHERE %I IN (%L, %L)',
                       col.tbl, col.colname, 'ho', col.colname, 'dc', 'dc-01');
        GET DIAGNOSTICS moved = ROW_COUNT;
        total := total + moved;
    END LOOP;
END $$;

ALTER TABLE operational_pool ADD CONSTRAINT operational_pool_check
    CHECK (store_origin_site_id IS NULL OR (group_code = 'REJECT' AND site_id = 'ho'));

DO $$
DECLARE edge text;
BEGIN
    SELECT edge_node_id INTO edge FROM site WHERE id = 'dc';
    DELETE FROM site WHERE id IN ('dc', 'dc-01');
    UPDATE site SET edge_node_id = edge WHERE id = 'ho';
END $$;

UPDATE site SET name = 'C' || lpad(substring(id from 'store-(\d+)'), 3, '0')
 WHERE kind = 'STORE';
UPDATE org_place SET name = 'C' || lpad(substring(id from 'store-(\d+)'), 3, '0')
 WHERE kind = 'STORE';
UPDATE org_place SET name = 'HO' WHERE id = 'ho';

DO $$
DECLARE t record;
BEGIN
    FOR t IN
        SELECT tgrelid::regclass::text AS tbl, tgname
          FROM pg_trigger
         WHERE NOT tgisinternal
           AND tgrelid IN (SELECT conrelid FROM pg_constraint
                            WHERE confrelid = 'site'::regclass AND contype = 'f')
    LOOP
        EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I', t.tbl, t.tgname);
    END LOOP;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE n bigint;
BEGIN
    SELECT count(*) INTO n FROM site WHERE id IN ('dc', 'dc-01');
    IF n > 0 THEN RAISE EXCEPTION 'a dc site survived'; END IF;

    SELECT count(*) INTO n FROM site WHERE id = 'ho' AND kind = 'HO' AND name = 'HO';
    IF n <> 1 THEN RAISE EXCEPTION 'site ho is not there as expected'; END IF;

    SELECT count(*) INTO n FROM org_place WHERE id = 'ho' AND site_id = 'ho';
    IF n <> 1 THEN RAISE EXCEPTION 'the bridge from org_place to site broke'; END IF;

    SELECT count(*) INTO n FROM site
     WHERE name = 'HO' OR name ~ '^C0(0[1-9]|1[0-3])$';
    IF n <> 14 THEN RAISE EXCEPTION 'expected fourteen client-named sites, found %', n; END IF;

    SELECT count(*) INTO n FROM journal_line WHERE site_id IN ('dc', 'dc-01');
    IF n > 0 THEN RAISE EXCEPTION '% journal lines still point at dc', n; END IF;
END $$;

COMMIT;
