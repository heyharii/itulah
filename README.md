# Retail Edge Foundation

Inventory-first retail application with a Rust/Axum core, PostgreSQL append-only inventory ledger, extensible Commercial Minimum, Store Edge Sales/POS, and a dependency-free HTML frontend. **Movement facts are inventory authority.** `inventory_projection` is disposable and can be rebuilt entirely from the ledger.

There are exactly **two edge types**:

- **DC Edge** for distribution-center inventory operations;
- **Store Edge** for store inventory plus Sales/POS.

Sales is not a third edge. Keeping Sales beside Store inventory allows a completed checkout and its `Store Floor / On Hand → external/customer` inventory movement to commit in one PostgreSQL transaction. Central/HO publishes Commercial versions; Store Edge consumes their deterministic read model and snapshots the selected offer on each sale line.

The same Rust binary can run as a `DC`, `STORE`, or central/demo `CLOUD` node through `INVENTORY_NODE_ROLE`. V1 persistence is PostgreSQL. Domain and application layers do not depend on HTTP, and placement semantics live in Rust so a future SQLite repository adapter can preserve the same edge behavior.

## Architecture

Open the inventory-ledger diagram at [`docs/inventory-architecture.html`](docs/inventory-architecture.html). Its Archify delivery passed all 9 showcase checks with zero errors/warnings and desktop containment at 1440×900, 1600×1000, 1920×1080, and 2048×1320. The frozen source is [`docs/inventory-architecture.json`](docs/inventory-architecture.json).

```text
Central / HO                          Store Edge
Commercial authoring                 HTML POS + RFID / inventory UI
      │ publish immutable version              │
      └──────────────► published read model ───┤
                                               ▼
                                  Rust Commercial + Sales Core
                                               │ one DB transaction
                                  ┌────────────┴────────────┐
                                  │ completed sale          │
                                  │ immutable SALE movement │
                                  └────────────┬────────────┘
                                               ▼
                                  PostgreSQL ledger authority
                                  + disposable projection

DC Edge: inventory operations only
Future: repository port → local SQLite ledger → ordered edge/cloud sync
```

## Run locally

Requirements: Rust stable, PostgreSQL 16+ (or Docker), and Python 3 only for the optional RFID simulator.

### PostgreSQL with Docker

```bash
cp .env.example .env
docker compose up -d postgres
cd backend
cargo run --bin inventory-edge
```

The server applies all migrations and deterministic demo data automatically. Open <http://127.0.0.1:8080>.

### Existing local PostgreSQL (macOS/Homebrew)

```bash
createdb inventory_edge_dev
cd backend
DATABASE_URL=postgresql:///inventory_edge_dev cargo run --bin migrate
DATABASE_URL=postgresql:///inventory_edge_dev cargo run --bin inventory-edge
```

Do not run both server commands simultaneously. Axum serves `frontend/`; there is no Node/npm build step.

### Checks and tests

```bash
cd backend
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --lib
DATABASE_URL=postgresql:///postgres cargo test --test inventory_integration -- --nocapture
cd ../frontend && node --check app.js
```

`sqlx::test` creates isolated temporary databases and applies all migrations. The PostgreSQL user in `DATABASE_URL` therefore needs permission to create test databases.

## Working POS demo

1. Start the application and open <http://127.0.0.1:8080>.
2. Open **Sales** and choose **Store 07**.
3. Create a sale, then scan one of the seeded Store 07 Floor EPCs: `EPC00000001` through `EPC00000005`.
4. Add a cash payment at least equal to the displayed total.
5. Complete the sale.
6. Open **Movements** or **Control**. The completed sale references one `SALE` movement group from `store-07.floor:on_hand` to `external/customer`; Replay remains `MATCH`.

The **Commercial** page shows published versions and the offers resolved for the selected store. The seeded publication is version 1, channel `STORE`, currency `IDR`, with a company-wide assortment/price and inclusive `STANDARD` tax at 1,100 basis points for all 18 active SKUs.

A completion retry with the same idempotency key returns the original result and does not consume stock twice. An unpaid completion fails and leaves both sale and inventory unchanged. An OPEN sale can be voided without inventory movement.

## Deterministic demo data

`0002_demo_seed.sql` creates:

- 1 DC and 13 Store sites;
- 60 operational pools and 120 pool/state ledger places;
- 6 articles, 18 SKUs, 3,600 EPC/UNIT subjects, and 24 QUANTITY subjects;
- warehouse, picked, packed, shipment, in-transit, DC reject, store-origin DC reject, store warehouse/floor/reject balances;
- current Missing, historical Lost, outbound/store movement chains;
- 601 RFID sightings including deliberate placement mismatches;
- CLOSED, ACTIVE, and REVIEW official counts.

A verified inventory seed contains 3,624 subjects and 3,705 opening/demo movement facts. `0003_commercial_sales.sql` adds one coherent published Commercial version and no pre-created sales. The projection is built from signed ledger deltas rather than independent balances.

## Database schema overview

| Area | Tables | Purpose |
|---|---|---|
| Merchandise identity | `article`, `sku`, `inventory_subject` | Minimal identity; UNIT requires EPC and quantity 1 |
| Topology | `site`, `operational_pool`, `inventory_place` | Groups navigate only; only pool/state places are endpoints |
| Inventory truth | `movement_group`, `movement` | Atomic business action and immutable source→destination facts |
| Derived state | `inventory_projection` | Disposable current subject/place balances |
| Retry safety | `command_deduplication` | Global key + command type + SHA-256 payload digest + stable response |
| RFID evidence | `observation_sighting` | Consolidated bursts with event and receive times |
| Reconciliation | `official_count`, `count_snapshot`, `count_entry` | DRAFT→ACTIVE→REVIEW→CLOSED lifecycle |
| Controls | `replay_run`, `repost_run` | Diagnostic/audit metadata; never stock movements |
| Commercial versions | `commercial_publication` | DRAFT/PUBLISHED effective versions pinned by sales |
| Commercial rules | `commercial_tax_rule`, `commercial_assortment_rule`, `commercial_price_rule` | Tax, sellability, global prices, and store override prices |
| Store Sales | `sale`, `sale_line`, `sale_payment`, `sale_number_sequence` | OPEN cart, offer snapshots, payments, and finalized sale references |

PostgreSQL foreign keys ensure movement endpoints are real `inventory_place` records. No place exists for a navigation group. Triggers reject UPDATE or DELETE on ledger facts/groups, protect published Commercial rules, protect completed Sales, and prevent mutation of their children.

Canonical operational place IDs are `<pool-id>:on_hand` and `<pool-id>:missing`, for example `store-07.floor:missing`. System/external IDs are `system/opening`, `system/count_gain`, `system/lost`, `external/supplier`, `external/customer`, and `external/disposal`.

## Commercial Minimum

Commercial is deliberately small but versioned for extension:

- integer minor-unit money only; no floating-point calculations;
- effective DRAFT→PUBLISHED publications;
- channel-aware assortment and pricing (`STORE`, with domain support for future channels);
- optional site-specific price/assortment rules overriding company-wide rules;
- tax category, basis-point rate, and inclusive/exclusive tax calculation;
- deterministic resolution by publication/version, time, site, channel, and SKU;
- published data is immutable;
- publication rejects incomplete catalogs: every active SKU needs a company-wide base assortment and price for each represented channel;
- each sale pins one publication/version, while each line snapshots price, tax, totals, and a snapshot digest.

This boundary can later add promotions, vouchers, customer segments, or other price components without changing inventory authority or rewriting historical sales.

## Store Sales transaction model

1. `POST /sales` creates an OPEN Store sale, allocates its number, and pins the currently effective published Commercial version.
2. Scanning an EPC resolves the SKU offer in that pinned version and appends a line snapshot. Only Store Floor / On Hand can eventually be sold.
3. Payments append to the OPEN sale.
4. Completion locks the sale and inventory subjects, validates full payment and source availability, appends `SALE` movement facts, updates the disposable projection from facts, and marks the sale COMPLETED in the **same PostgreSQL transaction**.
5. Any validation/database failure rolls the entire operation back.

The movement kernel remains the only inventory write path. Sales never updates `inventory_projection` directly. Two paid carts may contain the same EPC, but ledger-derived availability plus subject locking allows exactly one completion.

## Rust module layout

```text
backend/src/
├── domain/
│   ├── ids.rs          # UUID IDs and typed SiteId
│   ├── place.rs        # typed pools, states, groups, saleability
│   ├── movement.rs     # causes and transition invariants
│   ├── observation.rs  # pure RFID burst consolidation
│   ├── count.rs        # count lifecycle and expected/found classification
│   ├── commercial.rs   # channels, currency, offers, deterministic tax math
│   └── sales.rs        # sale/payment status and completion rules
├── application/mod.rs  # DTOs, config, shared application errors
├── infrastructure/postgres/
│   ├── movements.rs    # subject locks, ledger authority, projections
│   ├── observations.rs # batch idempotency and sighting merge
│   ├── counts.rs       # snapshot, entries, atomic approval
│   ├── queries.rs      # Pools, Time Machine, Missing, Lost risk
│   ├── control.rs      # Replay, Repost, guarded test corruption
│   ├── commercial.rs   # publication, coherence checks, offer resolver
│   └── sales.rs        # cart/payment/finalization + atomic SALE movement
├── http/mod.rs         # Axum routes only
├── bin/migrate.rs      # one-shot migrations
└── main.rs             # edge node process
```

## API

### Commercial and Sales

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/v1/commercial/publications` | List versions / create complete DRAFT publication |
| POST | `/api/v1/commercial/publications/{id}/publish` | Validate coherence and publish immutably |
| GET | `/api/v1/commercial/offers/resolve` | Resolve one SKU by `sku_id`, `site_id`, `channel`, optional time/version |
| GET | `/api/v1/commercial/offers` | Resolve the effective catalog by `site_id`, `channel`, optional time |
| GET/POST | `/api/v1/sales` | List sales / create an OPEN Store sale |
| GET | `/api/v1/sales/{id}` | Sale with line snapshots, payments, and movement reference |
| POST | `/api/v1/sales/{id}/lines` | Scan/add an EPC line from the pinned publication |
| POST | `/api/v1/sales/{id}/payments` | Append payment to OPEN sale |
| POST | `/api/v1/sales/{id}/complete` | Atomically finalize payment state and inventory SALE movement |
| POST | `/api/v1/sales/{id}/void` | Void an OPEN sale without inventory movement |

### Inventory and controls

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Node identity and readiness |
| GET | `/api/v1/inventory/pools` | Current or `?as_of=` pool balances |
| GET | `/api/v1/inventory/pools/{id}` | Pool items, Missing, evidence, movements, counts |
| GET/POST | `/api/v1/inventory/movements` | Immutable history / typed manual movement |
| POST | `/api/v1/inventory/movements/correct` | Evidence-required placement correction |
| GET/POST | `/api/v1/inventory/observations` | Evidence query / retry-safe RFID batch |
| GET | `/api/v1/inventory/observation-anomalies` | Ledger versus latest RFID placement mismatch |
| GET/POST | `/api/v1/inventory/counts` | Count board / create DRAFT |
| POST | `/api/v1/inventory/counts/{id}/activate` | Freeze scope and expected snapshot |
| POST | `/api/v1/inventory/counts/{id}/entries` | Record official found quantities |
| POST | `/api/v1/inventory/counts/{id}/submit` | ACTIVE→REVIEW |
| POST | `/api/v1/inventory/counts/{id}/approve` | Atomic shortage/gain facts and close |
| GET | `/api/v1/inventory/missing` | Current pool-specific Missing |
| POST | `/api/v1/inventory/missing/{id}/found` | Missing→On Hand, same or other pool |
| POST | `/api/v1/inventory/missing/{id}/lost` | Missing→system/lost |
| POST | `/api/v1/inventory/missing/{id}/dispose` | Missing→external/disposal |
| GET | `/api/v1/inventory/as-of?at=...` | Historical ledger reconstruction |
| POST | `/api/v1/inventory/replay` | Read-only ledger/projection comparison |
| POST | `/api/v1/inventory/repost` | Rebuild projection, create zero movement facts |
| GET | `/api/v1/inventory/control` | Health, last replay/repost, differences |
| POST | `/api/v1/inventory/control/corrupt-projection` | Guarded disposable-environment test only |

Manual movement accepts only `NORMAL_MOVE`, `SALE`, or `SUPPLIER_RETURN`. Count shortage/gain, Found, Lost, Disposal, Placement Correction, and completed POS Sales each have dedicated application paths.

## RFID handheld demo

Send the checked-in burst:

```bash
curl -i http://127.0.0.1:8080/api/v1/inventory/observations \
  -H 'Content-Type: application/json' \
  --data @examples/rfid-observation-burst.json
```

Or generate a current event time, 80 duplicate reads, and an identical retry:

```bash
python3 scripts/rfid_simulator.py --retry
```

A successful response distinguishes `raw_read_count` from `consolidated_sighting_count` and reports `inventory_effect.movement_count = 0` and `missing_created = 0`. Same key/same payload returns the stored response; same key/different payload returns HTTP 409. `observed_at` is retained separately from server `received_at`.

## UI structure

- **Sales:** store selector, New Sale, EPC scanner input, cart totals, cash payment, Complete/Void, and sale history.
- **Commercial:** immutable publication list and effective resolved offers per Store.
- **Pools:** collapsible DC/site/group sections; one row per operational pool with On Hand, Missing, Observed, and Lost %. Historical `As Of` is read-only.
- **Movements:** immutable table with scanner-friendly Move Stock and higher-risk Correct Placement dialogs.
- **Counts:** compact Active, Needs Review, History, and Draft columns with Create, Activate, scan entry, Submit, and Approve.
- **Missing:** origin, age, latest evidence, Found Here/Elsewhere, Confirm Lost, Dispose, and History.
- **Control:** ledger health, fact count, projection differences, Replay, Repost, and guarded test corruption.

The UI is deliberately white, table-first, and dependency-free. It does not show `Custody` or `Lost 30D`.

## Core invariants

1. Groups are navigation only and cannot hold inventory or be endpoints.
2. A movement has distinct explicit source/destination and positive quantity.
3. Each movement is a balanced pair; internal moves conserve company quantity.
4. Historical movement facts/groups are append-only and atomic by group.
5. Source availability is calculated from locked ledger facts—not projection.
6. A UNIT/EPC has quantity 1 and at most one current company placement.
7. Missing is a state of one exact operational pool and is never saleable.
8. Store Floor / On Hand is the only saleable placement.
9. Store-origin DC Reject remains distinct through typed IDs and metadata.
10. Observation writes evidence only: no movement, Missing, count, or correction.
11. Official Count creates shortage/gain only on explicit approval.
12. Confirmed Lost starts at an operational pool's Missing state.
13. Replay cannot alter inventory; Repost alters projection only.
14. Idempotency-key reuse with a different command/payload is rejected.
15. Subject locks serialize concurrent EPC movements.
16. Published Commercial versions and their rules are immutable and coherent.
17. Historical Sales use line snapshots and never re-resolve against newer prices.
18. Sale completion and inventory posting commit or roll back together.
19. Sales can only consume Store Floor / On Hand and never Missing or DC stock.

### Lost % V1 formula

```text
confirmed Lost originating from the pool during the configured window
÷
(max(on-hand at window start, 0) + inbound On Hand quantity during the window)
```

Default window: 30 days. It intentionally does **not** divide by current On Hand. The formula is returned by the Pools API so the UI does not hide its meaning.

## Test coverage

The 17 pure unit/property tests cover typed places, saleability, Store/DC transitions, Missing/Lost/Found, RFID consolidation, count lifecycle/classification, balanced movement pairs, inclusive/exclusive integer tax math, and full-payment completion rules.

Two isolated PostgreSQL integration scenarios prove:

- all 60 expected pools and all 13 stores;
- Store Warehouse→Floor conservation and concurrent EPC serialization;
- movement/RFID/count/repost idempotency and conflicting-payload rejection;
- evidence-backed correction, official count reconciliation, Missing/Lost, Time Machine, Replay/Repost, and append-only rejection;
- real Axum API/static HTML smoke behavior;
- complete Commercial version creation, retry-safe publication, global offer plus Store override, and published-rule immutability;
- sale publication pinning and price/tax/version snapshots;
- retry-safe sale create, line, payment, and completion;
- completed sale decreasing company inventory and referencing its SALE movement group;
- unpaid completion rolling back without a movement;
- exactly one winner when two paid carts attempt the same EPC;
- Commercial/Sales HTTP route wiring;
- final Replay result `MATCH`.

## Known V1 limitations

- The frontend is plain HTML/CSS/JavaScript by explicit foundation request, not React/TanStack.
- PostgreSQL is implemented; SQLite edge persistence and edge/cloud synchronization remain future repository/sync adapters.
- Central/HO publication transport to offline Stores is not implemented yet; the demo uses one database/read model.
- `INVENTORY_NODE_ROLE` identifies the process, but V1 does not yet bind a STORE process to one configured `site_id`; central/demo mode can operate any Store. Sales itself rejects DC sites and non-STORE channels.
- No authentication, RBAC, TLS termination, fiscal device, receipt printer, or production device provisioning is included.
- Payment records are local tender facts; there is no external payment authorization/capture/refund integration.
- Completed-sale returns/exchanges are not implemented. OPEN-sale void is supported.
- Commercial excludes promotions, campaigns, vouchers, customer segments, bundles, markdown optimization, and dynamic pricing; the versioned resolver is the extension boundary for them.
- Quantities are positive whole-number `BIGINT` values; fractional UOM conversion is not implemented.
- Count gain requires an already-known subject; registering unknown merchandise EPCs is outside V1.
- RFID confidence scoring and reader calibration are not implemented.
- Repost takes an application advisory lock, but production should also coordinate it across independently deployed writers.
- The demo seed is deterministic operational data, not a production article master, ERP, procurement, finance, shipment-document, or receiving system.
