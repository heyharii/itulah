# Inventory Backend: Cloud + DC/Store Edge

Satu package `inventory-backend` menyediakan tiga server dengan domain Cloud dan Edge yang tetap terpisah:

- **Cloud** — PostgreSQL, HTTP application lengkap, default `127.0.0.1:8080`.
- **DC Edge** — SQLite lokal, default `dc-01` di `127.0.0.1:8081`.
- **Store Edge** — SQLite lokal terpisah, default `store-07` di `127.0.0.1:8082`.

DC dan Store dapat beroperasi tanpa berkomunikasi satu sama lain. Store mencatat penerimaan fisik sebagai fakta lokal dan langsung menaruh barang di `StoreWarehouse`, sehingga operasi Store tidak bergantung pada server lain.

## Model inventory

Pool tetap menjadi lokasi stok authoritative. `movement_group` dan `movement` adalah ledger append-only; `inventory_projection` adalah saldo turunan yang diperbarui dalam transaksi SQLite yang sama.

Lifecycle DC (penerimaan sampai In Transit):

```text
dc-01.pending.unidentified
dc-01.warehouse
dc-01.outbound.picking
dc-01.outbound.packed
dc-01.outbound.shipment
dc-01.outbound.loaded
dc-01.outbound.in-transit
```

`pending.untagged` sudah dihapus (0651: barang yang sudah teridentifikasi langsung menjadi stok Gudang) dan `outbound.picked.{store}` digantikan satu Pick Area bersama `outbound.picking` yang tidak menyebut tujuan (0252).

Lifecycle Store:

```text
STORE_RECEIVE: system/opening -> store-07.warehouse:on_hand
NORMAL_MOVE:   store-07.warehouse:on_hand -> store-07.floor:on_hand
SALE:          store-07.floor:on_hand -> external/customer
```

Ledger DC dan Store sengaja independen. Setelah Store menerima barang, saldo DC tetap berada di In Transit pada database DC; pencocokan lintas-edge dapat ditambahkan kelak tanpa menghalangi penerimaan atau penjualan lokal.

## Struktur workspace aktif

```text
src/cloud/            domain, application, intake, reports, HTTP, dan adapter PostgreSQL Cloud
src/edge/             domain/contracts, node, sync, HTTP, dan adapter SQLite Edge
src/sync/             engine sync bersama (port, handshake, transfer, workflow)
src/bin/              composition root cloud, dc, dan store
migrations/postgres/  versioned PostgreSQL migrations
migrations/sqlite/    schema ledger/projection SQLite Edge
config/               contoh environment DC dan Store
crates/               auxiliary crates: inventory-time-machine, object-store, pricing-engine, sim, tax
```

Kode PostgreSQL lama sengaja dipreservasi di `src/cloud/` dan `migrations/postgres/`; Pool, allotment, movement, count, observation, Sales/POS, returns, auth, sync, reports, dan time-machine tetap dikompilasi sebagai runtime `cloud`. Binary `dc` dan `store` hanya menyusun namespace `edge` dan tidak memerlukan Cloud/PostgreSQL untuk startup atau operasi lokal.

## Scope operasional dan batas deployment

Runtime SQLite Edge saat ini menyediakan:

- DC intake dan movement bertahap sampai `Loaded` lalu `In Transit`;
- Store receipt lokal langsung ke Warehouse tanpa inbound pending;
- Store movement Warehouse → Floor dan cash sale sederhana;
- pembacaan Pool/projection dan movement ledger;
- idempotent retry yang terikat ke payload request yang sama serta ledger append-only yang dijaga trigger SQLite.

Allotment, official count, returns, reporting, dan time-machine tetap tersedia pada Cloud/pure domain. Authentication dan RFID observation sekarang juga berjalan native pada SQLite Edge: login tidak memerlukan Cloud, RFID evidence tersimpan lokal, dan batch yang sama masuk ke outbox secara atomik. Setiap Edge selalu menulis bootstrap dan snapshot penuh Pool `inventory.pool_snapshot.v1` ke outbox SQLite dalam transaksi movement yang sama; snapshot ini hanya observability owner-scoped dan tidak berisi subject UUID maupun diterapkan sebagai movement ledger Cloud. `SYNC_UPLOAD_URL` hanya mengaktifkan sender opsional—tanpa URL backlog tetap ditangkap lokal. Generation hanya boleh dinaikkan setelah seluruh fakta generation lama diakui. Transfer manifest dan koneksi peer DC→Store belum tersedia, sehingga `STORE_RECEIVE` tetap menjadi bukti penerimaan lokal dan saldo DC sengaja tetap `InTransit` setelah Store menerima atau menjual barang.

HTTP Cloud dan Edge memakai opaque session yang revocable, Argon2id password verifier, idle/absolute expiry, account cooldown, HttpOnly `SameSite=Strict` cookie, CSRF protection, serta RBAC yang diperiksa server. Edge menerima complete versioned auth projection lewat signed downstream command; password Cloud tidak pernah disalin karena assignment memakai Edge-only PIN/password minimal 8 karakter. Policy mulai diperbarui setelah 12 jam; lease default cashier/device adalah 7 hari, sedangkan supervisor/admin dibatasi maksimal 24 jam. Revocation berlaku di Edge pada successful sync berikutnya dan semua identity/device fail closed ketika lease offline-nya habis. `INVENTORY_AUTH_MODE=required` adalah default. Mode `disabled` hanya untuk development terisolasi. Default bind loopback dan firewall tetap harus dipertahankan; application auth bukan pengganti segmentasi jaringan. Setiap node wajib memakai file SQLite sendiri; database yang identity site/role-nya berbeda akan ditolak saat startup.

RFID enrollment key hanya ditampilkan satu kali. Cloud dan Edge menyimpan derived HMAC verifier, bukan raw enrollment key, tetapi verifier tersebut tetap signing-equivalent: siapa pun yang mencuri database dapat memalsukan request/command sesuai scope-nya. Lindungi database dan backup dengan full-disk encryption, permission OS yang ketat, secret unik per node/device, dan rotasi segera setelah indikasi compromise.

Sesudah login pertama, `LOCAL` break-glass admin dapat merotasi password sendiri melalui `POST /api/v1/auth/change-password`; semua session milik identity tersebut langsung direvoke. Simpan password baru di password manager lalu hapus `INVENTORY_BOOTSTRAP_ADMIN_PASSWORD` dari environment file. Credential user `CLOUD` tidak dapat diubah di Edge dan harus dirotasi dari assignment Cloud agar signed policy tetap menjadi authority tunggal.

## Edge → Cloud fact inventory dan checkpoint

Cloud mempertahankan dua sumber inventory yang terpisah:

- `CLOUD_LEDGER`: ledger PostgreSQL native dan satu-satunya sumber yang dapat dimutasi dari frontend Cloud;
- `EDGE_FACT_POSITION`: current-view read-only per origin DC/Store yang dibangun hanya dari movement facts Edge dan tidak pernah ditulis ke `movement`/`inventory_projection` Cloud.

`GET /api/v1/inventory/fleet-pools` menampilkan owner → site → group, termasuk destination leaf dan lima rollup outbound DC. ID yang sama dari owner berbeda tidak digabung. Credential owner aktif selalu shadow row Cloud pada site yang sama, termasuk sebelum checkpoint pertama. Snapshot Pool tetap disimpan sebagai checkpoint independen untuk rekonsiliasi sequence-bounded; snapshot yang stale/missing dapat membuat `fleet_total` berstatus `UNCERTIFIED`, tetapi tidak pernah memasok current quantity. Exact claim DC In-Transit dan Store Received dicocokkan dengan `(source_dc_id, destination_store_id, shipment_reference, EPC)`, diikat ke immutable package unit/Allotment, dan dipakai untuk mengurangi overlap In-Transit secara capped. `sync_status` memakai umur fact watermark Cloud; `checkpoint_status` dan `source_capture_age_seconds` mendiagnosis checkpoint terpisah.

Sebelum sender diaktifkan, daftarkan binding owner di Cloud dengan key acak minimal 32 karakter. `SYNC_UPLOAD_URL` adalah **base URL receiver**, misalnya `http://127.0.0.1:8080`; jangan tambahkan `/api/v1/sync/ingest` karena transport menambah path tersebut sendiri. Pada authenticated Cloud, master `SYNC_INGEST_KEY` hanya untuk provisioning/administration dan tidak pernah diterima sebagai identity ingest origin yang belum terdaftar.

```zsh
curl -X POST http://127.0.0.1:8080/api/v1/sync/origins \
  -H "x-sync-key: $SYNC_INGEST_KEY" \
  -H "Authorization: Bearer $CLOUD_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "origin_id":"store-07-edge",
    "ingest_key":"replace-with-32-plus-random-characters",
    "label":"Store 07",
    "site_id":"store-07",
    "node_role":"STORE",
    "active_generation":1,
    "inventory_enabled":true
  }'
```

Header Bearer atau browser session cookie diperlukan ketika `INVENTORY_AUTH_MODE=required` (default), dan principal harus role `ADMIN`; `x-sync-key` juga wajib pada authenticated Cloud. Untuk rollover, aktifkan `active_generation=N` di Cloud **lebih dahulu**, lalu ubah Edge ke generation yang sama. Jika Edge terlanjur mengirim generation masa depan, Cloud memberi HTTP 409 tanpa membuat durable watermark sehingga bootstrap tetap antre dan aman di-retry. Generation lama yang sudah stale tetap ditombstone agar tidak dapat menimpa current-view baru.

Executable deployment sekarang adalah `cloud`, `dc`, dan `store`; migrasi PostgreSQL otomatis dijalankan saat `cloud` startup. Upgrade instalasi lama yang masih memanggil `inventory-edge` atau `migrate` harus mengubah service/release command secara terkoordinasi sebelum binary lama dihapus. Unit baru `deploy/edge/store-edge.service` sudah menjalankan `/usr/local/bin/store`.

## Validasi terakhir

Dari direktori `backend`, source dan seluruh target workspace telah lolos:

```zsh
cargo fmt --all --check
cargo check --locked --workspace --all-targets --all-features
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
DATABASE_URL=postgresql:///postgres cargo test --locked --workspace
```

Workspace test mencakup unit/property tests, auth Cloud/DC/Store/RFID, catalog dan workflow sync, Edge↔Cloud, Inventory, POS, reconciliation, purchase/tagging, time-machine, API flow, doc tests, serta suite auxiliary inventory-time-machine. Smoke tiga proses Cloud/DC/Store juga memverifikasi bahwa kedua Edge tetap menerima movement saat Cloud mati, restart mempertahankan file SQLite/outbox, lalu backlog generation 1 drain tanpa rejection. Fleet Cloud menampilkan owner DC dan Store secara terpisah; quantity berasal dari fact positions, sedangkan snapshot hanya menentukan kesehatan checkpoint/certification. Binary tidak lagi membundel `app.js`, `styles.css`, atau `auth.js`: node melayani berkas SPA dari `FRONTEND_DIR` (instalasi terpasang memakai `<exe>/web`, default dev `../api-only` yang memang kosong), dan konsol node loopback disajikan dari `console.html` yang di-embed.

## Menjalankan tiga server

Gunakan tiga terminal dari direktori `backend`. Setiap Edge memuat environment sendiri agar database dan port tidak bertabrakan; Cloud memakai PostgreSQL dan menjalankan seluruh versioned migration saat startup.

Terminal Cloud:

```zsh
DATABASE_URL=postgresql:///inventory_edge_dev \
SYNC_INGEST_KEY=replace-with-32-random-characters \
INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=replace-before-first-run \
cargo run --bin cloud
```

Terminal DC:

```zsh
set -a
source config/dc.env.example
set +a
cargo run --bin dc
```

Terminal Store:

```zsh
set -a
source config/store.env.example
set +a
cargo run --bin store
```

Untuk instalasi nyata, salin contoh environment ke file lokal yang tidak di-commit dan ubah site ID, node ID, path database, serta bind address. Database yang pernah dimiliki node/site lain akan ditolak saat startup.

## HTTP API

Common pada kedua edge:

- `GET /api/v1/health`
- `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`
- `POST /api/v1/rfid/observations` (device-signed; optional human bearer for attribution)
- `GET /api/v1/inventory/pools`
- `GET /api/v1/inventory/movements?limit=100`

DC Edge:

- `POST /api/v1/dc/intake`
- `POST /api/v1/dc/movements`

Store Edge:

- `POST /api/v1/store/receive`
- `POST /api/v1/store/movements`
- `POST /api/v1/store/sales`

Endpoint movement umum hanya menerima `NORMAL_MOVE`; intake, receipt, dan sale wajib melalui endpoint khusus agar evidence dan transaksi bisnisnya tetap lengkap.

### Contoh lifecycle

Intake di DC:

```zsh
curl -X POST http://127.0.0.1:8081/api/v1/dc/intake \
  -H 'content-type: application/json' \
  -d '{
    "epc":"EPC-0001",
    "sku_code":"SKU-001",
    "unit_price_minor":150000,
    "actor_id":"dc-receiver",
    "idempotency_key":"dc-intake-0001"
  }'
```

Gerakkan EPC satu tahap per request. Contoh Shipment ke Loaded:

```zsh
curl -X POST http://127.0.0.1:8081/api/v1/dc/movements \
  -H 'content-type: application/json' \
  -d '{
    "epc":"EPC-0001",
    "quantity":1,
    "from":"dc-01.outbound.shipment.store-07:on_hand",
    "to":"dc-01.outbound.loaded.store-07:on_hand",
    "cause":"NORMAL_MOVE",
    "reason":"Dispatch confirmed",
    "actor_id":"dc-operator",
    "idempotency_key":"dc-dispatch-0001",
    "reference_type":"SHIPMENT",
    "reference_id":"SHIP-0001"
  }'
```

Tahap berikutnya adalah Loaded ke In Transit dengan endpoint yang sama dan idempotency key baru.

Store menerima langsung ke warehouse, tanpa pending dan tanpa membaca database DC:

```zsh
curl -X POST http://127.0.0.1:8082/api/v1/store/receive \
  -H 'content-type: application/json' \
  -d '{
    "epc":"EPC-0001",
    "sku_code":"SKU-001",
    "unit_price_minor":150000,
    "source_dc_id":"dc-01",
    "shipment_reference":"SHIP-0001",
    "actor_id":"store-receiver",
    "idempotency_key":"store-receive-0001"
  }'
```

Setelah `NORMAL_MOVE` dari `store-07.warehouse:on_hand` ke `store-07.floor:on_hand`, selesaikan sale:

```zsh
curl -X POST http://127.0.0.1:8082/api/v1/store/sales \
  -H 'content-type: application/json' \
  -d '{
    "epcs":["EPC-0001"],
    "tenders":[{"method":"CASH","amount_minor":200000}],
    "actor_id":"cashier-07",
    "idempotency_key":"store-sale-0001"
  }'
```

Sale dibayar dengan daftar tender, bukan satu angka. Setengah kartu setengah tunai adalah basket biasa, dan `reference` diisi untuk rekonsiliasi bank — nama acquirer atau approval code, tidak pernah nomor kartu (dua belas digit atau lebih ditolak di pintu masuk):

```zsh
curl -X POST http://127.0.0.1:8082/api/v1/store/sales \
  -H 'content-type: application/json' \
  -d '{
    "epcs":["EPC-0002"],
    "tenders":[
      {"method":"CARD","amount_minor":150000,"reference":"BCA auth 4471"},
      {"method":"CASH","amount_minor":100000}
    ],
    "actor_id":"cashier-07",
    "idempotency_key":"store-sale-0002"
  }'
```

Hanya `CASH` yang boleh melebihi total, karena hanya tunai yang memberi kembalian. Kartu yang ditagih di atas nilai basket ditolak, bukan diterima sebagai kembalian.

Semua command mutasi memerlukan idempotency key. Gunakan key baru untuk command baru dan ulangi key yang sama hanya untuk retry request yang sama.
## Authentication dan RFID offline

Cloud adalah source of truth untuk user assignment dan device scope, tetapi bukan dependency pada setiap login. Satu signed `auth.policy.replace` membawa snapshot lengkap khusus satu origin. Edge menolak rollback version, mempertahankan session saat lease renewal biasa, dan langsung mengakhiri session bila user dinonaktifkan atau `auth_version` berubah. Cashier lease default tujuh hari; Supervisor/Admin dibatasi maksimum 24 jam. Jika sync terputus melewati lease tersebut, login/session yang diproyeksikan berhenti dan perlu Cloud reconnect; break-glass user lokal tetap terpisah.

RFID reader didaftarkan lewat `POST /api/v1/auth/rfid-devices`; raw key ditampilkan sekali. Setiap batch ke `/api/v1/rfid/observations` menandatangani method, path, device ID, Unix timestamp, monotonic sequence, dan SHA-256 exact body. Edge memeriksa HMAC, ±5 menit clock skew, sequence replay, active lease, site, dan allowed Pool. Key dapat dicabut atau dirotasi dari Cloud. Observation hanya evidence dan tidak pernah langsung membuat movement/Missing.

HTTP tetap default bind ke loopback. Untuk akses lintas host, gunakan private WireGuard/Headscale network, host firewall, TLS pada browser-facing boundary, `INVENTORY_AUTH_COOKIE_SECURE=true`, full-disk encryption, backup SQLite/PostgreSQL, dan alert untuk policy/sync staleness.
