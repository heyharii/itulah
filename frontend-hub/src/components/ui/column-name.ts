/// A column's name where it stands alone — a menu, a card. A column under a
/// group heading says "Qty" in the table, where "Ordered" stands above it, and
/// "Ordered qty" everywhere else.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function columnName(column: any): string {
  const own = column.columnDef.header
  const name = typeof own === "string" ? own : column.id
  const group = column.parent?.columnDef?.header
  return typeof group === "string" && group !== ""
    ? `${group} ${name.charAt(0).toLowerCase()}${name.slice(1)}`
    : name
}
