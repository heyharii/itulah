import type { CatalogRow, SkuStockRow } from "@itulah/contract"

import { sku as skuText } from "@/lib/format"
import { shapeBook, swatchBackground } from "@/lib/variants"
import { matches, placeLabel, type PlaceCode } from "@/screens/stock/shared"

/// Stock's list, joined once: each article with its "Colour Size" rows and
/// what each holds in the shop's three places — from the price book (names)
/// and the node's per-SKU counts. The filters run over this in the browser,
/// as the Catalogue's do.

export type Pool = PlaceCode

export interface Counts {
  readonly floor: number
  readonly warehouse: number
  readonly reject: number
  /// To be returned's other two pockets (`{site}.to-return.over` / `.ho`).
  readonly over: number
  readonly ho: number
}

/// One of the figures a row carries: a place, or a pocket of To be returned.
export type Figure = keyof Counts

export interface StockSku extends Counts {
  readonly sku: string
  /// "Navy M".
  readonly label: string
  /// A swatch's CSS background.
  readonly paint: string
  /// Whether the price book holds a photograph of this SKU.
  readonly hasImage: boolean
}

export interface StockArticle {
  readonly key: string
  readonly name: string
  readonly division: string | null
  /// Every tag any SKU of the article carries.
  readonly tags: readonly string[]
  /// The SKU whose photograph stands for the article, when one has a photograph.
  readonly photoSku: string | null
  readonly skus: readonly StockSku[]
}

/// The node's rows carry the floor and the store room; a reject count rides
/// along when it says one. Absent, it is nought here and the KPI reads the
/// reject pool instead.
type Held = SkuStockRow & {
  readonly reject?: number
  readonly over_delivery?: number
  readonly return_ho?: number
}

export function articlesOf(
  rows: readonly CatalogRow[],
  held: ReadonlyMap<string, Held>,
): StockArticle[] {
  const division = new Map<string, string | null>()
  for (const row of rows)
    division.set(row.article_code ?? row.sku_code, row.division_code)
  const tagsOf = new Map<string, Set<string>>()
  const photoOf = new Map<string, string>()
  for (const row of rows) {
    const key = row.article_code ?? row.sku_code
    const tags = tagsOf.get(key) ?? new Set<string>()
    for (const tag of row.tags) tags.add(tag)
    tagsOf.set(key, tags)
    if (row.has_image && !photoOf.has(key)) photoOf.set(key, row.sku_code)
  }
  const out: StockArticle[] = []
  const listed = new Set(rows.map((row) => row.sku_code))
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
          hasImage: row.has_image,
          floor: has?.floor ?? 0,
          warehouse: has?.warehouse ?? 0,
          reject: has?.reject ?? 0,
          over: has?.over_delivery ?? 0,
          ho: has?.return_ho ?? 0,
        })
      }
    }
    out.push({
      key,
      name: shape.name,
      division: division.get(key) ?? null,
      tags: [...(tagsOf.get(key) ?? [])].sort(),
      photoSku: photoOf.get(key) ?? null,
      skus,
    })
  }
  // A SKU the node holds that the price book does not name still shows, by
  // its code, so no piece goes missing from the page.
  for (const [code, has] of held) {
    if (listed.has(code)) continue
    out.push({
      key: code,
      name: skuText(code),
      division: null,
      tags: [],
      photoSku: null,
      skus: [
        {
          sku: code,
          label: skuText(code),
          paint: swatchBackground([]),
          hasImage: false,
          floor: has.floor,
          warehouse: has.warehouse,
          reject: has.reject ?? 0,
          over: has.over_delivery ?? 0,
          ho: has.return_ho ?? 0,
        },
      ],
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/// The articles and rows that survive the search, the division and the tag;
/// only rows that hold something in the places on screen are listed, and an
/// article with no row left is dropped.
export function narrow(
  articles: readonly StockArticle[],
  needle: string,
  division: string,
  tag: string,
  pools: readonly Figure[],
): StockArticle[] {
  const out: StockArticle[] = []
  for (const article of articles) {
    if (division !== "" && article.division !== division) continue
    if (tag !== "" && !article.tags.includes(tag)) continue
    const skus = article.skus.filter(
      (one) =>
        pools.some((pool) => one[pool] > 0) &&
        matches(needle, `${article.name} ${one.label}`, article.key, one.sku),
    )
    if (skus.length > 0) out.push({ ...article, skus })
  }
  return out
}

export function sum(skus: readonly Counts[], pool: Figure): number {
  return skus.reduce((total, one) => total + one[pool], 0)
}

/// What a figure is called on a heading: a place's name, or a pocket's.
export function figureLabel(figure: Figure): string {
  switch (figure) {
    case "over":
      return "Over delivery"
    case "ho":
      return "Return HO"
    default:
      return placeLabel(figure)
  }
}
