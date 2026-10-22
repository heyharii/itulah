import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { CalendarPlus, ClipboardCheck, MapPin, Plus } from "lucide-react"
import { Suspense, useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Choices, Section, Toggle } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { ListFilters } from "@/components/ui/list-filters"
import { PageHeader } from "@/components/ui/page-header"
import {
  CardFigure,
  CardName,
  type CardSpec,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { Pill, Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState, LoadingState, type Pageable } from "@/components/ui/states"
import type { Refreshable } from "@/components/ui/refresh-stamp"
import { SubTabs } from "@/components/ui/sub-tabs"
import { today } from "@/lib/calendar"
import {
  useFilterState,
  type FilterField,
  type FilterState,
} from "@/lib/filters"
import { count as formatCount, day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  gaAssetHub,
  gaAssets,
  gaInspectionBookQuery,
  gaKeys,
  gaTaskBookQuery,
  recordGaInspection,
  recordGaRepair,
  recordGaTask,
  updateGaMaintenanceTask,
  useGaSites,
} from "@/lib/queries/ga"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import { tableSetup, type TableSetup } from "@/lib/table"
import { TextAction } from "@/screens/assets/asset-sections"
import { everyWords } from "@/screens/assets/asset-words"
import {
  INSPECTION_RESULTS,
  INTERVAL_KINDS,
  inspectionState,
  nextDueAfter,
  taskStanding,
} from "@/screens/maintenance/format"
import { GlyphName } from "@/screens/maintenance/parts"
import { useFittedVisibility } from "@/screens/procurement/shared"
import type { GaInspectionRow, GaMaintenanceTaskRow } from "@itulah/contract"

/// Service Schedule — the quiet half of maintenance.
///
/// # Two lists, one page
///
/// The schedule says what is COMING (a recurring task for one asset or one
/// location); the inspections say what was FOUND (the record of somebody having
/// walked the floor). The second is the evidence the first is checked against,
/// which is why a finding can become a repair with one switch — the finding is
/// already written, and a repair that has to retype it is a repair that loses
/// the detail.
///
/// They are the page's two tabs (owner, 18 Oct 2026): two framed tables stacked
/// on one page pushed Status and the Record done buttons off the right edge, and
/// two infinite lists cannot both scroll with the window. The head's one
/// primary follows the tab: Add task on Tasks, Record inspection on Inspections.
///
/// # No money, on purpose
///
/// A schedule row is a date and a thing; no figure belongs to it. The costs
/// live on the repairs the tasks produce, in the Repairs book.
export function Schedule() {
  const [addingTask, setAddingTask] = useState(false)
  const [addingInspection, setAddingInspection] = useState(false)
  // The task whose service is being recorded as done, if any.
  const [doing, setDoing] = useState<GaMaintenanceTaskRow | null>(null)
  const [shelf, setShelf] = useState<Shelf>("TASKS")
  const phone = useLayout() === "phone"

  return (
    <PageContent>
      <PageHeader
        title="Service Schedule"
        small
        actions={
          // On a phone the one thing this page makes is the round button in
          // the dock, and it follows the tab.
          phone ? undefined : shelf === "TASKS" ? (
            <Button variant="primary" onClick={() => setAddingTask(true)}>
              <Plus />
              Add task
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setAddingInspection(true)}>
              <CalendarPlus />
              Record inspection
            </Button>
          )
        }
      />

      {shelf === "TASKS" ? (
        <Fab label="Add task" onClick={() => setAddingTask(true)} />
      ) : (
        <Fab
          label="Record inspection"
          onClick={() => setAddingInspection(true)}
        />
      )}

      <Suspense fallback={<LoadingState>Opening the schedule…</LoadingState>}>
        <ScheduleBook
          shelf={shelf}
          setShelf={setShelf}
          phone={phone}
          onAddTask={() => setAddingTask(true)}
          onAddInspection={() => setAddingInspection(true)}
          onDone={setDoing}
        />
      </Suspense>

      <TaskComposer open={addingTask} onClose={() => setAddingTask(false)} />

      <InspectionComposer
        open={addingInspection}
        onClose={() => setAddingInspection(false)}
      />

      {/* A task on one asset is done by inspecting it: the inspection names
          the task and the server moves the next date from the day it was
          done. A task on a whole location has no asset to inspect, so its
          next date is moved directly. Keyed by the task so each opening
          starts from that task's own values. */}
      <InspectionComposer
        key={`done-${doing?.task_id ?? "none"}`}
        open={doing !== null && doing.asset_id !== null}
        task={doing}
        onClose={() => setDoing(null)}
      />
      <TaskDoneSheet
        key={`site-${doing?.task_id ?? "none"}`}
        task={doing !== null && doing.asset_id === null ? doing : null}
        onClose={() => setDoing(null)}
      />
    </PageContent>
  )
}

/// The page's two tabs.
type Shelf = "TASKS" | "INSPECTIONS"

/// A task row: the task, its place and where it stands, said once on the row
/// because a column sorts by what is on the screen.
/// What each shelf is narrowed by, as the chip line under the search: how a
/// task counts (tasks) or what the inspection found (inspections).
const FIELDS: FilterField[] = [
  {
    column: "interval",
    label: "Interval",
    spec: {
      kind: "option",
      single: true,
      format: (value) =>
        INTERVAL_KINDS.find((one) => one.value === value)?.label ?? value,
      icon: (value) => INTERVAL_KINDS.find((one) => one.value === value)?.icon,
    },
  },
  {
    column: "result",
    label: "Result",
    spec: {
      kind: "option",
      single: true,
      format: (value) =>
        INSPECTION_RESULTS.find((one) => one.value === value)?.label ?? value,
      icon: (value) =>
        INSPECTION_RESULTS.find((one) => one.value === value)?.icon,
    },
  },
]

interface TaskLine {
  readonly task: GaMaintenanceTaskRow
  /// The site by its name: the task's own, or the place its asset stands in.
  readonly place: string
  readonly standing: ReturnType<typeof taskStanding>
}

/// An inspection row.
interface InspectionLine {
  readonly inspection: GaInspectionRow
  readonly state: ReturnType<typeof inspectionState>
}

/// The glyph a task wears: the one its interval's chip wears, so a row looks
/// like the choice that made it.
function intervalIcon(kind: string) {
  return (INTERVAL_KINDS.find((one) => one.value === kind) ?? INTERVAL_KINDS[1])
    .icon
}

/// The task's target as the grey line says it: the thing, or the whole place.
const targetOf = (task: GaMaintenanceTaskRow) =>
  task.asset_name ?? "Whole location"

/// Held at the widths their longest words need at 16px a side ("Due this
/// week" with its dot and the › a row shows under the pointer, "Every 10.000
/// km", "At 60.200 km", Record done), measured on the hub at 1440 (18 Oct). The
/// task takes the rest; at 1280 the location, then the interval, give way
/// before the table would scroll sideways.
function taskColumns(
  onDone: (task: GaMaintenanceTaskRow) => void
): ColumnDef<TableSetup, TaskLine>[] {
  return [
    {
      id: "task",
      accessorFn: (row) => row.task.title,
      header: "Task",
      size: 360,
      enableHiding: false,
      meta: { grow: 280 },
      // The task, and under it what it is for: the only second line in the row.
      cell: ({ row }) => (
        <GlyphName
          icon={intervalIcon(row.original.task.interval_kind)}
          name={row.original.task.title}
          quiet={targetOf(row.original.task)}
        />
      ),
    },
    {
      id: "location",
      accessorFn: (row) => row.place,
      header: "Location",
      size: 120,
      meta: { priority: 3 },
      cell: ({ row }) => (
        <span className="block truncate" title={row.original.place}>
          {row.original.place}
        </span>
      ),
    },
    {
      id: "every",
      accessorFn: (row) =>
        everyWords(row.task.interval_kind, row.task.interval_value),
      header: "Every",
      size: 156,
      meta: { priority: 2 },
      cell: ({ row }) => (
        <span className="block truncate tabular-nums">
          {everyWords(
            row.original.task.interval_kind,
            row.original.task.interval_value
          )}
        </span>
      ),
    },
    {
      id: "due",
      // A task with no date sorts after every date.
      accessorFn: (row) => row.task.next_due ?? "9999-12-31",
      header: "Next due",
      size: 124,
      // Red only once it is late: the date has passed or the odometer got there.
      cell: ({ row }) => (
        <span
          className={
            row.original.standing.late
              ? "text-bad-fg tabular-nums"
              : "tabular-nums"
          }
        >
          {row.original.standing.due}
        </span>
      ),
    },
    {
      id: "status",
      accessorFn: (row) => row.standing.word,
      header: "Status",
      size: 140,
      cell: ({ row }) => (
        <Status tone={row.original.standing.tone}>
          {row.original.standing.word}
        </Status>
      ),
    },
    {
      id: "act",
      header: "",
      size: 116,
      enableSorting: false,
      enableHiding: false,
      meta: { align: "right" },
      // Plain accent words, not a solid button on every row: the one verb the
      // row has, for a schedule that is running.
      cell: ({ row }) =>
        row.original.task.status === "ACTIVE" ? (
          <TextAction
            onClick={(event) => {
              event.stopPropagation()
              onDone(row.original.task)
            }}
          >
            Record done
          </TextAction>
        ) : null,
    },
  ]
}

const INSPECTION_COLUMNS: ColumnDef<TableSetup, InspectionLine>[] = [
  {
    id: "asset",
    accessorFn: (row) => row.inspection.asset_name,
    header: "Asset",
    size: 340,
    enableHiding: false,
    meta: { grow: 240 },
    cell: ({ row }) => (
      <GlyphName
        icon={ClipboardCheck}
        name={row.original.inspection.asset_name}
        quiet={row.original.inspection.asset_number}
      />
    ),
  },
  {
    id: "date",
    accessorFn: (row) => row.inspection.inspected_on,
    header: "Date",
    size: 124,
    cell: ({ row }) => (
      <span className="tabular-nums">
        {day(row.original.inspection.inspected_on)}
      </span>
    ),
  },
  {
    id: "by",
    accessorFn: (row) => row.inspection.inspected_by,
    header: "By",
    size: 160,
    meta: { priority: 3 },
    cell: ({ row }) => (
      <span
        className="block truncate"
        title={row.original.inspection.inspected_by}
      >
        {row.original.inspection.inspected_by}
      </span>
    ),
  },
  {
    id: "finding",
    accessorFn: (row) => row.inspection.findings,
    header: "Finding",
    size: 260,
    meta: { priority: 2 },
    cell: ({ row }) => (
      <span className="block truncate" title={row.original.inspection.findings}>
        {row.original.inspection.findings}
      </span>
    ),
  },
  {
    id: "result",
    accessorFn: (row) => row.state.word,
    header: "Result",
    size: 150,
    cell: ({ row }) => (
      <Status tone={row.original.state.tone}>{row.original.state.word}</Status>
    ),
  },
]

/// Asks for every page of a book while any is left, so the figures over it are
/// over the whole book and not over what has scrolled into view. These books
/// are a company's recurring services, hundreds at most; one that failed to
/// load a page is left to the foot of the list, which says so.
function useAllPages(query: {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError?: boolean
  fetchNextPage: () => unknown
}) {
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && isFetchNextPageError !== true)
      void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
}

/// The page under the head: the figures, the tabs, one bar and the list.
function ScheduleBook({
  shelf,
  setShelf,
  phone,
  onAddTask,
  onAddInspection,
  onDone,
}: {
  shelf: Shelf
  setShelf: (shelf: Shelf) => void
  phone: boolean
  onAddTask: () => void
  onAddInspection: () => void
  onDone: (task: GaMaintenanceTaskRow) => void
}) {
  const tasks = useSuspenseInfiniteQuery(gaTaskBookQuery())
  const inspections = useSuspenseInfiniteQuery(gaInspectionBookQuery())
  useAllPages(tasks)
  useAllPages(inspections)

  const [search, setSearch] = useState("")
  const filters = useFilterState(FIELDS)
  const held = (column: string) =>
    filters.filters.find((one) => one.column === column)?.values[0] ?? null
  const cadence = held("interval")
  const result = held("result")

  // Where an asset stands, for the tasks that name an asset and no place. The
  // same cached answer the forms read.
  const { sites } = useGaSites()
  const assets = useQuery({
    queryKey: gaKeys.assets({}),
    queryFn: ({ signal }) => gaAssets({ limit: 200 }, signal),
    staleTime: 5 * 60 * 1000,
  })
  const siteName = (siteId: string) =>
    sites.find((one) => one.value === siteId)?.label ?? siteId

  // `sites` is rebuilt every render; what it holds is not.
  const siteKey = sites.map((one) => `${one.value}:${one.label}`).join("|")
  const taskLines = useMemo<TaskLine[]>(() => {
    const standsIn = new Map(
      (assets.data?.rows ?? []).map((one) => [one.asset_id, one.site_id])
    )
    const names = new Map(sites.map((one) => [one.value, one.label]))
    return tasks.data.pages.flatMap((page) =>
      page.rows.map((task) => {
        const siteId =
          task.site_id ??
          (task.asset_id === null ? undefined : standsIn.get(task.asset_id))
        return {
          task,
          place: siteId === undefined ? "—" : (names.get(siteId) ?? siteId),
          standing: taskStanding(task),
        }
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.data, assets.data, siteKey])
  const inspectionLines = useMemo<InspectionLine[]>(
    () =>
      inspections.data.pages.flatMap((page) =>
        page.rows.map((inspection) => ({
          inspection,
          state: inspectionState(inspection.result),
        }))
      ),
    [inspections.data]
  )

  const needle = search.trim().toLowerCase()
  const taskFound = (line: TaskLine) =>
    needle === "" ||
    [
      line.task.title,
      line.task.asset_name,
      line.task.notes,
      line.task.contract_number,
      line.place,
    ].some((part) => part?.toLowerCase().includes(needle))
  const inspectionFound = (line: InspectionLine) =>
    needle === "" ||
    [
      line.inspection.asset_name,
      line.inspection.asset_number,
      line.inspection.findings,
      line.inspection.inspected_by,
    ].some((part) => part?.toLowerCase().includes(needle))

  const taskRows = useMemo(
    () =>
      taskLines.filter(
        (line) =>
          taskFound(line) &&
          (cadence === null || line.task.interval_kind === cadence)
      ),
    // `taskFound` is rebuilt every render; what it reads is below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskLines, needle, cadence]
  )
  const inspectionRows = useMemo(
    () =>
      inspectionLines.filter(
        (line) =>
          inspectionFound(line) &&
          (result === null || line.inspection.result === result)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inspectionLines, needle, result]
  )

  // The figures describe the book, whatever the bar narrows to.
  const active = taskLines.filter((line) => line.task.status === "ACTIVE")
  const dueThisWeek = active.filter(
    (line) => line.standing.word === "Due this week"
  ).length
  const overdue = active.filter((line) => line.standing.late).length
  const byDistance = active.filter(
    (line) => line.task.interval_kind === "KM"
  ).length
  const thisMonth = today().slice(0, 7)
  const inspectedThisMonth = inspectionLines.filter((line) =>
    line.inspection.inspected_on.startsWith(thisMonth)
  ).length

  // The tab counts are over what the search leaves.
  const taskCount = taskLines.filter(taskFound).length
  const inspectionCount = inspectionLines.filter(inspectionFound).length

  // The chips: only the answers there are, each with how many it leaves.
  const withCounts = useMemo<FilterField[]>(
    () =>
      shelf === "TASKS"
        ? [
            {
              ...FIELDS[0],
              spec: {
                ...FIELDS[0].spec,
                counted: INTERVAL_KINDS.map((one) => ({
                  value: one.value,
                  count: taskLines.filter(
                    (line) =>
                      taskFound(line) && line.task.interval_kind === one.value
                  ).length,
                })),
              },
            },
          ]
        : [
            {
              ...FIELDS[1],
              spec: {
                ...FIELDS[1].spec,
                counted: INSPECTION_RESULTS.map((one) => ({
                  value: one.value,
                  count: inspectionLines.filter(
                    (line) =>
                      inspectionFound(line) &&
                      line.inspection.result === one.value
                  ).length,
                })),
              },
            },
          ],
    // `taskFound` and `inspectionFound` are rebuilt every render; what they
    // read is below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shelf, taskLines, inspectionLines, needle]
  )
  const model: FilterState = { ...filters, fields: withCounts }

  // The server reads tasks soonest due first (undated last); a header press
  // re-sorts what is loaded.
  const [taskSorting, setTaskSorting] = useState<SortingState>([])
  const [inspectionSorting, setInspectionSorting] = useState<SortingState>([])
  // The columns close over what Record done opens, which is this screen's.
  const columns = useMemo(() => taskColumns(onDone), [onDone])
  const taskFit = useFittedVisibility(columns, {})
  const inspectionFit = useFittedVisibility(INSPECTION_COLUMNS, {})
  const taskTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: taskRows,
        columns,
        getRowId: (row: TaskLine) => row.task.task_id,
        state: { sorting: taskSorting, columnVisibility: taskFit.shown },
        onSortingChange: setTaskSorting,
        onColumnVisibilityChange: taskFit.change,
      }),
      // `taskFit.shown` is rebuilt every render; what it is made of is not.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [taskRows, columns, taskSorting, taskFit.hidden, taskFit.visibility]
    )
  )
  const inspectionTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: inspectionRows,
        columns: INSPECTION_COLUMNS,
        getRowId: (row: InspectionLine) => row.inspection.inspection_id,
        state: {
          sorting: inspectionSorting,
          columnVisibility: inspectionFit.shown,
        },
        onSortingChange: setInspectionSorting,
        onColumnVisibilityChange: inspectionFit.change,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        inspectionRows,
        inspectionSorting,
        inspectionFit.hidden,
        inspectionFit.visibility,
      ]
    )
  )

  const onTasks = shelf === "TASKS"
  const table = onTasks ? taskTable : inspectionTable
  const narrowed = needle !== "" || (onTasks ? cadence : result) !== null
  const choose = (next: Shelf) => {
    setShelf(next)
    setSearch("")
    filters.clear()
  }

  return (
    <>
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Due this week" value={formatCount(dueThisWeek)} />
        <Kpi
          label="Overdue"
          value={
            overdue > 0 ? (
              <span className="text-bad-fg">{formatCount(overdue)}</span>
            ) : (
              formatCount(overdue)
            )
          }
        />
        <Kpi label="By kilometre" value={formatCount(byDistance)} />
        <Kpi
          label="Inspections this month"
          value={formatCount(inspectedThisMonth)}
        />
      </KpiStrip>

      <SubTabs
        // On a phone the tab is the status chip over the bottom bar.
        className="max-md:hidden"
        tabs={[
          {
            value: "TASKS",
            label: <TabLabel text="Tasks" n={taskCount} />,
          },
          {
            value: "INSPECTIONS",
            label: <TabLabel text="Inspections" n={inspectionCount} />,
          },
        ]}
        value={shelf}
        onChange={(next) => choose(next as Shelf)}
      />

      {/* One bar: the search, then Columns at the right; how the schedule
          counts (or what the inspection found) is the chip line under it. On
          a phone they are the dock's. */}
      <div className="max-md:hidden">
        <Toolbar className="group/bar">
          <ListFilters
            model={model}
            search={{
              value: search,
              onChange: setSearch,
              label: onTasks ? "Search tasks" : "Search inspections",
            }}
          />
          <BarSpacer />
          <ColumnsMenu table={table} />
        </Toolbar>
      </div>

      <DockTools
        search={{
          value: search,
          onChange: setSearch,
          label: onTasks ? "Search tasks" : "Search inspections",
        }}
        filter={{
          count: (onTasks ? cadence : result) === null ? 0 : 1,
          panel: { model: filters, filterModel: model },
        }}
        status={{
          value: shelf,
          options: [
            { value: "TASKS", label: "Tasks", count: taskCount },
            {
              value: "INSPECTIONS",
              label: "Inspections",
              count: inspectionCount,
            },
          ],
          onChange: (next) => choose(next as Shelf),
        }}
      />

      {onTasks ? (
        <TaskList
          rows={taskRows}
          table={taskTable}
          fit={taskFit.ref}
          query={tasks}
          phone={phone}
          narrowed={narrowed}
          empty={taskLines.length === 0}
          onAdd={onAddTask}
          onDone={onDone}
        />
      ) : (
        <InspectionList
          rows={inspectionRows}
          table={inspectionTable}
          fit={inspectionFit.ref}
          query={inspections}
          phone={phone}
          narrowed={narrowed}
          empty={inspectionLines.length === 0}
          onAdd={onAddInspection}
        />
      )}
    </>
  )
}

/// A tab's word and its count, the count quiet (as Articles draws it).
function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <span>
      {text}
      <span className="ml-1.5 text-body tabular-nums">{formatCount(n)}</span>
    </span>
  )
}

/// The recurring tasks: a phone's cards, or one framed table.
function TaskList({
  rows,
  table,
  fit,
  query,
  phone,
  narrowed,
  empty,
  onAdd,
  onDone,
}: {
  rows: TaskLine[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  fit: (node: HTMLElement | null) => void
  query: Pageable & Refreshable
  phone: boolean
  narrowed: boolean
  empty: boolean
  onAdd: () => void
  onDone: (task: GaMaintenanceTaskRow) => void
}) {
  if (rows.length === 0)
    return (
      <Card>
        <EmptyState
          action={
            empty ? (
              <Button variant="ghost" onClick={onAdd}>
                Add the first task
              </Button>
            ) : undefined
          }
        >
          {narrowed && !empty
            ? "No task matches these filters."
            : "No recurring tasks yet."}
        </EmptyState>
      </Card>
    )
  if (phone)
    return (
      <PhoneCards
        rows={rows}
        rowId={(line) => line.task.task_id}
        spec={taskCard(onDone)}
        more={query}
      />
    )
  return (
    // `overflow-clip`, not `overflow-hidden`: hidden makes the card a scroll
    // box, and the heading would stick to the card instead of the window.
    <Card ref={fit} className="overflow-clip">
      <DataTable<TaskLine>
        refresh={[query]}
        table={table}
        more={query}
        // The window scrolls, not the table.
        pageScroll
        summary={{
          task: (
            <span>
              {formatCount(rows.length)}{" "}
              <span className="font-normal text-body">
                {rows.length === 1 ? "task" : "tasks"}
              </span>
            </span>
          ),
        }}
      />
    </Card>
  )
}

/// The inspections: a phone's cards, or one framed table.
function InspectionList({
  rows,
  table,
  fit,
  query,
  phone,
  narrowed,
  empty,
  onAdd,
}: {
  rows: InspectionLine[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  fit: (node: HTMLElement | null) => void
  query: Pageable & Refreshable
  phone: boolean
  narrowed: boolean
  empty: boolean
  onAdd: () => void
}) {
  if (rows.length === 0)
    return (
      <Card>
        <EmptyState
          action={
            empty ? (
              <Button variant="ghost" onClick={onAdd}>
                Record the first inspection
              </Button>
            ) : undefined
          }
        >
          {narrowed && !empty
            ? "No inspection matches these filters."
            : "No inspections yet."}
        </EmptyState>
      </Card>
    )
  if (phone)
    return (
      <PhoneCards
        rows={rows}
        rowId={(line) => line.inspection.inspection_id}
        spec={INSPECTION_CARD}
        more={query}
      />
    )
  return (
    <Card ref={fit} className="overflow-clip">
      <DataTable<InspectionLine>
        refresh={[query]}
        table={table}
        more={query}
        pageScroll
        summary={{
          asset: (
            <span>
              {formatCount(rows.length)}{" "}
              <span className="font-normal text-body">
                {rows.length === 1 ? "inspection" : "inspections"}
              </span>
            </span>
          ),
        }}
      />
    </Card>
  )
}

/// A recurring task as a phone's card: the job over what it is for and where,
/// when it is next due, how often, and the one quiet verb — Record done, plain
/// accent words as in the desk's rows — while it is active.
function taskCard(
  onDone: (task: GaMaintenanceTaskRow) => void
): CardSpec<TaskLine> {
  return {
    title: (line) => <CardName name={line.task.title} />,
    meta: [
      (line) =>
        [targetOf(line.task), line.place === "—" ? "" : line.place]
          .filter((part) => part !== "")
          .join(" · "),
      (line) => everyWords(line.task.interval_kind, line.task.interval_value),
    ],
    lead: (line) => (
      <CardFigure
        value={line.standing.due}
        caption="Next due"
        tone={
          line.standing.late
            ? "bad"
            : line.standing.due === "—"
              ? "quiet"
              : undefined
        }
      />
    ),
    foot: (line) => (
      <Status tone={line.standing.tone}>{line.standing.word}</Status>
    ),
    action: (line) =>
      line.task.status === "ACTIVE" ? (
        <TextAction
          onClick={(event) => {
            event.stopPropagation()
            onDone(line.task)
          }}
        >
          Record done
        </TextAction>
      ) : null,
  }
}

/// An inspection as a phone's card: the asset, when and by whom, what was
/// found, and the result.
const INSPECTION_CARD: CardSpec<InspectionLine> = {
  title: (line) => <CardName name={line.inspection.asset_name} />,
  meta: [
    (line) =>
      `${day(line.inspection.inspected_on)} · ${line.inspection.inspected_by}`,
    (line) => line.inspection.findings,
  ],
  action: (line) => <Pill tone={line.state.tone}>{line.state.word}</Pill>,
}

/// Recording a recurring task. The first question is WHOSE task it is — one
/// thing, or one place — because that decides what the rest of the form
/// asks for, and a task that is vaguely for both is a task nobody can tick
/// off.
///
/// `presetAssetId` is the asset sheet asking for a task for ITS asset: the
/// choice of whose task it is, and the asset itself, are already answered and
/// stay locked.
export function TaskComposer({
  open,
  onClose,
  presetAssetId,
}: {
  open: boolean
  onClose: () => void
  presetAssetId?: string
}) {
  const client = useQueryClient()
  const fresh = (): Record<string, string> => ({
    target: "ASSET",
    kind: "MONTHS",
    ...(presetAssetId === undefined ? {} : { asset: presetAssetId }),
  })
  const [form, setForm] = useState<Record<string, string>>(fresh)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const forAsset = (form.target ?? "ASSET") === "ASSET"
  const kind = form.kind ?? "MONTHS"
  const nextDueHidden = kind === "KM"

  const assets = useQuery({
    queryKey: gaKeys.assets({}),
    queryFn: ({ signal }) => gaAssets({ limit: 200 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const { sites: siteOptions } = useGaSites(open)
  const siteName = (siteId: string) =>
    siteOptions.find((one) => one.value === siteId)?.label ?? siteId

  // The preset asset's name, from the sheet that asked (already cached).
  const preset = useQuery({
    queryKey: gaKeys.asset(presetAssetId ?? ""),
    queryFn: ({ signal }) => gaAssetHub(presetAssetId ?? "", signal),
    enabled: open && presetAssetId !== undefined,
    staleTime: 5 * 60 * 1000,
  })

  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const save = useMutation({
    mutationFn: () =>
      recordGaTask({
        title: (form.title ?? "").trim(),
        asset_id: forAsset && form.asset !== "" ? form.asset : null,
        site_id: !forAsset && form.site !== "" ? form.site : null,
        interval_kind: kind,
        interval_value: Number(form.value),
        // A KM task has no next DATE — km is distance. The others must say
        // when they are next due, or the row has no job to do.
        next_due: nextDueHidden ? null : (form.next_due ?? ""),
        // A KM task is due at a reading instead (0975). Left empty, the server
        // takes the first multiple of the interval past the latest reading.
        next_due_km:
          nextDueHidden && (form.next_km ?? "") !== ""
            ? Number(form.next_km)
            : null,
        contract_id: form.contract === "" ? null : (form.contract ?? null),
        supplier_id: form.vendor === "" ? null : (form.vendor ?? null),
        notes: (form.notes ?? "").trim() === "" ? null : form.notes?.trim(),
      }),
    onSuccess: () => {
      // The schedule's own list and the overview's due-soon list both move.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm(fresh())
      onClose()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.title ?? "").trim() === "") next.title = "Enter the task first."
    if (forAsset && (form.asset ?? "") === "")
      next.asset = "Choose an asset first."
    if (!forAsset && (form.site ?? "") === "")
      next.site = "Choose a location first."
    if ((form.value ?? "") === "" || Number(form.value) <= 0)
      next.value = "Enter the interval number."
    if (!nextDueHidden && (form.next_due ?? "") === "")
      next.next_due = "Enter the next due date."
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="wide"
      title="New recurring task"
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Add task",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="flex flex-col gap-5">
        <Section title="For">
          {presetAssetId === undefined && (
            <Choices
              label="For"
              columns={2}
              value={form.target ?? "ASSET"}
              onChange={(next) => set("target", next)}
              options={[
                {
                  value: "ASSET",
                  label: "One asset",
                  icon: ClipboardCheck,
                  note: "A machine: the genset, a goods lift.",
                },
                {
                  value: "SITE",
                  label: "One location",
                  icon: MapPin,
                  note: "Every point at a place: the AC wash across a store.",
                },
              ]}
            />
          )}
          {forAsset ? (
            <Field label="Asset" required problem={problems.asset || undefined}>
              {presetAssetId !== undefined ? (
                <Select
                  value={presetAssetId}
                  onChange={() => undefined}
                  aria-label="Asset"
                  disabled
                >
                  <option value={presetAssetId}>
                    {preset.data === undefined
                      ? "This asset"
                      : `${preset.data.asset.name} · ${preset.data.asset.asset_number}`}
                  </option>
                </Select>
              ) : (
                <Select
                  value={form.asset ?? ""}
                  onChange={(next) => set("asset", next)}
                  aria-label="Asset"
                >
                  <option value="">Choose…</option>
                  {(assets.data?.rows ?? [])
                    .filter((one) => one.status !== "DRAFT")
                    .map((one) => (
                      <option key={one.asset_id} value={one.asset_id}>
                        {one.name} · {one.asset_number} ·{" "}
                        {siteName(one.site_id)}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          ) : (
            <Field
              label="Location"
              required
              problem={problems.site || undefined}
            >
              <Select
                value={form.site ?? ""}
                onChange={(next) => set("site", next)}
                aria-label="Location"
              >
                <option value="">Choose…</option>
                {siteOptions.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Task" required problem={problems.title || undefined}>
            <Input
              value={form.title ?? ""}
              onChange={(event) => set("title", event.target.value)}
            />
          </Field>
        </Section>

        <Section title="Interval">
          <div className="grid grid-cols-[1fr_10rem] items-start gap-4">
            <Choices
              label="Interval unit"
              columns={3}
              value={kind}
              onChange={(next) => set("kind", next)}
              options={INTERVAL_KINDS.map((one) => ({
                value: one.value,
                label: one.label,
                icon: one.icon,
              }))}
            />
            <Field label="Every" required problem={problems.value || undefined}>
              <Input
                inputMode="numeric"
                value={form.value ?? ""}
                onChange={(event) => set("value", event.target.value)}
              />
            </Field>
          </div>
          {nextDueHidden && forAsset && (
            <Field label="Next service at">
              <Money
                suffix="km"
                value={form.next_km ?? ""}
                onChange={(next) => set("next_km", next)}
              />
            </Field>
          )}
          {!nextDueHidden && (
            <Field
              label="Next due"
              required
              problem={problems.next_due || undefined}
            >
              <Input
                type="date"
                value={form.next_due ?? ""}
                onChange={(event) => set("next_due", event.target.value)}
              />
            </Field>
          )}
        </Section>

        <Section title="Assigned to">
          <Field label="Vendor">
            <Select
              value={form.vendor ?? ""}
              onChange={(next) => set("vendor", next)}
              aria-label="Vendor"
            >
              <option value="">Not yet decided</option>
              {(vendors.data?.rows ?? []).map((one) => (
                <option key={one.supplier_id} value={one.supplier_id}>
                  {one.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes">
            <Input
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
            />
          </Field>
        </Section>
      </div>
    </Sheet>
  )
}

/// Recording an inspection — and, through one switch, the repair the finding
/// calls for.
///
/// # The switch exists only when the answer asks for it
///
/// "Good" has no follow-up, so the switch is not drawn for it (brief §10.2).
/// The two other results do, and the switch lights by default: the finding
/// is already written, and the repair should carry it rather than make
/// somebody type it again. The repair appears in the Repairs book and in the
/// asset's history, with the inspection as its evidence.
export function InspectionComposer({
  open,
  task = null,
  presetAssetId,
  onClose,
}: {
  open: boolean
  /// The scheduled task this inspection answers. Its asset is fixed, and
  /// saving moves the task's next date.
  task?: GaMaintenanceTaskRow | null
  /// The asset sheet asking for an inspection of ITS asset: the asset is
  /// chosen already and stays locked.
  presetAssetId?: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const blankForm = (): Record<string, string> => ({
    result: "BAIK",
    by: "GA staff",
    inspected_on: today(),
    ...(presetAssetId === undefined ? {} : { asset: presetAssetId }),
    ...(task !== null && task.asset_id !== null
      ? { asset: task.asset_id, findings: `${task.title} done` }
      : {}),
  })
  const [form, setForm] = useState<Record<string, string>>(blankForm)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [makeRepair, setMakeRepair] = useState(true)
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const result = form.result ?? "BAIK"
  const needsRepair = result !== "BAIK" && makeRepair

  const assets = useQuery({
    queryKey: gaKeys.assets({}),
    queryFn: ({ signal }) => gaAssets({ limit: 200 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })
  const { sites: siteOptions } = useGaSites(open)
  const siteName = (siteId: string) =>
    siteOptions.find((one) => one.value === siteId)?.label ?? siteId

  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // The preset asset, from the sheet that asked (already cached): it gives the
  // locked field its name and the repair its site even when the asset is past
  // the first page of the list above.
  const preset = useQuery({
    queryKey: gaKeys.asset(presetAssetId ?? ""),
    queryFn: ({ signal }) => gaAssetHub(presetAssetId ?? "", signal),
    enabled: open && presetAssetId !== undefined,
    staleTime: 5 * 60 * 1000,
  })

  const asset =
    (assets.data?.rows ?? []).find((one) => one.asset_id === form.asset) ??
    (preset.data !== undefined && preset.data.asset.asset_id === form.asset
      ? preset.data.asset
      : undefined)
  // A km task is about a vehicle whether or not the asset is on the first page
  // of the list.
  const vehicle = asset?.build === "VEHICLE" || task?.interval_kind === "KM"

  const save = useMutation({
    mutationFn: async () => {
      // The inspection lands first, because the repair points back at it:
      // the record the finding produced must be able to name its evidence.
      const inspection = await recordGaInspection({
        asset_id: form.asset ?? "",
        inspected_on: form.inspected_on ?? "",
        inspected_by: (form.by ?? "").trim(),
        result,
        findings: (form.findings ?? "").trim(),
        task_id: task?.task_id ?? null,
        // The odometer at the visit, for a vehicle (0975): kept as its
        // reading, and what a km task's next service counts from.
        odometer_km:
          vehicle && (form.odometer ?? "") !== ""
            ? Number(form.odometer)
            : null,
      })
      if (!needsRepair) return inspection
      return recordGaRepair({
        site_id: asset?.site_id ?? "",
        asset_id: form.asset ?? "",
        // The server derives the object from the asset's class; the form
        // does not get a vote on what a laptop's repair is billed as.
        objek: null,
        title: (form.findings ?? "").trim(),
        supplier_id: form.vendor ?? "",
        contract_id: null,
        task_id: inspection.task_id,
        inspection_id: inspection.inspection_id,
        estimated_cost_minor: null,
        failure_at: form.inspected_on ?? "",
        notes: `From inspection ${day(inspection.inspected_on)}`,
      }).then(() => inspection)
    },
    onSuccess: () => {
      // The schedule's inspection list, the Repairs book and the asset's
      // history all read from the GA namespace.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm(blankForm())
      setMakeRepair(true)
      onClose()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.asset ?? "") === "") next.asset = "Choose an asset first."
    if ((form.findings ?? "").trim() === "")
      next.findings = "Enter the finding first."
    if ((form.by ?? "").trim() === "") next.by = "Enter who inspected it."
    if (needsRepair && (form.vendor ?? "") === "")
      next.vendor = "A repair needs a vendor — choose one first."
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="wide"
      title={task === null ? "New inspection" : `Record done · ${task.title}`}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: task === null ? "Record inspection" : "Record done",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="flex flex-col gap-5">
        <Section title="Asset and time">
          <Field label="Asset" required problem={problems.asset || undefined}>
            <Select
              value={form.asset ?? ""}
              onChange={(next) => set("asset", next)}
              aria-label="Asset"
              disabled={task !== null || presetAssetId !== undefined}
            >
              {/* The task's own asset, in case it is past the first page of
                  the list below. */}
              {task !== null && task.asset_id !== null && (
                <option value={task.asset_id}>
                  {task.asset_name ?? task.asset_id}
                </option>
              )}
              {/* The asset that asked for this inspection, for the same
                  reason. */}
              {presetAssetId !== undefined && task === null && (
                <option value={presetAssetId}>
                  {preset.data === undefined
                    ? "This asset"
                    : `${preset.data.asset.name} · ${preset.data.asset.asset_number}`}
                </option>
              )}
              <option value="">Choose…</option>
              {(assets.data?.rows ?? [])
                .filter(
                  (one) =>
                    one.status !== "DRAFT" &&
                    one.asset_id !== task?.asset_id &&
                    one.asset_id !== presetAssetId
                )
                .map((one) => (
                  <option key={one.asset_id} value={one.asset_id}>
                    {one.name} · {one.asset_number} · {siteName(one.site_id)}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="By" required problem={problems.by || undefined}>
              <Input
                value={form.by ?? ""}
                onChange={(event) => set("by", event.target.value)}
              />
            </Field>
            <Field label="Date">
              <Input
                type="date"
                value={form.inspected_on ?? ""}
                onChange={(event) => set("inspected_on", event.target.value)}
              />
            </Field>
          </div>
          {vehicle && (
            <Field label="Odometer">
              <Money
                suffix="km"
                value={form.odometer ?? ""}
                onChange={(next) => set("odometer", next)}
              />
            </Field>
          )}
        </Section>

        <Section title="Result">
          <Choices
            label="Result"
            columns={3}
            value={result}
            onChange={(next) => set("result", next)}
            options={INSPECTION_RESULTS.map((one) => ({
              value: one.value,
              label: one.label,
              icon: one.icon,
            }))}
          />
        </Section>

        <Section title="Finding">
          <Field
            label="Finding"
            required
            problem={problems.findings || undefined}
          >
            <Input
              value={form.findings ?? ""}
              onChange={(event) => set("findings", event.target.value)}
              autoFocus
            />
          </Field>

          {result !== "BAIK" && (
            <>
              <Toggle
                on={makeRepair}
                onToggle={() => setMakeRepair((current) => !current)}
                label="Create a repair from this finding"
                note={
                  makeRepair
                    ? "The repair carries this finding."
                    : "Only the finding is recorded."
                }
              />
              {makeRepair && (
                <Field
                  label="Repair vendor"
                  required
                  problem={problems.vendor || undefined}
                >
                  <Select
                    value={form.vendor ?? ""}
                    onChange={(next) => set("vendor", next)}
                    aria-label="Repair vendor"
                  >
                    <option value="">Choose a vendor…</option>
                    {(vendors.data?.rows ?? []).map((one) => (
                      <option key={one.supplier_id} value={one.supplier_id}>
                        {one.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </>
          )}
        </Section>
      </div>
    </Sheet>
  )
}

/// Recording that a location-wide task was done: an AC wash across a store, a
/// pest-control visit. There is no single asset to inspect, so nothing is
/// written to an asset's history — only the task's next date moves, counted
/// from the day the work was actually done.
function TaskDoneSheet({
  task,
  onClose,
}: {
  task: GaMaintenanceTaskRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const now = today()
  const [doneOn, setDoneOn] = useState(now)
  // Null until somebody types a date of their own; until then the next date
  // follows the done date.
  const [typed, setTyped] = useState<string | null>(null)
  const proposed =
    task === null
      ? null
      : nextDueAfter(task.interval_kind, task.interval_value, doneOn)
  const nextDue = typed ?? proposed ?? ""

  const save = useMutation({
    mutationFn: () =>
      updateGaMaintenanceTask(task?.task_id ?? "", {
        title: null,
        interval_kind: null,
        interval_value: null,
        next_due: nextDue,
        next_due_km: null,
        contract_id: null,
        supplier_id: null,
        status: null,
        notes: null,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onClose()
    },
  })

  return (
    <Sheet
      open={task !== null}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      title={task === null ? "Record done" : `Record done · ${task.title}`}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Record done",
            pending: save.isPending,
            disabled: nextDue === "",
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Done on">
            <Input
              type="date"
              value={doneOn}
              max={now}
              onChange={(event) => setDoneOn(event.target.value)}
            />
          </Field>
          <Field label="Next due" required>
            <Input
              type="date"
              value={nextDue}
              min={doneOn}
              onChange={(event) => setTyped(event.target.value)}
            />
          </Field>
        </div>
      </div>
    </Sheet>
  )
}
