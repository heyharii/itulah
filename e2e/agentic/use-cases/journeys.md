# Cross-domain journeys — hand-off catalogue

Five serial journeys, one file each in `hub/journeys/`; helpers in `support/journeys.ts` (everything a domain owns is imported from its own helper file).
Run: `./remote.sh --config hub.config.ts --output .e2e/out/journeys hub/journeys` (~7 min on a quiet VM; one journey is 1–2 min).
Tags: `journey` + `j1`…`j5` + the domains crossed; `bug` where a hand-off is broken.

Each row is one **hand-off** — the moment one module gives its result to the next — and what proves it. People act on the real screens (New PO, Ops › Receiving, Review Count, Marketing › New promotion,
Credit Note, BKK, New allotment, the web till, Members); the numbers are re-read through the nodes' API at every step (journal balanced, payable, ageing, ledger, availability per pool, receipts, points ledger).

How the journeys stay out of everyone's way:

* **Own data**: each journey has its own supplier (`Journey e2e <purpose>`, found-or-created once; the shared `makeItem`/`makeItemFast`/`makeOwnItem` look supplier 0001 up in the first 50 suppliers and the rig now holds hundreds of `GAR…` suppliers that sort first, so they throw
  "supplier 0001 missing" — see *Observations*), its own articles and PO items (run-unique `tag()`), its own member card. The payable of the supplier is read as a before/after pair, so only this journey's postings are in it.
* **Shop stock**: the garments that are sold are walked to store-01's floor first (PO → DC → article setup → tagging → allotment → pick/pack/dispatch → blind count → "Move stock" to the floor, ~40 s). **No unit of the shop's shared stock is spent** (0 of the 3 allowed); never a bag-charge sale; cash only; EDC settlement ignored.
* **Known bugs are referenced, not re-reported** (B2 in `finance.md`; RET-21/22 in `po.md`).
* A screen check that does not gate the chain is collected (`lateChecks`) and asserted by the journey's last test (`Jn-99`), so one UI miss does not hide the hand-offs behind it. A hand-off that gates the chain stops it (later members are skipped).

Status: **pass** · **FAIL (bug)** = the app is wrong and the test asserts the right behaviour · **blocked** (reason).

## J1 — PO to paid  (`hub/journeys/j1-po-to-paid.e2e.ts`)

rina raises the PO in New PO → nina counts 5 of 8 in Ops › Receiving → rina Closes Short in Review Count → Finance gets the delivery → bill names the delivery → posted → BKK pays it → supplier owes 0.

| ID | Hand-off | Expected | Test | Status |
|---|---|---|---|---|
| J1-01 | buyer → PO | New PO (own supplier, new item, 8 pcs × Rp 40.000, notes) creates a server-numbered PO; detail: supplier code, 1 line, `ordered_quantity` 8, gross Rp 320.000; the supplier item code is on the line | `j1::J1-01 rina raises the PO in New PO…` | pass |
| J1-02 | PO → DC receiving | the PO reaches the DC (`dc/purchase-orders`) and Ops › Receiving lists it under the supplier with "Count receive" | `j1::J1-02 the PO reaches the DC…` | pass |
| J1-03 | Receiving → buyer's review | blind count of 5: the sheet never shows 8; the count (5, variance −3, receipt id) waits for the buyer; nothing is owed yet (ledger unchanged) | `j1::J1-03 nina counts 5 of the 8 blind…` | pass |
| J1-04 | Review → PO | Review Count reads "−3 pcs" with the supplier; Close Short ("3 pcs will be removed…") accepts 5; PO `SHORT_RECEIVED`, received 5, excess 0 | `j1::J1-04 rina reviews the count…` | pass |
| J1-05 | PO/DC → Finance | the delivery is on Unbilled deliveries at `value_at_order_price` Rp 200.000 (5 × 40.000), no invoice; supplier ledger +200.000 (one GOODS_RECEIPT movement), ageing +200.000; the receipt entry balances (Dr 1029 / Cr 2002 party = supplier) | `j1::J1-05 the delivery is in Finance…` | pass |
| J1-05b | Finance screen | the Unbilled deliveries **tab** lists the new delivery | collected in `J1-99` | **FAIL (bug B2)** — the tab is cut at the oldest 200 of 33x unbilled; the newest delivery is the one it drops (`finance.md` B2) |
| J1-06 | Finance: bill ↔ delivery | a bill naming the delivery (`receipt_ids`) is Draft, `matched_by` rina, variance 0; the delivery leaves Unbilled; Purchase Invoice lists it Draft at Rp 200.000 | `j1::J1-06 the supplier bill names the delivery…` | pass |
| J1-07 | bill → books | Post to the books (sheet): one balanced entry, Cr 2002 Rp 200.000 party = supplier; the bill **replaces** the delivery's payable (ledger unchanged, owed 200.000, ageing +200.000) | `j1::J1-07 rina posts the bill…` | pass |
| J1-08 | Finance → payment | BKK form (Danamon, Head Office, supplier, "in full") → Save draft → Approve → Post: KK number, balanced entry Dr 2002 / Cr 1009, bill `PAID` outstanding 0, bank −200.000 | `j1::J1-08 rina pays it with a BKK…` | pass |
| J1-09 | books close | supplier owed 0, ledger and ageing back to where they began, the BKK is the last movement on the payable, the PO stays `SHORT_RECEIVED` | `j1::J1-09 the books close on this PO…` | pass |
| J1-99 | screens | collected screen checks are empty | `j1::J1-99 [bug] the screens…` | **FAIL (bug B2)** — only B2 |

## J2 — Excess to supplier credit  (`hub/journeys/j2-excess-to-credit.e2e.ts`)

PO of 8 → nina counts 11 + 2 Not as Ordered (13 on the truck) → rina's Review Count Submit → return raised by itself → DC hands it over → Finance books 8 → merchandising sets the 8 up → the supplier's bill for 13 posts → credit note for the 5 that went back.

| ID | Hand-off | Expected | Test | Status |
|---|---|---|---|---|
| J2-01 | buyer → DC | PO of 8 × Rp 40.000 (by API: New PO itself is J1) on our supplier reaches the DC | `j2::J2-01 …` | pass |
| J2-02 | Receiving → review | Ops › Receiving: Counted 11 + Not as Ordered 2 → the count at the DC is 13, `wrong_quantity` 2, variance +3 (good pieces against the order) | `j2::J2-02 nina counts 11 and records 2 Not as Ordered…` | pass |
| J2-03 | Review → PO | Review Count says "5 pcs not as ordered will be returned to the supplier", offers only Submit (no Close Short / Partial Receive); Submit receives the 8 (`FULLY_RECEIVED`, received 8) | `j2::J2-03 rina opens Review Count…` | pass |
| J2-04 | PO → Return PO | the return was raised without anyone asking: RS number, 5 pcs (3 extra + 2 Not as Ordered), open at the DC; cloud row has `wrong_quantity` 2; the Return PO list shows it "Not Generated" · 5 pcs | `j2::J2-04 the return was raised…` | pass |
| J2-05 | Return PO → DC hand-over | the DC hands the goods over (**API**: Generate Delivery Note answers 405 on this rig, RET-21/22 — the call is the one Confirm makes): `HANDED_OVER`, "Pak Joko"; head office sees `handed_over_at`; the buyer's list says Completed | `j2::J2-05 the DC hands the goods over…` | pass |
| J2-06 | DC receipt → Finance | the delivery is booked at the **8 ordered** pieces: Unbilled Rp 320.000 (not 13 × 40.000 = 520.000), one GOODS_RECEIPT credit 320.000, entry balanced (Dr 1029), ageing/ledger +320.000 | `j2::J2-06 Finance books the delivery at the 8 ordered pieces…` | pass |
| J2-07 | Return PO → Finance (credit note "Settles return") | **no owed return exists for an over-delivery**: `supplier-returns` holds nothing for the supplier, so Credit Note has no "Settles return" to point at. By design (`supplier_returns.rs`: goods beyond a PO were never ours to pay for; only RETURN_TO_SUPPLIER allotments from HO return stock are owed). Not testable as a UI branch on this rig — it needs HO return stock (`finance.md` FIN-78 skip) | `j2::J2-07 an over-delivery is never owed back in money…` | pass (documents why) |
| J2-08 | Merchandise → Finance | the 8 accepted pieces are set up as an article and tagged (4 SKUs × 2 free at the DC) — the stock layer a differing bill folds into | `j2::J2-08 merchandising sets the 8 accepted pieces up…` | pass |
| J2-09 | Finance: dearer bill | the supplier bills the whole truck (13 × 40.000 = Rp 520.000) naming the delivery: Draft with variance +200.000; posted from its sheet: balanced entry; owed 520.000, ledger +520.000 | `j2::J2-09 the supplier bills the whole truck…` | pass |
| J2-10 | Return → credit note | Credit Note form (Goods returned, Rp 200.000 = 5 × 40.000, supplier's CN no) → Post: entry Dr 2002 / Cr 1029; supplier ledger falls by exactly 200.000 and the supplier is owed Rp 320.000 = the 8 ordered | `j2::J2-10 the supplier's credit note for the 5 returned pieces…` | pass |
| J2-99 | screens | Return PO list shows the raised return (Not Generated, 5 pcs) and, after hand-over, under Completed | `j2::J2-99 the screens along the way…` | pass |
| J2-11 | Finance ↔ Merchandise | a bill dearer than its delivery, posted while the delivery's pieces are still **Unidentified** (no article set up), posts or is refused in words a buyer can act on | `j2::J2-11 [bug] a bill dearer than its delivery…` (own PO, runs after the chain) | **FAIL (bug F1)** |

## J3 — Promo to report  (`hub/journeys/j3-promo-to-report.e2e.ts`)

A garment of our own on store-01's floor → rina publishes a 20% coupon promotion on that article under a campaign (Marketing UI) → store-01's quote → dian sells it with the code at the web till (UI) → head office → Sales by campaign → Finance.

| ID | Hand-off | Expected | Test | Status |
|---|---|---|---|---|
| J3-01 | goods → shelf | one garment of our own stands on `store-01.floor` (set up, allotted, picked, packed, dispatched, counted in blind, moved to the floor); the shop quotes its price | `j3::J3-01 a garment of our own stands on store-01's floor…` | pass |
| J3-02 | Marketing → books | New promotion (20% off, our article, coupon code, campaign) is published: rule ACTIVE, `coupon_code`, PERCENT 2000 bps, scope ARTICLE = ours, `campaign_id` = the campaign | `j3::J3-02 rina creates the promotion in Marketing…` | pass |
| J3-03 | Marketing → shop | store-01's quote lists the rule, applies it **with** the code (benefit = 20% of the price) and refuses it without ("needs a coupon code") | `j3::J3-03 store-01 hears of it…` | pass |
| J3-04 | shop → till | the web till (UI): scan, coupon chip, discount row "−Rp 19.800" under the promotion's name, total = the node's quote, cash, "Lunas", sale id; node receipt total, CASH tender, unit `external/customer` | `j3::J3-04 dian rings it up at the web till…` | pass |
| J3-04b | catalogue → till | the till names and prices the garment of a new article (no "TANPA HARGA / Tidak ada di buku harga") | collected in `J3-99` | **FAIL (bug F2)** |
| J3-05 | shop → head office | the sale arrives (COMPLETED, total, store-01); the rule and its campaign each count 1 use with the discount as `spent_minor` | `j3::J3-05 the sale reaches head office…` | pass |
| J3-06 | Sales → campaign | `breakdown?by=campaign`: row for the campaign, quantity 1, net = the amount paid; Sales › by campaign draws the same row | `j3::J3-06 Sales › by campaign shows the sale…` | pass |
| J3-07 | sale → Finance | the day's receipts at head office list the sale as CASH (calendar day); the shop's takings document for the day the sale trades on (**its shift's day**): a DRAFT with a CASH line ≥ the sale — or, when that day is already posted, the refusal "already posted" and a posting older than the sale (see Observations); Finance › Stores › Sales by day shows the Cash row of that day = the API | `j3::J3-07 Finance sees the money…` | pass (see Observations for the posted-day branch) |
| J3-99 | screens | no collected miss | `j3::J3-99 [bug] the screens…` | **FAIL (bug F2)** — only F2 |

## J4 — Goods to shelf to sale  (`hub/journeys/j4-goods-to-shelf-to-sale.e2e.ts`)

PO → DC → article setup + tagging → New allotment UI (store-01 8 · store-02 4 · store-03 4) → pick/pack/dispatch → store-01 receives blind → shelf → till sale → Inventory and Sales Explorer agree. Only store-01 has a node: store-02/03 stay on the road.

| ID | Hand-off | Expected | Test | Status |
|---|---|---|---|---|
| J4-01 | PO → DC shelf | 16 pcs delivered/accepted, article set up, labels printed, tagging confirmed: `dc.warehouse` free 4 · 4 · 4 · 4 at head office, PO received 16 | `j4::J4-01 a new article reaches the DC shelf…` | pass |
| J4-02 | Merchandise → allotment | New allotment grid (7 cells), Submit: one allotment, 16 pcs, 3 destinations, per-store totals 8/4/4; DC free 0; On Hand & Shortfall: Stock 16 · Allotted 16 · On hand 0 | `j4::J4-02 rina allots every piece…` | pass |
| J4-03 | allotment → DC outbound | three picklists (one per shop) picked, one sealed carton per shop packed, one truck: 3 shipments; `dc.warehouse` 0 | `j4::J4-03 the DC picks one list per shop…` | pass |
| J4-04 | DC → store | store-01 sees an IN_TRANSIT delivery with no result (blind); counting 8 receives it (expected 8 / received 8); Central shows `received_qty` 8, gap 0; the other two cartons are still IN_TRANSIT | `j4::J4-04 store-01 counts its carton in blind…` | pass |
| J4-05 | store → shelf | Inventory: stockroom 2·2·0·4 → one garment moved to the floor: floor 0·0·0·1, stockroom 2·2·0·3 | `j4::J4-05 a garment goes from the stockroom to the shop floor…` | pass |
| J4-06 | shelf → till | the web till (UI) sells it for cash; node receipt total = the till total; unit `external/customer` | `j4::J4-06 dian sells it at the web till…` | pass |
| J4-06b | catalogue → till | the till names and prices the garment (no "TANPA HARGA") | collected in `J4-99` | **FAIL (bug F2)** |
| J4-07 | all stock views agree | per SKU: DC 0 · stockroom 2·2·0·3 · floor 0 · on the road (`dc.outbound.in-transit`) 2·2·4·0; all 16 pieces accounted for, one sold | `j4::J4-07 Inventory agrees with what happened…` | pass |
| J4-08 | sale → Sales Explorer | the sale reaches head office; Explorer (group article, `q` = tag): one row, `sales_minor` = the amount paid; the Explorer page equals the API | `j4::J4-08 Sales Explorer agrees…` | pass (page check collected in J4-99) |
| J4-99 | screens | no collected miss | `j4::J4-99 [bug] the screens…` | **FAIL (bug F2)** — only F2 |

## J5 — Member points round trip  (`hub/journeys/j5-member-points.e2e.ts`)

| ID | Hand-off | Expected | Test | Status |
|---|---|---|---|---|
| J5-01 | enrol → shelf | a card is enrolled (no purchases, 0 points); a Rp 250.000 garment of ours stands on the floor; the quote earns 25 points; Members lists the card "Never bought" | `j5::J5-01 a shopper is enrolled…` | pass |
| J5-02 | till → member | at the web till (UI) the card is typed: "+25" shown; cash; the node books the sale | `j5::J5-02 dian rings the garment up for her card…` | pass |
| J5-02b | catalogue → till | the till names and prices the garment | collected in `J5-99` | **FAIL (bug F2)** |
| J5-03 | sale → points | the sale reaches head office with her `customer_id`; one EARN of 25 for it in the points ledger; balance 25, earned 25, 1 transaction, spend Rp 250.000; the member sheet reads Points held 25 | `j5::J5-03 head office credits the points…` | pass |
| J5-04 | till → member app | dian types 10 points in Bayar's Poin row and asks; she taps Approve in the member app (REST); the row turns into a voucher ("10 poin ditukar · Rp 10"), the voucher code is read back from `/progress` | `j5::J5-04 dian types 10 points…` | not run (new Bayar flow, 25 Oct) |
| J5-05 | till → hub balance | balance 25 → 15, spent 10; one REDEEM_TO_VOUCHER of −10 with a redemption id; the voucher is in the voucher book; her voucher balance > 0; the member sheet reads 15 / spent 10 / On voucher | `j5::J5-05 the balance drops in the hub…` | pass |
| J5-99 | screens | no collected miss | `j5::J5-99 [bug] the screens…` | **FAIL (bug F2)** — only F2 |

## Findings (new, with evidence)

| # | Finding | Where | Evidence |
|---|---|---|---|
| F1 | **A supplier bill dearer than its delivery cannot be posted while the delivery's pieces are still Unidentified** (accepted at the DC, no article set up yet). The post answers a raw ledger error instead of a sentence: `invalid request: entry does not balance: debits 320000, credits 520000, difference 200000`. The same bill posts at once after the pieces are set up as an article (`J2-09`), so the price-variance fold needs a stock layer (`payables_flow::append_price_correction`). Real flow hit: the supplier invoices what the truck carried (13) while 8 were ordered and 5 went back; the buyer cannot post it until merchandising has set the article up, and is not told so. | J2-11 (`bug`, red) | `POST /api/v1/finance/bills/{id}/post` → 400 above; bill `price_variance_minor` +200.000; after `setUpAndTag` the same call returns POSTED with a balanced entry |
| F2 | **The web till reads one page of the shop catalogue.** `GET /api/v1/store/catalog` answers 100 rows and a `next_cursor` (`limit` up to 500); the till calls it once with no cursor (`pos-desktop/ui/src/api.ts:216-224`, `till.tsx:293`). Any garment whose SKU is not among the first 100 shows `TANPA HARGA`, "Tidak ada di buku harga" and "Ada unit tanpa harga" with a Rp 0 subtotal, although the node's quote prices it (the total on the Bayar button is right — "Sementara — node belum menjawab" shows beside it). Every new article is affected the day it is set up. | J3/J4/J5 `-99` (collected late check) | till screen at failure: `00000155103 · …00000001 TANPA HARGA / Tidak ada di buku harga / — / Subtotal Rp 0 / Diskon … −Rp 19.800 / TOTAL Rp 79.200 / Ada unit tanpa harga`; API `store/catalog` → 100 items, `next_cursor` set, `?limit=1000` → 500 |

## Observations (not asserted as bugs)

* **Shared helpers break on a grown rig**: `rig.ts makeItem`, `po.ts makeItemFast` (hence `newPo`), `outbound.ts makeOwnItem` (hence `ownStock`/`freshStock`) find supplier `0001` in `GET /suppliers?limit=50`; the supplier suite has added hundreds of `GAR…` suppliers that sort first, so they throw "supplier 0001 missing". `finance.ts deliveryItem` uses `?q=0001` and works; journeys use their own supplier. The PO and outbound suites need the same one-line fix.
* **A sale trades for its shift's day**, not the day it was rung (`sales_posting.rs`, 0714). A shift opened before midnight keeps booking to the day before: at 04:50 Jakarta on 10 Oct the sale appeared in Sales (calendar window) on 10 Oct but in Finance (Sales by day, `reports/sales/daily`, takings document) on 9 Oct — and 9 Oct was already posted at demo time, so "generate" answers *already posted* and the sale is not in any entry until that day is reversed. J3-07 asserts the refusal and that the posting is older than the sale when this happens, and the draft's CASH line when the day is open. Money is visible in Finance › Stores › Sales by day either way.
* The Sales Postings **Generate draft** was used (not posted): it replaces a DRAFT in place and touches no ledger.
* Cash → store 1002 / card → Cash in Bank is proven on the posted demo day by `hub/finance/stores-cash.e2e.ts`; the journeys sell cash only (no EDC).
* The cloud was restarted by another session at 21:59 UTC on 9 Oct with `INVENTORY_DC_HOSTING=cloud` (no DC sync to the separate DC node: POs never reached the DC node, every journey stalled at "waiting for PO … at the DC"). The journeys need the rig as provisioned (separate DC node); results below are from the rig in that mode.
* Credit Note submit once answered "Can't reach the server" under VM load (one run, not repeated).
