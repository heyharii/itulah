# Receiving — the delivery and the blind count

**Status:** target model, with the current implementation recorded beside it.
Owner decisions of 2026-09-12 are incorporated. Code references are read off
`feat/handheld-rfid` at `537739a`.

Vocabulary: [`../CONTEXT.md`](../CONTEXT.md). Before this:
[purchase order](./purchase-order.md). After this:
[receiving — verification](./receiving-verification.md).

This is the loading bay: a lorry arrives and one person writes down what is on
it. Nothing here becomes stock, nothing here reaches the centre, and nothing
here is a commercial statement.

---

## 1. The delivery

**Target.**

> A **Delivery** is a physical arrival of goods from a supplier at a site.

It exists because a lorry came. It does **not** mean we accepted anything. A
truckload of soaked cartons that is turned away at the gate is a Delivery whose
accepted quantity is zero — and that record is the only way anyone can ever say
"this supplier sent damaged goods three times".

```
ARRIVED ──▶ counting and accepting ──▶ COMPLETED
    │
    └── nothing accepted, turned away ──▶ REJECTED (reason + evidence required)
```

A delivery carries:

- the **supplier** — and it must be a supplier this site is actually expecting
  goods from, i.e. one named on a purchase order resident here;
- **when it physically arrived**, as opposed to when anyone typed it in;
- **who opened it**;
- its **delivery number**;
- any **document that came with the goods** — the supplier's invoice or packing
  note, as a scan. Evidence, not accounting (see
  [supplier bill](./supplier-bill.md));
- when rejected: the **reason** and whatever was photographed.

One delivery may serve several purchase orders of the **same** supplier: a
lorry that brings four articles against three orders is the ordinary case, and
that is exactly why the delivery is a document of its own rather than a
property of an order.

### The delivery number

Unique, immutable, site-scoped, quotable back by a supplier, and generated
**while the network is down** — a loading bay cannot wait for the centre.
Sequential is desirable; a legitimate gap is not a defect and must never be
repaired by rewriting a number somebody already quoted.

**As-is.**

- Opened with `POST /api/v1/dc/goods-receipts` (`edge/sqlite.rs:7456`); the
  supplier is **free text typed by the operator** and nothing checks it against
  anything. The DC holds no supplier master at all — the only supplier names it
  knows are the ones on the orders it was given. → **G1**
- The number is `GRN-<site>-<000001>` from a single-row counter inside the same
  transaction, so a rolled-back delivery returns its number and the sequence
  stays gapless at no cost to reliability. The prefix is user-facing, and the
  word GRN is not ours. → **G2**
- `status` allows `OPEN` and `CLOSED`; **nothing ever writes `CLOSED`**, and
  there is no `REJECTED` at all. The list of deliveries "still being worked"
  therefore only grows. → **G3**, **G4**
- The invoice number, date and total are keyed in at the bay
  (`edge/sqlite.rs:7567`) and travel up as `goods_receipt.invoice`. The owner's
  decision is that this is Finance's data and the bay should mostly capture the
  **document**, not retype its figures. → **G5**

---

## 2. The work list

**Target.** A checker's list shows the lines this site still owes a delivery
against: supplier item name, picture, which order it belongs to. It does
**not** show the ordered quantity and it does **not** show the price.

A line with nothing outstanding leaves the list. A line closed short leaves the
list. The list is work, not history.

**As-is.** `GET /api/v1/dc/purchase-orders` (`edge/sqlite.rs:7174`) correctly
withholds the ordered quantity and the price — a count taken while looking at
the number it is meant to produce is not evidence of anything — but its query
has **no `WHERE` clause at all**: every line of every order ever activated
stays on the list forever, finished or not, and the screens show "N in" beside
them rather than removing them. → **G6**

---

## 3. The blind count

**Target.**

> A **Blind Count** is one person's record of what physically arrived, taken
> without sight of the ordered quantity or the agreed price.

The checker records **physical truth**. If the order says 100 and the lorry
holds 105, the checker writes **105**. The system never asks anyone to write
down a number they did not count, and the excess is a commercial problem to be
settled later — never a reason to falsify the count. What happens to those 5
pieces is decided at verification and is described in
[receiving — verification](./receiving-verification.md) §4.

A count:

- names one purchase line and one delivery;
- is refused if the purchase line belongs to an order of a **different
  supplier** than the delivery;
- is refused if the delivery is no longer open;
- **creates no stock, posts no movement, and tells the centre nothing.** The
  goods are on the bay: physically present, not yet anything the company holds.

A **recount** does not rewrite the refused count. The refused count stays as
evidence, with the verifier's reason on it, and the checker's new count is a
new record.

**As-is.** `POST /api/v1/dc/purchase-counts` (`edge/sqlite.rs:7276`) behaves as
described, except that nothing compares the delivery's supplier with the order's
(**G7**), and the "delivery is closed" refusal is unreachable because nothing
closes a delivery (**G3**). Counts are idempotent on a client key, and the same
key with a different body is refused rather than quietly answered.

---

## 4. Invariants

### Inventory

- **I1** A count creates no stock. Goods on the bay are not goods in the
  warehouse.
- **I2** A physical count is never adjusted to match a document. Whatever was
  on the lorry is what is written down.

### Control

- **C1** The checker cannot see the ordered quantity or the agreed price while
  counting.
- **C2** The checker never accepts their own count; acceptance is a second
  person's act (see [verification](./receiving-verification.md)).
- **C3** A refused count is never overwritten. A recount is new evidence
  alongside it.

### Data integrity

- **D1** A delivery's supplier equals the supplier of every order it is counted
  against. → **G7**
- **D2** A delivery number is unique per site, immutable, and generated
  offline.
- **D3** A count names a purchase line this site actually holds; a DC cannot
  count against an order it was never given.
- **D4** Every write on the bay is idempotent, and a reused key with a
  different body is refused.

### Implementation notes

SQLite at the DC, schema in `backend/migrations/sqlite/0005_edge_purchase_orders.sql`.
Routes `edge/http.rs:210-231`, all behind `EdgePermission::DcOperate`.
The counter table `goods_receipt_counter` holds one row per node.

---

## 5. Gap list

> **Slice A landed on 2026-09-12.** Rows marked **closed** are done in the
> working tree: migration `0178` (Postgres) and `0036` (SQLite), with the edge,
> the ingest and the reads that go with them. Everything else still stands.

| | Gap | Evidence | Fix |
|---|---|---|---|
| **G1** | A delivery's supplier is typed freely and validated against nothing | `edge/sqlite.rs:7456` | **Closed.** A delivery can only be opened for a supplier this DC holds an order from. The canonical-uuid question is still open — see [purchase order](./purchase-order.md) |
| **G2** | The number a supplier quotes back says "GRN" | `edge/sqlite.rs:7502` | Rename the prefix while the estate is pre-production (decision §6.1) |
| **G3** | No delivery is ever *completed* | no writer for `COMPLETED` | **Open.** `REJECTED` now exists and is written; finishing a lorry that was partly accepted still has no act behind it |
| **G4** | A rejected delivery cannot be recorded at all | schema has no `REJECTED` | **Closed.** `POST /api/v1/dc/goods-receipts/{id}/reject` with a reason, refused once anything on it has been accepted, and it travels up as `goods_receipt.rejected` |
| **G5** | The bay retypes invoice figures Finance will type again | `edge/sqlite.rs:7567` | Keep the scan and the reference; leave the figures to Finance |
| **G6** | The work list never sheds a finished line | `edge/sqlite.rs:7174` | **Closed.** The query keeps only lines with quantity still outstanding, counted from what MATCHED |
| **G7** | Supplier A's delivery can be counted against supplier B's order | `count_purchase_impl` validates only that the line exists | **Closed** at both ends: the DC refuses the count, and the centre refuses the fact |

---

## 6. Open decisions

1. **The number prefix.** The owner has said not to rename internal
   identifiers merely to drop the word GRN. This one is not internal: it is
   printed, quoted by suppliers and read aloud on the telephone.
   Recommendation: switch to `DLV-<site>-NNNNNN` now, while no supplier holds a
   number from this system; existing rows keep the string they were minted
   with.
2. **How a delivery ends.** Automatically, when every count on it is accepted
   or refused? Or explicitly, by the verifier saying "this lorry is finished"?
   Recommendation: explicit — a lorry is finished when a person says so, and
   the document is what the supplier's driver is handed.
3. **What the bay still records about the invoice.** Recommendation: the scan,
   plus the supplier's document number as a reference so Finance can find it.
   Nothing else.
