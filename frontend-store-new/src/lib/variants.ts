import type { CatalogRow } from "@itulah/contract"

import { findColour, readColour, readColours } from "@/lib/colour-parse"

/// An article's colours and sizes, read off its SKUs' names.
///
/// The catalogue carries one name per SKU — "Kemeja Oxford Light Blue M",
/// "Gamis Grey One Size" — and no separate colour or size. The size is the
/// tail of the name when it reads as one (`SIZE`); what is left is the
/// article's name followed by the colour. Where the SKUs of an article name
/// different colours, the colour is whatever they do not share; where they all
/// name the same one (an article in a single colour), it is the longest run of
/// words at the end that the colour master's reader takes for a colour.
///
/// The Catalogue's tiles and the product sheet's "Sizes and colours" both read
/// it from here, so a tile's swatches and the sheet's rows cannot disagree.

export interface ArticleColour {
  /// As the name says it: "Light Blue", "Off White". `null` when the name
  /// carries none.
  readonly label: string | null
  /// One paint for a plain colour, two or three for "Hitam/Putih".
  readonly paint: readonly string[]
  /// Its SKUs, in the order the book sent them.
  readonly skus: readonly CatalogRow[]
}

export interface ArticleShape {
  /// The article's own name — the words every colourway shares.
  readonly name: string
  readonly colours: readonly ArticleColour[]
  /// Smallest first; sizes the scale does not know keep the book's order.
  readonly sizes: readonly string[]
  /// Each SKU's colour and size.
  readonly variant: ReadonlyMap<
    string,
    { colour: string | null; size: string | null }
  >
}

/// The grey a garment is drawn in when its name names no colour.
export const NO_COLOUR = "#C9CCD1"

/// Letter sizes, one size, kids' ages and numbers, at the very end of a name.
const SIZE =
  /\s+((?:one|all|free)\s*size|allsize|freesize|fs|os|[2-6]xl|x{0,3}s|m|x{0,3}l|\d{1,2}-\d{1,2}\s*[ymt]?|\d{1,3}(?:[.,]5)?)$/i

const LETTERS = [
  "XXXS",
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "2XL",
  "XXXL",
  "3XL",
  "4XL",
  "5XL",
  "6XL",
]

function sizeRank(size: string): number {
  const upper = size.toUpperCase()
  const letter = LETTERS.indexOf(upper)
  if (letter >= 0) return letter
  const number = Number.parseFloat(upper.replace(",", "."))
  if (Number.isFinite(number)) return 100 + number
  return 10_000
}

/// Smallest first; sizes the scale does not know keep the order given.
export function sortSizes(sizes: readonly string[]): string[] {
  return sizes
    .map((size, at) => ({ size, at, rank: sizeRank(size) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map((one) => one.size)
}

function splitSize(name: string): { rest: string; size: string | null } {
  const found = SIZE.exec(name)
  if (found === null || found.index === 0)
    return { rest: name.trim(), size: null }
  const raw = found[1] ?? ""
  // "one size" and "One Size" are one size; a letter size is upper case.
  const size = /size/i.test(raw)
    ? raw.replace(/\s+/g, " ").replace(/\b[a-z]/g, (one) => one.toUpperCase())
    : raw.toUpperCase()
  return { rest: name.slice(0, found.index).trim(), size }
}

/// The longest run of words at the end of `words` that reads as a colour.
function trailingColour(words: readonly string[]): number {
  for (let take = Math.min(4, words.length - 1); take > 0; take--)
    if (readColour(words.slice(-take).join(" ")) !== null) return take
  return 0
}

/// What a colour label is painted with.
export function paintOf(label: string | null, name: string): string[] {
  if (label !== null) {
    const several = readColours(label)
    if (several.length > 0) return several.slice(0, 3).map((one) => one.hex)
    const one = findColour(label)
    if (one !== null) return [one.hex]
  }
  return [findColour(name)?.hex ?? NO_COLOUR]
}

/// CSS for a swatch: a fill, or a diagonal split for two or three colours.
export function swatchBackground(paint: readonly string[]): string {
  if (paint.length <= 1) return paint[0] ?? NO_COLOUR
  const stops = paint.flatMap((hex, at) => [
    `${hex} ${(at / paint.length) * 100}%`,
    `${hex} ${((at + 1) / paint.length) * 100}%`,
  ])
  return `linear-gradient(135deg, ${stops.join(", ")})`
}

export function shapeArticle(rows: readonly CatalogRow[]): ArticleShape {
  const parts = rows.map((row) => splitSize(row.name))
  const words = parts.map((part) => part.rest.split(/\s+/).filter(Boolean))

  // The words every SKU shares, from the front. Never all of a name: a
  // colourway always has a colour.
  let shared = 0
  const shortest = Math.min(...words.map((one) => one.length))
  while (
    shared < shortest &&
    words.every(
      (one) => one[shared]?.toLowerCase() === words[0]?.[shared]?.toLowerCase(),
    )
  )
    shared += 1

  let colourAt: number[]
  if (shared === shortest) {
    // One colour (or one SKU): the colour is what the reader finds at the end.
    const take = trailingColour(words[0] ?? [])
    colourAt = words.map((one) => one.length - take)
  } else {
    // "Kemeja Light Blue" and "Kemeja Light Grey" share "Light", and "Light"
    // is part of both colours. Hand shared words back while every SKU's
    // colour still reads as one with them.
    let from = shared
    while (
      from > 1 &&
      words.every((one) => readColour(one.slice(from - 1).join(" ")) !== null)
    )
      from -= 1
    colourAt = words.map(() => from)
  }

  const head = words[0] ?? []
  const name = head.slice(0, Math.max(1, colourAt[0] ?? head.length)).join(" ")

  const colours: { label: string | null; skus: CatalogRow[] }[] = []
  const sizes: string[] = []
  const variant = new Map<
    string,
    { colour: string | null; size: string | null }
  >()
  rows.forEach((row, index) => {
    const one = words[index] ?? []
    const joined = one.slice(colourAt[index]).join(" ")
    const label = joined === "" ? null : joined
    const size = parts[index]?.size ?? null
    variant.set(row.sku_code, { colour: label, size })
    const colour = colours.find(
      (each) =>
        (each.label ?? "").toLowerCase() === (label ?? "").toLowerCase(),
    )
    if (colour === undefined) colours.push({ label, skus: [row] })
    else colour.skus.push(row)
    if (size !== null && !sizes.includes(size)) sizes.push(size)
  })

  const ordered = sortSizes(sizes)

  return {
    name,
    colours: colours.map((one) => ({
      ...one,
      paint: paintOf(one.label, one.skus[0]?.name ?? ""),
    })),
    sizes: ordered,
    variant,
  }
}

/// Every article in the book, shaped once. Keyed by article code — or the SKU
/// code for a row that stands alone.
export function shapeBook(
  rows: readonly CatalogRow[],
): ReadonlyMap<string, ArticleShape> {
  const groups = new Map<string, CatalogRow[]>()
  for (const row of rows) {
    const key = row.article_code ?? row.sku_code
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [row])
    else group.push(row)
  }
  const shapes = new Map<string, ArticleShape>()
  for (const [key, group] of groups) shapes.set(key, shapeArticle(group))
  return shapes
}

/// Sizes as a tile says them: all of them when there are a few, the range
/// when there are many.
export function sizeLine(sizes: readonly string[]): string {
  if (sizes.length <= 4) return sizes.join(" · ")
  return `${sizes[0]}–${sizes[sizes.length - 1]}`
}
