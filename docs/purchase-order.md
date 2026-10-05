# Purchase order

**Status:** target model, with the current implementation recorded beside it.
Owner decisions of 2026-09-12 are incorporated. Code references are read off
`feat/handheld-rfid` at `537739a`.

Vocabulary is fixed in [`../CONTEXT.md`](../CONTEXT.md). This document covers
the order itself. The rest of the chain:

| Stage | Document |
|---|---|
| A lorry arrives, one person counts | [receiving — count](./receiving-count.md) |
| The count is accepted, operational stock exists | [receiving — verification](./receiving-verification.md) |
| Finance matches the bill, books it and pays | [supplier bill](./supplier-bill.md) |
| Goods get our own identity | `tagging` (not yet written) |
| Goods reach the shops | [`../DISTRIBUTION-V1-FREEZE.md`](../DISTRIBUTION-V1-FREEZE.md) |

Sections marked **Target** are the rules to build to. Sections marked
**As-is** describe today's code and are true until the gap beside them is
closed. §8 is the full gap list; §9 is what the owner has still to decide.

---

## 1. What a purchase order is

**Target.**

A purchase order is a commercial commitment: stated quantities of stated
supplier items, at agreed prices, from **one supplier**, delivered to **one
site**. It is raised centrally. A distribution centre never raises one.

It exists from the moment the buyer submits it. **There is no draft.** A
commitment that has not been made is not a document; it is a basket
(`sourcing-basket`), and the basket already exists.

### Lifecycle

Derived from the evidence, never a field somebody sets:

```
ACTIVE ──────────────▶ PARTIALLY_RECEIVED ──────────▶ FULLY_RECEIVED
   │                          │
   │                          └── Close Short ──▶ CLOSED
   └── every line closed short ─────────────────▶ CLOSED
```

- **ACTIVE** — nothing accepted yet.
- **PARTIALLY_RECEIVED** — some accepted, some outstanding.
- **FULLY_RECEIVED** — nothing outstanding on any line.
- **CLOSED** — every line has stopped waiting, whether filled or closed short.

**Overdue is attention, not a state.** An order whose earliest promised date
has passed with quantity outstanding is reported in ageing bands (1–30, 31–60,
61–90, 90+ days late). **Nothing closes itself with age.** Only someone with
commercial authority may decide the rest is never coming, and that decision is
Close Short.

`purchase.order.activate` is how the order reaches the DC. It is transport, not
a lifecycle state, and no screen should show it as one.

**As-is.** Status is stored (`purchase_order.order_status`) and takes only two
reachable values: `ISSUED` on creation, `CLOSED` when every line has been
closed short (`sync.rs:7628`). A fully received order stays `ISSUED` forever;
`DRAFT` and `CANCELLED` have no writer. `fully_received` is derived correctly
on the detail read (`sync.rs:6519`) and carries the whole truth today. → **G1**

---

## 2. Raising an order

**Target.** One path: from the supplier catalogue. It knows the supplier, the
items, the catalogue price and the classification, so an order raised from it
cannot name a supplier item that does not exist.

What the order records at that moment, and never rewrites afterwards:

- **the agreed price** per line — what we will pay, which may differ from the
  catalogue's asking price;
- **the catalogue's own price, name and image** as a snapshot — so the
  difference between what was offered and what was agreed remains legible;
- **the order-level discount**, as money, negotiated once for the whole order;
- **the promised date**, the classification (division, tags) and the notes.

Nothing here flows back to the catalogue: a price agreed for one order is not a
new list price, and a name corrected on one order is not a rename.

**As-is.** Two paths exist and both are live:

| | Catalogue | Free-hand |
|---|---|---|
| Route | `POST /api/v1/purchase-orders/catalog` | `POST /api/v1/purchase-orders` |
| Code | `suppliers.rs:1968` | `sync.rs:6186` |
| Supplier | validated, must be active | free text |
| Items | validated, must belong to the supplier, must be active, IDR only | free text |
| Idempotent | yes | **no** |
| Snapshots | catalogue code, name, image, price, version | none |
| Discount | yes | **no** |
| Used by | `frontend-hub-2` composer | nothing | → **G2**

Both resolve the destination through `inventory_dc_owner_tx`: exactly one
registered, inventory-enabled node must own the site, or the order is refused
at the desk. Both then issue `purchase.order.activate` to that node inside the
same transaction as the order, and stamp `activation_command_id` on it.

### The order number

**Target.** Unique, immutable, allocated by the server. A buyer must not be
offered a number that another buyer is about to take.

**As-is.** Suggested **in the browser**: `nextPoNumber`
(`frontend-hub-2/src/modules/procurement/labels.ts:129`) reads the highest
`-NNNN` tail in the rows it happens to hold and adds one, giving
`PO-YYYYMMDD-NNNN`. Nothing reserves it; a collision is refused by the UNIQUE
index and the buyer tries again. Worse, `frontend-hub-2` reads the wrong
envelope (§8, **G3**), so the list it scans is always empty and the suggestion
is always `-0001`. → **G3**, **G4**

---

## 3. Price, and disagreeing about it

**Target.**

The agreed price travels to the DC with the order, because the verifier is
asked to compare it against the supplier's invoice and cannot check a match
against a number they are not allowed to see.

A **price amendment** is raised by the verifier at acceptance and decided by
the buyer. It belongs to the **delivery that produced it**, not to the order
line in general:

```
PO 100 pcs @ 100.000
├── Delivery 1: 40 accepted, valued 40 × 100.000 = 4.000.000
│     invoice says 110.000 → amendment raised
│     buyer approves → a commercial decision is recorded against THIS receipt
│     line: approved invoice price 110.000, difference +10.000 per unit
│     the receipt's own snapshot stays 40 @ 100.000, untouched, forever
└── Delivery 2: 60 accepted, still 100.000
      unless the buyer separately chose to reprice the remaining quantity
```

Two distinct buyer actions, two distinct audit trails:

1. **Approve for this delivery only** — records a commercial decision against
   that receipt line. Default. The receipt's evidence is never edited; Finance
   derives the financially approved value from the evidence plus the decision.
2. **Approve and update the remaining quantity** — additionally changes the
   agreed price for quantity not yet received. Never touches receipts already
   accepted.

A refused amendment changes nothing and stays on the record: a supplier who
repeatedly bills above the agreed price leaves a trail there and nowhere else.

**As-is.** Approval rewrites `purchase_order_line.unit_price_minor` and
`line_amount_minor` (`sync.rs:7457`), and every value figure is computed from
that mutable price at read time (`sync.rs:6519`). So approving a new price
silently restates what deliveries accepted months ago were worth, and there is
no record of the approval because the rewrite *is* the record. The DC's copy of the price is never
updated either, so the next count on that line raises the same query again
(`edge/sync.rs:2174`). → **G5**, **G6**

---

## 4. The discount

**Target.** The discount is agreed once for the whole order and invoiced once,
so it is stored once, as money, on the order — not spread across lines by a
rate that will not add back up.

But a partial delivery must still be valued net, so the discount is
**allocated** to accepted quantity when it is accepted:

- allocation is by line value: a line's share of the discount is proportional
  to `accepted quantity × agreed price` over the order's gross value;
- the largest-remainder rule settles the last rupiah, so
  **Σ allocated = the order discount, exactly**, with no rounding residue;
- an allocation, once written against an accepted receipt, is never
  recomputed. A later acceptance allocates only what is left.

Each accepted receipt therefore carries: gross accepted value, allocated
discount, **expected net value**. The order carries: discount total, discount
allocated so far, discount remaining. All of it is reference for Finance's
match — none of it is posted (see
[receiving — verification](./receiving-verification.md) §3).

**As-is.** `discount_minor` exists on the order (`0044`) and appears only in
`net_minor` on the order-level read. Every receipt-derived figure — today
called `payable_minor`, which is itself the wrong word for something nobody has
validated — is `received × unit_price`, gross. Nothing allocates. → **G7**

---

## 5. What the order reports

**Target and as-is agree here**, and this is the part worth protecting.

There is **no received-quantity column anywhere**. Every read sums the accepted
receipts. A stored counter and the facts behind it drift, and when they do
nobody can say which one lied.

Per line: ordered, expected (`ordered − cancelled`), received, outstanding,
shortfall if closed short, agreed price, ordered value. Per order: gross,
discount, net, expected arrival (earliest promised date of its lines),
fully-received.

The order book (`GET /api/v1/purchase-orders`, `sync.rs:6871`) is keyset-paged
and returns `rows`, `next_cursor`, `total` and `facets` over status and
supplier. Search is one box across PO number, supplier name and supplier code.

---

## 6. Ending a line

**Target.** Close Short is the buyer's statement that the rest is not coming.
It records who accepted the shortfall, why, and how much — frozen at that
moment, never recomputed. Only the centre may do it: a warehouse that could
close its own outstanding lines would be marking the company's purchases
complete on the strength of what turned up at its door.

Close Short is **not** cancellation. Cancelling says the goods were never
wanted; closing short says they were wanted and never came. Folding them
together destroys the only evidence that a supplier under-delivers.

**As-is.** Implemented as described (`sync.rs:7563`), and it is the only writer
of `CLOSED`. `cancelled_quantity` appears in four formulas and has no writer at
all. → **G8**

---

## 7. Invariants

### Business

- **B1** An order names one supplier and one destination site.
- **B2** An order exists from submission. There is no draft.
- **B3** Ordered, physically counted, accepted, invoiced and paid are five
  different quantities and are never collapsed into one.
- **B4** Received quantity is derived from accepted receipts, never stored.
- **B5** Close Short is not cancellation, and only commercial authority may
  decide it.
- **B6** No order closes itself with age; lateness is attention, not a state.

### Control

- **C1** The agreed price may be changed only by the person who owns the order.
  A DC may report a disagreement and never settle one.
- **C2** An amendment applies to the delivery that raised it unless the buyer
  explicitly extends it to the remaining quantity, and each choice leaves its
  own trail.
- **C3** Commercial information — supplier prices, order values, terms,
  amendments — is not readable by every signed-in user. → **G9**

### Data integrity

- **D1** One purchase line belongs to exactly one order; its agreed price at a
  given moment is knowable after the fact.
- **D2** An order number is unique and immutable.
- **D3** Raising an order and telling its DC are one transaction: an order
  nobody was told about and a command about an order that rolled back are each
  incoherent alone.

### Implementation notes

Command `purchase.order.activate` (`cloud/domain/sync.rs:2114`) carries the
order to the one origin that owns the destination site; re-sending is a no-op
(`edge/sync.rs:2090`). A DC refuses an order addressed to another site or to a
non-DC node — it checks its own identity from `node_metadata`, never the
payload. The payload carries division and tags; the edge has no columns for
them and drops them (**G10**).

---

## 8. Gap list — where today's code differs from the target

> **Slice A landed on 2026-09-12.** Rows marked **closed** are done in the
> working tree: migration `0178` (Postgres) and `0036` (SQLite), with the edge,
> the ingest and the reads that go with them. Everything else still stands.

| | Gap | Evidence | Fix |
|---|---|---|---|
| **G1** | A fully received order stays `ISSUED`; `CANCELLED` unreachable | `sync.rs:7628` is the only status writer | **Closed.** `lifecycle` is derived on the book and the detail — `ACTIVE`, `PARTIALLY_RECEIVED`, `FULLY_RECEIVED`, `CLOSED` — and the status facet counts it. `order_status` still exists and nothing draws it |
| **G2** | Two raise paths; the free-hand one has no idempotency, no snapshots, no discount | `sync.rs:6186` | Retire it, or bring it up to the catalogue path's guarantees |
| **G3** | `frontend-hub-2` reads `items`; the endpoint returns `rows` | `modules/procurement/wire.ts:83` vs `sync.rs:6772` | **Closed** in that module's wire, reads and screens, though hub-2 is not the app being taken forward. `frontend-hub` was always correct |
| **G4** | PO number suggested by the browser, never reserved | `labels.ts:129` | Allocate server-side, or accept and document the retry |
| **G5** | Approving an amendment restates the value of receipts already accepted | `sync.rs:7457` + `sync.rs:6519` | **Closed.** The acceptance carries `agreed_unit_price_minor`; an approval records `approved_unit_price_minor` + `scope` against the receipt line it answers, and only `REMAINING` touches the order |
| **G6** | An approved price never reaches the DC | `edge/sync.rs:2174` | **Closed.** The decision carries its reach; a `REMAINING` approval updates the DC's copy of the line, a `DELIVERY` one deliberately does not |
| **G7** | The order discount is absent from every receipt-derived figure, and those figures are labelled "payable" | `sync.rs:6519` | **Closed.** Allocated at ingest by running cumulative value and stored on the receipt line; `payable_minor` is now `expected_value_minor` everywhere |
| **G8** | `cancelled_quantity` is dead arithmetic | four call sites, no writer | Remove it, or give cancellation a route |
| **G9** | Any signed-in CASHIER can read the order book and its prices | `cloud/domain/auth.rs` `required_role` | **Closed.** `/purchase-*`, `/suppliers`, `/supplier-items` and `/sourcing-basket` are SUPERVISOR, reads included |
| **G10** | Division and tags are dropped at the DC | `edge/sync.rs:2090` | Carry them, or stop sending them |

---

## 9. Open decisions

0. **How a buyer resolves excess.** Slice A records it — `matched_quantity`,
   `excess_quantity`, a notification, and a `purchase_excess_decision` table —
   and stops short of the act itself. Keeping the goods should raise the
   ordered quantity at an agreed price; returning them needs a document. Which
   screen owns that decision, and may a buyer resolve part of it?
1. **Order-number allocation** — server-side counter, or keep the browser's
   suggestion and live with the retry? A counter is small; the question is
   whether buyers ever collide in practice.
2. **The free-hand raise path** — retire it now, or keep it for orders against
   suppliers not in the catalogue?
3. **Amendment reach** — when a buyer chooses "update the remaining quantity",
   does the order-level discount re-allocate over the new value, or stay as
   agreed in money terms? (Recommendation: money stands; the discount was
   negotiated as an amount.)

---

## 10. Tests this document requires

Beyond the twelve already in `backend/tests/purchase_order_integration.rs`:

1. a submitted order has no draft state and reads `ACTIVE`;
2. partial acceptance reads `PARTIALLY_RECEIVED`;
3. full acceptance reads `FULLY_RECEIVED` without anyone closing it;
4. Close Short resolves the outstanding quantity and keeps the shortfall;
5. an order past its promised date with quantity outstanding appears in the
   overdue bands, and nothing closes it;
6. an approved amendment leaves an earlier accepted receipt's snapshot
   unchanged and records the approval beside it;
7. "approve and update remaining quantity" changes only unreceived quantity;
8. the discount allocated across partial acceptances sums exactly to the order
   discount;
9. a CASHIER cannot read the order book.
