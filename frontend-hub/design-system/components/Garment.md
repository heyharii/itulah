# Garment

A Garment is the silhouette painted in an article's colour when it has no photograph: it fills the tile a `Thumbnail` gives it, and it reads as a placeholder so nobody takes it for the product's picture.

## Anatomy

- One drawing, 100 by 100, filling its tile with 6% padding all round. One path per silhouette, a 1.2px stroke with round joins. The fill eases to a new colour over 150ms when the colourway changes.
- No stitching and no model: a flat shape on the `soft-2` tile of the Thumbnail around it, titled "No photograph yet".
- The shape: the first rule that matches a whole word anywhere in the article's name (`garmentKind`). Rules run in order, so "shirt dress" is a dress and "padded jacket" a jacket. When the name says nothing, the division decides; with neither, a coat hanger.
- The colour: `colours`, the colourway's hex from the colour master. Two or three paint the garment split on the diagonal ("Hitam/Putih"). With none, the colour the name asks for; with none there, grey.
- The stroke is `rgb(0 0 0 / .25)`, and `.42` when the paint is pale (light enough to vanish into the tile): white, cream and mint are drawn by their outline.

## The 62 silhouettes

| Group | Kinds |
| --- | --- |
| Tops | tee, longsleeve, polo, tank, shirt, blouse, koko, sweater, hoodie |
| Layers | cardigan, jacket, blazer, coat, vest, robe |
| Dresses and skirts | dress, maxi, gamis, mukena, hijab, skirt, longskirt |
| Bottoms | pants, wide, leggings, shorts, jumpsuit |
| Underwear, nightwear, baby | onesie, bib, bra, brief, swimsuit, pyjama, sock |
| Headwear | cap, beanie, hat, peci, hairband |
| Accessories | sunglasses, belt, scarf, glove, tie, bowtie, watch, bangle, necklace, earring, umbrella, mask, bottle |
| Bags | bag, tote, backpack, wallet |
| Shoes | shoe, boot, heel, sandal |
| Nothing to go on | accessory, hanger |

When the name names no kind, the division picks one: Wanita is a blouse, Pria and Anak laki a tee, Anak perempuan a dress, Perlengkapan bayi a onesie, Sandal sepatu a shoe, Tas a bag, Aksesoris the accessory and Non divisi the hanger. Mukena, hijab and bangle draw a hole and use the even-odd rule.

## Sizes

None of its own: it fills whatever tile it is given, from 32px in a list row to 64px on a pick line, and large in the photo viewer when someone taps a tile with no photograph.

## Rules

- A Thumbnail decides when to draw it: never put a Garment where a photograph exists, and never hand-draw a grey box instead.
- Always pass the article's `name`, and its `division` when the name may say no kind. Pass `colours` from `colourwayFill()` or `useColourwayFill()`, so the silhouette agrees with the swatches beside it.
- A new kind is a new rule and a new path in one file. The file and `colour-parse.ts` exist twice, here and in `frontend-store-new/src/lib/`, because the two apps are separate packages: change both.
- The English and Indonesian words of the catalogue are mixed ("Skinny Ankle Denim", "Kemeja Flanel"), so a rule matches a word of the name, not its first.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `name` | `string` | The article's name, read for its kind and, without `colours`, for a colour |
| `division` | `string \| null` | For a name that says no kind: `WANITA`, `PRIA`, `TAS` and the rest |
| `colours` | `readonly string[]` | The colourway's paint; up to three are used |

Source: `frontend-hub/src/components/ui/garment.tsx` (drawn inside `thumbnail.tsx`); colours from `lib/colour-parse.ts` and `lib/colourway-fill.ts`.
