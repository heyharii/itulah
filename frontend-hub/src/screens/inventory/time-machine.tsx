import { useMutation, useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniTable } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { Timeline } from "@/components/ui/timeline"
import { count, moment } from "@/lib/format"
import {
  fleetPools,
  inventoryKeys,
  syncDivergence,
  timeMachineDivergence,
  timeMachineState,
  timeMachineWhatIf,
  type TimeMachineDelta,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Choice } from "@/screens/inventory/parts"
import { edgeOrigins, signed } from "@/screens/inventory/shared"

/// The deterministic divergence debugger, four questions deep.
///
///  - **State** folds the ledger up to a `fact_sequence` — a sequence, not a
///    clock, so a backdated `occurred_at` cannot quietly change what "then"
///    meant. The hash is the whole world's fingerprint at that point.
///  - **Divergence** diffs that fold against the projection and hands back the
///    complete canonical history of each row that disagrees, which is what
///    turns "the number is wrong" into "this movement is the one".
///  - **Sync** compares an Edge node's own fact log against what Cloud ingested
///    from it, event by event, and names the first event where they part.
///  - **What if** asks whether a hypothetical movement would reconcile the two.
///    It is evaluated on a cloned world and writes nothing, so it is safe to
///    press repeatedly — which is exactly what it is for.
///
/// Everything here is an operator tool and every read says `read_only: true`.
/// The 100 000-row timeline cap is real: past it the fold below the cap is
/// still exact and what is above it is simply absent, which the screen says
/// rather than quietly showing less.

const stateColumns: ColumnDef<
  TableSetup,
  {
    subject_id: string
    place_id: string
    quantity: number
    last_fact_sequence: number
  }
>[] = [
  {
    accessorKey: "place_id",
    header: "Place",
    size: 260,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.place_id}
      </span>
    ),
  },
  {
    accessorKey: "subject_id",
    header: "Subject",
    size: 300,
    cell: ({ row }) => (
      <span className="font-mono text-id text-mute">
        {row.original.subject_id}
      </span>
    ),
  },
  {
    accessorKey: "quantity",
    header: "Quantity",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.quantity),
  },
  {
    accessorKey: "last_fact_sequence",
    header: "Last fact",
    size: 120,
    meta: { align: "right" },
    // The decision metric here: which rows moved most recently is what an
    // operator scans for when a fold looks wrong.
    cell: ({ row }) => count(row.original.last_fact_sequence),
  },
]

export function TimeMachine() {
  const [tab, setTab] = useState("state")

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Time machine"
        sub="Fold the ledger to any point, and find the exact event where two accounts of it part."
      />

      <SubTabs
        tabs={[
          { value: "state", label: "State at a sequence" },
          { value: "divergence", label: "Ledger vs projection" },
          { value: "sync", label: "Edge vs cloud" },
          { value: "what-if", label: "What if" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "state" && <StateTab />}
      {tab === "divergence" && <DivergenceTab />}
      {tab === "sync" && <SyncTab />}
      {tab === "what-if" && <WhatIfTab />}
    </PageContent>
  )
}

function StateTab() {
  const [seq, setSeq] = useState("")
  const [pool, setPool] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "last_fact_sequence", desc: true },
  ])

  const pools = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const world = useQuery({
    queryKey: inventoryKeys.timeMachineState(seq, pool),
    queryFn: ({ signal }) => timeMachineState(seq, pool, signal),
  })

  const rows = useMemo(() => world.data?.items ?? [], [world.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: stateColumns,
        getRowId: (row: { subject_id: string; place_id: string }) =>
          `${row.subject_id}/${row.place_id}`,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  return (
    <>
      <Toolbar>
        <Input
          value={seq}
          onChange={(event) => setSeq(event.target.value)}
          placeholder="Fact sequence — empty means now"
          className="h-8 w-64"
        />
        <Choice
          value={pool}
          onChange={setPool}
          options={(pools.data?.items ?? []).map((one) => ({
            value: one.id,
            label: one.label,
          }))}
          placeholder="Whole ledger"
          className="max-w-72"
        />
      </Toolbar>

      {queryState(world, {
        loading: "Folding the ledger…",
        render: (data) => (
          <>
            <Card className="mb-[1.125rem] px-4 py-3">
              <KeyValue term="Events applied">
                {count(data.events_applied)}
              </KeyValue>
              <KeyValue term="State hash">
                <span className="font-mono text-id">{data.state_hash}</span>
              </KeyValue>
              <KeyValue term="Folded to">
                {data.as_of_fact_sequence === null
                  ? "The end of the ledger"
                  : `Fact ${count(data.as_of_fact_sequence)}`}
              </KeyValue>
            </Card>

            {data.truncated && (
              <Banner tone="warn" className="mb-[1.125rem]">
                The timeline hit the server's row cap. Everything below it is
                exact; everything above it is absent rather than approximated.
                Narrow to one pool, or export the log.
              </Banner>
            )}

            {data.violations.length > 0 && (
              <Card className="mb-[1.125rem] overflow-hidden">
                <CardHeader>
                  <CardTitle>Invariants the fold broke</CardTitle>
                </CardHeader>
                <div className="border-t border-hairline px-4 py-3">
                  <MiniTable
                    head={[
                      "Invariant",
                      "Place",
                      { label: "At", align: "right" },
                    ]}
                  >
                    {data.violations.map((violation, index) => (
                      <tr
                        key={`${violation.subject_id}-${index}`}
                        className="border-t border-hairline"
                      >
                        <td className="py-2 pr-2">
                          <Tag tone="bad">{violation.invariant}</Tag>
                          <span className="mt-0.5 block text-[0.65625rem] text-mute">
                            {violation.detail}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono text-[0.65625rem] text-body">
                          {violation.place_id}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {count(violation.fact_sequence)}
                        </td>
                      </tr>
                    ))}
                  </MiniTable>
                </div>
              </Card>
            )}

            <Card className="overflow-hidden">
              {rows.length === 0 ? (
                <EmptyState>
                  {seq === ""
                    ? "The ledger holds no positive position anywhere."
                    : `Nothing was standing anywhere at fact ${seq}.`}
                </EmptyState>
              ) : (
                <DataTable
                  table={table}
                  className="max-h-[calc(100vh-28rem)]"
                />
              )}
            </Card>
          </>
        ),
      })}
    </>
  )
}

/// The deltas, each with the history that produced it. A `<Timeline>` rather
/// than a table because the question being asked is "in what order", and the
/// answer is only useful read downwards.
function Deltas({ deltas }: { deltas: readonly TimeMachineDelta[] }) {
  return (
    <div className="flex flex-col gap-3">
      {deltas.map((delta) => (
        <Card
          key={`${delta.subject_id}/${delta.place_id}`}
          className="overflow-hidden"
        >
          <CardHeader>
            <CardTitle className="font-mono text-id">
              {delta.place_id}
            </CardTitle>
            <span className="font-mono text-[0.65625rem] text-mute">
              {delta.subject_id}
            </span>
          </CardHeader>
          <div className="border-t border-hairline px-4 py-3">
            <MiniTable head={["Field", "Ledger", "Projection"]}>
              {delta.diffs.map((diff) => (
                <tr key={diff.field} className="border-t border-hairline">
                  <td className="py-2 pr-2 text-[0.8125rem] text-ink">
                    {diff.field}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {String(diff.ledger)}
                  </td>
                  <td className="py-2 text-right text-bad-fg tabular-nums">
                    {String(diff.projection)}
                  </td>
                </tr>
              ))}
            </MiniTable>

            {delta.ledger_history && delta.ledger_history.length > 0 && (
              <div className="mt-3 border-t border-hairline pt-3">
                <Timeline
                  events={delta.ledger_history.map((event, index) => ({
                    id: `${event.fact_sequence}-${index}`,
                    title: `${signed(event.quantity_delta)} at fact ${event.fact_sequence}`,
                    detail: event.origin,
                    at: moment(event.occurred_at),
                    state: "done",
                  }))}
                />
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}

function DivergenceTab() {
  const [pool, setPool] = useState("")

  const pools = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const report = useQuery({
    queryKey: inventoryKeys.timeMachineDivergence(pool),
    queryFn: ({ signal }) => timeMachineDivergence(pool, signal),
  })

  return (
    <>
      <Toolbar>
        <Choice
          value={pool}
          onChange={setPool}
          options={(pools.data?.items ?? []).map((one) => ({
            value: one.id,
            label: one.label,
          }))}
          placeholder="Whole ledger"
          className="max-w-72"
        />
      </Toolbar>

      {queryState(report, {
        loading: "Diffing the fold against the projection…",
        render: (data) => (
          <>
            <Card className="mb-[1.125rem] px-4 py-3">
              <KeyValue term="Verdict">
                <Pill tone={data.status === "MATCH" ? "ok" : "bad"}>
                  {data.status === "MATCH" ? "Agrees" : "Diverges"}
                </Pill>
              </KeyValue>
              <KeyValue term="Ledger events">
                {count(data.ledger_events)}
              </KeyValue>
              <KeyValue term="Rows that disagree">
                {count(data.divergent_subjects)}
              </KeyValue>
            </Card>

            {data.reported_truncated && (
              <Banner tone="info" className="mb-[1.125rem]">
                The first twenty-five are shown with their full history. Past
                that the count above is the answer and the histories are not
                fetched — narrow to a pool to see the rest.
              </Banner>
            )}

            {data.reported.length === 0 ? (
              <Card>
                <EmptyState>
                  Every position in the projection equals the fold of the ledger
                  behind it.
                </EmptyState>
              </Card>
            ) : (
              <Deltas deltas={data.reported} />
            )}
          </>
        ),
      })}
    </>
  )
}

function SyncTab() {
  const [origin, setOrigin] = useState("")
  const [generation, setGeneration] = useState("")

  const pools = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const origins = useMemo(
    () => edgeOrigins(pools.data?.items ?? []),
    [pools.data]
  )
  const chosen = origins.find((one) => one.origin_id === origin)
  const wanted =
    generation === "" ? (chosen?.generation ?? 0) : Number(generation)

  const report = useQuery({
    queryKey: inventoryKeys.syncDivergence(origin, wanted),
    queryFn: ({ signal }) => syncDivergence(origin, wanted, signal),
    enabled: origin !== "",
  })

  return (
    <>
      <Toolbar>
        <Choice
          value={origin}
          onChange={setOrigin}
          options={origins.map((one) => ({
            value: one.origin_id,
            label: `${one.label} · gen ${one.generation}`,
          }))}
          placeholder="Choose an Edge node"
          className="max-w-72"
        />
        <Input
          value={generation}
          onChange={(event) => setGeneration(event.target.value)}
          placeholder={
            chosen ? `Generation ${chosen.generation}` : "Generation"
          }
          className="h-8 w-44"
        />
      </Toolbar>

      {origin === "" ? (
        <Card>
          <EmptyState>
            {origins.length === 0
              ? "No Edge node has reported a fact position to this cloud, so there is no stream to compare."
              : "Choose a node to compare its own fact log against what this cloud ingested from it."}
          </EmptyState>
        </Card>
      ) : (
        queryState(report, {
          loading: "Walking both logs…",
          render: (data) => (
            <>
              <Card className="mb-[1.125rem] px-4 py-3">
                <KeyValue term="Verdict">
                  <Pill
                    tone={
                      data.status === "MATCH"
                        ? "ok"
                        : data.status === "EMPTY"
                          ? "neutral"
                          : "bad"
                    }
                  >
                    {data.status === "MATCH"
                      ? "Agrees"
                      : data.status === "EMPTY"
                        ? "No stream"
                        : "Diverges"}
                  </Pill>
                </KeyValue>
                <KeyValue term="Edge events">
                  {data.edge_events === undefined
                    ? "—"
                    : count(data.edge_events)}
                </KeyValue>
                <KeyValue term="Cloud events">
                  {data.cloud_events === undefined
                    ? "—"
                    : count(data.cloud_events)}
                </KeyValue>
                <KeyValue term="Edge through fact">
                  {data.edge_last_fact_seq === undefined
                    ? "—"
                    : count(data.edge_last_fact_seq)}
                </KeyValue>
                <KeyValue term="Cloud through fact">
                  {data.cloud_last_fact_seq === undefined
                    ? "—"
                    : count(data.cloud_last_fact_seq)}
                </KeyValue>
              </Card>

              {data.detail && (
                <Banner
                  tone={data.status === "MATCH" ? "info" : "warn"}
                  className="mb-[1.125rem]"
                >
                  {data.detail}
                </Banner>
              )}

              {data.status === "DIVERGENCE" && (
                <Card className="overflow-hidden">
                  <CardHeader>
                    <CardTitle>Where they part</CardTitle>
                    <span className="font-mono text-id text-mute">
                      fact {count(data.first_divergence_fact_seq ?? 0)}
                    </span>
                  </CardHeader>
                  <div className="border-t border-hairline px-4 py-3">
                    <KeyValue term="Subject">
                      <span className="font-mono text-id">
                        {data.subject_id}
                      </span>
                    </KeyValue>
                    <KeyValue term="Place">
                      <span className="font-mono text-id">{data.place_id}</span>
                    </KeyValue>
                    <KeyValue term="Also divergent">
                      {count(data.also_divergent?.length ?? 0)}
                    </KeyValue>
                    {data.minimal_fixture && (
                      <KeyValue term="Minimal reproduction">
                        {count(data.minimal_fixture.total_events)} events
                        {data.minimal_fixture.faithful
                          ? " · reproduces it exactly"
                          : " · not faithful"}
                      </KeyValue>
                    )}
                    {data.summary && (
                      <p className="pt-3 text-meta text-body">{data.summary}</p>
                    )}
                  </div>
                </Card>
              )}
            </>
          ),
        })
      )}
    </>
  )
}

function WhatIfTab() {
  const [subject, setSubject] = useState("")
  const [place, setPlace] = useState("")
  const [delta, setDelta] = useState("1")
  const [pool, setPool] = useState("")

  const pools = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const evaluate = useMutation({
    mutationFn: () =>
      timeMachineWhatIf({
        scope: pool === "" ? undefined : { pool_id: pool },
        hypothetical: [
          {
            subject_id: subject.trim(),
            place_id: place.trim(),
            quantity_delta: Number(delta),
          },
        ],
      }),
    // Nothing is invalidated on purpose: a what-if is evaluated on a cloned
    // world and writes nothing, so no cached answer has gone stale.
  })

  return (
    <>
      <Card className="mb-[1.125rem] overflow-hidden">
        <CardHeader>
          <CardTitle>Propose a movement</CardTitle>
        </CardHeader>
        <div className="flex flex-col gap-3 border-t border-hairline px-4 py-3.5">
          <Field
            label="Scope"
            hint="Narrow the fold, so a large ledger does not have to be replayed whole."
          >
            <Choice
              value={pool}
              onChange={setPool}
              options={(pools.data?.items ?? []).map((one) => ({
                value: one.id,
                label: one.label,
              }))}
              placeholder="Whole ledger"
              className="h-9 w-full max-w-none"
            />
          </Field>
          <Field label="Subject">
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="font-mono"
              placeholder="Subject uuid from a divergence"
            />
          </Field>
          <Field label="Place">
            <Input
              value={place}
              onChange={(event) => setPlace(event.target.value)}
              className="font-mono"
              placeholder="dc.warehouse:on_hand"
            />
          </Field>
          <Field label="Quantity delta" hint="Negative takes stock out.">
            <Input
              type="number"
              value={delta}
              onChange={(event) => setDelta(event.target.value)}
            />
          </Field>
          <Button
            variant="dark"
            disabled={
              subject.trim() === "" || place.trim() === "" || evaluate.isPending
            }
            onClick={() => evaluate.mutate()}
          >
            {evaluate.isPending ? "Evaluating…" : "Evaluate — writes nothing"}
          </Button>
        </div>
      </Card>

      {evaluate.isError && (
        <Banner tone="bad" className="mb-[1.125rem]">
          {evaluate.error instanceof Error
            ? evaluate.error.message
            : "The hypothesis could not be evaluated."}
        </Banner>
      )}

      {evaluate.data && (
        <>
          <Banner
            tone={evaluate.data.resolves_projection ? "ok" : "warn"}
            className="mb-[1.125rem]"
          >
            {evaluate.data.resolves_projection
              ? "This movement would reconcile the ledger with the projection completely."
              : `${count(evaluate.data.remaining_divergences.length)} rows would still disagree afterwards.`}
            {evaluate.data.new_violations.length > 0 &&
              ` It would also break ${count(evaluate.data.new_violations.length)} invariants: ${evaluate.data.new_violations.map((one) => one.invariant).join(", ")}.`}
          </Banner>

          {evaluate.data.changed_subjects.length > 0 && (
            <>
              <h3 className="mb-2.5 text-card-title font-semibold text-ink">
                What it would change
              </h3>
              <Deltas deltas={evaluate.data.changed_subjects} />
            </>
          )}

          {evaluate.data.remaining_divergences.length > 0 && (
            <>
              <h3 className="mt-5 mb-2.5 text-card-title font-semibold text-ink">
                What would still be wrong
              </h3>
              <Deltas deltas={evaluate.data.remaining_divergences} />
            </>
          )}
        </>
      )}
    </>
  )
}
