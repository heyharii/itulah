# Marketing → POS chain: read-only code review

Repo `/Users/hari/Documents/itulah`, working tree as of 2026-10-20 ~12:15Z (branch `handheld-rfid`, many uncommitted edits by other sessions, reviewed as-is).
Question: does every marketing feature head office can create in the hub actually work correctly at the till (desktop/web `pos-desktop/ui` and Android tablet)?

Method: read the hub forms → cloud validation/publish/dispatch → edge apply → `pricing-engine` → edge quote/sale → sale fact → cloud apply, plus both tills. Live rig was read only (`sqlite3 -readonly runs/demo/store-edge.sqlite3`, `psql … SELECT`). No builds, no writes.

Short answer: **no.** Plain automatic promotions (percent, amount, fixed price, buy-X-get-Y) on article, division, tag or whole-basket scope work on both tills, and limited coupons and vouchers work on the desktop/web till when it is online. But:
- several options the hub offers do nothing, or make the offer dead at every till: "Scheduled" campaigns, "Max. per shopper", "Blocks offers on its items", unique coupon sets;
- frozen promotion eligibility has three defects: SKU-scoped promotions widen to whole articles, the frozen sets are not delivered to shops, and scope edits to a running promotion are ignored;
- two voucher paths can stop a store's whole sync stream at head office;
- the tablet has no coupon, member, voucher or points path;
- POS returns never reach head office, so points are not reversed and voucher-paid goods are refunded in cash.

Confidence tags: **CONFIRMED** means both sides of the seam were read (and, where noted, the live rig data shows it). **PLAUSIBLE** means the logic was read but depends on runtime behaviour that was not exercised.

---

## (a) Feature matrix

Legend: works / partial / broken / missing / n/a. File refs are to the line where the behaviour is decided.

| # | Feature (what HO can create) | Cloud (author → validate → publish) | Edge engine | Desktop/web till | Tablet | Verdict |
|---|---|---|---|---|---|---|
| 1 | Percent off | rule-form.tsx:494-534; commercial.rs:419-432 (1–100%) | engine.rs:846-859 | works (quote/sale carry everything) | works (auto only) | **works**, but see SKU-widening (F1) and freeze (F3); 100% → unsellable (F14) |
| 2 | Amount off | rule-form.tsx:506-509 | engine.rs:860-880 (spread, remainder to last line) | works | works | **works**; amount ≥ basket → Rp0 → unsellable (F14) |
| 3 | Fixed price | rule-form.tsx:510-513 | engine.rs:881-886 | works | works | **works**; Rp0 → unsellable (F14) |
| 4 | Buy X get Y (reward %) | rule-form.tsx:514-522; commercial.rs:424 | engine.rs:887-935 (D01 spread) | works (one line per EPC) | works | **works** |
| 5 | Free item | refused at publish commercial.rs:242-272; no hub tile | engine supports | n/a | n/a | **n/a** (deliberately not offered) |
| 6 | Points: spend rate + Best rate / Add / Multiply | rule-form.tsx:523-530, 963-974 | engine.rs:1272-1591 (on net ex-tax) | awarded only if a member is attached; **never displayed** (till.tsx:409 stored, never rendered); receipt hard-codes 0 (till.rs:2009) | **never** (no customer sent, TillViewModel.kt:481/544) | **partial** (F17, F8) |
| 7 | Points: flat / per-unit bonus | not authorable in hub (shared.ts:401-413) | supported | n/a | n/a | **missing in hub** (API only) |
| 8 | Scope: Articles / Divisions / Tags | rule-form.tsx:119-125 | matched by catalogue facts, then **frozen to SKUs** at start (pricing.rs:690-727, domain/commercial.rs:152) | works | works | **partial**: membership frozen at start (new SKUs never join); "Change" scope ignored (F3) |
| 9 | Scope: SKUs | rule-form.tsx:1018-1058 | **frozen to every SKU of the article** (eligibility.rs:156-159, 425-442) | becomes wrong once frozen sets reach the till | same | **broken** (F1) |
| 10 | Scope: Whole basket | rule-form.tsx:124 | engine.rs:660-666 | works | works | **works** (freeze rows harmless unless scope later changed, F3) |
| 11 | Schedule start/end (rules, campaigns) | startOfDay/endOfDay in the **HO browser's** timezone (calendar.ts:53-61) | absolute instants, engine.rs:366-371 | works | works | **works** (WITA/WIT stores shift 1–2h, L8) |
| 12 | Weekday / time window | rules: no hub control; markdowns: pricelist-editor.tsx:562-733 (ISO days, OK) | store-local offset, rule.rs:308-332 / price.rs:303-309 | quote correct; **web display can be stale** (F19) | quote correct | **partial** |
| 13 | Members only | rule-form.tsx:135-138, 607 | only checks `customer_id.is_some()` engine.rs:352-359 | any typed string unlocks it; typed numbers with spaces strand points (F11) | **never** | **partial** (F11, F8) |
| 14 | Not on sale items / Sale items too | rule-form.tsx:142-145 | engine.rs:518-539 | works | works | **works** (L10: points rules default to "Not on sale items") |
| 15 | Blocks every other offer (BASKET) | rule-form.tsx:155-158 | engine.rs:1813-1845 | works | works | **works** |
| 16 | Blocks offers on its items (LINE) | form always writes `stacking: ALONE` rule-form.tsx:639 | companions must be STACKABLE engine.rs:1094-1130, 1762-1765 | no effect | no effect | **broken** (F10) |
| 17 | Coupon code (uncapped) | uppercased rule-form.tsx:486; published as book coupon | engine.rs:428-461 (exact match) | works (uppercases, till.tsx:1404-1417) | **missing** (sends `emptyList()`) | **partial** (F8) |
| 18 | Coupon code + Max. transactions (limited) | coupon `max_uses` = rule max uses (rule-form.tsx:709); becomes a coupon set at publish (coupons.rs:1331-1359) | needs an HO hold engine.rs:478-487 | works online (till.tsx:428-461); offline it does not apply (by design) | **missing** | **partial** |
| 19 | Min units / min value | rule-form.tsx:615-616 | engine.rs:595-652 (counted over matched lines; sale items excluded by default) | works | works | **works** |
| 20 | Budget (rule / campaign) | rule caps + campaign caps; optional per-shop split (cap_allocation.rs) | a brake on fleet count + local count (pricing.rs:182-305) | multi-store/offline can overspend unless split | same | **partial** (L6) |
| 21 | Max. transactions (rule / campaign) | same | counts **per applied rule**, points awards included (pricing.rs:323-375; sync.rs:7510-7553) | — | — | **partial** (L5) |
| 22 | Max. per shopper | rule-form.tsx:636-637, 1243-1250, no warning | **always refused at a till**: no customer history (engine.rs:412-424; pricing.rs:391-407) | dead | dead | **broken** (F7) |
| 23 | Priority | rule-form.tsx:1256-1263, text "lower numbers go first" (shared.ts:362-364) | with ALONE rules the best value always wins; priority only breaks ties | — | — | **partial / misleading** (L1) |
| 24 | Campaign window / stores / poster | campaigns.tsx:2205-2241 | intersected with the rule, engine.rs:327-345 | works | works | **works** |
| 25 | Campaign status "Scheduled" (offered in form) | campaigns.tsx:2364-2377; nothing ever flips it to ACTIVE | refused unless ACTIVE engine.rs:328, price.rs:321 | dead | dead | **broken** (F4) |
| 26 | Campaign pause / resume / end | switch lane commercial.rs:1964-2030, edge sync.rs:769-800 | engine.rs:328 | works when online | works when online | **works** (offline shops lag) |
| 27 | Promotion pause / resume / end | new book restating the rule (commercial.ts:1551-1586) | works | works | works | **works** (L12 race) |
| 28 | Store price / new price | change-price-sheet.tsx:569-596 (site rows); newest book wins | price.rs:167-177 | works (Tauri); **web display may be stale** (F19); **first 100 SKUs only** (F2) | works (uses quote lines) | **partial** |
| 29 | Markdown / price drop | change-price-sheet.tsx:536-568; pricelist-editor.tsx:712-733 | price.rs:429-477 (replaces base) | as row 28 | works | **partial**: end date one day early (F15); open-ended drops cannot be ended (F16) |
| 30 | Voucher issue / expiry | vouchers.rs:804-906; expiry checked at authorize (1332-1339) | tender, not pricing | works online | **broken**: tile offered, always refused (tender.rs:234-243) | **partial** |
| 31 | Voucher spend at till | authorize/commit vouchers.rs:1256-1765 | edge hold check sqlite.rs:2365-2447 | works, **but a hyphenated code blocks the store's sync stream** (F5) | broken | **broken** for codes typed as printed |
| 32 | Voucher cancel (Stop) | void_voucher vouchers.rs:1046-1118 ignores open holds | — | a sale already held blocks the stream (F6) | — | **broken (race)** |
| 33 | Member-bound voucher | member picker vouchers.tsx:1351-1379 ("blank is a bearer voucher") | authorize never checks the member | anyone with the code can spend | — | **broken** (F22) |
| 34 | Coupon sets (UNIQUE / API shared) | API only (http/mod.rs:2115-2146); no hub UI | edge refuses codes it does not hold (pricing.rs:2173-2193); engine matches only `rule.coupon_code` | dead | dead | **missing** (F21) |
| 35 | Members: enrol / link | enrol in hub counter (members/counter.tsx); till takes `M1:` scan or typed number | — | scan works; typed number not validated | **missing** | **partial** (F11) |
| 36 | Points redeem (6-digit → voucher) | loyalty.rs:576-862 | — | works online (redeem.ts, screens/redeem.tsx) | **missing** | **partial** |
| 37 | Points reversal: void / return | void: sync.rs:7639-7679 OK; return: **no fact** (sqlite.rs:9504-9651) | — | returns never reverse points | same | **broken** for returns (F9) |
| 38 | Tax rules | rate 0 published by the hub sheets | edge uses **newest book only** (pricing.rs:2737-2762); cloud uses newest per category (cloud pricing.rs:930-935) | — | — | **partial** (F18, latent; live till holds no tax rules right now) |
| 39 | Bags / charges | — | engine.rs:1943-1969 | priced; **receipt omits them** (till.rs:1891-2012) | **missing** | **partial** (F20) |

---

## (b) Findings, ranked

### F1 — HIGH — SKU-scoped promotions widen to every SKU of the article once their window opens · CONFIRMED (code and live data)

**Where:** `backend/src/cloud/postgres/eligibility.rs:154-168` (`covers`, `Sku` arm) and `:425-442` (`matching`).
- `covers(Sku{sku_codes}, article)` returns true when **any** SKU of the article is named.
- `matching` then returns **every** SKU of every article that `covers` accepted.
- The frozen set replaces the rule's scope at the centre (`cloud/postgres/pricing.rs:675-705`) and at the till (`edge/pricing.rs:712-714` → `domain/commercial.rs:152-158`).

**Live proof (cloud `commercial_rule_eligibility_sku`):**

| Rule | Names | Frozen to |
|---|---|---|
| `qa-camp-budget-10` | SKU `00000018103` (Kemeja Oxford White M) | all 6 SKUs of article 00000018, Light Blue included |
| `qa-prio-hi` | `00000022004` (White L) | `22003`, `22004`, `22103`, `22104` (Navy too) |
| `qa-sku-20` | UJ19 White M/L | UJ19 Black M/L as well |
| `qa-member-once` / `qa-member-10` | 2 SKUs each | widened to each other's SKUs |
| `qa-s2-only` | 1 SKU | 3 |
| `qa-amt-30k` | 3 SKUs (Light Blue M/L/XL) | 6 (adds White M/L/XL) |

**Failure:** "20% off SKU UJ19 White M" also gives 20% off UJ19 Black M/L.
- The hub's own Final price / simulator already prices the widened set.
- The tills will start doing it as soon as the frozen sets are delivered (see F3).
- The hub summary says "that colourway in that size, not the whole article" (shared.ts:434-436), the opposite of what happens.

**Fix:** in `matching`, special-case `Applicability::Sku`: return `sku_codes ∩ merchandise` and do not go through the article roll-up. Add a test with a two-colour article. Re-resolve the rows already frozen (delete and refreeze, or a migration that intersects them with the rule's named SKUs).

### F2 — HIGH (adjacent, display) — the desktop/web till loads only the first 100 catalogue rows · CONFIRMED (code; the rig has 95 items, so it does not show there)

**Where:** `pos-desktop/ui/src/till.tsx:315-321` and `:502` call `api.catalogue()` (`api.ts:213-223`) with no cursor. `edge/pricing.rs:1016` defaults the page size to `limit=100`, and the till never follows `next_cursor`.

**Failure:** in a shop with more than 100 active SKUs (the client has about 12k articles), every scanned EPC whose SKU sorts after the 100th shows:
- "Not in the price book" and the **NO PRICE** flag (till.tsx:978-984);
- a "Subtotal" that leaves those items out (`booked`, till.tsx:349);
- a customer display with null prices;
- when the quote fails (F23), a provisional Total and Payment amount that leave those items out entirely.

The node's quote still prices them, so a healthy online Total is right. The line list is wrong.

**Fix:** page through `next_cursor` (or add a `limit=all` mode). Better: render line prices from `quote.lines`, which the till already receives.

### F3 — HIGH — frozen promotion eligibility: not delivered to shops, never re-resolved on "Change" · CONFIRMED (code and live data)

**(a) Sets frozen at publish time never reach the shops.**
- `commercial.rs:664` calls `freeze_started_rules` inside the publish transaction but never `publish_rule_eligibility_to_fleet`.
- The periodic pass `eligibility.rs:199-211` broadcasts only when it froze something new itself (`if frozen > 0`). The only other trigger is node enrolment (`node_enrolment.rs:698`).
- Live: the cloud holds **21** frozen rules; store-01's edge holds **4** (from 13 Oct).
- Until a broadcast, the centre (hub Final price, simulator) and the till price different product sets.
- The broadcast is set off by an **unrelated** rule starting. On the rig, `qa-future` starts at **2026-10-20T17:00Z** (00:00 WIB). The next pass will then ship all 21 sets, including the widened SKU sets from F1, and QA results taken before and after that moment will differ.

**(b) Once frozen, a rule id is frozen for ever.**
- `freeze_started_rules` skips rules already in `commercial_rule_eligibility` (`eligibility.rs:333-343`, `ON CONFLICT DO NOTHING` at :386), and nothing deletes rows (grep: no DELETE in cloud).
- The hub "Change promotion" republishes the **same `rule_id`** (rule-form.tsx:205-214, 655-661) with no warning. So scope edits to a started promotion are silently ignored at tills and centre:
  - adding an article does nothing;
  - removing one still discounts it;
  - **Whole basket → Articles** makes the rule match nothing. Whole-basket rules are frozen with an empty set (live: `rule-hemat50`, `rule-poin-member`, `qa-sekali` have `sku_count 0`). `narrow_to_frozen` skips Whole basket today, but after a change it turns the new article scope into `Sku{}`.
  - relaunching last season's promotion via "Change" reuses last season's SKU set.

**Fix:**
1. Broadcast after the publish-time freeze, after commit (or have the pass broadcast when the frozen set differs from the last one sent).
2. When a newer book changes a rule's `scope.applicability` or `effect_on`, delete its eligibility rows so the next pass re-resolves it. At minimum, warn in the form.
3. Do not create eligibility rows for Whole basket rules (`freeze_started_rules` filters `is_some()`, but it should filter `is_product_scope`).

### F4 — HIGH — a campaign saved as "Scheduled" never goes live · CONFIRMED

**Where:** the hub Campaign form offers Status Draft / **Scheduled** / Live / Paused (`campaigns.tsx:172-179`, `2364-2377`). The engine runs a campaign's rules only if `status == ACTIVE` (`engine.rs:328-330`) and its markdowns likewise (`price.rs:321-323`). No job ever moves SCHEDULED → ACTIVE (grep).

**Why HO will not notice:**
- The hub list maps both "ACTIVE with a future start" and a stored "SCHEDULED" to the same phase `SCHEDULED` (`catalogue.rs:988-994`).
- Marketing watch announces a SCHEDULED campaign as "starting tomorrow" (`marketing_watch.rs:761-765`).
- The shop board hides it (`edge/pricing.rs:1472-1475`).
- There is no Pause/Resume lever for SCHEDULED (`campaigns.tsx:196-217`).

**Failure:** HO creates "Lebaran Sale" with Status = Scheduled and dates 1–7 Apr. On 1 Apr every promotion and price drop in it is refused at every till ("the promotion is not active").

**Fix:** remove Scheduled (and Draft) from the form, since ACTIVE plus a future `valid_from` already means "scheduled". Or treat SCHEDULED as ACTIVE inside the window in `engine::gate` and `PriceIndex::campaign_allows`, and in `CAMPAIGN_PHASE`.

### F5 — HIGH — a voucher code typed with a hyphen blocks the store's whole sync stream at HO · CONFIRMED

**The chain:**
1. The till sends the code as typed, uppercased: `vouchers.ts` `base()` → `encodeURIComponent(code.trim().toUpperCase())`.
2. The edge relay allows `-` (`edge/http.rs:2430` `voucher_code_segment`).
3. The edge records the hold under the **raw path code** (`http.rs:2871` `code: code.to_owned()`; `sqlite.rs:7676` upper only).
4. The sale fact sends that spelling as `voucher_code` (`sqlite.rs:8110-8131`).
5. The cloud authorizes against the **normalized** code (`domain/voucher.rs:183-196` strips `-`, spaces and `_`; it even tests "4F7A-21B9").
6. At commit the cloud compares strictly: `actual_code != tender_code.trim().to_ascii_uppercase()` (`cloud/postgres/vouchers.rs:1622-1629`) → `Conflict`.
7. `apply_sale` fails → `ApplyStep::Blocked` (`cloud/postgres/sync.rs:2454-2458`). The stream is head-of-line blocked.

**Failure:** a cashier types `GIFT-0001` as printed. The sale completes at the till and the customer leaves. From then on, every later sale, stock fact, points award and usage count from that store stops applying at HO until someone repairs it by hand.

**Fix:** compare `normalize_code(tender_code)` in `commit_voucher_hold_for_fact`. Also record the normalized code at the edge: use the `code` the cloud returns in the authorize reply.

### F6 — HIGH (race) — cancelling a voucher in the hub while a till holds it blocks the store stream · CONFIRMED by reading

**Where:** `void_voucher` (`vouchers.rs:1046-1118`) sets `balance_minor = 0` and VOIDED without looking at AUTHORIZED holds, unlike `redeem_voucher`, which respects them. The till's sale later lands. `commit_voucher_hold_for_fact` computes available = 0 − 0, and `amount > available` gives Conflict (`vouchers.rs:1698-1714`) → stream Blocked, as in F5.

**Failure:** a customer reports a card stolen. HO presses Stop while a cashier has the card held (15-minute window). The sale goes through at the till, and the store's sync stops.

**Fix:** refuse a void while live holds exist (or release them first and tell the till), and/or let commit honour a hold that was granted before the void.

### F7 — HIGH — "Max. per shopper" makes the promotion dead at every till · CONFIRMED

**Where:** the hub writes `max_uses_per_customer` (`rule-form.tsx:636-637`, field at `:1243-1250`, no warning). The engine refuses such a rule:
- with no member: `NotThisCustomer`;
- with a member: `CustomerUsageUnknown`, because `customer_history` is `None` (`engine.rs:412-424`).

The edge never sets `customer_history` (`edge/pricing.rs:391-407` says so; grep confirms).

**Live:** `qa-member-once` (12% off for members, once per shopper) has 0 uses in `commercial_usage`.

**Failure:** "Members get 12% once" never discounts anything, while the hub shows it as Live and the shop board lists it.

**Fix:** hide the field until a customer-history lane to the edge exists, or enforce the limit online like limited coupons (hold per customer), or at least warn at the field.

### F8 — HIGH — the Android tablet has no coupon, member, voucher, points or bag path · CONFIRMED

**Where:** `tablet/.../data/Api.kt:113-119` (quote) and `:130-147` (sale) send only `epcs`, `coupon_codes`, `customer_id`, with `TillViewModel.kt:481/544/581` passing `emptyList()` and `null`. No `coupon_authorizations`, no `charges`. `DeskScreen.kt:79-81` says the Member, Coupon and Bags rows are absent. The tender screen still offers **VOUCHER** without a hold (`TenderScreen.kt:125-127, 626-628`), and the node always refuses it with `VoucherNotAuthorised` (`backend/src/tender.rs:234-243`).

**Failure on the tablet:**
- no coupon promotion (HEMAT50, QAKUPON);
- no members-only offer;
- no points earned;
- no points redeem;
- the Voucher tile fails every time.

**Fix:** port the desktop's coupon, member (M1: scan), limited-coupon hold and voucher authorize flows. Until then, hide the VOUCHER tile.

### F9 — HIGH — POS returns never reach HO; voucher value turns into cash · CONFIRMED

**Where:** `edge/sqlite.rs:9504-9651` `return_sale` writes stock and `sale_return` rows but enqueues **no fact**. Only `sales.completed` and `sales.voided` exist (`cloud/domain/sync.rs:1991, 2005`). The cloud's `reverse_for_return` is reachable only from the centre's own `sale` returns (`cloud/postgres/returns.rs:336-375`).

**Consequences:**
- Points earned on returned goods are **never reversed**.
- The cloud `edge_sale` stays COMPLETED at full value, so revenue and promotion reports overstate.
- Refunds of voucher-paid sales go out as Cash/Card/QRIS/… (`pos-desktop/ui/src/screens/returns.tsx:94-100`; the edge forbids VOUCHER refunds, `sqlite.rs:9520-9528`).
- A void does not re-credit the voucher either (`sync.rs:7639-7679` only flips status and reverses points).

**Failure:** a member redeems 100k points → GOODWILL voucher → buys a Rp100k shirt with it → returns it → receives Rp100k cash and keeps the points the purchase earned.

**Fix:** emit a `sales.returned` fact (lines, `subject_id`s, refund split) and apply it at the cloud: reverse points from the line snapshot, mark lines returned, and re-credit voucher tenders proportionally. Re-credit vouchers on void as well.

### F10 — MEDIUM — "Blocks offers on its items" does nothing for promotions created in the hub · CONFIRMED

**Where:** the form always writes `stacking: ALONE` (`rule-form.tsx:639`). Line-exclusive companions are taken only from STACKABLE candidates (`engine.rs:1094-1130`, `1762-1765`, `1823-1826`). Every engine test of LINE uses a STACKABLE companion (`tests.rs:3696-3707`). The hub text promises "offers on the rest of the basket still do" (`shared.ts:377-383`).

**Failure (live rules `qa-art-25` LINE on article 00000016, `qa-sku-20` LINE on UJ19 White):** a basket with one of each gets only the larger discount. The other offer is rejected with "another offer gave a better price".

**Fix:** let `alongside_the_claim` admit non-claiming ALONE rules whose own LINE scope does not overlap. Or have the form write STACKABLE when LINE is chosen, and say what that means.

### F11 — MEDIUM — "Members only" means "any text typed in the Member box" · CONFIRMED

**Where:** the engine checks only `customer_id.is_some()` (`engine.rs:352-359`). The till accepts free text (`till.tsx:1390-1401`; placeholder "0812 3456 7788" with spaces). The cloud validates nothing and opens a points account for any string (`loyalty.rs:51-69`); `list_unenrolled` (`membership.rs:1085-1104`) exists precisely for these ids.

**Live:** member ids are bare digits (`081311110001`).

**Failure:**
- Typing "0813 1111 0001" or "x" unlocks `qa-member-10` / `rule-poin-member` discounts.
- The points land in a phantom account ("0813 1111 0001") that the member's app never shows.

**Fix:** normalise the typed member id (strip spaces, dashes, dots) at the till and the cloud. Sync a member-id list or hash set to the edge and refuse unknown ids for members-only rules, or flag the sale.

### F12 — MEDIUM — sales queued in the outbox are re-priced at send time · CONFIRMED

**Where:** `outbox.ts:395-406` (`wire`) drops `takenAt`. `SaleRequest` has no `occurred_at` (`edge/contracts.rs:496-537`). `complete_sale` prices at `clock.now()` (`sqlite.rs:7785`).

**Failure:**
- A sale rung at 23:59 under "Promo ends today" (or with a coupon or voucher hold) is sent at 00:05 after a LAN glitch. Price, promotions and hold expiry are evaluated at 00:05, so the exact card tender is now short (`InsufficientPayment`) or the hold has expired (409).
- The node refuses the sale and the outbox marks it refused, but the customer has gone with the goods.
- The Sale overlay still says "Waiting to be sent to the node — it is resent automatically" for a refusal, which is never resent (`till.tsx:2850-2854`; `outbox.ts:266-267`).

**Fix:** carry `taken_at` and price at that instant (bounded, for example within 24h). Show refused entries as needing attention, not "resent automatically".

### F13 — MEDIUM — hub priority wording vs behaviour · CONFIRMED
**Where:** `shared.ts:362-364` says "tried in position N — lower numbers go first". With ALONE rules the best-value scenario wins and priority only breaks ties (`engine.rs:142-150`, `1818-1845`).
**Failure:** HO gives "10% off" priority 1 to beat "15% off" (live `qa-prio-hi` / `qa-prio-lo`). The till always gives 15%.
**Fix:** reword it as a tie-breaker, or implement priority as precedence.

### F14 — MEDIUM — a basket promoted to Rp 0 cannot be sold · CONFIRMED
**Where:** `tender.rs:319-321` (`EmptyOrZeroSale`) and `:202-204` (a tender must be > 0). The hub allows 100% off (`rule-form.tsx:497`) and fixed price 0; Amount off is capped at the basket (`engine.rs:869`).
**Failure:** a "free gift" (100% off) or "Rp50.000 off" on a Rp49.000 item leaves the cashier stuck: every tender is refused.
**Fix:** allow a zero-total sale with no tender (or a "NONE" tender), or refuse such rules in validation.

### F15 — MEDIUM — the change-price sheet ends markdowns one day early · CONFIRMED
**Where:** `change-price-sheet.tsx:79-81` `dateToInstant` returns local **midnight at the start** of the day and is used for `effective_to` (`:553, :566`). The promotion and campaign forms use `endOfDay`.
**Failure:** "Ends 31 Oct" stops at 31 Oct 00:00, so the till charges full price on the 31st. Choosing Ends = Starts (`min={from}`, `:943-946`) is refused by the cloud ("effective_to must be after effective_from", `commercial.rs:371-378`).
**Fix:** use `endOfDay(until)`.

### F16 — MEDIUM — an open-ended markdown can never be ended from the hub · CONFIRMED
**Where:** a markdown always replaces the base price (`engine.rs:227-244`). New prices never override it (`change-price-sheet.tsx:456-458` says so). Ids are minted per version (`md-v{version}-…`), and there is no "end price drop" action or route (grep).
**Failure:** "Ends: empty = no end" leaves the article permanently MARKDOWN. "Not on sale items" promotions never touch it, and a later "New price" changes nothing at the till.
**Fix:** add an "End price drop" that republishes the same `markdown_id` with `effective_to = now`.

### F17 — MEDIUM — points are invisible at the counter · CONFIRMED
**Where:** the desktop stores `pointsEarned` but never renders it (`till.tsx:84, 96, 409`). `receipt_document` hard-codes `points_earned: 0` (`edge/till.rs:2009`), so "Poin" never prints (`escpos.rs:378-382`). The tablet never earns points (F8).
**Fix:** show `quote.points_earned` when a member is attached. Fill the receipt from `sale_line.points_earned`.

### F18 — MEDIUM (latent) — the till's tax rules come from the newest book only · CONFIRMED (live)
**Where:** `edge/pricing.rs:2737-2762` uses only the newest publication's tax rules. The cloud uses `DISTINCT ON (tax_category) … ORDER BY version DESC` (`cloud/postgres/pricing.rs:930-935`). Promotion, markdown and campaign-only books carry no tax rules by validation (`commercial.rs:315-325`).
**Live:** the newest edge book is v32 "Resume QA 20% UJ19 White (SKU)". Store-01 currently has **no** tax rules while the cloud resolves STANDARD 0% inclusive.
**Failure:** harmless at 0%. Once PPN 11% is published, every promotion publish zeroes tax on tills (`sale_line.tax_minor = 0`) and lifts the points basis by about 11% until the next price book.
**Fix:** mirror the cloud query on the edge.

### F19 — MEDIUM — web edition: the catalogue ETag is the catalogue generation, not the price-book version · PLAUSIBLE (browser behaviour)
**Where:** `edge/http.rs:3197-3219, 3241-3247` set `ETag: "<catalog generation>"` with no Cache-Control. The web till uses `fetch` with the default cache mode (`pos-desktop/ui/src/web.ts:143-149`).
**Live:** catalogue generation 10 was activated 10:02Z; price books kept arriving until 12:00Z+.
**Failure:** the browser revalidates, gets 304, and keeps showing old line prices after a price change or a markdown start or end (including flash-sale hours). The Total (from the quote) moves; the lines do not.
**Fix:** include the max publication version and a minute bucket (or the next markdown boundary) in the ETag, or send `Cache-Control: no-store`.

### F20 — MEDIUM (adjacent) — the receipt leaves out bags and charges and does not add up · CONFIRMED
**Where:** `edge/till.rs:1891-2012` prints Total = `sale.total_minor` (goods only, `sqlite.rs:7973`) with no `sale_charge` lines, while Paid and Change include the charge.
**Failure:** goods 150.000 + paper bag 5.000, cash 200.000 prints Total 150.000 / Tunai 200.000 / Kembali 45.000.
**Fix:** print the charges and the amount due.

### F21 — MEDIUM — coupon sets (UNIQUE mailings, API-made shared sets) cannot be used at any till · CONFIRMED
**Where:** the edge refuses any code it does not hold as "unknown coupon code" (`edge/pricing.rs:2173-2193`), and holds only book coupons. The engine opens a rule only on `rule.coupon_code` (`engine.rs:434-443`). No hub UI exists for sets.
**Fix:** for set codes, ask HO (authorize) and map the hold to its rule (the cloud already returns `rule_id`), or publish UNIQUE codes to the edge.

### F22 — MEDIUM — member-bound vouchers are spendable by anyone · CONFIRMED
**Where:** the hub says "Blank is a bearer voucher" (`vouchers.tsx:1351-1354`), which implies a voucher with a member is restricted. `authorize_voucher` (`vouchers.rs:1256-1379`) never checks `member_id`, and the relay carries no customer (`edge/http.rs` `RelayVoucherCall`).
**Fix:** pass `customer_id` and refuse a mismatch, or reword the hub.

### F23 — LOW/MEDIUM — one mistyped coupon code fails the whole quote · CONFIRMED
**Where:** `reject_unknown_coupon_codes` returns 400 (`edge/pricing.rs:1957, 2173-2193`). The till falls back to a provisional total that loses **all** automatic promotions (`till.tsx:399-418`), and **Pay stays enabled** (`:1221-1229`). The sale is then refused (and F12's misleading message appears).
**Fix:** report the unknown code as a rejected promotion, or block Pay while a quote problem stands.

### LOW
- **L1. Points awards shown as promotions.** They are pushed as `applied: true, benefit 0` (`edge/pricing.rs:2062-2081`). The desktop prints a "−Rp0" line named after the points rule (`till.tsx:1169-1179`), and `basketHasPromotion` becomes true (`:1241`; tablet `TillViewModel.kt:404`), so a points-only basket **blocks the employee balance**.
- **L2. Coupon hold renewal.** The till asks HO at most twice per code (`till.tsx:433-435`). After a second lapse the coupon silently shows "No discount", with no reason shown (`till.tsx:1195-1200`).
- **L3. Hold leak on refused sales.** After a refused sale `clearBasket(true)` treats the holds as used and does not release them. They self-heal after 15 minutes.
- **L4. Transactions limit counts rules, not baskets.** It counts +1 per applied rule, points awards included (`pricing.rs:330-372`, `sync.rs:7510-7553`). A points rule inside a capped campaign burns the campaign's transactions.
- **L5. Budgets and caps are a brake, not a gate,** unless the cap split is switched on. Several stores selling at once, or offline, can overspend (`pricing.rs:182-305`).
- **L6. Display mismatches.** The customer display has no discount lines. The receipt's "Diskon" mixes markdown and promotion. The screen subtotal (post-markdown) differs from the receipt subtotal (list price).
- **L7. Time zones.** Hub dates use the HO browser's time zone (`calendar.ts:53-61`), so WITA/WIT stores start 1–2h late.
- **L8. Time windows.** A window with from == to never matches (`rule.rs:324-331`). An overnight window combined with a weekday checks the weekday after midnight.
- **L9. Owner questions, not defects.** Points rules default to "Not on sale items", so markdown goods earn nothing. Redemption is 1 point = Rp1 (`loyalty.rs:292-294`).
- **L10. Spaces in voucher codes.** Codes typed with spaces are refused by the relay (`http.rs:2430-2441`) although the cloud accepts them.
- **L11. Pause race.** Pausing or resuming a rule restates its campaign from the hub's cached list (`promotions.tsx:821-831`). A stale list can un-pause a campaign that was just switched.

---

## (c) API tests to run on a rig (most important first)

Edge: `http://127.0.0.1:8182`; cloud: `http://127.0.0.1:8180`. Sign in as admin (the password is in `runs/demo/env`) to get a Bearer token. **T4 and T6 deliberately block a store stream, so run them on a throwaway rig (pos-e2e), not demo.**

**T1 — F1/F3, read-only, now.**
- Cloud: `SELECT rule_id, sku_code FROM commercial_rule_eligibility_sku WHERE rule_id IN ('qa-prio-hi','qa-camp-budget-10');` — 4 and 6 rows, while the rules name 1 SKU each.
- Edge: `SELECT count(*) FROM commercial_rule_eligibility;` → 4 (cloud has 21).

**T2 — F1 at the till, after 2026-10-20T17:00Z** (when `qa-future` starts and the pass broadcasts).
- `POST /api/v1/store/quote {"epcs":["A10000002210300000000002"],"coupon_codes":[]}`. The EPC is SKU 00000022103, Kemeja Test Demo **Navy** M, Rp179.000, which no SKU rule names.
- Expected: no promotion. Prediction after the broadcast: `qa-prio-lo` 15% applied, `total_minor` 152150.
- Before 17:00Z the same quote gives no promotion. Then compare with the hub's Final price for that SKU (already discounted).

**T3 — F7.**
- `POST /api/v1/store/quote {"epcs":["A10000002410300000000004"],"customer_id":"081311110003"}` (`qa-member-once`).
- Expected: `qa-member-once` rejected with "this shop cannot tell how often this shopper has used it". `qa-member-10` does not reach this SKU until the broadcast.

**T4 — F5 (throwaway rig).**
1. Issue a voucher: `POST /api/v1/commercial/vouchers {"kind":"GIFT_CARD","value_minor":100000,"currency":"IDR"}` (header `Idempotency-Key`) → code `ABCDEFGH2345`.
2. Hold it with a hyphen: `POST /api/v1/store/vouchers/ABCD-EFGH-2345/authorize {"checkout_id":"t4","amount_minor":99000}`.
3. Sell with tender `{"method":"VOUCHER","amount_minor":99000,"reference":"ABCD-EFGH-2345","voucher_authorization_id":"<id>"}` and the EPC of SKU 00000017003 (Rp99.000).
4. Expect the cloud: `SELECT origin_id, blocked_at_seq, blocked_reason FROM sync_applied_watermark WHERE blocked_at_seq IS NOT NULL;` with the reason "names voucher code \"ABCD-EFGH-2345\", but its hold belongs to \"ABCDEFGH2345\"".

**T5 — F4.**
- Publish a campaign-plus-rule book with campaign `"status":"SCHEDULED"`, `valid_from` = now − 1h, and a rule `{"effect":{"kind":"PERCENT","bps":1000},"scope":{"applicability":{"on":"SKU","sku_codes":["00000017004"]}},"campaign_id":"<id>","stacking":"ALONE"}`.
- Quote EPC `A10000001700400000000002`. Expected: rejected "the promotion is not active". `/api/v1/store/offers` does not list it.

**T6 — F6 (throwaway rig).** Authorize a voucher at the edge, then `POST /api/v1/commercial/vouchers/{code}/void {"reason":"test"}`, then complete the sale at the edge. Expect the stream to be blocked: "took N, but the voucher has only 0 unheld".

**T7 — F9.**
1. Sell with `customer_id` `081311110002` (scan `M1:081311110002` on the desktop) and wait for the cloud apply (`points_ledger` EARN row).
2. `POST /api/v1/store/returns` for one EPC.
3. Expect no `RETURN_REVERSAL` row, `edge_sale.status` still COMPLETED, and an unchanged balance.

**T8 — F10.** Quote `{"epcs":["A10000001600300000000003","A10000001920300000000002"]}` (`qa-art-25` LINE plus `qa-sku-20` LINE). Expect only one applied; the other is rejected "another offer gave a better price".

**T9 — F11.** Quote `{"epcs":["A10000002400300000000004"],"customer_id":"x"}` → `qa-member-10` applied (10% of 159.000).

**T10 — F14.** Publish `{"effect":{"kind":"FIXED_UNIT_PRICE","unit_price":{"minor":0}}}` on one SKU and try to sell it with any tender. Expect 400 "sale must have a positive payable total" or "tender amounts cannot be negative".

**T11 — F15.** In the hub change-price sheet, publish a markdown ending 2026-10-31. Expect `commercial_markdown.effective_to = 2026-10-30T17:00:00Z`, not `2026-10-31T16:59:59Z`.

**T12 — F19 (web edition).** `GET /api/v1/store/catalog` and note the ETag. Publish a new price for any listed SKU. `GET` again with `If-None-Match: "<etag>"`. Expect 304 even though `unit_price_minor` changed.

**T13 — F23.** Quote with `"coupon_codes":["NOPE"]` → 400 "unknown coupon code: NOPE", and the till shows a provisional total with no automatic promotions.

**T14 — F2 (any store with more than 100 SKUs).** `GET /api/v1/store/catalog` returns `item_count: 100` and a `next_cursor`. Scan an EPC whose SKU sorts after the 100th: the desktop shows "Not in the price book".

---

## Notes for the coordinator

- Another session is QA-dogfooding all promotion kinds on the demo rig right now (books v29–v32, `qa-*` rules). Its results for SKU-scoped rules will change after the next eligibility broadcast, which `qa-future`'s start at 2026-10-20T17:00Z should set off (F1/F3).
- Not covered in depth: hub price-history and change screens, cap-split UI, campaign guardrails, `frontend-store-new` (not a till).
