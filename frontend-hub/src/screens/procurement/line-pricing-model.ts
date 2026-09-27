/// What a line sells for, and in which SKUs — the arithmetic behind
/// `line-pricing.tsx`, kept apart so that file exports only components.

/// The pricing as the form holds it: rupiah as digit strings, markup as a
/// percentage string. Strings because a half-typed number is a state a person
/// passes through.
export interface Pricing {
  readonly purchase: string
  readonly markup: string
  readonly base: string
}

/// One SKU's row: its colour and size, how many, and its own price when it
/// is not the base price ("" means the base price).
export interface VariantDraft {
  readonly colour: string | null
  readonly size: string | null
  readonly quantity: string
  readonly price: string
}

export function digits(text: string): number | null {
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function percent(text: string): number | null {
  const parsed = Number(text.replace(",", "."))
  return text.trim() !== "" && Number.isFinite(parsed) ? parsed : null
}

/// The base price a markup gives over a purchase price, in whole rupiah.
function baseFrom(purchase: number, markup: number): number {
  return Math.round(purchase * (1 + markup / 100))
}

/// The markup a base price is over a purchase price, to one decimal place.
function markupFrom(purchase: number, base: number): string {
  if (purchase <= 0) return ""
  return ((base / purchase - 1) * 100).toFixed(1).replace(/\.0$/, "")
}

/// Keep the three in step after one of them changed.
///
/// A new purchase price keeps the markup and moves the base price; a new
/// markup moves the base price; a new base price moves the markup. The field
/// being typed into is never rewritten under the caret.
export function syncPricing(was: Pricing, change: Partial<Pricing>): Pricing {
  const next = { ...was, ...change }
  const purchase = digits(next.purchase)
  if (purchase === null || purchase === 0) return next
  if (change.base !== undefined) {
    const base = digits(next.base)
    return { ...next, markup: base === null ? "" : markupFrom(purchase, base) }
  }
  const markup = percent(next.markup)
  if (markup !== null && (change.markup !== undefined || change.purchase !== undefined))
    return { ...next, base: String(baseFrom(purchase, markup)) }
  if (change.purchase !== undefined) {
    const base = digits(next.base)
    return { ...next, markup: base === null ? "" : markupFrom(purchase, base) }
  }
  return next
}

/// Markup in basis points for the wire: 35.5% is 3550.
export function markupBps(markup: string): number | null {
  const parsed = percent(markup)
  return parsed === null ? null : Math.round(parsed * 100)
}

/// Every SKU the chosen colours and sizes make, keeping what was typed for
/// the ones that were already there.
export function variantRows(
  colours: readonly string[],
  sizes: readonly string[],
  was: readonly VariantDraft[]
): VariantDraft[] {
  const colourAxis: (string | null)[] = colours.length > 0 ? [...colours] : [null]
  const sizeAxis: (string | null)[] = sizes.length > 0 ? [...sizes] : [null]
  if (colours.length === 0 && sizes.length === 0) return []
  const rows: VariantDraft[] = []
  for (const colour of colourAxis)
    for (const size of sizeAxis) {
      const kept = was.find((one) => one.colour === colour && one.size === size)
      rows.push(kept ?? { colour, size, quantity: "", price: "" })
    }
  return rows
}

/// Pieces across every SKU.
export function variantPieces(variants: readonly VariantDraft[]): number {
  return variants.reduce((sum, one) => sum + (digits(one.quantity) ?? 0), 0)
}

/// The rows with a quantity, as the wire wants them.
export function variantsForWire(variants: readonly VariantDraft[]) {
  return variants
    .filter((one) => (digits(one.quantity) ?? 0) > 0)
    .map((one) => ({
      colour_code: one.colour,
      size_code: one.size,
      quantity: digits(one.quantity) ?? 0,
      base_price_minor: digits(one.price),
    }))
}

