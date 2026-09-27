# Inventory — siapa pemilik stok tiap site

**Status:** model target, dengan implementasi sekarang dicatat di sampingnya.
Rujukan kode dibaca dari `feat/handheld-rfid` di `eabc58c`.

> **Arti bisnis, boundary dan invariant dimiliki
> [INVENTORY-V1.md](../INVENTORY-V1.md).** Dokumen ini memiliki
> authority Edge/Cloud, offline, sync, dan rekonsiliasi — dan tidak
> mengulang arti yang sudah dibekukan di sana.

Kosakata: [`../CONTEXT.md`](../CONTEXT.md). Sebelum ini:
[buku besar stok](./inventory-ledger.md) · [stock opname](./inventory-count.md).

Dokumen ini memiliki: **mengapa satu potong baju bisa punya dua catatan yang
sah, siapa yang berhak menjawab "berapa stok di sana", dan apa yang terjadi pada
angka fleet ketika node tidak bicara.**

Ini bagian yang paling sering menghasilkan angka salah di layar, dan hampir
selalu dengan cara yang sama: satu barang dihitung dua kali, atau satu gudang
melaporkan nol padahal isinya enam ratus potong.

---

## 1. Satu warehouse, dua database

Gudang tidak boleh berhenti bekerja karena internet mati. Konsekuensinya
langsung dan tidak bisa dihindari:

```text
DC        SQLite di gudang        ledger penuh: subject, place,
                                  movement, projection
Toko      SQLite di toko          idem, untuk pool tokonya sendiri
Pusat     Postgres                ledgernya sendiri + salinan fakta
                                  dari setiap node
```

Setiap node adalah **pemilik penuh** stok di site-nya. Ia tidak meminta izin,
tidak menunggu jawaban, dan tidak bisa dikoreksi dari jauh — pusat hanya
mendengar apa yang sudah terjadi.

Yang menentukan kepemilikan adalah satu kolom:
`sync_origin_credential.inventory_enabled`, dengan indeks unik yang memastikan
**satu site hanya boleh punya satu pemilik**
(`0012_edge_inventory_snapshots.sql`, `sync_origin_one_inventory_owner_per_site`).

Site tanpa pemilik edge dijawab dari ledger pusat sendiri. Itulah kenapa tabel
`movement` di pusat tetap ada dan tetap dipakai: ia cadangan, bukan peninggalan.

---

## 2. Tiga tempat penyimpanan di pusat, dan tugasnya masing-masing

Ini tabel yang paling penting di seluruh dokumen ini.

| Tabel | Isinya | Otoritatif? | Boleh dijumlahkan dengan yang lain? |
|---|---|---|---|
| `movement`, `inventory_projection` | ledger pusat sendiri | ya, untuk site tanpa pemilik edge | **tidak** |
| `edge_movement`, `edge_movement_line`, `edge_inventory_fact_position` | fakta dari node edge | ya, untuk site milik node itu | **tidak** |
| `edge_inventory_snapshot`, `edge_inventory_pool` | checkpoint saldo agregat | tidak — ini observasi | **tidak** |

Ketiganya **tidak pernah dilebur**. Fakta edge tidak pernah menjadi baris
`movement`. Komentar di migrasinya menyebut alasannya dengan kalimat yang layak
dihafal: *"It remains separate from Cloud's native movement ledger"*
(`0016_edge_movements.sql`).

Posisi per subject dari fakta edge disimpan di `edge_inventory_fact_position`,
dan komentar di skemanya menegaskan pembagian kerja: posisi itu **bisa dibangun
ulang** dari `edge_movement` + `edge_movement_line`, dan **snapshot tidak pernah
menimpanya**. Checkpoint adalah pendapat; fakta adalah kebenaran.

---

## 3. Fakta dan checkpoint bukan hal yang sama

```text
Fakta        satu movement group, utuh, berurut, tidak bisa diedit.
             Sampai lewat seq yang tidak boleh bolong.
             → "pukul 09.14 lima belas potong pindah dari rak ke picking"

Checkpoint   potret saldo semua pool pada satu detik.
             Satu baris per origin; yang baru menimpa yang lama.
             → "pada 09.20 gudang punya 3.589 potong"
```

Checkpoint dipakai untuk mengatakan **seberapa segar** pengetahuan pusat, bukan
untuk mengatakan berapa stoknya. Checkpoint yang lebih tua dari lima menit
ditandai `stale` pada jawaban fleet
([`queries.rs:1316`](../backend/src/cloud/postgres/queries.rs)).

---

## 4. Aturan shadowing — dan bug yang melahirkannya

**Target.**

> Sebuah site berhenti dijawab dari ledger pusat **pada saat node-nya benar-benar
> mulai bicara**, bukan pada saat node itu didaftarkan.

Perbedaan itu pernah menelan enam ratus potong baju.

Dulu, mendaftarkan sebuah node sudah cukup untuk menutupi baris pusat untuk
site itu. Node yang sudah di-provision tetapi belum pernah sync akan menyumbang
pool dasar bernilai **nol**, sementara saldo sungguhan duduk di baris pusat yang
dikeluarkan dari total — sebuah toko yang memegang enam ratus potong terbaca
`0`, tanpa satu baris pun di layar yang mengatakan kenapa.

Sekarang: kepemilikan tetap milik credential, yang berubah hanya **kapan** ia
mulai berlaku. Sebuah origin baru menutupi baris pusat setelah punya
`sync_applied_watermark` — bukti bahwa node itu pernah benar-benar berbicara.
Origin yang terdaftar tapi belum melapor dinamai tersendiri di diagnostik
(`unreported_edge_origins`), tidak disembunyikan.

Setiap baris pool pada jawaban fleet membawa `authority` dan
`included_in_fleet_total`, supaya pembaca tidak perlu menebak baris mana yang
dihitung.

---

## 5. `dc` dan `dc-01` — satu gudang, dua ejaan

**Ini penyebab dua bug terpisah dan pantas dibaca pelan-pelan.**

```text
Pusat   model pool-nya punya TEPAT SATU distribution centre,
        dan mengejanya harfiah di dalam id:   dc.warehouse

Edge    memparameterkan tata bahasa yang sama dengan site
        yang ia jalankan:                     dc-01.warehouse

Toko    tidak pernah berbeda                  store-07.floor
```

Karena shadowing dicocokkan berdasarkan `site_id`, **untuk DC tidak pernah ada
yang cocok**: baris pusat duduk di bawah `dc`, baris edge di bawah `dc-01`,
keduanya dihitung, dan gudang yang sama masuk total fleet dua kali. Satu
`dc.warehouse` berisi 3.589 potong muncul sebagai dua baris di layar, masing-
masing mengaku otoritatif.

Bug keduanya lebih halus: sebuah Official Count yang dibuka untuk site `dc`
tidak menemukan pemilik, **diam-diam menjadi hitungan yang dieksekusi pusat, dan
tidak pernah sampai ke gudang yang seharusnya berjalan**.

Keduanya ditutup dengan cara yang sama: nama kanonik `dc` diselesaikan ke
satu-satunya DC yang terdaftar
([`sync.rs:4619`](../backend/src/cloud/postgres/sync.rs) dan
[`sync.rs:4549`](../backend/src/cloud/postgres/sync.rs)). Kalau suatu hari ada
**dua** DC terdaftar, keduanya menolak alih-alih menebak — memilih salah satu
dari dua gudang bukan keputusan yang boleh diambil oleh sebuah pembacaan.

→ **G1**: ini perbaikan di dua tempat baca, bukan penyatuan ejaan.

---

## 6. Generation dan seq — kenapa fakta tidak boleh bolong

Setiap origin punya `generation` dan nomor urut `seq` yang padat. Aturan
penerimaannya tiga baris
([`sync.rs:399`](../backend/src/cloud/postgres/sync.rs)):

```text
seq <= durable       duplikat dari yang sudah dipegang  → lewati
seq == durable + 1   validasi; catat ACCEPTED atau tombstone REJECTED
seq >  durable + 1   ada yang bolong → BERHENTI, jawab dengan prefix
                     yang sudah ada
```

Berhenti, bukan melompat. Fakta inventory adalah perpindahan, dan perpindahan
yang diterapkan tanpa pendahulunya akan mencoba mengeluarkan barang dari tempat
yang menurut pusat belum pernah diisi.

`generation` naik ketika sebuah node dibangun ulang. Fakta dari generation lama
tidak ditolak dengan galat — ia dikonsumsi dan tidak dimaterialisasi, karena
generation itu memang sudah bukan otoritas lagi.

---

## 7. Dua tata bahasa dalam satu binary

Ini yang paling mudah membuat orang salah membaca kode: **modul sync di pusat
berbicara dengan kosakata EDGE, bukan kosakata pusat.**

```rust
// backend/src/cloud/postgres/sync.rs:14
use crate::edge::{
    EdgeRole, InventoryState, MovementCause as EdgeMovementCause,
    MovementLine as EdgeMovementLine, NodeContext, OperationalPool, Place, ...
};
```

Fakta yang masuk divalidasi dengan `NodeContext::authorize_line`
([`contracts.rs:79`](../backend/src/edge/contracts.rs)) — tata bahasa edge —
lalu disimpan apa adanya. Sementara `POST /api/v1/inventory/movements` di pusat
divalidasi dengan `validate_transition` milik pusat. Dua mesin keadaan, satu
proses.

Perbedaannya, lengkap:

| | Pusat | Edge |
|---|---|---|
| Nama DC di dalam id pool | `dc`, harfiah | `<site>`, diparameterkan |
| Jumlah cause | 12 | 15 |
| `IDENTIFICATION` | tidak ada | ada — barang anonim menjadi SKU |
| `TAGGING` | tidak ada | ada — kuantitas menjadi unit ber-EPC |
| `STORE_RECEIVE` | tidak ada | ada — `system/opening` → gudang toko |
| `system/identification` | tidak ada | ada, sebagai titik imbang |
| Tahap outbound | picking · picked · packed · shipment · in-transit | + **loaded**, di antara shipment dan in-transit |
| `picked.<toko>` sebagai tujuan | sah, langsung dari rak | **tidak pernah** — karton diisi langsung dari rak, pick area, pending, atau reject ([`place.rs:...is_dc_fulfillment_source_for`](../backend/src/edge/domain/inventory/place.rs)) |
| `RETURN_TO_DC` | sah | **selalu ditolak** |
| `FOUND` | boleh pindah pool | wajib pool yang sama |
| `StoreReject` → `dc.reject.<toko>` | sah | tidak ada |

### Kenapa edge punya `IDENTIFICATION` dan pusat tidak

Karena yang terjadi di gudang bukan perjalanan, melainkan **perubahan
kepercayaan**. Satu kiriman datang sebagai satu kuantitas anonim — "118 potong
dari artikel yang kita pesan" — dan pergi sebagai beberapa SKU yang teridentifikasi.
Dua sisi itu menyebut subject yang berbeda, jadi mereka tidak bisa menjadi satu
movement. `system/identification` adalah titik imbangnya: tidak ada yang boleh
mengendap di sana, dan saldo tidak nol berarti sebuah transformasi tercatat
setengah ([edge `place.rs:296`](../backend/src/edge/domain/inventory/place.rs)).

Pusat memodelkan langkah yang sama sebagai `NORMAL_MOVE` atas subject yang sama.
Dua cerita berbeda tentang satu peristiwa fisik. → **G2**

---

## 8. Barang dalam perjalanan: dua ledger yang tidak pernah bertemu

**Target.**

> Satu potong baju yang meninggalkan DC menuju toko keluar dari tanggung jawab
> DC pada saat toko mengambil alih tanggung jawab itu. Tepat satu kali, dan
> jejaknya bisa dibaca.

**As-is.** Tidak ada satu pun movement yang melintasi batas node, karena sebuah
node hanya boleh menyentuh pool miliknya sendiri
([`contracts.rs:99`](../backend/src/edge/contracts.rs)). Yang terjadi:

```text
ledger DC                        ledger TOKO

... ──▶ shipment.store-07
        ──▶ loaded.store-07
            ──▶ in-transit.store-07
                    │                system/opening ──▶ store-07.warehouse
                    │                        (cause STORE_RECEIVE)
                    ▼
                (berhenti di sini)
```

Dua akibat:

1. **Toko menciptakan stok dari `system/opening`.** Ia tidak bisa menyebut
   in-transit DC sebagai asal, karena pool itu bukan miliknya.
2. **Tidak ada transisi keluar dari `in-transit` di tata bahasa edge**
   ([edge `movement.rs:341`](../backend/src/edge/domain/inventory/movement.rs)).
   Barang yang sudah diterima toko **tetap berdiri di ledger DC sebagai
   in-transit, selamanya.** → **G3**

Yang menjembatani keduanya bukan movement melainkan **klaim**: DC menerbitkan
`IN_TRANSIT`, toko menerbitkan `RECEIVED`, dan pusat merekonsiliasi klaim yang
identitas fisik dan pengirimannya sama
([`transfer.rs:1`](../backend/src/sync/transfer.rs)). Komentar di modul itu
menyatakannya terang-terangan: *klaim adalah observasi, bukan movement.*

Itu bukan desain yang buruk — dua pihak yang mandiri memang hanya bisa sepakat
lewat bukti. Yang salah adalah sisi DC tidak pernah menutup bukunya.

---

## 9. Checkpoint berhenti terkirim begitu sebuah pool berjanji lebih dari isinya

Ini cacat yang berdiri sendiri dan pantas punya bagiannya sendiri, karena
akibatnya tidak kelihatan seperti sebabnya.

[inventory-ledger.md](./inventory-ledger.md) §6 mencatat bahwa
`Stock = On Hand + Allotted + Missing` **sudah bukan invariant**: sebuah pool
boleh menjanjikan lebih dari yang ada di raknya, dan kelebihannya dilaporkan
sebagai `shortfall`. `collect_pool_balances` di edge sudah mengikuti aturan baru
itu — komentarnya bahkan menjelaskan bahwa kondisi ini **kejadian biasa, bukan
kesalahan**, sejak picking berhenti melepas commitment
([`sqlite.rs:2518`](../backend/src/edge/sqlite.rs)).

Tetapi kontrak wire checkpoint masih memakai persamaan lama:

- `PoolSnapshotBalance` hanya membawa `stock`, `allotted`, `on_hand`, `missing` —
  **`shortfall` dibuang** ([`inventory.rs:15`](../backend/src/sync/inventory.rs));
- `PoolSnapshotPayload::validate` menolak dengan `BalanceEquation` kalau
  `stock != on_hand + allotted + missing`
  ([`inventory.rs:71`](../backend/src/sync/inventory.rs));
- dan `edge_inventory_pool` di Postgres memasang `CHECK` yang sama
  (`0012_edge_inventory_snapshots.sql`).

Begitu satu pool DC mengalami shortfall, persamaan itu tidak lagi terpenuhi,
`PoolSnapshotPayload::new` mengembalikan error, dan `enqueue_pool_snapshot`
gagal ([`sqlite.rs:1077`](../backend/src/edge/sqlite.rs)) — **untuk seluruh
site, bukan untuk satu pool.** Node itu berhenti mengirim checkpoint, dan di
layar fleet ia muncul sebagai gudang yang checkpoint-nya hilang atau basi,
bukan sebagai gudang yang sedang kekurangan barang.

Perbaikan di satu lapisan tidak diteruskan ke lapisan berikutnya. → **G4**

---

## 10. Daftar gap

| | Gap | Bukti | Perbaikan |
|---|---|---|---|
| **G1** | `dc` dan `dc-01` masih dua ejaan; yang ada hanyalah dua tempat baca yang mendamaikannya | [`sync.rs:4619`](../backend/src/cloud/postgres/sync.rs), [`queries.rs:1316`](../backend/src/cloud/postgres/queries.rs) | Satu ejaan. Parameterkan model pool pusat dengan site, seperti edge |
| **G2** | Identifikasi dan tagging punya dua cerita: transformasi di edge, perpindahan biasa di pusat | tabel di §7 | Naikkan `IDENTIFICATION`/`TAGGING` ke pusat, atau akui pusat tidak pernah menjalankan gudang |
| **G3** | `in-transit` di ledger DC tidak pernah kosong | tidak ada transisi keluar ([edge `movement.rs:341`](../backend/src/edge/domain/inventory/movement.rs)) | Saat klaim `RECEIVED` direkonsiliasi, terbitkan perintah ke DC untuk melepas in-transit-nya. **Ditulis (langkah 7a):** `inventory.in_transit.release.v1` → movement `HANDED_OVER` ke `system/handed_over` di node asal; postgres `0613`, sqlite `0055` |
| **G4** | Satu pool yang shortfall menghentikan seluruh checkpoint site itu | [`inventory.rs:71`](../backend/src/sync/inventory.rs) + `CHECK` di `0012` | Bawa `shortfall` di payload, longgarkan persamaan menjadi `stock + shortfall = on_hand + allotted + missing` |
| **G5** | Fakta dan checkpoint punya jalur validasi berbeda untuk fakta yang sama | §3 | Tidak perlu diperbaiki — tetapi harus ditulis di layar mana pun yang menampilkan keduanya |
| **G6** | Tidak ada yang membandingkan posisi fakta edge dengan checkpoint edge | tidak ada pembaca yang menyandingkan `edge_inventory_fact_position` dengan `edge_inventory_pool` | `replay` versi fleet: bandingkan keduanya, laporkan selisihnya, jangan perbaiki apa pun |

---

## 11. Keputusan terbuka

1. **Apakah pusat berhenti punya ledger sendiri.** Kalau setiap site pada
   akhirnya punya node, `movement` dan `inventory_projection` menjadi cadangan
   yang tidak pernah dipakai — dan setengah dari gap di ketiga dokumen ini
   lenyap bersamanya. Kalau tidak, tata bahasanya harus disatukan.
2. **Bagaimana DC menutup in-transit-nya (G3).** Rekomendasi: perintah dari
   pusat setelah klaim direkonsiliasi, bukan penghapusan sepihak — DC harus
   menerbitkan movement-nya sendiri, seperti pada Official Count.
3. **Berapa lama sebuah node boleh diam sebelum angkanya berhenti ditampilkan
   sebagai fakta.** Hari ini lima menit hanya menandai checkpoint `stale`; tidak
   ada ambang yang membuat sebuah site berhenti dijawab sama sekali.
