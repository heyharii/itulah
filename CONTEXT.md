# Central — procurement, receiving, stock and supplier settlement

The language this repository uses for buying goods, receiving them at a
distribution centre, holding and moving them, and settling what the supplier is
owed. One word per concept: where the trade has several, the one below is ours
and the rest are listed as things to avoid.

The documents that use this vocabulary live in [`docs/`](./docs):
[supplier](./docs/supplier.md) ·
[the buyer's basket](./docs/sourcing-basket.md) ·
[purchase order](./docs/purchase-order.md) ·
[receiving — count](./docs/receiving-count.md) ·
[receiving — verification](./docs/receiving-verification.md) ·
[product master](./docs/product-master.md) ·
[inventory — ledger](./docs/inventory-ledger.md) ·
[inventory — count](./docs/inventory-count.md) ·
[inventory — fleet](./docs/inventory-fleet.md) ·
[supplier bill](./docs/supplier-bill.md) ·
[finance](./docs/finance.md) ·
[ERPNext sebagai pembanding](./docs/erpnext-reference.md).

The three inventory documents are written in Indonesian, as
[allotment-v1](./docs/allotment-v1.md) and [finance](./docs/finance.md) are; the
terms below stay in English inside them. Finance reaches past this vocabulary —
the ledger, the client's chart of accounts, and which of the three finance
references wins when they disagree are settled there, not here.

## The order

**Supplier**:
One party the company buys from — one counterparty, one record, one identity.
Its code and name are snapshotted onto the documents that name it; the record
itself is never deleted.
_Avoid_: vendor, factory, principal, brand

**Basket**:
What one buyer has picked out and not yet ordered: supplier items and pieces,
belonging to a person rather than to a team or a machine. It commits nothing
and nobody else can see it. A purchase order is raised from one.
_Avoid_: cart, wishlist, draft order — and **the till's basket**, which is a
sale being rung up and shares nothing with this but the noun. At a till the
thing is a **Sale**; "basket" survives there only inside pricing, where it
means sale-wide rather than per line.

**Purchase Order**:
A commercial commitment to buy stated quantities from one supplier, delivered
to one site. It exists from the moment the buyer submits it.
_Avoid_: requisition, draft order, PO request

**Purchase Line**:
One supplier item on a purchase order, in pieces, with the agreed price.
_Avoid_: order item, article line

**Supplier Item**:
Something a supplier sells, in the supplier's own vocabulary and code. It is
not yet merchandise of ours.
_Avoid_: article, product, SKU — all three mean our own identity, which does
not exist until Article Setup

**Close Short**:
A buyer's decision that the outstanding quantity on a line will never arrive.
It records a shortfall; it does not say the goods were unwanted.
_Avoid_: cancel, void, short close

**Price Amendment**:
A request to settle a line at a price other than the one agreed, raised at the
DC by the verifier who is holding the supplier's invoice, decided centrally.
_Avoid_: price change, repricing

## The arrival

**Delivery**:
One physical arrival of goods from a supplier at a site. It exists because a
lorry came, whether or not anything was accepted from it.
_Avoid_: GRN, Goods Receipt Note, goods receipt (as a user-facing word),
shipment, consignment

**Delivery Number**:
The number a site gives a delivery when it arrives. Unique, immutable,
site-scoped, quotable back by the supplier.
_Avoid_: GRN number, receipt number

**Blind Count**:
One person's record of what physically arrived, taken without sight of the
ordered quantity or the agreed price.
_Avoid_: receiving, intake, check-in

**Checker**:
The person who performs the blind count.
_Avoid_: receiver, counter

**Verifier**:
The second person, who accepts or refuses the checker's count. Never the same
person as the checker.
_Avoid_: approver, supervisor

**Accepted Receipt**:
The immutable evidence that a stated quantity was accepted from a delivery
against a purchase line, by a named checker and a named verifier.
_Avoid_: receipt note, GRN line, confirmation

**Excess**:
Physically present quantity beyond what the purchase order can match. Real
goods; not yet commercially ours.
_Avoid_: over-receipt, surplus, overage

**Unidentified**:
Accepted goods that do not yet carry our own merchandise identity. They already
have a supplier, a purchase line, a quantity and a purchase price.
_Avoid_: anonymous, unpriced, unknown stock

## Our own identity

**Article**:
Merchandise as we define it, created during Article Setup. It is never the
supplier's item.
_Avoid_: product, style (when our identity is meant)

**SKU**:
An article in one colour and one size.

**EPC**:
The identifier written to one physical tag, minted centrally, one per unit.

## The stock

**Subject**:
One thing the ledger can count. A `UNIT` is a single physical piece carrying its
own EPC; a `QUANTITY` is a number of pieces not yet told apart.
_Avoid_: item, stock record, inventory line

**Pool**:
A physical stage goods stand in — the DC racks, a store's floor, one store's
reject corner. Named by a canonical id, never by a label.
_Avoid_: location, bin, warehouse (when a pool is meant), status

**Inventory State**:
Whether goods in a pool are there (`on_hand`) or should be and are not
(`missing`). Part of the address, not a flag on a row.
_Avoid_: available, lost (missing is not lost)

**Place**:
The only kind of address a movement may name: a pool in a state, an external
party, or a system counterparty.
_Avoid_: location, position

**Movement**:
One subject going from one place to another. Never edited, never deleted.
_Avoid_: adjustment, transaction, stock change

**Movement Group**:
One human decision, one reason, one idempotency key, however many lines.
_Avoid_: batch, transfer

**Cause**:
Why a movement happened, from a closed list. It decides which places the
movement is allowed to name.
_Avoid_: type, reason (reason is the sentence a person wrote)

**Projection**:
The precomputed current balance. Disposable, rebuildable, never authoritative.
_Avoid_: stock table, on-hand table

**Stock**:
What a pool is physically responsible for: on hand plus missing.
_Avoid_: inventory (too broad), quantity

**On Hand**:
What may still be spent out of a pool. Never negative.
_Avoid_: available (when the commitment side is meant), free stock

**Shortfall**:
By how much promises outrun goods. It exists because On Hand stops at nought.
_Avoid_: negative stock, oversell

**Missing**:
Goods a count said were not where they should be. A work list, not a loss.
_Avoid_: lost, shrinkage, variance

**Observed**:
Distinct EPCs an RFID reader saw in a pool within a time window. Evidence, and
never a ledger quantity.
_Avoid_: counted, scanned stock

## The count

**Official Count**:
A decision that one pool will be checked, with its scope fixed before anyone
starts walking.
_Avoid_: stock take, stock opname (as a record name), cycle count (that is one
kind of it)

**Expected**:
The ledger balance frozen at the moment a count was activated — not at the
moment it was approved.
_Avoid_: system quantity, book stock

**Found**:
What a counter actually saw. Nought is a result, not an absence of one.
_Avoid_: actual, physical

**Shortage** / **Gain**:
Found below expected, and found above it. Approving a count turns the first into
missing and the second into stock.
_Avoid_: variance, discrepancy, adjustment

**Confirmed Lost**:
Someone's statement that missing goods will not come back. It is the only way
goods leave the company without going somewhere.
_Avoid_: written off, shrinkage

**Observation**:
One reader seeing one EPC in one pool over one span of time. It never moves
anything.
_Avoid_: scan, count, sighting (as a record name)

## The fleet

**Site**:
A distribution centre or a shop. The unit that owns stock.
_Avoid_: location, branch

**Inventory Owner**:
The one node entitled to write the ledger for a site. One site, one owner,
enforced by a unique index.
_Avoid_: master, primary

**Fact**:
An immutable movement group a node sends upward, in a sequence that may not have
holes.
_Avoid_: event, sync record

**Checkpoint**:
A node's snapshot of all its pool balances at one instant. It says how fresh our
knowledge is, never how much stock there is.
_Avoid_: snapshot (when the ledger is meant), balance

**Claim**:
Evidence two independent nodes each publish about the same shipment — the DC
that it left, the store that it arrived. Reconciled centrally; never a movement.
_Avoid_: transfer, handover

## The money

**Operational Stock**:
Goods the warehouse holds and can move, count, tag and ship. It exists from the
moment a verifier accepts, and it does not wait for accounting.
_Avoid_: on-hand (when the ledger is meant)

**Expected Value**:
What an accepted receipt is expected to be worth — matched quantity at the
price snapshotted when it was accepted, less its share of the order discount.
An operational estimate and a starting point for Finance's match; nothing is
booked and nothing is owed on it.
_Avoid_: payable, liability, accrual, amount owed

**Exposure**:
Accepted receipts that Finance has not yet matched and posted — whether no
invoice has arrived, one has arrived and is unmatched, or one disagrees. A work
list for AP, not a balance in the ledger.
_Avoid_: GRNI, accrual, unbilled payable, provision

**Financially Approved Value**:
What Finance has validated as correct for an accepted receipt: its evidence
plus any approved commercial decision about it. The figure a posting is made
from.
_Avoid_: expected value (that is the operational estimate), payable

**Supplier Payable**:
What the company owes a supplier, as booked in the ledger. It comes into
existence when Finance posts a matched bill — never at acceptance.
_Avoid_: AP balance, creditor

**Supplier Bill**:
The supplier's demand for payment as Finance records it: number, date, amounts,
tax, due date, and the deliveries it covers.
_Avoid_: invoice (when Finance's document is meant — see below), AP invoice

**Supplier Invoice Document**:
The paper or scan that arrived with the lorry. Evidence, not an accounting
document.
_Avoid_: bill, invoice record

**Match**:
Finance's comparison of purchase order, accepted receipts and supplier bill.
_Avoid_: reconciliation, three-way check (as a screen name)

**Ready to Pay**:
A matched payable that Finance has cleared for payment.
_Avoid_: approved, released

**Payment**:
Settlement of a payable. It never touches receipt evidence.
_Avoid_: disbursement, remittance
