# E2E report B — New articles → Allotment → Outbound → Store receive

Tester: agent B (QA), rig pos-e2e, hub http://localhost:5480 as rina, 2026-10-01 23:30 – 2026-10-02 00:30 WIB.
Viewport emulated at 1440x900 in the Browser pane.

**Status: sections 1–2 tested; sections 3–5 BLOCKED.** At 00:03 the rig's cloud/dc/store were stopped and the
cloud cannot start again: `runs/pos-e2e/logs/cloud.log` ends with `Error: Migration(VersionMismatch(816))`.
Cause: two migrations share version 0816 and two share 0817 —
committed `0816_an_employee_asks_for_their_details_to_be_changed.sql` / `0817_overtime_lands_on_the_overtime_expense.sql`
(commit 76f0009, HR) vs. untracked `0816_global_search_finds_a_supplier.sql` / `0817_a_purchase_order_can_carry_payment_terms.sql`.
Polled for 25 min; still down at 00:27. The hub login page shows "Bad Gateway · Central can't be reached".

Tooling note (not an app bug): with viewport emulation on, the Browser pane maps click coordinates
with a ~4.15x factor (a click at (400,250) arrived at (1661,1038)). Early "sheet closes on click"
observations were caused by this and are NOT app bugs. All clicks after that were corrected.

## Steps

| # | Step | Result | Notes |
|---|------|--------|-------|
| 1.1 | New articles sheet opens (/master?setups=true), wide | PASS | Dialog 1400x860 at 1440 viewport; header "61 deliveries · 390 pieces waiting" |
| 1.2 | PO rail + Articles rail sticky when scrolling the form | PASS | Both rails stay in place while the form column scrolls |
| 1.3 | Roomy spacing, no hairline rules between form sections | PASS | No hr/separator elements in the dialog; no text under 14px found |
| 1.4 | Name suggestions on 2 letters | PASS | "Lo" → Sneakers Kanvas Low, Loafers Kulit Sintetis |
| 1.5 | Base price = purchase price blocked | PASS | "Must be above the purchase price, Rp 215.000", markup 0 % |
| 1.6 | Base price below purchase blocked | PASS | Same message, markup -53.5 % |
| 1.7 | Valid base price | PASS | 299.000 → markup 39.1 % |
| 1.8 | Colours + sizes grid, SKU with 0 = "Not created" | PASS | Footer "3 SKUs will be created. A size with no pieces is left out." Counter "6 of 6 · 3 SKUs" |
| 1.9 | Row pencil "Price for all Black" → Set price | PASS | Black SKUs → 319.000 (blue), summary "2 of 3 SKUs have their own price · Rp 299.000 – 319.000 · markup 39,1% – 48,4%" |
| 1.10 | Markup tooltip not clipped | PASS | "48,4% markup" tooltip fully visible, also on the right-most column |
| 1.11 | Create articles (delivery 1) | PASS | QA Loafers B1, article 00000011, SKUs 00000011003/004/103; counter → 60 deliveries · 384 pcs |
| 1.12 | Article appears in Merchandise → Articles | PARTIAL | Only after a page reload (list behind the sheet is stale) |
| 1.13 | Create articles (delivery 2) | PASS | QA Sneakers B2, article 00000012, 4 SKUs (Black/White × S/M); took ~15 s ("Creating…" shown) |
| 1.14 | Grid over the counted qty blocked | PASS | 7 vs 6 counted → "The grid comes to 7 and the warehouse counted 6. A session cannot mint stock that did not arrive." button disabled |
| 2.1 | /allotment/new loads | PASS (slow) | ~20 s on "Reading everything the pool holds…" while the header already says "Nothing left to allot" |
| 2.2 | One header card: supplier, "Supplier 1 of 3 · 4 articles · 10 pieces to allot", Sales / Sales qty / Stock qty today non-zero | PASS | CV Sepatu Sejahtera: Rp 115.826.865 · 462 · 10. New articles (Sepatu Top Ten) show Rp 0 / 0 (expected, no sales) but the figures sometimes stay as grey skeletons |
| 2.3 | Single search box on left pane | PASS | "Articles to allot — type a tag, colour, size, delivery…" |
| 2.4 | Store + period pickers above sales table, period right-aligned, no Note input | PASS | "Sold at every store" left, "Last 30 days" right; no note field |
| 2.5 | Footer line + buttons | PASS | "Articles · SKUs · Pieces · Lines · Stores"; Clear / Previous / Save all / "Save all & next: <supplier>" (last supplier: "Save all & done", nothing to save: "Done") |
| 2.6 | Over-allot beyond pool | PASS | Typing 5 in a cell with 1 piece is clamped to 1 (amber cell); 2nd store for the same 1-piece SKU clamps to empty |
| 2.7 | Per-article Save | PASS | Sandal Slide Karet → 3 SKUs to PIK Avenue/Dago/Tunjungan → "Saved ALT-00000004 (Sandal Slide Karet)." |
| 2.8 | Save all & next | PASS | Created ALT-00000005 (Loafers Kulit Sintetis → Kemang ×3) and ALT-00000006 (Sneakers Kanvas Low → 3 stores), moved to PT Garmen Nusantara. No success toast shown for Save all & next |
| 2.9 | Partial article cannot be saved | NOTE | Row Save / Save all only enable when an article has 0 left ("1 article has stock left"). One allotment per article |
| 2.10 | Footer status + last SKU row reachable | FAIL | With two status lines in the footer ("1 ready — Save on its row" + "1 article has stock left") the last SKU row (QA Sneakers B2 White · M) is hidden under the footer and the list cannot scroll to it; only reachable by Tab-ing into it |
| 2.11 | Draft survives reload | PASS | Typed quantities survived a forced reload (vite reload) |
| 2.12 | Row Save when the cloud restarts mid-request | FAIL | Save on QA Sneakers B2 stayed "saving" (dimmed buttons) for > 3 min, no error or timeout; the allotment was never created (cloud restarted at 23:40) |
| 2.13 | Allotments appear in /allotment as cards | PASS | Active 5 · Completed 1 · Unfilled 0; ALT-00000004/5/6 cards show supplier, "ALT-… · N stores · N pcs", Picked/Packed/Dispatch 0/0/0 |
| 2.14 | Allot 3+ SKUs to 3+ stores | PASS | ALT-4 and ALT-6: 3 SKUs → PIK Avenue, Dago, Tunjungan |
| 3.1 | Allotment list: three tabs, card content | PASS | Tabs "Active 5 · Completed 1 · Unfilled 0"; KPI row Active / Completed / Not shipped yet / In transit |
| 3.2 | Detail sheet (wide, matrix stores as columns, Total row/col, sticky first column, status + stage cards + actions) | BLOCKED | Cloud down before I could open it |
| 3.3 | Horizontal scroll with 8+ stores | BLOCKED | Planned: QA Loafers B1 (6 pcs, stores 01–06) + a 2nd Loafers Suede delivery onto the same article to reach 12 pcs / 12 stores. Allotments are one per article, and no seeded article has 8+ pieces in the pool, so an 8-store allotment needs an article with ≥ 8 pieces |
| 4.a | Cancel before picking | BLOCKED | Intended target: ALT-00000004 (Sandal Slide Karet, 3 pcs, 3 stores) |
| 4.b | Cancel after picking/packing | BLOCKED | Intended target: ALT-00000006 (Sneakers Kanvas Low, 3 pcs, 3 stores) |
| 5.x | Picking (nina) / short pick → Unfilled / Packing / Dispatch / store blind count + receive / Wait vs Close short | BLOCKED | Cloud down. Also: the store app on :5482 (launch config `pos-e2e-store`) was not running even before the outage (connection refused); store login would be maya / Password01 (scripts/demo-populate.py, store-01 head) |
| 6 | Unfilled tab "Bad Request" | NOTE | Before the outage `GET /api/v1/inventory/allotments/unfilled` answered 200 in another tab; the tab showed "Unfilled 0" |

## State left on the rig (for whoever continues)

- Articles: QA Loafers B1 (00000011, 3 SKUs, 6 pcs, Sepatu Top Ten) and QA Sneakers B2 (00000012, 4 SKUs, 6 pcs) — both still unallotted.
- Allotments created: ALT-00000004 (Sandal Slide Karet → PIK Avenue/Dago/Tunjungan, 3 pcs),
  ALT-00000005 (Loafers Kulit Sintetis → Kemang, 3 pcs), ALT-00000006 (Sneakers Kanvas Low → PIK Avenue/Dago/Tunjungan, 3 pcs). All ACTIVE, nothing picked.
- A local allotment draft (browser) for Sepatu Top Ten with 12 lines over 12 stores is still in the old tab's storage.

## Bugs

### B1 — Cloud cannot start: duplicate migration versions 0816 / 0817 (BLOCKER)
- Where: backend/migrations/postgres; rig pos-e2e.
- Repro: build the cloud with the working tree, start the rig (`scripts/rig.sh up pos-e2e`).
- Expected: cloud starts. Actual: `Error: Migration(VersionMismatch(816))`, cloud/dc/store down, hub shows "Bad Gateway".
- Files: `0816_an_employee_asks_for_their_details_to_be_changed.sql` + `0816_global_search_finds_a_supplier.sql`;
  `0817_overtime_lands_on_the_overtime_expense.sql` + `0817_a_purchase_order_can_carry_payment_terms.sql`. Renumber the untracked pair.

### B2 — A save that never answers hangs the allotment screen forever (High)
- Where: /allotment/new, row Save (and Save all).
- Repro: fill an article, press Save while the cloud is slow/restarting.
- Expected: a timeout or error ("Couldn't save — try again") and buttons re-enabled. Actual: Save, Previous, "Save all & done" stay dimmed for > 3 min; no message; nothing saved.

### B3 — Last SKU row hidden behind the footer when the footer shows two status lines (Medium)
- Where: /allotment/new, left pane.
- Repro: supplier Sepatu Top Ten; allot QA Loafers B1 fully and QA Sneakers B2 partly so the footer shows "1 ready — Save on its row" and "1 article has stock left"; scroll to the bottom.
- Expected: last row (White · M) fully visible. Actual: it sits under the footer and the list will not scroll further; only Tab reaches it.

### B4 — Footer and column totals mix suppliers (Medium)
- Where: /allotment/new.
- Repro: enter quantities on supplier 3, reload, land on supplier 1 (or step through suppliers).
- Expected: Pieces / Lines / Stores and the column head counts describe the supplier on screen. Actual: on CV Sepatu Sejahtera (nothing entered) the footer said "Pieces 11 · Lines 11 · Stores 11" and column heads 01–04 showed "1", taken from the Sepatu Top Ten draft, while "Articles 1 · SKUs 1" described the current supplier.

### B5 — Header says "Nothing left to allot" while the pool is still loading (Low)
- Where: /allotment/new on first load.
- Expected: a loading title or none. Actual: "Nothing left to allot" + "Reading everything the pool holds…" for ~20 s, then the real supplier appears.

### B6 — Articles list behind the New articles sheet is not refreshed after "Create articles" (Low)
- Where: Merchandise → Articles (/master).
- Repro: create an article in the sheet, close the sheet.
- Expected: new article at the top ("Newest first"). Actual: "10 of 10 shown" until a full reload; then 11 with QA Loafers B1 on top.

### B7 — Escape closes the New articles sheet and drops the unsaved form (Low)
- Repro: type a name with no matching suggestions, press Escape.
- Expected: Escape closes the suggestion list only, or asks before discarding. Actual: the sheet closes and the typed name/price is lost.

### B8 — Dev: several hub tabs exhaust the browser's 6 connections per host (Medium, dev rig)
- Each tab holds `/api/v1/notifications/stream` open over HTTP/1.1 through the vite proxy; with 4–5 Central tabs plus requests left hanging by the cloud restart, new tabs never finish loading (blank page, `readyState: interactive`, 0 resources) and fetches like `/inventory/control/clock` stay pending. Opening the hub on another host name (central.localhost) loaded at once.
- Likely affects production users too if Central is served over HTTP/1.1 and a user opens many tabs.

### B9 — Dev: newly installed npm dependency breaks the whole hub until vite restarts (environment)
- `src/screens/me/pay.tsx` started importing `qrcode` at 23:37; vite kept answering "Failed to resolve import qrcode" (blank hub everywhere) even after `node_modules/qrcode` existed, until the dev server restarted (I touched `frontend-hub/vite.config.ts`, no content change).

## Polish

- New articles: Base price placeholder "Rp 31.000" shows even when the purchase price is Rp 215.000 / Rp 185.000 — a hint below the purchase price contradicts the rule.
- New articles: decimal separator differs — Markup field "39.1 %" vs. summary "markup 39,1% – 48,4%" and tooltip "48,4% markup".
- New articles: "A session cannot mint stock that did not arrive." — jargon ("session", "mint"); e.g. "The grid has 7, the warehouse counted 6."
- New articles: footer says "A size with no pieces is left out." even when no size is 0.
- New articles: "Every SKU at base — click a grey price to give that SKU its own" is explanatory filler.
- New articles result view: Activity shows "Rina Kusuma issue on this record" — reads like a broken verb.
- New allotment: grid columns use store codes (01, 02…) while the sales table uses names (Kemang, PIK Avenue…); hard to match without the column highlight.
- New allotment: Tab into a column beyond the visible ones does not scroll it into view (cell 05 stays under the "Left" column).
- New allotment: the sales table keeps its horizontal scroll when moving to the next supplier, so it starts at Dago/Tunjungan instead of Kemang.
- New allotment: "Save all & next" gives no confirmation of what was saved (row Save does: "Saved ALT-00000004 (…)").
- New allotment: a cleared cell keeps an amber outline after the value is rejected.
- New allotment: Sepatu Top Ten header Sales / Sales qty stayed as grey skeletons (no sales) instead of Rp 0 / 0 on second visit.
- No text under 14px found in the New articles sheet; no non-English copy seen in the tested screens.

## Round 2 (after the rig restart)

Tester: agent B2 (QA), 2026-10-02 00:30 – 00:55 WIB. Hub opened on **http://qa2.localhost:5480** (signed in as rina). `localhost:5480` would not load
in a new tab (navigate timed out after 300 s, the per-host connection limit from B8), and `127.0.0.1` was refused by the pane, so a
`*.localhost` alias was used. Viewport emulated at 1440x900 (also 1024x800 for the scroll test); all clicks were made by element ref, so
the scaling quirk did not apply. Store app started with `preview_start pos-e2e-store` (it was not running) and opened at
http://store.localhost:5482. Cloud answered quickly (1–3 s) during this round.

### Steps

| # | Step | Result | Notes |
|---|------|--------|-------|
| 3.1 | Tabs Active · Completed · Unfilled | PASS | "Active 5 · Completed 1 · Unfilled 0", KPI row Active / Completed / Not shipped yet / In transit |
| 3.2 | Unfilled panel loads, Open \| Closed short toggle | PASS | `GET /inventory/allotments/unfilled` → 200 `{"open":[],"closed":[]}`; "Nothing unfilled." / "Nothing closed short." |
| 3.3 | Card content | PASS | Supplier, "ALT-… · N stores · N pcs", Picked / Packed / Dispatch. New cards first show "Waiting for DC" until the DC accepts them |
| 3.4 | Detail sheet: wide, matrix stores-as-columns, SKU rows under the article, Total col + Total row | PASS | 1400 px wide at 1440. Stage cards Allotted / Prepared / Shipped / Received, then the matrix |
| 3.5 | Status shown in the sheet | FAIL (by design?) | No status word or supplier name in the sheet; the code comment says the owner removed it on 29 Sep. A closed-short sheet does show a banner ("Closed short: 3 released.") |
| 3.6 | Sticky first column / pinned Total column | PASS | At 1024x800 the 6-store matrix scrolls (1000/916 px); Article `sticky left:0`, Total `sticky right:0`, both with an opaque background and z-index 10; the store columns slide under Article |
| 3.7 | Allot ONE allotment to 8+ stores | BLOCKED (data) | No article in the pool has 8+ pieces (max 6: QA Loafers B1, QA Sneakers B2), and "Save all" makes one allotment per article. Allotted both to 12 stores in total → **ALT-00000007** (QA Loafers B1 → Kemang, PIK Avenue, Dago, Tunjungan, Malioboro, Sun Plaza) and **ALT-00000008** (QA Sneakers B2 → Seminyak … Store 13), 6 stores each. Linking a 2nd delivery to an existing article in New articles only fills in the name (no "add to existing article"), so I did not create one |
| 3.8 | Long supplier name truncation | PASS (CSS) | Card title has `nowrap + ellipsis + title=` tooltip; "CV Sepatu Sejahtera, PT Garmen Nusantara" still fits at 1024 px, so nothing was actually cut |
| 3.9 | Card tint while its sheet is open | PASS | The open card gets `rgb(239,245,255)`, the others stay white. At 1440 px the 1400 px sheet covers the list, so the tint is hardly visible |
| 4a.1 | Cancel ALT-00000004 (nothing picked) | PARTIAL | There is **no "Cancel" action**. The sheet offers only "Close short" (the "Cancel and re-allot" button is hidden, see bug R2-3). Close short → popover "3 across 3 lines haven't been packed yet…" + required reason → "Close short 3" |
| 4a.2 | Status after close | PASS (API) / FAIL (UI) | DC applied it within 5 s (`CANCELLED / CLOSED`, outcome APPLIED, 3 released). The open sheet still said "Close short of 3 was sent to the DC. Nothing is released until it answers." 35 s later, while the toast had already said "Closed short" |
| 4a.3 | Stock back in the unallotted pool | PASS | Sandal Slide Karet 00000008204/205/206: allotted 1→0, on hand 0→1 each; New allotment shows "Sandal Slide Karet 3" again on CV Sepatu Sejahtera |
| 4a.4 | Where it shows afterwards | FAIL | Missing from **all** tabs: not in Active (after a reload), not in Completed, not in Unfilled → Closed short. Only reachable by URL `?allotment=<id>` (bug R2-1) |
| 4a.5 | Cancel no longer offered | PASS | Reopened sheet has no Close short button; banner "Closed short: 3 released." and "3 pcs closed short" |
| 4a.6 | Audit / History | PARTIAL | History: 3× "Close short requested · 1" + 3× "Closed short · 1" (one per line, no SKU/store named); Activity "Rina Kusuma cancelled this record". **The reason is not shown anywhere**, although the form says "Kept on the closed allotment." |
| 5.1 | Ops → Picking loads, DC sign-in | PASS / NOTE | No DC sign-in was asked; the picklist records "Picker: rina" (nina was never needed). Shops are labelled with DC names "C001 · Cikupa", "C002 · Muaro Bungo"… while the hub calls the same stores Kemang, PIK Avenue… (bug R2-5) |
| 5.2 | Pick ALT-00000005 with one short on purpose | PASS | Set XXXL to 0 → footer "1 short" → Accept → toast "1 line short · count raised"; picklist shows 2 picked / 2 to pack |
| 5.3 | Short pick → Allotments → Unfilled | FAIL | Unfilled stays 0 (`open: []`) after the pick, after packing and after dispatch. The short line stays as a new ALT-00000005 picklist "1 SKU · 1" on the Picking list. So "Wait" / "Close short" decisions in Unfilled could not be tested (bug R2-4) |
| 5.4 | Card Picked number after the pick | FAIL | /allotment card stayed 0/0/0 for > 1.5 min after the pick (API `total_picked_quantity 0`); it jumped to 2/2 only after packing. Picking alone never reaches the cloud |
| 5.5 | Packing (from the picklist) | PASS | "C001 · Cikupa · 1 picklist · 2 pieces to pack" → Pack → qty 1+1 → "Pack and seal" → KOLI-HO-GUDANG-000005 + packing-list preview (Indonesian printout, OK) |
| 5.6 | Card after packing | PASS | ALT-00000005 Picked 2 · Packed 2 · Dispatch 0 (within ~15 s) |
| 5.7 | Dispatch (surat jalan, trip data, in transit) | PASS | Unticked the older carton KOLI-000004, trip data typed, "Dispatch and print surat jalan" → SJ-HO-GUDANG-000003, toast "1 surat jalan · in transit". The trip data printed twice on the surat jalan, probably because I typed it twice (the first attempt looked like it did not land). Not filed |
| 5.8 | Card after dispatch | PASS | 2 / 2 / 2; KPI "In transit" 1 → 3 |
| 5.9 | Store app start + sign in (maya) | PASS | Started `pos-e2e-store` (port 5482); maya → "Kemang · Store server", Supervisor |
| 5.10 | Store blind count receive | PASS | Stock → Receive: SJ-HO-GUDANG-000003 In transit → Receive → scanned 00000007205, 00000007206 (no expected qty shown) → Receive → "Received · complete", Expected 2 / Received 2 / Missing 0 / Extra 0 |
| 5.11 | Hub shows Received | PASS | ALT-00000005 sheet: Received 2 (~20 s after the store receive) |
| 5.12 | Moves to Completed | FAIL | With 1 short line it stays Active (correct). After "Close short 1" the API says `COMPLETED / CLOSED` (outcome PARTIALLY_APPLIED), but the card is gone from Active **and** missing from Completed (Completed 1 = ALT-00000001 only) (bug R2-1) |
| 5.13 | DC Dispatch list after the store receive | FAIL | SJ-HO-GUDANG-000003 (and 000001/000002, which the store lists as Received) still show "In transit" on Ops → Dispatch (bug R2-6) |
| 4b.1 | ALT-00000006: pick C002 (PIK Avenue), then Close short | FAIL (High) | After the pick (not yet packed) the hub offered "Close short 3": "3 across 3 lines haven't been packed yet". It was applied in full (APPLIED, 3 released, `blocked_picked_quantity 0`). The cloud pool now shows 00000009204 as **on hand, unallotted** again, but the DC still lists "C002 · Muaro Bungo · 1 picklist · 1 piece to pack". Pack and seal there fails with a raw error: `conflict: no open allotment for EPC A…9204…; SKU 00000009204, destination store-02 (it came from dc.outbound.picking)`. The piece is stuck in the picking pool, and the cloud offers it again for allotment (bug R2-2) |
| 4b.2 | Close short after packing | PASS | ALT-00000005 (2 packed + dispatched, 1 short): "Close short 1" → PARTIALLY_APPLIED, result "2 accepted unit(s) were already Picked and remain eligible for fulfillment"; the packed pieces kept travelling and were received |
| 4b.3 | Cancel per store / top-up / re-allot offered? | FAIL | None in the UI: only the whole-allotment "Close short". "Cancel and re-allot" exists in the code but is never shown (bug R2-3); there is no per-store cancel and no top-up |
| 6.1 | Text under 14px | PASS | None found in the allotment sheet, the confirm popover or the picklist sheet |
| 6.2 | Console errors | NOTE | Repeated `screens["/finance/payroll/…"] has no entry in lib/navigation.ts` (4 routes, on every load); 409 from Pack and seal (R2-2); some 404s |
| 6.3 | Slowness | PASS | Cloud and DC answered in 1–5 s; DC→cloud sync for packing/dispatch ~15 s; close short applied in ≤ 5 s; store receive reached the hub in ~20 s. The hub tab fired ~13,600 requests in ~25 min (polling: each tab keeps clock/notifications/edge lists hot) |

### Bugs

#### R2-1 — Closed-short / cancelled allotments vanish from every tab, including COMPLETED ones (High)
- Where: /allotment list; `frontend-hub/src/screens/allotment/allotments.tsx` tabs (`status: "ACTIVE"` / `"COMPLETED"`).
- Repro: close short ALT-00000004 (nothing picked), or ALT-00000005 (2 received + 1 closed short); reload /allotment.
- Expected: ALT-4 under a closed/cancelled view (or Unfilled → Closed short), ALT-5 under Completed.
- Actual: both are gone from Active, Completed and Unfilled → Closed short, and are reachable only by URL. API: `?status=COMPLETED` returns only ALT-1; ALT-4 (CANCELLED), ALT-5 (status COMPLETED) and ALT-6 (CANCELLED) come back only for `?status=CANCELLED`, which the hub never asks for. `/allotments/unfilled` → `closed: []`.

#### R2-2 — Close short after picking releases the picked piece; the DC then cannot pack it (High)
- Where: hub allotment sheet "Close short" + DC Packing.
- Repro: Ops → Picking → ALT-00000006 C002 → Accept (1 piece picked, not packed) → /allotment → ALT-00000006 → Close short 3 → reason → confirm → Ops → Packing → C002 → Pack 1 → Pack and seal.
- Expected: the picked piece is either blocked from the close ("1 already picked keeps travelling", like packed pieces) or sent back to stock at the DC, so the picklist disappears.
- Actual: the cancel is APPLIED for all 3 (`blocked_picked_quantity 0`); the cloud pool shows 00000009204 as free stock (on hand 1, allotted 0); the DC still shows "1 picklist · 1 piece to pack" for C002; Pack and seal fails with the raw message `conflict: no open allotment for EPC …; SKU 00000009204, destination store-02 (it came from dc.outbound.picking)`. The piece is stuck in `dc.outbound.picking`, and the same piece can be allotted again from the cloud.
- Also: the hub never learns about picks before packing (step 5.4), so "haven't been packed yet" cannot tell picked from unpicked pieces.

#### R2-3 — "Cancel and re-allot" never shows: detail `type` is TO_SITE (Medium)
- Where: `allotments.tsx` ~line 1140, `record.type === "TO_STORE" && …`.
- Repro: open any active allotment (ALT-4/6/7).
- Expected: "Cancel and re-allot" next to "Close short".
- Actual: only "Close short". `GET /inventory/allotments/{id}` returns `"type":"TO_SITE"` for every allotment (the list is requested with `type=TO_STORE`), so the condition is always false. The pre-picking cancel and the re-allot flow are unreachable.

#### R2-4 — A short pick does not create an Unfilled line (Medium)
- Where: Ops → Picking accept with fewer pieces than wanted; /allotment → Unfilled.
- Repro: pick ALT-00000005 with XXXL = 0 → Accept ("1 line short · count raised").
- Expected: an open Unfilled line (ALT-5 · Kemang · Brown XXXL · 1) with the Wait / Close short decision.
- Actual: Unfilled stays 0 (`open: []`) after the pick, pack, dispatch and receive; the short line just stays as a pickable ALT-5 picklist. The Wait / Close short decisions could not be tested.

#### R2-5 — The same store has two names: DC screens show "C001 · Cikupa", the hub shows "Kemang" (Medium)
- Where: Ops → Picking / Packing / Dispatch, the surat jalan and packing list ("Toko C001 · Cikupa") vs /allotment, New allotment and the store app ("Kemang").
- Repro: ALT-00000005 → Kemang; open Ops → Picking: it sits under "C001 · Cikupa". ALT-6 for PIK Avenue appears under "C002 · Muaro Bungo".
- Expected: one name per store everywhere (and on the printed surat jalan the store's real name).
- Actual: the DC uses its own org-unit names. The packer and driver see a different store from the one the merchandiser allotted to.

#### R2-6 — DC Dispatch keeps received deliveries "In transit" (Medium)
- Where: Ops → Dispatch (/operations/despatch).
- Repro: dispatch SJ-HO-GUDANG-000003, receive it in the store app (Received · complete), reload Ops → Dispatch.
- Expected: it leaves "In transit" (Received / Delivered).
- Actual: SJ-000001, 000002 and 000003 all "In transit"; "Surat jalan in transit 3", "Cartons on the road 4". The store's Receive tab lists all three as Received.

#### R2-7 — The open allotment sheet does not refresh after Close short (Low)
- Repro: Close short on ALT-00000004; keep the sheet open.
- Actual: the toast says "Closed short" at once, but the sheet keeps "Close short of 3 was sent to the DC. Nothing is released until it answers." (and the list keeps the card under Active) until a reload, although the DC applied it within 5 s.

#### R2-8 — The close-short reason is not shown (Low)
- The form says "Kept on the closed allotment." The API keeps it (`cancellation.reason`), but neither the banner, History nor Activity shows it. History rows say "Close short requested · 1" ×3 / "Closed short · 1" ×3 without SKU or store.

#### R2-9 — The DC accepts picks without a warehouse sign-in (Low / question)
- Ops → Picking and Packing never asked for the DC user; picks are stamped "Picker: rina" (HO). The brief expected nina at the DC.

### Polish

- Close-short popover: "3 across 3 lines haven't been packed yet" / "1 across 1 line haven't…": add the unit and fix the verb ("3 pcs on 3 lines have not been packed yet" / "1 pc on 1 line has not…").
- Sheet caption "Created 01 Oct 2026 by rina" uses the username; Activity says "Rina Kusuma".
- The sheet's close (X) button and the Dispatch carton checkboxes have no accessible name.
- Matrix SKU rows sort by label: "Black · L" comes before "Black · M"; sizes should follow size order.
- The matrix header row is not sticky vertically: with many SKUs the store names scroll away.
- Card numbers "Picked / Packed / Dispatch" vs sheet stage cards "Allotted / Prepared / Shipped / Received": two vocabularies for the same pipeline.
- New allotment header: "1 article · 1 pieces to allot" (plural).
- New allotment: Tab past the last cell jumps the grid back to columns 01–03 while focus is elsewhere; the row "Save" button sits over the grid row.
- Picking: the picklist sheet title shows a raw id ("27ebbf90") above "Picklist"; "Picked today 1" after 2 pieces were picked (it counts picklists); older picklists list Shop "—" / Allotment "—" and an empty status.
- Packing / Picking / Dispatch subtitles and the store "Receive it" paragraph are explanatory filler ("A picklist exists as soon as an allotment is here…", "Count what actually arrived … the point of counting is to find what actually arrived").
- Pack error shows a raw backend string with the EPC and pool code (see R2-2): should be a plain sentence.
- Dispatch sheet: an unticked carton's checkbox renders as a solid blue square that looks ticked.
- Store app: From "dc" (raw id); delivery id "inb-b9e4…" shown twice in the sheet; month "02 Okt" in an English UI; counted lines show only the SKU code, without the article/colour/size.
- Allotments KPI "In transit" said 1 while Ops → Dispatch listed 2 surat jalan in transit (before this round's dispatch).

### State left on the rig

- ALT-00000004 cancelled (3 Sandal Slide Karet back in the pool). ALT-00000005 COMPLETED (2 received at Kemang, 1 XXXL closed short; a "count raised" task exists at the DC for 00000007207).
- ALT-00000006 cancelled; **its White · L (00000009204) is stuck in the DC picking pool** with an un-packable C002 picklist (R2-2).
- ALT-00000007 / ALT-00000008 (Sepatu Top Ten, 6 + 6 stores) active, nothing picked.
- SJ-HO-GUDANG-000003 / KOLI-HO-GUDANG-000005 dispatched and received at Kemang. KOLI-HO-GUDANG-000004 still ready to dispatch.
- Store app dev server `pos-e2e-store` (:5482) left running; browser tab closed.
