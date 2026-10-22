# Phone

The phone is the same Central, with the data laid out for a hand. The baseline is an iPhone XR: 414 × 896, with the home bar's safe area at the bottom.

## The same controls, the same words

- A screen offers on a phone exactly what it offers on a desk: the same buttons, in the same order, with the same labels.
- Never hide a control "on phone only", and never swap Print for a PDF icon by device.
- Only the data adapts: a table becomes cards, and the figures become two columns or one sentence.
- The pointer decides the size, not the width. Under a finger (`pointer: coarse`) every button, field and foot verb is at least 44px (`tap`). With a mouse they stay at 36px.

## Everything at the bottom

- Nothing sits at the top of a phone list but the title and the figures (`KpiStrip` in two columns, or one band sentence in `body`).
- Every action lives at the bottom:
  - **The dock** (`DockTools`), fixed above the tab bar, all 44px:
    - the status chip, which picks one of a few (Active ▾, a store, a supplier);
    - the search capsule;
    - filter and sort, in one sheet: the ⚙ opens one page with every filter on view in the desk's order (long fields as pills and "All N", dates, chips, switches), then "Sort by" (see `ListFilters`);
    - the **Fab**.
  - **The Fab** is a round 44px `cta` with a plus beside the dock's other controls, or a full-width 44px bar with its word when it stands alone.
  - **The tab bar** holds the department's main screens: an icon over a 15px word, the current one in `accent`.
  - **The sheet foot** stays pinned above the keyboard and the home bar, its buttons 44px and sharing the width.
- Search, filter, sort, the "In use" switch, store pickers and New are never at the top of the page.

## Nothing scrolls sideways

- No sideways KPI strips, tab strips or wide tables.
- A table becomes cards (`DataTable` does this on its own; a table drawn by hand does not).
- Tabs become the dock's status chip.
- A statement too wide for the glass (a P&L with comparison columns) may scroll inside its own box. The page never does.

## Cards (`PhoneCards`)

```
┌──────────────────────────────────────────┐
│ Garmen Nusantara, PT              24 pcs │ card-name 16/600 · lead-figure 24/600
│ PO-161026-010 · 1 item      Rp 2.040.000 │ label lines in mute · the money under it
│ Delivery 29 Oct 2026                     │
├──────────────────────────────────────────┤ row-line
│ Received 0 pcs                  ● Active │ foot: a fact · the status
└──────────────────────────────────────────┘
```

- A card is one target that opens the record.
- It carries the record's name, at most three quiet lines, ONE lead figure at the right, and a foot with one fact and the status.
- A card action is one 32px button (`size="card"`) in the foot, never a full-width bar across every card.

## Sheets on a phone

- Every sheet is the bottom drawer:
  - full height less 12px;
  - top corners at `r-sheet`;
  - a grip;
  - `shadow-float`.
- A swipe down or a flick closes it. A dirty form asks before it lets go.
- The sides are 16px (`phone-gutter`).

## Typing numbers

A numeric field opens the `NumberPad` drawer instead of the system keyboard: big keys, the figure read back at the top, Done at the bottom right.

## Touch details

- No sticky hover states on touch: hover styles sit behind `hover: hover` and `pointer: fine`.
- Under touch every input, select and textarea is set at 16px, so iOS never zooms the page in on focus.
- No tap highlight flash; a press shows `scale(0.97)` instead.
- The account orb and the Fab must never cover a card's figure or its foot.
