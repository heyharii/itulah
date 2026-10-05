# POS Improvement Pass — 2026-08-30

Hasil perbandingan dengan dua codebase referensi (`~/Documents/fresh` alias
RetailOS, dan `~/Documents/retail/final-product/backend`) dan perbaikan yang
diterapkan pada lane **auth / payments / receipts / returns / reporting /
HTTP hardening**. Lane lain (sync engine, time machine, outbound
destination-scoping) dikerjakan paralel oleh sesi lain.

## Yang dibangun

### Autentikasi & otorisasi (gap produksi terbesar — sebelumnya NOL auth)
- `migrations/0007_auth.sql` — tabel `app_user` (argon2id hash, role
  `CASHIER < SUPERVISOR < ADMIN`), SQL polos agar murah di-port ke SQLite.
- `domain/auth.rs` — aturan role murni + test: sales flow = CASHIER; void &
  returns = SUPERVISOR ("manager key turn"); mutasi inventory/commercial =
  SUPERVISOR; kontrol node, user management, replay/repost, operator sync =
  ADMIN; semua read butuh login.
- `http/auth.rs` — login JWT (HS256, secret lokal node → tetap jalan
  offline), middleware role-gate, dan **penegakan actor_id**: body JSON yang
  membawa `actor_id` harus sama dengan user yang login (audit trail tidak
  bisa dipalsukan). Body diteruskan byte-for-byte agar digest idempotency
  tidak berubah.
- Bootstrap: boot pertama membuat user `admin` dari
  `INVENTORY_BOOTSTRAP_ADMIN_PASSWORD`; tanpa `INVENTORY_JWT_SECRET` API
  berjalan TERBUKA dengan peringatan keras (kompatibel dev lama), dan
  `/api/v1/health` menampilkan `"auth": "DISABLED"`.
- Login gagal dibuat tak terbedakan (unknown user / salah password / akun
  nonaktif) — tahan username enumeration; admin tidak bisa menonaktifkan
  akunnya sendiri.
- Frontend: `auth.js` (overlay login + fetch shim Bearer + rewrite actor_id
  ke user login) — tanpa dependency, ~150 baris.

### Aturan tender (bug dari audit)
- `validate_tender` di domain: **kembalian hanya boleh keluar dari CASH** —
  tender non-tunai (CARD/QRIS/OTHER) tidak boleh melebihi total; aturan
  agregat sehingga tidak tergantung urutan pembayaran campuran.
- `add_sale_payment`: tolak pembayaran sebelum ada line; tolak non-cash yang
  melebihi sisa tagihan.
- `complete_sale`: pre-check saldo per item yang menyebut EPC saat kalah
  race antar kasir; `completed_at` di response = nilai yang di-commit
  (bukan dua `now()` berbeda); idempotency key movement di-namespace
  (`sale:{key}:inventory`) agar tidak bentrok dengan command lain.

### Retur pelanggan (sebelumnya tidak ada sama sekali)
- `migrations/0008_returns.sql` + cause ledger baru `CUSTOMER_RETURN`
  (customer → store floor bila layak jual, → store reject bila rusak; transisi
  lain ditolak di domain).
- Satu transaksi: dokumen retur + movement + baris refund — atau tidak sama
  sekali. Sale yang sudah final tidak pernah di-update (immutable).
- Aturan: hanya sale COMPLETED; satu sale line hanya bisa diretur sekali
  (V1 full-line, ditegakkan unique index); total refund harus sama dengan
  nilai barang yang diretur; akumulasi refund tidak boleh melebihi total
  sale. Idempotent penuh.
- Endpoint: `POST /api/v1/sales/{id}/returns`, `GET /api/v1/returns[/{id}]`.

### Struk (sebelumnya tidak ada)
- `GET /api/v1/sales/{id}/receipt` — struk selalu **direkonstruksi dari row
  durable** (pola fresh): reprint kapan pun identik dan jalan offline;
  currency di-trim; ringkasan pajak per (kategori, tarif, inclusive) dari
  penjumlahan per-line (bukan rekomputasi subtotal — catatan pembulatan dari
  audit); menandai line yang sudah diretur dan total refund.
- `frontend/receipt.html` — halaman cetak 58mm (`?sale=<id>`), tombol Cetak.

### Laporan harian (sebelumnya tidak ada reporting sales)
- `GET /api/v1/reports/sales/daily?site_id&date[&utc_offset_minutes]`
  (default WIB): jumlah & unit terjual, net/tax/gross, tender per metode,
  void, retur per metode, dan **cash_expected** = cash masuk − kembalian −
  refund tunai (identitas laci ala fresh `http_daily.rs`).

### HTTP hardening (dari audit sesi d8)
- Pelanggaran trigger DB (SQLSTATE P0001) kini 409 + pesan trigger, bukan 500.
- `DefaultBodyLimit` 2 MB; batch observasi RFID maksimal 10.000 read.
- CORS bisa dibatasi via `INVENTORY_CORS_ALLOWED_ORIGINS` (unset = permissive
  dev).
- `POST /inventory/movements` manual hanya menerima cause `NORMAL_MOVE` /
  `RETURN_TO_DC` (cause milik workflow seperti `SALE` ditolak) dan
  `occurred_at` di-clamp ke [now−7d, now+5m].

## Verifikasi
- Unit test: 4 auth + 1 customer-return + 4 tender/refund — hijau.
- Integrasi (`tests/pos_integration.rs`, sqlx::test): (1) aturan tender di
  batas HTTP, (2) retur+struk+laporan harian konsisten (restock→floor,
  damaged→reject, retur dobel ditolak, refund salah ditolak, identitas cash
  tie-out), (3) gate JWT/role di router (401/403/aktor-mismatch/ladder) —
  3/3 hijau.
- Smoke test live server: boot → bootstrap admin → login → sale → payment →
  complete → receipt, plus 401 tanpa token dan 403 actor mismatch.

## Ditunda dengan sadar (kandidat berikutnya)
- Penomoran struk gapless per site/till (sekarang satu sequence global —
  syarat fiskal umum). Kolom `currency` CHAR(3) → TEXT.
- Kebijakan pembulatan pajak (per-line floor vs half-up / per-invoice) perlu
  keputusan fiskal eksplisit.
- Refund per metode belum dibatasi terhadap tender asal (mis. refund QRIS
  melebihi pembayaran QRIS sale tersebut).
- Balance ledger di jalur checkout masih O(riwayat) — perlu snapshot
  inkremental (gap #7 audit; belum disentuh siapa pun).
- Sesi lain menemukan: arah arsitektur edge=SQLite vs Postgres perlu
  keputusan user; TTL `command_deduplication`; binding proses STORE ke satu
  `site_id`.

## Env baru
`INVENTORY_JWT_SECRET`, `INVENTORY_BOOTSTRAP_ADMIN_PASSWORD`,
`INVENTORY_AUTH_TOKEN_TTL_MINUTES` (default 720),
`INVENTORY_CORS_ALLOWED_ORIGINS` — lihat `cloud.env.example`.
