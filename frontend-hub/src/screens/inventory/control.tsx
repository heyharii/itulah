import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { FlaskConical, Play } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
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
import { useLayout } from "@/lib/layout"
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
import { useActor } from "@/screens/inventory/shared"
import { CardFigure, CardName } from "@/components/ui/phone-cards"
import {
  DisplayUnitPicker,
  useDisplayUnit,
  type DisplayUnit,
} from "@/screens/inventory/unit-display"

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

/// `signed`, in whatever unit the viewer chose to read pieces in — "+3 lusin"
/// rather than "+36", the sign kept out front where `formatInUnit`'s own
/// negative handling would otherwise bury it after the whole-unit count.
function signedInUnit(value: number, display: DisplayUnit): string {
  return value > 0 ? `+${display.format(value)}` : display.format(value)
}

function rowDifferences(
  display: DisplayUnit
): ColumnDef<TableSetup, ProjectionDifference>[] {
  return [
    {
      accessorKey: "place_id",
      header: "Place",
      size: 260,
      /// `text`, not `option`: a place is `<pool>:<state>`, so "contains
      /// :missing" and "starts with store-07" are the two questions somebody
      /// debugging a divergence actually asks, and a facet of every place in
      /// a broken fleet is a list as long as the table.
      meta: { card: "hide", filter: { kind: "text" } },
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
      // A subject is a uuid carried here from somewhere else. Nobody narrows
      // a list by one; they paste it into the time machine.
      meta: { card: "hide" },
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
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => display.format(row.original.ledger_quantity),
    },
    {
      accessorKey: "projection_quantity",
      header: "Projection",
      size: 120,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => display.format(row.original.projection_quantity),
    },
    {
      accessorKey: "difference",
      header: "Difference",
      size: 120,
      /// Ledger minus projection, so the sign is the direction of the drift —
      /// "at least 1" is stock the projection has lost, "at most -1" is stock
      /// it has invented. The one filter on this table somebody uses twice a
      /// day — filtering stays in pieces regardless of what the column prints.
      meta: {
        align: "right",
        card: "hide",
        filter: { kind: "number", unit: "pcs" },
      },
      cell: ({ row }) => (
        <span className="font-medium text-bad-fg">
          {signedInUnit(row.original.difference, display)}
        </span>
      ),
    },
  ]
}

/// The card a phone draws for a row that disagrees, as columns of their own
/// that exist there only (`cardLead`): the place over its subject, how far the
/// projection has drifted, and what each side holds.
function rowCards(
  display: DisplayUnit
): ColumnDef<TableSetup, ProjectionDifference>[] {
  return [
    {
      id: "head",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      accessorFn: (row) => row.place_id,
      cell: ({ row }) => (
        <CardName
          name={
            <AppLink
              to="/inventory/pools"
              sheet={{
                key: "pool",
                value: row.original.place_id.replace(/:.*$/, ""),
              }}
              className="font-mono text-[0.9375rem] break-all hover:underline"
            >
              {row.original.place_id}
            </AppLink>
          }
          line={
            <span className="font-mono break-all">
              {row.original.subject_id}
            </span>
          }
        />
      ),
    },
    {
      id: "lead",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      accessorFn: (row) => row.difference,
      cell: ({ row }) => (
        <CardFigure
          value={signedInUnit(row.original.difference, display)}
          caption="difference"
          tone="bad"
        />
      ),
    },
    {
      id: "foot",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      accessorFn: (row) => row.ledger_quantity,
      cell: ({ row }) => (
        <span className="tabular-nums">
          Ledger {display.format(row.original.ledger_quantity)} · Projection{" "}
          {display.format(row.original.projection_quantity)}
        </span>
      ),
    },
  ]
}

/// The same card for a stage rollup that disagrees with the leaves under it.
function stageCards(
  display: DisplayUnit
): ColumnDef<TableSetup, RollupDifference>[] {
  return [
    {
      id: "head",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      accessorFn: (row) => row.parent_pool_id,
      cell: ({ row }) => (
        <CardName
          name={
            <span className="font-mono text-[0.9375rem] break-all">
              {row.original.parent_pool_id}
            </span>
          }
          line={row.original.state}
        />
      ),
    },
    {
      id: "lead",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      accessorFn: (row) => row.difference,
      cell: ({ row }) => (
        <CardFigure
          value={signedInUnit(row.original.difference, display)}
          caption="difference"
          tone="bad"
        />
      ),
    },
    {
      id: "foot",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      accessorFn: (row) => row.ledger_quantity,
      cell: ({ row }) => (
        <span className="tabular-nums">
          Ledger {display.format(row.original.ledger_quantity)} · Projection{" "}
          {display.format(row.original.projection_quantity)}
        </span>
      ),
    },
  ]
}

function stageDifferences(
  display: DisplayUnit
): ColumnDef<TableSetup, RollupDifference>[] {
  return [
    {
      accessorKey: "parent_pool_id",
      header: "Stage",
      size: 260,
      meta: { card: "hide", filter: { kind: "text" } },
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
      meta: { card: "hide", filter: { kind: "option" } },
    },
    {
      accessorKey: "ledger_quantity",
      header: "Ledger",
      size: 110,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => display.format(row.original.ledger_quantity),
    },
    {
      accessorKey: "projection_quantity",
      header: "Projection",
      size: 120,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => display.format(row.original.projection_quantity),
    },
    {
      accessorKey: "difference",
      header: "Difference",
      size: 120,
      meta: {
        align: "right",
        card: "hide",
        filter: { kind: "number", unit: "pcs" },
      },
      cell: ({ row }) => (
        <span className="font-medium text-bad-fg">
          {signedInUnit(row.original.difference, display)}
        </span>
      ),
    },
  ]
}

export function Control() {
  const client = useQueryClient()
  const actor = useActor()
  const display = useDisplayUnit()
  const phone = useLayout() === "phone"
  const [rowText, setRowText] = useState("")
  const [stageText, setStageText] = useState("")
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

  const rowColumns = useMemo(
    () => [...rowDifferences(display), ...(phone ? rowCards(display) : [])],
    [display, phone]
  )
  const stageColumns = useMemo(
    () => [...stageDifferences(display), ...(phone ? stageCards(display) : [])],
    [display, phone]
  )

  /// A parameter each, because both tables have a `difference` and a
  /// `state`-shaped question: one key would carry a clause from the tab being
  /// read onto the tab beside it.
  const rowFilters = useFilters(rowColumns)
  const stageFilters = useFilters(stageColumns, "f2")

  const rowTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: rowFilters.columns,
        getRowId: (row: ProjectionDifference) =>
          `${row.subject_id}/${row.place_id}`,
        state: {
          columnFilters: rowFilters.columnFilters,
          globalFilter: rowText,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setRowText,
      }),
      [rows, rowFilters.columns, rowFilters.columnFilters, rowText, sorting]
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
          globalFilter: stageText,
          sorting: stageSorting,
        },
        onSortingChange: setStageSorting,
        onGlobalFilterChange: setStageText,
      }),
      [
        stages,
        stageFilters.columns,
        stageFilters.columnFilters,
        stageText,
        stageSorting,
      ]
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

  /// What the ⚙ menu over a phone's bottom bar adds: the run's other two
  /// acts, which a desk has in the head.
  const phoneActions = [
    {
      label: repost.isPending ? "Rebuilding…" : "Repost the projection",
      onClick: () => {
        if (actor !== "" && !repost.isPending) repost.mutate()
      },
    },
    { label: "Test controls", onClick: () => setTesting(true) },
  ]

  return (
    <PageContent>
      {/* The run is the page's act, so it stands in the head, at the right:
          replay reads, repost writes (it aborts rather than commit if the
          ledger moves while it is working, and refuses to commit a rebuild
          that does not reproduce the comparison exactly). A phone has them at
          the thumb: replay as the round button, the rest in the ⚙ menu. */}
      <PageHeader
        crumb="Inventory"
        title="Ledger Control"
        sub="Whether the projection every other screen reads still equals the movements underneath it."
        actions={
          phone ? undefined : (
            <>
              <Button variant="quiet" onClick={() => setTesting(true)}>
                <FlaskConical />
                Test controls
              </Button>
              <Button
                variant="ghost"
                pending={repost.isPending}
                disabled={actor === ""}
                title="Rebuilds the projection from the ledger. Aborts rather than commit if the ledger moves meanwhile."
                onClick={() => repost.mutate()}
              >
                {repost.isPending ? "Rebuilding…" : "Repost the projection"}
              </Button>
              <Button
                variant="primary"
                pending={replay.isPending}
                disabled={actor === ""}
                title="Re-folds the ledger and compares. Reads only: nothing is written."
                onClick={() => replay.mutate()}
              >
                {replay.isPending ? "Replaying…" : "Replay and compare"}
              </Button>
            </>
          )
        }
      />
      <Fab
        label="Replay and compare"
        icon={Play}
        onClick={() => {
          if (actor !== "" && !replay.isPending) replay.mutate()
        }}
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
            {/* On a phone the search, the filter and the order of the tab on
                screen are the dock's. */}
            {tab === "rows" ? (
              <DockTools
                search={{
                  value: rowText,
                  onChange: setRowText,
                  label: "Search differences",
                }}
                filter={{
                  count: rowFilters.filters.length,
                  panel: { model: rowFilters, table: rowTable },
                }}
                sort={dockSortOf(rowTable)}
                actions={phoneActions}
              />
            ) : (
              <DockTools
                search={{
                  value: stageText,
                  onChange: setStageText,
                  label: "Search stage rollups",
                }}
                filter={{
                  count: stageFilters.filters.length,
                  panel: { model: stageFilters, table: stageTable },
                }}
                sort={dockSortOf(stageTable)}
                actions={phoneActions}
              />
            )}
            {/* One bar: the scope a run is made over and what narrows the
                table, then the unit the figures are read in. A plain row, not
                the dock's Filters sheet: the scope is the run itself. On a
                phone they stack. */}
            <Toolbar
              inline
              className="max-md:flex-col max-md:items-stretch [&>*]:max-md:w-full [&>*]:max-md:max-w-none"
            >
              <Choice
                value={site}
                onChange={(value) => {
                  setSite(value)
                  setPool("")
                }}
                options={[{ value: "", label: "Every site" }, ...sites]}
              />
              <Choice
                value={pool}
                onChange={setPool}
                options={[{ value: "", label: "Every pool" }, ...pools]}
                className="max-w-72"
              />
              <span className="contents max-md:hidden">
                {tab === "rows" ? (
                  <FilterPanel model={rowFilters} table={rowTable} />
                ) : (
                  <FilterPanel model={stageFilters} table={stageTable} />
                )}
              </span>
              <Toolbar.Spacer />
              <DisplayUnitPicker display={display} />
            </Toolbar>

            <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              {tab === "rows" ? (
                rows.length === 0 ? (
                  <EmptyState>
                    Every (subject, place) row in the projection equals the fold
                    of the ledger behind it.
                  </EmptyState>
                ) : (
                  <DataTable<ProjectionDifference>
                    refresh={[status]}
                    table={rowTable}
                    empty="No disagreement matches the filters in force."
                    className="max-h-[calc(100dvh-23rem)]"
                    cardSort={false}
                    cardsApart
                    cardLead
                  />
                )
              ) : stages.length === 0 ? (
                <EmptyState>
                  Every outbound stage total equals the sum of the destination
                  leaves under it.
                </EmptyState>
              ) : (
                <DataTable<RollupDifference>
                  refresh={[status]}
                  table={stageTable}
                  empty="No stage rollup matches the filters in force."
                  className="max-h-[calc(100dvh-23rem)]"
                  cardSort={false}
                  cardsApart
                  cardLead
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
