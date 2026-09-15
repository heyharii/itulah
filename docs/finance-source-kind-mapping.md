# `Source Document` → `source_kind`: 43 frasa, dan mana yang butuh keputusan

**Tanggal:** 16 September 2026. **Sumber kiri:** `COA 162 Config.Source Document`
di `Retail_OS_COA_v1_162_Merged_Master.xlsx` — 43 frasa berbeda menutupi 162
akun. **Sumber kanan:** 35 nilai `journal_entry.source_kind` yang CHECK izinkan
sesudah migrasi 0257.

**Diperbarui 16 Sep sore.** Tiga kind baru (0266: `PAYROLL_RUN`,
`TAX_SETTLEMENT`, `AMORTIZATION_RUN`) menyelesaikan 5 frasa / 38 akun. Keadaan
sekarang: **31 frasa / 141 akun jelas**, **12 frasa / 21 akun masih menunggu
keputusan**.

Dan satu temuan yang mengubah cara tabel ini dipakai — §"Mengapa ALLOW tidak
diseed" di bawah. Ringkasnya: kolom `Source Document` workbook **ilustratif, bukan
lengkap**, jadi menyeednya sebagai whitelist akan menolak posting yang sah.

35 nilai yang tersedia:

```
ACQ_SETTLEMENT  ADJUSTMENT  ADVANCE  ASSET_CAPITALIZATION  ASSET_DISPOSAL
ASSET_RESERVE   ASSET_TRANSFER  BANK_STATEMENT  CASH_COUNT  CASH_DOC
CASH_SHIFT      COGS_DAY    CREDIT_NOTE  DEPOSIT  DEPRECIATION  GIRO
GOODS_RECEIPT   INTERUNIT_SETTLE  LANDED_COST  MANUAL  OPENING  PAYMENT
PETTY_REPLENISH RECLASS     REMITTANCE  RETENDER  REVERSAL  SALE_DAY
STOCK_COUNT     STORE_DEPOSIT  STORE_EXPENSE  SUPPLIER_ADVANCE
SUPPLIER_INVOICE  TRANSFER  WRITE_OFF
```

"Approved Journal" di kolom kiri selalu berarti koreksi bertanda tangan (0129),
yaitu `RECLASS` · `ADJUSTMENT` · `WRITE_OFF` — bukan `MANUAL`. Itu perbedaan
yang `manual_je_policy = 'OVERRIDE'` ada untuk menariknya, jadi diperlakukan
konsisten di seluruh tabel.

---

## Jelas — 26 frasa, 118 akun

| akun | frasa workbook | `source_kind` |
|---:|---|---|
| 29 | Purchase Invoice / Expense Entry / Payment Entry | `SUPPLIER_INVOICE` `STORE_EXPENSE` `PAYMENT` |
| 16 | Bank Transaction / Payment Entry / Bank Statement | `BANK_STATEMENT` `PAYMENT` |
| 9 | Asset Addition / Capitalization Entry | `ASSET_CAPITALIZATION` |
| 7 | Depreciation Run | `DEPRECIATION` |
| 3 | Approved Journal / Payment Entry | `RECLASS` `ADJUSTMENT` `WRITE_OFF` `PAYMENT` |
| 3 | Interunit Funding / Transfer / Settlement | `INTERUNIT_SETTLE` `TRANSFER` `REMITTANCE` |
| 3 | POS Receipt / Settlement Batch | `SALE_DAY` `ACQ_SETTLEMENT` |
| 3 | Purchase Receipt / Purchase Invoice / Supplier Payment | `GOODS_RECEIPT` `SUPPLIER_INVOICE` `PAYMENT` |
| 2 | Cash Receipt / Cash Payment / Payment Entry | `CASH_DOC` `PAYMENT` |
| 2 | POS Receipt / Sales Invoice | `SALE_DAY` |
| 2 | Purchase Invoice / Payment Entry / Approved Journal | `SUPPLIER_INVOICE` `PAYMENT` + koreksi |
| 2 | SJD / Stock Transfer / Interunit Settlement | `TRANSFER` `INTERUNIT_SETTLE` |
| 2 | Shipment / Store Receipt / Stock Transfer | `TRANSFER` `GOODS_RECEIPT` |
| 2 | Stock Ledger / Stock Movement / Stock Count | `STOCK_COUNT` `COGS_DAY` `ADJUSTMENT` |
| 1 | Advance Payment / Purchase Order / Payment Entry | `SUPPLIER_ADVANCE` `PAYMENT` |
| 1 | Approved Journal / Source Document | koreksi |
| 1 | Asset Disposal / Reserve Entry | `ASSET_DISPOSAL` `ASSET_RESERVE` |
| 1 | Inventory Disposal / Approved Adjustment | `WRITE_OFF` `ADJUSTMENT` |
| 1 | POS Session Open/Close / Cash Transfer | `CASH_SHIFT` `TRANSFER` |
| 1 | Purchase Invoice / Supplier Credit / Rebate Settlement | `SUPPLIER_INVOICE` `CREDIT_NOTE` |
| 1 | Sales Order / POS Receipt / Payment Entry | `SALE_DAY` `PAYMENT` |
| 1 | Stock Count / Inventory Adjustment | `STOCK_COUNT` `ADJUSTMENT` |
| 6 | Purchase Invoice / Work Order / Payment Entry | `SUPPLIER_INVOICE` `PAYMENT` — "Work Order" tak punya padanan dan tak menambah apa pun di sini |
| 2 | Sales Invoice / AR Entry / Approved Journal | `SALE_DAY` + koreksi — "AR Entry" tak ada sebagai kind; piutang lahir dari hari dagang |
| 1 | Sales Return / Credit Note | `SALE_DAY` `CREDIT_NOTE` — retur ada di dalam hari dagang, bukan dokumen sendiri |
| 1 | Project Cost / Asset Capitalization | `ASSET_CAPITALIZATION` — "Project Cost" adalah referensi, bukan dokumen (lihat gate F) |

---

## Diselesaikan oleh tiga kind baru (0266) — 5 frasa, 38 akun

| akun | frasa workbook | `source_kind` |
|---:|---|---|
| 21 | Payroll Run / Payroll Adjustment | **`PAYROLL_RUN`** + `ADJUSTMENT` |
| 8 | Tax Return / Tax Payment / Tax Adjustment | **`TAX_SETTLEMENT`** `PAYMENT` `ADJUSTMENT` |
| 4 | Amortization Run | **`AMORTIZATION_RUN`** |
| 4 | Deposit Placement / Maturity / Bank Statement | `TRANSFER` `BANK_STATEMENT` — **bukan `DEPOSIT`**, yang sudah berarti setoran takings toko (0241) |
| 1 | Employee Receivable / Payroll Deduction / Payment Entry | **`PAYROLL_RUN`** `PAYMENT` |

---

## PUTUSAN sisa — 12 frasa, 21 akun

Tiap satu menunggu jawaban, dan sebabnya bukan ketidakjelasan bahasa melainkan
**mesinnya belum ada**. Menyeed salah satunya berarti menolak posting nyata
karena alasan yang tak seorang pun pilih.

| akun | frasa workbook | mengapa belum bisa dipetakan |
|---:|---|---|
| 4 | Loan Drawdown / Accrual Schedule / Repayment | `financing_facility` adalah Phase 6, dan bersyarat jawaban leasing. |
| 4 | Purchase Invoice / Prepaid Schedule | `SUPPLIER_INVOICE` jelas; `prepaid_schedule` adalah Phase 4A. |
| 3 | Source Document / Approved Journal | "Source Document" di kolom kiri adalah placeholder, bukan dokumen. Perlu diperjelas di workbook-nya. |
| 2 | Period Closing Entry / Supporting Schedule | Tutup buku kita **tidak memposting** — ia menyegel. ERPNext punya Period Closing Voucher yang memposting. Apakah kita mengadopsinya adalah keputusan yang belum diambil. |
| 1 | Advance Request / Expense Claim / Payment Entry | `ADVANCE` ada di kosakata tapi tabel advance non-PO adalah Phase 4C. |
| 1 | Allowance Entry / Period Close | Penyisihan piutang: tak ada mesin, dan tutup buku tak memposting. |
| 1 | Capital Injection / Approved Journal | Ekuitas: tak ada mesin. |
| 1 | Contractor Advance / Invoice / Payment Entry | Advance kontraktor = Phase 4C. |
| 1 | Lease Invoice / Lease Schedule / Payment Entry | Leasing: **pertanyaan terbuka pemilik** — apakah kontraknya masih hidup. |
| 1 | Owner Transaction / Approved Journal | `principal` adalah Phase 5. |
| 1 | Owner/Principal Transaction / Payment Entry / Approved Journal | idem. |
| 1 | Purchase Invoice / Pre Opening Capitalization / Schedule | Pre Opening tak punya akun di chart kita dan tak punya mesin. |

---

## Mengapa ALLOW tidak diseed — dan ini bukan kehati-hatian, ini terukur

Kolom `Source Document` workbook **ilustratif, bukan lengkap**. Diperiksa terhadap
kode yang benar-benar memposting:

`1101001 CASH ON HAND` → akun kita `1011001001`. Frasanya
*"Cash Receipt / Cash Payment / Payment Entry"* = **2 kind** (`CASH_DOC`,
`PAYMENT`). Yang sebenarnya memposting arti `cash` di kode kita, dari modulnya
masing-masing:

```
SALE_DAY        sale_day.rs        hari dagang mendebit kas
CASH_COUNT      cash_counts.rs     hitung laci
CASH_SHIFT      store_money.rs     shift kasir
STORE_DEPOSIT   store_money.rs     setoran ke bank
STORE_EXPENSE   store_money.rs     belanja toko
PETTY_REPLENISH store_money.rs     isi ulang kas kecil
ADVANCE         store_money.rs
RECLASS         store_money.rs
DEPOSIT         deposits.rs
CASH_DOC        cash.rs
SUPPLIER_INVOICE payables.rs
PAYMENT         payments.rs
```

Dua belas, bukan dua. Menyeed frasa itu sebagai allow-list **akan menolak setiap
hari dagang dan setiap hitung laci** — dan aturan tabelnya adalah "sehimpunan
ALLOW berarti ini saja".

Jadi tabel ini adalah **dokumentasi dan bahan DENY**, bukan sumber seed ALLOW.
Yang diseed hanya di mana daftarnya memang lengkap **karena diputuskan begitu**:

| akun | aturan | dari |
|---|---|---|
| `1021607001` Reserve Replacement OE | `ASSET_RESERVE` **DENY** | putusan pemilik: pembentukan tertunda, penarikan disetujui |
| `1011302003` Prepaid PPh 29 | `OPENING` **ALLOW** | 0267, migration-only |
| `7010216002` Amortisasi Pre Opening | `AMORTIZATION_RUN` + `OPENING` **ALLOW** | 0267, dari jadwalnya |

Untuk akun lain, ALLOW yang aman butuh satu hal yang belum ada: **daftar
source_kind yang sebenarnya menyentuh tiap akun**, diturunkan dari kode atau
diukur dari jurnal nyata — bukan dari frasa workbook. Itu pekerjaan yang bisa
dilakukan (arti → akun lewat `account_map`, arti → modul lewat grep, modul →
kind) dan bukan Phase 1B.

## Cara memakai tabel ini nanti

Kalau daftar sebenarnya sudah ada, satu `INSERT` per (akun, kind):

```sql
INSERT INTO account_source_rule (account_code, source_kind, effect, set_by, note)
VALUES ('<akun>', '<KIND>', 'ALLOW', '<siapa>', '<frasa workbook-nya>');
```

Ingat aturan tabelnya: **akun tanpa baris berarti tak dibatasi.** Jadi menyeed
26 frasa Jelas mengikat akun-akunnya dan membiarkan sisanya apa adanya — tak ada
langkah "semua atau tak ada".

Dan satu peringatan yang bukan teori: seed harus memasukkan **setiap** kind yang
sah untuk akun itu sekaligus. Menyisipkan `SUPPLIER_INVOICE` lebih dulu lalu
`PAYMENT` menyusul berarti di antara dua statement itu setiap pembayaran ke akun
tersebut ditolak.

---

## Usulan kosakata untuk 17 frasa yang menunggu keputusan

Diperiksa satu per satu terhadap 35 nilai yang ada. Aturannya: **pakai ulang
kalau semantiknya benar-benar cocok, jangan bikin sinonim.**

### Ditambahkan sekarang — 2 kind

| kind | mengapa tak ada padanannya | menutup |
|---|---|---|
| `PAYROLL_RUN` | Tak ada. `PAYMENT` adalah pencairannya, bukan pengakuan bebannya — beban gaji masuk buku sebelum uangnya keluar. Modul payroll (0231, 0250–0251) sudah menghitung slipnya dan tak punya kata untuk membukukannya. | **21 akun**, kelompok terbesar dalam tabel ini |
| `TAX_SETTLEMENT` | Tak ada. `PAYMENT` bisa membayar pajak tapi tak bisa menyatakan pergerakan kewajiban/kredit **per masa pajak**, yang justru inti `tax_period` (Phase 4B). | 8 akun |

### Ditambahkan bersama modulnya, bukan sekarang — 3 kind

| kind | menunggu |
|---|---|
| `PREPAID_RECOGNITION` | `prepaid_schedule`, Phase 4A. Pengakuan bulanan `Dr Beban / Cr Prepaid` tak punya padanan. |
| `FINANCING_DRAW` | `financing_facility`, Phase 6 — **bersyarat jawaban leasing**. Penarikan pinjaman bukan `PAYMENT`. |
| `FINANCING_PAYMENT` | idem. Angsuran memisah pokok dan bunga; `PAYMENT` tak membawa pemisahan itu. |

### Pakai ulang — JANGAN tambahkan, itu sinonim

| yang diusulkan | pakai | alasan |
|---|---|---|
| `DEPRECIATION_RUN` | **`DEPRECIATION`** | Kata yang sama. Kindnya sudah ada dan `asset_depreciation_run` yang menulisnya. |
| `PAYROLL_ADJUSTMENT` | **`ADJUSTMENT`** | `ADJUSTMENT` sudah berarti "koreksi atas sebuah angka", dan `source_id` sudah menyebut run-nya. Kind kedua hanya menambah kata. |
| `TAX_ADJUSTMENT` | **`ADJUSTMENT`** | idem. |

### Dua yang harus **kamu** putuskan

**1. `AMORTIZATION_RUN` — pakai ulang `DEPRECIATION`, atau pisah?**

Mesinnya satu (`asset_depreciation_run`), dan `CHARGE_KEYS` sudah memisah
`DEPRECIATION` / `AMORTISATION` / `REPLACEMENT_RESERVE` di tingkat akun. Jadi
dokumennya sama dan akunnya beda — yang berarti pakai ulang itu benar…
**kecuali** kamu ingin allow-list bisa mengizinkan amortisasi pada aset tak
berwujud sambil menolak depresiasi di sana. Dengan satu kind, keduanya tak bisa
dibedakan aturan sumber. Empat akun bergantung padanya.

Saran saya: **pakai ulang `DEPRECIATION`**, karena dokumennya memang satu, dan
tambahkan kind terpisah hanya kalau ada aturan sumber yang benar-benar perlu
membedakannya.

**2. Time deposit — dan satu jebakan nama.**

`TIME_DEPOSIT_PLACEMENT`/`TIME_DEPOSIT_MATURITY` tak punya padanan. Tapi
perhatikan: **kita sudah punya `DEPOSIT`, dan artinya setoran takings toko ke
bank** (0241), bukan deposito berjangka. Memakai `DEPOSIT` untuk deposito
berjangka akan menabrak arti yang sudah berjalan — itu jenis tabrakan yang paling
sulit dilihat nanti.

Penempatan deposito adalah perpindahan kas antar rekening kita sendiri, yang
`TRANSFER` sudah tepat gambarkan; jatuh temponya perpindahan balik plus bunga.
Saran saya: **pakai ulang `TRANSFER`** dan biarkan `source_id` menyebut
penempatannya, kecuali rekonsiliasi deposito perlu memisahkannya di aturan sumber
— maka **satu** kind `TIME_DEPOSIT` (bukan dua) sudah cukup. Empat akun, ketiganya
berstatus `Bersyarat`.

### Ringkas perubahan enum yang diusulkan

```
sekarang (Phase 1B)      + PAYROLL_RUN
                         + TAX_SETTLEMENT
bersama modulnya         + PREPAID_RECOGNITION      (Phase 4A)
                         + FINANCING_DRAW           (Phase 6, bersyarat)
                         + FINANCING_PAYMENT        (Phase 6, bersyarat)
menunggu keputusanmu     ? AMORTIZATION_RUN         (saran: pakai DEPRECIATION)
                         ? TIME_DEPOSIT             (saran: pakai TRANSFER)
tidak ditambahkan        — DEPRECIATION_RUN, PAYROLL_ADJUSTMENT, TAX_ADJUSTMENT
```

Menambah kind berarti satu migrasi yang **menyatakan ulang seluruh daftar**
`journal_entry_source_kind_check` — cara 0107 dan 0242 dulu berselisih (lihat
0257). Jadi kedua kind di atas sebaiknya mendarat dalam **satu** migrasi, bukan
dua, dan sesudah kamu menjawab dua pertanyaan di atas supaya daftarnya ditulis
sekali.
