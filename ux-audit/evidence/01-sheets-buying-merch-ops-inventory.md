# Record-sheet audit A — buying, merchandise, operations, inventory, allotment, commercial

Scope: every record sheet, form sheet and dialog-as-record in `frontend-hub/src/screens/{procurement,master,operations,inventory,allotment,commercial}` plus the shell they share (`components/ui/sheet.tsx`, `record-panel.tsx`, `dialog.tsx`, `rows.tsx`, `pill.tsx`, `tag.tsx`, `lib/sheets.ts`).
Date of audit: Tue 6 Oct 2026. Read-only. Working tree as it was on disk; other people were editing files while I read (see "What I could not open").

## How the evidence is labelled

- **seen on screen** = measured with `getBoundingClientRect` / `getComputedStyle` / innerText in the running hub (:5360) as Rina, at 1440x900 or 414x896. The browser pane was hidden, so screenshots timed out; I read the DOM instead. CSS transitions do not advance in a hidden pane, so some x/y positions are mid-animation (I only quote sizes, text and order).
- **from code** = read in the source, not observed running.

## What I could not open (be honest)

- The Rina session **expired at about 14:12 on 6 Oct** (the app fell back to the Sign in screen; I did not sign in myself) and came back at about 14:26. Two stretches of the audit were therefore code-only.
- The rig is thin: Promotions, Campaigns, Vouchers and Inventory > Exceptions are empty, so promotion / campaign / voucher / exception sheets are **from code only**.
- **Opened and measured on screen:** PO sheet (desk and phone), Supplier (phone), Article (phone), Allotment (desk), Division term sheet (desk), Count (desk), Pool (desk), Surat jalan (desk), Carton (desk), Picklist read-back (desk), Picklist accept (desk and phone).
- **Never reached on screen (from code only):** receiving count, pack, dispatch composer, tagging, stock cards (place / road / order), pricelist and price changes, setups (New Articles), units, flows, missing, observations, supplier returns, composer, item form, basket, held order, amendments, outstanding, Ops stock panel, promotion / campaign / voucher forms.
- Several in-page SPA navigations (history.pushState) left requests pending and sheets stuck on "Loading…", so every on-screen sheet was opened after a hard page load; I treat that as a test-harness artifact, not a finding.
- `procurement/import.tsx` had an Indonesian caption and button when I first read it ("Bangun PO dari file ...", "Mulai ulang") and an English one a few minutes later (someone is editing it, uncommitted). I treat it as already fixed and do not list it as a finding.
- `PickerSheet` / `BottomSheet` (picker-sheet.tsx) are choice pickers, not record sheets; not audited beyond confirming that.

---

## 1. Census

Legend. **Head** = id (mono, above title) / title / caption / badge. **H-act** = `actions` prop (header). **Foot** = `footer` prop. "Fold" = the collapsed "Activity N" strip that `Sheet` appends under the body when `subject` is set and there are no tabs. "Local" = open state is component state, not a URL key.

Shell facts that apply to every row (from `sheet.tsx`): title 16px/600 single-line `truncate`; caption 15px `truncate` (one line only); id 15px mono; close x 32px desk / 44px coarse; tab strip 48px, 15px; footer forces `[&_button]:h-9` (36px) at every size; on phone the shell is a bottom Drawer 100dvh minus 12px (grip + swipe), `H-act` wraps to a full-width row under the title (`max-md:order-3 max-md:w-full max-md:flex-wrap`); widths: rail = `clamp(27.5rem,62vw,47.5rem)` (760px at 1440), wide = clamp(…,72vw,56rem), table = clamp(…,92vw,64rem), workspace = clamp(…,96vw,84rem); only `rail` docks beside the list (>=1300px).

**Rows with on-screen measurements:** 1 (PO), 8 (Supplier), 21 (Article), 22 (Division), 29 and 30 (Picklist), 33 (Carton), 35 (Surat jalan), 38 (Pool), 40 (Count), 47 (Allotment). All other rows are from code.

### Procurement

| # | Sheet | File:line | Opens from | Width (as set) | Head: id / title / caption / badge | H-act | Foot | Body parts | Tabs / Activity | Edit model |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Order (PO) | purchase-orders.tsx:2199 | `?order=` | wide + `md:w-[58rem]` (seen: 928px) | none / **PO number** / "Created by {full name} · {date}" / Pill (hidden when finished, replaced by a rotated stamp) | none | Print icon left; Close Short, Cancel, Edit, Review Count right (seen: 36px) | CountBanner, Facts (gap-x-10 gap-y-4), Section quiet "Items (N)", ItemsTable, Return PO, Terms, Notes | no tabs; `subject` -> Fold at the bottom | separate composer sheet (`edit-order`); ConfirmButtons for Close Short / Cancel |
| 2 | Order composer (New PO / Edit / Review) | composer.tsx:1932 | `?new-order` `?edit-order=` `?basket` | wide + `md:w-[78rem]` | none / "New PO" / "Edit PO-…" / "Review this order" / "Review the changes" / none / none | none | Cancel + Review order; then Back to editing + Submit | Banners, Fields grid, Section "Items", ItemsTable | none | the sheet is the form; 2 steps; dirty guard (askClose) |
| 3 | Review count | count-review.tsx:135 | `?verify=` | hand-built dialog, `clamp(27.5rem,72vw,56rem)` | none / "Review Count" + CircleAlert/CircleCheck icon / PO number mono **under** title / none | none | own row: Recount icon, Close Short, Partial Receive / Submit | table, Facts, invoice form | none | inline: Accept / Recount / Close Short |
| 4 | Order (outstanding) | outstanding.tsx:405 | `Sheet` over Outstanding | rail | PO number / **supplier** / none / Pill **in body** | link "Full record" | none | Facts, "Still owed" MiniTable with an inline "Stop waiting for the rest" form, TotalsLadder | `subject` -> Fold | inline row form |
| 5 | Price query (amendment) | amendments.tsx:406 | `?amendment=` | rail | PO number / article / none / none | link "The order" | two equal `flex-1` buttons: Reject (danger), Approve the invoice | warn Banner (3 sentences), Facts, h4 + note, MiniTable, TotalsLadder, Textarea | `subject` -> Fold | decide in the foot |
| 6 | Basket | basket.tsx:118 | `?basket` `?cart` | wide + `md:w-[52rem]` | none / "Basket" / none / none | **Empty (danger) + Raise an order (primary)** | none | KpiStrip, one Card + CardStrip per supplier, MiniTable with quantity Inputs | none | inline |
| 7 | Held (offline) order | held-orders.tsx:100 | local | rail | none / supplier / "Offline" or "Not sent" (status as caption) / none | none | Delete Order (left, ConfirmButton) · Edit, Send Now (right) | Banner, Facts, line list | none | opens the composer |
| 8 | Supplier | suppliers.tsx:1897 | `?supplier=` | wide | supplier code / name / none / Pill | none | read: Print icon + Edit; edit: Cancel + Submit | SubTabs **in body** (Details/Orders/Catalogue), Facts, contacts, Section quiet headings, StatusSwitch row | RecordPanel appended by hand inside Details (no `subject` on Sheet) | **in place** (tab content swaps, foot swaps); SavedDialog after |
| 9 | New supplier | suppliers.tsx:1674 | `?supplier=new` | wide | none / "New Supplier" / none / none | none | Cancel + Submit | Banner, company fields, contacts, notes | none | form; no dirty guard |
| 10 | Supplier orders "View all" | suppliers.tsx:2246 | local (nested) | wide | none / group title / supplier name / none | none | none | OrdersTable | none | read |
| 11 | Supplier catalogue "View all" + item reader | suppliers.tsx:2589, 2597 | local (nested) | wide | item code / item name / none / none | **Edit** | none | ItemDetail | none | opens item form sheet |
| 12 | Supplier item (Catalogue) | catalogue.tsx:601 | `?item=` | rail | item code / name / none / none | **Edit** | none | ItemDetail (photo, Facts, "Comes in", "Tags") | `subject` -> Fold | opens item form sheet |
| 13 | Supplier item (Sourcing) | sourcing.tsx:951 | `?item=` | rail | item code / name / none / none | none | quantity Input (h-8) + Add to basket | ItemDetail | `subject` -> Fold | adds to basket |
| 14 | Add / Edit item | item-form.tsx:793 | `?new-item` | wide + `md:w-[64rem]` | caption-or-code / title / none / none | none | Cancel, [Skip this one], [Add next item], Submit | Banners, photo block (touch vs pointer variants), fields | none | the sheet is the form; dirty guard |
| 15 | Add from the Catalogue | pick-items.tsx:174 | local (over composer) | wide + `md:w-[72rem]` | supplier name as id / title / none / none | none | "N picked." left; Cancel + "Put N on the order" | catalogue picker | none | picker |
| 16 | Import PO | import.tsx:376 | `?import` | workspace | none / "Import PO" / one long instruction sentence / none | ghost "Start over" | none | wizard | none | wizard |
| 17 | Offline supplier | offline-suppliers.tsx:153 | local | rail | none / name / none / none | none | none | Facts | none | read |
| 18 | Return PO (supplier return) | supplier-returns.tsx:595 | `?allotment=` (shared key) | table | return number / supplier / none / **Tag** (reason) | Print + Download (ghost, icon) | "N owed" left; Expect replacement + Close Short (danger) — or the board's `extra` | rotated stamp, Facts, h4 "Items" + Card + raw table ("Pcs"), ActivityFold | own ActivityFold, no `subject` | none; close-short in foot |
| 19 | Generate Surat Jalan | operations/board/suppliers.tsx:231 | local | rail | none / "Generate Surat Jalan" / supplier name / none | none | one primary, same label as the title | Field, h4 + Card + raw table | none | form |
| 20 | New Article (setup) | setups.tsx:615 | `?setup=` `?receipt=` | wide | **"New Article" label (sans)** / article name / **mono code as caption** / none | none | none (buttons inside DeliverySetup) | session record / delivery setup form | none | form; Discard This Draft dialog |

### Master

| # | Sheet | File:line | Opens from | Width | Head | H-act | Foot | Body | Tabs / Activity | Edit model |
|---|---|---|---|---|---|---|---|---|---|---|
| 21 | Article | master/detail.tsx:90 | `?article=` `?article-edit` | rail; **switches to table** on the SKUs tab | article code / name / none / none (Pill **in body**) | **Edit / Stop editing** (toggle) | none | SubTabs in body (Overview/SKUs/Suppliers), Pill + Tag(code again), Facts, 5x SubHead | `subject` -> Fold under every tab | **in place**: whole body becomes ArticleForm (Save + Cancel inside) |
| 22 | Term sheet (Division / Tag / Size) | master/vocabulary.tsx:682 | local | rail (seen: 760px) | **kind label "Division" (sans) in the id slot** / label / none / none | none | none (SubmitRow in body: Delete left, Save right) | form only; Code = disabled readOnly Input | none | the sheet is the form |
| 23 | Colour | master/colours.tsx:575 | local | rail | "Color" label / name / none / none | none | none (SubmitRow in body) | colour picker form | none | form |
| 24 | Name suggestion | master/name-suggestions.tsx:212 | local | rail | "Name" label / name / none / none | none | none (SubmitRow) | form | none | form |
| 25 | Payment template / term | master/payment-templates.tsx:779, 1204 | local | rail | code / label / none / local `Status` | none | none (SubmitRow) | form + instalment lines | none | form |
| 26 | Unit / conversion | inventory/units.tsx:201 | local | rail | none / label or "1 X = N Y" / none / none | none | none | UnitForm / ConversionForm | none | form |

### Operations

| # | Sheet | File:line | Opens from | Width | Head | H-act | Foot | Body | Tabs / Activity | Edit model |
|---|---|---|---|---|---|---|---|---|---|---|
| 27 | Receiving count | intake/receiving.tsx:765 | `?delivery=` | table | PO number / **supplier** / none / none | none | one primary, "Submit count" | Card + bespoke 3-track grid, unit Selects, 44px inputs | none | the sheet is the count |
| 28 | Store delivery | intake/receive-return-sheet.tsx:81 | `?inbound=` | rail | shipment ref / "From {raw site id}" / none / none | none | none | Facts ("Koli"), Segmented, Textarea, "Submit count" in body | none | receive form |
| 29 | Picklist (to accept) | picking/picking.tsx:719 | `?accept=` | rail | none / **"Picklist"** / "shop · allotment" / none | none | **vertical stack**: From Select, "N short", full-width Submit | Facts + (phone: PickLineRow list / desk: MiniTable) | none | accept form |
| 30 | Picklist (read back) | picking/picking.tsx:983 | `?pick=` | rail | **first 8 chars of a UUID** / "Picklist" / none / StatusPill | **Pack (primary AppLink)** | none | Facts, MiniTable | none | read |
| 31 | Pack | packing/packing.tsx:768 | `?pack=` | **workspace (84rem)** | none / "Pack" / shop / none | none | summary text left; "Pack and seal" right | h4 "Lines" (15px) + raw table + QtyInput | none | form |
| 32 | Packed (receipt) | packing/packing.tsx:325 and 467 (duplicated) | local | rail | none / "Packed" / none / none | none | Packing list, Pack next shop / Go to Dispatch | manifest | none | next step |
| 33 | Carton | packing/packing.tsx:933 | `?koli=` | rail | koli number / "Carton" / none / none (status = PositionPill **in a Fact**) | Packing list + Print sticker (error text under the button) | none | Facts, QrBlock, SkuLines | none | read |
| 34 | Dispatch | despatch/trucks.tsx:546 | `?new-dispatch` | wide | none / "Dispatch" / **two-sentence instruction** / none | none | summary text + "Dispatch and print surat jalan" | ShopRail + CartonChoice, Textarea; `Problem` below the body | none | composer |
| 35 | Surat jalan | despatch/trucks.tsx:1038 | `?shipment=` | rail | trip doc number / **shop** / none / none (Status dot+word **in a Fact**) | Print surat jalan (soft, icon) | none | Facts, Section flush "Cartons on it" | none | read |
| 36 | Print PO | tagging/tagging.tsx:382 | `?job=` | wide | none / PO label / none / none | Print all | none | Preview, 8-column MiniTable (one blank header), PrinterCard | none | actions |
| 37 | Stock panel (Ops > Stock) | stock/panels.tsx + dialog.tsx:338 `Panel` | local | centered modal 52rem / 72rem | none / title / `sub` (number in mono, "Settle by X") / none | Back | none | Grid tables | none | read; **not a Sheet** |

### Inventory and allotment

| # | Sheet | File:line | Opens from | Width | Head | H-act | Foot | Body | Tabs / Activity | Edit model |
|---|---|---|---|---|---|---|---|---|---|---|
| 38 | Pool | inventory/pools.tsx:1145 | `?pool=` | table | **raw pool id** / pool label / none / none (Tags in body: group, code, "SUM OF ITS SHOPS") | none | none | Facts, 6 stacked sections (h4 + MiniTable), "Correct a placement" form with a readOnly Input | `subject` -> Fold | inline form with its own submit |
| 39 | Pool allotments / sightings | pools.tsx:1519, 1614 | `?pool-allotments=` `?pool-sightings=` | wide | raw pool id / "Allotted out of this pool" / "Seen in this pool" / none | none | none | paragraph + MiniTable | none | read |
| 40 | Count | inventory/counts.tsx:707 | `?count=` | rail | **raw pool id** / **free-text reason** / none / none | none | none; **soft buttons in body** (Activate, Submit, Submit) | Lifecycle stepper, Tag + 2-3 Pills, Facts, TotalsLadder, h4 "Lines", MiniTable with h-7 Inputs | `subject` -> Fold | inline counting |
| 41 | New count | counts.tsx:1081 | local | rail | none / "New count" / none / none | none | none (form submit in body) | form | none | form |
| 42 | Exception | exceptions.tsx:293 (phone Sheet) / CasePanel inline Card (desk) | local | rail on phone; **no sheet on desk** | phone: none / "Exception" / kind / none, then a **second head** inside a Card (mono id, kind dot, title, figure strip) | none | none; buttons at the bottom of the Card, inside the scroll | Facts, timeline, Card | none | Found / Confirm lost / Ask for a count / Move |
| 43 | Place sheet / On the road / On order | stock-cards.tsx:1079, 1262, 1319 | local | rail | site key / name / sub — **type name as title + a sentence as caption** | none | none; "Count store" button in body | Ring, Figures, SheetSection (h3 14px/600), MiniTable | none | one action in body |
| 44 | Flow template | inventory/flows.tsx:436 | local | workspace | code / name / none / Pill "v3" | none | none | editor | none | the sheet is the editor |
| 45 | Missing: Move / Write off | inventory/missing-list.tsx:296 | local | rail | none / "Move" or "Write off" / "name · N missing" / none | none | none (submit in body, label = title) | Field "Pcs found" | none | form |
| 46 | Reader batch / Test controls | observations.tsx:726, control.tsx:742 | local | rail | none / title / none / none | none | none | forms | none | form |
| 47 | Allotment | allotment/allotments.tsx:1424 | `?allotment=` | workspace + `clamp(…,98vw,100rem)` (seen: 1400px) | none / **allotment number** / "Created {date} by **rina**" (raw login, seen) / **none** | **Cancel and re-allot + Cancel allotment (or Close short)** (ConfirmButtons) | none | banners, Section "Lines" (read-only matrix, sticky 17rem first column, `overflow-x-auto`), Section "History" | `subject` -> Fold | none |

### Commercial

| # | Sheet | File:line | Opens from | Width | Head | H-act | Foot | Body | Tabs / Activity | Edit model |
|---|---|---|---|---|---|---|---|---|---|---|
| 48 | Promotion | commercial/promotions.tsx:1666 | `?rule=` | rail | rule id / name / none / Status dot+word + "Needs code X" | **Change, Duplicate, End now (danger)** | none | `Block` (icon + 15px/600 + hairline) x3, Facts (gap-y-5), Gauge | **Details / Stores (N) / Activity** (own tab, deliberately no `subject`) | separate form sheet |
| 49 | Promotion form | commercial/rule-form.tsx:759 | `?new-rule` + local seed | workspace + `clamp(32rem,92vw,80rem)` | rule id (change only) / "Change/Duplicate/New promotion" | none | wrapping status sentence left; "Publish" right | `Section` with icon, two columns | none | form |
| 50 | Campaign | campaigns.tsx:1796 | `?campaign=` | rail | campaign id / name / none / Status | **Change, Duplicate, Pause/Resume, End now (danger)** | none | Block / Section / MiniTable | Details / Stores (N) / Activity | separate form sheet |
| 51 | Campaign form | campaigns.tsx:2246 | local seed | workspace 80rem | `vN` or id / New/Change/Duplicate campaign | none | status sentence + primary | form + summary | none | form |
| 52 | Voucher | vouchers.tsx:950 | `?voucher=` | rail | code / **"Gift card · Rp 150.000"** / none / Status + "· Expired" | **Spend (toggle) + Cancel voucher (danger)** | none | Block x3, Facts (gap-x-6 gap-y-5), Balance + Meter, inline RedeemForm (own submit) | **Details / Ledger (N) / Activity** | inline Spend form |
| 53 | New voucher | vouchers.tsx:1269 | local | wide | none / "New voucher" | none | **Submit only** (no Cancel) | `Section` with icon, Choices | none | form |
| 54 | Coupons | vouchers.tsx:1483 | local | table | none / "Coupons" / none / muted text "N codes" | none | none | MiniTable | none | read |
| 55 | Price change | commercial/changes.tsx:815 | local/`?book=` | rail | none / name / none / Status | none | none | Facts, SubHead + aside "Rollout", MiniTables | none | read |
| 56 | Pricelist cell | pricelist.tsx:2287 | `?price=` | rail | article code / name / none / none | **Change price… (primary)** | none | Facts, SubHead x4, MiniTable, TillCheck | none | opens Change price |
| 57 | Pricelist article | pricelist.tsx:2983 | `?article=` (same key as the master) | wide | article code / name | none | none | SubHead + MiniTable per size band | none | read |
| 58 | Pricelist shop shelf | pricelist.tsx:3201 | `?shop=` | table | site id / label | none | none | table | none | read |
| 59 | Change price / New price / Sale price / Publish these prices | change-price-sheet.tsx:714, price-form.tsx:475, pricelist-editor.tsx:377, 874 | local / `?new-price` | wide / rail + `clamp(…,44vw,38rem)` | article code or "N articles" / title | none | status sentence left; Cancel (quiet) + "Publish to N stores" / "Add" / "Publish to all stores" | Segmented, Fields, MiniTable preview | none | forms |

### Dialogs used as record detail

- **Review count** (row 3): a hand-built copy of the Sheet shell (own head, own foot). On phone it is a `PhoneDrawer`.
- **Ops > Stock panel** (row 37): `Panel`, a centered modal with `Back`, not in the URL.
- **Exception CasePanel** (row 42): an inline `Card` on desk.
- **ConfirmButton / Dialog** (24rem card; phone = drawer): used by PO, allotment, voucher, supplier, term sheets, setups.
- **SavedDialog** (receipt, auto-closes in 3 s): after some saves only.

---

## 2. Findings

Severity: **H** = visible to every user on every sheet or contradicts an owner ruling; **M** = inconsistent in a cluster of sheets; **L** = polish.

### [H] F1. Four different head grammars: the id, the title and the caption slots mean different things per sheet
**Sheets:** all (rows 1, 4, 8, 18, 20, 21, 22, 29, 30, 31, 33, 35, 40, 42, 43, 45, 47, 52).
**Evidence:**
- *id mono + name* (what the shell documents): Supplier ("0001" / "Indorama, PT", seen), Article ("00000003" / "Kaos Oblong", seen), Pricelist cell, Carton, Receiving.
- *number as the title, no id*: PO ("PO-021026-001" as 16px title, no id above, seen), Allotment ("ALT-00000004", seen). The PO comment says "the PO number IS the title"; the **same PO** in Outstanding / Receiving / Amendment has the number as the mono id and the **supplier as the title**.
- *type name as the title, identity pushed to the caption*: "Picklist" (caption "shop · allotment"), "Pack", "Packed", "Dispatch", "Exception" (caption = kind), "Move", "Write off", "Generate Surat Jalan", "Basket", "Coupons", "On the road", "On order".
- *a kind label in the id slot*: "Division", "Color", "Name", "New Article" (sans, not mono, `font-sans` override) over the record name.
- *identity in the caption*: New Article puts the mono article code in the **caption**, while the same article in the master has it as the **id** (row 21).
- *composite title*: Voucher = "Gift card · Rp 150.000"; Review count = "Review Count" + icon with the PO number mono under it (id **below** title).
- seen: Surat jalan id "DSP-HO-GUDANG-000004" with title "store-01" (a raw site id; the list calls the same shop "C001 · Cikupa" / "Store 01"); Picklist read-back id "63a968a9"; Count id "dc.warehouse" over the title "Short pick".
- *raw machine ids in the id slot*: Pool and Count show the raw pool id; Picklist read-back shows `id.slice(0, 8)` of a UUID.
**Inconsistent with:** the Sheet doc (`id` = "the record's own identifier, set in mono above the title"; caption = one quiet provenance line) and owner ruling 1 (title = what the record is, not the screen's name).
**Suggested standard:** id = the business number a person says out loud, mono, always above the title (never a kind label, never a UUID; if the record has no number, omit the id). Title = the record's name; if it has no name, repeat the number (PO, allotment). Caption = "Created by {full name} · {date with year}". The record's *kind* ("Division") goes in the caption or is dropped, never in the id slot. Verbs ("Pack", "Move") are for buttons, not titles. One answer for an order: number as id + supplier as title on **every** order sheet.

### [H] F2. A record's status is drawn in eight different ways and at least five different places
**Sheets:** rows 1, 4, 8, 18, 21, 30, 33, 35, 40, 47, 48, 50, 52, 55, 7, 3.
**Evidence (from code unless marked):**
- head `Pill` (outlined, h-7): PO, Supplier (seen: "Active" next to the title), Flow "v3", Picklist `StatusPill`.
- head `Status` (dot + word, no outline): Price change, Promotion, Campaign, Voucher (+ a loose "· Expired" span).
- head `Tag` (mono grey/tinted block, used for the return *reason*): Return PO.
- **body** `Pill`: Article (seen: "Active" Pill plus a `Tag` repeating the code, inside the body), Outstanding order.
- **Fact row**: Carton ("Status" with PositionPill), Surat jalan ("Status": `Status tone=info` "In transit"), Voucher ("Status" repeated although the head already has it).
- caption text: Held order ("Offline" / "Not sent").
- icon only: Review count (CircleAlert / CircleCheck beside the title).
- rotated "stamp" overlay: PO ("FULLY RECEIVED", "CANCELLED", "CLOSED SHORT", opacity .4, -6deg) and Return PO ("COMPLETED"). The PO hides its Pill when finished and relies on the stamp.
- stepper: Count (Lifecycle) with the status expressed nowhere in the head.
- nothing: Allotment (owner removed it on 29 Sep: "a status word beside the number was one more thing"), Pool, Exception (phone).
- Order sheet in Outstanding shows its status as `Pill` in the body, the PO sheet as `Pill` in the head.
**Inconsistent with:** owner ruling 1 (ONE status badge `Pill` in the same place on every sheet) and the Pill doc (`info` = in motion only).
**Suggested standard:** `badge` = one `Pill`, always in the head, tone from the status taxonomy; no status Fact rows, no second copy in the body, no overlay stamp (keep the stamp only if you also keep the Pill and accept two statements). If a sheet has no status (allotment), say so in the standard instead of leaving a hole: allotments do have a state; surface it.

### [H] F3. Header actions: counts, destructive buttons and primaries live in the head; on a phone they become a wrapped row under the title
**Sheets:** rows 6, 11, 12, 18, 21, 30, 33, 35, 36, 47, 48, 50, 52, 56, 16.
**Evidence:** `Sheet` renders `actions` in the head and, below `md`, forces them to `order-3 w-full flex-wrap` (sheet.tsx:229), so every phone head grows a button row.
- 4 header buttons: Campaign (Change, Duplicate, Pause/Resume, **End now** danger).
- 3: Promotion (Change, Duplicate, End now); Allotment on desk (seen: "Cancel and re-allot" 156x36 + "Cancel allotment" 141x36 in the head; third variant "Close short" quiet); Voucher (Spend toggle + Cancel voucher danger); Return PO (Print, Download); Carton (Packing list + Print sticker with an error line under it).
- primary in the head: Pricelist cell "Change price…", Picklist "Pack", Basket "Raise an order" next to a danger "Empty".
- seen: Article on phone, "Edit" 57x40 sits alone on its own row under the title; Carton (desk) head has "Packing list 103x36" + "Print sticker 127x36"; Surat jalan head has "Print delivery note 171x36" (the code I read said "Print surat jalan": the label changed while I was auditing).
- Meanwhile PO / Supplier / Held order / Amendment keep their actions in the **foot**. So **Edit is in the head** for Article, Item, Catalogue item and **in the foot** for Supplier and PO.
**Inconsistent with:** owner ruling 2 (phone actions in the footer, destructive separated, never a row of small header buttons) and the Sheet's own doc ("at most two, plus an overflow") that no sheet follows.
**Suggested standard:** head = id/title/badge/x and at most one overflow (⋯) for Print / Download / Duplicate. Primary and destructive actions in the footer. Never destructive next to primary in the head.

### [H] F4. Five footer conventions, and many sheets have no footer at all (actions are in the body and scroll away)
**Sheets:** all.
**Evidence (from code):**
1. right-aligned Cancel (ghost) + primary: Supplier edit, New supplier, Item form, Composer, Pick items, Change price.
2. summary / problem sentence left + primary right: Pack, Dispatch, Rule form, Campaign form, Price form, Pricelist editor, Publish (sentence size 14 vs 15px, `truncate` vs wrap, colours text / warn / bad).
3. destructive left + primary right: Held order, Return PO ("N owed" left).
4. equal-width pair: Amendment (Reject / Approve the invoice, both `flex-1`); full-width stack: Picklist accept (Select + "N short" + full-width Submit); Generate Surat Jalan (one button, same words as the title).
5. **no footer, buttons in the body**: Term sheets (SubmitRow: Delete left, Save right), Colour, Name, Payment template, Units, Missing (Move / Write off), New count, Voucher Spend, Pool "Correct a placement", Place sheet "Count store", Exception CasePanel (Found / Confirm lost / Ask for a count / Move), **Count** (soft Activate / Submit / Approve), Store delivery ("Submit count"), Article form.
- Receiving count and the New voucher sheet have **only a primary**, no Cancel; Review count has its own hand-rolled foot (Recount as an icon).
- Seen: Picklist accept (desk 760px): foot is one full-width `Submit 702x36`; steppers `One less / One more 38x36`; Pool (desk 1024px): a **954px-wide** `Correct placement` button inside the body with five fields above it, shown even on an empty pool (Holding 0).
- Seen: on the PO sheet the foot is "Print (36x36) | Cancel (82x36) | Edit (61x36) | Review Count (127x36)", right-aligned, primary last; on the supplier sheet Print icon left, Edit right.
**Inconsistent with:** owner ruling 2 (footer, primary last, destructive separated, body scrolls and footer does not).
**Suggested standard:** one foot shape: `[destructive or summary]   ...   [secondary] [primary]`. Every sheet that writes has a foot; nothing that writes lives in the scroll area. Read mode: `[Print icon] ... [Edit]`.

### [H] F5. The same label for two different actions, and primary labels drift: Submit / Save / Add / Publish / Submit count / Sending… / Posting…
**Sheets:** rows 40 (Count), 8, 9, 14, 29, 52, 53, 27, 28, 22-25, 21, 45, 55-59.
**Evidence:**
- **Count sheet in ACTIVE state shows two buttons both labelled "Submit"**: a soft one that records the counted quantities (`record`) and a ghost one that submits the count (`submit`) (counts.tsx ~897 and ~905).
- Primary labels in one family: "Submit" (Supplier, New supplier, Item, Picklist, New voucher, Composer step 2), "Submit count" (Receiving, Store delivery), "Save" / "Add Division" (term sheets), "Save" (Article form), "Add" (New price, Sale price), "Publish" (Rule form, Campaign), "Publish to N stores", "Publish to all stores" (price editors), "Partial Receive" / "Submit" / "Send N items back to count" in the same slot of Review count, "Move"/"Write off" (same as the sheet title), "Spend Rp X", "Correct placement", "Generate Surat Jalan" (same as the sheet title).
- Pending words: "Submitting…", "Sending…", "Saving…", "Posting…", "Publishing…", "Cancelling…".
- Cancel: ghost in most, **quiet** in Change price and ArticleForm, absent in Receiving and New voucher.
**Inconsistent with:** owner ruling 4 (Save/Cancel pair: order, labels, pending states).
**Suggested standard:** primary = verb + object once: **Save** (changes to an existing record), **Create {thing}** (new), **Publish** (reaches the fleet/tills), **Submit count** (a count), never bare "Submit". Pending = same verb in -ing form. Secondary always `Cancel` (ghost), placed left of the primary. A sheet must never have two buttons with the same label.

### [H] F6. Record detail drawn as disabled inputs, and master-data sheets open straight into an edit form
**Sheets:** rows 22, 23, 24, 25, 26, 38, 2, 41.
**Evidence:**
- `CodeFact` (term-form.tsx:31) says in its comment "Said as a fact rather than a greyed-out box", then renders `<Input value={code} disabled readOnly>`. **Seen on screen** on the Division sheet: inputs = `text 44px` + `text(disabled)(ro) 44px`.
- Composer on edit: Supplier is `<Input readOnly>`; **Pool: "Subject" is `<Input readOnly>`, seen on screen** (`text(ro) 44px` as the first of five inputs).
- Every master-data record (Division, Tag, Size, Colour, Name suggestion, Payment template, Unit, Flow) opens **directly as a form**; there is no read view, no Edit step, and the "In use" count, who changed it and when are not shown.
**Inconsistent with:** owner ruling 3 and the memory rule "record detail = facts (label/value), not disabled inputs".
**Suggested standard:** existing record = `Facts` (+ a status `Pill` in the head) with Edit in the foot; Edit swaps the same sheet to the form (like Supplier). New record = the form. Never `disabled`/`readOnly` Input for a value that is not editable: use a `Fact`.

### [H] F7. Seven section-heading styles inside sheets
**Sheets:** all with sections.
**Evidence (seen: in parentheses):**
1. `Section quiet` 14px/400 mute: Supplier "Company / Contact Person / Notes" (seen), PO "Items (2)" (seen: 14px/400).
2. `Section` default: `card-title` 16/600 + hairline + 20px air: Allotment "Lines" / "History" (seen 16/600).
3. `SubHead` 16/600 + `aside`: Article ("UoM", "Created By", "Tags", "Colourways", "Sizes", seen 16/600), Price change, Pricelist.
4. raw `<h4 className="mb-2 text-card-title font-semibold">`: Pool (x6), Count "Lines", Amendment, Outstanding "Still owed", Item detail "Comes in"/"Tags", Return PO "Items", Generate note "In this note".
5. `Block` = 20px line icon + 15px/600 + hairline: Promotion, Voucher, Campaign (the only place heading icons exist).
6. `SheetSection` = `<h3>` 14px/600 + aside: Place / Road / Order sheets.
7. `<h4 text-[0.9375rem] font-semibold>`: Pack "Lines", Supplier "Active Order 0".
Counts are written three ways: "Items (2)", a muted trailing number ("Holding 12"), an `aside` ("4 of 10 digits"), or a Tab label "Stores (13)".
**Inconsistent with:** owner ruling 3 (the same section heading style, `SubHead`, everywhere).
**Suggested standard:** `SubHead` only (16/600, optional right-hand `aside` for a count or a hint). Remove `Section quiet`, `Block`, `SheetSection` and raw h4 from sheets. Counts always in `aside`.

### [H] F8. Widths are not chosen by the kind of content, and `rail` is not a rail
**Sheets:** all.
**Evidence:**
- Seen: Division sheet (3 fields) 760px; Count, Surat jalan, Carton, Picklist 760px (rail); PO 928px; Pool 1024px (table, for an empty pool); Allotment 1400px (of 1440).
- `rail` = `clamp(27.5rem, 62vw, 47.5rem)`: at 1440 it is **760px**, so a 3-field form is nearly as wide as the PO.
- Pack (a 3-column table) uses **workspace** (up to 84rem), a size the shell reserves for "list and the work beside it". Allotment (a read-only matrix with 6-8 columns) uses workspace and then overrides to `clamp(27.5rem,98vw,100rem)`.
- Nine sheets override the width with an ad-hoc class (`md:w-[52rem]` basket, 58rem PO, 64rem item form, 72rem pick items, 78rem composer, `clamp(27.5rem,44vw,38rem)` pricelist editor, `clamp(32rem,92vw,80rem)` rule and campaign forms, `clamp(27.5rem,98vw,100rem)` allotment) because a bare `w-*` loses to the rail class (the comment in composer.tsx says so).
- **The Article sheet changes width in place** (`width={tab === "skus" && !editing ? "table" : "rail"}`) so switching tab makes the panel jump.
- Only `rail` docks beside the list at >=1300px. The two most-opened records (PO, Supplier) are `wide`, so they always cover the list, while a three-field division form docks beside it.
- Supplier "View all" lists, Pool allotments / sightings are `wide` for a 3-column table; Pool itself is `table`; Voucher "Coupons" is `table`.
**Inconsistent with:** owner ruling 5 (width class chosen consistently by kind of content).
**Suggested standard:** rail = a record with <= 10 facts and short tables (set the rail to about 440-520px, not 760); wide = a document with lines (PO, supplier, return); table = a grid read across (receiving, pool, SKUs matrix, allotment lines); workspace = list + form only (New articles, Import, composers). No per-sheet width classes: add a `size` to the shell if a fifth class is needed.

### [H] F9. Tabs: three mechanisms, a "Comments" tab that opens "Activity", and the Activity fold sits below the fold
**Sheets:** rows 8, 21, 48, 50, 52 and every sheet with `subject`.
**Evidence:**
- `Sheet tabs` (bordered strip, 15px, `h-12`/48px): Promotion, Campaign, Voucher.
- `SubTabs` inside the body (14px, 40px tall, seen: "Details 69x40", "Overview 87x40"): Supplier, Article.
- no tabs, everything stacked: PO, Pool (6 stacked sections), Count.
- The shell's auto tab is labelled **"Comments"** but renders `RecordPanel`, whose only visible content is a closed collapsible called **"Activity"** (and "N documents filed"). Promotion / Campaign / Voucher therefore hand-make a tab called "Activity" with the same component (and the Promotion code says "Not passed to the Sheet, which would add a Comments tab"). Supplier appends `RecordPanel` by hand and does not pass `subject`.
- Seen: Activity fold at y=990 on the PO phone sheet (viewport 896), y=1303 on the Article phone sheet, y=1445 on the Allotment desk sheet: always below the content, always collapsed, loading text is "Reading the record…".
- Article shows the fold under all three SubTabs; Operations sheets (picklist, carton, surat jalan, dispatch, receiving) get no Activity at all (no `subject`, no entry in `SHEET_SUBJECT`).
**Inconsistent with:** owner ruling 3 (tabs wrap on phone; Activity tab appended for records with a `subject`).
**Suggested standard:** one tab mechanism (`Sheet tabs`). A record with more than one question gets tabs; the last tab is always "Activity" (rename the shell label from "Comments"), open, not collapsed. Sheets without tabs show Activity as a footer link ("Activity (3)") that opens it, not a hidden fold. Add `subject` to the Operations records.

### [H] F10. Edit happens in five different ways, with different entry points and different endings
**Sheets:** rows 1, 8, 12, 21, 22, 40, 48, 50, 52, 56.
**Evidence:**
| Record | Where editing happens | Entry | After save |
|---|---|---|---|
| Supplier | in place, tab content and foot swap | foot "Edit" | "Supplier Saved" receipt dialog, stays on the record |
| Article | in place, body becomes ArticleForm | header "Edit" (toggles to "Stop editing") + Cancel inside the form | silently returns to the read view |
| PO | separate composer sheet | foot "Edit" | closes **both** sheets back to the list |
| Supplier item | separate form sheet over the reader | header "Edit" | closes both |
| Term sheets | the sheet is the form | row click | silent close |
| Promotion / Campaign | separate form sheet ("Change" republishes the next version; "Duplicate") | header | receipt dialog "Published — sent to N stores" |
| Voucher | inline Spend form in the Details tab | header "Spend" toggle | form closes |
| Pricelist cell | opens Change price sheet | header primary "Change price…" | publish |
| Count | inputs in the table + buttons in the body | none | stays |
| Outstanding | per-row inline form ("Stop waiting for the rest") | row | stays |
- "Stop editing" in the head **and** Cancel in the form (Article) = two ways out of the same state.
**Inconsistent with:** owner ruling 4 (where does editing happen; Save/Cancel pair).
**Suggested standard:** short records (<= 8 fields, no lines): edit in place; head and badge stay, foot becomes `Cancel | Save`, Escape cancels. Documents with lines or fleet effects: separate `wide` sheet launched from the foot's "Edit". After a successful save: stay on the read view of the same record and say it with a toast; reserve the receipt dialog for writes that **mint an identity** (PO number, supplier code), as `SavedDialog`'s own doc says.

### [H] F11. Touch sizes inside one phone sheet range from 28px to 48px; the footer is forced to 36px
**Sheets:** all.
**Evidence (seen on the phone, 414x896):** header x 44x44; SubTabs 40px high (Supplier, Article); Edit header button 57x40; **footer buttons 36px** (PO: Print 36x36, Cancel 83x36, Edit 61x36, Review Count 130x36; Supplier: Print 36x36, Edit 55x36); tab strip from `Sheet tabs` is 48px; inputs 44px (Divisions, Receiving `h-11`).
From code: `Sheet` footer `[&_button]:h-9` (36px at every size, comment: "a thumb-tall 44px bar of them read as oversized (the owner, 2026-10-05)"), re-forced in the PO foot (`[&_button]:h-9 [&_button]:px-4`), Supplier foot, and Review count foot; count-line `Input` `h-7` (28px) in the Count sheet; `h-8` quantity Input in the Sourcing foot (`w-20`), `h-8` reason Input in Outstanding; "Packing list" etc. at default size.
**Conflict to decide:** the audit standard says footer buttons >= 44px; the code records an owner ruling of 5 Oct for 36px. Both cannot stand. Either way, today the same sheet mixes 28 / 36 / 40 / 44 / 48.
**Suggested standard:** one tap size for everything in a sheet on a coarse pointer (44px, via the existing `pointer-coarse:size-tap`); if the owner keeps 36 for the foot, then make tabs, header buttons and inputs equal to it, and let nothing be below it (no h-7 / h-8 inputs).

### [H] F12. Raw logins, raw ids and un-dated moments in record facts (owner: full names, dates with the year)
**Sheets:** rows 5, 12, 21, 30, 33, 28, 40, 47, 52, 55, 43.
**Evidence:**
- Seen: Allotment caption "Created 02 Oct 2026 by **rina**"; Count "Opened by **yusuf**" with "Site dc" and "Pool dc.warehouse"; Picklist "Picker **nina**" and "Shop store-01"; Carton "Sealed 4 Oct 09.55 · **nina**" and "Shop store-01"; Surat jalan **title "store-01"**, Fact "Shop store-01"; Picklist accept caption "store-02 · ALT-00000007"; Article "Created By" = `199a3987-32fb-4056-8984-1ced7566db29` (a session UUID as a link); Article sizes "03 04 05 06" and colours "0 · CHARCOAL" (raw codes; the list says "M–XXL").
- From code: "Picker" = `actor_id`; Count "Opened by" = `created_by`; Voucher "Issued by" = `issued_by`, "Store" = raw `issued_site`; Amendment "Raised by" = `requested_by`, "Raised at" = `origin_id`; Item "By" = `updated_by`; Carton "Sealed … · {sealed_by}"; Price change "Published … · {published_by}"; Count "Site" / "Pool" raw ids; Store delivery title "From {source_site_id}" and Fact "Store" = raw site id; Outstanding "Destination" = `destination_site_id`; Picklist id = first 8 chars of a UUID.
- Whereas PO caption, Outstanding "Created By" use `nameOfLogin()` (full name). So the same person is "Rina Kusuma" on one sheet and "rina" on the next.
- Dates without the year inside sheets: `dayMonth()` in PO "Received: 13 Sep · 230 pcs" lines, "On the road" Last Moved, "On order" Promised; `clock()` (time only if today, else "4 Oct 14:20", no year) in Picklist "Raised", Surat jalan "Dispatched", Carton "Sealed". (`day()` and `moment()` do carry the year.) **Seen: three time formats for the same kind of fact on adjacent screens**: "4 Oct 09.56" (Surat jalan "Dispatched", dotted time, no year), "02 Oct, 09:13" (Receiving list), "02 Oct 2026, 14:28" (Count "Opened").
**Inconsistent with:** owner ruling 8 (employee FULL names, dates with the year) and the memory rule "employee full name not login".
**Suggested standard:** one `person(login)` helper for every "by" fact; ids are shown only as the business number; sizes/colours are shown with their labels (with the code as the secondary, mono); every date in a sheet is `day()` or `moment()`.

### [M] F13. Facts grid: five spacing variants, 14px values that truncate silently
**Sheets:** rows 1, 8, 48, 50, 52, 20, 29, 30.
**Evidence:** default `gap-x-4 gap-y-3.5`; PO `gap-x-10 gap-y-4 [&_dd]:mt-1`; Supplier `gap-x-10 gap-y-5 [&_dd]:mt-1` (seen: columns 171px + 171px, gap 40px/20px on the phone); Promotion / Campaign `gap-y-5`; Voucher `gap-x-6 gap-y-5`; Setups `@xl:grid-cols-2` and `gap-x-10 gap-y-6 min-[100rem]:gap-y-9`. `Fact` values are `truncate` (one line, ellipsis), so a long email, address or code ("orders@indorama.com" in a 171px column) is cut with no way to read it; "Received: 200 of 600 pcs · Rp 6.720.000 of Rp 8.400.000" is a sentence inside a Fact. Numbers are left-aligned in Facts; the sheet doc says "mono micro-cap term" while the code renders 14px sans.
**Inconsistent with:** owner ruling 3 (the same two-column `Facts` grid; numbers right-aligned/tabular).
**Suggested standard:** `Facts` has one gap (e.g. `gap-x-8 gap-y-4`), no per-sheet class; values wrap instead of truncating (`break-words`), one column on phone when any value is longer than the column; composite values become two Facts.

### [M] F14. The same record has several different sheets
**Sheets:** Order x5 (PO sheet, Outstanding, Receiving, Review count, Held order + the Stock panel's order list); Return x3 (ReturnSheet from Return PO, the Operations board, Stock panel `ReturnBody`); Supplier item x2 (Catalogue vs Sourcing); Article x2 (master vs Pricelist, same `?article=` key); Pool x4.
**Evidence:** the PO has number-as-title + stamp + footer actions (PO sheet) but supplier-as-title + header link "Full record" + body Pill (Outstanding) and id=PO + title=supplier + a count grid (Receiving). The supplier item has header **Edit** in Catalogue and a footer **Add to basket** with an `h-8` Input in Sourcing, both drawing `ItemDetail`. Stock panel shows a return with `sub="{number} · Settle by X"` while ReturnSheet uses id + Tag badge.
**Suggested standard:** one head for a given record type everywhere (the same id/title/caption/badge helper per record type), and role-specific content only below the head and in the foot.

### [M] F15. Sheets over sheets, with no way back, and many sheets that are not in the URL
**Sheets:** rows 7, 10, 11, 14, 15, 22-26, 37, 42, 43, 45, 46, 59; nesting: Supplier -> Orders -> View all -> Order -> Edit; Supplier -> Catalogue -> item -> Edit item; Composer -> New item -> Add from Catalogue.
**Evidence (from code):** every Sheet draws its own veil at `z-40`; opening one inside another has no back button or breadcrumb (only the stock `Panel` has a "Back"); the composer needs a special guard ("Escape and the veil reach every sheet that is open, not only the one on top"). `lib/sheets.ts` says every sheet is held in the URL, yet term sheets, units, held order, missing, exception, place/road/order, stock panel, supplier nested sheets, pick items and the price editors are component state: a reload or a pasted link loses them, and the browser Back button leaves the screen instead of closing the sheet.
**Suggested standard:** at most one level of nesting (a sheet may launch a form sheet; a record may not launch a record over itself: navigate to it and show a "< Back to {supplier}" in the head); every record sheet gets a `SHEET_PARAMS` key.

### [M] F16. Only 3 of about 15 forms ask before throwing away typed input
**Sheets:** guarded: Composer, Item form, New Articles setup. Not guarded: New supplier, Supplier edit, ArticleForm, New voucher, Rule form, Campaign form, Price form, Change price, term sheets, Units, New count.
**Evidence (from code):** `onOpenChange={(next) => !next && onClose()}` closes and resets on x / Esc / veil / swipe down; the supplier composer's `close()` calls `reset()`.
**Suggested standard:** one `dirty` prop on `Sheet`: when true, x / Esc / swipe / veil ask "Discard your changes?" (Discard / Keep editing) once.

### [M] F17. Confirmation dialogs: casing, button words and the same action built four ways
**Sheets:** rows 1, 3, 7, 18, 20, 42, 47, 48, 52.
**Evidence:** titles "Close This Short?" (PO), "Close short what is still to pack?" (Allotment), "Cancel this allotment?", "Confirm lost?", "Move the tag?", "Delete This Order?", "Discard This Draft?", "Pause X?"; cancel labels "Cancel", "Keep Order", "Keep", "Keep editing"; confirm "Continue" on a danger dialog ("Cancel allotment"). "Close short" exists on PO (ghost+danger, small), Return PO (danger), Review count (soft + danger), Allotment head (quiet + danger): four button variants, three title forms, three reason labels ("Reason for Closing", "Reason", "Reason"). The Dialog doc says "Actions sit in the header-right, primary first; there is no footer row", but it renders a footer row with Cancel then Confirm (reversed column on phone).
**Suggested standard:** title = "{Verb} {thing}?" in sentence case; confirm = the same verb as the button that opened it; cancel = "Cancel" always; `tone="danger"` only for destructive, and the destructive trigger is always the same variant (ghost-danger in the foot, left).

### [M] F18. Loading, empty and error states
**Sheets:** all.
**Evidence:** loading strings in sheets: "Loading the order…", "Loading the supplier…" (seen), "Loading the article…", "Loading the item…", "Loading…" (Voucher, Price change, Pricelist cell, Till check), "Opening the count…", "Opening the pool…", "Opening the allotment…", "…" alone (Place and On order sheets), "Reading the {x}…" (picklist, carton, surat jalan, delivery, count), "Reading the record…" (RecordPanel). **Seen: the Count sheet shows two loading lines at once, "Opening the count…" and "Reading the record…"** (the Activity fold loads under the body's own loader). While loading the head shows a generic placeholder title (seen: "Supplier" with no id on the phone; also "Order", "Item", "Article", "Picklist", "Voucher", "Price change"). Errors: `Banner tone=bad` at the top of the body (scrolls away: Supplier, Item, Voucher, Composer, Amendment, Outstanding), `Problem` text under the content (Dispatch, Pack, Picklist), a sentence beside the primary in the foot (Rule form, Campaign form), inside the ConfirmButton dialog (`problem`), toast (PO edit blocked). Empty: "Nothing to count.", "Nothing here", "Nothing is waiting to be packed for this shop.", "None.", "No SKU to price here.", "Nothing to draw here."
**Suggested standard:** "Reading the {thing}…" everywhere, with the id already in the head from the URL; errors for a write live in one place (a banner **pinned above the footer** or text beside the primary) and take focus; empty = "No {things}" + the one action that fixes it.

### [M] F19. Card-in-sheet: double borders, and tables with their own frame
**Sheets:** rows 6, 18, 19, 27, 31, 37, 42.
**Evidence (from code):** `Card` (border + shadow) wrapping a table inside the sheet body: Return PO "Items" (`Card overflow-hidden` + raw table), Receiving count grid, Generate Surat Jalan "In this note", Basket (one `Card` + `CardStrip` per supplier, plus `KpiStrip`), Pack lines (`rounded-inner border`), Stock panel `Grid`, and the desk Exception detail (`Card` that on phone sits inside a Sheet: sheet border > card border). `MiniTable` (hairline rows, no frame) is what Supplier, Article, Pricelist and Price change use.
**Suggested standard:** inside a sheet there is no `Card`; the sheet is the card. Tables are `MiniTable`; groups are separated by `SubHead` and 24px of air.

### [M] F20. Tables in sheets: hand-written tables, `MiniTable` without `MiniRow`, and sideways scrolling
**Sheets:** rows 18, 19, 31, 37, 40, 38, 36, 47, 6.
**Evidence:** seen: Picklist (accept and read-back) and Carton list each article as the SKU code **twice** ("00000007003 / 00000007003"), the article name is missing. From code: raw `<table>` with 15px / 14px mixes in Return PO, Generate note, Pack, Stock `Grid`; `MiniTable` heads with hand-written `<tr className="border-t border-hairline">` rows in Count, Pool (x6), Basket, Tagging, Outstanding (the mobile stacking in `useStackLabels` reads the head: Tagging's 8th header is `""`, giving an unlabeled stacked cell); Allotment `LinesTable` is `min-w-max` inside `overflow-x-auto` with a sticky first column `w-[17rem]` (272px of a 414px phone) and a sticky 6.5rem total: it scrolls sideways on a phone by design; heads "Pcs" / "Quantity" / "Pieces" / "Picked" for the same figure; numbers are right-aligned inside tables but left in Facts.
**Inconsistent with:** owner ruling 3 (long tables stack on phone via `MiniTable` and never scroll sideways).
**Suggested standard:** `MiniTable` + `MiniRow` + `MiniCell` only; a matrix on phone collapses to one block per article (store x quantity as a list), not a scroll area.

### [M] F21. The same information said twice (or three times) in one sheet
**Sheets:** rows 21, 52, 42, 1, 8, 3.
**Evidence:** Seen: Picklist accept repeats its caption ("store-02 · ALT-00000007") as the Facts "Shop" and "Allotment" right under it; Surat jalan title "store-01" is repeated by the Fact "Shop store-01"; Carton "Status: In transit" and "Packing: Completed" are two status Facts with no badge. Article: mono code in the head **and** a `Tag` with the code in the body next to the status Pill (seen). Voucher: status in the head badge, a "Status" Fact, and "Expired" in the badge and in the "Expires" Fact; the title already carries the balance and the Balance block repeats it. Exception on phone: Sheet head ("Exception" + kind) then a Card head repeating id / kind / title, and "Counting" as a coloured word **and** a Pill. PO: "Counted at the Gudang" banner (seen) + status Pill "Active" in the head (the count state is the more important and is not in the badge). Supplier edit: head Pill "Active" and a StatusSwitch row "Active / Purchase orders can be issued…". Review count: icon + counted differences stated in the table and again in a "N pcs short / extra" line and the foot button's tooltip.
**Suggested standard:** each fact once; a status only in the badge.

### [M] F22. Filler copy, instruction sentences as captions, and one-line truncation
**Sheets:** rows 16, 34, 38, 39, 43, 5, 21, 12.
**Evidence (from code):** `caption` is single-line `truncate`, but is used for instructions: Dispatch "Tick the cartons going on this trip. One surat jalan for the trip, made the instant it departs."; Import PO "Build a PO from a file — Excel, PDF, or a photo of the order document. A new PO is only created after you check it in the summary."; On the road "In inventory — counted in the books, standing in a truck"; On order "Not in inventory — owed by suppliers". Body paragraphs: Pool "Evidence, not movements — nothing here has changed the ledger." and "An observation is evidence, not a movement — the ledger is never corrected on its own. Pick the subject above…"; Pool allotments "Remaining is what is still owed — accepted, less picked, less cancelled — and it is the number the Allotted column adds up."; Amendment's 3-sentence warn Banner; Item detail "Nobody has said what colours or sizes this is offered in." / "Nobody has said what kind of thing this is."; Setups empty states with a paragraph on how SKUs are drawn. Titles also `truncate` with no tooltip, so a long supplier or article name is cut.
**Inconsistent with:** the memory rule "no filler copy (no explanatory subtitles/notes/footnotes; short plain labels)".
**Suggested standard:** caption = provenance only ("Created by Rina Kusuma · 02 Oct 2026"); instructions become field hints or nothing; titles may wrap to two lines.

### [M] F23. Vocabulary and spelling drift inside sheets
**Sheets:** rows 18, 21, 22, 23, 25, 26, 27, 28, 29-33, 35.
**Evidence:** **Active / Inactive / Non-active / Cancelled / Retired** for the same state: Supplier "Non-active", Divisions "Inactive", Article and Units "Cancelled" (units.tsx `Status` local component), payment term "This term is cancelled", Flows `RETIRED`. **Colour spelling**: Article sheet shows Fact "Colorways" and SubHead "Colourways" in the same body (seen); the Colour sheet says "A color needs a name" and "Two colours may not share a label" in the same file. **Carton**: Pack / Dispatch / Carton say "carton", Store delivery says "Koli"; "Surat jalan" vs "Surat Jalan"; **"Gudang"** in "Counted at the Gudang" (seen on the PO) and "The Gudang hands them over". **Quantity**: "Quantity" (PO table, Allotment), "Pcs" (Return PO, Stock panels, Missing), "Pieces" (Picklist, Carton), "Picked", "Request Quantity". **Status of an order**: "Active" (PO Pill) while the list says "Review Count" for the same order.
**Suggested standard:** one glossary: Active / Inactive; colour (UK, as the master) or color (US) — pick one; carton; pieces (header "Quantity", unit "pcs").

### [M] F24. Sheet-title casing is Title Case on some creation sheets and sentence case on others
**Sheets:** all creation / edit sheets.
**Evidence:** "New PO", "New Supplier", "New Color", "New Name", "Add from the Catalogue", "Generate Surat Jalan", "Review Count" (Title Case) against "New voucher", "New count", "New price", "New promotion", "New campaign", "New unit", "New flow", "Add item", "Edit item", "New template", "New term", "Review the changes", "Change price" (sentence case). Dialog titles likewise ("Delete This Order?" vs "Delete this …?").
**Suggested standard:** sentence case for titles, buttons and dialogs (or Title Case for all); one rule in the style guide.

### [M] F25. Buttons disabled with no reason; reasons only in `title` attributes; no permission-denied state
**Sheets:** rows 1, 48, 50, 52, 40, 42, 47, 56.
**Evidence (from code):** PO "Cancel" is `disabled` with `title="A count is waiting. Review it first."` (a tooltip nobody sees on a phone); Promotion / Campaign Change / Duplicate / End are `disabled={!writable}` or `!canWrite` with no sentence; Count / Exception / Pool buttons `disabled={actor === ""}`; only the price editors say it ("Sign in to publish."). No sheet has a "you may not see/do this" state; a 403 would be a banner or nothing.
**Suggested standard:** a disabled primary always has a reason line in the foot; actions the role can never use are not drawn; a read-only role sees the facts and no foot.

### [M] F26. Phone and desk are different UIs inside one sheet
**Sheets:** rows 14, 29, 3, 37, 42.
**Evidence:** seen: Picklist accept on desk is a table with `One less / One more` steppers (38x36) and 40px inputs; on the phone the same sheet is four tappable rows (382x92 each, "1 of 1") with the Submit foot at 382x36. From code: Item form: `touch` ? picture + one "Add Photo ⌄" button : square button + "Edit Photo" + "Remove" quiet buttons (different labels and controls by pointer); Picklist accept: `phone` ? `PickLineRow` list : `MiniTable` (and different headings "Request Quantity / Picked"); Exception: no sheet on desk (inline Card) but a Sheet on phone; Review count: Dialog on desk, `PhoneDrawer` on phone; the shell itself swaps Dialog (desk) for Drawer (phone). 
**Inconsistent with:** the memory rule "same on every device: only data layout adapts".
**Suggested standard:** one control set; branch only on layout of the same data (table vs stacked rows).

### [M] F27. Hand-copied shells and duplicated sheet code
**Sheets:** rows 3, 32, 37, 42.
**Evidence:** `CountReview` is a copy of the Sheet frame (own head with `px-4 py-4 md:px-7 md:py-3`, own x, own foot with `[&_button]:h-9`), so it will drift from `sheet.tsx`; `Panel` is a second modal container (`p-5`, ghost icon x, 52rem / 72rem) used for Ops > Stock; Exception `CasePanel` is a third head; the `Packed` sheet is written twice in packing.tsx (lines ~325 and ~467, identical). 
**Suggested standard:** `Sheet` accepts everything these need (a `back` slot, a `foot`, a `size`); delete the copies.

### [M] F28. Footer sentences: five different treatments of "what is stopping the button"
**Sheets:** rows 31, 34, 49, 51, 59.
**Evidence (from code):** `text-[0.875rem]` vs `text-[0.9375rem]`; `truncate` (Change price, Price form, Pricelist editor) vs wrap with "a refusal cut off is not read" (Rule form, Campaign form); colour `text-text`, `text-mute`, `text-warn-fg`, `text-bad`; the problem appears **only after the first press** (Rule form) or immediately (Price form: "Choose the SKUs."); no icon, no focus move.
**Suggested standard:** one `FootNote` component: 14px, wraps, mute by default, bad when the user pressed Save with a problem, `aria-live`.

### [L] F29. Shell and component docs contradict what the code does
**Sheets:** shell.
**Evidence:** `Sheet.actions`: "At most two, plus an overflow — pinned in the header, not at the foot" (the opposite of the 5 Oct owner ruling that PO/Supplier follow); `Sheet.footer`: "The composer, when the record takes one"; `Facts` doc says "mono micro-cap term" but renders 14px sans; `Dialog` doc "no footer row of buttons"; `CodeFact` doc "said as a fact" (renders a disabled Input); `RecordPanel` doc "three components" / "every sheet should show the history" yet only a collapsed "Activity" fold appears.
**Suggested standard:** update the docs when the anatomy below is adopted, so the next sheet is copied from the doc rather than from a neighbour.

### [L] F30. Pill / Tag tone and capitalisation misuse in heads and bodies
**Sheets:** rows 40, 38, 18, 44.
**Evidence:** Seen: Pool shows two identical tags "WAREHOUSE" "WAREHOUSE" (group and pool code, both all caps) and its Counted table shows "TARGETED" in a Tag; Count shows "TARGETED" plus the Pill "Counted by the DC". From code: Count: `Pill tone="info"` for "Counted by the DC" (a fact about who counts, not "in motion") and "Count active" in the Place sheet; Pool: `Tag tone="warn"` "SUM OF ITS SHOPS" (all caps, mono, inside a Tag that the doc says is a neutral name tag); Return PO: a `Tag` (mono) as the head badge with a title-cased reason; Flow: `Pill tone="neutral"` "v3" as the badge; Count Tag shows the raw `data.kind` ("FULL", "TARGETED"); Pool movements `Tag` shows the raw `movement.cause`.
**Suggested standard:** `Pill` = status only; `Tag` = a neutral name from the data in sentence case (humanised), never raw enums or all caps.

### [L] F31. Bars and icons that exist only in the commercial sheets
**Sheets:** rows 48, 50, 52.
**Evidence:** Voucher `Balance` shows a `Meter` bar; Promotion `Gauge` bars ("Budget used", "Transactions"); `Block` section headings with 20px line icons (Percent, ListChecks, ChartNoAxesColumn, Ticket, Wallet, StickyNote, HandCoins) appear nowhere else. The memory rule says numbers, not bars, in tables/KPI rows.
**Suggested standard:** drop the bars (figure + "of Rp X"), drop heading icons, use `SubHead`.

### [L] F32. Receipt dialogs after saves are inconsistent
**Sheets:** all that save.
**Evidence (from code):** `SavedDialog` (centered, 3-second countdown) after Supplier create/edit, Picklist accepted, Count review, Promotion publish, Missing resolve, Exception writes, Cancelled PO; **no** receipt after term-sheet saves, ArticleForm, voucher issue (it jumps to the voucher), Units, Flow save. The dialog's own doc restricts it to "writes that mint an identity".
**Suggested standard:** receipt only for minted ids; everything else a toast "Saved" and the sheet back in read mode.

### [L] F33. Phone shell: a bottom drawer with a 12px strip, not literally "the whole screen"
**Sheets:** all.
**Evidence:** seen: the phone PO sheet is 884px high starting at y=12 of 896, so 12px of the page (plus the safe-area top) shows above it; from code it has a grip bar and swipe-down to dismiss, and the footer sits above the keyboard (`--drawer-keyboard-inset`) and the home-bar inset. This is consistent across every `Sheet`; only the hand-built Review count and `Panel` differ (they use `PhoneDrawer`).
**Suggested standard:** write the rule down (bottom drawer, 12px strip, swipe to close) so nobody re-implements it; no change needed unless the owner wants it to be edge to edge.

---

## 3. Sheets that are already good (copy these)

- **Supplier sheet (read mode)** — id mono + name + one Pill, `Details / Orders / Catalogue`, foot "Print icon ... Edit", edit swaps the foot to `Cancel | Submit` in the same panel. Best head + foot + edit-in-place model in the area (fix: heading style, SubTabs vs `tabs`, "Submit" label).
- **Held (offline) order sheet** — the cleanest foot: destructive Delete Order on the left (ConfirmButton), Edit and Send Now on the right, one banner, `Facts`, a plain list.
- **Price change sheet (changes.tsx)** — read-only record: title, one badge, `Facts`, `SubHead` with `aside`, `MiniTable`. No cards, no actions.
- **Pricelist cell sheet** — id mono + name, `Facts`, `SubHead` sections, `MiniTable`; its only fault is the primary in the header.
- **PO document body** (Facts + ItemsTable + TotalsLadder + "Return PO"), shared with the review step so the document looks the same before and after raising. Head should become id + supplier.
- **Receiving count sheet** — `table` width for a grid, a single primary, running total in the grid's own foot.
- **Pack sheet foot** — summary text left, one primary right (the pattern to standardise for composers).
- **Shell**: phone drawer with the keyboard inset and safe-area padding, wrapping tabs, `replace` on close, `subject` wiring, `Facts/Fact` and `MiniTable` stacking.

---

## 4. Proposed ONE record-sheet anatomy

```
HEAD (fixed, never scrolls)
  id        mono 15px, the business number a person says aloud; omitted if none     [never UUID, never a kind label]
  title     16/600, the record's own name; if it has none, repeat the number        [never a verb or the screen's name]
  badge     ONE Pill, right of the title, tone from the status taxonomy             [no stamp, no status Fact, no second copy]
  caption   one line: "Created by {full name} · {dd Mon yyyy}"                       [no instructions]
  x         44px on coarse pointers; overflow ⋯ (Print, Download, Duplicate) only if needed; NO other header actions

TABS (only if the record answers more than one question)
  Sheet `tabs` only, wraps on phone; last tab is always "Activity" (open, not folded)

BODY (scrolls)
  1. Banner (only for the state of the record: "Waiting for the DC", "Counted at the Warehouse"), max one sentence
  2. Facts: two columns, one gap, label over value, values wrap, money/dates in house format, composite values split
  3. SubHead sections, each = SubHead (16/600, aside = count) + MiniTable / list; no Card inside the sheet; tables stack on phone
  4. Activity link "Activity (n)" at the end if there are no tabs

FOOT (fixed above the keyboard and safe area; same on every device)
  left   : destructive (ghost-danger, via ConfirmButton)  OR  a one-line FootNote (14px, wraps, aria-live)
  right  : [Cancel (ghost)] [Primary]     read mode: [Print icon] ... [Edit]
  height : one value for every control inside a sheet (decide 36 vs 44 and apply to tabs, header buttons, inputs and the foot)
  label  : Save / Create {thing} / Publish / Submit count; pending = same verb -ing; never two buttons with one label

EDIT
  <= 8 fields, no lines : in place (head stays, foot becomes Cancel | Save, Esc cancels)
  documents / fleet-wide: separate `wide` sheet launched from the foot's Edit
  after save            : stay on the record in read mode + toast; receipt dialog only for a minted id
  dirty                 : x / Esc / swipe / veil ask "Discard your changes?" once

WIDTH (set by `size`, never by className)
  rail      records with <= 10 facts and short tables (about 480px)
  wide      documents with lines (PO, supplier, return, composer)
  table     grids read across (receiving, pool, SKUs matrix, allotment lines)
  workspace list + form only (New articles, Import)

STATES
  loading : "Reading the {thing}…" in the body, head already shows the id from the URL
  empty   : "No {things}" + the one action that fixes it
  error   : a failed write is a banner above the foot (or the FootNote) and takes focus; a failed read has Retry
  denied  : actions the role cannot use are not drawn; a disabled primary always has a reason in the FootNote
  URL     : every record sheet has a SHEET_PARAMS key; one level of nesting only; a nested record shows "< Back to {parent}"
```

Open decisions for the owner (I could not settle these from the code):
1. Footer/touch height: 36px (owner, 5 Oct, in code) or 44px (audit standard). Pick one and apply it to the whole sheet.
2. Whether a finished PO keeps a Pill **and** the stamp, or one of them.
3. Whether the allotment gets a status badge back (28-29 Sep ruling removed it).
4. Colour vs Color spelling for the UI.
