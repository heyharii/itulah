import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Pill } from "@/components/ui/pill"
import type { Refreshable } from "@/components/ui/refresh-stamp"
import { count, day, dayMonth, quantity } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { procurementKeys, purchaseOrderPage } from "@/lib/queries/procurement"
import { tableSetup, type TableSetup } from "@/lib/table"
import { titled } from "@/screens/procurement/po-print"
import { STAMP } from "@/screens/procurement/shared"
import type { Row } from "@/screens/procurement/supplier-returns"

/// The Return PO list, one row per PO (owner, 2026-10-16). Shared by
/// Operations (whose sheet carries Generate, Print, Download and Confirm) and
/// Procurement (which reads where each return stands).

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

/// A finished return wears the stamp a finished order wears in the PO list
/// (owner, 16 Oct 2026): the word over the day it was handed over.
function CompletedStamp({ row }: { row: Row }) {
  return (
    <span className={cn(STAMP, "text-ok-fg")}>
      Completed
      {row.handedOverAt !== null && (
        <span className="block tabular-nums">{dayMonth(row.handedOverAt)}</span>
      )}
    </span>
  )
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

const baseColumns: ColumnDef<TableSetup, Dated>[] = [
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
    id: "supplier",
    accessorFn: (row) => row.supplier,
    header: "Supplier",
    meta: { grow: 220, card: "meta" },
    cell: ({ row }) => (
      <span className="truncate text-ink">{row.original.supplier}</span>
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
          {quantity(row.original.pcs)}
        </span>
        <span className="text-mute">
          {count(row.original.lines.length)}{" "}
          {row.original.lines.length === 1 ? "item" : "items"}
        </span>
      </span>
    ),
  },
  {
    id: "pic",
    accessorFn: (row) => row.pic ?? "",
    header: "Person in Charge",
    size: 180,
    // Shown on every width, an 11" laptop's too (owner, 2026-10-16).
    meta: { card: "meta" },
    cell: ({ row }) =>
      row.original.pic === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="truncate">{titled(row.original.pic)}</span>
      ),
  },
]

const statusColumn: ColumnDef<TableSetup, Dated> = {
  id: "status",
  accessorFn: (row) => noteStatus(row),
  header: "Status",
  size: 150,
  meta: { align: "right", card: "status" },
  cell: ({ row }) => {
    const status = noteStatus(row.original)
    if (status === "Completed") return <CompletedStamp row={row.original} />
    // Colour only where somebody has something to do: a return without its
    // note. Generated waits for the confirm.
    const tone =
      status === "Not Generated"
        ? "text-warn-fg"
        : status === "Completed"
          ? "text-ok-fg"
          : "text-info-fg"
    return <span className={`whitespace-nowrap ${tone}`}>{status}</span>
  },
}

/// What the list needs to offer Confirm on a row: whether that return can be
/// handed over here, and the start of the confirm dialog.
export interface ConfirmColumn {
  readonly can: (id: string) => boolean
  readonly start: (id: string) => void
}

/// The last column: where the surat jalan stands, or — where the screen can
/// hand returns over (Operations) — a Confirm button on every return whose
/// note is generated (owner, 2026-10-16: "status hapus, ganti ke button
/// confirm").
function columnsWith(
  confirm: ConfirmColumn | undefined
): ColumnDef<TableSetup, Dated>[] {
  if (confirm === undefined) return [...baseColumns, statusColumn]
  return [
    ...baseColumns,
    {
      id: "confirm",
      header: "",
      size: 130,
      enableSorting: false,
      meta: { align: "right", card: "status" },
      cell: ({ row }) => {
        if (noteStatus(row.original) === "Completed")
          return <CompletedStamp row={row.original} />
        if (!confirm.can(row.original.id)) return null
        return (
          <Button
            variant="primary"
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              confirm.start(row.original.id)
            }}
          >
            Confirm
          </Button>
        )
      },
    },
  ]
}

/// A return on a card: the same card as every list (owner, 2026-10-06). The
/// order it came from over the return's own number, the pieces as the figure, a
/// foot that says when it was raised and how many items (and who is in charge,
/// where the screen shows that), and where its surat jalan stands.
interface CardRow extends Dated {
  readonly group: string
  readonly groupLines: number
  readonly groupPieces: number
}

function cardColumns(showPic: boolean): ColumnDef<TableSetup, CardRow>[] {
  return [
    {
      id: "head",
      accessorFn: (row) => row.reference ?? "",
      header: "",
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[1rem] font-semibold break-words text-ink">
            {row.original.reference ?? "—"}
          </span>
          <span className="font-mono text-[0.9375rem] font-normal text-mute">
            {row.original.number}
          </span>
        </span>
      ),
    },
    {
      id: "lead",
      accessorFn: (row) => row.pcs,
      header: "",
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <span className="flex flex-col items-end tabular-nums">
          <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
            {count(row.original.pcs)}
          </span>
          <span className="text-[0.9375rem] text-mute">pcs</span>
        </span>
      ),
    },
    {
      id: "foot",
      accessorFn: (row) => row.raisedAt,
      header: "",
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => {
        const one = row.original
        const items = one.lines.length
        return (
          <span className="flex flex-col leading-6 tabular-nums">
            <span className="text-ink">{one.supplier}</span>
            <span>
              {`${day(one.raisedAt)} · ${count(items)} ${items === 1 ? "item" : "items"}`}
            </span>
            {showPic && one.pic !== null && <span>{titled(one.pic)}</span>}
          </span>
        )
      },
    },
    {
      id: "status",
      accessorFn: (row) => noteStatus(row),
      header: "",
      enableSorting: false,
      meta: { align: "right", card: "status" },
      cell: ({ row }) => {
        const status = noteStatus(row.original)
        if (status === "Completed") return <CompletedStamp row={row.original} />
        // Colour only where somebody has something to do, as the desk does.
        return (
          <Pill
            tone={
              status === "Not Generated"
                ? "warn"
                : status === "Completed"
                  ? "ok"
                  : "info"
            }
          >
            {status}
          </Pill>
        )
      },
    },
  ]
}

/// The phone's list: a card per return, its supplier in the foot.
function PhoneGroups({
  groups,
  selected,
  onOpen,
  showPic,
  refresh,
}: {
  groups: readonly Group[]
  selected: string | undefined
  onOpen: (id: string) => void
  showPic: boolean
  refresh?: readonly Refreshable[]
}) {
  const rows = useMemo<CardRow[]>(
    () =>
      groups.flatMap((group) => {
        const pieces = group.rows.reduce((sum, one) => sum + one.pcs, 0)
        return group.rows.map((one) => ({
          ...one,
          group: group.supplier,
          groupLines: group.rows.length,
          groupPieces: pieces,
        }))
      }),
    [groups]
  )
  const columns = useMemo(() => cardColumns(showPic), [showPic])
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: CardRow) => row.id,
      }),
      [rows, columns]
    )
  )
  return (
    <DataTable<CardRow>
      refresh={refresh}
      table={table}
      onRowClick={(row) => onOpen(row.id)}
      isSelected={(row) => row.id === selected}
      pageScroll
      cardsApart
      cardLead
      cardSort={false}
    />
  )
}

/// The returns, one row per PO (owner, 16 Oct 2026: "per PO saja"): a table
/// on a desk, a card each on a phone.
export function ReturnGroups({
  groups,
  selected,
  onOpen,
  showPic = true,
  refresh,
  confirm,
}: {
  groups: readonly Group[]
  selected: string | undefined
  onOpen: (id: string) => void
  /// Confirm on the row, where this screen hands returns over (Operations).
  confirm?: ConfirmColumn
  /// The Person in Charge column: the warehouse's, so Operations keeps it and
  /// Procurement's list leaves it out (owner, 2026-10-05).
  showPic?: boolean
  /// The queries behind the rows.
  refresh?: readonly Refreshable[]
}) {
  const phone = useLayout() === "phone"
  if (phone)
    return (
      <PhoneGroups
        groups={groups}
        selected={selected}
        onOpen={onOpen}
        showPic={showPic}
        refresh={refresh}
      />
    )
  return (
    <ReturnTable
      rows={groups.flatMap((group) => group.rows)}
      selected={selected}
      onOpen={onOpen}
      showPic={showPic}
      refresh={refresh}
      confirm={confirm}
    />
  )
}

function ReturnTable({
  rows,
  selected,
  onOpen,
  showPic,
  refresh,
  confirm,
}: {
  rows: readonly Dated[]
  selected: string | undefined
  onOpen: (id: string) => void
  showPic: boolean
  refresh?: readonly Refreshable[]
  confirm?: ConfirmColumn
}) {
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as Dated[],
        columns: columnsWith(confirm).filter(
          (one) => showPic || one.id !== "pic"
        ),
        getRowId: (row: Dated) => row.id,
      }),
      [rows, showPic, confirm]
    )
  )
  return (
    <DataTable<Dated>
      refresh={refresh}
      table={table}
      touch
      cardSort={false}
      pageScroll
      onRowClick={(row) => onOpen(row.id)}
      isSelected={(row) => row.id === selected}
    />
  )
}
