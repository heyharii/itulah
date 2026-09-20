# Bentuk modul Finance

Satu aturan, dan semua yang lain turun dari sana:

```
KEJADIAN BISNIS
     ↓
SUBLEDGER BERTIPE
     ↓
POSTING KERNEL (poster::post)
     ↓
JURNAL
     ↓
BUKU BESAR
```

Tidak ada layar yang menulis ke buku besar langsung. Jurnal manual adalah
penanganan pengecualian, bukan alur normal.

## Bagan: 40 akun, dan sumbu-sumbu di baris jurnal

Sejak 0287–0292 bagan punya **40 akun posting**. Aturannya satu kalimat:
*sebuah akun ada hanya kalau ia baris di neraca atau laba-rugi.* Semua pembeda
lain — bank mana, rak yang mana, PPh pasal berapa, listrik atau air — adalah
kunci di baris jurnal.

Yang 190 sebelumnya tidak dihapus: mereka `is_active = false`,
`posting_mode = 'BLOCKED'`, masih memegang riwayatnya, dan
`ledger_account_remap` mencatat mana menjadi mana. Yang berakhir adalah masa
depan mereka, bukan masa lalunya.

Kode 4 digit, dan digit pertamanya tetap `root_class` — jadi laporan tidak
berubah sama sekali (lihat *Laporan* di bawah).

Sumbu yang dibawa `journal_line`, dan dari mana identitasnya datang:

| sumbu | kolom | dari mana |
|---|---|---|
| unit | `site_id` (NOT NULL) | dokumen; akun ber-`dimension = 'company'` dipaksa di kantor pusat |
| unit lawan | `counter_site_id` | wajib hanya pada `1302` dan `1501` |
| rekening bank | `bank_account_id` | `company_bank_account`, dengan FK yang memaksa akun & rekening sepakat |
| aset | `asset_id` | register aset → `asset_class` |
| pemasok | `supplier_id` | `supplier` |
| jenis pajak · fasilitas · pemilik | — | `tax_type`, `financing_facility`, `principal` |
| **kategori** | `category_code` | `line_category` — **satu-satunya yang baru** |

## Kategori: satu tabel, banyak keluarga

`line_category(category_code, family, name, …)`. Kodenya **unik global**, bukan
per keluarga: baris jurnal hanya membawa kodenya, dan pembacaan "kategori apa
ini" tidak boleh bergantung pada akun yang sedang dibaca. Nilai yang
bertabrakan antar keluarga diberi awalan keluarga (`INCOME_OTHER`,
`INTERUNIT_OTHER`).

`ledger_account.category_family` adalah deklarasinya: *akun ini menjawab
pertanyaan itu*. `NULL` berarti akun ini tidak menerima kategori sama sekali.

Aturannya ditegakkan **trigger**, bukan FK gabungan — satu NULL membuat FK
`MATCH SIMPLE` tidak diperiksa, yang persis lubang yang harus ditutup.
`assert_category_matches_account` menolak empat hal, dengan gaya
`assert_period_open`:

1. akun berkeluarga menerima baris tanpa kategori;
2. akun tanpa keluarga menerima baris berkategori;
3. kategori dari keluarga yang salah;
4. kategori non-aktif pada posting baru.

Pesan penolakan menyebut akun, keluarga yang diminta, dan sampai 5 kode yang
sah — sama seperti penolakan `account_map` yang menyebut qualifier yang ada.

140 nilai di 16 keluarga, dan nilainya **kata-kata klien sendiri**, diambil dari
nama akun mereka: 51 `expense_category`, 14 `tender`, 13 `pay_component`,
10 `accrual_kind`, 9 `prepaid_kind`, 9 `tax_kind`, 8 `income_kind`, 5 `party`,
4 `advance_purpose`, 4 `pot`, 3 `interunit_reason`, dan lima keluarga berisi dua.

`line_category.legacy_code` menyimpan template 10 digit klien yang melahirkan
tiap nilai — 87 dari 140 punya satu; sisanya (tender, pot, alasan antar-unit)
memang tidak pernah menjadi akun mereka. Itulah yang membuat kode lama bisa
dicetak kembali (`docs/finance-legacy-codes.md`).

Dua hal yang bukan kategori meski terlihat seperti kategori: **kelas aset**
(`asset_class`, 60 baris, tabel sendiri karena register aset memakainya sebagai
master) dan **jenis pajak** (`tax_type`, karena masa dan sifatnya lebih kaya
daripada sebuah nama) — walau `1402`/`2201`/`8201` tetap **juga** membawa
`tax_kind` di baris, supaya neraca saldo terbaca per pasal tanpa join ke modul
Tax.

## Subledger yang ada

| domain | tabel | yang diposting | idempoten lewat |
|---|---|---|---|
| Hari dagang | `sales_posting`, `sales_posting_line` | `SALE_DAY` | `UNIQUE (site, business_date)` + purpose `ATTEMPT_n` |
| Setoran toko | `store_deposit` | `STORE_DEPOSIT` | status + purpose `OUT`/`IN` |
| Pembelian | `supplier_invoice`, `supplier_payment` | `SUPPLIER_INVOICE`, `PAYMENT` | nomor faktur per supplier |
| Aset | `asset`, `asset_charge` | `DEPRECIATION`, `ASSET_*` | per aset per periode |
| Payroll | `payroll_run`, slip | `PAYROLL_RUN` | per run |
| **Prepaid** (0278) | `prepaid_schedule`, `prepaid_allocation` | `PREPAID_ALLOCATION` | `UNIQUE (schedule, year, month)` + purpose `P2026_10` |
| **Pajak** (0279) | `tax_type`, `tax_period`, `tax_ledger_item` | `TAX_SETTLEMENT` | `UNIQUE (period, kind, source_kind, source_id)` |
| **Uang muka** (0280) | `advance`, `advance_settlement` | `ADVANCE` | status + purpose per settlement |
| **Pemilik** (0281) | `principal`, `principal_transaction` | `MANUAL` (ber-subledger) | satu baris per gerakan |
| **Pembiayaan** (0282) | `financing_facility`, `financing_installment` | `PAYMENT` | `entry_id` pada angsuran |

## Aturan yang dipegang di seluruh modul

**Satu kejadian, satu penulis.** Tagihan yang mendebit akun dibayar dimuka
diposting oleh modul tagihan; jadwal prepaid hanya mengambilnya kembali. Pajak
keluaran diakui oleh posting hari dagang; subledger pajak hanya mencatat masa
mana ia milik. Ini pelajaran 0273 — dua penulis untuk satu hari dagang — yang
tidak diulang.

**Angka sisa dihitung, tidak disimpan.** Sisa prepaid = nilai − alokasi. Sisa
uang muka = nilai − pertanggungjawaban. Sisa pokok = pinjaman − angsuran
terbayar. Kolom yang disimpan akan berselisih dengan jurnal pada hari seseorang
lupa memperbaruinya.

**Akun tidak pernah disebut di Rust.** Semua lewat `account_map`: sebuah makna
plus tempat plus qualifier menghasilkan **sepasang** nilai — akun DAN
kategorinya (`resolve_account` → `Resolved { account_code, category_code }`).
74 `semantic_key` itu tidak berubah namanya saat bagan menyusut dari 190 ke 40;
yang berubah hanya apa yang ada di ujung peta. Pengecualiannya satu dan
disengaja: jadwal prepaid dan penyelesaian uang muka menyebut akun yang dipilih
orang pada dokumennya — makna yang di-resolve ulang saat posting bisa mengirim
bulan Maret ke tempat yang berbeda dari Februari.

**Pembalikan membawa kategorinya, tidak menghitungnya ulang.** `reverse`
menyalin `category_code` sama seperti ia menyalin `account_code`; kalau ia
me-resolve ulang, sebuah pembalikan bisa mendarat di kategori yang berbeda dari
entri yang dibalik karena petanya berubah di antaranya.

**Penolakan menyebutkan penyebabnya.** "no account is mapped for
'card_receivable_debit' at store-01 — the map has it under BCA, MANDIRI, and
this posting named none of them" adalah kalimat yang bisa ditindaklanjuti.

## Lapisan kontrol

`finance_controls` membaca setiap subledger di samping buku besarnya dalam satu
bentuk: `gl`, `subledger`, `difference`, `unmatched`. Domain yang belum punya
pembanding membawa `covered = false` dan alasannya — persediaan, karena stok
belum bernilai uang.

`finance_close_readiness` menjawab "apa yang menghalangi tutup bulan" dengan
daftar pemeriksaan OK / BLOCKER / UNKNOWN. Ia melaporkan; ia tidak pernah
memperbaiki.

Periode punya tiga keadaan sejak 0283: `OPEN`, `SOFT_CLOSED` (hanya menerima
jenis entri yang membentuk tutup buku), `CLOSED`. Daftarnya ada di trigger 0051.

## Laporan

Neraca dan laba rugi dibangun dari `journal_line` dan tidak dari tabel ringkasan
apa pun, jadi tidak bisa menyimpang dari buku yang diringkasnya. Seksi diambil
dari `ledger_account.root_class`, yang di-generate dari digit pertama kode akun.
Kode 4 digit yang baru memakai akar yang sama dengan bagan klien (1 aset ·
2 kewajiban · 3 ekuitas · 4 pendapatan · 5 HPP · 6 beban operasional ·
7 penyusutan · 8 lain-lain & pajak), jadi `financial_statements.rs` tidak
berubah satu baris pun saat bagan menyusut. Hasil per unit adalah satu baris per
unit yang JUMLAHNYA adalah angka konsolidasi — itu sebabnya keduanya
rekonsiliasi secara konstruksi.

Yang bertambah: dengan 40 akun, **rincian yang dulu dibaca dari kode akun
sekarang dibaca dari kategori**. "Beban listrik bulan ini" bukan lagi saldo
`6010310006` melainkan `6301 × BIAYA_PEMAKAIAN_LISTRIK`; "penjualan QRIS" bukan
lagi akun sendiri melainkan `4101 × QRIS`. Laporan per kategori karenanya adalah
laporan atas `journal_line`, bukan atas bagan — dan sebuah kategori baru tidak
membutuhkan akun baru.

Satu invarian yang baru dan keras: **`1501` berjumlah nol untuk seluruh
perusahaan, setiap saat.** Satu badan hukum berarti saldo antar-unit bukan aset
dan bukan kewajiban — ia tereliminasi saat konsolidasi, dan satu
`sum(debit) - sum(credit) WHERE account_code = '1501'` adalah seluruh
pengujiannya. Tempatnya di `finance_close_readiness` sebagai blocker.
Sebelumnya invarian yang sama tersebar di lima akun afiliasi dan tidak pernah
diuji sama sekali.
