import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Columns3, Rows3 } from "lucide-react"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Checkbox } from "@/components/ui/field"
import { EmptyState } from "@/components/ui/states"
import { Segmented } from "@/components/ui/segmented"
import { count as figure } from "@/lib/format"
import { ago } from "@/lib/format"
import { useAppNavigate } from "@/lib/navigate"
import type { SheetKey } from "@/lib/sheets"
import { useOpenHere } from "@/screens/operations/board/open-here"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { button } from "@/components/ui/button-style"
import { ROOMY } from "@/screens/operations/roomy"
import { TwoLines } from "@/screens/operations/two-lines"

import { byStage, type BoardView } from "@/screens/operations/board/board-view"

export function ViewSwitch({
  value,
  onChange,
}: {
  value: BoardView
  onChange: (next: BoardView) => void
}) {
  return (
    <Segmented<BoardView>
      value={value}
      onChange={onChange}
      options={[
        {
          value: "board",
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Columns3 className="size-4" />
              Board
            </span>
          ),
        },
        {
          value: "table",
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Rows3 className="size-4" />
              Table
            </span>
          ),
        },
      ]}
    />
  )
}

/// One card, as a row: the same facts the card shows, plus the lane it sits in.
export interface StageRow {
  readonly key: string
  readonly stage: {
    readonly id: string
    readonly label: string
    /// The lane's dot colour class, e.g. `bg-warn`.
    readonly tone: string
    /// The lane's place in the flow.
    readonly order: number
  }
  readonly title: React.ReactNode
  readonly doc?: React.ReactNode
  /// A second grouping the board lays out by (Spread's supplier).
  readonly group?: string
  readonly detail?: React.ReactNode
  readonly pieces: number
  readonly of?: number
  readonly flag?: React.ReactNode
  readonly at?: string | null
  readonly late?: boolean
  /// What the card does when pressed; absent = the row does nothing.
  readonly open?: {
    readonly to: string
    readonly sheet?: { readonly key: SheetKey; readonly value: string }
  }
  readonly onOpen?: () => void
  /// The verb the card's button says.
  readonly act?: string
  /// A leading tick, on the rows that can be picked (Packed cartons).
  readonly pick?: {
    readonly checked: boolean
    readonly onChange: (checked: boolean) => void
    readonly label: string
  }
}

function columnsFor(
  first: string,
  group: string | undefined,
  pickable: boolean,
  stages: boolean
) {
  const out: ColumnDef<TableSetup, StageRow>[] = []
  if (pickable) {
    out.push({
      id: "pick",
      header: "",
      size: 64,
      enableSorting: false,
      enableHiding: false,
      meta: { card: "status" },
      cell: ({ row }) => {
        const pick = row.original.pick
        if (!pick) return null
        return (
          <span
            className="-my-3 inline-flex"
            onClick={(event) => event.stopPropagation()}
          >
            <Checkbox
              label={<span className="sr-only">{pick.label}</span>}
              checked={pick.checked}
              onChange={pick.onChange}
              className="[&>label]:size-11 [&>label]:justify-center"
            />
          </span>
        )
      },
    })
  }
  out.push(
    {
      id: "no",
      header: "No.",
      size: 70,
      enableSorting: false,
      // On a phone's card it keeps the place it had as the first column.
      meta: pickable
        ? { align: "right", priority: 2, card: "title" }
        : { align: "right", priority: 2 },
      cell: ({ row }) => <span className="text-mute">{row.index + 1}</span>,
    },
    {
      id: "name",
      header: first,
      size: 260,
      meta: { card: "title", grow: 240 },
      enableSorting: false,
      cell: ({ row }) => (
        <TwoLines
          top={row.original.title}
          bottom={row.original.doc ?? ""}
          mono
        />
      ),
    },
    {
      id: "stage",
      header: "Stage",
      size: 170,
      meta: { swap: true },
      accessorFn: (row) => row.stage.order,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <span
            className={cn("size-2 rounded-full", row.original.stage.tone)}
          />
          {row.original.stage.label}
        </span>
      ),
    }
  )
  if (group !== undefined) {
    out.push({
      id: "group",
      header: group,
      size: 200,
      meta: { priority: 2 },
      accessorFn: (row) => row.group ?? "",
    })
  }
  out.push(
    {
      id: "pieces",
      header: "Pieces",
      size: 130,
      meta: { align: "right" },
      accessorFn: (row) => row.pieces,
      cell: ({ row }) => {
        const one = row.original
        return (
          <span className="tabular-nums">
            <span className={cn(one.flag !== undefined && "text-bad-fg")}>
              {figure(one.pieces)}
            </span>
            {one.of !== undefined && ` / ${figure(one.of)}`}
          </span>
        )
      },
    },
    {
      id: "detail",
      header: "Detail",
      size: 180,
      meta: { priority: 2 },
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-col">
          {row.original.detail}
          {row.original.flag !== undefined && (
            <span className="text-bad-fg">{row.original.flag}</span>
          )}
        </span>
      ),
    },
    {
      id: "age",
      header: "Time",
      size: 130,
      meta: { priority: 3 },
      accessorFn: (row) => row.at ?? "",
      cell: ({ row }) => (
        <span className={cn(row.original.late && "text-warn-fg")}>
          {row.original.at ? ago(row.original.at) : ""}
        </span>
      ),
    }
  )
  return stages ? out : out.filter((column) => column.id !== "stage")
}

/// The table version of a board: one row per card, in lane order.
export function StageTable({
  rows,
  first = "Store",
  group,
  empty,
  stages = true,
}: {
  rows: readonly StageRow[]
  /// Header of the first named column.
  first?: string
  /// Header of the extra grouping column, when the rows carry one.
  group?: string
  empty: string
  /// Whether the lane a row sits in is a column. A list that is only a list
  /// (Return to supplier) leaves it out.
  stages?: boolean
}) {
  const go = useAppNavigate()
  const openHere = useOpenHere()
  const [sorting, setSorting] = useState<SortingState>([])
  const pickable = rows.some((row) => row.pick !== undefined)
  const columns = useMemo(
    () => columnsFor(first, group, pickable, stages),
    [first, group, pickable, stages]
  )
  const ordered = useMemo(() => byStage(rows), [rows])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: ordered,
        columns,
        getRowId: (row: StageRow) => row.key,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [ordered, columns, sorting]
    )
  )

  if (ordered.length === 0) return <EmptyState>{empty}</EmptyState>

  return (
    <Card className="overflow-clip">
      <DataTable<StageRow>
        table={table}
        touch
        pageScroll
        className={ROOMY}
        onRowClick={(row) => {
          const here = openHere(row.open?.sheet)
          if (row.onOpen) row.onOpen()
          else if (here) here()
          else if (row.open) void go(row.open.to, row.open.sheet)
        }}
        rowAction={(row) =>
          row.act === undefined ? null : (
            <span className={cn(button({ variant: "ghost", size: "sm" }))}>
              {row.act}
            </span>
          )
        }
      />
    </Card>
  )
}
