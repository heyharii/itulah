# Kernel kontrol posting — apa yang dibangun, dan apa yang sengaja belum

**Tanggal:** 16 September 2026. Migrasi **0261** · **0262** · **0263** · **0264**, validator
`ledger::validate_account_posting`, skrip `scripts/seed-posting-profile.py`.

---

## 1. Mengapa ini murah, dan mengapa itu penting

`poster::post` adalah **satu-satunya penulis jurnal di seluruh estate**. Nol
`INSERT INTO journal_entry` dan nol `INSERT INTO journal_line` di luar
`poster.rs`; 24 pemanggil, tak satu pun bisa memilih jalan lain. Jadi cek yang
diletakkan di dalamnya tak bisa dilewati, dan tak ada "penegakan di setiap modul"
yang harus dijaga tetap sepakat.

ERPNext tidak punya properti ini: `make_gl_entries` dipanggil sepuluh composer,
dan `Payment Ledger Entry` disinkronkan terpisah dengan dua laporan khusus untuk
mencari selisihnya. Di sini kita lebih baik dan tidak boleh menirunya.

## 2. Empat dari enam kolom sudah ada, dan nol kode membacanya

0243 menambahkan `dimension`, `requires_counter_site` (dulu
`requires_counterparty`), `normal_balance`, `is_contra`. Grep di `src/`:
`requires_counter_site` nol, `is_contra` nol, `normal_balance` satu hit dan itu
`allotments::normal_balance_tx` — kuantitas pool, bernama sama, tak berhubungan.
Empat kolom kebijakan di skema, tak satu pun ditegakkan.

Jadi 0261 menambahkan **dua**, bukan enam, dan validatornya membaca keenamnya.

| kebijakan | kolom | dari |
|---|---|---|
| heading tak bisa diposting | `is_group` | 0050, sudah ditegakkan `assert_postable` |
| akun mati | `is_active` | 0050, sudah ditegakkan `assert_postable` |
| unit wajib | `dimension` | 0243 — dan **otomatis terjamin**: `journal_line.site_id` NOT NULL |
| akun perusahaan | `dimension = 'company'` | 0243 → ditegakkan 0261 |
| unit lawan wajib | `requires_counter_site` | 0243 → ditegakkan 0261, dinamai ulang 0262 |
| arah saldo | `normal_balance` | 0243 → **sengaja tidak ditegakkan**, §5 |
| siapa boleh memposting | `posting_mode` | **0261** |
| jurnal tangan | `manual_je_policy` | **0261** |
| tak ada jalur sama sekali | `posting_mode = 'BLOCKED'` | **0263** |
| dokumen mana | `account_source_rule` (ALLOW/DENY) | **0261** |

## 3. Rollout-nya diam secara konstruksi

Default `MANUAL` / `YES`, dan `account_source_rule` tanpa baris berarti **tak
dibatasi**. Jadi 0261–0264 tidak mengubah perilaku apa pun sampai ada yang
diseed. Itu bukan mode bayangan — tak ada jalur kode kedua yang bisa berselisih,
hanya baris yang belum mengikat. Akun yang belum diseed menolak apa pun.

Dua arah pada tabel aturan, karena kasus nyata pertama butuh yang sempit: satu
baris **DENY** menolak SATU kind dan membiarkan akunnya tetap terpakai — itu yang
Reserve Replacement OE butuhkan, di mana penarikannya disetujui dan pembentukannya
belum. Sehimpunan **ALLOW** berarti "ini saja". DENY diperiksa lebih dulu.

## 3b. Tujuh akun postable yang belum diputuskan — lalu diputuskan (0267)

Sesudah jembatan semantik diperbaiki (§3c) dan empat akun afiliasi dipulihkan
(0264), chart punya **185 akun postable** dan **178 di antaranya berkebijakan**.
Tujuh masih pada default permisif `MANUAL` / `YES`. (0265 menambah satu akun
postable lagi — `2012101006 Hutang Pajak PPh Pasal 29` — sehingga angka akhirnya
**186 postable**.)

Permisif boleh saat migrasi dan **bukan keadaan akhir**. Ketujuhnya bukan
kelalaian seed: workbook memberi tiap satu `Hierarki — cek posting aktual`
**tanpa kode target** — itu sheet-nya sendiri yang berkata seseorang harus
memeriksa. `scripts/seed-posting-profile.py` kini mencetak query yang menamai
mereka setiap run, supaya tak pernah diam.

| akun | nama | usul kategori | mengapa, dan apa yang ditunggu |
|---|---|---|---|
| `1011302003` | Prepaid - PPh Pasal 29 | **legacy-but-required** | Klien memegangnya; desain 162 **tak punya** prepaid PPh 29 (hanya 21, 25, PBB, lain-lain). Sisi utangnya juga tak ada — lihat `2103006` di §3c. Kebijakannya ikut modul pajak (Phase 4B). |
| `3013001001` | Modal Setor | **governed by COA-162** | Padanannya `3101001 Modal Setor`, status `Bersyarat`. Ekuitas: tak ada mesin, dan `principal` adalah Phase 5. |
| `3013001003` | Laba (Rugi) bulan berjalan | **system-only** | Hanya tutup buku yang boleh menulisnya. Desain 162 hanya punya `3101002 Laba Ditahan`, bukan laba bulan berjalan — jadi perlu diputuskan apakah akun ini tetap atau dilebur. |
| `3013001004` | Prive | **governed by COA-162** | Padanannya `3101003 Prive`, `Bersyarat`. Transaksi pemilik ⇒ Phase 5. |
| `6010310018` | Tools (Peralatan) Expenses | **governed by COA-162** | Beban operasional biasa; jembatan tak menjangkaunya karena workbook tak memberi target. Kandidat paling mudah diputuskan dari ketujuh ini. |
| `7010216002` | Biaya Amortisasi Biaya Pre Opening | **migration-only** | Pre Opening tak punya mesin dan kontranya (`1202892`) tak ada di chart kita. Sampai ada, hanya saldo awal yang menyentuhnya. |
| `8010110007` | Pendapatan (Biaya) Lain-Lain | **governed by COA-162** | Tempat jatuh empat arti (`bad_debt_expense`, `other_income_expense`, `asset_disposal_result`, `cash_variance`). `MANUAL`/`YES` mungkin memang jawabannya, tapi harus dinyatakan, bukan diwarisi dari default. |

Tak satu pun saya putuskan. Pemilik yang memutuskan, dan **0267** menuliskannya:

| akun | putusan | bentuknya |
|---|---|---|
| `1011302003` Prepaid PPh 29 | migration-only | `AUTO_ONLY` / `NO`, allow-list `OPENING` saja — prepayment-nya ikut pindah dan tidak boleh bertambah |
| `3013001001` Modal Setor | manual berpersetujuan | `MANUAL` / `OVERRIDE` |
| `3013001003` Laba bulan berjalan | hanya sistem | `AUTO_ONLY` / `NO` — hanya tutup buku yang menulisnya |
| `3013001004` Prive | manual berpersetujuan | `MANUAL` / `OVERRIDE` |
| `6010310018` Tools (Peralatan) | beban biasa | `SEMI_AUTO` / `YES` |
| `7010216002` Amortisasi Pre Opening | migration-only | `AUTO_ONLY` / `NO`, allow-list `OPENING` + `AMORTIZATION_RUN` |
| `8010110007` Pendapatan (Biaya) Lain-Lain | manual berpersetujuan | `MANUAL` / `OVERRIDE` — jawabannya memang permisif, tapi kini **dinyatakan**, bukan diwarisi |

Tiga di antaranya berakhir `MANUAL` / `OVERRIDE`, dan itu persis alasan §7 butuh
kolom terpisah: nilai kebijakannya sendiri tak bisa membedakan "diputuskan
begitu" dari "tak pernah disentuh".

## 3c. Enam "akun baru" yang ternyata sudah ada

Asumsi "tak ada target di sheet mapping = akun baru" salah, dan diperiksa ulang
terhadap ekspor klien akun per akun:

| COA-162 | keluarga legacy klien | akun kita | pemetaan semula | pemetaan semestinya | perlu akun baru? |
|---|---|---|---|---|---|
| `1105101` Prepaid PPh 21 | `1011302001` (satu dari enam daun prepaid pajak) | **`1011302001` ADA** | tak ada | `1011302001` | **tidak** |
| `1202691` Reserve Replacement OE | `1021607*` — **36 daun** di ekspor | **`1021607001` ADA** | tak ada | `1021607001` | **tidak** |
| `1202901` CIP | `1031803001` | **`1031803001` ADA** | tak ada | `1031803001` | **tidak** |
| `2105003` Hutang Lain-lain Principal | `2012303*` — 14 unit | **`2012303001` ADA** | tak ada | `2012303001` | **tidak** |
| `7103001` Biaya Replacement OE | `7010215*` — **36 daun** | **`7010215001` ADA** | tak ada | `7010215001` | **tidak** |
| `2103006` Hutang PPh Badan / PPh 29 | `2012101*` punya PPh 21, 23, VAT keluaran, PBB, PPh 25 — **tak ada PPh 29** | — | tak ada | — | **YA** |

Lima dari enam ada di chart kita; yang gagal adalah sheet `Mapping Legacy`
workbook, bukan chart kita. Jembatan seed kini memakai **tabel semantik
eksplisit** (`SEMANTIC_BRIDGE` di skripnya, satu komentar bukti per baris) di
atas penelusuran sheet — sehingga **161 dari 162** kode kini sampai.

`2103006` satu-satunya yang benar-benar butuh akun baru: klien memegang
`1011302003 Prepaid - PPh Pasal 29` di sisi aset tapi tak punya tempat untuk
mengutangnya. Dilaporkan, tidak dikarang.

## 4. Gate F — referensi bertipe tetap urusan terpisah

`counter_site_id` berarti **unit lawan**, titik. 0262 menamai ulang kolomnya
supaya tak seorang pun menaruh supplier, pegawai, principal, acquirer atau
settlement batch di situ — itu jenis kesalahan yang namanya sendiri mengundang.

Yang **sudah** bisa ditegakkan hari ini karena `journal_line` memang membawanya:

| referensi | kolom | keadaan |
|---|---|---|
| unit | `site_id` | NOT NULL, terjamin struktur |
| unit lawan | `counter_site_id` | ditegakkan `requires_counter_site` |
| supplier | `supplier_id` | **ada di baris, belum ada benderanya** |
| aset | `asset_id` | **ada di baris, belum ada benderanya** |

Dua yang terakhir adalah pekerjaan kecil dan bisa dilakukan tanpa master baru:
dua kolom boolean (`requires_supplier`, `requires_asset`) dan dua cabang di
validator yang sudah ada. Tidak dilakukan di Phase 1 karena tak ada yang
memintanya lagi, dan sebuah bendera yang tak dibaca adalah kesalahan 0243.

Yang **belum bisa** dan cara semestinya nanti, tanpa mengarang master sekarang:

| referensi | butuh | bentuk yang disarankan |
|---|---|---|
| Bank Account | `bank_account` (Phase 3) | `journal_line.bank_account_id`, bendera per akun |
| Acquirer | master acquirer (belum ada; kini teks di `acquirer_settlement`) | idem |
| Settlement Batch | `acquirer_settlement` **sudah ada** | bisa lebih awal dari yang lain |
| Asset | `fixed_asset` **sudah ada** | hanya perlu bendera, lihat di atas |
| Tax Period | `tax_period` (Phase 4B) | |
| Principal | `principal` (Phase 5) | |
| Advance | `advance` non-PO (Phase 4C); `supplier_advance` sudah ada | |
| Prepaid Schedule | `prepaid_schedule` (Phase 4A) | |
| Financing Facility | `financing_facility` (Phase 6, bersyarat) | |
| Project (CIP) | referensi, bukan dimensi | satu kolom `project_ref` di baris sumber |

**Pola yang disarankan, dan alasannya:** satu kolom bertipe di `journal_line`
per referensi yang benar-benar dibutuhkan, plus satu boolean di `ledger_account`
yang mewajibkannya — bukan tabel `account_required_reference` generik dengan enum
`reference_type`. Tabel generik terbaca seperti perlindungan dan bukan: separuh
`reference_type` yang diusulkan menunjuk tabel yang belum ada, jadi barisnya tak
bisa divalidasi terhadap apa pun. Kolom bertipe punya foreign key; enum dalam
tabel aturan tidak.

## 5. Yang sengaja tidak ditegakkan

**`normal_balance`.** Ia membatasi saldo **hasil**, jadi menegakkannya berarti
menjumlah akun di dalam transaksi posting, per baris. ERPNext memang begitu dan
memberi pemanggil `adv_adj` untuk melewatinya; kita akan membayar itu pada setiap
penjualan setiap hari. Itu milik pemeriksa yang berjalan atas buku — `integrity`
sudah punya tempatnya — bukan jalur panas.

**`account_source_rule` hampir kosong.** 43 frasa `Source Document` di workbook, 17
di antaranya menunggu keputusan karena mesinnya belum ada. Tabel lengkapnya di
[`finance-source-kind-mapping.md`](./finance-source-kind-mapping.md). Frasa yang
sudah jelas bisa diseed kapan pun.

**Pembentukan Reserve Replacement OE.** Pemilik memutuskan sisi pembentukannya
tetap mati sampai ada kebijakan, sementara penarikannya diketahui. Keduanya
terpisah oleh `source_kind` — pembentukan `ASSET_RESERVE` di
`postgres::reserves`, penarikan `SUPPLIER_INVOICE` di `postgres::payables:1251` —
jadi bloknya satu baris allow-list, dituliskan lengkap di komentar 0263 dan
**tidak disisipkan**, karena ia keputusan kebijakan.

Perhatikan satu hal: akun yang workbook tandai `RESTRICTED`/`PENDING POLICY`
adalah `1202691`, dan workbook menganggapnya **akun baru** — tak ada baris legacy
menargetkannya. Padahal chart kita sudah punya padanannya di kode klien,
`1021607001`. Jadi kebijakan itu tak bisa menyeberang lewat jembatan, dan baris
allow-list di atas adalah satu-satunya jalan ke sana.

## 6. Gate G — lifecycle tetap di peta jalan

`BLOCKED` (0263) **bukan** pengganti lifecycle. Ia satu nilai pada kolom yang
sudah ada, ditambahkan karena validator membutuhkannya sekarang, dan ia menjawab
satu pertanyaan saja: apakah ada yang boleh memposting.

Yang masih dibutuhkan, dan masih belum ada tempatnya:

```
ACTIVE          dipakai, boleh diposting
DORMANT         sah pada prinsipnya, tak terpakai sekarang — jangan dihapus
RETIRED         tak akan dipakai lagi; migrasi akhir hanya memverifikasi saldo nol
PENDING_POLICY  kebijakannya belum diputuskan  ->  ditegakkan sebagai BLOCKED
```

`is_active` tidak cukup: ia deklarasi **klien** tentang chart mereka, bukan sikap
**kita** tentang operasinya. Sebuah akun bisa hidup di buku mereka dan belum
diputuskan di kita.

Kandidat yang sudah diketahui saat dokumen ini ditulis:

- **`204001 Giro Keluar` → `RETIRED`.** Klien mengonfirmasi tak pernah dipakai.
  Jangan dimasukkan ke pilihan posting baru, jangan dibuat akun pengganti, dan
  migrasi akhirnya cukup memverifikasi saldo nol. **Kalau trial balance akhir
  ternyata punya saldo di sana, berhenti dan laporkan** — jangan dimigrasikan
  diam-diam.
- Kandidat `DORMANT`: Time Deposit (3 akun), Bank Loan, Management Fee, Uang Muka
  Penjualan, Piutang Kepala Toko, Piutang Manajemen. Sah pada prinsipnya, tak
  terpakai sekarang. **Jangan dihapus** hanya karena saldonya nol, kecuali
  kebijakan menyatakan retired.
- **`1202691` / `1021607001` Reserve Replacement OE → `PENDING_POLICY`.**

Lifecycle tidak ditambahkan di Phase 1 karena tak ada yang akan membacanya —
yang persis kesalahan 0243, empat kolom yang duduk tak terpakai. Ia mendarat
bersama hal yang bertindak atasnya.

## 7. Phase 1C — kebijakan tak lagi bergantung pada langkah seed

Sampai 0267, hanya **tujuh** akun mendapat kebijakannya dari migrasi. 179 sisanya
mendapatnya dari `scripts/seed-posting-profile.py` — satu langkah manual, per
environment, dengan spreadsheet di tangan. Artinya database yang baru dimigrasi
menjalankan 179 akun postable pada default permisif, tanpa apa pun yang
mengatakannya. Kebijakan akuntansi produksi tidak boleh punya bentuk itu.

**0268** memindahkan hasil yang sudah ditinjau ke dalam rantai:

- 179 UPDATE dalam **lima kelompok** `(posting_mode, manual_je_policy)`, hanya
  berisi kode yang benar-benar ada di chart. Isinya **bukan penurunan kedua**
  dari jembatan workbook — ia keadaan database yang diamati setelah skrip
  dijalankan, dibaca balik lalu ditinjau per kelompok. Migrasinya sengaja **tak
  bisa** membaca workbook: deployment yang butuh spreadsheet adalah deployment
  yang bisa gagal karena sebab di luar database, dan rantai yang sama akan
  menghasilkan kebijakan berbeda tergantung salinan file mana yang terpegang.
- Tujuh akun 0267 **dikecualikan by name**. Keputusan pemilik lebih baru dari
  workbook, dan untuk tiga di antaranya jawaban workbook justru default permisif.
  Pernyataan yang dibangkitkan tidak boleh melebarkan keputusan yang dibuat
  dengan sengaja.
- Baris **DENY `ASSET_RESERVE` pada `1021607001`** ikut pindah ke migrasi. Ia
  dulu hidup di skrip, yang berarti database yang melewatkan skrip punya reserve
  terbuka lebar pada jalur yang justru belum diputuskan pemilik.
- Kolom baru **`posting_policy_configured boolean NOT NULL DEFAULT false`**,
  di-set `true` untuk 186 akun — 179 dari kelompok di atas, tujuh dari 0267,
  dinamai terpisah. Kolom terpisah karena `MANUAL` / `YES` adalah **default kolom
  sekaligus jawaban sah**: tiga akun memakainya atas keputusan pemilik. Nilai
  kebijakan sendiri tak bisa membedakan keduanya.
- Headings tak diberi penanda. `journal_line` mengunci `is_group = false` lewat
  foreign key komposit, jadi tak ada yang bisa memposting ke group.

`backend/tests/posting_policy_coverage.rs` menjaganya dengan `#[sqlx::test]` —
database baru, rantai penuh, tanpa seed apa pun:

1. nol akun postable dengan `posting_policy_configured = false`, dan kalau ada,
   pesannya **menamai akunnya** beserta kebijakan yang sedang ia duduki;
2. nol heading yang ikut tertandai (penjaga terhadap `UPDATE … WHERE NOT
   is_group` yang menyapu rata dan membuat gate pertama tak berarti);
3. DENY reserve ada, dan akunnya **bukan** `BLOCKED`.

Jadi migrasi masa depan yang menambah akun postable harus memutuskan
kebijakannya di perubahan yang sama. Dibuktikan: satu akun postable disisipkan
ke database hasil rantai, dan query gate langsung menemukannya
(`6010310777 (MANUAL/YES) configured=false`).

### Skrip seed berubah jadi alat audit

`scripts/seed-posting-profile.py` **tidak lagi menulis apa pun** — tak ada flag
yang membuatnya menulis, karena menambahkannya berarti membuka kembali lubang
yang sama. Sekarang ia membaca workbook, membaca database lewat `psql`, dan
mencetak selisihnya:

```
python3 scripts/seed-posting-profile.py --xlsx <workbook> --database <db> [--strict]
```

Terhadap database rantai-saja hari ini: **186 postable, workbook menjangkau 179,
tujuh sisanya keputusan pemilik, 227 kode workbook tak cocok dengan baris mana
pun, nol drift, nol akun tanpa keputusan.** `--strict` keluar non-nol saat drift,
supaya pemeriksaan terjadwal bisa melihat keduanya berpisah tanpa ada yang
menengok. Keputusan pemilik (0267) ditandai di laporan dan tidak pernah dihitung
sebagai kegagalan.

Kalau workbook berubah: jalankan, baca drift-nya, lalu tulis **migrasi baru**
dalam bentuk yang 0268 pakai. Rantai tetap satu-satunya yang menentukan apa yang
dipercaya produksi.
