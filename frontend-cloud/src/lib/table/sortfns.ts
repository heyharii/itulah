import { sortFn_basic, type SortFn } from "@tanstack/react-table";

/**
 * Same reason as `AnyFilterFn` next door: `SortFn` is generic over
 * `TFeatures`/`TData`, both parameters are invariant (`in out`), and the
 * `sortFns` slot on `tableFeatures()` is typed `Record<string, SortFn<any,
 * any>>` — so `any` is the pair that fits. These comparators only ever touch
 * `row.getValue()`, so nothing is lost.
 */
type AnySortFn = SortFn<any, any>;

/// Orders a column whose value may be missing, counting a missing value as
/// larger than any present one
///
/// A comparator is written ascending and the sorted row model flips the sign
/// for descending, so this puts the missing values last when ascending and
/// first when descending. That is what a column such as the fleet's `behind_by`
/// wants: a shop that has never taken up a price book is not merely behind, it
/// is further behind than any number the server can send, so "furthest behind
/// first" has to show it above every shop that is only a few books behind.
///
/// Saying it here rather than in the accessor keeps the sorted value and the
/// displayed value the same one. An accessor that maps `null` to
/// `Number.POSITIVE_INFINITY` sorts correctly and then hands faceting, filters
/// and anything else reading `getValue()` a number no row actually holds.
///
/// `sortUndefined` is not this: it is only consulted for `undefined`, and a
/// column reading a nullable field off the wire holds `null`.
export const nullsLast: AnySortFn = (rowA, rowB, columnId) => {
  const a = rowA.getValue(columnId);
  const b = rowB.getValue(columnId);
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;

  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  /// Both sides are present, so this is an ordinary comparison — delegated
  /// rather than rewritten so a number column sorts the same whether or not it
  /// happens to have any missing values.
  return sortFn_basic(rowA, rowB, columnId);
};
