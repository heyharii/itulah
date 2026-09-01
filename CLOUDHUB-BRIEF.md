# Cloud Hub migration — implementation brief
Purchasing · Sourcing (incl. basket) · Commercial — `/Users/hari/itulah/frontend-cloud`

All target values are **declared px** from the prototypes with the **rem** to write (root is `html{font-size:14.4px}`, so `rem = declared/16` lands exactly on the prototype's zoomed pixel). Never write a raw `px` type size again — it is the single most common defect in this codebase (128 literals in `commercial/`, 39 in `po/`, 11 in `sourcing/`).

---

## 0. Rulings — settle these before touching code

Every one of these is already decided; they are listed so an implementer never re-litigates them mid-file.

| Conflict | Prototypes say | DESIGN.md says | **Ruling** |
|---|---|---|---|
| Accent hue | `#3b6fe0` royal | `#3c52f0` indigo | **DESIGN.md.** Already correct in `index.css`; only stale `var()` fallbacks disagree. |
| Two blues | `--info` byte-identical to `--accent` in 10 of 11 workbenches | indigo = selected, sky `#2f86d8` = in motion, never swap | **DESIGN.md.** Already correct in `index.css`. |
| Status palette | muted ERP `#2e9e5b` / `#b7791f` | vivid `#36b827/#d9f4d2`, `#c9892e/#faeacd` | **DESIGN.md.** Already correct in `index.css`; 18 component fallbacks still carry the old ones. |
| Well grey | `--soft:#fafafa`, spent on the sidebar | `#f7f7f8`, spent on the content well | **DESIGN.md.** Already correct. |
| Hairlines | `#eeeef1 / #e6e6ea` | `#ececef / #e4e4e8` | **DESIGN.md.** Token is right; ~4 hardcoded `#eeeef1` fallbacks in `app-shell.tsx`/`po` are stale. |
| Card radius | 14px declared (12.6 eff) | 16px | **DESIGN.md** — keep `--os-r-card: 1rem` (14.4px eff). Do not chase 12.6. |
| Status pill | 11px/600 + mandatory dot | 11.5px/500, dot optional | **DESIGN.md on type, prototype on box.** `0.71875rem` / `font-medium` / height `1.3125rem` (21 declared → 18.9 eff). |
| Full-width table headers | mono UPPERCASE micro-caps in `{faint}` | sentence-case `{body}`; mono micro-caps belong to in-card mini-tables only | **DESIGN.md.** This is the highest-blast-radius change in the brief — see §1.1 and Decision D1. |
| Overlays | `rgba(20,20,25,.28)` dark dim | white veil `rgba(255,255,255,0.72)` | **DESIGN.md.** Already correct in `ui/sheet.tsx:56` and `ui/dialog.tsx:32`. |
| Detail-rail geometry | inset 22, r16, `hairline-2`, shadow `.13` | inset 16, `r.shell` 18, `hairline`, `e.float` `.10` | **DESIGN.md on geometry.** But the prototype's **actions pinned in the drawer header** (max two + `⋯` overflow) is an improvement DESIGN.md should absorb — adopt it, ignore DESIGN.md's "composer at the foot" for record actions. |
| App shell | no app-card, edge-to-edge | one rounded card on `#e3e4e6` | **DESIGN.md.** Three tokens (`--os-backdrop`, `--os-shadow-shell`, `--os-r-shell`) exist and are referenced nowhere. |
| Icon rail (shell C) | 58px pastel-mesh rail in every workbench | documents only shells A and B | **Prototype.** It is built and it works; DESIGN.md has the gap. Keep the rail; do not add header workspace tabs. |
| Weights | 450/550/650/700 in use | 400/500/600 only | **DESIGN.md.** Tailwind only, `font-normal/medium/semibold`; no `font-bold`. |
| `zoom:0.9` | shipped in every prototype | bake into tokens, never ship zoom | **DESIGN.md.** Already baked at the root; px literals are what break it. |

---

## 1. Shared work — do all of this first, it changes every screen at once

### 1.1 `src/index.css` — split the table grammar in two *(largest single visible change)*
`table[data-os-grid]` currently gives every list in purchasing, sourcing and commercial the mono-micro-cap, vertical-ruled, pinned-column grammar of `grid-detail.html`. Reserve that; make the default full-width list table `.tbl`.

Add `table[data-os-list]` (and point `custom/table.tsx` `grammar="rows"` at it):
- `thead th`: Inter, **sentence case**, `0.625rem` (10 declared), `font-weight:600`, `letter-spacing:.04em`, `color:var(--os-mute)`, `background:transparent`, `padding:0.5625rem 0.875rem` (9/14), `border-bottom:1px var(--os-hairline)`, **not sticky**.
- `tbody td`: `padding:0.625rem 0.875rem` (10/14) → measured row height **38.2px effective**; `color:var(--os-text)`; `border-bottom:1px var(--os-hairline)`; **no `border-right` anywhere**; no `max-width`, no ellipsis, no pinned first column.
- `tbody tr:hover td { background: var(--os-soft) }`; `tr[data-state=selected] td { background: var(--os-accent-bg) }` — **tint only, delete the `inset 2px 0 0 accent` left bar** (DESIGN.md: "no left bar").
- `tbody tr:last-child td { border-bottom: 0 }`; **no `tfoot` row-count band** — `DataGrid` must stop synthesising `"N rows"`.
- Sticky header + pinned first column become an opt-in prop for tables genuinely wider than the viewport.
- `.id` cells: `var(--os-mono)`, `0.71875rem` (11.5), `color:var(--os-body)`.

Also in `index.css`: keep `--os-r-card:1rem`; add a `[data-cloudhub] :focus-visible` rule (see §4 — it must be authored).

### 1.2 `custom/status-pill.tsx`
Add `h-[1.3125rem]` and `px-2`; keep `text-[0.71875rem] font-medium`. Currently ~16.4px tall against a 18.9px target. It is inherited by every PO, sourcing and price-book status.

### 1.3 `ui/sheet.tsx` — detail-rail geometry, and `data-cloudhub` on every portal
- `float` edge classes: `top-4 right-4 bottom-4` (16 declared), `rounded-[var(--os-r-shell)]`, `border-[var(--os-hairline)]`, `shadow-[var(--os-shadow-float)]` (`0 14px 40px rgba(20,20,25,.1)`). Currently 22px / `--os-r-sheet` / `hairline-2` / the `.13` shadow.
- Width `sm:max-w-[27.5rem]` (440 declared → 396 eff), within DESIGN.md's 400–520.
- **`SheetContent` must set `data-cloudhub=""`.** It portals to `document.body`, so any sheet that omits it loses every `--os-*` value and every `.os-card` rule. `sheets/sheet-shell.tsx:118` already does this; `sourcing/basket-sheet.tsx` does not, which is why the basket has no cards at all.
- Body gutters `px-5 py-[1.125rem]` (20/18 declared) — the basket currently renders at x=0.

### 1.4 Stale-fallback sweep (18 occurrences, mechanical)
Replace across `po/`, `sourcing/`, `commercial/`:
`--os-warn,#b45309` ×9, `--os-warn,#f59e0b` ×1 → `#c9892e` · `--os-ok,#10b981` ×3, `#059669` ×2, `#047857` ×2, `#2e9e5b` ×1 → `#36b827` · `--os-accent,#059669` ×3 → `#3c52f0` · `--os-info,#0ea5e9` ×1 → `#2f86d8` · `--os-warn-bg,#f8f1de` ×7 → `#faeacd` · `--os-ok-bg,#eaf5ee` → `#d9f4d2` · `--os-hairline,#eeeef1` → `#ececef` · `--os-accent-bg,#ebedfd` → `#e9ebfc`. They are invisible inside `[data-cloudhub]` and are exactly what paints in the un-themed basket sheet.

### 1.5 Also fix `font-[var(--os-mono,…)]` → it compiles to `font-weight`
Verified in `dist/assets/index-DFcALcIe.css`. Three runs render in Inter that should be mono: `sourcing/product-grid.tsx:125` (SKU), `:142` (Article), `sourcing/basket-view.tsx:124` (group meta). Use `font-mono` or `font-[family-name:var(--os-mono)]`.

### 1.6 New shared primitives — `src/components/custom/`
None of these exist (`grep subtab` = 0 hits repo-wide); all three modules need them, so build once.

| Component | Measured target |
|---|---|
| `SubTabs` | row on a 1px `--os-hairline` baseline, `gap:2px`, `mb-[1.125rem]`, `overflow-x:auto`. Tab `0.8125rem`/500/`{body}`, `padding:0.5rem 0.75rem 0.625rem`, `mb-[-1px]`; active = `{ink}` text + `2px` `{ink}` bottom border. |
| `KpiStrip` / `Kpi` | `grid-cols-4`, `gap-3` (12), `mb-[1.125rem]`. Card: `1px --os-hairline`, `--os-r-card`, `padding:0.8125rem 0.875rem`, `--os-shadow-soft`, **no fill**. Label `0.625rem`/600/uppercase/`.04em`/`{mute}`; value `1.4375rem`/600/`-0.02em`/tabular (DESIGN.md 23px beats the prototype's 18); delta `0.71875rem`/600 in ok/bad/mute. |
| `CardHeaderStrip` | `--os-soft` band, full-bleed, rounded top, `padding:0.875rem 1rem 0.6875rem` (≈41.4px tall). `h3` `0.875rem`/600/`-0.01em`; `.meta` `0.75rem`/400/`{mute}`; optional trailing `{body}` cross-link `0.75rem`/500 + 12px chevron. |
| `KeyValueRows` | one fact per row, `flex justify-between`, `gap-3`, `py-2` (8), `0.78125rem` (12.5); key `{mute}`/400 left, value `{ink}`/500 right, Inter + tabular; `1px --os-hairline` between. |
| `TotalsLadder` | `mt-[0.625rem]`, `border-top 1px --os-hairline`, `pt-2`. Rows `0.75rem`/`{body}`/`py-[3px]`; final `.tot` = `{ink}`/600 with its own `border-top`, `mt-1 pt-[0.4375rem]`. |
| `MiniTable` | in-card only. `th` = `var(--os-mono)`, `0.625rem`/500/`.03em`/UPPERCASE/`{faint}`, right-aligned except col 1, `padding:0.375rem`; `td` `0.75rem`, `padding:0.4375rem 0.375rem`. No header band. |
| `Lifecycle` | `flex`, `mt-[2px] mb-4`. Dot `1.0625rem` (17) circle, glyph `0.5625rem`; label `0.65625rem`/600; `2px` connector in `--os-hairline` → `--os-ok` when passed. done = `ok-bg` fill + `{ok}` glyph · current = `{ink}` fill + white · todo = `soft-2` + `{faint}`. |
| `ExceptionRow` | `padding:0.6875rem 1rem` (≈56.2px tall), hairline between, `--os-soft` hover. `1.875rem` tinted squircle at `--os-r-inner` · name `0.84375rem`/500 + `{mute}` `0.75rem` sub · right-aligned amount `0.84375rem`/600 · `StatusPill` · `{faint}` chevron. |
| `DocumentTrail` | rows `py-[0.375rem]`; `1.5625rem` squircle at `0.4375rem` radius carrying a mono `0.53125rem` code (done `ok-bg`/`{ok}` · current `accent`/white · todo `soft-2`/`{faint}`); title `0.78125rem`/500, `{mute}` `0.6875rem` sub, right-aligned tabular amount; `1.5px --os-hairline-2` connector. |
| `ActionRow` | `flex flex-wrap gap-2`, buttons `h-8` (32→28.8) pills; **first is the one `variant="default"`, the rest `ghost`**. Lives inside the card, never as a loose rule across the well. |
| `Field` / `FieldLabel` | label `0.625rem`/600/UPPERCASE/`.04em`/`{mute}`, `mb-[0.3125rem]`. Input `min-h-[2.125rem]` (34), `1px --os-hairline-2`, `--os-r-inner`, `padding:0.4375rem 0.6875rem`, `0.8125rem`, `{ink}`. Two-up = `grid-cols-2 gap-[0.625rem]`. **Delete every `h-7`/`h-8` input override** — 10 in `po-draft.tsx`, all of `commercial/` — they beat the themed 2.125rem. Raw `<select>`s must carry `data-slot="select-trigger"` or the theme never reaches them (`simulate-view.tsx:144,186`). |
| `ListToolbar` | between header and card: `flex gap-[0.4375rem] mb-[0.875rem]` — `Segmented` status switch, `flex-1` spacer, then ghost `Chip` buttons (Filter · date range · Sort). |
| `Chip` | `h-[1.875rem]` (30), pill, `--os-soft-2`, `0.75rem`/500/`{text}`, `px-[0.6875rem]`, `0.8125rem` icon; `.gh` = white + `1px --os-hairline-2`. |
| `RowActions` | trailing `td` with a `{faint}` `⋯` opening a `min-w-[11.625rem]`, `--os-r-inner`-ish (11 declared) menu on `--os-shadow-float`. |

`Segmented` sizes are ~14% short of `.vtoggle` / `.seg`: `sm` → `h-[1.625rem] px-[0.6875rem] text-[0.75rem]`; the icon variant → `w-[1.875rem] h-[1.75rem]`, icons `0.9375rem`.

### 1.7 `app-shell.tsx` — the floating app-card and the missing breakpoints
- Wrap the grid: `body`/root gets `background: var(--os-backdrop)` and `padding:1.25rem`; the shell gets `border-radius: var(--os-r-shell)` and `box-shadow: var(--os-shadow-shell)`; full-bleed below `sm` (480). Three declared tokens, currently zero references.
- **Below `lg` there is no navigation at all today** — the rail *and* the facet column are `hidden … lg:flex` with nothing replacing them, so on a tablet a user cannot change screen or reach a filter. Add: at `md` the facet column becomes an overlay drawer over the white veil (`fixed left-[58px] w-[15.75rem]`, `--os-shadow-float`) behind a Filter chip; below `sm` the rail becomes the floating bottom tab bar (3–5 separate `3.25rem` squircles, `gap-[0.875rem]`, active = solid `--os-accent` + white glyph, hidden on pushed detail screens).
- The facet aside and `<main>` are both `--os-soft`; give the aside `--os-canvas` so the one step of contrast survives (DESIGN.md: sidebar = `{canvas}`, well = `{soft}`).
- Rail geometry in `nav.tsx` is raw px (`58px`, `pt-[13px]`, `gap-[11px]`, `size-[30px]`, `rounded-[9px]`, `size-[15px]`, `w-[22px]`, `-left-[9px]`), so it renders ~11% larger than the rem-scaled content beside it → `3.625rem`, `pt-[0.8125rem] pb-[0.875rem]`, `gap-[0.6875rem]`, `size-[1.875rem] rounded-[0.5625rem]`, `size-[0.9375rem]`, `w-[1.375rem]`, `-left-[0.5625rem] w-[0.15625rem]`.
- Content column: `max-w-[80rem]` (1280) if DESIGN.md wins over the prototype's 1240 — see Decision D6.

### 1.8 Adopt `ScreenBanner` — delete 9 hand-rolled strips
`ScreenBanner` already renders the documented banner and is used **zero times** in these three folders. Replace: `price-amendments-view.tsx:69`, `po-draft.tsx:311,318`, `basket-view.tsx:84`, `prices-view.tsx:186,196`, `price-books-view.tsx:140,214`, `fleet-view.tsx:83`. Two of those are red text on bare white with no tint; one is a blocking failure in `{body}` grey. A violated constraint is `{bad}`, tinted, rounded `--os-r-inner`, never a square `border-b` band.

### 1.9 The one dark surface
Four inverted surfaces on `po-draft.tsx` alone (`:272` step chip, `:506` tag toggle, `:523` division badge, plus the CTA); three in a three-supplier basket (`basket-view.tsx:132` per-group "Draft PO"). Rule: one `variant="default"` per screen. Step switch → `Segmented`; tags → tinted `.stag` pills; per-card actions → `Chip`/`secondary`.

### 1.10 px → rem sweep
`text-[13px]`→`0.84375rem` · `text-[12.5px]`→`0.78125rem` · `text-[12px]`→`0.75rem` · `text-[11.5px]`→`0.71875rem` · `text-[11px]`→`0.6875rem` · `text-[10.5px]`→`0.65625rem` · `text-[10px]`→`0.625rem`. Do this file-by-file with the module work below, not as a separate pass.

---

## 2. Module work, in order of visible difference

### 2.1 Purchasing (`components/po/`) — largest gap, do first
1. **`purchase-orders-view.tsx`**: add `ListToolbar`. `orderFilterFields()` builds four facets that reach no UI — `AppShell` gets no `facets` and no `DataTableToolbar` renders, so the only control is a Reset button for filters nobody can set. Toolbar = six-way `Segmented` (All/Draft/Sent/Partial/Closed/Cancelled) + spacer + Filter · Order date · Sort chips; header gets a `secondary` Export beside the one dark **New PO**.
2. **`columns.tsx`**: target columns are `PO` (mono `.id`) · Supplier · Order date · Expected (`{bad}` + `+9d` when overdue) · Lines · Ord/Recv · **Total** · Received pill · Status pill · trailing `RowActions`. Today there is no money, no line count, no expected date and no row action. `ReceiptProgress` meter → `StatusPill` (Complete/Partial/None) — see Decision D4.
3. **`order-panel.tsx` — rebuild.** Order: `Lifecycle` (Draft ✓ / Sent ✓ / Partial ● / Closed) → `KeyValueRows` ×8 (Supplier, Order date, Expected, Destination, Payment terms, Ordered/received, Total amount, Currency) → `MiniTable` of lines → `TotalsLadder` (Subtotal · PPN · 11% · Total — PPN is currently named nowhere) → `DocumentTrail` (PO → GRN → 3-way match → invoice → journal) → `ActionRow` (Record receipt · Three-way match · Close partial · Duplicate · Cancel · View PDF). Kill the horizontal `Figure` eyebrow strip; kill the 9 `font-mono` money renders — **money is Inter + `tabular-nums`; mono is for identifiers, micro-caps and codes only** (11 more in `po-draft.tsx`, 3 in `price-amendments-view.tsx`).
4. **`price-amendments-view.tsx`**: ~170px stacked inline forms → `ExceptionRow` (56.2px) with a severity `StatusPill`; the two-sentence explanation repeats on every row and belongs once, above the list. The Difference figure is bare coloured text with no pill — the one thing the status grammar forbids. Blocked on Decision D3.
5. **`po-draft.tsx`**: `Field`/`FieldLabel` throughout, single dark CTA, `ActionRow` inside the card (the footer bar at `:725` is a bare `border-t` floating on the well), blocking validation text in `{bad}` not `{body}`.

### 2.2 Commercial (`components/commercial/`) — most tokens wrong, cheapest wins
1. **`SubTabs`** replace the three `variant="outline"` navigation pills in `prices-view.tsx:173-190`. Blocked on Decision D2 if the four routes are to collapse; the component can land either way.
2. **`KpiStrip`** above each list — today the counts are a prose subtitle (`fleet-view.tsx:70`).
3. **`CardHeaderStrip`** on every list card; Fleet currently stacks two datasets in one card behind a hand-rolled `h2` (`fleet-view.tsx:198-227`) — make the usage table its own card.
4. **Row washes → a Status column.** Delete `bg-destructive/5`, `bg-[--os-warn-bg]/40`, `bg-muted/20`, `/50` at `fleet-view.tsx:130-137,241`, `price-books-view.tsx:177`, `prices-view.tsx:416-421`. Row fills are hover and selection only.
5. **`border-b-4 border-b-muted/60`** group divider (`prices-view.tsx:397,410`) → one hairline. Whitespace separates; one hairline divides.
6. **Deductions are `{bad}`, not `{ok}`/`{warn}`** — `simulate-view.tsx:342,426`, `prices-view.tsx:508`. `{ok}` means Paid/In stock/Completed; nothing green means "money came off".
7. **`{mute}` is unused in all nine files** (`grep -c os-mute` = 0); every secondary line is `{body}`. Mono ids stay `{body}`; captions, sub-labels, timestamps, eyebrows, `.meta` go `{mute}`.
8. **Chips**: `bg-muted … text-[10.5px]` → `.tag` = mono, `0.625rem`/600, `h-[1.125rem]`, `px-[0.4375rem]`, `rounded-[0.375rem]`, `--os-soft-2`/`{body}`.
9. **`simulate-view.tsx`** split `lg:grid-cols-[380px_minmax(0,1fr)]` → `1.55fr 1fr` with the **cart** in the wide slot.
10. **Price cascade** → the `.wf` waterfall: `grid-cols-[8.25rem_1fr_6rem] gap-[0.6875rem] py-2`, `0.5625rem` `soft-2` track with `{faint}` base / `{bad}` cut / `{accent}` final fills, value `0.75rem`/600 tabular, closing on a `{soft}` foot band stating "Final unit price" at `0.875rem`/600.
11. **Fleet's "Send counts to shops"** is the screen's one irreversible act and is `variant="outline"` — make it the dark CTA.

### 2.3 Sourcing (`components/sourcing/`)
1. **`basket-sheet.tsx`** — one line fixes three findings: `data-cloudhub=""` on `SheetContent` (restores every card, hairline, radius and shadow), plus `float` (the flush square-cornered bordered column is *explicitly deprecated* in DESIGN.md) and the 20/18 gutters. Header actions move beside the close control so "Empty basket" stops colliding with it.
2. **`basket-view.tsx`** — group card gains `MiniTable` micro-headers (ITEMS · QTY · UNIT PRICE · LINE TOTAL, currently no headers at all) and a `TotalsLadder` (the total is squeezed into the header meta line); per-group dark CTA → `Chip`.
3. **`product-grid.tsx`** — the checkbox at `top-2.5 left-2.5` sits exactly on the badge at `top-2.5 left-2.5`, so hovering a card covers its own label: move the hover affordance to `top-[0.5625rem] right-[0.625rem]`, `size-[1.75rem]`, circular, `rgba(255,255,255,.92)`. Selection = `bg-[--os-accent-bg]` tint, **not** an indigo border swap. Grid steps: `sm:grid-cols-2 lg:grid-cols-3` currently fire at 576/921.6px because Tailwind's rem breakpoints are scaled by the 0.9 root — three-up must not start before 1024px, so use explicit `@media` widths or px-based screens.
4. **`sourcing-view.tsx`** — add the count/sort toolbar (`.tcount` `0.84375rem` `{body}` with the number in `{ink}`/500; `Sort: … ⌄` pill `h-[2.125rem] px-[0.8125rem]` on `--os-soft-2`); search pill `h-8 w-52` → drop `h-8` (it beats the themed `2.125rem`) and widen to `w-[18.75rem]`; move `DataTableFloatingBar` and `ItemSheet` inside the `data-cloudhub` subtree or give them their own attribute.
5. **`columns.tsx`** — `StatusDot` → `StatusPill`; `Tag` `h-5 text-[11px] font-medium rounded-md` → `.tag` as above.

---

## 3. Decisions that need the product owner

- **D1 — `data-os-grid` or `.tbl`?** Is the mono-micro-cap / vertical-ruled / pinned-column grid an intentional house grammar lifted from `grid-detail.html`, or should these lists revert to `.tbl`? DESIGN.md is unambiguous (sentence-case `{body}` headers for full-width tables), but the grammar is shared with **finance and allotments** through `custom/data-grid.tsx`, so the ruling reaches screens outside this brief. §1.1 assumes DESIGN.md wins.
- **D2 — do Prices / Price books / Fleet / Simulate collapse into one route with sub-tabs?** The prototype has one Pricing page. Four TanStack routes, the deep-linkable book sheet and the ↑/↓ row walk all depend on the current shape — a routing decision before a design one.
- **D3 — price amendments: exception queue or two-pane matching surface?** It has no counterpart page in `procurement-prototype.html` at all. Rows-plus-record is a restyle; list-left/decision-right is a rewrite. Nothing below the row level should be built until this is answered.
- **D4 — PO list: `Received` meter or Complete/Partial/None pill?** And does the list gain the order total and line count? Both need API fields the table does not currently receive.
- **D5 — is the sourcing card a buyer's restock card or a quote card?** `catalog.html`'s `.mgrid` wants Revenue-30d, Gross margin, Sell-through, On-hand, Sold-30d, Age. `SourcedItem` carries none of them — a supplier item we have never bought has no sell-through. Either the wire grows those fields, or the card borrows the `.pcard` chrome and fills the grid with quote facts (MOQ, lead time, currency, last quoted). Related: does sourcing surface **system tags** at all, and if not, what colour is the division badge — it is painted indigo today, and indigo means "selected".
- **D6 — content width and card radius.** `max-w-[77.5rem]` (1240, the prototype) vs DESIGN.md's 1280 (`80rem`). Same question for `--os-r-card` if the 16px ruling is ever revisited; it moves every card on every screen.
- **D7 — the PO draft has no prototype counterpart.** `create_po` is a four-field stub. Only the grammar findings (labels, field geometry, totals ladder, one dark surface) port safely; the layout is an open design question, not a divergence.
- **D8 — does the basket keep its own `ScreenHeader`, or move to `SheetShell`?** Both cannot be true, and the current compromise is what costs it its cards, its gutter and its float.
- **D9 — dark mode: ship the toggle or drop it?** DESIGN.md puts a switch in the sidebar footer for a mode it never defines (no dark palette, no inverted tokens), and states "Always light" three sections later. Recommendation: drop the toggle until a palette exists.
- **D10 — price facet: slider or `.fpill` bands?** The slider's min/max derive from loaded rows while every other facet is counted server-side over the whole catalogue.
- **D11 — does a read-only screen owe a dark CTA?** Prices has no mutation at all.

---

## 4. States with no specification anywhere — must be authored

These are not migration gaps; nothing in DESIGN.md or any prototype specifies them, so someone has to invent the values before an implementer can be held to them.

1. **Focus ring.** "focus" appears twice in DESIGN.md, both times only as a job of `{accent}`. No width, offset, style, no `:focus-visible` policy. The only implementation anywhere is `login.html`'s ink border + `3px` `{soft-2}` ring, which uses no accent. Proposal to ratify: `outline: 2px solid var(--os-accent); outline-offset: 2px` on `:focus-visible` only. Every `Button` in the prototypes is `border:0;background:none`, so today they fall back to the UA ring.
2. **Keyboard navigation.** Esc-close and ⌘K are the entire spec. No tab order, no roving tabindex for the rail or tab bar, no arrow keys for lists/tables/menus, no skip link, and — since Esc-close *is* specified — no focus trap or focus restore for sheets and dialogs.
3. **Disabled states.** Nothing, anywhere, for any control.
4. **Dropdown / overflow menus, tooltips.** The `⋯` row menu and the rail tooltip are in every prototype and in no spec (prototype tooltip: `#101012` pill, `12.5/500`, radius 8).
5. **Table sort indicators, column resize, pagination.** All three exist in the app, none is specified.
6. **Skeletons.** Two sentences only ("allowed inside an already-open sheet whose header shows the record id; never skeleton a whole screen"). No geometry, fill, row count or shimmer policy.
7. **Dialog.** No width, max-height, scroll behaviour or stacking rule.
8. **Empty vs filtered-empty sentences.** The rule is stated ("different sentences"); the actual copy for each of the nine screens is unwritten.
9. **Motion.** Prototypes use `.12–.22s` with `cubic-bezier(.32,.72,0,1)`; nothing states it, and there is no `prefers-reduced-motion` rule.
10. **i18n / formatting.** Zero coverage. No locale, RTL, currency or date rules; no string-expansion allowance for the fixed-width rail and 248px facet column. The prototypes render Rp and PPN and an English app-bar without stating either as policy.
11. **Accessibility floor.** No contrast target. The four text greys and the pale `{line-ico}` icons are the system's most contrast-sensitive choices — `{mute}` `#a6a6ad` on `#ffffff` is ≈2.4:1, and it is specified for every eyebrow, caption and table header in this brief. Someone has to decide whether that ships.