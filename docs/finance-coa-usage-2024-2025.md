# Akun mana yang benar-benar dipakai — bukti dari GL klien 2024–2025

Sumber: `Laba_Rugi_GL_Per_Cabang_2_Tahunan1.xls` (Laba Rugi GL, **PUSAT**, 2025 vs
2024) dan `Summary__Penjualan_Per_Divisi_by_Harga_HPP_rata21.xls` (penjualan per
divisi, toko **C003 Purbalingga**, 13-Sep-2026). Dibaca 2026-09-16.
Hasil per akun: `outputs/coa_usage/akun-aktif-nonaktif-2024-2025.csv`.

## Batas yang harus dibaca lebih dulu

Berkas pertama bernama "Per Cabang" tapi **hanya berisi satu kolom cabang:
PUSAT**. Jadi:

- **"Nol di PUSAT" BUKAN "tidak aktif".** Dua belas akun PENDAPATAN nol di sini
  bukan karena tak terpakai, melainkan karena **kantor pusat tidak berjualan**.
  Berkas kedua membuktikannya dari sisi lain: satu toko, satu hari, sembilan
  divisi, Rp 25,6 juta bruto. Kalau 12 akun itu dipensiunkan berdasarkan berkas
  ini, seluruh penjualan kehilangan tempat memposting.
- Berkas ini **laporan laba rugi**, bukan neraca. Ia tidak berkata apa pun
  tentang kas, bank, piutang, persediaan, utang, atau modal. Untuk menyederhanakan
  akun neraca — termasuk 14 akun bank yang jadi pertanyaan terbuka di
  `docs/finance-bank-audit.md` §C — yang dibutuhkan **neraca atau trial balance
  per cabang**, bukan laporan ini.

Jadi yang berikut ini adalah kesimpulan tentang **akun beban dan pendapatan di
kantor pusat**, dan hanya itu.

## Angkanya

| | |
|---|---:|
| baris akun di laporan PUSAT | 149 |
| bergerak di 2024 atau 2025 | **53** |
| nol di kedua tahun | 96 |
| akun P&L di chart kita (4/5/6/7/8) | 93 |
| — terbukti **AKTIF** | **48** |
| — nol dua tahun di PUSAT | 43 |
| — tak muncul di laporan sama sekali | 6 |

Belanja PUSAT yang terbukti: **Rp 6,31 miliar (2025)** dan Rp 5,51 miliar (2024).
Tiga pos memakan 73%-nya: gaji pegawai (Rp 2,87 M), sewa bangunan toko & gudang
(Rp 1,35 M), dan biaya rumah tangga (Rp 385 jt).

## Yang bisa langsung disederhanakan

### 1. Keluarga yang klien laporkan terpisah tapi chart kita sudah gabungkan

Ini arah yang sudah benar dan tinggal dikonfirmasi:

| yang klien laporkan | hidup | mati | chart kita |
|---|---|---|---|
| Depresiasi FFE (7 baris: Office · Toko&Gudang · Komputer · Musik · Mess · Interior · Exterior) | **4** | 3 | **1** akun `7010214001` |
| Depresiasi Mesin (AC · Lift · Eskalator · Genset) | 1 (AC) | 3 | **1** akun `7010212001` |
| Depresiasi Bangunan (Utama · Tambahan · Mess) | 0 | 3 | **1** akun `7010210001` |
| Depresiasi Kendaraan (Mobil · Sepeda Motor) | 1 (Mobil) | 1 | **1** akun `7010213001` |
| Replacement OE (±37 jenis rak, patung, hanger…) | **0** | 37 | **1** akun `7010215001` |

Penggabungan Mesin, Bangunan, Kendaraan dan Replacement OE **aman** — sisanya
memang nol dua tahun.

**Kecuali FFE.** Empat sub-barisnya hidup dan besar:

```
Interior         170.227.695
Komputer          35.514.934
Toko & Gudang     14.016.532
Office            10.273.710
```

Semuanya sekarang jatuh ke satu akun `7010214001`. Itu **kehilangan detail yang
klien pakai** — Interior sendiri Rp 170 juta setahun. Kalau Anda ingin
menyederhanakan, FFE adalah satu-satunya keluarga di sini yang justru perlu
dipecah, bukan digabung. Pilihan lain: biarkan satu akun dan pisahkan lewat
**kategori aset** di register (`fixed_asset.category_code`), yang sudah ada —
sehingga laporannya tetap bisa dipecah tanpa menambah akun.

### 2. Empat puluh tiga akun nol dua tahun di PUSAT

Rinciannya di CSV. Yang **aman dipensiunkan** (murni beban kantor pusat, tak ada
alasan cabang memakainya):

```
6010110002  Biaya Credit Card              6010310010  Biaya Perijinan
6010110003  Biaya Promosi                  6010310012  Biaya Penyisihan Kerugian Piutang
6010110004  Biaya Dekorasi                 6010310024  Biaya Perlengkapan Mess/Rumah Dinas
6010110005  Biaya Advertising / Iklan      6010410005  PERBAIKAN & PERAWATAN STAFF HOUSE
6010110008  Biaya Kerusakan Persediaan     7010110001  Biaya Sewa Tanah
6010210004  Uang Transport                 7010110002  Biaya Land Right
6010210008  Biaya Uniform / Seragam        7010210001  Depresiasi Bangunan Utama
6010210009  Biaya Sport & Recreation       7010211001  Depresiasi Instalasi Mekanikal
6010210010  Funeral Contribution           7010215001  Replacement Operating Equipment
7010310001  Property All Risk & Fire Ins   7020310003  Biaya Pajak Reklame
7010310002  Biaya PBB                      7020310004  Biaya Management FEE
8010110004  Pendapatan Sewa Gedung         7020310005  Biaya Asuransi Kendaraan
8010110006  Kehilangan Barang / Selisih Stock Opname
8020111002  Biaya Bunga Leasing
```

**Yang JANGAN dipensiunkan meski nol di sini** — nol-nya karena PUSAT tidak
berjualan, dan cabang memakainya setiap hari:

```
4010110001  Penjualan Tunai                4010112001  Penjualan Kartu Kredit VISA
4010111001  Penjualan Debit Card BCA       4010112002  Penjualan Kartu Kredit Master
4010111002  Penjualan Debit Card Mandiri   4010113001  Penjualan Online Sendiri
4010111003  Penjualan Debit Card BRI       4010113002  Penjualan Online Market Place
4010111004  Penjualan Debit Card BNI       4010213001  Discount / Potongan Penjualan
4020110001  Management Fee                 4010214001  Retur Penjualan
```

Dua yang perlu keputusan pemilik, bukan bukti: `4020110001 Management Fee` dan
`7020310004 Biaya Management FEE` — dua sisi dari perjanjian yang sama, dan
keduanya nol dua tahun. Kalau perjanjiannya memang tak berjalan, dua-duanya bisa
pergi bersama.

### 3. Uang yang mengalir tanpa akun

Satu, dan besar:

```
Biaya Amortisasi Opti Tex System    30.450.000 (2025)    30.450.000 (2024)
```

**Tidak ada akun untuk ini di chart kita.** Ia amortisasi tahunan yang tetap dan
berjalan dua tahun berturut-turut. Chart kita punya `7010216001 Amortisasi
Seventh Soft Application` dan `7010216002 Amortisasi Biaya Pre Opening`; Opti Tex
adalah saudara ketiga yang hilang saat impor. Perlu dibuat, atau dinyatakan
menumpang `7010216001`.

### 4. Satu pertanyaan lama yang terjawab berkas ini

`6010310018 Tools (Peralatan) Expenses` — salah satu dari tujuh akun yang 0267
putuskan, dan `docs/finance-branch-reconciliation.md` mencatatnya sebagai
menunggu ekstrak GL klien. **Terjawab**: Rp 1.127.100 di 2024, nol di 2025. Jadi
ia dipakai, kecil, dan tidak perlu digabung ke mana pun.

## Yang berkas ini TIDAK bisa jawab

1. **Akun mana yang dipakai cabang.** Perlu laporan yang sama untuk satu atau dua
   toko. Tanpa itu, 12 akun pendapatan dan seluruh beban toko tak bisa dinilai.
2. **Seluruh neraca.** Kas, bank, piutang, persediaan, aset tetap, utang, modal —
   93 akun P&L di atas hanya sebagian dari 189 akun postable kita. Sisanya, 96
   akun, tak tersentuh laporan ini sama sekali.
3. **Rekening bank mana yang hidup.** Butuh neraca per bank atau rekening koran.
   `docs/finance-bank-audit.md` §C menuliskan enam pertanyaannya.

## Saran urutan kalau mau menyederhanakan

1. Minta **laporan yang sama untuk 2 toko** (yang paling ramai dan yang paling
   sepi) — itu menutup 12 akun pendapatan + beban toko sekaligus.
2. Minta **neraca 2 tahun per cabang**. Itu yang menjawab bank, piutang, dan
   persediaan, dan itu juga yang menutup pertanyaan §C audit bank.
3. Baru pensiunkan. Pensiun ≠ hapus: akun yang pernah dipakai tetap harus terbaca
   di jurnal lama. Mekanismenya sudah ada (`is_active`), dan peta jalan lifecycle
   `ACTIVE/DORMANT/RETIRED` ada di `docs/finance-posting-kernel.md` §6.
