/// One delivery line set up as several articles — the owner's word of
/// 2026-10-02. An article with too many variants for one article is split
/// into siblings: the same name, division, tags and base price, each with its
/// own code and its own colour x size SKUs. No parent article; N peers. The
/// form's header is shared, and each tab holds only its own grid.
///
/// One tab is today's form exactly; nothing here shows until a second exists.
export interface ArticleTab {
  /// Stable across reordering and removal, for React keys only.
  readonly id: number
  /// Colour CODES, in the order they were picked — the order is the digit.
  readonly colours: readonly string[]
  readonly sizes: readonly string[]
  /// Keyed `colour|size` by code, as the grid is.
  readonly pieces: Record<string, string>
  /// A SKU's own price, only where it is not the base price.
  readonly ownPrice: Record<string, number>
}

/// One per letter: the tabs are named by them.
export const MAX_ARTICLE_TABS = 26

export function tabLabel(index: number): string {
  return `Article ${String.fromCharCode(65 + index)}`
}

/// A colour x size of one tab with at least one piece in it — exactly the
/// SKUs that tab will create.
export interface FilledCell {
  readonly colour: string
  readonly size: string
  readonly quantity: number
}

/// `sizeOrder` is the size master's codes in its own order, which is the
/// grid's column order too.
export function filledCells(
  tab: ArticleTab,
  sizeOrder: readonly string[]
): FilledCell[] {
  const sizes = sizeOrder.filter((code) => tab.sizes.includes(code))
  return tab.colours.flatMap((colour) =>
    sizes
      .map((size) => ({
        colour,
        size,
        quantity: Number(tab.pieces[`${colour}|${size}`]) || 0,
      }))
      .filter((cell) => cell.quantity > 0)
  )
}

export function piecesIn(tab: ArticleTab, sizeOrder: readonly string[]) {
  return filledCells(tab, sizeOrder).reduce(
    (sum, cell) => sum + cell.quantity,
    0
  )
}

/// A colour x size counted into more than one tab. The owner's rule: the same
/// garment is one SKU of one article.
export interface Clash {
  readonly colour: string
  readonly size: string
  /// Tab positions, in order.
  readonly tabs: readonly number[]
}

export function findClashes(
  tabs: readonly ArticleTab[],
  sizeOrder: readonly string[]
): Clash[] {
  const seen = new Map<string, Clash>()
  tabs.forEach((tab, index) => {
    for (const cell of filledCells(tab, sizeOrder)) {
      const key = `${cell.colour}|${cell.size}`
      const was = seen.get(key)
      seen.set(key, {
        colour: cell.colour,
        size: cell.size,
        tabs: [...(was?.tabs ?? []), index],
      })
    }
  })
  return [...seen.values()].filter((clash) => clash.tabs.length > 1)
}

export type SplitMode =
  | { readonly by: "colour" }
  | { readonly by: "size" }
  | { readonly by: "count"; readonly n: number }

function groupCells(
  cells: readonly FilledCell[],
  mode: SplitMode,
  sizeOrder: readonly string[]
): FilledCell[][] {
  if (mode.by === "count") {
    if (mode.n < 1) return []
    const groups: FilledCell[][] = []
    for (let at = 0; at < cells.length; at += mode.n)
      groups.push(cells.slice(at, at + mode.n))
    return groups
  }
  // Colours in the order the tab has them; sizes in the master's order.
  const keys =
    mode.by === "colour"
      ? [...new Set(cells.map((cell) => cell.colour))]
      : sizeOrder.filter((size) => cells.some((cell) => cell.size === size))
  return keys.map((key) =>
    cells.filter(
      (cell) => (mode.by === "colour" ? cell.colour : cell.size) === key
    )
  )
}

/// How many articles a split of this tab would make.
export function splitCount(
  tab: ArticleTab,
  mode: SplitMode,
  sizeOrder: readonly string[]
): number {
  return groupCells(filledCells(tab, sizeOrder), mode, sizeOrder).length
}

/// The tab's counted variants MOVED into several tabs, for the person to
/// review. The first keeps the tab's place and id; the rest follow it. `null`
/// when it would make fewer than two.
export function splitTab(
  tab: ArticleTab,
  mode: SplitMode,
  sizeOrder: readonly string[],
  nextId: () => number
): ArticleTab[] | null {
  const groups = groupCells(filledCells(tab, sizeOrder), mode, sizeOrder)
  if (groups.length < 2) return null
  return groups.map((group, index) => {
    const pieces: Record<string, string> = {}
    const ownPrice: Record<string, number> = {}
    for (const cell of group) {
      const key = `${cell.colour}|${cell.size}`
      pieces[key] = String(cell.quantity)
      const own = tab.ownPrice[key]
      if (own !== undefined) ownPrice[key] = own
    }
    return {
      id: index === 0 ? tab.id : nextId(),
      colours: tab.colours.filter((colour) =>
        group.some((cell) => cell.colour === colour)
      ),
      sizes: sizeOrder.filter((size) =>
        group.some((cell) => cell.size === size)
      ),
      pieces,
      ownPrice,
    }
  })
}
