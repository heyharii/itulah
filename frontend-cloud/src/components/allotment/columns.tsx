/* eslint-disable react-refresh/only-export-components -- column definitions and the cells they render belong in one file. */
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import type { DataTableFilterField } from "@/components/data-table/types"
import type { AllotmentRow, AllotmentStatus, AllotmentType } from "@/lib/allotments"
import { humanise } from "@/lib/allotments"
import { ARRAY_DELIMITER } from "@/lib/delimiters"
import { units } from "@/lib/money"
import { createSchema, field } from "@/lib/store/schema"
import type { DataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import type { ColumnDef } from "@tanstack/react-table"

export const allotmentFilterSchema = createSchema({
  allotment_number: field.string(),
  type: field.array(field.string()).delimiter(ARRAY_DELIMITER),
  status: field.array(field.string()).delimiter(ARRAY_DELIMITER),
  created_by: field.array(field.string()).delimiter(ARRAY_DELIMITER),
})

function includesAny(rowValue: unknown, filterValue: unknown): boolean {
  const chosen = Array.isArray(filterValue) ? filterValue : [filterValue]
  if (chosen.length === 0) return true
  return chosen.includes(rowValue)
}

/// The status word, with the colour it deserves.
///
/// `ACTIVE` is deliberately not green: an Allotment nobody has picked against
/// is stock held out of everyone else's reach, which is a debt rather than an
/// achievement.
export function AllotmentStatusDot({ status }: { status: AllotmentStatus }) {
  const hue =
    status === "COMPLETED"
      ? "bg-emerald-500"
      : status === "DC_COMPLETED"
        ? "bg-teal-500"
        : status === "IN_PROGRESS"
          ? "bg-sky-500"
          : status === "ACTIVE"
            ? "bg-amber-500"
            : status === "REJECTED"
              ? "bg-destructive"
              : "bg-neutral-400"
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", hue)} />
      {humanise(status)}
    </span>
  )
}

/// Where the goods have got to, as one bar.
///
/// Measured against accepted, not ordered: until the DC that owns an Allotment
/// accepts it, nothing about it has been agreed and there is nothing to be part
/// way through. That case says so in words instead of drawing an empty bar,
/// because an empty bar reads as "nobody has started" when the truth is "nobody
/// has answered".
export function StageBar({ row }: { row: AllotmentRow }) {
  const accepted = row.total_accepted_quantity
  if (accepted === 0) {
    return (
      <span className="text-muted-foreground text-[11px] whitespace-nowrap">
        {row.total_cancelled_quantity > 0
          ? `${units(row.total_cancelled_quantity)} cancelled`
          : `${units(row.total_quantity)} awaiting the DC`}
      </span>
    )
  }
  // Cumulative on the wire — picked >= packed >= … >= received — so the bands
  // are differences, and they add up to accepted exactly.
  const received = row.total_received_quantity
  const moving = Math.max(0, row.total_picked_quantity - received)
  const reserved = Math.max(0, row.remaining_quantity)
  const cancelled = row.total_cancelled_quantity
  const share = (value: number) => `${(value / accepted) * 100}%`
  return (
    <div className="flex min-w-32 items-center gap-2">
      <div className="bg-muted flex h-1.5 w-20 shrink-0 overflow-hidden rounded-full">
        <div className="h-full bg-emerald-500" style={{ width: share(received) }} />
        <div className="h-full bg-sky-500" style={{ width: share(moving) }} />
        <div className="h-full bg-amber-400" style={{ width: share(reserved) }} />
        <div className="h-full bg-neutral-400" style={{ width: share(cancelled) }} />
      </div>
      <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
        {units(received)}/{units(accepted)}
      </span>
    </div>
  )
}

export const allotmentColumns: ColumnDef<DataTableFeatures, AllotmentRow>[] = [
  {
    accessorKey: "allotment_number",
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Allotment" />,
    cell: ({ row }) => (
      <span className="font-mono text-xs font-medium">{row.original.allotment_number}</span>
    ),
    filterFn: (row, _id, value) => {
      const needle = String(value ?? "").toLowerCase()
      return needle === "" || row.original.allotment_number.toLowerCase().includes(needle)
    },
  },
  {
    accessorKey: "type",
    header: "Kind",
    cell: ({ row }) => (
      <span className="text-xs whitespace-nowrap">{humanise(row.original.type)}</span>
    ),
    filterFn: (row, id, value) => includesAny(row.getValue(id), value),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <AllotmentStatusDot status={row.original.status} />
        {/* A cancellation the Gudang has not answered is not a cancelled
            Allotment, and the two must not look alike. */}
        {row.original.edge_cancellation_status === "PENDING" && (
          <span className="text-[10.5px] text-amber-600">cancellation pending</span>
        )}
      </div>
    ),
    filterFn: (row, id, value) => includesAny(row.getValue(id), value),
  },
  {
    accessorKey: "total_quantity",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Allotted" />,
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">{units(row.original.total_quantity)}</span>
    ),
  },
  {
    id: "progress",
    header: "Received",
    enableSorting: false,
    cell: ({ row }) => <StageBar row={row.original} />,
  },
  {
    accessorKey: "remaining_quantity",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Still reserved" />,
    cell: ({ row }) => (
      <span
        className={cn(
          "font-mono text-xs tabular-nums",
          row.original.remaining_quantity > 0 && "text-amber-600",
        )}
      >
        {units(row.original.remaining_quantity)}
      </span>
    ),
  },
  {
    accessorKey: "created_by",
    header: "Raised by",
    cell: ({ row }) => <span className="text-xs">{row.original.created_by}</span>,
    filterFn: (row, id, value) => includesAny(row.getValue(id), value),
  },
  {
    accessorKey: "created_at",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Raised" />,
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-[11px]">
        {new Date(row.original.created_at).toLocaleDateString("id-ID")}
      </span>
    ),
  },
]

export function allotmentFilterFields(
  rows: readonly AllotmentRow[],
): DataTableFilterField<AllotmentRow>[] {
  const unique = (values: readonly string[]) =>
    [...new Set(values)]
      .sort((left, right) => left.localeCompare(right))
      .map((value) => ({ label: humanise(value), value }))

  return [
    { label: "Allotment", value: "allotment_number", type: "input", defaultOpen: true },
    {
      label: "Kind",
      value: "type",
      type: "checkbox",
      defaultOpen: true,
      options: unique(rows.map((row): AllotmentType => row.type)),
    },
    {
      label: "Status",
      value: "status",
      type: "checkbox",
      defaultOpen: true,
      options: unique(rows.map((row): AllotmentStatus => row.status)),
    },
    {
      label: "Raised by",
      value: "created_by",
      type: "checkbox",
      options: unique(rows.map((row) => row.created_by)),
    },
  ]
}
