# Perbaikan marketing/voucher — 2 Oktober 2026

Status: pekerjaan dan tes integrasi masih berjalan. Dokumen ini akan diperbarui setelah review selesai.

## Perilaku yang sudah diverifikasi

Reproduksi audit awal dijalankan ulang pada salinan pricing engine setelah patch:

| Skenario | Sebelum patch | Setelah patch |
| --- | --- | --- |
| Sisa budget campaign 10.000, dua rule stackable | Diskon 20.000 | Diskon 10.000 |
| Campaign tersisa satu use, dua rule stackable | Dua rule diterapkan | Satu rule diterapkan |

Kedua regression witness lulus. Definition penggunaan tetap per applied rule agar kompatibel dengan ledger pemakaian yang ada.

## Perubahan operasional yang direncanakan

- Coupon legacy dengan max_uses terbatas ditolak eksplisit oleh shared pricing engine sampai checkout memiliki otorisasi coupon pusat yang benar. Coupon unrestricted tetap tersedia. Ini menutup kebocoran dengan menonaktifkan jalur yang belum dapat menjamin cap, bukan menyediakan fitur CouponSet POS yang lengkap.
- Nilai voucher dari poin mengikuti konversi server yang sama dengan alur konfirmasi member (1:1); caller tidak boleh menentukan nilai arbitrary.
- Split budget tidak boleh diaktifkan jika pengeluaran yang sudah diketahui belum tercakup grant. Toko tanpa grant mendapat allowance nol. Grant toko yang retired tidak dikembalikan ke pool.
- Kegagalan membaca allowance tidak menerbitkan pesan usage yang menghapus hard cap terakhir di toko.

## Batas validasi

Tes berjalan lokal pada checkout, tidak mengubah/deploy cloud produksi. Hasil tes tidak membuktikan saldo historis atau transaksi produksi sudah bersih. Transaksi lama yang sudah salah memerlukan rekonsiliasi terpisah.
