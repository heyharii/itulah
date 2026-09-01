/* eslint-disable react-refresh/only-export-components -- column definitions and the cells they render belong in one file. */
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import type { DataTableFilterField } from "@/components/data-table/types"
import { ARRAY_DELIMITER } from "@/lib/delimiters"
import { units } from "@/lib/money"
import type { PurchaseOrderRow } from "@/lib/purchase-orders"
import { createSchema, field } from "@/lib/store/schema"
import type { DataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import type { ColumnDef } from "@tanstack/react-table"

export const orderFilterSchema = createSchema({
  po_number: field.string(),
  supplier_name: field.array(field.string()).delimiter(ARRAY_DELIMITER),
  destination_site_id: field.array(field.string()).delimiter(ARRAY_DELIMITER),
  order_status: field.array(field.string()).delimiter(ARRAY_DELIMITER),
})

function includesAny(rowValue: unknown, filterValue: unknown): boolean {
  const chosen = Array.isArray(filterValue) ? filterValue : [filterValue]
  if (chosen.length === 0) return true
  return chosen.includes(rowValue)
}

/// How much of the order has actually turned up.
///
/// Received is summed from the DC's goods receipts on every read, so this bar
/// is a fact about deliveries rather than a status somebody set. An order can
/// be `ACTIVE` and complete, or closed and short; the bar and the status word
/// are answering two different questions and both are shown.
export function ReceiptProgress({ row }: { row: PurchaseOrderRow }) {
  const expected = row.expected_stock_units
  const share = expected === 0 ? 0 : Math.min(1, row.received_stock_units / expected)
  return (
    <div className="flex min-w-28 items-center gap-2">
      <div className="bg-muted h-1.5 w-16 shrink-0 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", row.fully_received ? "bg-emerald-500" : "bg-sky-500")}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
        {units(row.received_stock_units)}/{units(expected)}
      </span>
    </div>
  )
}

export function OrderStatus({ status }: { status: string }) {
  const hue =
    status === "ACTIVE"
      ? "bg-sky-500"
      : status === "CLOSED"
        ? "bg-emerald-500"
        : status === "CANCELLED"
          ? "bg-neutral-400"
          : "bg-amber-500"
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", hue)} />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

export const orderColumns: ColumnDef<DataTableFeatures, PurchaseOrderRow>[] = [
  {
    accessorKey: "po_number",
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Order" />,
    cell: ({ row }) => (
      <span className="font-mono text-xs font-medium">{row.original.po_number}</span>
    ),
    filterFn: (row, _id, value) => {
      const needle = String(value ?? "").toLowerCase()
      return needle === "" || row.original.po_number.toLowerCase().includes(needle)
    },
  },
  {
    accessorKey: "supplier_name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
    cell: ({ row }) => (
      <span className="truncate text-xs">
        {/* A supplier name is snapshotted onto the order when it is raised, so
            an order can outlive a renamed supplier. Null means the snapshot was
            never taken, which is a different thing from an empty name. */}
        {row.original.supplier_name ?? (
          <span className="text-muted-foreground font-mono">{row.original.supplier_id}</span>
        )}
      </span>
    ),
    filterFn: (row, id, value) => includesAny(row.getValue(id), value),
  },
  {
    accessorKey: "destination_site_id",
    header: "Deliver to",
    cell: ({ row }) => (
      <span className="font-mono text-[11px]">{row.original.destination_site_id}</span>
    ),
    filterFn: (row, id, value) => includesAny(row.getValue(id), value),
  },
  {
    id: "received",
    header: "Received",
    enableSorting: false,
    cell: ({ row }) => <ReceiptProgress row={row.original} />,
  },
  {
    accessorKey: "outstanding_stock_units",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Outstanding" />,
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">
        {units(row.original.outstanding_stock_units)}
      </span>
    ),
  },
  {
    accessorKey: "order_status",
    header: "Status",
    cell: ({ row }) => <OrderStatus status={row.original.order_status} />,
    filterFn: (row, id, value) => includesAny(row.getValue(id), value),
  },
  {
    accessorKey: "issued_at",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Issued" />,
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-[11px]">
        {row.original.issued_at === null
          ? "—"
          : new Date(row.original.issued_at).toLocaleDateString("id-ID")}
      </span>
    ),
  },
]

export function orderFilterFields(
  rows: readonly PurchaseOrderRow[],
): DataTableFilterField<PurchaseOrderRow>[] {
  const unique = (values: readonly (string | null)[]) =>
    [...new Set(values.filter((value): value is string => value !== null))]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ label: value, value }))

  return [
    { label: "Order", value: "po_number", type: "input", defaultOpen: true },
    {
      label: "Supplier",
      value: "supplier_name",
      type: "checkbox",
      defaultOpen: true,
      options: unique(rows.map((row) => row.supplier_name)),
    },
    {
      label: "Deliver to",
      value: "destination_site_id",
      type: "checkbox",
      defaultOpen: true,
      options: unique(rows.map((row) => row.destination_site_id)),
    },
    {
      label: "Status",
      value: "order_status",
      type: "checkbox",
      options: unique(rows.map((row) => row.order_status)),
    },
  ]
}
