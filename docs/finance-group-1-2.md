# Finance Group 1 & 2 — desain terkunci

**Tanggal:** 19 September 2026 · **Lingkup:** Group 1 (Penjualan & Pelanggan) dan
Group 2 (Kas Toko) saja. **Diperbarui putaran 2:** N1 terjawab, seed terkunci 144. Group 3 dst. menyusul.

> **Grup proses bukan grup bagan akun.** Pengelompokan di dokumen ini hanya lapisan
> pandang supaya alurnya mudah dibaca. Akun natural tetap dikelompokkan menurut sifat
> akuntansinya di bagan 144.

## 0. Aturan global

```
Orang mengerjakan DOKUMEN BISNIS / KEJADIAN OPERASIONAL
        ↓
Sistem menentukan KONSEKUENSI AKUNTANSI
        ↓
Orang di Toko/Unit tidak pernah memilih akun, debit, atau kredit
```

Jurnal adalah **akibat**, bukan alur kerja. Tidak ada layar jurnal di unit.

## 1. Perubahan bagan: 145 → **144**

| tindakan | akun |
|---|---|
| dihapus | `Hutang Supplier Barang Dagang - Suspend` |
| dipertahankan | `Hutang Lain-lain` · `Pendapatan lain-lain` · `Pendapatan (Biaya) Lain-lain` |
| dipertahankan | `Hutang Voucher` (akun baru yang sudah disepakati) |

`145 − 1 = 144`. Tidak ada akun lain yang ditambah, dihapus, dilebur, dipecah, atau
diganti namanya dalam tugas ini.

## 1a. N1 TERJAWAB — utang supplier lahir saat barang diterima

**Putusan pemilik, 19 September 2026:** penerimaan barang mengkredit
`Hutang Suppliers Barang Dagangan` **langsung**. Akun Suspend tidak dipakai, dan
perilaku yang berjalan sekarang dicabut.

### Apa yang berubah pada rantai terima-barang → tagih

| | sekarang | sesudah |
|---|---|---|
| terima barang | `Dr Persediaan` / `Cr supplier_suspend` | `Dr Persediaan` / **`Cr Hutang Suppliers Barang Dagangan`** |
| faktur supplier | `Dr supplier_suspend` + `Dr PPN Masukan` / `Cr Hutang Suppliers Barang Dagangan` | **`Dr PPN Masukan` / `Cr Hutang Suppliers Barang Dagangan`** — hanya bagian pajaknya |

**Faktur berhenti MEMBUAT utang; ia MELENGKAPI utang yang sudah ada.** Yang ditambahkan
faktur tinggal tiga hal: PPN masukan, nomor dokumen, dan tanggal jatuh tempo. Beda harga
antara penerimaan dan faktur diselesaikan lewat koreksi harga yang mekanismenya sudah ada.

### Tiga akibat yang harus disadari sejak sekarang

1. **Umur utang dihitung sejak barang diterima, bukan sejak faktur masuk.** Itu memang yang
   tersirat dari bagan klien — mereka tidak punya akun GRNI — dan lazim di praktik Indonesia
   di mana surat jalan adalah pemicu utangnya.
2. **Utang bisa ada tanpa nomor faktur.** Alokasi pembayaran karena itu harus bisa menunjuk
   utang yang lahir dari penerimaan, bukan hanya dari faktur.
3. **PPN masukan diakui belakangan**, saat faktur pajak datang — bukan saat barang diterima.
   Selisih waktu ini normal dan memang begitu aturannya.

### Berkas yang harus diubah

```
payables_flow.rs:47    hapus  const SUSPEND = "supplier_suspend"
payables_flow.rs:364   ganti  kredit penerimaan → trade_payable
payables_flow.rs:956   ganti  faktur berhenti mendebit suspend
payables.rs:1339       ganti  pencocokan faktur↔penerimaan tak lagi lewat suspend
ledger.rs:1161         hapus  arti `supplier_suspend` dari daftar peta akun
account_map            hapus  14 baris semantic_key = supplier_suspend
seed bagan             hapus  akun `Hutang Supplier Barang Dagang - Suspend`
```

---

---

# GROUP 1 — PENJUALAN & PELANGGAN

## 1.1 Akun natural dalam lingkup

**Inti**

```
Penjualan Barang Dagangan
Discount / Potongan Penjualan
Retur Penjualan
Hutang Voucher
Uang Muka Penjualan
```

**Akibat sisi persediaan** — ditampilkan karena satu penjualan punya dua akibat, tetapi
akun-akun ini **tetap tinggal di grup akuntansinya sendiri**:

```
Harga Pokok Pembelian / HPP
Persediaan Barang Dagangan
```

## 1.2 Satu akun penjualan, tender sebagai dimensi

Tidak ada `Penjualan Tunai`, `Penjualan Debit Card`, `Penjualan Kartu Kredit`,
`Penjualan QRIS`. Semua penjualan barang dagangan memakai **`Penjualan Barang Dagangan`**.

Cara pembayaran adalah atribut sub-ledger pada baris pembayaran, bukan akun:

```
CASH · DEBIT_BCA · DEBIT_MANDIRI · DEBIT_BRI · DEBIT_BNI
CREDIT_VISA · CREDIT_MASTERCARD · QRIS · VOUCHER
```

Finance tetap bisa melaporkan penjualan per tender karena dimensinya ada di baris
jurnal dan di sub-ledger pembayaran — bukan karena akunnya dipecah.

## 1.3 Katalog kejadian bisnis

| id | kejadian | dokumen sumber | titik pengakuan | aktor | jurnal? | perilaku |
|---|---|---|---|---|---|---|
| **G1-01** | Penjualan selesai | Struk POS | struk `COMPLETED` | Kasir | ya | otomatis |
| **G1-02** | Diskon pada baris | baris struk | ikut G1-01 | Kasir | ya (bagian G1-01) | otomatis |
| **G1-03** | Kantong belanja Rp1.000, diskon 100% | baris struk | ikut G1-01 | Kasir | ya (bagian G1-01) | otomatis |
| **G1-04** | Void / batal | struk POS | struk tidak pernah `COMPLETED` | Kasir | **tidak** | otomatis |
| **G1-05** | Retur penjualan | Dokumen retur | retur `COMPLETED` | Kasir | ya | otomatis |
| **G1-06** | Voucher dijual | Struk POS | struk `COMPLETED` | Kasir | ya | otomatis |
| **G1-07** | Voucher ditukar | Struk POS | struk `COMPLETED` | Kasir | ya (bagian G1-01) | otomatis |
| **G1-08** | Uang muka penjualan | *belum ditetapkan* | *belum ditetapkan* | *belum ditetapkan* | ya | **NEEDS_CONFIRMATION** |
| **G1-09** | Akibat HPP & persediaan | struk yang sama | bersamaan G1-01 | Mesin | ya | otomatis |
| **G1-10** | Akibat persediaan atas retur | dokumen retur | bersamaan G1-05 | Mesin | bersyarat | otomatis |

## 1.4 Titik pengakuan — dan apa yang tidak mengubahnya

Kejadian ekonomisnya terjadi saat struk POS menjadi **`COMPLETED`**.

**Bukan** saat hari dagang ditutup. **Bukan** saat acquirer menyelesaikan pembayaran.
**Bukan** saat bank menerima uangnya.

```
struk POS COMPLETED
   → kejadian penjualan ADA
   → kejadian akuntansi DIBANGKITKAN
   → jurnalnya boleh diposting seketika ATAU diagregasi harian
```

Agregasi harian **boleh** sebagai pilihan implementasi — dan memang itu yang
`SALE_DAY` lakukan sekarang — tetapi ia **tidak boleh** menggeser titik pengakuan
bisnisnya. Konsekuensi yang mengikat:

- laporan penjualan per jam/per struk harus bisa dibaca tanpa menunggu hari ditutup;
- struk yang `COMPLETED` pada 31 Januari pukul 23.50 adalah penjualan Januari, apa pun
  kapan agregasinya berjalan;
- kalau hari dagang gagal diposting, itu kegagalan **posting**, bukan penjualan yang hilang.

## 1.5 Siklus status

```
STRUK POS      DRAFT → COMPLETED → (RETURNED sebagian/penuh)
                     ↘ VOID                      ← tidak pernah jadi penjualan
DOKUMEN RETUR  DRAFT → COMPLETED
VOUCHER        ISSUED → PARTIALLY_REDEEMED → REDEEMED
                      ↘ EXPIRED
```

## 1.6 Sub-ledger & dimensi yang dibutuhkan

| sub-ledger | isi |
|---|---|
| baris pembayaran struk | tender, acquirer, nomor kartu tersamar, nilai |
| baris barang struk | SKU, qty, harga jual, diskon, alasan diskon |
| alasan diskon | `promotion` · `member discount` · `staff discount` · `manual markdown` · `plastic bag discount` — **metadata bisnis, bukan akun** |
| voucher | `voucher_id` · `face_value` · `balance` · `issued_at` · `redeemed_amount` · `expiry_date` · `status` |
| retur | struk asal, baris asal, alasan, diterima kembali ke stok jual atau tidak |

## 1.7 Void ≠ Retur

```
VOID / BATAL                       RETUR
transaksi tidak pernah selesai     penjualan asal SUDAH selesai
tidak ada pengakuan penjualan      pelanggan mengembalikan barang kemudian
tidak menyentuh Retur Penjualan    memakai Retur Penjualan
nol baris jurnal                   ada baris jurnal
```

Pembedaan ini wajib ada di model, apa pun mekanisme pengembalian uangnya nanti.

## 1.8 Kantong belanja

Aturan klien saat ini: kantong belanja dicatat di transaksi pelanggan senilai
**Rp1.000** dan mendapat **diskon 100%**, sehingga pelanggan membayar nol untuk baris itu.

```
Barang dagangan      100.000
Kantong belanja        1.000
Diskon kantong        (1.000)
─────────────────────────────
Pelanggan bayar      100.000
```

**Tidak ada akun penjualan khusus untuk kantong belanja dalam tugas ini.**
Perlakuan persediaan/HPP-nya juga tidak direka di sini — `Persediaan Kantong Belanja`
dipetakan saat grup persediaan ditinjau.

## 1.9 Voucher

**Dijual** — pelanggan membayar, perusahaan belum memperoleh pendapatan barang dagangan.
`Hutang Voucher` naik. **Jangan** mengakui `Penjualan Barang Dagangan` hanya karena
vouchernya terjual.

**Ditukar** — penjualan barang dagangan terjadi, DAN kewajiban voucher terpakai.
**Penukaran voucher bukan diskon penjualan.**

```
Barang dagangan     700.000     ← penjualannya tetap Rp700.000
Voucher dipakai     500.000
Tunai/debit         200.000
```

## 1.10 Uang Muka Penjualan

Akunnya dipertahankan, **prosesnya belum direka**. Diperlakukan sebagai alur yang
didukung tetapi `NEEDS_CONFIRMATION`, untuk hal seperti titipan pelanggan atau pesanan
di muka. **Tidak boleh** otomatis dianggap pendapatan hanya karena uangnya sudah diterima.

## 1.11 Akibat akuntansi — dibaca setelah prosesnya, bukan sebaliknya

**G1-01 · penjualan selesai** — di unit toko

```
Dr  CASH ON HAND                     tender CASH
Dr  Piutang Acquirer Kartu           tender kartu & QRIS, dimensi acquirer
Dr  Hutang Voucher                   tender VOUCHER — kewajiban terpakai
Dr  Discount / Potongan Penjualan    seluruh diskon, termasuk diskon kantong
    Cr  Penjualan Barang Dagangan    nilai jual kotor, termasuk baris kantong Rp1.000
    Cr  Hutang Pajak                 PPN keluaran
```

**G1-05 · retur** — di unit toko

```
Dr  Retur Penjualan
Dr  Hutang Pajak                     PPN keluaran dibalik
    Cr  CASH ON HAND                 atau tender asal sesuai mekanisme pengembalian
```

**G1-06 · voucher dijual** — di unit toko

```
Dr  CASH ON HAND
    Cr  Hutang Voucher
```

**G1-09 · akibat persediaan** — di unit toko, dibangkitkan mesin penilaian

```
Dr  Harga Pokok Pembelian / HPP
    Cr  Persediaan Barang Dagangan
```

**G1-10 · akibat persediaan atas retur** — **bersyarat**

```
barang diterima kembali sebagai stok jual   →  kebalikan G1-09
barang tidak layak jual                     →  tidak ada pembalikan persediaan;
                                               perlakuannya ikut grup persediaan
```

**G1-04 · void** — **tidak ada jurnal sama sekali.**

## 1.12 Pembalikan & pengecualian

| kejadian | pembalikan |
|---|---|
| struk `COMPLETED` salah | **bukan** void — harus lewat retur atau koreksi bertanda tangan Finance HO |
| hari dagang diposting dua kali | mustahil: kunci unik `(source_kind, source_id, purpose)` |
| voucher kedaluwarsa | pengakuan kewajiban hangus belum ditetapkan → **NEEDS_CONFIRMATION** |
| acquirer membayar beda dari piutang | bukan urusan Group 1 — selisih diselesaikan di rekonsiliasi settlement |

## 1.13 Rekonsiliasi yang diwajibkan

1. Jumlah baris pembayaran per tender = jumlah baris jurnal sisi pembayaran per tender, per hari per unit.
2. `Hutang Voucher` di buku besar = jumlah `balance` seluruh voucher aktif di sub-ledger.
3. Penjualan kotor − diskon − retur = penjualan bersih di laporan, tanpa perhitungan kedua.
4. Setiap struk `COMPLETED` punya tepat satu akibat HPP.

## 1.14 Alur yang dilarang

- Membuat akun pendapatan per tender.
- Mengakui pendapatan saat voucher dijual.
- Memperlakukan penukaran voucher sebagai diskon.
- Memakai `Retur Penjualan` untuk transaksi yang dibatalkan.
- Mengakui `Uang Muka Penjualan` sebagai pendapatan karena uang sudah diterima.
- Kasir memilih akun, sisi debit, atau nilai jurnal.

---

# GROUP 2 — KAS TOKO

## 2.1 Tiga akun, tiga tujuan, tidak pernah saling menggantikan

| akun | arti bisnis | naik karena | turun karena |
|---|---|---|---|
| `CASH ON HAND` | hasil penjualan tunai yang masih dipegang unit | penjualan tunai selesai | unit menyetor hasil penjualan |
| `PETTY CASH` | dana operasional unit | HO mendanai dan unit benar-benar menerimanya | pembayaran operasional yang disetujui |
| `MODAL KASIR` | uang kembalian milik toko | HO resmi menambah modal kasir | toko resmi mengembalikan/mengurangi |

**`Cash On Hand` bukan dompet operasional.** Beban toko tidak boleh dibayar dari uang
penjualan begitu saja.

## 2.2 Katalog kejadian bisnis

| id | kejadian | dokumen sumber | titik pengakuan | aktor | jurnal? | perilaku |
|---|---|---|---|---|---|---|
| **G2-01** | Kas masuk dari penjualan tunai | struk POS | ikut G1-01 | Kasir | ya (bagian G1-01) | otomatis |
| **G2-02** | Buka shift kasir | Serah-terima custody | saat uang diserahkan | Kasir + saksi | **TIDAK** | otomatis |
| **G2-03** | Tutup shift kasir | Serah-terima custody | saat uang dikembalikan | Kasir + saksi | **TIDAK** | otomatis |
| **G2-04** | Hitung kas | Berita acara hitung | saat dihitung | Admin Unit + saksi | **TIDAK** | otomatis |
| **G2-05** | Pengeluaran operasional | Bukti pengeluaran + nota | saat uang keluar | Admin Unit, ditinjau HO | ya | otomatis |
| **G2-06** | Terima pendanaan petty cash | BKM unit + IUT | saat unit menerima uang | Admin Unit | ya | otomatis |
| **G2-07** | Terima tambahan modal kasir | BKM unit + IUT | saat unit menerima uang | Admin Unit | ya | otomatis |
| **G2-08** | Kembalikan modal kasir ke HO | BKK unit + IUT | saat unit menyerahkan uang | Admin Unit | ya | otomatis |
| **G2-09** | Setor hasil penjualan | Slip setoran unit | saat unit menyatakan setoran | Kepala Toko | ya | otomatis |
| **G2-10** | HO menerima setoran di bank | Mutasi bank + BKM HO | saat kredit bank dicocokkan | Finance HO | ya | otomatis |

## 2.3 Buka/tutup shift **tidak** mengubah buku besar

Membuka shift kasir tidak mengubah saldo `MODAL KASIR`. Yang berubah hanya custody.

```
Sebelum buka:   Modal Kasir = Rp2.000.000   custody = brankas toko
Sesudah buka:   Modal Kasir = Rp2.000.000   custody = Kasir A / Till 01
```

```
BUKA SHIFT   → catat serah-terima custody → NOL JURNAL
TUTUP SHIFT  → custody kembali ke brankas → NOL JURNAL
```

`MODAL KASIR` berubah di buku besar **hanya** ketika nilai ekonomis modal kasir toko
berubah: HO resmi menambah, atau toko resmi mengembalikan.

> **Perubahan perilaku terhadap kode yang ada.** `store_money.rs:553` dan `:673`
> memposting `CASH_SHIFT` hari ini, dan salah satu barisnya mendebit `cashier_float`.
> Perilaku itu **dihapus**, dan `cash_shift` menjadi dokumen custody murni.

## 2.4 Hitung kas **tidak** menghasilkan jurnal

Hitung kas adalah kejadian operasional/kontrol. Ia **wajib** mencatat:

```
jumlah menurut sistem · jumlah fisik · selisih
siapa yang menghitung · saksi/persetujuan bila diperlukan · bukti
```

tetapi:

```
HITUNG KAS → NOL JURNAL
```

Selisih **tidak boleh** otomatis diposting ke `Piutang Pegawai`, `Biaya Lain-lain`,
`Pendapatan (Biaya) Lain-lain`, atau akun mana pun. Perlakuan akuntansi atas selisih
adalah **kejadian bisnis terpisah yang disetujui**, bukan akibat otomatis dari
penghitungan.

> **Perubahan perilaku terhadap kode yang ada.** `cash_counts.rs` hari ini memposting
> selisih lewat arti `cash_variance` / `cash_shortage`. Posting itu **dicabut**; modul
> berubah jadi pencatat bukti. Kejadian "selisih diputuskan jadi X" menyusul sebagai
> dokumen tersendiri di grup berikutnya.

## 2.5 Tidak ada pemindahan antar tiga akun kas toko

Dilarang sebagai aksi bisnis:

```
Cash On Hand → Petty Cash          Cash On Hand → Modal Kasir
Petty Cash   → Modal Kasir         Modal Kasir  → Petty Cash    dan seterusnya
```

Kalau petty cash atau modal kasir perlu tambahan, jalurnya adalah **pendanaan dari HO**
(G2-06 / G2-07). **Tidak boleh ada layar pemindahan kas toko yang generik.**

Ditegakkan di pangkalan data, bukan di layar: `account_source_rule` membatasi ketiga
akun itu pada dokumen yang sah, dan tidak ada dokumen yang menyentuh dua di antaranya
sekaligus.

## 2.6 Setoran hasil penjualan — dan penyederhanaan yang dipakai versi ini

Sisi unit terhubung ke `CASH ON HAND` dan `Saldo Affiliasi Atas Barang`.

**Asumsi operasional yang disepakati untuk versi ini:**

```
Toko menyatakan setoran sebesar X  →  penerimaan bank dianggap X
```

Yang **tidak** diperkenalkan di versi ini: `Cash in Transit`, penerimaan bank sebagian,
kekurangan setoran, kelebihan setoran.

> **Inilah yang menutup jalan buntu A6.** Setoran tidak lagi butuh akun transit dan tidak
> lagi butuh satu entri yang menyeberangi dua custody: unit menulis kakinya sendiri,
> HO menulis kakinya sendiri, dan `Saldo Affiliasi Atas Barang` yang menjembatani.

Rekonsiliasi bank belakangan mencocokkan setoran toko dengan baris rekening koran.
AI boleh membantu menyarankan pasangan, tetapi **AI tidak boleh mengarang atau mengubah
nilai uang**. Setoran toko dan/atau rekening koran tetap buktinya.

## 2.7 Wewenang

Kas fisik toko dikendalikan unit: `CASH ON HAND` · `PETTY CASH` · `MODAL KASIR`.
Rekening bank tetap di bawah kendali HO.

**Unit tidak diberi layar jurnal yang bisa memposting langsung ke akun kas toko.**
Unit membuat dokumen operasional; mesin posting yang membuat akibat akuntansinya.

## 2.8 Akibat akuntansi

**G2-05 · pengeluaran operasional dari petty cash** — di unit

```
Dr  <akun beban sesuai kategori pengeluaran>     diturunkan dari kategori, tidak dipilih orang
    Cr  PETTY CASH
```

**G2-06 · terima pendanaan petty cash**

```
unit:   Dr  PETTY CASH                    Cr  Saldo Affiliasi Pembiayaan
HO:     Dr  Saldo Affiliasi Pembiayaan    Cr  Bank - Giro
```

**G2-07 · terima tambahan modal kasir**

```
unit:   Dr  MODAL KASIR                   Cr  Saldo Affiliasi Pembiayaan
HO:     Dr  Saldo Affiliasi Pembiayaan    Cr  Bank - Giro
```

**G2-08 · kembalikan modal kasir**

```
unit:   Dr  Saldo Affiliasi Pembiayaan    Cr  MODAL KASIR
HO:     Dr  Bank - Giro                   Cr  Saldo Affiliasi Pembiayaan
```

**G2-09 · setor hasil penjualan** — sisi unit

```
Dr  Saldo Affiliasi Atas Barang
    Cr  CASH ON HAND
```

**G2-10 · HO menerima setoran** — sisi HO

```
Dr  Bank - Giro
    Cr  Saldo Affiliasi Atas Barang
```

**G2-02 · G2-03 · G2-04 — nol jurnal.**

## 2.9 Rekonsiliasi yang diwajibkan

1. `CASH ON HAND` per unit = penjualan tunai − setoran yang dinyatakan. Tidak ada jalur lain.
2. `MODAL KASIR` per unit hanya berubah lewat G2-07 / G2-08 — nol perubahan dari shift.
3. Setiap hitung kas punya selisih tercatat; selisih yang belum diputuskan muncul sebagai
   daftar terbuka, bukan sebagai saldo buku besar.
4. Setoran unit yang belum berpasangan dengan mutasi bank muncul di layar rekonsiliasi HO.
5. `Saldo Affiliasi Atas Barang` dan `Saldo Affiliasi Pembiayaan` dijumlah lintas 14 unit = nol
   saat kedua sisi diakui.

## 2.10 Alur yang dilarang

- Membayar beban toko dari `CASH ON HAND`.
- Memindahkan uang antar tiga akun kas toko.
- Memposting apa pun saat shift dibuka atau ditutup.
- Memposting selisih hitung kas secara otomatis.
- HO memposting langsung ke kas unit.
- Unit memposting langsung ke akun bank.
- Memakai `Cash in Transit` untuk setoran versi ini.

---

# 3. Keputusan terkunci

| # | keputusan |
|---|---|
| L1 | Bagan kerja **144 akun**: 145 − `Hutang Supplier Barang Dagang - Suspend` |
| L2 | `Hutang Lain-lain`, `Pendapatan lain-lain`, `Pendapatan (Biaya) Lain-lain`, `Hutang Voucher` dipertahankan |
| L3 | Satu akun penjualan; tender adalah dimensi, bukan akun |
| L4 | Titik pengakuan penjualan = struk `COMPLETED`; agregasi harian boleh, tidak menggeser pengakuan |
| L5 | Void ≠ retur, dan void tidak pernah menghasilkan jurnal |
| L6 | Voucher dijual = kewajiban, bukan pendapatan; penukaran bukan diskon |
| L7 | Kantong belanja Rp1.000 diskon 100%, tanpa akun khusus |
| L8 | Buka/tutup shift = custody saja, nol jurnal — **mencabut perilaku `store_money.rs:553/673`** |
| L9 | Hitung kas = bukti saja, nol jurnal — **mencabut posting selisih di `cash_counts.rs`** |
| L10 | Tiga akun kas toko tidak boleh saling dipindah; tidak ada layar transfer generik |
| L11 | Setoran: yang dinyatakan toko dianggap diterima bank; tanpa akun transit, tanpa penerimaan sebagian |
| L12 | Setoran unit lewat `Saldo Affiliasi Atas Barang`; pendanaan lewat `Saldo Affiliasi Pembiayaan` |
| L13 | Kas toko dikendalikan unit; bank dikendalikan HO; unit tidak punya layar jurnal |
| **L14** | **Penerimaan barang mengkredit `Hutang Suppliers Barang Dagangan` langsung.** Akun Suspend tidak dipakai; perilaku yang sekarang dicabut |
| **L15** | **Faktur supplier melengkapi, bukan membuat, utang.** Ia menambahkan PPN masukan, nomor dokumen, dan jatuh tempo |

# 4. Belum terjawab — `NEEDS_CONFIRMATION`

| # | pertanyaan | memblokir |
|---|---|---|
| **N2** | `Hutang Lain-lain` dipertahankan — apakah ia sisi kredit matriks antar-unit (14×14 di bagan klien) atau utang ke pihak luar? Kalau yang pertama, ia bertabrakan dengan `Saldo Affiliasi Lain-lain` | model afiliasi |
| **N3** | Proses `Uang Muka Penjualan` — pemicu, dokumen, kapan diakui jadi pendapatan | G1-08 |
| **N4** | Voucher kedaluwarsa — kapan dan ke akun mana kewajibannya hangus | siklus voucher |
| **N5** | Mekanisme pengembalian uang pada retur — tunai, kartu, atau voucher pengganti | G1-05 |
| **N6** | Selisih hitung kas: dokumen apa yang memutuskannya, dan siapa yang menyetujui | Group berikutnya |
| **N7** | Perlakuan persediaan & HPP kantong belanja | grup persediaan |
