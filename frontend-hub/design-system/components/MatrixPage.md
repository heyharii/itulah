# MatrixPage

The template for a grid read across and down: articles or SKUs on the rows, stores or sizes in the columns, one figure in each cell, in a box that scrolls on its own while the page stays put, copied from Marketing › Pricelist.

## Copy this screen

- Route `/commercial/prices`, file `frontend-hub/src/screens/commercial/pricelist.tsx` (`Pricelist`): `PriceGrid` is By store, `ArticleTable` is By article, `PhonePrices` is the phone.
- Start from it for any "what is it at each place" question. The small colour × size grid is `Matrix` in `screens/procurement/setups.tsx` (class `.ui-matrix`); the SKU × store quantity grid is `Matrix` in `screens/allotment/matrix.tsx`.

## When to use it

| The question | Use |
| --- | --- |
| What does every article cost at every store, and why? | MatrixPage: Pricelist, By store |
| How do I spread this SKU's stock across the stores? | A workspace page whose body is the grid: New allotment (SKUs × stores) |
| How many of each colour and size? | The small grid in a sheet or form: colour × size |
| Which records match? One record per row | ListPage and `DataTable`, never a matrix |

## Slots, top to bottom

A slot may be empty. It is never moved or restyled.

| Slot | Component | Drawn as | Space after |
| --- | --- | --- | --- |
| Head | `PageHeader` | "Pricelist". No primary. | 24px (`head-gap`) |
| Figures | `KpiStrip` | Four or five: Articles, On promotion, Markdown, Store price, Below cost. | 32px (`figures-to-tabs`) |
| Tabs | `SubTabs` | Prices 12 · Price changes 4. The tabs switch the dataset. | 16px (`tabs-to-bar`) |
| Bar | `Toolbar` | The view first: `Segmented` By article · By store (it changes the reading, so it is a view control, not a status filter). Then search and filter in one box, then the ghost Show. Ticking rows swaps the bar to "2 articles selected · Clear" and the primary Change price at the right. 8px apart. | 12px (`bar-to-table`) |
| Matrix | a framed box | 1px `hairline`, `r-card`, scrolling both ways. | |
| Foot | text | "12 of 12 articles" in `mute`, under the box, padded 12 16. | |

### The grid, By store

- Columns: a 48px tick, the article 312px, All stores 224px, then one 160px column per store. The first three are frozen (`sticky`, at 0, 48 and 360px); the All stores column carries a 1px `hairline-strong` rule on its right, where the frozen block ends.
- Heading row: `band`, 15px at 500 in `mute`, 14px 12px inside, a `hairline` under it, stuck to the top. A store's name opens that store's shelf as a layer. A store whose till has not picked up the latest prices carries "Not updated yet" under its name in `warn-fg`, with a `warn` dot.
- Cells: 14px all round, a `row-line` between rows, figures right-aligned and tabular, aligned to the top.
- The article cell: a 24px chevron that opens its SKU lines, a 48px picture, then up to three lines in one face: the name at 500, "00000412 · Pria", the tags. The name opens the article.
- A SKU line stands 100px in, its size and colour over its code ("M · Biru"), priced in the same columns.
- A price cell is one target: the price, then pieces in `mute` and tags as words ("20 pcs · Promo"). The price is `line-ico` grey when it is what the All stores column says and `ink` when it differs, with how far from the regular price in `mute` ("+5%", "−20%"). Where the sizes disagree it says "3 prices" and the article opens. A store that does not sell it says "Not sold" in `line-ico`.
- Rest `canvas`; hover `soft`; its layer open `soft-2`; the row ticked `accent-bg`. On hover a 288px card (`shadow-pop`) says what the price is made of: base, the store's own price, the markdown or promotion with its dates.
- Tags are words in a tone: Promo `ok-fg`, Markdown `new-fg`, Below cost `bad-fg`, Changes 01 Nov `accent`. The hub paints them with hex literals today (see Retired).

### The small grid: colour × size

- Colour down, size across, Quantity on both outside edges. Rules run across only: the heading white with a `hairline` under it, a `hairline` over each row, no rule down and no frame (white.css `.ui-matrix`). The totals row is 600 with no fill.
- Rows are 36px with 8px a side; the colour is the row's name at 500 in `ink`; sizes are 88px columns (144px where a cell holds a box), figures right-aligned, a missing one "—".
- At most ten colours; sizes are open-ended.

### When it scrolls sideways

- A grid whose columns are open-ended (stores, sizes) scrolls both ways inside its own box. The heading sticks to the top, what names the row to the left, what totals it to the right. The head, figures, tabs and bar never move.
- Say where more lies: the allotment grid draws a 24px arrow and a line down its gutter while stores are cut off; the colour grid fixes its colour column so a figure is never read without its colour.
- The page never scrolls sideways. At 1440 the Pricelist shows three stores before its box scrolls; at 960, one and a half.

## On a phone

- Not a grid. The Pricelist is a card per article (`PhonePrices`): the picture and name over "00000412 · 12 SKU", the one price as `CardFigure` with its source ("Base price", "Promotion") under it, a foot with pieces, cost and markup, and a 32px Change button. A sentence ("12 of 12 articles.") stands where the figures would. Search, filter and the tabs are the dock's.
- New allotment shows one store at a time: a picker with ‹ › arrows 44px wide, no Stock column, the totals in the gutter.
- The colour × size grid is the one that stays a grid, scrolling inside its box with the colour column fixed.

## Rules

Do:
- Ask one question per matrix and name both axes in the headings.
- Put one figure in a cell: grey when it repeats the column that says it, `ink` when it differs, the meaning in a word beside it.
- Freeze the identity of the row and its total, and scroll the rest.
- Rule the small grid across, not down: the eye reads across.

Don't:
- Fill a cell with colour or draw a bar in it: write the figure.
- Scroll the page sideways, or make a list a matrix: a record per row is `DataTable`.

## Retired

Follows it: Pricelist By store; New allotment (SKUs × stores); colour × size in New articles and in the article sheet (`master/article-edit.tsx:662`).

Drifts, on the reference page itself:
- Hex tag colours (`pricelist.tsx:1899`–`1938`: `#0d7469`, `#b2386a`, `#c4271b`, `#2459c9`): use `ok-fg`, `new-fg`, `bad-fg`, `accent`.
- Seven figures (`pricelist.tsx:689`); four or five at most.
- A hand-made bar (`pricelist.tsx:763`: `gap-3`, `mb-4`, `min-h-10`) and `Show` as a quiet trigger (`:2738`) over a menu heading in `uppercase`: use `Toolbar` and a ghost.
- `font-mono` on the SKU code (`pricelist.tsx:2413`), which white.css resets.
- By article (`ArticleTable`) is a table with a 62rem floor that scrolls inside its box; it takes the table look and none of `DataTable`'s phone cards.

Drifts elsewhere:
- Three grids, three codes: `PriceGrid` (a table), the allotment `Matrix` (virtualised rows of `div`s) and the colour × size `Matrix` (a table with `.ui-matrix`). They share no component, and only one carries the white look's grid rules.
- Tinted chips for a state: the allotment gutter's "left" is a `bg-ok-bg`, `bg-warn-bg` or `bg-bad-bg` pill (`matrix.tsx:2936`); a state is a dot and a word.
- A 76px heading over the allotment grid and 44px number boxes on a desk, where every other control is 36px.
- `data-aid-freeze` in white.css, a first-column freeze still "being chosen": each grid freezes its own columns by hand.

## What you provide

| Piece | Prop | Notes |
| --- | --- | --- |
| `Matrix` (colour × size) | `colours`, `sizes` | Rows (at most ten) and columns, each `{ key or code, label }`. |
| | `cell(colour, size)` | What one cell holds. |
| | `rowTotal`, `columnTotal`, `total` | Leave out and neither outer edge is drawn (prices have no sum). |
| | `columnClass`, `rowHeadClass` | 88px by default; `rowHeadClass` when row heads carry more than a name. |
| | `rowHead`, `columnHead`, `cellProps` | A picture or a pencil in a head; attributes for one cell. |
| `PriceGrid` | `page`, `views`, `selected`, `onOpenCell`, `onOpenArticle`, `onOpenShop`, `more` | Local to `pricelist.tsx`. |

Source: `frontend-hub/src/screens/commercial/pricelist.tsx`, `screens/procurement/setups.tsx` (`Matrix`), `screens/allotment/matrix.tsx`; the small grid in `styles/white.css` ("A colour × size grid: white heading, rules across only").
