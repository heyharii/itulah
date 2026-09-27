-- 0366: the repair objects point at their accounts.
--
-- 0365 records a repair and asks GA only for what kind of thing broke: the
-- object — AC, kendaraan, bangunan. This migration connects that object to the
-- account a bill for it is charged to, in `account_map`, so that when Finance
-- eventually writes the bill the posting rule has somewhere to land. Same shape
-- as 0355 (asset classes) and 0361 (contract types): the client's own chart
-- already holds every account, and this only connects it to a meaning. Every
-- row says "menunggu review Finance".
--
-- # No new account is created
--
-- The eleven accounts (6058, 6066..6075) are the client's own expense leaves,
-- already active in the chart and already named beside the objects in 0360's
-- `ga_repair_object`. This migration only writes the `account_map` rows: one
-- meaning (`repair_expense`), one qualifier per object code, at every site.
-- The `account_code` copied from `ga_repair_object` is the SAME number the
-- object already carries — the DO block below refuses if the two ever drift.
--
-- # Why the qualifier is the object code and not the account
--
-- `resolve_account('repair_expense', site, <object code>)` is the call a future
-- bill line makes: the line names the object it is for, and the map turns that
-- word into the account at that site. A qualifier of the account itself would
-- make the map a no-op and a second place the account could change.
--
-- # The global posting switch is not asserted here
--
-- 0364 turned automatic posting back on by owner decision, so this seed says
-- nothing about it; its job is only to make the mapping complete.

WITH repair_accounts(code, account_code) AS (
    VALUES
        ('FFE',         '6066'),
        ('SOFTWARE',    '6067'),
        ('KOMPUTER',    '6068'),
        ('BANGUNAN',    '6069'),
        ('STAFF_HOUSE', '6070'),
        ('KENDARAAN',   '6071'),
        ('AC',          '6072'),
        ('POWER_PLANT', '6073'),
        ('GENSET_BBM',  '6058'),
        ('CAT',         '6074'),
        ('LIFT',        '6075')
)
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT 'repair_expense', site.id, ra.code, ra.account_code,
       NULL, 'migration:0366', 'menunggu review Finance'
  FROM repair_accounts ra
  CROSS JOIN site
ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE
    SET account_code = EXCLUDED.account_code,
        category_code = NULL,
        set_by = EXCLUDED.set_by,
        set_at = now(),
        note = EXCLUDED.note;

DO $$
DECLARE
    partial text;
    bad integer;
    drifted text;
BEGIN
    -- A mapping seeded at some places and not others is a bill that resolves in
    -- one shop and refuses in the next — the half-done seed 0355's block argues
    -- against. Every (meaning, object) pair must be present at every site.
    SELECT string_agg(semantic_key || ' (' || qualifier || ')', ', ') INTO partial
      FROM (
        SELECT semantic_key, qualifier
          FROM account_map
         WHERE set_by = 'migration:0366'
         GROUP BY semantic_key, qualifier
        HAVING count(*) <> (SELECT count(*) FROM site)
      ) incomplete;
    IF partial IS NOT NULL THEN
        RAISE EXCEPTION '0366 left mappings short of every site: %', partial;
    END IF;

    -- Eleven objects, exactly: a typo in the VALUES list above cannot quietly
    -- seed one more or one fewer.
    IF (SELECT count(DISTINCT qualifier) FROM account_map
         WHERE set_by = 'migration:0366' AND semantic_key = 'repair_expense') <> 11 THEN
        RAISE EXCEPTION '0366 expected eleven repair-expense objects, found %',
            (SELECT count(DISTINCT qualifier) FROM account_map
              WHERE set_by = 'migration:0366' AND semantic_key = 'repair_expense');
    END IF;

    -- Every qualifier is one of the objects 0360 seeded, and carries the SAME
    -- account that object already names: the two lists are one list.
    SELECT string_agg(m.qualifier || '->' || m.account_code, ', ' ORDER BY m.qualifier)
      INTO drifted
      FROM account_map m
      LEFT JOIN ga_repair_object ro
        ON ro.code = m.qualifier AND ro.account_code = m.account_code
     WHERE m.set_by = 'migration:0366'
       AND ro.code IS NULL;
    IF drifted IS NOT NULL THEN
        RAISE EXCEPTION '0366 mapped objects that are unknown or point elsewhere: %', drifted;
    END IF;

    -- Nothing seeded may be a heading, retired, or carry a category the
    -- account does not ask for: the resolution would then refuse at the leaf,
    -- which is a worse answer than not resolving at all (0295's check).
    SELECT count(*) INTO bad
      FROM account_map m
      JOIN ledger_account a ON a.account_code = m.account_code
     WHERE m.set_by = 'migration:0366'
       AND (a.is_group OR NOT a.is_active OR m.category_code IS NOT NULL
            OR (a.category_family IS NOT NULL) <> (m.category_code IS NOT NULL));
    IF bad <> 0 THEN
        RAISE EXCEPTION '0366 installed % mappings that are not active leaves', bad;
    END IF;
END;
$$;
