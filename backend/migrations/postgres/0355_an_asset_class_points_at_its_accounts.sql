-- 0355: an asset class points at its accounts.
--
-- GA's register names WHAT a thing is — the air conditioner, the rack, the
-- shopfront — and Finance's posting rules answer where its cost, its
-- accumulated depreciation and its monthly charge sit. The join between the
-- two questions is `account_map`, keyed by the class: `asset_class.class_code`
-- is the qualifier, the same string the depreciation run passes and the same
-- one `resolve_account` matches exactly.
--
-- The client's own chart already says which is which — 1061..1079 name the
-- asset families, 1082..1099 the accumulated ones, 7003 and 7007..7023 the
-- charges — so nothing here invents an account. What the chart does not do is
-- connect a class to its three accounts, and without that connection the
-- monthly run refuses every asset: 0287's import wrote classes the map had no
-- rows for, and "the map points depreciation_expense (AIR_CONDITIONER) at
-- nothing at dc" is the refusal every asset owner would have read.
--
-- # The one exception, and why this is not three parallel blocks of SQL
--
-- Operating equipment is not depreciated; it is replaced. `reserves.rs` sums
-- the argument: 36 classes, a reserve account (1100) and a replacement charge
-- (7024) instead of the accumulated/depreciation pair, resolved through the
-- `replacement_reserve` / `replacement_expense` meanings. Mapping OE classes
-- to `accumulated_depreciation` would credit a reserve through a meaning that
-- says it is something else.
--
-- # Deliberately left out
--
-- `intangible_asset` and `work_in_progress` are not seeded: they answer where
-- a capitalisation and a CIP completion debit, and those are Finance's calls
-- to review first. `asset_disposal_*` stay empty — the client has no
-- gain-or-loss leaf in the active chart yet. Every row says "menunggu review
-- Finance", and the global posting switch stays off.

WITH class_accounts(class_code, asset_account, accum_account, expense_account) AS (
    VALUES
        -- Land is not depreciated; the client's own chart says so in its
        -- names (no Akum, no Biaya Depresiasi for 1061).
        ('TANAH_HAK_MILIK',           '1061', NULL::text, NULL::text),
        ('HAK_SEWA_TANAH_HGB',        '1062', '1082', '7003'),
        -- The seventeen plant classes, in the same order as 0287 seeded them
        -- and as 1063..1079, 1083..1099 and 7007..7023 run.
        ('BANGUNAN_UTAMA',            '1063', '1083', '7007'),
        ('BANGUNAN_TAMBAHAN',         '1064', '1084', '7008'),
        ('BANGUNAN_STAFF_HOUSE_MESS', '1065', '1085', '7009'),
        ('INSTALASI_MEKANIKAL_ELEKTRIKAL', '1066', '1086', '7010'),
        ('AIR_CONDITIONER',           '1067', '1087', '7011'),
        ('LIFT',                      '1068', '1088', '7012'),
        ('ESKALATOR',                 '1069', '1089', '7013'),
        ('GENSET',                    '1070', '1090', '7014'),
        ('MOBIL',                     '1071', '1091', '7015'),
        ('SEPEDA_MOTOR',              '1072', '1092', '7016'),
        ('FFE_OFFICE',                '1073', '1093', '7017'),
        ('FFE_TOKO_DAN_GUDANG',       '1074', '1094', '7018'),
        ('FFE_KOMPUTER',              '1075', '1095', '7019'),
        ('FFE_MUSIC',                 '1076', '1096', '7020'),
        ('FFE_STAFF_HOUSE_MESS',      '1077', '1097', '7021'),
        ('FFE_INTERIOR',              '1078', '1098', '7022'),
        ('FFE_EXTERIOR',              '1079', '1099', '7023'),
        -- Intangibles and deferred cost amortise rather than depreciate, so
        -- they take the amortisation meanings and not the depreciation ones.
        ('SEVENTH_SOFT_APPLICATION',  '1104', '1106', '7025'),
        ('OPTI_TEX_SYSTEM',           '1105', '1107', '7027'),
        ('PRE_OPENING',               '1111', '1112', '7026'),
        -- Work in progress is a resting place, not a kind of money: 0242
        -- re-files it into the class it became, so it carries cost only.
        ('CONTRACT_IN_PROGRESS',      '1113', NULL,   NULL)
),
pairs(semantic_key, class_code, account_code) AS (
    SELECT 'fixed_asset', class_code, asset_account
      FROM class_accounts WHERE asset_account IS NOT NULL
    UNION ALL
    SELECT 'accumulated_depreciation', class_code, accum_account
      FROM class_accounts WHERE accum_account IS NOT NULL
    UNION ALL
    SELECT 'depreciation_expense', class_code, expense_account
      FROM class_accounts WHERE expense_account IS NOT NULL
    -- Every operating-equipment class shares the one reserve pair, exactly
    -- as the client's chart shares 1080, 1100 and 7024 across all 36.
    UNION ALL
    SELECT 'fixed_asset', class_code, '1080'
      FROM asset_class WHERE kind = 'OE'
    UNION ALL
    SELECT 'replacement_reserve', class_code, '1100'
      FROM asset_class WHERE kind = 'OE'
    UNION ALL
    SELECT 'replacement_expense', class_code, '7024'
      FROM asset_class WHERE kind = 'OE'
)
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT pairs.semantic_key, site.id, pairs.class_code, pairs.account_code,
       NULL, 'migration:0355', 'menunggu review Finance'
  FROM pairs
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
BEGIN
    -- A class mapped at some places and not others is a run that refuses in
    -- one shop and nowhere else — the bug this seed exists to close, half
    -- done. Every (meaning, class) pair must be present at every site.
    SELECT string_agg(qualifier || ' (' || semantic_key || ')', ', ') INTO partial
      FROM (
        SELECT m.semantic_key, m.qualifier
          FROM account_map m
         WHERE m.set_by = 'migration:0355'
         GROUP BY m.semantic_key, m.qualifier
        HAVING count(*) <> (SELECT count(*) FROM site)
      ) incomplete;
    IF partial IS NOT NULL THEN
        RAISE EXCEPTION '0355 left mappings short of every site: %', partial;
    END IF;

    -- Every class the register keeps costs somewhere, or the run refuses on
    -- the first asset filed under it.
    SELECT string_agg(class_code, ', ') INTO partial
      FROM asset_class c
     WHERE NOT EXISTS (
        SELECT 1 FROM account_map m
         WHERE m.set_by = 'migration:0355'
           AND m.semantic_key = 'fixed_asset'
           AND m.qualifier = c.class_code
     );
    IF partial IS NOT NULL THEN
        RAISE EXCEPTION '0355 left classes without a fixed_asset mapping: %', partial;
    END IF;

    -- Nothing seeded may be a heading, retired, or carry a category the
    -- account does not ask for: the run would resolve and then refuse at the
    -- leaf, which is a worse answer than not resolving at all (0295's check).
    SELECT count(*) INTO bad
      FROM account_map m
      JOIN ledger_account a ON a.account_code = m.account_code
     WHERE m.set_by = 'migration:0355'
       AND (a.is_group OR NOT a.is_active OR m.category_code IS NOT NULL
            OR (a.category_family IS NOT NULL) <> (m.category_code IS NOT NULL));
    IF bad <> 0 THEN
        RAISE EXCEPTION '0355 installed % mappings that are not active leaves', bad;
    END IF;

    IF EXISTS (
        SELECT 1 FROM finance_posting_control
         WHERE singleton = true AND automatic_posting_enabled
    ) THEN
        RAISE EXCEPTION '0355 expected automatic posting to remain paused during review';
    END IF;
END;
$$;
