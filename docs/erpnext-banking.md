# ERPNext — banking: menunya, layarnya, dan bandingannya dengan kita

**Status:** dokumen rujukan pembanding, bukan rencana. Melanjutkan
[`./erpnext-reference.md`](./erpnext-reference.md), yang memetakan seluruh
menu; dokumen ini hanya **banking**, karena itu yang diminta pemilik pada
13 September 2026 ("saya suka UI-nya").

Sumber, dibaca 2026-09-13 lewat GitHub API, bukan dari ingatan:

* `frappe/erpnext` branch `develop` @ `f5f956c` (2026-09-12) — berkas
  `workspace/payments/payments.json`, sembilan doctype `bank_*`,
  `bank_reconciliation_tool.py` (1.529 baris) dan tiga berkas UI-nya di
  `public/js/bank_reconciliation_tool/`;
* `https://docs.frappe.io/erpnext/banking-in-erpnext` — halaman dokumentasi
  yang pemilik kirim. Isinya **lebih tipis dari kodenya**: sembilan judul
  bagian, alur empat langkah, tanpa nama field. Semua angka dan nama di bawah
  diambil dari kode, bukan dari halaman itu.

Model kita: [`./finance.md`](./finance.md). Gap yang disebut di sini (G5, G6,
G8, G9) adalah nomor dari tabel gap dokumen itu.

---

## 1. Di mana menunya sebenarnya

Banking **bukan workspace sendiri**. Ia satu grup di dalam sidebar
*Payments*, dan itu satu keputusan bentuk yang layak dicatat: uang keluar-masuk
dan bank tidak dipisah.

```
Payments (workspace)
  Payments        Payment Entry · Journal Entry · Payment Request ·
                  Payment Order · Payment Reconciliation ·
                  Unreconcile Payment · Process Payment Reconciliation ·
                  Repost Accounting Ledger · Repost Payment Ledger
  Banking         Bank Clearance · Bank Reconciliation (Tool) ·
                  Reconciliation Statement (report)
  Banking Setup   Bank · Bank Account · Bank Account Type ·
                  Bank Account Subtype · Bank Guarantee · Plaid Settings
  Dunning         Dunning · Dunning Type
  Reports         AR · AP · General Ledger · Trial Balance → Financial Reports
```

Badan halamannya: satu chart **Bank Balance** selebar halaman, lalu tiga kartu
angka (Total Incoming Payment · Total Outgoing Payment · Total Outgoing Bills).

Jadi seluruh permukaan banking-nya cuma **tiga layar kerja** (Clearance ·
Reconciliation · Statement) di atas **enam master**. Yang membuatnya terasa
lengkap bukan jumlah menu, melainkan apa yang ada di dalam satu layar
rekonsiliasinya.

---

## 2. Bentuk datanya — dan tiga kolom yang kita tidak punya

`Bank Transaction` adalah **dokumen submittable per baris rekening koran**,
bukan baris anak dari sebuah "statement". Tidak ada doctype statement sama
sekali. Fieldnya, yang penting:

| Field | Gunanya |
|---|---|
| `deposit` / `withdrawal` | dua kolom, bukan satu bertanda |
| `allocated_amount` / `unallocated_amount` | **satu baris bank boleh dibagi ke beberapa voucher** |
| `payment_entries` (child table) | daftar voucher yang mengklaim baris ini, masing-masing dengan jumlahnya |
| `party_type` / `party` | pihak, ditebak aturan atau dipilih orang |
| `bank_party_name` / `bank_party_iban` / `bank_party_account_number` | **apa yang bank sendiri sebut** tentang lawan transaksi, disimpan mentah dan terpisah dari tebakan kita |
| `included_fee` / `excluded_fee` | biaya bank pada baris itu — di dalam atau di luar nominal |
| `transaction_type`, `reference_number`, `transaction_id` | narasi bank |
| `is_rule_evaluated`, `matched_transaction_rule` | jejak aturan mana yang mengklasifikasikannya |
| `status` | Pending · Settled · Unreconciled · Reconciled · Cancelled |

`Bank Transaction Rule` — **aturan yang mengklasifikasikan transaksi**, bukan
berkas: tipe (Any/Withdrawal/Deposit), rentang nominal, daftar kondisi atas
deskripsi, lalu aksinya `classify_as` = Bank Entry · Payment Entry · Transfer,
dengan `account`, `party`, `priority`, dan opsi pecah ke beberapa akun.

`Bank Account` menyimpan `iban`, `bank_account_no`, `branch_code`,
`is_company_account`, `is_credit_card`, `statement_password` (password PDF
rekening koran), dan tiga field integrasi (`integration_id`,
`last_integration_date`, `mask`) untuk feed Plaid.

`Bank Statement Import` adalah Data Import yang disetel per bank:
`template_options` (peta kolom, JSON), `custom_delimiters`, `use_csv_sniffer`,
impor dari **Google Sheets**, bendera **MT940**, status
Pending/Success/Partial Success/Error, plus dua doctype log.

Yang dipegang tabel kita ([`0071`](../backend/migrations/postgres/0071_bank_reconciliation.sql)):
`value_date`, `description`, `reference`, `debit_minor`/`credit_minor`,
`fingerprint`, `account_code`. **Tidak ada pihak, tidak ada biaya, tidak ada
jumlah teralokasi.** Sebaliknya kita punya yang mereka tidak punya: header
`bank_statement` dengan `period_start/end` + `opening_minor`/`closing_minor`
sebagai **fakta tersimpan**.

---

## 3. Layar yang disukai itu, persisnya

`Bank Reconciliation Tool` adalah satu halaman, dan isinya:

1. **Tiga kartu angka** di atas — "Closing Balance as per Bank Statement",
   "Closing Balance as per ERP", dan **"Difference"** yang berganti warna
   (`number_card.js`). Itu inti daya tariknya: satu angka yang harus nol.
2. **Baris filter**: company, bank account, dari–sampai tanggal, saldo penutup
   menurut bank (**diketik orang di layar**), dan opsi memfilter dengan
   *reference date* alih-alih tanggal transaksi.
3. **Tiga tombol** di kepala: *Upload Bank Statement* · *Auto Reconcile* ·
   *Get Unreconciled Entries*.
4. **Datatable** sembilan kolom: Date · Party Type · Party · Description ·
   Deposit · Withdrawal · **Unallocated Amount** · Reference Number ·
   **Actions** — tombol aksi ada **di dalam baris**, bukan di toolbar.
5. **Satu dialog** per baris, dengan satu dropdown *Action* yang mengubah
   seluruh isinya:
   * **Match Against Voucher** — filter jenis dokumen (Payment Entry ·
     Journal Entry · Sales Invoice · Purchase Invoice · **Bank Transaction
     lain**) + saklar *exact match*, lalu daftar kandidat berperingkat yang
     **bisa dicentang lebih dari satu**;
   * **Create Voucher** — Payment Entry atau Journal Entry dibuat dari baris
     itu lalu langsung dicocokkan;
   * **Update Bank Transaction** — perbaiki pihak/referensi pada barisnya
     sendiri.
6. **Aksi borongan** — **hanya sebagai API, bukan layar.** Dikoreksi 2026-09-13:
   `create_bulk_bank_entry_and_reconcile`, `create_bulk_payment_entry_and_reconcile`
   dan `create_bulk_internal_transfer` ada sebagai endpoint, tetapi datatable
   mereka memakai `checkboxColumn: false` dan **tidak ada satu pun pemanggil di
   seluruh repo** (dicek lintas `*.js`/`*.py`/`*.json`). Permukaan itu jelas
   disiapkan untuk klien lain, bukan untuk layar ini.

Peringkat kandidatnya sederhana dan jujur soal itu:
`ref_rank + amount_rank + party_rank + unallocated_rank + 1`, tiap suku bernilai
0 atau 1, diurutkan menurun (`bank_reconciliation_tool.py:1275–1520`). Auto
Reconcile menyapu per transaksi; di atas 10 transaksi ia pindah ke antrean latar
dalam batch 1.000, dan melapor "N Transaction(s) Reconciled / M Partially".

**Satu fitur yang paling relevan untuk kita — dan sama-sama tanpa layar:**
`search_for_transfer_transaction`
— untuk sebuah penarikan, ia mencari **cerminnya** (setoran bernilai sama, di
rekening lain, dalam ±`transfer_match_days`, default 3 hari) dan menawarkan
dibukukan sebagai transfer internal. Itu persis masalah setoran kas toko ke bank
HO yang di [`finance.md` §9](./finance.md) tercatat belum punya dokumen (**G6**).
Sama seperti aksi borongan: endpointnya ada, dialog mereka tidak memanggilnya, dan
halaman dokumentasi tidak menyebut transfer internal sama sekali. Jadi kalau kita
memakainya, kita **melampaui** ERPNext, bukan mengikutinya.

### Layar keduanya: Bank Clearance, dan kenapa ia ada

Bentuknya sederhana sampai terasa tua: satu filter (account, `from_date`,
`to_date`, bank account, dua centang — *Include Reconciled Entries* dan
*Include POS Transactions*), satu tabel anak tujuh kolom yang **enam di
antaranya read-only** — Payment Document · Against Account · Amount · Posting
Date · Cheque Number · Cheque Date — dan **satu kolom yang bisa diisi:
Clearance Date. Lalu satu tombol *Update Clearance Date*.** Satu-satunya
validasinya: tanggal cair tidak boleh mendahului tanggal cek
(`bank_clearance.py:106`).

Jadi ia bukan layar rekonsiliasi. Ia **editor massal untuk satu field**, dan
field itu yang menarik: `clearance_date` pada Payment Entry / Journal Entry /
Purchase Invoice. Dua hal bergantung padanya:

* **Mencocokkan di Bank Reconciliation Tool mengisi field yang sama secara
  otomatis** (`bank_reconciliation_tool.py:422`), dan melepas pencocokan
  mengosongkannya (`:448`). Bank Clearance karenanya adalah **mode manual** —
  untuk rekening yang rekening korannya tidak pernah diimpor.
* **Laporan `Bank Reconciliation Statement`** menyusun jembatan empat baris
  dari field itu (`bank_reconciliation_statement.py:44–57`):

  ```
  Bank Statement balance as per General Ledger
  + Outstanding Cheques and Deposits to clear      (clearance_date kosong,
                                                    atau > tanggal laporan)
  + Cheques and Deposits incorrectly cleared       (cair sebelum dibukukan)
  = Calculated Bank Statement balance
  ```

  Itulah **penguraian** dari satu angka selisih menjadi daftar dokumen
  penyebabnya. Kita punya angkanya (`statements.rs:679` —
  `per_books − closing_minor`) dan **tidak punya daftarnya**, padahal datanya
  sudah ada: baris jurnal pada akun bank yang belum punya `bank_line_match` per
  suatu tanggal adalah persis "outstanding to clear".

---

## 4. Punya kita hari ini

Rute (`backend/src/cloud/http/mod.rs:891–932`):

```
GET  /finance/money                              satu baris per akun uang × lokasi
GET  /finance/bank-statements                    daftar rekening koran + facet
POST /finance/bank-statements                    impor
GET  /finance/bank-statements/{id}/lines
GET  /finance/bank-statements/{id}/suggestions    skor seluruh statement sekaligus
POST /finance/bank-lines/{id}/match  DELETE …     setujui / batalkan
POST /finance/bank-lines/{id}/book                jadikan jurnal, lalu cocokkan
GET/POST /finance/statement-sources               aturan intake surat
GET  /finance/statement-intake  + /run            riwayat intake
```

Layarnya satu: **Cash & bank** (`frontend-hub/src/screens/finance/bank.tsx`,
1.544 baris) — daftar akun uang **seluruh lokasi sekaligus**, dengan kontrol
*as of*, facet `pot`/`site`/`flag`, dan sheet per akun yang di dalamnya ada
rekonsiliasi per statement.

---

## 5. Fitur demi fitur

| | ERPNext | Kita | Lebih baik |
|---|---|---|---|
| Impor rekening koran | unggah CSV/XLSX/Google Sheets/MT940, peta kolom per bank | **IMAP/folder otomatis**, CSV/XLSX (termasuk ber-password)/PDF_TEXT, peta kolom sebagai data (`0106`) | **kita** |
| Layar untuk impor itu | doctype penuh + dua log | **tidak ada layar** — endpoint ada, hub belum memakainya | mereka |
| Feed bank langsung | Plaid | — | mereka (tidak relevan di sini) |
| Baris bank sebagai dokumen | ya, submittable, bisa dikomentari/dilampiri | baris tabel | mereka |
| Header periode + saldo awal/akhir bank | **tidak ada** — saldo penutup diketik di filter | tersimpan sebagai fakta per periode (`bank_statement`) | **kita** |
| Pencocokan | peringkat per transaksi, 0/1 per suku | skor berbobot + **rencana global** anti-bentrok (`bank_match.rs:180`) | **kita** |
| Satu baris ↔ banyak voucher | ya, dengan `allocated`/`unallocated` | **tidak** — `UNIQUE (line_id)` dan `UNIQUE (journal_line_id)` | mereka |
| Cocokkan ke faktur langsung (bikin payment on the fly) | ya (SI/PI) | tidak — harus lewat payment/jurnal dulu | mereka |
| Buat jurnal dari baris tak dikenal | ya | ya, lewat `account_map` (`banking.rs:900`) | setara, **cara kita lebih aman** |
| Transfer antar rekening (cari cerminnya) | ya | **tidak** (G6) | mereka |
| Aturan klasifikasi otomatis per deskripsi | `Bank Transaction Rule` | **tidak ada** (lihat §7) | mereka |
| Biaya bank pada baris | `included_fee`/`excluded_fee` | tidak (G9 settlement acquirer) | mereka |
| Kliring cek/giro dengan tanggal cair | `Bank Clearance` | **tidak** (G8) | mereka |
| Auto-reconcile massal di latar | ya | tidak (skor dihitung, keputusan tetap per klik) | mereka, dengan catatan |
| Posisi uang seluruh estate sekaligus | tidak — satu rekening satu company per layar | **ya** — semua akun × 14 lokasi, dengan bendera `DIFFERS`/`NO_STATEMENT`/`UNMATCHED`/`NEGATIVE` | **kita** |
| Kode akun di kode program | dipilih orang per dokumen | tidak pernah — `semantic_key × site → account_code` | **kita** |
| Invariant di database | di aplikasi | di database (append-only, seimbang, periode terkunci) | **kita** |

---

## 6. Lima hal yang pada kita memang lebih baik

1. **Statement adalah dokumen dengan saldo awal dan akhir dari bank.** Angka
   "Difference" mereka berasal dari kotak isian di layar; tidak tersimpan, tidak
   bisa diaudit, dan hilang begitu filter diganti. Kita menyimpannya per
   periode, jadi "apakah bulan Agustus pernah nol" adalah pertanyaan yang punya
   jawaban.
2. **Matcher kita membuat rencana untuk seluruh statement**, bukan skor per
   baris. Dua pembayaran lima juta pada Jumat yang sama tidak akan pernah
   ditawari baris jurnal yang sama dua kali (`bank_match.rs:161–180`). Pada
   mereka, dua transaksi bisa sama-sama diberi peringkat tinggi untuk voucher
   yang sama dan yang kedua baru gagal saat disimpan.
3. **Alasan, bukan cuma skor.** `bank_line_match.reasons` menyimpan field mana
   yang cocok dalam kata-kata, plus `decided_by_kind` MANUAL/AUTO — sehingga
   auto-match yang kemudian dibatalkan orang adalah bukti bahwa ambangnya salah.
   Peringkat mereka adalah satu bilangan bulat tanpa penjelasan.
4. **Satu layar untuk 14 lokasi.** Pertanyaan "rekening mana di toko mana yang
   tidak cocok" mereka jawab dengan membuka layar rekonsiliasi satu per satu;
   kita menjawabnya dengan satu bendera facet.
5. **Intake otomatis.** Rekening koran kita masuk sendiri dari mailbox,
   termasuk XLSX ber-password dan PDF teks (`0106`). Mereka mensyaratkan
   seseorang mengunggah berkas — kecuali memakai Plaid, yang tidak ada di sini.

---

## 7. Koreksi untuk dokumen kita sendiri

[`erpnext-reference.md` §6 baris 8](./erpnext-reference.md) menyebut
**Bank Transaction Rule** sebagai "sudah ada pada kita (`0106`) — paritas".
**Itu salah, dan perlu dicabut.** Aturan `0106` kita mencocokkan
`from_pattern`/`subject_pattern`/`filename_pattern` — ia memilih **berkas mana
milik rekening mana** (`domain/statement_intake.rs:56–86`). Aturan mereka
membaca **deskripsi transaksi, nominal, dan arahnya**, lalu menetapkan akun dan
pihak. Dua lapis yang berbeda; kita tidak punya lapis yang kedua sama sekali.

---

## 8. Jawaban: bisakah kita seperti itu?

Bisa, dan tiga dari empat langkahnya kecil. Urutannya ditentukan oleh apa yang
hari ini **menghasilkan angka salah**, bukan oleh apa yang paling terlihat.

1. **Alokasi sebagian (satu baris ↔ banyak voucher).** Ini satu-satunya yang
   menyentuh skema: `UNIQUE (line_id)` dan `UNIQUE (journal_line_id)` di `0071`
   harus jadi jumlah teralokasi per pasangan. Tanpa ini, satu transfer borongan
   ke dua pemasok — yang di `http/finance.rs:810` sudah kita akui sebagai
   "ordinary Friday" — tidak akan pernah bisa direkonsiliasi.
2. **Transfer internal dengan pencarian cermin.** Aturannya sudah kita tulis
   dua kali (setoran kas toko, G6). Pinjam mekanika mereka apa adanya: cari
   lawan bernilai sama di rekening lain dalam ±3 hari, tawarkan sebagai satu
   dokumen dengan dua kaki.
3. **Aturan klasifikasi per deskripsi**, mengusulkan bukan memutuskan —
   `deskripsi mengandung X` + rentang nominal + arah → arti (bukan kode akun,
   karena kita punya `account_map`). Ini membuat `POST /bank-lines/{id}/book`
   punya nilai bawaan alih-alih kotak kosong.
4. **Layar untuk intake yang sudah jalan.** Endpoint `statement-sources` dan
   `statement-intake` tidak dipanggil satu berkas pun di `frontend-hub`. Kita
   punya fitur yang lebih kuat dari mereka dan tidak seorang pun bisa melihatnya
   — termasuk baris `skipped_no_match` yang sengaja ditulis supaya mailbox yang
   diam bisa dibedakan dari mailbox yang kosong.

5. **Laporan jembatan** (§3, Bank Clearance). Yang paling murah dari semuanya
   dan yang paling sering ditanya orang finance: uraikan `difference` menjadi
   daftar dokumen yang belum cair per tanggal laporan. Nol tabel baru — cukup
   baris jurnal pada akun bank yang belum punya `bank_line_match`.

Yang **tidak** perlu ditiru: saldo penutup sebagai kotak isian (kita sudah lebih
baik); Plaid; `Bank Guarantee` dan `Dunning` (belum ada piutang pelanggan);
satu layar per satu rekening; peringkat 0/1 tanpa alasan; dan **layar Bank
Clearance itu sendiri** — grid batch-edit satu kolom yang pada kita redundan,
karena rekonsiliasi kita digerakkan statement, bukan diketik tangan.

Yang tetap menunggu keputusan pemilik, bukan kode: **giro** (G8). Dan di sini
ERPNext memberi jawaban yang **tidak** boleh disalin mentah:
`clearance_date` mereka **tidak menyentuh buku besar sama sekali** — Payment
Entry tetap mengkredit bank pada `posting_date`, dan tanggal cair hanya
mengubah laporan rekonsiliasi. Itu opsi ketiga di luar dua yang dicatat
[`PAYMENT-TERMS-PLAN.md`](../PAYMENT-TERMS-PLAN.md), dan ia masuk akal untuk cek
yang cair dua-tiga hari. Untuk giro mundur 30–90 hari ia salah secara material:
kas berkurang di buku sebulan sebelum uangnya benar-benar keluar. **Ambil
laporannya, jangan ambil model gironya.**

---

## 9. Putusan pemilik — 13 September 2026

Diputuskan setelah membaca menu, layar, dan dokumentasi ERPNext bersama-sama:

* **Ambil cara kerja rekonsiliasinya**, dan bentuk layarnya, disesuaikan ke
  bahasa desain hub.
* **Buang `Bank Guarantee` dan `Plaid Settings`** — tidak ada garansi bank di
  rantai kerja klien, dan tidak ada feed bank otomatis di Indonesia. Ikut
  dibuang: `Bank Account Type`/`Subtype` sebagai master tersendiri; jenis
  rekening cukup dua nilai (giro, tabungan).
* **Lokalkan master rekening**: tanpa IBAN dan SWIFT; yang dipakai nomor
  rekening, atas nama, cabang, jenis.
* **Tambah grup menu `Banking` di Finance** berisi lima layar: `Cash & bank`
  (pindah dari grup Work, plus tab *What differs*), `Reconcile`, `Statements`,
  `Bank rules`, `Bank accounts`.
* **Yang tidak ikut berpindah bentuk**: posting tetap lewat `account_map`
  (layar memilih arti, bukan kode akun), statement tetap dokumen dengan saldo
  awal/akhir dari bank, dan tiap kecocokan tetap menyimpan alasan, penyetuju,
  dan waktunya. Tidak ada tanggal cair yang bisa diketik tanpa baris bank —
  itu sebabnya `Bank Clearance` tidak diambil (§3).

Prototipenya: <https://claude.ai/code/artifact/2e665e61-a798-4b5a-b198-f5cef122f5a6>
(perbandingan berdampingan yang mendahuluinya:
<https://claude.ai/code/artifact/3b6c5564-981d-4329-a61b-1ed5b29087b1>).

Satu hal yang baru muncul dari halaman dokumentasinya, dan layak dicatat
terpisah: bab **Controls and review** mendaftar enam hal yang harus dipantau
orang — baris bank yang belum terekonsiliasi, pembayaran lama yang belum cair,
id transaksi ganda, rekening tanpa akun buku yang sah, saldo koran lawan buku,
dan **jurnal yang diposting langsung ke akun bank tanpa dokumen**. Di sana itu
nasihat; pada kita keenamnya bisa dihitung dari data yang sudah ada dan
ditampilkan sebagai angka di `Cash & bank`. Yang terakhir belum pernah kita
hitung sama sekali.

Urutan kerja yang disarankan: `Reconcile` (layar + alokasi sebagian, satu-satunya
yang menyentuh skema) → `Statements` (rumah untuk intake `0106` yang sudah jalan
tanpa layar) → `Bank rules` → `Bank accounts` (termasuk rekening pemasok, yang
tabel `supplier` kita belum punya kolomnya).

### Revisi brief pemilik — 13 September 2026, sore

Putusan §9 di atas **diperketat** setelah pemilik membaca audit: yang dibenchmark
sempat tercampur, jadi aturannya sekarang eksplisit.

**Bank Reconciliation = tiru ERPNext, titik.** Tidak ada aksi borongan, tidak ada
transfer, tidak ada aturan, tidak ada papan peringatan di layar itu. Satu-satunya
penyimpangan yang diizinkan: **keterbacaan kandidat** — `rank 4` diganti nama
sukunya (`exact amount`, `reference match`, `party match`, `2 days apart`).
Struktur interaksinya tidak boleh berubah.

**Menu Cash & Bank, enam baris, urutan dari pemilik:**

```
Cash & Bank
├── Cash                 tempat uang tunai (pot CASH · PETTY_CASH · CASHIER_FLOAT)
├── Cash Counts          hitungan fisik lawan buku          — BELUM ADA apa pun
├── Banks                institusi (BCA, Mandiri, BRI)       — BELUM ADA master
├── Bank Accounts        rekening perusahaan + pemasok       — BELUM ADA master
├── Bank Transactions    baris rekening koran                — data ada, layar tidak
└── Bank Reconciliation  baris bank ↔ jurnal                 — ada, di dalam sheet
```

Kas **tidak** dipaksa simetris dengan bank: tidak ada `Cash Account` /
`Cash Transaction` / `Cash Reconciliation`. Alasannya satu kalimat —
bank punya sumber pembanding dari luar (rekening koran), kas tidak; pembanding
kas adalah hitungan fisik. `Bank Reconciliation` juga tidak boleh dinamai
`Reconciliation` saja.

**Extension Retail OS tetap dikerjakan, tapi pindah rumah:**

| Extension | Rumahnya |
|---|---|
| Aksi borongan | daftar `Bank Transactions` (daftar bawaan Frappe pun punya centang) |
| Transfer antar rekening | dokumen perpindahan uang dari `Payments`; di rekonsiliasi ia hanya kandidat biasa lewat jenis dokumen *Bank transaction* |
| Bank rules | sheet ber-URL dari toolbar `Bank Transactions` (pola setup Article), bukan menu |
| Sumber rekening koran (mailbox `0106`) | sheet setup dari toolbar yang sama; riwayat berkas jadi tab *Imports* |
| `What differs` | ditunda; bukan tab, bukan layar rekonsiliasi |

Keputusan lain yang ikut ditetapkan: **Bank Clearance tidak dibuat** — status
cleared diturunkan dari hasil rekonsiliasi; **Payment Reconciliation** tetap
diperlukan dan berbeda (payment ↔ invoice); **Mode of Payment** perlu jadi master
(hari ini lima nilai keras di `payments.rs:562`); **Bank Guarantee** di luar
scope; **cheque** hanya kalau operasional memakainya.

Prasyarat yang menahan baseline: `bank_line_match` masih `UNIQUE (line_id)` **dan**
`UNIQUE (journal_line_id)` — alokasi sebagian harus dikerjakan lebih dulu, dan
baris bank perlu tiga kolom yang belum ada (party, biaya, status).

---

## 10. Apa yang sudah dibangun — 13 September 2026

Modul `finance-lab-2` di hub (`/finance-lab-2`), enam layar, terhubung ke node
cloud yang sungguhan. `Bank Reconciliation` meniru bentuk ERPNext: tiga tombol
kepala, baris filter (rekening · dari · sampai), tiga kartu angka dengan
Difference, tabel sembilan kolom dengan tombol **Actions** di dalam baris, dan
**modal** dengan satu `Action` select — Match against voucher · Create voucher ·
Update bank transaction — berisi baris centang jenis dokumen, saklar **Exact
match**, kandidat yang bisa dicentang lebih dari satu, kolom **Allocate** yang
bisa diisi, dan tombol **Reconcile**.

**Alokasi sebagian sudah jalan, dari skema sampai layar.** Migrasi
`0213_a_bank_line_can_settle_more_than_one_voucher.sql` membuang
`UNIQUE (line_id)` (menyisakan `UNIQUE (journal_line_id)` — satu voucher diklaim
sekali), menambah `allocated_minor`, dan menegakkan "satu baris tidak bisa
memberi lebih dari yang dipegangnya" lewat **constraint trigger**, bukan lewat
Rust. `confirm_match` mengambil `allocated_minor` (kosong = sisa), `unmatch`
menerima `?journal_line=` untuk melepas satu klaim saja, dan baris bank sekarang
membawa `allocations[]`, `allocated_minor`, `unallocated_minor`.

Satu hal yang tidak terduga dan layak dicatat: **matcher menolak kandidat yang
nominalnya berbeda** ("amount is the anchor, not a bonus"), jadi paruh PERTAMA
sebuah split tidak akan pernah muncul. Itulah gunanya saklar *Exact match*
ERPNext: dimatikan, `Ruleset.allow_partial` menyala dan voucher yang lebih KECIL
dari sisa baris ikut ditawarkan dengan skor rendah (`partial: 20`) dan alasan
"covers part of this line" — tidak pernah cukup untuk auto-match.

Terbukti hidup (backend 8151, DB `inventory_rfid`): satu baris 26.448.000
diklaim JV-00000101 sebesar 16.448.000 → sisa 10.000.000 → sisa itu lalu cocok
PERSIS dengan JV-00000102 (skor 75) → baris lunas dengan dua klaim, satu MANUAL
satu AUTO; klaim ketiga ditolak 400 "this bank line is already fully allocated".

**Masih belum sama dengan ERPNext:** pihak dan biaya pada baris bank (dua kolom
yang digambar kosong), `Update bank transaction` yang benar-benar menulis,
`Create voucher` tipe Payment Entry, unggah rekening koran dari layar ini,
dan pengingat transaksi lama sebelum tanggal filter.

### Lanjutan — kolom counterparty (0214)

Dua kolom `Party type` dan `Party` milik ERPNext akhirnya terisi, dengan satu
perubahan kata: **kosakata kita bukan "party" melainkan "counterparty"**
(CONTEXT.md §Place dan §Supplier, dan `letters.rs` sudah memakainya), jadi
kolomnya `counterparty_kind` · `counterparty_id` · `counterparty_name` di
migrasi `0214_a_bank_line_can_say_who_the_other_side_was.sql`, plus `bank_said`
(string yang BANK cetak) dan `note`.

Penyempitan sadar dari ERPNext: `Update Bank Transaction` mereka boleh menyunting
nomor referensi dan narasi; **punya kita tidak akan pernah**. Tanggal, nominal,
narasi dan referensi adalah bukti — sidik jari dedup dihitung di atasnya — jadi
yang boleh ditulis hanyalah bacaan kita atas bukti itu, di kolomnya sendiri.
Endpoint: `PATCH /api/v1/finance/bank-lines/{id}`.

Terbukti lewat layar: baris 03 Sep 2026 kini terbaca `Supplier · Pemasok C`
dengan catatan "dikenali dari narasi bank", disimpan ke backend sungguhan.

---

## 11. Cash Counts — 13 September 2026

Menu keenam akhirnya punya isi. Migrasi
`0216_a_drawer_is_counted_and_the_difference_is_explained.sql`: tabel
`cash_count` + `cash_count_note` (rincian pecahan), satu hitungan per laci per
hari, dan `CASH_COUNT` ditambahkan ke daftar `source_kind`.

Dua keputusan bentuk yang tidak terbaca dari kode:

- **Selisih tidak disimpan.** `counted_minor` − saldo buku adalah pengurangan;
  salinan tersimpan adalah angka kedua yang suatu hari akan berbeda dari yang
  pertama. Yang **disimpan** justru `per_books_minor` — "buku berkata sekian
  sore itu" adalah fakta tentang sore itu, dan entri mundur tidak boleh
  menulisnya ulang.
- **Rincian pecahan boleh kosong, tapi kalau ada harus menjumlah.** Ditegakkan
  constraint trigger (DEFERRED, karena barisnya masuk satu per satu), dan
  dijelaskan lagi di Rust supaya jawabannya kalimat, bukan nama constraint.

Mencatat dan memposting sengaja dua tindakan: kekurangan kas layak ditulis
begitu ditemukan, dan layak masuk buku hanya setelah ada yang menyebutkan
sebabnya. Server menolak posting tanpa alasan, dan alasan boleh datang bersama
keputusan posting (`PostCountRequest`).

**Terbukti hidup:** Kas Toko 03 dihitung Rp 289.803.000 lawan buku
Rp 289.828.000 → selisih −Rp 25.000, dengan rincian 2.898×100.000 + 3×1.000;
rincian yang tidak menjumlah ditolak dengan kalimat; dan posting menjawab
**"no account is mapped for `cash_variance` at store-03"**.

**Keputusan yang menunggu pemilik:** akun mana yang jadi rumah `cash_variance`.
Bagan klien punya `801011000203 Selisih pembulatan C003`, tapi itu selisih
pembulatan — kalau selisih hitung kas mau dipisah, akunnya perlu ditunjuk atau
dibuat. Sampai itu diputuskan, hitungan tetap tercatat dan selisihnya tidak
masuk buku.

---

## 12. Bank Accounts jadi nyata — 13 September 2026

Sebelum ini "Bank Accounts" hanya turunan: satu baris `account_map` yang
mengatakan makna `bank_giro` berkualifikasi "BCA" jatuh ke kode akun tertentu.
Cukup untuk memposting, dan tidak cukup untuk apa pun yang lain — nomor
rekening, atas nama siapa, cabang mana, rekening mana yang dipakai satu toko
untuk membayar: semuanya tidak ada.

Migrasi `0223_a_company_account_is_a_real_account_at_a_real_bank.sql` menambah
`company_bank_account`. Tiga keputusan:

- **Bukan master bank.** Lane lain sudah memodelkan rekening *pemasok* (0221)
  dengan nama bank sebagai teks ternormalisasi, bukan tabel master. Mengikuti
  itu membuat satu bentuk untuk dua paruh, dan layar Banks menjadi apa yang
  seharusnya: institusi yang dikumpulkan dari rekening yang menyebutnya — milik
  kita dan milik pemasok sekaligus.
- **Tidak menggantikan account map.** Map memutuskan ke mana posting jatuh; ini
  menjelaskan rekening yang ditunjuk map. Dipisah supaya nomor rekening bisa
  berubah atau pindah cabang tanpa menyentuh satu pun aturan posting.
- **Satu baris per ikatan ledger**, jadi endpoint-nya upsert: menulis dua kali
  adalah koreksi, bukan rekening kedua. Satu rekening utama per tempat
  ditegakkan indeks unik parsial; menunjuk yang baru menurunkan yang lama,
  karena orang yang bilang "mulai sekarang bayar dari sini" sudah memutuskan
  soal yang lama.

**Terbukti hidup:** 69 rekening bank terpetakan di chart, **0** pernah
dijelaskan — itulah ukuran lubangnya. Satu dijelaskan lewat API (BCA,
1234-5678-90, PT Itulah Busana Nusantara, KCP Cihampelas, giro) dan otomatis
jadi rekening utama tempat itu; koreksi kedua tetap satu baris. Nomor 2 digit
dan jenis "DEPOSITO" ditolak dengan kalimat.

**Satu cacat lama yang ikut diperbaiki:** `normalize_bank` milik 0221 punya
penolakan untuk nama bank yang hanya kata "bank", dan penolakan itu tak pernah
menyala — pemotongan awalan butuh spasi di belakang, jadi "bank" sampai ke
pemeriksaan sebagai "BANK", bukan string kosong. Fungsinya sekarang dipakai
kedua paruh, jadi diperbaiki sekalian.

### Banks: dikumpulkan, bukan dipelihara

Layar Banks sekarang membaca `/finance/banks` — bukan master, dan itu keputusan,
bukan kekurangan: tak ada yang memelihara daftar bank. Sebuah bank muncul begitu
ada rekening menyebutnya (milik kita 0223 atau milik pemasok 0221) dan hilang
saat rekening terakhir berhenti. Keduanya menormalkan nama dengan fungsi yang
sama, jadi "BCA", "Bank BCA" dan "bank bca" adalah satu baris.

Tabel kedua di layar itu adalah lubangnya: rekening yang baru dikenal lewat teks
bebas `account_map.qualifier`. Menjelaskan rekening di layar Bank Accounts
memindahkannya dari tabel kedua ke tabel pertama.

**Terbukti:** satu rekening kita di Bank BCA (saldo buku Rp 5.058.000) dan —
lewat baris uji yang disisipkan lalu dihapus — satu bank yang hanya dipakai
pemasok muncul sebagai `ours=0, suppliers=1, held=None`, yaitu "suppliers only /
nothing of ours" di layar.

**Catatan untuk lane giro:** `POST /suppliers/{id}/bank-accounts` menjawab
**500 "database operation failed"** saat dicoba 13-09 malam. Tabelnya sendiri
menerima baris lewat SQL, jadi yang gagal ada di jalur endpoint-nya.

### Jejak audit dan peran

Empat tulisan baru (jelaskan rekening, pensiunkan rekening, catat hitungan,
posting selisih) sekarang **terfile ke akun ledger-nya**, bukan ke baris mereka
sendiri: "akun ini dihitung tanggal 13 dan kurang 25.000" tempatnya di riwayat
akun itu, dan id hitungan bukan record yang dibuka orang. Keempatnya terdaftar
di `DECLARED_BY_HANDLER` karena tak satu pun bisa dibaca dari path. Katalog rute
sudah di-bless ulang; kolom record ketujuh rute baru terbaca `account` untuk
tulisan dan `-` untuk bacaan.

**Satu pertanyaan peran yang belum diputuskan pemilik:** `required_role`
menempatkan semua tulisan `/finance/*` di **Admin**, termasuk *mencatat*
hitungan kas. Padahal yang menghitung laci adalah kepala toko, bukan admin
keuangan; yang memang pantas Admin adalah *memposting* selisihnya. Memisahkan
keduanya berarti menyentuh `required_role` — fungsi otorisasi bersama — jadi
dibiarkan apa adanya sampai pemilik memutuskan siapa yang boleh mencatat.
