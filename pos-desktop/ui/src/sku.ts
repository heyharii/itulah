/// A SKU as a person reads it (owner, 21 Oct 2026): the article's eight
/// digits, a middle dot, then colour + size — "00000004103" → "00000004·103".
/// Display only; the stored code, barcodes and searches keep eleven digits.
export function sku(code: string | null | undefined): string {
  if (code === null || code === undefined || code === "") return "—"
  return /^\d{11}$/.test(code) ? `${code.slice(0, 8)}·${code.slice(8)}` : code
}

/// The article id a line names: its `article_code` when the node sent one,
/// otherwise the first eight digits of an eleven-digit SKU.
export function articleId(
  articleCode: string | null | undefined,
  skuCode?: string | null,
): string {
  if (articleCode !== null && articleCode !== undefined && articleCode !== "")
    return articleCode
  return skuCode !== null && skuCode !== undefined && /^\d{11}$/.test(skuCode)
    ? skuCode.slice(0, 8)
    : "—"
}
