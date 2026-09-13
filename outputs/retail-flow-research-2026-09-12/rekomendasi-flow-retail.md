# Rekomendasi alur bisnis fashion: HO dan 13 toko

Tanggal riset: 12 September 2026. Status: rekomendasi untuk diuji di lapangan, bukan spesifikasi yang telah disahkan atau bukti bahwa seluruh fitur sudah berjalan.

Riset menggabungkan dokumentasi primer Oracle Retail, Microsoft Dynamics 365, GS1, serta audit kode oleh Luna dengan reasoning max. Dokumen membedakan praktik yang didokumentasikan, rekomendasi untuk bisnis ini, dan kemampuan aplikasi saat ini. Tidak ada perubahan kode aplikasi atau pengujian operasional langsung.

Asumsi kerja: terdapat gudang pusat/DC yang melayani 13 toko. HO adalah organisasi; DC adalah lokasi penyimpanan dan pengiriman. Keduanya boleh berada di alamat sama, tetapi jangan dianggap sama tanpa konfirmasi. Volume harian, jumlah petugas, layout, jadwal pengiriman, dan kesiapan RFID belum dikonfirmasi.

## 1. Kesimpulan riset

Pembagian MD, Operations Controller, petugas lapangan, dan Inventory Controller layak dipakai. Batasnya adalah keputusan dan kewenangan, bukan jenis perangkat atau kepemilikan data yang terpisah.

```text
MD menentukan kebutuhan dan jatah toko
                    |
                    v
Operations Controller mengatur pekerjaan dan pengiriman
                    |
                    v
Petugas DC / toko mencatat pekerjaan dan serah-terima aktual
                    |
                    v
Movement yang tervalidasi memperbarui catatan persediaan

Inventory Controller memeriksa catatan dan bukti di sepanjang alur
                    |
                    v
Selisih -> penyelidikan -> keputusan koreksi yang dapat ditelusuri
```

Inventory Controller tidak menjadi pintu persetujuan setiap pick/pack. Operasi normal yang sah langsung membukukan movement. Koreksi karena selisih mengikuti kewenangan dan review tersendiri.

Dokumentasi Microsoft menunjukkan pengambilan gabungan sebelum sorting ke tujuan. Ini mendukung pola Pick Area bersama, tetapi tidak membuktikan bahwa mengambil barang secara bebas tanpa rencana merupakan pilihan terbaik. Rekomendasi: kebutuhan SKU gabungan, prioritas dan batas pekerjaan tetap jelas; unit baru dipisah ke tujuan saat packing. [Put-to-store](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/put-to-wall-put-to-store)

Oracle memisahkan perhitungan alokasi dan pengiriman instruksi alokasi ke sistem gudang. Ini mendukung batas keputusan MD dan eksekusi warehouse. [Integrasi Allocation–Merchandising](https://docs.oracle.com/en/industries/retail/retail-allocation-cloud/latest/ralog/allocation-merchandising.htm)

## 2. Istilah dan batas peran

| Istilah | Arti dalam rancangan ini |
|---|---|
| Operations / operasional | Domain pekerjaan menerima, menyimpan, memindahkan, mengemas, mengirim, dan menerima balik barang. |
| Petugas operasional | Orang yang melakukan pekerjaan fisik dan mencatat hasil aktual. |
| Operations Controller | Pengendali antrean, prioritas, kapasitas, pengecualian pekerjaan, dan serah-terima pengiriman. Distribution merupakan bagian pekerjaannya. |
| Inventory | Catatan persediaan: barang apa, berapa, di mana, dalam kondisi apa, dan pergerakannya. |
| Inventory Controller | Penanggung jawab akurasi catatan, opname, investigasi selisih, dan pengendalian koreksi. |
| MD / allocator | Penanggung jawab tujuan komersial, komposisi artikel–warna–ukuran, jatah toko, serta keputusan mengurangi atau mengalihkan demand. |

Untuk 13 toko, rekomendasi awal adalah satu workspace Operations dengan Receiving, Preparation, Distribution, dan Returns. Distribution Controller tidak perlu menjadi jabatan tambahan. Satu orang boleh mempunyai beberapa tugas sesuai kapasitas, tetapi sistem harus memisahkan hak tindakan dan melarang persetujuan sendiri pada kasus yang mensyaratkan pemeriksa lain.

| Keputusan / tindakan | Penanggung jawab | Batas kewenangan |
|---|---|---|
| Menentukan artikel, warna, ukuran, jumlah per toko | MD | Operations dapat meminta perubahan, tidak mengganti jatah atau ukuran diam-diam. |
| Menentukan urutan picking, penugasan, cutoff, rute kendaraan | Operations Controller | Harus tetap memenuhi instruksi alokasi dan prioritas komersial yang disepakati. |
| Mengambil barang, memasang tag, mengemas, memuat | Petugas DC | Mencatat aktual, melaporkan kekurangan; tidak membuat stok baru untuk menutup selisih. |
| Mengesahkan penerimaan inbound | Verifier receiving | Verifier berbeda dari counter sesuai kebijakan empat mata yang diinginkan. |
| Memverifikasi muatan dan mengizinkan berangkat | Loader dan Operations Controller | Keberangkatan harus sesuai manifest aktual atau perubahan manifest yang sah. |
| Menerima barang di toko | Petugas toko yang berwenang | Hanya site tugasnya; catat jumlah dan kondisi aktual, termasuk selisih. |
| Memindah backroom ke area jual | Petugas toko | Gerakan internal; tidak mengubah total perusahaan atau membuat alokasi HO baru. |
| Membuka opname dan menyelidiki Missing | Inventory Controller | Petugas lain dapat menghitung dan mencari bukti. |
| Mengusulkan dan menyetujui adjustment | Inventory dan approver berwenang | Reason, bukti, maker, checker, scope; nilai material dapat membutuhkan owner/finance. |
| Menutup sisa demand atau menyetujui replacement | MD | Penutupan demand tidak menghapus barang transit, kasus kehilangan, atau kerugian. |

Pemisahan count, input hasil, dan review selisih memiliki padanan dalam dokumentasi cycle counting Microsoft. Rincian siapa wajib menjadi reviewer adalah kebijakan perusahaan, bukan nama jabatan baku yang diwajibkan vendor. [Cycle counting](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/cycle-counting)

## 3. Alur pengguna dari barang masuk sampai tersedia untuk pelanggan

### A. Persiapan dan penerimaan supplier

```text
MD: artikel / SKU dan PO disetujui
                |
Supplier datang -> petugas memilih referensi PO / surat jalan
                |
Hitung aktual + periksa kondisi
                |
Verifier menerima hasil / meminta hitung ulang / membuka selisih
                |
Barang dikenal dan layak -> identitas/tag bila perlu -> simpan ke lokasi
Barang belum dikenal / rusak -> tahan dan selesaikan kasus
```

Petugas melihat identitas barang yang perlu dihitung, lokasi penerimaan, dan input aktual. Dalam mode blind count, kuantitas expected disembunyikan dari counter. Verifier melihat ordered, counted, good, damaged, difference, dan hasil hitung sebelumnya.

Bukti: referensi supplier/PO/surat jalan, waktu, petugas, jumlah aktual, kondisi, foto bila diperlukan, keputusan verifier, lot atau identitas unit, dan lokasi simpan.

Unidentified adalah jalur pengecualian untuk barang yang belum dapat diidentifikasi, bukan langkah wajib untuk setiap receipt. Tagging diperlukan ketika unit belum memiliki identitas yang valid; barang yang sudah source-tagged cukup diverifikasi sesuai kompatibilitas sistem. Konfirmasi tag terpasang juga tidak otomatis membuktikan barang telah disimpan di rak: lokasi put-away perlu dicatat bila berbeda.

Pemisahan penerimaan, pemeriksaan, pencatatan masalah, dan pemantauan desktop didokumentasikan dalam Oracle RWMS. RF dalam dokumentasi tersebut berarti terminal radio-frequency, bukan bukti bahwa setiap proses menggunakan RFID item-level. [Receiving RWMS](https://docs.oracle.com/cd/E12456_01/rwms/pdf/150/html/ui_user_guide/receiving.htm)

### B. MD menentukan allotment

```text
Pilih artikel / warna / ukuran
                |
Bandingkan 13 toko: stok layak, sales, ukuran kosong, kiriman berjalan
                |
Isi / tinjau usulan jumlah per SKU × toko
                |
Aktifkan allotment -> komitmen tercatat -> Operations melihat demand
```

Informasi minimum: foto artikel; SKU warna–ukuran; stok toko yang layak; penjualan dengan periode; hari tersedia bila datanya ada; incoming yang belum diterima; outstanding allotment yang belum termasuk incoming; target cover atau minimum display; stok pusat layak dialokasikan; quantity yang diusulkan dan diputuskan; alasan override.

Hindari mengurangi incoming dan outstanding dua kali jika incoming sudah merupakan bagian outstanding. Sales nol pada barang yang habis tidak berarti permintaan nol. Untuk artikel baru, MD dapat menggunakan size profile, artikel pembanding, atau aturan awal yang transparan; jangan menampilkan forecast seolah hasil pasti.

Oracle Allocation mendokumentasikan net need, keterbatasan supply, dan size profile. Ini mendukung keputusan per item–lokasi, bukan sekadar membagi total potong sama rata ke 13 toko. [Allocation Overview](https://docs.oracle.com/en/industries/retail/retail-allocation-cloud/latest/ralim/allocation-overview.htm)

Tidak ada dasar untuk mewajibkan semua aplikasi melarang Draft. Usulan V1 dapat mempertahankan form/preview sebelum aktivasi; autosave perencanaan yang tidak mereservasi stok boleh ditambahkan. Yang wajib jelas adalah kapan komitmen mulai berlaku, bukan apakah tombolnya bernama Create atau Confirm.

### C. Operations mengubah demand menjadi pekerjaan

```text
Allotment aktif + jadwal pengiriman + kapasitas petugas
                        |
                Prioritas pekerjaan
                        |
Open demand per SKU dibanding supply Pick Area yang usable
                        |
                Kebutuhan ambil gabungan
```

Controller melihat kebutuhan per SKU, stok rak, Pick Area, pekerjaan yang sedang diambil, toko yang berisiko terlambat, koli terbuka, dan kendaraan terjadwal. Petugas melihat barang serta jumlah yang perlu ditambah ke Pick Area dan lokasi pengambilan, lalu mencatat aktual.

Tanpa tujuan toko pada unit bukan tanpa rencana. Perlu satu mekanisme klaim/penugasan pekerjaan agar dua picker tidak sama-sama mengerjakan kebutuhan yang sama. Supply bersama juga tidak boleh dijanjikan penuh kepada beberapa packer secara bersamaan: estimasi coverage tidak sama dengan reservation.

Metode ini perlu diuji terhadap picking langsung per toko. Bila volume rendah atau ruang sorting terbatas, picking per toko dapat lebih praktis. Jumlah toko saja belum menentukan metode terbaik.

### D. Ambil dan kemas

```text
Storage -> ambil aktual -> Pick Area bersama
                               |
Pilih toko dan koli -> isi fisik -> baca/scan isi -> validasi -> seal
                               |
                    Packed untuk toko tertentu
```

Pada mode RFID, catatan unit harus mengikuti EPC yang benar-benar dibaca, bukan memilih EPC lain secara FIFO. Manual quantity tetap dapat menjadi mode berbeda jika kebutuhan jejak per unit dipenuhi secara jujur. Tampilan harus membedakan evidence RFID dan input manual.

Packing memeriksa unit ada di lokasi yang diizinkan, kondisi layak, belum dikemas di koli lain, SKU benar, dan jatah tujuan masih tersedia. Penetapan ke allotment harus atomik agar dua packing station tidak menghabiskan sisa yang sama.

Satu koli satu tujuan untuk V1. Bila satu SKU mempunyai beberapa allotment ke toko yang sama, sistem memilih line sesuai aturan yang transparan dan menyimpan tautannya. Membuka kembali koli memerlukan pembatalan seal dan movement/atribusi balik yang tercatat.

### E. Shipment dan dispatch

```text
Koli tersegel -> Shipment (satu tujuan toko)
                         |
Beberapa shipment -> Dispatch (satu keberangkatan kendaraan)
                         |
Scan/cek muatan -> manifest final -> berangkat -> In Transit
```

Bukti: daftar koli dan isi, shipment, tujuan, kendaraan/pengangkut, loader, waktu loading/departure, serta serah-terima. Rencana muatan tidak sama dengan muatan aktual.

Jika muatan hanya 10 dari 11 koli, pilih menyelesaikan loading atau memecah/merevisi manifest dengan otorisasi. Jangan menandai koli yang tertinggal sebagai transit. Pengiriman sebagian merupakan pola yang didukung sistem gudang nyata; persetujuan perubahan dan jejak sisa adalah rancangan kontrol kita. [Partial shipment](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/partial-shipping-of-transport-loads)

### F. Toko menerima lalu mengisi area jual

```text
Incoming shipment -> cocokkan koli -> hitung/baca isi aktual
                                      |
                 Terima aktual + laporkan selisih/kondisi
                                      |
                              Backroom / Hold
                                      |
                         Isi Sales Floor -> Penjualan
                                      |
                        Kebutuhan refill / alokasi berikutnya
```

Toko melihat shipment yang menuju tokonya, ETA bila tersedia, koli expected, received, damaged, missing/unexpected, dan tindakan yang belum selesai. Toko tidak sekadar menekan Receive All tanpa bukti apabila proses mengharuskan verifikasi isi.

Pisahkan diterima fisik, diterima layak jual, dan jumlah yang dianggap memenuhi demand. Barang rusak yang tiba tetap ada secara fisik; ia tidak menjadi Missing. Kebijakan apakah perlu replacement diputuskan terpisah.

Oracle Store Inventory menyediakan pencatatan received/damaged dan pengecualian transfer. [Transfers](https://docs.oracle.com/en/industries/retail/store-inventory-op-cloud/latest/rsoug/transfers.htm)

Sales Floor replenishment menjadi pekerjaan toko. Untuk fashion, gunakan penjualan, ukuran/display yang kosong, dan stok backroom; tidak perlu menjadikan maintenance planogram yang kompleks sebagai syarat awal. Oracle secara khusus mendokumentasikan penggunaan sales-based dan display replenishment pada fashion. [In Store Replenishment](https://docs.oracle.com/en/industries/retail/store-inventory-op-cloud/latest/rsoug/store-replenishment.htm)

### G. Retur, selisih, dan opname

```text
Retur komersial: toko usul -> MD putuskan -> Operations atur transfer
                 -> toko kemas/kirim -> DC terima/periksa -> restock/hold

Selisih: petugas lapor -> Operations cari kendala proses
                     -> Inventory telusuri dan hitung ulang
                     -> approver sahkan koreksi bila diperlukan
                     -> MD putuskan sisa demand/replacement

Opname: Inventory pilih scope/cutoff -> petugas hitung
                     -> review selisih -> recount/koreksi -> tutup
```

Retur barang baik karena redistribusi bukan Reject. Retur pelanggan, retur toko ke DC, dan retur DC ke supplier memerlukan alasan serta referensi yang berbeda. POS dan refund tetap mengikuti kewenangan penjualan/keuangan; Inventory menangani kondisi serta saldo barangnya.

Kasus selisih hanya dibuat sekali dan ditautkan ke shipment, count, atau movement. Operations melihat dampaknya pada jadwal, Inventory melihat bukti dan koreksi, MD melihat risiko pemenuhan. Jangan membuat tiga kasus terpisah untuk satu kehilangan.

## 4. Menu dan isi layar yang direkomendasikan

Ini rancangan menu V1, bukan daftar semua modul perusahaan. Menu purchasing/master yang sudah ada dapat dipertahankan. Otorisasi tetap harus berlaku di server sekalipun tombol disembunyikan.

```text
MD
├─ Articles
├─ Sourcing
├─ Purchase Orders
└─ Allotment

OPERATIONS
├─ Overview
├─ Receiving
├─ Preparation
├─ Distribution
└─ Returns

INVENTORY
├─ Stock
├─ Counts
├─ Movements
├─ Exceptions
└─ RFID
```

Exceptions disarankan menjadi menu sendiri karena selisih penerimaan, short pick, dan Missing bisa muncul tanpa RFID. Bila empat item Inventory harus dipertahankan, jadikan Exceptions tab utama dalam Stock dan tampilkan jumlah kasus di landing Inventory; jangan menaruh semua masalah stok hanya di RFID.

### MD

| Menu / bagian | Apa yang terlihat | Aksi utama |
|---|---|---|
| Articles | Foto, style, warna, ukuran, season, lifecycle, kesiapan SKU | Kelola master sesuai peran yang ada. |
| Purchase Orders | Supplier, ordered/received/open, jadwal, receipt discrepancy | Buat/tinjau PO, tindak lanjut supplier sesuai kewenangan. |
| Allotment — Needs | Matriks 13 toko, size gaps, sales period, cover, supply pusat, incoming | Pilih SKU/toko; hitung/tinjau usulan. |
| Allotment — Active | Allocated, accepted received, outstanding, due date, risiko | Aktifkan, revisi sisa yang diizinkan, close short dengan alasan. |
| Allotment — History | Completed/closed, hasil pemenuhan, perubahan dan pelaku | Telusuri riwayat; tidak mengubah fakta fisik lama. |
| Detail allotment | Tabs Stores, Items, Fulfillment, Activity | Drill-down sampai shipment tanpa membebani MD dengan layar reader. |

Untuk V1 sederhana, daftar dapat memakai Active / Completed / Closed. Completed berarti selesai sesuai definisi bisnis yang dipilih; tambahkan milestone DC dispatched dan store received sebagai angka terpisah. Draft/worksheet jika ada tidak memengaruhi komitmen sampai aktivasi.

### Operations Controller

| Menu / bagian | Apa yang terlihat | Aksi utama |
|---|---|---|
| Overview | Inbound hari ini, menunggu periksa, belum siap, pengiriman jatuh tempo, pekerjaan macet | Buka kasus/pekerjaan, assign owner, ubah urutan pekerjaan. |
| Receiving | Expected, Counting, To Verify, Received; supplier/PO, koli/unit, umur antrean, owner, selisih | Jadwalkan/assign, minta recount; verifier berwenang menerima aktual. |
| Preparation | Waiting, In Progress, Ready, Hold; identitas belum selesai, tag, lokasi put-away | Assign pekerjaan, print/reprint terkontrol, eskalasi master atau quality. |
| Distribution — Overview | Due today, open to pack, usable Pick Area, packed awaiting shipment, loading, late receipts | Prioritaskan pekerjaan dan tindak lanjuti hambatan. |
| Distribution — Allotments | Jatah MD, due date, pemenuhan per toko/SKU, sisa, shortage | Lihat, minta revisi; tidak mengganti keputusan MD sendiri. |
| Distribution — Pick Area | SKU, Storage usable, Pick Area usable, open demand, pick in progress, suggested pick, last move | Buat/assign pekerjaan gabungan; kelola kelebihan atau pengembalian ke rak. |
| Distribution — Packing | Toko, open demand, shared supply estimate, open koli, packed, blocker, operator | Assign/reprioritaskan, tangani exception; tindakan packing memerlukan hak eksekusi. |
| Distribution — Shipments | ID, toko, koli/unit, manifest, ready since, dispatch, received/discrepancy | Susun shipment, atur readiness sesuai hak, telusuri isi. |
| Distribution — Dispatch | Kendaraan/pengangkut, jadwal, toko, expected/loaded koli, missing load, departure, receipt progress | Rencanakan, sahkan manifest/perubahannya, authorize departure. |
| Returns | Return request/transfer, alasan, asal, tujuan, ready/in transit/received, condition | Atur gerakan balik dan pemeriksaan; keputusan komersial tetap MD. |

Preparation mencakup identifikasi, tagging, dan put-away. Jika istilah Tagging ingin dipertahankan, tambahkan langkah simpan/put-away di dalamnya; jangan membuat barang terlihat sudah di Storage hanya karena label selesai dicetak.

Controller boleh melakukan pekerjaan fisik ketika ia juga mendapat izin operator. Perangkat tidak menjadi batas kewenangan. Namun tindakan harus memakai identitasnya sendiri dan tetap tunduk pada larangan self-approval yang berlaku.

### Inventory Controller

| Menu | Apa yang terlihat | Aksi utama |
|---|---|---|
| Stock | Perusahaan/site/lokasi, book quantity, available menurut konteks, hold, missing, last count, data freshness | Telusuri SKU/EPC, histori, reservation; buka count/kasus. |
| Counts | Planned/Draft, Counting, Needs Review, Closed; scope, cutoff, expected, counted, variance, counter/reviewer | Rencanakan, assign, review, recount, approve sesuai izin. |
| Movements | Waktu kejadian/pencatatan, sebab, dari/ke, SKU/EPC, qty, referensi, actor, reversal link | Baca audit trail; koreksi melalui proses, bukan edit baris ledger. |
| Exceptions | Short receipt, short pick, missing, mismatch, damaged/unexpected; owner, umur, bukti, status | Investigasi, minta bukti, propose/approve resolution sesuai kebijakan. |
| RFID | Observations dan RFID discrepancies; EPC, konteks, reader/read point, timestamp, kualitas asosiasi | Tautkan bukti ke kasus, telusuri bacaan, kelola unknown EPC lewat proses master. |

RFID Seen adalah bukti baca, bukan jumlah pasti barang pada lokasi saat ini. Window judul mengikuti konfigurasi; hitung unique EPC, jelaskan scope, dan pisahkan unknown EPC dari inventory yang sudah dikenali. Informasi lokasi kejadian scan juga tidak selalu sama dengan lokasi bisnis setelah kejadian. GS1 memisahkan identitas, waktu, lokasi dan konteks proses. [EPCIS](https://www.gs1.org/standards/epcis)

### Petugas DC dan toko

```text
FLOOR DC                     TOKO — bagian operasional
Tugas                        Tugas
Terima                       Terima Kiriman
Ambil                        Stok & Cari Barang
Kemas                        Isi Area Jual
Kirim                        Retur / Transfer
Lainnya: Tag/Simpan,          Opname
Opname, Pindah, Sync          Kasir tetap modul penjualan
```

Menu terlihat sesuai stasiun/site dan izin. Lima pintu masuk utama lebih mudah dipakai daripada memaksa semua pekerjaan menjadi tombol sejajar. Tag dapat menjadi menu utama untuk operator tagging khusus.

| Layar petugas | Isi minimum | Hasil yang dicatat |
|---|---|---|
| Tugas | Antrean milik pengguna/stasiun, prioritas, lokasi, status offline | Mulai/lanjutkan pekerjaan; tidak menduplikasi tugas. |
| Hitung | Referensi, identitas barang, input qty/EPC, kondisi | Count aktual; expected disembunyikan bila blind. |
| Periksa | Ordered/count/difference, counter, catatan | Accept/recount oleh verifier berbeda. |
| Tag/Simpan | Lot/SKU, tag valid, jumlah, lokasi tujuan | Tag terpasang dan put-away aktual. |
| Ambil | Kebutuhan SKU gabungan, lokasi, aktual, alasan short | Perpindahan unit aktual ke Pick Area. |
| Kemas | Toko, koli, sisa SKU, scanned valid/duplicate/excess | Unit terikat koli dan allotment; seal. |
| Kirim | Shipment, koli, dispatch, expected/loaded, blocker | Manifest aktual dan departure yang sah. |
| Terima toko | Incoming untuk site sendiri, koli dan aktual good/damaged/short | Receipt parsial/komplet dan kasus selisih. |
| Isi Area Jual | Kebutuhan display/ukuran, backroom tersedia, jumlah dipindah | Backroom → Sales Floor. |
| Opname | Scope dan lokasi, daftar unit yang dihitung, unknown | Hasil count dikirim untuk review. |

## 5. Saldo dan commitment: jangan gabungkan tiga dimensi

```text
LOKASI / CUSTODY       KONDISI                 KOMITMEN
Rak                    Layak                   Belum dialokasikan
Pick Area              Hold / rusak            Jatah aktif
Koli / shipment        Missing unresolved      Terpenuhi / ditutup
In Transit
Backroom / Sales Floor
```

In Transit adalah tahap custody, bukan rak fisik di HO. Tampilkan sebagai cabang jaringan atau sebagai group distribusi dengan label yang jelas; jangan menambahkannya lagi ke stok toko tujuan sebelum receipt. Hold/rusak dan Missing bukan sinonim. Retur juga tidak otomatis berarti kondisi rusak.

On Hand jangan digunakan sebagai nama lain untuk stok bebas. Microsoft membedakan physical inventory, reserved, dan available physical; reservation juga dapat berada pada level lokasi yang berbeda. [Inventory on-hand](https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/inventory-on-hand-list)

Rekomendasi kartu Inventory: Recorded Stock, Available, Hold/Blocked, Missing; tampilkan Outstanding Allotment dalam blok demand yang jelas terpisah atau drawer. Available harus menyatakan konteks: available to allocate di pusat atau available to sell di toko. Jangan memaksakan seluruh kartu dijumlahkan menjadi total, karena kondisi dan komitmen dapat beririsan.

Contoh prinsip commitment:

```text
Approved allocation = 100
Accepted fulfillment = 60
Closed short = 10
Outstanding demand = 30
```

Definisi accepted fulfillment harus ditetapkan, terutama untuk damaged receipt. Unresolved shortage tetap menjadi kasus; jangan otomatis menghapusnya. Jika menghitung bucket fulfillment, gunakan jumlah yang saat ini berada di tahap tersebut, bukan menjumlahkan counter kumulatif picked/packed/shipped/received. Tambahkan bucket exception bila ada barang hilang atau rusak yang masih perlu keputusan.

Untuk Pick Area bersama, tidak perlu memaksa angka allotment per unit/per toko pada row tersebut sebelum attribution. Supply ditampilkan sebagai supply, demand sebagai demand. Jika reservation dipindahkan antar-area, rekam perpindahannya secara eksplisit. Pending dan barang blocked harus dikecualikan dari available sesuai aturan kelayakan. [Inventory statuses](https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/inventory-statuses)

## 6. Contoh pembuktian serah-terima

Contoh hipotetis, bukan data nyata perusahaan:

MD mengalokasikan 100 potong ke Store 07. DC mengemas dan memberangkatkan 100. Toko menemukan 98.

| Pihak | Apa yang dilakukan |
|---|---|
| Toko | Membukukan receipt aktual 98 dan melaporkan 2 belum ditemukan; menyimpan bukti koli/scan/count. |
| Operations | Memeriksa manifest, koli tertinggal, kendaraan, dan urutan serah-terima. |
| Inventory | Mencocokkan movement/EPC, meminta recount, menentukan apakah salah catat atau kehilangan. |
| MD | Memutuskan replacement atau close short setelah informasi cukup. |

Stok toko tidak boleh ditulis 100 hanya supaya allotment terlihat selesai. Menutup demand tidak membenarkan penghapusan jejak 2 unit. Jika dua unit ternyata berada di DC, lakukan koreksi custody berdasarkan bukti; jika hilang, lakukan proses loss/adjustment sesuai kewenangan. Sampai keputusan sah, kasusnya tetap terbuka.

## 7. Cara membuktikan cocok untuk bisnis ini

Literatur membuktikan pola memiliki padanan operasional. Kecocokan layout dan produktivitas gudang ini harus diuji langsung.

Pilot yang disarankan: satu gudang pusat, dua toko dengan karakter berbeda, beberapa artikel yang punya variasi ukuran, satu putaran inbound–outbound–receipt–display, kemudian ulangi dengan partial shipment, short receipt, damaged item, recount, dan retry sinkronisasi. Ini usulan cakupan, bukan pilot yang sudah dilakukan.

| Skenario | Bukti lulus |
|---|---|
| Alur normal | Setiap unit/qty dapat ditelusuri dari receipt hingga toko; internal transfer tidak mengubah total jaringan. |
| Shared picking | Unit aktual sesuai scan, tidak terikat toko sebelum packing; pekerjaan tidak digandakan antar-picker. |
| Dua packer, satu sisa alokasi | Total berhasil pack tidak melampaui sisa yang sah. |
| Short load | Yang tertinggal tidak menjadi In Transit; manifest final sesuai keberangkatan aktual. |
| Short/damaged receipt | Good, damaged, dan missing dibedakan; kasus dan pemilik tindak lanjut jelas. |
| Duplicate scan / retry offline | Satu kejadian tidak membukukan movement dua kali. |
| Count saat ada movement | Cutoff atau penyesuaian movement diketahui; tidak membandingkan angka dari dua waktu berbeda. |
| Permission | Operator tidak dapat mengubah alokasi, mengakses toko lain, atau menyetujui koreksinya sendiri bila dilarang. |
| Retur | Barang baik dan rusak mengikuti disposition yang benar; transit balik terlacak. |

Ukur waktu per 100 potong, jumlah sentuhan ulang, jarak/kemacetan picking, umur antrean packing, kesalahan tujuan/ukuran, ketepatan keberangkatan, durasi receipt, selisih stok, dan lama penyelesaian kasus. Bandingkan dengan baseline bisnis sendiri; jangan menjanjikan persentase efisiensi dari kasus retailer lain.

## 8. Hubungan dengan kode yang sudah diaudit

Temuan audit adalah pembacaan kode, bukan bukti bahwa semua layar atau server tersebut merupakan deployment produksi yang aktif.

| Bagian | Temuan yang terverifikasi | Implikasi |
|---|---|---|
| Floor DC | Tugas, Terima, Ambil, Kemas, Kirim; Tag dan Opname di drawer. [Navigasi](/Users/hari/itulah/frontend-floor/src/lib/navigation.ts:47) | Pertahankan fondasi; rapikan guidance dan batas izin. |
| Supplier receiving | Counter berbeda verifier ditegakkan server secara default, tetapi konfigurasi dapat melonggarkannya. [Kontrak](/Users/hari/itulah/backend/src/edge/contracts.rs:1298) | Pastikan konfigurasi deployment sesuai SOP. |
| Store app | `frontend-store-new` sudah punya Receive, Stock/movement, dan customer Returns. [Screen registry](/Users/hari/itulah/frontend-store-new/src/screens/index.ts:23) | Jangan menyatakan semua aplikasi toko belum memiliki receiving. App lama `frontend-store` lebih terbatas. |
| Store movement | Warehouse ↔ Shop floor ↔ Reject sudah dapat dilakukan lewat Stock. [Layar Stock](/Users/hari/itulah/frontend-store-new/src/screens/stock.tsx:33) | Perbaikan berikutnya adalah guidance replenishment dan opname khusus, bukan membangun seluruh movement dari nol. |
| Store receive | Membukukan receipt melalui endpoint khusus dan izin Supervisor; tidak punya maker/checker supplier yang sama. [Handler](/Users/hari/itulah/backend/src/edge/http.rs:1256) | Tentukan policy penerimaan toko dan cara menangani expected-vs-actual/discrepancy. |
| Permission | Peran generik Cashier/Supervisor/Admin, termasuk satu izin DcOperate yang luas. [Edge auth](/Users/hari/itulah/backend/src/edge/auth.rs:93) | Tambahkan permission tindakan dan scope; jangan sekadar mengganti nama role/menu. |
| Count approval | Pada fungsi yang diaudit belum ditemukan pemeriksaan actor independen seperti receiving. [Counts](/Users/hari/itulah/backend/src/cloud/postgres/counts.rs:419) | Simpan approver dan tegakkan separation sesuai kebijakan. |
| Missing resolution | Found/lost/dispose merupakan mutasi berizin; audit movement belum berarti review independen. [Resolution](/Users/hari/itulah/backend/src/cloud/postgres/queries.rs:2354) | Bedakan pengusul, bukti, approver, dan dampak demand. |
| Retur toko ke DC | Jalur yang ditemukan belum membentuk workflow retur lengkap; manual service menolak RETURN_TO_DC. [Service](/Users/hari/itulah/backend/src/cloud/postgres/movements.rs:22) | Customer return tidak boleh dianggap sudah mencakup store-to-DC transfer. |
| HO dan DC | HO merupakan lokasi organisasi; inventory site adalah DC atau Store. [Employment migration](/Users/hari/itulah/backend/migrations/postgres/0060_employment.sql:12) | Gunakan nama gudang/site pada Stock dan cakupan HO pada kewenangan. |

Audit sebelumnya juga menemukan perbedaan cloud/edge pada picking dan commitment: free picking Edge tidak mengonsumsi allotment, sementara cloud-native execute allotment mengurangi remaining ketika dipick. Ini harus disatukan sebelum dashboard diberi definisi baru. [Edge picking](/Users/hari/itulah/backend/src/edge/sqlite.rs:3016), [Cloud allotment](/Users/hari/itulah/backend/src/cloud/postgres/allotments.rs:771).

Urutan implementasi yang disarankan: definisi event/saldo dan izin → jalur fisik serta exception yang belum lengkap → rekonsiliasi cloud/edge → layar controller dan drawer → pilot. Rename dan group UI yang tidak mengubah arti angka dapat dikerjakan lebih awal. Tidak perlu membongkar seluruh aplikasi untuk memulai.

## 9. Bukti penerapan dunia nyata dan batasnya

| Sumber primer | Praktik yang didokumentasikan | Batas bukti |
|---|---|---|
| [I.T.’S. / GS1 Japan, konteks Mei 2012](https://www.gs1.org/sites/default/files/docs/casestudies/GS1Japan_EPCRFIDCaseStudy_InventoryMgtApparel_ITS.pdf) | Jaringan 13 toko, tag item, identitas karton SSCC, pemeriksaan saat tiba di toko, dan inventory count. | Kesamaan jumlah toko tidak membuktikan kebutuhan tenaga/layout kita sama. |
| [Wacoal / GS1 Japan Handbook 2023–2024](https://www.gs1jp.org/assets/img/pdf/GS1-Japan-Handbook_2023-2024.pdf) | DC membaca barang masuk, memproses retur toko, serta mencocokkan hasil baca setelah picking dengan daftar pengiriman. | Tidak mendeskripsikan jabatan controller kita atau destinationless picking persis. |
| [Inditex Annual Report 2015](https://static.inditex.com/annual_report_2015/en/our-priorities/innovation-in-customer-services.php) | Identifikasi pakaian dari logistics centre sampai penjualan; penggunaan informasi lokasi untuk replenishment dan stock count toko. | Laporan korporat historis, bukan audit independen atau gambaran kondisi 2026. |
| [Studi Arkansas/Auburn, diterbitkan 2012](https://rfid.auburn.edu/papers/documents/RFIDItemLevelQuantityAuditing.pdf) | Studi proses receiving, pick/pack, outbound, dan audit RFID pada apparel supplier DC. | Studi supplier; tidak membuktikan bahwa semua retailer perlu desain identik. |

Ketiga laporan kasus dan studi lapangan ini menunjukkan bahwa pemeriksaan identitas/jumlah di titik perpindahan adalah praktik nyata. Dokumentasi Oracle/Microsoft menunjukkan pola proses dan kemampuan produk. Susunan menu, pembagian jabatan, aturan persetujuan, dan pilihan Pick Area dalam dokumen ini tetap merupakan rekomendasi untuk diuji, bukan sesuatu yang diwajibkan GS1 atau terbukti universal.

Catatan akses: PDF I.T.’S. dan handbook Wacoal tersedia melalui hasil indeks pencarian sumber primer; pembukaan langsung masing-masing dibatasi 403 dan ukuran dokumen. Klaim yang digunakan dibatasi pada cuplikan sumber yang terbaca. Laporan Inditex dan studi universitas dapat dibuka. Tidak ada angka penghematan atau akurasi retailer lain yang dijadikan target bisnis ini.
