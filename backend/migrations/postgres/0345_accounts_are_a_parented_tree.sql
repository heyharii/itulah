-- 0345: Accounts have a real parent-child tree, independent of their number.
--
-- The account number remains a stable, human-readable key. `parent_code` is
-- the hierarchy; `lft`/`rgt` make reading a subtree cheap, as in ERPNext.
-- Existing accounts keep their numbers and history. Future charts can use
-- four-digit posting accounts without encoding the whole tree in the digits.

DO $$
DECLARE
    constraint_name text;
BEGIN
    -- The original chart required each child number to begin with its parent's
    -- number. Drop that check while retaining the no-self-parent check.
    SELECT conname INTO constraint_name
      FROM pg_constraint
     WHERE conrelid = 'ledger_account'::regclass
       AND contype = 'c'
       AND position('parent_code' IN pg_get_constraintdef(oid)) > 0
       AND position('account_code' IN pg_get_constraintdef(oid)) > 0
       AND position('||' IN pg_get_constraintdef(oid)) > 0
     LIMIT 1;
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE ledger_account DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE ledger_account
    ALTER COLUMN depth DROP EXPRESSION,
    ALTER COLUMN depth SET DEFAULT 1,
    ADD COLUMN lft integer,
    ADD COLUMN rgt integer;

COMMENT ON COLUMN ledger_account.account_code IS
    'Stable account number. It identifies the account; parent_code defines its place in the chart tree.';
COMMENT ON COLUMN ledger_account.parent_code IS
    'The direct parent group in the chart of accounts. Account numbers need not encode this relationship.';
COMMENT ON COLUMN ledger_account.lft IS
    'Nested-set left bound for the account tree, rebuilt from parent_code.';
COMMENT ON COLUMN ledger_account.rgt IS
    'Nested-set right bound for the account tree, rebuilt from parent_code.';
COMMENT ON COLUMN ledger_account.depth IS
    'Tree depth with root groups at depth 1; rebuilt from parent_code.';

CREATE OR REPLACE FUNCTION rebuild_ledger_account_tree()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    account_count bigint;
    reachable_count bigint;
BEGIN
    SELECT count(*) INTO account_count FROM ledger_account;

    WITH RECURSIVE ranked AS (
        SELECT account_code,parent_code,
               row_number() OVER (PARTITION BY parent_code ORDER BY account_code)::integer sibling_order
          FROM ledger_account
    ), tree(account_code, visited, path, tree_depth) AS (
        SELECT a.account_code, ARRAY[a.account_code]::text[],
               ARRAY[a.sibling_order]::integer[], 1::smallint
          FROM ranked a
         WHERE a.parent_code IS NULL
        UNION ALL
        SELECT child.account_code, tree.visited || child.account_code,
               tree.path || child.sibling_order,
               (tree.tree_depth + 1)::smallint
          FROM ranked child
          JOIN tree ON child.parent_code = tree.account_code
         WHERE NOT child.account_code = ANY(tree.visited)
    )
    SELECT count(*) INTO reachable_count FROM tree;

    IF reachable_count <> account_count THEN
        RAISE EXCEPTION
            'Cannot rebuild ledger account tree: only % of % accounts are reachable (the rest are orphaned or cyclic)',
            reachable_count, account_count;
    END IF;

    WITH RECURSIVE ranked AS (
        SELECT account_code,parent_code,
               row_number() OVER (PARTITION BY parent_code ORDER BY account_code)::integer sibling_order
          FROM ledger_account
    ), tree(account_code, visited, path, tree_depth) AS (
        SELECT a.account_code, ARRAY[a.account_code]::text[],
               ARRAY[a.sibling_order]::integer[], 1::smallint
          FROM ranked a
         WHERE a.parent_code IS NULL
        UNION ALL
        SELECT child.account_code, tree.visited || child.account_code,
               tree.path || child.sibling_order,
               (tree.tree_depth + 1)::smallint
          FROM ranked child
          JOIN tree ON child.parent_code = tree.account_code
         WHERE NOT child.account_code = ANY(tree.visited)
    ), events AS (
        -- Put an opening event before every child and a closing event after
        -- every child. Reusing each leaf's preorder number for both bounds
        -- gave every parent the same rgt as its rightmost descendant.
        SELECT account_code,tree_depth,path || ARRAY[0]::integer[] event_path,'L'::text side
          FROM tree
        UNION ALL
        SELECT account_code,tree_depth,path || ARRAY[2147483647]::integer[] event_path,'R'::text side
          FROM tree
    ), positions AS (
        SELECT account_code,tree_depth,side,
               row_number() OVER (ORDER BY event_path)::integer AS position
          FROM events
    ), bounds AS (
        SELECT account_code,MAX(tree_depth)::smallint tree_depth,
               MAX(position) FILTER (WHERE side='L')::integer AS left_bound,
               MAX(position) FILTER (WHERE side='R')::integer AS right_bound
          FROM positions
         GROUP BY account_code
    )
    UPDATE ledger_account account
       SET lft = bounds.left_bound,
           rgt = bounds.right_bound,
           depth = bounds.tree_depth
      FROM bounds
     WHERE bounds.account_code = account.account_code;
END;
$$;

CREATE OR REPLACE FUNCTION ledger_account_tree_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM rebuild_ledger_account_tree();
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION ledger_account_parent_is_a_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_is_group boolean;
    parent_root char(1);
BEGIN
    IF NEW.parent_code IS NOT NULL THEN
        SELECT is_group, root_class
          INTO parent_is_group, parent_root
          FROM ledger_account
         WHERE account_code = NEW.parent_code;

        IF parent_is_group IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Parent account % must be a group account', NEW.parent_code;
        END IF;
        IF parent_root IS DISTINCT FROM left(NEW.account_code, 1)::char(1) THEN
            RAISE EXCEPTION 'Account % must stay under the same root class as parent %',
                NEW.account_code, NEW.parent_code;
        END IF;
    END IF;

    IF NOT NEW.is_group AND EXISTS (
        SELECT 1 FROM ledger_account child WHERE child.parent_code = NEW.account_code
    ) THEN
        RAISE EXCEPTION 'Account % has children and cannot be changed to a posting account',
            NEW.account_code;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_account_parent_is_a_group
    BEFORE INSERT OR UPDATE OF account_code, parent_code, is_group
    ON ledger_account
    FOR EACH ROW EXECUTE FUNCTION ledger_account_parent_is_a_group();

SELECT rebuild_ledger_account_tree();

ALTER TABLE ledger_account
    ADD CONSTRAINT ledger_account_nested_set_order CHECK (
        (lft IS NULL AND rgt IS NULL) OR (lft IS NOT NULL AND rgt IS NOT NULL AND lft < rgt)
    ),
    ADD CONSTRAINT ledger_account_lft_unique UNIQUE (lft)
        DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT ledger_account_rgt_unique UNIQUE (rgt)
        DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER ledger_account_rebuild_tree
    AFTER INSERT OR DELETE OR UPDATE OF account_code, parent_code
    ON ledger_account
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_account_tree_changed();

CREATE OR REPLACE FUNCTION ledger_account_tree_bounds_are_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    has_bounds boolean;
BEGIN
    SELECT lft IS NOT NULL AND rgt IS NOT NULL
      INTO has_bounds
      FROM ledger_account
     WHERE account_code = NEW.account_code;

    IF FOUND AND NOT has_bounds THEN
        RAISE EXCEPTION 'Account % has no rebuilt tree bounds', NEW.account_code;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_account_tree_bounds_ready
    AFTER INSERT OR UPDATE
    ON ledger_account
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION ledger_account_tree_bounds_are_ready();
