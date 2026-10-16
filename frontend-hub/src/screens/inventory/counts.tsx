import { useForm } from "@tanstack/react-form"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Field, Input } from "@/components/ui/field"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import {
  ITEMS_CELL,
  ITEMS_HEAD,
  ItemIdentity,
} from "@/screens/procurement/items-table"
import { pcs } from "@/screens/procurement/shared"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { SHOW_MISSING } from "@/lib/features"
import { useLayout } from "@/lib/layout"
import { count, day, label as humanise } from "@/lib/format"
import {
  activateCount,
  approveCount,
  countDetail,
  countsBookQuery,
  createCount,
  fleetPools,
  fleetPoolsQuery,
  idempotencyKey,
  inventoryKeys,
  submitCount,
  type CountBookScope,
  type CountDetail,
  type CountKind,
  type CountPage,
  type CountRow,
  type FleetPool,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import {
  groupMissing,
  useMissingRows,
  type MissingGroup,
} from "@/screens/inventory/missing-data"
import { Choice } from "@/screens/inventory/parts"
import { signed, useActor, writablePools } from "@/screens/inventory/shared"
import { cn } from "@/lib/utils"

/// Official counts — the only thing in this app that is allowed to tell the
/// ledger it is wrong.
///
/// The lifecycle is `DRAFT → ACTIVE → REVIEW → CLOSED` and nothing else. What
/// each step means depends entirely on who owns the site, and the fork is at
/// **activation**: with no DC owner the cloud freezes an expectation here and
/// the counting happens here; with one, the cloud projects nothing, sends a
/// command, and every later step is the DC's. Approving a DC-owned count does
/// not close it — it *asks* for a movement, and the count stays in review
/// until that node answers. The screen says which of the two it is on every
/// record rather than leaving a button that silently does something else.

const KINDS = [
  { value: "FULL", label: "Full" },
  { value: "CYCLE", label: "Cycle" },
  { value: "TARGETED", label: "Targeted" },
]

/// Which column means which of the five orders the endpoint names.
///
/// A column that is not in here cannot be sorted — `enableSorting: false` says
/// so on the column itself, so neither the header nor the Sort menu offers it.
/// The alternative is worse than a missing menu item: the table would sort the
/// PAGE it is holding, and a book sorted one screenful at a time is a list that
/// lies about where its first row is.
const SORTS: Record<string, string> = {
  pool_id: "pool",
  status: "status",
  difference: "variance",
  created_at: "created_at",
  closed_at: "closed_at",
}

/// Where a count stands, as one word and its tone.
function statusTone(status: CountRow["status"]) {
  return status === "CLOSED"
    ? "ok"
    : status === "REVIEW"
      ? "warn"
      : status === "ACTIVE"
        ? "info"
        : "neutral"
}

/// Status words in the owner's vocabulary rather than the lifecycle's.
const STATUS_WORD: Record<CountRow["status"], string> = {
  DRAFT: "Draft",
  ACTIVE: "Counting",
  REVIEW: "To review",
  CLOSED: "Closed",
}

/// A pool id read as the place and the shelf the rest of the hub calls it.
type PoolNames = ReadonlyMap<string, { site: string; pool: string }>

function poolNamesOf(items: readonly FleetPool[]): PoolNames {
  return new Map(
    items.map((pool) => [
      pool.id,
      { site: pool.site_name ?? pool.site_id, pool: pool.label },
    ])
  )
}

/// A count still being taken has found nothing yet, so it has no difference.
const counted = (status: CountRow["status"]) =>
  status === "REVIEW" || status === "CLOSED"

function differenceCell(expected: number, found: number, shown = true) {
  if (!shown) return <span className="text-mute">—</span>
  const difference = found - expected
  return (
    <span
      className={cn(
        "tabular-nums",
        difference < 0
          ? "text-bad-fg"
          : difference > 0
            ? "text-warn-fg"
            : "text-mute"
      )}
    >
      {difference === 0 ? "—" : signed(difference)}
    </span>
  )
}

/// The columns, calm (one size, one figure a cell): where it was counted, what
/// kind, where it stands, the three figures, and when it was opened.
const countColumns = (names: PoolNames): ColumnDef<TableSetup, CountRow>[] => [
  {
    // Ordered by the POOL it counts, which is the order the endpoint has.
    id: "pool_id",
    accessorFn: (row) => row.pool_id,
    header: "Place",
    size: 260,
    meta: { card: "hide", grow: true },
    cell: ({ row }) => {
      const name = names.get(row.original.pool_id)
      return (
        <span className="block truncate text-ink">
          {name?.site ?? row.original.site_id}
          <span className="text-mute">
            {" "}
            · {name?.pool ?? row.original.pool_id}
          </span>
        </span>
      )
    },
  },
  {
    accessorKey: "kind",
    header: "Kind",
    size: 110,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => humanise(row.original.kind),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 130,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <Pill tone={statusTone(row.original.status)}>
        {STATUS_WORD[row.original.status]}
      </Pill>
    ),
  },
  {
    accessorKey: "expected",
    header: "Expected",
    size: 110,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => count(row.original.expected),
  },
  {
    accessorKey: "found",
    header: "Found",
    size: 110,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => count(row.original.found),
  },
  {
    id: "difference",
    accessorFn: (row) => row.found - row.expected,
    header: "Difference",
    size: 120,
    meta: { align: "right", card: "hide" },
    // Sorted ascending by default so the deepest shortage is the first row.
    cell: ({ row }) =>
      differenceCell(
        row.original.expected,
        row.original.found,
        counted(row.original.status)
      ),
  },
  {
    accessorKey: "created_at",
    header: "Opened",
    size: 130,
    meta: { priority: 2, card: "hide" },
    cell: ({ row }) => day(row.original.created_at),
  },
  {
    accessorKey: "closed_at",
    header: "Closed",
    size: 130,
    meta: { priority: 3, card: "hide" },
    cell: ({ row }) =>
      row.original.closed_at === null ? (
        <span className="text-mute">—</span>
      ) : (
        day(row.original.closed_at)
      ),
  },
  // The phone's card: the place over the kind, the difference it leads with,
  // a foot with the figures and the date, and where it stands.
  {
    id: "head",
    accessorFn: (row) => row.pool_id,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => {
      const name = names.get(row.original.pool_id)
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[1rem] font-semibold break-words text-ink">
            {name?.site ?? row.original.site_id}
          </span>
          <span className="text-[0.9375rem] font-normal break-words text-mute">
            {name?.pool ?? row.original.pool_id} · {humanise(row.original.kind)}
          </span>
        </span>
      )
    },
  },
  {
    id: "lead",
    accessorFn: (row) => row.found - row.expected,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end">
        <span className="text-[1.25rem] leading-tight font-semibold">
          {differenceCell(
            row.original.expected,
            row.original.found,
            counted(row.original.status)
          )}
        </span>
        <span className="text-[0.9375rem] text-mute">difference</span>
      </span>
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.created_at,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {`Expected ${count(row.original.expected)} · Found ${count(row.original.found)} · ${day(row.original.created_at)}`}
      </span>
    ),
  },
  {
    id: "state",
    accessorFn: (row) => row.status,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => (
      <Pill tone={statusTone(row.original.status)}>
        {STATUS_WORD[row.original.status]}
      </Pill>
    ),
  },
]

/// The readings of the one list, as tabs under the figures — the PO list's
/// shape (owner, 16 Oct 2026: Counts "terlalu berbeda"). Each is just the
/// `status` parameter the endpoint already takes.
const SLICES = [
  { value: "", label: "All" },
  { value: "REVIEW", label: "To review" },
  { value: "ACTIVE", label: "Counting" },
  { value: "DRAFT", label: "Drafts" },
  { value: "CLOSED", label: "Closed" },
] as const

export function Counts() {
  const phone = useLayout() === "phone"
  const [composing, setComposing] = useState(false)
  const sheet = useSheet("count")

  return (
    <PageContent>
      {/* The screen's one action stands in its head; a phone has the + at the
          thumb (`Fab`). */}
      <PageHeader
        title="Counts"
        small
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setComposing(true)}>
              <Plus />
              New count
            </Button>
          )
        }
      />

      <Fab label="New Count" onClick={() => setComposing(true)} />

      <Suspense
        fallback={<LoadingState>Reading the count board…</LoadingState>}
      >
        <CountBoard />
      </Suspense>

      <CountSheet id={sheet.value ?? null} onClose={sheet.close} />
      <Composer open={composing} onClose={() => setComposing(false)} />
    </PageContent>
  )
}

function CountBoard() {
  /// Which reading is on screen, in the URL.
  const slice = useSheet("count-status")
  /// What was typed, also in the URL, and answered by the server against the
  /// pool id, the reason and who opened it.
  const search = useSheet("q")
  const phone = useLayout() === "phone"
  const sheet = useSheet("count")
  // The deepest shortage first: a count that found everything needs nobody.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "difference", desc: false },
  ])

  const fleet = useSuspenseQuery(fleetPoolsQuery())
  const names = useMemo(() => poolNamesOf(fleet.data.items), [fleet.data])
  const columns = useMemo(() => countColumns(names), [names])

  const needle = useDebounced((search.value ?? "").trim(), 400)
  const scope = useMemo<CountBookScope>(() => {
    const by = sorting[0]
    return {
      ...(slice.value === undefined ? {} : { status: slice.value }),
      ...(needle === "" ? {} : { q: needle }),
      sort: by === undefined ? undefined : SORTS[by.id],
      desc: by?.desc === true,
    }
  }, [needle, slice.value, sorting])

  // The deferred scope keeps the rows in hand on screen while the next question
  // is read, so a keystroke or a tab does not empty the table.
  const asked = useDeferredValue(scope)
  const board = useSuspenseInfiniteQuery(countsBookQuery(asked))

  const rows = useMemo(
    () => board.data.pages.flatMap((page) => page.rows),
    [board.data]
  )
  /// The first page carries the server's total and facets over the whole book.
  const head = board.data.pages[0]
  const all = useSuspenseInfiniteQuery(countsBookQuery({}))
  const book = all.data.pages[0]

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: CountRow) => row.id,
        state: {
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            state: phone,
          },
        },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, columns, sorting, phone]
    )
  )

  const tab = slice.value ?? ""
  const tabCount = (value: string) =>
    value === "" ? (book?.total ?? 0) : facetOf(book, value)

  return (
    <>
      <KpiStrip className="grid-cols-2 max-md:hidden md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Counts" value={count(book?.total ?? 0)} />
        <Kpi label="To review" value={count(facetOf(book, "REVIEW"))} />
        <Kpi label="Counting" value={count(facetOf(book, "ACTIVE"))} />
        <Kpi label="Drafts" value={count(facetOf(book, "DRAFT"))} />
      </KpiStrip>

      <SubTabs
        className="max-md:hidden"
        tabs={SLICES.map((one) => ({
          value: one.value,
          label: (
            <span>
              {one.label}
              <span className="ml-1.5 text-body tabular-nums">
                {count(tabCount(one.value))}
              </span>
            </span>
          ),
        }))}
        value={tab}
        onChange={(next) => (next === "" ? slice.close() : slice.open(next))}
      />

      {/* One line the width of the table: the search at the left, what shapes
          the table at the right. */}
      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={search.value ?? ""}
          onChange={(next) => (next ? search.open(next) : search.close())}
          label="Search counts"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      {/* A phone's status, search and order are the dock's and its New count
          the round plus, as on every list (owner, 2026-10-06). */}
      <DockTools
        search={{
          value: search.value ?? "",
          onChange: (next) => (next ? search.open(next) : search.close()),
          label: "Search Counts",
        }}
        sort={dockSortOf(table)}
        status={{
          value: tab,
          options: SLICES.map((one) => ({
            value: one.value,
            label: one.label,
            count: one.value === "" ? undefined : facetOf(head, one.value),
          })),
          onChange: (next) => (next === "" ? slice.close() : slice.open(next)),
        }}
      />

      <div aria-busy={asked !== scope || undefined} className="list-swap">
        <Card className="overflow-clip max-lg:overflow-visible max-lg:border-0 max-lg:bg-transparent max-lg:shadow-none">
          {rows.length === 0 ? (
            <EmptyState>
              {needle !== ""
                ? "Nothing matches."
                : tab === "REVIEW"
                  ? "Nothing to review."
                  : tab === "ACTIVE"
                    ? "Nothing being counted."
                    : tab === "DRAFT"
                      ? "No drafts."
                      : tab === "CLOSED"
                        ? "None closed."
                        : "No counts."}
            </EmptyState>
          ) : (
            <DataTable<CountRow>
              refresh={[board]}
              table={table}
              more={board}
              roomy
              pageScroll
              onRowClick={(row) => sheet.open(row.id)}
              isSelected={(row) => row.id === sheet.value}
              cardsApart
              cardLead
              cardSort={false}
            />
          )}
        </Card>
      </div>
    </>
  )
}

/// How many counts a status holds, over the whole book rather than the page.
function facetOf(page: CountPage | undefined, status: string): number {
  return (
    page?.facets.statuses.find((facet) => facet.value === status)?.count ?? 0
  )
}

/// One count as the PO detail reads (owner, 16 Oct 2026): the place as the
/// title with its status beside it, the figures first in the body, the lines,
/// then the facts of who and when; the next step is the foot's one verb.
function CountSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()

  const detail = useQuery({
    queryKey: inventoryKeys.count(id ?? ""),
    queryFn: ({ signal }) => countDetail(id!, signal),
    enabled: id !== null,
  })
  const fleet = useQuery(fleetPoolsQuery())
  const names = useMemo(
    () => poolNamesOf(fleet.data?.items ?? []),
    [fleet.data]
  )

  // Each of the writes changes this record and its row on the board.
  // Approving a cloud-owned count also posts movements, which is why the pools
  // and the missing list go too.
  const invalidate = () => {
    client.invalidateQueries({ queryKey: inventoryKeys.counts() })
    client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
    client.invalidateQueries({ queryKey: inventoryKeys.missing() })
    client.invalidateQueries({ queryKey: ["inventory", "pools"] })
  }

  const command = (
    run: (
      countId: string,
      body: { actor_id: string; idempotency_key: string }
    ) => Promise<unknown>
  ) => ({
    mutationFn: () =>
      run(id!, { actor_id: actor, idempotency_key: idempotencyKey() }),
    onSuccess: invalidate,
  })

  const activate = useMutation(command(activateCount))
  const submit = useMutation(command(submitCount))
  const approve = useMutation(command(approveCount))

  // Open Missing for the same pool: an over-count closes it before it is extra.
  const missingRows = useMissingRows().rows
  const missing = useMemo(() => groupMissing(missingRows), [missingRows])

  const failure = [activate, submit, approve].find((one) => one.isError)
  const data = detail.data
  const owned = data?.execution_authority === "EDGE_DC"
  const name = data === undefined ? undefined : names.get(data.pool_id)

  const footer =
    data === undefined ? undefined : data.status === "DRAFT" ? (
      <SheetFooter
        error={failure?.error}
        primary={{
          label: "Start counting",
          onClick: () => activate.mutate(),
          pending: activate.isPending,
          disabled: actor === "",
        }}
      />
    ) : data.status === "ACTIVE" && owned ? (
      <SheetFooter note="Being counted on the DC handheld" />
    ) : data.status === "ACTIVE" ? (
      <SheetFooter
        error={failure?.error}
        primary={{
          label: "Send to review",
          onClick: () => submit.mutate(),
          pending: submit.isPending,
          disabled: actor === "",
        }}
      />
    ) : data.status === "REVIEW" ? (
      <SheetFooter
        error={failure?.error}
        primary={{
          label: "Approve",
          onClick: () => approve.mutate(),
          pending: approve.isPending,
          disabled: actor === "",
        }}
      />
    ) : undefined

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "count", id }}
      onOpenChange={(open) => !open && onClose()}
      id={name?.site ?? data?.site_id}
      title={
        data === undefined
          ? "Count"
          : `${humanise(data.kind)} count · ${name?.pool ?? data.pool_id}`
      }
      badge={
        data && (
          <Pill tone={statusTone(data.status)}>{STATUS_WORD[data.status]}</Pill>
        )
      }
      footer={footer}
      width="wide"
    >
      {queryState(detail, {
        loading: "Opening the count…",
        render: (data) => {
          return (
            <div className="flex flex-col gap-6">
              <KpiStrip className="mb-2!">
                <Kpi label="Expected" value={count(data.summary.expected)} />
                <Kpi label="Found" value={count(data.summary.found)} />
                <Kpi
                  label="Difference"
                  value={differenceCell(
                    data.summary.expected,
                    data.summary.found,
                    counted(data.status)
                  )}
                />
                <Kpi
                  label="Short"
                  value={count(data.summary.shortage_subjects)}
                />
                <Kpi label="Over" value={count(data.summary.gain_subjects)} />
              </KpiStrip>

              {data.edge_adjustment_status === "REJECTED" && (
                <Banner tone="bad">The DC refused the movement.</Banner>
              )}

              {data.lines.length === 0 ? (
                <EmptyState>
                  {data.status === "DRAFT"
                    ? "Not started yet"
                    : owned
                      ? "Not counted yet · on the DC handheld"
                      : "Not counted yet"}
                </EmptyState>
              ) : (
                <CountItems
                  lines={data.lines}
                  status={data.status}
                  poolId={data.pool_id}
                  open={missing}
                />
              )}
            </div>
          )
        },
      })}
    </Sheet>
  )
}

/// The articles of a count, one row per SKU, in the PO items table's frame and
/// type (owner, 16 Oct 2026): Book, Counted, and the last column saying what
/// the difference is — before review a plain difference, in review what
/// approving does with it (short goes to Missing; over closes an open Missing
/// of the same SKU in this pool first, and only the rest is extra).
function CountItems({
  lines,
  status,
  poolId,
  open,
}: {
  lines: CountDetail["lines"]
  status: CountDetail["status"]
  poolId: string
  open: readonly MissingGroup[]
}) {
  const skus = useMemo(() => {
    const by = new Map<
      string,
      { sku: string; name: string | null; book: number; counted: number }
    >()
    for (const line of lines) {
      const one = by.get(line.sku_code) ?? {
        sku: line.sku_code,
        name: line.article_name ?? null,
        book: 0,
        counted: 0,
      }
      one.book += line.expected_quantity
      one.counted += line.found_quantity
      by.set(line.sku_code, one)
    }
    return [...by.values()].sort(
      (left, right) =>
        left.counted - left.book - (right.counted - right.book) ||
        (left.name ?? left.sku).localeCompare(right.name ?? right.sku)
    )
  }, [lines])

  const becomes = (sku: string, book: number, counted: number) => {
    const diff = counted - book
    if (diff === 0) return { text: "Same", tone: "text-mute" }
    if (diff < 0)
      return {
        text: SHOW_MISSING ? `${-diff} to Missing` : `${-diff} short`,
        tone: "text-bad-fg",
      }
    const held = open
      .filter((one) => one.pool === poolId && one.sku === sku)
      .reduce((sum, one) => sum + one.left, 0)
    const found = Math.min(diff, held)
    return found > 0
      ? {
          text:
            diff > found
              ? `${found} found · ${diff - found} extra`
              : `${found} found`,
          tone: "text-ok-fg",
        }
      : { text: `${diff} extra`, tone: "text-ok-fg" }
  }

  const review = status === "REVIEW"
  const done = counted(status)

  return (
    <div className="items-box overflow-hidden rounded-inner border border-hairline">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col />
          <col className="w-[6rem] md:w-[8.5rem]" />
          <col className="w-[6rem] md:w-[8.5rem]" />
          <col className="w-[7rem] md:w-[10rem]" />
        </colgroup>
        <thead>
          <tr>
            <th className={cn(ITEMS_HEAD, "text-left")}>Item</th>
            <th className={cn(ITEMS_HEAD, "text-right")}>Book</th>
            <th className={cn(ITEMS_HEAD, "text-right")}>Counted</th>
            <th className={cn(ITEMS_HEAD, "text-right")}>
              {review ? "Becomes" : "Difference"}
            </th>
          </tr>
        </thead>
        <tbody className="[&_tr:first-child_td]:border-t-0">
          {skus.map((one, at) => {
            const result = becomes(one.sku, one.book, one.counted)
            return (
              <tr key={one.sku}>
                <td className={ITEMS_CELL}>
                  <ItemIdentity
                    eager={at < 24}
                    row={{
                      image: null,
                      name: one.name ?? one.sku,
                      division: null,
                      filed: one.sku,
                    }}
                  />
                </td>
                <td
                  className={cn(
                    ITEMS_CELL,
                    "text-right whitespace-nowrap text-ink tabular-nums"
                  )}
                >
                  {pcs(one.book)}
                </td>
                <td
                  className={cn(
                    ITEMS_CELL,
                    "text-right whitespace-nowrap text-ink tabular-nums"
                  )}
                >
                  {done || one.counted > 0 ? pcs(one.counted) : "—"}
                </td>
                <td
                  className={cn(
                    ITEMS_CELL,
                    "text-right font-medium whitespace-nowrap tabular-nums"
                  )}
                >
                  {review ? (
                    <span className={result.tone}>{result.text}</span>
                  ) : (
                    differenceCell(one.book, one.counted, done)
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface CountDraft {
  pool: string
  kind: CountKind
  reason: string
  epcs: string
}

function Composer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient()
  const actor = useActor()

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const pools = useMemo(
    () => writablePools(fleet.data?.items ?? []),
    [fleet.data]
  )
  const poolFor = (id: string) => pools.find((item) => item.id === id)

  const create = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: CountDraft) => {
      const chosen = poolFor(draft.pool)!
      return createCount({
        site_id: chosen.site_id,
        pool_id: chosen.id,
        kind: draft.kind,
        sku_ids: [],
        epcs: draft.epcs
          .split(/[\s,]+/)
          .map((value) => value.trim().toUpperCase())
          .filter((value) => value !== ""),
        reason: draft.reason,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: inventoryKeys.counts() })
      // The reason and the scope, which were this count. The pool and the kind
      // are where the next one is most likely drafted against too.
      form.setFieldValue("reason", "")
      form.setFieldValue("epcs", "")
    },
  })

  const form = useForm({
    defaultValues: {
      pool: "",
      kind: "FULL",
      reason: "",
      epcs: "",
    } as CountDraft,
    onSubmit: ({ value }) => create.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New count"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="flex flex-col gap-4"
      >
        {create.isError && (
          <Banner tone="bad">
            {create.error instanceof Error
              ? create.error.message
              : "The count was refused."}
          </Banner>
        )}

        <form.Field name="pool">
          {(field) => (
            <Field label="Pool" required>
              <Choice
                value={field.state.value}
                onChange={field.handleChange}
                options={pools.map((item) => ({
                  value: item.id,
                  label: `${item.site_id} · ${item.label}`,
                }))}
                className="h-9 w-full max-w-none"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="kind">
          {(field) => (
            <Field label="Kind">
              <Choice
                value={field.state.value}
                onChange={(value) => field.handleChange(value as CountKind)}
                options={KINDS}
                className="h-9 w-full max-w-none"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="reason">
          {(field) => (
            <Field label="Reason" required>
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => state.values.kind === "TARGETED"}>
          {(targeted) =>
            targeted && (
              <form.Field name="epcs">
                {(field) => (
                  <Field label="Tags to count" required>
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </Field>
                )}
              </form.Field>
            )
          }
        </form.Subscribe>

        <form.Subscribe
          selector={(state) =>
            poolFor(state.values.pool) !== undefined &&
            state.values.reason.trim() !== "" &&
            actor !== "" &&
            (state.values.kind !== "TARGETED" ||
              state.values.epcs.trim() !== "")
          }
        >
          {(ready) => (
            <Button
              type="submit"
              variant="primary"
              pending={create.isPending}
              disabled={!ready}
            >
              {create.isPending ? "Submitting…" : "Submit"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}
