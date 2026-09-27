-- 0361: the contract types point at their accounts.
--
-- The register names the DEAL (0360's `contract_type`); this migration names
-- where each kind's money goes, in `account_map`, so that the day a bill is
-- written against a contract the posting rule has somewhere to land. Same
-- shape as 0355: the client's own chart already holds every account — this
-- only connects it to a meaning — and every row says "menunggu review
-- Finance", with the global posting switch still off.
--
-- # Two vocabularies borrowed, two new
--
-- `account_map` is keyed (semantic_key, site_id, qualifier), and the four
-- meanings below split on WHO decides the qualifier:
--
--   * `prepaid_expense` was already qualified by `prepaid_kind` (0287's
--     categories: SEWA_TOKO_BAYAR_DIMUKA, ...). The brief's §9.2 could be read
--     as asking for prepaid rows qualified by CONTRACT TYPE — but
--     `prepaid_schedule_create` looks the account up under the prepaid_kind
--     vocabulary, and two vocabularies in one key is two languages in one
--     index. So the prepaid side is seeded under the qualifier family the
--     reader actually uses, per type: the land lease pays into 1037, the shop
--     lease into 1038, the insurance policy into 1036, and so on.
--   * `accrued_expense` likewise: it is qualified by `accrual_kind` (0287),
--     and the five YMHD liabilities the brief names are five of the families
--     that table already keeps — the shop's rent accrual (2025), the mess's
--     (2026), and the three utilities (2022-2024).
--   * `contract_expense` is NEW: the charge a contract's bill carries when it
--     is not paid in advance, qualified by `contract_type.code`. Thirteen of
--     the seventeen are seeded.
--   * `contract_income` is NEW, the mirror for what the company RENTS OUT,
--     qualified the same way. Two types.
--
-- # Two types deliberately left without an expense account
--
-- `SEWA_KENDARAAN`'s charge has no leaf in the active chart yet — the client's
-- ledger names no "Biaya Sewa Kendaraan" — and inventing an account here is
-- exactly what this estate refuses to do (0243 minted the last account, and
-- that one has a paper trail). `JASA_MAINTENANCE`'s charge is not its own at
-- all: the cost follows the REPAIR OBJECT (6066..6075, seeded beside the
-- vocabulary in 0360), which stage 4 resolves. An empty qualifier means
-- `resolve_account` refuses, in a sentence naming the contract type and the
-- site — and for these two types that refusal is the correct answer until
-- Finance names the account and stage 4 wires the objects, not a gap to patch
-- over with a guess.

WITH contract_accounts(semantic_key, qualifier, account_code) AS (
    VALUES
        -- Paid in advance: the prepaid side, under the prepaid_kind family
        -- the prepaid schedules already read.
        ('prepaid_expense', 'SEWA_TANAH_BAYAR_DIMUKA',          '1037'),
        ('prepaid_expense', 'SEWA_TOKO_BAYAR_DIMUKA',           '1038'),
        ('prepaid_expense', 'SEWA_RUMAH_BAYAR_DIMUKA',          '1039'),
        ('prepaid_expense', 'SEWA_KENDARAAN_BAYAR_DIMUKA',      '1041'),
        ('prepaid_expense', 'KONTRAK_MAINTENANCE_BAYAR_DIMUKA', '1040'),
        ('prepaid_expense', 'ASURANSI_BAYAR_DIMUKA',            '1036'),
        ('prepaid_expense', 'BIAYA_IJIN_USAHA_BAYAR_DIMUKA',    '1043'),
        -- Accrued, not paid: the accrual_kind families for the two rents and
        -- the three utilities a shop and a mess run on.
        ('accrued_expense', 'BIAYA_SEWA_KANTOR_TOKO_YMHD',      '2025'),
        ('accrued_expense', 'BIAYA_SEWA_RUMAH_MESS_YMHD',       '2026'),
        ('accrued_expense', 'BIAYA_PEMAKAIAN_LISTRIK_YMHD',     '2023'),
        ('accrued_expense', 'BIAYA_PEMAKAIAN_AIR_BERSIH_YMHD',  '2024'),
        ('accrued_expense', 'BIAYA_TELEPHONE_FAX_MODEM_YMHD',   '2022'),
        -- The contract's own charge, under its own type. SEWA_KENDARAAN and
        -- JASA_MAINTENANCE are absent on purpose — see the header.
        ('contract_expense', 'SEWA_TANAH',         '7002'),
        ('contract_expense', 'SEWA_TOKO',          '7004'),
        ('contract_expense', 'SEWA_RUMAH',         '7005'),
        ('contract_expense', 'JASA_CLEANING',      '6040'),
        ('contract_expense', 'ASURANSI_PROPERTI',  '7029'),
        ('contract_expense', 'ASURANSI_KENDARAAN', '7033'),
        ('contract_expense', 'IZIN_USAHA',         '6049'),
        ('contract_expense', 'IZIN_KENDARAAN',     '6062'),
        ('contract_expense', 'PAJAK_PBB',          '7030'),
        ('contract_expense', 'PAJAK_REKLAME',      '7031'),
        ('contract_expense', 'LANGGANAN_LISTRIK',  '6045'),
        ('contract_expense', 'LANGGANAN_AIR',      '6046'),
        ('contract_expense', 'LANGGANAN_TELEKOM',  '6044'),
        -- And the income side of the rooms and equipment the company lets out.
        ('contract_income', 'DISEWAKAN_GEDUNG',    '8005'),
        ('contract_income', 'DISEWAKAN_PERALATAN', '8006')
)
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT ca.semantic_key, site.id, ca.qualifier, ca.account_code,
       NULL, 'migration:0361', 'menunggu review Finance'
  FROM contract_accounts ca
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
    -- A mapping seeded at some places and not others is a posting that
    -- refuses in one shop and nowhere else — the half-done seed 0355's block
    -- already argues against. Every (meaning, qualifier) pair must be present
    -- at every site.
    SELECT string_agg(semantic_key || ' (' || qualifier || ')', ', ') INTO partial
      FROM (
        SELECT semantic_key, qualifier
          FROM account_map
         WHERE set_by = 'migration:0361'
         GROUP BY semantic_key, qualifier
        HAVING count(*) <> (SELECT count(*) FROM site)
      ) incomplete;
    IF partial IS NOT NULL THEN
        RAISE EXCEPTION '0361 left mappings short of every site: %', partial;
    END IF;

    -- Twenty-seven pairs, and the two kinds of none: the prepaid and accrual
    -- families this seeds are the ones the brief names, and the contract
    -- expense/income pairs are exactly the thirteen and two (so a typo in the
    -- VALUES list above cannot quietly seed one more or one fewer).
    IF (SELECT count(DISTINCT (semantic_key, qualifier)) FROM account_map
         WHERE set_by = 'migration:0361') <> 27 THEN
        RAISE EXCEPTION '0361 expected twentyseven meaning/qualifier pairs, found %',
            (SELECT count(DISTINCT (semantic_key, qualifier)) FROM account_map
              WHERE set_by = 'migration:0361');
    END IF;

    -- Every contract type named must be one the register keeps — the seed is
    -- qualified BY that table, and a qualifier the register cannot produce is
    -- a row nobody will ever read.
    SELECT string_agg(DISTINCT qualifier, ', ') INTO partial
      FROM account_map
     WHERE set_by = 'migration:0361'
       AND semantic_key IN ('contract_expense', 'contract_income')
       AND qualifier NOT IN (SELECT code FROM contract_type);
    IF partial IS NOT NULL THEN
        RAISE EXCEPTION '0361 qualified mappings by unknown contract types: %', partial;
    END IF;

    -- Nothing seeded may be a heading, retired, or carry a category the
    -- account does not ask for: the run would resolve and then refuse at the
    -- leaf, which is a worse answer than not resolving at all (0295's check).
    SELECT count(*) INTO bad
      FROM account_map m
      JOIN ledger_account a ON a.account_code = m.account_code
     WHERE m.set_by = 'migration:0361'
       AND (a.is_group OR NOT a.is_active OR m.category_code IS NOT NULL
            OR (a.category_family IS NOT NULL) <> (m.category_code IS NOT NULL));
    IF bad <> 0 THEN
        RAISE EXCEPTION '0361 installed % mappings that are not active leaves', bad;
    END IF;

    IF EXISTS (
        SELECT 1 FROM finance_posting_control
         WHERE singleton = true AND automatic_posting_enabled
    ) THEN
        RAISE EXCEPTION '0361 expected automatic posting to remain paused during review';
    END IF;
END;
$$;
