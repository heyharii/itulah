# Allotment V1 — Acuan Utama

Baseline: **1.4 — 12 September 2026 · FROZEN**
Status: model domain **dibekukan**. Implementasi tertinggal di belakang revisi ini — §13 menyebut tepat apa yang sudah hidup, apa yang harus dibongkar, dan apa yang belum dikerjakan.

Dokumen ini memiliki **ownership, lifecycle, commitment, fulfillment stage, semantik penerimaan, Close Short, batas otorisasi, dan kontrak UI**. Detail eksekusi fisik — transisi pool, mekanika RFID, koli/loading, implementasi dispatch — dimiliki [DISTRIBUTION-V1-FREEZE.md](../DISTRIBUTION-V1-FREEZE.md); di sini ia hanya disebut sejauh perlu untuk menjelaskan batas. **Dua dokumen, bukan dua sumber kebenaran.**

Aritmetikanya hidup di `backend/src/cloud/domain/commitment.rs` beserta test-nya.

```text
Allotment V1          sumber kebenaran untuk business semantics
Distribution Freeze   sumber kebenaran untuk execution semantics
Kode + test           implementasi dan verifikasi yang bisa dijalankan
```

**Jika dokumen domain, execution freeze, implementasi, atau test bertentangan, perubahan dihentikan dan perbedaannya direkonsiliasi.** Business semantics tidak berubah hanya karena implementasi saat ini berbeda.

Kalau Anda hanya punya satu menit: baca §2 (dua bahasa), §3 (tujuh stage), §14 (larangan).

---

## 1. Apa itu Allotment

Allotment adalah **keputusan MD**: toko mana menerima barang apa, berapa banyak. Ia bukan pesanan pembelian, bukan pesanan pelanggan, bukan perintah kerja gudang, dan bukan pool inventory.

```text
Pemilik              Merchandising (MD)
Dibuat               langsung ACTIVE — tidak ada Draft di domain
Selesai HANYA oleh   Store Receive yang sungguh terjadi
Alternatif selesai   MD Close Short
Tidak diselesaikan   Picking, Packing, Shipment, Dispatch
Tidak ada klaim      tidak ada reservasi pick/pack/pekerja, dalam bentuk apa pun
```

Dua buku besar, satu titik temu:

```text
Ledger inventory   memindahkan barang, tidak menyentuh janji
Commitment         menjanjikan barang, tidak memindahkan apa pun
Titik temu         PACK — di sinilah sepotong barang terikat ke satu toko
```

---

## 2. Dua bahasa yang tidak boleh dicampur

```text
Inventory Pool
= lokasi / tahap FISIK barang

Allotment Fulfillment Stage
= posisi KUANTITAS di dalam pemenuhan janji MD
```

Keduanya sering bergerak bersamaan, dan justru karena itu orang menyangka keduanya satu hal. Bukan:

| Inventory Pool | Allotment Fulfillment Stage |
|---|---|
| Storage | To Pack |
| Picked (pick area) | **To Pack** |
| Packed | At Packed |
| Shipment | At Shipment |
| In Transit | At In Transit |
| Diterima toko | Received |

Picking-lah yang membuktikan keduanya berbeda:

```text
Inventory:   Storage → Picked      (barang pindah)
Allotment:   To Pack → To Pack     (janji tidak bergerak)
```

Seorang picker mengambil SKU dan sejumlah barang. Untuk siapa barang itu baru diputuskan di meja pengemasan. Karena itu pick area tidak punya atribusi toko, dan kolom `Alloted` di pool tersebut adalah `—`, bukan nol.

> **Istilah `bucket` tidak dipakai sebagai bahasa produk atau domain.** Ia boleh muncul di penjelasan matematis internal bila benar-benar membantu, tidak di layar, nama kolom, atau pembicaraan.

### ALT-INV-00 — Fulfillment Stage bukan pengganti Inventory Pool

Keduanya berjalan berdampingan sampai **serah terima**, lalu berpisah. Begitu shipment diserahterimakan ke toko, custody inventory-nya selesai: seluruh kuantitas yang diserahkan menjadi tanggung jawab Store Warehouse. Yang tidak ditemukan menjadi `Missing` **di sana** — bukan tetap menggantung di `In Transit`.

```text
Shipment 100 diserahterimakan

INVENTORY                        ALLOTMENT
Store Warehouse                  Received        98
  Normal   98                    Selisih          2   ← menunggu penyelesaian
  Missing   2                    To Receive       2
  Stock   100                    Status      ACTIVE
```

Dua kebenaran yang berbeda, dan keduanya benar karena menjawab pertanyaan yang berbeda:

```text
Allotment      "berapa yang berhasil memenuhi janji?"          → 98
Inventory      "100 unit itu sekarang tanggung jawab lokasi mana?" → Store Warehouse
Observation    "berapa yang benar-benar ditemukan?"            → 98
```

Konsekuensinya ditulis terang-terangan di §3: **tidak setiap potong `To Receive` punya stage fisik.** Dua potong di atas tidak berada di `At In Transit` — perjalanannya sudah selesai — dan tidak di `Received` — toko tidak menerimanya. Memaksakan salah satunya akan berbohong.

---

## 3. Tujuh Fulfillment Stage, dan satu yang bukan stage

**Grain-nya adalah baris allotment** (satu SKU, satu tujuan). Toko, artikel, pool, site, dan seluruh fleet adalah SUM di atas baris — tidak pernah rumus tersendiri.

```text
   TO_PACK ── pack ──► AT_PACKED ── ship ──► AT_SHIPMENT ── load ──► AT_LOADED
      ▲   ▲               │   ▲                  │   ▲                   │
      │   └─── unpack ────┘   └──── unship ──────┘   └──── unload ───────┤
      │                                                                  │
      │                                                              depart
      │                                                                  ▼
      ├──────────── lost (Inventory) ─────────────────────────── AT_IN_TRANSIT
      │                                                                  │
      │                                                       serah terima
      │                                                                  ▼
      ├──────────── lost (Inventory) ──────────── ( selisih penerimaan )
      │                                                                  │
  close short (MD)                                                  diterima
      ▼                                                                  ▼
  CLOSED_SHORT                                                       RECEIVED
```

```text
Terminal:              RECEIVED · CLOSED_SHORT
Masih harus dipenuhi:  TO_PACK · AT_PACKED · AT_SHIPMENT · AT_LOADED · AT_IN_TRANSIT
Bukan stage:           selisih penerimaan
```

### ALT-INV-01 — Terhitung tepat sekali, tidak selalu di sebuah stage

Aturan lama — "setiap potong selalu berada tepat di salah satu tujuh stage" — terlalu kaku, dan kasus yang mematahkannya adalah kasus yang paling sering terjadi: selisih saat penerimaan. Yang berlaku sekarang:

> Setiap potong yang dijanjikan MD **terhitung tepat sekali**: di salah satu tujuh stage, **atau** pada satu selisih penerimaan yang belum diselesaikan.

**Selisih penerimaan bukan fulfillment stage.** Ia adalah rujukan allotment ke satu kasus Inventory yang terbuka di tujuan — kuantitas yang custody-nya sudah berpindah tetapi tidak terhitung saat serah terima. Lokasi fisiknya dimiliki Inventory (`Store Warehouse · Missing`), bukan oleh allotment.

Ia ada di dalam aritmetika karena harus: tanpa itu `To Receive` 2 tidak punya penjelasan apa pun, dan baris di layar berhenti menjumlah. Ia tidak ada di dalam pipeline stage, karena ia bukan tahap perjalanan (§12).

### Counter tersimpan — hanya naik, tidak pernah diedit turun

| Domain | Arti | Ditulis oleh |
|---|---|---|
| `original_alloted` | keputusan MD, dikunci saat ACTIVE | MD |
| `packed_total` | pernah masuk karton (mengikat ke toko) | Distribution |
| `unpacked_total` | karton dibuka lagi, barang kembali ke pick area | Distribution |
| `shipment_total` | koli tersegel masuk shipment | Distribution |
| `unshipped_total` | koli ditarik dari shipment | Distribution |
| `loaded_total` | naik ke kendaraan yang belum berangkat | Distribution |
| `unloaded_total` | diturunkan lagi sebelum berangkat | Distribution |
| `in_transit_total` | kendaraan berangkat | Distribution |
| `handed_over_total` | custody berpindah ke toko saat serah terima | Store |
| `received_total` | toko **benar-benar menerima** | Store |
| `lost_packed_total` | Inventory memastikan hilang saat At Packed | Inventory |
| `lost_in_transit_total` | Inventory memastikan hilang tanpa pernah diserahterimakan | Inventory |
| `lost_at_store_total` | Inventory memastikan selisih penerimaan itu hilang | Inventory |
| `closed_short_total` | MD menyerah atas sisa | MD |

Empat belas counter. Koreksi adalah fakta tersendiri (`unpacked_total` melawan `packed_total`), bukan pengurangan — pengurangan menghapus bukti bahwa pembalikan pernah terjadi, dan membuat dua sejarah berbeda memenuhi satu baris yang sama.

`handed_over_total` terpisah dari `received_total` karena keduanya fakta yang berbeda, dan selisihnya persis yang sedang dipersoalkan. Ia juga yang membedakan dua kejadian yang terlihat sama di kertas:

```text
Sopir membawa balik 2      handed_over 98 · received 98   → At In Transit 2
Hilang di pintu toko       handed_over 100 · received 98  → selisih penerimaan 2
```

### Turunan — tidak pernah disimpan

```text
to_pack       = original_alloted + unpacked_total
                                 + lost_packed_total + lost_in_transit_total + lost_at_store_total
                                 − packed_total − closed_short_total
at_packed     = packed_total + unshipped_total − unpacked_total − shipment_total − lost_packed_total
at_shipment   = shipment_total + unloaded_total − unshipped_total − loaded_total
at_loaded     = loaded_total − unloaded_total − in_transit_total
at_in_transit = in_transit_total − handed_over_total − lost_in_transit_total
receiving_gap = handed_over_total − received_total − lost_at_store_total

to_receive    = original_alloted − received_total − closed_short_total
```

### ALT-INV-02 — Invariant tunggal

```text
to_pack + at_packed + at_shipment + at_loaded + at_in_transit + receiving_gap
        + received + closed_short  =  original_alloted
```

Berlaku by construction: setiap event memindahkan satu potong dari satu tempat ke tempat lain. Diperiksa sebagai assert hidup, di build release juga.

Konsekuensinya, bukan aturan kedua:

```text
to_receive = to_pack + at_packed + at_shipment + at_loaded + at_in_transit + receiving_gap
```

### ALT-INV-03 — `To Receive` hanya turun karena dua hal

```text
Store Receive      (barang sungguh diterima)
MD Close Short     (MD menyerah)
```

Tidak ada yang lain. Tidak manifest, tidak dispatch, tidak serah terima, tidak Missing, tidak Lost.

### ALT-INV-04 — Tidak ada tempat boleh negatif

Inilah yang **menggantikan** `closed_short + packed ≤ original_alloted`: invariant lama salah untuk kasus biasa (100 dikemas, 2 hilang lalu diganti → `packed_total` 102 lawan 100). Tiga penjaga yang paling sering menyala:

```text
to_pack ≥ 0        MD hanya menyerahkan apa yang ada di To Pack
receiving_gap ≥ 0  toko tidak dapat menerima lebih dari yang diserahterimakan
at_in_transit ≥ 0  tidak dapat diserahterimakan lebih dari yang berangkat
```

Ditegakkan tiga lapis — proyeksi domain menolak, CHECK database menolak baris, route menolak perintah.

### ALT-INV-05 — Angka stage tidak pernah bisa dijumlah ganda

Karena tiap angka adalah satu tempat, dan tiap potong terhitung di satu tempat. Inilah alasan stepper dibuang: satu allotment berdiri di beberapa stage sekaligus.

---

## 4. Event → counter

### Maju

| Event | Counter | Perpindahan stage |
|---|---|---|
| `ALLOTMENT_CREATED` | `original_alloted` | → TO_PACK |
| `ALLOTMENT_PACKED` | `packed_total` | TO_PACK → AT_PACKED |
| `ALLOTMENT_SHIPMENT` | `shipment_total` | AT_PACKED → AT_SHIPMENT |
| `ALLOTMENT_LOADED` | `loaded_total` | AT_SHIPMENT → AT_LOADED |
| `ALLOTMENT_IN_TRANSIT` | `in_transit_total` | AT_LOADED → AT_IN_TRANSIT |
| `ALLOTMENT_HANDED_OVER` | `handed_over_total` | AT_IN_TRANSIT → selisih penerimaan |
| `ALLOTMENT_RECEIVED` | `received_total` | selisih penerimaan → RECEIVED |

Serah terima dan penerimaan adalah dua fakta, dan `Confirm Receive` di toko menerbitkan keduanya sekaligus dalam satu transaksi: 100 diserahkan, 98 diterima. Sisanya tinggal sebagai selisih.

`ALLOTMENT_RECEIVED` punya **dua** pemicu, dan hanya dua: `Confirm Receive` di toko, dan `Found` milik Inventory atas Missing yang berasal dari selisih penerimaan — custody-nya sudah pindah kemarin, jadi toko tidak diminta mengonfirmasi untuk kedua kalinya (ALT-INV-09).

### Pembalikan — barang fisik kembali ke tahap sebelumnya

| Event | Counter | Perpindahan stage |
|---|---|---|
| `ALLOTMENT_UNPACKED` | `unpacked_total` | AT_PACKED → TO_PACK |
| `ALLOTMENT_UNSHIPPED` | `unshipped_total` | AT_SHIPMENT → AT_PACKED |
| `ALLOTMENT_UNLOADED` | `unloaded_total` | AT_LOADED → AT_SHIPMENT |

**Jangan pernah mengedit atau menghapus event historis untuk "mengoreksi" pergerakan.** Pakai primitive di atas — dan **jangan memakai mesin pembalikan ini untuk membangun workflow exception**. Tiga hal berbeda:

```text
Reversal   barang fisik kembali ke tahap sebelumnya
Missing    barang belum ditemukan — belum ada keputusan
Lost       Inventory memastikan barang tidak akan datang
```

### Kehilangan — hasil keputusan Inventory

Satu sebab saja: Inventory menyatakan `Lost`. Tidak ada sisi kedua untuk penolakan toko, karena toko tidak menolak (§5).

| Event | Counter | Perpindahan stage | Sebab |
|---|---|---|---|
| `ALLOTMENT_LOST_PACKED` | `lost_packed_total` | AT_PACKED → TO_PACK | hilang di DC setelah terikat toko |
| `ALLOTMENT_LOST_IN_TRANSIT` | `lost_in_transit_total` | AT_IN_TRANSIT → TO_PACK | tidak pernah sampai; tidak pernah diserahterimakan |
| `ALLOTMENT_LOST_AT_STORE` | `lost_at_store_total` | selisih penerimaan → TO_PACK | selisih saat serah terima dinyatakan hilang |

### Penutupan — keputusan MD

| Event | Counter | Perpindahan stage |
|---|---|---|
| `ALLOTMENT_CLOSED_SHORT` | `closed_short_total` | TO_PACK → CLOSED_SHORT |

**`ALLOTMENT_PICKED` dipensiunkan.** Tidak ada event bisnis semacam itu: picking bebas hanya menulis fakta inventory dan tidak pernah menyebut allotment.

---

## 5. Semantik penerimaan

### ALT-INV-06 — `Received` adalah kuantitas yang sungguh diterima toko

Bukan kuantitas manifest, bukan yang dikirim, bukan yang di-dispatch, bukan yang diharapkan.

```text
Alloted        100
Shipped        100
Manifest       100 diharapkan
Toko konfirmasi 98
```

Allotment:

```text
Received        98
Selisih          2        ← custody sudah pindah, belum terhitung
To Receive       2
Status      ACTIVE
```

Inventory, untuk kejadian yang sama:

```text
Store Warehouse   Normal 98 · Missing 2 · Stock 100
```

**Jangan pernah menulis `Received 100` hanya karena manifest mengatakan 100.** Dua unit yang belum ditemukan adalah discrepancy Inventory/Receiving.

### ALT-INV-07 — Toko tidak menolak allotment

Pengiriman DC → toko adalah **perpindahan internal**, bukan kiriman pemasok. Tidak ada pihak lawan komersial yang boleh menolak: menolak alokasi berarti membatalkan keputusan MD, dan itu milik MD (Close Short), bukan toko.

Yang toko lakukan saat serah terima hanya satu: **menyatakan apa yang benar-benar sampai**.

```text
Manifest        100
Sungguh ada      98
Toko konfirmasi  98
```

Selisih 2 bukan penolakan — ia **selisih penerimaan**, dan kasusnya milik Inventory (§6). Tidak ada tombol "tolak" di layar penerimaan toko, dan tidak ada counter untuk penolakan.

Tiga hal yang sering dikira penolakan, dan bukan:

| Kejadian | Sebenarnya |
|---|---|
| Barang kurang dari manifest | discrepancy penerimaan — Inventory (§6) |
| Kiriman berhenti di toko yang salah | validasi: penerimaan untuk tujuan lain **ditolak sistem**, bukan keputusan bisnis; tidak ada serah terima, barang tetap `At In Transit` untuk toko tujuannya |
| Barang sampai tetapi tidak diinginkan toko | tetap diterima; keberatannya adalah Returns atau keputusan alokasi MD, bukan penerimaan |

V1 **tidak memiliki field `condition`/`grade`**. Barang yang tidak layak jual direpresentasikan lewat Inventory Pool: **`Store Reject`** (ALT-D03).

### ALT-D01 — Satu aksi di toko: `Confirm Receive`

Tidak ada dua aksi terpisah "handover" dan "receive", dan toko tidak mengetik dua kuantitas. Satu layar, satu perbuatan, dua fakta yang diterbitkannya.

**`handed_over_total` diturunkan dari apa yang benar-benar diserahterimakan** — koli/shipment yang discan di toko — **bukan dari manifest.**

```text
Shipment = 10 koli = 100 pcs

10 koli diturunkan dan discan      handed_over = 100
  verifikasi menemukan 98          received    = 98      → selisih 2
  (tidak ada sisa di In Transit)

 9 koli diturunkan, 1 dibawa sopir handed_over = isi 9 koli
  sisanya belum berpindah custody  → tetap At In Transit, urusan Distribution
```

Per baris allotment, `handed_over` diturunkan dari isi koli yang benar-benar diserahkan untuk baris itu. Fallback manual boleh menangkap kuantitas yang benar-benar diturunkan di layar yang sama — tetapi tetap satu workflow `Confirm Receive`.

### ALT-D02 — Kasus Missing dibuka otomatis

Tidak ada tombol `[Create discrepancy]`. Bila saat `Confirm Receive` ternyata `handed_over > received`, sistem otomatis mencatat `Missing` sebesar selisihnya di Store Warehouse dan **membuka/menautkan kasus Inventory**, pemiliknya Inventory.

```text
handed_over = 100
received    =  98
→ Missing 2 di Store Warehouse
→ kasus Inventory terbuka otomatis, pemilik Inventory
```

Toko hanya mencatat fakta; Inventory yang menyelesaikan. Selisih yang menunggu seseorang menekan tombol adalah selisih yang hilang dari pandangan.

### ALT-D03 — Barang rusak tetap `Received`; kondisinya urusan Inventory

V1 **tidak** membuat model grade/condition. Yang dipakai adalah pool Inventory yang sudah ada: **`Store Reject`**.

`Store Reject` bukan berarti toko menolak barang. Custody sudah berpindah, barang **sudah diterima**, lalu setelah diterima ia diklasifikasikan ke pool itu.

```text
handed_over  100
ditemukan    100  →  98 normal · 2 tidak layak jual

ALLOTMENT                    INVENTORY — STORE 07
Alloted        100           Warehouse        98
Received       100           Store Reject      2
To Receive       0           ─────────────────────
Status    COMPLETED          Stock           100
```

V1 tidak menambah field `condition`/`grade`; yang dipakai adalah pool. Dan karena `Received` berarti barang benar-benar sampai ke toko, barang rusak **tetap** penerimaan bagi allotment. Inventory yang kemudian mengurus nasibnya — retur, pemusnahan, perbaikan — lewat workflow Inventory/Returns, dan **allotment tidak dibuka kembali**.

Aturannya sesederhana ini:

```text
DITEMUKAN & SKU benar          → Received
DITEMUKAN tetapi rusak/reject  → Received, lalu pool Store Reject
TIDAK DITEMUKAN                → Missing → BUKAN Received
```

**SKU yang salah adalah kasus lain.** Unit yang datang tetapi bukan unit yang seharusnya memenuhi baris itu — SKU lain, EPC tak dikenal — **tidak boleh menambah `Received`** pada baris yang seharusnya. Baris itu tetap belum terpenuhi (selisihnya menjadi Missing), dan unit asing itu discrepancy Inventory tersendiri.

### Batas akhir Store Receive

```text
               SHIPMENT / IN TRANSIT
                       │
                 serah terima fisik
                       │
            ┌──────────┴──────────┐
            │                     │
      diserahterimakan       tidak diserahkan
            │                     │
            ▼                     ▼
      CUSTODY TOKO          tetap In Transit /
            │                urusan Distribution
      pemeriksaan fisik
            │
      ┌─────┼──────┐
      │     │      │
   Normal Rusak  Tidak ada
      │     │      │
      ▼     ▼      ▼
  Warehouse Reject Missing
      │     │      │
      └─ Received ─┘        Missing = BUKAN Received
            ▲                       = Inventory yang menyelesaikan
     terbukti ada secara fisik
```

### Kelebihan terima

Toko tidak dapat menerima lebih dari yang diserahterimakan kepadanya, dan tidak dapat diserahterimakan lebih dari yang berangkat (`ALT-INV-04`). Kelebihan fisik di pintu adalah temuan Inventory, bukan `Received` yang lebih besar. Allotment tidak pernah melaporkan `Received` melebihi `Alloted`.

---

## 6. Missing, Found, Lost — Inventory adalah resolver

### ALT-INV-08 — Kuantitas tetap di tempat terakhir yang sah sampai Inventory memutuskan

Di mana tempat itu, ditentukan oleh **custody**:

| Custody | Tempat kuantitas | Contoh |
|---|---|---|
| belum berpindah | stage terakhir yang diketahui | hilang di DC → tetap `At Packed`; truk tidak sampai → tetap `At In Transit` |
| sudah berpindah | selisih penerimaan | diserahterimakan 100, terhitung 98 → selisih 2 |

```text
Alloted        100
Diserahkan     100
Diterima        98

ALLOTMENT                    INVENTORY
Selisih          2           Store Warehouse
Received        98             Normal  98
To Receive       2             Missing  2
Status      ACTIVE             Stock  100
```

`Missing` berarti **barang belum ditemukan**, bukan barang yang sudah dinyatakan hilang. Selama itu berlaku, kuantitasnya tidak dikeluarkan dari `To Receive`, tidak mengubah status, dan tidak menjadi pekerjaan Distribution.

### ALT-D04 — Inventory memutuskan apa yang terjadi pada barang

```text
Found     barang ditemukan
Lost      barang dipastikan tidak akan datang
```

Nama kapabilitas persisnya mengikuti arsitektur Inventory yang ada; yang tidak bisa ditawar adalah **kepemilikannya**. MD tidak menentukan apakah barang hilang. MD hanya menentukan permintaan.

### `Found` — dan toko tidak diminta mengonfirmasi dua kali

Custody dua potong itu **sudah** di toko sejak serah terima; yang kurang hanya buktinya. Ketika Inventory menemukannya, bukti itu ada, dan itu cukup:

```text
Inventory: Found 2

Store Warehouse    Missing 2 → Present 2
Allotment          Receiving Difference 2 → Received 2

Received 100 · To Receive 0 → COMPLETED
```

Tidak ada `Confirm Receive` kedua. Memintanya akan berputar-putar dan bertentangan dengan keputusan bahwa resolver-nya Inventory.

### ALT-INV-09 — `Found` hanya menyentuh allotment bila Missing-nya berasal dari selisih penerimaan

Ini satu-satunya tempat Inventory menulis `received_total`, dan batasnya tegas:

| Asal Missing | `Found` melakukan | Allotment |
|---|---|---|
| selisih penerimaan pada baris yang masih `To Receive` | menyelesaikan Missing **dan** mengakui penerimaan | `Received` naik |
| stock count biasa, allotment sudah COMPLETED | menyelesaikan Missing saja | tidak tersentuh sama sekali |

```text
Allotment sudah COMPLETED 100
besok stock count menemukan Missing 2, lalu Found 2
→ Missing → Present, dan allotment tidak disentuh (ALT-INV-11)
```

### `Lost`

```text
Lost  ≠  Received
Lost  ≠  Closed Short
```

Toko masih kekurangan kuantitas itu, jadi commitment **otomatis kembali ke `To Pack`**:

```text
INVENTORY                         ALLOTMENT
Store Warehouse                   Received        98
  Missing 2 → Lost 2              Selisih 2 → 0
                                  To Pack          2
                                  To Receive       2
                                  Status      ACTIVE
```

Tiga tempat yang bisa dinyatakan hilang, dan ketiganya bermuara ke `To Pack`: `At Packed` (hilang di DC), `At In Transit` (tidak pernah diserahterimakan), dan selisih penerimaan (hilang di tujuan).

Perilaku bisnis default adalah **pemenuhan diteruskan dengan barang pengganti**. Tidak ada aksi MD yang diperlukan; Distribution sekarang punya 2 lagi untuk dipenuhi, dan 2 itu memblokir stok sumber lagi — memang benar, karena dua potong yang hilang tidak akan kembali ke rak.

---

## 7. Close Short — milik MD, dan hanya dari `To Pack`

Setelah `Lost`, bila MD **tetap ingin memenuhi**: tidak perlu aksi apa pun, Distribution menjalankan replacement. Bila MD **tidak ingin memenuhi**:

```text
Close Short 2
→ Received 98 · Closed Short 2 · To Receive 0 · Status CLOSED
```

### ALT-INV-10 — Close Short hanya mengambil dari `To Pack`

Bukan dari stage manapun yang barangnya masih bergerak. Alasannya bukan selera: bila MD menyerahkan kuantitas yang masih di jalan lalu barang itu sampai dan diterima toko, `received + closed_short` akan melampaui `original_alloted` dan invariant pecah.

Konsekuensi yang harus disadari: menyerah atas barang yang hilang **menunggu keputusan Inventory** (`Lost`) lebih dulu. Itu disengaja — MD tidak boleh menyerah atas barang yang mungkin masih datang. Kasus yang menggantung adalah masalah SLA penyelesaian Inventory, bukan alasan membuat jalur kedua.

---

## 8. Status dan lifecycle

```text
to_receive > 0                                → ACTIVE
to_receive == 0  dan  closed_short_total == 0 → COMPLETED
to_receive == 0  dan  closed_short_total  > 0 → CLOSED
```

Tiga cabang, saling lepas dan menutupi semua kemungkinan. Missing yang belum diselesaikan tidak membutuhkan status tersendiri karena kuantitas terkait tetap termasuk `To Receive` — baik ketika ia masih berada di sebuah fulfillment stage, maupun ketika ia berada pada selisih penerimaan yang belum diselesaikan.

### ALT-INV-11 — Allotment yang sudah selesai tidak pernah dibuka kembali

```text
Alloted 100 · Received 100 · COMPLETED
Besok toko menghitung dan menemukan Missing 2
```

Itu murni urusan Inventory. **Jangan** mengubah `Received 100 → 98`, jangan membuka kembali allotment, jangan menerbitkan `To Receive 2`. Pengembalian toko → DC setelah penerimaan selesai adalah workflow Returns yang baru, bukan pembalikan allotment lama.

> Allotment mencatat apakah kewajiban distribusi terpenuhi **pada saat serah terima**. Setelah serah terima final, kejadian inventory berikutnya tidak menulis ulang sejarah pemenuhan itu.

Secara teknis: tidak ada counter yang boleh bergerak pada baris yang allotment-nya sudah COMPLETED atau CLOSED.

### Status legacy dipetakan saat dibaca, tidak pernah ditulis lagi

| Tersimpan | Dibaca sebagai | Alasan |
|---|---|---|
| `ACTIVE` | ACTIVE | |
| `IN_PROGRESS` | ACTIVE | menyatakan gudang sudah mulai, bukan toko sudah terima |
| `DC_COMPLETED` | ACTIVE | terminal saat dispatch = status yang berbohong selama perjalanan |
| `COMPLETED` | COMPLETED | |
| `CANCELLED` | CLOSED | ejaan lama dari menyerah |
| `REJECTED` | CLOSED | |

`cancelled_quantity` dibaca sebagai `closed_short_total`. Header `CANCELLED`/`REJECTED` dibaca sebagai menyerah atas **seluruh sisa** — tanpa itu, allotment yang ditolak memblokir stok selamanya, karena penerimaan perintah oleh DC tidak lagi menggerbangi commitment.

### DC_FULFILLED adalah milestone, bukan status

```text
to_pack == 0  dan  at_packed == 0  dan  at_shipment == 0  dan  at_loaded == 0
```

Dinyatakan lewat stage, bukan lewat counter kumulatif. Rumus lama
(`in_transit_total + closed_short_total == original_alloted`) rusak begitu ada
penarikan: sesaat setelah Inventory menyatakan `Lost`, `in_transit_total` masih
100 dari 100 sementara DC justru baru saja mendapat 2 lagi untuk dikemas.

### Edge application state bukan stage

`PENDING · ACCEPTED · REJECTED` adalah keadaan **pengiriman perintah ke DC**, ditampilkan di samping status (`Active ⚠ Waiting for DC`), tidak pernah di dalam quantity pipeline.

---

## 9. Batas dengan Inventory: stok dan ketersediaan

```text
stock      = normal + missing                      (fisik, per pool — milik Inventory)
available  = max(eligible_supply − to_pack, 0)     ("On Hand" di UI)
shortfall  = max(to_pack − eligible_supply, 0)
```

### ALT-INV-12 — Yang memblokir rak adalah `to_pack`, bukan `to_receive`

Barang yang sudah dikemas sudah meninggalkan pool sumber; mengurangkan yang sekadar belum diterima menghitungnya dua kali.

```text
Storage 10.000 · alloted 1.500        → available 8.500 ✓
setelah 500 dikemas: Storage 9.500
  pakai to_pack    1.000 → 8.500 ✓
  pakai to_receive 1.500 → 8.000 ✗   (yang 500 terhitung dua kali)
```

### ALT-INV-13 — Supply dan commitment diukur pada scope yang sama

Janji atas warehouse dilayani dari warehouse **atau** dari pick area (§2). Keduanya supply, dan commitment dikurangkan dari pasangan itu tepat sekali. Mengukur warehouse saja membuat satu pagi kerja picking terlihat seperti satu pagi kehilangan barang.

### ALT-D05 — Dua pembacaan yang sengaja berbeda

| Layar | Scope | Alasan |
|---|---|---|
| Pohon pool (Inventory) | **per pool** | rak ini, barang ini — pembacaan fisik |
| Matrix New Allotment | **per site** | janji atas warehouse bisa dikemas dari pick area |

Angkanya akan berbeda, dan itu benar. Selisihnya adalah apa yang sedang dipegang picker.

### ALT-INV-14 — On Hand tidak pernah negatif

Kelebihannya menjadi `shortfall`. Gudang **boleh** menemukan bahwa ia tidak bisa menepati janji; itu dilaporkan, bukan ditolak, dan bukan jumlah baju negatif.

### ALT-INV-15 — Panduan pengemasan tidak aditif

Pick area dibagi bersama, jadi sepuluh baju yang diinginkan dua toko tetap sepuluh baju:

```text
AMAN:    min( Σ to_pack(sku) , pick area(sku) )
BAHAYA:  Σ per toko dari min( to_pack(toko,sku) , pick area(sku) )
```

`Can Pack Now` dan `Need More` adalah **panduan ketersediaan pada saat itu, tidak pernah reservasi**. Mekanika picking dan pengemasannya ada di freeze, bukan di sini.

---

## 10. Kepemilikan

| Domain | Memiliki | Aksi | Menulis counter |
|---|---|---|---|
| **MD** | permintaan | buat allotment (langsung ACTIVE), Close Short | `original_alloted`, `closed_short_total` |
| **Distribution / Operations** | pemenuhan `To Pack` | pick, pack, ship, load, depart; unpack, unship, unload | `packed`, `unpacked`, `shipment`, `unshipped`, `loaded`, `unloaded`, `in_transit` |
| **Inventory** | apa yang terjadi pada barang | kasus Missing, penyelesaian `Found` / `Lost` | `lost_packed`, `lost_in_transit`, `lost_at_store`, dan `received_total` **hanya** saat `Found` menyelesaikan selisih penerimaan (ALT-INV-09) |
| **Store** | serah terima dan penerimaan | satu aksi `Confirm Receive`: apa yang benar-benar diturunkan, dan apa yang benar-benar ditemukan (termasuk yang rusak) | `handed_over_total`, `received_total` |

Barang rusak dicatat toko sebagai klasifikasi pool Inventory (`Store Reject`) pada perbuatan yang sama, bukan sebagai counter allotment (ALT-D03, ALT-D10).

Jangan mencampur kepemilikan ini. Tiga kalimat yang merangkumnya:

```text
Inventory     menentukan apa yang terjadi pada barang
Distribution  memenuhi kuantitas yang masih To Pack
MD            membuat permintaan dan memutuskan Close Short
```

---

## 11. Otorisasi

```text
principal → otorisasi → aksi domain → audit principal
```

Route yang mengubah data tidak boleh memperlakukan `actor_id` di body sebagai wewenang. Aksi domain milik MD hanya satu: **`allotment.close_short`**. Penyelesaian barang (`Found`/`Lost`) adalah kapabilitas **Inventory**, dinamai mengikuti arsitektur Inventory.

`actor_id` tidak bisa langsung dibuang dari body — ia ada di dalam digest idempotency, jadi menghapusnya mengubah setiap digest dan mematahkan replay kunci yang sedang terbang. V1: otorisasi pada principal, tetap menerima `actor_id`, dan **tolak 403 bila ia berbeda dengan principal**.

Enum role Edge (`Cashier · Supervisor · Admin`) **tidak diperlebar**. Sampai arsitektur auth membawa kapabilitas bisnis, pemetaannya adalah detail transport saja — tidak pernah pernyataan bahwa Admin adalah MD.

---

## 12. Kontrak UI (MD)

```text
MD > Allotment

Active | Completed | Closed              ← status
Allotments | By store | By article       ← tampilan
```

**Daftar utama:** `Allotment · Created · Articles · Stores · Alloted · Received · To Receive · Status`. Tanpa `Progress %` generik sebagai metrik utama; bila progress ditampilkan, artinya `Received / Alloted`.

**Quantity pipeline, bukan stepper.**

```text
MD:          To Pack · Packed · Shipment · In Transit · Received
Operations:  To Pack · Packed · Shipment · Loaded · In Transit · Received
```

### ALT-D06 — Loaded dilebur untuk MD, tidak pernah dibuang

```text
Shipment (MD) = at_shipment + at_loaded
```

Kalau dibuang begitu saja, barisnya berhenti menjumlah ke `To Receive` dan MD melihat selisih hantu.

### ALT-D07 — Selisih penerimaan muncul di totals, bukan di pipeline

Pipeline stage tetap lima kolom untuk MD. Selisih penerimaan bukan tahap perjalanan, jadi ia tidak menjadi kolom keenam — tetapi ia harus terlihat, karena tanpa itu baris berhenti menjumlah:

```text
Alloted                    100
──────────────────────────────
To Pack                      0
Packed                       0
Shipment                     0
In Transit                   0
Received                    98
Selisih penerimaan           2   ⚠ kasus Inventory
──────────────────────────────
To Receive                   2
```

Angkanya ada di ladder totals; lencana kasusnya tetap overlay (ALT-D08).


### ALT-D08 — Attention adalah indikator, bukan stage

MD boleh melihat:

```text
⚠ Missing 2
⚠ Receiving discrepancy 2
⚠ Shortfall
⚠ Waiting for DC
```

Semuanya rujukan kasus milik domain lain — **jangan pernah masuk ke quantity pipeline**, jangan menjadi kolom kuantitas yang dijumlahkan bersama stage. Tidak ada skor risiko karangan: hanya fakta yang sudah dipegang model (kasus Inventory terbuka, `shortfall > 0`, edge application REJECTED/PENDING terlalu lama).

**By store:** `Alloted · Received · To Receive`, lalu per SKU `Alloted · To Pack · Packed · Shipment · In Transit · Received · To Receive`.

**By article:** `ARTICLE · SKUs · STORES · ALLOTED · RECEIVED · TO RECEIVE`.

### ALT-D10 — Allotment tidak tahu di mana barang sekarang

Allotment menyimpan **sejarah pemenuhan**: berapa yang sudah sampai ke toko. Ia tidak menyimpan lokasi atau kondisi barang setelah itu, dan tidak boleh menyiratkannya.

Karena itu **domain allotment tidak punya `Reject qty`** — tetapi layar allotment **harus** bisa menampilkan `Store Reject` terkini dari proyeksi Inventory. Satu sumber kebenaran untuk masing-masing, dua sumber pada satu layar:

```text
Fulfillment                     ← Allotment
Alloted                  100
Received                 100
To Receive                 0

Current inventory at Store 07   ← proyeksi Inventory
Warehouse                 98
Store Reject               2
```

Tanpa itu, `Received 100` terbaca seolah seratusnya masih utuh dan normal di gudang toko. Ini pola yang sama seperti PO: PO boleh mengatakan Received 100 sementara Inventory mengatakan 98 available + 2 karantina — penerimaannya tidak diubah menjadi 98 hanya karena 2 kemudian masuk karantina.

Dan bila besok `Store Reject` itu diretur ke DC, allotment tetap `Received 100 · COMPLETED`: sejarah bahwa 100 pernah sampai tidak berubah, dan retur adalah transaksi baru.

### Penamaan tombol di layar penerimaan

Toko tidak pernah melihat kata yang berbunyi seperti penolakan:

```text
JANGAN            [Reject receipt]
PAKAI             Normal          98
                  Store Reject     2
                  Missing          0
                  [Confirm Receive]

atau, setelah pemindaian   [Mark as Store Reject]
```

Begitu dikonfirmasi:

```text
In Transit 100 → custody toko 100 → 98 Store Warehouse · 2 Store Reject
Allotment: Received += 100
```

### ALT-D09 — New Allotment tetap matrix, tetap tanpa Draft

Matrix `SKU × Toko` dipertahankan. `On Hand` di sana berarti available (§9), jadi jangan dikurangi dua kali. Form kerja hidup di klien; objek lahir `ACTIVE` saat `Create allotment` ditekan. Side inspector yang menuntut `Sales 30d · Cover · Suggested` menunggu sampai angka itu punya sumber terdefinisi — frontend tidak mengarang rekomendasi.

---

## 13. Di mana ini hidup, dan apa statusnya

| Lapis | Tempat |
|---|---|
| Aritmetika | `backend/src/cloud/domain/commitment.rs` |
| View kanonik | `allotment_line_commitment` (per baris), `allotment_commitment` (per allotment + status) |
| Migrasi | postgres `0176_…`, sqlite `0035_…` — **keduanya belum di-commit dan harus disunting** (lihat di bawah) |
| Baca/tulis cloud | `backend/src/cloud/postgres/allotments.rs`, `queries.rs`, `sync.rs` |
| Sisi node | `backend/src/edge/domain/inventory/allotment.rs`, `edge/sqlite.rs`, `edge/outbound.rs` |
| Endpoint | `/api/v1/inventory/allotments`, `…/{id}`, `…/by-store/{store_id}`, `…/by-article`, `…/{id}/cancel`, `…/{id}/execute` (yang terakhir pensiun) |

### ALT-INV-16 — Satu view, bukan tujuh rumus

Setiap query, jalur sync, dashboard, dan derivasi status membaca **satu** view. Layar atau query yang melakukan pengurangannya sendiri adalah bug yang view ini ada untuk mencegahnya. Sebelum pekerjaan ini ada **enam** ejaan commitment berbeda di estate — empat di jalur baca, dua di write guard yang memutuskan boleh-tidaknya allotment dibuat. Semuanya melepas saat pick.

### Yang menjadi usang karena revisi 1.1 dan 1.2

| Usang | Ada di | Gantinya |
|---|---|---|
| Stage `AT_EXCEPTION` / field `at_exception` | `commitment.rs`, view `allotment_line_commitment`, `allotment_commitment` | stage terakhir yang sah selama custody belum pindah; selisih penerimaan setelahnya (ALT-INV-08) |
| `exception_released_total` / kolom `exception_released_quantity` | `commitment.rs`, migrasi 0176 (postgres ×2 tabel), migrasi 0035 (sqlite) | penyelesaian Inventory `Lost` langsung ke `To Pack` |
| Aksi `allotment.resolve_exception` | dokumen (belum ada kode) | kapabilitas Inventory `Found` / `Lost` |
| `lost_packed_total` / `lost_in_transit_total` yang bermuara ke exception | `commitment.rs`, migrasi 0176 & 0035 | tiga `lost_*` yang bermuara ke `TO_PACK` |
| Tidak adanya `handed_over_total` | kedua migrasi, jalur sync penerimaan | serah terima adalah fakta tersendiri (ALT-INV-00) |
| Aturan "selalu tepat di salah satu stage" | dokumen 1.0 dan 1.1 | terhitung tepat sekali: stage **atau** selisih penerimaan (ALT-INV-01) |
| Klausa `at_exception > 0` pada derivasi status (`K1`) | `commitment.rs`, freeze §4 | tidak perlu — Missing membuat `to_receive > 0` dengan sendirinya |

Karena kedua migrasi belum di-commit dan belum dipakai database mana pun selain scratch, keduanya **disunting di tempat**, bukan ditumpuk migrasi baru.

### Status implementasi

| Langkah | Isi | Status |
|---|---|---|
| 0 | Revisi model 1.1 di dokumen ini | **selesai** |
| 1 | View commitment kanonik + kosakata + 6 rumus lama diganti | selesai, **perlu disesuaikan ke 1.1** |
| 2 | Batas otorisasi / principal | belum |
| 3 | Pensiunkan `ALLOTMENT_PICKED` + tulisan `picked.{store}` + tombol Pick milik MD | belum |
| 4 | Persempit sumber Packing | belum |
| 5 | Pisahkan milestone DC dari penyelesaian sebenarnya | belum |
| 6 | `Confirm Receive` (serah terima + penerimaan + klasifikasi Store Reject), pembukaan kasus Missing otomatis, penyelesaian Inventory (`Found`/`Lost`), Close Short (MD) | belum |
| 7 | Verifikasi LOADED sebenarnya / Dispatch | belum |
| 8 | Picking EPC eksplisit | belum |
| 9 | Semantik proyeksi stok | sebagian — guard `max(…,0)` sudah maju ke Langkah 1 |
| 10 | UI Allotment | belum — dan tidak boleh dimulai sebelum 1–9 |

---

## 14. Larangan

1. **Jangan** memakai kata `bucket` sebagai bahasa domain atau produk. Yang ada: Inventory Pool dan Allotment Fulfillment Stage.
2. **Jangan** membuat stage untuk exception. Missing adalah overlay kasus, bukan stage (§6, ALT-D08).
3. **Jangan** menulis `Received` dari manifest, dispatch, serah terima, atau ekspektasi. Hanya penerimaan nyata oleh toko (ALT-INV-06).
4. **Jangan** memberi toko wewenang menolak allotment. Menolak alokasi adalah keputusan MD (ALT-INV-07).
5. **Jangan** membiarkan kuantitas menggantung di `At In Transit` setelah custody berpindah; selisihnya menjadi selisih penerimaan (ALT-INV-00, ALT-INV-08).
6. **Jangan** menjadikan selisih penerimaan sebuah fulfillment stage, dan jangan menaruhnya di kolom pipeline (ALT-INV-01, ALT-D07).
7. **Jangan** memberi MD kewenangan memutuskan barang hilang. Itu milik Inventory (ALT-D04).
8. **Jangan** membiarkan `Found` menulis `Received`. Penerimaan tetap fakta toko (§6).
9. **Jangan** memperlakukan `Lost` sebagai `Received` atau sebagai `Closed Short`. `Lost` mengembalikan demand ke `To Pack` (§6).
10. **Jangan** membuka kembali allotment yang sudah COMPLETED/CLOSED karena kejadian inventory berikutnya (ALT-INV-11).
11. **Jangan** memakai `to_receive` untuk mengurangi stok pool mana pun; yang memblokir rak adalah `to_pack` (ALT-INV-12).
12. **Jangan** menjumlahkan `Can Pack Now` antar toko (ALT-INV-15).
13. **Jangan** menampilkan `Picked` sebagai stage allotment, dan jangan memakai stepper (ALT-INV-05).
14. **Jangan** menampilkan `Loaded` dengan nama `Dispatched`, dan jangan membuangnya tanpa melebur (ALT-D06).
15. **Jangan** membaca over-allot dari `on_hand < 0`; bacalah `shortfall` (ALT-INV-14).
16. **Jangan** mengedit atau menghapus event historis, dan jangan memakai mesin pembalikan untuk membuat workflow exception (§4).
17. **Jangan** menampilkan id pool internal (`dc.warehouse`) atau id origin (`dc-01-edge`) sebagai bahasa bisnis, dan jangan mengarang nama orang dari `created_by`.
18. **Jangan** memperkenalkan klaim, reservasi tugas, atau reservasi kuantitas pekerja dalam bentuk apa pun.
19. **Jangan** meminta toko mengonfirmasi penerimaan untuk kedua kalinya setelah Inventory menyatakan `Found`. Custody-nya sudah di toko; yang tadi kurang hanyalah buktinya (ALT-INV-09).
20. **Jangan** membiarkan `Found` menyentuh allotment bila Missing-nya bukan berasal dari selisih penerimaan (ALT-INV-09, ALT-INV-11).
21. **Jangan** menurunkan `handed_over_total` dari manifest. Ia berasal dari koli yang benar-benar diserahterimakan (ALT-D01).
22. **Jangan** meminta toko menekan tombol untuk membuka kasus selisih; kasusnya dibuka sistem (ALT-D02).
23. **Jangan** memberi toko tombol yang berbunyi seperti penolakan (`Reject receipt`). Barang rusak tetap diterima, lalu diklasifikasikan ke `Store Reject` (ALT-D03).
24. **Jangan** mengurangi `Received` karena barang rusak, dan jangan membuka kembali allotment karena kondisi barang setelah sampai (ALT-D03).
25. **Jangan** menambah `Received` pada baris SKU yang seharusnya bila yang datang SKU lain atau EPC tak dikenal (ALT-D03).
26. **Jangan** membuat counter reject/kondisi di domain allotment; layar boleh menampilkannya dari proyeksi Inventory (ALT-D10).
27. **Jangan** membuat field `condition`/`grade` di V1. Pakai Inventory Pool `Store Reject`.
28. **Jangan** membangun UI Allotment sebelum Langkah 1–9 selesai.

---

## 15. Yang sudah diputuskan, dan yang masih terbuka

Ditutup di 1.3: satu aksi `Confirm Receive` (ALT-D01), kasus Missing dibuka otomatis (ALT-D02), barang rusak tetap `Received` dengan pool `Store Reject` dan tanpa model grade baru (ALT-D03), dan allotment tanpa counter reject (ALT-D10).


| # | Pertanyaan | Diputuskan di |
|---|---|---|
| O1 | Nama kapabilitas Inventory yang persis untuk `Found` / `Lost`, mengikuti arsitektur Inventory yang ada | arsitektur Inventory |
| O3 | SLA/eskalasi kasus Missing yang tidak kunjung diselesaikan Inventory, karena Close Short menunggunya (ALT-INV-08) | Langkah 6 |
| O4 | Rename kolom `dispatched_quantity → loaded_quantity` | migrasi ladder berikutnya |
| O5 | Sumber `Sales 30d · Cover · Suggested` untuk side inspector matrix (ALT-D09) | belum dijadwalkan |

---

## 16. Glosarium

| Istilah UI | Internal | Arti singkat |
|---|---|---|
| Alloted | `original_alloted` | yang diputuskan MD |
| To Pack | `to_pack` | belum terikat toko lewat pengemasan, belum diserahkan |
| To Receive | `to_receive` | belum di tangan toko, belum diserahkan — angka MD |
| Diserahterimakan | `handed_over_total` | custody berpindah ke toko di pintu |
| Received | `received_total` | sungguh diterima toko |
| Receiving Difference | `receiving_gap_qty` | diserahterimakan tetapi tidak ditemukan; muncul sebagai `Missing` di Inventory |
| Closed Short | `closed_short_total` | permintaan yang diserahkan MD; tidak memindahkan stok |
| On Hand | `available` | yang masih boleh dibelanjakan; tidak pernah negatif |
| Shortfall | `shortfall` | sejauh mana janji melampaui barang |
| Can Pack Now | panduan | bisa jujur masuk karton sekarang — bukan reservasi |
| Need More | panduan | yang masih kurang di pick area |
| Missing / discrepancy | overlay Inventory | barang belum ditemukan; posisi terakhir masih berlaku |
