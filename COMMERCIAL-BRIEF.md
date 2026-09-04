# Commercial rebuild — implementation brief
Three menus replace seven · `/Users/hari/itulah/frontend-hub/src/screens/commercial`

Decided 2026-09-02 with the owner. Everything in §0 is settled; do not re-litigate it mid-file. Read `frontend-hub/PATTERN.md` and copy `src/screens/procurement/purchase-orders.tsx` before writing a screen. Every fact below was verified against the running code that day — file:line references are exact.

---

## 0. Rulings

| Question | Ruling |
|---|---|
| How many menus | **Three**: Pricelist · Promotions · Campaign. Nothing else in the sidebar. |
| Price books | **Not a menu.** The book survives as the unit of publication underneath — the "Terbitkan" button wraps pending edits into one book. Legacy's `snapshots/publish` is the model. |
| Prices (per-SKU list) | **Not a menu.** Becomes the drill-down when a Pricelist cell is opened. |
| Across shops | **Not a menu.** It *is* the Pricelist grid — same endpoint, rendered as a grid instead of cards. |
| Fleet | **Not a menu.** "Sudah sampai ke toko: A, B, C" is shown on the book that carries a price or a promotion — on Pricelist *and* Promotions, from the same `activated_by` data. |
| Simulate | **Not a menu.** Optionally a "Coba" button inside the promotion form (it is the only place `rejected_rules` explanations exist). Owner said remove; keep the button only if it costs nothing. |
| Overview | **Not a menu.** Its KPIs move to the Performa tab of each menu. |
| Markdown | Lives **inside Pricelist**, never under Promotions. A markdown *replaces* the base price; a promotion *reduces* what is charged. Folding them together inflates revenue and discount in every report (`backend/crates/pricing-engine/src/price.rs:79`). |
| Markdown vs fixed price | Decided by **duration, not direction**. Markdown = temporary, keeps `base_unit_price_minor` visible. Fixed price = permanent, moves the base. The engine only refuses a negative price (`backend/src/cloud/postgres/commercial.rs:396`); a markdown above base is legal. The UI uses direction as the *default* choice only. |
| Coupons | Inside Promotions, as a tab. A coupon is a gate on a rule (`commercial_coupon.rule_id`), never a thing on its own. |
| Vouchers | **Out of scope, deliberately.** Stored-value vouchers are tender, not pricing (`pricing-engine/src/lib.rs:41`). Legacy's `percent_off`/`free_item` vouchers are already our coupons. |
| Performance | A **Performa tab in each menu**, not a fourth menu. Sources in §5. |
| Money | Minor units are whole rupiah. Integers end to end; `money()` from `@/lib/format` draws them; `minorOf()` parses input. Never a float on a price. |
| Channels | STORE · ONLINE · MARKETPLACE everywhere. `across-shops.tsx:21` currently shadows the exported `CHANNELS` with a two-entry local — do not carry that over. |

---

## 1. Dev-environment blockers — fix first or every screen is empty

These are why `/commercial/prices` shows nothing today. The backend prices fine; the UI cannot name a shop.

1. **No STORE origin.** `sync_origin_credential` in `inventory_tanstack` holds one row: `dc-01-edge / DC / dc-01`. Both `commercial_activation` (`commercial.rs:1082`) and `article_prices` (`commercial.rs:1656`) filter `node_role = 'STORE'` → zero shops → empty picker, empty grid columns. Register a STORE origin (site `store-01`) before building.
2. **Cloud rejects the edge's own site id.** `backend/src/cloud/domain/ids.rs:57` accepts only `dc` or `store-NN`; `backend/src/edge/domain/inventory/ids.rs:75` accepts `dc-<anything>`. So `?site_id=dc-01` → `400 site id must be 'dc' or 'store-NN'`. Either align the two validators or make sure every origin's `site_id` satisfies the cloud rule. Do not paper over it in the UI.
3. **Stale binary.** The `cloud` process on :8080 started before `target/debug/cloud` was rebuilt; `/api/v1/commercial/products` (route at `http/mod.rs:157`, commit 961d662) returns 404 on it. Restart the backend.
4. **No sales in dev** (`edge_sale` = 0 rows). Performa tabs can be built but not seen; seed or run a till sale.
5. **The committed tip does not build from a clean checkout.** `backend/src/edge/sqlite.rs:171` (already in HEAD) does `include_str!` on `migrations/sqlite/0021_retire_what_no_customer_carries.sql`, and that file is **untracked**. Any worktree, CI, or the Render autodeploy on push will fail at that line. `git add backend/migrations/sqlite/0021_retire_what_no_customer_carries.sql` must travel with the next backend commit.

*Status 2026-09-02, after the build:* items 1 and 3 are handled in dev — origin `store-01-edge` (STORE, `store-01`) was registered via `POST /api/v1/sync/origins` with the `x-sync-key` from `.env`, and the process on :8080 was still the stale one (product picker degrades to an empty state naming the endpoint). Items 2, 4, 5 remain. Verification also published books **v2–v8** under actor `development` (two markdowns, a promotion plus its pause and resume, a campaign, and a `store-02`-only markdown); keep as sample data or delete.

---

## 2. Pricelist — the grid

**Question it answers:** what does every article cost at every shop, right now, and why.

### 2.1 Data — already complete, no backend change for read
`GET /api/v1/commercial/article-prices?channel=STORE&at=<iso>&limit=200` (`commercial.rs:1656`). Hand-written types in `frontend-hub/src/lib/queries/commercial.ts` (`ArticlePrices`, `ArticlePriceRow`, `ArticlePriceShop`, `ArticlePriceRule`).

```
shops:  [{ site_id, label }]                      → column headers
items:  [{ article_code, article_name, image_url,
           division_code, tags, sku_count,
           shops: [{ site_id, label,
                     stack: [{ rank, source, applies_to, markdown_id,
                               currency, publication_version,
                               min_unit_price_minor, max_unit_price_minor,
                               sku_count, in_force_for }] }] }]
article_count, total_article_count               → "showing N of M", never imply complete
```

- `applies_to` is an **object**, `{ level: "COMPANY"|"SITE"|"SITE_GROUP"|…, site_id?, site_ids? }` — not a string. The first draft of this brief and the hand-written TS both had it as `string`, which rendered `[object Object]`; the TS is now correct. Do not "fix" the server to emit a string.
- `stack` is **the engine's own ranking** (`price_stacks` → `PriceIndex::ranked`, `price.rs:256`). Render in that order. Never re-sort.
- `rank 0` is what the till charges. Others are the losing candidates — show them, dimmed.
- `min ≠ max` means the article is priced per size; show as a range. `in_force_for` says how many SKUs that candidate actually wins.
- The winner is `(publication_version DESC, level rank DESC, effective_from DESC)` (`price.rs:137`). Newest book beats a shop-specific price from an older book — by design.
- **Scheduled prices are invisible in the "now" view** because `ranked()` applies `covers(at, from, to)`. Two options; do the second: a date picker "lihat per tanggal", **or** a per-cell indicator "↑ 150.000 mulai 16 Sep". The indicator needs a second `article-prices` call with `at` = next book's `effective_from`, or a small backend addition returning `upcoming` per cell (§6.3).

### 2.2 Layout — the table grammar is `~/newton`'s

*Revised 2026-09-02 by the owner, after the first build read as untidy.* The reference is `/Users/hari/newton` — `components/primitives/RecordsTable.tsx` with `app/globals.css` `.records-table`. What was lifted, and why each part matters for a matrix:

| Newton | Here |
|---|---|
| `border-collapse: separate; border-spacing: 0`, `table-layout: fixed`, `<colgroup>` widths | same — a column keeps its width as rows scroll |
| **`border-right` on every cell**, none on the last | same — a matrix is read *across*; without vertical rules the eye loses which shop a figure belongs to mid-row. This was the single biggest cause of "tidak rapi" |
| Fixed row height 35px, `padding: 0 8px` | `h-[2.1875rem]`, `px-2` — every row the same height, no ragged stack |
| `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` | `truncate` on the name |
| Header sticky, **sentence case**, 12.5px, `font-weight: 500`, muted | `text-cell font-medium text-mute` — *not* uppercase micro-caps |
| Sticky first column + `box-shadow: 5px 0 8px -10px` | same, on header, body and footer cells |
| Row hover tint | `group-hover/row:bg-soft` |
| `<tfoot>` calculation row | the sub-total row — see below |

**One line per cell.** The first build stacked price, source tag, version, "N more candidates" and the upcoming price in each cell — four lines of micro-text, ragged row heights, and a version number on every cell naming a thing this app has no screen for. The cell now shows **the money and nothing else**, right-aligned, `tabular-nums`. Everything else is one click away in the drill-down, and reachable without a click via the cell's `title` and an `sr-only` sentence.

Two markers survive in the cell, both only when they are true:
- **`v{n}` in warn colour** when this shop's rank-0 book is older than the newest on its row. On every cell the version was decoration; on the one cell that is behind, *which* book it is stuck on is the answer.
- **`↑` / `↓`** when a scheduled book changes this price. The figure and the date are in the tooltip and the panel.

Markdown tints the cell `bg-warn-bg`; a pending unpublished edit strikes the old figure and prints the new one in `accent`.

**The sub-total row** (`<tfoot>`, sticky to the bottom of the scroll, newton's calculation row): article count in the sticky column, and per shop **"N on sale"** — how many of the styles shown that shop is currently clearing. A count, never a sum: adding prices across styles answers nothing.

**Removed by the owner, 2026-09-02:**
- The **"Across the fleet"** column (the Same-everywhere / Differs-by-shop pill). The comparison it drew is visible in the row itself now that the row is one line of figures. `agrees()` went with it.
- The **channel picker**. `ONLINE` and `MARKETPLACE` are real in the engine but nothing trades on them, so the control offered two always-empty answers. `CHANNEL` is now a module constant; the queries still take it as an argument, so restoring a `Segmented` is one edit when a second channel starts trading.
- The **"priced as at" date filter** and its banner. The `at` parameter remains on the endpoint and on `CellSheet`; only the control is gone.
- The **"N shops have never put any book into service"** banner, with the `commercialFleet` query behind it. The same fact is in each cell's drill-down under "In service at", against the book that actually carries the price.

### 2.3 Drill-down (replaces the old Prices screen)
Open a cell → `Sheet` with the full stack, then the per-SKU rows for that article at that shop from `GET /api/v1/commercial/offers?site_id=&channel=&at=` (`commercial.rs:1014`) filtered client-side by `article_code`. Row click → `GET /api/v1/commercial/offers/resolve?sku_id=&site_id=&channel=&at=` (`commercial.rs:926`) for the single-product answer; the old `prices.tsx` `PriceSheet` is the reference, including its "drifted" banner when list and resolve disagree.

### 2.4 Editing — one cell, two intents
Popover on a cell (and on a multi-selection):

```
Harga baru   [ 95.000 ]
◉ Obral sampai [ 30 Sep ]     ← default when typed < base
○ Harga tetap                 ← default when typed > base
```

- **Obral (markdown)** → one `CommercialMarkdownInput` per selected cell: `{ markdown_id, article_code, site_id, replacement_unit_price_minor, priority, effective_from, effective_to }`. Article-wide, so a cell = one row. Backend ready today.
- **Harga tetap (price rule)** → `CommercialOfferRuleInput` needs **`sku_id: Uuid`** per SKU (`backend/src/cloud/application/mod.rs:437`). A cell of 3 SKUs = 3 rows. `article-prices` does **not** return `sku_id` per cell → §6.1 is a prerequisite. A book that sets prices must also carry ≥1 `tax_rules` entry (`commercial.rs:351`); copy the tax category the cell currently shows.
- Multi-select: shift-click / drag over cells. Same popover, applies to all.
- Pending edits live in screen state and render as a bar above the grid: **"12 perubahan belum diterbitkan · Batal · Terbitkan"**.
- **Terbitkan** → name + `effective_from` (+ optional `effective_to`) → `POST /api/v1/commercial/publications` then `POST /publications/{id}/publish`. Two calls because they are two decisions (draft vs approved); the UI may chain them behind one button but must surface a failure between them. Reuse `createPriceBook` / `publishPriceBook` in `queries/commercial.ts`; extend `CreatePriceBookRequest` to carry `offer_rules` + `tax_rules` (today it carries only `markdowns`).
- After publish, show `PublishReceipt.delivered_to`. **Empty list is the important case** — published, reaching no till.
- Validation the server enforces (`commercial.rs:268`): book must change something; markdown must name a sku or article; price ≥ 0; unique `markdown_id`; tax rules iff prices. Mirror the cheap ones client-side; let the server be the authority.

### 2.5 "Sudah sampai ke toko"
Per book: `GET /api/v1/commercial/publications/{id}` → `activated_by[]` (`origin_id, site_id, activated_at, reported_at, price_rule_count`). Show on the publish receipt and in the cell drill-down for the book that rank-0 came from. The gap between `activated_at` (shop clock) and `reported_at` (centre clock) is the number to watch.

---

## 3. Promotions

**Question it answers:** which offers exist, what each has cost, whether it is live, and where it has reached.

Rows look like the reference screenshot (toggle · name · status pill · budget · spend · results), minus ad-network columns.

### 3.1 Data
- List: every `rules[]` across `GET /publications` → `GET /publications/{id}` (`BookRule { rule_id, name, status, priority, definition }`). `definition` is `pricing_engine::Rule` serialised — render it, do not re-derive it. Until a list endpoint exists (§6.4) this is N+1 over books; acceptable at current scale, note it.
- Cost/usage: `GET /api/v1/commercial/usage` (`commercial.rs:1161`) → `PromotionUsage { kind: RULE|CAMPAIGN|COUPON, key, name, uses, spent_minor, budget_minor|null, max_uses|null, customer_count, first/last_used_at }`. `budget_minor: null` is unlimited — **never draw it as a full bar** (`Meter` component). A rule that has never fired is absent, not zero.
- Reach: `activated_by` of the book carrying the rule (§2.5).

### 3.2 Columns
Toggle (§3.4) · name · `Pill` status · scope summary (from `definition.scope.applicability`: "3 SKU" / "Artikel ART-TSHIRT" / "Divisi menswear" / "Tag lebaran" / "Seluruh keranjang") · effect summary (from `definition.effect.kind`: `PERCENT` "20%", `AMOUNT`, `FIXED_UNIT_PRICE`, `FREE_ITEM` "beli 2 gratis 1", `EARN_POINTS`) · budget · spent (`Meter`) · uses · reached ("3 toko" / warn when `activated_by` is empty).

### 3.3 Tabs
`SubTabs`: **Promotions** · **Coupons** · **Performa**. Coupons: `BookCoupon { code, rule_id, active, customer_id, valid_from, valid_to, max_uses }` joined to its rule name; usage from `PromotionUsage` where `kind = COUPON`.

### 3.4 Form (new rule) — shape is the engine's `Rule` (`pricing-engine/src/rule.rs:438`)
Fields worth a control: `name`, `campaign_id` (select from campaigns), `scope.applicability` (`on: SKU|ARTICLE|DIVISION|TAG|WHOLE_CART` + the set), `scope.customer` (`who: EVERYONE|MEMBERS|TIERS`), `conditions` (min qty / min amount / window / days / hours), `effect` (`kind` + its fields), `coupon_code`, `caps { budget_minor, max_uses, max_uses_per_customer }`, `priority`, `stacking`. Product/article picker: `GET /api/v1/commercial/products?q=&limit=` (`commercial.rs:1942`, returns `sku_id` + current price; 404 until the binary is restarted — §1.3).

**Three shapes are being removed from the engine, not merely refused.** The backend session's uncommitted edits to `backend/crates/pricing-engine` delete `Effect::Margin`, `PriceLevel::Tier`, `CustomerScope::Tiers`, `Conditions.cumulative`, `PricingContext.customer_tier` and `CartLine.manual_unit_price` — the shapes `refuse_what_the_fleet_cannot_honour` (`commercial.rs:225`) used to gate. The form therefore offers **no control for them at all**: effects are `PERCENT · AMOUNT · FIXED_UNIT_PRICE · FREE_ITEM · EARN_POINTS`; customer scope is `EVERYONE · MEMBERS`. `PriceSource` will lose `TIER_PRICE` and `MANUAL_OVERRIDE`; `describeSource()` keeps its pass-through default so a retired rung on an old sale line still renders as its raw string.

Save = a book with `rules[]` (+ `coupons[]`, `campaigns[]`) → `POST /publications` → `/publish`. Same Terbitkan flow as §2.4.

### 3.5 Toggle (live ↔ paused) — **no endpoint exists**
`RuleStatus` and `CampaignStatus` are engine concepts; the cloud has no route to change them after publish (`grep campaign http/mod.rs` → nothing; `commercial_campaign.status` is written only at create). The edge holds its own copy, delivered by the book dispatch, so a status flip **must** be dispatched too. Ruling: the toggle **publishes a one-line book** restating the rule/campaign with the new status — versioned, dispatched, auditable, zero new backend. Verify `validate_publication_request` (`commercial.rs:268`) accepts a rules-only / campaigns-only book (the "book must change something" check at `:61` lists markdowns; confirm `rules`/`campaigns` count too). A dedicated `PATCH …/status` route is a later optimisation, not a prerequisite.

### 3.6 Optional "Coba"
`POST /api/v1/commercial/simulate` (`commercial.rs:1462`) with a sample basket → `SimulateResult { lines, applied_rules, rejected_rules[{reason, explanation}], … }`. `explanation` is `RejectionReason::describe()` from Rust — print it verbatim. The old `simulate.tsx` is the reference. Writes nothing; use `useMutation`.

---

## 4. Campaign

**Question it answers:** what did this envelope of offers cost, what came back, is it within its caps.

### 4.1 Header tiles (the screenshot's row, honestly filled)
| Tile | Source |
|---|---|
| Diskon dilepas | `SUM(edge_sale_promotion.benefit_minor)` where `campaign_id` |
| Transaksi | `COUNT(DISTINCT sale_id)` |
| Omzet keranjang | `SUM(edge_sale.total_minor)` over those sales — **basket-level, influenced revenue** (§8.1) |
| Balik per rupiah (ROAS-equivalent) | omzet ÷ diskon |
| Pelanggan | `COUNT(DISTINCT edge_sale.customer_id)` |
| Pelanggan baru | customers whose first `edge_sale` (`ix_edge_sale_customer_time`) falls inside `valid_from..valid_to` |
Sparkline: per `date_trunc('day', occurred_at)`. Filters: window, `site_id`, compare-to-previous-window (the screenshot's `−8.2%` deltas).

### 4.2 Table
Toggle (§3.5) · name · `Pill` status (`CampaignStatus`: DRAFT · SCHEDULED · ACTIVE · PAUSED · EXPIRED · CANCELLED — a superset of the screenshot's four) · window · budget **total** (there is no daily budget; `caps.budget_minor` is for the whole window) · spent (`Meter`, null = unlimited) · uses / `max_uses` · rules count · reached.

Data: `BookCampaign { campaign_id, name, status, valid_from, valid_to, budget_minor, max_uses, max_uses_per_customer }` from book detail; usage from `PromotionUsage` where `kind = CAMPAIGN`; `commercial_campaign` also carries `spent_minor`, `used` columns.

### 4.3 Detail
`Sheet`: caps and spend, the rules inside it (link to Promotions filtered by `campaign_id`), reach, Performa for this campaign.

### 4.4 Form
`CommercialCampaignInput` — `campaign_id, name, status, valid_from, valid_to, budget_minor, max_uses, max_uses_per_customer`. Rules join a campaign by setting `rule.campaign_id`. A rule is live only when both it and its campaign are (`rule.rs:383`).

---

## 5. Performa — sources (all existing tables; no schema change)

```
edge_sale            site_id, occurred_at, total_minor, discount_total_minor, customer_id
edge_sale_line       sku_code, quantity, unit_price_minor, line_total_minor, price_source, publication_version
edge_sale_promotion  sale_id, rule_id, campaign_id, coupon_code, benefit_minor
purchase_order_line  article_code, unit_price_minor            ← cost, ARTICLE level, cloud only
inventory_projection                                          ← stock on hand, for sell-through
```

| Menu | Per | Metrics |
|---|---|---|
| Campaign | campaign | §4.1 |
| Promotions | rule / coupon | same as §4.1 keyed by `rule_id` / `coupon_code` |
| Pricelist | article × shop | units at each `unit_price_minor`; `price_source = 'MARKDOWN'` vs the period before; sell-through = units ÷ `inventory_projection`; margin = price − `purchase_order_line.unit_price_minor` (article-level, and **only at the cloud** — cost never reaches a shop by architecture) |

New read endpoints (§6.2). Pure SQL over the tables above.

---

## 6. Backend work (small, all read-side except 6.1's shape change)

1. **`article-prices`: return `sku_ids` (or `skus: [{sku_id, sku_code}]`) per cell.** Prerequisite for fixed-price editing (§2.4). `commercial.rs:1656` already loads `sku_codes` per style; add ids in the same query and emit them under each `shops[].stack[]` entry or at the row level.
2. **Performa endpoints**: `GET /api/v1/commercial/performance/campaigns?from&to&site_id`, `…/rules`, `…/pricelist?article_code&site_id`. SQL from §5. `json!()` bodies like the rest of `commercial.rs`; transcribe types by hand into `queries/commercial.ts` as the file's header explains.
3. **Upcoming price per cell** (optional; §2.1): in `article_prices`, also evaluate at the next future `effective_from` and emit `upcoming: { unit_price_minor, publication_version, effective_from } | null`.
4. **Rule/campaign/coupon list endpoints** (optional): `GET /api/v1/commercial/rules` etc. across all published books, so Promotions is not N+1 over `publications/{id}`.
5. **Site id alignment** (§1.2) — a backend decision the owner must make; the UI cannot fix it.

Nothing in the pricing engine changes.

---

## 7. Removed screens and where their job went

| Old | Job | Now |
|---|---|---|
| `overview.tsx` | KPIs, "needs attention" | Performa tabs; the `0 / 0 → "some behind"` false alarm (`overview.tsx:188-196`) dies with it |
| `price-books.tsx` | list, detail, compose markdowns, publish | Terbitkan bar (§2.4); book detail reachable from a cell / rule ("dari buku v3") |
| `prices.tsx` | per-SKU list, resolve sheet | cell drill-down (§2.3) |
| `across-shops.tsx` | article × shop cards | the grid itself (§2) |
| `promotions.tsx` | usage list, "Send counts to shops" | Promotions list; keep the **Send counts** action (`POST /usage/publish`, `commercial.rs:1620`) — a shop enforces a budget from the last count it received |
| `simulate.tsx` | price a basket, see rejections | optional "Coba" (§3.6) |
| `fleet.tsx` | which shop on which book | "reached" column + `activated_by` on detail (§2.5); the "never activated" row (`has_ever_activated = false`) must still be visible somewhere — put it on the publish receipt and as a banner when any STORE origin has never activated |

Delete the files, their entries in `screens/commercial/index.ts`, and the nav items in `screens/commercial/nav.ts`. `shared.ts` (`percent()`) and `parts.tsx` stay if used.

*Done 2026-09-02.* Two shared files were deliberately left alone because another session had them open, and are now stale:
- `frontend-hub/src/lib/search.ts:254` — the "Price books" palette source still routes to the deleted `/commercial/price-books`. Either delete that source, or point it at `/commercial` and keep `sheet: { key: "book" }` only if Pricelist learns to open a book sheet from the URL.
- `frontend-hub/src/lib/sheets.ts:155` — add `campaign: id` beside `book` and `price` (and `campaign: "campaign"` in `SHEET_SUBJECT`), then move the Campaign detail sheet in `campaigns.tsx` from `useState` to `useSheet("campaign")` as PATTERN wants.

---

## 8. Accepted limits (owner signed off; fix later or hand to a follow-up)

1. **Revenue attribution is per basket, not per line.** `edge_sale_promotion` is keyed `(sale_id, rule_id)`; which lines matched is not recorded. A 3-item basket where a promo hit one item counts the whole basket as promo revenue. This is "influenced revenue" — standard, overstated. Per-line needs the edge to record matched lines during sync.
2. **`markdown_id` is not on `edge_sale_line`.** "Which markdown sold this" is a join on `sku_code + publication_version + occurred_at` against `commercial_markdown`.
3. **No sales in dev** — see §1.4.

---

## 9. Order of work

1. §1 blockers (register a STORE origin, fix or satisfy the site-id rule, restart the backend). Half a day; without it nothing renders.
2. **Pricelist grid, read-only** + drill-down. Deletes `across-shops.tsx` and `prices.tsx`. Ships on its own.
3. Pricelist editing: obral (markdown) first — backend ready. Then §6.1, then fixed price. Terbitkan bar. Deletes `price-books.tsx`.
4. Promotions list + coupons tab + reached column. Deletes `promotions.tsx`, `fleet.tsx`. Then the form.
5. Campaign list + detail + form.
6. §6.2 performance endpoints, then the three Performa tabs. Deletes `overview.tsx`.
7. Optional: "Coba" button (§3.6); then `simulate.tsx` goes.

Each step leaves the app usable.

---

## 10. Files

| | Path |
|---|---|
| Screens | `frontend-hub/src/screens/commercial/*.tsx`, `nav.ts`, `index.ts` |
| Queries + hand-written types | `frontend-hub/src/lib/queries/commercial.ts` |
| UI kit | `frontend-hub/src/components/ui/` — `data-table`, `sheet`, `sub-tabs`, `pill`, `tag`, `meter`, `kpi`, `field`, `segmented`, `states`, `rows` |
| Reference screen | `frontend-hub/src/screens/procurement/purchase-orders.tsx` |
| Conventions | `frontend-hub/PATTERN.md`; design rulings `CLOUDHUB-BRIEF.md` §0; design language `~/Documents/retail/cloud-app/ollama/DESIGN.md` |
| Routes | `backend/src/cloud/http/mod.rs:124-157` |
| Handlers | `backend/src/cloud/postgres/commercial.rs`, `pricing.rs` |
| Request shapes | `backend/src/cloud/application/mod.rs:437-500` |
| Engine | `backend/crates/pricing-engine/src/{price,rule,engine,lib}.rs` |
| Legacy for reference only | `~/Documents/retail/web/src/features/commercial/{pricing-rules,campaigns,catalog-workbench/store-price-matrix.tsx}` |
| Dev server | `hub-dev` in `.claude/launch.json` → :5280, API :8080, DB `inventory_tanstack` |

---

## 11. Backend asks — from the build, in priority order

Found while building and verifying the frontend on 2026-09-02. Each is one line the backend session can act on; sizes are honest estimates.

| # | Ask | Why | Size |
|---|---|---|---|
| 1 | `git add backend/migrations/sqlite/0021_retire_what_no_customer_carries.sql` with the next commit | HEAD's `edge/sqlite.rs:171` already `include_str!`s it; clean checkouts and Render fail (§1.5) | 1 command |
| 2 | `#[serde(default)]` on `tax_rules` and `offer_rules` in `CreateCommercialPublicationRequest` (`cloud/application/mod.rs:461-462`) | A markdown-only or promotion-only body is refused at deserialisation with `422 missing field 'tax_rules'`. The old `price-books.tsx` composer never worked because of this; the new client sends `[]` to get past it | 2 lines |
| 3 | `article-prices`: emit `sku_id` per SKU (`skus: [{sku_id, sku_code}]` per row, or under each cell) | Sole blocker for fixed-price editing from the grid — `CommercialOfferRuleInput` is keyed by `sku_id` (§2.4, §6.1) | small |
| 4 | Key `command_deduplication` by `(command_type, idempotency_key)`, not `idempotency_key` alone | Create-then-publish with one key returns `409 … already used with a different command`; the client derives `${key}:publish` as a workaround (`writeAndPublish` in `queries/commercial.ts`) | small |
| 5 | Decide the site-id rule: make `cloud/domain/ids.rs:57` accept `dc-NN` like `edge/…/ids.rs:75` does, **or** re-site the DC origin to a cloud-legal id | `?site_id=dc-01` is a 400 at the cloud; the DC can never be priced or listed (§1.2) | decision + 3 lines |
| 6 | `PATCH /api/v1/commercial/rules/{id}/status` and `…/campaigns/{id}/status`, dispatched to the fleet | Today every pause/resume publishes a whole one-line book (v5, v6 in dev are exactly that). Already in progress per the owner. Swap point is `setRuleStatus` / `setCampaignStatus` → `writeAndPublish` in `queries/commercial.ts` | in flight |
| 7 | Merge the performance endpoints from worktree `.claude/worktrees/agent-a9e8a34ba70ce9db3` (branch `worktree-agent-a9e8a34ba70ce9db3`) after compiling them | §5/§6.2; written, **not compiled**. Use a private `CARGO_TARGET_DIR`; look first at `serde_json::Value` decoding of `series`, `Aggregate::merge_into`, the `undeclared: fn(&str) -> Value` parameter in `stitch`, and the uncompiled `backend/tests/commercial_performance_integration.rs` | verify + merge |
| 8 | `article_prices`: emit `upcoming` per cell (§6.3) | The client pays a second full `article-prices` call at the next book's `effective_from` to draw "↑ price from date" | small |
| 9 | `GET /api/v1/commercial/{rules,coupons,campaigns}` across published books | Promotions and Campaign currently do N+1 over `publications/{id}` (`promotionCatalogue()`), deduped `DISTINCT ON (rule_id) ORDER BY version DESC` client-side | medium, later |

Not an ask: `applies_to` on `article-prices` is an object — that is correct; the brief was wrong (§2.1).

## 12. Frontend follow-ups

- ~~§7's two shared files (`search.ts`, `sheets.ts`).~~ **Done 2026-09-02:** the "Price books" palette source is removed (with its now-unused import), `sheets.ts` has `campaign: id` and a `campaign` subject, and `campaigns.tsx` opens its detail from the URL via `useSheet("campaign")` — verified by deep-linking `/commercial/campaigns?campaign=lebaran-79ce`. `tsc` and `eslint` clean on all three.
- ~~Multi-shop paths are exercised by code only.~~ **Done 2026-09-02:** `store-02-edge` (STORE, `store-02`, "Toko Kemang") registered via `POST /api/v1/sync/origins` — the master key is `SYNC_INGEST_KEY` in the **repo-root** `.env`, not `backend/.env`; book **v8** publishes a `store-02`-only markdown on `ART-CAP` (139.000). The grid then shows two columns, "Differs by shop" on three rows and "behind" on three cells, both by eye. Neither fake origin will ever activate a book, so the "never put any book into service" banner now names both — correct, and worth remembering when reading dev.
- UI strings are English (Publish, Sale price, Fixed price), matching the rest of the hub; the brief's Indonesian words were intent, not copy. Reverse if wanted.
- Fixed-price editing: enable the disabled option once #3 lands; the popover and `CreatePriceBookRequest.offer_rules` plumbing are in place.

---

## 13. Second design pass — 2026-09-02, from the owner reading the built screens

### Pricelist: one article, two prices

The grid was "tidak rapi" and the owner named the cause: a cell held four stacked lines, so rows were ragged and a book version appeared on every square naming a thing this app has no screen for. The fix is structural, not cosmetic.

**Each article is now several rows, one per rung**, with the article name in a `rowSpan` cell and a second frozen column naming the rung:

```
Article                    │ Priced by  │ Toko Bandung │ Toko Bintaro │ … 13 shops
───────────────────────────┼────────────┼──────────────┼──────────────┼
Classic Cap      ART-CAP   │ Pricelist  │  Rp 259.000  │  Rp 259.000  │
  3 SKU                    │ Markdown   │  Rp 129.000  │      —       │
```

- **Pricelist and Markdown are named, always both present.** This is the distinction the owner asked for — they were one orange-tinted cell that never said what the price had been before, which is the one number a clearance is judged by. The markdown row is drawn even when empty, so the two concepts keep the same place on every row and there is always somewhere to click to start a sale price.
- `rungLabel()` calls `COMPANY_PRICE` **"Pricelist"** — the word the business uses and the word on the menu. A narrower base level keeps the engine's name (This shop, Shop group), because when a base price differs the level *is* the explanation.
- **The rung the till charges is `font-medium text-ink`; every other figure in the column is muted.** That, not row order, is what preserves the engine's authority: the display groups two named concepts, it does not re-rank the cascade.
- **No background tint.** Removed at the owner's request; the row label carries the meaning now.
- **No "N on sale" footer.** Removed — the owner asked what it was for, which is the answer.
- **Currency written once in a range**: `Rp 139.000–159.000`. The repeated form was being truncated to `Rp 139.000–Rp…` at thirteen columns, hiding the very number a range exists to show.
- **Two frozen columns** (article, rung) rather than one: with a fleet of thirteen the shops scroll a long way, and a price with no rung beside it is as unreadable as one with no article.
- **Row metrics are the hub's own** `<DataTable>` (`px-3.5 py-2.5` body, `py-[0.5625rem]` head), not newton's raw 35px. Newton is a 16px-root app; at this app's 14.4px root the same declaration renders ~10% denser, which is what "terlalu compact" was.
- Only the **markdown** row is selectable and editable. A base price still needs `sku_id` (§11 #3), and a checkbox on a row that cannot be written to promises something the build cannot do.

Everything dropped from the cell — source, book version, candidates it beat, `in_force_for`, the scheduled change — is in the drill-down, and in the cell's `title` plus an `sr-only` sentence, so none of it needs a click to reach.

### Promotions and Campaign: the column names

The owner asked what "Given away" meant, which is the answer. Renames, applied to both screens so they read as one app: **Given away → Spent**, **Uses → Used**, **Reached → In shops**. The **From book** column is gone — a price book is not a screen any more, so naming one told nobody anything they could act on; it stays on the detail sheet.

**A Coupon column was added to Promotions.** `definition.coupon_code`, drawn as the code or "Open to all". The gate is the most consequential fact about a promotion after what it does: a rule with a code is shut until somebody types it, and without this column an always-on promotion and a coupon-only one looked identical. A coupon-gated rule that has never fired is behaving correctly; an open one that has never fired is a fault.

### Campaign: the performance header

`screens/commercial/performance-header.tsx` — a row of clickable figures with the chosen one drawn as a sparkline beneath, the shape of the advertising console the owner referenced. Reads `GET /api/v1/commercial/performance/campaigns` via the new `lib/queries/commercial-performance.ts` (copied from the endpoints worktree).

The words are deliberately not an ad platform's. An ad platform spends cash to buy attention; a promotion spends margin to buy a basket. So **Discount given · Baskets touched · Basket value · Customers · New customers** — and no ROAS, because two of that console's six tiles cannot be honest here:

- **Revenue attributed to an offer** does not exist: what the server has is the whole of every basket an offer touched (§8.1). The tile is called *Basket value* and says so in its hint rather than being called revenue.
- **Customers and new customers do not sum across campaigns** — the same shopper served by two campaigns would be counted twice, and there is no distinct roll-up. Those two tiles report the largest single campaign, the honest lower bound, said out loud in the hint.

Deltas are against the window immediately before, from the server's own `previous` block — a subtraction, never a second request. `delta()` returns `null` when the previous window was zero: nothing to something is new, not infinite per cent.

The endpoint is not deployed to this node (§11 #7), so the panel currently renders one line saying so, and the list below is live either way. **Every hook runs before that early return** — a `useMemo` after it would change hook order between a loaded and a failed render.

### Dev data

The fleet is now **13 STORE origins** (`store-01` … `store-13`, Jakarta through Yogyakarta), registered via `POST /api/v1/sync/origins`. Two traps for anyone repeating this: the master key is `SYNC_INGEST_KEY` in the **repo-root** `.env`, and `ingest_key` must be **at least 32 characters** or the route answers 400.

Books **v9–v11** give the grid something to show: two shop-specific cap clearances, two shop-specific jacket clearances, and one fleet-wide hoodie markdown that dispatched to all 13. With v2–v8 that is eleven published books; keep as sample data or clear it.

### Two defects the sub-rows exposed, both fixed

Splitting a cell into rungs made a class of bug visible that a single-figure cell had hidden: **comparing a rung against something that is not the same rung.** Both were mine, both were wrong on screen, both are now like-for-like.

1. **The scheduled-change caret.** `later` was keyed by cell and held the *winner* of the future answer. A pricelist row was therefore marked "↓ falling to 129.000" when the pricelist was not changing at all — the future winner was a markdown, which is a different row on this grid and a different fact. The map is now keyed `article@shop|source`.
2. **The "behind" mark.** `newestOnRow()` took the maximum publication version across the whole row, so one shop's two-shop cap clearance dragged every *other* shop's pricelist into looking stale. Eleven cells were flagged; three were real. `newestByRung()` compares a shop's pricelist against its neighbours' pricelist and its markdown against their markdowns. This is the same false positive that was called out against the old Across-shops screen and it had quietly reappeared in a new shape.

Also corrected: `ArticlePriceRule.in_force_for` is declared `string` in `queries/commercial.ts` but the server sends an **integer** (`commercial.rs` `json!`). Nothing crashed — a `!== "0"` guard silently never matched, so "in force for 0" printed on rungs that win nothing. The type is now `number`, and the tooltip reads "in force for 3 of 3". This is exactly the staleness that file's own header warns about; the same check is worth running over the other hand-written shapes.

### Copy that no longer matched the screen

- Page sub said "what each price beat to get there" — nothing beats anything visibly now that a rung is a row. It names the pricelist/markdown pair instead.
- Empty state said "on this channel" — there is no channel picker.
- The upcoming-book banner said "a cell … is marked with a caret"; a caret lands on a *rung* now.

---

## 14. Third pass — one sidebar row, four tabs

*Owner, 2026-09-02, superseding §0's "three menus".* Commercial is now **one sidebar row** whose surfaces are reached by tabs inside the page, in the order the work happens:

**Pricelist → Promotions → Campaign → Vouchers**

They are four readings of one subject, not four places: a merchandiser moves between a price, the offer coming off it, and the envelope that offer is budgeted in within a single train of thought, and a sidebar made each of those a departure.

### How it is wired

- `NavItem` gained `hidden?: boolean` in `lib/navigation.ts`, and `components/shell/sidebar.tsx` filters on it. The three non-home paths are **still declared** — that is what routes them, keeps them linkable, and keeps the command palette honest — but they are not sidebar rows, where they would say what the tabs already say and fight over which highlight is current. This is the one shared-file change; it is additive and no other module sets the flag.
- `screens/commercial/tabs.tsx` — `<CommercialTabs current={path}>`, mounted under the `PageHeader` of all four screens. **Tabs that navigate, not tabs that switch a variable**: each surface keeps its own route, so a link to a promotion still opens on the promotion, back still means back, and a sheet parameter belongs unambiguously to one screen. The search string is dropped on a tab change on purpose — every key in it (`?price=ART-CAP@store-01`) names a record on the screen being left.

### Coupons are not a tab

They are a **gate on a promotion**, never a thing of their own: a rule carrying a code is shut until somebody presents that code. That is the `Coupon` column on the Promotions list and a field on its form. The Coupons sub-tab is gone, and with it `couponColumns`, `CouponLine`, the coupon `useTable` and the memo feeding it — a tab implied a coupon could exist without a promotion to unlock, and one cannot.

### Vouchers are a tab, and are not pricing

A voucher **carries money**. It is tender — it sits beside cash and a card at the counter and is *spent*, where the other three tabs all describe what something *costs*. `pricing-engine/src/lib.rs` says so directly. This reverses §0's "out of scope" at the owner's direction, and the tab exists to hold the distinction rather than to hide it: the system this replaces filed `percent_off` and `stored_value` in one voucher table, and the discount half of that is what this app already calls a coupon.

`screens/commercial/vouchers.tsx` says plainly that nothing in the backend stores a voucher — no table, no route — rather than drawing an empty table, which would imply the feature exists and merely has no rows. **A voucher backend is not in any brief yet**; it is a decision, not an omission.

### Landed alongside

- **Performance endpoints merged** into the main tree on `feat/handheld-rfid` — `cloud/{postgres,http}/performance.rs`, the integration test, and the `mod`/`route` registrations. The Campaign chart lights up as soon as a rebuilt binary runs on :8080; the dev DB still needs re-migrating first (§11 #7).
- **The N+1 fix is in flight**: `GET /api/v1/commercial/{rules,coupons,campaigns}` in a new `catalogue.rs` pair, newest published publication wins, dedup matching `pricing.rs` `load_rules`/`load_coupons`/`load_campaigns`. Until it lands, `promotionCatalogue()` still opens all eleven books one at a time and the screens say so under the table.

---

## 15. Fourth pass — the stack is the rows

*Owner, 2026-09-02:* "orang bingung kalau ada markdown dan pricelist itu yang berlaku yang mana" — and they were right. §13's two named rows, **Pricelist** and **Markdown**, read as two prices of equal standing and left the only question that matters, *which one does the till charge*, for the reader to work out.

**Rows are now the engine's own ranking.** Row 1 is rank 0 at every shop, and rank 0 is by definition what is charged; every row under it was beaten. The rank column says `1 charged`, `2 beaten`, `3 beaten`.

```
Article                 │ Priced by  │ Toko Bandung      │ Toko Bintaro
────────────────────────┼────────────┼───────────────────┼────────────────
Classic Cap    ART-CAP  │ 1 charged  │ SALE  Rp 129.000  │ Rp 259.000
  3 SKU                 │ 2 beaten   │       Rp 259.000  │ v1 Rp 259.000–279.000
                        │ 3 beaten   │ v1 Rp 259.000–279.000 │ —
```

This is strictly better than the named rows, and not only because it answers the question:

- **The kind of price moved into the cell**, as a `SALE` chip. It had to: the same rank can be a markdown at one shop and the company price at the next, which a row label cannot express and a rank number does not claim to. On a fleet of thirteen, "which shops are clearing this style" is what somebody scans the row for, and now it is one glance.
- **It is no longer a display re-order.** §13's layout listed base rungs before markdown for readability, which was a second opinion about a cascade the brief says never to re-sort. Position now *is* rank, straight from `stack[]`.
- `depthOf()` takes the deepest stack on the row (minimum two) so ranks line up across shops; a shop whose cascade is shallower shows `—`.
- Editing is offered on **row 1 only** — a sale price is written against the cell, not against one rank of it, and row 1 is the price somebody is looking at when they decide to cut it.

### Every price is exact

*Owner: "jangan pakai sampai 20000–300000, tapi buat semua harga pastinya."* The ranges were never a rendering choice — the seed priced each size differently (`SKU-01-S` 129.000, `-M` 119.000, `-L` 109.000), so `min_unit_price_minor ≠ max_unit_price_minor` and the endpoint honestly reported an interval.

Fixed in the data, not in the display: book **v12 "One price per style"** publishes 18 `offer_rules`, one exact company price per style across all its SKUs, with the `STANDARD` tax rule the server requires alongside prices. Row 1 is now a single figure everywhere. Ranges survive on *beaten* rows, where they belong — that is what the superseded v1 book actually said, and flattening history would be a lie about it.

Worth knowing for the next seed: a book that sets prices **must** carry at least one `tax_rule` (`commercial.rs:351`), and `offer_rules` are keyed by `sku_id`, so the codes have to be resolved from `sku` first.

---

## 16. Fifth pass — naming, chrome, and the two remaining tabs

### "Priced by" became "Order"

*Owner: "price by nya nama promotion rules nya atau campaignnya atau apa, jangan beaten2 gitu ga jelas."*

The instinct was right and the data settled the shape. **A rank is not uniform across shops**: rank 1 of `ART-CAP` has five distinct sources across the fleet — a markdown from v8 at one shop, one from v2 at another, the company price from v12 at the rest. So a name cannot live in the row label, because the row label has to be true of thirteen cells at once.

What was tried and reverted, in one step, because it is worth not repeating: the book name went **into** every cell as a second line. It read as noise immediately — "One price per style" printed thirteen times across a row is a name that never varies, and a name that never varies distinguishes nothing. It now leads the cell's tooltip, one hover from the cell somebody is actually asking about.

So the column holds precedence, and is called **Order**: `1 in force`, then a bare `2`, `3`. "Beaten" is gone — it was accurate and unclear, which is the worst combination for a word nobody chose. Row 1 says what it is; the rows below need no adjective, because being under row 1 is the whole statement.

Markdown is distinguished in the cell by a `SALE` chip, which is where the distinction has to be for the same reason the name is: it varies shop by shop within one row.

### The module's sidebar is gone

`Sidebar` returns `null` when the active module would draw fewer than two rows. Commercial navigates itself by tabs, so its sidebar had one entry repeating the module name that the workspace chip directly above it already carries — a panel whose whole content is its own title. This is a general rule, not a Commercial special case; no other module trips it today.

### The tab strip stopped moving when clicked

`.vt-page` names the content area for the view transition, and the tab strip lives inside it — so every tab click faded and slid the tabs along with the screen they switch. The one element that must look like it answered the click was animating away from the click. `.vt-tabs` gives the strip its own `view-transition-name` and holds it, exactly as the rail and sidebar are held.

### The chart is on Promotions too

`<PerformanceHeader of="campaigns" | "rules">` — one component, because the measurement is identical (`edge_sale_promotion` keyed by campaign or by rule) and two copies would be two chances for the arithmetic to drift. Mounted on both screens. Still reports "not on this node yet" until the merged endpoints are running on :8080.

### Vouchers has a New voucher button, disabled

Present and disabled with the reason in its tooltip, rather than absent: a missing button reads as unfinished, a disabled one that says why reads as a decision. The empty state now names the three pieces in order — somewhere to hold a code and a balance, a command that issues one **and books the liability**, and a tender type at the till that redeems against it. The third is why this tab sits apart: a voucher is paid *with*.

### Housekeeping

The finished endpoints agent left a 3.6 GB `CARGO_TARGET_DIR` in the scratchpad and the machine hit 100% disk mid-session. Deleted. **Delete a private target dir when its agent reports** — the machine has under 20 GB spare at rest.

---

## 17. The charts are live — and what it cost to get there

### What runs now

`GET /api/v1/commercial/performance/{campaigns,rules,pricelist}` all answer 200 against `inventory_tanstack`, and both charts draw. Dev data was seeded to make them show something: **48 sample sales** over twelve days across four shops, attributed to `rule-51ce5711` / campaign `lebaran-79ce`, all carrying `origin_id = 'SEED-DEMO'` so they can be found and removed with one predicate.

The binary serving them is **not** the main tree's. The main tree does not compile — two breaks, both other sessions' uncommitted work in progress:
- `backend/src/edge/pricing.rs:470` — a coupon tuple destructured as 7 where the query now returns 8.
- `backend/src/cloud/postgres/articles.rs:687` — `ArticleDetail` is deserialised but does not derive `Deserialize`.

Neither was touched. Instead the binary was built in a throwaway worktree at HEAD plus the two `performance.rs` files, the `mod`/`route` registrations, and the working tree's migrations copied in: `/tmp/perfbuild` building to `/tmp/perfbuild-target`, running on **:8096**. `.claude/launch.json`'s `hub-dev` now points `VITE_API_TARGET` there. **Both are temporary** — point it back at `:8080` and delete the worktree once the main tree compiles.

Config note for anyone repeating this: the listen address is `BIND_ADDR` (`backend/src/lib.rs:12`), and `.env` sets it, so `PORT=8096` is ignored — the process silently tries to bind 8080 and dies on "address already in use".

### An incident, and the bridge that is holding the dev DB together

**Starting that binary migrated the dev database forward, and broke every running node including the one another session was using.** `MIGRATOR.run` applies whatever the binary embeds; this one embedded the working tree's `0080`–`0086`, of which the database had only reached `0084`. Two of those drop columns:

- `0080` → `commercial_price_rule.tier`, `commercial_markdown.tier`
- `0086` → `commercial_coupon.used`, `commercial_campaign.{used, spent_minor, max_uses_per_customer}`

Every binary currently running still `SELECT`s them, so `GET /commercial/publications/{id}` began returning 500 on **:8080 as well as :8096** — the Commercial screens showed "database operation failed" under a working chart.

Restored by re-adding all six columns nullable/defaulted. This is a **bridge, not a schema decision**: the migrations are correct and the code that stops reading these columns is written but not built. When it lands, the columns are simply unused, `0080` and `0086` are already recorded as applied, and nothing re-drops them. Should that code be abandoned instead, re-run the two `DROP COLUMN` statements by hand.

**The lesson worth keeping:** on a branch where several sessions hold uncommitted migrations, running any binary against the shared dev database applies all of them at once. Point a throwaway binary at a throwaway database — the earlier endpoints agent did exactly that with a `pg_dump` copy, and was right to.

### Disk

The machine hit 100% twice; the second time the Bash tool itself could not run, because it could not create its own output file. `cargo` target directories were the whole of it — `backend/target` alone was 21 GB, and two agent scratch targets held 5 GB more. The owner cleared `~/Documents/fresh/target` and `~/Documents/retail/final-product/backend/target`. **Delete a private `CARGO_TARGET_DIR` the moment its agent reports**, and expect a full backend build to want ~20 GB.

---

## 20. Two defects the owner spotted, and where they came from

### The table header scrolled away

`components/ui/data-table.tsx` owns its own scroll container but its `<th>`s were not sticky, so forty rows down a reader had columns of figures with nothing naming them. Fixed at the source — `sticky top-0 z-10 bg-canvas` — which repairs **every list in the app**, not just Commercial. Two details worth keeping: the rule goes on `<th>` and not `<thead>` (a sticky `thead` does nothing in a table; the cells are what stick), and it must be opaque or rows show through as they pass underneath.

The Pricelist grid had this from the start, which is why the inconsistency was visible: two tables side by side, one holding its header and one not.

### Promotions had no detail sheet

Campaign had one and Promotions did not, so its list read as the end of the road: a rule's scope was a phrase in a column and its **conditions were nowhere at all** — and "what has to be true before it fires" explains a promotion that has never fired far more often than its scope does.

`PromotionSheet` now opens on row click, keyed `?rule=<rule_id>` through a new `rule` key in `lib/sheets.ts`. It reads the engine's own `definition` document — effect, scope, campaign, customer scope, coupon gate, caps against spend, the four conditions, and "In service at" with the loud empty case. Nothing in it derives a second opinion about what a rule does.

*Surveyed while there:* 49 screens use `<DataTable>`; 18 have no row click. Most are correct — `inventory/overview`, `finance/reports`, `system/activity` and the like are summaries with nothing to open. `commercial/pricelist` is also correct: it is a matrix whose click target is a cell, not a row. Promotions was the one that was simply missing.

### And the last book numbers

`from book v7` in the campaign sheet and `v7` beside "In service at" became the book's **name**. That was the last of them; a search for `book v` across the module now finds nothing.

---

## 15. Fourth pass — pushing a new price, 2026-09-04

*Owner: "kita bisa nambah harga baru ya, ubah harga ga usah, sistemnya push new harga aja"* — and
that is what the engine already does, said out loud for the first time on a
screen. There is no amend anywhere in this system: a book is a list of changes,
`better()` ranks by publication version before scope, so the newest book naming
a product simply wins and the figure underneath stops being reached. Nothing
retires it. So the verb is **push**, the record is always new, and July's price
stays in July's book — which is the only reason "what did this cost then" is
answerable at all.

### The blocker in §11 #3 had already dissolved

`article-prices` still carries no `sku_id` (verified: `collapse()` emits
`sku_codes` and nothing else). But `GET /api/v1/commercial/products` — written
for the promotion form — searches by **article code** as well as SKU code and
name, and answers with `sku_id` *and* the product's current company price. One
extra call per style is the whole of what the "sole blocker for fixed-price
editing" needed. Ask #3 is now an optimisation, not a prerequisite.

### `screens/commercial/price-form.tsx` — the composer

Reached two ways, because the two questions arrive differently: **New price** in
the page header (a price being decided), and **New price for these** on a cell
selection (a price being read and then changed). The second seeds the form —
styles become the products offered, shops become the level named — and the sale
sheet's second radio, disabled since the first build, now hands over to it with
whatever figure was typed.

What it offers, all of it the server's own shape:

| Control | Field | Why it is there |
|---|---|---|
| Product picker | `sku_id` per row | a base price is per product; a style priced per size keeps its spread, and any row can be given its own figure |
| Every shop · One shop · Some shops | `site_id` / `site_ids` / neither | `PriceLevel` Company (0) · SiteGroup (1) · Site (2). A group is **one row naming several shops**, not a row per shop — a branch added to the group later is priced by it |
| May be sold | `sellable` | authored with the price because the publish check refuses one without the other |
| Tax class · rate · reading | `tax_rules` | derived from the prices themselves, so "a book with prices needs one" and "a book without prices may not have one" are both satisfied without anybody choosing |

Markdowns and prices collect in **one bar** and travel as **one book** —
`CreateCommercialPublicationRequest` takes `markdowns` and `offer_rules` side by
side, and two publishes for one decision would mean two version numbers and a
shop applying half of it first.

### Four things deliberately not offered, each with its reason on screen

1. **Dates on a price.** `commercial_price_rule` has no `effective_from`;
   `load_site_price_book` reads the *publication's* window for every price in
   it — "A publication states validity once, for the whole price book". So when
   a price starts is one decision, taken at Publish. A cut that must end on a
   date is a markdown, which does carry its own dates and hours.
2. **Online and marketplace.** The publish check derives its channels from the
   book (`SELECT DISTINCT channel FROM commercial_price_rule WHERE
   publication_id=$1`) and then demands a company-wide price for **every active
   SKU** in each — 2 740 of them today. An online price for six styles would
   write a book, take the next version number and then refuse to publish. The
   options are in the select, disabled, with that sentence under them.
3. **A figure in the grid cell for a pending price.** A base price is per
   product; eight sizes at one shop are eight amounts and a cell holds one.
   Affected cells get a dot; the figures are in the publish sheet, a line each.
4. **Two rates under one tax class in one book.** A category is unique per book,
   so the `Map` that derives `tax_rules` would silently keep one and file both
   prices under it. Refused at the button instead.

### The collision worth knowing

`commercial_price_scope_unique` is on `(publication_id, sku_id,
COALESCE(site_id,'*'), channel)` — so a **fleet price and a group price for the
same product cannot share a book**: both store `site_id = NULL`. The pending
list is keyed the same way, so the second replaces the first in the bar rather
than being refused by the server after the book has been written.

### Verified 2026-09-04, end to end on `hub-run` (:5285 → :8080)

- **v16** by hand: a group price on ART-0003 for `store-01, store-05, store-11`.
  Published, `delivered_to` exactly those three edges, and `article-prices` then
  reports `SITE_GROUP_PRICE` at 289.000 for three shops and `COMPANY_PRICE` at
  329.000 for the other ten.
- **v17** through the UI: cell → *New price for these* → the composer opened
  seeded with all 8 SKUs of ART-0001 and Toko Bandung → one SKU overridden to
  179.000, seven at 199.000 → published. Receipt: one shop (`store-07-edge`).
  The grid now reads `Rp 179.000 +1` in that cell and 219.000 everywhere else,
  and the stack is `rank0 v17 SITE_PRICE in_force 8/8 [179.000 ×1, 199.000 ×7]`
  over `rank1 v15 COMPANY_PRICE`.

Keep both as sample data or clear them; that is thirteen books plus these two.

*Gates:* `tsc`, `eslint`, `design-lint`, `prettier` clean on the four changed
files; `endpoint-audit` 195/196 (`/api/v1/sync/ingest` is node-to-node and has
never been a UI route).
