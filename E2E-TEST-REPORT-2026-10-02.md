# End-to-end test report — supplier → PO → receiving → articles → allotment → outbound → store received

Rig `pos-e2e` (cloud :8480, DC :8481, store node :8482, hub :5480), tested in the browser through the hub UI, 1–2 Oct 2026. Three testers (A procurement; B articles and allotment; B2 allotment cancel, outbound and store receive). The detailed step tables, repro steps and polish lists are in:

- `E2E-REPORT-A-procurement.md` (supplier, PO, cancel, receiving branches)
- `E2E-REPORT-B-allotment-outbound.md` (New articles, New allotment, allotment detail, cancel, outbound, received; round 1 and round 2)

## Verdict

The happy path works end to end: a supplier and PO can be created, the Gudang counts, the buyer reviews and receives, articles are set up, goods are allotted, picked, packed, dispatched, counted blind by the store and shown as Received in the hub. The branches (short, over, close short, recount) work on the buyer side. **Two critical bugs in the PO flow and two high bugs in the allotment flow must be fixed before this is relied on.**

## What passed

| Flow | Result |
|---|---|
| Supplier: create "QA Testing, CV" (4-digit number 0002), contact, Orders tab, Activity, active switch with red Continue (hidden from the PO composer when non-active), list columns, expand chevron | PASS |
| PO create: typed delivery date, Net 30, kodi + pcs lines, totals, Review (totals in the table footer), PO number `PO-DDMMYY-NNN`, list row shows units as ordered ("10 kodi + 16 pcs") | PASS |
| PO cancel (with reason), Cancelled tab, supplier Cancelled count, edit disabled | PASS |
| Receiving: all match → Fully received; short + keep on order → Partially received → second count completes; short + close short → Short received; over → pieces go to Return to supplier; recount → "Recounting" and second review; Fully received cannot be edited | PASS |
| New articles: wide sheet, sticky rails, no hairline rules, name suggestions, price validation ("Must be above the purchase price"), 0-piece SKU "Not created", "Price for all <colour>" popover, markup tooltip, Create articles | PASS |
| New allotment: single header card, one search box, store and period pickers above the sales table, Sales KPIs non-zero once loaded, footer, per-article Save, Save all & next | PASS |
| Allotments list: three tabs, cards with Picked/Packed/Dispatch, wide detail sheet with store columns, sticky first column and pinned Total | PASS |
| Outbound: pick (one piece short), pack into a koli, dispatch on a surat jalan, store counts blind, hub shows Received ~20 s later | PASS |
| Unfilled tab (after the rig restart): Open and Closed short views load | PASS |

## Bugs

### Critical
1. **A cancelled PO can still be received.** With a count waiting, Cancel order is allowed, the sheet still shows Review count, and Receive then works. PO-021026-009 is Cancelled yet shows 2 pcs / Rp 170.000 received. Fix: refuse cancel while a count waits (or void the count) and block Review/Receive on a cancelled PO.
2. **One GRN and one supplier invoice are shared across several POs.** After the Gudang counts several POs of the same supplier in one sitting, each review shows the same GRN and the first PO's invoice, compared against every other PO's value ("Rp X over the agreed price"). Seen on PO-004/005/006/007/009 and again on PO-022-OPE3 (showing OPE2's GRN and invoice). Fix: one receipt and one invoice box per PO.

### High
3. **Closed-short and cancelled allotments vanish from every tab** (including ones the API marks COMPLETED). The hub never asks for `status=CANCELLED`, the only status they come back under. They can only be opened by URL.
4. **Close short after picking releases the picked piece** that the DC still holds on a picklist. The cloud offers it for allotment again while the DC cannot pack it, and Pack and seal fails with the raw message "conflict: no open allotment for EPC…". Piece White · L 00000009204 is stuck in this state on the rig.
5. **A PO raised and counted by the same person can never be reviewed** (ADMIN rina counted her own PO): Receive 0 pcs and Recount are both disabled with no reason. Receiving should refuse a count by the raiser, or the review should say who must count. PO-021026-001/-002 are stuck.
6. **PO Activity misses create, edit, cancel and recount send-back** (the record info API returns an empty list for them).
7. **A closed-short PO is still listed in Ops → Receiving** as "Count receive".
8. **Duplicate migration numbers took the rig down for ~30 minutes** (0816 ×2 and 0817 ×2, the HR pair and the supplier-search and PO payment-terms pair). Fixed by renumbering ours to 0820/0821 and the rig DB rows; the HR pair now applied normally. Process lesson: reserve migration numbers or check `ls` before adding one.
9. **New allotment stays dimmed for 3+ minutes if a row Save never gets an answer**, with no timeout or error.

### Medium
10. Allotment: there is no Cancel button, only "Close short" (the "Cancel and re-allot" button never shows because the detail returns `TO_SITE` and the button checks `TO_STORE`).
11. A short pick creates no Unfilled line, so Wait / Close short could not be tested.
12. Supplier catalogue "Add item" has no division, tags, colours or sizes, and the item sheet has no Edit.
13. The same item cannot be on a PO twice ("10 kodi + 2 pcs"), and a PO line's quantity cannot be edited (only remove and re-add).
14. Variant grid: size codes "03/04" instead of M/L (also on the PO sheet); the grid footer shows Rp 0 when SKU prices stay on the base price.
15. The invoice box's "Price for what was counted" includes over-delivered pieces.
16. Escape in the date popover (and once in Add item) closes the whole New PO composer without a discard prompt; Escape also closes New articles and loses the form.
17. The Gudang count sheet keeps the previous PO's "Count sent" banner on the next PO.
18. New allotment footer hides the last SKU row when it shows two status lines; its Pieces/Lines/Stores and store-column counts include other suppliers' draft quantities.
19. After close short the sheet and list do not refresh, the toast says "Closed short" while the sheet still says it is waiting for the DC, the reason is not shown and History rows do not name the SKU or store.
20. The DC calls stores by different names ("C001 · Cikupa") than the hub ("Kemang"), including on printouts; DC Dispatch keeps received surat jalan "In transit"; picks are stamped as rina because the DC never asked for a warehouse sign-in.
21. Colours picker says "Nothing matches." while still loading.
22. Dev rig: each hub tab keeps `/notifications/stream` open over HTTP/1.1, so with several tabs new tabs never finish loading (explains much of the "slow cloud").

### Low (see the reports for the full list)
Supplier Edit still allows PKP and Notes; supplier Activity stale after re-activation; Cancelled PO tab ignores search; PO list Status column cut off at 1280 px; lists do not live-update; "Nothing left to allot" shows while the pool loads; Articles list not refreshed after Create articles; "1 pcs / 1 lines" grammar; lower-case tooltips; filler subtitles; sidebar "Profile" caption at 12px; mixed supplier-code and PO-number formats on seeded data.

## Not tested or blocked

- Print (single and multi A5): the popup does not open inside the browser pane. Check the A5 layout by hand, especially the signature block.
- Allotment to 8+ stores in one allotment (no article has more than 6 pieces; two allotments of 6 stores were used instead; horizontal scroll and sticky columns were verified at 1024 px).
- Wait / Close short decisions on an unfilled line (no unfilled line was created, see bug 11).
- Phone layouts.

## Test data left on the rig

Supplier QA Testing, CV (0002) with 3 items; POs PO-021026-001 to -009 (001/002 stuck, 003 cancelled, 009 cancelled and wrongly received); PO-022-OPE2/OPE3 partly processed by the stopped second pass; articles QA Loafers B1 (00000011) and QA Sneakers B2 (00000012); allotments ALT-00000004 to -00000008; one stuck piece (White · L 00000009204); return-to-supplier RS-00000001/2.

## Suggested fix order

1. Critical 1 and 2 (cancel with a waiting count; one GRN/invoice per PO).
2. High 3 and 4 (allotments vanishing from tabs; close short after picking).
3. High 5, 6, 7, 9 (stuck same-person count; PO Activity; closed-short PO still in Receiving; Save timeout).
4. Medium 10–14 (allotment Cancel; catalogue Add item; same item twice; variant labels).
5. Process: reserve migration numbers.
