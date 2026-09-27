-- The five flows the owner named are seeded as data.
--
-- 27 Sep: the owner listed the flows the company runs today. They are rows,
-- not code — Admin edits them from the hub's "Alur barang" screen and every
-- edit is a new version — so a store that starts running its own returns, or
-- a Gudang that stops loading before departing, is a template change and not
-- a deploy. Each one below holds the invariants 0615 checks at commit.
--
--   Kirim gudang → toko     pick · pack · tutup koli · muat · berangkat · terima
--   Mutasi antar toko       pick · pack · tutup koli · berangkat · terima
--                           (HO starts it; the shops do the work)
--   Retur toko → gudang     pick · pack · tutup koli · berangkat · terima (into
--                           the store's return pool at the Gudang) · periksa
--                           (mandatory: not skippable)
--   Retur ke supplier       persetujuan · pick · pack · berangkat · serah terima
--                           (from the Gudang, delivered by HO, against the
--                           supplier's signed return note)
--   Terima dari supplier    kedatangan · hitung buta · verifikasi · tagging ·
--                           simpan ke rak
--
-- Who performs each stage is the closest role the ladder can hold today
-- (`domain::flow::FlowRole`): MD starts allotments and store transfers, a
-- buyer starts supplier traffic, the Gudang floor picks and counts, a Gudang
-- supervisor verifies and inspects, HO's delivery departs and hands over, and
-- a store's staff receive. Deadlines are a starting point for the owner to
-- tune, not a rule.
--
-- Fixed ids, so a later migration can refer to a seeded template without
-- looking it up by code.

INSERT INTO flow_template
    (id, code, name, origin_kind, destination_kind, is_default, current_version_id, created_by, updated_by)
VALUES
    ('f10e0000-0000-4000-8000-000000000001', 'KIRIM_GUDANG_TOKO', 'Kirim gudang → toko',
     'HO', 'STORE', true, 'f10e0000-0000-4000-8000-000000000101', 'migration:0619', 'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000002', 'MUTASI_ANTAR_TOKO', 'Mutasi antar toko',
     'STORE', 'STORE', true, 'f10e0000-0000-4000-8000-000000000102', 'migration:0619', 'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000003', 'RETUR_TOKO_GUDANG', 'Retur toko → gudang',
     'STORE', 'HO', true, 'f10e0000-0000-4000-8000-000000000103', 'migration:0619', 'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000004', 'RETUR_KE_SUPPLIER', 'Retur ke supplier',
     'HO', 'SUPPLIER', true, 'f10e0000-0000-4000-8000-000000000104', 'migration:0619', 'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000005', 'TERIMA_DARI_SUPPLIER', 'Terima dari supplier',
     'SUPPLIER', 'HO', true, 'f10e0000-0000-4000-8000-000000000105', 'migration:0619', 'migration:0619');

INSERT INTO flow_template_version
    (id, template_id, version, starters, destination_pool_role, notes, created_by)
VALUES
    ('f10e0000-0000-4000-8000-000000000101', 'f10e0000-0000-4000-8000-000000000001', 1,
     ARRAY['HO_MD'], 'STOCKROOM',
     'Allotment MD ke toko. Terima di toko: satu konfirmasi, selisih jadi Missing, rusak ke reject.',
     'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000102', 'f10e0000-0000-4000-8000-000000000002', 1,
     ARRAY['HO_MD'], 'STOCKROOM',
     'HO yang memulai; toko asal mengambil dan mengirim, toko tujuan menerima. Lintas unit: interunit barang otomatis.',
     'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000103', 'f10e0000-0000-4000-8000-000000000003', 1,
     ARRAY['HO_MD'], 'RETURN',
     'HO yang memulai. Diterima ke pool retur toko itu di Gudang, lalu wajib diperiksa.',
     'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000104', 'f10e0000-0000-4000-8000-000000000004', 1,
     ARRAY['HO_BUYER'], NULL,
     'Dari Gudang, diantar HO. Serah terima wajib nota retur bertanda tangan. Toko tidak berurusan dengan supplier.',
     'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000105', 'f10e0000-0000-4000-8000-000000000005', 1,
     ARRAY['HO_BUYER'], 'WAREHOUSE',
     'Checker menghitung buta; verifier orang lain. Barang jadi stok operasional saat diverifikasi.',
     'migration:0619');

INSERT INTO flow_template_stage
    (version_id, ordinal, stage_kind, performer_role, proof, deadline_hours, skippable)
VALUES
    -- Kirim gudang → toko
    ('f10e0000-0000-4000-8000-000000000101', 0, 'PICK',       'GUDANG_STAFF', ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000101', 1, 'PACK',       'GUDANG_STAFF', ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000101', 2, 'CLOSE_KOLI', 'GUDANG_STAFF', ARRAY[]::text[],    8,  false),
    ('f10e0000-0000-4000-8000-000000000101', 3, 'LOAD',       'GUDANG_STAFF', ARRAY[]::text[],    8,  true),
    ('f10e0000-0000-4000-8000-000000000101', 4, 'DEPART',     'HO_DELIVERY',  ARRAY[]::text[],    24, false),
    ('f10e0000-0000-4000-8000-000000000101', 5, 'RECEIVE',    'STORE_STAFF',  ARRAY['RFID_SCAN'], 72, false),

    -- Mutasi antar toko
    ('f10e0000-0000-4000-8000-000000000102', 0, 'PICK',       'STORE_STAFF',   ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000102', 1, 'PACK',       'STORE_STAFF',   ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000102', 2, 'CLOSE_KOLI', 'STORE_STAFF',   ARRAY[]::text[],    8,  false),
    ('f10e0000-0000-4000-8000-000000000102', 3, 'DEPART',     'STORE_MANAGER', ARRAY[]::text[],    24, false),
    ('f10e0000-0000-4000-8000-000000000102', 4, 'RECEIVE',    'STORE_STAFF',   ARRAY['RFID_SCAN'], 72, false),

    -- Retur toko → gudang
    ('f10e0000-0000-4000-8000-000000000103', 0, 'PICK',       'STORE_STAFF',       ARRAY['RFID_SCAN'], 24,  false),
    ('f10e0000-0000-4000-8000-000000000103', 1, 'PACK',       'STORE_STAFF',       ARRAY['RFID_SCAN'], 24,  false),
    ('f10e0000-0000-4000-8000-000000000103', 2, 'CLOSE_KOLI', 'STORE_STAFF',       ARRAY[]::text[],    8,   false),
    ('f10e0000-0000-4000-8000-000000000103', 3, 'DEPART',     'STORE_MANAGER',     ARRAY[]::text[],    48,  false),
    ('f10e0000-0000-4000-8000-000000000103', 4, 'RECEIVE',    'GUDANG_STAFF',      ARRAY['RFID_SCAN'], 72,  false),
    ('f10e0000-0000-4000-8000-000000000103', 5, 'INSPECT',    'GUDANG_SUPERVISOR', ARRAY['RFID_SCAN', 'PHOTO'], 120, false),

    -- Retur ke supplier
    ('f10e0000-0000-4000-8000-000000000104', 0, 'APPROVAL',            'HO_ADMIN',     ARRAY[]::text[],    48, false),
    ('f10e0000-0000-4000-8000-000000000104', 1, 'PICK',                'GUDANG_STAFF', ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000104', 2, 'PACK',                'GUDANG_STAFF', ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000104', 3, 'DEPART',              'HO_DELIVERY',  ARRAY[]::text[],    48, false),
    ('f10e0000-0000-4000-8000-000000000104', 4, 'HANDOVER_WITH_PROOF', 'HO_DELIVERY',  ARRAY['SIGNED_RETURN_NOTE', 'PHOTO'], 72, false),

    -- Terima dari supplier
    ('f10e0000-0000-4000-8000-000000000105', 0, 'ARRIVAL',      'GUDANG_STAFF',      ARRAY[]::text[],       NULL, false),
    ('f10e0000-0000-4000-8000-000000000105', 1, 'BLIND_COUNT',  'GUDANG_STAFF',      ARRAY['MANUAL_COUNT'], 24,   false),
    ('f10e0000-0000-4000-8000-000000000105', 2, 'VERIFICATION', 'GUDANG_SUPERVISOR', ARRAY[]::text[],       24,   false),
    ('f10e0000-0000-4000-8000-000000000105', 3, 'TAGGING',      'GUDANG_STAFF',      ARRAY[]::text[],       72,   true),
    ('f10e0000-0000-4000-8000-000000000105', 4, 'PUTAWAY',      'GUDANG_STAFF',      ARRAY[]::text[],       72,   true);
