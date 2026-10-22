# ListFilters

ListFilters is how every list in Central is narrowed: everything the list can be asked is on view in its bar, in one order, with no Filter button and no panel, the way Purchase Orders has always worn it (owner, 20 Oct 2026: "standarisasi filter yg ada di frontend hub menyesuaikan po list").

## Where a filter goes

| The choice | Put it in | Not in |
| --- | --- | --- |
| Switches the dataset (Active PO, Completed PO, Cancelled PO), and the status | `SubTabs`, with counts | A filter, a `Segmented`, a row of chips |
| Finds a record, or a name from a long list (supplier, store, person) | The one search box, which also offers the names | A dropdown or `Select` |
| A window of days | A `DayRange` box labelled with the date's own name | Two boxes, a sheet |
| A short list of kinds (type, stage, category) | The line of icon radio chips under the bar | A dropdown, a `Segmented` |
| A yes/no on what the list holds | A `SwitchPill` | A chip |
| A text or a figure | Not offered: the search reads text, and a figure is a column you sort | A clause chip you build |

## Anatomy on a desk

The bar reads left to right, then one line under it:

| Part | Drawn as |
| --- | --- |
| Status | `SubTabs` above the bar, with counts. Not part of ListFilters. |
| Search | One box (`SearchSuggest`). It narrows the list as it is typed and also offers names. Typing a name shows it as a pill beside the box: `accent-bg`, a 1px `accent` border at 40%, the name in 500 `accent` and a ×. |
| Which names it offers | Every option field with more than six answers or marked `searchable`, and every short field after the first. |
| Dates | One `DayRange` box per date field, 176px, labelled with the field's name ("Delivery date"). |
| Switches | One `SwitchPill` per boolean field. |
| Clear | A ghost `accent` word with a ×, only while a clause is in force. Sits after the switches. |
| Right of the bar | `BarSpacer`, then Columns, Export and Rows. They belong to the Toolbar, not to ListFilters. |
| Chip line | Under the bar, on a line of its own: icon radio chips (`FilterChips`, radio) for the first short option field. |

The chip line:
- Only a field with six answers or fewer, and at least two of them held by rows. A question with one answer asks nothing.
- "All" comes first, with the whole count. Then the answers, biggest first, each with its icon and its count.
- An answer no row holds is left out. The one chosen always stays in view.
- More than six: the rest fold into "+N", a round 36px button that opens a list of them with their counts.
- The icon is the field's `FilterSpec.icon`: a function from the answer to a glyph, `null` for "All" (default: the grid glyph). A car for vehicles, a printer for supplies.
- There is one chip line, never two. A second short field is offered by the search box like a long one.

A clause a link carries on a text or number field still shows, as a removable clause chip (`FilterChips` from `filter-bar`), so nothing narrows unseen. It is shown, never offered.

## On a phone

The dock's ⚙ opens `ListOptionsSheet`, which draws `ListFilters sheet` as ONE page with every choice on view, in the desk order, then "Sort by" under it. Status stays the dock's own button.

| Part | Drawn as |
| --- | --- |
| Long field | A labelled section: the answers chosen (`accent-bg` pill with a ring and ×), the four most-held answers as `soft-2` pills (44px, round), and "All N" opening the field's own page. |
| Date | A labelled section holding one 44px row, a calendar glyph and the window in words ("Any day", "20 Oct – 30 Oct"); `accent` while set. It opens the calendar page (`DayRangePage`). |
| Chip field | A labelled section: the same chip line, wrapping, every answer shown, no "+N". |
| Switches | `SwitchPill`s, wrapping. |
| Clear | At the end. |

Without `openField` or `openDate` (a docked toolbar's sheet) the long fields are offered by the search box and the dates by their own full-width boxes.

## Sizes

| Part | Size |
| --- | --- |
| Search, date box, switch pill, Clear, name pill | 34–36px (`control`); 44px under a finger |
| Radio chip | 36px, fully round, 15px at 500 |
| Phone pill, date row | 44px |

## Rules

- Declare the question on the field (`FilterSpec`: `kind`, `options` or `counted`, `searchable`, `single`, `icon`); the component decides where it goes. A screen never places a filter itself.
- Wire it one of two ways: a table screen passes `useFilters(columns)` and its `table`; a screen narrowed at the server passes `useFilterState(fields)` and no table, with `counted` options.
- A screen with its own search text hands it over as `search` and drops its own box, so one box both searches and offers names.
- Filters live in the address (`?filters=`), so a filtered list travels in a link. Never `useState`.
- No Filter button, no filter sheet on a desk, no right rail at 96rem, no dropdown or `Select` as a filter. Owner: 14 Oct 2026 "filter … buttonnya hapus"; 12 Oct 2026 "jangan filter kanan"; 18 Oct 2026 "filter dropdown jangan pake … pakai radio icon".
- The one allowed picker is a searchable one for a long list that is not a column, such as finance `UnitSelect` for units and sites.
- No helper sentences. The words are the field's name and the answers.

## Retired

See [Retired](../06-retired.md): the Filter button and sheet, the right rail, the `DeskFilterChips` row, `FilterOmnibox`, dropdowns and `Segmented` as filters, filters held in `useState`.

## What you provide

| Prop | Notes |
| --- | --- |
| `model` | `FilterState` from `useFilters` or `useFilterState`. Draws nothing when it has no fields and no `search`. |
| `table` | The table, read for facet counts only. Leave it out when the server counts. |
| `search` | `value`, `onChange`, `label`: the screen's own search text. |
| `sheet` | Stacked, for the phone's sheet. Also true on its own on a phone layout. |
| `openField`, `openDate` | In the sheet: open a field's page of every answer, or a date's calendar page. |
| `className` | Layout only. The desk form is `contents`, so its pieces sit in the screen's own bar. |

`FilterPanel` and `DeskFilterButton` keep their names and now just render ListFilters; `DeskFilterChips` renders nothing.

Source: `frontend-hub/src/components/ui/list-filters.tsx`, with `filter-panel.tsx`, `desk-filter.tsx`, `filter-chips.tsx` (the radio chips), `day-range.tsx`, `list-chrome.tsx` (`ListOptionsSheet`, `SearchSuggest`) and `lib/filters.ts` (`FilterSpec`). Prototype: `filter-standard-options.html` at the repo root.
