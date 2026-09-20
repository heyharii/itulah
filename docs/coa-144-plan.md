# COA 144 — bagan yang bisa diedit, buku besar yang tetap dijaga

**Tanggal:** 19 September 2026 · **Status:** usulan, menunggu putusan pemilik.
**Sumber bagan:** `~/Downloads/COA_144.xlsm - Pemetaan Semua Akun.csv` —
7.528 baris akun klien, 6.894 di antaranya dipetakan ke **144 akun natural**,
634 sisanya baris group/heading.
**Riset pembanding:** klon ERPNext lokal di `~/Documents/reference-erp/erpnext`
(`0849f187e7`), bukan dokumentasi web — semua klaim di §3 menyebut berkas dan baris.

Bacaan pendamping: `coa-40-contract.md` (bentuk yang sekarang ada di working tree),
`coa-final.md` (§3 penolakan cost center), `finance-posting-kernel.md`,
`finance-source-kind-mapping.md`, `finance-legacy-codes.md`.

---

## 0. Tiga pertanyaan, tiga jawaban pendek

**1. "Apakah COA kita sudah terintegrasi semua?"**
Hampir semuanya — dan justru itu yang perlu dilihat sebelum memutuskan "loose".
**25 modul** backend sudah membangun jurnal, semuanya lewat satu pintu
(`poster::post`). Dari **190 akun** yang bisa diposting hari ini di DB dev:

| posting_mode | manual_je_policy | jumlah akun |
|---|---|---|
| AUTO_ONLY | NO | 66 |
| AUTO_ONLY | OVERRIDE | 20 |
| SEMI_AUTO | OVERRIDE | 56 |
| SEMI_AUTO | YES | 46 |
| SEMI_AUTO | NO | 1 |
| **MANUAL** | OVERRIDE | **1** |

Satu akun. Bagan hari ini adalah **kebalikan** dari rencana loose. Yang benar-benar
belum terintegrasi ada empat, disebut persis di §1.4.

**2. "Bikin loose / GL-first?"**
Tuasnya sudah ada dan tidak perlu tabel baru. `posting_mode` × `manual_je_policy`
(migrasi 0261–0268) **persis** lima anak tangga yang Anda tulis — pemetaannya di §4.4.
Yang belum ada bukan mesin kebijakan, melainkan **layar jurnal manual yang layak jadi
pintu utama**. Kalau fase 1 berarti finance mengetik ribuan JE, layar seadanya adalah
sumber bug yang lebih besar daripada automation yang ditunda.

**3. "Unit jadi cost center?"**
Sudah, namanya `journal_line.site_id`: `NOT NULL`, `REFERENCES site(id)`, 14 baris
(`dc` + `store-01`…`store-13`) = **HO + C001…C013** klien. Setiap baris jurnal —
neraca maupun laba-rugi — selalu membawanya. Itu lebih ketat daripada ERPNext, yang
hanya mewajibkan cost center pada akun laba-rugi. Rinciannya di §5.

### Dan satu temuan yang mengubah ongkos seluruh rencana

> **Migrasi 0287–0297 — peleburan 190 → 43 akun + 149 kategori — belum pernah di-commit.**
> Sebelas berkas itu masih `??` (untracked) di working tree; HEAD repo berhenti di **0286**.
> Jadi memilih 144 bukan "membatalkan pekerjaan yang sudah mendarat", melainkan
> **menulis ulang sebelas berkas yang belum masuk sejarah**. Kalau putusan 144 diambil,
> ambil sekarang — begitu 0287–0297 di-commit dan dijalankan di Render, harganya berlipat
> (lihat `itulah-render-autodeploy`: push ke main = live).

---

## 1. Keadaan hari ini, terukur

### 1.1 Bagan

| | nilai | dari mana |
|---|---|---|
| baris `ledger_account` di DB dev | 318 (190 postable) | `itulah_dev`, head migrasi **0276** |
| bentuk di working tree (belum commit) | **43 akun** + 140 kategori/16 keluarga + 59 kelas aset | 0287–0297, `coa-40-contract.md` |
| bagan klien | 7.528 baris → **144 akun natural** | CSV COA_144 |

DB dev tertinggal 21 migrasi dari working tree. Itu berarti **setiap angka yang diambil
dari DB dev menggambarkan bentuk 190, bukan 43.** Sebelum lane mana pun menulis kode
terhadap bagan baru, DB dev harus dibawa ke head (lihat `itulah-sync-health-dashboard`).

### 1.2 Kolom yang sudah ada di `ledger_account`

```
account_code  text PK        CHECK (account_code ~ '^[0-9]+$')
parent_code   text           CHECK (account_code LIKE parent_code || '%')   ← pohon PREFIKS
root_class    char(1)        GENERATED ALWAYS AS (left(account_code,1))
depth         smallint       GENERATED ALWAYS AS (length(account_code))
is_group      boolean        (FK gabungan ke journal_line memastikan group tak bisa diposting)
is_active     boolean
dimension     text           CHECK (dimension IN ('unit','company'))  — NULL ⇔ is_group
normal_balance char(1) · is_contra boolean
posting_mode  text           AUTO_ONLY | SEMI_AUTO | MANUAL | BLOCKED
manual_je_policy text        NO | OVERRIDE | YES
posting_policy_configured boolean
code_provenance text         CLIENT | PENDING_CLIENT_CODE
requires_counter_site boolean
```

**Yang belum ada:** `system_role`, `account_type`, `report_line`, `archived_at`,
`client_code`, `ever_used`.

**Dua batasan yang menentukan seberapa "ERPNext" bagan ini bisa jadi:**

1. `parent_code` harus **prefiks** dari `account_code`. Memindahkan akun ke induk lain
   = mengubah kodenya = mengubah PK yang dirujuk `journal_line`. Di ERPNext parent hanya
   link biasa (§3.4).
2. `root_class` adalah kolom **generated** dari digit pertama, dan `financial_statements.rs`
   mengelompokkan dengannya (37 rujukan di 4 berkas). Rollup prefiks `LIKE code || '%'`
   dipakai di `ledger.rs`, `journal.rs`, `statements.rs` (8+ tempat).

### 1.3 Mesin yang sudah jalan

Satu pintu: `poster::post` / `poster::reverse`. **25 modul** membangun `PostingIntent`.

| domain | `source_kind` | produsen | status |
|---|---|---|---|
| Penjualan harian (POS) | `SALE_DAY` `RETENDER` | `sales_posting.rs` | ✅ |
| HPP, landed cost, retur ke supplier | `COGS_DAY` `LANDED_COST` `CREDIT_NOTE` | `stock_ledger.rs` | ✅ |
| Penerimaan barang | `GOODS_RECEIPT` | `payables_flow.rs` | ✅ |
| Faktur & uang muka supplier | `SUPPLIER_INVOICE` `SUPPLIER_ADVANCE` | `payables.rs`, `payables_flow.rs` | ✅ |
| Pembayaran | `PAYMENT` | `payments.rs`, `payment_execution.rs` | ✅ |
| Giro | `GIRO` | `giro.rs` | ✅ |
| Settlement acquirer | `ACQ_SETTLEMENT` | `acquirer.rs` | ✅ |
| Uang toko (shift, setoran, petty, beban toko) | `CASH_SHIFT` `STORE_DEPOSIT` `PETTY_REPLENISH` `STORE_EXPENSE` `ADVANCE` `RECLASS` | `store_money.rs` | ✅ |
| Dokumen kas & hitung kas | `CASH_DOC` `CASH_COUNT` | `cash.rs`, `cash_counts.rs` | ✅ |
| Setoran | `DEPOSIT` | `deposits.rs` | ✅ |
| Aset: kapitalisasi, disposal, transfer | `ASSET_*` | `assets.rs` | ✅ |
| Penyusutan & amortisasi | `DEPRECIATION` `AMORTIZATION_RUN` | `assets.rs`, `depreciation.rs`, `prepaid.rs` | ✅ |
| Cadangan penggantian OE | `ASSET_RESERVE` | `reserves.rs` | ✅ |
| Pajak | `TAX_SETTLEMENT` | `tax.rs` | ✅ |
| Saldo awal | `OPENING` | `opening.rs`, `ledger.rs` | ✅ |
| Koreksi bertanda tangan | `RECLASS` `ADJUSTMENT` `WRITE_OFF` | `corrections.rs` | ✅ |
| Jurnal manual | `MANUAL` | `http/finance.rs` | ✅ mesinnya; layarnya belum pintu utama |

### 1.4 Yang **belum** terintegrasi — empat, dan semuanya spesifik

| lubang | akibatnya hari ini |
|---|---|
| **`STOCK_COUNT` tidak punya produsen jurnal.** Tak satu pun berkas di `backend/src/cloud` menulis kind ini. | Selisih stock opname **tidak pernah** sampai ke GL. Ini justru bagian "inventory strict" yang Anda ingin ketat dari hari pertama. |
| **`INTERUNIT_SETTLE` tidak punya produsen.** `interunit.rs` hanya menulis `REMITTANCE`. | Penyelesaian saldo antar-unit setengah jalan; `1501`/Saldo Affiliasi hanya tumbuh. |
| **`BANK_STATEMENT` tidak punya produsen.** Statement diimpor (0106, 0271–0272) tapi tak pernah jadi jurnal. | Rekonsiliasi bank mencocokkan, tidak memposting. |
| **Payroll tak punya akrual.** `payment_context.rs` hanya sisi bayar; tak ada modul yang memposting `Dr Beban Gaji / Cr Akrual`. | Persis seperti rencana Anda: payroll manual dulu. Bedanya, sekarang itu **kebetulan**, bukan kebijakan yang tertulis. |

### 1.5 `system_role` sudah ada — namanya `account_map`

```
account_map (semantic_key, site_id, qualifier) → account_code
```

**62 semantic key, 1.382 baris** (14 unit × key × qualifier): `inventory`, `cogs`,
`trade_payable`, `vat_in`, `revenue_cash`, `card_receivable_credit`, `fixed_asset`,
`accumulated_depreciation`, `payroll_payable`, … Mesin sudah **tidak pernah**
menyebut kode akun; ia bertanya ke peta. Persis `system_role = INVENTORY_ASSET → account_id`
yang Anda maksud, dan sudah per-unit pula. Ditulis lewat `POST /api/v1/finance/account-map`.

### 1.6 Yang belum ada di API

`GET /finance/accounts`, `/accounts/{code}`, `/accounts/{code}/ledger` — **semuanya baca.**
Tidak ada POST/PATCH/DELETE untuk akun. **Bagan hanya bisa berubah lewat migrasi.**
Itu inti permintaan "seperti ERPNext" yang belum dijawab.

---

## 2. COA 144 diadu dengan mesin yang ada

Join dilakukan sungguhan: 6.894 daun klien → kode natural 10 digit →
`outputs/coa_thirty/remap-190-to-40.csv` + `categories.json`.

| pengukuran | hasil |
|---|---|
| target 144 yang punya akun di mesin | **138 / 144** |
| target yang sama sekali tak punya akun | **6** |
| nilai `(akun, dimensi)` yang dipakai >1 target 144 | **14** |
| akun natural klien (10 digit) di bagan penuh | **498** — mesin hanya pernah memetakan 184-nya (yang terpakai 2024–2025) |

**144 itu duduk di antara 190 hasil reduksi kita dan 43 hasil peleburan kita.**
Akuntan klien mengerjakan latihan yang sama — mencabut sumbu unit — dan berhenti
di titik yang berbeda. Tidak ada yang salah di salah satu sisi; yang harus diputuskan
adalah **mana yang jadi identitas akun.**

### 2.1 Enam target tanpa akun

`Cadangan Piutang Pegawai` · `Akumulasi Aset Lainnya` · `Hutang Lain-lain` ·
`Pendapatan lain-lain` (kode `600104`) · `Biaya Lubrication & Grease, Bahan Bakar Genset` ·
`Biaya Telephone Equipment`.

Lima dari enam nol saldo dua tahun, makanya tak pernah masuk 190. `Hutang Lain-lain`
**tidak** — 196 baris klien, dan tidak punya rumah di mesin. Itu harus dijawab sebelum
cutover.

### 2.2 Empat belas tempat identitas bertabrakan kalau 43 tetap jadi identitas

Contoh yang paling menggigit:

```
1101 Cash On Hand   ← CASH ON HAND · PETTY CASH · MODAL KASIR
1102 Cash In Bank   ← Bank-Giro · Bank-Tabungan · Deposito Berjangka
1301 Persediaan     ← Persediaan Barang Dagangan · Persediaan Kantong Belanja
1501 Affiliasi      ← Pembiayaan · Atas Barang · Lain-lain
4301 Pend. Lain     ← Bunga Bank · Selisih Pembulatan · Sewa · Management Fee · Lain-lain
7101 Depr & Amort   ← 8 akun penyusutan klien, termasuk Replacement OE
```

Sebagian **bisa** dipulihkan dari sub-ledger (`bank_account_id`, `asset_id` → `asset_class`,
`supplier.category`, `tax_kind`) — desain 43 memang begitu dan itu benar secara teknis.
Tapi "bisa dipulihkan" ≠ "itu bagannya". Kalau fase 1 berarti akuntan mengetik jurnal
manual sepanjang hari, ia harus memilih **Biaya Listrik**, bukan `6301` + kategori `LISTRIK`
di picker kedua berisi 140 nilai lintas 16 keluarga.

### 2.3 Tiga cacat di bagan 144 yang sebaiknya dicatat sekarang

1. **`600104 Pendapatan lain-lain` duduk di root 6 (BEBAN).** Akun pendapatan di
   bawah akar beban. 0296 sudah pernah memperbaiki kebalikannya ("rugi tidak boleh tinggal
   di akun pendapatan"); ini kembarannya dan belum dijawab.
2. **`7020310 BIAYA USAHA LAINNYA` menggantung di kedalaman 7**, sementara group
   sebayanya di kedalaman 5. Tangga klien tidak rata.
3. **Nol akun voucher, nol akun poin, nol akun QRIS, nol akun setoran-dalam-perjalanan.**
   (`grep -icE "voucher|poin|qris"` pada CSV = 0.) Padahal kasir kita menerima QRIS,
   menjual voucher, dan menumpuk poin, dan uang toko bermalam dalam perjalanan.
   Ini **bukan** cacat bagan klien — bagan itu final untuk *riwayat mereka*. Ini bukti
   bahwa bagan harus bisa ditambah: sistem yang berjalan butuh ±2 akun lagi
   (`Setoran Dalam Perjalanan`, `Kewajiban Poin Member`) dan 3 lainnya cukup jadi dimensi.

---

## 3. Riset ERPNext — mekanisme yang kita tiru, dan yang kita tolak

Semua dari klon lokal `~/Documents/reference-erp/erpnext`.

### 3.1 Bentuk `Account` (`accounts/doctype/account/account.json`)

```
account_name · account_number · is_group · company · parent_account
root_type (Asset|Liability|Income|Expense|Equity, read-only, diturunkan dari induk)
report_type (Balance Sheet|Profit and Loss, read-only)
account_type (32 nilai: Bank, Cash, Receivable, Payable, Stock, Fixed Asset,
              Accumulated Depreciation, Cost of Goods Sold, Tax, Round Off, Temporary, …)
account_currency · tax_rate · freeze_account · balance_must_be (Debit|Credit)
disabled · include_in_gross · lft/rgt (nested set) · account_category
```

### 3.2 Aturan siklus hidup (`account.py`)

| operasi | aturan ERPNext | baris |
|---|---|---|
| **hapus** | ditolak kalau ada GL Entry **atau** punya anak | `on_trash` :495 |
| **nonaktifkan** | boleh, kecuali akun itu jadi *default* perusahaan | `validate_disabled` :294 |
| **rename / ganti nomor** | **boleh kapan saja, termasuk setelah ada transaksi** — `rename_doc` mengalirkan link. Syaratnya sistem sedang idle (`_ensure_idle_system`) | `update_account_number` :559 |
| **merge dua akun** | hanya kalau `is_group`, `root_type`, `company`, `currency` sama | `merge_account` :624 |
| **group ⇄ ledger** | ditolak kalau ada GL Entry, punya anak, atau `account_type` terisi | :460, :471 |
| **ganti currency** | ditolak setelah ada entri bermata uang lain | :368 |
| **ganti `account_type` akun stok** | ditolak kalau ada Stock Ledger Entry | :216 |

### 3.3 Indireksi — ERPNext juga tidak pernah hard-code kode akun

Dua lapis:

1. **`account_type`** — 32 nilai. Mesin bertanya "akun bertipe `Stock` mana?", bukan "1301".
2. **23 field default di `Company`** (`get_company_default_account_fields()` :718):
   `default_inventory_account`, `stock_received_but_not_billed`, `stock_adjustment_account`,
   `default_expense_account`, `default_income_account`, `round_off_account`,
   `accumulated_depreciation_account`, `depreciation_expense_account`, `disposal_account`, …

   Akun yang jadi default perusahaan **tidak boleh dinonaktifkan** — itulah guardrail
   "inventory engine tidak boleh kehilangan target posting".

**Padanan kita sudah ada dan lebih kaya:** `account_map.semantic_key` (62 key, per-unit,
per-qualifier). ERPNext hanya punya satu default per company; kita punya per-unit.

### 3.4 Bentuk pohon dan penomoran

`chart_of_accounts/verified/id_chart_of_accounts.json` — bagan standar Indonesia bawaan
ERPNext, **218 node**, strukturnya bersarang **berdasarkan nama**, dengan `account_number`
sebagai label bebas (`'1000.000'`, `'1120.000'`).

> **Ini perbedaan paling penting dengan kita.** Di ERPNext **kode bukan identitas dan bukan
> struktur** — ia label. Induk adalah link. Di skema kita kode *adalah* PK **dan** struktur
> (`parent_code` harus prefiks). Itu sebabnya "pindah grouping" gratis di sana dan mahal di
> sini. §4.2 menjawabnya tanpa membongkar rollup.

### 3.5 Cost center & dimensi (`gl_entry.py`)

- `pl_must_have_cost_center` :172 — cost center **wajib untuk akun laba-rugi saja**;
  neraca boleh kosong.
- `validate_cost_center` :257 — cost center group **tidak boleh** dipakai bertransaksi.
- `Cost Center` = pohon per-company (`cost_center_name`, `parent_cost_center`, `is_group`,
  `disabled`) — tidak lebih dari itu.
- `Accounting Dimension` = dimensi bebas bikinan user, dengan `mandatory_for_pl` /
  `mandatory_for_bs` per company (:189).

### 3.6 Yang kita **tolak** dari ERPNext

| ditolak | alasan |
|---|---|
| `lft`/`rgt` nested set | pohon 144 node; recursive CTE lebih murah daripada dua kolom yang harus dijaga konsisten |
| `Company` sebagai sumbu | satu badan usaha; 14 unit adalah unit, bukan company (§5) |
| rename yang mengalir ke seluruh link | PK kita dirujuk `journal_line`; kita pisahkan identitas dari nomor tampilan (§4.2) — hasil yang sama, tanpa cascade |
| `Accounting Dimension` generik | `coa-final.md` §3 menolak sumbu ke-4 karena datanya tak ada. Masih berlaku. |

---

## 4. Arsitektur yang diusulkan

Satu kalimat:

> **Akun = apa yang dipilih orang (144, bisa diedit). `report_line` = apa yang dicetak laporan
> (±43, stabil). Kategori/dimensi = apa yang dibutuhkan mesin dan tak pernah diketik siapa pun.**

Dengan begitu pekerjaan 0287–0297 **tidak terbuang** — 43 baris laporan itu tetap ada, hanya
berhenti jadi identitas akun dan jadi kolom rollup.

### 4.1 D1 — 144 jadi `ledger_account`; 43 jadi `report_line`

```
ledger_account
  account_code   4 digit, MINTED, IMMUTABLE      ← yang dirujuk journal_line
  client_code    nomor versi akuntan, EDITABLE   ← boleh diganti kapan saja
  name           kata klien sendiri, EDITABLE
  parent_code    pohon prefiks (§4.2)
  report_line    baris neraca/LR (±43)           ← EDITABLE, tidak menyentuh ledger
  ...
```

Penomoran 4 digit sudah digenerate dan tidak bertabrakan:
**`outputs/coa_144/chart-144.csv`** — 144 akun, 31 group, semua di bawah akar 1–8 klien,
nama group memakai kata klien:

```
11xx KAS & SETARA KAS      16xx AKTIVA TETAP        23xx ACCRUED EXPENSE
12xx PIUTANG               17xx AKUMULASI PENY.     41xx PENJUALAN
13xx INVENTORY             18xx INTANGIBLE ASSET    62xx BEBAN PENJUALAN
14xx PREPAID               21xx HUTANG DAGANG       63xx BEBAN ADM & UMUM
15xx PIUTANG AFFILIASI     22xx HUTANG PAJAK        72xx DEPRESIASI & AMORTISASI
```

`root_class` tetap `left(code,1)`; `financial_statements.rs` **tidak berubah**;
rollup prefiks tetap jalan. `code_provenance = 'PENDING_CLIENT_CODE'` untuk semuanya —
kode milik kita, nama milik klien, dan `client_code` mengembalikan nomor mereka.

### 4.2 D2 — memisahkan identitas dari nomor, supaya rename gratis

| operasi | boleh? | mekanisme |
|---|---|---|
| ganti **nama** | selalu | `UPDATE name` |
| ganti **nomor tampilan** | selalu | `UPDATE client_code` — `account_code` tak tersentuh |
| **tambah** akun | selalu | kode berikutnya yang kosong di bawah group |
| **nonaktifkan** | kecuali dirujuk `account_map` | `is_active = false` |
| **hapus** | hanya kalau belum pernah diposting | pola `ever_used` (0167) |
| **pindah induk** | sebelum posting pertama: renumber. Sesudah: **ubah `report_line`** | lihat catatan |

> **Catatan pindah induk.** Karena pohon kita prefiks, memindahkan akun yang sudah punya
> jurnal butuh renumber PK — mahal dan berisiko. Tapi alasan orang memindahkan akun hampir
> selalu **laporan**, dan itu dijawab `report_line` tanpa menyentuh satu baris jurnal pun.
> Pohon prefiks tetap jadi cara menjelajah; `report_line` jadi cara mencetak.
> Kalau kelak pemilik benar-benar butuh pohon bebas, itu lane tersendiri: `parent_code` jadi
> FK biasa, `root_class` jadi kolom ter-maintain, dan 4 berkas (`ledger.rs`, `journal.rs`,
> `statements.rs`, `financial_statements.rs`) menukar `LIKE code || '%'` dengan recursive CTE.
> Datanya tidak berubah — jadi ini bisa ditunda tanpa utang.

### 4.3 D3 — kategori menyusut, tidak hilang

Dari 16 keluarga (140 nilai) di working tree, kira-kira **10 larut jadi akun** karena 144
memang sudah memisahkannya, dan **6 bertahan** karena di situ 144 lebih kasar daripada
daun klien:

| bertahan sebagai dimensi | kenapa |
|---|---|
| `tender` (14) | 144 hanya punya **satu** `Penjualan Barang Dagangan`; kasir punya 14 tender |
| `party` (5) | `Piutang Pegawai dan Manajemen` satu akun, tiga pihak |
| `tax_kind` (9) | `Hutang Pajak` satu akun untuk semua jenis pajak |
| `prepaid_kind` (9) | 144 hanya punya 2 akun prepaid |
| `loss_kind` (2) | `Biaya Kerusakan/Kehilangan Persediaan` satu akun, dua sebab |
| `asset_class` (59) | `Bangunan` satu akun, banyak kelas di bawahnya |

`expense_category` (51), `pay_component` (13), `income_kind` (8), `interunit_reason` (3),
`item_class` (2), `cost_kind` (2), `deduction_kind` (2), `pot`, `advance_purpose`,
`accrual_kind` **larut jadi akun** — angka pastinya keluar dari satu kali jalan generator.

Trigger `assert_category_fits` tetap dipakai apa adanya: akun tanpa `category_family`
menolak baris bawa kategori, dan sebaliknya. Yang berubah hanya jumlah akun yang punya keluarga.

### 4.4 D4 — tangga kebijakan Anda, dipetakan ke kolom yang sudah ada

| istilah Anda | `posting_mode` | `manual_je_policy` |
|---|---|---|
| `MANUAL_ALLOWED` | `MANUAL` | `YES` |
| `MANUAL_APPROVED` | `MANUAL` | `OVERRIDE` |
| `SEMI_AUTO` | `SEMI_AUTO` | `OVERRIDE` |
| `AUTO_ONLY` | `AUTO_ONLY` | `NO` |
| `SYSTEM_ONLY` | `BLOCKED` | `NO` |

Tidak ada kolom baru. Yang ditambah hanya **view baca** `account_posting_policy` yang
mencetak satu nama untuk dua kolom, supaya layar dan dokumen memakai kata yang sama.

Setelan fase 1 (usulan):

| kelompok akun | fase 1 | nanti |
|---|---|---|
| Persediaan, BDP, HPP, cadangan persediaan, selisih opname | **AUTO_ONLY** + `NO` | tetap |
| Penjualan, piutang kartu, tender | **AUTO_ONLY** + `OVERRIDE` | tetap |
| Kas & bank | `SEMI_AUTO` + `OVERRIDE` | AUTO saat statement memposting |
| Hutang usaha, uang muka supplier | `SEMI_AUTO` + `OVERRIDE` | sudah semi-auto hari ini |
| Beban (semua), akrual, prepaid | **MANUAL** + `OVERRIDE` | AUTO per modul |
| Payroll (beban & akrual) | **MANUAL** + `OVERRIDE` | AUTO dari payroll run |
| Aset & akumulasi | `SEMI_AUTO` + `OVERRIDE` | AUTO dari jadwal |
| Modal, prive, pinjaman | **MANUAL** + `OVERRIDE` + approval lebih tinggi | tetap |
| Laba ditahan | **BLOCKED** kecuali `source_kind` penutupan | tetap |

> **Peringatan yang harus ikut dicatat.** Melonggarkan akun yang mesinnya **sudah jalan**
> (penjualan, HPP, giro, acquirer, setoran toko) bukan penyederhanaan — itu membuka pintu
> untuk GL dan sub-ledger berselisih, persis yang `posting_mode` ada untuk mencegah.
> Loose hanya dipakai di domain yang **memang belum punya mesin** (§1.4 + beban + payroll).
> Daftar di atas sudah disusun begitu.

### 4.5 D5 — `system_role` = `account_map`, plus satu kolom

Tambahkan `account_map_key (semantic_key, required boolean, note)` sebagai master kecil,
supaya:
- layar Chart of Accounts bisa menunjukkan "akun ini dipakai mesin sebagai `inventory`";
- menonaktifkan/menghapus akun yang masih dirujuk peta **ditolak dengan nama perannya**,
  bukan dengan pelanggaran FK;
- key yang `required` tapi tak punya baris untuk satu unit = **kegagalan yang terlihat**
  di `/system/health`, bukan error saat posting pertama jam 9 pagi.

---

## 5. Cost center: ya, dan sudah ada

**Jawaban: unit = cost center, dan implementasinya sudah berjalan sebagai `journal_line.site_id`.**

Buktinya dari bagan klien sendiri: **seluruh 6.894 daun** membawa sufiks unit
(`HO`, `C001`…`C013`) — nol pengecualian. 144 × 14 unit (plus matriks afiliasi 14×14)
adalah dari mana 7.528 itu datang. Jadi klien sudah memperlakukan unit sebagai sumbu,
dan sistem sudah mewajibkannya di setiap baris.

Tiga hal yang perlu diputuskan, bukan dibangun:

1. **Kunci sumbunya: `site` atau `org_place`?** `coa-final.md` §3 menyimpulkan `org_place`
   — 14 baris sejak 0230/0236, dan baris pertamanya bernama **HO**, bukan `dc`.
   `site` juga 14 baris tapi yang pertama `dc` — dan gudang bukan unit akuntansi.
   Ini bertabrakan dengan lane rename 0256 yang belum mendarat (`itulah-0256-head-office-rename`).
   **Selesaikan dulu di sana**, jangan di lane ini.
2. **Unit ≠ cost center ERPNext.** Klien menyimpan **neraca penuh** per unit (ada matriks
   afiliasi 14×14 antar-unit). Itu lebih dekat ke *branch* daripada cost center. Karena itu
   aturan kita sudah benar dan lebih ketat dari ERPNext: unit wajib di neraca **dan**
   laba-rugi, bukan hanya laba-rugi.
3. **Departemen tidak jadi sumbu.** Sudah diputuskan 15 September (`itulah-thin-gl-masters`:
   `department` ditolak bersama 4 master lain). HO punya Finance/IT/HR, tapi bagan klien
   tidak mengkodekannya — menambah sumbu tanpa data berarti mengarang data.
   Kalau kelak dibutuhkan, tempatnya **satu kolom opsional di `journal_line`** dengan aturan
   `mandatory_for_pl` gaya ERPNext, bukan tabel cost center bertingkat.

> **Konflik yang masih terbuka** dan harus ditutup sebelum kode frontend ditulis:
> `frontend-hub/src/screens/finance-lab/engine/types.ts` memuat `Dimensions` dengan **tujuh**
> dimensi opsional dan ±55 `AccountRole` — desain yang berbeda dari satu sumbu + peta.
> Sudah dicatat sebagai konflik di `coa-final.md` §3 dan belum dijawab.

---

## 6. Rencana kerja

### Fase 0 — putusan & pembersihan (setengah hari, 1 lane)

1. Pemilik memutuskan: **akun = 144** (D1). Kalau tidak, seluruh rencana ini gugur dan
   0287–0297 tinggal di-commit apa adanya.
2. Tarik 11 berkas untracked 0287–0297. Yang **dipertahankan** dan ditulis ulang ke blok baru:
   `line_category` untuk 6 keluarga yang bertahan, `asset_class` (59), `account_category_policy`,
   `legacy_account_code()`, kolom `category_code` di 9 tabel dokumen.
   Yang **dibuang**: peleburan 190→43 sebagai identitas.
3. Bawa DB dev ke head. Selama DB dev tertinggal 21 migrasi, setiap pengukuran menyesatkan.

### Fase 1 — bagan 144 masuk (1 lane, 2–3 hari)

Generator `outputs/coa_144/gen-chart.py` (pola sama dengan `coa_thirty/gen-accounts.py`,
supaya tak ada yang mengetik kebijakan dengan tangan), membaca CSV dan mengeluarkan:

| migrasi | isi |
|---|---|
| `NNNN` | kolom baru: `client_code`, `report_line`, `ever_used`, `archived_at` |
| `NNNN+1` | **144 akun + 31 group** dari `chart-144.csv`; `normal_balance`, `is_contra`, `dimension`, `report_line`, `category_family` |
| `NNNN+2` | ±2 akun yang sistem butuh dan bagan klien tak punya: `Setoran Dalam Perjalanan`, `Kewajiban Poin Member` (tetap `BLOCKED` sampai PSAK 72 dijawab — 0297) |
| `NNNN+3` | `ledger_account_remap`: **498 kode natural klien → 144**, langsung dari kolom "Akun target 144" (otoritatif, bukan turunan kita) |
| `NNNN+4` | kebijakan posting fase 1 per §4.4 + `account_category_policy` untuk pengecualian |
| `NNNN+5` | `account_map` dipindah ke akun baru — 62 key × 14 unit, **tidak boleh ada key yang kehilangan baris** |
| `NNNN+6` | 190 akun lama: `is_active=false`, `posting_mode='BLOCKED'`, riwayat utuh |

**Gate yang harus hijau sebelum lane ini mendarat**

- setiap `semantic_key` punya baris untuk 14 unit (1.382 baris, nol hilang);
- setiap dokumen yang menyimpan `account_code` menunjuk akun aktif;
- `postable == posting_policy_configured`, `unclassified == 0`;
- trial balance sebelum & sesudah remap **identik** per `report_line` per unit;
- 6 target §2.1 punya jawaban tertulis (akun, dimensi, atau "memang tidak dipakai").

### Fase 2 — bagan bisa diedit (1 lane, 3–4 hari)

```
GET    /api/v1/finance/accounts            (sudah ada — tambah tree + filter)
POST   /api/v1/finance/accounts            tambah akun di bawah group
PATCH  /api/v1/finance/accounts/{code}     name · client_code · report_line · is_active · policy
DELETE /api/v1/finance/accounts/{code}     hanya kalau ever_used = false
POST   /api/v1/finance/accounts/{code}/renumber   hanya kalau ever_used = false
GET    /api/v1/finance/accounts/{code}/usage      siapa yang merujuk: map, dokumen, jurnal
```

Penjagaan ditegakkan **di database**, bukan di handler (pelajaran 0261–0268):
trigger menolak hapus kalau `ever_used`, menolak nonaktif kalau masih dirujuk
`account_map`, menolak ubah `normal_balance`/`dimension` setelah ada jurnal,
menolak posting ke group lewat FK gabungan yang sudah ada.

Layar: `frontend-hub` → Finance → **Chart of accounts** (pohon, ikuti pola
`master/*` yang sudah punya retire vs delete — `itulah-master-lifecycle`).
Tipe TS wajib **disebut** di `contract_types.rs`, bukan hanya `derive`
(`itulah-contract-generation-trap`).

### Fase 3 — melonggarkan pintu (1 lane, 1 hari)

Satu migrasi menyetel kebijakan per §4.4 — hanya pada kelompok yang **belum punya mesin**.
Tak ada perubahan skema. Ditambah satu tes yang menolak regresi: akun dengan mesin aktif
tidak boleh turun ke `MANUAL`.

### Fase 4 — jurnal manual yang layak jadi pintu utama (1 lane, 3–4 hari)

Ini yang membuat rencana loose berhasil atau gagal:
template jurnal berulang · salin dari entri sebelumnya · lampiran bukti · reversal satu klik ·
saran akun berdasarkan riwayat · **unit wajib terisi di setiap baris** · `source_kind` +
`source_id` wajib diisi dari dokumen nyata · alur approval untuk akun `OVERRIDE`.

### Fase 5 — mengetatkan per modul, satu per satu

Empat lubang §1.4 dulu (stock count → GL; interunit settle; bank statement → GL;
akrual payroll). Tiap modul yang mendarat = **satu baris kebijakan berubah**, bukan
migrasi bagan. Itulah gunanya §4.1.

### Fase 6 — akuntan mendapat nomornya kembali

`legacy_account_code()` (0292) + `client_code` + `report_line`: trial balance dan laporan
bisa dicetak dalam kode klien 10–12 digit, dalam 144, atau dalam 43 baris laporan — dari
data yang sama, tanpa jurnal bayangan.

---

## 7. Risiko & jebakan yang sudah diketahui

| risiko | penangkal |
|---|---|
| **CHECK hilang diam-diam saat dua lane merge** (preseden 0257: `source_kind` 35→14) | tulis ulang constraint **utuh** (DROP+ADD lengkap), jangan append |
| **Migrasi di-renumber** membunuh DB dev dan production | ambil blok nomor sekali, umumkan ke lane lain; Render autodeploy = push ke main itu live |
| Tipe TS tak ikut ter-generate | sebut tipe di `contract_types.rs`, jangan andalkan `derive` |
| `postgres::*` satu namespace — nama fungsi generik bertabrakan | beri prefiks modul pada fungsi bagan baru |
| DB dev tertinggal 21 migrasi | Fase 0 langkah 3, sebelum apa pun diukur |
| Lane 0256 (`dc`+`dc-01` → `ho`) belum mendarat | jangan sentuh kunci unit di lane ini |
| `finance-lab/engine/types.ts` (7 dimensi, 55 role) | tutup konfliknya sebelum frontend fase 2 ditulis |
| 144 punya 0 akun voucher/poin/QRIS | Fase 1 migrasi `NNNN+2`, dan itu alasan bagan harus bisa ditambah |

---

## 8. Putusan pemilik — 19 September 2026

**Semua ditetapkan. Bagian ini adalah putusan, bukan usulan.**

### 8.1 Akun = 144, bukan 37/43 ✅

`ledger_account` diisi **144 akun** dari CSV klien. Peleburan 43-akun tidak jadi identitas;
43 baris itu turun jadi kolom `report_line` (§4.1). 0287–0297 ditulis ulang selagi
belum di-commit.

### 8.2 `Hutang Lain-lain` — ternyata bukan "hutang lain-lain"

Diperiksa di bagan klien: `2012304` **HUTANG LAIN - LAIN**, 14 kode natural ×14 unit =
**196 daun**, dan namanya berbunyi `Hutang Lain - Lain HEAD OFFICE - C001`,
`… WONOSOBO - C013`. Ini **matriks antar-unit 14×14**, bukan utang ke pihak luar.

Pasangannya sudah ada di 144: `Saldo Affiliasi Lain-lain` = `1021403 PIUTANG AFFILIASI
LAIN-LAIN`, juga 14 natural. Jadi:

| sisi | kode klien | akun 144 |
|---|---|---|
| piutang | `1021403` | `Saldo Affiliasi Lain-lain` |
| hutang | `2012304` | `Hutang Lain-lain` |

Dan di sini bagan 144 **tidak konsisten dengan dirinya sendiri**: dua matriks lain
(`Pembiayaan` `1021401`+`2012301`, `Atas Barang` `1021402`+`2012302`) **dilebur** jadi satu
akun bertanda — 28 natural jadi satu — sementara matriks `Lain-lain` dibiarkan pecah dua.

**Putusan:** ikuti 144 apa adanya — dua akun, satu di root 1 satu di root 2 — dan
**keduanya `requires_counter_site = true`** (kolomnya sudah ada sejak 0243, ditegakkan 0261).
Tanpa itu `Hutang Lain-lain` jadi keranjang tanpa lawan, dan saldo antar-unit tak bisa
di-netting. Catatan untuk akuntan klien: tiga matriks yang sama diperlakukan dua cara
berbeda di bagan final mereka; kalau kelak mereka mau seragam, cukup ubah `report_line`.

### 8.3 `600104 Pendapatan lain-lain` tetap di akar BEBAN ✅ (sesuai laporan klien)

Akun tetap di bawah akar `6`, persis seperti bagan dan laporan mereka. Supaya
aritmetikanya tidak salah, akun ini diseed `normal_balance = 'C'` + `is_contra = true` —
yaitu **pengurang beban**, yang memang cara laporan klien membacanya. Bentuk pohon =
milik klien; tanda = benar. Tidak ada yang perlu dikompromikan.

### 8.4 Penomoran: kode 4 digit kita + `client_code` ✅

Alasannya terukur, bukan selera: **bagan 144 tidak punya nomor.** Kolom "Akun target 144"
hanya berisi **nama**. Dan nomor klien tidak bisa dipinjam begitu saja —

| berapa kode klien di balik satu akun 144 | jumlah target |
|---|---|
| tepat 1 kode | **84** |
| 2 kode | 27 |
| 3–6 kode | 20 |
| 9–14 kode | 9 |
| 28, 36, 72 kode | 4 |

**60 dari 144 akun tidak punya satu nomor klien** — `Beban Gaji` saja berasal dari dua
(`6010111001` operation dan `6010210001` admin), `Barang Dagangan dalam Perjalanan` dari 14.
Jadi "pakai nomor klien saja" bukan pilihan yang ada.

Bentuk yang dipakai:

```
account_code   1101, 6209, …   milik kita · 4 digit · IMMUTABLE · yang dirujuk journal_line
client_code    nomor akuntan   EDITABLE kapan saja · yang tampil di layar & laporan
```

- 84 akun yang punya tepat satu kode klien: `client_code` **diisi otomatis** dengan kode itu.
- 60 sisanya: `client_code` kosong, Finance HO mengisinya kapan saja lewat layar — tanpa
  migrasi, tanpa menyentuh satu baris jurnal pun.
- Kalau akuntan kelak menomori ulang seluruh 144, itu **UPDATE satu kolom**, bukan migrasi PK.

Dan `legacy_account_code()` (0292) tetap mengembalikan kode 10–12 digit lama untuk
rekonsiliasi riwayat. Jadi tiga bahasa nomor hidup berdampingan: kode kita (identitas),
kode akuntan (tampilan), kode lama (riwayat).

### 8.5 Yang boleh mengubah bagan: Finance HO saja ✅

Finance hanya ada di HO — tidak ada finance di toko. Konsekuensinya untuk Fase 2:

- satu permission baru, `finance.chart.write`, diberikan ke peran finance **di HO**;
- kepala toko dan manajer tempat: **baca saja**, termasuk di layar jurnal
  (mereka tidak menulis JE — uang toko lewat dokumen `store_money`, bukan jurnal tangan);
- setiap perubahan bagan menulis baris audit (siapa, kapan, dari apa ke apa) — tabel audit
  sudah ada dari lane audit+notifikasi;
- `account_map` (peran mesin) tetap lebih ketat lagi: hanya HO, dan perubahannya muncul di
  `/system/health` karena satu key yang kehilangan baris = posting gagal di unit itu.

---

## 9. Sisa yang masih menunggu jawaban klien

Bukan penghalang Fase 0–1; keempatnya bisa dijawab sambil jalan.

1. **`Cadangan Piutang Pegawai`, `Akumulasi Aset Lainnya`, `Biaya Lubrication & Grease`,
   `Biaya Telephone Equipment`** — nol saldo dua tahun. Diseed sebagai akun aktif, atau
   diseed `is_active = false` sampai ada yang memakainya?
2. **`Kewajiban Poin Member`** tetap `BLOCKED` sampai nilai poin dan tingkat hangus
   diputuskan (PSAK 72 §18) — 0297.
3. **Dua akun yang sistem butuh dan bagan klien tak punya**: `Setoran Dalam Perjalanan`
   dan akun poin di atas. Namanya mau pakai kata apa?
4. **Matriks afiliasi diperlakukan dua cara** (§8.2) — dibiarkan, atau diseragamkan nanti
   lewat `report_line`?

---

## 10. `LANDED_COST` — nama yang menjanjikan fitur yang tidak ada

**Pertanyaan pemilik (19 Sep): bagan 144 tak punya akun landed cost — apa bisa disesuaikan?**
**Jawaban: bisa, dan nol akun perlu ditambah. Yang salah cuma namanya.**

### 10.1 `LANDED_COST` bukan akun, dan bukan landed cost

Satu-satunya tempat kind ini lahir adalah `stock_ledger.rs:1220`,
`cost_layer_correct_price` — **koreksi harga** atas cost layer yang sudah ada (nota debet
supplier). Jurnalnya hanya menyentuh tiga peran:

```
Dr/Cr  inventory      bagian yang masih di rak
Dr/Cr  cogs           bagian yang sudah terjual
Cr     trade_payable  nilai nota
```

Ketiganya ada di 144: `Persediaan Barang Dagangan` · `Harga Pokok Pembelian / HPP` ·
`Hutang Suppliers Barang Dagangan`. **Tidak ada akun "landed cost" yang dibutuhkan,
sekarang maupun dulu.** Baris kode di sebelahnya (`stock_ledger.rs:1267`) bahkan sudah
menyimpan alasannya sebagai `'PRICE_CORRECTION'` — nama yang benar sudah ada di sana.

### 10.2 Dua migrasi menjelaskan kind yang sama dengan dua arti

| migrasi | kata |
|---|---|
| `0128:38` | "freight and duty **capitalised into stock**" |
| `0148:23` | "a supplier **price correction**, split between what is still on…" |

Kode mengimplementasikan 0148. 0128 menjanjikan fitur yang tak pernah ditulis — dan
itulah yang membuat pemilik mengira bagan kurang satu akun. Sekalian diperbaiki.

### 10.3 Ongkos mengganti nama → `PRICE_CORRECTION`

| yang tersentuh | jumlah |
|---|---|
| baris Rust | **2** (`stock_ledger.rs:1220`, `:1267`) |
| `journal_entry_source_kind_check` | 1 migrasi baru, **restate utuh** (pelajaran 0257) |
| baris jurnal yang ada di DB dev | **0** |
| dokumen | `finance-source-kind-mapping.md`, `finance-branch-reconciliation.md`, komentar 0128 |
| frontend | nol — tak ada label `LANDED_COST` di `frontend-hub` |

Murah, dan sebaiknya dikerjakan bersama blok migrasi Fase 1 supaya CHECK-nya cuma
ditulis ulang satu kali.

### 10.4 Ongkos angkut tetap jadi BEBAN, dan itu sudah cocok

Bagan klien punya dua akun ongkos angkut, keduanya masuk 144 di akar 6:
`Biaya Bongkar Muat Barang` (`6010110006`) dan
`Biaya Pengiriman Barang/kurir/Ekspedisi` (`6010110007`).

Mesin kita **tidak pernah** mengkapitalisasi ongkos angkut ke nilai persediaan — tak ada
kode yang melakukannya. Jadi perlakuan kita **sudah sama** dengan perlakuan klien: ongkos
angkut dibebankan, bukan dibenamkan ke harga pokok. Kalau kelak klien mau dikapitalisasi,
itu **fitur baru + perubahan kebijakan akuntansi**, bukan sesuatu yang boleh muncul diam-diam.

### 10.5 Pemeriksaan menyeluruh: 4 dari 62 peran mesin jatuh di luar 144

Pertanyaan yang lebih besar di balik pertanyaan landed cost: **apakah mesin butuh akun yang
144 tidak punya?** Diperiksa seluruh `account_map` — 62 semantic key, 89 pasangan
(peran, akun):

| peran mesin | akun sekarang | jalan keluar di 144 |
|---|---|---|
| `qris_receivable` | `1011101003 Piutang QRIS` | `Piutang Acquirer Kartu` + dimensi tender `QRIS` |
| `revenue_qris` | `4010114001 Penjualan QRIS` | `Penjualan Barang Dagangan` + dimensi tender `QRIS` |
| `voucher_liability` | `2012305001 Hutang Voucher` | `Uang Muka Penjualan` + `deferred_revenue_kind` |
| `cash_in_transit` | `1011005001 Setoran Dalam Perjalanan` | **belum ada jawaban** — lihat bawah |

**58 peran lainnya mendarat mulus di 144.** Tiga yang pertama selesai tanpa akun baru,
karena 144 memang tak pernah merinci tender dan kita sudah punya dimensinya.

Yang tersisa satu: **uang setoran yang sudah keluar dari toko tapi belum masuk bank.**
Bagan 144 tak punya barisnya, padahal modul `deposits` sudah membedakan `IN_TRANSIT`
dari `LANDED` dan butuh tempat mendudukkan saldonya. Dua pilihan, dan ini pertanyaan
untuk pemilik:

- **(a) Satu akun baru** `Setoran Dalam Perjalanan` di grup Kas & Setara Kas.
  Jujur di neraca: uang itu memang bukan lagi di laci.
- **(b) Kategori `TRANSIT` di bawah `CASH ON HAND`.** Nol akun baru, tapi baris "Kas"
  di neraca memuat uang yang tidak ada di toko mana pun.

Saya condong ke (a) — dan ini justru contoh paling bersih kenapa bagan harus bisa ditambah.

---

## 11. Revisi setelah review pemilik — 19 September 2026 (putaran 2)

Enam koreksi. **Empat diterima apa adanya, satu diterima dengan satu syarat teknis, satu
saya perkuat.** Semuanya masuk kontrak; yang di bawah ini menggantikan §8 di mana berselisih.

### 11.1 ✅ 144 = seed awal, bukan batas

Kalimat resminya, dipakai di seluruh dokumen dan layar:

> **Bagan turunan-klien berisi 144 akun natural awal. Akun-akun ini adalah seed produksi,
> bukan batas jumlah akun. Finance HO boleh menambah akun di bawah tata kelola yang diatur.**

Tidak ada `MAX_ACCOUNTS`. Yang ada `code_provenance` (`CLIENT` vs `PENDING_CLIENT_CODE`)
untuk membedakan akun klien dari akun yang kita/Finance tambahkan.

**Isi seed yang disetujui: 144 + `Hutang Voucher` = 145 akun.** Dan tiga yang dicoret:

| dicoret | sebab | ke mana perannya pergi |
|---|---|---|
| `Piutang QRIS` | QRIS ditagih lewat rel debit | `qris_receivable` → `Piutang Acquirer Kartu` |
| `Penjualan QRIS` | sama | `revenue_qris` → `Penjualan Barang Dagangan` + dimensi tender |
| `Kewajiban Poin Member` | masih `BLOCKED` menunggu PSAK 72 §18 | tak ada akun sampai nilainya diputuskan |

**Satu peran masih butuh rumah:** `cash_in_transit` — setoran yang sudah keluar toko dan
belum masuk bank. Karena seed dikunci ke 144 + voucher, jalannya adalah **kategori
`TRANSIT` di bawah `CASH ON HAND`** (keluarga `pot` bertahan dengan dua nilai: `DRAWER`,
`TRANSIT` — `PETTY CASH` dan `MODAL KASIR` kini akun sendiri). Konsekuensi yang harus
disadari: **baris "Kas" di neraca memuat uang yang tidak ada di toko mana pun.**
Modul `deposits` tetap bisa membedakannya (`IN_TRANSIT` vs `LANDED`), tapi neraca tidak.
Kalau itu tak bisa diterima akuntan, akun ke-146 adalah jawabannya.

### 11.2 ✅ Unit akuntansi dikunci: HO + C001–C013. DC bukan unit akuntansi.

Dan kabar baiknya: **barisnya sudah persis benar dan tidak perlu menunggu lane rename.**

```
org_place: ho(→site dc) · store-01 … store-13   = 14 baris, nama sudah 'ho'
site:      dc · store-01 … store-13             = 14 baris, baris pertama masih 'dc'
```

Putusan: `journal_line` berkunci ke **`org_place`**, bukan `site`.

```sql
journal_line.accounting_unit_id text NOT NULL REFERENCES org_place(id)
```

`org_place.site_id` adalah peta **site → unit akuntansi, banyak-ke-satu**. Jadi aturannya
bisa dinyatakan satu kalimat:

> **Barang tinggal di `site`. Uang tinggal di `accounting_unit`.** Stok di DC berposting ke
> unit `ho`, karena HO dan DC satu gedung dan bagan klien memang hanya punya 14 unit.

Ini juga **melepas lane ini dari lane rename 0256** yang belum mendarat: kita tidak
menyentuh `site`, kita berhenti memakainya untuk uang. Blast radius: 29 berkas menyentuh
`journal_line`; yang berubah adalah nama kolom dan FK-nya, bukan artinya.

### 11.3 ✅ `counter_site_id` dihapus — dan ERPNext memang begitu

Saya cek klon ERPNext. **`GL Entry` tidak punya satu pun kolom lawan-unit:**

```
account · party_type · party · cost_center · project · finance_book · company
against (Text — hanya daftar akun lawan, untuk tampilan)
voucher_type · voucher_no · against_voucher_type · against_voucher
```

Pasangan antar-entitas dibuat **di dokumen**, bukan di baris buku besar:
`Journal Entry.voucher_type = "Inter Company Journal Entry"` +
`Journal Entry.inter_company_journal_entry_reference` → link ke Journal Entry pasangannya
(`journal_entry.py:363`). Persis arsitektur yang Anda gambarkan.

Dan invarian yang membuatnya aman **sudah ada di sini sejak 0120**: sebuah entri harus
seimbang **di setiap lokasi yang disentuhnya**, bukan hanya totalnya (`balanced_per_site`
di `poster.rs`). Jadi dua kaki itu memang sudah wajib berdiri sendiri-sendiri:

```
HO    Dr Saldo Affiliasi Pembiayaan  CC=HO     Cr Bank                        CC=HO
C001  Dr Kas                         CC=C001   Cr Saldo Affiliasi Pembiayaan  CC=C001
                                    keduanya source_id = INTERUNIT-001
```

**Yang dihapus:** `journal_line.counter_site_id`, `ledger_account.requires_counter_site`,
`ledger_account.counterparty_site_id`, dan CHECK `ledger_account_counterparty_is_rare`.
Blast radius: **17 berkas Rust, 10 migrasi** — tapi tiga migrasi terbaru (0288/0289/0295)
belum di-commit, jadi tinggal tidak ditulis.

**Yang menggantikan**, dan ini bagian yang wajib ikut supaya penghapusan tidak meninggalkan
lubang:

```
interunit_transaction
  id · nature (FINANCING | GOODS | OTHER) · from_unit · to_unit
  amount_minor · occurred_on · status · note
```

Dua kaki jurnal menunjuknya lewat `source_kind='INTERUNIT_SETTLE'` + `source_id`.
Tambahan gaya ERPNext yang saya sarankan: **`journal_entry.counter_entry_id`** — link satu
entri ke pasangannya, padanan `inter_company_journal_entry_reference`. Satu link per entri,
bukan satu kolom di 99% baris yang NULL.

**Konsekuensi yang harus dibayar, dan ini satu-satunya:**
saldo awal afiliasi klien adalah **matriks 14×14** (`Saldo Affiliasi Pembiayaan`,
`Atas Barang`, `Lain-lain`), dan saldo awal **tidak punya dokumen**. `opening.rs` hari ini
membaca `counter_site_id` dari CSV saldo awal justru untuk itu.

Tanpa kolom lawan, satu-satunya cara jujur menyimpan "HO ↔ C001, pembiayaan, Rp X" adalah
**menerbitkan satu `interunit_transaction` per pasangan bersaldo** dengan
`nature='OPENING'`. Realistisnya puluhan, bukan 546, karena hanya pasangan bernilai yang
diterbitkan. Itu lebih jujur daripada kolom: dokumen itu memang menyatakan sesuatu yang
benar-benar ada di buku klien.

Alternatifnya — membuang pasangan dan hanya membawa saldo neto per unit — berarti
**tidak bisa lagi merekonsiliasi HO↔C001 dengan buku lama mereka.** Saya tidak
menyarankannya, dan kalau itu yang dipilih harus dinyatakan, bukan ditemukan nanti.

`Barang Dagangan dalam Perjalanan` aman: lawannya berasal dari dokumen kiriman/transfer
yang memang menyebut asal dan tujuan.

### 11.4 ✅ Bekukan COA 144 yang sudah dikoreksi sebelum generator ditulis

Generator membaca `docs/fixtures/coa-144-v1.csv` — **bukan** CSV di `~/Downloads`.
Berkas itu dibuat sekali, ditandatangani, dan masuk git. Daftar koreksi yang harus
dibereskan sebelum dibekukan:

| # | koreksi | status |
|---|---|---|
| 1 | `600104 Pendapatan lain-lain` pindah ke akar pendapatan (§11.6) | diputuskan |
| 2 | `Hutang Voucher` ditambahkan sebagai akun ke-145 | diputuskan |
| 3 | `cash_in_transit` → kategori `TRANSIT` di `CASH ON HAND` | diputuskan, dengan catatan §11.1 |
| 4 | QRIS & poin **tidak** jadi akun | diputuskan |
| 5 | matriks afiliasi: 2 dilebur, 1 pecah dua — diseragamkan atau dibiarkan? | **menunggu klien** |
| 6 | 4 akun nol-saldo dua tahun: aktif atau `is_active=false` saat seed? | **menunggu klien** |
| 7 | `7020310 BIAYA USAHA LAINNYA` menggantung di kedalaman 7 | **menunggu klien** |

Sebelum #5–#7 dijawab, generator **tidak dijalankan**. Itu inti permintaan Anda dan saya setuju:
kolom "Akun target 144" adalah masukan yang baik, bukan kebenaran yang sudah terverifikasi.

### 11.5 ✅ `report_line` dibuat effective-dated — dengan satu batas yang saya tarik

Diterima:

```sql
CREATE TABLE account_report_assignment (
    account_code   text NOT NULL REFERENCES ledger_account(account_code),
    report_line    text NOT NULL REFERENCES report_line(line_code),
    effective_from date NOT NULL,
    effective_to   date,                       -- NULL = masih berlaku
    set_by text NOT NULL, set_at timestamptz NOT NULL DEFAULT now(),
    EXCLUDE USING gist (account_code WITH =,
        daterange(effective_from, effective_to, '[)') WITH &&)   -- nol tumpang tindih
);
```

Pembacaannya lewat satu fungsi, `report_line_at(account_code, posting_date)`, supaya
`financial_statements.rs` dan `statements.rs` hanya berubah di satu tempat masing-masing.
Gate-nya: **setiap akun postable punya tepat satu penugasan yang berlaku pada tanggal mana
pun sejak tanggal seed** — nol celah, nol tumpang tindih, ditegakkan constraint.

**Batas yang saya tarik: yang di-versi adalah yang mengubah ANGKA, bukan yang mengubah
LABEL.** `report_line` mengubah pengelompokan, jadi di-versi. `name` dan `client_code`
tidak — kalau Finance mengganti nama akun, orang memang mengharapkan laporan lama ikut
memakai nama baru ("kita memang selalu menyebutnya begitu"). Mem-versi nama berarti satu
akun punya dua nama di dua laporan dan tak seorang pun bisa menjelaskannya. ERPNext juga
begitu: rename mengalir ke seluruh riwayat.

### 11.6 ✅ `600104` — saya balik, dan Anda benar

Prinsipnya diterima penuh dan dipakai di seluruh sistem:

```
account     = economic truth
report_line = presentation truth
```

Jadi `Pendapatan lain-lain` diseed sebagai **pendapatan** (akar 8, `normal_balance='C'`,
`is_contra=false`), dan `report_line`-nya boleh menaruhnya persis di baris laporan yang
klien mau. Alasan saya sebelumnya — "ikuti bentuk pohon klien" — memakai identitas akun
untuk mengerjakan tugas yang `report_line` memang ada untuk mengerjakannya. Tidak ada
yang hilang: `legacy_account_code()` tetap mengembalikan `600104`.

**Satu akibat yang ikut terbuka:** kalau akar ditentukan oleh sifat ekonomi, maka
`600104 Pendapatan lain-lain` dan `Pendapatan (Biaya) Lain-lain` (akar 8) adalah dua akun
dengan arti yang sama di akar yang sama. Mungkin memang satu akun. **Pertanyaan untuk
klien** — masuk daftar §11.4 sebagai koreksi #8, dan kalau dilebur, seed jadi 144 akun
(143 + voucher).

### 11.7 ✅ Pohon di UI: yang bebas dipindah adalah grouping, bukan induk fisik

Layar Chart of Accounts menyatakannya dengan kata, bukan dengan error setelah ditekan:

- akun **belum pernah diposting** → boleh pindah induk (renumber) dan boleh dihapus;
- akun **sudah pernah diposting** → induk fisik terkunci; yang bisa diubah adalah
  **Report line**, `name`, `client_code`, dan status aktif;
- tombol pindah-induk untuk akun terpakai **tidak ditampilkan**, dan di tempatnya ada
  tautan ke penugasan `report_line` — karena 9 dari 10 kali itulah yang sebenarnya dicari.

### 11.8 ✅ Loose tetap seperti Plan 1

Tidak ada yang berubah: automation yang sudah bekerja tidak dimatikan. Loose hanya untuk
beban, akrual payroll, akrual/prepaid, pinjaman/ekuitas, dan area yang belum matang.
Inventory strict. Sales/AP/bank yang sudah punya mesin tetap auto.

### 11.9 Yang bertambah ke rencana kerja karena putaran ini

| fase | tambahan |
|---|---|
| Fase 0 | bekukan `docs/fixtures/coa-144-v1.csv`; jawab koreksi #5–#8 |
| Fase 1 | `accounting_unit_id` → `org_place`; hapus `counter_site_id` + `requires_counter_site`; `report_line` effective-dated; ganti nama `LANDED_COST` → `PRICE_CORRECTION` |
| Fase 1b | **`interunit_transaction` + `journal_entry.counter_entry_id`** — ini sekaligus menutup lubang `INTERUNIT_SETTLE` yang §1.4 temukan |
| Fase 1c | saldo awal afiliasi diterbitkan sebagai dokumen per pasangan, bukan kolom |

---

## 12. Putusan putaran 3 — 19 September 2026

### 12.1 Uang HO → toko: langsung ke petty cash, lewat afiliasi ✅

Putusan pemilik: uang dikirim HO ke **rekening pribadi kepala toko**, lalu masuk **petty
cash toko**. Jurnalnya langsung, tanpa akun perantara:

```
HO     Dr Saldo Affiliasi Pembiayaan   unit=HO      Cr Bank                        unit=HO
C001   Dr Petty Cash                   unit=C001    Cr Saldo Affiliasi Pembiayaan  unit=C001
```

Tidak ada akun "uang dalam perjalanan" untuk arah ini. Satu catatan, bukan keberatan:
kalau dua kaki itu diposting pada tanggal berbeda, saldo afiliasi memegang selisihnya
sampai kaki kedua masuk — dan itu memang jawaban yang benar. Dokumen
`interunit_transaction` sebaiknya membawa kedua tanggal.

> **Yang sifatnya pinjaman pribadi kepala toko tetap terpisah.** Kebijakan 7 September
> (`itulah-store-cash-policy`) menyatakan piutang kepala toko adalah pinjaman pribadi.
> Uang operasional yang lewat rekeningnya **bukan** pinjaman — ia afiliasi, seperti di atas.
> Dua hal berbeda yang kebetulan lewat rekening yang sama.

### 12.2 ⚠️ `cash_in_transit` punya PEMAKAIAN KEDUA yang bukan arah ini

Putusan 12.1 menyelesaikan arah **HO → toko**. Tetapi `cash_in_transit` di repo ini
sebenarnya dipakai untuk arah **sebaliknya** — setoran hasil penjualan **toko → bank**
(`deposits.rs`, `store_money.rs:897`):

```
banking  (tanggal bag berangkat)   Dr cash_in_transit   Cr laci toko
landing  (tanggal uang sampai)     Dr bank              Cr cash_in_transit
```

Dua entri karena **dua tanggal berbeda**, dan jarak antara keduanya adalah eksposurnya.
Komentar di `deposits.rs` menyatakan alasannya dengan tegas: mendebit bank pada hari bag
berangkat berarti bank memegang uang yang belum pernah didengarnya, dan setiap rekonsiliasi
sesudahnya harus menjelaskan kredit yang belum terjadi. Modul ini **sudah jalan dan
memposting**; rekonsiliasi bank bergantung padanya.

**Usul, tanpa akun baru:** `cash_in_transit` → `CASH ON HAND` + kategori `TRANSIT`.
Dan di arah ini konsekuensi neracanya justru **benar**: uang dalam tas setoran memang
masih kas perusahaan, belum uang bank. Bagan klien sendiri hanya punya `CASH ON HAND`,
`PETTY CASH`, `MODAL KASIR` — dan setoran yang sedang jalan memang salah satu pot kas.

Keluarga `pot` karena itu bertahan dengan dua nilai: `DRAWER`, `TRANSIT`.
(`PETTY CASH` dan `MODAL KASIR` kini akun sendiri, jadi tidak lagi jadi nilai `pot`.)

**Menunggu persetujuan.** Alternatifnya — membuang jeda dua tanggal — merusak
rekonsiliasi bank atau merusak hitungan laci toko; tidak ada opsi ketiga.

### 12.3 Sumbu uang bernama `unit` ✅

`org_place` → **`unit`**. Di keuangan hanya `unit` yang dipakai: bukan `site`, bukan
`org_place`.

```sql
journal_line.unit_id text NOT NULL REFERENCES unit(id)   -- ho · store-01 … store-13
```

`unit.site_id` tetap jadi peta **site → unit, banyak-ke-satu** (stok di DC berposting ke
unit `ho`). Blast radius rename: **22 berkas Rust, 14 migrasi, 2 berkas frontend** — lane
tersendiri, dan harus dikoordinasikan dengan lane rename 0256 yang belum mendarat supaya
dua rename tidak saling menimpa.

### 12.4 Matriks afiliasi diseragamkan ✅

Tiga akun, satu per nature, dan `Hutang Lain-lain` **tidak lagi jadi akun afiliasi**:

```
nature = FINANCING  → Saldo Affiliasi Pembiayaan
nature = GOODS      → Saldo Affiliasi Atas Barang
nature = OTHER      → Saldo Affiliasi Lain-lain
```

Satu akun boleh berdebit di satu unit dan berkredit di unit lain; `from_unit`/`to_unit`
tinggal di `interunit_transaction`, baris jurnal hanya membawa `unit`.

**Dicatat untuk nanti:** kalau suatu hari ada `Hutang Lain-lain` ke pihak **eksternal**
yang benar-benar bukan antar-unit, itu akun lain dan tidak boleh dicampur dengan afiliasi.

### 12.5 Seed: semua akun AKTIF ✅

Tidak ada akun yang diseed `is_active = false`. Empat akun nol-saldo dua tahun ikut aktif;
klien yang meninjau nanti. Kolom `is_active` tetap ada untuk siklus hidup ke depan, tapi
**nilai awalnya TRUE untuk semuanya**. Itu juga menghapus koreksi #6 dari daftar §11.4.

### 12.6 Group `7020310 BIAYA USAHA LAINNYA` dihapus ✅

Ia hanya menaungi tiga akun posting. Ketiganya pindah langsung ke
**`BEBAN ADMINISTRASI DAN UMUM`**:

```
Beban Administrasi & Umum
├── Biaya Pajak Reklame
├── Biaya Management Fee
└── Biaya Asuransi Kendaraan
```

Kode legacy `7020310` tetap disimpan di `ledger_account_remap` untuk telusur.
Akibat penomoran: akar 7 kehilangan satu group, `BEBAN ADMINISTRASI DAN UMUM` naik dari
25 jadi 28 akun.

> **Satu hal yang perlu Anda tahu:** bagan klien punya **dua** group bernama
> `BIAYA USAHA LAINNYA`. Yang dihapus adalah `7020310` (3 akun di atas). Yang satu lagi,
> **`70103 BIAYA USAHA LAINNYA`**, berisi `Biaya Pajak Bumi dan Bangunan (PBB)` dan
> `Property All Risk & Fire Insurance` — keduanya biaya okupansi dan duduk wajar di akar 7
> bersama `BIAYA SEWA`. Saya **biarkan**, kecuali Anda mau ia ikut dirapikan.

### 12.7 `600104` dan `8010110007` tetap dua akun ✅ — dan buktinya ternyata ada

Putusan diterima: jangan dilebur, dan jangan membuat `Biaya Lain-lain` baru tanpa bukti.

**Tapi bukti transaksi yang Anda minta ternyata sudah ada di repo** —
`outputs/coa_usage/akun-aktif-nonaktif-2024-2025.csv`, dari Laba Rugi GL klien:

| kode | nama | PUSAT 2025 | PUSAT 2024 |
|---|---|---:|---:|
| `8010110007` | Pendapatan (Biaya) Lain-Lain | **−34.181.676** | **+29.407.596** |

Akun itu **berganti tanda antar tahun**: bersih beban 34,2 juta di 2025, bersih pendapatan
29,4 juta di 2024, di kantor pusat saja. Jadi ia memang dipakai dua arah — bukan asumsi.
Konsekuensinya, di bawah prinsip **account = economic truth** yang Anda tetapkan sendiri:
satu akun dengan dua sifat ekonomi adalah persis pelanggaran prinsip itu, dan `report_line`
apa pun yang ditugaskan kepadanya akan salah separuh waktu.

Migrasi 0296 (belum di-commit) sudah pernah memecahnya jadi pendapatan + `8301 Biaya
Lain-lain`. **Putusan tetap milik Anda** — saya hanya melaporkan bahwa syarat "ada bukti"
sudah terpenuhi.

Dan tentang `600104 Pendapatan lain-lain`: ia **tidak muncul sama sekali** di Laba Rugi GL
klien 2024–2025 (97 akun L/R di berkas itu, `600104` bukan salah satunya). Jadi argumen
"ikuti posisi baris pada laporan klien" untuk akun ini berpijak pada laporan yang tidak
memuatnya.

### 12.8 ⚠️ Satu perintah yang berselisih dengan putaran 2

| putaran | tentang `600104` |
|---|---|
| **putaran 2, koreksi #6** | "economic root jangan dikorbankan demi layout laporan klien; layout ditangani `report_line`" → akar **pendapatan** |
| **putaran 3, pesan ini** | mengutip posisi Plan 1: akar 6 / BEBAN, `normal_balance = C`, contra |

Keduanya tidak bisa berlaku bersamaan. Putusan §12.7 (jangan dilebur) **cocok dengan
keduanya**, jadi yang perlu dijawab hanya akarnya. Saya tetap pada rekomendasi putaran 2 —
akar pendapatan — karena itu prinsip Anda sendiri, dan karena §12.7 menunjukkan laporan
klien yang jadi alasan bertahan di akar 6 ternyata tidak memuat akun itu.

### 12.9 Jumlah seed sesudah putaran 3: **144**

```
144  bagan klien
 −1  Hutang Lain-lain  (lebur ke Saldo Affiliasi Lain-lain, §12.4)
 +1  Hutang Voucher
────
144  akun seed, semuanya AKTIF
```

Tanpa akun QRIS, tanpa akun poin, tanpa akun setoran-dalam-perjalanan.
`docs/fixtures/coa-144-v1.csv` dibekukan dengan isi ini setelah §12.2 dan §12.8 dijawab.

---

## 13. Putusan putaran 4 — 19 September 2026. **Seluruh bagan tertutup.**

### 13.1 Tidak ada uang dalam perjalanan. Titik. ✅

Putusan pemilik: setoran toko **tetap `CASH ON HAND`** sampai bank mengakuinya. Saat
kredit bank diakui (masuk rekening bank toko), barulah jurnalnya pindah:

```
Dr Bank (rekening unit)   Cr Cash on Hand          unit = toko, tanggal = saat bank mengakui
```

Satu jurnal, satu tanggal. **Tidak ada akun transit, tidak ada kategori `TRANSIT`,
tidak ada `cash_in_transit` sebagai peran mesin.** Keluarga `pot` ikut hilang.

**Yang harus diubah di kode — dan ini bukan sekadar setelan:**

| berkas | sekarang | jadi |
|---|---|---|
| `store_money.rs:897` `store_deposit_hand_over` | `Dr cash_in_transit / Cr cash` | **tidak memposting apa pun** — dokumen hanya berpindah ke `DEPOSITED` |
| `deposits.rs` langkah landing | `Dr bank / Cr cash_in_transit` | `Dr bank / Cr cash` |
| `account_map` | key `cash_in_transit` | dihapus |
| `ledger.rs:1250` | baris usulan `"1101 Kas · TRANSIT"` | dihapus |

**Satu pekerjaan yang wajib ikut, kalau tidak kepala toko akan protes tiap minggu:**

Saldo kas toko di buku kini memuat tas yang sudah berangkat. Jadi `cash_counts` **tidak
boleh lagi** membandingkan hitungan fisik dengan saldo GL apa adanya. Saldo harapannya:

```
kas toko menurut buku
  − setoran berstatus DEPOSITED yang belum LANDED
= yang seharusnya ada di laci
```

Angka pengurangnya datang dari dokumen `store_deposit`, bukan dari akun. Dokumen itu tetap
menyimpan siapa yang membawa dan sudah berapa hari di jalan, jadi kendali operasionalnya
utuh — yang berpindah hanyalah tempat angkanya hidup: dari buku besar ke dokumen.

**Konsekuensi yang diterima sadar:** baris "Kas" di neraca per unit memuat uang yang sudah
diserahterimakan. Itu harga yang dipilih, dan ia dibayar sekali di layar hitungan laci.

### 13.2 `600104 Pendapatan lain-lain` tetap di akar BEBAN ✅

Akar 6, `normal_balance = 'C'`, `is_contra = true`. Menutup perselisihan §12.8.

Dan setelah dipikir ulang, ini **mungkin bukan pengecualian terhadap prinsip
"account = economic truth"** sama sekali: kalau isi akun itu memang **pengurang beban** —
rabat, pengembalian biaya, klaim — maka contra-expense di akar beban justru *adalah*
kebenaran ekonominya, dan namanya saja yang menyesatkan. Satu-satunya cara memastikan
adalah melihat isi transaksinya, dan akun ini tidak muncul di Laba Rugi GL klien 2024–2025.
Jadi: akar 6 sekarang, dan kalau kelak ternyata isinya pendapatan sungguhan, memindahkannya
adalah satu migrasi tanpa perpindahan data.

### 13.3 `8010110007` dipecah dua ✅

```
8010110007 Pendapatan (Biaya) Lain-Lain
        ↓
Pendapatan Lain-lain      (akar 8, kredit)
Biaya Lain-lain           (akar 8, debit)
```

Buktinya sudah ada dan tercatat di §12.7: +29,4 juta (2024) vs −34,2 juta (2025) di PUSAT
saja. Migrasi 0296 yang belum di-commit sudah pernah memecahnya persis begini, jadi
bentuknya tinggal ditulis ulang, bukan dirancang.

### 13.4 Jumlah seed final: **145**

```
144  bagan klien
 −1  Hutang Lain-lain        → lebur ke Saldo Affiliasi Lain-lain (§12.4)
 +1  Hutang Voucher
 +1  Biaya Lain-lain         → pecahan dari 8010110007 (§13.3)
────
145  akun seed, semuanya AKTIF
```

Tanpa akun QRIS · tanpa akun poin · tanpa akun setoran-dalam-perjalanan.

### 13.5 Tidak ada lagi yang menunggu putusan

Daftar blocking §11.4 dan §12 kosong. `docs/fixtures/coa-144-v1.csv` bisa dibekukan, dan
Fase 0 bisa jalan.

---

## 14. Custody — dan satu aturan yang ternyata berlaku dua arah

Usulan pemilik: rekening pribadi kepala toko **bukan akun**. Ia tempat titipan sementara
untuk uang yang secara pembukuan sudah jadi Petty Cash toko.

```
HO     Dr Saldo Affiliasi Pembiayaan  unit=HO     Cr Bank HO                     unit=HO
C001   Dr Petty Cash                  unit=C001   Cr Saldo Affiliasi Pembiayaan  unit=C001
```

Tanpa `Piutang Pegawai`, tanpa `Cash in Transit`, tanpa `Cash in Custody`.
**Diterima.** Dan rekening kepala toko tidak pernah jadi baris `company_bank_account`.

### 14.1 Ini aturan yang sama dengan §13.1 — dua arah, satu prinsip

Perhatikan bahwa §13.1 (setoran toko → bank) dan §14 (HO → petty cash toko) sampai pada
bentuk yang identik dari dua arah berlawanan:

> **Akun menjawab "uang ini apa". Unit menjawab "milik siapa".
> Dokumen menjawab "sedang di tangan siapa".**

Buku besar berhenti di dua pertanyaan pertama. Pertanyaan ketiga tidak pernah jadi akun,
tidak pernah jadi dimensi jurnal, dan tidak pernah mengubah saldo. Itu prinsip yang sama
yang membuat §13.1 aman, dan sekarang ia berlaku di seluruh rantai uang.

### 14.2 Satu perubahan yang saya usulkan: jangan tabel baru

Usulan aslinya `petty_cash_transfer`. Tapi pengiriman HO → C001 **sudah** sebuah dokumen:
`interunit_transaction` dengan `nature = FINANCING` (§12.4). Dua tabel untuk satu kejadian
berarti dua tabel yang harus dijaga sepakat.

Jadi custody jadi kolom pada dokumen yang sudah ada:

```sql
ALTER TABLE interunit_transaction
  ADD COLUMN custodian_employee_id text,      -- yang sedang memegang
  ADD COLUMN receiver_employee_id  text,      -- yang seharusnya menerima
  ADD COLUMN custody_status text CHECK (custody_status IN ('SENT','ACKNOWLEDGED')),
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN acknowledged_at timestamptz;
```

Persis pola yang `store_deposit` sudah pakai (`deposited_by`, `deposited_at`, status
`PREPARED → DEPOSITED → LANDED`). Dua dokumen, satu pola, tanpa abstraksi ketiga.
Kalau kelak muncul kasus custody ketiga, **barulah** digeneralisasi — bukan sebelumnya.

Pengakuan custody **tidak menulis jurnal apa pun.** `ACKNOWLEDGED` hanya memindahkan nama.

### 14.3 Pekerjaan yang ikut — dan ternyata cuma satu, bukan dua

Karena Petty Cash C001 sudah bersaldo sebelum admin menerimanya, hitungan petty cash akan
menunjukkan kurang — persis masalah yang §13.1 ciptakan untuk laci. **Perbaikannya satu
aturan yang menutup keduanya sekaligus:**

```
saldo harapan di kotak yang dihitung
  = saldo GL untuk arti itu, di unit itu
  − yang dikatakan DOKUMEN sedang di tangan orang

  cash        − store_deposit  berstatus DEPOSITED belum LANDED
  petty_cash  − interunit_transaction berstatus SENT belum ACKNOWLEDGED
```

`cash_counts.rs` menghitung tiga arti (`cash`, `petty_cash`, `cashier_float`); aturan di
atas dipasang satu kali di sana dan melayani dua sumber. Tanpa ini, kepala toko dan admin
petty cash akan melihat selisih kurang yang bukan salah mereka, setiap minggu, di 13 toko.

### 14.4 `Piutang Pegawai` tetap untuk klaim yang sungguhan

Custody bukan piutang. Kepala toko yang memegang uang operasional **bukan** debitur.
`Piutang Pegawai dan Manajemen` (dengan dimensi `party`: `EMPLOYEE`, `STORE_MANAGER`,
`MANAGEMENT`) dipakai hanya kalau ada klaim nyata: pinjaman pegawai, kasbon yang harus
dipertanggungjawabkan, atau selisih yang **sudah diputuskan** jadi tagihan.

Ini juga menyelesaikan ketegangan dengan kebijakan 7 September
(`itulah-store-cash-policy`: "piutang kepala toko = pinjaman pribadi") — kebijakan itu
tentang **pinjaman pribadi**, kejadian ekonomi yang berbeda. Dua-duanya berlaku dan tidak
bertabrakan.

Kalau uang benar-benar hilang sebelum diserahkan, barulah ada kejadian akuntansi baru,
sesudah investigasi:

```
Dr Biaya Lain-lain                     Cr Petty Cash     -- diputuskan jadi kerugian
Dr Piutang Pegawai [party=…]           Cr Petty Cash     -- diputuskan jadi tagihan
```

`Biaya Lain-lain` adalah akun yang §13.3 baru saja pisahkan dari `8010110007` — dan arti
`cash_variance` memang sudah jatuh ke sana sejak dulu. Jadi tidak ada akun baru lagi.

### 14.5 Satu detail implementasi yang mudah terlewat

Rekening kepala toko tidak ada di GL, tapi **ia akan muncul di rekening koran HO** sebagai
nama penerima transfer. Supaya baris statement itu bisa dicocokkan, `interunit_transaction`
perlu menyimpan referensi tujuan sebagai **teks/nomor rujukan** — bukan sebagai
`company_bank_account`. Tanpa itu, setiap pengiriman ke toko jadi baris bank yang tak
dikenali di layar rekonsiliasi.

### 14.6 Jumlah seed tidak berubah: **145**

Custody tidak menambah akun apa pun.

---

## 15. Koreksi: satu akun `Uang Dalam Perjalanan`. **Menggantikan §13.1 dan §14.3.**

Pemilik mengangkat keberatan yang tepat: *"kalau belum pengakuan, uangnya sudah berpindah."*
Sesudah dua kasus lengkap terlihat bersama, §13.1 salah dan ini yang benar.

### 15.1 Kenapa jawabannya berubah: kasus kedua tidak sama dengan kasus pertama

| | uang ada di mana sebenarnya | buku bilang apa (tanpa transit) | seberapa jauh melesetnya |
|---|---|---|---|
| **Toko → bank** | tas, dibawa orang, masih uang tunai milik unit itu | `Cash on Hand` unit itu | kasar, tapi **tidak salah** — ia memang kas unit itu |
| **HO → petty cash toko** | **rekening pribadi kepala toko** | `Petty Cash C001` | **salah** — itu bukan kas kecil, dan bukan di toko |

§13.1 diputuskan saat baru kasus pertama yang di meja. Di kasus pertama "biarkan di Cash on
Hand" masih bisa dibela. Di kasus kedua tidak: buku menyatakan kas kecil toko sudah berisi
Rp5 juta padahal uangnya ada di rekening seorang individu. Itu bukan pembulatan, itu
pernyataan yang tidak benar.

### 15.2 Yang dibeli oleh satu akun

```
1 akun:  Uang Dalam Perjalanan        (akar 1, grup KAS & SETARA KAS, saldo normal debit)
```

**Toko → bank**

```
tas berangkat   Dr Uang Dalam Perjalanan  unit=C001   Cr Cash on Hand  unit=C001
uang sampai     Dr Bank                   unit=C001   Cr Uang Dalam Perjalanan
```

**HO → petty cash toko**

```
HO kirim        Dr Saldo Affiliasi Pembiayaan  unit=HO     Cr Bank HO             unit=HO
                Dr Uang Dalam Perjalanan       unit=C001   Cr Saldo Affiliasi     unit=C001
admin terima    Dr Petty Cash                  unit=C001   Cr Uang Dalam Perjalanan
```

Dan yang paling berharga — **§14.3 hilang seluruhnya:**

```
SEBELUM (§14.3)   saldo harapan = saldo GL − apa kata dokumen sedang di tangan orang
                  dipasang di cash_counts, untuk dua arti, dari dua sumber dokumen
SESUDAH           saldo harapan = saldo GL
```

Pengurangan yang harus dihitung benar di dua tempat, selamanya, **tidak jadi ditulis**.
Saldo `cash` dan `petty_cash` di buku sudah tidak memuat uang yang di jalan, karena uang
itu memang pindah akun saat ia berpindah tangan. Itu justru inti keberatan pemilik: tanggal
pengakuan mengikuti **perpindahan**, bukan mengikuti konfirmasi.

Tambahannya:

- neraca per unit menyatakan satu angka jujur: uang yang kita punya, bukan di kotak, bukan
  di bank, dan ada yang bertanggung jawab atasnya;
- `deposits.rs` tidak perlu ditulis ulang jadi lebih miskin — model dua tanggal/dua
  postingnya memang sudah begitu sejak awal;
- ERPNext mengirim akun ini di bagan bawaannya (`Assets > Current assets > Cash in Hand >
  Cash in Transit`, `account_type: 'Cash'`), jadi bentuknya standar, bukan karangan kita;
- bagan klien **sudah punya konsepnya untuk barang** — `Barang Dagangan dalam Perjalanan`
  dan `Kantong Belanja dalam Perjalanan`. Yang hilang cuma versi uangnya.

Harganya: **satu akun**, dan satu jurnal tambahan per perpindahan.

### 15.3 Custody TIDAK dibatalkan — ia menjawab pertanyaan yang lain

§14 tetap berlaku seluruhnya. Pembagiannya justru makin bersih:

```
AKUN    berapa, dan uang ini sedang apa   →  Uang Dalam Perjalanan
UNIT    milik siapa                       →  C001
CUSTODY sedang di tangan siapa            →  Kepala Toko → Admin
```

Kolom custody di `interunit_transaction` (§14.2) tetap dibuat, `ACKNOWLEDGED` tetap tidak
menulis jurnal sendiri — yang menulis jurnal adalah **penerimaan** oleh admin, dan itu
memang kejadian ekonomi: uang berpindah dari perjalanan ke kas kecil.

`Piutang Pegawai` tetap hanya untuk klaim sungguhan (§14.4). Rekening kepala toko tetap
tidak pernah jadi akun (§14.5 tetap berlaku — referensinya disimpan sebagai teks untuk
pencocokan rekening koran).

### 15.4 Seed final: **146**

```
144  bagan klien
 −1  Hutang Lain-lain        → lebur ke Saldo Affiliasi Lain-lain
 +1  Hutang Voucher
 +1  Biaya Lain-lain         → pecahan dari 8010110007
 +1  Uang Dalam Perjalanan   → §15
────
146  akun seed, semuanya AKTIF
```

Tetap tanpa akun QRIS dan tanpa akun poin.
`cash_in_transit` tetap jadi `semantic_key` di `account_map`, menunjuk akun ini.

### 15.5 Forum Frappe mengonfirmasi bentuknya — dan menunjukkan satu tempat kita lebih ketat

`discuss.frappe.io/t/68599` — pertanyaan yang sama persis (pindah dana antar cabang, cabang
sebagai accounting dimension). Jawaban yang diterima:

```
On Transfer
  Fund in Transit   Branch-A   Dr 100
  Cash Account      Head Office          Cr 100
On Receipt
  Cash Account      Branch-A   Dr 100
  Fund in Transit   Branch-A             Cr 100
```

plus *"create a custom doctype named Fund Transfer … workflow: Transfer → GL entry for Fund
in Transit; Receipt → GL entry for Fund Receipt (should be available to recipient branch)"*.

Tiga hal yang kita ambil:

1. **Akun `Fund in Transit`** — §15.2, sama.
2. **Dua dokumen/dua entri karena dua tanggal** — peterg menyatakannya eksplisit; ini
   `interunit_transaction` kita dengan `SENT → ACKNOWLEDGED`, dan **`ACKNOWLEDGED` menulis
   jurnal kedua** (mengoreksi §14.2, yang menyatakan tak ada jurnal kedua).
3. **Penerimaan dicatat oleh unit PENERIMA**, bukan pengirim. Kontrol yang bagus: HO tidak
   bisa menyatakan toko sudah menerima. Konsekuensi RBAC: admin/kepala toko butuh izin
   menekan "diterima" — itu **bukan** izin menulis jurnal bebas, melainkan satu langkah
   dokumen. Finance tetap hanya di HO.

Dan satu tempat kita **lebih ketat dari jawaban forum**: entri "On Transfer" mereka
mendebit Branch-A dan mengkredit Head Office dalam satu entri, sehingga neraca percobaan
Branch-A **tidak seimbang sendiri**. Aturan 0120 di repo ini menolaknya. Karena itu kaki
HO-nya lewat `Saldo Affiliasi`, dan tiap unit tetap punya buku yang berdiri sendiri.

---

## 16. Tiga perjalanan, bukan dua — dan namanya

Pemilik menambahkan kasus ketiga. Ketiganya punya jeda, dan ketiganya berujung di akun
tujuan yang berbeda.

| # | perjalanan | nama akuntansinya | tujuan akhir | peran mesin |
|---|---|---|---|---|
| 1 | HO → unit, dana operasional | **fund transfer** — dana dalam perjalanan | `Petty Cash` | `petty_cash` |
| 2 | unit → bank, hasil penjualan | **deposit in transit** (istilah baku rekonsiliasi bank; di repo ini sudah pernah dinamai **`Setoran Dalam Perjalanan`**) | `Bank` | `bank_giro` / `bank_savings` |
| 3 | HO → unit, **modal kasir fisik** | **float in transit** — modal kasir dalam perjalanan | `Modal Kasir` | `cashier_float` |

### 16.1 Modal kasir: dikembalikan, dan tidak pernah campur

Dua sifat yang pemilik nyatakan, dan keduanya sudah ada tempatnya:

**"Unit harus mengembalikannya."** Tidak perlu mekanisme baru — kewajiban itu **sudah**
terbaca di `Saldo Affiliasi Pembiayaan`: saat modal kasir dikirim, C001 berutang ke HO
sebesar itu, dan saat dikembalikan, saldonya kembali nol.

```
kirim     HO    Dr Saldo Affiliasi   Cr Bank/Kas HO
                C001  Dr Uang Dalam Perjalanan   Cr Saldo Affiliasi
diterima  C001  Dr Modal Kasir             Cr Uang Dalam Perjalanan
kembali         kebalikannya, lewat jalur yang sama
```

**"Modal kasir tidak pernah berpindah ke Cash on Hand atau Petty Cash."** Ini aturan yang
bisa ditegakkan, bukan sekadar konvensi — dan kernel posting (0261–0268) memang untuk ini:

```
MODAL KASIR   posting_mode = AUTO_ONLY   manual_je_policy = NO
              account_source_rule ALLOW: INTERUNIT_SETTLE · OPENING · CASH_COUNT
```

Tidak ada dokumen lain yang bisa menyentuhnya, dan tidak ada orang yang bisa menjurnalnya
dengan tangan. Pemindahan modal kasir ke laci atau kas kecil jadi **mustahil ditulis**,
bukan sekadar tidak dianjurkan. (`CASH_COUNT` ikut diizinkan karena modal kasir adalah satu
dari tiga arti yang memang dihitung fisik di `cash_counts.rs`.)

### 16.2 Satu akun perjalanan, atau tiga?

Inilah satu-satunya hal yang belum diputuskan, dan framing-nya sederhana:

> **`report_line` tidak bisa memecah satu akun jadi tiga baris laporan.**
> Jadi pertanyaannya: apakah neraca perlu menampilkan ketiganya sebagai **tiga baris
> terpisah**?

| | seed | neraca | detail per jenis |
|---|---|---|---|
| **A. Satu akun** `Uang Dalam Perjalanan` + kategori `transit_kind` (`FUND` · `DEPOSIT` · `FLOAT`) | **146** | satu baris: "uang kita yang sedang di jalan" | dari kategori + dokumen |
| **B. Tiga akun** `Dana Dalam Perjalanan` · `Setoran Dalam Perjalanan` · `Modal Kasir Dalam Perjalanan` | **148** | tiga baris | dari akun |

**Rekomendasi: A.** Ketiganya sifat ekonominya identik — uang perusahaan, bukan di kotak,
bukan di bank, ada yang bertanggung jawab. Satu angka per unit justru yang ingin dibaca
bendahara, dan jenis serta umurnya sudah hidup di dokumen (`store_deposit`,
`interunit_transaction`) yang memang menyimpan siapa membawa dan sudah berapa hari.

Preseden yang mendukung B, supaya jujur: bagan klien memisahkan barang dalam perjalanan
jadi **dua** akun (`Barang Dagangan` vs `Kantong Belanja`). Tapi pemisahan itu mengikuti
**akun tujuan yang berbeda** (dua akun persediaan). Di sini ketiganya memang berujung di
tiga akun berbeda — jadi argumen B bukan argumen kosong. Kalau pemilik ingin tiga baris di
neraca, B yang benar dan seed jadi 148.

---
---

# BAGIAN II — Arsitektur otoritas, dokumen kas, dan antar-unit

**Putaran 5 · 19 September 2026 · dari klarifikasi akuntan klien (WA 11:12–12:10).**

> ## ⚠️ Yang digugurkan oleh bagian ini
>
> | bagian | nasib |
> |---|---|
> | **§15** (akun `Uang Dalam Perjalanan`) | **DICABUT.** Akuntan: *"Secara administrasi kita tidak ada akun Transit… langsung diakui ke account target."* |
> | **§16.2** (satu vs tiga akun perjalanan) | **GUGUR** — pertanyaannya tidak ada lagi. |
> | **§13.1** (jurnal tunggal saat bank mengakui) | **GUGUR** untuk arah HO→unit; untuk arah unit→bank lihat **A6 — belum terjawab**. |
> | **§14.2** (custody tidak menulis jurnal kedua) | **DIKOREKSI** — pengakuan unit *adalah* jurnal kedua, dan ia milik unit. |
> | **§16.1** (`MODAL KASIR` AUTO_ONLY) | **tetap**, diperkuat oleh matriks otoritas A4. |
>
> Yang **tidak** berubah: seed bagan (~144, §11.1/§12.9), unit = HO + C001–C013 (§12.3),
> `counter_site_id` dihapus (§11.3), afiliasi 3 akun bertanda (§12.4), `report_line`
> effective-dated (§11.5), loose hanya untuk domain tanpa mesin (§11.8).

---

## A1. Audit keadaan sekarang

### Apa yang SUDAH ada dan dipakai ulang

| konsep spesifikasi | sudah ada sebagai | catatan |
|---|---|---|
| **BKK / BKM** | **`cash_document`** + `domain::CashDirection` | **Sudah jadi.** `Out → "KK"`, `In → "KM"`, nomor `KK-26-09-00001` "dalam huruf klien sendiri" (`cash_document.rs:11`). Tangga DRAFT → *approved (nomor diambil di sini)* → POSTED → REVERSED, `journal_entry_id`, `reversal_entry_id`, lampiran, slip tiga tanda tangan. Persis Payment Entry gaya ERPNext dengan istilah klien. |
| pembayaran supplier | `supplier_payment`, `payment_batch`, `payment_instruction`, `payment_ledger_entry`, `payment_allocation` | pakai ulang apa adanya |
| kas toko | `store_money.rs`, `domain/store_cash.rs`, `cash_shift`, `store_deposit`, `store_expense` | pakai ulang; otoritasnya yang diperbaiki |
| setoran toko | `store_deposit` (`PREPARED→DEPOSITED→LANDED`, `deposited_by`, `deposited_at`) | benih custody sudah ada di sini |
| remitansi | `remittance_order` + `_line` + `_execution`, `source='SALES_PROCEEDS'` | **arah toko→HO saja**; arah HO→toko tidak punya dokumen |
| kepemilikan bank | `company_bank_account.site_id`, `store_bank_destination` | **`site_id` inilah diskriminator** yang dibutuhkan A6 |
| peta akun tak langsung | `account_map(semantic_key, site_id, qualifier)` — 62 key, 1.382 baris | pakai ulang; spesifikasi §A memang menyuruh mempertahankannya |
| kernel kebijakan posting | `posting_mode` × `manual_je_policy` × `account_source_rule` | pakai ulang; **kurang satu sumbu** (unit) |
| satu pintu jurnal | `poster::post` — nol INSERT jurnal di luarnya | **inilah yang membuat penegakan otoritas murah** |

### Konflik yang ditemukan

| # | konflik | bukti |
|---|---|---|
| **C1** | **Auto-bridge menulis kedua kaki dalam satu entri, satu tanggal.** `domain::interunit` mengambil baris lintas-unit dan menambahkan kaki afiliasi sampai tiap unit nol — otomatis, seketika. | `domain/interunit.rs:18-32` |
| **C2** | **HO memposting langsung ke Petty Cash toko.** `petty_cash_replenishment` → `Dr petty_cash [site] / Cr bank [dc]`, komentarnya sendiri: *"Cross-site, and the affiliate legs are the poster's job."* | `store_money.rs:3108` |
| **C3** | **Satu `cash_document` membentang dua unit.** Ia punya `from_site` DAN `to_site`; satu-satunya larangan (`check4`) hanya melarang kedua sisi identik. | skema `cash_document` |
| **C4** | **Afiliasi = dua akun HO-sentris**, bukan satu akun bertanda. HO selalu membukukan `Piutang Affiliasi`, toko selalu `Hutang Affiliasi`. | `domain/interunit.rs:34-41`, `account_map` |
| **C5** | **Kebijakan posting tidak punya sumbu unit; RBAC tidak punya lingkup unit.** Peran hanya 3 global (`CASHIER`/`SUPERVISOR`/`ADMIN`) dan izin dinilai per **prefiks URL** (`required_role(method, path)`). Tidak ada yang bisa menyatakan "HO tidak boleh memposting Petty Cash C001". | `domain/auth.rs:62`, `app_user_role_check` |
| **C6** | **`cash_in_transit` masih dipakai** oleh setoran toko→bank (dua entri, dua tanggal). Klien bilang tak ada akun transit — tapi **belum menyebut jurnal penggantinya**. | `deposits.rs:19`, `store_money.rs:897` |
| **C7** | `journal_line.counter_site_id` + `requires_counter_site` masih ada. | 17 berkas, 10 migrasi |

---

## A2. Model domain revisi — sekecil mungkin

Empat perubahan. Tidak ada subsistem baru.

### (1) `ledger_account.custody` — kolom otoritas yang hilang

```sql
ALTER TABLE ledger_account ADD COLUMN custody text
    CHECK (custody IN ('HO','UNIT'));     -- NULL = tak ada penanggung jawab fisik
```

| custody | akun | artinya |
|---|---|---|
| `HO` | Bank - Giro · Bank - Tabungan · Deposito | hanya dokumen **milik HO** yang boleh menulisnya, **di unit mana pun** |
| `UNIT` | CASH ON HAND · PETTY CASH · MODAL KASIR | hanya dokumen **milik unit itu sendiri** yang boleh menulisnya |
| `NULL` | semua akun lain | tidak dibatasi custody |

Ini menerjemahkan kalimat akuntan langsung jadi data: *"pengelolaan cash in Bank sepenuhnya ada di HO… Tim HO tidak bisa langsung transaksi ke akun Cash On Hand, Petty Cash, dan Modal Kasir Unit."*

### (2) Custody guard di `poster::post` — satu tempat, tak bisa dilewati

`PostingIntent` mendapat satu field: `owner_unit` — unit yang **memiliki dokumen**. Lalu:

```
untuk setiap baris:
  custody='UNIT' dan line.unit ≠ intent.owner_unit   → TOLAK
  custody='HO'   dan intent.owner_unit ≠ HO          → TOLAK
```

Karena `poster::post` adalah satu-satunya penulis jurnal di seluruh estate (nol
`INSERT INTO journal_entry` di luarnya), aturan ini **tidak bisa dihindari modul mana pun**
dan tidak perlu ditegakkan ulang di 25 tempat. Ini juga yang mematikan C1 dan C2
sekaligus: auto-bridge boleh tetap hidup, tapi ia **tidak akan pernah lagi** bisa menulis
kas unit lain.

> **Auto-bridge tidak dibunuh, dibatasi.** Untuk kejadian yang memang satu momen — HO
> membayar tagihan listrik toko dari bank HO — tidak ada uang fisik yang berpindah dan
> tidak ada yang perlu "diterima": beban toko dan utang afiliasinya lahir bersamaan.
> Di situ auto-bridge benar dan tetap dipakai. Yang dilarang adalah menyeberangi **batas
> custody kas**.

### (3) `interunit_reference` (IUT) — objek korelasi netral

```sql
CREATE TABLE interunit_reference (
    reference_id   uuid PRIMARY KEY,
    reference_no   text NOT NULL UNIQUE,          -- IUT-2026-00125
    from_unit      text NOT NULL REFERENCES unit(id),
    to_unit        text NOT NULL REFERENCES unit(id),
    nature         text NOT NULL CHECK (nature IN ('FINANCING','GOODS','OTHER')),
    purpose        text NOT NULL,                 -- "Petty Cash", "Modal Kasir", "Payroll"
    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
    expected_on    date,
    status         text NOT NULL
        CHECK (status IN ('UNMATCHED','MATCHED','DISCREPANCY','RESOLVED','CANCELLED')),
    created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (from_unit <> to_unit)
);
```

Ia **tidak memposting apa pun**. Ia hanya menghubungkan BKK milik HO dengan BKM milik unit,
dan memberi keduanya satu nomor yang bisa disebut manusia.

### (4) `cash_document` — satu unit pemilik, bukan dua

```sql
ALTER TABLE cash_document
  ADD COLUMN owner_unit_id  text REFERENCES unit(id),      -- unit yang MEMILIKI dokumen ini
  ADD COLUMN interunit_reference_id uuid REFERENCES interunit_reference;
-- from_site / to_site berhenti jadi dua unit berbeda:
ALTER TABLE cash_document ADD CONSTRAINT cash_document_one_unit
  CHECK (from_site = to_site);      -- kecuali kind='TRANSFER' milik HO antar rekening HO
```

`kind='PAY'` → tampil **BKK**, `kind='RECEIVE'` → tampil **BKM**. Nomornya sudah `KK-…`/`KM-…`.
**Tidak ada mesin BKK dan mesin BKM terpisah** — satu dokumen, satu arah, dua nama di layar.

### (5) `cash_custody` — minimal, digantung ke IUT

```sql
CREATE TABLE cash_custody (
    reference_id        uuid PRIMARY KEY REFERENCES interunit_reference,
    custodian_employee_id text NOT NULL,
    amount_minor        bigint NOT NULL,
    handed_over_at      timestamptz,
    acknowledged_at     timestamptz,
    discrepancy_minor   bigint NOT NULL DEFAULT 0,
    status text NOT NULL CHECK (status IN ('HELD','HANDED_OVER','SHORT'))
);
```

Bukan akun, bukan dimensi, bukan cost center, **tidak pernah menulis jurnal**.

### Yang dihapus

`journal_line.counter_site_id` · `ledger_account.requires_counter_site` ·
`ledger_account.counterparty_site_id` (C7). Konteks unit-lawan hidup di `interunit_reference`.

---

## A3. Matriks posting

`U` = unit pemilik dokumen. Setiap entri seimbang **di unitnya sendiri** (aturan 0120).

| # | kejadian | dokumen | jurnal |
|---|---|---|---|
| 1 | **Bayar supplier** | BKK @HO | `Dr Hutang Supplier` / `Cr Bank` — keduanya @HO |
| 2 | **BKM umum** (terima uang) | BKM @U | `Dr Kas/Bank @U` / `Cr Piutang atau Pendapatan @U` |
| 3a | **HO danai Petty Cash toko — sisi HO** (T0) | BKK @HO · IUT | `Dr Saldo Affiliasi Pembiayaan @HO` / `Cr Bank @HO` |
| 3b | **— sisi unit** (T1, saat uang diterima) | BKM @C001 · IUT sama | `Dr Petty Cash @C001` / `Cr Saldo Affiliasi Pembiayaan @C001` |
| 4a | **HO kirim Modal Kasir — sisi HO** | BKK @HO · IUT | `Dr Saldo Affiliasi Pembiayaan @HO` / `Cr Bank/Kas @HO` |
| 4b | **— sisi unit** | BKM @C001 · IUT sama | `Dr Modal Kasir @C001` / `Cr Saldo Affiliasi Pembiayaan @C001` |
| 5 | **Akrual payroll** (sepanjang bulan) | payroll run @U | `Dr Beban Gaji/Lembur/BPJS @U` / `Cr Biaya Gaji YMHD @U` |
| 6 | **Bayar payroll** (tanggal gajian) | BKK @U | `Dr Biaya Gaji YMHD @U` / `Cr Petty Cash @U` — **tidak menyentuh afiliasi lagi** |
| 7 | **Selisih antar-unit → Piutang Pegawai** | BKM @U sesudah konfirmasi HO | `Dr Petty Cash 400k` + `Dr Piutang Pegawai [party] 100k` / `Cr Saldo Affiliasi 500k` |
| 8 | **Eliminasi konsolidasi** | — | jumlah ketiga akun afiliasi lintas 14 unit = **0** saat semua IUT `MATCHED`; sisa ≠ 0 adalah IUT yang belum diakui unit, dan itu **memang eksposurnya** |
| 9 | **Persediaan (sudah otomatis)** | `SALE_DAY`/`COGS_DAY`/`GOODS_RECEIPT` | tak berubah — semuanya satu unit |
| 10 | **Setoran toko → bank** | ⚠️ **lihat A6 — belum bisa dipetakan** | |

**Baris 8 adalah jawaban atas "kalau ada interval, uangnya di mana?"** Ia tidak di akun
transit; ia adalah **bagian afiliasi yang belum berpasangan**. Akuntan menyatakannya
persis begitu: *"Sebenarnya tidak bisa dikatakan sebagai account transit Pak, tapi
merupakan alur transaksi atas entitas 2 unit yang berbeda."*

**Baris 6 menjawab peringatan §J:** pembayaran gaji mengurangi `Biaya Gaji YMHD`, bukan
afiliasi. Afiliasi = hubungan pendanaan antar-unit; YMHD = kewajiban ke pegawai. Dua
hubungan ekonomi berbeda, dan guard-nya adalah `account_source_rule`: `Saldo Affiliasi`
hanya menerima `INTERUNIT_SETTLE`, `OPENING` dan koreksi bertanda tangan — sebuah
`PAYROLL_RUN` yang menyentuhnya ditolak database.

---

## A4. Matriks otoritas

| akun | custody | siapa yang boleh MEMPOSTING | siapa yang boleh MELIHAT |
|---|---|---|---|
| Bank - Giro / Tabungan / Deposito | `HO` | dokumen milik **HO** saja, termasuk saat barisnya duduk di unit lain | HO + unit ybs |
| CASH ON HAND @U | `UNIT` | dokumen milik **U** saja | HO + U |
| PETTY CASH @U | `UNIT` | dokumen milik **U** saja | HO + U |
| MODAL KASIR @U | `UNIT` | dokumen milik **U** saja, dan hanya `INTERUNIT_SETTLE`·`OPENING`·`CASH_COUNT` (§16.1) | HO + U |
| Saldo Affiliasi ×3 | `NULL` | tiap unit menulis kakinya sendiri lewat BKK/BKM; `account_source_rule` ALLOW `INTERUNIT_SETTLE`·`OPENING`·koreksi | semua |
| Piutang Pegawai | `NULL` | hanya sesudah IUT ber-status `RESOLVED`, atau koreksi bertanda tangan | HO + U |
| Jurnal manual | — | **Finance HO saja** (§11.1 — finance hanya ada di HO) | — |

**Melihat ≠ memposting.** HO melihat seluruh saldo unit; ia tidak bisa menulisnya.

### Cara menegakkannya — paling sedikit merusak

Tiga lapis, dari yang termurah:

1. **`ledger_account.custody` + guard di poster** (A2.2) — menutup seluruh jalur mesin
   sekaligus, satu tempat, tak bisa dilewati. **Ini yang mengerjakan 90% pekerjaan.**
2. **`app_user` → unit.** Hari ini tidak ada. Rantainya sudah tersedia:
   `app_user.employee_id` → posting kepegawaian → `org_place`/`unit` (pola yang modul People
   sudah pakai: "scope dari posting"). Satu fungsi `unit_of(principal)`, bukan tabel baru.
3. **Peran.** 3 peran global tidak cukup untuk memisahkan "kepala toko" dari "admin petty
   cash" dari "finance HO". Usul **paling kecil**: jangan tambah enum peran; tambah
   **kapabilitas per rute** bergaya `required_role_for_action` yang `attendance.rs` **sudah**
   punya, lalu pasang `unit_of(principal)` sebagai pemeriksaan kedua. Peran tetap 3;
   yang bertambah adalah "unit mana" — dan itu memang sumbu yang hilang, bukan peran.

---

## A5. Mesin keadaan — seminimal mungkin

```
cash_document (BKK/BKM)      DRAFT → APPROVED(nomor) → POSTED → REVERSED      ← SUDAH ADA
interunit_reference          UNMATCHED → MATCHED
                                       → DISCREPANCY → RESOLVED
                                       → CANCELLED
cash_custody                 HELD → HANDED_OVER
                                  → SHORT → (RESOLVED lewat IUT)
```

**Tidak ada `PARTIALLY_RECEIVED`.** Invarian yang ditegakkan database:

> `MATCHED` ⇔ total BKM = total BKK, persis. Selisih fisik **tidak pernah** mengurangi
> BKM; ia jadi baris `Piutang Pegawai` **di dalam** BKM yang sama, sehingga totalnya tetap
> sama (matriks A3 baris 7).

`DISCREPANCY` → `RESOLVED` butuh konfirmasi HO yang tercatat (siapa, kapan) — persis kata
akuntan: *"setelah di konfirmasi oleh HO kepada ybs"*.

---

## A6. ⚠️ SATU ALUR YANG TIDAK BISA MEMENUHI SEMUA ATURAN SEKALIGUS

**Setoran hasil penjualan toko → rekening bank unit (akses dipegang HO).**

Akuntan menyatakan tiga hal yang, digabung, tidak punya solusi:

1. **tidak ada akun transit** (11:13);
2. **bukan afiliasi**, karena disetor ke rekening bank unit itu sendiri (11:51);
3. **kas unit dikelola unit, bank dikelola HO** (11:37, 11:39).

Jurnalnya tak terhindarkan `Dr Bank @U / Cr Cash on Hand @U` — satu entri yang menyentuh
akun ber-custody `HO` **dan** akun ber-custody `UNIT`. Di bawah A4, dokumen mana pun yang
menulisnya melanggar salah satu custody. Empat jalan keluar, semuanya melanggar satu hal:

| jalan | yang dilanggar |
|---|---|
| (a) BKK unit + BKM HO lewat afiliasi | aturan 2 — akuntan bilang bukan afiliasi |
| (b) satu dokumen milik HO, diposting saat kredit bank terlihat | aturan 3 — HO mengkredit Cash on Hand unit; dan kas toko lebih tinggi dari fisiknya selama jeda |
| (c) satu dokumen milik unit, diposting saat tas berangkat | aturan 3 — unit mendebit bank yang dikelola HO; bank diakui sebelum menerima |
| (d) akun transit | aturan 1 |

**Ini bukan keputusan yang boleh saya ambil.** Pertanyaan untuk akuntan, satu kalimat:

> *Saat uang penjualan toko disetor ke rekening bank unit sendiri, jurnalnya dibuat oleh
> siapa dan pada tanggal berapa — saat tas berangkat, atau saat kredit bank terlihat?
> Dan kalau ada jeda satu hari, selisihnya duduk di Cash on Hand unit atau di Bank?*

Satu kalimat jawaban menutup alur ini. **Sampai terjawab, `cash_in_transit`, `deposits.rs`
dan `store_deposit` DIBIARKAN apa adanya** — spesifikasi §K memang meminta begitu, dan
menghapus mekanisme yang jalan sebelum penggantinya diketahui adalah cara membuat lubang.

Catatan yang mungkin sudah setengah menjawabnya — akuntan (11:52): *"Kalau di rekening
lain selain rekening atas nama pemilik toko itu baru sebagai afiliasi atau sebagai
pembayaran hutang."* Artinya **ada dua sub-kasus**, dan diskriminatornya sudah ada di
skema: `company_bank_account.site_id`.

```
tujuan setoran .site_id == unit toko   →  sama-unit, tanpa afiliasi   (kasus A6 di atas)
tujuan setoran .site_id  ≠ unit toko   →  afiliasi, seperti A3 baris 3
```

Sub-kasus kedua **sudah terpecahkan** oleh model ini. Yang menggantung hanya yang pertama.

---

## A7. Dampak migrasi

**Tidak ada migrasi produksi yang disentuh** — 0287–0297 masih untracked (HEAD di 0286),
jadi yang berikut ini adalah *menulis*, bukan *membatalkan*.

| tindakan | sasaran |
|---|---|
| **tulis ulang sebelum mendarat** | 0287–0297 (§11.4): seed 144, `unit`, tanpa `counter_site_id` |
| **kolom baru** | `ledger_account.custody`; `cash_document.owner_unit_id` + `interunit_reference_id` |
| **tabel baru** | `interunit_reference`, `cash_custody` |
| **dihapus** | `journal_line.counter_site_id`, `ledger_account.requires_counter_site`, `counterparty_site_id`, CHECK `counterparty_is_rare` |
| **CHECK ditulis ULANG UTUH** | `journal_entry_source_kind_check` (+`INTERUNIT_SETTLE` sebagai kind yang benar-benar dipakai) — pelajaran 0257: DROP+ADD yang di-append hilang saat dua lane merge |
| **dibongkar** | `petty_cash_replenishment` → tidak lagi memposting lintas unit; jadi BKK@HO + IUT, dan BKM unit yang memposting sisi tokonya |
| **dikurung** | `domain::interunit` auto-bridge — tetap ada, tapi tunduk custody guard |
| **DIBIARKAN** | `cash_in_transit`, `deposits.rs`, `store_deposit`, `remittance_order` — sampai A6 terjawab |
| kode | `PostingIntent` mendapat `owner_unit`; 25 pemanggil mengisinya (satu baris masing-masing) |

---

## A8. Rencana uji

| # | uji | harus |
|---|---|---|
| 1 | BKM total = BKK total pada IUT yang sama | `MATCHED` mustahil kalau beda |
| 2 | dokumen milik unit menulis baris Bank | **ditolak** oleh custody guard |
| 3 | dokumen milik HO menulis `Petty Cash @C001` / `Cash on Hand @C001` / `Modal Kasir @C001` | **ditolak** |
| 4 | BKM tanggalnya boleh beda dari BKK | lolos; afiliasi satu sisi di antaranya |
| 5 | BKM 400k terhadap BKK 500k tanpa baris Piutang Pegawai | **ditolak** — tidak ada pengakuan sebagian |
| 6 | Piutang Pegawai diposting sebelum IUT `RESOLVED` | **ditolak** |
| 7 | `PAYROLL_RUN` menyentuh `Saldo Affiliasi` | **ditolak** oleh `account_source_rule` |
| 8 | jumlah 3 akun afiliasi lintas 14 unit, saat semua IUT `MATCHED` | **= 0** |
| 9 | sisa afiliasi ≠ 0 | persis = jumlah IUT `UNMATCHED` |
| 10 | BKK/BKM + jurnal manual untuk kejadian yang sama | terdeteksi: `source_id` IUT sudah terpakai |
| 11 | alur persediaan otomatis | tak berubah, nol regresi |
| 12 | `MODAL KASIR` dari `SUPPLIER_INVOICE` atau jurnal tangan | **ditolak** (§16.1) |

---

## A9. Asumsi yang masih butuh jawaban akuntan

| # | pertanyaan | memblokir |
|---|---|---|
| 1 | **A6** — setoran toko ke rekening unit: siapa yang menjurnal, tanggal berapa, selisih jeda duduk di mana? | seluruh alur setoran; `cash_in_transit` tak bisa dicabut tanpa ini |
| 2 | Modal kasir yang **dikembalikan** unit ke HO — BKK unit + BKM HO, benar? | arah balik alur 4 |
| 3 | Kalau pegawai penanggung jawab **tidak mengakui** selisih, dan HO tidak mengkonfirmasi — IUT berhenti di `DISCREPANCY` selamanya, atau ada batas waktu? | mesin keadaan A5 |
| 4 | Adakah pendanaan HO→unit yang **bukan** kas (mis. HO membayar vendor langsung untuk toko)? Kalau ya, itu auto-bridge lama dan bukan BKK/BKM. | ruang lingkup IUT |

---

# BAGIAN III — "Unit tidak menjurnal", dan apa yang sudah bisa dikerjakan

**Putaran 6 · 19 September 2026.**

## B1. Prinsip yang menyatukan semuanya

Arahan pemilik: *"harusnya unit kalau bisa ga ngejurnal."* Itu **tidak bertabrakan** dengan
kalimat akuntan bahwa unit mengakui sisinya sendiri — keduanya benar sekaligus, kalau
dipisahkan dengan benar:

> **Unit mengakui lewat DOKUMEN. Mesin yang menulis JURNAL.**
> Tidak ada orang di unit yang pernah memilih akun, sisi debit, atau nominal jurnal.

Yang dilakukan admin unit hanyalah: membuka "Dana masuk", mengetik **berapa uang fisik yang
benar-benar diterima**, melampirkan foto, dan menekan **Terima**. Jurnalnya
(`Dr Petty Cash / Cr Saldo Affiliasi Pembiayaan`) ditulis aturan posting, bukan orang.

Ini ditegakkan tiga lapis yang **semuanya sudah ada mekanismenya**:

| lapis | bentuk |
|---|---|
| akun | `CASH ON HAND` · `PETTY CASH` · `MODAL KASIR` → `posting_mode = AUTO_ONLY`, `manual_je_policy = NO`. Tak ada manusia mana pun — termasuk Finance HO — yang bisa menjurnalnya dengan tangan. |
| dokumen | `account_source_rule` ALLOW: hanya `INTERUNIT_SETTLE` · `CASH_DOC` · `CASH_SHIFT` · `STORE_DEPOSIT` · `CASH_COUNT` · `OPENING` |
| unit | custody guard (A2.2) memeriksa **pemilik dokumen**, bukan siapa yang login |
| jurnal manual | Finance HO saja (§11.1) — dan itu pun tidak bisa menyentuh tiga akun kas di atas |

Jadi pertanyaan "bolehkah unit menjurnal" tidak pernah muncul: **tidak ada layar jurnal di
unit sama sekali.** Yang ada layar dokumen.

## B2. Dua jawaban terakhir dari pemilik

### Selisih antar-unit: tidak ada batas waktu

`DISCREPANCY` menggantung sampai diselesaikan; *"akhir bulan ketahuan."* Konsekuensi desain
— dan ini yang membuat "menggantung" aman:

> **IUT berstatus `UNMATCHED` atau `DISCREPANCY` jadi temuan di tutup buku bulanan.**

`period_close` sudah punya bentuknya: penghalang yang **disebutkan**, dan bulan yang ditutup
melewatinya **mencatat bahwa ia melewatinya** (0286). Jadi tidak ada state `EXPIRED`, tidak
ada batas waktu, tidak ada pekerjaan latar — cukup satu baris baru di daftar penghalang
tutup buku: *"3 pengiriman antar-unit belum diakui unit penerima, total Rp X."*

### Pendanaan HO → unit selalu masuk Petty Cash

*"pendanaan ho ke unit pasti masuk petty cash dan bisa dipakai buat bayar sesuai payment
instruction ho."* Tiga akibat:

1. **Tidak ada pendanaan HO→unit yang bukan kas.** Pertanyaan A9 #4 tertutup: HO tidak
   membayar vendor toko langsung; ia mendanai petty cash, lalu unit yang membayar.
2. `nature = FINANCING` pada IUT selalu berujung di `Petty Cash` — kecuali **Modal Kasir**,
   yang alurnya sendiri dan berujung di `MODAL KASIR` (§16.1). Dua tujuan, dua purpose,
   satu mekanisme.
3. **Pengeluaran unit dari petty cash diotorisasi `payment_instruction` HO** — dan tabel itu
   **sudah ada**, dengan sifat yang persis dibutuhkan: *"It does not post. There is no
   `post` in this file"* (`payment_instructions.rs:3`), meniru Payment Request ERPNext.
   Jadi rantainya: instruksi HO (tanpa jurnal) → BKK unit (dengan jurnal, ditulis mesin).

## B3. Ruang lingkup custody guard — sengaja sempit

Guard hanya berlaku pada akun ber-`custody`, yaitu **empat kelompok kas saja**:
Bank/Deposito (`HO`), dan Cash on Hand · Petty Cash · Modal Kasir (`UNIT`).

Persediaan, utang usaha, beban, aset **tidak** ber-custody. Karena itu:

- **auto-bridge tetap hidup dan tetap benar** untuk kejadian lintas-unit non-kas —
  terutama perpindahan barang HO/DC → toko, yang melahirkan afiliasi `GOODS`;
- perpindahan barang memang **sudah** punya pengakuan dua sisi secara alami: DC mengirim,
  toko menerima dengan memindai. Tidak ada yang perlu diubah di sana.

Satu kalimat: **guard ini tentang siapa yang boleh menyentuh UANG FISIK milik siapa, bukan
tentang lintas-unit secara umum.**

## B4. Alur layar

| layar | milik | yang dilakukan orang | yang ditulis mesin |
|---|---|---|---|
| **Pendanaan unit** | HO | pilih unit · nature · purpose (Petty Cash / Modal Kasir / Payroll) · jumlah · rekening asal · penanggung jawab pembawa | `interunit_reference` (IUT-…) + **BKK** @HO → `Dr Saldo Affiliasi / Cr Bank` |
| **Dana masuk** | unit | melihat IUT: dari HO, purpose, **jumlah yang diharapkan**, nomor BKK-nya. Tekan **Terima** · ketik jumlah fisik · foto | **BKM** @unit → `Dr Petty Cash / Cr Saldo Affiliasi` |
| — kalau jumlah fisik < diharapkan | unit | isi alasan · sebut penanggung jawab | IUT → `DISCREPANCY`. **Belum ada jurnal.** |
| **Konfirmasi selisih** | HO | konfirmasi ke ybs · tekan **Bebankan ke pegawai** | BKM terbit utuh: `Dr Petty Cash 400k` + `Dr Piutang Pegawai 100k` / `Cr Saldo Affiliasi 500k`; IUT → `RESOLVED` |
| **Serah-terima custody** | unit | kepala toko → admin, tekan **Diserahkan** | `cash_custody` berubah. **Nol jurnal.** |
| **Bayar dari petty cash** | unit | pilih `payment_instruction` HO · isi jumlah · foto bukti | **BKK** @unit → `Dr <akun instruksi> / Cr Petty Cash` |
| **Bayar gaji** | unit | pilih payroll run bulan itu · tekan Bayar | **BKK** @unit → `Dr Biaya Gaji YMHD / Cr Petty Cash` |
| **Rekonsiliasi antar-unit** | Finance HO | daftar IUT: `UNMATCHED` berumur, `DISCREPANCY` menunggu konfirmasi, saldo 3 akun afiliasi per unit dua sisi | baca saja |

Tidak satu pun layar unit meminta akun, debit, atau kredit.

## B5. Apa yang sudah bisa dikerjakan — dan apa yang masih tertahan

### Bisa mulai sekarang

1. seed bagan ±144 + `docs/fixtures/coa-144-v1.csv` (§11.4, §12.9)
2. `org_place` → `unit`; `journal_line.unit_id` (§12.3)
3. hapus `counter_site_id` · `requires_counter_site` · `counterparty_site_id` (§11.3)
4. `ledger_account.custody` + custody guard di `poster::post` (A2.1–A2.2)
5. `interunit_reference` + `cash_custody` (A2.3, A2.5)
6. `cash_document.owner_unit_id` + `interunit_reference_id`; larang satu dokumen dua unit (A2.4)
7. bongkar `petty_cash_replenishment` jadi BKK@HO + IUT + BKM@unit (A7)
8. `AUTO_ONLY`/`NO` + `account_source_rule` untuk tiga akun kas (B1)
9. akrual & pembayaran payroll (A3 baris 5–6) — sekaligus menutup satu dari empat lubang §1.4
10. penghalang tutup buku untuk IUT yang belum berpasangan (B2)
11. `report_line` effective-dated (§11.5) · ganti nama `LANDED_COST` → `PRICE_CORRECTION` (§10.3)

### Tertahan satu pertanyaan (A6)

**Setoran penjualan toko → rekening bank unit sendiri.** Sampai akuntan menjawab siapa yang
menjurnal dan pada tanggal berapa, yang berikut **tidak disentuh sama sekali**:
`cash_in_transit` · `deposits.rs` · `store_deposit` · `remittance_order` ·
`store_money::store_deposit_hand_over`.

Ini tidak memblokir sebelas item di atas. Ia hanya memblokir dirinya sendiri.

---

## B6. Koreksi dari akuntan (WA 13:49–13:51) — dua hal di Bagian III salah

| yang saya tulis | yang benar |
|---|---|
| §B2: "pengeluaran unit dari petty cash diotorisasi `payment_instruction` HO" | **Tidak ada payment instruction dari HO.** *"Pembayaran Gaji pegawai itu tanpa instruksi."* Unit membayar dari petty cash atas kewenangannya sendiri. |
| §A4/§B4: HO hanya meninjau pengeluaran di atas batas | **HO meninjau SEMUA pengeluaran petty cash**, bukan hanya yang melebihi batas. |

`payment_instruction` yang ADA di repo justru arah sebaliknya dan tetap terpakai:
*"A shop asking head office to pay something"* — itulah tugas unit #5 (minta HO membayar
kalau nilainya di atas batas petty cash `STORE_EXPENSE_MANAGER_LIMIT_MINOR` = Rp500.000).

### Enam tugas unit · lima pantauan HO

| unit | sudah ada |
|---|---|
| 1. catat pengeluaran dari petty cash | `store_expense` — **tapi persetujuannya harus jadi HO untuk semua nilai** |
| 2. terima & catat uang masuk dari HO (petty cash / modal kasir) | **baru** — BKM + IUT |
| 3. setor uang penjualan **dan modal kasir** | `store_deposit`, `remittance_order` — ⚠️ alur A6 |
| 4. bayar gaji dari petty cash | **baru** — BKK unit, tanpa instruksi |
| 5. minta HO membayar bila > Rp500.000 | `payment_instruction` ✔ |
| 6. lapor cash count mingguan | `cash_counts` — **cadensi mingguan belum ada** |

| HO | sudah ada |
|---|---|
| 1. review **semua** pengeluaran petty cash unit | `store_expense` ✔ (ubah ambangnya) |
| 2. pantau dana terkirim: sudah diterima & nominalnya sama | **baru** — papan IUT |
| 3. pantau setoran penjualan & modal kasir: sudah, tepat waktu, sesuai | `remittance_order` sebagian |
| 4. pantau pelaksanaan & bukti | lampiran BKK/BKM ✔ |
| 5. pantau cash count unit + selisih sistem vs fisik | `cash_counts` ✔ |

Tugas #3 unit menjawab pertanyaan lama A9 #2: **modal kasir dikembalikan lewat setoran**,
bukan lewat dokumen terpisah.

---

## B7. Seed terkunci **144** — dan tiga perilaku yang dicabut (19 September 2026, putaran 7)

Detail lengkap Group 1 & 2 ada di **`docs/finance-group-1-2.md`**. Yang mengubah rencana di
dokumen ini:

### Bagan

```
145 (putaran 4)
 −1  Hutang Supplier Barang Dagang - Suspend   ← tidak dipakai; utang lahir saat barang diterima
────
144  akun seed, semuanya AKTIF
```

Sebarannya: **29 otomatis · 43 mesin+koreksi · 72 jurnal manual**.
Daftar lengkap yang bisa difilter: `docs/finance-bagan-144.html`.
Katalog 55 proses bisnis dengan jurnal dan pemiliknya: `docs/finance-proses-bisnis.html`.

### Tiga perilaku yang berjalan hari ini dan harus DICABUT

| # | perilaku sekarang | jadi | berkas |
|---|---|---|---|
| 1 | penerimaan barang mengkredit `supplier_suspend`; faktur mendebitnya | penerimaan mengkredit `Hutang Suppliers Barang Dagangan`; faktur hanya menambah PPN, nomor, jatuh tempo | `payables_flow.rs:47·364·956`, `payables.rs:1339`, `ledger.rs:1161` |
| 2 | buka/tutup shift memposting, mendebit `cashier_float` | dokumen custody murni — **nol jurnal**; `MODAL KASIR` tak berubah | `store_money.rs:553·673` |
| 3 | hitung kas memposting selisih lewat `cash_variance`/`cash_shortage` | pencatat bukti — **nol jurnal**; selisih jadi daftar terbuka | `cash_counts.rs` |

Ketiganya **pencabutan**, bukan penambahan.

### A6 selesai — setoran toko akhirnya punya jalan

Jalan buntu §A6 ditutup oleh dua putusan: setoran unit lewat **`Saldo Affiliasi Atas Barang`**,
dan asumsi **"yang dinyatakan toko dianggap diterima bank"**.

```
unit:   Dr Saldo Affiliasi Atas Barang    Cr CASH ON HAND
HO:     Dr Bank - Giro                    Cr Saldo Affiliasi Atas Barang
```

Tanpa akun transit, tanpa satu entri yang menyeberangi dua custody, dan aturan wewenang
tetap utuh. `cash_in_transit` karena itu **dihapus** dari peta akun — bukan lagi ditahan.

### Yang masih menggantung

`N2` Hutang Lain-lain: afiliasi atau pihak luar? · `N3` proses Uang Muka Penjualan ·
`N4` voucher kedaluwarsa · `N5` mekanisme refund retur · `N6` dokumen penyelesaian selisih
hitung kas · `N7` persediaan & HPP kantong belanja. Tak satu pun memblokir Group 1 & 2.
