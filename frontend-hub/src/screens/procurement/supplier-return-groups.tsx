import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo } from "react"

import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { count, day, money } from "@/lib/format"
import { procurementKeys, purchaseOrderPage } from "@/lib/queries/procurement"
import { tableSetup, type TableSetup } from "@/lib/table"
import { titled } from "@/screens/procurement/po-print"
import type { Row } from "@/screens/procurement/supplier-returns"

/// The Return to supplier list as the owner drew it (2026-10-05): a card per
/// supplier, a band on top carrying who, how much is going back to them and —
/// where the screen has one — the next step, and under it that supplier's
/// returns. Shared by Operations (whose band carries Generate Surat Jalan,
/// Print, Download and Confirm) and Procurement (whose band says nothing: the
/// buyer reads where each return stands).

/// A return with the date of the order it came from.
export type Dated = Row & { readonly poDate: string | null }

/// One supplier's returns.
export interface Group {
  readonly supplier: string
  readonly rows: readonly Dated[]
}

/// Where a return stands on its surat jalan: made yet, and handed over yet.
/// A return that has no note of its own — the register's problem goods leave
/// through the picklist — keeps the status it already has.
export function noteStatus(row: Row): string {
  if (row.reference === null) return row.status
  if (row.handedOverAt !== null) return "Completed"
  if (row.noteAt !== null) return "Generated"
  return "Not Generated"
}

/// The date of each order, by number, for the PO Date column.
export function usePoDates(): Map<string, string | null> {
  const orders = useQuery({
    queryKey: procurementKeys.ordersPage({}),
    queryFn: ({ signal }) => purchaseOrderPage({}, signal),
  })
  return useMemo(
    () =>
      new Map(
        (orders.data?.rows ?? []).map((one) => [one.po_number, one.issued_at])
      ),
    [orders.data]
  )
}

/// Returns by supplier, suppliers alphabetically, each supplier's open ones
/// first and then the newest order.
export function groupBySupplier(
  rows: readonly Row[],
  poDates: ReadonlyMap<string, string | null>
): Group[] {
  const by = new Map<string, Dated[]>()
  for (const one of rows) {
    const dated: Dated = {
      ...one,
      poDate:
        one.reference === null ? null : (poDates.get(one.reference) ?? null),
    }
    by.set(one.supplier, [...(by.get(one.supplier) ?? []), dated])
  }
  // Suppliers with something still to do — a return not yet handed over, the
  // ones that carry the button — lead (owner, 2026-10-05); the rest follow, and
  // each group is A to Z.
  const busy = (list: readonly Dated[]) => list.some((one) => one.open)
  return [...by.entries()]
    .sort(
      ([leftName, leftRows], [rightName, rightRows]) =>
        Number(busy(rightRows)) - Number(busy(leftRows)) ||
        leftName.localeCompare(rightName)
    )
    .map(([supplier, list]) => ({
      supplier,
      rows: list.sort(
        (left, right) =>
          Number(right.open) - Number(left.open) ||
          (right.poDate ?? "").localeCompare(left.poDate ?? "")
      ),
    }))
}

const columns: ColumnDef<TableSetup, Dated>[] = [
  {
    id: "po",
    accessorFn: (row) => row.reference ?? "",
    header: "PO",
    meta: { grow: 220, card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5 py-1 leading-5">
        <span className="font-mono text-id font-medium text-ink">
          {row.original.reference ?? "—"}
        </span>
        <span className="font-mono text-id text-mute">
          {row.original.number}
        </span>
      </span>
    ),
  },
  {
    id: "quantity",
    accessorFn: (row) => row.pcs,
    header: "Quantity",
    size: 140,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end leading-5 tabular-nums">
        <span className="font-medium text-ink">
          {count(row.original.pcs)} pcs
        </span>
        <span className="text-mute">
          {count(row.original.lines.length)}{" "}
          {row.original.lines.length === 1 ? "item" : "items"}
        </span>
      </span>
    ),
  },
  {
    id: "value",
    accessorFn: (row) => row.valueMinor,
    header: "Value",
    size: 140,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) =>
      row.original.valueMinor > 0 ? (
        <span className="tabular-nums">{money(row.original.valueMinor)}</span>
      ) : (
        <span className="text-mute">—</span>
      ),
  },
  {
    // The day the return was raised: the Gudang has counted the delivery by
    // then, so it is the nearest date the register holds to "received" (the
    // order's own date can be weeks earlier).
    id: "date",
    accessorFn: (row) => row.raisedAt,
    header: "Received Date",
    size: 150,
    meta: { align: "right", card: "meta", priority: 3 },
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{day(row.original.raisedAt)}</span>
    ),
  },
  {
    id: "pic",
    accessorFn: (row) => row.pic ?? "",
    header: "Person in Charge",
    size: 180,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) =>
      row.original.pic === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="truncate">{titled(row.original.pic)}</span>
      ),
  },
  {
    id: "status",
    accessorFn: (row) => noteStatus(row),
    header: "Status",
    size: 150,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => {
      const status = noteStatus(row.original)
      // Colour only where somebody has something to do: a return without its
      // note. Generated waits for the confirm; completed has finished, in green.
      const tone =
        status === "Not Generated"
          ? "text-warn-fg"
          : status === "Completed"
            ? "text-ok-fg"
            : "text-info-fg"
      return <span className={`whitespace-nowrap ${tone}`}>{status}</span>
    },
  },
]

/// One supplier, set apart: a band with who, how much is going back to them in
/// all and `actions`, and under it that supplier's returns.
function SupplierCard({
  group,
  selected,
  onOpen,
  actions,
  showPic,
}: {
  group: Group
  selected: string | undefined
  onOpen: (id: string) => void
  actions?: React.ReactNode
  showPic: boolean
}) {
  const rows = group.rows
  const pieces = rows.reduce((sum, one) => sum + one.pcs, 0)
  const items = rows.reduce((sum, one) => sum + one.lines.length, 0)
  const value = rows.reduce((sum, one) => sum + one.valueMinor, 0)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: showPic ? columns : columns.filter((one) => one.id !== "pic"),
        getRowId: (row: Dated) => row.id,
      }),
      [rows, showPic]
    )
  )
  return (
    <Card className="overflow-clip">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-hairline-2 bg-soft-2 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[1.0625rem] leading-6 font-semibold text-ink">
            {group.supplier}
          </span>
          <span className="text-body tabular-nums">
            {count(rows.length)} {rows.length === 1 ? "PO" : "POs"}
          </span>
        </div>
        {actions !== undefined && (
          <span className="flex items-center gap-2">{actions}</span>
        )}
        <span className="flex flex-col items-end leading-6 tabular-nums">
          <span className="text-[1.0625rem] font-semibold text-ink">
            {count(pieces)} pcs
          </span>
          <span className="text-body">
            {count(items)} {items === 1 ? "item" : "items"}
            {" · "}
            {money(value)}
          </span>
        </span>
      </div>
      <DataTable<Dated>
        table={table}
        touch
        pageScroll
        onRowClick={(row) => onOpen(row.id)}
        isSelected={(row) => row.id === selected}
      />
    </Card>
  )
}

/// The cards, one per supplier, with a gap you can see between them.
export function ReturnGroups({
  groups,
  selected,
  onOpen,
  actions,
  showPic = true,
}: {
  groups: readonly Group[]
  selected: string | undefined
  onOpen: (id: string) => void
  /// What stands in a supplier's band, if anything.
  actions?: (group: Group) => React.ReactNode
  /// The Person in Charge column: the Gudang's, so Operations keeps it and
  /// Procurement's list leaves it out (owner, 2026-10-05).
  showPic?: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <SupplierCard
          key={group.supplier}
          group={group}
          selected={selected}
          onOpen={onOpen}
          actions={actions?.(group)}
          showPic={showPic}
        />
      ))}
    </div>
  )
}
