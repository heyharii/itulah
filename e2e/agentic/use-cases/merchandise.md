# Merchandise & master data — use-case catalogue

Domain: Merchandise / Master (articles, New Articles, divisions, tags, sizes, colors, units & conversions, name suggestions),
Ops › Printing, Suppliers (Procurement, Master, GA), Sourcing + Basket, Pricelist (Pricelist | Final price on a phone).
Map: `maps/merchandise.md`. Tests: `hub/merchandise/*.e2e.ts`; helpers: `support/merchandise.ts`.
Last run on the rig: 126 tests — 123 pass, 3 red on purpose (real app defects, tagged `bug`).

Conventions: own records carry a run-unique `tag()`; seeded data (supplier 0001, colours BLACK/WHITE, sizes 03/04, division PRIA,
tag KAOS) is read, never changed. The "shared article" (2 colours x 2 sizes, Rp 99.000 over a Rp 40.000 cost) and the
New Articles lines are built once per run through PO → count → New Articles (`shared()` in support/merchandise.ts, cache in
`.e2e/shared/`); tests that consume data (Submit a line, print labels, basket) build their own.
Status: `pass` = green on the last run; `FAIL — bug` = the test asserts the right behaviour and the app does not do it.

## Bugs found

| ID | What is wrong | Evidence |
|---|---|---|
| MER-39 | The **Hex** box on New Color / Edit color has no accessible name (the label's text is not bound; the swatch button inside the label breaks it). Screen readers and `getByLabel('Hex')` find nothing. | screen.txt: `text="Hex"`, `button "Choose this color by eye"`, `textbox` (unnamed) |
| MER-131 | Suppliers accept a second supplier with the same name and legal form (POST /api/v1/suppliers → 201, new code). Two "Garmen Nusantara, PT" would split every report and make the PO supplier picker ambiguous. | Test run: second POST returned 201 |
| MER-154 | Ops › Printing › **Printed** tab can never show a freshly printed PO: once every label is printed the tagging is confirmed and the DC drops the job from `GET /dc/tagging-jobs`, the only list the screen reads. "Nothing printed yet." is permanent for confirmed jobs, and Reprint is unreachable. | After MER-153 the PO is absent from the list; its row never appears under Printed |

## Rig observations (not tagged bug)

* `rig.makeItem` looked the new supplier item up in the first 200 items of supplier 0001 and returned `undefined` once the rig grew (coordinator fixed it 10 Oct); this domain builds its stock with `ownStock()`, which uses the create response.
* The label sink (port 9109) is shared by every suite; one label of a print run can fail when another suite prints at the same moment (seen once: 7 printed / 1 failed, status PARTIAL). MER-153 presses Print again like a user would.
* Split Article (several sibling articles from one line) is hidden in the sheet (`SPLIT_ARTICLE_SHOWN`), so it is covered through the API (MER-102/103) and MER-97 asserts it is not offered.
* Not covered: Units & Conversions phone Conversions tab and the unit "Main unit" move (changing the base unit) — risky on a shared rig; New Articles "Needs Retry" group (needs a failed mint); Import PO / Catalogue / Outstanding screens (hidden menu rows, PO domain).

| ID | Actor | Preconditions | Steps | Expected | Test | Status |
|---|---|---|---|---|---|---|
| MER-01 | rina | none | Open /merchandise; read the sidebar. | Articles, New Articles (with count), Divisions, Tags, Sizes, Colors, Name Suggestions are linked; Units & Conversions and Suppliers are not in the Merchandise menu. | `menus.e2e.ts` › `MER-01` | pass |
| MER-02 | rina | none | Open /master; read the sidebar. | The same rows plus Suppliers; Units & Conversions, Destinations and Payment Templates are hidden (still routed). | `menus.e2e.ts` › `MER-02` | pass |
| MER-03 | rina | lines waiting in New Articles | Read the New Articles link in the Master menu. | It carries the API count of unidentified lines. | `menus.e2e.ts` › `MER-03` | pass |
| MER-04 | rina | none | Open Procurement › Suppliers, then GA › Suppliers. | Suppliers and Sourcing are in Procurement; GA has its own Suppliers row. | `menus.e2e.ts` › `MER-04` | pass |
| MER-05 | nina | DC operations user | Open /operations/tagging. | Printing opens (To print / Printed tabs); the row itself sits in Ops' More fold. | `menus.e2e.ts` › `MER-05` | pass |
| MER-10 | rina | seed: tag KAOS used by articles | Open Master › Tags. | KPIs Total/Active/Inactive, KAOS row shows its code and "n Articles", tab counts equal the API list. | `vocabulary.e2e.ts` › `MER-10` | pass |
| MER-11 | rina | none | New Tag, type a label, Add Tag. | Term exists with code = label in UPPER_SNAKE, active, in use 0; row shows "0 Articles". | `vocabulary.e2e.ts` › `MER-11` | pass |
| MER-12 | rina | none | New Tag, press Add Tag with an empty label. | "A term needs a name somebody can read on a picking list." — sheet stays open, nothing created. | `vocabulary.e2e.ts` › `MER-12` | pass |
| MER-13 | rina | seed tag Kaos | New Tag with label "kaos". | "Another term already reads that way." — no duplicate created. | `vocabulary.e2e.ts` › `MER-13` | pass |
| MER-14 | rina | own tag via API | Open the tag, change the label, Save. | Label changes, code stays (read-only Code box), version rises. | `vocabulary.e2e.ts` › `MER-14` | pass |
| MER-15 | rina | own unused tag | Open the tag, switch Active off. | Dialog "Make X Inactive?" says "Nothing uses this tag today."; after Make Inactive + Save the tag is inactive and moves from the Active to the Inactive tab. | `vocabulary.e2e.ts` › `MER-15` | pass |
| MER-16 | rina | own unused tag | Open the tag, Delete, confirm. | Dialog says nothing uses it and it cannot be brought back; the tag is gone from the API. | `vocabulary.e2e.ts` › `MER-16` | pass |
| MER-17 | rina | seed tag KAOS | Open KAOS. | Code box reads KAOS and is disabled; no Delete button. | `vocabulary.e2e.ts` › `MER-17` | pass |
| MER-18 | rina | own unused tag | Turn on the In Use switch. | Used tags (Kaos) stay, the unused one leaves. | `vocabulary.e2e.ts` › `MER-18` | pass |
| MER-19 | rina | none | Search a code, then nonsense. | The matching row only; "Nothing matches that search." for nonsense. | `vocabulary.e2e.ts` › `MER-19` | pass |
| MER-20 | rina | none | Divisions › New Division, add. | No Order box on the form; display_order = highest + 1. | `vocabulary.e2e.ts` › `MER-20` | pass |
| MER-21 | rina | seed division PRIA in use | Read Pria, open it. | Row shows its article count; no Delete. | `vocabulary.e2e.ts` › `MER-21` | pass |
| MER-22 | rina | none | Sizes › New Size, label only, Add Size. | Code is the next free two-digit number; row shows it and "0 SKUs". | `vocabulary.e2e.ts` › `MER-22` | pass |
| MER-23 | rina | seed tag KAOS | DELETE /vocabulary/tags/KAOS with its version. | Refused with the reason ("Retire it instead…"); KAOS still exists. | `vocabulary.e2e.ts` › `MER-23` | pass |
| MER-24 | rina | none | Open /merchandise/divisions, /tags, /sizes. | Each opens with its status tabs under the Merchandise department. | `vocabulary.e2e.ts` › `MER-24` | pass |
| MER-25 | rina | shared article, own tag | Give the article the new tag by API, read the Tags list and open the tag. | Row reads "1 Article"; no Delete; usage API says can_delete false and names articles. | `vocabulary.e2e.ts` › `MER-25` | pass |
| MER-26 | rina | shared article; one active, one retired tag | Open the article, Edit. | The active tag is a chip to pick; the retired one is not offered. | `vocabulary.e2e.ts` › `MER-26` | pass |
| MER-27 | rina | phone 414x896 | Open Tags on a phone. | Cards with an Edit word button, the round New Tag button, a Status chip; Edit opens the sheet. | `vocabulary.e2e.ts` › `MER-27` | pass |
| MER-28 | rina | Haiku agent | Ask the agent to add a tag with a given name. | The tag exists and is listed (agent step; the check is deterministic). | `vocabulary.e2e.ts` › `MER-28` | pass |
| MER-30 | rina | seed BLACK/WHITE | Open Master › Colors. | Black and White rows show code and "n SKUs"; tab counts equal the API. | `colours.e2e.ts` › `MER-30` | pass |
| MER-31 | rina | none | New Color: label, hex #1B2A4A, Add Color. | Colour stored with that hex and code = label UPPER_SNAKE; row "0 SKUs". | `colours.e2e.ts` › `MER-31` | pass |
| MER-32 | rina | none | New Color with hex "#12". | "Six hex digits after a hash — #1B2A4A." and the sheet stays open. | `colours.e2e.ts` › `MER-32` | pass |
| MER-33 | rina | seed Black | New Color labelled "black". | Message names BLACK / “Black” as the clash. | `colours.e2e.ts` › `MER-33` | pass |
| MER-34 | rina | seed Black #111111 | New Color with hex #111111. | "Reads the same as this at a glance." caution shown; Add Color stays enabled. | `colours.e2e.ts` › `MER-34` | pass |
| MER-35 | rina | own colour | Edit: new hex and label, Save. | Hex and label updated, code unchanged. | `colours.e2e.ts` › `MER-35` | pass |
| MER-36 | rina | own unused colour | Open Black (no Delete), then delete the own one. | Used colour has no Delete; unused one is deleted after the "removed for good" dialog. | `colours.e2e.ts` › `MER-36` | pass |
| MER-37 | rina | own colour | Switch Active off. | "Make X Inactive?" says nothing uses it; colour becomes inactive after Save. | `colours.e2e.ts` › `MER-37` | pass |
| MER-38 | rina | none | Open /merchandise/colours. | The same list under Merchandise. | `colours.e2e.ts` › `MER-38` | pass |
| MER-39 | rina | none | New Color: find the Hex box by its label. | The box is a named textbox "Hex". BUG: it has no accessible name. | `colours.e2e.ts` › `MER-39` | FAIL — bug |
| MER-40 | rina | seed units | Open Units & Conversions. | PCS is the Main unit; LUSIN 12 pcs, KODI 20, GROSS 144; conversion text "1 lusin = 12 pcs"; LUSIN is not a whole-number unit. | `units.e2e.ts` › `MER-40` | pass |
| MER-41 | rina | none | New unit; type pcs, then "bad code!". | Missing-code and missing-label messages; "PCS already exists."; "Letters, digits or _, at most 16."; Submit disabled. | `units.e2e.ts` › `MER-41` | pass |
| MER-42 | rina | ADMIN (aliases field) | New unit: code, label, category Weight, uncheck whole numbers, aliases. | Stored with category MASS, whole_number false, aliases lower-cased and de-duplicated. | `units.e2e.ts` › `MER-42` | pass |
| MER-43 | rina | own unit | New conversion: own unit → PCS, value 24. | Preview "1 X = 24 PCS"; after Submit the unit is worth 24 pcs in table and API. | `units.e2e.ts` › `MER-43` | pass |
| MER-44 | rina | none | Conversion value 0, letters, 1.23456. | "Must be greater than zero."; letters are not typed ("needed" stays); four-decimal rule; Submit disabled. | `units.e2e.ts` › `MER-44` | pass |
| MER-45 | rina | seed LUSIN→PCS | New conversion LUSIN → PCS. | "A conversion between LUSIN and PCS already exists." | `units.e2e.ts` › `MER-45` | pass |
| MER-46 | rina | two own units (API) | B→PCS 12, A→B 2. | A is worth 24 pcs (conversions chain through the main unit). | `units.e2e.ts` › `MER-46` | pass |
| MER-47 | rina | two own units (API) | B→PCS 6, A→B 3; open the table. | A's Worth column reads 18 pcs. | `units.e2e.ts` › `MER-47` | pass |
| MER-48 | rina | own unit with a conversion | Open the unit. | Category select is disabled with the "Fixed while a conversion joins this unit" hint; "Worth 5 pcs". | `units.e2e.ts` › `MER-48` | pass |
| MER-49 | rina | own unit | Open PCS; then retire the own unit. | Main unit: Active checkbox disabled with the explanation; own unit becomes Cancelled. | `units.e2e.ts` › `MER-49` | pass |
| MER-50 | rina | none | POST a unit whose alias is "pcs" (API). | 409 "'pcs' already means PCS"; unit not created. | `units.e2e.ts` › `MER-50` | pass |
| MER-51 | rina | own weight unit | Convert it to PCS (API). | Refused: different kinds of unit. | `units.e2e.ts` › `MER-51` | pass |
| MER-52 | rina | none | PATCH PCS active=false (API). | Refused; PCS stays active. | `units.e2e.ts` › `MER-52` | pass |
| MER-53 | rina | none | Open /merchandise/units. | Same screen, LUSIN 12 pcs. | `units.e2e.ts` › `MER-53` | pass |
| MER-54 | rina | phone | Open Units on a phone. | Units and Conversions tabs of cards; New Conversion round button. | `units.e2e.ts` › `MER-54` | pass |
| MER-60 | rina | none | New Name; Add Name is disabled when empty; type a name, Add. | Suggestion created active and listed. | `names.e2e.ts` › `MER-60` | pass |
| MER-61 | rina | own name (API) | New Name with the same text in lower case. | "That name is already on the list." and Add Name disabled. | `names.e2e.ts` › `MER-61` | pass |
| MER-62 | rina | own name | Edit, change, Save. | Name updated. | `names.e2e.ts` › `MER-62` | pass |
| MER-63 | rina | own name | Delete, confirm. | Dialog "It stops being suggested in New Articles. No article is touched."; name gone. | `names.e2e.ts` › `MER-63` | pass |
| MER-64 | rina | two own names | Search for one. | Only that row is listed. | `names.e2e.ts` › `MER-64` | pass |
| MER-70 | rina | shared article (PO → count → New Articles → issued) | Open Articles, search by name. | KPIs Divisions/Colors/Sizes; row shows code, Pria, M–L, Rp 99.000, Active; foot "1 article matches". | `articles.e2e.ts` › `MER-70` | pass |
| MER-71 | rina | shared article | Search by its code, then nonsense. | The article is found by code; nonsense shows "No article matches that. Widen the filters, or search the whole master." | `articles.e2e.ts` › `MER-71` | pass |
| MER-72 | rina | shared article | Division facet = Tas. | The article (Pria) leaves; empty-state copy shows. | `articles.e2e.ts` › `MER-72` | pass |
| MER-73 | rina | none | Newest first → Oldest first. | Button reads Oldest first; URL carries articleOrder=oldest. | `articles.e2e.ts` › `MER-73` | pass |
| MER-74 | rina | shared article | Open ?article=<code>. | Name, code, Division Pria, Colorways "2 of 10", IDR, "PCS (stock unit)", "Only ever counted in PCS.", SKUs (4), Created By link to the session. | `articles.e2e.ts` › `MER-74` | pass |
| MER-75 | rina | shared article | SKUs tab. | Black/White by M/L grid; 4 SKUs in the API. | `articles.e2e.ts` › `MER-75` | pass |
| MER-76 | rina | shared article | Suppliers tab. | Tab count equals the API supplier_items; content matches. | `articles.e2e.ts` › `MER-76` | pass |
| MER-77 | rina | shared article | Edit, rename, Submit. | API name changes; list finds the new name. | `articles.e2e.ts` › `MER-77` | pass |
| MER-78 | rina | shared article (tags reset to KAOS) | Edit, press the Basic chip, Submit. | Chip is pressed; tags now include BASIC. | `articles.e2e.ts` › `MER-78` | pass |
| MER-79 | rina | shared article (units reset) | Edit: Add a unit, factor 6, default purchase unit = that unit, Submit. | API: one unit with factor 6, purchase_unit_code set, sales unit still empty; sheet reads "1 X = 6 PCS". | `articles.e2e.ts` › `MER-79` | pass |
| MER-80 | rina | shared article; a fractional unit exists (Kodi) | Edit; open Stock unit. | Piece is offered, the non-whole-number unit is not. | `articles.e2e.ts` › `MER-80` | pass |
| MER-81 | rina | shared article | Edit; Sold = Cancelled; Submit; then back to Active. | API active false then true; sheet shows Cancelled. | `articles.e2e.ts` › `MER-81` | pass |
| MER-82 | rina | shared article | Edit; type a new name; Stop editing. | Record unchanged. | `articles.e2e.ts` › `MER-82` | pass |
| MER-83 | rina | shared article | Open Edit, change the article by API, then Submit. | Stale banner "Somebody else changed this article after you opened it…", "Discard my changes and read theirs"; nothing saved. | `articles.e2e.ts` › `MER-83` | pass |
| MER-84 | rina | shared article | Open /merchandise?article=<code>. | Same sheet under Merchandise. | `articles.e2e.ts` › `MER-84` | pass |
| MER-85 | rina | seed Sneakers Kanvas Low | Open it. | Name, division, SKUs tab. | `articles.e2e.ts` › `MER-85` | pass |
| MER-90 | rina | a delivered, accepted line (own PO) | Open New Articles, search the name. | Line sits under "Garmen Nusantara, PT" with its PO and "8 pcs"; KPIs New Articles/Pcs/Suppliers. | `new-articles.e2e.ts` › `MER-90` | pass |
| MER-91 | rina | same line | Search the PO number, then nonsense. | Line found by PO; "Nothing here matches that." | `new-articles.e2e.ts` › `MER-91` | pass |
| MER-92 | rina | same line | Open ?receipt=<line>. | Name, Division Pria, tag Kaos, Base Price 99.000, Markup 147.5, "Purchase price Rp 40.000", supplier, "8 pcs", "8 of 8 · 4 SKUs", Submit enabled. | `new-articles.e2e.ts` › `MER-92` | pass |
| MER-93 | rina | same line | Base Price 40000, then 120000. | "Must be above the purchase price, Rp 40.000" and Submit disabled; then enabled. | `new-articles.e2e.ts` › `MER-93` | pass |
| MER-94 | rina | same line | Markup 150. | Base Price becomes 100.000. | `new-articles.e2e.ts` › `MER-94` | pass |
| MER-95 | rina | same line | Empty the Name. | Submit disabled. | `new-articles.e2e.ts` › `MER-95` | pass |
| MER-96 | rina | same line | Set Black M pieces to 0, then 2. | Grid reads "6 of 8", Submit disabled; restored → enabled. | `new-articles.e2e.ts` › `MER-96` | pass |
| MER-97 | rina | same line | Look for Split Article. | Not offered (hidden by the owner on 6 Oct). | `new-articles.e2e.ts` › `MER-97` | pass |
| MER-98 | rina | same line | Look for any way to match an existing article. | None exists on the sheet. | `new-articles.e2e.ts` › `MER-98` | pass |
| MER-99 | rina | own fresh line | Open the sheet and press Submit. | "Setup saved · 000000NN"; new article code above all earlier ones with 4 SKUs, division PRIA, tag KAOS, base price 99000, colours BLACK/WHITE, sizes 03/04; the line leaves the queue. | `new-articles.e2e.ts` › `MER-99` | pass |
| MER-100 | rina | a line already set up | POST a second setup for it. | Refused (4xx). | `new-articles.e2e.ts` › `MER-100` | pass |
| MER-101 | rina | a waiting line | POST a setup with 80 pieces for 8 counted. | Refused; the line still waits. | `new-articles.e2e.ts` › `MER-101` | pass |
| MER-102 | rina | a line split by API | Read the two articles. | Two codes, one name, 2 SKUs each (BLACK and WHITE), same division. | `new-articles.e2e.ts` › `MER-102` | pass |
| MER-103 | rina | same | Search the name in Articles. | Two rows, "2 articles match". | `new-articles.e2e.ts` › `MER-103` | pass |
| MER-104 | rina | same | Open an article, follow Created By. | New Articles opens ?setup=… showing that article code. | `new-articles.e2e.ts` › `MER-104` | pass |
| MER-105 | rina | a waiting line | Request Quantity Check. | Button turns to Requested (disabled); a REQUESTED check exists for the line; Ops › Quantity Checks lists the PO. | `new-articles.e2e.ts` › `MER-105` | pass |
| MER-106 | rina / nina | a line with a requested check | nina counts it (API); reopen the sheet. | Lines "Black · M", "White · L", "Counted by nina" and a Recount button. | `new-articles.e2e.ts` › `MER-106` | pass |
| MER-107 | rina | a waiting line, own name suggestion | Type the start of the suggestion in Name. | The suggestion is offered; picking it fills the box. | `new-articles.e2e.ts` › `MER-107` | pass |
| MER-110 | rina | seed supplier 0001 | Open Procurement › Suppliers. | Garmen Nusantara, PT with 0001, Active; KPIs Active, Non-active, Active PO, Active PO qty, Active PO value. | `suppliers.e2e.ts` › `MER-110` | pass |
| MER-111 | rina | none | Read the tabs. | Active n equals the API count; Non-active and All tabs exist. | `suppliers.e2e.ts` › `MER-111` | pass |
| MER-112 | rina | none | Search "Nusantara", then nonsense. | Only matching row; "No supplier matches what you asked for." | `suppliers.e2e.ts` › `MER-112` | pass |
| MER-113 | rina | own supplier with no orders | Switch "Only suppliers with an active order". | The quiet supplier leaves the list. | `suppliers.e2e.ts` › `MER-113` | pass |
| MER-114 | rina | none | Look for Export CSV. | Button is there. | `suppliers.e2e.ts` › `MER-114` | pass |
| MER-115 | rina | none | Open /master/suppliers. | Same book. | `suppliers.e2e.ts` › `MER-115` | pass |
| MER-116 | rina | none | Read the Master menu. | All article screens and Suppliers linked. | `suppliers.e2e.ts` › `MER-116` | pass |
| MER-120 | rina | none | New supplier; Create supplier with nothing filled. | Four messages (name, legal form, address, phone); nothing created. | `suppliers.e2e.ts` › `MER-120` | pass |
| MER-121 | rina | none | Phone 123, email "bukan-email", NPWP 12345. | Too-short phone, email shape and 16-digit NPWP messages. | `suppliers.e2e.ts` › `MER-121` | pass |
| MER-122 | rina | none | Contact role only, then name only. | "Give this contact a name." then "A contact needs a phone number or an email." | `suppliers.e2e.ts` › `MER-122` | pass |
| MER-123 | rina | none | Fill name, CV, address, phone, email, contact; Create supplier. | Popup "NNNN saved"; supplier MERCHANDISE, ACTIVE, legal form CV, 4-digit code, email and contact stored. | `suppliers.e2e.ts` › `MER-123` | pass |
| MER-124 | rina | seed 0001 | Open Garmen Nusantara. | Tabs Details/Orders/Catalogue, address, phone, email, "Contact person", Print and Edit. | `suppliers.e2e.ts` › `MER-124` | pass |
| MER-125 | rina | own supplier | Edit address, Save changes. | Toast "Changes saved"; API address updated. | `suppliers.e2e.ts` › `MER-125` | pass |
| MER-126 | rina | own supplier | Edit; empty the address. | Save changes disabled with "A name, legal form, address and phone number are needed." | `suppliers.e2e.ts` › `MER-126` | pass |
| MER-127 | rina | own supplier | Edit; Active switch off; Continue; switch on. | Dialog "Make This Supplier Non-Active?"; INACTIVE then ACTIVE again in the API. | `suppliers.e2e.ts` › `MER-127` | pass |
| MER-128 | rina | own supplier | Orders and Catalogue tabs. | "None." under the order groups; "This supplier offers nothing yet, so no order can name them." | `suppliers.e2e.ts` › `MER-128` | pass |
| MER-129 | rina | seed 0001 | Orders tab. | Active / Completed / Cancelled Order groups. | `suppliers.e2e.ts` › `MER-129` | pass |
| MER-130 | rina | own supplier | Catalogue › Add item › Submit empty. | Four messages: name, division, tags, price. | `suppliers.e2e.ts` › `MER-130` | pass |
| MER-131 | rina | none | Create two suppliers with the same name and legal form (API). | The second is refused. BUG: the server accepts it. | `suppliers.e2e.ts` › `MER-131` | FAIL — bug |
| MER-140 | rina | none | Open /vendors. | Operating and Affiliate books; no garment supplier listed. | `suppliers.e2e.ts` › `MER-140` | pass |
| MER-141 | rina | none | Add supplier: code + name. | Submit disabled until both; supplier created EXPENSE, ACTIVE. | `suppliers.e2e.ts` › `MER-141` | pass |
| MER-142 | rina | own operating supplier | Open it; Deactivate. | Sheet closes; API INACTIVE. | `suppliers.e2e.ts` › `MER-142` | pass |
| MER-150 | nina | issued article (own PO) | Open Ops › Printing. | The PO is a row with 4 SKUs, 8 pieces and "Print 8"; To print / Printed tabs. | `printing.e2e.ts` › `MER-150` | pass |
| MER-151 | nina | same | Open ?job=po:<PO>. | SKU table with article, Black/White, M/L, label preview with EPC and "Print all 8". | `printing.e2e.ts` › `MER-151` | pass |
| MER-152 | nina | same | Printer card → host 127.0.0.1, port 9109, Test connection. | Summary shows host:port; the pill says "answered". | `printing.e2e.ts` › `MER-152` | pass |
| MER-153 | nina | same | Print all 8. | Button leaves; the DC ledger holds 8 postings for the tag (labels printed and tagging confirmed). | `printing.e2e.ts` › `MER-153` | pass |
| MER-154 | nina | a printed PO | Printed tab, open the PO. | PO under Printed; Reprint per SKU. | `printing.e2e.ts` › `MER-154` | FAIL — bug |
| MER-160 | admin | own supplier + item | Sourcing, type the name in Filter, Enter. | The item is shown; count text "item matches". | `sourcing.e2e.ts` › `MER-160` | pass |
| MER-161 | admin | own item | Open ?item=<id>, Pieces 12, Add to basket. | Basket (API) holds the item × 12. | `sourcing.e2e.ts` › `MER-161` | pass |
| MER-162 | admin | own item | Pieces 0. | Add to basket disabled; basket empty. | `sourcing.e2e.ts` › `MER-162` | pass |
| MER-163 | admin | own item in the basket | Open ?cart=true. | KPIs, "At Catalogue Prices", Rp 660.000, Pieces box 12. | `sourcing.e2e.ts` › `MER-163` | pass |
| MER-164 | admin | same | Change pieces to 20, Tab. | Value Rp 1.100.000; API quantity 20. | `sourcing.e2e.ts` › `MER-164` | pass |
| MER-165 | admin | basket of 20 | Raise an order; delivery date; payment method; Review order; Submit. | PO created with 20 pcs for the basket item. | `sourcing.e2e.ts` › `MER-165` | pass |
| MER-166 | admin | two items in the basket | Bin one, then Empty. | One line left, then "Nothing has been picked out yet." with Go to sourcing; API empty. | `sourcing.e2e.ts` › `MER-166` | pass |
| MER-167 | admin | own supplier | Open ?supplier=<id>. | Supplier head with its code, its one item. | `sourcing.e2e.ts` › `MER-167` | pass |
| MER-170 | rina | phone, shared article | Open Pricelist on a phone; Status chip. | Chip reads Final price; the sheet offers Pricelist | Final price; picking Pricelist changes the chip. | `pricelist-phone.e2e.ts` › `MER-170` | pass |
| MER-171 | rina | same | Read the article card. | Rp 99.000, "Cost Rp 40.000", "Markup 147,5%". | `pricelist-phone.e2e.ts` › `MER-171` | pass |
| MER-172 | rina | shared article | GET article-prices with and without final=true. | Both answer 200 and list the article. | `pricelist-phone.e2e.ts` › `MER-172` | pass |
