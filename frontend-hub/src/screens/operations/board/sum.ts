/// The total of one number over a list.
export function sum<T>(list: readonly T[], of: (item: T) => number): number {
  return list.reduce((total, item) => total + of(item), 0)
}
