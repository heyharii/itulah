import {
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import type {
  ClosedShortLine,
  UnfilledLine,
  UnfilledList,
} from "@itulah/contract"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ConfirmButton, SavedDialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import { closeShortAllotment, inventoryKeys } from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"

const number = (n: number) => <span className="tabular-nums">{count(n)}</span>

function articleCell(row: { article_name: string; sku_code: string }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate text-ink">{row.article_name}</span>
      <span className="block truncate font-mono text-mute">{row.sku_code}</span>
    </span>
  )
}

function allotmentCell(row: { allotment_number: string }, when: string) {
  return (
    <span className="block min-w-0">
      <span className="block truncate font-mono text-ink">
        {row.allotment_number}
      </span>
      <span className="block truncate text-mute">{day(when)}</span>
    </span>
  )
}

function storeOf(row: {
  destination_name: string | null
  destination_id: string
}) {
  return row.destination_name ?? row.destination_id
}

function CloseShort({
  row,
  onClosed,
}: {
  row: UnfilledLine
  /// The close went through; the receipt is the panel's to show — this cell
  /// unmounts when the refetch moves the row out of the open list.
  onClosed: (pcs: number) => void
}) {
  const client = useQueryClient()
  const close = useMutation({
    mutationFn: () =>
      closeShortAllotment(row.allotment_id, {
        idempotency_key: crypto.randomUUID(),
        lines: [
          { allotment_line_id: row.allotment_line_id, quantity: row.unfilled },
        ],
        reason: null,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      onClosed(row.unfilled)
    },
  })
  return (
    // The dialog is portalled, but React events still bubble through it to
    // the row that opens the sheet.
    <span onClick={(event) => event.stopPropagation()}>
      <ConfirmButton
        label="Close short"
        variant="soft"
        size="sm"
        title="Close short"
        description={`${storeOf(row)} gets ${count(row.allotted - row.unfilled)} of ${count(row.allotted)}.`}
        confirmLabel="Close short"
        pending={close.isPending}
        onConfirm={() => close.mutateAsync()}
      />
    </span>
  )
}

function openColumns(onClosed: (pcs: number) => void): ColumnDef<
  TableSetup,
  UnfilledLine
>[] {
  return [
    {
      id: "no",
      header: "No.",
      size: 64,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-mute tabular-nums">{row.index + 1}</span>
      ),
    },
    {
      accessorKey: "article_name",
      header: "Article",
      meta: { grow: 200 },
      cell: ({ row }) => articleCell(row.original),
    },
    {
      id: "store",
      header: "Store",
      size: 160,
      accessorFn: (row) => storeOf(row),
      cell: ({ row }) => storeOf(row.original),
    },
    {
      accessorKey: "allotment_number",
      header: "Allotment",
      size: 150,
      cell: ({ row }) => allotmentCell(row.original, row.original.allotted_at),
    },
    {
      accessorKey: "allotted",
      header: "Allotted",
      size: 100,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => number(row.original.allotted),
    },
    {
      accessorKey: "packed",
      header: "Packed",
      size: 100,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => number(row.original.packed),
    },
    {
      accessorKey: "unfilled",
      header: "Unfilled",
      size: 100,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => (
        <span className="font-medium text-warn-fg tabular-nums">
          {count(row.original.unfilled)}
        </span>
      ),
    },
    {
      id: "action",
      header: "",
      size: 130,
      enableSorting: false,
      meta: { align: "right" },
      cell: ({ row }) => <CloseShort row={row.original} onClosed={onClosed} />,
    },
  ]
}

function closedColumns(): ColumnDef<TableSetup, ClosedShortLine>[] {
  return [
    {
      id: "no",
      header: "No.",
      size: 64,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-mute tabular-nums">{row.index + 1}</span>
      ),
    },
    {
      accessorKey: "article_name",
      header: "Article",
      meta: { grow: 200 },
      cell: ({ row }) => articleCell(row.original),
    },
    {
      id: "store",
      header: "Store",
      size: 160,
      accessorFn: (row) => storeOf(row),
      cell: ({ row }) => storeOf(row.original),
    },
    {
      accessorKey: "allotment_number",
      header: "Allotment",
      size: 150,
      cell: ({ row }) => (
        <span className="font-mono text-ink">
          {row.original.allotment_number}
        </span>
      ),
    },
    {
      accessorKey: "allotted",
      header: "Allotted",
      size: 100,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => number(row.original.allotted),
    },
    {
      accessorKey: "packed",
      header: "Packed",
      size: 100,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => number(row.original.packed),
    },
    {
      accessorKey: "closed_short",
      header: "Closed Short",
      size: 120,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => number(row.original.closed_short),
    },
    {
      accessorKey: "closed_at",
      header: "By / Date",
      size: 160,
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="block truncate text-ink">
            {row.original.closed_by}
          </span>
          <span className="block truncate text-mute">
            {day(row.original.closed_at)}
          </span>
        </span>
      ),
    },
  ]
}

/// The two tabs' body. Row click opens the allotment sheet.
export function UnfilledPanel({
  which,
  query,
  onOpen,
}: {
  which: "open" | "closed"
  query: UseQueryResult<UnfilledList>
  onOpen: (allotmentId: string) => void
}) {
  const open = useMemo(() => query.data?.open ?? [], [query.data])
  const closed = useMemo(() => query.data?.closed ?? [], [query.data])
  /// The close-short a press made, held in the receipt dialog until it is
  /// read. The panel stays mounted through the refetch that moves the closed
  /// row out of the open list — the cell that started the write does not.
  const [closedShort, setClosedShort] = useState<number | null>(null)
  const openColumnDefs = useMemo(
    () => openColumns(setClosedShort),
    []
  )
  const closedColumnDefs = useMemo(() => closedColumns(), [])

  const openTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: open,
        columns: openColumnDefs,
        getRowId: (row: UnfilledLine) => row.allotment_line_id,
      }),
      [open, openColumnDefs]
    )
  )
  const closedTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: closed,
        columns: closedColumnDefs,
        getRowId: (row: ClosedShortLine) =>
          `${row.allotment_line_id}-${row.closed_at}`,
      }),
      [closed, closedColumnDefs]
    )
  )

  return (
    <Card className="overflow-clip">
      {queryState(query, {
        loading: "Reading the unfilled lines…",
        render: () =>
          which === "open" ? (
            open.length === 0 ? (
              <EmptyState>Nothing unfilled.</EmptyState>
            ) : (
              <DataTable<UnfilledLine>
                table={openTable}
                pageScroll
                onRowClick={(row) => onOpen(row.allotment_id)}
              />
            )
          ) : closed.length === 0 ? (
            <EmptyState>Nothing closed short.</EmptyState>
          ) : (
            <DataTable<ClosedShortLine>
              table={closedTable}
              pageScroll
              onRowClick={(row) => onOpen(row.allotment_id)}
            />
          ),
      })}
      <SavedDialog
        open={closedShort !== null}
        onOpenChange={(next) => {
          if (!next) setClosedShort(null)
        }}
        title={
          closedShort !== null && (
            <>
              {count(closedShort)} pcs closed short
            </>
          )
        }
      />
    </Card>
  )
}
