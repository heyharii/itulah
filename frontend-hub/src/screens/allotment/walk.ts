/// The ticks of the Unallotted tab, and the walk New allotment makes through
/// them: one supplier's grid at a time, Next and Previous between them (the
/// owner, 2 Oct 2026). An allotment is still only ever one supplier's goods.
///
/// In the address as `?supplier=<current>&articles=<ids>` for the supplier on
/// screen, `queue=<supplier>:<id,id>;…` for the ones after it and
/// `before=…` for the ones already walked past, so a reload lands on the same
/// step. Kept out of the screens because they are not components.

/// One supplier's ticked articles.
export interface SupplierPick {
  readonly supplier: string
  readonly articles: readonly string[]
}

/// `queue` or `before` read back. Anything malformed is dropped rather than
/// guessed at; the print queue's `true` reads as no suppliers at all.
export function parseWalk(value: unknown): SupplierPick[] {
  if (typeof value !== "string" || value === "") return []
  return value.split(";").flatMap((segment) => {
    // A supplier id never carries a colon, so the first one is the split.
    const at = segment.indexOf(":")
    if (at <= 0) return []
    const articles = segment
      .slice(at + 1)
      .split(",")
      .filter(Boolean)
    return articles.length === 0
      ? []
      : [{ supplier: segment.slice(0, at), articles }]
  })
}

/// Picks as one `queue`/`before` value, or nothing when there are none.
export function walkValue(picks: readonly SupplierPick[]): string | undefined {
  const value = picks
    .filter((one) => one.articles.length > 0)
    .map((one) => `${one.supplier}:${one.articles.join(",")}`)
    .join(";")
  return value === "" ? undefined : value
}

/// The search of one step: `current` on screen, the rest either side.
export function walkSearch(
  before: readonly SupplierPick[],
  current: SupplierPick | undefined,
  queue: readonly SupplierPick[]
) {
  return {
    supplier: current?.supplier,
    articles: current?.articles.join(","),
    queue: walkValue(queue),
    before: walkValue(before),
  }
}
