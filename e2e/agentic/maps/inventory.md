# Inventory (hub) and Ops › Stock — branch map (9 Oct 2026)

Read from `frontend-hub/src` and checked against the `agentic` rig. Paths below are relative to `/Users/hari/Documents/itulah/frontend-hub/src` unless a backend path is given.

## What the rig is (it shapes every branch)

- Cloud :8580 · DC node :8581 (**its own node, not cloud-hosted**) · store-01 :8582 (a node too) · 13 stores from the template + 3 opened in the database (Tasikmalaya C014, Garut C015, Cirebon C016, which have **no node**).
- The cloud's inventory ledger is **empty**: every posting of the DC and of store-01 lives on those nodes, and the cloud only receives their *fact positions* (`GET /api/v1/inventory/fleet-pools` → `source_type: EDGE_FACT_POSITION`, `write_policy: OWNER_NODE_ONLY`, `cloud_writable: false`). So:
  - `GET /api/v1/inventory/movements`, `/missing`, `/pools/{id}` on the cloud answer empty for DC stock (`total: 0`).
  - `GET /api/v1/inventory/availability?source_pool_id=dc.warehouse&q=…` **does** see DC stock (it reads the projection).
  - Pools the cloud may write to (`CLOUD_WRITABLE`): the outbound/return pools and everything of the three nodeless stores. Nothing in them holds stock, so a cloud-owned count has **no lines** on this rig (`POST …/counts/{id}/entries` → 404 `inventory subject`).
- Cloud-hosted DC (`INVENTORY_DC_HOSTING=cloud`) would put DC postings in the cloud ledger; tests that need it skip on `RIG_DC_HOSTING !== 'cloud'`.
- Seeded by `demo-populate`: one **ACTIVE cycle count of dc.warehouse** "Opname siklus gudang DC" (DC-owned), 52 RFID sightings, one store-01 receipt (SJ-HO-GUDANG-000001).

## Working-tree breakage found while mapping (blocks the whole module)

`screens/inventory/observations.tsx:41-44,443` and `exceptions.tsx:33,585` import `observationAnomalies`, `type ObservationAnomaly` and `inventoryKeys.anomalies` from `lib/queries/inventory.ts`; the working tree removed all three (HEAD has them, `git diff HEAD` shows the deletion) and the backend has no `/api/v1/inventory/observation-anomalies` route. Because `screens/inventory/index.ts` imports every screen, **every `/inventory/*` route renders "Something went wrong! — The requested module '/src/lib/queries/inventory.ts' does not provide an export named 'observationAnomalies'"**. Ops routes are unaffected. Test `INV-00` guards it; every other Inventory test calls `healInventoryModule(browser)` (support/inventory.ts), which serves the module with the two members appended — and does nothing once the app has them again.

## Routes

| Route | Screen | Menu |
|---|---|---|
| `/inventory` | `StockCards` (screens/inventory/stock-cards.tsx) | Inventory › Stock |
| `/inventory/exceptions` | `Exceptions` | Inventory › Exceptions (badge = open cases, nav.ts:`useOpenExceptionCount`) |
| `/inventory/counts` | `Counts` (counts.tsx) | Inventory › Counts |
| `/inventory/movements` | `Movements` (movements.tsx) | Inventory › Movements |
| `/inventory/observations` | `Observations` | under **More** (nav `more: true`) |
| `/inventory/availability` | `Availability` "On Hand & Shortfall" | hidden (routed, ⌘K) |
| `/inventory/pools` | `Pools` | hidden |
| `/inventory/reconciliations` | "Claim Reconciliation" | hidden |
| `/inventory/as-of` · `/control` · `/time-machine` · `/flows` | "As of", "Ledger Control", "Time Machine", "Goods Flows" | hidden |
| `/inventory/missing` | `Missing` | only when `SHOW_MISSING` (lib/features.ts = **false**: no Missing tab/row/column anywhere) |
| `/operations/stock` | Ops › Stock (screens/operations/stock/stock.tsx) | Ops › More › Stations › Stock |
| `/operations/stock/articles` · `/operations/count` · `/operations/ledger` | Stock by Article · Count · Stock Ledger | Ops › More |

Sheets are URL parameters (`useSheet`): `?count=<id>`, `?pool=<id>`, `?location=<site|road|order>` (stock cards), `?q=`, `?count-status=REVIEW|ACTIVE|DRAFT|CLOSED`, `?order=<po id>` (Ops Stock).

## Inventory › Stock — the cards (stock-cards.tsx)

- Heading "Stock"; search `textbox "Search stores"` (name or unit code, debounced 200 ms, URL `q`); `combobox "Sort places"` = "Needs attention first" / "A–Z".
- `HO` group heading + card button `Head Office HO …` (:760), `On the road In inventory …` (:915), `On order Not in inventory …` (:960). `Stores · N` heading (N = ACTIVE store units; 16 on the rig), one button per store: `<Name> Store · <code> — <book> Inventory <observed|—> Observed … Never counted|Last count 9 Oct · today … No exceptions|N exceptions` (:664-852).
- Ring: observed/book, amber when gap > 1.5 %, dashed with "—" when never swept (`Ring`). Border: bad when an exception is older than 30 days, warn older than 7 days. "Last count" turns amber when older than 30 days or never.
- Sort "attention": severity, then stale/never counted, then number of cases, then name (:602).
- Search no match → `NoMatch`: "There are 16 stores here, and not one of them passes the search and filters in force." + button "Clear the narrowing". No units → "No units are registered yet — Stock has nowhere to stand."; no stores → "No stores are registered yet."
- Place sheet (`?location=<site id>`): ring + Inventory/Observed/Gap, "Last count <day> · N d ago" / "Last count never", button **Count HO / Count store** (primary when stale) or pill **Count active** when a count is ACTIVE on that site; sections Exceptions ("No exceptions" or rows with "Open" link to the inbox) and Where (one Fact per pool + "On the road here").
  - Count store/HO = `POST /api/v1/inventory/counts` (FULL, reason "Requested from Stock", all pools of the main pool, `actor_id` = signed-in user) then `…/activate` (:237-253). Main pool = the site's `WAREHOUSE` pool (:171). It does not check `cloud_writable`, so on a DC-owned site it sends the count to the DC.
- Road sheet (`?location=road`): "On the road" / "In inventory — counted in the books, standing in a truck"; figures Inventory / To stores / Back to HO; tables Allotment · Quantity · Last Moved; empty lines "Nothing is on its way to a store." / "Nothing is coming back."
- Order sheet (`?location=order`): "On order" / "Not in inventory — owed by suppliers"; Awaited / Due this week / Late PO; table Order · Outstanding · Promised ("No promise yet", "Late"); "Nothing is on order."; link "Open in Procurement".

## Inventory › Counts (counts.tsx)

- Lifecycle `DRAFT → ACTIVE → REVIEW → CLOSED` (`STEPS`), pills Draft/Active/Review/Closed. Columns Count · Kind · Counted by (DC|CLOUD) · Status · Expected · Found · Difference · Opened · Closed. Default sort Difference ascending.
- Views (button "All counts" → menu items "Needs review N", "Counting N", "Drafts N", "Closed N"; `?count-status=`), empty copy per view: "Nothing to review." / "Nothing being counted." / "No drafts." / "None closed." / "No counts." / "Nothing matches." when narrowed. Search "Search counts" (server `q`, 400 ms). Filters (side panel "Filters"): Kind, Site, Pool; saved views; KPI tiles Counts / In review / Counting / Drafts. Sort menu, Columns menu.
- New count (`dialog "New count"`): `combobox "Pool (required)"` (options = pools with `cloud_writable`, label `<site> · <pool label>`), `combobox "Kind"` (Full / Cycle / Targeted), `textbox "Reason (required)"`, for Targeted `textbox "Tags to count (required)"`; **Submit** disabled until pool + reason (+ tags). Refusals appear as a red banner. Creates a DRAFT.
- Count sheet (`?count=<id>`): title = reason; pool id; lifecycle; pills Kind / "Counted by the DC" | "Counted here" / "Movement Pending|Applied|Rejected" (`edge_adjustment_status`); facts Site, Pool (link), Opened by, Opened, Activated, Submitted, Owner, Scope ("Everything in the pool" | "N SKUs · M tags"); totals Expected, Found, Agreed, Short, Over, Difference; Lines (MiniTable Tag/SKU/Expected/Found, or in REVIEW the per-SKU table Article · Book · Counted · Becomes with "Same" / "N short" / "N found · M extra" / "N extra").
  - DRAFT → **Activate**; ACTIVE & cloud-owned → per-line number inputs + **Submit** (twice: a soft one for entered numbers, a ghost one that submits as is); ACTIVE & DC-owned → no buttons (the DC's handheld walks it); REVIEW → **Approve**; CLOSED → nothing.
  - Backend: create/activate/entries/submit/approve in `backend/src/cloud/postgres/counts.rs`. Owner = the live Edge node of the site (`inventory_count_owner_tx`); a DC-owned approval issues an adjustment command and the count stays in REVIEW until the DC applies it (`edge_adjustment_status` PENDING → APPLIED, then CLOSED). A shortage posts `COUNT_SHORTAGE` from `<pool>:on_hand` to `<pool>:missing` on the DC.
- DC side (arranged by `support/inventory.ts`): `POST /api/v1/dc/official-counts/{id}/entries` `{entries:[{epc, sku_code, found_quantity}]}` and `…/submit`; `GET /api/v1/dc/official-counts[/{id}]`. The hub never types a quantity for a DC count (Ops › Count says "Counted with the handheld only").

## Inventory › Exceptions (exceptions.tsx, exceptions-data.ts)

- Feeds: cloud `GET /inventory/missing` (Missing) and `GET /inventory/shipments/received?since=` filtered to `open_gap_qty > 0` (Missing, "Store receive"). `Extra` and `Seen elsewhere` exist as kinds but no live feed emits them.
- Desk: list card with `combobox` (kind, unnamed) + `textbox` (search, unnamed) + "N cases"; "Nothing here". Case panel: figures (Book / Counted / Seen / Variance, or Sent / Received / Found since / Gap), Case facts, Movement timeline, actions **Found**, **Confirm lost** (dialog "Confirm lost?"), **Ask for a count** (receive gaps), **Move to <pool>** (placement correction). Receipt dialog titles: "Found — moved back into stock", "Written off · Stock adjustment", "Count asked", "Placement corrected".
- Sidebar row "Exceptions" carries the open-case count as a warn badge.

## Inventory › Movements (movements.tsx)

Cloud ledger only (`GET /api/v1/inventory/movements`). Columns Date · Action · Route (from → to chips) · SKU · Tag · Quantity · Posted by; filters Pool / Action / Posted by; search "Search movements" (server `q`); KPI tiles Postings / Loaded. Empty: "Nothing has been posted to this ledger yet." / narrowed "No movement matches what you asked for." Default newest first.

## Pools, On Hand & Shortfall, Observations and the rest

- **Pools**: tree site → pool (`Expand DC` buttons, `row "Expand DC DC 92 pcs …"`), columns Pool · Kind · Stock · On Hand · Allotted · Observed · Last Count, "Show quantities in" unit picker, search "Search pools" flattens the tree, side-panel tiles Sites · Pools · Never counted · Disputed, footnote "Observations counted over the last Nh · confirmed lost measured over N days". Pool sheet (`?pool=`): tags group/code, facts, Holding, Recent movements, Seen here, Counted, **Correct a placement** form (Subject read-only, `Place (required)`, `Quantity (required)`, `Reason (required)`, `Evidence (required)`, button "Correct placement", disabled until a Holding row is picked).
- **On Hand & Shortfall**: pool picker (default `dc.warehouse`), unlabelled search textbox, "Every SKU"/"Over-promised" segmented control, header `<pool label> <place id>` + equation + Stock / Allotted / On hand, table Article · SKU · Variant · Division · Stock · Allotted · On Hand, footer "N SKUs", empty "Nothing in this pool matches “x”." / "Nothing in this pool is promised beyond what it holds." / "This pool holds no SKU the catalogue still lists as active."
- **Observations**: tabs "Observations" / "Where they disagree · N" (needs the removed anomalies route), table Tag · SKU · Seen in · Reader · Reads · Best RSSI · Last Seen, "Submit a batch" sheet (Pool, Reader, Tags; the cloud refuses reader batches when auth is on).
- **Claim Reconciliation** (Matched / In the air / Store only / Unresolved / Conflicts / Read at), **Ledger Control** (Ledger health, Ledger facts, Row/Stage differences, Last replay/repost, Replay/Repost/corrupt buttons — mutate the ledger, not exercised), **As of** (pick a moment: "Pick a moment to replay the ledger to."), **Time Machine** ("Fold the ledger"), **Goods Flows** (flow templates, "New flow", "No flows yet.").

## Ops › Stock (screens/operations/stock)

One table, always open (stock.tsx): columns Pool · On Hand · Seen · Last Count; rows in the order goods travel — **On order** (open POs, outstanding pcs; row per PO "PO no. / supplier · due"), **Unidentified** (accepted receipts with no article yet: PO → its articles), **Unallotted** (dc.warehouse on-hand, by division), **Allotted** → **Unpicked / Picked / Packed / Dispatch** (each by store; Picked also "Pick area"), **Return stock** (per store), **To supplier** → **Over-delivery** (OPEN purchase returns raised by the buyer) and **Returns** (supplier returns TO_HAND_OVER, "Settle by …"), footer **Total** = Unidentified + Unallotted + Allotted + Return stock + To supplier. No Missing tab (SHOW_MISSING off). The five accordion rows expose `aria-expanded` only once their data has arrived; they fold five rows then "View all N …", which opens a dialog with its own search (`Search Unidentified`, `Search On order`, `Search Over-delivery`, `Search Returns`, "Nothing found."). A PO row opens Procurement's sheet (`?order=`). Stage/store/division rows open a dialog ("Back" returns to the list it came from). Reads the **cloud** (registered outside `OperationsGate`).
- Ops › Count (`/operations/count`): the DC's counts, status "To count" (ACTIVE) / "Counted" (SUBMITTED), search "Search counts", empty "Nothing to count." Ops › Stock Ledger (`/operations/ledger`): "Search the ledger", `combobox "Pool"`, "No movements." — reads the **cloud** ledger (empty on this rig).

## Endpoints used by the suite

Cloud: `GET /api/v1/inventory/{fleet-pools, counts, counts/{id}, availability, movements, missing, observations, control, shipments/received}`, `POST /api/v1/inventory/counts[/{id}/{activate,submit,approve}]`, `GET /api/v1/{stores, flow-templates, purchase-returns, purchase-orders, article-setups/unidentified}`.
DC: `GET /api/v1/inventory/{pools, movements}`, `GET/POST /api/v1/dc/official-counts[/{id}[/entries|/submit]]`, tagging: `GET /api/v1/dc/tagging-jobs`, `POST /api/v1/dc/{print-sessions, print-sessions/{id}/run, tagging-confirmations}`.
