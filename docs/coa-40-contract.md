# Bagan 40 — kontrak skema (lane contract)

**Status:** dibekukan 18 September 2026; **disesuaikan dengan migrasi yang benar-benar ditulis** (0287–0292 sudah ada dan lolos seluruh rantai). Setiap lane menulis kode terhadap dokumen ini.
Alasan dan perbandingannya ada di `docs/coa-thirty.md`; ini hanya bentuknya.

Migrasi **0287–0297** memiliki DDL ini dan tidak ada lane lain yang menulis di
`backend/migrations/`. Kalau sesuatu di sini ternyata salah, yang berubah adalah dokumen
ini lebih dulu, lalu migrasinya — bukan sebaliknya.

---

## 1. Tabel baru

```sql
CREATE TABLE line_category (
    category_code TEXT PRIMARY KEY CHECK (category_code ~ '^[A-Z][A-Z0-9_]*$'),
    family        TEXT NOT NULL CHECK (family ~ '^[a-z][a-z0-9_]*$'),
    name          TEXT NOT NULL CHECK (btrim(name) <> ''),   -- nama klien, tidak diterjemahkan
    name_en       TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    -- template 10 digit klien asal nilai ini, kalau ada. NULL untuk nilai yang
    -- memang tak pernah jadi akun mereka (tender, pot kas, alasan antar-unit).
    legacy_code   TEXT CHECK (legacy_code ~ '^[0-9]+$'),
    UNIQUE (category_code, family)
);
CREATE INDEX ix_line_category_family ON line_category (family, sort_order, category_code);

CREATE TABLE asset_class (
    class_code TEXT PRIMARY KEY CHECK (class_code ~ '^[A-Z][A-Z0-9_]*$'),
    name       TEXT NOT NULL,
    name_en    TEXT,
    kind       TEXT NOT NULL CHECK (kind IN ('PPE','OE','INTANGIBLE','DEFERRED')),
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    legacy_code TEXT NOT NULL CHECK (legacy_code ~ '^[0-9]+$')   -- selalu ada
);

-- 0289. Menimpa kebijakan akun untuk SATU kategori di SATU akun.
CREATE TABLE account_category_policy (
    account_code     TEXT NOT NULL REFERENCES ledger_account (account_code),
    category_code    TEXT NOT NULL REFERENCES line_category (category_code),
    posting_mode     TEXT NOT NULL,      -- AUTO_ONLY | SEMI_AUTO | MANUAL | BLOCKED
    manual_je_policy TEXT NOT NULL,      -- NO | OVERRIDE | YES
    note             TEXT,
    PRIMARY KEY (account_code, category_code)
);

-- 0291. Empat belas rekening bank runtuh ke satu `1102`; kode lamanya disimpan
-- di sini supaya `legacy_account_code()` bisa mengembalikannya.
ALTER TABLE company_bank_account ADD COLUMN legacy_ledger_account_code TEXT;
```

**149 kategori di 19 keluarga, 59 kelas aset**, semuanya diturunkan dari nama
akun klien sendiri oleh `outputs/coa_thirty/gen-categories.py`. 87 dari 140
kategori membawa `legacy_code` (kode klien asalnya); 53 sisanya adalah pembeda
yang bagan klien memang tidak pernah punya.

```sql
-- 0293. Dokumen yang menyimpan pilihan seseorang untuk diposting NANTI harus
-- menyimpan kategorinya juga, bukan hanya akunnya.
ALTER TABLE cash_document                 ADD COLUMN from_category_code TEXT REFERENCES line_category;
ALTER TABLE cash_document                 ADD COLUMN to_category_code   TEXT REFERENCES line_category;
ALTER TABLE prepaid_schedule              ADD COLUMN prepaid_category_code TEXT REFERENCES line_category;
ALTER TABLE prepaid_schedule              ADD COLUMN expense_category_code TEXT REFERENCES line_category;
ALTER TABLE supplier_credit_note          ADD COLUMN credit_category_code  TEXT REFERENCES line_category;
ALTER TABLE payment_batch                 ADD COLUMN counter_category_code TEXT REFERENCES line_category;
ALTER TABLE advance_settlement            ADD COLUMN category_code TEXT REFERENCES line_category;
ALTER TABLE supplier_invoice_expense_line ADD COLUMN category_code TEXT REFERENCES line_category;
ALTER TABLE opening_balance_line          ADD COLUMN category_code TEXT REFERENCES line_category;
```

`cash_document` **sudah punya** kolom bernama `category_code` yang berarti
`transaction_category` — konsep lain, tabel lain. Karena itu kolom di atas
bernama `from_`/`to_`, supaya tidak ada yang harus menebak `category` yang mana.

`category_code` **unik global**, bukan per keluarga: baris jurnal hanya membawa kodenya,
dan pembacaan "kategori apa ini" tidak boleh bergantung pada akun yang sedang dibaca.
Nilai yang bertabrakan antar keluarga diberi awalan keluarga (`ADVANCE_OTHER`,
`INCOME_OTHER`).

## 2. Kolom baru

```sql
ALTER TABLE ledger_account ADD COLUMN category_family TEXT
    CHECK (category_family ~ '^[a-z][a-z0-9_]*$');   -- NULL = akun ini tidak menerima kategori

ALTER TABLE journal_line ADD COLUMN category_code TEXT REFERENCES line_category(category_code);

ALTER TABLE account_map ADD COLUMN category_code TEXT REFERENCES line_category(category_code);

ALTER TABLE ledger_account_remap ADD COLUMN category_code TEXT REFERENCES line_category(category_code);
```

`fixed_asset.category_code` dan `asset_class_reserve.class_code` berhenti menunjuk
`ledger_account` dan menunjuk `asset_class(class_code)`.

## 3. Aturan kategori — trigger, bukan FK

FK gabungan `MATCH SIMPLE` tidak menutup lubangnya (satu NULL = FK tidak diperiksa), jadi
aturannya ditegakkan trigger `assert_category_matches_account`, gaya `assert_period_open`:

1. Akun dengan `category_family IS NOT NULL` **menolak** baris tanpa `category_code`.
2. Akun dengan `category_family IS NULL` **menolak** baris yang membawa `category_code`.
3. `line_category.family` baris itu **harus sama** dengan `ledger_account.category_family`.
4. Kategori non-aktif ditolak untuk posting baru.

Nama-namanya: fungsi `assert_category_fits(account_code, category_code, what)`,
dipakai oleh trigger `journal_line_category_fits` (BEFORE INSERT ON journal_line)
dan `account_map_category_fits` (BEFORE INSERT OR UPDATE ON account_map). Aturan
yang sama ditegakkan di dua ujung: sebuah baris peta yang salah adalah ribuan
baris jurnal yang salah, dan jauh lebih murah ditolak di layar Account Map.

Pesan penolakan menyebut akun, keluarga yang diminta, dan sampai 5 kode yang sah.

## 4. Bagan: 43 akun — dalam bahasa klien (0296, 0297)

Kode **4 digit**, induk = akar 1 digit yang **sudah ada** (`1`–`8`) — tidak ada baris group
baru. `root_class` tetap digit pertama, sehingga `financial_statements.rs` tidak berubah.

| code | name | dim | D/C | contra | category_family | catatan kunci |
|---|---|---|---|---|---|---|
| 1101 | Kas | unit | D | | `pot` | |
| 1102 | Bank | company | D | | | `bank_account_id` |
| 1201 | Piutang tender | unit | D | | `tender` | |
| 1202 | Piutang karyawan & lainnya | unit | D | | `party` | |
| 1209 | Cadangan piutang tak tertagih | unit | C | ✔ | `party` | |
| 1301 | Persediaan | unit | D | | `item_class` | |
| 1302 | Barang dalam perjalanan | unit | D | | `item_class` | + `counter_site_id` wajib |
| 1309 | Cadangan kerusakan persediaan | unit | C | ✔ | `item_class` | |
| 1401 | Biaya dibayar dimuka | unit | D | | `prepaid_kind` | |
| 1402 | Pajak dibayar dimuka | company | D | | `tax_kind` | |
| 1403 | Uang muka | unit | D | | `advance_purpose` | |
| 1501 | Rekening koran antar-unit | unit | D | | `interunit_reason` | + `counter_site_id` wajib |
| 1601 | Aset tetap | unit | D | | `asset_stage` | + `asset_id` |
| 1602 | Aset takberwujud & aset tangguhan | unit | D | | | `asset_id` |
| 1609 | Akumulasi penyusutan | unit | C | ✔ | | `asset_id` |
| 1610 | Cadangan penggantian operating equipment | unit | C | ✔ | | `asset_id` |
| 1619 | Akumulasi amortisasi | unit | C | ✔ | | `asset_id` |
| 2101 | Hutang usaha | company | C | | | `supplier_id` |
| 2102 | Barang diterima belum ditagih | company | C | | | `supplier_id` |
| 2103 | Giro keluar belum cair | company | C | | | `bank_account_id` |
| 2201 | Hutang pajak | company | C | | `tax_kind` | |
| 2301 | Biaya masih harus dibayar | unit | C | | `accrual_kind` | |
| 2401 | Uang Muka Penjualan | company | C | | `deferred_revenue_kind` | voucher = kategori |
| 2402 | Kewajiban Poin Member | company | C | | | 0297 — **BLOCKED** sampai nilai poin & tingkat hangus (PSAK 72, §18) |
| 2501 | Pinjaman bank | company | C | | | `financing_facility` |
| 2502 | Pinjaman pemilik | company | C | | | `principal` |
| 3101 | Modal disetor | company | C | | | `principal` |
| 3102 | Prive | company | D | ✔ | | `principal` |
| 3201 | Laba ditahan | company | C | | | |
| 4101 | Penjualan | unit | C | | `tender` | |
| 4201 | Potongan Penjualan | unit | D | ✔ | | 0297 — satu arti |
| 4202 | Retur Penjualan | unit | D | ✔ | | 0297 — barang kembali, HPP & PPN dibalik; bukan diskon |
| 4301 | Pendapatan lain-lain | unit | C | | `income_kind` | |
| 5101 | Harga pokok penjualan | unit | D | | `cost_kind` | |
| 5102 | Susut & selisih persediaan | unit | D | | `loss_kind` | |
| 6101 | Beban penjualan | unit | D | | `expense_category` | |
| 6201 | Beban karyawan | unit | D | | `pay_component` | |
| 6301 | Beban umum & administrasi | unit | D | | `expense_category` | |
| 6401 | Beban sewa | unit | D | | `expense_category` | |
| 7101 | Beban penyusutan & amortisasi | unit | D | | `depreciation_kind` | + `asset_id` |
| 8101 | Beban bunga | company | D | | | `financing_facility` |
| 8201 | Pajak penghasilan | company | D | | `tax_kind` | |
| 8301 | Biaya Lain-lain | unit | D | | `other_expense_kind` | **0296** — sisi rugi dari `Pendapatan dan (Biaya) Lain-lain` klien; rugi tidak boleh tinggal di akun pendapatan |

`code_provenance = 'PENDING_CLIENT_CODE'` untuk keempat puluh satunya: kode 4 digit ini
milik kita, nama-namanya milik klien.

**Nama di tabel §4 di atas adalah nama 0289 (buku teks). 0296 mengganti semuanya
dengan kata klien**, diambil dari nama group yang akun itu runtuh dari:
`Cash On Hand` · `Cash In Bank` · `Piutang Dagang` (bukan *tender*) · `Aktiva Tetap` ·
`Intangible Asset` · `Hutang Supplier` · `Hutang Supplier - Suspend` (kata mereka, bukan
tafsiran GRNI) · `Outstanding Giro` · `Biaya Yang Masih Harus Dibayar` · `Pinjaman
Principal` · `Piutang (Hutang) Affiliasi Antar Unit` (idiom mereka untuk akun bertanda) ·
`Harga Pokok Pembelian` (kata mereka — sistem periodik; angkanya perpetual, dicatat di
COMMENT kolom) · `Biaya Penjualan / Pegawai / Administrasi dan Umum / Sewa` ·
`Biaya Depresiasi dan Amortisasi` · `Biaya Bunga`. Aturannya: kata yang klien tidak
pakai — Beban, Aset, Utang, tender, pemasok, pemilik — **ditolak oleh assertion 0296**
pada akun aktif.

**Kebijakan posting tidak diketik tangan.** Akun mengambil kebijakan paling
LONGGAR di antara akun-akun yang melebur ke dalamnya, supaya akun itu sendiri
tidak menutup pintu yang hari ini terbuka; lalu `account_category_policy`
membawa pintu yang lebih KETAT di grain kategori (12 baris). Keduanya bersama
membuat peleburan netral terhadap pintu: setiap pintu yang klien punya tetap
persis pintu yang sama. Diturunkan oleh `outputs/coa_thirty/gen-accounts.py`.

**Dua akun tidak jadi akun apa pun**: `3013001003 Laba (Rugi) bulan berjalan`
(diturunkan dari L/R, tidak diposting — mengimpornya adalah cara menghitung laba
tahun berjalan dua kali) dan `1031801001 Disposed Inventory` (nol dua tahun, tak
punya arti di model aset/persediaan kita). Keduanya tidak punya baris di
`ledger_account_remap`, karena tabel itu menjawab "jadi apa" dan jawabannya
"tidak jadi apa-apa". **188** baris remap, **190** akun dipensiunkan.

**190 akun lama** → `is_active = false`, `posting_mode = 'BLOCKED'`,
`manual_je_policy = 'NO'`, `posting_policy_configured` tetap TRUE. Invarian
*postable == configured, unclassified == 0* karena itu tetap berlaku pada 230 baris.

## 5. Keluarga kategori

`outputs/coa_thirty/categories.tsv` memuat nilai yang diturunkan dari nama akun klien
(48 `expense_category`, 13 `pay_component`, 6 `prepaid_kind`, 4 `advance_purpose`,
4 `accrual_kind`). Keluarga selebihnya ditulis tangan di 0288 karena nilainya berasal dari
tender/pot/kelas barang, bukan dari nama akun:

| family | nilai |
|---|---|
| `pot` | `DRAWER` `PETTY` `FLOAT` `TRANSIT` |
| `tender` | `CASH` `DEBIT_BCA` `DEBIT_MANDIRI` `DEBIT_BRI` `DEBIT_BNI` `CREDIT_VISA` `CREDIT_MASTER` `QRIS` `ONLINE_OWN` `ONLINE_MARKETPLACE` `TENDER_OTHER` `VOUCHER` |
| `party` | `EMPLOYEE` `STORE_MANAGER` `MANAGEMENT` `CARD_CREDIT` `CARD_DEBIT` |
| `item_class` | `MERCHANDISE` `SUPPLIES` |
| `interunit_reason` | `FINANCING` `GOODS` `INTERUNIT_OTHER` |
| `tax_kind` | `PPH21` `PPH23` `PPH25` `PPH29` `PPH_FINAL` `PPN_IN` `PPN_OUT` `PBB` `TAX_OTHER` |
| `deferred_revenue_kind` | `VOUCHER_LIABILITY` `CUSTOMER_DEPOSIT` |
| `deduction_kind` | `DISCOUNT` `RETURN` |
| `income_kind` | `INTEREST` `ROUNDING` `RENT_BUILDING` `RENT_EQUIPMENT` `MANAGEMENT_FEE` `CASH_VARIANCE` `ASSET_DISPOSAL` `INCOME_OTHER` |
| `cost_kind` | `COGS` `PURCHASE_DISCOUNT` |
| `loss_kind` | `SHRINKAGE` `DAMAGE` |

`CREDIT_CARD` dan `DEBIT_CARD` adalah piutang kartu yang **tidak dirinci**:
peta membawa rinciannya di qualifier dan menyisakan satu baris tanpa qualifier
sebagai fallback ketika settlement tidak menyebut acquirer. Tanpa keduanya baris
itu tidak punya kategori sama sekali dan `card_receivable_*` tak bisa dipetakan.

### 5c. 0294 — empat akun yang runtuh terlalu jauh

Menjalankan estate terhadap hasil 0289 menemukan empat tempat di mana
"apakah ini satu baris laporan?" dijawab benar tetapi akibatnya tidak:

1. **`7101` kehilangan pemisahan aus vs diganti.** `7010212 Depresiasi` dan
   `7010215 Replacement OE` sama-sama mendarat di `7101`. Di neraca keduanya
   selamat (`1609` vs `1610`); di laba-rugi mereka jadi satu angka — padahal
   0159 ada justru karena klien tidak menyusutkan rak, melainkan membebankannya
   ke cadangan. → keluarga `depreciation_kind`.
2. **Kapitalisasi CIP jadi jurnal yang tak mengatakan apa-apa.** `1031803 CIP`
   dan keluarga aset tetap sama-sama mendarat di `1601`, jadi kapitalisasi
   mendebit dan mengkredit `1601` untuk `asset_id` yang sama. → keluarga
   `asset_stage`.
3. **Empat putusan pemilik diam-diam berhenti berlaku.** `account_source_rule`
   tetap menunjuk akun yang dipensiunkan 0290, dan tiga dari empat aturan itu
   lebih sempit daripada akun barunya — memindahkannya apa adanya akan
   membekukan tetangganya. → kolom `category_code` (NULL = seluruh akun).
4. **Setoran toko tak bisa lagi menyebut pot mana.** `1101` membawa laci, kas
   kecil dan modal kasir sekaligus, sedangkan `deposits::meaning_of` bekerja
   MUNDUR dari akun ke arti. → `store_deposit.drawer_category_code`.

Semuanya diperbaiki dengan cara yang sama, yang memang cara desain ini:
pembedanya jadi kategori, bukan akun. Bagan tetap 40.

### 5d. 0295 — dua lubang yang 0294 tinggalkan

1. **Peta tidak pernah menerima kategori yang 0294 minta.** 0290 mengisi
   `account_map.category_code` dari `ledger_account_remap`; 0294 baru kemudian
   memberi `7101` dan `1601` keluarganya. Trigger penjaganya BEFORE INSERT OR
   UPDATE, jadi baris yang sudah duduk di sana tak pernah diperiksa ulang dan
   tak ada error yang muncul — sementara **setiap depreciation run, amortisation
   run, replacement charge dan kapitalisasi akan ditolak** saat tombolnya
   ditekan. Tidak bisa diperbaiki seperti 0290: baris peta sudah tidak membawa
   kode klien, jadi tak ada yang bisa di-join. Yang masih mengenalinya adalah
   **artinya**, jadi kelimanya diset per `semantic_key`.
2. **`opening_balance_line` masih berkunci `(cutover_date, site_id,
   account_code)`** sejak 0158 — benar ketika satu akun berarti satu hal. Neraca
   saldo klien punya baris untuk kas laci, kas kecil DAN modal kasir; ketiganya
   `1101`, jadi yang kedua ditolak sebagai duplikat. Ditambah `counter_site_id`
   (neraca awal toko membawa posisinya terhadap kantor pusat di `1501`), dan
   kuncinya jadi `(cutover_date, site_id, account_code, COALESCE(category_code,''),
   COALESCE(counter_site_id,''))`.

0295 juga menambahkan pemeriksaan yang seharusnya sudah ada: **tidak ada baris
peta mana pun yang boleh berselisih dengan akunnya tentang apakah kategori
diminta.** Murah, menyeluruh, dan akan menangkap lubang di atas pada hari ia
terjadi.

## 5b. Jembatan kode lama (0292)

```sql
legacy_account_code(account_code TEXT, category_code TEXT DEFAULT NULL,
                    bank_account_id UUID DEFAULT NULL, is_debit BOOLEAN DEFAULT NULL)
    RETURNS TEXT    -- kode 10 digit klien, atau NULL kalau baris ini tak menentukannya
CREATE VIEW journal_line_legacy AS ...   -- satu baris jurnal + legacy_code-nya
```

Lima kasus: **kategori tahu** (130 dari 190), **tabel `legacy_code_span` tahu**
(beberapa kategori kita melipat balik ke SATU akun klien — `1011101001 Piutang
kartu Kredit` adalah satu akun untuk semua jaringan, dan pemisahan VISA/Master
tak pernah ada di bagan mereka), **`line_category.legacy_code` tahu** (kategori
yang diambil dari daun klien yang bahkan 190 kita tak pernah bawa — `Sewa Toko
Bayar Dimuka`, `THR/Insentif/Bonus/Pesangon YMHD`), **rekening bank tahu**
(`legacy_ledger_account_code`), **tanda tahu** (satu `1501` bertanda menyerap
piutang dan hutang afiliasi — debit = piutang, kredit = hutang), dan **register
aset tahu tapi fungsi ini tidak** (korespondensi keluarga biaya/akumulasi klien
bukan aturan string; `1021504` menyusut ke `7010212` dan `1021506` ke `7010214`,
tanah tidak menyusut sama sekali — mengarangnya berarti mengarang peta yang
belum diperiksa siapa pun, jadi baris aset mengembalikan NULL dan direkonsiliasi
lewat register). Batas lama tetap: 10 digit eksak, 2 digit unit masih asumsi
offset ordinal (`docs/coa-cube.md` §8).

## 6. Rust — tanda tangan yang dibekukan

`backend/src/cloud/postgres/ledger.rs`:

```rust
/// An account and the category the map chose with it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolved {
    pub account_code: String,
    pub category_code: Option<String>,
}

/// Resolve a meaning to an account AND its category. Used by the poster.
pub async fn resolve_account(
    executor: impl sqlx::PgExecutor<'_>,
    semantic_key: &str,
    site_id: &str,
    qualifier: &str,
) -> Result<Resolved, AppError>;

/// Resolve a meaning to an account code only — for callers that are asserting
/// the map is set, not posting through it.
pub async fn resolve_account_code(
    executor: impl sqlx::PgExecutor<'_>,
    semantic_key: &str,
    site_id: &str,
    qualifier: &str,
) -> Result<String, AppError>;
```

`backend/src/cloud/postgres/poster.rs`:

```rust
pub enum LineAccount {
    Meaning { semantic_key: String, qualifier: String },
    Account {
        account_code: String,
        /// Required when the account declares a category family.
        #[serde(default)]
        category_code: Option<String>,
    },
}

impl PostingLine {
    pub fn debit(account: impl Into<LineAccount>, site_id: &str, amount: i64) -> Self;
    pub fn credit(account: impl Into<LineAccount>, site_id: &str, amount: i64) -> Self;
    /// Set the category on a line built from a code.
    pub fn with_category(self, category_code: &str) -> Self;
}
```

Poster menulis `journal_line.category_code` dari hasil resolusi (`Meaning`) atau dari
`LineAccount::Account.category_code`. Pembalikan (`reverse`) **membawa** kategori,
tidak menghitungnya ulang — sama seperti `account_code` hari ini.

`validate_account_posting` harus membaca `account_category_policy` lebih dulu:
kalau ada baris untuk (account_code, category_code) posting ini, kebijakan baris
itu yang berlaku; kalau tidak ada, kebijakan akunnya. `account_source_rule`
(ALLOW/DENY per `source_kind`) tidak berubah dan tetap per akun saja.

`required_semantic_keys()` — `SemanticKeyDoc` mendapat satu field:

```rust
pub struct SemanticKeyDoc { /* … yang sudah ada … */ pub category_family: Option<String> }
```

## 7. Pembagian lane — satu file satu pemilik

| Lane | Milik | Tidak boleh disentuh lane lain |
|---|---|---|
| **migrations** | `backend/migrations/postgres/0287–0297` | semuanya |
| **kernel** | `postgres/ledger.rs`, `postgres/poster.rs` | keduanya |
| **callers** | semua `postgres/*.rs` **selain** ledger/poster, `http/*`, `domain/*`, `contract_types.rs` | |
| **frontend** | `frontend-hub/**`, `frontend-contract/**` | |
| **seed & docs** | `scripts/**`, `docs/**` selain dokumen ini | |
| **tests** | `backend/tests/**` | |

## 8. Yang TIDAK berubah

`PostingIntent` · 74 `semantic_key` (nama-namanya) · `journal_entry_source_kind_check` ·
`fiscal_period` · `assert_journal_balanced_per_site` · `financial_statements.rs`
(mengelompokkan `root_class`) · `poster::post` sebagai satu-satunya penulis jurnal ·
`sales_posting` (menyebut arti, bukan kode).
