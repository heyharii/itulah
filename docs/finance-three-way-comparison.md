# Tiga sisi: spesifikasi prototipe · ERPNext · backend kita

**Tanggal:** 20 September 2026 · **Sumber ERPNext:** klon lokal `~/Documents/reference-erp/erpnext`
(`0849f187e7`) — doctype JSON dan workspace, bukan dokumentasi web.
**Sumber kita:** skema `itulah_dev` (head 0276) dan `backend/src/cloud`.

---

## 0. Papan skor

| area | spesifikasi | ERPNext | kita | **terbaik** |
|---|---|---|---|---|
| Status tagihan | kolom 9 nilai | 10 nilai, **dihitung** dari alokasi | 5 nilai, pelunasan dihitung | **ERPNext ≈ kita** |
| *Executed* ≠ *Settled* | status baru | **`clearance_date`** | tidak ada | **ERPNext** |
| Status mutasi bank | 5 nilai | 5 nilai | **tidak ada kolom** | ERPNext ≈ spesifikasi |
| Pencocokan bank | ke Payment | ke **dokumen** + jenis rekonsiliasi | ke **baris jurnal** | **ERPNext** |
| Model Party | satu tabel + peran | master terpisah + **dynamic link** | master terpisah, tanpa penyatu | **ERPNext + satu ide spesifikasi** |
| Budget | daftar field | **aksi saat terlampaui** | nol | **ERPNext** (kalau dibangun) |
| Satu pintu jurnal | tidak dibahas | 10 composer + ledger kedua | **satu pintu** | **kita** |
| Tutup buku | 4 status | Accounting Period + PCV | **SOFT_CLOSED + penghalang tercatat** | **kita** |
| Hapus catatan terposting | dilarang | cancel + amend | **nol rute DELETE** | **kita** |
| Custody tanpa jurnal | tidak dibahas | Asset Movement | store_deposit + rencana custody | seri |

**Kita menang 3, ERPNext menang 4, spesifikasi menang 0 secara utuh** — tetapi spesifikasi
menyumbang satu ide yang keduanya tidak punya (§3) dan kosakata nama yang lebih jelas.

---

## 1. Temuan yang membalik kesimpulan audit kemarin

Audit kemarin menulis: *"`In Payment ≠ Paid` dan `Executed ≠ Settled` tidak ada di backend."*
Benar. Tetapi ternyata:

```
Purchase Invoice.status   Draft · Return · Debit Note Issued · Submitted ·
                          Paid · Partly Paid · Unpaid · Overdue · Cancelled · Internal Transfer
Payment Entry.status      Draft · Submitted · Cancelled          ← TIGA
```

**Payment Entry ERPNext hanya punya tiga status — sama tipisnya dengan kita.** Jadi
"Awaiting Settlement" bukan kita ketinggalan dari ERPNext; **spesifikasi ini ada di depan
keduanya.**

Yang ERPNext lakukan sebagai gantinya jauh lebih murah:

```
Payment Entry.clearance_date        NULL  = sudah dieksekusi, belum cair
                                    terisi = benar-benar cair di bank
```

Laporan `Bank Reconciliation Statement` menyusun jembatannya dari field itu.
**Dan kita sudah membuang `clearance` pada putusan Banking 13 September.**

### → Rekomendasi 1: pakai tanggal, bukan status keempat

```sql
ALTER TABLE supplier_payment ADD COLUMN cleared_on date;
ALTER TABLE cash_document    ADD COLUMN cleared_on date;
```

Keadaan yang spesifikasi sebut *Awaiting Settlement* lalu menjadi **turunan**:
`posted_at IS NOT NULL AND cleared_on IS NULL`. *Settled* = `cleared_on IS NOT NULL`.

Kenapa ini lebih baik daripada menambah status:

- satu kolom nullable, bukan empat nilai baru di tiga tabel yang harus dijaga sepakat;
- langsung memberi laporan jembatan bank (*saldo GL + yang belum cair = saldo koran*);
- tidak ada keadaan mustahil — status dan tanggal tidak bisa berselisih kalau statusnya
  memang diturunkan dari tanggalnya.

## 2. Status tagihan: ERPNext dan kita sudah sejalan, spesifikasi yang berbeda

ERPNext punya sepuluh nilai status di Purchase Invoice, tetapi **tidak seorang pun
mengetiknya** — `set_status()` menghitungnya dari alokasi pembayaran dan tanggal jatuh
tempo. Kita melakukan hal yang sama: pelunasan dihitung dari
`supplier_payment_allocation`, status dokumen hanya `DRAFT · MATCHED · POSTED · REJECTED · VOID`.

Spesifikasi menganggapnya kolom yang disimpan.

### → Rekomendasi 2: hitung, jangan simpan — tapi pakai nama yang spesifikasi pakai

Tambahkan **kolom turunan** (view atau generated), bukan kolom yang ditulis:

```
Unpaid · Partly Paid · In Payment · Paid · Overdue · Disputed
```

`In Payment` = ada pembayaran `POSTED` dengan `cleared_on IS NULL` yang menunjuk tagihan ini.
Itulah satu-satunya nilai yang butuh Rekomendasi 1 lebih dulu. Sisanya sudah bisa dihitung
hari ini.

## 3. Party: ERPNext tidak punya Party kanonik — dan itu disengaja

```
GL Entry / Payment Entry:
   party_type   Link ke DocType        ← "Supplier" · "Customer" · "Employee" · "Shareholder"
   party        Dynamic Link           ← barisnya di master itu
```

Master tetap terpisah. Yang menyatukan adalah **sepasang kolom polimorfik**, bukan satu
tabel Party.

| | bentuk | biaya | peran ganda |
|---|---|---|---|
| spesifikasi | satu tabel Party + tabel peran | melebur 5 master yang kolomnya khas (`supplier` 17, `company_bank_account` 23, `principal` 10) | ✅ |
| **ERPNext** | master terpisah + `party_type`/`party` | satu pasang kolom | ❌ satu baris satu doctype |
| kita | master terpisah, **tanpa penyatu** | — | ❌ |

### → Rekomendasi 3: ambil bentuk ERPNext, plus satu ide spesifikasi

1. Generalisasi `journal_line.supplier_id` yang **sudah ada** menjadi
   `party_kind` + `party_id`. Satu perubahan, dan seluruh estate langsung bisa menyebut
   "pihak" secara seragam.
2. Tambah tabel kecil **`party_role(party_kind, party_id, role)`** di atas master yang
   sudah ada — bukan meleburnya.

Dengan dua langkah itu, "BCA = Bank + Acquirer + Lender" bisa dinyatakan — hal yang
ERPNext sendiri **tidak bisa** — tanpa memindahkan satu baris master pun.

## 4. Rekonsiliasi bank: ERPNext jelas lebih benar

```
Bank Transaction Payments (tabel anak):
   payment_document      Link ke DocType         ← Payment Entry · Journal Entry · …
   payment_entry         Dynamic Link
   allocated_amount      Currency
   clearance_date        Date
   reconciliation_type   Matched | Voucher Created      ← detail yang bagus
```

ERPNext mencocokkan mutasi bank ke **dokumen**. Kita mencocokkannya ke
`bank_line_match.journal_line_id` — ke **baris jurnal**. Akibatnya alur bank-first
(mutasi tak dikenal → buat Payment → alokasikan → cocokkan) tidak punya jalur di backend.

Dan `reconciliation_type = "Voucher Created"` merekam sesuatu yang berharga: dokumen itu
**lahir dari** mutasi bank, bukan dicocokkan dengannya. Saat audit, itu perbedaan yang nyata.

### → Rekomendasi 4: tambah, jangan ganti

```sql
ALTER TABLE bank_line_match
  ADD COLUMN document_kind text,           -- PAYMENT · CASH_DOC · RECEIPT · …
  ADD COLUMN document_id   text,
  ADD COLUMN origin text CHECK (origin IN ('MATCHED','CREATED_FROM_LINE'));
```

`journal_line_id` tetap — pencocokan ke jurnal punya nilainya sendiri untuk rekonsiliasi GL.
Yang ditambahkan adalah lapisan dokumen di atasnya.

Sekalian: `bank_statement_line` diberi kolom status
(`UNMATCHED · SUGGESTED · PARTIALLY_MATCHED · MATCHED · IGNORED`) dengan
**alasan wajib untuk `IGNORED`** — mutasi yang sengaja diabaikan adalah kasus harian, dan
hari ini tidak punya tempat.

## 5. Budget: bentuk ERPNext jauh lebih berguna

`Budget` bukan sekadar angka per akun per periode. Ia membawa **aksi saat terlampaui**,
terpisah untuk tiap pintu belanja:

```
applicable_on_material_request        → Stop | Warn | Ignore
applicable_on_purchase_order          → Stop | Warn | Ignore
applicable_on_booking_actual_expenses → Stop | Warn | Ignore
applicable_on_cumulative_expense      → Stop | Warn | Ignore
```

Itu mengubah anggaran dari laporan jadi **kontrol**. Spesifikasi hanya meminta
"Budget vs Actual" sebagai pandangan analitis.

### → Rekomendasi 5: kalau kelak dibangun, tiru bentuk ini. Tapi jangan sekarang.

Nol data, nol proses yang memintanya, dan tidak memblokir satu pun dari sepuluh skenario.

## 6. Tiga tempat kita lebih baik — dan tidak boleh dilepas

1. **Satu pintu jurnal.** ERPNext memanggil `make_gl_entries` dari sepuluh composer dan
   menyinkronkan `Payment Ledger Entry` terpisah, sampai butuh dua laporan khusus untuk
   mencari selisihnya. Kita punya `poster::post` dan nol `INSERT INTO journal_entry` di
   luarnya. **Setiap cek yang ditaruh di situ tak bisa dilewati siapa pun.**
2. **Tutup buku yang mencatat apa yang dilewatinya.** `fiscal_period` punya `SOFT_CLOSED`,
   `closed_over_reason`, `closed_over_blockers`. ERPNext hanya membekukan.
3. **Nol rute DELETE.** Larangan menghapus catatan terposting bukan aturan yang ditegakkan
   layar — endpointnya memang tidak ada. (Efek sampingnya jujur: "Delete Draft" yang
   spesifikasi minta juga tidak mungkin, dan itu harus ditambahkan secara sengaja kalau
   memang dibutuhkan.)

---

## 7. Menu ERPNext — dan empat hal yang layak kita ambil

Akuntansi ERPNext terbagi **empat workspace**:

```
Accounting            onboarding + ringkasan       (0 link — workspace-nya sendiri ringkasannya)
Invoicing             54 link / 9 kartu            hampir semuanya master & setelan
Payments              shortcut saja
Financial Reports     23 link / 4 kartu
```

**Financial Reports** — 4 kartu, dikelompokkan menurut *pertanyaan*, bukan menurut objek:

```
Financial Statements  Trial Balance · P&L · Balance Sheet · Cash Flow · Consolidated
Ledgers               General Ledger · Customer Ledger Summary · Supplier Ledger Summary
Profitability         Gross Profit · Profitability Analysis · Sales/Purchase Invoice Trends
Other Reports         7 laporan lain
```

**Invoicing** — 9 kartu, dan tiga di antaranya pintar:

```
Opening and Closing        Opening Invoice Creation Tool · Chart of Accounts Importer ·
                           Period Closing Voucher
Cost Center and Budgeting  Chart of Cost Centers · Budget · Accounting Dimension ·
                           Cost Center Allocation · Budget Variance Report · Monthly Distribution
Banking                    Bank · Bank Account · Bank Clearance ·
                           Bank Reconciliation Tool · Bank Reconciliation Statement · Plaid
Accounting Masters         Company · Chart of Accounts · Accounts Settings · Fiscal Year ·
                           Accounting Dimension · Finance Book · Accounting Period · Payment Term
```

### Yang layak diambil ke menu 43 baris kita

| # | ide ERPNext | perubahan di menu kita |
|---|---|---|
| 1 | **"Opening and Closing" satu kartu** — awal dan akhir buku adalah satu pekerjaan | gabung `Opening balances` + `Period close` jadi satu grup kecil, bukan dua baris di tengah ACCOUNTING |
| 2 | **Laporan dikelompokkan menurut pertanyaan** | grup REPORTS kita cuma 1 baris. Pecah jadi **Financial statements · Ledgers** — dan pindahkan `Ledger` dari ACCOUNTING ke REPORTS, karena itu memang bacaan |
| 3 | **Master dipisah dari transaksi** | grup SETUP kita sudah begitu. ERPNext mengkonfirmasi, tidak ada yang berubah |
| 4 | **Dimensi duduk bersama anggaran** | tunda sampai budget ada; sekarang `Dimensions` tetap di SETUP bersama Chart of accounts |

### Yang **tidak** layak ditiru

- **Empat workspace untuk satu modul.** Pengguna harus tahu bahwa Chart of Accounts ada di
  "Invoicing". Itu kebingungan yang putusan 13 September kita sengaja hindari dengan
  *satu pintu*.
- **54 link dalam satu workspace bernama "Invoicing"** yang memuat Company, Fiscal Year,
  Share Management dan Subscription.
- **Plaid Settings** di kartu Banking — kita memang tidak punya API bank.

---

## 8. Perubahan yang saya usulkan ke rencana

Berurut menurut rasio manfaat terhadap ongkos:

| # | perubahan | ongkos | membuka |
|---|---|---|---|
| **1** | `cleared_on` pada `supplier_payment` dan `cash_document` | 2 kolom + 1 laporan | *Executed ≠ Settled*, FLOW A dan FLOW G, jembatan rekonsiliasi bank |
| **2** | `bank_line_match` + `document_kind`/`document_id`/`origin`; status pada `bank_statement_line` | 4 kolom | alur bank-first, "Ignored beralasan" |
| **3** | `journal_line.supplier_id` → `party_kind`+`party_id`, plus `party_role` | 1 migrasi + sapuan pemanggil | pihak yang seragam; BCA berperan tiga |
| **4** | status tagihan sebagai kolom **turunan** dengan nama spesifikasi | 1 view | bahasa yang sama antara layar dan dokumen |
| **5** | menu: gabung Opening+Close, pindahkan Ledger ke REPORTS | nol backend | menu lebih rapi, 43 baris tetap |
| — | Budget, Recurring Bills, Deferred Revenue | modul penuh | **ditunda** — nol data, nol proses yang memintanya |

Yang **tidak** berubah, dan sebaiknya tidak pernah: satu pintu jurnal, tutup buku yang
mencatat penghalangnya, dan tidak adanya rute hapus.
