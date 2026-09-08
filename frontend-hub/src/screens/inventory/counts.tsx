import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterBar } from "@/components/ui/filter-bar"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { Lifecycle } from "@/components/ui/timeline"
import { useFilters } from "@/lib/filters"
import { count, label as humanise, moment } from "@/lib/format"
import {
  activateCount,
  addCountEntries,
  approveCount,
  countDetail,
  createCount,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  listCounts,
  submitCount,
  type CountKind,
  type CountRow,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
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

const columns: ColumnDef<TableSetup, CountRow>[] = [
  {
    accessorKey: "reason",
    header: "Count",
    size: 240,
    meta: { filter: { kind: "text" } },
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
    meta: { filter: { kind: "option", format: humanise } },
    cell: ({ row }) => <Tag>{row.original.kind}</Tag>,
  },
  {
    accessorKey: "execution_authority",
    header: "Counted by",
    size: 130,
    meta: { filter: { kind: "option" } },
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
    meta: { filter: { kind: "option", format: humanise } },
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
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.expected),
  },
  {
    accessorKey: "found",
    header: "Found",
    size: 100,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.found),
  },
  {
    id: "difference",
    accessorFn: (row) => row.found - row.expected,
    header: "Difference",
    size: 120,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
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
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => moment(row.original.created_at),
  },
]

export function Counts() {
  const [slice, setSlice] = useState<
    "needs_review" | "active" | "drafts" | "history"
  >("needs_review")
  const [query, setQuery] = useState("")
  const [composing, setComposing] = useState(false)
  const sheet = useSheet("count")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "difference", desc: false },
  ])

  const board = useQuery({
    queryKey: inventoryKeys.counts(),
    queryFn: ({ signal }) => listCounts(signal),
  })

  const rows = useMemo(() => board.data?.[slice] ?? [], [board.data, slice])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: CountRow) => row.id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Counts"
        sub="What was expected, what was found, and who is allowed to say so."
      />

      <Toolbar>
        <Segmented
          value={slice}
          onChange={setSlice}
          options={[
            {
              value: "needs_review",
              label:
                `Needs review ${board.data ? board.data.needs_review.length : ""}`.trim(),
            },
            { value: "active", label: "Counting" },
            { value: "drafts", label: "Drafts" },
            { value: "history", label: "Closed" },
          ]}
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="h-8 w-48"
        />
        <FilterBar model={filters} table={table} />
        <Toolbar.Spacer />
        <Button onClick={() => setComposing(true)}>
          <Plus />
          New count
        </Button>
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(board, {
          loading: "Reading the count board…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {query !== ""
                  ? `No count in this column matches “${query}”.`
                  : slice === "needs_review"
                    ? "Nothing is waiting for a decision."
                    : slice === "active"
                      ? "Nobody is counting anything right now."
                      : slice === "drafts"
                        ? "No count has been drafted."
                        : "No count has been closed yet."}
              </EmptyState>
            ) : (
              <DataTable<CountRow>
                table={table}
                onRowClick={(row) => sheet.open(row.id)}
                isSelected={(row) => row.id === sheet.value}
                className="max-h-[calc(100vh-17rem)]"
              />
            ),
        })}
      </Card>

      <CountSheet id={sheet.value ?? null} onClose={sheet.close} />
      <Composer open={composing} onClose={() => setComposing(false)} />
    </PageContent>
  )
}

const STEPS = ["DRAFT", "ACTIVE", "REVIEW", "CLOSED"] as const

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
                  {data.scope.sku_codes.length + data.scope.epcs.length === 0
                    ? "Everything in the pool"
                    : `${count(data.scope.sku_codes.length)} SKUs · ${count(data.scope.epcs.length)} tags`}
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
                        <td className="py-2 pr-2 font-mono text-[0.65625rem] text-body">
                          {line.epc}
                        </td>
                        <td className="py-2 text-right font-mono text-[0.65625rem] text-body">
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
                  <p className="text-[0.71875rem] text-mute">
                    The DC that owns this site does the counting. Entries and
                    submission from here are refused, and approving only asks
                    that node to adjust — the count closes when it answers.
                  </p>
                )}

                {data.status === "DRAFT" && (
                  <Button
                    variant="soft"
                    disabled={actor === "" || activate.isPending}
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
                      disabled={
                        Object.keys(found).length === 0 ||
                        actor === "" ||
                        record.isPending
                      }
                      onClick={() => record.mutate()}
                    >
                      {record.isPending
                        ? "Recording…"
                        : "Record what was found"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={actor === "" || submit.isPending}
                      onClick={() => submit.mutate()}
                    >
                      {submit.isPending ? "Submitting…" : "Submit for review"}
                    </Button>
                  </>
                )}

                {data.status === "REVIEW" && (
                  <Button
                    variant="soft"
                    disabled={actor === "" || approve.isPending}
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
                  <p className="text-[0.71875rem] text-mute">
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
        <p className="text-[0.71875rem] text-mute">
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
        {create.isSuccess && (
          <Banner tone="ok">
            Drafted. Open it from the board to activate it.
          </Banner>
        )}

        <form.Field name="pool">
          {(field) => (
            <Field
              label="Pool"
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
            <Field label="Reason">
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
              disabled={!ready || create.isPending}
            >
              {create.isPending ? "Drafting…" : "Draft the count"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}
