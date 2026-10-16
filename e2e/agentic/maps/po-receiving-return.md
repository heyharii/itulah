# PO, Receiving (hub side) and Return PO — branch map (9 Oct 2026, read-only survey)

I couldn't save the file: this session is read-only, so I can't create `research_notes/Riset framework e2e TesterArmy/branches_po_return.md`. The full survey is below; save it there if you want it to survive another interruption. I didn't edit, build, run anything or call any rig endpoints.

## File index (all evidence below is `file:line` against these)

| Short name | Absolute path |
|---|---|
| nav.ts | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/nav.ts |
| index.ts | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/index.ts |
| po.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/purchase-orders.tsx |
| composer.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/composer.tsx |
| item-form.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/item-form.tsx |
| items-table.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/items-table.tsx |
| count-review.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/count-review.tsx |
| crs.ts | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/count-review-state.ts |
| held.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/held-orders.tsx |
| outbox.ts | /Users/hari/Documents/itulah/frontend-hub/src/lib/offline/po-outbox.ts |
| shared.ts | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/shared.ts |
| print-menu.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/print-menu.tsx |
| outstanding.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/outstanding.tsx |
| basket.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/basket.tsx |
| sr.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/supplier-returns.tsx |
| srg.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/supplier-return-groups.tsx |
| return-lines.ts | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/return-lines.ts |
| return-print.ts | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/return-print.ts |
| return-pdf.ts | /Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/return-pdf.ts |
| ops-suppliers.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/operations/board/suppliers.tsx |
| receiving.tsx | /Users/hari/Documents/itulah/frontend-hub/src/screens/operations/intake/receiving.tsx |
| ops-nav.ts | /Users/hari/Documents/itulah/frontend-hub/src/screens/operations/nav.ts |
| q-proc.ts | /Users/hari/Documents/itulah/frontend-hub/src/lib/queries/procurement.ts |
| q-sr.ts | /Users/hari/Documents/itulah/frontend-hub/src/lib/queries/supplier-returns.ts |
| api.ts | /Users/hari/Documents/itulah/frontend-hub/src/lib/api.ts |
| dc.ts | /Users/hari/Documents/itulah/frontend-contract/src/client/dc.ts |
| dialog.tsx | /Users/hari/Documents/itulah/frontend-hub/src/components/ui/dialog.tsx |
| BE sync.rs | /Users/hari/Documents/itulah/backend/src/cloud/postgres/sync.rs |
| BE suppliers.rs | /Users/hari/Documents/itulah/backend/src/cloud/postgres/suppliers.rs |
| BE receiving.rs | /Users/hari/Documents/itulah/backend/src/cloud/dc/receiving.rs |
| BE purchase_returns.rs | /Users/hari/Documents/itulah/backend/src/cloud/postgres/purchase_returns.rs |
| BE returns_supplier.rs | /Users/hari/Documents/itulah/backend/src/cloud/dc/returns_supplier.rs |
| BE auth.rs / job_role.rs | /Users/hari/Documents/itulah/backend/src/cloud/domain/auth.rs and job_role.rs |
| run.py / review_states.py | /Users/hari/Documents/itulah/e2e/po-flow/run.py and review_states.py |

**How the router works:** routes are generated from the nav registry (`/Users/hari/Documents/itulah/frontend-hub/src/routes.tsx:69-90`). Which sheet is open is a URL search parameter (`useSheet`), so tests can deep-link straight to a sheet.

**Dialog behaviour that tests must allow for:**
- `ConfirmButton`: the confirm button's text defaults to the button's own label, and the cancel text defaults to "Cancel". Refusals from the server are shown inside the dialog, not as a toast (dialog.tsx:457-529).
- `SavedDialog` (the receipt popup) closes itself after 3 s, or 5 s if it has an undo button. Hovering it holds it open (dialog.tsx:169-243).
- On a phone, dialogs open as bottom drawers.

---

# A. Purchase Orders

## A1. Screens and how users get there

| Screen | Route | Component | Menu / way in |
|---|---|---|---|
| Purchase Orders list | `/procurement/orders` (also the module home; bare `/procurement` redirects here) | `PurchaseOrders` po.tsx:919, mapped at index.ts:16 | Sidebar **Procurement › Purchase Orders** (nav.ts:83-84). Badge = number of orders with a count waiting for review |
| New PO composer | `?new-order=true` | `OrderComposer` composer.tsx:784 | **New order** button (po.tsx:1469-1471); on a phone, the round button **New Order** (po.tsx:1476) |
| Order sheet | `?order=<purchase_order_id>` | `OrderSheet` po.tsx:2031 | Click a row (po.tsx:1548-1553) |
| Edit PO | `?edit-order=<id>` | `OrderEditor` po.tsx:2268 | **Edit** button on the order sheet |
| Review Count | `?verify=<po_number>` | `CountReview` count-review.tsx:134 | **Review Count** in the list's Status cell or on the sheet |
| Order kept offline | local state only | `HeldOrderSheet` held.tsx:99 | Click a row marked Offline / Not sent |
| Order from basket | `?basket=true` on Sourcing | basket.tsx:144-157 | **Procurement › Sourcing** → **Basket** (sourcing.tsx:505-518) → **Raise an order** |
| Ops Receiving (warehouse count) | `/operations/intake`, `?delivery=<po_number>` | `Receiving`, receiving.tsx:181 | **Operations › Receiving** (ops-nav.ts:191-192); needs a warehouse sign-in |
| Outstanding (hidden) | `/procurement/outstanding` | outstanding.tsx | No menu entry; URL only (nav.ts:132-136) |

## A2. Branch tree

```
PO
├─ LIST (po.tsx)
│  ├─ Tabs "Active PO N" (ACTIVE, PARTIALLY_RECEIVED) · "Completed PO N" (FULLY_RECEIVED, SHORT_RECEIVED)
│  │   · "Cancelled PO N" (CANCELLED)  :199-211, :1308-1329. Phone: tabs move to the bottom drawer, " PO" dropped :1495-1506
│  ├─ Status words: "Active", "Partially received", "Closed short", "Fully received", "Cancelled",
│  │   "Offline", "Not sent"  shared.ts:198-208
│  │   ├─ Finished orders show a rubber stamp + the day (no plain word)  :705-724
│  │   ├─ Count waiting → the word is replaced by a blue "Review Count" button  :899-900; count-review.tsx:101-116
│  │   ├─ Count sent back to the warehouse → "Recounting"  :901-906 (from DC GET /api/v1/dc/purchase-orders/summary, crs.ts:39-51)
│  │   └─ Pending excess → "+N pcs over" next to the status  :743-747
│  ├─ Received cell "580 pcs (+20)" (red while not the whole order); cancelled tab hides Received  :566-604, :1235
│  ├─ Sort order: count to review first, then offline orders, then late orders  :406-423
│  ├─ Search box aria "Search orders" with supplier suggestions  :1385-1418; phone "Search Orders" :1483
│  ├─ Filters: DayRange "Issued", "Delivery Date"; "Clear filters"  :842-866; Columns menu "Group by supplier" :1455
│  ├─ KPI tiles "Orders" / "Still open" / "Overdue" / "On order"  :1288-1294
│  ├─ Phone summary sentence (e.g. "N orders in review", "No active orders.", "Nothing has been cancelled.")  :1869-1951
│  ├─ Empty states: "Nothing here yet." / "No order matches these filters."; loading "Loading the orders…"  :1527-1533
│  └─ Loads more pages as the table scrolls; footer "N orders of M"  :1094-1121, :1563-1575
│
├─ CREATE (composer.tsx). There is no draft and no approval step; Submit issues the order immediately
│  ├─ Title "New PO" → "Review this order"  :1963-1971
│  ├─ Fields
│  │   ├─ "Supplier" (required). Picker offers only ACTIVE + MERCHANDISE suppliers  :953-964, :2068-2118
│  │   │   └─ Last row of the picker: "Create a new supplier" (blank order and online only) → SupplierComposer,
│  │   │      which shows "Chosen as this order's supplier."  :2107-2115, :2487-2497
│  │   ├─ "Delivery Date" (required), day picker, nothing before today  :2123-2152
│  │   ├─ "Payment Terms" select (aria "Payment terms"), "None" plus active templates;
│  │   │   pre-filled from the supplier's own terms  :2154-2171, :1002-1009
│  │   ├─ "Payment Method" (required), aria "Payment method": "Choose a method" / "Giro" / "Transfer" / "Cash"  :2173-2191
│  │   ├─ Items section: "New item" button, disabled until a supplier is chosen  :2215-2228
│  │   │   ├─ Empty: "Choose a supplier, then add what is being ordered." / "Nothing on this order yet. Add what is being ordered."  :2232-2236
│  │   │   ├─ Per line: pencil (aria "Edit <name>"), bin (aria "Take <name> off this order")  :1268-1276, :2296-2302
│  │   │   ├─ Incomplete line: "Missing name, division, tags, purchase price, quantity" + "Complete" link  :2276-2289, :710-729
│  │   │   └─ Table columns: Item · Quantity · [Received] · Unit Price · Amount; Total / Discount · x% / Closed Short · N pcs / Grand Total
│  │   │      items-table.tsx:168-176, :236-300
│  │   ├─ Discount: "Discount Amount" (Money input, label "Discount agreed off the whole order") and
│  │   │   "Discount Percentage" (aria "Discount percentage"); typing one fills the other; capped at the lines' total  :2328-2372, :1287-1292
│  │   ├─ "Notes" textarea (aria "Notes")  :2393-2400
│  │   └─ "Terms and Conditions" textarea (aria "Terms and conditions"), default text from DEFAULT_TERMS  :2404-2411; shared.ts:240
│  ├─ "Add item" sheet (item-form.tsx), opened by New item / pencil / Complete
│  │   ├─ Title "Add item" (or "Edit line")  :796; composer.tsx:1849-1850
│  │   ├─ Fields: "Photo" (aria "Add a photo" / "Take a photo" / "Choose a photo" / "Replace the photo";
│  │   │   menu "Take a Photo" / "From Gallery" / "Edit Photo" / "Remove Photo"), "Name"*, "Description",
│  │   │   "Division"*, "Tags"*, "Quantity"* (aria "Quantity to order") + unit select (aria "Unit"), "Price"* ("/ pc" or "/ <unit>")
│  │   │   :859-1065, :1133-1183, :1293-1338. Colors / Sizes are NOT shown when adding to an order  :1189
│  │   ├─ Errors: "Give it a name." "Choose a division." "Choose at least one tag." "Fill in the price."
│  │   │   "Fill in how many." "Not a whole number of pieces."  :677-697, :1347
│  │   ├─ Buttons: "Cancel" · "Skip this one" (several queued) · "Add next item" (new item only) · "Submit"  :814-836
│  │   └─ Closing with unsaved input: dialog "Discard This Item?", buttons "Discard" / "Keep Editing",
│  │      body "What you typed and the photo will be lost."  :1381-1394
│  ├─ Same item added twice → merged into one line ("10 kodi + 2 pcs"); mixing per-SKU and whole quantities →
│  │   toast "Add it by colour and size, as the first one was."  composer.tsx:1111-1153, :1119
│  ├─ Limits (red banner): "A line is at most 999.999 pieces." / "A price is at most Rp 99.999.999 a piece." /
│  │   "An order comes to at most Rp 99.999.999.999."  :758-760, :1789-1802, :2202-2204
│  ├─ "Review order" is never disabled. If anything is missing it marks every gap and scrolls to the first:
│  │   "Choose a supplier." "Choose the delivery date." "Choose the payment method." "Add at least one item."  :1806-1824
│  ├─ Review step: "Back to editing" / "Submit" ("Submitting…")  :2011-2021
│  ├─ Submit online → new supplier items created first (POST /api/v1/suppliers/{id}/items), then
│  │   POST /api/v1/purchase-orders/catalog with an Idempotency-Key header  :1504-1697; q-proc.ts:903-913
│  │   ├─ Success → receipt popup "<PO-DDMMYY-NNN> created"; composer closes; the new row glows in the list  :1757-1778, :2531-2545; po.tsx:1350-1374
│  │   ├─ A photo failed to upload → toast "<names>: the photo could not be saved. Add it from the item."  :1752-1756
│  │   ├─ Server refusal → red banner with the server's message inside the composer  :2033-2035
│  │   └─ "Cancel PO" undo on the receipt exists in code but is switched off (SHOW_CANCEL_AFTER_CREATE = false)  :768, :2507-2527
│  ├─ Close with unsaved input (Cancel, ×, Escape, click outside) → dialog "Discard This Order?",
│  │   "Discard" / "Keep editing", body "Nothing has been saved."  :1374-1390, :2417-2427
│  └─ From the basket: supplier picker lists the baskets ("<Supplier> — N lines"); after the order is
│     raised its lines are removed from the basket (POST /api/v1/sourcing-basket/{id}/remove)  :2555-2559, :1731-1737
│
├─ OFFLINE CREATE (no connection, new orders only)
│  ├─ Warning banner: "You are offline. Submit keeps this order on this device and sends it when the connection is back."  :2027-2032
│  ├─ Submit keeps the order on the device (IndexedDB) → toast "Saved on this device. It will be sent when you are back online."  :1455-1502, :1700-1709
│  │   └─ Device storage refused → error "This device could not keep the order (its storage is full or blocked)…"  :1497-1501
│  ├─ The order shows on the Active tab only, status "Offline", card foot "Made <time>"  po.tsx:1133-1142, :761
│  ├─ Automatic sending: when the browser goes online, every 30 s, and at startup → toast "<PO> created"  outbox.ts:202-256, :262-295
│  │   └─ A reasoned 4xx refusal (not 401/408/429) → state "refused", status "Not sent"  outbox.ts:195-200, :244-251
│  └─ Offline order sheet: caption "Offline" or "Not sent"; banner
│     "This order is on this device. It will be sent by itself when you are back online." /
│     "This order has not been sent yet. It goes by itself in a moment." /
│     "The order was not accepted: <reason>. Edit it and submit again.";
│     buttons "Delete Order" (dialog "Delete This Order?", "Keep Order" / "Delete Order"), "Edit", "Send Now" (online only)  held.tsx:99-165
│
├─ ORDER SHEET (po.tsx:2031-2260)
│  ├─ Title = PO number; caption "Created by <name> · <day>"; status pill (open orders only)  :2219-2233
│  ├─ Facts "Supplier", "Delivery Date" (red when late), "Payment Terms" (only if set), "Payment Method",
│  │   "Received" ("x of y · Rp a of Rp b")  :2510-2551
│  ├─ Stamp over the document: "CANCELLED" / "FULLY RECEIVED" / "CLOSED SHORT"  :2482-2503
│  ├─ Sections "Items (N)", "Return PO", "Terms and Conditions", "Cancel Reason", "Notes"  :2553-2633
│  ├─ Per-line receipts: "Received" with "<day> · N pcs · M pcs not as ordered"  :2389-2419, :2642-2661
│  ├─ Count banner: "Counted at the warehouse" (who, when) / "Recalled by the warehouse" ("<who>, <when> · was N pcs") /
│  │   "Sent back to count" (with the buyer's reason)  :2338-2385
│  ├─ Footer: Print menu (icon) → "Print" / "Download PDF"; Paper "A5 landscape" / "A4 landscape" /
│  │   "A5 portrait" / "A4 portrait"  :2184-2188; print-menu.tsx:17-22, :71-96
│  │   └─ Read failure → toast "The orders could not be read. Try again."  :1793
│  ├─ EDIT (only when the server says editable)  :2121-2131
│  │   ├─ Opens the composer seeded with the order: title "Edit <PO>" → "Review the changes"; supplier read-only (aria "Supplier")  :1963-1967, :2087-2096
│  │   ├─ Goods already received → banner "Goods have been received on this order. Only the delivery date and the notes can change."
│  │   │   Lines, discount, payment terms and payment method are locked  :1280-1282, :2208-2214
│  │   ├─ Per-line locks: "This line is closed, so it can no longer be edited." /
│  │   │   "Goods were received against this line, so it can no longer be edited."  :225-233
│  │   ├─ Submit → PUT /api/v1/purchase-orders/{id} (every value sent) → receipt "<PO> updated" with the net amount;
│  │   │   closes both the composer and the order sheet  :1653-1696; po.tsx:2300-2316
│  │   ├─ Edit URL opened for an order the server won't let you edit → toast with the server's reason, or
│  │   │   "This order can no longer be edited."  po.tsx:2284-2294
│  │   └─ Server blocks edit when: "a cancelled order cannot be edited" | "only an order raised from a supplier catalogue can be edited" |
│  │      "this order has been fully received" | "every line on this order has been closed"  BE sync.rs:9060-9070
│  ├─ CANCEL (only when the server says cancellable)  :2152-2181
│  │   ├─ Count waiting or recount in progress → "Cancel" shown disabled, tooltip "A count is waiting. Review it first."  :2154-2163
│  │   ├─ Dialog title "Cancel <PO>?", body "The warehouse will stop receiving against this order. It stays on record as cancelled.",
│  │   │   optional field "Reason for Cancelling", buttons "Keep Order" / "Cancel Order"  :2165-2180
│  │   ├─ POST /api/v1/purchase-orders/{id}/cancel {reason} with Idempotency-Key → receipt "PO <PO> is cancelled."  q-proc.ts:941-955; :2068-2073
│  │   └─ Server blocks cancel when: "this order is already cancelled" | "this order has been closed" |
│  │      "goods have already been received against this order; close it short instead" |
│  │      "a supplier bill has already been matched to this order" | "money has been advanced against this order"
│  │      BE suppliers.rs:3812-3826 (enforced at :3887-3891); also returned on the detail read, BE sync.rs:9074-9089.
│  │      The server does NOT check for a waiting count; only the UI does
│  ├─ CLOSE SHORT from the sheet (only PARTIALLY_RECEIVED with pieces still owed)  :2134-2149
│  │   ├─ Dialog "Close This Short?", body "<N pcs> will be removed from the order, and the PO completes as received. This can't be undone.",
│  │   │   optional "Reason for Closing", button "Close Short"
│  │   ├─ One POST /api/v1/purchase-order-lines/{lineId}/close-short {closed_by, reason} per owing line;
│  │   │   empty reason becomes "Closed short from the order"; no receipt popup  :2090-2105; q-proc.ts:1003-1014
│  │   └─ Server errors: "this line was already closed short" | "nothing is outstanding on this line: x of y received" |
│  │      "closing a line short must say why the rest is not coming"  BE sync.rs:10288-10328
│  ├─ Outstanding screen (hidden): per line "Stop waiting for the rest" → reason input (required) + "Submit" / "Cancel"  outstanding.tsx:513-551
│  └─ "Review Count" (primary) when a count waits; Edit then shows as a ghost button  :2193-2202
│
├─ RECEIVE (warehouse side, Ops › Receiving: receiving.tsx)
│  ├─ List rows: "Count receive", or "Count again" after a recount/recall; "Counted" once sent  :359-385
│  ├─ Count sheet (blind count: the ordered quantity is never shown). Each amount: aria "Counted <unit> of <code>",
│  │   unit select aria "Unit counted for <code>", "Remove this amount"
│  │   └─ "Not as Ordered" / "Damaged or wrong items" field (one figure for the whole delivery, aria
│  │      "Unit for not as ordered"; error "Must be a whole number of pieces")  :1195-1260
│  ├─ "Submit count" ("Sending…") → reuses this supplier's open delivery that has no invoice yet, else
│  │   POST /api/v1/dc/goods-receipts; then POST /api/v1/dc/purchase-counts/batch → receipt "Count sent · N line(s)"  :694-760; dc.ts:177-288
│  ├─ "Recall Count" (only while a count is waiting): dialog "Recall this count?",
│  │   body "The count stays in history as Recalled. Stock does not change. You count again for the same arrival.",
│  │   button "Recall Count" → POST /api/v1/dc/purchase-counts/recall  :806-851, :987-1002
│  └─ Count exactly as ordered and nothing not-as-ordered → accepted automatically in the name of the
│     PO's creator; it never reaches Review Count  BE receiving.rs:1897-1990
│
└─ REVIEW COUNT (count-review.tsx); requires a warehouse (DC) session, opened silently (crs.ts:57-81)
   ├─ Title "Review Count" + icon (aria "The count differs from the order" / "The count matches the order"); "Close"  :155-180
   ├─ Facts "Supplier", "Counted"; when more than 4 lines, "Difference": "Matches the order" or
   │   "N of M items differ · x short · y extra · z not as ordered"  :641-697
   ├─ "Hide matched" switch (shown only when some, not all, lines differ)  :702-711
   ├─ Table: No. · Article · Ordered Quantity · Counted Quantity · Difference ("Matches" / "−N" / "+N");
   │   footer rows "Total", "Not as Ordered"  :827-956
   ├─ Return line: "N pcs extra will be returned to the supplier" / "N pcs not as ordered will be returned to the supplier" /
   │   "N pcs will be returned to the supplier · a not as ordered, b extra"  :981-1008
   ├─ BRANCH: short (counted less than owed)
   │   ├─ "Partial Receive" (tooltip "<N pcs> stay open on the order") → order becomes PARTIALLY_RECEIVED  :1071-1080
   │   └─ "Close Short" dialog (same wording as on the sheet; "Reason for Closing" optional) → accept, then close
   │      each short line, waiting for head office to receive it first; default reason "Closed short at count review"  :1055-1069, :503-511, :1495-1533
   ├─ BRANCH: no short (match, or over / not as ordered only) → "Submit"  :1083-1094
   ├─ Every accept: POST /api/v1/dc/purchase-verifications {decision:"Accept"} per count. If there is any over
   │   or not-as-ordered quantity, it waits for head office (up to 20 × 3 s) and then POSTs
   │   /api/v1/purchase-orders/{id}/returns {po_line_ids} automatically; there is NO option to keep the extra  :469-545, :1114-1145
   │   ├─ Receipt "N items received" (+ " · replacement recorded" when the PO is a replacement order)  :538-540
   │   └─ Errors: "The goods were accepted, but head office has not received them yet — return the extra from the order once it shows." /
   │      "<article> was accepted, but head office has not received it yet — close it short from the order once it shows as received." /
   │      "<PO> is not at head office yet."
   ├─ BRANCH: recount → "Recount" (lines that differ are pre-ticked) → checkboxes ("Tick every line"),
   │   question "Why should it be counted again?" (required), "Back", footer "N of M items ticked",
   │   button "Send N items back to count" → decision "Recount" → receipt "N items sent back to count"  :547-582, :963-975, :1020-1043
   │   (server: "a recount request must say what to look at again", BE receiving.rs:1562-1572)
   ├─ Warehouse sign-in switched off and nobody named → form "Who is verifying?" + "Submit"; all actions disabled  :346, :1465-1487
   ├─ Order cancelled → "This order is cancelled."; DC refuses with
   │   "this order was cancelled; its count cannot be received or sent back to count"  :609-611; BE receiving.rs:1618-1625
   ├─ Nothing waiting → "Nothing to review."; count already decided → "count <id> was already <status>"  BE receiving.rs:1610-1616
   └─ Invoice block ("Invoice for this order", "Invoice Number"*, "Invoice Total", "Invoice Date", "Upload invoice" / "Replace",
      "Accept the goods first.", "The invoice agrees" / "Rp X over|under the agreed price",
      "Invoice X was filed with receipt Y for several orders.") → POST /api/v1/dc/goods-receipts/{id}/invoice and
      /invoice-document  :1160-1361. **Looks unreachable:** accept calls onClose() straight after setAccepted (:541-542)
```

**Discount and price rules**
- Unchanged catalogue prices are sent as absent; the server fills in the catalogue price (composer.tsx:1416-1444).
- On an edit every value is sent (composer.tsx:1653-1692).
- A line priced per unit uses `order_unit_price_minor`, total rounded once (shared.ts:243-255).
- The discount is shared across lines by piece (shared.ts:261-272).

**Accounting note:** the excess on a receipt is never stock value or a payable, so a Return PO reverses nothing in Finance (BE purchase_returns.rs:20-22).

---

# B. Return PO (purchase returns to the supplier)

## B1. Screens and how users get there

There are two kinds of return in one list:
- **Excess returns**, numbered `RS-00000001` and raised from a PO. Counter: `RS-{seq:08}`, BE purchase_returns.rs:179.
- **Register returns**: returns from head-office return stock, stored as allotments with a surat (numbered letter) issued on confirm.

| Screen | Route | Component | Menu |
|---|---|---|---|
| Buyer list (read-only) | `/procurement/returns`, `?allotment=<id>` opens the sheet, `?q=` searches | `SupplierReturns` sr.tsx:303 | **Procurement › Return PO** (nav.ts:113-114), badge = open returns (badges.ts) |
| Return sheet | same, `?allotment=` | `ReturnSheet` sr.tsx:473 | Row click; also the link from a PO sheet's Return PO section (po.tsx:2759-2765) |
| New register return | page state, not a route | `NewReturn` sr.tsx:854 | **New return** button, phone round button "New Return" (sr.tsx:397, :401) |
| Warehouse hand-over | `/operations/board/suppliers` | `SuppliersBoard` ops-suppliers.tsx:65 | **Operations › Return PO** (ops-nav.ts:219-220); needs a warehouse sign-in |

The comment at nav.ts:110-113 says this screen pre-filters the allotment book. That comment is out of date: the route is mapped to `SupplierReturns` (index.ts:21).

## B2. Branch tree

```
RETURN PO
├─ RAISE
│  ├─ (a) Automatically, when the buyer accepts in Review Count with over / not-as-ordered quantity  count-review.tsx:512-514
│  ├─ (b) Manually from the PO sheet's "Return PO" section (only while excess is still pending)  po.tsx:2669-2815
│  │   ├─ Lists each line "+N pcs"; button "Return <N pcs> to supplier"
│  │   ├─ Dialog "Send the Excess Back", body "These N came beyond the order and go back to <supplier>. The warehouse hands them over.",
│  │   │   button "Raise the Return"
│  │   ├─ POST /api/v1/purchase-orders/{id}/returns {} (all pending excess) → receipt "RS-xxxxxxxx raised", "N pcs to <supplier>"
│  │   ├─ Server: 409 "nothing on <PO> arrived beyond the order that is still waiting to go back"  BE purchase_returns.rs:155
│  │   └─ Return cards on the PO sheet: status "Not Generated" | "Generated" | "Confirmed"; lines split into the article and
│  │      "Not As Ordered · Item unknown" (no value shown)  po.tsx:2749-2797; return-lines.ts:9-44
│  └─ (c) Register return: "New return" → page "New Return PO" with "Back"  sr.tsx:854-1136
│      ├─ Supplier list (from return stock, "N in return stock"; empty "Nothing in return stock." / "Reading the stock…")
│      ├─ "Why": "Over-delivery" | "Items don't match the order"; "Taken from" pool select (only if more than one pool)
│      ├─ Table Items · Available · To Return (aria "Return <SKU>"); empty "Nothing of this supplier in return stock."
│      ├─ "Settle by": "Replacement" | "Refund" | "Credit note"
│      └─ "Confirm" ("Confirming…") → POST /api/v1/supplier-returns {supplier_id, reason, settle_by, source_pool_id, lines} with
│         Idempotency-Key → receipt "Return confirmed · surat <no>" / "Return confirmed"  q-sr.ts:94-101
│         Data reads: GET /api/v1/inventory/fleet-pools, /inventory/availability, /inventory/sku-suppliers
├─ LIST (Procurement)
│  ├─ Tabs "Open N" / "Completed N"; "Suppliers still owe Rp X"; search aria "Search returns" (phone "Search Returns")  sr.tsx:358-399
│  ├─ One card per supplier: "<n> POs", pieces, items · Rp; columns PO (PO number over RS number) · Quantity · Value ·
│  │   Received Date · Status (Person in Charge hidden here)  srg.tsx:94-187, :219-243; sr.tsx:431-436
│  ├─ Status for excess returns: "Not Generated" (amber) → "Generated" (blue) → "Completed" (green)  srg.tsx:37-42
│  ├─ Status for register returns: "To hand over" | "Waiting on supplier" | "Partly settled" | "Settled" | "Closed short"  q-sr.ts:133-139
│  ├─ Reason: "Over-delivery" | "Not as ordered" | "Over-delivery · Not as ordered" (excess);
│  │   "Over-delivery" | "Items don't match the order" (register)  sr.tsx:259-263; q-sr.ts:122-125
│  └─ Empty "Nothing here."; loading "Reading the returns…"
├─ SHEET (sr.tsx:473-846)
│  ├─ Title = supplier, number underneath; tag = reason in Title Case; header buttons "Print" / "Download"
│  │   (when the sheet has no extra step in its footer)  :612-645
│  ├─ Facts "Person in Charge", "Settle by", "PO" (link to /procurement/orders?order=), "Surat" (link to /letters?letter=), "Settled" bar
│  ├─ Items table Item · Quantity · [Value]; row "Not as Ordered" / "Item Unknown"; "Total"  :751-831; return-lines.ts:51-54
│  ├─ Stamp "COMPLETED" / "CLOSED SHORT"; "Activity" fold: Raised · Surat <no> · To hand over / Handed over ·
│  │   Replacement on PO <no> · settlements · Closed / Settled / Closed short  :542-605, :692-699
│  └─ Register returns only (WAITING or PARTLY_SETTLED): footer "Rp X owed"
│      ├─ "Expect replacement" → POST /api/v1/purchase-orders (direct PO "RPL-<RS no>", price 0,
│      │   note "Replacement for <RS no>") → receipt "Replacement expected"  :656-665, :524-536; q-sr.ts:253-283
│      │   (on receipt, Review Count records the settlement: POST /api/v1/supplier-returns/{id}/settlements, kind REPLACEMENT)
│      └─ "Close Short" dialog "Close <RS no> Short?", body "Rp X owed is written off.", optional "Reason" →
│         POST /api/v1/supplier-returns/{id}/close-short → receipt "Closed short"  :666-680, :492-498
├─ DC HAND-OVER (Ops › Return PO, ops-suppliers.tsx); only excess returns that are OPEN on the warehouse server
│  ├─ Supplier card button "Generate Delivery Note" → sheet "Generate Delivery Note": "Person in Charge"* (prefilled
│  │   with the signed-in user), table "In this note" (PO · Items · Quantity), button "Generate Delivery Note" →
│  │   POST /api/v1/dc/purchase-returns/note {return_ids, pic}  :224-230, :238-314; api.ts:260-270
│  │   Server: "say who is in charge of this delivery" | "no returns were named" | "one of those returns is not open here any more"
│  │   BE returns_supplier.rs:351-371
│  ├─ Once generated: icon buttons "Print" / "Download" and a "Confirm" button  :195-222
│  ├─ "Confirm" → dialog "Confirm <supplier>?", body "N returns, M pcs go back to <supplier>.", "Cancel" / "Confirm" →
│  │   POST /api/v1/dc/purchase-returns/{id}/hand-over {actor_id, handed_to:null, idempotency_key} per return →
│  │   "Sent back to <supplier>." with "Close" / "Done"  :372-445; api.ts:274-288
│  │   Server: "<RS> has already been handed to the supplier" | "generate the surat jalan for <RS> before it is handed over" |
│  │   "<RS> has no lines to hand over" | "...not in the Gudang's receiving stock..." |
│  │   "...only N of that delivery are still unidentified here"  BE returns_supplier.rs:159-251
│  └─ Search aria "Search returns"; empty "Nothing going back." / "Nothing matches."
├─ SURAT JALAN RETUR (return delivery note)
│  ├─ Print: HTML window titled "Surat jalan retur <supplier>"; heading "SURAT JALAN RETUR"; "Tgl", "No PO", "Kepada :",
│  │   "Telp."; table Item / Quantity / Total; signature "Hormat kami," ( <PIC> ) "Pengirim"  return-print.ts:94-164
│  └─ PDF: A4, file name "surat-jalan-retur-<supplier>.pdf"  return-pdf.ts:26-181
├─ CANCEL / EDIT a return: no UI and no endpoint for either type (BE route list /Users/hari/Documents/itulah/backend/src/cloud/http/mod.rs:192-201, :928-935);
│   noted as a gap in /Users/hari/Documents/itulah/docs/research/2026-10-09-goods-flow-reversibility-map.md:72, :129
└─ SUPPLIER CREDIT / ACCOUNTING (register returns only; excess returns carry no value, shown as "—")
   ├─ Refund: Finance BKM (cash receipt) field "Refund for return" → settlements kind REFUND
   │   /Users/hari/Documents/itulah/frontend-hub/src/screens/finance/cash-documents.tsx:1839-1848, :2027-2032
   ├─ Credit note: Finance credit note field "Settles return" → kind CREDIT_NOTE
   │   /Users/hari/Documents/itulah/frontend-hub/src/screens/finance/credit-notes.tsx:588-597, :719-725
   └─ Picker shows "<Settle by> · Rp X owed"  /Users/hari/Documents/itulah/frontend-hub/src/screens/finance/return-picker.tsx:40-59
```

---

## C. Permissions

**Head office (cloud) API**
- All `/api/v1/purchase-*`, `/suppliers`, `/supplier-items`, `/supplier-returns` and `/sourcing-basket` need at least the SUPERVISOR role, reads included (BE auth.rs:230-258).
- Writes need the `procurement` section:
  - Purchase orders and PO lines can also be read by finance, inventory and operations.
  - `/purchase-returns` can also be read by merchandise, inventory, operations and finance.
  - Source: BE job_role.rs:237-262.
- I found no section rule for `/supplier-returns`.

**Who does what**
- Raising, cancelling, closing short and raising a return are recorded under the signed-in user. There is no check that only the PO's creator can do them.
- Reviewing a count is a role permission. The same person may count and accept (count-review.tsx:76-78; BE receiving.rs:1903-1905).
- Every warehouse step (count, verify, recall, delivery note, hand-over) needs a warehouse session through the Operations sign-in gate.
- The test rig's users: **rina** buys and reviews counts, **nina** counts and hands over, **yusuf** records invoices.

## D. Prerequisites and the API seeding scripts

| Branch | Needs |
|---|---|
| Create | ACTIVE MERCHANDISE supplier; vocabulary (`/api/v1/catalogue/vocabulary`); units; `/api/v1/purchase-destinations`; online, except the offline path |
| Edit / Cancel | A catalogue-raised PO with nothing received, billed or advanced and no count waiting |
| Close short on the sheet | A PARTIALLY_RECEIVED PO |
| Review branches | A count awaiting review with a mismatch (an exact count is accepted on its own) plus a warehouse session |
| Raise a return by hand | An accepted count with excess still pending; easiest via the API, because the UI raises it automatically |
| Ops hand-over | An OPEN excess return; note generated first |
| New register return | Stock in the head-office RETURN pool, with the SKUs mapped to suppliers |

**run.py**
- Rig: cloud :8480, DC :8481, store :8482 (`:37`). Password "Password01". The helper adds an Idempotency-Key to every call.
- `make_item` (:195-208): supplier with code "0001"; POST `/suppliers/{id}/items` with code `<tag>-KAO`, price 40000, division PRIA, tag KAOS, colours BLACK/WHITE, sizes 03/04.
- `place_po` (:211-228): POST `/purchase-orders/catalog` with promised date today + 3, base price 99000, four variants. It sends no `payment_method`.
- `dc_line` (:231-234): polls GET `/dc/purchase-orders`.
- `count_and_verify` (:237-265): POST `/dc/goods-receipts` → POST `/dc/purchase-counts` (single line, with `wrong_quantity`) → POST `/dc/purchase-verifications` (an "already accepted" error counts as auto-received) → invoice.
- Phase 4 variants (:512-658):
  - `v_short`: 5 of 8 counted, then close-short on the line.
  - `v_over`: 11 of 8, raise a return, then DC hand-over with `handed_to` "Pak Joko".
  - `v_wrong`: 10 counted with 3 not as ordered → 7 received / 1 owed / 3 excess; return; hand-over; close the rest short.
  - `v_recount`: Recount, then 8 counted and accepted. Line 622 uses the wrong key `invoice_unit_price_minor` (should be `invoiced_price_minor`).
  - `v_reject`: POST `/dc/goods-receipts/{id}/reject`.
  - `v_cancel`: checks `cancellable`, POST `/cancel`, then checks the DC no longer lists the PO.

**review_states.py**
- Runs against the single-node `dcnative-cloud` rig at :8495. Helpers: `supplier_and_items` (:70-87), `place_po` (:90-102), `count` (:129-142), `accept` (:145-152).
- It leaves these orders behind, which are good fixtures for the UI tests:
  - **Waiting for review:** OVER 100→130, SHORT 100→70, OVER+SHORT on 2 lines (120 and 70 of 100 each).
  - **PASS** 100→100, received automatically → FULLY_RECEIVED.
  - **CLOSE-SHORT** 60 of 100 → SHORT_RECEIVED.
  - **PARTIAL-3X:** 100 + 100 + 60 of 300 → PARTIALLY_RECEIVED.
  - **FULL-2X:** 120 + 80 of 200.
  - **RETURN:** 150 counted with 20 not as ordered, accepted, POST `/returns`, then found in `/purchase-returns`.

## E. Known bugs and edge cases

From `/Users/hari/Documents/itulah/E2E-TEST-REPORT-2026-10-02.md` and `/Users/hari/Documents/itulah/E2E-REPORT-A-procurement.md`. Many of those reports' button labels are now out of date ("Create order", "Receive N pcs", "Keep them on order" radios, "Return the extra", "Cancel the order", "Record the invoice", "Beyond the order", "Browse catalogue").

1. **Cancelled PO still receivable (Critical 1):** largely fixed. The UI disables Cancel while a count waits and the DC refuses to verify a cancelled PO. But the server's cancel check still ignores a waiting count, so cancelling through the API is still possible.
2. **One goods receipt and invoice shared across several POs (Critical 2):** still possible. The count sheet reuses the supplier's open, un-invoiced delivery (receiving.tsx:705-710). The UI now says "…filed with receipt … for several orders."
3. **Same person can't review their own count (High 5):** fixed; review is role-based now.
4. **PO Activity misses create, edit, cancel and recount send-back (High 6):** not re-checked.
5. **Closed-short PO still listed in Ops Receiving as "Count receive" (High 7):** not re-checked.
6. **Invoice box "Price for what was counted" included over-delivered pieces (Medium 15):** fixed; now uses min(counted, owed) (count-review.tsx:1232-1237).
7. **Escape closed the whole New PO composer without asking (Medium 16):** the composer now asks to discard. Untested whether Escape inside a nested popover still closes everything.
8. **"Count sent" banner carried over to the next PO (Medium 17):** fixed; it is now a receipt popup and resets per PO.
9. **Hand-over without a delivery note:** the cloud-hosted DC refuses it. run.py `v_over` / `v_wrong` hand over without generating a note, so they may fail on the cloud-native rig.
10. **No catalogue browse in the blank composer:** `CataloguePicker` (pick-items.tsx) is never used. Existing catalogue items only reach a PO through Sourcing → Basket.
11. **Invoice block after accept looks unreachable** (count-review.tsx:541-542; see A2).
12. **Thresholds:** the "Difference" summary appears only with more than 4 lines; "Hide matched" only when some but not all lines differ (also noted in `/Users/hari/Documents/itulah/docs/research/2026-10-08-po-film.md:392`).
13. **Retries after accept:** both the automatic return and close-short poll for up to about 60 s before showing an error.
14. **Missing UI pieces:** rejecting a delivery at the dock has no button in the hub, only the API (po-film.md:391). Cancelling or editing a return has no UI and no endpoint.
15. **Return PO flow** per `/Users/hari/Documents/itulah/docs/research/2026-10-09-po-store-return-flow-comparison.md:18-41`: over and not-as-ordered quantities always go back; there is no option to keep them.
16. **Recall by the counter:** the reversibility map (:123) says it was missing; it now exists (receiving.tsx:806-1002).