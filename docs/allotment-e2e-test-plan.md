# Allotment end to end — local test plan (18 Oct 2026)

Local demo rig only: cloud :8180 (Gudang runs inside the cloud), store-01 node
:8182, store-02 node :8183 (started by hand for the two-store cases), hub
:5350 as admin, store app store.localhost:5384 (store-01). DC = cloud-run
Gudang only; the old edge DC is out of scope.

Every case is driven in the browser (hub for MD and Ops, store app for the
shop). Store-02's count is sent from its own node's API when no second store
app is running.

## A. New allotment (MD)

| # | Case | Expect |
|---|------|--------|
| A1 | New allotment, one article, C001 + C002, from DC stock | Saved; In progress shows both stores; Ops board shows a Pick card per store |
| A2 | Ask more than the DC holds | Refused or capped with the reason; nothing half-saved |

## B. Edit / Cancel (MD)

| # | Case | Expect |
|---|------|--------|
| B1 | Edit before any pick: move 1 pc from C001 to C002 | Saved; picklists follow |
| B2 | Edit after C001 is picked | C001's picked pieces locked (📦), cannot go lower; C002 still movable |
| B3 | Cancel with a Note while nothing is picked | Allotment cancelled; Note kept |

## C. Ops (DC)

| # | Case | Expect |
|---|------|--------|
| C1 | Pick all of C001 | Pick card done; Pack card appears |
| C2 | Cannot pick 1 pc (Note) | MD In review › At the DC card "1 pc not picked" |
| C3 | MD Continue | Pick card shows "MD: continue picking"; Ops picks it |
| C4 | MD Accept short | Line Closed short; Pick card clears |
| C5 | Pack → Back to Pick | Pieces back on the Pick card, strip "Back from Pack" |
| C6 | Pack, Dispatch (trip with C001 + C002) | Surat jalan per store; store-01 sees the delivery In transit |
| C7 | Dispatch → Back to Pick | Koli's pieces back to Pick, strip "Back from Dispatch" |

## D. Store receive

| # | Case | Expect |
|---|------|--------|
| D1 | Count sheet: every colour·size of the delivered articles listed, empty boxes, no quantities shown | List + add |
| D2 | Count matches exactly | Booked at once (stock up); delivery Received; allotment line received; allotment Completed when every store matched |
| D3 | Count differs | Delivery "In review"; NOTHING booked (stock unchanged); On hold lists every counted SKU "Waiting for MD"; MD sees the trip under At the store |
| D4 | Add an article not on the list, scan an unknown SKU | Added article counts; unknown SKU red, Submit blocked until removed |

## E. MD review — At the store

| # | Case | Expect |
|---|------|--------|
| E1 | Only C001 counted (C002 not yet) | Card says "Waiting for C002"; Accept/Return refused |
| E2 | Accept as delivered: C001 got 1 of C002's pieces, C002 short 1 | C001 books its own + C002's piece; C002 books its own; the redirected EPC pairs at the centre (Gudang In Transit lets go; reconciliation MATCHED, not DC_ONLY/STORE_ONLY); C002's line completes; trip leaves the review |
| E3 | Accept as delivered: a piece no store has | Line lost in transit + closed short; piece Missing in the Gudang's In Transit pool; allotment Closed |
| E4 | Extra / article nobody sent | Not booked; On hold "Return to HO" at the store |
| E5 | Return & reallot | New allotment for what the DC holds, rest "Closed short"; wrong-store and extra pieces → Return to HO; each store books its own counted pieces; old allotment lines closed |

## Checks behind the screens (SQL / API)

- store node: `store_inbound_review`, `store_inbound_unit.outcome`, stockroom balance
- cloud: `allotment_line` received / lost_in_transit / closed_short, `allotment.status`,
  `edge_transfer_claim` + `edge_transfer_allotment_attribution`, `edge_transfer_redirect`,
  Gudang In Transit pool balance, `GET /api/v1/inventory/reconciliations`

## Results — 18 Oct 2026, local demo rig, browser (hub + store app), store-02 by its node API

| Case | Result | Data |
|------|--------|------|
| A1 New allotment | Pass | ALT-00000017 Kemeja 12 pcs C001 + C002 |
| B1 Edit before pick | Pass | White XL moved C001 → C002 ("1 pc moved") |
| B2 Edit after pick | Pass | ALT-00000020 Black XL locked (box icon, "Sent"), XXL movable |
| C1 Pick / Pack / Dispatch | Pass | DSP-HO-GUDANG-000003, -000004, -000005 |
| C2 Cannot pick + Note | Pass | ALT-00000020 XXL short, Note "Not on the shelf" |
| C3 MD Continue | Pass | Pick card "MD: continue picking" |
| C5 Back to Pick from Pack | Pass | Pick card "Back from Pack" |
| D1 List + add | Pass | every colour·size listed, blind |
| D2 Exact count | Pass | ALT-00000018 booked at once, COMPLETED, no review |
| D3 Count differs | Pass | "In review", stock unchanged, On hold "Waiting for MD" |
| D4 Add article by search | Pass | Sandal added, counted, sent to review as extra |
| E1 Waiting for the other store | Pass | buttons disabled, "Waiting for C002 · Muaro Bungo" |
| E2 Accept as delivered, wrong store | Pass after fix | redirected EPC MATCHED; Gudang let go; C002 line received |
| E3 Not received anywhere | Pass | line lost in transit + closed short; Missing in Gudang In Transit |
| E4 Extra | Pass | Return to HO on hold at C001 |
| E5 Return & reallot | Pass | ALT-00000019 COMPLETED; dialog 7; reallot "0 of 1 · Closed short" (DC had none) |
| C4 Accept short, C7 Back to Pick from Dispatch, B3 Cancel with Note | Not run | |

Fixed during the run: attribution trigger refused a redirected pair (0978); an
allotment with any closed short read as Cancelled even when delivered (0979,
also hit by every Edit); store card "pcs counted" left out kept extras; MD's
At the DC card showed "Other" instead of the picker's Note. 0978/0979 were
applied to the rig DB by hand; the next cloud build records them.

## Results — 19 Oct 2026, local demo rig (fresh cloud + store build), browser + store-02 by its node API

Stock: PO-191026-001 (Kaos Uji UJ19) and PO-191026-002 (UJ20), 12 pcs each, made with `e2e/po-flow/run.py --phase 1` (RIG_DC = cloud).

| Case | Result | Data |
|------|--------|------|
| A1 New allotment | Pass | ALT-00000021 UJ19 C001 8 + C002 4 |
| A2 Ask more than the DC holds | Pass | the cell caps at the stock (red) |
| B1 Edit before pick | Pass | White·L moved C001 → C002 |
| B3 Cancel with Note | Pass | ALT-00000022 CANCELLED, Note on every line, 12 pcs released |
| C1 Pick / Pack | Pass after fix | All picked ticked only the last row |
| C2 Cannot pick + Note | Pass | ALT-00000021 C002 White·L, "Rusak, jahitan lepas" |
| C4 MD Accept short | Pass | line closed short 1, card leaves review |
| C6 Dispatch, 2 stores | Pass | DSP-HO-GUDANG-000006, SJ 000009 + 000010 |
| C7 Dispatch → Back to Pick | Pass after fix | strip "Back from Dispatch" was never drawn |
| D1 / D3 / D4 | Pass | blind list; In review, nothing booked; No SKU blocks Submit |
| D2 Exact count | Pass | SJ-000011 booked at once |
| E1 Waiting for C002 | Pass | (list needs a reload to update) |
| E2 Accept as delivered, wrong store | Pass | EPC …20300000000002 redirected, MATCHED; ALT-21 COMPLETED |
| E5 Return & reallot | Pass | ALT-23 COMPLETED, missing line lost in transit + closed short; no reallot made (DC held 0) |

Fixed (hub, uncommitted, types not checked): picking.tsx All picked (state update from a stale render);
board.tsx search matches article name/code on Pick cards; board.tsx pick card draws "Back from Pack/Dispatch";
owed.ts an MD change goes on a Picked card only if that allotment is on it (was: red "Cancelled" from another
allotment); amend-data.ts `deliverableOf` — an Edit's moved piece was taken off twice, so MD tiles read "Picking"
before any pick.

Open: In review list does not poll; Activity "(2)" lists only Created after an Edit; board search cannot find
articles on Picked/Packed cards; KPI "In stock" lagged after new stock; store app says "carton(s)" and "Received by
maya" (login, not name); pick banner "WHITE · L" vs rows "White · L", number pad "L · White"; Dispatch rail
"C001-TOKO" vs "C001 · Cikupa"; store-02 delivery result says "missing 4, received 0" while in review; In progress
lists oldest first and still shows cancelled ALT-00000002; po-flow script: invoice not booked on the cloud DC.
