# Retired, and what replaces it

Each row below is something screens still do that this system replaces. The counts were measured across `frontend-hub/src` on 17 Oct 2026.

- A new screen never uses the left column.
- A screen being touched moves to the right column.

| Retired | Where it still is | Use instead |
| --- | --- | --- |
| Button variants `soft` (65), `tint` (35), `danger` (61) | White.css repaints them as ghost, primary and destructive, so the code hides a second primary (Move + Write off in `inventory/missing-list.tsx`) | `ghost`, `primary` or `destructive`; `TintButton` where the screen means a wash |
| The second kit in `screens/me/ui` (button, pill, status-pill, card, field) | The 12 `/me` screens | The main kit, and `PageHeader` on `/me` |
| About 86 raw `<button>`s styled like buttons, and 9 copies of the grey pill toolbar button | `sales/comparison.tsx`, `list-chrome.tsx`, `dock-tools.tsx` … | `Button` (and a dock size for the pill) |
| A Submit that saves (36) | `vendors.tsx`, `assistant/glossary.tsx`, `letters.tsx` | Save · Save changes |
| `Pill` wrappers and about 111 local tone maps; Waiting, Refused, Declined, Taken back, Live as words | `maintenance/parts.tsx`, `node-health.tsx`, `board/returns.tsx` | `Status` / `Pill` with `statusWord()` and `statusTone()` |
| A status drawn as a green word with no dot | The PO list (Suppliers draws "● Active") | `Status` |
| Hand-made stamps, bold and uppercase | `board/stage-table.tsx:559`, `board/parts.tsx:693`, `purchase-orders.tsx:3071` | `DocStamp` |
| `NumberCard` / `CardRow`, `ReportSummary`, `.figure-box`, `KpiBox`, `ListHead` | About 30 Finance reports; `finance/report.tsx` | `KpiStrip` / `Kpi` |
| A list whose bar sits above its figures. A report's scope bar (period, place) comes first, and that is right. | `finance/asset-register.tsx`, `finance-final/transactions.tsx` | A list reads head → figures → tabs → bar |
| The `sub` line on `PageHeader` (passed 157 times, never drawn) | Most screens | Leave it out |
| `Segmented` used as a filter, status or other (10 lists); `DeskFilterChips` rows (6, now render nothing) | `catalogue.tsx`, `outstanding.tsx`, `vouchers.tsx`, `promotions.tsx` | `SubTabs` for the status; `ListFilters`' radio chip line otherwise |
| The Filter button, the Filters sheet and the right rail at 96rem (owner: 14 Oct 2026 "filter … buttonnya hapus"; 12 Oct "jangan filter kanan") | Screens still passing the old `FilterPanel` / `DeskFilterButton` props or hand-placing them | `ListFilters` in the bar (owner, 20 Oct 2026) |
| `FilterOmnibox` as a filter | Sourcing, Articles, Pricelist | The one search box of `ListFilters`, which offers the names |
| A dropdown or `Select` as a filter (owner, 18 Oct 2026: "filter dropdown jangan pake … pakai radio icon") | Screens with a hand-made filter select | Icon radio chips for a short list, the search box for a long one. A searchable picker stays only for units and sites (finance `UnitSelect`) |
| A filter held in `useState`, not in the address | Screens with local filter state | `useFilters` or `useFilterState`, so the list travels in a link |
| A hand-written bar (about 50) and `DESK_BAR` (8); hand-made search inputs (about 20) | Even `purchase-orders.tsx:1454` | `Toolbar` + `ExpandingSearch` |
| `div` grids with `min-w-[61–78rem]` that scroll sideways at 1440 | GA: supplies, locations, repairs, service schedule, replacements (assets and contracts moved to `DataTable` on 17 Oct) | `DataTable` (its phone cards come with it) |
| Hand-made list tables; `MiniTable` used as a page's list | `operations/stock/stock.tsx`, `allotment/returns.tsx`, `inventory/missing-list.tsx`, `inventory/stock-card.tsx`, about 14 People pages | `DataTable` |
| `Grid` for a list | `finance/credit-notes.tsx`, `asset-register.tsx`, `contractor-projects.tsx`, `expense-codes.tsx` | `DataTable`. Keep `Grid` for statements (P&L, balance sheet, trial balance, cash flow, ledger). |
| A list in its own scroll box | Payables › Bills (`max-h-[calc(100dvh-21rem)]`) | `DataTable pageScroll` |
| The table card copied by hand (143), half with `overflow-hidden` | Everywhere | One table frame with `overflow-clip`, so the heading still sticks |
| The 24px lead-figure class copied 37 times | `purchase-orders.tsx:693`, `outstanding.tsx:189`, `people/directory.tsx:330` … | `CardFigure` |
| `KeyValue` (31) and raw `<dl>` (28) | `finance/credit-notes.tsx:440` … | `Facts` / `Fact` |
| Read mode drawn as disabled inputs | `inventory/flows.tsx`, `master/term-form.tsx`, `system/users.tsx`, `procurement/composer.tsx`, `finance/cash-documents.tsx`, `inventory/pools.tsx` | `Facts`, and Edit swaps to fields |
| Blue link buttons styled by hand (111 in 65 files); names shown as plain text in sheets | `suppliers.tsx:2442`; `supplier-bills.tsx:1658`, `maintenance/hub.tsx:245`, `sale-sheet.tsx:214` | `record-link` through `openable`, opening as a layer |
| A plain-text action: a raw `<button>` that is only a blue or red word, with no fill (18 in 17 files on 19 Oct 2026; some are links to a record). The client does not read it as a button (18 Oct 2026) | `finance-final/journals.tsx:616`, `finance/bank.tsx:714`, `procurement/composer.tsx:2516`, `stores/till-seats.tsx:47` | `TintButton` for an action; `record-link` for a name that opens a record |
| Sheets with no `size` (195 of 291) and the old `width` prop (61) | Across the app | `size`: rail, wide, table or workspace |
| A width set on a sheet through `className` (16) | `supplier-bills.tsx:2259`, `payments.tsx:1075`, `bank.tsx:694` | `size` |
| The `actions` prop (43); a Submit row in the body (28) | `master/colours.tsx`, `vocabulary.tsx`, `payment-templates.tsx`, `inventory/units.tsx` | `footer={<SheetFooter …/>}` |
| Hand-made sheet feet (69) | Even the PO sheet (`purchase-orders.tsx:2337`) | `SheetFooter` |
| Tabs inside a record or a form | `sale-sheet.tsx:139`, `vendors.tsx:542`, `stock-cards.tsx:949`, `chat-info.tsx:110`, `cash-documents.tsx:2133` | The `tabs` prop, which draws sections in one scroll |
| Edit opening a second sheet | Promotions, vouchers, campaigns, catalogue, people | `swap`: Edit in place |
| Two statuses in a sheet head; a count or a version as the badge | `vouchers.tsx:918`, `promotions.tsx:1617` | One status, from `Status` |
| Two Activity blocks in one sheet | `allotment/allotments.tsx`, `assets/hub.tsx` | One, through `subject` |
| A centred `Panel` holding a form; a hand-built sheet; a dark backdrop | `finance-lab-2/cash-counts.tsx`, `count-review.tsx:316`, `outbound-papers.tsx:99` | `Sheet`, over the `scrim` |
| Field hints written as sentences (113) | `vendors.tsx:611`, `comparison.tsx:91` … | No hint, or a few words that stop a mistake |
| `toLocaleString` (60) and `Intl.NumberFormat` (4) on screens; signs made with a hyphen or arrows | `sales/matrix.ts:85`, `people/directory.tsx:324`, `finance/dashboard.tsx:758` | `money`, `count`, `signed`, `percent` |
| `unitWord("koli")` → cartons | `lib/format.ts` | Koli in outbound (owner, 12 Oct 2026) |
| Create verbs Create (4), Make (3); Add supplier vs Create supplier | `vendors.tsx:176`, `suppliers.tsx:1750`, `to-allot.tsx:187` | New supplier |
| Title Case buttons | New Division, New Tag, New Size, New Color, New Name | New division … (sentence case) |
| Duration literals (88) and inline `.animate()` timings (12) | `pack-sheet.tsx`, `list-chrome.tsx`, `campaigns.tsx`, `lib/pull-in.ts` | `t-*` and `ease-*` tokens, or no motion |
| Arbitrary radii (25 values; `rounded-[0.625rem]` ×21) and inline shadows (16) | `board/drag.tsx`, `allotment/to-allot.tsx`, `login-form.tsx` | `r-*` and `shadow-*` tokens |
| `font-mono` (575) and `uppercase` (113) classes that white.css switches off | 200+ files | Remove the class, then remove the override |
| The unrouted `screens/finance-lab/` (34 files; only `COMPANY` in `print.tsx` is used) | — | Delete it after moving `COMPANY` |
| `ExportCsv` drawn as a quiet button beside the ghost Columns | `components/ui/list-chrome.tsx` | A ghost, like every supporting action |
| A "New …" or "Add …" button without its plus glyph | `procurement/suppliers.tsx` (New supplier) | The plus glyph on every New and Add |
| `Toolbar`'s own 7px gap and 14px under the bar | `components/ui/segmented.tsx` | `bar-gap` 8 and `bar-to-table` 12, as the reference page draws them |
| `capitalize` on `Checkbox` and `Toggle` ("Include Settled"); `SwitchPill` fixed on 17 Oct | `components/ui/form.tsx`, `field.tsx` | The label as written in sentence case |
| An invalid `Input` or `Textarea` keeping its grey border (white.css line 485 outranks line 509) | `styles/white.css` | A `bad` border on every invalid field |
| `PhotoViewer` on black at 90%; the compact desk's floating panel over `bg-black/20` | `photo-viewer.tsx`, `app-shell.tsx` | The `scrim` veil: nothing darkens |
| Blue unread counts and a blue waiting dot | The phone tab bar, Chat, Discussions | The red `CountBadge`: a notification never takes the selection colour |
| A `NoAccessState` helper sentence; a plain Cancel turned red in a dialog that is not a danger | `states.tsx`, `dialog.tsx` | One line; in a dialog, Cancel then the act |
| The boot skeleton with no styles since the move to TanStack Start | `components/boot-skeleton.tsx` | A skeleton drawn in the floating-panel shell |
| `CardButton` asking for the retired `tint` | `components/ui/phone-cards.tsx` | `primary` at `size="card"` |
| `Kpi tone="up"` painting the figure in `ok` (2.6:1) | `components/ui/kpi.tsx` | `ok-fg` for a word; a figure stays `ink` unless it is a problem |
| "Needs attention" written twice: `NeedsAttention` and `ExceptionQueue` on five overviews | `screens/finance/needs-attention.tsx` and the department overviews | One `ExceptionQueue` |
| Executive ↗↘ arrows, a legend under the chart, progress `Bar`s | `screens/executive/*` | `KpiStrip`, the chart tokens, `signed()`, the legend over the plot, numbers not bars |
| The PO list's own tone map (`PO_STATUS`), its status word with no dot, and its hand-made stamp | `screens/procurement/purchase-orders.tsx`, `shared.ts` | `Status` with `statusTone()`, `DocStamp` |
| The PO composer's "Review order" then "Submit", Title Case field labels, fields two across at 16px, and Add item as a second primary | `screens/procurement/composer.tsx` | One primary (Save), sentence-case 15px labels four across, Add item as a ghost with its plus |
| A green Net profit, 60px rows and mono codes in the P&L, with no row opening its ledger | `screens/finance-final/reports/profit-and-loss.tsx` | `ink` figures (red only when negative), the kit's 52px rows, every account row opening its ledger as a layer |
| "Colour" in three UI labels | `master/*`, `merchandise/*` | "Color": the screens use American spelling |
| `DataTable`s with no `refresh` (26 of 160, 20 of them in Finance), and screens with their own `refetchInterval` (27) | Finance lists and others | `refresh={[query]}`: every table stays live through `RefreshStamp` |
| `AppSheet tone="dark"` with no fill, because `--rail` is transparent in the white look | `components/shell/app-sheet.tsx` | A `canvas` sheet |
| The search palette resetting its scope three different ways | `components/shell/command-palette.tsx` | One reset when the palette closes |
| The notification popup's 22rem cap pushing its foot below the fold | `components/shell/notification-bell.tsx` | A foot that always shows; the list scrolls |
| The account orb covering a card's figure or foot on a phone | `components/shell/account-orb.tsx` | An orb that never covers a card's figure or its foot |
| The time-travel pill (208px) wider than its panel foot (184px) | `components/shell/time-travel-panel.tsx` | A pill that fits the foot |
| `StopPair`, imported by nothing | `components/ui/stop-pair.tsx` | Delete it |
| The board's search, store, Needs attention and Dispatched at 44px in the head; `tint`/`danger` buttons and hand-made stamps on cards (the Pick, Pack and Dispatch buttons and `board.tsx` already use `TintButton`); Title Case lane names in Return Store | `screens/operations/board/*` | A 36px bar under the head, `primary`/`destructive`, `DocStamp`, sentence-case lanes |
| Three separate grid codes for matrices, hex tag colours and tinted state chips; Pricelist By article without phone cards | `commercial/pricelist.tsx`, `procurement/setups.tsx`, `allotment/matrix.tsx` | One matrix grid, `Tag` and `Status`, and `DataTable` cards for the By article view |
| Supplier and line cards copied between two workspaces | `procurement/setups.tsx`, `allotment/to-allot.tsx` | One shared card |
| "Central Dashboard" as the page title and default name; the door wordmark in `font-bold`; the join page drawing its own C tile | `sign-in-door.tsx`, `business-door.tsx`, `screens/join/join-page.tsx` | "Central"; Inter 600; `BrandMark` |
| Print CSS copied into five files; three inks and mixed languages on one paper; stamp tones that differ from `DocStamp` | `outbound-papers.tsx`, `purchase-orders.tsx`, `letters/document.tsx`, the giro print | One paper stylesheet, one ink, one language per paper, `DocStamp` tones |
| Menus in two shapes: `list-chrome`'s copies (6px padding, 32px rows) and `POPUP`/`ITEM` (5px, 36px) | `components/ui/list-chrome.tsx` | `POPUP`/`ITEM`, 36px rows |
| `RailTip` filled with `ink`/`canvas` rather than the `tooltip` token | `components/ui/rail-tip.tsx` | The `tooltip` token |
| An invalid `PickOne`/`PickMany` staying grey on a desk; `BottomSheet tone="dark"` transparent in the white look | `components/ui/pick.tsx`, `picker-sheet.tsx` | A `bad` border on every invalid field; a `canvas` sheet |
| The hub's `ScanField` (unused): white on white, no focus ring, a mono value | `components/ui/scan-field.tsx` | The store app's 44–48px bordered scan box with its focus ring |
| `Allocation` / `AllocationRow`, imported by nothing | `components/ui/allocation.tsx` | Use it in New allotment, or delete it |
| 116 hand-written form grids with 12, 16 or 20px gaps; forms two across where the rule is four across on a wide sheet; `Section` icons (13) and explaining asides (11) | Forms across the app | `FormSection`: four across on a wide sheet, two on a rail, 24px apart, a word for a title |
| An `ExceptionQueue` row's coloured tile | `components/ui/exception-queue.tsx` | A severity dot and a word, like `Status` |
| The Sonner toast's dark pill action button | `components/ui/toast.tsx` | A quiet text action in the toast |
