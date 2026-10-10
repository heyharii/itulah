# Procurement performance: Save/Create follow-up

Measured on 7 October 2026 against the local Cloud application. This follows
[the first review](procurement-performance-review.md), with Luna Max reviewing
the publication and PO paths. These are local measurements, not deployed
service timings.

The round-two baseline already includes the first review's optimizations;
the comparison below measures additional changes, not the original application.

## Additional changes

- Publication dispatch preserves each shop's scoped price/markdown rows but
  reads and writes groups of up to eight recipients. For 13 shops the scoped
  reads, command/cursor/delivery writes and rollout inserts fall from 78 to
  eight database round trips. Fixed shared publication reads are additional.
  Cursor updates lock origins in sorted order, acknowledgements are retained,
  and an existing rollout report is never overwritten.
- Inventory projection refresh computes the ledger balance once and shares
  it between deleting nonpositive positions and upserting positive positions.
  A temporary-table benchmark checks exact quantities and last fact sequences,
  including removal of emptied positions. With 20,000 affected positions,
  alternating warm medians were 106.679 ms before and 81.374 ms after.
- Allotment flow creation batches stage inserts and reuses site/template
  lookups within one allotment transaction. Every document still checks its
  permissions, source, quantities and replay key. Standalone flow creation
  loads its current template afresh; nothing is cached across requests.
  Initial STATUS events use the known document ID through the same event
  mapper/serializer, removing another joined read per destination. Warehouse
  aliases are canonicalized once per alias, rather than once per SKU line.
- PO book totals count the summary directly when all filters belong to that
  summary. Text, supplier and issued-date filters retain the joined count.
  The count remains exact and independent of the page cursor. Five filter
  cases match on a 240,000-order fixture.
- Edge-owned stock availability now has a partial index on
  `(origin_id, sku_code, place_id)` for positions with a SKU. A 250,000-position,
  10,000-SKU TEMP fixture measured 37.467 → 0.176 ms for ten requested SKUs and
  42.433 → 3.701 ms for 200. Exact returned quantities match; the old plan
  scans every position while the indexed plan finds 25 unit positions per
  requested SKU. Quantity is excluded from the index to avoid maintaining
  this index on quantity-only changes. This is a source-stock SQL benchmark,
  not complete Allotment latency.

## Final alternating HTTP measurements

Five alternating before/after pairs used four measured repetitions each,
providing 20 samples per side for each paired operation. The baseline already
contains round-one improvements. Times below are milliseconds; p50 is the
median of all raw samples, and p95 uses the nearest rank.

| Operation | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| Save, 5,000 units / 10 SKUs | 6.57 / 8.55 | 6.40 / 9.31 |
| Worker, 5,000 units / 10 SKUs | 692.20 / 866.25 | 633.10 / 1047.60 |
| Allotment, 10 SKUs / 13 stores | 103.61 / 112.77 | 87.51 / 99.26 |
| Save, 5,000 units / 140 SKUs | 11.51 / 15.79 | 10.78 / 13.39 |
| Worker, 5,000 units / 140 SKUs | 866.97 / 990.37 | 782.49 / 851.53 |
| Allotment, 140 SKUs / 5 stores | 245.30 / 270.97 | 246.07 / 338.02 |
| Allotment, 140 SKUs / 13 stores | 596.39 / 712.82 | 574.48 / 760.75 |

The normal 13-store Allotment median improves about 16%; 5,000-unit worker
medians improve about 9–10%. The 140-SKU/five-store median is essentially
unchanged, and several tails worsen. These results do not establish that
all paths are faster or that optimization is complete.

After-only batch measurements contain five samples each: ten articles with
ten SKUs have a 501.84 ms median; four articles with 140 SKUs have a 646.11 ms
median and one 4,988.39 ms sample. A subsequent run recording analyzed SQL
plans completed that large batch in 331.13 ms and did not reproduce the
spike. No captured Allotment SELECT exceeded the 100 ms recording threshold.
The earlier spike's cause remains unresolved; it is retained in the results.

The maximum fixture, 200 SKUs / 5,000 units / 13 stores, passed five measured
runs: Save p50/p95 11.79/13.13 ms, worker 716.76/974.99 ms, Allotment
666.03/712.29 ms. A five-article batch completed in 504.88 ms (one sample).
These maximum-fixture results have no paired pre-change baseline.

[All raw samples and aggregate metrics](../outputs/procurement-performance-2026-10-07/final-summary.json)
and [maximum-fixture log](../outputs/procurement-performance-2026-10-07/max-200-final.txt)
are retained alongside correctness and diagnostic logs. Earlier candidate
measurements are also retained and excluded from the final paired table.

## Reproduction and measurement scope

`backend/tests/procurement_latency.rs` is an opt-in benchmark using a fresh,
fully migrated SQLx database. It starts the actual HTTP router on loopback,
creates a PO and receiving count, saves article setups through HTTP, runs the
real durable-queue worker, and creates Allotments through HTTP. Assertions
verify minted stock, per-store price delivery, queue completion, and flow
documents/stages outside the measured operation.

The normal fixture uses 10 variants, 13 registered stores, 120/1,000/5,000
units, one warmup and seven measured repetitions. Allotments distribute each
SKU to one, five and 13 stores. `PERF_WIDE=true` selects up to ten colours and
20 sizes, with 5,000 units. `PERF_RUNS` controls repetitions.
The seeded wide fixture contains 140 SKUs. `PERF_MAX_COLOURS=true` seeds ten
fixture colours and twenty fixture sizes in the disposable database to test
exactly 200 SKUs. It also verifies two concurrent HTTP reservations cannot
oversell the same stock, and the winner replays with the same Allotment ID.
Collected setups are then submitted in one batch request and retried to
verify every acknowledgement is preserved.

```sh
DATABASE_URL=postgresql:///postgres \
INVENTORY_AUTH_MODE=disabled INVENTORY_DC_HOSTING=cloud \
cargo test --locked --test procurement_latency -- --ignored --nocapture
```

Save timing includes the HTTP response and transaction commit. Worker timing
includes stock minting, validation, ledger/projection updates, price delivery
and commit. It excludes the runtime's queue polling delay and existing queue
backlog; it is not the complete deployed Save-to-ready latency. Authentication
is disabled for fixtures, and external network/browser rendering is excluded.
Both before and after binaries use the same Cargo debug profile; these are
comparative measurements, not estimates for a production release build.
Small sample p95 is descriptive, not a production service-level estimate.

An independent PostgreSQL 17 server under `/tmp` isolates the benchmark from
the shared local database. Early runs overlapping heavy shared database work
or compilation are retained as diagnostic results, not used to claim stable
production performance. No production data or service configuration changed.

Additional query benchmarks are reproducible with
`scripts/benchmark-projection-refresh.py`, `scripts/benchmark-po-count.py`,
and the scripts linked in the first review. The projection script uses TEMP
tables and rolls back writes; the PO count script is read-only. Preserve the
pre-optimization revision using `--baseline` after committing the changes.
The edge index benchmark is
`python3 scripts/benchmark-edge-allotment-availability.py --database URL`;
its entire fixture/index transaction rolls back.

## Correctness checks and remaining suite failures

The final build passed. Fifteen selected regression tests passed: eleven
tagging/queue/serial tests, publication fan-out scope/cursor/retry, commercial
atomicity, multi-SKU/multi-destination commitments, and edge pool ownership.
The maximum-size HTTP benchmark passed minted-stock, per-store price,
flow-stage, exact initial STATUS event, concurrent reservation and retry
checks. Initial events are checked against the document's resulting status,
including null stage/target and HUB execution.

The wider existing suites are not all green. The untouched foundation test
expects 99 pools while current migrations seed 164. The edge tagging lifecycle
test expects goods in the old untagged area, while the current edge receiver
puts identified units directly in Stockroom. The older Allotment scenario's
shortage-accounting phase lacks the current fiscal period; a diagnostic run
opening it also exposed missing received cost basis in that fixture. The
temporary test-period edit was reverted. These failures are retained in the
raw logs; the new Cloud HTTP concurrency test checks planning reservations
without depending on that unrelated shortage-accounting fixture.

Migration `0921_article_setup_issue_waits_in_a_durable_queue.sql`, the Cloud
worker/frontend changes from the first review, and the new
`0924_edge_allotment_stock_is_indexed_by_sku.sql` still need deployment.
