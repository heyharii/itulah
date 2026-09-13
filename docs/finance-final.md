# Finance final — modul yang dibangun, dan apa yang ditemukannya

**Tanggal:** 13 September 2026 · **Status:** terbangun dan berjalan di `frontend-hub`
**Rute:** `/finance-final` · **Kode:** `frontend-hub/src/screens/finance-final/`
**Menu:** didikte pemilik, dibekukan — Store · Accounting · Reports
**Acuan:** ERPNext v17 (`develop`, `0849f187e7`) dari checkout lokal + dokumentasi resmi
**Bacaan pendamping:** [`finance-menu.md`](finance-menu.md) (keputusan menu),
[`coa-final.md`](coa-final.md) (bagan yang disederhanakan), [`coa-cube.md`](coa-cube.md)

---

## 1. Satu ide yang membedakan modul ini

Bagan klien menaruh **lokasi di dalam kode akun**: 14 salinan `Cash on Hand`, satu per
unit, plus kisi 14×14 akun antar-unit di atasnya. Itulah sebabnya bagannya 7.528 baris.

Di sini unit adalah **dimensi pada baris ledger**, bukan bagian dari akun:

| kolom | isi |
|---|---|
| `journal_line.site_id` | *not null*, ada di **setiap** posting. Ini unitnya. |
| `account_map(semantic_key, site_id, qualifier)` | makna → kode akun; mesin posting menulis ke **makna** |

Entri antar-unit karenanya adalah **satu entri yang baris-barisnya membawa dua `site_id`
berbeda** — unit lawan adalah baris yang lain. **Tidak ada kolom `counter_site_id` di
cabang ini.** Satu kolom bernama itu memang ada di DB dev, tinggalan migrasi `0120` yang
hanya hidup di worktree lane lain dan terlanjur dijalankan ke DB bersama (lihat §4.2 #16 —
ini kejadian ketiga dari pola yang sama). Layar yang ditulis terhadapnya akan meng-compile,
menemukan kolomnya, lalu mengirim ketergantungan yang tidak dimiliki cabang ini.

Dua akibat yang belum tertutup, dan keduanya nyata:

- **Kendala seimbang itu per entri, bukan per unit** (`journal_entry_balances`, 0051), dan
  tidak ada yang memposting pasangan penyeimbang. Sebuah entri bisa seimbang dan tetap
  meninggalkan tiap unit timpang. Di ERPNext kaitnya bernama
  `automatically_post_balancing_accounting_entry`.
- **Nol entri antar-unit ada di dev**, dan JV-00000100 menunjukkan sebabnya: perpindahan
  HO↔DC ditulis memakai **akun ber-sufiks head office** pada `site_id = dc` — persis pola
  lokasi-di-dalam-kode yang modul ini klaim sudah diganti. Dimensinya ada, tapi belum
  memikul gerakan antar-unit.

Tiga akibat yang ditegakkan di seluruh modul:

1. Setiap daftar dan setiap laporan punya **filter unit**, dan itu filter **server**
   (parameter `site`), bukan potongan jawaban lebih lebar yang ditahan browser.
2. Akun dinamai sekali. Tidak pernah `Cash on Hand — Store 04`; yang dicetak adalah
   `Cash on Hand` di kolom akun dan `Store 04` di kolom unit.
3. Kontrolnya dipakai ulang — `LocationSelect`, `SiteName`, `AsOfControl`,
   `AccountPicker` dari `@/screens/finance/parts`. Salinan kedua = pendapat kedua
   tentang apa itu unit.

Buktinya terlihat di **Trial Balance**: ada kolom `Unit`, dan tombol
*By account and unit* / *By account*. Roll-up "By account" itu **no-op** pada bagan
klien yang terimpor — karena setiap daun kodenya sudah membawa lokasinya. Persis itu
yang digantikan desain ini, dan togglenya membuatnya kelihatan.

---

## 2. Menu

Pembagiannya menurut **siapa yang berdiri di sana**, bukan menurut nama entrinya.

| Store — uang yang dipegang tangan sebuah tempat | Accounting — buku tempat gerakan itu mendarat | Reports — membaca buku, bukan milik keduanya |
|---|---|---|
| Cash | Journals | General Ledger |
| Sales | Payments | Trial Balance |
| Sales reconciliation | Payment Reconciliation | Profit & Loss |
| Deposits | Accounts payable | Balance Sheet |
| Expenses | Accounts receivable | Cash Flow |
| Transactions | Prepaids & Accruals | Payable & Receivable ageing |
| Payment instruction | Period close | Sales Register |

Tidak ada baris *Chart of accounts*: begitu unit jadi dimensi, bagannya beberapa ratus
makna, dan bagan sekecil itu adalah **setelan**, bukan tujuan — tempatnya di Master data.

Tidak ada *Cost Center* dan tidak ada *Multi Currency*, atas keputusan pemilik. Itu bukan
kekurangan terhadap ERPNext melainkan perbedaan yang disengaja, dan satu tempat di mana
model kita lebih baik: cerita "bandingkan antar unit" di ERPNext **hanya** jalan kalau tiap
toko jadi Company sendiri — 13 bagan akun plus entri antar-perusahaan.

---

## 3. Yang tidak ada di belakangnya

Enam layar tidak punya endpoint. Semuanya menggambar bentuk aslinya di atas data nyata
yang ada, lalu **menyebut yang hilang di mukanya sendiri** — tidak ada angka karangan,
tidak ada array palsu.

| layar | yang hilang | prasyarat sebenarnya |
|---|---|---|
| Accounts receivable · ageing | `GET /finance/receivables-aging` | **bukan rutenya.** Tidak ada yang mencatat kapan piutang ini jatuh: butuh tabel syarat settlement per acquirer (skema, T+n), tanggal pelunasan pada advance staf, tanggal settlement pada beban antar-unit |
| Prepaids & Accruals | `GET /finance/deferral-schedule` | `service_start_date`/`service_end_date` pada `SupplierBillLine`. ERPNext **tidak menyimpan jadwal** sama sekali — diturunkan ulang tiap run, dan itulah yang membuatnya idempoten |
| Deposits | dokumen setoran | slip setoran belum jadi dokumen yang disimpan sistem |
| Payment instruction | seluruhnya | dokumen dengan siklus hidup dan **tanpa akibat akuntansi** sampai HO bertindak (`Payment Request` ERPNext), tapi dimulai dari toko dengan payee yang mungkin belum jadi vendor |
| Payment Reconciliation | endpoint commit | sub-ledger berkunci party. Sedang dibangun di lane paralel (worktree `agent-a3c35dc57963deabd`), belum di cabang ini |
| Cash Flow | `kind=CASH_FLOW` | klasifikasi operating/investing/financing per akun + endpoint pergerakan-atas-jendela untuk kelas 1–3 |

---

## 4. Apa yang ditemukan pembangunannya

### 4.1 Diperbaiki di pekerjaan ini

1. **`balance_matrix` diam-diam mengabaikan `as_of`.**
   `backend/src/cloud/postgres/statements.rs` menaruh predikat tanggal di klausa `ON`
   sebuah LEFT JOIN ke `journal_entry`, sedangkan SUM-nya atas `journal_line` — jadi baris
   yang entrinya lewat tanggal tetap ikut terhitung, hanya `e`-nya yang null. Endpoint itu
   menggemakan tanggalnya kembali dan menjawab dengan seluruh ledger, di tanggal apa pun.
   Terbukti pada `1011302`: **94.661.050 untuk 1 Jan, 30 Jun, 13 Sep dan 31 Des**. Sesudah
   diperbaiki: **0 / 19.530.170 / 72.775.670 / 94.661.050**, cocok dengan `accountDetail`.
2. **`finance/periods.tsx` meracuni cache bersama.** `openPeriod` menjawab `PeriodPage`,
   tapi layar itu menulis amplopnya ke kunci yang setiap pembacanya memegang
   `FiscalPeriod[]` — pembaca berikutnya memanggil `.filter` pada sebuah objek dan
   melempar. `setQueryData` tak bertipe untuk kunci ini, jadi compiler tidak bisa melihatnya
   dan hanya menekan tombolnya yang bisa.
3. Label bulan P&L `en-GB` → `id-ID`, agar sama dengan `format.ts::day()`.

### 4.2 Ditemukan, belum diperbaiki

**Yang terbesar: penjualan tidak pernah sampai ke buku besar.**
`journal_entry.source_kind` mencadangkan `SALE_DAY` sejak migrasi 0083 dan string itu
**tidak muncul di mana pun** dalam `backend/src/`. Nol entri semacam itu ada. Store 03
menerima Rp 12.416.979 selama 1–13 Sep (Rp 4,4jt tunai, Rp 5,6jt kartu, Rp 2,4jt QRIS), dan
pada jendela yang sama `window_debit_minor` **0** di akun kas, **0** di kedua piutang kartu,
**0** di `card_fee`. Itulah sebabnya P&L menunjukkan Income Rp 0 sementara kasir berdering.

Sisanya, ringkas:

| # | temuan |
|---|---|
| 1 | `cash_variance` tidak ada di `required_keys` account map dan tidak dipetakan ke mana pun — `cash_counts.rs` menolak memposting laci yang kurang tanpanya, jadi tidak ada yang pernah diminta menyetelnya dan orang pertama yang membukukan laci kurang bertemu penolakan. Jawaban "ke mana laci kurang diposting" — yang **tidak dipunyai ERPNext** — kita punya, tapi tak terjangkau |
| 2 | tidak ada akun kliring QRIS; kartu punya dua akun piutang + akun fee. QRIS tak bisa dilacak dari kasir ke bank sama sekali |
| 3 | tidak ada `TRANSFER` sebagai tender — transfer di konter jatuh ke `OTHER` |
| 4 | `GET /reports/sales/window` **mewajibkan** `site_id`, satu-satunya tempat di modul ini unit bukan filter; `/api/v1/sales` tidak menerima tanggal sama sekali |
| 5 | `sale.customer_id` ada di kolom, dibuang di kawat |
| 6 | tidak ada sapuan penutup periode di mana pun — pendapatan dan beban menumpuk lintas tahun, jadi P&L **wajib** dibaca atas jendela |
| 7 | tidak ada `is_opening` di ledger; saldo awal seeded adalah entri `MANUAL` biasa bertanggal 2026-06-01, jadi saldo awal di dalam jendela terhitung sebagai pergerakan |
| 8 | `openPeriod` adalah `INSERT … ON CONFLICT DO NOTHING` — dipanggil pada bulan CLOSED menjawab 200 tanpa mengubah apa pun, no-op sunyi yang terlihat seperti sukses |
| 9 | `financeAttention` hanya 1 dari 3 hitungannya yang ber-scope bulan |
| 10 | `GET /finance/unbilled` mengembalikan `site_id` dalam ejaan edge (`dc-01`) sementara semua endpoint finance lain memakai ejaan cloud (`dc`) |
| 11 | kunci cache yang bisa bertabrakan: `financeKeys.account()` tanpa `site` padahal `accountDetail()` menerimanya; `financeKeys.bills()` hanya berkunci `status`; `financeKeys.ledger()` tanpa `limit`/`q`/`kind`; `financeKeys.bankStatements()` tanpa site |
| 12 | `GeneralLedgerRow` tidak membawa `account_code` maupun party, jadi di bawah sebuah heading baris tak bisa menyebut akunnya sendiri — N+1 saat pembaca membuka voucher |
| 13 | `salesWindow()` membuang parameter `limit` milik server |
| 14 | DB dev menyimpan **dua impor** rekening koran untuk akun+periode yang sama (`dc`, `store-01/02/03`); menjumlahkan keduanya menggandakan bulan itu, dan tidak ada apa pun di server yang mencegah atau menandainya |
| 15 | `scripts/import-coa.py:37` hanya mengenali 2 dari 9 keluarga matriks → **1.372 akun antar-unit terimpor tanpa counterparty** |
| 16 | tabel yatim `payment_ledger_entry` / `payment_ledger_settlement` ada di DB dev tapi tidak dibuat migrasi mana pun di cabang ini — migrasi sebuah worktree lain terlanjur jalan di DB bersama |

---

## 5. Catatan tentang acuannya

Dokumentasi ERPNext **ditulis ulang 14 Agustus 2026** menjadi gaya naratif, dan
penulisan ulang itu menghapus enumerasi filter/kolom serta beberapa halaman seluruhnya.
Lebih buruk: **wiki-nya mencocokkan slug tak dikenal secara fuzzy dan menjawab HTTP 200
dengan halaman yang salah** — `pos-closing-entry` diam-diam menyajikan *Stock Closing Entry*.
Karena itu setiap nama kolom di sini diambil dari **source**, bukan dari halaman docs.

Dua hal yang sempat salah karena itu, dan dikoreksi dari kode:

- **Period Closing Voucher mengunci.** `gl_entry.py::validate_against_pcv` menolak posting
  bertanggal pada atau sebelum `period_end_date` PCV terakhir. Accounting Period justru yang
  lunak — `closed_documents` per doctype dengan `exempted_role`.
- **Milik kita lebih keras sekaligus lebih sempit dari keduanya.** `close_period` hanya
  `UPDATE fiscal_period SET status='CLOSED'`; gerbangnya trigger `assert_period_open()` pada
  `BEFORE INSERT ON journal_entry`, yang menolak bulan CLOSED **dan** bulan yang tak pernah
  dibuka. Tapi trigger itu menjaga bulan **milik entri itu sendiri** — menyegel September
  tidak menyegel Agustus. Kalimat itu ada di layarnya, bukan cuma di komentar.

---

## 6. Dijalankan dan diuji ujung-ke-ujung, 14 September 2026

Diuji di `coa_live_probe` — klon `inventory_rfid` yang sudah memuat kedelapan
migrasi. **DB dev tidak disentuh**: penerapan destruktifnya ditolak guard, dan
klon justru pilihan yang lebih baik karena lane lain sedang memakai DB itu.
Node verifikasi: `finance-final-api` (:8090) + `finance-final-hub` (:5274).

### 6.1 Seed

**1.248 hari-unit diposting, 0 gagal** — setiap (unit, hari dagang) di dalam
empat periode terbuka. Untuk pertama kalinya di proyek ini penjualan sampai ke
buku besar.

```
sebelum   pendapatan kelas 4 = Rp 0
sesudah   pendapatan kelas 4 = Rp 3.306.045.387
buku      debit = kredit = 8.967.073.987   (selisih 0)
entri     SALE_DAY 1.248 · DEPRECIATION 44 · MANUAL 30 · SUPPLIER_INVOICE 24 · BANK_STATEMENT 1
```

### 6.2 21 layar, semuanya render

Bukti silang yang paling meyakinkan, karena tiga sumber terpisah menyebut angka
yang sama untuk Store 03: layar **Transactions** menunjukkan kas masuk
Rp 4.412.348, **Sales reconciliation** menunjukkan Taken Rp 12.416.979 dari 15
sales, dan keduanya cocok dengan tabel yang dihitung agen sale-day secara
mandiri sebelum layar mana pun dibuka.

Trial Balance seimbang di Rp 8.746.230.607 atas 123 baris akun (selisih Rp 0);
Balance Sheet Aset = Kewajiban+Ekuitas Rp 8.446.248.807 (out of balance Rp 0);
Cash Flow 5.562.672.318 + 44.739.856 − 26.448.000 = 5.580.964.174.

### 6.3 Diperbaiki saat pengujian

1. **`receivable` dan `prepaids` mati** dengan `not found: account 1011101` /
   `1011301`. Keduanya membaca keluarga di **grup 7 digit** yang tidak selamat
   dari peruntuhan. Diperbaiki: keluarga kini memikul **daftar kode** dan
   menjumlahkannya, yang justru pernyataan yang lebih jujur setelah satu makna
   = satu akun.
2. **`sales-register` menggantung selamanya** pada "loading". Gerbang
   `enabled: site !== ""` benar selama endpoint menolak `site_id` kosong, dan
   berhenti benar ketika lane plumbing membuatnya opsional. Sekaligus: kolom
   Unit memakai `takings.site_id` (unit *jendela*), jadi di tampilan rantai-penuh
   semua baris akan mengklaim unit yang sama. Sekarang pakai `sale.site_id`.
   Kolom Customer juga diisi — `customer_id` sudah sampai ke kawat.
3. **`sales` berbohong soal pajak.** Kartunya berbunyi "Net revenue — *what the
   income accounts take*". Akun pendapatan menerima **bruto**: entri `SALE_DAY`
   mengkredit `4010110001` penuh dan **tidak memposting baris PPN sama sekali**.
   Kartunya sekarang menyebut itu miliknya kasir, bukan milik buku.

### 6.4 Ditemukan, belum diperbaiki — keputusan pemilik

1. **Bagan tidak konsisten soal rung grup.** Di bawah `10113`, dua dari tiga
   saudara (`1011302 Pajak Dibayar Dimuka`, `1011303 Uang Muka`) mempertahankan
   rung grup 7 digitnya, sedangkan enam posting `1011301` di-*reparent* langsung
   ke `10113`. Menyeluruh: **133 akun posting kehilangan rung grupnya**, dan
   **53 grup** akan memulihkan simetrinya — dengan harga bagan jadi 272 baris,
   bukan 219. Itu mengubah bentuk yang kamu pilih, jadi saya tidak
   mengerjakannya sendiri.
2. **PPN keluaran tidak pernah diakui.** Tidak ada makna kewajiban pajak yang
   dipetakan, jadi buku mengakui pendapatan lebih besar dari neto kasir sebesar
   pajak itu — Rp 11.437.801 pada jendela 14 hari yang diuji.
3. **Uang QRIS mendarat di piutang kartu debit.** Migrasi 0244 memetakan
   `qris_clearing` dan `other_tender_clearing` ke `1011101002` — satu-satunya
   *judgement* di seluruh migrasi itu, dan sekarang terlihat dalam angka nyata:
   "Owed by acquirers" menggabungkan kartu dan QRIS jadi satu.
