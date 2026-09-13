# Inventory — stock opname, barang hilang, dan bukti RFID

**Status:** model target, dengan implementasi sekarang dicatat di sampingnya.
Rujukan kode dibaca dari `feat/handheld-rfid` di `eabc58c`.

> **Arti bisnis, boundary dan invariant dimiliki
> [INVENTORY-V1.md](../INVENTORY-V1.md).** Dokumen ini memiliki
> mekanika count, missing, dan bukti RFID — dan tidak mengulang arti
> yang sudah dibekukan di sana.

Kosakata: [`../CONTEXT.md`](../CONTEXT.md). Sebelum ini:
[buku besar stok](./inventory-ledger.md) — dokumen ini memakai Subject, Place,
Pool, Movement dan Cause persis seperti yang didefinisikan di sana.

Dokumen ini memiliki: **bagaimana perusahaan memeriksa apakah ledgernya masih
benar, apa yang terjadi pada barang yang tidak ditemukan, dan kenapa pembacaan
RFID tidak pernah mengubah stok.**

---

## 1. Satu hitungan, tiga pernyataan berbeda

Tiga hal sering disebut "stok opname" dan ketiganya berbeda. Membedakannya
adalah setengah dari dokumen ini.

```text
Observation     handheld membaca tag. Bukti. Tidak mengubah apa pun.
                "pukul 14.03 pembaca ini melihat EPC itu di rak ini"

Official Count  keputusan. Seseorang membuka hitungan, seseorang
                menghitung, orang lain menyetujui, lalu ledger berubah.

Missing         akibat. Bukan kesimpulan — barang tidak hilang karena
                tidak terbaca; barang hilang karena hitungan resmi
                menyatakan begitu, atau seseorang menyatakan begitu.
```

Aturan pemisahnya satu kalimat, dan ia ada sebagai komentar di skema sejak
migrasi pertama:

> `observation_sighting` — *RFID evidence stream; never changes ledger
> inventory* (`0001_inventory_schema.sql`).

---

## 2. Official Count — siklus hidupnya

**Target.**

> Sebuah **Official Count** adalah keputusan bahwa satu pool akan diperiksa,
> dengan cakupan yang ditetapkan di muka dan tidak berubah di tengah jalan.

```text
DRAFT ──▶ ACTIVE ──▶ REVIEW ──▶ CLOSED
  │          │          │          │
dibuat    expected    hitungan  disetujui:
scope     dibekukan   diserahkan ledger berubah
```

Transisi itu satu arah dan ditolak di domain
([`count.rs:59`](../backend/src/cloud/domain/count.rs)) — tidak ada jalan
kembali dari `REVIEW` ke `ACTIVE`, tidak ada `CLOSED` yang dibuka lagi. Sebuah
hitungan yang ternyata salah diperbaiki dengan hitungan baru, bukan dengan
mengedit yang lama, karena persetujuannya sudah menjadi movement dan movement
tidak bisa dihapus.

Tiga jenis, dan jenisnya menentukan kewajiban cakupan:

| Kind | Artinya | Wajib menyebut SKU/EPC? |
|---|---|---|
| `FULL` | seluruh isi pool | tidak |
| `CYCLE` | hitungan berkala | tidak |
| `TARGETED` | sesuatu yang spesifik dicurigai | **ya** — ditolak kalau kosong |

**As-is.** `create_count`
([`counts.rs:48`](../backend/src/cloud/postgres/counts.rs)) memaksa `pool_id`
kanonik dan milik `site_id` yang disebut, menuntut `reason` yang tidak kosong,
dan menormalkan EPC ke huruf besar. Perintahnya idempoten seperti semua tulisan
lain di area ini.

---

## 3. Expected — dibekukan saat ACTIVE, bukan saat approve

**Target.**

> Yang dibandingkan dengan hasil hitungan adalah **saldo pada saat hitungan
> dibuka**, bukan saldo pada saat hitungan disetujui.

Ini bukan detail. Kalau `expected` dibaca ulang saat approve, setiap penjualan
yang terjadi selama tiga jam orang berjalan di lantai toko akan muncul sebagai
selisih — dan selisih itu akan diposting sebagai kehilangan barang yang
sebenarnya laku terjual.

**As-is.** `activate_count`
([`counts.rs:119`](../backend/src/cloud/postgres/counts.rs)) melipat ledger ke
`count_snapshot` dalam transaksi yang sama dengan perubahan status. Snapshot itu
diambil **dari `movement`, bukan dari proyeksi** — proyeksi yang basi tidak
boleh menentukan apa yang seharusnya ada di rak.

Satu hal yang belum tertutup: **tidak ada yang melarang stok bergerak selama
hitungan aktif.** Penjualan, pengiriman, dan pemindahan tetap jalan; snapshot
tetap di angka lama. Selisih yang muncul karenanya nyata di layar dan tidak
dibedakan dari selisih fisik. → **G1**

---

## 4. Found — apa yang benar-benar dilihat

Entri hitungan ditulis per subject, boleh dicicil, dan boleh nol —
`found_quantity >= 0`, karena "saya cari dan tidak ada" adalah hasil hitungan,
bukan ketiadaan hasil.

Perbandingannya satu fungsi murni, `compare_count`
([`count.rs:37`](../backend/src/cloud/domain/count.rs)):

```text
found == expected   MATCH
found <  expected   SHORTAGE   selisih = expected − found
found >  expected   GAIN       selisih = found − expected
```

Yang menarik ada pada `FULL OUTER JOIN` antara snapshot dan entri
([`counts.rs:553`](../backend/src/cloud/postgres/counts.rs)): subject yang ada
di snapshot tetapi tidak ada entrinya dihitung `found = 0`, dan subject yang ada
entrinya tetapi tidak ada di snapshot dihitung `expected = 0`. Artinya **barang
yang ditemukan di pool yang menurut ledger tidak memilikinya tetap masuk
hitungan**, sebagai gain.

---

## 5. Approve — di sinilah ledger berubah

**Target.**

> Persetujuan sebuah hitungan menghasilkan movement, dan hanya di sanalah stok
> berubah. Tidak ada jalur lain dari hitungan ke ledger.

Dua grup movement, terpisah karena sebabnya berbeda:

```text
SHORTAGE   <pool>:on_hand ──▶ <pool>:missing      cause COUNT_SHORTAGE
GAIN       system/count_gain ──▶ <pool>:on_hand   cause COUNT_GAIN
```

Perhatikan yang **tidak** terjadi pada shortage: barang tidak keluar dari
perusahaan. Ia pindah state, di pool yang sama, dan tetap menjadi tanggung jawab
pool itu. `COUNT_SHORTAGE` secara domain menolak pasangan pool yang berbeda
([`movement.rs:175`](../backend/src/cloud/domain/movement.rs)) — hitungan tidak
boleh memindahkan barang, hanya boleh menyatakan tidak ketemu.

`reference_type` pada kedua grup adalah `OFFICIAL_COUNT` dan `reference_id`
adalah id hitungannya, jadi setiap baris ledger yang lahir dari sebuah hitungan
bisa ditelusuri balik ke hitungan yang melahirkannya.

Shortage juga memberi tahu allotment, karena barang yang hilang mungkin sudah
dijanjikan ke sebuah toko: `record_allotment_shortages_for_count` menurunkan
event ke sisi commitment ([`counts.rs:639`](../backend/src/cloud/postgres/counts.rs)).
Aturannya milik [allotment-v1](./allotment-v1.md) §6.

**Yang tidak terjadi sama sekali: tidak ada jurnal.** Kunci semantik
`stock_loss` sudah dipetakan ke akun klien
*8010110006 Kehilangan Barang atau Selisih Stock Opname*, dan tidak ada satu
baris kode pun yang memakainya. Selisih stock opname tidak pernah menjadi biaya.
→ lihat [inventory-ledger.md](./inventory-ledger.md) **G2**.

---

## 6. Missing bukan kesimpulan

**Target.**

> `missing` adalah pernyataan bahwa barang seharusnya ada di sebuah pool dan
> tidak ditemukan di sana. Ia bukan kehilangan, bukan biaya, dan bukan akhir.
> Ia adalah **daftar kerja**.

Tiga jalan keluar, dan masing-masing menuntut pernyataan manusia yang berbeda:

```text
<pool>:missing ──FOUND──────────▶ <pool>:on_hand      "ternyata ada"
               ──CONFIRMED_LOST─▶ system/lost         "tidak akan kembali"
               ──DISPOSAL───────▶ external/disposal   "ada, tapi dibuang"
```

Ketiganya hanya berangkat dari `:missing`, tidak pernah langsung dari rak.
Selalu ada dua langkah, dan biasanya dua orang: yang menghitung, dan yang
mengakui.

Missing bersifat **per pool**. `store-07.floor:missing` bukan
`store-07.warehouse:missing`. Identitas satu baris daftar hilang adalah pasangan
`subject@pool` ([`movements.rs:953`](../backend/src/cloud/postgres/movements.rs)),
dan itu sengaja: barang yang sama bisa hilang dua kali di dua tempat berbeda,
dan keduanya urusan orang yang berbeda.

**As-is.** Empat catatan, dua di antaranya cacat.

- Daftar hilang dibaca dari `inventory_projection`, bukan dari `movement`
  ([`queries.rs:2146`](../backend/src/cloud/postgres/queries.rs)). Untuk daftar
  kerja itu dapat diterima; yang perlu diingat, proyeksi yang belum di-repost
  membuat baris hilang tidak muncul.
- **`missing_since` menyebut tanggal pertama kali, bukan yang terakhir.**
  Query-nya mengambil movement paling awal yang pernah masuk ke place `missing`
  itu (`ORDER BY occurred_at ASC LIMIT 1`). Barang yang hilang bulan Januari,
  ditemukan Februari, lalu hilang lagi Maret akan dilaporkan "hilang sejak
  Januari", dan `age_hours` di sebelahnya ikut salah. → **G2**
- **`FOUND` boleh menaruh barang di pool mana pun.** `resolve_missing_found`
  menerima `destination_pool_id` bebas
  ([`queries.rs:2375`](../backend/src/cloud/postgres/queries.rs)) dan tata
  bahasa pusat tidak menuntut pool yang sama. Barang yang hilang di lantai toko
  07 bisa "ditemukan" langsung di gudang DC, tanpa satu pun catatan perjalanan
  di antaranya. Edge lebih ketat dan menuntut pool yang sama
  ([edge `movement.rs:212`](../backend/src/edge/domain/inventory/movement.rs)).
  → [inventory-ledger.md](./inventory-ledger.md) **G5**
- Kuantitas yang bisa diselesaikan dihitung ulang dari ledger sebelum setiap
  resolusi ([`queries.rs:2365`](../backend/src/cloud/postgres/queries.rs)), jadi
  dua orang yang menyelesaikan baris yang sama tidak bisa menghasilkan saldo
  negatif.

---

## 7. Observasi RFID — bukti, dan hanya bukti

**Target.**

> Sebuah **Observation** mencatat bahwa satu pembaca melihat satu EPC di satu
> pool pada satu rentang waktu. Ia tidak pernah memindahkan apa pun.

Kenapa sekeras itu: pembacaan RFID salah dengan cara yang tidak sopan. Tag
terbaca dari ruangan sebelah lewat dinding gipsum; tag di dalam karton tidak
terbaca sama sekali; satu putaran pembacaan menghasilkan delapan puluh
pembacaan atas tag yang sama. Sistem yang memindahkan stok berdasarkan itu akan
memindahkan stok berdasarkan tembok.

Yang disimpan adalah **burst**, bukan pembacaan tunggal:

- pembacaan mentah dikonsolidasikan per EPC — jumlah bacaan ditambahkan, RSSI
  terbaik dipertahankan ([`observation.rs:28`](../backend/src/cloud/domain/observation.rs));
- burst dari perangkat dan sesi pembaca yang sama, di pool yang sama, atas EPC
  yang sama, dalam jendela `RFID_BURST_WINDOW_SECONDS` (default 10 detik),
  digabungkan ke baris yang ada alih-alih menambah baris baru
  ([`observations.rs:13`](../backend/src/cloud/postgres/observations.rs));
- pool harus milik site yang disebut, atau batch ditolak.

EPC yang belum dikenal tetap disimpan dengan `subject_id` kosong. Handheld di
gudang tidak boleh diam hanya karena pusat belum pernah mendengar tentang
sebuah tag.

### Anomali penempatan

Satu-satunya hal yang dilakukan sistem dengan selisih antara "terbaca" dan
"tercatat" adalah **melaporkannya**:

```text
GET /api/v1/inventory/observation-anomalies
    → PLACEMENT_MISMATCH
      { ledger_pool, observed_pool, automatic_inventory_effect: false }
```

Bidang terakhir ditulis eksplisit di jawaban
([`observations.rs:425`](../backend/src/cloud/postgres/observations.rs)). Ia ada
supaya tidak ada pembaca API yang perlu menebak.

Jalan dari anomali ke ledger ada, dan ia lewat manusia:
`POST /api/v1/inventory/movements/correct` dengan cause
`PLACEMENT_CORRECTION`, yang **menolak kalau `evidence_reference` kosong**
([`movements.rs:56`](../backend/src/cloud/postgres/movements.rs)). Koreksi
penempatan tanpa bukti bukan koreksi; itu tebakan yang diketik.

---

## 8. Hitungan yang dijalankan oleh DC

**Target.**

> Yang menghitung adalah orang yang berdiri di gudang. Pusat membuka hitungan
> dan menyetujui hasilnya; ia tidak pernah mengarang isinya.

Karena gudang punya ledgernya sendiri (lihat
[inventory-fleet.md](./inventory-fleet.md)), sebuah hitungan atas pool yang
dimiliki node edge berjalan lewat perintah, bukan lewat query:

```text
pusat   ACTIVATE ──command──▶ DC     DC membekukan expected-nya sendiri
                                     DC berjalan, membaca, menghitung
pusat   ◀──result fact────── DC      hasil, immutable, satu per hitungan
pusat   APPROVE  ──command──▶ DC     DC yang menerbitkan movement-nya
pusat   ◀──completion fact── DC      APPLIED atau REJECTED
```

Perbedaan yang harus dipegang: pada hitungan milik edge, **pusat tidak
mengambil `count_snapshot` sama sekali** — jawabannya `expected_subjects: null`,
dan `execution_authority` berbunyi `EDGE_DC`
([`counts.rs:262`](../backend/src/cloud/postgres/counts.rs)). Pusat juga menolak
`submit` untuk hitungan milik edge: yang boleh menyerahkan hasil hanyalah DC
yang berwenang ([`counts.rs:396`](../backend/src/cloud/postgres/counts.rs)).

Siapa pemilik sebuah site diputuskan `inventory_dc_owner_tx`, dan fungsi itu
menyimpan satu perbaikan penting: site `dc` di pusat diselesaikan ke satu-satunya
DC yang terdaftar (`dc-01`). Sebelum perbaikan itu, hitungan yang dibuka untuk
`dc` tidak menemukan pemilik, diam-diam menjadi hitungan pusat, **dan tidak
pernah sampai ke gudang yang seharusnya berjalan.** Kalau suatu hari ada dua DC
terdaftar, fungsi itu menolak alih-alih menebak.

---

## 9. Berapa banyak yang benar-benar pernah dihitung

Tiga dari seratus dua belas pool di fleet ini pernah dihitung — angka itu
tertulis sebagai komentar di sebelah kolom yang melaporkannya
([`queries.rs:142`](../backend/src/cloud/postgres/queries.rs)).

Karena itu `last_counted_at` bernilai `None`, **bukan nol dan bukan epoch**,
untuk pool yang belum pernah dihitung. Angka di situ akan terbaca sebagai
"dihitung, dan isinya nihil" — satu-satunya arti yang justru tidak dimaksud.
Facet-nya menghitungnya sebagai `NEVER` dengan alasan yang sama.

---

## 10. Daftar gap

| | Gap | Bukti | Perbaikan |
|---|---|---|---|
| **G1** | Stok bebas bergerak selama hitungan aktif; selisih yang lahir dari penjualan tidak dibedakan dari selisih fisik | tidak ada penjagaan di jalur movement terhadap pool yang sedang `ACTIVE` | Bekukan pool selama hitungan, atau catat movement yang terjadi di dalam jendela dan kurangkan saat approve |
| **G2** | `missing_since` melaporkan kejadian pertama, bukan yang sedang berlaku | `MISSING_ROWS`, `first_missing … ORDER BY occurred_at ASC` ([`queries.rs:2146`](../backend/src/cloud/postgres/queries.rs)) | Ambil movement `:missing` terakhir yang belum diselesaikan |
| **G3** | Selisih stock opname tidak pernah menjadi biaya | kunci `stock_loss` ([`ledger.rs:434`](../backend/src/cloud/postgres/ledger.rs)) tidak dipakai kode mana pun | Posting saat approve, setelah metode biaya diputuskan |
| **G4** | Anomali penempatan tidak punya siklus hidup | `observation_anomalies` mengembalikan daftar tanpa status | Jadikan daftar kerja: terbuka, sedang diperiksa, diselesaikan dengan koreksi atau diabaikan dengan alasan |
| **G5** | Hitungan tidak punya jadwal | tidak ada penjadwal; `CYCLE` hanyalah label | Cycle count terjadwal per pool, dengan target cakupan yang bisa dilaporkan |
| **G6** | 109 dari 112 pool belum pernah dihitung | [`queries.rs:142`](../backend/src/cloud/postgres/queries.rs) | Bukan bug kode — ini konsekuensi **G5** |

---

## 11. Keputusan terbuka

1. **Apakah pool dibekukan selama hitungan.** Rekomendasi: untuk lantai toko
   tidak — toko tidak boleh berhenti berjualan; sebagai gantinya, movement yang
   terjadi di dalam jendela hitungan dicatat dan dikurangkan saat approve. Untuk
   pool DC, pembekuan wajar.
2. **Siapa yang boleh menyetujui hitungan.** Hari ini `actor_id` di badan
   permintaan. Hitungan yang disetujui oleh orang yang menghitungnya sendiri
   adalah persetujuan yang tidak berarti — pola dua orang yang sudah dipakai
   di [receiving](./receiving-verification.md) berlaku sama di sini.
3. **Ambang batas selisih.** Perlukah selisih di atas nilai tertentu menuntut
   persetujuan yang lebih tinggi? Pertanyaan ini tidak bisa dijawab sebelum stok
   punya nilai uang.
