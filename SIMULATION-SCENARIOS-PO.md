# PO scenarios for the retail simulator

**Date:** 2026-09-20
**Status:** scenario proposal (no simulator code yet)
**Companion plan:** `SIMULATION-PLAN.md`

This document turns the purchase-order lane into concrete simulator
scenarios: virtual time, suppliers, demand, and the flows the simulator must
drive through the real HTTP API. It starts at the PO because procurement is
where virtual time, edge ownership, supplier master data, receiving, and
payables meet; a simulation that can run this lane has exercised the hardest
parts of the architecture.

## 1. Scope and truth

The simulator must drive every action through the production API. It may not
write business tables directly. If a flow is impossible today, the scenario
records a product gap; it never works around the system under test.

This document is written against the current backend, not a hypothetical
future one:

- A PO carries `destination_site_id` and `origin_kind` (`DIRECT` or
  `SOURCING`), and its activation command is sent to the origin that owns the
  destination site's inventory.
- `GET /api/v1/purchase-destinations` currently offers both DC and STORE
  destinations, but `inventory_dc_owner_tx` rejects a non-DC owner, and the
  DC edge refuses to open a supplier delivery on a non-DC node. Buying
  directly for a store is therefore a product gap, not a working flow.
- Supplier deliveries are received at a DC. Opening a delivery checks only
  whether the DC holds any PO for that supplier, not whether the specific PO
  has arrived or is still open.
- Payment terms live in `payment_term` and `payment_terms_template`
  (seeded: `COD`, `NET_30`, `ADV50_NET45`, `ADV40_DISPATCH60`). Instalment
  dates are owned by the bill (`supplier_invoice_payment_term`), not by the
  PO, and are computed from the bill's own invoice date.
- Advances can be issued, approved, posted, applied, and settled through
  `/api/v1/finance/advances`.
- Sourcing exposes suppliers, supplier items, and a bounded basket; a catalog
  PO can be raised directly from supplier items with price/name/image,
  division, and tags snapshotted onto the order.

## 2. Virtual time

Procurement is calendar-driven, so the PO lane uses discrete-event virtual
time rather than a fixed wall-clock compression ratio. The simulator advances
time event by event, and the scenario file declares only a wall-time budget:

```toml
[clock]
start = "2026-01-01T00:00:07:00"
days = 365
wall_time_budget = "30m"
```

Recommended modes:

| Mode | Behaviour | One virtual year |
| --- | --- | --- |
| CI acceptance | in-process, event-driven, no sleeping | 10-30 minutes |
| Human demo | 1 virtual day = 2 wall seconds | about 12 minutes |
| Live three-process rig | 1 virtual month = 1 wall minute | about 12 minutes |
| Long soak | 1 virtual month = 1 wall day | 12 wall days |

The fixed `1 month = 1 day` ratio is useful only for the long soak. In-process
runs should not sleep at all; the scheduler jumps to the next event and the
run's speed is bounded by CPU and database work.

Business time is UTC+7 and minute-resolution. Security time (sessions,
lockouts, sync breakers, lease expiry) remains wall-clock time. Background
agents are not driven by their production timers; the simulator calls their
work functions on the virtual calendar.

## 3. Procurement cadence

The baseline scenario uses a weekly buying rhythm with seasonal variation:

| Virtual date | Buyer action |
| --- | --- |
| Monday 09:00 | Review replenishment proposals and open the sourcing basket |
| Monday 14:00 | Raise DC replenishment POs for core suppliers |
| Tuesday 10:00 | Search for new suppliers when a proposal cannot be filled |
| Wednesday 09:00 | Chase overdue POs and short deliveries |
| Thursday 08:00 | Receive scheduled deliveries |
| Friday 16:00 | Match bills and record payments that fall due |
| Month end | Close POs that are fully received, review ageing, decide advances |

For a one-year run this is roughly 52 buying cycles and 12 month-end closes.
Each store keeps its own opening stock and sales profile; the DC pool is
replenished by PO and drained by store allocation, so the buyer has a real
reason to order.

## 4. Suppliers and terms

The scenario needs a deliberately mixed supplier population:

| Supplier persona | Terms | Behaviour |
| --- | --- | --- |
| `TOKO_A` direct shop supplier | COD | Delivers next morning, invoice with the lorry |
| `TOKO_B` direct shop supplier | COD | Occasional damaged cartons and short lines |
| `SUP_CORE` DC replenishment supplier | NET_30 | Reliable, weekly lead time |
| `SUP_SEASONAL` DC supplier | EOM_30-style net terms | Lumpy availability, seasonal prices |
| `SUP_ADVANCE` DC supplier | ADV40_DISPATCH60 or ADV50_NET45 | Requires an advance before dispatch |
| `SUP_NEW` newly onboarded supplier | NET_30 | Unknown to the DC until the first PO syncs |
| `SUP_INACTIVE` deactivated supplier | any | Must be refused for new POs |

The seeded templates are enough for the first scenarios. A later scenario can
add a custom template, but editing terms is not required to exercise the PO
lane. Every PO snapshot carries the supplier code/name, and catalog PO lines
snapshot the supplier item's code, name, image, price, version, division, and
tags, so supplier master changes during the year must not rewrite history.

## 5. Sourcing versus direct purchase

The simulator must exercise both buying modes with different volumes, because
they answer different questions:

- **Catalog PO from sourcing** (`POST /api/v1/purchase-orders/catalog`): the
  primary path. The buyer searches supplier items, builds the sourcing basket,
  then raises a PO from canonical supplier items. This exercises supplier
  master data, basket limits, item status, negotiated prices, divisions, tags,
  and catalogue snapshots.
- **Direct PO** (`POST /api/v1/purchase-orders`): a smaller share of volume,
  for repeat orders agreed outside the catalogue. This exercises the legacy
  free-form article snapshot path.

The target business profile is store-direct heavy: most orders go straight to
the shop that needs the goods, a smaller share replenishes the DC from core
supplier catalogues, and sourcing is used mainly to discover and onboard new
suppliers. Until the store-destination gap is closed, the initial acceptance
profile must invert this out of necessity: about 80 percent catalog POs and 20
percent legacy direct POs, with `store_destination_po` reported as the blocker
preventing the target profile.

The sourcing basket is bounded and per-user. The scenario must test both the
normal flow and the refusal when a basket exceeds its limit.

## 6. Buying for a store

The scenario should attempt to raise a PO with a STORE destination because the
API advertises store destinations. The expected current outcome is a refusal
from inventory ownership resolution: the owner of a store site is not a DC.

This is an intentional red scenario. The API advertising store destinations is
evidence that direct-to-store buying is intended product behaviour, so the gap
should be closed rather than hidden by routing store goods through a DC.

Recommended architecture:

1. Rename the routing rule from "find the DC that owns this site" to "find the
   inventory edge that owns this destination site" (DC or STORE). A store PO
   then activates on the store edge that will receive it.
2. Generalise receiving so a supplier delivery is opened and counted at the
   destination node. The DC keeps its receiving surface; the store gains the
   same document model, role checks, and supplier/order matching rules.
3. Keep DC replenishment and store direct buying as one PO model with
   different destinations, not two parallel procurement systems.
4. Preserve the existing rule that a delivery cannot be received by a node
   that does not own the destination site.

Until one is implemented, the simulator must not fake stock or receive
store-destination POs at a DC. The acceptance report should list
`store_destination_po` as a known product gap, not as a passed flow.

## 7. Unordered deliveries and "bought first, PO later"

The current DC check is supplier-scoped, not PO-scoped. Once a DC holds any PO
for a supplier, a delivery can be opened even when no open PO line covers the
goods. This creates two distinct scenario beats:

1. **Known supplier, no specific PO.** A lorry arrives from a supplier the DC
   has previously ordered from. Opening the delivery succeeds, but every count
   still names a PO line. Goods with no matching line therefore wait until a
   retrospective PO line exists, or are counted as over-delivery against
   another open line; there is no PO-less count today.
2. **Unknown supplier.** A lorry arrives from a supplier with no PO at this
   DC. Opening the delivery is refused.

The buyer's "bought first, PO later" flow is therefore only partially
supported today: the delivery document can be opened for a supplier with prior
history at the DC, but the goods cannot be counted until a PO line exists. A
new supplier is refused outright. The scenario must record both outcomes and
keep the unmatched-line behaviour visible. If the intended product rule is that
every accepted line must eventually match a PO, the scenario should leave the
receipt open until a retrospective PO arrives or explicitly close it short; it
must not silently reclassify unmatched goods.

## 8. Scenario outline

### 8.1 Smoke: one week, one supplier

Duration: 7 virtual days.

1. Bootstrap one DC, one store, one active supplier with three supplier items.
2. Monday: create a catalog PO for the DC, quantity based on opening stock.
3. Sync until the DC holds the activation command.
4. Wednesday: open a goods receipt for the supplier, count all lines accepted.
5. Sync until the receipt facts reach cloud.
6. Friday: record the supplier bill, match it to the delivery, post it, pay it.
7. Verify PO status, stock increase, payable movement, and cash movement.

Exit criteria: all actions return their expected status; no simulator SQL
writes; two runs with the same seed produce identical intent logs.

### 8.2 Acceptance: 30 virtual days, mixed procurement

Duration: 30 virtual days.

- Four buying cycles with `SUP_CORE`, `SUP_SEASONAL`, and one direct-order
  supplier.
- One advance-requiring supplier: issue, approve, post, and later apply the
  advance against a bill.
- One short delivery and one rejected delivery.
- One invoice-price mismatch that is accepted within tolerance and one that
  must be corrected before matching.
- One bill with instalment terms; verify due dates are recomputed from the
  bill date, not the PO date.
- Month-end: close fully received POs, run payables ageing, pay due bills.

Exit criteria: every invariant passes at a sync-quiescent point; the run
report names every product gap separately from failures.

### 8.3 Soak: one virtual year

Duration: 365 virtual days, 12 month-end closes, about 52 buying cycles.

- Seasonal demand multipliers per store and article family.
- Supplier price changes and catalogue version changes mid-year.
- One supplier deactivated in month 4; existing open POs and bills must remain
  readable, while new POs are refused.
- One new supplier onboarded in month 6 and ordered from in month 7.
- Advance supplier cycles repeated with different instalment templates.
- Payables ageing observed at every month end; overdue buckets must reflect
  virtual dates, never wall-clock dates.

Exit criteria: no time drift between the simulator world model and backend
business reports; every failed expectation carries the request and response.

### 8.4 Chaos: receiving and payables

- Cloud partitioned while a DC receives a delivery; receiving must continue
  offline and sync later.
- Duplicate delivery facts after reconnection.
- Retrospective PO arrives after goods receipt (known supplier case).
- Supplier invoice arrives before delivery valuation.
- Payment attempted before bill posting; expected refusal.
- Advance settlement attempted before application; expected refusal.

## 9. Invariants

Procurement-specific checks, all evaluated run-scoped:

- A PO activation command exists for every issued PO, addressed to the origin
  that owns the destination site.
- Ordered, received, rejected, and closed-short quantities reconcile per PO
  line; a line closes only when accepted plus rejected equals ordered.
- A catalog PO's lines snapshot the supplier item version, negotiated price,
  division, and tags that existed when the order was raised.
- Every accepted delivery line valued in the ledger appears in the supplier
  suspend balance until its bill posts.
- Every posted merchandise bill's lines match accepted receipt lines by
  supplier and site.
- Bill instalments sum to the bill total, and each instalment date follows the
  term basis from the bill's invoice date.
- Advances, applications, settlements, and payments never over-apply a bill or
  advance.
- Payables ageing uses virtual business dates and the earliest unpaid
  instalment, not wall-clock time or posting date alone.

## 10. Architecture implications

The PO lane confirms the planned architecture and adds five requirements:

1. **A procurement calendar actor.** The buyer persona must be calendar-driven
   (weekly cycle, monthly close), not a fixed request-rate load generator.
2. **A supplier actor.** It decides lead time, fulfilment rate, damaged
   cartons, invoice timing, and terms behaviour. It must remain a fake outside
   the backend, issuing deliveries and bills through the API.
3. **Product-gap reporting.** Store-destination POs and retrospective buys are
   real product questions. The run result needs a `product_gaps` section so a
   missing flow is visible without failing unrelated acceptance criteria.
4. **Destination-aware routing and receiving.** The backend must route a PO to
   the inventory edge that owns its destination and let that edge receive the
   supplier delivery. This is the prerequisite for the target store-direct
   buying profile.
5. **Bill-time terms engine in the world model.** The simulator's expected
   payable schedule must be recomputed from bill dates, mirroring the backend's
   rule that instalments are owned by the bill, not the PO.

These scenarios do not require a second simulator architecture. They fit the
planned `crates/sim` design: personas, discrete-event virtual time, API-only
actions, run isolation, and event logs as the source of truth.
