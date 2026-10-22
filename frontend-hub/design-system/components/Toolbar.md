# Toolbar

The Toolbar is the one row between a page's tabs and its table: search at the left, the list's filters next (dates and switches), then the space, then the controls that shape the table, every control 36px tall and 8px apart.

## The order, left to right

| Slot | Control | Drawn as |
| --- | --- | --- |
| Search | `ExpandingSearch` | 280 × 36 at most, radius 8, a `hairline-2` border, a 14px glyph at 10px and the placeholder in `line-ico`. The label is the placeholder: "Search orders". |
| Filters | `ListFilters` | No Filter button. The search box also offers the names of long lists; Clear stands after the dates and switches. See its card. |
| Dates, switches | `DayRange`, `SwitchPill` | Drawn by `ListFilters` from the list's fields. A date is a 36px ghost box, 12px padding, a calendar glyph at its right. A switch is a 30 × 18 track and its words in a bordered box. |
| The space | `BarSpacer` | Pushes what follows to the right. |
| View controls | `ColumnsMenu`, `ExportCsv` | Columns and Export CSV are ghosts with 12px padding. (`ExportCsv` still draws itself quiet, with no border and a `body` word; that is retired: every supporting action is a ghost.) |

- The order holds whatever the code order: search, dates, switches, Clear. Under the bar, `ListFilters` adds one line of icon radio chips.
- The page's one primary action is not in the bar. It stands at the right of the page head.
- The bar sits 16px under the tabs' hairline and 12px over the table (`tabs-to-bar`, `bar-to-table`).

## States

- **Search at rest:** `hairline-2` border, `canvas` ground.
- **Search with focus:** an `accent` border and `shadow-focus`. The box grows into the free space over 300ms (200ms back, `ease-in-out`, a jump under reduced motion) while `BarSpacer` gives that space up. The controls after it stay in order.
- **Columns:** `soft-2` on hover and while its menu is open. The menu is a 208px popover, radius 10, `shadow-pop`: a "Columns" heading at 600 in `mute`, then 32px rows with an `accent` tick for each column that shows.
- **Export CSV:** says "Exporting…" at 60% while the file is made. A failure is a toast, not a banner.
- **Switch on:** the track is `accent`. A switch narrows by a yes/no ("Active order", "Invoiced only").

## Sizes

| Part | Size |
| --- | --- |
| Every control | 36px (`control`). Under a finger the search grows to 44px: the pointer decides, not the width. |
| Search | 280px wide at most (`search`); it narrows before a button drops to a second line |
| Gap between controls | 8px (`bar-gap`) |
| Bar to table | 12px (`bar-to-table`) |

The Toolbar's own classes still draw 7px and 14px (`gap-[0.4375rem]`, `mb-3.5`). The measured PO list bar is 8px and 12px; the tokens are the standard.

## On a phone

Nothing draws at the top. Search, filter and sort are the dock's (`DockTools`); the dock's ⚙ opens one sheet with every filter on view (see `ListFilters`). A Toolbar without a dock of its own turns itself into one "Filters" chip in the dock and a bottom sheet holding its controls. A bar that is not a filter passes `inline` and stays in the page. A Toolbar inside a sheet or a dialog is left alone.

## Rules

- Every list has one `Toolbar`, and it is the only way to build the bar.
- Search first, then dates or switches (`ListFilters`), then Clear, then `BarSpacer`, then view controls. Nothing to the right of the view controls.
- Give the Toolbar `className="group/bar"`: the search reads it to know when to grow.
- A status is never a row of chips or a segmented control in the bar. It is a `SubTabs` tab with counts. Any other short question is the radio chip line `ListFilters` draws under the bar.
- Write switch words in sentence case ("Group by supplier").
- One bar per list.

## Retired

- A bar built by hand: `Toolbar` is in 86 files, a hand-written `group/bar` div in about 50 (with six spacings), `DESK_BAR` in 8. Even `procurement/purchase-orders.tsx:1454` writes its own. Use `Toolbar`.
- A search made by hand (about 20 inputs) or `SearchSuggest` (3). Use `ExpandingSearch`.
- `Segmented` as a status filter in the bar (12 lists, among them `procurement/catalogue.tsx:448`, `contracts/contracts.tsx:248`, `assets/assets.tsx:242`) and the `DeskFilterChips` rows in Commercial and Sales. Use `SubTabs` or the `ListFilters` chip line.
- `Toolbar.Spacer` (53 files): it keeps its room while the search grows, so the search gets half. Use `BarSpacer` beside `ExpandingSearch`.
- `ViewPicker` and `QuickFilters`: no screen draws them. Do not start.
- `ChoiceMenu` with the filter mark as a filter in the bar (`assets/assets.tsx:378`, `locations/locations.tsx:172`). A narrowing is a `ListFilters` question; `ChoiceMenu` is the order of a list that is not a table.
- `SwitchPill` draws 34px high, two short of the bar, and sets its words `capitalize` ("Group By Supplier"). The system's switch is 36px and in sentence case.

## What you provide

| Component | Prop | Notes |
| --- | --- | --- |
| `Toolbar` | `className` | Pass `group/bar`. |
| | `lead` | The screen's own `SubTabs`, first in the row. Only inside a door. |
| | `inline` | Stay in the page on a phone. |
| `ExpandingSearch` | `value`, `onChange`, `label` | `label` names the box and is its placeholder. |
| | `placeholder` | Only when the placeholder should differ from the label. |
| `BarSpacer` | none | Hidden under 64rem. |
| `ColumnsMenu` | `table`, `label`, `extra` | Lists the table's hideable columns that have a text heading. `label` is "Columns", or "View" where `extra` carries other view switches. |
| `ExportCsv` | `title`, `columns`, `rows` | `rows` is a function, run once on the press: the file is all the filters match, not the page on screen. |
| `SortMenu` | `table`, `sorting`, `onSort`, `compact` | The order said in words; the headings still sort. `compact` leaves the arrow alone on a phone. |
| `ChoiceMenu` | `heading`, `value`, `options`, `onChange`, `icon` | The same quiet trigger for the order of a list that is not a table (Sourcing: best match, newest, price). `value` is `null` for the first option. |

Source: `frontend-hub/src/components/ui/segmented.tsx` (`Toolbar`, `ToolbarLead`), `components/ui/list-chrome.tsx` (`ExpandingSearch`, `BarSpacer`, `ColumnsMenu`, `ExportCsv`, `SortMenu`, `ChoiceMenu`, `ViewPicker`); white look in `styles/white.css` (Filters at the left of every toolbar, the search box).
