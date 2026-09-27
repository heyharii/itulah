import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { ActionBar, CardList, Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { describe } from "@/lib/errors"
import { count, label, moment, toneFor } from "@/lib/format"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { keys, reads } from "@/lib/queries"
import { useActor } from "@/lib/session"

function fulfillmentKey(koliId: string, stage: string) {
  return `floor-fulfillment-${koliId}-${stage}`
}

async function settleFulfillment(requests: readonly Promise<unknown>[]) {
  const results = await Promise.allSettled(requests)
  const failure = results.find((result) => result.status === "rejected")
  if (failure?.status === "rejected") throw failure.reason
}

/// One truck, and the last button this building presses on these goods.
///
/// Departing is irreversible — there is no route that un-departs a dispatch —
/// and it is the moment the stock stops being this DC's. So it asks once, in
/// words, before it happens: a confirm dialog on a phone is not ceremony here,
/// it is the difference between a lorry that left and a lorry the ledger merely
/// believes left.
export function KirimMuat() {
  const client = useQueryClient()
  const actor = useActor()
  const id = useParam("id").value
  const [confirmingDeparture, setConfirmingDeparture] = useState(false)

  const run = useQuery({
    ...reads.dispatch(id ?? ""),
    enabled: id !== undefined,
  })

  const depart = useMutation({
    mutationFn: async () => {
      // The surat jalan and truck grouping are documents. These package
      // movements are the inventory facts Hub follows, so record them from
      // the same action a warehouse uses to send the truck away.
      const current = await dc.dispatch(id!)
      const shipments = await Promise.all(
        current.shipments.map((shipment) => dc.shipment(shipment.shipment_id)),
      )
      const koliIds = [
        ...new Set(
          shipments.flatMap((shipment) =>
            shipment.koli.map((box) => box.koli.koli_id),
          ),
        ),
      ]
      if (koliIds.length === 0) {
        throw new Error("Muatan ini tidak berisi koli yang dapat dikirim.")
      }

      // Stable operation keys make retry safe if a request times out after the
      // Edge has already recorded a stage for some of the cartons.
      await settleFulfillment(
        koliIds.map((koliId) =>
          dc.koliLoaded(koliId, {
            actor_id: actor,
            idempotency_key: fulfillmentKey(koliId, "loaded"),
          }),
        ),
      )

      const dispatch =
        current.dispatch.departed_at === null
          ? await dc.departDispatch(id!)
          : current.dispatch

      await settleFulfillment(
        koliIds.map((koliId) =>
          dc.koliInTransit(koliId, {
            actor_id: actor,
            idempotency_key: fulfillmentKey(koliId, "in-transit"),
          }),
        ),
      )
      return dispatch
    },
    onSuccess: () => {
      // A departure empties the yard, moves every carton on the truck into
      // transit and takes the units out of this building's outbound pools.
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
    onError: () => {
      // A timeout may arrive after `departed_at` has committed. Refresh it so
      // the retry action follows the persisted dispatch state.
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  if (id === undefined) {
    return (
      <Screen foot="none">
        <EmptyState>Muatan tidak disebut di alamat layar ini.</EmptyState>
      </Screen>
    )
  }

  const departed = run.data?.dispatch.departed_at ?? null

  return (
    <>
      <Screen foot="none">
        {queryState(run, {
          loading: "Menanyakan muatan…",
          render: (detail) => (
            <>
              <div className="pt-1 pb-4">
                <h2 className="text-title font-semibold text-ink">
                  {detail.dispatch.dispatch_number}
                </h2>
                <p className="mt-0.5 text-meta text-body">
                  {count(detail.dispatch.shipment_count)} kiriman ·{" "}
                  {count(detail.dispatch.koli_count)} koli
                </p>
              </div>

              {depart.isError && (
                <Banner tone="bad" className="mb-4">
                  {departed === null
                    ? `Truk belum diberangkatkan; progres fulfillment belum lengkap. ${describe(depart.error)}`
                    : `Truk sudah berangkat, tetapi progres In-Transit belum seluruhnya tercatat. ${describe(depart.error)}`}
                </Banner>
              )}

              <Section>
                <div className="rounded-card border border-hairline bg-canvas px-3.5 py-2 shadow-soft">
                  <KeyValue term="Ekspedisi">
                    {detail.dispatch.carrier ?? "—"}
                  </KeyValue>
                  <KeyValue term="Nomor polisi">
                    {detail.dispatch.vehicle_plate ?? "—"}
                  </KeyValue>
                  <KeyValue term="Sopir">
                    {detail.dispatch.driver_name ?? "—"}
                  </KeyValue>
                  <KeyValue
                    term="Berangkat"
                    tone={departed === null ? "normal" : "ok"}
                  >
                    {departed === null ? "belum" : moment(departed)}
                  </KeyValue>
                </div>
              </Section>

              <Section title="Kiriman di truk ini">
                <CardList>
                  {detail.shipments.map((shipment) => (
                    <RecordCard
                      key={shipment.shipment_id}
                      icon={<FileText />}
                      id={shipment.shipment_number}
                      status={
                        <Pill tone={toneFor(shipment.position)}>
                          {label(shipment.position)}
                        </Pill>
                      }
                    >
                      <div className="px-3.5 pt-2 pb-3">
                        <KeyValue term="Tujuan">
                          {shipment.destination_store_id}
                        </KeyValue>
                        <KeyValue term="Isi">
                          {count(shipment.koli_count)} koli ·{" "}
                          {count(shipment.unit_count)} potong
                        </KeyValue>
                      </div>
                    </RecordCard>
                  ))}
                </CardList>
              </Section>
            </>
          ),
        })}
      </Screen>

      {run.data !== undefined && departed === null && (
        <ActionBar>
          {confirmingDeparture ? (
            <div
              role="alertdialog"
              aria-labelledby="departure-confirm-title"
              aria-describedby="departure-confirm-description"
              className="w-full rounded-card border border-hairline bg-canvas p-4 shadow-soft"
            >
              <h2
                id="departure-confirm-title"
                className="text-control font-semibold text-ink"
              >
                Berangkatkan {run.data.dispatch.dispatch_number}?
              </h2>
              <p id="departure-confirm-description" className="mt-1 text-body">
                Setelah berangkat, barang keluar dari tanggung jawab gudang ini
                dan keberangkatan tidak bisa dibatalkan.
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  className="flex-1"
                  disabled={depart.isPending}
                  onClick={() => setConfirmingDeparture(false)}
                >
                  Kembali
                </Button>
                <Button
                  className="flex-1"
                  variant="primary"
                  disabled={depart.isPending}
                  onClick={() => {
                    setConfirmingDeparture(false)
                    depart.mutate()
                  }}
                >
                  {depart.isPending ? "Memberangkatkan…" : "Ya, berangkatkan"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="primary"
              size="lg"
              block
              disabled={depart.isPending}
              onClick={() => setConfirmingDeparture(true)}
            >
              {depart.isPending
                ? "Mencatat progres…"
                : depart.isError
                  ? "Coba lagi keberangkatan"
                  : "Berangkatkan truk"}
            </Button>
          )}
        </ActionBar>
      )}
      {run.data !== undefined && departed !== null && depart.isError && (
        <ActionBar>
          <Button
            variant="primary"
            size="lg"
            block
            disabled={depart.isPending}
            onClick={() => depart.mutate()}
          >
            {depart.isPending
              ? "Mencatat progres…"
              : "Ulangi pencatatan In-Transit"}
          </Button>
        </ActionBar>
      )}
    </>
  )
}
