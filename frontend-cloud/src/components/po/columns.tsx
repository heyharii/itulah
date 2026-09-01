/* eslint-disable react-refresh/only-export-components -- column definitions and the cells they render belong in one file. */
import { StatusPill, type StatusTone } from "@/components/custom/status-pill"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import type { DataTableFilterField } from "@/components/data-table/types"
import { IdCell, RowActions } from "@/components/po/cloudhub"
import { ARRAY_DELIMITER } from "@/lib/delimiters"
import { units } from "@/lib/money"
import type { PurchaseOrderRow } from "@/lib/purchase-orders"
import { createSchema, field } from "@/lib/store/schema"
import type { DataTableFeatures } from "@/lib/table/features"
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

/// How much of the order has actually turned up, as a status rather than a bar.
///
/// Received is summed from the DC's goods receipts on every read, so this is a
/// fact about deliveries rather than a state somebody set — an order can be
/// issued and complete, or closed and short. The meter this replaces drew a
/// percentage nobody was reading and painted it in the status blue, which in
/// this language means "in motion"; delivery completeness is a status with
/// three values and belongs in the same pill grammar as everything else.
///
/// The raw counts keep their own column beside it, so nothing is lost to the
/// summary.
export function ReceiptStatus({ row }: { row: PurchaseOrderRow }) {
  const received = row.received_stock_units
  const tone: StatusTone =
    row.fully_received || (received > 0 && row.outstanding_stock_units === 0)
      ? "ok"
      : received > 0
        ? "warn"
        : "neutral"
  return (
    <StatusPill tone={tone}>
      {tone === "ok" ? "Complete" : tone === "warn" ? "Partial" : "None"}
    </StatusPill>
  )
}

/// The server writes two order statuses and no others: `ISSUED` and `CLOSED`
/// (`backend/src/cloud/postgres/*.rs`). The branches for `ACTIVE` and
/// `CANCELLED` were left over from an earlier model, which meant every real
/// order fell through to the amber default — an issued PO is in flight, not a
/// warning, and the rail was colouring the ordinary case as a problem.
///
/// An unrecognised status is grey rather than amber for the same reason: not
/// knowing what something is does not make it urgent.
export function OrderStatus({ status }: { status: string }) {
  const tone: StatusTone =
    status === "ISSUED" ? "info" : status === "CLOSED" ? "ok" : "neutral"
  return (
    <StatusPill tone={tone}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </StatusPill>
  )
}

/// The order list's columns.
///
/// A factory rather than a constant because the trailing `⋯` has to be able to
/// open the record, and the row menu is the one cell that needs to reach the
/// screen around it.
///
/// Three columns the reference has are missing here and are not invented:
/// **Expected date**, **Lines** and **Total**. `GET /api/v1/purchase-orders`
/// returns none of them (`PurchaseOrderRow` in `lib/purchase-orders.ts`), and a
/// total summed in the browser from a list that does not carry prices would be
/// a number with nothing behind it.
export function orderColumns(actions: {
  onOpen: (purchaseOrderId: string) => void
}): ColumnDef<DataTableFeatures, PurchaseOrderRow>[] {
  return [
    {
      accessorKey: "po_number",
      enableHiding: false,
      meta: { label: "Order" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Order" />,
      cell: ({ row }) => (
        <span className="font-mono text-[0.71875rem] font-medium text-[var(--os-ink,#1d1d1f)]">
          {row.original.po_number}
        </span>
      ),
      filterFn: (row, _id, value) => {
        const needle = String(value ?? "").toLowerCase()
        return needle === "" || row.original.po_number.toLowerCase().includes(needle)
      },
    },
    {
      accessorKey: "supplier_name",
      meta: { label: "Supplier" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => (
        // A supplier name is snapshotted onto the order when it is raised, so an
        // order can outlive a renamed supplier. Null means the snapshot was
        // never taken, which is a different thing from an empty name — the id
        // steps in as the identity and says so in mono.
        <IdCell
          name={row.original.supplier_name ?? "Unnamed supplier"}
          id={row.original.supplier_name === null ? row.original.supplier_id : undefined}
          seed={row.original.supplier_id}
        />
      ),
      filterFn: (row, id, value) => includesAny(row.getValue(id), value),
    },
    {
      accessorKey: "issued_at",
      meta: { label: "Issued", headerClassName: "text-right", cellClassName: "text-right" },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Issued" align="end" />
      ),
      cell: ({ row }) => (
        <span className="text-[0.75rem] text-[var(--os-mute,#a6a6ad)] tabular-nums">
          {row.original.issued_at === null
            ? "—"
            : new Date(row.original.issued_at).toLocaleDateString("id-ID")}
        </span>
      ),
    },
    {
      accessorKey: "destination_site_id",
      meta: { label: "Deliver to" },
      header: "Deliver to",
      cell: ({ row }) => (
        <span className="font-mono text-[0.6875rem] text-[var(--os-body,#74747b)]">
          {row.original.destination_site_id}
        </span>
      ),
      filterFn: (row, id, value) => includesAny(row.getValue(id), value),
    },
    {
      id: "ordered_received",
      meta: {
        label: "Ord / Recv",
        headerClassName: "text-right",
        cellClassName: "text-right",
      },
      header: () => <div className="text-right">Ord / Recv</div>,
      enableSorting: false,
      cell: ({ row }) => (
        // Inter with tabular figures, not mono: mono is for identifiers and
        // codes, and a quantity is neither.
        <span className="text-[0.75rem] whitespace-nowrap text-[var(--os-text,#46464d)] tabular-nums">
          {units(row.original.expected_stock_units)} /{" "}
          {units(row.original.received_stock_units)}
        </span>
      ),
    },
    {
      accessorKey: "outstanding_stock_units",
      meta: {
        label: "Outstanding",
        headerClassName: "text-right",
        cellClassName: "text-right",
      },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Outstanding" align="end" />
      ),
      cell: ({ row }) => (
        <span className="text-[0.75rem] font-medium text-[var(--os-ink,#1d1d1f)] tabular-nums">
          {units(row.original.outstanding_stock_units)}
        </span>
      ),
    },
    {
      id: "received",
      meta: { label: "Received" },
      header: "Received",
      enableSorting: false,
      cell: ({ row }) => <ReceiptStatus row={row.original} />,
    },
    {
      accessorKey: "order_status",
      meta: { label: "Status" },
      header: "Status",
      cell: ({ row }) => <OrderStatus status={row.original.order_status} />,
      filterFn: (row, id, value) => includesAny(row.getValue(id), value),
    },
    {
      id: "actions",
      meta: { kind: "actions", headerClassName: "w-8", cellClassName: "w-8" },
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions
          label={`Actions for ${row.original.po_number}`}
          items={[
            {
              label: "Open order",
              onSelect: () => actions.onOpen(row.original.purchase_order_id),
            },
            {
              label: "Copy PO number",
              onSelect: () => {
                void navigator.clipboard?.writeText(row.original.po_number)
              },
            },
          ]}
        />
      ),
    },
  ]
}

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
