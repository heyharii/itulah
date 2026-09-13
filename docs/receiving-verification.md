# Receiving — verification and acceptance

**Status:** target model, with the current implementation recorded beside it.
Owner decisions of 2026-09-12 are incorporated, including the correction of the
same date that moved **all accounting out of acceptance**. Code references are
read off `feat/handheld-rfid` at `537739a`.

Vocabulary: [`../CONTEXT.md`](../CONTEXT.md). Before this:
[receiving — count](./receiving-count.md). After this:
[supplier bill](./supplier-bill.md) for the money, and
[inventory — ledger](./inventory-ledger.md) for the goods.

Acceptance is the hinge of the operational chain: the moment goods become
stock, and the first moment the centre hears anything at all. It is **not** an
accounting event, and it is not an approval to pay anybody.

---

## 1. Two verifications, never merged

The word "verify" appears twice in this business and means two different things:

| | **DC verification** | **Finance verification** |
|---|---|---|
| Question | Did we physically receive and accept these goods? | Is the supplier's claim correct and supported? |
| Who | The verifier at the bay, who can see the goods | AP, who can see the invoice, the tax and the terms |
| Evidence | The delivery, the count, the goods themselves | Purchase order + accepted receipts + supplier invoice |
| Produces | An accepted receipt and operational stock | A matched claim, a posted journal, payment readiness |

A verifier at a loading bay cannot judge tax, due dates, invoice allocation or
whether a supplier's total adds up — and should not be asked to, because
nothing they can see answers those questions. So DC verification stops exactly
where physical truth stops.

---

## 2. What acceptance means

> **Verifier Accept** = the company officially accepts the physical quantity
> the checker counted.

One act, five consequences:

1. the checker's quantity is accepted **verbatim** — there is no field for a
   quantity of the verifier's own;
2. an **accepted receipt** is written: immutable evidence naming the delivery,
   the purchase line, the quantity, the checker, the verifier and the moment;
3. the accepted quantity becomes **operational stock**, and the order's
   received and outstanding quantities move with it;
4. goods with no merchandise identity of ours land in the **unidentified**
   pool, awaiting Article Setup;
5. the receipt records the **agreed price that applies to it** and its share of
   the order discount — as reference for Finance's later match, explicitly
   **not** as a posted amount.

And, equally important, five things it does **not** do:

```
NO general-ledger journal
NO supplier payable
NO temporary or suspense payable
NO accrual account of any kind
NO permission to pay anybody
```

Someone who could both approve a delivery and decide what it was would hold the
entire control, which is why (1) has no exception. If the count is wrong, the
verifier refuses it and asks for a recount; they never edit it.

**The verifier is never the checker.** Enforced in code and, independently, by
a database CHECK at both ends. It is not configuration.

### Worked example

```
PO             100 pcs @ Rp100.000
Blind count     98 pcs
Verifier        accepts 98

Accepted receipt        98
Operational stock      +98   → dc-01.pending.unidentified
PO received             98
PO outstanding           2
Expected value     Rp9.800.000   (reference for Finance, not posted)
Accounting journal    NONE
```

---

## 3. Operational stock and booked inventory are different things

After acceptance the goods are **operationally real**: they are in the pools,
in the movement ledger, countable, and they will be tagged and shipped. They
are **not yet in the general ledger**, because the ledger learns about
merchandise when Finance posts a matched bill.

Between acceptance and Finance's posting the two disagree, and that gap is
deliberate:

```
warehouse says:   goods are here since Tuesday
ledger says:      nothing yet — no approved claim exists
```

This is the same position migration `0052` took when it refused to invent a
goods-received-not-invoiced account: there is nowhere honest to put an
obligation the company has not yet validated, and inventing one would put a
line in the client's books their own accountant cannot explain. The gap is
**reported rather than hidden** — accepted receipts with no bill against them
are listed as an exposure with their expected value, in
[supplier bill](./supplier-bill.md) §5. Nothing about period-end close belongs
in this document or in Slice A.

### What the receipt records, and what to call it

| Figure | Meaning | Never call it |
|---|---|---|
| `agreed_unit_price_at_acceptance` | The price that applied to this receipt when it was accepted | the current price |
| expected gross | accepted quantity × that price | payable |
| allocated discount | this receipt's share of the order discount | posted discount |
| expected net | gross − allocated discount | liability, accrual, payable |

The words are the point. Until Finance posts, these are an **expectation**, and
a screen that calls them "payable" invites somebody to pay them.

The snapshot exists so a price amendment approved next month cannot silently
restate what a delivery from last month was worth. **It is never overwritten.**
When a buyer approves a different price for this delivery, that approval is a
separate record naming this receipt line — the approved invoice price and the
difference per unit — and both truths survive:

```
receipt evidence        40 pcs @ 100.000   (what was accepted, immutable)
commercial decision     approved 110.000, +10.000/unit, by whom, when
financially approved    40 × 110.000       (derived by Finance, at match)
```

Finance derives what it will post from the pair, never from a rewritten
receipt. See [purchase order](./purchase-order.md) §3.

---

## 4. When more arrives than was ordered

Physical truth is never falsified, and commercial truth is never invented.

```
Ordered 100 · already accepted 0 · lorry holds 105 · checker writes 105
                 │
   ┌─────────────┴─────────────┐
   │                           │
100 matched to the order    5 excess
   │                           │
ordinary chain              unresolved until Procurement decides
                            no PO match, no expected value, no journal
                            accept commercially, or return to supplier
```

Two ideas kept apart:

- **Where the goods physically are** — a pool. Excess goods get **no pool of
  their own** unless the warehouse genuinely segregates them on the floor. A
  pool that claims a separation nobody performs is a lie about physical truth.
- **What the goods are commercially** — **quantities on the receipt line**, not
  a status over the whole of it: `accepted`, `matched`, `excess`. One receipt
  line of 105 is 100 matched and 5 excess, and everything downstream reads the
  two numbers separately.

Only Procurement can resolve it. Accepting commercially raises the ordered
quantity or records an explicit excess approval, and only then does the excess
join the matched quantity. Returning it takes the goods out again, with a
document.

The same rule covers the second-delivery case: 300 ordered, 300 already
accepted, another 300 arrives — that is 300 excess, not a silent doubling of
what the company expects to pay.

Because they are quantities and not a flag, the gate downstream is
**quantity-scoped**: Article Setup offers the matched 100 immediately and
withholds only the 5. A receipt line is never blocked as a whole because part
of it is unresolved — that would hold up goods the company certainly bought.

---

## 5. What reaches the centre

At acceptance the DC sends: the delivery header and the accepted line, the
movement facts behind the stock, the price snapshot and the discount
allocation, and — if the verifier read a different price off the invoice — a
price amendment request.

The centre **re-validates what the edge already checked**, because a fact
arrives over a wire and the node that sent it may be out of date,
misconfigured, or lying:

- the reporting origin must own the purchase order's destination site;
- the delivery's supplier must be the order's supplier;
- accepted quantity beyond the order's outstanding quantity is an exception,
  not an increase.

Accepted goods with no identity raise a notification to everyone who can act on
it, because merchandise nobody names is merchandise nobody can sell.

---

## 6. As-is — what the code does today

`POST /api/v1/dc/purchase-verifications` → `edge/sqlite.rs:8064`.

**Correct today, and to be preserved:** quantity accepted verbatim; checker ≠
verifier enforced in code and by CHECK; recount writes a new row and preserves
the refused one; one accepted count becomes exactly one receipt line (a CHECK
ties them); the movement into `<site>.pending.unidentified` and the facts are
written in one transaction; replays are safe (`ON CONFLICT DO NOTHING` plus a
unique index on `(movement_group_id, po_line_id)`); the centre raises
`receipt.awaiting_identity` on every genuinely new line (`sync.rs:6381`);
**acceptance posts nothing to the ledger** — which the corrected model keeps.

**Missing or wrong:**

> **Slice A landed on 2026-09-12.** Rows marked **closed** are done in the
> working tree: migration `0178` (Postgres) and `0036` (SQLite), with the edge,
> the ingest and the reads that go with them. Everything else still stands.

| | Gap | Evidence | Fix |
|---|---|---|---|
| **G1** | No price is snapshotted on the receipt; every value is read from the mutable order line, so an approved amendment restates deliveries accepted months ago | `sync.rs:6519`, `sync.rs:7457` | **Closed.** `agreed_unit_price_minor` is written at acceptance, on both sides, and every value figure reads it |
| **G2** | No discount allocation exists; expected value is gross | `sync.rs:6519` | **Closed.** Allocated at ingest by running cumulative value, stored on the receipt line and never recomputed |
| **G3** | Over-receipt is silently accepted and silently expected to be paid | nothing compares accepted to outstanding | **Closed.** `matched_quantity` / `excess_quantity` are written at acceptance and re-derived at the centre; excess carries no expected value and raises its own notification |
| **G4** | The centre does not check that the reporting DC owns the order | `sync.rs:6381` trusts the `po_line_id` in the fact | **Closed.** A receipt whose origin does not stand in the order's destination site is refused |
| **G5** | The centre does not check supplier agreement | same | **Closed.** Refused at the centre as well as at the DC |
| **G6** | `SegregationPolicy::Relaxed` claims to allow one-person receiving; the unconditional CHECK then refuses the write | `edge/sqlite.rs:8147` vs `sqlite/0005` | **Closed.** The policy is gone; two people is not configurable |
| **G7** | The quantity subject is created with `unit_price_minor = 0` and screens say "no price" | accept path in `edge/sqlite.rs` | Carry the purchase price; say "awaiting Article Setup", never "no price" |
| **G9** | The excess has no act that resolves it. `purchase_excess_decision` exists and nothing writes to it, so quantity beyond the order waits for a decision nobody can yet record | migration `0178` | Next: a buyer's route that keeps it (raising the ordered quantity, at an agreed price) or sends it back |
| **G8** | An approved amendment never reaches the DC, so the same query is raised again on the next count | `edge/sync.rs:2174` | **Closed.** Only a `REMAINING` approval moves the DC's copy of the price |

---

## 7. Invariants

### Inventory

- **I1** A count creates no stock; acceptance creates stock.
- **I2** Accepted quantity equals counted quantity, always.
- **I3** Physical excess is never discarded and never silently sold: it is held
  with an unresolved commercial status until Procurement decides.
- **I4** Accepted goods carry supplier identity and purchase economics from the
  moment they exist; only our merchandise identity is missing.
- **I5** Operational stock is the source of physical truth. It does not wait
  for accounting, and accounting does not wait for it.

### Accounting

- **A1** Acceptance posts nothing. No journal, no payable, no accrual, no
  suspense account.
- **A2** The ledger learns about merchandise when Finance posts a **matched**
  bill, and at the amount Finance validated.
- **A3** Between acceptance and that posting, the difference is reported as an
  exposure with an expected value — never as a payable.
- **A4** An unposted expectation is never called a liability on any screen.

### Control

- **C1** Checker ≠ verifier. Not configurable.
- **C2** The verifier accepts or refuses; they never edit the count.
- **C3** A DC may report a price disagreement and may never settle one.
- **C4** Excess is resolved by commercial authority, not by the warehouse.
- **C5** DC verification never grants permission to pay.

### Data integrity

- **D1** An accepted receipt is immutable evidence.
- **D2** One accepted count is exactly one receipt line, and replays create no
  second one.
- **D3** The reporting origin owns the order's destination site — checked at
  the centre, independently of the edge.
- **D4** The delivery's supplier is the order's supplier — checked at both
  ends.
- **D5** The price that applied to a receipt is knowable after the fact,
  whatever the order line says later.

### Implementation notes

Movement `Opening → <site>.pending.unidentified`, cause `Opening`, reference
`PURCHASE_ORDER_LINE`. Facts `goods_receipt.line` and `goods_receipt.invoice`
(`cloud/domain/sync.rs:2118,2121`); amendment request
`purchase.price_amendment.requested` (`:2448`). Cloud pool ids are rewritten
from the site by `pool_id_for_site` (`sync.rs:4581`) because cloud spells its
distribution centre `dc` and an edge DC registers as `dc-01`.

---

## 8. Open decisions

1. **Who resolves excess, and by when.** Recommendation: the buyer who raised
   the order, with unresolved excess ageing on the same screen as overdue
   orders.
2. **What the DC still records about the supplier's invoice.** Recommendation:
   the scan and the supplier's document number as a reference, nothing more —
   Finance owns the structured record.

---

## 9. Tests this document requires

1. acceptance creates stock; a count alone creates none;
2. the same person cannot count and accept;
3. accepted quantity equals counted quantity, always;
4. a refused count survives the recount untouched;
5. acceptance snapshots the applicable agreed price onto the receipt;
6. **acceptance posts no journal and creates no payable of any kind**;
7. a later approved amendment leaves that snapshot unchanged and is recorded
   beside it as a commercial decision;
8. the discount allocated across partial acceptances reconciles exactly to the
   order discount;
9. 105 against an order of 100 records 105 accepted, 100 matched and 5 excess,
   and the expected value covers the matched 100 only;
10. a second full delivery against a filled order creates no matched quantity;
11. Article Setup offers the matched 100 and withholds the 5 excess, rather
    than withholding the whole receipt line;
12. a receipt reported by a DC that does not own the order is rejected at the
    centre;
13. a delivery from supplier A cannot be accepted against supplier B's order;
14. replaying an accepted-receipt fact creates no second receipt line.
