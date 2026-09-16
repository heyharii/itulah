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
plus tempat menghasilkan kode akun klien. Pengecualiannya satu dan disengaja:
jadwal prepaid dan penyelesaian uang muka menyebut akun yang dipilih orang pada
dokumennya — makna yang di-resolve ulang saat posting bisa mengirim bulan Maret
ke tempat yang berbeda dari Februari.

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
dari `ledger_account.root_class`, yang di-generate dari digit pertama kode
klien. Hasil per unit adalah satu baris per unit yang JUMLAHNYA adalah angka
konsolidasi — itu sebabnya keduanya rekonsiliasi secara konstruksi.
