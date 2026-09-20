# Bagan akun 43 — akun adalah baris laporan, identitas adalah kunci baris

**Nama-namanya milik klien** (0296): Biaya bukan Beban, Aktiva bukan Aset, Hutang bukan Utang, Depresiasi, Supplier, Principal, Affiliasi, Piutang Dagang — semuanya diambil dari nama group bagan mereka sendiri.

**Tanggal:** 18 September 2026 · **Status:** usulan lengkap, dibandingkan dengan usulan 30 akun pihak lain (§11), menunggu perintah *jalankan*  
**Sumber:** `~/Downloads/Laporan_Master_Account1.csv` (7.528 baris, 6.908 akun posting); bagan di head (318 baris, 190 posting); `docs/coa-cube.md` (376 arti); `docs/coa-final.md` (usulan 175); `docs/finance-coa-usage-2024-2025.md`; `outputs/coa_20260918/Proposed_30_Account_Structure.xlsx` (usulan 30 akun, 18 Sep 2026).  
**Berkas:** `outputs/coa_thirty/remap-190-to-43.csv` (peta lengkap, 190 baris) · `outputs/coa_thirty/build-doc.py` (dokumen ini dibangkitkan, bukan ditulis tangan)

> Pertanyaan pemilik: *"can we make the account sit on around thirty accounts? can we use dimension or tables, or anything?"* — lalu: *"compare with those, who is right"*

---

## 0. Masukan pemilik yang menentukan jawabannya (18 Sep 2026)

1. **Satu badan hukum** — 1 kantor pusat + 13 toko fashion. Ekuitas milik perusahaan, bukan per unit. Akun antar-unit menjadi kliring internal semata: totalnya **wajib nol** setiap saat dan hilang saat konsolidasi.
2. **Hanya HO yang menyentuh akun unit.** Toko melihat tiga pot kasnya sendiri (laci · kas kecil · modal kasir) dan tidak ada yang lain. Semua akun ber-`unit` diisi oleh HO atas nama toko — sumbu `unit` adalah *label yang dipilih HO*, bukan hak akses toko.
3. **Akuntan diperkirakan menerima** bagan ringkas, dengan syarat kode lama tetap bisa dicetak (§5 butir 6).

---

## 1. Aturannya, satu kalimat

**Sebuah akun ada hanya kalau ia baris di neraca atau laba-rugi. Semua pembeda lain — bank mana, rak yang mana, PPh pasal berapa, listrik atau air — adalah kunci di baris jurnal, diselesaikan oleh tabel yang hampir semuanya sudah ada.**

Bagan klien memanggang identitas ke dalam kode: 6.908 akun untuk 382 arti, dan 382 arti untuk ±40 baris laporan. Kita sudah mencabut sumbu *unit* (→190). Yang tersisa di 190 itu masih identitas: 36 jenis rak, 14 rekening bank, 26 komponen gaji kembar.

---

## 2. Hitungannya

| Tahap | Akun posting | Faktor |
|---|---:|---:|
| Bagan klien | 6.908 | |
| Cabut sumbu unit & unit-lawan (`coa-cube.md`) | 382 | 18× |
| Bagan di head hari ini (0243–0277) | 190 | 2× |
| **Cabut sumbu identitas (dokumen ini)** | **43** | **4×** |


### 2.1 Sumbu yang masih terpanggang di 190, dan di mana identitasnya sudah tinggal

| Sumbu | Template klien | Kolom / tabel yang sudah ada | Status |
|---|---:|---|---|
| unit (×14) | semua | `journal_line.site_id` | ✅ |
| unit lawan (9 keluarga matriks) | 126 | `journal_line.counter_site_id` | ✅ |
| kelas aset (Rak 1–36, FFE ×7, AC/Lift/…) — harga, akumulasi, penyusutan, cadangan, penggantian | ~170 | `journal_line.asset_id` → `fixed_asset` | ✅ kolom; ❌ `asset_class` harus jadi tabel sendiri (§7) |
| identitas bank (giro · tabungan · deposito · giro keluar · pinjaman per bank) | 33 | `journal_line.bank_account_id` → `company_bank_account`, FK memaksa akun & rekening sepakat | ✅ |
| jenis pajak (5 hutang + 6 dibayar dimuka) | 11 | `tax_type` | ✅ |
| pemberi pinjaman / pemilik | 15 | `financing_facility`, `principal` | ✅ |
| tender & kanal penjualan | 10 | `sales_posting_line` | ✅ |
| pemasok | 3 | `journal_line.supplier_id` | ✅ |
| **kategori** (52 beban + 26 komponen gaji + 10 akrual + 9 prepaid + 4 uang muka + pot kas + jenis pendapatan) | ~105 | **tidak ada** | ❌ **satu kolom baru: `journal_line.category_code`** |

Hanya satu kunci yang belum ada. Sisanya tinggal dipakai.

---

## 3. Bagan 43

Kode empat digit numerik (CHECK `^[0-9]+$` di `ledger_account` tetap berlaku), **akar sama dengan bagan klien** (1 aset · 2 kewajiban · 3 ekuitas · 4 pendapatan · 5 HPP · 6 beban operasional · 7 penyusutan · 8 lain-lain & pajak) — sehingga `financial_statements.rs`, yang mengelompokkan dengan `root_class`, tidak berubah sama sekali.

| Kode | Nama | English | Dimensi | D/C | Kunci baris | ← akun head | ← daun klien |
|---|---|---|---|---|---|---:|---:|
| `1101` | Cash On Hand | _Cash on hand_ | unit | D | pot | 4 | 42 |
| `1102` | Cash In Bank | _Cash in bank_ | company | D | bank_account | 14 | 157 |
| `1201` | Piutang Dagang | _Card and settlement receivables_ | unit | D | tender | 3 | 28 |
| `1202` | Piutang Lain-lain | _Other receivables_ | unit | D | party | 3 | 42 |
| `1209` | Cadangan Penghapusan Piutang Tak Tertagih | _Allowance for doubtful receivables_ | unit | C | party | 1 | 42 |
| `1301` | Persediaan | _Inventory_ | unit | D | item_class | 2 | 154 |
| `1302` | Barang Dalam Perjalanan | _Goods in transit_ | unit | D | counter_unit + item_class | 2 | 392 |
| `1309` | Cadangan Kerusakan atau Kehilangan Barang | _Allowance for inventory damage and loss_ | unit | C | item_class | 1 | 28 |
| `1401` | Biaya Dibayar Dimuka | _Prepaid expenses_ | unit | D | prepaid_kind | 6 | 126 |
| `1402` | Pajak Bayar Dimuka | _Prepaid taxes_ | company | D | tax_type | 6 | 84 |
| `1403` | Uang Muka | _Advances_ | unit | D | advance_purpose | 4 | 56 |
| `1501` | Piutang (Hutang) Affiliasi Antar Unit | _Inter-unit current account_ | unit | D | counter_unit + reason | 5 | 1.176 |
| `1601` | Aktiva Tetap | _Fixed assets_ | unit | D | asset_stage + asset | 9 | 784 |
| `1602` | Intangible Asset | _Intangible assets_ | unit | D | asset → asset_class (pre-opening = kelas) | 2 | 42 |
| `1609` | Akumulasi Penyusutan Aktiva Tetap | _Accumulated depreciation_ | unit | C | asset → asset_class | 6 | 252 |
| `1610` | Reserve Replacement Operating Equipment | _Operating equipment replacement reserve_ | unit | C | asset → asset_class | 1 | 504 |
| `1619` | Akumulasi Amortisasi | _Accumulated amortisation_ | unit | C | asset → asset_class | 2 | 42 |
| `2101` | Hutang Supplier | _Trade payables_ | company | C | supplier | 2 | 28 |
| `2102` | Hutang Supplier - Suspend | _Supplier payable — suspense_ | company | C | supplier | 1 | 14 |
| `2103` | Outstanding Giro | _Cheques issued not cleared_ | company | C | bank_account | 1 | 71 |
| `2201` | Hutang Pajak | _Taxes payable_ | company | C | tax_type | 6 | 70 |
| `2301` | Biaya Yang Masih Harus Dibayar | _Accrued expenses_ | unit | C | accrual_kind | 4 | 140 |
| `2401` | Uang Muka Penjualan | _Customer deposits and voucher liability_ | company | C | — | 2 | 1 |
| `2402` | Kewajiban Poin Member | _Member points liability_ | company | C | — (BLOCKED, §18) | 0 | 0 |
| `2501` | Pinjaman Bank | _Bank loans_ | company | C | facility | 2 | 140 |
| `2502` | Pinjaman Principal | _Owner loans_ | company | C | principal | 3 | 224 |
| `3101` | Modal Setor | _Paid-in capital_ | company | C | principal | 1 | 14 |
| `3102` | Prive | _Drawings_ | company | D | principal | 1 | 14 |
| `3201` | Laba (Rugi) Ditahan | _Retained earnings_ | company | C | — | 1 | 14 |
| `4101` | Penjualan | _Sales_ | unit | C | tender / channel | 10 | 126 |
| `4201` | Potongan Penjualan | _Sales discounts_ | unit | D | — | 1 | 14 |
| `4202` | Retur Penjualan | _Sales returns_ | unit | D | — | 1 | 14 |
| `4301` | Pendapatan Lain-lain | _Other income_ | unit | C | income_kind | 5 | 85 |
| `5101` | Harga Pokok Pembelian | _Cost of goods sold_ | unit | D | cost_kind | 2 | 28 |
| `5102` | Kehilangan Barang & Selisih Stock Opname | _Shrinkage and stocktake variance_ | unit | D | loss_kind | 2 | 28 |
| `6101` | Biaya Penjualan | _Selling expenses_ | unit | D | expense_category | 7 | 98 |
| `6201` | Biaya Pegawai | _Personnel expenses_ | unit | D | pay_component | 13 | 364 |
| `6301` | Biaya Administrasi dan Umum | _General and administrative expenses_ | unit | D | expense_category | 37 | 560 |
| `6401` | Biaya Sewa | _Rent_ | unit | D | expense_category | 4 | 56 |
| `7101` | Biaya Depresiasi dan Amortisasi | _Depreciation and amortisation_ | unit | D | depreciation_kind + asset | 8 | 784 |
| `8101` | Biaya Bunga | _Interest expense_ | company | D | facility | 2 | 28 |
| `8201` | Pajak Penghasilan | _Income tax expense_ | company | D | tax_type | 1 | 14 |
| `8301` | Biaya Lain-lain | _Other expenses_ | unit | D | other_expense_kind | 0 | 0 |
| | **43 akun** | | 28 unit · 15 company | | | **188** | **6.880** |

Dua baris head yang tidak menjadi akun: `3013001003 Laba (Rugi) bulan berjalan` → **diturunkan**, bukan diposting; `1031801001 Disposed Inventory` → **dipensiunkan** (nol dua tahun, tak punya arti dalam model aset register).

Contra: `1209`, `1309`, `1609`, `1610`, `1619` (aset), `4201` (pendapatan), `3102` (ekuitas).

---

## 4. Kunci baris

`journal_line` hari ini sudah membawa `site_id` · `counter_site_id` · `bank_account_id` · `asset_id` · `supplier_id`. Ditambah **satu**:

```
line_category(code, family, name, name_en, is_active)
journal_line.category_code → line_category(code)
ledger_account.category_family  -- NULL = akun ini tidak menerima kategori
```

Satu tabel, banyak keluarga — bukan satu tabel per keluarga. Aturannya persis meniru `dimension` dan `requires_counter_site` yang sudah ada: akun yang mendeklarasikan `category_family` **menolak** baris tanpa kategori dari keluarga itu; akun tanpa deklarasi menolak baris yang membawanya.

| Keluarga | Dipakai oleh | Nilai (dari bagan klien) |
|---|---|---|
| `pot` | 1101 | DRAWER · PETTY · FLOAT · TRANSIT |
| `tender` | 1201, 4101 | CASH · DEBIT_BCA · DEBIT_MANDIRI · DEBIT_BRI · DEBIT_BNI · CREDIT_VISA · CREDIT_MASTER · QRIS · ONLINE_OWN · ONLINE_MARKETPLACE · OTHER |
| `party` | 1202, 1209 | EMPLOYEE · STORE_MANAGER · MANAGEMENT · CREDIT · DEBIT |
| `item_class` | 1301, 1302, 1309 | MERCHANDISE · SUPPLIES |
| `prepaid_kind` | 1401 | INSURANCE · RENT_LAND · RENT_STORE · RENT_HOUSE · MAINTENANCE · RENT_VEHICLE · PROMOTION · PERMIT · OTHER |
| `advance_purpose` | 1403 | TRAVEL · PURCHASE · CONTRACTOR · OTHER |
| `reason` | 1501 | FINANCING · GOODS · OTHER |
| `accrual_kind` | 2301 | PAYROLL · THR_BONUS · INTEREST · MEDICAL · INSURANCE_BPJS · TELEPHONE · ELECTRICITY · WATER · RENT_STORE · RENT_HOUSE |
| `deduction_kind` | 4201 | DISCOUNT · RETURN |
| `income_kind` | 4301 | INTEREST · ROUNDING · RENT_BUILDING · RENT_EQUIPMENT · MANAGEMENT_FEE · CASH_VARIANCE · OTHER |
| `cost_kind` | 5101 | COGS · PURCHASE_DISCOUNT (kontra-HPP, §11.3) |
| `loss_kind` | 5102 | SHRINKAGE · DAMAGE |
| `expense_category` | 6101, 6301, 6401 | 7 penjualan · 25 umum · 10 pemeliharaan · 5 asuransi/pajak · 4 sewa — nama klien apa adanya |
| `pay_component` | 6201 | SALARY · OVERTIME · MEAL · TRANSPORT · MEDICAL · BPJS · THR · UNIFORM · RECREATION · FUNERAL · TRAINING · SEVERANCE · BONUS |

Tiga kunci **bukan** kategori karena masternya sudah ada dan lebih kaya: `tax_type` (1402, 2201, 8201), `financing_facility` (2501, 8101), `principal` (2502, 3101, 3102). Aset (1601, 1602, 1609, 1610, 1619, 7101) memakai `asset_id`; kelasnya dibaca dari register.

---

## 5. Invarian — yang sudah ada dan yang baru

1. **Setiap baris membawa `unit`, tidak pernah NULL** — sudah (`site_id NOT NULL`). Akun `company` dipaksa `unit = HO` — sudah, sejak 0262.
2. **`1501` berjumlah nol untuk seluruh perusahaan, setiap saat** — baru, konsekuensi langsung dari *satu badan hukum*. Satu `SELECT sum(debit)-sum(credit) … WHERE account_code='1501'` = 0, ditegakkan di `finance_close_readiness()` sebagai blocker. Hari ini invarian yang sama tersebar di 5 akun afiliasi dan tidak pernah diuji.
3. **Setiap akun ber-kunci adalah akun kontrol**: saldonya sama dengan sub-ledgernya. `finance_controls()` sudah memeriksa PREPAID · TAX · ADVANCE · FINANCING · AP · INTERUNIT · BANK · FIXED_ASSET; dengan 43 akun, itu **seluruh neraca** — invarian yang lebih kuat dari hari ini, bukan lebih lemah.
4. `requires_counter_site` hanya pada `1302` dan `1501` — CHECK `ledger_account_counterparty_is_rare` ditulis ulang dari 7 kode ke 2.
5. **Keluarga kategori harus cocok dengan deklarasi akun** — baru (§4).
6. **Kode klien adalah *view*, bukan kunci.** `legacy_code(account, unit, counter_unit, kunci)` mengembalikan 12 digit lama; totalitasnya sudah dibuktikan di §6: 6.908 daun klien → 43 akun tanpa sisa. Akuntan tetap bisa mencetak neraca saldo dalam kode mereka untuk pembanding 2024–2025. Ini yang membuat pembalikan arah 0247/0253 (tangga & nama klien dipulihkan) bisa dipertanggungjawabkan.
7. **Aturan posting tetap tidak pernah menyebut kode akun** — `poster.rs` dan 74 `semantic_key` tidak berubah (§6.2).

---

## 6. Peta 190 → 43

Peta lengkap 190 baris ada di `outputs/coa_thirty/remap-190-to-43.csv`. Diturunkan dari head dengan aturan per keluarga 7 digit + pengecualian eksplisit; **0 baris tak terpetakan, 0 akun tujuan kosong**. Aturan yang sama dijalankan atas 6.908 daun klien: **0 sisa** (kolom terakhir §3).

### 6.1 Sepuluh peleburan terbesar (daun klien)

| Daun | → | Akun |
|---:|---|---|
| 1.176 | → | `1501` Piutang (Hutang) Affiliasi Antar Unit |
| 784 | → | `1601` Aktiva Tetap |
| 784 | → | `7101` Biaya Depresiasi dan Amortisasi |
| 560 | → | `6301` Biaya Administrasi dan Umum |
| 504 | → | `1610` Reserve Replacement Operating Equipment |
| 392 | → | `1302` Barang Dalam Perjalanan |
| 364 | → | `6201` Biaya Pegawai |
| 252 | → | `1609` Akumulasi Penyusutan Aktiva Tetap |
| 224 | → | `2502` Pinjaman Principal |
| 157 | → | `1102` Cash In Bank |

### 6.2 74 arti (`semantic_key`) → akun baru

`account_map` berhenti memetakan arti ke *akun* dan memetakan arti ke **(akun, kategori)**. Kunci-kuncinya tetap; `poster.rs` tetap menyebut arti. Yang mapped di dev hari ini (61 dari 74; 13 sisanya adalah kunci baru yang seed belum petakan):

| semantic_key | akun baru | kunci baris |
|---|---|---|
| `accrued_expense` | `2301` | <name> |
| `accumulated_depreciation` | `1609` | <asset class> |
| `advance` | `1403` | <name> |
| `advance_purchase` | `1403` | <name> |
| `affiliate_payable` | `1501` | FINANCING, GOODS |
| `affiliate_receivable` | `1501` | FINANCING, GOODS |
| `asset_disposal_result` | `4301` | OTHER |
| `bank_admin_fee` | `6301` | <name> |
| `bank_giro` | `1102` | <bank account: giro> |
| `bank_savings` | `1102` | <bank account: tabungan> |
| `card_fee` | `6101` | <name> |
| `card_receivable_credit` | `1201` | CREDIT |
| `card_receivable_debit` | `1201` | DEBIT |
| `cash` | `1101` | DRAWER |
| `cash_in_transit` | `1101` | TRANSIT |
| `cash_variance` | `4301` | OTHER |
| `cashier_float` | `1101` | FLOAT |
| `cogs` | `5101` | COGS |
| `depreciation_expense` | `7101` | <asset class> |
| `expense_cleaning` | `6301` | <name> |
| `expense_electricity` | `6301` | <name> |
| `expense_household` | `6301` | <name> |
| `expense_misc` | `6301` | <name> |
| `expense_repairs` | `6301` | <name: maintenance> |
| `expense_stationery` | `6301` | <name> |
| `expense_telephone` | `6301` | <name> |
| `expense_transport` | `6301` | <name> |
| `expense_water` | `6301` | <name> |
| `fixed_asset` | `1601` | <asset class> |
| `giro_outstanding` | `2103` | <bank account> |
| `goods_in_transit` | `1302` | MERCHANDISE |
| `interest_expense` | `8101` | <facility: bank> |
| `interest_income` | `4301` | INTEREST |
| `inventory` | `1301` | MERCHANDISE |
| `loan_principal` | `2502` | <principal> |
| `non_merchandise_payable` | `2101` | <supplier: non-merchandise> |
| `payroll_payable` | `2301` | <name> |
| `petty_cash` | `1101` | PETTY |
| `pph23_payable` | `2201` | <tax type> |
| `prepaid_expense` | `1401` | <name> |
| `purchase_discount` | `5101` | PURCHASE_DISCOUNT |
| `purchase_price_variance` | `5101` | PURCHASE_DISCOUNT |
| `qris_receivable` | `1201` | QRIS |
| `replacement_expense` | `7101` | <asset class> |
| `replacement_reserve` | `1610` | <asset class> |
| `revenue_cash` | `4101` | CASH |
| `revenue_credit` | `4101` | <CREDIT_network> |
| `revenue_debit` | `4101` | <DEBIT_bank> |
| `revenue_qris` | `4101` | QRIS |
| `rounding` | `4301` | ROUNDING |
| `sales_discount` | `4201` | — |
| `sales_return` | `4202` | — |
| `stock_loss` | `5102` | SHRINKAGE |
| `store_manager_receivable` | `1202` | STORE_MANAGER |
| `supplier_suspend` | `2102` | <supplier> |
| `tax_on_interest` | `8201` | <tax type> |
| `time_deposit` | `1102` | <bank account: deposito> |
| `trade_payable` | `2101` | <supplier: merchandise> |
| `vat_in` | `1402` | <tax type> |
| `vat_out` | `2201` | <tax type> |
| `voucher_liability` | `2401` | VOUCHER |

13 kunci yang belum ter-seed jatuh ke: `capital_contributed`→3101, `owner_drawings`→3102, `pph21_payable` `pph29_payable` `pbb_payable` `pph_final_payable`→2201, `pph25_credit`→1402, `intangible_asset`→1602, `work_in_progress`→1601 (kelas CIP), `accumulated_amortisation`→1619, `amortisation_expense`→7101, `bad_debt_expense`→6301, `other_income_expense`→4301.

---

## 7. Yang berubah, yang tidak

### 7.1 Berubah (urutan migrasi)

1. `line_category` + `journal_line.category_code` + `ledger_account.category_family`; CHECK keluarga-cocok-akun (trigger, seperti `assert_period_open`).
2. `asset_class` menjadi tabel milik asset register; `fixed_asset.category_code` dan `asset_class_reserve.class_code` berhenti menunjuk `ledger_account`. Ini sekaligus menutup bug qualifier 10-vs-7 karakter yang membuat depreciation run menolak aset impor (`coa-final.md` §7.4).
3. 43 baris `ledger_account` baru (+ 8 group per akar); 190 baris lama → `is_active = false`; `ledger_account_remap` diisi 190 baris (hari ini **0 baris**).
4. `account_map` mendapat kolom `category_code`; 61 baris di-remap mekanis dari CSV §6; `resolve_account` mengembalikan (akun, kategori).
5. Kebijakan posting (`posting_mode`, `manual_je_policy`, `account_source_rule`) di-seed ulang untuk 43 akun; DENY per `source_kind` yang tadinya membedakan akun sekeluarga (mis. biaya bank vs konsultan) pindah ke DENY per kategori.
6. `company_bank_account.ledger_account_code` → semua `1102`; FK `journal_line_bank_account_agrees_with_the_account_posted` tetap berlaku apa adanya.
7. Rujukan akun di dokumen: `store_deposit` (drawer/bank), `cash_count`, `prepaid_schedule`, `advance_settlement`, `supplier_invoice_expense_line`, `supplier_credit_note`, `bank_statement*` → kode baru + kategori.
8. CHECK `ledger_account_counterparty_is_rare` → `{1302, 1501}`; `ledger_account_carries_no_unit` tetap.
9. `legacy_code()` sebagai fungsi SQL + layar *Trial balance (kode klien)*.
10. Frontend: pemilih akun menjadi pemilih **akun + kategori** (dua kotak, kategori terfilter oleh keluarga akun); 37 layar finance memakai `account_code` sebagai teks — tidak ada yang mengasumsikan panjang 10.

### 7.2 Tidak berubah

`poster.rs` · `PostingIntent`/`PostingLine` · 74 `semantic_key` · `journal_entry_source_kind_check` (40 jenis) · `fiscal_period` & tutup buku · semua sub-ledger (prepaid, tax, advance, principal, financing, asset) · `financial_statements.rs` (mengelompokkan `root_class`) · `assert_journal_balanced_per_site` · `sales_posting` (menyebut arti, bukan kode).

---

## 8. Rekomendasi untuk yang pemilik belum yakin

1. **Beban karyawan: satu akun (`6201`), bukan dua.** 26 template kembar klien (`6010111` *operation* vs `6010210` *office*) adalah sumbu **unit** yang ditulis dua kali: *office* = HO, *operation* = C001–C013. Satu akun × `unit` × `pay_component` mereproduksi kedua keluarga itu sebagai laporan tanpa kehilangan satu angka pun — dan SPT 1771-II hanya meminta satu baris gaji.
2. **43, bukan 30.** Sepuluh akun yang membuatnya 43 dan bukan 30 masing-masing adalah baris yang akuntan ingin lihat *di muka laporan*, bukan di lampiran: Prive terpisah dari Modal · Barang diterima belum ditagih terpisah dari Hutang usaha · Pinjaman pemilik terpisah dari Pinjaman bank (pihak berelasi) · Susut terpisah dari HPP (P&L ritel) · Sewa terpisah dari umum (Rp 1,35 M/tahun, 21% belanja HO) · dua Cadangan pada dua baris neraca berbeda · Cadangan penggantian OE terpisah dari Akumulasi (mekanismenya sendiri: `asset_replacement_charge`) · Pajak dibayar dimuka terpisah dari Biaya dibayar dimuka (sub-ledger berbeda) · Aset takberwujud & akumulasi amortisasinya terpisah dari aset tetap (baris neraca PSAK; §11.3). Semua **bisa** dilebur — detailnya tetap ada di kunci baris — jadi 30 vs 43 hanya soal apa yang tampil di neraca saldo, bukan apa yang tersimpan.
3. **Pendapatan per tender tetap satu akun** (`4101` × `tender`); laporan per kanal dibaca dari kategori. 26 dari 28 daun *online* klien sudah mati.
4. **Akrual satu akun** (`2301` × `accrual_kind`); dibalik periode berikutnya, rinciannya di dokumen.
5. **Nama 14 unit** (CIKUPA = C001?) hanya memengaruhi *view* kode lama (akhiran `00`–`13`), bukan bagan baru. Bisa dikonfirmasi belakangan tanpa memindahkan satu rupiah pun.

---

## 9. Kapan

**Sebelum saldo awal dimuat, bukan sesudah.** Hari ini `ledger_account_remap` kosong dan belum ada jurnal produksi di bagan ini; perubahannya adalah satu rangkaian migrasi + satu CSV. Setelah saldo awal dan hari dagang produksi mendarat, setiap rupiah harus di-remap dan setiap laporan yang sudah dibagikan harus direkonsiliasi ulang. Tempatnya di rangkaian go-live: **sebelum Blok C (opening balance & cutover)**, sesudah Blok A/B yang sudah selesai.

Ukuran: ±6 migrasi, `ledger.rs` (`resolve_account`, `required_semantic_keys` mendapat kategori), `account_map` API + layar, pemilih akun di frontend, seed ulang `seed-finance.py`, dan tes integrasi yang menyebut kode 10 digit (fixture memakai bagan milik migrasi, jadi kebanyakan ikut otomatis).

---

## 10. Yang tidak dilakukan dokumen ini

Tidak ada migrasi yang ditulis. Tidak ada kode yang berubah. Bagan di head tetap 318/190, semua gate tetap hijau. Dokumen ini adalah putusan yang menunggu satu kata: *jalankan*.

---

## 11. Perbandingan dengan `Proposed_30_Account_Structure.xlsx` (18 Sep 2026)

Usulan pihak lain: 8 sheet — 30 *main account*, 70 *detail type* (D001–D070, masing-masing dengan *allowed main account*), 16 dimensi kandidat (231 nilai), 499 aturan per keluarga, dan *crosswalk* 7.528 baris. Keputusannya per daun: **3.248 proposed · 3.604 review required · 56 unresolved**. Dibuat *system-independent*, tanpa mengetahui skema kita, jumlah badan hukum, model akses, atau nama toko — dan jujur mengatakannya.

### 11.1 Kesimpulan: kerangkanya sama; selisihnya adalah fakta yang mereka tidak punya, ditambah dua hal yang mereka benar

**Desainnya identik.** *Main account + detail type yang wajib dan terkontrol + sub-ledger* adalah persis `ledger_account` + `line_category`/`category_family` + sub-ledger di §4. Dari 499 aturan keluarga mereka, **6.852 dari 6.908 daun** jatuh ke pasangan (akun mereka → akun kita) yang satu-ke-satu atau satu-ke-sedikit tanpa pertentangan makna; 56 daun mereka biarkan *unresolved*. Tidak ada satu pun daun yang mereka taruh di kelas laporan yang berbeda dari kita (aset vs kewajiban, pendapatan vs beban), kecuali tiga yang dibahas di §11.3.

### 11.2 Setiap bendera *review* / *unresolved* mereka dijawab oleh fakta yang sudah kita pegang

| Bendera mereka (daun) | Fakta kita | Akibatnya di bagan ini |
|---|---|---|
| Antar-unit: *confirm same-entity vs separate legal entity … preserve interunit matching without netting* (1.372) | **Satu badan hukum** (pemilik, 18 Sep). Dalam satu entitas saldo antar-unit bukan aset/kewajiban — ia tereliminasi. | Satu akun bertanda `1501`, wajib nol; lawan tetap di `counter_site_id`, jadi *gross per pasangan* tetap terbaca tanpa menjadi 2 akun (mereka: `1210` + `2200`, dicampur dengan piutang pegawai dan akrual — invarian eliminasinya tidak bisa ditulis per akun). |
| BDP: *confirm whether named unit is origin or destination* (392) | Dibuktikan di `coa-cube.md`: pemilik = akhiran 2 digit, lawan = indeks template. | `1302` × `counter_site_id`. |
| Reserve Replacement OE: *accumulated depreciation, inventory allowance, or provision?* (504) + beban penggantiannya (504) | Mekanisme klien yang sudah kita bangun: `asset_replacement_rate` / `asset_replacement_charge` (0213). | Kontra-aset sendiri `1610`; bebannya di `7101` (klien memfilekannya di akar 7, keluarga penyusutan — mereka menaruhnya di opex `6200`). |
| Kapitalisasi OE, HGB/land right, pre-opening: *review policy* (546) | Aset register + `asset_class` (§7.1 butir 2); HGB = kelas aset; pre-opening = aset tangguhan diamortisasi (klien 1031802). | Kelas aset, bukan akun. |
| `1031803 Contract In Progress`: *construction asset or customer contract?* (14) | CIP = keputusan ketiga kapitalisasi (0213, `docs/asset-register`). | `1601` × kelas CIP. |
| `1031801 Disposed Inventory` (14) | Nol dua tahun; tak punya arti di model aset/persediaan kita. | Dipensiunkan. |
| `8010110007 Pendapatan (Biaya) Lain-Lain`: *split by substance; sign alone is insufficient* (14) | Sistem kita **tidak pernah memposting ke sana berdasarkan tebakan substansi**: yang mendarat adalah arti bernama — `cash_variance`, `asset_disposal_result`, `other_income_expense`. | `4301` × `income_kind`; substansinya adalah kategori, bukan tanda. |
| `8030112001 Current Tax PPh 25`: *instalment (1410) or expense (8100)?* (14) | Dipakai kernel sebagai `tax_on_interest` (potongan pajak atas bunga bank). Angsuran PPh 25 punya arti sendiri (`pph25_credit` → 1402). | `8201` × `tax_type`; nama klien yang menyesatkan tidak ikut. |
| Y/N: *meaning unknown, do not drop N rows* (104) | N = non-aktif (`coa-final.md` §1); 104 daun, 0 template mati seluruhnya. | Tidak ada yang dibuang; `is_active`. |
| Syarat mereka: *use only if the system enforces dimensions, dimension trial balance, subledger controls* | Itu tepat yang sudah ada: CHECK/trigger per akun (0261–0268), `assert_journal_balanced_per_site`, `finance_controls()`, laporan dari `root_class`. | Syaratnya terpenuhi — jadi *if*-nya sendiri memutuskan untuk bagan kecil. |

### 11.3 Dua hal yang mereka benar, dan bagan ini berubah karenanya

1. **Aset takberwujud terpisah dari aset tetap** (`1600`/`1690` mereka). Aturan §1 dokumen ini — *akun = baris laporan* — menuntut hal yang sama: *aset takberwujud* adalah baris neraca sendiri (PSAK), bukan kelas dari aset tetap. Bagan ini bertambah dua: `1602 Aset takberwujud & aset tangguhan` dan `1619 Akumulasi amortisasi` (software, pre-opening). 38 → **40**.
2. **Potongan pembelian adalah kontra-HPP, bukan pendapatan lain** (`D063` → `5100` mereka). Secara akuntansi persediaan (PSAK 14) diskon dagang mengurangi harga perolehan; klien memfilekannya di akar 8 (*Potongan Pembelian* di bawah *Pendapatan & Biaya Lain-lain*) — kebiasaan, bukan prinsip. Dipindah: `8010110003` dan kunci `purchase_discount`/`purchase_price_variance` → `5101` × `PURCHASE_DISCOUNT`. **Perlu persetujuan akuntan** karena mengubah wajah laba kotor dibanding laporan 2024–2025 mereka; *view* kode lama tetap mencetaknya di tempat lama.

### 11.4 Yang dipertahankan, dan alasannya

| Mereka | Kita | Alasan |
|---|---|---|
| `1100` Kas, bank & deposito (satu akun, 199 daun) | `1101` Kas (unit) + `1102` Bank (company) | Dimensinya berbeda — toko memegang kas, **tidak pernah** rekening (kebijakan pemilik). Satu akun berarti `dimension` tidak bisa dideklarasikan per akun, dan FK `bank_account_id ↔ akun` kehilangan gigi. Deposito = kelas rekening di `company_bank_account`, bukan akun. |
| `1210`/`2200` antar-unit sebagai *detail* di akun campuran | `1501` sendiri, bertanda | §11.2 baris pertama. Ini satu-satunya tempat usulan mereka **lebih lemah** untuk klien ini, bukan hanya berbeda. |
| `2400` jatuh tempo ≤1 th + `2500` jangka panjang | `2501` satu akun | Porsi lancar **diturunkan dari jadwal** `financing_installment` pada tiap tanggal neraca — bukan *inferred once at migration* (kekhawatiran mereka, yang sah), dan tanpa jurnal reklas berkala. |
| `1400` prepaid + uang muka | `1401` + `1403` | Dua sub-ledger dengan perilaku berbeda: `prepaid_schedule` mengalokasikan per bulan; `advance` diselesaikan per dokumen. |
| `2100` termasuk *suspense* | `2101` + `2102` | GRNI adalah akrual tanpa faktur; kontrol AP (`supplier_invoice`) tidak menutupinya. |
| `2200` termasuk *Principal payable* | `2502` Pinjaman pemilik | Pihak berelasi; punya register `principal`; baris pengungkapan sendiri. |
| `6200` opex tunggal (1.232 daun: penjualan, umum, sewa, pemeliharaan, penggantian OE, pembulatan) | `6101` · `6301` · `6401` (+ `7101`, `4301`) | Sewa Rp 1,35 M/tahun dan beban penjualan adalah baris laporan; pembulatan ikut tandanya di `4301`; penggantian OE mengikuti akar 7 klien. |
| dimensi `function` / cost center (Store operations · Office · Selling · Administration · Maintenance) | tidak ada | *Office* vs *operation* = **unit** (HO vs toko), sudah ada di setiap baris; *selling/administration/maintenance* = akun `6101`/`6301` + kategori. Mereka sendiri menulis *"function defaults are inferred from source headings"* — yang bisa diturunkan tidak perlu diketik. `coa-final.md` §3 sudah menolak cost center. |
| tabel `legal_entity` | tidak ada | Satu badan hukum. |

### 11.5 Yang bisa diambil dari mereka tanpa mengubah bagan

- Urutan migrasi 6 langkah dengan bukti selesai per langkah (sheet *Proposal*) — lebih rapi dari §9 dan cocok jadi `docs/finance-migration.md` bagian *cutover*.
- *Never import both current-result balances and the same underlying P&L twice* — persis alasan `3013001003` diturunkan, bukan diposting.
- Sheet *Dimension Values* (84 `expense_type`, 58 `asset_type`) adalah daftar nilai awal `line_category` dan `asset_class` yang sudah diketik — tinggal dipetakan ke kode kita.

