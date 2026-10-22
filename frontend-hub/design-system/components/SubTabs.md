# SubTabs

SubTabs switch the dataset of one page with words on a hairline, the chosen word in `ink` over a 2px rule that slides to it: use them for pages only, never inside a record and never as a status filter.

## Anatomy

- Words: 15px at 500, `mute` at rest, `ink` when chosen or under the pointer. 20px apart (`tab-gap`), padding 8px 0 11px, 40px high at least, no padding at the sides.
- The row stands on a 1px `hairline` that runs its whole width. 16px (`tabs-to-bar`) below it to the bar; 32px above it from the figures.
- The chosen tab: an `ink` word and a 2px `ink` rule. One rule slides from tab to tab: only its `clip-path` moves, over `t-panel` (200ms) on `ease-in-out`, and with reduced motion it jumps.
- A count after the word: 6px away, `mute` at 400 ("Active PO 18").
- An `alert` after the word: the red count of `CountBadge`, for what waits for somebody ("In progress" with 3).
- The row is one tab stop and the arrow keys move along it.

## Pick by what the choice does

| The choice | Use |
| --- | --- |
| It switches the dataset the page shows: Active PO, Completed PO, Cancelled PO | `SubTabs` |
| It narrows the rows of one dataset: a supplier, a division, a kind | `ListFilters`: the search box for long lists, the radio chip line for short ones |
| Its status, with counts | `SubTabs` (the status is the tab row) |

## On other widths

- A phone gets no strip that scrolls sideways. The tabs become one chip in the dock, 44px high, `soft-2`, the chosen word at 15px and 500 with a chevron; it opens a bottom sheet of 48px rows, the chosen one in `accent` at 500 with a check. Pass `className="max-md:hidden"` only where the screen draws its own status in the dock.
- On a screen that is a door's tab the door already draws the one row of tabs, so the screen's own become a 224px choice ("Show") at the start of its toolbar.
- A list with one tab is not drawn.

## Rules

- Tabs are for pages only: each tab is a different dataset.
- A word, then its count as a separate `mute` figure. The tab's value belongs in the URL's search params wherever a colleague might be sent a link.
- Nothing else sits in the tab row. The figures stand over it and the bar under it.

## Retired

- `Segmented` as a status filter in the bar: `procurement/catalogue.tsx:448`, `procurement/outstanding.tsx:338`, `contracts/contracts.tsx:248`, `people/reprimands.tsx:111`, `people/changes.tsx:208`, `assets/assets.tsx:242`, `inventory/availability.tsx:407` and five more. Use SubTabs when the choice switches the dataset, and the `ListFilters` chip line otherwise.
- The `DeskFilterChips` rows in Commercial and Sales as status filters.
- A row of figure buttons that scrolls sideways: `finance/stores.tsx:173`.
- A count typed into the label ("To be returned 3" in `procurement/supplier-returns.tsx` and `operations/board/suppliers.tsx`): it draws in the word's own colour and weight. Pass the count as its own `mute` element, as the PO list does.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `tabs` | `readonly SubTab[]` | `{ value, label, short?, icon?, alert? }`. `label` is a node; `short` is the phone's plain word; `icon` replaces the word in the phone's row; `alert` is the red count |
| `value` | `string` | The chosen tab's `value` |
| `onChange` | `(value: string) => void` | Called on a click or a key |
| `className` | `string` | `max-md:hidden` where the dock holds the status |
| `dock` | `boolean` | On a phone: `true` draws a track of tabs in the dock's row, `false` keeps the strip at the top |

Source: `frontend-hub/src/components/ui/sub-tabs.tsx`; white look in `styles/white.css` (tabs: words with a short ink rule under the chosen one), the dock chip in `components/shell/dock-tools.tsx` (`DockChoice`).
