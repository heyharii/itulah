# Sales (hub › Sales) — use cases

Actor is always **rina** (ADMIN; sees cost and profit). Every test reads the API and the screen and compares them with `agree()`
(support/sales.ts): API before, screen, API after; only a pair of API reads that agree is trusted, a disagreeing screen gets a reload
and another try. Nothing is hard-coded — the POS suites keep selling and voiding at store-01 while these run, and other agents add stores.
Map: `maps/sales.md`. Files: `hub/sales/*.e2e.ts`. Helpers: `support/sales.ts`.

Status key — **pass** (green on a working-tree hub), **bug** (red on purpose, asserts the right behaviour), **skip** (reason), **todo-run** (written, not yet green-checked against the working-tree hub, see "Blocked").

| ID | Branch | Preconditions | Steps → expected | Test (file::title) | Status |
|---|---|---|---|---|---|
| SAL-01 | Explorer, each of the 9 groupings (Division, Tag, Article, SKU, Store, Supplier, Month, Cashier session, Payment method) | sales at store-01 | open `/sales/explorer`, press the tab → tab selected, `g=` in the address; KPI strip (Transactions + voided, Sold, Sales, Acquisition cost, Gross profit, Stock) equals `total`; every row (name, Sales + pieces, Discount, Gross profit + margin, Stock + acq, Share) and the Total foot equal `rows`/`total`; row-count line; `· N stores` line | explorer-groups::SAL-01 *(×9)* | pass |
| SAL-02 | Period presets This month / Last month / This year / All time | — | tap → pressed, others not; table equals the API for the resolved days; a span outside the sales days says `Nothing sold in this period. The latest sales day is …` | explorer-period::SAL-02 *(×4)* | pass |
| SAL-03 | Pick dates: shortcut + Apply | — | popover: `Pick the first day`, Apply disabled; `Last 7 days` → `01–… · 7 days`; Apply → button shows the range, no preset lit, rows equal API | explorer-period::SAL-03 | pass |
| SAL-04 | Pick dates: Today, Yesterday (empty), Cancel | — | Cancel changes nothing; Today = the trading day; Yesterday → empty sentence | explorer-period::SAL-04 | pass |
| SAL-05 | Period survives reload; Back walks back | — | `p=month`, reload keeps it; Back restores | explorer-period::SAL-05 | pass |
| SAL-06 | Per store, rows by each of the 8 groupings | — | Per store pressed (`v=stores`); every store's stock/sales cell, the pinned Totals and the Total foot equal `cells`/`store_totals`; header = every store + Totals | explorer-view::SAL-06 *(×8)* | pass |
| SAL-07 | Stores without sales | — | idle stores show a dash, never zero | explorer-view::SAL-07 | pass |
| SAL-08 | Heatmap switch | — | key under the table only in Per store with Heatmap on; off → `h=0`; on again | explorer-view::SAL-08 | pass |
| SAL-09 | Totals ↔ Per store, reload | — | Per store survives reload; Totals brings the plain table back | explorer-view::SAL-09 | pass |
| SAL-10 | Rows by Store | — | Per store disabled; `v=stores` in the address still draws the plain table | explorer-view::SAL-10 | pass |
| SAL-11 | Store filter across **every** store (16 → 32 on the rig now) | — | `?f=st=<store>` for each; store with sales shows its rows, the rest show `Nothing sold in this period.`, totals zero; Applied `Stores: <label>` | explorer-filter::SAL-11 | todo-run |
| SAL-12 | Filter sheet › Stores | — | search `Tasik` → 1, `zzz` → `Nothing matches.`; tick two stores; `Show N divisions`; badge; Applied line; Clear | explorer-filter::SAL-12 | todo-run |
| SAL-13 | Filter sheet › Division / Tag / Supplier / Colour / Size | choice with sales | tick → rows/Total equal API with that filter; `Division: Pria` | explorer-filter::SAL-13 *(×5)* | todo-run |
| SAL-14 | Reset in the sheet; pane summaries (All / count) | — | Reset empties every pane | explorer-filter::SAL-14 | todo-run |
| SAL-15 | Saved views | — | save a combination (group, store, month), apply from a clean screen, delete | explorer-filter::SAL-15 | todo-run |
| SAL-16 | Drill Division / Tag / Store / Supplier row | — | row → Article tab, `All <noun>` crumb, Applied line, rows equal API with the filter; crumb button steps back | explorer-drill::SAL-16 *(×4)* | pass |
| SAL-17 | Month row narrows the period | — | → Article tab, period = the month (kept inside the period), `All months` crumb steps back | explorer-drill::SAL-17 | pass |
| SAL-18 | Session / Payment rows are only read | — | press → address unchanged, no crumb, no sheet | explorer-drill::SAL-18 *(×2)* | pass |
| SAL-19 | Back out of a drill | — | Article tab after drill; SKU tab; Search SKUs box | explorer-drill::SAL-19 | pass |
| SAL-20 | Article sheet | — | title/code, facts (Sales, Sold, Discount, Returns, Gross profit + margin, Stock, Stock at acquisition) equal the row; Stores table (each store that sold/holds it, All stores) and SKUs grid equal the detail query | explorer-drill::SAL-20 | pass |
| SAL-21 | SKU sheet | — | facts + stores, no SKUs section | explorer-drill::SAL-21 | pass |
| SAL-22 | Search → server `q`, `No match.`, Clear search | — | URL `q=`, rows equal API; gibberish → `No match.`; clear → full | explorer-drill::SAL-22 | pass |
| SAL-22b | Search finds what its label says (division, supplier, store, tag) | — | typing the row's own name keeps the row | explorer-drill::SAL-22b *(×4)* | **bug** — `q` matches the articles under a row, not its name (`q=Pria`→0 divisions, `q=Garmen`→0 suppliers, `q=Store`→0 stores) |
| SAL-23 | More rows load as the table scrolls (`100 of N`) | >100 rows | scroll → next page | explorer-drill::SAL-23 | skip — rig has <100 rows in every grouping |
| SAL-24 | Export (Division, Article, SKU, Month, Cashier session, Payment method) | — | download `Sales-by-<Group>-<from>-<to>.xlsx`; sheet name, title, period; header; every row and the Total equal the API (money exact, margin/share as fractions) | explorer-export::SAL-24 *(×6)* | pass |
| SAL-25 | Export of Per store | — | header = base + `<Cxxx> Stock / Stock at acquisition / Sales / Pieces` per store; cells equal `cells` | explorer-export::SAL-25 | pass |
| SAL-26 | Export off when empty | span with no sales | Export disabled | explorer-export::SAL-26 | pass |
| SAL-27 | Sales by Store / Division / Tag / Article / SKU / PO / Supplier / Campaign / Payment / Cashier Session — table | — | h1; table (name, Stock?, Quantity sold, Sales), Total, `Voided sales: N · Rp X`, `Top N of M` equal `breakdown` | breakdowns::SAL-27 *(×10)* | pass |
| SAL-28 | Same ten — chart | — | bars = ten biggest rows with net>0 (name + compact value), `Total Rp …`, `+N more in the table`, step label | breakdowns::SAL-28 *(×10)* | pass |
| SAL-29 | Per store on the eight cuts that offer it; none on Store / Session | — | All ↔ Per store; every store's Stock·Qty·Sales (dash for zero) and the foot equal `cells`/`site_totals` | breakdowns::SAL-29, SAL-29b | pass |
| SAL-30 | Search by name/code; `No match.` | — | filter in the browser, Total unchanged | breakdowns::SAL-30 | pass |
| SAL-31 | Division filter (and none on Sales by division) | — | `division=PRIA` rows equal API | breakdowns::SAL-31 | pass |
| SAL-32 | Unit filter; a unit without sales | — | `C001 · Cikupa` equals API (unit=store-01); `C002 · Muaro Bungo` → `No sales in this window.`, Export off | breakdowns::SAL-32 | pass |
| SAL-33 | From / To typed; start after end | — | window re-asked; `Pick a start and an end date.` | breakdowns::SAL-33 | pass |
| SAL-34 | Scrubber + Replay | sales in the last step only | ArrowLeft → step before, no bars, `Total Rp 0`; End → back; Replay → 0 → last | breakdowns::SAL-34 | pass |
| SAL-35 | Export on Sales by tag / campaign / store | — | file name `…-All-Units-…`, header, rows, Voided sales row, Total | breakdowns::SAL-35 *(×3)* | pass |
| SAL-37 | Sales (trading days), opening view | — | tiles (Takings, Transactions, Avg transaction, Units, Units per sale), every day row, `vs prev`, Live pill, Whole span foot equal `series` | days::SAL-37 | pass |
| SAL-38 | day / week / month × every span | — | each combination equals `series` (+ the span before) | days::SAL-38 *(×3)* | pass |
| SAL-39 | Pressing a tile lights it | — | one tile pressed at a time; figures unchanged | days::SAL-39 | pass |
| SAL-40 | A day unfolds into the shops that traded | day with sales | shops biggest first, takings/transactions equal cells; folds again | days::SAL-40 | pass |
| SAL-41 | Naming a shop narrows the screen; picker Clear | — | `?store=`, chart title, no Shops column, foot = shop name | days::SAL-41 | pass |
| SAL-42 | Shop filter across every shop | — | each store's days/totals equal `series` for that store | days::SAL-42 | pass |
| SAL-43 | Shop-day sheet | — | facts, tenders, drawer, receipts, ladder equal `window` | days::SAL-43 | pass |
| SAL-44 | Compare (last year, a named span) | — | `cmp=year` → `vs 2025`; custom span → `vs 1 Sept`; deltas equal | days::SAL-44 | pass |
| SAL-45 | Sales Analytics opening view | — | tiles, Gaining/Losing ground, a row per store (takings, share, vs before, transactions, avg, units, UPT), `N of M stores trading` | analytics::SAL-45 | pass (share reads `100.0%`, source says `100%` — see Blocked) |
| SAL-46 | Analytics day/week/month × spans | — | equals `series` + span before | analytics::SAL-46 *(×3)* | pass |
| SAL-47 | Analytics tiles rank the bars | — | one pressed | analytics::SAL-47 | pass |
| SAL-48 | Analytics sorting (Takings, Transactions, Units, Avg Transaction) | — | press → order, second press reverses | analytics::SAL-48 *(×4)* | pass |
| SAL-49 | Analytics row → shop sheet | — | `?store=`, sheet opens | analytics::SAL-49 | pass |
| SAL-50 | Analytics Filter chips (Takings floor, store) | — | — | — | not written — FilterPanel is shared with other domains |
| SAL-53 | Member prompt | — | text, Look up disabled until typed | member-returns-floor::SAL-53 | todo-run |
| SAL-54 | Member lookup 081311110001 | member with receipts | five tiles equal `summary`; each completed purchase listed with its figures | member-returns-floor::SAL-54 | todo-run |
| SAL-55 | Member history lists exactly the purchases the totals count | member with voided sales | N rows = `transaction_count` | member-returns-floor::SAL-55 | **bug** — voided sales are listed as purchases (7 rows for "2 purchases"), no marker, with points |
| SAL-56 | Unknown member | — | `That member holds a card and has not used it yet — …` | member-returns-floor::SAL-56 | todo-run |
| SAL-57 | Member basket sheet | — | facts, basket lines, ladder equal the receipt | member-returns-floor::SAL-57 | todo-run |
| SAL-58 | Returns totals + empty sentence | — | KPIs equal `/returns` totals; empty sentence | member-returns-floor::SAL-58 | todo-run |
| SAL-59 | Returns sorting/chips/sheet | a return | — | member-returns-floor::SAL-59 | skip — rig has no return (a till return has no sync fact) |
| SAL-60 | Shop Floor KPIs + fleet table | — | equal `/sales?limit=500` | member-returns-floor::SAL-60 | todo-run |
| SAL-61 | Shop Floor: every till square | no OPEN basket | sentence | member-returns-floor::SAL-61 | todo-run |
| SAL-62 | Store-sale receipt (`?sale=`) | — | facts, items, tenders, ladder, Cloud sale ID equal `/shop-sales/{id}` | member-returns-floor::SAL-62 | todo-run |
| SAL-63 | Receipt of a voided sale says it was voided | voided sale | text `void…` in the sheet | member-returns-floor::SAL-63 | **bug** — `/shop-sales/{id}` carries no status; the sheet reads like a normal sale |
| SAL-64 | Voided sales are not takings (Sales, 30 days) | voided sales in the window | Takings and Transactions tiles = completed sales only | voided-and-names::SAL-64 | **bug** — `sales_series`/`sales_window` (reports.rs) read every `edge_sale`, no `status='COMPLETED'` (e.g. Takings Rp 20.109.300 vs completed Rp 4.780.950, 75 voided counted) |
| SAL-65 | Same on Sales Analytics | — | tiles = completed only | voided-and-names::SAL-65 | **bug** (same cause) |
| SAL-66 | Shop-day sheet counts voided sales | voided sale at store-01 today | Voided fact = N, banner | voided-and-names::SAL-66 | **bug** — `voided` counts only the centre `sale` table (always 0 for store sales) |
| SAL-67 | A shop has one name | — | the row says Store 01; its sheet must too | voided-and-names::SAL-67 | **bug** (low) — sheet title is the unit name `Cikupa`, rows use the site name `Store 01` |
| SAL-68 | Explorer on a phone (414×896) | — | Group by in the dock, a card per row, Total bar, no horizontal scroll | explorer-phone::SAL-68 | todo-run |
| SAL-69 | Explorer phone period sheet | — | presets + Pick dates | explorer-phone::SAL-69 | todo-run |

## Agent steps
None. Every fact is a locator + `expect` + API read; the chart is checked through its DOM (bar names, compact values, slider value), not by a model.

## Blocked
- **The hub served on :5580 changed under the run.** Until ~22:00 UTC it was a dev server on the working tree (Explorer present — all `pass` rows above were green there). From ~22:20 UTC it is `vite preview` of `/home/hari/hub-dist`, rebuilt several times (22:20, 22:39, 22:47) from **HEAD, not the working tree**: no `/sales/explorer` (the `explorer-*.ts(x)` files are untracked), Sales home is `/sales/by-store`, and the old Analytics prints `100.0%`. Explorer tests and anything built on newer `sales/` edits cannot go green until `hub-dist` is built from the working tree (or the dev server is back).
- The cloud was restarted at ~21:59 UTC (a run saw `ECONNREFUSED :8580` for a minute).
