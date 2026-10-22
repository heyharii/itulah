# ColourSwatch

A ColourSwatch is a 12px dot in a garment's colour with a ring that keeps white and cream visible: draw one for a single colour and `Swatches` for what an article comes in.

## Anatomy

- The dot: 12px (`size-3`), fully round, filled with the colour master's hex. It is the master's value, never a token: the company decides what "Navy" looks like.
- The ring: 1px, inset, `hairline-strong`, always drawn. Half the vocabulary is white, off-white and cream, and a white dot on a white card is nothing at all.
- A colour with no hex yet is an empty ring on `canvas`, never a grey dot: a grey dot claims the colour is grey, on exactly the rows where somebody still has to set the value.
- `Swatches`: a row of dots 4px apart, at most six by default (`cap`), the rest as "+2" in `mute` at 15px, tabular. With no colours it is a dash in `mute`.
- `label` is the colour's name, in the tooltip and for a screen reader. Without one the dot is `aria-hidden`.
- With `onShow` each dot is padded 2px so it is easier to hit, and the row says which dot the pointer rests on (`null` when it leaves), for a card whose silhouette repaints in that colourway.

## Sizes

One size, 12px.

## Rules

- Name every swatch. A dot alone cannot be read by anybody who cannot see it, nor named by anybody who can.
- Keep the ring. Never swap it for a border colour of your own, and never draw the empty value as a grey dot.
- Cap a row at six, the default. A card is a glance: six dots read as a colour range, ten as a diagram, and a row of ten is 30px wider than every other row in the table. Ten is the permanent ceiling, because the colour is one digit of the eleven-digit SKU.
- The fill is the master's hex, set inline. Do not paint a swatch from a colour token.

## Retired

- Hand-drawn dots, each a different size and edge: `operations/packing/pack-sheet.tsx:816` (10px, a `hairline-strong` border), `master/colour-picker.tsx:62` (16px, a dashed border when there is no hex), `allotment/to-allot.tsx:376` (10px, a dashed `mute` border), `master/article-view.tsx:209` (10px, a `black/10` border and a transparent fill when there is no hex). Use `ColourSwatch`.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `ColourSwatch` `hex` | `string \| null` | The master's value. `null` draws the empty ring |
| `ColourSwatch` `label` | `string` | The colour's name |
| `Swatches` `colours` | `{ colour_code, label, hex_code }[]` | One entry per colour of the article |
| `Swatches` `cap` | `number` | Default 6 |
| `Swatches` `onShow` | `(at: number \| null) => void` | Which dot the pointer is on, by its place in `colours` |
| `className` | `string` | Layout only |

Source: `frontend-hub/src/components/ui/swatch.tsx` (`ColourSwatch`, `Swatches`).
