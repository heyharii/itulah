/// One line of a purchase return, drawn the way it can honestly be named.
///
/// A return line is a receipt line's excess, and part of that excess may be
/// pieces that were never the article the order named (0829): nobody knows what
/// they are. Naming the article against them — with its photograph, its SKU and
/// a price — reads as if that item went back. So the part that is the article
/// keeps its name, and the part that is not stands on its own line with no
/// article at all.
export const NOT_AS_ORDERED = "Not As Ordered"

export interface ReturnLinePart {
  /// Unique within a return: the article's code, or that code marked wrong.
  readonly sku: string
  readonly name: string
  readonly qty: number
  /// Pieces nobody can name.
  readonly unknown: boolean
}

export function returnLineParts(line: {
  readonly article_code: string
  readonly article_name: string
  readonly quantity: number
  readonly wrong_quantity?: number
}): ReturnLinePart[] {
  const wrong = Math.min(Math.max(line.wrong_quantity ?? 0, 0), line.quantity)
  const parts: ReturnLinePart[] = []
  if (line.quantity - wrong > 0)
    parts.push({
      sku: line.article_code,
      name: line.article_name,
      qty: line.quantity - wrong,
      unknown: false,
    })
  if (wrong > 0)
    parts.push({
      sku: `${line.article_code}~wrong`,
      name: NOT_AS_ORDERED,
      qty: wrong,
      unknown: true,
    })
  return parts
}
