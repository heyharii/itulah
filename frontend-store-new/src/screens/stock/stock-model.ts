import type { CatalogRow, SkuStockRow } from "@itulah/contract"

import { shapeBook, swatchBackground } from "@/lib/variants"
import { matches, type PlaceCode } from "@/screens/stock/shared"

/// Stock's list, joined once: each article with its "Colour Size" rows and
/// what each holds in the shop's three places — from the price book (names)
/// and the node's per-SKU counts. The filters run over this in the browser,
/// as the Catalogue's do.

export type Pool = PlaceCode

export interface Counts {
  readonly floor: number
  readonly warehouse: number
  readonly reject: number
}

export interface StockSku extends Counts {
  readonly sku: string
  /// "Navy M".
  readonly label: string
  /// A swatch's CSS background.
  readonly paint: string
}

export interface StockArticle {
  readonly key: string
  readonly name: string
  readonly division: string | null
  readonly skus: readonly StockSku[]
}

/// The node's rows carry the floor and the store room; a reject count rides
/// along when it says one. Absent, it is nought here and the KPI reads the
/// reject pool instead.
type Held = SkuStockRow & { readonly reject?: number }

export function articlesOf(
  rows: readonly CatalogRow[],
  held: ReadonlyMap<string, Held>,
): StockArticle[] {
  const division = new Map<string, string | null>()
  for (const row of rows)
    division.set(row.article_code ?? row.sku_code, row.division_code)
  const out: StockArticle[] = []
  for (const [key, shape] of shapeBook(rows)) {
    const skus: StockSku[] = []
    for (const colour of shape.colours) {
      const ordered = [...colour.skus].sort(
        (a, b) =>
          shape.sizes.indexOf(shape.variant.get(a.sku_code)?.size ?? "") -
          shape.sizes.indexOf(shape.variant.get(b.sku_code)?.size ?? ""),
      )
      for (const row of ordered) {
        const has = held.get(row.sku_code)
        const size = shape.variant.get(row.sku_code)?.size
        skus.push({
          sku: row.sku_code,
          label: [colour.label, size].filter(Boolean).join(" ") || row.name,
          paint: swatchBackground(colour.paint),
          floor: has?.floor ?? 0,
          warehouse: has?.warehouse ?? 0,
          reject: has?.reject ?? 0,
        })
      }
    }
    out.push({
      key,
      name: shape.name,
      division: division.get(key) ?? null,
      skus,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export const SHOWS = [
  ["stock", "In stock"],
  ["all", "Everything"],
  ["gap", "Not on the sales floor"],
  ["reject", "Has reject"],
] as const

export type Show = (typeof SHOWS)[number][0]

export function held(sku: Counts, show: Show): boolean {
  switch (show) {
    case "stock":
      return sku.floor + sku.warehouse + sku.reject > 0
    case "gap":
      return sku.floor === 0 && sku.warehouse > 0
    case "reject":
      return sku.reject > 0
    case "all":
      return true
  }
}

/// The articles and rows that survive the search, the division and the show;
/// an article with no row left is dropped.
export function narrow(
  articles: readonly StockArticle[],
  needle: string,
  division: string,
  show: Show,
): StockArticle[] {
  const out: StockArticle[] = []
  for (const article of articles) {
    if (division !== "" && article.division !== division) continue
    const skus = article.skus.filter(
      (one) =>
        held(one, show) &&
        matches(
          needle,
          `${article.name} ${one.label}`,
          article.key,
          one.sku,
        ),
    )
    if (skus.length > 0) out.push({ ...article, skus })
  }
  return out
}

export function sum(skus: readonly Counts[], pool: Pool): number {
  return skus.reduce((total, one) => total + one[pool], 0)
}
