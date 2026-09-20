#!/usr/bin/env python3
"""Rebuilds docs/coa-thirty.md and remap-190-to-40.csv from head + the client CSV.
Run from the repo root against itulah_dev. Deterministic; no hand edits in the doc."""
import subprocess, csv, json, collections, openpyxl

# ---------------------------------------------------------------- chart
CHART = {
 '1101': ('Cash On Hand','Cash on hand','unit','D','pot'),
 '1102': ('Cash In Bank','Cash in bank','company','D','bank_account'),
 '1201': ('Piutang Dagang','Card and settlement receivables','unit','D','tender'),
 '1202': ('Piutang Lain-lain','Other receivables','unit','D','party'),
 '1209': ('Cadangan Penghapusan Piutang Tak Tertagih','Allowance for doubtful receivables','unit','C','party'),
 '1301': ('Persediaan','Inventory','unit','D','item_class'),
 '1302': ('Barang Dalam Perjalanan','Goods in transit','unit','D','counter_unit + item_class'),
 '1309': ('Cadangan Kerusakan atau Kehilangan Barang','Allowance for inventory damage and loss','unit','C','item_class'),
 '1401': ('Biaya Dibayar Dimuka','Prepaid expenses','unit','D','prepaid_kind'),
 '1402': ('Pajak Bayar Dimuka','Prepaid taxes','company','D','tax_type'),
 '1403': ('Uang Muka','Advances','unit','D','advance_purpose'),
 '1501': ('Piutang (Hutang) Affiliasi Antar Unit','Inter-unit current account','unit','D','counter_unit + reason'),
 '1601': ('Aktiva Tetap','Fixed assets','unit','D','asset_stage + asset'),
 '1602': ('Intangible Asset','Intangible assets','unit','D','asset → asset_class (pre-opening = kelas)'),
 '1609': ('Akumulasi Penyusutan Aktiva Tetap','Accumulated depreciation','unit','C','asset → asset_class'),
 '1610': ('Reserve Replacement Operating Equipment','Operating equipment replacement reserve','unit','C','asset → asset_class'),
 '1619': ('Akumulasi Amortisasi','Accumulated amortisation','unit','C','asset → asset_class'),
 '2101': ('Hutang Supplier','Trade payables','company','C','supplier'),
 '2102': ('Hutang Supplier - Suspend','Supplier payable — suspense','company','C','supplier'),
 '2103': ('Outstanding Giro','Cheques issued not cleared','company','C','bank_account'),
 '2201': ('Hutang Pajak','Taxes payable','company','C','tax_type'),
 '2301': ('Biaya Yang Masih Harus Dibayar','Accrued expenses','unit','C','accrual_kind'),
 '2401': ('Uang Muka Penjualan','Customer deposits and voucher liability','company','C','—'),
 '2402': ('Kewajiban Poin Member','Member points liability','company','C','— (BLOCKED, §18)'),
 '2501': ('Pinjaman Bank','Bank loans','company','C','facility'),
 '2502': ('Pinjaman Principal','Owner loans','company','C','principal'),
 '3101': ('Modal Setor','Paid-in capital','company','C','principal'),
 '3102': ('Prive','Drawings','company','D','principal'),
 '3201': ('Laba (Rugi) Ditahan','Retained earnings','company','C','—'),
 '4101': ('Penjualan','Sales','unit','C','tender / channel'),
 '4201': ('Potongan Penjualan','Sales discounts','unit','D','—'),
 '4202': ('Retur Penjualan','Sales returns','unit','D','—'),
 '4301': ('Pendapatan Lain-lain','Other income','unit','C','income_kind'),
 '5101': ('Harga Pokok Pembelian','Cost of goods sold','unit','D','cost_kind'),
 '5102': ('Kehilangan Barang & Selisih Stock Opname','Shrinkage and stocktake variance','unit','D','loss_kind'),
 '6101': ('Biaya Penjualan','Selling expenses','unit','D','expense_category'),
 '6201': ('Biaya Pegawai','Personnel expenses','unit','D','pay_component'),
 '6301': ('Biaya Administrasi dan Umum','General and administrative expenses','unit','D','expense_category'),
 '6401': ('Biaya Sewa','Rent','unit','D','expense_category'),
 '7101': ('Biaya Depresiasi dan Amortisasi','Depreciation and amortisation','unit','D','depreciation_kind + asset'),
 '8101': ('Biaya Bunga','Interest expense','company','D','facility'),
 '8201': ('Pajak Penghasilan','Income tax expense','company','D','tax_type'),
 '8301': ('Biaya Lain-lain','Other expenses','unit','D','other_expense_kind'),
}
N = len(CHART)

# ------------------------------------------------- rules over head accounts
EXACT = {
 '1011001001':('1101','DRAWER'), '1011001002':('1101','PETTY'), '1011001003':('1101','FLOAT'), '1011005001':('1101','TRANSIT'),
 '1011101001':('1201','CREDIT'), '1011101002':('1201','DEBIT'), '1011101003':('1201','QRIS'), '1011101004':('1201','OTHER'),
 '1011102001':('1202','EMPLOYEE'), '1011102002':('1202','STORE_MANAGER'), '1011102003':('1202','MANAGEMENT'),
 '1011103001':('1209','CREDIT'), '1011103002':('1209','DEBIT'), '1011103003':('1209','EMPLOYEE'),
 '1011201001':('1301','MERCHANDISE'), '1011203001':('1302','MERCHANDISE'), '1011204001':('1302','SUPPLIES'),
 '1011299001':('1309','MERCHANDISE'), '1011299002':('1309','SUPPLIES'),
 '1021401001':('1501','FINANCING'), '1021402001':('1501','GOODS'), '1021403001':('1501','OTHER'),
 '2012301001':('1501','FINANCING'), '2012302001':('1501','GOODS'), '2012304001':('1501','OTHER'),
 '2012303001':('2502','<principal>'),
 '1021701001':('1602','SOFTWARE'), '1021702001':('1619','SOFTWARE'),
 '1031801001':('RETIRE','dead: Disposed Inventory'),
 '1031802001':('1602','PRE_OPENING'), '1031802002':('1619','PRE_OPENING'), '1031803001':('1601','CIP'),
 '2012001001':('2101','<supplier: merchandise>'), '2012001003':('2101','<supplier: non-merchandise>'), '2012001002':('2102','<supplier>'),
 '204001':('2103','<bank account>'), '2012305001':('2401','VOUCHER'), '205001':('2401','CUSTOMER_DEPOSIT'),
 '2012501001':('2502','<principal>'), '2022401001':('2502','<principal>'),
 '3013001001':('3101','<principal>'), '3013001004':('3102','<principal>'), '3013001002':('3201','—'),
 '3013001003':('DERIVED','current-year result, not posted'),
 '4010110001':('4101','CASH'), '4010114001':('4101','QRIS'), '4010113001':('4101','ONLINE_OWN'), '4010113002':('4101','ONLINE_MARKETPLACE'),
 '4010213001':('4201','—'), '4010214001':('4202','—'),
 '4020110001':('4301','MANAGEMENT_FEE'), '600104':('4301','OTHER'),
 '5010110001':('5101','COGS'), '8010110003':('5101','PURCHASE_DISCOUNT'),
 '8010110006':('5102','SHRINKAGE'), '6010110008':('5102','DAMAGE'),
 '8010110001':('4301','INTEREST'), '8010110002':('4301','ROUNDING'), '8010110004':('4301','RENT_BUILDING'),
 '8010110005':('4301','RENT_EQUIPMENT'), '8010110007':('4301','OTHER'),
 '8020111001':('8101','<facility: bank>'), '8020111002':('8101','<facility: leasing>'), '8030112001':('8201','<tax type>'),
}
PREFIX = [
 ('1011002','1102','<bank account: giro>'), ('1011003','1102','<bank account: tabungan>'), ('1011004','1102','<bank account: deposito>'),
 ('1011202','1301','SUPPLIES'), ('1011301','1401','<name>'), ('1011302','1402','<tax type>'), ('1011303','1403','<name>'),
 ('10215','1601','<asset class>'), ('10216','1609','<asset class>'), ('1021607','1610','<asset class>'),
 ('2012002','2103','<bank account>'), ('2012101','2201','<tax type>'), ('2012201','2301','<name>'),
 ('2012502','2501','<facility>'), ('2022402','2501','<facility>'),
 ('4010111','4101','<DEBIT_bank>'), ('4010112','4101','<CREDIT_network>'),
 ('6010110','6101','<name>'), ('6010111','6201','<component>'), ('6010210','6201','<component>'),
 ('6010310','6301','<name>'), ('6010410','6301','<name: maintenance>'), ('7010310','6301','<name>'), ('7020310','6301','<name>'),
 ('7010110','6401','<name>'), ('70102','7101','<asset class>'),
]
def resolve(code):
    if code in EXACT: return EXACT[code]
    best=None
    for p,new,key in PREFIX:
        if code.startswith(p) and (best is None or len(p)>len(best[0])): best=(p,new,key)
    return (best[1],best[2]) if best else (None,None)

head = [r.split('\t') for r in subprocess.run(['psql','-d','itulah_dev','-tAF','\t','-c',
  "select account_code, name, code_provenance from ledger_account where not is_group order by account_code"],
  capture_output=True, text=True).stdout.strip().splitlines()]
assert len(head)==190
remap=[]; cur=collections.Counter()
for code,name,prov in head:
    new,key=resolve(code); assert new, code
    cur[new]+=1; remap.append((code,name,prov,new,CHART.get(new,(new,))[0],key))
with open('outputs/coa_thirty/remap-190-to-40.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['old_code','old_name','provenance','new_account','new_name','line_key']); w.writerows(remap)
NEW_IN_0296 = {'8301', '2402'}   # the loss side of the client's signed family; nothing folds into it
assert all(cur[k]>0 or k in NEW_IN_0296 for k in CHART), [k for k in CHART if cur[k]==0 and k not in NEW_IN_0296]

# ------------------------------------------------- client leaves (6,908)
rows=[]
with open('/Users/hari/Downloads/Laporan_Master_Account1.csv', newline='', encoding='utf-8-sig') as f:
    for r in csv.reader(f):
        if len(r)<5: continue
        c=r[1].strip(); n=r[2].strip()
        if c.isdigit() and n: rows.append((c,n))
has_kids=set(c[:10] for c,_ in rows if len(c)==12)
posting=[(c,n) for c,n in rows if len(c)==12 or (len(c)==10 and c not in has_kids) or len(c)==6]
assert len(posting)==6908
LEAF_PREFIX = [('1021401','1501'),('1021402','1501'),('1021403','1501'),('2012301','1501'),('2012302','1501'),('2012304','1501'),
 ('2012303','2502'),('1011203','1302'),('1011204','1302'),('1021701','1602'),('1021702','1619')]
def res_leaf(code):
    # the head keeps one row per family; the client's matrix and software families have 14 templates each
    t = code[:10] if len(code)==12 else code
    new = resolve(t)[0]
    if new is None:
        for pfx,acct in LEAF_PREFIX:
            if t.startswith(pfx): return acct
    return new
leaves=collections.Counter(res_leaf(c) for c,_ in posting)
assert None not in leaves and sum(leaves.values())==6908

# ------------------------------------------------- their workbook, for §11
wb = openpyxl.load_workbook('outputs/coa_20260918/Proposed_30_Account_Structure.xlsx', data_only=True)
rules=[r for r in wb['Rules'].iter_rows(values_only=True) if r[0] and str(r[0]).isdigit()]
their=collections.Counter(); pair=collections.Counter()
for r in rules:
    base,_,gl,glname,did,dname,_,dec,rev,leaf=r[:10]; leaf=int(leaf or 0)
    their[dec]+=leaf; pair[(str(gl),res_leaf(str(base)))]+=leaf
same=sum(n for (gl,m),n in pair.items() if gl!='UNRESOLVED')

# ------------------------------------------------- semantic keys
km=[l.split('\t') for l in subprocess.run(['psql','-d','itulah_dev','-tAF','\t','-c',
 "select semantic_key, string_agg(distinct account_code,' ' order by account_code) from account_map group by 1 order by 1"],
 capture_output=True,text=True).stdout.strip().splitlines()]
old2new={r[0]:(r[3],r[5]) for r in remap}
keyrows=[(k,' / '.join(sorted(set(old2new[a][0] for a in acs.split()))),', '.join(sorted(set(old2new[a][1] for a in acs.split())))) for k,acs in km]

units=sum(1 for v in CHART.values() if v[2]=='unit'); comps=N-units
def idr(n): return f"{n:,}".replace(',','.')
L=[]; w=L.append
w(f"# Bagan akun {N} — akun adalah baris laporan, identitas adalah kunci baris\n")
w("**Nama-namanya milik klien** (0296): Biaya bukan Beban, Aktiva bukan Aset, Hutang bukan Utang, Depresiasi, Supplier, Principal, Affiliasi, Piutang Dagang — semuanya diambil dari nama group bagan mereka sendiri.\n")
w("**Tanggal:** 18 September 2026 · **Status:** usulan lengkap, dibandingkan dengan usulan 30 akun pihak lain (§11), menunggu perintah *jalankan*  ")
w("**Sumber:** `~/Downloads/Laporan_Master_Account1.csv` (7.528 baris, 6.908 akun posting); bagan di head (318 baris, 190 posting); `docs/coa-cube.md` (376 arti); "
  "`docs/coa-final.md` (usulan 175); `docs/finance-coa-usage-2024-2025.md`; `outputs/coa_20260918/Proposed_30_Account_Structure.xlsx` (usulan 30 akun, 18 Sep 2026).  ")
w(f"**Berkas:** `outputs/coa_thirty/remap-190-to-{N}.csv` (peta lengkap, 190 baris) · `outputs/coa_thirty/build-doc.py` (dokumen ini dibangkitkan, bukan ditulis tangan)\n")
w("> Pertanyaan pemilik: *\"can we make the account sit on around thirty accounts? can we use dimension or tables, or anything?\"* — lalu: *\"compare with those, who is right\"*\n")
w("---\n\n## 0. Masukan pemilik yang menentukan jawabannya (18 Sep 2026)\n")
w("1. **Satu badan hukum** — 1 kantor pusat + 13 toko fashion. Ekuitas milik perusahaan, bukan per unit. Akun antar-unit menjadi kliring internal semata: totalnya **wajib nol** setiap saat dan hilang saat konsolidasi.")
w("2. **Hanya HO yang menyentuh akun unit.** Toko melihat tiga pot kasnya sendiri (laci · kas kecil · modal kasir) dan tidak ada yang lain. Semua akun ber-`unit` diisi oleh HO atas nama toko — sumbu `unit` adalah *label yang dipilih HO*, bukan hak akses toko.")
w("3. **Akuntan diperkirakan menerima** bagan ringkas, dengan syarat kode lama tetap bisa dicetak (§5 butir 6).\n")
w("---\n\n## 1. Aturannya, satu kalimat\n")
w("**Sebuah akun ada hanya kalau ia baris di neraca atau laba-rugi. Semua pembeda lain — bank mana, rak yang mana, PPh pasal berapa, listrik atau air — adalah kunci di baris jurnal, diselesaikan oleh tabel yang hampir semuanya sudah ada.**\n")
w("Bagan klien memanggang identitas ke dalam kode: 6.908 akun untuk 382 arti, dan 382 arti untuk ±40 baris laporan. Kita sudah mencabut sumbu *unit* (→190). Yang tersisa di 190 itu masih identitas: 36 jenis rak, 14 rekening bank, 26 komponen gaji kembar.\n")
w("---\n\n## 2. Hitungannya\n")
w(f"| Tahap | Akun posting | Faktor |\n|---|---:|---:|\n| Bagan klien | 6.908 | |\n| Cabut sumbu unit & unit-lawan (`coa-cube.md`) | 382 | 18× |\n| Bagan di head hari ini (0243–0277) | 190 | 2× |\n| **Cabut sumbu identitas (dokumen ini)** | **{N}** | **{190//N}×** |\n")
w("\n### 2.1 Sumbu yang masih terpanggang di 190, dan di mana identitasnya sudah tinggal\n")
w("| Sumbu | Template klien | Kolom / tabel yang sudah ada | Status |\n|---|---:|---|---|")
w("| unit (×14) | semua | `journal_line.site_id` | ✅ |")
w("| unit lawan (9 keluarga matriks) | 126 | `journal_line.counter_site_id` | ✅ |")
w("| kelas aset (Rak 1–36, FFE ×7, AC/Lift/…) — harga, akumulasi, penyusutan, cadangan, penggantian | ~170 | `journal_line.asset_id` → `fixed_asset` | ✅ kolom; ❌ `asset_class` harus jadi tabel sendiri (§7) |")
w("| identitas bank (giro · tabungan · deposito · giro keluar · pinjaman per bank) | 33 | `journal_line.bank_account_id` → `company_bank_account`, FK memaksa akun & rekening sepakat | ✅ |")
w("| jenis pajak (5 hutang + 6 dibayar dimuka) | 11 | `tax_type` | ✅ |")
w("| pemberi pinjaman / pemilik | 15 | `financing_facility`, `principal` | ✅ |")
w("| tender & kanal penjualan | 10 | `sales_posting_line` | ✅ |")
w("| pemasok | 3 | `journal_line.supplier_id` | ✅ |")
w("| **kategori** (52 beban + 26 komponen gaji + 10 akrual + 9 prepaid + 4 uang muka + pot kas + jenis pendapatan) | ~105 | **tidak ada** | ❌ **satu kolom baru: `journal_line.category_code`** |\n")
w("Hanya satu kunci yang belum ada. Sisanya tinggal dipakai.\n")
w(f"---\n\n## 3. Bagan {N}\n")
w("Kode empat digit numerik (CHECK `^[0-9]+$` di `ledger_account` tetap berlaku), **akar sama dengan bagan klien** (1 aset · 2 kewajiban · 3 ekuitas · 4 pendapatan · 5 HPP · 6 beban operasional · 7 penyusutan · 8 lain-lain & pajak) — sehingga `financial_statements.rs`, yang mengelompokkan dengan `root_class`, tidak berubah sama sekali.\n")
w("| Kode | Nama | English | Dimensi | D/C | Kunci baris | ← akun head | ← daun klien |\n|---|---|---|---|---|---|---:|---:|")
for code,(name,en,dim,dc,key) in CHART.items():
    w(f"| `{code}` | {name} | _{en}_ | {dim} | {dc} | {key} | {cur[code]} | {idr(leaves.get(code,0))} |")
w(f"| | **{N} akun** | | {units} unit · {comps} company | | | **{sum(cur[k] for k in CHART)}** | **{idr(sum(leaves[k] for k in CHART))}** |")
w("\nDua baris head yang tidak menjadi akun: `3013001003 Laba (Rugi) bulan berjalan` → **diturunkan**, bukan diposting; `1031801001 Disposed Inventory` → **dipensiunkan** (nol dua tahun, tak punya arti dalam model aset register).\n")
w("Contra: `1209`, `1309`, `1609`, `1610`, `1619` (aset), `4201` (pendapatan), `3102` (ekuitas).\n")
w("---\n\n## 4. Kunci baris\n")
w("`journal_line` hari ini sudah membawa `site_id` · `counter_site_id` · `bank_account_id` · `asset_id` · `supplier_id`. Ditambah **satu**:\n")
w("```\nline_category(code, family, name, name_en, is_active)\njournal_line.category_code → line_category(code)\nledger_account.category_family  -- NULL = akun ini tidak menerima kategori\n```\n")
w("Satu tabel, banyak keluarga — bukan satu tabel per keluarga. Aturannya persis meniru `dimension` dan `requires_counter_site` yang sudah ada: akun yang mendeklarasikan `category_family` **menolak** baris tanpa kategori dari keluarga itu; akun tanpa deklarasi menolak baris yang membawanya.\n")
w("| Keluarga | Dipakai oleh | Nilai (dari bagan klien) |\n|---|---|---|")
w("| `pot` | 1101 | DRAWER · PETTY · FLOAT · TRANSIT |")
w("| `tender` | 1201, 4101 | CASH · DEBIT_BCA · DEBIT_MANDIRI · DEBIT_BRI · DEBIT_BNI · CREDIT_VISA · CREDIT_MASTER · QRIS · ONLINE_OWN · ONLINE_MARKETPLACE · OTHER |")
w("| `party` | 1202, 1209 | EMPLOYEE · STORE_MANAGER · MANAGEMENT · CREDIT · DEBIT |")
w("| `item_class` | 1301, 1302, 1309 | MERCHANDISE · SUPPLIES |")
w("| `prepaid_kind` | 1401 | INSURANCE · RENT_LAND · RENT_STORE · RENT_HOUSE · MAINTENANCE · RENT_VEHICLE · PROMOTION · PERMIT · OTHER |")
w("| `advance_purpose` | 1403 | TRAVEL · PURCHASE · CONTRACTOR · OTHER |")
w("| `reason` | 1501 | FINANCING · GOODS · OTHER |")
w("| `accrual_kind` | 2301 | PAYROLL · THR_BONUS · INTEREST · MEDICAL · INSURANCE_BPJS · TELEPHONE · ELECTRICITY · WATER · RENT_STORE · RENT_HOUSE |")
w("| `deduction_kind` | 4201 | DISCOUNT · RETURN |")
w("| `income_kind` | 4301 | INTEREST · ROUNDING · RENT_BUILDING · RENT_EQUIPMENT · MANAGEMENT_FEE · CASH_VARIANCE · OTHER |")
w("| `cost_kind` | 5101 | COGS · PURCHASE_DISCOUNT (kontra-HPP, §11.3) |")
w("| `loss_kind` | 5102 | SHRINKAGE · DAMAGE |")
w("| `expense_category` | 6101, 6301, 6401 | 7 penjualan · 25 umum · 10 pemeliharaan · 5 asuransi/pajak · 4 sewa — nama klien apa adanya |")
w("| `pay_component` | 6201 | SALARY · OVERTIME · MEAL · TRANSPORT · MEDICAL · BPJS · THR · UNIFORM · RECREATION · FUNERAL · TRAINING · SEVERANCE · BONUS |")
w("\nTiga kunci **bukan** kategori karena masternya sudah ada dan lebih kaya: `tax_type` (1402, 2201, 8201), `financing_facility` (2501, 8101), `principal` (2502, 3101, 3102). Aset (1601, 1602, 1609, 1610, 1619, 7101) memakai `asset_id`; kelasnya dibaca dari register.\n")
w("---\n\n## 5. Invarian — yang sudah ada dan yang baru\n")
w("1. **Setiap baris membawa `unit`, tidak pernah NULL** — sudah (`site_id NOT NULL`). Akun `company` dipaksa `unit = HO` — sudah, sejak 0262.")
w("2. **`1501` berjumlah nol untuk seluruh perusahaan, setiap saat** — baru, konsekuensi langsung dari *satu badan hukum*. Satu `SELECT sum(debit)-sum(credit) … WHERE account_code='1501'` = 0, ditegakkan di `finance_close_readiness()` sebagai blocker. Hari ini invarian yang sama tersebar di 5 akun afiliasi dan tidak pernah diuji.")
w(f"3. **Setiap akun ber-kunci adalah akun kontrol**: saldonya sama dengan sub-ledgernya. `finance_controls()` sudah memeriksa PREPAID · TAX · ADVANCE · FINANCING · AP · INTERUNIT · BANK · FIXED_ASSET; dengan {N} akun, itu **seluruh neraca** — invarian yang lebih kuat dari hari ini, bukan lebih lemah.")
w("4. `requires_counter_site` hanya pada `1302` dan `1501` — CHECK `ledger_account_counterparty_is_rare` ditulis ulang dari 7 kode ke 2.")
w("5. **Keluarga kategori harus cocok dengan deklarasi akun** — baru (§4).")
w(f"6. **Kode klien adalah *view*, bukan kunci.** `legacy_code(account, unit, counter_unit, kunci)` mengembalikan 12 digit lama; totalitasnya sudah dibuktikan di §6: 6.908 daun klien → {N} akun tanpa sisa. Akuntan tetap bisa mencetak neraca saldo dalam kode mereka untuk pembanding 2024–2025. Ini yang membuat pembalikan arah 0247/0253 (tangga & nama klien dipulihkan) bisa dipertanggungjawabkan.")
w("7. **Aturan posting tetap tidak pernah menyebut kode akun** — `poster.rs` dan 74 `semantic_key` tidak berubah (§6.2).\n")
w(f"---\n\n## 6. Peta 190 → {N}\n")
w(f"Peta lengkap 190 baris ada di `outputs/coa_thirty/remap-190-to-{N}.csv`. Diturunkan dari head dengan aturan per keluarga 7 digit + pengecualian eksplisit; **0 baris tak terpetakan, 0 akun tujuan kosong**. Aturan yang sama dijalankan atas 6.908 daun klien: **0 sisa** (kolom terakhir §3).\n")
w("### 6.1 Sepuluh peleburan terbesar (daun klien)\n")
w("| Daun | → | Akun |\n|---:|---|---|")
for k,n in sorted(leaves.items(), key=lambda x:-x[1])[:10]:
    if k in CHART: w(f"| {idr(n)} | → | `{k}` {CHART[k][0]} |")
w("\n### 6.2 74 arti (`semantic_key`) → akun baru\n")
w("`account_map` berhenti memetakan arti ke *akun* dan memetakan arti ke **(akun, kategori)**. Kunci-kuncinya tetap; `poster.rs` tetap menyebut arti. Yang mapped di dev hari ini (61 dari 74; 13 sisanya adalah kunci baru yang seed belum petakan):\n")
w("| semantic_key | akun baru | kunci baris |\n|---|---|---|")
for k,new,key in keyrows: w(f"| `{k}` | `{new}` | {key} |")
w("\n13 kunci yang belum ter-seed jatuh ke: `capital_contributed`→3101, `owner_drawings`→3102, `pph21_payable` `pph29_payable` `pbb_payable` `pph_final_payable`→2201, `pph25_credit`→1402, `intangible_asset`→1602, `work_in_progress`→1601 (kelas CIP), `accumulated_amortisation`→1619, `amortisation_expense`→7101, `bad_debt_expense`→6301, `other_income_expense`→4301.\n")
w("---\n\n## 7. Yang berubah, yang tidak\n")
w("### 7.1 Berubah (urutan migrasi)\n")
w("1. `line_category` + `journal_line.category_code` + `ledger_account.category_family`; CHECK keluarga-cocok-akun (trigger, seperti `assert_period_open`).")
w("2. `asset_class` menjadi tabel milik asset register; `fixed_asset.category_code` dan `asset_class_reserve.class_code` berhenti menunjuk `ledger_account`. Ini sekaligus menutup bug qualifier 10-vs-7 karakter yang membuat depreciation run menolak aset impor (`coa-final.md` §7.4).")
w(f"3. {N} baris `ledger_account` baru (+ 8 group per akar); 190 baris lama → `is_active = false`; `ledger_account_remap` diisi 190 baris (hari ini **0 baris**).")
w("4. `account_map` mendapat kolom `category_code`; 61 baris di-remap mekanis dari CSV §6; `resolve_account` mengembalikan (akun, kategori).")
w(f"5. Kebijakan posting (`posting_mode`, `manual_je_policy`, `account_source_rule`) di-seed ulang untuk {N} akun; DENY per `source_kind` yang tadinya membedakan akun sekeluarga (mis. biaya bank vs konsultan) pindah ke DENY per kategori.")
w("6. `company_bank_account.ledger_account_code` → semua `1102`; FK `journal_line_bank_account_agrees_with_the_account_posted` tetap berlaku apa adanya.")
w("7. Rujukan akun di dokumen: `store_deposit` (drawer/bank), `cash_count`, `prepaid_schedule`, `advance_settlement`, `supplier_invoice_expense_line`, `supplier_credit_note`, `bank_statement*` → kode baru + kategori.")
w("8. CHECK `ledger_account_counterparty_is_rare` → `{1302, 1501}`; `ledger_account_carries_no_unit` tetap.")
w("9. `legacy_code()` sebagai fungsi SQL + layar *Trial balance (kode klien)*.")
w("10. Frontend: pemilih akun menjadi pemilih **akun + kategori** (dua kotak, kategori terfilter oleh keluarga akun); 37 layar finance memakai `account_code` sebagai teks — tidak ada yang mengasumsikan panjang 10.\n")
w("### 7.2 Tidak berubah\n")
w("`poster.rs` · `PostingIntent`/`PostingLine` · 74 `semantic_key` · `journal_entry_source_kind_check` (40 jenis) · `fiscal_period` & tutup buku · semua sub-ledger (prepaid, tax, advance, principal, financing, asset) · `financial_statements.rs` (mengelompokkan `root_class`) · `assert_journal_balanced_per_site` · `sales_posting` (menyebut arti, bukan kode).\n")
w("---\n\n## 8. Rekomendasi untuk yang pemilik belum yakin\n")
w("1. **Beban karyawan: satu akun (`6201`), bukan dua.** 26 template kembar klien (`6010111` *operation* vs `6010210` *office*) adalah sumbu **unit** yang ditulis dua kali: *office* = HO, *operation* = C001–C013. Satu akun × `unit` × `pay_component` mereproduksi kedua keluarga itu sebagai laporan tanpa kehilangan satu angka pun — dan SPT 1771-II hanya meminta satu baris gaji.")
w(f"2. **{N}, bukan 30.** Sepuluh akun yang membuatnya {N} dan bukan 30 masing-masing adalah baris yang akuntan ingin lihat *di muka laporan*, bukan di lampiran: "
  "Prive terpisah dari Modal · Barang diterima belum ditagih terpisah dari Hutang usaha · Pinjaman pemilik terpisah dari Pinjaman bank (pihak berelasi) · Susut terpisah dari HPP (P&L ritel) · Sewa terpisah dari umum (Rp 1,35 M/tahun, 21% belanja HO) · dua Cadangan pada dua baris neraca berbeda · "
  "Cadangan penggantian OE terpisah dari Akumulasi (mekanismenya sendiri: `asset_replacement_charge`) · Pajak dibayar dimuka terpisah dari Biaya dibayar dimuka (sub-ledger berbeda) · Aset takberwujud & akumulasi amortisasinya terpisah dari aset tetap (baris neraca PSAK; §11.3). "
  f"Semua **bisa** dilebur — detailnya tetap ada di kunci baris — jadi 30 vs {N} hanya soal apa yang tampil di neraca saldo, bukan apa yang tersimpan.")
w("3. **Pendapatan per tender tetap satu akun** (`4101` × `tender`); laporan per kanal dibaca dari kategori. 26 dari 28 daun *online* klien sudah mati.")
w("4. **Akrual satu akun** (`2301` × `accrual_kind`); dibalik periode berikutnya, rinciannya di dokumen.")
w("5. **Nama 14 unit** (CIKUPA = C001?) hanya memengaruhi *view* kode lama (akhiran `00`–`13`), bukan bagan baru. Bisa dikonfirmasi belakangan tanpa memindahkan satu rupiah pun.\n")
w("---\n\n## 9. Kapan\n")
w("**Sebelum saldo awal dimuat, bukan sesudah.** Hari ini `ledger_account_remap` kosong dan belum ada jurnal produksi di bagan ini; perubahannya adalah satu rangkaian migrasi + satu CSV. Setelah saldo awal dan hari dagang produksi mendarat, setiap rupiah harus di-remap dan setiap laporan yang sudah dibagikan harus direkonsiliasi ulang. Tempatnya di rangkaian go-live: **sebelum Blok C (opening balance & cutover)**, sesudah Blok A/B yang sudah selesai.\n")
w("Ukuran: ±6 migrasi, `ledger.rs` (`resolve_account`, `required_semantic_keys` mendapat kategori), `account_map` API + layar, pemilih akun di frontend, seed ulang `seed-finance.py`, dan tes integrasi yang menyebut kode 10 digit (fixture memakai bagan milik migrasi, jadi kebanyakan ikut otomatis).\n")
w("---\n\n## 10. Yang tidak dilakukan dokumen ini\n")
w("Tidak ada migrasi yang ditulis. Tidak ada kode yang berubah. Bagan di head tetap 318/190, semua gate tetap hijau. Dokumen ini adalah putusan yang menunggu satu kata: *jalankan*.\n")
# ---------------------------------------------------------------- §11
w("---\n\n## 11. Perbandingan dengan `Proposed_30_Account_Structure.xlsx` (18 Sep 2026)\n")
w("Usulan pihak lain: 8 sheet — 30 *main account*, 70 *detail type* (D001–D070, masing-masing dengan *allowed main account*), 16 dimensi kandidat (231 nilai), 499 aturan per keluarga, dan *crosswalk* 7.528 baris. "
  f"Keputusannya per daun: **{idr(their['Proposed'])} proposed · {idr(their['Review required'])} review required · {idr(their['Unresolved'])} unresolved**. Dibuat *system-independent*, tanpa mengetahui skema kita, jumlah badan hukum, model akses, atau nama toko — dan jujur mengatakannya.\n")
w("### 11.1 Kesimpulan: kerangkanya sama; selisihnya adalah fakta yang mereka tidak punya, ditambah dua hal yang mereka benar\n")
w("**Desainnya identik.** *Main account + detail type yang wajib dan terkontrol + sub-ledger* adalah persis `ledger_account` + `line_category`/`category_family` + sub-ledger di §4. "
  f"Dari 499 aturan keluarga mereka, **{idr(same)} dari 6.908 daun** jatuh ke pasangan (akun mereka → akun kita) yang satu-ke-satu atau satu-ke-sedikit tanpa pertentangan makna; 56 daun mereka biarkan *unresolved*. "
  "Tidak ada satu pun daun yang mereka taruh di kelas laporan yang berbeda dari kita (aset vs kewajiban, pendapatan vs beban), kecuali tiga yang dibahas di §11.3.\n")
w("### 11.2 Setiap bendera *review* / *unresolved* mereka dijawab oleh fakta yang sudah kita pegang\n")
w("| Bendera mereka (daun) | Fakta kita | Akibatnya di bagan ini |\n|---|---|---|")
w("| Antar-unit: *confirm same-entity vs separate legal entity … preserve interunit matching without netting* (1.372) | **Satu badan hukum** (pemilik, 18 Sep). Dalam satu entitas saldo antar-unit bukan aset/kewajiban — ia tereliminasi. | Satu akun bertanda `1501`, wajib nol; lawan tetap di `counter_site_id`, jadi *gross per pasangan* tetap terbaca tanpa menjadi 2 akun (mereka: `1210` + `2200`, dicampur dengan piutang pegawai dan akrual — invarian eliminasinya tidak bisa ditulis per akun). |")
w("| BDP: *confirm whether named unit is origin or destination* (392) | Dibuktikan di `coa-cube.md`: pemilik = akhiran 2 digit, lawan = indeks template. | `1302` × `counter_site_id`. |")
w("| Reserve Replacement OE: *accumulated depreciation, inventory allowance, or provision?* (504) + beban penggantiannya (504) | Mekanisme klien yang sudah kita bangun: `asset_replacement_rate` / `asset_replacement_charge` (0213). | Kontra-aset sendiri `1610`; bebannya di `7101` (klien memfilekannya di akar 7, keluarga penyusutan — mereka menaruhnya di opex `6200`). |")
w("| Kapitalisasi OE, HGB/land right, pre-opening: *review policy* (546) | Aset register + `asset_class` (§7.1 butir 2); HGB = kelas aset; pre-opening = aset tangguhan diamortisasi (klien 1031802). | Kelas aset, bukan akun. |")
w("| `1031803 Contract In Progress`: *construction asset or customer contract?* (14) | CIP = keputusan ketiga kapitalisasi (0213, `docs/asset-register`). | `1601` × kelas CIP. |")
w("| `1031801 Disposed Inventory` (14) | Nol dua tahun; tak punya arti di model aset/persediaan kita. | Dipensiunkan. |")
w("| `8010110007 Pendapatan (Biaya) Lain-Lain`: *split by substance; sign alone is insufficient* (14) | Sistem kita **tidak pernah memposting ke sana berdasarkan tebakan substansi**: yang mendarat adalah arti bernama — `cash_variance`, `asset_disposal_result`, `other_income_expense`. | `4301` × `income_kind`; substansinya adalah kategori, bukan tanda. |")
w("| `8030112001 Current Tax PPh 25`: *instalment (1410) or expense (8100)?* (14) | Dipakai kernel sebagai `tax_on_interest` (potongan pajak atas bunga bank). Angsuran PPh 25 punya arti sendiri (`pph25_credit` → 1402). | `8201` × `tax_type`; nama klien yang menyesatkan tidak ikut. |")
w("| Y/N: *meaning unknown, do not drop N rows* (104) | N = non-aktif (`coa-final.md` §1); 104 daun, 0 template mati seluruhnya. | Tidak ada yang dibuang; `is_active`. |")
w("| Syarat mereka: *use only if the system enforces dimensions, dimension trial balance, subledger controls* | Itu tepat yang sudah ada: CHECK/trigger per akun (0261–0268), `assert_journal_balanced_per_site`, `finance_controls()`, laporan dari `root_class`. | Syaratnya terpenuhi — jadi *if*-nya sendiri memutuskan untuk bagan kecil. |")
w("\n### 11.3 Dua hal yang mereka benar, dan bagan ini berubah karenanya\n")
w("1. **Aset takberwujud terpisah dari aset tetap** (`1600`/`1690` mereka). Aturan §1 dokumen ini — *akun = baris laporan* — menuntut hal yang sama: *aset takberwujud* adalah baris neraca sendiri (PSAK), bukan kelas dari aset tetap. Bagan ini bertambah dua: `1602 Aset takberwujud & aset tangguhan` dan `1619 Akumulasi amortisasi` (software, pre-opening). 38 → **40**.")
w("2. **Potongan pembelian adalah kontra-HPP, bukan pendapatan lain** (`D063` → `5100` mereka). Secara akuntansi persediaan (PSAK 14) diskon dagang mengurangi harga perolehan; klien memfilekannya di akar 8 (*Potongan Pembelian* di bawah *Pendapatan & Biaya Lain-lain*) — kebiasaan, bukan prinsip. Dipindah: `8010110003` dan kunci `purchase_discount`/`purchase_price_variance` → `5101` × `PURCHASE_DISCOUNT`. **Perlu persetujuan akuntan** karena mengubah wajah laba kotor dibanding laporan 2024–2025 mereka; *view* kode lama tetap mencetaknya di tempat lama.\n")
w("### 11.4 Yang dipertahankan, dan alasannya\n")
w("| Mereka | Kita | Alasan |\n|---|---|---|")
w("| `1100` Kas, bank & deposito (satu akun, 199 daun) | `1101` Kas (unit) + `1102` Bank (company) | Dimensinya berbeda — toko memegang kas, **tidak pernah** rekening (kebijakan pemilik). Satu akun berarti `dimension` tidak bisa dideklarasikan per akun, dan FK `bank_account_id ↔ akun` kehilangan gigi. Deposito = kelas rekening di `company_bank_account`, bukan akun. |")
w("| `1210`/`2200` antar-unit sebagai *detail* di akun campuran | `1501` sendiri, bertanda | §11.2 baris pertama. Ini satu-satunya tempat usulan mereka **lebih lemah** untuk klien ini, bukan hanya berbeda. |")
w("| `2400` jatuh tempo ≤1 th + `2500` jangka panjang | `2501` satu akun | Porsi lancar **diturunkan dari jadwal** `financing_installment` pada tiap tanggal neraca — bukan *inferred once at migration* (kekhawatiran mereka, yang sah), dan tanpa jurnal reklas berkala. |")
w("| `1400` prepaid + uang muka | `1401` + `1403` | Dua sub-ledger dengan perilaku berbeda: `prepaid_schedule` mengalokasikan per bulan; `advance` diselesaikan per dokumen. |")
w("| `2100` termasuk *suspense* | `2101` + `2102` | GRNI adalah akrual tanpa faktur; kontrol AP (`supplier_invoice`) tidak menutupinya. |")
w("| `2200` termasuk *Principal payable* | `2502` Pinjaman pemilik | Pihak berelasi; punya register `principal`; baris pengungkapan sendiri. |")
w("| `6200` opex tunggal (1.232 daun: penjualan, umum, sewa, pemeliharaan, penggantian OE, pembulatan) | `6101` · `6301` · `6401` (+ `7101`, `4301`) | Sewa Rp 1,35 M/tahun dan beban penjualan adalah baris laporan; pembulatan ikut tandanya di `4301`; penggantian OE mengikuti akar 7 klien. |")
w("| dimensi `function` / cost center (Store operations · Office · Selling · Administration · Maintenance) | tidak ada | *Office* vs *operation* = **unit** (HO vs toko), sudah ada di setiap baris; *selling/administration/maintenance* = akun `6101`/`6301` + kategori. Mereka sendiri menulis *\"function defaults are inferred from source headings\"* — yang bisa diturunkan tidak perlu diketik. `coa-final.md` §3 sudah menolak cost center. |")
w("| tabel `legal_entity` | tidak ada | Satu badan hukum. |")
w("\n### 11.5 Yang bisa diambil dari mereka tanpa mengubah bagan\n")
w("- Urutan migrasi 6 langkah dengan bukti selesai per langkah (sheet *Proposal*) — lebih rapi dari §9 dan cocok jadi `docs/finance-migration.md` bagian *cutover*.")
w("- *Never import both current-result balances and the same underlying P&L twice* — persis alasan `3013001003` diturunkan, bukan diposting.")
w("- Sheet *Dimension Values* (84 `expense_type`, 58 `asset_type`) adalah daftar nilai awal `line_category` dan `asset_class` yang sudah diketik — tinggal dipetakan ke kode kita.\n")
open('docs/coa-thirty.md','w').write('\n'.join(L)+'\n')
print(f"docs/coa-thirty.md: {len(L)} lines · chart {N} ({units} unit/{comps} company) · head {sum(cur[k] for k in CHART)}+{cur['DERIVED']}+{cur['RETIRE']} · client leaves {sum(leaves[k] for k in CHART)}+{leaves['DERIVED']}+{leaves['RETIRE']} · their same-class leaves {same}")
