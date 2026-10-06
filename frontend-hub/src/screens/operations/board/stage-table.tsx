import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronDown, Columns3, Rows3 } from "lucide-react"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Checkbox } from "@/components/ui/field"
import { EmptyState } from "@/components/ui/states"
import { Segmented } from "@/components/ui/segmented"
import { count as figure } from "@/lib/format"
import { ago } from "@/lib/format"
import { useAppNavigate } from "@/lib/navigate"
import { useLayout } from "@/lib/layout"
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
      meta: { align: "right", priority: 2, card: "hide" },
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
      meta: { swap: true, card: "hide" },
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
      meta: { priority: 2, card: "hide" },
      accessorFn: (row) => row.group ?? "",
    })
  }
  out.push(
    {
      id: "pieces",
      header: "Pieces",
      size: 130,
      meta: { align: "right", card: "hide" },
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
      meta: { priority: 2, card: "hide" },
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
      meta: { priority: 3, card: "hide" },
      accessorFn: (row) => row.at ?? "",
      cell: ({ row }) => (
        <span className={cn(row.original.late && "text-warn-fg")}>
          {row.original.at ? ago(row.original.at) : ""}
        </span>
      ),
    }
  )
  // Three columns that exist only on a card (`cardLead`; a phone): the figure
  // it leads with — the pieces — the foot's left side — the lane it sits in,
  // and what it is made of and how long it has waited — and, at the foot's
  // right, the verb the card's press does (owner, 2026-10-06).
  out.push(
    {
      id: "lead",
      header: "",
      enableHiding: false,
      enableSorting: false,
      accessorFn: (row) => row.pieces,
      meta: { card: "lead" },
      cell: ({ row }) => {
        const one = row.original
        return (
          <span className="flex flex-col items-end tabular-nums">
            <span
              className={cn(
                "text-[1.5rem] leading-tight font-semibold tracking-tight text-ink",
                one.flag !== undefined && "text-bad-fg"
              )}
            >
              {figure(one.pieces)}
            </span>
            <span className="text-[0.875rem] text-mute">
              {one.of !== undefined ? `of ${figure(one.of)} pcs` : "pcs"}
            </span>
          </span>
        )
      },
    },
    {
      id: "foot",
      header: "",
      enableHiding: false,
      enableSorting: false,
      accessorFn: (row) => row.stage.order,
      meta: { card: "foot" },
      cell: ({ row }) => {
        const one = row.original
        return (
          <span className="flex flex-col leading-6">
            {stages && (
              <span className="inline-flex items-center gap-2 text-ink">
                <span className={cn("size-2 rounded-full", one.stage.tone)} />
                {one.stage.label}
              </span>
            )}
            {(one.detail !== undefined || one.at) && (
              <span className="flex flex-wrap gap-x-1.5">
                {one.detail}
                {one.at && (
                  <span className={cn(one.late && "text-warn-fg")}>
                    {ago(one.at)}
                  </span>
                )}
              </span>
            )}
            {one.flag !== undefined && (
              <span className="text-bad-fg">{one.flag}</span>
            )}
          </span>
        )
      },
    },
    {
      id: "act",
      header: "",
      enableHiding: false,
      enableSorting: false,
      accessorFn: (row) => row.act ?? "",
      meta: { card: "status" },
      cell: ({ row }) =>
        row.original.act === undefined ? null : (
          <span className={cn(button({ variant: "primary", size: "sm" }))}>
            {row.original.act}
          </span>
        ),
    }
  )
  return stages ? out : out.filter((column) => column.id !== "stage")
}

/// The lanes in the order the goods move, then — inside one — the rows with a
/// button to press first, oldest first.
function byLane(rows: readonly StageRow[]): StageRow[] {
  return [...rows].sort(
    (left, right) =>
      left.stage.order - right.stage.order ||
      Number(right.act !== undefined) - Number(left.act !== undefined) ||
      (left.at ?? "").localeCompare(right.at ?? "")
  )
}

/// A lane as the heading of its section, on a phone: its colour, its name, how
/// many cards and how many pieces are in it. A tap folds it away.
function LaneHeading({
  stage,
  count,
  pieces,
  open,
  onToggle,
}: {
  stage: StageRow["stage"]
  count: number
  pieces: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-2 px-1 py-2 text-left transition-opacity active:opacity-60"
    >
      <span className={cn("size-2 shrink-0 rounded-full", stage.tone)} />
      <span className="text-[1rem] font-semibold text-ink">{stage.label}</span>
      <span className="text-[0.9375rem] text-mute tabular-nums">{figure(count)}</span>
      <span className="flex-1" />
      <span className="text-[0.875rem] text-mute tabular-nums">
        {`${figure(pieces)} pcs`}
      </span>
      <ChevronDown
        className={cn(
          "size-4 shrink-0 text-line-ico transition-[rotate] duration-200 ease-(--ease-out) motion-reduce:transition-none",
          !open && "-rotate-90"
        )}
      />
    </button>
  )
}

/// The table version of a board: one row per card, in lane order.
const ACT_FIRST = { id: "act-first", desc: false } as const

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
  const phone = useLayout() === "phone"
  const columns = useMemo(
    () => [
      ...columnsFor(first, group, pickable, stages),
      // Never drawn, only sorted on: rows with a button lead whatever the
      // headings sort by (owner, 2026-10-05).
      {
        id: ACT_FIRST.id,
        accessorFn: (row: StageRow) => (row.act === undefined ? 1 : 0),
        header: "",
        enableHiding: false,
      } as ColumnDef<TableSetup, StageRow>,
    ],
    [first, group, pickable, stages]
  )
  /// Lanes that are folded away, on a phone, by id.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  // A phone reads the lanes as sections, in the order the goods move; the desk
  // keeps the rows with a button to press ahead of everything.
  const grouped = phone && stages
  const ordered = useMemo(
    () => (grouped ? byLane(rows) : byStage(rows)),
    [rows, grouped]
  )
  const lanes = useMemo(() => {
    const out = new Map<string, { count: number; pieces: number }>()
    for (const row of ordered) {
      const lane = out.get(row.stage.id) ?? { count: 0, pieces: 0 }
      out.set(row.stage.id, {
        count: lane.count + 1,
        pieces: lane.pieces + row.pieces,
      })
    }
    return out
  }, [ordered])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: ordered,
        columns,
        getRowId: (row: StageRow) => row.key,
        state: {
          sorting: grouped ? [] : [ACT_FIRST, ...sorting],
          columnVisibility: {
            [ACT_FIRST.id]: false,
            lead: phone,
            foot: phone,
            act: phone,
          },
        },
        onSortingChange: (
          next: SortingState | ((prev: SortingState) => SortingState)
        ) =>
          setSorting((was) =>
            (typeof next === "function"
              ? next([ACT_FIRST, ...was])
              : next
            ).filter((one) => one.id !== ACT_FIRST.id)
          ),
      }),
      [ordered, columns, sorting, phone, grouped]
    )
  )

  if (ordered.length === 0) return <EmptyState>{empty}</EmptyState>

  return (
    <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <DataTable<StageRow>
        table={table}
        touch
        pageScroll
        cardsApart
        cardLead
        cardSort={!grouped}
        stickyBefore
        isHidden={
          grouped ? (row) => folded.has(row.stage.id) : undefined
        }
        renderBefore={
          grouped
            ? (row, index, all) =>
                index === 0 || all[index - 1].stage.id !== row.stage.id ? (
                  <LaneHeading
                    stage={row.stage}
                    count={lanes.get(row.stage.id)?.count ?? 0}
                    pieces={lanes.get(row.stage.id)?.pieces ?? 0}
                    open={!folded.has(row.stage.id)}
                    onToggle={() =>
                      setFolded((was) => {
                        const next = new Set(was)
                        if (next.has(row.stage.id)) next.delete(row.stage.id)
                        else next.add(row.stage.id)
                        return next
                      })
                    }
                  />
                ) : null
            : undefined
        }
        cardTone={(row) => (row.flag !== undefined ? "alert" : undefined)}
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
