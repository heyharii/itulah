# UX consistency audit: Ops + Inventory + Allotment (hub)

Scope: 31 routes from the brief, phone 414x896 (pointer: coarse was true, so measured heights are real) and desk 1440x900, plus these record surfaces: Receiving count sheet, Picklist sheet, Count sheet, Store (inventory) sheet, Allotment sheet, Flow sheet, New count sheet, New Return page, New Allotment composer. Pools open inline (accordion), not as a sheet.

Method: DOM reads (`innerText`, computed sizes) and code reads under `frontend-hub/src/screens/{operations,inventory,allotment}` and `components/ui`. "seen on screen" means measured or read in the running app; "from code" means source only.

Limits, stated up front:
- The Browser pane was hidden, so `screenshot` timed out every time. Colour, spacing, radius, overlap and truncation were NOT judged visually. Anything in category 5 is from DOM sizes or code.
- Animations do not progress while the pane is hidden, so sheet rects sat at off-screen start positions. Contents and button sizes inside them are still valid.
- The backend was slow (five auditors share one origin). `/operations/stock/articles` stayed on "Loading…" for 12 s or more. `/operations/activity` stayed on "Reading the log…" on phone and desk. Desk `/allotment` never left "Reading everything the pool holds…". These are not judged as bugs.
- Empty on the rig: Movements, Observations, Exceptions, Count (one row), Ledger, Return from Store. Judged from code where needed.
- I did not press action buttons (Pack, Pick, Print, Submit, Generate). One click on "Print 200" fired only GET `print-session` requests and changed nothing.
- The app root went blank twice (after a pushState navigation and after an HMR-style reload). A fresh load recovered both times and I could not reproduce it, so it is not a finding.

---

## Category 3. Phone rules the owner set

### [H] Picking has no dock; its filter chips, sort select and sort direction sit in the page body, mid-list
**Where:** `/operations/picking` (`operations/picking/picking.tsx:190-290`).
**Evidence:** Seen on screen (phone): no search or dock at all. Between the "To pick" rows (y≈303-869) and the picklists table sit chips "All 5" 66x36, "Completed 5" 126x36, "Closed short 0" 139x36 at y≈1003, then a "Default order" select 237x32 and a "Sort descending" button 44x44 at y≈1063. From code: the screen is `Card` + `CardHeader` + `Segmented` + `DataTable`; `view` is `useState`, so it is not in the URL.
**Inconsistent with:** `/operations/packing-lists` has the same All / Completed / Closed short switch as a dock chip "All" (desk: SubTabs "All · 5", "Completed · 5", "Closed short · 0"). Packing, Dispatch, Count and Board all put search and sort in the dock.
**Suggested standard:** Phone: no chips, select or sort button in the body. Search, status and sort go in `DockTools`. Use one component and one label shape ("All · 5") for the picklist status switch on both screens.

### [H] Primary action sits at the top of the page on phone (Dispatch), and Control puts action buttons mid-page
**Where:** `/operations/despatch` and `/operations/despatch/trucks` (`operations/despatch/trucks.tsx:226-236`), `/inventory/control`.
**Evidence:** Seen on screen (phone): a black "Dispatch" button 117x44 at y=68, directly under the title. `PageHeader actions` wraps it under the title on phone. `/inventory/control` has "Repost the projection" 336x44 at y≈476 and "Replay and compare" 336x44 at y≈527, mid-page, plus a "Test controls" tint button 121x32 inside the header card. Desk shows the same Dispatch button at x=1303,y=29.
**Inconsistent with:** "Every action at the bottom (dock, Fab, sheet footer, card foot)". Counts, Flows, Allotments and Return to HO give their start action to the Fab in the dock.
**Suggested standard:** On phone, Dispatch becomes a Fab/dock action ("New trip" or "Dispatch"). Control's two runs go in a sheet footer or the dock. Header `actions` stay desk-only.

### [H] New Allotment composer scrolls sideways on phone
**Where:** `/allotment/new?supplier=…&articles=…` (`allotment/matrix.tsx:1364`).
**Evidence:** Seen on screen (phone): a store tab strip C001…C013 in a `div` with `overflow-x-auto`, scrollWidth 941 vs clientWidth 388, each tab 61-64x44. From code: `[scrollbar-width:none] … overflow-x-auto … [&::-webkit-scrollbar]:hidden`, so the scrollbar is hidden too and nothing signals that it scrolls.
**Inconsistent with:** Owner rules "NOTHING scrolls sideways" and "tabs inside a sheet wrap, not scroll". `Sheet` section tabs already wrap on phone (`max-md:flex-wrap`).
**Suggested standard:** Replace the strip with a store picker (dock chip or sheet list) that shows "C001 · Cikupa · 3 of 13 filled". If tabs stay, they wrap.

### [M] Record-sheet actions are in three places: header, mid-body, pinned footer, or the very end of a 5,000 px form
**Where:** Allotment sheet (`allotment/allotments.tsx:1424-1480`), Store sheet (`/inventory?location=store-01`), Flow sheet (`inventory/flows.tsx`), vs Receiving, Picking, Packing, Dispatch and Return PO sheets.
**Evidence:** Seen on screen (phone). Allotment sheet: "Cancel and re-allot" 168x44 and "Close short" 113x44 sit at y≈985, directly under the title, above the lines table. Store sheet: "Count store" 109x40 sits mid-sheet under the figures. Flow sheet: scroll height ≈5,000 px; "Cancel" 81x44, "Submit" 82x44 at y=4956 and "Retire" 75x44 at y=5037, inline at the end of the content. Pinned footers: Receiving "Submit count", Picking "Submit", Return PO "Generate Surat Jalan", Packing "Packing list" + "Pack next shop · …".
**Inconsistent with:** Each other, and the owner's "every action at the bottom" rule.
**Suggested standard:** Every record sheet's actions go in the sheet `footer`, pinned. `actions` in the header stay for desk only, or are used for non-destructive view toggles.

### [M] Phone lists use at least six different record shapes, only some of them the lead-figure card
**Where:** All phone lists in the group.
**Evidence:** Seen on screen (phone).
- Lead-figure cards (name+code top-left, one figure top-right, hairline, foot): Receiving, Board, Printing, Packing Lists, Pools, Flows, Allotted, Counts, Return PO.
- Grouped plain rows 368x62 or 304x58, no card: Picking "To pick", Allotments "Unallotted", Packing "To pack".
- DataTable label/value stacks ("SKUs 4 / Pieces 8 / To Pack 0 / Completed"): Picking "Picklists", Packing "Cartons", Dispatch.
- A bare `<table>` (Pool / On Hand / Seen / Last Count): Operations › Stock.
- Store cards 202-236 px tall with a ring and four tiles: Inventory › Stock.
- 164 pool cards in one scroll: As of.
- 48 SKU cards under a metrics card: On Hand & Shortfall.
**Inconsistent with:** The lead-figure card standard; each other (card button words "Pick", "Pack", "Print 200", "Count receive", "Open", or none at all).
**Suggested standard:** Every phone list is the lead-figure card. Grouping is a section header over cards, not a different row shape. The Ops Stock tree and As of get a collapsed "per site" card (As of: filter, don't render all 164).

### [M] Text below 14 px on every phone screen, and 11 px inside the store card ring
**Where:** Bottom bar on all routes (`components/shell/bottom-bar.tsx:246,451`); `/inventory` (`inventory/stock-cards.tsx:738`).
**Evidence:** Seen on screen: bottom-bar labels "Home / Workload / Receiving / Allotment / More" are 12 px on every phone route (computed `font-size: 12px`, 5 nodes each time). On `/inventory` there are 12 text nodes at 11 px (the ring centre "—", `text-[0.6875rem]`).
**Inconsistent with:** Owner rule "never below 14 px"; everything else in the content area is 14-17 px.
**Suggested standard:** Bottom-bar labels 14 px (or icons only with accessible names). Ring label 14 px or move the percentage to the foot line.

### [M] Controls under 44 px that are not Buttons with a coarse-pointer size
**Where:** Dock "Filter and sort" icon, dock "+" Fab, composer "Fill <article>", New count selects, Workload "More" links, Picking select.
**Evidence:** Seen on screen (phone, coarse pointer): "Filter and sort" 28x28 on 13 screens. Dock "+" 36x36 (`fab.tsx` hard-codes `h-9 size-9`). "Fill Kemeja Oxford" 32x32. New count sheet Pool and Kind selects 382x36. Workload "More" links 106x32, 92x32, 124x32 (`py-1.5`). Picking "Default order" select 237x32. Dock search field 36 px. Card foot buttons are 32 px with a 44 px hit area (`size="card"`), which is fine.
**Inconsistent with:** Sheet footer buttons (44), `Button` default (44 on coarse), sheet close X (44).
**Suggested standard:** Every touch control is 44 px or has a 44 px hit area like `size="card"`. Dock icon buttons and the Fab get the pseudo-element hit area. Selects use the 44 px form-field height on coarse.

### [M] Doubled titles and a crumb on only some screens
**Where:** `/inventory/flows`, `/inventory/reconciliations`, `/inventory/control`, `/allotment/new`, `/allotment/returns` (New Return page), plus the crumb on 14 inventory/ops screens.
**Evidence:** Seen on screen (phone). Top bar "Flows" then page H1 "Goods Flows" 15 px, plus eyebrow "Inventory". "Reconciliations" then "Claim Reconciliation". "Control" then "Ledger Control". "New Allotment" then a second H1 "New allotment · Garmen Nusantara, PT" at 20 px (the only 20 px heading in the group). "Return to HO" then "New Return". From code: `crumb="Operations"` on Activity, Picking, Packing, Dispatch; `crumb="Inventory"` on 10 Inventory screens. No crumb on Receiving, Printing, Stock, Count, Ledger, Packing Lists, Workload, Board or Allotments. On desk the header is 49 px with a crumb and 26 px without.
**Inconsistent with:** `PageHeader` hides the echo on phone only when the title equals the screen label; these titles differ, so the echo shows. Screens without a crumb.
**Suggested standard:** One title per screen, equal to the nav label. Drop the crumbs (the sidebar already names the department). Composers show the supplier or store as a caption, not a second H1 in a different size.

### [L] Phone-only and desk-only copy
**Where:** `/inventory/flows` (`flows.tsx:236`), `/inventory/units` (`units.tsx:66`), `/inventory/pools` (`pools.tsx:961`), `/inventory/control` (`control.tsx:604`).
**Evidence:** From code. "Only a head-office Admin can change a flow." is `md:hidden`, so it exists only on phone. The Units explanation paragraph is `max-md:hidden`, so it exists only on desk. The display-unit picker moves from the toolbar (desk) to the foot of the list (phone) on Pools and Control.
**Inconsistent with:** "Same on every device".
**Suggested standard:** Same sentence or none on both. Unit picker lives in one place (dock sheet) on both.

---

## Category 4. Desk / phone parity

### [H] Phone cannot switch between Receiving's two lists, or reach By store / By article on Allotments
**Where:** `/operations/intake` and `/operations/intake/returns` (`operations/intake/header.tsx:92`), `/allotment` (`allotment/allotments.tsx:904`).
**Evidence:** From code and seen on screen. Receiving's `SubTabs` "Purchase orders · 8 / Store returns" is `max-md:hidden`; the code comment says there is no status chip for orders, so on phone the only way between them is the URL. The `Reading` select (Allotments / By store / By article) is `max-md:hidden`, with no dock replacement. Desk Board has a "Board | Table" toggle (x=1241 and 1325) that phone does not.
**Inconsistent with:** Desk, where all of these are one click.
**Suggested standard:** Anything on desk that switches what the list is must be a dock status chip or sheet option on phone.

### [M] Facts present on desk and missing on phone
**Where:** Return PO, Pools, Counts, Board, Allotments, Receiving sheet.
**Evidence:** Seen on screen.
- Return PO desk table has Quantity, Value ("1 item · Rp 0"), Received Date, Person in Charge, Status. Phone card shows quantity, date and status only.
- Pools desk has a summary panel "SITES 14 / POOLS 165 / NEVER COUNTED 165 / DISPUTED 0". Phone has none.
- Counts desk has "COUNTS 1 / IN REVIEW 0 / COUNTING 1 / DRAFTS 0". Phone has none.
- Board desk dispatch cards say "Late · left 3d ago". Phone says "3d ago".
- Allotments desk KPI strip has Active / Completed / Not shipped yet / In transit. Phone sentence "3 allotments are active. 255 pcs not shipped yet, 66 in transit." has no Completed.
- Receiving sheet Article sub-line is "ITM-7579F2AB" with a "Counted" column on desk, vs "Wanita · Blus" and no column header on phone.
**Suggested standard:** Same facts, different layout. Lateness flags and summary figures appear on both.

### [M] Desk Exceptions is a different component tree from phone, with an unlabeled search and a doubled empty state
**Where:** `/inventory/exceptions` (`inventory/exceptions.tsx:248-385`).
**Evidence:** From code and seen on screen. Phone is `DockTools` + `DataTable` cards + `Sheet`. Desk is a hand-built list of `<button>` rows plus `Choice` + a bare `Input` (no label or placeholder in the DOM) and a side `CasePanel`. Desk text "0 cases ¶ Nothing here ¶ Nothing here": the empty state shows once in the list and again in the detail card.
**Suggested standard:** One list component with a desk and a phone layout, as Counts and Movements do.

---

## Category 1. Same concept, different words

### [H] Dates: nine formats in 31 screens
**Where:** everywhere.
**Evidence:** Seen on screen.
- "4 Oct 09.55" (dot as time separator, no year, unpadded day): Picking, Packing, Dispatch.
- "02 Oct, 09:13" (no year): Receiving.
- "02 Oct 2026" (year): Return PO, Printing, Allotment sheet ("Created 04 Oct 2026").
- "02 Oct 2026, 14:28": Counts.
- "06 Oct 2026, 13:52": Reconciliations "Read at".
- "05 Oct 2026, 13:53": As of.
- "02 Oct" (no year): Allotments rows.
- "3d ago" / "2d ago": Board, Picking, Packing Lists, "Counted 3d ago" in Pools.
- "Never" (Pools desk), "Never counted" (cards), "Last count never" (store sheet).
**Inconsistent with:** Owner rule "dates with year".
**Suggested standard:** One helper. Absolute: "04 Oct 2026, 09:55". Relative ("3d ago") only inside a timeline or as a secondary caption. One "never" phrase.

### [H] Quantity unit is written six ways: pcs, pieces, Piece, items, labels, koli
**Where:** Board, Workload, Allotments, Packing, Packing Lists, Picking, Pools, Availability, As of, Control, Time Machine, Printing, Dispatch.
**Evidence:** Seen on screen. "223 pcs" (Board, Workload, Allotments, Receiving). "8 pieces" and "1 picklist · 18 pieces to pack" (Packing, Packing Lists; `packing-lists.tsx:96` says `piece/pieces`). Column "Pieces" over a plain "8" (Picking, Packing, Dispatch). "667 Piece", "255 Piece", "1.423 Piece" (always singular: Availability, Pools, As of, Control, Time Machine). "200 labels" (Printing). "1 koli" (Board cards) next to "1 carton(s)" (Dispatch KPI). Bare numbers with no unit: "1 picklist · 223" (Picking). "1 item / 2 items" (Receiving) counts lines, not pieces.
**Suggested standard:** Quantities are "223 pcs" everywhere; the unit picker may switch to another unit but must pluralise. A carton is "carton", not "koli".

### [H] The same state has different names: count status, flow status, picklist outcome
**Where:** Counts, Flows, Picking, Packing Lists, Return PO, Receiving, Count (Ops).
**Evidence:**
- Count in progress is "Active" (row pill and Count sheet stepper "Draft · Active · Review · Closed"), "Counting" (filter slice `counts.tsx:338`, desk summary "COUNTING 1", Exceptions pill), "Needs review", "Drafts", "To count" (Ops Count status).
- A flow is "Active" with the filter "Including retired", and the Retire button.
- A finished pick is "Completed", a short one is "Closed short"; an allotment stopped early is "Closed short" in the sheet events but the buttons say "Cancel allotment", "Cancel and re-allot" and "Close short"; on a list it shows "Cancelled".
- Return PO status is "Not Generated" (Title Case) and "Completed". Receiving is "Not counted" and "Counted". Packing Lists has two status columns: "Status = In transit" and "Packing = Completed".
- Filter chip "In Transit" on phone (`intake/header.tsx:83`) vs "In transit" on desk (`intake/returns.tsx:42`).
**Suggested standard:** One vocabulary per object lifecycle. Count: Draft, Counting, In review, Closed. A single status per row. Sentence case always. "Closed short" is the one word for stopping an allotment early.

### [M] Empty-state sentences follow no pattern
**Where:** about 40 empty states in the group.
**Evidence:** From code and seen on screen. "Nothing here" without a period (`exceptions.tsx`, 3 places) vs "Nothing here." (`stock/panels.tsx`, `articles.tsx`) vs "Nothing here yet." (`allotments.tsx:1118`). "Nothing to count." (Receiving, Count, Receiving returns). "Nothing coming back." / "Nothing going back." / "Nothing to print." / "Nothing found." / "Nothing matches." / "No orders match." / "No returns match." / "No movements." (Operations ledger) vs "Nothing has been posted to this ledger yet." (Inventory Movements, same ledger). "No reader has reported an observation to this node." "No disagreement matches the filters in force." Picking: "Nothing came off the racks on this picklist." (`picking.tsx:1036`; owner rule: no racks UI).
**Suggested standard:** Two forms only, both with a period: unfiltered "No <things> yet." and filtered "Nothing matches." The same object has the same sentence on both screens.

### [M] Loading text and loading shape differ per screen and per department
**Where:** All list screens; `components/ui/states.tsx`.
**Evidence:** Fifteen different sentences: "Loading…" (Stock by Article), "Reading the log…", "Reading the ledger…", "Reading the exceptions…", "Reading the count board…", "Reading the sweeps…", "Reading the pool…", "Reading the flows…", "Matching the claims…", "Replaying the ledger…", "Comparing the ledger with its projection…", "Folding the ledger…", "Reading what is owed…", "Reading the print queue…", "Reading everything the pool holds…", "Opening the allotment…". From code: `LoadingState` draws a skeleton for `/operations`, `/procurement`, `/master`, `/merchandise` and a text sentence everywhere else, so Inventory and `/allotment` (listed in Merchandise's menu but outside the prefix list) show text.
**Suggested standard:** One word, "Loading…", with the skeleton for every list. Include `/inventory` and `/allotment` in the skeleton prefixes.

### [M] Search label wording and casing differ on every dock
**Where:** All docks.
**Evidence:** Seen on screen. Title-Case noun: "Search Orders", "Search Returns" (twice, for different lists), "Search Stores", "Search Exceptions", "Search Counts", "Search Movements", "Search Articles", "Search Allotments". Lowercase noun: "Search pools", "Search packing lists", "Search cartons", "Search surat jalan", "Search counts", "Search articles", "Search observations", "Search claims", "Search differences", "Search positions". "Search the board", "Search the log", "Search the ledger". Counts has two spellings ("Search counts" in Ops, "Search Counts" in Inventory); Articles has two ("Search articles", "Search Articles").
**Suggested standard:** "Search" or "Search <plural noun>" in sentence case, e.g. "Search orders".

### [M] "New / Add / Submit / Generate" for starting something, and Fab casing
**Where:** Counts, Flows, Observations, Allotments, Return to HO, Time Machine, Receiving, Return PO, composers.
**Evidence:** Phone Fab labels from code: "New Count", "New Return", "New Allotment" (Title Case) but "New flow" (sentence), "Submit a batch" (a verb), "Fold the ledger". Desk buttons: "New count", "New return", "New allotment", "New flow", "Submit a batch". Screen-reader name "Add New Count" / "Add New flow" (`fab.tsx`). Count creation sheet: title "New count", button "Submit". Receiving: "Submit count"; composer: "Submit all" then "Done"; Return PO: "Generate Surat Jalan" appears three times (card button, sheet title, sheet button); Pending verbs: "Sending…" (Receiving), "Submitting…" (Picking), "Dispatching…" (Dispatch).
**Suggested standard:** "New <thing>" sentence case on desk, phone and sheet title; the form's button is "Create <thing>" or "Save", pending "Saving…". "Submit" only where the act is a submission for approval.

### [M] Casing: Title Case vs sentence case for names, headings, table headers and field labels
**Where:** Sidebar, page titles, section titles, table headers, form labels.
**Evidence:** Seen on screen. Sidebar and titles: "Return from Store", "Activity Log", "Packing Lists", "Stock Ledger", "Stock by Article", "Time Machine", "Goods Flows", "On Hand & Shortfall" vs "As of", "Return to HO", "Return PO". The Workload card for the same flow says "Return from store". "Pick List" (desk board column, `board.tsx:481`) vs "Pick list" (phone board, Workload) vs "Picklist(s)" (Picking). "Surat Jalan" (table header and button) vs "Surat jalan" (KPI, search). Table headers "On Hand", "Last Count", "Received Date", "Person in Charge", "To Pack", "Packing List" vs metric "On hand". Pool names "Pick Area", "In Transit" (store sheet) vs "Pick area", "In transit" (Ops Stock, Board). Flow editor fields "Destination Pool", "Done By", "Deadline (Hours)", "RFID Scan", "Manual Count", "May Be Skipped" vs sentence-case labels in other forms ("Reason", "Name"). Receiving sheet "Total Counted", "Not as Ordered".
**Suggested standard:** Sentence case everywhere (the hub's Inter 14 style): "Return from store", "Activity log", "Pick list".

### [M] One flow, many names (and DC / HO / Gudang / Warehouse)
**Where:** Menus, boards, flows, pools.
**Evidence:** Store to HO: "Return from Store" (Ops menu), "Store returns" (Receiving tab), "Return to HO" (Allotment menu), "Store return → Gudang" (flow), "Return stock" (pool). HO to supplier: "Return PO" (Ops menu and board title), "Return list" (Workload), "Return to supplier" (flow), "To supplier" (pool), "Return PO" with "Generate Surat Jalan". Two screens named "Stock" (Operations pools tree vs Inventory store cards). "Allotment" (Ops board) vs "Allotments" (Merchandise composer) vs "Allotted" (pool, tab). "Receiving" is the title of both the PO list and the store-returns list. Department is "Ops" in the sidebar and "Operations" in the crumb. The head-office place is "DC" (Pools), "HO" / "Head Office" (Inventory), "Gudang (HO)" (flows), "Warehouse" / "dc.warehouse".
**Suggested standard:** One term per flow and per place across menu, title, tab and pool names.

### [M] Indonesian words in English UI copy
**Where:** Board, Dispatch, Packing Lists, Flows, Allotment.
**Evidence:** Seen on screen. "Gudang → store", "Gudang (HO)", "Gudang · Staff", "koli" ("1 koli", "KOLI-HO-GUDANG-000002", "Close koli"), "surat jalan" / "Generate Surat Jalan" / "Search surat jalan" / "Surat jalan in transit", "sopir Budi" (data), "KIRIM_GUDANG_TOKO" shown as a sheet title, "lusin / kodi" in Units copy.
**Inconsistent with:** Owner rule: hub copy English, printed documents Indonesian.
**Suggested standard:** UI says "carton", "dispatch note" (or "waybill"), "warehouse". The Indonesian terms stay on the printed document only.

### [M] People shown as login names
**Where:** Count (Ops), Count sheet, Allotment sheet.
**Evidence:** Seen on screen. "yusuf · 02 Oct 2026" (Count card), "Opened by yusuf" (Count sheet), "Created 04 Oct 2026 by rina" (Allotment sheet) vs "Rina Kusuma · 02 Oct, 09:13" (Receiving). On desk Receiving the first read showed "Rina" before the profile loaded.
**Suggested standard:** Always the full name, never the login.

### [M] A store is named five ways, and machine ids leak into the UI
**Where:** Inventory, Allotment, Ops, Pools, Counts, As of, Availability, Flows.
**Evidence:** Seen on screen. "Cikupa" + "Store · C001" (Inventory cards), "C001 · Cikupa" (Ops), "Store 01" (Pools, Allotted cards, New Return page, composer rows), "store-01" (Store sheet eyebrow), "C001" (composer tabs). Machine ids: "dc.warehouse" (Count card and sheet, As of), "dc · Warehouse" (Availability header), "dc.warehouse:on_hand" (Availability), "dc.pending.unidentified" (As of rows), "Site dc", "Owner dc" (Count sheet), "KIRIM_GUDANG_TOKO", and the 64-character state hash in Time Machine.
**Suggested standard:** "Cikupa" with "C001" as the code in the same order everywhere. Pools and places show human labels; ids go to a copy-able detail row.

### [L] Count-in-label format: "·" or space
**Where:** Tabs, chips.
**Evidence:** "Purchase orders · 8", "To print · 3", "Completed · 5" (Packing Lists), "Rows · 0" vs "Unallotted 0", "All 5", "Completed 5" (Picking, Allotments).
**Suggested standard:** "Label · N".

---

## Category 2. Same concept, different component or pattern

### [M] Status is drawn four ways, sometimes twice on one card
**Where:** Packing Lists, Dispatch, Receiving, Return PO, Counts, Exceptions, Observations.
**Evidence:** From code and seen on screen. Packing Lists card: foot-left `Status` (dot+word) "Completed" and right `Pill` (outlined) "In transit". The same "In transit" is a dot+word `Status` on Dispatch (`trucks.tsx`, 2 Status, 0 Pill). Receiving card: foot-left plain `<span>Not counted</span>`, right `Pill tone="info"` "Counted" ("info" is meant to mean in motion; a finished count is not). Observations and Movements use mono `Tag`.
**Suggested standard:** One status grammar per card: one word at foot-left, `Status` (dot+word), colour by tone. Pills only in sheet headers.

### [M] Sheet footers: label, alignment, size and icon differ for the same act
**Where:** Receiving, Picking, Return PO, Dispatch, Packing, Board sheet.
**Evidence:** From code and seen on screen. Receiving: right-aligned "Submit count" (114-124x36). Picking: full-width "Submit" 382x36. Return PO: right-aligned "Generate Surat Jalan". Dispatch: summary text left, "Dispatch and print surat jalan" with Printer icon right; the header button is "Dispatch" with Truck icon; the Board sheet footer is "Dispatch (n)" with Truck icon, `h-10 w-full`, variant flips between primary and ghost. Packing: ghost "Packing list" left, "Pack next shop · <shop>" or "Go to Dispatch" right.
**Suggested standard:** One footer shape (full-width primary 44 px; optional ghost left), verb + object ("Count received", "Dispatch 3 cartons"), pending "Saving…".

### [M] Destructive and confirm patterns vary
**Where:** Allotment sheet, Return PO, Exceptions, Flows.
**Evidence:** From code. Allotment sheet: `ConfirmButton` "Cancel and re-allot" (ghost), "Cancel allotment" (ghost + danger), "Close short" (quiet + danger); confirm labels "Continue", "Cancel and re-allot", "Close short {qty}". Return PO: `Dialog` "Confirm {supplier}?" with Confirm/Cancel and then Done/Close. Flows: "Retire" as an inline button inside a long form. Four stop-an-allotment words across the app.
**Suggested standard:** One destructive variant (ghost + danger), one confirm dialog shape ("Cancel allotment?" / "Cancel allotment" / "Keep it").

### [M] Create flows use a sheet, a page, or a hidden state
**Where:** Counts, Flows, Observations (sheets); Allotments, Return to HO (pages).
**Evidence:** From code and seen on screen. New count, New flow and Submit a batch open a `Sheet`. New Allotment is a route (`/allotment/new`, and with nothing selected it renders the same page as `/allotment`). New Return replaces the list with a full-screen page using local state (`asking`), so it has no URL; Back and reload lose it.
**Suggested standard:** Anything that creates a record is either a sheet or a route, always with a URL.

### [M] Filter, sort and view-switch controls differ per screen
**Where:** Phone docks, desk toolbars.
**Evidence:** Seen on screen. Phone: "Filter and sort" icon (13 screens), "Filters" text button 89x36 (Availability), "Needs answering" chip (Reconciliations), "Rows · 0" (Control), "Fold the ledger" + "State at a sequence" (Time Machine). Desk: "Filter" 77x32 text (Activity, Observations, Time Machine), "Sort" + "Columns" menus (Pools, Counts), `Segmented` "Every SKU / Over-promised" (Availability), `SubTabs` (Packing Lists, Allotments), `Segmented` in a card (Picking, same All/Completed/Closed short switch), chips "Everything / Refused" (Activity). Availability, Control, As of, Observations and Time Machine still use the older `Toolbar`.
**Suggested standard:** One dock status chip + one "Filter and sort" icon on phone, one `SubTabs` + one "Filter" button on desk, for every list.

### [L] Operations › Stock is a one-tab strip over a raw table
**Where:** `/operations/stock` (`operations/stock/stock.tsx:294-330`).
**Evidence:** Seen on screen: desk has one tab "Stock" (62x40) under an H1 "Stock"; phone has a dock chip "Stock" with nothing to choose; the body is a raw `<table>` (`h-12 bg-soft` header), not `DataTable`. Headers "On Hand", "Seen", "Last Count".
**Suggested standard:** No one-option tab strips. Use `DataTable`.

### [L] Desk header primary action lives in three different places
**Where:** Dispatch, New flow (header), New count and Submit a batch (toolbar row), Return to HO "New return" (header).
**Evidence:** Seen on screen (desk): Dispatch 105x36 at (1303,29); New flow 108x36 at (1300,29); New return 99x36 at (1309,24); New count 118x36 at (1014,77) in the toolbar; Submit a batch 150x36 at (1258,136) in the toolbar.
**Suggested standard:** The one primary action sits in the header, top-right, on every screen.

---

## Category 5. Visual

### [M] Heading and label scale differs between look-alike places
**Where:** Page, card, section and sheet headings.
**Evidence:** Seen on screen. Desk H1 15/600; phone top bar 17/600; composer H1 20/600; Picking/Packing card titles H3 16/600; Inventory Stock section heads H2 14/500; sheet title 16/600; KPI labels 14/500 and figures 18/600 on desk, 24 on phone card figures; metric labels in ALL CAPS ("STOCK", "ALLOTTED", "ON HAND" in Availability and As of; "SITES", "POOLS", "COUNTS", "IN REVIEW", "POSTINGS", "LOADED" in desk side panels) vs sentence-case labels in other KPI strips.
**Suggested standard:** One scale: title 15/17, section 14/600, KPI figure 18, labels sentence case. No ALL CAPS.

### [L] Filler copy: notes, formulas and footnotes under titles
**Where:** Availability, As of, Control, Workload, Pools, Reconciliations, Dispatch sheet, Receiving sheet.
**Evidence:** Seen on screen. "Stock + Shortfall = On Hand + Allotted + Missing" (Availability, As of); "Read only. These are the balances as at 05 Oct 2026, 13:53, replayed from the movements …" (As of); "Replay reads; repost writes. Repost aborts rather than commit …" (Control); "Numbers come from the ops boards and the order book — nothing estimated." (Workload); "Observations counted over the last 24h · confirmed lost measured over 30 days" (Pools); "Every claim matches. Nothing here is holding the fleet total back." (Reconciliations); "Tick the cartons going on this trip. One surat jalan for the trip, made the instant it departs." (Dispatch sheet caption).
**Inconsistent with:** Owner rule "no filler copy"; `PageHeader` already stopped drawing `sub`.
**Suggested standard:** Delete the notes; keep short labels (Settle by, Owed).

---

## Category 6. Behaviour and accessibility

### [M] Same tap, different outcome
**Where:** Allotments, Pools, Flows, Receiving.
**Evidence:** Seen on screen (phone). Allotments "Unallotted": tapping a row selects it (URL gets `?articles=…`; the dock then shows "1 selected" and "Make Allotment"). "Allotted": tapping a card opens a sheet (`?allotment=…`). Pools: "Open" expands the card inline and the button turns into "Close", while Flows "Open" opens a sheet. Receiving: tapping a counted PO card does nothing (no sheet), tapping "Count receive" opens the sheet.
**Suggested standard:** Card tap = open the record sheet; the foot button = the primary act on that record.

### [M] Filters persist in the URL on some screens and not on others
**Where:** Picking, Packing Lists, Printing, Flows, Availability, Activity vs Counts, Receiving, Allotments.
**Evidence:** From code. `useState` (lost on reload or share): Picking `view`, Packing Lists `tab` + `typed`, Printing `tab`, Flows `showRetired`, Availability `pool` + `view`, Activity `flow` + `only`, Board `store` + `typed`. URL-backed (`useSheet`): Counts `count-status` and `q`, Receiving `q`, Allotments selection and `allotment`.
**Suggested standard:** Every filter and search is in the URL.

### [L] Accessible names missing
**Where:** Shared `Sheet` close X, `/inventory/control`.
**Evidence:** Seen on screen: the sheet close button (44x44 phone, 32x32 desk) has no text or `aria-label` (`sheet.tsx:236-238`). `/inventory/control` has two buttons 336x32 at y≈398 and y≈437 with no accessible name. Dock Fab names are "Add New flow" (lowercase noun).
**Suggested standard:** Every icon button has an `aria-label`; Fab names are "New count" style.

### [L] Duplicate routes and a stuck screen
**Where:** `/operations/despatch` and `/operations/despatch/trucks`; `/allotment` and `/allotment/new`; `/operations/stock/articles`.
**Evidence:** Seen on screen: `/despatch/trucks` renders exactly the same page as `/despatch`; `/allotment/new` with no selection renders the list. `/operations/stock/articles` stayed on "Loading…" for 12 s or more on phone and desk (may be load; not confirmed). Folder and URL say "despatch", the UI says "Dispatch".
**Suggested standard:** One URL per screen; redirect the duplicate; spell it "dispatch".

---

## What is already consistent (do not touch)

- "Quantity" is the only spelling; there is no "Qty" anywhere in the group.
- Number grouping is the same everywhere: "21.060", "1.357", "1.423" (dot thousands).
- Every record detail in the group is a `Sheet` (rail on desk, bottom sheet on phone); there is no page-style record.
- Card foot buttons are words ("Pick", "Pack", "Print 200", "Count receive", "Open"), 32 px with a 44 px hit area; no pencil icons anywhere in the group (grep).
- The document does not scroll sideways on any of the 31 routes (`scrollWidth - innerWidth = 0`), except the composer strip noted above.
- `PageHeader` removes its own title on phone when it echoes the top bar.
- Desk H1 is 15/600 on every screen; KPI strips are the shared `Kpi` component.
- Required marks in forms ("Pool*" with "(Required)") come from the shared `Field`.
- Most list screens carry a dock with search (`DockTools`); dock search fields are all 36 px.
- Sheet footer buttons and `Button` heights are 44 px on a coarse pointer.
- Status tones follow the Pill rules (ok green, warn amber, bad red, info for in-motion), except the Receiving "Counted" case noted above.
- Skeleton loading for `/operations` is a deliberate owner rule (2026-10-05); the finding above is only about the departments left out.
