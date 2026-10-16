import type { ExplorerFigures } from "@itulah/contract"

import type { ExportCell, ExportColumn, ExportSheet } from "@/lib/export-xlsx"
import type { ExplorerRow, SalesExplorer } from "@/screens/sales/explorer-data"
import {
  groupLabel,
  marginOf,
  nameParts,
  noStock,
  perReceipt,
  receiptsOf,
  shareOf,
  type GroupKey,
  type MatrixColumn,
  type ViewMode,
} from "@/screens/sales/explorer-model"

/// The rows on screen as a spreadsheet: what the person is looking at, in the
/// same order, with the totals at the foot. A percent is a fraction in a sheet
/// (0,125 is 12,5%), so the shares and margins are divided by a hundred here.

const fraction = (value: number | null) => (value === null ? null : value / 100)

export function exportSheet({
  head,
  rows,
  group,
  view,
  columns,
  canCost,
  subtitle,
  filename,
}: {
  head: SalesExplorer
  rows: readonly ExplorerRow[]
  group: GroupKey
  view: ViewMode
  /// The stores or the months on screen beside the rows.
  columns: readonly MatrixColumn[]
  canCost: boolean
  subtitle: string
  filename: string
}): ExportSheet {
  const label = groupLabel(group)
  const coded = group === "article" || group === "sku"
  const pay = group === "payment"
  const stock = !noStock(group)
  const laidOut = view !== "totals"
  // A month holds no stock: per month a column is its sales.
  const cellStock = stock && view === "stores"
  const storeTotals = new Map(
    head.store_totals.map((cell) => [cell.site_id, cell.figures])
  )

  const named: ExportColumn[] = [
    ...(coded ? [{ header: "Code", kind: "text" as const, width: 16 }] : []),
    { header: label, kind: "text", width: 30 },
    { header: "Detail", kind: "text", width: 22 },
  ]
  const figures: ExportColumn[] = pay
    ? [
        { header: "Transactions", kind: "number" },
        { header: "Collected", kind: "money" },
        { header: "Per transaction", kind: "money" },
        { header: "Share", kind: "percent" },
      ]
    : [
        { header: "Sales", kind: "money" },
        { header: "Pieces", kind: "number" },
        { header: "Discount", kind: "money" },
        ...(canCost
          ? [
              { header: "Gross profit", kind: "money" as const },
              { header: "Margin %", kind: "percent" as const },
            ]
          : []),
        ...(stock
          ? [
              { header: "Stock", kind: "number" as const },
              ...(canCost
                ? [{ header: "Stock value", kind: "money" as const }]
                : []),
            ]
          : []),
        { header: "Share", kind: "percent" },
      ]
  const stores: ExportColumn[] = laidOut
    ? columns.flatMap((column) => {
        const name = view === "months" ? column.title : column.head
        return [
          ...(cellStock
            ? [
                { header: `${name} Stock`, kind: "number" as const },
                ...(canCost
                  ? [
                      {
                        header: `${name} Stock value`,
                        kind: "money" as const,
                      },
                    ]
                  : []),
              ]
            : []),
          { header: `${name} Sales`, kind: "money" as const },
          pay
            ? { header: `${name} Transactions`, kind: "number" as const }
            : { header: `${name} Pieces`, kind: "number" as const },
        ]
      })
    : []

  const figuresOf = (f: ExplorerFigures): ExportCell[] =>
    pay
      ? [
          receiptsOf(f),
          f.sales_minor,
          perReceipt(f),
          fraction(shareOf(f, head.total)),
        ]
      : [
          f.sales_minor,
          f.qty,
          f.discount_minor,
          ...(canCost ? [f.profit_minor, fraction(marginOf(f))] : []),
          ...(stock ? [f.stock, ...(canCost ? [f.stock_cost_minor] : [])] : []),
          fraction(shareOf(f, head.total)),
        ]
  const storesOf = (
    cells: (id: string) => ExplorerFigures | undefined
  ): ExportCell[] =>
    laidOut
      ? columns.flatMap((column) => {
          const f = cells(column.id)
          return [
            ...(cellStock
              ? [
                  f?.stock ?? null,
                  ...(canCost ? [f?.stock_cost_minor ?? null] : []),
                ]
              : []),
            f?.sales_minor ?? null,
            pay ? (f === undefined ? null : receiptsOf(f)) : (f?.qty ?? null),
          ]
        })
      : []

  return {
    filename,
    sheet: `Sales by ${label}`.slice(0, 31),
    title: `Sales by ${label}`,
    subtitle,
    columns: [...named, ...figures, ...stores],
    rows: rows.map((row) => {
      const { title, code, sub } = nameParts(group, row)
      const cells = new Map(
        row.cells.map((cell) => [cell.site_id, cell.figures])
      )
      return [
        ...(coded ? [code] : []),
        title,
        sub,
        ...figuresOf(row.figures),
        ...storesOf((id) => cells.get(id)),
      ]
    }),
    totalRow: [
      ...(coded ? [""] : []),
      "Total",
      "",
      ...figuresOf(head.total),
      ...storesOf((id) => storeTotals.get(id)),
    ],
  }
}
