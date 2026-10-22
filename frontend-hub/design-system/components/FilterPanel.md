# FilterPanel

FilterPanel is the old name for the list's filters and now only renders [ListFilters](ListFilters.md): there is no Filter button, no Filters sheet and no clause chips after a button any more (owner, 20 Oct 2026: "standarisasi filter yg ada di frontend hub menyesuaikan po list").

Read ListFilters for how a list is narrowed, where each kind of question goes, the desk bar's order, the chip line and the phone's page. This card keeps only what is particular to the old names.

## The names that stay

| Name | What it is now |
| --- | --- |
| `FilterPanel` | `model`, `table`, `search`, `className`, passed straight to `ListFilters`. A new screen uses `ListFilters`. |
| `DeskFilterButton` | The same, for desk lists that passed `filterModel`; draws nothing on a phone, where the dock's sheet does the job. |
| `DeskFilterChips` | Renders nothing. |
| `FilterSheet`, `DockSettings` | Unchanged: the phone's plain form for a screen with no filter model, and the dock chip for the controls that say what a screen is reading (a moment, a pool, a unit). |

## Rules

- No Filter button, no filter sheet on a desk, no right rail (owner: 14 Oct 2026 "filter … buttonnya hapus"; 12 Oct 2026 "jangan filter kanan").
- A status that switches the dataset is a `SubTabs` tab, with counts. It is not a filter.
- A phone has no bar: filter and sort are the dock's.

## What you provide

| Component | Prop | Notes |
| --- | --- | --- |
| `FilterPanel` | `model`, `table`, `search`, `className` | As `ListFilters`. |
| `FilterSheet` | `open`, `onOpenChange`, `title`, `groups`, `children` | `groups` is `FilterGroup[]`: `key`, `label`, `value` (`null` is "All"), `options` (`value`, `label`, `count`), `onChange`. Row 48px, one answer per group. |
| `DockSettings` | `label`, `title`, `compact`, `children` | One short word on the chip. `compact` draws the icon alone. |

Source: `frontend-hub/src/components/ui/filter-panel.tsx`, `desk-filter.tsx`, `filter-sheet.tsx`.
