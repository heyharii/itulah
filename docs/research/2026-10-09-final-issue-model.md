# Final model: problems in the goods flow (9 Oct 2026)

> **Superseded in part (Hari, 9 Oct 2026 night):** Inventory solves an inventory issue on its own
> (Found / Lost). MD is not told and is not offered a new allotment; no cause of loss, no
> "Ask Operations for evidence", no "Confirm and send to MD". On a PO, no "Count again as
> evidence" / "Report a difference" after acceptance. Rules 1, 2 (MD = movement only) and 4 stand.


Decided with Hari in chat on 9 Oct 2026. Prototype: `inventory-issues-prototype.html`
(repo root, http://localhost:5397). Outbound build: `2026-10-09-outbound-cancel-edit-build.md`.

## Four rules

1. **A blind count never blocks.** The delivery is **Completed**, or **Completed · issue**
   when something differs. The marker clears when the case is resolved.
2. **Three decisions, three owners.** MD decides where goods go. Inventory decides whether
   they exist. Operations decides whether its own physical work can continue.
3. **One owner per problem at a time, MD last.** Notice order is fixed (see the routes).
4. **Nothing is reopened.** A correction is a new document: a new allotment, a Return to HO,
   a Return PO. Never a top-up, never a revived demand.

## Who decides what

| | Decides | Never |
|---|---|---|
| MD | Where goods go: allot, edit, cancel, a new allotment after a Lost, Return to HO, another store | Whether stock exists |
| Inventory | Whether it exists: Found or Lost (with a cause), the write-off; confirms wrong or extra pieces are not stock and sends them to MD | Moves goods, raises documents for them |
| Operations | Whether its work can continue ("cannot continue" with a reason); answers evidence asks ("check the carton"); counts at the DC | Lost, Missing, or where goods go |

## Routes: DC to store (before the store counts)

| Problem | First told | Resolved by | Ends with |
|---|---|---|---|
| MD edits or cancels after pick or pack | Operations | Operations: Move back | MD sees it at once |
| Short pick, stock reason | Inventory | Inventory: Found or Lost | MD after a Lost: Close remaining, or a new allotment |
| Short pick, label, equipment, other | Operations | Operations | MD sees what is still needed |
| Wrong carton content, found before it leaves | Operations | Operations: Move back, repack | no notice |
| Lost inside a carton before it leaves | Inventory | Inventory: Found or Lost | MD after a Lost |
| Late or lost on the road | Inventory | Inventory: Found or Lost, cause In transit | MD after a Lost |

A carton In transit cannot be moved back or cancelled; what is wrong with it is found at the count.

## Routes: received

| Problem | First told | Resolved by | Ends with |
|---|---|---|---|
| Matches | nobody | nobody | Completed |
| Fewer than sent | Operations and Inventory | Operations checks the carton or recounts; Inventory: Found or Lost | MD after a Lost: the allotment closes at what was received, MD is offered a new one |
| More than sent, or a SKU not on the document | Operations and Inventory | Inventory confirms not stock | MD decides: Return to HO or another store |
| Not as Ordered (store: not confirmed) | Operations and Inventory | Inventory confirms not stock | MD decides (the PO owner for a PO) |
| A store return arrives at the DC with a difference | Operations and Inventory | Operations counts and inspects; Inventory decides | MD who asked for the return |

## Who answers for it

The count: the counter, and their head. The case on time: one named Inventory owner, over 30 days
turns red. The cause of a loss: the party it names (DC packing, In transit, Store, Unknown),
custody passes to the store at the door. The write-off: Inventory, Finance only sees the journal.
The new allotment: MD.

## Still to confirm with Hari

1. At the DC, does the PO creator's Review Count stay as the gate before stock is booked, or is
   it replaced by "Operations and Inventory told, then MD"?
2. For a PO, who is told last: MD or the PO creator (Buying)?
3. Not as Ordered at the store: one figure typed by the counter, always returned? (Removed from
   the store UI and backend until confirmed.)
4. Does a Lost above some value need a second person?
5. A Lost closes the old allotment and MD raises a new one. This reverses allotment-v1, where a
   Lost goes back to To Pack on the same allotment. Is the new allotment the rule?
6. Wrong pieces sent to another store: straight from the store, or through the DC first?

## Status of the work

Written, not compiled, not deployed: MD edit and cancel, Move back, hard stop, short pick,
Still needed, store Receive laid out like the DC count sheet. Prototype only: the Inventory case
screens (Receiving, Stock check). Not started: Completed · issue, the notices to MD, Exceptions
kinds for receiving.
