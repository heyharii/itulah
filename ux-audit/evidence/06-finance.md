# Finance UX consistency audit (hub, Central)

Auditor: read-only. Rig dev server http://localhost:5360, signed in as Rina until partway through (see "What I could not see").

Method: DOM text, sizes and computed styles read from the live app for all 48 routes on desk (1440x900) and about 35 of them on phone (414x896), plus the source in `frontend-hub/src/screens/{finance,finance-final,finance-lab-2}` and `components/ui`. Each finding says "seen on screen" (DOM or screenshot) or "from code".

Severity: H = same thing contradicts itself or breaks an owner rule, M = visible inconsistency, L = polish.

---

## 1. Same concept, different words or numbers

### [H] "Bill" means three different numbers on the Overview and Payables screens
**Where:** /finance/dashboard, /finance/payables/bills, /finance/payables/aging, /finance/reports/accounts-payable-summary, /finance/period-close
**Evidence (seen on screen):**
- The Overview KPI "Total payables Rp 0 / Bills and giros not yet paid" sits above a "Payables ageing" card showing Rp 20,6 jt + Rp 32,4 jt.
- The "Overdue payments" card says "Nothing is late." while Supplier Bills shows "Garmen AA, UD 4d late Rp 19.500.000" and "Indorama, PT 4d late Rp 12.880.000".
- Purchase Invoice says "No supplier invoice has been recorded yet." while Accounts Payable / Supplier Bills say "Total payable · 13 bills", "Rp 52.946.430".
- Period Close lists "Supplier payables Rp 52.946.430 · 13 open items".
**Inconsistent with:** the same screens. One notion of "bill" is posted purchase invoices, the other is goods-receipt payables. The words used are Purchase Invoice (menu/H1), supplier invoice, Supplier Bills, bills, Record bill.
**Suggested standard:** pick one noun for the document ("Supplier bill") and use it in menu, H1, button, empty state and counts. Say in the label whether a figure is "posted bills" or "owed incl. goods received not billed", so Overview, ageing and the bill list cannot disagree silently.

### [H] Scope filter is "unit", "site" or "shop" for the same picker
**Where:** Every Finance screen
**Evidence (seen on screen):**
- "Every unit": Payables Aging, Supplier Bills, Journal Entry, Trial Balance, P&L, Cash Flow, Payments, BKK/BKM, Giro, Accruals, Projection.
- "Every site": Purchase Invoice (176px), Asset (176px), Fixed Asset Register (208px).
- "All units": Inventory Valuation and COGS side list.
- "Whole company": Chart of Accounts.
- "Choose a site": Record bill form ("Site*"), Register asset, Sales Postings.
- "Choose a unit": Recurring bill ("Unit*"), journal rows, BKK ("Unit*").
- "Choose a shop": Sales Reconciliation.
- Stores pages list "Cikupa C001" as "Shops".
**Inconsistent with:** each other. Adjacent screens (Purchase Invoice "Every site" vs Accounts Payable "Every unit") filter the same thing with a different word.
**Suggested standard:** one word for the books scope ("unit", per the unit/site decision) and "shop" only where the list is stores only. Drop "site" from Finance copy unless it means a physical location.

### [M] "Every X" vs "All X" for the unfiltered option
**Where:** bank-transactions, bank-reconciliation, BKK/BKM, credit-notes, payments, giro, valuation
**Evidence (seen on screen):**
- Bank Transactions: "All accounts", "Every status", "Every month", "Every year".
- Bank Reconciliation (next menu row): "All accounts", "All months", "All years".
- BKK/BKM: "All statuses" + "Every unit".
- Credit Note: "Every status".
- Payment Entry: "Draft and posted".
- Giro: "Every bank".
- Code also has "Any method", "All tenders", "All categories".
**Inconsistent with:** itself. Two screens under Banking use a different word for the same filter.
**Suggested standard:** one convention ("All" + plural, or "Every" + singular) for every select placeholder. Replace "Draft and posted" with a plain "All statuses".

### [M] Status vocabulary for "switched off" and "dead"
**Where:** recurring-bills, chart-of-accounts, bank-rules, pay-components, payment-methods, stores, period-closing, journal
**Evidence (from code):**
- Recurring bills: Status dot "Active/Retired", button "Retire", toggle "Show retired".
- Chart of Accounts: Fact "State: Active/Inactive", button "Deactivate/Reactivate", toggle "Show inactive".
- Payment Methods, Shop Payment Methods, Expense Categories: "Show inactive". Payment Methods writes "Inactive" as a suffix in a dot-joined meta line.
- Bank rules: Pill "Retired". Pay components: "Retired" inside a joined line.
- Documents: "Voided" (Stores), "Cancelled" (Period Closing Voucher), "Reversed" (Journal), "Cancelled" (Pill, bank clearance).
**Inconsistent with:** each other. Retire/Inactive/Deactivate are the same act; Voided/Cancelled/Reversed overlap.
**Suggested standard:** masters: Active / Inactive, actions Deactivate / Reactivate, toggle "Show inactive". Documents: Draft → Posted → Reversed (a posted document is never "cancelled", as the journal sheet itself says); "Voided" only for a discarded draft.

### [M] Create and submit verbs differ for the same act
**Where:** all list screens, all create forms
**Evidence (seen on screen and code):**
- Create buttons: "New credit note", "New recurring bill", "New entry", "New BKK", "New dimension", "New method", "Record bill", "Record payment", "Register asset", "Opening giro", "Upload statement", "Generate draft", "Open a month", "Add a rule", "Add override".
- Sheet title vs button: "New journal entry" (button "New entry"), "New payment method" ("New method"), "Record a supplier bill" ("Record bill"), "Register an asset" ("Register asset").
- Phone Fab aria-label is "Add New credit note" while the desk button says "New credit note".
- Footer verbs: "Submit" (29 uses: bill, credit note, recurring bill, payment method), "Post entry" (journal), "Post to the books" (bill sheet), "Save draft" (BKK/BKM), "Register" (asset), "Generate draft".
**Inconsistent with:** each other. "Submit" implies an approval step that does not exist; the same Post action has two wordings.
**Suggested standard:** create button = "New <noun>", with the sheet title the identical phrase. Footer verb is "Save" for a draft/master and "Post" for a ledger write. Retire "Submit".

### [M] Menu label, H1 and button name different things
**Where:** nav.ts vs page titles
**Evidence (seen on screen):**
- Menu "Card & EDC Settlement" → H1 "Sales Reconciliation".
- Menu "Profit and Loss" → H1 "Profit and Loss Statement".
- Menu "Accounting Dimension" → H1 "Accounting Dimensions".
- Menu "Overview" under Stores → H1 "Stores".
- Menu "Mode of Payment" → "14 methods", "New method", "New payment method".
- Menu "Payment Entry" → button "Record payment", "0 payments".
- Menu "Asset" → "Register asset"; menu "Fixed Asset Register" is a different screen.
**Inconsistent with:** the other ~40 screens where menu = H1.
**Suggested standard:** H1 = menu label (the phone echo-hide in `page-header.tsx` only works on an exact match, see the phone-rules section), and the noun in buttons/counts follows it.

### [M] Case: Title Case forced by CSS over sentence-case copy
**Where:** `components/ui/field.tsx:88` (Field label) and `:358` (Checkbox label) carry `capitalize`; the Stores H1s are sentence case
**Evidence (seen on screen):**
- Form labels render "Invoice Number*", "Every Month On Day*", "Expected Amount Before Tax*", "Bank, Scheme Or Provider*", "Supplier's Credit Note No".
- Toggles render "Show Retired", "Show Inactive", "Late Only", "Include Not Payable Yet", "Group By Supplier", "Split By Unit", "Compare Units". The source writes "Show retired", "Late only".
- The Journal Entry dialog says fact "Posting date" next to form field "Posting Date".
- Stores H1s are sentence case ("Sales by day", "Cash on hand", "Cash counts") while every other H1 and menu row is Title Case ("Inventory Valuation", "Cost of Goods Sold").
- Selects, tabs and empty states are sentence case.
**Suggested standard:** sentence case everywhere in the hub (copy rule); remove `capitalize` from Field and Checkbox. Decide H1 casing once (menu is Title Case, so make the Stores H1s match).

### [M] Dates and ranges: five styles
**Where:** Stores, Inventory, Payables, reports
**Evidence (seen on screen):**
- "06 Oct 2026" (zero-padded, with year; most tables and pickers).
- "Today 6 Oct", "Mon 5 Oct" (no year, unpadded; Stores sales tiles).
- "Week of 28 Sep / 28–4 Oct" (no month on the left end, no year; cash counts).
- "October 2026" / "Oct 2026" (month tabs, KPI sublabels).
- "04 Oct 2026, 09:56" (journal sheet).
- Range sentence "01 Oct 2026 – 06 Oct 2026" vs the picker pair "01 Oct 2026 to 06 Oct 2026" on the same screen.
- Age: "4 days" (note), "Days 4" (column), "in 26d / 4d late" (Oldest column).
**Suggested standard:** one `day()` format with the year everywhere (owner rule: dates carry the year); ranges "28 Sep – 4 Oct 2026"; age always "N days" or "N days late".

### [M] Money, negatives, zero and Dr/Cr
**Where:** dashboard, balance-sheet, trial-balance, stock-vs-ledger, period-close, chart-of-accounts, BKK
**Evidence (seen on screen and code):**
- Full "Rp 56.246.430" (KPIs, tables) vs compact "Rp 20,6 jt" (Overview ageing chart on desk) vs "15 jt/30 jt" (Balance Sheet axis, no Rp). The phone lists full figures for the same ageing.
- Negative: "-Rp 79" (ASCII hyphen, `money()`; Stock vs Ledger, Period Close, "off by -Rp 79.") vs "−16" (true minus, `variance()`) vs "− Rp 100.000" (minus + space, BKK) vs "(Credit)" words in Balance Sheet.
- Zero: "Rp 0" vs "·" (Trial Balance, Stock vs Ledger, journal lines) vs "—" (Dimensions, phone Stock vs Ledger) vs "Not required" (Dimensions phone).
- Dr/Cr: "Rp 56.886.430Dr" (Chart of Accounts, glued), "Rp 56.886.430 Dr" (Trial Balance phone), separate Dr/Cr columns (Trial Balance desk).
**Suggested standard:** one `money()` with one signed style (true minus, same position), one "nothing" glyph, one Dr/Cr suffix with a space. Compact figures only in chart axes, written the same way (with Rp, one decimal).

### [M] Three "inventory value" figures with generic labels
**Where:** /finance/dashboard, /finance/inventory/valuation, /finance/inventory/stock-vs-ledger, /finance/inventory/goods-in-transit
**Evidence (seen on screen):**
- Overview "Inventory value Rp 56.246.430 / Stock at cost, in the books today".
- Valuation "Total Rp 52.946.509" (on hand + in transit + awaiting setup).
- Stock vs Ledger "Stock value Rp 49.646.509" / "Ledger 1029 Rp 49.646.430".
- Wording: "In transit" (valuation KPI), "On the road" (valuation section, Goods in Transit tab, phone), "In transit (stock)" (Stock vs Ledger).
**Suggested standard:** name each figure by what it contains ("Stock on hand", "On the road", "Awaiting setup", "Ledger value") and use one word for goods in transit (the menu says "Goods in Transit").

### [M] Quantity words
**Where:** inventory, sales-by-division
**Evidence:**
- Seen on screen: Goods in Transit note "66 pieces"; phone cards "240 pcs"; valuation foot "pcs".
- From code: `sales-by-division.tsx:240` header "Qty" (the only one in Finance); other tables say "Quantity".
**Suggested standard:** "Quantity" in headers, "pcs" as the inline unit; never "Qty" or "pieces".

### [M] Raw ids, enums and logins leak into user copy
**Where:** journal-entries, receivables/aging, bank-accounts, dimensions, payment-methods, stock-vs-ledger
**Evidence (seen on screen):**
- Journal: memo "DISPATCH 2 unit ho -> store-01 (ALR-00000032)", "GRN-HO-GUDANG-000014 0001", Posted by "nina", "maya", "system:goods-receipt", sheet "Source record a35c85c8-13cd-4716-b97a-26f6fcd33346".
- Accounts Receivable column "Meaning": `time_deposit`.
- Dimensions code `COST_CENTER`.
- Payment Methods tender "Qris" (data says "QRIS BCA").
- Bank Account rows "Cash In Bank Giro Bank BNI · not described" ×210.
- Account numbers in labels: "Ledger 1029", "Total on 1031", "Register asset … no posted expense bill has a line coded to 10215*".
**Inconsistent with:** the owner rule (employee full name, not login).
**Suggested standard:** show names, never logins/UUIDs/enum codes; account numbers only in an "Account" column; drop "not described" noise.

### [L] Empty-state, count-line and loading phrasing
**Where:** all list screens
**Evidence (seen on screen):**
- Empty: "No BKK is recorded." / "No payment is recorded." / "No credit note yet. Record one…" / "Nothing moved in Cash on hand this month." / "Nothing moved in the Cashier float this month." (the article differs) / "Every accrued cost has its bill." / "Nothing is owed to a supplier."
- Fixed Asset Register: "No capitalised asset is on the books yet"; Asset: "Nothing has been registered yet."
- Count lines: "0 documents", "0 recurring bills", "0 accounts", "36 entries", "1 months opened" (plural bug, `periods.tsx:422`), "As at 06 Oct 2026 · every unit" (lowercase) next to the "Every unit" select.
- Loading (from code): "Reading the shops…", "Loading the bills…", "Searching the chart…", bare "Loading…" (Period Close, 11 bare).
**Suggested standard:** one empty-state template ("No <things> yet" + one action), one count-line shape with a pluralised noun, one loading verb.

### [L] Filler and instruction copy
**Where:** giro, stock-vs-ledger, BKK form, journal sheet, period-close
**Evidence (seen on screen):**
- Giro: "Drag a giro to Cleared once the bank has taken it, or to Bounced if it was refused."
- Stock vs Ledger: "Read as at today — the stores and DC report where each piece is now."
- BKK form: "Missing fields are pointed out when you save, not before." and "Discount posts to Settlement discount — change it in Account links".
- Journal sheet: "This entry moves money between units. HO · Head Office down Rp 0, C001 · Cikupa down Rp 0. Each unit's own books are left unbalanced."
- Period Close: a three-sentence paragraph under "Ledger against subledgers".
**Inconsistent with:** the owner rule "no explanatory subtitles/notes/footnotes".
**Suggested standard:** cut, or move behind an info affordance.

---

## 2. Same concept, different component or pattern

### [H] Four containers for "create a record"
**Where:** payables/bills, credit-notes, recurring-bills, assets/capitalization, accounting/journal-entries, cash-bank/bkk/new, setup/payment-methods
**Evidence:**
- Right-hand sheet, footer "Submit" only, close is an unlabeled 32px "?" icon: Record bill, Register asset (seen on screen; from code `Sheet`).
- Centered dialog (`Panel`) with Cancel + Submit and a labeled 36px "Close": New credit note, New recurring bill (seen on screen).
- Centered 52rem workspace sheet with × close and footer "Add row / Post entry", no Cancel: New journal entry.
- Full page with "← Back to BKK" and "Save draft": New BKK/BKM.
- Rail sheet with "Close" + Submit: payment method (seen on screen).
- Code: `Panel` in 14 Finance files, `Sheet` in 17.
**Suggested standard:** one container for create (right sheet; page only for documents with lines such as BKK/journal), one footer (Cancel left of primary), one close control with an aria-label.

### [H] Status shown four ways
**Where:** journal-entries, recurring-bills, chart-of-accounts, bank-rules, payment-methods, tax/payables, periods
**Evidence:**
- Dot + word (`Status`, 15 files): journal list "● Posted", recurring bills.
- Outlined `Pill` (46 files): bank-rules "Retired", bill "On hold", "GA".
- Plain text in a Fact: Chart of Accounts "State — Active".
- A suffix in a joined line: payment methods "· Inactive", pay components.
- Tabs with counts used as status filters: Accruals, Tax Payables, Adjustments.
**Suggested standard:** list/table status = dot + word; tags (GA, kind) = Pill; never plain text. Same state, same component.

### [M] Record detail container differs
**Where:** journal-entries vs chart-of-accounts, bills, bank accounts vs BKK
**Evidence:** a Journal Entry row opens a centered 52rem dialog (`?entry=<uuid>`) carrying its own "Reverse" form. Chart of Accounts and bills open the right-hand rail sheet. BKK/BKM rows open a full page. Payment methods and recurring bills open a Panel/sheet.
**Suggested standard:** one record pattern (right rail with facts + footer actions); wide workspace only for editing lines.

### [M] Report/list toolbars: order, hiding and heights
**Where:** all /finance/reports/*, aging, supplier ledger, journal, GL, projection, bills, asset
**Evidence (seen on screen):**
- Order differs: Aging "Export, Every unit, As at"; Trial Balance "Export, Every unit, dates"; Supplier Ledger "Export, dates, Every unit"; Journal "New entry, dates, Every type, Every unit"; General Ledger "Every unit, dates, (account)"; Projection "Every unit, Export".
- Some screens hide filters behind a "Filter" button (77x32): Purchase Invoice, Asset, Accounting Period; others show inline selects.
- Controls in one toolbar mix 36px (Export, selects) with 32px (date inputs, Periodicity, Filter), and Sales Postings uses a 40px date.
- The same "Every unit/site" select is 176, 208 or 224px wide.
**Suggested standard:** one Report toolbar: [scope] [period] [extra filters] … [Export] on the right, one control height (36).

### [M] Period pickers: seven widgets for "which period"
**Where:** stores/*, inventory/cogs, payables/projection, reports, aging, period-close, sales-postings
**Evidence (seen on screen):**
- Month tabs "May 2026…Oct 2026" (cash on hand, petty cash, cashier float).
- Day tiles (Sales by day), week tiles (Cash counts), year tabs "2026/2025" (COGS).
- Month/Year segmented + prev/next + Today (Projection).
- From–to date pair (reports) with a separate "Yearly" select (P&L/Balance Sheet; a Balance Sheet is a point in time).
- "As at" single date (aging).
- Month input (Period Close, Sales Postings).
**Suggested standard:** one month picker and one "as at / from–to" picker, reused. Statement-type reports take "As at".

### [M] Counts on tabs
**Where:** payables/bills, accruals, tax/payables, adjustments
**Evidence (seen on screen):** "Unbilled deliveries · 13" (suffix, only if >0) vs "Waiting for a bill0 / Settled0 / All0" (badge, always, including 0) vs "Waiting / Booked" (none).
**Suggested standard:** one tab-count rule (badge, hidden at zero, or always shown).

### [M] Two screens for one job, with the same menu text under two groups
**Where:** nav.ts
**Evidence (seen on screen):**
- "Accounts Payable" (aging, Group By Supplier toggle) and "Supplier Bills" show the same buckets and totals.
- "Asset" (register, rows) and "Fixed Asset Register" (read-only report) differ only in capitalisation state.
- "Petty Cash" is under Stores (month ledger) and under Payments › More (`finance-final/expenses`) with different empty states.
- "Bank Account" lists 210 accounts while "Bank Reconciliation" says "0 accounts".
- Accounts Receivable (a card-settlement account list, 154 accounts incl. TIME DEPOSIT BANK BCA) sits under the heading "Card settlement, by unit" (`receivable.tsx:415`).
**Suggested standard:** one screen per job; where two exist, name the difference ("Owed by supplier" vs "Aging").

### [L] Charts: empty axis vs empty message
**Where:** /finance/dashboard
**Evidence (seen on screen):** "Cash and bank" and "Income and expenses" cards draw empty axes (Nov…Oct, 0…4) with no message; "Expenses per month" shows "No expense in these months."; the two Open lists show text.
**Suggested standard:** every chart card shows the same empty message when its data is zero.

### [L] Form copy: units and defaults
**Where:** setup/payment-methods, credit-notes, journal
**Evidence (seen on screen):** the MDR field shows "0.00%" but its hint says "In basis points: 150 is 1.50%". Credit Note's "Reason*" is pre-filled with "Goods returned" while other required fields are empty. Journal and BKK use different helper-line styles ("The month this lands in." vs none).
**Suggested standard:** one unit per field; no pre-selected required answers; helper text only where it adds information.

---

## 3. Phone rules

### [H] Touch targets below 44px across the dock
**Where:** `components/ui/fab.tsx:45` (`h-9`/`size-9`), `shell/dock-tools.tsx:138,153,170,213` (`h-9`, `size-7`)
**Evidence (seen on screen, 414x896):**
- Dock chips (All units, By article, Cikupa, 6 Oct, Every status, Filters) are 36px high.
- The primary Fab is 36x36 (Record bill, New credit note, Add New BKK, New entry).
- The in-field "Filter and sort" icon is 28x28 (Chart of Accounts, Assets, Payment Methods, Accounting Period).
- "Paid By" Cash/Transfer/Giro segmented 36px; "Browse open bills" 40px; Month/Year segmented 36px (Projection).
- The bottom bar (83x52) and Projection prev/next/Today (44px) do meet the rule.
**Suggested standard:** every tap target at least 44px (grow the hit area even if the visible chip stays 36).

### [M] Calendar and form controls sit in the page body, not the dock
**Where:** /finance/payables/projection, /finance/receivables/card-settlement, /finance/cash-bank/bkk/new
**Evidence (seen on screen):**
- Projection: Month/Year toggle, prev/next, Today and the 7-column grid (47x44 cells) are in the body above the list, with only a "Filters" chip in the dock.
- Sales Reconciliation says "Choose a shop above." on a phone that has no control above.
- The BKK form's actions are right (Save draft 370x44 at the bottom), but "Settle bills / Other lines / Offset receivables" tabs and "Browse open bills" sit mid-page.
**Suggested standard:** pickers and filters in the dock; copy never says "above" or "below".

### [M] Dock composition varies screen to screen
**Where:** all phone lists
**Evidence (seen on screen):**
- A: "Filters" chip + icon Fab (most: bills, journal, aging, giro).
- B: inline "Search …" field + 28px "Filter and sort" + Fab (Chart of Accounts, Assets, Payment Methods, Accounting Period).
- C: a wide labelled button instead of a Fab: "New dimension" 380x36, "Open a month" 187x36.
- D: no dock controls at all on some read-only screens (Stock vs Ledger, Loans), while Trial Balance and the other reports carry a lone "Filters" chip.
- Fab aria-labels are "Add New <label>" for some and the bare label for others.
**Suggested standard:** one dock grammar: [scope chip] [Filters] [Fab], search in the Filters sheet.

### [M] Title duplicated under the top bar when H1 ≠ menu label
**Where:** P&L, Sales Reconciliation, Accounting Dimensions, Loans
**Evidence (seen on screen, phone):** the top bar already names the screen, but "Finance · Financial Reports / Profit and Loss Statement", "Finance · Receivables / Sales Reconciliation", "Finance · Setup / Accounting Dimensions" and a second H1 "Owners & Investors" (Loans) all render in the page body. All other screens correctly suppress it. Cause (from code): `page-header.tsx` `useEchoesTopBar` hides the title only on an exact (case-insensitive) match with the menu label.
**Suggested standard:** make titles equal menu labels, or suppress crumb + title on phone regardless.

### [M] Irreversible action without confirmation, and an unlabeled phone button
**Where:** /finance/period-close
**Evidence (from code, `controls.tsx:106-145`):** desk "Close for the shops" and the phone Fab both call `soft.mutate()` immediately, with no confirmation. Compare Retire actions elsewhere, which use `ConfirmButton`. When closed or blocked, the disabled reason is only a `title` attribute (no help on touch). On phone the action is an icon-only 36px Fab.
**Suggested standard:** confirm sheet with the blocker list; disabled state states its reason in text.

### [L] Lead-figure card is not uniform
**Where:** phone lists
**Evidence (seen on screen):** Journal lead = raw memo text (JV number second); Supplier Bills lead = supplier + outstanding; Payment Methods card has no figure ("14 shops · Linked"); Valuation lead = article + value; Stores overview = shop + cash on hand; Chart of Accounts keeps a tree.
**Suggested standard:** name left, one figure right, one meta line beneath.

---

## 4. Desk/phone parity

### [M] Same screen, different words or facts by device
**Where:** various
**Evidence (seen on screen):**
- Recurring Bills: desk toggle "Show retired" vs phone chip "Active".
- Giro Board: desk "Late only" vs phone chip "Due soon".
- Stores overview: desk column "Cashier float" vs phone "Float".
- Dimensions: desk "—" vs phone "Not required".
- Stock vs Ledger zero difference: desk "·" vs phone "—".
- Goods in Transit: desk "Days 4" vs phone "sent 02 Oct 2026 · 4 days".
- Valuation: desk shows Division (PRIA/WANITA), phone card drops it.
- Supplier Bills: desk "Garmen Nusantara", phone "Garmen Nusantara, PT".
- Overview ageing: desk bar chart "Rp 20,6 jt" vs phone full "Rp 20.566.430".
- Loading: Period Close shows its checks on desk but still "Loading…" on phone after 10s.
**Suggested standard:** same label, same fact, same number format on both; only layout changes.

### [L] Tab counts disappear on phone
**Where:** sub-tabs (`sub-tabs.tsx:160` "Words only, no counts")
**Evidence:** desk Tax Payables tabs "Open0 / Filed0 …" vs the phone dock chip reading "Open0" (the count glued to the word, no separator).
**Suggested standard:** show the count with a separator or not at all, the same on both.

---

## 5. Visual

### [M] Heading scale
**Where:** across Finance
**Evidence (seen on screen, computed style):**
- H1 is 15px/600 everywhere (the quiet owner scale).
- Section headings: Overview and Period Close H2 16px/500; Recurring Bills card H3 16px/600; Payment Projection month title and Card settlement H2 15px/600 (same as the page title); Stores shop H2 18px/600 (larger than the H1).
- Doubled titles: Recurring Bills has H1 "Recurring Bills" and card H3 "Recurring bills"; Loans has two H1s.
**Suggested standard:** one section-heading style below the H1 (e.g. 15px/500 muted or 16px/600), never equal or larger than the title.

### [M] Control heights and widths
**Where:** toolbars and forms
**Evidence (seen on screen):** 36 (Export, selects), 32 (date inputs, Filter, Periodicity, Month/Year segmented 28), 40 (Sales Postings date), 44 (form fields). Select widths 144, 160, 176, 208, 224 for the same "Every …" role. Tab strip 40px.
**Suggested standard:** control = 36px, form field = 44px, nothing in between.

### [L] Crumb text
**Where:** all PageHeaders
**Evidence:**
- Separator: "Finance › Stores" (chevron, `stores-frame.tsx`) vs "Finance · Payables" (middle dot, 90+ places).
- Group names that are not menu groups: Accounting Dimensions "Finance · Setup" (menu: Accounting Masters), Tax types "Finance · Tax Masters" (menu: Tax), Period Closing Voucher "Finance · Opening & Closing" (menu: Closing), Permissions/Posting policies "Finance · Settings", Withholding report "Finance · Taxes", Dimension results/Cash & Bank "Finance · Reports" (menu: Financial Reports), Petty Cash/Deposits/Cash Transactions "Finance · Cash & Bank", Prepaids "Finance · Accounting".
- Lab names (`Finance lab 2 ·`, `Finance final ·`) remain in unrouted-looking files; I did not confirm they are unrouted.
**Suggested standard:** crumb = "Finance · <menu group>" exactly, one separator.

---

## 6. Behaviour

### [M] Disabled and blocked states explain themselves unevenly
**Where:** bill sheet, journal, credit note, recurring bill, period close
**Evidence:** the bill footer says "Fill in the invoice and the amount"; the journal dialog says "No usable row yet — a row needs an account, a unit and a figure"; credit-note and recurring-bill dialogs have a Submit with no reason line; Period Close uses only a `title` tooltip.
**Suggested standard:** every disabled primary shows its reason as visible text beside it.

### [L] Selection memory is partial
**Where:** stores/* vs the rest
**Evidence:** the Stores pages remember the chosen shop in the URL (`?store=`) and sessionStorage; journal records use `?entry=<uuid>`; the scope selects on reports (Every unit) are not in the URL (from code; not re-tested after sign-out).
**Suggested standard:** record id and scope filters both in the URL.

---

## What is already consistent
- No text under 14px on any Finance route, desk or phone (checked leaf elements).
- No horizontal page scroll on phone for the ~35 routes checked; desk tables with overflow stay inside their card.
- Money always through `money()` (id-ID grouping "Rp 1.234.000"); aging bucket labels match across Accounts Payable, Supplier Bills and the dashboard (apart from "> 90 days" vs "90+ days").
- Date pickers and tables use the same `day()` format ("06 Oct 2026") in all toolbars.
- Required marking is one rule: star plus a screen-reader "(Required)".
- Phone lists use the dock + Fab pattern; the top bar names the screen; H1 equals the menu label on about 40 of 48 screens.
- Status tones (ok green, warn amber, bad red, info sky) come from one `Pill`/`Status` pair.
- Retire/destructive actions use `ConfirmButton`; the journal is reversed, never cancelled, and says so.
- Reports follow one ERPNext shape (filters row, summary strip, table).
- Every list screen has an empty state; none showed "undefined" or "NaN".

## What I could not see
- The rig session dropped to the Sign in screen mid-audit; I do not enter passwords, so later checks are from code or from DOM captured before it dropped.
- Screenshots were unreliable (the pane flipped to hidden when other auditors fronted tabs), so visual judgement relies mainly on computed sizes and DOM text; the only screenshots taken were the Overview and the Journal Entry dialog.
- No bills, BKK/BKM, giros, bank lines or assets exist on the rig, so I could not open a bill, BKK or asset record; the Journal Entry sheet was the only record opened. Sheet footers for those, row-tap behaviour and permission messaging were not seen.
- The app blanked entirely twice (after SPA pushState navigation to Cash Flow, and after opening "New method"); neither repeated on a hard load, probably Vite HMR on files other sessions were editing. Source copy changed during the audit (Loans note was Indonesian when first read and English later; Tax Payables copy lost "keluaran/masukan"), so those are not reported as findings.
- Phone checks of Stores money pages beyond the first chip, Giro Board detail, Bank Reconciliation, Fixed Asset Register details and the 7 setup/tax routes are empty-state only.
