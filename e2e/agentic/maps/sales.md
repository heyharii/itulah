# Sales (hub › Sales) — branch map (9–10 Oct 2026, read-only survey + probes against the rig)

All paths below are under `/Users/hari/Documents/itulah/frontend-hub/src/screens/sales/` unless said otherwise.
Line numbers are the working tree (uncommitted: `explorer-*.ts(x)` are untracked, the rest of `sales/` is modified).

## 0. What the Sales module is today

The sidebar module **Sales** (`nav.ts`, home `/sales/explorer`) has ONE menu item, **Sales** → the Explorer. Everything else is
under *More* (⌘K and old links): the nine/ten "Sales by …" screens, **Sales** (trading days), **Store Analytics**, **Returns**,
**Member**, **Shop Floor**. The task text expected Table / Store matrix / Heatmap "views"; in the code they are
**Totals / Per store** (a toggle) and a **Heatmap** switch; the chart + scrubber lives on the "Sales by …" screens, not on the Explorer.

| Screen | Route | Component | Menu label |
|---|---|---|---|
| Explorer | `/sales/explorer` (module home) | `SalesExplorer` explorer.tsx:88 | **Sales** |
| Sales by Store / Division / Tag / Article / SKU / PO / Supplier / Campaign / Payment / Cashier Session | `/sales/by-store` … `/sales/by-session` | `SalesBreakdownScreen` breakdown.tsx:202 (one screen, `by` prop) | More › *Sales by Store* … *Sales by Cashier Session* |
| Trading days | `/sales` | `Sales` sales.tsx:62 + `SalesTable` table.tsx:49 | More › **Sales** |
| Store Analytics | `/sales/analytics` (title "Sales Analytics") | `SalesAnalytics` analytics.tsx:108 | More › **Store Analytics** |
| Returns | `/sales/returns` | `Returns` returns.tsx:279 | More › **Returns** |
| Member | `/sales/customer?member=<id>` | `Member` customer.tsx:285 | More › **Member** |
| Shop Floor | `/sales/overview` | `Overview` overview.tsx:47 | More › **Shop Floor** |
| Receipt sheet | `?sale=<id>` on any Sales screen | `SaleSheet` sale-sheet.tsx:69 (`ShopSaleReceipt` :167 for store sales) | — |
| Shop-day sheet | `?cell=<site>~<from>~<to>` (Sales) / `?store=<site>` (Analytics) | `WindowSheet` window-sheet.tsx:28 | — |

## 1. Explorer (`/sales/explorer`)

**State lives in the address bar.** `f` = a query string of its own (`explorer-model.ts` encodeState :299 / decodeState :360):
`p` period (`month|last|all|YYYY-MM-DD..YYYY-MM-DD`, absent = this year), `g` group, `v=stores`, `h=0` heat off,
`st dv tg sp cl sz` = Stores/Divisions/Tags/Suppliers/Colours/Sizes (comma lists), `cr` = JSON crumbs. `q` = search.
Deep link: `/sales/explorer?f=` + `encodeURIComponent('g=tag&st=store-01&p=month')`.

**Endpoint:** `GET /api/v1/reports/sales/explorer` (finance_control.rs:379) — params `from,to,group,stores,divisions,tags,suppliers,colours,sizes,q,matrix,stock=true,limit=100,offset,totals=false` (explorer-data.ts:43).
Options: `GET …/explorer/options` → `{stores,divisions,tags,suppliers,colours,sizes (code,label), latest_day, earliest_day, can_see_cost}`.
Response: `rows[{key,label,detail,figures,cells[{site_id,figures}]}], rows_total, total, store_totals, stores[{site_id,code,name}], can_see_cost, latest_day, earliest_day, pending_days`.
`figures`: `sales_minor` (= after discounts and returns), `qty, discount_minor, returns_minor, cost_minor, profit_minor, stock, stock_cost_minor, receipts, voided_receipts, voided_minor, uncosted_*`.

| Part | Labels (exact) | Behaviour |
|---|---|---|
| Header | h1 "Sales"; line `01 Jan – 09 Oct 2026 · 16 stores` (+ ` · Updating` when `pending_days>0`) | period via `dateRange()`; "Sep" not "Sept" |
| Period (`PeriodBar` controls :81) | buttons **This month · Last month · This year · All time** (aria-pressed) + **Pick dates** (popover calendar) | default = This year (`p` absent). A month/year with no sales falls back to the latest sales day's month/year (`resolvePeriod` :569). Calendar (explorer-calendar.tsx): shortcuts Today · Yesterday · Last 7 days · Last 30 days · This month · Last month · This year; "Pick the first day / last day"; text `01–09 Oct 2026 · 7 days`; **Apply** (disabled until a day is picked) · **Cancel**; Previous/Next month; days outside first..latest sales day are dead |
| KPI strip (`Strip` explorer.tsx:443) | **Transactions** (+ "N voided"), **Sold** (+ "x,y pcs each"), **Sales** (compact, exact in `title`; + "Rp … discount · avg Rp …"), **Acquisition cost** (+ "% of sales"), **Gross profit** (+ "% margin"), **Stock** (+ "Rp … at acquisition") | cost/profit only when `can_see_cost`; receipts "—" when an item filter is on |
| Groupings (`Navbar` :206) | tabs **Division · Tag · Article · SKU · Store · Supplier · Month · Cashier session · Payment method** | default Division; tablet shortens two |
| Tools row (`Tools` :374) | search `Search <groups>` (aria-label; **q goes to the server and matches the ARTICLES under a row, not the row's own name**), reload stamp `Updated 22:05`, toggle **Totals / Per store** (Per store disabled on Store), switch **Heatmap**, **Filter** (+ badge = panes with a choice), **Export** | "Clear search" ✕; "No match." when q finds nothing |
| Applied line (`Applied` :432) | `Division: Pria · Tag: Denim`, `Stores: Store 01, Store 02 +1`; button **Clear** | |
| Crumbs (`Crumbs` explorer.tsx:549) | nav "Where you are": buttons `All divisions`, then the stepped-into labels | |
| Table (Totals, `TotalsTable` explorer-grid.tsx:297) | cols **\<Group\> · Sales · Discount · Gross profit · Stock · Acq · Share**; Sales cell = compact Rp (exact `title`) over pieces; foot **Total** (100%) | Payment group: **Payment method · Transactions · Collected · Per transaction · Share**; Month/Session/Payment have no Stock column |
| Table (Per store, `StoresTable` :444) | a header per store = code without `-TOKO` (C001 …), two cells per store (**Stock · Acq**, **Sales**) or one for Month/Session/Payment; pinned **Totals** at the right; idle stores show "—" | Heatmap tints each store's Sales against the row's other stores (accent 3–30%); key under the table "· Lowest store … highest store, per row" |
| Row count | under the table: `5 divisions`, `100 of 240 articles`; loads the next 100 as the table scrolls | |
| Empty | `Nothing sold in this period.` / `… The latest sales day is 09 Oct 2026.` when the span is outside first..last day / `No match.` | Export disabled when empty |
| Row press | Division/Tag/Store/Supplier → drill (key becomes the filter, group → Article, crumb); Month → period narrows to the month and group → Article; Article/SKU → `DetailSheet` (explorer-detail.tsx:34): facts **Sales Sold Discount Returns Gross profit Without cost Stock Stock at acquisition**, section **Stores** (Store · Sold · Sales · Stock, **All stores**), for an article section **SKUs** (Colour / size × store, Sold, Stock); Session/Payment rows are only read | |
| Filter sheet (`FilterSheet` :629) | panes **Stores · Division · Tag · Supplier · Colour · Size · Saved views**, each with `All` or a count; pane search `Search stores…`, "Nothing matches."; footer **Reset** and **Show N divisions**; Saved views: input `Name this view`, **Save view**, saved rows (apply), `Delete <name>` (✕); localStorage `hub.sales-explorer.views` | saved view keeps everything except the drill path |
| Export (`exportSheet` explorer-export.ts:23) | `.xlsx` `Sales-by-<Group>-<from>-<to>.xlsx`, sheet `Sales by <Group>`; rows: title, period, blank, header, rows, Total; Per store adds `<Cxxx> Stock/Stock at acquisition/Sales/Pieces` per store | numbers are real numbers; percent = fraction |
| Phone (<768px) | `PhoneGrid` cards + `PhoneDock`: Group by as the dock status button, search+filter in the dock, period button `Period: <label>` → sheet **Period** (presets, Pick dates → bottom-sheet calendar) | no horizontal scroll |

## 2. "Sales by …" screens (`breakdown.tsx`)

Endpoint `GET /api/v1/reports/sales/breakdown?by=<tag|division|store|article|sku|po|supplier|campaign|payment|session>&from&to[&unit][&division]`
→ `rows[{code,name,articles,quantity,gross_minor,discount_minor,returns_minor,net_minor,cost_minor,stock}] (top 500), rows_total, total, voided{count,gross_minor}, has_stock, sites, cells[{code,site_id,quantity,net_minor,stock}], site_totals, steps/step_totals/step (the replay)`.

- Header: crumb "Sales", h1 `Sales by tag` (… `Sales by cashier session`). Window **From / To** (`Day` pickers, default 1 Jan → today; not in the address bar), **Unit** select ("All units", "C001 · Cikupa" …), **Division** select (absent on Sales by division), search `Search tags` / `Search article code or name` / `Search SKU or article` / `Search PO number or supplier` / … (client-side, name+code), **Export**.
- **Chart card** (`RaceCard` :761): title + window; big label of the step (`October`), `Total Rp 4,0 M`; ten biggest running bars (name + compact Rp), axis ticks; `+N more in the table`; **Replay from the start** (↺) and the **Step of the window** slider (`aria-valuetext` = step label; ArrowLeft/Right/Home/End). Steps are days/weeks/months by window length (server `step`).
- Segmented **All / Per store** (absent for Store and Session, whose rows are one shop already). Table (`FigureTable` :1224): `Tag · Stock · Quantity sold · Sales` (no Stock for Campaign/Payment/Session), foot **Total** (counts + money in full "Rp 618.800"); Per store = a store heading per store with `Stock · Qty · Sales`, zero = "—" (also in the "All" group), foot per store. Notes under the table: `Top 500 of N by net sales.` and `Voided sales: N · Rp X`.
- Empty: `No sales in this window.`; search: `No match.`; bad window: `Pick a start and an end date.`
- Export (`exportSheet` :1536): `Sales-by-<Noun>-All-Units-<from>-<to>.xlsx`, sheet `Sales by <Noun>`; columns Code?, Noun, Articles, Quantity, Gross Sales, Discount, Returns, Net Sales, HPP, Gross Profit, Margin %, Stock?, then per-store triples; a `Voided sales` row; Total.
- Phone: DockTools + ranked cards + a sheet per card (Stock · Quantity · Sales per store).

## 3. Sales — trading days (`/sales`)

Endpoints: `GET /reports/sales/series?from&to&bucket` (twice: the span and "the span before"), `GET /reports/sales/window?site_id&from&to&limit&cursor` (the sheet).
Series = `{buckets[], sites[{site_id,site_name,site_kind}], cells[{site_id,bucket_start,gross_minor,net_minor,sales_count,units_sold,tax_minor}]}`. `period.ts`: bucket `day|week|month` (buttons **day week month**), spans `day 7·14·30·90 · week 8·13·26·52 · month 6·12·24` (buttons with the number), default 30 days; `?bucket=&span=`; `?store=<site>` = Shop picker (combobox **Shop**), `?cmp=prev|year|custom&cmpFrom&cmpTo`, `?cell=<site>~<from>~<to>`, `?sale=<id>`.
- Chart card: title "The fleet" (or the shop's name), five pressable tiles **TAKINGS · TRANSACTIONS · AVG TRANSACTION · UNITS · UNITS PER SALE** (accessible name is the text, e.g. `Takings Rp 20.109.300 new`; hint/Delta under the figure) + line chart.
- **Compare** popover: *The span before this one* · *Same dates last year* · *Or name the span* (From/To `Day`s, **Compare against that**), shows `Nd` when the lengths differ.
- Table (newest first): `Day|Week|Month · Takings · vs prev|vs 2025|vs 1 Sept · Transactions · Avg transaction · Units · UPT · Shops`; quiet buckets "–"; today's row has a **Live** pill; foot **Whole span** (or the shop's name when one shop is picked; no Shops column then). A row's button unfolds the shops that traded (biggest first): name button → narrows the screen to it (`?store=`), takings button → shop-day sheet.
- `WindowSheet`: title = shop name, facts **Sales · Units · Average basket · Voided**, warn banner when voided, **Taken in** (Method · Tenders · Amount), **The drawer** ladder (Cash tendered, Change given, Cash refunded, Expected in the drawer), **Came back** (when returns), **Receipts** (Sale · Paid with · Units · Total; sale numbers link to `?sale=`), ladder Net/Tax/Refunded → **Takings**.

## 4. Store Analytics (`/sales/analytics`, h1 "Sales Analytics")

Same series ×2. Segmented **Day / Week / Month** + span buttons; range text `2026-09-10 — 2026-10-09`; card "Sales by store" (`30 days to … · N of M stores trading · faint bars are the 30 days before`), five tiles (rank the bars), **Gaining** / **Losing ground** (≤5 stores each, sentence `No store took more than/less than it did in the span before.`), **Filter** (FilterPanel on Takings/Transactions/Avg/Units/Store) and the table `Store · Trend · Takings · Share · Vs Before · Transactions · Avg Transaction · Units · UPT` (sortable headers, default Takings high→low). Row → `WindowSheet` via `?store=`.

## 5. Returns, Member, Shop Floor

- **Returns** (`GET /api/v1/returns`, cursor): KPIs **Returns / Refunded**; empty `Nothing has been taken back yet. A return is raised against a completed sale, from that sale's own record.`; filter chips Store, Taken by, When, Refunded; sheet (Facts Store/Taken by/When/Against, Why, What came back, Refunded with, ladder). *Rig has no return* (a till return has no sync fact).
- **Member** (`GET /api/v1/customer/{id}/summary|transactions|transactions/{sale}`): prompt `Type a member id above. …`, textbox (no accessible name) + **Look up** → `?member=`; banner `Reading <id>. Points are what this member has earned …`; tiles **Purchases, all time · Charged · Promotions took off · Points earned · Average basket**; table `When · Store · Items · Saved · Points · Charged` (25/page, includes VOIDED sales — see bugs); unknown id → `That member holds a card and has not used it yet — …`; row → basket sheet (Facts Store/When/Items/Points, Basket Item·Quantity·Shelf Price·Charged, `PROMOTION` tag, ladder).
- **Shop Floor** (`GET /api/v1/sales?limit=500` + returns): "Tills left open" queue (`Every till is square — nothing is sitting open.`), tiles **Tills open · Owing on them · Stores trading · Sales held · Takings · Refunded**, "Latest back over the counter", "Where the fleet stands" (Store · Tills Open · Takings, raw `store-01`).

## 6. Receipt sheet (`?sale=<id>`)
Centre sales (`SaleDetail`: tabs Sale / Receipt / Pricing / Refund) or store sales (`GET /api/v1/shop-sales/{id}`): facts **Rang at · Reached Cloud · Discount · Points earned**, Items, Promotions, Paid with, ladder Paid/Change/Total, `Cloud sale ID: …`. The shop-sale payload has **no status**, so a voided sale reads like a normal one.

## 7. Rig facts that shape the tests
- One trading store (store-01 "Cikupa" / "Store 01", till KASIR-1); S1–S9 from `scripts/demo_stages/sales.py`; members 081311110001 (Sari) and …0002 (Budi); campaigns "Diskon 15% Sandal & Sepatu" / "Diskon 10% Koleksi Wanita". The POS suites keep selling and voiding (75+ voided of 94 at one point) and other agents added stores c017–c032 (32 stores now) — **no figure is hard-coded**: every comparison reads the API, then the screen, then the API again, and only trusts a pair of API reads that agree (`agree()` in support/sales.ts).
- Explorer summaries lag the live tables slightly (`pending_days`); the series/window endpoints read the live tables.
- The cloud and the hub were restarted/rebuilt under the run: the hub on :5580 is a `vite preview` of `/home/hari/hub-dist`; at 22:39 UTC that build was **from HEAD (no Explorer, `/sales` → "Sales by Store")**, not the working tree.
