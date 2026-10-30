# Finance 7Soft-first — rencana parity lalu lapisan ERP+

**Tanggal:** 27 Oktober 2026
**Keputusan:** 7Soft adalah software yang dipakai sekarang. Menu dan alur 7Soft menjadi
**lapisan utama**; fitur ERP yang belum ada di 7Soft ditambahkan **di atasnya** sebagai
lapisan `ERP+`, bukan mengganti menu 7Soft lebih dulu.
**Sifat:** rencana kerja + perubahan prototipe dicatat di §10. Frontend-hub dan backend tidak disentuh.

---

## 0. Prinsip

1. **Parity dulu, convergence kemudian.** 25 menu 7Soft harus terasa sama: nama menu, urutan,
   tab, field, tombol, nomor dokumen, nama laporan, dan label status.
2. **Backend tetap sumber kebenaran.** UI 7Soft boleh memakai istilah 7Soft, tetapi angka,
   posting, dan status diambil dari backend cloud.
3. **Adapter di antara keduanya.** Perbedaan istilah/status diselesaikan di adapter, bukan
   dengan mengubah label 7Soft atau memaksa backend memakai istilah 7Soft.
4. **ERP+ bersifat aditif.** Fitur seperti Stores, bank reconciliation, accruals, tax,
   opening, inter-unit, payroll, dan setup diletakkan di group **“Di luar 7Soft”**; baru
   dipromosikan ke 9 pintu setelah parity stabil.
5. **Jangan hapus layar 7Soft yang belum punya padanan.** Faktur Penjualan, Retur Penjualan,
   Info Penjualan, dan customer master tetap ada di lapisan 7Soft; statusnya `bridge` atau
   `legacy` sampai ada keputusan produk.

---

## 1. Dua lapis menu

### Lapis A — 7Soft parity (menu utama)

6 grup, 25 baris, urutan seperti 7Soft:

```
Kas - Bank
  Info Kas Bank · BKM · BKK · Pencairan BG · Laporan Kas/Bank
GL · Buku Besar
  Info Accounting · Transaksi Jurnal · Closing Periode · Laporan Accounting & Keuangan
Pembelian
  Info Pembelian · Faktur Pembelian · Invoice Retur Beli · Laporan Pembelian
Penjualan
  Info Penjualan · Penjualan Cash · POS · Faktur Penjualan · Retur Penjualan · Laporan Penjualan
Master
  Account · Saldo Awal COA · Setting COA · Set Up · Customer · Supplier · Pajak · Asset ·
  User & Group · History
```

Default aplikasi sebaiknya membuka **lapisan ini** (desain Central, label 7Soft), bukan mode
`Before → After`. Mode perbandingan tetap ada untuk review desain.

### Lapis B — ERP+ (tambahan)

14 baris di group **“Di luar 7Soft”**:

```
Overview · Stores · Shop cash · Payables · Cash & Bank · Journal · Month End · Assets ·
Reports · Setup · Inter-unit · Payroll · Opening · Between units
```

Lapis ini tidak mengubah nama/urutan 7Soft. Ia menjadi tempat fitur yang 7Soft tidak punya.
Saat convergence, baris-baris ini dipromosikan ke 9 pintu hub; 7Soft tetap menjadi alias.

### Referensi

Replika 7Soft (`7Soft BKM · BKK replica`) tetap di group **“Referensi 7Soft”**; bukan menu
produksi.

---

## 2. Checklist parity 7Soft

Untuk setiap dari 25 layar, isi checklist ini sebelum dianggap selesai:

| Dimensi | Yang harus sama |
|---|---|
| Menu | Nama, grup, urutan, ikon |
| Layar | Judul, tab, urutan tab |
| Field | Nama field, urutan, mandatory/readonly, format angka/tanggal |
| Tombol | First/Prior/Next/Last, New, Save, Delete, Filter, Refresh, Print, Info, XLS |
| Tabel | Kolom, urutan, lebar, footer total, grouping |
| Nomor dokumen | Prefix 7Soft: `KM`, `KK`, `BLI`, `PJL`, `RBL`, `RPJ`, dll. |
| Status | Label 7Soft di permukaan; mapping ke backend di adapter |
| Laporan | Nama, kolom, filter, total, print |
| Shortcut | Ctrl+N/S/D/F/P dan tombol toolbar |
| Print | Slip BKM/BKK, giro, laporan |
| Error | Pesan validasi yang bisa dimengerti operator 7Soft |

Checklist ini disimpan per layar di `financeScreenContract`.

---

## 3. Peta 7Soft → backend

Kolom **Adapter** adalah pekerjaan yang membuat istilah 7Soft cocok dengan backend tanpa
mengubah backend.

| # | Menu 7Soft | Endpoint backend | Adapter / keputusan | Fase |
|---:|---|---|---|---|
| 1 | Info Kas Bank | `/accounts`, `/balances`, `/statement`, `/bank-accounts`, `/bank-statements`, `/bank-lines`, `/cash-counts`, `/deposits`, `/giros`, `/advances` | Periode/lokasi 7Soft → query; saldo buku vs bank; kolom 7Soft tetap | 1 |
| 2 | BKM · BKK | `/cash-documents`, `/{id}/approve|post|reverse|slip`, `/cash-document-repeats` | `KM`/`KK` → direction; line type 7Soft → cash-document lines; tombol 7Soft di atas lifecycle backend | 1 |
| 3 | Pencairan BG | `/giros`, `/giros/board`, `/giros/{id}/deliver|due|clear|reject|replace` | `New→ISSUED/DELIVERED`, `Overdue→DUE`, `Bounced→REJECTED`, `Cleared→CLEARED` | 1 |
| 4 | Laporan Kas/Bank | `/statement`, `/balances`, `/payments`, `/cash-documents`, `/deposits`, `/giros`, `/acquirer-settlements`, `/payables-aging` | Definisikan 20 laporan 7Soft → query/komposisi; pertahankan nama & kolom | 1 |
| 5 | Info Accounting | `/accounts`, `/journal`, `/trial-balance`, `/statement`, `/ledger-health` | Tab ACCOUNT/JURNAL/ALL JURNAL/BUKU BESAR PEMBANTU/NERACA SALDO | 2 |
| 6 | Transaksi Jurnal | `/journal`, `/journal/drafts`, `/journal/{id}/reverse`, `/journal-templates`, `/journal-repeats` | Form 7Soft → draft/submit/post/reverse; nomor `GL` | 2 |
| 7 | Closing Periode | `/periods`, `/{id}/checklist`, `/{id}/events`, `/periods/close`, `/close/soft`, `/{id}/reopen`, `/period-closing-vouchers` | `Open/Closed/Not yet` + `SOFT_CLOSED`; tombol Create/Closing/Undo | 2 |
| 8 | Laporan Accounting & Keuangan | `/statement`, `/reports/profit-and-loss`, `/reports/balance-sheet`, `/reports/unit-results`, `/reports/dimension-results`, `/reports/expenses-by-month`, `/reports/sales-by-division`, `/trial-balance`, `/reports/withholding` | Nama laporan 7Soft; cash flow via `statement?kind=CASH_FLOW`; equity dihitung UI dulu | 2 |
| 9 | Info Pembelian | `/bills`, `/bill-templates`, `/credit-notes`, `/supplier-advances`, `/payables-aging`, `/payment-ledger`, `/payment-batches` | Tab supplier/PO/pembelian/retur/pelunasan/summary/kartu; label 7Soft | 3 |
| 10 | Faktur Pembelian | `/bills`, `/{id}/match|post|hold|release|return|warnings`, `/three-way` | Tipe M/S/U 7Soft; status bayar diturunkan dari alokasi | 3 |
| 11 | Invoice Retur Beli | `/credit-notes`, `/{id}/post|refund` | Form retur 7Soft; nomor `RBL` | 3 |
| 12 | Laporan Pembelian | `/payables-aging`, `/payment-ledger/aging`, `/payment-ledger/integrity`, `/bill-templates` | 33 laporan 7Soft → definisi query; prioritas yang dipakai harian | 3 |
| 13 | Info Penjualan | `/sales-postings`, `/receipts`, `/acquirer-receivable-aging` | **Bridge/legacy**: tidak ada debtor book; pertahankan layar, tandai batasnya | 3 |
| 14 | Penjualan Cash · POS | `/sale-days`, `/sales-postings`, `/sales-posting-exceptions`, `/store/{unit}/tender-recon` | Sales day/tender; status 7Soft | 3 |
| 15 | Faktur Penjualan | Sales module / bridge | **Legacy/bridge**: jangan hapus; putuskan apakah Sales module atau emulasi Finance | 3 |
| 16 | Retur Penjualan | Sales module / bridge | **Legacy/bridge** | 3 |
| 17 | Laporan Penjualan | `/reports/sales-by-division`, `/sales-postings`, `/acquirer-settlements` | Laporan penjualan 7Soft; sebagian pindah ke Sales | 3 |
| 18 | Account | `/accounts`, `/chart-changes` | COA 10/12 digit; label 7Soft | 2 |
| 19 | Saldo Awal COA | `/opening/balances`, `/opening/stock`, `/opening/subledger`, `/opening/report` | Form 7Soft → import/commit; tampilkan cutover report | 2 |
| 20 | Setting COA | `/account-links`, `/account-link-history`, `/posting-readiness`, `/policies/posting`, `/policies/source-rules`, `/party-links` | Setting COA 7Soft → account links; tampilkan readiness | 2 |
| 21 | Set Up | `/settings`, `/number-series`, `/permissions`, `/dimensions`, `/payment-methods`, `/sites/{site}/payment-methods`, `/edc-*`, `/pay-components`, `/expense-categories`, `/line-categories`, `/giro-print-templates`, `/tax/types`, `/asset-classes` | Tab Set Up 7Soft → setting backend; nomor dokumen 7Soft | 2–3 |
| 22 | Customer · Supplier · Pajak | `/api/v1/suppliers`, `/api/v1/payment-terms`, `/tax/types`, `/party-links` | **Bridge**: supplier write ke modul supplier; customer ke Sales/CRM; Finance membaca | 3 |
| 23 | Asset | `/assets`, `/depreciation/*`, `/assets/{id}/assess|schedule|dispose|transfer`, `/assets/reserve/*`, `/asset-classes` | Register 7Soft; label Active/Inactive; tambah reserve | 3 |
| 24 | User & Group | `/permissions`, People/auth | Permission 7Soft → role backend; group di People | 3 |
| 25 | History | audit log, `/chart-changes`, `/controls`, `/attention` | Activity 7Soft; tambah before/after bila perlu | 3 |

---

## 4. Keputusan kompatibilitas

### 4.1 Customer AR / sales invoice / sales return

7Soft punya Info Penjualan, Faktur Penjualan, dan Retur Penjualan. Backend Finance **tidak**
punya debtor book; yang ada sales postings, receipts, dan acquirer receivable aging.

Keputusan untuk fase ini:

1. **Pertahankan layar 7Soft** dengan label dan alur yang sama.
2. Tandai sebagai **bridge**:
   - Info Penjualan → sales postings/receipts; jika tidak cukup, legacy read-only.
   - Faktur Penjualan/Retur → Sales module; jika belum ada, legacy read-only.
3. Jangan menghapus dari menu sampai ada keputusan produk dan migrasi data.
4. Jangan menambah tabel customer AR baru hanya demi parity; itu keputusan domain, bukan UI.

### 4.2 Supplier / customer master

- 7Soft `Customer · Supplier · Pajak` tetap tampil.
- Supplier write diarahkan ke `/api/v1/suppliers`; Finance hanya membaca.
- Customer write diarahkan ke Sales/CRM; Finance tidak memiliki master customer.
- Pajak tetap di Setup/Tax.

### 4.3 Status

Label 7Soft dipertahankan di permukaan; adapter memetakan:

| 7Soft | Backend |
|---|---|
| BKM/BKK `Posted` | `DRAFT → APPROVED → POSTED → REVERSED` (UI 7Soft menyembunyikan draft/approve) |
| Giro `New` | `ISSUED` / `DELIVERED` |
| Giro `Overdue` | `DUE` |
| Giro `Cleared` | `CLEARED` |
| Giro `Bounced` | `REJECTED` |
| Bill `Due` | status turunan dari due date + alokasi |
| Bill `Overdue` | status turunan |
| Bill `Paid` | status turunan dari `supplier_payment_allocation` |
| Deposit `In transit` | `DEPOSITED` |
| Deposit `Cleared` | `CONFIRMED` |
| Payment batch `Draft/Ready/Executed` | `DRAFT/READY/EXECUTED`; tambah `PARTIAL/HELD/CANCELLED` hanya di ERP+ |
| Periode `Open/Closed` | `OPEN/CLOSED`; `SOFT_CLOSED` hanya di ERP+ |

### 4.4 Nomor dokumen

Pertahankan prefix 7Soft di nomor dokumen:

```
KM / KK      BKM / BKK
BLI          Faktur Pembelian
RBL          Retur Beli
PJL          Faktur Penjualan
RPJ          Retur Penjualan
GL           Jurnal
```

Gunakan `/number-series/{kind}` dengan alias prefix; jangan membuat seri baru yang
membingungkan operator 7Soft.

### 4.5 Laporan

- Nama dan kolom laporan mengikuti 7Soft.
- Isi diambil dari endpoint backend; kalau tidak ada satu endpoint, komposisi di adapter.
- Laporan yang tidak dipakai harian ditandai `later`; jangan memblokir parity core.

---

## 5. Urutan kerja

### Fase 0 — kontrak dan checklist

1. Isi checklist parity 25 layar.
2. Buat `financeScreenContract` dua lapis.
3. Putuskan bridge customer AR/sales invoice.
4. Tetapkan default aplikasi: lapisan 7Soft, desain Central.

**Selesai bila:** setiap layar 7Soft punya endpoint/status bridge dan tidak ada menu tanpa
pemilik.

### Fase 1 — Cash & Bank parity

Info Kas Bank · BKM/BKK · Pencairan BG · Laporan Kas/Bank.

- Adapter periode/lokasi.
- Cash document lifecycle.
- Giro status mapping.
- Laporan kas/bank prioritas.
- Print slip/giro.

**Selesai bila:** operator 7Soft bisa menyelesaikan pekerjaan kas/bank tanpa membuka layar ERP+.

### Fase 2 — GL, closing, laporan

Info Accounting · Jurnal · Closing · Laporan Accounting · Account · Saldo Awal · Setting COA ·
Set Up.

- Jurnal draft/submit/reverse.
- Closing checklist/soft close.
- Laporan keuangan.
- COA/opening/setting.
- Number series 7Soft.

**Selesai bila:** tutup buku dan laporan bulanan bisa dilakukan dari menu 7Soft.

### Fase 3 — Purchasing, sales, master

Info Pembelian · Faktur Pembelian · Retur Beli · Laporan Pembelian · Info Penjualan · POS ·
Faktur/Retur Penjualan · Laporan Penjualan · Customer/Supplier/Pajak · Asset · User & Group ·
History.

- Bills/credit notes/supplier ledger.
- Sales postings/receipts/tender.
- Bridge AR/invoice/return.
- Master bridge.
- Assets/users/history.

**Selesai bila:** seluruh 25 menu 7Soft punya perilaku yang disepakati (live/bridge/legacy).

### Fase 4 — ERP+ layer

Baru setelah parity:

- Stores daily money.
- Bank reconciliation.
- Month End accruals/inventory/tax.
- Opening, inter-unit, payroll.
- Reports tambahan.
- Setup lanjutan.

### Fase 5 — convergence

- Promosikan ERP+ ke 9 pintu.
- 7Soft menjadi alias pencarian.
- Pertahankan label 7Soft untuk pengguna lama.

---

## 6. Kriteria penerimaan

1. **Tanpa istilah ERP di lapisan 7Soft.** Operator melihat “Info Kas Bank”, “BKM”, “Pencairan
   BG”, bukan “Bank Reconciliation”, “Payment Batch”, “Accrual”.
2. **Backend sumber kebenaran.** Tidak ada posting lokal di UI; semua lewat endpoint.
3. **Status mapping teruji.** Setiap label 7Soft punya test yang memetakan ke status backend.
4. **Nomor dokumen 7Soft.** Tidak ada nomor baru yang memutus kebiasaan operator.
5. **Laporan parity.** Nama/kolom/total sama; angka berasal dari backend.
6. **Tidak ada menu yatim.** Setiap layar punya `layer`, `route`, `endpoint`, `owner`.
7. **ERP+ tidak mengganggu.** 7Soft tetap bisa dipakai penuh tanpa membuka group ERP+.
8. **Print/export.** Slip BKM/BKK, giro, dan laporan bisa dicetak.

---

## 7. Yang jangan dilakukan dulu

- Jangan mengganti menu 7Soft dengan 9 pintu sekarang.
- Jangan menghapus Faktur Penjualan/Retur Penjualan/Info Penjualan/customer master.
- Jangan menampilkan status backend mentah (`DRAFT`, `MATCHED`, `SOFT_CLOSED`) di lapisan 7Soft.
- Jangan membangun domain backend baru sebelum parity core terbukti.
- Jangan mewiring ERP+ sebelum Cash & Bank/GL 7Soft selesai.
- Jangan memakai angka statis di produksi; prototipe boleh, produksi tidak.

---

## 8. Langkah berikutnya

1. **Pilot:** Info Kas Bank + BKM/BKK.
   - Buat route contract.
   - Sambungkan ke `/accounts`, `/balances`, `/cash-documents`.
   - Buat adapter status/nomor.
   - Uji satu siklus: buat BKM → approve → post → reverse → laporan.
2. **Setelah pilot:** Pencairan BG + Laporan Kas/Bank.
3. **Baru:** GL/closing, lalu purchasing/sales/master.
4. **ERP+** menyusul; jangan dicampur ke menu 7Soft.

---

## 9. Satu kalimat

> Fase ini bukan “pindah ke 9 pintu”, tetapi **menjadikan 7Soft sebagai kulit utama yang
> terhubung ke backend cloud**, lalu menambahkan 9 pintu/ERP+ sebagai lapisan di atasnya
> setelah parity 7Soft terbukti.


---

## 10. Perubahan prototipe yang sudah dilakukan

Fokus: **prototipe saja**, bukan frontend-hub/backend.

| Perubahan | Efek |
|---|---|
| Default mode menjadi **After · Central** | Halaman membuka lapisan 7Soft dengan desain Central, bukan mode perbandingan |
| BKM · BKK, Pencairan BG, replika dibuka **di dalam shell** | Menu Finance tidak hilang; ada tombol **Open full screen** |
| Print/Export nyata di **Laporan Kas/Bank** | Print memakai print view; Export CSV dari tabel |
| Print/Export nyata di **Laporan Accounting** | Link Print/Export tidak lagi toast |
| Print/Export nyata di **Laporan Pembelian** dan **Laporan Penjualan** | Print view + CSV |
| **Print voucher** BKM/BKK | Slip/voucher dicetak dari sheet, bukan toast |
| 7Soft groups tetap di atas; **Di luar 7Soft** di bawah | Struktur 7Soft-first dipertahankan |

**Belum disentuh:** layout frontend-hub, route hub, backend cloud, wiring API.

---

## 11. Frontend-hub: perubahan 27 Oktober 2026

Keputusan owner malam ini: kerjakan langsung di `frontend-hub`, **hanya bagian finance**, sesuai
prototipe dan hasil diskusi. Dua hal dikerjakan; satu hal sengaja tidak.

### 11.1 Master barang tidak diduplikasi

7Soft menaruh **Item** di menu Master. Hub sudah punya master itu di `Master → Articles`
(`article_code`, colourway, size, division, tag, harga dasar, stok) dan di `Master → Units`,
`Master → Organisation`, `Master → Suppliers`; customer di `Sales → Customer`.

Halaman **Finance → Setup** sekarang menutup celah itu dengan blok
**“Master kept outside Finance”**: Item, Satuan, Gudang, Supplier, Customer — masing-masing
menunjuk ke pemiliknya. Finance membaca, tidak menyalin. Alasannya sudah dibuktikan di
diskusi: dua master item akan menyimpang, dan stok berhenti cocok dengan buku besar.

### 11.2 Peta parity 7Soft di dalam aplikasi

Halaman baru **Finance → 7Soft parity** (`/finance/7soft-parity`) memuat 25 menu 7Soft dalam
grup dan urutan 7Soft, masing-masing menunjuk layar hub yang menjawab pekerjaan itu, dengan
status: **In the hub / Partly / Bridge / No screen**.

Halaman ini juga menjawab pertanyaan “di mana Faktur Penjualan?” tanpa mengarang layar:
baris tanpa layar ditulis **No screen**, bukan tombol yang membuka halaman kosong.

### 11.3 Menu samping sekarang 7Soft-first

Menu Finance ditulis ulang **tanpa menambah satu route pun**. Setiap path tetap muncul tepat
sekali — `routes.tsx` membangun satu route per item, jadi baris kedua untuk path yang sama
akan menggandakan route — caranya:

- 9 pintu ERP+ yang sudah ada **diberi nama 7Soft**: Cash & Bank → **Info Kas Bank**,
  Journal → **Transaksi Jurnal**, Period Close → **Closing Periode**, Reports →
  **Laporan Accounting**, Bills → **Faktur Pembelian**, Setup → **Set Up**,
  Assets → **Asset**, Stores → **Penjualan Cash · POS**.
- Grup mengikuti 7Soft: **Kas - Bank · GL · Buku Besar · Pembelian · Penjualan · Master**.
- **Tidak ada baris yang mengulang isi tab** (owner, 28 Okt 2026). BKM, BKK, Giro, Bank ada
  di tab Info Kas Bank; Bills, Due dates, Suppliers, Credit notes, Loans ada di tab Faktur
  Pembelian; General Ledger dan Trial Balance ada di tab Laporan Accounting. Menu samping
  hanya memuat 12 baris + **7Soft parity**, bukan 25.
- **Overview dihapus dari menu** (owner, 28 Okt 2026). Modul Finance mendarat di
  **Info Kas Bank**; dashboard tetap punya route dan entri ⌘K, jadi bookmark lama tidak 404.

Tiga baris 7Soft belum punya layar dan karenanya **tidak muncul di menu**:
**Faktur Penjualan**, **Saldo Awal COA**, **History**. Ketiganya terlihat di halaman
**7Soft parity** dengan status *No screen*, bukan tautan mati.
