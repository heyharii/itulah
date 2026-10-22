# BoardPage

The template for work that moves through named stages. It has the head, a bar for search and store, then three lanes that never fold. Each card is one piece of work with one next step. It is copied from Operations › Allotment.

## Copy this screen

- Route `/operations/board`, file `frontend-hub/src/screens/operations/board/board.tsx`, with:
  - `step-card.tsx` (`Trays`, `Tray`, `StepCard`, `TraySections`, `CardSkeletons`)
  - `hand-off.ts` (`useHandOff`, the flight to the next lane)
  - `dispatched.tsx` (the Dispatched sheet)
  - `parts.tsx` (`BoardHeader`)
- Start from it for any board whose cards wait for a physical step and move left to right.
- The owner's decision (17 Oct 2026, option A of `allotment-board-options.html`, "update yg A ke kita"):
  - grey trays, no drag, no pictures on a card;
  - the step written at the foot of the card;
  - the card flies to the lane it went to.

## When to use it

| The screen is for | Use |
| --- | --- |
| Work waiting for a physical step: pick, pack, dispatch | BoardPage |
| Finding, filtering and opening many records | ListPage |
| Reading a period's figures | ReportPage |
| Reading the state of things | DashboardPage |

## Slots, top to bottom

A slot may be empty. It is never moved or restyled.

| Slot | Component | Drawn as | Space after |
| --- | --- | --- | --- |
| Head | `PageHeader` | The title "Allotment" at `title`. A board has no primary action: the right of the head stays empty. | 24px (`head-gap`) |
| Figures | `KpiStrip` | Only where the board has figures. The Allotment has none. | 32px (`figures-to-tabs`) |
| Tabs | none | A board draws none on a desk. | |
| Bar | `Toolbar` | In order, 8px apart:<br>- search ("Search article or store")<br>- the store picker ("All stores")<br>- one switch ("Needs attention")<br>- `BarSpacer`<br>- the view button "Dispatched 3" (ghost, truck glyph) | 12px (`bar-to-table`) |
| Lanes | `Trays`, `Tray`, `StepCard` | One row filling the height the page has left (`PageContent fill`). | |

### Lanes and cards, as drawn

**Tray** (`board-tray`)
- Each lane is a `soft-2` tray at `r-card` with no border, so it reads as a place the goods sit in.
- The row is a grid of three trays, each at least 17rem, with a 16px column between each two that holds a `faint` › at the height of the heads. The trays share the width. A narrow page scrolls the row sideways inside itself, never the page.
- The head is padded 14 14 10. It has an 8px dot in the lane's tone (`mute` Pick, `warn` Pack, `info` Dispatch), the name at 15px 600 in `ink`, and the count at the right at 500 in `body`.
- The cards stand in a column 8px apart, with 8px round them, and scroll inside the tray.
- An empty tray keeps its width and says it in its middle with `EmptyState` and the kit's picture: "Nothing to pick", "Nothing to pack", "Nothing to dispatch".
- When the search, the store or "Needs attention" narrows the board, an empty tray says "Nothing matches" (search picture) with a ghost **Clear**. With only "Needs attention" on, it says "Nothing needs attention" (done picture).
- Lanes never fold, no name is written sideways, and no total stands at the foot.

**StepCard** (`board-card`)
- It is one `button`: the whole card is the press. It has a 1px `hairline` border, `r-card`, white, and 14px 16px inside. With a mouse the border turns `hairline-2`; a press is `scale(0.98)` over `t-press`.
- Line 1 is the name at 17/24 600, truncated. The pieces stand at the right at 600 with the unit at 400 in `body` ("5 pcs").
  - A change MD made reads "30 → 24 pcs", the "was" in `body`.
  - A Dispatch card shows its total pieces there.
- Line 2, in `body`:
  - a Pick card: the store and the allotment ("C001 · Cikupa · ALT-00000009");
  - a Pack card: the allotment, or "2 allotments".
- A Dispatch card lists its koli under a dashed `hairline` rule: "Koli 1 · KOLI-0012 … 30 pcs". "take out 6" stands in `bad-fg` before the pieces of a koli that owes some.
- **No pictures on a card.** The step's sheet shows them.
- The foot has the fact at the left in `body` ("4 SKUs", "1 allotment", "2 koli"). MD's unseen change follows it: "· −6 by MD" (`bad-fg`) or "+12 by MD" (`accent`).
- **The step** is at the right of the foot: the word at 600 and a 16px ›, in `accent` ("Pick ›", "Pack ›", "Dispatch ›"). Where MD took pieces out, the word is `bad-fg` and says what the press does first: "Put back 6 ›". It is words, not a filled button, so twenty cards are not twenty blue buttons.
- **Strip:** a 28px band across the top edge, 15px 600 in white. The reason is a tooltip.
  - `warn-fg` "Short pick"
  - `bad-fg` "Edited −6" or "Cancelled by MD"
  - `accent` "Edited by MD"
  - A 7px `accent` dot before the name marks a change nobody opened yet. Opening the card's work is seeing it.
- **Called off:**
  - A card MD cancelled whole is `soft` and hatched (`SWITCHED_OFF`), its words at half strength, with `DocStamp` "Cancelled" (`mute`) in a row of its own.
  - Its press does the one thing left: "Put back N", or "OK" (no ›) for a picklist that was cancelled before anything was picked.

### What moves a card

- A press, never a drag. It opens the sheet that owns the step:
  - Pick → the Pick sheet;
  - Pack → the Pack sheet;
  - Dispatch → the Dispatch sheet, with every ready store ticked;
  - pieces owed → Put back.
- The sheet asks first; nothing is written by the press.
- When the step is done and the board has read again, a copy of the card flies to the card it went to. The path is Pick → that store's Pack card → its Dispatch card → the Dispatched button. The flight is 300ms `cubic-bezier(0.77, 0, 0.175, 1)`, kept under 300ms because a picker sees it tens of times a day. It scales to the target's width and fades in its last 30%. The target then rings once: a 3px `accent` ring fading over 600ms. With reduced motion only the ring plays.
- Put back and Unpack live in the sheets. The Pack sheet has Put back. The Dispatch sheet gives each koli an "Unpack" (ghost, `onUnpack`); it closes the sheet and opens the Put back dialog toward picked, the same dialog a drop used to open. A lane takes no drops.
- The board stays live: it reads again every 30s.
- While it is first read, the bar stays and each tray shows the shape of cards (`CardSkeletons`). If the read fails, the page shows `ErrorState` under the bar.

## On a phone

- Lanes need room a phone has not got, so each lane becomes a section (`TraySections`).
  - The heading folds and sticks while its cards pass under it: dot, name at 16px/600, count and pieces in `mute`, chevron.
  - The cards under it are the same `StepCard`s as on a desk.
  - An empty section says its sentence in one quiet line ("Nothing to pack", or "Nothing matches").
- `RefreshStrip` says when the board was read; its reload is in the dock.
- Search, "Needs attention" (the dock's one filter, on or off) and the store picker are in the dock. "Dispatched" is the dock's round action. Nothing sits above the cards.

## The Dispatched sheet

Read only, behind the bar's button. It lists every trip by day (the day in `body`). Each trip is a white `r-card` box:
- The stores it went to, at 600, at the left.
- At the right, a 7px dot and a word:
  - `accent` "On the road";
  - `warn` "Received 1 of 2";
  - `ok` "Completed" (word in `ok-fg`).
- Under it, in `body`: "13:10 · DSP-HO-GUDANG-000006 · 3 koli · 92 pcs".
- Under that, the trip note the bay wrote (plate, driver, courier), when there is one.
- A trip to one store opens its delivery note.
- A trip to several stores lists them in 48px rows under a hairline: store, "2 koli · 52 pcs", "Received" (`ok-fg`) or "On the road", a `faint` ›. Each row opens its note.
- Nothing dispatched: `EmptyState` "Nothing dispatched".

## Rules

Do:
- Keep every lane open and sharing the width, and name each lane by the next thing done.
- Give a card one figure, one step and at most one exception (a strip, a change).
- Open the work from the card; let the dock hold the controls on a phone.
- Say "Put back" in red and the step in blue, as words at the card's foot.

Don't:
- Put a filled button on every card, or pictures on a card.
- Offer drag and drop on the Allotment: one press, one sheet.
- Fold a lane, write a name sideways, or draw a lane total.
- Put a progress bar on a card: say the figure.
- Offer a Board | Table switch on a desk; a phone reads sections.

## Retired

Follows it: Allotment (`/operations/board`).

Drifts, on the reference page itself:
- Its controls stand in the head's right end at 44px: `board.tsx` passes search (`h-11 w-80`), the store `Select` (`h-11 w-52`), "Needs attention" and "Dispatched" as the head's `actions`. The rule is a bar of 36px controls under the head.
- "Needs attention" swaps to `tint` when on.
- The phone's dock action is 36px (`size-9`); dock controls are 44px.

Drifts elsewhere:
- Return Store (`/operations/board/returns`) still draws the earlier board:
  - `Lanes`/`Lane`/`Tile` from `parts.tsx` on the white, with pictures and drag (`drag.tsx`);
  - a solid step button, a full-width red Put back (`danger`), hand-made stamps;
  - empty lanes folded to a 52px strip with the name written sideways, and a total under every lane (`returns.tsx`: `Lane` left at `folds` and `total`);
  - Title Case lane names ("On the Way", "Receive Count"); lanes are not places, so "On the way";
  - search and a Board | Table switch as the head's `actions`;
  - phone rows from `stage-table.tsx`.
  Move it to `Trays`/`StepCard`.
- `BoardHeader closeTo`, a full-screen header with Back: no screen passes it any more. `/operations/board/suppliers` (Return PO) is a table under a `BoardHeader`, not a board.

## What you provide

| Piece | Prop | Notes |
| --- | --- | --- |
| `BoardHeader` | `board`, `title`, `actions` | Leave `actions` empty; the bar is `Toolbar`. |
| `Trays` | `children` | The row; draws the › between trays. |
| `Tray` | `title`, `tone`, `cards`, `empty` | `tone` is the dot: `bg-mute`, `bg-warn`, `bg-info`, `bg-ok`. `cards` left out while loading. |
| `StepCard` | `id`, `title`, `pieces`, `from`, `unit`, `sub`, `meta`, `lines` | `id` names it for the flight ("pick:…", "pack:<store>", "dispatch:<store>"). |
| | `step` | `{ label, tone?: "bad", chevron? }`: what the press does. |
| | `strip`, `tags`, `dot` | The one exception, and MD's unseen change. |
| | `cancelled` | Hatched, stamped "Cancelled". |
| | `onOpen`, `pending` | The press. |
| `TraySections` | `sections` | The phone's lanes, with the same cards. |
| `useHandOff` | `open`, `watch` | Returns `launch(from, to)`, called as a card opens its sheet. |

Source: `frontend-hub/src/screens/operations/board/board.tsx`, `step-card.tsx`, `hand-off.ts`, `dispatched.tsx`, `parts.tsx`; look in `styles/white.css` ("Boards (Ops)": `.board-tray`, `.board-card`).
