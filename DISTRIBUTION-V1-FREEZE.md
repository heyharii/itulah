# Distribution V1 — execution plan and change list

Status: **execution plan.** The domain model it serves is frozen elsewhere.
Date: 12 September 2026. **Revision 4.**

> **This document does not own the commitment model.**
> Ownership, lifecycle, fulfillment stages, receiving semantics, Close Short,
> the authorization boundary and the UI contract live in
> [docs/allotment-v1.md](docs/allotment-v1.md), baseline 1.3. What lives here is
> the **physical execution**: pool transitions, picking and packing mechanics,
> koli and loading, dispatch, and the ordered change list that gets the estate
> from where it is to that model.
>
> Where the two disagree, `docs/allotment-v1.md` wins and this file is corrected.

Revisions 1–3 of this file carried the model itself, including an
`AT_EXCEPTION` stage and an MD-owned `resolve_exception`. Baselines 1.1–1.3 of
the acuan removed both: exceptions are not a fulfillment stage, Inventory owns
`Found`/`Lost`, custody passes at handover, and a Store never rejects an
allotment. Revision 4 strips the superseded model out of this file and keeps
what execution actually needs.

---

## 0. What the audit changed about the plan

Findings from reading the code that contradict earlier assumptions. All of them
make the work **smaller**.

1. **The edge already implements the target commitment model.** Free picking
   touches no allotment row. `picked_quantity` rises *only at pack*, together
   with `packed_quantity` — `edge/sqlite.rs:3342` and its mirror
   `cloud/postgres/sync.rs:3617`, both: "Picked and packed rise together."
   What diverges is the **cloud-native** path and the **read formulas**.

2. **Three comments describe behaviour that no longer exists**, and they are why
   two earlier reviews reached opposite conclusions:
   - `edge/sqlite.rs:2496` — "Pick … releases that reservation": it does not.
   - `edge/domain/inventory/allotment.rs:122` — "Picking releases Allotted": no.
   - `edge/contracts.rs:393` — "server assigns this quantity to accepted
     Allotment lines in FIFO order": it does not.
   Correcting them is part of the work.

3. **The LOADED rung already exists** (`DcOutboundLoaded`; `dispatched_quantity`
   is incremented at stage `Loaded`; `InTransit` refuses a unit that is not
   `LOADED`). The per-unit ladder already enforces §9; the **dispatch-level**
   departure does not.

4. **`COMPLETED` on the store-receipt path is already correct**
   (`cloud/postgres/sync.rs:2665`). The defect is that `DC_COMPLETED` sits on the
   same column and reads as terminal.

5. `T1` **The non-additive `packable` risk is already a live bug.**
   `edge/outbound.rs:1239` `destinations_owed` computes `min(wanted, pick area)`
   per destination against the **same shared** picking pool, then the caller may
   add the destinations up. Ten shirts in the Pick Area wanted by two shops
   report `packable` 10 + 10 = 20.

6. `T2` **"not already in another koli" is enforced by the database** —
   `ux_dc_active_package_epc` on `koli_unit(epc) WHERE released_at IS NULL`
   (`migrations/sqlite/0004_edge_inventory_work.sql:108`). No work needed.

7. `T3` **There is no `condition` / grade field anywhere in the domain.**
   "condition eligible" means `state = NORMAL` today. V1 does not invent a
   condition model.

8. `T4` **`pick_session` already has no reservation semantics** — it is
   `session_id, picker_id, started_at, closed_at, status, note`
   (`migrations/sqlite/0009_edge_outbound_containment.sql:33`). The freeze's
   "no claim" rule needs no code change; it needs to stay true.

9. `T5` **`dispatched_quantity` is not on the sync wire.** It is a column on both
   schemas, and the ladder is encoded in CHECK constraints. Renaming is a schema
   change, not a compatibility break — but V1 only deprecates it semantically.

10. `T6` **`cancelled_quantity` is the legacy spelling of Close Short.** MD
    cancelling what a DC had not yet picked is, in the new model, giving up on
    demand that is still `to_pack`. Legacy rows read as `closed_short_total`;
    nothing new is ever written to the old column.

---

## 1. What execution must emit

The counters, equations, statuses and invariants are in
[docs/allotment-v1.md §3–§8](docs/allotment-v1.md). Execution's obligation is to
emit the right facts at the right physical moment, and nothing else:

| Physical moment | Event | Counter | Owner |
|---|---|---|---|
| Confirm Pack, per EPC, bound to a store | `ALLOTMENT_PACKED` | `packed_total` | Distribution |
| carton opened again | `ALLOTMENT_UNPACKED` | `unpacked_total` | Distribution |
| sealed koli confirmed into a shipment | `ALLOTMENT_SHIPMENT` | `shipment_total` | Distribution |
| koli pulled back out | `ALLOTMENT_UNSHIPPED` | `unshipped_total` | Distribution |
| koli actually loaded | `ALLOTMENT_LOADED` | `loaded_total` | Distribution |
| taken off before departure | `ALLOTMENT_UNLOADED` | `unloaded_total` | Distribution |
| dispatch departs, loaded contents only | `ALLOTMENT_IN_TRANSIT` | `in_transit_total` | Distribution |
| koli actually handed over at the shop | `ALLOTMENT_HANDED_OVER` | `handed_over_total` | Store |
| units actually found at the shop | `ALLOTMENT_RECEIVED` | `received_total` | Store |
| Inventory settles a loss | `ALLOTMENT_LOST_PACKED` / `_IN_TRANSIT` / `_AT_STORE` | `lost_*_total` | Inventory |
| MD gives up | `ALLOTMENT_CLOSED_SHORT` | `closed_short_total` | MD |

`ALLOTMENT_PICKED` is **retired**: picking writes an inventory fact and never
names an allotment.

Four rules that bind execution directly:

1. **`handed_over_total` comes from the koli actually put on the shop's floor**,
   never from the manifest. Nine koli unloaded and one still on the lorry means
   the tenth never changed custody and stays `At In Transit`.
2. **One store action.** Handover and receipt are two facts emitted by a single
   `Confirm Receive`; the shop does not type two quantities.
3. **A short receipt opens an Inventory case by itself.** No button.
4. **Damaged goods are received**, then classified into the existing
   `Store Reject` pool. V1 introduces no condition or grade model.

## 2. Picking — physical-first, destination-less, no claim

`Storage → dc.outbound.picking` is the only model. Picking does not read a
destination, consume an allotment, reserve for a Store, or create commitment.

`dc.outbound.picked.{store}` takes **no new writes**, stays readable for legacy,
and is not kept as a manual fallback — a second path would be a second semantics.

Manual and RFID share one ontology; only the quality of evidence differs:

```
Manual: SKU + actual qty  → Picking
RFID:   explicit actual EPCs → Picking
```

**V1 has no claim of any kind** — no `pick_claim`, `pack_claim`, `claimed_qty`,
per-worker reservation, or TTL that reduces need. Distribution publishes
`pick_need_qty` as **guidance**; the picker acts physically and confirms the
actual. Asked for 80, brought 37 → the movement is 37. Guidance recomputes.
Concurrent over-pick is operational inefficiency, not inventory corruption.

`pick_session` may remain for session UI, idempotency and traceability. It must
never reserve stock, reduce `pick_need_qty`, change an allotment, or acquire
claim semantics (`T4`: it has none today).

---

## 3. Intent before, fact after

```
INTENT / CONTEXT   may exist before the act; changes no inventory truth
PHYSICAL ACTION    happens in the world
ACTUAL CONFIRMATION records what actually happened
MOVEMENT           only now does inventory truth change
```

Allotment, "Need More 80", an open koli for Store 07, a created Shipment, a
planned Dispatch with a vehicle — all context, none of them evidence of movement.

---

## 4. Packing, Shipment and Dispatch

```
select Store → open Koli → pack physically → RFID/manual actual → validate → Confirm Pack
```

Atomically at Confirm Pack:

1. the unit is still in `dc.outbound.picking`
2. `state = NORMAL` (`T3`: this *is* "condition eligible"; no grade model exists)
3. the EPC is valid and known
4. the EPC is in no other open koli — already enforced by
   `ux_dc_active_package_epc` (`T2`)
5. the Store still has `to_pack_qty > 0` for that SKU

Only `dc.outbound.picking` is a normal pack source. Removed: `DcPendingUnidentified`,
`DcPendingUntagged`, `DcWarehouse`, `DcRejectDc`, `DcRejectStore`, and anything
in `MISSING`.

`PackKoliRequest { destination_store_id, epcs }` is the canonical RFID pattern;
manual quantity stays the fallback. No pack claim before the act: two packers are
resolved at the atomic Confirm Pack — first transaction wins, the second refreshes
or fails validation.

```
1 Koli = 1 destination Store
1 Shipment = 1 Store = many sealed Koli
1 Dispatch = 1 vehicle departure = many Shipments, possibly many Stores
```

A Shipment may exist as a business container before movement completes, but only
sealed koli actually confirmed into it enter `AT_SHIPMENT`. Creating a Dispatch
moves nothing.

Loading must record which koli/shipments were **actually** loaded, using the
existing `LOADED` stage. `depart_dispatch` must verify it. Expected 11, loaded 10
→ either complete the loading or revise/split the manifest; the eleventh koli
goes back to `AT_SHIPMENT` as an explicit `ALLOTMENT_UNLOADED`, and if it is
missing rather than left behind, it is unshipped and then declared lost at
`AT_PACKED` (`C4`). Depart advances `AT_LOADED → AT_IN_TRANSIT` for actually
loaded contents only.

---

## 5. Stock semantics

`Stock = On Hand + Alloted + Missing` **is no longer a domain invariant.**

```
stock_qty     = normal + missing                       (physical, per pool)
missing_qty   = missing
available_qty = max(eligible_supply − blocking_commitment, 0)
shortfall_qty = max(blocking_commitment − eligible_supply, 0)
```

> `K2` **approved.** `blocking_commitment` is `to_pack_qty`, not
> `to_receive_qty`: goods already packed have physically left the source pool,
> so subtracting what is merely unreceived counts them twice.
>
> ```
> Storage 10,000 · alloted 1,500      → available 10,000 − 1,500 = 8,500 ✓
> after 500 packed: Storage 9,500
>   with to_pack   1,000 → 9,500 − 1,000 =  8,500 ✓
>   with to_receive 1,500 → 9,500 − 1,500 =  8,000 ✗  (the 500 counted twice)
> ```

> `C5` **Both sides must be measured over the same scope.** The supply is every
> pool at that site the commitment can be served out of — Storage *and* the
> Pick Area, because a picker moving goods between them settles nothing about
> who they are for. Subtracting a site-wide `to_pack` from each pool
> separately reports the same shortage three times; subtracting a global
> `to_pack` from one site's supply reports another site's demand as this site's
> shortage. One site, one SKU, one subtraction.

UI keeps `Stock · On Hand · Alloted · Missing`; **On Hand means `available_qty`**,
and it is never negative — the excess becomes `shortfall_qty`. Missing does not
erase Store demand; it raises `shortfall_qty` and an exception until MD supplies a
replacement or closes short.

**Stock tree rule.** The `Alloted` column shows `to_pack_qty`, and only on pools
that can be a source of it. `Picked` (the shared Pick Area) has no Store
attribution, so its `Alloted` is `—`. Pick Area supply and demand live in
**Operations › Distribution › Pick Area** (Storage · Pick Area · To Pack · Need
More · Can Pack Now). After packing, destination is known, so Packed / Shipment /
In Transit can be traced to a Store.

---

## 6. Authorization

A mutating route touched by Distribution V1 must not treat body `actor_id` as
authority.

```
principal → authorization → domain action → audit principal
```

MD owns exactly one domain action: **`allotment.close_short`**. Settling what
happened to goods (`Found` / `Lost`) is an **Inventory** capability, named after
the Inventory architecture — MD does not decide that goods are lost. The Edge
role enum (`Cashier · Supervisor · Admin`) is **not** widened. Until the auth
architecture carries business capabilities, the mapping is a transport detail
only — never a statement that Admin is MD. Destructive routes fail closed.

> `K3` **approved.** `actor_id` cannot simply be dropped from the body: it is
> inside the idempotency digest (`payload_digest(&request)`), so removing it
> changes every digest and breaks replay of in-flight keys. V1: authorize on the
> principal, keep accepting `actor_id`, and **reject with 403 when it disagrees
> with the principal**. It is removed from the contracts in a later step.

---

## 7. Desktop and mobile

Mobile Floor is primary physical execution (Tugas · Terima · Tag · Ambil · Kemas ·
Kirim · …). Desktop Operations is control-first (Overview · Receiving · Tagging ·
Distribution{Overview, Allotments, Pick Area, Packing, Shipments, Dispatch} ·
Returns). **Existing desktop execution actions are kept** as authorized fallback
when a phone or reader is unavailable, and they use the same ontology and the same
endpoint semantics — no second business path.

**The one exception is MD's Allotment screen.** Picking is a Floor/Operations
act, so the drawer's Pick button — the only caller of `executeAllotment` and the
only writer of `ALLOTMENT_PICKED` (`allotments.rs:796`) — is removed with the
event, in step 3. Removing the `Picked` rung from the UI without removing the
action would leave MD able to claim goods it never touched.

---

## 8. The Allotment UI

Frozen in [docs/allotment-v1.md §12](docs/allotment-v1.md), and built last —
after steps 1–9. A change list may be prepared; it may not be merged. A screen
that renames its columns while `picked ≠ packed`, `DC_COMPLETED` is still
terminal and Close Short does not exist looks final over data that is not.

## 9. Implementation order

```
1.  canonical commitment/fulfillment view + vocabulary   ← includes the 4 old formulas (K4)
2.  authorization boundary / principal
3.  retire ALLOTMENT_PICKED + picked.{store} writes + MD's Pick action
4.  restrict Packing source
5.  separate DC milestone from true completion
6.  Confirm Receive + Inventory Found/Lost + Close Short
7.  actual LOADED verification / Dispatch
8.  explicit EPC Picking
9.  Stock projection semantics                           ← available_qty guard pulled into 1
10. UI, last
```

> `K4` **approved.** The frozen order had a hazard: it retired
> `ALLOTMENT_PICKED` (step 3) before replacing the four formulas. But
> `queries.rs:312` derives `allotted` as `SUM(remaining_delta)`, where
> `ALLOTMENT_CREATED` adds and `ALLOTMENT_PICKED` subtracts. Stop emitting the
> subtracting event while that formula still runs and the commitment **never
> releases**: `allotted` grows without bound and `on_hand` goes negative across
> the fleet. The formula replacement lands **before or with** the retirement, so
> it is folded into step 1, and the `max(…, 0)` guard on `available_qty` moves
> into step 1 as cheap insurance for steps 3–8.

No `claim`, task reservation or worker quantity reservation in V1.

---

## 10. Step 1 — exact code paths

| # | Path | Change |
|---|---|---|
| 1 | `backend/src/cloud/domain/commitment.rs` | **done** — 13 counters, 8 buckets, the invariant as a live assert, status incl. `K1`, `Availability`, `can_pack_now`/`pick_need`; 19 tests incl. §6 and an exhaustive walk of every reachable state |
| 1b | `migrations/postgres/0176_…` | landed, and **must be amended before commit** (revision 4): drop `exception_released_quantity`, add `handed_over_quantity`, split the loss counters three ways, rebuild both views without `at_exception` |
| 1c | `migrations/sqlite/0035_…` | landed, same amendment. The CHECK swap needs a table rebuild and lands with step 6 |
| 2 | migration (postgres) | on `allotment_line` and `edge_allotment_line_progress`: `unpacked_quantity`, `unshipped_quantity`, `unloaded_quantity`, `lost_packed_quantity`, `lost_in_transit_quantity`, `exception_released_quantity`, `closed_short_quantity`; CHECKs = the six buckets ≥ 0; views `allotment_line_commitment` + `allotment_commitment` |
| 3 | migration (sqlite) | the same columns on `dc_allotment_work_line`; ladder CHECKs replaced by the bucket CHECKs |
| 4 | `cloud/domain/allotment.rs:126` `remaining_allotted` | **deleted**; callers move to the view |
| 5 | `cloud/domain/allotment.rs:143` `derive_allotment_status` | rewritten onto `FulfillmentStatus` (`K1`) |
| 6 | `cloud/domain/allotment.rs:79` `AllotmentStatus` | three variants + legacy read-mapping (incl. `T6`) |
| 7 | `cloud/postgres/queries.rs:312` `allotted_balance` CTE | **formula 1/4** — reads the view, not `remaining_delta` |
| 8 | `cloud/postgres/queries.rs:1481` reservation CTE | **formula 2/4** — reads the view |
| 9 | `cloud/postgres/queries.rs:1492` availability-by-SKU | **formula 3/4** — reads the view; scope per `C5` |
| 10 | `cloud/postgres/sync.rs:6089` `pick_released` / `remaining_allotted` | **formula 4/4** — a live bug: it subtracts free picks, which neither side does. CTE deleted |
| 11 | `edge/domain/inventory/allotment.rs:124` | same equation; stale doc corrected |
| 12 | `edge/sqlite.rs:2494` pool `allotted` | canonical formula; `planned > normal` guard kept; stale comment corrected |
| 13 | `cloud/postgres/allotments.rs:294` | stubbed `packed/shipment/dispatched: 0` replaced by the view |
| 14 | `edge/outbound.rs:1146` `OutstandingLine` | `wanted → to_pack_qty`, `outstanding → packable_now_qty` |
| 15 | `edge/outbound.rs:1211` `DestinationDemand` | same rename + `pick_need_qty`; additivity fixed (`T1`) |
| 16 | `cloud/domain/inventory.rs:45` `InventoryBalance::project` | `available_qty` guard `max(…,0)` pulled forward (`K4`); invariant demoted |
| 17 | `edge/domain/inventory/balance.rs:47` | same |
| 18 | `backend/tests/contract_types.rs` | renamed contract types must be **named** here or ts-rs writes nothing |
| 19 | `backend/tests/{inventory,full_chain,edge_cloud_sync,reconciliation}_integration.rs` | the invariant and the four replaced formulas |
| 20 | `backend/tests/migration_hygiene.rs` | new migrations |

Out of scope for Step 1: every route change, `ALLOTMENT_PICKED` retirement,
packing source narrowing, Close Short and exception release routes, dispatch
verification, EPC picking, UI.

---

## 11. Step 1 — what landed, and what it now owes

> **Step 1 landed against revision 3 of this file, which carried the old
> model.** Baselines 1.1–1.3 of `docs/allotment-v1.md` then removed
> `AT_EXCEPTION`, made Inventory the resolver, and made custody pass at
> handover. What landed is still right about the four (six) replaced formulas,
> the view-as-single-source rule, the availability scope and the guards; what it
> owes is listed under *Amendments* at the end of this section.

Done and verified: the domain module and its 19 tests, both migrations, the two
views, and every read and write below. `commitment.rs` tests, the allotment
integration test and the reconciliation integration tests are green; the three
worked examples in §6 reconcile in the database as well as in Rust.

### There were six spellings of the commitment, not four

The audit counted four read formulas. Two more were found in the **write**
guards, and they were the ones that decided whether an allotment could be
raised at all:

```
cloud/postgres/allotments.rs  active_allotment_tx        SUM(quantity − picked − cancelled)
cloud/postgres/allotments.rs  edge_active_allotment_tx   SUM(accepted − picked − cancelled) + pending
```

Both released at pick, so two merchandisers could promise the same shirt the
moment a picker touched it. Both now read the view.

### Three consequences that change numbers on screen

1. **A promise binds the shelf when MD makes it.** The old model counted a
   commitment only once the DC had *accepted* the command, so an allotment in
   flight blocked nothing. `original_alloted` is fixed at ACTIVE, and the
   application state is a delivery state (§13). Availability at the centre
   therefore falls at create rather than at acceptance.

2. **On Hand can no longer be negative anywhere.** It clamps at nought on both
   nodes and at the centre, and the excess is `shortfall_qty`. The node used to
   *refuse to list its pools at all* when a promise outran a shelf
   (`EdgeError::Persistence`) — which would have fired on every pick once
   picking stopped discharging a commitment.

3. **Availability and the pool tree now answer different questions, on
   purpose.** The tree is per pool: this shelf, these goods. Allotting is per
   site (`C5`): a promise raised against the warehouse can be packed out of the
   picking area, so both are supply and the commitment is subtracted from the
   pair once. The writer's guard was moved to the same scope as the screen —
   otherwise the matrix offers goods the create route then refuses, which is
   exactly what the first run of the integration test did.

### The as-of read answers `—` rather than a number it cannot stand behind

The centre's event stream holds `ALLOTMENT_CREATED` and the legacy pick and
cancel, and nothing else: packing, shipment, loss and Close Short arrive as a
progress snapshot. So there is no honest historical commitment to compute, and
a time-travelled pool read now reports `allotted` as NULL — the same `—` the
tree already shows for a pool that cannot be a source — instead of a figure
that ignores every carton ever packed. It becomes exact when the fulfillment
events reach the centre (step 6).

### Amendments owed to revision 4

| Owed | Where |
|---|---|
| Delete the `AT_EXCEPTION` stage, the `at_exception` field and the `K1` status clause | `commitment.rs`, both views |
| Replace `exception_released_*` with the three `lost_*` counters draining to `To Pack` | `commitment.rs`, both migrations |
| Add `handed_over_total` and derive `receiving_gap_qty` from it | `commitment.rs`, both migrations, receipt sync path |
| Restate the invariant over seven stages plus the receiving gap | `commitment.rs` tests |

None of it is a schema break in the field: both migrations are uncommitted and
applied to nothing but a scratch database, so they are amended in place rather
than stacked.

### Deferred, with the reason

- **`OutstandingLine` / `DestinationDemand` renames (items 14, 15).** Their
  arithmetic is already `accepted − packed − cancelled`, which is correct; what
  is left is naming, and it touches four Operations screens. It belongs with
  step 4, which opens those screens anyway. The additivity rule (`T1`) is now
  written at the field that invites the mistake, and no caller sums `packable`
  across destinations today.
- **The SQLite CHECK rebuild.** The ladder CHECKs on `dc_allotment_work_line`
  are still true of everything that writes to it. They stop being true when a
  replacement can push `packed` past `accepted`, which is step 6 — and SQLite
  cannot alter a CHECK without rebuilding the table, index by index and trigger
  by trigger.
- **Legacy status values are still written.** `allotment.status` keeps its six
  spellings until step 5; the three canonical ones are derived in
  `allotment_commitment` and read through `FulfillmentStatus::from_legacy`.
  Writers take their value from the fold rather than deriving one of their own.

### Two legacy readings, folded into the view rather than migrated

`cancelled_quantity` reads as `closed_short_total` (`T6`), and a CANCELLED or
REJECTED header reads as giving up the whole remainder. Without the second, a
refused allotment would block stock for ever, because acceptance no longer
gates the commitment.

---

## 12. Open — nothing blocking

- The `dispatched_quantity → loaded_total` column rename waits for the next
  ladder migration; V1 deprecates it semantically only (`T5`).
- Whether a receipt refusal should raise a `RETURN_TO_DC` allotment
  automatically, or wait for MD, is decided with step 6. The arithmetic is the
  same either way: refused goods are `lost_in_transit` against this line.
- The pool tree's `Alloted` column is per pool and the matrix's On Hand is per
  site. Both are right, and a person reading them side by side will ask why
  they differ. The answer belongs on the Pick Area screen (§10), which shows
  the pair explicitly — it is not built yet.
- The 0178 duplicate is **resolved** — the commercial lane moved its file to
  0190, so `sqlx::test` runs again. What stays red is the guard rather than the
  tests: `the_cloud_migration_numbers_run_without_unclaimed_gaps` sees two
  unclaimed holes, **0171–0172** (nobody has claimed them) and **0182–0189**
  (opened by that jump to 0190). Both need a line in `RESERVED`
  (`tests/migration_hygiene.rs`) from the lanes that know why they exist.
- **Do not edit a migration that has already been applied**, even an
  uncommitted one. `0176` was applied to `inventory_scale` at 13:36 and edited
  at 15:27, and the node stopped starting with `Migration(VersionMismatch(176))`
  for every lane using that database. The repair is to drop what the migration
  created and delete its `_sqlx_migrations` row so the next startup applies the
  current file — never to re-stamp the checksum, which leaves the database in
  the old shape while the file describes the new one.
