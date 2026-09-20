# Rencana tindak lanjut setelah audit

Rencana ini belum memerintahkan perubahan produksi. Urutannya mengikuti dependensi: spesifikasi yang konsisten → bukti kondisi cloud → perbaikan terukur → uji transaksi → migrasi.

## 1. Selesaikan spesifikasi 162 sebagai satu sumber

**Usulan pemilik:** Finance + product/backend.

- Pilih satu nama canonical per kode; simpan nama client lainnya sebagai alias.
- Pisahkan readiness, account role, posting mode, manual override, dan production activation.
- Perbaiki 43 referensi keputusan hilang dan ID yang berubah arti.
- Selaraskan 728 kandidat mapping pada topik yang telah diputuskan. Persetujuan saldo tetap terpisah.
- Tandai empat parent sebagai reference/group atau petakan hanya jurnal langsung bila terbukti ada.
- Selesaikan aturan Pre Opening (pengakuan dan contra amortisasi), Disposed Inventory, OE/RR, dan alokasi potongan pembelian.
- Putuskan satu aturan authoritative untuk 15 perbedaan manual JE.

**Selesai bila:** 162 kode unik; referensi valid; mapping tidak saling bertentangan; setiap akun punya aturan dan status yang jelas; keputusan material punya bukti dan pihak yang menyetujui. Tidak wajib memaksakan seluruh akun menjadi aktif.

## 2. Ambil snapshot cloud secara read-only

**Usulan pemilik:** pemilik akses cloud + backend.

- Dapatkan akses baca yang disetujui atau ekspor akun dan konfigurasi dari lingkungan yang benar. Jangan mengirim password/token melalui dokumen audit.
- Ambil daftar accounts (kode, nama, jenis, parent/posting, status), company/Unit, rekening bank, posting profiles, periode, dan konfigurasi modul.
- Cocokkan versi deployment dan migrasi terpasang dengan repository.
- Untuk validasi perilaku, ambil jurnal dan source linkage yang diperlukan dengan scope terbatas; jangan memodifikasi ledger produksi untuk menguji.

**Selesai bila:** setiap akun punya status presence live yang terverifikasi atau alasan tidak dibutuhkan; perbedaan kode lama/baru dijelaskan dengan mapping semantik; runtime deployment diketahui. Health 200 saja tidak memenuhi kriteria ini.

## 3. Implementasikan gap sesuai hasil backend

**Usulan pemilik:** backend + Finance.

- Dahulukan jalur yang belum menghasilkan jurnal/materialisasi ledger dengan benar, lalu akun/config yang belum tersedia.
- Buat penambahan/penyesuaian konfigurasi yang idempotent dan tenant/company-scoped. Jangan menimpa kode akun bersejarah hanya karena nama berubah.
- Tegakkan posting mode, manual override, dimensi wajib, party/reference, status akun dan closed period di backend.
- Tetapkan event, jurnal debit/kredit, reversal, retry/idempotency, dan rekonsiliasi per keluarga akun.
- Hubungkan akun kontrol dengan subledger; keberadaan endpoint CRUD bukan bukti bahwa accounting flow lengkap.

**Selesai bila:** gap prioritas tinggi pada matriks backend memiliki perubahan teruji, bukti jurnal seimbang, dan trace source-to-ledger.

## 4. Jalankan UAT transaksi di staging

**Usulan pemilik:** Finance + QA/backend.

| Skenario | Bukti lulus |
|---|---|
| Pembelian, receipt belum ditagih, invoice dan pembayaran | Inventory/AP/suspense bergerak sekali, outstanding receipt/invoice cocok |
| Diskon/rebate setelah sebagian barang terjual | Alokasi diskon ke stok tersisa dan HPP; tidak menggandakan pengurangan cost |
| Penjualan tunai/debit/kredit, fee dan settlement | Revenue bruto net pajak, merchant fee terpisah, batch/receivable cocok |
| Retur dan refund | Referensi transaksi asal, reversal revenue/HPP/inventory benar, tidak ada refund ganda |
| Interunit | Unit dan counterpart jelas, pasangan lengkap dan eliminasi internal benar |
| Asset acquisition/depreciation/disposal | Register dan GL cocok; amortisasi/penyusutan tidak tercatat dua kali |
| Pre Opening | Pengakuan mengikuti policy; bila valid, Dr beban/Cr akumulasi tanpa mengurangi gross dua kali |
| OE replacement/RR | Posting yang ditahan ditolak; expense vs capitalization dan disposal mengikuti keputusan |
| Payroll, pajak, accrual, pinjaman | Party, periode, pokok/bunga dan settlement schedule cocok dengan GL |
| Manual JE, retry, reversal, closed period | Pembatasan server berlaku; permintaan ulang tidak menggandakan jurnal; periode tertutup ditolak |

**Selesai bila:** jurnal, saldo subledger, dan laporan lolos pada kasus normal, retur/reversal, kesalahan validasi, dan retry. Tidak cukup hanya respons API berhasil.

## 5. Migrasi percobaan dan rekonsiliasi

**Usulan pemilik:** Finance + implementor.

- Tetapkan cutoff, saldo TB dan transaksi terbuka per Unit/party/register.
- Pisahkan saldo awal dari jurnal koreksi yang disetujui.
- Jalankan dry run import dengan pengecualian parent agregat, account held, dan target belum disetujui.
- Cocokkan bank, kas, AP, settlement, inventory, aset/akumulasi, pinjaman, pajak dan interunit.
- Catat setiap selisih; jangan memakai akun lain-lain untuk membuat saldo terlihat cocok.

**Selesai bila:** source TB + koreksi disetujui = opening GL dan subledger terkait, tanpa saldo ganda atau target tidak valid.

## 6. Aktivasi bertahap

**Usulan pemilik:** Finance owner + operations + backend.

- Mulai dari Unit/alur yang disepakati dan akun yang telah lulus UAT.
- Aktifkan akun sesuai kebutuhan nyata; jangan mengaktifkan semua template bank atau akun held.
- Monitor jurnal gagal, unbalanced/unmatched entries, duplicate source, dan drift subledger.
- Perluas setelah satu siklus tutup buku/rekonsiliasi yang disepakati berhasil.

**Selesai bila:** penerimaan operasi dan Finance terdokumentasi, serta tidak ada blocker jurnal/rekonsiliasi pada scope yang diaktifkan.
