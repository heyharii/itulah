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

- `stack` is **the engine's own ranking** (`price_stacks` → `PriceIndex::ranked`, `price.rs:256`). Render in that order. Never re-sort.
- `rank 0` is what the till charges. Others are the losing candidates — show them, dimmed.
- `min ≠ max` means the article is priced per size; show as a range. `in_force_for` says how many SKUs that candidate actually wins.
- The winner is `(publication_version DESC, level rank DESC, effective_from DESC)` (`price.rs:137`). Newest book beats a shop-specific price from an older book — by design.
- **Scheduled prices are invisible in the "now" view** because `ranked()` applies `covers(at, from, to)`. Two options; do the second: a date picker "lihat per tanggal", **or** a per-cell indicator "↑ 150.000 mulai 16 Sep". The indicator needs a second `article-prices` call with `at` = next book's `effective_from`, or a small backend addition returning `upcoming` per cell (§6.3).

### 2.2 Layout
- Rows = articles (left, sticky): image thumb, `article_code` mono `text-id`, name, `division_code` tag, `sku_count`.
- Columns = shops from `shops[]`. The column model is data — never hard-code shops.
- Cell = rank-0 price (`money()`), source chip (`describeSource()` from `queries/commercial.ts`), `v{publication_version}`, and a small "N more" affordance when `stack.length > 1`.
- Cell tone: `MARKDOWN` → warn tint; a shop whose rank-0 `publication_version` is below the max across the row → "behind" mark (this is what Across shops did; keep it).
- Row summary pill: "Same everywhere" / "Differs by shop" — **compare only when `shops.length > 0`**. `across-shops.tsx:118` computes `agreed = prices.length > 0 && …`, which paints "Differs by shop" on every row when there are zero shops. Do not carry that over.
- Toolbar: channel `Segmented` (all three), search (article code / name, client-side over the loaded page), "Priced as at" `datetime-local` (`instantOf()`).
- Cap: server clamps `limit` to 1..2000; default 200. Show the "N of M" banner when capped.

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

**The server refuses three shapes on purpose** (`commercial.rs:225` `refuse_what_the_fleet_cannot_honour`): tier-scoped prices, `Effect::Margin`, cumulative conditions. Grey them out with the reason; do not hide the error.

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
