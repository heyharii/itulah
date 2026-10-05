/// Temporary UI switches. Each one hides a surface without deleting it:
/// flip the constant and the screens come back, routes and code untouched.

/// The Missing concept (units counted as missing or lost). Owner decision,
/// 2 Oct 2026: not shown for now. Set to `true` to bring every surface back.
export const SHOW_MISSING = false

/// A column list without its Missing columns while `SHOW_MISSING` is off.
/// Matches by `accessorKey` or `id`, so a table keeps declaring the column and
/// the screen drops it at the one place it builds its columns.
export function withoutMissing<T>(columns: readonly T[]): T[] {
  if (SHOW_MISSING) return [...columns]
  const gone = new Set(["missing", "missing_qty"])
  return columns.filter((column) => {
    const { accessorKey, id } = column as {
      accessorKey?: unknown
      id?: unknown
    }
    return !gone.has(String(accessorKey ?? id ?? ""))
  })
}
