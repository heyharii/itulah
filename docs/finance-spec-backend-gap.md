# Spesifikasi prototipe Finance vs backend yang ada — audit kecocokan

**Tanggal:** 20 September 2026 · **Diperiksa terhadap:** skema `itulah_dev` (head migrasi 0276),
`backend/src/cloud`, 70 rute `/api/v1/finance`.
Setiap klaim menyebut tabel, constraint, atau berkas.

---

## 0. Ringkasan

| | |
|---|---|
| **Cocok kuat** | 13 hal — sebagian **lebih ketat** dari yang diminta spesifikasi |
| **Tidak cocok** | 9 hal — satu di antaranya mengubah seluruh model kontrol |
| **Tidak ada sama sekali** | 5 subledger + 1 modul penuh (Budget & Forecasting) |
| **Sengaja berbeda** | 4 hal yang sudah kita putuskan lain, dan tidak boleh diikuti |

**Temuan terbesar:** pembedaan pusat spesifikasi — *`In Payment` ≠ `Paid`* dan
*`Executed` ≠ `Settled`* — **tidak ada di backend.** Begitu pembayaran `POSTED`, uangnya
dianggap sudah keluar. Tidak ada keadaan "saya sudah transfer lewat internet banking,
bank belum mengkonfirmasi" — padahal justru itu keadaan yang paling sering nyata, dan
justru kontrol yang spesifikasi ini ada untuk menegakkannya.

---

## 1. Model status — inti perbedaannya

| objek | spesifikasi | backend hari ini | |
|---|---|---|---|
| **Bill** | Draft · Pending Approval · Open · Partially Paid · **In Payment** · Paid · Overdue · Disputed · Cancelled | `supplier_invoice_status_check`: **DRAFT · MATCHED · POSTED · REJECTED · VOID** | ❌ |
| **Payment** | Draft · Pending Approval · Approved · Executed/Recorded · **Awaiting Settlement** · Partially Settled · Settled · Failed · Cancelled | `supplier_payment_status_check`: **DRAFT · POSTED · REVERSED** | ❌ |
| **Receipt** | Draft · Recorded · Awaiting Settlement · Partially Settled · Settled · Cancelled | tidak ada objek Receipt; padanannya `cash_document` kind `RECEIVE`, status DRAFT · APPROVED · POSTED · REVERSED | ⚠ |
| **Bank Transaction** | Unmatched · Suggested · Partially Matched · Matched · Ignored | `bank_statement_line` **tidak punya kolom status**; kecocokan hidup di tabel lain | ⚠ |
| **Payment Run** | Draft · Prepared · Pending Approval · Approved · Executed · Cancelled | `payment_batch_status_check`: DRAFT · READY · PARTIAL · EXECUTED · HELD · CANCELLED | ✅ setara |
| **Period** | Open · Closing · Closed · Reopened | `fiscal_period`: OPEN · **SOFT_CLOSED** · CLOSED, + `closed_over_reason`, `closed_over_blockers` | ✅ **lebih kaya** |

Dua akibat yang harus disadari:

1. **Status pelunasan tagihan bukan kolom, melainkan turunan.** `POSTED` pada
   `supplier_invoice` berarti "utangnya sudah diakui di buku", bukan "sudah lunas".
   Berapa yang sudah dibayar dihitung dari `supplier_payment_allocation`.
   Spesifikasi menganggapnya kolom status dengan sembilan nilai.
2. **Tidak ada tempat menaruh "uang sudah saya kirim, bank belum bilang apa-apa".**
   Menambahkannya berarti memecah `POSTED` jadi minimal dua keadaan di dua tabel.

---

## 2. Yang COCOK — dan empat di antaranya lebih ketat dari yang diminta

| # | spesifikasi | bukti di backend |
|---|---|---|
| 1 | Satu objek kanonik, banyak pandangan (§3) | `poster::post` satu-satunya penulis jurnal; nol `INSERT INTO journal_entry` di luarnya |
| 2 | BKK/BKM bukan objek terduplikasi (§31) | satu `cash_document`; `CashDirection::Out → "KK"`, `In → "KM"`, nomor `KK-26-09-00001` |
| 3 | Transfer internal tanpa Party (§4) | `cash_document` kind `TRANSFER`; `party_kind` default `OTHER`, tidak wajib |
| 4 | Tidak ada Bank Instruction / API bank (§31) | nol objek semacam itu di seluruh skema |
| 5 | **Posted tidak pernah dihapus** (§6) | **nol rute DELETE** di 70 rute `/api/v1/finance` — lebih kuat dari yang diminta |
| 6 | Pembalikan menyimpan rujukan asli (§6) | `journal_entry.reversal_of` UNIQUE REFERENCES `journal_entry` |
| 7 | Periode tertutup memblokir posting (§6) | `assert_period_open` + `fiscal_period`, plus pencatatan penghalang yang dilewati |
| 8 | Payment Run opsional & non-posting (§12) | `payment_batch` tidak punya `journal_entry_id` |
| 9 | Payment Request tidak wajib per Bill (§31) | `payment_instruction` ada dan **tidak memposting** — komentarnya sendiri: *"It does not post. There is no `post` in this file"* |
| 10 | Payment reconciliation = alokasi (§12) | `supplier_payment_allocation(payment_id, invoice_id, amount_minor)` |
| 11 | Prepaid + jadwal (§14) | `prepaid_schedule` + `prepaid_allocation` |
| 12 | Acquirer/EDC/QRIS (§13) | `acquirer_settlement` + `_line` + `_exception` + `_report`; status DRAFT · CURATED · MATCHED · EXCEPTION |
| 13 | Adjustments terkendali (§14) | 8 rute `corrections` — jalur koreksi bertanda tangan yang paling matang di estate ini |

---

## 3. Yang TIDAK COCOK

### 3.1 Tidak ada Party kanonik (§5) — **perbedaan struktural terbesar kedua**

Lima master terpisah, nol yang menghubungkan:

```
supplier              17 kolom
company_bank_account  23 kolom
principal             10 kolom
bank                   8 kolom
employee               7 kolom
member                 5 kolom
acquirer              TIDAK ADA MASTER — hanya qualifier pada settlement
```

Jadi "BCA = Bank + Acquirer + Lender" hari ini adalah **tiga catatan di tiga tempat**,
dan tak satu pun tahu tentang yang lain. Acquirer bahkan bukan baris master.

### 3.2 Rekonsiliasi bank mencocokkan ke JURNAL, bukan ke Payment

```sql
bank_line_match(line_id, journal_line_id, decided_by_kind, score, reasons, allocated_minor)
```

Spesifikasi (§10, §FLOW G) mengandaikan mutasi bank ↔ Payment/Receipt. Backend
mencocokkan mutasi ↔ **baris jurnal yang sudah terlanjur ada**.

Akibatnya: **alur bank-first tidak punya jalur di backend.** "Mutasi tak dikenal → buat
Payment → alokasikan ke tagihan → cocokkan" — Payment-nya tidak bisa lahir dari layar
rekonsiliasi, karena yang dicocokkan bukan Payment.

### 3.3 Mutasi bank tidak punya status

`bank_statement_line` tak punya kolom status. Unmatched/Matched diturunkan dari
ada-tidaknya baris di `bank_line_match`. Tidak ada `Suggested`, tidak ada
`Partially Matched`, dan **tidak ada "Ignored dengan alasan"** — padahal mutasi yang
sengaja diabaikan adalah kasus harian.

### 3.4 Lima subledger tidak ada sama sekali

| diminta | ada? |
|---|---|
| Expense Claims (§11) | ❌ |
| Recurring Bills (§11) | ❌ |
| Deferred Revenue (§14) | ❌ |
| Accruals sebagai objek berjadwal (§14) | ❌ — hanya akun `2301`…`2304` |
| Recurring Entries (§14) | ❌ |
| **Budget & Forecasting (§15) — modul penuh** | ❌ nol tabel |

### 3.5 Audit trail bukan before/after

```
audit_log(at, username, role, method, path, status, subject_kind, subject_id, payload)
```

Ini log panggilan HTTP: menjawab *"siapa memanggil apa"*. Spesifikasi §14 minta
*"before/after"* — menjawab *"berubah dari X jadi Y"*. Untuk audit perubahan nilai,
yang ada belum cukup.

### 3.6 Tidak ada daftar Payment Exceptions

§12 minta daftar tersendiri: duplikat, rekening pihak hilang, nilai tak cocok, transfer
gagal, mutasi tak ditemukan, pembayaran dikembalikan. Yang ada hanya
`acquirer_settlement_exception`, khusus acquirer.

### 3.7 `store_deposit` masih memakai cash-in-transit

```
status: IN_TRANSIT · LANDED
sent_entry_id + landed_entry_id      dua jurnal, dua tanggal
```

Ini **bertabrakan dengan putusan L11** 19 September (setoran yang dinyatakan toko
dianggap diterima; tanpa akun transit). Spesifikasi ini pun tidak menyebut cash-in-transit.
Jadi tabel ini harus disederhanakan sebelum apa pun dibangun di atasnya.

### 3.8 Tidak ada objek Receipt tersendiri

§13 memperlakukan Receipt sebagai objek kanonik uang-masuk dengan siklus statusnya
sendiri. Backend memakai `cash_document` kind `RECEIVE` — yang **secara desain benar**
(satu objek, dua arah) tetapi tidak punya keadaan `Awaiting Settlement` /
`Partially Settled`.

### 3.9 Affiliate balances: bentuk berbeda

§18 minta Due From / Due To sebagai dua daftar dengan Party Role = Affiliate.
Backend memakai `interunit` dengan dua akun HO-sentris. Kita sudah memutuskan bentuk
ketiga — **satu akun bertanda per nature + dimensi unit** — jadi ini *sengaja berbeda*,
bukan kekurangan. Lihat §4.

---

## 4. Yang spesifikasi minta tetapi SUDAH kita putuskan berbeda

Empat hal. Jangan diikuti, dan alasannya bukan selera.

| spesifikasi | putusan kita | sumber |
|---|---|---|
| `STORE → Cash → Transfer between allowed cash accounts` | **Dilarang.** Tiga pot tiga tujuan; kalau kurang, jalurnya pendanaan HO | L10, dari akuntan klien |
| `STORE → Payment Instructions` = instruksi HO ke toko | **Tidak ada.** Akuntan: *"Tidak ada payment instruksi dari HO."* `payment_instruction` di repo justru arah sebaliknya — toko minta HO membayar | WA 19 Sep 13:49 |
| `Cash Count → Create variance adjustment` | Hitung kas **nol jurnal**; selisih jadi keputusan terpisah yang disetujui | L9 |
| Cash-in-transit implisit di alur setoran | **Dihapus.** Setoran yang dinyatakan toko dianggap diterima | L11 |

Ditambah satu yang spesifikasi langgar sendiri: *"Do NOT create an `Overview` sidebar item"*
— lalu memasang Overview lima kali (Inventory, Payroll, Assets, Tax, Financing).

---

## 5. Kecocokan per modul spesifikasi

| § | modul | backend | catatan |
|---|---|---|---|
| 9 | STORE | 🟡 sebagian | sale-days · cash-counts · deposits · store_expense · payment_instructions ada; tidak ada API "workspace toko" |
| 10 | CASH & BANK | 🟡 sebagian | bank-accounts · bank-statements · bank-lines · statement-intake ✓; Transfer tanpa siklus status; mutasi tanpa status |
| 11 | EXPENSES & BILLS | 🟡 sebagian | bills ✓ · payables-aging ✓ · unbilled ✓; expense claims ✗ · recurring ✗ |
| 12 | PAYMENTS | 🟡 sebagian | payments ✓ · batch ✓ · instruction ✓ · alokasi ✓; exceptions ✗ · status tipis |
| 13 | RECEIVABLES | 🟡 sebagian | acquirer ✓ · advance pegawai ✓; customer ✗ · AR aging ✗ |
| 14 | ACCOUNTING | 🟢 kuat | journal · corrections(8) · prepaid · trial-balance · statement · accounts · account-map · periods ✓; recurring ✗ · audit before/after ✗ |
| 15 | BUDGET | 🔴 nol | nol tabel |
| 16 | INVENTORY | 🟢 kuat | `stock_ledger_valuation`, BDP, adjustments |
| 17 | PAYROLL | 🔴 nol | tak ada akrual payroll yang memposting |
| 18 | AFFILIATE | 🟡 sebagian | interunit baca-saja; tak ada objek settlement |
| 19 | ASSETS | 🟢 kuat | 6 rute assets + 2 depreciation + reserves |
| 20 | TAX | 🟢 ada | `tax.rs` + `TAX_SETTLEMENT` |
| 21 | FINANCING | 🟡 sebagian | `financing.rs` + `principal.rs` ada, layar belum |
| 22 | REPORTS | 🟢 kuat | statement · trial-balance · balances |

---

## 6. Kalau spesifikasi ini mau dijadikan kontrak backend

Empat pekerjaan, berurutan menurut yang memblokir paling banyak:

1. **Pecah status Bill dan Payment.** Tambah keadaan antara `POSTED` dan lunas:
   pembayaran yang dicatat tapi belum dikonfirmasi bank. Ini menyentuh
   `supplier_invoice`, `supplier_payment`, `cash_document`, dan tiap layar yang
   menampilkan statusnya. **Tanpa ini, FLOW A dan FLOW G tidak bisa dibangun jujur.**
2. **Cocokkan mutasi bank ke DOKUMEN, bukan ke baris jurnal.** Tambah
   `bank_line_match.document_kind/document_id` di samping `journal_line_id`. Ini yang
   membuka alur bank-first.
3. **Party kanonik**, atau setidaknya satu tabel `party_role` yang menautkan lima master
   yang sudah ada. Tanpa ini "BCA sebagai bank sekaligus acquirer" tidak bisa dinyatakan.
4. **Status pada mutasi bank**, termasuk `IGNORED` beralasan.

Yang **tidak** saya sarankan dikerjakan sekarang: Budget & Forecasting (§15), Recurring
Bills, Deferred Revenue. Ketiganya modul penuh, nol data, dan tidak memblokir satu pun
dari sepuluh skenario demonstrasi.
