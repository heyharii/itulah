import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import {
  ColumnsMenu,
  DockedFilters,
  SortMenu,
  ViewPicker,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { Lifecycle } from "@/components/ui/timeline"
import { useFilterState, type FilterField } from "@/lib/filters"
import { usePanelDock } from "@/lib/layout"
import { count, label as humanise, moment } from "@/lib/format"
import {
  activateCount,
  addCountEntries,
  approveCount,
  countDetail,
  countScopeFromFilters,
  countsPage,
  createCount,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  submitCount,
  type CountBookScope,
  type CountDetail,
  type CountKind,
  type CountPage,
  type CountRow,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { Choice } from "@/screens/inventory/parts"
import { signed, useActor, writablePools } from "@/screens/inventory/shared"

/// Official counts — the only thing in this app that is allowed to tell the
/// ledger it is wrong.
///
/// The lifecycle is `DRAFT → ACTIVE → REVIEW → CLOSED` and nothing else. What
/// each step means depends entirely on who owns the site, and the fork is at
/// **activation**: with no DC owner the cloud freezes an expectation here and
/// the counting happens here; with one, the cloud snapshots nothing, sends a
/// command, and every later step is the DC's. Approving a DC-owned count does
/// not close it — it *asks* for an adjustment, and the count stays in review
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

const columns: ColumnDef<TableSetup, CountRow>[] = [
  {
    accessorKey: "reason",
    header: "Count",
    size: 250,
    // Ordered by the POOL it counts, which is the order the endpoint has and
    // the one somebody means: two counts of the same shelf belong together,
    // and nobody looks for a count by the first letter of its reason.
    id: "pool_id",
    accessorFn: (row) => row.pool_id,
    cell: ({ row }) => (
      <div className="min-w-0">
        <span className="block truncate text-ink">{row.original.reason}</span>
        <span className="font-mono text-id text-mute">
          {row.original.pool_id}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "kind",
    header: "Kind",
    size: 100,
    enableSorting: false,
    cell: ({ row }) => <Tag>{humanise(row.original.kind)}</Tag>,
  },
  {
    accessorKey: "execution_authority",
    header: "Counted by",
    size: 130,
    // Not a parameter this endpoint takes, so it is a column and not a filter:
    // a chip the request cannot carry is a control that claims to narrow a
    // list and does not.
    enableSorting: false,
    cell: ({ row }) => (
      <Tag
        tone={
          row.original.execution_authority === "EDGE_DC" ? "info" : "neutral"
        }
      >
        {row.original.execution_authority === "EDGE_DC" ? "DC" : "CLOUD"}
      </Tag>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 120,
    cell: ({ row }) => (
      <Pill
        tone={
          row.original.status === "CLOSED"
            ? "ok"
            : row.original.status === "REVIEW"
              ? "warn"
              : row.original.status === "ACTIVE"
                ? "info"
                : "neutral"
        }
      >
        {humanise(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "expected",
    header: "Expected",
    size: 100,
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.expected),
  },
  {
    accessorKey: "found",
    header: "Found",
    size: 100,
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.found),
  },
  {
    id: "difference",
    accessorFn: (row) => row.found - row.expected,
    header: "Difference",
    size: 120,
    meta: { align: "right" },
    // The decision metric. Sorted ascending by default so the deepest shortage
    // is the first row: a count that found everything needs nobody.
    cell: ({ row }) => {
      const difference = row.original.found - row.original.expected
      return (
        <span
          className={
            difference < 0
              ? "font-medium text-bad-fg"
              : difference > 0
                ? "text-warn-fg"
                : "text-mute"
          }
        >
          {difference === 0 ? "—" : signed(difference)}
        </span>
      )
    },
  },
  {
    accessorKey: "created_at",
    header: "Opened",
    size: 150,
    meta: { priority: 2 },
    cell: ({ row }) => moment(row.original.created_at),
  },
  {
    accessorKey: "closed_at",
    header: "Closed",
    size: 150,
    // The other end of the record, and the other order the endpoint has: a
    // supervisor asking "what was signed off this week" is asking about this
    // date and not about when the count was opened.
    meta: { priority: 3 },
    cell: ({ row }) =>
      row.original.closed_at === null ? (
        <span className="text-mute">—</span>
      ) : (
        moment(row.original.closed_at)
      ),
  },
]

/// The four columns the board used to be, as readings of one list.
///
/// They were a row of segmented tabs, which says "these are four screens" when
/// they are four readings of one — and each of them is just the `status`
/// parameter the endpoint already takes. As views they sit with the saved ones,
/// because picking either is the same act: replacing what the list is showing.
const SLICES = [
  { value: "", label: "All counts" },
  { value: "REVIEW", label: "Needs review" },
  { value: "ACTIVE", label: "Counting" },
  { value: "DRAFT", label: "Drafts" },
  { value: "CLOSED", label: "Closed" },
] as const

export function Counts() {
  /// Which reading is on screen, in the URL: a supervisor sending "the three
  /// waiting on you" is sending this.
  const slice = useSheet("count-status")
  /// What was typed, also in the URL, and answered by the server against the
  /// pool id, the reason and who opened it.
  const search = useSheet("q")
  /// Whether the filter panel has room to stand beside the list. Below it the
  /// same model is a sheet behind a Filter button, and the panel unmounts.
  const docked = usePanelDock()
  const [composing, setComposing] = useState(false)
  const sheet = useSheet("count")
  // The deepest shortage first: a count that found everything needs nobody.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "difference", desc: false },
  ])

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  /// The columns this list can be narrowed by, and the only ones: each maps to
  /// a parameter `GET /inventory/counts` answers. Status is not among them —
  /// it is the view above, and asking the same question in two controls is how
  /// a screen ends up disagreeing with itself.
  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "kind",
        label: "Kind",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          options: KINDS.map((one) => ({ value: one.value, label: one.label })),
          format: humanise,
        },
      },
      {
        column: "site_id",
        label: "Site",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          format: (id) =>
            fleet.data?.items.find((item) => item.site_id === id)?.site_name ??
            id,
        },
      },
      {
        column: "pool_id",
        label: "Pool",
        spec: { kind: "option", single: true, operators: ["isAnyOf"] },
      },
    ],
    [fleet.data]
  )

  const filters = useFilterState(fields)

  const needle = useDebounced((search.value ?? "").trim(), 400)
  const scope = useMemo<CountBookScope>(() => {
    const by = sorting[0]
    return {
      ...countScopeFromFilters(filters.filters),
      ...(slice.value === undefined ? {} : { status: slice.value }),
      ...(needle === "" ? {} : { q: needle }),
      sort: by === undefined ? undefined : SORTS[by.id],
      desc: by?.desc === true,
    }
  }, [filters.filters, needle, slice.value, sorting])

  const narrowed = needle !== "" || filters.filters.length > 0

  const board = useInfiniteQuery({
    queryKey: inventoryKeys.countsScoped(scope),
    queryFn: ({ pageParam, signal }) =>
      countsPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => board.data?.pages.flatMap((page) => page.rows) ?? [],
    [board.data]
  )
  /// The first page carries the server's total and facets over the whole book.
  const head = board.data?.pages[0]

  /// The same fields, carrying the server's own tally over the whole book —
  /// not over the page in hand, which holds only what the same filters already
  /// let through.
  const counted = useMemo<FilterField[]>(() => {
    const facets = head?.facets
    if (facets === undefined) return fields
    return fields.map((field) =>
      field.column === "kind"
        ? { ...field, spec: { ...field.spec, counted: facets.kinds } }
        : field.column === "site_id"
          ? { ...field, spec: { ...field.spec, counted: facets.sites } }
          : field.column === "pool_id"
            ? { ...field, spec: { ...field.spec, counted: facets.pools } }
            : field
    )
  }, [fields, head])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: CountRow) => row.id,
        state: { sorting },
        // The rows arrive in the order the request asked for. Sorting them
        // again here would sort the page and call it the book.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Counts"
        sub="What was expected, what was found, and who is allowed to say so."
      />

      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          {/* One line the width of the table, carrying everything that acts on
              it: what narrows it at the left, what orders and shapes it in the
              middle, and what opens a new one at the right. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="relative mr-auto">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
              <input
                value={search.value ?? ""}
                onChange={(event) =>
                  event.target.value
                    ? search.open(event.target.value)
                    : search.close()
                }
                placeholder="Search pool, reason, who"
                aria-label="Search counts"
                className="h-[2.125rem] w-64 rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent"
              />
            </span>
            {/* The same model as the panel, as the chips over the table and
                a Filter button beside them — for every width the panel cannot
                dock at. Rendered only there: the panel unmounts below the dock
                width rather than hiding, because both of these carry a sheet
                on the same `?filters=` key. */}
            {!docked && (
              <FilterPanel
                model={{ ...filters, fields: counted }}
                className="mr-auto"
              />
            )}
            <SortMenu
              table={table}
              sorting={sorting}
              onSort={(id, desc) => setSorting([{ id, desc }])}
            />
            <ColumnsMenu table={table} />
            <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
            <ViewPicker
              model={filters}
              id="counts"
              all="All counts"
              views={SLICES.map((one) => ({
                value: one.value,
                label:
                  one.value === ""
                    ? one.label
                    : `${one.label} ${count(facetOf(head, one.value))}`,
              }))}
              view={slice.value ?? ""}
              onView={(value) =>
                value === "" ? slice.close() : slice.open(value)
              }
            />
            <Button variant="primary" onClick={() => setComposing(true)}>
              <Plus />
              New count
            </Button>
          </div>

          <Card className="overflow-hidden">
            {queryState(board, {
              loading: "Reading the count board…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    {narrowed
                      ? "No count matches what you asked for."
                      : slice.value === "REVIEW"
                        ? "Nothing is waiting for a decision."
                        : slice.value === "ACTIVE"
                          ? "Nobody is counting anything right now."
                          : slice.value === "DRAFT"
                            ? "No count has been drafted."
                            : slice.value === "CLOSED"
                              ? "No count has been closed yet."
                              : "No count has been opened yet."}
                  </EmptyState>
                ) : (
                  <DataTable<CountRow>
                    table={table}
                    more={board}
                    onRowClick={(row) => sheet.open(row.id)}
                    isSelected={(row) => row.id === sheet.value}
                    className="max-h-[calc(100vh-14rem)]"
                  />
                ),
            })}
          </Card>
        </div>

        <DockedFilters
          model={{ ...filters, fields: counted }}
          kpis={bookKpis(head)}
          id="counts"
          subject="Count"
          className="hidden dock:flex"
        />
      </div>

      <CountSheet id={sheet.value ?? null} onClose={sheet.close} />
      <Composer open={composing} onClose={() => setComposing(false)} />
    </PageContent>
  )
}

/// How many counts a status holds, over the whole book rather than the page.
function facetOf(page: CountPage | undefined, status: string): number {
  return (
    page?.facets.statuses.find((facet) => facet.value === status)?.count ?? 0
  )
}

/// Three figures about the book as it currently stands.
///
/// All three are the server's own — `total` over everything the search, the
/// view and the chips match, the other two from the status facet — so none of
/// them is a sum over whatever page happens to be in hand.
function bookKpis(page: CountPage | undefined) {
  if (page === undefined) return undefined
  return [
    { label: "Counts", value: count(page.total) },
    {
      label: "In review",
      value: count(facetOf(page, "REVIEW")),
      note: "Counted, and waiting for somebody to approve the adjustment.",
    },
    {
      label: "Counting",
      value: count(facetOf(page, "ACTIVE")),
      note: "Open on somebody's floor right now.",
    },
    {
      label: "Drafts",
      value: count(facetOf(page, "DRAFT")),
      note: "Opened, not yet started.",
    },
  ]
}

const STEPS = ["DRAFT", "ACTIVE", "REVIEW", "CLOSED"] as const

/// How narrow a count's scope is, over the two lists that may not be there.
///
/// Nought means "everything in the pool", which is also what an absent scope
/// means — the same answer for the two reasons, which is why one function
/// gives it rather than two `?? 0`s at the call site.
function scopeSize(scope: CountDetail["scope"]): number {
  return (scope.sku_codes?.length ?? 0) + (scope.epcs?.length ?? 0)
}

function CountSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [found, setFound] = useState<Record<string, string>>({})

  const detail = useQuery({
    queryKey: inventoryKeys.count(id ?? ""),
    queryFn: ({ signal }) => countDetail(id!, signal),
    enabled: id !== null,
  })

  // Each of the four writes changes this record and its column on the board.
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

  const record = useMutation({
    mutationFn: () =>
      addCountEntries(id!, {
        actor_id: actor,
        idempotency_key: idempotencyKey(),
        entries: Object.entries(found)
          .filter(([, value]) => value.trim() !== "")
          .map(([subject, value]) => ({
            subject_id: subject,
            epc: null,
            found_quantity: Number(value),
          })),
      }),
    onSuccess: () => {
      invalidate()
      setFound({})
    },
  })

  const failure = [activate, submit, approve, record].find((one) => one.isError)

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "count", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.pool_id}
      title={detail.data?.reason ?? "Count"}
    >
      {queryState(detail, {
        loading: "Opening the count…",
        render: (data) => {
          const owned = data.execution_authority === "EDGE_DC"
          const at = STEPS.indexOf(data.status)
          return (
            <div className="flex flex-col gap-5">
              <Lifecycle
                steps={STEPS.map((step, index) => ({
                  label: humanise(step),
                  state:
                    index < at ? "done" : index === at ? "current" : "todo",
                }))}
              />

              <div className="flex flex-wrap gap-1.5">
                <Tag>{data.kind}</Tag>
                <Pill tone={owned ? "info" : "neutral"}>
                  {owned ? "Counted by the DC" : "Counted here"}
                </Pill>
                {data.edge_adjustment_status && (
                  <Pill
                    tone={
                      data.edge_adjustment_status === "APPLIED"
                        ? "ok"
                        : data.edge_adjustment_status === "REJECTED"
                          ? "bad"
                          : "warn"
                    }
                  >
                    Adjustment {humanise(data.edge_adjustment_status)}
                  </Pill>
                )}
              </div>

              <Facts>
                <Fact term="Site">{data.site_id}</Fact>
                <Fact term="Pool">
                  <AppLink
                    to="/inventory/pools"
                    sheet={{ key: "pool", value: data.pool_id }}
                    className="hover:underline"
                  >
                    {data.pool_id}
                  </AppLink>
                </Fact>
                <Fact term="Opened by">{data.created_by}</Fact>
                <Fact term="Opened">{moment(data.created_at)}</Fact>
                <Fact term="Activated">{moment(data.activated_at)}</Fact>
                <Fact term="Submitted">{moment(data.submitted_at)}</Fact>
                <Fact term="Owner">
                  {data.activation_target_origin_id ?? "This node"}
                </Fact>
                <Fact term="Scope">
                  {/* Both lists are written into the scope at ACTIVATION, so a
                      count that has not reached it — and every seeded one —
                      carries neither key. Read as present, this line threw and
                      took the whole sheet down with it: the row opened to
                      "Something went wrong". */}
                  {scopeSize(data.scope) === 0
                    ? "Everything in the pool"
                    : `${count(data.scope.sku_codes?.length ?? 0)} SKUs · ${count(
                        data.scope.epcs?.length ?? 0
                      )} tags`}
                </Fact>
              </Facts>

              <TotalsLadder
                rows={[
                  { label: "Expected", value: count(data.summary.expected) },
                  { label: "Found", value: count(data.summary.found) },
                  {
                    label: "Agreed",
                    value: count(data.summary.match_subjects),
                  },
                  {
                    label: "Short",
                    value: count(data.summary.shortage_subjects),
                  },
                  { label: "Over", value: count(data.summary.gain_subjects) },
                ]}
                total={{
                  label: "Difference",
                  value: signed(data.summary.found - data.summary.expected),
                }}
              />

              {failure?.error !== undefined && (
                <Banner tone="bad">
                  {failure.error instanceof Error
                    ? failure.error.message
                    : "The server refused the command."}
                </Banner>
              )}

              <section>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Lines
                </h4>
                {data.lines.length === 0 ? (
                  <p className="text-meta text-body">
                    {owned
                      ? "The DC has not reported a result yet."
                      : "Nothing has been snapshotted — the count is still a draft."}
                  </p>
                ) : (
                  <MiniTable
                    head={[
                      "Tag",
                      "SKU",
                      "Expected",
                      data.status === "ACTIVE" && !owned ? "Count" : "Found",
                    ]}
                  >
                    {data.lines.map((line) => (
                      <tr
                        key={line.subject_id ?? line.epc}
                        className="border-t border-hairline"
                      >
                        <td className="py-2 pr-2 font-mono text-[0.875rem] text-body">
                          {line.epc}
                        </td>
                        <td className="py-2 text-right font-mono text-[0.875rem] text-body">
                          {line.sku_code}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {count(line.expected_quantity)}
                        </td>
                        <td className="w-20 py-2 pl-2 text-right tabular-nums">
                          {data.status === "ACTIVE" &&
                          !owned &&
                          line.subject_id ? (
                            <Input
                              type="number"
                              min={0}
                              className="h-7 px-2 text-right"
                              value={
                                found[line.subject_id] ??
                                String(line.found_quantity)
                              }
                              onChange={(event) =>
                                setFound((current) => ({
                                  ...current,
                                  [line.subject_id!]: event.target.value,
                                }))
                              }
                            />
                          ) : (
                            count(line.found_quantity)
                          )}
                        </td>
                      </tr>
                    ))}
                  </MiniTable>
                )}
              </section>

              <section className="flex flex-col gap-2.5 border-t border-hairline pt-4">
                {owned && data.status !== "DRAFT" && (
                  <p className="text-[0.875rem] text-mute">
                    The DC that owns this site does the counting. Entries and
                    submission from here are refused, and approving only asks
                    that node to adjust — the count closes when it answers.
                  </p>
                )}

                {data.status === "DRAFT" && (
                  <Button
                    variant="soft"
                    pending={activate.isPending}
                    disabled={actor === ""}
                    onClick={() => activate.mutate()}
                  >
                    {activate.isPending
                      ? "Activating…"
                      : "Activate and freeze the expectation"}
                  </Button>
                )}

                {data.status === "ACTIVE" && !owned && (
                  <>
                    <Button
                      variant="soft"
                      pending={record.isPending}
                      disabled={Object.keys(found).length === 0 || actor === ""}
                      onClick={() => record.mutate()}
                    >
                      {record.isPending
                        ? "Recording…"
                        : "Record what was found"}
                    </Button>
                    <Button
                      variant="ghost"
                      pending={submit.isPending}
                      disabled={actor === ""}
                      onClick={() => submit.mutate()}
                    >
                      {submit.isPending ? "Submitting…" : "Submit for review"}
                    </Button>
                  </>
                )}

                {data.status === "REVIEW" && (
                  <Button
                    variant="soft"
                    pending={approve.isPending}
                    disabled={actor === ""}
                    onClick={() => approve.mutate()}
                  >
                    {approve.isPending
                      ? "Approving…"
                      : owned
                        ? "Ask the DC to adjust"
                        : "Approve and post the difference"}
                  </Button>
                )}

                {data.status === "CLOSED" && (
                  <p className="text-[0.875rem] text-mute">
                    Closed {moment(data.closed_at)}. Shortages moved to missing
                    as `COUNT_SHORTAGE`; anything found over arrived as
                    `COUNT_GAIN`.
                  </p>
                )}
              </section>
            </div>
          )
        },
      })}
    </Sheet>
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
        <p className="text-[0.875rem] text-mute">
          A count starts as a draft and freezes nothing. The expectation is
          taken at activation — and if a DC owns the site, it is taken there
          rather than here.
        </p>

        {create.isError && (
          <Banner tone="bad">
            {create.error instanceof Error
              ? create.error.message
              : "The count was refused."}
          </Banner>
        )}

        <form.Field name="pool">
          {(field) => (
            <Field
              label="Pool"
              required
              hint="Only pools this node may write to. A pool a live Edge node owns is counted there."
            >
              <Choice
                value={field.state.value}
                onChange={field.handleChange}
                options={pools.map((item) => ({
                  value: item.id,
                  label: `${item.site_id} · ${item.label}`,
                }))}
                placeholder="Choose a pool"
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
                placeholder="Quarterly stocktake"
              />
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => state.values.kind === "TARGETED"}>
          {(targeted) =>
            targeted && (
              <form.Field name="epcs">
                {(field) => (
                  <Field
                    label="Tags to count"
                    required
                    hint="One EPC per line or comma separated. A targeted count with no scope is refused."
                  >
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="A0000000000000000001, A0000000000000000002"
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
              {create.isPending ? "Drafting…" : "Draft the count"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}
