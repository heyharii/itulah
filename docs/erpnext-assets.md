# ERPNext dan aset — satu dokumen gemuk vs dua tabel yang sengaja dipisah

**Tanggal:** 13 September 2026. **Sumber ERPNext:** `frappe/erpnext` `develop@fe25746`
(kode, bukan ingatan) — `erpnext/assets/` = 26 doctype (14 dokumen + 12 child table),
34 file `.py`, ditambah `docs.frappe.io/erpnext/asset` dan enam anak halamannya.
**Sumber kita:** migrasi `0070`, `0096`, `0159`, `0160`, `0215`;
`postgres/assets.rs` (2.130 baris), `domain/depreciation.rs` (483),
`tests/asset_banking_integration.rs` (1.094, 12 test), layar `/finance/assets`
(1.935) dan `/assets` GA (413). Pendamping: [`erpnext-money.md`](./erpnext-money.md),
[`erpnext-banking.md`](./erpnext-banking.md), [`finance-menu.md`](./finance-menu.md) §Assets.

---

## 0. Jawaban singkat

1. **Bentuknya berlawanan, dan itu disengaja di kedua pihak.** ERPNext menaruh fakta
   fisik, uang, dan kebijakan penyusutan dalam **satu dokumen `Asset`** (±50 field,
   13 nilai `status`), lalu memisahkan **jadwalnya** menjadi dokumen tersendiri. Kita
   memisahkan **fakta dari uang** (`fixed_asset` tanpa satu pun kolom rupiah vs
   `asset_capitalization` yang append-only), lalu tidak menyimpan jadwal sama sekali —
   hanya bulan yang benar-benar sudah diposting.
2. **Empat hal kita lebih kuat:** pemisahan fisik/uang, keputusan sebagai riwayat
   (termasuk "kami putuskan ini dibebankan" — ERPNext tidak punya baris untuk itu),
   aritmetika integer dengan tiap penolakan bernama, dan **sumbu unit** (posting per
   `site`, transfer antar unit memposting; di ERPNext transfer aset tidak memposting
   apa pun).
3. **Enam hal ERPNext lebih kaya:** jadwal sebagai dokumen, finance book ganda
   (komersial vs fiskal), `Asset Value Adjustment` (revaluasi/impairment), pro-rata
   harian & shift, `Asset Capitalization` (stok + jasa + aset → satu aset), dan
   perawatan/perbaikan yang bisa menambah umur.
4. **Ambil 3, siapkan 1, tolak 4.** Detail di §6. Tidak ada yang mengubah menu final —
   baris 20·21·22 di `finance-menu.md` sudah menamai tiga dari lima ini.

---

## 1. Bentuk ERPNext, dari kodenya

### 1.1 Dokumen dan tabel

| Doctype | Isi | Submittable |
|---|---|---|
| `Asset` | fakta fisik + uang + kebijakan, ±50 field | ya |
| `Asset Category` | **4 akun per company** + dua flag | tidak |
| `Asset Category Account` (child) | `fixed_asset_account`, `accumulated_depreciation_account`, `depreciation_expense_account`, `capital_work_in_progress_account` | — |
| `Asset Finance Book` (child) | metode, jumlah penyusutan, frekuensi (bulan), tanggal mulai, nilai sisa, `rate_of_depreciation`, `salvage_value_percentage`, `daily_prorata_based`, `shift_based` | — |
| `Asset Depreciation Schedule` | jadwal satu aset × satu finance book, status Draft/Active/Cancelled | ya |
| `Depreciation Schedule` (child) | `schedule_date`, `depreciation_amount`, `accumulated_depreciation_amount`, **`journal_entry`**, `shift` | — |
| `Asset Movement` | Issue / Receipt / Transfer / Transfer and Issue | ya |
| `Asset Value Adjustment` | nilai lama → nilai baru + `difference_account` | ya |
| `Asset Capitalization` | stock items + service items + asset items → satu aset target | ya |
| `Asset Repair` | biaya perbaikan, item terpakai, faktur, `capitalize_repair_cost`, `increase_in_asset_life` | ya |
| `Asset Maintenance` (+ Task/Log/Team) | jadwal perawatan preventif | tidak |
| `Asset Shift Factor` / `Asset Shift Allocation` | penyusutan per shift produksi | sebagian |
| `Asset Activity` | log baca-saja per aset | tidak |
| `Location` (tree, geolocation) | tempat, dipakai juga oleh modul agriculture | tidak |

`Asset.status` memuat 13 nilai dalam satu kolom: `Draft, Submitted, Cancelled,
Partially Depreciated, Fully Depreciated, Sold, Scrapped, In Maintenance, Out of
Order, Issue, Receipt, Capitalized, Work In Progress` — fisik, uang, dan perawatan
bercampur di satu tempat.

### 1.2 Empat bentuk jurnalnya

| Peristiwa | Kode | Jurnal |
|---|---|---|
| Perolehan | `asset.py:make_gl_entries` | kredit **CWIP**, debit **Fixed Asset** — hanya kalau CWIP memang sudah dibukukan oleh Purchase Receipt/Invoice; kalau tidak, aset tidak memposting apa-apa (`validate_make_gl_entry`) |
| Penyusutan | `depreciation.py:_make_journal_entry_for_depreciation` | **Journal Entry**: debit `depreciation_expense_account`, kredit `accumulated_depreciation_account`, tersimpan balik ke baris jadwal |
| Pelepasan | `depreciation.py:get_gl_entries_on_asset_disposal` | kredit Fixed Asset sebesar `net_purchase_amount`, debit akumulasi, selisih ke `Company.disposal_account` (untung/rugi) |
| Revaluasi | `asset_value_adjustment.py:make_asset_revaluation_entry` | Fixed Asset naik/turun lawan `difference_account` |
| **Pemindahan** | `asset_movement.py:on_submit` | **tidak ada jurnal** — hanya `location` dan `custodian` di aset diperbarui |

Penyusutan dijalankan **scheduler harian** (`hooks.py` → `post_depreciation_entries`),
plus job per jam `make_post_gl_entry` untuk perolehan CWIP. Kegagalan posting menjadi
*state pada aset*: `depr_entry_posting_status = 'Failed'` + email ke pemilik.

### 1.3 Aritmetikanya

`depreciation_methods.py` — 120 baris, seluruhnya `flt()` (float):

- **Straight Line**: `(value_after_depreciation − expected_value_after_useful_life) /
  pending_periods`; varian `daily_prorata_based` membagi per hari, varian `shift_based`
  membagi menurut bobot shift.
- **WDV / Double Declining**: `pending × rate_of_depreciation / 100`, dihitung ulang
  **saat tahun fiskal berganti** dan dipakai ulang untuk bulan-bulan di dalam tahun itu.
- **Manual**: akuntan mengetik tanggal dan jumlah sendiri.

Menyusun ulang jadwal = **membatalkan** dokumen jadwal lama dan membuat yang baru
(`cancel_asset_depr_schedules` → `make_draft_asset_depr_schedule` → `convert_…into_active`).

---

## 2. Bentuk kita, dari kodenya

```
fixed_asset            apa yang dimiliki — NOL kolom uang
  ├─ status            DRAFT · IN_PROGRESS · REGISTERED · IN_SERVICE · DISPOSED   (0215)
  ├─ category_code  →  ledger_account  (famili di bawah 10215 / 10217 / 1031803)
  ├─ site_id        →  site            (sumbu unit, 14 unit klien)
  └─ receipt_line_id + unit_sequence   (satu unit satu baris terima = satu aset, sekali)

asset_capitalization   keputusan Finance, APPEND-ONLY (trigger menolak UPDATE/DELETE)
  ├─ decision          CAPITALIZE · EXPENSE · IN_PROGRESS                          (0215)
  ├─ basis             cost · salvage · useful_life_months · method · in_service_on
  ├─ charge_kind       DEPRECIATION · REPLACEMENT_RESERVE · AMORTISATION           (0159)
  └─ rate_bps          20% = 2000 — cara klien menyebut umur                       (0215)

asset_depreciation_entry   satu bulan satu aset, UNIQUE (asset_id, period_month)
asset_transfer             unit → unit, dengan jurnalnya                            (0096)
supplier_invoice_expense_line.asset_id   N tagihan → 1 aset                         (0160)
```

Delapan endpoint: `GET/POST /finance/assets`, `…/{id}/assess`, `…/{id}/dispose`,
`…/{id}/transfer`, `…/{id}/schedule`, `…/unbacked`, `POST /finance/depreciation/run`.

**Akun tidak pernah disebut di aturan posting.** `charge_kind` menamai tiga *makna*
(`expense_key` × `contra_key` × `cost_key`), dan `account_map` menerjemahkan makna ×
`site` × qualifier (kode famili) menjadi akun klien. Itulah sebabnya 7 famili × 14 unit
tidak perlu 98 kategori.

**Aritmetikanya integer.** `domain/depreciation.rs` berhitung di `i128`, tanpa satu pun
float, dan tiap penolakan bernama: `NotDepreciated`, `FullyDepreciated`,
`BelowSmallestUnit`, `NothingAboveSalvage`, `NoUsefulLife`. Angsuran terakhir menyapu
sisa pembulatan, dan `period_index` diambil dari **kalender**, bukan dari jumlah entri
yang sudah ditulis — kalau tidak, aset kecil berumur panjang tidak pernah sampai ke
angsuran terakhirnya.

---

## 3. Peta konsep

| ERPNext | Kita | Catatan |
|---|---|---|
| `Asset` (fisik + uang) | `fixed_asset` + `asset_capitalization` | dua pintu, satu register: GA `/assets`, Finance `/finance/assets` |
| `Asset Category` + 4 akun | `category_code` → bagan klien + `account_map` | bagan klien **adalah** registernya (0070); tidak ada register kategori kedua |
| `enable_cwip_accounting` | `decision = 'IN_PROGRESS'` + famili `1031803` | 668 dari 1.342 baris register klien adalah CIP |
| `Asset Finance Book` (multi-book) | — | belum ada; lihat §6.4 |
| `Asset Depreciation Schedule` (dokumen) | `asset_depreciation_entry` + proyeksi terhitung (`asset_schedule`) | kita menyimpan yang **terjadi**, bukan yang direncanakan |
| `Depreciation Schedule.journal_entry` | `asset_depreciation_entry.journal_entry_id` | sama |
| Straight Line / WDV / DDB / Manual | `STRAIGHT_LINE` / `DECLINING` / `NONE` | tanpa Manual; label klien: Garis Lurus · Saldo Menurun · Tidak Disusutkan |
| `frequency_of_depreciation` (bulan) | selalu bulanan | klien memang bulanan |
| `daily_prorata_based`, `shift_based` | — | ditolak, §6 |
| `Asset Movement` (tanpa GL) | `asset_transfer` **dengan** GL | klien punya L/R per unit; memindah biaya tanpa jurnal membuat dua unit salah |
| `Asset Value Adjustment` | — | gap nyata, §6.3 |
| `Asset Capitalization` (komposit) | `supplier_invoice_expense_line.asset_id` (0160) | separuh tertutup: banyak tagihan → satu aset; **barang stok → aset** belum |
| `Asset Repair` (+ umur bertambah) | penilaian ulang menaikkan `capitalized_cost_minor` | cukup secara aritmetika, tanpa dokumen perbaikan |
| `Asset Maintenance` / Team / Task | — | urusan GA, ditolak sebagai baris Finance |
| `Asset Activity` | `audit_log` + sequence penilaian | riwayat sudah append-only |
| Scrap / Sold + `disposal_account` | `dispose_asset` (`SOLD` / `WRITTEN_OFF`) | sama bentuk jurnalnya |
| `split_from` (pecah aset) | `quantity` / lot (0159) | lot, bukan pecahan |
| — | `GET /finance/assets/unbacked`, `acquisition_gap` | ERPNext tidak punya laporan "register vs buku tidak nyambung" |

---

## 4. Di mana kita lebih kuat, dengan buktinya

1. **Fakta ≠ uang.** `fixed_asset` tidak punya kolom rupiah. GA mendaftarkan, Finance
   menilai, dan tidak ada satu layar pun yang bisa diam-diam mengubah biaya karena
   seseorang mengoreksi nomor seri. Di ERPNext keduanya field pada dokumen yang sama.
2. **Penolakan adalah baris.** "Belum ada yang menilai" dan "kami menilai, dan ini
   dibebankan" adalah dua keadaan berbeda; ERPNext hanya punya ketiadaan dokumen Asset
   untuk keduanya. Karena penilaian di-append, *"dikapitalisasi Januari, dibalik Maret"*
   adalah jejak auditnya sendiri.
3. **Aritmetika yang tidak bisa melenceng.** Leluhur kode ini punya bug ×100 yang
   membuat bulan kedua menggandakan galat bulan pertama (`0070`/`depreciation.rs`).
   ERPNext masih `flt()` sepanjang jalan; untuk saldo rupiah klien (Rp 50,7 miliar di
   register) mantissa 53-bit bukan lelucon teoretis.
4. **Sumbu unit.** Tiap baris jurnal memikul `site`, dan `asset_transfer` memposting
   biaya **dan** akumulasi dari unit asal ke unit tujuan. `Asset Movement` ERPNext tidak
   memposting apa pun — modelnya mengandalkan Cost Center/Accounting Dimension, yang di
   bagan klien (akun per unit ×14) berarti kategori × unit.
5. **`charge_kind`.** Klien menulis `NON DEPRECIABLE` di kolom metode untuk 200 baris
   operating equipment yang **tetap mereka akrualkan tiap bulan** ke `1021607 Reserve
   Replacement`. ERPNext bisa menirunya dengan membuat Asset Category tersendiri, tapi
   seluruh UI dan laporannya tetap menyebutnya *depreciation*. Kita memisahkan "bagaimana
   nilainya disebar" (`method`) dari "apa nama bebannya" (`charge_kind`).

---

## 5. Di mana ERPNext lebih kaya

| # | Hal | Keadaan kita | Nilainya untuk klien ini |
|---|---|---|---|
| 1 | Jadwal sebagai dokumen tersimpan | hanya entri terposting + proyeksi | tinggi — akuntan ingin melihat 60 baris sebelum bulan pertama |
| 2 | Finance book ganda (komersial vs fiskal) | tidak ada | tinggi — penyusutan fiskal Indonesia ≠ komersial |
| 3 | `Asset Value Adjustment` | tidak ada | sedang — impairment/revaluasi tanpa harus melepas aset |
| 4 | Pro-rata harian, shift | selalu satu angsuran penuh sejak bulan in-service | rendah — register klien memang mulai dari bulan TGL BELI |
| 5 | `Asset Capitalization` komposit | 0160 menutup sisi tagihan | sedang — fit-out toko = material + jasa kontraktor |
| 6 | Maintenance / Repair / custodian | tidak ada | rendah untuk Finance, sedang untuk GA |

---

## 6. Putusan: ambil 3, siapkan 1, tolak 4

**Ambil.**

1. **Jadwal tersimpan (baris 21 `finance-menu.md`).** Bukan meniru dokumen submittable
   ERPNext beserta siklus batal-buat-ulangnya. Yang ditiru: *satu baris per bulan, dengan
   jurnalnya jika sudah diposting*, dibuat saat penilaian dan dibaca ulang saat basisnya
   berubah. Plus **replay/pratinjau di sebelah tombol Post** — hari ini
   `POST /finance/depreciation/run` langsung memposting, tanpa dry-run.
2. **`Asset Value Adjustment` sebagai dokumen — tetapi ditahan sampai akunnya ada.**
   Bentuk jurnalnya jelas (aset naik/turun lawan satu akun selisih), dan efek pada basis
   cukup ditangani penilaian baru dengan `reason`. Yang menahannya bukan kode: **bagan
   klien tidak punya akun selisih penilaian sama sekali** (§8). Yang harus dikerjakan
   lebih dulu, dan mendesak, adalah memetakan `asset_disposal_result` — `dispose_asset`
   sudah hidup dan hari ini pasti ditolak resolver.
3. **Reclass CIP yang memposting.** `assess_asset` sudah memindahkan famili
   (`1031803` → `10215*`) dalam satu transaksi dengan penilaian, dan kodenya menyebut
   sendiri bahwa ia **tidak** memposting karena belum ada yang mendudukkan biaya di CIP.
   Begitu expense bill mulai mendarat ke `1031803`, jurnal pemindahannya wajib ada di
   tempat yang sama.

**Siapkan (jangan bangun sekarang).**

4. **Finance book kedua (fiskal).** Skema hari ini menaruh basis di
   `asset_capitalization`; menambahkan buku kedua berarti sumbu `book` pada penilaian dan
   pada `asset_depreciation_entry`. Murah bila diputuskan sebelum jadwal tersimpan
   dibangun, mahal sesudahnya. Ini juga salah satu keputusan pajak yang masih terbuka.

**Tolak.**

5. **Maintenance / Repair / Shift.** Perawatan adalah GA (dan modul `/assets` GA sudah
   ada); shift adalah manufaktur. Satu bagian yang *sudah* kita punya tanpa dokumennya:
   biaya yang menambah nilai aset — penilaian baru menaikkan `capitalized_cost_minor`
   dan angsuran berikutnya memakai basis baru.
6. **Status tunggal 13 nilai.** Fisik, uang, dan perawatan di satu kolom adalah persis
   yang `0070` hindari.
7. **Posting lewat scheduler harian + `depr_entry_posting_status = 'Failed'`.** Kegagalan
   posting menjadi state pada aset, dan yang tahu duluan adalah email. Run bulanan kita
   eksplisit dan mengembalikan satu baris per aset dengan alasannya; pertahankan.
8. **Aritmetika float.** Tidak perlu dibahas lagi.

---

## 7. Gap kita yang jujur (bukan dari ERPNext, dari kode sendiri)

| Gap | Bukti |
|---|---|
| Tidak ada dry-run penyusutan | `postgres/assets.rs` — tidak ada parameter `dry_run`; `run_depreciation` memposting |
| Reclass CIP tidak memposting | komentar di `assess_asset`: *"nothing has put the cost into `1031803`"* |
| Tidak ada revaluasi / impairment | tidak ada rute maupun tabel |
| Tidak ada buku fiskal | `asset_capitalization` menyimpan satu basis |
| Barang stok → aset belum ada | rak dari gudang menjadi aset toko tidak punya jalur |
| Pre-opening `1031802` belum punya jalur | baris 22 `finance-menu.md` menyebutnya; `is_asset_account` hanya mengakui `10215`, `10217`, `1031803` |
| Jadwal ke depan hanya angka ringkas | `AssetSchedule` mengembalikan `months_remaining` + `remaining_depreciable_minor`, bukan 60 baris |


---

## 8. Uji terhadap bagan klien (`Laporan_Master_Account1.csv`, 7.528 akun)

Ketiga putusan §6 diuji langsung ke bagan klien dan ke `account_map` di DB dev
(`inventory_rfid`, 1.353 aset hasil impor register).

| Putusan | Akun yang dibutuhkan | Ada di bagan klien? |
|---|---|---|
| Jadwal tersimpan + dry-run | tidak ada akun baru | — (murni catatan & layar) |
| Reclass CIP | `1031803` × 14 unit → `10215*` × 14 | **ya**, 15 daun CIP + 30 daun Pre Opening |
| `Asset Value Adjustment` | akun selisih penilaian | **tidak ada** |

**Nol akun revaluasi, impairment, atau laba/rugi pelepasan.** Pencarian
`revaluasi · penilaian kembali · impair · penurunan nilai · penjualan/pelepasan aktiva`
atas 7.528 akun mengembalikan **0 baris**. Satu-satunya pendaratan yang masuk akal
adalah `8010110007 Pendapatan (Biaya) Lain-Lain` (1 induk + 14 unit). Karena itu
revaluasi ditahan, dan pemetaan hasil pelepasan naik jadi pekerjaan pertama.

**Pre Opening ternyata diamortisasi, bukan disusutkan:** `1031802001 Pre Opening` dan
`1031802002 Akumulasi Amortisasi Pre Opening`. Kalau baris 22 `finance-menu.md` memang
mencakupnya, `charge_kind = AMORTISATION` sudah bentuk yang benar — yang kurang hanya
famili `1031802` di `ASSET_FAMILIES` dan di peta.

**Dan yang paling mendesak: peta tidak sampai ke asetnya.** Dari 683 aset berkeputusan
CAPITALIZE di DB dev, hanya **13** yang kedua kaki jurnalnya bisa di-resolve hari ini.
Dua sebab, keduanya terukur:

1. **Granularitas qualifier.** Aset difile di sub-famili 10 digit hasil impor
   (`1021506003 FFE — …`), sedangkan `account_map.qualifier` diisi famili 7 digit
   (`1021506`), dan `resolve_account` mencocokkan **persis** (`ledger.rs:1901`). Potong
   qualifier ke 7 digit → **487 dari 683** langsung bisa diposting.
2. **Enam makna tak pernah dipetakan:** `replacement_expense`, `replacement_reserve`,
   `intangible_asset`, `accumulated_amortisation`, `amortisation_expense`,
   `asset_disposal_result` — 28 dari 34 makna wajib yang ada di `required_semantic_keys`.
   Itu 192 aset operating equipment + 3 intangible, plus seluruh jalur pelepasan.

Sebagai gantinya peta sekarang mengarahkan famili OE (`1021507`) lewat
`depreciation_expense` → `7010215 BIAYA REPLACEMENT` dan `accumulated_depreciation` →
`1021607 Reserve Replacement` — persis yang `0159` larang: makna "akumulasi penyusutan"
tidak boleh mendarat di akun cadangan. (Pemilik sudah memutuskan akrual OE **OFF**, jadi
praktis ini tidur — tetapi petanya tetap salah, dan `unmapped_categories` seharusnya
melaporkannya.)

**Urutan kerja yang mengikuti temuan ini** (mendahului §6): (1) petakan
`asset_disposal_result` ke `8010110007` × 14 atau minta klien membuka akun; (2) putuskan
qualifier — potong ke famili 7 digit di posting, atau lengkapi peta sampai sub-famili;
(3) petakan tiga makna OE + tiga makna intangible, atau nyatakan OE tidur secara eksplisit
supaya laporan tidak menuduh peta yang tidur itu rusak.

---

## 9. Uji terhadap dua file klien (`Daftar asset (1).xls`, `MASTER ASSET (2).xls`)

Keduanya file klien yang sudah dipakai `scripts/import_client_assets.py`. Dibaca ulang
untuk menguji §6, dan hasilnya menambah satu putusan di depan ketiganya.

**`Daftar asset (1).xls` — "DAFTAR FIX ASSET & FFE".** Bukan daftar barang: **register
kelas + tarif**, 7 famili (10 TANAH … 70 OPERATING EQUIPMENT) dan 57 sub-kelas, plus
famili **80** yang tidak ada di `10215`: `8001 Intangible Asset` dan **`8002 Contract In
Progress`**. Tarifnya: tanah 0%/3%, bangunan 5%, instalasi & mesin 10%, kendaraan 20%,
FFE 20%, OE 20% (36 sub-kelas OE = 36 jenis fixture di bagan). Kolomnya sendiri adalah
kertas kerja penyusutan: *Book Prior Years · Book This Month · Book This Year ·
Accumulated · Book Value · BALANCING*.

**`MASTER ASSET (2).xls`** — 1.342 baris, Rp 50.738.444.126, beli 2016-01 → 2026-06.

| Yang diuji | Temuan |
|---|---|
| `PERSEN` × `UMUR` | **= 100 pada semua 1.342 baris**, nol konflik → `reconcile_life` (`120_000 / rate_bps`) di 0215 tepat |
| `S/D TAHUN LALU` (akumulasi) | **0 pada semua 1.342 baris** — register ini tidak menyimpan penyusutan yang sudah berjalan |
| `METODE DEPRESIASI` | 871 NON DEPRECIABLE vs 471 STRAIGHT LINE; **200 baris berakun replacement semuanya NON DEPRECIABLE** — jebakan 0159 terlihat langsung |
| `STATUS` | 670 Y / 672 N; yang N: 669 non-depreciable + **3 garis lurus** (bangunan Rp 2,97 M + 2 kendaraan) yang harus ditanyakan |
| CIP | 664 baris, Rp 5.604.338.653 |
| **`REKLAS CIP`** | **24 baris, Rp 4.061.030.316**, dan `ACCOUNT`-nya adalah famili TUJUAN (`OE - Rak 4 C013`, `FFE Office C013`) |
| Pelepasan / revaluasi | **0 baris** bernama jual, hapus, disposal, rugi, revaluasi, atau koreksi |

### Konsekuensinya untuk §6

1. **Reclass CIP naik dari "bagus" ke "sudah mereka kerjakan dengan tangan".** 24 baris
   `REKLAS CIP` adalah jurnal pemindahan yang mereka tulis manual, dan tujuannya sub-famili
   per unit — bukti kedua untuk pertanyaan qualifier di §8.
2. **Jadwal tersimpan terkonfirmasi bentuknya.** Kolom `Daftar asset` persis kolom yang
   akan disimpan; mereka sudah membacanya begitu setiap bulan.
3. **Revaluasi tetap ditahan.** Tidak ada akunnya di bagan (§8) **dan** tidak ada satu pun
   peristiwanya di register.
4. **Satu putusan baru, dan ia mendahului ketiganya: saldo awal penyusutan.**
   `asset_capitalization` tidak punya kolom akumulasi pembuka, dan `run_depreciation`
   menjumlahkan akumulasi **hanya dari entri kita sendiri**. Register klien mengisi kolom
   akumulasinya dengan nol, sementara 1.129 dari 1.342 aset dibeli ≤ 2021. Akibatnya pada
   468 aset garis lurus yang aktif:
   - **273 sudah lewat umur** → `FullyDepreciated`, tidak mencharge apa pun (aman);
   - **195 masih di dalam umur** (Rp 12,26 M) → mulai dari nol, dan karena angsuran
     terakhir menyapu sisa (`Outcome::Post(remaining)`), **± Rp 5,70 miliar** penyusutan
     yang mestinya sudah lewat akan menumpuk di satu bulan terakhir per aset.

   ERPNext menyelesaikan ini dengan `opening_accumulated_depreciation` +
   `opening_number_of_booked_depreciations` pada `Asset Finance Book`. Angkanya tidak bisa
   diambil dari file ini — harus dari saldo `10216*` per unit per famili di sistem lama,
   yaitu pekerjaan cutover yang sudah ada rumahnya di `opening.rs` (branch
   `feat/finance-control`).

---

## 10. Keempat penolakan, diuji ulang ke akun aset klien

| Ditolak dari ERPNext | Bukti di bagan / register klien | Putusan |
|---|---|---|
| `Asset Repair` + `capitalize_repair_cost` + `increase_in_asset_life` | `60104` punya **10 jenis** beban perbaikan yang mencerminkan famili aset (FFE, komputer, bangunan, staff house, kendaraan, AC, power plant, pengecatan, lift, software) × 15 = 150 daun. **Nol akun sparepart/suku cadang** di seluruh 7.528. Register: **0 baris** bernama PERBAIKAN, SERVICE, SPAREPART, UPGRADE | **tetap ditolak, makin kuat** |
| `Asset Maintenance` / Team / Task | tidak ada akun, dan perawatan tidak pernah masuk register aset | **tetap ditolak** (GA) |
| Shift-based & pro-rata harian | `PERSEN` × `UMUR` = 100 di 1.342 baris; `PERIODE` adalah BULAN (`202607`); metode hanya STRAIGHT LINE / NON DEPRECIABLE | **tetap ditolak** — dengan satu catatan jujur di bawah |
| Status tunggal 13 nilai | register memisahkan tiga kolom: `STATUS` (Y/N), `METODE DEPRESIASI`, `TIPE ASSET` | **tetap ditolak** |
| Scheduler harian + `flt()` float | **269 dari 1.342 nilai rupiah mereka bukan bilangan bulat** (`26390000.000000004`), dan 21 baris tarif tertulis `12.500000000000002` / `33.333330000000004` | **tetap ditolak** — drift itu produk sistem lama mereka |

**Catatan jujur soal pro-rata.** Tanggal beli mereka tersebar merata di dalam bulan
(hanya 188 dari 1.342 jatuh pada tanggal 1), jadi pro-rata harian *akan* mengubah angka.
Yang membuatnya ditolak bukan tanggalnya, melainkan kebijakan mereka: register hanya
menyimpan bulan, dan angsuran dihitung penuh sejak bulan `TGL BELI`. Kalau suatu saat
klien meminta pro-rata, itu perubahan kebijakan yang harus mereka nyatakan, bukan
kekurangan yang kita tambal diam-diam.

**Yang justru dikuatkan oleh penolakan pertama.** Perbaikan mereka dibebankan, tetapi
peningkatan nilai tetap dikapitalisasi — sebagai **baris aset baru lewat CIP**, bukan
sebagai perbaikan yang memperpanjang umur. `TIPE = FFE INTERIOR` berisi 61 baris
(Rp 11,46 M) dengan nama `CAPITALISASI PROJECT`, `KAPITALISASI PROJECT`, `REKLAS CIP`,
ditambah 4 baris `RENOVASI`. Jadi jalur yang ERPNext tempuh lewat `Asset Repair` mereka
tempuh lewat CIP — persis putusan §6.3.

### Dan satu pertanyaan §8 yang sekarang terjawab: qualifier TIDAK boleh dipotong

Bagan klien benar-benar per sub-famili, dan ketiganya sejajar secara struktural:

```
1021506003 FFE Komputer     → 1021606003 Akum Penyusu - FFE Komputer  → 7010214003 Biaya Depresiasi FFE Komputer
1021507004 OE - Rak 4       → 1021607004 Reserve Replacement OE- Rak 4 → 7010215004 Biaya Replacement OE - Rack 4
102150600300 FFE Komputer HO   (sufiks unit dua digit menempel di belakang)
```

Memotong qualifier ke famili 7 digit akan memposting **seluruh 36 jenis fixture OE ke
akun "Rak 1"**. Jadi peta harus dilengkapi sampai sub-famili × unit, dan sumber
verifikasinya sudah ada di register klien sendiri: kolom `COA DEBET` dan `COA KREDIT`
menyebut pasangan akun per baris.

---

## 11. Apa yang sudah dikerjakan (13 September 2026)

Dua dari empat langkah §8 selesai; dua sisanya belum.

**(0) Saldo awal penyusutan — selesai.**
`0237_an_asset_did_not_start_depreciating_here.sql` menambah
`opening_accumulated_minor` + `opening_through` ke `asset_capitalization`, dengan empat
CHECK: hanya pada CAPITALIZE, keduanya atau tak satu pun, tidak melebihi (cost − salvage),
dan bulan yang dinamai hari pertamanya serta tidak sebelum in-service.

* `run_depreciation` kini menjumlahkan akumulasi sebagai **yang dibawa + yang diposting di
  sini**, dan **menolak bulan yang sudah dicakup** saldo awal — sebelumnya bulan seperti itu
  tidak bertabrakan dengan apa pun dan akan dicharge dua kali, satu di tiap ledger.
* `asset_schedule` menghitung sisa umur dari `opening_through` ketika sistem ini belum
  mencharge apa pun, jadi aset yang datang di tengah umur tidak lagi dilaporkan punya
  seluruh umurnya.
* Layar `/finance/assets` punya dua field baru (*Already depreciated elsewhere*, *Covers
  through*) dan menampilkan **Carried in** terpisah dari **Charged so far** — satu angka
  yang dibawa orang, satu daftar jurnal yang bisa ditautkan.
* Tes: `an_asset_that_did_not_start_here_is_charged_from_where_it_left_off` (bulan yang
  dibawa ditolak, bulan pertama mencharge angsuran biasa, angsuran terakhir menyapu dua
  bulan bukan sebelas, dan hanya Rp 3 juta yang masuk `10216*` — bukan Rp 12 juta) dan
  `a_carried_in_figure_without_the_month_it_covers_is_refused`.

**(1) Peta akun + pelepasan — selesai.**
`scripts/map_asset_accounts.py` menurunkan separuh aset `account_map` dari bagan klien
sendiri, sub-famili × unit, dan menolak apa pun yang tidak bisa diverifikasi (ada, aktif,
bukan induk, unit cocok).

* **2.349 baris** diturunkan, **0 ditolak**, **0 bentrok**; verifikasi terhadap kolom
  `COA DEBET` register klien: **587 dari 590 baris setuju**.
* Tiga yang tidak setuju adalah salah-ketik di file mereka (aset `FFE Interior C007`
  dibebankan ke `FFE Office`, `OE - Hanger Wanita` ke `Hanger Gamis`) — dan satu jebakan
  yang ditemukan karenanya: **famili beban intangible tidak sejajar** (`7010216002` adalah
  *Biaya Amortisasi Biaya Pre Opening*, sehingga Opti Tex yang kedua di sisi biaya menjadi
  ketiga). Pasangannya dieja, bukan ditebak.
* 28 baris famili OE yang melanggar 0159 (`1021507` lewat makna penyusutan) dihapus.
* `asset_disposal_result` dipetakan ke `8010110007 Pendapatan (Biaya) Lain-Lain` × 14
  unit — **butuh konfirmasi klien**; bagan mereka tidak punya akun laba-rugi pelepasan.
* Hasil terukur di DB dev `inventory_rfid`: yang bisa diposting naik dari **13 → 681 dari
  683**. Dua sisanya benar gagal: satu TANAH (metode `NONE`, tidak pernah mencharge) dan
  satu baris impor yang masih terfile di `1031803` sambil berkeputusan CAPITALIZE — data
  yang harus dibersihkan, dan `unmapped_categories` melaporkannya.

**(2) Pratinjau run — selesai sebagian (backend).**
`POST /api/v1/finance/depreciation/preview` menjalankan bulan yang sama tanpa menulis apa
pun, dan **tidak menolak** ketika ada kategori tak terpeta: ia me-resolve kedua kaki per
aset dan melaporkan yang akan ditolak di baris aset itu (`blocked_because`), karena daftar
itulah yang dicari orang sebelum run pertama. Tes:
`a_rehearsal_charges_nothing_and_names_what_would_refuse`. **Layarnya belum ada** — itu
bagian dari baris 21 (jadwal tersimpan).

**Belum dikerjakan:** jadwal tersimpan (baris 21), jurnal reclass CIP (§6.3), dan buku
fiskal kedua (§6.4, masih keputusan).

---

## 12. Saldo awal: cara mendapatkannya, dan reklas CIP

### 12.1 Yang diputuskan

`asset_disposal_result` → `8010110007 Pendapatan (Biaya) Lain-Lain` × 14 unit **disetujui
pemilik** (13 Sep). Itu satu-satunya daun yang jujur: bagan klien tidak punya akun laba-rugi
pelepasan, revaluasi, maupun impairment sama sekali.

### 12.2 Bagaimana angka saldo awal didapat

Bukan diimpor — **dihitung, lalu direkonsiliasi**.
[`scripts/opening_asset_balances.py`](../scripts/opening_asset_balances.py) memutar ulang
fungsi yang sama dengan `domain::depreciation` (truncation per bulan, angsuran terakhir
menyapu sisa) dari `in_service_on` sampai bulan cutover, lalu **menjumlahkannya ke akun
akumulasi klien** — akun yang sama yang akan dikredit tiap bulan sesudahnya.

Alasannya: figure mana pun yang bukan hasil mesin ini akan membuat jadwal sesudah cutover
berselisih dengan aritmetikanya sendiri, dan angsuran terakhir menyapu selisih itu diam-diam.

Yang dihasilkan (cutover 2026-08, DB dev):

| | |
|---|---|
| Aset dihitung | **471** |
| Saldo awal | **Rp 25.230.400.982** |
| Akun rekonsiliasi | 127 akun `10216*` per unit per sub-famili |
| Work in progress | **Rp 5.273.338.653** di 10 unit (`1031803001` + sufiks unit) |
| Tidak dihitung | 662 CIP · 196 metode `NONE` (termasuk 192 OE yang register kliennya tulis NON DEPRECIABLE) · 11 sudah dicharge di sini · 3 expensed |

**Yang harus dilakukan orang, bukan skrip:** mencocokkan tiap baris rekonsiliasi dengan
saldo akun yang sama di buku lama. Selisih adalah pertanyaan untuk akuntan klien — aset
yang disusutkan dengan kebijakan lain, pelepasan yang tak pernah dicatat, revaluasi yang
bagan mereka bahkan tak bisa memuatnya — dan menyamakan sisi kita agar cocok akan mengubur
justru temuan itu. Setelah ditandai, `--write` merekam penilaian baru (append, dengan
alasan) lewat API.

Operating equipment dihitung terpisah dan **tidak** ditulis: akrual cadangan OFF atas
keputusan pemilik (`--include-oe` untuk melihat angkanya).

### 12.3 Reklas CIP — dan apakah cocok dengan bagan klien

Cocok, dan bentuk akunnya menentukan bentuk jurnalnya:

```
1031803001 + sufiks unit   Contract In Progress (CIP) HO … C013   → 14 akun, SATU per unit
10215xx + seri + unit      famili tujuan                          → 769 akun, per sub-famili
```

CIP klien **tidak** dipecah per famili — pekerjaan yang belum selesai belum menjadi jenis
barang apa pun. Itulah sebabnya 0215 mewajibkan penilaian yang mengkapitalisasi menyebut
famili tujuannya. Jurnalnya, sekarang diposting oleh `assess_asset`
(migrasi `0242`, `source_kind = ASSET_CAPITALIZATION`):

```
debit   fixed_asset       @ unit, qualifier = sub-famili tujuan    (10215*)
kredit  work_in_progress  @ unit, qualifier = 1031803001           (1031803*)
```

**Yang ditolaknya:** aset yang biayanya tidak pernah masuk `1031803*` di sistem ini — yaitu
setiap baris hasil impor sampai saldo awal dibawa masuk. Penolakannya menyebut akun dan
angkanya, karena perbaikannya adalah entri cutover, bukan mengulang klik. Tanpa penjaga itu
kredit tersebut membuat akun klien sendiri negatif dan menyebut selisihnya "pekerjaan
selesai".

Meaning `work_in_progress` ditambahkan ke katalog dan dipetakan ke 14 akun itu oleh
`map_asset_accounts.py`. **`1031802 Pre Opening` sengaja belum**: ia punya dua sub —
`1031802001` biaya dan `1031802002` *Akumulasi Amortisasi Pre Opening* — jadi pre-opening
**diamortisasi**, bukan disusutkan, dan itu modul kecil tersendiri (baris 22).
