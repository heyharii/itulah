# Central hub — UI/UX consistency audit

6 Oct 2026 · scope: `frontend-hub` (all departments), phone 414×896 and desk 1440×900 · read-only audit, nothing was changed by it.

Method: five department auditors and two record-sheet auditors drove the running hub (rig data, signed in as Rina) and read the source; a static scan counted patterns across `frontend-hub/src`. About 250 routes and about 140 record sheets/dialogs were covered. Evidence, with exact strings, sizes and file paths, is in `evidence/` (≈ 300 findings; this report merges the duplicates).

**Limits, stated plainly.** The Browser pane was hidden for most of the run, so judgement is mostly DOM text, computed sizes and code, not eyeballing; the rig has no rows for promotions, campaigns, vouchers, bills, BKK/BKM, giros, assets, leave, claims, payroll, GA — those are judged from code; the rig session expired twice (a cookie collision with the store app, since fixed). Treat counts as "at least".

---

## 0. What the audit says in one page

1. **The phone rules are mostly honoured now** (no sideways scroll on any routed screen but one; dock + Fab + lead-figure cards almost everywhere). What is left is small and mechanical: 12px bottom-bar labels, 36px dock/Fab/footers, a few controls still at the top (Picking, Dispatch, Control, desk-only switches).
2. **Record sheets are the real mess** (owner's call, confirmed): 269 `<Sheet>` usages in 170 files with ≥ 6 different head grammars, 8 ways to draw status, 5 footer conventions, 5 ways to edit, 7 heading styles, widths set by ad-hoc classes, header actions that wrap on a phone, disabled inputs used as facts, a "Comments" tab with no comments. Two auditors independently proposed almost the same single anatomy (§2).
3. **The same word means different things and different words mean the same thing** — the biggest source of "this feels like several apps": "switched off" has 5 names; "waiting / refused / taken back" 4–5 spellings each; "create" has 10–19 verbs; "Submit" is the save button 31 times; the scope picker is "unit", "site" or "shop"; "Leave" vs "Time off"; "Activity" is two different screens; two bottom-bar tabs are both "Home".
4. **Formats are not one grammar**: dates in 6–9 shapes (and 44 files format dates themselves), money in 4 compact styles, quantity units in 6 spellings, percent/decimal/negative/zero in 3 styles each, "nothing" in 7 forms.
5. **A few findings are data bugs, not style** — and should be fixed first: Finance Overview says "Total payables Rp 0 / Nothing is late" while the ageing card shows Rp 52,9 jt and Supplier Bills shows "4d late"; Orders says 21.060 pcs while Outstanding says 21.081 (a cancelled PO is counted); `/master/organisation` is cut off on a phone; the New Allotment composer scrolls sideways; some screens (`more: true`) are in no menu on either device.
6. **The employee app (`/me`) and a few pockets (Finance `Panel` dialogs, HR approval sheets) are separate UI kits** that read like other products.

Counts that back this up (static scan): 269 sheets / 170 files; status drawn as `Pill` 516× · `Tag` 128× · `Status` 89× · plain coloured text; 26 places under 14px; 59 places with `id-ID` number formats but 44 files with their own date formatting; Cancelled 39 / Inactive 20 / Retired 16 / Closed 16 / Non-active 6; ~90 loading phrases ("Loading…" 21×, ~60 different "Reading the …").

---

## 1. Decisions needed from the owner (each unblocks a wave of mechanical fixes)

| # | Decision | Recommendation |
|---|---|---|
| D1 | **One control height** for dock chips, Fab, card buttons, sheet footers, header buttons on touch | 44px hit area everywhere; 36px visible on desk only. Fab/dock chips grow to 44; footer buttons 44 on phone. |
| D2 | **Status vocabulary** | *Inactive* = master data switched off (articles, terms, suppliers, users); *Cancelled* = a document ended before completion (PO, voucher, order); *Closed* = finished/sealed (period, count, return); *Retired* = assets only; *Active* everywhere for "on" (Marketing's "Live" becomes "Active", with "Scheduled / Paused / Ended" kept as phases). Kill "Non-active", "Stopped", "Blocked/Suspended" variants. |
| D3 | **Status drawing** | `Status` (dot + word) for list rows/cards and for on/off; `Pill` only as the single badge in a record sheet head and for document stages needing attention; no plain coloured text, no `Tag` for status, no stamp next to a Pill. |
| D4 | **Create / commit verbs** | Entry point (Fab, header button, sheet title) = **New {thing}**; commit button = **Create {thing}** (new) / **Save changes** (edit); **Submit** only for "send for approval/posting" documents; undo family = **Cancel {thing}** (before done), **Void** (posted), **Reverse** (ledger), **Deactivate** (master). |
| D5 | **Approval pair** | **Reject** (danger) on the left, **Approve** (primary) on the right, required "Reason" in the body, in the footer on every device; states are *Pending / Approved / Rejected / Withdrawn* everywhere (retire "Refused / Declined / Taken back / Waiting on a decision"). |
| D6 | **Dates** | House format `06 Oct 2026`; with time `06 Oct 2026, 14:28`; relative "3d ago" only for ages in lists; weekdays `Tue 06 Oct`; **only** helpers from `lib/format.ts` (44 files to migrate; ban `toLocaleDateString` outside it). |
| D7 | **Money** | Full `Rp 1.234.000` in tables/sheets; compact for tight spots: letters `Rp 4,0 B` (K/M/B/T, as just shipped) *or* words `Rp 4,0 billion` — pick ONE; today both coexist. Always with "Rp". |
| D8 | **Quantity words** | `pcs` for pieces, `items` for line counts, `cartons` for cartons, `pairs` for sets; never "pieces/Piece/labels/koli" as a unit. |
| D9 | **Scope picker** | **Unit** for business units/branches (Finance, Stock, HR); **Store** only where the list is stores only; unfiltered option = **All units** (not "Every unit"). |
| D10 | **Colour spelling** | UI says **Color** (it already says "Colors"); fix "Colourways" to "Colorways"; routes may keep `/colours` but redirect from `/colors`. |
| D11 | **Casing** | Screen/menu names Title Case; headings, field labels, buttons sentence case; remove the CSS `capitalize` that turns "Show retired" into "Show Retired". |
| D12 | **Menu label = page title** | Make the H1 equal the menu label on every screen (20 of 44 People screens, several Finance/Marketing ones differ); drop the doubled titles. |
| D13 | **Navigation** | Rename one of the two bottom-bar "Home" tabs; rename the bell/notifications to **Notifications** and System's log to **Audit log**; put the `more: true` screens (Stores, Members, Exceptions, Returns, Store Analytics) in a menu or accept they are ⌘K-only and say so. |
| D14 | **Sheet anatomy** | Approve §2, plus: allotment gets its status badge back? PO keeps Pill *or* stamp, not both? edit-in-place vs separate sheet threshold (≤ 8 fields)? |
| D15 | **Employee app (`/me`)** | Move onto the hub kit (Pill/Status, buttons, empty states, dates) — or explicitly keep it separate. |
| D16 | **Printed/sent documents** | Still pending: English or Indonesian for letters, giro, PO/return prints, delivery-note layouts, contract clauses (today Indonesian). |

---

## 2. Record sheets — the proposed ONE anatomy

Both sheet auditors converged; this is the merged spec (every item was seen failing somewhere).

```
SHEET   size by content: rail ≈ 480px (≤ 10 facts) · wide ≈ 900px (documents with lines: PO, supplier,
        return, composer) · table ≈ 1020px (grids read across: receiving, pool, SKU matrix, allotment lines)
        · workspace (list + form only). Never a screen's own w-[Nrem]. Phone: the bottom drawer
        (full height), body scrolls, footer pinned above keyboard and safe area, 44px ×.

HEAD    (fixed, never actions)
  id      mono 15px — the business number a person says aloud (PO-041026-006, HO-0006). Omitted if none.
          Never a UUID, login, kind label, period, or the title again.
  title   16–18/600 — the record's own name; wraps to 2 lines on phone before truncating; never a verb
          or the screen's name.
  badge   exactly ONE Pill right of the title (under it on phone), tone from the taxonomy (D2/D3).
  caption one muted line: kind · place · "Created by {full name} · {dd Mon yyyy}". No instructions.
  more    optional overflow ⋯ for Print / Download / Duplicate only.

TABS    only when the record answers more than one question; `Sheet` `tabs` only (wrap on phone);
        last tab "Activity" whenever there is a `subject` (rename "Comments" until something posts one).

BODY    gap-6, nobody sets margins
  1 Banner (only the state of the record: blockers/warnings, last save error), one sentence
  2 Facts — one component, 2 cols, label over value, sentence case, values wrap, money/dates in house
    format, names not logins/ids, composite values split; ≤ 8 short values
  3 Sections — SubHead 15–16/500 (count as aside) + MiniTable/list; fixed order Items → Totals →
    Timeline → Notes; no Card inside a sheet; tables stack on phone; numbers right-aligned tabular
  4 "Activity (n)" link at the end if there are no tabs

FOOT    the ONLY home of actions; same on every width; one agreed height (D1)
  [destructive via ConfirmButton, left] ......... [Cancel, quiet] [Primary, right]
  read mode: [Print] ......... [Edit]  · reader without rights: just "Close" + one muted line why
  one primary; verbs per D4/D5; pending = present participle; failures as a banner above the foot;
  a disabled primary always says why in a one-line foot note.

EDIT    ≤ 8 fields, no lines → in place (head stays, foot becomes Cancel | Save changes, Esc cancels);
        documents/fleet-wide → a separate wide sheet from the foot's Edit; after save: stay in read mode
        + toast (receipt dialog only when an id was minted); dirty → ×/Esc/swipe/veil ask once.

STATES  loading "Reading the {thing}…" (head already shows the id from the URL) · empty one quiet line
        + the action that fixes it · error banner (+ Retry for reads) · permission: do not draw actions
        the role cannot use · URL: every record sheet has a SHEET_PARAMS key, one level of nesting, a
        nested record shows "Back to {parent}".
```

**Sheets to copy (already good):** Supplier sheet (read mode + edit-in-place foot), Held (offline) order sheet foot, Price-change sheet, Pricelist cell sheet, Contract hub (the only one that fills the whole anatomy), Attendance PersonSheet (`width="table"`), `FormSheet` in People settings (best footer, ~30 editors), ChangeSheet/DataRequestSheet (Reject/Approve), Reprimand letter, Employee head (`HO-0006` / full name), PeriodSheet two-step confirm, `ConfirmButton`, `MiniTable`, `TotalsLadder`, `Lifecycle`.

**Sheet findings that are bugs, not taste:** Finance tables inside sheets/dialogs overlap on a phone (fixed 60px `Grid` rows vs stacked cells — seen on the Journal entry panel); 13 Finance files open records in a centred `Panel` dialog with no id/badge/tabs/footer and never beside the list; Sale void/complete, Block sign-in, Reverse and Post run with no confirmation; 5 of ~15 forms ask before discarding typed input; 22 record sheets are React state, not URL-addressable; the "Comments" tab has no comments and opens a folded "Activity" below the content; Division's Code and Pool's Subject are disabled/read-only inputs standing in for facts; Count shows two buttons both labelled "Submit".

---

## 3. Cross-cutting findings (merged, most severe first)

### A. Words
- **A1 [H] "Switched off" has 5 names** — Inactive (master lists), Non-active (suppliers), Cancelled (articles, catalogue, templates), Retired, Suspended/Stopped/Blocked (members/users); Marketing says *Live* where the rest says *Active*. → D2.
- **A2 [H] Approvals**: *Waiting / Waiting on a decision*, *Refused / Rejected / Declined*, *Taken back / Withdrawn*; verb pairs Approve+Refuse, Approve+Reject, Reject-then-Approve; footer on phone only in some sheets. → D5.
- **A3 [H] Create and save verbs**: 10–19 distinct Fab/button labels ("Open store" vs "Open a new store", "New Order / New order / New PO / Add Item / New Item"); "Submit" is the save button 31×; undo family has 8 verbs; desk and phone differ on the same screen. → D4.
- **A4 [H] Menu label ≠ H1 ≠ button**: 20/44 People screens; "Card & EDC Settlement" opens "Sales Reconciliation"; menu "Time off" vs "Leave"; Marketing "Pricelist"/"Prices". → D12.
- **A5 [M] Scope filter**: "unit"/"site"/"shop" and "Every X" vs "All X". → D9.
- **A6 [M] Names for the same thing**: a store is named five ways (and DC / HO / Gudang / Warehouse); one flow up to five names; "Employment status" means two things; "Where someone works" has 5 labels; "Color/Colour"; "Quantity unit" six ways. → D8/D10 + a glossary.
- **A7 [M] People as logins/UUIDs**: History shows "rina", the article sheet a UUID, sheets show "yusuf/nina", Employment timeline raw transitions. → full names (existing owner rule) — resolve everywhere.
- **A8 [M] Empty/loading/error phrasing**: ~90 loading phrases ("Loading…" 21×, ~60 "Reading the …"); empty states explain the button not the emptiness; some say "Tap the + in the header" when the header has none; loading screens show real-looking zeros; seven placeholders for "no value" (—, –, n/a, "No …", blank, 0, "None").
- **A9 [M] Casing**: Title Case forced by CSS over sentence-case copy; CAPS for some roles; sheet titles Title Case on creation sheets only.
- **A10 [L] Filler/instruction copy** (notes, formulas, footnotes) still under titles and in sheet captions — against the owner's no-filler rule; Indonesian/dev jargon left ("seeded by 0801", raw enums, "HIRE — CANDIDATE → ACTIVE").

### B. Formats
- **B1 [H] Dates**: 6–9 shapes ("4 Oct 09.55", "02 Oct 2026, 14:28", "3d ago", "Tue, 6 Oct 2026", "Sept", ISO, padded/unpadded); 44 files format dates themselves. → D6.
- **B2 [H] Money**: 4 styles ("Rp 4,0 billion" / "Rp 20,6 jt" → now K/M/B / full / "Rp0" vs "Rp 0"); percent "0,25 %" vs "147.5%"; negatives in 3 styles, zero in 3; Pricelist drops "Rp"; Dr/Cr placement; GA lists use the Executive compact format. → D7.
- **B3 [H] Same total, different numbers**: Orders 21.060 pcs vs Outstanding 21.081 (cancelled PO counted); Finance Overview vs ageing vs bills; three "inventory value" figures with generic labels.

### C. Components
- **C1 [H] Status is drawn four ways** (Pill, dot+word, plain coloured text, lowercase caption/Tag), sometimes twice on one card; HR uses bordered Pills everywhere, other departments dot+word. → D3.
- **C2 [H] "Create a record" uses four containers** in Finance (right sheet, centred dialog, workspace sheet, full page) and a sheet/page/hidden state elsewhere. → sheet anatomy §2.
- **C3 [M] One job, several widgets**: "switch the list" is a tab bar, chip row, segmented control or card header; seven widgets for "which period"; five unit/scope pickers; filter/sort/view switch differ per screen; "No filter" chip has six names; date navigation has four controls.
- **C4 [M] Three phone record shapes + a forked helper set**: the lead-figure card exists in at least 6 hand-built copies (`mobile/phone-cards`, `people/phone-cards`, `finance/phone-parts`, `finance/parts`, `operations/card-parts`, `commercial/card-parts`) — merge into one kit.
- **C5 [M] Heights**: control heights 28–40 inside one toolbar row; heading scale differs between look-alike places; card buttons "five looks, four verbs for open the form".
- **C6 [M] Confirmations**: casing, button words and the same action built four ways; irreversible acts without confirm (void sale, block sign-in, reverse, post); "Revoke for good" styled like "Suspend".
- **C7 [M] Disabled without reason** (hover tooltip only); no permission-denied state; two opposite policies (hide vs disable).
- **C8 [M] The employee app is a second UI kit** (own Pill, empty state, button sizes, date format with a "Sept" bug; "Active" vs hub "Working"; "Absent" where the hub refuses the word); Profile shows Sign out twice at different sizes; desk Me pages are a phone layout in a 670px column.

### D. Phone rules (owner rulings)
- **D-1 [H] Touch targets under 44px** on always-visible controls: dock chips, Fab (36), the "Filter and sort" icon (28), card buttons visible 32 (hit area 43–44 ok), ESS buttons, sheet footers 36 vs ×44.
- **D-2 [H] Text under 14px**: bottom-bar labels 12px on every screen; store-card ring label 11px; chat (13px, 12px), Finance projection and shop payment methods (12–13px) — 26 places.
- **D-3 [H] Controls still at the top / not in the dock**: Picking (chips, sort in the page body), Dispatch header button, Control mid-page buttons, Finance projection calendar controls, Notifications puts a card above the list, desk-only switches; several sheets put actions in the header or at the end of a 5,000px form.
- **D-4 [H] Sideways**: `/master/organisation` (619px table in a 370px card, "Person in Charge/Set PIC" unreachable); New Allotment composer (store tab strip 941px in 388px); Finance tables in sheets overlap.
- **D-5 [H] Parity gaps**: phone cannot switch Receiving's PO / Store returns, nor Allotments By store / By article; phone Employees drops Number/Contract/Login; Calendar/Attendance/Roster change controls per device; setup-checklist urgency tag and Sales KPI captions missing on phone; desk search boxes have no label while phone docks name them.
- **D-6 [M] Doubled titles** (top bar + page + crumb), a phone H1 under the top bar when H1 ≠ menu label.
- **D-7 [M] Navigation orphans & naming**: two tabs named "Home" (both → /apps); "Activity" means Notifications and the System audit log; `more: true` screens in no menu on either device (D13).

### E. Data and logic (fix before polish)
- Finance Overview "Total payables Rp 0 / Nothing is late" vs ageing Rp 52,9 jt vs Supplier Bills "4d late"; Purchase Invoice says no supplier invoice exists while Accounts Payable lists 13 bills; "Bill" means three different numbers across Overview/Payables.
- Orders vs Outstanding totals (cancelled PO counted).
- Duplicate routes / a stuck screen (Ops); copy that points to menu paths that do not exist (HR); `SHEET_PARAMS` keys with no sheet and one key serving two sheets.

---

## 4. What is already consistent (do not touch)

Dock on phone lists (status chip + search + ⚙ + Fab, same order and look) · lead-figure card geometry (radius 10, 16px padding, 16/600 name, 14px mono code, one 24/600 figure, hairline, 14px foot) · card buttons are words, never a pencil · no sideways scroll on any routed phone screen except the two above · money through `money()` with id-ID grouping · "Quantity" (never "Qty") · pill tone colours (ok/warn/bad; info only for in-motion) · required marks (`Field`) · record detail is a Sheet (URL-addressable on most) with × at 44px · `PageHeader` drops its echo of the top bar on phone · Reports share one ERPNext shape · skeleton loading limited to Ops/Procurement/Master/Merchandise is a deliberate owner decision · no text under 14px on any Finance route.

---

## 5. Fix plan (what to do in what order)

| Wave | What | Needs | Size |
|---|---|---|---|
| 0 | **Data bugs** (Finance payables Rp 0 vs ageing, Orders vs Outstanding, Organisation phone table, Allotment composer strip, orphaned menus) | investigation | S–M each |
| 1 | **Tokens & kit**: one `Status`/`Pill` rule, one touch height (D1), 14px floor (bottom bar), one date/money/unit helper set, one `phone-cards` kit (merge 6 copies), `Sheet` anatomy implemented once (head/badge/foot/tabs/width `size`) | D1–D3, D6–D8, D14 | M |
| 2 | **Words**: mechanical sweep — statuses (D2), verbs (D4/D5), scope (D9), spelling (D10), casing (D11), menu = H1 (D12), loading/empty phrases, names not logins | D2, D4, D5, D9–D12 | M (codemod + review) |
| 3 | **Sheets**: migrate all 269 to the anatomy by family (Procurement, Ops/Inventory, Sales, Finance `Panel` → `Sheet`, HR, System/GA, Me), add confirmations, dirty-guard, URL keys | D14, D15 | L (agents per family) |
| 4 | **Phone/desk parity** and remaining top controls (Picking, Dispatch, Control, Notifications, Receiving/Allotment switches) | — | M |
| 5 | **Printed documents** language | D16 | S–M |

Recommended start: Wave 0 and Wave 1 in parallel (they do not depend on each other), then Waves 2 and 3 in parallel by department once the kit is in place.

## 6. Evidence index (`ux-audit/evidence/`)

`00-static-code.md` (counts) · `01-sheets-buying-merch-ops-inventory.md` (33 findings, census of ~60 sheets) · `02-sheets-sales-finance-hr-system.md` (36 findings, census of ~78) · `03-procurement-master-marketing.md` (36) · `04-ops-inventory-allotment.md` (36) · `05-sales-exec-system.md` (≈ 37) · `06-finance.md` (34) · `07-hr.md` (37). Each finding names routes/files, the evidence ("seen on screen" or "from code") and a suggested standard.
