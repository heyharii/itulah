# Audit inkonsistensi — cloud, store, dc

> **Status, 28 Sep 2026 (petang).** Audit ini adalah potret sebelum perbaikan.
> Perbaikannya sudah dikerjakan di working tree yang sama; yang berubah antara
> lain: kunci dedup sync jadi `(origin_id, event_id)` (§A1), rute toko→toko
> ditolak di Rust cloud (§B1), retur supplier bisa di-pack di edge DC (§B2),
> pool reject Gudang memakai `{site}.reject` (§B3), `validate_issued_command`
> menolak command yang tak dikenal (§A2), `record_cycle_idle` cloud = edge
> (§A4), cause kedatangan di DC ditentukan peran (§B5), katalog invariant
> finance pindah ke `unit_id` (11 berkas), `backend/bindings/contract` dihapus
> (§F1), Makefile/render/CI mengikuti app yang ada (§E4/§F3), dan terminologi
> UI diselaraskan dengan `CONTEXT.md` (§D1–§D9). Yang **tidak** diubah dan
> alasannya ada di laporan: §A3 (dua enum `MovementCause`, kini
> didokumentasikan), §A5/§B4 (allotted per peran), §B8, §D10–§D18 (sisa istilah
> di layar), §E9.

**Tanggal:** 28 Sep 2026 · **Cakupan:** seluruh repo (`backend/` + frontend) · **Sifat:** read-only, tidak ada kode yang diubah

**Cara kerja:** empat penelusuran paralel (terminologi, kontrak sync, dc↔store, docs) lalu **temuan berisiko tinggi diverifikasi ulang langsung** terhadap working tree. Temuan yang saya konfirmasi sendiri ditandai **✅ terverifikasi**; sisanya **○ dirujuk** (kutipan file:line dari audit, belum saya jalankan ulang).

**Legenda tingkat:**

| Tingkat | Arti |
|---|---|
| **TINGGI** | Data hilang/salah, build/deploy rusak, atau kontrak API/arsitektur menyesatkan |
| **SEDANG** | Divergensi yang akan menyesatkan atau pecah pada perubahan berikutnya |
| **RENDAH** | Kosmetik, warisan, atau laten (belum aktif) |

**U** = user-facing (teks UI / respons API / dokumen), **I** = internal (identifier, komentar, nama wire).

> Catatan model: `dc` sebagai **nama binary, `EdgeRole::Dc`, tabel `dc_*`, dan rute `/api/v1/dc/*` adalah id lama yang sengaja tidak diganti** (migrasi `0603` baris 16: *"Internal ids are NOT renamed. `dc` stays `dc`; it simply stops meaning distribution centre."*). Jadi `dc` bukan pelanggaran dengan sendirinya. Yang jadi pelanggaran adalah (a) teks yang masih **memaknai** DC/warehouse, dan (b) perbandingan site id ke literal `'dc'` yang dilarang `0603:100`.

---

## Ringkasan eksekutif

Temuan paling berbahaya, berurutan:

1. **`commercial.publication.activated` hanya tercatat untuk satu toko per publikasi** — `event_id` diisi `publication_id` (dibagikan ke semua toko) sementara dedup di cloud global lintas-origin. Toko kedua dan seterusnya dianggap duplikat dan dilewati tanpa error. **Kontrak sync, kehilangan data senyap.** (§A1)
2. **Toko→toko dilarang di DB tetapi diizinkan di Rust cloud dan seluruh edge.** Aturan owner (0628) ditegakkan satu tempat saja; jalur lain akan gagal sebagai error DB mentah. (§B1)
3. **Return ke supplier dirancang keluar dari Gudang tetapi tidak bisa dieksekusi di edge DC.** Barang nyangkut di area picking dengan `allotted` permanen. (§B2)
4. **README depan salah soal arsitektur**: frontend "dependency-free HTML tanpa npm" (padahal React/Vite, 5 app), transport publikasi "belum ada" (padahal ada), node "belum terikat ke site_id" (padahal ditolak saat startup). (§E1–E3)
5. **Build/deploy menunjuk `frontend-dc` yang sudah dihapus** — `make front` gagal, service Render rusak. (§E4, §F3)
6. **Terminologi kunci menyimpang dari `CONTEXT.md` di UI aktif**: `Shipment`/`Consignment` untuk Surat Jalan, `Product` untuk Article, `Warehouse` untuk Stockroom, `Central warehouse` untuk Gudang, `Snapshot` untuk Checkpoint. (§D)

---

## A. Kontrak Cloud ↔ Edge

### A1 — TINGGI ✅ `publication.activated` di-dedup lintas-origin → hanya toko pertama tercatat

Tiga fakta yang saling bertentangan:

- **Produsen (edge)** memakai `publication_id` sebagai `event_id`:
  `backend/src/edge/sync.rs:559-572` — `enqueue_fact(tx, payload.publication_id, FACT_PUBLICATION_ACTIVATED, …)`; komentar `:3061` mengakuinya (“*uses the publication id as its event id so a replay is deduplicated by the lane*”).
- **Indeks unik global, tidak per-origin**:
  `backend/migrations/postgres/0006_sync_outbox.sql:95` — `CREATE UNIQUE INDEX ux_sync_ingest_event_id ON sync_ingest_fact (event_id);` (tidak ada `origin_id`).
- **Dedup cloud lintas-origin**: `backend/src/cloud/postgres/sync.rs:471-494` mencari `WHERE event_id = ANY($1)` (cabang kedua baru menyaring `origin_id`/`generation` untuk seq), lalu `held_by_event` di-key hanya `event_id`; `:583-595` bila ketemu → `durable = fact.seq; continue;` tanpa insert/apply.

Perbandingan: **fact kegagalan** sengaja memakai `Uuid::new_v4()` (`backend/src/edge/sync.rs:3067-3077`), jadi bug spesifik pada fact **sukses**. Aplikasinya sendiri per-origin (`backend/src/cloud/postgres/sync.rs:6937-6968` → `rollout::record_activated(..., origin_id, ...)`).

**Akibat:** publikasi tertentu hanya mencatat **satu** toko ACTIVE. Toko lain mengunggah fact dengan `event_id` yang sama, dianggap duplikat, watermark maju, tidak ada receipt, tidak ada dead letter, dan layar rollout terus membaca “outstanding” selamanya.

**Arah perbaikan:** jadikan kunci dedup `(origin_id, event_id)` (ubah indeks + query `held_rows`), atau rotasi `event_id` per origin.

### A2 — SEDANG ✅ Command `commercial.eligibility` & `official_count.adjust` lolos validasi issue-time

`backend/src/cloud/postgres/sync.rs:5267` (`validate_issued_command`) punya arm untuk hampir semua command, **kecuali** `COMMAND_COMMERCIAL_ELIGIBILITY` (diterbitkan `backend/src/cloud/postgres/eligibility.rs:271`) dan `INVENTORY_OFFICIAL_COUNT_ADJUST_V1` (`backend/src/cloud/postgres/counts.rs:512`). Keduanya jatuh ke `_ => {}` (`:5358`). Padahal `issue_command`/`issue_command_tx` (`:5581`, `:5637`) adalah satu-satunya gerbang validasi.

**Akibat:** command malformed tersimpan & terkirim tanpa validasi; edge kemudian memblokir **seluruh stream** command (termasuk price book) karena tak bisa mem-parse-nya (`backend/src/edge/sync.rs:2850`, `:2920`, blokir di `:3008-3013`). Default `_ => {}` juga menerima `command_type` yang typo.

### A3 — SEDANG ✅ Dua `MovementCause` yang tidak sepakat

- Cloud (12): `backend/src/cloud/domain/movement.rs:19-36` — `Opening, NormalMove, ReturnToWarehouse, Sale, CustomerReturn, SupplierReturn, PlacementCorrection, CountShortage, CountGain, Found, ConfirmedLost, Disposal`.
- Edge (16): `backend/src/edge/domain/inventory/movement.rs:20-50` — tambah `StoreReceive, Identification, Tagging, HandedOver` (+ `FromStr` di `:87-101`).

Hari ini sync aman karena applier mengimpor enum edge (`backend/src/cloud/postgres/sync.rs:15-18`), tetapi jalur movement cloud memakai enum kecil (`backend/src/cloud/postgres/movements.rs:32,120`) → cause `STORE_RECEIVE`/`IDENTIFICATION`/`TAGGING`/`HANDED_OVER` ditolak `UnknownCause`. Refactor “penyatuan enum” di masa depan akan langsung memecahkan fact edge.

### A4 — SEDANG ○ `record_cycle_idle` beda arti di cloud vs edge

- Cloud: `backend/src/cloud/postgres/sync.rs:317-326` hanya `last_cycle_at = now()`.
- Edge: `backend/src/edge/sync.rs:3395-3412` juga `consecutive_failures = 0, breaker_open_until = NULL, last_success_at = ?1`.

Engine bersama memanggil `record_cycle_idle()` setiap cycle kosong (`backend/src/sync/port.rs:253-255`). Di edge, tick idle menghapus streak kegagalan dan menandai sukses padahal tidak mengunggah apa pun; di cloud tidak. Tampilan fleet-status (`last_success_at`, failure streak) jadi berbeda menurut peran node.

### A5 — RENDAH ✅ Daftar capability `/health` ≠ heartbeat; `store.inbound` mati

- Heartbeat (yang benar-benar dibaca cloud): `backend/src/edge/status.rs:83-88` — `GOODS_ROUTES`, `FLOWS`, `TEST_PRINT`, `NODE_ACTIONS`.
- `/api/v1/health`: `backend/src/edge/http.rs:690-708` — tambah `STORE_INBOUND_CAPABILITY`, `inventory.pools.owned`, `inventory.movements.read`.

`STORE_INBOUND_CAPABILITY` (`backend/src/sync/workflow.rs:862`) tidak dibaca cloud; gating store-inbound sebenarnya memakai `GOODS_ROUTES_CAPABILITY` (`backend/src/cloud/postgres/sync.rs:4645`, `:5508-5525`). Dua daftar capability untuk satu node sebaiknya satu sumber.

### A6 — RENDAH ○ Dua kosakata `PoolRole`

- Edge/root: `backend/src/pool_role.rs:18-37` — `RECEIVING, STOCKROOM, FLOOR, REJECT, RETURN, PICKING, PACKED, SHIPMENT, LOADED, IN_TRANSIT` (dipakai `operational_pool.role`, migrasi `0610:143`).
- Cloud flow template: `backend/src/cloud/domain/flow/template.rs:272-284` — `PENDING, WAREHOUSE, RETURN, REJECT, STOCKROOM, FLOOR` (`flow_template.destination_pool_role`, `0615:108`).

Tidak berdampak sync (id pool yang melintas, bukan enum), tetapi `PENDING`/`WAREHOUSE` vs `RECEIVING`/`STOCKROOM` untuk konsep yang sama adalah jebakan bagi pembaca berikutnya.

### A7 — RENDAH ○ `AllotmentStatus`/`AllotmentType` diterjemahkan di boundary

Cloud `ACTIVE`/`COMPLETED` (`backend/src/cloud/domain/allotment.rs:182-224`) vs edge `OPEN`/`CANCELLED` (`backend/migrations/sqlite/0004_edge_inventory_work.sql:12`); parser bersama memaksa wire `status == "ACTIVE"` (`backend/src/sync/workflow.rs:408-410`) lalu edge menyimpan `OPEN` (`backend/src/edge/sync.rs:1165-1187`). Aman sekarang karena kedua arah dipetakan, tetapi tidak ada test yang memaku terjemahannya.

### A8 — RENDAH ○ Fact tanpa applier di cloud

`store.expense.recorded` dan `store.petty_cash.topped_up` (`backend/src/edge/petty.rs:125-129`, diproduksi `backend/src/edge/sqlite.rs:1612-1654`, `:1714-1742`) jatuh ke default “unknown event_type passed through” (`backend/src/cloud/postgres/sync.rs:2671-2677`). Diangkut & disimpan, tidak pernah diterapkan (terdokumentasi sebagai gap).

### Yang sudah konsisten (agar tidak diaudit ulang)

Cakupan command (semua command cloud punya arm edge), penandatanganan command (`sha256_hex(upload_key)` di kedua sisi), handshake generasi (`sync_generation.rs` bersama), skema tabel sync SQLite↔Postgres, dan **jalur sync dc vs store identik** — kedua binary memanggil `edge::sync::spawn_agent` yang sama (`src/bin/dc.rs:33-43`, `src/bin/store.rs:102-103`), tanpa cabang peran di dalam `apply_command_effect`.

---

## B. DC ↔ Store (Edge)

### B1 — TINGGI ✅ “Toko tidak pernah mengirim ke toko” ditegakkan di DB, dilanggar di Rust & edge

Aturan owner ada di `backend/migrations/postgres/0628_a_store_never_sends_goods_to_another_store.sql:1-86` (trigger `allotment_line_destination_is_a_site_of_its_kind` + `flow_template_no_store_to_store`) dan validator template `backend/src/cloud/domain/flow/template.rs:519-525`.

Yang masih mengizinkan:

- **Cloud Rust:** `backend/src/cloud/postgres/allotments.rs:2141-2154` — `AllotmentType::ToSite` mengembalikan `AllotmentPurpose::Transfer` bila sumber bukan head office, yaitu **mengizinkan toko→toko**; dokumennya pun masih menyebutnya (`backend/src/cloud/domain/allotment.rs:10-16`). Validasi Rust lolos, baru mati di trigger 0628 sebagai error DB mentah.
- **Edge:** `backend/src/edge/sqlite.rs:2353-2372` (`normalized_destination_site_id` menerima site lain mana pun), `backend/src/edge/outbound.rs:1265-1277`, komentar `backend/src/edge/http.rs:362-365`, dan `frontend-store-new/src/lib/queries.ts:240-247`.

Kontradiksi internal: sisi **masuk** sudah menolak — `backend/src/edge/sqlite.rs:4882-4889`, `:4993-5001` menolak `source_dc_id` ber-kind `Store`.

### B2 — TINGGI ✅ Return ke supplier dirutekan ke edge DC tetapi tak bisa dieksekusi

Model: supplier return hanya keluar dari site HO/Gudang (`backend/src/cloud/domain/flow/template.rs:513-518`, `0628:28-37`, `backend/src/cloud/postgres/allotments.rs:2181-2203`; `backend/src/cloud/postgres/flow_stages.rs:1137-1140` mengharapkan Gudang mem-pack-nya).

Yang terjadi:

- Cloud mengirimnya ke origin DC (`activation_target_origin_id`; `backend/src/cloud/postgres/allotments.rs:223`, `:415-492`, `destination_type=SUPPLIER, destination_id=external/supplier`).
- Cloud **menolak** memproses sendiri bila edge-owned: `backend/src/cloud/postgres/allotments.rs:833-840` — *"Edge-owned allotment must be picked by the authoritative DC"*.
- Edge **tidak bisa** mem-pack ke `external/supplier`: `normalized_destination_site_id` gagal parse, dan query pack menyaring `destination_type <> 'SUPPLIER'` (`backend/src/edge/outbound.rs:1208`, `:1292`). Sementara picking tetap mereservasi (`backend/src/edge/sqlite.rs:3995-4007` tanpa filter tujuan).
- Bandingkan jalur **store** `RETURN_TO_WAREHOUSE` yang lengkap (`backend/src/edge/sqlite.rs:4195+`) — asimetri khusus DC.

**Akibat:** barang tersangkut di area picking Gudang dengan `allotted` permanen.

### B3 — SEDANG ✅ Pool reject Gudang masih `{site}.reject.dc` (legacy); kanonik cloud `{site}.reject`

- Cloud kanonik: `backend/migrations/postgres/0610_...:275-305` + `0622_...:29-33` → warehouse `REJECT` bersuffix `reject` = `{site}.reject`.
- Edge DC: `backend/src/edge/sqlite.rs:3288` → `OperationalPool::DcRejectDc` = `{site}.reject.dc`; `backend/src/edge/flows.rs:552-556` `reject_pool` memilih `DcRejectDc` untuk DC.
- Edge Store (konsisten): `backend/src/edge/sqlite.rs:3299` → `StoreReject` = `{site}.reject`.
- Petunjuk internal edge: `backend/src/edge/http.rs:804-811` (`edge_pool_metadata`) sudah mengharapkan warehouse memakai `{site}.reject`.

**Akibat:** untuk Gudang selain `dc` asli, edge menulis barang rusak ke id pool yang tidak ada di template pusat.

### B4 — SEDANG ✅ `allotted`/`shortfall` hanya dihitung untuk DC, sumbernya hard-code `{site}.warehouse`

`backend/src/edge/sqlite.rs:3339-3396` hanya membangun `allotted_by_pool` bila `EdgeRole::Dc`; `:3413-3422` memberi `allotted = Some(..)` untuk DC dan `None` untuk store, dengan sumber `{site}.warehouse` / `outbound.*` (`:3340-3342`, filter `:3362`). Padahal store bisa punya baris return bersumber dari floor/reject (`:3292-3302`, `:3967-3977`).

Sementara `/api/v1/health` mengiklankan persamaan peran-agnostik `"Stock = On Hand + Allotted + Missing"` (`backend/src/edge/http.rs:744`) dan tipe store sudah `allotted: number | null` (`frontend-store-new/src/lib/queries.ts:148-161`). Komitmen outbound sebuah toko tak terlihat di saldo pool-nya.

### B5 — SEDANG ○ DC inbound receive tanpa `destination_pool_id` menghasilkan cause `StoreReceive` yang dilarang DC

Handler sama dirutekan di `/api/v1/dc/inbound/{id}/receive` (`backend/src/edge/http.rs:229-232`). Bila announcement tak menamai landing pool, cause = `StoreReceive` (`backend/src/edge/sqlite.rs:5263-5283`), namun `contracts.rs:80-85` menolak `(EdgeRole::Dc, MovementCause::StoreReceive)`. Laten (return biasanya menamai Return pool), tetapi handler bersama tidak role-safe untuk DC.

### B6 — RENDAH ○ Supplier return tak dijaga peran di edge

`backend/src/edge/contracts.rs:80-108` (`authorize_line`) membatasi `StoreReceive`, `Sale`, `Opening`, `Identification`/`Tagging`, `ReturnToWarehouse` per role, **tidak** `SupplierReturn`; `backend/src/edge/domain/inventory/movement.rs:307-315` hanya memeriksa on-hand→`external/supplier`. Tak ada endpoint yang memanggilnya sekarang (`move_stock` hanya menerima `NORMAL_MOVE`, `backend/src/edge/sqlite.rs:5509-5514`), jadi laten.

### B7 — RENDAH ○ Rute outbound store subset dari DC, komentar bilang “jalur sama”

Set rute memang berbeda (`backend/tests/testdata/routes.json:691-735` DC vs `:765-798` store); store tak punya session/box/picklist/label/position. Namun komentar `backend/src/edge/http.rs:362-365` dan `frontend-store-new/src/lib/queries.ts:243-247` menyebut *"the same pick, koli, surat jalan and lorry … one outbound path for every site"*. Drift dokumentasi, bukan bug.

### B8 — RENDAH ○ `SiteKind` masih `HO`/`STORE`

`CONTEXT.md:232-240,274-283` memisahkan kind **unit** (`HO`,`STORE`) dari kind **site** (`OFFICE`,`WAREHOUSE`,`SHOP`); kode masih satu enum (`backend/src/ids.rs:89-121`), dan cloud membaca `site.kind` untuk aturan rute (`backend/src/cloud/postgres/allotments.rs:54-88`). Rename setengah jalan.

### B9 — RENDAH ○ Teks penolakan salah role

`backend/src/edge/contracts.rs:86-90` — pasangan `(Store, Opening)` berbunyi *"DC opening is not allowed"* padahal store yang ditolak.

---

## C. Literal `'dc'` (pelanggaran aturan `0603:100`)

Migrasi `0603:100` menetapkan *"never compare a site id to a literal"*; head office ditemukan lewat `kind='HO'`. Yang masih literal:

- Frontend: `frontend-hub/src/screens/inventory/shared.ts:145-149` (`WAREHOUSE_SITE_ID = "dc"`, komentarnya mengakui belum rename); `frontend-hub/src/screens/executive/stock.tsx:78`; `frontend-hub/src/screens/executive/places.ts:36`; `frontend-cloud/src/lib/allotments.ts:519-535` (+ `:546` `humanise "dc"→"DC"`, dirender `components/allotment/allotments-view.tsx:392`, `columns.tsx:35,47,109,178`); `frontend-cloud/src/components/finance/position.tsx:228`.
- SQL cloud: `backend/migrations/postgres/0122_...:91`, `0342_...:59,109`, `0380_...:128-130,239-241`, `0381_...:173-221`, `0005_...:91`.
- Test: `backend/src/cloud/domain/employment/reach.rs:325,356`.

Trigger external-party sudah diperbaiki ke `head_office_site_id()` (`0603:230-244`), **tetapi** `CONSISTENCY-MATRIX.md:25` masih menulis *"Guard membandingkan literal `'dc'`"* — entri itu kini **basi** (lihat §E8).

---

## D. Terminologi vs `CONTEXT.md`

Glosarium melarang kata-kata tertentu; UI aktif memakai banyak di antaranya.

| # | Istilah terlarang | Padanan benar | Lokasi utama (U = user-facing) | Tingkat |
|---|---|---|---|---|
| D1 ✅ | **Shipment / Consignment** | **Surat Jalan** (SJ) | `frontend-hub/src/screens/operations/nav.ts:228`; `.../despatch/consignments.tsx:101,110,122,149,165,222,237,244,259,332`; `.../despatch/trucks.tsx:37,157,186,224,264,296,474,487,512`; wire `backend/src/edge/http.rs:156,172,395` | TINGGI |
| D2 ✅ | **Product** (untuk identitas kita) | **Article** | `frontend-hub/.../commercial/pricelist.tsx:1885,1987,2012,2236`; `price-form.tsx:490,506,528,556,626`; `pricelist-editor.tsx:462,1157`; `changes.tsx:819`; **seluruh** `frontend-store-new` (`lib/navigation.ts:107`, `screens/product.tsx`, `catalogue.tsx:181,348,536`, `movements.tsx:312,380,392`). Bandingkan `rule-form.tsx:955,977` & `master/articles.tsx` yang sudah “Article” | TINGGI |
| D3 ✅ | **Warehouse** untuk back-room toko | **Stockroom** | `frontend-store-new/src/screens/stock/shared.ts:23`; `move-sheet.tsx:56` | SEDANG |
| D4 ✅ | **Central warehouse** | **Gudang** | `frontend-hub/.../setup/company-sheet.tsx:134,137`; `onboarding.tsx:261,264,312,435`; `business-map.tsx:38,194`; `open-stores-sheet.tsx:152`; `system/enrolments.tsx:347` (`Warehouse (DC)`); `system/health.tsx:602`. “Gudang” tak muncul di satu pun string UI | SEDANG |
| D5 ✅ | **Snapshot / balance** | **Checkpoint** | wire `backend/src/sync/inventory.rs:11-30` (`inventory.pool_snapshot.v1`, `PoolSnapshot*`); `frontend-hub/.../system/sync.tsx:136-140`; `nodes.tsx:819`; `counts.tsx:694-696` | SEDANG |
| D6 ✅ | **Goods receipt note / Delivery note** | **Delivery** / **Surat Jalan** | `frontend-hub/src/lib/queries/letters.ts:24,46-51`; `screens/letters/letters.tsx:150,209,311,363,368,395`; `lib/queries/workplace.ts:127`; `screens/letters/document.tsx:220,227,354,369`; `editor.tsx:30-31`; prefix `GRN-` di `backend/src/edge/sqlite.rs:9970` & `backend/src/cloud/domain/sync.rs:2997` (docs mencatat ini gap G2) | SEDANG |
| D7 ✅ | **Units & conversions** | **Satuan / UoM** | `frontend-hub/.../inventory/nav.ts:83-90`; `units.tsx:54,74` | SEDANG |
| D8 ✅ | **Sightings** | **Observation** | `frontend-hub/.../inventory/nav.ts:82`; `observations.tsx:367,373,397`; `pools.tsx:355` | SEDANG |
| D9 ✅ | **Locations** | **Site** | `frontend-hub/.../locations/nav.ts:19,24,28,36`; `hub.tsx:66,74`; `backend/src/cloud/postgres/ga_locations.rs` | SEDANG |
| D10 ○ | **Vendors** | **Supplier** | `frontend-hub/.../vendors/nav.ts:23,28`; `vendors.tsx:146,206` | RENDAH |
| D11 ○ | **Transfer** untuk Claim | **Claim** | `frontend-hub/.../inventory/reconciliations.tsx:29,187,257,327,329` | RENDAH |
| D12 ○ | **Lost / Lost rate** | **Missing** | `frontend-hub/.../inventory/pools.tsx:1023-1024`; `README.md:277` | RENDAH |
| D13 ○ | **Actually in** | **Found** | `frontend-hub/.../inventory/pools.tsx:1244` | RENDAH |
| D14 ○ | **Availability** | **On Hand / Shortfall** | `frontend-hub/.../inventory/nav.ts:70-71`; `availability.tsx:237` | RENDAH |
| D15 ○ | **Role** (telanjang) | **Job Role** | `frontend-hub/.../people/invite-sheet.tsx:116,237,241`; `frontend-employee/src/screens/me.tsx:169`; `frontend-cloud/src/components/nav.tsx:289` | RENDAH |
| D16 ○ | **Adjustments** | **Movement / Shortage / Gain** | `frontend-hub/.../finance/nav.ts:293,447` | RENDAH |
| D17 ○ | **anonymous lot** | **Unidentified** | `backend/src/edge/sqlite.rs:10579` | RENDAH |
| D18 ○ | **counter** (orang) | **Checker** | `frontend-hub/.../operations/intake/receiving.tsx:367,1125` | RENDAH |

**Dokumen** (bukan kode) juga masih memuat istilah terlarang — yang tertaut dari `CONTEXT.md` sendiri: `docs/receiving-verification.md:229,289`, `docs/receiving-count.md:60-64,87,123` (GRN, DC), `docs/purchase-order.md:30,58,124,247,259,267-268`, `docs/inventory-fleet.md:24,30,119,124`, `docs/supplier.md:318`, `docs/sourcing-basket.md:177`, `docs/allotment-v1.md:79,85,95,137,305,308,312,328,355`, `docs/supplier-bill.md:22,27,58,81,141,161`, `docs/product-master.md` (judul “Product master”), `docs/inventory-count.md:97,102,123,125-126,190,271-285`. Serta root docs `INVENTORY-V1.md`, `SIMULATION-PLAN.md`, `DEMO-RFID-BRIEF.md`, `DISTRIBUTION-V1-FREEZE.md`.

**Catatan penting:** beberapa ini warisan yang sudah dicatat sebagai gap (GRN **G2**, over-receipt **G3**) — terhitung, bukan baru. Prioritas utama adalah UI **aktif** (hub, store-new), terutama **D1 dan D2** yang bahkan tidak konsisten di dalam satu app yang sama.

---

## E. Docs vs kode

### E1 — TINGGI ✅ README masih mendeskripsikan frontend yang sudah tidak ada

- Klaim: `README.md:3` *"a dependency-free HTML frontend"*; `:61` *"Axum serves `frontend/`; there is no Node/npm build step"*; `:253` *"dependency-free"*; `:309` *"plain HTML/CSS/JavaScript … not React/TanStack"*.
- Kenyataan: tidak ada direktori `frontend/`; `frontend-cloud/package.json` = Vite + React 19 + TanStack Router/Query/Table; `Makefile:92-98` menjalankan `npm install && npm run build`; `Dockerfile` menyatakan aset browser dideploy terpisah.
- Defaults kode pun menunjuk path mati: `backend/src/cloud/application/mod.rs:130` & `backend/src/edge/node.rs:834` → `../frontend`.

### E2 — TINGGI ✅ “Transport publikasi ke toko belum ada” salah

`README.md:311` menyatakan belum diimplementasikan, padahal lengkap: `backend/src/cloud/domain/sync.rs:1063`, `backend/src/cloud/postgres/sync.rs:5253,5278,5944`, dan `backend/src/edge/sync.rs:308-521` (menerapkan publikasi ke SQLite edge).

### E3 — TINGGI ✅ “Node belum terikat ke satu `site_id`” salah

`README.md:312` menyatakan store bisa beroperasi sebagai store mana pun; padahal `backend/src/edge/node.rs:595` membaca `INVENTORY_SITE_ID` dan `backend/src/edge/sqlite.rs:1396-1404` **menolak startup** bila `(role, site_id, node_id)` DB tidak cocok. `backend/README.md:145` pun sudah mengatakannya.

### E4 — TINGGI ✅ `frontend-dc` (dihapus) masih dirujuk build & docs

- `Makefile:92` `FRONTENDS := frontend-cloud frontend-dc frontend-store-new frontend-employee frontend-customer` → `make front` gagal di `frontend-dc`.
- `render.yaml:340-342` mendeklarasikan service `frontend-dc` dengan `cd frontend-dc && npm install …`.
- `docs/frontend-tanstack.md:3,29,62` menyebut `frontend-dc` dan `frontend-store` (keduanya tidak ada; yang ada `frontend-store-new` + `frontend-hub`).
- Commit penghapus: `git log` → `9d182dd "Remove frontend-dc and frontend-dc-new"`.

### E5 — TINGGI ✅ Cause movement manual di README tidak cocok dengan rute

`README.md:214` menyebut `NORMAL_MOVE`, `SALE`, `SUPPLIER_RETURN`; handler `POST /api/v1/inventory/movements` justru menerima `["NORMAL_MOVE", "RETURN_TO_WAREHOUSE", "RETURN_TO_DC"]` dan menolak `SALE`/`SUPPLIER_RETURN` (`backend/src/cloud/http/mod.rs:2726-2734`). Layer bawah (`backend/src/cloud/postgres/movements.rs:34-40`) menerima set ketiga lagi — HTTP dan DB tidak sepakat.

### E6 — SEDANG ✅ Hitungan pool demo basi

`README.md:94` menyebut 112 pool / 224 place, `:293` “60 expected pools”; kenyataan sekarang **99** pool (60 DC + 39 store), per `backend/tests/inventory_integration.rs:75-94` (yang menyebut 112 hanya sampai migrasi `0252`). README bahkan bertentangan sendiri (112 vs 60).

### E7 — SEDANG ○ `backend/README.md` basi

- `:47` “satu-satunya auxiliary crate aktif” — padahal 5 crate di `backend/Cargo.toml:2`.
- `:17-26` menyebut pool `dc-01.pending.untagged` (dihapus `0651`) dan `dc-01.outbound.picked.store-07` (digantikan `dc.outbound.picking` oleh `0252`).
- `:112` menyebut `app.js`, `styles.css`, `auth.js` yang tidak ada di `backend/src`.

### E8 — SEDANG ○ `CONSISTENCY-MATRIX.md` memuat gap yang sudah basi

- `:25` “Guard membandingkan literal `'dc'`” — sekarang `head_office_site_id()` (`0603:230-244`).
- **S2** (`:116`) — `sales_posting.rs:1428` kini menangkap `Conflict`, bukan hanya `Validation`; stok kurang tidak lagi membatalkan sales day. Sitasi `:1632` sudah bukan handler.
- **B2** (`:122`) — `backend/src/cloud/http/exit.rs` kini 435 baris, **tak ada** `SUM(`; file sudah di-commit. Baris `:385/:406` basi.
- **S5** (`:119`) — `stock.value_vs_gl` kini diproduksi (`opening.rs:1226,1571`); referensi `integrity.rs:1547` juga salah file (yang benar postgres `integrity.rs:1544`).
- Tanggal `:3` (26 Sep) & bagian 6 sudah historis; migrasi kini sampai `0705_*`.

### E9 — RENDAH ○ Lain-lain

`README.md:117` menyebut `sale_number_sequence` sebagai tabel (padahal `CREATE SEQUENCE`, `0003_commercial_sales.sql:49`); pohon modul `README.md:151-168` & `backend/README.md:40-48` tidak lengkap; `docs/finance-bank-audit.md:137` menyebut konstanta `poster::HEAD_OFFICE_SITE` yang tidak ada.

### Yang sudah terverifikasi cocok

Sitasi API inventory/commercial di README semuanya ada; angka seed demo (6 article, 18 SKU, 3.600 UNIT + 24 QUANTITY, 601 sighting, 3.705 movement) cocok `0002`/`0003`; katalog invariant tepat 35 (`backend/invariants/**/*.sql`); referensi migrasi di `CONSISTENCY-MATRIX` (0051, 0120, 0140, 0283, 0288, 0376/0380, 0090, 0165, 0170, 0385) semuanya resolve; gap **G7** masih berlaku (`0300` vs CHECK `0288`).

---

## F. Build, aset, dan bundle kontrak

### F1 — SEDANG ✅ Dua bundle kontrak, satu basi dan tak dipakai

- **Otoritatif:** `frontend-contract/src/contract` — **1.048 file tracked**, digenerate oleh `make contract` (`Makefile:53-55` → `cargo test --features ts --test contract_types`) yang menulis `out_dir("../frontend-contract/src")` (`backend/tests/contract_types.rs:35`). Semua frontend mengimpor lewat path tsconfig `@itulah/contract → ../frontend-contract/src/index.ts` (`frontend-hub/tsconfig.app.json:24-30`, `frontend-store-new/...`).
- **Basi:** `backend/bindings/contract` — **292 file tracked**, tidak dirujuk apa pun, tertinggal di commit `d1257b8` (sementara `frontend-contract` sudah di `1e4a879`). Ini artefak default `ts_rs` (`export_to = "contract/"` di banyak struct, mis. `backend/src/clock.rs:43`) yang ditulis ke `backend/bindings/` bila test dijalankan tanpa override.

**Risiko:** dua “sumber kebenaran” untuk tipe wire; pembaca bisa memakai yang basi. Kandidat jelas untuk dihapus atau di-`.gitignore`.

### F2 — RENDAH ✅ `FRONTEND_DIR` default menunjuk direktori yang tidak ada

`backend/src/cloud/application/mod.rs:130` dan `backend/src/edge/node.rs:834` → `../frontend`. Lihat §E1.

### F3 — TINGGI ✅ lihat §E4 (Makefile & render.yaml menunjuk `frontend-dc`).

---

## Lampiran — prioritas perbaikan

| Prioritas | Item | Dampak |
|---|---|---|
| 1 | §A1 kunci dedup sync `(origin_id, event_id)` | kehilangan data senyap lintas toko |
| 2 | §B2 jalur supplier-return di DC edge | stok nyangkut permanen |
| 3 | §B1 tegakkan larangan toko→toko di cloud Rust + edge (bukan hanya trigger 0628) | rute terlarang lolos validasi |
| 4 | §E1–E5 + §F3 perbaiki README, Makefile, render.yaml, `docs/frontend-tanstack.md` | onboarding & CI/deploy rusak |
| 5 | §A2 tambah arm `validate_issued_command` + hapus default permisif | command malformed memblokir stream |
| 6 | §D1 + §D2 samakan terminologi di UI hub & store-new | satu app memakai dua kata untuk satu konsep |
| 7 | §B3 samakan pool reject Gudang `{site}.reject` | pool tidak dikenal template pusat |
| 8 | §B4 hitung `allotted` per peran dari sumber yang benar | laporan saldo store menyesatkan |
| 9 | §A3 satukan enum `MovementCause` (atau dokumentasikan sengaja) | jebakan refactor |
| 10 | §E8 perbarui `CONSISTENCY-MATRIX.md` (S2, B2, S5, baris 25, tanggal) | peta konsistensi menyesatkan |
| 11 | §F1 hapus/ignore `backend/bindings/contract` | dua bundle kontrak |
