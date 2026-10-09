import type { ArticleDetail, ArticleSku } from "@/lib/queries/articles"

/// The article's variants as a grid: colour down, size across.
///
/// Axes from the article first — its colourways in digit order, its sizes in
/// the size master's order — then from the SKUs themselves, so a SKU minted
/// without a colour or a size still has a row and a column to stand in.

export interface GridColour {
  /// The colour digit, or `none` for SKUs that predate colours.
  readonly key: string
  readonly digit: string | null
  readonly label: string
  readonly hex: string | null
}

export interface GridSize {
  readonly code: string
  readonly label: string
}

export interface Grid {
  readonly colours: readonly GridColour[]
  readonly sizes: readonly GridSize[]
  readonly sku: (colour: string, size: string) => ArticleSku | undefined
  readonly rowTotal: (colour: string) => number
  readonly columnTotal: (size: string) => number
  readonly total: number
}

const colourKey = (sku: ArticleSku) => sku.colour_digit ?? "none"
const sizeKey = (sku: ArticleSku) => sku.size_code ?? "none"

export function gridOf(article: ArticleDetail): Grid {
  const colours: GridColour[] = article.colours.map((way) => ({
    key: way.colour_digit,
    digit: way.colour_digit,
    label: way.label,
    hex: way.hex_code,
  }))
  const sizes: GridSize[] = []
  const labelOf = new Map<string, string>()

  for (const sku of article.skus) {
    if (!colours.some((one) => one.key === colourKey(sku)))
      colours.push({
        key: colourKey(sku),
        digit: sku.colour_digit,
        label: sku.colour_label ?? sku.colour_code ?? "No colour",
        hex: null,
      })
    labelOf.set(sizeKey(sku), sku.size_label ?? sku.size_code ?? "One size")
  }
  for (const code of article.size_codes)
    sizes.push({ code, label: labelOf.get(code) ?? code })
  for (const sku of article.skus)
    if (!sizes.some((one) => one.code === sizeKey(sku)))
      sizes.push({ code: sizeKey(sku), label: labelOf.get(sizeKey(sku)) ?? "" })

  const at = new Map(
    article.skus.map((sku) => [`${colourKey(sku)}|${sizeKey(sku)}`, sku])
  )
  const sku = (colour: string, size: string) => at.get(`${colour}|${size}`)
  const qty = (colour: string, size: string) => sku(colour, size)?.stock_qty ?? 0

  return {
    colours,
    sizes,
    sku,
    rowTotal: (colour) =>
      sizes.reduce((sum, size) => sum + qty(colour, size.code), 0),
    columnTotal: (size) =>
      colours.reduce((sum, colour) => sum + qty(colour.key, size), 0),
    total: article.skus.reduce((sum, one) => sum + one.stock_qty, 0),
  }
}

/// The article's one purchase price, or none.
///
/// One article comes from one supplier, so its supplier item is the cost. Two
/// suppliers at two prices is not a cost but a question this sheet cannot
/// answer, so it says nothing.
export function purchaseOf(article: ArticleDetail): {
  readonly cost: number
  readonly supplierId: string
  readonly supplier: string
} | null {
  const offers = article.supplier_items.filter(
    (offer) => offer.unit_price_minor !== null
  )
  const prices = new Set(offers.map((offer) => offer.unit_price_minor))
  if (offers.length === 0 || prices.size !== 1) return null
  const [offer] = offers
  return {
    cost: offer.unit_price_minor as number,
    supplierId: offer.supplier_id,
    supplier: offer.supplier_name,
  }
}
