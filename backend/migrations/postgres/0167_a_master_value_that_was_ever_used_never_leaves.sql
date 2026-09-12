-- 0167: A master value that was ever used never leaves.
--
-- Divisions, sizes, tags and colours are the four lists an article is described
-- with. Until now the only way out of any of them was `active = false`, and the
-- screen said so — "there is no delete" — which is right for the value that has
-- been used and wrong for the one somebody created by mistake ten seconds ago.
--
-- The owner's rule, set on 2026-09-12, is the one this file makes enforceable:
--
--     Never used + nothing references it  → delete
--     Ever used                           → retire only
--
-- Not "nothing references it TODAY". That is the trap, and it is reachable
-- here: `article_tag` rows are deleted when a merchandiser unticks a tag, and
-- `article_colour` rows go when a colourway is re-cut. A tag that clothed
-- eighty articles in 2025 and none today has a live reference count of zero and
-- a history that every report, every audit line and every printed label still
-- reads. Deleting it would leave those saying a word the catalogue no longer
-- has.
--
-- # Why a column and not a query
--
-- Because the question is about the past and the database only keeps the
-- present. Nothing in this estate records "this tag was once on that article":
-- `audit_log` stores the method, the path and the status, deliberately not the
-- body, so the removal of a tag from an article is not recoverable from it.
-- Without a mark set at the moment of use, "was this ever used" is unanswerable
-- and the safe answer would have to be "assume yes", which is the same as
-- having no delete at all.
--
-- `ever_used` is that mark. It is set once and never cleared — retiring,
-- restoring and unpicking the last reference all leave it standing.
--
-- **It cannot see further back than this migration.** The backfill below marks
-- what is referenced right now; a value used and then unpicked before today
-- looks never-used and will be deletable. That is the one hole, it closes
-- itself with time, and it is smaller than the alternative of never allowing a
-- typo to be removed.
--
-- # Statement-level triggers, not row-level
--
-- A row-level trigger on `sku` would run per row of a setup session that mints
-- a few thousand of them, each doing an `UPDATE` that matches nothing after the
-- first. The statement-level form runs once per statement over the transition
-- table, and the `AND NOT ever_used` guard means the usual case takes no row
-- lock at all — which matters, because the alternative is every SKU insert of
-- one size queueing behind a lock on that size's master row.

ALTER TABLE division  ADD COLUMN ever_used boolean NOT NULL DEFAULT false;
ALTER TABLE size_code ADD COLUMN ever_used boolean NOT NULL DEFAULT false;
ALTER TABLE tag       ADD COLUMN ever_used boolean NOT NULL DEFAULT false;
ALTER TABLE colour    ADD COLUMN ever_used boolean NOT NULL DEFAULT false;

-- One function for all fifteen triggers. `TG_ARGV[0]` is the master table and
-- `TG_ARGV[1]` the column in the referencing row that names a code; the
-- transition table is reached by the name the trigger declares for it, which is
-- `touched` in every one of them below.
CREATE OR REPLACE FUNCTION master_value_used() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format(
        'UPDATE %I m SET ever_used = true
          WHERE NOT m.ever_used
            AND m.code IN (SELECT DISTINCT %I FROM touched WHERE %I IS NOT NULL)',
        TG_ARGV[0], TG_ARGV[1], TG_ARGV[1]
    );
    RETURN NULL;
END;
$$;

-- The reference map, and the triggers generated from it.
--
-- Fifteen tables can name one of these codes, and the list below is the only
-- written-down statement of which. Two triggers each: a transition table may
-- not be declared for a trigger with more than one event, so INSERT and UPDATE
-- are separate rather than one `AFTER INSERT OR UPDATE`.
--
-- The UPDATE half matters for the tables that hold a code in a column an edit
-- can re-point — an article moved between divisions, a colourway re-cut — and
-- is harmless on the link tables, where the code is half the primary key and
-- nobody updates it in place. It fires on every update of those rows rather
-- than only on the code column: a transition table may not be declared for a
-- trigger with a column list either, and the guard inside the function makes
-- the wasted call a single no-op statement.
DO $$
DECLARE
    reference record;
BEGIN
    FOR reference IN
        SELECT * FROM (VALUES
            -- Tags: five.
            ('article_tag',               'tag',       'tag_code'),
            ('article_setup_session_tag', 'tag',       'tag_code'),
            ('purchase_order_line_tag',   'tag',       'tag_code'),
            ('supplier_item_tag',         'tag',       'tag_code'),
            ('document_tag',              'tag',       'tag_code'),
            -- Divisions: four.
            ('article',                   'division',  'division_code'),
            ('article_setup_session',     'division',  'division_code'),
            ('purchase_order_line',       'division',  'division_code'),
            ('supplier_item',             'division',  'division_code'),
            -- Sizes: three, and one of them is the SKU itself — which is the
            -- whole reason a size code can never be recycled. `12345678003`
            -- says M for as long as anybody can read it.
            ('sku',                       'size_code', 'size_code'),
            ('article_setup_variant',     'size_code', 'size_code'),
            ('supplier_item_size',        'size_code', 'size_code'),
            -- Colours: three.
            ('article_colour',            'colour',    'colour_code'),
            ('article_setup_colour',      'colour',    'colour_code'),
            ('supplier_item_colour',      'colour',    'colour_code')
        ) AS t(referencing_table, master_table, code_column)
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I AFTER INSERT ON %I
               REFERENCING NEW TABLE AS touched
               FOR EACH STATEMENT EXECUTE FUNCTION master_value_used(%L, %L)',
            reference.master_table || '_used_on_insert',
            reference.referencing_table,
            reference.master_table,
            reference.code_column
        );
        EXECUTE format(
            'CREATE TRIGGER %I AFTER UPDATE ON %I
               REFERENCING NEW TABLE AS touched
               FOR EACH STATEMENT EXECUTE FUNCTION master_value_used(%L, %L)',
            reference.master_table || '_used_on_update',
            reference.referencing_table,
            reference.master_table,
            reference.code_column
        );
    END LOOP;
END $$;

-- What is referenced today was used at some point, by definition. Everything
-- older than that is unknowable; see the header.
UPDATE tag SET ever_used = true WHERE code IN (
    SELECT tag_code FROM article_tag
    UNION SELECT tag_code FROM article_setup_session_tag
    UNION SELECT tag_code FROM purchase_order_line_tag
    UNION SELECT tag_code FROM supplier_item_tag
    UNION SELECT tag_code FROM document_tag
);

UPDATE division SET ever_used = true WHERE code IN (
    SELECT division_code FROM article WHERE division_code IS NOT NULL
    UNION SELECT division_code FROM article_setup_session
    UNION SELECT division_code FROM purchase_order_line WHERE division_code IS NOT NULL
    UNION SELECT division_code FROM supplier_item WHERE division_code IS NOT NULL
);

UPDATE size_code SET ever_used = true WHERE code IN (
    SELECT size_code FROM sku WHERE size_code IS NOT NULL
    UNION SELECT size_code FROM article_setup_variant
    UNION SELECT size_code FROM supplier_item_size
);

UPDATE colour SET ever_used = true WHERE code IN (
    SELECT colour_code FROM article_colour WHERE colour_code IS NOT NULL
    UNION SELECT colour_code FROM article_setup_colour WHERE colour_code IS NOT NULL
    UNION SELECT colour_code FROM supplier_item_colour
);
