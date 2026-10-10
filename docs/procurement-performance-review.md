# Supplier and procurement performance review

Reviewed on 6 October 2026 using Luna (`gpt-6-luna`, max reasoning) for the
Cloud backend and the primary agent for browser requests and master usage.
The review and benchmarks ran locally against Cloud application code; these
are not measurements from the deployed service.

The [7 October Save/Create follow-up](procurement-performance-round2.md) and its [Allotment bottleneck follow-up](procurement-performance-round3.md)
adds real HTTP/worker measurements, additional flow/publication batching,
an indexed edge-stock lookup, and the maximum-size fixture.

| Flow | Finding and change |
| --- | --- |
| Suppliers | Shared supplier name resolution scanned the entire book for each row. A weakly held index now serves each immutable supplier snapshot, preserving exact references, ambiguous names, and fallbacks. Picker reads now use `/suppliers/options`, returning the same complete supplier records and cursor order while skipping order tallies, facets, and book summaries. Existing unrelated work was preserved. |
| Procurement / receiving review | PO detail repeated receipt sums and receipt history reads for each line. Receipt facts, tags, and variants are now aggregated per order and joined back to its lines. Edit eligibility reuses those facts and cancel guards ride on the header query: six sequential reads become four. Row-only PO consumers opt out of global facet grouping while retaining exact filtered totals. |
| Sizes, divisions, tags | Master rows evaluated the same correlated usage count twice per term. Full list usage is now grouped once and reused, with zero for unused terms. Size usage still counts SKUs; division/tag usage counts articles. Single-term reads retain their indexed count. Active catalogue dictionaries share one SELECT instead of three, preserving their display orders and trimmed size codes. |
| Master edits | Saving or deleting one vocabulary invalidated all three lists and targeted the wrong catalogue vocabulary key. It now invalidates the edited list, its usage records, and the actual shared catalogue vocabulary. |
| Colours | The existing SQL already groups colour usage and the browser shares its colour cache. No new database change was needed. |
| New article setup | One browser request atomically saves the setup(s), replay key and durable issue queue. A leased worker mints stock and prices afterward using the batched setup/SKU/serial/job/price writes. UI shows processing and failed work, polls only while work is pending, and refreshes availability after completion. |
| Native Gudang article stock | The narrow tagging identification movement shape locks subjects, validates lot balance and existing unit placements, and appends ledger facts in batches. Other movement shapes keep sequential validation. SKU IDs are also fetched once for all job lines. Projection refresh and final placement checks remain in the transaction. |
| New Allotment | The Cloud-owned source path reads active SKU codes with the existing locks, loads requested source/SKU balances together, and batches line and creation-event writes. Running reservations preserve availability checks across several destinations for the same source/SKU. Edge-owned source availability also batches eligible pools, fact balances, and commitments for all requested source/SKU pairs. One HTTP request carries up to ten article allotments, committed sequentially with separate numbers and stable retry keys; a failed article stops the batch and earlier successes are returned. |
| Receiving count sheet | Receipt history and dependent PO detail reads are enabled only while the sheet is open. Receiving queue polling remains in place. |

## Local evidence

- Supplier lookup regression tests cover references, ambiguous names, refreshes,
  and repeated lookups against 10,000 suppliers. Two thousand lookups inspect
  names only during the initial index build, rather than repeatedly scanning
  every supplier.
- A PostgreSQL query microbenchmark with 100 size masters, 200,000 SKU facts,
  an index on size, and five alternating runs measured median execution time
  of **70.167 ms before** and **26.501 ms after** (about 2.65 times faster).
  The last runs reported 159,896 versus 886 local buffer hits. This measures
  the full-list usage query shape, not total endpoint or screen latency.
- Reproduce the master benchmark with
  `python3 scripts/benchmark-master-usage.py postgresql:///postgres`.
  It uses connection-local temporary tables and leaves existing data unchanged.
- The vocabulary regression test compares list usage and usage facets with
  goods facts for all three vocabularies, including a tag attached to two
  articles, unused terms, and descending usage order.
- A serial-reservation SQL replay for 100 existing SKU counters reduces
  database statements from **300 to 1**. Five alternating local runs measured
  medians of **501.827 ms before** and **67.291 ms after**, with substantial
  variation under shared machine load. This measures serial reservation only,
  not complete article setup. Reproduce with
  `python3 scripts/benchmark-setup-serials.py postgresql:///postgres`;
  each measured transaction is rolled back and its tables are temporary.
- Code-derived statement counts for the variant-specific issue/pricing work
  fall from **8 per SKU** to **4 for the batch** (800 to 4 for 100 SKUs): SKU
  creation, serial reservation, job lines, and assortment/price rules. Fixed
  transaction, publication, dispatch, and inventory work is additional; this
  count is not an instrumented end-to-end request result.
- PO detail replay used the local fixture with 240,000 orders, 2,400,000 lines,
  and 2,159,990 receipts. For one order with ten lines and ten receipt facts,
  five alternating warm runs measured medians of **0.350 ms before** and
  **0.276 ms after** (about 21% less SQL execution time). Final shared buffer
  hits fell from **258 to 97**, and returned rows/JSON matched exactly within
  one repeatable-read snapshot. The legacy fixture lacks `wrong_quantity`, so
  both reads supplied zero through an inlined CTE without changing its data
  or schema. This does not exercise nonzero mismatch quantities.
  Reproduce with `python3 scripts/benchmark-po-detail.py`; after committing,
  pass `--baseline` with the pre-optimization revision. Each statement has a
  20-second timeout. Cold/warm mixed timings were excluded from the comparison.

## Recheck on 8 Oct 2026

The earlier local measurements above remain useful as method notes, but these
latest runs use the current working tree. They are SQL-plan or temporary-table
measurements unless stated otherwise; only the allotment/article harness
includes loopback HTTP.

- Supplier options on `po_load_240k` (240,004 suppliers, 240,000 PO summaries,
  1,000-row page): median full-book page + facets + open-order summary was
  **671.841 ms**; the options query was **0.809 ms**. The first-page supplier
  IDs matched, and shared blocks fell from 37,397 to 1,010.
- PO count on 240,000 orders: unfiltered count fell from **83.625 ms** with a
  join to **7.284 ms** from `purchase_order_summary`; the 2025 fully-received
  filter fell from **50.844 ms** to **15.119 ms**. Counts matched in all five
  tested filter cases.
- PO detail for ten lines and ten receipt facts: the current query median was
  **0.213 ms**, versus **0.270 ms** from the `HEAD` baseline. Returned rows
  matched; the legacy fixture has no `wrong_quantity` column, so that field is
  supplied as zero in both reads.
- Size-master usage aggregation (100 terms, 200,000 SKU facts): median fell
  from **72.384 ms** to **26.027 ms**; local buffer hits fell from 159,896 to
  886.
- Tagging movement SQL replay (1,000 EPC units in temporary tables): the
  current batch used four statements and measured a **7.735 ms** warm median,
  versus 3,003 statements and **129.709 ms** for the sequential path. This
  excludes real-table triggers, projections, pricing, serialization, and
  HTTP.
- The release-profile New Article and Allotment HTTP results are recorded in
  [the latest scale-plan section](procurement-allotment-scale-plan.md#latest-http-measurement-8-oct-2026).

Supplier options, PO counts/detail, size usage, and tagging above were not
measured through the browser or a deployed Cloud endpoint. New PO creation and
the HTTP read endpoints for division, color, size, and tags were not measured
in this recheck.

## Follow-up priorities

The user clarified that the delay is **after Save/Create**, particularly New
Articles and New Allotment. Native Gudang tagging previously executed one
subject lock, one placement check, and one ledger insert per EPC. The new
identification path performs four core SQL statements for the whole batch
instead of 3,003 for 1,000 EPCs (including the received lot). A temporary-table
SQL replay measured warm medians of 201.806 ms versus 13.567 ms, excluding the
first run of each variant. A later run under shared machine load measured
539.026 ms versus 19.137 ms, so these timings are not a stable latency promise.
This is a SQL microbenchmark: it excludes real-table
triggers, projection refresh, pricing, Rust serialization, and HTTP latency.
Both paths check resulting fact counts and unit balances; the batch placement
guard also rejects existing placements (including quantity two at one place)
and allows a unit whose company balance has returned to zero. Reproduce with
`python3 scripts/benchmark-tagging-movements.py`; the new batch SQL is extracted
from the implementation. Its three new statements also prepared successfully
against the real local schema in a read-only transaction.

New Articles now opts into background issue using the existing create/split
routes and one stable `Idempotency-Key`. The setup and queue entries commit
atomically. The `articles.issue` job starts in the Cloud runtime, claims up to
four sessions per pass with `SKIP LOCKED`, and uses recoverable leases. Three
failed attempts leave a visible failure for manual retry. Session locking and
transactional minting still prevent duplicate jobs/ranges/facts. Legacy API
calls without `background=true` retain their original behavior. Catalogue
identity and native stock become available when the worker's issue transaction
commits; the form does not report minting complete merely because it saved.

Migration `0921_article_setup_issue_waits_in_a_durable_queue.sql` and the updated
Cloud process must be deployed together with the frontend. This pass did not
apply migrations to the deployed service or restart it.

Luna measured the New Allotment availability query on the read-only local
`inventory_perf_big` fixture (3,624 subjects, 4,393 movement facts, 18 active
SKUs). Six alternating warm pairs after warmup measured median SQL execution
time of 39.97 ms for the old correlated reads and 8.23 ms for the set-based
query, with equal balances and commitments for all requested SKUs. These
figures exclude request processing, line/event writes, and flow documents.
The Cloud-owned create path also removes per-line SKU-code reads and batches
line/event writes; destination flow creation still adds work. The edge-owned
path also batches balances and commitments; a two-SKU SQL fixture verified
picking supply, pending/applied commitments, and exclusion of other origins. Validation must cover multiple SKUs sharing one source pool and several
destinations sharing one source/SKU, because the new read must neither multiply
eligible places nor overlook reservations made earlier in the same request.
The current-schema one-SKU parity check returned no differences; a 48-SKU
correlated parity read exceeded its five-second timeout. All four new allotment
statements prepared against the current schema in a read-only transaction.
The follow-up Cloud binary check passed; two new durable queue guards also
passed, including concurrent workers, replay, invalid-save rollback, expired
leases, visible failure and manual recovery. The dedicated multi-SKU and
multi-destination allocation guard passed against the real migrated schema,
including rollback of an over-allocation across several destinations.

- Supplier options replay on a fixture with 240,004 suppliers and 240,000 PO
  summaries measured five-run warm medians of **645.702 ms** for the full
  page/facets/book reads and **0.840 ms** for the options query. Shared blocks
  fell from 37,397 to 1,010. The first 1,000 supplier IDs matched. Reproduce
  with `python3 scripts/benchmark-supplier-options.py postgresql:///po_load_240k`.
  This deliberately large fixture is not deployed request latency.
- PO facet SQL measured **1,223.809 ms** versus **263.424 ms** for the row-only
  count path. The page query still runs separately, so these numbers cover
  only facet/count work. Four representative PO edit/cancel reasons matched
  the old guards. A materialized full-book consolidation was slower and was
  rejected; page LIMIT pushdown remains intact.


1. Measure deployed p50/p95 Save/Create latency and database/network time.
   Local SQL gains do not establish a production latency result.
2. Profile media and large picker/search payloads separately. Supplier options
   still returns full records for legal/payment consumers and caps the picker
   book at its existing 10,000-party limit.
3. Background work can still fail on missing routing or inventory constraints;
   the processing/failure state and retry are required parts of the workflow.

## Validation

- Supplier lookup tests: 3 passed.
- ESLint on the changed frontend files: passed.
- Rust formatting on the changed vocabulary implementation and tests: passed.
- Vocabulary integration suite: 14 passed, including usage counts/facets,
  sorting, retirement, version conflicts, and idempotent creation.
- Final `cargo check --locked --bin cloud` passed with 11 existing library
  warnings. The inventory/tagging test binaries also compiled successfully
  with all performance changes.
- All seven batched setup SQL statements prepared successfully against the
  local schema in a read-only transaction; no inserts were executed.
- PO performance replay verified identical line rows/JSON.
- Full frontend typecheck encountered existing `PhoneCard` / `PhoneCards`
  errors across unrelated screens; none were reported in the changed files.
- Durable setup queue guards: 2 passed on the latest compiled binary.
- Multi-SKU/multi-destination allotment guard: 1 passed.
- Concurrent serial reservation and overflow rollback guards: 2 passed.
- No deployed HTTP load benchmark was performed.
