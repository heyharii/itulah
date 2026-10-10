# Usulan UI MD: progres allotment dan keputusan barang

9 Oktober 2026. Review source UI dan eksplorasi bersama Luna Max; usulan UX, belum implementasi. Aplikasi lokal meminta login, sehingga tidak diklaim sebagai pengujian UI aplikasi yang terautentikasi.

## Pembagian pekerjaan

- Barang salah SKU/tujuan tetapi seluruh fisik dan jumlah sudah diketahui: MD menentukan tujuan dan dokumen; Operations menjalankan pergerakan. Tidak wajib melewati Inventory.
- Keberadaan atau jumlah stok perusahaan belum jelas: Inventory menyelidiki, Operations/store menjawab permintaan bukti. Setelah Lost, MD memutuskan pengganti/penutupan sisa sesuai tahap dokumen.
- Salah isi sebelum dispatch yang dapat diselesaikan repack: Operations menyelesaikan tanpa tugas MD.
- Salah SKU dapat mengandung dua masalah sekaligus: SKU ekstra yang diketahui lokasinya untuk keputusan MD, SKU seharusnya tetapi belum ditemukan untuk Inventory. Tautkan sebagai satu kejadian, tetapi jangan menyatakan semuanya sekadar salah tujuan.
- Receiving supplier sebelum acceptance stok: Operations dan pemilik PO; keputusan komersial/Return PO oleh pemilik PO, bukan Inventory atau otomatis MD.

## Navigasi

Tetap dua ruang utama: **Unallotted** dan **Allotted**.

Unallotted menampilkan stok sah yang tersedia untuk alokasi. Sisa permintaan picklist, barang salah yang masih menunggu disposisi, dan barang supplier yang belum diterima sebagai stok tidak menjadi stok bebas pada layar ini.

Allotted menampung pekerjaan berjalan dan riwayat. Filter **All / Active / Finished**; Finished menampung hasil **Completed**, **Closed short**, dan **Cancelled** dengan label hasil tetap berbeda. Jangan membuat halaman utama Completed tambahan atau menamai semua hasil Finished sebagai Completed.

**Perlu keputusan MD** terpisah dari status dokumen. Jumlahnya menghitung keputusan terbuka, bukan seluruh sisa kuantitas atau seluruh issue Inventory. Masalah pada dokumen yang sudah selesai tetap dapat meminta keputusan baru tanpa membuka dokumennya kembali. Tombol ini membuka semua keputusan lintas status; notifikasi membuka detail kasus yang sama.

Dua pilihan layout pada contoh: filter keputusan di toolbar, atau antrean keputusan ringkas di atas daftar Allotted. Rekomendasi awal: filter keputusan untuk UI yang paling sederhana. Antrean cocok bila keputusan sering terlewat; keduanya memakai data dan detail yang sama, bukan dua pekerjaan yang berbeda.

## Isi dan aksi MD

| Kejadian | Tampilan MD | Aksi MD |
|---|---|---|
| Target 100, sent 95, counted 95 | Allotment Active; delivery Completed; To pick 5; pemilik Operations | Tidak wajib. Sisa tetap picklist; MD dapat menutup sisa bila kebutuhan berubah. |
| Surat jalan 100, counted 95, belum ada hasil | Delivery Completed · issue; Inventory memeriksa; Operations/toko menjawab bukti | Lihat progres, belum ada keputusan pengganti. |
| Lost 5 dikonfirmasi | Jumlah aktual 95, hasil Lost dan penyebab; penanganan dokumen lama eksplisit | Tanpa pengganti atau allotment baru 5. Permintaan lama yang diganti ditutup; jangan membuat demand ganda. |
| Salah tujuan, 20 pcs diketahui berada di PIK | SKU, 20 pcs, tujuan awal Kemang, lokasi nyata PIK, sumber laporan | Return to HO atau tujuan baru lewat dokumen baru. Rute toko langsung/via DC masih keputusan terbuka. |
| Completed dan tidak ada keputusan tersisa | Riwayat jumlah aktual dan dokumen terkait | Tidak ada notice baru atau aksi wajib. |

Tampilkan dua status dengan label objeknya: **Allotment** dan **Delivery**. Count selesai tidak membuktikan seluruh target allotment terpenuhi. Completed pada allotment berarti pemenuhan selesai; Closed short berarti sisa resmi ditutup, bukan lengkap diterima.

Contoh Lost pada mockup memakai skenario setelah pemeriksaan dan penutupan dokumen lama: allotment **Closed short**, delivery **Completed** setelah marker pemeriksaan dibersihkan, keputusan pengganti MD masih terbuka. Pada short pick sebelum barang dikirim, penutupan sisa tidak mengakhiri pekerjaan bagian 95 yang masih berjalan. Mesin status harus mengikuti pekerjaan aktual, bukan langsung menutup seluruh allotment dari satu hasil kasus.

Masalah ditampilkan per allotment × toko × SKU/delivery yang terdampak. Ringkasan allotment dapat menyebut jumlah kasus, tetapi tidak menyatakan semua barang/allotment gagal. Pisahkan jumlah yang diterima fisik di lokasi salah dari jumlah pemenuhan di tujuan yang diminta.

Detail keputusan berisi: dokumen sumber, SKU/jumlah terdampak, lokasi nyata, tujuan awal, bukti/hasil yang sudah dikonfirmasi, siapa mengerjakan berikutnya, dan pilihan dokumen yang sudah terisi dari fakta kasus.

Draft belum menyelesaikan tugas. Keputusan selesai setelah MD menerbitkan dokumen atau mengonfirmasi tanpa pengganti. Sesudah itu progres Return/allotment baru dimiliki Operations, tetap ditautkan pada detail lama. Riwayat hasil Inventory dan keputusan MD tetap tersedia meski marker issue hilang.

## Celah yang masih perlu diselesaikan sebelum implementasi

1. Salah SKU sekaligus kurang SKU asli: kasus terkait dan kuantitas pengganti tidak boleh dihitung dua kali.
2. Penutupan sisa lama dan pembuatan allotment pengganti harus konsisten; draft batal tidak boleh menutup demand diam-diam.
3. Tombol dokumen harus mengikuti lokasi aktual. Allotment DC → toko tidak boleh berpura-pura mengirim stok yang masih berada di toko lain. Rute direct/via DC perlu diputuskan.
4. Multi-store/multi-delivery harus menampilkan keputusan hanya pada bagian terdampak, serta agregasi status yang tidak menyembunyikan pekerjaan terbuka.
5. Found setelah permintaan ditutup tidak menghidupkan permintaan lama; beri riwayat/koreksi stok sesuai pemilik, bukan Resume.

Contoh UI memakai data ilustratif dan interaksi lokal; tidak menulis transaksi, tidak mengubah prototype/app, tidak compile atau deploy.
