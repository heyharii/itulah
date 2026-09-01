import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { StorePicker } from "@/components/store-picker"
import { Allocation, AllocationRow } from "@/components/ui/allocation"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Progress } from "@/components/ui/progress"
import { Banner, EmptyState, Problem, Receipt } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count, variance } from "@/lib/format"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { useActor } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import type { CaptureOutcome } from "@itulah/contract"

/// The RFID path: name what the box is meant to hold, then sweep it.
///
/// **The target is fixed when the box opens and is not editable afterwards.**
/// A target edited to match the sweep is not a target — it is a transcription
/// of whatever happened to be in the carton.
///
/// When a sweep agrees with the target the server packs, freezes and seals the
/// box in one go: agreement *is* the seal, so there is no button here for it
/// and nobody has to remember to press one. A sweep that disagrees comes back
/// 200 with the detail, because a box that does not add up is an ordinary
/// answer a packer acts on rather than a failure of the request.
export function Sweep() {
  const store = useSheet("store")
  const box = useSheet("box")
  const destination = store.value ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="Packing"
        title="Target &amp; sweep"
        sub="Say what the carton should hold, then let the arch check it."
      />

      <StorePicker hint="A box is opened against a fixed target, drawn from what this one shop is still owed." />

      {destination === null ? (
        <Banner tone="info">
          Name the shop. A box is opened against a fixed target, and the target
          is drawn from what that one shop is still owed.
        </Banner>
      ) : box.value === undefined ? (
        <OpenBox destination={destination} />
      ) : (
        <OpenedBox sessionId={box.value} destination={destination} />
      )}
    </PageContent>
  )
}

/// Choosing the target, from what can honestly go in a box for this shop.
function OpenBox({ destination }: { destination: string }) {
  const actor = useActor()
  const client = useQueryClient()
  const box = useSheet("box")
  const [target, setTarget] = useState<Record<string, string>>({})

  const outstanding = useQuery({
    queryKey: keys.outstanding(destination),
    queryFn: ({ signal }) => dc.outstandingFor(destination, signal),
  })

  const open = useMutation({
    mutationFn: (lines: { sku_code: string; target_qty: number }[]) =>
      dc.openPackingBox({
        destination_store_id: destination,
        target: lines,
        actor_id: actor,
        note: null,
      }),
    onSuccess: (opened) => {
      // `replace`: the empty screen is not somewhere `back` should return to
      // once a box is open against a target.
      box.replace(opened.session.session_id)
      void client.invalidateQueries({
        queryKey: keys.packRounds({ ready: true }),
      })
    },
  })

  const lines = (outstanding.data ?? []).filter((line) => line.outstanding > 0)
  const chosen = Object.entries(target)
    .map(([sku, value]) => ({ sku_code: sku, target_qty: Number(value) }))
    .filter((line) => Number.isInteger(line.target_qty) && line.target_qty > 0)

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Target</CardTitle>
        <span className="text-[0.75rem] text-mute">
          fixed when the box opens
        </span>
      </CardHeader>
      {queryState(outstanding, {
        loading: "Reading what this shop is owed…",
        render: () =>
          lines.length === 0 ? (
            <EmptyState
              action={
                <AppLink to="/picking" variant="soft">
                  Go and pick some
                </AppLink>
              }
            >
              Nothing to target for this shop — either it has nothing coming, or
              nobody has fetched it off the racks yet.
            </EmptyState>
          ) : (
            <>
              <div className="border-t border-hairline">
                {lines.map((line) => (
                  <div
                    key={line.sku_code}
                    className="flex min-h-tap items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-id text-ink">
                        {line.sku_code}
                      </span>
                      <span className="block truncate text-[0.6875rem] text-mute">
                        up to {count(line.outstanding)} can go
                      </span>
                    </span>
                    <Input
                      className="w-24 text-center font-semibold"
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={`Target pieces of ${line.sku_code}`}
                      value={target[line.sku_code] ?? ""}
                      onChange={(event) =>
                        setTarget((current) => ({
                          ...current,
                          [line.sku_code]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2.5 border-t border-hairline px-4 py-3">
                <Problem error={open.error} />
                <Button
                  variant="dark"
                  disabled={chosen.length === 0 || open.isPending}
                  onClick={() => open.mutate(chosen)}
                >
                  {open.isPending
                    ? "Opening…"
                    : `Open a box for ${count(chosen.reduce((total, line) => total + line.target_qty, 0))} pieces`}
                </Button>
              </div>
            </>
          ),
      })}
    </Card>
  )
}

/// The box, and the arch.
function OpenedBox({
  sessionId,
  destination,
}: {
  sessionId: string
  destination: string
}) {
  const client = useQueryClient()
  const box = useSheet("box")
  const [outcome, setOutcome] = useState<CaptureOutcome | null>(null)

  const state = useQuery({
    queryKey: keys.packingBox(sessionId),
    queryFn: ({ signal }) => dc.packingBox(sessionId, signal),
  })

  const sweep = useMutation({
    mutationFn: (reader: string) => dc.captureBox(sessionId, reader),
    onSuccess: (result) => {
      setOutcome(result)
      if (!result.matched) {
        // A sweep that disagreed changed nothing: the box is still open and
        // still wanting the same pieces, and the difference is on screen.
        void client.invalidateQueries({ queryKey: keys.packingBox(sessionId) })
        return
      }
      // Agreement is the seal. The carton, the shop's outstanding lines, the
      // round's totals and the outbound pools all moved at once.
      form.reset()
      box.close()
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const form = useForm({
    defaultValues: { reader: "" },
    onSubmit: ({ value }) => {
      if (value.reader.trim() === "") return
      sweep.mutate(value.reader.trim())
    },
  })

  const target = state.data?.target ?? []
  const targeted = target.reduce((total, line) => total + line.target_qty, 0)
  const swept = (outcome?.lines ?? []).reduce(
    (total, line) => total + line.scanned_qty,
    0
  )

  return (
    <div className="grid gap-[1.125rem] xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>The box</CardTitle>
          {state.data?.ready === true ? (
            <Pill tone="ok">Agreed</Pill>
          ) : (
            <Pill tone="warn">Filling</Pill>
          )}
        </CardHeader>

        {queryState(state, {
          loading: "Reading the box…",
          render: (record) => (
            <div className="flex flex-col gap-3.5 border-t border-hairline px-4 py-3.5">
              <Progress
                label="Swept"
                value={swept}
                of={targeted}
                tone={outcome?.matched === true ? "ok" : "accent"}
                detail={`${count(swept)}/${count(targeted)}`}
              />

              <Allocation
                left={{ label: "Target", total: count(targeted) }}
                right={{ label: "Swept", total: count(swept) }}
              >
                {record.target.map((line) => {
                  const found = outcome?.lines.find(
                    (swept_) => swept_.sku_code === line.sku_code
                  )
                  const agrees =
                    found !== undefined && found.scanned_qty === line.target_qty
                  return (
                    <AllocationRow
                      key={line.sku_code}
                      name={line.sku_code}
                      sub={
                        found === undefined
                          ? "not swept yet"
                          : agrees
                            ? "agrees"
                            : "does not add up"
                      }
                      expected={count(line.target_qty)}
                      found={
                        found === undefined ? "—" : count(found.scanned_qty)
                      }
                      difference={
                        found === undefined
                          ? undefined
                          : {
                              value: variance(
                                found.scanned_qty - line.target_qty
                              ),
                              agrees,
                            }
                      }
                    />
                  )
                })}
              </Allocation>

              {outcome !== null && outcome.unexpected.length > 0 && (
                <Banner tone="bad">
                  <b className="font-medium">Wrong goods in the carton.</b>{" "}
                  {outcome.unexpected
                    .map(
                      (line) => `${line.sku_code} ×${count(line.scanned_qty)}`
                    )
                    .join(", ")}{" "}
                  — ours, but not on this box's list. Caught before the lid
                  closes rather than at the shop door.
                </Banner>
              )}

              {outcome !== null && outcome.unknown_epcs.length > 0 && (
                <Banner tone="warn">
                  {count(outcome.unknown_epcs.length)} tags this DC has never
                  heard of were swept. They are not stock here, so they are not
                  in this box's arithmetic.
                </Banner>
              )}
            </div>
          ),
        })}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>The arch</CardTitle>
          <span className="font-mono text-id text-body">{destination}</span>
        </CardHeader>
        <form
          className="flex flex-col gap-3 border-t border-hairline px-4 py-3.5"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <p className="text-meta text-body">
            The reader has already swept the carton and holds the tags under a
            session id. Give that id here and the node compares it against the
            target.
          </p>
          <form.Field name="reader">
            {(field) => (
              <Input
                className="font-mono"
                placeholder="Reader session id"
                aria-label="Reader session id"
                autoCapitalize="off"
                autoCorrect="off"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <Button variant="dark" type="submit" disabled={sweep.isPending}>
            {sweep.isPending ? "Comparing…" : "Compare with the target"}
          </Button>
          <Problem error={sweep.error} />
          {outcome?.matched === true && (
            <Receipt>
              The sweep agreed. The carton is packed, frozen and sealed — that
              is what agreement means here, so there is nothing left to press.
            </Receipt>
          )}
        </form>

        <div className="border-t border-hairline px-4 py-3">
          <Button variant="quiet" onClick={() => box.close()}>
            Leave this box open
          </Button>
        </div>
      </Card>
    </div>
  )
}
