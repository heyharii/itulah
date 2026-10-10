# Allotment performance follow-up

This follows [round two](procurement-performance-round2.md). The comparator
already includes those changes; measurements isolate this follow-up.

Additional bottlenecks were fixed:

- The database route trigger previously repeated three route lookups for
  every SKU line. Migration `0925` uses the INSERT transition table to check
  each distinct source/type/destination route once per statement. The same
  supplier, selling-site, warehouse, self-route and store-to-store rejection
  rules apply to direct SQL writes. An invalid route aborts the entire INSERT.
- Flow creation writes its document, SKU lines, stages and initial STATUS
  event in one SQL statement rather than four. Children use the header's
  returned ID; foreign keys, permission checks, replay checks and atomicity
  remain enforced. Initial STATUS payloads use the same Effect serializer.
  This removes three round trips per destination, or 39 for thirteen stores.
  Replay keys and non-replayed site rows are also prefetched in bulk. Document
  numbers are allocated inside the INSERT CTE with the same minimum-eight-digit
  format, including numbers beyond eight digits. The cache is transaction-local;
  standalone flow creation retains its replay lookup.

The rollback-only TEMP benchmark applies the actual previous and new trigger
function bodies to 2,600 inserted lines (200 SKUs × thirteen routes).
Four alternating measurements per trigger gave 83.424 ms versus 5.332 ms
medians. Both reject seven invalid mixed-route inserts atomically, and accept
valid supplier and warehouse routes. Exact inserted row counts match.

Reproduce with `python3 scripts/benchmark-allotment-route-trigger.py --database URL`.
This benchmark measures the route-trigger INSERT, not full HTTP latency.

The native availability query now aggregates both movement directions in
one scan per subject, using the distinct eligible warehouse/picking places.
Internal transfers still contribute once in and once out, and final numeric
balances preserve the previous total's semantics. On 250,000 movement facts
(5,000 subjects, fifty historical facts each), 200 requested SKU pairs measured
312.55 ms before and 149.40 ms after, with identical normal and committed
quantities. The final unfiltered-subject scan measured 351.35 to 145.76 ms
in two alternating samples at 200 pairs (about 58% lower), with exact balance
parity. EXPLAIN local blocks fell from 1,068,328 to 267,085 (75% lower).
Two additional movement indexes were rejected: they brought no measurable
benefit to this query shape and would add write work.

`benchmark-native-allotment-availability.py` reproduces the original and
lateral query comparison, custom/generic plan probes, and JIT on/off probes.
JIT did not activate in the observed plans. A full-database plan for the
prior lateral query showed PostgreSQL rebuilding broad place-index bitmaps
for each of 5,000 subjects; one availability query took 969 ms. The final query
removes that redundant location predicate from the scan and applies the same
eligible-place filters in the aggregate. The wide multi-article request's
4-second tail was not reproduced after this change; a five-article, 200-SKU
batch completed in 422 ms in one run. Whole-request timing still varies with
host load, so that single batch sample is directional only.

The HTTP harness checks real migrated databases, native stock minting, flow
stages and exact initial events, concurrent reservations and replay.
The comparison uses the prior round's final binary and this round's candidate,
with the same debug profile, disabled fixture authentication and loopback HTTP.
Queue polling/backlog, browser and external network delays are excluded.

Migration `0925_allotment_routes_are_checked_once_per_statement.sql` and the
backend change need deployment. No production database was changed.

## Intermediate candidate measurements

An initial candidate containing only the route-trigger and combined-write
changes passed all eighteen HTTP benchmark invocations. Whole-request medians
varied: normal 10-SKU/13-store Allotment 126.37 → 102.51 ms; 140-SKU/13-store
621.44 → 766.84 ms; 200-SKU/13-store 877.53 → 796.26 ms. One 140-SKU request
reached 4,019.19 ms. In that run, unchanged Save operations also reached
172.3 ms and worker operations exceeded two seconds. The host concurrently
ran other CPU-heavy work. This is evidence of variability, not proof of the
spike's cause. All intermediate samples remain in `round3-summary.json`;
they do not measure the subsequent native-query, sequence and prefetch fixes.

## Final query and correctness verification

The final build and maximum HTTP fixture passed with the last query change:
200 SKUs, 5,000 units, 13 stores, exact stock and flow-event assertions, two
competing reservations, and replay of the winning idempotency key. The five
measured 200-SKU/13-store Allotments had a 817.39 ms median and 850.20 ms p95;
the five-article batch in one request measured 422.49 ms once. The final
worker median was 1,023.97 ms for 5,000 units. These debug-profile local
measurements include the response/commit, but exclude background queue wait,
authentication and external network. The max-fixture results are in
[the passing log](../outputs/procurement-performance-2026-10-07/round3-optimized-max-guard.txt);
the full native query plans and parity cases are in
[the final query benchmark](../outputs/procurement-performance-2026-10-07/round3-final-native-availability.json).

The 140-SKU/13-store run had four measured requests: 574.80, 574.17, 2,530.21,
and 541.40 ms (median 574.17 ms). A separate four-request diagnostic had a
507.00 ms median and 588.18 ms maximum. This workload writes 1,820 allotment
lines, then starts one workflow per destination with up to 140 SKU lines;
the response also carries the line details. The wide-request timing therefore
scales with materialized rows and their checks, even though availability,
route validation, and inserts are batched rather than queried once per SKU.
The 2,530 ms outlier's cause was not isolated.

The latency harness reports nearest-rank percentiles, so with only four or
five samples its reported p95 is simply the maximum sample. Treat the 140-SKU
and 200-SKU p95 figures as observed maxima, not statistically reliable tail
latencies. The tagging movement result is likewise a SQL-only replay: it
excludes the full operational request, real-table triggers, projections,
pricing, serialization, and network. Neither is an end-to-end p95 promise.

The dedicated test cluster was isolated under the user's cache directory and
is stopped after verification. No production data or service was changed.
