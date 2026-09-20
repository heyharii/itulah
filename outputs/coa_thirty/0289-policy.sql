INSERT INTO account_category_policy
    (account_code, category_code, posting_mode, manual_je_policy, note) VALUES
    ('1101', 'FLOAT', 'SEMI_AUTO', 'NO', 'kept from 1011001003 Modal Kasir'),
    ('1402', 'PPH29', 'AUTO_ONLY', 'NO', 'kept from 1011302003 Prepaid - PPh Pasal 29'),
    ('1402', 'PPN_IN', 'AUTO_ONLY', 'NO', 'kept from 1011302004 Prepaid - VAT (PPN Masukan)'),
    ('2301', 'BIAYA_GAJI_DAN_UPAH_YMHD', 'AUTO_ONLY', 'NO', 'kept from 2012201001 Biaya Gaji dan Upah Yang Masih Harus Dibayar'),
    ('2301', 'BIAYA_BUNGA_PINJAMAN_YMHD', 'AUTO_ONLY', 'NO', 'kept from 2012201003 Biaya Bunga Pinjaman Yang Masih Harus Dibayar'),
    ('2401', 'CUSTOMER_DEPOSIT', 'AUTO_ONLY', 'NO', 'kept from 205001 Uang Muka - Penjualan'),
    ('4301', 'MANAGEMENT_FEE', 'SEMI_AUTO', 'OVERRIDE', 'kept from 4020110001 Management Fee'),
    ('4301', 'INTEREST', 'AUTO_ONLY', 'OVERRIDE', 'kept from 8010110001 Pendapatan Bunga Bank'),
    ('4301', 'ROUNDING', 'AUTO_ONLY', 'NO', 'kept from 8010110002 Selisih Pembulatan'),
    ('4301', 'INCOME_OTHER', 'MANUAL', 'OVERRIDE', 'kept from 8010110007 Pendapatan (Biaya) Lain-Lain'),
    ('5102', 'SHRINKAGE', 'AUTO_ONLY', 'OVERRIDE', 'kept from 8010110006 Kehilangan Barang atau Selisih Stock Opname'),
    ('6401', 'BIAYA_LAND_RIGHT', 'AUTO_ONLY', 'NO', 'kept from 7010110002 Biaya Land Right');
