import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Truck } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import {
  RecordActions,
  RecordBody,
  RecordCard,
  RecordHead,
} from "@/components/ui/record-card"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { StopPair } from "@/components/ui/stop-pair"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { clock, count, label, positionTone } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import {
  advanceEach,
  type Progress,
} from "@/screens/operations/despatch/progress"
import { useEdgeActor, useEdgeNodeIdentity } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { idempotencyKey } from "@itulah/contract/client"
import type { Dispatch } from "@itulah/contract"

/// Trucks: consignments loaded onto a run, and the gate.
///
/// **Departing is the one stage change that moves goods in the world.** Before
/// it the stock is still this DC's, sitting in `outbound.loaded` on the yard;
/// after it the pieces leave this node's pools entirely. Nothing in the server
/// walks that back, so it is behind a question.
///
/// As on the consignment screen, the document and the goods are two writes:
/// `POST dispatches` and `POST dispatches/{id}/depart` file the paperwork, and
/// `koli/{id}/dispatch` and `koli/{id}/in-transit` move the cartons.
export function Trucks() {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const dispatch = useSheet("dispatch")
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [progress, setProgress] = useState<Progress | null>(null)

  // Consignments with no truck. Everything else is already on a run.
  const waiting = useQuery({
    queryKey: keys.shipments({ unassigned: true }),
    queryFn: ({ signal }) => dc.shipments({ unassigned: true }, signal),
  })

  // Every carton, so a consignment or a run can be resolved back to the boxes
  // whose stock has to move with it.
  const allBoxes = useQuery({
    queryKey: keys.koli(),
    queryFn: ({ signal }) => dc.koli({}, signal),
  })

  // `{ ready: true }` on the wire means "still here" — trucks on the yard.
  const onYard = useQuery({
    queryKey: keys.dispatches({ ready: true }),
    queryFn: ({ signal }) => dc.dispatches({ ready: true }, signal),
  })

  const boxesOf = (shipmentIds: readonly string[]): string[] =>
    (allBoxes.data ?? [])
      .filter(
        (box) =>
          box.shipment_id !== null && shipmentIds.includes(box.shipment_id)
      )
      .map((box) => box.koli_id)

  const refresh = () => {
    void client.invalidateQueries({ queryKey: keys.dc.all })
    void client.invalidateQueries({ queryKey: keys.pools() })
  }

  const load = useMutation({
    mutationFn: async (value: {
      carrier: string
      plate: string
      driver: string
    }) => {
      const shipmentIds = [...chosen]
      const koliIds = boxesOf(shipmentIds)
      await dc.createDispatch({
        shipment_ids: shipmentIds,
        carrier: value.carrier.trim() === "" ? null : value.carrier.trim(),
        vehicle_plate: value.plate.trim() === "" ? null : value.plate.trim(),
        driver_name: value.driver.trim() === "" ? null : value.driver.trim(),
        actor_id: actor,
      })
      // Named for what happened rather than for the entity it happened to:
      // "dispatched" reads as gone, and these have not gone.
      return advanceEach(koliIds, "loaded", (koliId) =>
        dc.koliLoaded(koliId, {
          actor_id: actor,
          idempotency_key: idempotencyKey(),
        })
      )
    },
    onSuccess: (result) => {
      setProgress(result)
      setChosen(new Set())
      form.reset()
      refresh()
    },
  })

  const depart = useMutation({
    mutationFn: async (dispatchId: string) => {
      const run = await dc.dispatch(dispatchId)
      const koliIds = boxesOf(
        run.shipments.map((shipment) => shipment.shipment_id)
      )
      await dc.departDispatch(dispatchId)
      // Gone. The stock leaves this DC's pools here and nowhere else.
      return advanceEach(koliIds, "on the road", (koliId) =>
        dc.koliInTransit(koliId, {
          actor_id: actor,
          idempotency_key: idempotencyKey(),
        })
      )
    },
    onSuccess: (result) => {
      setProgress(result)
      refresh()
    },
  })

  const form = useForm({
    defaultValues: { carrier: "", plate: "", driver: "" },
    onSubmit: ({ value }) => {
      if (chosen.size === 0) return
      load.mutate(value)
    },
  })

  const rows = waiting.data ?? []
  const runs = onYard.data ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="Despatch"
        title="Trucks"
        sub="Load the consignments, then open the gate. Departing is the one step that cannot be walked back."
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Waiting for a truck"
          value={count(rows.length)}
          delta="on the dock"
          tone={rows.length > 0 ? "down" : "flat"}
        />
        <Kpi
          label="On the yard"
          value={count(runs.length)}
          delta="not gone yet"
        />
        <Kpi
          label="Cartons on the yard"
          value={count(runs.reduce((total, run) => total + run.koli_count, 0))}
        />
        <Kpi
          label="Chosen"
          value={count(chosen.size)}
          delta="for the next run"
        />
      </KpiStrip>

      {progress !== null && (
        <Banner
          tone={progress.failed.length === 0 ? "ok" : "bad"}
          className="mb-[1.125rem]"
          onDismiss={() => setProgress(null)}
        >
          {progress.message}
          {progress.failed.length > 0 &&
            " Those cartons are still where they were. The safe retry is the step they failed at."}
        </Banner>
      )}

      <div className="grid gap-[1.125rem] xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
        <div className="flex flex-col gap-[1.125rem]">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>On the dock</CardTitle>
              <span className="text-[0.75rem] text-mute">
                {count(chosen.size)} of {count(rows.length)} chosen
              </span>
            </CardHeader>
            {queryState(waiting, {
              loading: "Reading the dock…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState
                    action={
                      <AppLink to="/operations/despatch" variant="soft">
                        Build a consignment
                      </AppLink>
                    }
                  >
                    Every consignment is on a truck run. Nothing is waiting on
                    the dock.
                  </EmptyState>
                ) : (
                  <div className="border-t border-hairline">
                    {rows.map((row) => {
                      const picked = chosen.has(row.shipment_id)
                      return (
                        <button
                          key={row.shipment_id}
                          type="button"
                          onClick={() =>
                            setChosen((current) => {
                              const next = new Set(current)
                              if (next.has(row.shipment_id))
                                next.delete(row.shipment_id)
                              else next.add(row.shipment_id)
                              return next
                            })
                          }
                          className={`flex min-h-tap w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left transition-colors last:border-b-0 ${
                            picked ? "bg-accent-bg" : "hover:bg-soft"
                          }`}
                        >
                          <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-body">
                            <FileText className="size-[0.9375rem]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-id text-ink">
                              {row.shipment_number}
                            </span>
                            <span className="block truncate text-[0.6875rem] text-mute">
                              {row.destination_store_id} ·{" "}
                              {count(row.koli_count)} cartons
                            </span>
                          </span>
                          <span className="shrink-0 text-[0.78125rem] text-body tabular-nums">
                            {count(row.unit_count)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ),
            })}
          </Card>

          <div>
            <h2 className="mb-3 text-card-title font-semibold text-ink">
              On the yard
            </h2>
            {queryState(onYard, {
              loading: "Reading the yard…",
              render: () =>
                runs.length === 0 ? (
                  <Card>
                    <EmptyState>
                      No truck is standing on the yard. Everything loaded has
                      left.
                    </EmptyState>
                  </Card>
                ) : (
                  <div className="flex flex-col gap-3">
                    {runs.map((run) => (
                      <RunCard
                        key={run.dispatch_id}
                        run={run}
                        pending={depart.isPending}
                        onDepart={() => depart.mutate(run.dispatch_id)}
                        onOpen={() => dispatch.open(run.dispatch_id)}
                      />
                    ))}
                  </div>
                ),
            })}
            <Problem error={depart.error} className="mt-3" />
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Load a truck</CardTitle>
          </CardHeader>
          <form
            className="flex flex-col gap-3 border-t border-hairline px-4 py-3.5"
            onSubmit={(event) => {
              event.preventDefault()
              form.handleSubmit()
            }}
          >
            <form.Field name="carrier">
              {(field) => (
                <Field label="Carrier" hint="Internal, or a courier's name">
                  <Input
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="plate">
              {(field) => (
                <Field label="Vehicle plate">
                  <Input
                    className="font-mono"
                    autoCapitalize="characters"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="driver">
              {(field) => (
                <Field label="Driver">
                  <Input
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>

            <Problem error={load.error} />
            <Button
              variant="dark"
              type="submit"
              disabled={chosen.size === 0 || load.isPending}
            >
              {load.isPending
                ? "Loading…"
                : `Load ${count(chosen.size)} consignments`}
            </Button>
            <p className="text-[0.71875rem] text-mute">
              Loading files the run and moves every carton on it onto the truck.
              The goods are still here until the gate opens.
            </p>
          </form>
        </Card>
      </div>

      <RunSheet id={dispatch.value ?? null} onClose={dispatch.close} />
    </PageContent>
  )
}

function RunCard({
  run,
  pending,
  onDepart,
  onOpen,
}: {
  run: Dispatch
  pending: boolean
  onDepart: () => void
  onOpen: () => void
}) {
  const where = useEdgeNodeIdentity()
  return (
    <RecordCard>
      <RecordHead
        tile={<Truck />}
        id={run.dispatch_number}
        title={
          [run.carrier, run.vehicle_plate, run.driver_name]
            .filter((part) => part !== null && part !== "")
            .join(" · ") || "no carrier named"
        }
        status={
          run.departed_at === null ? (
            <Pill tone="warn">On the yard</Pill>
          ) : (
            <Pill tone="info" withDot>
              Gone
            </Pill>
          )
        }
        onClick={onOpen}
      />
      <RecordBody>
        <StopPair
          from={{
            place: where.data?.site_id ?? "This DC",
            detail: `${count(run.shipment_count)} consignments · ${count(run.koli_count)} cartons`,
            at: run.departed_at === null ? "not gone" : clock(run.departed_at),
          }}
          to={{
            place:
              run.shipment_count === 1
                ? "one shop"
                : `${run.shipment_count} shops`,
            detail:
              run.departed_at === null
                ? "waiting at the gate"
                : "on the road since departure",
            done: run.departed_at !== null,
          }}
        />
      </RecordBody>
      <RecordActions>
        {run.departed_at === null ? (
          <ConfirmButton
            label="Open the gate"
            title={`Send ${run.dispatch_number} out`}
            description={
              <>
                This is the one step that moves goods in the world.{" "}
                {count(run.koli_count)} cartons leave this DC's pools and become
                a shop's problem — nothing in the server walks it back.
              </>
            }
            confirmLabel="It has left"
            variant="dark"
            pending={pending}
            onConfirm={onDepart}
          />
        ) : (
          <span className="text-[0.71875rem] text-mute">
            Departed {clock(run.departed_at)}.
          </span>
        )}
        <Button variant="quiet" onClick={onOpen}>
          What is on it
        </Button>
      </RecordActions>
    </RecordCard>
  )
}

/// The loading manifest: one truck run, and every consignment on it.
function RunSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: keys.dispatch(id ?? ""),
    queryFn: ({ signal }) => dc.dispatch(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.dispatch.dispatch_number}
      title={detail.data?.dispatch.carrier ?? "Truck run"}
    >
      {queryState(detail, {
        loading: "Reading the run…",
        render: (record) => (
          <div className="flex flex-col gap-5">
            <div>
              {record.dispatch.departed_at === null ? (
                <Pill tone="warn">On the yard</Pill>
              ) : (
                <Pill tone="info" withDot>
                  On the road
                </Pill>
              )}
            </div>

            <Facts>
              <Fact term="Carrier">{record.dispatch.carrier ?? "—"}</Fact>
              <Fact term="Plate">{record.dispatch.vehicle_plate ?? "—"}</Fact>
              <Fact term="Driver">{record.dispatch.driver_name ?? "—"}</Fact>
              <Fact term="Departed">
                {record.dispatch.departed_at === null
                  ? "not yet"
                  : clock(record.dispatch.departed_at)}
              </Fact>
              <Fact term="Consignments">
                {count(record.dispatch.shipment_count)}
              </Fact>
              <Fact term="Cartons">{count(record.dispatch.koli_count)}</Fact>
            </Facts>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                What is on it
              </h4>
              <div className="overflow-hidden rounded-inner border border-hairline">
                {record.shipments.map((shipment) => (
                  <AppLink
                    key={shipment.shipment_id}
                    to="/operations/despatch"
                    sheet={{ key: "shipment", value: shipment.shipment_id }}
                    className="flex min-h-tap items-center gap-3 border-b border-hairline px-3.5 py-2 transition-colors last:border-b-0 hover:bg-soft"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-id text-ink">
                        {shipment.shipment_number}
                      </span>
                      <span className="block truncate text-[0.6875rem] text-mute">
                        {shipment.destination_store_id} ·{" "}
                        {count(shipment.koli_count)} cartons
                      </span>
                    </span>
                    <Pill tone={positionTone(shipment.position)}>
                      {label(shipment.position)}
                    </Pill>
                  </AppLink>
                ))}
              </div>
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}
