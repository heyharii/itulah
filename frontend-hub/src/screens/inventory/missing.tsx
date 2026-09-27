import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { count, label as humanise, moment } from "@/lib/format"
import {
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  missingPage,
  resolveMissing,
  type MissingItem,
  type MissingScope,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { Choice } from "@/screens/inventory/parts"
import { age, useActor, writablePools } from "@/screens/inventory/shared"

/// Stock the ledger cannot find.
///
/// There is no missing *status* to filter by: this list **is** the set of
/// positive balances sitting in a pool's `:missing` place, and resolving one
/// removes the row rather than restatusing it. So the only question a row asks
/// is which of three answers it gets — found, and it goes back on hand; lost,
/// and it leaves the estate through `system/lost`; disposed, and it leaves
/// through `external/disposal`. All three post a real movement, and the age is
/// what decides between them: an hour is a mislaid box, a fortnight is a
/// write-off nobody has taken.
///
/// The list opens oldest-first for that reason, which is also the order the
/// server returns.

const columns: ColumnDef<TableSetup, MissingItem>[] = [
  {
    id: "subject",
    accessorFn: (row) =>
      `${row.epc ?? ""} ${row.sku_code ?? ""} ${row.barcode ?? ""}`,
    header: "Subject",
    size: 240,
    cell: ({ row }) => (
      <div className="min-w-0">
        <span className="block truncate font-mono text-id text-ink">
          {row.original.epc ?? row.original.barcode ?? row.original.subject_id}
        </span>
        <span className="font-mono text-[0.875rem] text-mute">
          {row.original.sku_code ?? row.original.subject_type}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "pool_label",
    header: "Missing from",
    size: 210,
    cell: ({ row }) => (
      <AppLink
        to="/inventory/pools"
        sheet={{ key: "pool", value: row.original.origin_pool }}
        className="text-body hover:text-ink hover:underline"
      >
        {row.original.pool_label}
      </AppLink>
    ),
  },
  {
    accessorKey: "quantity",
    header: "Quantity",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.quantity),
  },
  {
    accessorKey: "age_hours",
    header: "Missing for",
    size: 120,
    meta: { align: "right" },
    // The decision metric, and the default sort.
    cell: ({ row }) => {
      const hours = row.original.age_hours
      return (
        <span
          className={
            hours === null
              ? "text-mute"
              : hours > 24 * 14
                ? "font-medium text-bad-fg"
                : hours > 48
                  ? "text-warn-fg"
                  : "text-body"
          }
        >
          {age(hours)}
        </span>
      )
    },
  },
  {
    accessorKey: "last_observation",
    header: "Last seen",
    size: 160,
    cell: ({ row }) => moment(row.original.last_observation),
  },
  {
    accessorKey: "latest_count_status",
    header: "Last counted",
    size: 150,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.latest_count_id ? (
        <AppLink
          to="/inventory/counts"
          sheet={{ key: "count", value: row.original.latest_count_id }}
          className="hover:underline"
        >
          <Tag>{row.original.latest_count_status ?? "—"}</Tag>
        </AppLink>
      ) : (
        <span className="text-mute">Never</span>
      ),
  },
]

/// Which column means which order the endpoint names. A column not in here
/// cannot be sorted — sorting it would sort the loaded pages and call that the
/// list.
const SORTS: Record<string, string> = {
  subject: "epc",
  pool_label: "pool",
  quantity: "quantity",
  age_hours: "missing_since",
  last_observation: "last_observation",
}

/// A fortnight, in the hours `age_hours` is counted in.
const OVERDUE_HOURS = 24 * 14

/// Every narrowing here is a parameter the endpoint answers; the counts beside
/// each option are the server's, over everything the search matches.
const FIELDS: FilterField[] = [
  {
    column: "pool_id",
    label: "Missing from",
    spec: { kind: "option", single: true, operators: ["isAnyOf"] },
  },
  {
    column: "counted",
    label: "Counted",
    spec: {
      kind: "option",
      single: true,
      operators: ["isAnyOf"],
      format: (value) =>
        value === "NEVER"
          ? "Never counted"
          : value === "COUNTED"
            ? "Counted"
            : humanise(value),
    },
  },
]

function scopeFromFilters(filters: readonly Filter[]): {
  pool_id?: string
  counted?: string
} {
  const scope: { pool_id?: string; counted?: string } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0 || operator !== "isAnyOf") continue
    if (column === "pool_id") scope.pool_id = values[0]
    else if (column === "counted") scope.counted = values[0]
  }
  return scope
}

export function Missing() {
  const [query, setQuery] = useState("")
  const item = useSheet("movement")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "age_hours", desc: true },
  ])

  const filters = useFilterState(FIELDS)

  // Debounced: every keystroke is a query over every missing place.
  const needle = useDebounced(query.trim(), 400)
  const scope = useMemo<MissingScope>(() => {
    const by = sorting[0]
    const sort = by === undefined ? undefined : SORTS[by.id]
    return {
      ...scopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      sort,
      // "Missing for" runs the other way from "missing since": the longest
      // missing is the one that went missing first.
      desc: sort === "missing_since" ? by?.desc !== true : by?.desc === true,
    }
  }, [filters.filters, needle, sorting])

  const missing = useInfiniteQuery({
    queryKey: inventoryKeys.missing(scope),
    queryFn: ({ pageParam, signal }) =>
      missingPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => missing.data?.pages.flatMap((page) => page.rows) ?? [],
    [missing.data]
  )
  const head = missing.data?.pages[0]

  const model = useMemo(
    () => ({
      ...filters,
      fields: head
        ? FIELDS.map((field) => ({
            ...field,
            spec: {
              ...field.spec,
              counted:
                field.column === "pool_id"
                  ? head.facets.pools
                  : head.facets.counted,
              ...(field.column === "pool_id"
                ? {
                    format: (value: string) =>
                      head.facets.pools.find((one) => one.value === value)
                        ?.label ?? value,
                  }
                : {}),
            },
          }))
        : FIELDS,
    }),
    [filters, head]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: MissingItem) => row.id,
        state: { sorting },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  /// How many of the LOADED rows are over a fortnight — and whether that is
  /// all of them. It is exact when nothing is left to fetch, or when the list
  /// is in its house order (oldest first) and the last loaded row is already
  /// younger than a fortnight: every older row then sorts above it. Otherwise
  /// it is a floor, and the banner says "at least".
  const isOver = (row: MissingItem) =>
    row.age_hours !== null && row.age_hours > OVERDUE_HOURS
  const overdue = rows.filter(isOver).length
  const last = rows[rows.length - 1] as MissingItem | undefined
  const houseOrder = scope.sort === "missing_since" && scope.desc === false
  const overdueExact =
    !missing.hasNextPage ||
    (houseOrder &&
      last !== undefined &&
      last.age_hours !== null &&
      !isOver(last))

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Missing"
        sub="Stock the ledger has moved out of sight and nobody has answered for yet."
      />

      {overdue > 0 && (
        <Banner tone="warn" className="mb-3.5">
          {overdueExact ? "" : "At least "}
          {count(overdue)} of these have been missing more than a fortnight.
          Until each is called found, lost or disposed of, it stays on the books
          as stock the business owns and cannot sell.
        </Banner>
      )}

      <Toolbar>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by tag, SKU or pool"
          className="h-8 w-72"
        />
        <FilterPanel model={model} />
        <Toolbar.Spacer />
        {head && (
          <span className="text-[0.875rem] text-mute tabular-nums">
            {count(head.total)} open
          </span>
        )}
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(missing, {
          loading: "Reading what cannot be found…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {needle === "" && filters.filters.length === 0
                  ? "Nothing is missing. Every subject the ledger holds is in a pool somebody can walk to."
                  : "Nothing missing matches what you asked for."}
              </EmptyState>
            ) : (
              <DataTable<MissingItem>
                table={table}
                more={missing}
                onRowClick={(row) => item.open(row.id)}
                isSelected={(row) => row.id === item.value}
                className="max-h-[calc(100vh-19rem)]"
              />
            ),
        })}
      </Card>

      {/* Handed its row from the loaded pages: there is no single-row read.
          A pasted link opens once the page holding that row has loaded. */}
      <ResolveSheet
        item={rows.find((row) => row.id === item.value) ?? null}
        onClose={item.close}
      />
    </PageContent>
  )
}

/// The one sheet in this module that is handed its row rather than fetching it.
///
/// There is no `GET /inventory/missing/{id}` — the list read is the record, and
/// asking for one would mean asking for all five hundred again. The trade is
/// that a pasted link only opens once the list behind it has loaded, which is
/// the same wait the list itself has.
interface ResolutionDraft {
  outcome: "found" | "lost" | "dispose"
  destination: string
  quantity: string
  reason: string
  reference: string
}

function ResolveSheet({
  item,
  onClose,
}: {
  item: MissingItem | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const resolve = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: ResolutionDraft) =>
      resolveMissing(item!.id, draft.outcome, {
        actor_id: actor,
        idempotency_key: idempotencyKey(),
        // Null means "the whole missing balance", which the server works out
        // by replaying the movements in and out of the missing place. A blank
        // box is that, not a zero.
        quantity: draft.quantity.trim() === "" ? null : Number(draft.quantity),
        destination_pool_id:
          draft.outcome === "found" && draft.destination !== ""
            ? draft.destination
            : null,
        reason: draft.reason,
        reference: draft.reference.trim() === "" ? null : draft.reference,
      }),
    onSuccess: () => {
      // The row disappears from this list, the pool it left gains or loses
      // stock, and the fleet totals follow.
      client.invalidateQueries({ queryKey: inventoryKeys.missing() })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      client.invalidateQueries({ queryKey: ["inventory", "pools"] })
      // What described this one resolution. The outcome and the pool stay,
      // because a rack that turned up one item usually turns up several.
      form.setFieldValue("reason", "")
      form.setFieldValue("reference", "")
      form.setFieldValue("quantity", "")
    },
  })

  const form = useForm({
    defaultValues: {
      outcome: "found",
      destination: "",
      quantity: "",
      reason: "",
      reference: "",
    } as ResolutionDraft,
    onSubmit: ({ value }) => resolve.mutate(value),
  })

  const destinations = useMemo(
    () =>
      writablePools(fleet.data?.items ?? []).map((pool) => ({
        value: pool.id,
        label: `${pool.site_id} · ${pool.label}`,
      })),
    [fleet.data]
  )

  return (
    <Sheet
      open={item !== null}
      subject={item === null ? undefined : { kind: "missing", id: item.id }}
      onOpenChange={(open) => !open && onClose()}
      id={item?.epc ?? item?.sku_code ?? undefined}
      title={item ? `Missing from ${item.pool_label}` : "Missing"}
    >
      {item && (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Quantity">{count(item.quantity)}</Fact>
            <Fact term="Missing for">{age(item.age_hours)}</Fact>
            <Fact term="Since">{moment(item.missing_since)}</Fact>
            <Fact term="Last seen">{moment(item.last_observation)}</Fact>
            <Fact term="Site">{item.site_id}</Fact>
            <Fact term="Pool">{item.origin_pool}</Fact>
            <Fact term="Kind">{item.subject_type}</Fact>
            <Fact term="Last count">
              {item.latest_count_status
                ? humanise(item.latest_count_status)
                : "Never counted"}
            </Fact>
          </Facts>

          {resolve.isError && (
            <Banner tone="bad">
              {resolve.error instanceof Error
                ? resolve.error.message
                : "The resolution was refused."}
            </Banner>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault()
              form.handleSubmit()
            }}
            className="flex flex-col gap-3 border-t border-hairline pt-4"
          >
            <form.Field name="outcome">
              {(field) => (
                <Segmented
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={[
                    { value: "found", label: "Found" },
                    { value: "lost", label: "Lost" },
                    { value: "dispose", label: "Disposed" },
                  ]}
                />
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.outcome}>
              {(outcome) => (
                <>
                  <p className="text-[0.875rem] text-mute">
                    {outcome === "found"
                      ? "Back on hand in the pool it is actually in — which need not be the one it went missing from."
                      : outcome === "lost"
                        ? "Written off to system/lost. It counts against this pool's loss rate from that moment."
                        : "Out through external/disposal. The goods existed, were found, and were destroyed."}
                  </p>

                  {outcome === "found" && (
                    <form.Field name="destination">
                      {(field) => (
                        <Field
                          label="Found in"
                          hint="Leave empty to put it back where it went missing from."
                        >
                          <Choice
                            value={field.state.value}
                            onChange={field.handleChange}
                            options={destinations}
                            placeholder={item.origin_pool}
                            className="h-9 w-full max-w-none"
                          />
                        </Field>
                      )}
                    </form.Field>
                  )}
                </>
              )}
            </form.Subscribe>

            <form.Field name="quantity">
              {(field) => (
                <Field
                  label="Quantity"
                  hint={`Empty resolves the whole balance of ${count(item.quantity)}.`}
                >
                  <Input
                    type="number"
                    min={1}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={String(item.quantity)}
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
                    placeholder="Turned up behind the returns rack"
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="reference">
              {(field) => (
                <Field
                  label="Reference"
                  hint="A count id, a note number. Optional."
                >
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>

            <form.Subscribe
              selector={(state) => ({
                outcome: state.values.outcome,
                ready: state.values.reason.trim() !== "",
              })}
            >
              {(state) => (
                <Button
                  type="submit"
                  variant="primary"
                  pending={resolve.isPending}
                  disabled={!state.ready || actor === ""}
                >
                  {resolve.isPending
                    ? "Posting…"
                    : state.outcome === "found"
                      ? "Put it back on hand"
                      : state.outcome === "lost"
                        ? "Write it off as lost"
                        : "Record the disposal"}
                </Button>
              )}
            </form.Subscribe>
          </form>
        </div>
      )}
    </Sheet>
  )
}
