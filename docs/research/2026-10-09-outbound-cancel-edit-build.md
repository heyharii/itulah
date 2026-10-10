# Outbound: MD edit / cancel, Gudang move back, short pick — build spec

9 Oct 2026. The design lives in `outbound-board-prototype.html` (repo root,
http://localhost:5397/outbound-board-prototype.html) and in the memory notes
`project_allotment_cancel_edit_2026_10.md` and `project_cannot_continue_2026_10.md`.
This file is how the **real app** gets there. Nothing here is deployed; nothing is
compiled (Hari: no cargo / tsc runs unless asked), so every file is written to be
read-checked carefully.

## 0. The rules, in one place

1. **MD cancels at any stage before an allotment is sent.** "Cancel = reduce
   everything not sent to nothing." Demand not yet packed is closed at once.
   Pieces already picked or packed are **owed**: the Gudang moves them back.
   Sent stays sent.
2. **MD edits in place** (add or reduce, per SKU × store). Never below what is
   sent. A reduction takes unpacked demand first, then owes the rest.
3. **MD sees the change at once.** The Gudang sees a card it must work off.
4. **Hard stop.** A carton / piece MD took out cannot be packed, dispatched.
   The server refuses; there is no override.
5. **Move back** (the Gudang undoes its own work, or works off what MD took
   out): Picked → To pick, Packed → Picked, Packed → To pick. Partial, per SKU
   and quantity. **Never** from a carton already on a trip / In transit.
   Pieces MD already took out go back first and are not asked for again.
6. **Short pick.** The picker reports why a line could not be finished. What
   was picked goes on; the shortfall stays on the same picklist (it is the same
   allotment × shop). A small amber **Short pick** flag marks the card; it
   clears by itself when the count finds the pieces or the remainder is
   picked. Ops never sets Missing. MD sees **Target · Sent · To pick** and may
   **Close remaining**. No Blocked state, no Resume, no Wait.
7. Cancelled demand is never revived.

## 1. How the real model carries it (read before touching the backend)

* Cloud-run Gudang (`backend/src/cloud/dc/*.rs`, `dc_hosting = cloud`). Edge
  (DC-server) allotments are out of scope: every new route answers
  `Conflict("Edge-owned allotment …")` for `allotment.activation_target_origin_id IS NOT NULL`.
* Counters (allotment-v1, `allotment_line`): `quantity` (what MD allotted),
  `picked_quantity` (legacy, raised at pick), `cancelled_quantity` (legacy
  close short), `closed_short_quantity`, `packed_quantity`, `unpacked_quantity`,
  `shipment_quantity`, `unshipped_quantity`, `dispatched_quantity` (=loaded),
  `unloaded_quantity`, `in_transit_quantity`, … View `allotment_line_commitment`
  derives `to_pack_qty = quantity + unpacked + lost − packed − closed_short(_total)`,
  `at_packed`, … The CHECKs (`allotment_line_fulfillment_places_check`,
  `allotment_line_legacy_pick_check`) must keep holding: **MD can only give up
  what is in To Pack (ALT-INV-04)**.
* "Picked" has no counter of its own in the commitment view. A picked piece is a
  piece in the pick area (the Gudang site's PICKING pool, place
  `<pool>:on_hand`) whose newest movement is referenced to its allotment line:
  view `dc_pick_waiting` (0907). To pick = `OPEN_PICK_LINES` in `dc/picking.rs`.
* Packing moves pieces pick area → Packed pool (`dc/packing_stages.rs`
  `record_stage`: movement per line, `packed_quantity += n`, `dc_koli_unit`,
  `edge_koli` mirror, `edge_fulfillment_progress_fact`, flows). `pack` already
  refuses a line with `to_pack_qty < n`; `dispatch_trip` checks only "sealed,
  not on a trip".
* 0938 (written, in `backend/migrations/postgres/`) adds:
  `allotment_line.takeout_pending_quantity`, table `allotment_amendment`,
  `dc_koli.voided_at`, table `dc_short_pick`. Read it. Do not edit it; if an
  agent needs another column it adds its **own** numbered migration
  (A = 0939, B = 0940, C = 0941).

### The arithmetic of MD's reduction

Let a line be reduced by `x` (net target goes from `t` to `t − x`, `t − x ≥ floor`
where `floor` = pieces on a delivery note or beyond = `shipment_quantity −
unshipped_quantity`).

* `free = to_pack_qty` (pieces nobody packed yet, **including** pieces picked and
  waiting in the pick area).
* `released = min(x, free)` → `closed_short_quantity += released` at once
  (ALT-INV-04 holds: it only takes from To Pack).
* `owed = x − released` → `takeout_pending_quantity += owed` (pieces in unsent
  cartons). Nothing else moves yet.
* Pieces waiting in the pick area beyond what is still wanted are **owed to the
  racks**: `owed_picked = max(0, waiting − to_pack_qty)` (derived, never stored).
  `pack` cannot take them (its `to_pack` check is the hard stop).
* **Net target** shown to people = `quantity − Σ(released + owed over REDUCE/CANCEL
  amendments)` (an ADD already raised `quantity`; do not add it again). The
  server's own `target_quantity` (A4) is `quantity − closed_short_total −
  takeout_pending_quantity` from the commitment view, which also takes
  legacy close shorts into account. **Floor ("sent")** = `at_shipment +
  at_loaded + at_in_transit + receiving_gap_qty + received` (not
  `shipment − unshipped`, which would include pieces booked lost).
* Unpacking `n` pieces of a line (`unpacked_quantity += n`) first, then, for a
  line with `takeout_pending_quantity > 0`: `m = min(n, pending)`,
  `closed_short_quantity += m`, `takeout_pending_quantity −= m` in the same
  transaction. The pieces now sit in the pick area as owed-to-racks.
* **ADD** `y`: `quantity += y` after the same availability check an allotment is
  created with (source pool free stock); history row kind `ADD`.
* **CANCEL** = REDUCE of every line to its floor, kind `CANCEL`, plus
  `allotment.cancelled_at = now` when nothing is sent. Do **not** write header
  status `CANCELLED` if a line is partly sent (`refresh_allotment_status`
  overwrites it from the commitment view); keep the cancel visible through the
  amendment rows (`kind = 'CANCEL'`).

## 2. Backend routes (exact wire; types in `frontend-hub/src/lib/operations/changes.ts`)

| # | Route | Who builds |
|---|---|---|
| A1 | `POST /api/v1/inventory/allotments/{id}/amend` | BE-A |
| A2 | `POST /api/v1/inventory/allotments/{id}/cancel` (cloud branch rewritten; edge branch untouched) | BE-A |
| A3 | `GET  /api/v1/inventory/allotments/{id}/work` | BE-A |
| A4 | `GET /api/v1/inventory/allotments/{id}` lines gain `sent_quantity`, `target_quantity`, `takeout_pending_quantity` | BE-A |
| B1 | `POST /api/v1/dc/move-back` | BE-B |
| B2 | `GET  /api/v1/dc/owed` | BE-B |
| B3 | hard stop in `dispatch_trip` (+ `execute_allotment` guard) | BE-B |
| C1 | `POST /api/v1/dc/short-picks`, `GET /api/v1/dc/short-picks` | BE-C |
| C2 | `GET /api/v1/inventory/allotments/unfilled` gains `target`, `sent`, `short_reason`; close-short accepts short-pick lines | BE-C |

Shapes are exactly the interfaces in `changes.ts`. JSON field names snake_case.
Timestamps RFC 3339. UUIDs as strings. Idempotency: every write takes
`idempotency_key` and replays (`begin_idempotent` / `complete_idempotent` for
the inventory routes; unique-key insert for dc routes).

Ownership of files (no two agents write the same file):

* BE-A: `cloud/postgres/allotment_amend.rs` (new), `cloud/postgres/allotments.rs`
  (cancel branch + `get_allotment` lines only), `cloud/postgres/mod.rs`
  (`pub mod`/re-exports), `cloud/http/mod.rs` (A1–A3 routes + handlers or a new
  `cloud/http/allotment_amend.rs`), `cloud/application/*` if a request type is needed.
* BE-B: `cloud/dc/move_back.rs` (new), `cloud/dc/owed.rs` (new), `cloud/dc/mod.rs`
  (routes), `cloud/dc/packing_stages.rs` (dispatch hard stop only),
  `cloud/dc/packing.rs` (`list_koli` hides voided kolis; routes), `postgres/allotments.rs::execute_allotment`
  (the guard — one `if`).
* BE-C: `cloud/dc/short_pick.rs` (new), `cloud/dc/mod.rs` (routes — **BE-B and
  BE-C both add a line to `routes`/`mod` list; each adds only its own line**),
  `cloud/postgres/allotment_close_short.rs`, its http handler.

## 3. Frontend (hub) work

Visual source of truth: the prototype. Hub rules: text never below 14px
(body 15px), 44px phone buttons, nothing scrolls sideways, actions at the
bottom on phone, copy in English (dates with year, "Quantity" not "Qty"), no
filler subtitles, Emil-style motion (ease-out, press scale .97,
reduced-motion honoured), numbers not bars. Load the Emil skills before any
UI. Do not run tsc/build. Never run git.

* **FE-1 Board** (`screens/operations/board/{board.tsx,parts.tsx}`, new
  `board/owed.ts`, new `board/move-back.tsx`, `screens/operations/packing/packing.tsx`
  koli sheet entry): cards for owed work (see §4), the Move back dialog, drops
  (`DROPS`): `to-pack>to-pick` and `packed>to-pack` open Move back prefilled, remove
  `in-transit>packed`; a carton MD took out cannot be ticked for Dispatch.
* **FE-2 MD** (`screens/allotment/allotments.tsx` AllotmentSheet + new
  `allotment/amend-sheet.tsx`, `allotment/cancel-dialog.tsx`; `allotment/unfilled.tsx`,
  `allotment/nav.ts`): Edit in place (stepper per SKU × store, floor = sent,
  Was / Now), Cancel dialog (cost per stage from `allotmentWork`, ticked
  acknowledgement when work is owed, required reason chips), "Still needed" tab.
* **FE-3 Pick** (`screens/operations/picking/picking.tsx`): why chips on the
  accept sheet, `reportShortPick`, stock-related reasons raise the targeted count,
  operational ones do not; flag on To pick tiles (via FE-1's Tile props).

## 4. Card language (board)

* **Edited −50** — red strip across the card top; row `300 → **250** pcs −50`;
  card body NOT dimmed; button **Move back** (prefilled with the excess).
* **CANCELLED** — big rotated stamp + hatched "switched off" layer; the card's
  only live thing is **Move back**; no Pack / Dispatch tick.
* **Short pick** — amber strip "Short pick" on a normal, workable To pick card;
  reason only in the card sheet / tooltip.
* To-pick cards that MD cancelled **disappear on their own** (nothing to pick
  any more) — unlike the prototype there is no "Remove picklist" button.

`Tile` (parts.tsx) gains optional props `strip?: { tone: "warn" | "bad"; label:
string }`, `change?: { from: number; to: number }`, `stamp?: string`,
`switchedOff?: boolean`, `actionLabel?` (see FE-1 for the final shape; FE-3 only
sets `strip`).

## 4b. Implementation notes from the build (9 Oct)

* Extra migrations: 0939 (BE-A: trigger 0005 let `allotment_line.quantity` never
  change; now it may rise, never fall), 0941 (BE-C: `dc_short_pick.closed_short_at_report`
  to tell PICKED from CLOSED). 0940 reserved for BE-B.
* Migration 0005 also refuses any UPDATE of a CANCELLED allotment header: the
  move back must never write the `allotment` table.
* `close-short` on a cloud line now caps at `to_pack − pieces waiting in the pick
  area` (BE-C), like the edge branch.
* Amend/cancel lock header → lines → SKU; pack locks lines → header: a deadlock
  is possible, Postgres aborts one side (same pattern as the old cancel).
* Hand-edited generated contract files: `UnfilledLine.ts`, `ShortReason.ts` (+ index).
  `make contract` must be run, and the new structs added to
  `backend/tests/contract_types.rs`, to replace them.
* The new routes of BE-A come in through `.merge(...)`, so `tests/route_catalog.rs`
  and `tests/testdata/routes.json` do not list them yet.
* The local rig runs an edge DC server (`dc_hosting = edge`): none of the new
  cloud routes exist there. New flows work only on a cloud-hosted Gudang.

## 5. What is deliberately not here

Edge (DC-server) allotments; the sqlite node; a pointer-based drag and drop;
Undo within 2 min; "Waiting 3 h / Remind"; flows rewind on unpack (flows keep
the Pack stage reached); the Inventory "Stock checks" rename beyond the
vocabulary of the short-pick status. Listed so nobody assumes them.
