# Outbound & Allotment — branch map (9 Oct 2026)

Read from the source and from DOM dumps of the running hub on the `agentic` rig. Paths are relative to
`frontend-hub/src/screens/` (hub) unless a prefix says otherwise. Sheets are in the URL (`lib/sheets.ts`), so every
sheet below can be deep-linked.

**The rig runs an *edge* DC node** (`/api/v1/health` → `dc_hosting: "edge"`). Every allotment made through the cloud
API is therefore *DC-owned*: `activation_target_origin_id = "dc"`, `execution_authority = "EDGE_DC"`, and the DC has to
**accept** it (`edge_application_status` PENDING → ACCEPTED, a few seconds after a sync) before it can be cancelled.
The cloud-only routes of `docs/research/2026-10-09-outbound-cancel-edit-build.md` (amend, `/work`, move back, owed,
short-picks) do not exist on this rig: `/allotments/{id}/work` → `409 Edge-owned allotment is worked by its DC`,
`/api/v1/dc/short-picks|owed|move-back` → 404 on the DC. Those branches are catalogued and written, then skipped
(`RIG_DC_HOSTING !== 'cloud'`).

## 1. Routes and menus

| Screen | Route | Component | Way in |
|---|---|---|---|
| Allotments (5 tabs) | `/allotment` | `Allotments` allotment/allotments.tsx:~560, mapped allotment/index.ts:11 | Sidebar **Merchandise › Allotments** (nav.ts:47) |
| New allotment grid | `/allotment/new?supplier=<code>&articles=<article_id,…>` | `NewAllotment` allotment/matrix.tsx, index.ts:12 | Unallotted tab › **Make new allotment** (to-allot.tsx:40,191); hidden nav row nav.ts:66 |
| Edit / Re-allot | `/allotment/new?allotFrom=edit~<id>` / `reallot~<id>` / `topup~<id>` | same | sheet **Edit** (allotments.tsx:1503); `draft.ts:allotFromValue` |
| Allotment sheet | `/allotment?allotment=<id>` | `AllotmentSheet` allotments.tsx:~1370 | row click |
| Return to HO | `/allotment/returns` | `ReturnsToHo` returns.tsx:~60 | Sidebar **Merchandise › Return to HO** (nav.ts:61) |
| Ops › Allotment board | `/operations/board` | `Board` operations/board/board.tsx | Sidebar **Ops › Allotment** (ops nav.ts) |
| Ops › Return from Store | `/operations/board/returns` | `StoreReturnsBoard` board/returns.tsx | Sidebar **Ops › Return from Store** |
| Picking | `/operations/picking` (hidden row) | `Picking` picking/picking.tsx; sheets also mounted on the board (`PickSheets`) | board card, or URL |
| Packing | `/operations/packing` (`?pack=<store_id>`, `?koli=<id>`) | `Packing` packing/packing.tsx | board card |
| Dispatch | `/operations/despatch` (`?new-dispatch=true`, `?shipment=<id>`) | `trucks.tsx` | board **Dispatch** button |

Ops screens sit behind `OperationsGate` (gate.tsx): on an edge DC it signs the cloud identity in to the DC
automatically (nina / yusuf). Every Ops screen reads the DC node's `/api/v1/dc/*`.

## 2. Allotments page (`/allotment`)

* Header **Allotments**, sub "What each store has been promised, and how much of it has arrived." (allotments.tsx:789)
* KPI strip (desk): **Active · Completed · Not shipped yet · In transit** (811–846). Phone: one sentence instead.
* Tabs (`SubTabs`, role `tab`, name carries the count): **Unallotted n · Allotted n · Overdue n · Still needed n · Closed short n** (852). Default tab = Unallotted (store book).
* **Unallotted** (`ToAllot`, to-allot.tsx): suppliers fold open with their articles; textbox *Search supplier, article or order*; checkboxes `Select <article name>` / `Select every article of <supplier>`; after ticking: bar "`N article(s) · N supplier(s) · N pcs selected`" with **Clear** and **Make new allotment**; empty "Nothing left to allot. Every piece in the warehouse has been given to a store." / "No supplier, article or order matches “q”." Free pieces are read from pool `dc.warehouse` with `held=true`.
* **Allotted** (`DataTable`): a *Reading* select (aria-label `Reading`: **Allotments · By store · By article**), expanding search *Search allotments*, filter/sort sheet, **New allotment** button (→ Unallotted tab). Columns Allotment, Store, Quantity, Created, Supplier, Status, Picked, Packed, Dispatch (some behind Columns). By store: pick a store → Metrics **Allotted · Received · To receive · SKUs** and "This summary spans every allotment ever addressed to <store> — not only the ones listed below." Empty: "Nothing here yet." / "Choose a store to see everything owed to it, and its lifetime per-SKU pipeline." / "Nothing has ever been allotted to this store." Warn banner "N SKUs are promised past what the warehouse holds." + Show/Hide.
* **Overdue**: active allotments older than the business clock allows (`overdue-data.ts`); **Still needed**: lines the picker could not finish (`UnfilledPanel`, **Close remaining** → ConfirmButton "Close remaining?", description "`<store>` gets X of Y."); **Closed short**: the lines MD closed. The server lists a Still-needed line only after a count booked pieces Missing, or a short pick (cloud DC).
* Endpoints: `GET /api/v1/inventory/allotments?status=ACTIVE|FINISHED`, `…/by-store/{id}`, `…/by-article`, `…/unfilled`, `POST …/{id}/close-short`.

## 3. New allotment grid (matrix.tsx)

* Heading `New allotment · <supplier>` (1157), sub "`N article(s) · N pcs to allot`". **Back** (a ConfirmButton once pieces are typed: "Discard the typed quantities?" / "Going back to the articles clears the quantities typed for this allotment." / **Discard**).
* Columns **Article · Stock · C001 Cikupa … C016 Cirebon (16 stores) · Left**. Article row: chevron fold, wand button `Fill <article>`, free pieces. SKU rows: `Black · M` + code; **cell = textbox `aria-label="<sku> to C001 · Cikupa"`** (matrix.tsx:2529,2642): digits only; capped at `free − what the other stores of the row took` (flash); title "Nothing of this SKU is left free in the pool".
* **Whole-article rule** (`standing.whole = prefill === null`): a fresh allotment must give **every** free piece of the article away. Row note "`Allot all N pieces — M left`" (warn) until `0 left` → "`All N allotted`" (ok). A prefilled grid (re-allot / top-up) shows "Top-up: adds to the allotment" instead.
* Article-row button **Submit** (disabled with title "Every piece has to go to a store before this article can be saved" while pieces are left). Footer summary: **Articles · SKUs · Pcs · Lines · Stores**, "`N ready — Submit on its row`", "`N article(s) still has/have stock left`", "`N pieces on rows the filters hide`", **Clear**, **Submit all**, **Done** / **Submit all & done**. Receipt "`Saved ALT-… (Article).`"; banner on refusal "`<article>: <problem>`"; "Promised past what the pool holds free: …"; "Finish X (stock left) or clear them before moving on."
* Wand menu (quick-fill-menu.tsx:76–200) — **bug:** `run()` closes with `setOpen(false)` so `onOpenChange` never resets `view`/`query`; the next opening starts inside the sub-menu the last fill used: **Everything to one store…** (textbox `Find a store`, then a store row), **Split evenly across all stores**, **Split evenly across chosen stores…**, **Clear this article**; toast "`Filled N SKUs · N pcs`" / "`Cleared N pcs`" with **Undo** (top-centre, 8 s).
* Create: `POST /api/v1/inventory/allotments/batch` (one allotment **per article**, lines per SKU × store, `idempotency_key` per article, 10 per chunk); response items carry `id`, `allotment_number`, `edge_application_status`.
* Edit page (`allotFrom=edit~id`): heading `Edit <ALT-…>`; DC-owned → EmptyState "This allotment is run by its DC; edit it from the allotment."; cancelled → "This allotment is cancelled."; cloud-run → grid filled, floors from `sent_quantity` (cell title "N already sent: it cannot go lower"), **Was / Now**, "No changes yet" / "`N line(s) changed · N line(s) added`", "Too many: …", **Save changes** → `POST …/{id}/amend`, toast "`ALT-… saved`" (+ " · N the warehouse moves back").
* Re-allot (`reallot~id`): chip "`Re-allot of ALT-…`" (✕ `Clear`), cells prefilled with what was released.

## 4. Allotment sheet (allotments.tsx 1370–1946)

* Dialog title = number; caption "`Created <date> by <actor>`"; pill **Cancelled** (tone bad) when `cancelOf(record).cancelled` (status CANCELLED, `cancelled_at`, or a CANCEL amendment).
* Banners: edge PENDING "Waiting for the DC to accept this allotment. It can't be closed short until then."; REJECTED "The DC refused this allotment."; owed>0 "The warehouse still has to move back N …" (cloud); `receiving_gap_qty>0` "N were handed over but not found at the store. Inventory is looking into it."; "The received count and the scanned tags disagree."
* Facts when cancelled: **Cancelled by · On · Reason**. Section **Lines** (matrix: Article, one column per store, **Total**; per-SKU rows `Colour · Size`, code) and **History** (button *Activity (n)* → Timeline: *Created*, *Close short requested*, *Closed short*, *Quantity reduced/added*, *Cancelled*).
* Foot (only while `fulfillment_status = ACTIVE` and not cancelled): danger **Cancel allotment** (disabled when nothing is left unsent `to_pack_qty = 0` on DC-owned, a cancellation exists, the DC has not ACCEPTED, or no actor); note "Everything has already been sent."; primary **Edit** — DC-owned: ConfirmButton "Edit this allotment?" / "`N pcs still to pack opens in New allotment, filled in, to change and save. This allotment is replaced.`" / reason optional (defaults "Edited") → closes it (`cancel`) and opens New allotment `reallot~id`; cloud-run: link to the Edit grid.
* **Cancel dialog** (cancel-dialog.tsx): `Cancel <ALT-…>?`; DC-owned/simple: "`N pcs still to pack is released. Anything already picked stays picked.`"; cloud-run: rows *To pick / Picked / Packed / Sent* from `GET /allotments/{id}/work`, red tick "The warehouse has to move back N that are already picked/packed." required when work is owed; required **Reason** radiogroup (Wrong quantity · Wrong store · Stock problem · Supplier · Other), **Note**; **Keep** / **Cancel allotment** (disabled until a reason). Result string `"<chip> · <note>"` (`reasonOf`). SavedDialog: "Sent to the DC. Cancelling" (edge PENDING) or "`ALT-… cancelled`" (+ "N the warehouse moves back").
* Endpoints: `GET /api/v1/inventory/allotments/{id}` (lines carry `to_pack_qty, picked_quantity, packed_quantity, at_*_qty, closed_short_qty, target_quantity, sent_quantity`), `POST …/{id}/cancel` → `edge_cancellation_status` PENDING; DC applies it within ~10 s → status CANCELLED (nothing picked) or `cancellation.status = PARTIALLY_APPLIED` with `blocked_picked_quantity` (picked pieces stay) and status IN_PROGRESS. `cancel` before the DC accepted → `409 Edge-owned Allotment must be accepted by its DC before cancellation` (backend cloud/postgres/allotments.rs:639). After everything is dispatched → `409 allotment must have remaining active quantity, currently DC_COMPLETED`.

## 5. Ops › Allotment board (`/operations/board`)

* Header **Allotment**; **Board | Table** switch (localStorage `hub.outbound.view`; phone is always Table); `Search the board` textbox; `Store` select (All stores + only stores with cards). Polls every 30 s.
* Lanes (`section aria-label` → role *region*): **Pick List · Picked · Pack · Dispatch · Received** (board.tsx:638/676/717/791/828). A lane with no cards is named "`<title>, empty`".
  * Pick List card (one **per allotment × shop**): button name "`C005 · Jambi / 2 SKUs / ALT-… / 5 pcs / Pick`"; strip "Short pick" when flagged (cloud DC). Opens the Accept sheet (`?accept=<allotment_id>~<store_id>`).
  * Picked card (one **per shop**, all its picklists): "`C006 · Wiramode / 1 picklist | 2 allotments / ALT-… / N pcs / Pack`"; opens the Pack sheet (`/operations/packing?pack=<store_id>`); cloud DC adds *Edited −N* strip, **CANCELLED** stamp and **Move back**.
  * Pack card (one **per sealed carton**): "`C013 · Wonosobo / A00015 / 2 pcs`", checkbox `Select A00015` (disabled, title "Holds pieces MD took out. Move them back before it can go." when owed), lane head **Select All**, lane foot **Dispatch** / **Dispatch (n)**. Opens the Carton sheet (`?koli=<id>`).
  * Dispatch card (one **per delivery note / shop**): "`C002 · Muaro Bungo / 1 carton / DSP-HO-GUDANG-000010 / 3 pcs / 10m ago`" or flag "Late · left …" after 3 days. Opens the delivery-note sheet (`?shipment=<id>`).
  * Received card: from `GET receivedShipments(since 7 days)` (cloud): "`C001 · Cikupa / 1 carton / DSP-… / 15 pcs`".
* Table view (`stage-table.tsx`): columns **No., Shop, Stage, Doc, Pcs, Detail, Time** + action (**Pick / Pack / Move back**), stage names *Pick list · Picked · Pack · Dispatch · Received*.
* Drag-and-drop between lanes (desktop): `to-pick>to-pack` opens Accept, `to-pack>packed` opens Pack, `packed>in-transit` opens Dispatch with the card, `to-pack>to-pick`/`packed>to-pack|to-pick` open Move back (cloud DC), a card that owes pieces gives toast "Move back N pcs first". (Pointer-based drag is not scripted.)
* Move back dialog (`board/move-back.tsx`, cloud DC): `Move back from <shop>`, *To* group, steppers `Move back <sku>`, "Choose what goes back.", **Move back N to <where>**.

## 6. Picking

* Accept sheet (`AcceptSheet`, picking.tsx:~1040): title **Picklist**, caption "`<shop> · <ALT-…>`"; Facts **Shop · Allotment · Request at · Pcs** (+ **Short pick** reason · reporter · time when one is open); table *Article | Request Quantity | Picked* (desk) with a stepper per SKU: `One less`, textbox `Picked` (digits, clamped 0…outstanding), `One more`; phone: rows `"<title>, picked N of M"` + NumberPad. Rack select `Rack` (only when > 1 warehouse pool).
* When a line is lowered: `role=status` "`N pcs short`" + " · choose why" and **Why?\*** chips (toggle buttons): *Stock at rack could not be confirmed · Item not found at the rack · Item damaged · Label or equipment problem · Other* (changes.ts:26). The first three are stock-related (raise a TARGETED count "Short pick" in the cloud). **Submit** is disabled until a chip is chosen. Footer **Submit** → `POST /api/v1/dc/picklists` `{source_pool_id:"dc.warehouse", lines:[{sku_code,quantity}], destination_id, allotment_id, actor_id, idempotency_key}`; then the sheet swaps to the **Picklist** it made (status *Completed*, Facts Raised/Shop/Allotment/Picker/SKUs/Pcs/To pack, table *Article | Picked | To pack*, link **Pack**) — the `Picklist accepted` SavedDialog (picking.tsx:1247) lives inside the closing accept sheet and is never seen — or, for a short pick, toast "Short pick reported · N pcs" and one `POST /api/v1/dc/short-picks` per short SKU (**cloud DC only; 404 on this rig → "The pick is in. The short pick report did not reach the server. Try again." + Retry**).
* There is **no "Cannot continue picking" label** in the UI: that is the build doc's name for the "Why?" report. The shortfall stays on the same picklist: `GET /api/v1/dc/picklist/allotments` keeps the card with `outstanding = asked − picked` (verified: 3 of 4 picked → card shows 1 pcs).
* Picking page (`/operations/picking`): KPIs **Picklists to pick · Pcs to pick · Picked today · To pack**; card **To pick** grouped by shop ("`N picklist(s) · N`"), card **Picklists** with a Segmented *All n · Completed n · Closed short n*, table *Request at, Shop, Allotment, SKUs, Pcs, To Pack, Status (Completed | Closed short | Short pick)*; empty "Nothing is waiting to be picked right now." / "Nothing has been accepted yet."
* Endpoints (edge/http.rs:152–158): `GET /api/v1/dc/picklist/allotments`, `GET|POST /api/v1/dc/picklists`, `GET /api/v1/dc/picklists/{session}`.

## 7. Packing (from the picklist, no RFID)

* Pack sheet (`PackSheet`, packing.tsx:~788): title **Pack**, caption shop; Lines table *Article | Stock | Pack* (Stock = still waiting from the shop's ticked picklists), textbox `Pack <sku_code>` (clamped to Stock); footer "`Enter what went in the carton`" → "`N items · N pcs`"; **Pack and seal** (disabled until a quantity). `POST /api/v1/dc/packs` `{destination_store_id, lines, pick_session_ids, seal:true, idempotency_key}` → manifest `{koli:{koli_id, koli_number "A000nn", unit_count}}`; over-asking → `409 only 3 of <sku> from these picklists is waiting to be packed; 4 was asked for` (edge/sqlite.rs:5584). SavedDialog **Packed** with Facts *Shop, Carton, Pcs* and a Packing list print.
* Packing page: KPIs **Shops to pack · Pcs to pack · Sealed today · Pcs sealed**; cards **To pack** (shop rows, "N picklist · N pcs to pack", **Pack**) and **Cartons** (*Carton, Shop, Pcs, Sealed*, per row **Packing list**); search *Search cartons*. Carton sheet (`?koli=`): Facts *Shop, Pcs, Status, Packing, Sealed*.

## 8. Dispatch (trip data note = surat jalan + in transit)

* Sheet **Dispatch** (trucks.tsx:~560): caption "Tick the cartons going on this trip. One delivery note for the trip, made the instant it departs."; left rail **Shops** ("N going") with a button per shop; right: shop name, "Going on this trip." / "Not going on this trip.", table *Carton | Pcs | Sealed* with checkboxes (`Every carton`, one per carton named by its number); **Trip data** textarea; footer "`Tick the cartons going on it`" or "`1 trip · 1 delivery note · N store(s) · N carton(s) · N pcs`"; button **Dispatch and print delivery note** (→ "Dispatching…"). Opened from the board with only the ticked cartons ticked ("handoff").
* `POST /api/v1/dc/dispatch-trips` `{koli_ids, trip_note, actor_id, idempotency_key}` → `{dispatch:{dispatch_number "DSP-HO-GUDANG-0000nn", trip_note, shipment_count, unit_count}, shipments:[{shipment_number "SJ-…", destination_store_id, position:"IN_TRANSIT"}]}`; one surat jalan per shop, one trip, goods in transit at once. SavedDialog "1 delivery note · in transit" then the print preview. Refusals: `409 carton A00017 is already on a trip (SJ-…)`, `400 a dispatch needs at least one sealed carton`.
* Dispatch page: KPIs **Cartons ready to dispatch · Delivery note in transit · Cartons on the road · Trips today**; card **Not departed** (legacy trips, **Depart** ConfirmButton "Send DSP-… out?"); card **In transit** table *Delivery Note, Shop, Cartons, Pcs, Dispatched, Trip Data, Status "In transit"* (search *Search delivery note*); delivery-note sheet: title = shop, Facts *Shop, Dispatched, Cartons, Pcs, Status, Trip data*, section *Cartons on it*.

## 9. The store receives (store node, blind)

* `GET /api/v1/store/inbound` (store-01 node, maya): `{deliveries:[{delivery_id "inb-…", shipment_reference "SJ-…", status IN_TRANSIT|RECEIVED, koli_count, departed_at, received_at, received_by, result}]}`; announced after the DC and the store sync (seconds). Detail of an in-transit delivery: `lines: []` — **no packed/expected/manifest figures** (blind).
* `POST /api/v1/store/inbound/{id}/receive-count` `{counts:[{sku_code, quantity}], actor_id, idempotency_key}` → `{delivery:{status:"RECEIVED", result:{expected_units, received_units, missing_units, extra_units}}, lines:[{sku_code, expected, received, missing, missing_epcs, extra, extra_epcs}]}`. Counting below expected → `missing`; the store pool `store-01.warehouse` (`GET /api/v1/inventory/pools` → `on_hand`) grows by `received_units`. A count that names nothing on the delivery → `400 nothing counted matches this delivery; count what came off the lorry` (edge/sqlite.rs:6085). **Observed:** counting more than was packed returns `received = expected, extra = 0` (the surplus is dropped without a trace) — bug OUT-75. After a short count Central shows `received_qty = counted`, the missing piece stays in `to_receive_qty` and `receiving_gap_qty` stays 0 (Missing is switched off in the hub, `SHOW_MISSING`), so the sheet has no 'not found at the store' banner. Counting twice: refused.
* Only `store-01` has a node on the rig; deliveries to the other 15 stores stay IN_TRANSIT at the DC. After receipt Central's allotment shows `received_qty`, `receiving_gap_qty` (missing), status DC_COMPLETED; the hub's Received lane reads cloud `receivedShipments`. **Observed:** the DC node keeps the shipment `position = IN_TRANSIT` after the store received it, so the board's Dispatch lane keeps showing a delivered note (OUT-76).

## 10. Return to HO / Return from Store

* Return to HO (`/allotment/returns`; store buttons read `Store 01…13` then `Tasikmalaya · Garut · Cirebon`, i.e. the site names, not the store names): the Allotments book pre-filtered to `RETURN_TO_DC` (no Unallotted/Overdue tabs); header **Return to HO**, **New return**. New return: heading **New Return**, left card = a button per store (all 16 names), right = the store's *return stock* table (*SKU, From, In Return Stock, To Send* with textbox `Return <sku_code>`), "Nothing in its return stock." when empty, total + **Submit** (disabled until pieces), **Back**; saves `POST /api/v1/inventory/allotments {type:"RETURN_TO_DC", lines:[{source_pool_id: store return pool, destination_type:"DC", destination_id:<HO site>}]}`; SavedDialog "Return created". **Shops cannot send returns themselves**; HO raises them.
* Return from Store (Ops, `/operations/board/returns`): lanes *On the way · Receive count · In review · Received* of `RETURN_TO_DC` deliveries (`StoreReturnsBoard`), search `Search returns`, empty "Nothing coming back." The rig's stores have no return stock, so no live return can be raised here (blocked).

## 11. Rig facts that shape the tests

* 16 stores `store-01…13`, `store-c014…016` (codes C001…C016); the DC has outbound pools only for 01…13 (packing for the c01x stores is untested).
* Roles: rina ADMIN/MD (creates/cancels allotments), nina + yusuf OPERATIONS (DC), maya store-01 manager.
* `makeItem` in `support/rig.ts` lists the supplier's items with `limit=200` and breaks once the rig holds more than 200 (235 at 16:30) — outbound uses `makeOwnItem` (support/outbound.ts) which takes the create route's own answer.
* Own stock: PO 24–80 pcs → delivery → Accept → article set up (4 SKUs) → labels printed → in `dc.warehouse` in about 20 s.
