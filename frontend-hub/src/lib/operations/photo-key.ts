import type { Identity } from "@/lib/operations/catalogue"

/// Which picture a SKU shows (owner, 16 Oct 2026): one per ARTICLE, unless
/// that article's colours carry photographs of their own — then one per
/// colour. Decided over the SKUs at hand, so a card and a sheet showing the
/// same lines agree.
export function photoKeyOf(
  skus: readonly string[],
  catalogue: ReadonlyMap<string, Identity>
): (sku: string) => string {
  const urls = new Map<string, Set<string>>()
  for (const sku of skus) {
    const identity = catalogue.get(sku)
    if (identity?.image_url == null) continue
    const set = urls.get(identity.article_code) ?? new Set<string>()
    set.add(identity.image_url)
    urls.set(identity.article_code, set)
  }
  return (sku) => {
    const identity = catalogue.get(sku)
    if (identity === undefined) return sku
    return (urls.get(identity.article_code)?.size ?? 0) > 1
      ? `${identity.article_code}~${identity.colour ?? ""}`
      : identity.article_code
  }
}

/// Whether this article's colours carry photographs of their own.
export function photoPerColour(
  skus: readonly string[],
  catalogue: ReadonlyMap<string, Identity>
): boolean {
  const key = photoKeyOf(skus, catalogue)
  return new Set(skus.map(key)).size > 1
}
