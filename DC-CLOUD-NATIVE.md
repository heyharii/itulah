# The Gudang run by the cloud — native, no sync

Written 2026-10-04. Owner's ruling: **the DC runs in the cloud, writing the
cloud's own Postgres tables directly. No DC server, no SQLite, no sync.** A DC
server in the warehouse (on-premise, `bin/dc.rs` + sync) stays available as an
option and is NOT changed. Unit tests: none (owner: ignore them). Existing DC
data on the demo is not migrated: the cloud-run Gudang starts clean.

Supersedes the hosting part of DC-CLOUD-PLAN.md (that plan kept a second DC
data store and sync).

## The switch

`INVENTORY_DC_HOSTING=cloud` on the cloud node → `cloud::dc::common::hosted()`.
Default (unset / `edge`) = on-premise DC server, everything as today.
`GET /api/v1/health` answers `"dc_hosting": "cloud" | "edge"`; the hub's
Operations module reads it to decide where the Gudang lives.

## Shape

- Code: `backend/src/cloud/dc/` — `mod.rs` (routes), `common.rs` (shared
  helpers, done), `print_bridge.rs` (done), and one file per area:
  `receiving.rs`, `tagging.rs`, `picking.rs`, `packing.rs` (koli + dispatch),
  `returns.rs`. An area may add sibling files `cloud/dc/<area>_*.rs` (declare
  them as `mod` inside its own file, e.g. `#[path = "receiving_store.rs"] mod
  store;`, so `cloud/dc/mod.rs` is never edited by an area).
- Routes: **the same paths and the same JSON as the DC server's
  `/api/v1/dc/*`** (`backend/src/edge/http.rs` 84–318; request/response types
  in `backend/src/edge/contracts.rs`, `edge/outbound.rs`, `edge/printing.rs`,
  `edge/flows.rs`, `edge/inbound.rs`; the hub's client is
  `frontend-contract/src/client/dc.ts`). Reuse those Rust types for
  (de)serialisation wherever possible so the hub screens work unchanged. Mount
  them in your area's `pub fn routes(router: Router<AppState>)`.
- Every handler: `common::require_hosted()?` first; `State<AppState>`;
  `Extension<crate::cloud::http::auth::Principal>` for the actor (the cloud's
  auth layer already forces any `actor_id` in a body to equal the signed-in
  user, and gates by path/role). Errors are `AppError`.
- The Gudang's site: `common::gudang_site(&db)` / `gudang_site_tx` (the one
  site of kind HO). Never hard-code `dc`, `ho` or `ho-gudang`.
- Stock: the cloud's own movement ledger (`inventory_subject`, `movement_group`,
  `movement`, `inventory_projection`, pools from pool templates per site —
  `migrations/postgres/0001`, `0610`; writers in `cloud/postgres/movements.rs`,
  `allotments.rs` `execute_allotment` at ~805 is the cloud-native pick).
  With no DC origin owning the HO site, `fleet-pools` already treats these as
  `CLOUD_LEDGER` rows.
- Records downstream readers depend on (payables, letters, flows, valuation,
  article history, PO summary) must be written **in the shape they already
  read**. Where the DC server's fact had an applier in
  `cloud/postgres/sync.rs` (`apply_goods_receipt_line` 8095,
  `apply_goods_receipt_invoice` 8495, `apply_goods_receipt_rejected` 8422,
  `apply_tagging_completed` 8045, `apply_fulfillment_progress` 4362,
  `apply_allotment_pick` 4272, flow_stages resumes…), call that applier
  directly inside your transaction with origin `common::CLOUD_DC_ORIGIN`,
  generation `common::CLOUD_DC_GENERATION`, seq `common::next_seq(&mut tx)`,
  after `common::ensure_origin(&db)`. Making an applier `pub(crate)` is fine.
  Do not copy their logic.
- Document numbers (koli, surat jalan, dispatch, receipt): `common::next_number`.
- Printing: render with the DC server's own ZPL code (`edge::zpl`,
  `edge::printing` render helpers — reuse, don't rewrite), send with
  `print_bridge::deliver(host, port, bytes).await`; probe with
  `print_bridge::reachable`. `bridge:<name>` reaches the warehouse bridge.

## No node, no commands

When hosted, nothing may wait for a DC node:
- Purchase orders and their revisions/cancels/close-shorts, tagging jobs: issue
  **no** sync command (the issuing code today fails with "no registered DC owns
  site" — when `hosted()`, skip the command and carry on). The cloud-run
  Gudang reads `purchase_order`, `tagging_job` etc. directly.
- Allotments and official counts already run in the cloud when no origin owns
  the site.
- Store-bound things (store inbound announcements, in-transit release) still go
  to the store's node as today — stores are always nodes.

## Migrations

Postgres, `backend/migrations/postgres/`, reserved block (do not use others):

| Area | Numbers |
|---|---|
| receiving | 0900–0902 |
| tagging / printing | 0903–0905 |
| picking | 0906–0907 |
| packing / koli / dispatch | 0908–0911 |
| returns | 0912–0914 |
| common (done) | 0915 |

Name them as the repo does (`09NN_a_sentence_that_says_what_changed.sql`).
Plain SQL; everything `IF NOT EXISTS` where possible. Tables for the Gudang's
own working state are prefixed `dc_` (e.g. `dc_receiving_count`,
`dc_print_session`, `dc_pick_session`, `dc_koli`, `dc_dispatch`).

## Working rules for the parallel build

- Touch only your own area's files, your migration numbers, and — only where
  unavoidable — small, clearly-commented edits in shared files (visibility of
  an applier, a `hosted()` branch where a command is issued). Re-read a shared
  file right before editing it; other areas are editing in parallel.
- Do **not** run `cargo check`, `cargo build`, `cargo test`, `tsc` or any
  build. The integrator compiles once at the end. No unit tests.
- Match the house style: comments say why, in plain English; names are plain.
- Rules the DC server enforces are the specification (blind count, a counter
  never sees the ordered quantity, exact counts auto-receive (see migration
  0828 for who may count/accept), sealed koli are final, a dispatch departs
  once, …): read the DC server's implementation of your area and keep its
  behaviour.
