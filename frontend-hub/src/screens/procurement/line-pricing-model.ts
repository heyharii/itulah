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
  /// What this SKU looks like, already uploaded — optional (0961).
  readonly photos?: readonly string[]
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
///
/// Exported for the SKU grid in `setups.tsx`: a cell there takes a markup
/// exactly the way `PricingFields` does, and the rupiah it rounds to must be
/// the same rupiah either form of the same decision produces.
export function baseFrom(purchase: number, markup: number): number {
  return Math.round(purchase * (1 + markup / 100))
}

/// The markup a base price is over a purchase price, to one decimal place.
export function markupFrom(purchase: number, base: number): string {
  if (purchase <= 0) return ""
  return ((base / purchase - 1) * 100).toFixed(1).replace(/\.0$/, "")
}

/// Keep the three in step after one of them changed.
///
/// A new purchase price keeps the markup and moves the base price; a new
/// markup moves the base price; a new base price moves the markup. The field
/// being typed into is never rewritten under the caret.
export function syncPricing(
  was: Pricing,
  change: Partial<Pricing>,
  /// Pieces in the unit the purchase price is per (12 for a lusin); 1 when it
  /// is per piece. The base price is always per piece.
  perUnit: number = 1
): Pricing {
  const next = { ...was, ...change }
  const unitPrice = digits(next.purchase)
  if (unitPrice === null || unitPrice === 0) return next
  const purchase = unitPrice / perUnit
  if (change.base !== undefined) {
    const base = digits(next.base)
    return { ...next, markup: base === null ? "" : markupFrom(purchase, base) }
  }
  const markup = percent(next.markup)
  if (
    markup !== null &&
    (change.markup !== undefined || change.purchase !== undefined)
  )
    return { ...next, base: String(baseFrom(purchase, markup)) }
  if (change.purchase !== undefined) {
    const base = digits(next.base)
    return { ...next, markup: base === null ? "" : markupFrom(purchase, base) }
  }
  return next
}

/// What is wrong with what a line will sell for, or null.
///
/// Nothing is set up to sell at a loss, or at cost (the owner, 2026-09-28:
/// "base price ga bisa rugi, dan ga bisa sama juga"): a base price, and a
/// SKU's own price where it has one, must be above the purchase price. Only
/// what is filled in is judged — an empty base price is not a price.
export function sellingProblem(
  pricing: Pricing,
  variants: readonly VariantDraft[] = [],
  perUnit: number = 1
): string | null {
  const unitPrice = digits(pricing.purchase)
  if (unitPrice === null || unitPrice === 0) return null
  const purchase = unitPrice / perUnit
  const base = pricing.base.trim() === "" ? null : digits(pricing.base)
  if (base !== null && base < purchase)
    return "The base price is below the purchase price. It must be above it."
  if (base !== null && base === purchase)
    return "The base price is the same as the purchase price. It must be above it."
  const skuAtOrBelow = variants.some((one) => {
    const price = one.price.trim() === "" ? null : digits(one.price)
    return price !== null && price <= purchase
  })
  if (skuAtOrBelow) return "A SKU's own price must be above the purchase price."
  return null
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
  const colourAxis: (string | null)[] =
    colours.length > 0 ? [...colours] : [null]
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

/// The rows with a quantity, as the wire wants them. A SKU without photos of
/// its own wears the article's (owner, 2026-10-16: "ikut yg default article
/// dlu, tapi bisa diubah").
export function variantsForWire(
  variants: readonly VariantDraft[],
  articlePhoto: string | null = null
) {
  const fallback =
    articlePhoto !== null && /^(https?:)?\//.test(articlePhoto) ? [articlePhoto] : []
  return variants
    .filter((one) => (digits(one.quantity) ?? 0) > 0)
    .map((one) => ({
      colour_code: one.colour,
      size_code: one.size,
      quantity: digits(one.quantity) ?? 0,
      base_price_minor: digits(one.price),
      image_urls: (one.photos ?? []).length > 0 ? [...(one.photos ?? [])] : fallback,
    }))
}

// ---------------------------------------------------------------------------
// Purchase order money. One place, integers only.
//
// Quantity on a PO is always PIECES. A price is kept in the unit it was agreed
// in ("Rp 400.000 per lusin", whole rupiah) and that figure is the source of
// truth: a per-piece price is never derived, stored or shown. A line total is
// pieces × price ÷ pieces-in-the-unit, worked out with BigInt and rounded
// half-up ONCE, in whole rupiah — so 240 pcs at Rp 400.000 per lusin is
// exactly Rp 8.000.000, and one piece is Rp 33.333. A rounded unit price is
// never multiplied.
// ---------------------------------------------------------------------------

/// Integer division of non-negative numbers, rounded half up.
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n)
}

/// A decimal text ("12", "12,5", "0.25") as numerator over denominator, or
/// null when it is not a positive number.
function ratioOf(text: string): { num: bigint; den: bigint } | null {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(text.trim())
  if (match === null) return null
  const fraction = match[2] ?? ""
  const num = BigInt(match[1] + fraction)
  return num > 0n ? { num, den: 10n ** BigInt(fraction.length) } : null
}

/// What a line comes to, in whole rupiah.
///
/// `price` is per `perUnit` pieces — 12 for a price per lusin, "1" or null for
/// a price per piece. Rounded half up, once, here.
export function lineTotal(
  pieces: number,
  price: number,
  perUnit: string | number | null = null
): number {
  if (!Number.isFinite(pieces) || !Number.isFinite(price)) return 0
  if (pieces <= 0 || price <= 0) return 0
  const ratio = perUnit === null ? null : ratioOf(String(perUnit))
  const product = BigInt(Math.round(pieces)) * BigInt(Math.round(price))
  if (ratio === null) return Number(product)
  return Number(divideRounded(product * ratio.den, ratio.num))
}

/// A whole amount split in proportion to `weights`, to the rupiah, so the
/// shares add up to `total` exactly: each takes its floor, and the rupiah left
/// over go one each to the largest remainders (the earlier line on a tie).
///
/// A PO's discount is split by PIECES (owner, 2026-10-02): every piece takes
/// the same discount, so a line's share is the discount times its pieces over
/// the order's pieces. Pass each line's pieces as the weights.
export function shareOut(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, one) => acc + Math.max(0, one), 0)
  if (total <= 0 || sum <= 0) return weights.map(() => 0)
  const whole = BigInt(Math.round(total))
  const bigSum = BigInt(Math.round(sum))
  const shares = weights.map((weight) => {
    const exact = whole * BigInt(Math.max(0, Math.round(weight)))
    return { floor: exact / bigSum, rest: exact % bigSum }
  })
  let left = whole - shares.reduce((acc, one) => acc + one.floor, 0n) // < line count
  const order = shares
    .map((one, index) => ({ index, rest: one.rest }))
    .sort((a, b) =>
      a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1
    )
  const extra = new Array<number>(weights.length).fill(0)
  for (const one of order) {
    if (left <= 0n) break
    extra[one.index] = 1
    left -= 1n
  }
  return shares.map((one, index) => Number(one.floor) + extra[index])
}

/// A discount percentage as typed, in hundredths of a percent: "12,50" and
/// "12.5" are both 1250. More than two decimals are rounded to two; null for
/// anything that is not a number.
export function percentToBps(text: string): number | null {
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(text.trim())
  if (match === null) return null
  const fraction = (match[2] ?? "").padEnd(3, "0")
  const hundredths = BigInt(match[1] + fraction.slice(0, 2))
  const bps = fraction.charCodeAt(2) >= 53 ? hundredths + 1n : hundredths
  return Number(bps)
}

/// What a percentage box may hold: digits and one decimal comma, two digits
/// after it.
export function cleanPercent(text: string): string {
  const flat = text.replace(".", ",").replace(/[^\d,]/g, "")
  const at = flat.indexOf(",")
  if (at < 0) return flat
  return `${flat.slice(0, at)},${flat
    .slice(at + 1)
    .replace(/,/g, "")
    .slice(0, 2)}`
}

/// Hundredths of a percent as it is read: "12,50", "5", "0,25".
export function percentText(bps: number): string {
  const whole = Math.floor(bps / 100)
  const hundredths = bps % 100
  return hundredths === 0
    ? String(whole)
    : `${whole},${String(hundredths).padStart(2, "0")}`
}

/// The discount a percentage of the subtotal comes to, in whole rupiah,
/// rounded once.
export function discountFromPercent(subtotal: number, bps: number): number {
  if (subtotal <= 0 || bps <= 0) return 0
  return Number(
    divideRounded(BigInt(Math.round(subtotal)) * BigInt(bps), 10000n)
  )
}

/// The percentage a discount is of the subtotal, in hundredths of a percent.
export function percentFromDiscount(
  discount: number,
  subtotal: number
): number {
  if (subtotal <= 0 || discount <= 0) return 0
  return Number(
    divideRounded(BigInt(Math.round(discount)) * 10000n, BigInt(subtotal))
  )
}
