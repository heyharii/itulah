import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText } from "lucide-react"

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

/// One truck, and the last button this building presses on these goods.
///
/// Departing is irreversible — there is no route that un-departs a dispatch —
/// and it is the moment the stock stops being this DC's. So it asks once, in
/// words, before it happens: a confirm dialog on a phone is not ceremony here,
/// it is the difference between a lorry that left and a lorry the ledger merely
/// believes left.
export function KirimMuat() {
  const client = useQueryClient()
  const id = useParam("id").value

  const run = useQuery({
    ...reads.dispatch(id ?? ""),
    enabled: id !== undefined,
  })

  const depart = useMutation({
    mutationFn: () => dc.departDispatch(id!),
    onSuccess: () => {
      // A departure empties the yard, moves every carton on the truck into
      // transit and takes the units out of this building's outbound pools.
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
                  {describe(depart.error)}
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
                  <KeyValue term="Berangkat" tone={departed === null ? "normal" : "ok"}>
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
          <Button
            variant="primary"
            size="lg"
            block
            disabled={depart.isPending}
            onClick={() => {
              if (
                !window.confirm(
                  `Berangkatkan ${run.data.dispatch.dispatch_number}? Setelah ini barangnya bukan lagi tanggung jawab gudang ini, dan tidak bisa dibatalkan.`,
                )
              ) {
                return
              }
              depart.mutate()
            }}
          >
            {depart.isPending ? "Memberangkatkan…" : "Berangkatkan truk"}
          </Button>
        </ActionBar>
      )}
    </>
  )
}
