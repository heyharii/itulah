import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronDown } from "lucide-react"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Pill } from "@/components/ui/pill"
import { count, day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { procurementKeys, purchaseOrderPage } from "@/lib/queries/procurement"
import { tableSetup, type TableSetup } from "@/lib/table"
import { titled } from "@/screens/procurement/po-print"
import type { Row } from "@/screens/procurement/supplier-returns"

/// "3 pcs", "1 pc": the kit's `quantity` is not in this tree yet.
const quantity = (n: number) => `${count(n)} ${n === 1 ? "pc" : "pcs"}`

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
    // The day the return was raised: the warehouse has counted the delivery by
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
            {quantity(pieces)}
          </span>
          <span className="text-body">
            {count(items)} {items === 1 ? "item" : "items"}
          </span>
        </span>
      </div>
      <DataTable<Dated>
        table={table}
        touch
        // One sort control a screen would be one too many a card: the order is
        // the list's own — open ones first, then the newest order — and a
        // "Sort by" under every supplier's name is noise.
        cardSort={false}
        pageScroll
        onRowClick={(row) => onOpen(row.id)}
        isSelected={(row) => row.id === selected}
      />
    </Card>
  )
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
          <span className="font-mono text-[0.875rem] font-normal text-mute">
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
          <span className="text-[0.875rem] text-mute">pcs</span>
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

/// The phone's list: a heading per supplier — who, how many POs, how many
/// pieces going back — that folds on a tap, and a card per return under it.
/// Where the screen has a supplier-wide step (Operations: the surat jalan) it
/// stands between the heading and the cards.
function PhoneGroups({
  groups,
  selected,
  onOpen,
  actions,
  showPic,
}: {
  groups: readonly Group[]
  selected: string | undefined
  onOpen: (id: string) => void
  actions?: (group: Group) => React.ReactNode
  showPic: boolean
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
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
  const steps = new Map(groups.map((one) => [one.supplier, actions?.(one)]))
  const anySteps = [...steps.values()].some((one) => one !== undefined)
  return (
    <DataTable<CardRow>
      table={table}
      onRowClick={(row) => onOpen(row.id)}
      isSelected={(row) => row.id === selected}
      pageScroll
      cardsApart
      cardLead
      cardSort={false}
      // A heading with a step under it would stick two rows tall.
      stickyBefore={!anySteps}
      isHidden={(row) => folded.has(row.group)}
      renderBefore={(row, index, all) =>
        index === 0 || all[index - 1].group !== row.group ? (
          <div>
            <button
              type="button"
              aria-expanded={!folded.has(row.group)}
              onClick={() =>
                setFolded((was) => {
                  const next = new Set(was)
                  if (!next.delete(row.group)) next.add(row.group)
                  return next
                })
              }
              className="flex w-full items-center gap-2 px-1 py-2 text-left transition-opacity active:opacity-60"
            >
              <span className="min-w-0 text-[1rem] font-semibold break-words text-ink">
                {row.group}
              </span>
              <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
                {`${count(row.groupLines)} ${row.groupLines === 1 ? "PO" : "POs"}`}
              </span>
              <span className="flex-1" />
              <span className="shrink-0 text-[0.875rem] text-mute tabular-nums">
                {`${quantity(row.groupPieces)}`}
              </span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-line-ico transition-[rotate] duration-200 ease-(--ease-out) motion-reduce:transition-none",
                  folded.has(row.group) && "-rotate-90"
                )}
              />
            </button>
            {!folded.has(row.group) && steps.get(row.group) !== undefined && (
              <div className="flex items-center justify-end gap-2 px-1 pb-2">
                {steps.get(row.group)}
              </div>
            )}
          </div>
        ) : null
      }
    />
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
  /// The Person in Charge column: the warehouse's, so Operations keeps it and
  /// Procurement's list leaves it out (owner, 2026-10-05).
  showPic?: boolean
}) {
  const phone = useLayout() === "phone"
  if (phone)
    return (
      <PhoneGroups
        groups={groups}
        selected={selected}
        onOpen={onOpen}
        actions={actions}
        showPic={showPic}
      />
    )
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
