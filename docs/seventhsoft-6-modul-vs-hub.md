# Seventhsoft 6 modul vs menu frontend-hub

**Tanggal:** 20 September 2026 · **Sumber:** 6 video demo resmi, 51 frame diekstrak.
Tiga video **baru** — Master, Pembelian, Inventory — mengisi lubang yang teardown
5 September sebut sendiri: *"Yang tidak tercakup: modul Inventory, Pembelian, Fasilitas."*

**Batas riset ini:** submenu **ANALISA** dan **FASILITAS** tidak pernah terbuka di keenam
video, jadi dua modul itu tetap kosong. Video demo juga ≠ instalasi klien — instalasi
CENTRAL FASHION STORE punya modul **DISTRIBUSI** yang tak ada di video mana pun.

---

## 1. Struktur mereka

```
MENU FAVORIT
MASTER          Item · Customer · Supplier · (Gudang · Kelompok · Satuan · COA)
INVENTORY       Info Barang_Stok
                Pindah Antar Gudang (PAG)
                Stok Adjustment
                Adjustment Nilai
                Retur Barang ke Supplier
                Retur Barang dari Customer
                Perakitan
                Stok Opname
                Laporan Inventory
PEMBELIAN       Order Pembelian → Barang Datang → Faktur Beli → Pelunasan
                                        ↘ Retur Beli
PENJUALAN       Sales Order → Faktur Jual → Pembayaran
                                   ↘ Retur Jual
KAS_BANK        BKM · BKK · Pencairan BG Masuk / Keluar
GL              Transaksi Jurnal · laporan
ANALISA         (tidak terbuka di video)
FASILITAS       (tidak terbuka di video)
```

**Sembilan modul rail.** Kita: **18 modul rail + 4 aside, 176 layar.**

---

## 2. Empat ide mereka yang layak kita ambil

### 2.1 Halaman depan modul = **diagram alur proses yang bisa diklik**

Membuka PEMBELIAN tidak memberi daftar atau dasbor angka. Yang muncul:

```
   Order Pembelian → Barang Datang → Faktur Beli → Pelunasan
                            ↓
                       Retur Beli
```

PENJUALAN sama persis: `Sales Order → Faktur Jual → Pembayaran`, dengan `Retur Jual`
bercabang. Ikon-ikonnya adalah tombol.

Modul kita mendarat di daftar (`/procurement/orders`, `/operations/intake`). Untuk modul
**operasional** — Procurement, Operations, Allotment — diagram alur jauh lebih baik: ia
mengajari orang baru urutan pekerjaannya, dan menunjukkan di mana ia sedang berdiri.

> **Dan kita sudah punya bahannya.** `docs/finance-proses-bisnis.html` memuat 55 proses
> dengan alur dan pemiliknya. Menjadikannya halaman depan modul adalah pekerjaan layar,
> bukan pekerjaan data.

### 2.2 Periode sebagai **keadaan sesi**, bukan filter

Status bar mereka, selalu terlihat:

```
PERIODE : JAN 2020    01/01/2020 - 31/01/2020    SERVER : bangunan on Localhost
```

Anda **bekerja di dalam** sebuah periode. Itu mematikan satu kelas kesalahan seluruhnya:
memposting ke bulan yang salah karena tanggal default.

Kita punya `fiscal_period` (OPEN · SOFT_CLOSED · CLOSED) tetapi **tidak ada periode aktif
di sesi** — tiap layar memfilter sendiri. Untuk layar Finance HO, periode di header
(seperti pemilih toko yang sudah ada di layar Store) murah dan mencegah kesalahan nyata.

### 2.3 `ALASAN` sebagai kolom baris penyesuaian

Layar **Stok Adjustment**:

```
header   NO ADJUSTMENT  ADJ-20-03-00001     GUDANG      PUSAT-BELAKANG
         ACCOUNT        511006 Biaya Pengiriman via Ekspedisi
         ADJUST NILAI   ☑ Ya
baris    NAMA ITEM · KODE · JUMLAH (−3.00) · SATUAN · HPP · SUBTOTAL ·
         ALASAN (SALDO AWAL) · KETERANGAN
```

Dua hal penting: penyesuaian **menyebut akunnya sendiri** dan **apakah ia mengubah nilai**
(`ADJUST NILAI`), dan tiap baris membawa **ALASAN**.

> Workbook COA 144 menamai **`reason_code`** sebagai dimensi untuk **1.260 baris** akun
> klien — dan kita belum punya kolomnya. Di sini terlihat bentuk aslinya: kolom di baris
> penyesuaian, bukan tabel master terpisah.

### 2.4 Tab **PO-BPB-INVOICE** di dalam dokumen PO

Layar Order Pembelian punya dua tab: `Detail 1 of 1` dan **`PO-BPB-INVOICE`**.
Tab kedua memperlihatkan pencocokan tiga arah — pesanan, penerimaan, faktur — **di dalam
dokumen PO itu sendiri**.

| | tempat pencocokan tiga arah |
|---|---|
| Seventhsoft | **tab di dalam PO** |
| ERPNext | laporan terpisah *Received Items To Be Billed* |
| kita | dua layar terpisah: `/procurement/outstanding` dan `/finance/unbilled` |

Punya mereka yang paling baik: orang yang bertanya "PO ini sudah datang berapa, sudah
ditagih berapa" sedang **melihat PO-nya**.

---

## 3. Tiga hal yang mereka punya dan kita tidak — di sisi master

Layar **Master Customer** mereka:

```
KODE CUSTOMER (kosong = otomatis) · NAMA · TERMIN PEMBAYARAN (15 Hari)
BATAS JTEMPO    20            ← toleransi hari lewat tempo
BATAS PIUTANG   5.000.000     ← plafon kredit
RAYON · NO NPWP · DISKON 10%
SALES · COA PIUTANG · TIPE HARGA JUAL · STATUS
tab: Detail | Saldo Awal      baris: LOKASI · ALAMAT · KONTAK · TGL LAHIR (banyak lokasi)
```

| fitur | kita |
|---|---|
| **Plafon kredit** (`BATAS PIUTANG`) | tidak ada — kita ritel tunai, tapi ada piutang pegawai & afiliasi |
| **Toleransi lewat tempo** (`BATAS JTEMPO`) | tidak ada |
| **Akun piutang per pihak** (`COA PIUTANG`) | kita pakai `account_map` (arti × unit × qualifier) — **lebih baik**, tapi tanpa override per pihak |
| **Tipe harga jual per pelanggan** | ada, lewat pricelist Commercial |

Layar **Master Item**: satu layar, lima tab — `Detail · Account · Saldo Awal · Harga · Diskon`.
Tab **Harga** memberi `HARGA BELI` + `HARGA JUAL 1…10` **per satuan** (LSN, PCS).
Tab **Account** memberi override akun per item.

Kita memecahnya jadi lima layar terpisah di modul Articles (Divisions · Colours · Sizes · Tags)
plus Commercial → Prices. Pilihan yang berbeda, dan untuk 500+ article kita lebih benar —
tapi **override akun per item** tidak kita punya sama sekali.

---

## 4. Di mana kita jauh di depan

| | kita | mereka |
|---|---|---|
| Persediaan | 11 layar berbasis **RFID/EPC**: Pools · Sightings · Missing · Reconciliations · As of · Time machine | 9 layar berbasis kartu stok |
| Unit/cabang | unit di **tiap baris jurnal**, entri wajib seimbang per unit | demo satu lokasi; periode & server per database |
| Antar-unit | pengakuan **dua sisi** + custody | tidak ada |
| Kebijakan posting | per akun: `posting_mode` × `manual_je_policy` × aturan dokumen | centang **"SETUJU ABAIKAN VALIDASI"** |
| Jurnal | satu pintu, tak bisa diedit | bisa diedit; penyusutan = **tombol di dalam jurnal manual** |
| SDM | modul People 13 layar (roster, absensi, payroll) | tidak ada |
| Member & poin | 4 layar | tidak ada |
| Kesehatan sistem | System 7 layar (node, sync, akses, notifikasi) | tidak ada |

---

## 5. Perbandingan menu, per modul

| domain | Seventhsoft | frontend-hub | catatan |
|---|---|---|---|
| Master | 1 modul, layar bertab | **Articles 5** + Commercial 7 + Vendors 1 + Procurement/Suppliers | kita memecah; wajar untuk skala kita |
| Persediaan | INVENTORY 9 | **Inventory 11** + Allotment 2 + Operations 8 | kita 21 layar — RFID menambah 6 yang mereka tak punya |
| Pembelian | PEMBELIAN 5 langkah | **Procurement 7** | mereka punya alur bergambar; kita tidak |
| Penjualan | PENJUALAN 4 langkah | **Sales 5** + Members 4 | kita punya POS & member |
| Kas & bank | KAS_BANK 3–4 | **tersebar di 4 modul finance** | ← masalahnya di sini |
| Buku besar | GL 2 | tersebar di 4 modul finance | idem |
| Analisa | ANALISA (?) | Reports (aside) 1 | tak terbanding |
| Fasilitas | FASILITAS (?) | System 7 | tak terbanding |
| SDM | — | People 13 | kita saja |
| **Total** | **± 9 modul / ±60 layar** | **18 modul + 4 aside / 176 layar** | |

**99 dari 176 layar kita (56%) adalah finance**, tersebar di empat modul yang hidup
berdampingan. Seluruh modul uang Seventhsoft — KAS_BANK + GL — kira-kira **enam layar**.

Itu bukan berarti enam cukup untuk kita: mereka tidak punya antar-unit, custody, kebijakan
posting, rekonsiliasi acquirer, atau 14 unit. Tetapi **selisih 99 lawan 6** adalah ukuran
seberapa jauh empat modul finance kita perlu dilebur — dan menu target 41 baris yang sudah
kita rancang duduk persis di tengah keduanya.

---

## 6. Yang saya usulkan diambil

| # | ambil | dari | ongkos | dampak menu | dampak akun |
|---|---|---|---|---|---|
| 1 | **Halaman depan modul = alur proses yang bisa diklik** — mulai dari Procurement & Operations | Seventhsoft | layar; datanya sudah ada di `finance-proses-bisnis.html` | nol baris baru | nol |
| 2 | **Periode aktif di header** layar Finance HO | Seventhsoft | 1 kontrol | nol | nol |
| 3 | **Kolom `ALASAN`** pada baris penyesuaian stok & kas | Seventhsoft + workbook COA (`reason_code`, 1.260 baris) | 1 kolom | nol | nol |
| 4 | **Tab pencocokan PO–penerimaan–faktur di dalam PO** | Seventhsoft | 1 tab | **−1 baris** (`/procurement/outstanding` lebur) | nol |
| 5 | **Override akun per pihak** (opsional, menyusul) | Seventhsoft + ERPNext Party Account | 1 kolom | nol | nol |

Empat yang pertama nol dampak ke bagan 144, dan bersama-sama **mengurangi satu baris menu**.

## 7. Yang tetap ditolak

Sama seperti 5 September, dan sekarang bertambah dua dari video baru:

- centang **"SETUJU ABAIKAN VALIDASI"**
- **mengedit jurnal** terposting
- **penyusutan sebagai tombol di dalam jurnal manual** — itu makro, bukan jadwal aset
- **Perakitan (kitting)** — tak ada padanannya di ritel fashion kita
- tombol **Template / Design / Query** di layar laporan
- lima varian neraca
