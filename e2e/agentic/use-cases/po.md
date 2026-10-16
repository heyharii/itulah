# Use cases: PO, Receiving, Return PO

Rig `agentic` (cloud :8580, separate DC node :8581). Run: `./remote.sh --config hub.config.ts --output .e2e/out/po hub/po hub/receiving hub/return-po`.
Status: pass / fail (bug) = the test asserts the right behaviour and the app is wrong / skip(reason).

| ID | Actor | Preconditions | Steps | Expected | Test | Status |
|---|---|---|---|---|---|---|
| PO-L01 | rina | a fresh API-raised PO | open Procurement > Purchase Orders | row shows supplier, PO number, ordered pieces and value, status "Active" | hub/po/list.e2e.ts::PO-L01 | pass |
| PO-L02 | rina | a fresh PO | look at the three tabs, switch to Completed and Cancelled | tabs "Active PO n" / "Completed PO n" / "Cancelled PO n"; the Active PO is not under the other two | hub/po/list.e2e.ts::PO-L02 | pass |
| PO-L03 | rina | - | open the list | KPI tiles Orders / Still open / Overdue / On order | hub/po/list.e2e.ts::PO-L03 | pass |
| PO-L04 | rina | a fresh PO | search "Search orders" by PO number, then by junk | one row; junk gives the empty state | hub/po/list.e2e.ts::PO-L04 | pass |
| PO-L05 | rina+nina | PO counted exactly as ordered | open Completed tab | row "Fully received", 8 pcs | hub/po/list.e2e.ts::PO-L05 | pass |
| PO-L06 | rina | PO cancelled via API | open Cancelled tab | row listed as Cancelled | hub/po/list.e2e.ts::PO-L06 | pass |
| PO-L07 | rina | PO 5 of 8 counted and accepted | open list | status "Partially received", Received 5 pcs | hub/po/list.e2e.ts::PO-L07 | pass |
| PO-L08 | rina | 5 of 8 accepted then closed short | open Completed tab | row "Closed short" | hub/po/list.e2e.ts::PO-L08 | pass |
| PO-L09 | rina | count waiting (5 of 8) | open list | the status cell is a "Review Count" button | hub/po/list.e2e.ts::PO-L09 | pass |
| PO-L10 | rina | count sent back with a reason | open list | status "Recounting" | hub/po/list.e2e.ts::PO-L10 | pass |
| PO-L11 | rina | 11 of 8 accepted (excess pending) | open Completed tab | "+3 pcs over" beside the status | hub/po/list.e2e.ts::PO-L11 | pass |
| PO-L12 | rina | - | open the Issued and Delivery Date range filters | filter popups open | hub/po/list.e2e.ts::PO-L12 | pass |
| PO-L13 | rina | - | open Columns menu | "Group by supplier" offered | hub/po/list.e2e.ts::PO-L13 | pass |
| PO-L14 | rina | a fresh PO | open /procurement/orders?order=<id> | the order sheet opens for that PO | hub/po/list.e2e.ts::PO-L14 | pass |
| PO-L15 | rina | >200 orders | scroll the table | next page loads, footer "N orders of M" | - | skip: needs >200 orders on the rig (22,914 in prod); infinite scroll is not reproducible without bulk data |
| PO-L16 | rina | phone viewport | open the list at 414x896 | tabs move into the dock drawer, " PO" dropped from labels | - | skip: phone layout is outside this suite (hub desk config only) |
| PO-L17 | rina | mixed orders | look at the row order | count-to-review first, then offline orders, then late orders | - | skip: ordering across all rig orders is not stable under parallel agents |
| PO-C01 | rina | - | New order, press Review order with nothing filled | "Choose a supplier." / "Choose the delivery date." / "Choose the payment method." / "Add at least one item." | hub/po/create.e2e.ts::PO-C01 | pass |
| PO-C02 | rina | - | open composer; choose supplier | New item disabled until a supplier is chosen, then empty text "Nothing on this order yet…" | hub/po/create.e2e.ts::PO-C02 | pass |
| PO-C03 | rina | - | open the Supplier picker | merchandise suppliers listed; last row "Create a new supplier" | hub/po/create.e2e.ts::PO-C03 | pass |
| PO-C04 | rina | - | choose supplier 0001 | Payment Terms pre-filled "30 days" | hub/po/create.e2e.ts::PO-C04 | pass |
| PO-C05 | rina | supplier chosen | New item > Submit with nothing typed | "Give it a name." / "Choose a division." / "Choose at least one tag." / "Fill in how many." / "Fill in the price." | hub/po/create.e2e.ts::PO-C05 | pass |
| PO-C06 | rina | item sheet with a name typed | Cancel; Keep Editing; Cancel; Discard | "Discard This Item?" / "What you typed and the photo will be lost."; Keep Editing keeps the value; Discard closes the sheet | hub/po/create.e2e.ts::PO-C06 | pass |
| PO-C07 | rina | composer with a delivery date typed | Cancel; Keep editing; Cancel; Discard | "Discard This Order?" / "Nothing has been saved."; Keep editing stays, Discard closes. Note: a supplier alone is NOT counted as unsaved input (observed design) | hub/po/create.e2e.ts::PO-C07 | pass |
| PO-C08 | rina | nothing typed | Cancel | closes without asking | hub/po/create.e2e.ts::PO-C08 | pass |
| PO-C09 | rina | one 10 x Rp 40.000 line | type discount % then amount, then an amount above the total | each fills the other; capped at the lines total (100%) | hub/po/create.e2e.ts::PO-C09 | pass |
| PO-C10 | rina | one 12 pcs line, Transfer, notes | Review order > Submit | "PO-DDMMYY-NNN created"; API shows ACTIVE, 12 pcs, notes saved, payment Transfer | hub/po/create.e2e.ts::PO-C10 | pass |
| PO-C11 | rina | line of 1.000.000 pcs | Submit the item | banner "A line is at most 999.999 pieces."; Review does not advance | hub/po/create.e2e.ts::PO-C11 | pass |
| PO-C12 | rina | price Rp 100.000.000 | Submit the item | banner "A price is at most Rp 99.999.999 a piece." | hub/po/create.e2e.ts::PO-C12 | pass |
| PO-C13 | rina | 999.999 x Rp 99.999.999 | Submit the item | banner "An order comes to at most Rp 99.999.999.999." | hub/po/create.e2e.ts::PO-C13 | pass |
| PO-C14 | rina | one line on the order | pencil "Edit <name>" > change quantity > Submit; bin "Take <name> off this order" | "Edit line" sheet; row updates to 7 pcs; bin empties the order | hub/po/create.e2e.ts::PO-C14 | pass |
| PO-C15 | rina | browser offline (navigator.onLine=false) | fill order, Review, Submit; then go online | banner "You are offline…"; toast "Saved on this device…"; row "Offline"; auto-sent "<PO> created" when online | hub/po/create.e2e.ts::PO-C15 | pass |
| PO-C16 | rina | - | add the same catalogue item twice | merged into one line ("10 kodi + 2 pcs") | hub/po/create.e2e.ts::PO-C16 | skip |
| PO-C17 | rina | - | Supplier picker > Create a new supplier | supplier composer opens | hub/po/create.e2e.ts::PO-C17 | pass |
| PO-C18 | rina | an order kept offline | open the Offline row; Delete Order > Keep Order; Delete Order > Delete Order | offline sheet banner; "Delete This Order?"; row removed | hub/po/create.e2e.ts::PO-C18 | pass |
| PO-C19 | rina | - | server refuses the order (validation) | red banner with the server message in the composer | - | skip: needs a server-side refusal the UI cannot be driven into (the UI blocks every refusable input first) |
| PO-C20 | rina | photo | add / replace / remove a photo on the item | photo menu, upload failure toast | - | skip: needs an image file upload; photo storage not part of this rig run (Photo field smoke only) |
| PO-C21 | rina | Sourcing basket | Sourcing > Basket > Raise an order | supplier picker lists baskets; lines leave the basket after raising | - | skip: Sourcing/basket belongs to the Merchandise/Procurement sourcing domain, not PO list |
| PO-S01 | rina | fresh PO | open sheet | number, "Created by …", Supplier, Delivery Date, Payment Method, Items (1), total; Print / Cancel / Edit | hub/po/sheet.e2e.ts::PO-S01 | pass |
| PO-S02 | rina | fresh PO | tap Print menu | "Download PDF" and papers A5 landscape / A4 landscape / A5 portrait / A4 portrait | hub/po/sheet.e2e.ts::PO-S02 | pass |
| PO-S03 | rina | 5 of 8 accepted | open sheet | "5 of 8 pcs", Close Short offered, no Cancel | hub/po/sheet.e2e.ts::PO-S03 | pass |
| PO-S04 | rina | count waiting | open sheet | "Counted at the warehouse" (who, when), Review Count button, Cancel disabled | hub/po/sheet.e2e.ts::PO-S04 | pass |
| PO-S05 | rina | recount requested with a reason | open sheet | "Sent back to count" + the reason; Cancel disabled | hub/po/sheet.e2e.ts::PO-S05 | pass |
| PO-S06 | rina | fresh PO | Cancel > Keep Order; Cancel > reason > Cancel Order | dialog "Cancel <PO>?" + body; receipt "PO <PO> is cancelled."; lifecycle CANCELLED | hub/po/sheet.e2e.ts::PO-S06 | pass |
| PO-S07 | rina | cancelled PO | open sheet | stamp CANCELLED, "Cancel Reason" section, no Cancel / Edit | hub/po/sheet.e2e.ts::PO-S07 | pass |
| PO-S08 | rina | 5 of 8 accepted | Close Short > reason > Close Short | dialog "Close This Short?" with "3 pcs will be removed…"; PO becomes SHORT_RECEIVED; reason stored on the line | hub/po/sheet.e2e.ts::PO-S08 | pass |
| PO-S09 | rina | fully received PO | open sheet | stamp FULLY RECEIVED, no Edit / Cancel | hub/po/sheet.e2e.ts::PO-S09 | pass |
| PO-S10 | rina | closed-short PO | open sheet | stamp CLOSED SHORT | hub/po/sheet.e2e.ts::PO-S10 | pass |
| PO-S11 | api | closed-short line | close short again | server: "already closed short" / "nothing is outstanding" | hub/po/sheet.e2e.ts::PO-S11 | pass |
| PO-S12 | api | 5 of 8 accepted | close short with an empty reason | server: "closing a line short must say why the rest is not coming" | hub/po/sheet.e2e.ts::PO-S12 | pass |
| PO-S13 | api | 5 of 8 accepted | cancel | server: "...close it short instead"; PO stays PARTIALLY_RECEIVED | hub/po/sheet.e2e.ts::PO-S13 | pass |
| PO-S14 | api | count waiting for review | cancel via API | server should refuse (a waiting count would be stranded) | hub/po/sheet.e2e.ts::PO-S14 | fail (bug) |
| PO-S15 | api | cancelled PO | cancel again | server: "this order is already cancelled" | hub/po/sheet.e2e.ts::PO-S15 | pass |
| PO-S16 | rina | receipts with Not as Ordered | open sheet | per-line "Received" lines "<day> · N pcs · M pcs not as ordered" | - | skip: per-line receipt text not yet asserted (low value; covered by the review tests via API numbers) |
| PO-S17 | rina | Print | tap Print (browser window) | a print window opens | - | skip: opens a separate window the engine does not follow |
| PO-E01 | rina | fresh PO | sheet > Edit | composer titled "Edit <PO>", Supplier read-only | hub/po/edit.e2e.ts::PO-E01 | pass |
| PO-E02 | rina | fresh PO | Edit, change notes, Review order, Submit | "Review the changes"; receipt "<PO> updated"; notes saved (API) | hub/po/edit.e2e.ts::PO-E02 | pass |
| PO-E03 | rina | 5 of 8 accepted | sheet > Edit | banner "Goods have been received on this order. Only the delivery date and the notes can change."; payment method locked; notes editable | hub/po/edit.e2e.ts::PO-E03 | pass |
| PO-E04 | rina | fully received PO | open ?edit-order=<id> | editing refused (toast), no editor | hub/po/edit.e2e.ts::PO-E04 | pass |
| PO-E05 | api | cancelled PO | PUT the order | server refuses | hub/po/edit.e2e.ts::PO-E05 | pass |
| RCV-01 | nina | fresh PO synced to DC | Ops > Receiving | row with supplier, PO number, 1 item, "Count receive" | hub/receiving/count.e2e.ts::RCV-01 | pass |
| RCV-02 | nina | fresh PO | Search Orders by PO number, then junk | one row; "No orders match." | hub/receiving/count.e2e.ts::RCV-02 | pass |
| RCV-03 | nina | PO cancelled | Ops > Receiving | the order is not listed | hub/receiving/count.e2e.ts::RCV-03 | pass |
| RCV-04 | nina | PO closed short | Ops > Receiving | the order is not listed (old High 7) | hub/receiving/count.e2e.ts::RCV-04 | pass |
| RCV-05 | nina | 5 of 8 accepted (3 owed) | open the count sheet | still listed; line shows "· 5 already in" | hub/receiving/count.e2e.ts::RCV-05 | pass |
| RCV-10 | nina | fresh PO | open the count sheet, nothing typed | blind: no ordered quantity; Total Counted, Not as Ordered / Damaged or wrong items; Submit count disabled until a figure is typed | hub/receiving/count.e2e.ts::RCV-10 | pass |
| RCV-11 | nina | fresh PO of 8 | count 8, Submit count | "Count sent"; PO FULLY_RECEIVED automatically (no review) | hub/receiving/count.e2e.ts::RCV-11 | pass |
| RCV-12 | nina | fresh PO of 8 | count 5 | count waits at the DC (counted 5, variance -3); nothing received | hub/receiving/count.e2e.ts::RCV-12 | pass |
| RCV-13 | nina | fresh PO of 8 | count 11 | count waits, variance +3 | hub/receiving/count.e2e.ts::RCV-13 | pass |
| RCV-14 | nina | fresh PO of 8 | count 8 + Not as Ordered 3 | wire count 11 (good + wrong), wrong 3 | hub/receiving/count.e2e.ts::RCV-14 | pass |
| RCV-15 | nina | fresh PO of 8 | Not as Ordered 3 and nothing counted | count rides as 3 / wrong 3 (nothing good) | hub/receiving/count.e2e.ts::RCV-15 | pass |
| RCV-16 | nina | fresh PO of 8 | unit Lusin, count 1 | "12 pcs"; wire count 12 (multi-unit) | hub/receiving/count.e2e.ts::RCV-16 | pass |
| RCV-17 | nina | fresh PO of 8 | count 5; Another unit; Remove this amount | second amount row added and removed | hub/receiving/count.e2e.ts::RCV-17 | pass |
| RCV-18 | nina | fresh PO of 8 | Not as Ordered 2.5 | "Must be a whole number of pieces"; Submit disabled | hub/receiving/count.e2e.ts::RCV-18 | pass |
| RCV-19 | nina+rina | count sent back for recount | list shows "Count again" + reason; count exactly 8 | recount is accepted automatically, PO FULLY_RECEIVED | hub/receiving/count.e2e.ts::RCV-19 | pass |
| RCV-20 | nina | 5 counted with 2 not as ordered | Ops > Receiving | row "3 pcs + 2 Not as Ordered", counter name | hub/receiving/count.e2e.ts::RCV-20 | pass |
| RCV-21 | nina | count waiting | open counted sheet; Recall Count > confirm | read-only sheet; "Recall this count?"; recalled | hub/receiving/count.e2e.ts::RCV-21 | skip |
| RCV-22 | nina | fresh PO | count every line as 0 | allowed on a cloud-hosted warehouse ("reject the whole lorry") | hub/receiving/count.e2e.ts::RCV-22 | skip |
| RCV-23 | nina | fresh PO | count 0 on the DC node | banner "a count of nothing is not a count; refuse the delivery instead" | hub/receiving/count.e2e.ts::RCV-23 | pass |
| RCV-24 | api | a supplier delivery | POST goods-receipts/{id}/reject | delivery rejected (no hub button exists) | hub/receiving/count.e2e.ts::RCV-24 | pass |
| RCV-25 | nina | 2 POs same supplier, receipt reuse | count both from the UI | one open un-invoiced delivery is reused across POs (known Critical 2) | - | skip: documented behaviour (receiving.tsx:705-710); no assertion that distinguishes right from wrong yet |
| RV-01 | rina | count waiting | list > Review Count | "Review Count" dialog opens | hub/receiving/review.e2e.ts::RV-01 | pass |
| RV-02 | rina | 5 of 8 counted | open ?verify=<PO> | table Article / Ordered Quantity / Counted Quantity / Difference, "−3 pcs"; Close Short / Recount / Partial Receive | hub/receiving/review.e2e.ts::RV-02 | pass |
| RV-03 | rina | 5 of 8 counted | Partial Receive | "1 item received"; PO PARTIALLY_RECEIVED, 5 received, 3 outstanding | hub/receiving/review.e2e.ts::RV-03 | pass |
| RV-04 | rina | 5 of 8 counted | Close Short > Close Short | dialog "Close This Short?"; PO SHORT_RECEIVED, 5 received | hub/receiving/review.e2e.ts::RV-04 | pass |
| RV-05 | rina | 11 of 8 counted | review, Submit | "3 pcs extra will be returned to the supplier", Submit only; "1 item received"; return raised automatically | hub/receiving/review.e2e.ts::RV-05 | pass |
| RV-06 | rina | 10 counted, 3 not as ordered | open review | "3 pcs not as ordered will be returned to the supplier"; still short so Partial Receive offered | hub/receiving/review.e2e.ts::RV-06 | pass |
| RV-07 | rina | 13 counted, 2 not as ordered | open review | "5 pcs will be returned to the supplier · 2 not as ordered, 3 extra" | hub/receiving/review.e2e.ts::RV-07 | pass |
| RV-08 | rina | 5 of 8 counted | Recount, reason, "Send 1 item back to count" | pre-ticked line, reason required, "N items sent back to count"; DC shows the reason | hub/receiving/review.e2e.ts::RV-08 | pass |
| RV-09 | rina | 5 of 8 counted | Recount > Back | back at the review, nothing sent | hub/receiving/review.e2e.ts::RV-09 | pass |
| RV-10 | rina | recount sent | PO list | "Recounting" | hub/receiving/review.e2e.ts::RV-10 | pass |
| RV-11 | rina | nothing counted | open ?verify=<PO> | "Nothing to review." | hub/receiving/review.e2e.ts::RV-11 | pass |
| RV-12 | api | count waiting | cancel via API | server should refuse (bug: it cancels and strands the count) | hub/receiving/review.e2e.ts::RV-12 | fail (bug) |
| RV-13 | rina | PO cancelled with a count waiting | review | "This order is cancelled." / DC refuses to receive | hub/receiving/review.e2e.ts::RV-13 | pass |
| RV-14 | api | accepted count | accept again | "already <status>" | hub/receiving/review.e2e.ts::RV-14 | pass |
| RV-15 | api | count waiting | Recount without a note | "a recount request must say what to look at again" | hub/receiving/review.e2e.ts::RV-15 | pass |
| RV-16 | api | count exactly as ordered | Accept | "already accepted" (it was received on its own) | hub/receiving/review.e2e.ts::RV-16 | pass |
| RV-17 | rina | 5-line PO, counts 8/8/5/8/11 | open review | "Difference": "2 of 5 items differ · 3 pcs short · 3 pcs extra"; "Hide matched" switch hides matched rows | hub/receiving/review.e2e.ts::RV-17 | pass |
| RV-18 | rina | 2-line PO | open review | no "Difference" summary at <=4 lines | hub/receiving/review.e2e.ts::RV-18 | pass |
| RV-19 | rina | 5 of 8 counted | Partial Receive | "N items received" confirmation | hub/receiving/review.e2e.ts::RV-19 | pass |
| RV-20 | rina | 5 of 8 counted | accept, then look for the invoice block "Invoice for this order" | invoice block (Invoice Number, Invoice Total, Upload invoice) reachable | hub/receiving/review.e2e.ts::RV-20 | fail (bug) |
| RV-21 | api | accepted goods | POST goods-receipts/{id}/invoice as yusuf | invoice accepted | hub/receiving/review.e2e.ts::RV-21 | pass |
| RV-22 | rina | warehouse sign-in required, nobody named | open review | form "Who is verifying?"; actions disabled | - | skip: this rig signs in silently from the hub session; the warehouse sign-in can not be switched off/on from tests (global setting) |
| RET-01 | rina | return raised for 11 of 8 | Procurement > Return PO | Open tab row: PO number, RS number, "Not Generated", 3 pcs | hub/return-po/return.e2e.ts::RET-01 | pass |
| RET-02 | rina | a raised return | search "Search returns" by RS number, then junk | row found / hidden | hub/return-po/return.e2e.ts::RET-02 | pass |
| RET-03 | rina | a raised return | open sheet (?allotment=<id>) | supplier, RS number, reason "Over-delivery", PO, Total, Print and Download | hub/return-po/return.e2e.ts::RET-03 | pass |
| RET-04 | rina | 10 counted, 3 not as ordered | open sheet | lines "Not As Ordered" / "Item unknown", no price | hub/return-po/return.e2e.ts::RET-04 | pass |
| RET-05 | rina | 13 counted, 2 not as ordered | open sheet | reason "Over-delivery · Not as ordered" | hub/return-po/return.e2e.ts::RET-05 | pass |
| RET-06 | rina | a raised return | PO sheet > Return PO section | return card with RS number and status "Not Generated" | hub/return-po/return.e2e.ts::RET-06 | pass |
| RET-10 | rina | accepted 11 of 8 (API), no return yet | PO sheet > "Return 3 pcs to supplier" > Raise the Return | dialog "Send the Excess Back"; "RS-######## raised"; return at DC with 3 pcs | hub/return-po/return.e2e.ts::RET-10 | pass |
| RET-11 | api | excess already returned | raise a return again | 409 "nothing on <PO> arrived beyond the order that is still waiting to go back" | hub/return-po/return.e2e.ts::RET-11 | pass |
| RET-12 | rina | excess returned | PO sheet | no "Return N pcs to supplier" button | hub/return-po/return.e2e.ts::RET-12 | pass |
| RET-13 | api | a raised return | cancel / edit a return | no endpoint (documented gap) | hub/return-po/return.e2e.ts::RET-13 | pass |
| RET-20 | nina | open return | Ops > Return PO | supplier card lists the PO with "Generate Delivery Note" | hub/return-po/return.e2e.ts::RET-20 | pass |
| RET-21 | nina | open return | Generate Delivery Note > Person in Charge > Generate Delivery Note | sheet "In this note"; then Print / Download / Confirm; note + PIC stored at the DC | hub/return-po/return.e2e.ts::RET-21 | fail (bug) |
| RET-22 | nina | note generated | Confirm > Confirm | "Confirm Garmen Nusantara?" "1 return, 3 pcs go back…"; "Sent back to Garmen Nusantara."; hand-over stored | hub/return-po/return.e2e.ts::RET-22 | fail (bug) |
| RET-23 | rina | handed-over return | Return PO > Completed | row "Completed" | hub/return-po/return.e2e.ts::RET-23 | pass |
| RET-24 | api | open return | generate a note with an empty PIC | "say who is in charge of this delivery" | hub/return-po/return.e2e.ts::RET-24 | fail (bug) |
| RET-25 | api | open return | hand over without a note | "generate the surat jalan ... before it is handed over" | hub/return-po/return.e2e.ts::RET-25 | fail (bug) |
| RET-26 | api | handed-over return | hand over again | "already been handed to the supplier" | hub/return-po/return.e2e.ts::RET-26 | pass |
| RET-30 | rina | a raised return | sheet > Download | file surat-jalan-retur-<supplier>.pdf | hub/return-po/return.e2e.ts::RET-30 | pass |
| RET-31 | rina | a raised return | sheet > Print | print window "Surat jalan retur <supplier>" (SURAT JALAN RETUR, Tgl, No PO, Kepada, Hormat kami) | - | skip: opens a separate print window; the PDF twin is RET-30 |
| RET-40 | rina | - | New return | page "New Return PO" with Back | hub/return-po/return.e2e.ts::RET-40 | pass |
| RET-41 | rina | stock in head-office RETURN pool | New return > choose supplier > Why > To Return > Settle by > Confirm | "Return confirmed · surat <no>" | hub/return-po/return.e2e.ts::RET-41 | skip |
| RET-42 | rina | register return waiting on supplier | Expect replacement / Close Short on the sheet | "Replacement expected" / "Closed short" | - | skip: needs register returns, which need return-stock; none on this rig |
| RET-43 | rina | refund / credit note | Finance BKM "Refund for return" / credit note "Settles return" | settlement recorded | - | skip: Finance domain (another suite) |

## Known bugs (tests stay red, tagged `bug`)

| Test | Evidence |
|---|---|
| PO-S14, RV-12 | `POST /purchase-orders/{id}/cancel` succeeds while a count waits for review (returns the cancel command). Only the hub button is disabled; the server must refuse or the waiting count is stranded. |
| RV-20 | After Accept (Partial Receive) the "N items received" popup shows and the review closes; "Invoice for this order" (Invoice Number / Total / Upload invoice) is never reachable in the hub (count-review.tsx:541-542). The invoice can only be recorded through the API (RV-21). |
| RET-21, RET-22, RET-24 | Ops > Return PO > Generate Delivery Note shows "Method Not Allowed": the separate DC node answers 405 to `POST /api/v1/dc/purchase-returns/note`, so no note, Print/Download or Confirm can be reached on this rig (works only on a cloud-hosted warehouse). RET-24 expects the "say who is in charge of this delivery" refusal, gets an empty 405. |
| RET-25 | The DC node hands a return over without a generated surat jalan (cloud-hosted DC refuses with "generate the surat jalan ... before it is handed over"). |

## Notes and observed behaviour (asserted as-is)

- A supplier chosen alone is not "unsaved input": the composer closes without "Discard This Order?" until a date, notes, discount or line exists (PO-C07).
- The count sheet's "Counted" figure is the good pieces; the wire count is good + Not as Ordered (RCV-14/15), so the Review shows "11 pcs" for 13 arrived with 2 not as ordered.
- On one line, the extra goes back with the Not as Ordered pieces: "5 pcs not as ordered will be returned" (RV-07); the "· 2 not as ordered, 3 extra" breakdown needs them on different lines (RV-07b).
- "Hide matched" is on by default when more than four lines (RV-17).
- Waiting counts show in the PO list's Received cell in red (e.g. "5 pcs Rp 200.000") although nothing is received yet.
- Skips needing a cloud-hosted warehouse (README rule 6): RCV-21 Recall Count, RCV-22 zero count (RCV-23 asserts the DC node's refusal banner instead).
- Agent steps: none used; every test is deterministic (no ANTHROPIC key needed).
- Receipt popups vanish after 3 s, so tests watch them with a MutationObserver (`watchText`/`seen` in support/po.ts).
