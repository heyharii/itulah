import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Radar } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import {
  useFilters,
  useFilterState,
  type Filter,
  type FilterField,
} from "@/lib/filters"
import { count, moment } from "@/lib/format"
import {
  fleetPools,
  idempotencyKey,
  ingestObservations,
  inventoryKeys,
  observationAnomalies,
  sightingsPage,
  type Observation,
  type ObservationAnomaly,
  type SightingScope,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { Choice } from "@/screens/inventory/parts"
import { placements, writablePools } from "@/screens/inventory/shared"

/// What the readers saw, and where it disagrees with the books.
///
/// The claim this whole screen rests on is the server's own, and it is
/// hardcoded in both answers: `automatic_inventory_effect: false` on an
/// anomaly, `inventory_effect: {0, 0}` on an ingest. **A sighting is evidence,
/// not a movement.** No amount of reading a tag in the wrong aisle moves it in
/// the ledger; a person has to look at the mismatch and post a placement
/// correction, which is why every anomaly row links straight into the pool
/// where that correction is made.

/// Which column means which order the endpoint names. A column not in here
/// cannot be sorted — sorting it would sort the loaded pages and call that the
/// sweep.
const SIGHTING_SORTS: Record<string, string> = {
  epc: "epc",
  read_count: "read_count",
  last_seen_at: "last_seen_at",
}

/// Every narrowing on the sightings tab is a parameter the server answers —
/// the pool box, the search, and the reader chip below — so the list walks
/// the readers' whole history with `next_cursor` rather than sifting the
/// newest few hundred.
const sightings: ColumnDef<TableSetup, Observation>[] = [
  {
    accessorKey: "epc",
    header: "Tag",
    size: 220,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">{row.original.epc}</span>
    ),
  },
  {
    accessorKey: "sku_code",
    header: "SKU",
    size: 140,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.sku_code ? (
        <span className="font-mono text-id text-body">
          {row.original.sku_code}
        </span>
      ) : (
        // An unknown tag is still a fact, and hiding it would hide the exact
        // reading somebody needs to explain.
        <Tag tone="warn">UNKNOWN</Tag>
      ),
  },
  {
    accessorKey: "pool_id",
    header: "Seen in",
    size: 200,
    enableSorting: false,
    cell: ({ row }) => (
      <AppLink
        to="/inventory/pools"
        sheet={{ key: "pool", value: row.original.pool_id }}
        className="text-body hover:text-ink hover:underline"
      >
        {row.original.pool_id}
      </AppLink>
    ),
  },
  {
    accessorKey: "device_id",
    header: "Reader",
    size: 150,
    enableSorting: false,
    cell: ({ row }) => <Tag>{row.original.device_id}</Tag>,
  },
  {
    accessorKey: "read_count",
    header: "Reads",
    size: 90,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.read_count),
  },
  {
    accessorKey: "best_rssi",
    header: "Best RSSI",
    size: 110,
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.best_rssi === null ? (
        <span className="text-mute">—</span>
      ) : (
        row.original.best_rssi.toFixed(1)
      ),
  },
  {
    accessorKey: "last_seen_at",
    header: "Last Seen",
    size: 160,
    // The decision metric on a sighting list: how fresh the evidence is.
    cell: ({ row }) => moment(row.original.last_seen_at),
  },
]

/// The reader chip, the one narrowing on the sightings tab that is not the
/// pool box or the search. `single`, because the endpoint compares one column
/// to one value.
const SIGHTING_FIELDS: FilterField[] = [
  {
    column: "device_id",
    label: "Reader",
    spec: { kind: "option", single: true, operators: ["isAnyOf"] },
  },
]

function sightingScopeFromFilters(filters: readonly Filter[]): {
  device_id?: string
} {
  for (const { column, operator, values } of filters) {
    if (column === "device_id" && operator === "isAnyOf" && values.length > 0)
      return { device_id: values[0] }
  }
  return {}
}

const mismatches: ColumnDef<TableSetup, ObservationAnomaly>[] = [
  {
    accessorKey: "epc",
    header: "Tag",
    size: 220,
    // A tag id is looked UP, not narrowed by: somebody holding one has the
    // EPC box on the sightings tab, which asks the server.
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">{row.original.epc}</span>
    ),
  },
  {
    accessorKey: "ledger_pool",
    header: "The Books Say",
    size: 200,
    /// The two pool columns are the whole question on this tab — "everything
    /// the books put in the DC that a reader saw elsewhere" is one clause on
    /// each. Both facet off these rows, which is the only place the two sides
    /// are spelled the same way.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <AppLink
        to="/inventory/pools"
        sheet={{ key: "pool", value: row.original.ledger_pool }}
        className="text-body hover:text-ink hover:underline"
      >
        {row.original.ledger_pool}
      </AppLink>
    ),
  },
  {
    accessorKey: "observed_pool",
    header: "The Reader Saw",
    size: 200,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <AppLink
        to="/inventory/pools"
        sheet={{ key: "pool", value: row.original.observed_pool }}
        className="font-medium text-warn-fg hover:underline"
      >
        {row.original.observed_pool}
      </AppLink>
    ),
  },
  {
    accessorKey: "quantity",
    header: "Quantity",
    size: 100,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.quantity),
  },
  {
    accessorKey: "device_id",
    header: "Reader",
    size: 150,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => <Tag>{row.original.device_id}</Tag>,
  },
  {
    accessorKey: "last_observed_at",
    header: "Seen",
    size: 160,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => moment(row.original.last_observed_at),
  },
]

export function Observations() {
  const [tab, setTab] = useState("sightings")
  const [pool, setPool] = useState("")
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [sighted, setSighted] = useState<SortingState>([
    { id: "last_seen_at", desc: true },
  ])
  const [mismatched, setMismatched] = useState<SortingState>([
    { id: "quantity", desc: true },
  ])

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  /// Two tables, two parameters. They share two column ids — `epc` and
  /// `device_id` — so one key would carry a reader picked on the sightings tab
  /// over to the anomalies tab and narrow a list nobody asked to narrow.
  const readFilters = useFilterState(SIGHTING_FIELDS)
  const anomalyFilters = useFilters(mismatches, "f2")

  // Debounced: every keystroke is a query over every reader's history.
  const needle = useDebounced(text.trim(), 400)
  const scope = useMemo<SightingScope>(() => {
    const by = sighted[0]
    const sort = by === undefined ? undefined : SIGHTING_SORTS[by.id]
    return {
      ...sightingScopeFromFilters(readFilters.filters),
      ...(pool === "" ? {} : { pool_id: pool }),
      ...(needle === "" ? {} : { q: needle }),
      sort,
      // The house order (`last_seen_at`) is newest first already, so `desc`
      // there asks for the other way — see `sightingsPage`.
      desc: sort === "last_seen_at" ? by?.desc !== true : by?.desc === true,
    }
  }, [readFilters.filters, pool, needle, sighted])

  const reads = useInfiniteQuery({
    queryKey: inventoryKeys.observations(scope),
    queryFn: ({ pageParam, signal }) =>
      sightingsPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
    enabled: tab === "sightings",
  })

  const anomalies = useQuery({
    queryKey: inventoryKeys.anomalies(),
    queryFn: ({ signal }) => observationAnomalies(signal),
    enabled: tab === "anomalies",
  })

  const readRows = useMemo(
    () => reads.data?.pages.flatMap((page) => page.rows) ?? [],
    [reads.data]
  )
  const readHead = reads.data?.pages[0]

  /// The reader chip, carrying the server's exact tally over everything the
  /// pool and the search match.
  const readModel = useMemo(
    () => ({
      ...readFilters,
      fields: readHead
        ? SIGHTING_FIELDS.map((field) => ({
            ...field,
            spec: { ...field.spec, counted: readHead.facets.devices },
          }))
        : SIGHTING_FIELDS,
    }),
    [readFilters, readHead]
  )
  const anomalyRows = useMemo(() => anomalies.data ?? [], [anomalies.data])

  const readTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: readRows,
        columns: sightings,
        getRowId: (row: Observation) => row.observation_id,
        state: { sorting: sighted },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSighted,
      }),
      [readRows, sighted]
    )
  )

  const anomalyTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: anomalyRows,
        columns: anomalyFilters.columns,
        getRowId: (row: ObservationAnomaly) =>
          `${row.subject_id}/${row.observed_pool}`,
        state: {
          columnFilters: anomalyFilters.columnFilters,
          sorting: mismatched,
        },
        onSortingChange: setMismatched,
      }),
      [
        anomalyRows,
        anomalyFilters.columns,
        anomalyFilters.columnFilters,
        mismatched,
      ]
    )
  )

  const poolOptions = useMemo(
    () =>
      placements(fleet.data?.items ?? []).map((item) => ({
        value: item.id,
        label: `${item.site_id} · ${item.label}`,
      })),
    [fleet.data]
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Observations"
        sub="What the readers saw. Evidence, never a movement — the ledger is only ever corrected by a person."
      />

      <SubTabs
        tabs={[
          { value: "sightings", label: "Observations" },
          {
            value: "anomalies",
            label: `Where they disagree${anomalies.data ? ` · ${anomalies.data.length}` : ""}`,
          },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "sightings" ? (
        <>
          <Toolbar>
            <Choice
              value={pool}
              onChange={setPool}
              options={poolOptions}
              className="max-w-72"
            />
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label="Search observations"
              className="h-8 w-64"
            />
            <FilterPanel model={readModel} />
            <Toolbar.Spacer />
            {readHead && (
              <span className="text-meta text-mute tabular-nums">
                {count(readHead.total)} observations
              </span>
            )}
            <Button onClick={() => setSubmitting(true)}>
              <Radar />
              Submit a batch
            </Button>
          </Toolbar>

          <Card className="overflow-hidden">
            {queryState(reads, {
              loading: "Reading the sweeps…",
              render: () =>
                readRows.length === 0 ? (
                  <EmptyState>
                    {pool === "" &&
                    needle === "" &&
                    readFilters.filters.length === 0
                      ? "No reader has reported an observation to this node."
                      : "No observation matches what you asked for."}
                  </EmptyState>
                ) : (
                  <DataTable<Observation>
                    table={readTable}
                    more={reads}
                    className="max-h-[calc(100dvh-17rem)]"
                  />
                ),
            })}
          </Card>
        </>
      ) : (
        <>
          <Toolbar>
            <FilterPanel model={anomalyFilters} table={anomalyTable} />
          </Toolbar>

          <Card className="overflow-hidden">
            {queryState(anomalies, {
              loading: "Comparing the books with the readers…",
              render: () =>
                anomalyRows.length === 0 ? (
                  <EmptyState>
                    Every tag was last seen where the ledger says it is.
                  </EmptyState>
                ) : (
                  <DataTable<ObservationAnomaly>
                    table={anomalyTable}
                    empty="No disagreement matches the filters in force."
                    className="max-h-[calc(100dvh-17rem)]"
                  />
                ),
            })}
          </Card>
        </>
      )}

      <BatchSheet open={submitting} onClose={() => setSubmitting(false)} />
    </PageContent>
  )
}

/// Submitting a sweep by hand.
///
/// This is a development and demonstration path and the server says so: any
/// node configured with a JWT secret refuses it outright, because a production
/// reader signs its batch and submits it to its own Edge, which forwards it
/// through authenticated sync. Pressing it on such a node returns that sentence,
/// and the sentence is worth showing rather than hiding the control.
/// Whatever was pasted, as EPCs. Whitespace or commas, either way, and the case
/// the reader printed is not the case the ledger holds.
function epcsOf(tags: string): readonly string[] {
  return tags
    .split(/[\s,]+/)
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value !== "")
}

function BatchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient()

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const pools = useMemo(
    () => writablePools(fleet.data?.items ?? []),
    [fleet.data]
  )
  const poolFor = (id: string) => pools.find((item) => item.id === id)

  const send = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: { pool: string; device: string; tags: string }) => {
      const chosen = poolFor(draft.pool)!
      return ingestObservations({
        site_id: chosen.site_id,
        // The one place this surface spells it short: the server's field is
        // `pool`, not `pool_id`.
        pool: chosen.id,
        device_id: draft.device,
        reader_session_id: idempotencyKey(),
        observed_at: new Date().toISOString(),
        idempotency_key: idempotencyKey(),
        observations: epcsOf(draft.tags).map((epc) => ({
          epc,
          antenna: null,
          rssi: null,
          phase: null,
          frequency: null,
          read_count: 1,
        })),
      })
    },
    onSuccess: () => {
      // Sightings and the anomaly comparison both change; nothing in the ledger
      // does, so no pool or fleet key is touched.
      client.invalidateQueries({ queryKey: ["inventory", "observations"] })
      client.invalidateQueries({ queryKey: inventoryKeys.anomalies() })
      // Only the tags: the next sweep is the same reader in the same pool.
      form.setFieldValue("tags", "")
    },
  })

  const form = useForm({
    defaultValues: { pool: "", device: "", tags: "" },
    onSubmit: ({ value }) => send.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Submit a reader batch"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="flex flex-col gap-4"
      >
        <p className="text-[0.875rem] text-mute">
          Reads of the same tag by the same reader inside the burst window are
          folded into one observation rather than counted forty times. Nothing
          here moves stock.
        </p>

        {send.isError && (
          <Banner tone="bad">
            {send.error instanceof Error
              ? send.error.message
              : "The batch was refused."}
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

        <form.Field name="device">
          {(field) => (
            <Field label="Reader" required hint="The handheld's device id.">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="tags">
          {(field) => {
            const read = epcsOf(field.state.value).length
            return (
              <Field
                label="Tags"
                required
                hint={`${count(read)} read${read === 1 ? "" : "s"} · one EPC per line, or comma separated.`}
              >
                <Textarea
                  rows={6}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="font-mono"
                />
              </Field>
            )
          }}
        </form.Field>

        <form.Subscribe
          selector={(state) =>
            poolFor(state.values.pool) !== undefined &&
            state.values.device.trim() !== "" &&
            epcsOf(state.values.tags).length > 0
          }
        >
          {(ready) => (
            <Button
              type="submit"
              variant="primary"
              pending={send.isPending}
              disabled={!ready}
            >
              {send.isPending ? "Sending…" : "Submit the sweep"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}
