# UI/UX pemindahan stockroom → shop floor

Riset dan proposal lokal, 11 Oktober 2026. Konteks: toko fashion dengan EPC unik per pakaian, tiga pool lokasi, Store Edge, dan ledger sebagai sumber fakta inventory.

## Rekomendasi

Untuk kebutuhan toko ini, gunakan **workspace scan per sesi**: pilih asal/tujuan sekali → scan seluruh tag → tinjau jumlah/varian → konfirmasi setelah barang tiba → tampilkan hasil per tag. Dasar interaksi yang paling cocok adalah Odoo Barcode, ditambah pemisahan tugas dan pengecualian dari Dynamics/SAP serta bukti perpindahan dari ERPNext.

“Paling cocok” adalah penilaian desain terhadap pekerjaan ini, bukan hasil benchmark ERP. Riset dilakukan melalui dokumentasi resmi dan audit aplikasi lokal; tidak mencoba tenant ERP berbayar atau mengukur staf toko. Angka waktu dan peningkatan produktivitas belum dapat diklaim.

## Audit aplikasi saat ini

Halaman `http://store.localhost:5482/stock` berhasil dibuka dengan akun demo yang didokumentasikan di repository. Saat audit, demo menunjukkan 13 potong di Stockroom, 3 di Shop floor, dan 0 di Return stock. Angka tersebut hanya observasi saat itu; dataset prototipe terpisah memiliki 35 potong contoh.

Sumber lokal yang diperiksa:

- `frontend-store-new/src/screens/stock.tsx`: ringkasan On hand/Allotted/Missing, tiga kartu pool, dan pintasan Move stock.
- `frontend-store-new/src/screens/stock/move-sheet.tsx`: asal/tujuan, satu tag aktif, konfirmasi per potong, dan hasil perpindahan terbaru.
- `frontend-store-new/src/screens/stock/mover.ts`: default warehouse → floor; penolakan barcode SKU; POST satu EPC dengan quantity 1, NORMAL_MOVE, dan idempotency key.
- `frontend-store-new/src/screens/stock/shared.ts`: lokasi warehouse/floor/reject dan petunjuk posisi dari 100 movement terbaru.
- `frontend-contract/src/contract/MoveRequest.ts` serta `backend/src/edge/http.rs`: kontrak satu EPC, endpoint movement, permission, dan actor dari principal.

Fondasi yang sudah tepat: identitas per pakaian, arah bertahan antarbarang, refocus scanner, dan ledger. Hambatan untuk pemindahan satu rail: satu konfirmasi untuk setiap potong; pemindaian tag berikutnya mengganti satu tag aktif; lokasi asal bisa berubah mengikuti petunjuk ledger. Arah yang berubah otomatis menambah risiko operator memahami sesi secara berbeda dari sistem. Ledger terbaru juga bukan pencarian posisi lengkap seluruh EPC.

`Missing` adalah discrepancy inventory. Jangan menggunakannya sebagai daftar “display perlu diisi”: rak kosong bisa normal karena barang terjual, sedangkan barang hilang memerlukan rekonsiliasi.

## Perbandingan ERP

| Sistem | Fakta dari sumber resmi | Penilaian untuk pekerjaan toko |
|---|---|---|
| Odoo Barcode | Mendukung pemrosesan transfer dengan scan dan validasi. Dokumentasi internal transfer memperlihatkan konteks lokasi dan daftar produk. | Dasar terbaik dari pola yang ditinjau untuk scan berulang dengan satu arah tetap. Adaptasi wajib: menghitung EPC unik, bukan menaikkan kuantitas SKU setiap barcode yang dibaca. |
| Dynamics 365 Supply Chain | Replenishment min/max membentuk kerja berdasarkan batas stok/lokasi. Detour bisa kembali ke tugas awal tanpa kehilangan konteks. | Ambil kontinuitas tugas dan pengecualian. Target display/refill terencana menjadi tahap lanjutan; konfigurasi warehouse enterprise tidak diperlukan untuk tahap pertama. |
| SAP Warehouse Operator | Panduan v2.4 menjelaskan scan sumber, barang, tujuan; pekerjaan belum selesai bisa dilanjutkan. Memiliki dukungan produk serialized. | Ambil verifikasi tiba dan keterbacaan hasil parsial. Resource/HU dan orkestrasi warehouse lengkap menambah beban pada perpindahan toko sederhana. Panduan PDF ini versi 2024, bukan klaim seluruh kemampuan versi terbaru. |
| ERPNext | Material Transfer menggunakan asal/tujuan, tabel item, Save/Submit, dan akses ledger. Ada pilihan transit untuk perpindahan dua tahap. | Ambil bukti dan ringkasan sesi. Form stok administratif kurang sesuai untuk scan sambil memegang pakaian. Transit bukan default untuk perpindahan dalam toko oleh satu operator. |

Referensi resmi:

1. [Odoo — Create and process transfers with barcodes](https://www.odoo.com/documentation/saas-19.4/fr/applications/inventory_and_mrp/barcode/operations/transfers_scratch.html). Ekstrak indeks pencarian resmi tersedia; pembacaan halaman penuh beberapa kali timeout. Karena itu evaluasi detail visual Odoo terbatas.
2. [Odoo — Process receipts and deliveries with barcodes](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/operations/receipts_deliveries.html). Mendukung perbandingan pola scan/kuantitas; tidak disamakan dengan receiving aplikasi ini.
3. [Dynamics 365 — Replenishment overview](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/replenishment).
4. [Dynamics 365 — Configure detours](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/warehouse-app-detours).
5. [SAP Warehouse Operator User Guide v2.4](https://help.sap.com/doc/e64a0fbe143045abab3384292154a58a/2.4/en-US/4547d7e7b1a44858874987b143482b4b.pdf), khususnya bagian Product Picking dan Moving a Handling Unit.
6. [ERPNext — Stock Entry](https://docs.frappe.io/erpnext/stock-entry).

## Desain yang dipilih

### Stok dan pekerjaan punya tempat masing-masing

Pertahankan halaman overview untuk mengetahui saldo. Saat memindahkan banyak potong, masuk workspace yang punya input scan, daftar tag dikelompokkan per SKU/warna/ukuran, dan satu ringkasan sesi. Halaman penuh lebih cocok untuk sesi berulang yang panjang; sheet yang ada tetap masuk akal untuk perpindahan cepat satu potong. Prototype memilih workspace sebagai jalur utama pekerjaan batch.

Desktop menampilkan ringkasan di kanan. Ponsel menampilkan bar bawah berisi jumlah, arah, dan Tinjau, agar tindakan utama tetap tersedia saat daftar panjang. Catatan opsional dibuka saat diperlukan. Kontrol sentuh utama minimum 44 px. Detail EPC berada di disclosure; nama/warna/ukuran dan kuantitas selalu terlihat.

### Satu sesi hanya satu arah

Default Stockroom → Shop floor. Setelah tag pertama, asal/tujuan terkunci. Salah lokasi ditolak dengan lokasi aktual dan instruksi memisahkan barang. Sistem tidak diam-diam mengganti arah untuk seluruh draft. Untuk arah lain: selesaikan/hapus draft lalu mulai sesi baru. Return stock tetap pool berbeda; jangan membuat scan dari sana otomatis menjadi stok jual.

### Jumlah berasal dari identitas fisik

Satu EPC = satu potong. Barcode artikel membantu pencarian tetapi tidak cukup untuk membuktikan pakaian mana yang pindah. Tidak ada edit kuantitas bebas. Tag ganda tidak menambah jumlah; tag tidak dikenal/salah lokasi ditolak. Salah scan dapat dikeluarkan sebelum posting.

Input prototipe mendukung EPC yang diketik/scanner keyboard dengan Enter. Tombol Scan 5 tag contoh menyimulasikan input. Tidak ada klaim kamera, akses UHF reader, atau integrasi handheld asli. Reader RFID yang mengirim banyak sightings memerlukan dedup/filter/session boundary lewat adaptor perangkat yang sesuai.

### Konfirmasi saat barang sampai

Preview menunjukkan asal/tujuan, jumlah potong, varian, dan perkiraan saldo setelah semua berhasil. Checkbox tiba mengikat posting ke kejadian fisik. Dalam implementasi dengan barcode lokasi, scan tujuan dapat menggantikan checkbox. Belum ada barcode lokasi/bin pada prototype.

Satu operator memindahkan barang di dalam toko: satu konfirmasi sesi cukup. Bila proses nyata melibatkan dua operator atau penyerahan lama, pertimbangkan task Pick → Deliver → Receive dan lokasi transit yang benar. Jangan memunculkan stok shop floor sebelum barang siap dijual.

### Draft, offline, dan hasil parsial

Scan hanya membentuk draft; belum memindahkan saldo. Draft contoh tersimpan di localStorage, dengan fallback pesan bila penyimpanan tidak tersedia. Internet/HO putus berbeda dari server toko putus: Store Edge dapat melayani perpindahan selama koneksi lokal masih tersedia. Label demo offline khusus mengartikan server toko tidak tersambung.

Saat 4 dari 5 berhasil, tampilkan “4 berhasil, 1 belum pindah”; saldo berubah untuk empat tersebut dan hanya tag gagal tersisa. Retry tidak mengulang barang yang telah berhasil. Baris gagal memiliki alasan dan boleh dikeluarkan. Refresh mempertahankan draft dan bukti hasil contoh.

## Implikasi implementasi produksi

Prototype **tidak melakukan POST movement**. Model lokal memiliki posisi lengkap setiap tag; UI produksi sekarang memakai petunjuk ledger terbaru. Peningkatan produksi memerlukan:

1. Lookup/batch validation posisi EPC yang authoritative, atau respons server saat posting; cache tidak boleh dianggap kebenaran penuh. Jangan menampilkan “posisi tervalidasi” bila hanya mengandalkan ledger 100 terbaru.
2. Draft per sesi dengan route immutable, EPC unik, dan idempotency key tetap per intent. Simpan sebelum request. Mengubah payload yang ditolak perlu intent/key baru sesuai kontrak idempotency backend.
3. Gunakan endpoint NORMAL_MOVE yang sudah ada untuk satu EPC atau rancang batch response berstatus per EPC. Satu CTA untuk operator tidak berarti seluruh batch otomatis satu transaksi database. Prototype mensimulasikan beberapa hasil posting yang dapat parsial.
4. Pisahkan pending/confirmed/failed/unknown. Timeout dapat berarti server sudah commit; retry dengan key yang sama atau rekonsiliasi hasil sebelum mengubah saldo atau mengirim intent baru. Prototype tidak menyimulasikan transport timeout dengan status hasil unknown.
5. Simpan session ID untuk korelasi audit. Riwayat contoh mengelompokkan hasil satu kali konfirmasi, termasuk retry sebagai hasil terpisah; produksi idealnya menghubungkan semuanya ke satu sesi dan ledger entries aslinya.
6. Actor tetap ditentukan principal server; permission inventory move, from/to validation, dan unique EPC tetap ditangani server. Nama operator contoh bukan pemberian permission.
7. Replenishment otomatis baru setelah target display per varian, stok sumber yang benar-benar tersedia, dan pekerjaan refill yang sudah berjalan tersedia. Hindari rekomendasi stok buatan berdasarkan saldo pool total.

## Validasi dan penelitian berikutnya

Delapan pengujian model mencakup draft tanpa perubahan saldo, duplicate/SKU rejection, salah lokasi, route lock, offline/reconnect, partial/retry, perubahan posisi oleh operator lain, restore, dan reverse move. Pemeriksaan browser dan ukuran layar dicatat di `prototypes/stockroom-floor-research/QA.md`.

Uji dengan 3–5 staf toko pada perangkat yang benar-benar digunakan. Bandingkan alur sekarang dan prototype dengan satu rail 20–40 potong. Sertakan tag ganda, ukuran mirip, tag salah lokasi, server toko putus, dan hasil parsial. Ukur durasi penyelesaian, tap selain scan, salah tujuan, kemampuan melanjutkan draft, serta pemahaman “belum pindah”. Target desain: tidak ada salah tujuan yang diam-diam diterima, tidak ada double count, dan operator bisa membedakan hasil parsial tanpa bantuan. Ambang waktu baru ditetapkan setelah baseline diukur.
