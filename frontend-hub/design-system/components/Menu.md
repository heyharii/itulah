# Menu

A menu is a short list of acts or choices that opens under a button and closes once one is taken: one panel (radius 10px, `shadow-pop`) and one 36px row, both from `POPUP` and `ITEM` in `lib/filter-chrome.ts`.

## Pick by the job

| The job | Use | Drawn as |
| --- | --- | --- |
| A few verbs on a record or a server ("Restart server", "Sync now") | A menu on a ghost "Actions ▾" | Rows with no tick; a refused row shows its reason under the word |
| Which columns show | `ColumnsMenu` | Ticks that toggle; the menu stays open |
| How a list is ordered | `SortMenu`, `ChoiceMenu` | One tick (or an arrow) at the left of the chosen row |
| What a filter clause asks | `OperatorMenu` | A heading per family, the chosen row ticked |
| What a sheet's foot has no room for (Download PDF, Duplicate) | The head's ⋯ (`more`) | A glyph and a word per row |
| A field's value out of a vocabulary | `Pick` | See the Pick card |
| Two or three words that switch a view | `Segmented` | See the Segmented card |

## Anatomy

- **Trigger**: a ghost button, 36px (`control`), 12px padding, the word and a 14px glyph ("Columns", "Actions ▾"). It stays `soft-2` while its menu is open. A row's ⋯ is a quiet 36px icon button.
- **Panel** (`POPUP`): `canvas`, 1px `hairline`, radius 10px (`r-card`), `shadow-pop`, padding 5px. At least 192px wide and as wide as its longest row; 352px high at most, then it scrolls. It opens 4px under its trigger, on the trigger's right edge when the trigger stands at the right of a bar (`align="end"`) and on its left edge anywhere else.
- **Heading**: names the choice ("Columns", "Sort by") at 15px/600 in `mute`, sentence case, 8px a side. A later group's heading has 8px above it. A heading over a single group is not drawn.
- **Row** (`ITEM`): 36px, 8px a side, radius 8px (`r-inner`), 8px between parts, 15px in `ink`. The row under the pointer or the arrow keys is `soft-2`. A glyph before the word is 14px in `ink`.
- **Tick**: a 14px slot at the left holds a 14px tick in `accent` on the chosen row. The other rows keep the empty slot, so the words line up. Sort puts an arrow in the slot (up is low to high).
- **Key**: the operator menu ends each row with the operator in a 5px-radius box, 1px `hairline-2`, 15px in `body`.
- **Refused**: the row stays, at 60%, with the reason under it in `mute`: "The server has not reported in yet." A disabled glyph row is 50%.
- **Takes something away**: its word is `bad-fg` ("Delete"). Never a fill.
- **Closing**: a row that acts or chooses closes the menu. A row that toggles (`closeOnClick={false}`: columns, sort, paper) keeps it open.
- **Motion**: the panel scales from 0.95 and fades over `t-pop` (160ms) on `ease-out`, from the point nearest its trigger (`--transform-origin`), and leaves the same way. Reduced motion keeps the fade. Arrow keys move the highlight, Enter takes, Esc closes.

## On a phone

A list's view controls are not menus there: search, filter and sort are the dock's sheet, and a pick is `PickerSheet`. A menu that stays (the sheet's ⋯) grows its rows to 44px (`tap`) and its trigger to 44px.

## Sizes

| Part | Size |
| --- | --- |
| Trigger | 36px; 44px under a finger |
| Row | 36px; 44px under a finger in ⋯ |
| Panel padding | 5px |
| Panel width | 192px at least |
| Trigger to panel | 4px |

## Rules

- Draw every menu from `POPUP`, `POSITIONER` and `ITEM`. Put `POSITIONER` (z-index) on the positioner, or a menu opened inside a sheet is painted under it.
- A row says what it does, verb first, sentence case. An icon never stands alone in a row.
- Chosen is a tick in `accent`. Nothing in a menu is a blue or red fill.
- A refused option stays in the list with its reason. Do not hide it.
- A sheet's own verbs live in its foot, Print first of them. The ⋯ is for what the foot has no room for.

## Retired

- **Copies of the panel.** `ColumnsMenu`, `SortMenu`, `ChoiceMenu`, `ViewPicker` and the facet menu in `list-chrome.tsx`, `HeadingSortMenu` (`data-table.tsx:1084`) and `commercial/pricelist.tsx:2754` type their own panel (padding 6px) and their own row (`min-h-8`, 32px). `PrintMenu` mixes `PANEL` with a 32px row. `ColumnsMenu` alone is in 28 files. Import `POPUP` and `ITEM`; the Columns menu drawn on the Toolbar card is one of the copies.
- **Headings in capitals.** The code sets them `uppercase` with tracking (`text-eyebrow tracking-[0.05em]`); white.css switches both off. Write the word and drop the classes.
- **The operator key in mono.** `Keycap` (`filter-chip.tsx:45`) is `font-mono`, and a portalled panel sits outside the `.shell-page` that white.css resets mono in, so `~~*`, `!~~*` and `@>` still draw in JetBrains Mono. The key is the page's own face.
- **Another tick.** `OperatorMenu` ticks in `ink` (`filter-chip.tsx:106`); a menu's tick is `accent`.
- **Another gap.** `OperatorMenu` opens 6px under its chip; a menu opens 4px under its trigger.
- **A quiet trigger.** `SortMenu` and `ChoiceMenu` draw their trigger with no border and a `body` word (`list-chrome.tsx:1048`, `1146`). A supporting action is a ghost.
- **Menus nobody opens.** `ViewPicker` and the sheet's ⋯ (`more`) have no caller. The comment on `more` lists Print, which stands in the foot.

## What you provide

| Part | Props | Notes |
| --- | --- | --- |
| Base UI `Menu` | `Root`, `Trigger`, `Portal`, `Positioner`, `Popup`, `Item`, `Group`, `GroupLabel` | `Positioner`: `side="bottom"`, `align`, `sideOffset={4}`, `className={POSITIONER}`. `Popup`: `className={POPUP}`. `Item`: `className={ITEM}`, `closeOnClick`, `disabled`. |
| `ColumnsMenu` | `table`, `label`, `extra` | `label` is "Columns", or "View" when `extra` carries other switches. |
| `SortMenu` | `table`, `sorting`, `onSort`, `compact` | `compact` leaves the arrow alone under 48rem. |
| `ChoiceMenu` | `heading`, `value`, `options`, `onChange`, `icon` | `value` is `null` for the first option. |
| `OperatorMenu` | `field`, `operator`, `onChange`, `children` | `children` is the trigger: the chip's middle segment. |
| `Sheet more` | `{ label, onSelect, icon?, disabled? }[]` | Download, Duplicate and nothing else. |

Source: `frontend-hub/src/lib/filter-chrome.ts` (`POPUP`, `PANEL`, `POSITIONER`, `ITEM`, `POP_MOTION`), `components/ui/list-chrome.tsx` (`ColumnsMenu`, `SortMenu`, `ChoiceMenu`, `ViewPicker`), `components/ui/filter-chip.tsx` (`OperatorMenu`), `components/ui/sheet.tsx` (`MoreMenu`), `screens/stores/actions.tsx` (acts with reasons); capitals reset in `styles/white.css`.
