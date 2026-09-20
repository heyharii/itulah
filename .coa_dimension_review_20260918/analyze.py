import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path('/Users/hari/itulah/.coa_dimension_review_20260918')
SOURCE = Path('/Users/hari/Downloads/Laporan_Master_Account1.csv')

TARGET_COA = [
    ('1101', 'Kas', 'Aset', 'Debit', 'Lokasi kas / kas kecil'),
    ('1102', 'Bank dan deposito', 'Aset', 'Debit', 'Rekening bank, jenis rekening, mata uang, jatuh tempo'),
    ('1201', 'Piutang tender', 'Aset', 'Debit', 'Tender, acquirer, metode pembayaran'),
    ('1202', 'Piutang karyawan dan lainnya', 'Aset', 'Debit', 'Pihak terkait / pelanggan / karyawan'),
    ('1209', 'Cadangan kerugian piutang', 'Kontra aset', 'Kredit', 'Kelas piutang / pihak terkait'),
    ('1301', 'Persediaan', 'Aset', 'Debit', 'Item, gudang, kelas stok'),
    ('1302', 'Barang dalam perjalanan', 'Aset', 'Debit', 'Item, asal/tujuan, status transit'),
    ('1309', 'Cadangan kerusakan persediaan', 'Kontra aset', 'Kredit', 'Kelas stok / kebijakan penyisihan'),
    ('1401', 'Biaya dibayar di muka', 'Aset', 'Debit', 'Jenis biaya, periode manfaat, jadwal amortisasi'),
    ('1402', 'Pajak dibayar di muka', 'Aset', 'Debit', 'Jenis pajak, masa pajak, dokumen pajak'),
    ('1403', 'Uang muka', 'Aset', 'Debit', 'Tujuan, supplier/karyawan, status penyelesaian'),
    ('1501', 'Piutang antarunit dan afiliasi', 'Aset', 'Debit', 'Unit/pihak lawan, alasan, jatuh tempo'),
    ('1601', 'Aset tetap, aset takberwujud dan KDP', 'Aset', 'Debit', 'Kelas aset, register aset, status siap digunakan'),
    ('1609', 'Akumulasi penyusutan dan amortisasi', 'Kontra aset', 'Kredit', 'Register aset, kelas aset, jadwal'),
    ('2101', 'Hutang supplier', 'Liabilitas', 'Kredit', 'Supplier, invoice, jatuh tempo'),
    ('2102', 'Barang diterima belum ditagih', 'Liabilitas', 'Kredit', 'Supplier, GRN, item'),
    ('2103', 'Giro keluar belum cair', 'Liabilitas', 'Kredit', 'Rekening bank, nomor giro, status'),
    ('2201', 'Hutang pajak', 'Liabilitas', 'Kredit', 'Jenis pajak, masa pajak, dokumen pajak'),
    ('2301', 'Akrual dan hutang lainnya', 'Liabilitas', 'Kredit', 'Jenis akrual/utang, pihak terkait, jatuh tempo'),
    ('2302', 'Hutang antarunit dan afiliasi', 'Liabilitas', 'Kredit', 'Unit/pihak lawan, alasan, jatuh tempo'),
    ('2401', 'Uang muka pelanggan dan voucher', 'Liabilitas', 'Kredit', 'Pelanggan, order/voucher, status'),
    ('2501', 'Pinjaman lancar dan bagian jatuh tempo', 'Liabilitas', 'Kredit', 'Fasilitas, pemberi pinjaman, jatuh tempo'),
    ('2502', 'Pinjaman jangka panjang dan pemilik', 'Liabilitas', 'Kredit', 'Fasilitas/pemberi pinjaman, jadwal'),
    ('3101', 'Modal disetor', 'Ekuitas', 'Kredit', 'Pemilik / komponen modal'),
    ('3102', 'Prive', 'Ekuitas', 'Debit', 'Pemilik'),
    ('3201', 'Saldo laba', 'Ekuitas', 'Kredit', 'Periode penutupan'),
    ('4101', 'Penjualan', 'Pendapatan', 'Kredit', 'Metode pembayaran, channel, item'),
    ('4201', 'Retur dan diskon penjualan', 'Kontra pendapatan', 'Debit', 'Jenis pengurang, transaksi asal'),
    ('4301', 'Pendapatan lain-lain', 'Pendapatan', 'Kredit', 'Jenis pendapatan, pihak terkait'),
    ('5101', 'Harga pokok penjualan', 'Harga pokok', 'Debit', 'Item, pergerakan stok, diskon pembelian'),
    ('5102', 'Susut dan selisih persediaan', 'Harga pokok', 'Debit', 'Jenis selisih, item, stock opname'),
    ('6101', 'Beban penjualan', 'Beban', 'Debit', 'Jenis biaya, fungsi/cost center'),
    ('6201', 'Beban karyawan', 'Beban', 'Debit', 'Komponen payroll, fungsi/cost center'),
    ('6301', 'Beban umum, administrasi dan pemeliharaan', 'Beban', 'Debit', 'Jenis biaya, fungsi/cost center'),
    ('6401', 'Beban sewa', 'Beban', 'Debit', 'Objek sewa, lokasi, kontrak'),
    ('7101', 'Beban penyusutan dan amortisasi', 'Beban', 'Debit', 'Register aset, kelas aset'),
    ('8101', 'Beban bunga dan pembiayaan', 'Beban', 'Debit', 'Fasilitas/pemberi pinjaman'),
    ('8201', 'Beban pajak penghasilan', 'Beban', 'Debit', 'Jenis pajak, masa pajak, provisi'),
]
TARGETS = {code: name for code, name, *_ in TARGET_COA}
UNITS = {'00': 'HO', **{str(i).zfill(2): f'C{str(i).zfill(3)}' for i in range(1, 14)}}

def proposal(code, name):
    """Proposed treatment of one legacy base family.  These are review recommendations, not posting approvals."""
    u = name.upper()
    def out(gl, fields='', form='Jurnal manual', status='Usulan', note='', label=''):
        return {
            'target_code': gl,
            'target_name': TARGETS.get(gl, ''),
            'treatment': 'Gabungkan ke akun utama; detail pindah ke field' if gl else 'Review sebelum diputuskan',
            'dimension_label': label or fields,
            'fields': fields,
            'form': form,
            'status': status,
            'review': note,
        }

    # Cash, receivables, stock, prepayments
    if code.startswith('1011001'):
        return out('1101', 'Lokasi kas / kas kecil', 'Kas atau pengeluaran kas', label='Kas / lokasi kas')
    if code.startswith(('1011002', '1011003', '1011004')):
        note = 'Konfirmasi deposito yang tidak likuid atau berjangka panjang agar tidak salah disajikan sebagai kas setara kas.' if code.startswith('1011004') else ''
        return out('1102', 'Rekening bank; jenis rekening; mata uang; jatuh tempo', 'Penerimaan/pembayaran bank', 'Review diperlukan' if note else 'Usulan', note, 'Rekening bank')
    if code.startswith('1011101'):
        return out('1201', 'Metode pembayaran; acquirer; status settlement', 'Penjualan / settlement kartu', label='Tender / acquirer')
    if code.startswith('1011102'):
        return out('1202', 'Pihak terkait; jenis piutang; jatuh tempo', 'Piutang / jurnal manual', label='Pihak terkait')
    if code.startswith('1011103'):
        return out('1209', 'Kelas piutang; pihak terkait / pool penyisihan', 'Proses penyisihan', label='Kelas piutang')
    if code.startswith(('1011201', '1011202')):
        return out('1301', 'Item; gudang; kelas stok', 'Transaksi persediaan', label='Item / gudang')
    if code.startswith(('1011203', '1011204')):
        return out('1302', 'Item; asal/tujuan; status transit', 'Transfer persediaan', 'Review diperlukan', 'Nama unit pada akun perlu dikonfirmasi: asal atau tujuan pengiriman.', 'Item / transit')
    if code.startswith('1011299'):
        return out('1309', 'Kelas stok; kebijakan penyisihan', 'Proses penyisihan persediaan', label='Kelas stok')
    if code.startswith('1011301'):
        return out('1401', 'Jenis biaya; kontrak; periode manfaat; jadwal', 'Invoice supplier / jurnal periodik', label='Jenis biaya + jadwal')
    if code.startswith('1011302'):
        return out('1402', 'Jenis pajak; masa pajak; dokumen pajak; status kredit', 'Form pajak', label='Jenis pajak')
    if code.startswith('1011303'):
        return out('1403', 'Tujuan uang muka; supplier/karyawan; status penyelesaian', 'Uang muka / klaim', label='Tujuan uang muka')
    if code.startswith('10214'):
        return out('1501', 'Pihak/unit lawan; alasan; jatuh tempo', 'Jurnal antarunit', 'Review diperlukan', 'Konfirmasi apakah unit berada dalam entitas hukum yang sama dan bagaimana eliminasi dilakukan.', 'Pihak antarunit')

    # Assets and deferred balances
    if code.startswith('102150'):
        note = 'Konfirmasi klasifikasi Hak Sewa Tanah/HGB sebelum migrasi; dapat memerlukan perlakuan aset yang berbeda.' if code == '1021501002' else ''
        return out('1601', 'Register aset; kelas aset; lokasi/unit; status siap digunakan', 'Perolehan aset', 'Review diperlukan' if note else 'Usulan', note, 'Register / kelas aset')
    if code.startswith('1021607'):
        return out('', 'Register aset; kebijakan replacement reserve', 'Review saldo aset', 'Review diperlukan', 'Reserve Replacement Operating Equipment tidak dapat otomatis diputuskan sebagai akumulasi penyusutan, provisi, atau beban.', 'Register aset')
    if code.startswith('102160'):
        note = 'Konfirmasi amortisasi Hak Pengelolaan Tanah/HGB dengan klasifikasi aset dasarnya.' if code == '1021601002' else ''
        return out('1609', 'Register aset; kelas aset; jadwal penyusutan/amortisasi', 'Penyusutan / amortisasi', 'Review diperlukan' if note else 'Usulan', note, 'Register / kelas aset')
    if code.startswith('1021701'):
        return out('1601', 'Register aset; kelas aset; jadwal amortisasi', 'Perolehan aset takberwujud', label='Register / kelas aset')
    if code.startswith('1021702'):
        return out('1609', 'Register aset; kelas aset; jadwal amortisasi', 'Amortisasi', label='Register / kelas aset')
    if code == '1031801001':
        return out('', 'Item / aset terkait; alasan pelepasan', 'Review saldo', 'Review diperlukan', '“Disposed Inventory” dapat berarti persediaan, kerugian pelepasan, atau aset yang telah dilepas. Periksa transaksi sumber.', 'Item / aset')
    if code in ('1031802001', '1031802002'):
        return out('', 'Dasar pengakuan; jadwal amortisasi', 'Review saldo', 'Review diperlukan', 'Biaya pre-opening perlu diuji dasar pengakuan asetnya sebelum dipetakan ke aset atau beban.', 'Dasar pengakuan')
    if code == '1031803001':
        return out('', 'Proyek/kontrak; pihak lawan; status pengerjaan', 'Review saldo', 'Review diperlukan', '“Contract in Progress” perlu dibedakan antara konstruksi aset dan kontrak pelanggan.', 'Proyek / kontrak')

    # Liabilities, loans and equity
    if code.startswith('2012001002'):
        return out('2102', 'Supplier; bukti penerimaan barang; item', 'Penerimaan barang', 'Review diperlukan', '“Suspend” hanya dipetakan ke barang diterima belum ditagih setelah prosesnya dikonfirmasi.', 'Supplier / GRN')
    if code.startswith('2012001'):
        return out('2101', 'Supplier; invoice; jatuh tempo; jenis pembelian', 'Invoice supplier', label='Supplier')
    if code.startswith('2012002') or code == '204001':
        return out('2103', 'Rekening bank; nomor giro; status pencairan', 'Pembayaran bank', label='Rekening bank / giro')
    if code.startswith('2012101'):
        return out('2201', 'Jenis pajak; masa pajak; dokumen pajak', 'Form pajak', label='Jenis pajak')
    if code.startswith('2012201'):
        return out('2301', 'Jenis akrual; biaya terkait; jatuh tempo', 'Akrual / jurnal periodik', label='Jenis akrual')
    if code.startswith(('2012301', '2012302')):
        return out('2302', 'Pihak/unit lawan; alasan; jatuh tempo', 'Jurnal antarunit', 'Review diperlukan', 'Konfirmasi hubungan entitas dan kebutuhan eliminasi.', 'Pihak antarunit')
    if code.startswith('2012303'):
        return out('2502', 'Pemilik/pemberi pinjaman; fasilitas; jadwal', 'Jadwal pinjaman', 'Review diperlukan', 'Konfirmasi bahwa saldo “Principal” benar merupakan pinjaman pemilik, bukan hutang usaha/antarunit.', 'Pemberi pinjaman')
    if code.startswith('2012304'):
        return out('2301', 'Pihak terkait; jenis hutang; jatuh tempo', 'Jurnal manual', label='Jenis hutang')
    if code.startswith('20125'):
        return out('2501', 'Fasilitas; pemberi pinjaman; jatuh tempo', 'Jadwal pinjaman', label='Fasilitas / jatuh tempo')
    if code.startswith('20224'):
        return out('2502', 'Fasilitas; pemberi pinjaman; jadwal', 'Jadwal pinjaman', label='Fasilitas / pemberi pinjaman')
    if code == '205001':
        return out('2401', 'Pelanggan; order/voucher; status penebusan', 'Penerimaan uang muka', label='Pelanggan / voucher')
    if code.startswith('3013001'):
        suffix = code[-3:]
        if suffix == '001':
            return out('3101', 'Pemilik; komponen modal', 'Jurnal ekuitas', label='Pemilik')
        if suffix == '004':
            return out('3102', 'Pemilik', 'Jurnal ekuitas', label='Pemilik')
        if suffix == '002':
            return out('3201', 'Periode penutupan', 'Proses penutupan', label='Periode penutupan')
        if suffix == '003':
            return out('', 'Periode penutupan', 'Proses penutupan', 'Review diperlukan', 'Laba/rugi bulan berjalan sebaiknya dihitung dari jurnal P&L dan ditutup ke saldo laba; jangan dimigrasikan bersamaan dengan jurnal P&L tanpa kontrol.', 'Periode penutupan')

    # Revenue and cost of sales
    if code.startswith(('4010110', '4010111', '4010112', '4010113')):
        return out('4101', 'Metode pembayaran; acquirer; channel; item', 'Penjualan / POS', label='Tender / channel')
    if code.startswith(('4010213', '4010214')):
        return out('4201', 'Jenis pengurang; transaksi penjualan asal', 'Retur / diskon penjualan', label='Jenis pengurang')
    if code.startswith('40201'):
        return out('4301', 'Jenis pendapatan; pihak terkait', 'Pendapatan lain-lain', label='Jenis pendapatan')
    if code.startswith('50101'):
        return out('5101', 'Item; pergerakan stok; supplier; diskon pembelian', 'Pembelian / persediaan', 'Review diperlukan', 'Konfirmasi metode persediaan periodik atau perpetual sebelum menyajikan pembelian sebagai HPP.', 'Item / pergerakan stok')
    if code == '600104':
        return out('4301', 'Jenis pendapatan; pihak terkait', 'Pendapatan lain-lain', 'Review diperlukan', 'Nama menunjukkan pendapatan walaupun posisinya berada di kelompok kode beban.', 'Jenis pendapatan')

    # Operating expenses
    if code.startswith('6010110008'):
        return out('5102', 'Jenis kerusakan; item; dokumen stock opname', 'Penyesuaian persediaan', 'Review diperlukan', 'Konfirmasi apakah biaya barang rusak dibebankan langsung atau menggunakan cadangan persediaan.', 'Item / jenis selisih')
    if code.startswith('6010110'):
        return out('6101', 'Jenis biaya; fungsi/cost center', 'Biaya penjualan', label='Jenis biaya')
    if code.startswith(('6010111', '6010210')):
        return out('6201', 'Komponen payroll; fungsi/cost center', 'Payroll / biaya karyawan', label='Komponen payroll')
    if code.startswith(('6010310', '6010410')):
        return out('6301', 'Jenis biaya; fungsi/cost center', 'Biaya umum / administrasi', label='Jenis biaya')
    if code.startswith('601'):
        return out('6301', 'Jenis biaya; fungsi/cost center', 'Jurnal biaya', label='Jenis biaya')
    if code.startswith('7010110'):
        return out('6401', 'Objek sewa; lokasi; kontrak', 'Invoice sewa', 'Review diperlukan', 'Review kontrak sewa untuk menentukan perlakuan aset/hutang sewa bila diperlukan.', 'Objek sewa / kontrak')
    if code.startswith('7010215'):
        return out('6301', 'Jenis penggantian; register aset; kebijakan kapitalisasi', 'Pengadaan / pemeliharaan', 'Review diperlukan', 'Konfirmasi apakah penggantian operating equipment merupakan beban atau kapitalisasi aset.', 'Jenis biaya / register aset')
    if code.startswith('701021'):
        return out('7101', 'Register aset; kelas aset', 'Penyusutan / amortisasi', label='Register / kelas aset')
    if code.startswith(('701031', '702031')):
        return out('6301', 'Jenis biaya; fungsi/cost center', 'Biaya umum / administrasi', label='Jenis biaya')

    # Non-operating income, finance cost and tax
    if code.startswith('8010110'):
        end = code[-3:]
        if end == '001':
            return out('4301', 'Jenis pendapatan; rekening bank', 'Pendapatan lain-lain', label='Jenis pendapatan')
        if end == '003':
            return out('5101', 'Jenis diskon pembelian; item/transaksi asal', 'Pembelian / persediaan', 'Review diperlukan', 'Potongan pembelian perlu dikurangkan dari biaya persediaan/HPP secara konsisten, bukan otomatis sebagai pendapatan lain-lain.', 'Jenis diskon pembelian')
        if end in ('004', '005'):
            return out('4301', 'Jenis pendapatan; aset/kontrak sewa', 'Pendapatan lain-lain', label='Jenis pendapatan')
        if end == '006':
            return out('5102', 'Jenis selisih; item; stock opname', 'Penyesuaian persediaan', label='Item / jenis selisih')
        if end == '007':
            return out('', 'Jenis pendapatan atau beban; transaksi sumber', 'Review saldo', 'Review diperlukan', 'Akun gabungan pendapatan/biaya lain-lain harus dipisah berdasarkan substansi transaksi.', 'Jenis transaksi')
        return out('4301', 'Jenis pendapatan; transaksi sumber', 'Pendapatan lain-lain', 'Review diperlukan', 'Selisih pembulatan dapat bersifat pendapatan atau beban; tentukan aturan laporan.', 'Jenis transaksi')
    if code.startswith('8020111'):
        return out('8101', 'Fasilitas/pemberi pinjaman; periode bunga', 'Jadwal pinjaman', label='Fasilitas / pemberi pinjaman')
    if code.startswith('8030112'):
        return out('', 'Jenis pajak; masa pajak; status kredit/provisi', 'Form pajak', 'Review diperlukan', 'PPh Pasal 25 adalah pembayaran/kredit pajak; pisahkan dari beban pajak penghasilan yang dihitung dalam provisi.', 'Jenis pajak')

    return out('', '', 'Review COA', 'Review diperlukan', f'Belum ada aturan otomatis untuk keluarga {code}.', '')

raw = list(csv.reader(SOURCE.open(encoding='utf-8-sig')))
accounts = []
for row_num, row in enumerate(raw, 1):
    if len(row) > 4 and row[1].strip().isdigit():
        accounts.append({
            'source_row': row_num,
            'code': row[1].strip(),
            'name': row[2].strip(),
            'flag': row[3].strip(),
            'level': int(row[4].strip()),
        })

by_code = {a['code']: a for a in accounts}
codes = set(by_code)
parents = {code for code in codes if any(other != code and other.startswith(code) for other in codes)}
leaves = [a for a in accounts if a['code'] not in parents]

for a in accounts:
    code = a['code']
    is_leaf = code not in parents
    base = code[:10] if is_leaf and len(code) == 12 else (code if is_leaf else '')
    e1 = code[10:12] if len(code) == 12 else ''
    a.update({
        'role': 'Akun detail / kandidat posting' if is_leaf else 'Kelompok laporan / bukan akun posting',
        'base': base,
        'h1': code[:1],
        'h2': code[1:3] if len(code) >= 3 else '',
        'h3': code[3:5] if len(code) >= 5 else '',
        'h4': code[5:7] if len(code) >= 7 else '',
        'd1': code[7:10] if len(code) >= 10 else '',
        'e1': e1,
        'unit': UNITS.get(e1, '') if e1 else '',
    })

base_order = []
for a in leaves:
    if a['base'] not in base_order:
        base_order.append(a['base'])

rules = []
rule_by_base = {}
for base in base_order:
    source_family = by_code.get(base)
    member_leaves = [a for a in leaves if a['base'] == base]
    family_name = source_family['name'] if source_family else member_leaves[0]['name']
    r = proposal(base, family_name)
    r.update({
        'base': base,
        'family_name': family_name,
        'legacy_detail_count': len(member_leaves),
        'uses_e1_unit': sum(bool(a['e1']) for a in member_leaves),
        'client_decision': '',
        'client_note': '',
    })
    rule_by_base[base] = r
    rules.append(r)

for a in accounts:
    if not a['base']:
        a.update({
            'target_code': '', 'target_name': '',
            'treatment': 'Pertahankan sebagai hirarki laporan; jangan digunakan sebagai akun posting.',
            'dimension_label': '', 'fields': '', 'form': 'Tidak ada',
            'status': '', 'review': 'Hirarki akun client tetap dipertahankan untuk laporan.'
        })
    else:
        r = rule_by_base[a['base']]
        a.update({k: r[k] for k in ['target_code','target_name','treatment','dimension_label','fields','form','status','review']})
        if a['unit']:
            a['fields'] = 'Unit/cabang (E1; default dari user)' + ('; ' + a['fields'] if a['fields'] else '')
            a['dimension_label'] = 'Unit/cabang' + (' + ' + a['dimension_label'] if a['dimension_label'] else '')

# Explicitly list the limited fields that should be visible in an initial UI, and distinguish them from contextual master data.
field_catalog = [
    ['Unit/cabang', 'Dimensi inti', 'Wajib pada transaksi; default dari login/toko.', 'HO, C001–C013', 'Tampilkan otomatis. Hanya HQ/otorisasi tertentu dapat mengganti.'],
    ['Jenis biaya', 'Dimensi kondisional', 'Wajib hanya untuk 6101, 6301, 6401 dan sebagian 2301.', 'Listrik, air, telepon, ATK, perbaikan, asuransi', 'Tampilkan setelah akun biaya dipilih; gunakan daftar terkendali.'],
    ['Komponen payroll', 'Dimensi kondisional', 'Wajib hanya untuk 6201.', 'Gaji, lembur, THR, BPJS, transport', 'Tampilkan di form payroll/biaya karyawan.'],
    ['Tender / channel', 'Dimensi kondisional', 'Wajib hanya untuk 4101 dan 1201.', 'Tunai, debit, kredit, QRIS, marketplace', 'Tampilkan di POS/settlement, bukan di seluruh jurnal.'],
    ['Jenis pendapatan/pengurang', 'Dimensi kondisional', 'Untuk 4201 dan 4301.', 'Retur, diskon, bunga bank, sewa gedung', 'Tampilkan hanya ketika akun pendapatan dipilih.'],
    ['Unit/pihak antarunit', 'Dimensi kondisional', 'Untuk 1501 dan 2302.', 'HO, C001–C013 atau entitas afiliasi', 'Tampilkan hanya di jurnal antarunit.'],
    ['Supplier / customer', 'Subledger / master data', 'Bukan dropdown dimensi umum.', 'PLN, supplier barang, pelanggan', 'Tampil di form invoice, pembayaran, atau penerimaan.'],
    ['Rekening bank / kas', 'Master data', 'Bukan dropdown dimensi umum.', 'BCA giro, Mandiri tabungan, petty cash', 'Tampil di form bank/kas.'],
    ['Item / gudang', 'Subledger persediaan', 'Bukan dropdown dimensi umum.', 'Barang dagang, kantong belanja, lokasi stok', 'Tampil di form stok atau pembelian.'],
    ['Register aset', 'Subledger aset', 'Bukan dropdown dimensi umum.', 'Bangunan, AC, mobil, software', 'Tampil di form aset/penyusutan.'],
    ['Jenis pajak', 'Field pajak', 'Hanya untuk akun pajak.', 'PPh 21, PPh 23, PPN, PBB', 'Tampil di form pajak.'],
    ['Fasilitas pinjaman', 'Master data', 'Hanya untuk 2501, 2502, 8101.', 'Bank BCA, leasing, pemilik', 'Tampil di form pinjaman/penutupan.'],
]

summary = {
    'source_rows': len(accounts),
    'headings': len(parents),
    'leaves': len(leaves),
    'twelve_digit_leaves': sum(len(a['code']) == 12 for a in leaves),
    'repeating_base_families': len([r for r in rules if r['legacy_detail_count'] == 14]),
    'base_rules': len(rules),
    'target_accounts': len(TARGET_COA),
    'review_families': sum(r['status'] == 'Review diperlukan' for r in rules),
    'proposed_families': sum(r['status'] == 'Usulan' for r in rules),
    'missing_target_families': sum(not r['target_code'] for r in rules),
    'dimension_categories': Counter(r['dimension_label'] or 'Tidak ada / hirarki' for r in rules),
    'target_counts': Counter(r['target_code'] or 'REVIEW' for r in rules),
}

output = {
    'target_coa': TARGET_COA,
    'field_catalog': field_catalog,
    'accounts': accounts,
    'rules': rules,
    'summary': summary,
    'units': [[key, value] for key, value in UNITS.items()],
}
(ROOT / 'data.json').write_text(json.dumps(output, ensure_ascii=False, indent=2))

print(json.dumps({k: v for k, v in summary.items() if not isinstance(v, Counter)}, ensure_ascii=False, indent=2))
print('UNCLASSIFIED', [(r['base'], r['family_name']) for r in rules if r['review'].startswith('Belum ada')])
print('TARGETS', dict(summary['target_counts']))
