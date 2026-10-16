# Riset allotment ops: maju, mundur, setengah, edit, cancel

Tanggal: 11 Oktober 2026. Prototype: `allotment-ops-prototype.html` (repo root, `http://localhost:5397/allotment-ops-prototype.html`). Bahan: peta kode hub + backend (board, picking, packing, despatch, MD allotments, `cloud/dc/*`, migrasi 0938–0941, 0964, 0965), dan riset 14 sistem lain (7 ERP, 5 WMS/fulfilment, 2 alat allocation).

## Kesimpulan

Model terbaik: **MD mengubah rencana, aplikasi menghitung selisih dengan posisi barang, dan selisih itu menjadi pekerjaan gudang.** Pekerjaan yang belum disentuh berubah sendiri. Hanya barang yang sudah disentuh yang perlu orang, lewat satu kata kerja: **Put back**. Setelah **Dispatched**, tidak ada lagi yang bisa diubah kecuali lewat Return to HO. Di riset ini disebut model C (live difference + put back) dengan hard stop model D. Model ini dipakai SAP EWM (order reduction), Anchanto, Starshipit, dan Oracle Retail (signed adjustment).

UI-nya cukup tiga lane, **Pick · Pack · Dispatch**, plus lipatan **Dispatched** sebagai history. Satu kartu = satu toko, dan tombolnya selalu langkah fisik berikutnya: Pick, Pack, Dispatch, Put back, atau OK. MD melihat allotment **per delivery** (yang dialokasikan sekali jalan, per supplier + PO) dan di dalamnya **per toko**, bukan per artikel.

## Kenapa ini alur paling sulit

Ada empat hal yang bergerak bersamaan:

1. **Rencana MD** (target per SKU × toko) bisa naik, turun, atau dibatalkan kapan saja sebelum Dispatched.
2. **Posisi fisik barang**: belum dipick, sudah dipick (area pick bersama), di karton, atau sudah Dispatched.
3. **Masalah lantai**: short pick, salah pack, atau koreksi sendiri oleh gudang.
4. **Waktu**: MD bisa mengubah saat picker sedang memegang picklist.

Setiap kombinasi (MD −50 saat setengah dipick, cancel saat 30 sudah Dispatched, +30 saat karton sudah disegel) harus jelas bagi dua pihak tanpa rapat.

## Kondisi kita sekarang (dari kode, 11 Okt)

- **Lane dan kata.**
  - Ada 5 lane: Pick List · Picked · Pack · Dispatch · Received. Label tidak sama dengan id-nya (`to-pack` berlabel "Picked", `in-transit` berlabel "Dispatch").
  - Ada 5 jenis kartu: picklist (allotment × toko), toko-picked, karton, shipment, dan received. Satu barang berganti wujud tiap lane.
  - Ada 7 kata untuk "barang sudah keluar": Dispatch, In transit, Departed, Dispatched, Shipment, On the road, Sent.
  - Ada 6 cara mundur: Move back, Put back, Take out, Unpack, Remove, Got it.
- **Tanda di kartu.** Ada 13 kemungkinan tanda:
  - strip Short pick, Edited −N, Cancelled −N;
  - stamp CANCELLED;
  - tag Added +N, 300 → 330, Cancelled;
  - tombol Move back, Got it, Remove;
  - tick box mati, pill Departed, flag Late.
- **Perubahan MD bisa mendarat di kartu yang salah.** Urutan cari tempatnya ada 5 (`owed.ts:287-329`): kartu Pick List-nya sendiri, lalu kartu Picked toko itu, lalu karton yang memegang barangnya, lalu karton mana saja milik toko itu, terakhir kartu sendiri.
- **Move back rumit.** Dialognya punya 3 rute, preset "MD's edit / All / None", dan teks "Move back X · Keep Y". Label "reprinted" disebut di dialog, tetapi tidak dicetak ulang.
- **MD buta posisi.** Sheet allotment hanya menampilkan matriks target, tanpa info berapa yang sudah dipick, dipack, atau Dispatched per toko. List-nya juga satu baris per artikel (ALT per artikel), padahal MD pengambil kebijakan dan tidak melihat artikel satu per satu.
- **Cancel setelah ada yang Dispatched** dimatikan ("Edit the rest down instead"), jadi MD harus membuka grid dan menurunkan tiap toko satu per satu.
- **Celah yang belum dibangun atau tidak cocok:**
  - Close remaining / Still needed sudah dibuat tetapi tidak dipasang di mana pun.
  - History MD tidak menerima `amendments`.
  - Move back tidak mengirim `allotment_id`.
  - `pick_owed_quantity` belum ada di tipe frontend.
  - Hard stop di board berbeda dengan server.
  - Composer Dispatch ikut mencentang karton yang tertahan.
  - Belum ada yang dikompilasi.
- **Edge DC server** (rig lokal) tidak punya move back, owed, changes, dan short picks. Board diam saja dan barang yang dicancel tetap jalan ke toko.

## Riset sistem lain

### Lima model

| Model | Dipakai oleh | Cara | Untuk DC fashion kecil |
|---|---|---|---|
| A · Minta gudang | Shopify fulfillment orders, Amazon seller, ShipBob | Setelah pick mulai, MD hanya bisa *request*; gudang terima atau tolak | Pemilik jelas, tetapi lead jadi bottleneck dan MD tidak tahu hasilnya |
| B · Reset lalu rilis ulang | Starshipit, Logiwa, NetSuite reversal, Cin7 Undo | Setiap perubahan mengembalikan order ke sebelum rilis | Satu aturan, tetapi perubahan 1 pcs mengulang semua |
| **C · Selisih langsung + put back ★** | SAP EWM order reduction, Anchanto, Starshipit, Oracle Retail | Rencana langsung berubah; yang belum disentuh menyusut atau bertambah sendiri; kelebihan yang sudah disentuh jadi tugas put back di tempatnya | Tanpa approval, paling cepat untuk MD, lantai hanya melihat langkah berikutnya |
| D · Beku, run berikutnya menyerap | Zara/Inditex, Nextail | Allotment yang sudah rilis tidak berubah; koreksi di allotment berikut atau retur | Lantai tenang, tetapi MD tidak bisa menghentikan kiriman salah |
| E · Hold, mundur per tahap | Shopify hold, ShipHero, Cin7, Extensiv, D365 | MD menahan, lead membalik tiap tahap manual | Familiar, tetapi banyak langkah manual dan rawan salah |

### Per sistem (singkat)

- **Odoo 17/18**
  - Edit mengecilkan move yang masih terbuka dan menaruh activity "Manual actions may be needed" yang tidak wajib diselesaikan.
  - Move yang sudah done harus di-Return. Barang hasil pick tertinggal di Output sampai dikembalikan manual.
  - Backorder dibuat sebagai dokumen baru.
- **ERPNext v15**
  - Edit dokumen = Cancel lalu Amend, dan dokumen tertaut harus dicancel dulu. Gudang tidak diberi tahu apa pun.
  - Kalau picked qty kosong di luar mode scan, ERPNext mengisinya penuh, seolah semua sudah dipick.
- **SAP EWM**
  - Order reduction: task yang belum disentuh dibatalkan sistem.
  - Barang yang sudah dipick atau dipack: picker mendapat alert, pack station menandai, scan menyuruh mengeluarkan barang, lalu put away.
  - Fitur ini perlu konfigurasi; tanpa itu perubahan ditolak.
- **Dynamics 365**
  - Urutan back-office: Cancel work, lalu delete load, lalu reduce picked qty. Reverse work membuat movement work.
  - Short Pick di handheld meminta alasan dan masuk ke tile "open work exceptions".
- **NetSuite WMS**
  - Pick Task Reversal mengembalikan barang ke bin asal serta menghapus karton dan label. Tidak bisa setelah Shipped.
  - Close line tetap menyimpan rencana awal.
- **Oracle WMS / Retail**
  - Perubahan dikirim sebagai signed adjustment (−3, +2).
  - Lock order ditolak kalau sudah dipick atau dipack. Ada flag "Deallocate on short".
- **Business Central / LS**: dokumentasinya sendiri bilang "you must notify the warehouse" secara manual. Undo Transfer Shipment bisa dipakai selama barang belum diterima.
- **Shopify**
  - Memakai cancellation request (accept/reject).
  - Server mengirim daftar aksi yang sah per order (`supportedActions`). Sisa ada di `remainingQuantity` pada baris yang sama.
- **ShipHero**
  - Order terkunci setelah pick.
  - Mereka sendiri memperingatkan agar tidak memakai "Clear tote": stok kembali di sistem tanpa ada orang yang memindahkannya.
- **Starshipit**: barang yang sudah dipindah menjadi putaway work, dan stok baru tersedia setelah putaway selesai.
- **Anchanto**: alert dibatalkan muncul **setelah kartu produk yang sedang dikerjakan selesai**, bukan di tengah. Baris yang belum dipick hilang sendiri; yang sudah dipick menjadi tugas put away.
- **Zara / Nextail**: allotment yang sudah rilis dibekukan, dan perubahan masuk ke kiriman berikutnya.

### Pola yang ditiru

1. Pekerjaan yang belum disentuh berubah sendiri (SAP, Oracle WMS, Odoo).
2. Undo menjadi tugas di tempat barang berada (SAP put-back, D365, NetSuite, Starshipit).
3. Perubahan ditampilkan di tempat tangan bekerja (pack station SAP, Anchanto).
4. Stok dihitung lagi hanya setelah put back selesai (Starshipit; ShipHero "Transfer, bukan Clear").
5. Short pick cukup satu tap + alasan, dan sisanya tetap di baris yang sama (D365, Oracle, Logiwa).
6. Hanya aksi yang sah yang ditampilkan (Shopify `supportedActions`).
7. Kerjakan yang bisa, daftar sisanya (Logiwa "Cancel eligible only").
8. Hard stop di Dispatched; setelah itu dokumen baru (Infor, NetSuite, BC).
9. Ada jeda sebelum perubahan sampai ke lantai (Gmail Undo Send, Shopify fulfillment delay).
10. Exception ditampilkan sebagai satu hitungan, bukan status di semua kartu (D365, ShipBob).

### Pola yang dihindari

- Rantai cancel-amend (ERPNext, D365).
- "Beri tahu gudang" secara manual (BC, Odoo).
- Clear virtual tanpa perpindahan fisik.
- Force-cancel yang tidak sampai ke lantai.
- Undo yang mengembalikan seluruh dokumen ke draft (Cin7).
- Backorder baru untuk setiap partial (Odoo, Oracle).

### Sumber utama

- Odoo: https://github.com/odoo/odoo/blob/17.0/addons/sale_stock/models/sale_order.py
- ERPNext: https://docs.frappe.io/erpnext/user/manual/en/edit-submitted-document
- SAP EWM order reduction: https://eursap.eu/blog/configuration-of-order-reduction-in-sap-ewm
- D365: https://learn.microsoft.com/en-us/dynamics365/supply-chain/troubleshooting/sales/quantity-cannot-be-reduced
- D365 work exceptions: https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/work-exceptions-log
- NetSuite pick reversal: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1541443266.html
- Oracle WMS 25A lock: https://docs.oracle.com/en/cloud/saas/readiness/logistics/25a/wms25a/25A-wms-wn-f36631.htm
- Oracle Retail signed adjustments: https://docs.oracle.com/en/industries/retail/retail-merchandising-foundation-cloud/latest/rmsob/rib-subscription-designs.htm
- Business Central: https://learn.microsoft.com/en-us/dynamics365/business-central/ui-document-status
- Shopify fulfillment service: https://shopify.dev/docs/apps/build/orders-fulfillment/fulfillment-service-apps/build-for-fulfillment-services
- Shopify supportedActions: https://shopify.dev/docs/api/admin-graphql/latest/enums/FulfillmentOrderAction
- ShipHero tote: https://software-help.shiphero.com/hc/en-us/articles/12390442669709-How-to-Remove-Inventory-from-a-Tote
- Starshipit: https://support.starshipit.com/articles/14700000000060-manage-order-cancellations-refunds-and-returns-in-wms
- Logiwa: https://intercom.help/mylogiwa/en/articles/14048672-picking-job-cancellation-warnings-based-on-shipment-order-status
- Infor: https://docs.infor.com/wms/2026.x/en-us/wmsolh/asn1612893654399.html
- Zara: https://pubsonline.informs.org/doi/10.1287/inte.1090.0472

Catatan: dokumen Manhattan, Blue Yonder, Toolio, dan o9 ada di balik login dan tidak dipakai. Halaman Anchanto hanya terbaca lewat ringkasan pencarian (403).

## Desain usulan

### Enam aturan

1. **MD mengubah rencana; gudang tidak menerima "request".** Aplikasi membandingkan target dengan posisi barang, lalu selisihnya menjadi pekerjaan.
2. **Pekerjaan yang belum disentuh berubah sendiri.** Angka To pick langsung turun atau naik. Hanya barang yang sudah disentuh yang perlu orang.
3. **Satu kartu = satu toko, dengan satu tombol: langkah fisik berikutnya.** Pilihannya Pick · Pack · Dispatch · Put back · OK.
4. **Put back dikerjakan di tempat tangan sudah berada.**
   - Kelebihan yang sudah dipick: kolom Put back di sheet Pack, sudah terisi otomatis, dan satu Submit mengerjakan Put back dan Pack sekaligus.
   - Kelebihan yang sudah di karton: tombol kartu Dispatch berubah menjadi "Put back 50". Sheet-nya menunjukkan karton mana dan berapa yang dikeluarkan, lalu label dicetak ulang.
   - Stok baru kembali setelah put back selesai.
5. **Dispatched adalah batas mati.**
   - Di bawah angka Dispatched ditolak.
   - Kalau sebagian sudah Dispatched, MD memakai **Cancel the rest**. Di dialog yang sama MD bisa mencentang "Ask C004 to return the 30" untuk langsung membuat Return to HO.
6. **Salah? Undo 10 detik, setelah itu Unpack atau Put back.**
   - Setiap langkah gudang diakhiri toast dengan Undo, seperti Undo Send di Mail.
   - Save dan Cancel MD juga punya Undo 10 detik, supaya salah klik MD tidak sampai ke lantai.

### Board (Ops)

- **Lane**: Pick · Pack · Dispatch, ditambah lipatan **Dispatched** di ujung = history semua trip (bukan cuma hari ini), terbaru di atas, dikelompokkan per hari (Today, 10 Oct 2026, …). Tiap trip: jam, toko, trip data, pcs, dan "Received" / "Received 1 of 2" / "Not received yet". Klik trip → sheet read-only: toko, karton, pcs, tanggal diterima, Print delivery notes. Lane Received hilang.
- **Kartu Pick** (allotment × toko):
  - Isi: nama toko, artikel, jumlah, dan "N SKUs".
  - Kalau MD menurunkan, angka tampil `~~120~~ 100` dengan titik biru sampai kartu dibuka. Kalau MD menambah, ada tanda "Added".
  - Kalau menjadi 0 karena edit, tampil `~~30~~ 0` dengan tombol OK.
  - Kalau short pick, ada strip amber "Short pick" yang hilang sendiri saat Inventory menandai Found atau sisanya terpick.
- **Satu cancel = satu kartu CANCELLED per allotment** ("Gamis · 4 stores · OK"), bukan satu kartu per toko.
- **Kartu Pack** (toko): jumlah yang sudah dipick. Tombolnya "Pack", atau "Put back 10 · Pack 20" berlatar merah muda kalau ada kelebihan.
- **Kartu Dispatch** (toko): N karton. Tombolnya "Dispatch", atau "Put back 50" (merah). Kartu ini tidak bisa ikut trip sebelum put back.
- **Urutan kartu**: yang perlu perhatian (OK, Put back, titik biru, short) naik ke atas.
- **Drag & drop** (desk dan tablet): mouse = geser 6 px; tablet = tahan 0,35 detik lalu geser (swipe cepat tetap scroll lane). Saat menyeret, kartu ikut jari dan lane yang bisa menerima menampilkan apa yang akan terjadi (Pick, Pack, Put back, Unpack, Dispatch); lane lain meredup. Drop tidak pernah menulis data, hanya membuka sheet langkah itu. Lepas di luar lane → kartu kembali; Esc membatalkan. Phone tidak pakai DnD karena hanya satu lane terlihat; tombol kartu selalu bisa.
- **Phone**: segmented "Pick 7 · Pack 4 · Dispatch 2 · Dispatched 3" (muat di 414), kartu penuh, sheet full screen, tombol di bawah 44 px, toast dari atas.

**Total tanda di kartu tinggal 4**: strip Short pick, tombol merah Put back, stamp CANCELLED, dan angka was → now (plus titik biru).

### Sheet

- **Pick**:
  - Baris diurutkan artikel → warna → ukuran.
  - Kalau MD mengubah saat sheet terbuka, banner muncul dan kolom To pick per ukuran menjadi `~~10~~ 6`.
  - Kalau kurang, muncul pertanyaan "Why N fewer?" dengan 5 chip: Not found · Stock unconfirmed · Damaged · Label / equipment · Other. Tidak ada kata rak.
- **Pack**: kolom Picked · Put back (minimal = kelebihan) · Pack. Ada stepper jumlah karton. Tombolnya "Put back 30 · Pack 30".
- **Put back dari karton**: dikelompokkan per karton ("CTN-0001 · take out 26 of 30"), dengan catatan "2 labels reprinted".
- **Toko di lane Dispatch**: daftar karton dengan centang untuk Unpack (karton kembali ke Pack).
- **Dispatch**: daftar toko siap. Toko yang masih harus put back dimatikan, dengan tombol Put back di barisnya. Satu field teks **Trip data** (wajib) untuk apa saja: truk sendiri, kurir, kargo, nomor resi. Satu delivery note per toko.

### Sisi MD

- **List Allotments = satu baris per delivery** (yang MD alokasikan sekali jalan: supplier + PO), bukan per artikel. Kolom: Stores · Allotted · To pick · In the warehouse · Dispatched · Received · Status. Status menampilkan "Put back N · warehouse" atau "Short N" kalau ada.
- **Tab**: In progress · **Completed** (semua sudah Dispatched dan Received) · Cancelled. KPI: In progress · To pick · In the warehouse · Dispatched, not received.
- **New allotment**: tombol biru di kanan atas list (seperti sekarang). Membuka layar New allotment yang sudah ada (per supplier, dengan sales). Setelah Save, delivery baru muncul **paling atas** In progress dengan titik biru, dan gudang langsung melihat kartu Pick baru bertitik biru. Di prototype, layar ini diganti versi singkat supaya alurnya bisa diikuti.
- **Sheet delivery**:
  - Angka atas: Allotted · To pick · In the warehouse · Dispatched · Received.
  - Tabel **per toko**. Artikel hanya muncul kalau toko dibuka (chevron). Ukuran tidak pernah ditampilkan.
  - **Edit** = ubah total toko atau total artikel; aplikasi membagi ke ukuran sesuai proporsi, tidak pernah di bawah Dispatched (toast mengarahkan ke retur). Kolom Change: "−48 · put back 42". Footer: "84 fewer · 50 put back by the warehouse".
  - **Cancel**: tanpa centang = seluruh delivery ("Cancel allotment" / "Cancel the rest"); centang toko = hanya toko itu ("Cancel 2 stores"). Dialog berisi baris per tahap dan centang Return to HO kalau ada yang Dispatched.
  - Activity: siapa mengubah, siapa melihat, siapa put back, siapa OK.
- Di bawahnya tetap satu ALT per artikel (keputusan 29 Sep); list hanya mengelompokkannya per delivery.

### Satu kosakata

| Pakai | Jangan |
|---|---|
| Store | Shop |
| Pick · Pack · Dispatch (kata kerja, lane & tombol) | Pick List, Picklist, Send |
| Picked · Packed · Dispatched · Received (keadaan, angka & histori) | Sent, In transit, Departed, Shipment, On the road |
| Trip data (satu field teks) | Vehicle, Driver, plat |
| Put back · Unpack (dua cara mundur) | Move back, Take out, Remove, Got it, Keep |
| Carton | koli (di UI), Sealed |
| Cancelled · Completed ("Rest cancelled" kalau sebagian sudah Dispatched) | Closed short, Cancelled −N |

## Perubahan terhadap keputusan sebelumnya (perlu OK Hari)

1. **Got it pada kartu To pick yang diturunkan dihapus.** Membuka kartu dihitung sebagai "seen" dan tercatat di Activity MD. Cancel tetap perlu OK, tetapi cukup sekali per allotment. (Sebelumnya, 10 Okt: gudang meng-acknowledge setiap perubahan.)
2. **Strip merah "Edited −50" diganti tombol merah "Put back 50"**: yang disebut adalah pekerjaannya, bukan kejadiannya. (Sebelumnya, 9 Okt: strip.)
3. **Cancel juga bisa setelah ada yang Dispatched, sebagai "Cancel the rest"**, untuk seluruh delivery atau toko yang dicentang; sama dengan Edit ke angka Dispatched tetapi satu tap. (Sebelumnya, 10 Okt: Cancel hanya kalau belum ada yang dikirim.)
4. **Alasan dan catatan Cancel tidak diminta.**
5. **Lane Picked dan Pack digabung menjadi Pack.** Kartu per karton diganti satu kartu toko dengan N karton. Lane Dispatch (barang yang sudah pergi) dan Received diganti lipatan "Dispatched" = history.
6. **Dialog Move back (rute + preset) diganti** kolom Put back di Pack, Unpack di sheet toko, dan Undo 10 detik.
7. **Save dan Cancel MD mendapat Undo 10 detik.**
8. **List MD satu baris per delivery, sheet per toko** (artikel hanya saat toko dibuka, ukuran tidak pernah). (Sebelumnya: satu baris per artikel/ALT, sheet grid SKU × toko.)
9. **Kata Dispatch / Dispatched** dipakai di semua tempat; Send/Sent tidak dipakai. **Trip data** satu field teks menggantikan field plat/driver. (Keputusan Hari, 11 Okt.)

Yang tetap: edit di tempat dan tidak di bawah Dispatched; short pick tetap di kartu yang sama; hard stop (karton yang harus put back tidak bisa dikirim); stok kembali hanya saat gudang put back; drop membuka sheet; banner picker live; stamp CANCELLED; tanpa rak.

## Dampak ke kode kalau dipilih

- **Backend (cloud)**
  - Sebagian besar sudah ada: `pick_owed_quantity`, `takeout_pending_quantity`, `allotment_amendment`, hard stop di dispatch.
  - Perlu ditambah:
    - (a) Cancel the rest = amend semua baris (seluruh delivery atau toko terpilih) ke angka Dispatched.
    - (b) Opsi membuat Return to HO dari cancel.
    - (c) Ack sekali per amendment CANCEL, bukan per toko.
    - (d) "Seen" dicatat saat kartu dibuka.
    - (e) Label benar-benar dicetak ulang saat put back dari karton.
    - (f) Detail allotment mengirim `amendments` dan posisi per toko.
    - (g) Undo 10 detik di sisi MD (ditahan di klien, dikirim setelah 10 detik atau saat halaman disembunyikan).
- **Hub board**
  - Lane menjadi 3, dan `owed.ts` disederhanakan: perubahan hanya tampil di kartu yang memegang barangnya, tanpa 5 tingkat fallback.
  - Kartu karton dan kartu shipment diganti kartu toko.
  - Kolom Put back masuk ke Pack sheet; dialog Move back dihapus.
  - Kata-kata disamakan.
  - Composer Dispatch mengecualikan toko yang masih harus put back; field Trip data satu teks.
  - DnD pakai pointer events (dnd-kit atau sendiri) supaya tablet bisa: tahan 350 ms lalu geser.
- **Hub MD**: baris posisi di sheet, preview Change, Cancel the rest + Return to HO, Activity yang lengkap.
- **Edge DC server**: tetap tertinggal. Perlu keputusan apakah rig edge ikut atau cloud-only.

## Yang belum dimodelkan

- Kirim sebagian karton milik satu toko (truk penuh). Saat ini Dispatch memakai satuan toko.
- Pick satu artikel sekaligus untuk semua toko (wave) lalu disortir per toko.
- Undo setelah sisi lain sudah bertindak dalam 10 detik itu. Di prototype, Undo cukup memulihkan snapshot.

## Pembaruan 11 Okt (lanjutan): Received, 5 versi visual In progress, Completed

- **Board Ops punya lipatan Received.** Lipatan *Dispatched* sekarang hanya berisi trip yang masih di jalan (ada toko yang belum menerima). Lipatan *Received* berisi yang sudah diterima per toko, dikelompokkan per hari, dengan hasil blind count: "24 pcs · Completed" atau "22 of 24 pcs · Completed · issue" (selisihnya urusan Inventory). Hanya satu lipatan terbuka pada satu waktu. Di phone: Pick · Pack · Dispatch · Dispatched · Received (label di atas angka).
- **Allotment punya nomor sendiri per kelompok** (ALT-00000041 = Garmen Nusantara · PO-041026-011). Artikel di dalamnya memakai kode artikel, bukan nomor ALT.
- **MD › In progress: satu kartu per allotment, dengan 5 versi visual** (pilih di bar prototype):
  - **A · Truck**: jalan dari gudang ke toko; truk bergerak ke posisi rata-rata barang (To pick → In the warehouse → Dispatched → Received), angka di tiap titik.
  - **B · Bar**: satu bar bertumpuk (Received hijau, Dispatched biru, In the warehouse amber, To pick abu-abu) + "% dispatched · % received".
  - **C · Stores**: satu cincin per toko, dibagi warna sesuai posisi barang toko itu; centang hijau kalau toko sudah menerima semua; lingkar merah kalau ada Put back/Short.
  - **D · Rings**: tiga cincin ala Apple Activity (Picked, Dispatched, Received), menutup di 100%.
  - **E · Steps**: seperti pelacak pesanan Apple Store: Pick · Pack · Dispatch · Received, tiap langkah "N of M stores", judul langkah yang sedang berjalan ("Picking · 152 to pick").
  - Semua versi bergerak (transisi 0,8–1 detik, berhenti kalau *reduce motion*). Tombol **Play warehouse** menjalankan gudang selangkah demi selangkah supaya MD bisa melihat kartunya bergerak. Allotment yang selesai saat dilihat tetap tampil (truk hijau, "Completed") sampai MD pindah tab.
- **Completed dan Cancelled** cukup tabel dua kolom: nomor allotment dan supplier.
- **Phone MD**: KPI 2×2, New allotment jadi tombol bulat di kanan bawah (bukan di toolbar atas).

### Revisi: dua progress per allotment (feedback Hari)

Versi A–E yang lama hanya menunjukkan satu progress. Sekarang setiap kartu allotment punya **dua baris**:
- **Warehouse**: seberapa jauh gudang (Pick → Pack → Dispatch), dengan ringkasan "9% dispatched" di kanan.
- **Stores**: satu cincin per toko (dari versi C), dibagi warna To pick · Picked · Packed · Dispatched · Received. Centang hijau kalau toko sudah menerima semua, lingkar merah kalau ada Put back/Short. Ringkasan "0 of 6 received" di kanan.

Baris Stores sama untuk semua versi. Lima versi hanya berbeda di baris Warehouse: **A · Steps** (tiga cincin langkah Pick/Pack/Dispatch + "166 of 318"), **B · Bar** (satu bar bertumpuk), **C · Truck** (truk berjalan Pick → Pack → Dispatch, biru saat semua sudah dispatch), **D · Ring** (satu cincin terbagi + persen di tengah), **E · Numbers** (To pick / To pack / To dispatch / Dispatched dengan garis tipis di bawah tiap angka). Legenda warna satu kali di atas daftar.

### Revisi: Pack banyak karton, Put back terpisah (feedback Hari)

- **Pack = satu karton per langkah**, sama seperti gerakan fisik di meja packing. Polanya mengikuti "Put in Pack" di Odoo dan pack station SAP EWM yang menutup handling unit.
  1. Sheet Pack membuka **Carton 1** yang sudah terisi semua sisa barang. Kalau muat satu karton, cukup satu tap.
  2. Kalau karton penuh, kurangi angkanya (atau tekan **Empty**, lalu isi apa yang masuk karton ini). Tekan **Pack carton 1**: label tercetak, toast Undo muncul.
  3. **Carton 2** terbuka berisi sisanya. Baris yang sudah habis tidak tampil lagi. Ada tombol **Fill with the rest** untuk mengisi semua sisa.
  4. Karton yang sudah di-pack tampil di atas sebagai daftar **Packed**: nomor karton, total pcs, dan isinya per artikel/ukuran ("Navy · M 5 · Navy · L 5"). Masing-masing punya **Reprint label** dan **Unpack**.
  5. Kalau sisanya habis: "Done". Kartu toko pindah ke lane Dispatch dengan N karton.
- **Put back tidak lagi digabung dengan Pack.**
  - Di kartu Pack yang ada kelebihannya ada dua tombol: **Put back 30** (merah) dan **Pack**.
  - Di sheet Pack juga ada tombol **Put back** sendiri (merah kalau ada kelebihan dari MD, abu-abu untuk put back sukarela).
  - Sheet Put back memuat semua yang perlu dikembalikan: dari *Picked* (stepper, sudah terisi sesuai kelebihan) dan dari *In cartons* (karton mana, berapa yang dikeluarkan, label dicetak ulang). Setelah Put back, aplikasi kembali ke sheet Pack kalau masih ada yang bisa di-pack.
- Sheet tidak lagi beranimasi ulang setiap stepper ditekan, dan posisi scroll dipertahankan.

### Revisi: karton yang sudah di-pack terlihat di board (feedback Hari)

Bandingan dengan board sekarang (`board.tsx`, lane "Pack"):

| | Board sekarang | Usulan sebelumnya | Usulan sekarang |
|---|---|---|---|
| Karton yang sudah di-pack | Satu kartu per karton (toko, nomor koli, pcs, centang) | Kartu toko hanya bilang "2 cartons" | Kartu toko di lane Dispatch menampilkan **setiap karton**: "Carton 1 · CTN-0010 · 30 pcs", merah "take out 24" kalau MD mengubah |
| Toko dengan 3 karton | 3 kartu terpisah | 1 kartu | 1 kartu, 3 baris karton |
| Sisa yang belum di-pack | Kartu terpisah di lane Picked, tanpa kaitan ke kartonnya | Kartu Pack | Kartu Pack + "1 carton packed" |
| Isi tiap karton | Buka sheet karton (packing list) | Buka sheet toko | Buka kartu: tiap karton dengan isi per ukuran, Reprint label, Unpack |
| Kirim sebagian karton | Centang karton di board, "Dispatch (n)" | Tidak bisa (satu toko = semua karton) | Sheet Dispatch: tiap toko menampilkan kartonnya dengan centang; karton yang tidak dicentang tetap menunggu trip berikutnya |
| Nomor karton | Nomor koli (A00001) | — | "Carton N" per toko + CTN-nomor; tidak berubah walau karton lain sudah berangkat (mulai dari 1 lagi setelah semua karton toko itu berangkat) |

### Revisi: Received keluar dari board

Board Ops = kerja gudang (Pick · Pack · Dispatch) + satu lipatan **Dispatched**: semua trip, terbaru di atas, per hari. Tiap trip menampilkan status terima toko: "Not received yet", "Received 1 of 2", "Completed", atau "Completed · 1 issue". Trip yang sudah selesai tampil redup, dan badge lipatan menghitung trip yang masih di jalan. Lane Received dihapus karena itu langkah toko: MD melihatnya di cincin toko, dan selisih hitung ditangani Inventory. Di phone: Pick · Pack · Dispatch · Dispatched.

### Revisi: sederhana dan lengkap (11 Okt)

- Tanpa RFID: semua jumlah diketik atau sudah terisi otomatis (stepper, Empty, Fill with the rest). Tidak ada scan.
- Tanpa kata terlambat, menunggu, atau warna overdue di kartu maupun trip.
- **Dispatch membuka dengan semua toko yang siap sudah dicentang**, karena satu truk biasanya membawa semua yang sudah dipack. Lead tinggal menghapus centang yang tidak ikut, mengisi Trip data, lalu Dispatch. Ini menggantikan "Select All" di board sekarang.

### Skenario uji dengan lead gudang (± 15 menit, tablet)

1. Pick C001 Kemeja Oxford penuh → muncul di Pack.
2. Pick C002 Kaos Oblong kurang 3 → pilih alasan → sisa 3 tetap di Pick dengan strip "Short pick".
3. Pack satu toko menjadi 2 karton → isi tiap karton terlihat → Unpack karton 1 → pack ulang.
4. MD −30 pada toko yang sudah dipick → kartu Pack punya tombol Put back 30 → put back → pack sisanya.
5. MD −50 pada toko yang sudah dipack → kartu Dispatch "take out" merah → Put back dari karton.
6. MD cancel Gamis → satu kartu CANCELLED → OK; toko yang sudah pick/pack mendapat Put back.
7. "Change while picking" → sheet Pick berubah langsung (10 → 6).
8. Dispatch 2 toko, satu karton tidak dicentang → karton itu tetap menunggu; trip muncul di lipatan Dispatched.
9. Salah tekan → Undo dalam 10 detik.

Yang dicatat: di langkah mana lead ragu atau bertanya, dan berapa tap per skenario.

### Revisi: Pick per artikel untuk semua toko (Hari: "ya coba")

- Lane Pick sekarang **satu kartu per artikel** ("Kemeja Oxford · 4 stores · 270 pcs"), bukan satu kartu per toko × artikel. Di contoh prototype, 10 kartu menjadi 4.
- Sheet Pick menampilkan total per ukuran, dengan pembagian per toko di bawahnya ("C001 20 · C002 10 · C003 10"). Picker cukup mengambil totalnya sekali.
- Kalau jumlah yang diambil kurang, aplikasi membagi rata sesuai kebutuhan tiap toko. Contoh: 26 dari 4 × 8 menjadi 7/7/6/6. Sisanya tetap di kartu artikel dengan strip "Short pick", dan alasannya ditanya sekali.
- Pack dan Dispatch tetap per toko: packer membagi tumpukan yang sudah diambil ke karton tiap toko.
- Perubahan MD tampil di kartu artikel (~~120~~ 100) dan di sheet per toko (banner + 15 → 12 per ukuran). Cancel tetap satu kartu CANCELLED per cancel.

## Audit sinkronisasi MD ↔ Ops (12 Okt)

Dijalankan sebagai skrip di dalam prototype: 18 langkah (MD ubah sebelum/saat/sesudah pick, short pick, put back, pack 2 karton, MD −50 pada barang yang sudah dipack, dispatch sebagian, cancel, cancel per toko lalu dinaikkan lagi, toko menerima, lalu gudang dijalankan sampai habis). Setelah tiap langkah dicek: jumlah lane Pick/Pack/Dispatch = angka MD (To pick / Picked / Packed); "Put back N" di kartu = kelebihan di sheet MD per toko; tidak ada baris negatif atau target di bawah Dispatched; nomor karton unik per toko; setiap perubahan MD yang belum dilihat punya titik biru di suatu kartu; di akhir semua allotment Completed tanpa sisa.

Empat celah ditemukan dan diperbaiki:
1. **Perubahan MD yang sudah dikerjakan tetap "belum dilihat".** Hanya membuka sheet yang menandai lihat. Sekarang pick/pack/put back/dispatch pada toko itu juga menyelesaikan tandanya (kerja selesai = sudah tahu).
2. **Perubahan lama menggantung** kalau MD mengubah toko yang sama dua kali sebelum gudang melihat. Sekarang perubahan baru menggantikan yang lama; titik biru tetap satu.
3. **Allotment "rest cancelled" tidak bisa hidup lagi.** Kalau MD menaikkan kembali toko yang sudah dicancel, statusnya tetap tertulis cancelled di board. Sekarang status mengikuti barisnya.
4. **Hard stop terlalu lebar.** Satu toko dengan 3 karton, MD mengurangi barang yang hanya ada di karton 3: tadinya seluruh toko tidak bisa dispatch. Sekarang hanya karton yang menyimpan barang yang harus dikeluarkan yang tertahan ("Take out 20 first"); karton lain tetap bisa ikut trip. Kartu Dispatch menampilkan dua tombol: Put back N | Dispatch.
Ditambah: angka short pick tidak pernah melebihi sisa To pick setelah MD menurunkan, dan "N of M received" tidak menghitung toko yang dicancel.

Yang MD lihat dari kerja gudang: kolom To pick / In the warehouse / Dispatched / Received per toko, catatan "Put back N · warehouse" sampai selesai, "Short N", dan Activity ("Agus saw the change on C002", "put back C002", "packed C002 · carton 1", "dispatched C002", "received C002").


## Revisi 12 Okt: picklist per toko, koli ditambah manual

Hari: "harusnya picklist udah terpisah per toko", "add cartonnya manual karna cartonnya bisa beda beda", "dia ga harus pack semua carton sekaligus", "carton ganti koli".

**Pick kembali per toko.** Pick per artikel (revisi sebelumnya) dibatalkan. Lane Pick = satu picklist per allotment × toko ("C001 · Cikupa · Kemeja Oxford · ALT-00000041 · 120 pcs"). Hasil pick langsung menjadi tumpukan toko itu, jadi Pack tidak perlu membagi apa pun dan tidak ada pembagian short pick antar toko. Sheet Pick per toko: To pick per ukuran dengan was → now, banner perubahan MD, lalu kalau kurang: "Continue later" (sisa tetap di kartu, bukan short) atau "Cannot pick the rest" (alasan wajib, strip Short pick). Perubahan MD selesai saat toko itu dipick atau di-OK.

**Pack dengan koli manual.** Koli beda ukuran, jadi aplikasi tidak pernah menebak isi koli.
1. Sheet dibuka: **Koli 1** berisi semua yang sudah dipick (kasus paling umum: muat satu koli). Langsung **Pack koli 1**.
2. Tidak muat: **Add koli** → Koli 2 kosong, jadi koli yang sedang diisi (lingkaran biru).
3. Baris di koli lain punya tombol **→ Koli 2** (pindah satu baris utuh). Di koli yang sedang diisi, stepper mengatur berapa yang tinggal; sisanya turun ke **Not in a koli**, dengan tombol "All to koli N".
4. Ketuk judul koli lain untuk mengisinya. Koli kosong bisa di-Remove.
5. **Pack koli N** hanya menutup koli itu (label tercetak). Koli lain tetap terbuka, juga setelah sheet ditutup, seperti kardus yang masih terbuka di meja. Tidak ada tombol "pack semua".
6. Koli yang sudah dipack turun ke daftar **Packed** dengan isi per ukuran, Reprint label, Unpack. Isi yang di-unpack kembali ke Not in a koli.
7. MD mengurangi saat koli masih terbuka: isi koli terbaru dikurangi dulu, kelebihannya jadi Put back (tombol terpisah, tetap seperti sebelumnya).

**Kata "Koli" di semua layar** (Koli 1, Add koli, Pack koli 2, "2 koli packed", "Take out 4 first" per koli, Count koli di toko). ID contoh mengikuti format server: KOLI-0012. Kosakata di halaman Today vs proposed diganti: "Koli, never carton or box".

**Perbaikan sinkronisasi 12 Okt dipasang ulang** (sempat hilang karena build v3 menimpa file): kerja selesai menandai perubahan MD sudah dilihat, perubahan baru menggantikan yang belum dilihat, status allotment hidup lagi kalau MD menaikkan toko yang dicancel, hard stop per koli (koli yang tidak berutang tetap bisa dispatch; kartu Dispatch "Put back N | Dispatch"), short tidak melebihi sisa To pick, "N of M received" tanpa toko yang dicancel. Dispatch kembali dibuka dengan semua toko yang siap tercentang.

Uji skrip ulang (picklist per toko, short pick satu toko, continue later, put back, Koli 2 dipack sendiri lalu Koli 1 setelah sheet ditutup-buka, MD −50 pada koli, dispatch, cancel, cancel per toko lalu dinaikkan, gudang dijalankan sampai habis): 0 kegagalan. Sisa 6 pcs yang menunggu Inventory adalah short pick contoh berstatus "Not found".

Catatan file: `allotment-ops-prototype.html` di root sekarang induknya. `outputs/allotment-ops-review-20261012/build.py` (v3) sudah usang karena patch-nya mengandalkan pick per artikel; menjalankannya lagi akan menimpa revisi ini.

### Detail picklist: foto dan nama produk (12 Okt)

Hari: "detail picklistnya kurang, harusnya ada foto product nama product etc saat klik pick". Sheet Picklist di hub sekarang (`frontend-hub/src/screens/operations/picking/picking.tsx`) hanya menampilkan nama artikel, warna · ukuran, kode SKU, Request Quantity, dan stepper, tanpa foto, padahal katalog hub sudah membawa `image_url`, kode artikel, divisi, warna, dan ukuran.

Sheet Pick di prototype sekarang:
- Di atas: nama artikel, kode artikel · divisi, supplier · PO; lalu To pick dan tanggal allotted.
- Satu blok per warna: foto colourway (di prototype memakai siluet placeholder hub yang dicat warna dari colour master), nama warna, jumlah ukuran dan pcs. Di bawahnya baris per ukuran: ukuran, kode SKU, To pick, Picked.
- Picker mencari barang dari tampilannya dulu (warna), baru ukurannya, jadi foto ada di tiap warna, bukan satu foto untuk seluruh artikel.
- To pick pindah ke kotak di header sheet supaya tetap terlihat saat menggulir dan mengubah angka. Tanggal allotted dihapus.
- **Print** di sebelah Save pick membuka picklist kertas A5 berbahasa Indonesia, mengikuti pola packing list di hub: judul PICKLIST dan nomor allotment, Toko, Artikel, Supplier · PO, Dicetak (tanggal, jam, nama). Tabel per warna: No, Ukuran, SKU, Diminta, dan kotak Diambil yang kosong untuk ditulis tangan. Lalu Total, kotak Catatan, dan dua tanda tangan (Diambil oleh · jam, Diterima packer · jam). Tidak ada gambar di kertas.
