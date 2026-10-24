# Review: a till sale after the store edge records it (edge → cloud sync and cloud bookkeeping)

Read-only review of the working tree as of 2026-10-20, plus SELECT-only checks on the demo rig
(`postgresql:///sim_rig_demo`, `runs/demo/store*-edge.sqlite3`). Nothing was edited, built or restarted.

Confidence labels:
- **CONFIRMED** means I traced it in the code, and where it says so, saw it in rig data.
- **PLAUSIBLE** means the code allows it, but the trigger depends on client behaviour or timing that I did not reproduce.

Paths are relative to `backend/src` unless they start with `pos-desktop/`, `tablet/` or `migrations/`.

---

## Map: which facts travel and who applies them

| Till action (edge) | Fact emitted | Cloud consumer | Status |
|---|---|---|---|
| Sale (`edge/sqlite.rs:7746` `complete_sale`) | `sales.completed` (`sqlite.rs:8145`) + `inventory.movement` (SALE) | `apply_sale` (`cloud/postgres/sync.rs:7255`), `apply_movement` (`sync.rs:5435`) | applied |
| Void (`sqlite.rs:9368` `void_sale`) | `sales.voided` (`sqlite.rs:9461`) + movement (SALE_VOID) | `apply_sale_voided` (`sync.rs:7639`) | applied, but only status + points (see H2) |
| Return (`sqlite.rs:9504` `return_sale`) | **only** `inventory.movement` (SALE_RETURN) | stock only | **money never travels** (H1) |
| Shift open / take-over / movement / close / count (`sqlite.rs:8965-9182`) | `till.shift.recorded`, whole state (`edge/till.rs:2116, 2215`) | `store_money::cash_shift_ingest` (`cloud/postgres/store_money.rs:352`) | applied |
| Petty cash spend / top-up | `store.expense.recorded`, `store.petty_cash.topped_up` | none: passed through as an unknown type (`sync.rs:2733`) | not applied, and purged after 14 days (M5) |
| Voucher hold, coupon hold, benefit spend/return, points redeem | none: synchronous relay to the cloud (`edge/http.rs:2444, 2530, 2667, 2985`) | `vouchers.rs`, `coupons.rs`, `benefit.rs`, `loyalty.rs` | online only |
| Member enrolment at the till | **does not exist**: no route, no fact. The till just attaches a typed or scanned card number. | — | M3 |

Ingest (`sync.rs:416`) refuses a sale only for structural reasons (`domain/sync.rs:194`). Every business check runs at apply time. A failed apply returns `ApplyStep::Blocked`, and `apply_pending` (`sync.rs:2093-2150`) records the block and stops that origin's stream. That means every later sale, shift and stock fact from the store waits behind it. `SetAside` (dead-letter, then advance) is reachable from exactly one arm: goods-receipt invoice with no receipt (`sync.rs:2356`). Nothing lets an operator set aside or skip a blocked fact: there is no route, no CLI, and the only listing endpoint is `GET /api/v1/sync/dead-letters` (`cloud/http/mod.rs:879`).

---

## HIGH

### H1. Store returns never reach head office as money (CONFIRMED, seen live)

- `edge/sqlite.rs:9504-9660` `return_sale` writes `sale_return`/`sale_return_line` (`edge/till.rs:1735`) and enqueues **no money fact**. Only the stock movement (`append_command`, reference_type `SALE_RETURN`) travels.
- The code already admits this. `cloud/postgres/sales_posting.rs:21-24` says "there is no `returns` fact for them to travel on". `cloud/postgres/reports.rs:11-13` says the same.
- **Everything downstream is overstated by every store refund:**
  - `edge_sale` stays COMPLETED at full value.
  - The sales posting (`sales_posting.rs:785-812`) reads only central `sale_return`/`sale_return_payment`, so it posts Dr Cash/Bank and Cr Sales for money that was handed back.
  - The Sales Explorer rollup returns branch (migration `0930`, `sales_rollup_refresh`) reads only central returns.
  - The cloud drawer equation (H5) has no cash refunds to subtract.
  - Points are never reversed. `loyalty::reverse_for_return` / `plan_return_reversal` exist, but nothing feeds them edge returns.
  - The benefit balance comes back only if the till separately calls the relay (see M2).
  - VAT returned is never recorded.
  - The month-close "stale posted day" check (`cloud/postgres/finance_control.rs:579-590`) cannot catch it, because `edge_sale` never changes.
- **Live on the rig:**
  - store-01 sale `27468401…` (318,000 CASH) had a 159,000 CASH return at 10:18:32Z (`sale_return df5c0c69…`). The cloud got only `inventory.movement` seq 319 (received 17:18:33 local).
  - The 2026-10-20 store-01 `sales_posting` was **POSTED at 17:50:08 local** with gross 318,000 and returns_minor 0. The journal is Dr 1002 318,000 / Cr 4002 318,000, posted 32 minutes after the refund.
  - Two more returns today: 66,000 on `2677ff19…` and 79,200 on `cb9db62f…` (that sale is fully returned). Total missing CASH refunds: **304,200**. All three sales are still COMPLETED at full value in `edge_sale`.
- **The return policy is not enforced at the till either:**
  - There is no return window. The cloud's own return path checks Finance's `return_window_days` (`cloud/postgres/returns.rs:85`); the edge `return_sale` has no age check at all.
  - The refund method is free. `sqlite.rs:9518-9528` accepts CASH, CARD, QRIS, EWALLET, BENEFIT and OTHER, and only VOUCHER is refused. Nothing ties the refund method to how the sale was paid. A voucher-paid or benefit-paid basket can be refunded in CASH, which turns stored value into cash.
  - Both clients default to CASH: `refundMethod = "CASH"` on the tablet (`tablet/.../MainActivity.kt:92`) and the same on pos-desktop.
  - This contradicts owner decision 11 as the cloud encodes it: "money never leaves the till" (`sales_posting.rs:842`).
- **Fix:**
  - Emit `sales.returned` inside `return_sale`'s transaction. It should carry: return_id, sale_id, lines (subject_id, epc, sku, refund_minor, disposition), refund_method, refund_reference, the refunding shift_id and business_date, approver, actor, movement_group_id and occurred_at.
  - Cloud applier: idempotent on return_id. It writes `edge_sale_return*` tables and reverses per-line `points_earned` via `plan_return_reversal`. It gives back BENEFIT by sale_ref, keyed on return_id. It feeds the posting by business_date and method, the rollup's returned_qty/refund_minor, the cash equation and the reports.
  - Enforce the return window and the allowed refund methods at the edge, or exchange-only per decision 11.
  - Backfill: replay existing `sale_return` rows from the edge databases.

### H2. A void only flips status and takes back points. Voucher, coupon, benefit, refund method and drawer are all left wrong (CONFIRMED; matches the coordinator's live evidence)

- **Cloud.** `cloud/postgres/sync.rs:7639-7686` `apply_sale_voided` does two things: `UPDATE edge_sale SET status='VOIDED'`, then `loyalty::reverse_for_void`. That is all.
  1. **Voucher not re-credited.**
     - No code path does it, and the schema cannot express it: `voucher_movement.kind` is limited to `('ISSUE','REDEEM','VOID')` (`migrations/postgres/0090_a_voucher_carries_money.sql:141`).
     - Live: `dc04952d…` paid VOUCHER 60,000 (QAGIFT100) + CASH 126,750 and was voided. QAGIFT100 kept only ISSUE + REDEEM; its last 40,000 was later spent by `2d01c230…`. The 60,000 is gone.
  2. **Coupon redemption not cancelled.**
     - `coupon_redemption.status` supports `CANCELLED`, and every exhaustion count excludes it (`cloud/postgres/coupons.rs:1102-1112`).
     - But nothing anywhere writes `status='CANCELLED'`. The only CANCELLED writer is for coupon codes (`coupons.rs:2023`).
     - So single-use QASEKALI stays SET_EXHAUSTED after its sale `83cbd23a…` was voided. The rig shows 2 voided sales whose redemptions are still REDEEMED.
  3. **Benefit balance never given back on a void.** Nothing does it on any layer: the edge `void_sale`, the cloud `apply_sale_voided`, the pos-desktop void screen (`pos-desktop/ui/src/screens/returns.tsx:1426`, which calls only `api.voidSale`), or the tablet `voidSale` (`tablet/.../data/Api.kt:278`).
  4. **Usage counters are not wound back, on purpose.** The docs say so: `domain/sync.rs:1993-2005` and `sync.rs:7631-7637`. That explains campaign `qa-dogfood` still at 7 uses / 256,550. If the owner wants budgets to reflect net giving, that is a decision to take, not a bug.
  5. **Void details are lost after 14 days.**
     - `refund_minor`, `reason`, `approved_by` and `actor_id` are parsed (`domain/sync.rs:2009`) and then dropped.
     - `edge_sale` only gained `status` and `voided_at` (`0354`).
     - The fact payload itself is purged after 14 days (M5).
- **Edge.** `edge/sqlite.rs:9368-9500` `void_sale`:
  1. `refund_minor` is one number over all outstanding lines (`sqlite.rs:9449`), with no per-tender split and no refund method. The till shows "hand back 186,750" for a basket that was 60,000 voucher.
     - Live: `b4094f1f…` was paid QRIS 143,100, which settles straight into BCA, and was voided. Nobody recorded whether the money went back through QRIS or as cash from the drawer.
  2. **The void is attached to no drawer.**
     - `mark_voided` (`edge/till.rs:1836`) stores no shift. The Z report only removes the sale from its *original* shift (`till.rs:1231-1245`).
     - If a sale from a closed shift is voided today and refunded in cash, today's drawer comes up short with nothing explaining it.
     - The old shift's `expected_cash_minor` is recomputed live, while its stored variance does not change (`till.rs:1385-1388`).
  3. **Return then void is double-counted in the Z report.**
     - `expected_cash = movements + cash sales(COMPLETED) − change − cash refunds(all sale_return rows)` (`till.rs:1236, 1287-1291, 1334`).
     - Example: sale 318k cash, return 159k cash, then void the remaining 159k. The drawer nets 0. The Z expects −159k, so it reports a 159k **over**.
- **Fix:**
  - `sales.voided` should carry the per-tender refund split and the voiding drawer's shift_id and business_date.
  - The edge should record the void refund against the voiding person's shift.
  - The cloud should: re-credit the voucher (new movement kind such as `REVERSAL`), set `coupon_redemption.status='CANCELLED'`, give back BENEFIT by the tender's reference, keep the void's reason, approver and refund, and bind the void to its origin (M6).

### H3. One voucher problem blocks the store's whole stream, and the code-normalisation mismatch makes that deterministic (CONFIRMED by code; triggers 2 and 3 PLAUSIBLE)

- `apply_sale` calls `vouchers::commit_voucher_hold_for_fact` (`sync.rs:7419`). Any `Err` it returns blocks the stream (`sync.rs:2454-2459`).
- Unlike coupons, which use a savepoint, record an exception and never block (`coupons.rs:1439-1500`), the voucher path **errors on business conditions** (`cloud/postgres/vouchers.rs:1564-1765`):
  1. **Hyphenated code (deterministic):**
     - The edge relay accepts `-` in codes (`edge/http.rs:2435`).
     - The hold record stores the code **as the till typed it** (`http.rs:2832` → `voucher_hold_record`, `code: code.to_owned()` at `http.rs:2871`, then uppercased at `sqlite.rs:7676`), not head office's normalised `held["code"]`.
     - The sale fact copies that string (`sqlite.rs:8118`).
     - The cloud's `normalize_code` strips `-`, `_` and whitespace (`cloud/domain/voucher.rs:183-196`). So the stored code is `QAGIFT100` while the fact says `QA-GIFT-100`.
     - `vouchers.rs:1623` compares `actual_code != tender_code.trim().to_ascii_uppercase()` **without normalising**, returns `Conflict`, and the stream blocks.
     - Pre-printed cards with dashes ("a shop with pre-printed cards has the code before the system does", `voucher.rs:207`) hit this on their first use.
  2. **Hold released at head office before the sale fact lands:**
     - `relay_voucher_release` (`http.rs:2896-2912`) relays to head office **first** and never checks the local hold. `close_voucher_hold` (`sqlite.rs:7687`) silently ignores a USED hold.
     - Any release of a basket's hold after its sale was written makes head office's status RELEASED. The later fact then fails at `vouchers.rs:1689` and blocks.
     - pos-desktop does not do this in its normal flow: after `complete()` it shows "Saved on this terminal" and does not go back to payment. But the endpoint has no guard.
  3. **Lapsed hold overspent:**
     - The hold is 900 s (`vouchers.rs:1226`). Head office stops protecting a lapsed hold (`available_minor`, `vouchers.rs:1233-1247`).
     - If a store's upload is late by more than 15 minutes (line down after the hold was granted) and another store holds and spends the rest of the card, the late fact fails at `vouchers.rs:1709` with "took X but only Y unheld". The block is **intentional** ("blocks the stream on purpose").
  4. Amount or site mismatch (`vouchers.rs:1611, 1617`) can only come from a buggy client, but it would block too.
- **Impact:** a blocked store stops showing sales, shifts and stock at head office until engineering edits the database. Nothing (endpoint, CLI or screen) lets an operator set aside a fact.
- **Fix:**
  - Normalise both sides: compare `normalize_code(tender_code)`, and store `held["code"]` on the edge.
  - Wrap the voucher commit in a savepoint and record a `voucher_hold_exception`, as coupons do. Keep the sale and let a person resolve the voucher.
  - The edge relay should refuse to release a USED hold.
  - Add an audited operator "set aside blocked fact" action, reusing `set_aside` (`sync.rs:5650`).

### H4. Head-office sales reports count voided till sales and ignore the shift's business date (CONFIRMED, seen live)

- The `edge_sale` branches have **no `status = 'COMPLETED'` filter**, while the central branches do:
  - `daily_sales_report`: totals `reports.rs:61-63`, units `78-86`, tenders `97-98`.
  - `sales_series`: `reports.rs:246-249`. Its own doc at `:204` says "Only COMPLETED sales count".
  - `sales_window`: totals `389-391`, units `408-410`, tenders `426-427`, receipts list `485-487`. Its doc at `:333` warns against "a count that includes voided sales".
- `voided_count` counts only central `sale` voids (`reports.rs:111`, `:439`), so till voids show 0.
- `sales_series` and `sales_window` bucket by `occurred_at`, not `business_date`. They disagree with the daily report and the posting for any sale after midnight on an evening shift.
- Callers:
  - Hub: `frontend-hub/src/screens/finance-final/sales.tsx`, `sales-reconciliation.tsx`, `reports/sales-register.tsx`, `lib/queries/analytics.ts`.
  - Store app: `frontend-store-new/src/screens/money/sales.tsx`, `lib/sales-window.ts`, the dashboard.
  - The assistant: `cloud/http/assistant.rs:1877, 1891`.
- Live, store-01 2026-10-20 via the daily report SQL:
  - gross 1,916,200 / 10 sales, against COMPLETED 1,199,350 / 6. That is 716,850 of voided sales included.
  - The 304,200 of returns is not deducted (H1).
  - net 1,915,200 against gross 1,916,200 with tax 0 breaks the advertised "gross = net + tax" (`reports.rs:189`) because of the bag fees (M1).
- **Fix:**
  - Add `AND status='COMPLETED'` to every `edge_sale` branch.
  - Use `business_date` for till sales.
  - Count till voids.
  - Report charges separately: goods = `total_minor − charge_total_minor` once M1 is fixed.

### H5. Head office's drawer equation is wrong for every shift (CONFIRMED, seen live)

`cloud/postgres/store_money.rs:435-518` `cash_shift_equation` computes float + Σ CASH tenders + signed movements. The error sources:

1. It **does not subtract change given**. `cashier_equation` (`cloud/domain/store_cash.rs:80-111`) only adds.
2. It **includes voided sales**: there is no status filter at `store_money.rs:461-469`.
3. It **has no cash refunds**, because returns do not travel (H1).
4. Sales with NULL `shift_id` (a cashier with no seat, which current builds still allow, `till.rs:688-705`) are matched by a site-wide time window. They are counted in **every** shift open at that time.

Live:
- Shift `4b9d521e…`: the shop's expected cash is 1,184,000 (float 500,000 + cash 740,000 − change 56,000). Head office computes **1,240,000**, a phantom −56,000 variance against the declared 1,184,000.
- Open shift `a20f8ba9…`: the shop expects 592,900 (500,000 + 258,900 − 20,800 − 145,200). Head office computes **1,272,650**, off by 679,750: voided cash 513,750 + change 20,800 + cash refunds 145,200.

The shop's own `expected_cash_minor`, carried on the fact, is right. Only head office's recomputation shown beside it (`cloud/http/store_money.rs:248`) is wrong.

**Fix:** COMPLETED only; cash = Σ CASH tenders − Σ change_minor; subtract cash refunds and void refunds once they travel; drop the NULL-shift window or limit it to single-seat stores.

---

## MEDIUM

### M1. Bag and fee charges reach head office as an unexplained difference (CONFIRMED; the coordinator's sale `ed2b2f03…`)

- **Edge.**
  - The edge keeps everything: `sale.total_minor` 79,200 (goods), `charge_total_minor` 500, `charge_net_ex_tax_minor` 500, `charge_tax_minor` 0, and a `sale_charge` row (BAG, "Kantong plastik kecil", 500, STANDARD).
  - The fact (`sqlite.rs:8145-8270`) sends `total_minor` = amount due (79,700), `charge_total_minor` (500, at `:8164`), and **no `charges[]`, no `charge_net_ex_tax_minor`, no `charge_tax_minor`**.
- **Wire type.** `SalesCompletedPayload` (`cloud/domain/sync.rs:2270-2337`) has only `charge_total_minor` (`:2284`). It is used solely to make `parse_sales_completed` balance (`:2459-2476`), the 10-Oct fix.
- **Cloud.**
  - The `apply_sale` INSERT (`sync.rs:7280-7290`) does not write `charge_total_minor`, `charge_net_ex_tax_minor` or `charge_tax_minor`.
  - **Nothing in the cloud writes `edge_sale_charge`**, though `0169` created it and the three columns.
  - Result: `edge_sale.total_minor` = 79,700 (goods + fee) with `charge_total_minor` NULL, so the fee cannot be told apart from goods.
- **Where the 500 lands:**
  - **Ledger.** The fee is inside the CASH tender, so `read_day` (`sales_posting.rs:658-700`) buckets it. `build_with` (`domain/sales_posting.rs:488-560`) posts **Dr 1002 Cash / Cr 4002 Penjualan Tunai**. The fee is booked as merchandise sales under its tender's revenue account, not as fee or other income. (Card fees would land in 4003/4007…)
  - **Tax.** `read_recorded_vat` adds `SUM(charge_tax_minor)` (`sales_posting.rs:573-583`). That is always NULL, so 0, and the fee's PPN disappears from recorded VAT. Here the rate is 0% so the value is 0, but it would be understated on a taxed book. Posted VAT is 0 by policy P11.
  - **Reports.** `daily_sales_report`/`series`/`window` show gross = 79,700 and net = `net_ex_tax_minor` = 79,200, so the 500 shows up as "gross − net − tax". The Sales Explorer (`sales_sku_day`, summed from lines) shows 79,200, so the Explorer and the ledger differ by every fee. Membership `spent_minor` (`membership.rs:111`) includes the fee.
- **Fix:**
  - Add `charges: [{charge_seq, code, description, amount_minor, net_ex_tax_minor, tax_minor, tax_category}]` plus the two split totals to the fact, and validate Σ = `charge_total_minor`.
  - Write `edge_sale.charge_*` and `edge_sale_charge` in `apply_sale`.
  - Give fees their own posting meaning.
  - Subtract charges from goods in the reports.
  - Backfill: per-charge detail exists only on the edges (`sale_charge`). The fact payload has `charge_total_minor` but is purged after 14 days.

### M2. A BENEFIT tender is not bound to a head-office spend (CONFIRMED in code; the abuse is PLAUSIBLE)

- **Not bound at sale time.**
  - The edge `validate_tenders` only needs a non-empty `reference` (`tender.rs:246-259`).
  - The edge keeps no record of the relayed spend. That is unlike vouchers (`voucher_hold`) and coupons (`coupon_hold`).
  - The cloud `apply_sale` stores the tender and posts Dr `sales_discount` (`domain/sales_posting.rs:334`). Nothing compares it with `benefit_entry` SPEND rows (`cloud/postgres/benefit.rs:502-584`). There is no amount, single-use or site check.
- **Consequences:**
  - An offline or modified client can settle any basket with BENEFIT and a made-up reference and walk out with free goods.
  - A spend of 100k against a basket that later rings 80k leaves 20k lost.
  - Two sales can quote one spend.
- **Give-back relies on the till's best effort:**
  - Abandoned basket: `leavePayment` (`pos-desktop/ui/src/till.tsx:2189-2215`), tablet `releaseBenefit` (`TillViewModel.kt:418`). Failures are swallowed.
  - **Return:** both clients give the balance back at head office **before** the edge accepts the return (`pos-desktop/ui/src/screens/returns.tsx:1065-1083`, `tablet/.../MainActivity.kt:418-430`). If the edge then refuses (wrong supervisor, EPC already returned), the employee keeps the goods and gets the balance back.
  - A tablet sale's benefit ref is only offered for the **last** sale on that tablet (`MainActivity.kt:97-99`).
  - On the tablet, `sell()` mints a new idempotency key on each tap (`TillViewModel.kt:539`). If a socket times out after the node wrote the sale, the retry is refused with a floor conflict. If the cashier then clears the basket, `clear()` calls `releaseBenefit()`, which gives back a balance the sold basket used.
- **Fix:**
  - Have the edge record the relayed spend (benefit_hold) and require it at sale: same amount, one use.
  - In `apply_sale`, bind BENEFIT tenders to the SPEND by sale_ref (amount, unit, unused), with an exception table on mismatch.
  - Do give-back at head office when the return or void fact lands, not before.

### M3. Points go to any typed number; the tablet never sends a member (CONFIRMED)

- **pos-desktop.** The member panel passes raw text (`pos-desktop/ui/src/till.tsx:1398`, `setCustomerId(memberFromScan(code) ?? code)`, placeholder "0812 3456 7788"). There is no lookup and no normalisation.
- **Edge.** The engine earns whenever `customer_id` is Some (`crates/pricing-engine/src/engine.rs:414`).
- **Cloud.**
  - `earn_from_sale` (`cloud/postgres/loyalty.rs:132`) runs `lock_account`, which creates `points_account` for **any** string (`loyalty.rs:51-75`). There is no FK to `member` (`0165:37`).
  - `membership.rs:1040-1105` already lists "unenrolled" cards, so typos accumulate there.
  - "0812 3456 7788" and "081234567788" become two accounts.
  - There is **no member enrolment at the till**: no edge route, no fact.
- **Tablet.** `api.sale(epcs, tenders, emptyList(), null, idempotency)` (`tablet/.../pos/TillViewModel.kt:544, 581`) always sends coupons `[]`, `customer_id` null, and no charges or coupon holds. Tablet sales never earn points, never take a coupon and never carry a bag fee.
- **Fix:** look the member up at head office (or in an edge member snapshot) and normalise digits. The cloud should earn only for a known member, or park the points. Complete the tablet's sale payload.

### M4. Voucher codes, which are bearer value, are stored in plain text as tender references (CONFIRMED, seen live)

- `edge_sale_tender.reference` holds `GIFT100SARI`, `QAGIFT100` and `qagift100`.
- Codes are minted as bearer tokens (`domain/voucher.rs:198-215`).
- QAGIFT100 was visible in the sales register while it still held 40,000. Anyone with report access could spend a remaining balance at any store.
- **Fix:** mask the code (last 4) on the edge `sale_tender` and in the cloud, and scrub existing rows.

### M5. Petty-cash and expense facts are "kept for a future applier" but purged after 14 days (CONFIRMED)

- `store.expense.recorded` and `store.petty_cash.topped_up` pass through unapplied (`sync.rs:2733`; the edge notes this at `sqlite.rs:1916-1924` and `edge/petty.rs:150-167`).
- `purge_applied_ingest` (`sync.rs:5717-5729`) deletes every applied ACCEPTED receipt older than `SYNC_RETENTION_DAYS` (default 14, `cloud/application/mod.rs:217`), unknown types included.
- The edge also purges synced facts (`edge/sync.rs:202`).
- The rig's oldest receipts (14 Oct) start disappearing on 28 Oct.
- **Fix:** exclude unapplied types from the purge, or write the applier.

### M6. A void is not bound to its origin, and a void with no sale row is silently dropped (CONFIRMED in code)

- `apply_sale_voided(&mut tx, &voided)` (`sync.rs:2466, 7639`) gets no origin. `UPDATE edge_sale … WHERE sale_id=$1` lets any registered store's stream void any store's sale by id.
- If the sale row is not there (its fact is blocked or in another generation's stream, or was tombstoned), `flipped == 0` returns `Ok`. The void is consumed and lost, and the sale later lands as COMPLETED.
- **Fix:** require `edge_sale.origin_id = origin` and the site. If the sale is unknown, block or park the void in a pending table.

### M7. A sale is stamped when it reaches the node, not when it was rung (PLAUSIBLE)

- `SaleRequest` (`edge/contracts.rs:496-537`) has no rung-at time, and `occurred_at = self.clock.now()` (`sqlite.rs:7785`).
- The pos-desktop outbox delivers late if the node was down (`pos-desktop/ui/src/outbox.ts`). That gives the wrong shift and business date (`shift_for_sale`, `till.rs:701-725`), re-pricing against the current book, and refusals of expired voucher or coupon holds after the goods have left. A refused entry waits for a person.
- **Fix:** carry the till's rung-at time (bounded) and use it for shift, day and hold checks.

### M8. DIRECT_TO_BANK picks a bank by guesswork on stores with more than one EDC bank (PLAUSIBLE)

- Card networks (VISA, MASTERCARD) arrive as `acquirer`, and `terminal_id` is never sent on the fact (the edge never fills it).
- `read_day` (`sales_posting.rs:898-925`) uses the EDC bank only when the acquirer *is* a bank or the store has exactly one EDC bank. Otherwise it falls to the company's primary GIRO account.
- On a store with BCA and Mandiri EDCs, every credit card posts to the primary bank instead of the EDC's own bank. Today store-01 has one EDC (BCA), so the rig posts correctly (1005).
- **Fix:** send the terminal or EDC on card and QRIS tenders, and raise an exception instead of guessing.

---

## LOW

| ID | Defect | Where | Confidence |
|---|---|---|---|
| L1 | `cash_shift_ingest` takes `site_id` from the payload, not the origin. `apply_sale` checks it (`sync.rs:7271-7277`); shifts do not. | `store_money.rs:352-400` | CONFIRMED |
| L2 | Float and variance postings use the UTC date. A shift opened before 07:00 WIB books its float on the previous day. | `store_money.rs:549, 659` | CONFIRMED |
| L3 | The shift fact omits a drop's `received_by` and the count sheets. Head office cannot see who took a drop. | `till.rs:2162` vs `till.rs:1302` | CONFIRMED |
| L4 | Coupon commit compares the edge's business-clock `occurred_at` with head office's wall-clock `expires_at`. Clock skew turns good holds into `coupon_hold_exception`s. It never blocks; 0 such rows on the rig. | `coupons.rs` `commit_fact_hold` | PLAUSIBLE |
| L5 | `commercial_usage` is incremented even when the coupon hold commit was skipped, so counters and `coupon_redemption` diverge. | `sync.rs:7443-7535` | CONFIRMED |
| L6 | Points redeem confirm checks the request, commits, then redeems in a new transaction. A cancel in between still issues the voucher. Double confirms are safe (idempotency key = request_id). | `loyalty.rs:788-861` | PLAUSIBLE |
| L7 | A fact line's `unit_price_minor` is looked up by `sku_code` (first quote line for that SKU), not by position. | `sqlite.rs:8187-8197` | CONFIRMED; impact small |
| L8 | The "strangers" member list lacks the COMPLETED filter. | `membership.rs:1093-1103` | CONFIRMED |
| L9 | A void keeps the bag fee but the whole sale leaves the day. The drawer and the bank keep the fee money with no revenue behind it. | `sync.rs:7645`, `sales_posting.rs:676` | CONFIRMED |

## Known history: re-checked

- **Bag charge blocking the stream:** fixed (`domain/sync.rs:2459-2476`), but the charge detail is still dropped (M1).
- **ns vs µs timestamps:** the only exact equality comparisons are `sync.rs:3556` and `sync.rs:4530`, and both use `timestamp_micros()`. I found no other exact timestamp equality in the sale, void, shift, voucher or coupon appliers. The coupon commit uses `>=` against the edge's business clock (L4).
- **Empty SQLite reusing (origin, generation, seq):** fixed. `admit_batch` (`domain/sync_generation.rs:303`) refuses unknown facts at or below the watermark and raises an integrity alert. The edge re-handshakes automatically (`edge/sync.rs:4476-4493`). What remains is by design: facts not yet durable at the moment the database was lost are gone.
- **Limited coupon hold committed on landing:** correct, and it never blocks (`coupons.rs:1439-1500`). Contrast vouchers (H3).
- **Mitigation that exists:** month close flags a posted day whose COMPLETED count or gross changed later (`finance_control.rs:579-590`). That catches late sales and voids after posting, but never returns (H1).

---

## Current rig health (read-only, 2026-10-20 ~19:10 WIB)

**Streams and queues**
- Cloud `sync_applied_watermark`: dc 433, store-01 409, store-02 128, store-03 33. Applied equals durable on all four, with no `blocked_at_seq`.
- `sync_dead_letter` is empty on the cloud and on all three store edges. `sync_integrity_alert` is empty. `coupon_hold_exception` is empty.
- store-01 edge: `next_seq` 409 = durable 409, breaker closed, command watermark 810 not blocked, `commercial_usage_local` empty.
- Holds: voucher_hold 3 USED; coupon_hold 2 USED, 1 RELEASED.

**Money wrong while sync looks healthy**
- Returns: 3 till returns (304,200 CASH) are not at head office (H1). Store-01 2026-10-20 was posted with gross 318,000 and returns 0 *after* a 159,000 refund.
- Voids: 4 voided sales at head office (716,850). The daily, series and window reports still count them (H4). The cloud drawer equation counts their cash (H5).
- Bag sale `ed2b2f03…`: cloud `charge_total_minor` NULL, `edge_sale_charge` 0 rows. The edge has a `sale_charge` row and `charge_total_minor` 500 (M1).
- Drawer equation: −56,000 phantom on shift 4b9d521e; +679,750 on open shift a20f8ba9 (H5).
- QAGIFT100: the 60,000 redeemed by voided `dc04952d…` was not re-credited. The rest was spent later, and the voucher is now SPENT (H2).
- Voucher codes visible as tender references (M4).

---

## Live tests to confirm the top suspicions

Tests 1–3 **will block a store stream**, and recovery needs a manual DB edit. Run them on a scratch store (store-03) or accept a reset.

1. **H3 hyphen block.**
   - Steps: issue a voucher with a supplied code `QA-DASH-01`; head office stores `QADASH01`. At pos-desktop, type `QA-DASH-01`, hold 10,000, ring a sale with it.
   - Expect: `sync_applied_watermark.blocked_reason` contains "names voucher code \"QA-DASH-01\", but its hold belongs to \"QADASH01\"". Every later fact from that store stays unapplied.
2. **H3 release after sale.**
   - Steps: hold a voucher via `POST /api/v1/store/vouchers/{code}/authorize` with checkout_id X. Stop the store's uploads (point `SYNC_UPLOAD_URL` away, or stop the cloud ingest). Complete the sale. `POST …/{code}/release` with checkout_id X; head office should answer 200 / RELEASED. Restore uploads.
   - Expect: blocked with "names a hold that was RELEASED".
3. **H3 lapsed overspend.**
   - Steps: hold the whole balance at store A, stop A's uploads, complete the sale. Wait more than 15 minutes (or advance head office's clock). Hold and spend the voucher at store B. Resume A.
   - Expect: blocked with "only … unheld".
4. **H1 return.**
   - Steps: on a member sale paid CASH + BENEFIT, return 1 of 2 units as CASH.
   - Check: the cloud has no return row; `edge_sale` unchanged; points unchanged; `benefit_entry` has no RETURN (pos-desktop's BENEFIT path gives it back only for method BENEFIT); the generated or posted sales posting has returns_minor 0; the Explorer `sales_sku_day.returned_qty` is 0.
5. **H2 void with BENEFIT.**
   - Steps: spend 50,000 of an employee balance, sell, void.
   - Expect: `benefit_entry` keeps only the SPEND, and the balance is still 50,000 lower.
6. **H2 edge Z double count.**
   - Steps: in one shift, sell 2 units cash, return 1 (CASH), void the sale.
   - Check `GET /api/v1/store/shifts/{id}`. Expect `expected_cash_minor` lower than the drawer by the return amount.
7. **H2 cross-shift void.**
   - Steps: close shift A with a cash sale, open shift B, void A's sale and hand cash back.
   - Expect: B's Z shows no outflow, so a variance equal to the refund at count.
8. **H4.** `GET /api/v1/reports/sales/daily?site_id=store-01&date=2026-10-20`. Expect gross 1,916,200, count 10, voided_count 0. Correct is 1,199,350 / 6 before returns.
9. **H5.** Open the head-office cash shift equation for `a20f8ba9-5c3d-4fc2-b18d-a20700d6c8a2` and `4b9d521e-2d37-4a03-bab5-205db10174ae` (`cloud/http/store_money.rs:248`). Expect 1,272,650 and 1,240,000; the shop says 592,900 and 1,184,000.
10. **M1.**
    - Steps: generate a draft posting for a day with a bag sale (do not post).
    - Expect: the CASH bucket includes the fee, credited to 4002. `vat_recorded` excludes the fee's tax. The Explorer net is lower than the posting gross by Σ fees.
11. **M2 forged BENEFIT.**
    - Steps: `POST /api/v1/store/sales` with a single tender `{method:"BENEFIT", amount_minor:<total>, reference:"<random uuid>"}` and no spend at head office.
    - Expect: the edge accepts, the cloud stores it, and a draft posting debits `sales_discount`.
12. **M3.**
    - Steps: at pos-desktop, add member "0812 3456 7788" (with spaces) on an earning basket.
    - Expect: a `points_account` with that exact id; no row in `member`. On the tablet, any sale gives `edge_sale.customer_id` NULL.
13. **M6.** Replay a `sales.voided` payload for a store-01 sale through another store's credential (debug ingest). Expect the store-01 sale to be flipped to VOIDED.
