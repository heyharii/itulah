# Finance & Asset — audit kode, bukti accounting, dan apa yang dibangun

Tanggal: 2026-09-09 · Branch: `feat/handheld-rfid` · Prototype: `frontend-hub/src/screens/finance-lab/`

---

## 0. Temuan yang mengubah bentuk pekerjaan ini

Sebelum apa pun dibangun, satu fakta harus disebut lebih dulu karena mengubah
seluruh jawaban atas rencana:

> **Sebagian besar yang diminta rencana ini sudah ada di repository, di dua branch
> sebelah yang belum di-merge.**

| Branch | Isi | Migrasi |
|---|---|---|
| `feat/finance-control` | 22 modul Rust Finance baru: `sales_posting.rs`, `interunit.rs`, `cash.rs`, `giro.rs`, `payment_allocation.rs`, `payment_execution.rs`, `payment_ledger.rs`, `period_close.rs`, `opening.rs`, `reserves.rs`, `corrections.rs`, `integrity.rs`, `stock_ledger.rs`, `store_money.rs`, `acquirer.rs`, `bank_rules.rs`, `transaction_categories.rs`, `batches.rs`, `payables_flow.rs`, … | 0107–0158 (49 file) |
| `feat/finance-control-ui` | 14 layar hub baru: `attention`, `cash-bank`, `interunit`, `giro`, `pay`, `expenses`, `asset-value`, `acquirer`, `close-verdict`, `store-control`, `memorial`, `ledgers`, `bank-transactions`, `store-writes` | idem |
| `feat/handheld-rfid` (ini) | 0040–0106 + `0159` (charge_kind & lot aset) + `0160` (satu aset dibayar beberapa kali) | 89 file |

Nomor migrasinya **tidak bertabrakan** (mine: 0159/0160; theirs: 0107–0158),
kecuali satu: nomor `0106` dipakai dua kali dengan isi berbeda
(`a_statement_can_arrive_on_its_own` vs `a_tender_says_which_acquirer_took_it`).
Itu harus diselesaikan sebelum kedua lane bertemu.

**Konsekuensi praktis:** membangun engine Finance baru di branch ini akan
menjadi modul paralel — persis yang §2 larang. Jadi yang dibangun di sini adalah
**harness kontrak**, bukan mesin kedua. Lihat §5.

**Konsekuensi lain:** DB dev `inventory_tanstack` sudah dimigrasi sampai versi
**157** oleh lane finance. Backend dari branch ini tidak akan jalan di atasnya.

---

## 1. Eksplorasi codebase — apa yang sudah ada

Tidak ada `AGENTS.md` maupun `CLAUDE.md` di project. Konvensi dibaca dari kode
dan komentar migrasi, yang di repo ini sangat panjang dan menjelaskan alasan.

### 1.1 Fondasi ledger — sudah ada, dan matang

| Hal | Di mana | Keadaan |
|---|---|---|
| Bagan akun klien, verbatim | `backend/migrations/postgres/0050_ledger.sql` → tabel `ledger_account` | 7.528 akun, tangga `{1,3,5,7,10,12}`, `site_id` dari sufiks, `counterparty_site_id` untuk BDP. **Terisi di DB dev.** |
| Peta makna → akun | `0050` tabel `account_map` (`semantic_key` × `site_id` × `qualifier`) | 695 baris terisi |
| Jurnal append-only | `0051_journal.sql` | Trigger: seimbang (deferred, di COMMIT), period lock (`FOR SHARE`), anti-UPDATE/DELETE |
| Satu pintu posting | `backend/src/cloud/postgres/poster.rs` | `post()` + `reverse()`. Reversal menyalin akun asli — persis yang §5 minta |
| Resolver | `postgres/ledger.rs:resolve_account` + `assert_postable` | Menolak unmapped, menolak heading, menolak inactive |
| Katalog makna | `ledger.rs:required_semantic_keys()` | 34 kunci dengan `expects`, `qualified`, `needed_for` |
| Trial balance & saldo | `ledger.rs` | **Tidak pernah disimpan** — selalu dijumlah dari `journal_line` |
| Period close | `0050` tabel `fiscal_period` + `http/finance.rs` | OPEN/CLOSED |
| Aset | `0070_fixed_assets.sql`, `postgres/assets.rs` (1.592 baris), `domain/depreciation.rs` | `fixed_asset` (fakta, **tanpa kolom uang**) vs `asset_capitalization` (keputusan Finance, append-only) |
| Depresiasi | `assets.rs` + `0083` | `source_kind = 'DEPRECIATION'`, rule `depreciation/1` |
| OE ≠ depresiasi | `0159` (branch ini) dan `0139` (branch finance) | **Dua desain independen atas masalah yang sama** — lihat §3.4 |
| Aset dibayar beberapa kali | `0160` (branch ini) | `supplier_invoice_expense_line.asset_id`, N baris → 1 aset |
| Payment + alokasi | `postgres/payments.rs`, `0084` | `supplier_payment` + `payment_allocation`, DRAFT → POSTED |
| Payables | `payables.rs` (820 baris), `0052`, `0094`, `0098` | Bill barang & non-barang |
| Bank | `banking.rs`, `0071`, `0095` | Import statement, suggestion, match, book unmatched line |
| Intake statement | `0106`, `statement_intake.rs` | IMAP/folder → aturan → 3 pembaca |
| Audit | `0078_audit_log.sql`, `postgres/audit.rs` | |
| Navigasi Finance | `frontend-hub/src/screens/finance/nav.ts` | 11 layar: Overview, Supplier bills, Payments, Cash & bank, Assets, Journal, Reports, Ledger, Chart of accounts, Account map, Period close |
| Design system | `frontend-hub/src/components/ui/*` (36 komponen) | shadcn/base-ui, TanStack Query/Table/Router, Tailwind v4 |

### 1.2 Yang **belum** ada di branch ini (tapi ada di `feat/finance-control`)

| Fungsi | Branch ini | `feat/finance-control` |
|---|---|---|
| Posting penjualan POS | **Tidak ada.** `source_kind='SALE_DAY'` dideklarasikan sejak 0051 dan tidak pernah ditulis | `sales_posting.rs` (1.617 baris) |
| Interunit | Hanya semantic key | `interunit.rs`, `0120`, `0122` |
| Dokumen kas (BKK/BKM) | Tidak ada | `cash.rs`, `0115` |
| Giro | Hanya semantic key | `giro.rs`, `0117`, `0119` |
| Payment ledger generik | Hanya supplier payment | `payment_ledger.rs`, `payment_allocation.rs`, `0143`–`0145`, `0152`, `0153` |
| Close berbasis checklist | Flip status saja | `period_close.rs` (822 baris), `0126`, `0127` |
| Saldo awal / cutover | Tidak ada | `opening.rs` (1.523 baris), `0158` |
| Koreksi sebagai dokumen | Hanya `poster::reverse` + manual JE | `corrections.rs`, `0129` |
| Persamaan integritas | Tidak ada | `integrity.rs` (2.418 baris, 10 persamaan) |
| Attention engine | Tidak ada | `0124_attention_items.sql` |
| Reserve OE | `charge_kind` di 0159 | `reserves.rs`, `0139` |
| Settlement kartu | Tidak ada | `acquirer.rs`, `0135` |

### 1.3 Matrix keputusan

| Area | Sudah tersedia | Kekurangan | Keputusan |
|---|---|---|---|
| Chart of accounts | `ledger_account`, 7.528 akun klien | — | **Reuse** |
| Resolver akun | `account_map` + `resolve_account` | Dimensi bank ambigu (giro/tabungan), binding tanpa masa berlaku & versi, tidak ada policy "akun ini dilarang di unit ini" | **Extend** — didemokan di `finance-lab/engine/{bindings,resolver}.ts` |
| Journal / poster | `poster.rs`, satu pintu, seimbang, period lock, reversal pakai akun asli | Tidak ada `book_id` eksplisit; idempotency tidak per-step; otorisasi bukan bagian dari post | **Extend** |
| Posting rule | 7 rule hard-coded di Rust (`bank_line/1`, `supplier_payment/1`, `depreciation/1`, `asset_disposal/1`, `asset_transfer/1`, bill, `manual/1`) | Tidak ada objek rule yang membawa bukti / kesiapan / aktivasi; tidak bisa dimatikan per buku | **Extend** — dimodelkan di `finance-lab/engine/rules.ts` |
| Payment | `supplier_payment` + alokasi ke invoice | Alokasi hanya ke supplier invoice, bukan ke akrual/interunit; hanya DRAFT→POSTED, tidak ada requested/approved/instructed/failed | **Extend** |
| Aset — register | `fixed_asset` (tanpa uang) + `asset_capitalization` | — | **Reuse**, desainnya sudah benar |
| Aset — biaya majemuk | `0160` (branch ini) | Belum ada UI | **Reuse + UI baru** |
| Aset — depresiasi | `domain/depreciation.rs`, run bulanan | Konvensi bulan pertama belum ditetapkan; pembulatan belum ditetapkan | **Extend** — dijawab di §3.1 |
| OE replacement | `0159` (ini) / `0139` (sana) | Keduanya menganggap ada akrual reserve bulanan; bukti menyanggah | **Perbaiki kontrak** — §3.4 |
| Sales posting | tidak ada di sini, ada di sana | — | **Jangan bangun ulang** |
| Interunit / BDP | tidak ada di sini, ada di sana | Aturan penerimaan barang belum punya bukti di mana pun | **Jangan bangun ulang; buktinya diminta** |
| Design system | 36 komponen `components/ui` | — | **Reuse** |

---

## 2. Bukti accounting — apa yang benar-benar dikatakan datanya

Semua di bawah ini hasil parsing berkas sumber, bukan kutipan dari dokumen
rancangan. Skrip ada di scratchpad sesi; angkanya bisa direproduksi.

### 2.1 Jurnal C006 Juli 2026

`Laporan_Jurnal1 C006 JULY 2026 (6).csv` — **13.339 baris, 2.187 dokumen,
45 akun**, dan **setiap dokumen seimbang** (0 dokumen tidak seimbang).

> Catatan: rencana menyebut 14.031 baris / 2.188 dokumen / 47 akun. Selisihnya
> baris judul dan baris memo lanjutan yang tidak membawa akun. Tidak material.

Lima jenis dokumen:

| Jenis | Baris | Dokumen |
|---|---|---|
| Penjualan Cash | 11.434 | 1.958 |
| Surat Jalan Distribusi | 1.680 | 147 |
| BKK | 176 | 70 |
| JURNAL MEMO | 36 | 6 |
| BKM | 13 | 6 |

**Pola penjualan (1.958 dokumen):**

| Bentuk | Dokumen |
|---|---|
| Dr Cash on Hand / Cr Penjualan Tunai + Dr HPP / Cr Persediaan | 1.648 |
| Dr **Cash In Bank Tabungan BCA** / Cr Penjualan Debit Card + Dr HPP / Cr Persediaan | 290 |
| Tunai + kartu dalam satu dokumen | 2 |
| Dengan retur | 3 |

→ Kartu **masuk bank langsung** saat checkout. HPP **satu kali** per dokumen,
berapa pun jumlah tendernya. Tidak ada akun diskon di dokumen penjualan mana
pun — pendapatan dicatat neto.

**Setoran hasil penjualan (23 BKK):**
`Dr 201230200106 Hutang Affiliasi Atas Barang HEAD OFFICE - C006 / Cr Cash on Hand`.
Uang toko **tidak keluar sebagai pendapatan** — ia melunasi utang barang ke HO.

**Surat Jalan Distribusi (147):**
`Dr 101120300706 BDP Barang Dagangan WIRAMODE - C006 / Cr Hutang Affiliasi Atas Barang`.
Total debit BDP bulan itu **Rp470.488.453,26**, **kredit BDP nol**.

**Tiga keluarga afiliasi, semuanya dipakai di bulan yang sama:**

| Akun | Dipakai untuk |
|---|---|
| `2012302` Hutang Affiliasi Atas Barang | barang (SJD naik, setoran turun) |
| `2012301` Hutang Affiliasi Pembiayaan | 5 BKK melunasi dari bank unit |
| `2012303` Hutang Lain-lain Principal | dana gaji masuk (BKM) |

Semantic key yang ada sekarang (`affiliate_payable` → `2012301*`) **hanya
menutup satu dari tiga**. `2012302` — yang paling sering bergerak — tidak punya
makna sama sekali.

### 2.2 Payroll — segitiga tiga dokumen, satu hari

| Dokumen | Isi |
|---|---|
| `C006-GL-26-07-00004` (31 Jul) | Dr Biaya Gaji 57.250.000 + Dr BPJS 1.913.489 + 1.249.739 / Cr **YMHD Gaji** 57.250.000 + Cr **YMHD BPJS** 3.163.228 |
| `C006-BKM-26-07-00003` (31 Jul) | Dr PETTY CASH 61.913.500 / Cr **Hutang Lain-lain Principal** |
| `C006-BKK-26-07-00046` (31 Jul) | Dr YMHD Gaji 57.250.000 + Dr YMHD BPJS 1.913.489 + 1.249.739 + Dr Biaya Rumah Tangga 1.500.000 (`GAJI PETUGAS LUAR`) + 272 (`ROUNDED`) / Cr PETTY CASH 61.913.500 |

Empat hal yang ini tetapkan:
1. YMHD gaji dan YMHD BPJS adalah **dua kewajiban terpisah**;
2. `GAJI PETUGAS LUAR` **tidak diakrual** — biaya langsung di pembayaran;
3. pendanaan mengkredit **Principal**, bukan Pembiayaan;
4. akrual, pendanaan, dan pembayaran **semuanya 31 Juli**. Tidak ada tanggal 1.

Ini juga bukti langsung bahwa **satu payment harus punya baris alokasi**: satu
dokumen menjawab dua akrual dan dua biaya langsung.

### 2.3 Aset — pengadaan langsung

`KK-26-07-00276` (27 Jul): `Dr 102150600106 FFE Office C006 348.276 /
Cr 101100300106 Cash In Bank Tabungan Bank BCA C006`.

Ini **satu-satunya** baris ke `10215*` di seluruh bulan. Pengakuan aset **adalah**
dokumen pembayaran; tidak ada entri kapitalisasi terpisah.

### 2.4 Depresiasi — direkonsiliasi penuh

`GL-26-07-00004` (31 Jul), 9 baris, **Rp4.683.970**.

Direplay dari `MASTER ASSET.xls` (46 baris C006):

| Konvensi mulai | Aset membebankan | Total |
|---|---|---|
| kolom **PERIODE** (bulan register) | 13 | Rp15.748.763 |
| kolom **TGL BELI** (bulan pembelian) | **9** | **Rp4.683.970** ✅ |

Sembilan baris cocok **rupiah demi rupiah**. Empat yang gugur adalah aset
10 tahun yang dibeli 2016-01-01 dan didaftar di PERIODE 201702 (Bangunan
Tambahan, Air Conditioner, Genset, Instalasi Mekanikal Elektrikal): pada
konvensi tanggal beli, bulan terakhirnya Desember 2025.

**Jadi:**
- jadwal dimulai di **bulan TGL BELI**, bukan bulan PERIODE;
- `PERIODE` tetap harus disimpan (itu tanggal pengarsipan, dan sejak Juni 2026
  memakai awal bulan) tapi **tidak boleh menggerakkan aritmetika**;
- beban bulanan **dipotong ke rupiah bulat**, bukan dibulatkan, bukan dipotong
  ke sen. `1.329.100 / 60 = 22.151,67` → klien memposting `22.151`.

Ini menjawab open question "bulan pertama penyusutan masih perlu dipastikan".

### 2.5 OE / Reserve Replacement — bukti **menyanggah** dua desain di repo

Di seluruh jurnal C006 Juli 2026:

- postingan ke `1021607*` (Reserve Replacement): **nol**
- postingan ke `7010215*` (Biaya Replacement): **nol**

Padahal register C006 memuat **15 baris operating equipment senilai ±Rp190 juta**,
dan semuanya berstatus aktif. Kolom METODE-nya `NON DEPRECIABLE`.

Dua desain di repository menganggap ada akrual reserve bulanan:
`0139` (`feat/finance-control`) dan `0159` (branch ini). Keduanya sampai pada
kesimpulan itu dari **struktur COA saja**. Instruksi pemilik ("jangan membuat
reserve replacement bulanan hanya karena akun RR tersedia") dan jurnal aktual
**sepakat menyanggahnya**.

`0139` juga menetapkan bahwa pembelian pengganti **menarik reserve**
(`Dr replacement_reserve / Cr payable`). Instruksi pemilik mengatakan pembelian
pengganti **langsung menjadi biaya replacement**. Keduanya tidak bisa benar.

Satu bulan satu unit belum konklusif — akrualnya bisa saja di HO. Tapi akun OE
C006 bersufiks `06`, jadi akrual berskop C006 akan memposting ke C006. Tidak
terjadi.

### 2.6 Kartu — praktik sekarang

- checkout: `Dr Cash In Bank Tabungan BCA / Cr Penjualan Debit Card` (290 dokumen)
- akhir periode `C006-GL-26-07-00003`: `Dr Piutang Debit Card / Cr Cash In Bank BCA`
- settlement `C006-BKM-26-07-00002`: `Dr Bank + Dr Credit Card Expenses / Cr Piutang Debit Card`

Model clearing sejak checkout adalah **perubahan kebijakan**, bukan perbaikan.

### 2.7 Jurnal HO — belum ada

Dua berkas `Laporan_Jurnal1 C006 JULY 2026 BY HO*.csv` ternyata **identik
baris-per-baris** dengan ekspor C006 (13.339 baris, 2.187 dokumen, 45 akun yang
sama; perbandingan konten menghasilkan `True`). Keduanya jurnal unit, bukan
pasangan HO. Pemeriksaan dua sisi interunit tidak bisa dilakukan.

### 2.8 AC C004 — tiga sumber, tiga jawaban

| Sumber | Nilai | Unit |
|---|---|---|
| BKK | Rp26.390.000 | C004 |
| Screenshot modul aset | Rp33.390.000 | C004 |
| `MASTER ASSET.xls` baris 1 | Rp26.390.000 | **HO** (`FFE Toko dan Gudang HO`, PERIODE 202607, TGL BELI 2026-06-16) |

Migrasi `0160` menjelaskan Rp33.390.000 = 25.000.000 + 1.390.000 + 7.000.000
(pembayaran awal Juni). Itu menjelaskan selisih nilai, **tidak** menjelaskan
kenapa Excel menaruhnya di HO. Ditampilkan sebagai masalah rekonsiliasi.

---

## 3. Perbaikan kontrak — apa yang salah di v0.1 dan bagaimana diperbaiki

Berkas asli `finance_master_matrix_v0.1 (1).json` dipertahankan apa adanya.
Revisi ada di **`finance-master-matrix-v0.2.json`** dengan `changes[]` yang
menyebut setiap perubahan. Ringkasnya:

### 3.1 Account resolver

| Cacat v0.1 | Perbaikan |
|---|---|
| `BANK_CUSTODY` + `BCA` ambigu antara giro & tabungan (idem Mandiri/BRI/BNI) | Dimensinya bukan bank, tapi **identitas rekening terdaftar** (`BCA-TAB-C006`). 8 rekening terdaftar, nol pasangan ambigu. `engine/bindings.ts` |
| Rule menyeleksi `SALARY`, binding difilekan `GAJI_PEGAWAI` | Kedua sisi memakai `AccountRole` yang sama — union tertutup, mismatch jadi type error |
| `ALLOWANCE_EXPENSE` tanpa binding | Dibinding ke `601031000306`, bukti: `GAJI PETUGAS LUAR` di `C006-BKK-26-07-00046` |
| Placeholder bebas `<EXPENSE_ROLE>`, `<CASH_OR_BANK_ROLE>` | 26 peran tertutup dan bertipe |
| Resolver boleh mengembalikan kosong / banyak | Menolak nol **dan** menolak >1, dengan pesan berbeda. `engine/resolver.ts` |
| Flag COA dan kebijakan posting per unit tercampur | `Account.postable` (deklarasi klien) terpisah dari `blocked_units` (kebijakan kita). Contoh nyata: `2012001001` diblokir di toko |
| Binding tanpa masa berlaku / versi | Setiap binding punya `valid_from`, `valid_to?`, `version` |

### 3.2 Posting rule

| Cacat | Perbaikan |
|---|---|
| Aktivasi per baris | Aktivasi **per paket**, utuh. `RulePackage.activation` |
| Satu penjualan bisa menghasilkan HPP per tender | HPP dihitung dari **penjualan**, bukan dari tender. Diuji di skenario F |
| Bruto/neto tidak ditetapkan | **Neto**, tanpa baris kontra diskon — sesuai dokumen klien. Ditulis di `caveats` |
| YMHD satu baris | Dua kewajiban terpisah, bisa dialokasikan sendiri-sendiri |
| Pembayaran unit vs pembayaran HO untuk unit | Alokasi lintas unit **ditolak** dengan alasan, bukan diposting ke buku yang salah |
| Pendanaan tidak menetapkan pasangan | `funding_type` **wajib** di event; engine menolak event yang tidak menyebutkannya |
| Transfer antar buku pakai rule kas satu buku | `book_id` eksplisit di setiap entri; rule antar-buku dipisah |
| Pembalikan me-resolve ulang | `Ledger.reverse` menyalin **akun asli**. Diuji di skenario H |
| Kondisi & formula sebagai teks bebas | `AmountBasis` tertutup (`FIELD`/`SUM`/`PER`/`BALANCING`) + `alt_group` untuk baris alternatif. Tidak ada string yang dieksekusi |
| Rule bisa berbeda dari dokumentasinya | `conformance()` membandingkan apa yang builder hasilkan dengan apa yang paket deklarasikan |

### 3.3 Payment & open item

Lifecycle enam status: `REQUESTED → APPROVED → INSTRUCTED → SETTLED / FAILED`,
lalu `RECONCILED`. **Hanya SETTLED yang memposting.** Klik Bayar bukan transfer
bank. Approval hanya boleh oleh `FINANCE_MANAGER`.

Alokasi menunjuk ke **open item** *atau* ke **biaya langsung** — keduanya perlu,
karena satu BKK klien memuat keduanya. `outstanding` dan `reserved` dua angka
berbeda: yang pertama dari payment yang sudah settle, yang kedua dari yang masih
di jalan.

### 3.4 Reserve OE — kontrak diubah oleh bukti

`oe_reserve_accrual` **dideklarasikan lengkap dan dimatikan**, dengan
`evidence.kind = "COA_ONLY"` dan alasan penolakan yang menyebut angkanya.
`oe_replacement` aktif dan mendebit **`REPLACEMENT_EXPENSE`**, bukan reserve.
Diuji di skenario D: tidak ada nilai register yang berubah, tidak ada jadwal
baru, dan `REPLACEMENT_RESERVE` **tidak punya binding sama sekali** sehingga
aturan apa pun yang menyebutnya akan ditolak dan menyebut namanya.

### 3.5 Integritas ledger

Ada sejak baris pertama, bukan di rilis akhir: `book_id` eksplisit; seimbang per
buku diperiksa sebelum apa pun ditulis; nilai **integer minor unit**; posting
atomik dan **idempotent per (dokumen, langkah)**; period lock; otorisasi bagian
dari `post()`; `rule_version` (`paket@versi`) di setiap entri; empat tanggal
terpisah (`occurred_on`, `document_on`, `posting_on`, `period`).

---

## 4. Flow GA–Finance

Satu data aset, dua kewenangan, satu register.

```
GA                                         Finance
──                                         ───────
Ajukan kebutuhan
        │
        └──► persetujuan ──► pembelian ──► Bayar Pengadaan  ── posting perolehan
                                   │              │
Terima barang ◄────────────────────┘              │
Pemasangan selesai                                │  (biaya pemasangan =
        │                                         │   event kedua, aset sama)
Lengkapi identitas, lokasi,                       │
penanggung jawab, kondisi, bukti ────────────►  Periksa komponen harga perolehan
        │                                         │
        │                                       Tetapkan buku/unit, akun, kategori,
        │                                       metode, umur, periode
        │                                         │
        │                                       Aktivasi ── TIDAK memposting lagi
        │                                         │
        │                                       Penyusutan bulanan (review → post)
        │                                         │
Ajukan mutasi / pelepasan / ───────────────►    Kendalikan dampak accounting
penggantian OE
```

**Enam status yang berbeda dan tidak dipaksa jadi satu:** pengadaan, penerimaan
barang, pembayaran, pengakuan accounting, kelengkapan register, pemakaian fisik.

Aturan yang mengunci: **jika pembayaran sudah membentuk jurnal pengadaan,
melengkapi atau mengaktifkan register tidak boleh membentuk jurnal kedua.** Di
model ini `AssetCostComponent.entry_id` yang sudah terisi adalah buktinya —
skenario A memeriksa persis ini.

GA tidak pernah memilih debit dan kredit: `MAY_POST.GA = false` di `ledger.ts`,
jadi bukan sekadar tombol yang disembunyikan.

---

## 5. Prototype

`frontend-hub/src/screens/finance-lab/` — modul hub tersendiri, memakai design
system project, **berlabel Simulasi di setiap halaman**, dan **tidak menyentuh
jaringan sama sekali**.

Kenapa modul terpisah dan bukan layar di dalam Finance: trial balance simulasi
yang duduk tiga baris di bawah trial balance sungguhan, dengan ikon yang sama,
adalah screenshot yang menunggu disalahpahami di rapat.

```
engine/
  types.ts         kontrak: event, binding, rule, journal, payment, asset
  chart.ts         654 leaf akun klien (HO, C004, C006) verbatim dari CSV
  bindings.ts      130 binding + 8 rekening bank terdaftar
  resolver.ts      role + dimensi + tanggal → akun, atau penolakan bernama
  ledger.ts        satu pintu: seimbang, period lock, idempotent, otorisasi, reversal
  rules.ts         14 paket rule dengan bukti / kesiapan / aktivasi
  payments.ts      open item, alokasi, lifecycle 6 status
  depreciation.ts  konvensi bulan pertama, truncation, rekonsiliasi
  fixtures.ts      46 baris register C006, 9 baris depresiasi aktual
  scenarios.ts     skenario A–H dengan assertion
  book.ts          satu buku ter-seed yang dibaca dan DIUBAH semua layar
state.ts           useSyncExternalStore ke buku itu
```

Layar: Overview · Skenario · Assets & Projects · Cash & Bank · Accruals/YMHD ·
Interunit & Principal · Accounting & Close · Kontrak · Cakupan menu.

### Tindakan yang benar-benar bisa dicoba

Bukan gambar. Semuanya lewat engine yang sama dengan skenario — tidak ada jalur
kedua, dan tidak ada layar yang menulis entri sendiri.

| Di mana | Tindakan | Yang bisa dilihat |
|---|---|---|
| Assets | Pilih bulan → **Posting** penyusutan | Preview per aset dengan alasan tiap yang tidak membebankan; entri muncul; menekan lagi mengembalikan entri yang sama, bukan entri kedua |
| Assets | **Bayar Penggantian OE** | Debit Biaya Replacement; saldo akun aset OE dan reserve tetap Rp0; nilai register tidak berubah |
| Assets | Filter unit / kelas / beban / status + pencarian, dengan total yang ikut menyempit | |
| Assets | Toggle GA ↔ Finance | Kolom dan tindakan berubah; GA tidak punya satu pun tindakan yang menghasilkan jurnal |
| Cash & Bank | **Setujui → Kirim instruksi → Bank mengonfirmasi** (atau **Bank menolak**) | Jurnal baru muncul di langkah terakhir; menekan Settle dari draft ditolak dengan alasan; FAILED bisa dikirim ulang |
| Accruals | Buka kewajiban | Payment yang sama persis dengan yang di Cash & Bank — nomor sama, jurnal sama, bukan record kedua |
| Accounting & Close | **Tutup / Buka** periode | Posting ke bulan tertutup ditolak; uang muka AC Juni adalah contohnya |
| Accounting & Close | **Balikkan** entri | Entri pembalik memakai kode akun asli; pembalikan kedua ditolak |

Diverifikasi lewat browser dan headless. Contoh keluaran headless:

```
2026-08: 9 charging 4.683.970 -> posted SJV-000019 4.683.970
re-run 2026-08 -> REPLAY, no new entry
  settle from APPROVED -> refused: ... it can only go to INSTRUCTED or CANCELLED
  bank refuses -> FAILED entry: none
  retried and settled -> SETTLED entry: SJV-000022 57.250.000
reverse SJV-000010 -> SJV-000023 | same accounts: true
reverse again -> refused: SJV-000010 has already been reversed
entries 18 -> 23, trial balance balanced: true
```

### Cara membuka

```bash
cd frontend-hub && npm run dev
```

Lalu buka `/finance-lab`. Tidak perlu backend — modul ini sepenuhnya di browser.
(Modul lain di hub akan menampilkan error state tanpa backend; itu normal.)

---

## 6. Hasil pengujian

`58 dari 58 check lolos.` Dijalankan di browser dan headless.

| Skenario | Check | Yang dibuktikan |
|---|---|---|
| A — pengadaan langsung | 6/6 | `Dr FFE Office 348.276 / Cr BCA 348.276`, dua baris; mendaftarkan aset tidak menambah jurnal kedua; retry mengembalikan entri yang sama |
| B — pengadaan + pemasangan | 5/5 | 2 pembayaran → 1 aset, harga perolehan Rp26.390.000, biaya bank Rp5.000 **di luar**; tiga sumber yang berbeda ditampilkan sebagai selisih |
| C — depresiasi bulanan | 7/7 | 9 aset, Rp4.683.970, **cocok baris demi baris** dengan `GL-26-07-00004`; run ulang tidak menggandakan; konvensi PERIODE terbukti salah sebesar Rp11.064.793 |
| D — replacement OE | 6/6 | Debit `Biaya Replacement OE - Rack 1 C006`; akun aset OE tidak tersentuh; register tidak berubah; tidak ada jadwal baru; rule reserve menolak dan menyebut alasannya |
| E — payroll | 10/10 | Akrual memisah gaji & BPJS; petugas luar tidak diakrual; pendanaan ke Principal; draft tidak bisa settle; satu payment 4 alokasi Rp61.913.500; kedua akrual lunas; satu record terlihat di dua menu |
| F — penjualan campuran | 10/10 | HPP satu baris; pendapatan neto; tidak ada kontra diskon; tunai ke kas, kartu ke bank; tidak ada piutang kartu saat checkout; reklas akhir bulan |
| G — penolakan | 7/7 | Dua binding cocok → ditolak; rule mati → ditolak dengan alasan bukti; akun diblokir di unit → ditolak; periode terkunci → ditolak; retry → satu entri; GA → NOT_AUTHORISED |
| H — koreksi | 7/7 | Pembalikan memakai **akun jurnal asli** walau binding sudah pindah ke BNI; akun rata; pembalikan kedua ditolak |

### Keterbatasan

- Ini membuktikan **kontrak**, bukan bahwa Finance siap produksi. Buku produksi
  ada di Postgres dan tidak disentuh.
- Fixture memampatkan 2.187 dokumen menjadi ~18 entri. Bentuknya klien, volumenya bukan.
- Skenario B adalah **simulasi**, dinyatakan sebagai simulasi, karena sumbernya
  sendiri belum cocok.
- Buku simulasi tidak punya saldo awal, jadi saldo kas negatif. Disebutkan di layar.
- `npx tsc -b` di `frontend-hub` masih melaporkan 3 error **yang sudah ada
  sebelumnya** di `screens/commercial/price-form.tsx` (2) dan
  `screens/finance/badges.ts` (1) — file yang tidak disentuh pekerjaan ini.
  Modul `finance-lab` sendiri bersih.
- Buku simulasi hidup di memori. Me-reload halaman mengembalikannya ke keadaan
  seed — disengaja: sebuah lab yang menyimpan state antar sesi adalah lab yang
  cepat berubah menjadi buku kedua.

---

## 7. Keputusan accounting yang masih dibutuhkan

| # | Pertanyaan | Memblokir | Bukti yang diminta |
|---|---|---|---|
| P0 | Jurnal penerimaan barang yang membersihkan BDP | `interunit_receipt` (mati), dan **arti saldo Persediaan**. Dua bentuk sama-sama masuk akal dan selisihnya persis sebesar barang di rak | Satu jurnal penerimaan barang sisi unit |
| P0 | Apa yang memilih Pembiayaan vs Principal | Resolver penerimaan dana. Sekarang wajib disebut di event dan ditolak kalau kosong | Kebijakan tertulis, atau tiga contoh berbeda |
| P0 | Jurnal HO pasangan Juli 2026 | Pemeriksaan dua sisi interunit. Berkas "BY HO" ternyata duplikat ekspor unit | Ekspor jurnal HEAD OFFICE Juli 2026 |
| P1 | Apakah reserve OE dibentuk bulanan, dengan tarif berapa | `oe_reserve_accrual` (mati). **Dua desain di repo mengasumsikan ya; bukti mengatakan tidak** | Tarif + basis, atau satu jurnal reserve nyata |
| P1 | Kartu: bank-dulu-lalu-reklas, atau clearing sejak checkout | `card_clearing_at_checkout` (mati). Ini keputusan kebijakan, bukan bukti | Keputusan pemilik |
| P1 | AC C004: Rp26,39 jt atau Rp33,39 jt; C004 atau HO | Nilai perolehan dan unit satu aset | Konfirmasi klien |
| P1 | Contoh jurnal stock adjustment / kehilangan | Mapping varians persediaan | Satu contoh aktual per jenis |
| P2 | Kapan liability supplier barang diakui (terima / invoice / giro) | Aturan AP barang dagangan di HO | Satu siklus AP lengkap |
| P2 | Akun `102140300100` bernama "Piutang Affiliasi **Lain-lain**", bukan "Principal" | Penamaan peran `PRINCIPAL_RECEIVABLE` | Konfirmasi bahwa keduanya pasangan |

---

## 8. Rekomendasi lanjutan

1. **Selesaikan tabrakan nomor migrasi `0106`** antara branch ini dan
   `feat/finance-control` sebelum merge apa pun.
2. **Satukan `0139` dan `0159`.** Keduanya benar tentang "OE bukan depresiasi"
   dan keduanya salah tentang akrual bulanan. Yang bertahan sebaiknya:
   `charge_kind` dari `0159` (memisahkan *bagaimana nilai disebar* dari *apa
   beban itu disebut*), dengan `REPLACEMENT_RESERVE` **tidak diaktifkan** sampai
   tarifnya dikonfirmasi.
3. **Bawa konvensi bulan pertama ke `domain/depreciation.rs`**: mulai di bulan
   `TGL BELI`, potong ke rupiah bulat, simpan `PERIODE` sebagai tanggal
   pengarsipan yang tidak menggerakkan aritmetika.
4. **Tambahkan makna `affiliate_goods_payable`** (`2012302*`) ke
   `required_semantic_keys()`. Ini akun afiliasi yang paling sering bergerak dan
   satu-satunya yang belum punya nama.
5. **Naikkan `account_map` menjadi binding berversi** dengan masa berlaku, dan
   ganti qualifier bank menjadi identitas rekening terdaftar.
6. **Jangan bangun sales posting / interunit / cash document / payment ledger di
   branch ini.** Semuanya sudah ada di `feat/finance-control`; yang dibutuhkan
   adalah rencana merge, bukan implementasi kedua.
