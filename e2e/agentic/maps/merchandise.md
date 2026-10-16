# Merchandise & master data — branch map (9 Oct 2026, read-only survey)

Scope: Merchandise / Master articles + vocabulary + colours + units + name suggestions, New Articles, Ops › Printing,
Suppliers (Procurement, Master, GA), Sourcing + Basket, Pricelist (Final price / Pricelist switch). PO, receiving and
return are in `po-receiving-return.md`.

## File index (all paths under `/Users/hari/Documents/itulah/frontend-hub/src`)

| Short | Path |
|---|---|
| merch-nav | screens/merchandise/nav.ts · index.ts |
| master-nav | screens/master/nav.ts · index.ts |
| vocab | screens/master/vocabulary.tsx (Divisions / Tags / Sizes) |
| term-form | screens/master/term-form.tsx · term-form-kit.ts |
| colours | screens/master/colours.tsx · colour-field.tsx · colour-hex.ts · colour-picker.tsx |
| units | screens/inventory/units.tsx · screens/master/units-section.tsx · lib/queries/units.ts |
| names | screens/master/name-suggestions.tsx · lib/queries/name-suggestions.ts |
| articles | screens/master/articles.tsx · detail.tsx · form.tsx |
| setups | screens/procurement/setups.tsx (New Articles work area) · setup-split.tsx · screens/master/new-articles.tsx |
| suppliers | screens/procurement/suppliers.tsx · supplier-format.ts · item-form.tsx |
| vendors | screens/vendors/vendors.tsx |
| sourcing | screens/procurement/sourcing.tsx · basket.tsx · composer.tsx |
| tagging | screens/operations/tagging/tagging.tsx · print-queue.tsx · print-run.ts |
| pricelist | screens/commercial/pricelist.tsx · components/shell/dock-tools.tsx |
| BE | backend/src/cloud/postgres/units.rs · cloud/http/mod.rs (article-setups at :965-979, :4846) · cloud/postgres/tagging.rs (NewSetupSession :63) |

Rig facts the tests rely on: cloud answers every route below with a bearer token; `rina` is ADMIN, `nina` DC OPERATIONS,
`admin` bootstrap (used for the Sourcing basket so rina's is never touched). Master PATCH/DELETE carry `If-Match: "<version>"`.

---

## 1. Menus and routes

| Screen | Route | Component | Menu |
|---|---|---|---|
| Articles | `/master` · `/merchandise` | `Articles` articles.tsx:358 | Master › Articles · Merchandise › Articles |
| New Articles | `/master/new-articles` · `/merchandise/new-articles` | `NewArticles` → `SetupWorkspace` setups.tsx:182 | badge = waiting lines (`useNewArticlesCount`, master/nav.ts:21) |
| Divisions / Tags / Sizes | `/master/divisions|tags|sizes` · `/merchandise/…` | `VocabularyScreen` vocabulary.tsx:440 | menu rows, in that order |
| Colors | `/master/colours` · `/merchandise/colours` | `Colours` colours.tsx:332 | menu row "Colors" |
| Name Suggestions | `/master/name-suggestions` · `/merchandise/name-suggestions` | `NameSuggestions` name-suggestions.tsx:106 | menu row |
| Units & Conversions | `/master/units` · `/merchandise/units` · `/inventory/units` (moved) | `Units` units.tsx:51 | **hidden:true** — routed, not in the menu |
| Suppliers | `/procurement/suppliers` · `/master/suppliers` | `Suppliers` suppliers.tsx:434 (via `SuppliersGate`) | Procurement + Master menus |
| Sourcing | `/procurement/sourcing` | `Sourcing` sourcing.tsx:78 | Procurement menu |
| Printing | `/operations/tagging` | `Tagging` tagging.tsx:100 | Ops › More fold; label "Printing", badge = labels waiting |
| GA Suppliers | `/vendors` (moved from `/finance/vendors`) | `Vendors` vendors.tsx:131 | GA menu |
| Pricelist | `/commercial/prices` | `Pricelist` pricelist.tsx:249 | Marketing |
| Organisation Units, Destinations, Payment templates | Master only | — | not Merchandise |

Sheets are URL search params (`useSheet`): `?article=<code>` (+`article-edit`), `?receipt=<receipt_line_id>`, `?setup=<session_id>`,
`?supplier=<id|new>`, `?item=<supplier_item_id>`, `?cart=true`, `?job=po:<PO>`, `?q=` (search), `?articleOrder=oldest`.
Deep links work; tests open sheets by them.

Dialog notes: sheets are `role=dialog` (title = heading). Form inputs with a required star are named `Label (required)` etc. —
`getByRole('textbox', { name: /^Label/ })`. The custom `Select` is a Base-UI combobox: tap it, then tap `getByRole('option', …)`.
`Switch` = `role=switch`; `Toggle` (units) = `role=checkbox`.

---

## 2. Divisions · Tags · Sizes (vocabulary.tsx)

API: `GET/POST /api/v1/vocabulary/{divisions|tags|sizes}`, `PATCH/DELETE …/{code}` (If-Match), `GET …/{code}/usage`
(lib/queries/vocabulary.ts:98-190).

Screen: title (Divisions/Tags/Sizes); KPI strip Total / Active / Inactive / In Use; tabs `Active n | Inactive n | All n` (default Active);
search box "Search <Title>"; switch "In Use"; Columns menu; button `New <Division|Tag|Size>`. Columns: <Noun> · Code · In Use ("n Articles" / "n SKUs") · Action (pencil `Edit <label>`).
Empty list copy per list (vocabulary.tsx:123-170). No Order column/field on any (owner 2026-10-05).

New term sheet: only **Label** is asked — code is made at save: tags/divisions = label in UPPER_SNAKE made unique (`codeFromLabel`, term-form-kit.ts:30); sizes = next free
two digits (`nextSizeCode` :769). New division/size gets `display_order = max+1` (:797). Button `Add <Noun>`.
Validation (`problemsWith` :720): empty → "A term needs a name somebody can read on a picking list."; same label (case-insensitive) → "Another term already reads that way.";
"Every two-digit size code is already taken." (toast).
Edit sheet: Label, read-only `Code` (aria-label Code, disabled), Active switch (turning off opens `Make <label> Inactive?` → "Nothing uses this tag today." / "In use by:" list → `Make Inactive`; text "It will not be used for new articles…"), `Save`, and **Delete only when `in_use == 0`**.
Delete dialog `Delete <label>?` → "Nothing uses this tag. It is removed for good and cannot be brought back." (`Delete`/`Keep`); when the server says no: "Close" + `blocked` reason (term-form.tsx DeleteDialog).
Server refusal for a used term: `can_delete:false`, "…Retire it instead: everything already pointing at it keeps reading it…".

Seed: divisions WANITA PRIA ANAK_LAKI ANAK_PEREMPUAN PERLENGKAPAN_BAYI SANDAL_SEPATU TAS AKSESORIS; sizes 00 No Size, 01 XS … 08 One Size; tags 21 (KAOS …).

## 3. Colors (colours.tsx)

API `/api/v1/colours` (GET/POST), `/{code}` PATCH/DELETE (If-Match), `/{code}/usage` (lib/queries/colours.ts:75-138).
Screen: title Colors; KPIs Total/Active/Inactive/In Use ("Colors that at least one SKU is made in."); same tabs/search/switch/Columns; `New Color`;
columns Color (swatch + label) · Code · In Use ("n SKUs") · Action.
Sheet `New Color`: Label (required), **Hex** (a textbox **without an accessible name**, beside the "Choose this color by eye" swatch button that opens a picker popover: "Shade and strength" square, "Hue" slider, second hex box), live swatch preview `Unnamed`/label+code.
Label blur fills an empty hex from a colour word (`readColour`). Code = UPPER_SNAKE of label at save. Order = max+1.
Validation (colours.tsx:611-660): empty label "A color needs a name — it is what everybody reads."; label clash → "`BLACK` already reads as “Black”. Two colours may not share a label — …"; code (edit only) pattern; hex "Six hex digits after a hash — #1B2A4A."; twin caution (not a refusal): "Reads the same as this at a glance. Two colors a person cannot tell apart split every report…" (`mistakenFor`, colour-hex.ts:123).
Edit: Code read-only, Active switch → same `Make … Inactive?` dialog ("Nothing uses this color today."), `Save`; Delete only when `in_use==0` ("Nothing uses this color. It is removed for good…").

## 4. Units & Conversions (inventory/units.tsx) — global, ERPNext-shaped

API: `GET /api/v1/units` → `{units, conversions}`; `POST /api/v1/units`; `PATCH /api/v1/units/{code}` (If-Match); `POST /api/v1/unit-conversions`; `PATCH /api/v1/unit-conversions/{id}` (units.ts:43-104).
Screen: title "Units & Conversions"; blurb; card **Units n** with `New unit`; table Code · Label · Aliases · Worth ("12 pcs", "—" until a conversion reaches PCS) · Category (Count/Weight/Volume/Length/Area) · Whole Number · Main Unit ("Main unit") · Status (Active/Cancelled). Card **Conversions n** with `New conversion` (disabled below 2 units); table Other Unit · Main Unit · Conversion Value · Note · Status. Phone: tabs Units/Conversions + cards.
Unit sheet (`New unit` / label): Code* (A–Z 0–9 _, ≤16; locked after create) "A code is needed — PCS, LUSIN." / "Letters, digits or _, at most 16." / "`X` already exists."; Label* "A unit needs a label."; Category (select; **locked** once a non-base conversion joins: "Fixed while a conversion joins this unit — those rows were written for this kind."); checkbox "Whole numbers only" (needed for a stock unit); **Aliases** (ADMIN only; comma separated, stored lower case; server: "'x' already means Y"); read-only "Worth n pcs"; checkbox "Main unit" (moving the base; disabled when already base); checkbox "Active" (edit only; disabled for the base: "The main unit cannot be cancelled."); `Submit`.
Conversion sheet: `Other unit` and `Main unit` selects (aria-labels; Main unit offers only the same category), `Conversion value` (decimal, ≤4 places, >0: "A conversion value is needed." / "A positive number, at most four decimal places." / "Must be greater than zero."), preview "1 LUSIN = 12 PCS", Note, Active (edit), `Submit`. Pair clash: "A conversion between X and Y already exists." (either direction).
**Chaining** (BE units.rs `unit_pieces_per`): a unit's pieces = product of conversions down to PCS; shown as Worth. Server-only rules: different categories never convert ("…are different kinds of unit…"), base cannot be retired ("the base unit cannot be retired: make another unit the base first"), a non-whole unit cannot be an article's stock unit, value < 100,000,000.
Seed: PCS (base), LUSIN 12, KODI 20, GROSS 144, KG→GRAM 1000, LITER→ML 1000, METER→CM 100, RIM→LEMBAR 500, YARD→CM 91.44.

Per-article units (master/units-section.tsx, in the article edit form): **Stock unit*** (only active whole-number units, or the one already chosen), **Default purchase unit**, **Default sales unit** (options: "Same as stock unit" + the stock unit + the article's own "Other UoM" rows), **Other UoM** rows: `Unit` select + `Stock units in one <UNIT>` factor + `Remove <UNIT>`, button `Add a unit`; empty copy "This article is only ever counted in PCS." Never per supplier.

## 5. Name Suggestions (name-suggestions.tsx)

API `GET /api/v1/name-suggestions[?all=true|?q=]`, `POST`, `PATCH /{id}`, `DELETE /{id}`. Screen: title, search "Search Name Suggestions", `New Name` (toolbar + empty state), table Name · Action; empty copy "No names yet. Add the ones New Articles should suggest."
Sheet: Name (required), `Add Name` (disabled while invalid) / `Save` (saving also re-activates a retired name) / `Delete` → `Delete <name>?` "It stops being suggested in New Articles. No article is touched." (`Delete`/`Keep`). Errors: "A name is required." · "That name is already on the list." (case-insensitive; shown after blur/attempt).

## 6. Articles (articles.tsx, detail.tsx, form.tsx)

API: `GET /api/v1/articles?limit&q&sort=oldest&division&tag&colour&size` → `{items,next_cursor,total,facets}`; `GET/PATCH /api/v1/articles/{code}` (If-Match = version); `GET …/{code}/consequences`.
List: title Articles; KPIs Articles / Divisions / Colors / Sizes (from facets); search "Search Articles" (name, SKU, supplier code, QR); four facet comboboxes `Division` `Tag` `Color` `Size` (option text "Label · n"); `Newest first`/`Oldest first` menu (URL `articleOrder=oldest`); Columns; table Article (name + 8-digit code) · Division · Colors · Sizes ("M–L") · SKUs · Price Range · Status (Active/Cancelled); foot "n of N shown" / "1 article matches" / "n articles match" / "shown, more to load". Empty: "No article matches that. Widen the filters, or search the whole master." / "No article has been created yet. Articles are created in New Articles."
Article sheet (`?article=`): title = name, id = code, button **Edit**/**Stop editing**; tabs `Overview`, `SKUs (n)` (colour × size grid, price differences), `Suppliers (n)` (Supplier / Unit Price). Overview facts: Division, Base price, SKUs, Colorways "n of 10", Sizes, Currency, Stock unit, Default purchase unit ("PCS (stock unit)" when none), Default sales unit, Created, Version; UoM list ("1 BAL = 6 PCS" / "Only ever counted in PCS."); **Created By** link (session id → `/master/new-articles?setup=…`); Tags; Colourways (each with photo slot).
Edit form (form.tsx:68): code shown (not editable), Name*, Division (select, "Unclassified"), Picture (URL), Tags (toggle chips `aria-pressed`; retired tags shown "Cancelled", removable), Colourways picker (assign colour to digit; digits with SKUs are locked), Units section (4), **Sold** segmented `Active`/`Cancelled`; promotion consequences panel when division/tags change (two-press "Submit anyway"); `Submit` / `Cancel`. Stale guard: 409/412 → banner "Somebody else changed this article after you opened it, so nothing was saved…" + `Discard my changes and read theirs`.
Article codes are 8-digit sequential (00000018 …); SKU = 11 digits (article + colour digit + size).

## 7. New Articles (setups.tsx, new-articles.tsx)

Rule (owner 2 Oct): it **only mints NEW articles**; a delivery line becomes one article or sibling articles; there is no match/add-to-existing control (the BE `article_code` field exists on `NewSetupSession` but no UI sends it).
Page: title "New Articles"; KPIs New Articles / Pcs / Suppliers; search combobox "Search New Articles" (placeholder "Search New Articles or Supplier"; matches name, PO, supplier article code; picking a supplier suggestion sets `setupFor`); ledger grouped by supplier (`role=group` aria-label = supplier display name, header "n items · n pcs"): columns Article · PO · Quantity · Received At; footer "n items … pcs"; warn group **"Needs Retry"/"Processing / Needs Retry"** for sessions whose mint did not finish (open → SessionRecord with retry). Empty: "Nothing waiting." / "Nothing here matches that." / "Reading the queue…".
API: `GET /api/v1/article-setups/unidentified` (+`/count`), `POST /api/v1/article-setups[?background=true]`, `POST …/split`, `POST …/{id}/issue`, `GET …/{id}` (lib/queries/procurement.ts:1642-1781; BE mod.rs:965-979). A line can be set up **once**; quantities may not exceed the counted pieces ("A session cannot create stock that did not arrive.").
Sheet (`?receipt=<line>`): thumbnail; facts Supplier, Counted; Quantity-check panel; **Name*** (suggestions from Name Suggestions), **Division*** (combobox), **Tags**, **Base Price*** (Rp), **Markup** (% over the PO's purchase price; aside "Purchase price Rp 40.000"; the two answer each other); *Variants*: **The Colors That Arrived** (≤10), **The Sizes That Arrived**, the colour × size grid of pieces (+ per-SKU own price), "n SKUs"; Split Article tab strip exists but is hidden (`SPLIT_ARTICLE_SHOWN`, setup-split.tsx:88); `Submit` and `Submit and Next` (only when another line waits) are disabled until: name, division, colours, sizes, grid total == counted, base price > purchase price ("Must be above the purchase price, Rp 40.000"; every SKU price too). Submit → "Setup saved · 00000019" (SavedDialog, auto-closes ~3 s), line leaves the ledger, session QUEUED→PROCESSING→DONE in the background (poll 2 s).
Unsaved edits are kept as a local draft per line (`writeSetupDraft`).

## 8. Suppliers (suppliers.tsx)

API: `GET /api/v1/suppliers?category=MERCHANDISE&q&limit` → `{rows,next_cursor,total,facets,orders,book}`; `POST`; `PATCH /{id}` (If-Match/version); `POST /{id}/(activate|deactivate)`-style status (setSupplierStatus); `GET/POST /{id}/contacts`; `GET /{id}/items`, `POST /{id}/items` (catalogue).
List: title Suppliers; KPIs Active / Non-active / Active PO / Active PO qty / Active PO value; tabs `Active n | Non-active n | All n`; search "Search supplier name"; switch "Only suppliers with an active order"; Columns; `Export CSV`; `New supplier`; rows show **name + legal form** ("Garmen Nusantara, PT") + 4-digit code, Status, Active/Completed/Cancelled Order counts, Last Purchased; expander "Show active orders for …"; footer "n suppliers". Empty: "Nobody has been set up as a supplier yet." / "No supplier matches what you asked for."
`New supplier` sheet (`SupplierComposer` :1557): Company — **Name*** (title-cased as typed), **Legal Form*** (PT/CV/UD), **Address***, Email, **Phone Number*** (+`Add number`, comma list), NPWP (16 digits, formatted), PKP switch ("Their bills carry no PPN."); **Contact Person** `Add` (Contact n name/role/phone/email/address; `Remove contact n`); Notes; `Cancel` / `Create supplier`. Pressing Create with gaps names each: "Fill in the supplier's name." · "Choose the legal form." · "Fill in the address." · "Fill in a phone number."; shape checks: "That is too short for a phone number." (<8 digits) / "…too long…" (>15); "An email address carries one @, with a name and a domain around it." / "The domain looks unfinished — orders@sinartekstil.co.id."; "An NPWP has 16 digits — an old 15-digit one gets a 0 in front."; contacts "Give this contact a name." / "A contact needs a phone number or an email.". Success popup "`0007` saved" (auto-code, 4 digits).
Supplier sheet (`?supplier=<id>`): id = code, title = display name, badge Active/Non-active, caption "Created by … · date"; tabs **Details** (Company facts + Contact person + Notes) · **Orders** (groups Active Order (ACTIVE, PARTIALLY_RECEIVED) / Completed Order / Cancelled Order with Date Issued / Delivery Date|Date Fulfilled|Date Cancelled / Quantity / Value; "None.") · **Catalogue** (first 5 items, `View all n`, `Add item`, item sheet with `Edit`; empty "This supplier offers nothing yet, so no order can name them."); footer **Print** + **Edit**; in edit mode the footer is `Cancel` / `Save changes` (disabled with "A name, legal form, address and phone number are needed." / "A contact needs a name and a phone number or an email."), toast "Changes saved", and the **Active switch** (off → `Make This Supplier Non-Active?` "A non-active supplier cannot be used to create a purchase order." `Continue`/`Cancel`; on → immediate). Add item = `ItemFormSheet` (item-form.tsx): Name*, Division*, Tags*, Price*, … "Give it a name." · "Choose a division." · "Choose at least one tag." · "Fill in the price." · `Submit`; discard guard "Discard This Item?".

GA › Suppliers (`/vendors`): breadcrumb GA; segmented `Operating | Affiliate` (merchandise suppliers are never listed); search box (unnamed); `Add supplier`; table Code · Supplier · Expense account ("not set") · Contact · Status; sheet Add supplier: **Code***, Type ("Kind" select), **Name***, Default expense account, Contact, Phone, Address; footer `Deactivate`/`Reactivate` + `Submit` (disabled until code and name); tabs Details / Bank accounts / Contacts on an existing one; read-only users see "Read only. Ask Procurement to add or change a supplier." Empty: "No operating suppliers yet. Add a service provider or a party that sends bills."

## 9. Sourcing and Basket (sourcing.tsx, basket.tsx)

API: `GET /api/v1/supplier-items` (catalogue, filters Division/Tag/Color/Size/Supplier/Price), `GET /api/v1/sourcing-basket`, `POST /api/v1/sourcing-basket {supplier_item_id, quantity}`, `POST …/{id}/remove`, quantity set, `POST …/clear` (procurement.ts:1600-1633). The basket is **per person**.
Sourcing: title "Sourcing" (or the supplier head when `?supplier=` is set); omnibox combobox **Filter** (text + facet chips Division/Tag/Color/Size/Supplier/Price, Fields, Saved views); count "n of N shown" / "1 item matches"; `Best match` sort menu (Newest, Price low, Price high); `Add item`; `Basket · n`. Cards of items. Empty: "Nothing here matches. Widen the filters, or search everything." / "No supplier has offered anything yet."
Item sheet (`?item=`): title = item name, id = supplier's code; footer **Pieces** (spinbutton, min 1) + `Add to basket` ("Adding…"); disabled for ≤0.
Basket sheet (`?cart=true`): title Basket; header actions `Empty` (danger) and `Raise an order`; KPIs Suppliers / Lines / Pcs / At Catalogue Prices; one card per supplier (name, "n pieces · Rp"), table Item · Unit · Quantity · Value, per row `Pieces of <name>` (commits on blur) and `Take <name> out`; empty "Nothing has been picked out yet." with `Go to sourcing`. `Raise an order` closes the basket and opens the **New PO** composer on that supplier with the basket lines (composer.tsx:786 `basket` prop); the rest of the flow (Delivery Date, Payment method, `Review order`, `Submit` → "PO-DDMMYY-NNN created") is the PO domain.

## 10. Ops › Printing (tagging.tsx, print-queue.tsx, print-run.ts)

API (DC node): `GET /api/v1/dc/tagging-jobs`, `POST /api/v1/dc/print-sessions`, `…/{id}/run`, `POST /api/v1/dc/tagging-confirmations`, `GET …/print-sessions` per job, label preview, `POST …/test-printer`.
Page: title Printing; tabs `To print · n` / `Printed`; table grouped **per PO** (`po:PO-…`, or the article code when no PO): No. · PO · Supplier · Delivery · SKU · Pcs · Printed · `Print n` (row). Empty: "Nothing to print." / "Nothing printed yet."
PO sheet (`?job=po:<PO>`): title = PO; header `Print all n`; label **preview** (svg, Size "58 × 40 mm", EPC); table No. · SKU · Article · Color · Size · Pcs · Printed · `Print n`/`Reprint`; collapsible **Printer** card (summary `host:port · ZPL|TSPL · w × h mm`) with Printer host, Language, Port, Per pass, Darkness, Speed, presets, Tag width/height, Left inset, `Test connection` (pill "answered" + address/ms, or "no answer"). Printer settings live in the browser (localStorage), not on the server.
`Print n` opens a print session at the printer, runs chunks until none pending and then **confirms tagging** — the pieces get EPCs and move into dc.warehouse (`drain`, print-run.ts).

## 11. Pricelist: Pricelist | Final price (commercial/pricelist.tsx)

Desk shows only the final price (`final: true`). On a **phone** (414 px) the dock's status chip `Status: Final price` opens a sheet "Status" with `Pricelist` and `Final price` (aria-pressed); `final = !phone || reading==='final'`. API `GET /api/v1/commercial/article-prices?final=true` adds `final_price` per shop. Phone cards: thumbnail, name, "code · n SKU", division, lead figure + caption "base price" (or "n prices"), foot "Cost Rp X · Markup n%" (markup over cost = `markupBps(base, cost)`), tallies "n store prices" / "not sold at n". Desktop pricing grid, Change price and history are the Marketing map.
