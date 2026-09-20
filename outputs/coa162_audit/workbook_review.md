# Audit workbook COA 162

## Kesimpulan

Belum layak menjadi spesifikasi final implementasi. Jumlah dan integritas daftar akun baik, tetapi hasil merge belum konsisten antara keputusan, daftar akun, konfigurasi, mapping, dan beberapa aturan jurnal. Tidak ada perubahan pada file sumber.

## Pemeriksaan yang sudah sesuai

- `COA 162` dan `COA 162 Config` sama-sama memuat 162 kode unik, dengan himpunan kode identik.
- Semua 7.528 kode dan nama legacy sama dengan `Laporan_Master_Account1.csv`; tidak ada baris berkode hilang atau duplikat.
- 6.908 akun tanpa anak dan 620 parent teridentifikasi berdasarkan prefix kode. Ini bukan verifikasi hak posting aktual.
- Tidak ada target mapping yang menunjuk kode di luar daftar 162. Nama dan status target yang terisi cocok dengan master saat audit.
- 91 akun berstatus siap konfigurasi, 70 bersyarat, dan 1 ditahan; hitungan ringkasan cocok.
- Rumus rekonsiliasi tidak menunjukkan error dan input kosong tetap menghasilkan `Belum ada data`.
- File asset yang dirujuk tersedia. `MASTER ASSET (3).xls` memang memuat hubungan OE, RR dan biaya replacement serta label NON DEPRECIABLE. Hal ini membuktikan praktik/master legacy, bukan otomatis membuktikan kepatuhan kebijakan pengakuannya.

## Temuan yang perlu ditutup

### W01 — Keputusan final belum diterapkan ke mapping

**Prioritas tinggi.** Ada 1.318 akun tanpa anak tanpa single target. Sebanyak **728** di antaranya terkait topik yang sekarang dianggap telah diputuskan atau dipetakan di sheet Config:

| Kelompok | Akun tanpa target | Kandidat dalam desain | Bukti |
|---|---:|---|---|
| Prepaid PPh 21 | 14 | 1105101 | Keputusan baris 7 menyatakan CLOSED; Mapping Legacy baris 1109–1122 tetap menunggu D03 |
| Hutang Principal | 196 | 2105003 | Keputusan baris 9 menyatakan owner/investor; contoh Mapping Legacy baris 4452 masih menyatakan Principal belum teridentifikasi |
| Biaya Replacement OE | 504 | 7103001 | COA 162 baris 152 siap; contoh Mapping Legacy baris 6711 masih menunggu kebijakan |
| Amortisasi Pre Opening | 14 | 7104001 | Config baris 150 mencakup prefix 7010216002; Mapping Legacy baris 7267–7280 kosong |

Ini tidak berarti 728 saldo boleh langsung dipindahkan. Yang perlu diselaraskan adalah **kandidat tujuan desain**, sedangkan persetujuan migrasi tetap bergantung pada saldo dan jurnal. Sisa 590 akun tanpa target tidak otomatis salah; sebagian memang memerlukan keputusan atau bukan target posting baru.

### W02 — Referensi keputusan rusak atau berubah arti

**Prioritas tinggi.** Ada **43 baris COA** merujuk D11/D13/D14/D15/D16/D17 yang sudah tidak ada di sheet Keputusan. D07–D10 juga digunakan ulang dengan arti baru tanpa memperbarui semua pemakai:

- COA 162 `O22:O23` menunjuk D10 untuk settlement, tetapi D10 kini Potongan Pembelian.
- COA 162 `O47:O48` dan `O150` menunjuk D08 untuk HGB, tetapi D08 kini Disposed Inventory.
- COA 162 `O68` menunjuk D09 untuk suspense, tetapi D09 kini Pre Opening.
- COA 162 `O149` dan `O165` menunjuk D07 untuk sewa/leasing, tetapi D07 kini settlement.

**Tindakan:** gunakan ID keputusan stabil; kembalikan keputusan yang masih diperlukan atau perbarui seluruh referensi. Jangan menutup isu hanya dengan menghapus baris keputusan.

### W03 — Dua master belum memiliki aturan prioritas

**Prioritas tinggi untuk konfigurasi.** Ditemukan **15 pasangan aturan manual JE yang perlu disatukan**. Contoh paling jelas:

- `2104001–2104003`: COA 162 baris 81–83 mengizinkan jurnal berdasarkan perhitungan/reversal; Config baris 78–80 menyatakan manual JE `NO`.
- `1101003`: COA baris 7 memperbolehkan koreksi terbatas; Config baris 4 menyatakan `NO`.
- `2101002`: COA baris 68 mengizinkan koreksi clearing; Config baris 65 melarang JE langsung.

Jika maksudnya koreksi melalui dokumen sumber, tulis demikian pada kedua sheet. Pisahkan izin journal-entry langsung, koreksi modul, dan override administratif.

Ada **82 perbedaan nama** antara kedua sheet. Banyak hanya sinonim/kapitalisasi, tetapi tetap perlu satu nama canonical dan alias untuk import/config. `CONTROL` adalah peran akun, sedangkan `Siap konfigurasi` adalah kesiapan; keduanya sebaiknya menjadi field terpisah, bukan dua daftar status yang dianggap setara.

### W04 — Empat parent mendapat target posting bersama anak

**Prioritas tinggi untuk migrasi.** Mapping Legacy baris **3611, 3627, 3642, dan 7407** adalah parent dengan target baru terisi. Anak-anaknya juga dipetakan. Ini dapat menggandakan saldo jika importer hanya memilih semua target yang terisi.

**Tindakan:** beri jenis mapping `reference/group` pada parent atau pisahkan dari import. Jika sistem lama pernah memposting langsung ke parent, hanya jurnal langsung tersebut yang dipetakan; saldo agregat tidak ikut dijumlahkan lagi.

### W05 — Aturan amortisasi Pre Opening saling tumpang tindih

**Prioritas tinggi.** COA 162 `L64` menyebut amortisasi sebagai kredit akun gross `1202802`. `L65` juga menyebut amortisasi sebagai kredit akumulasi `1202892`. Aturan R34 pada baris 38 masih generik, dipakai oleh kedua akun tersebut.

**Tindakan:** bila pengakuan asetnya memang valid dan memakai contra account, tetapkan jurnal periodik **Dr 7104001 / Cr 1202892**. Akun gross 1202802 tidak dikredit rutin untuk amortisasi yang sama. Pisahkan aturan gross, akumulasi, dan beban.

### W06 — Mempertahankan nama legacy belum cukup untuk mengizinkan kapitalisasi

**Prioritas tinggi untuk kebijakan pelaporan.** `1202802 Pre Opening` berstatus siap dan Config baris 61 mengizinkan kapitalisasi. Namun belum ada kriteria biaya mana yang memenuhi pengakuan aset. Schedule amortisasi hanya menjelaskan alokasi, bukan dasar pengakuan.

Kerangka pelaporan client perlu dikonfirmasi. Sebagai rujukan, IAS 38 paragraf 69 membebankan startup/pre-opening expenditure kecuali pengeluaran tersebut termasuk biaya aset yang memenuhi standar lain. Pertahankan akun untuk tracking/migrasi bila perlu; jangan menjadikannya izin kapitalisasi semua biaya praoperasi.

Sumber: https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-38-intangible-assets.pdf?bypass=on

`1202801 Disposed Inventory` juga perlu definisi: barang masih dimiliki dan bernilai, barang menunggu disposal, atau barang sudah dilepas/tidak bernilai. Definisi tersebut menentukan pengakuan, valuasi, dan klasifikasi lancar/nonlancar. Nama akun dan dokumen disposal saja belum menyelesaikannya.

### W07 — Kebijakan OE masih memerlukan batas yang eksplisit

**Prioritas tinggi sebelum otomatisasi.** Workbook menyatakan semua pembelian pengganti dibebankan, tidak masuk register, dan nilai aset lama tetap. Ini perlu batas kapitalisasi/materialitas, perlakuan fisik aset yang diganti/dilepas, serta cara menyelesaikan nilai buku lama. Masalahnya lebih luas daripada mencari jurnal kredit pembentuk RR.

Sebagai rujukan, IAS 16 mengkapitalisasi replacement yang memenuhi kriteria pengakuan dan menghentikan pengakuan bagian yang diganti. Pengeluaran yang tidak memenuhi kriteria dapat dibebankan. Karena itu, aturan blanket harus diganti dengan kebijakan berbasis substansi dan kerangka pelaporan client.

Sumber: https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-16-property-plant-and-equipment.pdf

### W08 — Potongan pembelian memerlukan algoritme alokasi

**Prioritas tinggi untuk costing.** Memiliki `5101002` sebagai contra purchase/HPP dapat dipakai, tetapi posting kredit seluruh rebate ke laba-rugi saat stok belum terjual dapat membuat persediaan dan margin salah. Aturan R35 belum menetapkan kapan akun tersebut clearing, kapan dialokasikan ke inventory, dan cara mencegah diskon dikurangkan lagi oleh engine costing.

**Tindakan:** tetapkan alokasi ke stok tersisa dan HPP barang terjual, termasuk credit note setelah penjualan, retur, dan reversal. Contoh penerimaan: 100 barang @100, diskon 1.000, 60 barang terjual → dampak akhir diskon 400 mengurangi inventory dan 600 mengurangi HPP. Jangan mengurangi HPP 1.000 sekaligus jika 40 barang masih tersimpan.

Sumber: https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-2-inventories.pdf

### W09 — Workbook belum aman sebagai sumber konfigurasi yang terus diedit

**Prioritas sedang.** Mapping target name/status dan hitungan Panduan kini berupa nilai statis. Berbeda dengan workbook sebelumnya, perubahan kode target tidak memperbarui nama/status otomatis; Mapping Legacy tidak memiliki validasi kode target. Tampilan catatan mapping yang panjang juga terpotong pada tinggi baris saat ini.

**Tindakan:** gunakan satu master account sebagai sumber referensi, lookup/validasi kode, ringkasan berbasis data, dan format catatan yang dapat dibaca. Jika file sengaja dibuat sebagai snapshot statis, beri versi dan nyatakan bahwa perubahan harus dihasilkan ulang melalui satu proses.

## Batas pemeriksaan

Saldo dan jurnal belum disediakan dalam workbook. Tidak ada klaim bahwa saldo nol, mapping disetujui, atau account sudah aktif di produksi. Klaim klarifikasi client dalam Sumber diperlakukan sebagai pernyataan yang dicatat oleh penyusun workbook. File asset mendukung struktur legacy; audit ini tidak mengasumsikan label legacy otomatis menjadi kebijakan akuntansi yang benar.

Audit backend dan rencana tindak lanjut digabungkan dalam laporan utama setelah hasil backend tersedia.
