import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import { Banner, EmptyState, Truncated } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, moment } from "@/lib/format"
import {
  fleetPools,
  idempotencyKey,
  ingestObservations,
  inventoryKeys,
  listObservations,
  observationAnomalies,
  OBSERVATIONS_LIMIT,
  type Observation,
  type ObservationAnomaly,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
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

const sightings: ColumnDef<TableSetup, Observation>[] = [
  {
    accessorKey: "epc",
    header: "Tag",
    size: 220,
    // No filter: the toolbar already puts the EPC on the wire, and a second
    // box asking the same question of the 300 rows that came back would
    // answer differently from the one above it.
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">{row.original.epc}</span>
    ),
  },
  {
    accessorKey: "sku_code",
    header: "SKU",
    size: 140,
    /// `text` rather than `option`, for the emptiness test at the end of its
    /// operator list: a sighting with no SKU is a tag the catalogue does not
    /// know, and "SKU is empty" is the only way to ask for exactly those.
    /// Faceting hundreds of SKU codes would bury that question in a long list.
    meta: { filter: { kind: "text" } },
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
    /// Faceted from the rows themselves, never from the fleet list beside it:
    /// the cloud spells a place `dc` and an edge node spells the same place
    /// `dc-01`, so a facet built from one side and matched against the other
    /// offers a value with a count that selects nothing.
    ///
    /// It does not duplicate the pool box in the toolbar, which sends ONE pool
    /// to the server and is the right control for "show me that shelf". This
    /// asks the questions that box cannot: several pools at once, or every
    /// pool except one — over the sweep that came back, which is what the
    /// banner above the table is there to say.
    meta: { filter: { kind: "option" } },
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
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => <Tag>{row.original.device_id}</Tag>,
  },
  {
    accessorKey: "read_count",
    header: "Reads",
    size: 90,
    meta: { align: "right", filter: { kind: "number", unit: "reads" } },
    cell: ({ row }) => count(row.original.read_count),
  },
  {
    accessorKey: "best_rssi",
    header: "Best RSSI",
    size: 110,
    /// Nullable, and the emptiness test is the useful half: a sighting with no
    /// signal recorded is a reader that reported a read without one, which is
    /// a fact about the reader rather than about the tag.
    meta: { align: "right", filter: { kind: "number", unit: "dBm" } },
    cell: ({ row }) =>
      row.original.best_rssi === null ? (
        <span className="text-mute">—</span>
      ) : (
        row.original.best_rssi.toFixed(1)
      ),
  },
  {
    accessorKey: "last_seen_at",
    header: "Last seen",
    size: 160,
    // The decision metric on a sighting list: how fresh the evidence is.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => moment(row.original.last_seen_at),
  },
]

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
    header: "The books say",
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
    header: "The reader saw",
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
  const [epc, setEpc] = useState("")
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

  const reads = useQuery({
    queryKey: inventoryKeys.observations(pool, epc),
    queryFn: ({ signal }) => listObservations(pool, epc, signal),
    enabled: tab === "sightings",
  })

  const anomalies = useQuery({
    queryKey: inventoryKeys.anomalies(),
    queryFn: ({ signal }) => observationAnomalies(signal),
    enabled: tab === "anomalies",
  })

  const readRows = useMemo(() => reads.data ?? [], [reads.data])
  const anomalyRows = useMemo(() => anomalies.data ?? [], [anomalies.data])

  /// Two tables, two parameters. They share two column ids — `epc` and
  /// `device_id` — so one key would carry a reader picked on the sightings tab
  /// over to the anomalies tab and narrow a list nobody asked to narrow.
  const readFilters = useFilters(sightings)
  const anomalyFilters = useFilters(mismatches, "f2")

  const readTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: readRows,
        columns: readFilters.columns,
        getRowId: (row: Observation) => row.observation_id,
        state: {
          columnFilters: readFilters.columnFilters,
          sorting: sighted,
        },
        onSortingChange: setSighted,
      }),
      [readRows, readFilters.columns, readFilters.columnFilters, sighted]
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
        title="Sightings"
        sub="What the readers saw. Evidence, never a movement — the ledger is only ever corrected by a person."
      />

      <SubTabs
        tabs={[
          { value: "sightings", label: "Sightings" },
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
              placeholder="Every pool"
              className="max-w-72"
            />
            <Input
              value={epc}
              onChange={(event) => setEpc(event.target.value)}
              placeholder="EPC"
              className="h-8 w-64 font-mono"
            />
            <FilterPanel model={readFilters} table={readTable} />
            <Toolbar.Spacer />
            <Button onClick={() => setSubmitting(true)}>
              <Radar />
              Submit a batch
            </Button>
          </Toolbar>

          {/* Only when the sweep came back exactly as large as the question.
              A shorter answer proves there was nothing more to send; this
              length proves nothing either way — and every clause in the panel
              above is then a question asked of these 300 rows rather than of
              the readers' whole night. */}
          {readRows.length >= OBSERVATIONS_LIMIT && (
            <Truncated limit={OBSERVATIONS_LIMIT} noun="sightings" />
          )}

          <Card className="overflow-hidden">
            {queryState(reads, {
              loading: "Reading the sweeps…",
              render: () =>
                readRows.length === 0 ? (
                  <EmptyState>
                    {pool === "" && epc === ""
                      ? "No reader has reported a sighting to this node."
                      : "No sighting matches this pool and tag."}
                  </EmptyState>
                ) : (
                  <DataTable<Observation>
                    table={readTable}
                    empty="No sighting matches the filters in force."
                    className="max-h-[calc(100vh-19rem)]"
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
                    className="max-h-[calc(100vh-17rem)]"
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
          folded into one sighting rather than counted forty times. Nothing here
          moves stock.
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
            <Field label="Pool">
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

        <form.Field name="device">
          {(field) => (
            <Field label="Reader" hint="The handheld's device id.">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="HH-DC-01"
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
                hint={`${count(read)} read${read === 1 ? "" : "s"} · one EPC per line, or comma separated.`}
              >
                <Textarea
                  rows={6}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="font-mono"
                  placeholder={"A0000000000000000001\nA0000000000000000002"}
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
              disabled={!ready || send.isPending}
            >
              {send.isPending ? "Sending…" : "Submit the sweep"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}
