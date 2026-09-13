# Inventory V1 — Acuan Utama

Baseline: **1.0 — 12 September 2026**
Status: model domain **dibekukan**. Implementasi tertinggal di belakang revisi
ini — §20 menyebut tepat apa yang sudah benar, apa yang hanya salah kata, dan
apa yang belum ada kodenya.

Dokumen ini memiliki **arti bisnis, boundary antar-domain, invariant, dan
kosakata UI** untuk Inventory. Ia **tidak** memiliki mekanika. Mekanika dimiliki
tiga dokumen turunan, dan keduanya tidak boleh saling menyalin:

```text
INVENTORY-V1.md            arti bisnis · boundary · invariant · kosakata UI
docs/inventory-ledger.md   subject · place · movement · ledger mechanics
docs/inventory-count.md    count · missing · found · lost · RFID evidence
docs/inventory-fleet.md    authority Edge/Cloud · offline · sync · rekonsiliasi
```

Tetangga yang juga bukan milik dokumen ini:
[allotment-v1](docs/allotment-v1.md) memiliki janji MD dan aritmetika
commitment; [DISTRIBUTION-V1-FREEZE](DISTRIBUTION-V1-FREEZE.md) memiliki
eksekusi fisik outbound. Kosakata kanonik: [CONTEXT.md](CONTEXT.md).

Kalau dokumen, turunannya, dan kode bertentangan: **kode dan test yang menang,
lalu dokumen diperbaiki** — bukan sebaliknya. Kalau dokumen ini dan turunannya
bertentangan soal *arti*, dokumen ini yang menang dan turunannya diperbaiki.

Kalau Anda hanya punya satu menit: baca §2 (empat konsep dan tabrakan
`on_hand`), §5 (Reject bukan Missing), §6 (tiga kasus Store Receive), §19
(larangan).

---

## 1. Definisi Inventory

**Freeze.**

> Inventory adalah sumber kebenaran tentang **barang secara fisik**: barang
> tercatat berada di mana, apakah ditemukan, dan bagaimana perubahan fisiknya
> dibuktikan.

Inventory menjawab enam pertanyaan, dan hanya enam:

```text
1. Barang tercatat berada di pool mana?
2. Berapa yang menjadi tanggung jawab (custody) pool tersebut?
3. Berapa yang ditemukan?
4. Berapa yang Missing?
5. Kalau Missing diselesaikan — Found atau Lost?
6. Movement apa yang menjelaskan perubahan itu?
```

Inventory **bukan**:

```text
demand Store        → Allotment
prioritas kerja     → Operations
purchase order      → Procurement
penjualan           → POS
nilai persediaan    → Finance  (dan hari ini: belum ada — §20)
```

### Boundary utama

```text
Allotment     apa yang DIJANJIKAN ke Store
Inventory     barang SEKARANG tercatat di mana, dan apa kondisi keberadaannya
Operations    SIAPA melakukan pekerjaan fisik berikutnya
```

**INV-01** — Inventory tidak pernah mengubah demand, dan Allotment tidak pernah
mengubah fakta fisik. Satu peristiwa fisik boleh menghasilkan dua catatan di dua
domain; ia tidak boleh menghasilkan satu angka yang dipaksa menjawab keduanya.

---

## 2. Empat konsep yang tidak boleh dicampur

```text
Subject     apa yang dihitung
Pool        tahap/lokasi operasional tempat stok menjadi tanggung jawab
State       apakah subject di pool itu Present atau Missing
Evidence    bukti fisik
```

### Subject

Dua bentuk, dipertahankan apa adanya:

```text
UNIT        satu potong fisik, ber-EPC
QUANTITY    sejumlah potong yang belum bisa dibedakan
```

Detail dimiliki [inventory-ledger.md](docs/inventory-ledger.md) §2.

### State — dan tabrakan istilah yang harus ditulis terang-terangan

```text
Present     secara ledger ada di pool ini
Missing     seharusnya ada di pool ini, tetapi tidak ditemukan
On Hand     metric UI availability — BUKAN inventory state
```

**INV-02** — `Present` dan `On Hand` adalah dua hal berbeda dan tidak boleh
dipakai bergantian.

Catatan kompatibilitas, dan ini wajib disebut karena akan membingungkan siapa
pun yang membaca kode: penyimpanan memakai string internal `:on_hand` untuk
state `Present` (`inventory_place.state`, dan id place seperti
`store-07.floor:on_hand`). String itu adalah **nama teknis untuk Present**.
Kesamaan ejaannya dengan metric UI `On Hand` adalah kecelakaan sejarah, bukan
pernyataan bahwa keduanya sama.

```text
store-07.floor:on_hand     → state Present di pool Sales Floor toko 07
"On Hand" di layar Stock   → availability = max(supply − To Pack, 0)
```

Satu bisa 600 sementara yang lain 0, pada baris yang sama, dan keduanya benar.

### Evidence

```text
RFID observation
manual scan
official count
receiving scan/count
```

**INV-03** — Evidence tidak mengubah ledger. Hanya **domain action** yang sah
mengubah ledger, dan action itu boleh memakai evidence sebagai dasarnya.

### Diagram tunggal — Pool · State · Evidence · Allotment overlay

```text
        ALLOTMENT OVERLAY — janji MD, bukan inventory, tidak disimpan di pool
        To Pack · At Packed · At Shipment · At Loaded · At In Transit
        Receiving Gap · Received · Closed Short
                    │
                    │  menempel pada SKU × site.
                    │  Tidak memiliki, tidak memindahkan, tidak dijumlahkan
                    ▼      dengan angka pool.
 ┌───────────────────────────────────────────────────────────────────────┐
 │  POOL — di mana barang menjadi tanggung jawab                          │
 │                                                                        │
 │   DC     Pending (Unidentified · Untagged)                             │
 │          Storage                                                       │
 │          Pick Area                        ← bersama, tanpa destination │
 │          Packed · Store                                                │
 │          Shipment · Store                                              │
 │          In Transit · Store                                            │
 │          DC Reject · Store Reject (asal Store)                         │
 │                                                                        │
 │   Store  Warehouse · Sales Floor · Store Reject                        │
 │                                                                        │
 │   ┌─────────────────────────────────────────────────────────────────┐  │
 │   │ STATE — per subject, per pool                                    │  │
 │   │   Present   tercatat ada di pool ini                             │  │
 │   │   Missing   seharusnya ada di pool ini, tidak ditemukan          │  │
 │   └─────────────────────────────────────────────────────────────────┘  │
 │                                                                        │
 │   Stock pool = Present + Missing                                       │
 └───────────────────────────────────────────────────────────────────────┘
                    ▲
                    │  membuktikan. Tidak memindahkan.
                    │  Perubahan pool/state hanya lewat MOVEMENT.
 ┌───────────────────────────────────────────────────────────────────────┐
 │  EVIDENCE — RFID observation · manual scan · official count ·          │
 │             receiving scan                                             │
 └───────────────────────────────────────────────────────────────────────┘
```

---

## 3. Inventory Pool ≠ Allotment Fulfillment Stage

```text
Inventory Pool              = di mana barang berada / custody
Allotment Fulfillment Stage = posisi quantity dalam memenuhi janji MD
```

Contoh yang paling sering salah dibaca:

```text
Inventory:   Storage  ──▶ Pick Area
Allotment:   To Pack  ──▶ To Pack        (tidak bergerak)
```

**INV-04** — Picking memindahkan inventory dan **tidak** memindahkan
commitment. Sepotong barang terikat ke satu toko pada saat **Pack**, bukan pada
saat diambil dari rak.

Setelah Pack keduanya sering terlihat sejajar — `Packed · Store` dan `At Packed`
bergerak bersamaan — tetapi keduanya tetap bukan object yang sama, tidak boleh
dijumlahkan, dan tidak boleh diturunkan satu dari yang lain.

Istilah **`bucket` dilarang** di dokumen, kode, dan layar. Ia pernah dipakai
untuk pool, untuk stage, dan untuk kolom laporan, dan itulah sebabnya dilarang.

---

## 4. Taksonomi pool kanonik

### Target bisnis

```text
DC

  Pending
  ├─ Unidentified
  └─ Untagged

  Storage

  Distribution
  ├─ Pick Area
  ├─ Packed      · Store
  ├─ Shipment    · Store
  └─ In Transit  · Store

  Reject
  ├─ DC Reject
  └─ Store Reject · originating Store


STORE

  Warehouse
  Sales Floor
  Store Reject
```

### Pick Area

```text
dc.outbound.picking          canonical shared Pick Area
dc.outbound.picked.<store>   legacy — read compatibility only, NO NEW WRITES
```

**INV-05** — Pick Area tidak menyebut toko, karena picking tidak memutuskan
toko. Pool yang menyebut toko sebelum Pack adalah pool yang menegaskan
keputusan yang belum diambil siapa pun.

`picked.<store>` **tidak boleh ditampilkan sebagai target V1** di layar mana
pun. Ia dibaca supaya riwayat lama tetap terbaca, dan tidak ditulis lagi.

### Loaded

`Loaded` adalah stage eksekusi yang nyata dan sudah dipakai node DC. Kalau ia
memerlukan place/pool di ledger, **dokumentasikan teknisnya** di
[DISTRIBUTION-V1-FREEZE](DISTRIBUTION-V1-FREEZE.md) dan
[inventory-fleet.md](docs/inventory-fleet.md) — jangan mengubah terminologi UI
sembarangan. Untuk MD, `Shipment` dan `Loaded` dilebur menjadi satu bacaan;
Operations membacanya terpisah. Itu keputusan Allotment V1 dan tidak diubah di
sini.

### Reject DC vs Reject Store

```text
<store>.reject       barang rusak yang MASIH berada di Store
dc.reject.<store>    barang rusak asal Store yang SUDAH kembali ke DC
dc.reject.dc         barang rusak milik DC sendiri
```

**INV-06** — `dc.reject.<store>` menyimpan asal, karena yang menagih kembali ke
supplier perlu tahu toko mana yang mengirimnya. Ia bukan duplikat
`<store>.reject`; keduanya adalah dua lokasi fisik yang berbeda.

---

## 5. Reject dan Missing adalah dua hal berbeda

**Freeze.**

```text
Reject   = POOL
Missing  = STATE
```

Bacalah dua baris ini sampai bedanya terasa:

```text
store-07.reject : Present      barang DIKETAHUI berada di Store Reject
store-07.warehouse : Missing   barang SEHARUSNYA di Warehouse, tidak ditemukan
```

**INV-07** — Barang Reject justru **sudah ditemukan**. Reject adalah pernyataan
tentang kondisi barang; Missing adalah pernyataan tentang ketidakhadirannya.
Satu barang boleh Reject dan Present sekaligus; itu keadaan normal.

---

## 6. Store Receive — boundary yang dibekukan di sini

**Freeze.**

> Store Receive adalah **recording action**, bukan approval atau rejection
> terhadap Allotment. Store mencatat apa yang benar-benar datang.

**INV-08** — Tidak ada domain action bernama `Reject Allotment` atau
`Reject Shipment`. Toko tidak menolak janji; toko mencatat kenyataan.

Untuk satu shipment:

```text
expected / delivered
        → physical observation
                → Normal / Store Reject / Missing
```

### Tiga kasus, dan hasilnya di dua domain

#### Case A — seluruh barang ditemukan dan normal

```text
Handed over  100
Normal       100
```

| | Hasil |
|---|---|
| Inventory | `store-07.warehouse : Present 100` |
| Allotment | `Received 100` · `To Receive 0` · COMPLETED |

#### Case B — 98 normal + 2 Store Reject

```text
Handed over   100
Normal         98
Store Reject    2
Missing         0
```

| | Hasil |
|---|---|
| Inventory | `store-07.warehouse : Present 98`<br>`store-07.reject : Present 2` |
| Allotment | `Received 100` · `To Receive 0` · COMPLETED |

**Karena semua 100 benar-benar sampai ke Store.** Store Reject adalah
disposition/kondisi fisik **setelah** receipt, bukan kegagalan fulfillment.

**INV-09** — Barang yang masuk Store Reject **tetap menambah `Received`**.
Allotment boleh menampilkan konteks Inventory yang tertaut:

```text
Received 100
└─ Store Reject 2
```

tetapi `Store Reject` **bukan counter dan bukan stage milik Allotment**, dan
tidak pernah mengurangi `Received`.

#### Case C — 98 ditemukan, 2 tidak ditemukan

```text
Handed over  100
Found         98
Missing        2
```

| | Hasil |
|---|---|
| Inventory | `store-07.warehouse : Present 98`<br>`store-07.warehouse : Missing 2` |
| Allotment | `Alloted 100` · `Received 98` · `To Receive 2` · ACTIVE |

**INV-10** — Jangan meninggalkan 2 potong itu di `In Transit`. Custody sudah
berpindah ke Store Warehouse pada saat serah terima di pintu; yang belum
ditemukan adalah masalah Store, bukan barang yang masih di jalan.

Tiga kebenaran yang berbeda, dan ketiganya benar pada saat yang sama:

```text
Inventory     custody Store  = 100
Observation   found          =  98
Allotment     fulfilled      =  98
```

**INV-11** — Jangan memaksa satu angka menjawab ketiga pertanyaan itu.

---

## 7. Selisih penerimaan otomatis menjadi Missing

**Freeze.**

> Store tidak membuat case manual. Kalau `handed_over > physically_found`, maka
> pada `Confirm Receive`, **secara atomik**:

```text
found qty        → destination pool : Present
difference qty   → destination pool : Missing
```

dan work item Missing di Inventory otomatis dibuat atau ter-link.

**INV-12** — Tidak boleh ada tombol `[Create discrepancy]`. Store hanya merekam
fakta; Inventory yang menyelesaikannya. Sebuah sistem yang meminta orang di
pintu gudang untuk "membuat discrepancy" adalah sistem yang memindahkan
pekerjaannya sendiri ke orang yang paling sedikit waktunya.

---

## 8. Siklus hidup Missing

```text
pool : Missing
   ├─ Found            → pool yang SAMA : Present
   ├─ Confirmed Lost   → system/lost
   └─ Disposal         → external/disposal
```

### Found

**INV-13** — `Found` mengembalikan barang ke **pool asalnya**, tidak pernah ke
pool lain. Kalau barang perlu berpindah setelah ditemukan, itu movement
tersendiri dengan sebabnya sendiri.

Alasannya sederhana: "ditemukan di gudang DC" dan "ditemukan di lantai toko lalu
dikirim ke DC" adalah dua cerita berbeda, dan yang kedua punya perjalanan yang
harus tercatat. Membiarkan `Found` memilih tujuan berarti membiarkan satu klik
menghapus sebuah perjalanan.

### Lost

**INV-14** — **Inventory**, bukan MD, yang menentukan barang Lost.

```text
pool : Missing  →  system/lost
```

Lost bukan `Received`, dan bukan `Close Short`.

Kalau Missing itu terkait fulfillment yang belum selesai, event Lost memberi
tahu commitment bahwa quantity itu perlu dipenuhi kembali:

```text
To Pack += lost fulfillment quantity
```

**INV-15** — Allotment tetap pemilik demand. Setelah demand kembali ke `To Pack`,
MD yang memilih: replacement berjalan normal, atau `Close Short`.
**Inventory tidak pernah bisa Close Short.**

---

## 9. Allotment yang sudah selesai tidak dibuka ulang

**Freeze.**

```text
Received 100  →  Allotment COMPLETED
```

Kalau besok count di Store menemukan `Missing 2`, itu **murni Inventory issue**.

**INV-16** — Jangan menulis `Received 100 → 98`. Jangan membuka ulang Allotment.
Jangan membuat `To Receive 2`.

Riwayat penerimaan tidak ditulis ulang oleh kejadian inventory yang terjadi
sesudah penerimaan selesai. Barang yang kemudian dikembalikan adalah Returns
workflow yang baru, bukan pembatalan penerimaan yang lama.

---

## 10. Movement adalah satu-satunya cara stock berubah

Prinsip existing dipertahankan utuh:

> Stock bukan angka yang diedit. Stock adalah hasil movement.

```text
append-only
auditable
idempotent
cause + reason + actor + occurred_at
```

Projection bukan source of truth. Replay dan repost tidak boleh menulis sejarah
baru. Detail dimiliki [inventory-ledger.md](docs/inventory-ledger.md).

---

## 11. RFID adalah evidence, bukan movement

**Freeze.**

```text
Observation  ≠  Inventory Movement
```

RFID boleh: membuktikan sebuah EPC terlihat · membantu Count · membantu
Pick/Pack/Receive · menghasilkan discrepancy atau anomaly.

**INV-17** — Generic observation tidak boleh diam-diam memindahkan pool,
menjadikan barang `Found`, atau menjadikannya `Lost`. Perubahan ledger tetap
memerlukan domain action yang sah.

Detail dimiliki [inventory-count.md](docs/inventory-count.md) §7.

---

## 12. Official Count

Lifecycle existing dipertahankan:

```text
Draft → Active → Review → Closed
```

Expected dibekukan saat count **dimulai**, bukan saat disetujui.

```text
Shortage   pool : Present  →  pool yang SAMA : Missing
Gain       system/count_gain  →  pool : Present
```

**INV-18** — Count tidak boleh memindahkan barang antar pool. Ia hanya boleh
menyatakan ditemukan atau tidak ditemukan. Resolusi Found/Lost tetap milik
Inventory, sebagai langkah terpisah.

**INV-19** (target V1) — `counter != approver`, atau capability-equivalent
maker/checker. Persetujuan oleh orang yang menghitung sendiri bukan persetujuan.
Pola dua orang ini sudah dipakai di
[receiving — verification](docs/receiving-verification.md) dan berlaku sama di
sini.

**INV-20** — Jangan menyelesaikan discrepancy count dengan mengedit projection.

---

## 13. Metric Inventory

Kosakata UI dibekukan:

```text
Stock · On Hand · Alloted · Missing · Shortfall · RFID Seen
```

Semantiknya, sangat eksplisit:

| Metric | Arti | Milik |
|---|---|---|
| `Stock` | `Present + Missing` pada scope pool | Inventory |
| `Missing` | saldo state Missing | Inventory |
| `Alloted` | commitment overlay dari Allotment — **bukan** inventory state, bukan pool | Allotment |
| `On Hand` | `max(eligible_supply − blocking_commitment, 0)` | turunan |
| `Shortfall` | `max(To Pack − eligible_supply, 0)` | turunan |
| `RFID Seen` | EPC berbeda yang terbaca dalam jendela waktu | Evidence |

**INV-21** — `blocking_commitment` untuk source availability adalah **`To Pack`**,
bukan `To Receive`. Barang yang sudah dipak secara fisik sudah meninggalkan pool
sumber; mengurangkan yang belum diterima berarti menghitungnya dua kali.

**INV-22** — `On Hand` tidak pernah negatif. Kelebihan janji muncul sebagai
`Shortfall`, bukan sebagai angka minus.

**INV-23** — `RFID Seen` adalah metric evidence, bukan stock, dan tidak pernah
dijumlahkan dengan metric stock mana pun.

---

## 14. Scope sangat penting

Bedakan dua layar yang sering dikira sama:

```text
Inventory Pool screen        physical truth PER POOL
New Allotment availability   source availability PER SITE + SKU
```

Untuk DC:

```text
eligible source supply = Storage + shared Pick Area
```

karena Picking tidak melepas commitment (**INV-04**).

**INV-24** — Commitment dan supply dihitung pada scope yang sama, **tepat satu
kali**. Jangan mengurangi `To Pack` sekali di Storage lalu sekali lagi di Pick
Area; jangan pula mengurangi `To Pack` se-site dari satu pool saja.

**INV-25** — Pada shared Pick Area, `Alloted = —`, bukan `0`. Barang di sana
belum punya destination Store, jadi "tidak ada yang dijanjikan dari sini" bukan
jawaban yang benar; jawaban yang benar adalah "janji bukan konsep di sini".

---

## 15. Site authority

**INV-26** (top-level invariant) — Pada satu waktu, satu site hanya mempunyai
**satu** authority Inventory.

Offline tidak boleh membuat dua sumber kebenaran. Sebuah gudang yang bekerja
tanpa jaringan tetap satu-satunya yang berhak menulis ledger site-nya; pusat
mendengar, dan tidak menebak.

Detail tentang Edge, Cloud, generation, seq, watermark, checkpoint, dan
shadowing dimiliki [inventory-fleet.md](docs/inventory-fleet.md).

---

## 16. Store Reject

```text
Store Reject = inventory pool untuk barang yang DITEMUKAN secara fisik di Store
               tetapi tidak berada di penempatan stock normal/saleable.
```

Store Reject **bukan**: Missing · Lost · Close Short · penolakan atas Allotment.

Kalau unit sampai dan masuk Store Reject:

```text
Allotment Received tetap bertambah.      (INV-09)
```

Disposition berikutnya ditentukan **Inventory**:

```text
tetap Store Reject
Return to DC
Disposal
atau workflow lain yang memang sah
```

**INV-27** — Kalau barang kembali ke DC, gunakan Returns/movement flow. Jangan
membuka ulang Allotment.

> ⚠ **Konflik terbuka.** Hari ini "Return to DC" adalah sebuah `AllotmentType`
> (keputusan MD yang membuat allotment baru), bukan Returns workflow milik
> Inventory. §17 menempatkan disposition Store Reject di Inventory. Dua
> pembacaan ini harus didamaikan sebelum coding — lihat §20, **DC-1**.

---

## 17. Kepemilikan lintas domain

| Domain | Yang dimiliki |
|---|---|
| **MD** | create Allotment · Close Short |
| **Operations / Floor** | physical Receive · Pick · Pack · Shipment · Load · Dispatch |
| **Inventory** | Count · Missing · Found · Lost · placement correction · Store Reject disposition |
| **Store** | record actual receipt · physical movement Warehouse ↔ Sales Floor |

**INV-28** — Jangan membuat Inventory mengubah demand. Jangan membuat MD
memutuskan fakta fisik.

---

## 18. Kontrak UI V1

Menu Inventory tetap empat:

```text
Stock · Counts · Movements · RFID
```

**INV-29** — Jangan menambah menu generic `Exceptions` di V1. Masalah tetap
dekat dengan domain dan sumbernya:

```text
count variance          → Counts
Missing                 → Stock / Counts
RFID mismatch           → RFID
receiving discrepancy   → receiving detail + link ke Inventory
```

RFID memakai dua tab:

```text
Observations | Discrepancies
```

bukan `Sightings`.

Layar Stock utama menampilkan bahasa manusia, bukan canonical id:

```text
Pool · Stock · On Hand · Alloted · Missing · RFID Seen · Last Count
```

dan pada shared Pick Area, `Alloted = —` (**INV-25**).

### Catatan kesiapan — kontrak ini hampir seluruhnya sudah ada

**Ruang lingkup audit UI: `frontend-hub`.** `frontend-hub-2` dikesampingkan atas
arahan pemilik 2026-09-12 dan tidak diaudit di dokumen ini.

Modul Inventory di hub **sudah ditulis dan sudah terdaftar**:
[`inventoryNav`](frontend-hub/src/screens/inventory/nav.ts) dirakit oleh
`lib/navigation.ts` dan terdaftar di
[`navigation.ts:202`](frontend-hub/src/lib/navigation.ts). Empat baris terlihat
di sidebar, dan tiga di antaranya sudah persis kontrak ini:

```text
/inventory               Stock        ✓
/inventory/counts        Counts       ✓
/inventory/movements     Movements    ✓
/inventory/observations  Sightings    ✗  target: RFID   (INV-29)
```

Tujuh layar lain — Availability, Pools, Missing, Reconciliations, As of,
Control, Time machine — ditandai `hidden: true`: tetap punya rute, tetap bisa
di-link, tetap ada di ⌘K, tetapi bukan sub-item sidebar. Itu **sesuai** §18:
`Missing` memang dicapai dari Stock atau Counts, bukan dari menu sendiri, dan
tidak ada menu generic `Exceptions` di mana pun.

Jadi yang tersisa dari kontrak ini bukan pekerjaan arsitektur, melainkan
**penamaan**: satu baris menu, satu judul, dua tab, dan tiga judul kolom.
→ **§20.3 #11, #12, #20**

---

## 19. Larangan

```text
 1. Jangan edit stock langsung.
 2. Jangan anggap projection sebagai source of truth.
 3. Jangan anggap RFID observation sebagai movement.
 4. Jangan anggap Missing sebagai Lost.
 5. Jangan resolve Found ke pool lain; Found kembali ke pool asal.
 6. Jangan pakai Store Reject sebagai sinonim Missing.
 7. Jangan mengurangi Allotment Received karena barang kemudian masuk Reject.
 8. Jangan reopen completed Allotment karena count berikutnya menemukan Missing.
 9. Jangan pakai To Receive sebagai blocker availability.
10. Jangan pakai legacy picked.<store> untuk write baru.
11. Jangan jumlah Cloud + Edge untuk site yang sama.
12. Jangan gunakan internal `:on_hand` sebagai alasan menyamakan state Present
    dengan UI metric On Hand.
```

---

## 20. Status implementasi dan gap

Audit terhadap tiga dokumen turunan dan kode, dibaca dari `feat/handheld-rfid`
di `eabc58c`. **Belum ada kode yang diubah.**

Klasifikasi:

```text
ALREADY CORRECT        model dan kode sudah sesuai dokumen ini
NEEDS WORDING UPDATE   benar, tetapi katanya harus diperbaiki
LEGACY BUT READABLE    tidak sesuai target, dibiarkan untuk baca saja
CODE GAP               dokumen benar, kodenya belum ada
DOMAIN CONFLICT        dua model yang harus didamaikan pemilik
```

### 20.1 Review minimal yang diminta

| # | Item | Klasifikasi | Bukti |
|---|---|---|---|
| **1** | `dc.outbound.picked.<store>` vs canonical Pick Area | **DITUTUP** (migrasi `0252`) | Dulu: pusat menulis `picked.<store>` pada eksekusi allotment TO_STORE, dan `dc.outbound.picking` tidak punya baris sama sekali — movement pusat ke sana ditolak foreign key. Sekarang: Pick Area punya barisnya, `execution_transition` menulis ke sana ([`allotments.rs:1918`](backend/src/cloud/postgres/allotments.rs)), 13 pool `picked.<store>` + stage induk `PICKED` di-**retire** (`active=false`, riwayatnya tetap terbaca), dan isinya dipindahkan dengan `PLACEMENT_CORRECTION`. Katalog pusat: **112 → 99** pool hidup |
| **2** | Missing saat Store Receive | **CODE GAP** (besar) | `receive_store` / `receive_store_batch` tidak mengenal expected, hanya menyapu EPC ke `<store>.warehouse:on_hand` ([`sqlite.rs:3916`](backend/src/edge/sqlite.rs), [`:4010`](backend/src/edge/sqlite.rs)). Kolom `handed_over_quantity` sudah ada sejak `0176` dan **tidak ada satu baris Rust pun yang menulisnya** |
| **3** | Semantik Store Reject | **CODE GAP** | Transisi `StoreWarehouse → StoreReject` sah ([edge `movement.rs:388`](backend/src/edge/domain/inventory/movement.rs)), tetapi `StoreReceive` hanya boleh menuju `StoreWarehouse` ([`:185`](backend/src/edge/domain/inventory/movement.rs)) — Case B hanya bisa dilakukan dua langkah, bukan satu |
| **4** | Rekonsiliasi Store Receive / DC In Transit | **CODE GAP** | Tidak ada transisi keluar dari `in-transit` di tata bahasa edge ([`movement.rs:341`](backend/src/edge/domain/inventory/movement.rs)); barang yang sudah diterima toko berdiri selamanya di ledger DC ([fleet G3](docs/inventory-fleet.md)) |
| **5** | Tata bahasa movement Cloud vs Edge | **DOMAIN CONFLICT** | 12 cause vs 15, 4 tahap outbound vs 5, `RETURN_TO_DC` sah di pusat dan **selalu ditolak** di edge ([fleet §7](docs/inventory-fleet.md), [ledger G3](docs/inventory-ledger.md)) |
| **6** | Tabrakan nama `:on_hand` | **NEEDS WORDING UPDATE** | Ketiga dokumen turunan memakai `on_hand` untuk state tanpa menyebut bahwa metric UI `On Hand` adalah hal lain. §2 dokumen ini yang menutupnya; turunannya harus merujuk ke sana |
| **7** | Persamaan checkpoint dan shortfall | **CODE GAP** | `PoolSnapshotBalance` membuang `shortfall` dan `validate()` masih menuntut persamaan lama ([`inventory.rs:15`](backend/src/sync/inventory.rs), [`:71`](backend/src/sync/inventory.rs)) + `CHECK` di `0012`. Satu pool shortfall menghentikan seluruh checkpoint site ([fleet G4](docs/inventory-fleet.md)) |
| **8** | Return to DC | **CODE GAP** + **DOMAIN CONFLICT** | `MovementCause::ReturnToDc => false` di edge ([`movement.rs:258`](backend/src/edge/domain/inventory/movement.rs)); dan di pusat ia adalah `AllotmentType::ReturnToDc` ([`allotments.rs:1925`](backend/src/cloud/postgres/allotments.rs)) — lihat **DC-1** |
| **9** | Found same-pool | **CODE GAP** | `resolve_missing_found` menerima `destination_pool_id` bebas ([`queries.rs:2375`](backend/src/cloud/postgres/queries.rs)) dan `validate_transition` pusat tidak menuntut pool sama ([`movement.rs:188`](backend/src/cloud/domain/movement.rs)). Edge sudah benar ([`:212`](backend/src/edge/domain/inventory/movement.rs)) |

### 20.2 Yang sudah benar dan tidak perlu disentuh

| Item | Bukti |
|---|---|
| **Case C sudah dibekukan dan diuji** — `receiving_gap_qty = handed_over − received − lost_at_store`, dan komentarnya berbunyi *"The shop shows this as Missing; the allotment shows it as a receiving difference"* | [`commitment.rs:207`](backend/src/cloud/domain/commitment.rs) |
| `to_receive_qty = alloted − received − closed_short` → Case C menghasilkan `To Receive 2`, status ACTIVE, persis §6 | [`commitment.rs:327`](backend/src/cloud/domain/commitment.rs), [`:383`](backend/src/cloud/domain/commitment.rs) |
| **INV-15** — Lost mengembalikan demand ke To Pack: `owed_to_the_bench = original + unpacked + lost` | [`commitment.rs:293`](backend/src/cloud/domain/commitment.rs) |
| **INV-21** — blocking commitment adalah `To Pack`, bukan `To Receive` | [`commitment.rs:412`](backend/src/cloud/domain/commitment.rs), DISTRIBUTION-V1-FREEZE §5 `K2` |
| **INV-18** — `COUNT_SHORTAGE` menolak pasangan pool berbeda | [`movement.rs:175`](backend/src/cloud/domain/movement.rs) |
| **INV-17** — anomali RFID menjawab `automatic_inventory_effect: false` secara eksplisit | [`observations.rs:425`](backend/src/cloud/postgres/observations.rs) |
| **INV-20** / Movement append-only ditegakkan trigger database | `0001_inventory_schema.sql` |
| **INV-05** — Pick Area tanpa destination sudah menjadi model edge dan pusat | [edge `place.rs:40`](backend/src/edge/domain/inventory/place.rs), [pusat `place.rs:39`](backend/src/cloud/domain/place.rs) |
| **INV-22** — `On Hand` tidak pernah negatif: daftar pool memakai `InventoryBalance::project`, yang menjepitnya di nol | [`queries.rs:454`](backend/src/cloud/postgres/queries.rs) |
| **INV-29** — tidak ada menu generic `Exceptions`; tujuh layar diagnostik `hidden` tetapi tetap dirute dan tetap di ⌘K | [`nav.ts:58`](frontend-hub/src/screens/inventory/nav.ts) |
| Modul Inventory di `frontend-hub` sudah ditulis, dirakit dan terdaftar — tiga dari empat baris menu sudah persis §18 | [`navigation.ts:202`](frontend-hub/src/lib/navigation.ts) |

### 20.3 Temuan tambahan di luar daftar Anda

| # | Item | Klasifikasi | Bukti |
|---|---|---|---|
| **10** | `Alloted` digambar `0` padahal server sengaja mengirim `null` — melanggar **INV-25** | **CODE GAP** (UI) | `pool.summary.allotted ?? 0` ([`pools.tsx:817`](frontend-hub/src/screens/inventory/pools.tsx)) |
| **11** | Tab RFID bernama `Sightings` | **NEEDS WORDING UPDATE** | [`observations.tsx:304`](frontend-hub/src/screens/inventory/observations.tsx), [`:310`](frontend-hub/src/screens/inventory/observations.tsx) |
| **12** | Kolom `Observed` (target: `RFID Seen`) dan `Allotted` (target: `Alloted`) | **NEEDS WORDING UPDATE** | [`pools.tsx:258`](frontend-hub/src/screens/inventory/pools.tsx), [`:282`](frontend-hub/src/screens/inventory/pools.tsx) |
| **13** | Komentar layar Stock masih menyatakan `Stock = On hand + Allotted + Missing` sebagai invariant | **NEEDS WORDING UPDATE** | [`pools.tsx:157`](frontend-hub/src/screens/inventory/pools.tsx) |
| **14** | `counter != approver` belum ada (**INV-19**) | **CODE GAP** | `approve_count` hanya menuntut `actor_id` tidak kosong ([`counts.rs:419`](backend/src/cloud/postgres/counts.rs)) |
| **15** | Label `dc.warehouse` adalah `Warehouse`; target bisnis `Storage` | **NEEDS WORDING UPDATE** | `0002_demo_seed.sql:10` |
| **16** | Stok tidak pernah menjadi angka di buku besar — tidak ada COGS, stock loss, goods-in-transit | **CODE GAP** | [ledger G2](docs/inventory-ledger.md); hanya `payables.rs:921` yang memakai kunci persediaan |
| **17** | Topologi 1 DC + 13 toko + 112 pool hidup di dalam `0002_demo_seed.sql` | **CODE GAP** | [ledger G7](docs/inventory-ledger.md) |
| **18** | `inventory-count.md` G4 mengusulkan daftar kerja anomali tanpa menyebut ia harus tetap di menu RFID (**INV-29**) | **NEEDS WORDING UPDATE** | [count G4](docs/inventory-count.md) |
| **19** | `Shortfall` dihitung lalu dibuang: `InventoryBalance::project` menghasilkannya, `PoolRow` tidak punya field-nya, dan tidak satu pun layar menampilkannya — padahal §13 membekukannya sebagai kosakata UI | **CODE GAP** | `balance.shortfall` tidak pernah dipakai di [`queries.rs:452`](backend/src/cloud/postgres/queries.rs); kata "shortfall" tidak muncul sekali pun di `queries.rs` maupun di layar inventory `frontend-hub` |
| **20** | Baris menu keempat bernama `Sightings`; target §18 adalah `RFID` | **NEEDS WORDING UPDATE** | `{ path: "/inventory/observations", label: "Sightings" }` ([`nav.ts:80`](frontend-hub/src/screens/inventory/nav.ts)) |

### 20.4 Domain conflict yang menunggu keputusan pemilik

**DC-1 — Siapa pemilik "Return to DC".**
Dokumen ini (§16, §17) menempatkan disposition Store Reject — termasuk kembali
ke DC — di Inventory, lewat Returns/movement flow. Kode hari ini menempatkannya
di MD, sebagai `AllotmentType::ReturnToDc` yang membuat allotment baru
([`allotments.rs:1925`](backend/src/cloud/postgres/allotments.rs)). Keduanya
konsisten secara internal dan tidak bisa berlaku bersamaan.

**DC-2 — Satu tata bahasa movement, atau dua yang diakui.**
Pusat dan edge adalah dua mesin keadaan atas satu gudang. Yang menjalankan
gudang adalah edge. Pilihannya: satu crate bersama seperti `pricing-engine`,
atau menyatakan bahwa pusat tidak pernah menjalankan gudang dan menghapus
jalur keduanya.

**DC-3 — `Loaded` di ledger pusat.**
Edge punya; pusat tidak. Kalau `Loaded` tetap menjadi place ledger, pusat harus
mengenalnya; kalau tidak, ia harus dilebur pada batas sync dan dokumentasinya
dipindahkan seluruhnya ke fleet.

---

## 21. Exact code paths — A selesai, sisanya belum dikerjakan

Daftar ini adalah **pemetaan**, bukan rencana eksekusi. Urutannya belum
diputuskan dan — kecuali blok A — tidak ada kode yang boleh berubah sebelum
§20.4 dijawab.

**Blok A dikerjakan lebih dulu atas arahan pemilik, 13 September 2026.** Ia
boleh mendahului §20.4 karena ia tidak menyentuh satu pun dari ketiga pertanyaan
di sana: Pick Area bukan Return to DC (DC-1), bukan pilihan satu-atau-dua tata
bahasa (DC-2), dan bukan `Loaded` (DC-3). Ketiganya masih terbuka.

Semua jalur UI menunjuk **`frontend-hub`**. `frontend-hub-2` dikesampingkan atas
arahan pemilik 2026-09-12 dan tidak ada satu pun jalur di bawah yang menyentuhnya.

### A — Pick Area kanonik (§4, INV-05) — **SELESAI**

Dikerjakan 13 September 2026. Keputusan pada langkah 2 adalah **Picking**:
pusat tetap menulis, tetapi ke rak yang tidak menyebut toko. Tujuan tetap
divalidasi dan tetap dibawa — oleh `allotment_line`, tempat sebuah janji memang
tinggal.

```text
1  migrations/postgres/0252_the_pick_area_stops_naming_a_shop.sql   SELESAI
                                          baris + dua inventory_place-nya;
                                          isi 13 pool legacy dipindahkan dengan
                                          PLACEMENT_CORRECTION; 13 leaf + stage
                                          induk PICKED di-retire, tidak dihapus
                                          (riwayat movement menunjuk place-nya)
2  cloud/postgres/allotments.rs:1918      SELESAI — DcOutboundPicking
3  cloud/postgres/movements.rs:36         SELESAI — larangan menyebut KEDUA
                                          ejaan; picking karena itu jalan keluar
                                          yang sekarang, picked karena ia pensiun
4  cloud/postgres/allotments.rs:1541      sudah benar sebelum ini: ketiganya
   cloud/postgres/allotments.rs:1995      memang sudah mengenali picking di
   cloud/postgres/allotments.rs:2056      samping picked
5  cloud/postgres/queries.rs:758          peta tetap; label PICKING diselaraskan
   edge/http.rs:503                       menjadi "Pick Area" di kedua node
```

Yang **tidak** ikut: tiga stage induk `packed`/`shipment`/`in-transit`
(`is_placement=false`). Mereka bukan rak dan tidak pernah menyimpan apa pun —
`control.rs`, `observations.rs` dan `movements.rs` memilih *lewat* mereka untuk
berarti "tahap ini, toko mana pun". Sebuah pegangan scope layak punya baris.

### B — Store Receive, Store Reject, receiving gap (§6, §7, INV-08..INV-12)

```text
6  edge/contracts.rs:208                  ReceiveRequest: tambah expected /
                                          handed_over dan condition
                                          (NORMAL | STORE_REJECT)
7  edge/sqlite.rs:3916                    receive_store
   edge/sqlite.rs:4010                    receive_store_batch
                                          → tulis Present untuk found,
                                            Missing untuk selisih, Reject
                                            untuk kondisi — satu transaksi
8  edge/domain/inventory/movement.rs:185  StoreReceive: izinkan tujuan
                                          StoreReject dan state Missing
9  <belum ada>                            penulis handed_over_quantity.
                                          Kolomnya ada sejak 0176; eventnya
                                          tidak ada
10 cloud/postgres/sync.rs                 terima fakta receiving gap dan
                                          teruskan ke commitment
```

### C — In Transit ditutup (§6 INV-10, fleet G3)

```text
11 edge/domain/inventory/movement.rs:341  transisi keluar dari in-transit
12 sync/transfer.rs                       rekonsiliasi klaim RECEIVED →
                                          perintah ke DC untuk melepasnya
```

### D — Found kembali ke pool asal (§8 INV-13)

```text
13 cloud/domain/movement.rs:188           Found: tuntut pool sama
14 cloud/postgres/queries.rs:2375         resolve_missing_found: buang
                                          destination_pool_id
15 cloud/application/mod.rs               MissingResolutionRequest
```

### E — Checkpoint dan shortfall (fleet G4)

```text
16 sync/inventory.rs:15                   PoolSnapshotBalance: bawa shortfall
17 sync/inventory.rs:71                   validate(): stock + shortfall =
                                          on_hand + allotted + missing
18 migrations/postgres/<baru>             longgarkan CHECK edge_inventory_pool
                                          (0012)
   edge/sqlite.rs:2518                    collect_pool_balances sudah benar —
                                          tidak perlu disentuh
```

### F — Maker/checker pada Count (§12 INV-19)

```text
19 cloud/postgres/counts.rs:419           approve_count: tolak approver yang
                                          juga menulis count_entry
```

### G — Kosakata UI (§13, §18) — `frontend-hub` saja

```text
20 frontend-hub/.../inventory/nav.ts:80   label "Sightings" → "RFID"
21 frontend-hub/.../observations.tsx:304  judul "Sightings" →
   frontend-hub/.../observations.tsx:310  tab "Observations | Discrepancies"
22 frontend-hub/.../pools.tsx:258         "Allotted" → "Alloted"
   frontend-hub/.../pools.tsx:282         "Observed" → "RFID Seen"
   frontend-hub/.../pools.tsx:817         allotted ?? 0  →  "—"
   frontend-hub/.../pools.tsx:157         komentar persamaan lama
23 migrations/postgres/<baru>             label dc.warehouse → 'Storage'
```

### G2 — Shortfall sampai ke layar (§13, §20.3 #19)

```text
24 cloud/postgres/queries.rs:130          PoolRow: tambah field shortfall
25 cloud/postgres/queries.rs:452          bawa balance.shortfall, jangan buang
26 frontend-hub/.../pools.tsx:244         kolom Shortfall di sebelah On hand
```

### H — Return to DC (§16 INV-27, DC-1)

```text
27 edge/domain/inventory/movement.rs:258  ReturnToDc => false
28 cloud/postgres/allotments.rs:1925      AllotmentType::ReturnToDc
                                          → menunggu keputusan DC-1
```

---

## 22. Yang sudah diputuskan, dan yang masih terbuka

**Diputuskan dan dibekukan di dokumen ini:** definisi Inventory · empat konsep ·
pemisahan Present/On Hand · Pool ≠ Fulfillment Stage · taksonomi kanonik ·
Reject ≠ Missing · tiga kasus Store Receive · selisih otomatis menjadi Missing ·
Found kembali ke pool asal · Lost milik Inventory · completed Allotment tidak
dibuka ulang · metric dan scope · satu authority per site · kepemilikan lintas
domain · kontrak UI · dua belas larangan.

**Terbuka, menunggu pemilik:**

1. **DC-1** — Return to DC: Inventory Returns, atau Allotment MD? (§16, §20.4)
2. **DC-2** — Satu tata bahasa movement, atau dua yang diakui? (§20.4)
3. **DC-3** — `Loaded` sebagai place ledger pusat? (§20.4)
4. **Metode biaya persediaan** — prasyarat sebelum stok bisa menjadi angka di
   buku besar, dan sebelum ambang batas selisih count bisa ditetapkan
   ([ledger §10](docs/inventory-ledger.md))
5. **Apakah pool dibekukan selama count berjalan**
   ([count §11](docs/inventory-count.md))
