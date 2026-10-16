# POS Performance Plan — store edge + customer app

Written 2026-10-07; evidence-confirmed the same day by a three-lane read-only
audit (edge hot paths, existing measurements, customer app). Scope: the till's
backend on the **store edge server** (`backend/src/edge/`, Rust + axum +
**rusqlite**, single SQLite file), the cashier desk (`frontend-store-new/`,
`pos-desktop/`), and the customer app (`frontend-customer/`, which talks to the
**Cloud** node, never the edge).

Goal in one sentence: **a sale at the till must feel instant on shop hardware —
and nothing else on the node (RFID sweeps, sync, a dead printer) may ever make
a cashier wait.**

Status: **Phases 0–4 code complete 2026-10-07** (baseline numbers in
[docs/pos-performance-round1.md](docs/pos-performance-round1.md)). The
after-optimization benchmark was initially skipped, then **run 2026-10-10 —
every SLO row green, crash gate green** ("Round 2" in
[docs/pos-performance-round1.md](docs/pos-performance-round1.md)); the
remaining Phase 5 items are the till E2E flows on a live node and a re-run on
shop-grade storage. Harnesses:
`scripts/benchmark-pos-edge.py`, `scripts/api-perf.mjs --only pos`.

---

## 0. What the POS is today

- The sale is one shot and stateless: no server-side cart, basket lives in the
  browser, the whole transaction arrives at once; `complete_sale`
  (`backend/src/edge/sqlite.rs:6773`) opens one **IMMEDIATE** transaction,
  replays on the idempotency key first (cheap: 1 SELECT, sqlite.rs:1959),
  prices through the shared engine, and writes `sale`/`sale_line`/`sale_tender`
  + movement group + sync facts in the same commit.
- Pricing is basket-narrowed (`IN (…)` on SKUs), **not** per-line N+1
  (pricing.rs:72-109, 519-553) — this was already done right.
- Returns/void/shifts/ESC/POS receipts landed 2026-09-03 (`edge/till.rs`,
  `escpos.rs`, `printing.rs`, migration `0024`).
- The customer app is read-only, Cloud-scoped (points/receipts), polls only
  while a redeem code is on screen (3 s, `redeem-view.tsx`), and **does not
  touch the edge**. Its only till coupling: the cashier confirms a redemption;
  the edge relays that synchronously to the cloud
  (`backend/src/edge/http.rs:2651-2705`).

## 1. Verified performance state (audit, 2026-10-07)

| # | Finding | Evidence |
|---|---|---|
| F1 | **One DB connection for the whole process**: `Arc<Mutex<Connection>>` shared by inventory, auth, RFID, sync, backup, status, discovery. Every statement in the node serializes on one mutex; WAL's read concurrency and `spawn_blocking` are both wasted. | sqlite.rs:666-667, 1949; node.rs:687-741; sync.rs:104-115 |
| F2 | **No prepared-statement cache**: `prepare_cached` = 0 uses in `backend/src`. Every statement re-parses. | repo-wide grep |
| F3 | **A 5-line cash sale ≈ 58 statements** (~28 fixed + ~6/line; 30-line basket ≈ 208), all inside one IMMEDIATE tx holding the global write lock — including the ~12-statement pricing load and sync enqueue. | sqlite.rs:6773-7330; pricing.rs:72 |
| F4 | **RFID ingest can hold the mutex for up to 2000 INSERTs in one IMMEDIATE tx** — a sweep blocks every sale/quote/catalog request on the node meanwhile. Sharpest contention point. | rfid.rs:218, 371-399; sync/rfid.rs:15 |
| F5 | **Pricing snapshot re-read from SQLite on every quote and every catalog page** (~10 statements per evaluation, pricing.rs:72-109); quote = 12 + N + coupons statements. A till that quotes then sells pays it twice. No memoization by price-book generation. | pricing.rs:1758, 72; sqlite.rs:7429 |
| F6 | `GET /store/catalog`: uncached DB + engine evaluation per page. Pagination is real (keyset, default 100/max 500) — good — but each page still costs ~13 statements under the global mutex, and responses are **uncompressed** (no CompressionLayer; also no TimeoutLayer). | pricing.rs:1001-1031; http.rs:629-630, 33-36 |
| F7 | **SQLite untuned beyond WAL**: `synchronous` left at FULL default (no pragma anywhere); `busy_timeout` unset on the serving connection (only a diagnostic connection sets it); no cache_size/mmap/wal_autocheckpoint tuning. WAL itself is on. | migrations/sqlite/0001:2; diagnose.rs:167 |
| F8 | **Auth costs one DB statement on the global mutex per authenticated request** (`edge_auth_session` SELECT) before any handler runs. | http.rs:4271; auth.rs:762-812 |
| F9 | Sale response is **not** blocked by printing (good design), but `POST …/receipt` itself waits on a blocking TCP write with **5 s timeout** — a dead printer stalls the till's print button for 5 s on a blocking thread. | sqlite.rs:8617 (lock released pre-socket); till.rs:1812; printing.rs:48, 1461-1467 |
| F10 | Indexes are largely right: EPC lookup is a UNIQUE index seek; sale/sale_tender/sale_return/movement/price-rule lookups indexed. Gap: **`sale_line.sku_code` has no index** (reporting/returns by SKU scans). | migrations 0001:26, 0020:32, 0024:104-155, 0015:21 |
| F11 | ~~Never benchmarked~~ **Closed by Phase 0 (2026-10-07):** `scripts/benchmark-pos-edge.py` + `api-perf.mjs --only pos` now measure the money path; baseline in `docs/pos-performance-round1.md`. Historical figures for contrast: price book 501 SKUs = 346–716 ms, `quote` 76 ms (POS-TABLET-PLAN §5b — different machine/date/tree). | docs/pos-performance-round1.md |
| F12 | ~~Checkout balance O(history)~~ **Corrected by Phase 0:** the sale path reads `inventory_projection` (O(1) PK seek) — gap #7 from pos-improvements is superseded; no balance work needed in the checkout. | docs/pos-performance-round1.md (EXPLAIN); sqlite.rs:2326-2364 |

Customer-app lane (Cloud, separate from the till's budget): member reads are
indexed (`ix_edge_sale_customer_time`); `points_account` = 3 queries per call
and is polled every 15 s (3 s during redeem) — fine at member scale, worth an
`EXPLAIN` check only. Client: single un-split JS bundle, no service worker, no
images — minor, listed in Phase 4.

## 2. Targets (SLOs on shop-grade hardware, e.g. fanless mini-PC)

Workload assumption: 1–3 tills/shop, peak ~30 sales/min/shop, RFID reader
streaming concurrently. The ceiling is the house rule itself
(`scripts/api-perf.mjs`): **under 100 ms, and if it cannot be, it must
paginate.** Every interactive POS endpoint holds p99 at ≤ 100 ms — the
median-of-N budget in the harness and the tail agree on one bar. The only
exemptions are bulk paths that paginate by design (catalog sync) and boot.

| Path | p50 | p99 |
|---|---|---|
| `POST /store/sales` (complete, 5-line cash) | ≤ 30 ms | ≤ 100 ms |
| `POST /store/sales` while RFID sweep ingesting | ≤ 40 ms | ≤ 100 ms |
| `POST /store/quote` | ≤ 15 ms | ≤ 40 ms |
| `GET /store/catalog` page (warm, ~5k SKUs) | ≤ 20 ms | ≤ 60 ms |
| Full catalog/price-book sync to the desk, 5k SKUs | — | ≤ 2 s |
| `GET /store/sales/{id}/receipt` | ≤ 15 ms | ≤ 40 ms |
| Edge cold boot → serving | ≤ 5 s total | |

## 3. Phases (ordered by measured leverage — F-numbers refer to §1)

### Phase 0 — Baseline (**DONE 2026-10-07** — `docs/pos-performance-round1.md`)
1. Register the POS endpoints in `scripts/api-perf.mjs` (`--budget 100`) —
   reuse the house harness, don't invent a new one.
2. One dedicated contention benchmark (style of `scripts/loadtest-crud.py`):
   throwaway edge node on a temp DB, ~5k SKUs + price book + EPCs; measure the
   SLO table cold/warm, sequential/8-worker, with and without a background
   RFID observation stream at 100 reads/s. Record in
   `docs/pos-performance-round1.md`; every phase quotes before/after from it.
3. Re-verify F12 (is checkout balance still O(history)?) with EXPLAIN on the
   balance SELECT under a 10k-movement DB.

### Phase 1 — Storage concurrency + SQLite hygiene (F1, F2, F7)
1. **Reader/writer split, rusqlite stays**: keep one serialized write
   connection; add 2–3 read-only connections (`OpenFlags::SQLITE_OPEN_READ_ONLY`)
   for catalog/quote/report/receipt reads. WAL already allows concurrent
   readers during a write. This is the single biggest win (F1).
2. `prepare_cached` on the hot statement shapes (~20: subject/movement/
   sale_line/sale_tender/projection/idempotency/enqueue_fact/price loads) —
   near-free parse elimination (F2, F3).
3. Pragmas on open: `busy_timeout=5000`, `synchronous=NORMAL` (gate below),
   `wal_autocheckpoint` bounded, `cache_size`/`mmap_size` sized; keep the
   shutdown `wal_checkpoint(TRUNCATE)`.
4. **Decision gate:** `synchronous=NORMAL` trades one checkpoint-window of
   power-cut risk per commit for latency. Present both baseline numbers at the
   gate; if the till must keep FULL, keep FULL and take the latency — decided
   with numbers, not taste.

### Phase 2 — Pricing snapshot + catalog path (F5, F6, F10)
1. **Memoize the pricing snapshot** by `(site, channel, price-book generation)`:
   ~10 statements per quote/catalog page collapse to a version check. The book
   changes only when sync applies a publication — invalidation is transactional
   with the apply. Rebuild-from-DB stays as the audit path.
2. **Catalog ETag** (`generation` already reported): `If-None-Match` → 304, so
   the desk's refetches are free; add `CompressionLayer` while there (JSON
   catalog pages ship uncompressed today).
3. Batch the remaining per-line lookups in the sale path: `subject_by_epc` ×N
   → one `IN (…)`; identity SELECT inside `append_movement` folded into the
   same batch; `enqueue_fact`'s `sync_origin` re-read hoisted out of the two
   calls.
4. `ix_sale_line_sku_code` migration (F10) — with its EXPLAIN recorded (§5.5).
5. Only after 2.1 lands: re-check F12; if a history scan remains in checkout,
   replace with incremental balance snapshot in the sale transaction
   (projection discipline: disposable, rebuildable, never authoritative).

### Phase 3 — Contention + I/O isolation (F4, F8, F9)
1. **RFID ingest chunking**: cap in-tx rows (e.g. 200/chunk across separate
   transactions) or move ingest onto a single dedicated writer task with a
   bounded queue — a 10k-read burst must land as bounded work, never a
   mutex-holding storm that freezes the counter.
2. **Print endpoint**: enqueue bytes + return immediately (or poll status);
   shrink the connect/write timeout from 5 s; a dead printer must never hold
   a till button for 5 s. Rendering endpoint already fine.
3. **Auth session cache**: in-memory token→session map on the read side with
   short TTL + revocation sweep, so the per-request session SELECT leaves the
   global path (F8).

### Phase 4 — Desk + customer app
- Desk: adopt the catalog ETag; verify the price-book sync cost against the
  SLO row (measured 346–716 ms at 501 SKUs — must stay ≤ 2 s at 5k); confirm
  no per-keystroke network calls in the scan field.
- Customer app (Cloud lane): keep redeem polling as-is (3 s, only while a
  code is live — already correct); add jitter if it ever runs wide; verify
  `points_account`'s 3 queries with EXPLAIN at 100k ledger rows; code-split
  the router (single bundle today) — cosmetic, last.
- Document the synchronous redeem relay (edge → cloud, http.rs:2651) as a
  cashier-visible cloud-latency dependency; behavior stays (the cashier needs
  the confirm), but it gets a timeout + clear offline refusal message if
  absent.

### Phase 5 — Verification gates (definition of done)
1. `scripts/api-perf.mjs --budget 100` green on all registered POS endpoints;
   contention benchmark meets every SLO row; before/after quoted in
   `docs/pos-performance-round1.md` per phase.
2. Existing till E2E (shift → sale → return → void → receipt, `runs/pos-e2e/`
   flows) green on a live node — behavior unchanged, only speed.
3. Idempotency replay: same sale key twice → one sale, still true after
   Phase 2.3.
4. Crash test: kill -9 between sale commit and receipt print → sale durable,
   receipt printable after restart (Phase 3.2).
5. Every new migration ships with its EXPLAIN QUERY PLAN recorded for the hot
   lookups it serves.

## 4. Non-goals
- No shell change (browser reaches every device we have — settled).
- No HTML rendering in the edge — settled.
- No server-side cart/hold-resume; the stateless one-shot sale stays.
- **No storage-layer swap**: rusqlite stays; no sqlx/Postgres-on-edge migration
  smuggled in through a perf PR (the SQLite-vs-Postgres question is separate).
- Customer app gets no write path.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Reader/writer split serves stale reads to a sale | Sale path keeps using the write connection for its reads; readers only serve catalog/quote/report/receipt |
| `synchronous=NORMAL` loses a checkpoint-window tail on power cut | Explicit decision gate (Phase 1.4) with both numbers; FULL stays if the business says so |
| Cached pricing snapshot drifts from the book | Keyed by generation; bump is transactional with sync apply; zero-diff rebuild check on boot |
| RFID chunking changes ingest semantics | Chunk boundaries are per-batch transactions, idempotency receipt written once per batch; E2E sweep test stays green |
| Statement caching interacts with migration rekeys | Cache is per-connection lifetime; connections reopen on boot — no cross-migration reuse |
| Optimizing what isn't hot | Phase 0 baseline first; no phase starts without its before-number |
