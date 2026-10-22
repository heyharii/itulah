import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { LayoutGrid, Plus, X } from "lucide-react"
import {
  Suspense,
  useDeferredValue,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Money, Textarea } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { ListFilters } from "@/components/ui/list-filters"
import { PageHeader } from "@/components/ui/page-header"
import {
  CardFigure,
  type CardSpec,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { PickOne } from "@/components/ui/pick"
import { Status } from "@/components/ui/pill"
import { SheetSection } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetQuery } from "@/components/ui/sheet-states"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Timeline, type TimelineEvent } from "@/components/ui/timeline"
import { today } from "@/lib/calendar"
import {
  useFilterState,
  type Filter,
  type FilterField,
  type FilterState,
} from "@/lib/filters"
import { count, day, money, moneyCompact } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  gaKeys,
  gaSupply,
  moveGaSupplyRequest,
  recordGaBillRequest,
  useGaSites,
} from "@/lib/queries/ga"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import { recordInfo, recordKeys } from "@/lib/queries/records"
import { useUnits } from "@/lib/queries/units"
import { useCanWrite } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { toast } from "@/lib/toast"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { LocationHubSheet } from "@/screens/locations/hub"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"
import { useFittedVisibility } from "@/screens/procurement/shared"
import {
  BEFORE_RECEIPT,
  OPEN_STATUSES,
  STAGE_STATUSES,
  TAB_STATUSES,
  categoryIcon,
  isOverdue,
  quantityWords,
  supplyBookQuery,
  supplyCategoriesQuery,
  supplyCountQuery,
  supplyDueQuery,
  supplyStageTone,
  supplyStageWords,
  type SupplyScope,
  type SupplyStage,
  type SupplyTab,
} from "@/screens/supplies/book-data"
import { SupplyComposer } from "@/screens/supplies/composer"
import type { GaSupplyRequestRow } from "@itulah/contract"

/// Supply Requests — what the places run out of.
///
/// # What this screen is not
///
/// Not customer supplies, which Commercial spends on the shopper's behalf, and
/// not shopping bags, which Inventory holds as stock. Both have their own
/// category and their own owner elsewhere, and the seven categories this screen
/// offers are the ones the client's chart gives GA — the server refuses a
/// request that names any other.
///
/// # The list format, as Purchase Orders draws it
///
/// Head, figures, tabs, one bar, a framed table (owner, 17 Oct 2026, option A of
/// `supplies-options.html`). It replaced a blue banner, three figures, a table
/// with no search or filter and seven two-line columns that scrolled sideways
/// at 1440 with the Status cut off.
///
/// - The figures are the questions GA is asked: what waits for its decision,
///   what is with Procurement, what waits for the bill, and what is late. Each
///   is also a filter; the stage is a row of chips, and Overdue a switch beside
///   them. The tabs are the three places a request can be: Open, Completed,
///   Rejected.
/// - Category and stage are chips with their marks (owner, 18 Oct: no
///   dropdowns for a handful of answers); the place stays a picker, because
///   every site is an answer.
/// - The order number and the billed figure wait behind Columns. Completed
///   shows what was billed in place of the estimate, and Rejected shows the
///   reason in place of the date it was needed.
///
/// # No Procurement, and no sentence about it
///
/// There is no non-merchandise purchase order in this estate yet, so the PO
/// stage carries a typed order number rather than a link to a module that does
/// not exist. The sheet asks for it where it is entered; the list does not
/// explain the gap.
export function Supplies() {
  const open = useSheet("supply")
  const place = useSheet("location")
  const [tab, setTab] = useState<SupplyTab>("OPEN")
  const [stage, setStage] = useState<SupplyStage | null>(null)
  // The category, the place and the overdue switch are filters in the address
  // bar, the way Purchase Orders keeps them.
  const filters = useFilterState(FIELDS)
  const held = (column: string) =>
    filters.filters.find((one) => one.column === column)?.values[0] ?? null
  const choose = (column: string, value: string | null) =>
    filters.set([
      ...filters.filters.filter((one) => one.column !== column),
      ...(value === null
        ? []
        : [{ column, operator: "isAnyOf", values: [value] } as Filter]),
    ])
  const late = held("late") === "true"
  const setLate = (next: boolean) =>
    filters.set([
      ...filters.filters.filter((one) => one.column !== "late"),
      ...(next
        ? [{ column: "late", operator: "is", values: ["true"] } as Filter]
        : []),
    ])
  const category = held("category")
  const site = held("site")
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)
  const phone = useLayout() === "phone"
  // The search goes to the server, so it waits for the typing to stop: one
  // request per word rather than one per keystroke.
  const needle = useDebounced(search.trim(), 300)

  const bar: Bar = {
    tab,
    stage: tab === "OPEN" ? stage : null,
    late: tab === "OPEN" && late,
    category,
    site,
    search,
    needle,
  }
  const set: BarSetters = {
    // Each tab opens clean: a stage belongs to Open, and so does being late.
    tab: (next) => {
      setTab(next)
      setStage(null)
      if (next !== "OPEN") setLate(false)
    },
    stage: setStage,
    late: setLate,
    category: (next) => choose("category", next),
    site: (next) => choose("site", next),
    search: setSearch,
  }

  return (
    <PageContent>
      <PageHeader
        title="Supply Requests"
        small
        actions={
          // On a phone the one thing this page makes is its round button.
          phone ? undefined : (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Request supplies
            </Button>
          )
        }
      />

      <Fab label="Request supplies" onClick={() => setAdding(true)} />

      <Figures
        stage={bar.stage}
        late={bar.late}
        // A figure is its list's filter: the first press narrows to it, the
        // second takes it off again, and either brings the Open tab back.
        onStage={(next) => {
          setTab("OPEN")
          setStage(bar.stage === next ? null : next)
          setLate(false)
        }}
        onLate={() => {
          const on = !bar.late
          setTab("OPEN")
          setLate(on)
          if (on) setStage(null)
        }}
      />

      {/* The register waits for its first page and streams in with it (the
          server starts the read too). */}
      <Suspense
        fallback={<LoadingState>Loading supply requests…</LoadingState>}
      >
        <SupplyRegister
          bar={bar}
          set={set}
          filters={filters}
          phone={phone}
          selected={open.value}
          onOpen={open.open}
          onAdd={() => setAdding(true)}
        />
      </Suspense>

      <SupplyComposer
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(requestId) => {
          setAdding(false)
          open.open(requestId)
        }}
      />

      <SupplySheet
        key={open.value ?? "none"}
        requestId={open.value}
        open={open.isOpen}
        onClose={open.close}
        onOpenSite={place.open}
      />

      {/* The place a request is for, opened over it. Mounted only while the
          address names one. */}
      {place.value !== undefined && (
        <LocationHubSheet
          key={`location:${place.value}`}
          siteId={place.value}
          open={place.isOpen}
          onClose={place.close}
        />
      )}
    </PageContent>
  )
}

/// What the register is narrowed by besides its tab and stage: the category is
/// the chip line, the place is found by name in the search box, and the switch
/// is the Open tab's.
const FIELDS: FilterField[] = [
  {
    column: "category",
    label: "Category",
    spec: {
      kind: "option",
      single: true,
      icon: (value) => (value === null ? LayoutGrid : categoryIcon(value)),
    },
  },
  { column: "site", label: "Location", spec: { kind: "option", single: true } },
  { column: "late", label: "Overdue", spec: { kind: "boolean" } },
]

/// What the bar says, and what changes it.
interface Bar {
  readonly tab: SupplyTab
  /// Only ever set on the Open tab.
  readonly stage: SupplyStage | null
  /// Only ever on while the Open tab is.
  readonly late: boolean
  readonly category: string | null
  readonly site: string | null
  readonly search: string
  /// The search once the typing has stopped, for the server.
  readonly needle: string
}

interface BarSetters {
  readonly tab: (tab: SupplyTab) => void
  readonly stage: (stage: SupplyStage | null) => void
  readonly late: (late: boolean) => void
  readonly category: (category: string | null) => void
  readonly site: (site: string | null) => void
  readonly search: (search: string) => void
}

// ── the figures ─────────────────────────────────────────────────────────────

/// A figure's label, in the accent while the figure is the filter in force.
function Lead({ on, children }: { on: boolean; children: string }) {
  return <span className={cn(on && "text-accent")}>{children}</span>
}

/// How many requests are overdue, over the whole register: every request that
/// has not reached the shop yet and whose day has passed. The server has no
/// figure for it, so it is counted over the whole of those (one read, shared by
/// the figure and the switch).
function useOverdueCount(): number | undefined {
  const due = useQuery(supplyDueQuery())
  const todayIso = today()
  return due.data === undefined
    ? undefined
    : due.data.rows.filter((row) => isOverdue(row, todayIso)).length
}

/// To approve · With Procurement · To bill · Overdue — over the whole register,
/// whatever the bar narrows to: the figures describe the register, the tab
/// counts and the foot describe the list (as Assets does). They do not hold the
/// page up while they are read.
function Figures({
  stage,
  late,
  onStage,
  onLate,
}: {
  stage: SupplyStage | null
  late: boolean
  onStage: (stage: SupplyStage) => void
  onLate: () => void
}) {
  const book = useQuery(supplyCountQuery())
  const overdue = useOverdueCount()
  const stages = book.data?.statuses
  const of = (wanted: readonly string[]) =>
    stages === undefined
      ? undefined
      : stages
          .filter((one) => wanted.includes(one.value))
          .reduce((sum, one) => sum + one.count, 0)
  const figure = (n: number | undefined, tone?: "warn" | "bad") =>
    n === undefined ? (
      "—"
    ) : n > 0 && tone !== undefined ? (
      <span className={tone === "warn" ? "text-warn-fg" : "text-bad-fg"}>
        {count(n)}
      </span>
    ) : (
      count(n)
    )
  return (
    <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
      <Kpi
        label={<Lead on={stage === "approve"}>To approve</Lead>}
        value={figure(of(STAGE_STATUSES.approve), "warn")}
        onClick={() => onStage("approve")}
      />
      <Kpi
        label={<Lead on={stage === "procurement"}>With Procurement</Lead>}
        value={figure(of(STAGE_STATUSES.procurement))}
        onClick={() => onStage("procurement")}
      />
      <Kpi
        label={<Lead on={stage === "bill"}>To bill</Lead>}
        value={figure(of(STAGE_STATUSES.bill))}
        onClick={() => onStage("bill")}
      />
      <Kpi
        label={<Lead on={late}>Overdue</Lead>}
        value={figure(overdue, "bad")}
        onClick={onLate}
      />
    </KpiStrip>
  )
}

// ── the register ────────────────────────────────────────────────────────────

/// A row of the table: the request, with its place and quantity in words.
///
/// Looked up once on the row rather than in the cell: a column sorts by what is
/// on the screen.
interface SupplyLine {
  readonly row: GaSupplyRequestRow
  /// "Store 01": the site by its name, never its id.
  readonly place: string
  /// "1.000 Piece", read the way the person typed it.
  readonly qty: string | null
  /// Past the day it was needed and not yet at the shop.
  readonly late: boolean
}

/// The mark in the first cell: the category's own, in the tile the form's
/// choices wear, so a row looks like the choice that made it.
function CategoryTile({ code }: { code: string }) {
  const Glyph = categoryIcon(code)
  return (
    <span
      aria-hidden
      className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body"
    >
      <Glyph className="size-4 stroke-[1.7]" />
    </span>
  )
}

/// Columns a reader switches on in Columns; off at first.
const OFF_AT_FIRST = { po: false, billed: false }

const quiet = (text: ReactNode) => <span className="text-mute">{text}</span>

/// The columns every tab opens with. Held at the widths their longest words
/// need at 16px a side, measured on the hub at 1440 and 1280 (18 Oct): the
/// item takes the rest, about 220px at 1280, and the table never scrolls
/// sideways.
const ITEM: ColumnDef<TableSetup, SupplyLine> = {
  id: "item",
  accessorFn: (line) => line.row.item,
  header: "Item",
  size: 320,
  meta: { grow: 220 },
  enableHiding: false,
  // The item with its mark, and under it how many and what for: one quiet
  // line, the only second line in the row.
  cell: ({ row }) => {
    const { row: request, qty } = row.original
    const line = [qty, request.category_name].filter(Boolean).join(" · ")
    return (
      <span className="flex min-w-0 items-center gap-3">
        <CategoryTile code={request.category_code} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-ink" title={request.item}>
            {request.item}
          </span>
          <span className="truncate text-mute" title={line}>
            {line}
          </span>
        </span>
      </span>
    )
  },
}

const LOCATION: ColumnDef<TableSetup, SupplyLine> = {
  id: "location",
  accessorFn: (line) => line.place,
  header: "Location",
  size: 104,
  enableHiding: false,
  cell: ({ row }) => (
    <span className="block truncate" title={row.original.place}>
      {row.original.place}
    </span>
  ),
}

const REQUESTED_BY: ColumnDef<TableSetup, SupplyLine> = {
  id: "by",
  accessorFn: (line) => line.row.requested_by,
  header: "Requested by",
  size: 156,
  enableHiding: false,
  cell: ({ row }) => (
    <span className="block truncate" title={row.original.row.requested_by}>
      {row.original.row.requested_by}
    </span>
  ),
}

/// Off at first: the order number is Procurement's, typed here because there is
/// no module to point at.
const PO_NUMBER: ColumnDef<TableSetup, SupplyLine> = {
  id: "po",
  accessorFn: (line) => line.row.po_reference ?? "",
  header: "PO number",
  size: 176,
  cell: ({ row }) =>
    row.original.row.po_reference === null ? (
      quiet("—")
    ) : (
      <span className="block truncate" title={row.original.row.po_reference}>
        {row.original.row.po_reference}
      </span>
    ),
}

const NEEDED_BY: ColumnDef<TableSetup, SupplyLine> = {
  id: "needed",
  // A request with no day sorts after every date.
  accessorFn: (line) => line.row.needed_by ?? "9999-12-31",
  header: "Needed by",
  size: 128,
  enableHiding: false,
  cell: ({ row }) =>
    row.original.row.needed_by === null ? (
      quiet("No date")
    ) : (
      <span className={cn("tabular-nums", row.original.late && "text-bad-fg")}>
        {day(row.original.row.needed_by)}
      </span>
    ),
}

const REASON: ColumnDef<TableSetup, SupplyLine> = {
  id: "reason",
  accessorFn: (line) => line.row.rejected_reason ?? "",
  header: "Reason",
  size: 260,
  enableHiding: false,
  cell: ({ row }) => (
    <span
      className="line-clamp-2 whitespace-normal"
      title={row.original.row.rejected_reason ?? undefined}
    >
      {row.original.row.rejected_reason ?? "—"}
    </span>
  ),
}

const ESTIMATE: ColumnDef<TableSetup, SupplyLine> = {
  id: "amount",
  accessorFn: (line) => line.row.estimated_cost_minor ?? -1,
  header: "Estimate",
  size: 148,
  meta: { align: "right" },
  enableHiding: false,
  cell: ({ row }) =>
    row.original.row.estimated_cost_minor === null ? (
      quiet("—")
    ) : (
      <span className="tabular-nums">
        {money(row.original.row.estimated_cost_minor)}
      </span>
    ),
}

/// What Finance has posted against the request. Shown in place of the estimate
/// on Completed, and behind Columns on Open.
function billed(
  id: string,
  hideable: boolean
): ColumnDef<TableSetup, SupplyLine> {
  return {
    id,
    accessorFn: (line) => line.row.billed_minor,
    header: "Billed",
    size: 148,
    meta: { align: "right" },
    enableHiding: hideable,
    cell: ({ row }) =>
      row.original.row.billed_minor > 0 ? (
        <span className="tabular-nums">
          {money(row.original.row.billed_minor)}
        </span>
      ) : (
        quiet("—")
      ),
  }
}

const STATUS: ColumnDef<TableSetup, SupplyLine> = {
  id: "status",
  accessorFn: (line) => supplyStageWords(line.row.status),
  header: "Status",
  size: 136,
  enableHiding: false,
  cell: ({ row }) => (
    <Status tone={supplyStageTone(row.original.row.status)}>
      {supplyStageWords(row.original.row.status)}
    </Status>
  ),
}

const COLUMNS: Record<SupplyTab, ColumnDef<TableSetup, SupplyLine>[]> = {
  OPEN: [
    ITEM,
    LOCATION,
    REQUESTED_BY,
    PO_NUMBER,
    NEEDED_BY,
    ESTIMATE,
    billed("billed", true),
    STATUS,
  ],
  DONE: [
    ITEM,
    LOCATION,
    REQUESTED_BY,
    PO_NUMBER,
    NEEDED_BY,
    billed("amount", false),
  ],
  REJECTED: [ITEM, LOCATION, REQUESTED_BY, PO_NUMBER, REASON, ESTIMATE],
}

/// The open list reads what is needed soonest first; a closed list keeps the
/// server's order, newest request first.
const sortFor = (tab: SupplyTab): SortingState =>
  tab === "OPEN" ? [{ id: "needed", desc: false }] : []

/// The states the server is asked for: the tab's, or the stage's inside it, or
/// the ones a request can still be late in while the switch is on.
function statusesFor(bar: Bar): readonly string[] {
  if (bar.tab !== "OPEN") return TAB_STATUSES[bar.tab]
  if (bar.stage !== null) return STAGE_STATUSES[bar.stage]
  return bar.late ? BEFORE_RECEIPT : OPEN_STATUSES
}

function SupplyRegister({
  bar,
  set,
  filters,
  phone,
  selected,
  onOpen,
  onAdd,
}: {
  bar: Bar
  set: BarSetters
  filters: FilterState
  phone: boolean
  selected: string | undefined
  onOpen: (requestId: string) => void
  onAdd: () => void
}) {
  const scope = useMemo<SupplyScope>(
    () => ({
      q: bar.needle === "" ? undefined : bar.needle,
      site: bar.site ?? undefined,
      status: statusesFor(bar).join(","),
    }),
    // `bar` is rebuilt every render; what it is made of is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bar.needle, bar.site, bar.tab, bar.stage, bar.late]
  )
  // The list being replaced stays on screen while the next is read, so a
  // keystroke or a tab does not empty the table to a loading line.
  const asked = useDeferredValue(scope)
  const register = useSuspenseInfiniteQuery(supplyBookQuery(asked))
  const head = register.data.pages[0]

  const { sites } = useGaSites()
  const categories = useQuery(supplyCategoriesQuery())
  const units = useUnits()
  const overdueCount = useOverdueCount()
  const todayIso = today()

  const lines = useMemo<SupplyLine[]>(() => {
    const names = new Map(sites.map((one) => [one.value, one.label]))
    return register.data.pages.flatMap((page) =>
      page.rows.map((row) => ({
        row,
        place: names.get(row.site_id) ?? row.site_id,
        qty: quantityWords(row, units.units),
        late: isOverdue(row, todayIso),
      }))
    )
  }, [register.data, sites, units.units, todayIso])

  // The category and the switch are read off the rows: the server has no facet
  // for either. Chips count only once every page is in, because a count over
  // the pages scrolled so far would change with the scroll.
  const inLate = bar.late ? lines.filter((line) => line.late) : lines
  const rows =
    bar.category === null
      ? inLate
      : inLate.filter((line) => line.row.category_code === bar.category)
  const whole = !register.hasNextPage

  // The tab counts and the stage chips: the server's split by state over the
  // place and the search, whichever tab is open.
  const statuses = head?.statuses ?? []
  const of = (wanted: readonly string[]) =>
    statuses
      .filter((one) => wanted.includes(one.value))
      .reduce((sum, one) => sum + one.count, 0)
  const openCount = of(OPEN_STATUSES)
  const doneCount = of(TAB_STATUSES.DONE)
  const rejectedCount = of(TAB_STATUSES.REJECTED)

  // The category counts only once every page is in; until then it is named
  // without a figure.
  const siteNames = new Map(sites.map((one) => [one.value, one.label]))
  const withCounts = useMemo<FilterField[]>(
    () =>
      FIELDS.filter(
        (field) => field.column !== "late" || bar.tab === "OPEN"
      ).map((field) => {
        if (field.column === "category")
          return {
            ...field,
            spec: {
              ...field.spec,
              ...(whole
                ? {
                    counted: (categories.data ?? []).map((one) => ({
                      value: one.category_code,
                      count: inLate.filter(
                        (line) => line.row.category_code === one.category_code
                      ).length,
                    })),
                  }
                : {
                    options: (categories.data ?? []).map((one) => ({
                      value: one.category_code,
                      label: one.name,
                    })),
                  }),
              format: (value: string) =>
                (categories.data ?? []).find(
                  (one) => one.category_code === value
                )?.name ?? value,
            },
          }
        if (field.column === "site")
          return {
            ...field,
            spec: {
              ...field.spec,
              options: sites.map((one) => ({
                value: one.value,
                label: one.label ?? one.value,
              })),
              format: (value: string) => siteNames.get(value) ?? value,
            },
          }
        return field
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bar.tab, whole, categories.data, inLate, sites]
  )
  const model: FilterState = { ...filters, fields: withCounts }

  // Each tab opens on its own order, however the tab was changed (the tabs, the
  // dock or a figure).
  const [sorting, setSorting] = useState<SortingState>(() => sortFor(bar.tab))
  const [sortedFor, setSortedFor] = useState(bar.tab)
  if (sortedFor !== bar.tab) {
    setSortedFor(bar.tab)
    setSorting(sortFor(bar.tab))
  }
  const columns = COLUMNS[bar.tab]
  /// What fits the card: the order number and the billed figure wait behind
  /// Columns.
  const fit = useFittedVisibility(columns, OFF_AT_FIRST)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (line: SupplyLine) => line.row.request_id,
        state: { sorting, columnVisibility: fit.shown },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.change,
      }),
      // `fit.shown` is rebuilt every render; what it is made of is not.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, columns, sorting, fit.hidden, fit.visibility]
    )
  )

  const narrowed =
    bar.needle !== "" ||
    bar.site !== null ||
    bar.category !== null ||
    bar.late ||
    bar.stage !== null
  const narrowedClientSide = bar.category !== null || bar.late
  const total = narrowedClientSide ? rows.length : (head?.total ?? rows.length)
  const everyone = head?.total ?? rows.length

  const sum = (pick: (line: SupplyLine) => number) =>
    rows.reduce((all, line) => all + pick(line), 0)
  const amountSum =
    bar.tab === "DONE"
      ? sum((line) => line.row.billed_minor)
      : sum((line) => line.row.estimated_cost_minor ?? 0)

  const tabOptions = [
    { value: "OPEN", label: "Open", count: openCount },
    { value: "DONE", label: "Completed", count: doneCount },
    { value: "REJECTED", label: "Rejected", count: rejectedCount },
  ]

  const emptyWords = (): string => {
    if (bar.needle !== "") return "Nothing matches your search."
    if (bar.late) return "Nothing is overdue."
    if (narrowed) return "No request matches these filters."
    if (bar.tab === "REJECTED") return "Nothing has been rejected."
    if (bar.tab === "DONE") return "Nothing is billed yet."
    return "No request matches these filters."
  }

  return (
    <>
      <SubTabs
        // On a phone the tab is the status chip over the bottom bar.
        className="max-md:hidden"
        tabs={tabOptions.map((one) => ({
          value: one.value,
          label: <TabLabel text={one.label} n={one.count} />,
        }))}
        value={bar.tab}
        onChange={(next) => set.tab(next as SupplyTab)}
      />

      {/* One bar: the search (which also finds a place), the switch that
          finds what is late, then Columns at the right; under it the
          categories as a line of chips. On a phone they are the dock's. */}
      <div className="max-md:hidden">
        <Toolbar className="group/bar mb-2.5">
          <ListFilters
            model={model}
            search={{
              value: bar.search,
              onChange: set.search,
              label: "Search requests",
            }}
          />
          <BarSpacer />
          <ColumnsMenu table={table} />
        </Toolbar>
      </div>

      <DockTools
        search={{
          value: bar.search,
          onChange: set.search,
          label: "Search requests",
        }}
        filter={{
          count: (bar.stage === null ? 0 : 1) + filters.filters.length,
          panel: { model: filters, filterModel: model },
        }}
        status={{
          value: bar.tab,
          options: tabOptions,
          onChange: (next) => set.tab(next as SupplyTab),
        }}
      />

      <div aria-busy={asked !== scope || undefined} className="list-swap">
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              action={
                everyone === 0 && !narrowed ? (
                  <Button variant="ghost" onClick={onAdd}>
                    Request the first one
                  </Button>
                ) : undefined
              }
            >
              {everyone === 0 && !narrowed
                ? "No supply requests yet."
                : emptyWords()}
            </EmptyState>
          </Card>
        ) : phone ? (
          <PhoneCards
            rows={rows}
            rowId={(line) => line.row.request_id}
            spec={supplyCard(bar.tab)}
            onOpen={(line) => onOpen(line.row.request_id)}
            more={register}
          />
        ) : (
          // `overflow-clip`, not `overflow-hidden`: hidden makes the card a
          // scroll box, and the heading would stick to the card instead of
          // the window.
          <Card ref={fit.ref} className="overflow-clip">
            <DataTable<SupplyLine>
              refresh={[register]}
              table={table}
              onRowClick={(line) => onOpen(line.row.request_id)}
              isSelected={(line) => line.row.request_id === selected}
              more={register}
              // The window scrolls, not the table.
              pageScroll
              summary={{
                item: (
                  <span>
                    {count(total)}{" "}
                    <span className="font-normal text-body">
                      {total === 1 ? "request" : "requests"}
                      {!narrowedClientSide && total !== everyone
                        ? ` of ${count(everyone)}`
                        : ""}
                    </span>
                  </span>
                ),
                amount: (
                  <span className="tabular-nums">{money(amountSum)}</span>
                ),
                billed: (
                  <span className="tabular-nums">
                    {money(sum((line) => line.row.billed_minor))}
                  </span>
                ),
              }}
            />
          </Card>
        )}
      </div>
    </>
  )
}

/// A tab's word and its count, the count quiet (as Articles draws it).
function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <span>
      {text}
      <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
    </span>
  )
}

/// The same row as a phone card: the item with its mark and how many, what it
/// is for and where; the figure the tab is read for (the estimate, or what was
/// billed), the day it is needed in the foot — red once it is late — and its
/// state where the thumb rests.
function supplyCard(tab: SupplyTab): CardSpec<SupplyLine> {
  return {
    title: (line) => (
      <span className="flex items-start gap-2.5">
        <CategoryTile code={line.row.category_code} />
        <span className="min-w-0 pt-0.5 break-words">{line.row.item}</span>
      </span>
    ),
    meta: [
      (line) => [line.qty, line.row.category_name].filter(Boolean).join(" · "),
      (line) => `${line.place} · ${line.row.requested_by}`,
      (line) =>
        tab === "REJECTED" ? line.row.rejected_reason : line.row.po_reference,
    ],
    lead: (line) => {
      const minor =
        tab === "DONE" ? line.row.billed_minor : line.row.estimated_cost_minor
      return minor === null || minor === 0 ? undefined : (
        <CardFigure
          value={<span title={money(minor)}>{moneyCompact(minor)}</span>}
          caption={tab === "DONE" ? "Billed" : "Estimate"}
        />
      )
    },
    foot: (line) =>
      tab === "REJECTED" ? undefined : line.row.needed_by === null ? (
        "No date"
      ) : (
        <span className={cn("tabular-nums", line.late && "text-bad-fg")}>
          Needed by {day(line.row.needed_by)}
        </span>
      ),
    action: (line) => (
      <Status tone={supplyStageTone(line.row.status)}>
        {supplyStageWords(line.row.status)}
      </Status>
    ),
  }
}

// ── the request sheet ───────────────────────────────────────────────────────

/// REQUESTED → APPROVED → ORDERED → RECEIVED → BILLED, with REJECTED the one
/// exit. The list is the same law the server enforces (`SUPPLY_STATUS_FLOW` +
/// `supply_may_move` in `domain/ga.rs`), so the foot and the validator cannot
/// disagree.
const FLOW = ["REQUESTED", "APPROVED", "ORDERED", "RECEIVED", "BILLED"] as const

/// Who has the request next, as the step says it.
const WAITING: Readonly<Record<string, string>> = {
  APPROVED: "Waiting for GA",
  ORDERED: "Waiting for Procurement",
  BILLED: "Waiting for GA",
}

/// What the sheet is doing: reading the request, or asking the one thing the
/// next step needs.
type Mode = "read" | "po" | "bill" | "reject"

/// One request: how far it has got and who has it, the day it is needed and
/// what it is for. Opened as a rail with no tabs (owner, 17 Oct 2026, option A
/// of `supplies-options.html`).
///
/// # The foot is the next step
///
/// Only the verb the state allows, named: Approve (and Reject) → Add PO number
/// → Mark received → Send bill to Finance → Close. A step that asks something
/// swaps its fields in under the same figures, and Cancel goes back to the
/// request.
///
/// # Who and when, read off the record's activity
///
/// The request carries no step dates. Each move is written to the record's
/// activity with who made it and when, and the moves go one rung at a time, so
/// the nth move is the nth step. The first step has no date: nothing records
/// the day a request was filed against the request itself.
///
/// # Why this reads its own row
///
/// The register pages, so the request a link names may be on a page the table
/// has not loaded. The sheet reads `GET /ga/supplies/{id}` instead of searching
/// the list's cache, and a link straight to `?supply=…` lands wherever in the
/// register the request sits.
export function SupplySheet({
  requestId,
  open,
  onClose,
  onOpenSite,
}: {
  requestId: string | undefined
  open: boolean
  onClose: () => void
  /// Opens the place the request is for, as a layer over this one.
  onOpenSite: (siteId: string) => void
}) {
  const client = useQueryClient()
  const id = requestId ?? ""
  const enabled = open && requestId !== undefined
  const request = useQuery({
    queryKey: gaKeys.supply(id),
    queryFn: ({ signal }) => gaSupply(id, signal),
    enabled,
  })
  // The same read the Activity fold at the foot of the sheet makes, so the
  // steps and the fold are one request.
  const info = useQuery({
    queryKey: recordKeys.info("supply_request", id),
    queryFn: ({ signal }) => recordInfo("supply_request", id, signal),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 15_000,
  })
  const { sites } = useGaSites(enabled)
  const units = useUnits()
  const canWrite = useCanWrite()

  const [mode, setMode] = useState<Mode>("read")
  const [form, setForm] = useState<Record<string, string>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  // The bill reached Finance and the request did not move: the second press
  // moves it, and does not send the bill again.
  const [billSent, setBillSent] = useState(false)
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const row = request.data
  const siteName =
    row === undefined
      ? ""
      : (sites.find((one) => one.value === row.site_id)?.label ?? row.site_id)

  // The vendors, from the book of parties that send bills; read only when a
  // bill is being sent.
  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: enabled && mode === "bill",
    staleTime: 5 * 60 * 1000,
  })

  const done = (words: string) => {
    // The list, the overview's new-request section and this sheet are one
    // answer under the GA prefix; they drop together, and so does the record's
    // activity, which is not under it.
    void client.invalidateQueries({ queryKey: gaKeys.all })
    void client.invalidateQueries({
      queryKey: recordKeys.info("supply_request", id),
    })
    setMode("read")
    setForm({})
    setProblems({})
    toast.success(words)
  }

  const move = useMutation({
    mutationFn: (step: {
      to: string
      po_reference: string | null
      rejected_reason: string | null
    }) => moveGaSupplyRequest(id, step),
    onSuccess: (_, step) =>
      done(
        step.to === "APPROVED"
          ? "Request approved"
          : step.to === "ORDERED"
            ? "PO number saved"
            : step.to === "RECEIVED"
              ? "Marked received"
              : "Request rejected"
      ),
  })

  // Send the bill, then move the request: two calls the server does not make
  // one, because sending a bill files a draft in Finance and the stage is GA's
  // own record. When the first lands and the second does not, the sheet says so
  // and the next press only moves the stage.
  const bill = useMutation({
    mutationFn: async () => {
      if (row === undefined) return
      if (!billSent) {
        await recordGaBillRequest({
          supplier_id: (form.supplier ?? "").trim(),
          supplier_name: null,
          invoice_number: (form.invoice ?? "").trim(),
          invoice_date: form.invoice_date ?? "",
          due_date: null,
          subtotal_minor: Number(form.amount ?? 0),
          tax_minor: 0,
          note: null,
          document_ref: null,
          lines: [
            {
              site_id: row.site_id,
              account_code: null,
              amount_minor: Number(form.amount ?? 0),
              category_code: null,
              asset_id: null,
              contract_id: null,
              repair_id: null,
              replacement_id: null,
              supply_request_id: row.request_id,
              service_period_start: null,
              service_period_end: null,
              memo: row.item,
            },
          ],
        })
        setBillSent(true)
      }
      try {
        await moveGaSupplyRequest(id, {
          to: "BILLED",
          po_reference: null,
          rejected_reason: null,
        })
      } catch (problem) {
        throw new Error(
          `The bill is with Finance, but the request did not move to Billed${
            problem instanceof Error ? `: ${problem.message}` : "."
          } Press Mark as billed to try again.`
        )
      }
    },
    onSuccess: () => {
      setBillSent(false)
      done("Bill sent to Finance")
    },
  })

  const enter = (next: Mode) => {
    if (row === undefined) return
    move.reset()
    bill.reset()
    setProblems({})
    setForm(
      next === "bill"
        ? {
            invoice_date: today(),
            amount:
              row.estimated_cost_minor === null
                ? ""
                : String(row.estimated_cost_minor),
          }
        : {}
    )
    setMode(next)
  }

  const send = (to: string) =>
    move.mutate({ to, po_reference: null, rejected_reason: null })

  const savePo = () => {
    if ((form.po ?? "").trim() === "") {
      setProblems({ po: "Enter the PO number." })
      return
    }
    move.mutate({
      to: "ORDERED",
      po_reference: (form.po ?? "").trim(),
      rejected_reason: null,
    })
  }

  const sendBill = () => {
    if (billSent) {
      bill.mutate()
      return
    }
    const next: Record<string, string> = {}
    if ((form.supplier ?? "") === "") next.supplier = "Choose the supplier."
    if ((form.invoice ?? "").trim() === "")
      next.invoice = "Enter the invoice number."
    if ((form.invoice_date ?? "") === "") next.invoice_date = "Enter the day."
    if (!(Number(form.amount ?? 0) > 0)) next.amount = "Enter the amount."
    setProblems(next)
    if (Object.keys(next).length > 0) return
    bill.mutate()
  }

  const reject = () => {
    if ((form.reason ?? "").trim() === "") {
      setProblems({ reason: "Write the reason first." })
      return
    }
    move.mutate({
      to: "REJECTED",
      po_reference: null,
      rejected_reason: (form.reason ?? "").trim(),
    })
  }

  // ── the foot: only what the state allows ──
  const foot = (() => {
    if (row === undefined) return undefined
    if (!canWrite || row.status === "BILLED" || row.status === "REJECTED")
      return <SheetFooter onCancel={onClose} cancelLabel="Close" />
    if (mode === "po")
      return (
        <SheetFooter
          error={move.error}
          onCancel={() => enter("read")}
          primary={{
            label: "Save PO number",
            pending: move.isPending,
            pendingLabel: "Saving…",
            onClick: savePo,
          }}
        />
      )
    if (mode === "bill")
      return (
        <SheetFooter
          error={bill.error}
          onCancel={() => enter("read")}
          primary={{
            label: billSent ? "Mark as billed" : "Send to Finance",
            pending: bill.isPending,
            pendingLabel: billSent ? "Moving…" : "Sending…",
            onClick: sendBill,
          }}
        />
      )
    if (mode === "reject")
      return (
        <SheetFooter
          error={move.error}
          onCancel={() => enter("read")}
          cancelLabel="Back"
          primary={
            <Button
              variant="destructive"
              pending={move.isPending}
              onClick={reject}
            >
              {move.isPending ? "Rejecting…" : "Reject request"}
            </Button>
          }
        />
      )
    switch (row.status) {
      case "REQUESTED":
        return (
          <SheetFooter
            error={move.error}
            danger={
              <Button variant="destructive" onClick={() => enter("reject")}>
                Reject
              </Button>
            }
            primary={{
              label: "Approve",
              pending: move.isPending,
              pendingLabel: "Approving…",
              onClick: () => send("APPROVED"),
            }}
          />
        )
      case "APPROVED":
        return (
          <SheetFooter
            primary={{ label: "Add PO number", onClick: () => enter("po") }}
          />
        )
      case "ORDERED":
        return (
          <SheetFooter
            error={move.error}
            primary={{
              label: "Mark received",
              pending: move.isPending,
              pendingLabel: "Marking received…",
              onClick: () => send("RECEIVED"),
            }}
          />
        )
      default:
        return (
          <SheetFooter
            primary={{
              label: "Send bill to Finance",
              onClick: () => enter("bill"),
            }}
          />
        )
    }
  })()

  const stepsAt = steps(row, info.data?.activity ?? [], siteName)

  return (
    <Sheet
      open={open}
      onOpenChange={(next, reason) => {
        if (next) return
        // Escape in a step's fields goes back to the request, then leaves.
        if (reason === "escape" && mode !== "read") {
          enter("read")
          return
        }
        onClose()
      }}
      size="rail"
      stack
      title={row === undefined ? "Supply request" : row.item}
      badge={
        row === undefined ? undefined : (
          <Status tone={supplyStageTone(row.status)}>
            {supplyStageWords(row.status)}
          </Status>
        )
      }
      caption={
        row === undefined ? undefined : `Requested by ${row.requested_by}`
      }
      subject={
        requestId === undefined
          ? undefined
          : { kind: "supply_request", id: requestId }
      }
      footer={foot}
    >
      <SheetQuery query={request} what="supply request">
        {(loaded) => (
          <>
            <SheetFigures
              items={[
                {
                  label: "Quantity",
                  value: quantityWords(loaded, units.units) ?? "—",
                },
                {
                  label: "Needed by",
                  value:
                    loaded.needed_by === null ? "—" : day(loaded.needed_by),
                  late: isOverdue(loaded, today()),
                },
                loaded.billed_minor > 0
                  ? { label: "Billed", value: money(loaded.billed_minor) }
                  : {
                      label: "Estimate",
                      value:
                        loaded.estimated_cost_minor === null
                          ? "—"
                          : money(loaded.estimated_cost_minor),
                    },
              ]}
            />

            {mode === "read" && (
              <>
                {loaded.status === "REJECTED" && (
                  <SheetSection title="Reason">
                    <p className="text-[0.9375rem] leading-[1.375rem] [overflow-wrap:anywhere] text-ink">
                      {loaded.rejected_reason ?? "—"}
                    </p>
                  </SheetSection>
                )}

                <SheetSection title="Steps">
                  <Timeline
                    events={stepsAt}
                    // A refusal is a red mark, which the kit's three states do
                    // not carry: the rejected step is the last node.
                    className={
                      loaded.status === "REJECTED"
                        ? "[&>li:last-child>span:first-of-type]:bg-bad-bg [&>li:last-child>span:first-of-type]:text-bad-fg"
                        : undefined
                    }
                  />
                </SheetSection>

                <SheetSection title="Details">
                  <Facts>
                    <Fact term="Category">{loaded.category_name}</Fact>
                    <Fact term="Location">
                      <button
                        type="button"
                        className="record-link text-left"
                        onClick={() => onOpenSite(loaded.site_id)}
                      >
                        {siteName}
                      </button>
                    </Fact>
                  </Facts>
                </SheetSection>
              </>
            )}

            {mode === "po" && (
              <SheetSection title="Purchase order">
                <Field
                  label="PO number"
                  required
                  problem={problems.po || undefined}
                >
                  <Input
                    value={form.po ?? ""}
                    onChange={(event) => set("po", event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") savePo()
                    }}
                    autoFocus
                  />
                </Field>
              </SheetSection>
            )}

            {mode === "bill" && (
              <SheetSection title="Bill">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="Supplier"
                    required
                    problem={problems.supplier || undefined}
                    className="sm:col-span-2"
                  >
                    <PickOne
                      label="Supplier"
                      placeholder="Choose…"
                      disabled={billSent}
                      value={form.supplier || null}
                      onChange={(next) => set("supplier", next ?? "")}
                      choices={(vendors.data?.rows ?? []).map((one) => ({
                        value: one.supplier_id,
                        label: supplierDisplayName(one),
                      }))}
                    />
                  </Field>
                  <Field
                    label="Invoice number"
                    required
                    problem={problems.invoice || undefined}
                  >
                    <Input
                      value={form.invoice ?? ""}
                      disabled={billSent}
                      onChange={(event) => set("invoice", event.target.value)}
                    />
                  </Field>
                  <Field
                    label="Invoice date"
                    required
                    problem={problems.invoice_date || undefined}
                  >
                    <Day
                      value={form.invoice_date ?? ""}
                      onChange={(next) => set("invoice_date", next)}
                      notAfter={today()}
                      clearable={false}
                      disabled={billSent}
                      label="Invoice date"
                    />
                  </Field>
                  <Field
                    label="Amount"
                    required
                    problem={problems.amount || undefined}
                    className="sm:col-span-2"
                  >
                    <Money
                      prefix="Rp"
                      value={form.amount ?? ""}
                      disabled={billSent}
                      onChange={(next) => set("amount", next)}
                    />
                  </Field>
                </div>
              </SheetSection>
            )}

            {mode === "reject" && (
              <SheetSection title="Reject">
                <Field
                  label="Reason"
                  required
                  problem={problems.reason || undefined}
                >
                  <Textarea
                    rows={3}
                    value={form.reason ?? ""}
                    onChange={(event) => set("reason", event.target.value)}
                    autoFocus
                  />
                </Field>
              </SheetSection>
            )}
          </>
        )}
      </SheetQuery>
    </Sheet>
  )
}

/// A figure or two over the facts: label over value, a hairline between, no
/// box. The record's own, at the width of a rail, where cards of figures would
/// not hold "Rp 1.700.000".
function SheetFigures({
  items,
}: {
  items: readonly {
    readonly label: string
    readonly value: ReactNode
    readonly late?: boolean
  }[]
}) {
  return (
    <div className="flex justify-between gap-x-4">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "min-w-0",
            index > 0 && "border-l border-hairline pl-4 md:pl-6"
          )}
        >
          <div className="text-[0.9375rem] text-body">{item.label}</div>
          <div
            className={cn(
              "mt-1 text-base leading-6 font-semibold tracking-[-0.02em] whitespace-nowrap tabular-nums",
              item.late === true ? "text-bad-fg" : "text-ink"
            )}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}

/// The steps of a request, numbered: a done step says who did it and when, the
/// next says whose turn it is, the rest wait in grey. A rejected request is two
/// steps — Submitted, and the refusal.
///
/// The moves are read off the record's activity, oldest first. They go one rung
/// at a time and the last is the request's present state, so each stage's move
/// is counted back from the end: an older step the activity never recorded
/// (seeded before the audit trail) is simply left without a name and a day.
function steps(
  row: GaSupplyRequestRow | undefined,
  activity: readonly {
    readonly at: string
    readonly display_name: string
    readonly method: string
    readonly path: string
    readonly status: number
  }[],
  siteName: string
): TimelineEvent[] {
  if (row === undefined) return []
  const moves = activity
    .filter(
      (entry) =>
        entry.method === "POST" &&
        entry.path.endsWith("/move") &&
        entry.status < 400
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const moveOf = (back: number) => moves[moves.length - 1 - back]

  if (row.status === "REJECTED") {
    const refused = moveOf(0)
    return [
      {
        id: "REQUESTED",
        title: supplyStageWords("REQUESTED"),
        detail: row.requested_by,
        state: "done",
      },
      {
        id: "REJECTED",
        title: supplyStageWords("REJECTED"),
        detail: refused?.display_name,
        at: refused === undefined ? undefined : day(refused.at),
        state: "done",
        icon: <X className="size-4" />,
      },
    ]
  }

  const at = FLOW.indexOf(row.status as (typeof FLOW)[number])
  return FLOW.map((stage, index): TimelineEvent => {
    const title = supplyStageWords(stage)
    if (index > at + 1) return { id: stage, title, state: "todo" }
    if (index === at + 1)
      return {
        id: stage,
        title,
        detail:
          stage === "RECEIVED" ? `Waiting for ${siteName}` : WAITING[stage],
        state: "current",
      }
    if (index === 0)
      return {
        id: stage,
        title,
        detail: row.requested_by,
        state: "done",
      }
    const made = moveOf(at - index)
    const detail =
      stage === "ORDERED"
        ? [row.po_reference, made?.display_name].filter(Boolean).join(" · ")
        : made?.display_name
    return {
      id: stage,
      title,
      detail: detail === "" ? undefined : detail,
      at: made === undefined ? undefined : day(made.at),
      state: "done",
    }
  })
}
