-- 0375: Finance Connect stages 4-5 — the books follow the goods, and every
-- client leaf has a route (or is marked manual / not used).
--
-- Owner and client-accountant decisions of 25 Sep (FINANCE-CONNECT-BRIEF.md):
--   * No new accounts: 0372's 2049 and 6076 are retired; claims go by kind to
--     6047 / 6048 / 6016-6030, owed on 2020 (medical) or 2031 (other).
--   * 2003 Hutang Supplier Barang Dagang - Suspend is not used.
--   * Inventory: a sale whose layers are short still posts, at the SKU's last
--     known cost, flagged "cost pending" and trued up when the receipt lands;
--     a SKU with two different receipt costs is flagged for Finance review.
--   * Goods between sites follow the SJD rule in both books (1031 BDP, 2029 /
--     1058 Atas Barang).
--   * Shopping bags are customer supplies: sold at Dr 6004 / Cr 1030.

-- ── retire the two minted leaves, remap first ─────────────────────────────
UPDATE account_map mapping
   SET account_code = CASE
           WHEN mapping.qualifier ~* '(MEDIS|MEDIC|KESEHATAN|PENGOBATAN|OBAT|DOKTER)'
               THEN CASE WHEN site.kind = 'STORE' THEN '6016' ELSE '6030' END
           WHEN mapping.qualifier ~* '(DINAS|PERJALANAN|TRAVEL|HOTEL|TIKET)' THEN '6047'
           WHEN mapping.qualifier ~* '(TRANSPORT|BENSIN|BBM|TOL|PARKIR|OJEK)' THEN '6048'
           ELSE '6064'
       END,
       set_by = 'migration:0375', set_at = now(),
       note = 'Owner: no new accounts; claim expense by kind'
  FROM site
 WHERE site.id = mapping.site_id
   AND mapping.semantic_key = 'employee_expense'
   AND mapping.account_code = '6076';

UPDATE account_map
   SET account_code = '2031', set_by = 'migration:0375', set_at = now(),
       note = 'Owner: no new accounts; non-medical claims owed on Hutang Lain-Lain'
 WHERE account_code = '2049';

UPDATE ledger_account
   SET is_active = FALSE, posting_mode = 'BLOCKED', manual_je_policy = 'NO',
       posting_policy_configured = TRUE
 WHERE account_code IN ('2049', '6076', '2003');

-- ── routes for the leaves no writer reached yet ────────────────────────────
WITH unqualified(semantic_key, account_code, note) AS (
    VALUES
        ('expense_store_supplies',        '6052', 'Biaya Perlengkapan Toko dan Kantor'),
        ('expense_electrical_equipment',  '6054', 'Biaya Peralatan Listrik'),
        ('expense_tires',                 '6055', 'Tire & Tubes Expences'),
        ('expense_fuel',                  '6056', 'Fuel & Oil Expences'),
        ('expense_tools',                 '6057', 'Tools (Peralatan) Expences'),
        ('expense_telephone_equipment',   '6059', 'Biaya Telephone Equipment'),
        ('expense_mess_supplies',         '6063', 'Biaya Perlengkapan Mess atau Rumah Dinas'),
        ('expense_decoration',            '6007', 'Biaya Dekorasi'),
        ('expense_loading',               '6009', 'Biaya Bongkar Muat Barang (manual bill line)'),
        ('expense_freight',               '6010', 'Biaya Pengiriman Barang (manual bill line)'),
        ('expense_stock_count',           '6053', 'Biaya Stock Opname (manual bill line)'),
        ('expense_licence',               '6049', 'Biaya Perijinan'),
        ('expense_travel',                '6047', 'Biaya Perjalanan Dinas'),
        ('expense_computer',              '6050', 'Computer Expenses (new software is expensed here)'),
        ('expense_consultant',            '6061', 'Biaya Konsultan'),
        ('expense_donation',              '6060', 'Biaya Donasi (CSR, Zakat)'),
        ('expense_vehicle_licence',       '6062', 'Biaya Lisensi Kendaraan'),
        ('expense_genset_fuel',           '6058', 'Biaya Lubrication & Grease, Bahan Bakar Genset'),
        ('management_fee_income',         '4016', 'Management Fee: head office charging a unit (LAIN-LAIN)'),
        ('management_fee_expense',        '7032', 'Biaya Management Fee: the unit side'),
        ('principal_payable',             '2030', 'Hutang Lain-lain Principal: owner funding'),
        ('pbb_prepaid',                   '1049', 'Prepaid - Land Tax (PBB)'),
        ('other_tax_prepaid',             '1050', 'Prepaid - Other Tax'),
        ('pbb_expense',                   '7030', 'Biaya Pajak Bumi Dan Bangunan'),
        ('billboard_tax_expense',         '7031', 'Biaya Pajak Reklame'),
        ('property_insurance_expense',    '7029', 'Property All Risk & Fire Insurance'),
        ('vehicle_insurance_expense',     '7033', 'Biaya Asuransi Kendaraan'),
        ('rent_land_expense',             '7002', 'Biaya Sewa Tanah'),
        ('land_right_expense',            '7003', 'Biaya Land Right (HGB)'),
        ('rent_store_expense',            '7004', 'Biaya Sewa Bangunan Toko dan Gudang'),
        ('rent_mess_expense',             '7005', 'Biaya Sewa Rumah Dinas / Mess'),
        ('security_deposit',              '1054', 'Uang jaminan sewa -> Advanced - Others (owner)'),
        ('leasing_payable',               '2031', 'Hutang leasing kendaraan -> Hutang Lain-Lain (owner)'),
        ('leasing_interest',              '8012', 'Biaya Bunga Leasing'),
        ('accrued_salary',                '2017', 'Biaya Gaji dan Upah YMHD'),
        ('accrued_medical',               '2020', 'Biaya Pengobatan YMHD'),
        ('accrued_insurance',             '2021', 'Biaya Asuransi dan BPJS YMHD'),
        ('rent_income_building',          '8005', 'Pendapatan Sewa Gedung'),
        ('rent_income_equipment',         '8006', 'Pendapatan Sewa Peralatan'),
        ('bag_in_transit',                '1032', 'BDP Kantong Belanja')
),
by_kind(semantic_key, store_code, ho_code, note) AS (
    VALUES
        ('expense_recreation', '6020', '6034', 'Biaya Sport & Recreation, by recipient site group'),
        ('expense_funeral',    '6021', '6035', 'Funeral Contribution, by recipient site group'),
        ('expense_training',   '6022', '6036', 'Biaya Manpower Development, by participant site group'),
        ('expense_uniform',    '6019', '6033', 'Biaya Uniform / Seragam Kerja, by recipient site group'),
        ('expense_medical',    '6016', '6030', 'Biaya Kesehatan & Pengobatan, by site group'),
        ('severance_expense',  '6023', '6037', 'Biaya Pesangon, by site group')
),
rows AS (
    SELECT u.semantic_key, s.id AS site_id, ''::text AS qualifier, u.account_code, u.note
      FROM unqualified u CROSS JOIN site s
    UNION ALL
    SELECT k.semantic_key, s.id, '',
           CASE WHEN s.kind = 'STORE' THEN k.store_code ELSE k.ho_code END, k.note
      FROM by_kind k CROSS JOIN site s
)
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT semantic_key, site_id, qualifier, account_code, NULL, 'migration:0375', note FROM rows
ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE
    SET account_code = EXCLUDED.account_code, category_code = NULL,
        set_by = EXCLUDED.set_by, set_at = now(), note = EXCLUDED.note;

-- ── inventory: supplies, pending cost, review flags, transfers ─────────────
ALTER TABLE article
    ADD COLUMN is_customer_supply boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN article.is_customer_supply IS
    'Shopping bags and other customer supplies: held on 1030/1032, consumed at the till as Dr 6004 Biaya Customer Supplies / Cr 1030 (owner decision 11, stage 5).';

CREATE TABLE inventory_cost_flag (
    flag_id            uuid PRIMARY KEY,
    article_id         uuid NOT NULL REFERENCES article (id),
    kind               text NOT NULL CHECK (kind IN ('COST_PENDING', 'MULTI_COST')),
    site_id            text REFERENCES site (id),
    quantity           bigint NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit_cost_minor    bigint NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
    provisional_minor  bigint NOT NULL DEFAULT 0 CHECK (provisional_minor >= 0),
    source_id          text,
    journal_entry_id   uuid REFERENCES journal_entry (entry_id),
    status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
    resolved_entry_id  uuid REFERENCES journal_entry (entry_id),
    detail             text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    resolved_at        timestamptz,
    CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);

CREATE INDEX inventory_cost_flag_open ON inventory_cost_flag (article_id) WHERE status = 'OPEN';

COMMENT ON TABLE inventory_cost_flag IS
    'COST_PENDING: a sale posted at the SKU''s last known cost because its layers were short; trued up when the receipt lands. MULTI_COST: one SKU with two different receipt costs, for Finance review (owner decision 1, stage 5).';

CREATE TABLE stock_transfer_posting (
    allotment_line_id  uuid NOT NULL REFERENCES allotment_line (id),
    stage              text NOT NULL CHECK (stage IN ('DISPATCH', 'RECEIPT')),
    quantity           bigint NOT NULL CHECK (quantity > 0),
    value_minor        bigint NOT NULL CHECK (value_minor >= 0),
    journal_entry_id   uuid REFERENCES journal_entry (entry_id),
    posted_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (allotment_line_id, stage, posted_at)
);

COMMENT ON TABLE stock_transfer_posting IS
    'What of an allotment line has been booked at SJD dispatch (HO Dr 1031 / Cr 1029; unit Dr 1031 / Cr 2029) and at receipt (HO Dr 1058 / Cr 1031; unit Dr 1029 / Cr 1031), per the client accountant''s rule of 25 Sep.';

DO $$
DECLARE
    bad bigint;
BEGIN
    SELECT count(*) INTO bad
      FROM account_map mapping JOIN ledger_account account USING (account_code)
     WHERE NOT account.is_active OR account.is_group;
    IF bad <> 0 THEN
        RAISE EXCEPTION '0375 left % account_map rows on inactive or heading accounts', bad;
    END IF;
END;
$$;
