# POS (till) feature review — does every till feature work end to end against the store edge node?

Reviewed 20 Oct 2026, read-only, against the working tree as it is now (uncommitted edits included).
Clients: `pos-desktop/ui/src` (web edition + Tauri desktop edition, shared `till.tsx`), `pos-desktop/src-tauri/src`,
Android `tablet/app/src/main/java/id/itulah/kasir/**`. Node: `backend/src/edge/{http,till,sqlite,pricing,payment_methods,auth,pin,fingerprint,devices,rfid,escpos}.rs`,
`backend/src/{tender,checkout,refund}.rs`, cloud ingestion where the till's behaviour depends on it.
Nothing was compiled, type-checked or run. The demo rig was read only through `sqlite3 -readonly`.

Confidence labels: **CONFIRMED** = read on both sides of the wire (and, where noted, seen in the demo DB);
**PLAUSIBLE** = the code path is clear but depends on timing/config not verified.

---

## (a) Feature matrix

Legend: OK = works as designed; BROKEN = does not work; PARTIAL = works with a defect worth fixing; MISSING = not implemented; n/a = not applicable to that client.

| # | Feature | Web till | Desktop (Tauri) | Tablet | Node route | Verdict | Refs |
|---|---|---|---|---|---|---|---|
| 1 | Password sign-in | OK | OK unless node is `FINGERPRINT` (see #3) | OK | `POST /auth/login`, `GET /auth/me` | OK / PARTIAL | session.ts:263-302; Api.kt:32-43; http.rs:4028 |
| 2 | PIN sign-in / PIN step-up | n/a (hidden) | OK (signed channel) | MISSING | `POST /auth/pin/claim` (signed) | OK desktop | session.ts:374-397; http.rs:5367 |
| 3 | Fingerprint sign-in (real scanner) | n/a | **BROKEN**: scanner is a stub, and on a `FINGERPRINT` node the login card draws no password form | MISSING | roster/claim (signed) | **BROKEN** | src-tauri/device.rs:84-86,178-186; login.tsx:142-213 |
| 4 | Simulated fingerprint (`VITE_SIM_FINGERS`) | OK (password underneath) | OK (debug-build `simulate_fingerprint`) | n/a | `POST /auth/login` | OK | simulation.ts; login.tsx:128-140 |
| 5 | Lock / unlock, idle lock (10 min) | OK (password) | PARTIAL: no fingerprint unlock | MISSING (no lock at all) | `POST /auth/login` | PARTIAL | lock.tsx; app.tsx:270-298 |
| 6 | Session expiry | 12 h TTL; 30-s poll keeps idle alive; expired → sales silently queue (401) | same | 30-min idle expiry, no keep-alive → forced re-login | auth.rs:80-86,886-895 | PARTIAL | outbox.ts:388-391 |
| 7 | Seat binding (`KASIR-N`) | OK (`?kasir=N`, default `KASIR-1`) | **BROKEN**: terminal id is `POS-01`, or `Kasir N` after joining; never a seat id | **BROKEN**: free text, placeholder `till-01` | `GET /store/tills`, `require_seat` | **BROKEN** desktop+tablet | web.ts:56-67; src-tauri/edge.rs:158; join.rs:369; sync/device.rs:436,480; shift.tsx:556-566; till.rs:349-366; SetupScreen.kt:88-90 |
| 8 | Open shift with float / take-over | OK (`take-over`) | blocked by #7 | PARTIAL: `POST /shifts` only, no take-over; reads *any* shift at the terminal | `POST /store/shifts/take-over`, `POST /store/shifts` | OK web / BROKEN tablet | shift.tsx:396-461; Api.kt:192-205; till.rs:475-542 |
| 9 | Count owed (taken-over drawer) | OK | OK (once #7 fixed) | MISSING | `GET /shifts/mine`, `POST /shifts/{id}/count` | OK / MISSING | shift.tsx:469-498,533-567 |
| 10 | Cash in/out (DROP / PICKUP / PAYOUT / CORRECTION) | DROP(−)/PICKUP(+) OK; PAYOUT/CORRECTION deliberately absent | same | **BROKEN**: DROP signed +, PICKUP −; PAYOUT/CORRECTION always refused (no supervisor sent) | `POST /shifts/{id}/movements` | **BROKEN** tablet | shift.tsx:78-89; ShiftScreen.kt:171; MainActivity.kt:287; till.rs:971-979 |
| 11 | Finish shift, blind count with sheet | PARTIAL: menu "Finish shift" skips the unsent/refused-sales guard | same | PARTIAL: total only, no sheet; shows "Selisih Rp0" to blind cashier | `POST /shifts/{id}/close` | PARTIAL | shift.tsx:652-670 vs 729-745; MainActivity.kt:288-298 |
| 12 | Business date | node-side, OK for on-line sales; queued sales take the *send* time's shift/date | same | n/a (no queue) | till.rs:701-743; sqlite.rs:7785,7956 | PARTIAL | |
| 13 | Seat-lost detection | OK (30-s poll + pre-sale check) | OK | MISSING | `GET /shifts/mine` | OK | app.tsx:95-117; till.tsx:2118-2135 |
| 14 | EPC tag scan, duplicate tag | OK | OK (+ R3 single read on Windows) | OK (UHF sled + wedge) | quote/sale take EPCs | OK | till.tsx:553-616; TillViewModel.kt:284-323 |
| 15 | Barcode/SKU price check, name search | PARTIAL: only the first 100 SKUs of the book are known; `barcode` field never consulted | same | OK (server search) | `GET /store/catalog` (paged, default 100) | **PARTIAL→BROKEN at real range size** | api.ts:213-222; pricing.rs:1016; till.tsx:315-321,594-613 |
| 16 | Unknown / no-price units | PARTIAL: flagged NO PRICE, but payment is still allowed and the node refuses the sale after money is taken | same | PARTIAL: total shows 0 until quote, Pay allowed | quote 404/409, sale 404/409 | **BROKEN flow** | till.tsx:1205-1229; pricing.rs:2201-2210; sqlite.rs:2559-2582 |
| 17 | Stockroom vs floor units | **BROKEN**: no handling; sale refused (409) after payment, basket cleared | same | PARTIAL: auto "lay on floor" needs Supervisor → fails for cashiers | sale moves from `StoreFloor` only; `/store/movements` = InventoryMove (Supervisor) | **BROKEN** | sqlite.rs:7927-7953,2599-2610; Api.kt:163-174; auth.rs:142-148 |
| 18 | Pull from handheld (RFID sessions) | OK (foreign tags not filtered) | OK | MISSING (own sled instead) | `GET /rfid/sessions`, `/{id}` | OK / PARTIAL | till.tsx:1339-1388,1823-1917; rfid.rs:753-777 |
| 19 | Basket grouping (same SKU "× n") | OK | OK | OK | — | OK | till.tsx:357-378; DeskScreen.kt:408-412 |
| 20 | Remove line (EDIT_CART approval) | OK | OK | **MISSING** (no approval) | `POST /store/approvals` | OK / MISSING | till.tsx:780-794; TillViewModel.kt:325-328 |
| 21 | Cancel basket (reason + approval) | OK | OK | **MISSING** (no reason, no approval) | `POST /store/approvals` | OK / MISSING | till.tsx:1265-1292; DeskScreen.kt:306-313 |
| 22 | Hold / resume / discard hold | PARTIAL: survives reload (localStorage); bags dropped on hold; holds shared by every seat/person in that browser | same (WebView storage) | PARTIAL: memory only, no discard UI, no approval | `POST /store/approvals` (DROP_HOLD) | PARTIAL | till.tsx:158-204,762-777,1296-1337; TillViewModel.kt:331-371 |
| 23 | Member | PARTIAL: free text, unvalidated (phantom points accounts) | same | MISSING | `customer_id` on quote/sale | PARTIAL / MISSING | till.tsx:1021-1040,1390-1402; loyalty.rs:53-60 |
| 24 | Coupon (incl. limited-coupon holds) | OK path; unknown code makes the quote fail but Pay stays enabled | same | MISSING | quote/sale + `/store/coupons/{code}/authorize\|release` | PARTIAL | till.tsx:423-461,1404-1417; pricing.rs:2173-2192 |
| 25 | Bags (charges) | OK on bill; **not printed on receipt** | same | MISSING | `charges[]` on quote/sale | PARTIAL | dialogs.tsx:872-897; till.rs:1891-2013 |
| 26 | Quote refresh (250 ms debounce + 2-s poll) | OK | OK | OK (debounce only) | `POST /store/quote` | OK | till.tsx:470-551 |
| 27 | Cash with change | OK (sent as tendered, fixed) | OK | OK (tendered) | `validate_tenders` | OK | till.tsx:2139-2149; tender.rs:314-343 |
| 28 | Debit/Credit + bank + approval code | OK | OK | OK; card overpay not blocked client-side | `card_kind`, `acquirer`, `assert_accepted` | OK | till.tsx:2343-2426; payment_methods.rs:200-247 |
| 29 | QRIS reference | OK | OK | OK | — | OK | |
| 30 | Voucher authorize / hold / release | OK; hold lapses 15 min; not released on refused sale | same | **BROKEN** (no hold → node always refuses) | `/store/vouchers/{code}/authorize\|release`; `VoucherNotAuthorised` | OK / BROKEN | till.tsx:2376-2391; TenderScreen.kt:125-127; tender.rs:234-243 |
| 31 | Employee balance (BENEFIT) | PARTIAL: spend is lost on a refused sale / failed give-back; promo rule only client-asserted | same | PARTIAL: same rule gap, better give-back retry | `/store/benefit/lookup\|spend\|return` | PARTIAL | till.tsx:2189-2319; TillViewModel.kt:395-451; benefit.rs (cloud):508-522 |
| 32 | Split tenders / remove a tender | OK, but **Esc / × drop every recorded tender** (a swiped card leaves no trace) | same | OK (veil guarded) | — | PARTIAL | till.tsx:2223-2236,2448-2472 |
| 33 | Overpay rules | OK (only cash > due) | OK | PARTIAL (card overpay reaches node → 400) | `NonCashOverpayment` | OK | till.tsx:2364-2369; TenderScreen.kt:547 |
| 34 | Payment methods from Finance master | OK; `payment_method_code` silently dropped by node | same | OK; same drop | `GET /store/payment-methods` | PARTIAL | payment-methods.ts; tender.rs:107-157 |
| 35 | Complete sale via outbox, retry, idempotency | PARTIAL: key held across retries (good) but actor/shift re-derived at *send* time; refusals clear the basket; multi-tab clobber | same | PARTIAL: no outbox (by design); **new key per press** | `POST /store/sales` | PARTIAL | outbox.ts; http.rs:2362-2372; TillViewModel.kt:535-605 |
| 36 | Refused-sale handling | **BROKEN**: overlay says "resent automatically"; "Discard" claims the node never recorded it (false on 409-replay) | same | n/a (error stays on basket) | 4xx verdicts | **BROKEN** | till.tsx:833-872,2850-2855; outbox.ts:454-461 |
| 37 | Sale-complete overlay | PARTIAL (shows till's change, not node's) | same | OK (node's change) | — | PARTIAL | till.tsx:2174-2182 |
| 38 | Receipt print / reprint / drawer kick | **BROKEN**: printer can never be configured (Setup unreachable) → no receipts, no drawer | PARTIAL: printer via Peripherals only before joining; queued sales never print or open the drawer; reprint only on the overlay | OK (last sale only) | `POST /sales/{id}/receipt`, `/receipt/escpos` | **BROKEN** web / PARTIAL | app.tsx (no route to "setup"); web.ts:69-117; till.tsx:2794-2829 |
| 39 | Receipt content | node receipt omits bag charges; TOTAL ≠ PAID − CHANGE when a bag is charged | same | same | `receipt_document` | **BROKEN** (live data) | till.rs:1891-2013; escpos.rs:148-174 |
| 40 | Receipt preview screen | dead code (never opened; its Print only closes) | same | n/a | — | MISSING | till.tsx:281,1419-1426; dialogs.tsx:547-617 |
| 41 | Returns (tag scan, disposition, refund method, supervisor) | PARTIAL: needs the full sale UUID; the receipt prints only `receipt_no`; benefit given back before the node agrees | same | PARTIAL: last sale of this app run only; disposition defaults RESALEABLE | `POST /store/returns` | **BROKEN in practice** | returns.tsx:111,726-732,1018-1114; escpos.rs:290; MainActivity.kt:255-260; ReturnScreen.kt:39,93-101 |
| 42 | Void a sale | PARTIAL: UUID only; void after partial return double-counts; no shift attribution; benefit/voucher not reinstated | same | PARTIAL: last sale only, hard-coded reason | `POST /store/sales/{id}/void` | PARTIAL | sqlite.rs:9368-9502; till.rs:1233-1295; cloud sync.rs:7639+ |
| 43 | Redeem points (6-digit code → voucher) | OK (needs HO line) | OK | MISSING | `/store/points/redeem-requests/lookup`, `/{id}/confirm` | OK / MISSING | redeem.tsx; http.rs:2950-3013 |
| 44 | Customer display | n/a (not offered) | OK (BroadcastChannel window) | MISSING | — | OK desktop | customer-link.ts; lib.rs:56-58 |
| 45 | Peripherals screen (printer, drawer, R3, scanner) | n/a | PARTIAL: reachable only from the Join screen (before joining) | Setup has printer + reader power | `POST /devices/self/peripherals` (signed) | PARTIAL | app.tsx:151-161,197-198; peripherals.ts |
| 46 | Device joining / approving a waiting till | n/a | PARTIAL: works, but leaves an invalid seat id (#7) | MISSING | `/devices/join*`, `/devices/joins/{id}/approve\|refuse` | PARTIAL | join.rs:342-389; devices.rs:465-477 |
| 47 | Terminal settings (node URL, terminal no., printer) | **unreachable** | **unreachable** (only via the "waiting tills" badge's Back) | OK | — | **BROKEN** | app.tsx:139-150,190-196; login.tsx:42-48 |
| 48 | Keyboard shortcuts | PARTIAL: F5 (between F4 and F6) reloads and loses the basket; Esc in Payment drops tenders | same (WebView2 F5 PLAUSIBLE) | n/a | — | PARTIAL | till.tsx:710-726; shortcuts.ts |
| 49 | Checkout journal (`/store/checkouts*`) | **unused** | **unused** | **unused** | begin/tender/resolve/unresolved | MISSING | http.rs:504-513; api.ts (no wrapper) |

---

## (b) Findings, ranked HIGH → LOW

### HIGH

**H1. The desktop (Tauri) till can never open a shift — its terminal id is never a seat id.** CONFIRMED.
- The shell's default terminal id is `"POS-01"` (`pos-desktop/src-tauri/src/edge.rs:158`). After joining, `adopt()` sets `held.terminal_id = label.clone()` (`join.rs:369`), and the node's label is `format!("{TILL_LABEL_PREFIX} {number}")` = `"Kasir 1"` (`backend/src/sync/device.rs:436,480`).
- `ShiftGate` looks for `seats.body.find(one => one.terminal_id === terminalId && one.current)` (`screens/shift.tsx:556-558`); seats are `KASIR-1…N` (`till.rs:330-335`). No match → "This till is not set up as a kasir yet (Kasir 1)…". Even if it got past, `take_over` → `require_seat("Kasir 1")` → 400 (`till.rs:349-366`).
- The Setup screen that could retype the terminal number is unreachable (no `setWhere("setup")`/`onGo("setup")` anywhere; only `WaitingTillsScreen`'s Back leads there, and that badge only appears when another till is waiting). The header hides it: `kasirLabel()` makes `"Kasir 1"` look right (`till.tsx:1433-1436`).
- Scenario: fresh install → Join → approved → sign in → dead end at the opening float. The web edition is unaffected (`web.ts:56-67`).
- Fix: at join, store the seat id (`KASIR-${n}`) as `terminal_id` and the label separately (or have `approve_join` return the seat id); validate `KASIR-\d+` in `pointAt`; restore a supervisor-gated Settings entry.

**H2. Money is taken for baskets the node has already said it will refuse; a 4xx at completion then clears the basket and tells the cashier it will be resent.** CONFIRMED.
- The Pay button and F2/F10 only check `units.length > 0` (`till.tsx:715,721,1221-1229`). While the quote fails, `quote.problem` is shown and `total` falls back to `booked + chargeTotal` (`till.tsx:352`), which leaves out unpriced units, coupons and promotions.
- Refusals the quote already reports, or the sale alone discovers: unknown coupon → 400 (`pricing.rs:2173-2192`); unknown EPC → 404 (`sqlite.rs:2559-2582`); NoPrice/NotSellable → 409 (`pricing.rs:2201-2205`); a unit not on the floor (stockroom, already sold, reject) → 409 `insufficient quantity at …floor:on_hand` (`sqlite.rs:2599-2610`, sale moves from `StoreFloor` only, `:7927-7953`); expired voucher/coupon hold → 409 (`sqlite.rs:2421-2428,2509-2516`); a tender the shop is not set up for → 400 (`payment_methods.rs:235-245`); non-cash overpay after the total moved on the 2-s poll → 400 (`tender.rs:325-330`).
- `complete()` enqueues, flushes and calls `onSold({accepted:false, problem})` (`till.tsx:2142-2182`). The outbox marks any 4xx as refused (`outbox.ts:454-461`). The overlay then reads "Saved on this terminal — Waiting to be sent to the node — it is resent automatically. <node sentence>" (`till.tsx:2842-2855`), which is false for a refusal. "Next sale" → `clearBasket(true)` (`till.tsx:1257-1261`). The customer leaves with goods, the drawer holds the money, and the node has no sale. The only action left is "Discard".
- Fix: (1) disable Pay/Complete while `quote.problem !== null`, `quote.stale`, or the node has answered `total_minor:null`, keeping an explicit offline path only when the node is unreachable (status 0/5xx); (2) when the flush's answer for *this* entry is a verdict, keep the Payment dialog open with the sentence, release nothing, and do not clear the basket; (3) fix the overlay copy for refused entries.

**H3. The desktop/web till only ever loads the first 100 SKUs of the price book.** CONFIRMED by reading (masked on the demo: 95 active SKUs).
- `GET /api/v1/store/catalog` is cursor-paged with `limit.unwrap_or(100).clamp(1,500)` (`pricing.rs:1016`, `next_cursor` at `:1054`; the handler returns `next_cursor` at `http.rs:3237`). `api.catalogue()` sends no cursor/limit and reads `items` once (`api.ts:213-222`, `till.tsx:315-321`), and the 2-s refresh does the same (`till.tsx:502-515`).
- In a shop with thousands of SKUs (memory: ~12k articles), most scanned units show "Not in the price book" + `NO PRICE` with "—" prices. The subtotal leaves them out while the Total (from the quote) includes them. The customer display shows blank lines, held-basket totals are wrong, and price check by SKU/name finds nothing past the first 100 codes. `CatalogRow.barcode` is never consulted at all (`till.tsx:594-613`).
- Fix: page through `next_cursor` (the handler already sends an ETag for whole-book revalidation), or do what the tablet does — `GET /api/v1/catalog/identities?skus=` for the basket's SKUs plus server-side `?q=` search.

**H4. Queued (offline) sales are attributed to whoever is signed in when they are finally sent, and the guard that should stop that is bypassed.** CONFIRMED.
- `store_sale` overwrites `actor_id` with the bearer's username (`http.rs:2367-2369`). `complete_sale` stamps `occurred_at = self.clock.now()` (`sqlite.rs:7785`) and attributes the drawer with `shift_for_sale(actor, occurred_at)` (`sqlite.rs:7956`, `till.rs:701-723`). The till never sends when the money was taken: `takenAt` stays local (`outbox.ts:395-406`).
- The outbox is one per browser profile/WebView (`localStorage pos.outbox.v1`), shared by every person and seat.
- Ways a sale gets sent by a different person:
  - The person menu's **Finish shift** opens `ShiftScreen finishing` → `Running` starts with `closing = startClosing` and returns `<Closing>` straight away, skipping the `owed > 0` guard that only disables the panel's own button (`shift.tsx:652-670` vs `729-745`).
  - Lock → unlock with someone else's password (`app.tsx:273-279`).
  - On web, closing the tab (the token lives in sessionStorage, the outbox in localStorage).
- Result: A's sale lands in B's shift (or `shift_id` NULL), with B's business date. A's drawer counts over and B's counts short.
- If A's request had actually landed but the response was lost (10-s client timeout, `web.ts:121`, `src-tauri/edge.rs:401`), B's retry has a different `request_json` (actor) → 409 "idempotency key was already used with a different request payload" (`sqlite.rs:2123-2127`) → marked refused → the Discard confirm says "The node never recorded it" (`till.tsx:860-863`), which is false.
- Fix: send `taken_at` and the original actor; let the node attribute a replay to the shift open at `taken_at` for that actor. Bind outbox entries to actor+seat and block Finish-shift/sign-out/unlock-by-another while entries are owed. Put the guard inside `Closing`. Treat the idempotency-payload 409 as "already recorded".

**H5. Employee-balance (BENEFIT) spends can be lost for good on the desktop/web till.** CONFIRMED.
- `spendBenefit` debits head office before the sale exists (`till.tsx:2259-2302`). If the sale is then refused (H2), neither `clearBasket(true)` nor `forget()` gives it back (`till.tsx:644-668`, `outbox.ts:368-372`).
- `leavePayment` swallows a failed give-back (`till.tsx:2191-2202`) and the next Payment mount mints a new `saleRef` (`till.tsx:2071`), so the old spend is orphaned. The "returns screen" the comment points to needs a sale that does not exist.
- Fix: persist outstanding spends (ref + amount) with the outbox entry or in a durable owed-back list; return them on refusal/discard; retry give-backs; keep the ref until returned (the tablet's `BenefitHold` is a better model, but it is memory only).

**H6. Tablet cash movements are signed the wrong way; PAYOUT/CORRECTION tiles can never succeed.** CONFIRMED.
- `val signed = if (kind == "PAYOUT" || kind == "PICKUP") -value else value` (`tablet/.../ui/ShiftScreen.kt:171`) records **DROP +** and **PICKUP −**.
- The rest of the estate uses DROP −, PICKUP + (node test `sqlite.rs:10705-10707` `DROP … -200_000 "Setor ke brankas"`; store app `frontend-store-new/src/lib/till.ts:218-219`, `lib/queries/sessions.ts:355-358`; desktop `shift.tsx:78-89`). The node does not check sign per kind (`till.rs:939-1016`).
- Scenario: a cashier drops Rp 1,000,000 into the safe from the tablet → expected cash goes up by 1 M → the close shows a Rp 2 M shortage.
- PAYOUT/CORRECTION are offered (`ShiftScreen.kt:139`) but `onMovement` always passes `supervisor = null` (`MainActivity.kt:287`), so the node answers "a PAYOUT needs a supervisor" (`till.rs:971-979`).
- Fix: sign by kind as the store app does; remove PAYOUT/CORRECTION or add the supervisor sheet.

**H7. The tablet's shift model predates seats.** CONFIRMED.
- It reads `GET /shifts/active?terminal_id=<config>` (anyone's shift at that terminal) and opens with `POST /shifts` (`Api.kt:192-205`, `TillViewModel.kt:609-622`). It never calls `/shifts/mine` or `take-over`, and has no count-owed flow.
- The setup placeholder is `till-01` (`SetupScreen.kt:88-90`), which `require_seat` refuses (`till.rs:349-366`).
- With a seat held by A, B on the tablet sees "Shift open" and Pay is enabled (`DeskScreen.kt:662-681`), but every sale is attributed to B's (non-existent) shift → `shift_id` NULL (`till.rs:701-723`). B cannot open (409 "take it over", `till.rs:482-487`) or close (403, `till.rs:679-686`).
- Fix: port ShiftGate (`/shifts/mine`, uncounted, take-over) and validate `KASIR-N` in setup.

**H8. Returns and voids cannot be done from a customer's paper receipt.** CONFIRMED.
- The receipt prints only `receipt_no` (`escpos.rs:290`; `receipt_number()` `till.rs:2021-2041`). The desktop refuses anything matching the receipt-number pattern and asks for the full sale UUID "from the sale's own screen" (`returns.tsx:111,726-732`), but the till has no sale list (the node's `/shifts/{id}/sales` is refused to cashiers, `http.rs:3855-3862`). The UUID is only on screen in the post-sale overlay (`till.tsx:2856`).
- The tablet only returns or voids `state.lastSale` of the current app process (`MainActivity.kt:255-268`; its own copy says so, `ReturnScreen.kt:93-101`).
- Fix: a node lookup by `receipt_no` (or print the sale id as a barcode/QR and accept a scan), usable by a cashier.

**H9. The web till never prints a receipt or opens the drawer; the desktop prints nothing for queued sales; settings are unreachable.** CONFIRMED.
- The web printer config is read from `localStorage pos.web.printer.v1` and only written by `webSetConfig` via the Setup screen (`web.ts:69-117`), which nothing navigates to (see H1). Web peripherals are undefined, so `receiptTarget` gives `ADDRESS` with no host → no print and no message (`peripherals.ts:96-153`, `till.tsx:2857-2859`). `edition.ts:9-12` promises web "receipts on a network printer the node prints to".
- The drawer opens only through the printer pulse on the first print (`till.tsx:2798`; `device.rs:90-97` "opened by the receipt printer"). No printer means no drawer.
- A sale that was queued has `sold.saleId === null`. `print()` returns early once and is never retried when the outbox later accepts (`till.tsx:2794-2829`), and Reprint is disabled — so no receipt, and the drawer never opens to hand change.
- Fix: a reachable, supervisor-gated Settings page (web: printer host/port/paper); a "No sale / open drawer" action via the node; print when the queued entry is accepted.

**H10. A node set to `FINGERPRINT` locks every desktop till out.** CONFIRMED (code), PLAUSIBLE (only when a shop is switched; `pin.rs:3` says production "runs on fingers").
- `realScanner = !isWeb && stepUp === "FINGERPRINT"` → the card draws only the round "Touch to sign in" button and no username/password fields (`login.tsx:142-213`).
- The shell's scanner is a stub: `fingerprint_state()` → `unbound(...)`, and `fingerprint_identify` answers `bound:false` in release builds with "…Masuk dengan nama pengguna dan kata sandi dulu" (`src-tauri/device.rs:84-86,178-186`). That advice is impossible to follow on that card. The lock screen has no fingerprint path either.
- Fix: decide `realScanner` from `device("fingerprint_state").bound`, and always keep the password form reachable.

### MEDIUM

**M1. The node's receipt omits bag/charges, so TOTAL, PAID and CHANGE do not add up.** CONFIRMED with demo data.
- `receipt_document` never reads `sale_charge` and prints `total_minor` (goods only) next to `paid/change`, which include the fee (`till.rs:1891-2013`; `ReceiptDocument` has no charges field, `escpos.rs:148-174`).
- Demo sale `2d01c230-1a71-4baa-8384-feab8864ab31`: total 444,750, paid 450,000, change 4,750, charge 500 → the paper says 450,000 − 4,750 ≠ 444,750. Sale `ed2b2f03…`: total 79,200, paid 79,700, change 0.
- The till's ReceiptPreview even explains the gap (`dialogs.tsx:542-546`).
- Fix: add charges and `amount_due` to the document and print them.

**M2. Esc or × in the payment dialog throws away tenders already taken, and nothing records an EDC swipe.** CONFIRMED.
- `useShortcuts({ Escape: () => !busy && void leavePayment() })` and the field's Escape handler (`till.tsx:2223-2236`) and the × (`:2464-2472`) all leave with `taken` populated. Only the scrim click checks `taken.length === 0` (`:2448-2456`).
- A card already approved on the EDC then exists nowhere. Re-paying swipes the card a second time.
- The seat-lost watcher also unmounts Payment without `leavePayment` (`app.tsx:85-93,240-247`), so voucher and benefit holds are not released.
- The node's checkout journal (`/store/checkouts`, `/tender`, `/resolve`, `/unresolved`, `http.rs:504-513`), built exactly for "money held against no sale", is used by neither till.
- Fix: confirm before leaving with tenders; call `begin_checkout`/`record_tender_outcome`; run `leavePayment` on unmount.

**M3. Voids are wrong in four ways.** CONFIRMED by reading.
- (a) A void after a partial return is allowed (`sqlite.rs:9403-9415`). The Z report then drops all of the voided sale's cash (`status='COMPLETED'` filters, `till.rs:1233-1285`) while still subtracting the earlier return's cash refund (`till.rs:1287-1295`). Example: 2×100k cash, return 1 → void → expected = float − 100k while the drawer holds the float → +100k "over".
- (b) A void carries no shift. Cash goes out of the *current* drawer while the money vanishes from the sale's *original* shift (closed or not).
- (c) Neither the node nor the cloud gives back an employee balance or reinstates a voucher on void. Cloud `apply_sale_voided` only reverses points (`cloud/postgres/sync.rs:7639-7680`).
- (d) `refund_minor` counts goods only, which ignores the bag.
- Fix: refuse void after any return (or net the return), write a refund row on the current shift, and make the refund tender-aware.

**M4. The benefit give-back on a return happens before the node agrees to the return.** CONFIRMED.
- Desktop `returnBenefit` runs before `api.returnSale` (`returns.tsx:1065-1096`); tablet `benefitRefund` runs before `post()` (`MainActivity.kt:417-432`).
- If the node then refuses (wrong tag, voided sale, bad supervisor) or the cashier walks away, the employee keeps the goods and the balance. Head office caps it at the original spend (`cloud/postgres/benefit.rs:598-617`).
- For a mixed-tender sale the node records `refund_minor` = all returned lines under method BENEFIT, while head office got only `min(goods, benefit tender)` back, so the books disagree.
- Fix: post the node return first, holding a pending benefit leg, then return the balance, with retry.

**M5. "No employee balance with a promotion" is enforced only by the till's own say-so.** CONFIRMED.
- The cloud trusts `basket_has_promotion` from the request (`cloud/postgres/benefit.rs:508-522`), and `complete_sale` never checks BENEFIT against applied promotions.
- The tablet sends `false` whenever the quote has not answered yet (`TillViewModel.kt:404`).
- The desktop counts a points-only earn rule (applied, benefit 0, `pricing.rs:2062-2081`) as a promotion (`till.tsx:1241`), wrongly blocking the balance.
- Fix: enforce it at the node on the sale, counting only rules with `benefit_minor > 0`.

**M6. The tablet mints a new idempotency key each time Pay is pressed.** CONFIRMED.
- `val idempotency = Api.key()` inside `sell()` (`TillViewModel.kt:539`).
- After a timeout where the node committed, pressing again → 409 "insufficient quantity at …floor" (the units are sold). The tablet takes that for "from the stockroom", tries `layOnFloor` (fails), and shows a failure for a sale that happened. No receipt prints, and the cashier may charge again.
- Fix: keep the key on the basket until success or until the basket changes.

**M7. "Sold from the stockroom" works nowhere for a cashier.** CONFIRMED.
- The tablet's `layOnFloor` posts `/store/movements`, which needs `InventoryMove`, Supervisor (`http.rs:2207`, `auth.rs:142-148`), so it returns false quietly (`Api.kt:163-174`). Its key `"gudang-"+epc` is per tag forever, so a second trip for the same tag replays.
- The desktop has no path at all (H2).
- Fix: a node-side "sell from stockroom" (move + sale in one transaction under `StoreSale`), matching the owner's ruling quoted in `TillViewModel.kt:547-555`.

**M8. On the tablet, Pay before the quote answers means paying a total of 0.** CONFIRMED.
- `totalMinor = quote?.totalMinor ?: previewMinor` and line prices are 0 until the quote (`TillViewModel.kt:122-125,318`), while Pay is enabled (`DeskScreen.kt:677-686`). The tender dialog is "covered" at once and "Complete sale" sends `tenders: []` → `NoTender` 400 (`tender.rs:196-198`).
- A shop with no price book is unsellable on the tablet (`Quote.from` → `EMPTY` total 0, `Models.kt:121-124`) and effectively on the desktop (empty catalogue, `total_minor:null`). The node itself would charge the intake price (`sqlite.rs:7850-7866`).
- Fix: gate Pay on a successful quote; surface the intake-price fallback.

**M9. The tablet's Voucher tile always fails.** CONFIRMED.
- It is offered with no code and no hold (`TenderScreen.kt:125-127`, `Models.kt:216-221`); the node refuses a voucher without `voucher_authorization_id` (`tender.rs:234-243`).
- Fix: hide the tile or port `authorizeVoucher`.

**M10. The tablet skips the desktop's loss-prevention controls.** CONFIRMED.
- Remove line, cancel sale and park need no supervisor or reason (`TillViewModel.kt:325-377`, `DeskScreen.kt:306-313,535`). Held baskets cannot be discarded at all (`dropHeld` is not wired).
- Return disposition defaults to RESALEABLE (`ReturnScreen.kt:39`); the desktop's rule is "never defaulted" (`returns.tsx:59-68`).
- The void reason is hard-coded to "Dibatalkan di kasir" (`MainActivity.kt:396`).

**M11. Several tablet behaviours fall short of desktop parity.** CONFIRMED.
- The 30-minute session idle timeout (`auth.rs:86,886-895`) with no keep-alive forces re-login in quiet periods.
- There is no lock or idle lock.
- Sign-out leaves the shift open (`MainActivity.kt:172-178`).
- The blind close message shows "Selisih Rp0" because `variance_minor` is nulled for cashiers (`MainActivity.kt:288-298`, `http.rs:3321-3333`).
- There is no member, coupon, bags, redeem or customer display.

**M12. The web till keeps its outbox, holds and method list in localStorage, but each tab works from its own in-memory copy.** CONFIRMED.
- `queue` is read once at module load (`outbox.ts:259`) and `keep()` writes the whole array (`:291-300`), with no `storage` listener. Two tabs, or two `?kasir=` seats in one browser profile, overwrite each other's queued sales and send each other's sales with their own token (H4).
- Fix: the Web Locks/BroadcastChannel pattern or IndexedDB with per-entry keys, and namespace the store by seat.

**M13. `ShiftGate` lets a person sell at this install on a shift they hold at another seat.** CONFIRMED.
- `if (mine.body.open !== null) onReady(seatOf(open))` never compares `open.terminal_id` with this till's seat (`shift.tsx:546-548`). The cash goes into this drawer while the books credit the other seat's shift.

**M14. A pull from a handheld adds tags that are not ours, as they are.** CONFIRMED.
- `const sku = scanned.kind === "epc" ? scanned.sku_code : epc` (`till.tsx:1365-1367`): GS1 or other non-ours EPCs land in the basket → the quote and sale 404 → H2.
- On the tablet, foreign tags on the pad trigger repeated server searches (`UsbReader.kt:247-256` → `TillViewModel.kt:298`).

**M15. The node keeps nothing of `payment_method_code`.** CONFIRMED.
- `SaleTender` has no such field (`tender.rs:107-157`) and the backend has no reference to it. The till's doc says "the node re-derives method/acquirer/card_kind from it" (`api.ts:311-315`), which is false. Two Finance methods with the same type and bank cannot be told apart in the books.

**M16. Unvalidated member numbers create phantom loyalty accounts.** PLAUSIBLE.
- The member is free text (`till.tsx:1390-1402`, placeholder `0812 3456 7788`). The cloud creates a points account for any string (`cloud/postgres/loyalty.rs:53-60`).

### LOW

- **L1. Hold, F5 and scanner focus.**
  - Holding a basket drops its bags: `holdBasket()` saves units/coupons/member, not `charges` (`till.tsx:762-777,1327-1335`).
  - In the web edition, F5 (between the claimed F4 and F6) reloads and loses the basket plus any in-flight voucher/benefit holds (`till.tsx:710-726`).
  - A wedge scan while Payment is open types the EPC's digits into the amount field and Enter takes it as a huge cash tender, or a JSON number past i64 → 422 (`till.tsx:2538-2553,2223-2233`).
  - The first scan after a sale is swallowed by the autofocused "Next sale" (`till.tsx:2872-2879`).
- **L2. The sale overlay shows the till's own change (`changeMinor: change`), not the node's `change_minor`** (`till.tsx:2174-2182`). Rounding remainders under Rp100 drop out of "Hand back" (`till.tsx:208-223`).
- **L3. A voucher hold stays held for 15 minutes after a refused sale** (`cloud/postgres/vouchers.rs:1226`). A re-try can then be told the balance is short.
- **L4. Coupon codes are upper-cased on the till, but the node matches exactly** (`till.tsx:1410-1414,1783`; `pricing.rs:2170-2192`), so a mixed-case code is reported "unknown".
- **L5. The node accepts negative charges** — no guard in the engine or `complete_sale` (`engine.rs:1955-1970`, `sqlite.rs:7885-7909`). The cloud refuses them (`cloud/domain/sync.rs:2453-2455`) and blocks that shop's fact stream. Only a crafted request can do this; the till's `BAGS` are ≥ 0.
- **L6. On an auth-disabled (DEVELOPMENT) node, the desktop ShiftGate fails.** `/shifts/mine` needs `?actor_id=` (`http.rs:3764-3778`, `api.ts:552`), and every relay answers 401 (`http.rs:2800-2811`). This only affects bench rigs.
- **L7. Dead code:** `ReceiptPreview` is never opened and its Print button only closes (`till.tsx:281,1419-1426`; `dialogs.tsx:547-617`). Also unused: `BagPicker`, `api.openShift`, `api.shiftReport`, `device("open_drawer")`.
- **L8. Indonesian copy in an English UI:**
  - Tablet Shift, Return, Setup and notes ("Modal awal", "Retur", "Tunai", "Sesi habis", "Gagal …").
  - Desktop device/shell messages (`src-tauri/device.rs`, `edge.rs:583-585`, `join.rs`).
  - `redeem.tsx` "2 · Konfirmasi", "Permintaan ditemukan", "Nilai voucher".
  - `returns.tsx` "Referensi saldo karyawan", "Misalnya: …".
  - `dialogs.tsx` "Bertanda", "Toko".
- **L9. The tablet's Kotlin EPC decoder accepts non-BCD nibbles**: `append(Int)` writes "10".."15" (`Epc.kt:27-31`). The TS decoder rejects them.
- **L10. Tablet scan mangling and password floor.** `removePrefix("8")` on any non-EPC mangles 11-digit SKUs that start with 8 (`TillViewModel.kt:298`). The supervisor sheet demands at least 8 characters (`SupervisorSheet.kt:111`).
- **L11. Return refund methods are not tied to the original tender.** A CASH refund of a voucher- or benefit-paid sale is allowed (`sqlite.rs:9518-9528`). This is a policy question for the owner.
- **L12. Seat-lost wording.** A shift closed by a supervisor is announced as "taken over" (`app.tsx:89-91`).
- **L13. Latent contract drift.**
  - Kotlin `Quote.from` and `SaleResult.from` read `total_minor` (goods only), not `amount_due_minor` (`Models.kt:130,250`). That is harmless only while the tablet sends no charges.
  - TS `SaleReply.receipt_no` does not exist on the node's `SaleResult` (`api.ts:345` vs `contracts.rs:754-790`); it is unused.
  - The node stamps a queued sale's `completed_at` with the send time, not the time the money was taken (`sqlite.rs:7785`).

### Bugs from the 9–10 Oct list — status
- Cash sent as applied, not tendered — **FIXED** (`till.tsx:2139-2149`; the tablet sends tendered too).
- Benefit UUID reference refused — **FIXED** (`tender.rs:170-175`).
- Bag charges blocking sync — **FIXED** at the cloud (`cloud/domain/sync.rs:2453-2472`; demo has synced bag sales). The receipt still omits them (M1).
- Capped coupons needing online authorisation — **FIXED** on desktop/web (`till.tsx:423-461`); still absent on the tablet (no coupons at all).
- Receipt-number hint regex — **FIXED** (`returns.tsx:110-111`). The underlying "no way to find a sale by receipt" remains (H8).

---

## (c) Checks to run on the live rig / in the web till

Read-only checks (safe now):
1. Catalog paging: `sqlite3 -readonly runs/demo/store-edge.sqlite3 "select count(*) from catalog_item where active=1"` → 95 (< 100, so H3 is hidden here). On a sandbox with more than 100 priced SKUs, call `GET /api/v1/store/catalog` and confirm `next_cursor` is non-null and `item_count ≤ 100`. Then scan an EPC whose SKU sorts after the 100th → "Not in the price book".
2. Receipt arithmetic: `sqlite3 -readonly runs/demo/store-edge.sqlite3 "select id,total_minor,paid_minor,change_minor,charge_total_minor from sale where charge_total_minor>0"` → for `2d01c230…`, 444750 / 450000 / 4750 / 500. Reprint that sale and confirm the paper shows TOTAL 444.750 with no bag line.
3. Seat ids: `select terminal_id,status from cash_shift; select terminal_id,label from edge_terminal` → shifts exist only for `KASIR-*`. Any joined desktop till would show `label` = `Kasir N` (H1).
4. Tablet movement signs (once a tablet has recorded one): `select kind,amount_minor,occurred_at from cash_movement where kind in ('DROP','PICKUP') order by occurred_at desc` → a DROP with positive `amount_minor` came from the tablet (H6).
5. Void after return: `select s.id from sale s where s.status='VOIDED' and exists(select 1 from sale_return r where r.sale_id=s.id)` → compare that shift's `expected_cash_minor` with what was really in the drawer (M3a).
6. Unattributed sales: `select id,actor_id,completed_at from sale where shift_id is null` → none today. Any row after a tablet sale or a delayed outbox flush confirms H4/H7.

In the web till (these create normal rig data — run only on a sandbox, or with the owner's OK):

7. **Refused after payment (H2):** pick a stockroom unit (`select s.epc from inventory_subject s join inventory_projection p on p.subject_id=s.id where p.place_id like '%.warehouse:on_hand' limit 1`). Scan it, pay cash, Complete. Expect "Saved on this terminal … resent automatically" with "insufficient quantity …", the basket cleared, and a red "refused" banner.
8. **Unknown coupon (H2):** add coupon `ZZZ999`. The totals area shows "unknown coupon code: ZZZ999" and Pay is still enabled. Completing is refused the same way.
9. **Finish-shift bypass (H4):** in Chrome DevTools set Network → Offline, ring one sale ("Saved on this terminal", badge "1 not sent"), then person menu → Finish shift. The count sheet appears without the "1 sales not yet sent…" guard; via Shift & cash the button is disabled.
10. **Queued sale attribution (H4):** with DevTools offline, ring a sale as A, close the tab, reopen, go back online, sign in as B with an open shift, return to the counter. `select actor_id,shift_id from sale order by completed_at desc limit 1` → B's name and B's shift.
11. **Esc drops tenders (M2):** take a Debit BCA tender, press Esc, reopen Pay → the tender is gone.
12. **Printing (H9):** confirm there is no way to reach "Terminal settings" from the web till, and that `localStorage.getItem('pos.web.printer.v1')` is null → no receipt after any sale.
13. **Return by receipt number (H8):** paste a printed "No" (`STORE-01-YYYYMMDD-XXXXXX`) into Return → "That is a receipt number, not a sale ID…".
14. **Benefit loss (H5):** on a sandbox, spend an employee balance on a basket that also holds a stockroom unit → the sale is refused → check head office: the balance stays debited, and Discard does not return it.
15. **Multi-tab (M12):** open two tabs, go offline, ring one sale in each, then check `JSON.parse(localStorage['pos.outbox.v1']).length` → 1, not 2.
16. **Fingerprint lock-out (H10, sandbox node only):** `POST /api/v1/auth/methods {"till_step_up":"FINGERPRINT"}` as admin, then open the Tauri till → only "Touch to sign in", with no password form.
