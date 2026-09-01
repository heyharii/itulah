import { node } from "@/lib/api"

/// A product a price book can name.
///
/// `unit_price_minor` is what the newest published book charges for it at
/// company level, or `null` when no book has ever named it. Null rather than
/// zero, because "we have never priced this" and "this is free" are different
/// facts and only one of them is a price.
export interface CommercialProduct {
  readonly sku_id: string
  readonly sku_code: string
  readonly color: string | null
  readonly size: string | null
  readonly article_code: string
  readonly article_name: string
  readonly division_code: string | null
  readonly image_url: string | null
  readonly unit_price_minor: number | null
}

export const productsKey = (query: string) =>
  ["commercial", "products", query] as const

export function searchProducts(
  query: string,
  signal?: AbortSignal,
): Promise<CommercialProduct[]> {
  const search = new URLSearchParams({ limit: "40" })
  if (query.trim() !== "") search.set("q", query.trim())
  return node
    .get<{ items: CommercialProduct[] }>(
      `/api/v1/commercial/products?${search.toString()}`,
      { signal },
    )
    .then((body) => body.items)
}
