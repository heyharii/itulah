# UX consistency audit: Procurement + Master (Articles) + Marketing (Commercial)

Audited 2026-10-06 on the rig dev server (localhost:5360), phone 414x896 and desk 1440x900, by reading the DOM (text, computed sizes and colours) plus code in `frontend-hub/src/screens/{procurement,master,commercial}` and `components/ui`. Read-only; no repo file was touched.

**Honest limits**
- The session was signed out partway through (the sign-in page appeared on every route). I did not sign back in. The remaining checks were done from code.
- The Browser pane kept being hidden by parallel auditors, so most checks are DOM reads. Screenshots were taken on only about 8 screens.
- Promotions, Campaigns, Vouchers, Changes and Amendments are empty on the rig. Their cards, sheets and forms are judged from code only.
- Dev-server hot reloads from other sessions changed copy during the audit. Phone `/master/units` first said "Satuan & Conversions" with a "Satuan" chip. Phone `/procurement/import` first said "Pilih atau tarik file", "Mulai ulang" and so on in Indonesian. Both are English now and a grep finds no Indonesian in source. Re-check these on a fresh build.
- Evidence tagged "seen" came from the running DOM or screen. "Code" means source only.

---

## 1. Same concept, different words

### [H] The "switched off" state has three names
**Where:** Divisions, Tags, Sizes, Colors (`/master/*`). Suppliers (`/procurement/suppliers`). Articles (`/master`). Catalogue items (`/procurement/catalogue`). Payment templates. The item rows in a supplier sheet.
**Evidence:**
- Seen: master vocab KPI and tabs say "Inactive 7". Suppliers tabs say "Non-active 2", and the phone sentence says "2 are not".
- Seen: Payment templates has a button "Show 2 cancelled".
- Code: articles use "Active"/"Cancelled" (`master/articles.tsx:212`, `detail.tsx:192`, form option `cancelled`). Catalogue maps `INACTIVE` to "Cancelled" (`catalogue.tsx:174`). Supplier-sheet item rows say "Cancelled" (`suppliers.tsx:2493`). The vocab confirm dialog says "Make Inactive" (`term-form.tsx:140`).
**Inconsistent with:** each other. A tag you switch off is Inactive, a supplier is Non-active, an article is Cancelled, and all of these are reversible.
**Suggested standard:**
- Master records that can be switched back on use **Active / Inactive**, in tabs, cards, sheet and filter.
- "Cancelled" is only for transactions that end (PO, voucher, return).
- "Non-active" goes away.

### [H] Marketing statuses use a different running word from the rest of the hub
**Where:** Promotions, Campaigns, Vouchers, Changes, History vs Orders, Suppliers, Outstanding.
**Evidence:**
- Code: Promotions say Live / Paused / Scheduled / Ended / Spent. Vouchers say Live / Spent / Cancelled / Expired / Issued. Changes say Scheduled / Active / Attention / "Include Settled". History says Published / In service / Trouble / "Sent to shop". Orders and Suppliers say Active / Completed / Cancelled.
- Seen on desk: Changes uses "Active" but Promotions uses "Live" for the same "in force now".
**Suggested standard:**
- One lifecycle vocabulary per kind of record, written down once. Suggested: Draft, Scheduled, **Live**, Paused, Ended for time-boxed offers, and use "Live" in Changes too.
- "Active" is for master data and orders.
- "Sent to shop" should say "store" (owner rule). It is seen on `/commercial/history`.

### [H] Color and Colour are mixed, even inside one sheet
**Where:** `/master/colours` (route spelling), Master sidebar "Colors", `/master` KPI "Colors", article sheet, item form.
**Evidence:**
- Seen: the article sheet says "Colorways 4 of 10" in the facts and "Colourways" as the section heading, one scroll apart.
- Seen: UI titles are US: "Colors", "Add New Color", "Search Colors", "New Color".
- Code: the item form says "Loading colours…". `master/colour-picker.tsx` says "Colourways" and "Reading the colour master…". The empty text says "No colour has been mapped…".
**Suggested standard:** US "Color/Colorway" in all visible copy. Keep UK spelling in routes and code only if you like.

### [M] One "create" act, many labels, cases and nouns, and phone differs from desk
**Where:** Orders, Suppliers, Sourcing, Catalogue, Returns, all of Master, Payment templates, all of Marketing.
**Evidence (phone Fab label, desk button, sheet title):**
- Orders: "New Order" (Fab; the screen-reader label reads "Add New Order") / "New order" / sheet "New PO".
- Suppliers: "New Supplier" / "New supplier" / sheet "New Supplier".
- Returns: "New Return" / "New return" / sheet "New Return PO".
- Sourcing: **"Add Item"** / "Add item". Catalogue: **"New Item"** / "New item". The item form says "Add item".
- Master vocab: "New Division", "New Color", "New Name" on both desk and phone. Units: "New unit" (outline button).
- Payment templates, same screen: desk "New term" / "New template", phone Fab "New Template" / "New Term", sheet "New template".
- Marketing: "New promotion", "New campaign", "New voucher" (sentence case everywhere), and "New Price" vs "New price".
**Inconsistent with:** the desk and phone labels of the same screen, and Procurement/Master (Title Case) vs Marketing (sentence case).
**Suggested standard:**
- One verb ("New") and one case.
- Phone and desk use the same string.
- The sheet title equals the button.
- The noun matches the screen name ("New order" or "New PO", pick one).
- Sourcing and Catalogue both create supplier items and need the same word.

### [M] Case rules drift: Title Case, sentence case and CAPS for the same roles
**Where:** KPI labels, column headers, card text, buttons, confirm dialogs.
**Evidence:**
- Title Case KPI labels: Outstanding "Orders Behind / Suppliers to Chase / Units Still Owed"; Amendments "Waiting on an Answer / Billed Above the Order"; Destinations "Places a Delivery Can Go / Units in Flight".
- Sentence case KPI labels: Marketing overview "Given away / Baskets touched / Campaigns running".
- CAPS labels with tracking (seen, computed `text-transform: uppercase`, 14px): `/commercial/changes` "ON THE LIST / OUTSTANDING / ATTENTION".
- Columns: "Active Order / Completed Order / Last Purchased" vs facts "Last purchased".
- Buttons: "Review Count" (seen, Orders) vs "Review order" (New PO form footer) vs "Raise the Return" (a confirm button).
- Confirm labels: Procurement "Keep Order / Cancel Order / Close Short" vs Marketing "End now / Cancel voucher / Keep".
**Suggested standard:** one rule. Suggested: Title Case for screen names only. Everything else (buttons, KPI labels, column headers, confirm buttons) is sentence case. Drop the CAPS eyebrow style.

### [M] Names of people: full name in one place, login or raw id in others
**Where:** PO sheet, Marketing History, Vouchers, article sheet.
**Evidence:**
- Seen: PO sheet "Created by Rina Kusuma · 05 Oct 2026" and "Rina Kusuma, 05 Oct 2026, 10:57".
- Seen: `/commercial/history` shows "Published 09:48 · rina" and "system-seed".
- Code: Vouchers "Issued by" prints `issued_by` raw (`vouchers.tsx:853`).
- Seen: the article sheet shows "Created By a1d992ce-7fe1-4b2b-b9e4-237cb8b1edb9", a session UUID, as the visible label.
- "Created by" (PO) vs "Created By" (article sheet, Outstanding sheet).
**Suggested standard:** always resolve to the employee's full name (`useNameOfLogin`). Show "system" for seeds. Never show a UUID. Use sentence case "Created by".

### [M] Loading, empty and error wording
**Where:** everywhere.
**Evidence:**
- Loading, Procurement/Master lists: "Reading the catalogue…", "Reading the order book…", "Reading the queue…", "Reading the vocabulary…". Records: "Loading the supplier…". Supplier sheet activity: "Reading the record…".
- Loading, Marketing: bare "Loading…" (overview 7 times, changes, history, campaigns), plus "Loading prices…", "Loading promotions…" and "Loading vouchers…".
- Loading, phone Outstanding (seen): grey skeleton rows with no text.
- Empty states (seen): "No promotions." / "No campaigns." / "No vouchers." (with a full stop), "Nothing outstanding.", "Nothing given away.", "No delivery is waiting on a price decision.", "Filed under nothing yet.", "Choose a supplier, then add what is being ordered."
- Error (seen on `/master/name-suggestions`, desk and phone): the page shows only the raw server text "Not Found" and a "Try again" button.
**Suggested standard:** one skeleton or "Loading…" pattern. Empty states are "No X yet." with the same punctuation, and none carry a second CTA. Errors are a sentence ("Could not load name suggestions"), never raw HTTP text.

### [M] "No filter" chip is called six things, and filter and sort controls differ
**Where:** the phone status chip and desk segmented controls on every list.
**Evidence:**
- First-option label: "Active" (Orders, Suppliers, Master), "All" (Promotions, Campaigns, Vouchers, Changes), "Everything" (Catalogue, History), "Everything owed" (Outstanding), "All suppliers" (New Articles), "Open" (Returns), "Templates", "Units", "Final price", "Basket".
- Tools: phone "Filter and sort" icon. Desk "Filter" button (Outstanding, Amendments, Catalogue, Destinations). A right rail "Filter by / Edit filters / Fields / Saved views / Save" (Sourcing, Pricelist, Promotions, Campaigns, Vouchers, Changes). "Columns" (tables). "Export CSV" only on Suppliers (code: `ExportCsv` is used only in `suppliers.tsx`).
- Search placeholder: "Search orders" on desk vs "Search Orders" as the phone label.
**Suggested standard:**
- One word for "everything" (suggest "All").
- One filter surface on desk.
- Export either on every table or on none.
- Search label in sentence case.

### [M] Dates, relative time and ranges
**Where:** Orders, Suppliers, New Articles, History, Overview.
**Evidence:**
- Seen: phone Suppliers "Last purchased 05 Oct 2026" but desk Suppliers "Last Purchased … 05 Oct" with no year (`dayMonth()` in `suppliers.tsx:207`). Owner rule is dates with year.
- Seen: padded "07 Oct 2026" on cards vs the sidebar clock "Tue 6 Oct 2026".
- Seen: New Articles "4d ago" / "2d ago" while the same data elsewhere is absolute.
- Seen: History groups "04 Oct 2026" plus "09:48". Overview range "06 Sep 2026 – 06 Oct 2026".
**Suggested standard:** `day()` with the year everywhere. Relative "Nd ago" only for the age of an unhandled item, and say so with a title or tooltip.

### [M] Numbers: decimal sign, percent, money and "Rp" are not one grammar
**Where:** Orders, Pricelist, PO sheet, Outstanding.
**Evidence (seen):**
- Percent: "Discount · 0,25 %" (comma, space), "Markup 147.5%" (dot), "74%", "0% arrived". A dot-decimal beside dot-thousands money reads as 1475.
- Compact money: the Orders sentence and KPI say "Rp 4,0 billion" (comma decimal plus an English word), but the same screen shows "Rp 3.999.980.000".
- Missing "Rp": Pricelist desk columns and the phone article sheet show "58.000", "Base price 58.000". Everywhere else it is "Rp 58.000".
- Price range: desk "Rp 100.000–300.000" vs phone "Rp 100.000 up to Rp 300.000".
- Unit label after a price: "/ pc" (PO sheet) vs "per unit" (Catalogue).
**Suggested standard:**
- One `percent()`: comma decimal, no space, trailing zero dropped.
- Always "Rp".
- One compact style, and never the compact style beside the exact figure for the same total.
- One range format.

### [L] Units and plurals
**Where:** Pricelist, article sheet, Master.
**Evidence:**
- Seen: Pricelist "4 SKU", "12 SKU", while Master says "4 SKUs", "1 SKU". Code: the Pricelist comment says "the rows say N SKU".
- Seen: article sheet "Stock unit PCS", "Only ever counted in PCS", "PCS (stock unit)" while everything else says "pcs".
- Seen: "Units Still Owed", "pcs owed", "Units in Flight" for the same quantity.
**Suggested standard:** pluralise with a helper, and use "pcs" in running text. Show the unit code (PCS) only as a code.

### [L] Screen and record names drift
**Where:** Procurement and Master.
**Evidence (seen):**
- "Purchase Orders" (sidebar and H1) vs "Orders" (phone tab, KPI) vs "New PO" (sheet) vs "Active PO 8" (desk tab).
- "Return PO" (nav and H1) vs "New Return" (Fab) vs "New Return PO" (sheet).
- `/master/organisation` has H1 "Units", which is a different thing from `/master/units` "Units & Conversions". The page loads as "Reading the units…".
- `/commercial` is "Overview" under "Marketing".
- Destinations lives under Master but its eyebrow says "Procurement".
**Suggested standard:** one name per thing, shared by sidebar, tab, H1 and button. Rename Organisation's H1 (for example "Organisation" or "Company units").

---

## 2. Same concept, different component or pattern

### [H] Status is drawn four ways
**Where:** Orders, Suppliers, Outstanding, Catalogue, Master, Returns, PO sheet.
**Evidence:**
- Outlined Pill, 28px high, green text on a pale green border (seen): phone Orders cards, phone Suppliers cards, Outstanding rows, PO sheet header, Catalogue.
- Dot + word, the `Status` component (seen): phone Divisions, Tags, Sizes and Colors cards ("● Active", dark text, green dot).
- Plain coloured text, no box (seen): desk PO table "Active" (`text-ok-fg`). Returns "Not Generated" amber, "Generated" blue, "Completed" green.
- Plain grey text: the "active" caption under the Supplier figure.
- Code: `pill.tsx` calls the Pill "one grammar for every state". Its own doc says `Status` is "the quiet grammar (direction E)".
- The same PO is a Pill on the phone card and plain green text in the desk row.
**Suggested standard:** one list-row grammar (suggest `Status` dot + word, as in direction E) and one record-header grammar (Pill). No bare coloured text.

### [H] Three page-header patterns on desk
**Where:** every desk screen.
**Evidence (seen):**
- No eyebrow: Orders, Suppliers, Returns, Master lists.
- Eyebrow + H1 + a pill link: Outstanding ("Procurement / Outstanding / The whole book" where the link goes to Orders), Amendments, Destinations ("What is still owed"), Catalogue, Import, Organisation, and every Marketing screen ("Marketing / Pricelist").
- The sidebar already shows the department name, so the eyebrow doubles it. On `/master/destinations` it says "Procurement" under a Master sidebar.
- The H1 sits at 15px in the top bar.
**Suggested standard:** one PageHeader. No eyebrow when the sidebar carries the department. No filler link pills.

### [M] Where the primary action sits on desk, and how it looks
**Where:** all list screens.
**Evidence (seen, desk y-position, colour):**
- In the toolbar row, blue: Orders "New order", Suppliers, Returns, Divisions and Colors, Promotions ("New promotion", beside a "Sync usage to stores" button in the header), Vouchers.
- In the page header, blue: Catalogue "New item", Campaigns "New campaign", Name Suggestions "New Name", Payment templates "New template".
- White outline: Units "New unit", Payment templates "New term", Sourcing "Add item" and "Basket".
- Campaigns empty state: two "New campaign" buttons at once (header blue plus a soft grey one in the middle).
**Suggested standard:** one place (the toolbar, or the header), blue for the one primary, outline for secondary. No duplicate CTA in empty states.

### [M] Status switcher: counted tabs vs chips vs KPI repeating the tabs
**Where:** desk lists.
**Evidence (seen):**
- `SubTabs` with counts: Orders "Active PO 8 / Completed PO 12 / Cancelled PO 1", Suppliers "Active 4 / Non-active 2 / All 6", Divisions "Active 8 / Inactive 7 / All 15", Returns "Open 2 / Completed 1".
- `Segmented` chips with no counts: Catalogue "Everything / On offer / Cancelled", Outstanding "Everything owed / Issued only", Changes, History, Promotions, Vouchers.
- The same numbers also sit in KPI tiles on Divisions (Total / Active 8 / Inactive 7 / In Use), Suppliers (Active 4, Non-active 2), Vouchers, and again as a toggle chip "In Use".
- Code uses `Segmented`, `SubTabs` and chips (`Tag`) for what is one concept.
**Suggested standard:** one switcher for a status filter, with counts. Do not repeat the same counts in a KPI strip.

### [M] Phone summary line: sentence vs tiles vs greeting vs nothing
**Where:** top of phone lists.
**Evidence (seen):**
- Greeting sentence "Hi Rina, 4 orders in review. 8 orders are active, Rp 4,0 billion in total." (Orders, Suppliers only; `purchase-orders.tsx:1999`, `supplier-band.tsx:71`).
- Plain sentence: Returns "Suppliers still owe Rp 0", Vouchers, Changes, Payment templates, History "22 entries", Pricelist "7 of 7 articles.", Catalogue "29 of 29 shown still need finishing · 29 in the catalogue".
- KPI tiles in a bordered 2x2 card: Master (Articles/Divisions/Colors/Sizes), Divisions, Tags, Sizes, Colors, New Articles, Outstanding, Amendments, Destinations, Marketing overview. The odd tile takes a full row.
- Code: `card-parts.tsx` documents `Sentence` as "in place of a strip of tiles" for phones.
- Count lines vary: "29 of 29 shown", "7 of 7 shown" (footer), "7 of 7 articles.", "22 units".
**Suggested standard:** one phone pattern, as the `Sentence` doc says. Drop the greeting or use it everywhere. The Catalogue sentence is also garbled ("0 of 0 shown still need finishing" while loading).

### [M] Record detail: different shell, different Edit location
**Where:** PO, Supplier, Article (Master), Pricelist article.
**Evidence (seen, phone):**
- PO sheet: footer is Print (icon), Cancel, Edit, Review Count (36px).
- Supplier sheet: tabs Details / Orders / Catalogue (40px). Footer is Print and Edit.
- Article sheet in Master: tabs Overview / SKUs / Suppliers. "Edit" sits in the header area (outline, 57x40), and there is no footer actions row.
- Pricelist article sheet (`?article=00000002`): read-only, no actions. A different sheet from Master's even though it opens on the same query key. The card's "Change" button opens a sheet titled "Article" that was still empty after 6 s.
- Master term form sheet: only "Save" (67x44) with the close ×. Supplier form: "Cancel" and "Submit" (36px).
**Suggested standard:**
- Edit and the primary verb sit in the sheet footer on phone and desk.
- One footer order: Print, secondary, primary.
- One submit verb ("Save").
- A record has one sheet no matter which screen opens it.

### [M] Card buttons: five looks, four verbs for "open the form"
**Where:** phone cards.
**Evidence (seen):**
- Tint blue word, 32px with a 44px hit area: "Edit" (Master), "Set up" (New Articles, 74x32), "Change" (Pricelist, 84x32).
- Solid blue 40px: "Review Count".
- White outline 40px: Sourcing "Add".
- Soft grey 44px: Campaigns "New campaign" (empty state).
- No button: Suppliers, Catalogue (the Pill or "Not linked" sits at the foot right instead).
- On Master vocab the "Edit" button and a card tap open the same sheet, so the button is redundant. Code says "the button only says so".
**Suggested standard:** one tint word-button per card, with the same word for the same act (Edit). Solid blue only for the exception action. No redundant button where a tap opens the same thing.

### [M] Confirmation dialogs and end-of-life verbs
**Where:** PO, Master, Marketing.
**Evidence:**
- The PO footer "Cancel" means cancel this order (disabled with a `title`-only tooltip, "A count is waiting. Review it first."). The supplier and New PO form footer "Cancel" means dismiss. Master's DeleteDialog uses "Cancel" and "Keep" both.
- Dialog pairs: "Keep Order / Cancel Order", "Keep / Cancel voucher", "Keep / Delete", "Close Short", "Make Inactive", "Pause", "End now", "Discard", "Continue".
- Master has both "Make Inactive" and "Delete" for a vocab term. Name Suggestions has "Delete" only.
**Suggested standard:** "Cancel" means dismiss only. For ending a record use the lifecycle verb ("Cancel order" is fine as long as the dismiss button is "Back" or "Keep"). One dialog template.

### [M] Disabled actions are explained only by a hover tooltip
**Where:** PO sheet.
**Evidence:** seen on desk: the Cancel button is `disabled` at 0.5 opacity and its only explanation is `title="A count is waiting. Review it first."`. Touch has no hover, so the phone user sees a dead button.
**Suggested standard:** a visible reason line under the footer, or hide the action.

### [M] List card shape: product tile and plain row vs the lead-figure card
**Where:** Sourcing, Catalogue, Units, Organisation.
**Evidence (seen):**
- Sourcing (phone, 346px tall): a product tile with photo, division label, name, price, supplier link, tag, "200 bought" and an "Add" button. No single lead figure top-right.
- Catalogue (150px): name, price over "per unit", supplier and division, and a "Not linked" pill. The pill is at the foot left of the figure.
- Units: name, "1 pcs worth", "Count · whole numbers · Main unit", an alias list and status. No lead figure.
- Organisation: not a card at all (see the bug below).
- Master vocab cards are 141px high for one name plus a count. Suppliers have a code, Divisions have no code (desk shows `PRIA`).
**Suggested standard:** the lead-figure card (name + code left, one figure right, hairline, status left and one tint button right) for every record list. Sourcing may keep the tile only if the owner agrees.

### [L] Doubled labels on one screen
**Where:** desk.
**Evidence (seen):** H1 "Articles" with first KPI "Articles"; H1 "New Articles" with KPI "New Articles"; Divisions tab "Active 8" with KPI "Active 8"; Vouchers "0 vouchers" printed twice (before and after the tabs); Payment templates H1 "Payment Templates", H2 "Templates", chip "Templates".
**Suggested standard:** say each thing once.

---

## 3. Phone rules the owner set

### [H] Organisation is a desktop table cut off on a phone
**Where:** `/master/organisation` (phone).
**Evidence (seen):** the table is 619px wide inside a 370px card with `overflow: hidden`. The "Staff", "Person in Charge" and "Set PIC" columns sit at x=544, past the 414px viewport, and cannot be scrolled to. The page has no dock, search or card layout. H1 says "Units".
**Inconsistent with:** every other Master list (cards, dock, nothing sideways).
**Suggested standard:** a lead-figure card per unit (name + code, staff count as the figure, "Set PIC" as the tint button), and the dock with search.

### [H] Dock controls and sheet footers are under 44px
**Where:** every phone list and sheet.
**Evidence (seen, measured):**
- Dock: status chip 36px, search 36px, "Filter and sort" icon 28x28 with no hit-area extension, Fab 36x36 (the primary create action).
- Sheet footers: Print 36x36, Cancel 83x36, Edit 59x36, Review Count 127x36, Submit 82x36 (all 36px high by `[&_button]:h-9`).
- OK: card buttons are 32px visible but have a 43px effective hit area (`after:-inset-1.5`). Review Count is 40px with a 55px hit area.
- Inconsistent: the Master term form's "Save" is 44px, and New Supplier's "Add" and "Add number" are 40–44px. A phone sheet footer is 36 or 44 depending on the screen.
**Suggested standard:** at least 44px (visible or hit area) for the dock and every footer button, one footer height.

### [M] Bottom bar text is 12px on every screen
**Where:** all phone routes in this group (Home / Orders / Suppliers / Sourcing / Return PO, and Master and Marketing equivalents).
**Evidence:** seen. Computed `font-size: 12px` on the tab labels. Everything else on these screens is 14px or more.
**Suggested standard:** 14px minimum, shorten labels or use fewer tabs.

### [M] Things the owner moved to the bottom are still at the top, or have no mobile path
**Where:** Outstanding, Amendments, Destinations, Master, Marketing overview.
**Evidence (seen):**
- KPI tiles at the top of those lists add 130–200px before the first record. The owner rule is "nothing at the top of a list except title+figures", which this meets in letter. The tiles duplicate the dock status chip (Divisions shows both "Active 8" tile and an "Active" chip).
- The Procurement bottom bar has five tabs (Home, Orders, Suppliers, Sourcing, Return PO) and no "More". Outstanding, Amendments, Catalogue, Import PO and Destinations have no phone menu entry. Master has a "More". Marketing has Home / Pricelist / Promotions / Campaigns / Vouchers, so Overview, Changes and History have no entry.
**Suggested standard:** every routed screen has a phone entry (a More tab) or is intentionally absent.

### [M] Same facts missing between phone and desk
**Where:** many.
**Evidence (seen unless noted):**
- Orders: phone says "4 orders in review" (desk does not). Desk says "Overdue 0" and has Completed 12 and Cancelled 1 tabs with counts (phone has the "Active" chip only).
- Suppliers: desk has 5 KPIs, a Non-active tab, "Export CSV" and "Columns". Phone has a sentence only.
- Divisions / Tags / Colors: desk shows a Code column (`PRIA`, `ANAK_LAKI`, `BLACK`). Phone cards drop it. Articles: desk shows colour swatches and "Rp 100.000–300.000", phone shows "Rp 100.000 up to Rp 300.000" and no swatches.
- Vouchers: desk ledger tiles Outstanding / Issued / Spent / Cancelled / Expired. Phone has one sentence with two figures.
- Marketing overview: desk has 6 tiles including "Changes need attention" and "Stores behind on prices" and a "Promotions doing the work" section. Phone has 4 tiles and no promotions section.
- New Articles: phone rows each have "Set up"; desk rows have no button (the whole row is the button).
- Promotions: "Sync usage to stores" button in the header on desk, and "Sent automatically every 5 minutes" note. On phone it moved into the ⚙ sheet (code `promotions.tsx:1315`).
- Language: Import PO and Units were different strings on phone vs desk at the start of the session (Indonesian vs English).
**Suggested standard:** only layout differs. Move the missing facts onto the card foot or the sheet.

### [L] Transient wrong text while loading
**Where:** `/master/new-articles` (phone).
**Evidence (seen once):** the first supplier group header read "0003" (the code) until the name arrived. A few seconds later it read "Garmen Nusantara, PT".
**Suggested standard:** wait for the name or show a skeleton.

---

## 4. Visual and data consistency

### [M] The same total is three different numbers
**Where:** Orders, Outstanding, Destinations.
**Evidence (seen):** Orders says 21.060 pcs on 8 active orders. Outstanding says "Units Still Owed 21.081" and "Orders Behind 11". Destinations says "Units in Flight 21.081", "21 orders routed here". Outstanding also lists a cancelled PO (PO-041026-008, "8 pcs owed", status "Cancelled") and two "Short received" orders.
**Suggested standard:** define "owed" once and make all three screens use it. Cancelled orders do not count.

### [M] Filler copy (owner rule: no explanatory notes)
**Where:** Master, Payment templates, Units, Marketing.
**Evidence (seen unless noted):**
- Payment templates desk intro paragraph: "The arrangements a supplier bill is scheduled with… Nothing here is deleted — cancel what is no longer offered…".
- Units & Conversions intro: "Stock is kept in the main unit. A conversion says how many of the main unit one other unit is worth — one LUSIN is 12 PCS…".
- "Sent automatically every 5 minutes" (Promotions).
- Code: "This division can be chosen for new work." (term form switch), "Their bills carry no PPN." (supplier form, PKP), "Colors that at least one SKU is made in." (colours KPI note), "The whole book" and "What is still owed" (header link pills).
**Suggested standard:** delete them or turn them into a one-word label.

### [L] The same division is spelled two ways
**Where:** Pricelist vs Master, Sourcing, Catalogue.
**Evidence (seen):** division "WANITA" in Master, Sourcing, Catalogue and the Master desk, but "Wanita" in the Pricelist cards and table. Other divisions ("Pria", "Anak Laki-laki") are title case in the data.
**Suggested standard:** one normaliser everywhere (and fix the data to Title Case).

### [L] Same fact, different words in two lists
**Where:** Orders vs Outstanding.
**Evidence (seen):** the same PO says "Received 0 pcs" and "Delivery 22 Oct 2026" in Orders, but "0% arrived" and "Issued 04 Oct 2026" in Outstanding. The Outstanding figure is "20.000 pcs owed" while Orders says "20.000 pcs".
**Suggested standard:** one verb ("Received") and one label per date type.

### [L] Marketing History: Indonesian book names and mixed vocab
**Where:** `/commercial/history`.
**Evidence (seen):** every entry is "Harga awal · Kemeja". That is backend book-name data, not hub copy, but it sits in an English screen. Status words in one list: "In service", "Sent to shop", "Published", "Trouble". The "rig store-01" store pill is a 32px tint button on phone.
**Suggested standard:** show the English book name; use "store", not "shop".

### [L] Phone dock: extended vs round Fab
**Where:** Name Suggestions vs the rest.
**Evidence (seen):** Name Suggestions has a wide "New Name" pill (187px) where every other list has a round "+". The Fab doc explains that "no tabs = room for the label" (`fab.tsx`).
**Suggested standard:** accept as documented, or use the round "+" everywhere.

---

## What is already consistent (do not touch)
- **Dock:** status chip, search field, "Filter and sort" icon and a round Fab sit in one rounded dock over the bottom bar on every phone list (Orders, Suppliers, Sourcing, Catalogue, Returns, Outstanding, Master lists, Pricelist, Promotions, Campaigns, Vouchers, Changes).
- **Nothing scrolls sideways** on any phone route except Organisation (above). No horizontal overflow elements were found elsewhere.
- **Lead-figure card shape** is the same on Orders, Suppliers, Master and Pricelist: radius 10px, 1px border `rgb(230,230,233)`, soft shadow, name left, one figure right, hairline, foot.
- **Card buttons** use words (Edit, Set up, Change), never a pencil, on phone. They are 32px visible with a 43px hit area.
- **Sheets:** state lives in the URL (`?order=`, `?supplier=`, `?article=`, `?new-order=true`), a 44px × close on phone, tabs inside a sheet fit the width.
- **Pill tones** follow ok=green, warn=amber, bad=red, info only for in motion.
- **Money in lists** is "Rp 1.234.000" with dot thousands.
- **Required marks** are "Label* (Required)" in the supplier and PO forms and the Master term form.
- **No raw Indonesian UI copy** remains in source for these three modules (data values like "Harga awal" aside).
- **Employee full names** on PO sheet and count review.
- **Touch-hit expansion** is used on 32px card buttons.
