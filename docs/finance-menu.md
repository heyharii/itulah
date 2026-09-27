# Menu Finance final — keputusan, bukan pilihan

**Tanggal:** 13 September 2026 · **Status:** diputuskan, menggantikan §9 `docs/finance.md`
**Brief pemilik (verbatim):** *"kita suka yg arah2 erpnext yg sudah terbukti tapi ini coa kita"*
**Acuan yang dibaca:** A (kode hidup) · B (finance-lab, 52 layar) · C (prototipe 11 Sep, 13 menu/67 tab) · E (ERPNext v17) · COA (7.528 akun klien)

Hasilnya **satu menu, 37 baris, 12 seksi, satu pintu**. Bukan tiga pintu, bukan 67 tab,
bukan 52 layar, bukan 101 baris ERPNext.

Sumber riset: lima laporan agen (kode hidup · finance-lab · prototipe 11 Sep · ERPNext
v17 `develop@fe25746` · COA klien) dan `owner-decisions.md`, 13 September 2026. Satu
koreksi atas draf sintesis: grup **Payables** memuat Supplier bills (bentuk sidebar
Accounts ERPNext, bukan bentuk sidebar Assets), dan **Payments** menjadi grup bersama
Journal entries — supaya tidak ada grup bernama Payables yang tagihannya ada di luar.

---

## 0. Dua keputusan pembuka yang membuat sisanya bisa diputuskan

**0.1 — §0 `docs/finance.md` diamandemen di satu titik: "BENTUK → C" dipecah dua.**
Aturan tie-break 12 September menetapkan bentuk menu diambil dari C. Brief pemilik
13 September ("arah ERPNext yang sudah terbukti") lebih baru, dan tiga keputusan
pemilik tanggal yang sama (Banking, Giro, Vendors) semuanya mengambil bentuk
ERPNext secara eksplisit. Jadi:

```
TULANG PUNGGUNG sidebar (urutan, pengelompokan, nama objek, keep_closed) → E
ISI LAYAR (tab, 8 keadaan, form, subtabel, cetak, batas antarmenu)        → C
ATURAN POSTING (bukti · kesiapan · aktivasi · binding)                    → B
APA YANG BENAR HARI INI (pintu posting, resolver, invarian)               → A
KODE AKUN                                                                 → bagan klien
```

*Saya membatalkan* klaim §0 bahwa "E bukan acuan": E adalah acuan untuk bentuk
sidebar, dan hanya untuk itu.

**0.2 — `owner-decisions.md` salah soal Vendors; kode yang benar.**
Catatan itu menulis "Finance → `/finance/vendors`". Tetapi
`frontend-hub/src/screens/vendors/nav.ts` merekam koreksi pemilik yang lebih baru,
lima kata: *"vendor registrasi di ga bukan?"*, dan modulnya sudah berdiri di GA
dengan `moved: ["/finance/vendors"]`. Aturan §0 ("APA YANG BENAR HARI INI → A")
berlaku. **Finance tidak punya baris Vendors.** Yang Finance butuhkan dari record
vendor — akun beban default, berapa utang, mana yang telat — dibaca di tempat ia
bekerja: di tagihan dan di ageing tagihan.

---

## 1. Menu final

37 baris · 12 seksi (1 tanpa judul + 11 grup) · 4 grup `keep_closed`.
Kind memakai kosakata ERPNext: **dashboard · document · tool · report · setting**.
Sebarannya: 1 dashboard · 19 document · 3 tool · 6 report · 8 setting.

> **Kind bukan grup.** ERPNext menaruh master `Supplier` di grup *Payables*, bukan di
> *Setup* — kind menjawab *apa yang baris ini lakukan pada buku*, grup menjawab
> *pekerjaan siapa*. Dua sumbu, tidak pernah dicampur.
> Definisi kind di sini: **dashboard** membaca lintas register · **document** memposting
> saat di-submit · **tool** mengubah dokumen lain tanpa punya record sendiri ·
> **report** hanya membaca · **setting** harus benar sebelum posting bisa terjadi
> (master data termasuk di sini — master tidak pernah memposting).

```
FINANCE                                             /finance      badge bad
──────────────────────────────────────────────────────────────────────────────
    1  Overview                     dashboard   /finance
▾ Store money
    2  Sales days                   document    /finance/sales-days
    3  Deposits                     document    /finance/deposits
    4  Petty cash                   document    /finance/petty-cash
▾ Cash & Bank
    5  Cash                         report      /finance/cash
    6  Cash Counts                  document    /finance/cash-counts
    7  Banks                        setting     /finance/banks
    8  Bank Accounts                setting     /finance/bank-accounts
    9  Bank Transactions            document    /finance/bank-transactions
   10  Bank Reconciliation          tool        /finance/bank-reconciliation   warn
▾ Receivables
   11  Settlements                  document    /finance/settlements
   12  Charges without a sale       tool        /finance/unmatched-charges     warn
▾ Payables
   13  Supplier bills               document    /finance/bills                 warn
   14  Giro register                document    /finance/giro
   15  Advances & claims            document    /finance/advances
▾ Payments
   16  Payments                     document    /finance/payments
   17  Journal entries              document    /finance/journal
▾ Inter-unit
   18  Inter-unit transfers         document    /finance/interunit
   19  Due from / Due to            report      /finance/unit-balances
▸ Assets                                                          [keep_closed]
   20  Assets                       document    /finance/assets
   21  Depreciation                 document    /finance/depreciation
   22  Projects in progress         document    /finance/projects
▸ Payroll                                                         [keep_closed]
   23  Payroll postings             document    /finance/payroll-postings
   24  Staff loans                  document    /finance/staff-loans
▸ Periodic & closing                                              [keep_closed]
   25  Prepaids & accruals          document    /finance/schedules
   26  Period close                 document    /finance/periods               warn
   27  Opening balances             tool        /finance/opening
▾ Reports
   28  Financial statements         report      /finance/reports
   29  Ledger                       report      /finance/ledger
   30  Stock value                  report      /finance/stock-value
   31  Integrity checks             report      /finance/integrity             bad
▸ Setup                                                           [keep_closed]
   32  Chart of accounts            setting     /finance/accounts
   33  Account map                  setting     /finance/account-map           bad
   34  Posting rules                setting     /finance/posting-rules
   35  Payment terms                setting     /finance/payment-terms
   36  Giro printing                setting     /finance/giro-print
   37  Finance settings             setting     /finance/settings
```

**Kenapa bentuknya sidebar Accounts ERPNext, bukan sidebar Assets.** Sidebar Accounts
ERPNext menaruh `Purchase Invoice` di grup *Payables* dan `Payment Entry` + `Journal
Entry` di grup *Payments*. Draf sintesis sempat mengangkat empat dokumen utama ke luar
grup (bentuk sidebar Assets), tetapi itu menyisakan grup bernama *Payables* yang
tagihannya ada di luar — nama grup jadi bohong. Jadi: hanya **Overview** yang tanpa
judul; **Payables** = tagihan, instrumen yang membayar nanti, uang yang keluar sebelum
tagihan ada; **Payments** = dokumen uang lintas-domain (satu pembayaran melunasi
tagihan, payroll, settlement, setoran) dan jurnal manual, dan kelak *Payment
Reconciliation* (§4.13) punya rumah di sini. Semua grup harian terbuka, jadi Supplier
bills tetap terlihat tanpa satu klik pun.

**Kenapa empat grup tertutup.** `keep_closed` ERPNext soal **irama**, bukan soal besar.
Assets adalah 34,9% bagan klien dan tetap tertutup: register aset dibuka mingguan,
penyusutan bulanan. Payroll bulanan, Periodic & closing bulanan, Setup jarang.
Terbuka: Store money · Cash & Bank · Receivables · Payables · Payments · Inter-unit ·
Reports — yang dikerjakan setiap hari. Default HO: **23 baris terlihat + 4 kepala grup**.

---

## 2. Perspektif toko — jawaban §11.8

**Putusan: ikut HR, harfiah. Satu modul Finance, dua wajah.**
Toko **tidak** mendapat surface uang sendiri, dan **tidak** cukup diberi "Cakupan unit"
sebagai hak akses. Toko mendapat **grup bernama sendiri di dalam Finance** — `Store money` —
yang duduk sebagai grup domain pertama, plus tiga baris lain yang memang dikerjakan
dua pihak. Mekanismenya sudah ada dan tidak perlu dibangun: `audience` di
`lib/navigation.ts` (`shown()` = `item.audience === undefined || item.audience === audience`),
persis yang dipakai `screens/people/nav.ts`.

Alasan mengapa ini "layar sendiri" dan bukan sekadar filter: ketiga baris Store money
adalah **dokumen yang berbeda** dengan dokumen HO, bukan pandangan lain atas dokumen
yang sama. `store_deposit`, `store_expense` dan `petty_cash_replenishment` (branch D)
adalah tabel tersendiri, ambangnya Rp 500.000, penyetujunya HO, dan tak satu pun dari
ketiganya adalah `supplier_payment`.

### Yang dilihat kepala toko — 7 baris

| Baris | Grup | Kenapa toko melihatnya |
|---|---|---|
| Overview | — | antrean miliknya sendiri; satu layar dua bacaan (preseden People → Directory) |
| Sales days | Store money | ia mengonfirmasi hari dagangnya sendiri: pecahan tender, diskon, retur, pembulatan |
| Deposits | Store money | setoran harian ke bank, penerimaan top-up petty cash, modal kasir yang tetap |
| Petty cash | Store money | buku kas kecilnya sendiri: belanja < Rp 500rb adalah haknya, di atas itu wajib menyebut izin HO |
| Cash | Cash & Bank | posisi tiga potnya: `1011001001` · `1011001002` · `1011001003` |
| Cash Counts | Cash & Bank | ia yang menghitung laci; sumber kebenarannya orang, bukan rekening koran |
| Due from / Due to | Inter-unit | barisnya sendiri di matriks afiliasi: apa yang HO belanjakan untuknya, apa yang ia utang |

**30 baris lain membawa `audience: "employer"`.** Tidak ada toko yang membuka Payments,
Giro, Supplier bills, Payroll, Bank Accounts, Bank Reconciliation, Assets atau Setup.
Ini persis potret bagannya: satu-satunya keluarga yang **pekerjaannya** secara fisik ada
di toko adalah `1011001` (42 daun), pasangan BDP `1011203`/`1011204` (392) dan keluarga
penjualan `40101`/`40102` (154) — **588 dari 6.908 daun, 8,5%**. 91,5% bagan ini adalah
pekerjaan HO, dan menu ini mengakuinya.

**Yang TIDAK dibuat**, dan alasannya satu kalimat tiap butir:
- *Layar pengeluaran toko yang memposting* — kebijakan pemilik: pengeluaran
  disentralisasi di HO; uang keluar toko adalah **permintaan**, objek alur kerja,
  bukan layar buku besar (COA §5).
- *Modul "Store finance" terpisah* — HR tidak melakukannya untuk manajer tempat; ia
  hanya melakukannya untuk **karyawan** (`frontend-employee`), dan kasir sudah punya
  aplikasinya sendiri (tablet till di toko).
- *Baris "Inventory & transfers" di Finance* — pekerjaan gudang; ada di modul Inventory
  dan di layar Operations hub (`frontend-floor` dipensiunkan 2026-09-26). Finance hanya membaca nilainya (baris 30 `Stock value`).

---

## 3. Baris demi baris — tugas, apa yang diserap, padanan ERPNext

Legenda **Ref**: acuan asal baris. **Status**: `live` (rute + layar ada) · `partial` ·
`D` (ada di branch `feat/finance-control`, belum merge) · `new`.

### Seksi tanpa judul — pintu masuk (1)

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 1 | Overview | dashboard | A·C | live | menentukan pekerjaan finance yang perlu didahulukan hari ini | Workspace (satu chart + 3 number card) |

**Menyerap / dipensiunkan**
- **Overview** menyerap C1 `Today` + `My Approvals` + `Exceptions` (tiga tab jadi tiga
  bagian satu layar), dan **sembilan layar "Overview" per-grup milik B** (5, 12, 14, 17,
  21, 23, 27, 36 dan `/finance-lab`). Sembilan pintu ke satu pertanyaan adalah sembilan
  layar yang berhenti dibuka.

### ▾ Store money (3) — terbuka

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 5 | Sales days | document | C·COA·E | new (D) | hari dagang satu unit jadi satu dokumen: pecahan tender, diskon, retur, pembulatan | POS Closing Entry / Cashier Closing |
| 6 | Deposits | document | C·COA | D | setoran hari ini ke bank, top-up petty cash yang mendarat, modal kasir yang tetap | Payment Entry (Internal Transfer) |
| 7 | Petty cash | document | B·COA | D + new | buku kas kecil satu toko: pengisian dari HO, belanja harian, saldo | — (ERPNext tak punya; hanya prosedur) |

**Menyerap / dipensiunkan**
- **Sales days** menyerap C4 `Sales` dan B12 `SalesOverview` + B13 `SalesReconcile`.
  Tiga kolom B — **rung / counted / deposited, tidak pernah satu selisih** — dipakai
  verbatim. Menutup G1. Akun: `4010110` tunai, `4010111` debit ×4 bank, `4010112` kredit
  ×2 skema, `4010113` online (aktif hanya di C013), `4010213` diskon, `4010214` retur,
  `8010110002` pembulatan.
- **Deposits** menjawab lubang yang §9 `docs/finance.md` temukan sendiri: *"setoran kas
  toko ke bank tidak punya dokumen"*. Menyerap C2 `Transfers & Deposits` sisi toko.
  `cash_in_transit` **tidak** dipakai — pemilik memutuskan setoran hari yang sama, dan
  bagan memang tidak punya akunnya (A17).
- **Petty cash** menyerap B9 `/expenses/spend`, tetapi **bukan sebagai antrean
  persetujuan** — koreksi pemilik 13 Sep: *"petty cash hak toko belanjakan bebas asalkan
  dibawah 500 ribu, kecuali diatas itu baru harus izin HO."* Belanja di bawah ambang
  adalah **hak**, dicatat lalu langsung membukukan; tidak ada yang menunggu siapa pun.
  `STORE_EXPENSE_CEILING` Rp 500.000 karena itu adalah **satu aturan pada form**, bukan
  satu layar kedua: di atas ambang, baris tidak bisa disimpan tanpa menyebut siapa di HO
  yang mengizinkan. Layarnya jadi buku kas kecil satu toko — pengisian dari HO, belanja,
  saldo berjalan — dan `petty_cash_replenishment` mendarat di baris yang sama.

### ▾ Cash & Bank (6) — terbuka · **dibekukan keputusan pemilik 13 Sep, enam baris ini apa adanya**

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 8 | Cash | report | A·E | partial | di mana uang tunai berada, per unit, tiga pot | — (Cash tidak simetris dengan Bank) |
| 9 | Cash Counts | document | A·E | partial | menghitung laci dalam pecahan, membukukan selisihnya dengan alasan | prosedur Petty Cash (kita lebih maju) |
| 10 | Banks | setting | A·E | partial | master institusi — **enam** bank, bukan lima | Bank |
| 11 | Bank Accounts | setting | A·E | partial | rekening kita dan rekening pemasok; nomor, pemegang, cabang, giro/tabungan | Bank Account |
| 12 | Bank Transactions | document | A·E | partial | baris rekening koran yang masuk, dan riwayat impornya | Bank Transaction + Bank Statement Import |
| 13 | Bank Reconciliation | tool | A·E | partial | mencocokkan baris koran dengan voucher; salinan ERPNext, tanpa tambahan | Bank Reconciliation Tool |

**Menyerap / dipensiunkan**
- Keenamnya adalah **layar `finance-lab-2` yang dipromosikan** (sudah ter-wire ke
  endpoint yang sama dengan modul hidup).
- **Mempensiunkan `/finance/bank` milik A** (1.547 baris, 4 tab: Cash · Bank · Giro
  outstanding · Cards). Tab *Cash*/*Bank* jadi baris 5 dan 8; **sesi rekonsiliasinya
  pindah ke baris 10**; tab *Giro outstanding* **dihapus sebagai tab** — ia status, bukan
  tempat (B: "status bukan menu") — dan pekerjaannya pindah ke baris 14; tab *Cards*
  pindah ke baris 11.
- Menyerap C2 `Accounts & Cash` + `Cash Position` + `Bank Reconciliation`, dan B2
  `/cash/accounts` + B4 `/cash/reconcile`. `AccountCards` B (saldo buku vs saldo koran)
  dipakai di baris 10. B3 `/cash/transactions` (satu baris per **baris jurnal**) **tidak**
  jadi baris sendiri — itu `Ledger` (baris 29) yang belum dipilih akunnya.
- Nama **`Bank Reconciliation` tidak boleh dipendekkan** (keputusan pemilik): modul ini
  suatu hari berutang *Payment Reconciliation* — pekerjaan yang berbeda.
- Dijatuhkan dari ERPNext atas keputusan pemilik: Bank Guarantee · Plaid · Bank Account
  Type/Subtype · **Bank Clearance**.
- Aturan kategorisasi koran dan sumber statement (0142) **bukan baris** — lembar dari
  toolbar Bank Transactions. Ini membatalkan B44 `/accounting/rules` yang salah label.

### ▾ Receivables (2) — terbuka

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 14 | Settlements | document | C·B·COA | D | uang kartu/marketplace yang masih di jalan: kotor − MDR = neto, per acquirer per hari | (tak ada padanan; PLE terdekat) |
| 15 | Charges without a sale | tool | A | live | kartu tertagih tanpa penjualan di baliknya — pembeli yang menunggu refund | — |

**Menyerap / dipensiunkan**
- **Settlements** menyerap C4 `Channel Settlements` dan B16 `/receivables/settlements`,
  membawa tiga gagasan B: kolom `channel` (DEBIT/CREDIT/**MARKETPLACE**), kolom
  `settles_into`, dan **`Inquiry` sebagai objek kelas satu** (diajukan → dikejar →
  dijawab). Akun: `1011101001` kredit, `1011101002` debit. Menutup G9.
- **Dijatuhkan dari C4**: `Customer Invoices`, `Customers`, `Customer Advances & Refunds`
  — peritel tunai tidak menerbitkan invoice, tidak punya master pelanggan di Finance
  (Members punya), dan `205001 Uang Muka - Penjualan` adalah **satu akun** yang muncul di
  layar Sales days saat ada pesanan bayar-muka, bukan sebuah menu.
- **Dijatuhkan dari B**: B14 `ReceivablesOverview`, B15 `/receivables/balances` (pinjaman
  staf pindah ke baris 24).

### ▾ Payables (3) — terbuka

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 13 | Supplier bills | document | A·C·E | live | mengakui tagihan pemasok barang & non-barang, mencocokkan, memposting | Purchase Invoice |
| 14 | Giro register | document | C·COA·E | D | instrumen bayar-nanti: diterbitkan → diserahkan → jatuh tempo → cair / ditolak | (tak ada fitur PDC; bentuk dokumen dari ERPNext) |
| 15 | Advances & claims | document | C·B·E | partial + new | uang muka pegawai/pemasok, pertanggungjawabannya, dan nota kredit pemasok | Employee Advance + Expense Claim |

**Menyerap / dipensiunkan**
- **Supplier bills** menyerap C3 `Aged Payables` (ageing 5 ember sudah dihitung server
  dan sudah jadi kolom di layar ini) dan B8 `/expenses/bills`. C3 `Suppliers` **pergi ke
  GA** (§0.2). Tiga tab yang ada — Merchandise · Expenses · Unbilled deliveries — tetap.
- Tiga objek payable dalam satu grup, seperti sidebar Accounts ERPNext: tagihan itu
  sendiri, instrumen yang membayar nanti, dan uang yang keluar sebelum tagihan ada.
- **Giro register** menyerap C2 `Giro Instruments` dan B27/B28 (`giro_issued`,
  `giro_cleared`). Bentuk dokumen dari ERPNext, **posting lewat akun kliring**
  `giro_outstanding` → `2012002 Outstanding Giro` **mengikuti bank penerbit** — satu-satunya
  kode akun yang C pakai sebagai argumen desain (`201200200200`), dan ia benar. Akun
  off-ladder `204001 Giro Keluar` ikut di sini. Menutup G8. `CHEQUE` sudah dihapus (0220).
- **Advances & claims** menyerap C3 `Employee Advances` + `Expenses & Claims` +
  `Supplier Advances & Credits`, dan B10 `/expenses/advances` + B19. Dari ERPNext diambil
  **`amount` vs `sanctioned_amount` sebagai dua angka tersimpan** dan tangga
  advance → claim → settle dengan status `Returned`. Akun `1011303` (4 jenis).
  `supCatatan` C dipakai: uang muka dan kredit **ditampilkan terpisah**, tidak pernah
  di-net diam-diam.

### ▾ Payments (2) — terbuka

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 16 | Payments | document | A·C·E | live→widen | satu dokumen uang keluar/masuk/pindah dengan baris alokasi dan baris potongan | Payment Entry |
| 17 | Journal entries | document | A·B·C·E | live | kejadian yang memang butuh akuntansi langsung; pembalikan sebagai satu-satunya koreksi | Journal Entry |

**Menyerap / dipensiunkan**
- Grup ini adalah grup *Payments* ERPNext yang dipangkas: `Payment Entry` + `Journal
  Entry` sekarang, `Payment Reconciliation` (pembayaran ↔ tagihan) kelak sebagai tool
  di sini (§4.13). Payments bukan bagian Payables karena satu pembayaran melunasi
  tagihan, payroll, settlement, dan setoran — dokumen lintas-domain.
- **Payments** menyerap C2 `Payment Queue`, `Payment Run`, `Money Movements`,
  `Transfers & Deposits` (bagian antar-rekening) dan B orphan `payments.tsx` yang
  dijatuhkan demi aturan "tidak ada menu Payments". Queue dan Run bukan tempat: queue
  adalah **kolom status** dan run adalah **aksi batch** (`payment_batch`, branch D).
  Pelebarannya wajib: `payment_type` = **Pay · Receive · Internal Transfer** menutup G5
  dan G6 dengan satu enum, dan `deductions[]` memberi MDR, biaya bank, pembulatan dan
  potongan pajak rumah di dokumen yang menyebabkannya.
- **Journal entries** menyerap C11 `Journal Entries` + `Account Reconciliation`
  (ditunda, lihat §4.13) dan B40 `Journals` + B41 `Adjustments`. `JournalGrid` dua kolom
  nyata dengan footer selisih dari B dipakai; `alt_group` tidak.

### ▾ Inter-unit (2) — terbuka

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 18 | Inter-unit transfers | document | COA·C·B | D | satu dokumen memiliki **kedua kaki**: HO mendanai unit, unit membayar balik, barang berpindah | Inter Company JE (invarian saja) |
| 19 | Due from / Due to | report | COA·B | new | matriks 14×14: baris berkata ia berutang pada kolom; harus net nol | Party Ledger |

**Menyerap / dipensiunkan**
- Empat tab C6 dan empat layar B (23–26) **menjadi dua**. `Settlements` dan
  `Reconciliation` bukan tempat ketiga dan keempat: penyelesaian adalah dokumen yang sama
  dengan arah terbalik, rekonsiliasi adalah matriks yang tidak net nol.
- Ini **20,1% bagan klien** — 1.386 daun, 7 dari 9 matriks
  (`1021401/02/03`, `2012301/02/03/04`). Layar Journal tidak bisa memilih sel 14×14
  dengan aman. **Tidak bisa jadi tab.**
- Dua disiplin diambil utuh: **`funding_type` wajib, tidak pernah disimpulkan** (B rule 9),
  dan **aturan keluarga** C — *"pendanaan memakai keluarga pendanaan, barang memakai
  barang"*; kegagalan yang dinamai C (*"Pelunasan mengurangi utang barang"*) jadi
  penolakan, bukan peringatan.
- Dari ERPNext diambil **invarian dan penamaan** ("Due from / Due to \<unit\>"), bukan
  mesinnya: HO + 13 toko adalah **satu badan usaha, satu buku** — dua kaki adalah dua
  baris satu jurnal, bukan dua Company.
- Spanduk peringatan B23 (*"tidak satu pun saldo ini terbukti"*) menjadi **penolakan
  posting** sampai kedua kaki resolve, bukan spanduk.
- `4020110 Management Fee` ↔ `7020310004 Biaya Management FEE` hidup di sini — dua
  keluarga rata ×14 yang harus net nol lintas unit dan hari ini tidak ada yang menegakkan.
- Menutup G4 dan G10. 0120–0122 (branch D) adalah yang membuat 0098 tidak lagi perlu.

### ▸ Assets (3) — tertutup

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 20 | Assets | document | A·C·E | live | separuh uang dari register: biaya, keputusan kapitalisasi, umur, transfer, pelepasan | Asset |
| 21 | Depreciation | document | A·B·E | partial | jadwal tersimpan dengan satu jurnal per baris, dan run bulanannya | Asset Depreciation Schedule |
| 22 | Projects in progress | document | COA·B·E | partial | CIP `1031803` dan pre-opening `1031802` sampai dikapitalisasi | Asset Capitalization / CWIP |

**Menyerap / dipensiunkan**
- Menyerap C7 empat tab (`Transfers & Disposals` sudah jadi aksi di layar Assets A) dan
  B27–B32 enam layar.
- **`OE replacement reserve` DIJATUHKAN sebagai baris** — keputusan pemilik: penggantian
  di-beban-kan langsung, akrual cadangan hanya `COA_ONLY` dan **OFF**. Ini menidurkan
  1.008 daun (`1021607` + `7010215`, 36 jenis fixture) secara sadar. B32 benar sebagai
  *temuan* (cadangan nol pergerakan) — temuan itu pindah ke `Integrity checks`, bukan ke
  menu.
- **GA tetap di GA.** `screens/assets` (fisik, tanpa rupiah) bukan baris Finance; baris 20
  menautkannya. Dua pintu ke satu register, bukan dua register.
- Dari B diambil: **replay penyusutan di sebelah tombol Post**, pemotongan ke rupiah utuh,
  mulai dari bulan TGL BELI, dan `AssetCostComponent` (beberapa pembayaran menamai satu
  aset tanpa memposting dua kali). Dari ERPNext: **jadwal adalah dokumen submittable**,
  CWIP sebagai akun per kategori dengan tanggal switchover idempoten, dan
  `Asset Value Adjustment` sebagai dokumen.
- Ditolak dari ERPNext: Asset Maintenance/Repair/Shift (itu GA).

### ▸ Payroll (2) — tertutup

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 23 | Payroll postings | document | C·B·COA | new | menerima batch tersegel dari HR, memposting akrual, kewajiban, dan pembayarannya | (Salary Slip → GL, hrms) |
| 24 | Staff loans | document | COA·B·E | new | `1011102001` pinjaman pegawai dan `1011102002` piutang kepala toko, dipotong lewat payroll | Employee Advance (pola) |

**Menyerap / dipensiunkan**
- Empat tab C8 → dua baris. `Payroll Reconciliation` adalah pemeriksaan **di layar yang
  sama**, bukan tempat keempat.
- Jurnal pemilik (8 Sep) dipakai apa adanya: akrual bulanan
  `Dr Biaya Gaji/Lembur/BPJS · Cr Biaya Gaji YMHD`; pembayaran tanggal 1 bulan berikut
  `Dr YMHD · Cr Petty Cash`; transfer HO→unit lewat pasangan afiliasi pembiayaan.
  Akun: `6010111` (operation, 13 komponen) · `6010210` (office, 13) · `2012201001/002` ·
  `2012101001`.
- **Tidak ada "Buat payroll bebas"** (batas C8): payroll Finance dimulai dari batch HR,
  sehingga tidak ada versi perhitungan kedua.
- `1011102002 PIUTANG KEPALA TOKO` adalah **pinjaman pribadi**, bukan piutang dagang —
  keputusan pemilik 7 Sep. Ia tidak punya rumah di kelima rancangan; sekarang punya.
- Menutup lubang "payroll tidak menulis jurnal" (13 rute, nol jurnal).

### ▸ Periodic & closing (3) — tertutup

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 25 | Prepaids & accruals | document | COA·B·C | new | jadwal bulanan dua arah: yang dibayar di muka dilepas, yang belum dibayar diakui | Journal Entry Template |
| 26 | Period close | document | A·C·E | live→widen | mengunci bulan, dan memposting hasil periode ke ekuitas | Accounting Period + Period Closing Voucher |
| 27 | Opening balances | tool | E·COA | D | memindahkan saldo awal 14 unit jadi dokumen terbuka, bukan satu jurnal gelondongan | COA Importer + Opening Invoice Creation Tool |

**Menyerap / dipensiunkan**
- **Prepaids & accruals** menyerap C3 `Prepaid Expenses` (yang C sendiri akui salah menu:
  *"Posting bulanan dikendalikan Akuntansi"*), C11 `Periodic Recognition`, B11 `Prepaids`,
  B42 `AccrualsDeferrals` dan B43 `Provisions`. 322 daun: `1011301` (9 jenis prepaid) +
  `2012201` (10 jenis YMHD) + `7010110` sewa. Dari B diambil **`Strip` 12 bulan sebagai
  12 tanda** dan **kontrol akrual yang read-only** (`2012201` dibaca total di sini,
  dinaikkan dari domainnya masing-masing — inilah "satu keluarga akun bukan satu menu").
- **Period close** menyerap C11 `Period Close` + `Period Closing Pack` (pack = ekspor dari
  layar yang sama) dan B46. Menutup G7: checklist 5 baris yang ada harus **menahan** di
  server dan menyebut nomor dokumennya, bukan membalik status. Dari ERPNext diambil
  Period Closing Voucher (#4) yang memposting saldo P&L ke `3013001003`, dan
  `Accounting Period` dengan `closed_documents` — kunci **selektif**. **Ditolak**:
  `Account Closing Balance` (kita menghitung ulang, tidak menyimpan) dan centang
  "SETUJU ABAIKAN VALIDASI" yang dipakai di produksi Seventhsoft.
- **Opening balances** adalah lubang yang C sendiri dikritik karena tidak punya: go-live
  14 unit butuh workbench migrasi, bukan F35 generik. 1.328 baris register aset klien
  sudah terimpor; sisa buku belum.
- **`Provisions` dan `Equity` bukan baris.** `1011103` (cadangan piutang), `1011299`
  (cadangan kerusakan) dan `3013001` (4 akun modal, beberapa entri setahun) adalah
  **bagian layar Period close**, bukan menu — total 126 daun.

### ▾ Reports (4) — terbuka

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 28 | Financial statements | report | A·C·E | live | neraca, laba rugi, arus kas, konsolidasi — sebagai **template bernama** | Balance Sheet / P&L / Financial Report Template |
| 29 | Ledger | report | A·B·E | live | neraca saldo sebelum akun dipilih, buku besar sesudahnya | Trial Balance + General Ledger |
| 30 | Stock value | report | COA·C·B | D | nilai persediaan per unit/kelas, BDP yang menua, selisih hitung vs buku | Stock Balance |
| 31 | Integrity checks | report | E·C·B | D | sepuluh persamaan kontrol, dijalankan malam hari, dan yang gagal disebut | Ledger Health + Invalid Ledger Entries |

**Menyerap / dipensiunkan**
- **Semua laporan lain adalah template atau filter, bukan baris.** AP ageing, payment
  ledger, trial balance per counterparty, bank reconciliation statement, arus kas metode
  langsung, konsolidasi dengan baris eliminasi eksplisit, laporan per toko — semuanya
  **template tersimpan** di baris 28/29. Ini prinsip E: *"filters are the extension
  point, not menu items"* (26 filter GL, `categorize_by`, rentang ageing yang bebas
  teks). Menyerap C12 enam tab dan B47–B52 enam layar menjadi dua baris.
- **Query Builder DIJATUHKAN sebagai menu** (§11.7): template boleh, query bebas hanya
  untuk membaca dan tidak pernah menjadi laporan resmi. Membaca bebas sudah punya rumah —
  aside `Reports` milik hub.
- **Stock value** menggantikan seluruh menu `Inventory Accounting` C (4 tab) dan
  `Inventory` B (4 layar) — lihat putusan §4.3.
- **Integrity checks** menggantikan usulan grup `Integrity` (E §5.2 baris 12): sepuluh
  persamaan adalah satu layar, bukan tiga. `Reposts` tidak ikut — kita tidak pernah
  menyimpan saldo, jadi tidak ada yang perlu di-repost. Menyerap C13 `Control Rules`
  (5 aturan kontrol) dan temuan B32 (cadangan nol pergerakan).
- Tiga kemenangan murah E dipasang di sini: **Trial Balance for Party** (satu query),
  **Bank Reconciliation Statement** sebagai jembatan item terbuka (selisihnya sudah
  dihitung di `statements.rs:679`), dan `deductions[]` di pembayaran.

### ▸ Setup (6) — tertutup

| # | Baris | Kind | Ref | Status | Tugas | ERPNext |
|---|---|---|---|---|---|---|
| 32 | Chart of accounts | setting | A·C·COA | live | 7.528 akun; **aktif** dan **izin posting** dua kolom berbeda | Chart of Accounts |
| 33 | Account map | setting | A·B | live | `semantic_key × site × qualifier → account_code`; yang belum dipetakan menolak posting | (tak ada padanan — menggantikan `default_*_account`) |
| 34 | Posting rules | setting | B·C | new | aturan sebagai objek: **bukti · kesiapan · aktivasi**, dan yang sengaja mati | (tak ada padanan) |
| 35 | Payment terms | setting | E | partial | termin dan template termin; satu tagihan bisa jatuh tempo lebih dari sekali | Payment Term + Terms Template |
| 36 | Giro printing | setting | A | live | koordinat mm per bank penerbit; salah sekali, salah untuk semua giro bank itu | Cheque Print Template |
| 37 | Finance settings | setting | C·E | new | kebijakan yang menyebut **Role**: ambang Rp 500rb, ember ageing, kas negatif, tarif↔umur | Accounts Settings |

**Menyerap / dipensiunkan**
- **Posting rules adalah separuh yang menanggung beban** — B sendiri menemukan bahwa
  layar terbaiknya tidak bisa dijangkau: `contract.tsx` (Rule 29 / Role 58 / Peta 67) dan
  `setup.tsx` tidak punya rute. Layar ini mempromosikannya, dengan kolom **Aktivasi** dan
  **Bukti uji** dari C13. Delapan keputusan kontrak B dibawa: `AccountRole` union tertutup
  58 arti (hari ini 34 string), `Dimensions` sebagai record bertipe (hari ini satu
  `qualifier: String` datar), `narrow_by` daftar kunci, `AmountBasis` tertutup,
  `alt_group`, `conformance()`, aktivasi per-package utuh, `caveats[]`.
- **`scenarios.tsx` B (8 skenario akseptansi) tidak menjadi layar** — ia menjadi uji Rust.
  Harness yang lebih permisif dari produksi tidak membuktikan apa pun (B prinsip 12).
- **Chart of accounts**: batas 300 baris dan tiga pilihan unit **dihapus** (gap C13 yang
  menuding build sekarang). Pencari **wajib menampilkan kode**, karena 152 nama daun
  payroll toko dan kantor byte-identik (A10) dan 43% nama grup berbeda dari nama daunnya
  (A9). `Account Category` ERPNext diambil sebagai tag roll-up laporan — untuk 7.528 akun
  ia bernilai lebih dari apa pun di menu ini.
- **Dijatuhkan dari C13**: `Accounts & Parties` (master rekening ada di Cash & Bank, master
  pihak di GA/Buying), `Access & Approvals` (menjadi kebijakan yang menyebut Role di baris
  37 + RBAC di rute — hari ini **tidak ada otorisasi di satu pun rute finance**),
  `Change History` (modul audit sudah ada, `http/audit.rs`).
- **Ditolak dari ERPNext**: 30+ field `Company.default_*_account` — persis yang
  `account_map` gantikan; Cost Center, Accounting Dimension, Dimension Filter, Finance
  Book, Currency, Terms and Conditions.

---

## 4. Kontradiksi antar-acuan — putusan satu per satu

### 4.1 Payments sebagai menu — A, C, E ya; B tidak → **YA, sebagai grup Payments bersama Journal entries**
B benar tentang di mana **tombolnya** (di tagihan) dan salah tentang di mana **dokumennya**
tinggal. `supplier_payment` hari ini sudah satu dokumen dengan baris alokasi yang bisa
melunasi beberapa tagihan **plus** satu biaya langsung (bukti: `C006-BKK-26-07-00046`,
dan B sendiri yang menemukannya). Objek dengan daftar sendiri, enam status sendiri dan
posting sendiri tidak bisa menjadi tombol di detail objek lain. Lebih menentukan lagi:
pelebaran ke **Pay / Receive / Internal Transfer** adalah perbaikan termurah untuk G5
("uang hanya bisa keluar") dan G6 ("perpindahan antar rekening tidak bisa dinyatakan"),
dan pelebaran itu mustahil kalau Payments bukan sebuah tempat. *Saya membatalkan prinsip
B nomor 6.*

### 4.2 Suppliers/Vendors dua menu vs satu "Rekanan" → **nol menu di Finance**
Bukan dua, bukan satu. Pemilik memindahkan pendaftaran vendor ke **GA** (§0.2) dan
supplier barang ke **Buying** (`/procurement/suppliers`). Satu tabel `supplier` +
`category` (0212), tiga departemen. *Saya membatalkan prinsip B nomor 7* ("dua akun utang
⇒ dua menu"): `2012001001/002` vs `…003` adalah satu keluarga yang dipisah kolom, dan
kolom bukan menu. Nama "Rekanan" juga dibatalkan — UI hub berbahasa Inggris.

### 4.3 Inventory Accounting sebagai menu Finance → **TIDAK. Satu baris report.**
C sendiri mengkritiknya (*"a second inventory UI that drifts from the first"*), dan repo
sudah punya modul Inventory dengan pool, opname dan allotment. Isi finansialnya ada tiga:
nilai, BDP yang menua, dan selisih hitung-vs-buku — ketiganya **dibaca lalu diputuskan**,
bukan dicatat. Postingnya datang dari dokumen operasional lewat aturan (G2/G3), yang
justru prinsip E: *every posting from a submitted document*. *Saya membatalkan C menu 5 dan
B layar 17–20*, dan saya membatalkan penilaian COA yang menempatkan Inventory sebagai
"MANDATORY menu": 574 daun itu benar, tetapi keyboardnya ada di gudang.

### 4.4 Tax → **KELUAR. Nol baris, nol grup.**
Keputusan pemilik 4 September. Tetapi 168 daunnya tidak menganggur: PPh 21 adalah baris
dari posting payroll (`2012101001`), PPh 23 adalah baris `deductions[]` di pembayaran,
PPh 25 (`1011302`) dilepas saat close. Ketiganya memposting dari dokumen yang sudah ada.
Pajak kembali sebagai **modulnya sendiri** ketika ada yang meminta e-Faktur/bukti
potong/SPT — bukan sebagai grup Finance. *Saya membatalkan C menu 9 (4 tab) dan B layar
33–35.*

### 4.5 Financing / Equity → **TIDAK ADA baris**
Pinjaman adalah akun kewajiban plus jadwal angsuran: penarikannya satu Payment (Receive),
tiap angsuran satu Payment dengan baris bunga, reklas porsi lancar dan seluruh gerakan
modal adalah Journal entry. E mengatakan hal yang sama tentang `frappe/lending` (71
doctype: *"do not model it"*). 252 daun, beberapa entri setahun. *Saya membatalkan C menu
10 dan B layar 36–39.* Kalau register pinjaman kelak dibutuhkan, ia **satu baris** di
Periodic & closing, bukan grup.

### 4.6 Inter-unit sebagai menu → **YA, grup dua baris**
COA benar dan ini tidak bisa dinegosiasi: 20,1% bagan, 1.386 daun, 7 dari 9 matriks.
Tetapi *saya membatalkan* C (4 tab) dan B (4 layar) menjadi **dua**: satu dokumen yang
memiliki kedua kaki, satu matriks yang membacanya. Lihat baris 18–19.

### 4.7 Giro sebagai grup vs status → **satu baris register, bukan grup, bukan filter status**
B benar bahwa "Outstanding Giro" adalah **status** dan tidak ada baris bernama begitu di
menu ini. Tetapi giro sendiri adalah **instrumen**: lima keadaan + REVERSED
(`domain/giro.rs`, branch D), akun kliring per bank penerbit (`2012002` ×5) plus
`204001` off-ladder, dan tanggal valuta yang membedakannya dari cek. Itu objek. Keputusan
pemilik 13 Sep — "register = list" — dipakai apa adanya. Pencetakannya (0222) ada di
Setup, karena ia koordinat yang diatur sekali.

### 4.8 Receivables untuk peritel tunai → **grup dua baris, nama ERPNext dipertahankan**
Isinya tepat dua hal: uang yang masih ditahan acquirer/marketplace (`1011101`, 28 daun)
dan tagihan kartu tanpa penjualan di baliknya. Tidak ada customer, tidak ada sales
invoice, tidak ada credit note, tidak ada AR ageing, tidak ada dunning. Pinjaman staf
pindah ke Payroll. *Saya membatalkan usul COA* yang menjadikannya tab di dalam Bank —
menu Cash & Bank dibekukan pemilik pada enam baris, jadi tidak ada tab ketujuh di sana.

### 4.9 Budgeting / Cash planning → **DIJATUHKAN SELURUHNYA**
Lima tab C (`Budget Planning`, `Budget Performance`, `Cash Planning`,
`Obligation Calendar`, `Plan vs Actual`) plus `Cash Position` dan `Payment Run` adalah
**12 stub tanpa satu pun definisi tombol, form atau subtabel** — C mendakwa dirinya
sendiri lewat Design Matrix-nya. Tidak ada tabel budget, tidak ada konsep komitmen,
tidak ada endpoint; tampilan 13 minggunya diakui **hasil interpolasi**. Budget, kalau
datang, adalah sebuah modul (versi, persetujuan, encumbrance), bukan dua tab Finance.

### 4.10 Template laporan vs Query Builder → **template saja**
§11.7 + E §3.9. `Financial Report Template` + `Account Category` ERPNext menyelesaikan
ketegangan ini di hulu: bentuk tersimpan dan bernama ≠ query bebas. Laporan resmi selalu
template; query bebas hanya untuk membaca dan tidak pernah menjadi laporan. Tidak ada
baris Query Builder.

### 4.11 Integrity sebagai grup vs tab → **satu baris di Reports**
Bukan grup (E §5.2 mengusulkan tiga baris; dua di antaranya `Reposts`, yang tidak berlaku
bagi kita karena kita tidak pernah menyimpan saldo) dan bukan tab (ia dijalankan malam
hari, tidak dibuka dari dalam layar lain). Kegagalannya sudah muncul di Overview; layarnya
adalah tempat membaca yang mana yang gagal dan sejak kapan.

### 4.12 Tiga pintu Finance → **satu**
- `finance` = satu-satunya pintu.
- `finance-lab-2` = **dihapus sebagai modul**; enam layarnya dipromosikan ke `/finance/*`.
- `finance-lab` = **dicabut dari `modules[]`**, diberi `hidden: true` dan label
  **"Finance — Simulation"**, tetap ter-rute agar ⌘K dan tautan lama tidak mati; dihapus
  seluruhnya saat kontrak aturannya sudah pindah ke `docs/finance.md` dan ke uji Rust
  (§11.3) — **bukan** saat layarnya diganti. `chart-data.ts` (7.555 baris, 7.528 akun di
  bundle browser) ditinggalkan sekarang juga.
- `vendors` dan `ga-assets` tetap modul GA, bukan baris Finance.
Menutup G13.

### 4.13 Yang sengaja ditunda (dicatat agar tidak muncul lagi sebagai "gap")
**Payment Reconciliation** (pembayaran ↔ tagihan, berbeda dari Bank Reconciliation —
E §3.3 menyebutnya dua pekerjaan berbeda dan kita baru punya yang kedua) dan
**"What differs"** di rekonsiliasi bank (keputusan pemilik 13 Sep: ditunda). Keduanya
akan menjadi **tool**, bukan grup baru.

---

## 5. Yang dijatuhkan, disebut namanya

### Dari 67 tab C — 40 tidak menjadi baris

| Menu C | Yang jatuh | Kenapa |
|---|---|---|
| 1 Overview | `My Approvals`, `Exceptions` | tiga tab → tiga bagian satu layar |
| 2 Cash & Banking | `Cash Position`, `Payment Queue`, `Payment Run`, `Money Movements`, `Cash Planning`, `Obligation Calendar`, `Plan vs Actual` | 4 diserap Payments/Cash; 3 tanpa sumber data (interpolasi) |
| 3 Payables | `Suppliers`, `Aged Payables`, `Prepaid Expenses`, `Supplier Advances & Credits` | pindah ke GA · sudah jadi kolom · pindah ke Periodic · dilebur ke Advances |
| 4 Revenue | `Customer Invoices`, `Customers`, `Customer Advances & Refunds` | peritel tunai tidak menerbitkan invoice; `205001` satu akun |
| 5 Inventory | keempat tab | jadi satu report; UI stok kedua adalah tempat kedua stok berubah |
| 6 Interunit | `Settlements`, `Interunit Reconciliation` | dokumen yang sama arah terbalik; matriks yang tidak net nol |
| 7 Assets | `Transfers & Disposals` | sudah jadi aksi di layar Assets |
| 8 Payroll | `Payroll Batches` (dilebur), `Payroll Reconciliation` | pemeriksaan di layar yang sama |
| 9 Tax | keempat tab | di luar cakupan (keputusan pemilik) |
| 10 Financing | ketiga tab | akun + jadwal; payment dan journal sudah cukup |
| 11 GL & Closing | `Account Reconciliation`, `Period Closing Pack` | ditunda (§4.13) · ekspor dari Period close |
| 12 Planning & Reports | `Budget Planning`, `Budget Performance`, `Operational Reports`, `Consolidation`, `General Ledger & Trial Balance` | dua yang pertama tanpa tabel; tiga sisanya **template**, bukan baris |
| 13 Settings | `Accounts & Parties`, `Access & Approvals`, `Change History`, `Control Rules` | pindah ke Cash&Bank/GA · jadi kebijakan+RBAC · modul audit sudah ada · dilebur |
| rujukan | `Query Builder` | §11.7 |

**Tetap diangkut utuh walau bukan baris menu** (ini deliverable C yang sebenarnya):
delapan **keadaan layar** yang bisa dinyalakan satu per satu (G14 — `kosong` ≠
`takAdaHasil`, rangka isi saat memuat, `takBerizin` yang bukan nol) · sembilan **batas
antarmenu** sheet 15 dengan nama kegagalannya masing-masing · **dekomposisi status**
(dijalankan? masuk buku? cocok dengan koran? — tiga kolom, bukan satu kata) · **lima
aturan kontrol** · aturan **S01–S25** (jendela edit / aksi baris / validasi / sesudah
submit) · **26 dokumen cetak A4** dengan tujuh standar (kolom tanda tangan dibiarkan
kosong; dua total dipisah; cakupan laporan ikut tercetak) · **kamus istilah**
(Bill ≠ Invoice, Interunit ≠ Intercompany, tiga uang muka berbeda) · **tree testing yang
dijalankan**, bukan ditulis.

### Dari 52 layar B — 33 tidak menjadi baris
9 layar Overview per-grup · 3 Tax · 4 Financing · 3 Receivables → 1 · 4 Inventory → 1 ·
4 Affiliation → 2 · 6 Assets → 3 (termasuk **OE replacement dan Pre-opening**) ·
7 Accounting → 3 · 6 Reports → 2 · `/cash/transactions` (jadi `Ledger`) ·
`/accounting/rules` (salah label: itu aturan kategorisasi koran, jadi lembar dari toolbar).
Orphan: `contract.tsx` **dipromosikan** menjadi `Posting rules`; `setup.tsx`
(AccountMap + BankAccounts) **dipromosikan**; `scenarios.tsx` **menjadi uji Rust**;
`payments.tsx` **dihidupkan** sebagai baris 16; `accruals.tsx` dan `periods.tsx` dilebur.

**Tetap diangkut dari B:** kontrak tiga sumbu (bukti / kesiapan / aktivasi) sebagai SPEC ·
resolver tiga keluaran (`MISSING` ≠ `AMBIGUOUS` — dua kecocokan sekeras nol kecocokan,
resolver tidak pernah memilih) · binding dengan `valid_from`/`valid_to`/`version`
(koreksi adalah baris baru, bukan edit) — menutup G11 · pembayaran = alokasi, enam status,
**hanya SETTLED yang memposting, sekali** · target `DIRECT_EXPENSE` (tidak mengarang
payable untuk uang parkir) · pembalikan memakai akun asli · `print.tsx` seluruhnya
(`CashVoucher` satu komponen untuk BKK/BKM, "Dibayarkan kepada"/"Diterima dari") ·
`Blocked` dengan kalimat, bukan tombol mati · **`+ New` yang menavigasi ke tempat
hasilnya akan terlihat**, bukan modal.

---

## 6. Urutan pekerjaan — dari tiga pintu ke satu menu

### (a) Dipertahankan apa adanya — 11 layar, path tidak berubah
`/finance` · `/finance/bills` · `/finance/payments` · `/finance/journal` ·
`/finance/ledger` · `/finance/accounts` · `/finance/account-map` · `/finance/periods` ·
`/finance/assets` · `/finance/giro-print` · `/finance/unmatched-charges`.

### (b) Dipindah / diganti nama
| Dari | Ke | Catatan |
|---|---|---|
| `/finance-lab-2` | `/finance/cash` | + `moved: ["/finance-lab-2"]` |
| `/finance-lab-2/cash-counts` | `/finance/cash-counts` | idem |
| `/finance-lab-2/banks` | `/finance/banks` | master wajib **6 bank** (BCA, Mandiri, BRI, BNI, Danamon, BTN) — A14 |
| `/finance-lab-2/bank-accounts` | `/finance/bank-accounts` | idem |
| `/finance-lab-2/bank-transactions` | `/finance/bank-transactions` | idem |
| `/finance-lab-2/bank-reconciliation` | `/finance/bank-reconciliation` | nama tidak dipendekkan |
| `/finance/bank` (4 tab) | **dipensiunkan** | `moved` → `/finance/cash`; sesi rekonsiliasi → baris 10; tab Cards → baris 11; tab Giro outstanding **dihapus** |
| `/finance/reports` | label → `Financial statements` | path tetap |

### (c) Dipensiunkan
1. `financeLab2Nav` dihapus dari `modules[]` dan `screens/finance-lab-2/` pindah ke
   `screens/finance/`.
2. `financeLabNav`: `hidden: true`, label `"Finance — Simulation"`, dicabut dari
   `modules[]`. Dihapus total saat kontraknya ada di `docs/finance.md` + uji Rust.
3. `/finance/bank` dihapus setelah (b) selesai.
4. `chart-data.ts` (7.555 baris) dikeluarkan dari bundle.

### (d) Butuh branch D — 6 baris tidak bisa jalan tanpanya
| Baris | Modul D | Migrasi D |
|---|---|---|
| 5 Sales days | `sales_posting.rs` ×3 | `sales_posting(+line)`, `cash_shift`, `cash_movement` |
| 6 Deposits | `store_money.rs` (3.281 brs), `store_cash.rs`, `cash_document.rs`, `money.rs` | `store_deposit`, `store_bank_destination`, `remittance_order(+line,+execution)`, `cash_document` |
| 7 Petty cash | `store_money.rs` | `store_expense`, `petty_cash_replenishment` |
| 14 Settlements | `tender_recon.rs`, `settlement_report.rs`, `acquirer.rs` ×2 | `tender_reconciliation(…)`, `acquirer_settlement(…)`, **0106 (sisi D)** |
| 16 Giro register | `domain/giro.rs`, `postgres/giro.rs` | `giro` |
| 18–19 Inter-unit | inter-unit ×3 | **0120–0122** (baris jurnal menyebut unit lawannya) |
| 27 Opening balances | `opening.rs` ×3 | `opening_balance_line`, `opening_stock_line`, `opening_subledger_line` |
| 30 Stock value | `stock_ledger.rs`, `costing.rs` | `stock_ledger_entry`, `cost_layer(+adjustment)` |
| 31 Integrity checks | integrity ×3 | `integrity_run(+result)`, `attention_item` |
| 3 Payments (pelebaran) | payment ledger ×10 | `payment_ledger_entry(+settlement)`, `payment_destination(+snapshot)`, `payment_batch(+item,+event)` |
| 26 Period close (server) | period close ×3, `corrections.rs` | `fiscal_period_event`, `correction_document` |
| semua | **`decb64c` "put a role on every finance route"** | — |

**Prasyarat sebelum satu baris pun di-merge:**
1. **Push kedua branch D** — hari ini keduanya hanya ada di laptop ini (~212k baris).
2. **Renumber 49 migrasi 0106–0158 → mulai 0203** (tabrakan `0106` melawan
   `feat/handheld-rfid`, bukan melawan `main`), dan tabrakan sqlite `0020`.
3. **Ambil per modul, bukan merge borongan** — usul §11.1, dan dokumen ini adalah
   saringannya.
4. **`decb64c` (RBAC) diambil DULUAN**: `audience` di nav menyembunyikan baris, ia tidak
   memberi izin. Hari ini **tidak ada satu pun otorisasi di rute finance** — setiap
   operator terautentikasi bisa memposting jurnal, menutup periode, memetakan ulang akun.
   Menyembunyikan baris Payments dari kepala toko tanpa RBAC adalah kenyamanan yang
   berpura-pura menjadi kontrol.
5. **Yang TIDAK diambil dari D**: `reserves.rs` (cadangan OE — pemilik: OFF) dan
   `operating_fund` (lane sudah dihapus 7 Sep).

### (e) Benar-benar baru — tidak ada di A, B (sebagai kode jalan), C, maupun D
| Baris | Kenapa baru |
|---|---|
| 19 Due from / Due to | matriks 14×14; D punya jurnalnya, bukan layarnya |
| 23 Payroll postings | 13 rute payroll ada, **nol jurnal** |
| 24 Staff loans | `1011102001/002`; tidak punya rumah di kelima rancangan |
| 25 Prepaids & accruals | 322 daun; B punya layar simulasi, backend nol |
| 34 Posting rules | kontrak B ada sebagai TS, backend-nya belum ada |
| 35 Payment terms | 0201/0202 + `GET /payment-terms` ada, **layarnya tidak** |
| 37 Finance settings | kebijakan yang menyebut Role — belum ada di mana pun |
| 7 Petty cash | D punya tabelnya, tidak punya layarnya |
| — infra nav | `NavItem.kind`, `NavSection.collapsed`, `useFinanceAudience` |

**Dua field baru di `lib/navigation.ts`** (ini satu-satunya perubahan kontrak nav):
`readonly kind: "dashboard" | "document" | "tool" | "report" | "setting"` di `NavItem`, dan
`readonly collapsed?: boolean` di `NavSection`. Keduanya kecil dan keduanya menagih
sesuatu: `kind` memaksa tiap baris menjawab *apa yang kamu lakukan pada buku*, `collapsed`
memindahkan pertanyaan "harian atau sesekali" dari kepala orang ke berkas.

**Urutan commit** (karena `routes.tsx` menggagalkan build kalau path nav tidak punya layar,
menu ini mendarat dalam tiga gelombang, bukan sekali):
- **Gelombang 1 — hari ini, tanpa backend baru:** Overview + Cash & Bank +
  Receivables (baris 12) + Payables (13) + Payments (16, 17) + Assets (20) +
  Reports (28, 29) + Setup (32, 33, 35, 36) + Periodic & closing (26). `finance-lab-2` dilebur, `finance-lab` disembunyikan,
  `/finance/bank` dipensiunkan. **Satu pintu tercapai di gelombang ini.**
- **Gelombang 2 — setelah D per modul:** Store money, Giro register, Settlements,
  Inter-unit, Stock value, Integrity checks, Opening balances, pelebaran Payments.
- **Gelombang 3 — yang baru:** Posting rules, Prepaids & accruals, Payroll postings,
  Staff loans, Finance settings, Due from / Due to.

### Keputusan pemilik yang MASIH TERBUKA dan memblokir baris tertentu

| # | Keputusan terbuka | Memblokir |
|---|---|---|
| 1 | **§11.2 — pendapatan POS diposting harian dari fakta POS, atau tidak masuk ledger sama sekali?** Rekomendasi tercatat: post harian. | **baris 2** seluruhnya; dan lewat itu baris 11 (kaki kartu), baris 30 (COGS), dan laba-rugi di baris 28 yang hari ini punya biaya tanpa pendapatan (G1→G3) |
| 2 | **`revenue_qris` tidak punya padanan jujur di bagan.** Tidak boleh dilebur ke Penjualan Tunai — bagan memecah pendapatan per tender justru untuk direkonsiliasi ke aset tempat tender itu mendarat. **Harus ditanyakan.** | baris kartu QRIS di **baris 2**; QRIS sudah hidup di till |
| 3 | **`cash_variance` belum punya akun terpeta.** Kunci ke-35 dipakai `cash_counts.rs:33` tapi tidak dideklarasikan di `required_semantic_keys()` — Account Map tidak melihatnya, Period close bilang lengkap, lalu posting cash-count gagal. Keputusan COA 7 Sep mengarahkan `8010110007`; belum di-seed. | **baris 6** (posting selisih laci); cacat hidup, perbaikannya dua baris |
| 4 | **§11.1 — D: merge, ambil sebagian, atau buang?** | **10 baris** di tabel (d) |
| 5 | **Nama 14 unit belum dikonfirmasi** (C001 Cikupa … C013 Wonosobo = kandidat). Plus 8 daun bertag unit cacat (A4 `C0010`–`C0013`, A5 `H0`, A6 tanpa spasi). | label **baris 19**, pemilih unit di seluruh menu |
| 6 | **`account_map.site_id` → `site`, dan `site` tidak punya baris `ho`** (HO hanya ada di `org_place`) | **baris 23**: beban payroll HO belum bisa dipetakan |
| 7 | **Perbaikan bagan A2/A3/`600104`** — `7020310003/004/005` harus jadi `7010310…` + node `7010310` dibuat; `102160400305` namanya `C006` padahal sufiksnya `05`; `600104` akun **pendapatan** yang induknya root beban `6`. | roll-up benar di **baris 28**, pemilih akun di **baris 32**, dan routing penyusutan yang bisa salah diam-diam |
| 8 | **§11.4 — saldo kas negatif: ditolak atau diangkat sebagai eksepsi?** Di instalasi klien dibiarkan. | perilaku **baris 5, 6** |
| 9 | **§11.6 — ambang pembulatan pencocokan tagihan** | **baris 13** |
| 10 | **`204001` dan `205001` off-ladder** — diberi kode tangga, atau diterima tidak pernah masuk `201`? | roll-up **baris 28**; `204001` dipakai **baris 14** |

**Sudah tertutup, jangan dibuka lagi:** GRNI tidak ada dan tidak diadakan (klien tidak
punya; `2012001002 Suspend` tidak dipetakan) · `cash_in_transit` dihapus (setoran hari yang
sama) · cadangan OE OFF · CHEQUE dihapus (0220) · pajak di luar cakupan · piutang kepala
toko = pinjaman pribadi · float kasir tetap, satu kali per toko.

---

## 7. Pohon `nav.ts`

> Ini bentuk akhirnya. `routes.tsx` menggagalkan build kalau sebuah path tidak punya layar,
> jadi berkas ini mendarat dalam tiga gelombang (§6); baris yang layarnya belum ada
> ditandai `// GELOMBANG 2` / `// GELOMBANG 3` dan baru ditambahkan bersama layarnya.

```ts
import {
  Archive,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building,
  Building2,
  Calculator,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CircleAlert,
  Coins,
  CreditCard,
  FileStack,
  FileText,
  Files,
  Flag,
  Gauge,
  GitBranch,
  Grid3x3,
  HandCoins,
  Handshake,
  HardHat,
  Landmark,
  PiggyBank,
  Printer,
  Receipt,
  Scale,
  ScrollText,
  Settings2,
  ShieldCheck,
  Shuffle,
  TrendingDown,
  UsersRound,
  Wallet,
  Workflow,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import {
  useFailedControlCount,
  useFinanceAttentionCount,
  useFinanceAudience,
  useMonthNotOpenCount,
  useOverdueBillCount,
    useUnagreedLineCount,
  useUnansweredChargeCount,
  useUnmappedMeaningCount,
} from "@/screens/finance/badges"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// # One door, after three
///
/// Finance was registered three times at once — `finance`, `finance-lab` and
/// `finance-lab-2` — plus Vendors and GA Assets beside them, and that is the
/// whole reason it "kept going in circles": five bodies of work, none retired,
/// three of them calling themselves finance. This file is the single door.
/// `finance-lab-2`'s six screens are promoted into it; `finance-lab` keeps its
/// routes but leaves the sidebar, labelled Simulation, until its posting-rule
/// contract has been written into `docs/finance.md` and into Rust tests — not
/// until its screens are replaced, which is a different and earlier day.
///
/// # Why this shape and not the thirteen menus
///
/// The owner asked for ERPNext's proven direction on our own chart of
/// accounts, so the SPINE is ERPNext's Accounts sidebar: an entry, then the
/// domain groups in the order money moves — in at the till, into the bank,
/// what is still owed to us, what we owe, how we pay, between units — then
/// the books, then Setup near the foot, with the occasional groups closed.
/// Bills sit in Payables and payments in Payments, as ERPNext files them,
/// so no group's name promises a row that lives elsewhere. What goes INSIDE
/// each screen — the tabs, the eight screen states, the forms, the print
/// sheets, the boundary statements — stays the 11 September design's. Two
/// references, two questions, neither answering the other's.
///
/// # Kind is not group
///
/// Every item declares what it does to the books: a `document` posts when it is
/// submitted, a `tool` changes other documents without a record of its own, a
/// `report` only reads, a `setting` has to be right before any posting can
/// happen — master data included, because a master never posts — and there is
/// one `dashboard`. ERPNext files the Supplier master under Payables rather
/// than Setup for exactly this reason: kind says what a row does, the group
/// says whose work it is, and mixing the two puts half the module in Setup.
export const financeNav: AppModule = {
  id: "finance",
  label: "Finance",
  icon: Landmark,
  home: "/finance",
  // Red because one of the things it adds up is a stoppage — an unmapped
  // meaning refuses a posting outright. See `useFinanceAttentionCount`.
  badge: "bad",
  useCount: useFinanceAttentionCount,
  // Head office is the payer; a store manager counts, deposits and asks. The
  // rows without an `audience` below are the ones both of them work. This
  // hides rows and grants nothing — every bound is re-checked on the route.
  useAudience: useFinanceAudience,
  sections: [
    {
      /// The front door. One screen, two readings: head office sees every
      /// unit's queue, a store manager sees its own.
      items: [
        { path: "/finance", label: "Overview", icon: Gauge, kind: "dashboard" },
      ],
    },
    {
      /// The three documents whose keyboard is physically in a shop.
      ///
      /// This group is the answer to the one thing the 11 September design
      /// dropped: the store perspective. HR settled the shape first — one
      /// module, two faces, `audience` deciding the rows — and the argument
      /// carries, because these are not the head office's documents seen
      /// through a unit filter. They are different tables with a different
      /// approver and a Rp 500,000 ceiling: a store's outgoing money is a
      /// REQUEST, not a ledger keystroke. Spending is centralised at head
      /// office and the chart agrees — 91.5% of its 6,908 leaves are worked
      /// there.
      label: "Store money",
      items: [
        // GELOMBANG 2
        {
          path: "/finance/sales-days",
          label: "Sales days",
          icon: CalendarDays,
          kind: "document",
        },
        // GELOMBANG 2
        {
          path: "/finance/deposits",
          label: "Deposits",
          icon: PiggyBank,
          kind: "document",
        },
        // GELOMBANG 2
        // Not a request queue. Spending petty cash under Rp 500,000 is the
        // shop's right, so a row here is a fact that has already posted; the
        // ceiling is a rule on the form, and above it the row cannot be saved
        // without naming who at head office allowed it. No badge, because
        // nothing on this screen is waiting for anybody.
        {
          path: "/finance/petty-cash",
          label: "Petty cash",
          icon: HandCoins,
          kind: "document",
        },
      ],
    },
    {
      /// Six rows, frozen by the owner on 13 September, and cash is
      /// deliberately not symmetrical with bank:
      ///
      /// ```
      /// bank: ledger ↔ bank statement  → Bank Reconciliation
      /// cash: ledger ↔ physical count  → Cash Count
      /// ```
      ///
      /// So there is no Cash Account, no Cash Transaction and no Cash
      /// Reconciliation. `Bank Reconciliation` keeps the word Bank in its name
      /// because this module still owes a Payment Reconciliation — payment
      /// against invoice — and those are two jobs that would otherwise share
      /// one word. Cash and Cash Counts carry no audience: a shop counts its
      /// own drawer, and the three pots are its own.
      label: "Cash & Bank",
      items: [
        { path: "/finance/cash", label: "Cash", icon: Coins, kind: "report" },
        {
          path: "/finance/cash-counts",
          label: "Cash Counts",
          icon: Calculator,
          kind: "document",
        },
        {
          path: "/finance/banks",
          label: "Banks",
          icon: Building,
          kind: "setting",
          audience: "employer",
        },
        {
          path: "/finance/bank-accounts",
          label: "Bank Accounts",
          icon: Building2,
          kind: "setting",
          audience: "employer",
        },
        {
          path: "/finance/bank-transactions",
          label: "Bank Transactions",
          icon: ArrowLeftRight,
          kind: "document",
          audience: "employer",
        },
        {
          path: "/finance/bank-reconciliation",
          label: "Bank Reconciliation",
          icon: Scale,
          kind: "tool",
          audience: "employer",
          // Amber: an unagreed statement line is a backlog, not a stoppage.
          badge: "warn",
          useCount: useUnagreedLineCount,
        },
      ],
    },
    {
      /// For a shop that takes cash, "receivable" means exactly two things:
      /// money an acquirer or a marketplace is still holding, and a card
      /// charge with no sale behind it. There is no customer here, no invoice
      /// we issue, no credit note and no dunning — the chart offers 28 leaves
      /// for the whole idea (`1011101`). Staff loans are Payroll's.
      label: "Receivables",
      items: [
        // GELOMBANG 2
        {
          path: "/finance/settlements",
          label: "Settlements",
          icon: CreditCard,
          kind: "document",
          audience: "employer",
        },
        {
          path: "/finance/unmatched-charges",
          label: "Charges without a sale",
          icon: CircleAlert,
          kind: "tool",
          audience: "employer",
          // Amber, always — a row here is a shopper waiting for a refund, and
          // the branch cannot see it because its own day report balances.
          badge: "warn",
          useCount: useUnansweredChargeCount,
        },
      ],
    },
    {
      /// What we owe, as ERPNext files it: the bill itself, the instrument
      /// that pays later, and the money that leaves before a bill exists.
      ///
      /// The giro is an object and not a status. "Outstanding" is the status,
      /// and there is no row called that anywhere — but a thing with five
      /// states, a clearing account per ISSUING bank (`2012002`, and the
      /// off-ladder `204001`) and a value date that is the one field making it
      /// not a cheque is a register. Vendors are not here at all: the owner put
      /// registering them in GA, in five words, and what finance needs from
      /// that record it reads on the bill.
      label: "Payables",
      items: [
        {
          path: "/finance/bills",
          label: "Supplier bills",
          icon: Receipt,
          kind: "document",
          audience: "employer",
          // Recorded, not posted, and past due. Amber: the money is late, but
          // nothing is stopped by it.
          badge: "warn",
          useCount: useOverdueBillCount,
        },
        // GELOMBANG 2
        {
          path: "/finance/giro",
          label: "Giro register",
          icon: ScrollText,
          kind: "document",
          audience: "employer",
        },
        // GELOMBANG 3
        {
          path: "/finance/advances",
          label: "Advances & claims",
          icon: Handshake,
          kind: "document",
          audience: "employer",
        },
      ],
    },
    {
      /// How money actually moves, whatever it moves for. Payments is a place
      /// and not a button on a bill: it settles several bills and a direct
      /// expense in one document (`C006-BKK-26-07-00046` proved it), it pays
      /// payroll and settlements and deposits too, and it is about to carry
      /// Receive and Internal transfer as well as Pay — which is how money
      /// stops being a one-way street and how a store's daily deposit becomes
      /// expressible at all. Payment reconciliation — payment against bill,
      /// a different job from bank reconciliation — lands here when it comes.
      label: "Payments",
      items: [
        {
          path: "/finance/payments",
          label: "Payments",
          icon: Wallet,
          kind: "document",
          audience: "employer",
        },
        {
          path: "/finance/journal",
          label: "Journal entries",
          icon: FileText,
          kind: "document",
          audience: "employer",
        },
      ],
    },
    {
      /// One in five postable accounts in this company exists to record money
      /// moving between head office and a shop — 1,386 leaves, seven of the
      /// chart's nine 14×14 matrices. That is why this is a group and not a
      /// tab: a Journal screen cannot be trusted to pick a cell out of a 196-
      /// cell grid, and the two families are not interchangeable — financing
      /// settles against the financing family, goods against goods.
      ///
      /// One document owns BOTH legs. Head office and thirteen shops are one
      /// company and one book, so this is two rows of one journal and never
      /// ERPNext's inter-company machinery; what we take from ERPNext is the
      /// invariant — equal and opposite, owned by one document — and the name.
      label: "Inter-unit",
      items: [
        // GELOMBANG 2
        {
          path: "/finance/interunit",
          label: "Inter-unit transfers",
          icon: Shuffle,
          kind: "document",
          audience: "employer",
        },
        // GELOMBANG 3 — a shop reads its own row here; head office reads the
        // matrix. One screen, two readings, which is why it carries no
        // audience.
        {
          path: "/finance/unit-balances",
          label: "Due from / Due to",
          icon: Grid3x3,
          kind: "report",
        },
      ],
    },
    {
      /// The money half of the register. GA keeps the other half — where the
      /// thing is, what is on its plate, who holds it — and the two are two
      /// doors onto one register, not two registers.
      ///
      /// Closed by default, and that is about rhythm rather than size: this is
      /// the largest section of the client's chart at 2,408 leaves, and it is
      /// still opened weekly at most. There is no OE replacement reserve row.
      /// The owner expenses a replacement directly, so 1,008 leaves
      /// (`1021607` + `7010215`) sleep on purpose — and the fact that they have
      /// never moved is a finding, which belongs in Integrity checks.
      label: "Assets",
      collapsed: true,
      items: [
        {
          path: "/finance/assets",
          label: "Assets",
          icon: Archive,
          kind: "document",
          audience: "employer",
        },
        // GELOMBANG 2
        {
          path: "/finance/depreciation",
          label: "Depreciation",
          icon: TrendingDown,
          kind: "document",
          audience: "employer",
        },
        // GELOMBANG 2
        {
          path: "/finance/projects",
          label: "Projects in progress",
          icon: HardHat,
          kind: "document",
          audience: "employer",
        },
      ],
    },
    {
      /// Monthly, and it starts somewhere else: HR seals a run and finance
      /// posts it. There is deliberately no "new payroll" here, because a
      /// second place to calculate pay is a second answer to what somebody
      /// earned. Staff loans sit beside it because that is how they are
      /// recovered — `1011102002 PIUTANG KEPALA TOKO` is a personal loan, not
      /// a trade receivable, and the owner said so.
      label: "Payroll",
      collapsed: true,
      items: [
        // GELOMBANG 3
        {
          path: "/finance/payroll-postings",
          label: "Payroll postings",
          icon: UsersRound,
          kind: "document",
          audience: "employer",
        },
        // GELOMBANG 3
        {
          path: "/finance/staff-loans",
          label: "Staff loans",
          icon: Handshake,
          kind: "document",
          audience: "employer",
        },
      ],
    },
    {
      /// The month's own work: what was paid in advance and is now used up,
      /// what was used up and is not yet paid, and then the lock.
      ///
      /// `2012201 ACCRUED EXPENSE` is 140 leaves with three owners — payroll,
      /// expenses, financing — and it is read as one control here while being
      /// RAISED in each of those. One account family is not one menu.
      label: "Periodic & closing",
      collapsed: true,
      items: [
        // GELOMBANG 3
        {
          path: "/finance/schedules",
          label: "Prepaids & accruals",
          icon: CalendarRange,
          kind: "document",
          audience: "employer",
        },
        {
          path: "/finance/periods",
          label: "Period close",
          icon: CalendarClock,
          kind: "document",
          audience: "employer",
          // One, when this month is not open. Nothing can be posted into a
          // month that does not exist, which somebody usually discovers at the
          // till rather than here.
          badge: "warn",
          useCount: useMonthNotOpenCount,
        },
        // GELOMBANG 2
        {
          path: "/finance/opening",
          label: "Opening balances",
          icon: Flag,
          kind: "tool",
          audience: "employer",
        },
      ],
    },
    {
      /// Four rows, and everything else people call a report is a saved
      /// template or a filter on one of them: ageing buckets, payment ledger,
      /// trial balance by counterparty, the outstanding-items bridge, cash
      /// flow, consolidation with its elimination line, one shop against
      /// another. A named saved template is a first-class object; a free query
      /// is a way of reading and never an official report.
      ///
      /// A line of the profit and loss is a report, not a place work happens —
      /// which is why Stock value is here and not a second inventory module.
      label: "Reports",
      items: [
        {
          path: "/finance/reports",
          label: "Financial statements",
          icon: BarChart3,
          kind: "report",
          audience: "employer",
        },
        {
          path: "/finance/ledger",
          label: "Ledger",
          icon: Files,
          kind: "report",
          audience: "employer",
        },
        // GELOMBANG 2
        {
          path: "/finance/stock-value",
          label: "Stock value",
          icon: Boxes,
          kind: "report",
          audience: "employer",
        },
        // GELOMBANG 2
        {
          path: "/finance/integrity",
          label: "Integrity checks",
          icon: ShieldCheck,
          kind: "report",
          audience: "employer",
          // Red: a control equation that does not hold means a number
          // somewhere is wrong, and nobody has been told which.
          badge: "bad",
          useCount: useFailedControlCount,
        },
      ],
    },
    {
      /// The things that have to be right before any of the above can happen.
      ///
      /// Posting rules is the load-bearing half. The simulation's best screen
      /// — rules, roles and the map, each carrying its evidence, its readiness
      /// and whether it may run for this book — had no route at all, which is
      /// how three rules could be deliberately OFF and nobody could see it.
      /// It gets one here. Account map stays red rather than amber because an
      /// unmapped meaning refuses the posting outright: a stoppage, not a
      /// backlog.
      label: "Setup",
      collapsed: true,
      items: [
        {
          path: "/finance/accounts",
          label: "Chart of accounts",
          icon: FileStack,
          kind: "setting",
          audience: "employer",
        },
        {
          path: "/finance/account-map",
          label: "Account map",
          icon: GitBranch,
          kind: "setting",
          audience: "employer",
          badge: "bad",
          useCount: useUnmappedMeaningCount,
        },
        // GELOMBANG 3
        {
          path: "/finance/posting-rules",
          label: "Posting rules",
          icon: Workflow,
          kind: "setting",
          audience: "employer",
        },
        // GELOMBANG 1 — table and endpoint landed 13 Sep; the screen did not.
        {
          path: "/finance/payment-terms",
          label: "Payment terms",
          icon: CalendarCheck,
          kind: "setting",
          audience: "employer",
        },
        // Coordinates, one set per issuing bank. Setup rather than work
        // because it is done once against a real leaf and then not thought
        // about — and when it is wrong, every giro that bank prints is wrong
        // the same way.
        {
          path: "/finance/giro-print",
          label: "Giro printing",
          icon: Printer,
          kind: "setting",
          audience: "employer",
        },
        // GELOMBANG 3
        {
          path: "/finance/settings",
          label: "Finance settings",
          icon: Settings2,
          kind: "setting",
          audience: "employer",
        },
      ],
    },
  ],
}
```

Ke-37 nama ikon di atas sudah diperiksa terhadap `node_modules/lucide-react` di repo ini —
semuanya ada.

### JSON ringkas

```json
{
  "module": "finance", "label": "Finance", "home": "/finance", "badge": "bad",
  "rows": 37, "sections": 12, "collapsed_groups": 4,
  "kinds": { "dashboard": 1, "document": 19, "tool": 3, "report": 6, "setting": 8 },
  "sections_list": [
    { "label": null, "collapsed": false, "items": [
      { "path": "/finance", "label": "Overview", "kind": "dashboard", "ref": "A,C", "status": "live", "store": true }
    ]},
    { "label": "Store money", "collapsed": false, "items": [
      { "path": "/finance/sales-days", "label": "Sales days", "kind": "document", "ref": "C,COA,E", "status": "branchD", "store": true },
      { "path": "/finance/deposits", "label": "Deposits", "kind": "document", "ref": "C,COA", "status": "branchD", "store": true },
      { "path": "/finance/petty-cash", "label": "Petty cash", "kind": "document", "ref": "B,COA", "status": "branchD", "store": true }
    ]},
    { "label": "Cash & Bank", "collapsed": false, "items": [
      { "path": "/finance/cash", "label": "Cash", "kind": "report", "ref": "A,E", "status": "partial", "store": true },
      { "path": "/finance/cash-counts", "label": "Cash Counts", "kind": "document", "ref": "A,E", "status": "partial", "store": true },
      { "path": "/finance/banks", "label": "Banks", "kind": "setting", "ref": "A,E", "status": "partial", "store": false },
      { "path": "/finance/bank-accounts", "label": "Bank Accounts", "kind": "setting", "ref": "A,E", "status": "partial", "store": false },
      { "path": "/finance/bank-transactions", "label": "Bank Transactions", "kind": "document", "ref": "A,E", "status": "partial", "store": false },
      { "path": "/finance/bank-reconciliation", "label": "Bank Reconciliation", "kind": "tool", "ref": "A,E", "status": "partial", "store": false }
    ]},
    { "label": "Receivables", "collapsed": false, "items": [
      { "path": "/finance/settlements", "label": "Settlements", "kind": "document", "ref": "C,B,COA", "status": "branchD", "store": false },
      { "path": "/finance/unmatched-charges", "label": "Charges without a sale", "kind": "tool", "ref": "A", "status": "live", "store": false }
    ]},
    { "label": "Payables", "collapsed": false, "items": [
      { "path": "/finance/bills", "label": "Supplier bills", "kind": "document", "ref": "A,C,E", "status": "live", "store": false },
      { "path": "/finance/giro", "label": "Giro register", "kind": "document", "ref": "C,COA,E", "status": "branchD", "store": false },
      { "path": "/finance/advances", "label": "Advances & claims", "kind": "document", "ref": "C,B,E", "status": "new", "store": false }
    ]},
    { "label": "Payments", "collapsed": false, "items": [
      { "path": "/finance/payments", "label": "Payments", "kind": "document", "ref": "A,C,E", "status": "live", "store": false },
      { "path": "/finance/journal", "label": "Journal entries", "kind": "document", "ref": "A,B,C,E", "status": "live", "store": false }
    ]},
    { "label": "Inter-unit", "collapsed": false, "items": [
      { "path": "/finance/interunit", "label": "Inter-unit transfers", "kind": "document", "ref": "COA,C,B", "status": "branchD", "store": false },
      { "path": "/finance/unit-balances", "label": "Due from / Due to", "kind": "report", "ref": "COA,B", "status": "new", "store": true }
    ]},
    { "label": "Assets", "collapsed": true, "items": [
      { "path": "/finance/assets", "label": "Assets", "kind": "document", "ref": "A,C,E", "status": "live", "store": false },
      { "path": "/finance/depreciation", "label": "Depreciation", "kind": "document", "ref": "A,B,E", "status": "partial", "store": false },
      { "path": "/finance/projects", "label": "Projects in progress", "kind": "document", "ref": "COA,B,E", "status": "partial", "store": false }
    ]},
    { "label": "Payroll", "collapsed": true, "items": [
      { "path": "/finance/payroll-postings", "label": "Payroll postings", "kind": "document", "ref": "C,B,COA", "status": "new", "store": false },
      { "path": "/finance/staff-loans", "label": "Staff loans", "kind": "document", "ref": "COA,B,E", "status": "new", "store": false }
    ]},
    { "label": "Periodic & closing", "collapsed": true, "items": [
      { "path": "/finance/schedules", "label": "Prepaids & accruals", "kind": "document", "ref": "COA,B,C", "status": "new", "store": false },
      { "path": "/finance/periods", "label": "Period close", "kind": "document", "ref": "A,C,E", "status": "live", "store": false },
      { "path": "/finance/opening", "label": "Opening balances", "kind": "tool", "ref": "E,COA", "status": "branchD", "store": false }
    ]},
    { "label": "Reports", "collapsed": false, "items": [
      { "path": "/finance/reports", "label": "Financial statements", "kind": "report", "ref": "A,C,E", "status": "live", "store": false },
      { "path": "/finance/ledger", "label": "Ledger", "kind": "report", "ref": "A,B,E", "status": "live", "store": false },
      { "path": "/finance/stock-value", "label": "Stock value", "kind": "report", "ref": "COA,C,B", "status": "branchD", "store": false },
      { "path": "/finance/integrity", "label": "Integrity checks", "kind": "report", "ref": "E,C,B", "status": "branchD", "store": false }
    ]},
    { "label": "Setup", "collapsed": true, "items": [
      { "path": "/finance/accounts", "label": "Chart of accounts", "kind": "setting", "ref": "A,C,COA", "status": "live", "store": false },
      { "path": "/finance/account-map", "label": "Account map", "kind": "setting", "ref": "A,B", "status": "live", "store": false },
      { "path": "/finance/posting-rules", "label": "Posting rules", "kind": "setting", "ref": "B,C", "status": "new", "store": false },
      { "path": "/finance/payment-terms", "label": "Payment terms", "kind": "setting", "ref": "E", "status": "partial", "store": false },
      { "path": "/finance/giro-print", "label": "Giro printing", "kind": "setting", "ref": "A", "status": "live", "store": false },
      { "path": "/finance/settings", "label": "Finance settings", "kind": "setting", "ref": "C,E", "status": "new", "store": false }
    ]}
  ],
  "retired_modules": ["finance-lab-2"],
  "hidden_modules": ["finance-lab"],
  "not_finance_rows": ["vendors (GA)", "ga-assets (GA)"]
}
```

---

## 8. Prinsip yang dipatuhi menu ini

1. **Satu keluarga akun bukan satu menu** (B). `2012201 ACCRUED EXPENSE` punya 140 daun
   dan tiga pemilik — payroll, beban, pendanaan — jadi ia **dinaikkan** di masing-masing
   domain dan **dibaca sebagai kontrol** di Periodic & closing; ia tidak punya baris.
2. **Status bukan menu** (B). Tidak ada baris "Outstanding giro", "Aged payables",
   "Payment queue" atau "Unreconciled": semuanya kolom, filter, atau ember di layar
   objeknya — sementara giro sendiri tetap sebuah register, karena instrumen berbeda dari
   status instrumen.
3. **Satu baris P&L adalah laporan, bukan tempat pekerjaan terjadi** (B). Karena itu
   `Stock value` ada di Reports dan bukan menjadi modul persediaan kedua, dan karena itu
   tidak ada menu Tax, Financing, atau Equity meskipun ketiganya punya akun.
4. **Status tidak pernah satu kata** (C). Pembayaran punya tiga kolom bebas — sudah
   dijalankan? sudah masuk buku besar? sudah cocok dengan rekening koran? — karena dua di
   antaranya dikerjakan orang yang berbeda; penanda tahap punya empat keadaan termasuk
   **GAGAL**, karena tahap gagal bukan tahap yang kebetulan tidak aktif.
5. **Objek, tidak pernah kata kerja** (E). Setiap baris adalah benda: *Supplier bills*,
   *Giro register*, *Cash Counts*, *Due from / Due to* — tidak ada "Bayar", "Rekonsiliasi"
   atau "Buat jurnal" di sidebar; kata kerja ada di dalam layar, di dokumen yang
   melakukannya.
6. **Setiap posting berasal dari dokumen yang di-submit** (E). Himpunan hal yang bisa
   menyebabkan entri bisa disebutkan dan diuji: 19 baris ber-kind `document` plus
   `SALE_DAY` yang menunggu keputusan §11.2 — dan `journal_line` sendiri tidak punya baris
   menu di mana pun, persis seperti `GL Entry` di ERPNext.
7. **Filter adalah titik perluasan, bukan baris menu** (E). Dua belas laporan yang C dan B
   jadikan layar tersendiri menjadi template dan filter di `Financial statements` dan
   `Ledger`; ember ageing adalah data, bukan kode.
8. **91,5% bagan ini adalah pekerjaan HO** (COA). Karena itu 30 dari 37 baris membawa
   `audience: "employer"` dan toko mendapat tujuh — dan karena itu grup Store money ada
   sama sekali, karena 588 daun yang tersisa memang punya keyboard di toko.
9. **20% bagan tidak bisa jadi tab** (COA). Antarunit mendapat grup karena 1.386 daun dan
   tujuh matriks 14×14 bergerak setiap hari; sebaliknya OE replacement dengan 1.008 daun
   **tidak** mendapat baris, karena besarnya bagan mengukur permukaan, bukan pekerjaan.
10. **Akun yang tidak ada di master data jangan diadakan** (pemilik, 7 Sep). Karena itu
    tidak ada menu QRIS (tidak ada akunnya), tidak ada menu Voucher (tidak ada akun
    kewajibannya), tidak ada langkah GRNI (klien tidak punya), dan `revenue_qris` tetap
    **pertanyaan terbuka**, bukan akun yang dikarang.
11. **Kind ada di data, bukan di kepala orang** (E). `is_submittable` memisahkan document
    dari report dan `issingle + hide_toolbar` memisahkan tool dari setting di ERPNext; di
    sini `NavItem.kind` melakukan hal yang sama, dan itulah yang membuat pertanyaan
    "apakah setiap fungsi backend punya rumah?" bisa dijawab dengan membaca satu berkas.
12. **Sebuah entri menu yang endpoint-nya tidak ada lebih buruk daripada entri yang hilang**
    (People `IA-GAP.md`, dan `routes.tsx` yang menggagalkan build). Karena itu menu ini
    mendarat dalam tiga gelombang dan setiap baris membawa statusnya — live, partial,
    branch D, new — di dokumen ini, bukan di kepala seseorang.
