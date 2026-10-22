# Segmented

A segmented control chooses how to look at one dataset, "By article" or "By store", "Day", "Week" or "Month"; it is never a status filter.

## Pick by what the choice changes

| The choice changes | Use | Example |
| --- | --- | --- |
| How the same rows are cut or drawn | `Segmented` | By article · By store; Day · Week · Month; Board · Table; % · Rp |
| Which dataset the page lists | `SubTabs` | Active PO · Completed PO · Cancelled PO |
| Which rows pass, by status or any other field | `ListFilters` (search box, radio chip line) in the bar | Active, Closed, Cancelled |
| A yes/no | `SwitchPill` | Group by supplier |
| An action | `Button` | Print, Export CSV |
| Fused actions, or a fixed window of days | `ButtonGroup` | 7 · 14 · 30 · 90 |

The test: if the numbers in the figures above the list would change with the choice, it switches the dataset and is a tab. If only the cut or the drawing changes, it is a segment.

## Anatomy

- **Track**: `segment-track` (#f2f2f4), padding 3px, radius 9px, 2px between items, no border.
- **Item**: 15px at 500 in `body`, padding 0 10px, 28px high, radius 6px. An icon, if any, is 16px and sits 6px before the word. The word's colour is `ink` while it is chosen or under the pointer.
- **Chosen**: a white ground, 30px high, radius 7px, `shadow-segment`, standing 1px past the item above and below, so the track is 34px tall. One piece slides to the next choice over `t-panel` (200ms) on `ease-in-out`, by transform for the travel and width for the size; the first place is set without a transition and reduced motion jumps.
- **Always one on.** Pressing the chosen item does nothing. Arrow keys move along the row, which is a single tab stop; each item says `aria-pressed`.
- **ButtonGroup**: the same track with 30px items of radius 7px, so the track is 36px (`control`). It has no sliding ground: its buttons are plain buttons.

## On a phone

Nothing scrolls sideways. A control too wide for the screen wraps onto a second row, and the sliding ground is not drawn: each chosen item wears its own white ground. Under a finger an item grows to 40px, so with its rim it is a 44px target.

## Rules

- A few items, each a word or two in sentence case: "By article", "By store", "This month".
- A segment never filters by status. A status is a `SubTabs` tab; any other narrowing is `ListFilters`.
- One item is always on, and the first is the default. The one exception today is the Sales explorer's period presets, which turn all off while a picked date range is in force.
- In the bar it stands with the view controls, after the search.
- Use the label the user reads, never the raw value: "Day", not "day".

## Retired

- **A status filter in the bar.** 12 lists use `Segmented` that way: `procurement/catalogue.tsx:448`, `procurement/outstanding.tsx:338`, `contracts/contracts.tsx:248`, `people/reprimands.tsx:111`, `people/changes.tsx:208`, `assets/assets.tsx:242`, `inventory/availability.tsx:407` and five more. Use `SubTabs` when the choice switches the dataset, and a `FilterPanel` facet otherwise.
- **`DeskFilterChips` rows** in Commercial and Sales as a status filter.
- **Raw values as labels.** `sales/sales.tsx` draws the buckets as "day", "week", "month". Write "Day", "Week", "Month".
- **A track 2px short.** The item buttons are 28px, so a `Segmented` is 34px tall beside 36px controls; its `ButtonGroup` sibling is 36px. Draw the items at 30px so both are `control`.
- **`ButtonGroup` as a selection.** The doc says its buttons are actions and never "on", yet `sales/analytics.tsx` fuses 7 · 14 · 30 · 90 and marks one chosen by hand. A choice that stays chosen is a `Segmented`.

## What you provide

| Part | Props | Notes |
| --- | --- | --- |
| `Segmented` | `options`, `value`, `onChange`, `className?` | `options` is `{ value, label }[]`; `label` may hold an icon and a word. |
| `ButtonGroup` | the `div` props | Its children are `<button>`s; it adds the track. |

Source: `frontend-hub/src/components/ui/segmented.tsx`; look in `styles/white.css` (`.segmented`, `.button-group`).
