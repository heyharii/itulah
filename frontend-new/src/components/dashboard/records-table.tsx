import { useMemo, useRef, useState } from "react"
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table"

import { Icon, TagList, paths } from "@/components/dashboard/parts"
import {
  type SortDir,
  type SortKey,
  type Supplier,
} from "@/components/dashboard/data"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

/** Fixed columns; Categories takes whatever width is left over. */
const COLUMNS = [
  { id: "company", initial: 300 },
  { id: "history", initial: 128 },
  { id: "status", initial: 128 },
] as const

type ColumnId = (typeof COLUMNS)[number]["id"]

/* The table only owns the row model — the markup below stays hand-written —
 * so it needs sorting and nothing else. */
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
})

/* Ties always break on company name ascending, the way the hand-rolled
 * comparator did, so a sorted view has a stable order. */
const TIEBREAK: SortingState[number] = { id: "company", desc: false }

const TABLE_COLUMNS = [
  {
    id: "company",
    accessorFn: (row: Supplier) => row.name,
    sortFn: "text" as const,
    sortDescFirst: false,
  },
  {
    id: "categories",
    accessorFn: (row: Supplier) => row.tags[0] ?? "",
    sortFn: "text" as const,
    sortDescFirst: false,
  },
  {
    id: "history",
    // undefined history sorted below zero, matching the old `?? -Infinity`
    accessorFn: (row: Supplier) => row.historyEvents ?? Number.NEGATIVE_INFINITY,
    sortFn: "basic" as const,
    sortDescFirst: false,
  },
  {
    id: "status",
    accessorFn: (row: Supplier) => row.status ?? "unknown",
    sortFn: "text" as const,
    sortDescFirst: false,
  },
]

/** A checkbox that matches the grid's density rather than the app default. */
function Check({
  checked,
  mixed,
  label,
  onChange,
}: {
  checked: boolean
  mixed?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <label
      title={label}
      onClick={(e) => e.stopPropagation()}
      className="group/check relative inline-flex size-[22px] shrink-0 items-center justify-center"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="absolute size-px opacity-0"
      />
      <span
        className={cn(
          "inline-flex size-[17px] items-center justify-center rounded-[5px] border bg-surface transition-[border-color,background-color,transform] duration-[140ms] ease-spring",
          "group-hover/check:border-ink-4 group-hover/check:bg-hover group-active/check:scale-[0.94]",
          checked || mixed
            ? "border-accent bg-accent text-white"
            : "border-line-strong text-transparent"
        )}
      >
        {mixed ? (
          <span className="h-[1.5px] w-[7px] rounded-full bg-white" />
        ) : checked ? (
          <Icon path={paths.check} size={10} width={3.2} />
        ) : null}
      </span>
    </label>
  )
}

function HeaderButton({
  label,
  sorted,
  onToggle,
  numeric,
  title,
}: {
  label: string
  sorted: false | SortDir
  onToggle: () => void
  numeric?: boolean
  title?: string
}) {
  const on = sorted !== false
  const dir: 1 | -1 = sorted === "desc" ? -1 : 1

  return (
    <button
      type="button"
      title={title}
      onClick={onToggle}
      aria-sort={
        on ? (sorted === "desc" ? "descending" : "ascending") : undefined
      }
      className={cn(
        "group/th relative flex h-8 w-full items-center gap-[7px] overflow-hidden px-2.5 text-left whitespace-nowrap transition-colors duration-[120ms] hover:bg-hover hover:text-ink-2",
        numeric && "justify-end"
      )}
    >
      {numeric && <SortArrow on={on} dir={dir} />}
      {label}
      {!numeric && <SortArrow on={on} dir={dir} className="ml-auto" />}
    </button>
  )
}

function SortArrow({
  on,
  dir,
  className,
}: {
  on: boolean
  dir: 1 | -1
  className?: string
}) {
  return (
    <Icon
      path={paths.arrowUp}
      size={12}
      width={2.2}
      className={cn(
        "text-ink-4 opacity-0 transition-[opacity,transform] duration-[180ms] ease-spring group-hover/th:opacity-50",
        on && "text-accent opacity-100!",
        on && dir === -1 && "rotate-180",
        className
      )}
    />
  )
}

function Status({ status }: { status?: string }) {
  const normalized =
    status === "active" || status === "inactive" || status === "blocked"
      ? status
      : "unknown"
  const label =
    normalized === "unknown"
      ? "Unknown"
      : normalized[0].toUpperCase() + normalized.slice(1)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
        normalized === "active" && "border-grass/20 bg-grass/8 text-grass",
        normalized === "inactive" && "border-line-strong bg-inset text-ink-3",
        normalized === "blocked" && "border-ember/20 bg-ember/8 text-ember",
        normalized === "unknown" && "border-line-strong bg-inset text-ink-4"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          normalized === "active" && "bg-grass",
          normalized === "inactive" && "bg-ink-4",
          normalized === "blocked" && "bg-ember",
          normalized === "unknown" && "bg-line-strong"
        )}
      />
      {label}
    </span>
  )
}

interface RecordsTableProps {
  rows: Supplier[]
  selected: Set<string>
  openId: string | null
  /** URL sort state: the column, or `null` for the unsorted natural order. */
  sortKey: SortKey | null
  sortDir: SortDir
  /** Hand the next sort back to the caller, which writes it to the URL. */
  onSortChange: (next: { key: SortKey | null; dir: SortDir }) => void
  onToggleRow: (id: string) => void
  onToggleAll: () => void
  onOpenRow: (id: string) => void
}

export function RecordsTable({
  rows: sourceRows,
  selected,
  openId,
  sortKey,
  sortDir,
  onSortChange,
  onToggleRow,
  onToggleAll,
  onOpenRow,
}: RecordsTableProps) {
  /* The URL is the only sorting state there is: it goes into the table, and
   * whatever the table hands back goes straight back to the URL. */
  const sorting = useMemo<SortingState>(
    () =>
      sortKey ? [{ id: sortKey, desc: sortDir === "desc" }, TIEBREAK] : [],
    [sortKey, sortDir]
  )

  const table = useTable({
    features,
    data: sourceRows,
    columns: TABLE_COLUMNS,
    getRowId: (row) => row.id,
    state: { sorting },
    enableSortingRemoval: false,
    enableMultiSort: false,
    onSortingChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(sorting) : updater
      const lead = next.find((entry) => entry.id !== TIEBREAK.id)
      onSortChange(
        lead
          ? { key: lead.id as SortKey, dir: lead.desc ? "desc" : "asc" }
          : { key: null, dir: "asc" }
      )
    },
  })

  const rows = table.getRowModel().rows.map((row) => row.original)

  const sortedFor = (id: SortKey): false | SortDir =>
    sortKey === id ? sortDir : false

  const [widths, setWidths] = useState<Record<ColumnId, number>>(
    () =>
      Object.fromEntries(COLUMNS.map((c) => [c.id, c.initial])) as Record<
        ColumnId,
        number
      >
  )
  const [scrolled, setScrolled] = useState(false)
  const resizing = useRef<{
    id: ColumnId
    startX: number
    startW: number
  } | null>(null)

  const startResize = (event: React.PointerEvent, id: ColumnId) => {
    event.preventDefault()
    resizing.current = { id, startX: event.clientX, startW: widths[id] }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onResizeMove = (event: React.PointerEvent) => {
    const state = resizing.current
    if (!state) return
    const next = Math.max(
      90,
      Math.min(520, state.startW + (event.clientX - state.startX))
    )
    setWidths((w) => ({ ...w, [state.id]: next }))
  }

  const endResize = () => {
    resizing.current = null
  }

  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const someOn = rows.some((r) => selected.has(r.id))

  // Footer aggregates only fields owned by the Internal supplier projection.
  const historyKnown = rows.every((row) => row.historyEvents !== undefined)
  const historyTotal = historyKnown
    ? rows.reduce((sum, row) => sum + (row.historyEvents ?? 0), 0)
    : null
  const active = rows.filter((row) => row.status === "active").length
  const tagCount = new Set(rows.flatMap((r) => r.tags)).size

  const rule =
    "border-r border-r-[color-mix(in_srgb,var(--line)_78%,transparent)]"
  const stickyShadow = scrolled
    ? "shadow-[6px_0_8px_-9px_rgb(18_18_18/.45)]"
    : ""

  /* The company column is fixed and resizable, categories takes whatever is
   * left, and this has to be recomputed as the user drags a handle — a
   * module-level constant cannot reflect that. */
  const columns = `${widths.company}px minmax(0,1fr) ${widths.history}px ${widths.status}px`

  /* No cell here carries a row-wide click, so VirtualRows' `onRowClick` (which
   * also paints a pointer cursor the original row never had) is not what
   * reproduces the hover highlight, the row-number/checkbox swap, or the
   * hover-revealed website icon — those all key off the same "is this row
   * hovered" fact, tracked locally instead. */
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const rowProps = (id: string) => ({
    onMouseEnter: () => setHoveredId(id),
    onMouseLeave: () =>
      setHoveredId((current) => (current === id ? null : current)),
  })

  return (
    <div
      tabIndex={0}
      onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}
      onPointerMove={onResizeMove}
      onPointerUp={endResize}
      className="min-h-0 flex-1 [scrollbar-color:var(--line-strong)_transparent] [scrollbar-gutter:stable] overflow-auto overscroll-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <VirtualRows
        rows={rows}
        rowKey={(row) => row.id}
        columns={columns}
        rowHeight={34}
        className="min-w-[700px] text-[13px] font-medium"
        empty={
          <div className="flex h-[190px] flex-col items-center justify-center gap-2 text-ink-4">
            <span className="grid size-[34px] place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
              <Icon path={paths.search} size={17} />
            </span>
            <span className="text-xs">Nothing matches this filter.</span>
          </div>
        }
        header={
          <>
            <span className={cn("sticky left-0 z-7 h-8 bg-surface text-left", rule, stickyShadow)}>
              <div className="relative flex h-8 w-full items-center gap-[7px] overflow-hidden py-0 pr-2.5 pl-1.5 text-[11px] font-semibold tracking-[0.04em] whitespace-nowrap text-ink-3 uppercase">
                <Check
                  checked={allOn}
                  mixed={!allOn && someOn}
                  label="Select all rows"
                  onChange={onToggleAll}
                />
                <span>Company</span>
                <ResizeHandle
                  onPointerDown={(e) => startResize(e, "company")}
                />
              </div>
            </span>
            <span className={cn("h-8 text-left text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase", rule)}>
              <HeaderButton
                label="Categories"
                sorted={sortedFor("categories")}
                onToggle={() => table.getColumn("categories")?.toggleSorting()}
              />
            </span>
            <span className={cn("relative h-8 text-left text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase", rule)}>
              <HeaderButton
                label="History"
                sorted={sortedFor("history")}
                onToggle={() => table.getColumn("history")?.toggleSorting()}
                numeric
                title="Purchase-order and receipt events attributed to this supplier"
              />
              <ResizeHandle
                onPointerDown={(e) => startResize(e, "history")}
                inHeaderCell
              />
            </span>
            <span className="relative h-8 text-left text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
              <HeaderButton
                label="Status"
                sorted={sortedFor("status")}
                onToggle={() => table.getColumn("status")?.toggleSorting()}
              />
              <ResizeHandle
                onPointerDown={(e) => startResize(e, "status")}
                inHeaderCell
              />
            </span>
          </>
        }
        renderRow={(row, index) => {
          const on = selected.has(row.id)
          const isOpen = openId === row.id
          const hovered = hoveredId === row.id
          const bg = hovered && on
            ? "bg-[color-mix(in_srgb,var(--accent)_11%,var(--surface))]"
            : on
              ? "bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface))]"
              : hovered
                ? "bg-hover"
                : isOpen
                  ? "bg-accent-tint"
                  : ""
          const showCheck = hovered || on

          return (
            <>
              <span
                {...rowProps(row.id)}
                role="gridcell"
                className={cn(
                  "sticky left-0 z-2 self-stretch overflow-visible py-0 pr-2.5 pl-1.5 transition-colors duration-[120ms]",
                  rule,
                  stickyShadow,
                  bg || "bg-surface"
                )}
              >
                <div className="flex h-full items-center gap-1">
                  {/* row numbers at rest; the checkbox takes their place on hover */}
                  <span
                    className={cn(
                      "inline-flex size-[22px] shrink-0 items-center justify-center font-mono text-[10.5px] text-ink-4 tabular-nums",
                      showCheck && "hidden"
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className={cn("hidden", showCheck && "inline-flex!")}>
                    <Check
                      checked={on}
                      label={`Select ${row.name}`}
                      onChange={() => onToggleRow(row.id)}
                    />
                  </span>
                  <span className="grid size-5 shrink-0 place-items-center rounded-chip bg-inset text-[10px] font-semibold text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)]">
                    {row.name[0]}
                  </span>
                  <button
                    type="button"
                    title={row.name}
                    onClick={() => onOpenRow(row.id)}
                    className="min-w-0 overflow-hidden pl-0.5 text-left text-ellipsis whitespace-nowrap hover:underline hover:decoration-[color-mix(in_srgb,currentColor_35%,transparent)] hover:underline-offset-[3px]"
                  >
                    {row.name}
                  </button>
                  {/* the website is an affordance, not data — it rides with
                    the name and appears on hover */}
                  {row.site && (
                    <a
                      href={`https://${row.site}`}
                      target="_blank"
                      rel="noreferrer"
                      title={row.site}
                      aria-label={`Open ${row.site}`}
                      className={cn(
                        "ml-0.5 grid size-5 shrink-0 place-items-center rounded-[5px] text-ink-4 transition-[opacity,background-color,color] duration-[120ms] hover:bg-hover-2 hover:text-accent-ink focus-visible:opacity-100",
                        hovered ? "opacity-100" : "opacity-0"
                      )}
                    >
                      <Icon path={paths.external} size={12} width={2} />
                    </a>
                  )}
                </div>
              </span>

              <span
                {...rowProps(row.id)}
                role="gridcell"
                className={cn("self-stretch overflow-hidden px-2.5 transition-colors duration-[120ms]", rule, bg)}
              >
                <span className="flex h-full items-center">
                  <TagList tags={row.tags} />
                </span>
              </span>

              <span
                {...rowProps(row.id)}
                role="gridcell"
                className={cn("self-stretch px-2.5 transition-colors duration-[120ms]", rule, bg)}
              >
                <span className="flex h-full items-center">
                  <span
                    title={
                      row.historyEvents === undefined
                        ? "Internal did not provide supplier history for this row"
                        : `${row.historyEvents.toLocaleString("id-ID")} purchase-order and receipt events`
                    }
                    className="block w-full text-right font-mono text-xs text-ink-2 tabular-nums"
                  >
                    {row.historyEvents === undefined
                      ? "—"
                      : row.historyEvents.toLocaleString("id-ID")}
                  </span>
                </span>
              </span>

              <span
                {...rowProps(row.id)}
                role="gridcell"
                className={cn("self-stretch px-2.5 whitespace-nowrap transition-colors duration-[120ms]", bg)}
              >
                <span className="flex h-full items-center">
                  <Status status={row.status} />
                </span>
              </span>
            </>
          )
        }}
      />

      <div
        role="row"
        className="sticky bottom-0 z-4 grid h-[33px] items-center bg-inset text-xs text-ink-3"
        style={{ gridTemplateColumns: columns }}
      >
        <span
          role="gridcell"
          className={cn("sticky left-0 z-6! bg-inset px-2.5", rule, stickyShadow)}
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono text-ink-2 tabular-nums">
              {rows.length}
            </span>{" "}
            suppliers
          </span>
        </span>
        <span role="gridcell" className={cn("px-2.5", rule)}>
          <span className="text-ink-4">
            {tagCount ? `${tagCount} categories` : "—"}
          </span>
        </span>
        <span role="gridcell" className={cn("px-2.5", rule)}>
          <span
            title={
              historyKnown
                ? "Total purchase-order and receipt events"
                : "History data unavailable"
            }
            className="flex w-full justify-end font-mono text-ink-2 tabular-nums"
          >
            {historyTotal === null
              ? "—"
              : historyTotal.toLocaleString("id-ID")}
          </span>
        </span>
        <span role="gridcell" className="px-2.5">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="size-1.5 rounded-full bg-grass" />
            {active} active
          </span>
        </span>
      </div>
    </div>
  )
}

function ResizeHandle({
  onPointerDown,
  inHeaderCell,
}: {
  onPointerDown: (e: React.PointerEvent) => void
  inHeaderCell?: boolean
}) {
  return (
    <span
      onPointerDown={onPointerDown}
      className={cn(
        "group/resize absolute top-0 z-12 h-full w-3 cursor-col-resize touch-none",
        inHeaderCell ? "-right-1.5" : "-right-1.5"
      )}
    >
      <span className="absolute top-1.5 bottom-1.5 left-[5px] w-0.5 origin-center scale-y-[0.65] rounded-full bg-accent opacity-0 transition-[opacity,transform] duration-[150ms] ease-out-strong group-hover/resize:scale-y-100 group-hover/resize:opacity-100" />
    </span>
  )
}
