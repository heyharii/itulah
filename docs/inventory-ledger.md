# Inventory — buku besar stok

**Status:** model target, dengan implementasi sekarang dicatat di sampingnya.
Rujukan kode dibaca dari `feat/handheld-rfid` di `eabc58c`.

> **Arti bisnis, boundary dan invariant dimiliki
> [INVENTORY-V1.md](../INVENTORY-V1.md).** Dokumen ini memiliki
> mekanika ledger — subject, place, movement, saldo, projection — dan
> tidak mengulang arti yang sudah dibekukan di sana.

Kosakata: [`../CONTEXT.md`](../CONTEXT.md). Sebelum ini:
[receiving — verification](./receiving-verification.md) — barang menjadi stok
pada detik seorang verifier menerima, bukan ketika Finance memposting. Sesudah
ini: [stock opname dan barang hilang](./inventory-count.md) ·
[siapa pemilik stok tiap site](./inventory-fleet.md).

Janji kepada toko — allotment, picking, packing, commitment — **bukan** milik
dokumen ini. Itu milik [allotment-v1](./allotment-v1.md) dan
[DISTRIBUTION-V1-FREEZE](../DISTRIBUTION-V1-FREEZE.md). Di sini keduanya hanya
disebut sejauh perlu untuk menjelaskan batas.

Dokumen ini memiliki: **apa yang dihitung sebagai sepotong stok, di mana stok
boleh berada, bagaimana ia berpindah, dan angka apa yang boleh dibaca dari
perpindahan itu.**

---

## 1. Tidak ada tabel stok

Ini hal pertama yang harus dipegang, karena setiap kesalahan serius di area ini
berawal dari orang mencari "tabel stok" dan menemukan sesuatu yang mirip.

> Stok bukan kolom yang diedit. Stok adalah **jumlah dari perpindahan**.

Tiga hal saja:

```text
Subject     benda yang dihitung            "sepotong kemeja ini"
Place       tempat yang sah                 "rak DC", "lantai toko 07"
Movement    perpindahan satu subject
            dari satu place ke place lain   "sepotong itu, dari sana, ke sini"
```

Saldo sebuah place = jumlah semua movement yang masuk dikurangi yang keluar.
Tidak ada nomor lain yang berhak. Tabel `inventory_projection` memang menyimpan
angka jadi, tetapi ia **sekali pakai dan boleh dihapus kapan saja** — komentar
di skemanya mengatakan persis itu (`0001_inventory_schema.sql`, `COMMENT ON
TABLE inventory_projection`).

Konsekuensi yang paling sering dilupakan: **tidak ada koreksi stok tanpa
movement.** "Angkanya salah, saya betulkan" bukan operasi yang ada. Yang ada
adalah movement baru dengan sebab yang bisa dibaca orang.

---

## 2. Subject — benda yang dihitung

**Target.**

> Sebuah **Subject** adalah satu hal yang bisa ditunjuk dan dihitung. Ia punya
> dua bentuk, dan bentuknya menentukan apa yang boleh dilakukan padanya.

| | `UNIT` | `QUANTITY` |
|---|---|---|
| Artinya | satu potong fisik | sejumlah potong yang belum bisa dibedakan |
| Kuantitas | selalu 1 | berapa pun > 0 |
| EPC | wajib, unik | tidak ada |
| Contoh | kemeja yang sudah ditempeli tag | "118 potong dari PO ini, belum tahu warna dan ukurannya" |

Sebuah `UNIT` **tidak boleh berada di dua tempat perusahaan sekaligus**. Itu
bukan aturan gaya; itu definisi. Satu tag = satu kain. Kalau ledger mengatakan
tag yang sama ada di gudang DC dan di lantai toko 07, sistem punya dua objek
yang tidak bisa ia bedakan, dan tidak ada koreksi yang memulihkan mana yang
mana — tagnya sudah menempel di baju.

Aturan itu ditegakkan dua kali, sengaja:

- saat menerima subject dari luar perusahaan
  ([`movements.rs:275`](../backend/src/cloud/postgres/movements.rs)) — sebuah
  `UNIT` yang sudah punya penempatan perusahaan tidak boleh masuk lagi;
- setelah seluruh grup ditulis
  ([`movements.rs:360`](../backend/src/cloud/postgres/movements.rs),
  `validate_unique_company_placements`) — hitung ulang dari movement, dan kalau
  ada `UNIT` dengan lebih dari satu penempatan bersaldo positif, transaksi
  dibatalkan.

**As-is.** Tabel `inventory_subject` di pusat
(`0001_inventory_schema.sql`) menyimpan `subject_type`, `sku_id`, `epc`,
`barcode`, `quantity`, `uom`. **Tidak ada kolom biaya, tidak ada kolom nilai,
dan tabel itu tidak pernah sekali pun di-`ALTER` sejak migrasi pertama.** Lihat
§10.

Di edge, `inventory_subject` punya `unit_price_minor`
(`sqlite/0001_edge_inventory.sql`) — itu **harga jual** yang dibawa untuk
keperluan label dan kasir, bukan harga pokok. Ia tidak pernah naik ke pusat
sebagai nilai persediaan.

---

## 3. Place — tempat yang sah

**Target.**

> Sebuah **Place** adalah satu-satunya jenis alamat yang boleh ditulis pada
> sebuah movement. Tiga macam, dan ketiganya bukan sekadar label.

```text
OPERATIONAL   pool × state         milik perusahaan, bisa dihitung
                                   contoh: store-07.floor:on_hand

EXTERNAL      supplier             bukan milik kita lagi / belum
              customer
              disposal

SYSTEM        opening              lawan-transaksi buatan, supaya setiap
              count_gain           movement tetap punya dua sisi
              lost
```

### Pool

**Pool** adalah tahap fisik. Pusat mengenal tiga belas
([`place.rs:28`](../backend/src/cloud/domain/place.rs)):

```text
dc.pending.unidentified      barang diterima, belum tahu itu apa
dc.pending.untagged          sudah tahu SKU-nya, belum ada tag
dc.warehouse                 rak
dc.outbound.picking          sudah diambil dari rak, belum untuk siapa pun
dc.outbound.picked.<toko>
dc.outbound.packed.<toko>
dc.outbound.shipment.<toko>
dc.outbound.in-transit.<toko>
dc.reject.dc                 barang rusak milik DC
dc.reject.<toko>             barang rusak yang asalnya dari satu toko
<toko>.warehouse
<toko>.floor                 satu-satunya tempat yang boleh menjual
<toko>.reject
```

Dua hal yang sengaja ada di daftar itu:

- **`dc.outbound.picking` tidak menyebut toko.** Picking adalah perpindahan
  fisik yang tidak menjanjikan apa pun: seorang picker mengambil satu SKU
  sejumlah sekian, dan untuk toko mana potongan itu berakhir baru diputuskan
  saat masuk karton. Tempat yang mengaku tahu tokonya akan menegaskan keputusan
  yang belum dibuat siapa pun.
- **`dc.reject.<toko>` menyimpan asal.** Barang rusak dari toko 07 dan dari
  toko 08 tidak boleh tercampur, karena yang menagih kembali ke supplier perlu
  tahu dari mana asalnya.

### State

Setiap pool punya dua state, dan **state adalah bagian dari alamat**:

```text
:on_hand    ada di sana
:missing    seharusnya ada di sana, tidak ketemu
```

`missing` **bukan** satu tempat penampungan global. `store-07.floor:missing`
dan `dc.warehouse:missing` adalah dua alamat berbeda, karena "hilang di lantai
toko" dan "hilang di gudang" adalah dua masalah yang ditangani dua orang yang
berbeda. Lihat [inventory-count.md](./inventory-count.md) §6.

### Place system

Tiga place system ada supaya **setiap movement punya dua sisi**. Stok tidak
pernah "muncul": ia datang dari `system/opening` saat dunia dimulai, dari
`system/count_gain` saat stock opname menemukan lebih, dan pergi ke
`system/lost` saat seseorang mengakui barang itu tidak akan kembali.

**As-is.** Tiga hal.

*Pertama*, seluruh topologi site dan pool — satu DC, tiga belas toko, 112 pool —
diturunkan oleh migrasi bernama **`0002_demo_seed.sql`**. Bukan oleh layar admin,
bukan oleh berkas konfigurasi: toko keempat belas hari ini berarti menulis
migrasi. → **G7**

*Kedua*, sebagian baris `operational_pool` **bukan tempat** melainkan induk
penjumlahan: `0009_destination_scoped_outbound.sql` menjadikan
`dc.outbound.picked` dan tiga saudaranya `is_placement = FALSE`, lalu menurunkan
satu baris nyata per toko di bawahnya. Pembaca yang menjumlahkan induk **dan**
anaknya menghitung barang yang sama dua kali; `POOL_ROWS`
([`queries.rs:206`](../backend/src/cloud/postgres/queries.rs)) memisahkan
keduanya lewat kolom `is_rollup`.

*Ketiga*, **`dc.outbound.picking` ada di enum pusat tetapi tidak ada barisnya di
database.** Tidak di `0002`, tidak di `0009`, tidak di mana pun. Sebuah movement
pusat ke `dc.outbound.picking:on_hand` akan ditolak oleh foreign key ke
`inventory_place` — jadi tahap yang menurut kode pusat sah, di database pusat
tidak bisa dipakai. → **G8**

---

## 4. Movement — satu-satunya cara stok berubah

**Target.**

> Sebuah **Movement** memindahkan satu subject dari satu place ke place lain.
> Ia tidak pernah diedit dan tidak pernah dihapus.

Movement selalu datang dalam **Movement Group**: satu keputusan manusia, satu
alasan, satu `idempotency_key`, berapa pun baris di dalamnya.

Yang wajib ada pada setiap grup:

- **cause** — kenapa, dari daftar tertutup di §5;
- **reason** — kalimat manusia, dan skema menolak yang kosong
  (`CHECK (btrim(reason) <> '')`);
- **actor_id** — siapa;
- **occurred_at** — kapan kejadiannya, berbeda dari `recorded_at` yaitu kapan
  sistem mendengarnya.

**Append-only ditegakkan database, bukan disiplin.** `0001_inventory_schema.sql`
memasang trigger `movement_append_only` dan `movement_group_append_only` yang
menaikkan exception pada `UPDATE` atau `DELETE` apa pun. Kode aplikasi yang
mencoba memperbaiki sejarah akan gagal, bukan berhasil diam-diam.

**Idempotensi.** Setiap perintah tulis melewati `command_deduplication`:
kunci yang sama dengan badan yang sama mengembalikan jawaban lama
(`begin_idempotent` / `complete_idempotent`), kunci yang sama dengan badan
berbeda ditolak. Ini bukan kenyamanan — sebuah handheld di gudang yang sinyalnya
putus akan mengirim ulang, dan gudang tidak boleh kehilangan atau menggandakan
sepotong baju karena WiFi.

**As-is.** `create_movement_with_cause`
([`movements.rs:87`](../backend/src/cloud/postgres/movements.rs)) menulis grup,
lalu setiap baris, lalu menyegarkan proyeksi, lalu memeriksa ulang keunikan
penempatan. Semuanya dalam satu transaksi, dan `insert_group`
([`movements.rs:200`](../backend/src/cloud/postgres/movements.rs)) menitipkan
fakta sync ke outbox **di transaksi yang sama** — supaya ledger dan apa yang
diceritakan ke node lain tidak mungkin berbeda.

---

## 5. Tata bahasa perpindahan

**Target.**

> Bukan sembarang perpindahan sah. Pasangan (cause, dari, ke) adalah tata
> bahasa tertutup, dan yang di luar daftar ditolak di domain — bukan di layar,
> bukan di query.

Dua belas cause di pusat
([`movement.rs:18`](../backend/src/cloud/domain/movement.rs)):

| Cause | Dari | Ke |
|---|---|---|
| `OPENING` | `system/opening` | pool mana pun `:on_hand` |
| `NORMAL_MOVE` | pool `:on_hand` | pool `:on_hand`, hanya pasangan yang terdaftar |
| `SALE` | **hanya** `<toko>.floor:on_hand` | `external/customer` |
| `CUSTOMER_RETURN` | `external/customer` | **hanya** `<toko>.floor` atau `<toko>.reject` |
| `RETURN_TO_DC` | gudang/lantai/reject toko | `dc.warehouse:on_hand` |
| `SUPPLIER_RETURN` | pool `:on_hand` | `external/supplier` |
| `PLACEMENT_CORRECTION` | pool `:on_hand` | pool `:on_hand` |
| `COUNT_SHORTAGE` | `X:on_hand` | `X:missing` — **pool yang sama** |
| `COUNT_GAIN` | `system/count_gain` | pool `:on_hand` |
| `FOUND` | pool `:missing` | pool `:on_hand` |
| `CONFIRMED_LOST` | pool `:missing` | `system/lost` |
| `DISPOSAL` | pool `:missing` | `external/disposal` |

Tiga aturan di tabel itu layak dibaca dua kali:

1. **Hanya lantai toko yang bisa menjual.** `is_saleable()`
   ([`place.rs:249`](../backend/src/cloud/domain/place.rs)) benar hanya untuk
   `StoreFloor` dengan state `Normal`. Gudang toko tidak menjual; barang
   `missing` tidak menjual.
2. **Barang hilang tidak bisa langsung dibuang atau dianggap lost dari rak.**
   `CONFIRMED_LOST` dan `DISPOSAL` hanya berangkat dari `:missing`. Artinya
   selalu ada satu langkah di mana seseorang menyatakan "tidak ketemu" sebelum
   ada yang menyatakan "hilang". Dua pernyataan, dua orang, dua waktu.
3. **Perpindahan antar-toko tidak ada.** `normal_pool_transition`
   ([`movement.rs:281`](../backend/src/cloud/domain/movement.rs)) mensyaratkan
   `a == b` pada setiap pasangan toko. Barang dari toko 07 ke toko 08 harus
   lewat DC, dan hari ini bahkan jalur itu pun tidak bisa dieksekusi di gudang
   yang sebenarnya — lihat **G4**.

Rantai `NORMAL_MOVE` yang sah di pusat:

```text
dc.pending.unidentified ──▶ dc.pending.untagged ──▶ dc.warehouse
                                                         │
                                    ┌────────────────────┤
                                    ▼                    ▼
                          dc.outbound.picking   dc.outbound.picked.<toko>
                                    │                    │
                                    ├──▶ kembali ke rak  │
                                    └────────────────────┤
                                                         ▼
                                          dc.outbound.packed.<toko>
                                                         ▼
                                        dc.outbound.shipment.<toko>
                                                         ▼
                                      dc.outbound.in-transit.<toko>
                                                         ▼
                                              <toko>.warehouse
                                                    ▲   ▼
                                                  <toko>.floor
                                                         ▼
                                                  <toko>.reject
                                                         ▼
                                              dc.reject.<toko> ──▶ dc.reject.dc
```

**As-is — dan ini yang penting:** **tata bahasa di atas adalah tata bahasa
PUSAT, dan gudang yang sebenarnya tidak memakainya.** Edge punya daftarnya
sendiri, dengan tiga cause tambahan, satu tahap tambahan, dan beberapa larangan
yang berbeda. Perbandingan lengkapnya di
[inventory-fleet.md](./inventory-fleet.md) §7. Ringkasnya:

| | Pusat | Edge |
|---|---|---|
| Cause | 12 | 15 (`STORE_RECEIVE`, `IDENTIFICATION`, `TAGGING`) |
| Tahap outbound | 4 | 5 (`loaded` di antara shipment dan in-transit) |
| Tujuan `picked.<toko>` | sah | tidak pernah dituju — karton diisi langsung |
| `RETURN_TO_DC` | sah | **selalu ditolak** ([`movement.rs:258`](../backend/src/edge/domain/inventory/movement.rs)) |
| `FOUND` | boleh pindah pool | wajib pool yang sama |
| Nama DC | `dc` | `dc-01` |

---

## 6. Angka yang boleh dibaca

**Target.**

> Dari saldo netral ledger diturunkan enam angka, dan hanya enam.

```text
stock      = normal + missing            berapa potong yang secara fisik
                                         menjadi tanggung jawab pool ini
allotted   = yang masih harus masuk      None kalau pool ini tidak bisa
             karton dari pool ini        menjadi sumber janji
on_hand    = max(normal − allotted, 0)   yang masih boleh dibelanjakan
shortfall  = max(allotted − normal, 0)   sejauh mana janji melampaui barang
missing    = saldo state :missing
observed   = EPC berbeda yang TERBACA    bukan angka ledger — lihat di bawah
```

**`Stock = On Hand + Allotted + Missing` sudah bukan invariant.** Persamaan itu
hanya berlaku selama sebuah janji tidak mungkin melampaui rak yang dijanjikan,
dan gudang berhak mengetahui bahwa ia tidak bisa menepati janji. Kelebihannya
dilaporkan sebagai `shortfall`, dan `on_hand` berhenti di nol — karena layar
yang menampilkan kemeja berjumlah minus seratus lima puluh tidak memberi tahu
siapa pun apa pun. Yang berlaku sekarang:

```text
stock + shortfall = on_hand + allotted + missing
```

dan itu di-`debug_assert` di dalam fungsinya sendiri
([`inventory.rs:63`](../backend/src/cloud/domain/inventory.rs)), karena setiap
layar menjumlahkan angka-angka ini.

`allotted` bernilai `None` — **bukan nol** — pada pool yang memang tidak bisa
menjadi sumber janji. "Tidak ada yang dijanjikan dari sini" dan "janji bukan
konsep di sini" adalah dua jawaban berbeda, dan keduanya tidak boleh digambar
sebagai `0`.

**`observed` bukan stok.** Ia adalah jumlah EPC berbeda yang terbaca oleh
handheld di pool itu dalam jendela waktu tertentu (default 24 jam,
`OBSERVED_WINDOW_HOURS`). Ia berdiri di sebelah `stock` di layar yang sama
sambil mengukur hal yang sama sekali lain: yang satu apa yang tercatat, yang
lain apa yang terbaca. Lihat [inventory-count.md](./inventory-count.md) §7.

**As-is.** Fungsi `InventoryBalance::project` ada **dua kali, byte per byte
identik**: [`cloud/domain/inventory.rs`](../backend/src/cloud/domain/inventory.rs)
dan [`edge/domain/inventory/balance.rs`](../backend/src/edge/domain/inventory/balance.rs).
Dua salinan satu aturan, dijaga sejalan dengan tangan. → **G1**

---

## 7. Proyeksi, replay, repost

**Target.**

> Proyeksi adalah kenyamanan. Ledger adalah kebenaran. Kalau keduanya berbeda,
> proyeksi yang salah, selalu.

Tiga alat, dan pembagian tugasnya tajam:

| Alat | Apa yang dilakukan | Menulis ledger? |
|---|---|---|
| `POST /api/v1/inventory/replay` | melipat ulang ledger, membandingkan dengan proyeksi, melaporkan selisih | **tidak** |
| `POST /api/v1/inventory/repost` | membuang proyeksi dalam scope, membangun ulang dari movement | **tidak** |
| `GET /api/v1/inventory/as-of` | saldo pada satu titik waktu di masa lalu | tidak |

`run_repost` ([`control.rs:145`](../backend/src/cloud/postgres/control.rs))
menghitung jumlah fakta ledger sebelum dan sesudah, dan **membatalkan transaksi
kalau angkanya berubah** — jaminan bahwa perbaikan proyeksi tidak pernah
menciptakan sejarah. Ia juga menolak kalau setelah dibangun ulang masih ada
selisih, karena repost yang tidak bisa mereproduksi ledger bukan perbaikan
melainkan penyembunyian.

`as_of` yang lebih dari dua detik lalu menandai jawabannya `read_only: true`
([`queries.rs:151`](../backend/src/cloud/postgres/queries.rs)): angka itu
sejarah, dan tidak ada yang boleh diposting terhadapnya.

---

## 8. Yang dijaga saat menulis

Empat pemeriksaan berjalan pada setiap baris movement, dan masing-masing ada
karena satu hal yang pernah atau bisa salah:

1. **Saldo cukup.** Kalau `from` adalah place perusahaan, saldo ledger di sana
   dihitung ulang di dalam transaksi
   ([`movements.rs:394`](../backend/src/cloud/postgres/movements.rs)) —
   **dari movement, bukan dari proyeksi.** Proyeksi yang basi tidak boleh
   mengizinkan pengeluaran yang tidak ada barangnya.
2. **`UNIT` selalu satu.** Kuantitas ≠ 1 pada subject bertipe `UNIT` ditolak.
3. **Satu penempatan per tag.** §2.
4. **Provenance outbound.** Setiap baris yang menyentuh `dc.outbound.*` harus
   bisa menunjuk baris allotment yang membawanya
   ([`movements.rs:406`](../backend/src/cloud/postgres/movements.rs)).

Dan satu larangan yang pantas disebut karena bunyinya aneh sampai alasannya
dibaca: endpoint movement manual **menolak** perpindahan
`dc.warehouse:on_hand → dc.outbound.picked.<toko>`
([`movements.rs:36`](../backend/src/cloud/postgres/movements.rs)). Bukan karena
perpindahannya salah, tetapi karena perpindahan itu harus atomik dengan counter
allotment yang ikut bergerak. Dua tulisan terpisah berarti satu saat di mana
gudang dan janji tidak sepakat.

---

## 9. Dua buku besar di satu database

Ini bagian yang paling mudah salah dibaca, jadi disebut di sini walau miliknya
[inventory-fleet.md](./inventory-fleet.md):

```text
movement + inventory_projection        ledger PUSAT sendiri.
                                       Dipakai untuk site yang tidak punya
                                       node edge terdaftar.

edge_movement + edge_movement_line     FAKTA dari node edge. Divalidasi
+ edge_inventory_fact_position         dengan tata bahasa EDGE, disimpan
                                       terpisah, tidak pernah dilebur ke
                                       tabel `movement`.

edge_inventory_pool                    checkpoint saldo agregat dari node
                                       edge. Observasi, bukan movement.
```

Satu site dimiliki oleh satu pihak saja, dan yang memutuskan adalah
`sync_origin_credential.inventory_enabled`. Sebuah query yang menjumlahkan
`movement` dan `edge_movement` sekaligus akan menghitung gudang yang sama dua
kali — itu persis bug yang ditutup pada 2026-09-05 dan 2026-09-09.

---

## 10. Stok tidak punya nilai uang

**Target.**

> Setiap potong stok tahu berapa harga belinya, dan setiap peristiwa yang
> menaikkan atau menurunkan stok punya konsekuensi di buku besar akuntansi.

**As-is.** Tidak satu pun dari itu benar.

- `inventory_subject` di pusat tidak punya kolom biaya dan tidak pernah
  di-`ALTER` sejak `0001`.
- Bagan akun sudah menyediakan kuncinya —
  `inventory`, `goods_in_transit`, `cogs`, `stock_loss`
  ([`ledger.rs:290`](../backend/src/cloud/postgres/ledger.rs)) — dan pemetaan ke
  akun klien sudah ada.
- **Yang memakai kunci itu hanya satu**: `payables.rs:921`, saat supplier bill
  diposting. `cogs`, `stock_loss` dan `goods_in_transit` tidak dipakai oleh kode
  mana pun.

Artinya, hari ini:

| Peristiwa | Ledger stok | Buku besar |
|---|---|---|
| Barang diterima | bertambah | tidak ada apa-apa sampai bill diposting |
| Barang terjual | berkurang | pendapatan tercatat, **harga pokok tidak** |
| Stock opname kurang | pindah ke `missing` | tidak ada apa-apa |
| Barang dinyatakan lost | keluar ke `system/lost` | tidak ada apa-apa |
| Barang dibuang | keluar ke `external/disposal` | tidak ada apa-apa |

→ **G2**. Ini bukan detail teknis: laporan laba rugi yang dihasilkan sistem ini
tidak mengandung harga pokok penjualan, dan kehilangan barang tidak pernah
menjadi biaya.

---

## 11. Daftar gap

| | Gap | Bukti | Perbaikan |
|---|---|---|---|
| **G1** | `InventoryBalance::project` ada dua salinan identik | `cloud/domain/inventory.rs` vs `edge/domain/inventory/balance.rs` | Satu crate bersama, seperti `pricing-engine` |
| **G2** | Stok tidak pernah menjadi angka di buku besar: tidak ada COGS, tidak ada stock loss, tidak ada goods-in-transit | hanya `payables.rs:921` yang memakai kunci semantik persediaan | Putuskan metode biaya, lalu posting dari cause movement |
| **G3** | Tata bahasa pusat dan tata bahasa edge berbeda, dan yang menjalankan gudang adalah edge | §5, [fleet](./inventory-fleet.md) §7 | Satu tata bahasa, diparameterkan per site |
| **G4** | Toko tidak bisa mengembalikan barang ke DC di gudang sungguhan | `MovementCause::ReturnToDc => false` ([edge `movement.rs:258`](../backend/src/edge/domain/inventory/movement.rs)) | Aktifkan transisinya, atau nyatakan retur toko sebagai proses claim seperti transfer |
| **G5** | `FOUND` di pusat boleh memindahkan barang ke pool mana pun | `resolve_missing_found` menerima `destination_pool_id` bebas ([`queries.rs:2375`](../backend/src/cloud/postgres/queries.rs)); `validate_transition` tidak menuntut pool sama | Samakan dengan edge: `FOUND` kembali ke pool asalnya; perpindahan sesudahnya adalah movement tersendiri |
| **G6** | Barang di `dc.outbound.in-transit.<toko>` tidak pernah keluar dari ledger DC | tidak ada transisi keluar di [edge `movement.rs:341`](../backend/src/edge/domain/inventory/movement.rs) | Lihat [fleet](./inventory-fleet.md) §8 — ini akibat dari dua ledger, bukan sebab |
| **G7** | Topologi site dan pool hidup di dalam migrasi `0002_demo_seed.sql` | `backend/migrations/postgres/0002_demo_seed.sql:1` | Pisahkan seed demo dari topologi; toko baru adalah data, bukan migrasi |
| **G8** | `dc.outbound.picking` ada di enum pusat, tidak ada barisnya di database | tidak ada `INSERT` untuk id itu di seluruh `migrations/postgres/` | Turunkan barisnya, atau hapus varian itu dari enum pusat dan akui picking hanya milik edge |

---

## 12. Keputusan terbuka

1. **Metode biaya persediaan.** Rata-rata bergerak, FIFO per unit, atau harga
   beli yang menempel pada EPC-nya sendiri? Yang ketiga paling jujur untuk
   fashion dan paling mahal untuk dihitung. Ini prasyarat **G2** dan tidak bisa
   diputuskan oleh kode.
2. **Siapa pemilik tata bahasa perpindahan.** Rekomendasi: edge, karena edge
   yang menjalankan gudang; pusat mengikuti. Alternatifnya satu crate bersama
   yang dipakai keduanya, seperti `pricing-engine` — lebih benar, lebih lama.
3. **Apakah pusat masih perlu bisa menjalankan gudang sendiri.** Hari ini
   ledger pusat adalah cadangan untuk site tanpa node edge, dan dua gap di atas
   (**G3**, **G8**) adalah harga dari mempertahankan jalur kedua yang tidak
   pernah dijalankan siapa pun. Kalau jawabannya tidak, banyak hal menjadi
   sederhana; kalau ya, tata bahasanya harus disamakan.
