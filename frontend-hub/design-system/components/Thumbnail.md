# Thumbnail

A Thumbnail is the small photo tile beside a name: the colourway's photograph, or its painted silhouette when there is none, wrapped in `ZoomPhoto` so a tap opens the photo.

## Anatomy

- The tile: `soft-2` fill, radius 8px (`r-inner`), no outline, clipped. Its size is the caller's `className`; the photograph or the silhouette fills it.
- The photograph: `object-cover`, held at the top of the picture (`center 15%`) so a garment keeps its collar, and faded in over 150ms once loaded. It loads when the tile nears the screen; pass `eager` for the first rows somebody is about to read.
- No photograph, or a link that no longer resolves: the silhouette from `Garment`, titled "No photograph yet". A broken link never shows the browser's broken glyph. With no name to draw from, the tile holds `fallback` (15px, `mute`, centred; a dash in a table cell).
- `ZoomPhoto`: the tile as one button, `cursor-zoom-in`, pressed to `scale(0.96)` over `t-press`, named "View the photo of Kaos Uji Uj16". With no photograph and no `placeholder` it is the tile and nothing else.
- `PhotoViewer`: the photograph full size over the window (`object-contain`, radius 10px), a 44px round × at the top right. A tap, a click outside, × or Escape puts it away; Escape closes only the viewer, not the sheets under it, and focus goes back to the tile. It fades in over `t-panel` with the photograph rising from 0.96, centred, and leaves the same way. With no photograph it shows the silhouette large and "No photo yet".
- `PhotoImg`: a plain small `<img>` beside a name (a colourway tile, an article's cover), with the same fade.

## Sizes

| Size | Where it stands |
| --- | --- |
| 32px (`size-8`) | The name cell of a list row: the Articles list, the allotment grid |
| 40px (`size-10`) | A line in an order or a sheet table (`ItemsTable`) |
| 44px and 48px | A count row, a pack line, the Pricelist |
| 64px (`size-16`) | A pick line |
| Full width, 158px high | The cover of a catalogue card |

The radius is always `r-inner`, written `rounded-inner`.

## Rules

- A thumbnail opens its photograph: wrap every Thumbnail that may hold one in `ZoomPhoto`, and pass the article's name as `name`.
- Give `name`, `division` and `colours` so a missing photograph is the right silhouette in the right colour, not a grey box.
- The tile has no outline. A hairline round it paints the tile white; the white look's photo tile is `soft-2` and plain.
- The tile sits left of the name, 12px away in an item line and 10px in a list row. An item's name beside it is a `record-link`.
- `PhotoViewer` is drawn on black at 90%, against the `scrim` every sheet veils in. It is a known exception, not a pattern to copy.

## Retired

- A hairline on the tile (`border border-hairline`): `master/articles.tsx:152` and `:264`, `operations/quantity-checks/quantity-checks.tsx:116`, `operations/packing/pack-sheet.tsx:799`, `procurement/setups.tsx:888` and `:982`, `allotment/article-thumb.tsx`.
- The radius written by hand (`rounded-[0.5rem]`, `rounded-[8px]`): `commercial/pricelist.tsx:2696`, `operations/packing/pack-sheet.tsx:799`, `procurement/setups.tsx:888`.
- A Thumbnail with no `ZoomPhoto`: 11 of the 15 files that draw one, among them `master/articles.tsx`, `operations/picking/pick-lines.tsx`, `operations/packing/pack-sheet.tsx` and `commercial/pricelist.tsx`.
- `.thumb-tile` in white.css: no component uses it.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `Thumbnail` `url` | `string \| null` | The photograph. `null` draws the silhouette or `fallback` |
| `Thumbnail` `name`, `division` | `string` | What the silhouette is drawn from |
| `Thumbnail` `colours` | `readonly string[]` | The colourway's paint (`colourwayFill()`) |
| `Thumbnail` `fallback` | `string` | The word when there is nothing to draw |
| `Thumbnail` `className` | `string` | The size and `rounded-inner`: `size-10 shrink-0 rounded-inner` |
| `Thumbnail` `eager` | `boolean` | Fetch at once, for the first rows |
| `ZoomPhoto` `url`, `name`, `placeholder` | `string`, `string`, `ReactNode` | `placeholder` is shown large when there is no photograph |
| `PhotoImg` `url`, `alt` | `string` | Both required |

Source: `frontend-hub/src/components/ui/thumbnail.tsx`, `photo-img.tsx`, `photo-viewer.tsx`; white look in `styles/white.css` (photo tiles: no outline).
