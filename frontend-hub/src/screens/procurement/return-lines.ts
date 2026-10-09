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

/// How the unnamed pieces are written on the delivery note and in the sheet:
/// one row for all of them, wherever they came from, on two lines exactly as
/// the owner drew it (sketch, 2026-10-08): "Not as Ordered" and under it
/// "Item Unknown".
export const NOT_AS_ORDERED_ROW = {
  title: "Not as Ordered",
  sub: "Item Unknown",
} as const

export interface FoldedLine {
  /// The article's code; unique among the items.
  readonly sku: string
  /// The item as the order names it, with no tags.
  readonly name: string
  readonly qty: number
  /// What these pieces were bought at, in minor units; 0 where nothing is owed.
  readonly value: number
}

export interface FoldedLines {
  readonly items: readonly FoldedLine[]
  /// Pieces nobody can name, across every return; 0 draws no row.
  readonly unknown: number
  /// Items and the unnamed pieces together.
  readonly total: number
  /// What the items are worth; the unnamed pieces have no price.
  readonly value: number
}

/// Return lines as the delivery note lists them: one row per item as the order
/// names it — quantities of the same article from different returns added — and
/// one row for the pieces that are not the order's article. Shared by the
/// printed note, the PDF and the sheet, so the three cannot disagree.
export function foldLines(
  lines: readonly {
    readonly sku: string
    readonly name: string | null
    readonly qty: number
    readonly cost?: number
    readonly unknown?: boolean
  }[]
): FoldedLines {
  const items = new Map<string, FoldedLine>()
  let unknown = 0
  for (const line of lines) {
    if (line.unknown === true) {
      unknown += line.qty
      continue
    }
    const before = items.get(line.sku)
    items.set(line.sku, {
      sku: line.sku,
      name: before?.name ?? line.name ?? line.sku,
      qty: (before?.qty ?? 0) + line.qty,
      value: (before?.value ?? 0) + (line.cost ?? 0) * line.qty,
    })
  }
  const list = [...items.values()]
  return {
    items: list,
    unknown,
    total: list.reduce((sum, one) => sum + one.qty, 0) + unknown,
    value: list.reduce((sum, one) => sum + one.value, 0),
  }
}
