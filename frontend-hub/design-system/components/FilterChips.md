# FilterChips

Filter chips come in two kinds. The radio chips are the list's one line of short answers ("All · Cars · Printers"), drawn by `ListFilters` (owner, 20 Oct 2026). The clause chips below, column, operator and value, are no longer the way a list is narrowed: they appear only for a clause a link brings in on a text or number field, so nothing narrows unseen, and inside the phone's "Edit filters" page.

## Pick by job

| Job | Use |
| --- | --- |
| Choose one of a few kinds, with counts | The radio chips of `ListFilters` (see its card): "All" first, an icon each, "+N" past six |
| Show a link's clause on a text or number field | `FilterChips` (clauses), drawn by `ListFilters` with its ×. Removable, never offered |
| Build or change a clause | The phone's "Edit filters" page: `FilterControls` stacked. A desk has no Filters sheet |
| Drop one clause | The × on its chip |
| Drop every clause | "Clear" in `ListFilters`' bar |
| Narrow from a phone | The dock's ⚙, which opens `ListOptionsSheet`: one page with every choice on view (see `ListFilters`) |

A status is a `SubTabs` tab with counts, never a row of status chips (see `ListFilters`).

## A chip

| Part | Drawn as |
| --- | --- |
| Chip | 32px high, fully round, `soft-2`, no border, 15px (the source draws a `canvas` chip with a 1px `hairline-2` border; white.css repaints it). As wide as its sentence, never wider than its container: the value truncates and the × stays |
| Column | 500 in `ink`, 10px sides, 160px at most, the whole name as its title |
| Operator | A `soft` segment between two `hairline` rules, 8px sides, its symbol in `body`. It opens the operator menu |
| Value | 500 in `accent` once it says something, "…" in `mute` before. 10px sides, truncated with the whole value as its title. It opens the value editor. Not drawn when the operator takes no value ("is empty") |
| × | A `line-ico` glyph of 14px, 8px sides, a `hairline` rule at its left, `soft-2` under the pointer. Named "Remove the Status filter" |

| The values say | Reads |
| --- | --- |
| None yet | "…" |
| One | Its label: a store id as the store's name, a status code as a sentence |
| Several | "2 selected" |
| A range | From – To |

## The editors

- **Operator menu.** A popover of 240px at least, radius 10px, `shadow-pop`, 5px of padding. Operators are grouped by family under a 15px label at 600 in `mute`: Comparison, Pattern matching, In lists, Range, Emptiness. A field that offers one family gets no heading. Each row has a tick (held at 0 opacity so rows do not shift), the operator in words, and its symbol as a keycap. The common one comes first and its negation second; Emptiness is always last.
- **Value list.** Rows of a 16px box (a round one when the operator takes one value), the label and its count in `mute`. A search box past 8 values, or when the field says `searchable`. The rows scroll in their own 272px box, so the search stays put. "Nothing matches." when it finds none.
- **Typed value.** One box, or two (From, To), 32px high; text, number or date. Read 250ms after the last key, so holding Backspace is one navigation. A range runs only when both bounds are there.
- **Building a clause.** Picking a column draws a draft chip with its editor already open. The clause reaches the address in one navigation, when the editor closes with everything it needs. "is empty" has nothing to type, so it is finished the moment it is chosen. Changing the operator keeps the values that still mean something.

| Family | Operators (symbol) |
| --- | --- |
| Comparison | is (=), is not (<>), is greater than (>), is at least (>=), is less than (<), is at most (<=) |
| Pattern matching | contains (~~*), does not contain (!~~*), starts with (~~) |
| In lists | is any of (in), is none of (not in), include any of (&&), include all of (@>), exclude (!&&) |
| Range | is between ([ ]), is not between (![ ]), is before (<), is after (>), is on or before (<=), is on or after (>=) |
| Emptiness | is empty (is null), is not empty (not null) |

## The phone's list-options sheet

The dock's filter icon opens one bottom sheet (`ListOptionsSheet`) that changes its page in place rather than stacking a second sheet; ← goes back, and from the page the dock opened it at, ← shuts it.

| Page | Title | Holds |
| --- | --- | --- |
| Menu | Show | The whole standard on one page, in the desk's order: long fields as pills of the most-held answers plus "All N", dates as a row opening the calendar, the chip field as wrapping chips, switches, Clear; then "Sort by" with the order in force; then the list's own acts (Export) as `accent` rows under a rule |
| Filter | Filter | The same filters page as Menu, without "Sort by" |
| A field | The field's name | Its values, a tap to narrow and a tap to let go; a search capsule past 8 |
| A day window | The field's name | A calendar |
| Edit filters | Edit filters | `FilterControls`, stacked and 44px, for what a row cannot say (an operator, a price band) |
| Sort | Sort by | The orders; the one in force is `accent` at 500 with an arrow, and turns over on a second tap. "Default order" comes first |

- Rows are 48px, radius 8px, 12px sides, 15px in `ink`; a press tints them `soft-2` and gives `scale(0.985)` over 100ms.
- The head is the drawer's: grip, a 16px title at 600, ← at 44px, and "Clear" in `accent` at 500 while there is something to clear on that page.
- There are no saved views (owner, 6 Oct 2026).

## Rules

- A clause is a sentence, and the operator is visible and editable: "is any of" and "is none of" are one chip with one word changed.
- A clause in force is always visible: a pill, a lit chip, a window in a date box, or a clause chip. Nothing narrows unseen.
- Clauses AND, two on one column too ("Delivery date after 01 Oct 2026" and "before 31 Oct 2026").
- A figure sits beside every value: the server's own count where the screen narrows at the server, or the table's faceted rows, which respect the other chips.
- Values are text held in the address, so a filtered list travels in a link. A server-backed field takes one clause and offers only the operators its request can carry.
- Operators, their words and their symbols come from `lib/filters`; no screen writes its own.

## Retired

- **`DeskFilterChips` and `DeskFilterButton`.** `DeskFilterChips` renders nothing and `DeskFilterButton` renders `ListFilters`; remove the calls (6 files each: `sales/returns.tsx`, `sales/customer.tsx`, `commercial/vouchers.tsx`, `campaigns.tsx`, `changes.tsx`, `promotions.tsx`). A row of chips as a status filter goes with them.
- **The Filter button and the Filters sheet.** Clause chips after a button are gone from the desk (owner, 20 Oct 2026). `ListFilters` is the list's filter.
- **`DockedFilters` as a column.** The white look never draws it (owner, 12 Oct 2026: filters are never drawn at the right); `usePanelDock()` is false, and only its KPI strip draws, in `workplace/library.tsx`, `procurement/sourcing.tsx`, `inventory/movements.tsx` and `inventory/pools.tsx`. "Edit filters", "Fields", `SavedViews` and `QuickFilters` stand inside it and are never reached. The figures belong to `KpiStrip`.
- **`SavedViews`, `QuickFilters`, `ViewPicker`.** No screen draws them and the white look cannot reach them; do not start. The one saved view in the hub is the Sales Explorer's own "Saved" pane (`sales/explorer-controls.tsx`), kept in the browser.
- **`FacetGroup`, `FacetItem`, `FacetChip`.** No screen draws them since Sourcing and Articles moved to the omnibox, and a chosen `FacetChip` is a solid `ink` fill with white words. Keep `facetMatches`, which the omnibox reads.
- **The keycap in mono at radius 5px.** The operator menu is portalled outside `.shell-page`, and white.css's mono override reaches neither a `kbd` nor anything outside the page and its sheets. Use the sans face and `r-chip` (6px). The palette's `tab` key is the same part.
- **Database symbols on the chip.** `~~*`, `!~~*`, `~~`, `&&`, `@>`, `!&&` and `is null` are not words a buyer reads. The menu says each in words; so should the chip's middle segment.
- **A range read raw.** `summarise` formats one value through `format` but writes a range from its raw values (`2026-10-01 – 2026-10-31`). Dates carry their year as `dateRange` writes them: `01–31 Oct 2026`.
- **`FilterOmnibox`.** Retired as a filter: the one search box of `ListFilters` offers the names. Sourcing, Articles and Pricelist move to it.
- **Pills for words.** `ClearFilters` is a 32px round pill in `mute`, and the add button is a dashed one. A button is 36px with `r-inner` corners, as `FilterPanel` says.
- **The sentences.** "Nothing is narrowing this list. Pick a column…" under an empty sheet, and "In whole Rupiah, not cents." under a range.

## What you provide

| Component | Prop | Type | Notes |
| --- | --- | --- | --- |
| `FilterChips` | `model` | `FilterState` | `filters`, `fields`, `update(i, next)`, `remove(i)`, `commit`, `clear`. A table screen passes `useFilters(columns)`; a server-narrowed one `useFilterState(fields)` |
| | `table` | the table | Read for facet counts. Leave it out when fields carry `counted` |
| `FilterControls` | `model`, `table` | | The chips, the add button and Clear |
| | `stacked`, `touch`, `withClear` | `boolean` | Down a column; 44px; Clear at its end (default on; the sheet pins it to its foot instead) |
| `ClearFilters` | `model`, `touch`, `label` | | Default label "Clear" |
| `FilterChip` | `field`, `filter`, `onChange`, `onRemove`, `children` | | The shell of one chip; `children` is its value segment |
| `OperatorMenu`, `OptionRow` | | | The menu and a value row, shared by the bar and the omnibox |
| `FilterOmnibox` | `model`, `text`, `onText`, `className` | | One box. A prefix pill names the clause being edited; free text is a "Search for …" row; Enter takes the highlighted row; a committed chip's value hands its clause back to the box |
| `ListOptionsSheet` | `model`, `filterModel`, `table` | | `filterModel` carries the server's counts |
| | `sorting`, `onSort`, `orders`, `sortChoices` | | The sort page: table columns, a named order, or the dock's choices |
| | `openAt`, `onOpenAtChange`, `hideTrigger`, `actions` | | Opened from the dock at `"menu"`, `"filter"` or `"sort"`; `actions` are `{ label, onClick }` rows |
| `SheetSortRows` | `choices`, `withDefault`, `rowClass`, `onDone` | | |

Source: `frontend-hub/src/components/ui/filter-bar.tsx`, `filter-chip.tsx`, `filter-omnibox.tsx`, `facets.tsx`, `list-chrome.tsx`, `desk-filter.tsx`, with `lib/filters.ts` and `lib/filter-chrome.ts`; white look in `styles/white.css` (the chip around a filter's word, filters at the left of a toolbar).
