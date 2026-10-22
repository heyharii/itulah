# Page anatomy

Every screen is one of five templates, and each template copies the hub's best screen of its kind:

| Template | Use it for | Copy | Card |
| --- | --- | --- | --- |
| List | Finding, filtering and opening many records | Procurement › Purchase Orders | `ListPage`, `ListPhone` |
| Report | Reading a period's figures | Finance › Profit and Loss | `ReportPage` |
| Dashboard | Reading the state of things | Executive overview; Finance › Overview for "Needs attention" | `DashboardPage` |
| Form | Creating or editing a record; one record of facts with Edit | The PO composer; the supplier edit; People › Payslip | `FormSheet` |
| Board | Work moving through stages | Operations › Allotment (the kanban) | `BoardPage` |
| Workspace | A list and the work beside it | Merchandise › New articles; New allotment | `WorkspacePage` |
| Matrix | Two dimensions read across: article × store, colour × size | Marketing › Pricelist; the colour × size grids | `MatrixPage` |
| Door | Signing in and choosing a business | The sign-in door | `SignInDoor` |
| Paper | What is printed and handed over | Surat Jalan, packing list, PO print, letters, giro | `PrintPaper` |

Each card in the Patterns group draws the whole screen, lists the hub screens that already follow it, and lists the ones that drift.

## List — the one format

The slots, top to bottom:

```
┌ page (white, r-sheet 16, 12px off the stone) ─────────────────────────┐
│ Purchase Orders                                     [+ New order]     │ head: title · the one primary
├───────────────────────────────────────────────────────────────────────┤ hairline · 24
│ Orders   │ Still open │ Overdue │ On order                            │ figures: KpiStrip
│ 18       │ 18         │ 0       │ Rp 102,7 M                          │ 32
│ Active PO 18   Completed PO 14   Cancelled PO 13                      │ tabs: SubTabs · 16
│ [⌕ Search] [Created at] [Delivery date] [Group by supplier] [Columns] │ bar: Toolbar · 12
│ ┌ PO ───────────── Delivery date ───── Ordered ── Received ─ Status ┐ │ table: DataTable
│ │ Garmen Nusantara, PT  29 Oct 2026      24 pcs     0 pcs   ● Active│ │
│ │ PO-161026-010 · 1 item               Rp 2.040.000                 │ │
│ └───────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

**Head (`PageHeader`)**
- The title is the screen's name, in `title`.
- The screen's one primary action stands at the right: New order, Record bill.
- A department door's head ends on its `DoorTabs`.
- The head is padded 24/28/16, sits on a `hairline`, and sticks while the page scrolls under it. The table's headings stick under it (`--page-head-h`).
- No subtitle: the `sub` prop is not drawn.

**Figures (`KpiStrip`)**
- One row of `label` over `figure`, a 1px `hairline` between figures, and 24px either side of each rule.
- The first figure lines up with the title.
- A figure that maps to a filter may be clicked to apply it.
- Four or five figures at most, never equal boxes spread across the page.

**Tabs (`SubTabs`)**
- Use tabs only when they switch the dataset (Active, Completed, Cancelled).
- The count follows each word in `mute`. The chosen tab is `ink` with a 2px `ink` rule.
- A list with one tab draws none.

**Bar (`Toolbar`)**
- Search first, 280px at most.
- Then the list's other filters, drawn by `ListFilters`: names of long lists offered by the search box, one `DayRange` per date, one `SwitchPill` per yes/no, Clear while any is on. No Filter button.
- Then the space, then the view controls (Columns, Export CSV).
- Every control in the bar is 36px, 8px apart.
- The status is the tabs. Under the bar `ListFilters` adds one line of icon radio chips for the first short question ("All" first, counts, "+N" past six). Never a second line, a dropdown or a filter panel (owner, 20 Oct 2026).

**Table (`DataTable`)**
- Framed: a 1px `hairline` with `r-card` corners, a 40px heading row on `band` in `body-medium` `mute`, and a `row-line` between rows.
- One size (15px) and one face.
- The first cell is the row's name at 500, with one quiet line under it (the PO number · item count).
- Money and quantities are right-aligned, tabular, and one figure per cell.
- A late date is `bad-fg`.
- Status is `Status`: a dot in its tone and an `ink` word. The word takes colour only for warn or bad.
- A row that opens is one target: nothing in it is blue, and a › shows at its end on hover.
- The list scrolls with the page (`pageScroll`), never in a box of its own. It stays live, polling every 10s (`refresh`).

## Report

The same head. Then, in this order:
1. the scope (period and place) as the bar;
2. the figures;
3. the statement table: an indented account tree, comparison columns, a `band` totals row.

The statement may scroll sideways inside its own box on a phone. Every other part keeps to the page.

Each account drills down to its ledger, and each ledger line to its journal, as layers.

## Dashboard

- The head.
- The figures (`KpiStrip`).
- A "Needs attention" list: rows with a count and a ›, the count in `warn-fg` or `bad-fg` when it is late.
- Then charts (`Chart`) and short tables.

Each row and each chart links to the screen that does the work.

## Form (a record of facts)

- The facts stand on the page as `Facts`, in two columns.
- Edit opens the same fields in a sheet (`SheetFooter`: Cancel · Save changes).
- Read mode is never a disabled copy of the form.

## Board

The Ops kanban's lanes and cards stay exactly as they are:
- lanes on the white;
- cards with a `hairline` (`board-card`);
- the step on each card is a 30px solid primary (`board-step`).

The board sits inside the shell with the page head and a bar (search, store picker) at the bar's 36px. It is not a full-screen focus view. Today the code puts search, store, Needs attention and Dispatched in the head at 44px; that is retired.

## Phone (414 wide)

- The title, then one band sentence in `body` instead of the figures where that reads better ("Hi Rina, 18 orders are active, Rp 102,7 M in total."), or the figures as two columns.
- Then `PhoneCards`.
- Search, the status chip, filter and sort, and New all sit in the dock at the bottom (`DockTools`, `Fab`). Nothing sits at the top of a phone list but the title and the figures.
- The tab bar under the dock holds the department's main screens.
- Nothing scrolls sideways.

## Spacing, exactly

| From | To | Token | px |
| --- | --- | --- | --- |
| page edge | content | `page-gutter` | 28 |
| page top | title | `page-top` | 24 |
| title | head's hairline | `head-bottom` | 16 |
| head's hairline | figures | `head-gap` | 24 |
| figures | tabs | `figures-to-tabs` | 32 |
| tabs' hairline | bar | `tabs-to-bar` | 16 |
| bar | table | `bar-to-table` | 12 |
| control | control in the bar | `bar-gap` | 8 |
| cell edge | cell text | `cell-x` / `cell-y` | 16 / 12 |
