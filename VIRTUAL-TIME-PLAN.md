# Waktu virtual ala test clock — setahun dipadatkan, kalender tetap utuh

**Tanggal:** 2026-09-22 · **Status:** fase 0a (cloud + edge) + mekanisme hub
**TERIMPLEMENTASI** — lihat "Status implementasi" di bawah · **Pendahulu:**
`SIMULATION-PLAN.md` §3.3 (fase 0a) dan `SIMULATION-SCENARIOS-PO.md` §2 ·
**Pembanding:** Stripe Test Clock

## Status implementasi (2026-09-22)

Yang sudah hidup di kode (bukan proposal lagi):

- **Seam** `src/clock.rs`: `ClockHandle` dengan tiga sumber (`System`,
  `Controlled`, `Scaled`), monotonik, `rescale`/`pause`/`resume`/`advance_to`,
  env bootstrap `ITULAH_CLOCK*` (lihat `cloud.env.example`), 9 unit test.
- **Cloud**: `AppState.clock` (Arc dibagi), `GET/POST
  /api/v1/inventory/control/clock` (fail-closed 403 tanpa
  `INVENTORY_ENABLE_TEST_CONTROLS`; mundur → 409; validasi → 400), header
  `x-virtual-time` di semua respons saat virtual, tabel `clock_epoch`
  (migrasi 0310), tipe wire TS (`ClockStatus`/`ClockMode`/
  `ClockControlRequest`) teregistrasi di `tests/contract_types.rs`.
- **Bisnis di cloud**: `SEGMENT_CASE`/`DAYS_SINCE_PURCHASE` ber-token `$NOW`
  (dengan fungsi `segment_case(now)`), compiler laporan menerima instan
  bisnis, `run_spec`/`run_saved`/`list_members`/`member_segments`/narrowing
  segmen menerima `now` dari jam, clamp `occurred_at` manual movement ikut jam.
- **Edge**: `SqliteEdge` memegang `Arc<ClockHandle>` yang sama dengan
  `EdgeState`/`EdgeRfid` lewat `EdgeInventory::clock()`; seluruh stempel
  bisnis (occurred_at, checkout/tender, count, GRN, reject, tagging, punch,
  business_date, `PricingContext.at`) membaca jam; endpoint kontrol yang sama
  di `common_router`; auth/sync/outbound/printing tetap jam nyata.
- **Hub** (2 Okt): tombol "Time" di kaki kolom menu (desk) dan di top bar
  (tablet/HP) → popover "Time travel" (+1/+7/+30 hari, bulan depan, Go to,
  Back to real time, Advanced: speed/pause) —
  `frontend-hub/src/components/shell/time-travel*.tsx`,
  `lib/time-travel.ts`, klien `frontend-contract/src/client/clock.ts`, hook
  `lib/queries/clock.ts` (`useBusinessNow`, invalidasi semua query setelah
  ubah jam). Lompatan pertama dari `system` = `set_mode scaled` faktor 1;
  balik = `set_mode system`. Polling 5 detik, 403 → tombol menghilang.
- **Gate**: `tests/clock_authority.rs` — allowlist wajib-reason untuk setiap
  `Utc::now()` di `src/`; `tests/clock_control_integration.rs` 6/6.
- Belum (fase lanjut): `VirtualScheduler` (fase 0d), threading sisa titik
  kelas B/C di cloud (entri "audit pending" di allowlist
  `clock_authority`), simulator DES fase 1–4.

Dokumen ini merancang cara sistem itulah memiliki **jam virtual**: waktu bisnis yang
bisa dipadatkan — satu tahun 2026 berjalan dalam 10 jam nyata — sementara kalender
tetap terlacak: pada detik nyata mana pun bisa ditanyakan "sekarang tanggal virtual
berapa", dan semua turunan kalender (jatuh tempo, umur piutang, segmen member,
periode fiskal, tutup bulan) mengikuti kalender virtual, bukan jam dinding.

Ini bukan rencana baru yang berdiri sendiri. `SIMULATION-PLAN.md` fase 0a sudah
merancang seam jam (`clock.rs`, `ControlledClock`, gate `clock_authority`) untuk
simulator discrete-event; bagian itu tetap menjadi fondasi. Yang dokumen ini
tambahkan adalah mode kedua dari jam yang sama — **pemadatan linear yang berjalan
sendiri di atas jam dinding** (semantics Stripe Test Clock: satu titik jangkar,
waktu maju otomatis) — sehingga rig live, demo, dan DB demo dapat menjalankan
"setahun dalam sepuluh jam" tanpa simulator pun harus hidup.

---

## 0. Keputusan dalam satu layar

| # | Keputusan | Pilihan | Alasan singkat |
|---|---|---|---|
| 1 | Satu seam, dua mode | `trait Clock` (fase 0a) dengan `SystemClock` (default produksi), `ControlledClock` (lompat manual = persis Stripe test clock), `ScaledClock` (baru: linear, maju sendiri) | DES simulator dan demo live membutuhkan kontrak jam yang sama; dua mode berbagi satu audit |
| 2 | Rumus pemetaan | `v = v0 + (real_now − r0) × f`, `f = span_virtual / span_wall` (mis. 876 untuk 1 tahun / 10 jam) | Deterministik dari jam dinding: semua node menghitung hasil sama tanpa sinkronisasi per-tick |
| 3 | Kalender tetap asli | Pemetaan memakai aritmetika `DateTime` nyata (+07:00), bukan "hari = 24 jam rata" | 28/30/31 hari, tahun kabisat, dan tutup bulan jatuh di tanggal yang benar; "tahun terkompresi tetap tahun yang sama bentuknya" |
| 4 | Dua jam, bukan satu | Jam bisnis virtual (`clock.now()`); jam keamanan tetap `Utc::now()` (sesi, lockout, lease, breaker, skew RFID) | "Setahun dalam 10 jam" mematikan semua sesi di 4 menit pertama bila sesi ikut virtual — yang teruji jadi auth, bukan bisnis |
| 5 | Urutan tetap seq, bukan waktu | Fakta edge↔cloud tetap diurutkan `seq` (arsitektur hari ini); jam virtual hanya menstempel & menurunkan | Skew jam antar node 250 ms = 3,6 menit virtual pada f=876; arsitektur sudah tidak bergantung pada waktu untuk urutan |
| 6 | SQL tidak boleh membaca jam sendiri untuk maksud bisnis | Window bisnis (`CURRENT_DATE - due`, `now() - 90 days`) diikat parameter `$now` dari `clock.now()`; kolom `DEFAULT now()` dibiarkan sebagai metadata infra | Jam server Postgres adalah sumber "now" kedua yang tak terkoordinasi; bila dibiarkan, laporan cloud dan stempel edge saling bertentangan |
| 7 | Agen latar digerakkan kalender, bukan timer | `VirtualScheduler`: tick nyata 1 s → hitung batas virtual yang terlewati (hari/minggu/bulan) → jalankan fungsi kerja agen yang sama | Pada f=876 satu bulan virtual = 50 menit nyata; agen bulanan ber-tick 1 jam akan melewatkan bulan |
| 8 | Kendali | `POST/GET /api/v1/inventory/control/clock` di cloud & edge di balik `INVENTORY_ENABLE_TEST_CONTROLS` (pola `control.rs:733`), plus bootstrap env untuk rig demo | Runtime bisa jangkar-ulang/pause tanpa restart; rig demo bisa lahir dengan waktu terpadat |
| 9 | Observabilitas | Header `x-virtual-time` di semua respons saat mode aktif; chip jam virtual di hub; `GET /control/clock` menjawab "tanggal berapa sekarang" | Pertanyaan paling sering di demo justru "kita sekarang tanggal berapa" |
| 10 | Yang tidak berubah | Produksi default `SystemClock` (biner tak berubah perilaku); timer tokio/`Instant` tetap monoton; DES in-process tetap jalur CI deterministik | Nol risiko produksi; kompresi hanya hidup bila dinyalakan eksplisit |
| 11 | Mundur waktu = operasi destruktif | Endpoint menolak jangkar mundur pada `ScaledClock` (hanya `controlled`/DB disposable, atau `force` + dry-run konsekuensi); jangkar sah hanya greenfield/continuation | Mesin sync & penomoran aman, tapi dokumen tanggal-kunci melebur/dobel diam-diam (`sales_posting` DRAFT) — peta lengkap §7.2 |

---

## 1. Model waktu: tiga jam, dua mode virtual

### 1.1 Tiga jam

| Jam | Sumber | Isi | Dipadatkan? |
|---|---|---|---|
| **Jam bisnis** | `clock.now()` | Tanggal dokumen, `occurred_at`, `posting_date` default, jatuh tempo, umur piutang/giro, segmen member 90/180 hari, masa promo, periode payroll, tutup bulan, hari bisnis kasir | **Ya** |
| **Jam keamanan** | `Utc::now()` langsung (ter-allowlist) | Kedaluwarsa sesi & idle, lockout login, lease device, breaker sync, retensi outbox, skew RFID ±5 menit, ttl token | Tidak |
| **Jam monoton** | `tokio::time`, `Instant`, `std::time` | Interval sync 5 s, publisher katalog 5 menit, cooldown breaker, timeout | Tidak |

Pembagian ini keputusan `SIMULATION-PLAN.md` §3.3 yang dipertahankan utuh.

### 1.2 Dua mode jam virtual

```
SystemClock      now() = Utc::now()                          ← default, produksi

ControlledClock  now() = nilai yang diset terakhir           ← Stripe test clock klasik:
                 (set / advance_to / freeze)                    beku, dimajukan manual.
                                                              Dipakai DES simulator (fase 1)
                                                              dan test unit (tanpa sleep).

ScaledClock      now() = v0 + (Utc::now() − r0) × f          ← baru: pemadatan linear.
                 (r0, v0 = titik jangkar; f = faktor)           Berjalan sendiri mengikuti
                                                              jam dinding; untuk rig live,
                                                              demo, dan DB demo.
```

Keduanya implementasi `trait Clock` yang sama (`src/clock.rs`, fase 0a), keduanya
monotonik: `ScaledClock` menyimpan nilai terakhir dan mengembalikan
`max(terakhir, hasil_rumus)` agar langkah mundur NTP tidak memundurkan waktu bisnis.

`ControlledClock` = Stripe Test Clock persis (anchored, frozen, `advance` manual).
`ScaledClock` adalah generalisasi berjalan-otomatis yang Stripe tidak punya —
Stripe meng advance manual karena dunia mereka webhook; dunia kita rig live dan
demo berjam-jam yang harus berjalan tanpa operator.

### 1.3 Matematika dan contoh "2 jam = tanggal berapa"

Definisi per run/demo:

```
r0 = 2026-09-22T09:00:00+07:00   (jam dinding saat mulai)
v0 = 2026-01-01T00:00:00+07:00   (kalender virtual mulai 1 Januari 2026)
f  = 365 hari / 10 jam = 876     (satu tahun 2026 dipadatkan jadi 10 jam nyata)
```

Pertanyaan "sudah 2 jam nyata, kita tanggal berapa":

```
v = v0 + 2 jam × 876 = v0 + 1752 jam = v0 + 73 hari 0 jam
  = 2026-01-01 + 73 hari = 2026-03-15T00:00:00+07:00   (hari ke-74 tahun 2026)
```

Jawaban: **15 Maret 2026, tepat pergantian hari**. Tabel konteks run yang sama:

| Jam dinding berlalu | Waktu virtual | Catatan kalender |
|---|---|---|
| 0 | Kam, 1 Jan 2026 00:00 | mulai tahun (1 hari virtual = 98,6 detik nyata) |
| 20 menit | 13 Jan 2026 04:00 | 12,17 hari virtual berlalu |
| 2 jam | Min, 15 Mar 2026 00:00 | hari ke-74; Q1 (31 Mar) selesai di menit ke-146 jam dinding (11:26) |
| 5 jam | Kam, 2 Jul 2026 12:00 | semester-1 selesai di menit ke-297 (13:57) |
| 10 jam | Jum, 1 Jan 2027 00:00 | 31 Des 2026 baru saja selesai — tutup tahun |

Kalender 2026 tetap asli karena pemetaan memakai aritmetika `DateTime` sungguhan:
Februari 28 hari, April 30, kabisat di 2028 tetap 29. "Tahun terkompresi adalah
tahun yang sama bentuknya" — kegagalan simbot lama ("12 bulan dalam 24 menit"
ditempel belakangan) tidak boleh terulang.

Faktor adalah pilihan skenario, bukan konstanta — ia diturunkan dari rentang yang
dideklarasikan (`f = span_virtual / span_wall`), sehingga panjang bulan 30/31 hari
tidak perlu dirata-ratakan. Preset yang sudah dianggarkan di
`SIMULATION-SCENARIOS-PO.md` §2: demo manusia 1 hari = 2 detik (f = 43.200), rig
live 1 bulan = 1 menit (f ≈ 43.200–44.640 sesuai bulan), soak 1 bulan = 1 hari
(f ≈ 30–31). Fungsi murni `map(real) → virtual` (dan inversenya untuk merencanakan
timeline demo) hidup di `clock.rs` dan dipakai CLI + hub, sehingga menjawab
"tanggal berapa" tidak perlu menunggu sistem hidup.

### 1.4 Resolusi

Bisnis UTC+7, resolusi menit (keputusan `SIMULATION-SCENARIOS-PO.md` §2). Pada
f=876 satu menit virtual = 69 ms nyata (60 s / 876) — diterima karena hanya
penstempel menit yang bergerak, bukan polling. Faktor di atas 60.000 (satu menit
virtual < 1 ms nyata; penstempelan menit kehilangan arti) atau di bawah 1
(waktu melambat, bukan memampat) ditolak validasi saat boot/endpoint dengan
pesan jelas.

---

## 2. Keadaan kode hari ini (audit yang mendasari rencana)

Tidak ada abstraksi jam sama sekali — `grep trait Clock|ControlledClock|SystemClock`
nol. "Sekarang" masuk lewat tiga pintu yang tidak saling kenal:

### 2.1 Jam dinding di Rust (kelas yang akan diikat ke seam)

- **Handler cloud** (~53 bacaan di `cloud/http/*`): default `as_of`/`posting_date`,
  stempel otorisasi, jendela kesegaran `occurred_at` (`http/mod.rs:2079`).
- **Infra Postgres** (~80 bacaan di `cloud/postgres/*`): sesi/lockout `users.rs`,
  pairing member, hold kupon/voucher, tanggal dokumen koreksi,
  `period_close.rs:820 period_of_today()` (satu-satunya "hari ini" pemilih periode),
  freeze kelayakan.
- **Edge** (~53 bacaan): seluruhnya lewat helper privat — `edge/till.rs:38 fn now()`,
  `edge/sqlite.rs:6401-6406 now_text()/time_text()`, petty, attendance, pin,
  printing, rfid. SQLite **tidak punya default jam DB**, waktu edge murni Rust —
  seam paling murah: ganti isi helper, selesai.
- **`reporting.rs:40 local_today()`** — helper tanggal-lokal kanonik (UTC+420),
  tetapi diduplikasi tiga kali (`assistant.rs:1433`, `saved_reports.rs:29`,
  `http/punch.rs:544`). Konsolidasi ke `clock` sekalian.

### 2.2 Jam server Postgres (sumber kedua, paling berbahaya)

- ±127 kolom `TIMESTAMPTZ DEFAULT now()` di migrasi — mayoritas metadata
  (`created_at`, `received_at`, `applied_at`) tapi juga stempel transisi bisnis
  (`journal_entry.posted_at` 0051:70, `issued_at` 0011:31, `decided_at` 0134:180).
- `now()` literal di string SQL adapter (`advance.rs`, `acquirer.rs`, `cash.rs`,
  `banking.rs`, `batches.rs`, …) dan window usia ber-`CURRENT_DATE`
  (`payables.rs:489`, `giro.rs:93`, `payment_ledger.rs:875`, `financing.rs:138`,
  `notifications.rs:367,410`, `auth_policy.rs:1041`, bucket `sync_health`).
- Preseden baik yang sudah ada dan tinggal digenralisasi: parameter "as of"
  penelepon — `giro.rs:93 COALESCE($1::date, CURRENT_DATE)`, `ledger.rs:2092`,
  `statements.rs:1116`.

### 2.3 Yang sudah benar hari ini (tidak perlu disentuh)

- **Kernel murni sudah time-as-argument**: `PricingContext.at`, `TimeWindow`/
  `DaySet` di pricing-engine dievaluasi terhadap instan yang diberikan penelepon —
  "simulasi Selasa lalu = jalur kode yang sama dengan jualan sekarang". Seam
  modelnya ada; yang kotor tepiannya saja.
- **Periode fiskal digerakkan tanggal, bukan jam**: trigger `assert_period_open`
  (0051) mengekstrak Y/M dari `posting_date` dokumen; `poster.rs` satu-satunya
  titik masuk. Setahun virtual otomatis melintasi 12 periode tanpa menyentuh jam DB.
- **Urutan fakta berbasis `seq`**, bukan timestamp — intoleransi skew antar node
  sudah rendah secara desain.
- **`inventory-time-machine`** = rekonstruksi titik-waktu berbasis sequence untuk
  debugging divergensi; bukan jam virtual, tidak berubah.

### 2.4 Agen latar (digerakkan `tokio::time::interval` nyata)

`bin/cloud.rs` + `cloud/application/sync.rs`: publisher katalog 5 menit, siaran
usage 15 menit, pembersihan/ageing tiap jam, tutup-bulan tiap jam (bulan dihitung
dari `Utc::now` di `bin/cloud.rs:195`), integritas tiap jam, lease auth 6 jam;
edge sender 5 detik (`edge/sync.rs`). Pada f=876, satu bulan virtual = 50 menit
nyata → agen bulanan ber-tick jam **melewatkan bulan**; lihat §5.

---

## 3. Seam: `src/clock.rs` dan injeksi

Persis fase 0a `SIMULATION-PLAN.md`, ditambah `ScaledClock` dan bootstrap env:

1. `src/clock.rs`:
   - `trait Clock: Send + Sync { fn now(&self) -> DateTime<Utc>; fn today_local(&self) -> NaiveDate; }`
     (`today_local` menyerap `local_today()` dan duplikatnya).
   - `SystemClock` — default, tinggal bungkus `Utc::now()`.
   - `ControlledClock(Arc<RwLock<DateTime<Utc>>>)` — set/advance/freeze (Stripe klasik).
   - `ScaledClock { r0, v0, factor, last: Mutex<DateTime<Utc>> }` — rumus §1.3,
     monotonik, plus `pause()`/`resume()` (jeda = menggeser `r0` sebesar jeda nyata;
     waktu virtual berhenti lalu lanjut dari titik yang sama — penting untuk demo
     yang dihentikan semalam).
   - `ClockMode` serde: `{ system } | { controlled, at } | { scaled, anchor_real, anchor_virtual, factor }`
     — satu tipe yang dipakai env, endpoint kontrol, dan konfigurasi run.
2. Injeksi: `AppState.clock: Arc<dyn Clock>` (cloud) dan field `clock` di konteks
   edge (`NodeContext`/`SqliteEdge`). Semua helper privat (`edge/till.rs now()`,
   `sqlite.rs now_text()`) membaca dari sana — satu titik per modul, bukan 186
   panggilan diganti satu-satu.
3. Bootstrap env (rig/demo lahir terpadat tanpa HTTP):

   ```bash
   ITULAH_CLOCK=scaled
   ITULAH_CLOCK_ANCHOR_REAL=2026-09-22T09:00:00+07:00
   ITULAH_CLOCK_ANCHOR_VIRTUAL=2026-01-01T00:00:00+07:00
   ITULAH_CLOCK_FACTOR=876
   ```

   Validasi saat boot: `anchor_real` tak boleh di masa depan, `factor` dalam
   batas §1.4, `anchor_virtual` dapat `DateTime` apa pun (bukan cuma 1 Januari).
4. Gate `tests/clock_authority.rs` (gaya `write_authority.rs` dan
   `kernel_purity.rs`): hanya file ter-allowlist yang boleh memanggil `Utc::now()`
   — `security.rs`, `users.rs` (sesi/lockout), `edge/auth.rs`, breaker sync,
   `clock.rs` sendiri. File lain yang menambah panggilan = test merah. Audit
   lengkap kelas A/B/C keluar sebagai `docs/clock-audit.md` (deliverable fase 0a).

---

## 4. Sisi SQL: melucuti jam server untuk maksud bisnis

Klasifikasi fase 0a dipertahankan, dengan strategi per kelas:

- **Kelas A — metadata infra** (`created_at`/`updated_at`/`received_at` pada tabel
  infra & sync, `DEFAULT now()`): **dibiarkan** di jam DB. Ini penanda "kapan baris
  benar-benar ditulis" — justru penting tetap nyata saat setahun berjalan 10 jam.
  Konsekuensinya jadi aturan yang dijaga gate: **makna bisnis tidak boleh
  diturunkan dari kolom kelas A**; window bisnis hanya boleh membaca kolom bisnis
  (`occurred_at`, `posting_date`, `due_date`, …). UI yang menampilkan "dibuat"
  kepada pengguna memakai kolom tanggal dokumen, bukan `created_at`.
- **Kelas B — stempel bisnis di Rust** (tanggal dokumen, `posting_date` default,
  `occurred_at`, issued/decided): diganti `clock.now()` di handler/infra. Kolom
  `DEFAULT now()` yang sebenarnya stempel transisi bisnis (`posted_at`, `issued_at`,
  `decided_at`) diisi eksplisit dari aplikasi; default DB dibiarkan sebagai
  pengaman terakhir, bukan sumber kebenaran.
- **Kelas C — window bisnis di SQL** (`CURRENT_DATE - due`, `now() - interval '90 days'`):
  diikat parameter `$now`/`$today` dari `clock.now()` — pola `COALESCE($1, CURRENT_DATE)`
  yang sudah hidup di `giro.rs` digeneralisasi. Konstrain khusus:
  `membership.rs:75-86 SEGMENT_CASE` adalah `&'static str` yang di-splice ke SQL
  katalog laporan sehingga tak bisa menerima bind parameter. Penyelesaiannya:
  konstanta menjadi fungsi kecil `segment_case(now: DateTime<Utc>) -> String`
  yang meng-interpolasi literal timestamp ter-format pada saat query dibangun
  (mengikuti pola literal window yang sudah ada di string itu), dan test
  `the_windows_are_the_two_the_screen_prints` diperluas menjaga keduanya tetap segaris.
- **Umur piutang/giro/financing** (`payables.rs:489`, `giro.rs:93`, `payment_ledger.rs:875`,
  `financing.rs:138`): `CURRENT_DATE` → `$today` dari jam. Kontrak jatuh tempo tidak
  berubah dan justru jadi benar di bawah kompresi: termin dihitung dari tanggal
  bill sendiri (`PAYMENT-TERMS-PLAN.md`: instalment dimiliki bill, dihitung dari
  invoice date-nya), jadi "NET_30 dalam tahun terpadat" jatuh tempo 30 hari
  *virtual* kemudian = 49 menit nyata pada f=876.
- **Titik validasi yang menyentuh jam** (temuan grill, semuanya kelas B/C →
  `clock.now()`): clamp `occurred_at` manual movement `[now−7d, now+5m]`
  (`http/mod.rs:2076-2085`); jendela RFID ±300 s dan `observed_at`
  tak-boleh-masa-depan (`edge/rfid.rs:295-299, 536-540`); gerbang expiry voucher /
  hold `now + hold_seconds` (`vouchers.rs:741-745, 1274`); bucket bulan nomor
  surat dari `Utc::now()` (`letters.rs:966-978` — konsistenkan dengan `doc_date`
  seperti kas); klem `day_offset` punch (`attendance.rs:552-560`); sweep ageing
  yang hari ini mencampur `CURRENT_DATE` dan `Utc::now()` dalam satu pass
  (`notifications.rs:355-470`) — keduanya wajib satu sumber `clock.now()`, kalau
  tidak separuh overdue virtual dan separuh nyata.
- **Periode fiskal**: tidak disentuh — sudah digerakkan `posting_date` (§2.3).
  `period_of_today()` berpindah ke `clock`.

---

## 5. Agen latar: digerakkan kalender virtual, bukan timer

Masalah: pada f=876, 12 bulan virtual lewat dalam 10 jam nyata; agen tutup-bulan
ber-tick 1 jam hanya bangun 10× dan **melewatkan bulan**; sebaliknya agen lease 6 jam
hampir tak pernah bangun (itu jam keamanan — memang dibiarkan nyata).

Desain: `VirtualScheduler` di cloud (satu task, diaktifkan hanya bila
`ClockMode::Scaled`/`Controlled` aktif):

```
tick tokio tiap 1 s nyata
  → now_v = clock.now()
  → untuk tiap kadensi terdaftar [hari, minggu, bulan, 5 menit katalog? tidak — lihat bawah]
      bila batas virtual berikutnya (next_day_v, next_month_v, …) ≤ now_v:
          jalankan fungsi kerja agen untuk hari/bulan yang terlewati,
          ulangi bila >1 batas terlewati (burst mengejar)
```

- Fungsi kerja agen sudah terpisah dari loop-nya (dipanggil langsung oleh simulator
  in-process menurut `SIMULATION-SCENARIOS-PO.md` §2) — `VirtualScheduler` adalah
  penelepon kedua fungsi yang sama, bukan duplikat logika.
- Yang berlangganan batas **kalender**: tutup bulan/soft-close, depresiasi aset,
  amortisasi prepaid, aging sweep (idempoten — boleh juga tetap per jam nyata),
  siaran usage bila kelak jadi kalender-driven.
- Yang **tidak** berlangganan: publisher katalog & pengiriman harga (snapshot
  berbasis state; harga dievaluasi `PricingContext.at` pada saat jual — kadense
  nyata cukup), sync sender (seq-driven, 5 s nyata), lease auth (jam keamanan).
- Batas burst: satu bulan nyata-ganda yang terlewati (mis. rig dipause semalam)
  dieksekusi berurutan maksud-kalender, bukan paralel; kalender virtual boleh
  tertinggal eksekusinya, tidak boleh dilewati diam-diam.

---

## 6. Antarinode: satu konfigurasi, waktu diturunkan lokal

Konfigurasi jam (`ClockMode`) identik di semua node — di rig live disetarkan via
env per proses, atau via `POST /control/clock` per node oleh skrip rig, dan
kelak ikut publish policy edge. Karena `ScaledClock` menghitung dari jam dinding
lokal + jangkar yang sama, **tidak ada sinkronisasi per-tick**: dua node hanya
berbeda sebesar skew jam mesinnya. Pada f=876, skew 250 ms = ±3,6 menit virtual —
diterima karena (a) urutan fakta tetap `seq`, (b) derivasi window dilakukan node
pemilik data (cloud menghitung umur piutang dengan jam cloud; edge menstempel
`occurred_at` dengan jam edge). Aturan yang dijaga: **node tidak menghitung window
atas data milik node lain** — sudah demikian hari ini.

`GET /api/v1/inventory/control/clock` (cloud & edge) mengembalikan
`{mode, anchor_real, anchor_virtual, factor, real_now, virtual_now, paused}`
sehingga skrip rig memverifikasi semua node sepakat sebelum run dimulai
(guardrail live harness #3 `SIMULATION-PLAN.md` §10: skenario ber-jam-virtual
menolak jalan bila test controls mati — diperluas: menolak bila konfigurasi jam
node tidak seragam).

Mesin sync outbox sendiri bebas waktu: identitas dan urutan murni
`(origin_id, generation, seq)` + `event_id`, ingest tidak memvalidasi timestamp
fakta, dan semua stempel jalur sync kelas A nyata — pembuktian dan protokol
re-anchor mid-run di §7.4.

---

## 7. Mengubah waktu, memundurkan waktu, dan data yang sudah ada

Bagian ini hasil "grill" atas rancangan: apa yang boleh diganti saat run berjalan,
apa yang terjadi pada data yang sudah tertulis, dan khususnya apa yang terjadi pada
mesin sync outbox. Semua klaim dikutip dari kode.

### 7.1 Operasi yang mungkin dan harganya

| Operasi | Mekanik | Dampak ke data berjalan | Outbox/sync | Kebijakan |
|---|---|---|---|---|
| **Ganti kecepatan** `rescale(f')` | jangkar-ulang kontinu: `r0'=now`, `v0'=virtual_now`, `f'` | nol — waktu virtual tak melompat, hanya lajunya berubah | nol | didukung langsung; satu-satunya cara ganti `f` |
| **Pause / resume** | `resume` menggeser `r0` sebesar lamanya jeda; `v` beku lalu lanjut dari titik yang sama | nol pada data; **sesi & lease tetap jam nyata** — pause berhari-hari memaksa login ulang (itu memang jam keamanan) | sender 5 s nyata tetap hidup; kosong-kosong saja | didukung; direkomendasikan sebelum re-anchor |
| **Maju** (`advance_to`, jangkar-ulang ke depan) | `v` melompat ke depan | `VirtualScheduler` burst menutup hari/bulan yang terlewati; voucher/hold/coupon kedaluwarsa massal (expiry dihitung saat dibaca, `vouchers.rs:60-66`); checklist tutup-bulan menandai late-entry | **command in-flight mati permanen**: `expires_at <= now` → `SKIPPED_EXPIRED`, watermark maju, tak bisa dihidupkan lagi (`domain/sync.rs:596-601`) | boleh, lewat protokol §7.4 (quiesce dulu) |
| **Mundur** | jangkar-ulang ke belakang | peta kerusakan §7.2 — bukan mesinnya yang rusak, datanya | urutan tetap aman; command yang sudah `SKIPPED_EXPIRED` tetap mati | **ditolak endpoint** kecuali mode `controlled` (DB disposable) atau `force` + dry-run konsekuensi |
| **Kembali ke jam dinding** (`mode=system`) | setara lompatan maju raksasa (mis. virtual Mei 2026 → nyata Sep 2026) + `f=1` | sama dengan maju; periode fiskal yang dilompati harus dibuka/ditutup sadar | sama dengan maju | boleh, protokol §7.4 |

### 7.2 Mundur: mengapa dilarang — peta kerusakan yang sebenarnya

Yang mengejutkan dari audit: **mekanik sync dan penomoran aman semua**. Yang rusak
adalah data bisnis yang ber-tanggal sebagai *kunci*:

1. **Penghitungan ganda (paling fatal).** Mengulang hari virtual yang sama
   menghasilkan fakta *baru* (event_id baru, seq baru — sah menurut mesin). Di cloud,
   dokumen hari itu `sales_posting UNIQUE(site_id, business_date)`:
   status DRAFT diganti diam-diam lewat `ON CONFLICT DO UPDATE` dan re-derivasi
   window UTC+7 mengagregasi fakta lama **dan** baru hari itu (0107:102;
   `sales_posting.rs:899-908`) → pendapatan hari dobel. Jika sudah POSTED, ia menolak
   (`sales_posting.rs:873-885`) dan satu-satunya jalan adalah reversal
   (`sales_posting.rs:1388-1392`).
2. **Gerbang periode fiskal.** Tanggal virtual yang jatuh di bulan CLOSED/SOFT_CLOSED
   ditolak keras 409 (trigger `assert_period_open` 0051, `assert_period_open_for`
   0127); bulan tanpa baris `fiscal_period` juga ditolak ("open it before posting").
   Rewind ke bulan yang sudah ditutup = semua posting gagal.
3. **Merge diam-diam vs konflik, per struktur** (hasil audit ~15 struktur
   tanggal-kunci): `tender_reconciliation` mengembalikan baris lama tanpa suara
   (`acquirer.rs:333-360`); keputusan recon yang sudah ditutup menolak jawaban baru;
   `payroll_run` kedua untuk bulan yang sama → konflik (0105); `budget` → konflik
   (0305); depresiasi/prepaid/tax justru idempoten-skip (aman).
4. **Punch mundur ditolak di edge**: `business_date` lebih tua dari hari-lokal
   ditolak kecuali dikirim eksplisit (`attendance.rs:552-560`).
5. **Voucher/coupon/hold "hidup lagi"**: expiry adalah perbandingan, bukan status
   tersimpan (`vouchers.rs:60-66`) — kode kedaluwarsa bisa ditukar lagi; satu-satunya
   pagarnya `UNIQUE(coupon_code_id, sale_id)`.
6. **Yang terbukti aman**: penomoran — jurnal pakai SEQUENCE global `JV-n`
   (0051, bukan per-periode), kas `KK-YY-MM-NNNNN` melanjutkan counter bulan lama
   (0115), GRN per site tanpa tanggal; tak ada tabrakan nomor.
7. **Checklist tutup bulan menyala terus**: late-entry membandingkan `posting_date`
   (virtual) vs `posted_at` (nyata, kelas A) — `period_close.rs:433-436` — hanya
   informatif, tapi rewind membuat semua entri tampak "terlambat".

Kesimpulan: mundur adalah operasi *destruktif-bisnis* meski *aman-mekanik*. Endpoint
menolaknya pada `ScaledClock`; escape-hatch `force` harus menjalankan **dry-run** yang
mengembalikan daftar dokumen tanggal-kunci yang akan konflik/merge/dobel sebelum
eksekusi. Pada `ControlledClock` (test/DES, DB per run) mundur bebas — itu memang
cara menguji ulang hari.

### 7.3 Data yang sudah ada: tiga situasi

| Situasi | Jangkar | Akibat | Status |
|---|---|---|---|
| **DB baru per run** (greenfield) | `v0` bebas di masa lalu (mis. 1 Jan 2026) | tak ada sejarah yang bertentangan | default; satu DB per run (P5 `SIMULATION-PLAN.md`) |
| **Melanjutkan DB hidup** (continuation) | `v0` = hari nyata saat jam dinyalakan (jangkar identitas) | sejarah real tetap "masa lalu"; hanya masa depan yang terkompres; nol lompatan, nol window straddle | didukung; ini cara memasang kompresi pada rig yang sudah berjalan |
| **Retrofit mundur ke DB bersejarah** | `v0` di masa lalu pada DB yang sudah berisi tanggal nyata | sejarah jadi "masa depan": segmen member menganggap pembelian depan sebagai baru (`>= now-90d` benar untuk tanggal future), ageing diam (semua belum jatuh tempo), `SALE_BUSINESS_DATE`/`day_window` mencampur dua basis waktu, periode fiskal virtual belum ada → semua posting ditolak sampai dibuka manual | **dilarang** pada data yang dipertahankan; jika dipaksa pada DB demo disposable: buka periode virtual, terima laporan straddle |

Aturan epoch: satu database hidup dalam satu epoch jam. Pergantian mode dicatat
sebagai baris auditable (`clock_epoch`: waktu nyata, waktu virtual, mode, operator)
sehingga laporan bisa menyadari batas dua basis waktu — konsekuensi kelas dari
"data yang sudah ada" tidak boleh tak terlihat.

### 7.4 Outbox dan sync di bawah waktu virtual

Pertanyaan paling tajam dari grill — dan jawabannya paling tenang:

**Fakta dari kode.**

- **Identitas dan urutan 100% bebas waktu.** PK `(origin_id, generation, seq)` +
  `event_id` unik (0006_sync_outbox.sql; sqlite/0002); watermark `GREATEST`,
  gap = berhenti (`cloud/postgres/sync.rs:386-395`). Tak ada timestamp di jalur
  identitas → maju, mundur, atau ganti faktor **tidak bisa** merusak urutan sync.
- **Ingest tidak memvalidasi waktu fakta.** Penolakan permanen hanya soal
  event_type/bentuk payload (`domain/sync.rs:193-201`); `occurred_at` payload
  di-apply verbatim; rekonstruksi state time-machine "immune to backdated
  occurred_at" (`time_machine.rs:106`). Fakta ber-tanggal virtual ber-flow apa
  adanya, lintas epoch sekalipun.
- **Semua stempel jalur sync adalah kelas A/nyata** dan memang harus tetap begitu:
  `created_at` outbox distempel Rust saat enqueue, `received_at`/`updated_at`
  `now()` server, breaker `now()+cooldown`, retensi `now() − 14 hari`
  (`sync.rs:248-251, 348-353, 377-378`), gate purge `Instant` nyata. Artinya:
  retensi 14 hari **nyata** (bukan virtual) — pada demo 10 jam outbox tak pernah
  terpurge di tengah run; pada soak justru evidence tetap hidup selama operasi.
- **Titik tempat dua jam bertemu** (wajib satu sumber, kelas B/C — sudah masuk
  daftar §4): clamp `occurred_at` manual movement (`http/mod.rs:2076-2085`);
  jendela RFID ±300 s dan `observed_at` tak-boleh-masa-depan (`edge/rfid.rs:295-299,
  536-540`) — konsekuensinya **simulator device eksternal (mis.
  `scripts/rfid_simulator.py`) harus menandatangani dengan waktu virtual**, diambil
  dari `GET /control/clock` atau header `x-virtual-time`; expiry command
  (`domain/sync.rs:596-601`) tetap nyata; sweep ageing yang hari ini mencampur
  `CURRENT_DATE` DB dan `Utc::now()` Rust dalam satu pass (`notifications.rs:355-470,
  terutama :419`) wajib keduanya dari `clock.now()` — kalau tidak, separuh overdue
  virtual dan separuh nyata.

**Protokol re-anchor mid-run** (untuk maju / ganti mode / kembali ke dinding):

```
1. POST pause ke semua node          (waktu virtual beku di titik yang sama)
2. tunggu outbox tenang              (watermark = seq terakhir; ~detik pada rig)
3. POST mode baru yang identik ke semua node
4. verifikasi GET /control/clock seragam
5. resume
```

Tanpa protokol pun ingest tidak akan menolak fakta lintas-epoch (tak ada validasi
waktu) — yang dilindungi protokol adalah command in-flight agar tidak mati oleh
expiry, dan window laporan agar tidak menghasilkan hasil setengah-epoch. Pause
sebelum re-anchor juga meniadakan race "fakta ditulis dengan jangkar lama tepat
sebelum jangkar berganti".

---

## 8. API kendali, CLI, dan yang terlihat manusia

| Method/Tempat | Fungsi |
|---|---|
| `GET /api/v1/inventory/control/clock` | status jam (mode, jangkar, faktor, real & virtual now) |
| `POST /api/v1/inventory/control/clock` | `{mode:"scaled", anchor_real, anchor_virtual, factor}` · `{rescale: f}` (jangkar-ulang kontinu, tanpa lompatan) · `{mode:"controlled", at}` / `{advance_to}` · `{pause/resume}` — mundur ditolak kecuali `force` + dry-run (§7.2); 403 bila `INVENTORY_ENABLE_TEST_CONTROLS≠true` (pola `control.rs:733-735`) |
| Header `x-virtual-time` | middleware menempelkan `virtual_now` (RFC3339+07) di **semua** respons saat mode virtual aktif — murah, dan semua klien tahu waktu tanpa endpoint khusus |
| `reporting.rs` | `local_today()` & duplikatnya membaca `clock`; laporan yang menyertakan "per tanggal" memakai `today_local()` |
| Hub (frontend-hub) | chip jam virtual: "1 tahun = 10 jam · Selasa, 15 Mar 2026 14:32 WIB" + progres tahun; sumber `GET /control/clock` (fase 4 modul Simulation bisa memakainya) |
| Struk POS | sudah mencetak waktu lokal toko (`POS-SHELL-PLAN.md:269-272`); di bawah ScaledClock otomatis ikut virtual karena menstempel dari jam edge |
| CLI kecil `clock-map` | `map(real)→virtual` & inversenya dari konfigurasi run — alat merencanakan timeline demo ("jam 19:00 nanti kita sudah di bulan September") |

---

## 9. Batas dan anti-goal

1. **Produksi tak berubah**: default `SystemClock`; tanpa env/endpoint, perilaku
   byte-per-byte seperti hari ini. Kompresi hanya di lingkungan disposable
   (`INVENTORY_ENABLE_TEST_CONTROLS` memang menolak selain itu).
2. **Jam keamanan tetap nyata** — sesi, lockout, lease, breaker, skew RFID,
   retensi outbox. Tidak ada yang boleh memanggil `clock.now()` untuk maksud
   keamanan (dijaga `clock_authority` dari arah sebaliknya).
3. **Timer monoton tetap nyata** — sync 5 s, publisher 5 menit, cooldown. Jam
   virtual tidak menyentuh `tokio::time`.
4. **Tidak ada `sleep` yang dikompresi**: fake hardware / simulator DES
   memodelkan latensi sebagai waktu virtual (prinsip #5 `SIMULATION-PLAN.md` §10).
5. **Bukan cron patch simbot lama**: tidak ada `COALESCE(sim_clock, …)` di 38
   tempat SQL; satu seam di Rust + parameter `$now` eksplisit, dan gate yang
   menjaga tidak menyimpang.
6. **Tidak menkompres idempotensi/uniqueness**: `Idempotency-Key` dan ETag tidak
   melibatkan waktu; biarkan.
7. Determinisme replay penuh hanya milik mode in-process DES (`ControlledClock`
   + seed, fase 1 `SIMULATION-PLAN.md`); ScaledClock di rig live eksplisit
   **tidak** menjanjikan replay identik — waktu tiba adalah jam dinding.
8. **Mundur bukan fitur**: kebijakan §7 — endpoint menolak; yang tergantikan
   adalah dokumen tanggal-kunci, bukan bug yang bisa "dibetulkan".

---

## 10. Fase rencana

Ukuran: S ≈ 1–2 hari kerja satu sesi, M ≈ 3–5. Fase 0a di bawah adalah lane yang
sama dengan `SIMULATION-PLAN.md` §11 (diperluas), bukan pekerjaan ganda.

### Fase 0a — Seam + ScaledClock (M, 3 lane paralel)

| Lane | Deliverable | Exit |
|---|---|---|
| 0a-1 Jam | `src/clock.rs` (`SystemClock`/`ControlledClock`/`ScaledClock`/`ClockMode`/`map`, `rescale`/`pause`/`resume`); injeksi `AppState.clock` + konteks edge; helper edge & `local_today()` konsolidasi; bootstrap env + validasi; `tests/clock_authority.rs` | `cargo test` hijau; test baru: `ScaledClock` f=876 → `map(anchor+2h)` = hari ke-74 2026; monotonik saat jam dinding mundur; pause/resume tak melompat; `rescale` kontinu (virtual_now tak berubah saat panggilan) |
| 0a-2 Audit B/C | `docs/clock-audit.md` (kelas A/B/C, ±186 titik Rust + SQL); kelas B diganti `clock.now()`; kelas C diikat `$now`/`$today` (termasuk `SEGMENT_CASE` jadi fungsi, window usia, `period_of_today`, clamp `occurred_at`, jendela RFID, sweep ageing satu sumber) | test eksisting hijau; test baru: memajukan jam 90 hari virtual mengubah segmen member **tanpa** mematikan sesi (exit test fase 0a SIMULATION-PLAN) |
| 0a-3 Kendali | `GET/POST /api/v1/inventory/control/clock` cloud & edge (mundur → 409 + dry-run daftar konsekuensi); header `x-virtual-time`; protokol re-anchor §7.4 (pause → drain → set seragam → verifikasi → resume); baris auditable `clock_epoch` | skrip rig: set scaled di 3 node → semua `GET` melaporkan virtual_now within ±1 menit virtual; POST ditolak 403 tanpa flag; re-anchor mid-run tanpa command yang mati |

### Fase 0d — `VirtualScheduler` (S–M, setelah 0a)

- Tick 1 s nyata, deteksi batas virtual (hari/minggu/bulan), panggil fungsi kerja
  agen yang sudah terpisah; burst mengejar multi-bulan.
- **Exit:** integration test: `ScaledClock` f besar (1 bulan = 1 menit) selama
  5 menit nyata menutup 5 bulan virtual berurutan (soft-close + depresiasi terpanggil
  per bulan, tak ada bulan terlewat); tanpa mode virtual, nol panggilan tambahan.

### Fase 1–4 — tetap milik SIMULATION-PLAN

Simulator DES (`crates/sim`), persona, skenario, coverage, hub — tidak berubah
rencananya; `ControlledClock` adalah jam yang dipakai DES. Tambahan kecil di fase 4:
chip jam virtual + `clock-map` di modul Simulation hub.

### Fase D — Demo "satu tahun dalam 10 jam" (S, setelah 0a+0d, bisa sebelum fase 1)

- Rig live 3 proses dengan env §3, seed katalog via `seed-everything.sh`, sejarah
  perdagangan via skenario `demo` (atau seed) — setahun 2026 berjalan nyata 10 jam.
- **Exit:** `GET /control/clock` menjawab benar di titik-titik tabel §1.3;
  umur piutang NET_30 bertambah 30 hari virtual per 49 menit nyata; tutup bulan
  terjadi 12×; periode fiskal 2026/01–2026/12 terbuka-tertutup berurutan; sesi
  login tidak pernah kedaluwarsa lebih cepat dari biasanya.

---

## 11. Risiko dan keputusan terbuka

| Risiko / pertanyaan | Rekomendasi |
|---|---|
| Audit kelas C lebih luas dari perkiraan (SQL tersebar, `SEGMENT_CASE` di-splice katalog) | Per modul mengikuti kebutuhan persona (member, payables, giro dulu); sisanya tetap jam dinding sampai modulnya masuk — sama dengan mitigasi `SIMULATION-PLAN.md` §12 |
| Skew antarnode pada faktor besar | Terima (urutan = `seq`); dokumen anggaran skew ±250 ms; bila kelak bermasalah: cloud jadi otoritas konfigurasi via publish policy, dan derivasi window hanya di cloud |
| Lompatan besar (pause semalam, jangkar-ulang) membuat banyak bulan tertinggal | Burst mengejar di `VirtualScheduler`, dibatasi urut; operasi jangkar-ulang menolak melompat mundur melewati periode fiskal terkunci (periode tertutup tetap tertutup) |
| **Rewind = dobel bisnis**: mengulang hari virtual menambah fakta baru yang melebur ke dokumen hari yang sama (`sales_posting` DRAFT diganti diam-diam; §7.2) | Endpoint menolak mundur pada `ScaledClock`; `force` wajib dry-run yang mendaftarkan dokumen tanggal-kunci yang akan konflik/merge/dobel; pada `ControlledClock` (DB per run) mundur bebas |
| Retrofit mundur ke DB bersejarah membuat sejarah jadi "masa depan" (segmen, ageing, periode fiskal, day-window straddle — §7.3) | Hanya dua jangkar sah: greenfield (DB baru, `v0` bebas) atau continuation (`v0` = hari nyata). Retrofit mundur hanya untuk DB disposable; pergantian mode dicatat di tabel `clock_epoch` |
| Simulator device eksternal menandatangani dengan jam dinding → ditolak jendela RFID ±300 s saat jam virtual aktif (§7.4) | `rfid_simulator.py` dkk mengambil waktu dari `GET /control/clock`/`x-virtual-time`; di rig in-process fake reader memakai clock yang sama |
| Lompatan maju membunuh command sync in-flight (`SKIPPED_EXPIRED` permanen, `domain/sync.rs:596-601`) | Protokol re-anchor §7.4: pause → drain → set seragam → verifikasi → resume |

---

## 12. Uji yang membuktikan

1. **Pemetaan murni** (unit): jangkar 2026-01-01+07, f=876 → +2 jam = 15 Mar,
   +5 jam = 2 Jul 12:00, +10 jam = 1 Jan 2027 00:00; kabisat 2028 di uji terpisah;
   inversi `map⁻¹` konsisten; monotonik di bawah step NTP mundur.
2. **Segmen member tanpa sesi mati** (0a-2 exit, dari SIMULATION-PLAN): maju 90 hari
   virtual → member NEW→ACTIVE→LAPSING; sesi tetap hidup.
3. **Jatuh tempo virtual** (integration): bill NET_30 di-tanggal virtual T →
   `next_due_date` = T+30 virtual; umur `days_overdue` dihitung dari `$today`
   jam virtual; giro jatuh tempo ke tanggal efektifnya.
4. **Tutup bulan terkompresi** (0d exit): 1 bulan = 1 menit selama 5 menit →
   5 soft-close + periode fiskal berurutan; posting ke periode tertutup ditolak
   trigger (sudah benar hari ini — dibuktikan tetap benar di bawah kompresi).
5. **Gate**: `clock_authority` merah bila file di luar allowlist memanggil
   `Utc::now()`; hijau sesudah klasifikasi.
6. **Demo rig** (fase D): tabel §1.3 diverifikasi di titik nyata; sesi, lease,
   breaker tidak terpengaruh (jam keamanan nyata).
7. **Outbox lintas epoch** (integration): re-anchor maju di tengah pengiriman →
   fakta ber-tanggal dua epoch diterima ingest tanpa penolakan, watermark maju
   monoton, urutan `(generation, seq)` utuh, dead-letter kosong; retensi tetap
   memotong pada 14 hari **nyata**.
8. **Command vs lompatan** (integration): maju jam melewati `expires_at` command
   hidup → `SKIPPED_EXPIRED` (perilaku hari ini dipertahankan); dengan protokol
   re-anchor (pause-drain-set-resume) tidak ada command yang mati.
9. **Mundur ditolak + dry-run** (integration): `POST` jangkar mundur pada
   `ScaledClock` → 409 dengan daftar konsekuensi (dokumen tanggal-kunci yang akan
   konflik/merge/dobel + bulan tertutup yang akan menolak posting); pada
   `ControlledClock` DB-disposable rewind diizinkan dan voucher kedaluwarsa
   terbukti "hidup lagi" (mendokumentasikan bahayanya).
