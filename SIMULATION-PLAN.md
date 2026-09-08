# Simulator — menjalankan bisnis lewat API

**Tanggal:** 2026-09-06 · **Status:** proposal (belum ada kode) · **Pendahulu:** `~/Documents/retail/cmd/simbot` (Go)

Dokumen ini merancang subsistem simulasi untuk backend itulah: sebuah program yang
memerankan pemasok, pembeli HO, staf DC, staf toko, kasir, pelanggan, handheld RFID,
HR dan keuangan, lalu menjalankan bisnis itu **hanya lewat HTTP API produksi** —
cloud (Postgres), DC edge (SQLite), store edge (SQLite) — sambil membuktikan bahwa
apa yang sistem laporkan sama dengan apa yang benar-benar terjadi.

Ia dirancang dari kegagalan simbot lama, yang dicatat oleh audit simbot sendiri
(`BUILD-PROMPT-SIMBOT-2026-07-05.md`, `.kiro/specs/api-coverage-simulation/PLAN.md`,
`plans/010-gate-sim-mock-handlers.md`, `simbot-review-prompt.md`). Bagian §1 merangkum
kegagalan itu supaya tidak diulang; sisanya adalah rancangan barunya.

---

## 0. Keputusan dalam satu layar

| # | Keputusan | Pilihan | Alasan singkat |
|---|---|---|---|
| 1 | Di mana kode simulator hidup | Crate baru `backend/crates/sim` (lib + bin `sim`), anggota workspace, bergantung ke `inventory-backend` | Nol kode simulasi di binary `cloud`/`dc`/`store`; direktori `crates/core|pg|sqlite|edge-*` dan `apps/*` ternyata kosong tanpa satu commit pun, jadi bukan tempat bersandar |
| 2 | Bagaimana simulator mencapai sistem | Dua harness, satu kode actor: **in-process** (router asli lewat `tower::oneshot`, sync lewat trait `SyncTransport`) dan **live** (HTTP ke proses nyata) | In-process sudah terbukti di `tests/full_chain_integration.rs` (`Fleet`: cloud + DC + toko satu proses); ini yang membuat CI, determinisme, dan kecepatan mungkin |
| 3 | Aksi apa yang boleh lewat SQL | **Tidak ada.** Setiap aksi manusia lewat endpoint; SQL hanya untuk *membaca* saat memeriksa invariant | Simbot lama punya 12 actor yang menulis Postgres langsung, dan jalur itu tak pernah dilalui produksi |
| 4 | Waktu | Jam bisnis virtual, discrete-event (antrian intent ber-timestamp, resolusi menit); jam keamanan (sesi, lockout, breaker) tetap jam dinding | Cron lama meruntuhkan job sub-harian jadi 1×/hari; sesi yang kedaluwarsa karena jam virtual bukan bug bisnis |
| 5 | Determinisme | Satu `seed` per run → RNG per (run, actor, hari); loop event tunggal; ID inventory deterministik lewat macro `uuid_id!` (satu file) | Separuh actor lama seed dari `time.Now()`, fan-out 8 worker: tak ada run yang bisa diulang |
| 6 | Kegagalan | Non-2xx pada intent mutasi = **gagal**, kecuali intent mendeklarasikan penolakan yang diharapkan; 404 pada route yang ada di katalog = gagal | Probe lama menghitung 404 sebagai sukses; sim hijau sementara API tak pernah tersentuh |
| 7 | Kebenaran | Tiga keluarga invariant, semuanya run-scoped: struktural (per node), konvergensi (antar node setelah sync tenang), ekspektasi (dunia simulator vs laporan sistem) | Simbot lama hanya punya SQL global berjendela "5 menit terakhir"; tak punya model dunia, jadi tak bisa tahu kalau sistem melaporkan angka yang salah tapi konsisten |
| 8 | Isolasi & keamanan | Satu database per run, state run di proses simulator, tak pernah migrasi DB hidup, tolak `DATABASE_URL` non-lokal tanpa `SIM_ALLOW_REMOTE=1` | Flag pause lama global di tabel bisnis; simbot `ALTER TABLE` saat boot; handler sim ter-mount di produksi |
| 9 | Kendali | `sim` punya API sendiri (`:8090`, `/api/v1/sim/...` + SSE) dan CLI yang memakai API yang sama; modul **Simulation** di hub (fase 4) | "Pakai API, dan kita bisa simulasikan" — dari hub, dari CI, dari terminal, satu permukaan |
| 10 | Yang **tidak** dibawa | Bot browser yang meng-assert teks UI; OTel; blueprint "3-in-1" (game perencanaan bisnis, tak pernah dibangun) | Masing-masing bukan bagian dari "menjalankan sistem lewat API" |

---

## 1. Apa yang salah pada simbot lama, dan jawabannya

Simbot lama bukan program kecil: ~46 actor terdaftar (HQ/DC/toko/pelanggan/pemasok),
scheduler cron dari tabel `sim_schedule`, sentinel 38 invariant SQL, virtual clock
"12 bulan dalam 24 menit", katalog coverage endpoint, sepuluh mode. Yang bagus
darinya **dibawa**: kontrak passthrough jam virtual, invariant sebagai data dengan
severity, korelasi per request, coverage endpoint sebagai keluaran, guard destruktif
yang fail-closed, `sim_result.json`. Yang berikut ini **tidak** dibawa.

| Kelemahan lama (bukti) | Akibat | Jawaban di rancangan baru |
|---|---|---|
| Kegagalan ditelan: `Probe.IsOK` menghitung 404 sukses; `Tolerate:` list; `return 0, nil` setelah error; kasir multi-terminal sukses selama satu terminal hidup | Route mati dan payload salah tak pernah terlihat; endpoint returns "teruji" padahal 400 selamanya | §2 P3: setiap intent membawa `expect` (2xx atau penolakan spesifik); selisih = failure dengan request+response tersimpan |
| 12 actor HQ menulis `journal_entries`/`inventory_movements` langsung; `period_end_pack` menutup periode dengan SQL fallback; bootstrap `ALTER TABLE` | Sim memvalidasi jalur yang produksi tak pernah lalui; skema produksi diubah simulator | §2 P1: nol SQL tulis; endpoint yang belum ada = **gap produk** yang dilaporkan, bukan disiasati |
| *Phantom stock*: `pos-mirror` memalsukan stok saat oversell + memposting jurnal penyeimbang agar invariant tetap hijau (pengakuan di `phantom.go`) | Pemeriksa dibohongi oleh sistem yang diperiksanya | §2 P4: simulator membaca stok lantai sebelum menjual; SUT tak pernah "membetulkan" diri |
| Determinisme separuh: `store_stock`, `store_admin`, `dc_grn_processor`, kedua scenario pack seed dari `time.Now().UnixNano()`; fan-out 8 worker | Tak ada run yang bisa diulang; bug tak bisa direproduksi | §4.3: satu seed, loop event tunggal, jam virtual, ID deterministik; replay = properti, bukan fitur |
| Assertion berjendela jam dinding (`posted_at >= NOW() - 5 minutes`), flag pause global di `integration_settings` | Dua run di satu DB saling mencemari; repro dan soak tak bisa berbagi | §2 P5: DB per run; setiap pemeriksaan di-scope ke run |
| `Spec` mode tak dibaca (hanya `Description`, `Destructive`, `Daemon`): `-coverage-floor` diabaikan di `-mode acceptance` **termasuk di CI**, `chaos` identik dengan `acceptance`, `-mode load` selalu exit 1 | Gate CI tidak menggerbangi apa pun | §7: mode = file skenario; satu loader; test yang membuktikan setiap field mengubah perilaku |
| Handler `inventorysim`/`mockedc` ter-mount di semua build; plan 010 (`ENABLE_SIM_ENDPOINTS`) tak pernah dieksekusi; empat service produksi hidup di package bernama `inventorysim` | Endpoint yang menulis stok & GL nyata terbuka di produksi | §3.1: simulator crate terpisah; backend hanya dapat dua seam berdefault produksi |
| Auth fasad: `CloudTOTPProvider`/`StorePINProvider` ada tapi semua actor memakai API key global `demo-api-key-ho` | RBAC, scope, 403 tak pernah teruji | §4.5: akun nyata per peran, PIN kasir di edge, HMAC handheld, matriks negatif |
| Virtual clock ditempel belakangan: 38 `CURRENT_DATE` di-patch jadi `COALESCE(sim_clock…)`; cron sub-harian runtuh jadi 1×/hari; `time.Sleep` di mock hardware tak ikut terkompresi | Tahun terkompresi bukan tahun yang diperkecil, tapi tahun berbentuk lain | §4.2: discrete-event scheduler dengan resolusi menit; fake hardware tanpa sleep; seam jam dirancang dari awal |
| Topologi hard-coded (13 store ID tiga kali di `bootstrap.go`, UUID lokasi literal); konfigurasi di env + `os.Getenv` + 3 tabel DB | Menambah toko = edit Go | §7: topologi di file skenario; konfigurasi terselesaikan disimpan di hasil run |
| Seam repro `-mode repro -fingerprint` ada, tapi `cmd/bugops` memanggil flag lama; `repro-map.yaml` semua mapping dikomentari | Integrasi unggulan tak pernah tersambung | §6.4: artefak reproduksi = intent log + fixture time-machine yang dihasilkan otomatis saat divergen |
| Test pengaman teater: `flow7_offline_resilience_test.go` meng-assert baris yang ditulisnya sendiri; `chaos_test.go` berakhir `if ok { t.Log }` | Test yang tak punya jalur gagal | §2 P7: setiap skenario punya jalur gagal terbukti (mutation check via `corrupt_projection_for_test`) |
| `internal/syncmetrics` tanpa importer; `GenerateStatement` tanpa route; `MOCK_RFID_TAG_FAIL_RATE` didokumentasikan tapi inert | Beban tanpa nilai | Fitur masuk hanya bersama skenario yang memakainya |

---

## 2. Prinsip (tidak bisa ditawar)

- **P1 — Lewat API, atau tidak sama sekali.** Setiap aksi manusia → endpoint HTTP di node yang benar. Endpoint yang tidak ada bukan alasan menulis SQL; ia jadi baris di laporan *product gap*. SQL hanya untuk membaca saat invariant diperiksa, dan hanya di harness (bukan di actor).
- **P2 — Satu seed, satu cerita.** Semua keacakan dari RNG yang diturunkan dari `(seed, actor_id, hari_virtual)`. Loop event tunggal (tokio `current_thread`) di harness in-process. Run yang sama dua kali = intent log yang identik.
- **P3 — Tidak ada kegagalan yang ditelan.** Setiap intent membawa ekspektasi: `2xx`, atau penolakan spesifik (`409 stok tidak ada di lantai`, `403 kasir tak boleh void`). Selisih apa pun = *failure* dengan request, response, dan state dunia tersimpan. 404 pada path yang ada di katalog route = failure. Tidak ada daftar `tolerate`.
- **P4 — Dunia adalah ekspektasi, sistem adalah kenyataan.** Simulator menyimpan model dunianya sendiri (stok per pool, kas per shift, poin member, buku harga yang seharusnya sampai di toko) dan membaca sistem sebelum bertindak. Ia **tidak pernah** memasok sistem dengan state agar pemeriksaan lolos.
- **P5 — Run terisolasi.** Database Postgres sendiri (`sim_<run>`), file SQLite sendiri, state run di memori/disk simulator. Tidak ada flag global di tabel bisnis. Tidak pernah menjalankan migrasi pada database yang tidak ia buat.
- **P6 — Nol kode simulasi di binary produksi**, kecuali dua seam yang defaultnya persis perilaku produksi: `Clock` (default `SystemClock`) dan endpoint kontrol yang sudah ada di balik `INVENTORY_ENABLE_TEST_CONTROLS`.
- **P7 — Setiap pemeriksa punya jalur gagal yang terbukti.** Mutation check: skenario `smoke` dijalankan sekali lagi dengan `corrupt_projection_for_test` dan **wajib merah**. Skenario yang tak pernah bisa gagal tidak boleh masuk CI.
- **P8 — Satu sumber konfigurasi.** Skenario = satu file TOML (topologi, profil permintaan, durasi, rencana chaos, invariant yang aktif, floor coverage). Hasil run menyimpan konfigurasi yang terselesaikan, seed, dan commit backend.

---

## 3. Arsitektur

```
                               ┌─────────────────────────────────────────────────┐
                               │  sim  (crates/sim — lib + bin)                   │
  CLI ─────► control API ────► │  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │
  hub  ◄──── SSE events ────── │  │ scenario │─►│  world   │◄─│ demand profile │ │
                               │  └──────────┘  └────┬─────┘  └────────────────┘ │
                               │                     │ intents (virtual time)     │
                               │  ┌──────────────────▼──────────────────┐        │
                               │  │ DES scheduler + SimClock + RNG(seed) │        │
                               │  └──────────────────┬──────────────────┘        │
                               │            actors (personas) — API only         │
                               │  ┌──────────────────▼──────────────────┐        │
                               │  │ Node client: InProcess | Http        │        │
                               │  └───┬──────────────┬──────────────┬───┘        │
                               │      │              │              │            │
                               │  ┌───▼────┐   ┌─────▼─────┐  ┌─────▼─────┐      │
                               │  │ cloud  │◄──│ dc edge   │  │store edge │      │  fakes: printer sink,
                               │  │Postgres│──►│ SQLite    │  │ SQLite    │      │  RFID reader, terminal
                               │  └───┬────┘   └─────┬─────┘  └─────┬─────┘      │  (tanpa sleep)
                               │      └── sync (run_cycle / SyncTransport) ───┘   │
                               │  ┌──────────────────────────────────────────┐   │
                               │  │ invariants: structural · convergence ·   │   │
                               │  │ expectation  → run-scoped, severity      │   │
                               │  └──────────────────────────────────────────┘   │
                               │  record: intents.jsonl · failures/ · coverage · │
                               │          sim_result.json                        │
                               └─────────────────────────────────────────────────┘
```

### 3.1 Komponen

| Modul (`crates/sim/src/`) | Tanggung jawab |
|---|---|
| `scenario` | Memuat & memvalidasi file skenario TOML; menghasilkan konfigurasi terselesaikan yang disimpan ke hasil |
| `world` | Model dunia: toko, DC, pemasok, katalog yang lahir lewat API (artikel/warna/ukuran/SKU/EPC), stok yang *diyakini* per pool, shift & kas, member & poin, buku harga & promo yang seharusnya berlaku di tiap toko pada tiap waktu |
| `clock` | `SimClock` monoton; DES scheduler (binary heap `(t_virtual, seq, actor, intent)`); pemetaan ke seam jam backend |
| `demand` | Profil permintaan → jumlah kunjungan per toko per jam; keranjang, tender, member share, retur, void |
| `actors` | Satu file per persona; fungsi keputusan murni `(world, rng, now) → Vec<Intent>` + eksekutor intent → panggilan API |
| `node` | Klien node: `InProcessNode` (Router + `oneshot`, cookie jar, CSRF, bearer, HMAC device) dan `HttpNode` (reqwest); keduanya menandai `x-sim-run`, `x-sim-actor`, `x-request-id` |
| `harness` | `InProcessFleet` (Postgres per run + SQLite tmp + `run_cycle` lewat `SyncTransport` sampai tenang) dan `LiveFleet` (menunggu watermark) |
| `fakes` | Printer sink (TCP 9100 atau saluran in-process; mencatat EPC per label), pembaca RFID (menghasilkan sighting bertanda tangan dari EPC yang *ada* di pool), terminal pembayaran (decline rate), pemasok (mengirim sebagian, terlambat) |
| `invariants` | Katalog pemeriksaan bersaverity, tiga keluarga; pembaca SQL hanya di sini |
| `coverage` | Katalog route golden + log panggilan → persen tercakup + daftar tak tersentuh; floor ratchet |
| `chaos` | Rencana gangguan bertimestamp virtual: partisi, drop ack, duplikasi batch, restore edge dari backup, rollover generation, printer mati, misread handheld |
| `record` | `intents.jsonl`, `failures/<n>.json`, `invariants.json`, `coverage.json`, `sim_result.json` |
| `control` | HTTP API simulator + SSE; CLI adalah klien API yang sama |

### 3.2 Dua harness, satu kode actor

| | In-process | Live |
|---|---|---|
| Cara mencapai node | `cloud_http::router(AppState)`, `dc_router_with_auth`, `store_router_with_auth` dipanggil lewat `tower::ServiceExt::oneshot` — HTTP semantik tanpa TCP (persis `Fleet` di `full_chain_integration.rs`) | reqwest ke `cloud :8080`, `dc :8082`, `store :8081` (atau rig demo :8092, atau staging) |
| Database | Postgres baru per run (`CREATE DATABASE sim_<run>` + migrator yang sama dengan startup `cloud`); SQLite di direktori run | Milik node; simulator hanya membaca lewat API (dan SQL read-only bila diberi `SIM_READ_DSN`) |
| Sync | Simulator memanggil `run_cycle(store, config, transport)` dengan `IngestOverHttp` (router cloud lewat `oneshot`) lalu `apply_pending`, berulang sampai `Idle` — **tenang** sebelum invariant konvergensi dinilai. Dua agen latar cloud yang bukan endpoint dipanggil langsung pada jadwal virtualnya: publisher katalog (`catalog.snapshot.chunk`, produksi tiap 5 menit) dan siaran usage/kampanye 15 menit | Node punya timer sendiri (5 s); simulator memicu `POST /api/v1/sync/trigger` dan menunggu watermark lewat `GET /api/v1/sync/status`, `GET /api/v1/sync/fleet`, `GET /api/v1/inventory/fleet-pools` (anggaran ≥ 2 siklus ≈ 10 s per arah) |
| Printer | Sesi cetak DC membuka soket TCP ke `printer_host:printer_port` sungguhan — fake printer simulator adalah `TcpListener` di `127.0.0.1:0` dalam proses yang sama, mencatat EPC per label (pola `scripts/label-sink.py`) | Sama, atau printer nyata di rig (`print-bridge.py :9101`) |
| Jam | `Arc<dyn Clock>` yang sama disuntik ke `AppState` dan konteks edge; simulator memajukannya langsung | `POST …/control/clock` per node (di balik `INVENTORY_ENABLE_TEST_CONTROLS`), atau jam dinding bila skenario tak butuh waktu virtual |
| Determinisme | Penuh: loop tunggal, ID deterministik, tanpa timer | Urutan intent deterministik; waktu tiba tidak |
| Kegunaan | CI (PR: smoke; nightly: acceptance), soak, chaos, replay | Load, demo/seed lewat API, uji rig DC laptop + printer nyata, staging |
| Kecepatan | Ribuan request per detik dalam proses; acceptance 30 hari ≈ menit | Dibatasi jaringan dan siklus sync 5 s |

Prasyarat: `Fleet` yang hari ini disalin ulang di tiap file test (`full_chain_integration.rs`,
`api_flow_integration.rs`, `purchase_order_integration.rs`) diangkat ke
`inventory_backend::harness` di balik feature `harness`, dipakai oleh test **dan** simulator.

### 3.3 Waktu: jam bisnis virtual, jam keamanan nyata

Dua jam, sengaja dipisah:

- **Jam bisnis** (`Clock::now()`): kapan penjualan terjadi, kapan barang bergerak, kapan
  shift dibuka, tanggal punch, masa berlaku promo, segmen member 90/180 hari, periode
  payroll. Ini yang dimajukan simulator.
- **Jam keamanan** (tetap `Utc::now()`/`now()`): kedaluwarsa sesi, lockout login,
  lease device, breaker sync, retensi outbox. Kalau ini ikut virtual, "setahun dalam
  sepuluh menit" mematikan semua sesi di hari pertama dan yang diuji jadi auth, bukan bisnis.

Seam di backend (fase 0):

1. `src/clock.rs`: `trait Clock { fn now(&self) -> DateTime<Utc>; }`, `SystemClock`,
   `ControlledClock(Arc<RwLock<DateTime<Utc>>>)`. `AppState.clock: Arc<dyn Clock>`; hal
   yang sama di konteks edge (`NodeContext`/`SqliteEdge`). Default `SystemClock` — binary
   produksi tak berubah perilaku.
2. Audit **159** `Utc::now()` di Rust (152 di `src/`, 7 di `object-store` yang memang I/O)
   dan **±200** `now()` server-side di string SQL adapter Postgres, diklasifikasi tiga
   kelas: **A** metadata (`created_at`; biarkan), **B** stempel bisnis (ganti
   `clock.now()`), **C** jendela bisnis di SQL (ikat parameter `$now` dari `clock.now()`,
   mis. `membership.rs:79-83`, masa berlaku `commercial`, voucher, klem `occurred_at`
   ±7 hari di `http/mod.rs:1208`). Sampel awal: `sqlite.rs` 24, `domain/sync.rs` 23,
   `postgres/sync.rs` 57 (hampir semua infra — kelas A/keamanan), `users.rs` 22
   (keamanan), `membership.rs` (kelas C). Hari ini tidak ada abstraksi jam sama sekali;
   satu-satunya helper adalah `fn now()` privat di `edge/till.rs:38` — seam pertama yang
   paling murah. Timer `tokio::time` (sync 5 s, katalog 5 menit, lease 6 jam) memakai jam
   monoton dan tidak ikut jam virtual — di harness in-process agen-agen itu tidak
   dijalankan, simulator memanggil siklusnya sendiri.
3. Gate baru `tests/clock_authority.rs` bergaya `write_authority.rs`: daftar file yang
   *boleh* memanggil `Utc::now()` beserta alasannya (`security.rs`, `auth*.rs`, breaker
   sync). File lain yang memanggilnya membuat test merah.
4. `POST /api/v1/inventory/control/clock` (cloud) dan padanannya di edge, hanya bila
   `INVENTORY_ENABLE_TEST_CONTROLS=true` (`control.rs` sudah menolak dengan 403 saat
   flag mati — pola yang sama).

Discrete-event, bukan cron: setiap actor mendaftarkan perilaku berulang (kasir: shift
09:00–21:00 dengan kunjungan mengikuti kurva jam; pembeli: PO tiap Senin; HR: punch
harian; keuangan: tutup bulan; auditor: hitung stok bulanan). Scheduler mengambil
intent berikutnya dari heap, memajukan jam ke waktunya, mengeksekusinya. Tidak ada
polling, tidak ada job yang runtuh, tidak ada sleep. Sync in-process dijalankan pada
titik yang ditentukan skenario (mis. setiap 5 menit virtual atau setelah setiap
batch) — sehingga "kapan fakta sampai di cloud" pun deterministik.

### 3.4 Sync di bawah simulasi

Ini sifat paling penting arsitektur itulah — edge tetap beroperasi tanpa cloud — dan
simbot lama tak pernah mengujinya (gate 5 mereka dikapalkan tanpa rekonsiliasi cloud).

- **Quiescence** = semua siklus `run_cycle` melaporkan `Idle`, `commands_applied == 0`,
  `apply_pending` tak menyisakan apa pun, watermark cloud = seq terakhir edge. Invariant
  konvergensi hanya dinilai di titik tenang.
- **Rencana chaos** (bertimestamp virtual, di file skenario): `partition {node, from, to}`,
  `drop_response {n}` (memakai pola `CommitThenDropCloud`), `duplicate_batch`,
  `restore_edge_from_backup {node, at}` — cloud **harus** menolak seq yang mundur
  (`ingest_batch` hari ini diam-diam melewati `seq <= durable`; skenario ini akan merah
  sampai lubang itu ditutup, dan itu tujuannya), `generation_rollover {node}`,
  `printer_down {from, to}`, `handheld_misread {rate}`, `terminal_decline {rate}`.
- Setelah run, `POST /api/v1/inventory/time-machine/sync-divergence` per origin
  membuktikan log fakta edge vs cloud identik; bila divergen, crate time-machine
  menghasilkan `minimal_fixture` yang bisa langsung ditempel jadi test.

### 3.5 Identitas & auth yang nyata

- Node simulasi **selalu** berjalan dengan `INVENTORY_AUTH_MODE=required`. Mode `disabled`
  mengubah semantik (semua jadi ADMIN, `login` menjawab 409, `actor_id` wajib
  `"development"`) sehingga RBAC tak teruji; harness live hanya menoleransinya bila node
  milik pemilik memang begitu, dan hasil run menandainya `auth: disabled`.
- Admin bootstrap (`INVENTORY_BOOTSTRAP_ADMIN_PASSWORD`) membuat akun per persona lewat
  `POST /api/v1/auth/users` dengan peran sebenarnya (`CASHIER < SUPERVISOR < ADMIN`).
  Kredensial edge **bukan PIN endpoint**: `POST /api/v1/auth/edge-assignments`
  (`edge_password` ≥ 8) lalu `POST /api/v1/auth/edge-policies/{origin}/publish` mengirim
  `auth.policy.replace` ke node; setelah sync, kasir login di edge dengan password itu.
  Lease default 7 hari (supervisor/admin ≤ 24 jam) — di soak 12 bulan, pembaruan lease 6
  jam yang di produksi dilakukan agen latar dipicu simulator lewat endpoint publish yang sama.
- Setelah login, klien memakai **Bearer** (menang atas cookie, tanpa CSRF) di cloud dan
  edge; jalur cookie `inventory_session` + `x-csrf-token` (`inventory_csrf`) dilatih oleh
  satu skenario auth khusus. Permukaan pembeli (`/api/v1/member/*`) hanya cookie
  (`member_session`/`member_csrf`) — persona Pelanggan memakai cookie jar.
- `actor_id`: di cloud middleware menolak 403 bila `actor_id` di body ≠ username sesi; di
  edge dengan auth aktif nilai itu ditimpa username sesi. Karena setiap persona login
  sebagai dirinya sendiri, keduanya benar tanpa kasus khusus. Field penulis lain
  (`created_by`, `issued_by`, `verifier_actor_id`, `closed_by`, `sealed_by`) diisi dari
  identitas persona.
- Handheld didaftarkan sebagai device (`POST /api/v1/auth/rfid-devices`, `device_key`
  hanya sekali) lalu policy dipublish; observasi ditandatangani HMAC atas kanonik
  `POST\n/api/v1/rfid/observations\n{DEVICE_ID}\n{ts}\n{seq}\n{sha256 body}` dengan kunci
  `hex(sha256(device_key))` — persis `scripts/rfid_simulator.py`; body diserialisasi sekali
  dan byte yang sama yang dikirim.
- **Putaran kunci supervisor ada di body, bukan di route**: void, retur, dan payout kas
  membawa `supervisor: {username, password}`. Persona Kasir memegang referensi ke
  supervisor tokonya; skenario negatif mengirim kredensial salah dan mengharapkan penolakan.
- **Matriks negatif** per skenario: setiap endpoint mutasi juga dipanggil oleh persona
  dengan peran terendah dan diharapkan 403; tanpa sesi → 401; body salah → 4xx yang
  tepat; `Idempotency-Key` yang sama dengan body berbeda → 409. Ekspektasi ini
  dideklarasikan di intent, bukan ditoleransi.
- Dua mekanisme idempoten, keduanya didukung klien node: `idempotency_key` di body (mayoritas
  endpoint cloud & edge; replay identik → respons tersimpan, beda payload → 409) dan header
  `Idempotency-Key` + `If-Match: "N"` (ETag versi) pada sumber daya berversi — supplier,
  supplier item, artikel, warna, vocabulary, voucher, `purchase-orders/catalog`. Intent
  menyatakan mana yang dipakai; ETag dibaca dari respons sebelumnya dan disimpan di dunia.

### 3.6 Determinisme & ID

- RNG: `rand_chacha` dengan seed `hash(seed_run, actor_id, hari_virtual)`.
- ID: `src/cloud/domain/ids.rs` mencetak tujuh ID inventory inti lewat satu macro
  `uuid_id!`. Di harness in-process macro ini membaca generator task-local deterministik
  (UUID v8 dari counter); default `new_v4()` seperti sekarang. 172 `Uuid::new_v4()` mentah
  di luar macro **tidak** diubah: kesetaraan replay didefinisikan atas **kunci alami**
  (nomor PO, EPC, nomor struk, jumlah, pool) — bukan UUID.
- `kernel_purity.rs` sudah melarang `Utc::now`/`rand`/`new_v4` di dua kernel keuangan;
  gaya yang sama dipakai untuk `clock_authority`.

---

## 4. Persona dan rantai bisnis

Setiap persona bertindak di **satu node** dan menyentuh **dunia** simulator. Endpoint di
kolom ketiga adalah yang ada hari ini (lihat §4.1 untuk yang belum ada).

Permukaan yang tersedia hari ini: cloud **265 path / 327 method-route** (160 mutasi),
edge **93 method-route** (61 khusus DC, 18 khusus toko, 14 bersama). Peran minimum cloud
ditentukan `required_role(method, path)` di `cloud/domain/auth.rs:61`; di edge oleh
`EdgePermission` (`DcOperate`/`StoreSale`/`RfidObserve` = Cashier, `StoreReceive`/
`InventoryMove` = Supervisor, `AuthAdmin` = Admin).

| Persona (peran) | Node | Endpoint | Dunia yang berubah | Invariant yang dijaga |
|---|---|---|---|---|
| Pemasok (fake) | — | menjawab PO: penuh / sebagian / terlambat sesuai profil; fake ini menentukan `counted_quantity` yang akan ditemukan pemeriksa | `expected_delivery` | receipt ≤ ordered |
| Pembeli HO (SUPERVISOR) | cloud | `POST /api/v1/suppliers`, `POST /api/v1/suppliers/{id}/items` (header `Idempotency-Key`), `GET /api/v1/supplier-items`, `POST /api/v1/sourcing-basket`, `POST /api/v1/purchase-orders` (`destination_site_id` harus memetakan ke tepat satu origin DC; `origin_kind` SOURCING\|DIRECT) — PO dan `purchase.order.activate` satu transaksi | `open_orders` | PO tampak di `GET /api/v1/dc/purchase-orders` ≤ 2 siklus |
| Penerima DC / Pemeriksa / Verifikator (Cashier edge, **dua orang berbeda**) | dc | `POST /api/v1/dc/goods-receipts` → `POST /api/v1/dc/purchase-counts` (hitung buta) → `POST /api/v1/dc/purchase-verifications` (`decision: Accept`, `verifier_actor_id ≠ counted_by`, DB menegakkannya) → `POST /api/v1/dc/goods-receipts/{id}/invoice`; selisih harga memicu `purchase.price_amendment.requested` yang Pembeli putuskan di `POST /api/v1/purchase-price-amendments/{id}/decide` | `pending.unidentified` di pool `dc` | Σ diterima = Σ diverifikasi; amandemen harga tercatat, tidak menghalangi |
| Merchandiser HO (SUPERVISOR) | cloud | `GET /api/v1/article-setups/unidentified` → `POST /api/v1/article-setups` (`colours[{colour_digit 0–9, colour_code}]`, `variants[{colour_digit, size_code, quantity, base_price_minor}]`, `article_code: null` mencetak kode 8 digit) → `POST /api/v1/article-setups/{id}/issue` (mencetak artikel, SKU, rentang serial EPC **dan** `tagging.job.activate` satu commit) | katalog dunia | SKU `artikel(8)+warna(1)+ukuran(2)`; ≤ 10 warna per artikel; `created_by_session_id` tak pernah NULL |
| Penanda DC (Cashier edge) | dc | `GET /api/v1/dc/tagging-jobs` → `POST /api/v1/dc/print-sessions` (`job_id, printer_host, printer_port, chunk_size`) → `POST …/print-sessions/{id}/run` berulang → `POST /api/v1/dc/tagging-confirmations` (inilah yang mengubah barang jadi stok gudang yang bisa dipick; memancarkan `tagging.completed`) | EPC per unit | EPC 0xA0 golden vector; label di printer sink = unit ditandai, tiap label membawa EPC |
| Alokator HO (SUPERVISOR) | cloud | `POST /api/v1/inventory/allotments` (`type: TO_STORE`, `source_site_id: dc`, `source_pool_id: dc.warehouse` — CHECK di tabel; `destination_id: store-NN`) → `inventory.allotment.activate.v1`; `GET /api/v1/dc/destinations/{store}/outstanding` untuk melihat sisa | `outbound.*` | in-transit DC = dikirim − diterima toko |
| Picker / Packer / Dispatcher DC (Cashier edge) | dc | `POST /api/v1/dc/pick-sessions` → `POST /api/v1/dc/picks` (`source_pool_id: dc.warehouse`, kuantitas) → `POST /api/v1/dc/packing-boxes` → sapuan `POST /api/v1/rfid/observations` (HMAC) → `POST …/packing-boxes/{id}/capture` (`ready: true`, `koli_id`) → `POST /api/v1/dc/shipments` → `POST /api/v1/dc/dispatches` → `POST …/dispatches/{id}/depart` (satu-satunya tahap yang menggerakkan barang di dunia) | pool outbound per toko | tiap unit tepat satu koli, satu shipment |
| Supervisor toko (Supervisor edge) | store | `POST /api/v1/store/receive` / `receive-batch` (`source_dc_id: dc`, `shipment_reference`, `unit_price_minor` = harga intake, bukan jual) → `POST /api/v1/store/movements` (`from: store-01.warehouse:on_hand`, `to: store-01.floor:on_hand`, `cause: NORMAL_MOVE`); kredensialnya dipakai kasir untuk void/retur/payout | `warehouse`, `floor` | diterima toko ≤ dikirim DC; unit di lantai = yang dipindah |
| Handheld toko (device) | store | `POST /api/v1/rfid/observations` bertanda tangan atas EPC yang **ada** di pool | sighting | sighting hanya untuk EPC yang ada; misread menurut profil = anomali yang diharapkan |
| Kasir (Cashier edge) | store | `POST /api/v1/store/shifts` (`terminal_id`, `opening_float_minor`) → `POST /api/v1/store/quote` → `POST /api/v1/store/sales` (`epcs[]`, `tenders[{method, amount_minor}]`, `coupon_codes?`, `customer_id?`) → `GET/POST /api/v1/store/sales/{id}/receipt` → `POST /api/v1/store/shifts/{id}/movements` → `POST /api/v1/store/sales/{id}/void` / `POST /api/v1/store/returns` (dengan `supervisor`) → `POST /api/v1/store/shifts/{id}/close` (`declared_cash_minor` **sebelum** angka harapan dibuka) | kas per shift, stok lantai | Σ tender = Σ penjualan − retur; kembalian hanya dari CASH; kas tutup = float + CASH − kembalian ± movement |
| Pelanggan / member | store + cloud | walk-in, atau member: kasir `POST /api/v1/members` (enrol) + `POST /api/v1/members/{id}/pairing-code`; pembeli `POST /api/v1/member/session` lalu `GET /api/v1/member/summary\|transactions` (cookie) | poin, riwayat | poin hanya bertambah lewat penjualan yang ada; riwayat member = struk yang dunia catat |
| Komersial HO (SUPERVISOR) | cloud | `POST /api/v1/commercial/publications` (DRAFT; `tax_rules`, `offer_rules`, `markdowns`, assortment) → `POST …/publications/{id}/publish` (`commercial.publication.activate`); `PATCH /api/v1/commercial/campaigns/{id}`; `POST /api/v1/commercial/vouchers` (header idempoten) → kasir `POST …/vouchers/{code}/redeem`; `GET /api/v1/commercial/offers/resolve` untuk ekspektasi harga | harga yang *seharusnya* berlaku di toko pada waktu t | harga di fakta penjualan = buku yang sampai di toko saat itu (kegagalan diam yang ditemukan `full_chain_integration.rs`) |
| Keuangan HO (ADMIN) | cloud | `POST /api/v1/finance/bills` → `…/bills/{id}/post`; `POST /api/v1/finance/payments` → `…/post`; `POST /api/v1/finance/bank-statements` → `…/bank-lines/{id}/match`; `POST /api/v1/finance/periods` / `periods/close`; `POST /api/v1/finance/depreciation/run` | GL | jurnal seimbang; tak ada posting ke periode tertutup; tagihan = faktur DC |
| HR (SUPERVISOR) | cloud | `POST /api/v1/employees` → `…/employment`, `…/assignments`; `POST /api/v1/roster`; punch kehadiran; `…/leave-requests` → `approve`; `…/overtime-orders` → `consent`; `POST /api/v1/payroll/runs` → `verify` → `approve` → `seal`; `POST /api/v1/attendance-periods/{place}/{period}/closure` | jam kerja per orang | payroll = punch; bulan tertutup menolak perubahan roster (`roster_integration.rs`) |
| Auditor (SUPERVISOR cloud + Cashier DC) | cloud → dc | `POST /api/v1/inventory/counts` → `…/{id}/activate` (`inventory.official_count.activate.v1`) → DC `POST /api/v1/dc/official-counts/{id}/entries` → `…/submit` → cloud `POST /api/v1/inventory/counts/{id}/approve` (`…adjust.v1`); selisih disengaja dari dunia | snapshot vs temuan | varians = selisih yang disengaja, tidak lebih |
| Pengamat sync | harness | `POST /api/v1/sync/trigger`, `GET /api/v1/sync/status\|fleet\|reconciliation`, `GET /api/v1/inventory/fleet-pools`, `GET /api/v1/inventory/time-machine/sync-divergence` | — | konvergensi |

Yang **tidak** dipakai simulator meski ada: `POST /api/v1/inventory/observations` di cloud
(403 saat auth aktif; observasi produksi lewat edge), `POST /api/v1/inventory/movements` di
cloud (hanya `NORMAL_MOVE`/`RETURN_TO_DC`, `occurred_at` diklem ±7 hari — dipakai satu
skenario negatif), dan `POST /api/v1/inventory/control/corrupt-projection` (hanya untuk
mutation check §2 P7).

### 4.1 Jebakan yang sudah diketahui dan dibakukan di dunia simulator

- **Dua nama untuk DC.** Dokumen (receipt, sesi setup, tagging) difile ke `dc-01`; ledger
  bergerak di pool `dc` (`dc.warehouse`, `CHECK (source_pool_id = 'dc.warehouse')` di
  allotment). Dunia simulator menyimpan keduanya sebagai dua atribut satu node.
- **Trigger immutability komersial menyala saat INSERT**: promo masuk selagi publikasi
  `DRAFT`, baru publish. Actor Komersial mengikuti urutan ini; skenario negatifnya
  (menyisipkan setelah publish) mengharapkan penolakan.
- **Harga tanpa `commercial_assortment_rule` tak terlihat** — actor Komersial selalu
  menulis assortment; invariant ekspektasi menangkap harga yang "hilang".
- **Voucher**: issue dan redeem tak bisa satu transaksi (constraint DEFERRED) — dua intent.
- **Migrasi SQLite `0028` (voucher tender) tidak pernah diterapkan** oleh `edge/sqlite.rs`:
  tender VOUCHER di till gagal CHECK. Skenario smoke memakai VOUCHER, jadi ini merah
  sampai diperbaiki (fase 0).
- **Perintah turun menumpang respons ingest** (`COMMAND_BATCH = 20` per respons), jadi edge
  yang tak punya fakta pun tetap mengirim batch kosong tiap siklus; `command_type` yang
  tak dikenal **memblokir** stream (bukan dilewati) dan muncul di `GET /api/v1/sync/fleet` —
  invariant K5 membaca ini.
- **Generation**: `active_generation` diaktifkan di cloud (`POST /api/v1/sync/origins`)
  **sebelum** edge menaikkannya; kebalikannya membuat ingest dipagari 409 selamanya. Rencana
  chaos `generation_rollover` mengikuti urutan yang benar dan yang salah, masing-masing
  dengan ekspektasi.
- **Lebih dari satu origin DC terdaftar** membuat `POST /api/v1/purchase-orders` menjawab
  409 (`sole_dc_origin_tx`) — topologi simulator dibatasi satu DC sampai produk mendukung
  banyak DC.
- **Port launch.json bersilangan** dengan default binary: `till-edge` (binary `store`) di
  8081, `dc-node` (binary `dc`) di 8082, sementara default binary `dc` 8081 / `store` 8082.
  Harness live membaca URL per node dari skenario, tidak pernah mengasumsikan port dari peran.

---

## 5. Model permintaan

Satu file profil TOML, dibaca seluruhnya oleh satu loader (setiap field punya test):

```toml
[demand]
base_visits_per_store_day = 60
month_mult = [0.8, 0.8, 0.9, 1.0, 1.1, 1.0, 0.9, 0.9, 1.0, 1.1, 1.2, 1.5]
dow_mult   = [1.3, 0.8, 0.8, 0.9, 1.0, 1.2, 1.4]        # Minggu..Sabtu
hour_curve = "mall"                                    # 10:00 buka, puncak 13 & 19
payday     = { days = [25, 1], mult = 1.4 }
basket     = { sizes = [[1, 0.55], [2, 0.30], [3, 0.12], [5, 0.03]] }
tender     = { CASH = 0.45, CARD = 0.25, QRIS = 0.25, VOUCHER = 0.05 }
member_share = 0.35
return_rate  = 0.03
void_rate    = 0.01

[[store]]
id = "store-01"; weight = 1.0; terminals = 2; hours = "10:00-21:00"

[[store]]
id = "store-02"; weight = 0.6; terminals = 1; hours = "10:00-21:00"

[[event]]                       # gangguan pasar, bukan chaos sistem
kind = "promo_week"; from = "2026-10-05"; to = "2026-10-11"; mult = 1.6
```

Simulator **tidak** menjual apa yang tak ada di lantai: kalau permintaan melebihi stok,
kunjungan itu tercatat sebagai *lost sale* di dunia (dan itu metrik yang berguna bagi
alokator), bukan penjualan yang dipaksakan.

---

## 6. Katalog invariant

Semua run-scoped, bersaverity (`critical` menghentikan run; `high`/`medium` gagal di
akhir), dan setiap pemeriksaan tahu *sumbernya* (API read-model bila ada; SQL hanya
bila tidak).

### 6.1 Struktural (per node)

| ID | Pemeriksaan | Node | Sumber |
|---|---|---|---|
| S1 | `inventory_projection` = Σ `movement` per (subject, pool) | cloud, dc, store | SQL |
| S2 | tak ada `on_hand` negatif | semua | SQL |
| S3 | setiap unit punya PO di belakangnya (35 pemeriksaan `--audit` dari `seed-full-chain.py`, diport) | cloud | SQL |
| S4 | EPC = encode(SKU, serial) golden vector; tak ada EPC ganda | cloud, dc | API + SQL |
| S5 | voucher: ledger = header (constraint DEFERRED tak pernah dilanggar) | cloud | SQL |
| S6 | jurnal seimbang; tak ada posting ke periode tertutup | cloud | API |
| S7 | publikasi komersial: tak ada perubahan setelah publish | cloud | SQL |
| S8 | official count: snapshot penuh; varians = temuan − snapshot | cloud | API |
| S9 | shift: Σ tender = Σ penjualan − retur; kas tutup = kas buka + CASH masuk − kembalian | store | API |

### 6.2 Konvergensi (antar node, di titik tenang)

| ID | Pemeriksaan |
|---|---|
| K1 | fakta penjualan edge (`edge_sale`) = penjualan yang toko catat: jumlah, baris, harga, tender |
| K2 | posisi fakta cloud per pool = ledger edge per pool (DC dan toko) |
| K3 | in-transit DC = dikirim − diterima toko, dicocokkan `(source_dc, dest_store, shipment_ref, EPC)` |
| K4 | buku harga & promo yang cloud publish pada t **sampai** di toko sebelum penjualan pertama yang memakainya |
| K5 | PO yang cloud buat sampai di DC; setup & tagging job sampai di DC |
| K6 | watermark monoton; tidak ada fakta yang hilang antara seq terakhir edge dan durable cloud (`sync-divergence` = MATCH) |
| K7 | setelah partisi, backlog edge terkuras tanpa penolakan dan tanpa duplikat |

### 6.3 Ekspektasi (dunia simulator vs laporan sistem)

| ID | Pemeriksaan |
|---|---|
| E1 | stok per pool menurut dunia = `GET fleet-pools` / pool edge |
| E2 | penjualan hari ini per toko menurut dunia = laporan sales cloud (setelah tenang) |
| E3 | poin member menurut dunia = saldo member di cloud |
| E4 | harga yang dunia harapkan untuk (SKU, toko, t) = harga di struk |
| E5 | lost sale dunia = 0 pada SKU yang sistem laporkan masih ada di lantai (kalau tidak, salah satu bohong) |
| E6 | jumlah label yang printer sink terima = unit yang dunia tandai; setiap label membawa EPC (bukan `EPC NONE`) |
| E7 | payroll = Σ jam dari punch yang dunia kirim |

Contoh dari sejarah proyek yang **hanya** E4/K4 yang bisa tangkap: harga sampai di toko
tapi tak pernah dibaca; fakta penjualan membawa harga yang salah; kampanye promo tak
pernah tiba — tiga kegagalan diam yang ditemukan saat menulis `full_chain_integration.rs`.

---

## 7. Skenario = mode

Tidak ada preset di kode. Setiap mode adalah file di `crates/sim/scenarios/`:

| Skenario | Harness | Topologi | Durasi virtual | Yang dibuktikan | Exit ≠ 0 bila |
|---|---|---|---|---|---|
| `smoke` | in-process | 1 DC, 1 toko | 2 hari | rantai penuh PO→penjualan→sync + invariant S1–S9, K1–K2, E1–E2 | ada failure/invariant |
| `acceptance` | in-process | 1 DC, 2 toko, 1 pemasok | 30 hari | semua persona, semua invariant, coverage ≥ floor | failure, invariant, atau coverage < floor |
| `soak` | in-process | 1 DC, 3 toko | 12 bulan | tutup bulan ×12, payroll ×12, promo lintas bulan, segmen member berubah | invariant bulanan |
| `chaos` | in-process | = acceptance + rencana gangguan | 30 hari | konvergensi setelah partisi/duplikasi/restore/rollover | K6/K7 gagal, atau "known-failing" berubah status |
| `load` | live | rig lokal 3 proses | 1 hari, paralel N kasir | p95 latensi till & ingest, tanpa error | error atau p95 > ambang |
| `demo` | live | node lokal/rig | 90 hari sejarah | mengisi DB demo lewat API dengan sejarah yang bisa ditelusuri (pengganti bagian *trading* seed SQL) | failure |
| `replay` | in-process | dari run tersimpan | = run asal | build baru menghasilkan hasil yang sama (kunci alami) | drift |

`known-failing`: skenario boleh menandai satu pemeriksaan sebagai *diharapkan merah*
dengan alasan dan tautan; CI gagal bila pemeriksaan itu **hijau** (artinya sudah
diperbaiki dan penanda harus dicabut). Ini cara jujur membawa lubang `seq <= durable`
dan `0028` ke CI tanpa mematikan gate.

---

## 8. Coverage endpoint

- **Denominator**: `tests/route_catalog.rs` memindai `.route("…", get(a).post(b))` di
  `cloud/http/mod.rs` (`pub fn router`, tanpa router bersarang), `cloud/media.rs` (4 route
  yang di-merge), dan `edge/http.rs` (Axum tak punya API jalan-jalan router) menjadi
  `tests/testdata/routes.json` (`{node, method, pattern, role}`; hari ini 327 method-route
  cloud + 93 edge); test merah bila hasil pindai ≠ berkas tersimpan, jadi route baru masuk
  katalog secara sadar. Kolom `role` diturunkan dengan memanggil `required_role` sungguhan.
- **Numerator**: log panggilan simulator (`intents.jsonl`) dicocokkan ke pola.
- **Laporan**: persen per node + daftar tak tersentuh, dikelompokkan per modul; entri
  `exempt` beralasan di `crates/sim/coverage-exemptions.toml` (endpoint SSE assistant,
  streaming media, dll.).
- **Ratchet**: `crates/sim/coverage-floor.toml` menyimpan angka nyata terakhir; skenario
  `acceptance` gagal bila turun; naikkan bertahap.

---

## 9. API kendali & CLI

`sim serve --port 8090` (fase 4) — hub berbicara ke sini seperti ia berbicara ke DC edge.

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/api/v1/sim/scenarios` | daftar skenario + profil |
| `POST` | `/api/v1/sim/runs` | `{scenario, seed?, harness, overrides?}` → `run_id` |
| `GET` | `/api/v1/sim/runs/{id}` | status, jam virtual, hitungan intent/failure, invariant terakhir |
| `POST` | `/api/v1/sim/runs/{id}/advance` | `{days}` \| `{until}` \| `{until_quiescent: true}` |
| `POST` | `/api/v1/sim/runs/{id}/pause` · `/resume` · `/abort` | |
| `GET` | `/api/v1/sim/runs/{id}/events` | SSE: intent, outcome, invariant, clock |
| `GET` | `/api/v1/sim/runs/{id}/invariants` · `/coverage` · `/failures/{n}` · `/result` | |

CLI (fase 1) memakai API yang sama, atau menjalankan engine langsung tanpa server:

```bash
cargo run -p inventory-sim -- run --scenario smoke --seed 42
cargo run -p inventory-sim -- run --scenario acceptance --coverage-floor auto
cargo run -p inventory-sim -- run --scenario chaos --keep-db
cargo run -p inventory-sim -- replay --from runs/2026-09-06T10-00-acceptance-42
cargo run -p inventory-sim -- run --scenario demo --harness live --cloud http://127.0.0.1:8080 --dc http://127.0.0.1:8082 --store http://127.0.0.1:8081
```

Modul hub **Simulation** (`/simulation`, `AppModule` di `lib/navigation.ts`, `VITE_SIM_TARGET`):
daftar run; detail run (garis waktu intent, jam virtual, persona, failure dengan
request/response); invariant; peta panas coverage per modul. Satu layar per pertanyaan,
sesuai pola hub.

---

## 10. Guardrail (kode, bukan catatan)

1. `DATABASE_URL` in-process harus lokal (`localhost`/socket) atau bernama `sim_*`;
   `SIM_ALLOW_REMOTE=1` wajib untuk lainnya, dan **tetap** menolak host yang cocok
   `SIM_DENY_HOSTS` (default: `onrender.com`).
2. Simulator tak pernah menjalankan migrasi kecuali pada database yang ia buat sendiri
   pada run itu.
3. Harness live menolak skenario ber-jam-virtual bila `GET …/control` node melaporkan
   test controls mati.
4. Setiap request bertanda `x-sim-run`, `x-sim-actor`, `x-request-id`; `Idempotency-Key`
   dicetak sekali per intent dan dipakai ulang saat retry.
5. Tidak ada `sleep` di simulator; latensi fake hardware dimodelkan sebagai waktu virtual.
6. `cargo build` default (`default-members = ["."]`) tidak membangun `sim`; binary
   produksi tak pernah menautkan crate ini.

---

## 11. Rencana fase

Ukuran: S ≈ 1–2 hari kerja satu sesi, M ≈ 3–5, L ≈ 1–2 minggu. Fase 0 dan 1 bisa
dikerjakan paralel oleh sesi berbeda kecuali yang ditandai.

### Fase 0 — Seam di backend (M, paralel 3 lane)

| Lane | Deliverable | Exit |
|---|---|---|
| 0a Jam | `src/clock.rs`; `AppState.clock` + konteks edge; audit 152 + 326 titik → tabel kelas A/B/C di `docs/clock-audit.md`; kelas B/C diganti; `tests/clock_authority.rs`; endpoint `control/clock` di cloud & edge | `cargo test` hijau; test baru: memajukan `ControlledClock` 90 hari mengubah segmen member tanpa mematikan sesi |
| 0b Harness bersama | `inventory_backend::harness` (feature `harness`): `Fleet`, `IngestOverHttp`, `sync_until_quiescent`, pembuat DB per run dari migrator `cloud`; tiga test yang menyalinnya beralih memakainya | tiga test hijau tanpa `Fleet` lokal |
| 0c Katalog route & gate merah | `tests/route_catalog.rs` + `routes.json`; daftarkan `0028` di `edge/sqlite.rs`; allowlist blok migrasi yang sengaja dilompati (0047–0049, 0053–0059, 0062–0069, 0100) di `migration_hygiene.rs`; `.github/workflows/ci.yml` (Postgres service, `make check`, `cargo test`) | CI pertama repo hijau |

### Fase 1 — Inti + smoke (M–L, setelah 0a/0b)

- `crates/sim`: `scenario`, `world`, `clock` (DES), `node` (InProcess + Http, cookie/CSRF/bearer/HMAC), `harness`, `fakes` (printer sink, pembaca RFID), `record`, `invariants` runner dengan S1, S2, S4, S9, K1, K2, E1, E2.
- Persona: Pembeli, Penerima/Pemeriksa/Verifikator DC, Merchandiser, Penanda, Alokator, Picker/Packer/Dispatcher, Penerima toko, Staf lantai, Kasir, Pelanggan — cukup untuk `smoke` (port `full_chain_integration.rs` ke bentuk persona).
- CLI `run`, `sim_result.json`, `intents.jsonl`, `failures/`.
- **Exit:** `sim run --scenario smoke` hijau < 2 menit; mutation check merah; dua run seed sama → `intents.jsonl` identik.

### Fase 2 — Acceptance bisnis (L, paralel per domain)

- Persona lengkap: Komersial, Keuangan, HR, Auditor, Pemasok fake dengan pengiriman sebagian/terlambat, matriks negatif per peran.
- Profil permintaan, `acceptance` 30 hari, katalog invariant penuh (§6), coverage + floor, `known-failing`.
- CI: PR → `smoke`; nightly → `acceptance` + floor ratchet.
- **Exit:** `acceptance` hijau; angka coverage nyata tercatat; daftar *product gap* pertama (endpoint yang persona butuhkan tapi belum ada — mis. transfer antar toko).

### Fase 3 — Waktu & gangguan (M–L)

- `soak` 12 bulan: payroll, tutup periode, promo lintas bulan, segmen member.
- `chaos`: partisi, drop response, duplikasi, restore dari backup (menutup lubang `seq <= durable`), rollover generation, printer mati, misread.
- `load` live di rig 3 proses; `demo` live untuk mengisi DB demo lewat API.
- **Exit:** soak hijau dengan pemeriksaan bulanan; setiap item chaos punya skenario dan status.

### Fase 4 — Kendali & UI (M)

- `sim serve`: API §9 + SSE; `replay` + laporan drift; jembatan time-machine (`sync-divergence`, `what-if`, fixture otomatis).
- Modul hub **Simulation**.
- **Exit:** run dimulai dari hub, diikuti langsung, hasil diunduh; satu divergensi buatan menghasilkan fixture yang lolos `is_faithful`.

---

## 12. Risiko & keputusan terbuka

| Risiko / pertanyaan | Rekomendasi |
|---|---|
| Audit jam lebih luas dari perkiraan (kelas C tersebar di SQL) | Kerjakan per modul mengikuti persona yang membutuhkannya (member, komersial, HR dulu); modul lain tetap jam dinding sampai persona-nya masuk |
| Endpoint yang belum ada untuk sebagian persona (transfer antar toko, sebagian keuangan) | Bukan alasan menulis SQL; dilaporkan sebagai product gap; skenario melewati langkah itu secara eksplisit |
| `oneshot` mengonsumsi `Router` — klon per panggilan | Sama seperti test hari ini; biaya kecil. Alternatif: `Router::into_service()` + `tower::ServiceExt::ready` |
| ID deterministik menyentuh macro yang dipakai produksi | Generator task-local hanya aktif di harness in-process; default persis `new_v4()`; ditutup test |
| Seed Python (`seed-everything.sh`) vs `demo` lewat API | Pertahankan seed SQL untuk **skala katalog** (500 artikel, ~10 detik/endpoint); `demo` mengambil alih **sejarah perdagangan** karena hanya API yang menjamin stok bergerak |
| Sesi paralel menyapu file dengan `git add -A` | Commit lane simulator sendiri begitu hijau (pola yang sudah dipelajari repo ini) |
| Nama | `inventory-sim` untuk paket, `sim` untuk binary dan direktori — mengikuti `inventory-backend`, `cloud`, `dc`, `store` |

---

## 13. Lampiran

### 13.1 `sim_result.json`

```json
{
  "run_id": "2026-09-06T10-00-acceptance-42",
  "scenario": "acceptance", "seed": 42, "harness": "in-process",
  "backend_commit": "d2e9719", "resolved_config": { "...": "isi TOML terselesaikan" },
  "clock": { "start": "2026-10-01T00:00:00Z", "end": "2026-10-31T00:00:00Z" },
  "intents": { "total": 18422, "ok": 18419, "expected_rejections": 311, "failures": 3 },
  "personas": { "cashier@store-01": { "intents": 6120, "failures": 0 }, "...": {} },
  "invariants": [
    { "id": "K4", "severity": "critical", "passed": false,
      "detail": "promo P-0007 dipublish 2026-10-05T09:00 tapi struk R-000412 di store-02 2026-10-05T10:14 memakai harga lama",
      "known_failing": null }
  ],
  "coverage": { "cloud": { "covered": 201, "total": 265, "pct": 75.8 }, "dc": {}, "store": {}, "floor": 74.0 },
  "chaos": [ { "kind": "partition", "node": "store-02", "from": "...", "to": "...", "converged_after_cycles": 3 } ],
  "artifacts": { "intents": "intents.jsonl", "failures": "failures/", "db": "postgresql:///sim_2026…" },
  "exit_code": 1
}
```

### 13.2 Satu baris `intents.jsonl`

```json
{"t":"2026-10-03T13:42:00Z","seq":8812,"actor":"cashier-1@store-01","intent":"till.sale",
 "node":"store","method":"POST","path":"/api/v1/store/sales","pattern":"/api/v1/store/sales",
 "idempotency":{"kind":"body","key":"…"},"expect":{"status":"2xx"},"got":{"status":201,"ms":3},
 "world_delta":{"floor:store-01":-2,"cash:store-01/T1/shift-3":150000,"lost_sales":0}}
```

### 13.3 Kerangka file skenario

```toml
name = "acceptance"
harness = "in-process"
seed = 42                       # bisa ditimpa CLI
clock = { start = "2026-10-01", days = 30, sync_every = "5m" }
profile = "profiles/mall.toml"
topology = { dc = "dc-01", stores = ["store-01", "store-02"], suppliers = 1 }
personas = ["buyer", "dc.*", "merchandiser", "tagger", "allocator", "store.*", "cashier", "customer", "commercial", "finance", "hr", "auditor"]
invariants = { critical_halts = true, monthly = ["S6", "E7"] }
coverage = { floor = "auto" }    # baca coverage-floor.toml
[[chaos]]
kind = "partition"; node = "store-02"; from = "2026-10-12T08:00"; to = "2026-10-13T20:00"
[[known_failing]]
check = "K6"; reason = "ingest_batch melewati seq <= durable"; ref = "docs/architecture-review-2026-09-06"
```
