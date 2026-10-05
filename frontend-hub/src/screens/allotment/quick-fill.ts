/// Quick fill — the arithmetic behind the grid's bulk helpers, kept out of
/// the component so it can be read (and checked) on its own.
///
/// Every function here returns a PATCH: `cellKey → quantity`, where `0` means
/// "empty this cell". A fill rewrites a SKU's whole row — the stores it gives
/// to get their share, every other store of the row is emptied — so a row
/// never ends up holding more than its free stock, whatever was typed before.
///
/// # Expected results
///
/// `evenSplit(free, stores, offset)` — whole pieces, the remainder one each to
/// the stores from `offset` on, wrapping round:
///
/// | free | stores      | offset | result                 |
/// | ---- | ----------- | ------ | ---------------------- |
/// | 10   | A B C       | 0      | A 4 · B 3 · C 3        |
/// | 10   | A B C       | 1      | A 3 · B 4 · C 3        |
/// | 11   | A B C       | 2      | A 4 · B 3 · C 4        |
/// | 2    | A B C D     | 3      | A 1 · B 0 · C 0 · D 1  |
/// | 9    | A B C       | any    | A 3 · B 3 · C 3        |
/// | 7    | A           | any    | A 7                    |
/// | 0    | A B         | 0      | A 0 · B 0              |
/// | 5    | (none)      | 0      | {} — nowhere to put it |
/// | -3, NaN, Infinity | A B | 0 | A 0 · B 0              |
/// | 4.9  | A B         | 0      | A 2 · B 2 (floored)    |
/// | 2^53-1 | A B       | 0      | A 2^52 · B 2^52-1      |
///
/// `fillEven(rows, columns, chosen)` — row i (counting only rows with free
/// stock) starts its remainder at chosen store `i mod N`, so the odd pieces
/// walk across the stores instead of piling onto the first one. Rows with
/// nothing free are left out of the patch entirely.
///
/// `fillAllToOne(rows, columns, target)` — the target gets the row's free
/// stock, the other columns 0. A target that is not a column changes nothing.

/// One cell's key. NUL because a SKU id is a UUID and a destination id is a
/// site id — neither can contain one, so no two cells can collide.
export function cellKey(skuId: string, destinationId: string): string {
  return `${skuId}\u0000${destinationId}`
}

/// A SKU row as a fill sees it: which SKU, and how many pieces are free.
export interface FillRow {
  readonly skuId: string
  readonly free: number
}

/// `cellKey → quantity`; `0` empties the cell.
export type Patch = Record<string, number>

/// What can actually be handed out: a whole, finite, non-negative number.
function wholeOf(free: number): number {
  return Number.isFinite(free) && free > 0 ? Math.floor(free) : 0
}

/// `free` split over `storeIds` in whole pieces. The remainder goes one piece
/// each to the stores starting at `offset` (wrapping), so callers can rotate
/// who gets the odd pieces. No stores → an empty record.
export function evenSplit(
  free: number,
  storeIds: readonly string[],
  offset: number
): Record<string, number> {
  const n = storeIds.length
  const result: Record<string, number> = {}
  if (n === 0) return result
  const whole = wholeOf(free)
  const base = Math.floor(whole / n)
  const extra = whole % n
  const start = Number.isFinite(offset) ? ((Math.floor(offset) % n) + n) % n : 0
  storeIds.forEach((id, at) => {
    // How far this store is past the start, going round.
    const distance = (at - start + n) % n
    result[id] = base + (distance < extra ? 1 : 0)
  })
  return result
}

/// Every row's free stock into one store; the rest of each row emptied.
export function fillAllToOne(
  rows: readonly FillRow[],
  columns: readonly string[],
  target: string
): Patch {
  const patch: Patch = {}
  if (!columns.includes(target)) return patch
  for (const row of rows) {
    const free = wholeOf(row.free)
    if (free === 0) continue
    for (const column of columns)
      patch[cellKey(row.skuId, column)] = column === target ? free : 0
  }
  return patch
}

/// Every row split evenly over `chosen` (all of `columns` when omitted), in
/// column order, rotated per row; the stores not chosen are emptied.
export function fillEven(
  rows: readonly FillRow[],
  columns: readonly string[],
  chosen: readonly string[] = columns
): Patch {
  const patch: Patch = {}
  const picked = new Set(chosen)
  const stores = columns.filter((column) => picked.has(column))
  if (stores.length === 0) return patch
  let index = 0
  for (const row of rows) {
    const free = wholeOf(row.free)
    if (free === 0) continue
    const split = evenSplit(free, stores, index)
    index += 1
    for (const column of columns)
      patch[cellKey(row.skuId, column)] = split[column] ?? 0
  }
  return patch
}

/// The cells with the patch laid over them. Zeroes are deleted, the same as
/// a box somebody empties, so the draft holds only typed numbers.
export function applyPatch(
  cells: Readonly<Record<string, number>>,
  patch: Readonly<Patch>
): Record<string, number> {
  const next = { ...cells }
  for (const [key, quantity] of Object.entries(patch)) {
    if (quantity > 0) next[key] = quantity
    else delete next[key]
  }
  return next
}

/// The patch that puts back what `patch` is about to overwrite.
export function undoOf(
  cells: Readonly<Record<string, number>>,
  patch: Readonly<Patch>
): Patch {
  const undo: Patch = {}
  for (const key of Object.keys(patch)) undo[key] = cells[key] ?? 0
  return undo
}

/// How many SKUs a patch gives to, and how many pieces in all.
export function patchTotals(patch: Readonly<Patch>): {
  skus: number
  pieces: number
} {
  const skus = new Set<string>()
  let pieces = 0
  for (const [key, quantity] of Object.entries(patch)) {
    if (quantity <= 0) continue
    skus.add(key.split("\u0000")[0])
    pieces += quantity
  }
  return { skus: skus.size, pieces }
}
