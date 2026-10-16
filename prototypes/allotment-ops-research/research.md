# Riset allotment, MD, dan Operations: desain yang sederhana untuk proses yang bisa berubah

11 Oktober 2026 · Itulah Cloud Hub

**Rekomendasi utama: pertahankan permintaan MD sebagai satu dokumen yang bisa direvisi, tampilkan posisi fisik per toko × SKU × koli/pengiriman, dan jadikan koreksi sebagai pekerjaan gudang yang mempunyai pemilik serta bukti selesai.** Layar gudang menjawab “apa yang perlu saya kerjakan sekarang”; layar MD menjawab “berapa yang masih diminta, apa yang sudah terjadi, dan keputusan apa yang perlu saya ambil”.

Antrean pekerjaan merupakan kandidat default paling kuat untuk tugas penanganan perubahan. Board tetap berguna untuk koordinasi tahap. Pilihan ini adalah hipotesis desain yang perlu diuji bersama operator, bukan klaim kemenangan usability yang sudah dibuktikan.

## 1. Metode dan batas riset

Riset ini menggabungkan dokumentasi resmi lima keluarga ERP, inspeksi source Hub/backend saat ini, catatan desain 9 Oktober, dan laporan audit/E2E terdahulu. Deliverable adalah laporan ini dan prototipe lokal yang benar-benar mempunyai transisi kuantitas, peran, antrean, revisi, histori, dan simulasi offline.

Tidak dilakukan login dan task benchmark di SAP, Dynamics, Odoo, ERPNext, atau NetSuite. Deskripsi workflow vendor mempunyai sumber; penilaian beban interaksi dan rekomendasi kita merupakan analisis. Tidak dilakukan audit terautentikasi atas aplikasi produksi kita hari ini. Temuan historis tidak otomatis dianggap masih rusak; beberapa sudah mendapat perubahan dalam source terbaru.

Prototipe menggunakan data ilustratif. Tidak menulis ke API, database, carrier, atau sistem gudang. Tampilan berbahasa Inggris mengikuti produk; laporan ini berbahasa Indonesia. Artefak diletakkan terpisah dari aplikasi dan tidak mengubah file aplikasi yang sedang dikerjakan orang lain.

## 2. Mengapa ini memang sulit

Satu allotment dapat sekaligus memiliki 20 belum dipick, 20 dipick, 40 packed, 40 sudah berangkat. Toko lain dalam dokumen yang sama bisa sudah menerima. MD dapat mengurangi satu SKU, menambah SKU lain, membatalkan tujuan tertentu, atau mengubah kebutuhan saat gudang sedang scan.

Ada empat pertanyaan yang tidak boleh dijawab oleh satu status:

1. **Intent:** berapa permintaan yang masih sah sekarang?
2. **Fisik:** barangnya benar-benar di mana?
3. **Dokumen:** picklist, koli, SJ, trip, receipt, dan Return mana yang menjadi bukti?
4. **Pekerjaan:** perubahan apa yang belum dieksekusi, dan siapa mengerjakannya?

Misalnya `Cancelled` dapat benar untuk intent tetapi barang masih ada di koli. `Delivery completed` dapat benar untuk count pengiriman 95 sementara allotment 100 masih membutuhkan 5. `Return issued` tidak membuktikan barang sudah diterima kembali. Kesederhanaan UI harus berasal dari pemisahan fakta ini di model, lalu hanya menampilkan fakta yang membantu tugas saat itu.

## 3. Cara ERP lain menangani perubahan

### SAP EWM

SAP menyediakan cancellation pada warehouse request item, stock tertentu, dan handling unit; release dapat disertai warehouse task untuk putback. Cancellation parsial isi HU memerlukan repack. [Cancellation of Picking, SAP EWM](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/4f414373dd89535be10000000a421937.html).

Outbound Delivery Order memisahkan picking, loading, dan goods issue, beserta pembatalannya. Goods issue beberapa delivery yang digabung pada satu material document membatasi reversal independen. [Outbound Delivery Order, SAP EWM](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/0e6f4ddc5007423fb34d3bf189398031.html).

**Interpretasi untuk kita:** jangan hilangkan barang cancelled dari pekerjaan; jadikan putback eksplisit. Unit koreksi harus mengikuti objek fisiknya. Satu aksi terhadap koli bersama dapat berdampak pada SKU lain, tetapi tidak harus menghentikan toko lain. Menggabungkan transaksi demi kemudahan dispatch harus tetap menyimpan pemetaan line dan document untuk koreksi.

### Microsoft Dynamics 365 Supply Chain Management

Dynamics membedakan outbound order, load, shipment, warehouse work, shipment confirmation, dan packing-slip posting. Processing policy mengatur multi-shipment serta delivery remainder; versi tertentu mengembalikan remainder saat shipment direverse. [Outbound load handling](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/outbound-load-handling).

Dokumentasi troubleshooting menunjukkan urutan reverse shipment confirmation lalu pengurangan picked/load line, atau pembalikan pick registration dan picking ulang. [Quantity exceeds received/delivered quantity](https://learn.microsoft.com/en-us/troubleshoot/dynamics-365/supply-chain/warehousing/quantity-exceeds-received-delivered-quantity).

Ada cancel warehouse work khusus admin untuk exception. Setelah work dibatalkan, inventory movement tetap diperlukan untuk menempatkan barang secara fisik. Dokumentasi membedakannya dari cancellation operasional biasa. [Cancel warehouse work for exception handling](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/cancel-warehouse-work).

**Interpretasi untuk kita:** UI perlu memahami dependensi dokumen dan menunjukkan langkah koreksi yang paling awal diperlukan. Fitur admin untuk membenahi inkonsistensi bukan jalan rutin operator. Jangan menamai perubahan data sebagai bukti barang sudah berpindah.

### Odoo

Pada partial batch validation, Odoo memberikan pilihan membuat backorder, tanpa backorder, atau membatalkan validation. [Batch picking, Odoo 19](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/shipping_receiving/picking_methods/batch.html).

Return menghasilkan warehouse operation baru, dengan kuantitas dan return location. [After-sales returns, Odoo 19](https://www.odoo.com/documentation/19.0/applications/services/helpdesk/advanced/after_sales.html). Dokumentasi returns versi 18 juga menjelaskan reverse transfer dan credit note sebagai tindakan terpisah. [Returns and refunds, Odoo 18](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/returns.html).

Pembatalan shipping request di carrier memiliki aksi tersendiri; pengiriman ulang menghasilkan tracking/label baru. Referensi ini tersedia pada dokumentasi versi 17, sehingga jangan diasumsikan identik untuk semua konfigurasi 19. [Carrier request cancellation, Odoo 17](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/shipping_receiving/advanced_operations_shipping/cancel.html).

**Interpretasi untuk kita:** pisahkan keputusan atas sisa dari pergerakan barang yang sudah dikirim. Return, label cancellation, dan stock receipt adalah tiga kejadian berbeda. Backorder tidak perlu menjadi pertanyaan setiap kali scan; gunakan kebijakan default dan tampilkan keputusan saat operator menyelesaikan pekerjaan parsial.

### ERPNext

Allowed item edits memakai Update Items dengan validasi terhadap fulfilment terkait; amend untuk perubahan lebih luas membuat draft terkait dan menyimpan dokumen cancelled. Menutup sisa, hold, partial fulfilment, dan Return mempunyai tujuan berbeda. [Amending Sales Order after Submit](https://docs.frappe.io/erpnext/amending-sales-order-after-submit).

Satu Sales Order dapat dipenuhi beberapa Delivery Note; submission memperbarui stock ledger dan pending quantity, dan Return bisa dibuat setelah delivery. [Delivery Note](https://docs.frappe.io/erpnext/delivery-note).

**Interpretasi untuk kita:** kuantitas yang sudah menjadi bukti fulfilment membatasi perubahan permintaan; dokumen lama tetap menjadi histori. Quantity correction sehari-hari sebaiknya tidak memaksa pengguna menutup lalu membuat ulang dokumen yang sama.

### Oracle NetSuite

NetSuite dapat menutup line tertentu atau seluruh unfulfilled balance. Closing mempertahankan pemenuhan yang sudah terjadi; dokumentasi juga memperingatkan dependensi invoicing. [Closing a Sales Order](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4698204292.html). Advanced Shipping memisahkan fulfilment dan billing serta mendukung partial shipment. [Fulfilling Inventory](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2281951.html).

**Interpretasi untuk kita:** `Close unsent balance` adalah istilah yang lebih jujur sesudah dispatch parsial daripada `Cancel allotment`. Kita mengambil pola preservasi histori, bukan aturan reopen NetSuite: pada model kita, demand yang dibatalkan tetap final; kebutuhan baru memakai amendment yang diizinkan atau dokumen baru sesuai tahap.

### Kesimpulan lintas vendor

Kesamaan yang berguna: line-level quantities, dokumen fulfilment terpisah, putback/reversal sebagai kegiatan tersendiri, serta Return untuk barang yang perlu kembali. Tidak ada bukti bahwa satu generic status picker dapat menangani semua ini dengan aman.

| Pendekatan | Nilai untuk kita | Beban UX yang harus kita kurangi |
|---|---|---|
| Warehouse tasks ala SAP | Scope fisik dan pemilik koreksi jelas | Operator tidak perlu mencari transaksi dan tahap melalui banyak layar |
| Dependensi dokumen ala Dynamics | Reversal mengikuti urutan | UI menghitung urutan dan prefill objek terkait |
| Backorder/Return ala Odoo | Partial dan reverse flow eksplisit | Hindari popup keputusan saat tidak ada keputusan baru |
| Update/amend ala ERPNext | Dokumen dan audit tidak hilang | Pertahankan nomor allotment untuk koreksi kuantitas rutin |
| Close remainder ala NetSuite | Pemenuhan terdahulu tetap ada | Tampilkan jumlah yang ditutup, bukan hanya label Closed |

## 4. UI/model kita saat ini: yang harus dipertahankan

Inspeksi utama berada pada `frontend-hub`, bukan hanya versi `frontend-cloud` yang masih ada di repo.

| Bukti source | Perilaku yang sudah ada | Implikasi |
|---|---|---|
| `frontend-hub/src/screens/allotment/amend-data.ts` | Target, floor, released/owed preview, grid edit, added SKU/store | Jangan bangun ulang arithmetic berbeda di banyak layar |
| `frontend-hub/src/screens/allotment/allotments.tsx` | Footer MD, edit matrix, cancel dibatasi ketika someSent, outcome selesai berbeda | Teruskan batas edit, tetapi beri jalan tindak lanjut yang jelas |
| `frontend-hub/src/screens/allotment/cancel-dialog.tsx` | Dampak per tahap, reason, re-read saat dialog dibuka | Fondasi preview sudah kuat |
| `frontend-hub/src/screens/operations/board/board.tsx` | Stage board desktop, owed markers, held koli, MoveBackDialog | Pertahankan board sebagai mode koordinasi |
| `frontend-hub/src/screens/operations/board/owed.ts` | Perubahan diringkas ke kartu toko/koli; short-pick marks | Jangan menyatakan seluruh allotment bermasalah jika hanya sebagian |
| `backend/src/cloud/postgres/allotment_amend.rs` | Lock, idempotency, floor, additions, cancelled demand tidak direvive | Model koreksi kita sudah dekat dengan prinsip ERP matang |
| `backend/src/cloud/dc/move_back.rs` | Picked→To pick, Packed→Picked, Packed→To pick; parsial; settled vs pick again | Mundur fisik tidak selalu berarti membatalkan permintaan |
| `backend/src/cloud/dc/packing_stages.rs` | Guard koli/barang dengan pending takeout | UI disabled harus mencerminkan guard backend |

Floor MD mencakup barang pada SJ atau tahap sesudahnya, termasuk receiving gap dan received. **SJ issued tidak sama dengan truk telah berangkat**, tetapi tetap merupakan batas komitmen pada endpoint edit sekarang. Move-back gudang saat ini membatasi carton yang sudah ada pada trip. Karena itu prototipe memberi label *proposed extension* pada controlled SJ/loading reversal; jangan menganggap cukup menambah tombol frontend.

Cloud-run Gudang dan edge-owned allotment berbeda. Cabang edge masih memakai workflow/acknowledgement tersendiri; dokumen build menyatakan scope amendment/move-back baru bukan untuk edge. UI produksi harus mendapat capability dari server, bukan menebak kesetaraan kedua mode.

## 5. Apa yang perlu diperbaiki dibanding UI sekarang

1. **Menentukan next action membutuhkan pembacaan beberapa tahap.** Stage board menjawab lokasi kerja, tetapi perubahan urgent bersaing dengan pekerjaan biasa. Antrean `Needs attention` sebaiknya memuat task asli dan membuka detail yang sama.
2. **Batas edit benar tetapi jalan keluar kurang langsung.** “Some pieces already sent” sebaiknya disertai `Edit unsent balance` atau `Create Return`, dengan sumber fisik yang sudah diketahui.
3. **State request dan state fisik masih mudah terbaca sebagai satu label.** Cancelled harus selalu dapat ditemani “50 to put back · Warehouse”, termasuk pada riwayat.
4. **Arti mundur perlu terlihat sebelum konfirmasi.** Repack mempertahankan demand; putback akibat MD cancel menyelesaikan demand yang dibuang. Dua aksi ini dapat mempunyai tujuan rak yang sama tetapi konsekuensi berbeda.
5. **Scope mixed carton harus terlihat.** Hold koli bukan berarti seluruh toko/allotment berhenti; tindakan yang disabled harus menyebut koli dan koreksi penghambatnya.
6. **Offline dan perubahan bersamaan perlu menjadi pengalaman yang jelas.** Bedakan request terkirim, accepted, applied, dan failed. Jangan menggunakan sukses optimistis untuk memberi free stock yang belum diakui gudang.
7. **Detail perlu menjadi titik temu MD, gudang, toko, Inventory.** Dokumen, perubahan, fakta actual location, dan next owner tidak boleh tersebar menjadi kasus yang tampak tidak terkait.

Audit `ux-audit/evidence/04-ops-inventory-allotment.md` dan E2E `E2E-REPORT-B-allotment-outbound.md` sebelumnya mencatat data stale, closed-short yang hilang dari filter, release picked stock terlalu cepat, dan ketimpangan mobile. Ini merupakan **regression risks dari riwayat**, bukan daftar bug yang dibuktikan masih terjadi hari ini. Source sudah menunjukkan beberapa perbaikan; pengujian produksi diperlukan untuk menutup statusnya.

## 6. Struktur UI paling sederhana yang saya rekomendasikan

### MD

Dua ruang utama tetap **Unallotted** dan **Allotted**. Di Allotted hanya `All / Active / Finished` ditambah filter `Needs MD decision`. Finished menyimpan outcome `Completed / Closed short / Cancelled`; cancelled yang masih mempunyai koreksi fisik tetap mempunyai marker pekerjaan dan masih muncul pada antrean gudang.

Daftar cukup menampilkan nomor/supplier/toko, status permintaan, target/received, ringkasan pekerjaan terbuka, dan Open. Detail menyimpan tiga tab: `Items & actions`, `Changes`, `Documents`. Aksi utama mengikuti kondisi record; tidak perlu seluruh kemungkinan menjadi tombol permanen.

Untuk satu perubahan kecil, editor line di detail menampilkan sebelum/sesudah dan dampak. Untuk bulk edit, **pertahankan matrix yang sudah ada**. Prototype editor kecil menjelaskan mekanisme, bukan mengganti matrix volume tinggi dengan puluhan dialog.

### Gudang

Kandidat default: **Work queue**, dengan corrections/sync exceptions lebih dulu. Setiap task: allotment, tujuan, SKU, jumlah, aksi, lokasi/koli, pemilik. `By stage` tetap tersedia. Antrean dan board adalah dua pembacaan data yang sama; jangan membuat dua task atau dua status yang bisa berbeda.

Urutan pekerjaan bukan sekadar oldest first: prioritaskan koreksi yang memblokir packing/dispatch, lalu due date/route cut-off, baru umur. Prototype mengurutkan koreksi terlebih dahulu; due date/cut-off belum dimodelkan.

Bulk scan dan pack tidak perlu reason untuk setiap piece. Reason hanya pada perubahan intent, correction, discrepancy, atau irreversible boundary. Prototipe tidak meminta reason pada scan/pick/pack/receipt rutin dan putback yang sudah memiliki reason MD. Reason pada keputusan Inventory/correction tetap dapat dipilih dengan cepat.

### Mobile

Satu card dengan lead quantity, identitas, next action, dan owner. Tidak ada horizontal scrolling. Action footer tetap dapat dijangkau; touch target minimum 44px; teks pendukung minimum 14px; detail berupa bottom sheet. Semua fakta penting tersedia tanpa hover. Board berubah menjadi daftar/section vertikal.

### Mengapa ini berpotensi lebih cepat

- Tidak perlu menghitung ulang isi tahap atau selisih target sendiri.
- Record yang perlu tindakan memuat aksi langsung.
- Task correction terisi dari amendment, bukan diketik ulang.
- Aksi yang mustahil diberi alasan dan alternatif yang relevan.
- Detail dan history memakai record yang sama, sehingga navigasi berulang berkurang.

Ini sejalan dengan *recognition rather than recall* dan *progressive disclosure*: letakkan informasi/aksi utama pada konteks kerja, lalu buka rincian saat dibutuhkan. [NN/g: Recognition and Recall](https://www.nngroup.com/articles/recognition-and-recall/), [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/). Kecepatan aktual harus diuji; tidak ada persentase peningkatan yang dikarang.

## 7. Matriks skenario dan tindakan

| Keadaan / permintaan | Tindakan yang sesuai | Fakta yang harus terlihat | Pemilik berikutnya |
|---|---|---|---|
| Belum mulai, tambah target | Reserve tambahan setelah cek stok | Before/after, additional reservation | Gudang |
| Belum mulai, kurangi target | Kurangi remaining demand | Released immediate | Gudang melanjutkan sisa |
| Batalkan semua, belum pick | Cancel intent | Jumlah demand dicabut | Selesai |
| Sudah pick, kurangi | Cancel demand dan buat putback | Pick area→rak, jumlah masih owed | Gudang |
| Sudah pack, kurangi sebagian | Putback/repack pada SKU/koli terkait | Isi yang harus keluar dan retained contents | Gudang |
| Batalkan saat packing | Stop affected work dan cleanup task | Cancelled intent, physical work masih ada | Gudang |
| Sebagian SJ, sebagian belum | Edit / close unsent balance | Floor committed, original deliveries | MD lalu Gudang |
| SJ issued tetapi belum berangkat | Controlled unship/void lalu edit | Dokumen tercetak menjadi obsolete; quantity/rute aktual | Gudang; extension |
| Sudah loaded, belum berangkat | Unload→correct SJ→repack/putback | Konfirmasi lokasi fisik dan dependensi trip | Gudang; extension |
| Salah mencatat departure, barang masih di gudang | Supervisor correction dengan bukti | Correction event, bukan generic undo | Supervisor; belum prototype penuh |
| Sudah berangkat, MD ingin cancel | Hentikan sisa; request Return/recall | In-transit tetap; ack driver/store diperlukan | Ops/toko |
| Partial dispatch | Sisa tetap pada permintaan yang sama | Sent, received, remaining per line | Gudang / MD |
| Target 100, dispatched 95, counted 95 | Delivery selesai, allotment masih 5 | To pick 5 | Gudang, MD optional |
| SJ 100, counted 95, penyebab belum pasti | Receiving discrepancy | Receipt count dan investigation terpisah | Inventory |
| Lost 5 dikonfirmasi | Settle old portion; no replacement / linked new demand | Hasil bukti, replacement reference | MD |
| Found setelah demand ditutup | Koreksi inventori sesuai bukti | Histori; demand lama tetap closed | Inventory |
| Salah tujuan, barang diketahui di PIK | Return dari PIK / transfer baru dengan rute valid | Actual vs intended location | MD lalu Ops |
| Salah SKU sekaligus SKU asli kurang | Dua case kuantitas terkait | Jangan menggabungkan extra dan lost sebagai satu jumlah | Inventory + MD |
| Ubah tujuan sebelum pack | Amend/re-reserve tujuan dengan stock check | From/to destination dan demand delta | MD / Gudang |
| Ubah tujuan sesudah pack | Repack/relabel sebelum dispatch | Void label lama, new label, new destination | Gudang |
| Pindah tujuan setelah berangkat | Return/transfer sah dari actual location | Dokumen baru, shipment lama tetap | MD / Ops |
| Hold sementara | Freeze scope yang dipilih | Hold bukan cancelled; expiry/owner | MD; extension |
| Gudang offline | Durable pending command | Requested ≠ Applied, stock unchanged | Sync / Gudang |
| MD dan packer bersamaan | Revalidate revision dan transaksi atomic | Changed since review, fresh impact | Pengguna mereview lagi |
| Dua MD bersamaan | Konflik revision, tampilkan kedua perubahan | No silent overwrite | MD |
| Koneksi putus setelah Save | Lookup/retry idempotency key yang sama | Pending/confirmed result, bukan duplicate | Sistem |
| Label/SJ lama dipakai kembali | Reject obsolete document version | Current printable revision | Gudang |
| Retur setelah Completed | Related Return task tanpa membuka demand lama | Original outcome, open Return work | Gudang / Inventory |
| Mixed SKU/carton/delivery/allotment | Scope correction ke objek fisik | Shared dependencies, unaffected scope | Gudang |

Prototype menjalankan sebelas skenario utama serta tambahan hold, add SKU/store, short pick, forward/reverse quantities, quality release, dan partial correction. Skenario serialized scans, carrier recall acknowledgement, wrong-SKU dual case, supervisor departure correction, dan relabel/re-route atomic tidak diimplementasikan lengkap.

## 8. Preview perubahan: arithmetic yang dapat dipahami pengguna

Contoh line:

- Target 120.
- Belum pick 20, picked 20, packed 40, in transit 40.
- MD mengubah target menjadi 60.
- Reduction 60 mengambil 20 dari belum pick: released segera.
- Sisanya 40 menjadi pekerjaan fisik: picked 20 ke rak; packed 20 dibongkar ke rak.
- Packed 20 yang tetap diminta dan in transit 40 tetap ada.
- Free stock hanya bertambah 20 saat save; bertambah 40 lagi setelah putback benar-benar dikonfirmasi.

Preview menampilkan kelima angka itu; pengguna tidak perlu tahu nama counter database. Current target 60 **tidak sama** dengan jumlah fisik gudang+transit sementara koreksi masih pending. Karena itu pending quantity mempunyai ledger/identitas task terpisah.

Untuk top-up, reserve hanya delta baru dari free stock. Barang yang sudah cancelled dan menunggu putback tidak dipulihkan diam-diam jika MD kemudian menambah target; demand baru mengikuti reservasi yang sah. Untuk tujuan/SKU baru, validasi aggregate availability seluruh perubahan di transaksi yang sama.

## 9. Model dan aturan implementasi

### Objek yang dibutuhkan

1. Allotment dan line: current target, original/add/remove history, logical outcome.
2. Fulfilment slices: line×SKU/EPC×destination×carton×delivery, dengan lokasi aktual.
3. Amendment: actor, reason, requested revision, before/after, impact, applied result.
4. Correction task: affected physical scope, quantity, source/destination, owner, dependencies, pending/resolved state.
5. Delivery/Return/Replacement: dokumentasi terkait dengan origin yang dapat ditelusuri.
6. Durable command/sync receipt untuk edge.

Jangan mengganti ledger produksi dengan bucket mutable prototipe. Bucket demo memudahkan eksplorasi; produksi sudah mempunyai counters/events dan commitment views yang harus dipertahankan. Projection UI sebaiknya berasal dari canonical read model, bukan arithmetic alternatif di setiap screen.

### Invariants yang harus selalu berlaku

- Demand yang dicancel tidak hidup lagi dari generic Resume.
- Header request tidak menghapus history movement.
- MD tidak menurunkan target di bawah committed floor tanpa reversal dokumen yang memang valid.
- Barang yang menunggu putback tidak menjadi free stock.
- Koli yang mempunyai pending removal tidak dapat diterbitkan/dispatched dari revision lama.
- Barang departed tidak kembali ke Packed hanya karena status dipilih.
- Return received tidak otomatis berarti layak diallot ulang; quality disposition harus eksplisit sesuai kebijakan.
- Demand pengganti tidak dihitung bersama demand lama yang sudah diselesaikan sebagai lost.
- Quantity fulfilled di intended destination dibedakan dari barang counted di lokasi salah.
- Request outcome dan open related tasks dapat hidup independen.
- Partial action tidak mengubah line/toko yang tidak dipilih.
- Permissions, locks, stock checks, dan invariants dijaga server; UI bukan pengaman utama.

### Race dan offline

Preview menerima revision dan capability snapshot dari server. Saat commit, server memvalidasi kembali under lock yang sama dengan pack/dispatch. Jika dampak berubah material, jawab conflict berisi posisi terbaru dan ringkasan delta; pertahankan input pengguna, minta review ulang, jangan silent clamp.

Whole-allotment revision mudah untuk awal tetapi terlalu sering konflik di toko lain. Implementasi akhir sebaiknya memasukkan line revision dan physical object/document revision. Dua transaksi pada carton yang sama tetap saling bergantung walaupun SKU berbeda.

Idempotency key melekat pada satu logical command; retry setelah timeout memakai key sama. Status hasil harus dapat dibaca tanpa mengirim operasi baru. Duplicate putback juga membutuhkan guard completion/quantity, bukan hanya toast.

Untuk edge, simpan command dan outbox secara durable. UI memisahkan requested target dari applied target. Gudang mengirim acknowledgement dengan revision serta impact aktual; bila scan fisik sudah maju, command ditolak/direkonsiliasi, tidak diterapkan dari snapshot lama. Offline Warehouse tidak otomatis “dibekukan” secara fisik oleh UI cloud; pending change di HQ adalah niat yang belum dieksekusi. Demo tidak memodelkan autonomous offline scanning; stale-ack conflict diuji di model.

### Capability dan urutan reversal

Read model harus mengembalikan allowed actions serta reason ketidaktersediaannya. Dengan ini edge, cloud, supervisor, MD dan warehouse tidak memakai hardcoded aturan frontend yang berbeda.

Sebelum departure, correction runner dapat menyusun unload→unship→unpack→putback sesuai posisi. Setelah departure, gunakan Return/recall request, explicit acknowledgement, dan receive flow. Supervisor correction untuk salah input berbeda dari pembalikan fisik; bukti dan accounting effect harus ditentukan sebelum fitur produksi.

### Contract yang disarankan, bukan endpoint existing

Impact preview: scope IDs, expected revisions, before/after target, immediate release, physical corrections, immutable quantities, affected documents, allowed actions, and next owners.

Commit reply: command_id, idempotency_key, requested/applied revision, acknowledgement state, applied impact, correction task IDs, related documents, and next action.

Task read: scope, quantity/unit, source/actual location, destination, blocking dependencies, assignee role, age/cut-off, current document revision, and relevant actions.

Error reply: human reason, latest facts, stale input markers, compatible next actions. Jangan menampilkan Rust/SQL raw conflict ke operator.

## 10. Tahap implementasi produksi

**Tahap 1 — sederhanakan pembacaan, gunakan kemampuan existing.** Shared detail, clear outcome+pending work, impact preview canonical, correction inbox dari owed, contextual next actions, mobile parity. Stage board tetap tersedia. Tidak perlu migrasi seluruh ERP untuk mendapatkan manfaat pertama.

**Tahap 2 — kuatkan transaksi dan konsistensi.** Audit race lock order, canonical revisions/capabilities, idempotency result lookup, reliable stale/refetch behavior, reconciliation cloud/edge. Pastikan release picked/packed baru terjadi saat physical settlement sesuai model existing.

**Tahap 3 — closed loop exception.** Linked Return/replacement workflow, actual-location routing, inventory findings, lost settlement, no duplicate demand, document version invalidation. Tidak semua exception harus melewati MD; salah isi sebelum dispatch yang dapat direpack dimiliki Ops.

**Tahap 4 — perluasan controlled reversal.** SJ/loading reversal, partial multi-carton dependencies, carrier cancellation, supervised correction. Tentukan unit reversal sesuai dokumen dan batas accounting; jangan meniru semua opsi vendor menjadi tombol utama.

Hold/resume hanya untuk pause sementara yang memang diperlukan bisnis. Ini **proposal tambahan**, berbeda dari aturan catatan 9 Oktober yang tidak menyediakan Hold/Resume untuk short pick. Short pick sendiri tetap boleh dikerjakan dan tidak wajib melalui Resume.

## 11. Kecepatan UI dan performa

“Cepat” berarti cepat mengambil keputusan dan cepat merespons. Desain ini tidak memperbanyak KPI/bar yang harus dibaca.

- Render list summary dahulu; detail/SKU history lazy-loaded ketika dibuka.
- Query tasks berdasarkan Gudang, role, actionable scope, dan route cut-off; jangan fetch semua history pada setiap board poll.
- Gunakan satu canonical query/cache untuk task dan detail; invalidasi amendment/putback/dispatch yang terkait.
- Preserve search/filter/selection dan draft input saat refetch.
- Update confirmed server result langsung pada cache; pending offline state tetap diberi label.
- Index unsettled correction/tasks dan aggregate hanya scope yang ditampilkan.
- Virtualize daftar yang panjang; gunakan server-side cursor, bukan render ribuan kartu.
- Barcode keyboard focus tidak boleh hilang karena notification atau poll.
- Jangan mengulang confirmation pada scan yang reversible; tampilkan review pada perubahan intent dan boundary fisik/dokumen.

Target awal untuk diuji, bukan hasil benchmark: input feedback di bawah 100 ms; p95 list/filter/detail interaction di bawah 1 detik pada koneksi gudang representatif; task routine di bawah 3 klik setelah record terlihat. Simpan business transaction success terpisah dari render latency.

## 12. Rencana usability test untuk menentukan yang benar-benar terbaik

Bandingkan current stage board dan proposed queue memakai task yang sama, data identik, dan urutan yang diseimbangkan. Libatkan MD, picker/packer, dispatcher, store receiver, dan Inventory. Enam sampai sepuluh peserta awal cukup untuk menemukan masalah utama; tidak cukup untuk klaim statistik universal.

Tugas: top-up satu toko; kurangi target saat packed; cancel semua sebelum berangkat; stop sisa setelah partial dispatch; unship sebelum departure; return setelah departure; 95/100 tanpa kehilangan demand 5; confirmed loss replacement; wrong destination; stale revision; timeout setelah commit.

Ukur: task success tanpa bantuan, salah scope/quantity, waktu ke aksi pertama yang benar, waktu total, jumlah backtracking, langkah input, dan jawaban benar untuk “apakah barang ini sudah free stock?”. Kasus cancel harus dinilai selesai hanya ketika operator dapat menjelaskan sisa putback dan pemiliknya, bukan ketika tombol berhasil ditekan.

Kriteria penerimaan utama:

1. Semua peserta membedakan intent cancel dan physical return.
2. Tidak ada yang menganggap goods in transit sudah kembali karena cancel.
3. Operator menemukan koreksi yang memblokir koli tanpa membuka setiap tahap.
4. MD melihat delta dan impact sebelum save.
5. Seluruh 5 sisa contoh 95/100 tetap terlacak sampai dipenuhi/ditutup.
6. Smartphone dapat menyelesaikan tugas inti tanpa horizontal scroll atau tombol yang tertutup footer.
7. Race/timeout tidak menimbulkan silent overwrite atau duplicate transaction.

## 13. Prototipe dan verifikasi

Entry point: `index.html` melalui local HTTP server; preview `http://127.0.0.1:5478/`. Model browser-local berada di `model.mjs`; UI di `app.mjs`; sample state disimpan hanya di localStorage. `Reset all` mengembalikan data demo.

Eleven scenario presets mempermudah eksplorasi tanpa menyiapkan transaksi live. Prototipe mendukung perubahan kuantitas parsial dan full, top-up, multi-store create, add SKU/store, scoped holds, forward warehouse steps, physical reversals sebelum departure, separate correction tasks, linked returns, quarantine/quality release, short-pick findings, replacement, stale preview, offline request/ack, dan history.

Automated model tests memeriksa conservation/demand identity, floor, atomic failure, insufficient stock, mixed-carton holds, partial cleanup, settled demand, Return stock timing, new demand reservation, stale revision, pending offline state, dan completed request yang tetap selesai meski kemudian punya Return. Hasil browser QA serta batas verifikasi dicatat di `QA.md`.

Simplifikasi yang perlu diingat: simulasi bukan EPC/serial ledger produksi; representative carton ID per store; single document references untuk penjelasan; tidak ada authentication/RBAC enforcement; role Inventory/toko merupakan preview eksplisit; tidak ada printed label/SJ atau carrier accounting integration. Pengembalian in-transit pada demo langsung membuat linked Return; produksi harus memisahkan request, acknowledgement driver/store, actual arrival, dan receipt sebelum menyatakan proses recall sudah berjalan.
