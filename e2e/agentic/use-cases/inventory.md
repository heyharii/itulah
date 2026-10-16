# Inventory (hub) — use-case catalogue

Domain: Central › Inventory (`/inventory/*`) and Ops › Stock / Count / Ledger. Map: `maps/inventory.md`.
Run: `./remote.sh --config hub.config.ts --output .e2e/out/inventory hub/inventory`.
Helpers: `support/inventory.ts` (own stock through the tagging chain, the DC's side of a count, `healInventoryModule`).

Every test makes its own data with a run-unique `tag()`. Counts of a DC-owned pool are scoped to the SKUs of the test's own article (`sku_ids`), so no other suite's pieces are ever counted.

Status: **pass** · **fail (bug)** = red on purpose, the app is wrong · **skip (reason)**.

| ID | Actor | Preconditions | Steps | Expected | Test (file :: title) | Status |
|---|---|---|---|---|---|---|
| INV-00 | rina | none | open `/inventory/counts` as shipped | the Counts heading renders | counts :: INV-00 the Inventory module loads | pass on the VM's copy of the hub; **fail (bug) on the Mac working tree of 9 Oct**: `observations.tsx`/`exceptions.tsx` import `observationAnomalies`, `ObservationAnomaly`, `inventoryKeys.anomalies`, which that tree removed from `lib/queries/inventory.ts`, so every `/inventory/*` route died with "does not provide an export named 'observationAnomalies'" (seen in the first runs) |
| INV-01 | rina | — | open Counts | columns Count/Kind/Counted by/Status/Expected/Found/Difference/Opened/Closed; the seeded DC cycle count is listed as DC | counts :: the book lists counts… | pass |
| INV-02 | rina | — | type in Search counts | server-side narrowing, URL `q`; nothing matches → "Nothing matches." | counts :: searching narrows the book… | pass |
| INV-03 | rina | — | open the view menu | "Needs review N / Counting N / Drafts N / Closed N" carry the API's status facets; choosing Counting sets `count-status=ACTIVE` | counts :: the views are the status filter… | pass |
| INV-04 | rina | — | New count: empty, reason only, pool, Targeted | Submit disabled until pool + reason; Targeted asks "Tags to count"; nothing is written by looking | counts :: New count: Submit waits… | pass |
| INV-05 | rina | — | open the pool picker | only cloud-writable pools (e.g. `store-c015 · Warehouse`); never the DC-owned `dc · Warehouse` | counts :: the pool picker offers only pools… | pass |
| INV-06 | rina | store-c016 has no open count | New count (Full, store-c016 · Warehouse, reason) → Submit | a DRAFT, kind FULL, created_by rina; the book lists it as Draft / Cloud | counts :: a new count is a Draft in the book | pass |
| INV-07 | rina | INV-06 | open the count sheet, Activate | "Counted here", scope "Everything in the pool", "No lines yet."; becomes ACTIVE, execution_authority CLOUD; Submit offered | counts :: Activate freezes it as Counting, here | pass |
| INV-08 | rina | INV-07 | Submit, then Approve | REVIEW then CLOSED with `closed_at`; closed sheet offers nothing; the Closed view finds it | counts :: Submit sends it to review… | pass |
| INV-09 | rina, nina | own tagged stock (8 pcs, 4 SKUs) in dc.warehouse | head office asks a TARGETED count of the 4 SKUs on the DC (API), nina walks 7 of 8 pieces on the handheld (DC API) | the DC sheet lists exactly our 8 pieces | counts :: arrange: tagged stock… | pass |
| INV-10 | rina | INV-09, DC has not submitted | open the count | "Counted by the DC", scope "4 SKUs · 0 tags", Owner shown, no Activate/Submit/Approve | counts :: while the DC walks… | pass |
| INV-11 | rina | the DC submits | open the count | REVIEW: totals 8/7/-1, per-SKU table: 3 × "Same", one "1 short" ("short", not "to Missing": Missing is switched off), our article named; Approve offered | counts :: once the DC submits… | pass |
| INV-12 | rina | INV-11 | Approve | "Movement …" pill (the count stays in review until the DC answers), then CLOSED with `edge_adjustment_status` APPLIED; after reopening "Movement Applied"; DC ledger has `COUNT_SHORTAGE` on_hand → missing for the unfound EPC; availability of our SKUs 7 on hand / 1 missing | counts :: Approve asks the DC to book the shortage… | pass |
| INV-13 | rina | INV-12 | open the finished count, then Exceptions; search our tag | (a) the count's Scope reads "4 SKUs"; (b) the shortage it booked is a case (Missing -1, our article) | counts :: two things the finished count must show… | **fail (bug)** twice over — (a) the Scope fact reads `scope.sku_codes`/`epcs`, which a SKU-scoped (`sku_ids`) count never has, so a count of four SKUs says "Everything in the pool"; (b): the cloud's missing book (`GET /inventory/missing`) is empty for pieces a separate DC node booked, so the inbox, its badge and Found / Confirm lost never see them |
| INV-14 | rina | cloud-owned count with entries | enter found quantities, Submit | needs lines in a cloud-owned pool | — | skip (no cloud-owned pool holds stock on this rig; `POST …/counts/{id}/entries` answers 404 "inventory subject") |
| INV-15 | rina | count with an over (gain) | Approve | "N extra" / "N found · M extra" | — | skip (needs stock the DC has not booked; no safe way to make an over on a shared pool) |
| INV-20 | rina | — | open Stock | HO / On the road / On order cards and one card per ACTIVE store unit (25 now), each named with its code; a store without stock says "No exceptions" and "Never counted" or its last count | stock-cards :: one card for head office… | pass |
| INV-21 | rina | — | read store-01's card | Inventory = sum of the pools the fleet read counts at that site | stock-cards :: a store card's Inventory is the sum… | pass |
| INV-22 | rina | — | search "garut", "C016", "zzzz", Clear the narrowing | one card each; no match says "There are N stores here, and not one of them passes…" and offers "Clear the narrowing" | stock-cards :: search narrows the stores… | pass |
| INV-23 | rina | — | Sort places → A–Z → Needs attention first | A–Z orders store cards by name | stock-cards :: A–Z puts the stores in name order | pass |
| INV-24 | rina | own PO | On order card | sheet "On order / Not in inventory — owed by suppliers", Awaited / Due this week / Late PO, our PO row with 8 outstanding, link "Open in Procurement" | stock-cards :: On order opens the open purchase orders… | pass |
| INV-25 | rina | — | On the road card | sheet "On the road / In inventory — counted in the books, standing in a truck", To stores / Back to HO | stock-cards :: On the road lists the trips… | pass |
| INV-26 | rina | — | open store-01's sheet | ring figures, Last count, Exceptions heading, Where with the Floor figure | stock-cards :: a store's sheet tells its whole story… | pass |
| INV-27 | rina | — | read "Where" | each shelf once | stock-cards :: "Where" names each shelf once | **fail (bug)**: `PlaceSheet` lists every pool at the site, shadowed Cloud rows included, so Warehouse / Floor / Reject appear twice (a 0 beside the node's real number) — `stock-cards.tsx:1068` should filter on `authority.included_in_fleet_total` |
| INV-28 | rina | store-c014 has no open count | Count store | button replaced by "Count active"; a FULL count "Requested from Stock" on `store-c014.warehouse` is ACTIVE | stock-cards :: Count store on a cloud-owned store… | pass |
| INV-29 | rina | a count is ACTIVE on the DC | HO sheet | "Count active", no "Count HO" | stock-cards :: head office already has a count running… | pass / skip when no DC count is running |
| INV-30 | rina | — | Count HO / Count store on a DC-owned or stale site | would count shared stock | — | skip (would count dc.warehouse / store-01 stock other suites own) |
| INV-40 | rina | own tagged stock | On Hand & Shortfall, search our tag | exactly our 4 SKUs with the API's stock; pool header names `dc.warehouse:on_hand` and the equation | readings :: searching the warehouse by our tag… | pass |
| INV-41 | rina | INV-40 | Over-promised | "Nothing in this pool matches “tag”." ; Every SKU brings the rows back | readings :: Over-promised keeps only SKUs promised beyond… | pass |
| INV-42 | rina | — | search nonsense | "Nothing in this pool matches “zzqqxx”." | readings :: a search that matches nothing… | pass |
| INV-43 | rina | — | pick `store-01 · Floor` | header reads `store-01.floor:on_hand` | readings :: another pool can be read… | pass |
| INV-43b | rina | — | open the pool picker | each shelf once | readings :: the pool picker names each shelf once | **fail (bug)**: `placements()` keeps both a node-owned shelf and its shadowed Cloud row, so "dc · In Transit", "dc · Packed", "store-01 · Floor"… are listed twice (the same duplication hits Movements' Pool filter and the Count pool picker's source lists) |
| INV-44 | rina | — | exact pool header figures vs the API | — | — | skip (dc.warehouse moves under other suites; the SKU-level figures of INV-40 are the exact check) |
| INV-50 | rina | — | Pools | site rows unfold (`Expand DC`), DC row = the sum of the pools the fleet counts there, footnote about the observation windows | readings :: sites are rows that unfold… | pass |
| INV-51 | rina | — | search "Floor" / "zzzz" | only sites with a matching pool keep a row | readings :: search flattens the tree… | pass |
| INV-52 | rina | — | open `?pool=store-c015.warehouse` | kind/code tags, facts, "Nothing sits in this pool.", "Correct a placement" form: Place never offers the pool itself; button disabled without subject/place/reason/evidence | readings :: a pool's page… | pass |
| INV-53 | rina | — | side panel | Sites / Pools / Never counted / Disputed | readings :: the side panel counts… | pass |
| INV-54 | rina | stock in a cloud-owned pool | correct a placement | needs a Holding row | — | skip (no cloud-owned pool holds stock on this rig) |
| INV-60 | rina | — | Movements | total = the API's (`total: 0` → "Nothing has been posted to this ledger yet."), side panel Postings / Loaded, filter fields Pool / Action / Posted by | readings :: the ledger screen reads the cloud ledger… | pass |
| INV-61 | rina | — | search nonsense | "No movement matches what you asked for."; URL `q` | readings :: a search with no postings behind it… | pass |
| INV-62 | rina | cloud-hosted DC | a delivery's postings appear | `Opening` rows for our tag | readings :: a delivery received at the DC is a posting… | skip (needs `RIG_DC_HOSTING=cloud`: this rig's DC keeps its own ledger, the cloud ledger is empty) |
| INV-70 | rina | — | Exceptions | "N cases" = the cloud's missing rows + stores' short receipts; sidebar badge shows N; "Nothing here" at 0 | readings :: the inbox counts the cases… | pass |
| INV-71 | rina | — | kind filter | options Missing / Extra / Seen elsewhere | readings :: the kind filter offers… | pass |
| INV-72 | rina | — | search nonsense | "0 cases", "Nothing here" | readings :: a search that matches no case… | pass |
| INV-73 | rina | a missing book row | Found / Confirm lost | receipts "Found — moved back into stock" / "Written off · Stock adjustment" | readings :: a missing piece is resolved Found… | skip (needs `RIG_DC_HOSTING=cloud`; see INV-13) |
| INV-74 | rina | a store receive gap | Ask for a count | creates + activates a CYCLE count of the store's stockroom ("Receive gap · SJ…") | readings :: a store's short receipt can be turned into a count… | skip (needs the store app to sign a short surat jalan; the gaps on the rig come from other suites) |
| INV-80 | rina | — | sidebar | Stock, Exceptions, Counts, Movements are sub-items; Pools, On Hand & Shortfall, Reconciliations, As of, Control, Time Machine, Flows are not; Inventory opens on Stock | screens :: the sidebar names Stock… | pass |
| INV-81 | nina | OPERATIONS | open `/inventory` | Stock renders | screens :: nina (DC operations) can open… | pass |
| INV-82 | yusuf | OPERATIONS | open Counts | the seeded DC count is listed | screens :: yusuf (head of the DC) can read the counts | pass |
| INV-83 | rina | — | Observations | tabs "Observations" / "Where they disagree", columns Tag…Last Seen, search by a real EPC, "Submit a batch" | screens :: Observations: what the readers saw… | **fail (bug)**: the screen crashes on open — "Something went wrong! F.anomalies is not a function": `observations.tsx:288,522` call `inventoryKeys.anomalies()`, a key the VM's `lib/queries/inventory.ts` does not define |
| INV-84 | rina | — | tab "Where they disagree" | "Every tag was last seen where the ledger says it is." (or rows) | screens :: Observations: "Where they disagree"… | **fail (bug)**: same crash as INV-83 on the VM's copy; where the screen does render, the tab shows "Not Found / Try again" because the backend has no `/api/v1/inventory/observation-anomalies` route |
| INV-85 | rina | — | Claim Reconciliation | tallies Matched / In the air / Store only / Unresolved / Conflicts / Read at | screens :: Claim Reconciliation | pass |
| INV-86 | rina | — | Ledger Control | labels Ledger health … Last repost; API `ledger_health` HEALTHY | screens :: Ledger Control | pass |
| INV-87 | rina | — | As of | opens on yesterday 23:00, "Read only. These are the balances as at …", columns Pool…Lost Rate | screens :: As of | pass |
| INV-88 | rina | — | Time Machine | tabs State at a sequence / Ledger vs projection / Edge vs cloud / What if; Events applied, State hash, Folded to "The end of the ledger" | screens :: Time Machine | pass |
| INV-89 | rina | — | Goods Flows | heading, "New flow", the list or "No flows yet." | screens :: Goods Flows | pass |
| INV-90 | rina | — | phone 414×896 Counts | cards (no column headers), dock buttons "Status: All counts" / "Search Counts" / "Filter and sort", round "Add New Count", each card "difference · Expected N · Found M" | screens :: Counts are cards… | pass |
| INV-91 | rina | — | Replay / Repost / corrupt-projection / New flow save / Submit a batch | mutate the shared ledger or settings | — | skip (not exercised: they would damage state every other suite reads) |
| INV-92 | rina | — | an agent asks for a count in plain words | DRAFT count of store-c015 | agent :: an agent asks for a count of the Garut stockroom… | pass (Haiku) — tagged `agent` |
| OPS-01 | nina | — | Ops › Stock | rows in order: On order, Unidentified, Unallotted, Allotted, Unpicked, Picked, Packed, Dispatch, Return stock, To supplier, Over-delivery, Returns, Total; column heads; no Missing tab | ops-stock :: the tree names every stage… | pass |
| OPS-02 | rina | own PO | open On order | our PO with supplier and 8 pcs; its row opens the order sheet (`?order=`) | ops-stock :: an open PO is On order… | pass |
| OPS-03 | rina | own PO delivered and accepted | open Unidentified | our PO, its article and 8 pcs under it; nothing outstanding on the order | ops-stock :: a delivery the buyer accepted is Unidentified… | pass |
| OPS-04 | rina | PO delivered 12 of 8 | open Over-delivery; raise the return; hand over | not listed until the buyer raises the return; then PO with 4 pcs; leaves when the DC hands over | ops-stock :: pieces over the order become Over-delivery… | pass |
| OPS-05 | rina | — | Unallotted | equals dc.warehouse on-hand from the fleet read | ops-stock :: the Unallotted row is the DC warehouse pool's on-hand figure… | pass |
| OPS-06 | rina | — | Dispatch row | opens a dialog; Close shuts it | ops-stock :: stage rows open a dialog… | pass |
| OPS-07 | rina | a supplier return to hand over | Returns accordion | "Settle by …" | — | skip (a Return PO from stock needs a lot of DC stock and a settlement flow; owned by the return-po suite) |
| OPS-08 | rina | cloud-hosted DC | Ops › Stock Ledger | rows for our tag | — | skip (needs `RIG_DC_HOSTING=cloud`: it reads the cloud ledger, "No movements." on this rig) |

## Agent steps

One: INV-92. Run with Haiku (`claude-haiku-5-5`, the config default); the goal is worded with the on-screen labels ("New count", "Pool", "Reason", "Submit"). Nothing needs Sonnet.

## Left behind on the rig (read before judging a run)

- Counts named "Uji gudang DC <tag>" that stay REVIEW or ACTIVE after a failed run: `IVU9J95`/`IV1XYDC`/`IVP0X43`/`IVFVFYC` and similar. `IV1XYDC` was scoped (by an earlier `dcUnitsOf` that searched the DC's ignored `q`) to another suite's pieces and was **never approved**, so nothing was written to anyone's stock; do not approve it.
- Counts "Requested from Stock" / "Uji toko Cirebon …" / "Uji agent Garut …" on store-c014/5/6: closed (or Draft) — harmless, these stores have no stock.

## Needed in shared files

- `support/rig.ts` `makeItem`: reads the supplier's first 200 items only; supplier 0001 now has 300+ (every suite adds items), so the lookup of a new item returns `undefined` and `placePo` dies with "Cannot read properties of undefined (reading 'supplier_item_id')". Fix: walk `next_cursor` (this suite's `makeOwnItem` in `support/inventory.ts` does) or fetch by code.
- `support/rig.ts` `dcMovements`-style searches: the DC node ignores `q` on `GET /api/v1/inventory/movements` (newest rows only, no cursor); never pick "our" pieces by text search.
