# Dock

The Dock is the phone's bottom: a floating card of the list's own controls (its status, search, filter and sort, and the one thing it makes) standing over the tab bar, so every action is under the thumb and nothing is at the top.

## The rule

Every action at the bottom, nothing at the top. A phone list opens on its title and its figures and then the cards. Search, filter, sort, status and New are the dock's, and a record's verbs are its sheet's foot. A screen does not mount the dock: it renders `DockTools`, `Fab` or `DockSelection`, and they draw into the dock's slots through a portal. The row shows while one of them is mounted, so a screen with none has no empty strip.

## What goes in it

| Control | Component | Drawn as |
| --- | --- | --- |
| Status | `DockTools status` | A chip: 44px, round, `soft-2`, the word at 500 and a 16px chevron in `line-ico` ("Active ▾"). It opens a sheet of the statuses, each with its count. A status is a place, not a filter: Active, Completed and Cancelled are three lists. |
| Search | `DockTools search` | A capsule: 44px, round, `soft-2`, a glyph and what is searched in `mute` ("Search Orders"). While a search narrows the list it turns `accent-bg` and says the search in 500 `ink`, with a × to widen the list. It opens the search sheet over a live list, above the keyboard. |
| Filter and sort | The ⚙ in the capsule | 36px inside the capsule, with a 44px target; `accent-bg` and `accent` while a filter is on. It opens `ListOptionsSheet` at one page: every filter on view in the desk's order (see `ListFilters`), then "Sort by". Status stays the dock's own button. |
| New | `Fab` | A round 44px `cta` with a 20px plus beside a status chip. With no status chip it is a 44px bar with its word that takes the free width. A press gives `scale(0.96)`. |
| Reload | `DataTable refresh` | A round 44px button on `soft-2` with a 16px arrow in `body`, first in the action slot, on a list that stays live. The arrow turns while a read somebody asked for is on; the quiet reads every 10s do not move it. |
| Rows ticked | `DockSelection` | "× 3 selected" in an `accent-bg` capsule and one wide primary ("New allotment"). Status, search and filter step aside. |
| A choice with no search beside it | `DockChoice` | The same chip and sheet, for what in-page tabs would have been on a phone (a unit, a day). |

## The card

- It floats 8px in from the sides and 8px above the tab bar: radius 28px, a 1px border at 6% black, `canvas` at 95% over a blur, `shadow-float`.
- Inside it: 8px of padding, 6px between controls, every control at least 44px (`tap`).
- Its height follows its contents over 300ms on `ease-drawer`.
- Three slots, left to right: status, search, action.

## The tab bar

- Under the dock: `canvas` at 80% over a blur, a hairline at 6% black on top, the home bar's safe area under it.
- Inside a department it is Home, then the department's screens. Four screens fit beside Home; with more it keeps three and a More that opens the full list. On the launcher it is one Home tab.
- A tab is 52px tall: a 22px icon over a 15px word at 500. The current one is `accent`, with a 3px × 40px bar at its top edge, a wash that fades from `accent` at 15%, and a filled icon. The others are `mute`.
- No motion on a tab change; a press gives the icon `scale(0.9)`.
- Something waiting is a 10px `accent` dot at the icon's corner, ringed in `canvas`. Never a count.
- While a text field has the keyboard the bar steps aside and fades.

## Sizes

| Part | Size |
| --- | --- |
| Dock card | radius 28px, 8px padding, 6px between controls |
| Chip, capsule, Fab, selection | 44px (`tap`), fully round |
| Icon inside the capsule | 36px, 44px target |
| Tab bar | 52px, plus the safe area |
| A sheet's rows | 48px |

## Rules

- Every action at the bottom: the dock, the Fab, the sheet foot. Nothing at the top of a phone list but the title and the figures.
- The dock is the shortcut and the sheet is the place: status, search, filter, sort and the calendar all open the same bottom sheet.
- A screen offers on a phone what it offers on a desk, in the same order and with the same words.
- The Fab's word is a button's: sentence case, "New order". Its spoken name is "Add New Order".
- From 48rem up the dock and the Fab are not drawn: the Toolbar and the page head carry the same controls.
- Tabs on a phone are the status chip. Nothing scrolls sideways.

## Retired

- A search box, a filter or sort row, tabs, or a round plus at the top of a phone list or floating over its last row.
- The sort line `DataTable` draws above its cards when `cardSort` is left on: sort is the dock's.
- The pill written by hand: the status chip is copied in `DockTools` and `DockChoice`, the "Filters" chip in `Toolbar` and the settings chip in `DockSettings`. They are one dock-size button.
- Title Case on the Fab ("New Order"): a button is sentence case.

## What you provide

| Component | Prop | Notes |
| --- | --- | --- |
| `DockTools` | `search` | `value`, `onChange`, `label` ("Search Orders"). |
| | `filter` | `count`, and either `panel` (the kit's list-options sheet, drawing `ListFilters`) or `onOpen` (the screen's own). |
| | `sort` | `label`, and either `choices` (the kit's sort sheet, from `dockSortOf(table)`) or `onOpen`. |
| | `status` | `value`, `options` (`value`, `label`, `count`), `onChange`. |
| | `actions` | Rows at the foot of the filter sheet that act on the list as a whole: Export, Sync. |
| `Fab` | `label`, `onClick` | `icon` for an act on what is there ("Mark all read"); a plus for something new. |
| `DockSelection` | `summary`, `onClear`, `action` | `action` is `label` and `onClick`. |
| `DockChoice` | `value`, `options`, `onChange`, `title` | `title` names what is chosen ("Unit", "Day"). |
| `DockPortal` | `slot` | `"search"`, `"tabs"` or `"action"`; draws its children there on a phone only. |

Source: `frontend-hub/src/components/shell/dock.tsx`, `dock-tools.tsx`, `dock-selection.tsx`, `components/ui/fab.tsx`, `components/shell/bottom-bar.tsx`.
