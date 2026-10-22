# PhoneCards

PhoneCards draw a list on a phone: one card per record, its name at the left, the one figure that matters at the right and a foot that says where it stands, and a tap anywhere on it opens the record.

## Pick by job

| The phone's list is… | Use |
| --- | --- |
| Also a table on a desk | `DataTable` with `cardLead`: the card is read from each column's `meta.card` role, and sorting, hidden columns and paging come with it. |
| Its own thing (the desk draws a grid, a board or a `MiniTable`) | `PhoneCards`: you say the parts of the card as a function of the row (`CardSpec`). |
| A few cards laid by hand (a day's takings, a ledger) | `PhoneList` holding `PhoneCard`s. |

All three draw the same frame, because `DataTable` renders `PhoneCard`. A change to the card is made in `phone-cards.tsx` and nowhere else; never write another card.

## Anatomy

```
┌──────────────────────────────────────────┐
│ Garmen Nusantara, PT              24 pcs │  CardName · CardFigure
│ PO-161026-010 · 1 item      Rp 2.040.000 │  quiet lines · its caption
│ Delivery 29 Oct 2026                     │
├──────────────────────────────────────────┤  row-line
│ Received 0 pcs                  ● Active │  CardFoot · one button or status
└──────────────────────────────────────────┘
```

| Part | Drawn as |
| --- | --- |
| Card | 1px `hairline`, `r-card` (10px), no shadow, 16px inside. `accent-bg` when it is the open record. |
| `CardName` | The name at `card-name` (16/20, 600, `ink`; `mute` when the record is over). Under it up to three lines at 15px in `mute`: the number first, then a fact. The number reads in the same face as the name. |
| `CardFigure` | The one figure, `lead-figure` (24/30, 600, tabular), right-aligned. Its unit is a 15px `mute` span beside it ("24 pcs"); its caption, 15px in `mute`, stands under it (the money). `tone` makes it `warn-fg` or `bad-fg`, `quiet` makes it `mute`. |
| `CardDate`, `CardMonth` | A date as the figure: "29 Oct" large with the year under it; a month with its year. |
| Foot | A `row-line` rule, 48px tall. At the left one fact in `mute` (`CardFoot` puts a status over a line of facts); at the right one button or one status. |
| `CardButton` | The foot's one button: a word, never an icon, 32px with a 44px hit area (`Button size="card"`), solid `cta`. Its press does not also open the card. |
| `GroupHeading` | A group's name at 16px/600, its count and total in `mute`, a chevron that folds it. `PhoneHeading` is the same as a list item and sticks to the top while its cards pass under it. |
| `Sentence` | The figures of the list as one line of 15px `body` under the title, in place of a strip of tiles. Each figure is a `Fig` at 600 in `ink`, or `warn-fg` or `bad-fg`. |

- Cards stand apart, 10px between them, on the page; the list's wrapper draws no border or fill on a phone.
- A body section (`body`) sits between the head and the foot under a hairline, for lines of figures or one field the card is also for. A press on a control in it does not open the card.

## Rules

- A card is one target: a tap anywhere does what its button does. Nothing in it is blue.
- One lead figure, one foot fact, one button or one status. A card action is the 32px button in the foot, never a full-width bar across every card.
- Say the figure, not a bar. A late date reads in `bad-fg`; the words carry the warning.
- Search, filter, sort and New are the dock's. Nothing sits above the cards but the title and the sentence.
- The list ends with `more` (infinite scroll), never a "Show more" button.
- Nothing scrolls sideways.

## Retired

- The 24px lead-figure class string, copied 37 times in 27 files (`procurement/purchase-orders.tsx:693`, `procurement/outstanding.tsx:189`, `people/directory.tsx:330`). Use `CardFigure`.
- `DESK_BAR` (8 uses), the desk's bar row for a screen whose controls are the dock's. Use `Toolbar`.
- `CardButton` still asks `Button` for the retired `tint` variant, which white.css paints as the primary. It means `variant="primary" size="card"`.
- `alert` and `cardTone`: the component washes the foot red, but white.css makes every card foot white on a `row-line` rule, so nothing shows. The words carry the warning.
- A thin mono code line: nothing is set in mono, and white.css resets it.

## What you provide

| Component | Prop | Notes |
| --- | --- | --- |
| `PhoneCard` | `title`, `code`, `line` | The name, a number line, quiet lines (an array is one line to an element). `muted` greys a record that is over. |
| | `head` | The whole head, for a card whose head is not a name over lines (a thumbnail beside it). |
| | `lead`, `caption`, `tone` | A string or number is drawn as a `CardFigure`; a node is drawn as it is. |
| | `body`, `foot`, `action` | The section under the head; the foot's left; the foot's right. |
| | `onOpen`, `intent` | The tap; the pointer, focus and touch handlers that warm the sheet. |
| | `selected`, `fresh` | The open record; a record that has just landed. |
| `PhoneCards` | `rows`, `rowId`, `spec` | `spec` has `title`, `meta[]`, `lead`, `foot`, `action`, `alert`, each a function of the row. |
| | `onOpen`, `selected`, `more`, `empty` | `empty` is a sentence that says which nothing it is. |
| `PhoneList` | `rows`, `children` | Cards and headings, 10px apart. |
| `GroupHeading` | `title`, `mark`, `count`, `total`, `open`, `onToggle` | Folds only when `onToggle` is given. |
| `Sentence` | `children` | Figures inside are `Fig`. |

Source: `frontend-hub/src/components/ui/phone-cards.tsx` (`PhoneCards`, `PhoneCard`, `CardName`, `CardFigure`, `CardDate`, `CardMonth`, `CardFoot`, `CardButton`, `Sentence`, `Fig`, `PhoneList`, `GroupHeading`); the look in `styles/white.css` (cards, the foot band).
