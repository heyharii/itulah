# Card

A card is a 1px `hairline` box with 10px corners and no shadow, drawn round one unit of a page (a framed table, a titled panel, a phone record or a board card) and never round something that already stands on its own.

## Where a box is right

| The unit | Drawn as |
| --- | --- |
| A list of records on a desk | The table frame: `Card` with `overflow-clip`, a `band` heading row (40px) and `row-line` between rows. See the DataTable card |
| A titled panel on an overview ("Latest back over the counter") | `Card`, `CardHeader` and `CardTitle` with a link at the right, over a framed table |
| A record on a phone | `PhoneCard`. See the PhoneCards card |
| An Ops board card (Toko Bandung, 24 pcs, Pack) | `board-card`: 16px padding, a 17px title at 600, a status, and the step as a 30px solid button at the foot |
| Problems at the top of an overview | `ExceptionQueue`. See its card |

## One box too many

White.css takes the frame off these itself ("a box around boxes is one too many"), so what is written differs from what is drawn:

- **A card holding a card.** The outer one loses its border, fill and shadow.
- **A card holding only facts** (a `dl` as its only child, `stores/overview-tab.tsx:97`). No frame, no fill, no side padding: the facts stand on the page as a property list.
- **A card round a list of divided rows** (`divide-y` as its only child). The rows stand on the page, as a table's do.
- **A card in a sheet.** The sheet is the card: sections stand 24px apart under a `SubHead`, facts are `Facts`, lines are a `MiniTable`. An items table keeps its own frame.
- **A box round a figure.** Figures stand in the strip, divided by hairlines.

## Anatomy

- **Card**: `canvas`, 1px `hairline`, radius 10px (`r-card`). The `shadow-soft` the kit asks for is switched off. A hairline frames; a shadow belongs to glass that floats.
- **Table frame**: `overflow-clip`, so the 10px corner clips the heading band and the heading still sticks to the page. `overflow-hidden` makes the card a scroll box and the heading sticks inside it. A card that scrolls its table sideways keeps `overflow-x-auto`.
- **CardHeader**: the title at the left, a link or controls at the right, 10px apart; 16px at the sides, 14px above and 11px below, so 48px with a one-line title.
- **CardTitle**: 16px at 600 in `ink` on a page. Inside a sheet white.css makes it 15px at 600, the `section` style.
- **Board card**: 1px `hairline`, radius 10px, padding 16px. Title 17px/24 at 600, the store or supplier; one `body` line under it for the number; the figure at 600 and the status on one line. The pointer lifts the edge to `hairline-2` and adds `shadow-board-hover`, and the step button goes to `cta-hover`. It is the only card that lifts.
- **Phone card**: see PhoneCards. It is a `Card` frame with a `row-line` foot.

## Sizes

| Part | Size |
| --- | --- |
| Corner | 10px (`r-card`) |
| CardHeader | 48px, a 16px title |
| Board card padding | 16px |
| Board step | 30px, padding 0 14px |

## Rules

- A card holds one unit and nothing nests in it.
- Frame with a hairline. The only shadow on a card is the board card's lift under the pointer.
- A table frame is `overflow-clip` and nothing else. There is no band across the top of a card: a title is a title, not a grey strip.
- A card's title names the panel. A link or a control for the whole panel stands at its right.
- On a phone a record is a `PhoneCard` and the table's frame is gone.

## Retired

- **The table frame typed by hand.** It is copied 143 times, with `overflow-hidden` or `overflow-clip`, and again with the phone string `max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none`. White.css forces `clip` on any card that holds a `table` (`white.css:846`), so the wrong class is harmless there; with no `table` inside, `hidden` still holds. One table frame replaces them.
- **`CardStrip`** (`procurement/basket.tsx:196`, `finance/general-ledger.tsx:809`): a `soft` band across the top, a rule under it. No grey bands.
- **`RecordCard`, `RecordHead`, `RecordBody`, `RecordActions`.** No screen uses them. They were written for the Distribution prototype: a band with an icon tile, a mono id, a title and a status pill. White.css keeps the band and resets the mono. A record on a phone is a `PhoneCard`, and on a desk a row.
- **Hand-made boxes.** About 100 boxes in 85 files write `rounded-card border` instead of `Card` (a few are the kit's own: `kpi.tsx`, the board card).
- **A card round facts or round a card**, as above.
- **Stale comments.** `card.tsx` says "16px corners, whisper shadow"; it is 10px and none.

## What you provide

| Part | Props | Notes |
| --- | --- | --- |
| `Card` | `className`, div props | Layout only. `overflow-clip` makes it a table frame. |
| `CardHeader` | `className`, div props | Title left, controls right. |
| `CardTitle` | `className`, `h3` props | |
| `CardStrip` | `className`, div props | Retired. |
| `RecordCard` | `className`, div props | Unused. |
| `RecordHead` | `tile`, `id`, `title`, `status`, `onClick`, `selected` | Unused. A `button` when it has `onClick`. |
| `RecordBody`, `RecordActions` | `className`, div props | Unused. |

Source: `frontend-hub/src/components/ui/card.tsx` (`Card`, `CardHeader`, `CardTitle`, `CardStrip`), `record-card.tsx`; the board card in `screens/operations/board/parts.tsx`; look in `styles/white.css` ("Cards: a hairline, no shadow", lines 893 to 956, and the board cards).
