-- The five flows the owner named are seeded as data.
--
-- 27 Sep: the owner listed the flows the company runs today. They are rows,
-- not code — Admin edits them from the hub's "Alur barang" screen and every
-- edit is a new version — so a store that starts running its own returns, or
-- a Gudang that stops loading before departing, is a template change and not
-- a deploy. Each one below holds the invariants 0615 checks at commit.
--
--   Kirim gudang → toko     pick · pack · tutup koli · masuk surat jalan (SJ) ·
--                           muat (dispatch, DSP) · berangkat · terima
--   Mutasi antar toko       pick · pack · tutup koli · masuk surat jalan (SJ) ·
--                           muat (boleh dilewati: berangkat membuka DSP) ·
--                           berangkat · terima
--   Retur toko → gudang     pick · pack · tutup koli · masuk surat jalan (SJ
--                           retur) · berangkat · terima (into the store's return
--                           pool at the Gudang) · periksa (mandatory)
--   Retur ke supplier       persetujuan · pick · pack · masuk surat jalan (SJ
--                           retur supplier) · berangkat · serah terima (from the
--                           Gudang, delivered by HO, against the supplier's
--                           signed return note)
--   Terima dari supplier    kedatangan · hitung buta · verifikasi · tagging ·
--                           simpan ke rak
--
-- # A plan is not a stage
--
-- None of these creates the document it runs. The first four are born from
-- an ALLOTMENT — MD's to a store, a store-to-store transfer, a return to the
-- Gudang, a return to a supplier — and the fifth from the PURCHASE_ORDER (or
-- the DELIVERY against it) a buyer raised. `starters` below is who may raise
-- that source for the route: MD for allotments and transfers between and
-- back from stores, a buyer for supplier traffic.
--
-- Who performs each stage is the closest role the ladder can hold today
-- (`domain::flow::FlowRole`): the Gudang floor picks, packs, ships and
-- counts, a Gudang supervisor verifies and inspects, HO's delivery departs
-- and hands over, and a store's staff pick and receive at the shop.
-- Deadlines are a starting point for the owner to tune, not a rule.
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
     'Lahir dari allotment MD ke toko. SJ per toko; satu dispatch bisa membawa beberapa SJ. Terima di toko: satu konfirmasi, selisih jadi Missing, rusak ke reject.',
     'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000102', 'f10e0000-0000-4000-8000-000000000002', 1,
     ARRAY['HO_MD'], 'STOCKROOM',
     'Lahir dari allotment mutasi yang dibuat HO; toko asal mengambil dan mengirim, toko tujuan menerima. Lintas unit: interunit barang otomatis.',
     'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000103', 'f10e0000-0000-4000-8000-000000000003', 1,
     ARRAY['HO_MD'], 'RETURN',
     'Lahir dari allotment retur yang dibuat HO. Diterima ke pool retur toko itu di Gudang, lalu wajib diperiksa.',
     'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000104', 'f10e0000-0000-4000-8000-000000000004', 1,
     ARRAY['HO_BUYER'], NULL,
     'Lahir dari allotment retur ke supplier. Dari Gudang, diantar HO; serah terima wajib nota retur bertanda tangan. Toko tidak berurusan dengan supplier.',
     'migration:0619'),
    ('f10e0000-0000-4000-8000-000000000105', 'f10e0000-0000-4000-8000-000000000005', 1,
     ARRAY['HO_BUYER'], 'WAREHOUSE',
     'Lahir dari PO (atau delivery-nya). Checker menghitung buta; verifier orang lain. Barang jadi stok operasional saat diverifikasi.',
     'migration:0619');

INSERT INTO flow_template_stage
    (version_id, ordinal, stage_kind, performer_role, proof, deadline_hours, skippable)
VALUES
    -- Kirim gudang → toko
    ('f10e0000-0000-4000-8000-000000000101', 0, 'PICK',       'GUDANG_STAFF', ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000101', 1, 'PACK',       'GUDANG_STAFF', ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000101', 2, 'CLOSE_KOLI', 'GUDANG_STAFF', ARRAY[]::text[],    8,  false),
    ('f10e0000-0000-4000-8000-000000000101', 3, 'SHIP',       'GUDANG_STAFF', ARRAY[]::text[],    8,  false),
    ('f10e0000-0000-4000-8000-000000000101', 4, 'LOAD',       'GUDANG_STAFF', ARRAY[]::text[],    8,  false),
    ('f10e0000-0000-4000-8000-000000000101', 5, 'DEPART',     'HO_DELIVERY',  ARRAY[]::text[],    24, false),
    ('f10e0000-0000-4000-8000-000000000101', 6, 'RECEIVE',    'STORE_STAFF',  ARRAY['RFID_SCAN'], 72, false),

    -- Mutasi antar toko
    ('f10e0000-0000-4000-8000-000000000102', 0, 'PICK',       'STORE_STAFF',   ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000102', 1, 'PACK',       'STORE_STAFF',   ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000102', 2, 'CLOSE_KOLI', 'STORE_STAFF',   ARRAY[]::text[],    8,  false),
    ('f10e0000-0000-4000-8000-000000000102', 3, 'SHIP',       'STORE_STAFF',   ARRAY[]::text[],    8,  false),
    ('f10e0000-0000-4000-8000-000000000102', 4, 'LOAD',       'STORE_STAFF',   ARRAY[]::text[],    8,  true),
    ('f10e0000-0000-4000-8000-000000000102', 5, 'DEPART',     'STORE_MANAGER', ARRAY[]::text[],    24, false),
    ('f10e0000-0000-4000-8000-000000000102', 6, 'RECEIVE',    'STORE_STAFF',   ARRAY['RFID_SCAN'], 72, false),

    -- Retur toko → gudang
    ('f10e0000-0000-4000-8000-000000000103', 0, 'PICK',       'STORE_STAFF',       ARRAY['RFID_SCAN'], 24,  false),
    ('f10e0000-0000-4000-8000-000000000103', 1, 'PACK',       'STORE_STAFF',       ARRAY['RFID_SCAN'], 24,  false),
    ('f10e0000-0000-4000-8000-000000000103', 2, 'CLOSE_KOLI', 'STORE_STAFF',       ARRAY[]::text[],    8,   false),
    ('f10e0000-0000-4000-8000-000000000103', 3, 'SHIP',       'STORE_STAFF',       ARRAY[]::text[],    8,   false),
    ('f10e0000-0000-4000-8000-000000000103', 4, 'DEPART',     'STORE_MANAGER',     ARRAY[]::text[],    48,  false),
    ('f10e0000-0000-4000-8000-000000000103', 5, 'RECEIVE',    'GUDANG_STAFF',      ARRAY['RFID_SCAN'], 72,  false),
    ('f10e0000-0000-4000-8000-000000000103', 6, 'INSPECT',    'GUDANG_SUPERVISOR', ARRAY['RFID_SCAN', 'PHOTO'], 120, false),

    -- Retur ke supplier
    ('f10e0000-0000-4000-8000-000000000104', 0, 'APPROVAL',            'HO_ADMIN',     ARRAY[]::text[],    48, false),
    ('f10e0000-0000-4000-8000-000000000104', 1, 'PICK',                'GUDANG_STAFF', ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000104', 2, 'PACK',                'GUDANG_STAFF', ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000104', 3, 'SHIP',                'GUDANG_STAFF', ARRAY[]::text[],    8,  false),
    ('f10e0000-0000-4000-8000-000000000104', 4, 'DEPART',              'HO_DELIVERY',  ARRAY[]::text[],    48, false),
    ('f10e0000-0000-4000-8000-000000000104', 5, 'HANDOVER_WITH_PROOF', 'HO_DELIVERY',  ARRAY['SIGNED_RETURN_NOTE', 'PHOTO'], 72, false),

    -- Terima dari supplier
    ('f10e0000-0000-4000-8000-000000000105', 0, 'ARRIVAL',      'GUDANG_STAFF',      ARRAY[]::text[],       NULL, false),
    ('f10e0000-0000-4000-8000-000000000105', 1, 'BLIND_COUNT',  'GUDANG_STAFF',      ARRAY['MANUAL_COUNT'], 24,   false),
    ('f10e0000-0000-4000-8000-000000000105', 2, 'VERIFICATION', 'GUDANG_SUPERVISOR', ARRAY[]::text[],       24,   false),
    ('f10e0000-0000-4000-8000-000000000105', 3, 'TAGGING',      'GUDANG_STAFF',      ARRAY[]::text[],       72,   true),
    ('f10e0000-0000-4000-8000-000000000105', 4, 'PUTAWAY',      'GUDANG_STAFF',      ARRAY[]::text[],       72,   true);
