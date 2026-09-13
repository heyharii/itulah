# ERPNext — peta menu, dan apa yang layak diambil untuk Finance kita

**Status:** dokumen rujukan pesaing/pembanding, bukan rencana. Dibaca
2026-09-12 dari dua sumber:

* klon lokal `~/Documents/reference-erp/erpnext`, branch `develop`,
  `0849f18` (2026-08-27), `__version__ = "17.0.0-dev"`, GPL-3.0 —
  2.943 berkas Python, 645 doctype, 184 report;
* dokumentasi `https://docs.frappe.io/erpnext` (bab Accounting).

Repo publik: [frappe/erpnext](https://github.com/frappe/erpnext) — 39,1k
bintang, 12,8k fork, ~1,8k isu terbuka.

Bandingkan dengan [`./finance.md`](./finance.md), yang memegang model kita.
Bagian **banking**-nya dibedah terpisah — layar, doctype, dan bandingan fitur
demi fitur — di [`./erpnext-banking.md`](./erpnext-banking.md).

---

## 1. Menunya tidak hidup di dokumentasi

Ini hal pertama yang harus dipegang, karena mencari "menu ERPNext" di docs
akan memberi jawaban yang salah. Dokumentasi punya taksonominya sendiri
(16 bab untuk Accounting, §4). **Menu aplikasinya ada di kode**, sebagai
berkas `workspace/*.json` per modul, dan yang menggambar sidebar adalah
larik `sidebar_items` — `Section Break` untuk judul grup, `Link` untuk
isinya, dengan `link_type` DocType · Report · Workspace · Dashboard.

Artinya menu ERPNext adalah **data, bukan kode** — sama seperti `nav.ts`
kita adalah kode. Konsekuensinya: klien bisa mengubah menu tanpa build, dan
itu juga sebabnya menu mereka melebar terus.

---

## 2. Peta menu aplikasi — 15 workspace

Diurutkan seperti yang muncul di rail (`sequence_id`).

| Seq | Workspace | Modul | Link | Grup |
|---:|---|---|---:|---|
| 1 | Home | Setup | 5 | — |
| 2 | **Invoicing** | Accounts | 24 | Receivables · Payables · Payments · Reports |
| 3 | **Payments** | Accounts | 27 | Payments · Banking · Banking Setup · Dunning · Reports |
| 4 | **Accounting** | Accounts | 41 | Setup · Opening & Closing · Taxes · Budgeting · Share Management · Subscriptions · Reports · Settings |
| 5 | Buying | Buying | 38 | Setup · Subcontracting · Reports |
| 5 | **Financial Reports** | Accounts | 29 | Financial Reports · Ledgers · Registers · Profitability · Other Reports |
| 6 | Selling | Selling | 58 | POS · Items & Pricing · Setup · Reports |
| 7 | Stock | Stock | 52 | Tools · Setup · Reports · Settings |
| 7 | Assets | Assets | 20 | Maintenance · Reports · Setup |
| 8 | Manufacturing | Manufacturing | 34 | Material Planning · Tools · Reports · Setup |
| 9 | Quality | Quality Management | 11 | Setup |
| 11 | Projects | Projects | 16 | Setup · Reports |
| 12 | Support | Support | 10 | Setup · Reports |
| 17 | CRM | CRM | 36 | Reports · Maintenance · Sales Pipeline · Campaign · Setup · Settings |
| 19 | ERPNext Settings | Setup | 24 | Other Settings · Organization |

**Finance mereka bukan satu menu, melainkan empat workspace** — Invoicing,
Payments, Accounting, Financial Reports — **121 link di sidebar**, plus 64 lagi
di lapis kartu (§3). Untuk seluruh aplikasi: **425 link sidebar + 354 link
kartu** di 15 workspace. Kita satu modul Finance dengan 12 layar (hidup) dan
13 menu / 67 tab (rancangan).

Catatan cakupan: ini **hanya workspace milik ERPNext**. Frappe framework
menyumbang workspace-nya sendiri (Users, Website, Integrations, Tools,
Settings) dan tiap app lain menambah lagi; klon lokal kita tidak memuatnya,
jadi angka di atas adalah lantai, bukan plafon.

---

## 3. Empat sidebar akuntansi, isinya

### Invoicing — dokumen yang menagih dan ditagih
```
Home · Dashboard · Chart of Accounts
Receivables   Customer · Sales Invoice · Credit Note · Accounts Receivable
Payables      Supplier · Purchase Invoice · Debit Note · Accounts Payable
Payments      Payment Entry · Journal Entry · Payment Request · Payment Order ·
              Payment Reconciliation · Unreconcile Payment ·
              Process Payment Reconciliation ·
              Repost Accounting Ledger · Repost Payment Ledger
Reports       General Ledger · Trial Balance · → Financial Reports · Settings
```

### Payments — uang dan bank
```
Payments       (sama seperti blok Payments di atas, diulang penuh)
Banking        Bank Clearance · Bank Reconciliation (Tool) · Reconciliation Statement
Banking Setup  Bank · Bank Account · Bank Account Type · Bank Account Subtype ·
               Bank Guarantee · Plaid Settings
Dunning        Dunning · Dunning Type
Reports        Accounts Receivable · Accounts Payable · General Ledger ·
               Trial Balance · → Financial Reports
```

### Accounting — setup, pembukaan/penutupan, pajak, anggaran
```
Setup             Chart of Accounts · Chart of Cost Centers · Account Category ·
                  Accounting Dimension · Currency · Currency Exchange · Finance Book ·
                  Mode of Payment · Payment Term · Journal Entry Template ·
                  Terms and Conditions · Company · Fiscal Year
Opening & Closing COA Importer · Opening Invoice Tool · Accounting Period ·
                  FX Revaluation · Period Closing Voucher
Taxes             Sales/Purchase/Item Tax Template · Tax Category · Tax Rule ·
                  Tax Withholding Category · Tax Withholding Group ·
                  Lower Deduction Certificate
Budgeting         Budget · Cost Center Allocation
Share Management  Shareholder · Share Transfer
Subscriptions     Subscription · Subscription Plan · Subscription Settings
Reports           TDS Computation · Tax Withholding Details · Budget Variance ·
                  Share Ledger · Share Balance
Settings          Accounts Settings · Currency Exchange Settings
```

### Financial Reports — hanya laporan
```
Financial Reports Balance Sheet · Profit and Loss · Cash Flow · Trial Balance ·
                  Consolidated Report · Custom Financial Statement ·
                  Financial Report Template
Ledgers           General Ledger · Customer Ledger · Supplier Ledger
Registers         Accounts Receivable/Payable (+ Summary) · Sales Register ·
                  Purchase Register · Item-wise Sales/Purchase Register
Profitability     Gross Profit · Profitability Analysis ·
                  Sales/Purchase Invoice Trends
Other             Trial Balance for Party · Payment Period Based On Invoice Date ·
                  Sales Partners Commission · Customer Credit Balance ·
                  Sales Payment Summary · Address And Contacts · UAE VAT 201
```

### Lapis kedua: kartu di badan halaman

Sidebar bukan satu-satunya menu. Tiap workspace juga punya larik `links`
(`Card Break` + `Link`) yang digambar sebagai **kartu di badan halaman**, dan
isinya **tidak sama** dengan sidebar-nya:

| Workspace | Sidebar | Kartu |
|---|---:|---:|
| Invoicing | 24 | **45** |
| Payments | 27 | 0 |
| Accounting | 41 | 0 |
| Financial Reports | 29 | 19 |

Payments dan Accounting sudah pindah penuh ke sidebar; dua sisanya belum. Dan
kartu Invoicing memuat **delapan grup yang tidak ada di sidebar mana pun
Invoicing**: Multi Currency · Subscription Management · Share Management ·
Cost Center and Budgeting · Opening and Closing · Banking · Tax Masters ·
Accounting Masters. Isinya sebagian besar duplikat workspace *Accounting*.

Itu artinya satu hal yang perlu dipegang sebelum menyalin apa pun dari mereka:
**menu ERPNext tidak konsisten dengan dirinya sendiri.** Ada dua lapis, dua
lapis itu tidak sinkron, dan satu doctype bisa muncul di tiga tempat atau
tidak muncul sama sekali.

### Yang tidak punya menu sama sekali

Dari **92 doctype non-child** di modul `accounts`, **28 tidak punya satu pun
entri menu** — tidak di sidebar, tidak di kartu. Sepuluh di antaranya
submittable, artinya dokumen yang benar-benar menyentuh buku:

```
Account Closing Balance · Advance Payment Ledger Entry · Bank Transaction ·
Cashier Closing · GL Entry · Invoice Discounting · Payment Ledger Entry ·
Process Deferred Accounting · Process Period Closing Voucher · Process Subscription
```

Delapan belas sisanya adalah alat dan master yang hanya bisa dicapai lewat
pencarian atau dari dokumen lain: `Bank Statement Import` ·
`Bank Transaction Rule` · `Ledger Health` · `Ledger Health Monitor` ·
`Ledger Merge` · `Bisect Nodes` · `Bisect Accounting Statements` ·
`Process Payment Reconciliation Log` · `Process Statement Of Accounts` ·
`Party Link` · `Payment Gateway Account` · `Payment Terms Template` ·
`Accounting Dimension Filter` · `Bank Account Balance` · `Cheque Print Template` ·
`Pegged Currencies` · `Share Type` · `Bank Statement Import Log`.

Beberapa memang tidak pantas jadi menu (`GL Entry` adalah bukunya sendiri).
Tapi `Bank Transaction`, `Bank Statement Import`, `Bank Transaction Rule` dan
`Ledger Health` adalah **fitur nyata tanpa pintu** — hanya bisa ditemukan
kalau seseorang sudah tahu namanya. Itu harga dari menu yang tumbuh sebagai
data: tidak ada yang memaksa sebuah layar baru punya rumah.

Dua pola yang terlihat dan patut ditiru:

* **Empat laporan inti (AR · AP · GL · TB) diulang di kaki setiap sidebar.**
  Bukan duplikasi menu, melainkan pengakuan bahwa orang menanyakannya dari
  mana saja ia sedang berdiri.
* **Setiap sidebar punya tautan balik ke workspace lain** (`link_type:
  Workspace`), jadi empat menu itu terasa satu modul.

### Delapan aturan pembagiannya

Diturunkan dari berkasnya, bukan dari dokumentasi — dokumentasi tidak
menjelaskan ini di mana pun.

**1 · Modul ≠ workspace.** Satu modul boleh punya beberapa workspace. Keempat
workspace finance semuanya `module: Accounts`.

**2 · Empat workspace itu dibelah menurut JENIS BENDA, bukan menurut
pekerjaan.** Terukur, dengan menghitung apa yang ditunjuk tiap item:

| Workspace | dokumen | master/alat | settings | report | lompat |
|---|---:|---:|---:|---:|---:|
| Invoicing | **12** | 3 | 2 | 4 | 3 |
| Payments | **10** | 5 | 4 | 5 | 3 |
| Accounting | 5 | **25** | 5 | 5 | 1 |
| Financial Reports | 0 | 1 | 0 | **28** | 0 |

Dua workspace dokumen, satu workspace master-dan-setup, satu workspace
laporan murni. Itulah sumbunya.

**3 · Dua workspace dokumen itu dibelah lagi menurut tahap uang.** Invoicing =
janji yang menimbulkan kewajiban (faktur, nota kredit/debit). Payments = uang
yang benar-benar bergerak, plus bank.

**4 · Grup di dalam workspace adalah KATA BENDA neraca atau domain,** tidak
pernah kata kerja: Receivables · Payables · Payments · Banking · Banking Setup ·
Dunning · Setup · Opening & Closing · Taxes · Budgeting · Share Management ·
Subscriptions · Reports · Settings.

**5 · Item menu adalah OBJEK, bukan tugas.** Hanya empat `link_type`: DocType ·
Report · Workspace · Dashboard. Tidak ada entri "tutup bulan"; yang ada
`Period Closing Voucher`, sebuah dokumen. Tidak ada "cocokkan bank"; yang ada
`Bank Reconciliation Tool`.

**6 · Bentuk sidebar selalu empat lapis, dengan urutan yang sama:**

```
1  Home · Dashboard                    pintu masuk
2  dokumen utama, TANPA grup           3–7 item, langsung di atas
3  grup-grup domain                    Receivables · Banking · Taxes · …
4  Setup / Settings, lalu Reports      selalu di kaki
```

Berlaku seluruh aplikasi, bukan cuma finance. Lapis 2 adalah yang paling
berguna ditiru — Buying membuka dengan `Material Request · Request for
Quotation · Supplier Quotation · Purchase Order · Purchase Invoice`, Stock
dengan `Stock Entry · Purchase Receipt · Delivery Note · Material Request ·
Pick List`, tanpa satu pun judul grup di atasnya.

**7 · Duplikasi dibolehkan, dan disengaja.** Blok sembilan item `Payments`
muncul utuh di Invoicing **dan** di Payments. Empat laporan inti (AR · AP ·
GL · TB) diulang di kaki tiga workspace. `Chart of Accounts` ada di dua.
Aturannya: satu objek boleh punya banyak rumah.

**8 · Lompat antarworkspace adalah item menu.** `link_type: Workspace` membuat
`→ Financial Reports` muncul sebagai baris di sidebar Invoicing dan Payments,
sehingga empat menu terasa satu modul.

### Bedanya dengan pembagian kita

| | ERPNext | Rancangan 11 September kita |
|---|---|---|
| Sumbu utama | jenis benda (dokumen · master · laporan) | **domain pekerjaan** |
| Unit | 4 workspace × grup benda | 1 modul × 13 menu × 67 tab |
| Satu domain, misal pajak | tersebar: template di *Accounting → Taxes*, laporannya di *Accounting → Reports*, bayarnya lewat `Payment Entry` | **satu menu `Tax`, 4 tab**: Obligations · Documents · Payments · Filings |
| Laporan | satu workspace tersendiri, 28 laporan | tab di dalam domainnya, plus menu `Planning & Reports` |
| Setup | satu workspace tersendiri, 25 master | satu menu `Finance Settings`, 7 tab |
| Layar tanpa pintu | 28 doctype `accounts` tanpa menu | nol — `routes.tsx` gagal build kalau ada menu tanpa layar |

Keduanya sah. Yang perlu disadari: pembagian ERPNext cocok untuk **implementer
yang sedang mengonfigurasi sistem** — ia mencari objek. Pembagian kita cocok
untuk **orang yang sedang menutup bulan** — ia mencari pekerjaan. Itu sebabnya
`finance-lab/nav.ts` menolak bentuk mereka, dan alasan itu masih berlaku
untuk workspace *Accounting*; untuk *Invoicing* dan *Payments* mereka
sebenarnya sudah setengah jalan ke bentuk kita.

---

## 4. Peta dokumentasi Accounting — 16 bab

Taksonomi yang berbeda dari menunya, dan disusun sebagai **kurikulum**, bukan
sebagai daftar layar:

```
Introduction ·  Accounting Setup ·  Migration and Opening Balances ·
Sales and Receivables ·  Purchase and Payables ·  Banking and Payments ·
General Ledger, Journals and Adjustments ·  Taxes & Compliance ·
Deferred Accounting ·  Multi Currency ·  Accounting Segments ·
Budgets, Capital and Equity ·  Reports ·  Period Closing ·  Help Articles
```

Tiga bab yang isinya paling padat dan paling relevan buat kita:

* **Migration and Opening Balances** — 10 halaman sendiri: siapkan & petakan
  data lama, impor master, saldo awal, impor faktur terbuka, buka/tutup saat
  migrasi, impor uang muka + pembayaran belum teralokasi + saldo bank/stok/aset,
  validasi & koreksi migrasi, saldo di akun sementara.
* **Banking and Payments** — dibelah tiga: *Receive and Make Payments*,
  *Special Payment Scenarios* (cek kedaluwarsa, petty cash, cek mundur,
  potongan di pembayaran, PPh dipotong pelanggan), dan *Reconcile Payments and
  Banks*.
* **Period Closing** — Period Closing Voucher · Accounting Period ·
  Freeze Accounting Entries, sebagai **tiga mekanisme berbeda**.

---

## 5. Bentuk datanya

Modul `accounts` saja: **191 doctype**.

| Jenis | Jumlah | Artinya |
|---|---:|---|
| Submittable | 31 | dokumen yang di-*submit* dan menyentuh buku |
| Master / tool | 49 | akun, bank, pihak, template, alat |
| Child table | 99 | baris di dalam dokumen |
| Single / settings | 12 | pengaturan |

Tiga puluh satu yang submittable adalah daftar paling berguna di dokumen ini,
karena itulah "apa saja yang bisa menyebabkan entri":

```
Sales Invoice · Purchase Invoice · POS Invoice · POS Invoice Merge Log ·
POS Opening Entry · POS Closing Entry · Cashier Closing ·
Payment Entry · Payment Request · Payment Order ·
Payment Reconciliation · Process Payment Reconciliation · Unreconcile Payment ·
Journal Entry · GL Entry · Payment Ledger Entry · Advance Payment Ledger Entry ·
Bank Transaction · Bank Guarantee · Invoice Discounting · Dunning ·
Budget · Cost Center Allocation · Exchange Rate Revaluation ·
Period Closing Voucher · Process Period Closing Voucher · Account Closing Balance ·
Process Deferred Accounting · Process Subscription ·
Repost Accounting Ledger · Repost Payment Ledger · Share Transfer
```

---

## 6. Sebelas hal yang layak diambil, dan ke gap kita yang mana

| | Milik mereka | Kenapa layak | Gap kita |
|---|---|---|---|
| 1 | **Cashier Closing · POS Opening/Closing Entry** | tutup laci kasir adalah **dokumen akuntansi**, bukan catatan operasional — itulah jembatan yang membuat penjualan sampai ke buku | **G1** `SALE_DAY` |
| 2 | **Payment Reconciliation + Unreconcile Payment + Process …Log** | alokasi pembayaran bisa **dibatalkan sebagai dokumen**, dengan log; bukan di-*edit* | **G5** |
| 3 | **Payment Ledger Entry** terpisah dari GL Entry | saldo per pihak punya buku sendiri, jadi umur piutang/utang tidak dijumlah ulang dari GL tiap kali | ada di lane **D** (`payment_ledger.rs`) |
| 4 | **Repost Accounting Ledger / Repost Payment Ledger** | kalau aturan posting dikoreksi, entri lama **diposting ulang** oleh dokumen yang tercatat | belum ada; kita hanya punya pembalikan |
| 5 | **Period Closing Voucher** | tutup buku **memposting** laba-rugi ke laba ditahan, bukan sekadar mengunci bulan | **G7** |
| 6 | **Accounting Period + Freeze Accounting Entries** terpisah dari closing | tiga mekanisme untuk tiga maksud: periode mana yang ada, apa yang beku, dan apa yang sudah ditutup | **G7** |
| 7 | **Opening Invoice Creation Tool + COA Importer + 10 halaman migrasi** | cutover adalah fitur kelas satu dengan dokumentasinya sendiri | ada di lane **D** (`opening.rs`) |
| 8 | **Bank Transaction Rule** | aturan mengusulkan kategori, orang yang menerima | **belum ada.** Dikoreksi 2026-09-13: `0106` kita mencocokkan pengirim/subjek/nama berkas — ia memilih berkas mana milik rekening mana, bukan membaca deskripsi transaksi. Lihat [`erpnext-banking.md` §7](./erpnext-banking.md) |
| 9 | **Ledger Health · Bisect Nodes · Ledger Merge** | alat integritas sebagai layar, bukan sebagai skrip | ada di lane **D** (`integrity.rs`) |
| 10 | **Process Statement Of Accounts · Dunning** | mengirim rekening koran pelanggan dan surat tagih sebagai dokumen | belum ada, dan belum relevan sampai piutang pelanggan ada |
| 11 | **Empat laporan inti diulang di kaki tiap sidebar** | orang menanyakan AR/AP/GL/TB dari mana saja ia berdiri | murah, dan bisa dikerjakan kapan saja |

---

## 7. Tiga hal yang sengaja **tidak** kita ambil

1. **Satu menu per doctype.** `finance-lab/nav.ts` sudah menuliskan
   alasannya: bentuk itu cocok untuk implementer yang mengonfigurasi sistem,
   dan tidak cocok untuk siapa pun yang mengerjakan tutup bulan. Setelah
   membaca v17, penilaian itu perlu **disetengahkan**: sidebar *Invoicing* dan
   *Payments* sebenarnya sudah dikelompokkan per pekerjaan (Receivables ·
   Payables · Banking · Dunning); yang masih berupa tumpukan doctype adalah
   workspace *Accounting* — 41 link, delapan grup, hampir seluruhnya master
   dan pengaturan.

2. **Akun dikalikan per unit.** ERPNext memakai **Company + Cost Center +
   Accounting Dimension**; satu akun `Cash` dipakai semua cabang, dan
   cabangnya adalah dimensi. Bagan klien kita melakukan kebalikannya: 496
   template × 14 unit = **6.902 daun**. Kita mengikuti klien, bukan ERPNext —
   itu bagan mereka, dan `site_id` di setiap baris jurnal adalah dimensi kita.
   Yang perlu dicatat: dimensi kita **satu dan hard-coded**, sedangkan
   `Accounting Dimension` mereka bisa ditambah pengguna.

3. **Menyimpan saldo.** `Account Closing Balance` adalah doctype submittable —
   mereka **menyimpan** saldo penutup. Kita tidak, dan alasannya ada di
   [`finance.md` §2](./finance.md): angka tersimpan dan baris yang
   diringkasnya akan berbeda suatu hari. Ini divergensi sadar, bukan
   kelalaian; harganya adalah laporan yang lebih lambat.

---

## 8. Satu tegangan yang belum kita putuskan

**Financial Report Template · Custom Financial Statement** membiarkan pengguna
menyusun bentuk laporan keuangannya sendiri.

Keputusan 5 September kita **menolak** tombol Template/Design/Query milik
Seventhsoft, dengan alasan "membiarkan pengguna menyunting query laporan
adalah cara mendapat 26 versi kebenaran yang berbeda". Tapi rancangan
11 September kita **punya layar Query Builder**, dan ERPNext memisahkan
keduanya dengan rapi: *template laporan* (bentuk yang tersusun dari akun dan
rumus, tersimpan, bernama) berbeda dari *query bebas*.

Pemisahan itu yang sebaiknya kita pakai, dan itu perlu ditulis sebagai
keputusan — lihat [`finance.md` §11](./finance.md).
