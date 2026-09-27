# Finance 2025 untuk ringkasan eksekutif

Lima workbook sangat membantu: dua sumber utama memberi kinerja tahunan, perubahan laba, kontribusi divisi, dan agenda biaya. Neraca serta laba-rugi cabang memiliki batas cakupan dan error subtotal, sehingga belum cukup untuk kas perusahaan, likuiditas, atau modal kerja konsolidasi.

## Sumber dan cakupan

Semua file asli berada di `/Users/hari/Downloads/`. Nilai dibaca read-only dari BIFF8 menggunakan xlrd 2.0.2. Formula Excel tidak dihitung ulang; audit menggunakan cached numeric values, error yang tersimpan, dan aritmetika independen. Dokumen tidak diperlakukan sebagai instruksi.

| ID | File | Sheet | Pemakaian |
|---|---|---|---|
| 0 | Summary__Penjualan_Per_Divisi_by_Harga_HPP_rata20 ALL UNIT JANUARY - DECEMBER 2025 BY SERVER HO DATA 02012026.xls | GAPNO KH | 9 divisi, penjualan dan HPP rata-rata 2025; A11:L21 |
| 1 | Laporan_Neraca_Central_2_Tahunan1 (1).xls | sheet1 | C001 Cikupa, label J14:J112; belum dipakai untuk KPI neraca |
| 2 | Laba_Rugi_GL_Per_Cabang_2_Tahunan1 (2).xls | sheet1 | C001 Cikupa pada J5; belum dipakai untuk KPI laba |
| 3 | Laporan_Neraca_Central_2_Tahunan1.xls | sheet1 | Isi sel identik dengan ID 1; satu dataset, bukan unit tambahan |
| 4 | Laba_Rugi_GL_Per_Cabang_2_Tahunan1 KOMPILASI UNIT 2025 - 2024 BY SERVER UNIT UPDATE 12-01-2026.xls | sheet1 | Kompilasi unit pada A5; 2025 pada F7, 2024 pada H7; sumber utama P&L |

Header dokumen menyebut Central Fashion Store. “Kompilasi unit” tidak membuktikan eliminasi antarunit, sehingga tidak dilabeli laporan konsolidasi. Nama file mengandung tanggal yang berbeda; cutoff dan cakupan posting aktual masih perlu diverifikasi.

## Cerita utama

| Metrik | 2025 | 2024 | Perubahan | Sel ID 4 |
|---|---:|---:|---:|---|
| Penjualan bersih | Rp103.676.066.725 | Rp105.921.194.470 | −2,12% | F32 / H32 |
| Laba kotor | Rp41.348.126.218 | Rp41.921.650.661 | −1,37% | F36 / H36 |
| Beban usaha | Rp20.384.704.875 | Rp17.821.415.593 | +14,38% | F38 / H38 |
| Beban usaha lainnya | Rp9.553.489.071 | Rp8.677.010.209 | +10,10% | F125 / H125 |
| Total dua kelompok beban | Rp29.938.193.946 | Rp26.498.425.802 | +12,98% | jumlah baris 38 + 125 |
| Laba setelah pajak | Rp11.019.819.678 | Rp15.135.615.285 | −27,19% | F229 / H229 |

Angka rupiah tabel dibulatkan. Penjualan turun Rp2,245 miliar; laba setelah pajak turun Rp4,116 miliar. Margin kotor terhadap penjualan bersih naik dari 39,58% ke 39,88%, sedangkan margin bersih turun dari 14,29% ke 10,63%. Pembagi margin di prototype adalah net sales baris 32. Persentase G/I workbook memakai gross sales baris 9, sehingga tidak disalin langsung.

Dekomposisi perubahan laba (2025 minus 2024) menjumlah ke −Rp4.115.795.606,71:

- Laba kotor: −Rp573.524.443,76 (baris 36).
- Kenaikan beban usaha: −Rp2.563.289.282,76 (baris 38).
- Kenaikan beban usaha lainnya: −Rp876.478.861,33 (baris 125).
- Perubahan nonoperasi: −Rp107.124.972,62 (baris 210).
- Penurunan pajak: +Rp4.621.953,76 (baris 226).

Rincian biaya untuk ditelusuri: kerusakan persediaan +Rp1.288.825.229 (F49/H49), depresiasi FFE +Rp457.247.947 (F149/H149, kelompok biaya), sewa toko/gudang +Rp448.017.000 (F131/H131), dan perawatan bangunan +Rp234.237.799 (F115/H115). Rincian sudah termasuk subtotal beban dan tidak ditambahkan lagi ke perubahan laba. Kenaikan nominal belum membuktikan penyebab bisnis atau kesalahan pengakuan.

## Divisi dan rekonsiliasi

ID 0 memiliki sembilan divisi: Wanita, Pria, Anak Laki, Anak Perempuan, Perlengkapan Bayi, Sandal Sepatu, Tas, Accessories, dan Non Divisi. Pria + Wanita menyumbang 70,31% neto (G11 + G12, dibagi G21).

Non Divisi: neto Rp790.627.000 (G19), HPP Rp60.000 (I19), margin 99,9924% (K19). Ini flag untuk verifikasi kelengkapan biaya dan klasifikasi; bukan bukti kesalahan maupun margin yang sudah layak dijadikan target. Margin total divisi 39,89%; bila Non Divisi dikecualikan, sekitar 39,43%.

| Komponen 2025 | Divisi (ID 0) | GL (ID 4) | Divisi − GL |
|---|---:|---:|---:|
| Neto | Rp103.676.713.725 | Rp103.676.066.725 | +Rp647.000 |
| HPP | Rp62.318.136.964,16 | Rp62.327.940.507,34 | −Rp9.803.543,17 |
| Laba kotor | Rp41.358.576.760,84 | Rp41.348.126.217,66 | +Rp10.450.543,17 |

Sumber: ID 0 G21/I21/J21; ID 4 F32/F34/F36. Perbedaan HPP rata-rata vs GL harus diperiksa bersama cutoff, posting dan koreksi; belum ada bukti untuk mengatribusikannya pada satu sebab.

Pemeriksaan internal ID 0: D21 − E21 − F21 = Rp103.676.468.925, atau Rp244.800 di bawah G21 yang tercetak. Jumlah neto 9 divisi sama dengan G21, sehingga prototype mempertahankan nilai tercetak dan menandai identitas bruto/diskon/retur yang belum cocok. Perbedaan bruto dan diskon antarworkbook juga besar; jangan menyimpulkan perubahan diskon hanya dengan membandingkan baris dari kedua basis.

## Kualitas workbook

- ID 4: seluruh subtotal nominal utama dan kelompok biaya yang diperiksa pada F/H merekonsiliasi ke komponen kedua tahun dengan toleransi <Rp0,01. Terdapat 21 #REF! pada formula pendukung dan 65 #N/A pada rasio; tidak dipakai untuk KPI. Validitas aritmetika bukan opini audit laporan keuangan.
- ID 0: jumlah kolom divisi merekonsiliasi ke total; dua #DIV/0! berada di K24/K25 pada ringkasan batal/void bernilai nol. Selisih neto Rp244.800 di atas tetap terbuka.
- ID 2: 527 #NULL!, termasuk subtotal penjualan, beban, dan laba. Label J5 menunjukkan C001 Cikupa. Tidak dipromosikan menjadi laba seluruh unit; penjumlahan ulang akun cabang bukan total resmi workbook.
- ID 1 dan 3: 407 #NULL! per file; nilai sel identik. Rincian F/H tertentu ada, tetapi subtotal dan sisi kewajiban/ekuitas tidak dapat digunakan. Nilai helper R/S tidak dianggap neraca yang dipulihkan tanpa menelusuri formula dan cakupan.
- Parser lama repo `scripts/xls.py` membaca sebagian RK integer negatif sebagai positif besar karena sign extension. Audit ini menggunakan xlrd dan tidak mengubah parser lama. Import produksi perlu diuji terhadap negative RK dan cached error sebelum memakainya.

## Implikasi rancangan

Jadikan revenue/profit/margin, perubahan laba, biaya utama, dan kontribusi divisi sebagai inti report tahunan. Kas, likuiditas, kewajiban jatuh tempo, stok aging, dan HR tetap berguna di rancangan operasional, tetapi harus memakai sumber tersendiri yang lengkap. Workbook ini belum mendukung tren bulanan/harian, ranking semua cabang, atau kas konsolidasi; jangan menciptakan breakdown tersebut dari total tahunan.

Versi live membutuhkan export neraca yang valid dengan scope jelas, rincian per cabang/per bulan, pemetaan akun/divisi, cutoff yang sama, dan penjelasan rekonsiliasi penjualan-HPP. Prototype menyediakan desain dan contoh narasi yang dapat ditinjau sekarang.
