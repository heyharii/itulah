# Allotment create: scaling beyond SKU × store count

> **Status (8 Oct 2026):** Phase 1 landed and the HTTP latency harness passed
> against the new code in both debug and release profiles. The latest release
> figures are recorded below. Fine-grained database/Rust step profiling and
> the remaining broad integration suites (`inventory_integration.rs`,
> `api_flow_integration.rs`, `supplier_return_letter_integration.rs`) have not
> been run against this revision. All HTTP measurements use a disposable local
> SQLx-migrated database and loopback transport, not a deployed Cloud service.
> The original 40% median-reduction acceptance bar is not met by the current
> same-profile debug comparison; the release run has no before-binary baseline.

Question put by the owner (7 Oct 2026): can create-allotment be fast *no
matter how many SKUs — or stores* — are in the request? Is there a better
algorithm? This plan answers both, grounded in the round-three measurements
([round 3](procurement-performance-round3.md)) and the code as it stands.

## The answer first

**No synchronous algorithm makes the request sub-100 ms at arbitrary size.**
The write materialises, atomically, `SKU × destination` rows in two places —
`allotment_line` (the MD promise, frozen by allotment-v1 §3) and
`flow_document_line` (what each destination's flow asks for, 0616) — plus one
`allotment_event` per line on the cloud-owned path. 140 SKUs × 13 stores is
3,640 durable rows before indexes, FK checks and WAL. That is the floor; an
algorithm cannot write fewer rows than the model says exist.

What *is* available, in order of ambition:

1. **Cut the constant factor** — batch the remaining per-destination and
   per-row work into single statements (Phase 1). No contract change.
   Realistic: roughly 2–3× faster at 140×13, i.e. ~200–300 ms.
2. **Change the read algorithm** — maintain balances incrementally instead of
   aggregating movement history per request (Phase 2). Makes availability
   O(SKU) index lookups regardless of history depth.
3. **Change the contract** — return before materialisation, finish in the
   background (Phase 3). The only path where response time is independent of
   line count. Needs an owner decision because it breaks a frozen guarantee.

Per-store cost specifically is already cheap: routes are checked once per
statement (0925) and flow starts share one template per route. The product
SKU × stores dominates; "many stores" is only expensive because it multiplies
lines.

## Where the time goes today (140 SKU × 13 stores, 574 ms median)

Code map of one `POST /inventory/allotments` inside its single transaction:

| Step | Where | Cost shape |
|---|---|---|
| Idempotency begin/end | `allotments.rs:190` | 2 statements |
| Validation context, owner, origin | `allotments.rs:202–255` | ~5 bulk statements |
| SKU lock | `allotments.rs:2449` `FOR UPDATE` | 1 statement; **correctness**, not removable |
| Availability | `allotments.rs:2474` / `:2547` | 1–2 aggregate statements over movement facts / `edge_inventory_fact_position`; O(history) |
| Header + `allotment_line` | `allotments.rs:281`, `:400` | 1,820-row `jsonb_to_recordset` INSERT + 0925 route trigger (per statement) |
| `allotment_event` (cloud-owned only) | `allotments.rs:415` | second 1,820-row `jsonb_to_recordset` INSERT |
| Flows | `flows.rs:2577–2596` | **13 separate statements**, each writing a document + 140 lines + ~5 stages + 1 event (`flows.rs:1218–1251`); template resolution, permission and `FlowState::start` run in Rust per destination |
| Edge command | `allotments.rs:530`, `sync.rs:6050` | 3 statements; payload carries all lines as one JSON blob |
| Response | `allotments.rs:368` | 1,820 detail objects built as `json!()` then re-serialised |

~38 round trips, ~3,640+ durable rows, three full per-line JSON structures
built in Rust. Round 3 already removed the per-SKU and per-row route checks;
what remains is per-destination statements, duplicate per-line serialisation,
and the O(history) availability read.

For further algorithm or contract changes, Phase 0 should pin per-step costs
first, so the split is measured rather than inferred.

## Phase 0 — profile the existing path (no code change)

1. Start the round-3 fixture cluster; set `log_min_duration_statement=0` and
   `auto_explain.log_analyze=on` (nested statements included) on the cloud DB.
2. Run the wide fixture (140×13 and 200×13) via the existing harness:
   `cargo test --locked --test procurement_latency -- --ignored --nocapture`.
3. Add coarse Rust-side timings (availability loop, line-row building, flow
   loop, response serialisation) behind the debug profile the harness already
   uses.
4. Output: a table of ms per step per size, appended to this file. Every later
   phase cites it.

## Phase 1 — one statement per table, no contract change

All preserve: single-transaction atomicity, replay/idempotency, the
same-transaction flow guarantee (owner, 27 Sep), 0925 route rejection, exact
initial events.

1. **All flow documents in one statement.** For one allotment, destinations
   sharing a route share a template; resolve templates and permissions once
   per distinct route in Rust (already cached in
   `AllotmentFlowStartCache`), compute `FlowState` per destination (its
   `planned` map differs), then write all 13 documents + all 1,820
   `flow_document_line` rows + all stages + all initial STATUS events in a
   single `INSERT … SELECT` grouped per destination, document numbers from
   `nextval` inside the statement. Replaces 13 statements and 13 ×
   jsonb payloads with one.
2. **Fold `allotment_event` into the `allotment_line` insert** (cloud-owned
   path): CTE insert lines `RETURNING` id/sku/etc., second CTE inserts the
   events from them. Kills the second 1,820-row jsonb parse. The details
   payload (`on_hand_qty_before/after`) is already computed in Rust per line
   and rides along one row set.
3. **Transport rows as arrays, not jsonb**: `unnest($1::uuid[], $2::text[], …)`
   beats `jsonb_to_recordset` parse cost for uniform rows.
4. **Typed response structs** instead of `json!()` per line; serialise once.

Acceptance: the round-3 HTTP guard passes unchanged (exact rows, exact initial
events, route rejections, duplicate-identity rejection, competing
reservations, replay of the winning key); 140×13 median at least 40% below the
round-3 figure measured on the same rig; no new statement in the request path
beyond ~10.

## Phase 2 — availability: maintained balance, not on-the-fly aggregation

The create path (and every suggestion screen) recomputes pool×SKU balances by
aggregating movement history. Round 3 halved it; it is still O(history per
subject). The better algorithm is an **incrementally maintained balance** —
one row per (pool, place, subject) updated by the movement writer — so the
create-time read becomes an index lookup per distinct SKU.

- Decision gate: only if Phase 0 shows availability > ~10% of the wide-request
  time on the realistic fixture. Round 3 rightly rejected *indexes* that did
  not help this query shape; a maintained projection is a different trade —
  every movement pays one indexed upsert to keep the read O(1).
- Measure both sides with the existing scripts as patterns:
  `benchmark-native-allotment-availability.py` (read) and
  `benchmark-projection-refresh.py` (write cost on movement append, including
  the sale path at stores).
- Parity bar: identical normal/committed quantities against the aggregate
  across the round-3 parity cases; a rebuild script must exist before cutover.

## Phase 3 — make response time independent of size (owner decision)

Options, in ascending ambition:

- **3a. Trim the response.** Return header + line ids + totals; the UI
  refetches the list it already renders. Saves serialisation and network, not
  DB time. Small contract change.
- **3b. Derived `flow_document_line`.** No FK references it and its only
  writers/readers are few; allotment-line quantity is immutable (adjustment
  writes `cancelled_quantity`; top-ups are new allotments), so a view per
  document destination satisfies 0616's "fixed when it starts". Halves the
  durable rows per create. Schema change; needs sign-off against 0616.
- **3c. Defer materialisation (202).** Synchronous phase: validation, route
  check, SKU lock, availability, header + idempotency — O(distinct SKUs),
  not O(SKU × stores). Lines, events, flows and the edge command are written
  by a background worker; the UI polls `edge_application_status`-style state.
  This is the only true answer to "sebanyak apapun". It breaks the frozen
  same-transaction flow guarantee (route-without-template must then be
  rejected in the sync phase — cheap, one lookup per distinct route) and
  needs reconciliation for worker failure. Do not design further without the
  owner choosing it.

## Verification protocol (every phase)

Same bar as round 3: targeted integration guards for atomicity, replay,
competing reservations and route rejection; the HTTP latency harness for
end-to-end numbers on the isolated fixture cluster; the cluster is stopped
afterwards. No production data. Local debug-profile numbers are labelled as
such — they are not p95 promises (round 3's caveat stands).

## Non-goals

- Removing the `sku … FOR UPDATE` lock — it is what makes two concurrent
  allotments over the same SKUs safe.
- Caching availability across requests — the SKU lock exists precisely
  because balances move; a cache would lie.
- Rewriting the line model (allotment-v1 §3) to store per-destination arrays.
  It would make creates O(SKU + stores) on disk but breaks every reader,
  trigger and the frozen vocabulary; rejected.

## Latest HTTP measurement (8 Oct 2026)

The release-profile run used one warmup and seven measured requests per
operation for 200 variants and a confirmation run with nine measured requests
for 140 variants. Both used 13 stores, 5,000 units per article, disabled
fixture authentication, and loopback HTTP. They checked minted stock, price
fan-out, exact flow stages and initial events, competing reservations, and
replay of the winning idempotency key. All checks passed. The reported maximum
is the nearest-rank p95 for seven or nine samples; treat it as an observed
maximum, not a stable service percentile.

| Request size | 1 destination p50 / max | 5 destinations p50 / max | 13 destinations p50 / max |
|---|---:|---:|---:|
| 140 SKUs (9 runs) | 48.47 / 62.51 ms | 133.38 / 182.32 ms | 307.63 / 712.79 ms |
| 200 SKUs | 65.32 / 80.57 ms | 205.69 / 241.83 ms | 491.12 / 614.39 ms |

At one destination, both tested sizes stayed below 100 ms in all seven
samples. Five and thirteen destinations exceeded 100 ms. Time grows with the
SKU-by-destination rows that must be written atomically; 140 SKUs and 13 stores
create 1,820 allotment lines plus matching flow lines. That work must be
persisted before the synchronous request can finish.

For New Articles, the synchronous 5,000-unit save measured p50/max of
4.53/9.77 ms at 140 variants (nine runs) and 5.41/8.28 ms at 200 variants
(seven runs). The durable background worker measured 629.48/911.40 ms at 140
variants and 718.64/772.48 ms at 200 variants. A prior seven-run 140-variant
sample had a single 3.66-second worker outlier; it did not recur in the
nine-run confirmation. The HTTP save is already fast; making an article fully
ready still depends on the worker. One nine-article allotment batch measured
478.59 ms at 140 SKUs; one seven-article batch measured 451.35 ms at 200 SKUs.
These are single observations, not percentiles.

The bulk-flow writer allocates a materialized sequence value per document
while preserving numbers longer than eight digits. This fixed a duplicate
number failure exposed by the first benchmark attempt. The latest correctness
guards pass with both 140- and 200-SKU fixtures.

The same-profile debug comparison is directional because the earlier runs had
only four or five samples: the 140-SKU/13-store median moved from 574.17 ms to
511.78 ms (about 11% lower), and the 200-SKU/13-store median moved from
817.39 ms to 758.85 ms (about 7% lower). That does not satisfy the original
40% reduction bar. The release-profile values above are the current absolute
measurements; there is no matching release-profile before run.
