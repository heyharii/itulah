# GA: brief implementasi penuh (frontend-hub + backend + testing)

Untuk agent yang mengerjakan. Laporkan dalam Bahasa Indonesia. Kerjakan semua tahap (§15) berurutan sampai selesai. Setiap akhir tahap adalah **titik cek**, bukan jeda: tulis laporan tahap (§18) ke `runs/ga-build/<tanggal>/STAGE-<n>.md`, pastikan semua cek hijau, lalu lanjut. Berhenti hanya untuk hal di §0.7.

**Jangan mengarang arsitektur.** Kalau sesuatu tidak tertulis di sini dan tidak bisa dijawab dari kode, catat sebagai pertanyaan terbuka lalu lanjutkan bagian lain.

---

## 0. Kondisi repo dan cara kerja

Tidak ada agent lain yang sedang bekerja. Tetapi working tree berisi ±440 file yang berubah dan belum di-commit (pekerjaan sebelumnya, termasuk migrasi 0350–0355). **Anggap semua itu pekerjaan pemilik yang sah.**

1. Sebelum mulai: jalankan `git status`, `git log --oneline -15`, dan `ls backend/migrations/postgres | tail`. Baca migrasi terbaru dan diff di file yang akan kamu sentuh.
2. **Jangan me-revert, memformat ulang, atau me-rename** perubahan yang sudah ada. Sentuh hanya yang perlu untuk GA; di file bersama (misalnya `postgres/payables.rs`, `http/finance.rs`), buat perubahan sesempit mungkin.
3. **Nomor migrasi:** lanjutkan dari nomor terakhir. Jangan pernah mengubah migrasi yang sudah ada.
4. **Sinkron tipe backend → frontend:** setiap kali struct Rust yang diserialisasi berubah, jalankan `make contract` dari root. Perintah ini meregenerasi `frontend-contract/src/contract/`, jadi jangan edit file hasilnya dengan tangan. Frontend hanya memakai tipe dari `@itulah/contract`.
5. **Commit per tahap** hanya berisi file yang kamu ubah untuk GA (`git add` per path, jangan `git add -A`), supaya perubahan lama yang belum di-commit tidak ikut masuk. Jangan push.
6. Sebelum menyatakan selesai: ulangi langkah 1 dan pastikan tidak ada perubahan lama yang hilang.
7. **Kapan berhenti dan bertanya** (selain itu, jalan terus):
   - butuh akun COA baru atau keputusan akuntansi yang tidak tertulis di brief;
   - cek (§4.9) tetap merah setelah tiga kali mencoba memperbaiki, termasuk kalau merahnya berasal dari perubahan lama yang belum di-commit (laporkan, jangan diperbaiki diam-diam);
   - langkah yang merusak data atau tidak bisa dibalik.

   Hal kecil yang tidak tertulis: pilih opsi paling konservatif, catat di laporan tahap sebagai "asumsi", lalu lanjut.

## 1. Acuan

| File | Gunanya |
|---|---|
| `prototypes/ga-graph/index.html` | **Acuan utama UI dan data.** GA dan Finance dalam satu graph, menu pilihan B, 9 alur GA → Finance, 11 build aset, form dengan kartu pilihan. Buka langsung di browser. |
| `prototypes/ga/` (`GA-USE-CASES.md`, `schema.js`, `model.js`) | Prototype v2 sebelumnya: 51 use case dan temuan gap backend. Dipakai sebagai **checklist use case dan gap**. Kalau keputusannya bertentangan dengan brief ini, brief ini yang berlaku (lihat §2.4). |
| `FINANCE-COA-COVERAGE.md`, `FINANCE-ARCH-PLAN.md` | Model COA dan rencana Finance |
| `frontend-hub/SIDEBAR-BRIEF.md` | Aturan sidebar: `hidden`, sub-menu bukan tab, modul satu layar tidak mekar |
| `frontend-hub/src/screens/commercial/pricelist-editor.tsx` (±baris 360–430), `components/ui/form.tsx` (`Switch`, radio group) | **Pola UI kartu radio dan switch** yang harus diikuti |

## 2. Keputusan yang sudah dikunci

### 2.1 Prinsip
> Setiap domain memegang fakta bisnis yang dia hasilkan. Finance memegang sisi akuntansi dan kasnya. Domain terhubung lewat rujukan (FK) dan objek bersama, **bukan salinan**.

- **Objek yang lebih baru menunjuk objek yang lebih lama.** Kejadian menunjuk master; master tidak menyimpan array kebalikannya. Halaman "terkait" adalah query balik.
- **Finance menunjuk GA, GA tidak menunjuk Finance.** Angka Finance di layar GA hanya dibaca (read-only).
- **Menu adalah view atas graph.** Satu record bisa tampil di beberapa view tanpa tabel kedua.
- **GA tidak pernah memposting jurnal dan tidak memilih akun GL.** GA memberi klasifikasi (kelas aset, jenis kontrak, objek servis, kategori supplies), lalu `account_map` milik Finance menurunkannya menjadi akun.

### 2.2 Pemilik fakta
| Fakta | Pemilik | Disimpan di |
|---|---|---|
| Profil vendor, kontak, rekening | GA (rekening diverifikasi Finance) | `supplier`, `supplier_contact`, `bank_account` |
| Lokasi | GA | `site` + sub-lokasi |
| Identitas aset, lokasi, pemegang, kondisi, spesifikasi | GA | `fixed_asset` (+ `specs`) |
| Nilai kontrak legal, periode, status, tanda tangan | GA | `ga_contract` |
| Estimasi perbaikan, budget yang disetujui (+ siapa, kapan) | GA | `ga_repair` |
| Harga PO | Procurement | `purchase_order` |
| Tagihan aktual, akun, periode layanan, pajak | Finance | `supplier_invoice` + baris |
| Keputusan kapitalisasi, harga perolehan, nilai buku | Finance | `asset_capitalization` |
| Status bayar | Finance | payment / `payment_ledger_entry` |

### 2.3 Istilah
**Bill = Purchase Invoice (ERPNext) = tagihan vendor = `supplier_invoice`.** Di layar pakai "Tagihan vendor". AP adalah sisa hutang (`payment_ledger_entry`, akun 2004) dan hanya berisi tagihan yang sudah diposting.

### 2.4 Selisih dengan `prototypes/ga` (v2): yang berlaku adalah brief ini
| Topik | v2 | Diputuskan |
|---|---|---|
| Menu | 7 menu termasuk Fleet dan Workplace | **Pilihan B (§5).** Fleet = view Vehicles. Workplace dipecah jadi Locations dan Supplies. Utilities dan Cleaning = view kontrak. |
| Nilai kontrak | tidak dimodelkan | **Disimpan** sebagai `contract_value` (fakta GA). Nominal per bulan tetap milik `bill_template`. |
| GA mengajukan tagihan | ada ("Ajukan invoice" ke Inbox Finance) | **Diambil:** GA boleh membuat draft tagihan (status DRAFT, bukan AP) dari record-nya, dengan ID yang sama sampai diposting (§8.3). |
| Alokasi per baris tagihan | ada | **Diambil:** rujukan GA disimpan per baris, bukan hanya di header (§8.1). |
| Reservasi ruang, tamu, insiden, checklist cleaning, perjalanan kendaraan, log BBM | ada | **Backlog (§16)**, bukan scope tahap ini |

### 2.5 Lokasi dan HO
Migrasi 0353 menetapkan site `dc` berjenis `HO` (keputusan pemilik: DC bagian dari head office; rename `dc` → `ho` masih ditahan di 0256). Aturannya:
- **Jangan menambah site HO terpisah.** Location = tabel `site` yang ada.
- Kantor dan gudang dibedakan lewat sub-lokasi (gedung/area), bukan site baru.
- Prototype menampilkan HO dan DC terpisah hanya sebagai contoh data. Ikuti kode.

## 3. Keadaan kode (baca dan verifikasi dulu)

**Sudah ada, pakai ulang:**
- `frontend-hub/src/lib/navigation.ts`: domain GA saat ini `vendors, contracts, ga-assets, maintenance, letters`. `screens/contracts/nav.ts` dan `screens/maintenance/nav.ts` masih `soon: true`. Assets sudah dipecah menjadi Register · Software · Projects.
- `supplier` dengan `category`, `expense_account_code`, NPWP/PKP.
  - `/api/v1/suppliers/{id}/bank-accounts` dan `/contacts` (SUPERVISOR).
  - Rekening baru tersimpan `UNVERIFIED`; verifikasi lewat jalur pembayaran Finance.
  - `SupplierBankAccountsPanel` ada di `screens/procurement/suppliers.tsx`.
- `fixed_asset` (tanpa kolom uang) dan `asset_capitalization` (0070).
  - Baris tagihan membawa `asset_class_code`; saat diposting, aset DRAFT dibuat (0137).
  - Tautan ke baris tagihan: `acquired_via_line_id`. Laporan gap: `acquisition_gap`.
- **0355:** kelas aset sudah dipetakan ke akun di `account_map`. Verifikasi, jangan dibuat ulang.
- **0350–0352:** jeda posting ditegakkan di database. Map posting sudah menunjuk bagan akun client. Posting dari sumber Sales dan Inventory dibuka selektif; saklar global tetap mati.
- `bill_template` (0316) + `run_bill_template_agent`, di bawah `/api/v1/finance` (tulis = ADMIN).
- Prepaid schedule (`postgres/prepaid.rs`): akun harus di-map sebagai `prepaid_expense` di site itu.
- `payment_instruction` (0240): payment request dari toko.
- `payment_ledger_entry` (0144/0145).
- `document` + `document_link` ke `record_kind` (0075/0190); Library adalah indeksnya.
- `letter` sudah ada.
- `required_role` di `domain/auth.rs`: `/api/v1/finance/*` → baca SUPERVISOR, tulis ADMIN. `/api/v1/suppliers*` → SUPERVISOR.
- Registrasi aset dari GA sekarang lewat `POST /api/v1/finance/assets` (ADMIN), sehingga **GA tidak bisa mendaftarkan aset**. Perlu route GA.

**Gap yang sudah ditemukan** (dari `prototypes/ga/GA-USE-CASES.md` §"Temuan source repository"; verifikasi ulang):
- `RecordBillRequest` / `RecordBillLine` belum punya rujukan GA dan periode layanan.
- `BillTemplate` belum punya `contract_id`, frekuensi selain bulanan, `start`/`end`, maupun jeda.
- `bill_template_sweep`: `if due_day > clamp { continue; }` melewatkan tanggal 29–31 di bulan pendek, padahal komentarnya bilang di-clamp. **Bug: perbaiki dan tambahkan regression test.**
- Idempotensi sweep: lookup run → `record_bill` → insert run tidak dalam satu transaksi yang jelas. Audit dan uji ulang.
- Menyetujui payment request tidak membuat tagihan otomatis. Keputusan: persetujuan membuat DRAFT tagihan yang menunjuk request dan perbaikannya (§8.4).
- Duplikasi `supplier_id + invoice_number` sudah dicegah. Pastikan normalisasinya (spasi, huruf besar/kecil).

## 4. Batasan keras
1. Jangan menyalakan posting otomatis dan jangan membuka sumber posting baru. Tagihan GA tetap diposting manusia di Finance.
2. Jangan membuat akun COA baru. Akun yang dibutuhkan tapi belum ada dibiarkan tidak ter-map (`resolve_account` akan menolak dengan jelas), lalu dilaporkan. Contoh: Biaya Sewa Kendaraan, Uang Jaminan Sewa, Laba/Rugi Pelepasan Aset, Hutang Leasing.
3. "Laba (Rugi) bulan berjalan" tidak boleh bisa diposting.
4. Satu supplier master. Tidak ada tabel vendor GA.
5. Uang hanya lewat jalur yang sudah ada: tagihan → AP → payment, prepaid schedule, penyusutan, `bill_template`, payment request.
6. Layar GA tidak menampilkan harga perolehan atau nilai buku. Angka Finance lain (ditagih, biaya aktual, hutang) boleh tampil read-only dengan penanda "Finance".
7. Record yang sudah dirujuk tagihan atau jurnal **tidak boleh dihapus**; hanya bisa diarsipkan atau dinonaktifkan.
8. Konvensi repo:
   - satu registry nav;
   - `moved` untuk path lama, `hidden` untuk view tanpa baris sidebar;
   - komentar `///` yang menjelaskan KENAPA;
   - migrasi bernomor dengan nama berupa kalimat;
   - tidak ada ukuran font px mentah.
9. Wajib bersih: `npm run typecheck`, `npm run lint`, `npm run design-lint`, `npm run endpoint-audit` (di `frontend-hub`), `cargo test` (di `backend`), `make contract` tanpa diff yang tertinggal.

## 5. Menu GA (pilihan B, 17 item)
```
GA
  Overview        /ga
  Vendors         /vendors
  Locations       /locations
  Assets          Register /assets · Software /assets/software · Projects /assets/projects
                  view tersembunyi (hidden, bisa lewat ⌘K dan chip di Register):
                  /assets/property · /assets/technical · /assets/vehicles · /assets/ffe ·
                  /assets/it · /assets/audio · /assets/oe
  Contracts       base /contracts: Sewa · Jasa · Asuransi · Izin · Langganan · Disewakan
                  view tersembunyi: /contracts/utilities (= Langganan per lokasi) · /contracts/cleaning
  Maintenance     Perbaikan /maintenance · Jadwal & inspeksi /maintenance/schedule · Replacement /maintenance/replacements
  Supplies        /supplies
  Letters         /letters
```
- Saat view tersembunyi dibuka, baris induknya tetap menyala: `/assets/*` → Register; `/contracts/utilities` → Langganan; `/contracts/cleaning` → Jasa.
- Discussions, Chat dan Library tetap di strip ikon.
- Modul yang belum siap memakai `soon: true`. Tidak boleh ada layar kosong.

## 6. Registry objek (skema)

Semua tabel GA memakai `created_by/at`, `updated_by/at`, dan `version` (pola yang sudah ada). Setiap objek juga punya `record_kind` supaya bisa diberi file, komentar dan riwayat. Nama tabel di bawah adalah usulan; kalau kode sudah punya padanannya, pakai yang ada dan laporkan.

| Objek | Tabel | Field utama | FK / kardinalitas | Status |
|---|---|---|---|---|
| Supplier | `supplier` (ada) | — | kontak N, rekening N | ACTIVE / INACTIVE |
| Location | `site` (ada) + `ga_location_detail` 1:1 | alamat, tipe, luas, kontak darurat, sub-lokasi (teks atau tabel `ga_area`) | — | — |
| Asset | `fixed_asset` (ada) | + `specs jsonb` (divalidasi per build di Rust), `holder`, `condition`, `sub_location` | 1 site saat ini; N dokumen, N perbaikan, N kontrak (lewat kontrak) | DRAFT → ACTIVE → (DISPOSAL_REQUESTED → DISPOSED) \| REPLACED |
| Contract | `ga_contract` | `contract_type` (17, §9.2), `objek` (hanya JASA_MAINTENANCE), `supplier_id` atau `counterparty_name`, `site_id`, `asset_id`?, `start`, `end`?, `contract_value`?, `is_signed`, `signed_by`, `customer_number`?, `reminder_days`, `notes` | 1 pihak, 1 site (atau cakupan: `site_scope` ALL_STORES/ALL_SITES), 0..1 aset | DRAFT → ACTIVE → EXPIRING (dihitung) → EXPIRED / TERMINATED |
| Maintenance task | `ga_maintenance_task` | `asset_id` atau `site_id`, judul, interval (hari/bulan/km), `next_due`, `contract_id`?, `supplier_id`? | — | ACTIVE / PAUSED |
| Inspection | `ga_inspection` | `asset_id`, tanggal, oleh, hasil BAIK/PERHATIAN/RUSAK, temuan, `task_id`? | bisa melahirkan 1 perbaikan | — |
| Repair | `ga_repair` | `site_id` **wajib**, `asset_id`?, `objek` (diturunkan dari kelas aset kalau ada), judul, `supplier_id`, `contract_id`?, `task_id`?, `inspection_id`?, `estimated_cost`?, `approved_budget`? + `approved_by` + `approved_at` (wajib bertiga), `failure_at`, `completed_at` | biaya aktual = Σ baris tagihan POSTED | OPEN → APPROVED → IN_PROGRESS → COMPLETED → CLOSED (+ CANCELLED) |
| Replacement | `ga_replacement` | `old_asset_id`, `new_asset_id`?, `repair_id`?, alasan, `supplier_id`? | 1 aset lama, 0..1 aset baru | PROPOSED → APPROVED → PURCHASED → INSTALLED → CLOSED |
| Disposal | `ga_disposal` | `asset_id`, cara (SOLD/SCRAPPED/DONATED/LOST), `proceeds`?, alasan | 1 aset | REQUESTED → APPROVED → POSTED (oleh Finance) / REJECTED |
| Asset event | `ga_asset_event` | `asset_id`, jenis (TRANSFER/ASSIGN/NOTE), asal → tujuan, pemegang, alasan | append-only | — |
| Document | `document` (ada) + tambahan `doc_type`, `doc_number`, `issuer`, `issued_on`, `expires_on` | `document_link` ke record | — |
| Meter reading | `ga_meter_reading` | `contract_id` (Langganan), periode, awal/akhir, pemakaian, satuan | N per kontrak | — |
| Supply request | `ga_supply_request` | `site_id`, peminta, kategori (§9.4), barang, qty, dibutuhkan, estimasi, `po_id`? | — | REQUESTED → APPROVED → ORDERED → RECEIVED → BILLED (+ REJECTED) |
| Letter | `letter` (ada) | + `related_kind`, `related_id` | — | ada |

Aturan dokumen vs kontrak Izin:
- **Ada pihak dan biayanya** (izin usaha, perpanjangan STNK, PBB, reklame, polis) → **kontrak** jenis Izin/Asuransi.
- **Hanya kertasnya** (BPKB, sertifikat laik operasi lift, garansi, SHM/SHGB) → **dokumen** dengan masa berlaku.
- STNK: kertasnya = dokumen, perpanjangannya = kontrak. Dokumen menunjuk kontrak lewat catatan.

## 7. Build aset

- **Build diturunkan dari kelas** (`asset_class.build`, kolom baru, di-seed). GA memilih build dulu, lalu kelas client di dalamnya. Build menentukan form, kelas menentukan akun.
- 11 build: LAND, BUILDING, TECH, VEHICLE, FFE, IT, AUDIO, OE, SOFTWARE, DEFERRED, CIP. Pemetaan kelas client → build ada di `CLASSES` pada `prototypes/ga-graph/index.html`.
- **Field khusus per build** disimpan di `fixed_asset.specs`, divalidasi skema Rust per build (lihat `BUILDS` di prototype):
  - VEHICLE: merek/model, plat, tahun, no. rangka, no. mesin, odometer. Plat unik untuk kendaraan aktif (expression index).
  - TECH: merek/model, kapasitas, tanggal pasang, garansi s/d.
  - IT: perangkat, merek/model, spesifikasi, hostname, garansi.
  - FFE: jenis, material, dimensi. AUDIO: merek/model, daya, garansi.
  - OE: material, ukuran, area toko, ditangani lewat replacement.
  - LAND: sertifikat, luas, hak berlaku s/d. BUILDING: luas, lantai, penggunaan.
  - SOFTWARE, DEFERRED, CIP: tanpa field fisik; cukup yang sudah ada.
- Route registrasi GA: `POST /api/v1/ga/assets` (SUPERVISOR). Menautkan ke baris tagihan tetap wewenang Finance saat menilai.

## 8. Serah terima ke Finance

### 8.1 Rujukan di baris tagihan
Tambahkan kolom opsional di baris `supplier_invoice`:
- `contract_id`, `repair_id`, `asset_id` (pembelian **atau** biaya aset, misalnya BBM atau servis), `replacement_id`, `supply_request_id`;
- `service_period_start`, `service_period_end`.

Header boleh menampilkan ringkasannya, tapi sumber kebenaran ada di baris. Satu tagihan bisa berisi beberapa baris untuk objek yang berbeda.

Setiap angka di GA (ditagih, biaya aktual) = Σ **baris POSTED** yang menunjuk record itu. Draft, tagihan yang ditahan, dan tagihan yang dikembalikan tidak dihitung. Tambahkan `contract_id` juga di `bill_template`.

### 8.2 Urutan usulan akun di baris
1. Baris membeli aset → kelas aset.
2. Merujuk perbaikan → objek perbaikan.
3. Merujuk kontrak, dengan "bayar dimuka" menyala → `prepaid_expense` (qualifier = jenis kontrak); kalau mati → beban jenis kontrak (JASA_MAINTENANCE mengikuti objeknya).
4. Merujuk supply request → kategori supplies.
5. Selain itu → akun default vendor.

Finance selalu boleh mengganti akun; kalau diganti, tandai `override`. Jadwal prepaid memakai **periode layanan baris itu**, bukan periode kontrak.

### 8.3 Draft dari GA (Inbox Finance)
- Dari record GA (kontrak, perbaikan, supply request, replacement) ada aksi **"Ajukan tagihan"**. Aksi ini membuat `supplier_invoice` berstatus DRAFT dengan `submitted_by_domain = 'GA'`, rujukan, nomor/tanggal tagihan vendor, dan scan.
- **Ini bukan AP.** Finance melihatnya di Inbox (filter DRAFT dari GA), lalu memeriksa, mengembalikan (dengan alasan), atau memposting. ID-nya sama sepanjang proses.
- Kalau tagihan diterima langsung oleh Finance, Finance membuat draft sendiri. GA tidak wajib jadi pintu masuk.

### 8.4 Lain-lain
- **Hold:** `on_hold`, `hold_reason`, `release_date` di tagihan. Payments dan daftar siap bayar menyaring tagihan yang ditahan.
- **Payment request disetujui** → otomatis membuat DRAFT tagihan yang menunjuk request (dan perbaikannya, kalau ada).
- **Enam peringatan sebelum posting** (peringatan, bukan blokir):
  1. nomor tagihan vendor ganda;
  2. melebihi sisa kontrak;
  3. melebihi budget/estimasi perbaikan;
  4. selisih dari tagihan rutin di luar toleransi;
  5. periode di luar masa kontrak;
  6. vendor di tagihan berbeda dengan pihak kontrak.
- Pengecekan rekening: tagihan untuk vendor dengan rekening `UNVERIFIED` tidak bisa dibayar. Rekening tanpa kanal (pajak daerah) dikecualikan.

## 9. Pemetaan akun (seed `account_map`, catatan "menunggu review Finance")

### 9.1 Kelas aset
Sudah ada di 0355. Verifikasi bahwa setiap kelas punya aset/akumulasi/beban sesuai tabel di prototype (`CLASSES`):
- 1061 Tanah: tidak disusutkan;
- 1062/1082/7003 HGB;
- 1063–1079 ↔ 1083–1099 ↔ 7007–7023;
- OE 1080/1100/7024;
- software 1104/1106/7025 dan 1105/1107/7027;
- Pre Opening 1111/1112/7026;
- CIP 1113.

### 9.2 Jenis kontrak (qualifier = `contract_type`)
| Jenis | prepaid_expense | contract_expense | contract_accrual | contract_income |
|---|---|---|---|---|
| SEWA_TANAH | 1037 | 7002 | — | — |
| SEWA_TOKO | 1038 | 7004 | 2025 | — |
| SEWA_RUMAH | 1039 | 7005 | 2026 | — |
| SEWA_KENDARAAN | 1041 | *(kosong: akun belum ada)* | — | — |
| JASA_MAINTENANCE | 1040 | ikut `repair_expense` objek | — | — |
| JASA_CLEANING | — | 6040 | — | — |
| ASURANSI_PROPERTI / _KENDARAAN | 1036 | 7029 / 7033 | — | — |
| IZIN_USAHA | 1043 | 6049 | — | — |
| IZIN_KENDARAAN | — | 6062 | — | — |
| PAJAK_PBB / PAJAK_REKLAME | — | 7030 / 7031 | — | — |
| LANGGANAN_LISTRIK / _AIR / _TELEKOM | — | 6045 / 6046 / 6044 | 2023 / 2024 / 2022 | — |
| DISEWAKAN_GEDUNG / _PERALATAN | — | — | — | 8005 / 8006 |

1049 (Prepaid PBB) jangan di-map sebagai prepaid; itu domain Tax.

### 9.3 Objek perbaikan (`repair_expense`)
FFE 6066 · SOFTWARE 6067 · KOMPUTER 6068 · BANGUNAN 6069 · STAFF_HOUSE 6070 · KENDARAAN 6071 · AC 6072 · POWER_PLANT 6073 · GENSET_BBM 6058 · CAT 6074 · LIFT 6075.

Objek diturunkan dari kelas aset (lihat `CLASSES[].objek` di prototype).

### 9.4 Kategori supplies (`supply_expense`)
ATK 6041 · Rumah tangga 6042 · Perlengkapan toko & kantor 6052 · Peralatan listrik 6054 · Tools 6057 · Telephone equipment 6059 · Perlengkapan mess 6063.

**Batas domain:** Customer Supplies (6004) milik Commercial; kantong belanja milik Inventory. Keduanya tidak boleh masuk kategori GA.

Gunakan key semantik yang sudah ada kalau ada padanannya (`prepaid_expense`, dan lainnya). Key baru hanya untuk yang belum ada.

## 10. Layar dan UI

### 10.1 Isi per menu (ikuti prototype)
- **Overview:** kontrak habis ≤ `reminder_days`, dokumen habis ≤ 90 hari, servis jatuh tempo ≤ 7 hari, perbaikan pending, replacement berjalan, supply request baru, aset draft. Setiap baris membuka record-nya.
- **Vendors:** tabel dengan panel rekening dan kontak (pakai ulang panel yang ada). Hub vendor: kontrak, aset yang dipasok, perbaikan, tagihan dan hutang (Finance).
- **Locations:** daftar site. Hub: aset, kontrak, langganan beserta pemakaian meter, perbaikan dan jadwal, supplies, dan tagihan bulan ini (site dibaca dari rujukan).
- **Assets › Register:** chip view berikon dengan jumlah; kolom Kode · Aset (ikon build) · Kelas + build · Site · Lokasi · Pemegang · Kondisi · Status GA · Status Finance.
  - Hub aset: aksi (Catat perbaikan · Catat inspeksi · Pindahkan · Ganti · Ajukan pelepasan), Detail, Detail build, Dokumen (masa berlaku), Kontrak, Maintenance, Riwayat (gabungan event, inspeksi, perbaikan, replacement, pelepasan), Status Finance (tanpa rupiah kecuali "biaya terkait"), akun kelas, dan file.
- **Contracts:** tabel per kelompok. Hub: detail, tagihan/penerimaan (Finance) dengan ditagih dan sisa, tagihan rutin (Finance), pemakaian meter (Langganan), akun yang diusulkan, file, dan aksi "Ajukan tagihan".
- **Maintenance:** Perbaikan (estimasi, budget, aktual dari Finance, penanda kalau lewat); Jadwal & inspeksi (dua tabel); Replacement (tahap dan akun).
- **Supplies:** tahap permintaan dan akun kategorinya.
- **Letters:** kolom rujukan menjadi tautan ke record.
- **Finance** (tambahan yang dibutuhkan alur): Inbox draft dari GA, hold, peringatan sebelum posting, dan acquisition gap. Pakai layar Finance yang aktif (cek `finance` / `finance-final` / `finance-lab-2`; laporkan mana yang dipakai). Jangan membuat modul Finance baru.

### 10.2 Aturan UI (wajib)
- Ikuti pola Marketing: **kartu radio besar** (`pricelist-editor.tsx`) dan **switch** (`components/ui/form.tsx`).
- **Ikon per build aset** di baris tabel, chip, kartu pilihan dan kepala sheet: LAND map · BUILDING building · TECH cpu · VEHICLE car · FFE armchair · IT monitor · AUDIO speaker · OE box · SOFTWARE app-window · DEFERRED clock · CIP hammer (lucide).
- Form memakai kartu pilihan untuk:
  - build aset (lalu field build tampil otomatis);
  - kelompok lalu jenis kontrak (kartu jenis menampilkan kode akun, misalnya `1038 → 7004`);
  - objek perbaikan (+ kode akun);
  - hasil inspeksi, cara pelepasan, kondisi aset.
- Switch untuk ya/tidak: sudah ditandatangani, bayar dimuka, buat perbaikan dari temuan.
- **Tidak ada teks bantuan kecil di bawah input.** Info tambahan (misalnya sumber usulan akun) jadi pill di kanan label. Error hanya tampil saat isian tidak valid, lalu hilang begitu field diedit.
- Angka milik Finance memakai penanda "Finance", record GA di layar Finance memakai penanda "GA".
- Semua ukuran lewat token dan skala yang ada. `design-lint` harus bersih.
- Tampilan harus tetap rapi di lebar 400px: tabel di-scroll di dalam wadahnya, sheet selebar layar.

## 11. Hak akses
- `/api/v1/ga/*` → SUPERVISOR (baca dan tulis). Tambahkan arm di `required_role` sebelum aturan GET umum, dengan test.
- Finance tetap: baca SUPERVISOR, tulis ADMIN.
- Menyetujui budget perbaikan, replacement dan pelepasan: SUPERVISOR yang **bukan** pembuatnya (maker ≠ checker, pola `counted_by <> verified_by`).
- Verifikasi rekening, posting, dan pembayaran: Finance.
- Toko hanya boleh membuat payment request dan supply request untuk site-nya sendiri.

## 12. Hapus dan arsip
- Record yang dirujuk tagihan, jurnal, atau record lain → hanya boleh diarsipkan atau dinonaktifkan.
- Riwayat aset, inspeksi, dan event bersifat append-only.
- Tagihan yang sudah diposting tidak bisa diubah; koreksinya lewat VOID atau credit note.

## 13. Kasus tepi (harus lolos test)
- Mess yang disewa → kontrak Sewa, bukan aset properti. Furnitur mess yang dimiliki → aset FFE Staff House.
- Satu kontrak mencakup banyak toko (`site_scope`). Tagihannya tampil di hub setiap toko hanya kalau barisnya ber-site toko itu.
- Perbaikan di lokasi tanpa aset (plafon bocor).
- Replacement tanpa perbaikan.
- Aset pindah site: penyusutan berikutnya ikut site baru.
- Tagihan tanggal 31 di bulan pendek (bug sweep).
- Tagihan rutin lewat toleransi → peringatan.
- Kontrak habis di tengah periode tagihan → peringatan periode.
- Rekening vendor baru belum diverifikasi → tidak bisa dibayar.
- Payment request ditolak → tidak ada tagihan.
- Uang muka ke vendor sebelum ada tagihan → pakai jalur advance yang sudah ada, jangan dibuat baru.
- Aset DRAFT dari tagihan lalu dilengkapi GA. Aset yang didaftarkan GA lalu tagihannya menyusul (acquisition gap tertutup).

## 14. Test backend
Untuk setiap tabel dan route baru:
- test migrasi;
- test state machine (transisi yang tidak sah ditolak);
- test hak akses;
- test resolve akun untuk setiap baris §9;
- test agregasi Σ baris POSTED (tidak dobel antara view kontrak dan perbaikan);
- regression test sweep tanggal 31;
- test idempotensi sweep di bawah konkurensi.

## 15. Tahapan
1. **Nav dan UI dasar:** menu B (§5), chip view aset, ikon build, komponen kartu pilihan dan switch (reusable), Overview (data yang sudah ada).
2. **Aset lengkap:** `asset_class.build`, `specs`, route GA untuk registrasi, event (pindah/pemegang), dokumen dengan masa berlaku, hub aset.
3. **Contracts** + meter reading + `bill_template.contract_id` + seed §9.2 + hub kontrak.
4. **Maintenance:** jadwal, inspeksi, perbaikan (dengan approval budget), replacement, pelepasan + seed §9.3.
5. **Locations** hub + **Supplies** + seed §9.4. Hubungan ke Procurement non-dagang dibuat sebagai rujukan (`po_id`) saja; kalau PO non-dagang belum ada, tampilkan tahapnya tanpa membuat modul Procurement baru, dan laporkan.
6. **Finance handoff:** rujukan per baris, periode layanan, usulan akun, draft dari GA dan Inbox, hold, enam peringatan, payment request yang membuat draft, perbaikan bug sweep.
7. **Letters** menunjuk record, lalu perapian UI akhir.
8. **E2E penuh** (§16).

Di akhir setiap tahap (titik cek, lalu lanjut ke tahap berikutnya):
- semua cek §4.9 bersih;
- `make contract` tanpa diff;
- langkah §0.6;
- cek cepat agent-browser di layar yang disentuh;
- laporan `runs/ga-build/<tanggal>/STAGE-<n>.md`;
- commit lokal per tahap sesuai §0.5, dengan pesan `GA tahap <n>: <ringkas>`.

## 16. Testing E2E dengan agent-browser (wajib, tahap 8 dan cek cepat di setiap tahap)

Persiapan:
1. `agent-browser skills get core --full`, lalu `agent-browser skills get dogfood` untuk pola eksplorasi.
2. Backend: konfigurasi `cloud-api` di `.claude/launch.json` (port 8080, `INVENTORY_AUTH_MODE=disabled`, `INVENTORY_ENABLE_TEST_CONTROLS=true`). Pakai database test sendiri (**jangan** `inventory` milik orang lain), migrasikan, lalu isi seed demo GA yang setara data prototype. Seed ini berupa skrip di `scripts/`, bukan migrasi.
3. Frontend: konfigurasi `hub` (port 5273, `VITE_API_TARGET=http://127.0.0.1:8080`).
4. Uji juga dengan auth **menyala** untuk skenario hak akses (§11).

Skenario (tiap langkah: aksi → cek UI → cek API/DB → screenshot ke `runs/ga-e2e/<tanggal>/`):
1. **Navigasi:** 17 item sidebar; tiap view tersembunyi menyalakan induknya; ⌘K menemukan view; lebar 400px rapi.
2. **Vendor:** tambah vendor; isi rekening (UNVERIFIED); tambah kontak; verifikasi di Finance → status di GA berubah.
3. **Sewa dibayar di muka:** buat kontrak SEWA_TOKO Rp1,2 M → GA ajukan tagihan Rp400 jt Jan–Des → Finance Inbox → posting (akun 1038) → AP → bayar → jadwal prepaid 12 bulan → hub kontrak menampilkan ditagih Rp400 jt, sisa Rp800 jt.
4. **Langganan:** kontrak PLN + ID pelanggan + meter → `bill_template` menunjuk kontrak → draft bulan ini → cocokkan dalam toleransi (posting) dan di luar toleransi (peringatan) → kandidat YMHD saat tutup bulan.
5. **Perbaikan:** dari aset AC → objek AC → budget disetujui orang lain → tagihan menunjuk perbaikan (akun 6072) → biaya aktual tampil → tagihan di atas budget memunculkan penanda.
6. **Payment request toko** → disetujui → draft tagihan otomatis → rekening vendor belum diverifikasi, pembayaran tertahan → verifikasi → bayar.
7. **Aset, barang datang dulu:** GA daftarkan (form build VEHICLE, field kendaraan) → Finance: belum dinilai + acquisition gap → tagihan dengan baris kelas Mobil ditautkan → penilaian → gap tertutup.
8. **Aset, tagihan datang dulu:** tagihan dengan kelas AC diposting → aset DRAFT → GA lengkapi → Finance menilai.
9. **Inspeksi** Rusak → switch membuat perbaikan → muncul di Jadwal & inspeksi dan di riwayat aset.
10. **Replacement OE:** usulkan → setujui (orang lain) → dibeli → terpasang (aset baru dibuat, yang lama REPLACED) → tagihan menunjuk replacement (akun 7024).
11. **Pelepasan dijual** → Finance melihat estimasi laba/rugi dan catatan akun belum ada.
12. **Supplies:** permintaan ATK → disetujui → (PO) → diterima → tagihan dengan akun 6041. Pastikan Customer Supplies tidak tersedia sebagai kategori.
13. **Hold:** tahan tagihan → hilang dari daftar siap bayar → lepas hold → muncul lagi.
14. **Peringatan sebelum posting:** keenam peringatan §8.4 bisa dipicu.
15. **Hak akses:** role toko tidak bisa menulis kontrak; pembuat budget tidak bisa menyetujui budgetnya sendiri; GA tidak bisa memposting tagihan.
16. **Hapus:** kontrak yang sudah dirujuk tagihan tidak bisa dihapus, hanya diarsipkan.
17. **Console dan network:** nol error console, nol request 4xx/5xx yang tidak diharapkan, di semua layar GA dan Finance yang disentuh.

Output: `runs/ga-e2e/<tanggal>/REPORT.md` berisi tabel skenario (lulus/gagal, bukti screenshot, catatan), daftar bug yang ditemukan beserta status perbaikannya, dan hasil ulang setelah perbaikan.

## 17. Backlog (jangan dikerjakan, cukup dicatat)
Dari `prototypes/ga` v2: reservasi ruang, tamu, insiden fasilitas, checklist cleaning, perjalanan kendaraan, log BBM, pengingat ke PIC, anomali meter. Lainnya: AR untuk kontrak Disewakan, otomasi akrual YMHD, Procurement non-dagang penuh, rename `dc` → `ho` (0256).

## 18. Laporan tiap tahap
- file yang diubah;
- migrasi baru (nomor + nama);
- hasil semua cek (§4.9) dan `make contract`;
- baris `account_map` yang di-seed;
- hasil agent-browser (ringkas + path report);
- item terbuka untuk Finance/pemilik:
  - akun yang belum ada;
  - qualifier yang sengaja dibiarkan kosong;
  - keputusan yang dibutuhkan.
