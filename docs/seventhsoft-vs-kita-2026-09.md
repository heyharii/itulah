# Seventhsoft vs kita — putaran 3, 20 September 2026

**Catatan:** kedua video ini (**Keuangan**, **Kas Bank**) sudah dibedah 5 September
— 64 screenshot, inventaris fungsi, 9 diambil / 2 bersyarat / 9 ditolak
(`seventhsoft-teardown`). Dokumen ini **tidak mengulang** teardown itu. Yang dikerjakan:
membandingkan ulang terhadap keadaan kita **sekarang**, yang sudah jauh berubah — bagan 144,
BKK/BKM, custody, antar-unit, kernel posting, dan perbandingan ERPNext.

Bukti baru: 24 frame diekstrak ulang dari kedua video.

---

## 1. Tiga hal yang mereka lebih baik — dan semuanya bisa kita ambil

### 1.1 Satu voucher, TIGA tab alokasi — ini yang paling nyata

Layar **BKM (Bukti Kas/Bank Masuk)** mereka:

```
header   NO VOUCHER  KM-20-01-00002        CUSTOMER      CV. SARANA PRIMA
         TANGGAL     31 Jan 2020           NO CHECK/GIRO
         KAS/BANK    BCA                   TGL J. TEMPO
         NO REF · KETERANGAN               TOTAL         1.000.000,00

tab      Detail (PENJUALAN)  │  Lain-lain  │  Hutang
kolom    NO FAKTUR · J.TEMPO · PIUTANG · REFF NO · KETERANGAN · POTONGAN · TERIMA · ☑ LUNAS
```

**BKK** adalah cerminnya persis: `KK-20-02-00001`, SUPPLIER, dan tab
`Detail (PEMBELIAN) │ Lain-lain │ Piutang`.

Tiga pekerjaan dalam satu dokumen:

| tab | pekerjaannya |
|---|---|
| **Detail** | melunasi faktur — baris per faktur, dengan **potongan** dan centang **LUNAS** |
| **Lain-lain** | baris langsung ke akun (biaya bank, pendapatan lain) |
| **Hutang / Piutang** | menyentuh sisi lawan (mis. retur jual dibayar lewat BKK) |

**Punya kita:** `cash_document` hanya punya **satu pasang** `from`/`to` dan **nol baris
alokasi**. Alokasi kita hidup terpisah di `supplier_payment_allocation` — hanya sisi utang,
dan tidak ada padanan untuk piutang.

> **Ambil.** Tambahkan baris alokasi ke `cash_document`. Dalam satu langkah itu menutup
> "Payment Reconciliation" yang spesifikasi minta (§12), memberi potongan pelunasan tempat
> yang benar, dan membuat BKM kita setara BKK kita — yang hari ini timpang.

### 1.2 Register giro yang TERBENTUK SENDIRI dari voucher

Layar **Pencairan BG Masuk**:

```
filter   ◉ J.TEMPO   ○ NEW   ○ CAIR   ○ TOLAK
tombol   [ Cair ]  [ Tolak ]  [ Batal Cair ]  [ Checked ]
kolom    CUSTOMER · NO BKM · BANK · TOTAL ·
         TANGGAL: BUAT / JATUH TEMPO / CAIR / TOLAK ·
         BANK TUJUAN ▾ · PERIODE · KETERANGAN · STATUS
```

Giro **bukan dokumen tersendiri**. Ia baris BKM/BKK yang kebetulan mengisi
`NO CHECK/GIRO` + `TGL J. TEMPO`. Registernya terbentuk otomatis, dan pencairannya
menanyakan **ke rekening mana** uangnya mendarat.

> **Ini persis layar yang hilang dari rekomendasi `cleared_on` kemarin.**
> ERPNext memberi **kolomnya** (`clearance_date`); Seventhsoft memberi **layarnya** —
> daftar berfilter NEW/CAIR/TOLAK dengan tombol massal dan `Batal Cair` untuk membatalkan
> pencairan. Gabungan keduanya adalah jawaban terbaik, dan menghapus kebutuhan baris menu
> "Giro register" tersendiri: giro jadi **pandangan**, bukan modul.

### 1.3 Tutup buku yang MENYEBUT nomor dokumennya

Dari teardown 5 September, masih berlaku: closing mereka menjalankan empat uji integritas
dan **menunjuk dokumen yang gagal**, bukan sekadar bilang "ada masalah".

Rencana kita (§B2) sudah punya daftar penghalang. Yang belum: **menyebut nomor dokumennya.**
"3 kiriman antar-unit belum diakui" jauh kurang berguna daripada
"IUT-2026-00125, IUT-2026-00131, IUT-2026-00140 belum diakui unit penerima".

> **Ambil detailnya**, bukan mekanismenya — mekanisme kita sudah lebih baik
> (`closed_over_blockers` mencatat yang dilewati; mereka hanya menahan).

---

## 2. Enam hal yang kita lebih baik — dan tidak boleh dilepas

| # | kita | mereka |
|---|---|---|
| 1 | **Satu pintu jurnal** (`poster::post`, nol INSERT di luarnya) | jurnal bisa **diedit langsung**; ada centang **"SETUJU ABAIKAN VALIDASI"** |
| 2 | **Kebijakan posting per akun** — `posting_mode` × `manual_je_policy` × aturan dokumen | tidak ada; akun mana pun bisa dijurnal siapa pun |
| 3 | **Unit di setiap baris jurnal**, dan entri wajib seimbang **per unit** (0120) | demo satu lokasi; instalasi klien 14 cabang, tetapi tanpa invarian per-unit |
| 4 | **Pengakuan dua sisi antar-unit** + custody (siapa memegang uangnya) | tidak ada padanan sama sekali |
| 5 | **Tutup buku mencatat apa yang dilewatinya** (`closed_over_reason/blockers`) | menahan, lalu selesai |
| 6 | **Nol rute hapus** untuk catatan terposting | tombol **Del** ada di setiap layar voucher |
| 7 | Penyusutan = **jadwal per aset** dengan satu jurnal per baris | tombol **PENYUSUTAN** di dalam layar jurnal manual |

Nomor 7 layak digarisbawahi: di video Keuangan, "Fasilitas Penyusutan Asset secara Otomatis"
ternyata sebuah **tombol di dalam Transaksi Jurnal** yang membangkitkan baris-barisnya.
Itu bukan jadwal aset; itu makro. Kita lebih benar.

---

## 3. Satu hal yang mengejutkan: bagan mereka KECIL

Neraca demo mereka (diekspor ke Excel) memperlihatkan bagan dua tingkat:

```
100  Kas/Bank          1000 Kas · 1001 Bank · 1002 akun perantara · 1003 Bank Lain-Lain
101  Piutang           1010 Piutang Dagang · 1011 Piutang Lain-Lain ·
                       1012 Piutang Suspense · 1013 Piutang Giro
102  Persediaan        1021 Persediaan · 1022 Retur & Potongan Pembelian
103  Uang Muka         1030…1033
104  Biaya & Pajak Dibayar di Muka
200  Utang Pihak ketiga · 201 Utang Dagang · 202 Utang Lain-Lain ·
203  Utang Pajak (2030 PPN · 2031 PPh) · 204 Utang Giro · 205 Uang Muka
```

Kira-kira **50 akun posting**, dan rekening bank adalah **akun tersendiri**
(`100101 PANIN`, `100102 KALSEL`, `100103 EKONOMI`; kas: `100001 Kas Besar`,
`100002 Kas Kecil`, `100003 Kas Perantara`, `100004 Kas Admin Surabaya`).

Dua pelajaran:

1. **Mereka memakai akun perantara/suspense secara sadar** — `Kas Perantara`,
   `Piutang Suspense`, `Utang Suspense`. Kita menolak akun transit. Beda filosofi, dan
   keputusan kita tetap berdiri — tetapi perlu diketahui bahwa praktik lokal memang begitu.
2. **Rekening bank = akun**, bukan sub-ledger. Kita sebaliknya: satu akun `Bank - Giro`
   plus baris `company_bank_account`. Punya kita lebih baik untuk 14 unit — tetapi ini
   menjelaskan kenapa bagan klien punya 14 baris bank: mereka mewarisi gaya ini.

---

## 4. Yang tetap ditolak

Dari teardown 5 September, dan masih berlaku sesudah semua yang kita putuskan:

- centang **"SETUJU ABAIKAN VALIDASI"**
- **mengedit jurnal** yang sudah terbentuk
- tombol **Template / Design / Query** di layar laporan
- **lima varian neraca**
- dua dari empat uji closing mereka (jurnal tak balance & salah akun) — keduanya
  **mustahil** pada kita karena `assert_journal_balanced` dan FK akun; mengujinya hanya
  menambah waktu tunggu

---

## 5. Yang saya usulkan diambil sekarang

| # | ambil | dari | ongkos | menutup |
|---|---|---|---|---|
| **1** | **Baris alokasi di `cash_document`** (tab Detail / Lain-lain / sisi lawan) | Seventhsoft | 1 tabel anak + layar | Payment Reconciliation (§12), potongan pelunasan, BKM setara BKK |
| **2** | **`cleared_on`** + **register pencairan berfilter** NEW/CAIR/TOLAK/`Batal Cair` | ERPNext (kolom) + Seventhsoft (layar) | 2 kolom + 1 layar | *Executed ≠ Settled*, dan giro jadi pandangan — **satu baris menu hilang** |
| **3** | **Penghalang tutup buku menyebut nomor dokumen** | Seventhsoft | query | daftar periksa yang bisa ditindaklanjuti |
| **4** | Tombol **Import** di layar voucher, bukan hanya di rekening koran | Seventhsoft | 1 layar | entri massal tanpa API bank |

Nomor 1 dan 2 bersama-sama menyelesaikan tiga hal yang audit spesifikasi kemarin sebut
sebagai lubang: alokasi pembayaran, *In Payment ≠ Paid*, dan siklus hidup giro.

**Dampak ke bagan akun: nol.** Keempatnya dokumen, kolom, dan layar.
**Dampak ke menu: −1 baris** (Giro register jadi pandangan di dalam Payments) → 41 baris.
