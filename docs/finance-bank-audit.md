# Bank & Bank Account — audit sebelum skema disentuh

Phase 2 langkah 1. Dibaca 2026-09-16 terhadap rantai 0001–0268 (216 berkas) plus
baris nyata di `inventory_e2e`, `inventory_health_dev`, `inventory_rfid`,
`inventory_tanstack`, `inventory_flow`.

## Ringkasan yang mengubah bentuk Phase 2

Tiga temuan, masing-masing menggeser rencana:

1. **`company_bank_account` (0223) melarang hal yang brief §6 wajibkan.**
   `UNIQUE (ledger_account_code, site_id)` berarti satu akun bank per (GL, unit).
   Brief menuntut dua rekening BCA nyata boleh menunjuk satu GL. Salah satu harus
   mengalah, dan yang mengalah adalah constraint-nya — tapi pertanyaan yang
   dijawabnya (*"giro ini dicetak dari nomor yang mana"*) tetap harus punya satu
   jawaban. Lihat §3.
2. **Kedua master bank yang ada adalah pulau: NOL foreign key masuk.** Tak ada
   satu pun tabel merujuk `company_bank_account` atau `supplier_bank_account`.
   Keduanya dibuat lewat API, ditampilkan di layar, dan tak satu pun aliran uang
   membacanya. Jadi menyambungkan statement → bank account bukan pekerjaan
   membongkar, melainkan pekerjaan memasang yang pertama.
3. **Sudah ada model ketiga yang justru TERSAMBUNG: `payment_destination`
   (0151).** Ia punya `bank_code`, nomor rekening **terenkripsi**, fingerprint,
   dan alur verifikasi — dan `payment_batch_item` ber-FK padanya.
   `supplier_bank_account` (0221) menyatakan tujuan yang sama untuk supplier dan
   tak dirujuk apa pun. Dua lane membangun jawaban untuk satu pertanyaan. **Tidak
   saya satukan di Phase 2** (brief §7 melarang melebur, §16 melarang Party
   generik) — dicatat sebagai utang di §7.

## 1. Tabel yang ada

| tabel | arti | penulis | pembaca | FK keluar | FK masuk | API / layar | putusan |
|---|---|---|---|---|---|---|---|
| `company_bank_account` 0223 | rekening **kita** di bank nyata, terikat ke (GL, unit) | `company_banks.rs:181` (upsert) | `company_banks.rs`, `http/finance.rs` | `ledger_account(code,is_group)`, `site` | **nol** | `GET/POST /api/v1/finance/bank-accounts`, `POST …/{id}/retire`; layar `finance-lab-2/bank-accounts.tsx` | **EVOLVE** |
| `supplier_bank_account` 0221 | ke mana uang supplier dikirim; syarat cetak giro | `supplier_banks.rs:328` | `supplier_banks.rs`, `company_banks.rs` (daftar institusi), `http/supplier_banks.rs` | `supplier` | **nol** | `/api/v1/suppliers/{id}/bank-accounts` | **EVOLVE** (hanya `bank_id`) |
| `payment_destination` 0151 | rekening penerima untuk `SUPPLIER‖EMPLOYEE‖OTHER`, nomor terenkripsi + verifikasi | `destinations.rs` | `payment_allocation.rs`, `batches.rs`, `payment_context.rs`, `http/payments_lane.rs` | — | `payment_batch_item`, `payment_destination_snapshot` | lane payments | **JANGAN DISENTUH** — dicatat §7 |
| `bank_statement` 0071 | satu periode rekening koran untuk (GL, unit) | `banking.rs:234` | 17 berkas | `ledger_account`, `site`, dirinya (`superseded_by`) | `bank_statement_line` (2×) | `/finance/bank-statements` | **EVOLVE** |
| `bank_statement_line` 0071 | satu baris koran + kategorisasi | `banking.rs:272` | 11 berkas | `bank_statement` (biasa **dan** komposit via `account_code`) | `bank_line_match`, `bank_rule_proposal` | idem | pakai ulang |
| `bank_line_match` 0071 | baris koran ↔ `journal_line`, `UNIQUE(journal_line_id)` | `banking.rs:1077,1417` | 8 berkas | `bank_statement_line`, `journal_line` | — | `/bank-lines/{id}/match` | pakai ulang + penjaga §8 |
| `bank_statement_source` 0142 | routing intake per (GL, unit) + format CSV/XLSX/PDF_TEXT + `settings` jsonb | `statement_intake.rs:285` | `intake/*` | `ledger_account`, `site` | `bank_statement_intake` | `/finance/statement-sources` | **EVOLVE** |
| `bank_statement_intake` 0142 | satu berkas yang datang, ber-dedup | `statement_intake.rs:353` | `intake/*` | `bank_statement_source` | — | `/finance/statement-intake` | pakai ulang |
| `bank_rule` / `_proposal` 0116 | baris berulang mengusulkan `cash_document` | `bank_rules.rs` | `bank_rules.rs` | `site` | — | — | biarkan |
| `store_bank_destination` 0111 | ke (`bank_key`,`bank_qualifier`) mana setoran toko mendarat | `store_money.rs` | `store_money.rs` | `site` | — | Store money → Banking | **biarkan** — lihat §5 |
| `giro.bank` 0117 | nama bank sebagai **teks bebas** pada giro | lane giro | — | — | — | — | catat, jangan ubah di Phase 2 |
| `acquirer_settlement` 0135 | acquirer sebagai teks | — | — | — | — | — | di luar lingkup |

### "Bank" hari ini ditulis dengan LIMA ejaan berbeda

`company_bank_account.bank_name_normalized` · `supplier_bank_account.bank_name_normalized`
· `payment_destination.bank_code` · `giro.bank` · `store_bank_destination.bank_key`.
Tak satu pun menunjuk baris yang sama, karena tak ada baris untuk ditunjuk.
`bank_institutions()` (`company_banks.rs:288`) menurunkan daftarnya dengan
`UNION ALL` + `DISTINCT ON` atas dua tabel pertama — jadi **sebuah bank hanya
"ada" kalau ada rekening yang menyebutnya**, dan salah tulis melahirkan bank baru.

## 2. Baris nyata yang harus dimigrasi

Yang ada di seluruh database dev, dan tak lebih dari ini:

```
company_bank_account   1 baris   Bank BCA / BCA / 1234567890 / PT Itulah Busana
                                 Nusantara / GIRO / GL 1011002001 / site dc
                                 / is_primary=false / created_by 'development'
supplier_bank_account  0 baris
payment_destination    0 baris
giro                   0 baris
bank_statement         8 baris   semuanya GL 1011002001, di EMPAT site:
                                 dc, store-01, store-02, store-03 (2 tiap site)
bank_statement_line  144 baris
bank_line_match        3 baris
```

Satu-satunya baris master adalah **data seed** (`created_by = 'development'`),
bukan fakta klien. Jadi brief §12 terpenuhi dengan mudah: tak ada rekening klien
untuk ditemukan, dan **tak ada yang boleh dikarang dari COA**.

### Statement per-toko itu cacat seed, bukan fakta bisnis

`scripts/seed-finance.py:886` `seed_bank()` melakukan
`for index, site in enumerate(SITES[:4])` dan mengarsipkan satu koran per site
atas GL `1011002001` — termasuk `"Rekening koran store-01"`. Toko tidak punya
rekening; yang toko punya adalah **tujuan setoran** (`store_bank_destination`,
0111), yaitu (key, qualifier) yang diselesaikan `account_map` menjadi account
code. Jadi delapan statement itu tidak membuktikan toko memiliki rekening — ia
membuktikan seed-nya mengarang empat rekening koran.

Konsekuensinya untuk migrasi: enam dari delapan statement **tak punya rekening
nyata untuk ditunjuk**, dan mengarangkannya justru yang dilarang §12.

## 3. Konflik `UNIQUE (ledger_account_code, site_id)`

0223 menuliskan alasannya, dan alasannya sah:

> One description per ledger binding. Two rows describing one account at one
> place is two answers to "what is the number", and a giro printed from the wrong
> one comes back.

Tapi itu menjawab pertanyaan **"nomor mana yang dicetak"** dengan melarang
**"kita punya dua rekening di bank ini"**. Dua hal berbeda. Bentuk yang benar:

- identitas rekening = `UNIQUE (bank_id, account_no_digits)` — satu nomor di satu
  bank adalah satu rekening, mau berapa pun GL-nya;
- "yang mana yang dipakai kalau tak disebut" = **satu** `is_primary` per
  (GL, unit), ditegakkan **partial unique index**, bukan dengan melarang baris
  kedua.

Jadi giro tetap punya satu jawaban, dan rekening kedua tetap boleh ada.

## 4. Statement → rekening nyata, tanpa mengarang dan tanpa merusak sejarah

`bank_statement` mengenali dirinya lewat (`account_code`, `site_id`). Enam baris
seed tak bisa dipetakan ke rekening nyata. Tiga pilihan, dan yang ketiga yang
saya pakai:

1. `bank_account_id NOT NULL` — migrasi gagal di setiap DB dev. Ditolak.
2. Nullable saja — tak ada yang mencegah statement baru datang tanpa rekening.
   Ini lubang yang sama dengan Phase 1C, bentuk lain.
3. **Nullable + `CHECK (bank_account_id IS NOT NULL) NOT VALID`.** Postgres
   menegakkan constraint `NOT VALID` pada **setiap baris baru dan setiap update**,
   dan membebaskan baris lama. Artinya: statement yang sudah ada tetap terbaca
   (§15 "historical statements remain readable"), statement berikutnya **tak bisa
   masuk tanpa menyebut rekening**, dan tak ada rekening yang dikarang.

Pencocokan lintas rekening (§8) ditutup di `bank_line_match` dengan FK komposit,
bukan dengan trigger — lihat rencana di §6 dokumen ini.

## 5. Kepemilikan unit

Bukti dari kode, bukan asumsi: toko punya `store_bank_destination` (tujuan), dan
`company_bank_account.site_id` ada tapi hanya terisi `dc`. Tak ada satu pun
rekening toko di data mana pun. Jadi aturan bisnis brief §5 **cocok dengan
kode**: `owner_site_id` dipertahankan (ia sudah ada sebagai `site_id`), diisi
kantor pusat, ditegakkan di server, dan tidak dipamerkan sebagai pilihan di UI.

Catatan yang ditahan: konstanta kantor pusat masih `dc`, dan migrasi rename 0256
(`dc`→`ho`) masih dipegang lane lain. Phase 2 memakai `dc` lewat
`poster::HEAD_OFFICE_SITE` dan **tidak** menyelesaikan rename itu.

## 6. Rencana (reuse / evolve / replace)

Tak ada tabel baru selain `bank`. Tak ada model rekening kedua.

```
0269  bank                           BARU   id, code, name, normalized_name,
                                            country_code, active, timestamps
0269  company_bank_account           EVOLVE +bank_id, +status, +account_type,
                                            +opened_at, -UNIQUE(GL,site),
                                            +UNIQUE(bank_id, digits),
                                            +partial unique is_primary
0270  supplier_bank_account          EVOLVE +bank_id (nullable → backfill → NOT NULL)
0271  bank_statement                 EVOLVE +bank_account_id + CHECK NOT VALID
      bank_statement_source          EVOLVE +bank_account_id
      bank_line_match                EVOLVE penjaga silang-rekening
0272  posting policy                 EVOLVE ledger_account.requires_bank_account
```

`bank_alias` **tidak dibuat**. Brief §3 minta pilihan yang dibenarkan data, dan
datanya satu baris: `"Bank BCA"` → `"BCA"`, yang sudah ditangani
`normalize_bank()` (`supplier_banks.rs:151`, dipakai bersama oleh kedua master).
Begitu institusinya jadi baris yang **dipilih**, sumbu ejaan hilang bukan karena
di-normalisasi lebih keras, tapi karena tak ada lagi yang mengetik nama bank.
`"PT Bank Central Asia"` tak pernah jadi bank kedua kalau orang memilih dari
picker, bukan mengisi teks.

Enam institusi diseed — BCA, MANDIRI, BRI, BNI, BTN, DANAMON — bukan dari COA,
melainkan dari **keputusan pemilik 13 Sep** yang tertulis di `docs/finance-menu.md`
baris 231: *"master institusi — enam bank, bukan lima"*. Institusi adalah
kenyataan tentang bank mana yang kita pakai; **rekening** adalah fakta yang hanya
klien yang tahu, dan tak satu pun dibuat (§13).

## 7. Utang yang dicatat, bukan dikerjakan

- **`payment_destination` (0151) vs `supplier_bank_account` (0221).** Dua tabel
  untuk satu pertanyaan. 0151 yang tersambung ke mesin pembayaran dan punya
  enkripsi + verifikasi; 0221 yang punya layar supplier dan tak dirujuk siapa
  pun. Salah satu harus jadi kanon, dan itu keputusan lane payments + pemilik,
  bukan efek samping Phase 2.
- **`giro.bank` teks bebas** (0117) sementara 0222 memakai `bank_qualifier`.
  Giro dicetak dari sana; begitu `bank` ada, itu kandidat pertama untuk ditunjuk.
- **`acquirer` juga belum punya identitas** — teks di `acquirer_settlement`
  (0135), pola yang sama persis dengan bank. Di luar Phase 2 atas keputusan
  brief §16, tapi ia akan menagih hal yang sama.
- **`seed_bank()` harus diperbaiki** begitu statement wajib menyebut rekening:
  ia mengarang empat rekening koran toko.

---

# Hasil — apa yang dikerjakan, dan di mana brief tidak diikuti

Migrasi **0269–0272**, satu tabel baru (`bank`), nol model rekening kedua.

## Skema, sebelum → sesudah

| | sebelum | sesudah |
|---|---|---|
| institusi | teks di 5 kolom, diturunkan `UNION ALL` | tabel `bank`, 6 baris, `code` stabil |
| identitas rekening kita | `UNIQUE (ledger_account_code, site_id)` — satu rekening per binding GL | `UNIQUE (bank_id, account_no_digits)` — nomor di bank itu |
| "nomor mana yang dicetak" | dijawab constraint di atas, secara kebetulan | `ux_company_bank_account_primary` — sudah ada sejak 0223 |
| jenis rekening | `GIRO‖SAVINGS` | `+ TIME_DEPOSIT` (chart punya 4) |
| daur hidup | `retired_at` saja | `+ status ACTIVE‖DORMANT‖CLOSED`, dijaga `CHECK` agar sepakat dengan tanggalnya |
| rekening supplier | bank sebagai teks | `bank_id NOT NULL`, identitas `(supplier_id, bank_id, digits)` |
| statement | milik (GL, unit) | `+ bank_account_id`, FK **komposit** ke `(account_id, GL, site)` |
| dedup statement | `UNIQUE (GL, site, periode)` | `UNIQUE (bank_account_id, periode)` |
| jurnal | `supplier_id`, `asset_id` | `+ bank_account_id`, FK komposit yang sama |
| pencocokan | **hanya jumlah yang diperiksa** | trigger: GL+unit wajib sama, dan rekening nyata tak boleh beda |

Dipakai ulang: `company_bank_account`, `supplier_bank_account`, `bank_statement`,
`bank_statement_line`, `bank_line_match`, `bank_statement_source`,
`bank_statement_intake`, `bank_rule`, `store_bank_destination`. Baru: `bank`.

## Enam hal yang tidak mengikuti brief, dan alasannya

1. **Tak ada kolom `requires_bank_account`.** Brief §11 minta "ekstensi terkecil
   pada `ledger_account` / posting policy". Yang terkecil adalah **nol**:
   syaratnya sudah bisa diturunkan dari master rekening itu sendiri —

   | rekening terdaftar di (GL, unit) | perilaku |
   |---|---|
   | tak ada | posting jalan seperti sebelumnya |
   | satu yang ACTIVE | poster mengisinya sendiri |
   | dua atau lebih | **ditolak**, dan pesannya menyebut pilihannya |

   Flag akan jadi tempat kedua bagi fakta yang sama, dan harus dinyalakan tangan
   per environment — persis pelajaran Phase 1C. Cara ini menyala sendiri begitu
   rekening klien didaftarkan, dan tak bisa mematikan estate yang belum
   mendaftarkan apa pun. `OPENING` satu-satunya pengecualian.

2. **`kind` tetap `GIRO`, bukan `CURRENT`.** Giro ADALAH rekening lancar dalam
   bahasa Indonesia, itu kata klien sendiri, dan itu kata yang tercetak di
   `1011002 CASH IN BANK GIRO`. Menerjemahkannya ke istilah ERPNext akan
   membuang kata klien — yang sudah jadi prinsip berdiri sejak 0253.

3. **`closed_at` tidak ditambah.** `retired_at` sudah tanggal penutupannya;
   kolom kedua akan jadi dua jawaban. `status` ditambah karena tiga-arah
   ACTIVE/DORMANT/CLOSED tak bisa dibaca dari satu timestamp.

4. **`bank_statement.bank_account_id` bukan `NOT NULL`, melainkan
   `CHECK (… IS NOT NULL) NOT VALID`.** Enam dari delapan statement yang ada
   adalah karangan seed untuk toko (§2), dan §12 melarang mengarang rekening.
   `NOT VALID` menegakkan setiap baris **baru** dan membebaskan sejarah — jadi
   tak ada rekening dikarang, tak ada sejarah hilang, dan tak ada statement baru
   yang lolos tanpa rekening.

5. **Tak ada `bank_alias`.** Brief §3 minta pilihan yang dibenarkan data;
   datanya satu baris. `normalize_bank()` sudah melipat `Bank BCA`→`BCA`, dan
   begitu institusinya **dipilih** bukan diketik, sumbu ejaan hilang sama sekali.
   API sekarang **menolak** institusi tak dikenal alih-alih membuatnya.

6. **`owner_site_id` tidak dibuat.** `site_id` sudah ada dan sudah berarti itu.
   Aturan "hanya HO" ditegakkan di Rust, **bukan** sebagai `CHECK site_id = 'dc'`:
   konstanta kantor pusat sedang berpindah (0256 dipegang lane lain) dan CHECK
   berisi `'dc'` akan pecah saat rename itu mendarat.

Yang diikuti apa adanya: tiga konsep dipisah (§2), rekening supplier **tidak**
dilebur dan **tidak** menunjuk rekening kita (§7), dua rekening nyata boleh
berbagi satu GL (§6), statement milik tepat satu rekening (§8), `DEPOSIT` tidak
dipakai untuk deposito berjangka (§10), dan **tak ada** akun kliring transfer
yang dikarang (§9).

## Transfer, dan yang belum perlu

`cash_document` sudah punya `from_*`/`to_*`, jadi transfer antar rekening kita
adalah dua baris jurnal, dan **masing-masing membawa `bank_account_id`-nya
sendiri** lewat resolusi di atas — diuji (`a_transfer_keeps_both_ends`).

`from_bank_account_id`/`to_bank_account_id` pada `cash_document` **tidak**
ditambah: belum ada layar yang bisa mengisinya, dan kolom tanpa pembaca adalah
kesalahan 0243. Ia baru dibutuhkan pada hari satu GL di satu unit punya DUA
rekening aktif — dan pada hari itu posting-nya ditolak dengan pesan yang menyebut
pilihannya, bukan diam.

## Hasil tes

```
bank_identity_integration      12 / 12  hijau  (12 yang diminta brief §15)
posting_policy_integration     12 / 12  hijau
posting_policy_coverage         3 /  3  hijau
migration_hygiene · route_catalog · kernel_purity   hijau
rantai migrasi                220 berkas dari DB kosong, hijau
frontend-hub tsc                9 error — sama dengan baseline, tak satu pun soal bank
institusi sesudah rantai        6
rekening dibuat oleh migrasi    0   (tak ada yang dikarang)
```

**Merah yang memang sudah merah sebelum Phase 2** — dibuktikan: baris yang gagal
identik dengan HEAD, dan diff saya di berkas-berkas itu hanya penambahan.

| suite | sebab, dan itu bukan bank |
|---|---|
| `acquirer_integration` 10/12 | fixture menulis `site_id` pada `ledger_account`; 0244 melarangnya |
| `integrity_integration` 12/12 | idem |
| `transaction_category_integration` 15/15 | idem |
| `giro_integration` 6/11 | idem |
| `asset_banking_integration` 14/14 | fixture memakai site `ho`, yang rantai ini belum punya (0256 dipegang) |
| `finance_integration` 22/24 | gagal di `map inventory`, sebelum apa pun yang bank |

Empat fixture pertama itu satu perbaikan yang sama (buang `site_id` dari
`INSERT INTO ledger_account`), dan itu pekerjaan reconciliation tersendiri —
bukan efek samping Phase 2.

## Pertanyaan data klien yang masih terbuka

1. **Berapa rekening nyata, di bank mana, nomor berapa.** Chart menyebut enam
   bank pada 14 akun (`1011002` ×5, `1011003` ×5, `1011004` ×4). Itu jenis saldo
   yang boleh ada, **bukan** bukti rekeningnya aktif. Nol rekening dibuat.
2. **Apakah ada GL yang punya dua rekening nyata.** Kalau ada, hari itu juga
   posting otomatisnya minta disebutkan — dan `cash_document` perlu dua kolom
   yang §Transfer di atas sengaja tunda.
3. **Time deposit**: empat akun ada, `TIME_DEPOSIT` sudah bisa dinyatakan, tapi
   tanggal jatuh tempo belum punya tempat. Ditunda sampai ada aliran nyata (§10
   brief: jangan bangun modul treasury).
