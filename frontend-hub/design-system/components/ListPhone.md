# ListPhone

The template for a ListPage on a phone at 414px: the title, one band sentence, cards grouped by what they belong to, and every control in the dock over the tab bar.

## Copy this screen

- Route `/procurement/orders` under 768px, file `frontend-hub/src/screens/procurement/purchase-orders.tsx` (`SummaryBand`, `DockTools`, `Fab`, `DataTable` with `cardLead`).
- The baseline is an iPhone XR: 414 × 896, with the home bar's safe area under the tab bar.
- It is the same screen as ListPage, with the same controls in the same order and the same words. Only the data changes shape.

## Slots, top to bottom

| Slot | Component | Drawn as |
| --- | --- | --- |
| Top bar | the shell's `PhoneTitle` | 52px, the screen's name at 17px, 600. No actions. A page head that only repeats it is not drawn. |
| Band | `Sentence` with `Fig` | One 15px sentence in `body` under the title, in place of the figures: "Hi Rina, 1 order is late. 18 orders are active, Rp 102,7 M in total." Each figure is 600, tabular, `ink`; the one that is late is `bad-fg`. A figure and its words never part across lines. A `hairline` under it. |
| Cards | `PhoneCards` (`DataTable` with `cardLead`) | One card per record, 10px apart on 16px gutters (`phone-gutter`). |
| Group heading | `GroupHeading` | The group's name at 16px, 600; its count and total in `mute` (15px), a chevron that folds it. |
| Dock | `DockTools`, `Fab`, reload | A floating card 8px in from the sides and 8px above the tab bar, every control 44px (`tap`). |
| Tab bar | the department's nav | 52px: icon over a 15px word, the current screen in `accent`. |

### The card

- Name at `card-name` (16/20, 600), then the PO number · item count, then "Delivery 29 Oct 2026" in `mute`. A late date is `bad-fg` at 500.
- The one figure at the right: `lead-figure` (24/30, 600) with "pcs" in `mute` beside it, the money under it in `mute`.
- The foot is a `row-line` rule and 48px: "Received 0 pcs" at the left, the `Status` at the right. A short order says how much came in, "Received 36 pcs", with its value under it.
- A foot holds one status or one button, never both. A card button is 32px with a 44px hit area (`CardButton`).
- A tap anywhere on the card opens the order as a layer. Nothing in it is blue.

### The dock, left to right

1. The status chip, "Active ▾", 44px, round, `soft-2`. It opens a sheet of Active, Completed and Cancelled, each with its count. A status is a place, not a filter.
2. The search capsule, "Search Orders", with the ⚙ (filters and sort, one sheet) at its end (36px, a 44px target). It turns `accent-bg` while a search or a filter narrows the list.
3. The reload, a round 44px button, on a list that stays live.
4. The Fab, a round 44px `cta` with a 20px plus: New order. With no status chip it is a full-width 44px bar with its word.

The tab bar is Home, then the department's screens (Orders, Suppliers, Return PO). Something waiting is a 10px `accent` dot on the icon, never a count.

## What changes from the desk

| Desk | Phone |
| --- | --- |
| New order in the head | The Fab |
| The figures strip | The band sentence |
| Tabs | The status chip and its sheet |
| Search, date ranges, switch | The search capsule and one filter and sort sheet |
| Columns | None: each column has a role on the card |
| The table | Cards, grouped when the switch is on |
| The totals row | None |

## Rules

Do:
- Put every action at the bottom: the dock, the Fab, the sheet's foot.
- Keep search, filter, sort and status in the dock, and keep every touch target at 44px.
- Say the same words as the desk ("New order", "Search Orders").
- End the list with `more`, not a Show more button.

Don't:
- Put a search box, filter, sort row, tab strip or button above the cards.
- Scroll anything sideways: no figure strip, no table, no tab strip.
- Draw a second card: a change to the card is made in `phone-cards.tsx`.
- Colour a card's foot red. The words carry the warning.

## Retired

Follows it: Suppliers (`procurement/suppliers.tsx`) and the lists that mount `DockTools` and `Fab` with `DataTable cardLead`.

Drifts on the reference page:
- `SummaryBand` is hand-written and bolds only its first fact; `Sentence` and `Fig` bold every figure.
- Its grouping heading is a local `GroupHeading` (`purchase-orders.tsx:1742`, written for the desk) that says "2 orders · Rp 8.160.000" in one `body` line, not the kit's count and total.
- The 24px lead-figure class string (`purchase-orders.tsx:693`) is one of 37 copies in 27 files; use `CardFigure`.
- A finished order presses a hand-made stamp into the foot (`STAMP`); use `Status`.
- The Fab says "New Order". The top bar sets the title 12px in (`px-3`), 4px left of the band and the cards.

Drifts elsewhere:
- `DESK_BAR` (8 uses), the desk's bar on a screen whose controls are the dock's.
- `cardSort` left on, so a "Sort by" row sits above the cards.
- `finance/stores.tsx:173` draws a row of figure buttons that scrolls sideways.
- `CardButton` still asks for the retired `tint` variant: it means `primary` at `size="card"`.

## What you provide

| Slot | You pass |
| --- | --- |
| Band | `Sentence` holding `Fig`s; the late figure `tone="bad"` |
| Cards | Columns with `meta.card` roles (`title`, `meta`, `lead`, `foot`, `status`, `hide`) and `meta.priority`; `cardLead`, `cardsApart`, `cardSort={false}` |
| Groups | `renderBefore` returning `GroupHeading` (`title`, `count`, `total`, `open`, `onToggle`), `isHidden` for a folded group |
| Dock | `DockTools` (`search`, `filter`, `sort`, `status`) and `Fab` (`label`, `onClick`); `refresh` on the `DataTable` puts the reload in |
| Tab bar | Declared in the department's nav (`short`, `icon`, `useCount`); the screen draws nothing |

Source: `frontend-hub/src/screens/procurement/purchase-orders.tsx`, `components/ui/phone-cards.tsx`, `components/shell/top-bar.tsx`, `dock.tsx`, `dock-tools.tsx`, `bottom-bar.tsx`, `components/ui/fab.tsx`; the look in `styles/white.css` (cards, the foot band).
