# Handheld scan redesign — Phase 1 audit

What the handheld does today, measured against the scanner-appliance brief.
Written before any code changed, because several assumptions in the brief turn
out not to match this estate.

## 1. Current architecture

### RFID SDK integration — `core/Reader.kt`

`RFIDWithUHFUART` singleton over the vendor UART. Inventory runs as **buffer
polling on a dedicated daemon thread** (`startInventoryTag()` then
`readTagFromBuffer()` in a loop, 3 ms sleep when the buffer is empty), not
through `setInventoryCallback` — the callback never fires on the E710 module
this hardware carries, and that is documented in the file.

So there is already a thread boundary between the radio and everything else.
What the brief calls "the RFID callback" is, here, our own poll loop.

Power is 5–30 dBm and changing it **re-opens the module** rather than re-tuning:
a `setPower` on an open module reports success while the antenna goes silent.
Documented and worked around.

**There is no hardware trigger handling anywhere.** No `KeyEvent`, no
`dispatchKeyEvent`, nothing in the manifest. Scanning starts from an on-screen
button. The vendor AAR does expose `KeyEventCallback{onKeyDown(int), onKeyUp(int)}`.

### Callback behaviour — `screens/Sweep.kt` `absorb()`

Runs on the poll thread. Per read:

- duplicate EPC → keep the strongest RSSI, **return without marking the UI
  dirty**. Deliberate: nothing on screen shows RSSI.
- new EPC → `Epc.decode` (local parse, no I/O), `putIfAbsent`, `qtyBySku.merge`,
  `skuRank.putIfAbsent`, set dirty.

No database, no network, no rendering on this path. The brief's §5 is largely
satisfied **except** that dedup and aggregation happen inline on the SDK thread
rather than behind a bounded queue, and there is no backpressure measurement.

### Local persistence

`SharedPreferences` only (`data/Config.kt`): base URL, site, device id/key,
pool, operator token, session code, reader power.

**No SQLite. No Room. No files.** Everything the brief asks for in §3, §14, §15,
§18, §21 is greenfield on the device.

### Product data source

Network, every sweep. `GET /api/v1/catalog/identities?skus=…`, chunked 200 per
request (the edge refuses more than 500). Called every 2 s while sweeping and
again on stop. Images proxied through the edge because `r2.dev` is blocked by
Indonesian ISPs.

Offline, a sweep still counts correctly but every product is nameless.

### Network flow during an active scan

Three things run on a 2-second tick while the reader is live:

1. `scheduleFiling()` — POST the new EPCs as a signed observation batch.
2. `resolveIdentities()` — the catalogue lookup above.
3. `refreshShared()` — shared-session totals, when a session is joined.

All three are single-flighted with one queued follow-up, and filing backs off
5 s → 60 s on failure. None of them is per-tag, and none blocks the poll loop.

### UI state updates

One `MutableStateFlow<SweepState>`. `publish()` runs on a **200 ms** tick and
returns immediately unless the dirty flag is set — 5 updates/sec, which is what
§9 asks for. The product grouping snapshot is built on `Dispatchers.Default`.

This was expensive and was already fixed once: regrouping 5 000 tags cost 90 ms
per publish on the main thread, 68 % janky, 42 ms median frame. It is now ~5 ms
and flat in tag count.

### Scan state model

All RAM, all `ConcurrentHashMap`: `collector` (EPC → Seen), `qtyBySku`,
`skuRank`, `foreign`, `filed`, `filingClaims`. Nothing is checkpointed to disk —
durability comes instead from filing evidence to the edge every 2 s.

## 2. EPC contract — already decided, and the brief's sample is wrong

`backend/src/cloud/domain/identity.rs` is the single authority, and it carries a
golden vector lifted from the deployed encoders.

```
EPC-96, 24 hex characters
  byte 0        header 0xA0        "retail private"
  bytes 1..6½   11 SKU digits as BCD (44 bits)
  bytes 6½..12  44-bit per-SKU serial

SKU = article(8) + colour(1) + size(2) = 11 ASCII digits
golden vector: encode_epc("12345678123", 100) == a01234567812300000000064
```

The sample in the brief — `3000A00000001100800000000001` — is **28 hex
characters with a `30` header**, which is a GS1 SGTIN-96, not ours. It is not a
tag this estate writes.

Consequences:

- **The preferred architecture in §4 is already implemented.** `Epc.decode`
  parses SKU out of the EPC locally, in the handheld, with no lookup.
- **No `epc_map` table is needed, now or later.** There are no millions of
  mapping rows to store, because the mapping is arithmetic.
- The `resolveSku(epc)` seam the brief asks for is worth keeping anyway, but
  both implementations behind it are not needed. One is.
- Colour is one digit, so an article has at most ten colourways. Inherited,
  permanent, and already violated by legacy data in production.

## 3. Catalogue: how it actually reaches an edge

This is the finding that most changes the plan.

The catalogue is **not** a row-by-row synced table. It is a whole snapshot,
swapped atomically:

- Cloud builds the full product list, hashes it, and compares against the last
  publication. Unchanged → nothing happens. Changed → `generation + 1`, and the
  whole catalogue is chunked out to **every** origin, DC and shop alike
  (`publish_catalog_if_changed`, `backend/src/cloud/postgres/sync.rs:5735`).
- Edge stages chunks, verifies the content hash over every item, and only then
  swaps the snapshot in and records `catalog_state{generation, content_hash,
  item_count}`. A generation below the resident one is refused
  (`backend/src/edge/sync.rs:703`).

So:

- **There is no delta anywhere.** §15's `+34 / ~13 / -2, new version = 176` does
  not exist and cannot be requested. Building it is a cloud-side change — a
  versioned change log — not a handheld change.
- **There is no per-site catalogue scope.** Every node already holds the entire
  estate catalogue. §20's question is answered by the existing design: scope is
  everything.
- The retired-row problem §15 worries about cannot occur, because the unit of
  change is the whole catalogue.

Scale, measured on the seeded development databases: **500 articles → 2 743–4 633
SKUs**. A store edge holds low thousands, not a million. At that size a full
re-pull on a generation change costs under a second and delta sync buys nothing
yet.

## 4. Bottlenecks and gaps

Ordered by what they cost.

1. **No local catalogue.** Names come from the network on every sweep. Offline
   the operator gets counts without products. Violates §2 outright.
2. **Product rows and images render while the reader is live.** `SweepScreen`
   appends a row per product as tags arrive and loads a proxied JPEG per row.
   Violates §8. The device's own measured baseline is 27 ms p50 / 28 % janky on
   this list.
3. **No hardware trigger.** The appliance feel the brief asks for starts here.
4. **Hot-path allocations per read, duplicates included.** `Reader.kt` builds a
   new `String` (`getEPC()?.uppercase()`), parses RSSI from a `String` to a
   `Float`, and allocates a `TagRead` on **every** sighting — not every unique
   tag. At the brief's 1 300 events/sec that is roughly 5 000 allocations/sec
   for reads that are 90 % duplicates.
5. **No bounded queue, no backpressure signal.** Dedup runs inline on the poll
   thread. It is cheap today, but nothing measures queue depth, dropped events,
   or dedup ratio, so §22 and §27 have nothing to report.
6. **Grouping snapshot runs every 200 ms during the scan.** Correct today
   because the list is on screen. Once the list only appears after stop, this is
   pure waste on the hot path.
7. **`foreign` is not `unknown`.** Today's counter means "not one of our EPCs".
   The brief's UNKNOWN means "a valid A0 tag whose SKU is not in the catalogue"
   — which cannot exist yet, because there is no catalogue. These are two
   different numbers and the screen needs both.
8. **No test source set.** `app/src` contains `main` and `release` only. Every
   test in §33 is new, including the harness to run them.
9. **Counter is 32 sp** (`Type.total`). Not an arm's-length number.

## 5. Where the brief conflicts with this estate

Three places. Each needs a decision, not an assumption.

### 5.1 "Network requests during active scan: 0" (§29) vs auto-filing

The app files evidence to the edge every 2 seconds while sweeping, and that is
load-bearing:

- it is the crash and battery-death recovery story — an hour of counting is
  never held only in RAM;
- it is what makes shared sessions work, several handhelds filling one aisle in
  view of each other;
- it is idempotent and backs off, and it never touches the poll loop.

§21 proposes solving the same problem with local checkpoints instead. That is
strictly worse here: it recovers the count but not the collaboration, and it
adds a write path where a working one exists.

**Recommendation:** keep filing, and treat §29's zero as "zero network on the
*resolution* path" — no lookup, no product fetch, no per-tag request. Filing is
eventual, batched and failure-tolerant; if the network is gone it retreats
quietly and the scan is unaffected.

### 5.2 Delta sync (§15) vs the generation snapshot

**Recommendation:** implement the handheld against the generation gate that
already exists — ask the edge for `generation`, pull the whole catalogue only
when it differs — behind an interface that can take deltas later. At 3–5 k SKUs
this is the same user-visible behaviour with none of the cloud work.

### 5.3 The 10 ms target on this hardware

The C5 is an MT6765 with a 60 Hz panel. Measured on the device: **Android's own
Settings app renders at 27 ms p50**. Our product list matches it at 27 ms /
28 % janky.

A p95 of 10 ms is therefore not achievable for any scrolling list on this
device, and 60 fps scrolling is not either — the platform UI does not reach it.
It is plausible for the counter-only scanning screen, which is close to nothing
to draw, and that is exactly the screen the brief wants fast.

**Recommendation:** hold 10 ms p95 as the target for the *scanning* screen, and
target the result list against the device's own platform baseline instead of an
absolute that the hardware refuses.

## 6. SQLite: the reason changed

An earlier pass recommended a file snapshot plus a RAM map, on the grounds that
the catalogue is whole-snapshot cache data that is only ever looked up by key.
That reasoning was right about the scan path and wrong about the app.

§13 asks for **indexed search across the whole catalogue**, not just across scan
results. That is a query, it is not a key lookup, and it is the thing a file and
a HashMap are bad at. SQLite is the correct answer — for search, not for the
scan path, which still resolves SKUs by arithmetic and touches no database until
the trigger is released.


---

# Phase 2 — the contract

Decided. Everything below is what Phase 3 onwards implements.

## 2.1 EPC contract and parser invariants

Unchanged from what the estate already speaks. The handheld DECODES only; nothing
in the field ever mints an EPC.

```
24 hex characters, 96 bits
  byte 0        0xA0            header, "retail private"
  bytes 1..6½   11 BCD digits   the SKU
  bytes 6½..12  44-bit serial   which unit of that SKU
```

Invariants the parser must hold, each one a test:

- length exactly 24, hex only, else not ours
- header byte exactly `0xA0`, else not ours (a `0x30` SGTIN or a factory TID is
  *foreign*, not *invalid*)
- every BCD nibble in the SKU field is `0x0`–`0x9`; `0xA`–`0xF` there means a
  corrupt read, and the tag is foreign rather than half-decoded
- decode never throws and never allocates beyond its return value

**Article code is the first 8 characters of the SKU.** `article(8) + colour(1) +
size(2)` is the format, so the article of a tag is arithmetic too. Counting
distinct articles during a sweep needs no catalogue and no lookup — this is why
the scanning screen can show an article count while offline.

## 2.2 Local catalogue schema

Raw `SQLiteOpenHelper`, not Room. Room means KSP and a schema to migrate for a
table whose entire content is derived from the server and thrown away whenever
the generation moves. The build is deliberately lean — R8 is already off because
the vendor AAR cannot survive it — and an annotation processor is weight this
earns nothing.

```sql
CREATE TABLE sku_scan_master (
    sku_code         TEXT PRIMARY KEY NOT NULL,
    article_code     TEXT,
    name             TEXT NOT NULL,
    division_code    TEXT,
    barcode          TEXT,
    base_price_minor INTEGER,
    active           INTEGER NOT NULL
);
CREATE INDEX idx_scan_master_article ON sku_scan_master(article_code);
CREATE INDEX idx_scan_master_barcode ON sku_scan_master(barcode);
CREATE INDEX idx_scan_master_name    ON sku_scan_master(name);

CREATE TABLE catalog_meta (
    singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
    node_key     TEXT NOT NULL,   -- baseUrl|siteId, see below
    generation   INTEGER NOT NULL,
    item_count   INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    synced_at    TEXT NOT NULL
);
```

`sku_code` is the primary key, so SKU lookup is the index walk. No `SELECT *`
anywhere; the scan path selects the five columns a result row draws.

**`node_key` is not decoration.** One build serves a DC and a shop, and which
node a handheld belongs to is a Setelan field that can change. A catalogue
carries the node it came from, and a `node_key` mismatch invalidates the whole
local copy — otherwise a handheld repointed from `dc-01` to `store-07` answers
shop questions out of warehouse data and looks right while doing it.

## 2.3 Generation refresh semantics

```
app start
  └─ open SQLite, load known-SKU set        scanning is available HERE
  └─ (background) GET /api/v1/catalog/snapshot
       ├─ node_key and generation match  → done, nothing moves
       └─ differ → page /api/v1/catalog/snapshot/items
                   → build a NEW table, swap it in one transaction
                   → record generation + hash + node_key
```

Rules:

- **Never block scanning on the network.** A device with any local catalogue
  scans immediately. Only a device that has never bootstrapped waits, and it says
  what it is waiting for.
- **A refresh must not disturb an active sweep.** If a generation change lands
  mid-scan the swap is deferred until the sweep ends. A count whose product names
  changed halfway is a count that cannot be explained afterwards.
- **A torn pull is discarded, not kept.** Every page carries the generation it
  was read at; if it moves while paging, the pull restarts. Half a catalogue is
  worse than none — the same rule the edge already applies to its own chunks.
- Stale is preferred to absent. An unreachable edge means the local copy stands,
  and the screen says which generation it is.

## 2.4 Scan-session RAM state

Single owner: the scan worker thread. Nothing else mutates it.

```
seenEpcs      HashSet<String>              dedup, one entry per physical unit
qtyBySku      HashMap<String, Int>         SKU → units
articles      HashSet<String>              sku.take(8), distinct articles
unknownSkus   HashSet<String>              valid A0, SKU absent from catalogue
firstRssi     HashMap<String, Float>       evidence quality, first sighting only
foreign       Int                          not one of ours at all
```

`foreign` and `unknown` are different numbers and both are shown. Foreign means
the header was not `0xA0` — somebody else's tag, correctly ignored. Unknown means
one of ours whose SKU this handheld has never heard of — a real operational
signal, usually stock that arrived before the catalogue did.

**RSSI is now first-sighting, not strongest.** Keeping the strongest meant
parsing a float out of a string on every duplicate read, which at 1 300
events/sec is the single largest allocation source on the hot path. Nothing
displays RSSI and the evidence only needs a signal reading, so the strongest is
not worth an allocation per sighting.

A resident `HashSet<String>` of known SKU codes backs the unknown check — 3–5 k
short strings, a few hundred kilobytes, rebuilt when the catalogue generation
moves. This is the "small hot lookup cache" and it is the only catalogue data
held in RAM. No product objects are preloaded.

## 2.5 Durable evidence outbox

```sql
CREATE TABLE evidence_outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    body            BLOB NOT NULL,     -- the exact signed bytes, frozen
    epc_count       INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT
);
CREATE TABLE filed_epc (
    session_id TEXT NOT NULL,
    epc        TEXT NOT NULL,
    PRIMARY KEY (session_id, epc)
);
```

### Lifecycle

```
worker aggregates in RAM
      │  every ~2 s, off the reader thread and OUTSIDE the filing lock
      ▼
freeze a batch  →  evidence_outbox row  (durable here, and only here)
      │
      ▼
uploader takes the oldest row, signs it FRESH, POSTs
      │
      ├─ 201        → delete the row, insert into filed_epc
      ├─ Conflict   → already accepted; same treatment as 201
      └─ anything else → leave it, back off 5 s → 60 s
```

### Why the body is frozen and the proof is not

`observed_at` lives inside the signed body, so rebuilding a batch later changes
its digest and the edge sees a different request. The body is therefore written
once and never regenerated.

The proof — timestamp, sequence, signature — cannot be frozen with it. The edge
checks `proof.timestamp` against a **300-second window in both directions**, so a
batch that waited out an offline spell can never be replayed with its original
proof. It is re-signed on every attempt.

That combination is why **the edge needed a one-line fix, and it is a
prerequisite, not a footnote**: the receipt equality test included
`prior_sequence`, and a re-signed retry necessarily carries a new one. Without
the fix, one lost response jams that batch permanently — in exactly the offline
conditions the outbox exists to survive. The test now compares device and digest,
which is what actually establishes "same batch, same reader". Anti-replay of new
work is untouched, and still enforced by `proof.sequence <= last_sequence`.

### `filed_epc` is durable for a reason

The set of already-acknowledged EPCs used to live in RAM. Resuming a count after
a crash then re-uploads the whole sweep, and because the idempotency key is
derived from the batch's contents, a differently-composed batch gets a different
key and is *not* deduplicated. Persisting it costs one small table and removes
the possibility.

### Two lifetimes, not one

The outbox drains independently of any scan session. If an operator discards an
unfinished count, the evidence already spooled still goes up on the next launch:
what was seen was seen, and the observation batch is evidence in its own right —
that is the whole premise this app files on.

### The clock

`nextSequence()` is seeded from the wall clock, and the edge keeps
`last_sequence` per device forever. A handheld whose RTC resets after a flat
battery — precisely the accident the outbox exists for — then fails **two**
independent checks: the 300-second skew window, and the monotonic sequence. It
cannot be worked around with bookkeeping on the device.

So it is detected and named. When the edge refuses on skew or sequence and the
device's own clock is implausible, the screen says the clock is wrong rather than
retrying forever behind a spinner. The evidence stays spooled and goes up when
the clock is fixed.

### Growth

Outbox rows are kept for 7 days. Beyond that the sweep they came from is over by
any measure and the row is a leak rather than a promise. `filed_epc` is dropped
per session once its outbox rows are gone.

## 2.6 Concurrency: who owns what

```
┌─ reader poll thread ────────── "uhf", daemon ──────────────────────────┐
│ drain the UART buffer; dedup against seenEpcs; enqueue NEW tags only.  │
│ Touches: seenEpcs (concurrent), the ring, two counters. Nothing else.  │
└────────────────────────────────────────────────────────────────────────┘
        │ bounded ring, capacity 8 192, drop-and-count when full
        ▼
┌─ scan worker ────────────────── single thread, SOLE owner of state ────┐
│ parse EPC → SKU → article; aggregate; unknown check against the        │
│ resident SKU set. Publishes an immutable snapshot on a 200 ms tick.    │
└────────────────────────────────────────────────────────────────────────┘
        │ immutable snapshot
        ▼
┌─ main/UI ──────────────────────────────────────────────────────────────┐
│ reads snapshots. Never computes over the collection.                   │
└────────────────────────────────────────────────────────────────────────┘

┌─ io ───────────────────────────────────────────────────────────────────┐
│ spooler (RAM → outbox), uploader (outbox → edge), catalogue sync.      │
│ Never touches scan state; takes copies.                                │
└────────────────────────────────────────────────────────────────────────┘
```

Dedup sits on the reader thread rather than behind the queue, and that is a
deliberate departure from the brief's §5. A hash-set probe on a string is tens of
nanoseconds; enqueueing is more. Since duplicates are the overwhelming majority
of reads — a tag is read dozens of times as the operator walks past it — filtering
them before the queue means the queue carries only real work, and a duplicate
costs one probe and no allocation at all. The callback still does "the least
possible and returns", which is what §5 is actually asking for.

## 2.7 Shared scan UI state vs mode-specific state

Shared, and all any mode needs to draw while the reader is live:

```
units · skus · articles · unknown · foreign · elapsed · readerState
```

Mode-specific, layered on top without adding work to the hot path:

| Mode | While scanning | After stop |
|---|---|---|
| Scan | the four counters | products, finish |
| Stock count | the four counters | products, submit entries |
| Packing | found / expected, unexpected count | products, open carton |
| Receive | found / expected, unexpected count | products, receive |

Packing and Receive compare against an **expected set** fetched when the session
opens and held in RAM as a `HashSet<String>`. The per-tag cost is one set probe
on the worker thread, alongside the unknown check that is already there.

This is new work with no precedent in the app — today Packing only asks for a
destination shop and nothing is fetched. It is worth it: an operator must learn
that a carton contains something it should not **while the carton is still
open**, not after Finish.

No product rows, no images, no EPC rows while the reader is live, in any mode.
Exceptions surface as counters and a banner.

## 2.8 Targets, calibrated to this device

The C5 is an MT6765 on a 60 Hz panel. Android's own Settings app measures 27 ms
p50 on it.

| | Target | Basis |
|---|---|---|
| Scanning screen, p95 frame | ≤ 10 ms | almost nothing to draw; the brief's number, kept where it is meaningful |
| Result list scrolling | at or better than the platform baseline | 60 fps is not available on this hardware; Android's own UI does not reach it |
| Network requests on the resolution path | 0 | absolute |
| SQLite queries per reader sighting | 0 | absolute |
| UI publishes per second | 5 | 200 ms tick, unchanged |
| Trigger press → reader active | < 150 ms | |
| Release → result, 10 k units | < 500 ms | |

---

# What was built, and what it measured

Phases 3–8, on a Chainway C5 (MT6765, Android 13, 60 Hz panel, E710_V7.10.1).

## The pipeline as built

```
gun trigger (keycode, learned)
      │
      ▼
reader poll thread ──probe seen[] ──> bounded ring (8 192) ──> scan worker
      │                                                          │
      └─ duplicate: one hash probe, no allocation, return        │
                                                                 ├─ EPC → SKU (arithmetic)
                                                                 ├─ SKU → article (first 8 chars)
                                                                 ├─ unknown check vs RAM set
                                                                 └─ evidence → handoff queue
                                                                        │
      ScanCounts (immutable) ◄── 200 ms tick ◄────────────────────┘
                                                                        │
                                       every 2 s ──> spool ──> SQLite outbox ──> Edge
      │
   trigger released
      │
      ▼
drain ring · name products in ONE batched query · write the sweep · re-read history
      │
      ▼
the sweep's own result, on screen
```

## Files

| | |
|---|---|
| `core/ScanEngine.kt` | bounded ring, worker, dedup, aggregation, backpressure metrics |
| `core/Barcode.kt` | the 2D imager and the `R1:` / `8…` / bare-SKU label parser |
| `core/Trigger.kt` | which keycode the gun sends, learned rather than assumed |
| `data/Catalog.kt` | local catalogue, sweep history, durable evidence outbox |
| `data/CatalogSync.kt` | the generation gate |
| `screens/Sweep.kt` | one engine, four modes, spool/upload, history |
| `screens/SweepScreen.kt` | two surfaces: the figure, and the result |

## Measured, before and after

| | Before | After |
|---|---|---|
| First pull → antenna live | 3 626 ms | **~20 ms** (module opened in `onCreate`) |
| Later pull → antenna live | 2 659 ms | **20 ms** |
| Finish with the node unreachable | 10 s+ | immediate |
| Catalogue, 4 816 SKUs into SQLite | n/a | **719 ms** |
| Frames rendered per 12 s of sweeping | continuous list redraw | **~15** |

Two changes account for almost all of it:

- `setEPCAndTIDUserMode` was re-sent on every pull although this app asks for one
  mode and never changes it. Configuring once per open module took the pull from
  2 659 ms to 20 ms.
- `metrics` travelled in the same state object as the count, and metrics climb
  with every sighting — so the shell recomposed five times a second even when
  the figure had not moved. Metrics now ride the two-second lane.

## The 10 ms target: not reached, and not reachable here

| Configuration | p50 | p90 | GPU p50 |
|---|---|---|---|
| Figure at 140 sp | 27 ms | 48 ms | 9 ms |
| Figure at 88 sp | 23 ms | 38 ms | 9 ms |
| Android's own Settings app | 27 ms | — | — |

**No frame, in any configuration tested, came in under 18 ms.** The GPU alone
takes 9–12 ms of every frame, and the platform's own UI on this device measures
27 ms p50. Shrinking the figure from 140 sp to 88 sp buys about 4 ms and halves
GPU time; it does not approach 10 ms.

What did change is how OFTEN a frame happens. The scanning screen now draws only
when the figure changes — roughly one frame per second on a stationary handheld.
The latency an operator actually feels is the trigger, and that is 20 ms.

## Bugs found on the way

- **`Epc.decode` accepted corrupt tags.** The BCD guard was
  `StringBuilder.append(Int)` followed by a search for a non-decimal character —
  which can never find one, because appending an `Int` writes it in decimal. A
  corrupt nibble of `0xA` arrived as the characters "10", the SKU came out twelve
  digits long, and a bad read became a phantom product on a stock count instead
  of a tag that is not ours. The centre's decoder rejects these; this one now
  agrees with it. Fixed, with a test.
- **The RFID receipt refused legitimate retries.** See §2.5 — fixed on the Edge.
- **Finish waited for the network** for evidence that was already durable.

## Not our bug, but the one that looked worst

`com.rscja.scanner` and `com.rscja.infowedge` — the vendor's own preinstalled
scan services — hold the UHF module. While they run, this app's reader reports a
bare "gagal", the trigger beeps, and nothing appears on our screen. They are
disabled on the test device (`pm disable-user`), and any handheld this app is
deployed to needs the same, permanently: they come back on every reboot.

## Deviations from the brief

| Brief | What was built, and why |
|---|---|
| §4 EPC sample `3000A0…` | Not this estate's format. Ours is `A0` + 11 BCD + 44-bit serial, 24 hex, with a golden vector in `identity.rs`. No `epc_map` is needed at all. |
| §5 callback enqueues only | It probes a hash set first and enqueues only NEW tags. Duplicates are the overwhelming majority; filtering before the queue costs one probe and no allocation. |
| §15 delta sync | There is no delta anywhere in this fleet — the catalogue is a whole snapshot with a generation. Built against the generation gate, behind an interface a delta can replace. |
| §20 store-specific scope | Already answered: every node receives the entire estate catalogue. |
| §29 zero network during scan | Batched evidence upload stays, on its own coroutine. It is the crash-recovery story and it feeds shared sessions. Zero applies to the resolution path: no lookup, no per-tag request. |
| §29 60 fps result scrolling | Not available on this hardware. The platform's own UI does not reach it. |
| §33 EPC drill-down | Collected and filed, not drawn. The result screen is a tally. |

## Still open

- Packing and Receive have no **expected set** to compare against — today the
  carton's target is derived FROM the sweep, so there is nothing to be
  unexpected against. The engine supports it (`expect()`); the flow and the
  endpoint do not exist yet.
- The imager path is written and compiles but has not been tested against a
  physical label.
- Colour and size names are not in the catalogue the centre publishes; only the
  digits inside the SKU. The product name carries them ("Tail Tee Navy M"), which
  is what the result screen shows.

---

# Gen2X on this handheld — what was measured

Impinj's Gen2X is a conversation between an Impinj reader and an Impinj tag.
Both halves were checked rather than assumed.

## The reader is Impinj. The tags are NOT all Impinj — and that changes things

The reader announces itself: `E710_V7.10.1`. The E710 is an Impinj reader IC.
That half was never in doubt.

The tag half was, and this document got it wrong for a while. It read:

> **Both halves are Impinj.** The tags answer for themselves once FastID is on…
> `Impinj · TMN 0x1B0` — MDID 0x801 = Impinj, M700 series

That conclusion rested on **one tag**. The engine kept only the FIRST chip it
could identify and reported it as the sweep's finding — so a bench of fifty-odd
garments was being characterised by whichever one happened to answer first, and
the answer never changed no matter how mixed the population was. Worse, the
field was not cleared on reset, so a chip identified in the first sweep of an
evening survived into every sweep after it.

The engine now counts distinct tags per vendor, and clears that on reset with
everything else.

What put the original claim in doubt was not a code review. It was a link mode.

So Gen2X is available on this rig, and the SDK exposes it:
`setTagFocus`, `setFastID`, `setGen2`, `setFilter`, `marginRead`,
`startLocation`, `startRadarLocation`, `setProtectedModeAndShortRangeMode`,
`killTag`, `lockMem`, `uhfBlockPermalock`.

## Gen2X: every mode works, and every mode halves the tag count

The vendor's `setRFLink` takes modes 0–5 (Gen2) and 10–15 (Gen2X). All twelve
are accepted by this module — each one reports back exactly what was asked, so
none of them is being silently ignored.

Fifteen seconds each, same bundle, Tag Focus off, FastID off, `filter clear`,
returning to mode 1 at the end to prove the bench had not drifted:

| Family | Mode | 0/10 | 1/11 | 2/12 | 3/13 | 4/14 | 5/15 |
|---|---|---|---|---|---|---|---|
| Gen2 | tags | 58 | 60 | 58 | 58 | 59 | 59 |
| Gen2 | our `A0` tags | 31 | 31 | 30 | 30 | 31 | 30 |
| **Gen2X** | tags | 34 | 34 | 33 | 33 | 33 | 34 |
| **Gen2X** | **our `A0` tags** | **11** | **11** | **11** | **11** | **11** | **11** |

Closing sweep back at mode 1: 58 tags, `A0` ×30. Nothing moved.

### Why this is a population and not a sensitivity problem

Eleven, exactly, in all six Gen2X modes. Mode 10 is Miller8 at 160 kHz — the
slowest and most robust link the module offers. Mode 15 is Miller2 at 640 kHz —
the fastest and most fragile. A link-budget problem separates those two by a
wide margin. **These differ by zero.**

A threshold moves when you change the data rate. A population does not.

The remaining explanation is that Gen2X is answered only by tags that implement
it, and eleven of our thirty-one `A0` tags do. That is consistent with how this
bench was built: tags encoded over months from whatever stock was available.

**If that is right, Gen2X loses nothing** — it declines to talk to silicon that
cannot talk back. And the prize is large:

| | Tags | Reads | Reads per tag |
|---|---|---|---|
| Gen2 + Tag Focus | 58 | 248 | 4.3 |
| **Gen2X + Tag Focus** | 33 | **41** | **1.2** |

One point two reads per tag is very close to the theoretical floor: find it
once, and it is genuinely silent afterwards. No Gen2 configuration measured
here comes near that.

**This makes "all tags must be Impinj" a purchasing requirement rather than a
preference** — but only once the vendor histogram confirms the eleven. Until
then it is the best-supported hypothesis, not a fact.

## FastID is a diagnostic, not a setting

First measurement of what FastID costs, and it is not small:

| | Tags found |
|---|---|
| Gen2 mode 1 | 58 |
| Gen2 mode 1 + FastID | **42** |
| Gen2X mode 11 + FastID | **1** |

FastID concatenates the TID onto the EPC, roughly doubling what each tag has to
transmit, and a tag with marginal energy cannot finish the longer reply. Twenty-
eight per cent of the population drops out.

With Gen2X it collapses entirely — one tag out of fifty-eight. The two are not
meant to be combined, and now that is measured here rather than assumed.

**Operationally: FastID on only when the question is "whose silicon is this",
off for every count.**

## The link mode was never ours, and that voids absolute numbers

The module **keeps its link mode across an app restart**. This app never set it,
so it ran in whatever mode the last person left behind — and when the mode was
first read on 16 September it was sitting at **14: Gen2X, Miller2, 320 kHz**.

Nobody chose that. It means every absolute figure taken before that date was
measured at an unknown link mode, quite possibly a Gen2X one, which on this
bench sees eleven of our thirty-one tags.

Within-run A/B comparisons survive — both arms ran at the same unknown mode.
Absolute counts do not.

A setting that persists in hardware but is not controlled by the software is
worse than one that resets: the one that resets is at least the same every
morning. The link mode is now tracked, persisted and reapplied every time the
reader wakes, alongside Tag Focus and the session.

## Tag Focus works — measured three times, after two false readings

It took three attempts to measure this honestly. The first two were wrong, and
both failures were in the instrument rather than the radio.

### Attempt 1 — wrong: 85 % "saving" that was an accumulating counter

A sweep before any `setGen2` call was compared against one after, and the second
looked dramatically quieter. Two things were wrong with that. The reason given
at the time — that a written `q=1` had crippled the reader — was a guess about a
field whose meaning was never checked; `q` selects the Q ALGORITHM and `startQ`
carries the slot count, so `q=0, startQ=6` is an ordinary fixed 64-slot
configuration and nothing was crippled.

### Attempt 2 — wrong: a toggle whose label is the inverse of its state

The button reads "Tag Focus on" when the feature is OFF. A harness that tapped
by label ran both arms of an A/B with it off, got identical numbers, and the
claim was retracted. The retraction was right; its stated reason was not.

### The defect underneath both: sweeps were cumulative

`sweepOpen` was only ever cleared by Finish, and Finish was removed when the
trigger took over recording. So `beginSweep()` stopped being called and the
engine never reset: sightings, the distinct-tag set, malformed reads and the
product list all carried from one sweep into the next. Four configurations
measured in a row produced four readings of one accumulating total, and
reversing the order produced the same rising curve — which is what finally gave
it away.

**Every Gen2X figure taken before that fix is void**, including the ones used to
retract the first claim.

### The instrument that settles it

A duplicate ratio cannot answer this question. Tag Focus does not stop a tag
being read; it makes the tag hold its inventoried flag so it does not ANSWER for
a while — so what changes is the GAP between one read of a garment and the next
read of that same garment. That is now measured per EPC.

### The result

Session S1, target A, FastID off, same tags, same twenty seconds, off → on → off
so drift cannot masquerade as effect:

| Tag Focus | Tags | Sightings | Duplicates | Mean gap | Max gap | Malformed |
|---|---|---|---|---|---|---|
| off | 66 | 936 | 91.3 % | 1534 ms | 4978 ms | 15 |
| off | 66 | 943 | 91.4 % | 1532 ms | 4443 ms | 15 |
| **ON** | 67 | **338** | **79.9 %** | **2127 ms** | **10276 ms** | **1** |
| **ON** | 66 | **353** | **81.0 %** | **2209 ms** | **11446 ms** | **1** |
| off | 66 | 938 | 91.4 % | 1552 ms | 6535 ms | 15 |

- **64 % less radio traffic** for the same work.
- **Gaps grow 39 % on average and more than double at the maximum** — the
  mechanism, visible directly.
- **No tags lost.** 66–67 distinct in every condition.
- **Malformed reads fall from 15 to 1.** Quieter air reads cleaner, which was
  not expected and is worth having on its own.

**Operationally: Tag Focus on, session S1, target A, for every counting sweep.**

### Five pairs on a bundle — the hidden-tag claim does NOT reproduce

The rolled, rubber-banded bundle, five alternating pairs, twenty seconds each,
link mode pinned to 1, session S1, target A, FastID off:

| Tag Focus | Tags found |
|---|---|
| off | 57 · 57 · 57 · 58 · 59 |
| **on** | 58 · 57 · 57 · 59 · 59 |

**Identical.** On the most hostile arrangement available, Tag Focus found not
one tag that was missed without it. The 16.3-vs-22.3 signal recorded earlier did
not come back.

What did hold, and held strongly:

| | off | on |
|---|---|---|
| Reads | 807 | **249** |
| Malformed | 14.8 | **1.0** |

The likely reason the tag counts match: **twenty seconds is a long time.** The
reader completes thousands of rounds in it, and even a badly shadowed tag wins a
slot eventually. Silence does not change who can be found — it changes how long
finding them takes.

That reframes the benefit and makes it more useful, not less: the operator does
not stand at a rack for twenty seconds. **The question worth measuring is time
to a complete count, not completeness at twenty seconds** — and that is now the
open experiment, run at three and five seconds.

### Five pairs on an open desk — what it costs, settled

Thirty-four tags laid out flat, five alternating pairs, twenty seconds each,
session S1, target A, FastID off, every sweep independent:

| Tag Focus | Tags | Products | Sightings | Duplicates | Malformed | Re-reads | Mean gap | Over 500 ms |
|---|---|---|---|---|---|---|---|---|
| off | 34 | 24 | 583 avg | 90.8 % | 19.8 avg | 530 | 1 290 ms | 458 |
| **ON** | **34** | **24** | **46 avg** | **18.6 %** | **3.6 avg** | **9** | **2 620 ms** | **3** |

Per-sweep, off: 587 · 566 · 584 · 594 · 585. On: 45 · 43 · 49 · 51 · 43. The
ranges do not come within a factor of ten of touching, on any column.

- **92 % less radio traffic.** Not 64 % — that figure came from a five-sweep
  run on a rolled bundle, where the tags were fighting each other as well as
  the reader.
- **Thirty-four tags in all ten sweeps.** Twenty-four products in all ten. Tag
  Focus costs nothing in coverage on tags that are readable anyway — which is
  the claim that had to be tested before the feature could be turned on for the
  floor, and is now tested.
- **Re-reads fall from ~530 to ~9 per sweep.** This is the mechanism, counted:
  the tag stops answering, so there is no second read to time.
- **Malformed reads fall 5.5×** (19.8 → 3.6). The bundle run showed 15 → 1.
  Both are large; the multiplier is not stable across arrangements, so the
  claim that belongs in a brief is "fewer", not a number.

### Does the silence find tags hidden behind others?

The owner's question, and the reason any of this matters: if a tag that has
answered goes quiet, does a tag BEHIND it get a turn it would not otherwise
get?

The desk run above cannot answer it. Thirty-four of thirty-four were found in
every condition, because nothing on an open desk is hidden — there is no tag
waiting for a turn. What that run proves is the other half: silence costs
nothing.

The half-answer we have came from the deliberately hostile arrangement — the
tags rolled up and bound with a rubber band, which is worse than any rack:

| Tag Focus | Distinct tags found (mean of pairs) |
|---|---|
| off | 16.3 |
| **on** | **22.3** |

A 37 % gain, in the direction the theory predicts, on the only arrangement
where the theory can show itself. It is **not a result**: the per-pair ranges
overlapped, three pairs is not enough to separate them, and the raw log for
that run has since been overwritten by the desk run. It stands as a strong
signal and an experiment to repeat.

**To close it** the bundle has to be rebuilt — the same tags, rolled and bound
the same way — and five pairs run against it the way the desk was just run.
That is the one measurement in this document that needs the owner's hands
before it can be taken.

### How long a tag stays quiet — half answered

**Inside a sweep**, measured per EPC and valid:

| Tag Focus | Mean gap between reads of one tag | Longest gap |
|---|---|---|
| off | ~1 533 ms | ~4.7 s |
| **on** | **~2 168 ms** | **~10.9 s** |

**After the trigger is released — NOT answered.** An earlier table in this
document reported 100 % recovery at rests of 2, 5, 10, 20 and 40 seconds. That
measurement was taken before the cumulative-sweep defect was found, and the
defect destroys it exactly: the distinct-tag set was never cleared, so the
second sweep of every pair contained the first sweep's tags whatever the radio
did. A hundred per cent was arithmetic, not evidence. The table is withdrawn.

The question — how long after the radio stops before a rack answers fully again
— is open, and is now cheap to answer properly because sweeps are independent.

### Sessions

| | Duplicates | Notes |
|---|---|---|
| S0 | ~91 % | No flag survives, so Tag Focus has nothing to extend |
| S1 | 91.4 % off · 80.5 % with Tag Focus | The only session Tag Focus can work in |
| S2 | ~99 % | Suppresses nothing here; conventionally left to fixed portal readers |

## The Select filter works — at pointer 32, and the earlier verdict was wrong

The idea was the owner's: eight bits of Select on the EPC header, and the reader
stops hearing other people's tags altogether — no air time, no sightings, no
work on this device.

An earlier version of this section said the opposite. It said a Select left the
module returning nothing at all and concluded **"do not use Select on this
module"**. That was wrong twice over, and both errors were ours:

- The 2 608-EPCs-from-forty-tags reading was taken while the engine's counters
  accumulated across sweeps. It was a session total, not a sweep's.
- The zeros that followed came from a pointer this project changed to 0 on a
  guess. A Select whose mask matches nothing puts every tag into the state the
  reader is not asking for — so **zero tags is the filter working**, aimed at
  empty space.

### What settled it

The same 8-bit `A0` mask, tried at every byte boundary, against a desk whose own
histogram read `A0 x37`:

| pointer | 0 | 8 | 16 | 24 | **32** | 40 | 48 |
|---|---|---|---|---|---|---|---|
| tags | 0 | 3 | 0 | 0 | **37** | 0 | 0 |

Thirty-seven, exactly, at 32. The pointer is bank-absolute in bits — the EPC
begins after the CRC-16 and the protocol control word — which is what the code
assumed before the guessing started. The vendor's own Javadoc agrees on the
other parameter: `cnt` is a length in **bits**, and 0 means no filter.

### In use

| | Tags | Headers seen |
|---|---|---|
| no filter | 58 | `A0 x33, 00 x7, E2 x7, 99, 55, FF` |
| **`A0` filter** | **31** | **`A0 x31`** |
| cleared | 53 | `A0 x31, E2 x6, 00 x5, …` |

Nothing but ours answers. This is worth having in production: a warehouse is
full of pallet labels and security tags, and every one of them was costing us
air time.

One caution kept from the wrong verdict, because it is still true and still
useful: clearing a Select by calling `setFilter` with length 0 was not observed
to restore a module reliably, so `setOursOnlyFilter(false)` clears by closing
and reopening the module. It costs about a second and it means there is always
a way back.

## Distinct tags, not products — the unit these experiments need

A rig is full of tags that are Impinj in silicon and somebody else's in
writing: factory EPCs, other systems' encodings, leftovers. Those decode to no
SKU, so the PRODUCT total for a bench sweep is near zero while the radio is
hearing forty tags perfectly well.

Hours were lost to that confusion here — a product count of 3 read as evidence
of a broken radio, while 437 sightings in the same sweep said the opposite. The
diagnostics now report **distinct tags** beside the product total, and every
radio experiment is measured in that unit. A bench mode counts every tag as a
line, and marks those sweeps `BENCH` so they can never be read later as stock.

## A trap to carry forward

`setGen2` accepts a parameter block and then reports back different values:
`q=6` was written, `q=0` came back. This is the same species as `setFilter`
being accepted and not applied on the write path.

**Read every Gen2 parameter back after writing it.** Do not trust the return
value of the setter, and do not trust that the block you read is the block that
is running.

And because `setGen2` writes the WHOLE block, changing one field carries every
other field along with it — including a `q` of 1, two slots per round, which is
a reader that can barely hear a rack. `Reader.tuneGen2` therefore refuses to
write a Q below 2 unless asked explicitly, and `resetRadioDefaults()` is the way
back from a block somebody has already spoiled.

## Not yet tested

`setFilter` for inventory (does it narrow, or is it the write-path trap again),
`marginRead`, `startLocation` / `startRadarLocation`, Protected Mode and Short
Range. Protected Mode modifies a tag and needs a tag nominated for it; Kill is
permanent and is not on the list.
