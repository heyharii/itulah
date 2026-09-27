-- Seed for Expenses & Bills (finance-lab-2): supplier invoices.
--
-- Written to be run more than once: every INSERT is guarded on the invoice
-- number, so a second run tops the data up rather than duplicating it.
--
-- **Nothing here is POSTED.** `supplier_invoice_check2` ties POSTED to a
-- journal entry, and inventing journal entries is inventing accounting. Every
-- row lands as DRAFT or MATCHED — which is what an unpaid bill waiting for
-- somebody to act on it actually looks like, and it is the state the Bills
-- screen's Open filter is for.
--
-- Rupiah in minor units.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Vendors.
--
-- The Vendors screen groups payables BY PARTY, so a book with one supplier in
-- it cannot show what that screen is for. These are expense vendors — the
-- utilities, landlords and services a retailer actually pays — carrying the
-- tax identity 0302 added, because whether a vendor is PKP is what decides the
-- PPN on their bill.

INSERT INTO supplier (
    supplier_id, supplier_code, supplier_code_normalized, name,
    contact_name, phone, email, address, status, category,
    npwp, is_pkp, expense_account_code,
    created_by, updated_by
)
SELECT gen_random_uuid(), v.code, v.code, v.name,
       v.contact, v.phone, v.email, v.address, 'ACTIVE', 'EXPENSE',
       v.npwp, v.pkp, v.account,
       'seed:expenses-bills', 'seed:expenses-bills'
  FROM (VALUES
        ('PLN01',  'PT PLN (Persero)',        'Layanan Pelanggan', '+62 21 5455 555',   'pelanggan@pln.co.id',       'Jl. Trunojoyo Blok M I/135, Jakarta',  '01.001.002.3-054.000', true,  '6301'),
        ('TLKM01', 'PT Telkom Indonesia',     'Account Manager',   '+62 22 452 1000',   'corporate@telkom.co.id',    'Jl. Japati No. 1, Bandung',            '01.000.013.1-093.000', true,  '6301'),
        ('PDAM01', 'PDAM Tirtawening',        'Bagian Tagihan',    '+62 22 720 6000',   'info@pdamkotabandung.go.id','Jl. Badaksinga No. 10, Bandung',       '02.114.455.6-424.000', false, '6301'),
        ('SWG01',  'PT Graha Sewa Nusantara', 'Rina Kusuma',       '+62 22 733 1122',   'sewa@grahasewa.co.id',      'Jl. Asia Afrika No. 88, Bandung',      '02.556.778.9-424.000', true,  '6401'),
        ('CLN01',  'CV Bersih Sejahtera',     'Hendra Wijaya',     '+62 812 2211 3344', 'admin@bersihsejahtera.id',  'Jl. Cibaduyut No. 45, Bandung',        NULL,                   false, '6301'),
        ('SEC01',  'PT Garda Nusa Persada',   'Komandan Regu',     '+62 813 5566 7788', 'ops@gardanusa.co.id',       'Jl. Soekarno Hatta No. 210, Bandung',  '03.221.334.5-424.000', true,  '6301'),
        ('EKS01',  'PT Kirim Cepat Logistik', 'Dewi Anggraini',    '+62 811 2233 4455', 'cs@kirimcepat.co.id',       'Jl. Kopo No. 175, Bandung',            '03.887.665.4-424.000', true,  '6301'),
        ('ATK01',  'Toko Sinar Kantor',       'Budi Hartono',      '+62 22 601 2233',   'order@sinarkantor.co.id',   'Jl. Pasirkaliki No. 90, Bandung',      NULL,                   false, '6301'),
        ('KSL01',  'KAP Wijaya & Rekan',      'Agus Wijaya',       '+62 22 425 6677',   'tax@wijayarekan.co.id',     'Jl. Riau No. 12, Bandung',             '04.112.334.5-424.000', true,  '6301'),
        ('ASR01',  'PT Asuransi Wahana Tata', 'Klaim Kendaraan',   '+62 21 390 1000',   'care@aswata.co.id',         'Jl. HR Rasuna Said, Jakarta',          '01.302.445.6-054.000', true,  '6301'),
        ('LFT01',  'PT Lift Prima Sentosa',   'Teknisi Lapangan',  '+62 812 9900 1122', 'service@liftprima.co.id',   'Jl. Gatot Subroto No. 55, Bandung',    '03.445.667.8-424.000', true,  '6301'),
        ('SRG01',  'CV Seragam Mandiri',      'Yuni Astuti',       '+62 856 3344 5566', 'cs@seragammandiri.id',      'Jl. Cihampelas No. 120, Bandung',      NULL,                   false, '6301')
       ) AS v(code, name, contact, phone, email, address, npwp, pkp, account)
 WHERE NOT EXISTS (SELECT 1 FROM supplier s WHERE s.supplier_code = v.code);

-- The people at those vendors, as 0302's own table rather than as the three
-- columns above. The primary one shadows them until the last reader is moved.
INSERT INTO supplier_contact (
    contact_id, supplier_id, name, name_normalized, role, phone, email,
    is_primary, created_by, updated_by
)
SELECT gen_random_uuid(), s.supplier_id, s.contact_name,
       upper(regexp_replace(s.contact_name, '[^A-Za-z0-9]', '', 'g')),
       'Sales', s.phone, s.email, true,
       'seed:expenses-bills', 'seed:expenses-bills'
  FROM supplier s
 WHERE s.created_by = 'seed:expenses-bills'
   AND NOT EXISTS (
           SELECT 1 FROM supplier_contact c WHERE c.supplier_id = s.supplier_id
       );

-- Expense bills, spread across the last four months, across every site.
--
-- Due dates are deliberately scattered either side of today: a Bills screen
-- whose every row is in the future never shows what "overdue" looks like, and
-- overdue-first is the whole sort order.
--
-- Every bill names its vendor rather than taking one at random — a screen that
-- groups payables by party is only worth reading if the parties make sense,
-- and an electricity bill from a uniform shop makes nobody trust the list.
CREATE TEMP TABLE seed_bill (
    number   text,
    vendor   text,
    site_id  text,
    billed_on date,
    due_on   date,
    amount   bigint,
    status   text,
    account  text,
    category text,
    memo     text
) ON COMMIT DROP;

INSERT INTO seed_bill VALUES
 ('INV-2026-0501','PLN01', 'dc',       DATE '2026-06-02', DATE '2026-07-02',  42000000, 'MATCHED','6301','BIAYA_PEMAKAIAN_LISTRIK','Listrik DC Juni'),
 ('INV-2026-0502','TLKM01','dc',       DATE '2026-06-05', DATE '2026-07-05',  11800000, 'MATCHED','6301','BIAYA_TELEPHONE_FACSIMILE_MODEM','Internet & telepon Juni'),
 ('INV-2026-0503','SWG01', 'store-01', DATE '2026-06-10', DATE '2026-07-10',  86000000, 'DRAFT',  '6401','BIAYA_SEWA_BANGUNAN_TOKO_DAN_GUDANG','Sewa toko triwulan'),
 ('INV-2026-0504','CLN01', 'store-02', DATE '2026-06-14', DATE '2026-07-14',   3200000, 'MATCHED','6301','BIAYA_KEBERSIHAN','Cleaning service Juni'),
 ('INV-2026-0505','PLN01', 'dc',       DATE '2026-07-01', DATE '2026-08-01',  44500000, 'MATCHED','6301','BIAYA_PEMAKAIAN_LISTRIK','Listrik DC Juli'),
 ('INV-2026-0506','LFT01', 'store-03', DATE '2026-07-03', DATE '2026-08-03',   5400000, 'DRAFT',  '6301','BIAYA_PERBAIKAN_DAN_PERAWATAN_AIRCONDITIONER','Perbaikan AC'),
 ('INV-2026-0507','SWG01', 'dc',       DATE '2026-07-08', DATE '2026-08-08', 125000000, 'MATCHED','6401','BIAYA_SEWA_BANGUNAN_TOKO_DAN_GUDANG','Sewa gudang semester'),
 ('INV-2026-0508','SEC01', 'store-04', DATE '2026-07-12', DATE '2026-08-12',   2750000, 'MATCHED','6301','MISCELLANEOUS_EXPENCES','Keamanan Juli'),
 ('INV-2026-0509','ATK01', 'store-05', DATE '2026-07-20', DATE '2026-08-20',   4100000, 'DRAFT',  '6301','ALAT_TULIS_KANTOR_BARANG_CETAKAN','Alat tulis kantor'),
 ('INV-2026-0510','PLN01', 'dc',       DATE '2026-08-01', DATE '2026-09-01',  43800000, 'MATCHED','6301','BIAYA_PEMAKAIAN_LISTRIK','Listrik DC Agustus'),
 ('INV-2026-0511','EKS01', 'store-06', DATE '2026-08-04', DATE '2026-09-04',   6900000, 'MATCHED','6301','BIAYA_PENGIRIMAN_BARANG_KURIR_EKSPEDISI','Ekspedisi Agustus'),
 ('INV-2026-0512','PDAM01','store-07', DATE '2026-08-09', DATE '2026-09-09',   1500000, 'DRAFT',  '6301','BIAYA_PEMAKAIAN_AIR_BERSIH','Air PDAM Agustus'),
 ('INV-2026-0513','KSL01', 'dc',       DATE '2026-08-15', DATE '2026-09-15',  22500000, 'MATCHED','6301','BIAYA_KONSULTAN','Jasa konsultan pajak'),
 ('INV-2026-0514','LFT01', 'store-08', DATE '2026-08-21', DATE '2026-09-21',   4800000, 'MATCHED','6301','BIAYA_PERBAIKAN_DAN_PERAWATAN_LIFT','Perawatan lift'),
 ('INV-2026-0515','CLN01', 'store-09', DATE '2026-09-01', DATE '2026-10-01',   3650000, 'MATCHED','6301','BIAYA_KEBERSIHAN','Cleaning service September'),
 ('INV-2026-0516','PLN01', 'dc',       DATE '2026-09-02', DATE '2026-10-02',  46100000, 'MATCHED','6301','BIAYA_PEMAKAIAN_LISTRIK','Listrik DC September'),
 ('INV-2026-0517','SWG01', 'store-10', DATE '2026-09-05', DATE '2026-10-05',   9200000, 'DRAFT',  '6301','BIAYA_PERBAIKAN_DAN_PERAWATAN_BANGUNAN','Renovasi rak'),
 ('INV-2026-0518','PDAM01','store-11', DATE '2026-09-08', DATE '2026-10-08',   2100000, 'MATCHED','6301','BIAYA_PEMAKAIAN_AIR_BERSIH','Air PDAM September'),
 ('INV-2026-0519','ASR01', 'dc',       DATE '2026-09-10', DATE '2026-10-10',  17500000, 'MATCHED','6301','BIAYA_ASURANSI_KENDARAAN','Asuransi kendaraan operasional'),
 ('INV-2026-0520','SRG01', 'store-12', DATE '2026-09-14', DATE '2026-10-14',   3950000, 'DRAFT',  '6301','BIAYA_PERLENGKAPAN_TOKO_DAN_KANTOR','Seragam pegawai'),
 ('INV-2026-0521','EKS01', 'store-13', DATE '2026-09-17', DATE '2026-10-17',   5300000, 'MATCHED','6301','BIAYA_PENGIRIMAN_BARANG_KURIR_EKSPEDISI','Ekspedisi September'),
 ('INV-2026-0522','SEC01', 'dc',       DATE '2026-09-18', DATE '2026-10-18',  31000000, 'MATCHED','6301','BIAYA_BONGKAR_MUAT_BARANG','Bongkar muat gudang');

INSERT INTO supplier_invoice (
    invoice_id, invoice_number, supplier_id, supplier_name, site_id,
    invoice_date, due_date, currency,
    subtotal_minor, tax_minor, discount_minor, total_minor,
    status, kind, recorded_by, recorded_at, note
)
-- The BILL sits at head office; the expense LINE sits at the shop.
--
-- Not a preference: `2101 Hutang Supplier` and `1402 Pajak Bayar Dimuka`
-- belong to the company, and the poster refuses them at a shop — "belongs to
-- the company and not to a shop; it posts at dc". So the payable and the input
-- VAT land at `dc` with the document, and the cost lands where the cost was
-- incurred, which is what `post_bill` describes as the ordinary shape of an
-- expense bill spanning several shops.
SELECT gen_random_uuid(), b.number, s.supplier_code, s.name, 'dc',
       b.billed_on, b.due_on, 'IDR',
       b.amount * 100,
       -- PPN 11% where the vendor is PKP, nothing where they are not. The flag
       -- 0302 added is what decides it, which is the point of having it.
       CASE WHEN s.is_pkp THEN (b.amount * 100 * 11) / 100 ELSE 0 END,
       0,
       b.amount * 100
         + CASE WHEN s.is_pkp THEN (b.amount * 100 * 11) / 100 ELSE 0 END,
       b.status, 'EXPENSE', 'seed:expenses-bills',
       b.billed_on::timestamptz + time '09:30', b.memo
  FROM seed_bill b
  JOIN supplier s ON s.supplier_code = b.vendor
 WHERE NOT EXISTS (
           SELECT 1 FROM supplier_invoice i WHERE i.invoice_number = b.number
       );

-- What each bill was FOR. An expense bill with no lines cannot be posted
-- anywhere, and the database says so itself — one line per bill here, because
-- these are single-purpose invoices and a split would be an invention.
INSERT INTO supplier_invoice_expense_line (
    line_id, invoice_id, kind, line_number, account_code, is_group,
    site_id, amount_minor, memo, category_code
)
SELECT gen_random_uuid(), i.invoice_id, 'EXPENSE', 1, b.account, false,
       b.site_id, i.subtotal_minor, b.memo, b.category
  FROM seed_bill b
  JOIN supplier_invoice i ON i.invoice_number = b.number
 WHERE NOT EXISTS (
           SELECT 1 FROM supplier_invoice_expense_line l
            WHERE l.invoice_id = i.invoice_id
       );

COMMIT;

SELECT 'vendors' AS what, count(*)::bigint AS n
  FROM supplier WHERE created_by = 'seed:expenses-bills'
UNION ALL
SELECT 'bills', count(*) FROM supplier_invoice WHERE recorded_by = 'seed:expenses-bills'
UNION ALL
SELECT 'expense lines', count(*) FROM supplier_invoice_expense_line l
  JOIN supplier_invoice i USING (invoice_id) WHERE i.recorded_by = 'seed:expenses-bills';
