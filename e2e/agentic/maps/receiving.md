# Receiving (Ops › Receiving + Review Count) — branch map and rig notes (9 Oct 2026, read-only survey)

NOTE: the agentic rig is already provisioned by e2e/agentic/provision.sh (16 open stores). Ignore section 6 except the DC-hosting remark.

I've finished the read-only survey; nothing was edited, built or started. Four things change how the tests should be designed:

- **The route is `/operations/intake`, not `/operations/receiving`.** The menu label is "Receiving".
- **The rig's warehouse runs on a separate DC node, not inside the cloud.** On that node, Recall and counting a line as 0 don't work. Both only work when the cloud hosts the warehouse itself (`INVENTORY_DC_HOSTING=cloud`).
- **The creator-equals-counter deadlock from the 2 Oct report is gone.** Whoever raised the PO may count it and review it. A count that exactly matches what is owed is received automatically, in the creator's name, and never reaches Review Count.
- **The "PO cancelled while a count waits" bug is only partly fixed.** Receiving against a cancelled PO is now refused. But the server still allows the cancel itself while a count waits; only the hub button blocks it.

## 1. Screens, routes, roles

| Screen | Route / where | Component | Who uses it |
|---|---|---|---|
| Ops › Receiving (counting at the DC) | `/operations/intake`. Menu "Receiving", badge = orders still owed a count (`nav.ts:190-196`, `:76`) | `Receiving` and `CountSheet` in `frontend-hub/src/screens/operations/intake/receiving.tsx:176`, `:609`; registered in `intake/index.ts:9` | nina, yusuf, rina |
| Receiving › Store returns tab | `/operations/intake/returns` (hidden in the sidebar, `nav.ts:239-244`) | `intake/returns.tsx` | not part of PO receiving |
| Review Count (the buyer's step) | Procurement › Purchase orders, URL `?verify=<PO>` | `CountReview` and `ReviewCountButton` in `screens/procurement/count-review.tsx:83`, `:134`; mounted at `purchase-orders.tsx:939-941`, `:1664` | rina (only she can see Procurement) |

**Seeded users** (`scripts/demo-seed.sh`, password `Password01`):
- **rina** (HO-0001) has hub role ADMIN, so she sees every section (`:144`). She only gets a DC assignment (`rina:dc:ADMIN`) when sign-in is required (`:172`).
- **nina** (HO-0006, counts) and **yusuf** (HO-0007, verifies) have job role OPERATIONS (`:153-154`, `:165-168`). That role only sees the operations and inventory sections (`migrations/postgres/0633_…sql:102-104`), so they never see Procurement or Review Count. Both are SUPERVISOR at the DC (`:169`).
- **maya** and **dian** belong to store-01. The bootstrap admin is `admin`.

**Permissions on the DC node:** counting and reviewing both need only `DcOperate`, which any Cashier or higher has (`backend/src/edge/auth.rs:126-151`, `edge/http.rs:5316-5322`). The server replaces whatever actor the client sends with the signed-in user (`cloud/dc/receiving.rs:639`, `:1192`).

**Signing in to the DC:** the hub uses its own session to fetch a DC ticket: `POST /api/v1/auth/edge-sso-ticket`, then `POST /edge/api/v1/auth/sso/exchange` (`lib/edge-session.tsx:181-187`).
- On the PO list this happens silently in the background (`count-review-state.ts:57-80`).
- The Review Count dialog sits behind `OperationsGate`. On failure it says "Checking the warehouse session…" / "The warehouse node could not be reached." (`gate.tsx:176`, `:249`).

## 2. Branch tree, with exact labels

**A. List** (`receiving.tsx`)
- Header "Receiving". Tabs "Purchase orders · N" and "Store returns · N" (`header.tsx:58-69`, `:90`); tabs are hidden on a phone. Search "Search Orders" (`:435`). The list refreshes every 10 s (`:194-206`).
- Columns:
  - **PO**: supplier name, then the PO number. It adds "Recalled · was N pcs" after a recall, or the buyer's recount reason in curly quotes (`:291-299`).
  - **Items**: number of lines still owed.
  - **Count**: shows one of
    - "Count receive"
    - "Count again" (after a recount or recall)
    - "N pcs", "+ N Not as Ordered" and "Name · time" once counted (`:355-384`, `:124-141`).
- Phone cards (`:320-351`): a lead figure "N" with "item"/"items", foot "Not counted" or "Counted N pcs", status pill "Counted" (`:365`).
- Empty and loading text: "Nothing to count." / "No orders match." / "Reading the orders…" (`:441-445`).

**B. Blind count** (one sheet per PO, one row per PO line; it never shows the ordered quantity)
- Sheet title is the supplier name. Column heads "Article", "Counted" (hidden on phone), "In pieces" (`:1038-1044`).
- Under each article: division and tags, plus "· N already in" on a later delivery (`:1058`).
- Quantity input: aria-label `Counted {unit} of {article_code}`, number-pad title `{article_name} · {unit}` (`:1072-1073`).
- Unit select: aria `Unit counted for {article_code}`. Buttons "Another unit" and "Remove this amount" appear only when the line has more than one unit (`:1094`, `:1126`, `:1150`).
- Per-line result: "—", "N pcs" or "Not whole pieces" (`:1165-1169`). Total row: "Total Counted" (`:1185`).
- One "Not as Ordered" figure for the whole delivery (`:1195-1263`):
  - Label "Not as Ordered", sub-label "Damaged or wrong items", placeholder "0".
  - Unit select aria "Unit for not as ordered", first option "Piece"; otherwise the plain text "pieces".
  - Error: "Must be a whole number of pieces" (`:903`).
  - On submit, this figure rides on the first counted line. If only wrong goods came, it rides on line 1 with a count of 0 (`:922-932`).
- Footer button "Submit count" (shows "Sending…"). It is disabled when nothing is entered or a figure is invalid (`:1002-1009`).
- On success a centre dialog says "Count sent · N line(s)" and closes itself after 3 s; the sheet closes too (`:753-756`, `:1271`).
- A blank line is not counted. A line entered as 0 means "this line did not come" (`:908-916`).

**B1. Count matches what is owed**
- Each owed line has exactly one count, equal to what it owes, with no wrong pieces.
- It is accepted automatically in the PO creator's name, even if the creator counted it (`cloud/dc/receiving.rs:1906-2012`, `edge/sqlite.rs:11341-11470`).
- The order leaves Receiving, the PO becomes "Fully received", and there is nothing to review.

**B2. Short, over, or not-as-ordered**
- The count waits for review. The PO list status cell becomes a "Review Count" button.

**B3. Recall** (count waiting, nobody has reviewed it)
- The sheet becomes read-only: "Counted by", "Counted at", "Article" / "Counted", "Total Counted" (`:521-596`).
- Footer "Recall Count" opens a confirm (`:985-1000`):
  - Title: "Recall this count?"
  - Body: "The count stays in history as Recalled. Stock does not change. You count again for the same arrival."
  - Buttons: "Cancel" / "Recall Count"
- Recall is built only on the cloud-hosted warehouse (`cloud/dc/receiving.rs:954-1116`, migration `0950`). The DC node has no route for it (`edge/http.rs:272-301`) and always reports `recalled: None` (`edge/sqlite.rs:10787`). **On the rig the button still appears but will fail.**
- Server refusals:
  - "{who} already accepted this count of {PO}; the goods are received and the count can no longer be recalled"
  - "… already sent this count of {PO} back to be counted again; count it again"
  - "this count of {PO} was already recalled; count it again"
  - "{PO} was cancelled by head office; its count is void and is not recalled"

**B4. Every line entered as 0 ("reject the whole lorry")**
- Cloud-hosted warehouse: allowed (`receiving.rs:653-660`). The review shows everything short, and accepting a 0 count writes no stock (`:1678-1714`).
- DC node (the rig): refused with the banner text **"invalid request: a count of nothing is not a count; refuse the delivery instead"** (`edge/sqlite.rs:11087-11090`).
- Rejecting a whole delivery exists only as an API call: `POST /api/v1/dc/goods-receipts/{id}/reject` (reason required). It is refused if any goods on it were already accepted. **There is no hub button for it.**

**B5. Several deliveries or partial receipts**
- Each PO gets its own receipt (`receipt_for_order`, `receiving.rs:2090`; `edge/sqlite.rs:11603`).
- An open receipt from the same supplier with no invoice yet is reused by the sheet (`receiving.tsx:706-720`).

**C. Review Count** (`count-review.tsx`; a side sheet on desktop, a bottom drawer on phone)
- Title "Review Count". Icon aria-labels: "The count differs from the order" / "The count matches the order". Close button "Close".
- Facts: "Supplier", "Counted" (shows "Name · time" or "N people · time").
- With more than 4 lines, a "Difference" fact: "Matches the order", or "X of Y items differ · N pcs short · N pcs extra · N pcs not as ordered" (`:673-695`).
- A "Hide matched" switch (aria "Hide Matched Items") appears when some lines match and some don't (`:702-711`).
- Table heads: "No.", "Article", "Ordered Quantity", "Counted Quantity", "Difference". Cells: "Matches", "−N pcs" or "+N pcs" (kodi lines read like "9 kodi 5 pcs"). Footer rows "Total" and "Not as Ordered" (`:827-955`).
- Return line, shown for over or not-as-ordered (`:981-1008`). One of:
  - "N pcs will be returned to the supplier · X not as ordered, Y extra"
  - "N pcs extra will be returned to the supplier"
  - "N pcs not as ordered will be returned to the supplier"

Branches:
- **No short lines:** buttons "Recount" and "Submit".
- **Some short lines:** three buttons (`:1050-1081`):
  - "Close Short" opens a red confirm:
    - Title: "Close This Short?"
    - Body: "N pcs will be removed from the order, and the PO completes as received. This can't be undone."
    - Optional field "Reason for Closing" (defaults to "Closed short at count review").
    - Confirm button: "Close Short"
  - "Recount"
  - "Partial Receive" (tooltip "N pcs stay open on the order")
- While saving, Submit and Partial Receive show "Submitting…".
- **After accepting:** a centre dialog "N items received" (plus " · replacement recorded" for a replacement order).
  - Over and wrong pieces automatically go on a return to the supplier (`returnOver`, `:1114-1145`). If the cloud hasn't caught up it errors: "The goods were accepted, but head office has not received them yet — return the extra from the order once it shows."
  - Closing short retries until the cloud has the receipt (`:1495-1533`).
- **Recount:**
  - Every line gets a checkbox (screen-reader labels "Count {article_code} again" and "Tick every line").
  - Heading and textarea "Why should it be counted again?"
  - Footer: "Back", "{n} of {N items} ticked", and "Send {N item(s)} back to count", which stays disabled until a line is ticked and a reason is typed.
  - Result dialog: "{N items} sent back to count".
  - The PO list then shows "Recounting"; the Receiving list shows the reason and "Count again".
- **Other states:** "This order is cancelled." / "Nothing to review." / "Reading the count…"
- **Receipt valued at matched quantity:** "Price for what was counted" is min(counted, owed) × unit price (`:1232-1237`). On the server, the receipt line splits matched and excess (`receiving.rs:1811-1851`). The goods all go into the Unidentified pool (`:1723-1767`).

**D. Invoice and photos**
- The only photo is the supplier invoice: "Upload invoice" / "Replace" / "Uploading…" / "Open the invoice (PDF)"; images or PDF, 8 MB limit on the cloud.
- Fields "Invoice Number" (required), "Invoice Total" (Rp), "Invoice Date", then "Submit". It is disabled with "Accept the goods first." until something is accepted.
- Result pill: "The invoice agrees" or "Rp X over/under the agreed price" (`:1160-1361`).
- **This block may be unreachable.** On accept the code calls `onClose()` (`:541-542`), which unmounts the review body (`:183-192`). The "N items received" dialog also lives inside the review popup (`:227-233`). Check this in a live run.

**E. PO sheet and list**
- Status labels: "Active", "Partially received", "Closed short", "Fully received", "Cancelled" (`shared.ts:190-208`). The list cell shows "Review Count" or "Recounting" instead when relevant (`purchase-orders.tsx:874-906`).
- Sheet footer: "Close Short" (only when partially received), "Cancel", "Edit", "Review Count" (`:2111-2196`).
  - "Cancel" is disabled with tooltip "A count is waiting. Review it first." when a count waits.
  - Otherwise the confirm says "Cancel {PO}?" / "The warehouse will stop receiving against this order. It stays on record as cancelled." with buttons "Keep Order" / "Cancel Order" and optional "Reason for Cancelling".
- Section "Return PO" has a button "Return N pcs to supplier", which opens "Send the Excess Back" with confirm "Raise the Return" (`:2716-2745`). The DC hands the goods over from Ops › Return PO (`/operations/board/suppliers`).

**F. Not in receiving**
- RFID/tagging comes later: article setup, then Ops › Printing (`/operations/tagging`).
- There is no goods-received note to print. The GRN number appears only in the invoice block header and the PO's "Received" list.

**Count statuses:** `AWAITING_VERIFICATION`, `RECOUNT_REQUESTED`, `ACCEPTED`, `RECALLED`. **Receipt statuses:** `OPEN`, `REJECTED`.

**Phone (narrower than 768px, `lib/layout.ts:27`)**
- Number fields are read-only and open a bottom number pad (`field.tsx:147-245`, `number-pad.tsx`). The pad has:
  - title = the field's padLabel
  - keys 1–9, "Decimal point", 0, "Delete"
  - "Close" (×) and "Done"
- Confirm dialogs open as bottom drawers with two 44px buttons side by side.

**Error banners** show the server's `error` string word for word (`lib/problem.ts:13-17`). On the DC node it is prefixed "invalid request: ", "conflict: ", "not found: " or "forbidden: ".

## 3. Endpoints

The hub sends DC calls to `/edge/...`, which the Vite proxy forwards to `VITE_EDGE_TARGET`. If the cloud hosts the warehouse they go to `/api/v1/dc/...` on the cloud instead (`lib/api.ts:34`, `:86-122`). Client methods are in `frontend-contract/src/client/dc.ts:166-328`.

| Action | Call | Server side |
|---|---|---|
| Work list / badge / waiting counts | `GET /api/v1/dc/purchase-orders`, `GET …/purchase-orders/summary`, `GET /api/v1/dc/purchase-counts` | `edge/http.rs:272-295`; `cloud/dc/receiving.rs:65-95` |
| Open a delivery | `POST /api/v1/dc/goods-receipts` `{supplier_id, arrived_at:null, actor_id, idempotency_key}` | same |
| Submit count | `POST /api/v1/dc/purchase-counts/batch` `{receipt_id, counts:[{po_line_id, counted_quantity, wrong_quantity, counted_unit_code, counted_unit_quantity}], actor_id, idempotency_key}` | cloud `:633-939`, edge `sqlite.rs:11072` |
| Recall | `POST /api/v1/dc/purchase-counts/recall` `{count_ids, actor_id, idempotency_key, reason?}` | cloud only, `:954` |
| Accept / Recount | `POST /api/v1/dc/purchase-verifications` `{count_id, verifier_actor_id, decision:"Accept"\|"Recount", note, invoiced_price_minor, idempotency_key}` | cloud `:1558-1895`, edge `sqlite.rs:12761` |
| Invoice | `POST …/goods-receipts/{id}/invoice`; `GET`/`POST …/invoice-document` | |
| Reject delivery (API only) | `POST …/goods-receipts/{id}/reject` `{receipt_id, reason, actor_id, idempotency_key}` | `:1198-1297` |
| Return / close short / cancel (cloud) | `POST /api/v1/purchase-orders/{id}/returns`; `POST /api/v1/purchase-order-lines/{line}/close-short` `{closed_by, reason}`; `POST /api/v1/purchase-orders/{id}/cancel` `{reason}` | `lib/queries/procurement.ts:941-1014` |

**Validation messages on the count** (`receiving.rs:642-864`; the DC node mirrors them):
- "a count sheet carries at least one counted line"
- "{w} pieces cannot be not as ordered out of a count of {n}"
- "this purchase order was cancelled by head office; refuse the delivery"
- "this line cannot be counted in {code}; count it in pieces"
- "{typed} {code} is {pieces} pieces, not the {n} sent"
- "delivery {id} is {status}; open a new one for goods arriving now"
- "this delivery came from {X} and that order is with {Y}; …"
- On the DC node only: "line {line} is counted twice on one sheet"

**Validation messages on the review** (`:1562-1626`):
- "a recount request must say what to look at again"
- "count {id} was already {status}"
- "this order was cancelled; its count cannot be received or sent back to count"

## 4. The e2e scripts

**`e2e/po-flow/run.py`** runs against the pos-e2e rig. Ports are fixed at `:37` (8480/8481/8482); it signs in through `Rig.as_` (`:76-84`).
- `count_and_verify` (`:237-265`) does: open receipt, then single-line `POST /api/v1/dc/purchase-counts` (not the batch call), then a review as rina, then an invoice as yusuf. An "already accepted" reply is treated as the automatic receive.
- Branch tests: `v_short` 8→5 then close short (`:512`), `v_over` 8→11 then return (`:532`), `v_wrong` 10 counted with 3 wrong (`:559`), `v_recount` (`:609`), `v_reject` (`:628`), `v_cancel` (`:642`).
- Some calls send `invoice_unit_price_minor` (`:622`; also `demo-populate.py:166-169`) where the field is `invoiced_price_minor`, so the price check is probably ignored.

**`e2e/po-flow/review_states.py`** defaults to `--base http://127.0.0.1:8495`, a single cloud-hosted node. It uses `count()` (`:129`) and `accept()` (`:145`) to leave orders in states OVER, SHORT, OVER+SHORT, PASS (auto-received), CLOSE-SHORT, PARTIAL-3X, FULL-2X and RETURN.

## 5. Known bugs (2 Oct report) and where they stand now

1. **Cancelled PO could still be received.** Receiving is now refused (`receiving.rs:1621`, plus the DC node), and waiting counts on cancelled POs are hidden. **Still open:** the server's cancel check ignores waiting counts (`cloud/postgres/sync.rs:9074-9089`). The hub's guard only works once the background DC sign-in has run (`count-review-state.ts:23`). After a cancel the waiting count becomes void and stuck.
2. **One GRN/invoice across POs:** fixed with one receipt per order.
3. **Same person raised and counted, PO stuck:** fixed. A stale comment on the DC node still claims otherwise (`edge/sqlite.rs:11336`).
4. **Closed-short PO still in Receiving:** fixed by filters (`receiving.rs:153-155`, `edge/sqlite.rs:10762-10766`).
5. **Invoice valued over-delivered pieces:** fixed with min().
6. **"Count sent" banner carried over to the next PO:** fixed.
7. **Lists didn't refresh:** they now refresh every 10 s.
8. **PO Activity gaps:** not re-checked.

## 6. Rig recipe for "agentic" (8580/8581/8582, hub on 5580)

`scripts/rig.sh new <id>` creates database `sim_rig_<id>` from the `sim_golden` template and starts cloud, DC node and store node. Settings come from `RIG_*` env vars and are saved to `runs/<id>/env` (`rig.sh:17-54`, `:212-266`). It only runs the demo seed for a run named `demo` (`:296-298`). `e2e/pos-flow/provision.sh` does the seeding by hand, so the agentic version below copies it.

Prerequisites:
- `backend/target/debug/{cloud,dc,store}` must exist (built with `cargo build --bin cloud --bin dc --bin store`; you'll need to run that).
- Building the template briefly binds port 8199. That clashes with the launch.json "accounts-api" config if it is running.

**Option A — warehouse on a separate DC node, same shape as pos-e2e (no Recall, no zero counts):**
```
cd /Users/hari/Documents/itulah
export RIG_PORT_CLOUD=8580 RIG_PORT_DC=8581 RIG_PORT_STORE=8582
export RIG_AUTH_MODE=required RIG_ADMIN_PASSWORD=Password01 RIG_CLOCK=system
[ -f runs/agentic/env ] && scripts/rig.sh reset agentic || scripts/rig.sh new agentic
lsof -iTCP:9109 -sTCP:LISTEN >/dev/null || { mkdir -p runs/labels; nohup python3 scripts/label-sink.py --port 9109 --save runs/labels >runs/labels/sink.log 2>&1 & }
DEMO_ADMIN_PASSWORD=Password01 scripts/demo-seed.sh sim_rig_agentic http://127.0.0.1:8580 required
# optional: python3 scripts/demo-populate.py --cloud http://127.0.0.1:8580 --dc http://127.0.0.1:8581 --store http://127.0.0.1:8582 --printer-port 9109 --password Password01 --only goods
```

**Option B — warehouse hosted inside the cloud (Recall and zero counts work):**
- Also `export INVENTORY_DC_HOSTING=cloud` before every `new`, `up` or `reset`. `rig.sh` passes your environment through to the nodes, but this setting is not saved in `runs/agentic/env`.
- The hub then sends DC calls to the cloud.
- `review_states.py --base http://127.0.0.1:8580` fits this shape. `demo-populate`'s goods stage assumes a separate DC node, so it is unverified here.

**Hub dev server** (same as the launch.json entry `pos-e2e-hub`, `:1966-1984`). As a command:
```
cd /Users/hari/Documents/itulah/frontend-hub
VITE_API_TARGET=http://127.0.0.1:8580 VITE_EDGE_TARGET=http://127.0.0.1:8581 NODE_OPTIONS=--max-old-space-size=768 npm run dev -- --port 5580 --strictPort
```
As a launch.json entry: `{"name":"agentic-hub","runtimeExecutable":"npm","runtimeArgs":["run","dev","--","--port","5580","--strictPort"],"cwd":"frontend-hub","port":5580,"env":{"VITE_API_TARGET":"http://127.0.0.1:8580","VITE_EDGE_TARGET":"http://127.0.0.1:8581","NODE_OPTIONS":"--max-old-space-size=768"}}`.

Ports 8580–8582 and 5580 are not used anywhere in launch.json. Tear down with `scripts/rig.sh down agentic`.

**At least 15 stores (coordinator's requirement)**
- The template already holds **13 stores**: `store-01`…`store-13`, units C001 to C013 (`migrations/postgres/0002_demo_seed.sql:1-5`, `0600_…sql:90-113`). No migration removes them, and `demo-seed` doesn't wipe them.
- **Stores exist as cloud data only.** The store list reads units of kind STORE (`cloud/postgres/stores.rs:283`), so no store node is needed for the count.
- Only `store-01` has a node (8582), and it is only needed for store-side work: the store app, the till, and store receiving. Another node would need its own sync origin plus another `store` process.
- Add 2 or more stores through the setup endpoint (`cloud/http/mod.rs:572`, `cloud/postgres/setup.rs:152-178`, `:563-622`). Both of its preconditions — a head office and a STORE pool template — are already in the template. The new stores get codes C014 and C015, ids `store-c014` and `store-c015`.
```
TOKEN=$(curl -s -X POST http://127.0.0.1:8580/api/v1/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"Password01"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
curl -s -X POST http://127.0.0.1:8580/api/v1/setup/stores -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" -H 'Origin: http://127.0.0.1:5580' \
  -d '{"stores":[{"name":"Agentic 14","city":"Bandung","manager":{"name":"Manajer 14"}},{"name":"Agentic 15","city":"Bandung","manager":{"name":"Manajer 15"}}]}'
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8580/api/v1/stores
```
Every store needs a manager name, or the call fails with a 422. `rig.sh reset agentic` goes back to 13 stores, so repeat this after every reset.