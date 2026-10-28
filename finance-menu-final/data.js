/* ═════════ the books: Central Fashion Store, October 2026 ═════════
   Account = 10-digit base + 2-digit location (00 head office, 01–13 shops C001–C013).
   Shop names follow the order of the chart's affiliate accounts (002 CIKUPA … 014 WONOSOBO) —
   a guess at the C001–C013 mapping until the client confirms it. */
const STORES = [
  ['C001', 'Cikupa', 'BCA'], ['C002', 'Muaro Bungo', 'BRI'], ['C003', 'Purbalingga', 'BCA'], ['C004', 'Bumiayu', 'Mandiri'],
  ['C005', 'Jambi', 'BCA'], ['C006', 'Wiramode', 'BCA'], ['C007', 'Brebes', 'Mandiri'], ['C008', 'Pasuruan', 'BCA'],
  ['C009', 'WMJB', 'BRI'], ['C010', 'WMBA', 'BCA'], ['C011', 'Sipin', 'Mandiri'], ['C012', 'Banjaran', 'BCA'], ['C013', 'Wonosobo', 'Mandiri'],
].map(([code, name, edc], i) => ({ code, name, edc, loc: String(i + 1).padStart(2, '0') }))
const STORE = Object.fromEntries(STORES.map(s => [s.code, s]))
const storeName = c => c === 'HO' ? 'Head office' : `${c} · ${STORE[c].name}`
const PEOPLE = ['Dewi Lestari', 'Rudi Hartono', 'Siti Aminah', 'Agus Santoso', 'Rina Wulandari', 'Budi Prasetyo', 'Yuliana Putri', 'Hendra Gunawan', 'Maya Sari', 'Eko Saputra', 'Fitri Handayani', 'Joko Susilo', 'Nur Aisyah']
const FIN = 'Hari Wijaya'

/* accounts the vouchers and the ledger name */
const GL = {
  '1011001001': 'Cash on Hand', '1011001002': 'Petty Cash', '1011001003': 'Modal Kasir',
  '1011002001': 'Cash In Bank Giro Bank BCA', '1011002002': 'Cash In Bank Giro Bank MANDIRI', '1011002003': 'Cash In Bank Giro Bank BRI',
  '1011002004': 'Cash In Bank Giro Bank BNI', '1011002005': 'Cash In Bank Giro Bank DANAMON', '1011003001': 'Cash In Bank Tabungan Bank BCA',
  '1011101001': 'Piutang kartu Kredit', '1011101002': 'Piutang Debit Card', '1011102001': 'Piutang Pegawai', '1011102002': 'Piutang Kepala Toko',
  '1011201001': 'Persediaan Barang Dagangan', '1011301003': 'Sewa Toko Bayar Dimuka', '1011302004': 'Prepaid - VAT (PPN Masukan)', '1011303': 'Uang Muka / Advanced',
  '2012001001': 'Hutang Suppliers Barang Dagangan', '2012001003': 'Hutang Supplier Non Barang Dagang',
  '2012002001': 'Outstanding Giro Bank BCA', '2012002002': 'Outstanding Giro Bank Mandiri', '2012002003': 'Outstanding Giro Bank BRI',
  '2012101002': 'Hutang Pajak PPH Pasal 23 (withold)', '2012101003': 'Hutang VAT PPN Keluaran',
  '4010110001': 'Penjualan Tunai', '4010111001': 'Penjualan Debit Card Bank BCA', '4010214001': 'Retur Penjualan',
  '5010110001': 'Harga Pokok Pembelian', '6010310001': 'Biaya Kebersihan (Cleaning)', '6010310004': 'Biaya Bank HO', '6010310006': 'Biaya Pemakaian Listrik',
  '6010310007': 'Biaya Pemakaian Air Bersih (PDAM)', '8010110001': 'Pendapatan Bunga Bank', '8010110002': 'Selisih pembulatan',
  '8010110003': 'Potongan Pembelian', '8010110004': 'Pendapatan Sewa Gedung', '8010110007': 'Pendapatan (Biaya) Lain-Lain',
}
const acc = (base, loc = '00') => base + loc

/* ── cash & bank accounts (Kas/Bank) ── */
const BANKS = {
  BCA: { tone: '#0060af', short: 'BCA' }, Mandiri: { tone: '#003d79', short: 'MDR' }, BRI: { tone: '#00529c', short: 'BRI' },
  BNI: { tone: '#f15a23', short: 'BNI' }, Danamon: { tone: '#f39200', short: 'DNM' },
}
const ACCOUNTS = [
  { id: 'bca', kind: 'bank', bank: 'BCA', name: 'Giro BCA', no: '0262 113 488', code: acc('1011002001'), place: 'HO', books: 1284750400, bankBal: 1291640900, stmt: '2026-10-27', inM: 2148300500, outM: 1912450200, toMatch: 7 },
  { id: 'mdr', kind: 'bank', bank: 'Mandiri', name: 'Giro Mandiri', no: '137 00 1188 2045', code: acc('1011002002'), place: 'HO', books: 412300000, bankBal: 488570000, stmt: '2026-10-27', inM: 684215000, outM: 590112600, toMatch: 4 },
  { id: 'bri', kind: 'bank', bank: 'BRI', name: 'Giro BRI', no: '0331 01 000712 30 4', code: acc('1011002003'), place: 'HO', books: 188420750, bankBal: 188420750, stmt: '2026-10-27', inM: 241880000, outM: 196450000, toMatch: 0 },
  { id: 'bni', kind: 'bank', bank: 'BNI', name: 'Giro BNI', no: '0844 5521 90', code: acc('1011002004'), place: 'HO', books: 25000000, bankBal: 25000000, stmt: '2026-09-30', inM: 0, outM: 0, toMatch: 0, upload: true },
  { id: 'dnm', kind: 'bank', bank: 'Danamon', name: 'Giro Danamon', no: '0035 6677 1201', code: acc('1011002005'), place: 'HO', books: 12500000, bankBal: 12500000, stmt: '2026-09-30', inM: 0, outM: 45000, toMatch: 0, upload: true },
  { id: 'bcat', kind: 'bank', bank: 'BCA', name: 'Tabungan BCA', no: '0261 550 019', code: acc('1011003001'), place: 'HO', books: 96500000, bankBal: 96862300, stmt: '2026-10-27', inM: 362300, outM: 0, toMatch: 1 },
  { id: 'hoc', kind: 'cash', name: 'Cash on Hand', code: acc('1011001001'), place: 'HO', books: 18400000, counted: 18400000, countedOn: '2026-10-27', inM: 6500000, outM: 9850000 },
  { id: 'hop', kind: 'petty', name: 'Petty Cash', code: acc('1011001002'), place: 'HO', books: 3250000, counted: 3250000, countedOn: '2026-10-24', inM: 5000000, outM: 4615000 },
]
STORES.forEach((s, i) => {
  SEED = 7000 + i
  const cash = round(4e6 + rnd() * 9e6, 1000), petty = round(400000 + rnd() * 1.4e6, 1000)
  const short = s.code === 'C004' ? -50000 : s.code === 'C009' ? 20000 : 0
  ACCOUNTS.push({ id: 'c' + s.loc, kind: 'cash', name: 'Cash on Hand', code: acc('1011001001', s.loc), place: s.code, books: cash, counted: cash + short, countedOn: '2026-10-27', inM: round(cash * 9.5, 1000), outM: round(cash * 9.1, 1000) })
  ACCOUNTS.push({ id: 'p' + s.loc, kind: 'petty', name: 'Petty Cash', code: acc('1011001002', s.loc), place: s.code, books: petty, counted: petty, countedOn: s.code === 'C006' ? '2026-10-14' : '2026-10-25', inM: 2000000, outM: round(2000000 - petty * .3, 1000) })
  ACCOUNTS.push({ id: 'f' + s.loc, kind: 'float', name: 'Modal Kasir', code: acc('1011001003', s.loc), place: s.code, books: 1500000, counted: 1500000, countedOn: '2026-10-27', inM: 0, outM: 0 })
})
const ACC = Object.fromEntries(ACCOUNTS.map(a => [a.id, a]))
const accByCode = c => ACCOUNTS.find(a => a.code === c)
const accLabel = a => a.kind === 'bank' ? `${a.name} · ${a.no}` : `${a.name} · ${a.place === 'HO' ? 'HO' : a.place}`

/* ── suppliers ── */
const SUPPLIERS = [
  { code: 'S-0102', name: 'Garmen Mitra Sentosa, PT', term: 30, limit: 500000000, npwp: '01.234.567.8-415.000', bank: 'BCA 0281 445 120', city: 'Bandung', contact: 'Wawan Setiadi' },
  { code: 'S-0077', name: 'Sepatu Sejahtera, CV', term: 30, limit: 200000000, npwp: '02.887.113.4-428.000', bank: 'Mandiri 131 00 2299 410', city: 'Sidoarjo', contact: 'Lilis Suryani' },
  { code: 'S-0131', name: 'Anugrah Textile, CV', term: 30, limit: 250000000, npwp: '03.115.902.1-412.000', bank: 'BCA 4410 228 901', city: 'Pekalongan', contact: 'Ahmad Fauzi' },
  { code: 'S-0118', name: 'Langgeng Jaya Sentosa, PT', term: 45, limit: 300000000, npwp: '01.998.442.6-054.000', bank: 'BRI 0091 01 002114 30 2', city: 'Jakarta Utara', contact: 'Hendro Wibowo' },
  { code: 'S-0144', name: 'Delta Tex, PT', term: 30, limit: 150000000, npwp: '02.441.738.9-421.000', bank: 'BNI 0337 812 004', city: 'Bandung', contact: 'Yanti Kurnia' },
  { code: 'S-0045', name: 'Sumber Komputer', term: 14, limit: 100000000, npwp: '07.552.190.3-501.000', bank: 'BCA 0882 310 455', city: 'Semarang', contact: 'Teguh Pranoto' },
  { code: 'S-0208', name: 'Graha Clean, PT', term: 7, limit: 50000000, npwp: '08.113.665.2-511.000', bank: 'Mandiri 136 00 7741 228', city: 'Semarang', contact: 'Ratna Dewi' },
  { code: 'S-0215', name: 'Kemas Plastindo, CV', term: 14, limit: 60000000, npwp: '09.774.205.8-542.000', bank: 'BCA 0190 776 341', city: 'Tangerang', contact: 'Andi Wijaya' },
]
const SUP = Object.fromEntries(SUPPLIERS.map(s => [s.code, s]))

/* articles for bill lines and receipts: SKU shown 8·3, article id beside it */
const ARTICLES = [
  ['00000004', 'Kemeja Linen Pria', 189000], ['00000011', 'Celana Chino Slim', 229000], ['00000018', 'Kaos Polo Basic', 99000], ['00000023', 'Blus Rayon Motif', 149000],
  ['00000031', 'Rok Plisket Midi', 169000], ['00000036', 'Jaket Denim Wanita', 319000], ['00000042', 'Sepatu Sneakers Kanvas', 279000], ['00000047', 'Sandal Kulit Pria', 159000],
  ['00000053', 'Tas Selempang Mini', 199000], ['00000058', 'Gamis Katun Polos', 259000], ['00000064', 'Kaos Anak Karakter', 69000], ['00000071', 'Hijab Voal Segi Empat', 59000],
]
const sku = (a, v) => `${a}·${String(v).padStart(3, '0')}`

/* ── bills (Faktur Pembelian) ── New · Part paid · Lunas; every one from a PO and its receipt */
const BILLS = [
  { no: 'FB/HO/2610/0142', inv: 'INV/GMS/X/0991', sup: 'S-0102', date: '2026-10-21', due: '2026-11-20', po: 'PO-0102-OKT3', bpb: 'BPB-221026-004', total: 28764500, paid: 0, lines: [[0, 60, 120000], [1, 40, 148000], [2, 50, 61400]] },
  { no: 'FB/HO/2610/0131', inv: 'INV/GMS/X/0954', sup: 'S-0102', date: '2026-10-09', due: '2026-11-08', po: 'PO-0102-OKT1', bpb: 'BPB-101026-002', total: 22250000, paid: 0, lines: [[3, 100, 89000], [4, 50, 167000]] },
  { no: 'FB/HO/2610/0128', inv: 'SS-24-1077', sup: 'S-0077', date: '2026-10-02', due: '2026-11-01', po: 'PO-0077-SEP4', bpb: 'BPB-021026-001', total: 76350000, paid: 76350000, paidBy: 'BKK/HO/2610/0059', lines: [[6, 150, 172000], [7, 180, 280000]] },
  { no: 'FB/HO/2609/0117', inv: 'AT/IX/221', sup: 'S-0131', date: '2026-09-23', due: '2026-10-23', po: 'PO-0131-SEP2', bpb: 'BPB-230926-003', total: 12450000, paid: 12450000, paidBy: 'BKK/HO/2610/0056', lines: [[9, 75, 166000]] },
  { no: 'FB/HO/2609/0112', inv: 'LJS/2609/0411', sup: 'S-0118', date: '2026-09-17', due: '2026-11-01', po: 'PO-0118-SEP1', bpb: 'BPB-170926-002', total: 33689000, paid: 33689000, paidBy: 'BKK/HO/2610/0051', lines: [[5, 70, 210000], [8, 95, 199884]] },
  { no: 'FB/HO/2609/0109', inv: 'DT-0926-018', sup: 'S-0144', date: '2026-09-19', due: '2026-10-19', po: 'PO-0144-SEP1', bpb: 'BPB-190926-001', total: 5100000, paid: 0, bounced: 'BKK/HO/2610/0053', lines: [[10, 120, 42500]] },
  { no: 'FB/HO/2610/0137', inv: 'LJS/2610/0502', sup: 'S-0118', date: '2026-10-14', due: '2026-11-28', po: 'PO-0118-OKT2', bpb: 'BPB-141026-005', total: 41820000, paid: 0, lines: [[0, 120, 118500], [11, 400, 69000]] },
  { no: 'FB/HO/2610/0139', inv: 'AT/X/248', sup: 'S-0131', date: '2026-10-17', due: '2026-11-16', po: 'PO-0131-OKT1', bpb: 'BPB-171026-002', total: 18600000, paid: 6000000, lines: [[9, 80, 166000], [3, 60, 88666]] },
  { no: 'FB/HO/2610/0133', inv: 'SK-1026-77', sup: 'S-0045', date: '2026-10-11', due: '2026-10-25', po: 'PO-0045-OKT1', bpb: 'BPB-111026-001', total: 8374200, paid: 8374200, paidBy: 'BKK/HO/2610/0054', nonstock: true, lines: [['Printer struk thermal 80mm', 6, 1395700]] },
  { no: 'FB/HO/2610/0140', inv: 'GC/OKT/2026', sup: 'S-0208', date: '2026-10-18', due: '2026-10-25', po: null, bpb: null, total: 4200000, paid: 4200000, paidBy: 'BKK/HO/2610/0058', nonstock: true, lines: [['Kontrak kebersihan HO + 13 toko, Okt', 1, 4200000]] },
  { no: 'FB/HO/2610/0144', inv: 'KP-2610-031', sup: 'S-0215', date: '2026-10-22', due: '2026-11-05', po: 'PO-0215-OKT1', bpb: 'BPB-221026-006', total: 9870000, paid: 0, nonstock: true, lines: [['Kantong belanja plastik SEDANG', 30000, 329]] },
  { no: 'FB/HO/2610/0145', inv: 'GMS/X/1003', sup: 'S-0102', date: '2026-10-24', due: '2026-11-23', po: 'PO-0102-OKT4', bpb: 'BPB-241026-002', total: 15987000, paid: 0, lines: [[2, 90, 61300], [10, 150, 69800]], matchIssue: 'Invoiced 150 of Kaos Anak Karakter; received 144' },
]
/* purchase returns (Invoice Retur Beli) */
const RETURNS = [
  { no: 'RB/HO/2610/0012', sup: 'S-0131', date: '2026-10-20', bill: 'FB/HO/2609/0117', reason: 'Reject · jahitan lepas', total: 3150000, refundBy: 'BKM/HO/2610/0023', lines: [[9, 19, 165789]] },
  { no: 'RB/HO/2610/0011', sup: 'S-0102', date: '2026-10-12', bill: 'FB/HO/2610/0131', reason: 'Over delivery', total: 1780000, refundBy: null, lines: [[3, 20, 89000]] },
]
const billLeft = b => b.total - b.paid
const billState = b => b.bounced ? ['Giro bounced', 'bad'] : b.paid >= b.total ? ['Lunas', ''] : b.paid > 0 ? ['Part paid', 'warn'] : b.due < TODAY ? ['Overdue', 'bad'] : ['New', 'info']

/* ── vouchers: BKK (money out) and BKM (money in), Klasik ──
   method: cash · transfer · giro.  st: draft · posted · void.  Giro state lives on GIROS. */
const VOUCHERS = {
  bkk: [
    { no: 'BKK/HO/2610/0061', date: '2026-10-27', time: '16:42', party: 'S-0102', acc: 'bca', method: 'giro', giro: '456131', amt: 51014500, st: 'draft', what: '2 bills', settle: [['FB/HO/2610/0131', 22250000], ['FB/HO/2610/0142', 28764500]] },
    { no: 'BKK/HO/2610/0060', date: '2026-10-27', time: '10:15', party: null, acc: 'bca', method: 'transfer', ref: 'PLN-ID 5321 0088', amt: 18452300, st: 'posted', what: 'Listrik 13 toko + HO, Oktober', other: [['6010310006', 'Listrik Oktober · 14 lokasi', 18452300]] },
    { no: 'BKK/HO/2610/0059', date: '2026-10-26', time: '14:03', party: 'S-0077', acc: 'mdr', method: 'giro', giro: '771204', amt: 76350000, st: 'posted', what: '1 bill', settle: [['FB/HO/2610/0128', 76350000]] },
    { no: 'BKK/HO/2610/0058', date: '2026-10-25', time: '09:40', party: 'S-0208', acc: 'bca', method: 'transfer', ref: 'TRF 2510 0091', amt: 4200000, st: 'posted', what: '1 bill', settle: [['FB/HO/2610/0140', 4200000]] },
    { no: 'BKK/HO/2610/0057', date: '2026-10-24', time: '11:20', party: null, acc: 'bca', method: 'transfer', ref: 'TRF 2410 0044', amt: 2000000, st: 'posted', what: 'Isi petty cash C003 Purbalingga', other: [[acc('1011001002', '03'), 'Isi kas kecil toko', 2000000]] },
    { no: 'BKK/HO/2610/0056', date: '2026-10-21', time: '15:55', party: 'S-0131', acc: 'bca', method: 'giro', giro: '456128', amt: 12450000, st: 'posted', what: '1 bill', settle: [['FB/HO/2609/0117', 12450000]] },
    { no: 'BKK/HO/2610/0055', date: '2026-10-21', time: '08:10', party: null, acc: 'bca', method: 'transfer', ref: 'ADM 10/2026', amt: 45000, st: 'posted', what: 'Biaya administrasi BCA', other: [['6010310004', 'Adm bank Oktober', 45000]] },
    { no: 'BKK/HO/2610/0054', date: '2026-10-20', time: '13:31', party: 'S-0045', acc: 'bca', method: 'transfer', ref: 'TRF 2010 0102', amt: 8374200, st: 'posted', what: '1 bill', settle: [['FB/HO/2610/0133', 8374200]] },
    { no: 'BKK/HO/2610/0053', date: '2026-10-16', time: '10:02', party: 'S-0144', acc: 'bri', method: 'giro', giro: '202517', amt: 5100000, st: 'posted', what: '1 bill', settle: [['FB/HO/2609/0109', 5100000]] },
    { no: 'BKK/HO/2610/0052', date: '2026-10-18', time: '17:05', party: null, acc: 'hoc', method: 'cash', amt: 1500000, st: 'posted', what: 'Kasbon Rudi Hartono, kepala toko C005', other: [['1011102002', 'Kasbon · potong gaji November', 1500000]] },
    { no: 'BKK/HO/2610/0051', date: '2026-10-15', time: '16:20', party: 'S-0118', acc: 'bca', method: 'giro', giro: '456127', amt: 33689000, st: 'posted', what: '1 bill', settle: [['FB/HO/2609/0112', 33689000]] },
    { no: 'BKK/HO/2610/0050', date: '2026-10-14', time: '09:12', party: null, acc: 'mdr', method: 'transfer', ref: 'TRF 1410 0017', amt: 45000000, st: 'posted', what: 'Sewa toko C011 Sipin, Nov–Jan', other: [[acc('1011301003', '11'), 'Sewa 3 bulan dibayar dimuka', 45000000]] },
    { no: 'BKK/HO/2610/0049', date: '2026-10-13', time: '14:44', party: 'S-0131', acc: 'bca', method: 'transfer', amt: 6000000, st: 'posted', what: 'Part of 1 bill', settle: [['FB/HO/2610/0139', 6000000]] },
    { no: 'BKK/HO/2610/0048', date: '2026-10-12', time: '10:30', party: 'S-0118', acc: 'bca', method: 'transfer', amt: 33689000, st: 'void', what: 'Voided — paid twice, see 0051', settle: [['FB/HO/2609/0112', 33689000]] },
  ],
  bkm: [
    { no: 'BKM/HO/2610/0024', date: '2026-10-27', time: '08:05', party: null, acc: 'bca', method: 'transfer', ref: 'JASA GIRO 09/26', amt: 1284300, st: 'posted', what: 'Bunga jasa giro BCA, September', other: [['8010110001', 'Jasa giro September', 1284300]] },
    { no: 'BKM/HO/2610/0023', date: '2026-10-25', time: '13:18', party: 'S-0131', acc: 'bca', method: 'transfer', ref: 'AT-RF-1025', amt: 3150000, st: 'posted', what: 'Refund retur RB/HO/2610/0012', offset: [['RB/HO/2610/0012', 3150000]] },
    { no: 'BKM/HO/2610/0022', date: '2026-10-22', time: '15:40', party: null, acc: 'hoc', method: 'cash', amt: 850000, st: 'posted', what: 'Jual kardus bekas gudang', other: [['8010110007', 'Kardus bekas 340 kg', 850000]] },
    { no: 'BKM/HO/2610/0021', date: '2026-10-20', time: '10:25', party: null, acc: 'mdr', method: 'transfer', ref: 'DEP-C007', amt: 10000000, st: 'posted', what: 'Deposit sewa C007 Brebes kembali', other: [['8010110007', 'Pengembalian deposit sewa lama', 10000000]] },
    { no: 'BKM/HO/2610/0020', date: '2026-10-18', time: '09:00', party: null, acc: 'bri', method: 'transfer', ref: 'SEWA ATM Q4', amt: 3600000, st: 'posted', what: 'Sewa tempat ATM C002, Okt–Des', other: [['8010110004', 'Sewa tempat ATM 3 bulan', 3600000]] },
    { no: 'BKM/HO/2610/0019', date: '2026-10-15', time: '16:48', party: null, acc: 'hoc', method: 'cash', amt: 500000, st: 'draft', what: 'Cicilan kasbon Agus Santoso', other: [['1011102001', 'Cicilan 1 dari 3', 500000]] },
  ],
}
const docOf = no => VOUCHERS.bkk.find(v => v.no === no) || VOUCHERS.bkm.find(v => v.no === no)

/* ── giro out (BG Keluar) — every one written by a BKK ──
   Written (BG in the drawer) · With supplier · Cleared · Bounced */
const GIROS = [
  { no: '456131', bank: 'BCA', acc: 'bca', bkk: 'BKK/HO/2610/0061', sup: 'S-0102', amt: 51014500, written: '2026-10-27', due: '2026-11-10', state: 'written' },
  { no: '771204', bank: 'Mandiri', acc: 'mdr', bkk: 'BKK/HO/2610/0059', sup: 'S-0077', amt: 76350000, written: '2026-10-26', given: '2026-10-26', due: '2026-11-02', state: 'with' },
  { no: '456127', bank: 'BCA', acc: 'bca', bkk: 'BKK/HO/2610/0051', sup: 'S-0118', amt: 33689000, written: '2026-10-15', given: '2026-10-16', due: '2026-10-31', state: 'with' },
  { no: '456126', bank: 'BCA', acc: 'bca', bkk: 'BKK/HO/2610/0044', sup: 'S-0102', amt: 19850000, written: '2026-10-08', given: '2026-10-09', due: '2026-10-26', state: 'with', onStatement: true },
  { no: '456128', bank: 'BCA', acc: 'bca', bkk: 'BKK/HO/2610/0056', sup: 'S-0131', amt: 12450000, written: '2026-10-21', given: '2026-10-21', due: '2026-10-23', state: 'cleared', cleared: '2026-10-23' },
  { no: '456122', bank: 'BCA', acc: 'bca', bkk: 'BKK/HO/2610/0031', sup: 'S-0077', amt: 41200000, written: '2026-09-25', given: '2026-09-26', due: '2026-10-10', state: 'cleared', cleared: '2026-10-10' },
  { no: '771198', bank: 'Mandiri', acc: 'mdr', bkk: 'BKK/HO/2610/0027', sup: 'S-0118', amt: 27900000, written: '2026-09-22', given: '2026-09-23', due: '2026-10-07', state: 'cleared', cleared: '2026-10-07' },
  { no: '202517', bank: 'BRI', acc: 'bri', bkk: 'BKK/HO/2610/0053', sup: 'S-0144', amt: 5100000, written: '2026-10-16', given: '2026-10-16', due: '2026-10-20', state: 'bounced', bounced: '2026-10-21', why: 'Saldo tidak cukup pada tanggal efektif' },
]
/* giros that were still out when the books opened (Saldo Awal BG, 1 Oct 2026) */
const GIRO_OPENING = [
  { no: '456119', bank: 'BCA', sup: 'S-0102', amt: 23400000, due: '2026-10-03', state: 'cleared', cleared: '2026-10-03' },
  { no: '771190', bank: 'Mandiri', sup: 'S-0131', amt: 9600000, due: '2026-10-05', state: 'cleared', cleared: '2026-10-05' },
]

/* ── stores: one close per shop per day ── tenders: cash · debit · credit · QRIS on the shop's EDC bank */
const MDR = { debitOn: .0015, debitOff: .01, credit: .018, qris: .007 }
const DAYS = {}
function closeOf(date, code) {
  const k = date + code
  if (DAYS[k]) return DAYS[k]
  const s = STORE[code], i = STORES.indexOf(s)
  SEED = Number(date.replace(/-/g, '')) % 100000 * 31 + i * 977 + 13
  const wk = weekday(date), boost = wk === 'Sat' || wk === 'Sun' ? 1.45 : 1
  const gross = round((6e6 + rnd() * 18e6) * boost, 1000)
  const share = { cash: .3 + rnd() * .15, debit: .22 + rnd() * .1, credit: .08 + rnd() * .06 }
  share.qris = Math.max(.08, 1 - share.cash - share.debit - share.credit)
  const t = {}
  Object.keys(share).forEach(m => { t[m] = round(gross * share[m], 500) })
  t.qris = gross - t.cash - t.debit - t.credit
  /* no money goes back over the counter: a return is an exchange (the piece is swapped, the
     customer may top up the difference); a void cancels a receipt before the day is closed */
  const exchN = rnd() < .5 ? 1 + Math.floor(rnd() * 2) : 0
  const exchVal = exchN ? round(150000 + rnd() * 250000, 1000) * exchN : 0
  const topUp = exchN && rnd() < .5 ? round(20000 + rnd() * 60000, 1000) : 0
  const voidsN = rnd() < .35 ? 1 + (rnd() < .3 ? 1 : 0) : 0
  const voidAmt = voidsN ? round(100000 + rnd() * 300000, 1000) * voidsN : 0
  const receipts = Math.max(8, Math.round(gross / (210000 + rnd() * 90000)))
  const cashExp = t.cash
  const yesterday = addDays(TODAY, -1)
  let diff = 0, state = 'posted'
  if (date === yesterday) {
    state = ['C004', 'C009'].includes(code) ? 'diff' : code === 'C012' ? 'open' : ['C002', 'C006', 'C011'].includes(code) ? 'ready' : 'posted'
    diff = code === 'C004' ? -50000 : code === 'C009' ? 20000 : 0
  } else if (date === addDays(TODAY, -2) && code === 'C012') { state = 'posted' }
  const cashiers = 2 + (gross > 15e6 ? 1 : 0)
  return DAYS[k] = { date, code, gross, t, returns: 0, returnsN: 0, exchN, exchVal, topUp, voidsN, voidAmt, voids: voidsN, receipts, cashExp, counted: state === 'open' ? null : cashExp + diff, diff, state, cashiers, tax: Math.round(gross * 11 / 111), closedAt: state === 'open' ? null : `${21 + Math.floor(rnd() * 2)}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`, by: PEOPLE[i] }
}
const CLOSE_WORD = { posted: ['Posted', ''], ready: ['Ready to post', 'info'], diff: ['Difference', 'warn'], open: ['Not closed', 'bad'] }
/* the money the EDC bank owes for a shop's day: card + QRIS, credited H+1 net of the fee (on-us debit) */
function edcOf(date, code) {
  const d = closeOf(date, code)
  const fee = Math.round(d.t.debit * MDR.debitOn + d.t.credit * MDR.credit + (d.t.qris > 0 ? d.t.qris * MDR.qris : 0))
  return { gross: d.t.debit + d.t.credit + d.t.qris, fee, net: d.t.debit + d.t.credit + d.t.qris - fee, credit: addDays(date, 1) }
}
/* receipts of a shop's day — drawn when the day is opened */
function receiptsOf(date, code) {
  const d = closeOf(date, code), out = []
  SEED = Number(date.slice(-2)) * 101 + STORES.indexOf(STORE[code]) * 7 + 3
  let left = d.gross, n = 0
  const methods = [['Cash', d.t.cash], [`Debit ${STORE[code].edc}`, d.t.debit], [`Credit ${STORE[code].edc}`, d.t.credit], [`QRIS ${STORE[code].edc}`, d.t.qris]]
  while (n < Math.min(d.receipts, 14)) {
    const lines = [], k = 1 + Math.floor(rnd() * 3)
    for (let j = 0; j < k; j++) { const a = pick(ARTICLES); const qty = rnd() < .8 ? 1 : 2; const disc = rnd() < .25 ? .1 : 0; lines.push({ a, v: 100 + Math.floor(rnd() * 8), qty, price: a[2], disc: Math.round(a[2] * qty * disc) }) }
    const total = lines.reduce((x, l) => x + l.a[2] * l.qty - l.disc, 0)
    const m = pick(methods)[0]
    const hh = 10 + Math.floor(n * 11 / 14), mm = Math.floor(rnd() * 60)
    out.push({ no: `${code}-${date.slice(2).replace(/-/g, '')}-${String(n + 1).padStart(4, '0')}`, time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, cashier: PEOPLE[(STORES.indexOf(STORE[code]) + (n % 2)) % PEOPLE.length], method: m, lines, total, member: rnd() < .35 ? `M-${String(10000 + Math.floor(rnd() * 89999))}` : null })
    left -= total; n++
  }
  return out
}

/* the ⌘K index: document numbers land on their screen */
window.PAL_DOCS = [
  ...VOUCHERS.bkk.map(v => ({ doc: 1, t: v.no, g: 'BKK', go: () => openDoc('bkk', v.no) })),
  ...VOUCHERS.bkm.map(v => ({ doc: 1, t: v.no, g: 'BKM', go: () => openDoc('bkm', v.no) })),
  ...BILLS.map(b => ({ doc: 1, t: `${b.no} · ${SUP[b.sup].name}`, g: 'Bills', go: () => { go('bills'); setTimeout(() => window.openBill && openBill(b.no), 30) } })),
  ...GIROS.map(g => ({ doc: 1, t: `BG ${g.no} · ${SUP[g.sup].name}`, g: 'Giro', go: () => { go('giro'); setTimeout(() => window.openGiro && openGiro(g.no), 30) } })),
]
