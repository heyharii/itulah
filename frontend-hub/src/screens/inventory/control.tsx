import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { FlaskConical } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { useFilters } from "@/lib/filters"
import { count, moment } from "@/lib/format"
import {
  controlStatus,
  corruptProjection,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  runReplay,
  runRepost,
  type ProjectionDifference,
  type ReplayScope,
  type RollupDifference,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Choice } from "@/screens/inventory/parts"
import { signed, useActor } from "@/screens/inventory/shared"

/// Does the projection still equal the ledger?
///
/// Everything read from this app comes out of `inventory_projection`, which is
/// a fold of the movement ledger and can in principle drift from it. Three
/// operations answer that, and they are not the same size:
///
///  - **Replay** re-folds the ledger and compares. It writes nothing and takes
///    no idempotency key, because there is nothing to apply twice.
///  - **Repost** rebuilds the projection from the ledger inside one
///    transaction, aborts if the ledger moved underneath it, and refuses to
///    commit unless the rebuild reproduces the comparison exactly. It creates
///    no ledger facts — `ledger_facts_created` is always zero, and that is a
///    guarantee rather than a statistic.
///  - **Corrupt** deliberately breaks one row so the repair can be watched
///    working. Any node without `INVENTORY_ENABLE_TEST_CONTROLS` refuses it,
///    which is the answer production should give.
///
/// `difference` is ledger minus projection, so a positive number is stock the
/// projection has lost.

const rowDifferences: ColumnDef<TableSetup, ProjectionDifference>[] = [
  {
    accessorKey: "place_id",
    header: "Place",
    size: 260,
    /// `text`, not `option`: a place is `<pool>:<state>`, so "contains
    /// :missing" and "starts with store-07" are the two questions somebody
    /// debugging a divergence actually asks, and a facet of every place in a
    /// broken fleet is a list as long as the table.
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <AppLink
        to="/inventory/pools"
        sheet={{
          key: "pool",
          value: row.original.place_id.replace(/:.*$/, ""),
        }}
        className="font-mono text-id text-body hover:text-ink hover:underline"
      >
        {row.original.place_id}
      </AppLink>
    ),
  },
  {
    accessorKey: "subject_id",
    header: "Subject",
    size: 300,
    // A subject is a uuid carried here from somewhere else. Nobody narrows a
    // list by one; they paste it into the time machine.
    cell: ({ row }) => (
      <span className="font-mono text-id text-mute">
        {row.original.subject_id}
      </span>
    ),
  },
  {
    accessorKey: "ledger_quantity",
    header: "Ledger",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.ledger_quantity),
  },
  {
    accessorKey: "projection_quantity",
    header: "Projection",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.projection_quantity),
  },
  {
    accessorKey: "difference",
    header: "Difference",
    size: 120,
    /// Ledger minus projection, so the sign is the direction of the drift —
    /// "at least 1" is stock the projection has lost, "at most -1" is stock it
    /// has invented. The one filter on this table somebody uses twice a day.
    meta: {
      align: "right",
      filter: { kind: "number", unit: "pcs" },
    },
    cell: ({ row }) => (
      <span className="font-medium text-bad-fg">
        {signed(row.original.difference)}
      </span>
    ),
  },
]

const stageDifferences: ColumnDef<TableSetup, RollupDifference>[] = [
  {
    accessorKey: "parent_pool_id",
    header: "Stage",
    size: 260,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.parent_pool_id}
      </span>
    ),
  },
  {
    accessorKey: "state",
    header: "State",
    size: 120,
    meta: { filter: { kind: "option" } },
  },
  {
    accessorKey: "ledger_quantity",
    header: "Ledger",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.ledger_quantity),
  },
  {
    accessorKey: "projection_quantity",
    header: "Projection",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.projection_quantity),
  },
  {
    accessorKey: "difference",
    header: "Difference",
    size: 120,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "pcs" },
    },
    cell: ({ row }) => (
      <span className="font-medium text-bad-fg">
        {signed(row.original.difference)}
      </span>
    ),
  },
]

export function Control() {
  const client = useQueryClient()
  const actor = useActor()
  const [tab, setTab] = useState("rows")
  const [site, setSite] = useState("")
  const [pool, setPool] = useState("")
  const [testing, setTesting] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([
    { id: "difference", desc: true },
  ])
  const [stageSorting, setStageSorting] = useState<SortingState>([
    { id: "difference", desc: true },
  ])

  const status = useQuery({
    queryKey: inventoryKeys.control(),
    queryFn: ({ signal }) => controlStatus(signal),
  })

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const scope: ReplayScope = useMemo(
    () => ({
      site_id: site === "" ? undefined : site,
      pool_id: pool === "" ? undefined : pool,
    }),
    [site, pool]
  )

  const replay = useMutation({
    mutationFn: () => runReplay(scope, actor),
    // A replay changes nothing, so nothing is invalidated except the status
    // panel that reports when it last ran.
    onSuccess: () =>
      client.invalidateQueries({ queryKey: inventoryKeys.control() }),
  })

  const repost = useMutation({
    mutationFn: () => runRepost(scope, actor, idempotencyKey()),
    onSuccess: () => {
      // A repost rewrites the projection every other read in this module is
      // drawn from, so the whole namespace goes. This is the one place that
      // blanket invalidation is the honest answer rather than laziness.
      client.invalidateQueries({ queryKey: inventoryKeys.all })
    },
  })

  const rows = useMemo(
    () => (status.data?.differences ?? []) as ProjectionDifference[],
    [status.data]
  )
  const stages = useMemo(
    () =>
      (status.data?.outbound_rollup_differences ?? []) as RollupDifference[],
    [status.data]
  )

  /// A parameter each, because both tables have a `difference` and a
  /// `state`-shaped question: one key would carry a clause from the tab being
  /// read onto the tab beside it.
  const rowFilters = useFilters(rowDifferences)
  const stageFilters = useFilters(stageDifferences, "f2")

  const rowTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: rowFilters.columns,
        getRowId: (row: ProjectionDifference) =>
          `${row.subject_id}/${row.place_id}`,
        state: { columnFilters: rowFilters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, rowFilters.columns, rowFilters.columnFilters, sorting]
    )
  )

  const stageTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: stages,
        columns: stageFilters.columns,
        getRowId: (row: RollupDifference) =>
          `${row.parent_pool_id}/${row.state}`,
        state: {
          columnFilters: stageFilters.columnFilters,
          sorting: stageSorting,
        },
        onSortingChange: setStageSorting,
      }),
      [stages, stageFilters.columns, stageFilters.columnFilters, stageSorting]
    )
  )

  const sites = useMemo(() => {
    const seen = new Set((fleet.data?.items ?? []).map((one) => one.site_id))
    return [...seen].sort().map((one) => ({ value: one, label: one }))
  }, [fleet.data])

  const pools = useMemo(
    () =>
      (fleet.data?.items ?? [])
        .filter((one) => site === "" || one.site_id === site)
        .map((one) => ({ value: one.id, label: one.label })),
    [fleet.data, site]
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Ledger control"
        sub="Whether the projection every other screen reads still equals the movements underneath it."
      />

      {replay.isError || repost.isError ? (
        <Banner tone="bad" className="mb-3.5">
          {(replay.error ?? repost.error) instanceof Error
            ? ((replay.error ?? repost.error) as Error).message
            : "The server refused the run."}
        </Banner>
      ) : null}

      {replay.isSuccess && replay.data && replay.data.status !== "MATCH" && (
        <Banner tone="warn" className="mb-3.5">
          Replay {replay.data.run_id} folded{" "}
          {count(replay.data.ledger_fact_count)} facts and found{" "}
          {count(replay.data.difference_count)} disagreements
          {replay.data.outbound_rollup_difference_count > 0
            ? `, plus ${count(replay.data.outbound_rollup_difference_count)} at the stage rollups`
            : ""}
          . Nothing was written.
        </Banner>
      )}

      {queryState(status, {
        loading: "Comparing the ledger with its projection…",
        render: (data) => (
          <>
            <KpiStrip>
              <Kpi
                label="Ledger health"
                value={
                  data.ledger_health === "HEALTHY" ? "Healthy" : "Divergent"
                }
                tone={data.ledger_health === "HEALTHY" ? "up" : "down"}
              />
              <Kpi label="Ledger facts" value={count(data.ledger_fact_count)} />
              {/* `count` draws a null as an em dash, which is the honest
                  reading of "not counted" — and the tone follows the health
                  verdict beside it, which the server still answers exactly
                  whether or not it counted. */}
              <Kpi
                label="Row differences"
                value={count(data.projection_difference_count)}
                tone={
                  (data.projection_difference_count ?? 0) > 0 ||
                  (data.projection_difference_count === null &&
                    data.ledger_health !== "HEALTHY")
                    ? "down"
                    : "flat"
                }
              />
              <Kpi
                label="Stage differences"
                value={count(data.outbound_rollup_difference_count)}
                tone={
                  data.outbound_rollup_difference_count > 0 ? "down" : "flat"
                }
              />
              <Kpi
                label="Last replay"
                value={
                  data.last_replay ? moment(data.last_replay.ran_at) : "Never"
                }
                delta={data.last_replay?.status.toLowerCase()}
              />
              <Kpi
                label="Last repost"
                value={
                  data.last_repost ? moment(data.last_repost.ran_at) : "Never"
                }
                delta={
                  data.last_repost
                    ? `${count(data.last_repost.projection_rows)} rows`
                    : undefined
                }
              />
            </KpiStrip>

            <Card className="mb-[1.125rem] overflow-hidden">
              <CardHeader>
                <CardTitle>Run a check</CardTitle>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setTesting(true)}
                >
                  <FlaskConical />
                  Test controls
                </Button>
              </CardHeader>
              <div className="border-t border-hairline px-4 py-3.5">
                <Toolbar className="mb-3">
                  <Choice
                    value={site}
                    onChange={(value) => {
                      setSite(value)
                      setPool("")
                    }}
                    options={sites}
                    placeholder="Whole ledger"
                  />
                  <Choice
                    value={pool}
                    onChange={setPool}
                    options={pools}
                    placeholder="Every pool"
                    className="max-w-72"
                  />
                  <Toolbar.Spacer />
                  <Button
                    variant="ghost"
                    pending={repost.isPending}
                    disabled={actor === ""}
                    onClick={() => repost.mutate()}
                  >
                    {repost.isPending ? "Rebuilding…" : "Repost the projection"}
                  </Button>
                  <Button
                    variant="primary"
                    pending={replay.isPending}
                    disabled={actor === ""}
                    onClick={() => replay.mutate()}
                  >
                    {replay.isPending ? "Replaying…" : "Replay and compare"}
                  </Button>
                </Toolbar>
                <p className="text-[0.875rem] text-mute">
                  Replay reads; repost writes. Repost aborts rather than commit
                  if the ledger moves while it is working, and refuses to commit
                  a rebuild that does not reproduce the comparison exactly.
                </p>
              </div>
            </Card>

            <SubTabs
              tabs={[
                { value: "rows", label: `Rows · ${count(rows.length)}` },
                {
                  value: "stages",
                  label: `Stage rollups · ${count(stages.length)}`,
                },
              ]}
              value={tab}
              onChange={setTab}
            />

            {/* The tab's own panel, and only its own: the two tables ask
                different questions of different rows, and the one on screen is
                the one being narrowed. */}
            <Toolbar>
              {tab === "rows" ? (
                <FilterPanel model={rowFilters} table={rowTable} />
              ) : (
                <FilterPanel model={stageFilters} table={stageTable} />
              )}
            </Toolbar>

            <Card className="overflow-hidden">
              {tab === "rows" ? (
                rows.length === 0 ? (
                  <EmptyState>
                    Every (subject, place) row in the projection equals the fold
                    of the ledger behind it.
                  </EmptyState>
                ) : (
                  <DataTable<ProjectionDifference>
                    table={rowTable}
                    empty="No disagreement matches the filters in force."
                    className="max-h-[calc(100vh-32rem)]"
                  />
                )
              ) : stages.length === 0 ? (
                <EmptyState>
                  Every outbound stage total equals the sum of the destination
                  leaves under it.
                </EmptyState>
              ) : (
                <DataTable<RollupDifference>
                  table={stageTable}
                  empty="No stage rollup matches the filters in force."
                  className="max-h-[calc(100vh-32rem)]"
                />
              )}
            </Card>
          </>
        ),
      })}

      <TestSheet open={testing} onClose={() => setTesting(false)} />
    </PageContent>
  )
}

/// Breaking one row on purpose.
///
/// It exists so the repair path can be demonstrated end to end rather than
/// taken on trust, and it is the one control in this module that a healthy
/// production node must refuse. When it does, its own sentence is what appears.
function TestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient()

  const corrupt = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: { subject: string; place: string; delta: string }) =>
      corruptProjection({
        subject_id: draft.subject.trim(),
        place_id: draft.place.trim(),
        delta: Number(draft.delta),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: inventoryKeys.control() })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
    },
  })

  const form = useForm({
    defaultValues: { subject: "", place: "", delta: "-1" },
    onSubmit: ({ value }) => corrupt.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Test controls"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="flex flex-col gap-4"
      >
        <Banner tone="warn">
          This moves the projection away from the ledger without writing a
          movement — exactly the drift the control screen exists to find. A node
          started without `INVENTORY_ENABLE_TEST_CONTROLS` refuses it, and
          should.
        </Banner>

        {corrupt.isError && (
          <Banner tone="bad">
            {corrupt.error instanceof Error
              ? corrupt.error.message
              : "The server refused."}
          </Banner>
        )}
        {corrupt.isSuccess && corrupt.data && (
          <Banner tone="info">
            {corrupt.data.warning}. The row now reads{" "}
            {count(corrupt.data.new_projection_quantity)}; the ledger did not
            move. Replay to see it, repost to repair it.
          </Banner>
        )}

        <form.Field name="subject">
          {(field) => (
            <Field
              label="Subject"
              required
              hint="The subject uuid from a differences row."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                className="font-mono"
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="place">
          {(field) => (
            <Field
              label="Place"
              required
              hint="For example dc.warehouse:on_hand."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                className="font-mono"
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="delta">
          {(field) => (
            <Field label="Delta">
              <Input
                type="number"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) =>
            state.values.subject.trim() !== "" &&
            state.values.place.trim() !== ""
          }
        >
          {(ready) => (
            <Button
              type="submit"
              variant="danger"
              pending={corrupt.isPending}
              disabled={!ready}
            >
              {corrupt.isPending ? "Breaking…" : "Corrupt this row"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}
