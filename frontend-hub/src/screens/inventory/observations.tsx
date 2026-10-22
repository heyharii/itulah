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
import { Radar } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { BarSpacer } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { count, moment, sku as skuNumber } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  fleetPools,
  fleetPoolsQuery,
  idempotencyKey,
  ingestObservations,
  inventoryKeys,
  sightingsPageQuery,
  type Observation,
  type SightingScope,
} from "@/lib/queries/inventory"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { Choice } from "@/screens/inventory/parts"
import { placements, writablePools } from "@/screens/inventory/shared"
import { CardFigure, CardName } from "@/components/ui/phone-cards"

/// What the readers saw.
///
/// The claim this whole screen rests on is the server's own, and it is
/// hardcoded in the answer to an ingest: `inventory_effect: {0, 0}`. **A
/// sighting is evidence, not a movement.** No amount of reading a tag in the
/// wrong aisle moves it in the ledger; a person has to look at it and post a
/// placement correction in the pool.

/// Which column means which order the endpoint names. A column not in here
/// cannot be sorted — sorting it would sort the loaded pages and call that the
/// sweep.
const SIGHTING_SORTS: Record<string, string> = {
  epc: "epc",
  read_count: "read_count",
  last_seen_at: "last_seen_at",
}

/// Every narrowing here is a parameter the server answers —
/// the pool box, the search, and the reader chip below — so the list walks
/// the readers' whole history with `next_cursor` rather than sifting the
/// newest few hundred.
const sightings: ColumnDef<TableSetup, Observation>[] = [
  {
    accessorKey: "epc",
    header: "Tag",
    size: 220,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">{row.original.epc}</span>
    ),
  },
  {
    accessorKey: "sku_code",
    header: "SKU",
    size: 140,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) =>
      row.original.sku_code ? (
        <span className="font-mono text-id text-body">
          {skuNumber(row.original.sku_code)}
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
    meta: { card: "hide" },
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
    meta: { card: "hide" },
    cell: ({ row }) => <Tag>{row.original.device_id}</Tag>,
  },
  {
    accessorKey: "read_count",
    header: "Reads",
    size: 90,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => count(row.original.read_count),
  },
  {
    accessorKey: "best_rssi",
    header: "Best RSSI",
    size: 110,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
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
    meta: { card: "hide" },
    // The decision metric on a sighting list: how fresh the evidence is.
    cell: ({ row }) => moment(row.original.last_seen_at),
  },
]

/// The card a phone draws for a sighting, as columns of their own that exist
/// there only (`cardLead`): the SKU over the tag, how many times it was read,
/// where and when, and which reader.
const sightingCards: ColumnDef<TableSetup, Observation>[] = [
  {
    id: "head",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    accessorFn: (row) => row.sku_code ?? "",
    cell: ({ row }) => (
      <CardName // An unknown tag is still a fact, and is said so.
        name={row.original.sku_code ? skuNumber(row.original.sku_code) : "Unknown tag"}
        code={row.original.epc}
      />
    ),
  },
  {
    id: "lead",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    accessorFn: (row) => row.read_count,
    cell: ({ row }) => (
      <CardFigure
        value={count(row.original.read_count)}
        caption={row.original.read_count === 1 ? "read" : "reads"}
      />
    ),
  },
  {
    id: "foot",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    accessorFn: (row) => row.last_seen_at,
    cell: ({ row }) => (
      <span className="flex flex-col leading-6">
        <AppLink
          to="/inventory/pools"
          sheet={{ key: "pool", value: row.original.pool_id }}
          className="hover:text-ink hover:underline"
        >
          {row.original.pool_id}
        </AppLink>
        <span className="tabular-nums">
          {moment(row.original.last_seen_at)}
        </span>
      </span>
    ),
  },
  {
    id: "reader",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    accessorFn: (row) => row.device_id,
    cell: ({ row }) => <Tag>{row.original.device_id}</Tag>,
  },
]

/// The reader chip, the one narrowing here that is not the
/// pool box or the search. `single`, because the endpoint compares one column
/// to one value.
const SIGHTING_FIELDS: FilterField[] = [
  {
    column: "device_id",
    label: "Reader",
    spec: { kind: "option", single: true, operators: ["isAnyOf"] },
  },
  {
    column: "pool_id",
    label: "Pool",
    spec: {
      kind: "option",
      single: true,
      operators: ["isAnyOf"],
      searchable: true,
    },
  },
]

function sightingScopeFromFilters(filters: readonly Filter[]): {
  device_id?: string
  pool_id?: string
} {
  const scope: { device_id?: string; pool_id?: string } = {}
  for (const { column, operator, values } of filters) {
    if (operator !== "isAnyOf" || values.length === 0) continue
    if (column === "device_id") scope.device_id = values[0]
    else if (column === "pool_id") scope.pool_id = values[0]
  }
  return scope
}

export function Observations() {
  const phone = useLayout() === "phone"
  const [submitting, setSubmitting] = useState(false)

  // The head, the + and the batch sheet stand at once; the readers' sweeps
  // wait for the fleet and the first page and stream in with them (the server
  // starts the reads too).
  return (
    <PageContent>
      {/* The screen's one act stands in its head; a phone has it at the
          thumb (`Fab`). */}
      <PageHeader
        crumb="Inventory"
        title="Observations"
        sub="What the readers saw. Evidence, never a movement — the ledger is only ever corrected by a person."
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setSubmitting(true)}>
              <Radar />
              Submit a batch
            </Button>
          )
        }
      />

      <Fab label="Submit a batch" onClick={() => setSubmitting(true)} />

      <Suspense fallback={<LoadingState>Reading the sweeps…</LoadingState>}>
        <ObservationBook />
      </Suspense>

      <BatchSheet open={submitting} onClose={() => setSubmitting(false)} />
    </PageContent>
  )
}

function ObservationBook() {
  const phone = useLayout() === "phone"
  const [text, setText] = useState("")
  const [sighted, setSighted] = useState<SortingState>([
    { id: "last_seen_at", desc: true },
  ])

  const fleet = useSuspenseQuery(fleetPoolsQuery())

  const readFilters = useFilterState(SIGHTING_FIELDS)
  const sightingColumns = useMemo(
    () => (phone ? [...sightings, ...sightingCards] : sightings),
    [phone]
  )

  // Debounced: every keystroke is a query over every reader's history.
  const needle = useDebounced(text.trim(), 400)
  const scope = useMemo<SightingScope>(() => {
    const by = sighted[0]
    const sort = by === undefined ? undefined : SIGHTING_SORTS[by.id]
    return {
      ...sightingScopeFromFilters(readFilters.filters),
      ...(needle === "" ? {} : { q: needle }),
      sort,
      // The house order (`last_seen_at`) is newest first already, so `desc`
      // there asks for the other way — see `sightingsPage`.
      desc: sort === "last_seen_at" ? by?.desc !== true : by?.desc === true,
    }
  }, [readFilters.filters, needle, sighted])

  // The deferred scope keeps the rows in hand on screen while the next
  // question is read, so a keystroke does not empty the table.
  const asked = useDeferredValue(scope)
  const reads = useSuspenseInfiniteQuery(sightingsPageQuery(asked))

  const readRows = useMemo(
    () => reads.data.pages.flatMap((page) => page.rows),
    [reads.data]
  )
  const readHead = reads.data.pages[0]

  const poolOptions = useMemo(
    () =>
      placements(fleet.data.items).map((item) => ({
        value: item.id,
        label: `${item.site_id} · ${item.label}`,
      })),
    [fleet.data]
  )

  /// The reader chip, carrying the server's exact tally over everything the
  /// pool and the search match.
  const readModel = useMemo(
    () => ({
      ...readFilters,
      fields: readHead
        ? SIGHTING_FIELDS.map((field) => ({
            ...field,
            spec:
              field.column === "pool_id"
                ? { ...field.spec, options: poolOptions }
                : { ...field.spec, counted: readHead.facets.devices },
          }))
        : SIGHTING_FIELDS,
    }),
    [readFilters, readHead, poolOptions]
  )

  const readTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: readRows,
        columns: sightingColumns,
        getRowId: (row: Observation) => row.observation_id,
        state: { sorting: sighted },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSighted,
      }),
      [readRows, sightingColumns, sighted]
    )
  )

  return (
    <>
      {/* On a phone the search, the filter and the order are the dock's, and
          so is the one thing this screen makes. */}
      <DockTools
        search={{
          value: text,
          onChange: setText,
          label: "Search observations",
        }}
        filter={{
          count: readFilters.filters.length,
          panel: { model: readFilters, filterModel: readModel },
        }}
        sort={dockSortOf(readTable)}
      />
      <div className="group/bar mb-3.5 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <FilterPanel
          model={readModel}
          search={{
            value: text,
            onChange: setText,
            label: "Search observations",
          }}
        />
        <BarSpacer />
        {readHead && (
          <span className="text-meta text-mute tabular-nums">
            {count(readHead.total)} observations
          </span>
        )}
      </div>

      <Card
        aria-busy={asked !== scope || undefined}
        className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
      >
        {readRows.length === 0 ? (
          <EmptyState>
            {needle === "" && readFilters.filters.length === 0
              ? "No reader has reported an observation to this node."
              : "No observation matches what you asked for."}
          </EmptyState>
        ) : (
          <DataTable<Observation>
            refresh={[reads]}
            table={readTable}
            more={reads}
            className="max-h-[calc(100dvh-17rem)]"
            cardSort={false}
            cardsApart
            cardLead
          />
        )}
      </Card>
    </>
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
      // The sightings change; nothing in the ledger does, so no pool or fleet
      // key is touched.
      client.invalidateQueries({ queryKey: ["inventory", "observations"] })
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
        <p className="text-[0.9375rem] text-mute">
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
