# POS performance — round 1 (Phase 0 baseline)

Date: 2026-10-07. Harness: `scripts/benchmark-pos-edge.py` (new, this round) +
`scripts/api-perf.mjs` (`--only pos`, new rows). Plan:
[POS-PERFORMANCE-PLAN.md](../POS-PERFORMANCE-PLAN.md).

## Conditions (read before quoting any number)

- **Release build** (`cargo build --release --bin store`, 10m55s), tree of
  2026-10-07 including uncommitted working-tree changes.
- **Machine: Apple M1 (8-core), macOS, Apple NVMe.** This is a *fast* disk —
  `synchronous=FULL` fsync costs ~0.1–0.3 ms here. A shop mini-PC with eMMC or
  SATA SSD pays 2–10 ms per fsync, and the mutex-serialized paths scale with
  CPU single-thread speed. Numbers below are the **optimistic end**; the SLO
  margins shrink accordingly on shop hardware. Re-run on the target hardware
  before treating a margin as safe.
- Workload: throwaway store edge on a temp SQLite file, seeded with
  **5,000 SKUs**, 5,000 EPC subjects with projection rows at
  `store-07.floor:on_hand`, a one-publication price book (STORE channel, IDR,
  STANDARD tax at 1,100 bps inclusive), auth **required** (JWT on every call),
  shift `KASIR-1` open.
- 5-line cash basket per sale (overpaid CASH 10,000,000 so the sale's own
  pricing is measured, not a preceding quote); unique idempotency key and
  fresh EPCs per sale.
- Node config as found: single `Arc<Mutex<Connection>>`, no `prepare_cached`,
  no `busy_timeout`, `synchronous` default (FULL), WAL on. **No optimization
  has been applied — this is the before.**

## Results

### Till money path (median of 60 per scenario, 30 for receipt)

| Scenario | n | p50 ms | p95 ms | p99 ms | max ms |
|---|---:|---:|---:|---:|---:|
| `POST /store/quote` 5-EPC, sequential | 60 | 0.5 | 0.6 | 0.7 | 2.2 |
| `POST /store/quote` 5-EPC, 8 workers | 60 | 2.0 | 2.6 | 2.7 | 2.7 |
| `POST /store/sales` 5-line cash, sequential | 60 | 1.0 | 1.8 | 2.2 | 2.6 |
| `POST /store/sales` 5-line cash, 8 workers | 60 | 6.7 | 7.3 | 7.4 | 7.4 |
| `GET /store/sales/{id}/receipt` | 30 | 0.3 | 0.4 | 0.6 | 0.6 |
| sale, 8 workers **while RFID streams 100 rows/s** | 60 | 5.8 | 7.7 | 7.8 | 7.8 |
| sale, 8 workers **during one 2,000-sighting sweep** | 60 | 13.3 | 30.5 | 34.3 | 34.9 |

Whole-book catalog sync (what the desk pulls at open, `limit=500` pages):
**10 pages, 50 ms total** for 5,000 SKUs (per page 4.4–7.6 ms).

`api-perf.mjs` against the same node (median of 9):

```
✓      4      13   500   yes   pos/catalog-page
·      1       3   100   NO    pos/catalog-identities
```

`catalog-identities` "cannot page" is by design: the caller names the SKUs
(`?skus=` comma list), so the response is bounded by the request, not by the
table. Not a growth hazard.

### Verdict against the SLO table (p99 ≤ 100 ms)

Every interactive path passes **on this machine** — with two structural
warnings the raw numbers hide:

1. **Concurrency does not scale.** 1 worker → 1.0 ms; 8 workers → 6.7 ms p50.
   The whole node serializes on one `Arc<Mutex<Connection>>`
   (`sqlite.rs:666`): throughput ceiling ≈ 1,200 sales/s *here*, and it drops
   in direct proportion to single-core speed. A slower CPU buys the same queue
   with a slower server.
2. **The 2,000-sighting sweep costs every concurrent sale ~3–15× its quiet
   latency** (p50 13.3 ms vs 6.7; max 34.9). One IMMEDIATE transaction of
   2,000 INSERTs (`rfid.rs:371`, cap `sync/rfid.rs:15`) holds the same mutex.
   On Apple NVMe the sweep POST itself took 30 ms; on shop storage the same
   transaction plausibly lands 200–800 ms — **that is the path that breaches
   the SLO first**, and it is exactly Phase 3.1 (chunked ingest).

### Hot-lookup EXPLAIN QUERY PLAN (after shutdown)

| Lookup | Plan |
|---|---|
| projection by (subject, place) | `SEARCH inventory_projection USING INDEX sqlite_autoindex_… (subject_id=? AND place_id=?)` — PK seek |
| subject by EPC | `SEARCH inventory_subject USING INDEX sqlite_autoindex_… (epc=?)` — unique-index seek |
| `sale_line` by `sku_code` | **`SCAN sale_line`** — unindexed (plan F10: `ix_sale_line_sku_code`) |

### Plan rows this round confirms or corrects

- **F12 corrected:** the checkout balance path reads `inventory_projection` —
  an O(1) PK seek — not the movement history. The O(history) gap #7 flagged in
  `docs/pos-improvements-2026-08-30.md` has been superseded by the projection
  table; no snapshot work is needed in the sale path. Phase 2.5 is **dropped**
  (nothing to do).
- **F10 confirmed:** `sale_line.sku_code` is a table scan today; matters for
  SKU-dimension reporting/returns at scale, not for the sale itself.
- **F5 rescoped:** quote is cheap per call even at 5k SKUs (basket-narrowed,
  indexed). The ~12 statements per quote matter under the mutex (queueing),
  not for single-request latency. Phase 2.1 (snapshot memoization) stays, but
  its payoff is concurrency headroom, not the single-quote number.
- **F11 closed:** the till's money path is now under measurement harness
  (`--only pos` rows registered; contention script committed).
- **Earlier measurements reconciled:** POS-TABLET-PLAN §5b's 346–716 ms
  whole-book figure and 76 ms quote do not reproduce at this scale on this
  machine (50 ms whole book at 10× the SKUs). Different machine, different
  date, different tree; both recorded, this round's harness is the repeatable
  one.

## Re-running

```sh
cd backend && cargo build --release --bin store
python3 scripts/benchmark-pos-edge.py                    # 5,000 SKUs, 60/scenario
python3 scripts/benchmark-pos-edge.py --skus 500 --sales 6   # smoke
API=http://127.0.0.1:<port> PERF_TOKEN=<jwt> \
  node scripts/api-perf.mjs --only pos
```

Next: Phase 1 (reader/writer split + `prepare_cached` + pragmas), then re-run
this exact harness for the after-numbers.

## Round 2 — after Phases 1–4 (the verification the plan was missing)

Date: 2026-10-10. The Phase 1–4 optimizations landed in the tree on
2026-10-07 with the after-benchmark **skipped** ("abaikan testing"), so this
is their first measured run: same harness, same machine, same seed, release
build (`cargo build --release --bin store`, 12m 26s). Phase 3.1 (chunked RFID
ingest) and F10 (`ix_sale_line_sku_code`) are in this build.

### Till money path — same scenarios, before → after

| Scenario | before p50/p99 ms | after p50/p99 ms |
|---|---|---|
| quote 5-EPC, sequential | 0.5 / 0.7 | **0.5 / 0.6** |
| quote 5-EPC, 8 workers | 2.0 / 2.7 | **1.5 / 2.3** |
| sale 5-line cash, sequential | 1.0 / 2.2 | **0.9 / 4.5** |
| sale 5-line cash, 8 workers | 6.7 / 7.4 | **4.4 / 7.6** |
| sale, 8 workers while RFID streams 100 rows/s | 5.8 / 7.8 | **4.6 / 7.9** |
| sale, 8 workers **during one 2,000-sighting sweep** | 13.3 / 34.3 | **10.2 / 27.2** |
| GET receipt | 0.3 / 0.6 | **0.3 / 0.7** |

Whole-book catalog sync: **10 pages, 45 ms** (was 50 ms). Sweep POST itself:
28 ms (was 30 ms).

### Verdict

Every SLO row passes, and the round-1 structural warnings are answered:

- **The predicted first SLO breach — a sale landing while a max-size sweep
  holds the store — measured p99 27.2 ms**, from 34.3 ms before and from a
  projected 200–800 ms on shop storage. Phase 3.1's chunked ingest is what
  the till now runs on.
- **F10 closed:** `sale_line` by `sku_code` plans as
  `SEARCH sale_line USING COVERING INDEX ix_sale_line_sku_code` — was a full
  scan.
- **Phase 5 crash gate green:** kill -9 between sale commit and receipt
  print → same id replays once in-process, the receipt prints after restart,
  and the id still replays exactly once after it (`OK ×3`).
- Concurrency still serializes on the write connection (by design, §5: the
  sale keeps its reads on the writer); 8-worker sale p50 4.4 ms against the
  baseline's 6.7 ms is headroom bought, not a ceiling lifted.

Caveat carried over: Apple NVMe numbers are the optimistic end; re-run on the
target mini-PC before quoting a shop-floor margin.
